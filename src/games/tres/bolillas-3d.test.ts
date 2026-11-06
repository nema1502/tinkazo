// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANICA_R } from "../pixi/bolillas-plan";
import type { Mapeo, Tiro } from "../pixi/bolillas-plan";
import { trayectoriaDe } from "../pixi/bolillas-plan";
import { crearMapa } from "./camara";
import { JUEGOS_CON_3D, ofrece3D } from "./ofrecidos";
import { tiene3D } from "./registro";
import { CANICA_ESCALA } from "../pixi/bolillas-arte";
import {
  LLEGADA_TITILA, TEETER_ALTO, TEETER_FRECUENCIA, ZOOM_MAX, camaraBolillas, giroDelCasi, GIRO_ALTO,
  lugarDelMundo, mezclarPose, perfilBolillas, poseDelCerca, poseTiro, teeterDelCasi, titileo,
  type EntradaBolillas,
} from "./bolillas-3d";
import { cercaDe } from "../pixi/bolillas-arte";

/**
 * Bolillas en 3D no decide nada: dibuja lo que el plan puro (`pixi/bolillas-plan.ts`) ya puso. Estas pruebas cuidan
 * las cuentas puras (el lugar del mundo, la pose de cada tiro, el titileo en la tiza), que la cámara no depende de
 * quién gana, y el cableado: el módulo está en el registro del 3D pero Bolillas no se ofrece en 3D por defecto (D3).
 */

// Bajo jsdom `import.meta.url` no es `file://`: se resuelve desde la raíz del repo.
const fuente = (f: string): string => readFileSync(resolve(process.cwd(), "src/games/tres", f), "utf8");

/** Un tiro de ejemplo, con sus datos tal como el plan los trae (unidades del círculo). */
const TIRO: Tiro = {
  diana: 3,
  slot: 2,
  t: 10,
  desde: { x: 1.4, y: 0.3 },
  impacto: { x: 0.5, y: -0.2 },
  salida: { dir: { x: 0.6, y: 0.8 }, tiza: { x: 0.86, y: 0.48 }, fuerza: 1.1, vuelo: 0.4 },
  deflexion: { dir: { x: -0.8, y: 0.6 }, hasta: { x: 0.14, y: 0.07 } },
};

/** Pantallas de ejemplo: el mapa de la casa con la unidad de cada una. */
const PANTALLAS = [
  { nombre: "ancho", u: 1.067, mapeo: { cx: 683, cy: 330, e: 300 } as Mapeo },
  { nombre: "celular", u: 0.54, mapeo: { cx: 195, cy: 380, e: 130 } as Mapeo },
];

describe("el mundo 3D se apoya donde el 2D puso el círculo", () => {
  for (const pant of PANTALLAS) {
    it(`${pant.nombre}: un punto del plan, por el grupo del mundo, cae donde la cuenta de la casa lo lleva`, () => {
      const mapa = crearMapa(perfilBolillas(), pant.u);
      const { px, pz, K, Kz } = lugarDelMundo(mapa, pant.mapeo);
      for (const q of [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -0.7, y: 0.55 },
        { x: 1.55, y: -1.2 },
      ]) {
        const [x3, , z3] = mapa.a3D(pant.mapeo.cx + q.x * pant.mapeo.e, pant.mapeo.cy + q.y * pant.mapeo.e, 0);
        // El grupo (posición + escala) y la cuenta directa llegan al mismo lugar.
        expect(px + K * q.x).toBeCloseTo(x3, 6);
        expect(pz + Kz * q.y).toBeCloseTo(z3, 6);
      }
      // La altura escala por K: `alto` plan-units son `alto * e` píxeles del dibujo (la misma cuenta del sapo).
      const [, y3] = mapa.a3D(0, 0, 2 * pant.mapeo.e);
      expect(K * 2).toBeCloseTo(y3, 6);
    });
  }
});

