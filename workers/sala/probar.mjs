#!/usr/bin/env node
/**
 * Prueba de la sala contra un Worker en marcha:
 *
 *   npx wrangler@4 dev --port 8791 --var VIDA_PRUEBA_MS:4000
 *   node probar.mjs http://127.0.0.1:8791 [--cupos] [--tope]
 *
 * Crea dos salas y no deja nada guardado (las cierra o vencen solas). `--cupos`
 * prueba el tope de salas por dirección (deja esa dirección una hora sin crear;
 * reiniciar `wrangler dev` lo reinicia); `--tope` manda nombres durante cinco
 * minutos para llegar a 400.
 */
import { gzipSync } from "node:zlib";

const base = (process.argv[2] ?? "http://127.0.0.1:8791").replace(/\/$/, "");
const conCupos = process.argv.includes("--cupos");
const conTope = process.argv.includes("--tope");
const SITIO = { Origin: "https://tinkazo.app" };
let fallas = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallas++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (u) => Buffer.from(u).toString("base64url");

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
async function descifrar(claveB64, d) {
  const u = Buffer.from(d, "base64url");
  const k = await crypto.subtle.importKey("raw", Buffer.from(claveB64, "base64url"), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(1, 13) }, k, u.subarray(13)));
}
const post = (id, d) => fetch(`${base}/v1/sala/${id}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: d });
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

// 3. Los nombres.
check("una forma que no es un nombre cifrado da 400", (await post(id, "hola mundo!")).status === 400);
check("un nombre demasiado largo da 413 o 400", [400, 413].includes((await post(id, "A".repeat(500))).status));
check("una sala que no existe da 404", (await post("Zz9Zz9Zz", await cifrar(clave, "Ana"))).status === 404);
const ana = await post(id, await cifrar(clave, "Ana"));
check("un nombre cifrado entra (201)", ana.status === 201);
check("sin token no se leen los nombres", (await fetch(`${base}/v1/sala/${id}/nombres`, { headers: SITIO })).status === 403);
check("con otro token tampoco", (await fetch(`${base}/v1/sala/${id}/nombres`, { headers: auth(b64(crypto.getRandomValues(new Uint8Array(16)))) })).status === 403);
const lista = await (await fetch(`${base}/v1/sala/${id}/nombres?desde=0`, { headers: auth(token) })).json();
check("con el token se leen, cifrados", lista.length === 1 && !JSON.stringify(lista).includes("Ana"), JSON.stringify(lista).slice(0, 60));
check("y se descifran con la clave que solo tiene el QR", (await descifrar(clave, lista[0].d)) === "Ana");

// 4. La pantalla por WebSocket.
const p1 = pantalla(id);
await p1.abierto;
p1.ws.send(JSON.stringify({ t: "hola", token: "no-es-el-token" }));
check("un socket con un token que no es cierra con 4401", await esperar(() => p1.est.cierre === 4401), String(p1.est.cierre));
const p2 = pantalla(id);
await p2.abierto;
p2.ws.send(JSON.stringify({ t: "hola", token }));
check("con el token queda listo y dice cuántos hay", await esperar(() => p2.msgs.some((m) => m.t === "listo" && m.hay === 1)));
const beto = await post(id, await cifrar(clave, "Beto"));
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

// 6. Tope por minuto: 120 nombres por sala (ya van 2).
let ok = 2;
let rapido = 0;
for (let i = 0; i < 125; i++) {
  const r = await post(id, await cifrar(clave, `Persona ${i}`));
  if (r.status === 201) ok++;
  else if (r.status === 429 && (await r.json()).error === "rapido") rapido++;
}
check("el tope es de 120 nombres por minuto por sala", ok >= 118 && ok <= 120 && rapido >= 7, `entraron ${ok}, frenados ${rapido}`);

// 6b. Los equipos: el registro con cuenta de equipos.html. El tope por minuto de los nombres ya se gastó: se espera a que pase.
{
  await sleep(61_000 - (Date.now() % 60_000));
  const A = `G${"A".repeat(55)}`;
  const B = `G${"B".repeat(55)}`;
  const EVENTO = `G${"C".repeat(55)}`;
  const config = { modo: "sorteo", evento: "space-apps-scz-2026", cuenta: EVENTO };
  const json = { "Content-Type": "application/json" };
  const putConfig = (tok, cuerpo) => fetch(`${base}/v1/sala/${id}/config`, { method: "PUT", headers: { ...json, ...(tok ? auth(tok) : SITIO) }, body: JSON.stringify(cuerpo) });
  const altaEquipo = (cuenta, d, headers = SITIO) => fetch(`${base}/v1/sala/${id}/equipos`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ cuenta, d }) });
  const equiposCifrados = async (nombre, integrantes) => cifrar(clave, JSON.stringify({ n: nombre, i: integrantes }));

  check("sin token no se arma el registro (403)", (await putConfig(null, config)).status === 403);
  check("una configuración mala da 400 (un modo que no existe, una cuenta que no es)", (await putConfig(token, { ...config, modo: "sena" })).status === 400 && (await putConfig(token, { ...config, cuenta: "GMALA" })).status === 400);
  const antes = await (await fetch(`${base}/v1/sala/${id}/publico`, { headers: SITIO })).json();
  check("antes de armarlo, la sala dice que no hay registro", antes.config === null && antes.equipos === 0, JSON.stringify(antes));
  check("anotar un equipo sin registro armado da 409", (await altaEquipo(A, await equiposCifrados("Cóndores", ["Ana", "Beto"]))).status === 409);
  check("con el token se arma el registro (204)", (await putConfig(token, config)).status === 204);
  const publico = await (await fetch(`${base}/v1/sala/${id}/publico`, { headers: SITIO })).json();
  check("cualquiera con el enlace ve cómo es el registro, sin token", publico.config?.modo === "sorteo" && publico.config?.cuenta === EVENTO && publico.equipos === 0, JSON.stringify(publico));

  check("anotar sin el origen del sitio da 403", (await altaEquipo(A, await equiposCifrados("X", ["a", "b"]), {})).status === 403);
  check("anotar con una cuenta que no es da 400", (await altaEquipo("GMALA", await equiposCifrados("X", ["a", "b"]))).status === 400);
  check("anotar con datos que no son un equipo cifrado da 400", (await altaEquipo(A, "hola mundo!")).status === 400);

  const lleg = p3.msgs.length;
  const alta = await altaEquipo(A, await equiposCifrados("Los Cóndores", ["Ana", "Beto", "Carla"]));
  const altaJson = await alta.json();
  check("un equipo se anota (201) y con sorteo propio queda como solicitud", alta.status === 201 && altaJson.estado === "solicitud" && Number.isInteger(altaJson.n), JSON.stringify(altaJson));
  check("la pantalla recibe el equipo al instante, con la cuenta en claro y lo demás cifrado", await esperar(() => p3.msgs.slice(lleg).some((m) => m.t === "equipo" && m.cuenta === A && !JSON.stringify(m).includes("Cóndores"))));
  const re = await (await altaEquipo(A, await equiposCifrados("Los Cóndores 2", ["Ana", "Beto"]))).json();
  check("la misma cuenta otra vez cambia los datos y conserva el número y el estado", re.n === altaJson.n && re.estado === "solicitud", JSON.stringify(re));
  const segundo = await (await altaEquipo(B, await equiposCifrados("Pumas", ["Dani", "Eva"]))).json();
  check("otra cuenta es otro equipo, con otro número", segundo.n !== altaJson.n);

  check("sin token no se leen los equipos (403)", (await fetch(`${base}/v1/sala/${id}/equipos?desde=0`, { headers: SITIO })).status === 403);
  const todos = await (await fetch(`${base}/v1/sala/${id}/equipos?desde=0`, { headers: auth(token) })).json();
  check("con el token se leen, cifrados", todos.length === 2 && !JSON.stringify(todos).includes("Pumas") && !JSON.stringify(todos).includes("Cóndores"), `${todos.length} equipos`);
  const delA = todos.find((e) => e.cuenta === A);
  check("y se descifran con la clave que solo tiene el QR", JSON.parse(await descifrar(clave, delA.d)).n === "Los Cóndores 2");
  const vMax = Math.max(...todos.map((e) => e.v));

  const unoA = await (await fetch(`${base}/v1/sala/${id}/equipos/${A}`, { headers: SITIO })).json();
  check("el celular del equipo pregunta en qué punto está, sin token", unoA.n === altaJson.n && unoA.estado === "solicitud", JSON.stringify(unoA));
  check("una cuenta que no se anotó da 404", (await fetch(`${base}/v1/sala/${id}/equipos/G${"D".repeat(55)}`, { headers: SITIO })).status === 404);

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

  // Una sala nueva sin registro no deja anotar a nadie.
  const r3 = await crear();
  if (r3.status === 201) {
    const s3 = await r3.json();
    const sinRegistro = await fetch(`${base}/v1/sala/${s3.id}/equipos`, { method: "POST", headers: { ...json, ...SITIO }, body: JSON.stringify({ cuenta: A, d: await equiposCifrados("X", ["a", "b"]) }) });
    check("una sala sin registro armado no deja anotar (409)", sinRegistro.status === 409);
    await fetch(`${base}/v1/sala/${s3.id}/config`, { method: "PUT", headers: { ...json, ...auth(s3.token) }, body: JSON.stringify({ ...config, modo: "cupon" }) });
    const directo = await (await fetch(`${base}/v1/sala/${s3.id}/equipos`, { method: "POST", headers: { ...json, ...SITIO }, body: JSON.stringify({ cuenta: A, d: await equiposCifrados("X", ["a", "b"]) }) })).json();
    check("con el cupón gratis el equipo queda aceptado directamente", directo.estado === "aceptado", JSON.stringify(directo));
    await fetch(`${base}/v1/sala/${s3.id}`, { method: "DELETE", headers: auth(s3.token) });
    check("al cerrar la sala se van también los equipos (404)", (await fetch(`${base}/v1/sala/${s3.id}/equipos/${A}`, { headers: SITIO })).status === 404);
  } else console.log("NO PROBADO el cupón gratis: el cupo de salas no dejó crear otra", r3.status);
}

// 7. Cerrar la sala.
check("sin token no se cierra", (await fetch(`${base}/v1/sala/${id}`, { method: "DELETE", headers: SITIO })).status === 403);
check("con el token se cierra (204)", (await fetch(`${base}/v1/sala/${id}`, { method: "DELETE", headers: auth(token) })).status === 204);
check("la pantalla recibe el cierre", await esperar(() => p3.est.cierre === 1000), String(p3.est.cierre));
check("cerrada, sumar da 404", (await post(id, await cifrar(clave, "Tarde"))).status === 404);
check("cerrada, no queda nada para leer (404)", (await fetch(`${base}/v1/sala/${id}/nombres`, { headers: auth(token) })).status === 404);

// 8. La alarma: con VIDA_PRUEBA_MS la sala vence sola.
const r2 = await crear();
if (r2.status === 201) {
  const s2 = await r2.json();
  const vida = s2.vence - Date.now();
  await post(s2.id, await cifrar(clave, "Carla"));
  if (vida < 60_000) {
    await sleep(vida + 2500);
    const a = (await post(s2.id, await cifrar(clave, "Dani"))).status;
    const b = (await fetch(`${base}/v1/sala/${s2.id}/nombres`, { headers: auth(s2.token) })).status;
    check("la alarma borra la sala sola", a === 404 && b === 404, `venció a los ${Math.round(vida / 1000)} s de prueba`);
  } else {
    console.log("NO PROBADO la alarma de 10 h: arrancá wrangler con --var VIDA_PRUEBA_MS:4000");
    await fetch(`${base}/v1/sala/${s2.id}`, { method: "DELETE", headers: auth(s2.token) });
  }
} else console.log("NO PROBADO la alarma: el cupo de salas no dejó crear otra", r2.status);

// 9. Cupo de salas por dirección.
if (conCupos) {
  let creadas = 0;
  let motivo = "";
  for (let i = 0; i < 8; i++) {
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
  check("más de 5 salas por hora desde una dirección da 429 cupo-ip", motivo === "cupo-ip" && creadas <= 5, `creó ${creadas} más, motivo ${motivo}`);
}

// 10. Tope de 400 por sala (cinco minutos).
if (conTope) {
  const rr = await crear();
  if (rr.status !== 201) console.log("NO PROBADO el tope de 400: no se pudo crear la sala", rr.status);
  else {
    const s = await rr.json();
    let entraron = 0;
    let llena = false;
    for (let min = 0; min < 5 && !llena; min++) {
      for (let i = 0; i < 125 && !llena; i++) {
        const r = await post(s.id, await cifrar(clave, `P${min}-${i}`));
        if (r.status === 201) entraron++;
        else if ((await r.json()).error === "llena") llena = true;
      }
      if (!llena) await sleep(61_000);
    }
    check("el nombre 401 no entra: la sala está llena", llena && entraron === 400, `entraron ${entraron}`);
    await fetch(`${base}/v1/sala/${s.id}`, { method: "DELETE", headers: auth(s.token) });
  }
}

console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo en verde");
process.exit(fallas ? 1 : 0);
