import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Game } from "../state";
import { ARCHIVOS } from "./archivos";
import { JUEGOS_CON_BANCO, archivosDe, decidir, gradoDe, ganador, pesoDe, ponerBuffer, ponerJuego, reiniciar, type Disparo } from "./banco";

/** Los diez del selector (`scripts/lib/juegos.mjs`). */
const SELECTOR: Game[] = ["race", "sapo", "trompo", "chovena", "pinata", "wheel", "teleferico", "oruro", "guajojo", "toborochi"];

const PUBLIC = resolve(__dirname, "../../public/sonidos");
const falso = (seg = 1): AudioBuffer => ({ duration: seg }) as AudioBuffer;

/** Carga buffers falsos para todo lo que un juego pide. */
function cargarTodo(g: Game): void {
  for (const id of archivosDe(g)) ponerBuffer(id, Array.from({ length: ARCHIVOS[id]?.n ?? 1 }, () => falso()));
}

const nota = (grado: number): number => {
  const escala = [0, 2, 4, 7, 9];
  return 130.81 * Math.pow(2, ((escala[grado % 5] as number) + 12 * Math.floor(grado / 5)) / 12);
};
const disparo = (grado: number, d: number, tipo: Disparo["tipo"], g: number): Disparo => ({ f: nota(grado), d, tipo, g });

describe("el banco: el mapa está completo", () => {
  it("cada juego del selector tiene su mapa, su ganador y sus voces", () => {
    for (const g of SELECTOR) {
      const j = JUEGOS_CON_BANCO[g];
      expect(j, g).toBeDefined();
      expect(ARCHIVOS[j!.ganador], `${g}: ganador`).toBeDefined();
      expect(archivosDe(g).length, g).toBeGreaterThan(8);
    }
  });

  it("nada apunta a un archivo que no existe", () => {
    for (const g of SELECTOR) {
      const j = JUEGOS_CON_BANCO[g]!;
      const usados = [j.ganador, ...j.reglas.map((r) => r.usa), j.viento, j.colibri].filter((x): x is string => !!x);
      for (const id of usados) {
        const sigue = j.reglas.find((r) => r.usa === id)?.sigue === true;
        const claves = sigue ? [`${id}-lo`, `${id}-hi`] : [id];
        for (const c of claves) expect(ARCHIVOS[c], `${g} usa ${c}`).toBeDefined();
      }
      for (const id of archivosDe(g)) {
        const a = ARCHIVOS[id];
        expect(a, `${g}: ${id} no está en el índice`).toBeDefined();
        const [carpeta, nombre] = id.split("/") as [string, string];
        for (let i = 0; i < a!.n; i++) {
          const f = resolve(PUBLIC, carpeta, `${nombre}${a!.n > 1 ? `-${i + 1}` : ""}.mp3`);
          expect(existsSync(f), `falta ${f}`).toBe(true);
          // El índice dice lo que pesa el archivo de verdad.
          expect(Math.abs(statSync(f).size / 1024 - (a!.kb[i] as number)), f).toBeLessThan(0.2);
        }
      }
    }
  });

  it("los pesos están dentro del tope: menos de 450 KB por juego, efectos de menos de 60 KB y de 3 s", () => {
    for (const g of SELECTOR) expect(pesoDe(g), `${g}: ${pesoDe(g).toFixed(0)} KB`).toBeLessThan(450);
    for (const [id, a] of Object.entries(ARCHIVOS)) {
      for (const kb of a.kb) expect(kb, id).toBeLessThan(60);
      for (const d of a.dur) expect(d, id).toBeLessThanOrEqual(3);
    }
  });

  it("la música de archivo no está en el índice: no viaja con el repositorio", () => {
    for (const id of Object.keys(ARCHIVOS)) expect(id.endsWith("/musica"), id).toBe(false);
  });

  it("las voces con tono traen su altura medida", () => {
    for (const [id, a] of Object.entries(ARCHIVOS)) if (/-(lo|hi)$/.test(id)) expect(a.hz, id).toBeGreaterThan(80);
  });

  it("hay una licencia para los archivos", () => {
    expect(existsSync(resolve(PUBLIC, "LICENCIA.md"))).toBe(true);
    expect(existsSync(resolve(PUBLIC, "PROMPTS.md"))).toBe(true);
  });
});

