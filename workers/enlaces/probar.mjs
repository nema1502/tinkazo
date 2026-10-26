// Prueba el servicio de enlaces de punta a punta contra una dirección:
//   node probar.mjs http://localhost:8787        (wrangler dev)
//   node probar.mjs https://c.tinkazo.app        (producción)
// Crea un enlace, lo lee, prueba los límites y lo borra. No deja nada guardado.
//
// El borrado a pedido (el secreto de administración) se prueba solo si está a
// mano en el entorno; si no, se saltea:
//   ADMIN_TOKEN=<secreto> node probar.mjs https://c.tinkazo.app
//
// El contador del embudo: en local suma conteos de prueba y los lee de vuelta.
// Contra producción solo prueba lo que no escribe (lo que se rechaza y la
// lectura): un conteo de prueba quedaría para siempre en los números públicos.

import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const SITIO = "https://tinkazo.app";
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(base);
let fallas = 0;

function ver(nombre, ok, detalle = "") {
  if (!ok) fallas++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
}

const datos = crypto.getRandomValues(new Uint8Array(3000));

// Crear desde el sitio.
let r = await fetch(`${base}/v1`, { method: "POST", headers: { Origin: SITIO, "Content-Type": "application/octet-stream" }, body: datos });
const alta = r.status === 201 ? await r.json() : null;
ver("crear desde tinkazo.app da 201", r.status === 201, `estado ${r.status}`);
ver("el id tiene 8 caracteres de base 62", /^[0-9A-Za-z]{8}$/.test(alta?.id ?? ""), alta?.id);
ver("devuelve un token para borrar", typeof alta?.borrar === "string" && alta.borrar.length >= 20);
ver("CORS del alta nombra al sitio", r.headers.get("access-control-allow-origin") === SITIO);

// Leer desde cualquier lado.
r = await fetch(`${base}/v1/${alta?.id}`, { headers: { Origin: "https://otro.example" } });
const leido = new Uint8Array(await r.arrayBuffer());
ver("leer da 200", r.status === 200, `estado ${r.status}`);
ver("devuelve los mismos bytes", leido.length === datos.length && leido.every((b, i) => b === datos[i]));
ver("leer se permite desde cualquier origen", r.headers.get("access-control-allow-origin") === "*");

// Límites.
r = await fetch(`${base}/v1`, { method: "POST", headers: { Origin: "https://otro.example" }, body: datos });
ver("crear desde otro sitio da 403", r.status === 403, `estado ${r.status}`);
r = await fetch(`${base}/v1`, { method: "POST", headers: { Origin: SITIO }, body: new Uint8Array(256 * 1024 + 1) });
ver("más de 256 KB da 413", r.status === 413, `estado ${r.status}`);
r = await fetch(`${base}/v1`, { method: "POST", headers: { Origin: SITIO }, body: new Uint8Array(0) });
ver("cuerpo vacío da 413", r.status === 413, `estado ${r.status}`);
r = await fetch(`${base}/v1/ZZZZZZZZ`);
ver("un id que no existe da 404", r.status === 404, `estado ${r.status}`);
r = await fetch(`${base}/v1/corto`);
ver("un id mal formado da 404", r.status === 404, `estado ${r.status}`);
r = await fetch(`${base}/v1`, { method: "OPTIONS", headers: { Origin: SITIO, "Access-Control-Request-Method": "POST" } });
ver("la consulta previa (OPTIONS) da 204", r.status === 204, `estado ${r.status}`);

// La dirección corta del servicio lleva a la página del comprobante.
r = await fetch(`${base}/${alta?.id}`, { redirect: "manual" });
ver("c.tinkazo.app/<id> redirige a tinkazo.app/c/<id>", r.status === 302 && r.headers.get("location") === `${SITIO}/c/${alta?.id}`, `${r.status} ${r.headers.get("location")}`);

// Borrar.
r = await fetch(`${base}/v1/${alta?.id}`, { method: "DELETE", headers: { Origin: SITIO, Authorization: "Bearer equivocado" } });
ver("borrar con un token equivocado da 403", r.status === 403, `estado ${r.status}`);
r = await fetch(`${base}/v1/${alta?.id}`, { method: "DELETE", headers: { Origin: SITIO, Authorization: `Bearer ${alta?.borrar}` } });
ver("borrar con el token da 204", r.status === 204, `estado ${r.status}`);
r = await fetch(`${base}/v1/${alta?.id}`);
ver("después de borrar da 404", r.status === 404, `estado ${r.status}`);

