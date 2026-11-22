/**
 * Los logos cuadrados y con fondo, para redes y para quien nos pone de sponsor: la foto de perfil (amarilla, crema y
 * oscura), el logo cuadrado con fondo en 1080 y en 2400 y el horizontal con fondo en 2400. Salen de las mismas piezas
 * del generador (la llama, las letras en trazos y el logo de la pared de sponsors): solo se les pone un fondo liso.
 * Son PNG RGB, sin canal de transparencia, para que cada red los recorte sin elegir un fondo por su cuenta.
 * También arma tinkazo-logos.zip, el paquete liviano con todo lo anterior, lo transparente y los vectores.
 */
import { deflateSync } from "node:zlib";
import { afin, chunk, rasterizar, rect, rotar, llamaCmds, anchoLlama, PAL, zip } from "./base.mjs";
import { Lienzo } from "./dibujo.mjs";
import { logoPared } from "./impresos.mjs";

/** Los tres fondos de la marca: nombre en el archivo, color y variante del logo (el oscuro lleva las letras claras). */
export const FONDOS_LOGO = [
  { id: "crema", color: PAL.claro.papel, variante: "claro" },
  { id: "blanco", color: "#ffffff", variante: "claro" },
  { id: "oscuro", color: PAL.oscuro.papel, variante: "oscuro" },
];
export const LADO_PERFIL = 1080;
/** La foto de perfil amarilla que la marca ya usa en redes: se midió en ella el ángulo, el tamaño y el corrimiento de la sombra. */
const AMARILLO = { fondo: PAL.claro.amarillo, tinta: "#191919", llama: PAL.claro.magenta, grados: -3, unidad: 23.08, centro: [563.96, 526.12], sombra: [10.54, 9.47] };
/** Alto de la llama sola en las fotos de perfil crema y oscura, como parte del lado: con aire de sobra para el recorte redondo. */
const ALTO_PERFIL = 0.54;

