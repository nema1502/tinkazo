import { Container, Graphics } from "pixi.js";
import { CREAM, INK, type Estadio } from "./anfitrion";
import { MARCADOR, disposicionDeMarcas, medidasMarcador, reservaDeMarcas, textoMarcador } from "./marcador";

/**
 * Dibuja el marcador (`marcador.ts`): una caja de tinta con el número en letra
 * monoespaciada, arriba a la izquierda, igual en todos los juegos. Solo dibuja:
 * `crearJuego` le pasa el número de cada cuadro.
 */
export interface MarcadorVista {
  /** Pone el número. Si no cambió, no hace nada. */
  pintar(n: number): void;
  /** Vuelve a medir y a poner todo, para otro tamaño de pantalla. */
  rearmar(): void;
  /** Lo esconde o lo muestra (el cartel de quien gana, en el celular, cae encima). */
  ocultar(si: boolean): void;
}

const MONO = "ui-monospace, Consolas, monospace";

/** Lo último que se dibujó en cada fila de marcas, para no repintar un cuadro igual al anterior. */
const ultimaFila = new WeakMap<Graphics, string>();
const ENCENDIDA = 0xffc629;
const APAGADA = 0x7a6d96;

/**
 * La fila de marcas de quedar de pie: una por persona, debajo del contador. Las que siguen, doradas y
 * llenas; las que salieron, vacías y apagadas. Va en una placa de tinta como la del contador, así se
 * ve igual de día y de noche. Devuelve cuánto ocupa de alto (con el aire de arriba) para que los
 * nombres no la pisen; 0 si no se dibuja (menos de dos personas o demasiadas).
 *
 * `g` es de quien la llama: se limpia y se vuelve a dibujar solo cuando cambia algo. `y` es donde
 * empieza la placa, en las coordenadas del contenedor del contador (debajo de su caja).
 */
export function pintarMarcas(g: Graphics, o: { total: number; quedan: number; k: number; w: number; y?: number; anchoMax?: number }): number {
  const disp = disposicionDeMarcas(o.total, o.k, o.w, o.anchoMax);
  const k = Math.max(0.01, o.k);
  if (!disp) {
    if (ultimaFila.get(g) !== "") g.clear();
    ultimaFila.set(g, "");
    g.visible = false;
    return 0;
  }
  const y = o.y ?? medidasMarcador(k).alto + 8 * k;
  const quedan = Math.max(0, Math.min(o.total, Math.round(o.quedan)));
  const clave = `${o.total}|${quedan}|${k}|${o.w}|${y}|${o.anchoMax ?? 0}`;
  g.visible = true;
  if (ultimaFila.get(g) !== clave) {
    ultimaFila.set(g, clave);
    const { ancho, alto, d, paso, pad, cols } = disp;
    g.clear().rect(5 * k, y + 5 * k, ancho, alto).fill(INK).rect(0, y, ancho, alto).fill(0x221a33).stroke({ width: 3 * k, color: INK });
    for (let i = 0; i < o.total; i++) {
      const cx = pad + paso / 2 + (i % cols) * paso;
      const cy = y + pad + paso / 2 + Math.floor(i / cols) * paso;
      if (i < quedan) g.circle(cx, cy, d / 2).fill(ENCENDIDA).stroke({ width: Math.max(1, d * 0.08), color: 0xfff1b8 });
      else g.circle(cx, cy, d / 2 - 1).stroke({ width: Math.max(1.5, d * 0.1), color: APAGADA, alpha: 0.7 });
    }
  }
  return reservaDeMarcas(o.total, o.k, o.w, o.anchoMax).alto;
}

/** El total que acompaña al número («5 DE 18»), para los juegos de quedar de pie: la palabra va en cada idioma. */
export interface TotalDelMarcador {
  de: () => string;
  cuantos: number;
}

export function crearMarcadorVista(S: Estadio, rotulo: () => string, total?: TotalDelMarcador): MarcadorVista {
  const caja = new Graphics();
  const texto = S.text("", { fontFamily: MONO, fontSize: MARCADOR.fuente, fontWeight: "700", fill: CREAM });
  texto.anchor.set(0.5);
  const marcas = new Graphics();
  const raiz = new Container();
  raiz.addChild(caja, texto, marcas);
  S.hud.addChild(raiz);
  let ultimo = "";
  let quedan = 0;

  const poner = (): void => {
    // Los juegos vacían `hud` al cambiar de tamaño: el marcador vuelve solo.
    if (raiz.parent !== S.hud) S.hud.addChild(raiz);
    const k = S.u();
    const m = medidasMarcador(k);
    texto.style.fontSize = m.fuente;
    texto.text = ultimo;
    const bw = texto.width + m.aire;
    texto.position.set(bw / 2, m.alto / 2);
    caja.clear().rect(5 * k, 5 * k, bw, m.alto).fill(INK).rect(0, 0, bw, m.alto).fill(0x221a33).stroke({ width: 3 * k, color: INK });
    raiz.position.set(MARCADOR.x * k, S.top() + MARCADOR.y * k);
    if (total) pintarMarcas(marcas, { total: total.cuantos, quedan, k, w: S.sw() });
  };

  return {
    pintar(n) {
      const s = textoMarcador(rotulo(), n, total ? { de: total.de(), cuantos: total.cuantos } : undefined);
      if (s === ultimo) return;
      ultimo = s;
      quedan = n;
      poner();
    },
    rearmar: poner,
    ocultar(si) {
      raiz.visible = !si;
    },
  };
}
