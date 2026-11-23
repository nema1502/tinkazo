#!/usr/bin/env node
/**
 * Prueba de la sala contra un Worker en marcha:
 *
 *   npx wrangler@4 dev --port 8791 --var VIDA_PRUEBA_MS:600000
 *   node probar.mjs http://127.0.0.1:8791 [--cupos] [--tope]
 *
 * La prueba principal tarda más de un minuto (espera a que pase el tope por minuto de los nombres), así que la
 * sala tiene que vivir más que eso: con `VIDA_PRUEBA_MS:600000` vive diez minutos. La alarma que borra la sala sola
 * se prueba aparte, con una vida corta y solo ella (conviene un Worker nuevo, por el cupo de salas por hora):
 *
 *   npx wrangler@4 dev --port 8791 --var VIDA_PRUEBA_MS:4000
 *   node probar.mjs http://127.0.0.1:8791 --alarma
 *
 * Crea tres salas y no deja nada guardado (las cierra o vencen solas). `--cupos`
 * prueba el tope de salas por dirección (deja esa dirección una hora sin crear
 * después de 30 salas; reiniciar `wrangler dev` lo reinicia); `--tope` manda
 * nombres durante unos dos minutos para llegar a 400.
 */
import { gzipSync } from "node:zlib";
import { ed25519 } from "@noble/curves/ed25519.js";

const base = (process.argv[2] ?? "http://127.0.0.1:8791").replace(/\/$/, "");
const conCupos = process.argv.includes("--cupos");
const conTope = process.argv.includes("--tope");
const soloAlarma = process.argv.includes("--alarma");
const soloTus = process.argv.includes("--solo-tus-campanas");
const conTus = soloTus || process.argv.includes("--tus-campanas");
const SITIO = { Origin: "https://tinkazo.app" };
let fallas = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallas++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (u) => Buffer.from(u).toString("base64url");
/** La llave de un celular para el registro de equipos: 16 bytes al azar. */
const nuevaLlave = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/** Una cuenta de Stellar bien formada (G…, con su suma de control), hecha de 32 bytes iguales a `byte`. */
function cuentaDePrueba(byte) {
  const datos = new Uint8Array(35);
  datos[0] = 6 << 3;
  datos.fill(byte, 1, 33);
  let crc = 0;
  for (const b of datos.subarray(0, 33)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  datos[33] = crc & 0xff;
  datos[34] = crc >> 8;
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let valor = 0;
  let out = "";
  for (const b of datos) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ABC[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** Un nombre cifrado como lo hace la página: [1][IV][AES-GCM]. */
async function cifrar(claveB64, texto) {
  const k = await crypto.subtle.importKey("raw", Buffer.from(claveB64, "base64url"), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(texto)));
  const out = new Uint8Array(13 + ct.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(ct, 13);
  return b64(out);
}
/** La huella del nombre, gemela de la que calcula la página con la clave del QR. */
async function huella(claveB64, texto) {
  const raw = Buffer.from(claveB64, "base64url");
  const sep = new TextEncoder().encode("Tinkazo/sala/huella-de-nombre/v1");
  const material = new Uint8Array(sep.length + raw.length);
  material.set(sep);
  material.set(raw, sep.length);
  const derivada = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const k = await crypto.subtle.importKey("raw", derivada, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const limpio = texto.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202f\u205f-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]/g, "");
  const normal = limpio.replace(/\s+/g, " ").trim().normalize("NFC").trim().toLowerCase();
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(normal))));
}
async function descifrar(claveB64, d) {
  const u = Buffer.from(d, "base64url");
  const k = await crypto.subtle.importKey("raw", Buffer.from(claveB64, "base64url"), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(1, 13) }, k, u.subarray(13)));
}
/** Toda alta válida usa el cuerpo nuevo. Sin `llave`, simula un celular distinto. */
async function post(id, nombre, llave = nuevaLlave()) {
  const d = await cifrar(clave, nombre);
  const h = await huella(clave, nombre);
  return fetch(`${base}/v1/sala/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ d, h, llave }) });
}
/** Solo para comprobar los cuerpos mal formados y el límite de tamaño. */
const postPlano = (id, d) => fetch(`${base}/v1/sala/${id}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: d });
const auth = (token) => ({ Authorization: `Bearer ${token}`, ...SITIO });
const crear = () => fetch(`${base}/v1/sala`, { method: "POST", headers: SITIO });

