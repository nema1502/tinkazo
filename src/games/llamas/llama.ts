import { Container, Graphics, type Text } from "pixi.js";
import type { Estadio } from "../pixi/kit/anfitrion";
import { CREAM, INK, YELLOW } from "../pixi/stage";
import { BORLA_RADIO } from "./carrera-forma";

export { BORLA_RADIO, LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO, LLAMA_LARGO } from "./carrera-forma";

/**
 * La llama de la carrera, dibujada por partes, mirando a la derecha y con los
 * pies en y = 0. Es la de siempre (la rodilla se dobla al ir hacia adelante, la
 * cola y las orejas siguen el paso); lo nuevo es lo que pide la regla del niño:
 *
 * - **echarse se ve en el cuerpo**: las patas se pliegan, el cuerpo baja, se
 *   pone gris y levanta polvo, todo en medio segundo;
 * - **la borla del líder**: un objeto amarillo que pasa de una a otra
 *   (`crearBorla`), la única marca de quien va adelante.
 *
 * Sin azar y sin reloj propio: la pose es una función de la fase del paso.
 */

/** Colores de lana de llama: blanca, café, crema, oscura, gris. */
export const PELAJES = [0xf3ead8, 0xa0683a, 0xe4c99a, 0x5b3a29, 0xc2bab0, 0x8a5a3c, 0xefe3cc, 0x6e4a36] as const;

export type Momento = { kind: string; p: number } | null;

