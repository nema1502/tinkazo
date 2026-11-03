import { Container, Graphics } from "pixi.js";
import { musicHold } from "../../music";
import { anchoMarcador, crearJuego, hashDe, medidasMarcador, reservaDeMarcas, textoMarcador, type Kit } from "./kit";
import { MARCADOR } from "./kit/marcador";
import {
  T_AMANECER, Z_META, Z_ULTIMOS, cajaDelPalo, cajaDeCuerpo, enPieEn, faseDe, geoDe, miradaDe, planGuajojo, proyectar, sentadaDe, swayDe, tandaDeLista, xDe, zDe,
  type Ciclo, type Datos, type Geo,
} from "./guajojo-plan";
import { TEXTOS } from "./guajojo-textos";

/**
 * Guajojó: la escena.
 *
 * Un sendero del monte de noche, visto desde atrás del grupo. Al fondo, el palo
 * seco donde está el guajojó: de día es la punta de un palo, de noche abre dos
 * ojos amarillos. Mientras canta se camina; cuando calla, quietos, y la mirada
 * barre el sendero. Al que no le alcanza el freno pisa una ramita y se sienta en
 * la hinchada. Gana quien llega de pie al amanecer.
 *
 * Todo lo que no es dibujo lo hace el kit (`./kit`): el montaje, la cámara con
 * sus cinco arcos, el foco de quien gana, los subtítulos con cola, el contador
 * (el único, arriba a la izquierda) y el cierre. Y todo lo que decide qué pasa y
 * cuándo lo hace el plan (`guajojo-plan.ts`); acá solo se dibuja como función del
 * segundo `t`: la misma ronda dibuja los mismos cuadros, y saltar da lo mismo que
 * mirar. La leyenda del guajojó no se cuenta acá: va en la tarjeta de después.
 *
 * El ave es un palo seco que abre los ojos, como es de verdad: sin alas ni pico de
 * caricatura. La noche es de medios tonos para que no se queme en un proyector;
 * solo brillan los ojos y los farolitos.
 */

const INK = 0x1a1330;
const TINTA_NOCHE = 0x0a0d24;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Cuánto dura a la vista el nombre de quien se acaba de sentar (con el fundido al final). */
const T_NOMBRE = 1.8;
const c01 = (v: number): number => Math.max(0, Math.min(1, v));
const suave = (v: number): number => {
  const x = c01(v);
  return x * x * (3 - 2 * x);
};
/** Mezcla dos colores, canal por canal. */
function mezcla(a: number, b: number, k: number): number {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, k);
  const g = lerp((a >> 8) & 255, (b >> 8) & 255, k);
  const bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

interface Persona {
  raiz: Container;
  piernaI: Container;
  piernaD: Container;
  brazoI: Container;
  brazoD: Container;
  torso: Container;
  cuerpo: Graphics;
  farol: Graphics;
  luz: Graphics;
  sombra: Graphics;
}

interface Escena {
  raiz: Container;
  /** Cielo, cerros, árboles, sendero: lo que no se mueve, con un tinte que se oscurece al callar. */
  fijo: Container;
  cielo: Graphics;
  sol: Graphics;
  palo: Graphics;
  ojos: Graphics;
  haz: Graphics;
  gente: Container;
  bichos: Graphics;
  ramitas: Graphics;
  personas: Persona[];
  /** Los nombres de los que acaban de sentarse, grandes y pegados a donde pasó. */
  chips: Map<number, Container>;
  capaChips: Container;
  tCorona: number | null;
  /** Qué ciclos ya dieron su sacudón de cámara. */
  craqueados: Set<number>;
  musica: boolean;
}

/* --------------------------------------------------------------- las figuras */
const CABELLOS = [0x2b1d14, 0x3d2817, 0x151515, 0x5a3a22];

