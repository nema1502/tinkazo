import { describe, expect, it } from "vitest";
import {
  FRACCION_ALTO,
  LETRA_DISENO,
  MINIMO_PX,
  compensarZoom,
  mediana,
  minimoPx,
  nivelParaLugar,
  nivelPorCantidad,
  nivelesDe,
  nombreLegible,
  planNombres,
  separarEtiquetas,
  SEPARACION_ETIQUETA_MAX,
  SOLAPE_ETIQUETA_MAX,
  tamanoLetra,
  unidadDe,
  type Nivel,
  type Rol,
} from "./nombres";

/** Pantallas de verdad: un proyector, una laptop, un escritorio chico y dos celulares. */
const PANTALLAS = [
  { nombre: "1080p", ancho: 1920, alto: 1080 },
  { nombre: "720p", ancho: 1280, alto: 720 },
  { nombre: "laptop", ancho: 1366, alto: 768 },
  { nombre: "celular parado", ancho: 390, alto: 844 },
  { nombre: "celular chico", ancho: 360, alto: 640 },
  { nombre: "celular acostado", ancho: 844, alto: 390 },
];
const ROLES: Rol[] = ["nombre", "apoyo", "cartel"];

describe("nombres: el tamaño de letra", () => {
  it("a 1080p el nombre mide 28,5 px, el 2,6 % del alto o más", () => {
    const u = unidadDe(1920, 1080);
    expect(u).toBe(1.5);
    expect(tamanoLetra("nombre", u)).toBeCloseTo(28.5, 5);
    expect(tamanoLetra("nombre", u) / 1080).toBeGreaterThanOrEqual(FRACCION_ALTO.nombre);
  });

  it("a 720 el nombre mide su tamaño de diseño y también cumple el 2,6 %", () => {
    expect(tamanoLetra("nombre", unidadDe(1280, 720))).toBe(LETRA_DISENO.nombre);
    expect(tamanoLetra("nombre", unidadDe(1280, 720)) / 720).toBeGreaterThanOrEqual(FRACCION_ALTO.nombre);
  });

  it("a 390 de ancho el nombre mide 17,6 px: más que los 16 del piso", () => {
    const px = tamanoLetra("nombre", unidadDe(390, 844));
    expect(px).toBeCloseTo(17.65, 1);
    expect(px).toBeGreaterThanOrEqual(MINIMO_PX.nombre);
  });

  it("el piso se sostiene cuando la pantalla es muy chica", () => {
    expect(tamanoLetra("nombre", unidadDe(844, 390))).toBe(MINIMO_PX.nombre);
    expect(tamanoLetra("apoyo", unidadDe(360, 640))).toBe(MINIMO_PX.apoyo);
  });

  it("con el modo para compartir la letra crece un veinte por ciento", () => {
    expect(tamanoLetra("nombre", 1, true)).toBeCloseTo(LETRA_DISENO.nombre * 1.2, 5);
  });

  it("crece con la pantalla hasta el doble y no más", () => {
    expect(tamanoLetra("nombre", 3)).toBe(LETRA_DISENO.nombre * 2);
  });

  it("en cada pantalla y cada rol, el tamaño cumple el mínimo de la regla", () => {
    for (const p of PANTALLAS) {
      for (const rol of ROLES) {
        const px = tamanoLetra(rol, unidadDe(p.ancho, p.alto));
        expect(px, `${p.nombre} ${rol}`).toBeGreaterThanOrEqual(minimoPx(rol, p.ancho, p.alto) - 1e-9);
      }
    }
  });

  it("el cartel mide más que el nombre y el nombre más que el apoyo", () => {
    for (const p of PANTALLAS) {
      const u = unidadDe(p.ancho, p.alto);
      expect(tamanoLetra("cartel", u)).toBeGreaterThan(tamanoLetra("nombre", u));
      expect(tamanoLetra("nombre", u)).toBeGreaterThanOrEqual(tamanoLetra("apoyo", u));
    }
  });
});

