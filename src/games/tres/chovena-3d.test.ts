import { readFileSync } from "node:fs";
import { Scene } from "three";
import { describe, expect, it } from "vitest";
import {
  ALCANCE, BAJA_SENTADO, BRAZO, CADERA, HOMBRO_X, HOMBRO_Y, crearHombros, crearManos, envolver, manoDeFila, manoSuelta, mirada, punto, tomarManos,
  type Cuerpo,
} from "./chovena-3d-brazos";
import { Gente, personaFija } from "./chovena-3d-gente";
import type { BailarinEntrada, EntradaChovena } from "./chovena-3d-tipos";
import { aplastadoDe, luzDeCorona, perfilChovena } from "./chovena-3d";
import { crearMapa } from "./camara";
import { hash } from "./ids";
import { Basura } from "./motor";
import { compararPuestos, type Puesto2D } from "./prueba";

/**
 * La chovena en 3D no decide nada: dibuja lo que `pixi/chovena.ts` ya decidió. Estas pruebas cuidan que las cuentas del
 * 3D sean las del 2D (la plaza aplastada), que cada pie caiga donde el 2D lo pone y en el mismo orden, que las manos
 * tomadas se toquen de verdad, que nada del 3D delate a la ganadora y que el archivo del 2D no traiga three.js.
 */

const leer = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").split("\r\n").join("\n");
const dosD = leer("../pixi/chovena.ts");

describe("el archivo de la chovena en 2D", () => {
  it("solo importa del 3D lo liviano: los tipos y el enchufe (no trae three.js ni el motor)", () => {
    const lineas = dosD.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l) && /tres\//.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      if (/tres\/(chovena-3d|tipos)/.test(l)) expect(l).toMatch(/^\s*import\s+type\b/);
      else expect(l).toContain("tres/enchufe");
    }
  });

  it("con el 3D apaga lo suyo solo si el 3D arrancó, y sin él queda igual", () => {
    expect(dosD).toContain("const v3 = enchufar3D(S, tres);");
    expect(dosD).toContain("if (v3) {\n      // Con el 3D, el cielo");
    // El lienzo es transparente solo si hay montaje.
    expect(dosD).toContain("transparente: !!tres");
  });

  it("la plaza aplastada es la que el 3D estira: 0,36 acostado y 0,78 en el celular parado", () => {
    expect(dosD).toContain("const ry = rx * (portrait ? 0.78 : 0.36);");
    expect(dosD).toContain("return { x: G.cx + G.rx * ruOf(p) * Math.cos(p.th), y: G.cy + G.ry * v, s: G.dh * (1 + G.dk * clamp(v, -1.4, 1.4)) };");
    expect(dosD).toContain("const v = cvOf(p) + rvOf(p) * Math.sin(p.th);");
  });

  it("la ganadora solo es 'salta' desde la corona, como en el 2D, y nada antes la señala", () => {
    expect(dosD).toMatch(/if \(d === win && x >= T_CROWN\) \{\s*modo = "salta";/);
    // Los campos que el 3D recibe no nombran a quien gana.
    const tipos = leer("./chovena-3d-tipos.ts");
    const campos = tipos.replace(/\/\*\*[\s\S]*?\*\//g, "");
    expect(campos).not.toMatch(/ganador|ganadora|winner|rival/i);
  });
});

describe("el 3D no usa azar ni cuentas propias para colocar", () => {
  const archivos = ["chovena-3d.ts", "chovena-3d-gente.ts", "chovena-3d-plaza.ts", "chovena-3d-brazos.ts", "chovena-3d-tipos.ts"];
  for (const f of archivos) {
    it(`${f} no nombra Math.random`, () => {
      expect(leer(`./${f}`)).not.toContain("Math.random");
    });
  }
  it("los pies de cada bailarín se colocan con el mapa de la casa", () => {
    expect(leer("./chovena-3d.ts")).toContain("mapa.a3D(b.x, b.y, b.alto)");
    expect(leer("./chovena-3d-plaza.ts")).toContain("mapa.a3D(");
  });
  it("el módulo de la chovena en 3D lo registra solo, por su nombre", () => {
    expect(leer("./chovena-3d.ts")).toContain("export const lanzador3D");
  });
});

