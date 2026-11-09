/**
 * El contraste de lo que se ve en una captura, sin dependencias: lo usa `audit-lavado.mjs`.
 *
 * - `decodificarPng`: lee el PNG que saca Chrome (8 bits, RGB o RGBA, sin entrelazado) con `zlib`.
 * - `contrasteDeRegion`: de una región de la captura saca los dos tonos que la componen (el de la letra y el
 *   del fondo, por Otsu sobre el brillo) y da el contraste de WCAG 2.x entre sus medianas. Sirve para una letra
 *   sobre su ficha, para tinta sobre amarillo y para los cuadros de una bandera.
 * - `lavar`: el mismo modelo que el filtro `?lavado=1` (`styles.css`), por si hace falta aplicarlo a un color.
 *
 * Los umbrales (`UMBRALES`) son los de `docs/motores.md`, "La luz de la carrera".
 */
import { inflateSync } from "node:zlib";

/**
 * Los mínimos de contraste, de WCAG 2.x. Sin lavado, el cartel pide 7 a 1 (AAA para texto normal) y el resto 4,5 a 1 (AA).
 * Con el proyector lavado (`?lavado=1`) el cartel pide 4,5 a 1: es texto muy grande (100 px o más en 1080), donde AAA
 * también es 4,5, y la tinta de la marca sobre el amarillo no da más que 4,9 a 1 pasada por el filtro (con negro puro,
 * 5,7): 7 a 1 es físicamente imposible ahí. Las fichas y la bandera piden 4,5 a 1 lavadas también.
 */
export const UMBRALES = {
  cartel: { sin: 7, con: 4.5 },
  fichas: { sin: 4.5, con: 4.5 },
  bandera: { sin: 4.5, con: 4.5 },
};

/** El filtro de `?lavado=1`: `contrast(0.6) brightness(1.1)`. Igual a `LAVADO` de `src/games/llamas/carrera-luz.ts`. */
export const LAVADO = { contraste: 0.6, brillo: 1.1 };

const lin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** La luminancia relativa de WCAG 2.x de un color (r, g, b de 0 a 255). */
export const luminancia = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** El contraste de WCAG 2.x entre dos luminancias (1 a 21). */
export const razon = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** Un color [r, g, b] después del filtro del lavado, canal por canal en sRGB. */
export const lavar = ([r, g, b]) => [r, g, b].map((v) => Math.round(255 * Math.max(0, Math.min(1, ((v / 255 - 0.5) * LAVADO.contraste + 0.5) * LAVADO.brillo))));

/** Los píxeles de un PNG: `{ ancho, alto, datos }` con `datos` en RGBA, de a cuatro bytes por píxel. */
export function decodificarPng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("no es un PNG");
  let ancho = 0, alto = 0, profundidad = 0, tipo = 0, entrelazado = 0;
  const trozos = [];
  for (let i = 8; i + 8 <= buf.length; ) {
    const largo = buf.readUInt32BE(i);
    const nombre = buf.toString("latin1", i + 4, i + 8);
    const datos = buf.subarray(i + 8, i + 8 + largo);
    if (nombre === "IHDR") {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      profundidad = datos[8];
      tipo = datos[9];
      entrelazado = datos[12];
    } else if (nombre === "IDAT") trozos.push(datos);
    else if (nombre === "IEND") break;
    i += 12 + largo;
  }
  if (profundidad !== 8 || (tipo !== 2 && tipo !== 6) || entrelazado !== 0) throw new Error(`PNG no soportado (profundidad ${profundidad}, tipo ${tipo}, entrelazado ${entrelazado})`);
  const canales = tipo === 6 ? 4 : 3;
  const fila = ancho * canales;
  const crudo = inflateSync(Buffer.concat(trozos));
  const salida = new Uint8Array(ancho * alto * 4);
  let previa = new Uint8Array(fila);
  let actual = new Uint8Array(fila);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    const origen = y * (fila + 1) + 1;
    for (let x = 0; x < fila; x++) {
      const v = crudo[origen + x];
      const a = x >= canales ? actual[x - canales] : 0;
      const b = previa[x];
      const c = x >= canales ? previa[x - canales] : 0;
      let r;
      if (filtro === 0) r = v;
      else if (filtro === 1) r = v + a;
      else if (filtro === 2) r = v + b;
      else if (filtro === 3) r = v + ((a + b) >> 1);
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`filtro de PNG desconocido: ${filtro}`);
      actual[x] = r & 255;
    }
    for (let x = 0; x < ancho; x++) {
      const o = (y * ancho + x) * 4;
      salida[o] = actual[x * canales];
      salida[o + 1] = actual[x * canales + 1];
      salida[o + 2] = actual[x * canales + 2];
      salida[o + 3] = canales === 4 ? actual[x * canales + 3] : 255;
    }
    [previa, actual] = [actual, previa];
  }
  return { ancho, alto, datos: salida };
}

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

/**
 * El contraste entre los dos tonos de una región `{x, y, w, h}` (en píxeles de la imagen): se parten los píxeles en
 * claros y oscuros con el umbral de Otsu sobre la luminancia y se compara la mediana de cada grupo (la mediana, no el
 * promedio: el borde suavizado de la letra no cuenta). Si un grupo tiene menos de `minimo` (6 %) de los píxeles, no hay
 * dos tonos (la región está vacía o es lisa) y se devuelve `{ razon: 1, dosTonos: false }`.
 */
export function contrasteDeRegion(img, region, minimo = 0.06) {
  const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.ancho, Math.ceil(region.x + region.w)), y1 = Math.min(img.alto, Math.ceil(region.y + region.h));
  const lums = [];
  const colores = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.ancho + x) * 4;
      lums.push(luminancia(img.datos[o], img.datos[o + 1], img.datos[o + 2]));
      colores.push([img.datos[o], img.datos[o + 1], img.datos[o + 2]]);
    }
  }
  if (lums.length < 8) return { razon: 1, dosTonos: false, pixeles: lums.length };
  // Otsu sobre 256 cajas del brillo percibido (la raíz de la luminancia reparte mejor los oscuros).
  const cajas = new Array(256).fill(0);
  const caja = (l) => Math.min(255, Math.floor(Math.sqrt(l) * 255));
  for (const l of lums) cajas[caja(l)]++;
  const total = lums.length;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * cajas[i];
  let sumaB = 0, pesoB = 0, mejor = -1, umbral = 127;
  for (let i = 0; i < 256; i++) {
    pesoB += cajas[i];
    if (pesoB === 0) continue;
    const pesoF = total - pesoB;
    if (pesoF === 0) break;
    sumaB += i * cajas[i];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const varianza = pesoB * pesoF * (mB - mF) ** 2;
    if (varianza > mejor) {
      mejor = varianza;
      umbral = i;
    }
  }
  const oscuros = [], claros = [];
  lums.forEach((l) => (caja(l) <= umbral ? oscuros : claros).push(l));
  if (oscuros.length < minimo * total || claros.length < minimo * total) return { razon: 1, dosTonos: false, pixeles: total };
  const lo = mediana(oscuros), hi = mediana(claros);
  return { razon: razon(lo, hi), dosTonos: true, pixeles: total, claro: hi, oscuro: lo };
}
