import { readFileSync, readdirSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Gobernador3D, ajustes3D, nivelInicial3D, type Nivel3D } from "./calidad";
import { aplicarPose, camaraDeEscena, crearMapa, escala3D, perfil, perfilFiel, poseCamara } from "./camara";
import { PRIORIDAD_SIEMPRE, cajaDeCabeza, repartirEtiquetas, type PedidoEtiqueta, type Zona } from "./etiquetas";
import { hash, hashTexto, sinAzarDeTres } from "./ids";
import { compararPuestos, ganaIgual, ordenPor, type Puesto2D } from "./prueba";
import { tiene3D } from "./registro";

const aqui = new URL(".", import.meta.url);
const fuente = (f: string): string => readFileSync(new URL(f, aqui), "utf8");

describe("sin azar", () => {
  it("sinAzarDeTres presta un contador y devuelve Math.random como estaba", () => {
    const antes = Math.random;
    const vistos = sinAzarDeTres(() => [Math.random(), Math.random(), Math.random()]);
    expect(Math.random).toBe(antes);
    expect(new Set(vistos).size).toBe(3);
    // Es determinista: la misma secuencia cada vez.
    expect(sinAzarDeTres(() => [Math.random(), Math.random(), Math.random()])).toEqual(vistos);
  });

  it("devuelve Math.random también si lo de adentro falla", () => {
    const antes = Math.random;
    expect(() => sinAzarDeTres(() => { throw new Error("x"); })).toThrow();
    expect(Math.random).toBe(antes);
  });

  it("hash y hashTexto dependen solo de su entrada y caen en [0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const h = hash(i, 7);
      expect(h).toBe(hash(i, 7));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(hash(1, 2)).not.toBe(hash(2, 1));
    expect(hashTexto("Ana")).toBe(hashTexto("Ana"));
    expect(hashTexto("Ana")).not.toBe(hashTexto("Ana "));
  });

  it("ningún archivo del kit nombra Math.random salvo ids.ts (que lo presta y lo devuelve)", () => {
    for (const f of readdirSync(aqui).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts") && x !== "ids.ts")) {
      const sinComentarios = fuente(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(sinComentarios, f).not.toContain("Math.random");
    }
  });
});

describe("lo liviano no trae three.js ni el motor", () => {
  // Estos los importa el archivo de un juego en 2D: three.js solo puede llegar por el módulo `<juego>-3d.ts`.
  const livianos = ["tipos.ts", "enchufe.ts", "camara.ts", "registro.ts", "etiquetas.ts", "etiquetas-pixi.ts", "prueba.ts", "calidad.ts", "ids.ts"];
  for (const f of livianos) {
    it(`${f} no importa three.js ni motor.ts más que como tipo`, () => {
      const lineas = fuente(f).split("\n").filter((l) => /^\s*import\s/.test(l));
      for (const l of lineas) {
        if (/from\s+"three"/.test(l) || /from\s+"\.\/(motor|escena|figuras)"/.test(l)) expect(l, `${f}: ${l}`).toMatch(/^\s*import\s+type\b/);
      }
    });
  }
});

