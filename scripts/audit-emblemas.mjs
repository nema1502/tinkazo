#!/usr/bin/env node
/**
 * Prueba de legibilidad de los emblemas a 24 y 36 px, en tema claro y oscuro.
 *
 * Levanta el servidor de desarrollo de Vite en el puerto 4790 (solo para esta
 * prueba: sirve los módulos de src/games/ y una página mínima), abre un Chrome
 * y mide en la propia página, con píxeles de verdad:
 *
 *   1. Silueta. Cada par de emblemas se compara en gris (sin color) a 24 px:
 *      si dos se parecen en forma y en tono, alguien con daltonismo no los
 *      distingue. Falla un par con diferencia media de gris menor a UMBRAL_PAR
 *      y silueta casi igual (IoU de 0,75 o más).
 *   2. Contraste del dibujo con su papel (la ficha tiñe el papel del color de
 *      la persona): al menos el 55 % de los píxeles del dibujo tienen un
 *      contraste de 1,35:1 o más con el papel, con los ocho colores.
 *   3. Contraste de la ficha con el fondo de la página, en claro (#fff6e9) y en
 *      oscuro (#171126): el borde que se ve (la tinta en claro, el aro en
 *      oscuro) llega a 3:1 con cada uno de los ocho colores.
 *   4. Tamaño: el dibujo ocupa al menos el 60 % del ancho o del alto de su caja.
 *   5. Con 30 personas de una ronda, a 24 y a 36 px, en los dos temas, no hay
 *      dos fichas iguales (emblema y color).
 *   6. El lienzo de los juegos (`emblemaCanvas`) se pinta de verdad (esquinas
 *      transparentes, dibujo en el centro) y sale idéntico dos veces.
 *
 * Deja hojas de contacto PNG en --out para mirarlas a ojo.
 *
 *   CDP_PORT=9791 node scripts/audit-emblemas.mjs [--out <carpeta>]
 */
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { launch } from "./lib/browser.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const OUT = resolve(arg("--out", join(tmpdir(), "emblemas-prueba")));
mkdirSync(OUT, { recursive: true });