function hacerPersona(i: number, color: number, completa: boolean): Persona {
  const raiz = new Container();
  const sombra = new Graphics().ellipse(0, 0, 0.3, 0.07).fill({ color: 0x000000, alpha: 0.35 });
  const luz = new Graphics().circle(0, 0, 0.55).fill({ color: 0xffc65a, alpha: 0.2 }).circle(0, 0, 0.3).fill({ color: 0xffe3a0, alpha: 0.22 });
  luz.blendMode = "add";
  const pierna = (x: number): Container => {
    const c = new Container();
    c.position.set(x, -0.5);
    c.addChild(
      new Graphics().roundRect(-0.065, 0, 0.13, 0.5, 0.05).fill(0x2b2d42).stroke({ width: 0.025, color: INK })
        .roundRect(-0.085, 0.42, 0.17, 0.09, 0.04).fill(0xe9e2d2).stroke({ width: 0.02, color: INK }),
    );
    return c;
  };
  const piernaI = pierna(-0.09);
  const piernaD = pierna(0.09);
  const torso = new Container();
  torso.position.set(0, -0.5);
  const brazo = (x: number): Container => {
    const c = new Container();
    c.position.set(x, -0.3);
    c.addChild(new Graphics().roundRect(-0.05, 0, 0.1, 0.34, 0.045).fill(color).stroke({ width: 0.022, color: INK }).circle(0, 0.37, 0.05).fill(0xc68a5c).stroke({ width: 0.018, color: INK }));
    return c;
  };
  const brazoI = brazo(-0.21);
  const brazoD = brazo(0.21);
  const hair = CABELLOS[Math.floor(hashDe(i, 8) * 4)] as number;
  const cuerpo = new Graphics().roundRect(-0.19, -0.37, 0.38, 0.4, 0.09).fill(color).stroke({ width: 0.028, color: INK });
  // La cabeza, de espaldas: el pelo y, a veces, un chullo.
  cuerpo.circle(-0.125, -0.5, 0.032).fill(0xc68a5c).circle(0.125, -0.5, 0.032).fill(0xc68a5c).circle(0, -0.5, 0.115).fill(hair).stroke({ width: 0.025, color: INK });
  if (completa && hashDe(i, 9) < 0.4) {
    const cc = mezcla(color, 0xffc629, 0.5);
    cuerpo.poly([-0.125, -0.53, -0.115, -0.64, 0, -0.68, 0.115, -0.64, 0.125, -0.53]).fill(cc).stroke({ width: 0.022, color: INK }).circle(0, -0.7, 0.035).fill(0xffc629);
  }
  torso.addChild(brazoI, brazoD, cuerpo);
  // El farolito, en la mano de la derecha.
  const farol = new Graphics().roundRect(-0.045, -0.02, 0.09, 0.11, 0.02).fill(0xffc65a).stroke({ width: 0.02, color: INK }).moveTo(0, -0.02).lineTo(0, -0.07).stroke({ width: 0.018, color: INK });
  farol.position.set(0, 0.36);
  brazoD.addChild(farol);
  raiz.addChild(sombra, luz, piernaI, piernaD, torso);
  return { raiz, piernaI, piernaD, brazoI, brazoD, torso, cuerpo, farol, luz, sombra };
}

/** El árbol de copa ancha del oriente (un toborochi o un ceibo), en silueta. */
function arbol(g: Graphics, x: number, base: number, alto: number, color: number): void {
  g.roundRect(x - alto * 0.035, base - alto * 0.62, alto * 0.07, alto * 0.64, alto * 0.02).fill(color);
  g.ellipse(x, base - alto * 0.7, alto * 0.42, alto * 0.2).fill(color);
  g.ellipse(x - alto * 0.22, base - alto * 0.62, alto * 0.22, alto * 0.12).fill(color);
  g.ellipse(x + alto * 0.24, base - alto * 0.64, alto * 0.2, alto * 0.11).fill(color);
}

