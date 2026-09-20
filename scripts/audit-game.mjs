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
import { mkdir } from "node:fs/promises";
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
    id: b.id, text: b.textContent, on: b.classList.contains('on'), disabled: b.disabled,
  })),
  drandLink: document.getElementById('drand-link')?.getAttribute('href') || '',
  whatsapp: document.getElementById('btn-whatsapp')?.getAttribute('href') || '',
  stadiumVisible: getComputedStyle(document.getElementById('stadium')).display !== 'none',
  bodyOverflow: document.body.style.overflow,
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

    await page.screenshot(join(outDir, `juego-${game}.png`));

    // ------------------------------------------------------- 7. en inglés
    const en = await browser.open(`${url}&lang=en&instant=1`);
    const enOk = await en.waitFor("document.querySelectorAll('.winner-name').length > 0", 120_000);
    const enState = JSON.parse(await en.eval(READ_STATE));
    const enOption = enState.options.find((o) => o.id === `g-${game}`);
    check("el sorteo también corre en inglés", enOk.ok);
    check(
      "el nombre del juego está traducido",
      !!enOption && !!option && enOption.text.trim() !== option.text.trim(),
      enOption ? `"${enOption.text.trim()}"` : "sin botón",
    );

    // --------------------------------------------- 8. tema claro y oscuro
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
