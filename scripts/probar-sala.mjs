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
 * pierde nada y que cerrar el QR borra todo. También comprueba la corrección
 * sin duplicar, el rechazo de un repetido y el celular en 360 px. Un Chrome a
 * la vez y con su propio puerto: CDP_PORT=<puerto>.
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
  check(
    "sin sala, el botón ofrece Mostrar el QR y es el de color",
    await pantalla.eval(`(() => {
      const b = document.getElementById('sala-crear');
      return /Mostrar el QR/.test(b.textContent) && b.classList.contains('primary');
    })()`),
  );

  await pantalla.eval(`document.getElementById('sala-crear').click()`);
  const abierta = await pantalla.waitFor(`!document.getElementById('sala-abierta').hidden && document.getElementById('sala-qr-img').naturalWidth > 0`, 15000);
  check("crear la sala muestra el QR", abierta.ok);
  check(
    "Mostrar el QR abre la pantalla grande",
    await pantalla.eval(`document.getElementById('stand-sala').classList.contains('grande')`),
  );
  await pantalla.eval(`document.getElementById('sala-grande').click()`);
  await sleep(300);
  const g = JSON.parse(await pantalla.eval(`sessionStorage.getItem('tinkazo.sala')`));
  const { id, clave, token } = g.sala;
  check("en vivo: el WebSocket se presentó con el token", (await pantalla.waitFor(`document.getElementById('sala-estado').dataset.estado === 'en-vivo'`, 8000)).ok);
  const enlace = `${sala}/${id}#${clave}`;

  // El celular.
  const cel = await browser.open("about:blank");
  // Los estados de las altas permiten comprobar 201, 200 y 409 sin cambiar la página.
  await cel.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__altas=[];var f=window.fetch;window.fetch=function(){var a=arguments;return f.apply(this,a).then(function(r){if(a[1]&&a[1].method==="POST"&&String(a[0]).indexOf("/v1/sala/")===0)window.__altas.push(r.status);return r})}`,
  });
  await cel.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 844, deviceScaleFactor: 2, mobile: true });
  await cel.send("Page.navigate", { url: enlace });
  await cel.waitFor(`document.getElementById('n') && !document.getElementById('n').disabled`, 10000);
  check("el celular abre la página del Worker y el campo está listo", await cel.eval(`!document.getElementById('n').disabled`));
  check("sin scroll horizontal en 360 px", await cel.eval(`document.documentElement.scrollWidth <= innerWidth`));
  check("el campo y el botón miden al menos 48 px de alto", await cel.eval(`['n','b'].every(i => document.getElementById(i).getBoundingClientRect().height >= 48)`));
  if (salida) {
    mkdirSync(salida, { recursive: true });
    await cel.screenshot(join(salida, "sala-celular.png"));
  }
  const sumar = async (nombre, otroCelular = true) => {
    if (otroCelular) {
      // Otro celular: mismo Chrome, pero sin el recuerdo local de esta sala.
      await cel.eval(`localStorage.removeItem(${JSON.stringify(`tk-sala:${id}`)})`);
      await cel.send("Page.reload");
      await cel.waitFor(`document.getElementById('n') && !document.getElementById('n').disabled && !document.getElementById('form').hidden`, 10000);
    } else {
      await cel.eval(`(() => { if (!document.getElementById('hecho').hidden) document.getElementById('o').click(); })()`);
    }
    await cel.eval(`(() => { const n = document.getElementById('n'); n.value = ${JSON.stringify(nombre)}; document.getElementById('f').requestSubmit(); })()`);
    return (await cel.waitFor(`!document.getElementById('hecho').hidden || document.getElementById('msg').textContent.length > 0`, 8000)).ok;
  };

  await sumar("Mariela", false);
  check("el celular dice que está listo, con qué nombre quedó y ofrece hacer uno gratis", await cel.eval(`!document.getElementById('hecho').hidden && /Mariela/.test(document.getElementById('hy').textContent) && /Hacé el tuyo, gratis/.test(document.getElementById('h').textContent)`));
  check("la primera alta contestó 201", await cel.eval(`window.__altas.join(',') === '201'`));
  check("el botón para corregir también mide al menos 48 px", await cel.eval(`document.getElementById('o').getBoundingClientRect().height >= 48`));
  const aparece = await pantalla.waitFor(`document.getElementById('ta').value.split('\\n').includes('Mariela')`, 5000);
  check("el nombre aparece en la lista de la pantalla al instante", aparece.ok, `${aparece.elapsed} ms`);
  check("la pantalla cuenta una persona", await pantalla.eval(`/1 persona se sumó/.test(document.getElementById('sala-cuenta').textContent)`));

  // Lo que vio el servidor: nada en claro.
  const crudo = await (await fetch(`${sala}/v1/sala/${id}/nombres?desde=0`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } })).text();
  check("el servidor solo guarda bytes cifrados: «Mariela» no está en lo que devuelve", !crudo.includes("Mariela") && !crudo.includes(clave));
  const antesDeCorregir = JSON.parse(crudo);

  await cel.send("Page.reload");
  check("al recargar, el celular recuerda que ya se anotó y con qué nombre", (await cel.waitFor(`!document.getElementById('hecho').hidden && /Mariela/.test(document.getElementById('hy').textContent)`, 8000)).ok);
  await sumar("Mariela Quispe", false);
  check("corregir desde el mismo celular contestó 200", await cel.eval(`window.__altas.join(',') === '200'`));
  check("la pantalla saca el nombre viejo y muestra la corrección", (await pantalla.waitFor(`document.getElementById('ta').value.split('\\n').includes('Mariela Quispe') && !document.getElementById('ta').value.split('\\n').includes('Mariela')`, 5000)).ok);
  const trasCorregir = JSON.parse(await (await fetch(`${sala}/v1/sala/${id}/nombres?desde=0`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } })).text());
  check("la misma llave deja una sola fila y la consulta trae el número reemplazado", trasCorregir.length === 1 && trasCorregir[0].r?.[0] === antesDeCorregir[0].n, JSON.stringify(trasCorregir));

  await sumar(" mariela  quispe ");
  check("el mismo nombre desde otro celular contestó 409 y explica cómo corregirlo", await cel.eval(`window.__altas.join(',') === '409' && /apellido o un apodo/.test(document.getElementById('msg').textContent)`));
  check("el repetido no se sumó a la pantalla", await pantalla.eval(`document.getElementById('ta').value.split('\\n').filter(x => x === 'Mariela Quispe').length === 1`));

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

  // Quitar: sale de la vista enseguida y del objeto a los cinco segundos.
  await pantalla.eval(`[...document.querySelectorAll('#sala-nombres li')].find(l => /Mariela/.test(l.textContent)).querySelector('button').click()`);
  check("quitar ofrece Deshacer con el nombre", await pantalla.eval(`!document.getElementById('sala-deshacer').hidden && /Mariela/.test(document.getElementById('sala-deshacer-t').textContent)`));
  await sleep(6000);
  const tras = JSON.parse(await (await fetch(`${sala}/v1/sala/${id}/nombres?desde=0`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } })).text());
  check("quitar un nombre lo saca de la lista y del objeto", !/Mariela/.test(await pantalla.eval(`document.getElementById('ta').value`)) && Array.isArray(tras) && tras.length === 2, JSON.stringify(tras).slice(0, 60));

  // Recargar la pantalla: sigue en el modo, con la misma sala y los mismos nombres.
  await pantalla.send("Page.reload");
  await pantalla.waitFor(`document.body.dataset.stand === '1' && !document.getElementById('sala-abierta').hidden`, 15000);
  const vuelve = await pantalla.waitFor(`document.getElementById('ta').value.includes('Pedro Vergara') && document.getElementById('ta').value.includes('Hijo de P')`, 8000);
  check("si la pantalla se recarga, vuelve a pedir lo cifrado y sigue con los mismos nombres", vuelve.ok);
  check("al recargar, los nombres no se repiten", await pantalla.eval(`document.getElementById('ta').value.split('\\n').filter(x => x === 'Pedro Vergara').length === 1`));
  check("y no reaparece el que se quitó", !/Mariela/.test(await pantalla.eval(`document.getElementById('ta').value`)));
  check("el nombre que se dejó pasar sigue pasando tras la recarga", /Hijo de P/.test(await pantalla.eval(`document.getElementById('ta').value`)));

  // El WebSocket de la pantalla cae (se bloquea su dirección y se recarga): consulta cada 3 s y no pierde nada.
  dejarSockets = false;
  await pantalla.send("Page.reload");
  await pantalla.waitFor(`document.getElementById('sala-estado').dataset.estado === 'sondeo'`, 15000);
  check("sin el WebSocket, la pantalla dice que los nombres llegan con demora", await pantalla.eval(`/unos segundos de demora/.test(document.getElementById('sala-estado').textContent)`));
  await sumar("Rosario");
  const sondeo = await pantalla.waitFor(`document.getElementById('ta').value.includes('Rosario')`, 8000);
  check("aun así el nombre llega, por la consulta cada 3 segundos", sondeo.ok, `${sondeo.elapsed} ms`);
  dejarSockets = true;
  const envivo = await pantalla.waitFor(`document.getElementById('sala-estado').dataset.estado === 'en-vivo'`, 20000);
  check("al volver el WebSocket, reconecta solo y vuelve a «En vivo»", envivo.ok, `${envivo.elapsed} ms`);
  await sumar("Tomas");
  const vivo = await pantalla.waitFor(`document.getElementById('ta').value.includes('Tomas')`, 3000);
  check("y los nombres nuevos vuelven a llegar al instante", vivo.ok, `${vivo.elapsed} ms`);

  // Con diez personas, la pantalla grande entera: acciones alcanzables y un QR que aprovecha el espacio.
  for (let n = 5; n <= 10; n++) await sumar(`Nombre ${n}`);
  await pantalla.waitFor(`document.getElementById('ta').value.split('\\n').filter(Boolean).length === 10`, 8000);
  await pantalla.eval(`document.getElementById('sala-grande').click()`);
  const vistasGrande = [
    { ancho: 390, alto: 844, nombre: "390 por 844", qrMinimo: 350, nombresAbajo: false },
    { ancho: 844, alto: 390, nombre: "844 por 390", qrMinimo: 0, nombresAbajo: false },
    { ancho: 768, alto: 1024, nombre: "768 por 1024", qrMinimo: 0, nombresAbajo: false },
    { ancho: 1366, alto: 768, nombre: "1366 por 768", qrMinimo: 560, nombresAbajo: false },
    { ancho: 1920, alto: 1080, nombre: "1920 por 1080", qrMinimo: 860, nombresAbajo: true },
  ];
  for (const v of vistasGrande) {
    await pantalla.send("Emulation.setDeviceMetricsOverride", { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: false });
    await sleep(180);
    const m = JSON.parse(await pantalla.eval(`(() => {
      const rect = id => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
      };
      const dentro = r => r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.width > 0 && r.height > 0;
      const nombres = [...document.querySelectorAll('#sala-nombres li')].map(e => e.getBoundingClientRect().bottom);
      return JSON.stringify({
        qr: rect('sala-qr-img'), empezar: rect('sala-empezar'), volver: rect('sala-grande'),
        dentro: ['sala-qr-img', 'sala-empezar', 'sala-grande'].every(id => dentro(rect(id))),
        ultimo: nombres.length ? Math.max(...nombres) : 0, alto: innerHeight,
      });
    })()`));
    check(`${v.nombre}: el QR, Empezar la ronda y Volver quedan enteros dentro de la ventana`, m.dentro, JSON.stringify(m));
    if (v.qrMinimo) {
      check(
        `${v.nombre}: el QR mide ${v.qrMinimo} px o más`,
        m.qr.width >= v.qrMinimo && m.qr.height >= v.qrMinimo,
        JSON.stringify(m.qr),
      );
    }
    if (v.nombresAbajo) check("con diez nombres, el último llega al tercio inferior del proyector", m.ultimo >= m.alto * 2 / 3, JSON.stringify(m));
  }
  await pantalla.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await pantalla.eval(`document.getElementById('sala-grande').click()`);

  // Cerrar el QR: se deshace por cinco segundos, y recién ahí se cierra de verdad.
  await pantalla.eval(`document.getElementById('sala-cerrar').click()`);
  await pantalla.waitFor(`document.getElementById('sala-abierta').hidden`, 8000);
  check("y la pantalla lo dice", await pantalla.eval(`!document.getElementById('sala-deshacer').hidden && /QR cerrado/.test(document.getElementById('sala-deshacer-t').textContent)`));
  await sleep(6000);
  const cerrada = await fetch(`${sala}/v1/sala/${id}/nombres`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tinkazo.app" } });
  check("cerrar el QR la borra del servicio (404)", cerrada.status === 404);
  check("el celular ya no puede sumar: dice que el QR ya se cerró", (await sumar("Tarde")) && (await cel.eval(`/ya se cerró/.test(document.getElementById('msg').textContent)`)));
  check("no quedan los datos de la sala en la pestaña", await pantalla.eval(`sessionStorage.getItem('tinkazo.sala') === null`));
  check("sin excepciones en las dos páginas", pantalla.exceptions.length === 0 && cel.exceptions.length === 0, [...pantalla.exceptions, ...cel.exceptions].slice(0, 2).join(" | "));

  console.log(JSON.stringify({ auditor: "probar-sala", checks }));
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  intermediario.close();
  intermediario.closeAllConnections?.();
  await browser.close();
}
