#!/usr/bin/env node
/**
 * Auditor del espectador: el sorteo en vivo desde el QR de la espera (`src/ui/espectador.ts`).
 *
 * De punta a punta y de verdad, en Prueba, con la cuenta de prueba (como `audit-flujo.mjs`): quien organiza carga el
 * ejemplo, sella, abre la espera en grande y espera el QR. El QR tiene que llevar el enlace corto (los nombres nunca van
 * legibles en la pantalla). Ese enlace se abre en otra pestaña como celular, y se mira que:
 *
 *  - la vista del espectador abre con el número del sorteo y la red del enlace (Prueba), sin scroll horizontal;
 *  - su cuenta dice lo mismo que la de la sala;
 *  - el celular nunca corona antes que la sala: su juego arranca después que el de la sala y termina después;
 *  - los ganadores que ve son los mismos que la sala.
 *
 * Desde el 16 de noviembre de 2026 el celular juega a la par de la sala: arranca su juego a 2 s o menos de ella y
 * corona después, comparado con las horas que anota el estadio de cada pestaña (`data-arranco` y `data-corona`, el
 * mismo reloj en las dos), sin márgenes. Los recorridos (`--escenarios`, separados por comas, se pueden repetir):
 * `normal` y `rapido` (la espera lanza sola), `tarde` (la espera se cierra y el sorteo sale con el botón 20 s después
 * del número: el celular se detiene y no corona antes) y `cambio` (con el QR a la vista y el celular ya abierto, la sala
 * cambia el juego; con `--servicio-nuevo`, un build con el servicio de enlaces que puede cambiar, el celular juega el
 * nuevo; sin él, el del QR, sin romperse nada).
 *
 * Antes, sin red ni sello: la vista de espectador con un enlace armado acá (una ronda que todavía no nació), en
 * anchos de celular de 320 a 414 px y en los dos temas, y el aviso de un enlace roto. Deja capturas en `--out`.
 *
 * Uso:
 *   CDP_PORT=<puerto> node scripts/audit-espectador.mjs --base http://localhost:4173 [--out DIR] [--sin-red]
 *     [--escenarios normal,rapido,tarde,cambio] [--servicio-nuevo] [--solo-de-verdad] [--json ARCHIVO]
 *
 * `--sin-red` corre solo lo de antes (un par de minutos, sin sellar nada). Cada sorteo de verdad tarda unos tres
 * minutos: el sello, la ronda y el show en las dos pestañas. Sale con código 1 si algo falla.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { HAY_BOTON_ENTRAR_JS, TOCAR_ENTRAR_JS } from "./lib/entrar.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas/espectador");
const sinRed = args.includes("--sin-red");
const soloDeVerdad = args.includes("--solo-de-verdad");
const servicioNuevo = args.includes("--servicio-nuevo");
const escenarios = opt("--escenarios", "normal").split(",").filter(Boolean);
const archivoJson = opt("--json", "");
/** Lo medido en cada sorteo de verdad. */
const medidas = [];

let fallas = 0;
function check(nombre, ok, detalle = "") {
  if (!ok) fallas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
  return ok;
}
const info = (texto) => console.log(`  · ${texto}`);

/** La ronda de quicknet que nace dentro de `segundos`. */
const GENESIS = 1692803367;
const rondaDentroDe = (segundos) => Math.floor((Date.now() / 1000 + segundos - GENESIS) / 3) + 1;

/** El fragmento `#espectador=` de unos datos, como lo arma `enlaceEspectador`. */
const fragmento = (datos) => `#espectador=${Buffer.from(JSON.stringify({ v: 1, ...datos }), "utf8").toString("base64url")}`;

const SIN_SCROLL_X = "document.documentElement.scrollWidth <= innerWidth + 1";

async function pestana(browser, { ancho, alto, dpr = 1, celular = false, tema = "dark" }) {
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: celular, screenWidth: ancho, screenHeight: alto });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: tema }] });
  // Las dos pestañas corren a la vez: ninguna se toma por escondida (los juegos se dibujan con cada cuadro).
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
  return page;
}

