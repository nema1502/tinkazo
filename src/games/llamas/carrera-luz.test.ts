import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ctxDe } from "./carrera-prueba";
import { planCarrera } from "./carrera-show";
import { FICHA_ECHADA, LAVADO, contraste, lavar, luminancia, luzDe, sobre, type ZonaDeSuelo } from "./carrera-luz";

/** Los colores de la marca del estadio (`pixi/stage.ts`): tinta, crema y amarillo. */
const INK = 0x191919, CREAM = 0xf6efe2, YELLOW = 0xffc629;
/** La lana más clara y la más oscura de las llamas (`PELAJES` de `llama.ts`, que arrastra PixiJS y no se puede cargar en Node). */
const LANA_CLARA = 0xf3ead8, LANA_OSCURA = 0x5b3a29;
const ZONAS: ZonaDeSuelo[] = ["corral", "cuesta", "barro", "piedras", "viento", "recta"];
const leer = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8");

describe("la luz de la carrera cambia con el tema y solo cambia colores", () => {
  it("el claro es un día y el oscuro es el atardecer de siempre", () => {
    const dia = luzDe("claro"), noche = luzDe("oscuro");
    // El cielo de día es más claro en todo su largo, el del atardecer queda como estaba.
    dia.franjas.forEach((c, i) => expect(luminancia(c)).toBeGreaterThan(luminancia(noche.franjas[i] as number)));
    expect(noche.franjas[0]).toBe(0x1d2248);
    expect(noche.horizonte).toBe(0xd98a64);
    expect(noche.terreno.recta).toBe(0xa05d48);
    // De día hay nieve en los cerros y el sol está alto y a la izquierda; de noche, bajo y a la derecha.
    expect(dia.nieve).toBe(true);
    expect(noche.nieve).toBe(false);
    expect(dia.sol.x).toBeLessThan(0.5);
    expect(noche.sol.x).toBeGreaterThan(0.5);
    expect(dia.luzSol.desde[1]).toBeGreaterThan(noche.luzSol.desde[1]);
    // Las dos paletas tienen los seis terrenos.
    for (const luz of [dia, noche]) for (const z of ZONAS) expect(Number.isInteger(luz.terreno[z]) && Number.isInteger(luz.acento[z])).toBe(true);
    // Y el piso de día es otro color que el de noche en cada tramo.
    for (const z of ZONAS) expect(dia.terreno[z]).not.toBe(noche.terreno[z]);
  });

  it("el piso de la recta de día es un tono medio: la llama blanca y la oscura se separan de él", () => {
    const recta = luzDe("claro").terreno.recta;
    expect(leer("./llama.ts")).toContain("export const PELAJES = [0xf3ead8, 0xa0683a, 0xe4c99a, 0x5b3a29,");
    expect(contraste(recta, LANA_CLARA)).toBeGreaterThanOrEqual(2.5);
    expect(contraste(recta, LANA_OSCURA)).toBeGreaterThanOrEqual(2.5);
  });

  it("el pelo de las llamas es el mismo en los dos temas (la escena solo pinta el mundo)", () => {
    expect(luzDe("claro")).not.toBe(luzDe("oscuro"));
    expect(Object.keys(luzDe("claro")).sort()).toEqual(Object.keys(luzDe("oscuro")).sort());
  });
});