export interface Llama {
  root: Container;
  /** El "!" de los sustos: arriba de la cabeza. */
  marca: Text;
  /** Las "zZ" de quien descansa: la escena las agranda para que se vean desde el fondo. */
  zz: Graphics;
  /** Pone la postura. `ph` es la fase del paso; `speed` 1 es ir al ritmo del grupo. */
  pose(ph: number, speed: number, momento: Momento): void;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export const oscurecer = (c: number, f: number): number => {
  const r = ((c >> 16) & 255) * f, g = ((c >> 8) & 255) * f, b = (c & 255) * f;
  return (Math.round(Math.min(255, r)) << 16) | (Math.round(Math.min(255, g)) << 8) | Math.round(Math.min(255, b));
};

const mezcla = (a: number, b: number, k: number): number => {
  const ch = (s: number): number => Math.round(lerp((a >> s) & 255, (b >> s) & 255, k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

export function crearLlama(S: Estadio, o: { pelaje: number; manta: number }): Llama {
  const fur = o.pelaje;
  const root = new Container();
  root.addChild(new Graphics().ellipse(0, 0, 24, 5).fill({ color: 0x000000, alpha: 0.28 }));
  const body = new Container();
  root.addChild(body);
  const polvo = new Graphics();
  root.addChild(polvo);
  // Las "zZ" de quien descansa: la echada queda echada, y se nota que está tranquila.
  const zz = new Graphics();
  zz.position.set(40, -98);
  root.addChild(zz);
  // Una pata en dos partes, con la rodilla en el medio: se dobla al ir hacia adelante y se estira al apoyar.
  const pata = (x: number, lejos: boolean): { hip: Container; knee: Container } => {
    const col = lejos ? oscurecer(fur, 0.72) : fur;
    const hip = new Container();
    hip.position.set(x, -30);
    const knee = new Container();
    knee.position.set(0, 15);
    knee.addChild(new Graphics()
      .roundRect(-2.8, -1, 5.6, 16, 2.5).fill(col).stroke({ width: 2, color: INK })
      .roundRect(-3.5, 12, 7, 5, 2).fill(INK));
    hip.addChild(knee, new Graphics().roundRect(-3.3, 0, 6.6, 17, 3.2).fill(col).stroke({ width: 2, color: INK }));
    return { hip, knee };
  };
  const patas = [pata(-12, true), pata(15, true), pata(-16, false), pata(11, false)];
  body.addChild(patas[0]!.hip, patas[1]!.hip);
  const cola = new Graphics().ellipse(-3, -2, 6, 5).fill(fur).stroke({ width: 2, color: INK });
  cola.position.set(-24, -40);
  body.addChild(cola);
  const torso = new Graphics();
  for (let i = 0; i < 6; i++) torso.circle(-17 + i * 7, -44 + Math.sin(i * 1.7) * 1.5, 5.5).fill(fur);
  torso.ellipse(0, -36, 24, 13).fill(fur).stroke({ width: 2.2, color: INK });
  body.addChild(torso);
  body.addChild(new Graphics()
    .roundRect(-15, -48, 30, 17, 4).fill(o.manta).stroke({ width: 2, color: INK })
    .rect(-15, -43, 30, 2.4).fill(YELLOW)
    .rect(-15, -38.5, 30, 2.4).fill(0x2f9e44));
  body.addChild(patas[2]!.hip, patas[3]!.hip);
  const cuello = new Container();
  cuello.position.set(16, -42);
  const cuelloG = new Graphics()
    .roundRect(-5, -34, 11, 38, 5).fill(fur).stroke({ width: 2.2, color: INK })
    .ellipse(6, -38, 11, 8).fill(fur).stroke({ width: 2.2, color: INK })
    .ellipse(14, -36, 5.5, 4.5).fill(oscurecer(fur, 0.8)).stroke({ width: 1.6, color: INK })
    .circle(6, -40, 1.8).fill(INK);
  const orejaI = new Graphics().poly([-3, 0, 0, -11, 3, 0]).fill(fur).stroke({ width: 1.8, color: INK });
  orejaI.position.set(1, -44);
  const orejaD = new Graphics().poly([-3, 0, 0, -12, 3, 0]).fill(oscurecer(fur, 0.85)).stroke({ width: 1.8, color: INK });
  orejaD.position.set(6, -45);
  cuello.addChild(orejaD, cuelloG, orejaI);
  body.addChild(cuello);
  const marca = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
  marca.anchor.set(0.5, 1);
  marca.position.set(20, -98);
  marca.visible = false;
  root.addChild(marca);

  return {
    root,
    marca,
    zz,
    pose(ph, speed, m) {
      const sw = 0.55;
      let lean = speed > 1.25 ? 0.07 : 0;
      let plegada = 0;
      let legA = [Math.sin(ph) * sw, Math.sin(ph + 0.9) * sw, Math.sin(ph + Math.PI) * sw, Math.sin(ph + Math.PI + 0.9) * sw];
      let cuelloRot = Math.sin(ph * 2) * 0.05;
      marca.visible = false;
      polvo.clear();
      zz.clear();
      if (m?.kind === "plantada") {
        legA = [0.25, -0.35, 0.25, -0.35];
        lean = -0.1;
        cuelloRot = -0.25;
        marca.visible = true;
        marca.text = "!";
      } else if (m?.kind === "tropiezo") lean = 0.35 * Math.sin(Math.PI * Math.min(1, m.p * 1.4));
      else if (m?.kind === "escupida") cuelloRot = -0.35 * Math.sin(Math.PI * m.p);
      else if (m?.kind === "escupido") {
        lean = -0.12 * Math.sin(Math.PI * m.p * 3);
        marca.visible = true;
        marca.text = "?!";
      } else if (m?.kind === "echada") {
        // Se echa: baja el cuerpo, pliega las patas, se pone gris y levanta polvo. Queda así.
        plegada = Math.min(1, m.p);
        cuelloRot = -0.1;
        if (m.p >= 1) {
          const flota = (Math.sin(ph * 0.35) + 1) / 2;
          for (const [x, y, e] of [[-8, 8 - 6 * flota, 1], [8, -10 - 8 * flota, 1.45]] as const) {
            zz.moveTo(x - 5 * e, y - 5 * e).lineTo(x + 5 * e, y - 5 * e).lineTo(x - 5 * e, y + 5 * e).lineTo(x + 5 * e, y + 5 * e).stroke({ width: 5 * e, color: INK, join: "round", cap: "round" });
            zz.moveTo(x - 5 * e, y - 5 * e).lineTo(x + 5 * e, y - 5 * e).lineTo(x - 5 * e, y + 5 * e).lineTo(x + 5 * e, y + 5 * e).stroke({ width: 2.4 * e, color: CREAM, join: "round", cap: "round" });
          }
        }
        if (m.p < 1) {
          const a = 0.5 * (1 - m.p);
          for (let i = 0; i < 5; i++) polvo.circle(-26 + i * 14, -3 - m.p * 10 * (i % 2 + 1), 5 + m.p * 9 + i).fill({ color: 0xd9cdb4, alpha: a });
        }
      }
      const fases = [ph, ph + 0.9, ph + Math.PI, ph + Math.PI + 0.9];
      const rigida = m?.kind === "plantada" || speed < 0.1;
      patas.forEach((l, i) => {
        l.hip.rotation = plegada ? lerp(legA[i] ?? 0, i % 2 ? 1.25 : -1.25, plegada) : (legA[i] ?? 0);
        l.knee.rotation = plegada ? plegada * (i % 2 ? -1.9 : 1.9) : rigida ? 0 : Math.max(0, -Math.cos(fases[i] ?? 0)) * (i % 2 === 0 ? 1.05 : 0.8);
        l.hip.scale.y = 1 - 0.3 * plegada;
      });
      body.rotation = lean;
      body.y = plegada ? 15 * plegada : speed > 0.1 ? -Math.abs(Math.sin(ph)) * 4 : 0;
      body.tint = mezcla(0xffffff, 0x9d9aa8, plegada);
      cuello.rotation = cuelloRot;
      orejaI.rotation = Math.sin(ph * 2 + 1) * 0.25;
      orejaD.rotation = Math.sin(ph * 2 + 2) * 0.25;
      cola.rotation = Math.sin(ph * 2) * 0.4;
    },
  };
}

/**
 * La borla del líder: una bola amarilla con flecos sobre un palito, grande para
 * que se vea desde el fondo. Pasa de una llama a otra; el que la lleva es el de
 * más a la derecha. Mide `BORLA_RADIO` unidades del dibujo y se apoya en el
 * origen (el palito baja hacia y positivo).
 */
export function crearBorla(): Container {
  const c = new Container();
  const halo = new Graphics().circle(0, -2, BORLA_RADIO * 1.9).fill({ color: YELLOW, alpha: 0.28 });
  const g = new Graphics();
  g.roundRect(-1.8, -2, 3.6, 22, 1.8).fill(INK);
  for (let i = -2; i <= 2; i++) g.roundRect(i * 5 - 1.6, 4, 3.2, 17 - Math.abs(i) * 2.5, 1.6).fill(YELLOW).stroke({ width: 1.6, color: INK });
  g.circle(0, -2, BORLA_RADIO).fill(YELLOW).stroke({ width: 3, color: INK });
  g.circle(-4.5, -7, 4.2).fill({ color: CREAM, alpha: 0.85 });
  c.addChild(halo, g);
  return c;
}
