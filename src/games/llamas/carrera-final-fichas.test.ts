import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { tiemposFoco } from "../pixi/foco";
import { FINISH_POST_FADE_AFTER, FINISH_POST_FADE_BEFORE, FINISH_POST_MIN_OPACITY, finishPostOpacity } from "./carrera-3d-mapa";
import { FICHA, estadoNuevo, pasoFicha, type EstadoFicha, type ObjetivoFicha } from "./carrera-fichas-mov";
import { MAX_NARROW_START_CHIPS, START_CHIP_TURN_SECONDS, finalChipDecision, startChipShows } from "./carrera-final-fichas";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";

/**
 * El final del 3D: cuando el cartel de quien ganó está en pantalla solo queda su ficha, y antes del cruce
 * ninguna ficha se distingue por ser la de quien va a ganar. La decisión es función de la hora; el fundido
 * es el del movimiento de las fichas, así que el mismo cuadro sale igual avanzando paso a paso y saltando.
 */

vi.setConfig({ testTimeout: 600_000 });

const FPS = 60;
const TAMANOS = [8, 18, 60];
const SEMILLAS = [1, 2, 3];

const objetivoDe = (d: Datos, persona: number, t: number, boardAt: number): ObjetivoFicha => ({
  ox: 0,
  oy: 0,
  visible: finalChipDecision(persona, d.campeona, t, d.tCrown, t >= boardAt).shows,
  llama: 0,
});

/** Avanza todas las fichas cuadro por cuadro desde una hora antes del cruce hasta después del cartel. */
function avanzando(d: Datos, boardAt: number, hasta: number): Map<number, EstadoFicha> {
  const desde = d.tCrown - 1;
  const estados = new Map<number, EstadoFicha>();
  for (const persona of d.lanes) estados.set(persona, estadoNuevo(desde, objetivoDe(d, persona, desde, boardAt)));
  for (let i = 1; i / FPS <= hasta - desde + 1e-9; i++) {
    const t = desde + i / FPS;
    for (const persona of d.lanes) estados.set(persona, pasoFicha(estados.get(persona) as EstadoFicha, t, objetivoDe(d, persona, t, boardAt), 1));
  }
  return estados;
}