async function cerrar(page) {
  try {
    await page.send("Page.close");
  } catch {
    /* ya cerrada */
  }
}

/* ------------------------------------------------------------ sin leer la cadena */

/** El contrato oficial de Prueba (`src/stellar/deployments.json`): el enlace del espectador siempre nombra uno. */
const CONTRATO_PRUEBA = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
/** Los RPC de Prueba (`RPC_LISTAS` en `src/stellar/config.ts`): sin ellos la vista se queda en la cuenta, sin decidir nada. */
const RPC_DE_PRUEBA = ["*soroban-testnet.stellar.org*", "*rpc.ankr.com*"];

async function sinSello(browser) {
  console.log("\nLa vista de espectador, con un enlace armado acá (sin leer la cadena)");
  const nombres = ["Ana Quispe", "Beto Mamani", "Cami Rojas", "Dani Flores", "Eva Choque", "Fito Vargas", "Gaby Torrez", "Hugo Condori", "Iris Mendoza", "Juan Pérez", "Kati Gutiérrez", "Lucho Arce"];
  const frag = fragmento({ r: rondaDentroDe(150), g: "race", p: "normal", w: 1, z: "Una polera", n: nombres, net: "testnet", k: CONTRATO_PRUEBA, i: "999999" });
  for (const tema of ["dark", "light"]) {
    for (const ancho of [320, 360, 375, 390, 414]) {
      const page = await pestana(browser, { ancho, alto: 780, dpr: 2, celular: true, tema });
      // Sin la cadena la vista no puede comparar el enlace con nada y se queda contando: una cadena muda no corta nada.
      await page.send("Network.enable");
      await page.send("Network.setBlockedURLs", { urls: RPC_DE_PRUEBA });
      await page.send("Page.navigate", { url: `${base}/?theme=${tema}&lang=es${frag}` });
      const abrio = await page.waitFor("document.querySelector('.espectador .espera-reloj')", 20000);
      const quien = `${ancho} px ${tema}`;
      if (!check(`${quien}: abre la vista de espectador`, abrio.ok)) {
        await cerrar(page);
        continue;
      }
      await sleep(1500);
      check(`${quien}: sin scroll horizontal`, await page.eval(SIN_SCROLL_X));
      const m = JSON.parse(await page.eval(`JSON.stringify((() => {
        const c = document.querySelector('.espectador');
        const r = c.querySelector('.espera-reloj').getBoundingClientRect();
        return { reloj: c.querySelector('.espera-reloj').textContent, arriba: Math.round(r.top), abajo: Math.round(r.bottom), alto: innerHeight, botones: c.querySelectorAll('button.primary').length };
      })())`));
      check(`${quien}: la cuenta se ve sin scroll`, m.abajo <= m.alto && m.arriba >= 0, `${m.reloj} en ${m.arriba}-${m.abajo} de ${m.alto}`);
      check(`${quien}: mientras espera no hay ninguna acción que compita`, m.botones === 0, `${m.botones} principales`);
      if (ancho === 390 || ancho === 320) await page.screenshot(join(outDir, `espectador-espera-${ancho}-${tema}.png`));
      await cerrar(page);
    }
  }
  // Un enlace sin el número del sorteo (el que antes salía sin sello): no abre la vista, dice que llegó roto.
  {
    const page = await pestana(browser, { ancho: 390, alto: 844, dpr: 2, celular: true, tema: "dark" });
    const libre = fragmento({ r: rondaDentroDe(150), g: "race", p: "normal", w: 1, n: nombres });
    await page.send("Page.navigate", { url: `${base}/?theme=dark&lang=es${libre}` });
    check("un enlace sin el número del sorteo no abre la vista: dice que llegó roto", (await page.waitFor("document.querySelector('.espectador-roto')", 20000)).ok);
    await cerrar(page);
  }
  // El enlace roto: lo dice, con una sola acción.
  for (const tema of ["dark", "light"]) {
    const page = await pestana(browser, { ancho: 390, alto: 844, dpr: 2, celular: true, tema });
    await page.send("Page.navigate", { url: `${base}/?theme=${tema}&lang=es#espectador=eyJ2IjoxLCJyIjo` });
    const roto = await page.waitFor("document.querySelector('.espectador-roto')", 20000);
    check(`enlace roto ${tema}: lo dice en vez de caer callado en la herramienta`, roto.ok);
    if (roto.ok) {
      check(`enlace roto ${tema}: una sola acción`, (await page.eval("document.querySelectorAll('.espectador-roto button').length")) === 1);
      await page.screenshot(join(outDir, `espectador-enlace-roto-390-${tema}.png`));
    }
    await cerrar(page);
  }
}

