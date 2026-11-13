import { Container, Graphics, Sprite } from "pixi.js";
import { CREAM, INK, YELLOW, crearJuego, type Kit } from "./kit";
import { planAutos, pista, posicionDe, salidaDe, type Datos, type Ola, type Pant } from "./autos-plan";
import { TEXTOS } from "./autos-textos";

/**
 * Carrera de autos: la escena.
 *
 * Una ruta de cordillera vista de costado, de izquierda a derecha: la grilla a
 * la izquierda, la bandera a cuadros a la derecha y, en el medio, los carriles.
 * Cada persona maneja un auto de su color con su cara en la ventanilla y su
 * nombre encima (la capa de nombres del estadio, `S.tags`). En cada ola se abre
 * un hoyo bajo uno o varios autos, que se hunden, o cae una roca gigante que
 * los deja aplastados; quien gana nunca cae en un hoyo y la roca del susto solo
 * lo roza. El único que cruza la meta es quien ganó el sorteo.
 *
 * Todo lo que no es dibujo lo hace el kit (`./kit`): el montaje, la cámara con
 * sus cinco arcos (la grilla entera, el pelotón, la tensión sobre quien gana y
 * la rival), el foco, los subtítulos, el sonido, el contador y el cierre. Lo que
 * pasa y cuándo lo dice el plan (`autos-plan.ts`). Acá solo se dibuja, como
 * función del segundo `t`: la misma ronda dibuja lo mismo cuadro por cuadro, y
 * saltar a cualquier momento da lo mismo que llegar mirando. Ningún número va
 * en la escena: los números van en el marcador.
 */

/** Las medidas del auto, en unidades de la pantalla (`k`): el radio de la rueda y el alto del auto entero. */
const RUEDA = 11;
const ALTO_AUTO = 72;
/** Cuánto dura cada cosa, en segundos de juego. */
const CAE_ROCA = 0.7;
const ABRE_HOYO = 0.6;
const HUNDE = 0.6;
const POLVO = 0.5;
const SUSTO = 0.8;
/** Cuánto tarda en deshacerse la fila de la grilla después de la largada. */
const SUELTA_GRILLA = 2.2;
/** El radio de una roca gigante. */
const RADIO_ROCA = 55;
/** Lo que separa a dos autos del mismo carril en la grilla. */
const PASO_GRILLA = 104;
/** Cómo queda un auto bajo la roca: chato y un poco más ancho. */
const APLASTADO = 0.35;

/** Los colores de la escena, de la carrera de llamas por la cordillera (`themes.ts`). */
const PALETA = {
  claro: {
    cielo: 0x8fd3ff, sol: YELLOW, lejos: 0xb98ad1, nieve: CREAM, cerca: 0x7fc07a, pasto: 0x5f9e5a, tierra: 0xe9c797,
    asfalto: 0x4b4654, raya: CREAM, cordon: 0xe93d9c, roca: 0x9a95a3, rocaLuz: 0xc6c1cf, borde: 0x3d2f26, pozo: 0x0b080e, polvo: 0xe9dcc6,
  },
  oscuro: {
    cielo: 0x141032, sol: CREAM, lejos: 0x241b4a, nieve: 0x8c84b0, cerca: 0x1d2a3f, pasto: 0x223a35, tierra: 0x2b2140,
    asfalto: 0x2b2540, raya: 0xcfc6b4, cordon: 0xff5cb3, roca: 0x6b6680, rocaLuz: 0x8b86a0, borde: 0x1f1a28, pozo: 0x07050a, polvo: 0x7a6e94,
  },
} as const;
type Colores = (typeof PALETA)[keyof typeof PALETA];

/** Un auto: el cuerpo entero (con la cara y la sombra) y sus dos ruedas, que giran. */
interface Auto {
  raiz: Container;
  ruedas: Container[];
}

/** Una roca: dónde cae (el piso donde se apoya) y en qué segundo. */
interface Roca {
  g: Graphics;
  x: number;
  /** El piso donde queda apoyada la base de la roca. */
  piso: number;
  t: number;
  /** Para qué lado gira mientras cae. */
  giro: number;
  /** Su orden entre los restos: la roca de un aplastado va encima de su auto. */
  z: number;
}