/** Un WebSocket de la pantalla: junta lo que llega y cómo se cierra. */
function pantalla(id) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/v1/sala/${id}/pantalla`);
  const msgs = [];
  const est = { cierre: null };
  ws.addEventListener("message", (e) => msgs.push(e.data === "pong" ? { t: "pong" } : JSON.parse(e.data)));
  ws.addEventListener("close", (e) => (est.cierre = e.code));
  const abierto = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", () => rej(new Error("no abrió")));
  });
  return { ws, msgs, est, abierto };
}
const esperar = async (f, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (f()) return true;
    await sleep(50);
  }
  return false;
};

// ---------------------------------------------------------------------------------------------------------------------
// Tus campañas, en el motor real. Pide el Worker levantado con `prueba-local/correr.mjs` (el proveedor de cuentas y el RPC de
// la red son imitaciones locales que la prueba maneja por /__prueba/...). Solo en local: ni con la llave puesta se escribe nada
// contra producción. Cubre la toma, el cierre de la pantalla vieja, el token viejo en cada ruta, la sellada que no se toma,
// el sellado que no se reemplaza, las dos carreras (toma contra toma y toma contra sello) y los topes por cuenta.
// ---------------------------------------------------------------------------------------------------------------------
async function probarTusCampanas() {
  if (new URL(base).hostname === "s.tinkazo.app") {
    console.log("SALTADO tus campañas: no se prueba contra producción");
    return;
  }
  if (!process.env.CAMPANA_LLAVE_PRUEBA) {
    check("tus campañas: hace falta CAMPANA_LLAVE_PRUEBA (lo pone prueba-local/correr.mjs)", false);
    return;
  }
  const secreto = Buffer.from(process.env.CAMPANA_LLAVE_PRUEBA, "hex");
  const JSONH = { "Content-Type": "application/json" };
  const sufijo = crypto.getRandomValues(new Uint32Array(1))[0];
  const evento = (n) => `prueba-${sufijo}-${n}`;
  const nuevoToken = () => b64(crypto.getRandomValues(new Uint8Array(16)));
  // Una sesión de mentira con la forma de la del proveedor (un JWT de tres partes): las rutas de Tus campañas no miran otra cosa.
  const sesionConForma = (nombre) => `${b64('{"alg":"ES256","typ":"JWT"}')}.${b64(JSON.stringify({ sub: `prueba-${nombre}`, n: nuevoToken() }))}.${b64(`firma-${nuevoToken()}`)}`;
  const ES_TOKEN_22 = /^[A-Za-z0-9_-]{22}$/;

  // Las cuentas y sus sesiones de mentira. Cada una con su sesión de Google y su billetera.
  const cuentas = {};
  const sesiones = {};
  const sesion = (nombre, byte, via = "google") => {
    cuentas[nombre] = cuentaDePrueba(byte);
    const token = sesionConForma(nombre);
    sesiones[token] = { userId: `usuario-${nombre}`, cuenta: cuentas[nombre], via };
    return token;
  };
  const S = { A: sesion("A", 31), A2: sesion("A2", 32), A3: sesion("A3", 33), B: sesion("B", 34), C: sesion("C", 35), G: sesion("G", 36, "email") };
  const CARRERAS = 8;
  // Cuántos milisegundos sale el sello después de la toma en cada vuelta (negativo: la toma sale después del sello). Así los dos
  // pedidos llegan casi juntos con los dos órdenes posibles.
  const ATRASO_DEL_SELLO = [-30, -15, -8, -4, 0, 4, 8, 15];
  for (let i = 0; i < CARRERAS; i++) S[`R${i}`] = sesion(`R${i}`, 50 + i);
  S.X = sesionConForma("X"); // con forma de sesión, pero el proveedor no la conoce
  const armado = await fetch(`${base}/__prueba/sesiones`, { method: "POST", headers: JSONH, body: JSON.stringify({ sesiones }) }).catch(() => null);
  if (!armado || armado.status !== 200) {
    check("tus campañas: el Worker local tiene la entrada de prueba (prueba-local/entrada.mjs)", false, armado ? String(armado.status) : "sin respuesta");
    return;
  }

  const firmar = (datos) => {
    const texto = JSON.stringify(datos);
    return { texto, firma: Buffer.from(ed25519.sign(new TextEncoder().encode(texto), secreto)).toString("base64url") };
  };
  /** El archivo firmado de una campaña. Con `cuenta` null no nombra organizadora. */
  const archivo = (nombre, cuenta, extra = {}) =>
    firmar({
      v: 1,
      evento: evento(nombre),
      red: "mainnet",
      abre_ms: Date.now() - 60_000,
      cierra_ms: Date.now() + 3_600_000,
      sorteo_ms: Date.now() + 7_200_000,
      premios: ["400000000"],
      zona: "America/La_Paz",
      empresa: { nombre: `Empresa ${nombre}` },
      ...(cuenta ? { organizadora: cuenta } : {}),
      ...extra,
    });
  /** Crea la sala con el token que inventa quien organiza (así se puede repetir el pedido). */
  const crearCampana = async (firmado, token = nuevoToken(), anterior = null) => {
    const r = await fetch(`${base}/v1/campana`, {
      method: "POST",
      headers: { ...JSONH, ...SITIO, ...(anterior ? { Authorization: `Bearer ${anterior}` } : {}) },
      body: JSON.stringify({ ...firmado, intento: token }),
    });
    return { estado: r.status, cuerpo: await r.json().catch(() => null), token };
  };

  const pedir = async (ruta, cuerpo, cabeceras = { ...JSONH, ...SITIO }) => {
    const r = await fetch(`${base}${ruta}`, { method: "POST", headers: cabeceras, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
    return { estado: r.status, cuerpo: await r.json().catch(() => null), cabeceras: r.headers };
  };
  const listar = (sesionToken) => pedir("/v1/mis-campanas", { sesion: sesionToken });
  const recuperar = (sesionToken, ev) => pedir("/v1/campana/recuperar", { sesion: sesionToken, evento: ev });
  const putFase = (id, token, fase, extra = {}) =>
    fetch(`${base}/v1/sala/${id}/campana/fase`, { method: "PUT", headers: { ...JSONH, ...auth(token) }, body: JSON.stringify({ fase, ...extra }) });
  const estadoDe = async (id, token = null) => {
    const r = await fetch(`${base}/v1/sala/${id}/campana/estado`, { headers: token ? auth(token) : SITIO });
    return { estado: r.status, cuerpo: await r.json().catch(() => null), cabeceras: r.headers };
  };
  const dePase = async (id, token) => (await fetch(`${base}/v1/sala/${id}/campana/pase`, { headers: auth(token) })).status;
  const cerrarSala = async (id, token) => (await fetch(`${base}/v1/sala/${id}`, { method: "DELETE", headers: auth(token) })).status;
  const ponerSello = (sorteo, organizer, ronda = 100_000_000, cuentasDeLaLista = []) =>
    fetch(`${base}/__prueba/sello`, { method: "POST", headers: JSONH, body: JSON.stringify({ sorteo, organizer, ronda, numWinners: 1, cuentas: cuentasDeLaLista }) });

  /** Todas las rutas con token que se prueban con el token viejo: ninguna lo acepta. */
  const rutasConToken = async (id, token, cuentaAviso) => {
    const [pase, fase, avisar, cerrar] = await Promise.all([
      fetch(`${base}/v1/sala/${id}/campana/pase`, { headers: auth(token) }),
      putFase(id, token, "abierta"),
      fetch(`${base}/v1/sala/${id}/campana/avisar`, { method: "POST", headers: { ...JSONH, ...auth(token) }, body: JSON.stringify({ cuenta: cuentaAviso }) }),
      fetch(`${base}/v1/sala/${id}`, { method: "DELETE", headers: auth(token) }),
    ]);
    const motivos = await Promise.all([pase, fase, avisar].map((r) => r.json().then((c) => c.error).catch(() => null)));
    return { estados: [pase.status, fase.status, avisar.status, cerrar.status], motivos };
  };

  const A = cuentas.A;

  // ---- 1. Los rechazos que no gastan nada, con los permisos de origen en cada respuesta.
  {
    const sinOrigen = await fetch(`${base}/v1/mis-campanas`, { method: "POST", headers: JSONH, body: JSON.stringify({ sesion: S.A }) });
    check("tus campañas: sin el origen del sitio da 403 origen", sinOrigen.status === 403 && (await sinOrigen.json()).error === "origen");
    const preflight = await fetch(`${base}/v1/mis-campanas`, { method: "OPTIONS", headers: { ...SITIO, "Access-Control-Request-Method": "POST" } });
    check("tus campañas: el permiso previo (OPTIONS) da 204 con los permisos", preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === "https://tinkazo.app");
    const otroMetodo = await fetch(`${base}/v1/mis-campanas`, { headers: SITIO });
    check("tus campañas: otro método da 404 con los permisos de origen", otroMetodo.status === 404 && otroMetodo.headers.get("access-control-allow-origin") === "https://tinkazo.app");
    const vacio = await pedir("/v1/mis-campanas", {});
    check("tus campañas: sin sesión da 400 forma, con permisos", vacio.estado === 400 && vacio.cuerpo?.error === "forma" && vacio.cabeceras.get("access-control-allow-origin") === "https://tinkazo.app", JSON.stringify(vacio.cuerpo));
    const basura = await listar("corta");
    check("tus campañas: una sesión sin forma de token da 401 sesion, con permisos", basura.estado === 401 && basura.cuerpo?.error === "sesion" && basura.cabeceras.get("access-control-allow-origin") === "https://tinkazo.app");
    const desconocida = await listar(S.X);
    check("tus campañas: una sesión con forma pero que el proveedor no conoce da 401 sesion", desconocida.estado === 401 && desconocida.cuerpo?.error === "sesion", JSON.stringify(desconocida.cuerpo));
    const noGoogle = await listar(S.G);
    check("tus campañas: quien no entró por Google da 403 no-google", noGoogle.estado === 403 && noGoogle.cuerpo?.error === "no-google", JSON.stringify(noGoogle.cuerpo));
    const malEvento = await recuperar(S.A, "Evento Mal!");
    check("recuperar: un evento con otra forma da 400 forma con el campo evento", malEvento.estado === 400 && malEvento.cuerpo?.error === "forma" && malEvento.cuerpo?.campo === "evento", JSON.stringify(malEvento.cuerpo));
    const sinSesion = await pedir("/v1/campana/recuperar", { evento: evento("x") });
    check("recuperar: sin sesión da 400 forma", sinSesion.estado === 400 && sinSesion.cuerpo?.error === "forma");
  }

  // ---- 2. Una campaña nueva: nace atada a su cuenta, y la lista la trae sin lo secreto.
  const firmado1 = archivo("uno", A);
  const T0 = nuevoToken();
  const c1 = await crearCampana(firmado1, T0);
  check("campaña: se crea (201) con la organizadora en el texto firmado", c1.estado === 201 && /^[0-9A-Za-z]{8}$/.test(c1.cuerpo?.id ?? ""), JSON.stringify(c1.cuerpo));
  if (c1.estado !== 201) return;
  const id1 = c1.cuerpo.id;
  const vence0 = c1.cuerpo.vence;
  const propia = await estadoDe(id1, T0);
  const ajena = await estadoDe(id1, nuevoToken());
  const sinToken = await estadoDe(id1);
  check("estado: con el token de la sala trae tuya true, con otro tuya false y sin token no la trae", propia.cuerpo?.tuya === true && ajena.cuerpo?.tuya === false && sinToken.cuerpo && !("tuya" in sinToken.cuerpo), JSON.stringify([propia.cuerpo?.tuya, ajena.cuerpo?.tuya, sinToken.cuerpo?.tuya]));
  check("estado: con el token nunca se guarda en la caché, sin token sí unos segundos", /no-store/.test(propia.cabeceras.get("cache-control") ?? "") && /max-age=2/.test(sinToken.cabeceras.get("cache-control") ?? ""), `${propia.cabeceras.get("cache-control")} | ${sinToken.cabeceras.get("cache-control")}`);
  check("estado: antes del sello no trae sorteo ni ronda", sinToken.cuerpo && !("sorteo" in sinToken.cuerpo) && !("ronda" in sinToken.cuerpo), JSON.stringify(sinToken.cuerpo));

  const lista1 = await listar(S.A);
  const fila1 = lista1.cuerpo?.campanas?.find((c) => c.evento === evento("uno"));
  check("lista: la cuenta ve su campaña viva en fase lista, con total 0", lista1.estado === 200 && fila1?.estado === "viva" && fila1?.fase === "lista" && fila1?.total === 0, JSON.stringify(fila1));
  check("lista: trae empresa, zona y las horas, y nunca el texto, la firma, el id ni el token", fila1?.empresa === "Empresa uno" && fila1?.zona === "America/La_Paz" && Number.isFinite(fila1?.abreMs) && Number.isFinite(fila1?.cierraMs) && Number.isFinite(fila1?.sorteoMs) && !/texto|firma|"id"|token|sala/.test(JSON.stringify(lista1.cuerpo)), JSON.stringify(fila1));
  const listaB = await listar(S.B);
  check("lista: otra cuenta no ve esa campaña (lista vacía, 200)", listaB.estado === 200 && listaB.cuerpo?.campanas?.length === 0, JSON.stringify(listaB.cuerpo));

  // ---- 3. La toma. Una pantalla presentada con el token viejo y otra sin presentar.
  const P0 = pantalla(id1);
  const P0sinPresentar = pantalla(id1);
  await Promise.all([P0.abierto, P0sinPresentar.abierto]);
  P0.ws.send(JSON.stringify({ t: "hola", token: T0 }));
  check("toma: la pantalla con el token de la sala se presenta", await esperar(() => P0.msgs.some((m) => m.t === "listo")), JSON.stringify(P0.msgs.slice(0, 2)));

  const deAjena = await recuperar(S.B, evento("uno"));
  const deInexistente = await recuperar(S.A, evento("no-existe"));
  check("recuperar: una campaña de otra cuenta y una que no existe dan lo mismo (404 no-existe)", deAjena.estado === 404 && deInexistente.estado === 404 && deAjena.cuerpo?.error === "no-existe" && JSON.stringify(deAjena.cuerpo) === JSON.stringify(deInexistente.cuerpo), `${JSON.stringify(deAjena.cuerpo)} ${JSON.stringify(deInexistente.cuerpo)}`);
  check("recuperar: el intento de otra cuenta no cambió el token de la sala", (await dePase(id1, T0)) === 200);

  const ahoraToma = Date.now();
  const toma1 = await recuperar(S.A, evento("uno"));
  const T1 = toma1.cuerpo?.token;
  check("toma: la cuenta dueña recibe estado viva con el id, un token nuevo, vence y la fase", toma1.estado === 200 && toma1.cuerpo?.estado === "viva" && toma1.cuerpo?.id === id1 && ES_TOKEN_22.test(T1 ?? "") && T1 !== T0 && toma1.cuerpo?.fase === "lista" && Number.isFinite(toma1.cuerpo?.vence), JSON.stringify({ ...toma1.cuerpo, token: T1 ? "…" : undefined }));
  check("toma: el vence es el de la sala (no se alargó ni se acortó)", Math.abs((toma1.cuerpo?.vence ?? 0) - vence0) <= 2000, `creación ${vence0}, toma ${toma1.cuerpo?.vence}`);
  check("toma: la pantalla presentada con el token viejo se cierra con 4001", await esperar(() => P0.est.cierre === 4001, 3000), String(P0.est.cierre));
  await sleep(300);
  check("toma: una conexión que nunca se presentó no se toca", P0sinPresentar.est.cierre === null, String(P0sinPresentar.est.cierre));
  const viejo1 = await rutasConToken(id1, T0, A);
  check("token viejo: pase, fase, avisar y cerrar la sala dan 403", viejo1.estados.every((e) => e === 403), JSON.stringify(viejo1.estados));
  check("token viejo: el motivo es token en las tres rutas que lo dicen", viejo1.motivos.every((m) => m === "token"), JSON.stringify(viejo1.motivos));
  check("token nuevo: la ruta del pase lo acepta (200)", (await dePase(id1, T1)) === 200);
  const nuevo1 = await estadoDe(id1, T1);
  const viejoEnEstado = await estadoDe(id1, T0);
  check("estado: tuya es true con el token nuevo y false con el viejo", nuevo1.cuerpo?.tuya === true && viejoEnEstado.cuerpo?.tuya === false);
  const P1 = pantalla(id1);
  await P1.abierto;
  P1.ws.send(JSON.stringify({ t: "hola", token: T1 }));
  check("toma: una pantalla nueva con el token nuevo se presenta y no se cierra", (await esperar(() => P1.msgs.some((m) => m.t === "listo"))) && P1.est.cierre === null);
  const pausa1 = await recuperar(S.A, evento("uno"));
  const espera1 = Number(pausa1.cabeceras.get("retry-after"));
  check("toma: otra enseguida da 429 pausa con cuánto esperar", pausa1.estado === 429 && pausa1.cuerpo?.error === "pausa" && espera1 >= 1 && espera1 <= 60, `${pausa1.estado} ${JSON.stringify(pausa1.cuerpo)} retry-after ${pausa1.cabeceras.get("retry-after")}`);
  check("toma: la que se frenó no cambió nada: el token nuevo sigue valiendo y la pantalla sigue abierta", (await dePase(id1, T1)) === 200 && P1.est.cierre === null);
  check("toma: con el token nuevo se abre la campaña (204)", (await putFase(id1, T1, "abierta")).status === 204);
  const enLista = (await listar(S.A)).cuerpo?.campanas?.find((c) => c.evento === evento("uno"));
  check("lista: después de la toma sigue viva y con la fase nueva", enLista?.estado === "viva" && enLista?.fase === "abierta", JSON.stringify(enLista));

  // ---- 4. La sellada que no se toma, y el sellado que no se reemplaza. (Mientras corre la pausa de 60 s de la campaña uno.)
  const A2 = cuentas.A2;
  const firmado2 = archivo("dos", A2);
  const T2 = nuevoToken();
  const c2 = await crearCampana(firmado2, T2);
  const id2 = c2.cuerpo?.id;
  check("sellada: la campaña dos se crea", c2.estado === 201, JSON.stringify(c2.cuerpo));
  if (c2.estado === 201) {
    check("sellada: se abre y se cierra con su token", (await putFase(id2, T2, "abierta")).status === 204 && (await putFase(id2, T2, "cerrada")).status === 204);
    await sleep(2200);
    // La caché del borde: una lectura pública sin token se recuerda 2 segundos, aunque el estado cambie en el medio.
    const lecturaA = await estadoDe(id2);
    await putFase(id2, T2, "abierta");
    const lecturaB = await estadoDe(id2);
    const conTokenAhora = await estadoDe(id2, T2);
    check("caché: la lectura pública repetida enseguida repite lo guardado, y con token ve lo de ahora", lecturaA.cuerpo?.fase === "cerrada" && lecturaB.cuerpo?.fase === "cerrada" && conTokenAhora.cuerpo?.fase === "abierta", `${lecturaA.cuerpo?.fase} ${lecturaB.cuerpo?.fase} con token ${conTokenAhora.cuerpo?.fase}`);
    await sleep(2300);
    check("caché: pasados 2 segundos la lectura pública ve lo de ahora", (await estadoDe(id2)).cuerpo?.fase === "abierta");
    check("sellada: se vuelve a cerrar con su token", (await putFase(id2, T2, "cerrada")).status === 204);
    await sleep(2300);
    const previoCache = await estadoDe(id2);
    check("sellada: sin sello armado, sellar da 409 sin-sorteo", await (async () => { const r = await putFase(id2, T2, "sellada", { sorteo: "4242" }); return r.status === 409 && (await r.json()).error === "sin-sorteo"; })());
    await ponerSello("4242", A2);
    await ponerSello("4243", cuentas.B);
    const otroSorteo = await putFase(id2, T2, "sellada", { sorteo: "4243" });
    check("sellada: un sello de otra organizadora da 409 organizador-distinto", otroSorteo.status === 409 && (await otroSorteo.json()).error === "organizador-distinto");
    const viejoSello = await putFase(id2, T0, "sellada", { sorteo: "4242" });
    check("sellada: sellar con un token que no es de esta sala da 403 token", viejoSello.status === 403 && (await viejoSello.json()).error === "token");
    const sellada = await putFase(id2, T2, "sellada", { sorteo: "4242" });
    check("sellada: con el sello leído de la red (imitada) la campaña se sella (204)", sellada.status === 204, String(sellada.status));
    const conToken = await estadoDe(id2, T2);
    check("sellada: el estado trae sorteo y ronda del sello y tuya true", conToken.cuerpo?.fase === "sellada" && conToken.cuerpo?.sorteo === "4242" && conToken.cuerpo?.ronda === 100_000_000 && conToken.cuerpo?.tuya === true, JSON.stringify(conToken.cuerpo));
    const ahoraCache = await estadoDe(id2);
    await sleep(2300);
    const despuesCache = await estadoDe(id2);
    console.log(`INFO caché: antes de sellar el público decía ${previoCache.cuerpo?.fase}, un instante después ${ahoraCache.cuerpo?.fase}, a los 2,3 s ${despuesCache.cuerpo?.fase}`);
    check("sellada: el estado público, pasados los 2 segundos de la caché, ya dice sellada con sorteo y ronda", despuesCache.cuerpo?.fase === "sellada" && despuesCache.cuerpo?.sorteo === "4242" && despuesCache.cuerpo?.ronda === 100_000_000, JSON.stringify(despuesCache.cuerpo));
    const tomaSellada = await recuperar(S.A2, evento("dos"));
    check("sellada: una sala sellada no se toma (409 sellada)", tomaSellada.estado === 409 && tomaSellada.cuerpo?.error === "sellada", JSON.stringify(tomaSellada.cuerpo));
    check("sellada: el token de quien organiza no cambió", (await estadoDe(id2, T2)).cuerpo?.tuya === true);
    const enListaSellada = (await listar(S.A2)).cuerpo?.campanas?.find((c) => c.evento === evento("dos"));
    check("sellada: la lista la muestra viva en fase sellada", enListaSellada?.estado === "viva" && enListaSellada?.fase === "sellada", JSON.stringify(enListaSellada));

    check("sellado: cerrar la sala sellada con su token (204)", (await cerrarSala(id2, T2)) === 204);
    const terminada = await recuperar(S.A2, evento("dos"));
    check("sellado: recuperar un evento sellado, con la sala ya cerrada, da 409 terminada", terminada.estado === 409 && terminada.cuerpo?.error === "terminada", JSON.stringify(terminada.cuerpo));
    const enListaTerminada = (await listar(S.A2)).cuerpo?.campanas?.find((c) => c.evento === evento("dos"));
    check("sellado: la lista la muestra terminada", enListaTerminada?.estado === "terminada", JSON.stringify(enListaTerminada));
    const reemplazo = await crearCampana(firmado2, nuevoToken(), T2);
    check("sellado: un evento sellado no se reemplaza ni con el token de su sala (409 ya-existe)", reemplazo.estado === 409 && reemplazo.cuerpo?.error === "ya-existe", JSON.stringify(reemplazo.cuerpo));
  }

  // ---- 5. Una sala cerrada que no se selló se recupera, y se crea de nuevo con el token que da el servidor.
  {
    const firmado3 = archivo("tres", A2);
    const T3 = nuevoToken();
    const c3 = await crearCampana(firmado3, T3);
    check("sala muerta: la campaña tres se crea", c3.estado === 201, JSON.stringify(c3.cuerpo));
    if (c3.estado === 201) {
      const repetida = await crearCampana(firmado3, nuevoToken());
      check("sala viva: crear la misma otra vez sin su token da 409 ya-existe", repetida.estado === 409 && repetida.cuerpo?.error === "ya-existe");
      check("sala muerta: se cierra la sala con su token (204)", (await cerrarSala(c3.cuerpo.id, T3)) === 204);
      const enLista = (await listar(S.A2)).cuerpo?.campanas?.find((c) => c.evento === evento("tres"));
      check("sala muerta: la lista la muestra activada", enLista?.estado === "activada", JSON.stringify(enLista));
      const ajenaMuerta = await recuperar(S.B, evento("tres"));
      check("sala muerta: otra cuenta recibe 404 no-existe", ajenaMuerta.estado === 404 && ajenaMuerta.cuerpo?.error === "no-existe");
      const recup = await recuperar(S.A2, evento("tres"));
      const anterior = recup.cuerpo?.anterior;
      check("sala muerta: la dueña recibe activada con el texto firmado igual, la firma y un token anterior", recup.estado === 200 && recup.cuerpo?.estado === "activada" && recup.cuerpo?.texto === firmado3.texto && recup.cuerpo?.firma === firmado3.firma && ES_TOKEN_22.test(anterior ?? ""), JSON.stringify({ ...recup.cuerpo, anterior: anterior ? "…" : undefined, texto: undefined }));
      const sinBearer = await crearCampana(firmado3, nuevoToken());
      check("sala muerta: crear la sala sin ese token sigue dando 409 ya-existe", sinBearer.estado === 409);
      const nueva = await crearCampana({ texto: recup.cuerpo?.texto, firma: recup.cuerpo?.firma }, nuevoToken(), anterior);
      check("sala muerta: con ese token anterior la sala se crea de nuevo (201)", nueva.estado === 201 && nueva.cuerpo?.id !== c3.cuerpo.id, JSON.stringify(nueva.cuerpo));
      if (nueva.estado === 201) {
        check("sala muerta: la sala nueva responde a su token", (await dePase(nueva.cuerpo.id, nueva.token)) === 200);
        const otraVez = await recuperar(S.A2, evento("tres"));
        check("sala muerta: recuperar con la sala nueva viva es una toma (200 viva, otro token)", otraVez.estado === 200 && otraVez.cuerpo?.estado === "viva" && otraVez.cuerpo?.id === nueva.cuerpo.id && otraVez.cuerpo?.token !== nueva.token, JSON.stringify({ ...otraVez.cuerpo, token: undefined }));
        await cerrarSala(nueva.cuerpo.id, otraVez.cuerpo?.token ?? nueva.token);
      }
    }
  }

  // ---- 6. Una sala firmada sin organizadora queda en manos de quien tiene su token.
  {
    const T4 = nuevoToken();
    const c4 = await crearCampana(archivo("cuatro", null), T4);
    check("sin organizadora: la campaña cuatro se crea", c4.estado === 201, JSON.stringify(c4.cuerpo));
    if (c4.estado === 201) {
      const r = await recuperar(S.A3, evento("cuatro"));
      check("sin organizadora: ninguna cuenta la toma (404 no-existe)", r.estado === 404 && r.cuerpo?.error === "no-existe", JSON.stringify(r.cuerpo));
      check("sin organizadora: su token sigue valiendo", (await dePase(c4.cuerpo.id, T4)) === 200);
      const lista = (await listar(S.A3)).cuerpo?.campanas ?? [];
      check("sin organizadora: no sale en la lista de nadie", !lista.some((c) => c.evento === evento("cuatro")));
      await cerrarSala(c4.cuerpo.id, T4);
    }
  }

  // ---- 7. Los topes por cuenta: 10 tomas cada 10 minutos.
  {
    let ultimo = null;
    let hechas = 0;
    for (let i = 0; i < 12 && !ultimo; i++) {
      const r = await recuperar(S.C, evento(`inexistente-${i}`));
      if (r.estado === 404) hechas++;
      else ultimo = { estado: r.estado, error: r.cuerpo?.error, espera: Number(r.cabeceras.get("retry-after")) };
    }
    check("tope: una cuenta hace 10 tomas en 10 minutos y la siguiente da 429 cupo-cuenta con Retry-After", hechas === 10 && ultimo?.estado === 429 && ultimo?.error === "cupo-cuenta" && ultimo.espera > 0 && ultimo.espera <= 600, `hizo ${hechas}, ${JSON.stringify(ultimo)}`);
    let listadas = 0;
    let frenada = null;
    for (let i = 0; i < 32 && !frenada; i++) {
      const r = await listar(S.C);
      if (r.estado === 200) listadas++;
      else frenada = { estado: r.estado, error: r.cuerpo?.error };
    }
    check("tope: una cuenta lista 30 veces en 10 minutos y la siguiente da 429 cupo-cuenta", listadas === 30 && frenada?.estado === 429 && frenada?.error === "cupo-cuenta", `listó ${listadas}, ${JSON.stringify(frenada)}`);
  }

  // ---- 8. Toma contra sello: nunca las dos. Cada vuelta con su cuenta (el tope por cuenta es de 10 tomas).
  {
    const resultados = { sello: 0, toma: 0 };
    let siempreUna = true;
    let coherente = true;
    const detalle = [];
    for (let i = 0; i < CARRERAS; i++) {
      const cuenta = cuentas[`R${i}`];
      const firmado = archivo(`carrera-${i}`, cuenta);
      const T = nuevoToken();
      const c = await crearCampana(firmado, T);
      if (c.estado !== 201) {
        siempreUna = false;
        detalle.push(`crear ${c.estado}`);
        continue;
      }
      const id = c.cuerpo.id;
      await putFase(id, T, "abierta");
      await putFase(id, T, "cerrada");
      const sorteo = String(5000 + i);
      await ponerSello(sorteo, cuenta);
      const atraso = ATRASO_DEL_SELLO[i] ?? 0;
      const [sello, toma] = await Promise.all([
        sleep(Math.max(0, atraso)).then(() => putFase(id, T, "sellada", { sorteo })),
        sleep(Math.max(0, -atraso)).then(() => recuperar(S[`R${i}`], evento(`carrera-${i}`))),
      ]);
      const selloOk = sello.status === 204;
      const tomaOk = toma.estado === 200;
      detalle.push(`sello ${sello.status} toma ${toma.estado}${toma.cuerpo?.error ? ` ${toma.cuerpo.error}` : ""}`);
      if (selloOk === tomaOk) siempreUna = false;
      const final = await estadoDe(id, T);
      const finalNuevo = tomaOk ? await estadoDe(id, toma.cuerpo.token) : null;
      if (selloOk) {
        resultados.sello++;
        if (!(toma.estado === 409 && toma.cuerpo?.error === "sellada" && final.cuerpo?.fase === "sellada" && final.cuerpo?.tuya === true)) coherente = false;
      } else if (tomaOk) {
        resultados.toma++;
        const motivo = await sello.json().catch(() => null);
        if (!(sello.status === 403 && motivo?.error === "token" && final.cuerpo?.tuya === false && finalNuevo?.cuerpo?.tuya === true && finalNuevo.cuerpo?.fase === "cerrada")) coherente = false;
      }
      await cerrarSala(id, tomaOk ? toma.cuerpo.token : T);
    }
    check("carrera toma contra sello: en cada vuelta ganó una sola de las dos", siempreUna, detalle.join(" | "));
    check("carrera toma contra sello: el resultado es coherente (sellada con el token de siempre, o tomada con la fase cerrada y el token viejo sin efecto)", coherente, `${resultados.sello} veces el sello y ${resultados.toma} veces la toma`);
    console.log(`INFO carrera toma contra sello: el sello ganó ${resultados.sello} veces y la toma ${resultados.toma}`);
  }

  // ---- 9. Toma contra toma, cuando pasó la pausa de la campaña uno: gana una sola y las demás no cambian nada.
  {
    const falta = ahoraToma + 61_500 - Date.now();
    if (falta > 0) {
      console.log(`INFO esperando ${Math.ceil(falta / 1000)} s a que pase la pausa de 60 segundos entre tomas`);
      await sleep(falta);
    }
    const tres = await Promise.all([recuperar(S.A, evento("uno")), recuperar(S.A, evento("uno")), recuperar(S.A, evento("uno"))]);
    const buenas = tres.filter((r) => r.estado === 200);
    const resto = tres.filter((r) => r.estado !== 200);
    check("toma contra toma: de tres pedidos a la vez sale un solo token", buenas.length === 1, tres.map((r) => `${r.estado}${r.cuerpo?.error ? ` ${r.cuerpo.error}` : ""}`).join(" | "));
    check("toma contra toma: los otros dos dicen pausa u ocupado, con permisos", resto.length === 2 && resto.every((r) => (r.estado === 429 && r.cuerpo?.error === "pausa") || (r.estado === 409 && r.cuerpo?.error === "ocupado")), JSON.stringify(resto.map((r) => [r.estado, r.cuerpo?.error])));
    const T2 = buenas[0]?.cuerpo?.token;
    check("toma contra toma: el token ganador vale y el anterior ya no", ES_TOKEN_22.test(T2 ?? "") && (await dePase(id1, T2)) === 200 && (await dePase(id1, T1)) === 403, "");
    check("toma contra toma: la pantalla presentada con el token anterior se cierra con 4001", await esperar(() => P1.est.cierre === 4001, 3000), String(P1.est.cierre));
    check("toma contra toma: el token de antes de la primera toma tampoco vuelve", (await dePase(id1, T0)) === 403);
    check("toma contra toma: el vence sigue siendo el de la sala", Math.abs((buenas[0]?.cuerpo?.vence ?? 0) - vence0) <= 2000, `${buenas[0]?.cuerpo?.vence} contra ${vence0}`);
    await cerrarSala(id1, T2 ?? T1);
  }

  // ---- 10. Nada salió de la máquina: solo los dos servidores imitados.
  {
    const salidas = await (await fetch(`${base}/__prueba/salidas`)).json();
    const extranas = salidas.hosts.filter((h) => h !== "server.api.pollar.xyz" && h !== "rpc.prueba.invalid");
    check("sin salidas: el Worker no llamó a ningún servidor que no fuera una imitación", extranas.length === 0, JSON.stringify(salidas.hosts));
  }
}

if (soloTus) {
  await probarTusCampanas();
  console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo en verde");
  process.exit(fallas ? 1 : 0);
}

// 1. La página del celular.
const pag = await fetch(`${base}/AbCd1234`);
const html = await pag.text();
const gz = gzipSync(html).length;
check("la página del celular abre", pag.status === 200 && /text\/html/.test(pag.headers.get("content-type") ?? ""));
check("la página pesa menos de 15 KB comprimida", gz < 15 * 1024, `${gz} bytes con gzip, ${html.length} sin comprimir`);
check("la página lleva su política de contenido y no se indexa", /default-src 'none'/.test(pag.headers.get("content-security-policy") ?? "") && /noindex/.test(pag.headers.get("x-robots-tag") ?? ""));
check("el aviso de privacidad está en la página en español y en inglés", html.includes("y se borra cuando cierran la sala o a las 10 horas.") && html.includes("is deleted when the room is closed or after 10 hours.") && html.includes("https://tinkazo.app/terminos.html"));
check("una ruta que no es un id da 404", (await fetch(`${base}/hola`)).status === 404);

// 2. Crear una sala: solo desde el sitio.
check("crear sin origen del sitio da 403", (await fetch(`${base}/v1/sala`, { method: "POST" })).status === 403);
check("crear desde otro origen da 403", (await fetch(`${base}/v1/sala`, { method: "POST", headers: { Origin: "https://ejemplo.com" } })).status === 403);
const r1 = await crear();
check("crear desde tinkazo.app da 201", r1.status === 201);
const { id, token } = await r1.json();
check("id de 8 caracteres y token de 22", /^[0-9A-Za-z]{8}$/.test(id) && /^[A-Za-z0-9_-]{22}$/.test(token));
const clave = b64(crypto.getRandomValues(new Uint8Array(16)));

/** La alarma: con una vida corta (`--var VIDA_PRUEBA_MS:4000`) la sala vence sola. Con la vida larga no se puede probar. */
async function probarAlarma() {
  const r2 = await crear();
  if (r2.status === 201) {
    const s2 = await r2.json();
    const vida = s2.vence - Date.now();
    await post(s2.id, "Carla");
    if (vida < 60_000) {
      await sleep(vida + 2500);
      const a = (await post(s2.id, "Dani")).status;
      const b = (await fetch(`${base}/v1/sala/${s2.id}/nombres`, { headers: auth(s2.token) })).status;
      check("la alarma borra la sala sola", a === 404 && b === 404, `venció a los ${Math.round(vida / 1000)} s de prueba`);
    } else {
      console.log("NO PROBADO la alarma: la sala vive más de un minuto. Probala aparte con --var VIDA_PRUEBA_MS:4000 y --alarma");
      await fetch(`${base}/v1/sala/${s2.id}`, { method: "DELETE", headers: auth(s2.token) });
    }
  } else console.log("NO PROBADO la alarma: el cupo de salas no dejó crear otra", r2.status);
}

if (soloAlarma) {
  await probarAlarma();
  console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo en verde");
  process.exit(fallas ? 1 : 0);
}

// 3. Los nombres. Se espera al comienzo de un minuto para que las altas de esta parte
// y las 245 del tope por minuto caigan en la misma ventana, también contra producción.
await sleep(61_000 - (Date.now() % 60_000));
check("una forma que no es un alta da 400", (await postPlano(id, "hola mundo!")).status === 400);
check("un cuerpo demasiado largo da 413", (await postPlano(id, "A".repeat(701))).status === 413);
check("una sala que no existe da 404", (await post("Zz9Zz9Zz", "Ana")).status === 404);
const llaveAna = nuevaLlave();
const ana = await post(id, "Ana", llaveAna);
check("un nombre cifrado entra (201)", ana.status === 201);
const nAna = (await ana.json()).n;
const anaRepetida = await post(id, " ana ", nuevaLlave());
check("el mismo nombre desde otro celular da 409 repetido", anaRepetida.status === 409 && (await anaRepetida.json()).error === "repetido");
const anaCorregida = await post(id, "Ana Pérez", llaveAna);
const correccion = await anaCorregida.json();
check("la misma llave corrige (200), deja una sola fila y trae el número anterior", anaCorregida.status === 200 && correccion.n !== nAna && correccion.r?.[0] === nAna);
const listaTrasCorregir = await (await fetch(`${base}/v1/sala/${id}/nombres?desde=0`, { headers: auth(token) })).json();
check("la corrección quedó una sola vez y la consulta también trae r", listaTrasCorregir.length === 1 && listaTrasCorregir[0].r?.[0] === nAna);
check("sin token no se leen los nombres", (await fetch(`${base}/v1/sala/${id}/nombres`, { headers: SITIO })).status === 403);
check("con otro token tampoco", (await fetch(`${base}/v1/sala/${id}/nombres`, { headers: auth(b64(crypto.getRandomValues(new Uint8Array(16)))) })).status === 403);
const lista = await (await fetch(`${base}/v1/sala/${id}/nombres?desde=0`, { headers: auth(token) })).json();
check("con el token se leen, cifrados", lista.length === 1 && !JSON.stringify(lista).includes("Ana"), JSON.stringify(lista).slice(0, 60));
check("y se descifran con la clave que solo tiene el QR", (await descifrar(clave, lista[0].d)) === "Ana Pérez");

// 4. La pantalla por WebSocket.
const p1 = pantalla(id);
await p1.abierto;
p1.ws.send(JSON.stringify({ t: "hola", token: "no-es-el-token" }));
check("un socket con un token que no es cierra con 4401", await esperar(() => p1.est.cierre === 4401), String(p1.est.cierre));
const p2 = pantalla(id);
await p2.abierto;
p2.ws.send(JSON.stringify({ t: "hola", token }));
check("con el token queda listo y dice cuántos hay", await esperar(() => p2.msgs.some((m) => m.t === "listo" && m.hay === 1)));
const beto = await post(id, "Beto");
const nBeto = (await beto.json()).n;
check("un nombre nuevo le llega al instante a la pantalla", await esperar(() => p2.msgs.some((m) => m.t === "nombre" && m.n === nBeto)));
const llegado = p2.msgs.find((m) => m.t === "nombre");
check("lo que llega por el socket también va cifrado", (await descifrar(clave, llegado.d)) === "Beto");
const p3 = pantalla(id);
await p3.abierto;
p3.ws.send(JSON.stringify({ t: "hola", token }));
check("una pantalla nueva desplaza a la anterior (una sola)", await esperar(() => p2.est.cierre === 4000), String(p2.est.cierre));
p3.ws.send("ping");
check("un ping se contesta solo con pong, sin despertar la lógica", await esperar(() => p3.msgs.some((m) => m.t === "pong")));

// 5. Quitar un nombre, también en el objeto.
check("sin token no se quita", (await fetch(`${base}/v1/sala/${id}/nombres/${nBeto}`, { method: "DELETE", headers: SITIO })).status === 403);
check("con el token se quita (204)", (await fetch(`${base}/v1/sala/${id}/nombres/${nBeto}`, { method: "DELETE", headers: auth(token) })).status === 204);
check("y la pantalla se entera", await esperar(() => p3.msgs.some((m) => m.t === "quitado" && m.n === nBeto)));
const despues = await (await fetch(`${base}/v1/sala/${id}/nombres?desde=0`, { headers: auth(token) })).json();
check("y ya no está en el objeto", despues.length === 1 && despues[0].n !== nBeto);

// 6. Tope por minuto: 240 nombres por sala (ya van 2).
let ok = 2;
let rapido = 0;
// De a 25 en paralelo: contra producción cada pedido tarda y, de a uno, la tanda cruzaría el
// cambio de minuto sin que el tope frene a nadie.
for (let i = 0; i < 245; i += 25) {
  const tanda = [];
  for (let j = i; j < Math.min(245, i + 25); j++) tanda.push(post(id, `Persona ${j}`));
  const salidas = await Promise.all(tanda);
  for (const r of salidas) {
    if (r.status === 201) ok++;
    else if (r.status === 429 && (await r.json()).error === "rapido") rapido++;
  }
}
// La primera alta, el repetido y la corrección también gastaron tres lugares de esta ventana.
check("el tope es de 240 nombres por minuto por sala", ok >= 236 && ok <= 240 && rapido >= 7, `entraron ${ok}, frenados ${rapido}`);

// 6b. Los equipos: el registro con cuenta de equipos.html. El tope por minuto de los nombres ya se gastó: se espera a que pase.
{
  await sleep(61_000 - (Date.now() % 60_000));
  const A = cuentaDePrueba(1);
  const B = cuentaDePrueba(2);
  const EVENTO = cuentaDePrueba(3);
  // Una dirección de la forma correcta pero con la última letra cambiada: el control no cuadra.
  const MAL_ESCRITA = `${A.slice(0, 55)}${A[55] === "A" ? "B" : "A"}`;
  // Cada cuenta, desde su celular: la llave con que se anotó es la única que la puede reescribir.
  const llaves = { [A]: nuevaLlave(), [B]: nuevaLlave() };
  const config = { modo: "sorteo", evento: "space-apps-scz-2026", cuenta: EVENTO };
  const json = { "Content-Type": "application/json" };
  const putConfig = (tok, cuerpo) => fetch(`${base}/v1/sala/${id}/config`, { method: "PUT", headers: { ...json, ...(tok ? auth(tok) : SITIO) }, body: JSON.stringify(cuerpo) });
  const altaEquipo = (cuenta, d, headers = SITIO, llave = llaves[cuenta] ?? nuevaLlave(), sala = id) =>
    fetch(`${base}/v1/sala/${sala}/equipos`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ cuenta, d, llave }) });
  const equiposCifrados = async (nombre, integrantes) => cifrar(clave, JSON.stringify({ n: nombre, i: integrantes }));

  check("sin token no se arma el registro (403)", (await putConfig(null, config)).status === 403);
  check("una configuración mala da 400 (un modo que no existe, una cuenta que no es)", (await putConfig(token, { ...config, modo: "sena" })).status === 400 && (await putConfig(token, { ...config, cuenta: "GMALA" })).status === 400 && (await putConfig(token, { ...config, cuenta: MAL_ESCRITA })).status === 400);
  const antes = await (await fetch(`${base}/v1/sala/${id}/publico`, { headers: SITIO })).json();
  check("antes de armarlo, la sala dice que no hay registro", antes.config === null && antes.equipos === 0, JSON.stringify(antes));
  check("anotar un equipo sin registro armado da 409", (await altaEquipo(A, await equiposCifrados("Cóndores", ["Ana", "Beto"]))).status === 409);
  check("con el token se arma el registro (204)", (await putConfig(token, config)).status === 204);
  const publico = await (await fetch(`${base}/v1/sala/${id}/publico`, { headers: SITIO })).json();
  check("cualquiera con el enlace ve cómo es el registro, sin token", publico.config?.modo === "sorteo" && publico.config?.cuenta === EVENTO && publico.equipos === 0, JSON.stringify(publico));

  check("anotar sin el origen del sitio da 403", (await altaEquipo(A, await equiposCifrados("X", ["a", "b"]), {})).status === 403);
  check("anotar con una cuenta que no es da 400", (await altaEquipo("GMALA", await equiposCifrados("X", ["a", "b"]))).status === 400);
  check("anotar con una cuenta mal copiada (el control no cuadra) da 400", (await altaEquipo(MAL_ESCRITA, await equiposCifrados("X", ["a", "b"]))).status === 400);
  check("anotar con datos que no son un equipo cifrado da 400", (await altaEquipo(A, "hola mundo!")).status === 400);
  check("anotar sin la llave del celular da 400", (await fetch(`${base}/v1/sala/${id}/equipos`, { method: "POST", headers: { ...json, ...SITIO }, body: JSON.stringify({ cuenta: A, d: await equiposCifrados("X", ["a", "b"]) }) })).status === 400);
  check("anotar con una llave que no es da 400", (await altaEquipo(A, await equiposCifrados("X", ["a", "b"]), SITIO, "corta")).status === 400);

  const lleg = p3.msgs.length;
  const alta = await altaEquipo(A, await equiposCifrados("Los Cóndores", ["Ana", "Beto", "Carla"]));
  const altaJson = await alta.json();
  check("un equipo se anota (201) y con sorteo propio queda como solicitud", alta.status === 201 && altaJson.estado === "solicitud" && Number.isInteger(altaJson.n), JSON.stringify(altaJson));
  check("la pantalla recibe el equipo al instante, con la cuenta en claro y lo demás cifrado", await esperar(() => p3.msgs.slice(lleg).some((m) => m.t === "equipo" && m.cuenta === A && !JSON.stringify(m).includes("Cóndores"))));
  const re = await (await altaEquipo(A, await equiposCifrados("Los Cóndores 2", ["Ana", "Beto"]))).json();
  check("la misma cuenta otra vez, con su llave, cambia los datos y conserva el número y el estado", re.n === altaJson.n && re.estado === "solicitud", JSON.stringify(re));
  const lPisar = p3.msgs.length;
  const pisar = await altaEquipo(A, await equiposCifrados("Pisado", ["Intruso", "Otro"]), SITIO, nuevaLlave());
  check("con otra llave no se pisa una cuenta anotada (409 ajena)", pisar.status === 409 && (await pisar.json()).error === "ajena");
  await sleep(300);
  check("y la pantalla no recibe nada de ese intento", !p3.msgs.slice(lPisar).some((m) => m.t === "equipo"));
  const segundo = await (await altaEquipo(B, await equiposCifrados("Pumas", ["Dani", "Eva"]))).json();
  check("otra cuenta es otro equipo, con otro número", segundo.n !== altaJson.n);

  check("sin token no se leen los equipos (403)", (await fetch(`${base}/v1/sala/${id}/equipos?desde=0`, { headers: SITIO })).status === 403);
  const todos = await (await fetch(`${base}/v1/sala/${id}/equipos?desde=0`, { headers: auth(token) })).json();
  check("con el token se leen, cifrados", todos.length === 2 && !JSON.stringify(todos).includes("Pumas") && !JSON.stringify(todos).includes("Cóndores"), `${todos.length} equipos`);
  const delA = todos.find((e) => e.cuenta === A);
  check("y se descifran con la clave que solo tiene el QR: siguen los datos de su celular, no los del intento", JSON.parse(await descifrar(clave, delA.d)).n === "Los Cóndores 2");
  const vMax = Math.max(...todos.map((e) => e.v));

  const unoA = await (await fetch(`${base}/v1/sala/${id}/equipos/${A}`, { headers: SITIO })).json();
  check("el celular del equipo pregunta en qué punto está, sin token", unoA.n === altaJson.n && unoA.estado === "solicitud", JSON.stringify(unoA));
  check("una cuenta que no se anotó da 404", (await fetch(`${base}/v1/sala/${id}/equipos/GDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HZDQP`, { headers: SITIO })).status === 404);

  const putEstado = (tok, n, estado) => fetch(`${base}/v1/sala/${id}/equipos/${n}`, { method: "PUT", headers: { ...json, ...(tok ? auth(tok) : SITIO) }, body: JSON.stringify({ estado }) });
  check("sin token no se cambia el estado (403)", (await putEstado(null, altaJson.n, "aceptado")).status === 403);
  check("un estado que no existe (la seña ya no está) da 400", (await putEstado(token, altaJson.n, "sena")).status === 400);
  const l2 = p3.msgs.length;
  check("con el token se acepta (204)", (await putEstado(token, altaJson.n, "aceptado")).status === 204);
  check("la pantalla se entera del cambio", await esperar(() => p3.msgs.slice(l2).some((m) => m.t === "equipo" && m.cuenta === A && m.estado === "aceptado")));
  const aceptado = await (await fetch(`${base}/v1/sala/${id}/equipos/${A}`, { headers: SITIO })).json();
  check("y el celular del equipo lo ve", aceptado.estado === "aceptado");
  const cambio = await (await fetch(`${base}/v1/sala/${id}/equipos?desde=${vMax}`, { headers: auth(token) })).json();
  check("consultar desde la última versión trae solo lo que cambió", cambio.length === 1 && cambio[0].cuenta === A && cambio[0].estado === "aceptado", JSON.stringify(cambio.map((e) => e.estado)));
  check("un equipo que no existe da 404 al cambiarle el estado", (await putEstado(token, 9999, "cupon")).status === 404);

  const l3 = p3.msgs.length;
  check("sin token no se quita un equipo (403)", (await fetch(`${base}/v1/sala/${id}/equipos/${segundo.n}`, { method: "DELETE", headers: SITIO })).status === 403);
  check("con el token se quita (204)", (await fetch(`${base}/v1/sala/${id}/equipos/${segundo.n}`, { method: "DELETE", headers: auth(token) })).status === 204);
  check("la pantalla se entera", await esperar(() => p3.msgs.slice(l3).some((m) => m.t === "equipo-quitado" && m.n === segundo.n)));
  check("y ya no figura (404)", (await fetch(`${base}/v1/sala/${id}/equipos/${B}`, { headers: SITIO })).status === 404);
  check("quitado, la cuenta se puede anotar desde otro celular (201)", (await altaEquipo(B, await equiposCifrados("Pumas", ["Dani", "Eva"]), SITIO, nuevaLlave())).status === 201);

  // Una sala nueva sin registro no deja anotar a nadie.
  const r3 = await crear();
  if (r3.status === 201) {
    const s3 = await r3.json();
    const sinRegistro = await altaEquipo(A, await equiposCifrados("X", ["a", "b"]), SITIO, nuevaLlave(), s3.id);
    check("una sala sin registro armado no deja anotar (409)", sinRegistro.status === 409);
    await fetch(`${base}/v1/sala/${s3.id}/config`, { method: "PUT", headers: { ...json, ...auth(s3.token) }, body: JSON.stringify({ ...config, modo: "cupon" }) });
    const directo = await (await altaEquipo(A, await equiposCifrados("X", ["a", "b"]), SITIO, nuevaLlave(), s3.id)).json();
    check("con el cupón gratis el equipo queda aceptado directamente", directo.estado === "aceptado", JSON.stringify(directo));
    // El tope por conexión: 60 equipos nuevos cada 10 minutos desde una misma dirección (ya va uno).
    let nuevos = 1;
    let frenado = null;
    for (let i = 10; i < 80 && !frenado; i++) {
      const r = await altaEquipo(cuentaDePrueba(i), await equiposCifrados(`E${i}`, ["a", "b"]), SITIO, nuevaLlave(), s3.id);
      if (r.status === 201) nuevos++;
      else frenado = { status: r.status, error: (await r.json()).error, espera: Number(r.headers.get("Retry-After")) };
    }
    check(
      "una sola conexión anota 60 equipos y el siguiente da 429 cupo-conexion, con cuánto esperar",
      nuevos === 60 && frenado?.status === 429 && frenado.error === "cupo-conexion" && frenado.espera > 0 && frenado.espera <= 600,
      `entraron ${nuevos}, ${JSON.stringify(frenado)}`,
    );
    await fetch(`${base}/v1/sala/${s3.id}`, { method: "DELETE", headers: auth(s3.token) });
    check("al cerrar la sala se van también los equipos (404)", (await fetch(`${base}/v1/sala/${s3.id}/equipos/${A}`, { headers: SITIO })).status === 404);
  } else console.log("NO PROBADO el cupón gratis: el cupo de salas no dejó crear otra", r3.status);
}

// 6c. Las campañas firmadas. Solo en local: ni con la variable puesta se escribe una campaña contra producción.
const produccion = new URL(base).hostname === "s.tinkazo.app";
if (process.env.CAMPANA_LLAVE_PRUEBA && !produccion) {
  const secretoCampana = Buffer.from(process.env.CAMPANA_LLAVE_PRUEBA, "hex");
  const firmarCampana = (datos) => {
    const texto = JSON.stringify(datos);
    const firma = ed25519.sign(new TextEncoder().encode(texto), secretoCampana);
    return { texto, firma: Buffer.from(firma).toString("base64url") };
  };
  const postCampana = (cuerpo, origen = SITIO) =>
    fetch(`${base}/v1/campana`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...origen },
      body: JSON.stringify(cuerpo),
    });
  const evento = `prueba-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
  const datos = {
    v: 1,
    evento,
    red: "testnet",
    cierra_ms: Date.now() + 3_600_000,
    sorteo_ms: Date.now() + 7_200_000,
    premios: ["400000000", "200000000"],
  };
  const firmada = firmarCampana(datos);
  check("6c: crear una campaña sin Origin da 403", (await postCampana(firmada, {})).status === 403);
  const primero = firmada.firma[0];
  const firmaCambiada = `${primero === "A" ? "B" : "A"}${firmada.firma.slice(1)}`;
  const cambiada = await postCampana({ ...firmada, firma: firmaCambiada });
  check(
    "6c: una firma cambiada da 403 firma",
    cambiada.status === 403 && (await cambiada.json()).error === "firma",
  );
  const vencida = await postCampana(firmarCampana({ ...datos, cierra_ms: Date.now() - 1000 }));
  check(
    "6c: una campaña con cierre pasado da 409 vencida",
    vencida.status === 409 && (await vencida.json()).error === "vencida",
  );
  const creada = await postCampana(firmada);
  const s = await creada.json();
  check(
    "6c: una campaña buena da 201 con id, token y vence",
    creada.status === 201 && /^[0-9A-Za-z]{8}$/.test(s.id) && /^[A-Za-z0-9_-]{22}$/.test(s.token) && Number.isFinite(s.vence),
  );
  if (creada.status === 201) {
    const repetida = await postCampana(firmada);
    check(
      "6c: el mismo archivo otra vez da 409 ya-existe",
      repetida.status === 409 && (await repetida.json()).error === "ya-existe",
    );
    const publica = await (await fetch(`${base}/v1/sala/${s.id}/campana`, { headers: SITIO })).json();
    check(
      "6c: GET campana devuelve exactamente el texto y la firma",
      publica.texto === firmada.texto && publica.firma === firmada.firma,
    );
    const inicial = await (await fetch(`${base}/v1/sala/${s.id}/campana/estado`, { headers: SITIO })).json();
    check(
      "6c: la campaña nace en lista, sin equipos y con ningún pase vigente (todavía no se entregó ninguno)",
      inicial.fase === "lista" && inicial.total === 0 && inicial.pase === "vencido",
    );

    const ponerFase = (fase, token) =>
      fetch(`${base}/v1/sala/${s.id}/campana/fase`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? auth(token) : SITIO) },
        body: JSON.stringify({ fase }),
      });
    check("6c: abrir la campaña sin token da 403", (await ponerFase("abierta", null)).status === 403);
    check("6c: abrir la campaña con token da 204", (await ponerFase("abierta", s.token)).status === 204);
    const transicion = await ponerFase("sellada", s.token);
    check(
      "6c: sellar sin el número del sorteo da 400 forma (el sello se hace con el sorteo que se lee de la red)",
      transicion.status === 400 && (await transicion.json()).error === "forma",
    );

    const respuestaPase = await fetch(`${base}/v1/sala/${s.id}/campana/pase`, { headers: auth(s.token) });
    const pase = await respuestaPase.json();
    check("6c: con token la pantalla recibe un pase de 12 caracteres", /^[A-Za-z0-9_-]{12}$/.test(pase.p));
    const conPase = await (await fetch(`${base}/v1/sala/${s.id}/campana/estado?p=${pase.p}`, { headers: SITIO })).json();
    check("6c: el pase entregado vale en el estado público", conPase.pase === "vale");
    const conOtro = await (await fetch(`${base}/v1/sala/${s.id}/campana/estado?p=AAAAAAAAAAAA`, { headers: SITIO })).json();
    check("6c: otro pase de 12 caracteres figura vencido", conOtro.pase === "vencido");

    const cerrada = async (r) => r.status === 409 && (await r.json()).error === "campana";
    const equipo = await fetch(`${base}/v1/sala/${s.id}/equipos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...SITIO },
      body: JSON.stringify({
        cuenta: cuentaDePrueba(9),
        d: await cifrar(clave, JSON.stringify({ n: "Equipo de prueba", i: ["Una", "Otra"] })),
        llave: nuevaLlave(),
      }),
    });
    check("6c: el alta común de equipos queda cerrada", await cerrada(equipo));
    const config = await fetch(`${base}/v1/sala/${s.id}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth(s.token) },
      body: JSON.stringify({ modo: "cupon", evento: "feria-del-libro", cuenta: cuentaDePrueba(8) }),
    });
    check("6c: la configuración común de equipos queda cerrada", await cerrada(config));
    check("6c: el alta común de nombres queda cerrada", await cerrada(await post(s.id, "Persona de prueba")));
    await fetch(`${base}/v1/sala/${s.id}`, { method: "DELETE", headers: auth(s.token) });
  }
} else if (process.env.CAMPANA_LLAVE_PRUEBA) {
  console.log("SALTADO 6c: las campañas de prueba no se crean contra producción");
} else {
  console.log("SALTADO 6c: falta CAMPANA_LLAVE_PRUEBA, la llave privada de prueba del Worker local");
}

