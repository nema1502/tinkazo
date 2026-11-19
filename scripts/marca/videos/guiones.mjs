#!/usr/bin/env node
/**
 * Los guiones del kit para creadores como archivos: un .txt y dos .srt (español e inglés) por juego, y un
 * LEEME. Salen de los mismos datos que muestra marca.html (src/marca-creadores.ts), así que la página y los
 * archivos no se separan. Van a la carpeta privada del kit, no al repositorio.
 *
 *   node scripts/marca/videos/guiones.mjs --salida <carpeta>   (o KIT_VIDEOS_DIR)
 *
 * Deja, en <salida>/guiones/, tinkazo-guion-<juego>-{es,en}.txt y tinkazo-subtitulos-<juego>-{es,en}.srt.
 * Usa la carga de archivos .ts de Node (22.6 o más, sin dependencias).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { carpetaDeSalida } from "./salida.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, "..", "..", "..");
const args = process.argv.slice(2);
const SALIDA = join(carpetaDeSalida(args), "guiones");

const { GUIONES, SEG_CIERRE, archivoGuion, archivoSubtitulos, guionComoTexto, subtitulosSrt } = await import(pathToFileURL(join(REPO, "src/marca-creadores.ts")).href);

const { Lienzo, etiqueta, medir } = await import(pathToFileURL(join(REPO, "scripts/marca/dibujo.mjs")).href);
const { rasterizar, pngNivel, zip } = await import(pathToFileURL(join(REPO, "scripts/marca/base.mjs")).href);

/** Corta un texto en renglones de hasta `max` letras, sin partir palabras. */
function renglones(s, max) {
  const out = [];
  for (const w of s.split(" ")) {
    const ult = out[out.length - 1];
    if (ult && `${ult} ${w}`.length <= max) out[out.length - 1] = `${ult} ${w}`;
    else out.push(w);
  }
  return out;
}

/**
 * La placa del gancho: el texto de los dos primeros segundos en Montserrat Black, en pastillas amarillas con sombra
 * magenta, como en el sitio. PNG de 1080 de ancho con fondo transparente, para ponerla encima del clip en CapCut.
 */
function placa(texto) {
  const lineas = renglones(texto, 18);
  const W = 1080, ANCHO = 900;
  const tam = Math.min(78, ...lineas.map((s) => ANCHO / (medir(s, 1) + 1)));
  const alto = tam * 1.9, sep = tam * 0.35;
  const H = Math.ceil(lineas.length * alto + (lineas.length - 1) * sep + 60);
  const l = new Lienzo(W, H, "claro");
  lineas.forEach((s, i) => etiqueta(l, { s, x: W / 2, y: 24 + i * (alto + sep), tam, fill: "amarillo", sombraCol: "magenta", ancla: "c", rot: i % 2 ? 1.2 : -1.2 }));
  return pngNivel(W, H, rasterizar(l.formas, W, H));
}

mkdirSync(SALIDA, { recursive: true });
let n = 0;
for (const g of GUIONES) {
  for (const lang of ["es", "en"]) {
    // Estos .txt viajan con los clips (se suben juntos): se arman como con el kit publicado.
    writeFileSync(join(SALIDA, archivoGuion(g, lang)), guionComoTexto(g, lang, true));
    writeFileSync(join(SALIDA, archivoSubtitulos(g, lang)), subtitulosSrt(g, lang));
    writeFileSync(join(SALIDA, archivoGuion(g, lang).replace("tinkazo-guion-", "tinkazo-placa-").replace(/\.txt$/, ".png")), placa(g.gancho[lang]));
    n += 3;
  }
}

