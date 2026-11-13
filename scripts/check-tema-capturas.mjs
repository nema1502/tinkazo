/**
 * El tema forzado de las páginas de lectura, comprobado en un navegador de verdad.
 *
 * Con `?theme=light|dark`, `src/pagina.ts` tiene que dejar cada captura (un `<picture>`
 * con la versión clara en un `<source>` y la oscura en el `<img>`) pidiendo la versión
 * del tema, aunque el sistema esté en el otro. El script de la página corre con el HTML
 * ya abierto: el navegador pudo haber pedido ya la versión del sistema, y las pruebas con
 * jsdom no ven esa carrera porque no piden ninguna imagen.
 *
 * Por cada página con capturas (se buscan solas en la raíz: las que cargan `pagina.ts` y
 * tienen un `<source>` por esquema de color) y por cada combinación en que el tema y el
 * sistema no coinciden (tema claro con el sistema oscuro, y al revés), el navegador
 * recarga diez veces sin caché y se mira, en cada recarga:
 *   - que cada captura termine en la versión del tema, cargada y sin quedar colgada;
 *   - y qué pasó por la red: cuántos pedidos de imágenes salieron para la versión del
 *     tema y cuántos para la otra. Un pedido de la otra versión no es un fallo (la primera
 *     captura no es perezosa y sale antes de que corra el script) pero se muestra, para
 *     que nadie lo descubra recién en una captura rota.
 *
 * A diferencia de `check-paginas.mjs`, no vuelve a subir y bajar la página cuando una
 * imagen queda colgada: si el arreglo falla, acá se nota.
 *
 * Uso:
 *   pnpm preview &                          # sirve dist/ en :4173
 *   node scripts/check-tema-capturas.mjs    # o: pnpm check:tema-capturas
 *   node scripts/check-tema-capturas.mjs --base http://localhost:5173 --recargas 20
 *   node scripts/check-tema-capturas.mjs --paginas juegos,historia
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};
const base = opcion("--base", "http://localhost:4173");
const RECARGAS = Math.max(1, Number(opcion("--recargas", "10")));

/** Tema forzado y sistema en el otro tema: las dos combinaciones donde la carrera se nota. */
const COMBINACIONES = [
  { tema: "light", sistema: "dark" },
  { tema: "dark", sistema: "light" },
];

const raiz = join(import.meta.dirname, "..");

/** Las páginas de lectura que tienen capturas por tema, leídas de los HTML de la raíz. */
function paginasConCapturas() {
  return readdirSync(raiz)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => {
      const html = readFileSync(join(raiz, f), "utf8");
      return /src="\/src\/pagina\.ts"/.test(html) && /<source[^>]*prefers-color-scheme/.test(html);
    })
    .map((f) => f.replace(/\.html$/, ""));
}

const PAGINAS = opcion("--paginas", "") ? opcion("--paginas", "").split(",") : paginasConCapturas();

/**
 * Qué archivo le toca a cada captura, leído del HTML tal como lo sirve el sitio (antes
 * de que el script de la página lo toque): la clara está en el `<source>` y la oscura en el `<img>`.
 */
async function versionesDe(pagina) {
  const html = await (await fetch(`${base}/${pagina}.html`)).text();
  const pares = [];
  for (const [, bloque] of html.matchAll(/<picture[^>]*>([\s\S]*?)<\/picture>/g)) {
    const clara = /<source[^>]*srcset="([^"]+)"[^>]*prefers-color-scheme\s*:\s*light/.exec(bloque)?.[1];
    const oscura = /<img[^>]*\ssrc="([^"]+)"/.exec(bloque)?.[1];
    if (clara && oscura) pares.push({ light: clara.split(/[\s,]/)[0], dark: oscura });
  }
  return pares;
}

let fallos = 0;
const registro = [];
const check = (ok, que, detalle = "") => {
  registro.push({ nombre: que, ok, detalle });
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗"} ${que}${detalle ? ` (${detalle})` : ""}`);
};

/** Espera el evento de carga de la página, que se registra antes de pedir la recarga. */
const esperarCarga = (page, ms = 30000) =>
  new Promise((resolver) => {
    const alRecibir = (ev) => {
      if (JSON.parse(ev.data).method !== "Page.loadEventFired") return;
      clearTimeout(corte);
      page.ws.removeEventListener("message", alRecibir);
      resolver(true);
    };
    const corte = setTimeout(() => {
      page.ws.removeEventListener("message", alRecibir);
      resolver(false);
    }, ms);
    page.ws.addEventListener("message", alRecibir);
  });

/** Los pedidos de imágenes de la recarga en curso, tal como los ve la pestaña de red. */
function vigilarLaRed(page) {
  const pedidos = [];
  page.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.requestWillBeSent" && m.params.type === "Image") {
      pedidos.push(new URL(m.params.request.url).pathname);
    }
  });
  return pedidos;
}