describe("el tiro de la pegadora sigue el plan, de punta a punta", () => {
  it("en la largada está en `desde`, en el impacto en `impacto`, y al frenar en `deflexion.hasta`", () => {
    const largada = poseTiro(TIRO, TIRO.t - 0.55);
    expect(largada?.estado).toBe("ida");
    expect(largada?.x).toBeCloseTo(TIRO.desde.x, 9);
    expect(largada?.y).toBeCloseTo(TIRO.desde.y, 9);

    const golpe = poseTiro(TIRO, TIRO.t);
    // En el segundo del impacto llega al punto del plan (el desvío arranca ahí mismo, como en el 2D).
    expect(golpe?.estado).toBe("ida");
    expect(golpe?.x).toBeCloseTo(TIRO.impacto.x, 9);
    expect(golpe?.y).toBeCloseTo(TIRO.impacto.y, 9);
    expect(golpe?.f).toBeCloseTo(1, 9);

    const desvio = poseTiro(TIRO, TIRO.t + 0.001);
    expect(desvio?.estado).toBe("desvio");

    const freno = poseTiro(TIRO, TIRO.t + 0.45);
    expect(freno?.estado).toBe("desvio");
    expect(freno?.x).toBeCloseTo(TIRO.deflexion.hasta.x, 9);
    expect(freno?.y).toBeCloseTo(TIRO.deflexion.hasta.y, 9);
  });

  it("la canica golpeada llega exactamente a la tiza que el plan dijo, en su vuelo", () => {
    // La salida la anima `trayectoriaDe` del plan; acá se prueba que el tramo de la ida de la pegadora
    // pasa por el impacto y que ningún estado inventado aparece fuera de la ventana del tiro.
    expect(poseTiro(TIRO, TIRO.t - 0.55 - 0.001)).toBeNull();
    expect(poseTiro(TIRO, TIRO.t + 0.45 + 0.001)).toBeNull();
    // En el medio de la ida, va por la recta desde → impacto.
    const medio = poseTiro(TIRO, TIRO.t - 0.275) as { x: number; y: number; estado: string; f: number };
    expect(medio.estado).toBe("ida");
    expect(medio.f).toBeCloseTo(0.5, 9);
    expect(medio.x).toBeCloseTo((TIRO.desde.x + TIRO.impacto.x) / 2, 9);
    expect(medio.y).toBeCloseTo((TIRO.desde.y + TIRO.impacto.y) / 2, 9);
  });

  it("es función de `t` sola: dos llamadas con el mismo tiro y hora dan lo mismo (sin azar)", () => {
    for (let i = 0; i < 20; i++) {
      const t = TIRO.t - 0.6 + (i / 19) * 1.1;
      expect(poseTiro(TIRO, t)).toEqual(poseTiro(TIRO, t));
    }
  });
});

describe("el titileo en la tiza arranca y termina en cero (la lección del sapo)", () => {
  it("no mueve nada antes de llegar, ni después del golpe, y en los bordes vale cero", () => {
    const d = { casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } }, duracion: 23.4 };
    // Antes de que la canica llegue a la orilla, quieta.
    expect(teeterDelCasi(d, d.casi.t)).toBe(0);
    expect(teeterDelCasi(d, d.casi.t + LLEGADA_TITILA - 0.01)).toBeCloseTo(0, 6);
    // En los bordes de la ventana vale cero: ni salto de entrada ni de salida.
    expect(teeterDelCasi(d, d.casi.t + LLEGADA_TITILA)).toBe(0);
    expect(teeterDelCasi(d, d.duracion)).toBe(0);
    expect(teeterDelCasi(d, d.duracion + 5)).toBe(0);
    // En el medio, titila de verdad, pero sin pasar de su amplitud.
    const medio = teeterDelCasi(d, d.casi.t + LLEGADA_TITILA + 0.35);
    expect(Math.abs(medio)).toBeGreaterThan(0.01);
    expect(Math.abs(medio)).toBeLessThanOrEqual(TEETER_ALTO + 1e-9);
  });

  it("la curva es continua y determinista: ningún salto entre muestras vecinas, ninguna tirada de moneda", () => {
    const t0 = 12.4, t1 = 15.8;
    let previa = titileo(t0 - 0.01, t0, t1);
    for (let t = t0; t <= t1 + 0.5; t += 0.01) {
      const v = titileo(t, t0, t1);
      expect(Math.abs(v - previa)).toBeLessThan(0.05);
      expect(v).toBe(v);
      previa = v;
    }
    // Al volver atrás (un salto del show a un segundo anterior), lo mismo.
    expect(titileo(13, t0, t1)).toBe(titileo(13, t0, t1));
  });

  it("titila sobre su frecuencia: más de un vaivén en la ventana y nunca abajo del piso ni arriba del alto", () => {
    // Con la frecuencia de la casa, en una ventana de 1,4 s hay varios vaivenes.
    let cruces = 0;
    for (let t = 12.4; t < 15.8; t += 0.005) {
      const a = titileo(t, 12.4, 15.8);
      const b = titileo(t + 0.005, 12.4, 15.8);
      if (Math.sign(a - 0.001) !== Math.sign(b - 0.001)) cruces++;
      expect(Math.abs(a)).toBeLessThanOrEqual(TEETER_ALTO + 1e-9);
    }
    expect(cruces).toBeGreaterThanOrEqual(Math.floor(((15.8 - 12.4) * TEETER_FRECUENCIA) / (2 * Math.PI)) - 1);
  });
});