describe("nombres: los niveles por cantidad", () => {
  it("hasta 8 el nombre entero, hasta 12 con inicial, hasta 20 de pila, más la inicial", () => {
    expect([1, 8, 9, 12, 13, 20, 21, 200].map(nivelPorCantidad)).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
  });

  it("el nivel que cabe no pasa del que dice la cantidad ni del lugar que hay", () => {
    const ancho = (n: Nivel): number => [0, 10, 40, 70, 110][n] as number;
    expect(nivelParaLugar(5, 200, ancho)).toBe(4);
    expect(nivelParaLugar(5, 80, ancho)).toBe(3);
    expect(nivelParaLugar(30, 200, ancho)).toBe(1);
  });

  it("todos los que siguen quedan en el mismo nivel: nunca por quién", () => {
    const plan = planNombres(["María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas"]);
    expect(nivelesDe(plan, [0, 1, 2, 3, 4], 2)).toEqual([2, 2, 2, 2, 2]);
  });

  it("dos personas con el mismo texto suben juntas hasta distinguirse", () => {
    const plan = planNombres(["María Quispe", "María Mamani", "Jorge Mamani"]);
    expect(nivelesDe(plan, [0, 1, 2], 2)).toEqual([3, 3, 2]);
  });

  it("la mediana no cambia por un nombre larguísimo", () => {
    expect(mediana([10, 12, 11, 900])).toBe(12);
    expect(mediana([])).toBe(0);
  });
});

/** El ancho de un texto a una letra dada: una cuenta, para probar sin tipografía. */
const medir = (s: string, px: number): number => s.length * px * 0.55;