export const guajojoPixi = crearJuego<Datos, Escena>({
  id: "guajojo",
  textos: TEXTOS,
  plan: planGuajojo,

  arma(k, plan, previa) {
    const { S } = k;
    const d = plan.datos;
    const p = k.pantalla();
    const g = geoDe(p);
    const raiz = previa?.raiz ?? new Container();
    if (!previa) S.scene.addChild(raiz);
    raiz.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const c of previa?.chips.values() ?? []) c.destroy({ children: true });
    previa?.capaChips.destroy({ children: true });
    S.bg.removeChildren().forEach((c) => c.destroy({ children: true }));
    S.bg.addChild(new Graphics().rect(0, 0, p.w, p.h).fill(TINTA_NOCHE));

    const noche = S.dark;
    const W = p.w;
    // Lo fijo del paisaje, que se oscurece entero con el tinte cuando calla el canto.
    const fijo = new Container();
    const cielo = new Graphics();
    const sol = new Graphics();
    fijo.addChild(cielo, sol);
    // Los cerros y los árboles del horizonte, en dos capas.
    const lejos = new Graphics();
    const cerros: number[] = [-W, g.yH + 2];
    for (let i = 0; i <= 40; i++) cerros.push(-W + (i / 40) * W * 3, g.yH - (0.03 + 0.07 * hashDe(i, 31)) * g.alto);
    cerros.push(W * 2, g.yH + 2);
    lejos.poly(cerros).fill(noche ? 0x151b3b : 0x3a2e63);
    for (let i = 0; i < 26; i++) arbol(lejos, -W * 0.4 + (i / 25) * W * 1.8 + hashDe(i, 3) * 40, g.yH + 4, g.alto * (0.12 + 0.08 * hashDe(i, 4)), noche ? 0x0f1430 : 0x2b2250);
    fijo.addChild(lejos);
    // El suelo y el sendero, en perspectiva.
    const suelo = new Graphics();
    suelo.rect(-W, g.yH, W * 3, p.h * 3).fill(noche ? 0x14301f : 0x2f5236);
    const a = proyectar(g, -1.0, -0.22), b = proyectar(g, 1.0, -0.22), c = proyectar(g, 1.0, 1.1), e = proyectar(g, -1.0, 1.1);
    suelo.poly([a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y]).fill(noche ? 0x4a4338 : 0x7b6650);
    // Los bordes del sendero y las matas, que se agrandan al acercarse.
    for (let i = 0; i < 70; i++) {
      const z = hashDe(i, 41) * 1.05 - 0.08;
      const lado = i % 2 ? 1 : -1;
      const q = proyectar(g, lado * (1.02 + 0.35 * hashDe(i, 42)), z);
      const h = g.cuerpo * q.s * (0.16 + 0.16 * hashDe(i, 43));
      suelo.poly([q.x - h * 0.9, q.y, q.x - h * 0.3, q.y - h * 1.2, q.x, q.y - h * 0.5, q.x + h * 0.4, q.y - h * 1.4, q.x + h, q.y]).fill(noche ? 0x0d2a1a : 0x254a2d);
    }
    // Ramitas caídas en el sendero: se ven y se oyen cuando se pisan.
    for (let i = 0; i < 26; i++) {
      const q = proyectar(g, (hashDe(i, 51) - 0.5) * 1.7, hashDe(i, 52) * 0.9);
      const l = g.cuerpo * q.s * (0.1 + 0.1 * hashDe(i, 53));
      suelo.moveTo(q.x - l, q.y).lineTo(q.x + l, q.y - l * 0.3).stroke({ width: Math.max(1, 2 * q.s * p.k), color: noche ? 0x2a2018 : 0x4a3626, alpha: 0.9 });
    }
    // Los árboles de al lado, grandes y oscuros, que enmarcan.
    const marco = new Graphics();
    for (const [x, z, h] of [[-1.5, 0.55, 1.9], [1.55, 0.7, 1.6], [-1.9, 0.15, 3.1], [1.95, 0.25, 2.8]] as const) {
      const q = proyectar(g, x, z);
      arbol(marco, q.x, q.y, g.cuerpo * q.s * h * 2.2, noche ? 0x0a0e22 : 0x241c40);
    }
    fijo.addChild(suelo, marco);
    // El palo seco, con sus ojos.
    const palo = new Graphics();
    const ojos = new Graphics();
    const haz = new Graphics();
    const bichos = new Graphics();
    const gente = new Container();
    gente.sortableChildren = true;
    const ramitas = new Graphics();
    raiz.addChild(fijo, palo, haz, gente, ramitas, ojos, bichos);
    haz.blendMode = "add";
    bichos.blendMode = "add";

    // La gente: las figuras son completas hasta 60; con más, más simples.
    const completa = d.n <= 60;
    const personas = Array.from({ length: d.n }, (_, i) => {
      const pe = hacerPersona(i, S.color(i), completa);
      gente.addChild(pe.raiz);
      return pe;
    });
    const capaChips = new Container();
    S.hud.addChild(capaChips);
    k.cam.cut(p.w / 2, (p.top + p.bottom) / 2, 1);
    const esc: Escena = {
      raiz, fijo, cielo, sol, palo, ojos, haz, gente, bichos, ramitas, personas, chips: new Map(), capaChips,
      tCorona: previa?.tCorona ?? null, craqueados: previa?.craqueados ?? new Set(), musica: previa?.musica ?? false,
    };
    if (!previa) S.onCleanup(() => musicHold(false));
    dibujarPalo(esc, g);
    // Para el auditor de emoción: dónde queda quien gana en la pantalla, a los pies del palo.
    S.ganadorEn(() => {
      const c = cajaDeCuerpo(g, 0, Z_META);
      const z = k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x;
      const s = k.cam.toScreen(c.x, c.y, p.w, p.h);
      return { x: s.x, y: s.y, w: c.w * z, h: c.h * z };
    });
    return esc;
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const { S } = k;
    const p = k.pantalla();
    const g = geoDe(p);
    const noche = S.dark;
    const W = p.w, H = p.h;
    if (k.coronado && e.tCorona === null) e.tCorona = t;
    const tau = e.tCorona === null ? -1 : t - e.tCorona;
    const { fase, ciclo } = faseDe(d, t);

    // El silencio oscurece el monte: solo quedan los ojos y los farolitos.
    const callado = fase === "silencio" || (fase === "crac" && ciclo !== null);
    const ult = ciclo?.ultimo === true;
    const oscuro = ciclo && (fase === "silencio" || fase === "crac")
      ? suave((t - ciclo.tSil0) / 0.35) * (1 - suave((t - (ciclo.t1 - 0.5)) / 0.5)) * (ult ? 0.5 : 0.36)
      : 0;
    // La música se calla mientras el guajojó mira y vuelve en el uno del compás.
    const quiereCalla = callado && !k.coronado;
    if (quiereCalla !== e.musica) {
      e.musica = quiereCalla;
      musicHold(quiereCalla);
    }
    if (k.coronado && e.musica) {
      e.musica = false;
      musicHold(false);
    }
    e.fijo.tint = mezcla(0xffffff, 0x3a3f6a, oscuro);

    /* ------------------------------------------------------------- el cielo */
    // Antes del amanecer, el cielo; con el golpe, sale el sol.
    const alba = tau >= 0 ? suave(tau / 1.8) : 0.5 * suave((t - d.tAmanecer0) / T_AMANECER);
    const yH = g.yH;
    const bandas: [number, number, number][] = noche
      ? [[0x070a22, 0x5a6fb5, 0], [0x0e1438, 0xb8708d, 0.3], [0x1b2150, 0xf2a2a0, 0.5], [0x2f3470, 0xffd27a, 0.7]]
      : [[0x2b2250, 0x5a6fb5, 0], [0x6b3a78, 0xe08a9a, 0.3], [0xc2527a, 0xf5b080, 0.5], [0xf59e5b, 0xffd78a, 0.7]];
    e.cielo.clear();
    const top = -H * 2;
    const alto = yH - top;
    for (let i = 0; i < bandas.length; i++) {
      const [c0, c1] = bandas[i] as [number, number, number];
      const y0 = top + (alto * i) / bandas.length;
      const y1 = i === bandas.length - 1 ? yH + 2 : top + (alto * (i + 1)) / bandas.length;
      e.cielo.rect(-W, y0, W * 3, y1 - y0 + 1).fill(mezcla(c0, c1, alba));
    }
    // Las estrellas, que se apagan con el día, y la luna, que baja.
    const estrellas = 1 - alba;
    if (estrellas > 0.02) {
      for (let i = 0; i < 46; i++) {
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.8 + hashDe(i, 6)) + i));
        e.cielo.circle(hashDe(i, 1) * W, p.top + hashDe(i, 2) * (yH - p.top) * 0.75, (0.8 + hashDe(i, 3) * 1.4) * p.k).fill({ color: 0xffffff, alpha: 0.65 * tw * estrellas });
      }
      const lx = W * 0.8, ly = p.top + (yH - p.top) * (0.28 + 0.4 * alba), lr = g.alto * 0.055;
      e.cielo.circle(lx, ly, lr * 2.6).fill({ color: 0xe9efff, alpha: 0.08 * estrellas }).circle(lx, ly, lr * 1.6).fill({ color: 0xe9efff, alpha: 0.1 * estrellas });
      e.cielo.circle(lx, ly, lr).fill({ color: noche ? 0xeef2ff : 0xfff1d0, alpha: estrellas });
      for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.17], [-0.05, 0.4, 0.12]] as const) e.cielo.circle(lx + dx * lr, ly + dy * lr, r * lr).fill({ color: noche ? 0xc9d2ee : 0xf0d9a8, alpha: 0.7 * estrellas });
    }
    // El sol sale detrás de las copas, a los pies del palo.
    e.sol.clear();
    if (alba > 0.3 || tau >= 0) {
      const s = tau >= 0 ? suave(tau / 2.2) : 0;
      const sx = W * 0.5, sy = yH + g.alto * 0.05 - g.alto * 0.12 * s, sr = g.alto * 0.09;
      for (const [m, a] of [[3.6, 0.1], [2.4, 0.14], [1.5, 0.2]] as const) e.sol.circle(sx, sy, sr * m).fill({ color: 0xffd27a, alpha: a * s });
      e.sol.circle(sx, sy, sr).fill({ color: 0xffe9a8, alpha: s });
    }

    /* ----------------------------------------------------------- la gente */
    const enPie = enPieEn(d, t);
    const hubo = new Set(enPie);
    const arriba = tau >= 0;
    for (let i = 0; i < d.n; i++) {
      const pe = e.personas[i] as Persona;
      const z = zDe(d, i, t);
      const x = xDe(d, i, t);
      const sent = sentadaDe(d, i, t);
      const q = proyectar(g, x, z);
      // La hinchada se acomoda en los costados de la pantalla, de a varios en fila, cada uno en su profundidad.
      const ts = d.sienta[i] as number;
      let sx = q.x;
      let sy = q.y;
      if (sent > 0) {
        const antes = proyectar(g, xDe(d, i, Math.min(t, ts)), z);
        const lado = (d.x0[i] as number) < 0 ? -1 : 1;
        const destino = W / 2 + lado * W * (0.32 + 0.08 * hashDe(i, 70));
        const glide = suave((t - ts - 0.9) / 0.7);
        sx = lerp(antes.x, destino, glide);
        sy = q.y + lado * 0 + (hashDe(i, 71) - 0.5) * g.alto * 0.05 * glide;
      }
      const esc = g.cuerpo * q.s;
      pe.raiz.position.set(sx, sy);
      pe.raiz.scale.set(esc);
      pe.raiz.zIndex = -z * 1000 + (sent > 0 ? -5 : 0);
      const v = (z - zDe(d, i, t - 0.08)) / 0.08;
      const marcha = Math.min(1, v / 0.05) * (1 - sent);
      const ph = z * 80;
      const sw = swayDe(d, i, t);
      // El hincha se levanta con el amanecer, uno tras otro.
      const para = arriba ? suave((tau - 0.15 - 0.35 * hashDe(i, 17)) / 0.35) : 0;
      const sentado = sent * (1 - para);
      const ganaEsta = i === d.ganador;
      let salto = 0;
      if (arriba && (para > 0.99 || ganaEsta)) salto = Math.abs(Math.sin(tau * 6.5 + hashDe(i, 18) * 6)) * 0.14;
      // Las piernas: alternadas al caminar, y una levantada al tambalear.
      pe.piernaI.visible = pe.piernaD.visible = sentado < 0.55;
      pe.piernaI.rotation = Math.sin(ph) * 0.55 * marcha - 0.55 * sw;
      pe.piernaD.rotation = -Math.sin(ph) * 0.55 * marcha;
      pe.piernaI.scale.y = 1 - 0.45 * sw;
      pe.torso.position.set(0, -0.5 + 0.3 * sentado - Math.abs(Math.sin(ph)) * 0.035 * marcha - salto);
      pe.torso.scale.y = 1 - 0.1 * sentado;
      pe.torso.rotation = Math.sin(t * 12 + i) * 0.17 * sw - 0.05 * marcha;
      // Los brazos: al compás, en vilo al tambalear, abrazando las rodillas al sentarse, arriba al festejar.
      const alz = arriba && (para > 0.5 || ganaEsta) ? 1 : 0;
      pe.brazoI.rotation = alz ? -2.7 : Math.sin(ph) * 0.5 * marcha + Math.sin(t * 17 + i) * 1.0 * sw - 0.55 * sentado;
      pe.brazoD.rotation = alz ? 2.7 : -Math.sin(ph) * 0.5 * marcha - Math.sin(t * 15 + i + 1) * 1.0 * sw + 0.55 * sentado;
      // En la llamada y la lista calientan: saltitos en el lugar.
      if (fase === "llamada" || fase === "lista") {
        const hop = Math.abs(Math.sin(t * 5 + i * 1.3)) * 0.07;
        pe.torso.y -= hop;
        pe.brazoI.rotation = Math.sin(t * 5 + i) * 0.3;
        pe.brazoD.rotation = -Math.sin(t * 5 + i) * 0.3;
      }
      pe.luz.alpha = i === d.ganador || (hubo.has(i) && enPie.length <= 3) ? 1 : sentado > 0.5 ? 0.55 : 0.8;
      pe.luz.position.set(0.2, -0.42 + 0.3 * sentado - salto);
      pe.sombra.alpha = 1 - 0.3 * sentado;
    }

    /* ----------------------------------------- el palo, los ojos y la mirada */
    const m = miradaDe(d, t);
    // En la llamada el ave abre los ojos un instante: enseña la regla antes de que empiece el canto.
    const guino = t > 0.8 && t < 2.1 ? Math.sin((Math.PI * (t - 0.8)) / 1.3) * 0.9 : 0;
    const ab = tau >= 0 ? 0 : m ? m.abierto : guino;
    e.haz.clear();
    dibujarOjos(e, g, ab, m ? m.x : 0);
    if (m && ab > 0.02 && tau < 0) {
      // La mirada: un cono desde los ojos hasta el lugar del sendero que mira.
      const zs = enPie.length ? enPie.map((i) => zDe(d, i, t)).sort((a, b) => a - b) : [0.5];
      const zMed = ciclo?.ultimo ? Z_ULTIMOS : Math.max(0.12, Math.min(0.85, zs[Math.floor(zs.length / 2)] as number));
      const spot = proyectar(g, m.x, zMed);
      const ancho = g.mitad * spot.s * 0.17;
      const caja = cajaDelPalo(g);
      const ex = caja.x + caja.w / 2, ey = caja.y + caja.h * 0.2;
      const ow = caja.w * 0.2;
      e.haz.poly([ex - ow, ey, ex + ow, ey, spot.x + ancho * 1.3, spot.y, spot.x - ancho * 1.3, spot.y]).fill({ color: 0xffe27a, alpha: 0.11 * ab });
      e.haz.poly([ex - ow * 0.5, ey, ex + ow * 0.5, ey, spot.x + ancho * 0.6, spot.y, spot.x - ancho * 0.6, spot.y]).fill({ color: 0xfff1b0, alpha: 0.1 * ab });
      e.haz.ellipse(spot.x, spot.y, ancho * 1.4, ancho * 0.45).fill({ color: 0xffe27a, alpha: 0.2 * ab });
    }

    /* ------------------------------------------------ luciérnagas y ramitas */
    e.bichos.clear();
    const bichos = d.n > 64 ? 14 : 26;
    for (let i = 0; i < bichos; i++) {
      const z = hashDe(i, 61) * 0.9;
      const q = proyectar(g, (hashDe(i, 62) - 0.5) * 3, z);
      const bx = q.x + Math.sin(t * 0.7 + i * 2) * 16 * q.s * p.k;
      const by = q.y - g.cuerpo * q.s * (0.5 + hashDe(i, 63) * 1.4) + Math.cos(t * 0.9 + i) * 10 * q.s * p.k;
      const pulso = 0.25 + 0.75 * Math.max(0, Math.sin(t * (1 + hashDe(i, 64)) + i * 3));
      const r = (1.3 + 1.6 * q.s) * p.k;
      e.bichos.circle(bx, by, r * 3.2).fill({ color: 0xc8ff5a, alpha: 0.1 * pulso * (1 - alba)}).circle(bx, by, r).fill({ color: 0xeaff9a, alpha: 0.9 * pulso * (1 - alba) });
    }
    e.ramitas.clear();
    if (ciclo && fase !== "canto") {
      for (let j = 0; j < ciclo.victimas.length; j++) {
        const dt = t - (ciclo.tCae[j] as number);
        if (dt < 0 || dt > 0.55 || j > 30) continue;
        const i = ciclo.victimas[j] as number;
        const q = proyectar(g, xDe(d, i, ciclo.tCae[j] as number), zDe(d, i, t));
        const l = g.cuerpo * q.s * 0.2;
        const f = 1 - dt / 0.55;
        // La ramita que se parte y las chispas del crac.
        e.ramitas.moveTo(q.x - l * (1 + dt * 2), q.y - l * 0.2).lineTo(q.x - l * 0.1, q.y).moveTo(q.x + l * 0.1, q.y).lineTo(q.x + l * (1 + dt * 2), q.y - l * 0.3).stroke({ width: Math.max(1.5, 3 * q.s * p.k), color: 0xd9b27a, alpha: f });
        for (let r = 0; r < 6; r++) {
          const an = (r / 6) * Math.PI * 2 + hashDe(i, r);
          const r0 = l * (0.4 + 2 * dt), r1 = l * (0.9 + 3 * dt);
          e.ramitas.moveTo(q.x + Math.cos(an) * r0, q.y - l * 0.4 + Math.sin(an) * r0 * 0.6).lineTo(q.x + Math.cos(an) * r1, q.y - l * 0.4 + Math.sin(an) * r1 * 0.6).stroke({ width: Math.max(1, 2 * q.s * p.k), color: 0xffffff, alpha: f * 0.9 });
        }
      }
      // En el primer crac de cada silencio, la cámara pega un golpe.
      if (fase === "crac" && ciclo.victimas.length && t >= (ciclo.tCae[0] as number) && !e.craqueados.has(ciclo.c)) {
        e.craqueados.add(ciclo.c);
        k.cam.punch(ciclo.ultimo ? 0.06 : 0.035).shake((ciclo.ultimo ? 7 : 4) * p.k);
      }
    }

    /* ------------------------------------------------------------ los nombres */
    nombres(k, d, e, g, t, fase, ciclo, enPie);
  },
});

