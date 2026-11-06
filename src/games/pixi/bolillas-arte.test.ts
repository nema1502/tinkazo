import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { problemasDeTono } from "./kit/sonido";
import type { Contexto } from "./kit/tipos";
import {
  CANICA_R,
  mapeoDe,
  planBolillas,
  trayectoriaDe,
  unitarioDe,
  type Datos,
  type Pant,
  type Pun,
  type Tiro,
} from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";
import {
  ANUNCIO_DIANA,
  AGUAYO,
  CANICA_ESCALA,
  CHISPAS_N,
  CHISPA_VIDA,
  COLA_GOLPE,
  ESTALLO_LINEAS,
  ESTALLO_PUNTAS,
  ESTALLO_VIDA,
  MANO_COBRA,
  MANO_PREPARA,
  MANO_SUELTA,
  PERSEC_ENTRA,
  PERSEC_SALE,
  persecucionDe,
  MANCHAS_N,
  POLVO_N,
  SEMILLA_FIJA,
  SIEMBRA_AIRE,
  TIRADOR,
  TIZA_ONDA,
  TIZA_PUNTOS,
  T_DESVIO,
  anuncioDeDiana,
  cadenaDe,
  cadenaDeTiro,
  canicaDeManoDe,
  coloresCanica,
  efectosDe,
  chispasDe,
  estalloDe,
  golpesDe,
  largadaDe,
  manoDe,
  palpitoDe,
  polvoDe,
  punteadoDe,
  tierraManchas,
  titilazo,
  tizaCirculo,
  type AnuncioDiana,
  type CanicaDeMano,
  type Estallido,
} from "./bolillas-arte";
import { VENTANA, eventosDe } from "./bolillas-sonido";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

