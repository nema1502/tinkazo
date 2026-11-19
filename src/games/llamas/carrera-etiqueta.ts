import type { Container, Graphics, Text } from "pixi.js";

/**
 * La ficha de nombre de una llama de la carrera: el fondo, el nombre y, a mitad de un cambio de forma, el nombre que se va.
 *
 * Cuando el nombre pasa de una forma a otra («Ana» a «Ana V.», `carrera-nombre-nivel.ts`), la ficha dibuja los dos a la vez: el que
 * se va con la opacidad `1 - mezcla` y el que llega con `mezcla`, y el fondo pasa del ancho de uno al del otro. La mezcla la da la
 * hora del show; acá no se guarda nada que cambie lo que se ve. Lo único que se recuerda es qué ya está puesto en los objetos de
 * PixiJS (`clave`, `mezcla`), para no volver a escribir un texto, un estilo o el fondo que ya están como corresponde: entre dos
 * cambios la ficha no toca PixiJS, y nunca crea objetos después de armarse.
 *
 * Solo usa los tipos de PixiJS: las piezas las arma quien llama, y así se prueba en Node con piezas de mentira.
 */

export type EstiloFicha = "normal" | "lider" | "echada";

/** Los colores y las transparencias de las fichas (los del tema). */
export interface AspectoFicha {
  tinta: number;
  amarillo: number;
  crema: number;
  /** El fondo de la ficha de una que se echó. */
  echada: number;
  fichaAlfa: number;
  fichaEchadaAlfa: number;
  /** El borde oscuro de la letra para un tamaño. */
  contorno(fs: number): { color: number; width: number; join: "round" };
}

export interface PiezasEtiqueta {
  raiz: Container;
  fondo: Graphics;
  /** El nombre (el que llega, a mitad de un cambio). */
  texto: Text;
  /** El nombre que se va, a mitad de un cambio de forma; fuera de un cambio no se ve. */
  sale: Text;
  /** El rótulo "ADELANTE" pegado a la izquierda de la ficha de quien va primera (celular), o la marca "!" de a quien le pasa un obstáculo: el nombre y la marca van en una sola pieza. */
  rotulo: Container;
  rotuloTexto: Text;
  rotuloFondo: Graphics;
}

export interface Etiqueta extends PiezasEtiqueta {
  /** Cuánto sobresale el rótulo a la izquierda de la ficha, en el espacio de la ficha (0 si no se muestra). */
  rotuloW: number;
  w: number;
  h: number;
  /** Lo que ya está puesto: los textos, la letra, el estilo y el rótulo. Vacía: hay que ponerlo todo. */
  clave: string;
  /** El estilo ya puesto en cada texto. */
  estiloTexto: string;
  estiloSale: string;
  /** La mezcla ya dibujada (el fondo y las opacidades); -1: hay que dibujarla. */
  mezcla: number;
  /** El ancho de la ficha con el nombre que llega y con el que se va. */
  wEntra: number;
  wSale: number;
  /** El ancho del rótulo. */
  rw: number;
}

/** Arma la ficha con sus piezas, una sola vez por llama. */
export function armarEtiqueta(p: PiezasEtiqueta): Etiqueta {
  p.texto.anchor.set(0.5);
  p.sale.anchor.set(0.5);
  p.sale.visible = false;
  p.rotuloTexto.anchor.set(0.5);
  p.rotulo.addChild(p.rotuloFondo, p.rotuloTexto);
  p.rotulo.visible = false;
  p.raiz.addChild(p.fondo, p.sale, p.texto, p.rotulo);
  return { ...p, rotuloW: 0, w: 0, h: 0, clave: "", estiloTexto: "", estiloSale: "", mezcla: -1, wEntra: 0, wSale: 0, rw: 0 };
}

/** Que la próxima vez se ponga todo de nuevo (cuando cambia el tamaño de la pantalla). */
export function olvidarEtiqueta(e: Etiqueta): void {
  e.clave = e.estiloTexto = e.estiloSale = "";
  e.mezcla = -1;
}

/** El tamaño de la letra de la ficha: la amarilla es más grande. */
const letraDe = (px: number, estilo: EstiloFicha): number => (estilo === "lider" ? px * 1.25 : px);