/* --------------------------------------------------------------- el palo seco */
function dibujarPalo(e: Escena, g: Geo): void {
  const caja = cajaDelPalo(g);
  const cx = caja.x + caja.w / 2;
  const base = caja.y + caja.h - g.alto * 0.04;
  const alto = base - caja.y;
  const ancho = caja.w;
  const corteza = 0x5b4a3c, sombra = 0x3a2e26, claro = 0x8a7660;
  const gr = e.palo.clear();
  // El tronco, más ancho abajo, y la punta rota arriba: de día es un palo.
  gr.poly([
    cx - ancho * 0.3, base, cx - ancho * 0.23, base - alto * 0.5, cx - ancho * 0.19, base - alto * 0.82, cx - ancho * 0.15, base - alto * 0.95, cx - ancho * 0.1, caja.y + alto * 0.03,
    cx - ancho * 0.02, caja.y + alto * 0.012, cx + ancho * 0.05, caja.y + alto * 0.06, cx + ancho * 0.13, base - alto * 0.93, cx + ancho * 0.2, base - alto * 0.8, cx + ancho * 0.24, base - alto * 0.5, cx + ancho * 0.32, base,
  ]).fill(corteza).stroke({ width: Math.max(1.5, ancho * 0.03), color: INK, join: "round" });
  // La veta de la madera seca y el jaspeado del plumaje: se parecen.
  for (let i = 0; i < 9; i++) {
    const x = cx - ancho * 0.2 + ancho * 0.4 * ((i * 0.37) % 1);
    const y0 = caja.y + alto * (0.08 + 0.7 * ((i * 0.53) % 1));
    gr.moveTo(x, y0).lineTo(x + ancho * 0.02 * (i % 2 ? 1 : -1), y0 + alto * 0.1).stroke({ width: Math.max(1, ancho * 0.015), color: i % 3 ? sombra : claro, alpha: 0.7 });
  }
  // Una rama muerta que sale del costado.
  gr.moveTo(cx + ancho * 0.22, base - alto * 0.5).lineTo(cx + ancho * 0.42, base - alto * 0.5).lineTo(cx + ancho * 0.55, base - alto * 0.42)
    .stroke({ width: Math.max(2, ancho * 0.04), color: corteza, cap: "round" });
  // La cara plana del ave, sobre la punta.
  gr.ellipse(cx, caja.y + alto * 0.2, ancho * 0.2, alto * 0.14).fill({ color: claro, alpha: 0.16 });
}

