// Prueba el servicio de enlaces de punta a punta contra una dirección:
//   node probar.mjs http://localhost:8787        (wrangler dev)
//   node probar.mjs https://c.tinkazo.app        (producción)
// Crea un enlace, lo lee, prueba los límites y lo borra. No deja nada guardado.

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const SITIO = "https://tinkazo.app";
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

console.log(fallas ? `\n${fallas} fallas` : "\nTodo bien");
process.exit(fallas ? 1 : 0);
