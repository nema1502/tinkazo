/**
 * Deriva las descargas de marca del icono original sin modificarlo: la llama (SVG y PNG), el sello,
 * los logos completos, los stickers (SVG y PDF a tamaño real) y el ZIP del kit.
 * Las letras van convertidas en trazos con Montserrat (licencia OFL, scripts/marca/fuentes), así
 * que nada depende de la letra del equipo. Es reproducible: dos corridas dejan los mismos bytes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, deflateRawSync } from "node:zlib";
import opentype from "opentype.js";
const destino = new URL("../public/marca/", import.meta.url);
mkdirSync(destino, { recursive: true });
const icono = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const grupo = icono.match(/<g[\s\S]*<\/g>/)[0];
writeFileSync(new URL("llama.svg", destino), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n  ${grupo}\n</svg>\n`);
const rects = [...grupo.matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
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
function chunk(tipo, datos) {
  const contenido = Buffer.concat([Buffer.from(tipo), datos]);
  let crc = 0xffffffff;
  for (const b of contenido) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const salida = Buffer.alloc(datos.length + 12);
  salida.writeUInt32BE(datos.length); contenido.copy(salida, 4);
  salida.writeUInt32BE((crc ^ 0xffffffff) >>> 0, salida.length - 4);
  return salida;
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

// ───────────────────────── Letras en trazos ─────────────────────────
const cargar = (nombre) => {
  const b = readFileSync(new URL(`./marca/fuentes/${nombre}`, import.meta.url));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
const negra = cargar("Montserrat-Black.ttf"); // la del nombre: lo más cerca del grosor 900 del sitio
const seminegra = cargar("Montserrat-Bold.ttf"); // para la frase del sello

// Un trazado es una lista de órdenes absolutas: ["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"].
function desdeOpentype(comandos) {
  const salida = [];
  let ax = 0, ay = 0;
  for (const c of comandos) {
    if (c.type === "M" || c.type === "L") { salida.push([c.type, c.x, c.y]); ax = c.x; ay = c.y; }
    else if (c.type === "C") { salida.push(["C", c.x1, c.y1, c.x2, c.y2, c.x, c.y]); ax = c.x; ay = c.y; }
    else if (c.type === "Q") {
      salida.push(["C", ax + 2 / 3 * (c.x1 - ax), ay + 2 / 3 * (c.y1 - ay), c.x + 2 / 3 * (c.x1 - c.x), c.y + 2 / 3 * (c.y1 - c.y), c.x, c.y]);
      ax = c.x; ay = c.y;
    } else if (c.type === "Z") salida.push(["Z"]);
  }
  return salida;
}
/** El texto como una lista de glifos (cada uno con su trazado), con la línea de base en y = 0. */
function texto(font, cadena, tam, espaciado = 0) {
  const glifos = [];
  let x = 0;
  const g = [...cadena].map((ch) => font.charToGlyph(ch));
  g.forEach((glifo, i) => {
    glifos.push({ ch: cadena[i], cmds: desdeOpentype(glifo.getPath(x, 0, tam).commands) });
    x += glifo.advanceWidth * tam / font.unitsPerEm;
    if (i < g.length - 1) x += (font.getKerningValue(glifo, g[i + 1]) || 0) * tam / font.unitsPerEm + espaciado;
  });
  return { glifos, ancho: x, mayuscula: font.tables.os2.sCapHeight * tam / font.unitsPerEm };
}
const mover = (cmds, s, dx, dy) => cmds.map(([t, ...p]) => [t, ...p.map((v, i) => v * s + (i % 2 ? dy : dx))]);
const rect = (x, y, w, h) => [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
const K = 0.5522847498;
const circulo = (cx, cy, r) => [["M", cx + r, cy], ["C", cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r], ["C", cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy], ["C", cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r], ["C", cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy], ["Z"]];
const redondeado = (x, y, w, h, r) => [
  ["M", x + r, y], ["L", x + w - r, y], ["C", x + w - r + K * r, y, x + w, y + r - K * r, x + w, y + r],
  ["L", x + w, y + h - r], ["C", x + w, y + h - r + K * r, x + w - r + K * r, y + h, x + w - r, y + h],
  ["L", x + r, y + h], ["C", x + r - K * r, y + h, x, y + h - r + K * r, x, y + h - r],
  ["L", x, y + r], ["C", x, y + r - K * r, x + r - K * r, y, x + r, y], ["Z"]];

// La llama: los mismos rectángulos del icono. Caja de 0 a 22 de ancho y de -2 a 24 de alto.
const CAJA = { x: 0, y: -2, w: 22, h: 26 };
const llamaCmds = (x, y, alto) => {
  const k = alto / CAJA.h;
  return rects.flatMap(([rx, ry, w, h]) => rect(x + (rx - CAJA.x) * k, y + (ry - CAJA.y) * k, w * k, h * k));
};
const anchoLlama = (alto) => alto * CAJA.w / CAJA.h;

// Colores: los del tema claro y los del oscuro de docs/marca.md.
const TEMAS = {
  claro: { tinta: "#191919", magenta: "#e93d9c", fondo: "#fff6e9" },
  oscuro: { tinta: "#f6efe2", magenta: "#ff5cb3", fondo: "#191919" },
};

// ───────────────────────── Salidas: SVG, PNG, PDF ─────────────────────────
const num = (v) => String(+v.toFixed(3));
const aD = (cmds) => cmds.map(([t, ...p]) => t + p.map(num).join(" ")).join("");
const rutaSvg = (s) => `<path d="${aD(s.cmds)}"${s.fill ? ` fill="${s.fill}"` : ' fill="none"'}${s.trazo ? ` stroke="${s.trazo}" stroke-width="${num(s.grosor)}"` : ""}/>`;

function aplanar(cmds) {
  const polis = [];
  let actual = null, x = 0, y = 0;
  for (const [t, ...p] of cmds) {
    if (t === "M") { actual = [[p[0], p[1]]]; polis.push(actual); x = p[0]; y = p[1]; }
    else if (t === "L") { actual.push([p[0], p[1]]); x = p[0]; y = p[1]; }
    else if (t === "C") {
      for (let i = 1; i <= 24; i++) {
        const u = i / 24, v = 1 - u;
        actual.push([v ** 3 * x + 3 * v * v * u * p[0] + 3 * v * u * u * p[2] + u ** 3 * p[4], v ** 3 * y + 3 * v * v * u * p[1] + 3 * v * u * u * p[3] + u ** 3 * p[5]]);
      }
      x = p[4]; y = p[5];
    }
  }
  return polis;
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Rasteriza rellenos con regla de no cero y 5 sub-barridos por fila. Devuelve RGBA sin premultiplicar. */
function rasterizar(formas, ancho, alto) {
  const acc = new Float64Array(ancho * alto * 4); // premultiplicado
  const SS = 5;
  for (const f of formas) {
    const aristas = [];
    for (const poli of aplanar(f.cmds)) for (let i = 0; i < poli.length; i++) {
      const a = poli[i], b = poli[(i + 1) % poli.length];
      if (a[1] !== b[1]) aristas.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]);
    }
    if (!aristas.length) continue;
    const y0 = Math.max(0, Math.floor(Math.min(...aristas.map((e) => e[1])))), y1 = Math.min(alto - 1, Math.ceil(Math.max(...aristas.map((e) => e[3]))));
    const [r, g, b] = hexRgb(f.fill);
    const fila = new Float64Array(ancho);
    for (let y = y0; y <= y1; y++) {
      fila.fill(0);
      for (let s = 0; s < SS; s++) {
        const sy = y + (s + .5) / SS;
        const cruces = [];
        for (const [xa, ya, xb, yb, d] of aristas) if (sy >= ya && sy < yb) cruces.push([xa + (sy - ya) / (yb - ya) * (xb - xa), d]);
        cruces.sort((p, q) => p[0] - q[0]);
        let w = 0;
        for (let i = 0; i < cruces.length - 1; i++) {
          w += cruces[i][1];
          if (w === 0) continue;
          const xa = Math.max(0, cruces[i][0]), xb = Math.min(ancho, cruces[i + 1][0]);
          for (let px = Math.floor(xa); px < xb && px < ancho; px++) fila[px] += (Math.min(xb, px + 1) - Math.max(xa, px)) / SS;
        }
      }
      for (let px = 0; px < ancho; px++) {
        const c = Math.min(1, fila[px]);
        if (!c) continue;
        const i = (y * ancho + px) * 4, k = 1 - c;
        acc[i] = acc[i] * k + r * c; acc[i + 1] = acc[i + 1] * k + g * c; acc[i + 2] = acc[i + 2] * k + b * c; acc[i + 3] = acc[i + 3] * k + c;
      }
    }
  }
  const raw = Buffer.alloc(alto * (ancho * 4 + 1));
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const i = (y * ancho + x) * 4, a = acc[i + 3];
    if (!a) continue;
    raw.set([Math.round(acc[i] / a), Math.round(acc[i + 1] / a), Math.round(acc[i + 2] / a), Math.round(a * 255)], y * (ancho * 4 + 1) + 1 + x * 4);
  }
  return raw;
}
function pngRgba(ancho, alto, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** PDF a mano (sin dependencias): una página de tamaño real en mm, con la caja de corte y la capa "corte" apagable. */
function pdf(anchoMm, altoMm, sangreMm, formas) {
  const pt = (mm) => mm * 72 / 25.4;
  const H = altoMm;
  const c = (v) => (v / 255).toFixed(4);
  const ruta = (cmds) => cmds.map(([t, ...p]) => {
    const q = p.map((v, i) => num(pt(i % 2 ? H - v : v)));
    return t === "M" ? `${q.join(" ")} m` : t === "L" ? `${q.join(" ")} l` : t === "C" ? `${q.join(" ")} c` : "h";
  }).join("\n");
  const dibujo = (f) => {
    let s = "";
    if (f.fill) s += `${hexRgb(f.fill).map(c).join(" ")} rg\n`;
    if (f.trazo) s += `${hexRgb(f.trazo).map(c).join(" ")} RG\n${num(pt(f.grosor))} w\n`;
    return `${s}${ruta(f.cmds)}\n${f.fill && f.trazo ? "B" : f.fill ? "f" : "S"}\n`;
  };
  const arte = formas.filter((f) => f.capa !== "corte").map(dibujo).join("");
  const corte = formas.filter((f) => f.capa === "corte").map(dibujo).join("");
  const contenido = `${arte}/OC /corte BDC\n${corte}EMC\n`;
  const A = pt(anchoMm).toFixed(3), B = pt(altoMm).toFixed(3), s = pt(sangreMm).toFixed(3);
  const trim = `[${s} ${s} ${(pt(anchoMm) - pt(sangreMm)).toFixed(3)} ${(pt(altoMm) - pt(sangreMm)).toFixed(3)}]`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /ON [5 0 R] /Order [5 0 R] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A} ${B}] /BleedBox [0 0 ${A} ${B}] /TrimBox ${trim} /Resources << /Properties << /corte 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(contenido, "latin1")} >>\nstream\n${contenido}endstream`,
    "<< /Type /OCG /Name (corte) >>",
    "<< /Title (Tinkazo) /Producer (generar-marca.mjs) >>",
  ];
  let salida = "%PDF-1.5\n";
  const desplazamientos = [];
  objetos.forEach((o, i) => { desplazamientos.push(Buffer.byteLength(salida, "latin1")); salida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(salida, "latin1");
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${desplazamientos.map((d) => `${String(d).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(salida, "latin1");
}

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