describe("calidad por equipo", () => {
  it("el pedido a mano fija el nivel; sin placa, baja; el celular nunca arranca en alta", () => {
    expect(nivelInicial3D({ celular: false, dpr: 2, pedido: "baja" })).toEqual({ nivel: "baja", fijo: true });
    expect(nivelInicial3D({ celular: false, dpr: 1, software: true }).nivel).toBe("baja");
    expect(nivelInicial3D({ celular: true, dpr: 3 }).nivel).toBe("media");
    expect(nivelInicial3D({ celular: true, dpr: 3, memoriaGB: 4 }).nivel).toBe("baja");
    expect(nivelInicial3D({ celular: false, dpr: 2 }).nivel).toBe("alta");
    expect(nivelInicial3D({ celular: false, dpr: 2, nucleos: 4 }).nivel).toBe("media");
  });

  it("baja sombras, partículas y pixelRatio, nunca al revés", () => {
    const niveles: Nivel3D[] = ["alta", "media", "baja"];
    for (const celular of [false, true]) {
      const a = niveles.map((n) => ajustes3D(n, { celular, dpr: 3, compartir: false }));
      for (let i = 1; i < a.length; i++) {
        expect(a[i]!.pixelRatio).toBeLessThanOrEqual(a[i - 1]!.pixelRatio);
        expect(a[i]!.particulas).toBeLessThan(a[i - 1]!.particulas);
      }
      expect(a[0]!.pixelRatio).toBe(celular ? 1.5 : 2);
      expect(a[2]!.sombras).toBe("no");
      expect(a[2]!.pixelRatio).toBe(1);
    }
    expect(ajustes3D("alta", { celular: false, dpr: 2 }).sombras).toBe("mapa");
    expect(ajustes3D("alta", { celular: true, dpr: 2 }).sombras).toBe("ovalo");
    expect(ajustes3D("alta", { celular: false, dpr: 1, compartir: true }).particulas).toBe(0.5);
  });

  it("el gobernador baja un nivel si la mediana de 48 cuadros pasa de 24 ms, y nunca sube", () => {
    const bajadas: Nivel3D[] = [];
    const g = new Gobernador3D("alta", (n) => bajadas.push(n));
    for (let i = 0; i < 30 + 48; i++) g.cuadro(40);
    expect(bajadas).toEqual(["media"]);
    for (let i = 0; i < 48; i++) g.cuadro(40);
    expect(bajadas).toEqual(["media", "baja"]);
    for (let i = 0; i < 200; i++) g.cuadro(5);
    expect(bajadas).toEqual(["media", "baja"]);
  });

  it("un equipo que anda bien no baja, un nivel fijo no baja y un hueco de pestaña no cuenta", () => {
    const bajadas: Nivel3D[] = [];
    const bien = new Gobernador3D("alta", (n) => bajadas.push(n));
    for (let i = 0; i < 300; i++) bien.cuadro(16);
    const fijo = new Gobernador3D("alta", (n) => bajadas.push(n), true);
    for (let i = 0; i < 300; i++) fijo.cuadro(60);
    const hueco = new Gobernador3D("alta", (n) => bajadas.push(n));
    for (let i = 0; i < 300; i++) hueco.cuadro(i % 2 ? 16 : 900);
    expect(bajadas).toEqual([]);
  });
});

describe("el mapa 2D a 3D", () => {
  const perfiles = { carrera: perfil({ tam: 1.45 }), arriba: perfilFiel(1.1), lado: perfil({ zc: 1, azimut: 0.4 }) };
  for (const [nombre, p] of Object.entries(perfiles)) {
    it(`${nombre}: ida y vuelta sin perder nada, en celular y en proyector`, () => {
      for (const u of [0.55, 1, 1.9, 3]) {
        const m = crearMapa(p, u);
        for (const [x, y, alto] of [[0, 0, 0], [1234.5, 321.25, 0], [-800, 900, 55], [60000, -40, 12]] as const) {
          const v = m.a3D(x, y, alto);
          const b = m.a2D(...v);
          expect(b.x).toBeCloseTo(x, 7);
          expect(b.y).toBeCloseTo(y, 7);
          expect(b.alto).toBeCloseTo(alto, 7);
        }
      }
    });
  }

  it("la unidad 3D mide lo mismo en cualquier pantalla: 30 unidades del diseño son una unidad", () => {
    expect(escala3D(1) * 30).toBeCloseTo(1, 9);
    expect(escala3D(2) * 60).toBeCloseTo(1, 9);
    expect(escala3D(0)).toBe(escala3D(0.1));
  });

  it("perfilFiel conserva las proporciones del piso: sin giro de costado y zc = 1 / sin(elevación)", () => {
    const p = perfilFiel(0.9);
    expect(p.azimut).toBe(0);
    expect(p.zc).toBeCloseTo(1 / Math.sin(0.9), 12);
    // Dos puntos a una y de distancia en el 2D quedan a la misma distancia en la pantalla del 3D (cámara de frente, sin perspectiva fuerte).
    const cam = new PerspectiveCamera();
    const u = 1.5, w = 1000, h = 700;
    const pose = poseCamara({ x: 500, y: 350, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 }, h, u, p);
    aplicarPose(cam, pose, w / h);
    const m = crearMapa(p, u);
    const enPantalla = (x: number, y: number): { x: number; y: number } => {
      const v = new Vector3(...m.a3D(x, y)).project(cam);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    };
    const a = enPantalla(500, 350), b = enPantalla(500, 450), c = enPantalla(600, 350);
    // Con acerca = 1 el alto del 2D se encuadra entero; el piso (a nivel y = 0) se ve en proporción cercana al 2D.
    expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeGreaterThan(0);
    expect(b.y - a.y).toBeGreaterThan(0);
    expect((b.y - a.y) / (c.x - a.x)).toBeGreaterThan(0.6);
    expect((b.y - a.y) / (c.x - a.x)).toBeLessThan(1.4);
  });
});

