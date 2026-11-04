/**
 * Deriva las descargas de marca del icono original sin modificarlo: la llama (SVG y PNG), el sello,
 * los logos completos, los stickers (SVG y PDF a tamaño real) y el ZIP del kit.
 * Las letras van convertidas en trazos con Montserrat (licencia OFL, scripts/marca/fuentes), así
 * que nada depende de la letra del equipo. Es reproducible: dos corridas dejan los mismos bytes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { grupo, rects, chunk, texto, negra, seminegra, mover, rect, circulo, redondeado, llamaCmds, anchoLlama, TEMAS, num, aD, rutaSvg, rasterizar, pngRgba, pdf, zip } from "./marca/base.mjs";
import { generarPiezas } from "./marca/piezas.mjs";
const destino = new URL("../public/marca/", import.meta.url);
mkdirSync(destino, { recursive: true });
writeFileSync(new URL("llama.svg", destino), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n  ${grupo}\n</svg>\n`);
const n = 2048;
function pixeles(color) {
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = ((x + .5) / 4 - 256) / 14 + 11, v = ((y + .5) / 4 - 256) / 14 + 11;
    if (rects.some(([rx, ry, w, h]) => u >= rx && u < rx + w && v >= ry && v < ry + h)) {
      const i = y * (n * 4 + 1) + 1 + x * 4;
      raw.set([...color, 255], i);
    }
  }
  return raw;
}
function png(color) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixeles(color))), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync(new URL("llama.png", destino), png([233, 61, 156]));
// Para fondo oscuro: el magenta del tema oscuro de docs/marca.md (#ff5cb3).
writeFileSync(new URL("llama-oscuro.svg", destino), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${grupo.replace("#e93d9c", "#ff5cb3")}
</svg>
`);
writeFileSync(new URL("llama-oscuro.png", destino), png([255, 92, 179]));

// ───────────────────────── Logos ─────────────────────────
/** Devuelve { formas, ancho, alto } en unidades del dibujo, con la caja ajustada y un margen. */
function logo(disposicion, tema) {
  const col = TEMAS[tema];
  const TAM = 100, ESP = 6; // el espaciado de la cabecera: 0,06 em
  const t = texto(negra, "TINKAZO", TAM, ESP);
  const formas = [];
  const alto = disposicion === "horizontal" ? t.mayuscula * 1.9 : t.ancho * 0.5;
  const aw = anchoLlama(alto);
  let lx, ly, tx, ty, W, H;
  const m = alto * 0.06;
  if (disposicion === "horizontal") {
    const sep = t.mayuscula * 0.85;
    lx = m; ly = m; tx = m + aw + sep; ty = m + alto / 2 + t.mayuscula / 2;
    W = tx + t.ancho + m; H = alto + 2 * m;
  } else {
    const sep = t.mayuscula * 0.5;
    W = t.ancho + 2 * m; lx = m + (t.ancho - aw) / 2; ly = m; ty = m + alto + sep + t.mayuscula; tx = m;
    H = ty + m;
  }
  formas.push({ cmds: llamaCmds(lx, ly, alto), fill: col.magenta });
  formas.push({ cmds: t.glifos.filter((g) => !"ZO".includes(g.ch)).flatMap((g) => mover(g.cmds, 1, tx, ty)), fill: col.tinta });
  formas.push({ cmds: t.glifos.filter((g) => "ZO".includes(g.ch)).flatMap((g) => mover(g.cmds, 1, tx, ty)), fill: col.magenta });
  return { formas, ancho: W, alto: H };
}
const svgDe = (w, h, formas) => `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}" role="img" aria-labelledby="titulo">
<title id="titulo">Tinkazo</title>
${formas.map(rutaSvg).join("\n")}
</svg>
`;

const archivos = new Map(); // nombre público → Buffer
const escribir = (nombre, datos) => { archivos.set(nombre, Buffer.from(datos)); writeFileSync(new URL(nombre, destino), datos); };
for (const disp of ["horizontal", "apilado"]) for (const tema of ["claro", "oscuro"]) {
  const { formas, ancho, alto } = logo(disp, tema);
  const nombre = `logo-${disp}${tema === "oscuro" ? "-oscuro" : ""}`;
  escribir(`${nombre}.svg`, svgDe(ancho, alto, formas));
  const pw = 2048, ph = Math.round(alto * pw / ancho), e = pw / ancho;
  escribir(`${nombre}.png`, pngRgba(pw, ph, rasterizar(formas.map((f) => ({ ...f, cmds: mover(f.cmds, e, 0, 0) })), pw, ph)));
}