/* ------------------------------------------------------------ de verdad, en Prueba */

async function conectarCuentaDePrueba(page) {
  if ((await page.eval("String(!!localStorage.getItem('tinkazo.guest.secret.testnet'))")) === "true") {
    const vuelta = await page.waitFor("document.querySelector('#wallet-box .hello')", 30000);
    if (!vuelta.ok) throw new Error("la cuenta de prueba de antes no se retomó");
    return;
  }
  await page.waitFor(HAY_BOTON_ENTRAR_JS, 20000);
  await sleep(500);
  await page.eval(TOCAR_ENTRAR_JS);
  if (!(await page.waitFor("document.querySelector('.login-opt')", 15000)).ok) throw new Error("no se abrió la ventana de ingreso");
  await sleep(300);
  const i = await page.eval(`String([...document.querySelectorAll('.login-opt')].findIndex((e) => /prueba|Test account/.test(e.textContent)))`);
  if (i === "-1") throw new Error("la ventana de ingreso no ofrece la cuenta de prueba");
  await page.eval(`[...document.querySelectorAll('.login-opt')][${i}].click(); true`);
  if (!(await page.waitFor("!document.querySelector('.modal-back') && document.querySelector('#wallet-box .hello')", 120000)).ok) {
    throw new Error("la cuenta de prueba no quedó conectada");
  }
  await sleep(900);
}