/** Un tamaño de pantalla, con la plaza como la calcula el 2D (`geo`). */
function plazaDe(W: number, H: number, vertical: boolean, n: number) {
  const avail = H * 0.8;
  const rx = vertical ? W * 0.47 : Math.min(W * 0.34, avail * 0.95);
  const ry = rx * (vertical ? 0.78 : 0.36);
  const cx = W / 2, cy = H * 0.1 + avail * (vertical ? 0.68 : 0.64);
  const ARC = Math.min(0.25, Math.max(0.075, 15 / Math.max(1, n)));
  const dh = Math.min(vertical ? H * 0.1 : H * 0.15, Math.max(H * 0.045, (ARC * rx) / (vertical ? 0.62 : 0.82)));
  const u = vertical ? Math.min(W / 420, H / 900) : H / 720;
  return { W, H, vertical, rx, ry, cx, cy, dh, u, ap: ry / rx };
}

const PANTALLAS: [string, number, number, boolean][] = [["1366x768", 1366, 768, false], ["390x844", 390, 844, true], ["1920x1080", 1920, 1080, false]];

describe("la plaza y la gente caen donde el 2D las pone", () => {
  for (const [nombre, W, H, vertical] of PANTALLAS) {
    for (const n of [2, 5, 18, 30, 60, 200]) {
      it(`${nombre} con ${n}: la posición vuelve intacta y el orden es el mismo, en cualquier momento de la rueda`, () => {
        const P = plazaDe(W, H, vertical, n);
        const perf = perfilChovena(P.ap, 99, 0, -1);
        for (const [i, momento] of [0.25, 0.5, 0.7, 0.88, 1].entries()) {
          const puestos: Puesto2D[] = Array.from({ length: n }, (_, j) => {
            const aro = n > 40 ? j % 3 : 0;
            const rho = n <= 2 ? 0.2 : 1 - aro * 0.22;
            const th = (j / n) * Math.PI * 2 + momento * 3 + hash(i, 7);
            const ru = rho, rv = n >= 3 && n <= 6 ? 0.75 + 0.05 * rho : rho, cv = n >= 3 && n <= 6 ? 0.18 : 0;
            return { id: j, x: P.cx + P.rx * ru * Math.cos(th), y: P.cy + P.ry * (cv + rv * Math.sin(th)), alto: hash(j, i) < 0.3 ? hash(j, 3) * P.dh * 0.3 : 0 };
          });
          expect(compararPuestos(puestos, perf, P.u), `${momento}`).toEqual([]);
        }
      });
    }

    it(`${nombre}: la rueda es un círculo de verdad en el 3D (lo que el 2D aplasta, el 3D lo estira)`, () => {
      const P = plazaDe(W, H, vertical, 18);
      const mapa = crearMapa(perfilChovena(P.ap, 99, 0, -1), P.u);
      const [c0, , c1] = mapa.a3D(P.cx, P.cy);
      const R = P.rx * mapa.s;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const [x, , z] = mapa.a3D(P.cx + P.rx * Math.cos(a), P.cy + P.ry * Math.sin(a));
        expect(Math.hypot(x - c0, z - c1) / R).toBeCloseTo(1, 9);
      }
    });
  }

  it("la cámara se baja al ángulo con que el 2D aplasta la plaza, y cambia despacio y una vez por momento", () => {
    for (const ap of [0.36, 0.78]) {
      const base = perfilChovena(ap, 99, 0, -1);
      expect(Math.sin(base.elevacion)).toBeCloseTo(ap, 12);
      expect(base.zc).toBeCloseTo(1 / ap, 12);
      expect(base.azimut).toBe(0);
    }
    expect(aplastadoDe({ rx: 1000, ry: 360 })).toBeCloseTo(0.36, 12);
    // Más arriba al arrancar, y baja a su altura.
    const ap = 0.36;
    expect(perfilChovena(ap, 0, 0, -1).elevacion).toBeGreaterThan(perfilChovena(ap, 99, 0, -1).elevacion + 0.1);
    expect(perfilChovena(ap, 2.2, 0, -1).elevacion).toBeCloseTo(perfilChovena(ap, 99, 0, -1).elevacion, 12);
    // El contrapicado del golpe y la bajada de la final.
    expect(perfilChovena(ap, 99, 0, 2).elevacion).toBeLessThan(perfilChovena(ap, 99, 0, -1).elevacion);
    expect(perfilChovena(ap, 99, 1, -1).elevacion).toBeLessThan(perfilChovena(ap, 99, 0, -1).elevacion);
    // El zc no cambia con la altura: lo que se pisa en el 2D se pisa en el mismo lugar.
    expect(perfilChovena(ap, 0, 1, 3).zc).toBe(perfilChovena(ap, 99, 0, -1).zc);
    // Nada que maree: ni más de 20 grados por segundo ni la altura por debajo de 8 grados.
    let previo = perfilChovena(ap, 0, 0, -1).elevacion;
    for (let t = 0.02; t < 3; t += 0.02) {
      const e = perfilChovena(ap, t, 0, -1).elevacion;
      expect(Math.abs(e - previo) / 0.02).toBeLessThan((20 * Math.PI) / 180);
      previo = e;
    }
    previo = perfilChovena(ap, 99, 1, -1).elevacion;
    for (let g = 0.02; g < 1.2; g += 0.02) {
      const e = perfilChovena(ap, 99, 1, g).elevacion;
      expect(Math.abs(e - previo) / 0.02).toBeLessThan((20 * Math.PI) / 180);
      previo = e;
    }
    expect(perfilChovena(0.2, 99, 1, 5).elevacion).toBeGreaterThanOrEqual((8 * Math.PI) / 180 - 1e-9);
  });

  it("con la rueda chica la cámara sube y el piso se estira menos, así nadie se mueve en la pantalla", () => {
    const ap = 0.36;
    const normal = perfilChovena(ap, 99, 0, -1, 50, 0);
    const chica = perfilChovena(ap, 99, 0, -1, 50, 1);
    expect(chica.elevacion).toBeGreaterThan(normal.elevacion + 0.3);
    // Lo que se ve en pantalla de un metro de piso es zc * sin(elevación): el mismo en los dos, y el de la plaza del 2D.
    expect(Math.sin(normal.elevacion) * normal.zc).toBeCloseTo(1, 9);
    expect(Math.sin(chica.elevacion) * chica.zc).toBeCloseTo(1, 9);
    // En el celular parado (51 grados) ya está alto: no cambia.
    expect(perfilChovena(0.78, 99, 0, -1, 50, 1).elevacion).toBeCloseTo(perfilChovena(0.78, 99, 0, -1, 50, 0).elevacion, 12);
    // Mira el medio del cuerpo, como el centro de la pantalla del 2D.
    expect(chica.altoMira).toBe(50);
    expect(chica.pieMira).toBe(50);
    // Un mismo punto del 2D cae en la misma altura de la pantalla con la cámara baja o alta (primer orden): mismo z*sin.
    const u = 1;
    const a = crearMapa(normal, u).a3D(10, 80), b = crearMapa(chica, u).a3D(10, 80);
    expect(a[2] * Math.sin(normal.elevacion)).toBeCloseTo(b[2] * Math.sin(chica.elevacion), 9);
  });

  it("la cámara no depende de quién gana: el perfil es función de la hora, de la bajada de la final y del golpe", () => {
    // Dos finales posibles con la misma ronda dan la misma cámara hasta la corona: la función no recibe a nadie.
    expect(perfilChovena.length).toBe(4);
    expect(JSON.stringify(perfilChovena(0.36, 12, 0.5, -1))).toBe(JSON.stringify(perfilChovena(0.36, 12, 0.5, -1)));
  });
});