describe("el contraste de lo que se lee, con y sin la pantalla lavada de un proyector", () => {
  const lavado = (a: number, b: number): number => contraste(lavar(a), lavar(b));

  it("la tinta, la crema y el amarillo de arriba son los de `stage.ts`", () => {
    const stage = leer("../pixi/stage.ts");
    expect(stage).toContain("export const INK = 0x191919;");
    expect(stage).toContain("export const CREAM = 0xf6efe2;");
    expect(stage).toContain("export const YELLOW = 0xffc629;");
  });

  it("el filtro de `?lavado=1` de la hoja de estilos es el que modela `lavar`", () => {
    const css = leer("../../styles.css");
    expect(css).toContain(`html[data-lavado="1"] .stadium { filter: contrast(${LAVADO.contraste}) brightness(${LAVADO.brillo}); }`);
    // El negro puro sube a un 20 % de gris.
    expect(lavar(0x000000) & 255).toBe(Math.round(255 * 0.2 * LAVADO.brillo));
  });

  it("el cartel del ganador (tinta sobre amarillo) pasa 7 a 1 y, lavado, 4,5 a 1 (texto grande)", () => {
    expect(contraste(INK, YELLOW)).toBeGreaterThanOrEqual(7);
    expect(lavado(INK, YELLOW)).toBeGreaterThanOrEqual(4.5);
  });

  it("la bandera a cuadros de la meta (tinta y blanco) pasa 4,5 a 1, lavada también", () => {
    expect(contraste(INK, 0xffffff)).toBeGreaterThanOrEqual(4.5);
    expect(lavado(INK, 0xffffff)).toBeGreaterThanOrEqual(4.5);
  });

  for (const tema of ["claro", "oscuro"] as const) {
    const luz = luzDe(tema);
    // Lo peor que le puede pasar a una ficha: estar sobre cada piso o sobre cada franja del cielo.
    const fondos: [string, number][] = [...ZONAS.map((z): [string, number] => [`el piso de ${z}`, luz.terreno[z]]), ...luz.franjas.map((c, i): [string, number] => [`la franja ${i} del cielo`, c])];
    for (const [donde, fondo] of fondos) {
      it(`${tema}: el nombre en una ficha sobre ${donde} se lee a 4,5 a 1, también lavado`, () => {
        const placa = sobre(INK, luz.fichaAlfa, fondo);
        expect(contraste(CREAM, placa)).toBeGreaterThanOrEqual(4.5);
        expect(lavado(CREAM, placa)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${tema}: la ficha de quien se echó (gris oscuro con letra crema) se lee a 4,5 a 1 sobre cada piso, lavada también`, () => {
      for (const z of ZONAS) {
        const placa = sobre(FICHA_ECHADA, luz.fichaEchadaAlfa, luz.terreno[z]);
        expect(contraste(CREAM, placa)).toBeGreaterThanOrEqual(4.5);
        expect(lavado(CREAM, placa)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("el plan no lee el tema: la misma ronda cuenta la misma carrera de día y de noche", () => {
  const guardados = { document: (globalThis as Record<string, unknown>).document, matchMedia: (globalThis as Record<string, unknown>).matchMedia };
  afterEach(() => {
    (globalThis as Record<string, unknown>).document = guardados.document;
    (globalThis as Record<string, unknown>).matchMedia = guardados.matchMedia;
  });

  /** Lo que el plan decide, medido en muchos instantes: quién va adelante, el puntaje de cada una, las caídas, la recta y los obstáculos. */
  function huella(n: number, semilla: number, tema: "light" | "dark"): string {
    // El tema como lo ve la página: por `data-theme` y por `prefers-color-scheme`.
    (globalThis as Record<string, unknown>).document = { documentElement: { dataset: { theme: tema } } };
    (globalThis as Record<string, unknown>).matchMedia = () => ({ matches: tema === "dark" });
    const d = planCarrera(ctxDe(n, semilla)).datos;
    const horas = Array.from({ length: 80 }, (_, i) => (d.tCrown * i) / 79);
    const qs = [0, 0.1, 0.25, 0.5, 0.7, 0.88, 0.95, 1];
    return JSON.stringify({
      lanes: d.lanes, gente: d.gente, campeona: d.campeona, tiempos: [d.tVuelo, d.tNombres, d.tSalida, d.tAbre, d.tCrown, d.t80, d.total, d.distAbre],
      tramos: d.tramos, cinta: d.cinta, sucesos: d.sucesos, cambiosDePunta: d.cambiosDePunta, adelante: d.lineasAdelante, tandas: d.tandas,
      caen: [...d.tiempos.cae].map(([q, t]) => [q, Number.isFinite(t) ? t : -1]), echadas: d.tiempos.echadas,
      lider: horas.map((t) => d.lider(t)), duena: horas.map((t) => d.duena(t)), vivas: horas.map((t) => d.vivas(t).length), frac: horas.map((t) => d.frac(t)),
      puntajes: horas.map((t) => d.gente.map((g) => d.orden.puntaje(g, t))),
      recta: d.lanes.map((_, carril) => qs.map((q) => d.final.pos(carril, q))), q: horas.map((t) => d.q(t)),
      obstaculos: d.final.obstaculos ?? [],
    });
  }

  for (const n of [8, 18, 60, 200]) {
    for (const semilla of [1, 2, 3]) {
      it(`con ${n} personas y la semilla ${semilla}: las posiciones, los obstáculos y los tiempos son los mismos con el tema claro y el oscuro`, () => {
        const claro = huella(n, semilla, "light");
        const oscuro = huella(n, semilla, "dark");
        expect(claro.length).toBeGreaterThan(1000);
        expect(claro).toBe(oscuro);
      });
    }
  }

  it("ningún archivo del plan nombra el tema ni importa la luz: solo lo leen las escenas que pintan", () => {
    const planes = ["carrera-show.ts", "carrera-orden.ts", "carrera-tiempos.ts", "carrera-recta.ts", "carrera-obstaculos.ts", "carrera-tandas.ts", "carrera-cierre.ts", "carrera-ritmo.ts", "plan.ts", "peloton-plan.ts"];
    for (const f of planes) {
      const fuente = leer(`./${f}`);
      expect(fuente, f).not.toMatch(/carrera-luz|matchMedia|dataset\.theme|\.dark\b|"claro"|"oscuro"/);
    }
  });

  it("el 3D recibe el tema y lo usa solo para colores y luces: ninguna posición sale de `luz`", () => {
    const tres = leer("./carrera-3d.ts");
    expect(tres).toContain("luzDe(o.tema)");
    // La luz entra por estos usos y ningún otro: color, niebla, hemisférica, sol, base, tribuna y cerros.
    const usos = [...tres.matchAll(/(?<![-\w])luz\.([a-zA-Z]+)/g)].map((m) => m[1]);
    expect(new Set(usos)).toEqual(new Set(["horizonte", "hemi", "luzSol", "cenit", "medio", "alto", "solDisco", "base", "tribuna", "cerros", "nieve", "acento", "charco", "matas"]));
  });
});