/** Los ojos del guajojó: dos discos amarillos que se abren, con su pupila que sigue la mirada. El brillo va aparte, sumando luz. */
function dibujarOjos(e: Escena, g: Geo, abierto: number, mira: number): void {
  const caja = cajaDelPalo(g);
  const cx = caja.x + caja.w / 2;
  const ey = caja.y + caja.h * 0.2;
  const r = caja.w * 0.105;
  const sep = caja.w * 0.19;
  const gr = e.ojos.clear();
  for (const lado of [-1, 1]) {
    const x = cx + lado * sep;
    if (abierto < 0.04) {
      // Cerrados: una rendija oscura, como la grieta del palo.
      gr.moveTo(x - r * 0.8, ey).lineTo(x + r * 0.8, ey).stroke({ width: Math.max(1.5, r * 0.22), color: 0x2a2018, alpha: 0.9 });
      continue;
    }
    gr.ellipse(x, ey, r * 1.1, r * (0.12 + 0.98 * abierto)).fill(0xffd23a).stroke({ width: Math.max(1.5, r * 0.12), color: 0x3a2a08 });
    gr.ellipse(x + Math.max(-1, Math.min(1, mira)) * r * 0.3, ey, r * 0.38, r * (0.1 + 0.38 * abierto)).fill(0x120c06);
  }
  // El resplandor de los ojos.
  if (abierto >= 0.04) {
    for (const lado of [-1, 1]) {
      const x = cx + lado * sep;
      e.haz.circle(x, ey, r * 3.1).fill({ color: 0xffd23a, alpha: 0.1 * abierto }).circle(x, ey, r * 1.9).fill({ color: 0xffd23a, alpha: 0.16 * abierto });
    }
  }
}

