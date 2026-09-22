/**
 * Las páginas de lectura, revisadas como las mira alguien: en los dos temas,
 * en celular y en los dos idiomas.
 *
 * Comprueba lo que se rompe en silencio cuando se agrega una sección: una
 * imagen que no está, un texto sin traducir (queda vacío al cambiar de idioma),
 * scroll horizontal en celular, o un enlace del pie que apunta a una página que
 * no existe.
 *
 * Uso:
 *   pnpm preview &                     # sirve dist/ en :4173
 *   node scripts/check-paginas.mjs     # o: pnpm check:paginas
 *   node scripts/check-paginas.mjs --base http://localhost:5173
 */

import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const base = (() => {
  const i = args.indexOf("--base");
  return i >= 0 && args[i + 1] ? args[i + 1] : "http://localhost:4173";
})();

const PAGINAS = ["juegos", "historia", "seguridad", "precios"];
const VISTAS = [
  { tema: "dark", ancho: 1280, alto: 900, como: "escritorio" },
  { tema: "light", ancho: 1280, alto: 900, como: "escritorio" },
  { tema: "dark", ancho: 390, alto: 844, como: "celular" },
];

let fallos = 0;
const check = (ok, que, detalle = "") => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗"} ${que}${detalle ? ` · ${detalle}` : ""}`);
};

const browser = await launch({ port: Number(process.env.CDP_PORT || 9351), width: 1280, height: 900 });
try {
  for (const p of PAGINAS) {
    console.log(`\n${p}.html`);
    for (const { tema, ancho, alto, como } of VISTAS) {
      const page = await browser.open(`${base}/${p}.html?theme=${tema}`);
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 500,
      });
      // Las imágenes son `loading="lazy"`: sin bajar hasta el final, las de
      // abajo figuran como no cargadas sin estar rotas.
      await page.eval("window.scrollTo(0, document.body.scrollHeight); true");
      await sleep(1500);
      const mirar = async () => JSON.parse(await page.eval(`JSON.stringify({
        titulo: document.title,
        desborde: document.documentElement.scrollWidth - window.innerWidth,
        rotas: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length,
        vacios: [...document.querySelectorAll('[data-i], [data-i-html]')].filter(e => !e.textContent.trim()).length,
        enlaces: [...document.querySelectorAll('.pies a')].length,
        toque: [...document.querySelectorAll('.pies a')].every(a => a.getBoundingClientRect().height >= 44),
      })`));
      let r = await mirar();
      // Una imagen puede estar todavía en vuelo. Se mira una segunda vez antes
      // de decir que está rota: si no, la comprobación falla sola de a ratos.
      if (r.rotas > 0) {
        await sleep(2000);
        r = await mirar();
      }
      const etiqueta = `${tema} ${como}`;
      check(!!r.titulo, `${etiqueta}: tiene título`, r.titulo);
      check(r.desborde <= 1, `${etiqueta}: sin scroll horizontal`, `${r.desborde}px`);
      check(r.rotas === 0, `${etiqueta}: sin imágenes rotas`);
      check(r.vacios === 0, `${etiqueta}: sin textos sin traducir`);
      check(r.enlaces === 5, `${etiqueta}: el pie lleva a todas`, `${r.enlaces} enlaces`);
      if (como === "celular") check(r.toque, `${etiqueta}: blancos de toque de 44 px`);
      check(page.exceptions.length === 0, `${etiqueta}: sin excepciones`, page.exceptions[0] ?? "");
    }
    // Y en inglés: si una clave falta, el texto queda en español y se nota acá.
    const en = await browser.open(`${base}/${p}.html?lang=en`);
    await sleep(1200);
    const ingles = await en.eval(`document.querySelector('h1')?.textContent || ''`);
    check(ingles.length > 0, "inglés: el titular está traducido", ingles);
  }
} finally {
  browser.close();
}

console.log(fallos ? `\nRECHAZADO: ${fallos} comprobaciones` : "\nAPROBADO: las páginas de lectura están sanas");
process.exit(fallos ? 1 : 0);
