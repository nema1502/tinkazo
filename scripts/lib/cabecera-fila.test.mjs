import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ANCHOS_CABECERA, MARGEN_FILA_PX, SONDA_FILA_CABECERA, evaluarFilaCabecera } from "./cabecera-fila.mjs";

const caja = (arriba, abajo, izquierda, derecha) => ({ arriba, abajo, izquierda, derecha });
/** Una cabecera de una sola fila: el logo a la izquierda, los enlaces en el medio y el grupo a la derecha. */
const enUnaFila = (extra = {}) => ({
  logo: caja(20, 68, 20, 140),
  ultimoEnlace: caja(22, 66, 700, 860),
  ultimoTexto: "Empresas",
  entradas: 5,
  lado: caja(20, 68, 900, 1081),
  marca: true,
  ladoTexto: "es en Oficial Entrar",
  ancho: 1101,
  ...extra,
});

describe("la cabecera de escritorio en una sola fila", () => {
  it("mira 1101 y 1280 px", () => {
    expect(ANCHOS_CABECERA).toEqual([1101, 1280]);
  });

  it("pasa cuando el grupo de la derecha está en la fila del logo y no lo pisa la fila de enlaces", () => {
    const r = evaluarFilaCabecera(enUnaFila());
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain("40 px de aire");
  });

  it("falla con un mensaje claro cuando el grupo cae a una segunda fila, debajo del logo y a la izquierda", () => {
    const caido = enUnaFila({ lado: caja(76, 124, 20, 201) });
    const r = evaluarFilaCabecera(caido);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/cayó a otra fila/);
    expect(r.detalle).toContain("56 px debajo del logo");
    expect(r.detalle).toContain("1101 px de ancho");
  });

  it("la diferencia de pocos píxeles todavía es la misma fila, y la que pasa del margen no", () => {
    const base = enUnaFila();
    const corrido = (dy) => enUnaFila({ lado: caja(base.lado.arriba + dy, base.lado.abajo + dy, 900, 1081) });
    expect(evaluarFilaCabecera(corrido(MARGEN_FILA_PX)).ok).toBe(true);
    expect(evaluarFilaCabecera(corrido(-MARGEN_FILA_PX)).ok).toBe(true);
    expect(evaluarFilaCabecera(corrido(MARGEN_FILA_PX + 1)).ok).toBe(false);
    expect(evaluarFilaCabecera(corrido(-(MARGEN_FILA_PX + 1))).detalle).toContain("arriba del logo");
  });

  it("falla cuando el último enlace llega a pisar al grupo de la derecha, aunque sigan en la misma fila", () => {
    const r = evaluarFilaCabecera(enUnaFila({ ultimoEnlace: caja(22, 66, 800, 930) }));
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/pisa 30 px/);
    expect(r.detalle).toContain("Empresas");
  });

  it("falla, y lo dice, si no encuentra el logo o el grupo: no pasa a ciegas", () => {
    expect(evaluarFilaCabecera(enUnaFila({ lado: null })).ok).toBe(false);
    expect(evaluarFilaCabecera(enUnaFila({ logo: null })).detalle).toMatch(/\.header-lado/);
    expect(evaluarFilaCabecera(null).ok).toBe(false);
  });

  it("falla si la marca del modo no está: sin ella no se midió el caso más ancho", () => {
    const r = evaluarFilaCabecera(enUnaFila({ marca: false }));
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/modo Oficial/);
  });

  it("la sonda fuerza las campañas abiertas y devuelve las cajas que la evaluación necesita", () => {
    const el = (r, texto = "", visible = true) => ({
      getBoundingClientRect: () => ({ top: r[0], bottom: r[1], left: r[2], right: r[3] }),
      getClientRects: () => (visible ? [1] : []),
      textContent: texto,
    });
    const atributos = {};
    const documento = {
      documentElement: { setAttribute: (k, v) => (atributos[k] = v), clientWidth: 1101 },
      querySelector: (s) => (s === "header .auth .netbadge" ? el([30, 58, 800, 880], "Oficial") : s === "header .wordmark" ? el([20, 68, 20, 140]) : s === "header .header-lado" ? el([20, 68, 900, 1081], " es en Oficial ") : null),
      querySelectorAll: () => [el([22, 66, 300, 400], "Sortear"), el([22, 66, 600, 700], "Para empresas", false), el([22, 66, 700, 860], " Empresas ")],
    };
    const medido = JSON.parse(vm.runInNewContext(SONDA_FILA_CABECERA, { document: documento }));
    expect(atributos["data-campanas"]).toBe("1");
    expect(medido.entradas).toBe(2);
    expect(medido.ultimoTexto).toBe("Empresas");
    expect(medido.ancho).toBe(1101);
    expect(medido.marca).toBe(true);
    expect(evaluarFilaCabecera(medido).ok).toBe(true);
  });
});