/** El contexto que arma el kit, con un azar sembrado y los textos del juego (como en bolillas-plan.test.ts). */
function contexto(n: number, ganadores: number[], semilla = 7): Contexto {
  const rng = sembrar(semilla);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda: RONDA,
    rng,
    idioma: "es",
    txt: (clave, ...args) => {
      const v = (TEXTOS.es as Record<string, string | ((...a: unknown[]) => string)>)[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (etiqueta) => azarDe(RONDA, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

/** La lista de todo el show: el mismo plan que corre en la escena. */
const datosDe = (n: number, ganadores: number[], semilla = 7): Datos => planBolillas(contexto(n, ganadores, semilla)).datos;

const PANT: Pant = { w: 1280, h: 720, k: 1, top: 82, bottom: 614 };
void mapeoDe;
void PANT;

const fuente = (f: string): string => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
/** La fuente sin comentarios: para mirar el código y no los avisos. */
const codigo = (f: string): string => fuente(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("bolillas: la tiza del círculo", () => {
  it("el mismo trazo sale siempre, y otra semilla dibuja otro círculo", () => {
    const a = tizaCirculo(SEMILLA_FIJA);
    expect(tizaCirculo(SEMILLA_FIJA)).toEqual(a);
    expect(a.length).toBe(TIZA_PUNTOS + 1);
    expect(tizaCirculo(SEMILLA_FIJA + 1)).not.toEqual(a);
  });

  it("el trazo cierra la vuelta y su desvío nunca alcanza a una canica", () => {
    const puntos = tizaCirculo(SEMILLA_FIJA);
    const primero = puntos[0] as Pun;
    const ultimo = puntos[puntos.length - 1] as Pun;
    expect(ultimo.x).toBeCloseTo(primero.x, 12);
    expect(ultimo.y).toBeCloseTo(primero.y, 12);
    for (const p of puntos) {
      expect(Math.hypot(p.x, p.y) - 1).toBeLessThanOrEqual(TIZA_ONDA + 1e-12);
      // El desvío del trazo es chico: ninguna canica lo confunde con la orilla.
      expect(TIZA_ONDA).toBeLessThan(CANICA_R);
    }
  });
});

describe("bolillas: la tierra", () => {
  it("las manchas se siembran siempre igual y caben en el campo", () => {
    const a = tierraManchas(SEMILLA_FIJA);
    expect(tierraManchas(SEMILLA_FIJA)).toEqual(a);
    expect(a.length).toBe(MANCHAS_N);
    for (const m of a) {
      expect(Math.hypot(m.x, m.y)).toBeLessThanOrEqual(1.75 + 1e-9);
      expect(m.r).toBeGreaterThan(0.04);
      expect(m.r).toBeLessThanOrEqual(0.32);
      expect(m.a).toBeGreaterThanOrEqual(0.04);
      expect(m.a).toBeLessThanOrEqual(0.2);
      expect(typeof m.oscuro).toBe("boolean");
    }
    expect(tierraManchas(SEMILLA_FIJA + 5)).not.toEqual(a);
  });
});

describe("bolillas: las canicas de vidrio", () => {
  it("cada asiento lleva siempre el mismo vidrio, y una canica por persona", () => {
    for (let slot = 0; slot < 12; slot++) {
      expect(coloresCanica(slot)).toEqual(coloresCanica(slot));
    }
    const bases = new Set(Array.from({ length: 12 }, (_, slot) => coloresCanica(slot).base));
    expect(bases.size).toBe(12);
    // El remolino interior no es del color del vidrio: es la llama adentro.
    for (let slot = 0; slot < 12; slot++) {
      const arte = coloresCanica(slot);
      expect(arte.llama).not.toBe(arte.base);
      expect(arte.llama2).not.toBe(arte.base);
      expect(arte.oscuro).not.toBe(arte.base);
    }
  });

  it("la canica de la pegadora es su propio vidrio, fijo entre rondas", () => {
    expect(coloresCanica(-1)).toEqual(coloresCanica(-1));
    const bases = new Set(Array.from({ length: 12 }, (_, s) => coloresCanica(s).base));
    expect(bases.has(coloresCanica(-1).base)).toBe(false);
  });
});

describe("bolillas: la pegadora de ñati", () => {
  const d = datosDe(8, [3]);
  const tiro = d.tiros[0] as NonNullable<ReturnType<typeof d.tiros.at>>;
  // La mano larga su canica de mano, que toca mi canica a la hora `tMano` de la cadena (S23).
  const r0 = largadaDe(tiro);

  it("la mano entra para cada tiro, sale entre tiro y tiro, y es null fuera del show", () => {
    expect(manoDe(d, 0.4)).toBeNull();
    expect(manoDe(d, d.duracion + 2)).toBeNull();
    expect(manoDe(d, r0 + MANO_PREPARA + MANO_SUELTA + MANO_COBRA + 0.01)).toBeNull();
    // Cada tiro tiene su momento de pinza abierta: el flick, tiro por tiro.
    for (const t of d.tiros) {
      let visto = false;
      for (let u = 0; u <= MANO_PREPARA + MANO_SUELTA + MANO_COBRA; u += 0.01) {
        const mano = manoDe(d, t.t - TIRADOR - MANO_PREPARA + u);
        if (mano && mano.pinza >= 0.9) visto = true;
      }
      expect(visto).toBe(true);
    }
  });

  it("agarra con la pinza cerrada, suelta con el flick y todo sale de la largada del plan", () => {
    const antes = manoDe(d, r0 - MANO_PREPARA + 0.1) as NonNullable<ReturnType<typeof manoDe>>;
    // Cerrada, en el lugar exacto del plan: nada de azar propio.
    expect(antes.pinza).toBe(0);
    expect(antes.en).toEqual(tiro.desde);
    expect(antes.velo).toBe(1);
    const abierta = manoDe(d, r0 + MANO_SUELTA * 0.95) as NonNullable<ReturnType<typeof manoDe>>;
    expect(abierta.pinza).toBeGreaterThanOrEqual(0.9);
    // Se corre retirándose y se desvanece: al fin de la cobra no queda nada.
    const retirada = manoDe(d, r0 + MANO_SUELTA + MANO_COBRA * 0.5) as NonNullable<ReturnType<typeof manoDe>>;
    expect(retirada.en).not.toEqual(antes.en);
    const fina = manoDe(d, r0 + MANO_SUELTA + MANO_COBRA * 0.95) as NonNullable<ReturnType<typeof manoDe>>;
    expect(fina.velo).toBeLessThan(0.1);
    // Determinista: la misma hora, la misma mano.
    expect(manoDe(d, r0 + 0.2)).toEqual(manoDe(d, r0 + 0.2));
  });
});

describe("bolillas: el choque", () => {
  const d = datosDe(8, [3]);
  const tiro = d.tiros[0] as NonNullable<ReturnType<typeof d.tiros.at>>;

  it("el polvo sale una sola vez por impacto y corre hacia donde viaja la canica", () => {
    const a = polvoDe(3, tiro.impacto, tiro.salida.dir);
    expect(polvoDe(3, tiro.impacto, tiro.salida.dir)).toEqual(a);
    expect(a.length).toBe(POLVO_N);
    // La nube corre sobre el rumbo de la salida: el baño sigue a la canica que se va.
    const ida = tiro.salida.dir;
    const proyectado = a.reduce((s, g) => s + g.dx * ida.x + g.dy * ida.y, 0) / a.length;
    expect(proyectado).toBeGreaterThan(0);
    for (const g of a) {
      expect(g.vida).toBeGreaterThan(0.2);
      expect(g.vida).toBeLessThanOrEqual(0.6);
      expect(g.r).toBeGreaterThan(0);
    }
  });

  it("el impacto golpea a la canica que sale, y solo en su ventana", () => {
    expect(efectosDe(d, tiro.t - 0.01)).toBeNull();
    expect(efectosDe(d, tiro.t + COLA_GOLPE)).toBeNull();
    const fx = efectosDe(d, tiro.t + 0.1) as NonNullable<ReturnType<typeof efectosDe>>;
    expect(fx.tiro.slot).toBe(tiro.slot);
    expect(fx.squash).toBeGreaterThan(0);
    expect(fx.flash).toBeGreaterThan(0);
    // El retroceso del tiro va para atrás del golpe: contrario al rumbo de ida.
    const ida = unitarioDe({ x: tiro.impacto.x - tiro.desde.x, y: tiro.impacto.y - tiro.desde.y });
    expect(fx.retro.x * ida.x + fx.retro.y * ida.y).toBeLessThan(0);
    // Determinista: sale de la geometría del plan, nunca de un azar propio.
    expect(efectosDe(d, tiro.t + 0.25)).toEqual(efectosDe(d, tiro.t + 0.25));
  });

  it("la cadena entera se anima con el reloj del plan: la mano, el empuje y la salida, nunca uno de la escena", () => {
    const f = codigo("bolillas.ts");
    expect(f).not.toMatch(/Math\.random/);
    expect(f).toMatch(/trayectoriaDe\(/);
    // La canica de la mano y los dos golpes salen de los helpers puros (`canicaDeManoDe`, `golpesDe`).
    expect(f).toMatch(/canicaDeManoDe\(/);
    expect(f).toMatch(/golpesDe\(/);
  });

  it("el titileo muere en cero: la canica que gana se queda quieta sobre la tiza", () => {
    expect(titilazo(-0.5)).toBe(0);
    expect(titilazo(0)).toBe(0);
    expect(titilazo(1)).toBe(0);
    expect(titilazo(2)).toBe(0);
    // Vale antes de quedarse quieta, y el vaivén termina en cero sin salto.
    expect(Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(titilazo((i + 1) / 201))))).toBeGreaterThan(0.2);
    expect(Math.abs(titilazo(0.9999))).toBeLessThan(0.01);
    expect(titilazo(0.3)).toBe(titilazo(0.3));
  });

  it("la escena titila con el reloj del casi, no con un seno suelto", () => {
    const f = codigo("bolillas.ts");
    // El vaivén viene de titilazo, y su reloj arranca en el casi del plan.
    expect(f).toMatch(/= \(t - d\.casi\.t\) \/ Math\.max/);
    expect(f).toMatch(/titilazo\(uTitila\)/);
    expect(f).not.toMatch(/Math\.sin\(\(t - d\.casi\.t\) \* 9\)/);
  });
});

describe("bolillas: las canicas más grandes (S17)", () => {
  it("el dibujo de la canica va al doble (S20), sujetado por el aire de la siembra", () => {
    // El doble que pidió la sala: la cuenta da entera, sin tocar la siembra.
    expect(CANICA_ESCALA).toBe(2.0);
    expect(CANICA_ESCALA).toBe(Math.min(2.0, SIEMBRA_AIRE / (2 * CANICA_R)));
    // El aire de la siembra aguanta el doble: dos canicas vecinas con sus radios dibujados jamás se funden.
    expect(2 * CANICA_R * CANICA_ESCALA).toBeLessThanOrEqual(SIEMBRA_AIRE);
  });

  it("el tope respeta la siembra: dos canicas vecinas del plan jamás se tocan (n hasta 200)", () => {
    const par = 2 * CANICA_R * CANICA_ESCALA;
    for (const n of [12, 13, 18, 30, 60, 200]) {
      for (let s = 1; s <= 12; s++) {
        const d = datosDe(n, [Math.min(n - 1, 3)], s);
        for (let i = 0; i < d.posiciones.length; i++) {
          for (let j = i + 1; j < d.posiciones.length; j++) {
            const dist = Math.hypot(
              (d.posiciones[i] as Pun).x - (d.posiciones[j] as Pun).x,
              (d.posiciones[i] as Pun).y - (d.posiciones[j] as Pun).y,
            );
            expect(dist, `canicas ${i}/${j} con ${n} semilla ${s}`).toBeGreaterThanOrEqual(par - 1e-9);
          }
        }
      }
    }
  });

  it("la escena 2D dibuja con el multiplicador, y las chispas y el destello crecen con él", () => {
    const f = codigo("bolillas.ts");
    expect(f).toMatch(/CANICA_R \* CANICA_ESCALA/);
    expect(f).toMatch(/CANICA_R \* e\.m\.e \* CANICA_ESCALA/);
  });
});

describe("bolillas: el trazo punteado (S19)", () => {
  const a = { x: 0.2, y: -0.4 };
  const b = { x: 0.9, y: 0.1 };

  it("divide el trazo en tramos sobre la misma recta, con igual aire entre ellos", () => {
    const tramos = punteadoDe(a, b, 0.06);
    expect(tramos.length).toBeGreaterThanOrEqual(2);
    let anterior: readonly [Pun, Pun] | null = null;
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    for (const [p, q] of tramos) {
      // Cada tramo vive sobre el trazo: la proyección radial cae dentro del tramo, y el tramo entero adentro del trazo.
      const t1 = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (largo * largo);
      const t2 = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (largo * largo);
      expect(t1).toBeGreaterThanOrEqual(0);
      expect(t2).toBeLessThanOrEqual(1);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(0.06 + 1e-9);
      if (anterior) expect(p.x).toBeGreaterThan(anterior[1].x - 1e-9); // sin encimar ni ir para atrás
      anterior = [p, q];
    }
    // Punteado: la mitad del trazo queda pintada y la otra mitad, aire.
    const pintado = tramos.reduce((s, [p, q]) => s + Math.hypot(q.x - p.x, q.y - p.y), 0);
    expect(pintado).toBeCloseTo(largo / 2, 9);
  });

  it("es determinista, y en un tramo corto queda al menos un tramo", () => {
    expect(punteadoDe(a, b, 0.06)).toEqual(punteadoDe(a, b, 0.06));
    expect(punteadoDe({ x: 0, y: 0 }, { x: 0.05, y: 0 }, 0.5).length).toBe(1);
  });

  it("en la escena no queda trazo sólido de las líneas que salen: el rayito del vidrio y la marca de largada van punteados", () => {
    const f = codigo("bolillas.ts");
    expect(f).toMatch(/punteadoDe\(/);
    // El rayito del vidrio ya no dibuja su línea de una pieza...
    expect(f).not.toMatch(/moveTo\(tx, ty\)\.lineTo\(hx, hy\)\.stroke/);
    // ...ni la marca de largada su tramo sólido.
    expect(f).not.toMatch(/moveTo\(w\.x - 2\.6 \* p\.k, w\.y\)\.lineTo\(w\.x \+ 2\.6 \* p\.k, w\.y\)/);
  });
});

describe("bolillas: el anuncio de la diana (S19)", () => {
  const d = datosDe(8, [3]);

  it("anuncia la diana del próximo tiro en su ventana, y solo ahí", () => {
    const t0 = (d.tiros[0] as { t: number }).t;
    expect(anuncioDeDiana(d, 0)).toBeNull();
    expect(anuncioDeDiana(d, t0 - ANUNCIO_DIANA - 0.01)).toBeNull();
    expect(anuncioDeDiana(d, t0 - ANUNCIO_DIANA + 0.01)?.tiro.t).toBe(t0);
    expect(anuncioDeDiana(d, t0 - 0.01)?.tiro.t).toBe(t0);
    // En el impacto ya no hay anuncio: la canica está siendo golpeada.
    expect(anuncioDeDiana(d, t0)).toBeNull();
    // El próximo tiro toma el relevo, en orden de `tiros`...
    const t1 = (d.tiros[1] as { t: number }).t;
    expect(anuncioDeDiana(d, t1 - ANUNCIO_DIANA * 0.5)?.tiro.t).toBe(t1);
    // ...y después de la última tirada no hay anuncio: el casi es un rodado, no un golpe.
    const ult = (d.tiros[d.tiros.length - 1] as { t: number }).t;
    expect(anuncioDeDiana(d, ult + 0.01)).toBeNull();
    expect(anuncioDeDiana(d, d.casi.t + 0.01)).toBeNull();
  });

  it("nunca anuncia a la canica que gana (el casi es un rodado, no un golpe)", () => {
    for (let t = 0; t < d.duracion; t += 0.05) {
      const a = anuncioDeDiana(d, t);
      if (a) expect(a.tiro.diana, `a los ${t.toFixed(2)}`).not.toBe(d.ganador);
    }
    // En todos los planes de la casa (60 personas, distintas semillas) tampoco.
    for (const n of [12, 18, 60]) {
      const ronda = datosDe(n, [3]);
      for (const tiro of ronda.tiros) expect(tiro.diana).not.toBe(ronda.ganador);
    }
  });

  it("el pulso muere antes de que el tiro aterrice, y nace en cero", () => {
    const t0 = (d.tiros[0] as { t: number }).t;
    expect(anuncioDeDiana(d, t0 - ANUNCIO_DIANA)?.pulso).toBe(0);
    const medio = anuncioDeDiana(d, t0 - ANUNCIO_DIANA * 0.4)?.pulso as number;
    expect(medio).toBeGreaterThan(0.2);
    // El tramo final de la ventana está sin pulso: muere antes del aterrizaje.
    expect(anuncioDeDiana(d, t0 - ANUNCIO_DIANA * 0.15)?.pulso).toBe(0);
    expect(anuncioDeDiana(d, t0 - 0.001)?.pulso).toBe(0);
  });

  it("el anillo rodea a la canica sin tocarla, con rayas de la paleta de la casa, determinista y con su reparto por tiro", () => {
    const a = anuncioDeDiana(d, (d.tiros[0] as { t: number }).t - ANUNCIO_DIANA * 0.3) as AnuncioDiana;
    expect(a.anillo).toBeGreaterThan(CANICA_R * CANICA_ESCALA);
    expect(a.rayas.length).toBeGreaterThan(0);
    for (const r of a.rayas) {
      // Cada raya nace en el anillo (o fuera) y crece hacia afuera, sin meterse en la canica.
      expect(r.de).toBeGreaterThanOrEqual(a.anillo - 1e-9);
      expect(r.hasta).toBeGreaterThan(r.de);
      expect(AGUAYO).toContain(r.color);
    }
    expect(anuncioDeDiana(d, (d.tiros[0] as { t: number }).t - ANUNCIO_DIANA * 0.3)).toEqual(a);
    // Cada diana lleva su reparto: la fase de las rayas cambia de un tiro al otro.
    const b = anuncioDeDiana(d, (d.tiros[1] as { t: number }).t - ANUNCIO_DIANA * 0.3) as AnuncioDiana;
    expect(b.rayas[0]?.a).not.toBe(a.rayas[0]?.a);
  });
});

describe("bolillas: el sonido de los choques", () => {
  const d = datosDe(8, [3]);

  it("cada impacto suena un clic de cristal, cada caída un golpe seco en la tierra", () => {
    const todas = new Map<string, number>();
    for (let t = 0; t <= d.duracion + 2 * VENTANA; t += 0.02) {
      for (const ev of eventosDe(d, t, true)) todas.set(ev.clave, (todas.get(ev.clave) ?? 0) + 1);
    }
    const claves = [...todas.keys()];
    // Un clic de choque (más su eco) y una caída por tiro.
    expect(claves.filter((c) => c.startsWith("choque:")).length).toBe(d.tiros.length);
    expect(claves.filter((c) => c.startsWith("eco:")).length).toBe(d.tiros.length);
    expect(claves.filter((c) => c.startsWith("cae:")).length).toBe(d.tiros.length);
    // Cada evento vive en su ventana (la escena lo suena una sola vez con `sonido.una`): no es un tic de un solo cuadro.
    for (const n of todas.values()) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(25);
    }
  });

  it("el titileo sube con sucesivos tonos chicos, y todo cabe en la voz del estadio", () => {
    const todas = new Map<string, ReturnType<typeof eventosDe>[number]>();
    for (let t = 0; t <= d.duracion + 0.5; t += 0.01) {
      for (const ev of eventosDe(d, t, true)) todas.set(ev.clave, ev);
    }
    const ticks = [...todas.entries()].filter(([c]) => c.startsWith("titila:")).map(([c, ev]) => ({ c, gr: ev.grado }));
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    // Suben: cada tick del titileo es más agudo que el anterior.
    for (let i = 1; i < ticks.length; i++) expect((ticks[i] as { gr: number }).gr).toBeGreaterThan((ticks[i - 1] as { gr: number }).gr);
    for (const ev of todas.values()) {
      expect(problemasDeTono(ev.grado, ev.cat, { vol: ev.vol, dur: ev.dur })).toEqual([]);
    }
  });

  it("con el mudo puesto no suena nada: el sonido del choque es cosmético", () => {
    expect(eventosDe(d, (d.tiros[0] as NonNullable<ReturnType<typeof d.tiros.at>>).t + 0.01, false)).toEqual([]);
    // Y la escena lo respeta: una sola voz de la casa, con el interruptor del estadio.
    const f = fuente("bolillas.ts");
    expect(f).toMatch(/import \{ isMuted \} from "\.\.\/\.\.\/sound"/);
    expect((f.match(/from "\.\.\/\.\.\/sound"/g) ?? []).length).toBe(1);
    expect(f).toMatch(/sonido\.una\(ev\.clave/);
  });

  it("los helpers de la escena corren en Node, sin PixiJS ni DOM", () => {
    for (const f of ["bolillas-arte.ts", "bolillas-sonido.ts"]) {
      expect(codigo(f)).not.toMatch(/from "pixi\.js"/);
      expect(codigo(f)).not.toMatch(/Math\.random/);
    }
  });
});

describe("bolillas: la cadena del turno (S21, S23)", () => {
  const d = datosDe(8, [3]);
  const tiro = d.tiros[0] as Tiro;

  it("las horas de la cadena salen del plan: la mano larga, toca mi canica, mi canica empuja y el enemigo cruza", () => {
    const c = cadenaDeTiro(tiro);
    expect(c.tiro).toBe(tiro);
    expect(c.toca).toBe(tiro.tMano);
    expect(c.empuja).toBe(tiro.t);
    expect(c.cruza).toBeCloseTo(tiro.t + tiro.salida.vuelo, 9);
    expect(c.larga).toBeCloseTo(tiro.tMano - TIRADOR, 9);
    expect(c.frena).toBeCloseTo(tiro.tMano + T_DESVIO, 9);
    // El orden de la cadena (S23): la mano pega, mi canica rueda, la del enemigo sale y cruza.
    expect(c.larga).toBeLessThan(c.toca);
    expect(c.toca).toBeLessThan(c.empuja);
    expect(c.empuja).toBeLessThan(c.cruza);
    // Determinista: la misma tirada, las mismas horas.
    expect(cadenaDeTiro(tiro)).toEqual(c);
  });

  it("la canica de la mano tiene la cadena para ella sola: nunca dos a la vez, y ninguna fuera del show", () => {
    expect(cadenaDe(d, 0)).toBeNull();
    expect(cadenaDe(d, d.duracion + 3)).toBeNull();
    // Los turnos no se pisan: cuando una mano larga, la anterior ya soltó y se retiró.
    for (let k = 1; k < d.tiros.length; k++) {
      const antes = cadenaDeTiro(d.tiros[k - 1] as Tiro);
      const ahora = cadenaDeTiro(d.tiros[k] as Tiro);
      expect(antes.frena, `las cadenas ${k - 1} y ${k}`).toBeLessThanOrEqual(ahora.larga);
    }
    const turnos = new Set<number>();
    for (let t = 0; t <= d.duracion + 3; t += 0.01) {
      const c = cadenaDe(d, t);
      if (!c) continue;
      turnos.add(c.tiro.t);
      expect(t).toBeGreaterThanOrEqual(c.larga);
      expect(t).toBeLessThan(c.frena);
      expect(cadenaDe(d, t)).toEqual(c);
    }
    expect(turnos.size).toBe(d.tiros.length);
  });

  it("la canica de la mano sale de `desde`, pega en `choque` a la hora `tMano` y después deriva a `mano.hasta`", () => {
    const c = cadenaDeTiro(tiro);
    // Largada: en el punto del plan, íntegra y volando.
    const largada = canicaDeManoDe(d, c.larga) as CanicaDeMano;
    expect(largada.fase).toBe("vuela");
    expect(largada.u).toBe(0);
    expect(largada.p.x).toBeCloseTo(tiro.desde.x, 9);
    expect(largada.p.y).toBeCloseTo(tiro.desde.y, 9);
    // En el primer impacto: exactamente `choque`, y ya en la deriva.
    const toca = canicaDeManoDe(d, tiro.tMano) as CanicaDeMano;
    expect(toca.fase).toBe("deriva");
    expect(toca.u).toBe(0);
    expect(toca.p.x).toBeCloseTo(tiro.choque.x, 9);
    expect(toca.p.y).toBeCloseTo(tiro.choque.y, 9);
    // La ida es una recta de `desde` a `choque`: en el medio, sobre la línea y a mitad de camino.
    const medio = canicaDeManoDe(d, (c.larga + c.toca) / 2) as CanicaDeMano;
    expect(medio.fase).toBe("vuela");
    expect(medio.u).toBeCloseTo(0.5, 9);
    const ida = unitarioDe({ x: tiro.choque.x - tiro.desde.x, y: tiro.choque.y - tiro.desde.y });
    const desvio = (medio.p.x - tiro.desde.x) * -ida.y + (medio.p.y - tiro.desde.y) * ida.x;
    expect(Math.abs(desvio)).toBeLessThan(1e-9);
    const avance = (medio.p.x - tiro.desde.x) * ida.x + (medio.p.y - tiro.desde.y) * ida.y;
    expect(avance).toBeGreaterThan(0);
    // La deriva termina en `mano.hasta`; fuera de la ventana no hay canica de mano.
    const fin = canicaDeManoDe(d, c.frena - 1e-6) as CanicaDeMano;
    expect(fin.p.x).toBeCloseTo(tiro.mano.hasta.x, 3);
    expect(fin.p.y).toBeCloseTo(tiro.mano.hasta.y, 3);
    expect(canicaDeManoDe(d, c.larga - 0.01)).toBeNull();
    expect(canicaDeManoDe(d, c.frena)).toBeNull();
    // Determinista: el mismo segundo, la misma canica.
    expect(canicaDeManoDe(d, c.toca + 0.1)).toEqual(canicaDeManoDe(d, c.toca + 0.1));
  });

  it("mi canica rueda de `choque` a `empuje.hasta` entre `tMano` y `t`: la escena le cree a trayectoriaDe", () => {
    const mio = tiro.mio;
    const enElChoque = trayectoriaDe(d, mio, tiro.tMano);
    expect(enElChoque.estado).toBe("vuela");
    expect(enElChoque.p.x).toBeCloseTo(tiro.choque.x, 9);
    expect(enElChoque.p.y).toBeCloseTo(tiro.choque.y, 9);
    // Rueda de verdad: a mitad del empuje ni está en el choque ni llegó.
    const medio = trayectoriaDe(d, mio, (tiro.tMano + tiro.t) / 2);
    expect(medio.estado).toBe("vuela");
    expect(medio.p.x).not.toBeCloseTo(tiro.choque.x, 6);
    expect(medio.p.x).not.toBeCloseTo(tiro.empuje.hasta.x, 6);
    // Adelante sobre el rumbo del empuje, nunca para atrás.
    const ida = unitarioDe({ x: tiro.empuje.hasta.x - tiro.choque.x, y: tiro.empuje.hasta.y - tiro.choque.y });
    const avance = (medio.p.x - tiro.choque.x) * ida.x + (medio.p.y - tiro.choque.y) * ida.y;
    expect(avance).toBeGreaterThan(0);
    // En el segundo impacto mi canica está donde el plan dijo: `empuje.hasta`.
    const enElEmpuje = trayectoriaDe(d, mio, tiro.t);
    expect(enElEmpuje.p.x).toBeCloseTo(tiro.empuje.hasta.x, 9);
    expect(enElEmpuje.p.y).toBeCloseTo(tiro.empuje.hasta.y, 9);
  });

  it("las canicas se mueven: la que empuja arranca donde quedó, no donde la sembraron", () => {
    let movidas = 0;
    for (const n of [8, 12, 18]) {
      for (let s = 1; s <= 4; s++) {
        const p = datosDe(n, [Math.min(n - 1, 3)], s);
        for (const jugada of p.tiros) {
          expect(trayectoriaDe(p, jugada.mio, jugada.tMano + (jugada.t - jugada.tMano) / 3).estado).toBe("vuela");
          expect(trayectoriaDe(p, jugada.mio, jugada.t).p).toEqual(jugada.empuje.hasta);
          const siembra = p.posiciones[jugada.mio] as Pun;
          if (Math.hypot(jugada.choque.x - siembra.x, jugada.choque.y - siembra.y) > 1e-9) movidas++;
        }
      }
    }
    // En estos planes hay canicas que ya se movieron antes de volver a empujar: la siembra no manda.
    expect(movidas).toBeGreaterThan(0);
  });

  it("la canica del enemigo sale de `empuje.donde` a la hora `t`, sigue adelante y cruza en `salida.tiza` (S21)", () => {
    const slot = tiro.slot;
    const enElGolpe = trayectoriaDe(d, slot, tiro.t);
    expect(enElGolpe.estado).toBe("vuela");
    expect(enElGolpe.p.x).toBeCloseTo(tiro.empuje.donde.x, 9);
    expect(enElGolpe.p.y).toBeCloseTo(tiro.empuje.donde.y, 9);
    let antes = 0;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const p = trayectoriaDe(d, slot, tiro.t + u * tiro.salida.vuelo).p;
      const adelante = (p.x - tiro.empuje.donde.x) * tiro.salida.dir.x + (p.y - tiro.empuje.donde.y) * tiro.salida.dir.y;
      // Sigue adelante turno a turno: nunca vuelve hacia donde vino la pegadora.
      expect(adelante).toBeGreaterThanOrEqual(antes - 1e-9);
      antes = adelante;
    }
    const fin = trayectoriaDe(d, slot, tiro.t + tiro.salida.vuelo + 1e-6);
    expect(fin.estado).toBe("afuera");
    expect(fin.p.x).toBeCloseTo(tiro.salida.tiza.x, 6);
    expect(fin.p.y).toBeCloseTo(tiro.salida.tiza.y, 6);
  });
});

describe("bolillas: los dos golpes del turno (S22, S23)", () => {
  const d = datosDe(8, [3]);
  const tiro = d.tiros[0] as Tiro;
  const mio = (golpesDe(d, tiro.tMano).find((g) => g.tiro === tiro && g.tipo === "mano")) as NonNullable<ReturnType<typeof golpesDe>[number]>;
  const fuerte = (golpesDe(d, tiro.t).find((g) => g.tiro === tiro && g.tipo === "canica")) as NonNullable<ReturnType<typeof golpesDe>[number]>;

  it("cada turno trae dos golpes: la mano en `choque` y mi canica en `empuje.donde`", () => {
    expect(mio.t).toBe(tiro.tMano);
    expect(mio.punto).toEqual(tiro.choque);
    expect(mio.slot).toBe(tiro.mio);
    expect(fuerte.t).toBe(tiro.t);
    expect(fuerte.punto).toEqual(tiro.empuje.donde);
    expect(fuerte.slot).toBe(tiro.slot);
    // Fuera de la ventana de un golpe no hay golpe (la escena no inventa impactos).
    expect(golpesDe(d, tiro.tMano - 0.6).some((g) => g.tiro === tiro && g.tipo === "mano")).toBe(false);
  });

  it("el de la mano es más blando: menos destello, otro polvo y ningún estallido de pelea", () => {
    expect(mio.brillo).toBeGreaterThan(0);
    expect(mio.brillo).toBeLessThan(fuerte.brillo);
    expect(mio.estallo).toBeNull();
    // Las chispas de vidrio salen en los dos (S13), sembradas por el canal de cada golpe.
    const chispas = chispasDe(mio.semilla, mio.punto, mio.dir);
    expect(chispas.length).toBe(CHISPAS_N);
    expect(polvoDe(mio.semilla, mio.punto, mio.dir).length).toBe(POLVO_N);
    // Las de la mano salen por donde rueda mi canica: adelante, sobre el rumbo del empuje.
    const adelante = chispas.reduce((s, c) => s + c.dx * mio.dir.x + c.dy * mio.dir.y, 0);
    expect(adelante).toBeGreaterThan(0);
    // El polvo y las chispas de la mano no son los del vidrio contra vidrio: cada golpe tiene su semilla.
    expect(mio.semilla).not.toBe(fuerte.semilla);
    expect(chispasDe(mio.semilla, mio.punto, mio.dir)).not.toEqual(chispasDe(fuerte.semilla, fuerte.punto, fuerte.dir));
    expect(golpesDe(d, tiro.tMano).find((g) => g.tiro === tiro && g.tipo === "mano")).toEqual(mio);
  });

  it("el golpe fuerte trae el estallido de pelea entero: estrella, líneas de velocidad y micro-sacudida", () => {
    const est = fuerte.estallo as Estallido;
    expect(est).not.toBeNull();
    expect(est.estrella.length).toBe(ESTALLO_PUNTAS * 2);
    expect(est.lineas.length).toBe(ESTALLO_LINEAS);
    expect(est.sacudida).toBeGreaterThan(0);
    expect(est.vida).toBe(ESTALLO_VIDA);
    // Al instante del golpe el destello está entero; después se apaga.
    expect(fuerte.edad).toBe(0);
    expect(fuerte.flash).toBe(1);
    expect(fuerte.brillo).toBe(1);
  });

  it("la canica que recibe el golpe late, y la que empuja también late con la mano", () => {
    expect(palpitoDe(d, tiro.mio, tiro.tMano + COLA_GOLPE / 2)).toBeGreaterThan(0.9);
    expect(palpitoDe(d, tiro.slot, tiro.t + COLA_GOLPE / 2)).toBeGreaterThan(0.9);
    // La cola muere en cero: no queda temblando.
    expect(palpitoDe(d, tiro.mio, tiro.tMano + COLA_GOLPE)).toBe(0);
    expect(palpitoDe(d, tiro.slot, tiro.t + COLA_GOLPE)).toBe(0);
    expect(palpitoDe(d, tiro.slot, tiro.t - 0.2)).toBe(0);
    // Al arranque del show nadie late.
    for (let slot = 0; slot < d.canicas.length; slot++) expect(palpitoDe(d, slot, 0)).toBe(0);
  });
});

describe("bolillas: el estallido de pelea (S22)", () => {
  const d = datosDe(8, [3]);
  const tiro = d.tiros[0] as Tiro;
  const est = estalloDe(0, tiro.empuje.donde, tiro.salida.dir);

  it("es determinista y de cada golpe: la misma tirada, el mismo estallido; otra, otro", () => {
    expect(estalloDe(0, tiro.empuje.donde, tiro.salida.dir)).toEqual(est);
    expect(estalloDe(1, tiro.empuje.donde, tiro.salida.dir)).not.toEqual(est);
    expect(est.vida).toBe(ESTALLO_VIDA);
    // Más largo y más grande que las chispas de vidrio de S13, que siguen en el mismo golpe.
    expect(ESTALLO_VIDA).toBeGreaterThan(CHISPA_VIDA);
    expect(est.punta).toBeGreaterThan(CANICA_R * CANICA_ESCALA * 2);
    expect(est.estrella.length + est.lineas.length).toBeGreaterThan(CHISPAS_N);
  });

  it("la estrella es una ráfaga de manga: puntas alternas que dan la vuelta entera del impacto", () => {
    expect(est.punta).toBeGreaterThan(est.nucleo);
    expect(est.nucleo).toBeGreaterThan(0);
    const vueltas: number[] = [];
    est.estrella.forEach((p, k) => {
      const r = Math.hypot(p.x, p.y);
      // Alterna la punta y el hueco: la estrella de los efectos de pelea.
      expect(r, `vértice ${k}`).toBeCloseTo(k % 2 === 0 ? est.punta : est.nucleo, 9);
      vueltas.push(Math.atan2(p.y, p.x));
    });
    // Los vértices giran siempre para el mismo lado y cierran la vuelta entera (sin rayos amontonados).
    let total = 0;
    for (let k = 1; k < vueltas.length; k++) {
      const paso = ((vueltas[k] as number) - (vueltas[k - 1] as number) + Math.PI * 2) % (Math.PI * 2);
      expect(paso).toBeGreaterThan(0);
      total += paso;
    }
    // La última punta vuelve a la primera: la vuelta cierra.
    total += ((vueltas[0] as number) - (vueltas[vueltas.length - 1] as number) + Math.PI * 2) % (Math.PI * 2);
    expect(total).toBeCloseTo(Math.PI * 2, 9);
  });

  it("las líneas de velocidad radian del impacto, más largas que el vidrio y abiertas alrededor del rumbo del golpe", () => {
    const base = Math.atan2(tiro.salida.dir.y, tiro.salida.dir.x);
    let hacia = 0;
    for (const l of est.lineas) {
      expect(l.de).toBeGreaterThan(0);
      expect(l.largo).toBeGreaterThan(CANICA_R * CANICA_ESCALA);
      expect(l.ancho).toBeGreaterThan(0);
      expect(l.vida).toBeGreaterThan(0);
      expect(l.vida).toBeLessThanOrEqual(ESTALLO_VIDA);
      hacia += Math.cos(l.a - base);
    }
    // El abanico mira hacia donde salió la canica golpeada: el golpe se lee en la dirección del tiro.
    expect(hacia / est.lineas.length).toBeGreaterThan(0.2);
  });

  it("el micro-sacudón es de verdad micro: se siente y no mueve la escena", () => {
    expect(est.sacudida).toBeGreaterThan(0);
    expect(est.sacudida).toBeLessThanOrEqual(0.04);
    // Menos que media canica dibujada: un golpe, no un temblor de tierra.
    expect(est.sacudida).toBeLessThan(CANICA_R * CANICA_ESCALA);
  });
});

describe("bolillas: dos golpes por turno por la voz única (S23)", () => {
  const d = datosDe(8, [3]);

  /** Los eventos sonoros del show, con el primer segundo en que se piden. */
  const cuando = (): Map<string, { ev: ReturnType<typeof eventosDe>[number]; t: number }> => {
    const v = new Map<string, { ev: ReturnType<typeof eventosDe>[number]; t: number }>();
    for (let t = 0; t <= d.duracion + 2 * VENTANA; t += 0.01) {
      for (const ev of eventosDe(d, t, true)) if (!v.has(ev.clave)) v.set(ev.clave, { ev, t });
    }
    return v;
  };

  it("la mano toca mi canica antes y más blando; mi canica pega el clic fuerte después", () => {
    const v = cuando();
    const manos = [...v.values()].filter((x) => x.ev.clave.startsWith("mano:"));
    const choques = [...v.values()].filter((x) => x.ev.clave.startsWith("choque:"));
    expect(manos.length).toBe(d.tiros.length);
    expect(choques.length).toBe(d.tiros.length);
    const fuerte = choques[0] as { ev: { vol?: number } };
    for (const x of manos) {
      // Más blando: menos volumen que el clic fuerte (y sigue siendo de la voz de la casa).
      expect(x.ev.vol ?? 0).toBeLessThan(fuerte.ev.vol ?? 0);
      expect(problemasDeTono(x.ev.grado, x.ev.cat, { vol: x.ev.vol, dur: x.ev.dur })).toEqual([]);
    }
    // Turno por turno: primero el toque de la mano, después el choque de verdad.
    d.tiros.forEach((tiro, i) => {
      const m = v.get(`mano:${i}`);
      const c = v.get(`choque:${i}`);
      expect(m).toBeDefined();
      expect(c).toBeDefined();
      expect((m as { t: number }).t).toBeLessThan((c as { t: number }).t);
      expect((m as { t: number }).t).toBeGreaterThanOrEqual(tiro.tMano);
      expect((c as { t: number }).t).toBeGreaterThanOrEqual(tiro.t);
    });
  });

  it("con el mudo los dos golpes callan: el sonido sigue siendo cosmético y de una sola voz", () => {
    for (const tiro of d.tiros) {
      expect(eventosDe(d, tiro.tMano + 0.01, false)).toEqual([]);
      expect(eventosDe(d, tiro.t + 0.01, false)).toEqual([]);
    }
  });
});

describe("la persecución de la ganadora (S24)", () => {
  it("cubre solo el último turno, y su peso nace y muere en cero", () => {
    for (const n of [2, 8, 12, 18]) {
      const d = datosDe(n, [Math.min(n - 1, 3)]);
      const ultimo = d.tiros.at(-1);
      if (!ultimo) continue;
      expect(persecucionDe(d, ultimo.tMano - PERSEC_ENTRA - 0.01), `con ${n}: antes`).toBeNull();
      expect(persecucionDe(d, ultimo.t + PERSEC_SALE + 0.01), `con ${n}: después`).toBeNull();
      expect(persecucionDe(d, ultimo.tMano - PERSEC_ENTRA + 0.001)?.peso ?? 1, `con ${n}: al entrar`).toBeLessThan(0.05);
      const medio = (ultimo.tMano + ultimo.t) / 2;
      expect(persecucionDe(d, medio)?.peso, `con ${n}: en el rodado`).toBeCloseTo(1, 6);
      expect(persecucionDe(d, ultimo.t + PERSEC_SALE - 0.001)?.peso ?? 1, `con ${n}: al soltar`).toBeLessThan(0.05);
      // La canica es la de la ganadora: la que empuja en el último turno, y su rumbo el del empuje.
      expect(ultimo.mio, `con ${n}: empuja la ganadora`).toBe(d.canicas.indexOf(d.ganador));
      expect(persecucionDe(d, medio)?.p.x).toBeCloseTo(trayectoriaDe(d, ultimo.mio, medio).p.x, 9);
      expect(persecucionDe(d, medio)?.p.y).toBeCloseTo(trayectoriaDe(d, ultimo.mio, medio).p.y, 9);
      expect(persecucionDe(d, medio)?.dir.x).toBeCloseTo(ultimo.empuje.dir.x, 9);
      expect(persecucionDe(d, medio)?.dir.y).toBeCloseTo(ultimo.empuje.dir.y, 9);
    }
  });

  it("las rayitas de velocidad salen del azar fijo: la misma ronda da las mismas", () => {
    const d = datosDe(12, [3]);
    const ultimo = d.tiros.at(-1);
    expect(ultimo).toBeDefined();
    if (!ultimo) return;
    const a = persecucionDe(d, ultimo.t);
    const b = persecucionDe(datosDe(12, [3]), ultimo.t);
    expect(a?.estelas).toEqual(b?.estelas);
    expect(a?.estelas.length).toBeGreaterThan(0);
    for (const estela of a?.estelas ?? []) {
      expect(estela.atras).toBeGreaterThan(0);
      expect(estela.largo).toBeGreaterThan(0);
      expect(estela.vida).toBeGreaterThan(0);
    }
  });
});
