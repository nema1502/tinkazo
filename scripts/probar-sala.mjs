#!/usr/bin/env node
/**
 * Prueba de la sala por QR de punta a punta, con Chrome de verdad y el Worker
 * de verdad (`wrangler dev`):
 *
 *   (en workers/sala)  npx wrangler@4 dev --port 8792 --var VIDA_PRUEBA_MS:600000
 *   pnpm build && pnpm preview --port 4391
 *   node scripts/probar-sala.mjs --base http://localhost:4391 --sala http://127.0.0.1:8792
 *
 * Una pestaña hace de pantalla del stand (modo stand, crea la sala) y otra de
 * celular (abre la página que sirve el Worker, con la clave del QR, y suma un
 * nombre). Comprueba que el nombre aparece en la lista, que una grosería queda
 * «Para revisar», que quitar sale también del objeto, que si la pantalla se
 * recarga sigue con los mismos nombres, que con la pantalla sin red no se
 * pierde nada, que cerrar la sala borra todo, y que el celular se ve bien en
 * 390 px. Un Chrome a la vez y con su propio puerto: CDP_PORT=<puerto>.
 */
import http from "node:http";
import net from "node:net";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const sala = opt("--sala", "http://127.0.0.1:8792").replace(/\/$/, "");
const salida = opt("--captura", "");
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "OK   " : "FALLA"} ${name}${detail ? ` (${detail})` : ""}`);
};

/**
 * Un intermediario entre la pantalla y el Worker que deja pasar todo, pero que
 * puede negarse a abrir WebSockets: así se prueba la caída del socket de verdad
 * (el modo sin red de DevTools no corta los sockets que ya están abiertos).
 */
let dejarSockets = true;
const destino = new URL(sala);
const intermediario = http.createServer((req, res) => {
  const p = http.request({ host: destino.hostname, port: destino.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  p.on("error", () => {
    res.statusCode = 502;
    res.end();
  });
  req.pipe(p);
});
intermediario.on("upgrade", (req, socket, head) => {
  if (!dejarSockets) return void socket.destroy();
  const s = net.connect(Number(destino.port), destino.hostname, () => {
    s.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    s.write(head);
    socket.pipe(s);
    s.pipe(socket);
  });
  s.on("error", () => socket.destroy());
  socket.on("error", () => s.destroy());
});
await new Promise((r) => intermediario.listen(0, "127.0.0.1", r));
const viaIntermediario = `http://127.0.0.1:${intermediario.address().port}`;

