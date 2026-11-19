/**
 * Los QR clave: códigos listos para poner en un afiche, un volante, una historia, una diapositiva o un sticker.
 * Sirven a quien organiza un evento, a un sponsor, a quien diseña y a una comunidad, y cada uno lleva a un punto
 * clave de tinkazo.app. Todo vive en public/marca/qr/:
 *
 *   qr-<destino>-<fondo>.svg|png   el código solo: módulos de tinta (#191919) sobre blanco, sobre el papel de la marca
 *                                  (#fff6e9) o sin fondo, con su margen de 4 módulos. El principal sale en los tres
 *                                  fondos; los demás destinos, sobre blanco. Los genera este módulo.
 *   qr-etiqueta-<color>.png        el QR con la llamita arriba y «tinkazo.app» abajo, de 2000 por 2580 px y con fondo
 *                                  transparente, en magenta y en amarillo.
 *   qr-tarjeta-<cuadrada|historia>-<papel|amarillo|noche>-<es|en>.png   las tarjetas para redes.
 *   tinkazo-qr.zip                 todo junto, con un LEEME. Lo arma este módulo.
 *
 * La etiqueta y las tarjetas se dibujan en HTML con la letra y la llama de la marca y se capturan con Chrome: no las
 * genera este módulo, que las lee tal cual para el ZIP. Todo lo que genera es reproducible (dos corridas, los mismos
 * bytes; el ZIP lleva siempre la fecha 1-1-1980). Los módulos son siempre oscuros sobre claro (invertido lo leen pocos
 * lectores), la llama nunca va dentro del código y ningún destino lleva parámetros de rastreo: lo que se escanea es
 * una página y nada más.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { chunk, zip } from "./base.mjs";
import { matrizQr, ZONA } from "./qr.mjs";

const TINTA = [25, 25, 25, 255]; // #191919
/** Los tres fondos del código solo. «transparente» deja solo los módulos oscuros: va únicamente sobre un fondo claro. */
export const FONDOS = {
  blanco: { rgba: [255, 255, 255, 255], css: "#ffffff" },
  papel: { rgba: [255, 246, 233, 255], css: "#fff6e9" },
  transparente: { rgba: [255, 255, 255, 0], css: null },
};

/**
 * Los destinos, el principal primero. `url` es lo que se codifica: exactamente esa dirección, sin nada más. `camino` es
 * la dirección corta que se escribe junto al código.
 *
 * Hay que cuidar que cada destino sirva a quien llega sin contexto. `verificar.html` sin un comprobante en la dirección
 * muestra «Este enlace no trae un sorteo»: el comprobante vive en el fragmento de cada sorteo. Por eso «Comprobalo vos»
 * lleva a la página que explica, paso a paso, cómo se comprueba un sorteo.
 */
export const DESTINOS = [
  { id: "tinkazo-app", url: "https://tinkazo.app/", camino: "tinkazo.app", titulo: "Tinkazo, sorteos que cualquiera puede comprobar", principal: true },
  { id: "demo-carrera", url: "https://tinkazo.app/?demo=race", camino: "tinkazo.app/?demo=race", titulo: "Mirar un sorteo en vivo: la carrera de llamas" },
  { id: "comprobar", url: "https://tinkazo.app/sorteo-verificable.html", camino: "tinkazo.app/sorteo-verificable.html", titulo: "Comprobar un sorteo, paso a paso" },
  { id: "juegos", url: "https://tinkazo.app/juegos.html", camino: "tinkazo.app/juegos.html", titulo: "Los diez juegos de Tinkazo" },
  { id: "instagram", url: "https://www.instagram.com/tinkazo.app/", camino: "instagram.com/tinkazo.app", titulo: "Instagram de Tinkazo" },
];

/** Los archivos que se dibujan aparte (HTML y Chrome) y viajan tal cual. */
export const ETIQUETAS = ["magenta", "amarilla"];
export const FONDOS_TARJETA = ["papel", "amarillo", "noche"];
export const FORMATOS_TARJETA = ["cuadrada", "historia"];
export const LANGS = ["es", "en"];
export const nombreEtiqueta = (color) => `qr-etiqueta-${color}.png`;
export const nombreTarjeta = (formato, fondo, lang) => `qr-tarjeta-${formato}-${fondo}-${lang}.png`;

// ───────────────────────── El código solo ─────────────────────────

/** La matriz de módulos, con una consulta que tolera salirse del código (el margen es claro). */
function matriz(texto) {
  const base = matrizQr(texto);
  const n = base.n;
  return { n, oscuro: (f, c) => f >= 0 && c >= 0 && f < n && c < n && base.oscuro(f, c) };
}

