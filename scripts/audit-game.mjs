#!/usr/bin/env node
/**
 * Auditor de juegos de Tinkazo.
 *
 * Todo juego nuevo tiene que pasar esta auditoría antes de entrar. Lo que se
 * comprueba no es que se vea lindo: es que **el juego no decida nada**. El
 * ganador lo fija el protocolo (docs/protocolo.md) y el juego solo lo cuenta.
 *
 * Uso:
 *   node scripts/audit-game.mjs <juego> [--base http://localhost:4173] [--out docs/capturas]
 *
 * `<juego>` es el valor de `?demo=`: race, stellar, wheel…
 *
 * Sale con código 0 si pasan todas las comprobaciones. Con 1 si alguna falla, y
 * la lista dice cuál.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const game = args.find((a) => !a.startsWith("--"));
if (!game) {
  console.error("uso: node scripts/audit-game.mjs <juego> [--base URL] [--out DIR]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas");
const lead = opt("--lead", "3");

/** Lista de ejemplo del sitio, en el mismo orden. Debe coincidir con src/state.ts. */
const SAMPLE = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Lee del DOM todo lo que la auditoría necesita. */
const READ_STATE = `JSON.stringify({
  winners: [...document.querySelectorAll('.winner-name')].map(e => e.textContent),
  proof: document.getElementById('proof')?.textContent || '',
  options: [...document.querySelectorAll('.gamepick button')].map(b => ({
    id: b.id, text: b.textContent, key: b.getAttribute('data-i') || '',
    on: b.classList.contains('on'), disabled: b.disabled,
  })),
  drandLink: document.getElementById('drand-link')?.getAttribute('href') || '',
  whatsapp: document.getElementById('btn-whatsapp')?.getAttribute('href') || '',
  stadiumVisible: getComputedStyle(document.getElementById('stadium')).display !== 'none',
  bodyOverflow: document.body.style.overflow,
  lore: (() => {
    const l = document.getElementById('lore-box');
    if (!l || getComputedStyle(l).display === 'none') return null;
    return {
      q: l.querySelector('.lore-q')?.textContent || '',
      a: l.querySelector('.lore-a')?.textContent || '',
      href: l.querySelector('a')?.getAttribute('href') || '',
      // Tiene que venir después del ganador, no antes.
      afterWinner: !!document.getElementById('winner-cards') &&
        (document.getElementById('winner-cards').compareDocumentPosition(l) & 4) !== 0,
    };
  })(),
})`;