/** Un hoyo: el pozo en la ruta y el recipiente que esconde lo que se hunde debajo del borde. */
interface Hoyo {
  g: Graphics;
  pozo: Container;
  x: number;
  /** La línea del borde del hoyo: lo que se hunde por debajo no se ve. */
  y: number;
  t: number;
}

interface Escena {
  /** El cielo y la cordillera, fijos a la pantalla. */
  fondo: Container;
  lejos: Graphics;
  cerca: Graphics;
  /** El largo de un tramo de cordillera, que se repite. */
  periodo: number;
  /** La ruta y todo lo que pasa en ella, en el mundo. */
  capa: Container;
  /** Los que siguen en carrera, ordenados por carril (el de abajo, adelante). */
  vivos: Container;
  /** Los hundidos, los aplastados y las rocas que ya cayeron, siempre detrás de los que siguen. */
  restos: Container;
  /** Las rocas mientras caen, encima de todo. */
  cayendo: Container;
  polvo: Graphics;
  /** Si el polvo quedó dibujado en el cuadro anterior: se borra solo entonces. */
  polvoSucio: boolean;
  autos: Auto[];
  /** La ola de cada persona (la que se la lleva), o `null` para quien gana. */
  ola: (Ola | null)[];
  rocas: (Roca | null)[];
  hoyos: (Hoyo | null)[];
  susto: Roca;
  /** Cuánto más atrás larga cada auto en la grilla, en el mundo: los del mismo carril, en fila. */
  grilla: number[];
  /** La escala de los autos, las rocas y los hoyos: la de la pantalla, achicada para que el auto entre en su carril. */
  a: number;
  /** Cuánto baja el piso del auto desde el centro de su carril. */
  bajo: number;
  colores: Colores;
}

const entre = (u: number): number => Math.max(0, Math.min(1, u));
const suave = (u: number): number => {
  const v = entre(u);
  return v * v * (3 - 2 * v);
};
const modulo = (a: number, m: number): number => ((a % m) + m) % m;

/* ------------------------------------------------------------------ el fondo */

/** Una cordillera que se repite cada `periodo`: picos y valles con alturas sembradas, rellena hasta abajo de la pantalla. */
function cordillera(k: Kit, g: Graphics, o: { periodo: number; ancho: number; alto: number; picos: number; pico: [number, number]; valle: [number, number]; etiqueta: string; color: number; nieve?: number; s: number }): void {
  const alturas = Array.from({ length: o.picos }, (_, j) => ({
    pico: o.pico[0] + (o.pico[1] - o.pico[0]) * k.azar(`${o.etiqueta}-pico-${j}`),
    valle: o.valle[0] + (o.valle[1] - o.valle[0]) * k.azar(`${o.etiqueta}-valle-${j}`),
  }));
  const vueltas = Math.ceil(o.ancho / o.periodo) + 1;
  const paso = o.periodo / o.picos;
  const puntos: number[] = [0, o.alto];
  const cumbres: { x: number; y: number; xi: number; yi: number; xd: number; yd: number }[] = [];
  for (let v = 0; v < vueltas; v++) {
    alturas.forEach((a, j) => {
      const x0 = v * o.periodo + j * paso;
      const sig = alturas[(j + 1) % o.picos] ?? a;
      puntos.push(x0, a.valle, x0 + paso / 2, a.pico);
      cumbres.push({ x: x0 + paso / 2, y: a.pico, xi: x0, yi: a.valle, xd: x0 + paso, yd: sig.valle });
    });
  }
  puntos.push(vueltas * o.periodo, alturas[0]?.valle ?? o.alto, vueltas * o.periodo, o.alto);
  g.poly(puntos).fill(o.color).stroke({ width: 3 * o.s, color: INK, join: "round" });
  if (o.nieve === undefined) return;
  // La nieve de las cumbres: un gorro que baja un cuarto de cada ladera, con el borde en zigzag.
  for (const c of cumbres) {
    const f = 0.26;
    const xi = c.x + (c.xi - c.x) * f, yi = c.y + (c.yi - c.y) * f;
    const xd = c.x + (c.xd - c.x) * f, yd = c.y + (c.yd - c.y) * f;
    const ym = Math.max(yi, yd);
    g.poly([c.x, c.y, xd, yd, (c.x + xd) / 2, ym - (ym - c.y) * 0.3, c.x, ym, (c.x + xi) / 2, ym - (ym - c.y) * 0.3, xi, yi])
      .fill(o.nieve)
      .stroke({ width: 2 * o.s, color: INK, join: "round" });
  }
}