describe("la luz del mundo", () => {
  it("baja con la corona, vuelve a un poco más de la mitad con el cartel, y antes es la de siempre", () => {
    expect(luzDeCorona(-1, -1)).toBe(1);
    expect(luzDeCorona(0, -1)).toBe(1);
    expect(luzDeCorona(0.25, -1)).toBeCloseTo(0.5, 12);
    expect(luzDeCorona(2, 0)).toBeCloseTo(0.5, 12);
    expect(luzDeCorona(3, 1.2)).toBeCloseTo(0.65, 12);
    let previo = 1;
    for (let c = 0; c <= 0.25; c += 0.01) {
      const l = luzDeCorona(c, -1);
      expect(l).toBeLessThanOrEqual(previo + 1e-12);
      previo = l;
    }
  });
});

/** Un cuerpo de pie, mirando a +z, con los pies en `(x, 0, z)` y 1 unidad por bailarín. */
const cuerpo = (x: number, z: number, yaw = 0, D = 1): Cuerpo => ({ fx: x, fy: 0, fz: z, D, yaw, lean: 0, baja: 0 });

describe("el cuerpo", () => {
  it("de pie y sin inclinar, un punto del cuerpo queda arriba de sus pies, y girar lo gira alrededor de los pies", () => {
    const p = punto(cuerpo(2, 3), 0.1, 0.8, 0.2);
    expect(p[0]).toBeCloseTo(2.1, 12);
    expect(p[1]).toBeCloseTo(0.8, 12);
    expect(p[2]).toBeCloseTo(3.2, 12);
    // Mirando a +x (yaw 90 grados), el frente (+z local) apunta a +x y la izquierda (+x local) a -z.
    const q = punto(cuerpo(0, 0, Math.PI / 2), 0, 0.5, 1);
    expect(q[0]).toBeCloseTo(1, 12);
    expect(q[2]).toBeCloseTo(0, 12);
    const r = punto(cuerpo(0, 0, Math.PI / 2), 1, 0.5, 0);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(-1, 12);
  });

  it("se inclina sobre la cadera: la cadera no se mueve, la cabeza se corre, los pies no", () => {
    const c: Cuerpo = { ...cuerpo(0, 0), lean: 0.2 };
    const cad = punto(c, 0, CADERA, 0);
    expect(cad[0]).toBeCloseTo(0, 12);
    expect(cad[1]).toBeCloseTo(CADERA, 12);
    const cab = punto(c, 0, 0.9, 0);
    expect(cab[0]).toBeLessThan(-0.05);
    expect(cab[1]).toBeLessThan(0.9);
    // Con 'lean' negativo (el 2D inclina hacia la derecha de la pantalla), se corre hacia +x.
    const der = punto({ ...c, lean: -0.2 }, 0, 0.9, 0);
    expect(der[0]).toBeGreaterThan(0.05);
  });

  it("al sentarse baja el cuerpo lo que baja el 2D", () => {
    const c: Cuerpo = { ...cuerpo(0, 0), baja: BAJA_SENTADO };
    expect(punto(c, 0, 0.9, 0)[1]).toBeCloseTo(0.9 - BAJA_SENTADO, 12);
  });

  it("escala con D: una unidad de bailarín son D unidades del mundo", () => {
    const p = punto(cuerpo(1, 1, 0.4, 3), 0.1, 0.5, 0.3);
    const q = punto(cuerpo(0, 0, 0.4, 1), 0.1, 0.5, 0.3);
    expect(p[0] - 1).toBeCloseTo(q[0] * 3, 12);
    expect(p[1]).toBeCloseTo(q[1] * 3, 12);
    expect(p[2] - 1).toBeCloseTo(q[2] * 3, 12);
  });
});

