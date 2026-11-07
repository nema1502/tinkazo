import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { problemasDeMomentos } from "./kit/director";
import { validarGuion } from "./kit/guion";
import { problemasDeMarcador } from "./kit/marcador";
import { DIRECCIONES, problemasDeRespuestas } from "./kit/respuestas";
import type { Contexto, Kit } from "./kit/tipos";
import {
  CANICA_R,
  CANICAS_MAX,
  CIRCULO_R,
  PEGADORA_DIST,
  aMundo,
  adentro,
  mapeoDe,
  planBolillas,
  salidaDe,
  trayectoriaDe,
  type Datos,
  type Oleada,
  type Pant,
  type Pun,
  type Tiro,
} from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

/** El contexto que arma el kit, con un azar sembrado y los textos del juego. */
function contexto(n: number, ganadores: number[], semilla = 7, idioma: "es" | "en" = "es"): Contexto {
  const rng = sembrar(semilla);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda: RONDA,
    rng,
    idioma,
    txt: (clave, ...args) => {
      const v = (TEXTOS[idioma] as Record<string, string | ((...a: unknown[]) => string)>)[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (etiqueta) => azarDe(RONDA, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

const LISTAS = [2, 3, 8, 12, 13, 18, 60, 200];
const ganadoresDe = (n: number): number[] => [Math.min(n - 1, 3)];
const PANTALLAS: Pant[] = [
  { w: 1920, h: 1080, k: 1.5, top: 82, bottom: 974 },
  { w: 1280, h: 720, k: 1, top: 82, bottom: 614 },
  { w: 390, h: 844, k: 0.93, top: 100, bottom: 726 },
  // El mismo celular de la denuncia, acostado: el encuadre también se mira en landscape (S16).
  { w: 844, h: 390, k: 1, top: 40, bottom: 350 },
];

/** Un kit de mentira con lo que usan las tomas y el foco. */
const kitFalso = (p: Pant): Kit =>
  ({
    pantalla: () => ({ ...p, retrato: p.h > p.w * 1.1 }),
    cam: { toScreen: (x: number, y: number) => ({ x, y }) },
  }) as unknown as Kit;

/** La distancia de un punto al tramo `a`-`b`: la geometría que miran los choques. */
function distSeg(p: Pun, a: Pun, b: Pun): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + f * dx), p.y - (a.y + f * dy));
}

const escalar = (v: Pun, k: number): Pun => ({ x: v.x * k, y: v.y * k });
const restar = (a: Pun, b: Pun): Pun => ({ x: a.x - b.x, y: a.y - b.y });
const modulo = (p: Pun): number => Math.hypot(p.x, p.y);
const HOLGURA = CANICA_R * 2 + 0.02;

/** Quién puede chocar a una canica que viaja de `a` a `b`: las adentro en ese segundo, menos ella misma, dónde están de verdad (una canica que ya tiró se movió de su siembra, S23). */
function adentroEn(d: Datos, t: number, menos?: number): { persona: number; p: Pun }[] {
  return adentro(d, t)
    .filter((i) => i !== menos)
    .map((i) => ({ persona: i, p: trayectoriaDe(d, d.canicas.indexOf(i), t).p }));
}

describe("Bolillas: el plan", () => {
  it("la misma ronda cuenta lo mismo: el plan es una función de la lista y la semilla", () => {
    for (const n of LISTAS) {
      const resumir = (): string => {
        const p = planBolillas(contexto(n, ganadoresDe(n)));
        return JSON.stringify({ d: p.duracion, a: p.arco, x: p.datos, g: p.guion.map((l) => [l.t, l.texto, l.prioridad, l.hecho]), r: p.respuestas(p.duracion / 2) });
      };
      expect(resumir(), `con ${n}`).toBe(resumir());
    }
  });

  it("otras semillas cuentan otras historias", () => {
    const arcos = new Set(Array.from({ length: 24 }, (_, s) => planBolillas(contexto(18, [3], s + 1)).arco));
    expect(arcos.size).toBeGreaterThan(1);
  });

  it("el juego no decide nada: quien gana sale dado, y su canica es la última que queda adentro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)].filter((x) => x < n)]) {
        const { datos: d, duracion } = planBolillas(contexto(n, gs));
        expect(d.ganador).toBe(gs[0]);
        // Las canicas dentro del círculo: los premios, y nunca más que el cap del círculo.
        expect(d.canicas.length).toBeLessThanOrEqual(CANICAS_MAX);
        for (const g of gs) expect(d.canicas, `con ${n}`).toContain(g);
        // Todos los que no ganan salen una sola vez: por oleada (la tanda previa) o por un tiro en la troya.
        const afuera = Array.from({ length: n }, (_, i) => i).filter((i) => !gs.includes(i));
        const tiempos = afuera.map((i) => salidaDe(d, i));
        for (const i of afuera) {
          const s = salidaDe(d, i);
          expect(s, `con ${n}: quien sale salió de a una ola o de un tiro`).toBeLessThanOrEqual(duracion);
        }
        // Nadie está en dos oleadas, ni en una oleada y un tiro.
        const oleadaDe = new Map<number, number>();
        d.oleadas.forEach((o, wi) => {
          for (const i of o.gente) expect(oleadaDe.has(i), `con ${n}`).toBe(false);
          for (const i of o.gente) oleadaDe.set(i, wi);
        });
        for (const t of d.tiros) expect(oleadaDe.has(t.diana), `con ${n}: el tiro saca a quien ya cruzó`).toBe(false);
        const cruzados = [...oleadaDe.keys(), ...d.tiros.map((t) => t.diana)].sort((a, b) => a - b);
        expect(cruzados, `con ${n}`).toEqual(afuera);
        expect(tiempos.every((s) => s !== null && s !== undefined && s >= 0 && s <= duracion), `con ${n}`).toBe(true);
        // Quien gana no sale nunca, y al final solo quedan los premios adentro.
        for (const g of gs) expect(salidaDe(d, g)).toBeNull();
        expect(adentro(d, duracion).sort((a, b) => a - b), `con ${n}`).toEqual([...gs].sort((a, b) => a - b));
      }
    }
  });

  it("los tiros sacan de a una, en orden sembrado, con la rival al final", () => {
    for (const n of LISTAS) {
      const { datos: d } = planBolillas(contexto(n, ganadoresDe(n)));
      const dianas = d.tiros.map((t) => t.diana);
      expect(new Set(dianas).size).toBe(dianas.length);
      for (const t of d.tiros) expect(d.ganadores, `con ${n}: el tiro saca a un premio`).not.toContain(t.diana);
      // Los tiros van un segundo o más aparte y en orden creciente.
      for (let i = 1; i < d.tiros.length; i++) expect((d.tiros[i]?.t ?? 0) - (d.tiros[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(1);
      // La rival de la historia sale en el último tiro de la troya (cuando su canica juega).
      if (d.rival >= 0 && d.canicas.includes(d.rival)) expect(dianas.at(-1)).toBe(d.rival);
    }
  });

  it("dura lo que un show: ni un parpadeo ni una eternidad", () => {
    for (const n of LISTAS) {
      const { duracion } = planBolillas(contexto(n, ganadoresDe(n)));
      expect(duracion).toBeGreaterThanOrEqual(10);
      expect(duracion).toBeLessThanOrEqual(40);
    }
  });

  it("los momentos de la cámara están en orden", () => {
    for (const n of LISTAS) expect(problemasDeMomentos(planBolillas(contexto(n, ganadoresDe(n)))), `con ${n}`).toEqual([]);
  });

  it("el guion no deja huecos de cuatro segundos, y cumple la regla del niño: six words, a name at most, no numbers", () => {
    for (const n of LISTAS) {
      const c = contexto(n, ganadoresDe(n));
      const p = planBolillas(c);
      const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
      expect(r.problemas, `con ${n}`).toEqual([]);
      expect(r.huecoMax, `con ${n}`).toBeLessThanOrEqual(4);
    }
  });
});

describe("Bolillas: la geometría de los choques", () => {
  it("cada tiro es la cadena de tres cuerpos y la golpeada cruza la tiza por delante (S21/S23)", () => {
    for (const n of LISTAS) {
      const { datos: d } = planBolillas(contexto(n, ganadoresDe(n)));
      for (const t of d.tiros) {
        // La mano larga de afuera y pega en MI canica, donde está de verdad cuando la toca.
        expect(modulo(t.desde), `la mano de ${t.tirador} larga afuera`).toBeGreaterThan(CIRCULO_R);
        const enChoque = trayectoriaDe(d, t.mio, t.tMano - 1e-6).p;
        expect(t.choque.x, `choque de ${t.tirador}`).toBeCloseTo(enChoque.x, 6);
        expect(t.choque.y, `choque de ${t.tirador}`).toBeCloseTo(enChoque.y, 6);
        // Mi canica rueda y golpea a la del enemigo donde ella está; el impacto es ese punto.
        const enEmpuje = trayectoriaDe(d, t.slot, t.t - 1e-6).p;
        expect(t.empuje.donde.x, `empuje de ${t.tirador} a ${t.diana}`).toBeCloseTo(enEmpuje.x, 6);
        expect(t.impacto.x).toBeCloseTo(t.empuje.donde.x, 9);
        expect(t.impacto.y).toBeCloseTo(t.empuje.donde.y, 9);
        // La salida sigue adelante sobre la línea del empuje y cruza la tiza de ese lado (S21): nunca vuelve.
        expect(t.salida.dir.x * t.empuje.dir.x + t.salida.dir.y * t.empuje.dir.y, `salida de ${t.diana} contra el empuje`).toBeGreaterThan(0.9);
        expect(modulo(t.salida.tiza)).toBeCloseTo(CIRCULO_R, 6);
        expect((t.salida.tiza.x - t.empuje.donde.x) * t.empuje.dir.x + (t.salida.tiza.y - t.empuje.donde.y) * t.empuje.dir.y).toBeGreaterThan(0);
        expect(t.salida.fuerza).toBeGreaterThan(0);
        expect(t.deflexion.dir.x * t.deflexion.dir.x + t.deflexion.dir.y * t.deflexion.dir.y).toBeCloseTo(1, 6);
      }
    }
  });

  it("ningún tramo de tiro roza a una canica que sigue adentro, y a quien gana nunca lo toca el juego", () => {
    const HOLGURA = CANICA_R * 2 + 0.02;
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        for (const t of d.tiros) {
          const h = HOLGURA;
          // La mano entra y el empuje rueda: ninguno roza a quien sigue adentro (mi canica va en la cadena y la del
          // enemigo es la que sale, así que no cuentan).
          for (const c of adentroEn(d, t.tMano, t.diana).filter((x) => x.persona !== t.tirador)) {
            const deMano = distSeg(c.p, t.desde, t.choque);
            expect(deMano, `la mano del tiro de ${t.diana} a los ${t.t.toFixed(1)}: la canica de ${c.persona} queda a ${deMano.toFixed(3)}`).toBeGreaterThanOrEqual(h - 1e-9);
          }
          // El empuje y la salida buscan la holgura completa; cuando el círculo está lleno y la salida tiene que ir
          // adelante (S21), el plan se queda con el mejor aire: lo que garantiza siempre es no pisar a nadie.
          for (const c of adentroEn(d, t.t, t.diana).filter((x) => x.persona !== t.tirador)) {
            const deEmpuje = distSeg(c.p, t.choque, t.empuje.hasta);
            const deSalida = distSeg(c.p, t.empuje.donde, t.salida.tiza);
            expect(deEmpuje, `el empuje del tiro de ${t.diana}: la canica de ${c.persona} queda a ${deEmpuje.toFixed(3)}`).toBeGreaterThanOrEqual(CANICA_R * 2 - 1e-9);
            expect(deSalida, `salida de ${t.diana}: la canica de ${c.persona} queda a ${deSalida.toFixed(3)}`).toBeGreaterThanOrEqual(CANICA_R * 2 - 1e-9);
          }
        }
        // La deflectación tampoco termina sobre nadie: la mano rebota contra mi canica, que ya rueda, y se frena libre.
        for (const t of d.tiros) {
          for (const c of adentroEn(d, t.t, t.diana).filter((x) => x.persona !== t.tirador)) {
            expect(modulo(restar(c.p, t.deflexion.hasta)), `deflex del tiro de ${t.diana} contra ${c.persona}`).toBeGreaterThanOrEqual(CANICA_R * 2 - 1e-9);
          }
        }
      }
    }
  });

  it("el casi final: la canica que gana titila sobre la tiza y no cruza nunca", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        expect(modulo(d.casi.titila), `con ${n}`).toBeLessThanOrEqual(CIRCULO_R - CANICA_R * 1.05 + 1e-9);
        // La ganadora titila SOBRE la tiza, no a mitad de camino (T16): su centro queda a TITILA_R del centro.
        expect(modulo(d.casi.titila), `con ${n}: el casi llega al aro`).toBeCloseTo(CIRCULO_R - CANICA_R * 1.1, 6);
        const slotG = d.canicas.indexOf(d.ganador);
        // Antes del casi está en su lugar de la siembra; con el golpe quedó en el punto de la orilla, adentro.
        const inicio = trayectoriaDe(d, slotG, d.casi.t - 0.01);
        expect(inicio.p.x, `con ${n}: el casi arranca donde quedó la ganadora`).toBeCloseTo(d.casi.desde.x, 6);
        const fin = trayectoriaDe(d, slotG, d.duracion);
        expect(fin.p.x).toBeCloseTo(d.casi.titila.x, 9);
        expect(fin.p.y).toBeCloseTo(d.casi.titila.y, 9);
        // En todo el tramo, la canica que gana queda adentro del círculo.
        for (let t = d.casi.t; t <= d.duracion + 0.01; t += 0.05) {
          const q = trayectoriaDe(d, slotG, t).p;
          expect(modulo(q)).toBeLessThanOrEqual(CIRCULO_R + 1e-9);
        }
      }
    }
  });

  it("la canica golpeada vuela desde su lugar hasta la tiza y después queda afuera", () => {
    for (const n of LISTAS) {
      const { datos: d } = planBolillas(contexto(n, ganadoresDe(n)));
      const t = d.tiros[Math.floor(d.tiros.length / 2)];
      if (!t) continue;
      const antes = trayectoriaDe(d, t.slot, t.t - 0.01);
      expect(antes.p.x).toBeCloseTo(t.empuje.donde.x, 6);
      const medio = trayectoriaDe(d, t.slot, t.t + (t.salida.vuelo / 2));
      // Sale adelante sobre el rumbo del empuje: se aleja del punto del golpe, nunca vuelve hacia la mano.
      const avance = (medio.p.x - t.empuje.donde.x) * t.salida.dir.x + (medio.p.y - t.empuje.donde.y) * t.salida.dir.y;
      expect(avance).toBeGreaterThan(0);
      expect(modulo(medio.p)).toBeLessThanOrEqual(CIRCULO_R + 1e-9);
      const despues = trayectoriaDe(d, t.slot, t.t + t.salida.vuelo + 5);
      expect(modulo(despues.p)).toBeCloseTo(modulo(t.salida.tiza), 6);
      expect(antes.p.x).not.toBeCloseTo(despues.p.x, 6);
    }
  });
});

