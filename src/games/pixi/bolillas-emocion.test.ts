import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { problemasDeTono } from "./kit/sonido";
import type { Contexto } from "./kit/tipos";
import { planBolillas, type Datos } from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";
import {
  CHISPAS_N,
  CHISPA_VIDA,
  CERCA_ENTRA,
  cercaDe,
  chispasDe,
} from "./bolillas-arte";
import { VENTANA, eventosDe } from "./bolillas-sonido";

/**
 * Bolillas: la emoción que se pidió después de probar la demo (S13 y S14).
 *
 * S13: las bolillas se ven apoyadas en la tierra, cada choque echa chispas de
 * vidrio y el clic se oye de verdad en un teléfono. S14: la cámara del 3D se
 * acerca a la canica que gana mientras titila sobre la tiza. Todo cosmético:
 * nada de esto decide nada del sorteo, y todo es función de `t` y del plan.
 */

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

/** El contexto que arma el kit, con un azar sembrado y los textos del juego (como en bolillas-arte.test.ts). */
function contexto(n: number, ganadores: number[], semilla = 7): Contexto {
  const rng = sembrar(semilla);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda: RONDA,
    rng,
    idioma: "es",
    txt: TEXTOS_TXT,
    azar: (etiqueta) => azarDe(RONDA, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

/** Los textos en español, con sus funciones: igual que en bolillas-arte.test.ts. */
const TEXTOS_TXT = (clave: string, ...args: unknown[]): string => {
  const v = (TEXTOS.es as Record<string, string | ((...a: unknown[]) => string)>)[clave];
  return typeof v === "function" ? v(...args) : (v ?? clave);
};

/** La lista de todo el show: el mismo plan que corre en la escena. */
const datosDe = (n: number, ganadores: number[], semilla = 7): Datos => planBolillas(contexto(n, ganadores, semilla)).datos;

const fuente = (f: string): string => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
/** La fuente sin comentarios: para mirar el código y no los avisos. */
const codigo = (f: string): string => fuente(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("bolillas-emocion (S13): las chispas del choque", () => {
  const d = datosDe(8, [3]);
  const tiro = d.tiros[0] as NonNullable<ReturnType<typeof d.tiros.at>>;

  it("cada impacto suelta sus chispas de vidrio: la misma tirada, las mismas chispas (sin azar propio)", () => {
    const a = chispasDe(3, tiro.impacto, tiro.salida.dir);
    expect(a).toEqual(chispasDe(3, tiro.impacto, tiro.salida.dir));
    expect(a.length).toBe(CHISPAS_N);
    for (const i of [0, 5, 11]) expect(chispasDe(i, tiro.impacto, tiro.salida.dir)).toEqual(chispasDe(i, tiro.impacto, tiro.salida.dir));
  });

  it("son cortas: a más de su vida no queda ninguna, y ninguna chispa muere tarde", () => {
    for (const i of [0, 3, 9]) {
      for (const c of chispasDe(i, tiro.impacto, tiro.salida.dir)) {
        expect(c.vida).toBeGreaterThan(0);
        expect(c.vida).toBeLessThanOrEqual(CHISPA_VIDA);
        expect(c.largo).toBeGreaterThan(0);
        // Corren más que el polvo (son vidrio, no tierra) pero no se van del campo.
        const velocidad = Math.hypot(c.dx, c.dy);
        expect(velocidad).toBeGreaterThan(0.3);
        expect(velocidad).toBeLessThan(1.4);
      }
    }
  });

  it("salen por donde viaja la canica golpeada: el brillo sigue al golpe, no vuelve para atrás", () => {
    const dir = tiro.salida.dir;
    const proyectado =
      chispasDe(3, tiro.impacto, dir).reduce((s, c) => s + c.dx * dir.x + c.dy * dir.y, 0) / CHISPAS_N;
    expect(proyectado).toBeGreaterThan(0);
    // La escena 2D las dibuja con el reloj del plan, junto al polvo del impacto.
    const f = codigo("bolillas.ts");
    expect(f).toMatch(/chispasDe\(/);
    expect(f).not.toMatch(/Math\.random/);
  });
});

describe("bolillas-emocion (S13): el choque se oye de verdad", () => {
  const d = datosDe(8, [3]);

  /** Los eventos sonoros únicos del show, con su definición. */
  const todos = (): Map<string, ReturnType<typeof eventosDe>[number]> => {
    const v = new Map<string, ReturnType<typeof eventosDe>[number]>();
    for (let t = 0; t <= d.duracion + 2 * VENTANA; t += 0.02) {
      for (const ev of eventosDe(d, t, true)) v.set(ev.clave, ev);
    }
    return v;
  };

  it("el clic del choque va con un volumen que se oye (clímax), y su brillo salta apenas después", () => {
    const v = todos();
    const choques = [...v.values()].filter((ev) => ev.clave.startsWith("choque:"));
    const brillos = [...v.values()].filter((ev) => ev.clave.startsWith("brillo:"));
    expect(choques.length).toBe(d.tiros.length);
    expect(brillos.length).toBe(d.tiros.length);
    for (const ev of choques) {
      expect(ev.cat).toBe("climax");
      expect(ev.vol ?? 0).toBeGreaterThanOrEqual(0.08);
    }
    for (const ev of brillos) {
      expect(ev.cat).toBe("climax");
      expect(ev.vol ?? 0).toBeGreaterThanOrEqual(0.08);
      // La chispa del vidrio llega apenas después del clic (el mismo momento, el destello).
      expect(ev.retrasoMs ?? 0).toBeGreaterThan(0);
    }
    // El eco queda detrás del clic, sin esconderlo.
    for (const ev of [...v.values()].filter((x) => x.clave.startsWith("eco:"))) {
      expect(ev.vol ?? 0).toBeLessThan((choques[0] as { vol: number }).vol);
    }
  });

  it("todo cabe en la voz del estadio, y con el mudo no suena nada", () => {
    const v = todos();
    for (const ev of v.values()) {
      expect(problemasDeTono(ev.grado, ev.cat, { vol: ev.vol, dur: ev.dur })).toEqual([]);
    }
    expect(eventosDe(d, (d.tiros[0] as NonNullable<ReturnType<typeof d.tiros.at>>).t + 0.01, false)).toEqual([]);
  });
});

describe("bolillas-emocion (S14): el peso del acercamiento a la ganadora", () => {
  const d = datosDe(8, [3]);

  it("la cámara entra con el rodado del casi y se queda hasta el final (S32)", () => {
    // Antes del casi, la cámara del director; al llegar la canica a la tiza, la toma de cerca; con el golpe, otra vez la del director.
    expect(cercaDe(d, d.casi.t - 0.01)).toBe(0);
    expect(cercaDe(d, d.casi.t)).toBeGreaterThanOrEqual(0);
    expect(cercaDe(d, d.casi.t + CERCA_ENTRA)).toBe(1);
    expect(cercaDe(d, d.casi.t + CERCA_ENTRA + 0.2)).toBe(1);
    const medio = cercaDe(d, d.casi.t + CERCA_ENTRA / 2);
    expect(medio).toBeGreaterThan(0);
    expect(medio).toBeLessThan(1);
    // Se queda en grande hasta la coronación: el show termina con la canica que gana ocupando la pantalla (S32).
    expect(cercaDe(d, d.duracion - 0.05)).toBe(1);
    expect(cercaDe(d, d.duracion)).toBe(1);
  });

  it("es continua y determinista: función de `t` y del plan, nunca un salto ni una tirada de moneda", () => {
    let previa = cercaDe(d, d.casi.t - 0.05);
    for (let t = d.casi.t; t <= d.duracion + 0.5; t += 0.01) {
      const v = cercaDe(d, t);
      expect(Math.abs(v - previa)).toBeLessThan(0.05);
      previa = v;
    }
    expect(cercaDe(d, d.casi.t + 0.7)).toBe(cercaDe(d, d.casi.t + 0.7));
  });

  it("el 2D lo usa solo para retirar sus chips cuando la cámara 3D se va de la toma del director", () => {
    const f = codigo("bolillas.ts");
    expect(f).toMatch(/cercaDe\(/);
    expect(f).toMatch(/en3d/);
  });
});
