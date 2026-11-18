/**
 * Lo común de la serie de los nueve departamentos: la paleta, la postal (el formato del Tinkazo en TARIJA) y los
 * sombreros de la llama. Lo de cada zona va en su archivo (occidente, valles, oriente y bolivia).
 */
import { rect, poli } from "../base.mjs";
import { caja, medir } from "../dibujo.mjs";
import { C as C0, pixeles, llama, disco, dentro, girar, centroLlama, cinta, forma } from "../pincel.mjs";

/** La paleta: la de la colección más los colores nuevos de la serie. Los de la marca van por nombre ("magenta"...). */
export const C = {
  ...C0,
  // La Paz
  apiMorado: "#7a2f7a", apiEspuma: "#b571b5", pastel: "#f2b84b", pastelOsc: "#d98f2b",
  totora: "#e6c35c", totoraOsc: "#b8923a", asfalto: "#5b5b66", ladrillo: "#c8553d", ladrilloOsc: "#8c3b28",
  ladera: "#e3a66b", laderaOsc: "#c98450", calamina: "#a7adb5",
  // Oruro y Potosí
  lagunaRoja: "#d9483b", lagunaOnda: "#e8735a", flamenco: "#f7a1c4", flamencoOsc: "#e0679a",
  cerroRico: "#b4553a", cerroRicoOsc: "#8c3b28", ocre: "#c98f4a", ocreOsc: "#9b6a33", arena: "#e8c890",
  vizcacha: "#9e9a93", queñua: "#a0522d", caparazon: "#c8a77a", caparazonOsc: "#9c7b52", salar: "#d7eef7", reflejo: "#f6a9d0",
  // Cochabamba y Chuquisaca
  piedra: "#9aa0a6", piedraOsc: "#6f757b", locoto: "#d52b1e", choclo: "#f9d648", durazno: "#ffad6b",
  chocolate: "#6b3e26", chocolateClaro: "#8a5234", tejidoRojo: "#c8323a", dino: "#6fd3c4", dinoOsc: "#3fb3a3", pared: "#e8dcc4", tapaCharango: "#f0c27a",
  // Tarija
  blanqueado: "#fffaf0",
  // Santa Cruz, Beni y Pando
  tajiboAmarillo: "#ffd23f", cunape: "#f2c14e", achachairu: "#ff8c1a", bufeo: "#f4a3b5", bufeoOsc: "#c98d9e",
  paraba: "#1f9bd1", victoria: "#4f9a3a", victoriaBorde: "#b0413e", capiguara: "#a0673f", castana: "#8d5a2b",
  semilla: "#f3e3c3", asai: "#4b1f4f", atardecer: "#ff9a4d",
  // Los tiernos
  jucumari: "#2a2522", antifaz: "#f3e3c3", perezoso: "#a08a6e", perezosoOsc: "#7d6a52", perezosoClaro: "#c4b296",
  garra: "#efe6d2", barraVacia: "#d9d2c3",
  // El Tinku
  montera: "#f3eee6", monteraOsc: "#d8cfbf",
};

// ───────────────────────── La postal ─────────────────────────
/** El disco de la postal: el mismo lugar y tamaño en los nueve. */
export const DISCO = { cx: 25, cy: 19, r: 17.5 };
/** Dónde va la llama en la postal, como en la de Tarija: a la izquierda, delante del disco y saliendo por abajo. */
export const LLAMA_POSTAL = { x: 8.5, y: 5.2, alto: 27 };

/**
 * La postal de un departamento, en el formato del Tinkazo en TARIJA que se agotó: un disco con el paisaje, la llama
 * delante saliendo por abajo y dos cintas giradas -3 grados: la chica con Tinkazo en y la grande con el nombre.
 *
 * - `paisaje(D, disco)` dibuja lo de adentro del disco: todo queda recortado contra el círculo (se puede dibujar de más).
 * - `llama` es { x, y, alto, rot } (por defecto LLAMA_POSTAL, parada y derecha). Con `rot` baila o salta.
 * - `sombrero(D, ll)` le pone el sombrero del lugar a la llama (chullo, sombreroChapaco, montera) o cualquier cosa que
 *   vaya pegada a ella y gire con ella (la honda de la llamerada): recibe la misma `ll`.
 * - `delante(D)` dibuja lo que va encima de la llama y fuera del disco (un brillo, una flor).
 * - `nombre` va en mayúsculas en la cinta grande, de color `colorNombre` con letras `letras` ("sobre" es tinta).
 *
 * Las dos cintas se ensanchan solas para que la letra no se achique con las frases largas (Tinkazo en el, COCHABAMBA):
 * la chica nunca baja del cuerpo de Tinkazo en y la grande llega hasta 47 de ancho. `anchoNombre` la fija a mano.
 */