const browser = await launch({ port: Number(process.env.CDP_PORT || 9352), width: 1280, height: 900 });
try {
  for (const pagina of PAGINAS) {
    console.log(`\n${pagina}.html`);
    const pares = await versionesDe(pagina);
    if (pares.length === 0) {
      check(false, `${pagina}: tiene capturas con versión por tema`, "no se encontró ningún picture");
      continue;
    }
    for (const { tema, sistema } of COMBINACIONES) {
      const page = await browser.open("about:blank");
      await page.send("Network.enable");
      await page.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: sistema }] });
      const pedidos = vigilarLaRed(page);

      const buenas = new Set(pares.map((p) => p[tema]));
      const otras = new Set(pares.map((p) => p[tema === "light" ? "dark" : "light"]));
      const malas = []; // lo que se vio mal, recarga por recarga
      let deLaOtra = 0;
      let deSistemaMal = false;

      for (let n = 1; n <= RECARGAS; n++) {
        pedidos.length = 0;
        // Al recargar, Chrome devuelve la página adonde estaba: con el scroll al final, las capturas del
        // medio nunca entrarían en pantalla. Cada recarga parte desde arriba, como una visita nueva.
        if (n > 1) await page.eval("window.scrollTo(0, 0)");
        const cargo = esperarCarga(page);
        if (n === 1) await page.send("Page.navigate", { url: `${base}/${pagina}.html?theme=${tema}&lang=es` });
        else await page.send("Page.reload", { ignoreCache: true });
        if (!(await cargo)) {
          malas.push(`recarga ${n}: la página no terminó de cargar`);
          continue;
        }
        // Las capturas son perezosas: se baja de a una pantalla, como quien lee, hasta el final.
        await page.eval("window.scrollTo(0, 0)");
        for (let i = 0; i < 90; i++) {
          const fin = await page.eval("window.scrollBy(0, window.innerHeight); window.innerHeight + window.scrollY >= document.body.scrollHeight - 2");
          await sleep(120);
          if (fin === true || fin === "true") break;
        }
        await page.waitFor("[...document.images].every((i) => i.complete)", 10000);
        const r = JSON.parse(
          await page.eval(`JSON.stringify({
            sistemaOk: matchMedia("(prefers-color-scheme: ${sistema})").matches,
            tema: document.documentElement.dataset.theme || "",
            capturas: [...document.querySelectorAll("picture img")].map((i) => ({
              ruta: i.currentSrc ? new URL(i.currentSrc).pathname : "",
              completa: i.complete,
              ancho: i.naturalWidth,
            })),
          })`),
        );
        if (!r.sistemaOk) deSistemaMal = true;
        if (r.tema !== tema) malas.push(`recarga ${n}: data-theme es "${r.tema}"`);
        if (r.capturas.length !== pares.length) malas.push(`recarga ${n}: ${r.capturas.length} capturas y el HTML trae ${pares.length}`);
        const equivocadas = r.capturas.filter((c) => !buenas.has(c.ruta)).map((c) => c.ruta || "sin pedir");
        const rotas = r.capturas.filter((c) => c.completa && c.ancho === 0).map((c) => c.ruta);
        const colgadas = r.capturas.filter((c) => !c.completa).map((c) => c.ruta || "sin pedir");
        if (equivocadas.length) malas.push(`recarga ${n}: ${equivocadas.length} con la versión equivocada: ${equivocadas.slice(0, 3).join(", ")}`);
        if (rotas.length) malas.push(`recarga ${n}: ${rotas.length} rotas: ${rotas.slice(0, 3).join(", ")}`);
        if (colgadas.length) malas.push(`recarga ${n}: ${colgadas.length} sin terminar de cargar: ${colgadas.slice(0, 3).join(", ")}`);
        const dePasada = pedidos.filter((p) => otras.has(p) && !buenas.has(p)).length;
        deLaOtra += dePasada;
        if (n === 1 || n === RECARGAS) {
          const delTema = pedidos.filter((p) => buenas.has(p)).length;
          console.log(`    red, recarga ${n}: imágenes pedidas ${pedidos.length}, de la versión ${tema} ${delTema}, de la otra versión ${dePasada}`);
        }
      }
      check(!deSistemaMal, `${pagina}: el navegador está en ${sistema} mientras se pide ${tema}`);
      check(
        malas.length === 0,
        `${pagina}: con ?theme=${tema} y el sistema en ${sistema}, ${RECARGAS} recargas sin caché dejan ${pares.length === 1 ? "la captura" : `las ${pares.length} capturas`} en la versión ${tema}`,
        malas.length ? malas.slice(0, 3).join(" | ") : `en total, ${deLaOtra} pedidos de la otra versión`,
      );
      await page.send("Page.close").catch(() => {});
    }
  }
} finally {
  await browser.close();
}

console.log(fallos ? `\nRECHAZADO: ${fallos} comprobaciones` : "\nAPROBADO: con el tema forzado cada captura pide la versión del tema");
emitirJson({ auditor: "check-tema-capturas", objetivo: "paginas", checks: registro });
process.exit(fallos ? 1 : 0);