// ───────────────────────── Sellos, ahora con las letras en trazos ─────────────────────────
const grupoLF = grupo.replaceAll("\r\n", "\n"); // el mismo resultado en un equipo con finales de línea CRLF
for (const [lang, frase] of [["es", "Sorteo verificable con"], ["en", "Verifiable draw with"]]) {
  const f = texto(seminegra, frase, 46), n = texto(negra, "Tinkazo", 96, -1.9);
  const trazos = (t, tx, ty, filtro) => aD(t.glifos.filter((g) => filtro(g.ch)).flatMap((g) => mover(g.cmds, 1, tx, ty)));
  escribir(`sello-${lang}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="280" viewBox="0 0 960 280" role="img" aria-labelledby="titulo" xml:lang="${lang}">
<title id="titulo">${frase} Tinkazo</title>
<path fill="#191919" d="M12 12h936v256H12z M18 18v244h924V18z" fill-rule="evenodd"/>
<g transform="translate(0 12) scale(.5)">${grupoLF}</g>
<path fill="#191919" d="${trazos(f, 270, 112, () => true)}"/>
<path fill="#191919" d="${trazos(n, 266, 208, (c) => c !== "z" && c !== "o")}"/>
<path fill="#e93d9c" d="${trazos(n, 266, 208, (c) => c === "z" || c === "o")}"/>
</svg>
`);
}

// ───────────────────────── Stickers ─────────────────────────
const SANGRE = 3; // mm
const LADO = 50; // el dibujo se hace a 5 cm y se escala al tamaño pedido
const nombreSt = (forma, tema, cm) => `sticker-${forma}${tema === "oscuro" ? "-oscuro" : ""}-${cm}cm`;
function sticker(forma, tema, cm) {
  const col = TEMAS[tema];
  const s = cm * 10 / LADO, b = SANGRE / s; // sangrado en unidades del dibujo
  const t = texto(negra, "TINKAZO", 100, 6);
  const formas = [];
  const R = 6; // radio de las esquinas del cuadrado
  const cortar = forma === "redondo" ? circulo(25, 25, 25) : redondeado(0, 0, 50, 50, R);
  const fondo = forma === "redondo" ? circulo(25, 25, 25 + b) : redondeado(-b, -b, 50 + 2 * b, 50 + 2 * b, R + b);
  const anillo = forma === "redondo" ? circulo(25, 25, 22.6) : redondeado(2.2, 2.2, 45.6, 45.6, R - 2.2);
  formas.push({ cmds: fondo, fill: col.fondo });
  formas.push({ cmds: anillo, trazo: col.tinta, grosor: 0.9 });
  const alto = forma === "redondo" ? 21 : 25, ancho = forma === "redondo" ? 30 : 36;
  const e = ancho / t.ancho;
  const cap = t.mayuscula * e, sep = forma === "redondo" ? 4 : 4.8;
  const total = alto + sep + cap, top = (LADO - total) / 2;
  formas.push({ cmds: llamaCmds(25 - anchoLlama(alto) / 2, top, alto), fill: col.magenta });
  const ty = top + alto + sep + cap, tx = 25 - ancho / 2;
  formas.push({ cmds: t.glifos.filter((g) => !"ZO".includes(g.ch)).flatMap((g) => mover(g.cmds, e, tx, ty)), fill: col.tinta });
  formas.push({ cmds: t.glifos.filter((g) => "ZO".includes(g.ch)).flatMap((g) => mover(g.cmds, e, tx, ty)), fill: col.magenta });
  formas.push({ cmds: cortar, trazo: "#ff00ff", grosor: 0.25 / s, capa: "corte" });
  // A tamaño real: 1 unidad del SVG = 1 mm, con el sangrado alrededor.
  const lado = cm * 10 + 2 * SANGRE;
  const enMm = formas.map((f) => ({ ...f, cmds: mover(f.cmds, s, SANGRE, SANGRE), grosor: f.grosor && f.grosor * s }));
  return { enMm, lado };
}
const STICKERS = [["redondo", "claro"], ["redondo", "oscuro"], ["cuadrado", "claro"]];
for (const [forma, tema] of STICKERS) for (const cm of [5, 7]) {
  const { enMm, lado } = sticker(forma, tema, cm);
  const arte = enMm.filter((f) => f.capa !== "corte"), corte = enMm.filter((f) => f.capa === "corte");
  const cuerpo = `<g id="arte">\n${arte.map(rutaSvg).join("\n")}\n</g>\n<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0.25">\n${corte.map((f) => `<path d="${aD(f.cmds)}"/>`).join("\n")}\n</g>\n`;
  escribir(`${nombreSt(forma, tema, cm)}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}mm" height="${lado}mm" viewBox="0 0 ${lado} ${lado}" role="img" aria-labelledby="titulo">
<title id="titulo">Tinkazo, sticker de ${cm} cm con ${SANGRE} mm de sangrado</title>
${cuerpo}</svg>
`);
  escribir(`${nombreSt(forma, tema, cm)}.pdf`, pdf(lado, lado, SANGRE, enMm));
}

