/**
 * Lo común de los generadores de marca: letras en trazos (Montserrat, OFL), geometría, un rasterizador
 * propio de PNG, el PDF a mano y el ZIP. Sin dependencias nativas y sin fechas: dos corridas, los mismos bytes.
 */
import { readFileSync } from "node:fs";
import { deflateSync, deflateRawSync } from "node:zlib";
import opentype from "opentype.js";

const icono = readFileSync(new URL("../../public/icon.svg", import.meta.url), "utf8");
export const grupo = icono.match(/<g[\s\S]*<\/g>/)[0];
export const rects = [...grupo.matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
export function chunk(tipo, datos) {
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
// ───────────────────────── Letras en trazos ─────────────────────────
export const cargar = (nombre) => {
  const b = readFileSync(new URL(`./fuentes/${nombre}`, import.meta.url));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
export const negra = cargar("Montserrat-Black.ttf"); // la del nombre: lo más cerca del grosor 900 del sitio
export const seminegra = cargar("Montserrat-Bold.ttf"); // para la frase del sello

// Un trazado es una lista de órdenes absolutas: ["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"].
export function desdeOpentype(comandos) {
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
export function texto(font, cadena, tam, espaciado = 0) {
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
export const mover = (cmds, s, dx, dy) => cmds.map(([t, ...p]) => [t, ...p.map((v, i) => v * s + (i % 2 ? dy : dx))]);
export const rect = (x, y, w, h) => [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
export const K = 0.5522847498;
export const circulo = (cx, cy, r) => [["M", cx + r, cy], ["C", cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r], ["C", cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy], ["C", cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r], ["C", cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy], ["Z"]];
export const redondeado = (x, y, w, h, r) => [
  ["M", x + r, y], ["L", x + w - r, y], ["C", x + w - r + K * r, y, x + w, y + r - K * r, x + w, y + r],
  ["L", x + w, y + h - r], ["C", x + w, y + h - r + K * r, x + w - r + K * r, y + h, x + w - r, y + h],
  ["L", x + r, y + h], ["C", x + r - K * r, y + h, x, y + h - r + K * r, x, y + h - r],
  ["L", x, y + r], ["C", x, y + r - K * r, x + r - K * r, y, x + r, y], ["Z"]];

// La llama: los mismos rectángulos del icono. Caja de 0 a 22 de ancho y de -2 a 24 de alto.
export const CAJA = { x: 0, y: -2, w: 22, h: 26 };
export const llamaCmds = (x, y, alto) => {
  const k = alto / CAJA.h;
  return rects.flatMap(([rx, ry, w, h]) => rect(x + (rx - CAJA.x) * k, y + (ry - CAJA.y) * k, w * k, h * k));
};
export const anchoLlama = (alto) => alto * CAJA.w / CAJA.h;

// Colores: los del tema claro y los del oscuro de docs/marca.md.
export const TEMAS = {
  claro: { tinta: "#191919", magenta: "#e93d9c", fondo: "#fff6e9" },
  oscuro: { tinta: "#f6efe2", magenta: "#ff5cb3", fondo: "#191919" },
};

// ───────────────────────── Salidas: SVG, PNG, PDF ─────────────────────────
export const num = (v) => String(+v.toFixed(3));
export const aD = (cmds) => cmds.map(([t, ...p]) => t + p.map(num).join(" ")).join("");
export const rutaSvg = (s) => `<path d="${aD(s.cmds)}"${s.fill ? ` fill="${s.fill}"` : ' fill="none"'}${s.trazo ? ` stroke="${s.trazo}" stroke-width="${num(s.grosor)}"` : ""}/>`;

export function aplanar(cmds) {
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
export const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Rasteriza rellenos con regla de no cero y 5 sub-barridos por fila. Devuelve RGBA sin premultiplicar. */
export function rasterizar(formas, ancho, alto) {
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
      let lo = ancho, hi = -1;
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
          if (xb > xa) { lo = Math.min(lo, Math.floor(xa)); hi = Math.max(hi, Math.min(ancho - 1, Math.ceil(xb))); }
          for (let px = Math.floor(xa); px < xb && px < ancho; px++) fila[px] += (Math.min(xb, px + 1) - Math.max(xa, px)) / SS;
        }
      }
      for (let px = lo; px <= hi; px++) {
        const c = Math.min(1, fila[px]);
        fila[px] = 0;
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
export function pngRgba(ancho, alto, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** PDF a mano (sin dependencias): una página de tamaño real en mm, con la caja de corte y la capa "corte" apagable. */
export function pdf(anchoMm, altoMm, sangreMm, formas) {
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
  const flujo = deflateSync(Buffer.from(contenido, "latin1"), { level: 9 }); // el dibujo va comprimido (Flate)
  const objetos = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /ON [5 0 R] /Order [5 0 R] >> >> >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A} ${B}] /BleedBox [0 0 ${A} ${B}] /TrimBox ${trim} /Resources << /Properties << /corte 5 0 R >> >> /Contents 4 0 R >>`, "latin1"),
    Buffer.concat([Buffer.from(`<< /Length ${flujo.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), flujo, Buffer.from("\nendstream", "latin1")]),
    Buffer.from("<< /Type /OCG /Name (corte) >>", "latin1"),
    Buffer.from("<< /Title (Tinkazo) /Producer (generar-marca.mjs) >>", "latin1"),
  ];
  const partes = [Buffer.from("%PDF-1.5\n", "latin1")];
  let pos = partes[0].length;
  const desplazamientos = [];
  objetos.forEach((o, i) => {
    desplazamientos.push(pos);
    const p = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
    partes.push(p); pos += p.length;
  });
  partes.push(Buffer.from(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${desplazamientos.map((d) => `${String(d).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  return Buffer.concat(partes);
}

export const tabla = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = tabla[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(entradasSinOrden) {
  // Siempre por nombre: el mismo orden en Windows, Linux y macOS.
  const entradas = [...entradasSinOrden].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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

// ───────────────────────── Para las piezas de la segunda vuelta ─────────────────────────
/** La paleta de docs/marca.md. "sobre" es la tinta que va encima de los acentos, en los dos temas. */
export const PAL = {
  claro: { papel: "#fff6e9", tarjeta: "#ffffff", tinta: "#191919", tinta2: "#4b4437", apagado: "#6b655b", magenta: "#e93d9c", naranja: "#ff7a1a", turquesa: "#00a896", amarillo: "#ffc629", morado: "#6c4ce0", sobre: "#191919" },
  oscuro: { papel: "#171126", tarjeta: "#221a33", tinta: "#f6efe2", tinta2: "#cfc6b4", apagado: "#97909f", magenta: "#ff5cb3", naranja: "#ff8b3d", turquesa: "#17c3b2", amarillo: "#ffd24d", morado: "#9b7bff", sobre: "#191919" },
};
/** Los cinco acentos en el orden de la franja del sitio. */
export const ACENTOS = ["magenta", "naranja", "amarillo", "turquesa", "morado"];

/** Transformación afín: x' = a x + c y + e, y' = b x + d y + f. */
export const afin = (cmds, a, b, c, d, e, f) => cmds.map(([t, ...p]) => {
  const q = [];
  for (let i = 0; i < p.length; i += 2) q.push(a * p[i] + c * p[i + 1] + e, b * p[i] + d * p[i + 1] + f);
  return [t, ...q];
});
export const rotar = (cmds, grados, cx, cy) => {
  const r = grados * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
  return afin(cmds, co, si, -si, co, cx - co * cx + si * cy, cy - si * cx - co * cy);
};
/** Un polígono con el sentido de giro de las letras (positivo), para que al juntarlos en una forma no se resten. */
export function poli(puntos) {
  let a = 0;
  puntos.forEach(([x, y], i) => { const [u, v] = puntos[(i + 1) % puntos.length]; a += x * v - u * y; });
  const p = a < 0 ? [...puntos].reverse() : puntos;
  return [["M", ...p[0]], ...p.slice(1).map((q) => ["L", ...q]), ["Z"]];
}
/** Recorre al revés un subtrazado cerrado (para hacer un hueco con la regla de no cero). */
export function invertir(cmds) {
  const segs = [];
  let [, cx, cy] = cmds[0];
  for (const c of cmds.slice(1)) {
    if (c[0] === "L") { segs.push(["L", [cx, cy], [c[1], c[2]]]); cx = c[1]; cy = c[2]; }
    else if (c[0] === "C") { segs.push(["C", [cx, cy], [c[1], c[2]], [c[3], c[4]], [c[5], c[6]]]); cx = c[5]; cy = c[6]; }
  }
  const sal = [["M", cx, cy]];
  for (const s of segs.reverse()) sal.push(s[0] === "L" ? ["L", ...s[1]] : ["C", ...s[3], ...s[2], ...s[1]]);
  sal.push(["Z"]);
  return sal;
}
/** Un marco: el contorno de afuera con el de adentro recortado. */
export const marco = (afuera, adentro) => [...afuera, ...invertir(adentro)];

/**
 * El contorno de la unión de varios rectángulos [x, y, w, h], expandidos `d` hacia todos lados.
 * Devuelve una lista de subtrazados cerrados con ángulos rectos: la línea de corte de una silueta.
 */
export function contornoUnion(rs, d = 0) {
  const R = rs.map(([x, y, w, h]) => [x - d, y - d, x + w + d, y + h + d]);
  const xs = [...new Set(R.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(R.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const lleno = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1
    && R.some((r) => r[0] <= xs[i] && r[2] >= xs[i + 1] && r[1] <= ys[j] && r[3] >= ys[j + 1]);
  // Aristas con el interior a la derecha del sentido de giro (en pantalla).
  const sig = new Map();
  const arista = (a, b) => { const k = a.join(","); (sig.get(k) ?? sig.set(k, []).get(k)).push(b); };
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    if (!lleno(i, j)) continue;
    if (!lleno(i, j - 1)) arista([xs[i], ys[j]], [xs[i + 1], ys[j]]);
    if (!lleno(i + 1, j)) arista([xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]);
    if (!lleno(i, j + 1)) arista([xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]);
    if (!lleno(i - 1, j)) arista([xs[i], ys[j + 1]], [xs[i], ys[j]]);
  }
  const lazos = [];
  for (const [k0, lista] of sig) {
    while (lista.length) {
      const pts = [k0.split(",").map(Number)];
      let sigp = lista.pop();
      while (sigp.join(",") !== k0) {
        pts.push(sigp);
        const l = sig.get(sigp.join(","));
        sigp = l.pop();
      }
      // Quita los puntos alineados.
      const limpios = pts.filter((p, i) => {
        const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
        return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
      });
      lazos.push(["M", ...limpios[0], ...[]].slice(0, 3), ...limpios.slice(1).map((p) => ["L", ...p]), ["Z"]);
    }
  }
  return lazos;
}
/** Convierte la lista plana devuelta por contornoUnion (M, L..., Z, M, ...) en la misma lista: ya es válida. */

/** Un generador pseudoaleatorio con semilla (mulberry32): el azar de los dibujos es siempre el mismo. */
export function azar(semilla) {
  let a = semilla >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** PNG RGBA con más compresión, para las imágenes grandes de las redes. */
export function pngNivel(ancho, alto, raw, nivel = 9) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: nivel })), chunk("IEND", Buffer.alloc(0))]);
}

/** SVG a tamaño real en mm (1 unidad = 1 mm), con el arte y la capa de corte aparte. */
export function svgMm(anchoMm, altoMm, formas, titulo) {
  const arte = formas.filter((f) => f.capa !== "corte"), corte = formas.filter((f) => f.capa === "corte");
  const ruta = (f) => `<path${f.clase ? ` class="${f.clase}"` : ""} d="${aD(f.cmds)}"${f.fill ? ` fill="${f.fill}"` : ' fill="none"'}${f.trazo ? ` stroke="${f.trazo}" stroke-width="${num(f.grosor)}"` : ""}/>`;
  const capaCorte = corte.length ? `<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0.25">\n${corte.map((f) => `<path d="${aD(f.cmds)}"/>`).join("\n")}\n</g>\n` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(anchoMm)}mm" height="${num(altoMm)}mm" viewBox="0 0 ${num(anchoMm)} ${num(altoMm)}" role="img" aria-labelledby="titulo">
<title id="titulo">${titulo}</title>
<g id="arte">
${arte.map(ruta).join("\n")}
</g>
${capaCorte}</svg>
`;
}