export function postal(D, { nombre, colorNombre, letras = "sobre", de = "Tinkazo en", cielo = C.cielo, paisaje, llama: ll = LLAMA_POSTAL, sombrero, delante, anchoNombre, tamNombre = 11 }) {
  disco(D, DISCO.cx, DISCO.cy, DISCO.r, cielo, { borde: 0.9, sombra: 1.4 });
  if (paisaje) dentro(D, DISCO, () => paisaje(D, DISCO));
  llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
  if (sombrero) sombrero(D, ll);
  if (delante) delante(D);
  const anchoDe = Math.max(35, medir(de, 5.33) + 3.4);
  const a = cinta(D, { lineas: [de], cx: 21 + (anchoDe - 35) / 2, y: 30.6, ancho: anchoDe, fill: "tarjeta", color: "tinta", rot: -3, tamMax: 6 });
  const ancho = anchoNombre ?? Math.min(47, Math.max(40, medir(nombre, 5.6) + 3.4));
  cinta(D, { lineas: [nombre], cx: 25, y: a.y1 + 0.6, ancho, fill: colorNombre, color: letras, rot: -3, tamMax: tamNombre });
}

/**
 * Una franja de paisaje dentro del disco: desde la curva `arriba(x)` hasta el fondo del disco (o hasta `abajo(x)`).
 * Para cerros, lomas, agua y suelo. Va adentro de `paisaje`, así que se recorta sola contra el círculo.
 */
export function franjaDisco(D, { arriba, abajo, color, x0 = DISCO.cx - DISCO.r - 1, x1 = DISCO.cx + DISCO.r + 1, n = 90 }) {
  const top = [], bottom = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    top.push([x, arriba(x)]);
    bottom.push([x, abajo ? abajo(x) : DISCO.cy + DISCO.r + 2]);
  }
  D.L.add([["M", ...top[0]], ...top.slice(1).map((p) => ["L", ...p]), ...bottom.reverse().map((p) => ["L", ...p]), ["Z"]], color);
}

/**
 * Las tiras entre dos curvas, de x0 a x1: un polígono por cada tramo seguido donde `arriba(x)` queda por encima de
 * `abajo(x)`. Para la nieve de un cerro (de la cresta hasta una línea de nieve), que aparece y desaparece a lo largo de
 * la cresta, o para la cara en sombra de una montaña. No deja masa: va adentro de un paisaje.
 */
export function tiras(D, { x0, x1, arriba, abajo, color, paso = 0.2 }) {
  let tramo = [];
  const cerrar = () => {
    if (tramo.length > 1) D.L.add(poli([...tramo.map(([x, a]) => [x, a]), ...tramo.map(([x, , b]) => [x, b]).reverse()]), color);
    tramo = [];
  };
  for (let x = x0; x <= x1 + 1e-9; x += paso) {
    const a = arriba(x), b = abajo(x);
    if (a < b) tramo.push([x, a, b]); else cerrar();
  }
  cerrar();
}

// ───────────────────────── Los sombreros ─────────────────────────
// Todos se ponen sobre la llama `ll` ({ x, y, alto, rot }) de `llama` o de `llamaEn`, que mira a la derecha. La cabeza
// está en la cuadrícula de la llama en x de 14 a 22 e y de 2 a 6, con la oreja en x de 20 a 22 e y de 0 a 3 (k = alto / 26
// unidades por casilla). Si la llama está girada, el sombrero gira con ella alrededor del mismo centro.

/** El sombrero chapaco de ala ancha, el de la llama de Tarija de la colección impresa (las mismas medidas). */
export function sombreroChapaco(D, ll) {
  const { x, y, alto } = ll, k = alto / 26, yh = y + 2 * k;
  girar(D, ll.rot ?? 0, centroLlama(ll), () => {
    const copa = [x + 14.6 * k, yh - 4.6 * k, 7.2 * k, 3.9 * k], ala = [x + 8.6 * k, yh - 1.3 * k, 18.8 * k, 1.8 * k];
    caja(D.L, { x: copa[0], y: copa[1], w: copa[2], h: copa[3], fill: C.paja, borde: 0.8, sombra: 1, radio: 1.4 * k });
    D.L.add(rect(copa[0] + 0.8, copa[1] + copa[3] - 1.25 * k, copa[2] - 1.6, 1 * k), C.rojoBo);
    caja(D.L, { x: ala[0], y: ala[1], w: ala[2], h: ala[3], fill: C.paja, borde: 0.8, sombra: 1.1, radio: ala[3] / 2 });
    D.L.add(rect(ala[0] + 1.4 * k, ala[1] + ala[3] - 0.85, ala[2] - 2.8 * k, 0.35 * k), C.pajaOsc);
    D.r(copa[0], copa[1], copa[2] + 1, copa[3] + 1);
    D.r(ala[0], ala[1], ala[2] + 1.1, ala[3] + 1.1);
  });
}

/**
 * El chullo paceño (lluch'u) de lana: turquesa con una franja amarilla, una fila de puntos morados y el borde naranja,
 * la punta caída hacia atrás con su pompón, y la orejera de la nuca con la trencita y la borla colgando al lado del
 * cuello. Una casilla del sprite es una casilla de la llama.
 */