const tabla = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = tabla[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entradas) {
  const partes = [], central = [];
  let pos = 0;
  for (const [nombre, datos] of entradas) {
    const n = Buffer.from(nombre, "utf8"), crc = crc32(datos);
    const comprimido = deflateRawSync(datos, { level: 9 });
    const usa = comprimido.length < datos.length, cuerpo = usa ? comprimido : datos;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(usa ? 8 : 0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x0021, 12); // 1 de enero de 1980, siempre
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(cuerpo.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(n.length, 26);
    const reg = Buffer.alloc(46);
    reg.writeUInt32LE(0x02014b50); reg.writeUInt16LE(20, 4); reg.writeUInt16LE(20, 6); reg.writeUInt16LE(0x0800, 8); reg.writeUInt16LE(usa ? 8 : 0, 10);
    reg.writeUInt16LE(0, 12); reg.writeUInt16LE(0x0021, 14); reg.writeUInt32LE(crc, 16); reg.writeUInt32LE(cuerpo.length, 20); reg.writeUInt32LE(datos.length, 24);
    reg.writeUInt16LE(n.length, 28); reg.writeUInt32LE(pos, 42);
    central.push(reg, n);
    partes.push(local, n, cuerpo);
    pos += 30 + n.length + cuerpo.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fin]);
}
const leerPublico = (n) => archivos.get(n) ?? readFileSync(new URL(n, destino));
const raiz = "tinkazo-kit-marca";
const entradas = [[`${raiz}/LEEME.txt`, Buffer.from(LEEME, "utf8")]];
for (const nombre of ["logo-horizontal", "logo-horizontal-oscuro", "logo-apilado", "logo-apilado-oscuro"]) for (const ext of ["svg", "png"]) entradas.push([`${raiz}/logos/tinkazo-${nombre}.${ext}`, leerPublico(`${nombre}.${ext}`)]);
for (const nombre of ["llama", "llama-oscuro"]) for (const ext of ["svg", "png"]) entradas.push([`${raiz}/llama/tinkazo-${nombre}.${ext}`, leerPublico(`${nombre}.${ext}`)]);
for (const lang of ["es", "en"]) entradas.push([`${raiz}/sello/tinkazo-sello-${lang}.svg`, leerPublico(`sello-${lang}.svg`)]);
for (const [forma, tema] of STICKERS) for (const cm of [5, 7]) for (const ext of ["svg", "pdf"]) entradas.push([`${raiz}/stickers/tinkazo-${nombreSt(forma, tema, cm)}.${ext}`, leerPublico(`${nombreSt(forma, tema, cm)}.${ext}`)]);
writeFileSync(new URL("tinkazo-kit-marca.zip", destino), zip(entradas));

console.log(`Marca: llama, 4 logos (SVG y PNG de 2048), 2 sellos en trazos, 6 stickers (SVG y PDF) y tinkazo-kit-marca.zip con ${entradas.length} archivos.`);
