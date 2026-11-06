import { ENSANCHE as ENSANCHE_PLAN } from "./carrera-obstaculos";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { permite3D, type Entorno3D } from "../permite3d";
import { ajusteGanador } from "../pixi/ganador-altura";
import { resolverToma } from "../pixi/kit/director";
import { LLAMA_ALTO, formaDe, type Pantalla } from "./carrera-forma";
import { unidadDe } from "../pixi/kit/nombres";
import {
  ACERCA, AIRE_LIDER, ELEVACION, FRACCION_TOPE, HOLGURA_LIDER, PUNTOS_LLAMA, TAM3D, cajaProyectada, camara3D, colocar, corrimientoLider, escala3D, puntasDe,
  tam3DDe, topeAcercamiento, ZC, type Camara2D, type Corredora3D,
} from "./carrera-3d-mapa";
import { despejarVisto, tomaPrimerPlano3D } from "./carrera-zoom-final";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera } from "./carrera-show";

/**
 * El prototipo 3D de la carrera no decide nada: dibuja lo que el plan 2D ya decidió.
 * Estas pruebas cuidan tres cosas: que las posiciones que dibuja son las del plan,
 * que la cámara mira lo que mira el director, y que se apaga donde tiene que apagarse.
 */

/** El 2D pone a quien corre la recta en `Xs + (q + (pq - q) · ENSANCHE) · RECTA · ancho` (`posicion` en carrera.ts). */
const ENSANCHE = ENSANCHE_PLAN;
const xDelDosD = (pq: number, q: number, Xs: number, w: number): number => Xs + (q + (pq - q) * ENSANCHE) * RECTA * w;

const QS = [0.25, 0.5, 0.7, 0.88, 1];

describe("el 3D dibuja las posiciones del plan 2D", () => {
  it("la cuenta del 2D que usa el 3D es la que está escrita en carrera.ts", () => {
    const fuente = readFileSync(new URL("./carrera.ts", import.meta.url), "utf8");
    expect(fuente).toContain("const pq = d.final.pos(carril, qq);");
    expect(fuente).toContain("const xl = Xs + (qq + (pq - qq) * ENSANCHE) * RECTA * P.w;");
    expect(ENSANCHE_PLAN).toBe(1.7);
  });

  for (const n of [5, 8, 18, 30]) {
    for (const semilla of [1, 2, 3, 4]) {
      it(`con ${n} personas, semilla ${semilla}: en 25, 50, 70, 88 y 100 % cada carril cae donde el plan lo manda`, () => {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const w = 1366, u = 1.9, Xs = 4120, s = escala3D(u);
        for (const q of QS) {
          const t = d.tDeQ(q);
          // El reloj de la recta y la fracción de pista son la misma cosa, de ida y de vuelta.
          expect(d.q(t)).toBeCloseTo(q, 6);
          const puestos = d.lanes.map((persona, carril) => {
            const pq = d.final.pos(carril, q);
            const c: Corredora3D = { persona, x: xDelDosD(pq, q, Xs, w), y: 300 + carril * 70, salto: 0, esc: 0.6, velocidad: 1, momento: null, fase: 0 };
            return { carril, pq, p: colocar(c, u) };
          });
          for (const { carril, pq, p } of puestos) {
            // Del x del 3D se vuelve a la fracción de pista y es la del plan.
            const vuelta = (p.x / s - Xs) / (RECTA * w);
            expect(q + (vuelta - q) / ENSANCHE).toBeCloseTo(pq, 9);
            // Los carriles quedan en el mismo orden de profundidad.
            if (carril > 0) expect(p.z).toBeGreaterThan(puestos[carril - 1]!.p.z);
          }
          // El orden en la pista es el del plan: quien va más adelante en el plan va más adelante en el 3D.
          const porPlan = [...puestos].sort((a, b) => b.pq - a.pq || a.carril - b.carril).map((x) => x.carril);
          const por3D = [...puestos].sort((a, b) => b.p.x - a.p.x || a.carril - b.carril).map((x) => x.carril);
          expect(por3D).toEqual(porPlan);
        }
        // En la meta, la ganadora es la que más adelante termina en el plan: el 3D no cambia quién gana.
        const final = d.lanes.map((_, carril) => d.final.pos(carril, 1));
        const campeona = d.lanes.indexOf(d.campeona);
        expect(final[campeona]).toBe(Math.max(...final));
      });
    }
  }

  it("la altura y la profundidad salen de los píxeles del 2D, a la misma escala", () => {
    const u = 2;
    const s = escala3D(u);
    const p = colocar({ persona: 3, x: 1000, y: 400, salto: 30, esc: 0.5, velocidad: 1, momento: null, fase: 0 }, u);
    expect(p.x).toBeCloseTo(1000 * s, 9);
    expect(p.y).toBeCloseTo(30 * s, 9);
    expect(p.z).toBeCloseTo(400 * s * ZC, 9);
    expect(p.escala).toBeCloseTo(0.5 * s * TAM3D, 9);
  });
});