/* ------------------------------------------------------------------ la ruta */

/** La ruta en el mundo: la banquina con su cordón, el asfalto con sus carriles, la grilla, la meta a cuadros y su poste. */
function dibujarRuta(g: Graphics, p: Pant, d: Datos, s: number, a: number, c: Colores, porCarril: number, paso: number): void {
  const r = pista(p);
  const xa = r.x0 - p.w * 1.5;
  const xb = r.x1 + p.w * 1.5;
  const alto = r.y1 - r.y0;
  const carril = alto / Math.max(1, d.carriles);
  const banquina = 34 * s;
  // La tierra de abajo, la banquina de pasto y el asfalto.
  g.rect(xa, r.y1, xb - xa, p.h * 2).fill(c.tierra);
  g.rect(xa, r.y0 - banquina, xb - xa, banquina).fill(c.pasto);
  g.moveTo(xa, r.y0 - banquina).lineTo(xb, r.y0 - banquina).stroke({ width: 3 * s, color: INK });
  // Los postes del costado, para que se sienta la velocidad.
  for (let x = xa; x < xb; x += 300 * s) {
    g.rect(x, r.y0 - banquina - 18 * s, 6 * s, 30 * s).fill(CREAM).stroke({ width: 2 * s, color: INK });
    g.rect(x, r.y0 - banquina - 18 * s, 6 * s, 8 * s).fill(c.cordon);
  }
  g.rect(xa, r.y0, xb - xa, alto).fill(c.asfalto).stroke({ width: 4 * s, color: INK });
  // El cordón del borde de arriba, a rayas.
  const tramo = 40 * s;
  for (let x = xa, j = 0; x < xb; x += tramo, j++) g.rect(x, r.y0 - 4 * s, tramo, 8 * s).fill(j % 2 ? CREAM : c.cordon);
  g.moveTo(xa, r.y0 + 4 * s).lineTo(xb, r.y0 + 4 * s).stroke({ width: 2 * s, color: INK });
  // Las rayas entre carriles.
  const raya = 36 * s;
  for (let k = 1; k < d.carriles; k++) {
    const y = r.y0 + carril * k;
    for (let x = xa; x < xb; x += raya * 2) g.rect(x, y - 2 * s, raya, 4 * s).fill({ color: c.raya, alpha: 0.75 });
  }
  // La grilla: un casillero por auto, detrás de la línea de largada.
  for (let k = 0; k < d.carriles; k++) {
    const yc = r.y0 + carril * (k + 0.5);
    for (let j = 0; j < porCarril; j++) {
      const x = r.x0 - j * paso;
      g.moveTo(x - 50 * a, yc - carril * 0.32).lineTo(x + 50 * a, yc - carril * 0.32).lineTo(x + 50 * a, yc + carril * 0.32).stroke({ width: 3 * s, color: c.raya, alpha: 0.85 });
    }
  }
  g.rect(r.x0 + 54 * a, r.y0, 8 * s, alto).fill(CREAM).stroke({ width: 2 * s, color: INK });
  // La meta: dos columnas de cuadros, tinta y crema, sobre la línea.
  const filas = Math.max(6, Math.round(alto / (18 * s)));
  const lado = alto / filas;
  for (let f = 0; f < filas; f++) {
    for (let col = 0; col < 2; col++) g.rect(r.x1 - lado + col * lado, r.y0 + f * lado, lado, lado).fill((f + col) % 2 ? INK : CREAM);
  }
  g.rect(r.x1 - lado, r.y0, lado * 2, alto).stroke({ width: 3 * s, color: INK });
  // El poste de la meta, con su bandera a cuadros.
  const largo = 150 * s;
  const tope = r.y0 - banquina - largo;
  g.rect(r.x1 - 4 * s, tope, 8 * s, largo + banquina).fill(CREAM).stroke({ width: 3 * s, color: INK });
  const bw = 72 * s, bh = 46 * s, cols = 4, fil = 3;
  for (let f = 0; f < fil; f++) {
    for (let col = 0; col < cols; col++) g.rect(r.x1 + 4 * s + (col * bw) / cols, tope + (f * bh) / fil, bw / cols, bh / fil).fill((f + col) % 2 ? INK : CREAM);
  }
  g.rect(r.x1 + 4 * s, tope, bw, bh).stroke({ width: 3 * s, color: INK });
  g.circle(r.x1, tope, 7 * s).fill(YELLOW).stroke({ width: 2.5 * s, color: INK });
}