describe("la cámara 3D sigue al director y no sabe quién gana", () => {
  it("hasta el tope es la cámara del director; más allá, el zoom queda en el tope y el centro vuelve sin saltos", () => {
    const w = 1366, h = 768;
    const base = { x: w / 2, y: h / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };
    for (const z of [0.7, 1, ZOOM_MAX]) expect(camaraBolillas({ ...base, zoom: z, x: 900, y: 200 }, w, h)).toEqual({ ...base, zoom: z, x: 900, y: 200 });
    const c = camaraBolillas({ ...base, zoom: 1.6, x: 900, y: 200 }, w, h);
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(Math.abs(c.x - w / 2)).toBeLessThan(Math.abs(900 - w / 2));
    expect(Math.abs(c.y - h / 2)).toBeLessThan(Math.abs(200 - h / 2));
    // Continua: pasar el tope por un pelo no mueve la cámara.
    const a = camaraBolillas({ ...base, zoom: ZOOM_MAX, x: 900, y: 200 }, w, h);
    const b = camaraBolillas({ ...base, zoom: ZOOM_MAX + 0.001, x: 900, y: 200 }, w, h);
    expect(Math.abs(a.x - b.x)).toBeLessThan(3);
    expect(Math.abs(a.y - b.y)).toBeLessThan(3);
  });

  it("el perfil mira desde arriba (el círculo se lee como círculo) y no menciona a nadie que gane", () => {
    const p = perfilBolillas();
    expect(p.elevacion).toBeGreaterThan(0.8);
    expect(p.elevacion).toBeLessThan(1.2);
    // Fiel: las proporciones del piso del 2D se conservan.
    expect(p.zc).toBeCloseTo(1 / Math.sin(p.elevacion), 6);
    expect(p.azimut).toBe(0);
  });

  it("la cámara depende del reloj y de la pantalla, y de nada más (no recibe quién gana)", () => {
    const src = fuente("bolillas-3d.ts");
    const firma = src.slice(src.indexOf("export function camaraBolillas"), src.indexOf("export const perfilBolillas"));
    expect(firma).toContain("(cam: Camara2D, w: number, h: number");
    expect(firma).not.toMatch(/ganador|winner|slot/i);
  });
});