describe("Bolillas: la cadena del turno (S23)", () => {
  it("el que tira está adentro, no se saca a sí mismo, y los turnos rotan", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        for (const t of d.tiros) {
          expect(adentro(d, t.t), `con ${n} semilla ${s}: tira ${t.tirador}`).toContain(t.tirador);
          expect(t.tirador, `con ${n}: nadie se saca a sí mismo`).not.toBe(t.diana);
          expect(t.mio, `con ${n}: la canica que empuja es la mía`).toBe(d.canicas.indexOf(t.tirador));
          expect(t.mio).not.toBe(t.slot);
          expect(t.tMano).toBeGreaterThan(0);
          expect(t.tMano).toBeLessThan(t.t);
        }
        // Los turnos rotan (S23): nadie tira dos veces seguidas, salvo el cierre (lo tira quien gana) y el caso en
        // que ningún otro puede empujar sin pisar una canica: ahí manda el empuje limpio, y a lo sumo pasa una vez.
        const repetidos = d.tiros.filter((t, i) => i > 0 && i < d.tiros.length - 1 && t.tirador === d.tiros[i - 1]?.tirador);
        expect(repetidos.length, `con ${n}: los turnos dejan de rotar`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("el último turno lo tira quien gana y saca a la rival; el casi arranca donde quedó su canica", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        const ultimo = d.tiros.at(-1);
        expect(ultimo, `con ${n}`).toBeDefined();
        if (!ultimo) continue;
        expect(ultimo.tirador, `con ${n} semilla ${s}: el cierre lo tira quien gana`).toBe(d.ganador);
        expect(ultimo.mio).toBe(d.canicas.indexOf(d.ganador));
        expect(ultimo.diana).toBe(d.rival);
        // Su canica quedó adentro, empujada, y el casi sigue desde ahí.
        expect(modulo(ultimo.empuje.hasta) + CANICA_R).toBeLessThanOrEqual(CIRCULO_R + 1e-9);
        expect(d.casi.desde.x).toBeCloseTo(ultimo.empuje.hasta.x, 6);
        expect(d.casi.desde.y).toBeCloseTo(ultimo.empuje.hasta.y, 6);
        const fin = trayectoriaDe(d, d.casi.slot, ultimo.t + 1e-4);
        expect(fin.p.x).toBeCloseTo(ultimo.empuje.hasta.x, 6);
      }
    }
  });

  it("mi canica se frena adentro y a dos radios del enemigo (nunca se va con él)", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        for (const t of d.tiros) {
          expect(modulo(t.empuje.hasta) + CANICA_R, `con ${n}: mi canica se queda adentro`).toBeLessThanOrEqual(CIRCULO_R + 1e-9);
          const separacion = modulo(restar(t.empuje.donde, t.empuje.hasta));
          expect(separacion, `con ${n}: mi canica no pisa a la del enemigo`).toBeGreaterThanOrEqual(CANICA_R * 2 - 1e-9);
          expect(t.empuje.vuelo).toBeGreaterThan(0);
          expect(t.empuje.vuelo).toBeLessThanOrEqual(t.t - t.tMano + 1e-9);
          // El rumbo del empuje apunta a la canica del enemigo desde la mía.
          const alEnemigo = restar(t.empuje.donde, t.choque);
          const largo = modulo(alEnemigo) || 1;
          // Apunta al enemigo: se abre apenas para no rozar a nadie, nunca más de lo que deja ver la cadena.
          expect((alEnemigo.x * t.empuje.dir.x + alEnemigo.y * t.empuje.dir.y) / largo, `con ${n}: el empuje apunta al enemigo`).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it("quien tira dos veces arranca el segundo empuje donde quedó el primero", () => {
    let visto = 0;
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        for (let i = 0; i < d.tiros.length; i++) {
          const t = d.tiros[i] as Tiro;
          const previo = d.tiros.slice(0, i).filter((x) => x.tirador === t.tirador).at(-1);
          if (!previo) continue;
          visto++;
          expect(t.choque.x, `con ${n} semilla ${s}: ${t.tirador} tira desde donde quedó`).toBeCloseTo(previo.empuje.hasta.x, 6);
          expect(t.choque.y).toBeCloseTo(previo.empuje.hasta.y, 6);
        }
      }
    }
    expect(visto, "hay listas donde alguien tira dos veces").toBeGreaterThan(0);
  });
});

