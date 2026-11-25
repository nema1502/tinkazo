// @vitest-environment jsdom
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  AIRE_BORDE_CELULAR_PX,
  AIRE_MINIMO_PX,
  ANCHOS_CABECERA,
  ANCHOS_CELULAR,
  AGRANDAR_LETRA,
  ESCALA_LETRA_SISTEMA,
  FORZAR_LETRA_ANCHA,
  LETRA_ANCHA,
  LETRA_MONO_ANCHA,
  MARGEN_FILA_PX,
  SONDA_FILA_CABECERA,
  SONDA_FILA_CELULAR,
  cuentaAbiertaJs,
  evaluarFilaCabecera,
  evaluarFilaCelular,
} from "./cabecera-fila.mjs";

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
  it("mira los cuatro saltos de la cabecera: 1101, 1200, 1280 y 1440 px", () => {
    // 1101 es el más angosto de la fila de una línea, 1200 y 1280 son donde el chip de la cuenta abierta gana el nombre y las
    // ocho letras más, y 1440 es donde el enlace vuelve a decir Para empresas y el chip, la frase entera.
    expect(ANCHOS_CABECERA).toEqual([1101, 1200, 1280, 1440]);
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

  it("falla si el aire hasta el grupo de la derecha es menor al mínimo, aunque la fila entre", () => {
    const justo = enUnaFila({ ultimoEnlace: caja(22, 66, 700, 900 - AIRE_MINIMO_PX) });
    expect(evaluarFilaCabecera(justo).ok).toBe(true);
    const corto = enUnaFila({ ultimoEnlace: caja(22, 66, 700, 900 - AIRE_MINIMO_PX + 1) });
    const r = evaluarFilaCabecera(corto);
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain(`${AIRE_MINIMO_PX - 1} px de aire`);
    expect(r.detalle).toContain(`mínimo es de ${AIRE_MINIMO_PX} px`);
    expect(r.detalle).toContain("letra ancha");
  });

  it("la letra ancha se pone con prioridad en la cabecera: la monoespaciada con una ancha monoespaciada y el resto con una ancha", () => {
    const pone = [];
    const el = (fuente) => ({ _f: fuente, style: { setProperty: (k, v, prio) => pone.push([fuente, k, v, prio]) } });
    const lista = [el("system-ui, -apple-system, 'Segoe UI', sans-serif"), el("ui-monospace, Consolas, monospace"), el("Consolas")];
    const documento = { querySelectorAll: (s) => (s === "header, header *" ? lista : []) };
    const getComputedStyle = (e) => ({ fontFamily: e._f });
    const cuantos = vm.runInNewContext(FORZAR_LETRA_ANCHA, { document: documento, getComputedStyle });
    expect(cuantos).toBe(3);
    expect(pone).toEqual([
      [lista[0]._f, "font-family", LETRA_ANCHA, "important"],
      [lista[1]._f, "font-family", LETRA_MONO_ANCHA, "important"],
      [lista[2]._f, "font-family", LETRA_MONO_ANCHA, "important"],
    ]);
    expect(LETRA_ANCHA).toMatch(/Verdana/);
    expect(LETRA_MONO_ANCHA).toMatch(/Courier New/);
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

  it("la cuenta abierta reemplaza al chip de Entrar por el de adentro, con un nombre de pila largo y la frase de la vía en cada idioma", () => {
    for (const [idioma, via, corta] of [["es", "Entraste con Google", "Google"], ["en", "Signed in with Google", "Google"]]) {
      document.body.innerHTML = '<div class="auth" id="wallet-box"><button class="cuenta-chip fuera mini" data-estado="fuera"><span class="cc-t">Entrar</span></button></div>';
      expect((0, eval)(cuentaAbiertaJs(idioma))).toBe(true);
      const chip = document.querySelector("#wallet-box .cuenta-chip");
      expect(document.querySelectorAll("#wallet-box .cuenta-chip")).toHaveLength(1);
      expect(chip.dataset.estado).toBe("dentro");
      expect(chip.classList.contains("hello")).toBe(true);
      expect(chip.querySelector(".cc-nombre")?.textContent).toBe("Maximiliano");
      expect(chip.querySelector(".cc-via-l")?.textContent).toBe(via);
      expect(chip.querySelector(".cc-via-c")?.textContent).toBe(corta);
      expect(chip.querySelector(".hello-face")).not.toBeNull();
      expect(chip.querySelector(".cc-ok")).not.toBeNull();
    }
  });

  it("la cuenta abierta avisa con falso si no hay dónde ponerla, y no inventa el contenedor", () => {
    document.body.innerHTML = "<div></div>";
    expect((0, eval)(cuentaAbiertaJs("es"))).toBe(false);
    expect(document.querySelector("#wallet-box")).toBeNull();
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

/** Una fila del celular que entra: a 412 px, con Empresas entera y la flecha de Más a 30 px del borde. */
const filaDelCelular = (extra = {}) => ({
  ancho: 412,
  scrollAncho: 412,
  nav: { arriba: 60, abajo: 104, izquierda: 16, derecha: 396 },
  mas: { arriba: 60, abajo: 104, izquierda: 340, derecha: 382 },
  empresas: { arriba: 60, abajo: 104, izquierda: 240, derecha: 330 },
  empresasCortada: false,
  entradas: 4,
  ...extra,
});

describe("la fila de la cabecera del celular", () => {
  it("mira los anchos donde cambia el relleno: el corte de 412 px, 414 y el salto de 461 y de 521 px", () => {
    expect(ANCHOS_CELULAR).toEqual([412, 414, 461, 521]);
    expect(ESCALA_LETRA_SISTEMA).toBe(1.2);
    expect(AIRE_BORDE_CELULAR_PX).toBe(8);
  });

  it("pasa cuando la flecha de Más queda dentro del borde y Empresas está en la fila", () => {
    const r = evaluarFilaCelular(filaDelCelular());
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain("30 px del borde");
    expect(r.detalle).toContain("Empresas entera");
  });

  it("con la letra agrandada Empresas puede achicarse: pasa si Más sigue dentro, y lo dice", () => {
    const r = evaluarFilaCelular(filaDelCelular({ empresasCortada: true }));
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain("achicada con puntos suspensivos");
  });

  it("falla si la flecha de Más queda a menos de 8 px del borde de la pantalla", () => {
    const justo = filaDelCelular({ mas: { arriba: 60, abajo: 104, izquierda: 340, derecha: 412 - AIRE_BORDE_CELULAR_PX } });
    expect(evaluarFilaCelular(justo).ok).toBe(true);
    const pegado = filaDelCelular({ mas: { arriba: 60, abajo: 104, izquierda: 340, derecha: 412 - AIRE_BORDE_CELULAR_PX + 1 } });
    const r = evaluarFilaCelular(pegado);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/Más termina a 7 px del borde/);
    expect(r.detalle).toContain("412 px de ancho");
  });

  it("falla si la página se recorre de costado", () => {
    const r = evaluarFilaCelular(filaDelCelular({ scrollAncho: 431 }));
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/recorre de costado/);
  });

  it("falla si Empresas no está en la fila: no se midió el caso de las cuatro entradas", () => {
    const r = evaluarFilaCelular(filaDelCelular({ empresas: null, entradas: 3 }));
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/Empresas/);
  });

  it("falla, y lo dice, si no encuentra el botón de Más o no hay medida", () => {
    expect(evaluarFilaCelular(filaDelCelular({ mas: null })).ok).toBe(false);
    expect(evaluarFilaCelular(null).ok).toBe(false);
  });

  it("agranda la letra de la fila al 120 % con prioridad, sin cambiar de familia", () => {
    expect(AGRANDAR_LETRA).toContain("19.2px");
    expect(AGRANDAR_LETRA).toContain("!important");
    expect(AGRANDAR_LETRA).toContain("header .topnav a");
    expect(AGRANDAR_LETRA).toContain("header .topnav .mas-btn");
    expect(AGRANDAR_LETRA).not.toContain("font-family");
  });

  it("la sonda fuerza las campañas abiertas y devuelve las cajas del celular", () => {
    const el = (r, extra = {}) => ({
      getBoundingClientRect: () => ({ top: r[0], bottom: r[1], left: r[2], right: r[3] }),
      getClientRects: () => [1],
      scrollWidth: 90,
      clientWidth: 90,
      ...extra,
    });
    const atributos = {};
    const piezas = {
      "header .topnav": el([60, 104, 16, 396]),
      "header .topnav .mas-btn": el([60, 104, 340, 382]),
      "header .topnav a.nav-empresas-cel": el([60, 104, 240, 330], { scrollWidth: 120, clientWidth: 90 }),
    };
    const documento = {
      documentElement: { setAttribute: (k, v) => (atributos[k] = v), clientWidth: 412, scrollWidth: 412 },
      querySelector: (s) => piezas[s] ?? null,
      querySelectorAll: () => [1, 2, 3, 4].map((n) => el([60, 104, n, n + 1])),
    };
    const medido = JSON.parse(vm.runInNewContext(SONDA_FILA_CELULAR, { document: documento }));
    expect(atributos["data-campanas"]).toBe("1");
    expect(medido.ancho).toBe(412);
    expect(medido.scrollAncho).toBe(412);
    expect(medido.mas.derecha).toBe(382);
    expect(medido.empresas.izquierda).toBe(240);
    expect(medido.empresasCortada).toBe(true);
    expect(medido.entradas).toBe(4);
  });
});