function darEstilo(tx: Text, fs: number, estilo: EstiloFicha, a: AspectoFicha): void {
  tx.style.fontSize = fs;
  tx.style.fill = estilo === "lider" ? a.tinta : a.crema;
  // La ficha amarilla lleva letra de tinta sin borde oscuro, en las dos carreras: tinta sobre amarillo ya tiene contraste
  // de sobra, y un borde de tinta sobre la tinta engorda las letras hasta que el nombre se vuelve una mancha que no se lee.
  // El trazo amarillo, del color de la ficha, no se ve: deja la letra tal cual.
  tx.style.stroke = estilo === "lider" ? { color: a.amarillo, width: 1, join: "round" } : a.contorno(fs);
}

/**
 * Pone en la ficha el nombre `s` con la letra `px` y el estilo `estilo`. A mitad de un cambio de forma, `sale` es el nombre que se
 * va y `mezcla` (de 0 a 1) cuánto llegó el nuevo; fuera de un cambio, `sale` vacío o `mezcla` 1. `rotulo` es el texto del rótulo de
 * la izquierda, o `null` si no lleva. Con `aviso`, el rótulo es la marca de un obstáculo ("!"): letra crema y no amarilla, para que no se
 * confunda con la de quien va adelante. Lo que se dibuja depende solo de estos datos.
 */
export function ponerEtiqueta(e: Etiqueta, s: string, sale: string, mezcla: number, px: number, estilo: EstiloFicha, a: AspectoFicha, rotulo: string | null, aviso = false): void {
  const funde = sale !== "" && sale !== s && mezcla < 1;
  const fs = letraDe(px, estilo);
  const clave = `${s}|${funde ? sale : ""}|${px.toFixed(1)}|${estilo}|${rotulo ?? ""}|${aviso ? 1 : 0}`;
  if (e.clave !== clave) {
    e.clave = clave;
    const ce = `${fs}|${estilo}`;
    if (e.estiloTexto !== ce) {
      darEstilo(e.texto, fs, estilo, a);
      e.estiloTexto = ce;
    }
    e.texto.text = s;
    e.wEntra = e.texto.width + fs * 0.5;
    if (funde) {
      if (e.estiloSale !== ce) {
        darEstilo(e.sale, fs, estilo, a);
        e.estiloSale = ce;
      }
      e.sale.text = sale;
      e.wSale = e.sale.width + fs * 0.5;
    }
    e.sale.visible = funde;
    // La ficha amarilla tiene más aire arriba y abajo: la letra queda rodeada de amarillo y no del borde de tinta.
    e.h = fs * (estilo === "lider" ? 1.6 : 1.28);
    // En el celular las llamas son chicas y las filas se apilan: la de adelante lleva la palabra pegada a su ficha, además de la raya y la manta.
    e.rotulo.visible = rotulo !== null;
    e.rotuloW = e.rw = 0;
    if (rotulo !== null) {
      const rf = fs * 0.8;
      e.rotuloTexto.style.fontSize = rf;
      e.rotuloTexto.style.fill = aviso ? a.crema : a.amarillo;
      e.rotuloTexto.text = rotulo;
      const rw = e.rotuloTexto.width + rf * 0.9, rh = rf * 1.35;
      e.rotuloFondo.clear().roundRect(-rw / 2, -rh / 2, rw, rh, rh * 0.3).fill(a.tinta);
      e.rw = rw;
      e.rotuloW = rw - 3;
    }
    e.mezcla = -1;
  }
  const m = funde ? mezcla : 1;
  if (e.mezcla === m) return;
  e.mezcla = m;
  // El fondo pasa del ancho del nombre que se va al del que llega, con la misma mezcla.
  const w = funde ? e.wSale + (e.wEntra - e.wSale) * m : e.wEntra;
  const h = e.h;
  e.w = w;
  e.texto.alpha = m;
  e.sale.alpha = 1 - m;
  e.fondo.clear();
  if (estilo === "lider") e.fondo.roundRect(-w / 2 + 3, -h / 2 + 3, w, h, h * 0.3).fill(a.tinta).roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill(a.amarillo).stroke({ width: Math.max(2, fs / 9), color: a.tinta });
  else e.fondo.roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill({ color: estilo === "echada" ? a.echada : a.tinta, alpha: estilo === "echada" ? a.fichaEchadaAlfa : a.fichaAlfa });
  if (rotulo !== null) e.rotulo.position.set(-w / 2 - e.rw / 2 + 3, 0);
}
