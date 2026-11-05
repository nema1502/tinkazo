#!/usr/bin/env node
/**
 * El logo animado de entrada y de salida para los videos de los creadores: vertical (1080 x 1920),
 * de 2,5 y 3,2 segundos, con la llama que cae, las letras que saltan y, al final, la dirección y la cuenta.
 * Se dibuja con la misma llama y las mismas letras (Montserrat, OFL) que el resto de la marca.
 *
 *   node scripts/marca/videos/logo-animado.mjs --salida <carpeta> [--puerto 9819]   (o KIT_VIDEOS_DIR)
 *
 * Deja, en <salida>/logo-animado/:
 *   entrada-{oscuro,claro,verde}.mp4        el logo de entrada, sobre color y sobre verde puro para recortar
 *   salida-{es,en}-{oscuro,claro,verde}.mp4 el cierre con tinkazo.app y @tinkazo.app
 *   entrada-alfa.webm, salida-{es,en}-alfa.webm   con transparencia (VP9), para editores que la aceptan
 * Los videos no van al repositorio. Hace falta ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, "..", "..", "..");
const { carpetaDeSalida } = await import("./salida.mjs");
const { launch } = await import(pathToFileURL(join(REPO, "scripts/lib/browser.mjs")).href);
const { negra, seminegra, texto, rects, CAJA, aD } = await import(pathToFileURL(join(REPO, "scripts/marca/base.mjs")).href);

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const RAIZ = carpetaDeSalida(args);
const SALIDA = join(RAIZ, "logo-animado");
const TRABAJO = join(RAIZ, "trabajo", "logo");
const PUERTO = Number(opt("puerto", "9819"));
const FPS = 30;

const cajaDe = (cmds) => {
  const xs = [], ys = [];
  for (const [, ...p] of cmds) p.forEach((v, i) => (i % 2 ? ys : xs).push(v));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
/** Un texto como un solo trazado, con su ancho y la altura de la mayúscula (a tamaño 100). */
const linea = (font, cadena, esp = 0) => {
  const t = texto(font, cadena, 100, esp);
  return { d: aD(t.glifos.flatMap((g) => g.cmds)), ancho: t.ancho, cap: t.mayuscula };
};

const palabra = texto(negra, "TINKAZO", 100, 6);
const GEO = {
  caja: CAJA,
  // El icono: cuerpo, cuello, cabeza, oreja, cuatro patas y cola, en ese orden.
  llama: rects.map((r, i) => ({ r, pata: i >= 4 && i <= 7 ? i - 4 : -1, orejaR: i === 3 })),
  palabra: {
    ancho: palabra.ancho,
    cap: palabra.mayuscula,
    escala: 820 / palabra.ancho,
    glifos: palabra.glifos.map((g) => {
      const b = cajaDe(g.cmds);
      return { ch: g.ch, d: aD(g.cmds), cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
    }),
  },
  web: linea(negra, "tinkazo.app"),
  insta: linea(negra, "@tinkazo.app"),
  frase: {
    es: [linea(seminegra, "Sorteos que cualquiera"), linea(seminegra, "puede comprobar")],
    en: [linea(seminegra, "Draws anyone"), linea(seminegra, "can check")],
  },
};

const ENTRADA = 2.5;
const SALIDA_SEG = 3.2;
const PIEZAS = [];
for (const p of ["oscuro", "claro", "verde", "alfa"]) PIEZAS.push({ nombre: `entrada-${p}`, modo: "entrada", paleta: p, lang: "es", seg: ENTRADA });
for (const lang of ["es", "en"]) for (const p of ["oscuro", "claro", "verde", "alfa"]) PIEZAS.push({ nombre: `salida-${lang}-${p}`, modo: "salida", paleta: p, lang, seg: SALIDA_SEG });

mkdirSync(SALIDA, { recursive: true });
const browser = await launch({ port: PUERTO, width: 540, height: 960 });
try {
  const page = await browser.open("about:blank");
  await page.send("Runtime.enable");
  await page.eval(`window.GEO = ${JSON.stringify(GEO)}; true`);
  await page.eval(`${readFileSync(join(AQUI, "logo-animado-pagina.js"), "utf8")}\n;true`);
  for (const p of PIEZAS) {
    const dir = join(TRABAJO, p.nombre);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const n = Math.round(p.seg * FPS);
    for (let i = 0; i < n; i++) {
      const b64 = await page.eval(`window.dibujar(${(i / FPS).toFixed(5)}, ${JSON.stringify(p.modo)}, ${JSON.stringify(p.paleta)}, ${JSON.stringify(p.lang)}); window.PNG()`);
      writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(b64, "base64"));
    }
    const entrada = ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png")];
    let salida;
    if (p.paleta === "alfa") {
      salida = [...entrada, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "22", "-auto-alt-ref", "0", join(SALIDA, `${p.nombre}.webm`)];
    } else {
      salida = [...entrada, "-an", "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(SALIDA, `${p.nombre}.mp4`)];
    }
    const r = spawnSync("ffmpeg", salida, { encoding: "utf8" });
    if (r.status) throw new Error(`ffmpeg (${p.nombre}): ${r.stderr.slice(-400)}`);
    const archivo = join(SALIDA, `${p.nombre}.${p.paleta === "alfa" ? "webm" : "mp4"}`);
    console.log(`${p.nombre}  ${n} cuadros  ${(statSync(archivo).size / 1024).toFixed(0)} KB`);
    if (p.nombre === "entrada-oscuro" || p.nombre === "salida-es-claro") {
      // Una hoja de contacto para mirar el movimiento (se queda en la carpeta de trabajo, privada).
      const hoja = spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"), "-vf", "select=not(mod(n\\,6)),scale=180:-1,tile=8x2", "-frames:v", "1", join(TRABAJO, `hoja-${p.nombre}.png`)]);
      if (hoja.status) console.log("  (la hoja no salió)");
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (page.exceptions.length) console.log("excepciones:", page.exceptions.slice(0, 2));
} finally {
  await browser.close();
}
