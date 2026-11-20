/** Piezas que comparten las pantallas de la campaña: contenedores, datos destacados y avisos a pantalla completa. */

/** Un contenedor con su clase, para armar las columnas y la barra de acción. */
export function caja(clase: string): HTMLDivElement {
  const elemento = document.createElement("div");
  elemento.className = clase;
  return elemento;
}

/**
 * Escribe una plantilla con un dato en su propio elemento, para que el número o la hora se vean más grandes.
 * El texto completo sigue siendo el mismo: quien usa un lector de pantalla oye la frase entera.
 */
export function conDestacado(
  destino: HTMLElement,
  plantilla: string,
  clave: string,
  valor: string,
  clase: string,
): void {
  const partes = plantilla.split(`{${clave}}`);
  destino.replaceChildren();
  partes.forEach((parte, indice) => {
    if (indice > 0) {
      const dato = document.createElement("span");
      dato.className = clase;
      dato.textContent = valor;
      destino.append(dato);
    }
    if (parte) destino.append(document.createTextNode(parte));
  });
}

/** La tilde grande dentro de un círculo. El festejo la hace saltar cuando algo sale bien. */
export function marcaDeTilde(): HTMLDivElement {
  const marca = caja("cmp-marca");
  marca.setAttribute("aria-hidden", "true");
  marca.textContent = "✓";
  return marca;
}

const ESPACIO_SVG = "http://www.w3.org/2000/svg";

/** Las piezas de la llama de la casa, las mismas de la cabecera: x, y, ancho y alto. */
const PIEZAS_DE_LA_LLAMA: ReadonlyArray<readonly [number, number, number, number]> = [
  [2, 11, 16, 7],
  [15, 3, 4, 10],
  [14, 0, 8, 4],
  [20, -2, 2, 3],
  [3, 18, 2.5, 6],
  [8, 18, 2.5, 6],
  [12.5, 18, 2.5, 6],
  [16, 18, 2.5, 6],
  [0, 9, 3, 4],
];

/** La llama de la casa como adorno grande de un aviso. Toma el color del texto que la rodea. */
export function llama(): SVGSVGElement {
  const dibujo = document.createElementNS(ESPACIO_SVG, "svg");
  dibujo.setAttribute("viewBox", "-1 -3 24 28");
  dibujo.setAttribute("class", "cmp-llama");
  dibujo.setAttribute("aria-hidden", "true");
  for (const [x, y, ancho, alto] of PIEZAS_DE_LA_LLAMA) {
    const pieza = document.createElementNS(ESPACIO_SVG, "rect");
    pieza.setAttribute("x", String(x));
    pieza.setAttribute("y", String(y));
    pieza.setAttribute("width", String(ancho));
    pieza.setAttribute("height", String(alto));
    dibujo.append(pieza);
  }
  return dibujo;
}

/** Uno o dos renglones en versalitas, encima del título de una pantalla, para saber de qué sorteo se habla. */
export function rotulosChicos(textos: readonly string[]): HTMLDivElement {
  const bloque = caja("cmp-rotulos");
  for (const texto of textos) {
    const linea = document.createElement("p");
    linea.className = "cmp-premio-etiqueta";
    linea.textContent = texto;
    bloque.append(linea);
  }
  return bloque;
}

/** El botón de un aviso: una acción con su texto, o un enlace si lleva a otra página. */
export interface AccionDeAviso {
  texto: string;
  alHacer?: () => void;
  enlace?: string;
}

/**
 * Un aviso a pantalla completa: el mensaje grande y centrado en el alto, y abajo su botón si lo tiene.
 * Un aviso de problema usa el fondo neutro de la página en lugar del color de la empresa.
 * Los rótulos, si hay, van arriba y chicos: de quién es el sorteo y lo que ayude a ubicarse.
 */
export function pintarAviso(
  raiz: HTMLElement,
  texto: string,
  accion: AccionDeAviso | null = null,
  problema = false,
  rotulos: readonly string[] = [],
): void {
  raiz.replaceChildren();
  raiz.hidden = false;
  raiz.className = "cmp-estado cmp-solo";
  const hero = caja(problema ? "cmp-izq cmp-hero cmp-alerta" : "cmp-izq cmp-hero");
  if (rotulos.length > 0) hero.append(rotulosChicos(rotulos));
  hero.append(llama());
  const mensaje = document.createElement("p");
  mensaje.className = "cmp-grande";
  mensaje.textContent = texto;
  hero.append(mensaje);
  raiz.append(hero);
  if (!accion) return;
  const barra = caja("cmp-accion");
  if (accion.enlace) {
    const enlace = document.createElement("a");
    enlace.className = "primary";
    enlace.href = accion.enlace;
    enlace.textContent = accion.texto;
    barra.append(enlace);
  } else {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "primary";
    boton.textContent = accion.texto;
    boton.addEventListener("click", () => accion.alHacer?.());
    barra.append(boton);
  }
  raiz.append(barra);
}
