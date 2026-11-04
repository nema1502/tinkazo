import { posturaObstaculo } from "./llama-obstaculos";
import { Container, Graphics } from "pixi.js";
import type { Estadio } from "../pixi/kit/anfitrion";
import { CREAM, INK, YELLOW } from "../pixi/stage";
import { oscurecer, type Llama, type Momento } from "./llama";

/**
 * La llama de la carrera con aura (`?carrera=nueva`): la B del diseño, "hecha de tejido".
 *
 * Bordes en escalón, como una tela tejida, y la manta con rombos de aguayo que ninguna otra carrera tiene. La cara lleva un ojo grande con
 * brillo y una sonrisa, para que no quede fría. Mide lo mismo que la de siempre (`LLAMA_ALTO`, `LLAMA_LARGO`): se dibuja en unidades de boceto
 * (172 de alto) y se escala a 0,535 adentro, así que las cajas, los nombres y la cámara no cambian.
 *
 * Tiene las mismas poses que la de siempre (la escena le habla igual): correr, plantarse con el "!", tropezar, escupir, ser escupida con el
 * "?!", echarse (patas plegadas, gris, polvo, "zZ") y festejar. Todo es función de la fase del paso y del momento: sin azar ni reloj propio.
 * Las partes que se mueven son contenedores con una sola figura dibujada una vez; en cada cuadro solo cambian ángulos.
 */

