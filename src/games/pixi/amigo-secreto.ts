import { Container, Graphics, Sprite } from "pixi.js";
import { hashDe } from "./kit/azar";
import { CREAM, INK, YELLOW, crearJuego, type Kit } from "./kit";
import { TEXTOS, cajaDe, layoutTarjetas, planAmigo, type Datos, type Mesa, type Pant } from "../amigo-secreto/show";

/**
 * Amigo secreto: la escena.
 *
 * Una mesa al atardecer: una tarjeta de regalo por persona, con su cara y su
 * nombre, en la grilla de la mesa (`layoutTarjetas`, el lugar lo manda el
 * plan). Cada sobre se abre de a uno —la tapa sube y adentro aparece a quién
 * le toca regalar— y al final el sobre del premio se abre con el golpe: su
 * tarjeta queda amarilla y llueve confeti, como el cartel del ganador.
 *
 * Todo lo que no es dibujo lo hace el kit (`./kit`): el montaje, la cámara con
 * sus cinco arcos (la mesa entera, la fila de sobres que se abren, la tensión
 * sobre el sobre del premio y su vecino), el foco, los subtítulos, el sonido,
 * el contador y el cierre. Acá solo se dibuja, como función del segundo `t`:
 * la misma ronda dibuja lo mismo cuadro por cuadro, y saltar a cualquier
 * momento da lo mismo que llegar mirando. Sin `Math.random`: hasta el confeti
 * sale del hash de la ronda.
 */

/** La paleta de la casa: atardecer en el tema oscuro, día en el claro (`docs/marca.md`). */
const PALETA = {
  claro: {
    cielo: [0x8fd3ff, 0xc9e6ff, 0xf6efe2],
    sol: YELLOW,
    piso: 0xe9c797,
    pisoBajo: 0xd9b284,
    tarjeta: CREAM,
    interior: 0xfff8ea,
  },
  oscuro: {
    cielo: [0x2b1a4a, 0x7a2f5f, 0xe0763f],
    sol: YELLOW,
    piso: 0x241b3a,
    pisoBajo: 0x1a1430,
    tarjeta: CREAM,
    interior: 0xfff8ea,
  },
} as const;
type Colores = (typeof PALETA)[keyof typeof PALETA];

/** Cuánto tarda en abrirse un sobre, en segundos de juego. */
const ABRE = 0.35;
/** El confeti del premio: piezas que caen desde la tarjeta del ganador. */
const CONFETI = 90;
/** La duración del confeti, en segundos desde el golpe. */
const CONFETI_DUR = 3;

/** Una tarjeta de regalo: la base (crema o amarilla), la cara, la tapa del sobre y el interior. */
interface Tarjeta {
  raiz: Container;
  crema: Graphics;
  amarilla: Graphics;
  cara: Sprite;
  tapa: Graphics;
  interior: Container;
}

interface Escena {
  fondo: Container;
  mesa: Container;
  confeti: Graphics;
  confetiSucio: boolean;
  tarjetas: Tarjeta[];
  mesaPos: Mesa;
  s: number;
  colores: Colores;
  /** Dónde está el sobre que se está abriendo, en la pantalla: la verdad de la prueba del niño. */
  puntoDelFrente?: (hora: number) => { x: number; y: number } | null;
}

const entre = (u: number): number => Math.max(0, Math.min(1, u));
const suave = (u: number): number => {
  const v = entre(u);
  return v * v * (3 - 2 * v);
};

/* ------------------------------------------------------------------ el fondo */

/** El atardecer de la casa: bandas de cielo, el sol bajo y la mesa de madera debajo. */
function dibujarFondo(k: Kit, p: Pant, c: Colores, s: number): Container {
  const fondo = new Container({ isRenderGroup: true });
  const cielo = new Graphics();
  const bandas = c.cielo.length;
  const alto = p.bottom;
  cielo.rect(0, 0, p.w, p.h).fill(c.cielo[bandas - 1] as number);
  for (let i = 0; i < bandas; i++) {
    const y = (alto * 0.62 * i) / bandas;
    const h = (alto * 0.62) / bandas + 2;
    cielo.rect(0, y, p.w, h).fill(c.cielo[i] as number);
  }
  // El sol, bajo a la izquierda, con su borde de tinta.
  const solX = p.w * 0.2;
  const solY = alto * 0.4;
  const solR = Math.max(14 * s, Math.min(44 * s, p.h * 0.07));
  cielo.circle(solX, solY, solR).fill(c.sol).stroke({ width: 3 * s, color: INK, join: "round" });
  // La mesa de madera: la mitad de abajo, con sus tablas.
  const mesa = new Graphics();
  mesa.rect(0, alto * 0.62, p.w, p.h - alto * 0.62).fill(c.piso).stroke({ width: 3 * s, color: INK });
  for (let x = 0; x < p.w; x += 220 * s) {
    mesa.rect(x + 8 * s, alto * 0.62 + 6 * s, 3 * s, p.h - alto * 0.62 - 12 * s).fill({ color: INK, alpha: 0.12 });
  }
  mesa.rect(0, alto * 0.62, p.w, 10 * s).fill(c.pisoBajo).stroke({ width: 2.5 * s, color: INK });
  fondo.addChild(cielo, mesa);
  return fondo;
}