const browser = await launch({ width: 1280, height: 800 });
try {
  const pantalla = await browser.open("about:blank");
  await pantalla.send("Network.enable");
  await pantalla.send("Page.navigate", { url: `${base}/?lang=es&sala=${encodeURIComponent(viaIntermediario)}` });
  await pantalla.waitFor("document.getElementById('btn-stand')", 20000);
  await sleep(1200);
  await pantalla.eval(`document.getElementById('btn-stand').click()`);
  await sleep(400);
  check("el panel de la sala aparece en el modo stand", await pantalla.eval(`document.getElementById('stand-sala').offsetParent !== null`));
  check("sin sala, el botón ofrece «Que se sumen con un QR»", await pantalla.eval(`/Que se sumen con un QR/.test(document.getElementById('sala-crear').textContent)`));

  await pantalla.eval(`document.getElementById('sala-crear').click()`);
  const abierta = await pantalla.waitFor(`!document.getElementById('sala-abierta').hidden && document.getElementById('sala-qr-img').naturalWidth > 0`, 15000);
  check("crear la sala muestra el QR", abierta.ok);
  const g = JSON.parse(await pantalla.eval(`sessionStorage.getItem('tinkazo.sala')`));
  const { id, clave, token } = g.sala;
  check("en vivo: el WebSocket se presentó con el token", (await pantalla.waitFor(`document.getElementById('sala-estado').dataset.estado === 'en-vivo'`, 8000)).ok);
  const enlace = `${sala}/${id}#${clave}`;

  // El celular.
  const cel = await browser.open("about:blank");
  await cel.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cel.send("Page.navigate", { url: enlace });
  await cel.waitFor(`document.getElementById('n') && !document.getElementById('n').disabled`, 10000);
  check("el celular abre la página del Worker y el campo está listo", await cel.eval(`!document.getElementById('n').disabled`));
  check("sin scroll horizontal en 390 px", await cel.eval(`document.documentElement.scrollWidth <= innerWidth`));
  check("el campo y el botón miden al menos 44 px de alto", await cel.eval(`['n','b'].every(i => document.getElementById(i).getBoundingClientRect().height >= 44)`));
  if (salida) {
    mkdirSync(salida, { recursive: true });
    await cel.screenshot(join(salida, "sala-celular.png"));
  }
  const sumar = async (nombre) => {
    await cel.eval(`(() => { document.getElementById('hecho').hidden && 0; const o = document.getElementById('o'); if (!document.getElementById('hecho').hidden) o.click(); })()`);
    await cel.eval(`(() => { const n = document.getElementById('n'); n.value = ${JSON.stringify(nombre)}; document.getElementById('f').requestSubmit(); })()`);
    return (await cel.waitFor(`!document.getElementById('hecho').hidden || document.getElementById('msg').textContent.length > 0`, 8000)).ok;
  };

  await sumar("Mariela");
  check("el celular dice «¡Listo!» y ofrece «Hacé el tuyo, gratis»", await cel.eval(`!document.getElementById('hecho').hidden && /Hacé el tuyo, gratis/.test(document.getElementById('h').textContent)`));
  const aparece = await pantalla.waitFor(`document.getElementById('ta').value.split('\\n').includes('Mariela')`, 5000);
  check("el nombre aparece en la lista de la pantalla al instante", aparece.ok, `${aparece.elapsed} ms`);
  check("la pantalla cuenta una persona", await pantalla.eval(`/1 persona se sumó/.test(document.getElementById('sala-cuenta').textContent)`));

  // Lo que vio el servidor: nada en claro.
  const crudo = await (await fetch(`${sala}/v1/sala/${id}/nombres?desde=0`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } })).text();
  check("el servidor solo guarda bytes cifrados: «Mariela» no está en lo que devuelve", !crudo.includes("Mariela") && !crudo.includes(clave));

  await sumar("Pedro Vergara");
  await sumar("Hijo de P u t a");
  await sumar("mira http://malo.com");
  await sleep(1500);
  const lista = await pantalla.eval(`document.getElementById('ta').value`);
  check("una grosería no entra a la lista: queda «Para revisar»", !/Hijo de P/i.test(lista) && (await pantalla.eval(`!document.getElementById('sala-revisar').hidden && /Hijo de P/.test(document.getElementById('sala-revisar-lista').textContent)`)));
  check("un enlace nunca se muestra", !/malo\.com/.test(lista) && !(await pantalla.eval(`/malo\\.com/.test(document.getElementById('stand-sala').innerText)`)));
  check("«Pedro Vergara» pasa (los apellidos no son groserías)", /Pedro Vergara/.test(lista));
  check("el celular avisa que no se muestran enlaces", await cel.eval(`/enlaces/.test(document.getElementById('msg').textContent) || !document.getElementById('hecho').hidden`));

  // Mostrar el que estaba para revisar.
  await pantalla.eval(`[...document.querySelectorAll('#sala-revisar-lista button')].find(b => /Mostrar/.test(b.textContent)).click()`);
  await sleep(300);
  check("«Mostrar» lo pasa a la lista", /Hijo de P/.test(await pantalla.eval(`document.getElementById('ta').value`)));

  if (salida) await pantalla.screenshot(join(salida, "sala-pantalla.png"));

  // Quitar: también en el objeto.
  await pantalla.eval(`[...document.querySelectorAll('#sala-nombres li')].find(l => /Mariela/.test(l.textContent)).querySelector('button').click()`);
  await sleep(800);
  const tras = JSON.parse(await (await fetch(`${sala}/v1/sala/${id}/nombres?desde=0`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } })).text());
  check("quitar un nombre lo saca de la lista y del objeto", !/Mariela/.test(await pantalla.eval(`document.getElementById('ta').value`)) && Array.isArray(tras) && tras.length === 2, JSON.stringify(tras).slice(0, 60));

  // Recargar la pantalla: sigue en el modo, con la misma sala y los mismos nombres.
  await pantalla.send("Page.reload");
  await pantalla.waitFor(`document.body.dataset.stand === '1' && !document.getElementById('sala-abierta').hidden`, 15000);
  const vuelve = await pantalla.waitFor(`document.getElementById('ta').value.includes('Pedro Vergara') && document.getElementById('ta').value.includes('Hijo de P')`, 8000);
  check("si la pantalla se recarga, vuelve a pedir lo cifrado y sigue con los mismos nombres", vuelve.ok);
  check("y no reaparece el que se quitó", !/Mariela/.test(await pantalla.eval(`document.getElementById('ta').value`)));
  check("el nombre que se dejó pasar sigue pasando tras la recarga", /Hijo de P/.test(await pantalla.eval(`document.getElementById('ta').value`)));

  // El WebSocket de la pantalla cae (se bloquea su dirección y se recarga): consulta cada 3 s y no pierde nada.
  dejarSockets = false;
  await pantalla.send("Page.reload");
  await pantalla.waitFor(`document.getElementById('sala-estado').dataset.estado === 'sondeo'`, 15000);
  check("sin el WebSocket, la pantalla dice que mira cada 3 segundos", await pantalla.eval(`/cada 3 segundos/.test(document.getElementById('sala-estado').textContent)`));
  await sumar("Rosario");
  const sondeo = await pantalla.waitFor(`document.getElementById('ta').value.includes('Rosario')`, 8000);
  check("aun así el nombre llega, por la consulta cada 3 segundos", sondeo.ok, `${sondeo.elapsed} ms`);
  dejarSockets = true;
  const envivo = await pantalla.waitFor(`document.getElementById('sala-estado').dataset.estado === 'en-vivo'`, 20000);
  check("al volver el WebSocket, reconecta solo y vuelve a «En vivo»", envivo.ok, `${envivo.elapsed} ms`);
  await sumar("Tomas");
  const vivo = await pantalla.waitFor(`document.getElementById('ta').value.includes('Tomas')`, 3000);
  check("y los nombres nuevos vuelven a llegar al instante", vivo.ok, `${vivo.elapsed} ms`);

  // Cerrar la sala: no queda nada.
  await pantalla.eval(`document.getElementById('sala-cerrar').click()`);
  await pantalla.waitFor(`document.getElementById('sala-abierta').hidden`, 8000);
  const cerrada = await fetch(`${sala}/v1/sala/${id}/nombres`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } });
  check("cerrar la sala la borra del servicio (404)", cerrada.status === 404);
  check("y la pantalla lo dice", await pantalla.eval(`/se cerró y se borró todo/.test(document.getElementById('sala-error').textContent)`));
  check("el celular ya no puede sumar: dice que la sala terminó", (await sumar("Tarde")) && (await cel.eval(`/ya terminó/.test(document.getElementById('msg').textContent)`)));
  check("no quedan los datos de la sala en la pestaña", await pantalla.eval(`sessionStorage.getItem('tinkazo.sala') === null`));
  check("sin excepciones en las dos páginas", pantalla.exceptions.length === 0 && cel.exceptions.length === 0, [...pantalla.exceptions, ...cel.exceptions].slice(0, 2).join(" | "));

  console.log(JSON.stringify({ auditor: "probar-sala", checks }));
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  intermediario.close();
  intermediario.closeAllConnections?.();
  await browser.close();
}