describe("la cámara del 3D mira lo que mira el director", () => {
  const u = 1.5, w = 1366, h = 768;
  const p = perfil({ tam: 1.45, altoMira: 30, pieMira: 30 });
  const s = escala3D(u);

  it("apunta al mismo punto del mundo y el centro de la pantalla cae sobre él", () => {
    const cam2 = { x: 2400, y: 380, zoom: 1.3, rot: 0, sacudonX: 0, sacudonY: 0 };
    const pose = poseCamara(cam2, h, u, p);
    expect(pose.mira[0]).toBeCloseTo(2400 * s, 9);
    const cam = new PerspectiveCamera();
    aplicarPose(cam, pose, w / h);
    const v = new Vector3(...pose.mira).project(cam);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it("más acercamiento, más cerca; el sacudón corre el punto mirado; el giro inclina", () => {
    const base = { x: 100, y: 100, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };
    const dist = (pz: ReturnType<typeof poseCamara>): number => Math.hypot(pz.pos[0] - pz.mira[0], pz.pos[1] - pz.mira[1], pz.pos[2] - pz.mira[2]);
    expect(dist(poseCamara({ ...base, zoom: 2 }, h, u, p))).toBeCloseTo(dist(poseCamara(base, h, u, p)) / 2, 9);
    const sac = poseCamara({ ...base, sacudonX: 30 }, h, u, p);
    expect(sac.mira[0]).toBeCloseTo((100 - 30) * s, 9);
    expect(poseCamara({ ...base, rot: 0.1 }, h, u, p).giro).toBe(0.1);
  });

  it("camaraDeEscena lee la escena de PixiJS ya aplicada: el pivote, el acercamiento real y el sacudón", () => {
    const escena = { pivot: { x: 120, y: 80 }, position: { x: 683 + 5, y: 384 - 3 }, scale: { x: 1.7 }, rotation: 0.02 };
    expect(camaraDeEscena(escena, 1366, 768)).toEqual({ x: 120, y: 80, zoom: 1.7, rot: 0.02, sacudonX: 5, sacudonY: -3 });
  });

  it("aplicarPose deja el aspecto y el campo de visión", () => {
    const cam = new PerspectiveCamera();
    aplicarPose(cam, poseCamara({ x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 }, h, u, p), 390 / 844);
    expect(cam.aspect).toBeCloseTo(390 / 844, 9);
    expect(cam.fov).toBeCloseTo(36, 9);
  });
});

describe("la prueba de igualdad de posiciones", () => {
  const puestos: Puesto2D[] = Array.from({ length: 12 }, (_, i) => ({ id: i, x: 400 + i * 130 + (i % 3) * 7, y: 200 + ((i * 5) % 7) * 40, alto: i % 4 ? 0 : 20 }));

  it("pasa limpia con el mapa de la casa en cualquier perfil", () => {
    for (const p of [perfil({ tam: 1.45 }), perfilFiel(1.1), perfil({ zc: 2 })]) expect(compararPuestos(puestos, p, 1.7)).toEqual([]);
  });

  it("encuentra un orden cambiado (un 3D que no respeta el plan)", () => {
    // Un perfil con profundidad negativa invierte el orden de la profundidad: tiene que verse.
    const mal = perfil({ zc: -1 });
    const f = compararPuestos(puestos, mal, 1.7);
    expect(f.some((x) => x.motivo === "orden-profundidad")).toBe(true);
  });

  it("ordenPor desempata por id y ganaIgual dice quién llega más lejos", () => {
    expect(ordenPor([{ id: 2, v: 1 }, { id: 1, v: 1 }, { id: 0, v: 0 }])).toEqual([0, 1, 2]);
    expect(ganaIgual(puestos, 11, perfil(), 1.7)).toBe(true);
    expect(ganaIgual(puestos, 3, perfil(), 1.7)).toBe(false);
  });
});

describe("el reparto de las fichas de nombre", () => {
  const zona: Zona = { x0: 8, y0: 90, x1: 1358, y1: 640 };
  const pedido = (id: number, x: number, y: number, extra: Partial<PedidoEtiqueta> = {}): PedidoEtiqueta => ({ id, x, y, alto: 90, w: 120, h: 30, prioridad: 0, ...extra });
  const caja = (p: PedidoEtiqueta, l: { x: number; y: number }): Zona => ({ x0: l.x - p.w / 2, x1: l.x + p.w / 2, y0: l.y - p.h / 2, y1: l.y + p.h / 2 });
  const solapan = (a: Zona, b: Zona): boolean => a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;

  it("con cuarenta personas apiladas ninguna ficha visible pisa a otra ni la cara de otra figura", () => {
    const pedidos = Array.from({ length: 40 }, (_, i) => pedido(i, 200 + (i % 8) * 70, 260 + Math.floor(i / 8) * 55));
    const lugares = repartirEtiquetas(pedidos, zona);
    const vis = pedidos.map((p, i) => ({ p, l: lugares[i]! })).filter((x) => x.l.visible);
    expect(vis.length).toBeGreaterThan(5);
    for (let i = 0; i < vis.length; i++) {
      for (let j = i + 1; j < vis.length; j++) expect(solapan(caja(vis[i]!.p, vis[i]!.l), caja(vis[j]!.p, vis[j]!.l)), `${i} y ${j}`).toBe(false);
      for (const o of pedidos) {
        if (o.id !== vis[i]!.p.id) expect(solapan(caja(vis[i]!.p, vis[i]!.l), cajaDeCabeza(o)), `${vis[i]!.p.id} sobre la cara de ${o.id}`).toBe(false);
      }
      expect(caja(vis[i]!.p, vis[i]!.l).x0).toBeGreaterThanOrEqual(zona.x0);
      expect(caja(vis[i]!.p, vis[i]!.l).x1).toBeLessThanOrEqual(zona.x1);
    }
  });

  it("manda la de más prioridad: se queda sobre su cabeza y la otra se corre, sin importar el orden de la lista", () => {
    const a = pedido(1, 400, 300, { prioridad: 5 });
    const b = pedido(2, 410, 300);
    for (const lista of [[a, b], [b, a]]) {
      const lugares = repartirEtiquetas(lista, zona);
      const la = lugares[lista.indexOf(a)]!, lb = lugares[lista.indexOf(b)]!;
      expect(la).toMatchObject({ id: 1, visible: true, x: 400, y: 300 - 15 - 2 });
      expect(lb.visible).toBe(true);
      expect(solapan(caja(a, la), caja(b, lb))).toBe(false);
    }
  });

  it("la de prioridad máxima se muestra siempre, entera en la pantalla, aunque tape", () => {
    const rodeada = Array.from({ length: 30 }, (_, i) => pedido(i + 10, 20 + i * 4, 120 + (i % 5) * 6));
    const reina = pedido(1, 6, 100, { prioridad: PRIORIDAD_SIEMPRE });
    const lugares = repartirEtiquetas([...rodeada, reina], zona);
    const l = lugares[lugares.length - 1]!;
    expect(l.visible).toBe(true);
    expect(l.x - 60).toBeGreaterThanOrEqual(zona.x0);
    expect(l.y - 15).toBeGreaterThanOrEqual(zona.y0);
  });

  it("es determinista y devuelve un lugar por pedido en el mismo orden", () => {
    const pedidos = Array.from({ length: 25 }, (_, i) => pedido(i * 3 + 1, 100 + (i * 53) % 900, 200 + (i * 37) % 300, { prioridad: i % 4 === 0 ? 1 : 0 }));
    const a = repartirEtiquetas(pedidos, zona);
    expect(repartirEtiquetas(pedidos, zona)).toEqual(a);
    expect(a.map((x) => x.id)).toEqual(pedidos.map((p) => p.id));
  });
});

describe("el registro de juegos en 3D", () => {
  it("lo que no tiene versión no se anuncia", () => {
    expect(tiene3D("juego-que-no-existe")).toBe(false);
  });
});