// ───────────────────────── El ZIP ─────────────────────────
const LEEME = `TINKAZO, KIT DE MARCA PARA PATROCINIOS Y EVENTOS
================================================

Tinkazo: sorteos que cualquiera puede comprobar
Tinkazo cierra la lista de participantes antes de sortear, así nadie puede cambiarla después. El ganador sale de un número público que nadie conoce de antemano, y cualquiera puede repetir la cuenta y comprobar el resultado. Participar es gratis, siempre.

Sitio: https://tinkazo.app
Contacto: hola@tinkazo.app
Esta misma página, con todo para descargar: https://tinkazo.app/marca.html

QUÉ HAY ADENTRO
  logos/     Logo completo, horizontal y apilado, para fondo claro y para fondo oscuro (SVG y PNG de 2048 px de ancho, fondo transparente).
  llama/     La llama sola, para fondo claro y oscuro (SVG y PNG).
  sello/     "Sorteo verificable con Tinkazo", en español y en inglés (SVG).
  stickers/  Sticker redondo (claro y oscuro) y cuadrado, de 5 y de 7 cm (SVG y PDF).
Las letras de los logos, el sello y los stickers están convertidas en trazos: se ven igual en cualquier equipo e impresora.

COLORES
  Tema claro:  fondo #fff6e9, tinta #191919, magenta #e93d9c
  Tema oscuro: fondo #191919 (sticker) o #171126 (sitio), texto #f6efe2, magenta #ff5cb3

REGLAS DE USO
  1. Espacio libre alrededor del logo igual a la altura de la llama.
  2. Tamaño mínimo: 24 px de alto en pantalla y 8 mm impreso.
  3. No lo estires ni lo deformes.
  4. No le cambies los colores.
  5. No lo pongas sobre fondos que no contrasten: usá la versión clara sobre fondo claro y la oscura sobre fondo oscuro.
  6. Se escribe "Tinkazo", todo junto y con la T mayúscula.

STICKERS
  Stickers: archivos a tamaño real con 3 mm de sangrado; la capa 'corte' es la línea de corte; imprimir en vinilo mate; los colores son RGB, la imprenta los convierte.

-------------------------------------------------------------------------------

TINKAZO, BRAND KIT FOR SPONSORSHIPS AND EVENTS
==============================================

Tinkazo: draws anyone can check
Tinkazo locks the list of participants before the draw, so no one can change it afterwards. The winner comes from a public number that nobody knows in advance, and anyone can redo the math and check the result. Taking part is always free.

Site: https://tinkazo.app
Contact: hola@tinkazo.app
This same page, with everything to download: https://tinkazo.app/marca.html

WHAT IS INSIDE
  logos/     Full logo, horizontal and stacked, for light and dark backgrounds (SVG and PNG, 2048 px wide, transparent background).
  llama/     The llama alone, for light and dark backgrounds (SVG and PNG).
  sello/     "Verifiable draw with Tinkazo", in Spanish and English (SVG).
  stickers/  Round sticker (light and dark) and square sticker, 5 and 7 cm (SVG and PDF).
The lettering of the logos, the seal and the stickers is converted to outlines: it looks the same on any computer or printer.

COLORS
  Light theme: background #fff6e9, ink #191919, magenta #e93d9c
  Dark theme:  background #191919 (sticker) or #171126 (site), text #f6efe2, magenta #ff5cb3

USAGE RULES
  1. Clear space around the logo equal to the height of the llama.
  2. Minimum size: 24 px tall on screen and 8 mm in print.
  3. Do not stretch or distort it.
  4. Do not change its colors.
  5. Do not place it on backgrounds that do not contrast: use the light version on light backgrounds and the dark one on dark backgrounds.
  6. It is written "Tinkazo", one word, with a capital T.

STICKERS
  Stickers: true-size files with 3 mm bleed; the 'corte' layer is the cut line; print on matte vinyl; colors are RGB, the printer converts them.

The lettering is drawn from Montserrat (SIL Open Font License 1.1, https://openfontlicense.org).
`.replace(/\n/g, "\r\n");

const leerPublico = (n) => archivos.get(n) ?? readFileSync(new URL(n, destino));
const raiz = "tinkazo-kit-marca";
const entradas = [[`${raiz}/LEEME.txt`, Buffer.from(LEEME, "utf8")]];
for (const nombre of ["logo-horizontal", "logo-horizontal-oscuro", "logo-apilado", "logo-apilado-oscuro"]) for (const ext of ["svg", "png"]) entradas.push([`${raiz}/logos/tinkazo-${nombre}.${ext}`, leerPublico(`${nombre}.${ext}`)]);
for (const nombre of ["llama", "llama-oscuro"]) for (const ext of ["svg", "png"]) entradas.push([`${raiz}/llama/tinkazo-${nombre}.${ext}`, leerPublico(`${nombre}.${ext}`)]);
for (const lang of ["es", "en"]) entradas.push([`${raiz}/sello/tinkazo-sello-${lang}.svg`, leerPublico(`sello-${lang}.svg`)]);
for (const [forma, tema] of STICKERS) for (const cm of [5, 7]) for (const ext of ["svg", "pdf"]) entradas.push([`${raiz}/stickers/tinkazo-${nombreSt(forma, tema, cm)}.${ext}`, leerPublico(`${nombreSt(forma, tema, cm)}.${ext}`)]);
writeFileSync(new URL("tinkazo-kit-marca.zip", destino), zip(entradas));

console.log(`Marca: llama, 4 logos (SVG y PNG de 2048), 2 sellos en trazos, 6 stickers (SVG y PDF) y tinkazo-kit-marca.zip con ${entradas.length} archivos.`);