describe("la largada en pantalla angosta", () => {
  it("la escena del 3D usa este tope para las fichas de la largada, con la formación de salida antes de la salida", () => {
    const fuente = readFileSync(new URL("./carrera.ts", import.meta.url), "utf8");
    expect(fuente).toContain("startChipShows(f.persona, ordenLargada, P.retrato, t, d.tSalida, d.tAbre)");
    expect(fuente).toContain("[...d.gente].sort((a, b2) => d.orden.rango(a) - d.orden.rango(b2) || a - b2)");
  });

  it("antes de la salida, en ningún instante hay más fichas que el tope y nunca van dos llamas vecinas de la formación", () => {
    expect(START_CHIP_TURN_SECONDS).toBeGreaterThanOrEqual(1.2);
    for (const n of [8, 18, 60]) {
      for (const s of SEMILLAS) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const formacion = [...d.gente].sort((a, b) => d.orden.rango(a) - d.orden.rango(b) || a - b);
        for (let t = 0; t < d.tSalida; t += 0.05) {
          const quedan = formacion.filter((persona) => startChipShows(persona, formacion, true, t, d.tSalida, d.tAbre));
          expect(quedan.length, `n=${n} semilla ${s} t=${t.toFixed(2)}`).toBeLessThanOrEqual(MAX_NARROW_START_CHIPS);
          const lugares = quedan.map((persona) => formacion.indexOf(persona));
          for (let i = 0; i < lugares.length; i++) {
            for (let j = i + 1; j < lugares.length; j++) {
              expect(Math.abs((lugares[i] as number) - (lugares[j] as number)), `n=${n} semilla ${s} t=${t.toFixed(2)}`).toBeGreaterThan(1);
            }
          }
        }
      }
    }
  });

  it("con 18 personas todas se muestran al menos una vez antes de la salida, cada una un turno entero o más", () => {
    for (const s of SEMILLAS) {
      const d = planCarrera(ctxDe(18, s)).datos;
      const formacion = [...d.gente].sort((a, b) => d.orden.rango(a) - d.orden.rango(b) || a - b);
      for (const persona of formacion) {
        let primera = Infinity, ultima = -Infinity;
        for (let t = 0; t < d.tSalida; t += 0.05) {
          if (startChipShows(persona, formacion, true, t, d.tSalida, d.tAbre)) {
            primera = Math.min(primera, t);
            ultima = Math.max(ultima, t);
          }
        }
        expect(primera, `semilla ${s} persona ${persona}`).toBeLessThan(d.tSalida);
        // Su primer turno dura entero antes de la salida: entre su primera y su última muestra de ese turno pasa el turno completo.
        expect(ultima - primera, `semilla ${s} persona ${persona}`).toBeGreaterThanOrEqual(START_CHIP_TURN_SECONDS - 0.1);
      }
    }
  });

  it("el turno sale solo de la hora y del lugar en la formación: dos corridas dan lo mismo", () => {
    const d = planCarrera(ctxDe(18, 1)).datos;
    const formacion = [...d.gente].sort((a, b) => d.orden.rango(a) - d.orden.rango(b) || a - b);
    const corrida = (): boolean[][] => {
      const filas: boolean[][] = [];
      for (let t = 0; t < d.tAbre; t += 0.1) filas.push(formacion.map((persona) => startChipShows(persona, formacion, true, t, d.tSalida, d.tAbre)));
      return filas;
    };
    expect(corrida()).toEqual(corrida());
  });

  it("en pantalla ancha se muestran todas, antes y después de la salida", () => {
    for (const n of [18, 60]) {
      for (const s of SEMILLAS) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const formacion = [...d.gente].sort((a, b) => d.orden.rango(a) - d.orden.rango(b) || a - b);
        for (const t of [0, d.tSalida / 2, d.tSalida, (d.tSalida + d.tAbre) / 2, d.tAbre]) {
          for (const persona of d.gente) {
            expect(startChipShows(persona, formacion, false, t, d.tSalida, d.tAbre), `n=${n} semilla ${s} t=${t.toFixed(2)}`).toBe(true);
          }
        }
      }
    }
  });

  it("desde la salida quedan solo las primeras en pista hasta que se abre la recta; en carriles, todas", () => {
    for (const n of [18, 60]) {
      for (const s of SEMILLAS) {
        const d = planCarrera(ctxDe(n, s)).datos;
        // El orden de prioridad de una hora de la largada: el mismo para cualquier nombre que se le ponga a quien va a ganar,
        // porque esta cuenta no recibe a la ganadora.
        const frontFirst = [...d.gente].sort((a, b) => ((a * 37 + s * 11) % n) - ((b * 37 + s * 11) % n));
        const tLargada = (d.tSalida + d.tAbre) / 2;
        const quedan = frontFirst.filter((persona) => startChipShows(persona, frontFirst, true, tLargada, d.tSalida, d.tAbre));
        expect(quedan, `n=${n} semilla ${s}`).toEqual(frontFirst.slice(0, MAX_NARROW_START_CHIPS));
        // La ganadora solo queda si su lugar en la pista en esa hora está entre los primeros: no entra por serlo.
        expect(quedan.includes(d.campeona), `n=${n} semilla ${s}`).toBe(frontFirst.indexOf(d.campeona) < MAX_NARROW_START_CHIPS);
        for (const persona of d.gente) {
          expect(startChipShows(persona, frontFirst, true, d.tAbre, d.tSalida, d.tAbre), `recta n=${n} semilla ${s}`).toBe(true);
        }
      }
    }
  });

  it("las que quedan fuera se apagan con el fundido de siempre y vuelven cuando se abre la recta, igual avanzando y saltando", () => {
    const start = 10, lanesOpen = 25;
    const frontFirst = Array.from({ length: 18 }, (_, i) => i);
    const fuera = frontFirst[MAX_NARROW_START_CHIPS] as number;
    const objetivo = (t: number): ObjetivoFicha => ({ ox: 0, oy: 0, visible: startChipShows(fuera, frontFirst, true, t, start, lanesOpen), llama: 0 });
    let e = estadoNuevo(start - 1, objetivo(start - 1));
    for (let i = 1; i / FPS <= lanesOpen + FICHA.enciende + 2 / FPS - (start - 1) + 1e-9; i++) {
      const t = start - 1 + i / FPS;
      e = pasoFicha(e, t, objetivo(t), 1);
      if (Math.abs(t - (start + FICHA.apaga + 1 / FPS)) < 1e-9) expect(e.alfa, "ya se apagó en la largada").toBe(0);
    }
    expect(e.alfa, "con los carriles abiertos ya volvió").toBe(1);
    const salto = pasoFicha(estadoNuevo(start - 1, objetivo(start - 1)), lanesOpen + FICHA.enciende + 2 / FPS, objetivo(lanesOpen + FICHA.enciende + 2 / FPS), 1);
    expect([salto.alfa, salto.ox, salto.oy]).toEqual([e.alfa, e.ox, e.oy]);
  });
});

