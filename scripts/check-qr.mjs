#!/usr/bin/env node
/**
 * Comprueba que el QR del comprobante se pueda leer de verdad.
 *
 * El QR aparece en el momento del ganador, con la sala mirando, y si está mal
 * armado falla en silencio: se ve un cuadradito lindo que ningún teléfono
 * puede escanear. Por eso no alcanza con dibujarlo, hay que leerlo.
 *
 * Corre un sorteo real en Chrome, saca los píxeles del QR tal como quedaron en
 * pantalla, y los decodifica acá con un lector independiente del que lo dibujó.
 * Si lo que sale no es el enlace del comprobante, falla.
 *
 * Uso:
 *   node scripts/check-qr.mjs [--base http://localhost:4173]
 */

import jsQR from "jsqr";
import { launch } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--base");
const base = (i >= 0 && args[i + 1] ? args[i + 1] : "http://localhost:4173").replace(/\/$/, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Los píxeles del QR, leídos de la imagen que el sitio ya mostró. */
const READ_PIXELS = `(async () => {
  const img = document.getElementById('qr-img');
  if (!img || !img.src) return null;
  const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const c = cv.getContext('2d');
  c.drawImage(bmp, 0, 0);
  const d = c.getImageData(0, 0, bmp.width, bmp.height);
  return JSON.stringify({ w: bmp.width, h: bmp.height, data: Array.from(d.data) });
})()`;

const browser = await launch({ width: 1400, height: 950 });
let bad = 0;

try {
  // Dos casos: una lista corta y una larga, que es la que estira el QR.
  for (const [etiqueta, n] of [["18 nombres", 18], ["60 nombres", 60]]) {
    const page = await browser.open(`${base}/?lead=4`);
    let ready = false;
    for (let k = 0; k < 80 && !ready; k++) {
      await page.eval(`document.getElementById('btn-sample').click()`).catch(() => {});
      ready = (await page.eval(`String(document.getElementById('ta').value.length > 0)`)) === "true";
      if (!ready) await sleep(150);
    }
    if (!ready) {
      console.log(`  ✗ ${etiqueta}: la página no terminó de cargar`);
      bad++;
      continue;
    }
    if (n !== 18) {
      const nl = JSON.stringify("\n");
      await page.eval(`(()=>{const ta=document.getElementById('ta');
        ta.value = Array.from({length:${n}},(_,i)=>'Participante '+(i+1)).join(${nl});
        ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    await page.eval(`document.getElementById('g-wheel').click()`);
    await page.eval(`document.getElementById('btn-freeze').click()`);
    await page.waitFor(
      `document.getElementById('btn-draw').textContent.indexOf('0:') < 0 && !document.getElementById('btn-draw').disabled`,
      90_000,
    );
    await page.eval(`document.getElementById('btn-draw').click()`);
    const drew = await page.waitFor("document.querySelectorAll('.winner-name').length > 0", 180_000);
    if (!drew.ok) {
      console.log(`  ✗ ${etiqueta}: el sorteo no terminó`);
      bad++;
      continue;
    }
    // El comprobante se arma después del confeti.
    await sleep(3000);

    const visible = (await page.eval(`String(getComputedStyle(document.getElementById('qr-box')).display !== 'none')`)) === "true";
    if (!visible) {
      console.log(`  ✗ ${etiqueta}: el recuadro del QR no se mostró`);
      bad++;
      continue;
    }

    const src = await page.eval(`document.getElementById('qr-img').src.slice(0, 22)`);
    if (!src.startsWith("data:image/png")) {
      // Si esto vuelve a ser una URL remota, los nombres de los participantes
      // están saliendo del navegador otra vez.
      console.log(`  ✗ ${etiqueta}: el QR no se dibuja acá, viene de ${src}`);
      bad++;
      continue;
    }

    const raw = await page.eval(READ_PIXELS);
    if (!raw || raw === "null") {
      console.log(`  ✗ ${etiqueta}: no pude leer los píxeles`);
      bad++;
      continue;
    }
    const px = JSON.parse(raw);
    const found = jsQR(Uint8ClampedArray.from(px.data), px.w, px.h);
    if (!found) {
      console.log(`  ✗ ${etiqueta}: el QR de ${px.w}×${px.h} no se puede leer`);
      bad++;
      continue;
    }
    const link = await page.eval(`(document.getElementById('btn-proof') && window.location.origin) || ''`);
    const okLink = found.data.includes("/verificar.html#");
    console.log(
      `  ${okLink ? "✓" : "✗"} ${etiqueta}: ${px.w}×${px.h}, ${found.data.length} caracteres leídos${okLink ? "" : " — NO apunta a la verificación"}`,
    );
    if (!okLink) bad++;
    void link;
  }
} finally {
  browser.close();
}

console.log("");
if (bad) {
  console.log(`FALLÓ: ${bad} caso(s).\n`);
  process.exit(1);
}
console.log("BIEN: el QR se dibuja en el navegador y un lector independiente lo decodifica.\n");
