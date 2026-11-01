/** Revisión funcional en WebKit, sin cambiar las protecciones del navegador. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
if (process.argv.includes("--help")) {
  console.log(`Uso: node scripts/audit-marca.mjs [--reference] [--help]

Sin opciones: revisa marca en ES/EN, temas claro/oscuro y anchos 320/390/1280.
--reference: visita la referencia externa de organización, sin auditar el sitio local.
--help: muestra esta ayuda sin importar Playwright ni abrir el navegador.

Variables:
  MARCA_BASE         Origen del servidor existente (predeterminado: http://127.0.0.1:5184).
  MARCA_OUT          Directorio de evidencia (predeterminado: .evidence/marca).
  PLAYWRIGHT_PATH    Ruta o módulo de Playwright (predeterminado: playwright).
  PLAYWRIGHT_MODULE  Alias compatible si PLAYWRIGHT_PATH no está definido.

Usa WebKit con sus protecciones normales. MARCA_OUT permite conservar corridas anteriores.
El portapapeles se simula para probar éxito y rechazo; no acredita el portapapeles del sistema.`);
  process.exit(0);
}
const { webkit } = await import(process.env.PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.MARCA_BASE || "http://127.0.0.1:5184";
const salida = resolve(process.env.MARCA_OUT || ".evidence/marca");
await mkdir(salida, { recursive: true });
const browser = await webkit.launch({ headless: true, timeout: 10000 });
const resultados = [];
try {
  if (process.argv.includes("--reference")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const response = await page.goto("https://puls3-4lw.pages.dev/#/brand", { waitUntil: "networkidle", timeout: 15000 });
      const cargo = await page.waitForFunction(() => document.body.innerText.includes("Brand guidelines") && document.body.innerText.includes("Logos"), null, { timeout: 8000 }).then(() => true, () => false);
      const texto = await page.locator("body").innerText();
      await page.screenshot({ path: `${salida}/referencia.png`, fullPage: true });
      resultados.push({ referencia: response?.status(), cargo, titulo: await page.title(), organizacion: texto.slice(0, 5000) });
    } catch (error) {
      resultados.push({ referencia: "no disponible", error: String(error) });
    }
  } else {
    for (const lang of ["es", "en"]) for (const theme of ["light", "dark"]) for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 }, acceptDownloads: true });
      const errores = [];
      page.on("pageerror", e => errores.push(String(e)));
      page.on("console", e => { if (e.type() === "error") errores.push(e.text()); });
      const response = await page.goto(`${base}/marca.html?lang=${lang}&theme=${theme}`);
      assert.equal(response.status(), 200);
      await page.locator('.marca-paleta button').last().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
      const estado = await page.evaluate(() => {
        const lang = document.documentElement.lang;
        const dict = JSON.parse(document.getElementById("textos").textContent)[lang];
        return {
          lang, theme: document.documentElement.dataset.theme,
          desborde: document.documentElement.scrollWidth - innerWidth,
          traducciones: [...document.querySelectorAll("[data-i]")].filter(e => e.textContent !== dict[e.dataset.i]).map(e => e.dataset.i),
          rotas: [...document.images].filter(e => !e.complete || !e.naturalWidth).length,
          colores: [...document.querySelectorAll("[data-hex]")].map(e => e.dataset.hex),
          toques: [...document.querySelectorAll(".marca a, .marca button")].every(e => e.getBoundingClientRect().height >= 44),
        };
      });
      assert.equal(estado.lang, lang); assert.equal(estado.theme, theme);
      assert.ok(estado.desborde <= 0, JSON.stringify(estado));
      assert.deepEqual(estado.traducciones, []); assert.equal(estado.rotas, 0);
      assert.equal(estado.colores.length, 20); assert.ok(estado.toques);
      if (width < 500) {
        const mas = page.locator('.mas-btn');
        await mas.click();
        assert.equal(await mas.getAttribute('aria-expanded'), 'true');
        const menu = await page.locator('.mas-lista').boundingBox();
        assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= width, JSON.stringify(menu));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 0));
        await page.keyboard.press('Escape');
        assert.equal(await mas.getAttribute('aria-expanded'), 'false');
      }
      await page.screenshot({ path: `${salida}/${lang}-${theme}-${width}.png`, fullPage: true });
      // Portapapeles simulado: prueba el dato y el estado de la UI, no el permiso del sistema.
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.__copiado = value; } } }));
      const boton = page.locator('[data-hex="#fff6e9"]');
      await boton.focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => window.__copiado === "#fff6e9");
      assert.match(await page.locator("#marca-estado").innerText(), /#fff6e9/);
      // Se abre realmente cada archivo recibido por el gestor de descargas y se rasteriza para medir alpha.
      const descargas = [];
      for (const selector of ['a[download="tinkazo-llama.svg"]', 'a[download="tinkazo-llama.png"]', '#sello-descarga']) {
        const enlace = page.locator(selector);
        const espera = page.waitForEvent("download");
        await enlace.click(); const download = await espera;
        assert.equal(await download.failure(), null);
        const nombre = download.suggestedFilename();
        await download.saveAs(`${salida}/${nombre}`);
        const datos = await readFile(`${salida}/${nombre}`);
        const recurso = new URL(await enlace.getAttribute("href"), base).pathname;
        assert.ok(datos.equals(await readFile(resolve(`public${recurso}`))));
        const mime = nombre.endsWith("png") ? "image/png" : "image/svg+xml";
        const alpha = await page.evaluate(async ({ data, mime }) => {
          const img = new Image(); img.src = `data:${mime};base64,${data}`;
          await img.decode();
          const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let transparentes = 0, opacos = 0;
          for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparentes++; if (pixels[i] === 255) opacos++; }
          return { ancho: canvas.width, alto: canvas.height, transparentes, opacos, esquina: pixels[3] };
        }, { data: datos.toString("base64"), mime });
        assert.ok(alpha.transparentes > 0 && alpha.opacos > 0); assert.equal(alpha.esquina, 0);
        descargas.push({ nombre, ...alpha });
      }
      const otro = lang === "es" ? "en" : "es";
      await page.locator(`#l-${otro}`).click();
      assert.equal(await page.locator('#sello-descarga').getAttribute("href"), `/marca/sello-${otro}.svg`);
      assert.equal(await page.locator('#sello-vista').getAttribute("src"), `/marca/sello-${otro}.svg`);
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denegado"); } } }));
      await boton.click();
      await page.waitForFunction(() => /No se pudo|Could not/.test(document.getElementById("marca-estado").textContent));
      assert.deepEqual(errores, []);
      resultados.push({ lang, theme, width, ...estado, descargas, errores });
      console.log(`APROBADO ${lang} ${theme} ${width}: traducciones, copia, descarga, alpha y cambio de idioma`);
      await page.close();
    }
  }
} finally {
  await writeFile(`${salida}/${process.argv.includes("--reference") ? "referencia" : "navegador"}.json`, JSON.stringify(resultados, null, 2));
  await browser.close();
}