const LEEME = {
  es: `KIT PARA CREADORES DE TINKAZO

Clips verticales (1080 por 1920, 30 cuadros por segundo, sin música), un logo animado para abrir y cerrar
(${SEG_CIERRE} segundos el cierre con tinkazo.app y @tinkazo.app), diez guiones y sus subtítulos.

Cómo usarlo
1. Elegí un juego y abrí su guion (tinkazo-guion-<juego>-es.txt): trae el gancho, los momentos, el texto
   en pantalla y los pasos de CapCut.
2. Armá el video con el clip (tinkazo-<juego>-9x16.mp4) y el cierre. Los clips vienen sin música y terminan en
   el cartel del ganador, quieto y limpio: cuando sale el cartel, sacá tu texto para que se lea el nombre.
   La placa del gancho (tinkazo-placa-<juego>-es.png) va encima de los dos primeros segundos.
   En la piñata y en La Entrada lo importante va abajo: poné tu texto arriba.
3. Subí el video como borrador y mirá que los botones de la red no tapen el texto. Después publicá.

Nombres de los archivos: tinkazo-<juego>-9x16.mp4 (clips, que terminan con un segundo quieto en el cartel),
tinkazo-<juego>-9x16-bucle.mp4 (el mismo clip con el final fundido en el principio, para repetirlo sin salto),
tinkazo-placa-<juego>-<idioma>.png (la placa del gancho), tinkazo-logo-entrada-<fondo>.mp4 y
tinkazo-logo-cierre-<idioma>-<fondo>.mp4 (logo), tinkazo-guion-<juego>-<idioma>.txt, tinkazo-subtitulos-<juego>-<idioma>.srt.
Los de fondo verde se recortan con la clave de croma. Los .webm traen transparencia.
La letra de la marca es Montserrat Black y Bold (tinkazo-letra-montserrat.zip, licencia OFL: libre y gratis).

Dos pedidos: no prometas premios en dinero con el kit (entrar a un sorteo en Tinkazo es gratis, siempre) y no
cambies lo que dicen los carteles del ganador.

https://tinkazo.app/marca.html   Instagram: @tinkazo.app
`,
  en: `TINKAZO KIT FOR CREATORS

Vertical clips (1080 by 1920, 30 frames per second, no music), an animated logo to open and close
(the closer with tinkazo.app and @tinkazo.app runs ${SEG_CIERRE} seconds), ten scripts and their subtitles.

How to use it
1. Pick a game and open its script (tinkazo-guion-<game>-en.txt): it has the hook, the moments, the on-screen
   text and the CapCut steps.
2. Put the video together with the clip (tinkazo-<game>-9x16.mp4) and the closer. The clips have no music and
   end on the winner's banner, still and clean: when the banner shows up, take your text off so the name reads.
   The hook card (tinkazo-placa-<game>-en.png) goes on top of the first two seconds.
   In the piñata and La Entrada the action sits low: put your text at the top.
3. Upload it as a draft and check that the app's buttons do not cover your text. Then publish.

File names: tinkazo-<game>-9x16.mp4 (clips, ending with one still second on the banner),
tinkazo-<game>-9x16-bucle.mp4 (the same clip with the end faded into the start, to repeat it seamlessly),
tinkazo-placa-<game>-<language>.png (the hook card), tinkazo-logo-entrada-<background>.mp4 and
tinkazo-logo-cierre-<language>-<background>.mp4 (logo), tinkazo-guion-<game>-<language>.txt, tinkazo-subtitulos-<game>-<language>.srt.
The green-background ones are cut out with the chroma key. The .webm files carry transparency.
The brand typeface is Montserrat Black and Bold (tinkazo-letra-montserrat.zip, OFL license: free to use).

Two requests: do not promise cash prizes with the kit (joining a draw on Tinkazo is always free) and do not
change what the winner's banner says.

https://tinkazo.app/marca.html   Instagram: @tinkazo.app
`,
};
// La letra de la marca (licencia OFL: se puede usar y compartir), en un ZIP porque el kit solo sirve ciertos tipos de archivo.
const FUENTES = join(REPO, "scripts/marca/fuentes");
writeFileSync(join(SALIDA, "tinkazo-letra-montserrat.zip"), zip(["Montserrat-Black.ttf", "Montserrat-Bold.ttf", "OFL.txt"].map((f) => [`tinkazo-letra-montserrat/${f}`, readFileSync(join(FUENTES, f))])));
n += 1;
writeFileSync(join(SALIDA, "tinkazo-leeme-es.txt"), LEEME.es);
writeFileSync(join(SALIDA, "tinkazo-leeme-en.txt"), LEEME.en);
console.log(`${n + 2} archivos en ${SALIDA}`);