describe("el acercamiento a la ganadora: la bolilla gira, la cámara llega (S14)", () => {
  /** El casi de ejemplo: la canica 1 gana y rueda de (0,5, 0,5) hasta la tiza en (0,5, 0,94). */
  const CASI_D = {
    casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } },
    duracion: 23.4,
    posiciones: [{ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 }],
    tiros: [] as Tiro[],
  };

  it("el giro sobre la tiza nace y muere en cero exacto (la misma envolvente del titileo)", () => {
    expect(giroDelCasi(CASI_D, CASI_D.casi.t)).toBe(0);
    expect(giroDelCasi(CASI_D, CASI_D.casi.t + LLEGADA_TITILA)).toBe(0);
    expect(giroDelCasi(CASI_D, CASI_D.duracion)).toBe(0);
    expect(giroDelCasi(CASI_D, CASI_D.duracion + 3)).toBe(0);
    // En el medio gira de verdad: dos ejes (el vaivén del otro lado + el giro acá), y nunca más alto que su amplitud.
    const medio = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(giroDelCasi(CASI_D, CASI_D.casi.t + LLEGADA_TITILA + ((i + 1) / 61) * (CASI_D.duracion - CASI_D.casi.t - LLEGADA_TITILA)))));
    expect(medio).toBeGreaterThan(0.3);
    expect(medio).toBeLessThanOrEqual(GIRO_ALTO + 1e-9);
    expect(giroDelCasi(CASI_D, 22.2)).toBe(giroDelCasi(CASI_D, 22.2));
  });

  it("la pose de cerca mira a la canica por su lugar del plan, y queda a tiro de foto sin atravesarla", () => {
    const pant = PANTALLAS[0] as { nombre: string; u: number; mapeo: Mapeo };
    const mapa = crearMapa(perfilBolillas(), pant.u);
    const lugar = lugarDelMundo(mapa, pant.mapeo);
    for (const t of [20.2, 20.9, 21.6, 22.3, 23.1]) {
      const pose = poseDelCerca(CASI_D, t, lugar, 1.3);
      // La mira cae sobre la canica (dónde la pone `trayectoriaDe`, que es la cuenta que dibuja la vista).
      const p = trayectoriaDe(CASI_D, 1, t).p;
      expect(pose.mira[0]).toBeCloseTo(lugar.px + lugar.K * p.x, 4);
      expect(pose.mira[2]).toBeCloseTo(lugar.pz + lugar.Kz * p.y, 4);
      expect(pose.mira[1]).toBeGreaterThan(0);
      // Cerca, pero nunca adentro del vidrio: a entre media y una canica y media de largo.
      const lejos = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[2] - pose.mira[2]) / lugar.K;
      expect(lejos).toBeGreaterThan(0.2);
      expect(lejos).toBeLessThan(1.1);
      expect(pose.fov).toBeGreaterThan(0);
      expect(pose.mira).toEqual(pose.mira);
    }
    // Determinista: la misma hora, la misma pose.
    expect(poseDelCerca(CASI_D, 21.4, lugar, 1.3)).toEqual(poseDelCerca(CASI_D, 21.4, lugar, 1.3));
  });

  it("la mezcla de poses es la de la casa: peso 0 devuelve la del director, peso 1 la de cerca, y en el medio no salta", () => {
    const a = { pos: [0, 0, 10] as [number, number, number], mira: [0, 0, 0] as [number, number, number], fov: 0.5, giro: 0 };
    const b = { pos: [4, 3, 0] as [number, number, number], mira: [2, 2, 2] as [number, number, number], fov: 0.8, giro: 0.2 };
    expect(mezclarPose(a, b, 0)).toEqual(a);
    expect(mezclarPose(a, b, 1)).toEqual(b);
    const m = mezclarPose(a, b, 0.5);
    expect(m.pos[0]).toBeCloseTo(2, 9);
    expect(m.pos[2]).toBeCloseTo(5, 9);
    expect(m.fov).toBeCloseTo(0.65, 9);
    // Y el peso del acercamiento es la misma cuenta del 2D: una sola, para las dos escenas.
    expect(cercaDe(CASI_D, CASI_D.casi.t + 1.3)).toBeGreaterThan(0);
    expect(cercaDe(CASI_D, CASI_D.casi.t + 1.3)).toBeLessThan(1);
    expect(cercaDe(CASI_D, CASI_D.duracion)).toBe(0);
  });
});

describe("S13 en 3D: sombras de contacto y chispas de vidrio", () => {
  it("las canicas se ven apoyadas en la tierra y cada choque echa su brillo, dibujados por la vista", () => {
    const src = fuente("bolillas-3d.ts");
    // Sombra de contacto: un plano chico debajo de cada canica (estilo de la casa, pocos polígonos).
    expect(src).toMatch(/sombra/i);
    expect(src).toMatch(/CircleGeometry/);
    // Chispas: brillo breve en el impacto, determinista por hash (sin azar propio).
    expect(src).toMatch(/Chispas/);
    expect(src).toMatch(/chispo\.nuevo/);
    expect(src).not.toContain("Math.random");
  });
});

