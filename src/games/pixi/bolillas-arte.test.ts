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
  unitarioDe,
  type Datos,
  type Pant,
  type Pun,
} from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";
import {
  COLA_GOLPE,
  MANO_COBRA,
  MANO_PREPARA,
  MANO_SUELTA,
  MANCHAS_N,
  POLVO_N,
  SEMILLA_FIJA,
  TIRADOR,
  TIZA_ONDA,
  TIZA_PUNTOS,
  coloresCanica,
  efectosDe,
  manoDe,
  polvoDe,
  tierraManchas,
  titilazo,
  tizaCirculo,
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
  const r0 = tiro.t - TIRADOR;

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

  it("el tiro deflexiona y la golpeada vuela con el reloj del plan, nunca de la escena", () => {
    const f = codigo("bolillas.ts");
    expect(f).not.toMatch(/Math\.random/);
    expect(f).toMatch(/trayectoriaDe\(/);
    expect(f).toMatch(/unitarioDe\(/);
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
