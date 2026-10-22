/**
 * Las páginas de lectura, revisadas como las mira alguien: en los dos temas,
 * en celular y en los dos idiomas. Y las dos que se abren desde un enlace,
 * verificar y evento (ver `HERRAMIENTAS`).
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

const PAGINAS = ["juegos", "como-funciona", "historia", "seguridad", "precios", "terminos", "sorteo-para-meetup", "sorteo-en-clase", "sorteo-verificable"];
const VISTAS = [
  { tema: "dark", ancho: 1280, alto: 900, como: "escritorio" },
  { tema: "light", ancho: 1280, alto: 900, como: "escritorio" },
  { tema: "dark", ancho: 390, alto: 844, como: "celular" },
];

/**
 * Las páginas que se abren desde un enlace: verificar, evento y la del enlace
 * corto (c.html). No son de lectura: su pie no lleva a las páginas de sorteo y
 * su titular lo escribe el script. Se miran igual, en los dos temas, en celular y en inglés, con lo que
 * se les rompió alguna vez (evaluador visual, 21 de octubre de 2026): con
 * `?theme=` verificar no cambiaba de tema, en el celular los pasos para
 * rehacerlo se cortaban contra el borde, y con un enlace roto el titular del
 * evento quedaba en español también en inglés.
 *
 * El comprobante de verificar es el de los vectores de prueba (la lista de
 * ejemplo y una ronda real con su firma), sin anclar: se rehace entero en el
 * navegador, sin red. El evento va sin enlace, que es el caso del error, y el
 * enlace corto también: abierta sin id ni clave, la página dice que el enlace
 * no se puede abrir sin salir a la red.
 */