// 7. Cerrar la sala.
check("sin token no se cierra", (await fetch(`${base}/v1/sala/${id}`, { method: "DELETE", headers: SITIO })).status === 403);
check("con el token se cierra (204)", (await fetch(`${base}/v1/sala/${id}`, { method: "DELETE", headers: auth(token) })).status === 204);
check("la pantalla recibe el cierre", await esperar(() => p3.est.cierre === 1000), String(p3.est.cierre));
check("cerrada, sumar da 404", (await post(id, "Tarde")).status === 404);
check("cerrada, no queda nada para leer (404)", (await fetch(`${base}/v1/sala/${id}/nombres`, { headers: auth(token) })).status === 404);

// 8. La alarma.
await probarAlarma();

// 9. Cupo de salas por dirección.
if (conCupos) {
  let creadas = 0;
  let motivo = "";
  for (let i = 0; i < 32; i++) {
    const r = await crear();
    if (r.status === 201) {
      creadas++;
      const s = await r.json();
      await fetch(`${base}/v1/sala/${s.id}`, { method: "DELETE", headers: auth(s.token) });
    } else {
      motivo = (await r.json()).error;
      break;
    }
  }
  check(
    "más de 30 salas por hora desde una dirección da 429 cupo-ip",
    motivo === "cupo-ip" && creadas <= 30,
    `creó ${creadas} más, motivo ${motivo}`,
  );
}

// 10. Tope de 400 por sala (dos minutos).
if (conTope) {
  const rr = await crear();
  if (rr.status !== 201) console.log("NO PROBADO el tope de 400: no se pudo crear la sala", rr.status);
  else {
    const s = await rr.json();
    let entraron = 0;
    let llena = false;
    for (let min = 0; min < 5 && !llena; min++) {
      for (let i = 0; i < 245 && !llena; i++) {
        const r = await post(s.id, `P${min}-${i}`);
        if (r.status === 201) entraron++;
        else if ((await r.json()).error === "llena") llena = true;
      }
      if (!llena) await sleep(61_000);
    }
    check("el nombre 401 no entra: la sala está llena", llena && entraron === 400, `entraron ${entraron}`);
    await fetch(`${base}/v1/sala/${s.id}`, { method: "DELETE", headers: auth(s.token) });
  }
}

if (conTus) await probarTusCampanas();

console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo en verde");
process.exit(fallas ? 1 : 0);