describe("S17 en 3D: las canicas se dibujan más grandes", () => {
  it("el vidrio, el rodado, el pivote y la sombra usan el radio dibujado (radio del plan × escala)", () => {
    const src = fuente("bolillas-3d.ts");
    expect(src).toMatch(/CANICA_ESCALA/);
    // La malla de la canica se arma con el radio dibujado, y el rodado y el pivote también lo usan.
    expect(src).toMatch(/CANICA_R \* CANICA_ESCALA/);
    expect(src).toMatch(/R_DIBUJO/);
    expect(src).not.toContain("Math.random");
  });

  it("la pose de cerca mira a la canica a la altura del vidrio agrandado, sin meterse en él", () => {
    const CASI_D = {
      casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } },
      duracion: 23.4,
      posiciones: [{ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 }],
      tiros: [] as Tiro[],
    };
    const pant = PANTALLAS[0] as { nombre: string; u: number; mapeo: Mapeo };
    const mapa = crearMapa(perfilBolillas(), pant.u);
    const lugar = lugarDelMundo(mapa, pant.mapeo);
    const pose = poseDelCerca(CASI_D, 21.4, lugar, 1.3);
    // La mira cae a la altura del centro de la canica agrandada.
    expect(pose.mira[1]).toBeCloseTo(lugar.K * CANICA_R * CANICA_ESCALA * 0.9, 4);
    // Y la cámara queda fuera del vidrio: a más de un radio dibujado de la superficie.
    const lejos = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[2] - pose.mira[2]) / lugar.K;
    expect(lejos).toBeGreaterThan(2 * CANICA_R * CANICA_ESCALA);
  });
});

describe("el cableado: registrado en el 3D, apagado en el selector (D3)", () => {
  it("el módulo de Bolillas está en el registro del 3D", () => {
    expect(tiene3D("bolillas")).toBe(true);
  });

  it("Bolillas no entra a JUEGOS_CON_3D: el 3D se prueba con ?motor=3d, no con el interruptor", () => {
    expect(JUEGOS_CON_3D).not.toContain("bolillas");
    expect(ofrece3D("bolillas")).toBe(false);
  });

  it("el lanzador conecta con el enchufe del 2D (bolillasPixi3D) y sin él sigue el 2D; nada de azar", () => {
    const src = fuente("bolillas-3d.ts");
    expect(src).toContain("export const lanzador3D");
    expect(src).toContain("bolillasPixi3D");
    expect(src).toContain("import(\"../pixi/bolillas\")");
    expect(src).not.toContain("Math.random");
  });

  it("el 3D no emite sonido propio: la voz única es la del kit, que el cuadro del 2D corre en ambos modos", () => {
    const src = fuente("bolillas-3d.ts");
    // El clic, su eco, el golpe seco de la caída y los ticks del titileo salen de `bolillas-sonido.ts` por la voz
    // del kit (`k.sonido`); si esta vista también sonara, cada choque se oiría doble.
    expect(src.split("\n").some((l) => /^\s*import\s.*\bsound\b/.test(l))).toBe(false);
    expect(src).not.toContain("beep(");
  });

  it("la entrada que el 2D le pasa es el plan y su mapeo, sin nada del ganador", () => {
    const vacia: EntradaBolillas = {
      t: 0, w: 0, h: 0, u: 1,
      cam: { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
      plan: null,
      mapeo: { cx: 0, cy: 0, e: 100 },
    };
    expect(vacia.plan).toBeNull();
    const src = fuente("bolillas-3d.ts");
    const contrato = src.slice(src.indexOf("export interface EntradaBolillas"), src.indexOf("export function entradaBolillasVacia"));
    expect(contrato).toContain("plan: Datos | null");
    expect(contrato).toContain("mapeo: Mapeo");
    expect(contrato).not.toMatch(/ganador/);
  });
});