export const CHULLO = [
  ".nn......",
  "nnnn.....",
  ".nntttt..",
  "..ttttttt",
  "aaaaaaaaa",
  "tvttvttvt",
  "nnnnnnnnn",
  "tt.......",
  "tt.......",
  "a........",
  "a........",
  "nn.......",
  "nn.......",
];
/** La fila del borde del chullo (la que cae sobre la frente). */
const BORDE_CHULLO = 6;
export function chullo(D, ll, { sprite = CHULLO } = {}) {
  const { x, y, alto } = ll, k = alto / 26;
  girar(D, ll.rot ?? 0, centroLlama(ll), () => {
    // El borde apenas tapa la frente (y = 1,4 en la cuadrícula de la llama) y la orejera cae por la nuca, al lado del
    // cuello: la cabeza y el cuello se siguen viendo enteros. Sombra corta, para no mancharle la cara de tinta.
    pixeles(D, sprite, { x: x + 13.4 * k, y: y + (1.4 - BORDE_CHULLO) * k, p: k, borde: 0.6, sombra: 0.6 });
  });
}

/**
 * La montera del Tinku, textil: un casco de copa redonda y ala corta levantada en las puntas, en blanco crema, con una
 * faja de colores, una cresta de pompones de lana arriba y cintas que vuelan hacia atrás con el salto. Sin cuero ni
 * plumas. `escala` la agranda desde la frente (1 es del ancho de la cabeza).
 */
export function montera(D, ll, { cintas = true, escala = 1 } = {}) {
  const { x, y, alto } = ll, k = alto / 26;
  // La cuadrícula de la llama, agrandada desde la frente (18,2; 2).
  const u = (a) => x + (18.2 + (a - 18.2) * escala) * k, v = (b) => y + (2 + (b - 2) * escala) * k, ke = k * escala;
  // La copa se apoya en el ala a la altura `base`, sobre la frente.
  const cx = 18.2, base = -0.3, rx = 4.8, ry = 4.3;
  girar(D, ll.rot ?? 0, centroLlama(ll), () => {
    // Las cintas, detrás de todo: salen de la nuca y ondulan hacia atrás.
    if (cintas) {
      ["magenta", "amarillo", "turquesa"].forEach((col, i) => {
        const pts = [];
        for (let t = 0; t <= 1.0001; t += 0.05) pts.push([u(14.2 - t * (9.6 + i * 1.5)), v(-1.6 + i * 1.25 + t * (1.6 + i * 0.9) + Math.sin(t * Math.PI * 2 + i * 0.8) * 0.85)]);
        const izq = [], der = [];
        pts.forEach((p, j) => {
          const q = pts[Math.min(j + 1, pts.length - 1)], o = pts[Math.max(j - 1, 0)];
          const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1;
          const w = 1.25 * ke * (1 - j / pts.length * 0.3) / 2;
          izq.push([p[0] - dy / L * w, p[1] + dx / L * w]); der.push([p[0] + dy / L * w, p[1] - dx / L * w]);
        });
        forma(D, [...izq, ...der.reverse()], col, { borde: 0.55, sombra: 0.5 });
      });
    }
    // La cresta de pompones de lana, en fila sobre la copa: asoman por encima, la copa se sigue viendo entera.
    [[-3.4, "turquesa"], [-1.7, "amarillo"], [0, "magenta"], [1.7, "naranja"], [3.4, "morado"]].forEach(([dx, col]) => {
      const alto = ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2));
      disco(D, u(cx + dx), v(base - alto - 0.55), 1.2 * ke, col, { borde: 0.55, sombra: 0.4 });
    });
    // La copa: media cúpula.
    const copa = [];
    for (let i = 0; i <= 28; i++) { const a = Math.PI + Math.PI * i / 28; copa.push([u(cx + Math.cos(a) * rx), v(base + Math.sin(a) * ry)]); }
    forma(D, copa, C.montera, { borde: 0.7, sombra: 0.5 });
    // La faja tejida de la copa: bloques de los colores de la marca sobre tinta.
    const f0 = base - 2.3, f1 = base - 1.05, ancho = (b) => rx * Math.sqrt(1 - ((base - b) / ry) ** 2);
    const xa = cx - ancho(f0), xb = cx + ancho(f0);
    D.L.add(rect(u(xa), v(f0), (xb - xa) * ke, (f1 - f0) * ke), "tinta");
    const cols = ["magenta", "naranja", "amarillo", "turquesa"], m = 8, paso = (xb - xa) / m;
    for (let i = 0; i < m; i++) D.L.add(rect(u(xa + i * paso + 0.14), v(f0 + 0.2), (paso - 0.28) * ke, (f1 - f0 - 0.4) * ke), cols[i % 4]);
    // El ala, delante de la copa: corta y levantada en las dos puntas, como la de un casco antiguo.
    const ala = [], n = 24;
    for (let i = 0; i <= n; i++) { const t = i / n; ala.push([u(10.9 + 14.6 * t), v(base - 0.9 - 0.2 * t + 0.95 * Math.sin(Math.PI * t))]); }
    for (let i = n; i >= 0; i--) { const t = i / n; ala.push([u(10.9 + 14.6 * t), v(base - 0.9 - 0.2 * t + 2.1 * Math.sin(Math.PI * t))]); }
    forma(D, ala, C.montera, { borde: 0.65, sombra: 0.3 });
  });
}
