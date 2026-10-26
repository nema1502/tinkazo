import { LEGIBLE } from "../pixi/letra";
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { T, getLang } from "../../i18n";
import { beep, note } from "../../sound";
import { vibrar } from "../../vibrar";
import { emblemasDe, type Emblema } from "../emblemas";
import { ajustar, mediana, nivelBase, nivelesDe, nivelPorCantidad, planNombres, type Nivel, type PlanNombres } from "../nombres";
import { CREAM, INK, MONO, YELLOW, hash, seeded, type PixiStage } from "../pixi/stage";
import { ANUNCIO, AVISO, FINALISTAS, type PlanPeloton, type Terreno } from "./peloton-plan";
import { disponerPeloton, reasignarCeldas, zonaPeloton, type Disposicion, type Lugar } from "./peloton-forma";

/**
 * El pelotón de la carrera, dibujado: todos salen juntos y se van echando.
 *
 * Es la escena de antes de la final cuando hay de 9 a 30 personas. El plan
 * (`peloton-plan.ts`) dice quién se echa y cuándo; acá solo se mira. Todo es
 * función del reloj del juego (`t`, en segundos desde la largada): no se
 * acumula nada cuadro a cuadro, así que saltar o cambiar el tamaño de la
 * ventana no cambia lo que se cuenta.
 *
 * Cómo se ve: la cámara queda quieta y es el suelo el que corre (el pelotón
 * corre en el lugar, la cordillera y la tribuna se desplazan hacia atrás).
 * Cada llama lleva encima su ficha: el emblema de la persona y, según cuántas
 * quedan, su inicial, su nombre, su nombre con la inicial del apellido o el
 * nombre entero (`nombres.ts`). Todas suben de nivel a la vez. Al echarse, la
 * ficha se agranda con el nombre entero, la llama se echa y la persona pasa a
 * la tribuna, con su emblema, a alentar. Cuando quedan ocho, los ocho van a
 * los carriles de la final.
 *
 * Los textos de la escena van en el HUD (`S.hud`), no en la escena: la
 * cámara de la final y el sacudón no los tocan.
 */

export interface LlamaPelo {
  root: Container;
  mark: Text;
  pose(ph: number, speed: number, beat: { kind: string; p: number } | null, now: number): void;
}

export interface Geo {
  sw: number;
  sh: number;
  u: number;
  portrait: boolean;
  trackTop: number;
  trackBot: number;
}

export interface Anfitrion {
  S: PixiStage;
  names: string[];
  plan: PlanPeloton;
  /** Los finalistas por carril: a cuál va cada uno cuando el pelotón se abre. */
  lanes: number[];
  /** El número de la ronda, para sembrar los emblemas. */
  ronda: string;
  dark: boolean;
  geo(): Geo;
  llama(persona: number, sc: number, manta: number, dorsal: string): LlamaPelo;
  /** Dónde cae en pantalla el cartel con el nombre del carril `k` de la final (el medio de su borde izquierdo). */
  destino(k: number): { x: number; y: number } | null;
  /**
   * El dibujo del emblema de una persona (la ficha entera: borde, aro, papel y
   * dibujo) en un lienzo cuadrado de `lado` píxeles, o `null` si todavía no
   * está disponible: entonces se usa la cara de siempre con el color del emblema.
   */
  emblema?: (e: Emblema, lado: number) => HTMLCanvasElement | null;
  /** Cuándo entra a la pista el carril `k`, en segundos de la presentación. */
  laneAt(k: number): number;
  decir(msg: string, heat: number): void;
  /**
   * Lo que ya sonó y ya se dijo. Lo guarda quien crea el pelotón, porque con un
   * cambio de tamaño (girar el celular) el pelotón se arma de nuevo y, sin esto,
   * volvería a decir y a sonar todo lo que ya pasó.
   */
  dicho: Set<string>;
}

export interface Peloton {
  /** La escena: va dentro de `S.scene`. */
  escena: Container;
  /** Lo que se ve encima, en pantalla: fichas, tribuna, contador. Va dentro de `S.hud`. */
  hud: Container;
  /** Cuánto corrió el suelo, en píxeles: la cordillera y la tribuna se corren con esto. */
  suelo(t: number): number;
  /** Los sonidos y los subtítulos que tocan en `t`. */
  actualizar(t: number): void;
  /** Pone todo en su lugar a la hora `t`. `now` es el reloj de la página, para lo que se menea solo. */
  dibujar(t: number, now: number): void;
  /** Si todavía hay algo que mostrar a la hora `t`. */
  vivo(t: number): boolean;
}

const TERRENO_COLOR: Record<Terreno | "libre", { claro: number; oscuro: number }> = {
  libre: { claro: 0xb98552, oscuro: 0x3d2b22 },
  cuesta: { claro: 0xb4895a, oscuro: 0x3a2c24 },
  barro: { claro: 0x7a5535, oscuro: 0x2c1e17 },
  piedras: { claro: 0x9a8e7e, oscuro: 0x3b3835 },
  viento: { claro: 0xcaa271, oscuro: 0x4b382d },
};
const VELOCIDAD: Record<Terreno | "libre", number> = { libre: 1, cuesta: 0.85, barro: 0.7, piedras: 1, viento: 1.3 };
const TERRENOS: Terreno[] = ["cuesta", "barro", "piedras", "viento"];

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const suave = (v: number): number => {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
};
const salida = (v: number): number => 1 - (1 - clamp01(v)) ** 3;
const mezclaColor = (a: number, b: number, k: number): number => {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, k);
  const g = lerp((a >> 8) & 255, (b >> 8) & 255, k);
  const bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