async function run() {
  await mkdir(outDir, { recursive: true });
  const browser = await launch({ width: 1280, height: 720 });
  try {
    // ---------------------------------------------------------- 1. el sorteo
    console.log(`\nAuditando "${game}" contra ${base}\n`);
    const url = `${base}/?demo=${encodeURIComponent(game)}&lead=${lead}`;
    const page = await browser.open(url);
    const drew = await page.waitFor("document.querySelectorAll('.winner-name').length > 0", 120_000);
    check("el sorteo termina y muestra un ganador", drew.ok, `${(drew.elapsed / 1000).toFixed(1)} s`);
    if (!drew.ok) return;

    const s = JSON.parse(await page.eval(READ_STATE));

    // -------------------------------------- 2. el juego no decide el ganador
    const m = /winners=\[([0-9,]+)\]/.exec(s.proof);
    const idx = m?.[1] ? m[1].split(",").map(Number) : [];
    const expected = idx.map((i) => SAMPLE[i]);
    check(
      "el ganador en pantalla es el que fijó el protocolo",
      idx.length > 0 && JSON.stringify(expected) === JSON.stringify(s.winners),
      `protocolo ${JSON.stringify(expected)} · pantalla ${JSON.stringify(s.winners)}`,
    );

    // --------------------------------- 3. la prueba de imparcialidad se llena
    check(
      "la firma de la ronda quedó verificada",
      /signature verified ✓/.test(s.proof) && /quicknet round=\d+/.test(s.proof),
      s.proof.slice(0, 60) + "…",
    );
    check("el enlace a la ronda pública apunta a drand", s.drandLink.includes("api.drand.sh"));
    check("el aviso al ganador queda armado", s.whatsapp.startsWith("https://wa.me/?text="));

    // ------------------------------------------- 4. la pantalla queda limpia
    check("el juego devolvió la pantalla al terminar", !s.stadiumVisible && s.bodyOverflow !== "hidden");

    // ------------------------------------- 5. el juego aparece en el selector
    const option = s.options.find((o) => o.id === `g-${game}`);
    check(
      "el juego tiene su botón en el selector",
      !!option,
      option ? `"${option.text.trim()}"` : `falta #g-${game}`,
    );

    // ------------------------------------------------ 6. sin errores de JS
    check(
      "no hubo excepciones en consola",
      page.exceptions.length === 0,
      page.exceptions.slice(0, 2).join(" | "),
    );

    // ------------------------------------------- 8. la tarjeta que enseña
    // Sale después del ganador, con las dos frases traducidas y con su fuente.
    // Una clave sin traducir se delata sola: `t()` devuelve la clave.
    const lore = s.lore;
    check(
      "la tarjeta de historia sale después del ganador",
      !!lore && lore.afterWinner && lore.q.length > 4 && !/^lore[A-Z]/.test(lore.q),
      lore ? `"${lore.q}"` : "no apareció",
    );
    check(
      "la tarjeta cita una fuente",
      !!lore && /^https:\/\//.test(lore.href),
      lore?.href || "sin enlace",
    );

    await page.screenshot(join(outDir, `juego-${game}.png`));

    // ------------------------------ 7. con dos premios, el juego dice los dos
    // Salió un sorteo de dos ganadores en el que el juego y la voz anunciaban
    // uno solo: "el ganador es tal". El auditor corría siempre con un premio,
    // así que no podía verlo. La comprobación mira el comentario del estadio
    // mientras el juego corre, que es donde estaba la mentira.
    // Y corre en un celular, que es donde el cartel del ganador tiene más
    // chance de no entrar: el tamaño de la tipografía sale del alto de la
    // pantalla, y en vertical eso no dice nada del ancho.
    const dos = await browser.open("about:blank");
    await dos.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844,
    });
    await dos.send("Page.navigate", { url: `${url}&nw=2` });
    const dichos = new Set();
    let salio = false;
    let cartel = null;
    for (let i = 0; i < 900 && !salio; i++) {
      const linea = await dos.eval(
        `(document.querySelector('.commentary') || {}).textContent || ''`,
      );
      if (linea) dichos.add(linea.trim());
      // El cartel es la BANDA amarilla ancha, no cualquier amarillo: el
      // confeti también es amarillo y cae contra los dos bordes, así que
      // contando píxeles sueltos la comprobación fallaba sola una de cada dos
      // corridas. Se mide por filas, quedándose con el tramo contiguo más
      // largo de cada una, y solo cuentan las filas donde ese tramo pasa el
      // cuarto del ancho. Si se sale del lienzo el navegador lo recorta sin
      // avisar, y eso se ve porque la banda toca los dos bordes a la vez.
      // Cada cuatro sondeos, no todos: leer el lienzo entero fuerza una
      // lectura de vuelta desde la GPU y le compite al juego por el hilo. El
      // cartel dura tres segundos, así que uno cada 0,8 no se pierde ninguno.
      const am = i % 4 !== 0 ? "" : await dos.eval(`(() => {
        const cv = document.querySelector('.stadium canvas');
        if (!cv || document.getElementById('stadium').style.display !== 'block') return '';
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        const esAmarillo = (i) => d[i] > 235 && d[i + 1] > 180 && d[i + 1] < 225 && d[i + 2] < 85;
        const ancho = cv.width, alto = cv.height;
        let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
        for (let y = 0; y < alto; y += 4) {
          let corre = 0, desde = 0, mejor = 0, mejorDesde = 0;
          for (let x = 0; x < ancho; x += 4) {
            if (esAmarillo((y * ancho + x) * 4)) {
              if (corre === 0) desde = x;
              corre += 4;
              if (corre > mejor) { mejor = corre; mejorDesde = desde; }
            } else corre = 0;
          }
          if (mejor > ancho * 0.25) {
            n += mejor / 4;
            x0 = Math.min(x0, mejorDesde); x1 = Math.max(x1, mejorDesde + mejor);
            y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
        }
        if (x1 < 0) return '';
        const area = n / ((ancho / 4) * (alto / 4));
        return area > 0.02 ? JSON.stringify({
          area, izq: x0 < 8, der: x1 > ancho - 12, arr: y0 < 8, aba: y1 > alto - 12,
        }) : '';
      })()`);

      if (am && !cartel) {
        cartel = JSON.parse(am);
        await dos.screenshot(join(outDir, `juego-${game}-celular-ganador.png`));
      }
      salio = (await dos.eval(`String(document.querySelectorAll('.winner-name').length > 0)`)) === "true";
      if (!salio) await sleep(200);
    }
    const dosState = JSON.parse(await dos.eval(READ_STATE));
    const nombres = dosState.winners.map((x) => String(x).trim()).filter(Boolean);
    const anuncio = [...dichos].find((x) => nombres.length === 2 && nombres.every((n) => x.includes(n)));
    check(
      "con dos premios el juego anuncia a los dos",
      salio && nombres.length === 2 && !!anuncio,
      anuncio ? `"${anuncio.slice(0, 64)}"` : `en pantalla ${JSON.stringify(nombres)}`,
    );

    check(
      "en un celular el cartel del ganador entra en la pantalla",
      !!cartel && !(cartel.izq && cartel.der) && !(cartel.arr && cartel.aba),
      cartel
        ? `ocupa el ${(cartel.area * 100).toFixed(0)}% · bordes ${cartel.izq ? "izq " : ""}${cartel.der ? "der " : ""}${cartel.arr ? "arr " : ""}${cartel.aba ? "aba" : ""}`.trim()
        : "no se encontró el cartel",
    );

    // ------------------------------------------------------- 8. en inglés
    const en = await browser.open(`${url}&lang=en&instant=1`);
    const enOk = await en.waitFor("document.querySelectorAll('.winner-name').length > 0", 120_000);
    const enState = JSON.parse(await en.eval(READ_STATE));
    const enOption = enState.options.find((o) => o.id === `g-${game}`);
    check("el sorteo también corre en inglés", enOk.ok);
    check(
      "la tarjeta de historia también está en inglés",
      !!enState.lore && !!s.lore && enState.lore.a.length > 10 && enState.lore.a !== s.lore.a,
      enState.lore ? `"${enState.lore.q}"` : "no apareció",
    );
    // El nombre del juego tiene que estar en los dos diccionarios. No se puede
    // exigir que el texto cambie: "Pasanaku" es un nombre propio y en inglés se
    // dice igual. Lo que se comprueba es que la clave exista dos veces en
    // `src/i18n.ts`, una por idioma, que es lo que detecta la mitad olvidada.
    const key = option?.key || "";
    const dict = await readFile("src/i18n.ts", "utf8").catch(() => "");
    const times = key ? dict.split(`${key}:`).length - 1 : 0;
    check(
      "el nombre del juego está en los dos diccionarios",
      !!enOption && times >= 2,
      key ? `${key} aparece ${times} vez/veces · en inglés "${enOption?.text.trim() ?? "?"}"` : "sin data-i",
    );

    // -------------------------------------------- 9. en la mano, no en un muro
    // El estadio está pensado para un proyector, y se auditaba sólo a 1280x720.
    // Pero el organizador prueba el sorteo en su celular antes del evento, y a
    // 390x844 la escena es vertical: la tarjeta del ganador, el comentario y el
    // encabezado tienen que entrar igual. Lo que se mira es que nada se salga
    // del lienzo ni se pise.
    const cel = await browser.open("about:blank");
    await cel.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844,
    });
    await cel.send("Page.navigate", { url: `${base}/?pose=${game === "race" ? "1" : game}&theme=dark` });
    const celOk = await cel.waitFor(
      `document.getElementById('stadium').style.display === 'block'`,
      30_000,
    );
    check("la escena arranca en un celular", celOk.ok);
    if (celOk.ok) {
      await sleep(1400);
      const m = JSON.parse(await cel.eval(`JSON.stringify((() => {
        const caben = [...document.querySelectorAll('.stadium .st-top, .stadium .commentary, .stadium .st-actions button')]
          .filter(e => getComputedStyle(e).display !== 'none')
          .map(e => { const r = e.getBoundingClientRect();
            return { sel: e.className || e.tagName, fuera: r.right > innerWidth + 1 || r.left < -1, h: Math.round(r.height) }; });
        const cv = document.querySelector('.stadium canvas');
        const r = cv.getBoundingClientRect();
        return {
          malos: caben.filter(x => x.fuera).map(x => x.sel),
          chicos: caben.filter(x => x.h > 0 && x.h < 40 && String(x.sel).indexOf('commentary') < 0).map(x => x.sel + ' ' + x.h),
          lienzo: [Math.round(r.width), Math.round(r.height)],
          vista: [innerWidth, innerHeight],
          scroll: document.documentElement.scrollWidth,
        };
      })())`));
      check(
        "en el celular nada se sale de la pantalla",
        m.malos.length === 0 && m.scroll <= m.vista[0] + 1,
        m.malos.length ? m.malos.join(" | ") : `scroll ${m.scroll} vs ${m.vista[0]}`,
      );
      check(
        "el lienzo ocupa la pantalla del celular",
        Math.abs(m.lienzo[0] - m.vista[0]) <= 2 && Math.abs(m.lienzo[1] - m.vista[1]) <= 2,
        `${m.lienzo.join("x")} en ${m.vista.join("x")}`,
      );
      await cel.screenshot(join(outDir, `juego-${game}-celular.png`));
    }

    // -------------------------------------------- 10. tema claro y oscuro
    for (const theme of ["light", "dark"]) {
      const p = await browser.open(`${base}/?pose=${game === "race" ? "1" : game}&theme=${theme}`);
      const painted = await p.waitFor(
        "getComputedStyle(document.getElementById('stadium')).display !== 'none'",
        20_000,
      );
      check(`la escena se dibuja en tema ${theme === "light" ? "claro" : "oscuro"}`, painted.ok);
      if (painted.ok) await p.screenshot(join(outDir, `juego-${game}-${theme}.png`));
    }
  } finally {
    browser.close();
  }
}

run()
  .catch((e) => check("la auditoría corrió sin caerse", false, e.message))
  .finally(() => {
    const failed = checks.filter((c) => !c.ok);
    console.log(
      `\n${failed.length === 0 ? "APROBADO" : "RECHAZADO"}: ${checks.length - failed.length}/${checks.length} comprobaciones\n`,
    );
    if (failed.length) console.log("Fallaron:\n" + failed.map((c) => `  · ${c.name}`).join("\n") + "\n");
    process.exitCode = failed.length === 0 ? 0 : 1;
  });
