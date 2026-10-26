import { Container, Graphics } from "pixi.js";
import { CREAM, INK, type Estadio } from "./anfitrion";
import { MARCADOR, medidasMarcador } from "./marcador";

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
}

const MONO = "ui-monospace, Consolas, monospace";

export function crearMarcadorVista(S: Estadio, rotulo: () => string): MarcadorVista {
  const caja = new Graphics();
  const texto = S.text("", { fontFamily: MONO, fontSize: MARCADOR.fuente, fontWeight: "700", fill: CREAM });
  texto.anchor.set(0.5);
  const raiz = new Container();
  raiz.addChild(caja, texto);
  S.hud.addChild(raiz);
  let ultimo = "";

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
  };

  return {
    pintar(n) {
      const s = `${rotulo()}  ${n}`;
      if (s === ultimo) return;
      ultimo = s;
      poner();
    },
    rearmar: poner,
  };
}