describe("el banco: qué suena en lugar de qué", () => {
  beforeEach(() => reiniciar());

  it("sin juego elegido, o sin archivos cargados, suena el oscilador", () => {
    expect(decidir(disparo(0, 0.2, "sine", 0.06), 0)).toBeNull();
    ponerJuego("pinata");
    expect(decidir(disparo(0, 0.2, "sine", 0.06), 0)).toBeNull();
    expect(ganador()).toBeNull();
  });

  it("la rotura de la piñata suena a rotura y apaga la lluvia de caramelos que ya trae adentro", () => {
    ponerJuego("pinata");
    cargarTodo("pinata");
    const rotura = decidir(disparo(0, 0.45, "square", 0.09), 1000);
    expect(rotura).not.toBeNull();
    expect(rotura).not.toBe("silencio");
    expect((rotura as { id: string }).id).toBe("pinata/rotura");
    // Los diez tintineos de la lluvia caen dentro del archivo.
    expect(decidir(disparo(11, 0.04, "triangle", 0.03), 1100)).toBe("silencio");
    // Pasado el tiempo, vuelven a sonar como cualquier nota.
    const despues = decidir(disparo(11, 0.04, "triangle", 0.03), 1800);
    expect(despues).not.toBe("silencio");
  });

  it("el palo contra la piñata y el casco de la llama se reconocen por su firma", () => {
    ponerJuego("pinata");
    cargarTodo("pinata");
    expect((decidir(disparo(2, 0.12, "square", 0.054), 0) as { id: string }).id).toBe("pinata/palo");
    ponerJuego("race");
    cargarTodo("race");
    expect((decidir(disparo(0, 0.05, "triangle", 0.022), 0) as { id: string }).id).toBe("race/casco");
    expect((decidir(disparo(3, 0.05, "square", 0.022), 0) as { id: string }).id).toBe("race/casco");
  });

  it("lo que no tiene regla suena con la voz del instrumento, afinado a la nota", () => {
    ponerJuego("sapo");
    cargarTodo("sapo");
    for (const [grado, onda, voz] of [
      [12, "triangle", "comun/kalimba"],
      [14, "sine", "comun/campana"],
      [5, "sawtooth", "comun/zampona"],
    ] as const) {
      const f = nota(grado);
      const j = decidir({ f, d: 0.2, tipo: onda, g: 0.04 }, 0) as { id: string; rate: number };
      expect(j.id, `${grado} ${onda}`).toBe(voz);
      const ref = (voz: string): number => (ARCHIVOS[`${voz}-lo`]!.hz! + 0) * 1;
      const hz = [ARCHIVOS[`${voz}-lo`]!.hz!, ARCHIVOS[`${voz}-hi`]!.hz!];
      // La nota que suena es la pedida: la velocidad de reproducción por la altura del archivo da `f`.
      expect(hz.some((h) => Math.abs(h * j.rate - f) < 0.01 * f)).toBe(true);
      void ref;
    }
  });

  it("el ganador y el golpe suenan siempre igual: sin azar, con el contador reiniciado por sorteo", () => {
    ponerJuego("race");
    cargarTodo("race");
    const a = [0, 1, 2, 3, 4].map(() => (decidir(disparo(0, 0.05, "triangle", 0.022), 0) as { buffer: AudioBuffer }).buffer);
    ponerJuego("race");
    const b = [0, 1, 2, 3, 4].map(() => (decidir(disparo(0, 0.05, "triangle", 0.022), 0) as { buffer: AudioBuffer }).buffer);
    expect(a).toEqual(b);
    expect(ganador()?.id).toBe("race/ganador");
    const golpe = decidir(disparo(0, 0.7, "sine", 0.09), 0) as { id: string };
    expect(golpe.id).toBe("comun/impacto");
  });

  it("un archivo que no llegó deja sonar el oscilador, sin hueco", () => {
    ponerJuego("pinata");
    cargarTodo("pinata");
    ponerBuffer("pinata/palo", []);
    // La regla del palo no tiene archivo: no se reemplaza por otra cosa que no sea la de siempre.
    expect(decidir(disparo(2, 0.12, "square", 0.054), 0)).toBeNull();
  });

  it("el grado se lee de la frecuencia", () => {
    expect(gradoDe(nota(0))).toBe(0);
    expect(gradoDe(nota(12))).toBe(12);
    expect(gradoDe(nota(19))).toBe(19);
    expect(gradoDe(300)).toBe(-1);
  });
});
