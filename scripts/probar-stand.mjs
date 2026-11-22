#!/usr/bin/env node
/**
 * Prueba del modo stand con Chrome de verdad (DevTools, sin dependencias).
 *
 *   node scripts/probar-stand.mjs --base http://localhost:4173 [--rondas 8] [--captura salida/]
 *
 * Lo que comprueba (docs/ux.md y la sección 3 de la especificación del stand):
 *  1. Desde la portada, Tengo un stand entra al modo, que queda en la pestaña
 *     (sessionStorage) y no en la dirección.
 *  2. Con la red cortada de verdad (`Network.emulateNetworkConditions`, offline),
 *     cada ronda arranca sola, sale alguien, y no hay NINGÚN pedido a drand, a
 *     Stellar ni a nada de afuera. Cero pedidos que fallen.
 *  3. Nada se graba: ni Mis sorteos, ni borrador, ni premio recordado, ni enlace corto.
 *  4. El rótulo Ronda de ejemplo: no se puede comprobar está en el estadio y
 *     en el final de la ronda, la banda dice que es el modo stand, y no hay QR
 *     de comprobación, compartir ni ganó.
 *  5. Con `--salen N` (por defecto 1): el contador «Cuántos salen» marca N, el
 *     resumen lo dice, en cada ronda salen N personas distintas de la lista, y
 *     «Otra ronda» conserva la cantidad.
 *
 *  6. Lo que dice el relator dentro del estadio (la caja del relator y la línea para lectores de pantalla)
 *     tampoco habla de ganar, de premios ni de sellar: con varias personas por ronda el sapo, la chovena, el
 *     trompo, la piñata, La Entrada, Guajojó y El Toborochi dicen quién sale.
 *  7. Otra ronda arranca sola, y Cambiar la lista la frena y vuelve al cuadro.
 *
 * Con `--juegos` se elige cuántos juegos de la lista de siempre (un número) o cuáles (ids de botón separados por
 * comas, por ejemplo g-sapo,g-chovena,g-oruro).
 *
 * Un Chrome a la vez y con su propio puerto: CDP_PORT=<puerto>.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const rondas = Number(opt("--rondas", "5"));
const salida = opt("--captura", "");
const salen = Math.max(1, Math.min(10, Number(opt("--salen", "1")) || 1));
const JUEGOS = ["g-race", "g-sapo", "g-trompo", "g-chovena", "g-pinata", "g-wheel", "g-quien", "g-teleferico"];
const NOMBRES = Array.from({ length: 14 }, (_, i) => ["Ana", "Beto", "Carla", "Dani", "Eli", "Fede", "Gaby", "Hugo", "Iris", "Jose", "Kari", "Lucho", "Mara", "Nico"][i]).join("\n");

/** Lo que el stand no dice: ganar, premio ni sello. Palabras enteras, para no tomar «llegan». */
const PROHIBIDO_EN_EL_ESTADIO = /\bgan\p{L}*|premio|sell|\bwin(s|ner|ners|ning)?\b|prize|seal/iu;

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? ` (${detail})` : ""}`);
};

const browser = await launch({ width: 1280, height: 720 });
try {
  const page = await browser.open("about:blank");
  const pedidos = [];
  const fallidos = [];
  page.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.requestWillBeSent") pedidos.push(m.params.request.url);
    if (m.method === "Network.loadingFailed" && !m.params.canceled) fallidos.push(`${m.params.errorText} ${m.params.requestId}`);
  });
  await page.send("Network.enable");
  await page.send("Page.navigate", { url: `${base}/?lang=es&red=prueba` });
  await page.waitFor("document.querySelector('.hero [data-entrar-stand]')", 20000);
  await sleep(1500);

  // 1. Entrar desde la portada.
  check(
    "la portada ofrece Tengo un stand",
    await page.eval(`(() => {
      const b = document.querySelector('.hero [data-entrar-stand]');
      return !!b && b.textContent.trim() === 'Tengo un stand';
    })()`),
  );
  await page.eval(`document.querySelector('.hero [data-entrar-stand]').click()`);
  await sleep(500);
  check("el modo se marca en la pestaña y no en la dirección", await page.eval(`sessionStorage.getItem('tinkazo.stand') === '1' && !location.search.includes('stand')`));
  check(
    "la banda fija dice que es el modo stand, con rondas de ejemplo",
    await page.eval(`(() => {
      const b = document.getElementById('stand-banda');
      return !!b && b.offsetParent !== null && /rondas de ejemplo/.test(b.textContent);
    })()`),
  );
  check("el cuadro de la lista se puede escribir", await page.eval(`!document.getElementById('ta').readOnly && !document.getElementById('ta').disabled`));
  check("no hay campo de premio a la vista", await page.eval(`(() => { const p = document.getElementById('prize'); return !p || p.offsetParent === null; })()`));
  check("«Empezar la ronda» en lugar de «Sellar»", await page.eval(`/Empezar la ronda/.test(document.getElementById('btn-freeze').textContent)`));

  // El atajo y la recarga pasan también por el estado de la red: ninguno puede volver a decir Sellar la lista.
  await page.send("Page.navigate", { url: `${base}/?stand&lang=es&red=prueba` });
  await page.waitFor("document.body.dataset.stand === '1'", 10000);
  check(
    "entrar por /?stand mantiene Empezar la ronda",
    await page.eval(`/Empezar la ronda/.test(document.getElementById('btn-freeze').textContent)`),
  );
  await page.send("Page.reload");
  await page.waitFor("document.body.dataset.stand === '1'", 10000);
  check(
    "recargar dentro del stand mantiene Empezar la ronda",
    await page.eval(`/Empezar la ronda/.test(document.getElementById('btn-freeze').textContent)`),
  );

  // Los juegos de la prueba. Primero una vuelta con la red, para que cada juego quede cargado en la pestaña (como en el
  // stand: «los juegos visitados antes»); después se corta la red de verdad y se juegan las rondas.
  const externos = () => pedidos.filter((u) => !/^(http:\/\/localhost|http:\/\/127\.0\.0\.1|data:|blob:|about:|chrome)/.test(u));
  const juegosPedidos = opt("--juegos", "3");
  const elegidos = /^\d+$/.test(juegosPedidos) ? JUEGOS.slice(0, Number(juegosPedidos)) : juegosPedidos.split(",").map((x) => x.trim()).filter(Boolean);
  let n = 0;
  const ronda = async (juego, etiqueta, sinRed) => {
    n++;
    await page.eval(`(() => { const ta = document.getElementById('ta'); ta.value = ${JSON.stringify(NOMBRES)}; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.eval(`document.getElementById(${JSON.stringify(juego)}).click()`);
    // Cuántos salen: se elige en la primera ronda y las que siguen lo conservan (Otra ronda no lo toca).
    if (salen > 1 && n === 1) {
      await page.eval(`(() => { const b = document.querySelector('#nw-atajos button[data-n="${salen}"]'); if (b && !b.hidden) { b.click(); return; } for (let i = 1; i < ${salen}; i++) document.getElementById('nw-mas').click(); })()`);
    }
    if (salen > 1) {
      const c = JSON.parse(await page.eval(`JSON.stringify({ rotulo: document.getElementById('nw-etiqueta').textContent, valor: document.getElementById('nw-valor').textContent, resumen: document.getElementById('sellar-resumen').textContent, visible: document.getElementById('ganadores-control').offsetParent !== null })`));
      check(`${etiqueta} ${n}: Cuántos salen marca ${salen} y el resumen lo dice`, c.visible && c.rotulo === "Cuántos salen" && c.valor === String(salen) && c.resumen === `14 personas en la ronda, salen ${salen}`, JSON.stringify(c));
    }
    // Anota cada línea que el relator escribe en la ronda (la caja y la región de los lectores de pantalla).
    await page.eval(`(() => {
      window.__dichas = [];
      if (!window.__observados) {
        window.__observados = true;
        for (const id of ['commentary', 'commentary-sr']) {
          const el = document.getElementById(id);
          if (!el) continue;
          new MutationObserver(() => {
            const t = (el.textContent || '').trim();
            if (t && window.__dichas[window.__dichas.length - 1] !== t) window.__dichas.push(t);
          }).observe(el, { childList: true, characterData: true, subtree: true });
        }
      }
      return true;
    })()`);
    await page.eval(`document.getElementById('btn-freeze').click()`);
    const t0 = Date.now();
    const cuenta = await page.waitFor(`/Arranca en/.test(document.getElementById('btn-draw').textContent)`, 4000);
    check(`${etiqueta} ${n} (${juego}): dice «Arranca en»`, cuenta.ok);
    // El cartel de quien sale: en ese cuadro, el rótulo de ejemplo tiene que estar a la vista y sin que el cartel lo tape.
    if (n === 1) {
      const cartel = await page.waitFor(`document.querySelector('canvas[data-cartel]') !== null`, 90000);
      if (cartel.ok) {
        await sleep(600);
        const tamanos = [
          { ancho: 1280, alto: 720, nombre: "1280 por 720" },
          { ancho: 390, alto: 844, nombre: "390 por 844" },
          { ancho: 320, alto: 568, nombre: "320 por 568" },
        ];
        for (const v of tamanos) {
          await page.send("Emulation.setDeviceMetricsOverride", { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: false });
          await sleep(120);
          const c = JSON.parse(
            await page.eval(`(() => {
              const cv = document.querySelector('canvas[data-cartel]');
              if (!cv) return JSON.stringify({ hay: false });
              const [x, y, w, h] = cv.dataset.cartel.split(',').map(Number);
              const k = cv.getBoundingClientRect().width / cv.width;
              const r = document.getElementById('st-round').getBoundingClientRect();
              const s = getComputedStyle(document.getElementById('st-round'), '::after');
              const cx = cv.getBoundingClientRect().left + x * k, cy = cv.getBoundingClientRect().top + y * k;
              const choca = !(r.right <= cx || r.left >= cx + w * k || r.bottom <= cy || r.top >= cy + h * k);
              const visible = r.width > 40 && r.height > 10 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
              const rect = [r.left, r.top, r.width, r.height].map(Math.round);
              return JSON.stringify({ hay: true, visible, contenido: s.content, choca, rect });
            })()`),
          );
          check(
            `${v.nombre}: el rótulo de ejemplo está a la vista`,
            c.hay && c.visible && /no se puede comprobar/.test(c.contenido),
            JSON.stringify(c),
          );
          check(`${v.nombre}: el cartel no tapa el rótulo`, c.hay && !c.choca, JSON.stringify(c));
        }
        await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
        if (salida) {
          mkdirSync(salida, { recursive: true });
          await page.screenshot(join(salida, "stand-cartel.png"));
        }
      } else check("el cartel de quien sale llegó a mostrarse", false);
    }
    const fin = await page.waitFor(`document.querySelectorAll('.winner-name').length > 0 && document.getElementById('winner-box').style.display !== 'none'`, 90000);
    check(`${etiqueta} ${n} (${juego}): sale alguien${sinRed ? " sin red" : ""}`, fin.ok, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!fin.ok) return false;
    if (salida && n === 1) {
      mkdirSync(salida, { recursive: true });
      await page.screenshot(join(salida, "stand-final.png"));
    }
    const r = JSON.parse(
      await page.eval(`JSON.stringify({
        rotulo: getComputedStyle(document.getElementById('st-round'), '::after').content,
        nota: document.getElementById('stand-fin').textContent,
        ganó: /\bgan[óo]\b/i.test(document.body.innerText),
        finVisible: document.getElementById('stand-fin').offsetParent !== null,
        compartir: ['btn-proof','btn-whatsapp','btn-email','btn-grande'].some(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }),
        qr: ['qr-box','qr-img'].some(id => { const e = document.getElementById(id); return e && e.offsetParent !== null; }),
      })`),
    );
    check(`${etiqueta} ${n}: el rótulo del estadio es el de ejemplo`, /no se puede comprobar/.test(r.rotulo), r.rotulo);
    check(`${etiqueta} ${n}: el final dice una vez que no se puede comprobar`, /no se puede comprobar/.test(r.nota));
    check(`${etiqueta} ${n}: el final avisa que fue de ejemplo, sin compartir ni QR de comprobación`, r.finVisible && !r.compartir && !r.qr);
    check(`${etiqueta} ${n}: nunca dice «ganó»`, !r.ganó);
    const dichas = JSON.parse(await page.eval(`JSON.stringify(window.__dichas || [])`));
    const malas = dichas.filter((t) => PROHIBIDO_EN_EL_ESTADIO.test(t));
    check(`${etiqueta} ${n} (${juego}): el relator dijo ${dichas.length} líneas y ninguna habla de ganar, de premios ni de sellar`, dichas.length >= 3 && malas.length === 0, malas.length ? malas.join(" | ") : "");
    if (salen > 1) {
      const nombres = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('#winner-cards .winner-name')].map((e) => e.textContent.trim()))`));
      const lista = NOMBRES.split("\n");
      check(`${etiqueta} ${n}: salen ${salen} personas distintas, todas de la lista`, nombres.length === salen && new Set(nombres).size === salen && nombres.every((x) => lista.includes(x)), nombres.join(" | "));
    }
    await page.eval(`document.getElementById('stand-otra').click()`);
    const arranque = await page.waitFor(`/Arranca en/.test(document.getElementById('btn-draw').textContent)`, 4000);
    check(`${etiqueta} ${n}: Otra ronda arranca sola`, arranque.ok);
    await page.eval(`document.getElementById('stand-cambiar').click()`);
    const cambio = await page.waitFor(`document.getElementById('sec-frozen').style.display === 'none'`, 4000);
    check(`${etiqueta} ${n}: Cambiar la lista la frena y vuelve al cuadro`, cambio.ok);
    // Empezar la ronda no responde 700 ms después de soltar la ronda anterior.
    await sleep(1000);
    return true;
  };
  for (const j of elegidos) if (!(await ronda(j, "con red, ronda", false))) break;
  await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const antes = pedidos.length;
  fallidos.length = 0;
  for (let i = 0; i < rondas; i++) if (!(await ronda(elegidos[i % elegidos.length], "sin red, ronda", true))) break;
  const sinRed = pedidos.slice(antes);
  check("sin red: cero pedidos a sitios de afuera (drand, Stellar, Pollar)", externos().length === 0, externos().slice(0, 3).join(" | "));
  check("sin red: cero pedidos que fallen", fallidos.length === 0, fallidos.slice(0, 3).join(" | "));
  console.log(`  pedidos totales ${pedidos.length}, después de cortar la red ${sinRed.length}`);

  // 3. Nada se graba.
  const grabado = JSON.parse(
    await page.eval(`JSON.stringify(Object.fromEntries([...Object.keys(localStorage)].map(k => [k, localStorage.getItem(k).length])))`),
  );
  const raros = Object.keys(grabado).filter((k) => /histor|sorteo|premio|borrador|corto|draft|raffle/i.test(k));
  check("no queda nada en Mis sorteos, premio, borrador ni enlace corto", raros.length === 0, raros.join(", "));
  check("sin excepciones en la página", page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));

  // 4. Recargar dentro del modo: sigue.
  await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log(JSON.stringify({ auditor: "probar-stand", checks }));
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  await browser.close();
}