// Borrar a pedido, con el secreto de administración del Worker.
const admin = process.env.ADMIN_TOKEN ?? "";
if (!admin) {
  console.log("SALTA el borrado a pedido: no hay ADMIN_TOKEN en el entorno");
} else {
  r = await fetch(`${base}/v1`, { method: "POST", headers: { Origin: SITIO }, body: datos });
  const otro = r.status === 201 ? await r.json() : null;
  ver("crear otro enlace para borrarlo a pedido da 201", r.status === 201, `estado ${r.status}`);
  r = await fetch(`${base}/v1/${otro?.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}x` } });
  ver("un secreto equivocado no borra (403)", r.status === 403, `estado ${r.status}`);
  r = await fetch(`${base}/v1/${otro?.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });
  ver("borrar con el secreto de administración da 204", r.status === 204, `estado ${r.status}`);
  r = await fetch(`${base}/v1/${otro?.id}`);
  ver("después del borrado a pedido da 404", r.status === 404, `estado ${r.status}`);
  r = await fetch(`${base}/v1/${otro?.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });
  ver("borrar a pedido lo que ya no está da 404", r.status === 404, `estado ${r.status}`);
  // Si algo falló a mitad de camino, que no quede guardado.
  if (otro?.borrar) await fetch(`${base}/v1/${otro.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${otro.borrar}` } });
}

