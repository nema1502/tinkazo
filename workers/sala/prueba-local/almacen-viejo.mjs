#!/usr/bin/env node
/**
 * La sala nueva sobre un almacén que ya tenía la forma vieja, en el motor real de los objetos con SQLite.
 *
 *   node workers/sala/prueba-local/almacen-viejo.mjs --desde <rama o commit>     (la versión que hay publicada)
 *
 * 1. Saca el código de la sala de esa versión (git archive, a una carpeta temporal) y la levanta con `wrangler dev` y un almacén
 *    nuevo en disco. Crea ahí cuatro campañas como las de hoy: una abierta, una sin organizadora, una con la sala cerrada y una
 *    sellada. Apaga el servidor y mira el almacén: `eventos_campana` tiene que tener la forma vieja (sin `duena` ni `revisada`).
 * 2. Levanta el código de ahora sobre ESE almacén: `CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` y `ALTER TABLE ADD COLUMN`
 *    corren en el constructor del objeto de cupos. Comprueba que las campañas viejas siguen respondiendo a su token, que el
 *    barrido les encuentra dueña, que Tus campañas las lista, que la toma y la creación andan sobre las filas viejas, y que
 *    una sala sellada antes trae el número del sorteo pero no la ronda.
 * 3. Apaga, mira el almacén (columnas, filas, tablas nuevas) y arranca una tercera vez: el `ALTER` no puede repetirse.
 *
 * Termina con 1 si algo falla. No toca la nube, no usa secretos reales y deja todo en `.wrangler/prueba-local/` (que git ignora).
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { StrKey } from "@stellar/stellar-sdk/base";
import { DatabaseSync } from "node:sqlite";
import { AQUI, RAIZ, levantar } from "./servidor.mjs";

const SITIO = { Origin: "https://tinkazo.app" };
const JSONH = { "Content-Type": "application/json" };
const desde = process.argv.includes("--desde") ? process.argv[process.argv.indexOf("--desde") + 1] : "";
if (!desde) {
  console.error("Uso: node workers/sala/prueba-local/almacen-viejo.mjs --desde <rama o commit>   (la versión que hay publicada)");
  process.exit(2);
}
const hexa = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (u) => Buffer.from(u).toString("base64url");
const sha = (texto) => createHash("sha256").update(texto).digest("hex");
const cuentaDe = (byte) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, byte));
let fallas = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallas++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const carpeta = join(RAIZ, ".wrangler", "prueba-local", `viejo-${Date.now()}`);
const arbol = join(carpeta, "arbol");
const almacen = join(carpeta, "almacen");
mkdirSync(arbol, { recursive: true });

// ---- El código viejo, sacado de git a una carpeta aparte (su node_modules es el del repositorio, que está más arriba).
const rev = spawnSync("git", ["rev-parse", "--verify", `${desde}^{commit}`], { cwd: RAIZ, encoding: "utf8" });
if (rev.status !== 0) {
  console.error(`No existe ${desde} en este repositorio.`);
  process.exit(2);
}
const tar = spawnSync("git", ["archive", "--format=tar", desde, "workers", "src"], { cwd: RAIZ, maxBuffer: 512 * 1024 * 1024 });
if (tar.status !== 0) {
  console.error("git archive falló");
  process.exit(2);
}
const sacar = spawnSync("tar", ["-x"], { cwd: arbol, input: tar.stdout, maxBuffer: 64 * 1024 * 1024 });
if (sacar.status !== 0) {
  console.error("tar falló", String(sacar.stderr ?? sacar.error));
  process.exit(2);
}
// Sin sus pruebas: una corrida de vitest desde la raíz no tiene que encontrar las de una versión vieja.
const sinPruebas = (d) => {
  for (const f of readdirSync(d)) {
    const ruta = join(d, f);
    if (statSync(ruta).isDirectory()) sinPruebas(ruta);
    else if (/.test.(ts|mjs|js)$/.test(f)) rmSync(ruta);
  }
};
sinPruebas(arbol);
console.log(`Código viejo: ${desde} (${rev.stdout.trim().slice(0, 8)}) en ${arbol}`);
// La misma puerta de prueba, junto al código viejo: sus rutas relativas apuntan al árbol viejo.
mkdirSync(join(arbol, "workers", "sala", "prueba-local"), { recursive: true });
cpSync(join(AQUI, "entrada.mjs"), join(arbol, "workers", "sala", "prueba-local", "entrada.mjs"));

const secreta = ed25519.utils.randomSecretKey();
const extra = {
  VIDA_PRUEBA_MS: "600000",
  LLAVE_CAMPANAS_PRUEBA: hexa(ed25519.getPublicKey(secreta)),
  POLLAR_SECRETO: `prueba-local-${hexa(crypto.getRandomValues(new Uint8Array(12)))}`,
};
const firmar = (datos) => {
  const texto = JSON.stringify(datos);
  return { texto, firma: Buffer.from(ed25519.sign(new TextEncoder().encode(texto), secreta)).toString("base64url") };
};

// ---- El almacén en disco: lo que dejó el servidor, mirado con SQLite directamente sobre una copia.
function mirar(etiqueta) {
  const copia = join(carpeta, `copia-${etiqueta}`);
  cpSync(almacen, copia, { recursive: true });
  const archivos = [];
  const recorrer = (d) => {
    for (const f of readdirSync(d)) {
      const ruta = join(d, f);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (f.endsWith(".sqlite")) archivos.push(ruta);
    }
  };
  recorrer(copia);
  const salida = { cupos: null, salas: [] };
  for (const ruta of archivos) {
    const bd = new DatabaseSync(ruta);
    const tablas = bd.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    if (tablas.includes("eventos_campana")) {
      salida.cupos = {
        tablas,
        columnas: bd.prepare("PRAGMA table_info(eventos_campana)").all().map((c) => c.name),
        eventos: bd.prepare("SELECT * FROM eventos_campana ORDER BY evento").all(),
        propias: tablas.includes("campanas_de_cuenta") ? bd.prepare("SELECT cuenta, evento FROM campanas_de_cuenta ORDER BY evento").all() : [],
        tomas: tablas.includes("tomas") ? bd.prepare("SELECT * FROM tomas").all() : [],
        sellados: tablas.includes("eventos_sellados") ? bd.prepare("SELECT evento FROM eventos_sellados").all() : [],
      };
    } else if (tablas.includes("sala")) {
      salida.salas.push(Object.fromEntries(bd.prepare("SELECT k, v FROM sala").all().map((f) => [f.k, f.v])));
    }
    bd.close();
  }
  return salida;
}
const leerRegistro = (servidor) => {
  try {
    return readFileSync(servidor.registro, "utf8");
  } catch {
    return "";
  }
};
const MALAS = /duplicate column|SqliteError|SQLITE_|Uncaught|TypeError|ReferenceError/i;

async function http(base, metodo, ruta, { cuerpo, token, cabeceras } = {}) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { ...SITIO, ...(cuerpo !== undefined ? JSONH : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceras },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => null), cabeceras: r.headers };
}

const cuentas = { A: cuentaDe(61), A2: cuentaDe(62), B: cuentaDe(63) };
const sufijo = crypto.getRandomValues(new Uint32Array(1))[0];
const ev = (n) => `prueba-${sufijo}-${n}`;
const campana = (nombre, cuenta, extra2 = {}) =>
  firmar({
    v: 1,
    evento: ev(nombre),
    red: "mainnet",
    abre_ms: Date.now() - 60_000,
    cierra_ms: Date.now() + 3_600_000,
    sorteo_ms: Date.now() + 7_200_000,
    premios: ["400000000"],
    zona: "America/La_Paz",
    empresa: { nombre: `Empresa ${nombre}` },
    ...(cuenta ? { organizadora: cuenta } : {}),
    ...extra2,
  });
const nuevoToken = () => b64(crypto.getRandomValues(new Uint8Array(16)));
// Una sesión de mentira con la forma de la del proveedor (un JWT de tres partes): las rutas de Tus campañas no miran otra cosa.
const sesionConForma = (nombre) => `${b64('{"alg":"ES256","typ":"JWT"}')}.${b64(JSON.stringify({ sub: `prueba-${nombre}`, n: nuevoToken() }))}.${b64(`firma-${nuevoToken()}`)}`;
const crear = async (base, firmado, token, anterior = null) => {
  const r = await http(base, "POST", "/v1/campana", { cuerpo: { ...firmado, intento: token }, token: anterior });
  return r;
};

let servidor = null;
const apagar = async () => {
  servidor?.apagar();
  servidor = null;
  await sleep(1500);
};
process.on("SIGINT", async () => {
  await apagar();
  process.exit(130);
});

const viejas = {};
try {
  // =========================================================================================== 1. El código viejo
  console.log("\n== 1. Código viejo: se crean las campañas de hoy");
  servidor = await levantar({ main: join(arbol, "workers", "sala", "prueba-local", "entrada.mjs"), persistir: almacen, carpeta, extra, etiqueta: "viejo" });
  console.log(`wrangler dev (código viejo) en ${servidor.base}`);
  {
    const base = servidor.base;
    for (const [nombre, cuenta] of [["abierta", cuentas.A], ["huerfana", null], ["muerta", cuentas.B], ["sellada", cuentas.A2]]) {
      const firmado = campana(nombre, cuenta);
      const token = nuevoToken();
      const r = await crear(base, firmado, token);
      check(`viejo: la campaña ${nombre} se crea`, r.estado === 201, JSON.stringify(r.cuerpo));
      viejas[nombre] = { firmado, token, id: r.cuerpo?.id, evento: ev(nombre) };
    }
    check("viejo: se abre la campaña abierta", (await http(base, "PUT", `/v1/sala/${viejas.abierta.id}/campana/fase`, { cuerpo: { fase: "abierta" }, token: viejas.abierta.token })).estado === 204);
    check("viejo: se cierra la sala de la campaña muerta", (await http(base, "DELETE", `/v1/sala/${viejas.muerta.id}`, { token: viejas.muerta.token })).estado === 204);
    const s = viejas.sellada;
    await http(base, "PUT", `/v1/sala/${s.id}/campana/fase`, { cuerpo: { fase: "abierta" }, token: s.token });
    await http(base, "PUT", `/v1/sala/${s.id}/campana/fase`, { cuerpo: { fase: "cerrada" }, token: s.token });
    await http(base, "POST", "/__prueba/sello", { cuerpo: { sorteo: "7001", organizer: cuentas.A2, ronda: 100_000_000, numWinners: 1, cuentas: [] }, cabeceras: {} });
    const sello = await http(base, "PUT", `/v1/sala/${s.id}/campana/fase`, { cuerpo: { fase: "sellada", sorteo: "7001" }, token: s.token });
    check("viejo: la campaña sellada se sella con el código viejo", sello.estado === 204, JSON.stringify(sello.cuerpo));
    const estadoViejo = await http(base, "GET", `/v1/sala/${s.id}/campana/estado`);
    check("viejo: su estado dice sellada y no trae ronda", estadoViejo.cuerpo?.fase === "sellada" && !("ronda" in (estadoViejo.cuerpo ?? {})), JSON.stringify(estadoViejo.cuerpo));
  }
  const registroViejo = leerRegistro(servidor);
  await apagar();
  check("viejo: el servidor viejo no dejó errores de SQLite en su salida", !MALAS.test(registroViejo), (registroViejo.match(MALAS) ?? [""])[0]);
  const antes = mirar("antes");
  check("viejo: el almacén de cupos tiene eventos_campana con la forma vieja (sin duena ni revisada)", !!antes.cupos && !antes.cupos.columnas.includes("duena") && !antes.cupos.columnas.includes("revisada") && antes.cupos.eventos.length === 4, JSON.stringify(antes.cupos?.columnas));
  check("viejo: todavía no existen las tablas nuevas", !!antes.cupos && !antes.cupos.tablas.includes("campanas_de_cuenta") && !antes.cupos.tablas.includes("tomas") && !antes.cupos.tablas.includes("eventos_sellados"), JSON.stringify(antes.cupos?.tablas));
  check("viejo: las salas son de la forma vieja: la sellada no guarda ronda_sello", antes.salas.length >= 3 && antes.salas.some((s) => s.fase === "sellada") && !antes.salas.some((s) => "ronda_sello" in s), `${antes.salas.length} salas`);

  // =========================================================================================== 2. El código de ahora
  console.log("\n== 2. Código de ahora sobre el mismo almacén");
  servidor = await levantar({ main: join(AQUI, "entrada.mjs"), persistir: almacen, carpeta, extra, etiqueta: "nuevo" });
  console.log(`wrangler dev (código de ahora) en ${servidor.base}`);
  let tomaA = null;
  {
    const base = servidor.base;
    const sesiones = {};
    const S = {};
    for (const [n, cuenta] of Object.entries(cuentas)) {
      S[n] = sesionConForma(n);
      sesiones[S[n]] = { userId: `usuario-${n}`, cuenta, via: "google" };
    }
    await http(base, "POST", "/__prueba/sesiones", { cuerpo: { sesiones }, cabeceras: {} });
    const { abierta, huerfana, muerta, sellada } = viejas;

    check("nuevo: la campaña de antes sigue respondiendo a su token (pase 200)", (await http(base, "GET", `/v1/sala/${abierta.id}/campana/pase`, { token: abierta.token })).estado === 200);
    const estadoAbierta = await http(base, "GET", `/v1/sala/${abierta.id}/campana/estado`, { token: abierta.token });
    check("nuevo: su estado sigue igual y suma tuya true con su token", estadoAbierta.cuerpo?.fase === "abierta" && estadoAbierta.cuerpo?.tuya === true && !("sorteo" in estadoAbierta.cuerpo), JSON.stringify(estadoAbierta.cuerpo));
    const estadoSellada = await http(base, "GET", `/v1/sala/${sellada.id}/campana/estado`);
    check("nuevo: la sellada de antes dice sellada con su sorteo y sin ronda (el celular hace lo de hoy)", estadoSellada.cuerpo?.fase === "sellada" && estadoSellada.cuerpo?.sorteo === "7001" && !("ronda" in estadoSellada.cuerpo), JSON.stringify(estadoSellada.cuerpo));

    const listaA = await http(base, "POST", "/v1/mis-campanas", { cuerpo: { sesion: S.A } });
    const filaA = listaA.cuerpo?.campanas?.find((c) => c.evento === abierta.evento);
    check("barrido: la campaña viva de antes aparece en la lista de su cuenta (viva, abierta)", listaA.estado === 200 && filaA?.estado === "viva" && filaA?.fase === "abierta" && listaA.cuerpo.campanas.length === 1, JSON.stringify(listaA.cuerpo));
    const listaA2 = await http(base, "POST", "/v1/mis-campanas", { cuerpo: { sesion: S.A2 } });
    const filaA2 = listaA2.cuerpo?.campanas?.find((c) => c.evento === sellada.evento);
    check("barrido: la sellada de antes aparece viva en fase sellada", filaA2?.estado === "viva" && filaA2?.fase === "sellada", JSON.stringify(listaA2.cuerpo));
    const listaB = await http(base, "POST", "/v1/mis-campanas", { cuerpo: { sesion: S.B } });
    check("barrido: la de la sala cerrada antes no tiene cómo saberse de quién es, y no sale (queda como hoy)", listaB.estado === 200 && listaB.cuerpo?.campanas?.length === 0, JSON.stringify(listaB.cuerpo));
    const recMuerta = await http(base, "POST", "/v1/campana/recuperar", { cuerpo: { sesion: S.B, evento: muerta.evento } });
    check("barrido: y esa tampoco se recupera (404 no-existe)", recMuerta.estado === 404 && recMuerta.cuerpo?.error === "no-existe", JSON.stringify(recMuerta.cuerpo));
    const recHuerfana = await http(base, "POST", "/v1/campana/recuperar", { cuerpo: { sesion: S.A, evento: huerfana.evento } });
    check("barrido: la que se firmó sin organizadora no es de nadie (404) y su token sigue valiendo", recHuerfana.estado === 404 && (await http(base, "GET", `/v1/sala/${huerfana.id}/campana/pase`, { token: huerfana.token })).estado === 200);

    tomaA = await http(base, "POST", "/v1/campana/recuperar", { cuerpo: { sesion: S.A, evento: abierta.evento } });
    check("toma: la campaña de antes se puede usar en otra compu (200 viva, token nuevo, fase abierta)", tomaA.estado === 200 && tomaA.cuerpo?.estado === "viva" && tomaA.cuerpo?.id === abierta.id && tomaA.cuerpo?.token !== abierta.token && tomaA.cuerpo?.fase === "abierta", JSON.stringify({ ...tomaA.cuerpo, token: undefined }));
    check("toma: el token de antes deja de valer y el nuevo vale", (await http(base, "GET", `/v1/sala/${abierta.id}/campana/pase`, { token: abierta.token })).estado === 403 && (await http(base, "GET", `/v1/sala/${abierta.id}/campana/pase`, { token: tomaA.cuerpo?.token })).estado === 200);
    const tomaSellada = await http(base, "POST", "/v1/campana/recuperar", { cuerpo: { sesion: S.A2, evento: sellada.evento } });
    check("toma: la sellada de antes no se toma (409 sellada) y su token sigue valiendo", tomaSellada.estado === 409 && tomaSellada.cuerpo?.error === "sellada" && (await http(base, "GET", `/v1/sala/${sellada.id}/campana/estado`, { token: sellada.token })).cuerpo?.tuya === true, JSON.stringify(tomaSellada.cuerpo));

    const nueva = campana("nueva", cuentas.A);
    const tNueva = nuevoToken();
    const creada = await crear(base, nueva, tNueva);
    check("creación: una campaña nueva se crea sobre el almacén viejo (201)", creada.estado === 201, JSON.stringify(creada.cuerpo));
    const repetida = await crear(base, nueva, nuevoToken());
    check("creación: repetirla sin su token da 409 ya-existe", repetida.estado === 409 && repetida.cuerpo?.error === "ya-existe");
    const reemplazoViejo = await crear(base, viejas.abierta.firmado, nuevoToken());
    check("creación: la campaña de antes, con su sala viva, tampoco se vuelve a crear (409 ya-existe)", reemplazoViejo.estado === 409 && reemplazoViejo.cuerpo?.error === "ya-existe");
    const cierreNueva = await http(base, "DELETE", `/v1/sala/${creada.cuerpo?.id}`, { token: tNueva });
    check("creación: se cierra la nueva y la lista de la cuenta la muestra activada", cierreNueva.estado === 204 && (await http(base, "POST", "/v1/mis-campanas", { cuerpo: { sesion: S.A } })).cuerpo?.campanas?.some((c) => c.evento === ev("nueva") && c.estado === "activada"));

    // Un evento sellado ANTES de publicar el servidor: el barrido lo anotó como sellado al mirar su sala, así que cerrarla después
    // no lo reabre ni se puede recuperar ni reemplazar.
    const cierreSellada = await http(base, "DELETE", `/v1/sala/${sellada.id}`, { token: sellada.token });
    const recSellada = await http(base, "POST", "/v1/campana/recuperar", { cuerpo: { sesion: S.A2, evento: sellada.evento } });
    check("sellada de antes: cerrada su sala, recuperar da 409 terminada (no se reabre)", cierreSellada.estado === 204 && recSellada.estado === 409 && recSellada.cuerpo?.error === "terminada", `cierre ${cierreSellada.estado}, recuperar ${recSellada.estado} ${JSON.stringify(recSellada.cuerpo)}`);
    const reemplazoSellada = await crear(base, sellada.firmado, nuevoToken(), sellada.token);
    check("sellada de antes: tampoco se reemplaza con el token de su sala (409 ya-existe)", reemplazoSellada.estado === 409 && reemplazoSellada.cuerpo?.error === "ya-existe", JSON.stringify(reemplazoSellada.cuerpo));
    const listaFinal = await http(base, "POST", "/v1/mis-campanas", { cuerpo: { sesion: S.A2 } });
    check("sellada de antes: la lista la muestra terminada", listaFinal.cuerpo?.campanas?.some((x) => x.evento === sellada.evento && x.estado === "terminada"), JSON.stringify(listaFinal.cuerpo));
  }
  const registroNuevo = leerRegistro(servidor);
  await apagar();
  check("nuevo: el servidor no dejó errores de SQLite ni excepciones en su salida", !MALAS.test(registroNuevo), (registroNuevo.match(MALAS) ?? [""])[0]);

  const despues = mirar("despues");
  const c = despues.cupos;
  check("almacén: eventos_campana ganó duena y revisada (con el ALTER del motor real)", !!c && c.columnas.includes("duena") && c.columnas.includes("revisada"), JSON.stringify(c?.columnas));
  check("almacén: las cuatro filas viejas siguen, con su sala y su huella", !!c && ["abierta", "huerfana", "muerta", "sellada"].every((n) => c.eventos.some((e) => e.evento === viejas[n].evento && e.sala === viejas[n].id && typeof e.huella === "string")), JSON.stringify(c?.eventos.map((e) => [e.evento.slice(-8), e.duena ? "con dueña" : "sin dueña", e.revisada])));
  const fila = (n) => c?.eventos.find((e) => e.evento === viejas[n].evento);
  check("almacén: el barrido les puso dueña a las vivas con organizadora y las marcó revisadas", fila("abierta")?.duena === cuentas.A && fila("sellada")?.duena === cuentas.A2 && fila("abierta")?.revisada === 1 && fila("sellada")?.revisada === 1);
  check("almacén: la sin organizadora y la de la sala muerta quedan sin dueña, revisadas", fila("huerfana")?.duena === null && fila("muerta")?.duena === null && fila("huerfana")?.revisada === 1 && fila("muerta")?.revisada === 1);
  check("almacén: la huella de la campaña tomada es la del token nuevo", !!tomaA && fila("abierta")?.huella === sha(tomaA.cuerpo?.token ?? ""), "");
  check("almacén: la sellada de antes quedó anotada en eventos_sellados", !!c && c.sellados.some((s) => s.evento === viejas.sellada.evento) && c.sellados.length === 1, JSON.stringify(c?.sellados));
  check("almacén: existen las tablas nuevas", !!c && ["campanas_de_cuenta", "tomas", "eventos_sellados", "cuenta_ritmo"].every((t) => c.tablas.includes(t)), JSON.stringify(c?.tablas));
  check("almacén: la lista de cada cuenta tiene sus campañas (abierta, sellada y la nueva) y la toma quedó anotada", !!c && c.propias.some((p) => p.evento === viejas.abierta.evento && p.cuenta === cuentas.A) && c.propias.some((p) => p.evento === viejas.sellada.evento && p.cuenta === cuentas.A2) && c.propias.some((p) => p.evento === ev("nueva")) && c.tomas.some((t) => t.evento === viejas.abierta.evento && t.gen >= 1), JSON.stringify(c?.propias.map((p) => p.evento.slice(-8))));

  // =========================================================================================== 3. Otro arranque
  console.log("\n== 3. Otro arranque sobre el almacén ya cambiado");
  servidor = await levantar({ main: join(AQUI, "entrada.mjs"), persistir: almacen, carpeta, extra, etiqueta: "nuevo2" });
  {
    const base = servidor.base;
    const S = `prueba-A-${nuevoToken()}`;
    await http(base, "POST", "/__prueba/sesiones", { cuerpo: { sesiones: { [S]: { userId: "usuario-A", cuenta: cuentas.A, via: "google" } } }, cabeceras: {} });
    const lista = await http(base, "POST", "/v1/mis-campanas", { cuerpo: { sesion: S } });
    check("segundo arranque: el ALTER no se repite y la lista sigue andando", lista.estado === 200 && lista.cuerpo?.campanas?.some((x) => x.evento === viejas.abierta.evento && x.estado === "viva"), JSON.stringify(lista.cuerpo));
    const salidas = await http(base, "GET", "/__prueba/salidas", { cabeceras: {} });
    check("sin salidas: el Worker no llamó a ningún servidor que no fuera una imitación", (salidas.cuerpo?.hosts ?? []).every((h) => h === "server.api.pollar.xyz" || h === "rpc.prueba.invalid"), JSON.stringify(salidas.cuerpo));
  }
  const registro3 = leerRegistro(servidor);
  await apagar();
  check("segundo arranque: sin errores de SQLite en su salida", !MALAS.test(registro3), (registro3.match(MALAS) ?? [""])[0]);
} catch (e) {
  console.error(String(e?.stack ?? e));
  fallas++;
} finally {
  await apagar();
  try {
    rmSync(arbol, { recursive: true, force: true });
  } catch {
    /* queda en la carpeta temporal, que git ignora */
  }
}
writeFileSync(join(carpeta, "resultado.txt"), fallas ? `${fallas} FALLAS` : "Todo en verde");
console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo en verde");
process.exit(fallas ? 1 : 0);