/* ------------------------------------------------------------------ los autos */

/** Un auto de costado, mirando a la derecha, con el piso (la base de las ruedas) en su origen. */
function armarAuto(k: Kit, i: number, s: number): Auto {
  const { S } = k;
  const color = S.color(i);
  const linea = { width: 3 * s, color: INK, join: "round" as const };
  const raiz = new Container();
  const sombra = new Graphics().ellipse(0, 0, 52 * s, 7 * s).fill({ color: INK, alpha: 0.25 });
  const cuerpo = new Graphics()
    // El alerón de atrás.
    .roundRect(-52 * s, -50 * s, 14 * s, 12 * s, 3 * s).fill(color).stroke(linea)
    // La cabina y su ventanilla.
    .roundRect(-27 * s, -72 * s, 52 * s, 40 * s, 12 * s).fill(color).stroke(linea)
    .roundRect(-20 * s, -67 * s, 38 * s, 32 * s, 8 * s).fill(CREAM).stroke({ width: 2.5 * s, color: INK })
    // La carrocería, con una franja y el faro.
    .roundRect(-48 * s, -40 * s, 96 * s, 28 * s, 10 * s).fill(color).stroke(linea)
    .rect(-40 * s, -28 * s, 72 * s, 5 * s).fill({ color: CREAM, alpha: 0.6 })
    .circle(41 * s, -31 * s, 4.5 * s).fill(YELLOW).stroke({ width: 2 * s, color: INK });
  // La cara de la persona en la ventanilla.
  const cara = new Sprite(S.face(k.nombres[i] ?? ""));
  cara.anchor.set(0.5);
  cara.width = cara.height = 28 * s;
  cara.position.set(-1 * s, -53 * s);
  // El cuerpo y las ruedas no cambian de forma en todo el show: van como textura, una sola pieza cada uno. Con muchos
  // autos, el dibujo con sus bordes redondeados se rearmaba en cada cuadro.
  cuerpo.cacheAsTexture({ resolution: 2, antialias: true });
  const ruedas = [-30, 30].map((dx) => {
    const r = new Container();
    const llanta = new Graphics()
        .circle(0, 0, RUEDA * s).fill(0x2a2a2a).stroke({ width: 3 * s, color: INK })
        .circle(0, 0, 4.5 * s).fill(0xbdb6c4)
        // Dos marcas en la llanta, para que se vea girar.
        .rect(-1.5 * s, -RUEDA * s + 2 * s, 3 * s, 5 * s).fill(0xbdb6c4)
        .rect(-1.5 * s, RUEDA * s - 7 * s, 3 * s, 5 * s).fill(0xbdb6c4);
    llanta.cacheAsTexture({ resolution: 2, antialias: true });
    r.addChild(llanta);
    r.position.set(dx * s, -RUEDA * s);
    return r;
  });
  raiz.addChild(sombra, cuerpo, cara, ...ruedas);
  return { raiz, ruedas };
}

