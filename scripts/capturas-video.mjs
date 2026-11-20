#!/usr/bin/env node
/**
 * Clips de video en movimiento de un juego, para las vistas previas del
 * selector (issue #116). Graba SOLO el tramo final que termina en la victoria
 * (decisión del dueño, verbatim: "Podriamos poner solo la ultima parte, que es
 * cuando gana"): para la ruleta el frenado hasta que el puntero se queda en la
 * casilla ganadora; para el teleférico la llegada a la plataforma TOP.
 *
 * Es el mismo camino de `capturas-juegos.mjs` (escena fija `?pose=`, reloj
 * virtual de 1/64 s por cuadro) con un cambio: en vez de congelar al llegar al
 * momento y sacar una foto, el bombeo automático se detiene en `--desde` y a
 * partir de ahí cada cuadro avanza cuando Node le pide `window.__video.step()`.
 * Así cada cuadro del tramo sale entero a la pantalla y se le fotografía, sin
 * saltarse ninguno: una captura de pantalla tarda más de lo que tarda el juego
 * en pasar al cuadro siguiente, y con el bombeo suelto se perderían cuadros.
 *
 * Después ffmpeg codifica dos loops mudos por tema, a 16 cuadros por segundo:
 *   - VP9  (.webm, `libvpx-vp9`, CRF con `-b:v 0`) para Chrome/Firefox.
 *   - H.264 (.mp4, `libx264`, yuv420p) para Safari/iOS.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/capturas-video.mjs wheel --desde 29 --hasta 32
 *
 * `--temas dark,light`, `--out carpeta` (por defecto
 * `public/juegos/vistas-previas`), `--fps 16`, `--crf-vp9 34`, `--crf-h264 23`.
 * Con `--deja-fuente` también deja en `--out` el video sin pérdida de los
 * cuadros fuente (`<juego>-fuente.mkv`, FFV1), para medir la calidad de los
 * clips contra ellos (PSNR). Deja `<juego>[-light].webm` y `.mp4` y reporta
 * los bytes reales de cada clip.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const juego = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!juego) {
  console.error("uso: node scripts/capturas-video.mjs <juego> --desde <seg> --hasta <seg> [--temas dark] [--out carpeta]");
  process.exit(2);
}
const desde = Number(opt("--desde", ""));
const hasta = Number(opt("--hasta", ""));
if (!(desde >= 0) || !(hasta > desde)) {
  console.error("--desde y --hasta son segundos de juego; hasta tiene que ser mayor que desde");
  process.exit(2);
}
const temas = opt("--temas", "dark").split(",");
const fps = Number(opt("--fps", "16"));
const crfVp9 = opt("--crf-vp9", "34");
const crfH264 = opt("--crf-h264", "23");
const dejaFuente = args.includes("--deja-fuente");
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", join("public", "juegos", "vistas-previas"));
const motor = opt("--motor", "pixi");
if (motor !== "clasico") process.env.TINKAZO_GPU = "1";

/**
 * Mismo preludio que `capturas-juegos.mjs`, con dos diferencias: el bombeo
 * automático avanza hasta `--desde` y ahí se frena (`listo`), y deja
 * `window.__video.step()` para que Node avance el reloj cuadro a cuadro.
 */
const PRELUDIO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0, v0 = -1, auto = true;
  const cbs = new Map();
  window.__video = { listo: false, step: null };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    const st = document.getElementById('stadium');
    if (v0 < 0 && st && st.style.display === 'block') v0 = virt;
    if (auto && v0 >= 0 && virt - v0 >= ${desde * 1000}) { auto = false; window.__video.listo = true; }
    if (auto && cbs.size) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += STEP;
      for (const cb of lote) { try { cb(virt); } catch (e) { console.error(e); } }
    }
    RAF(bombear);
  };
  RAF(bombear);
  window.__video.step = () => {
    if (cbs.size) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += STEP;
      for (const cb of lote) { try { cb(virt); } catch (e) { console.error(e); } }
    }
    return virt;
  };
})()`;

/** Espera a que el bombeo automático llegue al segundo `--desde`. */
async function esperarDesde(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await page.send("Runtime.evaluate", { expression: "!!(window.__video && window.__video.listo)", returnByValue: true }, 4000);
      if (r.result?.value) return true;
    } catch {
      /* la página puede estar ocupada o navegando */
    }
    await sleep(300);
  }
  return false;
}

const tmp = mkdtempSync(join(tmpdir(), "tinkazo-video-"));
const vistaW = 640, vistaH = 360;
mkdirSync(outDir, { recursive: true });
const browser = await launch({ port: Number(process.env.CDP_PORT || 9381), width: vistaW, height: vistaH });
const bytes = [];
try {
  for (const tema of temas) {
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: vistaW, height: vistaH, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO });
    await page.send("Page.navigate", { url: `${base}/?pose=${juego}&theme=${tema}&motor=${motor}` });
    if (!(await esperarDesde(page, 120_000))) throw new Error(`la escena de ${juego} no llegó a los ${desde} s`);
    // Cuadro a cuadro: fotografía, avanza un sesenta y cuatroavo, repite.
    const prefijo = join(tmp, `${juego}-${tema}-`);
    let n = 0;
    const total = Math.round((hasta - desde) * 64);
    for (let i = 0; i <= total; i++) {
      await page.screenshot(`${prefijo}${String(n++).padStart(5, "0")}.png`);
      await page.eval("window.__video.step()");
    }
    const sufix = tema === "light" ? "-light" : "";
    // Referencia sin pérdida para medir calidad: los cuadros tal cual salieron, ya a 320x180 y al fps del clip.
    const referencia = join(tmp, `${juego}${sufix}-fuente.mkv`);
    const destinoFuente = dejaFuente ? join(outDir, `${juego}${sufix}-fuente.mkv`) : referencia;
    codificar(["-framerate", "64", "-i", `${prefijo}%05d.png`, "-vf", `fps=${fps},scale=320:180:flags=lanczos`, "-c:v", "ffv1", "-level", "3", "-an", destinoFuente]);
    // VP9: CRF con -b:v 0 es calidad constante; cpu-used 4 para que tarde poco.
    const webm = join(outDir, `${juego}${sufix}.webm`);
    codificar(["-framerate", "64", "-i", `${prefijo}%05d.png`, "-vf", `fps=${fps},scale=320:180:flags=lanczos`, "-c:v", "libvpx-vp9", "-crf", crfVp9, "-b:v", "0", "-cpu-used", "4", "-row-mt", "1", "-an", webm]);
    // H.264: yuv420p para que lo decodifique cualquier móvil, faststart para que empiece a verse apenas llega.
    const mp4 = join(outDir, `${juego}${sufix}.mp4`);
    codificar(["-framerate", "64", "-i", `${prefijo}%05d.png`, "-vf", `fps=${fps},scale=320:180:flags=lanczos`, "-c:v", "libx264", "-crf", crfH264, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
    for (const f of [webm, mp4]) bytes.push({ archivo: f, bytes: statSync(f).size });
    console.log(`  ✓ ${juego}${sufix}: ${tema} ${desde}→${hasta} s · VP9 ${statSync(webm).size} B · H264 ${statSync(mp4).size} B`);
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
for (const { archivo, bytes: b } of bytes) console.log(`${b}\t${archivo}`);

function codificar(argv) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...argv]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
}