describe("el final de las fichas del 3D", () => {
  it("la escena del 3D usa esta decisión para las fichas", () => {
    const fuente = readFileSync(new URL("./carrera.ts", import.meta.url), "utf8");
    expect(fuente).toContain("finalChipDecision(q, d.campeona, t, d.tCrown, k.coronado)");
    const fuente3d = readFileSync(new URL("./carrera-3d.ts", import.meta.url), "utf8");
    expect(fuente3d).toContain("finishPostOpacity(e.corona)");
  });

  it("el poste de la meta se apaga un poco solo en el cruce y vuelve solo, igual para cualquier ganadora", () => {
    expect(finishPostOpacity(-FINISH_POST_FADE_BEFORE - 1)).toBe(1);
    expect(finishPostOpacity(-FINISH_POST_FADE_BEFORE)).toBe(1);
    expect(finishPostOpacity(0)).toBeCloseTo(FINISH_POST_MIN_OPACITY, 9);
    expect(finishPostOpacity(FINISH_POST_FADE_AFTER / 2)).toBeGreaterThan(FINISH_POST_MIN_OPACITY);
    expect(finishPostOpacity(FINISH_POST_FADE_AFTER / 2)).toBeLessThan(1);
    expect(finishPostOpacity(FINISH_POST_FADE_AFTER)).toBe(1);
    expect(finishPostOpacity(10)).toBe(1);
    // La misma hora da la misma opacidad en cualquier camino.
    for (const crown of [-1, -0.35, 0, 0.7, 1.4, 3]) expect(finishPostOpacity(crown)).toBe(finishPostOpacity(crown));
  });

  for (const n of TAMANOS) {
    it(`con ${n} personas: con el cartel solo queda la ficha de quien ganó, y antes del cruce ninguna se distingue`, () => {
      for (const s of SEMILLAS) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const boardAt = d.tCrown + tiemposFoco(d.final.story.arc).golpe;
        // Antes del cruce, la ficha de quien va a ganar es idéntica en todo a la de cualquier otra.
        for (let t = Math.max(0, d.tCrown - 3); t < d.tCrown; t += 1 / FPS) {
          const ganadora = finalChipDecision(d.campeona, d.campeona, t, d.tCrown, false);
          for (const persona of d.lanes) {
            if (persona === d.campeona) continue;
            expect(finalChipDecision(persona, d.campeona, t, d.tCrown, false), `n=${n} semilla ${s} t=${t.toFixed(2)}`).toEqual(ganadora);
          }
        }
        // Desde el cruce, y nunca antes, solo la ficha de quien ganó va dorada y por encima de las demás.
        for (const t of [d.tCrown, d.tCrown + 0.5, boardAt]) {
          const ganadora = finalChipDecision(d.campeona, d.campeona, t, d.tCrown, t >= boardAt);
          expect([ganadora.gold, ganadora.onTop], `n=${n} semilla ${s} t=${t.toFixed(2)}`).toEqual([true, true]);
          for (const persona of d.lanes) {
            if (persona === d.campeona) continue;
            const otra = finalChipDecision(persona, d.campeona, t, d.tCrown, t >= boardAt);
            expect([otra.gold, otra.onTop], `n=${n} semilla ${s} t=${t.toFixed(2)} persona ${persona}`).toEqual([false, false]);
          }
        }
        // Con el cartel, el destino visible es solo el de quien ganó.
        for (const persona of d.lanes) {
          expect(finalChipDecision(persona, d.campeona, boardAt, d.tCrown, true).shows, `n=${n} semilla ${s} persona ${persona}`).toBe(persona === d.campeona);
        }
        // Recorriendo el final cuadro por cuadro, el fundido de siempre apaga a las demás y deja a la ganadora entera.
        const hasta = boardAt + FICHA.apaga + 2 / FPS;
        const estados = avanzando(d, boardAt, hasta);
        for (const persona of d.lanes) {
          const alfa = (estados.get(persona) as EstadoFicha).alfa;
          if (persona === d.campeona) expect(alfa, `n=${n} semilla ${s}: la ganadora`).toBe(1);
          else expect(alfa, `n=${n} semilla ${s} persona ${persona}`).toBe(0);
        }
        // Los dos caminos dan el mismo cuadro: saltar directo a esa hora deja las mismas transparencias que avanzar.
        const desde = d.tCrown - 1;
        for (const persona of d.lanes) {
          const salto = pasoFicha(estadoNuevo(desde, objetivoDe(d, persona, desde, boardAt)), hasta, objetivoDe(d, persona, hasta, boardAt), 1);
          const pasoAPaso = estados.get(persona) as EstadoFicha;
          expect([salto.alfa, salto.ox, salto.oy], `n=${n} semilla ${s} persona ${persona}`).toEqual([pasoAPaso.alfa, pasoAPaso.ox, pasoAPaso.oy]);
        }
      }
    });
  }
});