const PUERTO = 4790;
const UMBRAL_PAR = 0.045;

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>emblemas</title>
<style>html,body{margin:0}body{font:12px system-ui;background:#fff}</style></head><body>
<script type="module">
import { CLAVES, COLORES, emblemasDe } from "/src/games/emblemas.ts";
import { cargarEmblemas, emblemaSvg, cargarHoja, papelDe, simbolosDe, emblemaCanvas, emblemasListos } from "/src/games/emblemas-dibujo.ts";
import hoja from "/src/games/emblemas/hoja.svg?raw";

const lum = (r, g, b) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const contraste = (a, b) => { const la = lum(...a), lb = lum(...b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

const cargar = (svg) => new Promise((res, rej) => {
  const im = new Image();
  im.onload = res.bind(null, im);
  im.onerror = rej;
  im.src = "data:image/svg+xml," + encodeURIComponent(svg);
});
const simbolos = simbolosDe(hoja);
const suelto = (k, lado) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="' + lado + '" height="' + lado + '">' + simbolos.get(k) + '</svg>';

/** Los píxeles del dibujo solo (fondo transparente) a un lado dado. */
async function pixeles(k, lado) {
  const im = await cargar(suelto(k, lado));
  const c = document.createElement("canvas"); c.width = c.height = lado;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(im, 0, 0, lado, lado);
  return cx.getImageData(0, 0, lado, lado).data;
}

window.medir = async function () {
  cargarHoja(hoja);
  const res = { claves: CLAVES.length, fallas: [], notas: [] };
  const falla = (m) => res.fallas.push(m);

  // 1. Silueta en gris a 24 px
  const L = 24;
  const grises = new Map(), mascaras = new Map(), cajas = new Map();
  for (const k of CLAVES) {
    const d = await pixeles(k, L);
    const g = new Float32Array(L * L), m = new Uint8Array(L * L);
    let x0 = L, y0 = L, x1 = -1, y1 = -1;
    for (let i = 0; i < L * L; i++) {
      const a = d[i * 4 + 3] / 255;
      const y = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      g[i] = a * y + (1 - a) * 1; // sobre blanco
      m[i] = a > 0.5 ? 1 : 0;
      if (m[i]) { const x = i % L, yy = (i / L) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
    }
    grises.set(k, g); mascaras.set(k, m); cajas.set(k, [x1 - x0 + 1, y1 - y0 + 1]);
  }
  const pares = [];
  for (let i = 0; i < CLAVES.length; i++) for (let j = i + 1; j < CLAVES.length; j++) {
    const a = CLAVES[i], b = CLAVES[j];
    const ga = grises.get(a), gb = grises.get(b), ma = mascaras.get(a), mb = mascaras.get(b);
    let s = 0, inter = 0, union = 0;
    for (let p = 0; p < L * L; p++) {
      s += Math.abs(ga[p] - gb[p]);
      if (ma[p] && mb[p]) inter++;
      if (ma[p] || mb[p]) union++;
    }
    pares.push({ par: a + " / " + b, d: +(s / (L * L)).toFixed(4), iou: +(inter / Math.max(1, union)).toFixed(3) });
  }
  pares.sort((p, q) => p.d - q.d);
  res.paresMasParecidos = pares.slice(0, 8);
  for (const p of pares) if (p.d < ${UMBRAL_PAR} && p.iou >= 0.75) falla("se confunden en gris a 24 px: " + p.par + " (d=" + p.d + ", iou=" + p.iou + ")");

  // 2. Contraste del dibujo con su papel, con los ocho colores, a 36 px
  const bajos = [];
  for (const k of CLAVES) {
    const d = await pixeles(k, 36);
    for (const col of COLORES) {
      const papel = hexRgb(papelDe(col));
      let n = 0, ok = 0;
      for (let i = 0; i < 36 * 36; i++) {
        if (d[i * 4 + 3] < 128) continue;
        n++;
        if (contraste([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], papel) >= 1.35) ok++;
      }
      const f = ok / Math.max(1, n);
      if (f < 0.55) bajos.push({ k, col, f: +f.toFixed(2) });
    }
  }
  res.dibujoBajoContraste = bajos;
  for (const b of bajos) falla("dibujo lavado sobre su papel: " + b.k + " con " + b.col + " (" + b.f + " de sus píxeles)");

  // 3. Ficha contra el fondo de la página
  const fondos = { claro: "#fff6e9", oscuro: "#171126" };
  res.fichaContraFondo = {};
  for (const [tema, fondo] of Object.entries(fondos)) {
    res.fichaContraFondo[tema] = COLORES.map((c) => {
      const borde = tema === "claro" ? "#191919" : c;
      const v = +contraste(hexRgb(borde), hexRgb(fondo)).toFixed(2);
      if (v < 3) falla("el borde visible de la ficha no llega a 3:1 en tema " + tema + ": " + c + " (" + v + ")");
      return v;
    });
  }

  // 4. Tamaño del dibujo
  for (const k of CLAVES) {
    const [w, h] = cajas.get(k);
    if (Math.max(w, h) < L * 0.6) falla("dibujo chico: " + k + " ocupa " + w + "x" + h + " de " + L);
  }

  // 5. Treinta personas, sin fichas iguales
  const nombres = Array.from({ length: 30 }, (_, i) => "Persona " + (i + 1));
  const lista = emblemasDe(nombres, 123456);
  if (new Set(lista.map((e) => e.clave + e.color)).size !== 30) falla("hay fichas iguales entre 30 personas");

  // 6. El lienzo (lo que usan los juegos y las texturas de Pixi): se pinta de verdad y sale igual dos veces
  await cargarEmblemas();
  if (!emblemasListos()) falla("cargarEmblemas() terminó pero emblemasListos() sigue en falso");
  const LC = 64;
  for (const [i, k] of CLAVES.entries()) {
    const e = { clave: k, color: COLORES[i % COLORES.length], tono: i % COLORES.length };
    const cv = emblemaCanvas(e, LC);
    const px = cv.getContext("2d").getImageData(0, 0, LC, LC).data;
    const alfa = (x, y) => px[(y * LC + x) * 4 + 3];
    if (alfa(0, 0) !== 0 || alfa(LC - 1, 0) !== 0 || alfa(0, LC - 1) !== 0 || alfa(LC - 1, LC - 1) !== 0) falla("las esquinas de la ficha no son transparentes: " + k);
    const papel = hexRgb(papelDe(e.color));
    let distintos = 0, total = 0;
    for (let y = Math.round(LC * 0.2); y < Math.round(LC * 0.8); y++) for (let x = Math.round(LC * 0.2); x < Math.round(LC * 0.8); x++) {
      total++;
      const o = (y * LC + x) * 4;
      if (Math.abs(px[o] - papel[0]) + Math.abs(px[o + 1] - papel[1]) + Math.abs(px[o + 2] - papel[2]) > 24) distintos++;
    }
    if (distintos / total < 0.12) falla("el dibujo no se pintó en el lienzo (centro casi todo papel): " + k + " " + (distintos / total).toFixed(2));
    const otra = document.createElement("canvas"); otra.width = otra.height = LC;
    const { dibujarEmblema } = await import("/src/games/emblemas-dibujo.ts");
    dibujarEmblema(otra.getContext("2d"), e, 0, 0, LC);
    const px2 = otra.getContext("2d").getImageData(0, 0, LC, LC).data;
    for (let q = 0; q < px.length; q++) if (px[q] !== px2[q]) { falla("el lienzo no sale igual dos veces: " + k); break; }
  }

  // Hojas de contacto
  const fila = (e, lado) => '<img width="' + lado + '" height="' + lado + '" src="data:image/svg+xml,' + encodeURIComponent(emblemaSvg(e, lado)) + '">';
  const panel = (tema, fondo, tinta) => {
    const todos = CLAVES.map((k, i) => ({ clave: k, color: COLORES[i % COLORES.length], tono: i % COLORES.length }));
    let h = '<div style="background:' + fondo + ';color:' + tinta + ';padding:12px;width:760px"><b>' + tema + '</b><br>';
    for (const lado of [128, 36, 24]) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:' + (lado > 100 ? 8 : 6) + 'px;margin:8px 0">' + todos.map((e) => fila(e, lado)).join("") + '</div>';
    }
    h += '<div>30 personas</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">' + lista.map((e) => fila(e, 36)).join("") + '</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">' + lista.map((e) => fila(e, 24)).join("") + '</div></div>';
    return h;
  };
  document.body.innerHTML = '<div style="display:flex">' + panel("claro", "#fff6e9", "#191919") + panel("oscuro", "#171126", "#f6efe2") + '</div>';
  await new Promise((r) => setTimeout(r, 300));
  res.listo = true;
  return res;
};
window.listo = true;
</script></body></html>`;

const servidor = await createServer({
  root: RAIZ,
  configFile: false,
  logLevel: "silent",
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { host: "127.0.0.1", port: PUERTO, strictPort: true, hmr: false, watch: null },
  plugins: [
    {
      name: "pagina-emblemas",
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/__emblemas")) return next();
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(await s.transformIndexHtml("/__emblemas", PAGINA));
        });
      },
    },
  ],
});
await servidor.listen();

const browser = await launch({ port: Number(process.env.CDP_PORT || 9791), width: 1600, height: 1100 });
let codigo = 0;
try {
  const cdp = await browser.open(`http://127.0.0.1:${PUERTO}/__emblemas`);
  const lista = await cdp.waitFor("window.listo === true", 60_000);
  if (!lista.ok) throw new Error("la página de prueba no cargó: " + cdp.exceptions.concat(cdp.consoleErrors).join(" | "));
  const res = await cdp.eval("window.medir()");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp.screenshot(join(OUT, "hoja-contacto.png"));
  // Las fichas grandes (128 px) ampliadas al doble, para mirar los dibujos de cerca; y los 24 y 36 px de verdad
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 2, mobile: false });
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 780, height: 990, scale: 1 } });
  writeFileSync(join(OUT, "hoja-grandes-x2.png"), Buffer.from(data, "base64"));
  writeFileSync(join(OUT, "medidas.json"), JSON.stringify(res, null, 2));
  const errores = cdp.exceptions.concat(cdp.consoleErrors);
  if (errores.length) res.fallas.push("errores en la página: " + errores.join(" | "));
  console.log(`emblemas: ${res.claves} claves, ${res.fallas.length} fallas`);
  console.log("pares más parecidos (gris, 24 px):", res.paresMasParecidos.slice(0, 4).map((p) => `${p.par} d=${p.d} iou=${p.iou}`).join("; "));
  console.log("ficha contra fondo (claro):", res.fichaContraFondo.claro.join(" "), "| (oscuro):", res.fichaContraFondo.oscuro.join(" "));
  for (const f of res.fallas) console.log("  FALLA " + f);
  console.log(`hojas y medidas en ${OUT}`);
  if (res.fallas.length) codigo = 1;
} catch (e) {
  console.error(e.message);
  codigo = 1;
} finally {
  await browser.close();
  await servidor.close();
}
process.exit(codigo);