describe("Bolillas: el círculo y las tandas", () => {
  it("las canicas siembran adentro del círculo, separadas entre sí y lejos de la tiza", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planBolillas(contexto(n, ganadoresDe(n), s));
        const sep = CANICA_R * 2 + 0.1;
        for (const pos of d.posiciones) {
          expect(modulo(pos), `con ${n} semilla ${s}`).toBeLessThanOrEqual(CIRCULO_R - CANICA_R * 1.05 + 1e-9);
          expect(modulo(pos)).toBeGreaterThan(0);
        }
        for (let i = 0; i < d.posiciones.length; i++) {
          for (let j = i + 1; j < d.posiciones.length; j++) {
            expect(modulo(restar(d.posiciones[i] as Pun, d.posiciones[j] as Pun)), `canicas ${i} y ${j} con ${n}`).toBeGreaterThan(sep - 0.06);
          }
        }
      }
    }
  });

  it("con pocas personas todas juegan la troya; con muchas hay una tanda previa que deja el círculo completo", () => {
    for (const n of [2, 3, 12]) {
      const { datos: d } = planBolillas(contexto(n, ganadoresDe(n)));
      expect(d.oleadas, `con ${n}`).toHaveLength(0);
      expect(d.canicas.length).toBe(n);
    }
    for (const n of LISTAS.filter((x) => x > CANICAS_MAX)) {
      const { datos: d } = planBolillas(contexto(n, ganadoresDe(n)));
      expect(d.oleadas.length, `con ${n}`).toBeGreaterThanOrEqual(1);
      expect(d.oleadas.length).toBeLessThanOrEqual(3);
      expect(d.canicas.length).toBe(CANICAS_MAX);
      // Las oleadas cruzan a todos los que no juegan la troya, y ninguna canica del círculo se cruzó.
      const cruzados = d.oleadas.flatMap((o) => o.gente);
      expect(new Set(cruzados).size).toBe(cruzados.length);
      for (const i of d.canicas) expect(cruzados, `con ${n}`).not.toContain(i);
      for (let i = 1; i < d.oleadas.length; i++) expect((d.oleadas[i]?.t ?? 0) - (d.oleadas[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("Bolillas: para las escenas", () => {
  it("mapear la tierra deja el círculo entero dentro de la franja libre, en todas las pantallas", () => {
    for (const pant of PANTALLAS) {
      const m = mapeoDe(pant);
      const c = aMundo(m, { x: 0, y: 0 });
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(pant.w);
      expect(c.y).toBeGreaterThan(pant.top);
      expect(c.y).toBeLessThan(pant.bottom);
      expect(m.e * CIRCULO_R).toBeLessThan(Math.min(pant.w / 2, (pant.bottom - pant.top) / 2));
    }
  });

  it("el encuadre de cerca (S16): el círculo mide más que antes y sigue entrando entero, también en landscape", () => {
    for (const p of PANTALLAS) {
      const zona = p.bottom - p.top;
      // El encuadre de antes: la cuenta vieja de `mapeoDe`, para exigir que el nuevo se vea más cerca.
      const antes = Math.min(p.w * 0.42, zona * 0.44);
      const m = mapeoDe(p);
      expect(m.e, `más cerca en ${p.w}x${p.h}`).toBeGreaterThan(antes);
      // Sigue inscripto en la franja libre, con aire: la tiza no toca ningún borde.
      expect(m.cx - m.e, `borde izquierdo en ${p.w}x${p.h}`).toBeGreaterThanOrEqual(4);
      expect(m.cx + m.e, `borde derecho en ${p.w}x${p.h}`).toBeLessThanOrEqual(p.w - 4);
      expect(m.cy - m.e, `borde de arriba en ${p.w}x${p.h}`).toBeGreaterThanOrEqual(p.top + 4);
      expect(m.cy + m.e, `borde de abajo en ${p.w}x${p.h}`).toBeLessThanOrEqual(p.bottom - 4);
    }
  });

  it("la mano de la pegadora queda fuera del círculo y el tiro viaja más de lo que mide el radio", () => {
    expect(PEGADORA_DIST).toBeGreaterThan(CIRCULO_R + 0.1);
    for (const n of LISTAS) {
      const { datos: d } = planBolillas(contexto(n, ganadoresDe(n)));
      for (const t of d.tiros) {
        const largo = modulo(restar(t.salida.tiza, t.impacto));
        expect(largo, `con ${n}`).toBeGreaterThan(0);
        expect(t.salida.vuelo).toBeGreaterThan(0);
      }
    }
  });
});

describe("Bolillas: la regla del niño", () => {
  it("un solo sentido de avance, y es uno de los que existen", () => {
    for (const n of LISTAS) expect(DIRECCIONES).toContain(planBolillas(contexto(n, ganadoresDe(n))).sentido);
  });

  it("el marcador es el único contador: arranca en todos, baja con las oleadas y con cada canica, y llega a 1", () => {
    for (const n of LISTAS) {
      const p = planBolillas(contexto(n, ganadoresDe(n)));
      const pasoMax = Math.max(1, ...p.datos.oleadas.map((o) => o.gente.length));
      expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax }), `con ${n}`).toEqual([]);
      if (n <= CANICAS_MAX) expect(pasoMax).toBe(1);
    }
  });

  it("las respuestas dicen quién va adelante, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)].filter((x) => x < n)]) {
        const p = planBolillas(contexto(n, gs));
        expect(problemasDeRespuestas(p, { n, ganadores: gs, paso: 0.05 }), `con ${n}`).toEqual([]);
        const r = p.respuestas(p.datos.casi.t + 0.3);
        expect(r.paso, `con ${n}`).toMatchObject({ tipo: "casi", quien: p.datos.ganador });
      }
    }
  });

  it("la meta (el círculo de tiza) cae dentro de la pantalla en todas las pantallas", () => {
    for (const n of LISTAS) {
      const p = planBolillas(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        for (const t of [0, p.duracion / 2, p.duracion - 0.01]) {
          const m = p.momentos.meta?.(kitFalso(pant), t);
          expect(m, `con ${n}`).toBeTruthy();
          if (m) {
            expect(m.x).toBeGreaterThanOrEqual(-1);
            expect(m.x + m.w).toBeLessThanOrEqual(pant.w + 1);
            expect(m.y).toBeGreaterThanOrEqual(pant.top - 1);
            expect(m.y + m.h).toBeLessThanOrEqual(pant.bottom + 1);
          }
        }
      }
    }
  });
});