/** El SVG: un solo trazado de módulos oscuros, en unidades de módulo, con su margen de 4 módulos. */
export function svgSolo(m, fondo, titulo, url) {
  const L = m.n + 2 * ZONA;
  let d = "";
  for (let f = 0; f < m.n; f++) {
    for (let c = 0; c < m.n;) {
      if (!m.oscuro(f, c)) { c++; continue; }
      let e = c;
      while (e < m.n && m.oscuro(f, e)) e++;
      d += `M${c + ZONA} ${f + ZONA}h${e - c}v1h${c - e}z`;
      c = e;
    }
  }
  const fondoRect = fondo.css ? `<rect width="${L}" height="${L}" fill="${fondo.css}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${L}" width="${L * 10}" height="${L * 10}" shape-rendering="crispEdges" role="img" aria-label="${titulo}"><title>${titulo}</title><desc>Código QR que lleva a ${url}</desc>${fondoRect}<path d="${d}" fill="#191919"/></svg>\n`;
}

/** El PNG: cada módulo es un cuadrado de píxeles enteros (sin bordes suaves) y el lado ronda los 2000 px. */
export function pngSolo(m, fondo) {
  const L = m.n + 2 * ZONA;
  const escala = Math.max(1, Math.floor(2048 / L));
  const W = L * escala;
  const raw = Buffer.alloc((W * 4 + 1) * W);
  for (let f = 0; f < L; f++) {
    const fila = Buffer.alloc(W * 4);
    for (let c = 0; c < L; c++) {
      const col = m.oscuro(f - ZONA, c - ZONA) ? TINTA : fondo.rgba;
      for (let k = 0; k < escala; k++) fila.set(col, (c * escala + k) * 4);
    }
    for (let k = 0; k < escala; k++) fila.copy(raw, (f * escala + k) * (W * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
  return { W, bytes: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]) };
}

// ───────────────────────── El LEEME ─────────────────────────

const LLEVA = {
  "tinkazo-app": { es: "La portada: ahí se pega la lista, se entra con una cuenta y se sortea. Participar es gratis, siempre.", en: "The home page, where you paste the list, sign in with an account and run the draw. Joining is free, always." },
  "demo-carrera": { es: "Mirá uno en vivo: un sorteo de ejemplo con la carrera de llamas. No graba nada.", en: "Watch one live: an example draw with the llama race. It saves nothing." },
  comprobar: { es: "Comprobalo vos: cómo cualquiera comprueba un sorteo, paso a paso.", en: "Check it yourself: how anyone checks a draw, step by step." },
  juegos: { es: "Los diez juegos con que se cuenta el sorteo.", en: "The ten games that tell the draw." },
  instagram: { es: "Seguinos: nuestro Instagram, @tinkazo.app.", en: "Follow us: our Instagram, @tinkazo.app." },
};
const lineasDestinos = (lang, principal) => DESTINOS.filter((d) => !!d.principal === principal)
  .map((d) => `  qr-${d.id.padEnd(12)} ${d.url}\n    ${LLEVA[d.id][lang]}`).join("\n");

export function leemeQr() {
  const texto = `TINKAZO, QR PARA TU ARTE
========================

Códigos QR listos para poner en un afiche, un volante, una historia, una diapositiva o un sticker. Sirven a quien organiza un evento, a un sponsor, a quien diseña y a una comunidad. Todos se bajan gratis. La página con todo: https://tinkazo.app/marca.html#qr

EL PRINCIPAL
${lineasDestinos("es", true)}
  etiquetas/qr-etiqueta-magenta.png y qr-etiqueta-amarilla.png
    El QR con la llamita arriba y la dirección tinkazo.app abajo, de 2000 por 2580 px y con fondo transparente. La placa es blanca, así que se lee sobre cualquier fondo: elegí el color de etiqueta que más contraste con tu arte.
  tarjetas/qr-tarjeta-cuadrada-<fondo>-<es|en>.png   1080 por 1080 px, para una publicación.
  tarjetas/qr-tarjeta-historia-<fondo>-<es|en>.png   1080 por 1920 px, para una historia o un Reel. El contenido respeta las zonas de Instagram.
    Los fondos son papel (el crema de la marca), amarillo y noche.
  codigos/qr-tinkazo-app-blanco, -papel y -transparente (.svg y .png)
    El código solo: módulos de tinta (#191919) sobre blanco (el más seguro), sobre el crema de la marca (#fff6e9) o sin fondo, solo para ponerlo sobre un fondo CLARO. El SVG es vectorial, para imprimir en grande. El PNG mide unos 2000 px.

MÁS DESTINOS (codigos/mas-destinos, sobre blanco, en SVG y en PNG)
${lineasDestinos("es", false)}

Ningún código lleva parámetros de rastreo ni nada que identifique a quien lo escanea: abre una dirección limpia (una página de Tinkazo o nuestro Instagram), y nada más.

REGLAS PARA QUE SIEMPRE LEA
  1. Tamaño mínimo impreso: 2 cm de lado el código solo (con su margen blanco) y 3 cm de ancho la etiqueta. Mejor más grande.
  2. Siempre oscuro sobre claro. Nunca invertido ni con poco contraste.
  3. No le cambies el color, no lo estires ni lo deformes, no lo tapes con adornos ni le pongas un logo encima. La llama ya viene al lado.
  4. Dejale el margen blanco que trae (4 módulos): no lo recortes.
  5. Probalo con un celular, a la distancia real, antes de imprimir todo.

DETALLE TÉCNICO
  Corrección de errores nivel Q: el código se sigue leyendo con hasta un 25 % dañado. Todos se probaron con un lector de QR, al tamaño completo y reducidos. Los colores están en RGB: la imprenta los pasa a CMYK.

-------------------------------------------------------------------------------

TINKAZO, QR CODES FOR YOUR ARTWORK
==================================

QR codes ready to drop into a poster, a flyer, a story, a slide or a sticker. They work for whoever runs an event, for a sponsor, for a designer and for a community. All free to download. The page with everything: https://tinkazo.app/marca.html#qr

THE MAIN ONE
${lineasDestinos("en", true)}
  etiquetas/qr-etiqueta-magenta.png and qr-etiqueta-amarilla.png
    The QR with the little llama on top and the address tinkazo.app below, 2000 by 2580 px with a transparent background. The plate is white, so it reads on any background: pick the label color that contrasts most with your artwork.
  tarjetas/qr-tarjeta-cuadrada-<background>-<es|en>.png   1080 by 1080 px, for a post.
  tarjetas/qr-tarjeta-historia-<background>-<es|en>.png   1080 by 1920 px, for a story or a Reel. The content respects Instagram's safe zones.
    The backgrounds are papel (the brand cream), amarillo (yellow) and noche (night).
  codigos/qr-tinkazo-app-blanco, -papel and -transparente (.svg and .png)
    The code on its own: ink-colored modules (#191919) on white (the safest), on the brand cream (#fff6e9) or with no background, only to place over a LIGHT background. The SVG is a vector, for printing large. The PNG is about 2000 px.

MORE DESTINATIONS (codigos/mas-destinos, on white, as SVG and PNG)
${lineasDestinos("en", false)}

No code carries tracking parameters or anything that identifies whoever scans it: it opens a clean address (a Tinkazo page or our Instagram), and nothing else.

RULES SO IT ALWAYS READS
  1. Minimum printed size: 2 cm per side for the code on its own (with its white margin) and 3 cm wide for the label. Bigger is better.
  2. Always dark on light. Never inverted or with low contrast.
  3. Do not change its color, stretch or distort it, cover it with decorations or put a logo on top. The llama already comes beside it.
  4. Keep the white margin it comes with (4 modules): do not crop it.
  5. Test it with a phone, at the real distance, before printing everything.

TECHNICAL DETAIL
  Error correction level Q: the code still reads with up to 25 % damaged. All of them were tested with a QR reader, at full size and reduced. Colors are RGB: the printer converts them to CMYK.
`;
  return texto.replace(/\n/g, "\r\n");
}

// ───────────────────────── Todo junto ─────────────────────────

/**
 * Genera los códigos solos en `dir` (una URL de carpeta, normalmente public/marca/qr/) y arma tinkazo-qr.zip con ellos,
 * la etiqueta y las tarjetas que ya están en esa carpeta. Devuelve lo que hace falta para informar.
 */
export function generarQrClave(dir) {
  mkdirSync(dir, { recursive: true });
  const solos = []; // [carpeta dentro del ZIP, nombre]
  for (const d of DESTINOS) {
    const m = matriz(d.url);
    for (const nombreFondo of d.principal ? Object.keys(FONDOS) : ["blanco"]) {
      const base = `qr-${d.id}-${nombreFondo}`;
      writeFileSync(new URL(`${base}.svg`, dir), svgSolo(m, FONDOS[nombreFondo], d.titulo, d.url));
      writeFileSync(new URL(`${base}.png`, dir), pngSolo(m, FONDOS[nombreFondo]).bytes);
      for (const ext of ["svg", "png"]) solos.push([d.principal ? "codigos" : "codigos/mas-destinos", `${base}.${ext}`]);
    }
  }
  const aparte = [
    ...ETIQUETAS.map((c) => ["etiquetas", nombreEtiqueta(c)]),
    ...FORMATOS_TARJETA.flatMap((f) => FONDOS_TARJETA.flatMap((fo) => LANGS.map((l) => ["tarjetas", nombreTarjeta(f, fo, l)]))),
  ];
  const entradas = [["tinkazo-qr/LEEME.txt", Buffer.from(leemeQr(), "utf8")]];
  for (const [carpeta, nombre] of [...aparte, ...solos]) entradas.push([`tinkazo-qr/${carpeta}/${nombre}`, readFileSync(new URL(nombre, dir))]);
  const comprimido = zip(entradas);
  writeFileSync(new URL("tinkazo-qr.zip", dir), comprimido);
  return { archivos: entradas.length, zip: comprimido.length };
}