/** Un PNG RGB (tipo 2, sin transparencia) de las formas pintadas sobre un fondo que cubre todo el cuadro. */
export function pngRgb(ancho, alto, formas) {
  const rgba = rasterizar(formas, ancho, alto);
  const fila = ancho * 3 + 1, raw = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const i = y * (ancho * 4 + 1) + 1 + x * 4, o = y * fila + 1 + x * 3;
    if (rgba[i + 3] !== 255) throw new Error(`el fondo no cubre el píxel ${x},${y}`);
    raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const fondoLiso = (w, h, color) => ({ cmds: rect(0, 0, w, h), fill: color });
const escalar = (formas, e) => formas.map((f) => ({ ...f, cmds: afin(f.cmds, e, 0, 0, e, 0, 0) }));

/** El logo de la pared de sponsors sobre un color liso, escalado al ancho pedido. */
function logoConFondo(forma, { color, variante }, ancho) {
  const l = logoPared(forma, variante), e = ancho / l.w;
  return pngRgb(ancho, Math.round(l.h * e), [fondoLiso(ancho, Math.round(l.h * e), color), ...escalar(l.formas, e)]);
}

/** La llama sola, centrada por su caja, sobre el fondo del tema. */
function perfilLlama(tema, color) {
  const L = LADO_PERFIL, alto = L * ALTO_PERFIL, ancho = anchoLlama(alto);
  return pngRgb(L, L, [fondoLiso(L, L, color), { cmds: llamaCmds((L - ancho) / 2, (L - alto) / 2, alto), fill: PAL[tema].magenta }]);
}

/** La foto de perfil amarilla: la llama inclinada, con una sombra dura de tinta corrida abajo a la derecha. */
function perfilAmarillo() {
  const a = AMARILLO, L = LADO_PERFIL, k = a.unidad, [cx, cy] = a.centro;
  // La llama mide 22 por 26 unidades y su centro está en (11, 11) del dibujo, que es (x + 11 k, y + 13 k) en el lienzo.
  const llama = rotar(llamaCmds(cx - 11 * k, cy - 13 * k, 26 * k), a.grados, cx, cy);
  return pngRgb(L, L, [fondoLiso(L, L, a.fondo), { cmds: afin(llama, 1, 0, 0, 1, a.sombra[0], a.sombra[1]), fill: a.tinta }, { cmds: llama, fill: a.llama }]);
}

/**
 * Escribe los PNG nuevos de public/marca con `escribir`. Devuelve los nombres de los seis de 2400 con fondo, que se suman
 * al kit para sponsors.
 */
export function generarLogosFondo(escribir) {
  escribir("perfil-amarillo-1080.png", perfilAmarillo());
  escribir("perfil-crema-1080.png", perfilLlama("claro", PAL.claro.papel));
  escribir("perfil-oscuro-1080.png", perfilLlama("oscuro", PAL.oscuro.papel));
  const sponsor = [];
  for (const f of FONDOS_LOGO) {
    escribir(`logo-cuadrado-fondo-${f.id}-1080.png`, logoConFondo("cuadrado", f, 1080));
    for (const [forma, ancho] of [["cuadrado", 2400], ["horizontal", 2400]]) {
      const nombre = `logo-${forma}-fondo-${f.id}-${ancho}.png`;
      escribir(nombre, logoConFondo(forma, f, ancho));
      sponsor.push(nombre);
    }
  }
  return { sponsor };
}

// ───────────────────────── El paquete tinkazo-logos.zip ─────────────────────────
const RAIZ = "tinkazo-logos";
/** Las cuatro variantes sin fondo de la pared: sufijo del archivo en public/marca y nombre que lleva dentro del paquete. */
const SIN_FONDO = [["", "para-fondo-claro"], ["-oscuro", "para-fondo-oscuro"], ["-negro", "negro"], ["-blanco", "blanco"]];

export const LEEME_LOGOS = `LOGOS DE TINKAZO
================

Cuadrados y horizontales, con fondo o transparentes, para redes y para sponsors.
Sitio: https://tinkazo.app
Contacto: hola@tinkazo.app
Esta misma página, con todo para descargar: https://tinkazo.app/marca.html

QUÉ HAY ADENTRO
  redes/
    Cuadrados de 1080 por 1080 con fondo. Se suben tal cual.
    perfil: la llama sola, para la foto de perfil. Entra en el recorte redondo. Hay amarillo, crema y oscuro.
    logo-cuadrado-fondo: la llama con el nombre, para publicaciones. Hay crema, blanco y oscuro.
  sponsors/
    Para mandar a quien organiza. Los logos van en 2400 px, la llama en 2048 y los vectores se agrandan sin perder nada.
    cuadrado-con-fondo y horizontal-con-fondo: se usan tal cual.
    cuadrado-sin-fondo y horizontal-sin-fondo: transparentes, para poner sobre un arte.
      para-fondo-claro y negro van sobre fondos claros.
      para-fondo-oscuro y blanco van sobre fondos oscuros.
      El blanco no se ve en la vista previa de Windows. Es normal.
    llama-sin-fondo: la llama sola, transparente.
    vectores: SVG y PDF para imprenta.

REGLAS
  No estires el logo, no le cambies los colores y dejá aire alrededor.
  Se escribe Tinkazo, todo junto y con la T mayúscula.

COLORES
  Magenta #e93d9c   Tinta #191919   Crema #fff6e9   Noche #171126   Amarillo #ffc629
  Sobre fondo oscuro: magenta #ff5cb3 y letras #f6efe2

Instagram: @tinkazo.app (https://www.instagram.com/tinkazo.app/)

-------------------------------------------------------------------------------

TINKAZO LOGOS (English)
=======================

Square and horizontal, with a background or transparent, for social media and sponsors.
Site: https://tinkazo.app
Contact: hola@tinkazo.app
This same page, with everything to download: https://tinkazo.app/marca.html

WHAT IS INSIDE
  redes/ (social media)
    1080 by 1080 squares with a background, ready to upload.
    perfil is the llama alone, for a profile picture. It fits the round crop. Yellow, cream and dark.
    logo-cuadrado-fondo is the llama with the name, for posts. Cream, white and dark.
  sponsors/
    To send to the organizers. The logos are 2400 px, the llama is 2048 px and the vectors scale up without losing anything.
    cuadrado-con-fondo and horizontal-con-fondo are ready to use.
    cuadrado-sin-fondo and horizontal-sin-fondo are transparent, to place over your own artwork.
      para-fondo-claro and negro go on light backgrounds.
      para-fondo-oscuro and blanco go on dark backgrounds.
      The white one does not show in the Windows preview. That is normal.
    llama-sin-fondo is the llama alone, transparent.
    vectores holds SVG and PDF for print.

RULES
  Do not stretch the logo, do not change its colors and leave clear space around it.
  It is written Tinkazo, one word, with a capital T.

COLORS
  Magenta #e93d9c   Ink #191919   Cream #fff6e9   Night #171126   Yellow #ffc629
  On a dark background: magenta #ff5cb3 and letters #f6efe2
`.replace(/\n/g, "\r\n");

/** El ZIP liviano de logos. `leer(nombre)` devuelve los bytes de un archivo de public/marca ya generado. */
export function zipLogos(leer) {
  const e = [[`${RAIZ}/LEEME.txt`, Buffer.from(LEEME_LOGOS, "utf8")]];
  for (const n of ["amarillo", "crema", "oscuro"]) e.push([`${RAIZ}/redes/tinkazo-perfil-${n}-1080.png`, leer(`perfil-${n}-1080.png`)]);
  for (const f of FONDOS_LOGO) {
    e.push([`${RAIZ}/redes/tinkazo-logo-cuadrado-fondo-${f.id}-1080.png`, leer(`logo-cuadrado-fondo-${f.id}-1080.png`)]);
    e.push([`${RAIZ}/sponsors/cuadrado-con-fondo/tinkazo-logo-cuadrado-fondo-${f.id}-2400.png`, leer(`logo-cuadrado-fondo-${f.id}-2400.png`)]);
    e.push([`${RAIZ}/sponsors/horizontal-con-fondo/tinkazo-logo-horizontal-fondo-${f.id}-2400.png`, leer(`logo-horizontal-fondo-${f.id}-2400.png`)]);
  }
  for (const forma of ["cuadrado", "horizontal"]) for (const [suf, nombre] of SIN_FONDO) {
    e.push([`${RAIZ}/sponsors/${forma}-sin-fondo/tinkazo-logo-${forma}-${nombre}-2400.png`, leer(`logo-pared-${forma}${suf}-2400.png`)]);
    for (const ext of ["svg", "pdf"]) e.push([`${RAIZ}/sponsors/vectores/tinkazo-logo-${forma}-${nombre}.${ext}`, leer(`logo-pared-${forma}${suf}.${ext}`)]);
  }
  for (const [suf, nombre] of SIN_FONDO.slice(0, 2)) {
    e.push([`${RAIZ}/sponsors/llama-sin-fondo/tinkazo-llama-${nombre}-2048.png`, leer(`llama${suf}.png`)]);
    e.push([`${RAIZ}/sponsors/vectores/tinkazo-llama-${nombre}.svg`, leer(`llama${suf}.svg`)]);
  }
  return { bytes: zip(e), archivos: e.length };
}
