import { readFileSync, readdirSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import vectors from "../docs/vectors.json";
import { poseSeed, poseWinners } from "./pose";
import { listHash } from "./protocol/canonical";
import { select } from "./protocol/select";

/** Lo que hacía la escena fija antes de `?ganador=`, copiado tal cual de src/main.ts. */
function comoAntes(n: number, premios: number): number[] {
  const W3: number[] = [Math.min(3, n - 1)];
  for (let i = 1; W3.length < premios && i < n * 7; i++) {
    const w = (3 + i * 7) % n;
    if (!W3.includes(w)) W3.push(w);
  }
  for (let w = 0; W3.length < premios; w++) if (!W3.includes(w)) W3.push(w);
  return W3;
}

const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`);
/** La lista de ejemplo de la escena fija es la de los vectores del protocolo. */
const SAMPLE = vectors.list;
const texto = (s: string): Uint8Array => sha256(new TextEncoder().encode(s));

describe("la escena fija sin ?ganador= queda como hoy", () => {
  it("el ganador sigue en el puesto 3 y los demás premios donde estaban, con cualquier largo", () => {
    for (const n of [1, 2, 3, 4, 5, 8, 18, 60, 200]) {
      for (const nw of [1, 2, 3, 5, 8, 32]) {
        // Como lo calcula poseScene con `?nw=`.
        const premios = Math.max(1, Math.min(n, nw));
        expect(poseWinners(nombres(n), premios, null)).toEqual(comoAntes(n, premios));
        expect(poseWinners(nombres(n), premios, "")).toEqual(comoAntes(n, premios));
        expect(poseWinners(nombres(n), premios, "   ")).toEqual(comoAntes(n, premios));
      }
    }
    expect(poseWinners(SAMPLE, 1, null)).toEqual([3]);
  });
});

describe("con ?ganador=<semilla>", () => {
  it("con la misma semilla, el mismo puesto", () => {
    for (const s of ["1", "abc", "delatores-42", vectors.quicknet.randomness]) {
      expect(poseWinners(SAMPLE, 1, s)).toEqual(poseWinners(SAMPLE, 1, s));
      expect(poseWinners(SAMPLE, 3, s)).toEqual(poseWinners(SAMPLE, 3, s));
    }
  });

  it("64 hex son el número del faro: ganan los mismos que en el sorteo de verdad (vectores del protocolo)", () => {
    expect(vectors.cases.length).toBeGreaterThan(0);
    for (const c of vectors.cases) {
      expect(poseWinners(SAMPLE, c.k, vectors.quicknet.randomness)).toEqual(c.winners);
      expect(poseWinners(SAMPLE, c.k, vectors.quicknet.randomness.toUpperCase())).toEqual(c.winners);
    }
  });

  it("otro texto se pasa por SHA-256: ?ganador=17 es una semilla, no el puesto 17", () => {
    expect(poseSeed("17")).toEqual(texto("17"));
    expect(poseWinners(SAMPLE, 1, "17")).toEqual(select(texto("17"), listHash(SAMPLE), SAMPLE.length, 1));
    expect(poseSeed(null)).toBeNull();
    expect(poseSeed("")).toBeNull();
  });

  it("doscientas semillas reparten al ganador por toda la lista", () => {
    const veces = new Array<number>(SAMPLE.length).fill(0);
    for (let s = 1; s <= 200; s++) {
      const [w] = poseWinners(SAMPLE, 1, String(s));
      veces[w as number] = (veces[w as number] ?? 0) + 1;
    }
    // Cada puesto gana alguna vez, y el 3 ya no es el de siempre (se esperan unas 11 de 200).
    expect(veces.every((v) => v > 0)).toBe(true);
    expect(veces[3]).toBeLessThan(30);
  });

  it("varios premios: distintos, tantos como se piden y hasta 32, como en un sorteo de verdad", () => {
    const L = nombres(60);
    for (const nw of [1, 3, 8, 32, 40]) {
      const w = poseWinners(L, nw, "semilla");
      expect(w).toHaveLength(Math.min(nw, 32));
      expect(new Set(w).size).toBe(w.length);
      expect(w.every((i) => i >= 0 && i < L.length)).toBe(true);
    }
  });

  it("con la lista de ?n= elige con la huella de esa lista", () => {
    const L = nombres(200);
    expect(poseWinners(L, 2, "x")).toEqual(select(texto("x"), listHash(L), 200, 2));
  });

  it("con una sola persona no hay sorteo que imitar: queda la de siempre", () => {
    expect(poseWinners(["Ana Quispe"], 1, "x")).toEqual([0]);
  });
});

/**
 * Un sorteo de verdad, anclado o libre, elige en src/ui/draw.ts con el número
 * del faro o lee los ganadores del contrato, y no puede leer este parámetro.
 * El navegador no corre en estas pruebas: se mira el código.
 */
describe("un sorteo de verdad no lee ?ganador=", () => {
  const BARRA = String.fromCharCode(92);
  const fuentes = (readdirSync("src", { recursive: true }) as string[])
    .map((f) => f.split(BARRA).join("/"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const leer = (f: string): string => readFileSync(`src/${f}`, "utf8");
  const ganador = /["'`]ganador["'`]/g;

  it("solo la escena fija de src/main.ts lee el parámetro", () => {
    expect(fuentes.filter((f) => leer(f).match(ganador) !== null)).toEqual(["main.ts"]);
    const lineas = leer("main.ts").split(String.fromCharCode(10)).map((l) => l.trimEnd());
    const desde = lineas.indexOf("async function poseScene(): Promise<void> {");
    const hasta = lineas.indexOf("}", desde);
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    const donde = lineas.flatMap((l, i) => (l.match(ganador) ? [i] : []));
    expect(donde.length).toBeGreaterThan(0);
    for (const i of donde) {
      expect(i).toBeGreaterThan(desde);
      expect(i).toBeLessThan(hasta);
    }
  });

  it("y solo ella carga la elección de la escena fija", () => {
    const rutas = [`"./pose"`, `'./pose'`, `"../pose"`, `'../pose'`, `"../../pose"`];
    expect(fuentes.filter((f) => rutas.some((r) => leer(f).includes(r)))).toEqual(["main.ts"]);
  });
});
