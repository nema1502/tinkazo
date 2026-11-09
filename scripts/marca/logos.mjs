/**
 * El logo completo (llama, TINKAZO y, si se pide, la dirección tinkazo.app), dibujado una sola vez y usado
 * tanto por los archivos del logo como por las imágenes de redes, los afiches y la portada del kit.
 */
import { negra, seminegra, texto, mover, llamaCmds, anchoLlama, PAL } from "./base.mjs";

/**
 * Dibuja el logo en el lienzo `l`. (x, y) es la esquina de arriba a la izquierda y `alto` el alto de la llama.
 * disp: "horizontal" (llama a la izquierda) o "apilado" (llama arriba). Con `url`, tinkazo.app va debajo de la palabra
 * en Montserrat Bold, a la mitad de su tamaño. Devuelve la caja que ocupa todo el logo.
 */
export function logo(l, { x, y, alto, disp = "horizontal", url = false, colorLlama = "magenta", colorTinta = "tinta" }) {
  const TAM = 100, ESP = 6; // el espaciado de la cabecera del sitio: 0,06 em
  const t = texto(negra, "TINKAZO", TAM, ESP);
  const cap = t.mayuscula;
  const U = url ? texto(seminegra, "tinkazo.app", TAM / 2, 0) : null;
  const capU = url ? cap / 2 : 0;
  const GAP = cap * 0.36, DESC = url ? TAM / 2 * 0.2 : 0; // aire entre palabra y dirección, y lo que baja la "p"
  const columna = cap + (url ? GAP + capU + DESC : 0);
  let k, lx, ly, tx, tyCap; // k: escala del dibujo respecto de la medida base
  if (disp === "horizontal") {
    // La columna de texto mide casi lo mismo que la llama: se centra contra ella.
    const baseAlto = url ? columna * 1.0 : cap * 1.9;
    k = alto / baseAlto;
    const sep = cap * 0.85;
    lx = x; ly = y;
    tx = x + (anchoLlama(baseAlto) + sep) * k;
    tyCap = y + (baseAlto - columna) / 2 * k;
  } else {
    const baseAlto = t.ancho * 0.5;
    k = alto / baseAlto;
    const sep = cap * 0.5;
    lx = x + (t.ancho - anchoLlama(baseAlto)) / 2 * k; ly = y;
    tx = x; tyCap = y + (baseAlto + sep) * k;
  }
  const pintar = (glifos, dx, dy, filtro, color) => l.add(glifos.filter(filtro).flatMap((g) => mover(g.cmds, k, dx, dy)), color);
  const altoLlama = disp === "horizontal" ? (url ? columna : cap * 1.9) * k : t.ancho * 0.5 * k;
  l.add(llamaCmds(lx, ly, altoLlama), colorLlama);
  const baseY = tyCap + cap * k;
  pintar(t.glifos, tx, baseY, (g) => !"ZO".includes(g.ch), colorTinta);
  pintar(t.glifos, tx, baseY, (g) => "ZO".includes(g.ch), colorLlama);
  let anchoTotal = disp === "horizontal" ? (tx - x) + t.ancho * k : t.ancho * k;
  let altoTotal = disp === "horizontal" ? altoLlama : (baseY - y) + 0;
  if (url) {
    // La dirección ocupa el ancho de la palabra, repartiendo el aire entre sus letras (hasta un tope).
    const ancho0 = U.ancho, objetivo = t.ancho, huecos = U.glifos.length - 1;
    const esp = Math.min((objetivo - ancho0) / huecos, TAM / 2 * 0.14);
    const U2 = texto(seminegra, "tinkazo.app", TAM / 2, esp);
    const baseU = baseY + (GAP + capU) * k;
    const ox = disp === "apilado" ? tx + (t.ancho - U2.ancho) / 2 * k : tx; // horizontal: a la izquierda de la T; apilado: centrada
    // El ".app" va en magenta: las últimas cuatro letras.
    const ini = U2.glifos.length - 4;
    l.add(U2.glifos.slice(0, ini).flatMap((g) => mover(g.cmds, k, ox, baseU)), colorTinta);
    l.add(U2.glifos.slice(ini).flatMap((g) => mover(g.cmds, k, ox, baseU)), colorLlama);
    altoTotal = disp === "horizontal" ? Math.max(altoLlama, baseU + DESC * k - y) : baseU + DESC * k - y;
    anchoTotal = Math.max(anchoTotal, (U2.ancho) * k + (tx - x));
  } else if (disp === "apilado") altoTotal = baseY - y;
  return { x, y, ancho: anchoTotal, alto: altoTotal };
}

/** Un archivo de logo: lienzo transparente con el logo ajustado y un margen del 6 % del alto de la llama. */
export function logoArchivo(Lienzo, disp, tema, url) {
  const medida = new Lienzo(10, 10, tema);
  const ALTO = 200;
  const b = logo(medida, { x: 0, y: 0, alto: ALTO, disp, url });
  const m = ALTO * 0.06;
  const l = new Lienzo(b.ancho + 2 * m, b.alto + 2 * m, tema);
  logo(l, { x: m, y: m, alto: ALTO, disp, url });
  return l;
}
