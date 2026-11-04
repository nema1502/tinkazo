import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planEntrada } from "../pixi/entrada-plan";
import { crearMapa } from "./camara";
import { hash } from "./ids";
import {
  AZIM, ELEV, N_BAILE, N_CAIDA, N_MUSICA, N_SALUDO, N_TROPIEZO, ZC_ORURO, cuadroBaile, cuadroCaida, cuadroMusica, cuadroSalto, cuadroSaludo, cuadroTropiezo,
  luzDelGolpe, perfilOruro, suave, tumbado, type MundoOruro,
} from "./oruro-3d-tipos";
import { compararPuestos, ganaIgual, type Puesto2D } from "./prueba";

/**
 * La Entrada en 3D no decide nada: dibuja lo que `pixi/oruro.ts` ya decidió. Estas pruebas cuidan que los bailarines de
 * cartón caigan donde el 2D los pone y en el mismo orden, que la cámara no mueva el mundo al subir o bajar, que el 3D no
 * sepa quién gana antes del golpe y que el archivo del juego en 2D no traiga three.js.
 */

const aqui = new URL(".", import.meta.url);
const dosD = readFileSync(new URL("../pixi/oruro.ts", import.meta.url), "utf8");
const archivos3D = readdirSync(aqui).filter((f) => /^oruro-3d.*\.ts$/.test(f) && !f.endsWith(".test.ts"));

/** Un generador con semilla, sin `Math.random`. */
const rngDe = (semilla: number) => {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

describe("el archivo del juego en 2D no trae three.js", () => {
  it("solo importa del 3D los tipos, el enchufe y las cuentas puras", () => {
    const lineas = dosD.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l) && /tres\//.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      if (/tres\/(oruro-3d|tipos)"/.test(l)) expect(l).toMatch(/^\s*import\s+type\b/);
      else if (/tres\/oruro-3d-tipos/.test(l)) expect(l).not.toMatch(/three/);
      else expect(l).toContain("tres/enchufe");
    }
  });

  it("las cuentas puras del 3D no nombran three.js (solo el tipo de la cámara, por camara.ts)", () => {
    const t = readFileSync(new URL("./oruro-3d-tipos.ts", import.meta.url), "utf8");
    expect(t).not.toMatch(/from "three"/);
  });
});