/** Los segundos de una cuenta `m:ss`. */
const segundosDe = (txt) => {
  const m = /(\d+):(\d\d)/.exec(txt || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** La ronda de quicknet `r`: cuándo nace, en ms. */
const nace = (r) => (GENESIS + (r - 1) * 3) * 1000;

/** Lo que se ve en una pestaña: el estadio, la tarjeta, la línea de espera y las horas que anota el estadio. */
const ESTADO = `JSON.stringify((() => {
  const base = document.getElementById("race-canvas");
  const st = document.getElementById("stadium");
  return {
    juego: !!st && st.style.display === "block",
    tarjeta: !!document.querySelector(".game-card"),
    tarjetaJuego: ((document.querySelector("#gc-nombre") || {}).textContent || "").trim(),
    telon: ((document.querySelector(".espectador-telon") || {}).textContent || "").trim(),
    arranco: base && base.dataset.arranco ? Number(base.dataset.arranco) : 0,
    corona: base && base.dataset.corona ? Number(base.dataset.corona) : 0,
    retenido: base && base.dataset.retenido ? Number(base.dataset.retenido) : 0,
    finCel: !!document.querySelector(".espectador-ganadores"),
    finSala: !!document.querySelector("#winner-cards .winner-card"),
    vis: document.visibilityState,
    paraGrabar: document.documentElement.dataset.paraGrabar || "",
    puerta: document.documentElement.dataset.puerta || "",
    ahora: Date.now(),
  };
})())`;

/** Los datos del enlace del celular, del fragmento (sin la referencia al enlace corto, si la trae). */
const DATOS_DEL_CELULAR = "JSON.stringify(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(location.hash.slice(12).split('.')[0].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))))";

/**
 * Un sorteo de verdad en Prueba, mirado desde el QR. `escenario`:
 * - `normal` y `rapido`: la espera en grande lanza sola, en Normal o en Rápido. El celular arranca a 2 s o menos de la
 *   sala y corona después, con el mismo ganador.
 * - `tarde`: se cierra la espera antes de que lance y el sorteo se lanza con el botón 20 s después del número. El
 *   celular no corona antes que la sala.
 * - `cambio`: con el QR a la vista y el celular ya abierto, la sala cambia el juego. Con el servicio de enlaces que
 *   puede cambiar (`--servicio-nuevo`), el QR queda y el celular juega el juego nuevo; con el de hoy, el QR se rearma y
 *   el celular de antes juega el del QR, sin romperse nada.
 */
async function deVerdad(browser, escenario, n) {
  const nombre = `${escenario}${n > 1 ? `-${n}` : ""}`;
  console.log(`\nUn sorteo de verdad en Prueba, mirado desde el QR: ${nombre}`);
  const ritmo = escenario === "rapido" ? "rapido" : "normal";
  const sala = await pestana(browser, { ancho: 1362, alto: 800, tema: "dark" });
  // El 2D en las dos pestañas: este Chrome dibuja sin placa de video, y el 3D de las dos a la vez lo frena.
  await sala.send("Page.navigate", { url: `${base}/?theme=dark&lang=es&pace=${ritmo}&red=prueba&auditar=espectador` });
  await sala.waitFor("document.readyState === 'complete'", 20000);
  await sala.eval("localStorage.setItem('tinkazo.ver3d', '0'); true");
  const modo = await sala.eval("String(sessionStorage.getItem('tinkazo.red'))");
  if (!check(`${nombre}: la sala está en Prueba`, modo === "prueba", modo)) return null;
  await conectarCuentaDePrueba(sala);
  await sala.eval(`document.getElementById('nw').value = '1'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('btn-sample').click(); true`);
  await sleep(900);
  await sala.eval("document.getElementById('btn-freeze').click(); true");
  const sellada = await sala.waitFor(
    `getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' && getComputedStyle(document.getElementById('wait-box')).display !== 'none'`,
    240000,
  );
  if (!check(`${nombre}: la lista quedó sellada`, sellada.ok, sellada.ok ? `${(sellada.elapsed / 1000).toFixed(1)} s` : await sala.eval("(document.getElementById('seal-status') || {}).textContent || ''"))) return null;
  const id = await sala.eval("((document.getElementById('wait-id') || {}).textContent || '').match(/\\d+/)?.[0] || ''");
  info(`sorteo #${id}`);

  if (!(await sala.eval("!!document.querySelector('.espera')"))) await sala.eval("document.getElementById('btn-espera').click(); true");
  if (!check(`${nombre}: la espera en grande abre`, (await sala.waitFor("document.querySelector('.espera')", 15000)).ok)) return null;
  const qr = await sala.waitFor("document.querySelector('.espera-qr[data-estado=listo], .espera-qr[data-estado=fallo]')", 20000);
  const estado = await sala.eval("(document.querySelector('.espera-qr') || {}).dataset?.estado || 'sin QR'");
  const corto = await sala.eval("(document.querySelector('.espera-qr') || {}).dataset?.enlace || ''");
  check(`${nombre}: el QR sale con el enlace corto`, qr.ok && estado === "listo" && /\/c\/[0-9A-Za-z]{8}#[A-Za-z0-9_-]{22}$/.test(corto), `${estado} ${corto.replace(/#.*/, "#…")}`);
  check(`${nombre}: con el QR a la vista sigue Cambiar de juego`, await sala.eval("[...document.querySelectorAll('.espera [data-juego]')].some((b) => b.offsetParent !== null)"));
  if (!corto) return null;

  const cel = await pestana(browser, { ancho: 390, alto: 844, dpr: 2, celular: true, tema: "dark" });
  await cel.send("Page.navigate", { url: corto });
  const abrio = await cel.waitFor("document.querySelector('.espectador .espera-reloj')", 30000);
  if (!check(`${nombre}: el celular abre la vista de espectador desde el enlace corto`, abrio.ok)) return null;
  const datos = JSON.parse(await cel.eval(DATOS_DEL_CELULAR));
  check(`${nombre}: el enlace es de este sorteo, en Prueba, con la sala a la par (h)`, datos.i === id && datos.net === "testnet" && datos.h === 1, `#${datos.i} ${datos.net} h=${datos.h}`);
  const conRef = await cel.eval("/\\.[0-9A-Za-z]{8}\\.[A-Za-z0-9_-]{22}\\.\\d+$/.test(location.hash)");
  info(`el celular ${conRef ? "trae" : "no trae"} la referencia del enlace que puede cambiar`);
  const N = nace(datos.r);
  await sleep(1000);
  const [rs, rc] = await Promise.all([sala.eval("(document.querySelector('.espera .espera-reloj') || {}).textContent || ''"), cel.eval("(document.querySelector('.espectador .espera-reloj') || {}).textContent || ''")]);
  check(`${nombre}: la cuenta del celular dice lo mismo que la de la sala`, Math.abs((segundosDe(rs) ?? -99) - (segundosDe(rc) ?? 99)) <= 1, `sala ${rs}, celular ${rc}`);
  await cel.screenshot(join(outDir, `${nombre}-cel-1-cuenta-390.png`));

  // El cambio de juego con el QR a la vista, con el celular ya abierto.
  let juegoNuevo = "";
  let nombreNuevo = "";
  let nombreViejo = "";
  if (escenario === "cambio") {
    const antes = await sala.eval("(document.querySelector('.espera-qr') || {}).dataset?.enlace || ''");
    nombreViejo = await sala.eval("(document.querySelector('.espera .espera-juego-n b') || {}).textContent || ''");
    await sala.eval("[...document.querySelectorAll('.espera [data-juego]')].find((b) => b.offsetParent !== null).click(); true");
    await sala.waitFor("document.querySelector('.espera-juegos') && !document.querySelector('.espera-juegos').hidden", 5000);
    juegoNuevo = await sala.eval("(() => { const b = [...document.querySelectorAll('.espera-juego-op')].find((x) => x.getAttribute('aria-pressed') !== 'true' && !x.classList.contains('no-encaja')); b.click(); return b.dataset.game; })()");
    await sala.waitFor(`document.querySelector('.espera-qr[data-estado=listo]') && (document.querySelector('.espera .espera-juego-n b') || {}).textContent !== ${JSON.stringify(nombreViejo)}`, 15000);
    await sleep(2500);
    nombreNuevo = await sala.eval("(document.querySelector('.espera .espera-juego-n b') || {}).textContent || ''");
    const despues = await sala.eval("(document.querySelector('.espera-qr') || {}).dataset?.enlace || ''");
    const anterior = await sala.eval("!(document.querySelector('.espera-qr-anterior') || { hidden: true }).hidden");
    info(`la sala cambió de ${nombreViejo} a ${nombreNuevo} (${juegoNuevo}); el QR ${despues === antes ? "quedó igual" : "es otro"}; la línea del juego anterior ${anterior ? "se ve" : "no se ve"}`);
    if (servicioNuevo) {
      check(`${nombre}: con el servicio nuevo el QR queda igual y no hay línea del juego anterior`, despues === antes && !anterior);
    } else {
      check(`${nombre}: con el servicio de hoy el QR se rearma y dice que quienes escanearon lo ven con el juego anterior`, despues !== antes && anterior);
    }
    await sala.screenshot(join(outDir, `${nombre}-sala-espera-tras-el-cambio-1362.png`));
  }

  // La sala que lanza tarde: se cierra la espera antes de que lance y el sorteo sale con el botón 20 s después del número.
  if (escenario === "tarde") {
    const falta = N - 4000 - Date.now();
    if (falta > 0) await sleep(falta);
    await sala.eval("(document.querySelector('.espera [data-volver]') || {}).click?.(); true");
    check(`${nombre}: la espera se cerró antes de lanzar`, await sala.eval("!document.querySelector('.espera')"));
  }

  const t = { salaJuego: 0, celJuego: 0, salaFin: 0, celFin: 0, celTarjeta: 0 };
  const capturas = new Set();
  const captura = async (clave, archivo) => {
    if (capturas.has(clave)) return;
    capturas.add(clave);
    await cel.screenshot(join(outDir, `${nombre}-cel-${archivo}-390.png`));
  };
  let tarjetaDelCelular = "";
  let lanzado = false;
  let telonVisto = "";
  const t0 = Date.now();
  let ultimoS = null;
  let ultimoC = null;
  const escondidas = { sala: 0, celular: 0 };
  while (Date.now() - t0 < 8 * 60_000 && !(t.salaFin && t.celFin)) {
    if (escenario === "tarde" && !lanzado && Date.now() >= N + 20_000) {
      lanzado = true;
      await sala.eval("document.getElementById('btn-draw').click(); true");
      info(`la sala lanzó con el botón ${((Date.now() - N) / 1000).toFixed(1)} s después del número`);
    }
    const [s, c] = await Promise.all([sala.eval(ESTADO).then(JSON.parse), cel.eval(ESTADO).then(JSON.parse)]);
    ultimoS = s;
    ultimoC = c;
    if (s.vis !== "visible") escondidas.sala++;
    if (c.vis !== "visible") escondidas.celular++;
    const ahora = Date.now();
    if (s.juego && !t.salaJuego) t.salaJuego = ahora;
    if (c.juego && !t.celJuego) t.celJuego = ahora;
    if (s.finSala && !t.salaFin) t.salaFin = ahora;
    if (c.finCel && !t.celFin) t.celFin = ahora;
    if (c.tarjeta && !t.celTarjeta) {
      t.celTarjeta = ahora;
      tarjetaDelCelular = c.tarjetaJuego;
    }
    if (c.tarjeta) await captura("tarjeta", "2-tarjeta");
    if (c.juego && ahora - t.celJuego > 4000 && !c.telon) await captura("juego", "3-juego");
    if (c.telon) {
      telonVisto = c.telon;
      await captura("telon", "4-retenido");
    }
    if (c.finCel) await captura("fin", "5-lo-que-salio");
    await sleep(250);
  }
  const fin = { s: ultimoS, c: ultimoC };
  const seg = (x) => (x ? `${((x - N) / 1000).toFixed(2)} s` : "nunca");
  const medida = {
    escenario: nombre,
    sorteo: id,
    ronda: datos.r,
    salaArranco: fin.s?.arranco ? (fin.s.arranco - N) / 1000 : null,
    celArranco: fin.c?.arranco ? (fin.c.arranco - N) / 1000 : null,
    salaCorona: fin.s?.corona ? (fin.s.corona - N) / 1000 : null,
    celCorona: fin.c?.corona ? (fin.c.corona - N) / 1000 : null,
    celRetenido: fin.c?.retenido ?? 0,
    salaResultado: t.salaFin ? (t.salaFin - N) / 1000 : null,
    celLoQueSalio: t.celFin ? (t.celFin - N) / 1000 : null,
    telon: telonVisto,
    tarjetaDelCelular,
    puerta: fin.s?.puerta ?? "",
    paraGrabar: fin.s?.paraGrabar ?? "",
    visibilidad: { sala: fin.s?.vis, celular: fin.c?.vis, salaEscondida: escondidas.sala, celularEscondido: escondidas.celular },
  };
  info(`desde el número: juego sala ${seg(fin.s?.arranco)}, celular ${seg(fin.c?.arranco)} · corona sala ${seg(fin.s?.corona)}, celular ${seg(fin.c?.corona)} · retenido ${medida.celRetenido} s · Lo que salió ${seg(t.celFin)}`);
  check(`${nombre}: la sala y el celular llegan al resultado`, !!(t.salaFin && t.celFin));
  check(`${nombre}: el estadio de los dos anotó su arranque y su corona`, !!(fin.s?.arranco && fin.c?.arranco && fin.s?.corona && fin.c?.corona));
  if (fin.s?.corona && fin.c?.corona) {
    // Estricto: el reloj de las dos pestañas es el mismo. Coronar a la vez o antes es una falla.
    check(`${nombre}: el celular corona después que la sala`, fin.c.corona > fin.s.corona, `${((fin.c.corona - fin.s.corona) / 1000).toFixed(2)} s detrás`);
  }
  if (escenario === "normal" || escenario === "rapido" || (escenario === "cambio" && servicioNuevo)) {
    if (fin.s?.arranco && fin.c?.arranco) {
      const d = (fin.c.arranco - fin.s.arranco) / 1000;
      check(`${nombre}: el celular arranca su juego a 2 s o menos de la sala, y no antes`, d >= 0 && d <= 2, `${d.toFixed(2)} s`);
    }
  }
  if (escenario === "tarde") check(`${nombre}: con la sala tardía el celular se detuvo antes de su final`, medida.celRetenido > 0, `${medida.celRetenido} s`);
  if (escenario === "cambio") {
    if (servicioNuevo) check(`${nombre}: el celular que escaneó antes juega el juego nuevo`, tarjetaDelCelular === nombreNuevo || tarjetaDelCelular.includes(nombreNuevo), `tarjeta del celular: ${tarjetaDelCelular}`);
    else check(`${nombre}: con el servicio de hoy el celular de antes juega el del QR`, tarjetaDelCelular === nombreViejo || tarjetaDelCelular.includes(nombreViejo), `tarjeta del celular: ${tarjetaDelCelular}`);
  }
  // Los ganadores de la sala: los de su pantalla grande del resultado, o los de la página si se cerró la espera (tarde).
  if (escenario !== "tarde") await sala.waitFor("document.querySelector('.sala.pantalla')", 30000);
  const enSala = JSON.parse(await sala.eval("JSON.stringify((() => { const g = [...document.querySelectorAll('.sala.pantalla .pantalla-nombre')]; return (g.length ? g : [...document.querySelectorAll('#winner-cards .winner-name')]).map((e) => e.textContent.trim()); })())"));
  const enCel = JSON.parse(await cel.eval("JSON.stringify([...document.querySelectorAll('.espectador-ganadores li')].map((e) => e.textContent.trim()))"));
  check(`${nombre}: los ganadores del celular son los de la sala`, enSala.length > 0 && JSON.stringify(enSala) === JSON.stringify(enCel), `sala ${enSala.join(", ")} · celular ${enCel.join(", ")}`);
  check(`${nombre}: sin errores en la consola de las dos pestañas`, sala.exceptions.length === 0 && cel.exceptions.length === 0, [...sala.exceptions, ...cel.exceptions].join(" | ").slice(0, 200));
  await cel.screenshot(join(outDir, `${nombre}-cel-5-lo-que-salio-390.png`));
  check(`${nombre}: al terminar, en el celular una sola acción principal`, (await cel.eval("document.querySelectorAll('.espectador button.primary').length")) <= 1);
  medidas.push(medida);
  await cerrar(cel);
  await cerrar(sala);
  return medida;
}

await mkdir(outDir, { recursive: true });
const browser = await launch({ width: 1362, height: 800 });
try {
  if (!soloDeVerdad) await sinSello(browser);
  if (!sinRed) {
    const vistos = new Map();
    for (const e of escenarios) {
      vistos.set(e, (vistos.get(e) ?? 0) + 1);
      await deVerdad(browser, e, vistos.get(e));
    }
  }
} catch (e) {
  check("el recorrido terminó", false, String(e?.message ?? e).slice(0, 160));
} finally {
  await browser.close();
}
if (archivoJson) await writeFile(archivoJson, JSON.stringify(medidas, null, 2));
if (medidas.length) console.log(`\nLo medido (segundos desde el número):\n${medidas.map((m) => JSON.stringify(m)).join("\n")}`);
console.log(`\n${fallas ? `${fallas} comprobaciones fallaron` : "Todo en orden"}. Capturas en ${outDir}`);
process.exit(fallas ? 1 : 0);