/** Una roca gigante, centrada en su origen, con la base chata para apoyarse. */
function armarRoca(k: Kit, etiqueta: string, s: number, c: Colores): Graphics {
  const R = RADIO_ROCA * s;
  const puntos: number[] = [];
  const lados = 9;
  for (let j = 0; j < lados; j++) {
    const a = (j / lados) * Math.PI * 2 + 0.25 * k.azar(`${etiqueta}-a-${j}`);
    const rr = R * (0.8 + 0.28 * k.azar(`${etiqueta}-r-${j}`));
    puntos.push(Math.cos(a) * rr, Math.min(R * 0.55, Math.sin(a) * rr));
  }
  return new Graphics()
    .poly(puntos).fill(c.roca).stroke({ width: 3.5 * s, color: INK, join: "round" })
    // La cara iluminada y dos grietas.
    .poly([-R * 0.5, -R * 0.35, -R * 0.1, -R * 0.7, R * 0.2, -R * 0.45, -R * 0.2, -R * 0.15]).fill(c.rocaLuz)
    .moveTo(R * 0.15, -R * 0.1).lineTo(R * 0.35, R * 0.15).lineTo(R * 0.3, R * 0.35).stroke({ width: 2.5 * s, color: INK })
    .moveTo(-R * 0.45, R * 0.1).lineTo(-R * 0.2, R * 0.3).stroke({ width: 2.5 * s, color: INK });
}

/** El alto de la roca desde su centro hasta la base chata. */
const BASE_ROCA = 0.55;

/* ------------------------------------------------------------------ el juego */