describe("nombres: entrar en la caja sin bajar la letra", () => {
  const lista = ["María Fernanda Guadalupe Quispe Mamani", "Ana", "Maximiliano_Alexander_Constantino_Rosario", "Álvaro", "Jorge Mamani"];
  const plan = planNombres(lista);
  const TAMANO = 28.5;
  const MINIMO = 28;

  it("un nombre corto entra entero a la letra normal", () => {
    const r = nombreLegible(plan, 1, 4, 300, TAMANO, MINIMO, medir);
    expect(r).toEqual({ lineas: ["Ana"], px: TAMANO, nivel: 4 });
  });

  it("nunca baja del mínimo, aunque la caja sea angosta: acorta el texto", () => {
    for (const ancho of [400, 250, 160, 90, 40, 20]) {
      for (let i = 0; i < lista.length; i++) {
        const r = nombreLegible(plan, i, 4, ancho, TAMANO, MINIMO, medir);
        expect(r.px, `${lista[i]} en ${ancho}`).toBeGreaterThanOrEqual(MINIMO);
        expect(r.lineas.join(" ")).not.toContain("…");
        expect(r.lineas.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("baja de nivel antes que de letra: el nombre largo pasa al de pila", () => {
    const r = nombreLegible(plan, 0, 4, 200, TAMANO, MINIMO, medir);
    expect(r.nivel).toBeLessThan(4);
    expect(r.px).toBeGreaterThanOrEqual(MINIMO);
  });

  it("nunca corta una palabra a la mitad", () => {
    for (const ancho of [400, 250, 160, 90, 40]) {
      for (let i = 0; i < lista.length; i++) {
        const r = nombreLegible(plan, i, 4, ancho, TAMANO, MINIMO, medir);
        const palabras = new Set((lista[i] as string).split(/[\s_]+/));
        const partes = r.lineas.join(" ").split(/[\s_]+/).filter(Boolean);
        // Cada pedazo es una palabra del nombre, su inicial con punto, o un tramo que termina donde hay un guion bajo.
        for (const p of partes) {
          const ok = palabras.has(p) || /^\p{L}\.?$/u.test(p) || [...palabras].some((w) => w.startsWith(p));
          expect(ok, `"${p}" de ${lista[i]} en ${ancho}`).toBe(true);
        }
      }
    }
  });

  it("es una función: el mismo pedido da lo mismo", () => {
    expect(nombreLegible(plan, 0, 4, 180, TAMANO, MINIMO, medir)).toEqual(nombreLegible(plan, 0, 4, 180, TAMANO, MINIMO, medir));
  });

  it("a 390, 720 y 1080 el nombre de una lista de ejemplo se lee a su mínimo o más", () => {
    for (const p of PANTALLAS.slice(0, 4)) {
      const u = unidadDe(p.ancho, p.alto);
      const tamano = tamanoLetra("nombre", u);
      const minimo = minimoPx("nombre", p.ancho, p.alto);
      for (let i = 0; i < lista.length; i++) {
        const r = nombreLegible(plan, i, 4, p.ancho / 5, tamano, minimo, medir);
        expect(r.px, `${p.nombre} ${lista[i]}`).toBeGreaterThanOrEqual(minimo - 1e-6);
      }
    }
  });
});

describe("nombres: el zoom no los baja del mínimo", () => {
  it("si la cámara se aleja, el nombre se agranda para llegar al mínimo", () => {
    expect(compensarZoom(28, 0.5, 28)).toBe(2);
    expect(compensarZoom(28, 0.8, 28)).toBeCloseTo(1.25, 5);
  });

  it("si ya se ve bien, o la cámara se acerca, no se toca", () => {
    expect(compensarZoom(28, 1, 28)).toBe(1);
    expect(compensarZoom(28, 1.6, 28)).toBe(1);
    expect(compensarZoom(0, 1, 28)).toBe(1);
  });

  it("el nombre compensado en pantalla mide el mínimo", () => {
    const zoom = 0.62;
    const f = compensarZoom(24, zoom, 28);
    expect(24 * f * zoom).toBeCloseTo(28, 5);
  });
});

describe("separarEtiquetas: dos nombres no se encapan", () => {
  const zona = { y0: 40, y1: 700 };
  const caja = (x: number, y: number, prioridad = 0) => ({ x, y, w: 160, h: 40, prioridad });
  const aplicar = (es: readonly { x: number; y: number; w: number; h: number; prioridad: number }[], vedas: { x: number; y: number; w: number; h: number }[] = []) => {
    const s = separarEtiquetas(es, zona, vedas);
    return es.map((e, i) => ({ ...e, y: e.y + (s[i]?.dy ?? 0), callar: s[i]?.callar ?? false }));
  };
  const area = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  it("las que no se pisan quedan donde estaban", () => {
    const s = separarEtiquetas([caja(0, 100), caja(0, 200), caja(300, 100)], zona);
    expect(s).toEqual([{ dy: 0, callar: false }, { dy: 0, callar: false }, { dy: 0, callar: false }]);
  });

  it("la de menor prioridad es la que se corre, y la destacada se queda", () => {
    const s = separarEtiquetas([caja(0, 100, 1), caja(20, 110, 5)], zona);
    expect(s[1]).toEqual({ dy: 0, callar: false });
    expect(s[0]?.dy).not.toBe(0);
    expect(Math.abs(s[0]?.dy ?? 0)).toBeLessThanOrEqual(SEPARACION_ETIQUETA_MAX * 40);
  });

  it("después de separar, ningún par pasa del solape permitido y nadie se corre más del máximo", () => {
    // Un racimo de siete nombres casi en el mismo lugar, como el de la copa del Toborochi.
    const racimo = Array.from({ length: 7 }, (_, i) => caja(100 + (i % 3) * 30, 300 + (i % 2) * 15, i));
    const fin = aplicar(racimo).filter((e) => !e.callar);
    for (let i = 0; i < fin.length; i++) {
      for (let j = i + 1; j < fin.length; j++) {
        const a = fin[i] as (typeof fin)[number];
        const b = fin[j] as (typeof fin)[number];
        expect(area(a, b)).toBeLessThanOrEqual(SOLAPE_ETIQUETA_MAX * Math.min(a.w * a.h, b.w * b.h) + 1e-9);
      }
    }
    racimo.forEach((e, i) => {
      const f = aplicar(racimo)[i] as (typeof fin)[number];
      if (!f.callar) expect(Math.abs(f.y - e.y)).toBeLessThanOrEqual(SEPARACION_ETIQUETA_MAX * e.h + 1e-9);
    });
    // Los de más prioridad son los que no se callan.
    expect(aplicar(racimo)[6]?.callar).toBe(false);
  });

  it("si no cabe, se calla ese nombre en vez de encimarlo", () => {
    const apretado = { y0: 100, y1: 140 };
    const s = separarEtiquetas([caja(0, 100, 2), caja(0, 100, 1)], apretado);
    expect(s[0]).toEqual({ dy: 0, callar: false });
    expect(s[1]?.callar).toBe(true);
  });

  it("nunca sale de la zona", () => {
    const fin = aplicar(Array.from({ length: 6 }, (_, i) => caja(0, 40 + i * 3, i)));
    for (const f of fin) if (!f.callar) {
      expect(f.y).toBeGreaterThanOrEqual(zona.y0 - 1e-9);
      expect(f.y + f.h).toBeLessThanOrEqual(zona.y1 + 1e-9);
    }
  });

  it("una veda (el contador y sus marcas) no se tapa: el nombre baja justo debajo de ella", () => {
    const veda = { x: 0, y: 40, w: 200, h: 110 };
    const [f] = aplicar([caja(10, 60, 3)], [veda]);
    expect(f?.callar).toBe(false);
    expect(f?.y).toBeGreaterThanOrEqual(veda.y + veda.h);
  });

  it("es determinista: la misma entrada da lo mismo", () => {
    const racimo = Array.from({ length: 9 }, (_, i) => caja(50 + (i % 4) * 20, 200 + (i % 3) * 10, i % 3));
    expect(separarEtiquetas(racimo, zona)).toEqual(separarEtiquetas(racimo, zona));
  });
});