/* ------------------------------------------------------------------ las tarjetas */

/** Una tarjeta de regalo con su cara y su tapa: el interior (a quién regala) queda escondido hasta que se abre. */
function armarTarjeta(k: Kit, i: number, lado: number, s: number, c: Colores): Tarjeta {
  const { S } = k;
  const raiz = new Container();
  const borde = { width: Math.max(2.5 * s, lado * 0.045), color: INK, join: "round" as const };
  const sombra = new Graphics().roundRect(lado * 0.09, lado * 0.12, lado, lado, lado * 0.14).fill({ color: INK, alpha: 0.32 });
  const crema = new Graphics().roundRect(0, 0, lado, lado, lado * 0.14).fill(c.tarjeta).stroke(borde);
  const amarilla = new Graphics().roundRect(0, 0, lado, lado, lado * 0.14).fill(YELLOW).stroke(borde);
  amarilla.visible = false;
  // La cara de la persona, arriba de la tarjeta.
  const cara = new Sprite(S.face(k.nombres[i] ?? ""));
  cara.anchor.set(0.5);
  const caraLado = lado * 0.42;
  cara.width = cara.height = caraLado;
  cara.position.set(lado / 2, lado * 0.3);
  // La tapa del sobre: una solapa triangular con el borde de la casa. Al abrirse, sube y desaparece.
  const tapa = new Graphics()
    .poly([0, 0, lado, 0, lado, lado * 0.62, lado / 2, lado * 0.94, 0, lado * 0.62])
    .fill(c.tarjeta)
    .stroke({ width: Math.max(2.5 * s, lado * 0.04), color: INK, join: "round" });
  tapa.pivot.set(0, 0);
  // El interior: la flecha y el chip de a quién le toca regalar, oculto hasta la apertura.
  const interior = new Container();
  interior.visible = false;
  const flecha = new Graphics()
    .moveTo(lado * 0.2, lado * 0.52)
    .lineTo(lado * 0.72, lado * 0.52)
    .stroke({ width: Math.max(2.5 * s, lado * 0.055), color: INK, cap: "round" })
    .poly([lado * 0.68, lado * 0.44, lado * 0.82, lado * 0.52, lado * 0.68, lado * 0.6])
    .fill(INK);
  interior.addChild(flecha);
  raiz.addChild(sombra, crema, amarilla, cara, interior, tapa);
  return { raiz, crema, amarilla, cara, tapa, interior };
}

/* ------------------------------------------------------------------ el confeti */

/** Dónde va la pieza `i` del confeti en el segundo `t` desde el golpe, en el mundo: puro, del hash. */
function piezaConfeti(i: number, t: number, mesa: Mesa, ganador: number, w: number, h: number): { x: number; y: number; rot: number } {
  const origen = mesa.pos[ganador] ?? { x: w / 2, y: h / 2 };
  const semilla = hashDe(i * 31 + 7, 1013);
  const velocidad = 120 + semilla * 180;
  const caida = ((t * velocidad) % (h * 1.3)) - h * 0.15;
  return {
    x: origen.x + (hashDe(i, 5) - 0.5) * w * 0.7 + Math.sin(t * (1.5 + semilla * 2) + i) * 30,
    y: origen.y - h * 0.1 + caida,
    rot: hashDe(i, 9) * Math.PI * 2 + t * (2 + semilla * 3),
  };
}

/* ------------------------------------------------------------------ el juego */