describe("la cámara del 3D mira lo que mira el director", () => {
  const u = 1.5, w = 1366, h = 768;
  const s = escala3D(u);

  it("apunta al mismo punto y a la misma altura del cuerpo", () => {
    const c = camara3D({ x: 2400, y: 380, zoom: 1.3, rot: 0 }, w, h, u, 0.6);
    expect(c.mira[0]).toBeCloseTo(2400 * s, 9);
    expect(c.mira[1]).toBeGreaterThan(0);
    expect(c.giro).toBe(0);
  });

  it("el ancho que se ve a esa distancia es el del 2D con ese acercamiento (un poco más cerca, `ACERCA`)", () => {
    for (const zoom of [0.6, 1, 1.7, 2.4]) {
      const c = camara3D({ x: 0, y: 380, zoom, rot: 0 }, w, h, u, 0.6);
      const dist = Math.hypot(c.pos[0] - c.mira[0], c.pos[1] - c.mira[1], c.pos[2] - c.mira[2]);
      const ancho = 2 * dist * Math.tan(c.fov / 2) * (w / h);
      expect(ancho).toBeCloseTo((w / zoom) * s * ACERCA, 6);
    }
  });

  it("acercarse es acercarse: el doble de zoom, la mitad de distancia", () => {
    const a = camara3D({ x: 0, y: 380, zoom: 1, rot: 0 }, w, h, u, 0.6);
    const b = camara3D({ x: 0, y: 380, zoom: 2, rot: 0 }, w, h, u, 0.6);
    const da = Math.hypot(a.pos[0] - a.mira[0], a.pos[1] - a.mira[1], a.pos[2] - a.mira[2]);
    const db = Math.hypot(b.pos[0] - b.mira[0], b.pos[1] - b.mira[1], b.pos[2] - b.mira[2]);
    expect(da / db).toBeCloseTo(2, 9);
  });

  it("es función de la cámara del 2D y nada más: la misma entrada da la misma cámara", () => {
    const a = camara3D({ x: 1234, y: 321, zoom: 1.4, rot: 0.02 }, w, h, u, 0.55);
    const b = camara3D({ x: 1234, y: 321, zoom: 1.4, rot: 0.02 }, w, h, u, 0.55);
    expect(b).toEqual(a);
    expect(a.giro).toBe(0.02);
  });
});

describe("el 3D no encima las filas", () => {
  const pantallas: [string, number, number][] = [["proyector", 1920, 1080], ["celular", 390, 844], ["celular de lado", 844, 390]];
  const pantalla = (w: number, h: number) => ({ w, h, u: unidadDe(w, h), retrato: h > w * 1.1, top: Math.round(0.06 * h), bottom: Math.round(h - Math.max(110, 0.14 * h)) });

  it("la llama proyectada no entra en la fila de al lado, con `tam3DDe` y con las filas peores de cada formato", () => {
    for (const [nombre, w, h] of pantallas) {
      const p = pantalla(w, h);
      for (let m = 2; m <= 30; m++) {
        const f = formaDe(p, m, Math.max(p.h * 0.026, 16, 19 * Math.min(2, p.u)), 120 * p.u);
        const esc = f.alto / LLAMA_ALTO;
        const tam = tam3DDe(f.altoFila, esc);
        // La cabeza de una fila sube `LLAMA_ALTO·esc·tam·cos(E)` desde el piso; la fila de al lado se ve a `altoFila·ZC·sin(E)`.
        expect(LLAMA_ALTO * esc * tam * Math.cos(ELEVACION), `m=${m} en ${nombre}`).toBeLessThanOrEqual(f.altoFila * ZC * Math.sin(ELEVACION) + 1e-6);
        // La inflación de antes (TAM3D pelado) encimaba en el celular parado: con el tope nuevo es más chica que eso.
        if (p.retrato && m >= 10) expect(tam, `m=${m} en ${nombre}`).toBeLessThan(TAM3D);
      }
    }
  });
});