describe("Bolillas: los textos", () => {
  it("están en español y en inglés, con las mismas claves y del mismo tipo", () => {
    const es = Object.keys(TEXTOS.es).sort();
    expect(Object.keys(TEXTOS.en).sort()).toEqual(es);
    for (const clave of es) {
      const a = (TEXTOS.es as Record<string, unknown>)[clave];
      const b = (TEXTOS.en as Record<string, unknown>)[clave];
      expect(typeof a).toBe(typeof b);
    }
  });

  it("ninguna frase queda vacía ni rompe la regla del niño en ninguno de los dos idiomas", () => {
    for (const idioma of ["es", "en"] as const) {
      const c = contexto(18, [3], 7, idioma);
      const p = planBolillas(c);
      expect(validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres }).problemas, idioma).toEqual([]);
    }
  });
});

describe("Bolillas: la toma de la persecución (S24)", () => {
  it("la persecución de la ganadora tiene su toma, después del tiro y antes de la tensión", () => {
    for (const n of LISTAS) {
      const plan = planBolillas(contexto(n, ganadoresDe(n)));
      const ultimo = plan.datos.tiros.at(-1);
      if (!ultimo) continue;
      const tomas = (plan.momentos.tomas ?? []).map((toma) => toma.desde);
      expect(tomas, `con ${n}: la toma de la persecución`).toContain(ultimo.tMano);
      expect(Math.max(...tomas), `con ${n}: es la última toma`).toBe(ultimo.tMano);
      expect(plan.momentos.tension?.desde ?? Infinity, `con ${n}: la tensión llega después`).toBeGreaterThan(ultimo.tMano);
    }
  });
});