// ------------------------------------------------------------ el contador
// Como lo manda el sitio: `sendBeacon` con un cuerpo de texto y el origen del sitio.
const CONTRATO = JSON.parse(readFileSync(new URL("../../src/stellar/deployments.json", import.meta.url), "utf8")).testnet.contractId;
const REF = { net: "testnet", contract: CONTRATO, id: "278" };
const contar = (cuerpo, origen = SITIO) =>
  fetch(`${base}/v1/contar`, {
    method: "POST",
    headers: { ...(origen ? { Origin: origen } : {}), "Content-Type": "text/plain;charset=UTF-8" },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const hoy = new Date().toISOString().slice(0, 10);

// Lo que se rechaza no escribe nada: se prueba también en producción.
const rechazos = [
  ["un evento que no está en la lista", { e: "inventado" }, 400],
  ["un campo de más (un nombre)", { e: "list_shown", nombre: "Ana Quispe" }, 400],
  ["una propiedad que no está en la lista", { e: "seal_sent", p: { network: "testnet", cuenta: "GABC" } }, 400],
  ["un valor que no está en la lista", { e: "list_ready", p: { source: "paste", size: "17" } }, 400],
  ["una propiedad que falta", { e: "seal_failed", p: { network: "testnet" } }, 400],
  ["una referencia donde no va", { e: "seal_sent", p: { network: "testnet" }, ref: REF }, 400],
  ["un veredicto sin referencia", { e: "proof_verdict", p: { verdict: "green" } }, 400],
  ["una referencia mal formada (una cuenta)", { e: "share", p: { channel: "copy" }, ref: { ...REF, contract: "G" + CONTRATO.slice(1) } }, 400],
  ["un sorteo de un contrato que no es oficial", { e: "proof_verdict", p: { verdict: "green" }, ref: { ...REF, contract: "C" + "A".repeat(55) } }, 400],
  ["un canal que no está en la lista (bajar la foto)", { e: "share", p: { channel: "photo" }, ref: REF }, 400],
  ["algo que no es JSON", "{e: list_shown", 400],
  ["más de 512 bytes", JSON.stringify({ e: "list_shown" }) + " ".repeat(600), 413],
];
for (const [nombre, cuerpo, estado] of rechazos) {
  r = await contar(cuerpo);
  ver(`contar ${nombre} da ${estado}`, r.status === estado, `estado ${r.status}`);
}
r = await contar({ e: "list_shown" }, "https://otro.example");
ver("contar desde otro sitio da 403", r.status === 403, `estado ${r.status}`);
r = await contar({ e: "list_shown" }, "");
ver("contar sin origen da 403", r.status === 403, `estado ${r.status}`);
r = await fetch(`${base}/v1/contar`);
ver("GET a /v1/contar da 405", r.status === 405, `estado ${r.status}`);
r = await fetch(`${base}/v1/conteos?desde=${hoy}&hasta=2020-01-01`);
ver("una consulta al revés da 400", r.status === 400, `estado ${r.status}`);
r = await fetch(`${base}/v1/conteos?desde=2026-01-01&hasta=2026-12-31`);
ver("una consulta de más de 92 días da 400", r.status === 400, `estado ${r.status}`);
r = await fetch(`${base}/v1/conteos?desde=ayer`);
ver("un día mal escrito da 400", r.status === 400, `estado ${r.status}`);

// Leer: público, desde cualquier sitio, sin nada más que día, evento, propiedades, sorteo y cuántas veces.
r = await fetch(`${base}/v1/conteos`, { headers: { Origin: "https://otro.example" } });
const publicados = r.status === 200 ? await r.json() : null;
ver("leer los conteos da 200", r.status === 200, `estado ${r.status}`);
ver("leer se permite desde cualquier origen", r.headers.get("access-control-allow-origin") === "*");
ver("la respuesta es una lista", Array.isArray(publicados));
ver(
  "cada fila tiene solo día, evento, propiedades, sorteo y cuántas veces",
  Array.isArray(publicados) && publicados.every((f) => Object.keys(f).every((k) => ["dia", "e", "p", "ref", "n"].includes(k)) && /^\d{4}-\d{2}-\d{2}$/.test(f.dia) && Number.isInteger(f.n)),
);

if (!LOCAL) {
  console.log("SALTA sumar conteos de prueba: no es local, y quedarían en los números públicos");
} else {
  // Cada consulta queda guardada cinco minutos en el Worker: un rango al azar (que incluye hoy) no la repite.
  const rango = (desdeHace) => `desde=${new Date(Date.now() - desdeHace * 86_400_000).toISOString().slice(0, 10)}&hasta=${hoy}`;
  const leer = async (desdeHace) => {
    const x = await fetch(`${base}/v1/conteos?${rango(desdeHace)}`);
    return { r: x, filas: x.status === 200 ? await x.json() : [] };
  };
  const cuantos = (filas, e, p = {}, ref) =>
    filas.find((x) => x.dia === hoy && x.e === e && JSON.stringify(x.p) === JSON.stringify(p) && JSON.stringify(x.ref ?? null) === JSON.stringify(ref ?? null))?.n ?? 0;
  const previo = (await leer(1 + Math.floor(Math.random() * 40))).filas;
  const validos = [
    { e: "seal_sent", p: { network: "testnet" } },
    { e: "seal_sent", p: { network: "testnet" } },
    { e: "list_ready", p: { size: "10-49", source: "paste" } },
    { e: "list_shown" },
    { e: "share", p: { channel: "copy" }, ref: REF },
    { e: "proof_verdict", p: { verdict: "green" }, ref: REF },
  ];
  let bien = 0;
  for (const c of validos) if ((await contar(c)).status === 204) bien++;
  ver("seis conteos válidos dan 204", bien === validos.length, `${bien} de ${validos.length}`);
  const despues = await leer(41 + Math.floor(Math.random() * 40));
  const suma = (e, p, ref) => cuantos(despues.filas, e, p, ref) - cuantos(previo, e, p, ref);
  ver("los dos sellos suman dos en el día", suma("seal_sent", { network: "testnet" }) === 2, `${suma("seal_sent", { network: "testnet" })}`);
  ver("las propiedades vuelven en orden, y suman uno", suma("list_ready", { size: "10-49", source: "paste" }) === 1);
  ver("un evento sin propiedades vuelve con {}", suma("list_shown") === 1);
  ver("compartir vuelve con la referencia del sorteo", suma("share", { channel: "copy" }, REF) === 1);
  ver("el veredicto vuelve con la referencia del sorteo", suma("proof_verdict", { verdict: "green" }, REF) === 1);
  ver("la respuesta se puede guardar cinco minutos", (despues.r.headers.get("cache-control") ?? "").includes("max-age=300"));
  // El tope por dirección y por hora, solo si se pide (`--tope`): después, esa dirección queda una hora sin contar.
  if (!process.argv.includes("--tope")) {
    console.log("SALTA el tope por dirección y por hora: se prueba con --tope");
  } else {
    let tope = 0;
    for (let i = 0; i < 1_100 && !tope; i++) {
      const s = (await contar({ e: "list_shown" })).status;
      if (s === 429) tope = i + 1;
    }
    ver("pasado el tope por dirección y por hora da 429", tope > 0 && tope <= 1_000, tope ? `al ${tope}.º` : "nunca");
  }
}

console.log(fallas ? `\n${fallas} fallas` : "\nTodo bien");
process.exit(fallas ? 1 : 0);