describe("el 3D se apaga solo", () => {
  const bueno: Entorno3D = { webgl: true, ahorroDeDatos: false, conexion: null, compartir: false };

  it("corre con buenas condiciones", () => {
    expect(permite3D(bueno)).toBe(true);
    expect(permite3D({ ...bueno, conexion: "4g" })).toBe(true);
  });

  it("sin WebGL, con ahorro de datos, con datos lentos o con el modo para compartir, el 3D se ignora", () => {
    expect(permite3D({ ...bueno, webgl: false })).toBe(false);
    expect(permite3D({ ...bueno, ahorroDeDatos: true })).toBe(false);
    expect(permite3D({ ...bueno, compartir: true })).toBe(false);
    for (const c of ["slow-2g", "2g", "3g"]) expect(permite3D({ ...bueno, conexion: c })).toBe(false);
    // Los equipos más justos: 2 GB o 2 núcleos o menos. Donde el navegador no lo dice, se confía.
    expect(permite3D({ ...bueno, memoriaGB: 2 })).toBe(false);
    expect(permite3D({ ...bueno, nucleos: 2 })).toBe(false);
    expect(permite3D({ ...bueno, memoriaGB: 4, nucleos: 8 })).toBe(true);
    expect(permite3D({ ...bueno, memoriaGB: null, nucleos: null })).toBe(true);
  });
});