/** Los nombres: la lista de a ocho, los que siguen en el canto, y el de quien se acaba de sentar, pegado a donde pasó. */
function nombres(k: Kit, d: Datos, e: Escena, g: Geo, t: number, fase: string, ciclo: Ciclo | null, enPie: number[]): void {
  const { S } = k;
  const p = k.pantalla();
  const sobreLaCabeza = (i: number): { x: number; y: number } => {
    const q = proyectar(g, xDe(d, i, t), zDe(d, i, t));
    return k.cam.toScreen(q.x, q.y - g.cuerpo * q.s * 1.12, p.w, p.h);
  };
  const recientes = new Set<number>();
  if (ciclo) {
    ciclo.victimas.forEach((i, j) => {
      const dt = t - (ciclo.tCae[j] as number);
      if (dt >= 0 && dt < T_NOMBRE && recientes.size < (p.retrato ? 3 : 5)) recientes.add(i);
    });
  }
  let quienes: number[] = [];
  if (fase === "llamada" || fase === "lista") quienes = tandaDeLista(d, t);
  // Al amanecer la ganadora camina sola al palo, con su nombre: la sala no la mira a ciegas.
  else if (fase === "amanecer") quienes = [d.ganador];
  else {
    // Hasta doce de los que siguen, rotando cada rato para que todos aparezcan.
    const vivos = enPie.filter((i) => !recientes.has(i));
    const tope = ciclo?.ultimo ? 2 : p.retrato ? 5 : 8;
    const B = Math.max(1, Math.ceil(vivos.length / tope));
    const turno = Math.floor(t / 0.9) % B;
    quienes = vivos.filter((_, j) => j % B === turno);
    if (ciclo?.ultimo) quienes = [d.ganador, d.rival].filter((i) => !recientes.has(i));
  }
  // Ningún nombre tapa los ojos del palo ni el contador.
  const palo = cajaDelPalo(g);
  const zc = k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x;
  const pa = k.cam.toScreen(palo.x, palo.y, p.w, p.h);
  const reserva = reservaDeMarcas(k.nombres.length, S.u(), p.w);
  const evitar = [
    { x: pa.x, y: pa.y, width: palo.w * zc, height: palo.h * zc * 0.55 },
    // El contador lleva el total («QUEDAN  18 DE 18») y debajo la fila de marcas: se reserva lo que miden de verdad, desde donde
    // el kit lo pone (`S.top() + 10u`, con su sombra), y no una altura de ojo.
    { x: 0, y: S.top() + MARCADOR.y * S.u(), width: MARCADOR.x * S.u() + Math.max(anchoMarcador(textoMarcador(k.txt("marcadorQuedan"), k.nombres.length, { de: k.txt("marcadorDe"), cuantos: k.nombres.length }), S.u()) + 5 * S.u(), reserva.ancho), height: medidasMarcador(S.u()).alto + 5 * S.u() + reserva.alto },
  ];
  // El que acaba de sentarse: su nombre crece un rato donde pasó, sin tapar el contador ni pisar a otro.
  for (const c of e.chips.values()) c.visible = false;
  const contador = evitar[1] as { x: number; y: number; width: number; height: number };
  const puestos: { x: number; y: number; w: number; h: number }[] = [];
  for (const i of recientes) {
    let c = e.chips.get(i);
    if (!c) {
      c = S.chip(k.nombres[i] ?? "", 1.25);
      e.chips.set(i, c);
      e.capaChips.addChild(c);
    }
    const dt = t - ((ciclo as Ciclo).tCae[(ciclo as Ciclo).victimas.indexOf(i)] as number);
    const pt = sobreLaCabeza(i);
    c.visible = true;
    c.alpha = 1 - suave((dt - (T_NOMBRE - 0.3)) / 0.3);
    const margen = 8 * p.k;
    const cx = Math.max(margen, Math.min(p.w - c.width - margen, pt.x - c.width / 2));
    const piso = S.top() + 4 * p.k;
    const sobre = (o: { x: number; y: number; w: number; h: number }, y: number): boolean => cx < o.x + o.w && cx + c.width > o.x && y < o.y + o.h && y + c.height > o.y;
    const caja = { x: contador.x, y: contador.y, w: contador.width, h: contador.height };
    let cy = Math.max(piso, pt.y - c.height);
    // Ni sobre el contador ni sobre otro nombre: si sube y se mete en el contador, baja por debajo de él.
    for (let r = 0; r < 6; r++) {
      if (sobre(caja, cy)) {
        cy = caja.y + caja.h + 4 * p.k;
        continue;
      }
      const choca = puestos.find((o) => sobre(o, cy));
      if (!choca) break;
      const arriba = choca.y - c.height - 2 * p.k;
      cy = arriba >= piso && !sobre(caja, arriba) ? arriba : choca.y + choca.h + 2 * p.k;
    }
    puestos.push({ x: cx, y: cy, w: c.width, h: c.height });
    c.position.set(cx, cy);
  }
  // Las etiquetas de los que siguen tampoco pisan los nombres de los que se sientan.
  for (const o of puestos) evitar.push({ x: o.x, y: o.y, width: o.w, height: o.h });
  S.tags(k.nombres as string[], quienes, sobreLaCabeza, evitar);
}
