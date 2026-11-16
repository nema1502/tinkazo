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
 * Antes, sin red ni sello: la vista de espectador con un enlace armado acá (una ronda que todavía no nació), en
 * anchos de celular de 320 a 414 px y en los dos temas, y el aviso de un enlace roto. Deja capturas en `--out`.
 *
 * Uso:
 *   CDP_PORT=<puerto> node scripts/audit-espectador.mjs --base http://localhost:4173 [--out DIR] [--sin-red]
 *
 * `--sin-red` corre solo lo de antes (un par de minutos, sin sellar nada). El sorteo de verdad tarda unos cinco
 * minutos: el sello, la ronda y el show en las dos pestañas. Sale con código 1 si algo falla.
 */

import { mkdir } from "node:fs/promises";
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

async function deVerdad(browser) {
  console.log("\nUn sorteo de verdad en Prueba, mirado desde el QR");
  const sala = await pestana(browser, { ancho: 1362, alto: 800, tema: "dark" });
  await sala.send("Page.navigate", { url: `${base}/?theme=dark&lang=es&pace=rapido&red=prueba` });
  await sala.waitFor("document.readyState === 'complete'", 20000);
  const modo = await sala.eval("String(sessionStorage.getItem('tinkazo.red'))");
  if (!check("la sala está en Prueba", modo === "prueba", modo)) return;
  await conectarCuentaDePrueba(sala);
  await sala.eval(`document.getElementById('nw').value = '1'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('btn-sample').click(); true`);
  await sleep(900);
  await sala.eval("document.getElementById('btn-freeze').click(); true");
  const sellada = await sala.waitFor(
    `getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' && getComputedStyle(document.getElementById('wait-box')).display !== 'none'`,
    240000,
  );
  if (!check("la lista quedó sellada", sellada.ok, sellada.ok ? `${(sellada.elapsed / 1000).toFixed(1)} s` : await sala.eval("(document.getElementById('seal-status') || {}).textContent || ''"))) return;
  const id = await sala.eval("((document.getElementById('wait-id') || {}).textContent || '').match(/\\d+/)?.[0] || ''");
  info(`sorteo #${id}`);

  await sala.eval("document.getElementById('btn-espera').click(); true");
  if (!check("la espera en grande abre", (await sala.waitFor("document.querySelector('.espera')", 15000)).ok)) return;
  const qr = await sala.waitFor("document.querySelector('.espera-qr[data-estado=listo], .espera-qr[data-estado=fallo]')", 20000);
  const estado = await sala.eval("(document.querySelector('.espera-qr') || {}).dataset?.estado || 'sin QR'");
  const corto = await sala.eval("(document.querySelector('.espera-qr') || {}).dataset?.enlace || ''");
  check("el QR sale con el enlace corto", qr.ok && estado === "listo" && /\/c\/[0-9A-Za-z]{8}#[A-Za-z0-9_-]{22}$/.test(corto), `${estado} ${corto.replace(/#.*/, "#…")}`);
  check("el QR nunca lleva el enlace largo con los nombres", !/espectador=/.test(corto));
  // Desde que el QR se ve, el juego de este sorteo queda (src/ui/espectador-fijo.ts): no hay Cambiar de juego.
  check("con el QR a la vista el juego queda: no hay Cambiar de juego", await sala.eval("![...document.querySelectorAll('.espera [data-juego]')].some((b) => !b.hidden)"));
  await sala.screenshot(join(outDir, "sala-espera-qr-1362-dark.png"));
  await sala.eval("document.documentElement.dataset.theme = 'light'; true");
  await sleep(400);
  await sala.screenshot(join(outDir, "sala-espera-qr-1362-light.png"));
  await sala.eval("document.documentElement.dataset.theme = 'dark'; true");
  // El proyector de siempre.
  await sala.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
  await sleep(700);
  await sala.screenshot(join(outDir, "sala-espera-qr-1280x720-dark.png"));
  check("en el proyector, la espera sin scroll horizontal", await sala.eval(SIN_SCROLL_X));
  await sala.send("Emulation.setDeviceMetricsOverride", { width: 1362, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1362, screenHeight: 800 });
  if (!corto) return;

  const cel = await pestana(browser, { ancho: 390, alto: 844, dpr: 2, celular: true, tema: "dark" });
  await cel.send("Page.navigate", { url: corto });
  const abrio = await cel.waitFor("document.querySelector('.espectador .espera-reloj')", 30000);
  if (!check("el celular abre la vista de espectador desde el enlace corto", abrio.ok)) return;
  const datos = JSON.parse(
    await cel.eval("JSON.stringify(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(location.hash.slice(12).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))))"),
  );
  check("el enlace lleva el número del sorteo y la red de Prueba", datos.i === id && datos.net === "testnet", `#${datos.i} en ${datos.net}`);
  check("en el celular se lee el número del sorteo", (await cel.eval("(document.querySelector('.espectador .espera-id') || {}).textContent || ''")).includes(id));
  check("en el celular, sin scroll horizontal", await cel.eval(SIN_SCROLL_X));
  await sleep(1500);
  const [rs, rc] = await Promise.all([sala.eval("(document.querySelector('.espera .espera-reloj') || {}).textContent || ''"), cel.eval("(document.querySelector('.espectador .espera-reloj') || {}).textContent || ''")]);
  const dif = Math.abs((segundosDe(rs) ?? -99) - (segundosDe(rc) ?? 99));
  check("la cuenta del celular dice lo mismo que la de la sala", dif <= 1, `sala ${rs}, celular ${rc}`);
  info(`visibilidad: sala ${await sala.eval("document.visibilityState")}, celular ${await cel.eval("document.visibilityState")}`);
  await cel.screenshot(join(outDir, "espectador-espera-sellado-390-dark.png"));

  // Los dos a la vez: cuándo arranca el juego y cuándo corona cada uno.
  const t = { salaJuego: 0, celJuego: 0, salaFin: 0, celFin: 0 };
  const JUEGO = "document.getElementById('stadium') && document.getElementById('stadium').style.display === 'block'";
  const t0 = Date.now();
  let capturaShow = false;
  let sinSaltar = null;
  while (Date.now() - t0 < 6 * 60_000 && !(t.salaFin && t.celFin)) {
    const [s, c] = await Promise.all([
      // La sala corona cuando el juego termina y pasa al resultado (`reveal` llena los ganadores de la página en ese
      // instante). La pantalla grande del resultado llega unos segundos después: no sirve para medir.
      sala.eval(`JSON.stringify({ juego: !!(${JUEGO}), fin: !!document.querySelector('#winner-cards .winner-card') })`).then(JSON.parse),
      cel.eval(`JSON.stringify({ juego: !!(${JUEGO}), fin: !!document.querySelector('.espectador-ganadores'), texto: (document.querySelector('.espectador .espera-sigue') || {}).textContent || '' })`).then(JSON.parse),
    ]);
    const ahora = Date.now();
    if (s.juego && !t.salaJuego) t.salaJuego = ahora;
    if (c.juego && !t.celJuego) t.celJuego = ahora;
    if (s.fin && !t.salaFin) t.salaFin = ahora;
    if (c.fin && !t.celFin) t.celFin = ahora;
    // En el celular el show no se salta (src/solo-mirar.ts): ni el Saltar del estadio ni el de la tarjeta.
    if (sinSaltar === null && (c.juego || (await cel.eval("!!document.querySelector('.game-card')")))) {
      sinSaltar = await cel.eval("document.getElementById('st-skip').hidden && !document.querySelector('.gc-saltar')");
    }
    if (c.juego && !capturaShow && ahora - t.celJuego > 4000) {
      capturaShow = true;
      await cel.screenshot(join(outDir, "espectador-show-390-dark.png"));
    }
    await sleep(250);
  }
  const s = (x) => (x ? `${((x - t0) / 1000).toFixed(1)} s` : "nunca");
  info(`juego: sala ${s(t.salaJuego)}, celular ${s(t.celJuego)} · corona: sala ${s(t.salaFin)}, celular ${s(t.celFin)}`);
  check("la sala y el celular llegan al resultado", !!(t.salaFin && t.celFin));
  check("en el celular no hay Saltar, ni en el estadio ni en la tarjeta", sinSaltar === true, String(sinSaltar));
  // Para leer los ganadores de la sala, su pantalla grande del resultado.
  await sala.waitFor("document.querySelector('.sala.pantalla')", 30000);
  check("el juego del celular no arranca antes que el de la sala", !!(t.salaJuego && t.celJuego) && t.celJuego >= t.salaJuego - 300);
  // La coronación se compara solo si el juego duró lo mismo en las dos pestañas. Este Chrome dibuja sin placa de video,
  // y con la máquina ocupada una pestaña puede atrasarse (medido el 15-nov: 54 s en el celular y 109 s en la sala, el
  // mismo juego al mismo ritmo). Lo que decide la regla es cuándo arranca: eso se mide siempre, arriba.
  const durSala = t.salaFin - t.salaJuego;
  const durCel = t.celFin - t.celJuego;
  if (t.salaFin && t.celFin && Math.abs(durSala - durCel) <= 0.15 * Math.max(durSala, durCel)) {
    check("el celular no corona antes que la sala", t.celFin >= t.salaFin - 300, `${((t.celFin - t.salaFin) / 1000).toFixed(1)} s detrás`);
  } else {
    info(`la coronación no se compara: el juego duró ${(durSala / 1000).toFixed(1)} s en la sala y ${(durCel / 1000).toFixed(1)} s en el celular`);
  }
  const enSala = JSON.parse(await sala.eval("JSON.stringify([...document.querySelectorAll('.sala.pantalla .pantalla-nombre')].map((e) => e.textContent.trim()))"));
  const enCel = JSON.parse(await cel.eval("JSON.stringify([...document.querySelectorAll('.espectador-ganadores li')].map((e) => e.textContent.trim()))"));
  check("los ganadores del celular son los de la sala", enSala.length > 0 && JSON.stringify(enSala) === JSON.stringify(enCel), `sala ${enSala.join(", ")} · celular ${enCel.join(", ")}`);
  await sala.screenshot(join(outDir, "sala-resultado-1362-dark.png"));
  await cel.screenshot(join(outDir, "espectador-fin-390-dark.png"));
  await cel.eval("document.documentElement.dataset.theme = 'light'; true");
  await sleep(400);
  await cel.screenshot(join(outDir, "espectador-fin-390-light.png"));
  check("al terminar, en el celular una sola acción principal", (await cel.eval("document.querySelectorAll('.espectador button.primary').length")) <= 1);
  await cerrar(cel);
  await cerrar(sala);
}

await mkdir(outDir, { recursive: true });
const browser = await launch({ width: 1362, height: 800 });
try {
  await sinSello(browser);
  if (!sinRed) await deVerdad(browser);
} catch (e) {
  check("el recorrido terminó", false, String(e?.message ?? e).slice(0, 160));
} finally {
  await browser.close();
}
console.log(`\n${fallas ? `${fallas} comprobaciones fallaron` : "Todo en orden"}. Capturas en ${outDir}`);
process.exit(fallas ? 1 : 0);