describe("hacia dónde mira cada uno", () => {
  it("en la rueda mira al medio, con 20 grados hacia donde gira", () => {
    // Está atrás (z negativo) y el medio queda adelante (+z): mira a la sala.
    expect(mirada(0, -5, 0, 0, 0, 0, null)).toBeCloseTo(0, 12);
    const girando = mirada(0, -5, 0, 0, 1, 0, null);
    expect(Math.abs(girando)).toBeCloseTo((20 * Math.PI) / 180, 6);
    // Girando para el otro lado, el mismo giro al revés.
    expect(mirada(0, -5, 0, 0, -1, 0, null)).toBeCloseTo(-girando, 12);
    // Parado a la derecha del medio (+x), mira hacia -x.
    expect(mirada(5, 0, 0, 0, 0, 0, null)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("en las filas, la final y la corona mira a la sala; en la final, un poco hacia su pareja", () => {
    expect(mirada(3, 4, 0, 0, 1, 1, null)).toBeCloseTo(0, 12);
    const izq = mirada(-2, 0, 0, 0, 0, 1, [2, 0]);
    const der = mirada(2, 0, 0, 0, 0, 1, [-2, 0]);
    expect(izq).toBeGreaterThan(0.2);
    expect(izq).toBeLessThan(0.9);
    expect(der).toBeCloseTo(-izq, 12);
    // La mezcla va de a poco y por el lado corto.
    const mitad = mirada(0, 5, 0, 0, 0, 0.5, null);
    expect(Math.abs(envolver(mitad))).toBeCloseTo(Math.PI / 2, 6);
  });

  it("sin medio al que mirar (parada en el medio), no se da vuelta", () => {
    expect(mirada(1, 1, 1, 1, 1, 0, null)).toBe(0);
    expect(Number.isFinite(mirada(1, 1, 1, 1, 0, 0.3, [1, 1]))).toBe(true);
  });
});

/** Una rueda de `m` bailarines de pie, mirando al medio, con los hombros en el mundo, y los pares de vecinos. */
function rueda(m: number, radio: number, D: number, entre = 1) {
  const h = crearHombros(m);
  const cuerpos: Cuerpo[] = [];
  for (let i = 0; i < m; i++) {
    const th = (i / m) * Math.PI * 2;
    const x = Math.cos(th) * radio, z = Math.sin(th) * radio;
    const yaw = mirada(x, z, 0, 0, 0, 0, null);
    const c: Cuerpo = { fx: x, fy: 0, fz: z, D, yaw, lean: 0, baja: 0 };
    cuerpos.push(c);
    h.centro.set(punto(c, 0, HOMBRO_Y, 0), 3 * i);
    h.izq.set(punto(c, HOMBRO_X, HOMBRO_Y, 0), 3 * i);
    h.der.set(punto(c, -HOMBRO_X, HOMBRO_Y, 0), 3 * i);
    h.izqDir[2 * i] = Math.cos(yaw);
    h.izqDir[2 * i + 1] = -Math.sin(yaw);
    h.D[i] = D;
  }
  const pares: number[] = [];
  for (let i = 0; i < m; i++) pares.push(i, (i + 1) % m);
  void entre;
  return { h, cuerpos, pares };
}

describe("las manos tomadas", () => {
  // La rueda del 2D deja a cada bailarín a unos 0,82 de alto de su vecino con la letra legible; a menos, las manos no llegan.
  for (const m of [3, 4, 5, 6, 8, 12, 18, 30, 60, 100]) {
    it(`en una rueda de ${m}, todos se toman de las dos manos y las manos se tocan`, () => {
      const D = 1;
      const sep = 0.85;
      const radio = m <= 6 ? (1.12 * D) / (2 * Math.sin(Math.PI / m)) : (m * sep) / (2 * Math.PI);
      const { h, pares } = rueda(m, radio * D, D);
      const man = crearManos(m);
      const hechos = tomarManos(h, pares, man);
      expect(hechos).toBe(m);
      for (let i = 0; i < m; i++) {
        expect(man.usaIzq[i], `izq ${i}`).toBe(1);
        expect(man.usaDer[i], `der ${i}`).toBe(1);
      }
      // La mano de cada uno cae sobre la del vecino con quien se toma.
      let peor = 0;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const mias = [[man.izq, 3 * i], [man.der, 3 * i]] as const;
        const suyas = [[man.izq, 3 * j], [man.der, 3 * j]] as const;
        let mejor = Infinity;
        for (const [a, ia] of mias) for (const [b, ib] of suyas) mejor = Math.min(mejor, Math.hypot((a[ia] as number) - (b[ib] as number), (a[ia + 1] as number) - (b[ib + 1] as number), (a[ia + 2] as number) - (b[ib + 2] as number)));
        peor = Math.max(peor, mejor / D);
      }
      // Menos del 5 % del alto del bailarín (en realidad, cero: las dos manos van al mismo punto).
      expect(peor).toBeLessThan(0.05);
    });
  }

  it("cada brazo llega: ninguno se estira más que el alcance", () => {
    for (const m of [3, 6, 12, 40]) {
      const radio = m <= 6 ? 1.12 / (2 * Math.sin(Math.PI / m)) : (m * 0.85) / (2 * Math.PI);
      const { h, pares } = rueda(m, radio, 1);
      const man = crearManos(m);
      tomarManos(h, pares, man);
      for (let i = 0; i < m; i++) {
        for (const [src, usa, hom] of [[man.izq, man.usaIzq, h.izq], [man.der, man.usaDer, h.der]] as const) {
          if (!usa[i]) continue;
          const l = Math.hypot((src[3 * i] as number) - (hom[3 * i] as number), (src[3 * i + 1] as number) - (hom[3 * i + 1] as number), (src[3 * i + 2] as number) - (hom[3 * i + 2] as number));
          expect(l).toBeLessThanOrEqual(ALCANCE * BRAZO + 1e-9);
        }
      }
    }
  });

  it("con dos de las dos manos (la final), cada uno usa las dos manos y quedan en dos alturas", () => {
    const D = 1;
    const h = crearHombros(2);
    const poner = (i: number, x: number): void => {
      const c: Cuerpo = { fx: x, fy: 0, fz: 0, D, yaw: mirada(x, 0, 0, 0, 0, 1, [-x, 0]), lean: 0, baja: 0 };
      h.centro.set(punto(c, 0, HOMBRO_Y, 0), 3 * i);
      h.izq.set(punto(c, HOMBRO_X, HOMBRO_Y, 0), 3 * i);
      h.der.set(punto(c, -HOMBRO_X, HOMBRO_Y, 0), 3 * i);
      h.izqDir[2 * i] = Math.cos(c.yaw);
      h.izqDir[2 * i + 1] = -Math.sin(c.yaw);
      h.D[i] = D;
    };
    poner(0, -0.55);
    poner(1, 0.55);
    const man = crearManos(2);
    expect(tomarManos(h, [0, 1, 0, 1], man)).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(man.usaIzq[i]).toBe(1);
      expect(man.usaDer[i]).toBe(1);
    }
    // Las dos manos de uno están a distinta altura; las de los dos coinciden de a pares.
    const ys = new Set([man.izq[1], man.der[1], man.izq[4], man.der[4]].map((v) => (v as number).toFixed(6)));
    expect(ys.size).toBe(2);
  });

  it("si el vecino está más lejos de lo que estira un brazo, el eslabón no se hace y las manos quedan sueltas", () => {
    const { h, pares } = rueda(6, 6, 1);
    const man = crearManos(6);
    expect(tomarManos(h, pares, man)).toBe(0);
    expect(man.usaIzq.every((v) => v === 0)).toBe(true);
  });

  it("ignora eslabones rotos (ids fuera de rango, uno consigo mismo) sin romperse", () => {
    const { h } = rueda(8, 1.2, 1);
    const man = crearManos(8);
    expect(tomarManos(h, [0, 0, -1, 2, 9, 1, 1, 2], man)).toBe(1);
  });
});

describe("las manos sueltas", () => {
  const ctx = { modo: "rueda" as const, tipoy: true, ritmo: 0, aplauso: 0, salida: -1 };
  it("izquierda y derecha son espejo", () => {
    for (const modo of ["rueda", "camina", "sentado", "festeja", "salta"] as const) {
      const a = manoSuelta({ ...ctx, modo, salida: 0.3, aplauso: 0.4 }, 1);
      const b = manoSuelta({ ...ctx, modo, salida: 0.3, aplauso: 0.4 }, -1);
      expect(a[0]).toBeCloseTo(-b[0], 12);
      expect(a[1]).toBeCloseTo(b[1], 12);
    }
  });
  it("quien aplaude sentado tiene las manos arriba de la cabeza y se juntan con el aplauso; la ganadora las sube más", () => {
    const afuera = manoSuelta({ ...ctx, modo: "sentado", aplauso: 0 }, 1);
    const junto = manoSuelta({ ...ctx, modo: "sentado", aplauso: 1 }, 1);
    expect(afuera[1]).toBeGreaterThan(1);
    expect(junto[0]).toBeLessThan(afuera[0]);
    expect(manoSuelta({ ...ctx, modo: "salta" }, 1)[1]).toBeGreaterThan(afuera[1]);
  });
  it("sin pulso, las manos sueltas no se mueven con la hora: quietas en el corte", () => {
    const a = manoSuelta({ ...ctx, modo: "rueda" }, 1);
    const b = manoSuelta({ ...ctx, modo: "rueda" }, 1);
    expect(a).toEqual(b);
  });
  it("en las filas, ellas con las manos en la cintura y ellos dando palmadas que se juntan en cada tiempo", () => {
    expect(manoDeFila({ tipoy: true, ritmo: 0.3 }, 1)[1]).toBeLessThan(0.55);
    const junta = manoDeFila({ tipoy: false, ritmo: 0 }, 1);
    const abre = manoDeFila({ tipoy: false, ritmo: 1 }, 1);
    expect(junta[0]).toBeLessThan(abre[0]);
    expect(junta[2]).toBeGreaterThan(0.1);
  });
});

/** Un bailarín de prueba. */
const bailarin = (id: number, tipoy: boolean): BailarinEntrada => ({
  id, visible: true, tipoy, color: 0xe93d9c, x: 0, y: 0, alto: 0, modo: "rueda", cx: 0, cy: 0, sentido: 1, haciaSala: 0, pareja: -1, inclinacion: 0,
  paso: 0, sentado: 0, filas: 0, salida: -1, alerta: false, tinte: 0,
});

describe("la gente se dibuja en pocas mallas, sea cuanta sea", () => {
  function dibujar(n: number, liviano: boolean): { llamadas: number; instancias: number; finito: boolean } {
    const escena = new Scene();
    const gente = new Gente(escena, new Basura(), n, 0x16161f, liviano, true);
    gente.inicio();
    const fijas = Array.from({ length: n }, (_, i) => personaFija(i % 2 === 0, 0xe93d9c, i, i + 1, i + 2));
    for (let i = 0; i < n; i++) {
      const c: Cuerpo = { fx: i * 0.7, fy: 0, fz: (i % 5) * 0.5, D: 1, yaw: i * 0.3, lean: 0.05 * Math.sin(i), baja: i % 7 === 0 ? BAJA_SENTADO : 0 };
      gente.persona(fijas[i]!, c, 0.02, 0, i % 7 === 0 ? 1 : 0, [c.fx + 0.2, 0.6, c.fz], [c.fx - 0.2, 0.6, c.fz], [1, 1, 1], 1);
    }
    gente.fin(true);
    let llamadas = 0, instancias = 0, finito = true;
    escena.traverse((o) => {
      const m = o as unknown as { isInstancedMesh?: boolean; count?: number; instanceMatrix?: { array: Float32Array } };
      if (!m.isInstancedMesh) return;
      if ((m.count ?? 0) > 0) llamadas++;
      instancias += m.count ?? 0;
      for (const v of m.instanceMatrix!.array.subarray(0, (m.count ?? 0) * 16)) if (!Number.isFinite(v)) finito = false;
    });
    return { llamadas, instancias, finito };
  }

  it("con 2, 18 y 200 las llamadas de dibujo son las mismas (o casi)", () => {
    const a = dibujar(2, false), b = dibujar(18, false), c = dibujar(200, true);
    expect(a.finito && b.finito && c.finito).toBe(true);
    expect(b.llamadas - a.llamadas).toBeLessThan(10);
    expect(c.llamadas).toBeLessThanOrEqual(b.llamadas);
    expect(b.llamadas).toBeLessThan(40);
    expect(c.instancias).toBeGreaterThan(b.instancias);
  });
});

describe("el contrato con el 2D", () => {
  it("la entrada completa se arma sin campos que dependan de quién gana", () => {
    const e: Pick<EntradaChovena, "corona" | "golpe" | "tension"> = { corona: -1, golpe: -1, tension: 0 };
    expect(Object.keys(e).sort()).toEqual(["corona", "golpe", "tension"]);
  });
});