const hexAInt = (h: string): number => parseInt(h.replace("#", ""), 16);

interface Ficha {
  caja: Container;
  /** Cuánto mide entera en pantalla, a escala 1 (la de la ficha grande ya va incluida). */
  w: number;
  h: number;
  /** La escala con que se armó: la grande es más grande que la chica. */
  k: number;
}

/** Cuánto tarda el pelotón en cerrar filas cuando alguien se echa. */
const CIERRA = 0.9;
/** Cuánto dura el cartel grande de quien se echó. */
const GRANDE = 1.8;
/** Cuánto tarda en ir a la tribuna. */
const VUELO = 0.6;

export function crearPeloton(h: Anfitrion): Peloton {
  const { S, plan, names } = h;
  const n = names.length;
  const g = h.geo();
  const { sw, sh, u, portrait } = g;
  const L = T[getLang()];

  const emb = emblemasDe(names, h.ronda);
  const anillo = (p: number): number => hexAInt(emb[p]?.color ?? "#e93d9c");
  /** La cara de cada uno: su emblema dibujado, o la de siempre si el dibujo no llegó. */
  const texturas: Texture[] = [];
  const memoTex = new Map<string, { tex: Texture; emblema: boolean }>();
  const caraDe = (p: number, lado: number): { tex: Texture; emblema: boolean } => {
    const potencia = lado <= 40 ? 64 : lado <= 90 ? 128 : 256;
    const key = `${p}|${potencia}`;
    let hit = memoTex.get(key);
    if (!hit) {
      const e = emb[p];
      const lienzo = e && h.emblema ? h.emblema(e, potencia) : null;
      if (lienzo) {
        const tex = new Texture({ source: new CanvasSource({ resource: lienzo, autoGenerateMipmaps: true, scaleMode: "linear" }) });
        texturas.push(tex);
        hit = { tex, emblema: true };
      } else hit = { tex: S.face(names[p] ?? ""), emblema: false };
      memoTex.set(key, hit);
    }
    return hit;
  };
  S.onCleanup(() => {
    for (const tx of texturas) tx.destroy(true);
    texturas.length = 0;
  });
  const pn: PlanNombres = planNombres(names);

  /* ---------------------------------------------------------- las fases */
  const evs = plan.eventos;
  /** Quiénes siguen después de cada echada: `viv[0]` es el pelotón entero. */
  const viv: number[][] = [plan.orden.slice()];
  evs.forEach((e, i) => viv.push((viv[i] as number[]).filter((p) => !e.personas.includes(p))));
  /** En qué echada cae cada uno (su lugar en `viv` justo antes de caer es `evDe`). */
  const evDe = new Map<number, number>();
  evs.forEach((e, i) => e.personas.forEach((p) => evDe.set(p, i)));
  const caeDe = (p: number): number => plan.cae[p] as number;
  /** Cuántos siguen en cada estado, para que el contador coincida con el plan. */
  const estadoEn = (t: number): number => {
    let j = 0;
    while (j < evs.length && (evs[j] as { t: number }).t <= t) j++;
    return j;
  };
  const tCambio = (j: number): number => (j > 0 ? (evs[j - 1] as { t: number }).t : -Infinity);

  /* ---------------------------------------------------------------- los textos */
  // Nada por debajo de 13 px en el celular ni de 12 en una pantalla baja: la
  // `letra` de la escena se achica con la altura y un celular girado quedaba en 8.
  const fs = Math.max(S.letra(LEGIBLE.sec), portrait ? 16 : 14);
  const medidor = S.text("", { fontSize: fs, fontWeight: "800", fill: INK });
  const anchos = new Map<string, number>();
  const medir = (s: string): number => {
    let v = anchos.get(s);
    if (v === undefined) {
      medidor.text = s;
      v = medidor.width;
      anchos.set(s, v);
    }
    return v;
  };
  const cara = Math.round(fs * 1.45);
  const relleno = Math.max(4, 5 * u);

  /** El texto de una persona en un nivel, con el ordinal si se repite. */
  const texto = (p: number, nv: Nivel): string => (pn.formas[p] as readonly string[])[nv - 1] as string;
  /** Lo ancho que queda la ficha de `p` en el nivel `nv` sin achicar. */
  const anchoFicha = (p: number, nv: Nivel): number => cara + relleno * 3 + medir(texto(p, nv));

  /* ------------------------------------------------------- la zona y la forma */
  /**
   * Dónde va el pelotón. En vertical (y en una pantalla baja, un celular
   * girado) usa todo el alto: la tribuna de los que se echan pasa a ser una o
   * dos filas arriba de todo, la valla baja justo debajo, y el suelo ocupa el
   * resto hasta el relator, tapando la tribuna del estadio. En una pantalla
   * ancha y alta queda como la pista de siempre, con la tribuna detrás.
   */
  const echados = [...evs.flatMap((e) => e.personas)];
  const zona = zonaPeloton({ sw, sh, u, portrait, top: S.top(), trackTop: g.trackTop, trackBot: g.trackBot, echados: echados.length });
  const { compacto, filasTrib, porFila, lado, pasoFila, triY, banda0, banda1, piesMin, piesMax, sTope } = zona;

  const medianaDe = (vs: readonly number[], nv: Nivel): number => mediana(vs.map((p) => anchoFicha(p, nv)));
  const disponer = (v: readonly number[]): Disposicion =>
    disponerPeloton({ m: v.length, sw, u, piesMin, piesMax, sTope, necesita: medianaDe(v, nivelPorCantidad(v.length)) + 4 * u });
  /** La disposición de cada estado: `disp[j]` es la de los `viv[j]` que siguen. */
  const disp: Disposicion[] = viv.map((v) => disponer(v));
  /**
   * En qué celda de `disp[j]` está cada uno de los que siguen en el estado `j`. Al echarse alguien cada uno
   * se queda en su celda y solo se mueven las que perdieron la suya (`reasignarCeldas`): por el orden de la
   * lista, todas las de atrás corrían un lugar y las puntas de fila cruzaban el pelotón entero a cada echada.
   * La celda de partida es la del orden sembrado (`plan.orden`): no tiene nada que ver con quién gana.
   */
  const celda: Map<number, number>[] = [new Map((viv[0] as number[]).map((p, i) => [p, i]))];
  for (let j = 1; j < viv.length; j++) {
    const v = viv[j] as number[];
    const previa = celda[j - 1] as Map<number, number>;
    const nuevas = reasignarCeldas(v.map((p) => previa.get(p) as number), disp[j - 1] as Disposicion, disp[j] as Disposicion);
    celda.push(new Map(v.map((p, i) => [p, nuevas[i] as number])));
  }

  /** Para cada estado: el nivel base y el de cada uno de los que siguen. */
  const niveles: Map<number, Nivel>[] = [];
  const bases: Nivel[] = [];
  viv.forEach((v, j) => {
    const m = v.length;
    const d = disp[j] as Disposicion;
    const lugar = d.cellW - 4 * u;
    const med = (nv: Nivel): number => medianaDe(v, nv);
    const previo = bases[j - 1] ?? 1;
    const b = Math.max(previo, nivelBase(m, lugar, med)) as Nivel;
    bases.push(b);
    const nvs = nivelesDe(pn, v, b);
    niveles.push(new Map(v.map((p, i) => [p, nvs[i] as Nivel])));
  });

  const fichas = new Map<string, Ficha>();
  const ficha = (p: number, nv: Nivel, grande: boolean, celda = 0): Ficha => {
    const key = `${p}|${nv}|${grande ? 1 : 0}|${grande ? 0 : Math.round(celda)}`;
    const hit = fichas.get(key);
    if (hit) return hit;
    const k = grande ? 1.55 : 1;
    const maxW = grande ? Math.min(sw * 0.84, 560 * u) : Math.max(48 * u, celda - 4 * u);
    const nombre = texto(p, nv);
    const aj = ajustar(nombre, Math.max(40 * u, (maxW - (cara + relleno * 3) * k) / k), medir, 0.72);
    const caja = new Container();
    const tx = S.text(aj.lineas.join("\n"), { fontSize: fs, fontWeight: "800", fill: INK, align: "left", lineHeight: fs * 1.12 });
    tx.scale.set(aj.escala);
    const lado = cara;
    const alto = Math.max(lado + relleno * 2, tx.height + relleno * 2);
    const ancho = lado + relleno * 3 + tx.width;
    const fondo = new Graphics()
      .roundRect(2.5 * u, 2.5 * u, ancho, alto, 6 * u).fill({ color: INK, alpha: 0.9 })
      .roundRect(0, 0, ancho, alto, 6 * u).fill(h.dark ? CREAM : 0xffffff).stroke({ width: 2 * u, color: INK });
    const cd = caraDe(p, lado * k * Math.max(1, window.devicePixelRatio || 1));
    // El emblema ya trae su borde, su aro y su papel; la cara de siempre lleva el aro aparte.
    const rostro = new Sprite(cd.tex);
    if (cd.emblema) {
      rostro.width = rostro.height = lado;
      rostro.position.set(relleno, (alto - lado) / 2);
    } else {
      rostro.width = rostro.height = lado - 4 * u;
      rostro.position.set(relleno + 2 * u, (alto - lado) / 2 + 2 * u);
    }
    tx.position.set(relleno * 2 + lado, (alto - tx.height) / 2);
    caja.addChild(fondo, rostro);
    if (!cd.emblema) caja.addChild(new Graphics().rect(relleno, (alto - lado) / 2, lado, lado).stroke({ width: 3 * u, color: anillo(p) }));
    caja.addChild(tx);
    caja.pivot.set(ancho / 2, alto);
    caja.scale.set(k);
    const f: Ficha = { caja, w: ancho * k, h: alto * k, k };
    fichas.set(key, f);
    return f;
  };

  /**
   * Las fichas se arman antes de que hagan falta. Armar una es rasterizar un
   * texto, y con todo el pelotón subiendo de nivel a la vez eran treinta en un
   * cuadro: en un celular lento, un tirón justo cuando cambia lo que se lee.
   * Las del primer estado se arman al crear el pelotón (con la tarjeta de
   * "cómo se juega" todavía arriba) y las demás, de a pocas por cuadro, en el
   * orden en que se van a usar.
   */
  const cola: (() => void)[] = [];
  viv.forEach((v, j) => {
    const d = disp[j] as Disposicion;
    for (const p of v) cola.push(() => ficha(p, (niveles[j] as Map<number, Nivel>).get(p) ?? 1, false, d.cellW));
    const e = evs[j];
    if (e) for (const p of e.personas) cola.push(() => ficha(p, 4, true));
  });
  let hecho = 0;
  const precalentar = (cuantas: number): void => {
    for (let i = 0; i < cuantas && hecho < cola.length; i++) (cola[hecho++] as () => void)();
  };
  precalentar(n + 4);

  /* ------------------------------------------------------------ la escena */
  const escena = new Container();
  const suelo = new Graphics().rect(-sw, banda0 - 6 * u, sw * 3, sh * 2).fill(0xffffff);
  const valla = new Graphics();
  const decorado: Record<string, Graphics> = {};
  for (const k of ["libre", ...TERRENOS]) {
    decorado[k] = new Graphics();
  }
  const manada = new Container();
  manada.sortableChildren = true;
  const polvo = new Graphics();
  escena.addChild(suelo, valla, decorado.libre as Graphics);
  for (const k of TERRENOS) escena.addChild(decorado[k] as Graphics);
  escena.addChild(polvo, manada);

  /** Los objetos del decorado de cada terreno: dónde van, de qué tamaño. */
  const sembrado = seeded(0x5eed1234 ^ n);
  const piezas: Record<string, { gx: number; fy: number; z: number; v: number }[]> = {};
  for (const k of ["libre", ...TERRENOS]) {
    const cuantos = k === "libre" ? 34 : k === "viento" ? 30 : 22;
    piezas[k] = Array.from({ length: cuantos }, (_, i) => ({ gx: (i + sembrado() * 0.8) / cuantos, fy: sembrado(), z: 0.6 + sembrado() * 0.8, v: sembrado() }));
  }

  const ciclo = sw * 1.6;
  /** Cuánto corre el suelo a la altura `fy` de la banda (0 arriba, 1 abajo): lo de abajo corre más rápido. */
  const prof = (fy: number): number => 0.55 + 0.7 * fy;

  const llamas = new Map<number, LlamaPelo>();
  const fase = (p: number): number => hash(p, 11) * 6.28;
  for (let p = 0; p < n; p++) {
    const l = h.llama(p, 1, anillo(p), (pn.inicial[p] as string) || "?");
    // Fuera de la pantalla pero dibujada: el primer dibujo (que hace la tarjeta de "cómo se
    // juega", con el estadio todavía escondido) arma sus formas, y no el primer cuadro del show.
    l.root.position.set(-9999, 0);
    llamas.set(p, l);
    manada.addChild(l.root);
  }

  /* ---------------------------------------------------------------- el HUD */
  const hud = new Container();
  const capaFichas = new Container();
  capaFichas.sortableChildren = true;
  // Las fichas ya armadas, fuera de la pantalla y casi transparentes: así sus texturas suben a la placa
  // en el primer dibujo, con la tarjeta arriba, y no en el primer cuadro del show.
  for (const f of fichas.values()) {
    f.caja.position.set(-9999, 0);
    f.caja.alpha = 0.01;
    capaFichas.addChild(f.caja);
  }
  const tribuna = new Container();
  const contador = S.text("", { fontFamily: MONO, fontSize: S.letra(LEGIBLE.sec), fontWeight: "800", fill: CREAM });
  const contadorFondo = new Graphics();
  const cajaContador = new Container();
  cajaContador.addChild(contadorFondo, contador);
  cajaContador.position.set(12 * u, S.top() + (portrait ? 8 : 12) * u);
  const titulo = S.text("", {
    fontSize: (portrait ? 34 : 46) * u, fontWeight: "900", fill: YELLOW,
    stroke: { color: INK, width: 8 * u }, letterSpacing: 2 * u,
    dropShadow: { color: INK, distance: 5 * u, angle: Math.PI / 4, blur: 0, alpha: 1 },
  });
  titulo.anchor.set(0.5);
  titulo.position.set(sw / 2, compacto ? piesMin - 56 * u : S.top() + (portrait ? 78 : 92) * u);
  titulo.alpha = 0;
  // En el modo compacto la tribuna está sobre el cielo y la cordillera: una franja oscura detrás para que los emblemas se lean.
  const franja = new Graphics();
  if (compacto) franja.rect(0, S.top() + 30 * u, sw, banda0 - 14 * u - (S.top() + 30 * u)).fill({ color: INK, alpha: 0.5 });
  hud.addChild(franja, tribuna, capaFichas, cajaContador, titulo);

  /** La tribuna: un lugar por cada uno que se echa, de izquierda a derecha en el orden en que se echan. */
  const iconos = new Map<number, Container>();
  const lugarTribuna = (i: number): { x: number; y: number } => {
    const fila = Math.floor(i / porFila), col = i % porFila;
    const enFila = fila === filasTrib - 1 ? echados.length - fila * porFila : porFila;
    const paso = Math.min(lado * 1.18, (sw * 0.92) / Math.max(1, porFila));
    return { x: sw / 2 - (paso * enFila) / 2 + paso * (col + 0.5), y: triY + fila * pasoFila };
  };
  for (const p of echados) {
    const ic = new Container();
    const cd = caraDe(p, lado * Math.max(1, window.devicePixelRatio || 1));
    const cuadro = new Graphics().rect(-lado / 2 - 2 * u, -lado - 2 * u, lado + 4 * u, lado + 4 * u).fill(INK);
    const rostro = new Sprite(cd.tex);
    rostro.width = rostro.height = lado;
    rostro.position.set(-lado / 2, -lado);
    const aro = new Graphics();
    if (!cd.emblema) aro.rect(-lado / 2, -lado, lado, lado).stroke({ width: 3 * u, color: anillo(p) });
    const ini = S.text(pn.inicial[p] ?? "?", { fontSize: Math.max(10, lado * 0.62), fontWeight: "900", fill: CREAM, stroke: { color: INK, width: Math.max(3, lado * 0.2) } });
    ini.anchor.set(0.5);
    ini.position.set(0, lado * 0.32);
    ic.addChild(cuadro, rostro, aro, ini);
    ic.position.set(-9999, 0);
    tribuna.addChild(ic);
    iconos.set(p, ic);
  }

  /* ----------------------------------------------- el corrimiento del suelo */
  const BASE = 205 * u;
  const factorEn = (t: number): number => {
    const tr = plan.tramos.find((x) => t >= x.t0 && t < x.t1);
    return tr ? (VELOCIDAD[tr.terreno] as number) : 1;
  };
  const corrido = (t: number): number => {
    let s = 0;
    let desde = 0;
    const tramos = [{ t0: 0, t1: plan.intro, f: 1 }, ...plan.tramos.map((x) => ({ t0: x.t0, t1: x.t1, f: VELOCIDAD[x.terreno] as number })), { t0: plan.fin, t1: Infinity, f: 1 }];
    for (const x of tramos) {
      desde = Math.max(desde, x.t0);
      const hasta = Math.min(t, x.t1);
      if (hasta > desde) s += BASE * x.f * (hasta - desde);
      desde = Math.max(desde, x.t1);
    }
    return s;
  };

  const pesoTerreno = (k: Terreno, t: number): number => {
    const tr = plan.tramos.find((x) => x.terreno === k);
    if (!tr) return 0;
    return suave((t - (tr.t0 - 0.3)) / 0.9) * (1 - suave((t - (tr.t1 - 0.3)) / 0.9));
  };

  /* ------------------------------------------------- los eventos (sonido y relato) */
  const dicho = h.dicho;
  const una = (id: string, at: number, t: number, fn: () => void): void => {
    if (t >= at && !dicho.has(id)) {
      dicho.add(id);
      fn();
    }
  };
  const calor = (quedan: number): number => 0.3 + 0.45 * (1 - (quedan - FINALISTAS) / Math.max(1, n - FINALISTAS));
  const subTerreno = (k: Terreno): string => (k === "cuesta" ? L.pelSubCuesta : k === "barro" ? L.pelSubBarro : k === "piedras" ? L.pelSubPiedras : L.pelSubViento);

  let ultimoCasco = -1;
  function actualizar(t: number): void {
    una("ini", 0.2, t, () => {
      h.decir(L.pelStart(n, FINALISTAS), 0.35);
      // La campanita con que entra la tabla, como en la clasificatoria: sin ella, entre el
      // último número de la tarjeta y la primera echada pasaban más de cuatro segundos sin un
      // efecto (lo marca el auditor de sonido).
      [10, 12, 15].forEach((d, i) => setTimeout(() => beep(note(d), 0.1, "triangle", 0.045), i * 90));
    });
    // Los cascos del pelotón: el mismo golpe suave de la carrera, alternando dos notas, un poco más
    // lento. Es el sonido de que todas corren, y llena el hueco entre una echada y la siguiente.
    const casco = Math.floor(t / 0.32);
    if (casco !== ultimoCasco && t < plan.fin - 0.4) {
      ultimoCasco = casco;
      // Una octava arriba de los de la final y con cuerpo (0,045 y 70 ms): son 40 a 65 segundos de pelotón
      // en los que lo único que suena además de la música son estos golpes, y la mezcla tiene que seguir
      // sonando en un parlante de proyector. Medido con audit-mezcla (pérdida al cortar los graves de 150 Hz,
      // límite 3,5 LU) con 18 y con 30 personas: a 0,018 y 50 ms, 3,6 y 3,7; a 0,034 y 50 ms, 3,5 y 3,6;
      // a 0,045 y 70 ms, 3,3 y 3,4. Y por debajo de 0,019 el auditor de sonido los toma por un murmullo.
      beep(note(casco % 2 === 0 ? 0 : 3, 1), 0.07, "square", 0.045);
    }
    plan.tramos.forEach((tr, k) => {
      una(`t${k}`, tr.t0 + 0.15, t, () => {
        h.decir(subTerreno(tr.terreno), 0.4 + 0.08 * k);
        beep(note(k % 2 ? 7 : 5), 0.2, "triangle", 0.05);
        setTimeout(() => beep(note(k % 2 ? 9 : 8), 0.28, "triangle", 0.045), 130);
      });
    });
    // Los que se tambalean, los que se echan y los finalistas que siguen: el mismo sonido y,
    // cuando habla el relator, la misma línea (no se sabe de antemano qué les pasa).
    plan.tambaleos.forEach((w, i) => una(`w${i}`, w.t, t, () => {
      if (w.habla) h.decir(L.pelTambalea(names[w.persona] ?? ""), 0.45);
      beep(note(8), 0.07, "triangle", 0.035);
      setTimeout(() => beep(note(11), 0.07, "triangle", 0.035), 90);
    }));
    evs.forEach((e, i) => una(`e${i}`, e.t, t, () => {
      const [a, b] = e.personas;
      const nom = (p: number | undefined): string => names[p ?? 0] ?? "";
      h.decir(b !== undefined ? L.pelEchoDos(nom(a), nom(b), e.quedan) : L.pelEcho(nom(a), e.quedan), calor(e.quedan));
      // El golpe de la llama que se echa: grave y corto, y una nota que baja. En el celular, un toque corto.
      vibrar("caida");
      beep(note(0, 1), 0.14, "triangle", 0.05);
      setTimeout(() => beep(note(3 - (i % 3), 1), 0.12, "triangle", 0.035), 80);
      // Cuando el nivel de los nombres sube, suena un "pop" suave.
      if ((bases[i + 1] as Nivel) > (bases[i] as Nivel)) setTimeout(() => beep(note(12), 0.1, "sine", 0.04), 200);
    }));
    una("fin", plan.fin - ANUNCIO, t, () => h.decir(L.pelFinal(FINALISTAS), 0.7));
  }

  /* ------------------------------------------------------------------ dibujar */
  let ultimoContador = -1;
  /** Las que ya se echaron y quedaron quietas (ver `dibujar`). */
  const asentadas = new Set<number>();
  const cabeza = (l: Lugar): number => l.y - 126 * l.s;

  /** Lo que se ve de cada uno en `t`: dónde está, cómo y qué lleva. */
  function dibujar(t: number, now: number): void {
    precalentar(2);
    const calidadBaja = S.view.dataset.calidad === "baja";
    const j = estadoEn(t);
    const m = (viv[j] as number[]).length;
    const dHoy = disp[j] as Disposicion;
    const hoy = dHoy.lugares;
    const antes = j > 0 ? (disp[j - 1] as Disposicion).lugares : hoy;
    const f = j > 0 ? salida((t - tCambio(j)) / CIERRA) : 1;
    const corre = corrido(t);
    const ph0 = corre * 0.031;
    const tension = clamp01(1 - (m - FINALISTAS) / Math.max(1, n - FINALISTAS));
    const salto = t >= plan.fin - 0.4;

    /* El suelo: un color que pasa de un terreno al otro, y su decorado. */
    const pesos: Record<string, number> = {};
    let resto = 1;
    for (const k of TERRENOS) {
      pesos[k] = pesoTerreno(k, t);
      resto -= pesos[k] as number;
    }
    pesos.libre = Math.max(0, resto);
    let col = 0;
    let acum = 0;
    for (const k of ["libre", ...TERRENOS] as (Terreno | "libre")[]) {
      const w = pesos[k] as number;
      if (w <= 0) continue;
      const c = TERRENO_COLOR[k][h.dark ? "oscuro" : "claro"];
      acum += w;
      col = acum === w ? c : mezclaColor(col, c, w / acum);
    }
    suelo.tint = col;

    // La valla del fondo: una baranda quieta y sus postes, que corren.
    valla.clear();
    valla.rect(-sw, banda0 - 8 * u, sw * 3, 4 * u).fill(CREAM);
    const paso = 60 * u;
    for (let x = -((corre * 0.55) % paso); x < sw + paso; x += paso) valla.rect(x, banda0 - 20 * u, 4 * u, 16 * u).fill(CREAM);
    valla.rect(-sw, banda0 - 20 * u, sw * 3, 3 * u).fill(CREAM);

    for (const k of ["libre", ...TERRENOS] as (Terreno | "libre")[]) {
      const gr = decorado[k] as Graphics;
      const w = pesos[k] as number;
      gr.clear();
      gr.visible = w > 0.01;
      if (w <= 0.01) continue;
      gr.alpha = k === "libre" ? 1 : w;
      const todas = piezas[k] as { gx: number; fy: number; z: number; v: number }[];
      // Con la calidad baja, la mitad de las piezas: lo que se mueve en el suelo es lo que menos falta.
      const lista = calidadBaja ? todas.filter((_, i) => i % 2 === 0) : todas;
      for (const it of lista) {
        const y = banda0 + 20 * u + (banda1 - banda0 - 24 * u) * it.fy;
        const vel = k === "viento" ? 1.9 : 1;
        const x = ((((it.gx * ciclo - corre * prof(it.fy) * vel) % ciclo) + ciclo) % ciclo) - ciclo * 0.2;
        const q = u * it.z * (0.55 + 0.7 * it.fy);
        if (k === "barro") {
          gr.ellipse(x, y, 34 * q, 7 * q).fill({ color: h.dark ? 0x120b07 : 0x4a301c, alpha: 0.85 });
          gr.ellipse(x - 4 * q, y - 1.5 * q, 22 * q, 3.5 * q).fill({ color: h.dark ? 0x3a2a20 : 0x8c643d, alpha: 0.7 });
        } else if (k === "piedras") {
          const r = 13 * q;
          gr.poly([x - r, y, x - r * 0.5, y - r * 0.95, x + r * 0.4, y - r, x + r, y - r * 0.2, x + r * 0.8, y + r * 0.2, x - r * 0.6, y + r * 0.22])
            .fill(h.dark ? 0x58524c : 0x8d8579).stroke({ width: 1.6 * u, color: INK });
          gr.poly([x - r * 0.4, y - r * 0.8, x + r * 0.3, y - r * 0.85, x, y - r * 0.4]).fill({ color: 0xffffff, alpha: 0.25 });
        } else if (k === "viento") {
          const largo = (60 + it.v * 90) * q;
          gr.moveTo(x, y).lineTo(x - largo, y).stroke({ width: 2.2 * u, color: 0xffffff, alpha: 0.55 });
          gr.moveTo(x - largo * 0.2, y - 5 * q).lineTo(x - largo * 0.75, y - 5 * q).stroke({ width: 1.6 * u, color: 0xffffff, alpha: 0.4 });
        } else {
          // Matas de ichu: unos trazos de pasto.
          const verde = h.dark ? 0x667a3a : 0x8a9a45;
          for (let c = -1; c <= 1; c++) gr.moveTo(x + c * 4 * q, y).lineTo(x + c * 7 * q + (it.v - 0.5) * 6 * q, y - (9 + it.v * 7) * q).stroke({ width: 1.8 * u, color: verde });
        }
      }
    }

    /* El pelotón. */
    polvo.clear();
    // El polvo: dos granos por llama; uno con más de 16 en carrera, y ninguno con la calidad baja.
    const granos = calidadBaja ? 0 : m > 16 ? 1 : 2;
    for (let p = 0; p < n; p++) {
      const l = llamas.get(p) as LlamaPelo;
      const e = evDe.get(p);
      const tCae = caeDe(p);
      const echado = e !== undefined && t >= (evs[e] as { t: number }).t;
      const rNow = celda[j]?.get(p);
      // Dónde está: cerrando filas si sigue, o quieto en su lugar (y corrido hacia atrás con el suelo) si se echó.
      let pos: Lugar;
      if (!echado && rNow !== undefined) {
        const a = hoy[rNow] as Lugar;
        const rPrev = j > 0 ? celda[j - 1]?.get(p) : undefined;
        const b = rPrev !== undefined ? ((antes[rPrev] as Lugar | undefined) ?? a) : a;
        pos = { x: lerp(b.x, a.x, f), y: lerp(b.y, a.y, f), s: lerp(b.s, a.s, f) };
      } else if (e !== undefined) {
        const r0 = celda[e]?.get(p) as number;
        const b = (disp[e] as Disposicion).lugares[r0] as Lugar;
        // Lo que cierra el pelotón alrededor no la mueve: queda donde se echó, y el suelo la lleva hacia atrás.
        const deriva = t >= tCae ? (corre - corrido(tCae)) * prof((b.y - banda0) / Math.max(1, banda1 - banda0)) : 0;
        pos = { x: b.x - deriva, y: b.y, s: b.s };
      } else {
        l.root.visible = false;
        continue;
      }
      // Un meneo propio de cada una, para que no marchen alineadas.
      const dx = Math.sin(now * (0.7 + hash(p, 2) * 0.6) + fase(p)) * 7 * u * (echado ? 0 : 1);
      const dy = Math.sin(now * (1.1 + hash(p, 3) * 0.5) + fase(p) + 1) * 1.5 * u * (echado ? 0 : 1);
      const px = pos.x + dx, py = pos.y + dy;
      l.root.visible = px > -120 * u && px < sw + 120 * u;
      if (!l.root.visible) continue;
      l.root.position.set(px, py);
      l.root.scale.set(pos.s);
      l.root.zIndex = py;
      // La postura.
      let beat: { kind: string; p: number } | null = null;
      if (echado && t >= tCae) beat = { kind: "echada", p: clamp01((t - tCae) / 0.5) };
      else if (!echado) {
        const x = plan.tambaleos.find((w) => t >= w.t && t < w.t + AVISO && w.persona === p);
        if (x) beat = { kind: "tambalea", p: clamp01((t - x.t) / AVISO) };
      }
      const quieta = echado && t >= tCae;
      // Una llama que ya se echó y se asentó no cambia más: se pone una vez y no se
      // vuelve a tocar, así PixiJS no recalcula sus treinta y pico partes en cada cuadro.
      if (!(quieta && t >= tCae + 0.7 && asentadas.has(p))) {
        l.pose(quieta ? 0 : ph0 + fase(p), quieta ? 0 : salto ? 1.5 : 1.15, beat, now);
        if (quieta && t >= tCae + 0.7) asentadas.add(p);
      }
      if (!quieta) {
        // Un poco de polvo detrás de las que corren.
        for (let k = 0; k < granos; k++) {
          const edad = ((now * 1.6 + hash(p, 5 + k)) % 1);
          polvo.circle(px - 28 * pos.s - edad * 30 * u, py - 3 * u - edad * 8 * u, (3 + edad * 6) * u * pos.s).fill({ color: h.dark ? 0x8a6a52 : 0xe0c49a, alpha: 0.4 * (1 - edad) });
        }
      }
    }

    /* Las fichas. */
    const nivelHoy = niveles[j] as Map<number, Nivel>;
    const pop = bases[j] !== (bases[j - 1] ?? bases[j]) ? 1 + 0.3 * Math.max(0, 1 - (t - tCambio(j)) / 0.35) : 1;
    for (const c of capaFichas.children) c.visible = false;
    const poner = (fi: Ficha, x: number, y: number, escala: number, alfa: number, z: number): void => {
      fi.caja.visible = true;
      if (fi.caja.parent !== capaFichas) capaFichas.addChild(fi.caja);
      // Entera dentro de la pantalla.
      const w = fi.w * escala, hh = fi.h * escala;
      const cx = Math.max(8 * u + w / 2, Math.min(sw - 8 * u - w / 2, x));
      const cy = Math.max(S.top() + 6 * u + hh, y);
      fi.caja.position.set(cx, cy);
      fi.caja.scale.set(fi.k * escala);
      fi.caja.alpha = alfa;
      fi.caja.zIndex = z;
    };
    // Las fichas de los finalistas vuelan a su cartel cuando se abre el pelotón.
    const abre = t - plan.fin;
    for (let p = 0; p < n; p++) {
      const e = evDe.get(p);
      const echado = e !== undefined && t >= (evs[e] as { t: number }).t;
      const l = llamas.get(p) as LlamaPelo;
      if (!l.root.visible && !echado) continue;
      if (!echado) {
        const nv = nivelHoy.get(p);
        if (nv === undefined) continue;
        const fi = ficha(p, nv, false, dHoy.cellW);
        const x = l.root.x, y = cabeza({ x: l.root.x, y: l.root.y, s: l.root.scale.x }) + 6 * u;
        // El vuelo al cartel de su carril.
        const k = h.lanes.indexOf(p);
        if (k >= 0 && abre > h.laneAt(k) - plan.fin - 0.45) {
          const dest = h.destino(k);
          const q = salida((abre - (h.laneAt(k) - plan.fin - 0.45)) / 0.45);
          if (dest) {
            const tx = dest.x + fi.w / 2, ty = dest.y + fi.h / 2;
            poner(fi, lerp(x, tx, q), lerp(y, ty, q), pop, q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3, 1000 + p);
            continue;
          }
        }
        poner(fi, x, y, pop, 1, 1000 + p);
      } else {
        const tCae = caeDe(p);
        const dt = t - tCae;
        if (dt < 0) {
          // La segunda de una pareja todavía de pie un instante: conserva su ficha chica.
          const fi = ficha(p, niveles[e as number]?.get(p) ?? 1, false, (disp[e as number] as Disposicion).cellW);
          poner(fi, l.root.x, cabeza({ x: l.root.x, y: l.root.y, s: l.root.scale.x }) + 6 * u, 1, 1, 1000 + p);
        } else if (dt < GRANDE) {
          const fi = ficha(p, 4, true);
          const crece = 1 + 0.18 * Math.sin(Math.min(1, dt / 0.35) * Math.PI) * 1;
          const sube = salida(dt / 0.4) * 22 * u;
          const alfa = dt > GRANDE - 0.25 ? (GRANDE - dt) / 0.25 : 1;
          // La ficha se queda donde cayó la llama: si siguiera al suelo, que se la lleva hacia atrás, se pegaría
          // al borde y pisaría a la de la pareja. Y si se echaron dos juntas, la segunda va arriba de la primera
          // (o abajo, si arriba no hay lugar).
          const cae = (disp[e as number] as Disposicion).lugares[celda[e as number]?.get(p) as number] as Lugar;
          const yMin = S.top() + 6 * u + fi.h * 1.2;
          const base = Math.max(yMin, cabeza(cae) - sube);
          const segunda = (evs[e as number] as { personas: number[] }).personas.indexOf(p) > 0;
          const y = !segunda ? base : base - fi.h * 1.1 >= yMin ? base - fi.h * 1.1 : base + fi.h * 1.1;
          poner(fi, cae.x, y, crece * (0.7 + 0.3 * salida(dt / 0.25)), alfa, 2000 + p);
        }
      }
    }

    /* La tribuna: los que se echaron, con su emblema, alentando. */
    echados.forEach((p, i) => {
      const ic = iconos.get(p) as Container;
      const dt = t - (caeDe(p) + GRANDE);
      // Con la final en los carriles, la tribuna ya no está a la vista.
      if (dt < -VUELO * 0.2 || t > plan.fin + 0.3) {
        ic.visible = false;
        return;
      }
      ic.visible = true;
      const slot = lugarTribuna(i);
      const l = llamas.get(p) as LlamaPelo;
      const q = salida(dt / VUELO);
      const desde = { x: l.root.x, y: l.root.y - 120 * l.root.scale.x };
      const rebote = q >= 1 ? Math.max(0, Math.sin(now * (4 + hash(p, 7) * 2) + fase(p))) * (1.5 + 5 * tension) * u : 0;
      ic.position.set(lerp(desde.x, slot.x, q), lerp(desde.y, slot.y, q) - rebote);
      ic.scale.set(lerp(1.5, 1, q));
      ic.alpha = clamp01((dt + VUELO * 0.2) / 0.15);
    });

    /* El contador y el cartel del terreno. */
    const quedan = m;
    if (quedan !== ultimoContador) {
      ultimoContador = quedan;
      contador.text = L.pelCuenta(quedan, n);
      const pad = 6 * u;
      contador.position.set(pad, pad / 2);
      contadorFondo.clear().roundRect(0, 0, contador.width + pad * 2, contador.height + pad, 4 * u).fill({ color: INK, alpha: 0.92 });
    }
    const tr = plan.tramos.find((x) => t >= x.t0 && t < x.t0 + 2.4);
    if (tr) {
      const d = t - tr.t0;
      titulo.text = tr.terreno === "cuesta" ? L.pelCuesta : tr.terreno === "barro" ? L.pelBarro : tr.terreno === "piedras" ? L.pelPiedras : L.pelViento;
      titulo.alpha = clamp01(d / 0.2) * (1 - suave((d - 1.8) / 0.6));
      titulo.scale.set(lerp(1.5, 1, salida(d / 0.35)));
    } else titulo.alpha = 0;
  }

  return {
    escena,
    hud,
    suelo: corrido,
    actualizar,
    dibujar,
    vivo: (t) => t < plan.fin + 4.5,
  };
}