/** De unidades de boceto a unidades de la llama de siempre. */
const E = 0.535;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const mezcla = (a: number, b: number, k: number): number => {
  const ch = (s: number): number => Math.round(lerp((a >> s) & 255, (b >> s) & 255, k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** Un polígono con su sombra de tinta corrida, como el tejido sobre una tela oscura. */
function forma(g: Graphics, pts: readonly number[], fill: number, sombra = true): void {
  if (sombra) g.poly(pts.map((v) => v + 3.5)).fill(INK);
  g.poly([...pts]).fill(fill);
}

/** Una franja del aguayo: un fondo y, encima, rombos o zigzag. */
function franja(g: Graphics, x0: number, x1: number, y: number, h: number, fondo: number, dibujo: number, tipo: "rombo" | "zig" | "liso"): void {
  g.rect(x0, y, x1 - x0, h).fill(fondo);
  if (tipo === "liso") return;
  for (let x = x0; x < x1 - 1; x += h) {
    if (tipo === "rombo") g.poly([x + h / 2, y + 1, x + h - 1, y + h / 2, x + h / 2, y + h - 1, x + 1, y + h / 2]).fill(dibujo);
    else g.poly([x, y + h, x + h / 2, y + 1, x + h, y + h]).fill(dibujo);
  }
}

export function crearLlamaAguayo(S: Estadio, o: { pelaje: number; manta: number }): Llama {
  const fur = o.pelaje;
  const oscuro = oscurecer(fur, 0.74);
  const root = new Container();
  root.addChild(new Graphics().ellipse(0, 0, 25, 5).fill({ color: 0x000000, alpha: 0.28 }));
  const body = new Container();
  root.addChild(body);
  const polvo = new Graphics();
  root.addChild(polvo);
  const zz = new Graphics();
  zz.position.set(62, -66);
  root.addChild(zz);

  // Todo el dibujo vive en unidades de boceto, dentro de `rig`, que lo escala y lo corre un poco hacia adelante para que la cola y el hocico
  // caigan donde caían los de la llama de siempre.
  const rig = new Container();
  rig.scale.set(E);
  rig.position.set(4, 0);
  body.addChild(rig);

  /* ------------------------------------------------------------------- las patas */
  const L1 = 25;
  const L2 = 25;
  const pata = (x: number, lejos: boolean): { hip: Container; knee: Container } => {
    const col = lejos ? oscuro : fur;
    const hip = new Container();
    hip.position.set(x, -50);
    const knee = new Container();
    knee.position.set(0, L1);
    const w = 5.5;
    // El muslo y la canilla son trapecios con la sombra corrida; la pezuña, un bloque de tinta.
    const muslo = new Graphics();
    forma(muslo, [-w, 0, w, 0, w - 1, L1 + 1, -w + 1, L1 + 1], col);
    const canilla = new Graphics();
    forma(canilla, [-w + 1, 0, w - 1, 0, 4, L2, -4, L2], col);
    canilla.rect(-5, L2 - 7, 12, 7).fill(INK);
    knee.addChild(canilla);
    hip.addChild(muslo, knee);
    return { hip, knee };
  };
  const patas = [pata(-26, true), pata(26, true), pata(-32, false), pata(20, false)];
  rig.addChild(patas[0]!.hip, patas[1]!.hip);

  /* ------------------------------------------------------------ cola, cuerpo y manta */
  const cola = new Container();
  cola.position.set(-48, -82);
  const colaG = new Graphics();
  forma(colaG, [0, -6, -14, -6, -14, 16, -6, 16, -6, 6, 0, 6], fur);
  forma(colaG, [-14, 10, -20, 10, -20, 24, -10, 24, -10, 16, -14, 16], fur, false);
  cola.addChild(colaG);
  rig.addChild(cola);

  const torso = new Container();
  const torsoG = new Graphics();
  forma(torsoG, [-48, -88, 40, -88, 40, -80, 48, -80, 48, -56, 40, -56, 40, -48, -40, -48, -40, -56, -48, -56], fur);
  torso.addChild(torsoG);
  rig.addChild(torso);
  // La manta de aguayo: cinco franjas con rombos y zigzags, del color de cada persona. Encima del cuerpo, atrás del cuello.
  const manta = new Graphics();
  const col2 = oscurecer(o.manta, 0.62);
  franja(manta, -34, 30, -88, 8, col2, YELLOW, "zig");
  franja(manta, -34, 30, -80, 12, o.manta, 0xfff4dc, "rombo");
  franja(manta, -34, 30, -68, 6, 0x2f9e44, 0x2f9e44, "liso");
  franja(manta, -34, 30, -62, 10, YELLOW, o.manta, "rombo");
  franja(manta, -34, 30, -52, 6, col2, 0xfff4dc, "zig");
  rig.addChild(manta);
  rig.addChild(patas[2]!.hip, patas[3]!.hip);

  // Las patas de cerca de quien se echa: tres almohadillas, cuando las patas se pliegan del todo.
  const almohadillas = new Graphics();
  for (const x of [-28, 2, 28]) almohadillas.rect(x - 15, -12, 30, 10).fill(oscuro);
  almohadillas.alpha = 0;
  rig.addChild(almohadillas);

  /* ------------------------------------------------------------ cuello y cabeza */
  const cuello = new Container();
  cuello.position.set(37, -88);
  const cuelloG = new Graphics();
  // Coordenadas relativas al arranque del cuello (37, -88).
  const R = (pts: readonly number[]): number[] => pts.map((v, i) => (i % 2 === 0 ? v - 37 : v + 88));
  // El cuello es 14 unidades más corto que en el boceto y la cabeza baja con él: con menos cuello se parece menos a un caballo.
  const H = (pts: readonly number[]): number[] => R(pts).map((v, i) => (i % 2 === 1 ? v + 14 : v));
  forma(cuelloG, R([28, -88, 28, -114, 46, -114, 46, -88]), fur);
  for (let i = 0; i < 3; i++) forma(cuelloG, R([46, -110 + i * 9, 52, -105 + i * 9, 46, -100 + i * 9]), fur, false);
  forma(cuelloG, H([24, -128, 24, -144, 56, -144, 56, -136, 72, -136, 72, -120, 32, -120, 32, -128]), fur);
  cuelloG.poly(H([58, -130, 72, -130, 72, -120, 58, -120])).fill(oscuro);
  // El mechón de lana de la frente, en escalones, y la mejilla: lo que le da cara de llama.
  forma(cuelloG, H([26, -144, 26, -152, 34, -152, 34, -156, 46, -156, 46, -148, 54, -148, 54, -144]), fur);
  const orejaI = new Container();
  orejaI.position.set(30 - 37, -152 + 102);
  orejaI.addChild(new Graphics().poly([-5, 0, -4, -14, 0, -18, 4, -14, 5, 0]).fill(fur));
  const orejaD = new Container();
  orejaD.position.set(42 - 37, -152 + 102);
  orejaD.addChild(new Graphics().poly([-5, 0, -4, -15, 0, -19, 4, -15, 5, 0]).fill(oscuro));
  // El ojo, redondo y grande, con un brillo; cerrado, una raya. La sonrisa son dos bloques de tinta.
  const ojoAbierto = new Graphics();
  ojoAbierto.circle(...(H([47, -132]) as [number, number]), 8).fill(0xffffff);
  ojoAbierto.circle(...(H([49, -132]) as [number, number]), 4.8).fill(INK);
  ojoAbierto.circle(...(H([51, -134.5]) as [number, number]), 1.9).fill(0xffffff);
  const ojoCerrado = new Graphics();
  ojoCerrado.rect(...(H([41, -132]) as [number, number]), 12, 3).fill(INK);
  ojoCerrado.visible = false;
  const sonrisa = new Graphics();
  sonrisa.rect(...(H([60, -124]) as [number, number]), 6, 2).fill(INK).rect(...(H([66, -126]) as [number, number]), 2, 2).fill(INK);
  cuello.addChild(orejaD, cuelloG, orejaI, ojoAbierto, ojoCerrado, sonrisa);
  rig.addChild(cuello);

  const marca = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
  marca.anchor.set(0.5, 1);
  marca.position.set(20, -90);
  marca.visible = false;
  root.addChild(marca);

  return {
    root,
    marca,
    zz,
    pose(ph: number, speed: number, m: Momento): void {
      let lean = speed > 1.25 ? 0.07 : 0;
      let plegada = 0;
      // El paso: el muslo va y viene; la rodilla se dobla cuando la pata viene hacia adelante y se estira al apoyar.
      const fases = [ph, ph + 0.9, ph + Math.PI, ph + Math.PI + 0.9];
      let ang = fases.map((f) => Math.sin(f) * 0.62);
      let cuelloRot = Math.sin(ph * 2) * 0.05;
      marca.visible = false;
      polvo.clear();
      zz.clear();
      if (m?.kind === "plantada") {
        ang = [0.25, -0.35, 0.25, -0.35];
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
      } else if (posturaObstaculo(m)) {
        const o = posturaObstaculo(m);
        if (o?.patas) ang = o.patas;
        lean = o?.lean ?? lean;
        cuelloRot = o?.cuelloRot ?? cuelloRot;
        if (o?.aviso) {
          marca.visible = true;
          marca.text = o.aviso;
        }
      } else if (m?.kind === "echada") {
        // Se echa: baja el cuerpo, pliega las patas, se pone gris y levanta polvo. Queda así, con los ojos cerrados y las "zZ".
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
      const rigida = m?.kind === "plantada" || posturaObstaculo(m)?.rigida === true || speed < 0.1;
      patas.forEach((l, i) => {
        // La pierna va hacia adelante con ángulo positivo del boceto; en pantalla (y hacia abajo) es una rotación negativa.
        const a = ang[i] ?? 0;
        const flexion = rigida ? 0 : Math.max(0, Math.cos(fases[i] ?? 0)) * (i % 2 === 0 ? 1.0 : 0.8);
        l.hip.rotation = plegada ? lerp(-a, i % 2 ? -1.25 : 1.25, plegada) : -a;
        l.knee.rotation = plegada ? plegada * (i % 2 ? -1.9 : 1.9) : flexion;
        l.hip.scale.y = 1 - 0.3 * plegada;
        l.hip.visible = plegada < 0.6;
      });
      almohadillas.alpha = plegada < 0.6 ? 0 : (plegada - 0.6) / 0.4;
      rig.rotation = lean;
      // El cuerpo rebota al correr; echada, baja (26 unidades de boceto).
      body.y = plegada ? 14 * plegada : speed > 0.1 ? -Math.abs(Math.sin(ph)) * 4 : 0;
      cuello.rotation = cuelloRot;
      cuello.x = 37 - 4 * plegada;
      cuello.y = -88 + 12 * plegada;
      ojoAbierto.visible = plegada < 0.5;
      ojoCerrado.visible = plegada >= 0.5;
      sonrisa.visible = plegada < 0.5;
      body.tint = mezcla(0xffffff, 0x9d9aa8, plegada);
      orejaI.rotation = Math.sin(ph * 2 + 1) * 0.25;
      orejaD.rotation = Math.sin(ph * 2 + 2) * 0.25;
      cola.rotation = Math.sin(ph * 2) * 0.4;
    },
  };
}