export const amigoPixi = crearJuego<Datos, Escena>({
  id: "amigo",
  textos: TEXTOS,
  plan: planAmigo,

  arma(k, plan, previa) {
    const { S } = k;
    const d = plan.datos;
    const p = k.pantalla();
    if (previa) {
      previa.fondo.destroy({ children: true });
      previa.mesa.destroy({ children: true });
    }
    const s = p.k * (p.retrato ? 0.85 : 1);
    const c = S.dark ? PALETA.oscuro : PALETA.claro;
    const fondo = dibujarFondo(k, p, c, s);
    S.bg.addChildAt(fondo, 0);

    const mesaPos = layoutTarjetas(p, d.n);
    const mesa = new Container();
    const confeti = new Graphics();
    const tarjetas = Array.from({ length: d.n }, (_, i) => {
      const q = mesaPos.pos[i] as { x: number; y: number };
      const t = armarTarjeta(k, i, mesaPos.lado, s, c);
      // La tarjeta pivota en su centro: el brinco de la apertura crece desde ahí.
      t.raiz.pivot.set(mesaPos.lado / 2, mesaPos.lado / 2);
      t.raiz.position.set(q.x, q.y);
      // El chip de a quién le toca regalar, dentro del sobre: la cara ya está a la vista, el chip va sin cara.
      const destino = k.nombres[d.asignacion[i] ?? 0] ?? "";
      const chip = S.chip(destino, Math.min(1, (mesaPos.lado * 0.92) / (120 * s)), undefined, undefined, false);
      chip.position.set(mesaPos.lado * 0.08, mesaPos.lado * 0.62);
      t.interior.addChild(chip);
      mesa.addChild(t.raiz);
      return t;
    });
    mesa.addChild(confeti);
    S.scene.addChild(mesa);

    // La cámara parte de la mesa entera; el director sigue desde ahí.
    const cajaMesa = cajaDe(p, mesaPos, 0);
    const cajaFin = cajaDe(p, mesaPos, d.n - 1);
    k.cam.cut((cajaMesa.x + cajaFin.x + cajaFin.w) / 2, (cajaMesa.y + cajaFin.y + cajaFin.h) / 2, 1);
    return { fondo, mesa, confeti, confetiSucio: false, tarjetas, mesaPos, s, colores: c };
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const { S } = k;

    // El sobre que le toca ahora: el próximo que se abre (o el del premio, al final). Es donde mira la sala,
    // y también la verdad de la prueba del niño.
    const actual = d.orden.find((i) => (d.tiempos[i] ?? plan.duracion) > t) ?? d.ganador;
    const qActual = e.mesaPos.pos[actual] as { x: number; y: number } | undefined;
    e.puntoDelFrente = () => (qActual ? k.cam.toScreen(qActual.x, qActual.y, k.S.sw(), k.S.sh()) : null);

    // La apertura de cada sobre, como función de t: la tapa sube, la tarjeta pega su brinco, el interior aparece.
    for (let i = 0; i < d.n; i++) {
      const tarjeta = e.tarjetas[i] as Tarjeta;
      const q = e.mesaPos.pos[i] as { x: number; y: number };
      const t0 = d.tiempos[i] ?? plan.duracion;
      const abierto = t >= t0;
      const u = suave((t - t0) / ABRE);
      const brinco = abierto && t < t0 + ABRE ? Math.sin(Math.PI * entre((t - t0) / ABRE)) * 0.1 : 0;
      const premio = i === d.ganador && k.coronado ? 1.3 : 1;
      tarjeta.raiz.scale.set((1 + brinco) * premio, (1 + brinco) * premio);
      tarjeta.raiz.position.set(q.x, q.y);
      // La tapa sube doblándose; el interior aparece con ella.
      tarjeta.tapa.visible = !abierto || u < 1;
      if (tarjeta.tapa.visible) {
        tarjeta.tapa.scale.set(1, Math.max(0.001, 1 - u));
        tarjeta.tapa.alpha = 1 - u * 0.4;
      }
      tarjeta.interior.visible = abierto;
      tarjeta.interior.alpha = u;
      // El premio: la tarjeta amarilla, siempre que el golpe ya cayó.
      const esPremio = i === d.ganador && k.coronado;
      tarjeta.amarilla.visible = esPremio;
      tarjeta.crema.visible = !esPremio;
    }

    // El confeti del premio: piezas que caen desde la tarjeta amarilla, puras del hash y de la hora.
    if (k.coronado) {
      const tc = t - plan.duracion;
      e.confetiSucio = true;
      e.confeti.clear();
      const colores = [YELLOW, 0xff5cb3, 0x6fc3df, CREAM];
      const alfa = Math.max(0, 1 - tc / CONFETI_DUR);
      for (let i = 0; i < CONFETI; i++) {
        const z = piezaConfeti(i, tc, e.mesaPos, d.ganador, k.S.sw(), k.S.sh());
        const ladoP = (4 + 5 * hashDe(i, 3)) * e.s;
        e.confeti.rect(z.x - ladoP / 2, z.y - ladoP / 2, ladoP, ladoP * 0.6).fill({ color: colores[i % colores.length] as number, alpha: alfa });
      }
    } else if (e.confetiSucio) {
      e.confeti.clear();
      e.confetiSucio = false;
    }

    // Los nombres. En la presentación, todos se buscan; en la revelación, los que se abren ahora y los que siguen;
    // con el golpe, solo el premio.
    const p = k.pantalla();
    const ordenActual = d.orden.filter((i) => (d.tiempos[i] ?? plan.duracion) > t);
    const recien = d.orden.filter((i) => {
      const t0 = d.tiempos[i] ?? plan.duracion;
      return t >= t0 - 0.4 && t < t0 + 2.5;
    });
    let quienes: number[];
    if (k.coronado) quienes = [d.ganador];
    else if (t < 3) quienes = d.n <= 24 ? Array.from({ length: d.n }, (_, i) => i) : S.batch(d.n, t, 0, 3, undefined, 12);
    else if (d.n <= 8) quienes = Array.from({ length: d.n }, (_, i) => i);
    else quienes = [...recien, ...(ordenActual.length ? [ordenActual[0] as number] : [])].slice(0, p.retrato ? 6 : 9);
    S.tags(k.nombres as string[], quienes, (i) => {
      const q = e.mesaPos.pos[i];
      if (!q) return null;
      const sp = k.cam.toScreen(q.x, q.y - e.mesaPos.lado * 0.62, p.w, p.h);
      if (sp.x < -20 * e.s || sp.x > p.w + 20 * e.s || sp.y < -40 * e.s || sp.y > p.h + 40 * e.s) return null;
      return sp;
    });
  },
});
