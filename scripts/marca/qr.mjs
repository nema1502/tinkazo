/**
 * El QR de las piezas impresas: lo arma `qrcode-generator` (la misma biblioteca del sitio, en Node puro) y
 * acá se vuelve un trazado de módulos oscuros. Corrección de errores nivel Q (hasta un 25 % dañado),
 * pensada para una impresión chica o con un roce. La zona tranquila de 4 módulos la pone quien lo dibuja.
 */
import qrcode from "qrcode-generator";
import { rect } from "./base.mjs";

export const ZONA = 4; // módulos de margen claro obligatorio

/** Matriz de módulos del QR de un texto. */
export function matrizQr(texto) {
  const q = qrcode(0, "Q");
  q.addData(texto);
  q.make();
  const n = q.getModuleCount();
  return { n, oscuro: (f, c) => q.isDark(f, c) };
}

/**
 * Los módulos oscuros como rectángulos (cada fila une los consecutivos), con la esquina superior izquierda
 * del QR en (x, y) y `lado` de ancho total SIN contar la zona tranquila.
 */
export function cmdsQr(texto, x, y, lado) {
  const { n, oscuro } = matrizQr(texto);
  const m = lado / n;
  const cmds = [];
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n;) {
      if (!oscuro(f, c)) { c++; continue; }
      let k = c;
      while (k < n && oscuro(f, k)) k++;
      cmds.push(...rect(x + c * m, y + f * m, (k - c) * m + m * 0.03, m * 1.03)); // un pelo de solape: sin líneas finas entre módulos
      c = k;
    }
  }
  return { cmds, n, modulo: m };
}