const COMPROBANTE = "r" + Buffer.from(JSON.stringify({
  v: 2,
  names: [
    "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
    "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
    "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
  ],
  round: 32254977,
  signature: "a77a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac",
}), "utf8").toString("base64url");
const HERRAMIENTAS = [
  {
    p: "verificar",
    hash: `#${COMPROBANTE}`,
    listo: "!/working/.test(document.getElementById('verdict').className) && document.getElementById('v-steps').textContent.length > 0",
  },
  { p: "evento", hash: "", listo: "!/working/.test(document.getElementById('ev-veredicto').className)" },
  { p: "c", hash: "", listo: "!!document.body.dataset.estado && document.body.dataset.estado !== 'abriendo'" },
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
      // Sin esperar la carga, `document.body` puede no existir todavía: la
      // revisión se caía en la segunda vista de la misma página.
      await page.waitFor("document.readyState === 'complete' && !!document.body", 20000);
      // Las imágenes son `loading="lazy"`: sin bajar hasta el final, las de
      // abajo figuran como no cargadas sin estar rotas. Y se baja de a una
      // pantalla, como quien lee: saltando directo al final, en un celular
      // las del medio de una página larga nunca entraban en pantalla.
      for (let i = 0; i < 40; i++) {
        const fin = await page.eval("window.scrollBy(0, window.innerHeight); window.innerHeight + window.scrollY >= document.body.scrollHeight - 2");
        await sleep(120);
        if (fin === true || fin === "true") break;
      }
      await sleep(1500);
      const mirar = async () => JSON.parse(await page.eval(`JSON.stringify({
        titulo: document.title,
        desborde: document.documentElement.scrollWidth - window.innerWidth,
        rotas: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length,
        vacios: [...document.querySelectorAll('[data-i], [data-i-html]')].filter(e => !e.textContent.trim()).length,
        enlaces: [...document.querySelectorAll('.pies a')].map((a) => a.getAttribute('href')),
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
      // Cada página de lectura, más el código. Se compara contra la lista de
      // arriba y no contra un número: con un número, agregar una página
      // obligaba a acordarse de cambiarlo acá.
      const faltan = PAGINAS.filter((p) => !r.enlaces.includes(`/${p}.html`));
      check(faltan.length === 0 && r.enlaces.length === PAGINAS.length + 1, `${etiqueta}: el pie lleva a todas`, faltan.length ? `falta ${faltan.join(", ")}` : `${r.enlaces.length} enlaces`);
      if (como === "celular") check(r.toque, `${etiqueta}: blancos de toque de 44 px`);
      check(page.exceptions.length === 0, `${etiqueta}: sin excepciones`, page.exceptions[0] ?? "");
    }
    // Y en inglés: si una clave falta, el texto queda en español y se nota acá.
    const en = await browser.open(`${base}/${p}.html?lang=en`);
    await sleep(1200);
    const ingles = await en.eval(`document.querySelector('h1')?.textContent || ''`);
    check(ingles.length > 0, "inglés: el titular está traducido", ingles);
  }

  for (const { p, hash, listo } of HERRAMIENTAS) {
    console.log(`\n${p}.html`);
    let titular = "";
    for (const { tema, ancho, alto, como } of VISTAS) {
      const page = await browser.open("about:blank");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 500,
      });
      // Estas páginas siguen el idioma del navegador (un enlace compartido se abre
      // en el idioma de quien lo recibe): el castellano se pide explícito, porque
      // el Chrome de la CI está en inglés y el titular salía igual en los dos.
      await page.send("Page.navigate", { url: `${base}/${p}.html?theme=${tema}&lang=es${hash}` });
      await page.waitFor("document.readyState === 'complete' && !!document.body", 20000);
      const termino = await page.waitFor(listo, 30000);
      await sleep(500);
      const r = JSON.parse(await page.eval(`JSON.stringify({
        titulo: document.title,
        titular: document.querySelector('h1')?.textContent || '',
        tema: document.documentElement.dataset.theme || '',
        desborde: document.documentElement.scrollWidth - window.innerWidth,
        rotas: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length,
        vacios: [...document.querySelectorAll('[data-i], [data-i-html]')].filter(e => !e.textContent.trim()).length,
        enlaces: [...document.querySelectorAll('.pies a')].map((a) => a.getAttribute('href')),
        toque: [...document.querySelectorAll('.pies a')].every(a => a.getBoundingClientRect().height >= 44),
        pasos: (() => { const e = document.getElementById('v-steps'); return e ? e.scrollWidth - e.clientWidth : 0; })(),
      })`));
      if (!titular) titular = r.titular;
      const etiqueta = `${tema} ${como}`;
      check(termino.ok, `${etiqueta}: termina de revisar`);
      check(!!r.titulo, `${etiqueta}: tiene título`, r.titulo);
      check(r.tema === tema, `${etiqueta}: ?theme= se aplica`, r.tema || "(sin data-theme)");
      check(r.desborde <= 1, `${etiqueta}: sin scroll horizontal`, `${r.desborde}px`);
      check(r.rotas === 0, `${etiqueta}: sin imágenes rotas`);
      check(r.vacios === 0, `${etiqueta}: sin textos sin traducir`);
      const ajenas = r.enlaces.filter((h) => h.startsWith("/") && !PAGINAS.some((q) => h === `/${q}.html`));
      check(r.enlaces.length > 0 && ajenas.length === 0, `${etiqueta}: el pie lleva a páginas que existen`, ajenas.join(", "));
      if (p === "verificar") check(r.pasos <= 1, `${etiqueta}: los pasos para rehacerlo no se cortan`, `${r.pasos}px de más`);
      if (como === "celular") check(r.toque, `${etiqueta}: blancos de toque de 44 px`);
      check(page.exceptions.length === 0, `${etiqueta}: sin excepciones`, page.exceptions[0] ?? "");
      await page.send("Page.close").catch(() => {});
    }
    // En inglés el titular lo pone el script: tiene que cambiar de idioma.
    const en = await browser.open(`${base}/${p}.html?lang=en${hash}`);
    await en.waitFor(listo, 30000);
    await sleep(500);
    const ingles = await en.eval(`document.querySelector('h1')?.textContent || ''`);
    check(ingles.length > 0 && ingles !== titular, "inglés: el titular está traducido", `${ingles} · en español: ${titular}`);
    await en.send("Page.close").catch(() => {});
  }
} finally {
  await browser.close();
}

console.log(fallos ? `\nRECHAZADO: ${fallos} comprobaciones` : "\nAPROBADO: las páginas de lectura están sanas");
process.exit(fallos ? 1 : 0);