describe("el 3D no tiene azar ni reloj propio", () => {
  for (const archivo of ["carrera-3d.ts", "carrera-3d-mapa.ts"]) {
    it(`${archivo} no usa Math.random ni reloj`, () => {
      const fuente = readFileSync(new URL(`./${archivo}`, import.meta.url), "utf8");
      expect(fuente).not.toMatch(/Math\.random/);
      expect(fuente).not.toMatch(/Date\.now|new Date\(/);
      expect(fuente).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
    });
  }

  it("el único lugar que nombra Math.random es el que le presta a three.js un contador para sus identificadores", () => {
    const fuente = readFileSync(new URL("./carrera-3d-ids.ts", import.meta.url), "utf8");
    expect(fuente).toContain("Math.random = original;");
  });

  it("three.js solo se importa desde el archivo del 3D, nunca desde el paquete normal", () => {
    for (const archivo of ["carrera.ts", "carrera-3d-mapa.ts", "../engine.ts", "../pixi/index.ts", "../permite3d.ts"]) {
      const fuente = readFileSync(new URL(`./${archivo}`, import.meta.url), "utf8");
      expect(fuente).not.toMatch(/from\s+["']three["']/);
      // El archivo del 3D solo se pide con import dinámico.
      expect(fuente).not.toMatch(/^import\s+[^;]*["'][^"']*carrera-3d["']/m);
    }
  });
});

describe("la cámara del 3D en un celular deja entera a la llama que va adelante", () => {
  it("en pantalla parada, corre lo justo para dejarle aire; en apaisada, no corre", () => {
    expect(corrimientoLider(100, 150, 390, 844)).toBe(0);
    // Pasada del borde derecho: la cámara se corre a la derecha hasta dejar `AIRE_LIDER` más la holgura.
    expect(corrimientoLider(340, 410, 390, 844)).toBeCloseTo(410 - (390 - (AIRE_LIDER + HOLGURA_LIDER)), 9);
    // Pegada al borde izquierdo: se corre a la izquierda.
    expect(corrimientoLider(5, 60, 390, 844)).toBeCloseTo(5 - (AIRE_LIDER + HOLGURA_LIDER), 9);
    // Después del corrimiento queda con el aire pedido.
    const c = corrimientoLider(340, 410, 390, 844);
    expect(390 - (410 - c)).toBeGreaterThanOrEqual(AIRE_LIDER);
    expect(corrimientoLider(340, 410, 1366, 768)).toBe(0);
  });

  it("si no entra con aire, la centra", () => {
    expect(corrimientoLider(-20, 420, 390, 844)).toBeCloseTo(5, 9);
    expect(corrimientoLider(100, 500, 390, 844)).toBeCloseTo(300 - 195, 9);
  });
});

describe("el primer plano final del 3D mide lo que dibuja la cámara 3D", () => {
  // Un celular apaisado. La cámara de three.js se arma igual que en la vista (`posarCamara`, carrera-3d.ts), sin WebGL.
  const w = 844, h = 390, u = 0.55, esc = 0.6;
  const zona = { x0: 4, y0: 184, x1: 840, y1: 340 };
  const llama: Corredora3D = { persona: 2, x: 5000, y: 300, salto: 0, esc, velocidad: 0, momento: null, fase: 0 };
  const posar = (cam: Camara2D): PerspectiveCamera => {
    const pose = camara3D(cam, w, h, u, esc);
    const c = new PerspectiveCamera(36, w / h, 0.5, 4000);
    c.fov = (pose.fov * 180) / Math.PI;
    c.position.set(...pose.pos);
    c.up.set(Math.sin(pose.giro), Math.cos(pose.giro), 0);
    c.lookAt(pose.mira[0], pose.mira[1], pose.mira[2]);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    return c;
  };
  const vista = (cam: Camara2D) => {
    const c = posar(cam), p = colocar(llama, u);
    return cajaProyectada(puntasDe([p.x, p.y, p.z], p.escala).map(([x, y, z]) => new Vector3(x, y, z).project(c)), w, h);
  };

  it("la caja es la de las puntas de la llama proyectadas, en píxeles de la pantalla", () => {
    const cam = { x: 4980, y: 280, zoom: 1.2, rot: 0 };
    const c = posar(cam), p = colocar(llama, u);
    const caja = vista(cam)!;
    expect(caja).not.toBeNull();
    const pts = PUNTOS_LLAMA.map(([dx, dy, dz]) => new Vector3(p.x + dx * p.escala, p.y + dy * p.escala, p.z + dz * p.escala).project(c))
      .map((q) => ({ x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h }));
    expect(caja.x).toBeCloseTo(Math.min(...pts.map((q) => q.x)), 6);
    expect(caja.y).toBeCloseTo(Math.min(...pts.map((q) => q.y)), 6);
    expect(caja.x + caja.w).toBeCloseTo(Math.max(...pts.map((q) => q.x)), 6);
    expect(caja.y + caja.h).toBeCloseTo(Math.max(...pts.map((q) => q.y)), 6);
    // Los pies quedan abajo y la cabeza arriba, adentro de la caja.
    const pie = new Vector3(p.x, p.y, p.z).project(c);
    expect(((1 - pie.y) / 2) * h).toBeLessThanOrEqual(caja.y + caja.h + 1e-6);
    expect(caja.h).toBeGreaterThan(10);
  });

  it("si una punta queda detrás de la cámara, no hay caja (no se inventa)", () => {
    expect(cajaProyectada([{ x: 0, y: 0, z: 0.5 }, { x: 0.2, y: 0.1, z: 1.2 }], w, h)).toBeNull();
    expect(cajaProyectada([], w, h)).toBeNull();
    expect(cajaProyectada([{ x: -1, y: 1, z: 0.3 }, { x: 1, y: -1, z: 0.9 }], w, h)).toEqual({ x: 0, y: 0, w, h });
  });

  it("el tope del acercamiento deja la llama en la fracción pedida del alto, y es menor para una llama más grande", () => {
    const tope = topeAcercamiento(h, esc);
    const pose = camara3D({ x: 0, y: 300, zoom: tope, rot: 0 }, w, h, u, esc);
    const dist = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[1] - pose.mira[1], pose.pos[2] - pose.mira[2]);
    const altoVisto = 2 * dist * Math.tan(pose.fov / 2);
    expect((LLAMA_ALTO * esc * escala3D(u) * TAM3D) / altoVisto).toBeCloseTo(FRACCION_TOPE, 9);
    expect(topeAcercamiento(h, esc * 2)).toBeLessThan(tope);
    expect(topeAcercamiento(h * 2, esc)).toBeGreaterThan(tope);
  });

  it("el director, con la caja vista vuelta al mundo del 2D, llega al primer plano: la llama dibujada llena la zona", () => {
    let cam: Camara2D = { x: 4700, y: 260, zoom: 0.8, rot: 0 };
    const tope = topeAcercamiento(h, esc);
    for (let i = 0; i < 12; i++) {
      const visto = vista(cam)!;
      const v = resolverToma(tomaPrimerPlano3D(visto, cam, w, h, zona, tope), { w, h, zona });
      cam = { x: v.x, y: v.y, zoom: v.z, rot: 0 };
    }
    const c = vista(cam)!;
    expect(c.x).toBeGreaterThanOrEqual(zona.x0 - 1);
    expect(c.y).toBeGreaterThanOrEqual(zona.y0 - 1);
    expect(c.x + c.w).toBeLessThanOrEqual(zona.x1 + 1);
    expect(c.y + c.h).toBeLessThanOrEqual(zona.y1 + 1);
    // Es un primer plano: llena el alto de la zona (o el tope lo frena).
    expect(cam.zoom >= tope - 1e-6 || c.h >= (zona.y1 - zona.y0) * 0.97).toBe(true);
  });

  it("el despeje corre la cámara que dibuja la llama, vuelve a medir lo dibujado y la deja entre el cartel y el relator", () => {
    // El cartel baja hasta y = 200 y el relator empieza en y = 330. La llama arranca tapada por el cartel.
    const banda = { x0: 2, y0: 200, x1: w - 2, y1: 330 };
    let cam: Camara2D = { x: 5010, y: 330, zoom: 1.6, rot: 0 };
    const orden: string[] = [];
    const antes = vista(cam)!;
    expect(antes.y).toBeLessThan(banda.y0);
    const movida = despejarVisto({
      medir: () => {
        orden.push("medir");
        return vista(cam);
      },
      // Lo que hace el estadio (`despejarGanador`): la cuenta lineal del 2D sobre la cámara del director.
      despejar: (cuerpo) => {
        orden.push("despejar");
        const a = ajusteGanador(cuerpo, banda), cx = cuerpo.x + cuerpo.w / 2, cy = cuerpo.y + cuerpo.h / 2, z = cam.zoom * a.s;
        cam = { ...cam, zoom: z, x: cam.x - ((1 - a.s) * (cx - w / 2) + a.dx) / z, y: cam.y - ((1 - a.s) * (cy - h / 2) + a.dy) / z };
      },
      pose: () => [cam.x, cam.y, cam.zoom],
      reencuadrar: () => orden.push("reencuadrar"),
    });
    expect(movida).toBe(true);
    // Cada despeje que mueve la cámara se vuelve a encuadrar antes de medir de nuevo.
    expect(orden.slice(0, 4)).toEqual(["medir", "despejar", "reencuadrar", "medir"]);
    const c = vista(cam)!;
    expect(c.y).toBeGreaterThanOrEqual(banda.y0 - 1);
    expect(c.y + c.h).toBeLessThanOrEqual(banda.y1 + 1);
  });

  it("si nada tapa, el despeje no mueve la cámara ni pide dibujar de nuevo", () => {
    const orden: string[] = [];
    const quieta = despejarVisto({
      medir: () => (orden.push("medir"), { x: 100, y: 220, w: 50, h: 60 }),
      despejar: () => orden.push("despejar"),
      pose: () => [1, 2, 3],
      reencuadrar: () => orden.push("reencuadrar"),
    });
    expect(quieta).toBe(false);
    expect(orden).toEqual(["medir", "despejar"]);
    expect(despejarVisto({ medir: () => null, despejar: () => orden.push("x"), pose: () => [0], reencuadrar: () => orden.push("x") })).toBe(false);
  });

  it("los archivos del 3D no nombran a quien gana: la vista solo mide una persona y mueve la cámara", () => {
    const vista3d = readFileSync(new URL("./carrera-3d.ts", import.meta.url), "utf8");
    expect(vista3d).not.toMatch(/ganador|ganadora|campeona|winner/i);
    const mapa = readFileSync(new URL("./carrera-3d-mapa.ts", import.meta.url), "utf8");
    const enchufe = mapa.slice(mapa.indexOf("export interface Vista3D"), mapa.indexOf("export interface OpcionesFabrica3D"));
    expect(enchufe).toContain("cajaDe(");
    expect(enchufe).toContain("encuadrar(");
    expect(enchufe).not.toMatch(/ganador|ganadora|campeona|winner/i);
  });

  it("en carrera.ts el despeje del 3D va después del cuadro, mide lo dibujado y vuelve a dibujar el 3D", () => {
    const fuente = readFileSync(new URL("./carrera.ts", import.meta.url), "utf8");
    const cuerpo = fuente.slice(fuente.indexOf("function despejar3D("), fuente.indexOf("function protegida("));
    expect(cuerpo).toContain("primerPlanoFinal(P, t, d.tCrown)");
    expect(cuerpo).toContain("medir: cajaVista3D");
    expect(cuerpo).toContain("S.despejarGanador(");
    expect(cuerpo.indexOf("despejarVisto(")).toBeLessThan(cuerpo.indexOf("encuadrar3D(true)"));
    // La auditoría del cuerpo, en 3D, es la caja proyectada.
    expect(fuente).toMatch(/if \(tres\) return tres\.cajaDe\(d\.campeona\);/);
  });
});
