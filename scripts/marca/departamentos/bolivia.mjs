/**
 * De toda Bolivia: los tiernos que no son de un solo departamento y, al final, el Tinku.
 *
 * Los dos del Tinku se dibujan en occidente.mjs (el baile es del norte de Potosí) y se suman acá con `...TINKU`, para
 * que la serie los tenga en su propia zona. Los tiernos kantuta, patujú y jucumari están en oriente.mjs.
 */
import { rect, rotar, poli } from "../base.mjs";
import { pixeles, llama, cinta, bloque, forma, simetrico } from "../pincel.mjs";
import { C } from "./comun.mjs";
import { TINKU } from "./occidente.mjs";

/**
 * El perezoso de tres dedos, colgado de frente con los dos brazos arriba: las garras claras enganchadas (las dos filas de
 * arriba van sobre la barra), la cara crema con el antifaz oscuro que baja hacia afuera, ojitos con brillo, nariz,
 * sonrisa y mejillas, y la panza más clara. Se arma desde la mitad izquierda: 20 columnas, el medio entre la 9 y la 10.
 * f pelaje, l panza, F pelaje en sombra, c cara, m antifaz, k tinta, w brillo, r mejilla, g garras.
 */
const PEREZOSO = simetrico([
  "..g.g.g...",
  "..g.g.g...",
  "..fffff...",
  "...fff....",
  "...fff....",
  "...fff..ff",
  "...fff.fff",
  "...fffffff",
  "...ffccccc",
  "...ffcmwcc",
  "...ffmmkcc",
  "...fmmmcck",
  "...ffrcckc",
  "...fffccck",
  "...fffffff",
  "..ffffffff",
  "..Ffffflll",
  "..Ffffllll",
  "..Ffffllll",
  "...Fffflll",
  "....ffffff",
  "....fff...",
  "....fff...",
  "....ggg...",
]);

/** La barra de progreso: una caja redonda, llena de turquesa con rayitas hasta `lleno`, y gris el resto. */
function barra(D, { x, y, w, h, lleno }) {
  bloque(D, { x, y, w, h, fill: C.barraVacia, borde: 0.85, sombra: 1.3, radio: h / 2 });
  const b = 0.85, xi = x + b, yi = y + b, wi = (w - 2 * b) * lleno, hi = h - 2 * b;
  // El relleno, con las puntas redondeadas del lado izquierdo como la caja.
  D.L.add(rect(xi + hi / 2, yi, wi - hi / 2, hi), "turquesa");
  D.L.add([["M", xi + hi / 2, yi], ...Array.from({ length: 17 }, (_, i) => ["L", xi + hi / 2 - Math.sin(i * Math.PI / 16) * hi / 2, yi + hi / 2 - Math.cos(i * Math.PI / 16) * hi / 2]), ["Z"]], "turquesa");
  // Las rayitas en diagonal del relleno, como las de una barra que avanza.
  for (let rx = xi + 1.2; rx < xi + wi - 1.4; rx += 2.6) D.L.add(poli([[rx, yi + hi], [rx + 1.1, yi + hi], [rx + 1.1 + hi * 0.6, yi], [rx + hi * 0.6, yi]]), "#4fd1c1");
  D.L.add(rect(xi + wi - 0.35, yi, 0.35, hi), "tinta");
}

export const STICKERS = [
  {
    id: "tierno-perezoso",
    nombre: "Cargando",
    frase: ["Cargando"],
    nota: "El perezoso de los bosques del oriente, colgado de una barra que no termina de cargar. La llama espera, con paciencia.",
    dibujar(D, frase) {
      const b = { x: 3, y: 4.6, w: 44, h: 5.8, lleno: 0.66 };
      barra(D, b);
      // Dos hojitas en la punta, como si la barra fuera una rama.
      forma(D, [[46.4, 5.6], [48.4, 2.6], [50.6, 1.8], [50.0, 4.4], [47.6, 6.4]], C.hoja, { borde: 0.6, sombra: 0.6 });
      forma(D, [[46.8, 8.4], [49.6, 8.6], [51.2, 10.4], [48.8, 11.2], [46.6, 9.6]], C.cerroVerde, { borde: 0.6, sombra: 0.6 });
      // El perezoso cuelga justo donde se corta el relleno: es él el que la carga.
      const p = 0.98, frente = b.x + 0.85 + (b.w - 1.7) * b.lleno;
      pixeles(D, PEREZOSO, { x: frente - 10 * p, y: b.y - 0.75, p, col: { f: C.perezoso, l: C.perezosoClaro, F: C.perezosoOsc, c: C.antifaz, m: C.pico, g: C.garra, r: C.mejilla }, borde: 0.6, sombra: 0.9 });
      // La llama, abajo, mira para arriba con paciencia.
      llama(D, { x: 4, y: 11.6, alto: 22, contorno: 0.9, sombra: 1.3, rot: -8 });
      // Cargando y tres puntitos cuadrados de colores, con su borde de tinta.
      const puntos = { em: 1.45, dibujar(D, { x, base, tam, rot, rc }) {
        const l = tam * 0.25, sep = tam * 0.17, b = tam * 0.045;
        ["magenta", "naranja", "turquesa"].forEach((col, i) => {
          const px = x + sep * 1.4 + i * (l + sep);
          D.L.add(rotar(rect(px - b, base - l - b, l + 2 * b, l + 2 * b), rot, ...rc), "tinta");
          D.L.add(rotar(rect(px, base - l, l, l), rot, ...rc), col);
        });
      } };
      cinta(D, { lineas: frase, cx: 25, y: 32.2, ancho: 37, fill: "amarillo", tamMax: 8.5, despues: puntos });
    },
  },
  ...TINKU,
];