export const autosPixi = crearJuego<Datos, Escena>({
  id: "autos",
  textos: TEXTOS,
  plan: planAutos,

  arma(k, plan, previa) {
    const { S } = k;
    const d = plan.datos;
    const p = k.pantalla();
    const r = pista(p);
    // Al cambiar de tamaño se tira lo viejo y se arma todo de nuevo.
    if (previa) {
      previa.fondo.destroy({ children: true });
      previa.capa.destroy({ children: true });
    }
    // En un celular parado todo un poco más chico: nada más cambia.
    const s = p.k * (p.retrato ? 0.85 : 1);
    const c = S.dark ? PALETA.oscuro : PALETA.claro;
    const carril = (r.y1 - r.y0) / Math.max(1, d.carriles);
    // Con muchos carriles el auto se achica para caber en el suyo (nunca menos del 62 %): si no, quedaban apilados como una torre.
    const a = s * Math.max(0.62, Math.min(1, carril / (56 * s)));
    const bajo = Math.min(30 * a, carril * 0.45);

    /* El cielo y la cordillera, fijos a la pantalla: la cámara solo los corre un poco (paralaje). */
    // Un grupo propio: lo que se mueve en la ruta no obliga a rearmar el cielo.
    const fondo = new Container({ isRenderGroup: true });
    const horizonte = Math.max(p.top * 0.8, r.y0 - 34 * s);
    const cielo = new Graphics().rect(0, 0, p.w, p.h).fill(c.cielo);
    cielo.circle(p.w * 0.8, horizonte * 0.38, Math.max(10 * s, Math.min(32 * s, horizonte * 0.22))).fill(c.sol).stroke({ width: 3 * s, color: INK });
    const periodo = Math.max(320 * s, p.w * 0.75);
    const lejos = new Graphics();
    cordillera(k, lejos, { periodo, ancho: p.w, alto: p.h, picos: 3, pico: [horizonte * 0.1, horizonte * 0.4], valle: [horizonte * 0.55, horizonte * 0.75], etiqueta: "lejos", color: c.lejos, nieve: c.nieve, s });
    const cerca = new Graphics();
    cordillera(k, cerca, { periodo, ancho: p.w, alto: p.h, picos: 4, pico: [horizonte * 0.45, horizonte * 0.7], valle: [horizonte * 0.82, horizonte * 0.95], etiqueta: "cerca", color: c.cerca, s });
    fondo.addChild(cielo, lejos, cerca);
    S.bg.addChildAt(fondo, 0);

    /* La grilla: los del mismo carril largan en fila, el que va a ir más adelante primero. */
    const filas = Array.from({ length: d.carriles }, (_, cc) =>
      d.carril.flatMap((x, i) => (x === cc ? [i] : [])).sort((a, b) => (d.ventaja[b] ?? 0) - (d.ventaja[a] ?? 0) || a - b),
    );
    const porCarril = Math.max(1, ...filas.map((f) => f.length));
    const paso = Math.min(PASO_GRILLA * a, (p.w * 0.42) / Math.max(1, porCarril - 1));
    const grilla = new Array<number>(d.n).fill(0);
    for (const f of filas) f.forEach((i, j) => (grilla[i] = -j * paso));

    /* La ruta y las capas, en el mundo. */
    const capa = new Container();
    const ruta = new Graphics();
    dibujarRuta(ruta, p, d, s, a, c, porCarril, paso);
    const capaHoyos = new Container();
    const restos = new Container();
    restos.sortableChildren = true;
    const vivos = new Container();
    vivos.sortableChildren = true;
    const cayendo = new Container();
    const polvo = new Graphics();
    // La ruta no cambia en todo el show: va en un grupo propio, así lo que se mueve no la vuelve a armar en cada cuadro.
    const fija = new Container({ isRenderGroup: true });
    fija.addChild(ruta);
    capa.addChild(fija, capaHoyos, restos, vivos, cayendo, polvo);
    S.scene.addChild(capa);

    const autos = Array.from({ length: d.n }, (_, i) => armarAuto(k, i, a));
    const ola: (Ola | null)[] = Array.from({ length: d.n }, (_, i) => d.olas.find((o) => o.victimas.includes(i)) ?? null);
    const piso = (i: number, t: number): { x: number; y: number } => {
      const q = posicionDe(p, d, i, t);
      return { x: q.x, y: q.y + bajo };
    };

    /* Una roca por cada aplastado, sobre el lugar donde se queda; un hoyo por cada hundido. */
    const rocas: (Roca | null)[] = ola.map((o, i) => {
      if (!o || o.tipo !== "roca") return null;
      const q = piso(i, o.t);
      return { g: armarRoca(k, `roca-${i}`, a, c), x: q.x, piso: q.y - ALTO_AUTO * APLASTADO * a * 0.8, t: o.t, giro: k.azar(`giro-${i}`) < 0.5 ? -1 : 1, z: q.y * 2 + 1 };
    });
    const hoyos: (Hoyo | null)[] = ola.map((o, i) => {
      if (!o || o.tipo !== "hoyo") return null;
      const q = piso(i, o.t);
      const y = q.y + 2 * a;
      const g = new Graphics()
        .ellipse(0, 0, 64 * a, 15 * a).fill(c.borde).stroke({ width: 3 * a, color: INK })
        .ellipse(0, 2 * a, 55 * a, 10.5 * a).fill(c.pozo);
      g.position.set(q.x, y);
      capaHoyos.addChild(g);
      // Lo que se hunde por debajo del borde del hoyo no se ve: la máscara tapa todo lo de abajo de la línea.
      const pozo = new Container();
      const mascara = new Graphics().rect(q.x - 120 * a, y - p.h * 3, 240 * a, p.h * 3).fill(0xffffff);
      pozo.addChild(mascara);
      pozo.mask = mascara;
      pozo.zIndex = y * 2;
      restos.addChild(pozo);
      return { g, pozo, x: q.x, y, t: o.t };
    });

    /* La roca del susto: cae entre el carril de quien gana y el de al lado, un poco adelante, sin tapar a nadie. */
    const cg = d.carril[d.ganador] ?? 0;
    const borde = d.carriles <= 1 ? r.y0 : r.y0 + carril * (cg >= 1 ? cg : 1);
    const pisoSusto = borde + bajo;
    let xs = piso(d.ganador, d.susto.t).x + 120 * a;
    const R = RADIO_ROCA * a;
    for (let vuelta = 0; vuelta < 12; vuelta++) {
      const choca = Array.from({ length: d.n }, (_, i) => i).find((i) => {
        const sal = salidaDe(d, i);
        if (sal !== null && sal <= d.susto.t) return false;
        const q = piso(i, d.susto.t);
        return Math.abs(q.y - pisoSusto) < carril * 0.9 && Math.abs(q.x - xs) < R + 52 * a;
      });
      if (choca === undefined) break;
      xs = piso(choca, d.susto.t).x + R + 60 * a;
    }
    const susto: Roca = { g: armarRoca(k, "susto", a, c), x: xs, piso: pisoSusto, t: d.susto.t, giro: 1, z: pisoSusto * 2 + 1 };

    // La cámara parte de la grilla, sin viajar: el director sigue desde ahí.
    k.cam.cut(r.x0 - (porCarril - 1) * paso * 0.5, (r.y0 + r.y1) / 2, 1);
    return { fondo, lejos, cerca, periodo, capa, vivos, restos, cayendo, polvo, polvoSucio: false, autos, ola, rocas, hoyos, susto, grilla, a, bajo, colores: c };
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const { S } = k;
    const p = k.pantalla();
    const r = pista(p);
    // Todo lo que se mueve en el cuadro va a la escala del auto.
    const s = e.a;

    // La cordillera se corre con la cámara, más lento la de atrás: la ruta pasa y los cerros quedan.
    e.lejos.x = -modulo(k.cam.x * 0.12, e.periodo);
    e.cerca.x = -modulo(k.cam.x * 0.3, e.periodo);

    const suelta = suave((t - d.tLargada) / SUELTA_GRILLA);
    /** Dónde va el nombre de cada uno, en el mundo: arriba del auto, de la roca o del hoyo. */
    const cabeza: ({ x: number; y: number } | null)[] = new Array(d.n).fill(null);
    if (e.polvoSucio) e.polvo.clear();
    e.polvoSucio = false;

    for (let i = 0; i < d.n; i++) {
      const a = e.autos[i] as Auto;
      const o = e.ola[i] ?? null;
      const q = posicionDe(p, d, i, t);
      let x = q.x + (e.grilla[i] ?? 0) * (1 - suelta);
      let y = q.y + e.bajo;
      let giro = (x - r.x0) / (RUEDA * s);
      let rot = 0;
      let sx = 1;
      let sy = 1;
      let capa: Container = e.vivos;
      const cayo = o !== null && t >= o.t;

      if (t < d.tLargada) {
        // En la grilla, el motor en marcha: un temblor chiquito.
        y += Math.sin(t * 58 + i * 1.7) * 0.8 * s;
      } else if (!cayo) {
        // En carrera, un rebote suave con el camino.
        y -= Math.abs(Math.sin(x / (37 * s) + i)) * 1.6 * s;
      }

      // El susto: la roca roza, el auto se sacude, frena un poco y recupera.
      if (d.susto.rozados.includes(i) && t >= d.susto.t && t < d.susto.t + SUSTO) {
        const u = (t - d.susto.t) / SUSTO;
        const f = 1 - u;
        x += Math.sin(t * 71 + i * 3) * 4 * s * f;
        x -= 12 * s * (u < 0.2 ? u / 0.2 : 1 - suave((u - 0.2) / 0.8));
        rot += Math.sin(t * 43 + i) * 0.11 * f;
        giro = (x - r.x0) / (RUEDA * s);
      }

      if (o && cayo) {
        if (o.tipo === "roca") {
          // Bajo la roca: chato y un poco más ancho, con la roca encima.
          sy = APLASTADO;
          sx = 1.08;
          capa = e.restos;
          const roca = e.rocas[i];
          cabeza[i] = { x, y: (roca?.piso ?? y) - RADIO_ROCA * s * (1 + BASE_ROCA) - 4 * s };
        } else {
          // En el hoyo: se hunde de trompa, se achica y queda asomando el techo.
          const h = e.hoyos[i] as Hoyo;
          const u = suave((t - o.t) / HUNDE);
          const fondo = ALTO_AUTO * 0.75 * s - 12 * s;
          y += u * fondo;
          rot += u * 0.22;
          sx = sy = 1 - 0.25 * u;
          capa = h.pozo;
          cabeza[i] = { x, y: h.y - 16 * s };
        }
      }

      if (i === d.ganador) {
        // Pasada la meta, las ruedas siguen girando; con el golpe, quien gana crece.
        if (t > d.duracion) giro += (t - d.duracion) * 9;
        if (k.coronado) sx = sy = 1.3;
      }
      // El orden va por carril, fijo: con el rebote en el orden, la capa se reordenaba (y se rearmaba) en cada cuadro.
      a.raiz.zIndex = (q.y + e.bajo) * 2;
      if (a.raiz.parent !== capa) capa.addChild(a.raiz);
      a.raiz.position.set(x, y);
      a.raiz.rotation = rot;
      a.raiz.scale.set(sx, sy);
      for (const rd of a.ruedas) rd.rotation = giro;
      if (!cabeza[i]) cabeza[i] = { x, y: y - ALTO_AUTO * s * sy - 4 * s };
    }

    // Los hoyos se abren en los 0,6 s antes de la ola, bajo el auto que llega.
    for (const h of e.hoyos) {
      if (!h) continue;
      const u = (t - (h.t - ABRE_HOYO)) / ABRE_HOYO;
      h.g.visible = u > 0;
      const v = suave(u);
      h.g.scale.set(v * (1 + 0.12 * Math.sin(Math.PI * v)), v);
      h.pozo.visible = t >= h.t;
    }

    // Las rocas: caen desde arriba de la pantalla, aterrizan con polvo y se quedan.
    const roca = (rc: Roca): void => {
      const t0 = rc.t - CAE_ROCA;
      if (t < t0) {
        rc.g.visible = false;
        return;
      }
      rc.g.visible = true;
      const u = entre((t - t0) / CAE_ROCA);
      const yFin = rc.piso - RADIO_ROCA * s * BASE_ROCA;
      const yIni = yFin - p.h * 1.4;
      rc.g.position.set(rc.x, yIni + (yFin - yIni) * u * u);
      rc.g.rotation = (1 - u) * 1.3 * rc.giro;
      const capa = t < rc.t ? e.cayendo : e.restos;
      rc.g.zIndex = rc.z;
      if (rc.g.parent !== capa) capa.addChild(rc.g);
      if (t >= rc.t && t < rc.t + POLVO) {
        const v = (t - rc.t) / POLVO;
        const abre = RADIO_ROCA * s + v * 34 * s;
        for (const f of [-1, -0.45, 0.45, 1]) {
          e.polvoSucio = true;
          e.polvo.circle(rc.x + f * abre, rc.piso - 6 * s - v * 12 * s, (8 + 16 * v) * s).fill({ color: e.colores.polvo, alpha: 0.8 * (1 - v) });
        }
      }
    };
    for (const rc of e.rocas) if (rc) roca(rc);
    roca(e.susto);

    // Los nombres. En la grilla, todos: cada uno se busca. En carrera, de a tandas que rotan entre los que siguen (de a
    // ocho, cinco en un celular), y siempre los que acaban de caer, donde cayeron. En la recta final, los que quedan.
    // Todos a la vez se apilaban lejos de su auto.
    const todos = Array.from({ length: d.n }, (_, i) => i);
    const enCarrera = todos.filter((i) => {
      const sal = salidaDe(d, i);
      return sal === null || t < sal;
    });
    const recien = todos.filter((i) => {
      const sal = salidaDe(d, i);
      return sal !== null && t >= sal - 0.4 && t < sal + 2.5;
    });
    const tope = p.retrato ? 5 : 8;
    const ultima = d.olas.at(-1)?.t ?? d.duracion;
    let quienes: number[];
    if (k.coronado) quienes = [d.ganador];
    else if (t < d.tLargada) quienes = d.n <= 24 ? todos : S.batch(d.n, t, 0, d.tLargada, undefined, 12);
    else if (enCarrera.length <= tope || t >= ultima - 1.5) quienes = [...new Set([...enCarrera, ...recien])];
    else {
      const sueltos = enCarrera.filter((i) => !recien.includes(i));
      const tandas = Math.max(1, Math.ceil(sueltos.length / Math.max(1, tope - recien.length)));
      const turno = Math.floor((t - d.tLargada) / 1.6) % tandas;
      quienes = [...recien, ...sueltos.filter((_, j) => j % tandas === turno)];
    }
    S.tags(k.nombres as string[], quienes, (i) => {
      const c = cabeza[i];
      if (!c) return null;
      const sp = k.cam.toScreen(c.x, c.y, p.w, p.h);
      if (sp.x < -20 * s || sp.x > p.w + 20 * s || sp.y < -40 * s || sp.y > p.h + 40 * s) return null;
      return sp;
    });
  },
});