describe("el 3D no decide nada ni sabe quién gana antes del golpe", () => {
  it("ningún archivo del 3D de La Entrada recibe la lista de ganadores ni los nombra", () => {
    for (const f of archivos3D) {
      const t = readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(t, f).not.toMatch(/\bwinners?\b|winnerIdx|rivalIdx/);
    }
  });

  it("el 2D le pasa quién gana recién desde el golpe", () => {
    expect(dosD).toContain("ganador: crowned ? winnerIdx : -1");
    expect(dosD).toContain("golpe: crowned ? tAll - tGolpe : -1");
  });

  it("ningún archivo del 3D de La Entrada nombra Math.random", () => {
    for (const f of archivos3D) {
      const t = readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(t, f).not.toContain("Math.random");
    }
  });

  it("la resolución del atlas es una sola para todos los trajes: la fraternidad del final no se ve más nítida", () => {
    const t = readFileSync(new URL("./oruro-3d-recortes.ts", import.meta.url), "utf8");
    expect(t).toMatch(/const resPedida = \(n: number\): number =>/);
    expect(t).not.toMatch(/resPedida\(n, /);
  });
});

/** Los lugares de los bailarines, con las mismas cuentas que `slotPos`, `frontOffsets` y `rowY` de pixi/oruro.ts. */
function lugaresDeLaComparsa(n: number, w: number, h: number, u: number, hx: number): Puesto2D[] {
  const winners = [Math.min(3, n - 1)];
  const P = planEntrada(n, winners, rngDe(7));
  const maxSize = Math.max(1, ...P.frats.map((f) => f.members.length));
  const scale = Math.min(1.25, Math.max(0.35, Math.sqrt(40 / Math.max(2, n)))) * u;
  const dx = 58 * scale;
  const portrait = h > w;
  const depth = portrait ? Math.min(7, Math.max(1, Math.ceil(Math.sqrt(maxSize * 2)))) : Math.min(5, Math.max(1, Math.ceil(Math.sqrt(maxSize))));
  const streetTop = h * 0.5, streetBot = h - 60 * u;
  const rowY = (row: number): number => {
    const H = streetBot - streetTop;
    return streetTop + H * 0.1 + ((row + 0.5) / depth) * H * 0.8;
  };
  const colsOf = (m: number): number => Math.max(1, Math.ceil(m / depth));
  const widthOf = (cols: number): number => cols * dx + (depth > 1 ? dx * 0.5 : 0);
  const gap = dx * 1.1;
  let x = -(widthOf(3) + gap);
  const out: Puesto2D[] = [];
  for (const gi of P.order) {
    const f = P.frats[gi]!;
    f.members.forEach((idx, slot) => {
      const col = Math.floor(slot / depth), row = slot % depth;
      out.push({ id: idx, x: hx + x - dx * 0.5 - col * dx - (row % 2) * dx * 0.5, y: rowY(row) });
    });
    x -= widthOf(colsOf(f.members.length)) + gap;
  }
  return out;
}

describe("los bailarines de cartón caen donde el 2D los pone", () => {
  const tamanos: [number, number, number][] = [[1366, 768, 768 / 720], [390, 844, Math.min(390 / 420, 844 / 900)], [1920, 1080, 1.5]];
  const mundo = (u: number): MundoOruro => ({ k: u, streetTop: 0, streetBot: 1, x0: 0, x1: 1, doorX: 0, socX: 0, archX: [], escala: 1, oscuro: true });
  const momentos = [
    { t: 1, tramo: "pres" as const, primerPlano: 0, cerca: 0, golpe: -1 },
    { t: 12, tramo: "walk" as const, primerPlano: 0, cerca: 0, golpe: -1 },
    { t: 14, tramo: "walk" as const, primerPlano: 1, cerca: 0, golpe: -1 },
    { t: 22, tramo: "walk" as const, primerPlano: 0, cerca: 1, golpe: -1 },
    { t: 26, tramo: "duel" as const, primerPlano: 0, cerca: 0, golpe: -1 },
    { t: 31, tramo: "crown" as const, primerPlano: 0, cerca: 0, golpe: 0.8 },
  ];
  const horas = { go: 9, socavon: 24, llegada: 29 };

  for (const [w, h, u] of tamanos) {
    for (const n of [2, 5, 18, 50, 200]) {
      it(`a ${w} por ${h} con ${n} personas: la posición vuelve intacta y el orden es el mismo, en cada tramo de la cámara`, () => {
        for (const hx of [0, 700, 2100]) {
          const puestos = lugaresDeLaComparsa(n, w, h, u, hx);
          expect(puestos.length).toBe(n);
          for (const m of momentos) {
            const perfil = perfilOruro({ ...m, horas, mundo: mundo(u) });
            expect(compararPuestos(puestos, perfil, u), `n=${n} t=${m.t} hx=${hx}`).toEqual([]);
          }
        }
      });
    }
  }

  it("quien va adelante en el 2D (más a la derecha) va adelante en el 3D", () => {
    const u = 1;
    const puestos = lugaresDeLaComparsa(30, 1366, 768, u, 500);
    const primero = [...puestos].sort((a, b) => b.x - a.x || a.id - b.id)[0]!;
    expect(ganaIgual(puestos, primero.id, perfilOruro({ ...momentos[1]!, horas, mundo: mundo(u) }), u)).toBe(true);
  });

  it("el mundo no se mueve cuando la cámara sube o baja: la profundidad es la misma en todos los tramos", () => {
    const u = 1.2;
    const zs = new Set(momentos.map((m) => perfilOruro({ ...m, horas, mundo: mundo(u) }).zc));
    expect(zs.size).toBe(1);
    expect([...zs][0]).toBeCloseTo(ZC_ORURO, 12);
    // Y el mismo punto del 2D cae en el mismo lugar del 3D, mire como mire la cámara.
    const a = crearMapa(perfilOruro({ ...momentos[0]!, horas, mundo: mundo(u) }), u).a3D(321, 456, 12);
    const b = crearMapa(perfilOruro({ ...momentos[5]!, horas, mundo: mundo(u) }), u).a3D(321, 456, 12);
    expect(a).toEqual(b);
  });
});

describe("cómo se mira", () => {
  const mundo: MundoOruro = { k: 1, streetTop: 0, streetBot: 1, x0: 0, x1: 1, doorX: 0, socX: 0, archX: [], escala: 1, oscuro: true };
  const horas = { go: 9, socavon: 24, llegada: 29 };

  it("la cámara nunca pasa de 30 grados de altura ni gira más de 20 grados del frente de la calle", () => {
    for (let t = 0; t <= 40; t += 0.25) {
      for (const tramo of ["pres", "walk", "duel", "crown"] as const) {
        for (const primerPlano of [0, 0.5, 1]) {
          for (const cerca of [0, 1]) {
            const p = perfilOruro({ t, tramo, horas, cerca, primerPlano, golpe: tramo === "crown" ? Math.max(0, t - 29) : -1, mundo });
            expect(p.elevacion).toBeGreaterThan(0.1);
            expect(p.elevacion).toBeLessThanOrEqual(0.52);
            expect(Math.abs(p.azimut)).toBeLessThanOrEqual((20 * Math.PI) / 180);
          }
        }
      }
    }
    expect(ELEV.walk).toBeLessThanOrEqual(0.52);
    expect(Math.max(...Object.values(AZIM).map(Math.abs))).toBeLessThanOrEqual(0.35);
  });

  it("es una función de la hora: la misma hora da la misma cámara, vengan los cuadros como vengan", () => {
    const e = { t: 17.3, tramo: "walk" as const, horas, cerca: 0.2, primerPlano: 0.4, golpe: -1, mundo };
    expect(perfilOruro(e)).toEqual(perfilOruro({ ...e }));
  });

  it("antes del golpe la cámara no depende de quién gana: no hay entrada que la haga distinta", () => {
    const a = perfilOruro({ t: 25, tramo: "duel", horas, cerca: 0, primerPlano: 0, golpe: -1, mundo });
    const b = perfilOruro({ t: 25, tramo: "duel", horas, cerca: 0, primerPlano: 0, golpe: -1, mundo: { ...mundo } });
    expect(a).toEqual(b);
  });
});

describe("los cuadros del cartón", () => {
  it("el ciclo del paso recorre todos sus cuadros y vuelve a empezar cada cuatro tiempos de la banda", () => {
    const vistos = new Set<number>();
    for (let f = 0; f < 4 * Math.PI; f += 0.01) vistos.add(cuadroBaile(f));
    expect([...vistos].sort((a, b) => a - b)).toEqual(Array.from({ length: N_BAILE }, (_, i) => i));
    expect(cuadroBaile(0.3)).toBe(cuadroBaile(0.3 + 4 * Math.PI));
    expect(cuadroBaile(-0.01)).toBe(N_BAILE - 1);
  });

  it("el saludo, el tropiezo, la caída y la banda eligen un cuadro que existe", () => {
    for (let i = 0; i < 400; i++) {
      const t = i * 0.173, f = (i % 40) / 30 - 0.1;
      expect(cuadroSaludo(t, hash(i, 3) * 6)).toBeGreaterThanOrEqual(0);
      expect(cuadroSaludo(t, hash(i, 3) * 6)).toBeLessThan(N_SALUDO);
      expect(cuadroTropiezo(f)).toBeGreaterThanOrEqual(0);
      expect(cuadroTropiezo(f)).toBeLessThan(N_TROPIEZO);
      expect(cuadroCaida(f)).toBeGreaterThanOrEqual(0);
      expect(cuadroCaida(f)).toBeLessThan(N_CAIDA);
      expect(cuadroMusica(t * 3)).toBeGreaterThanOrEqual(0);
      expect(cuadroMusica(t * 3)).toBeLessThan(N_MUSICA);
      expect([0, 1]).toContain(cuadroSalto(f * 50));
    }
  });

  it("el cartón se tumba de a poco al sentarse y no se pasa", () => {
    expect(tumbado(0)).toBe(0);
    expect(tumbado(1)).toBe(1);
    for (let f = 0; f < 1; f += 0.05) expect(tumbado(f + 0.05)).toBeGreaterThanOrEqual(tumbado(f));
    expect(suave(0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("la luz del golpe", () => {
  it("antes del golpe nada cambia; baja al 35 % en un cuarto de segundo y vuelve al 60 % mientras se sostiene el cartel", () => {
    expect(luzDelGolpe(-1)).toBe(1);
    expect(luzDelGolpe(0)).toBe(1);
    expect(luzDelGolpe(0.25)).toBeCloseTo(0.35, 12);
    expect(luzDelGolpe(0.125)).toBeLessThan(1);
    expect(luzDelGolpe(0.125)).toBeGreaterThan(0.35);
    expect(luzDelGolpe(1.85)).toBeCloseTo(0.6, 12);
    expect(luzDelGolpe(10)).toBeCloseTo(0.6, 12);
  });
});
