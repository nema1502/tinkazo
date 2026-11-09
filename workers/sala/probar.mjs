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
