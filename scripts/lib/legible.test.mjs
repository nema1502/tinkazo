import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  REGLAS,
  agruparEstadio,
  archivoDe,
  escanearDom,
  estadoDelSorteo,
  evaluarDom,
  evaluarEstadio,
  instalarMuestreador,
  llamar,
  minimoPara,
  preludioEstadio,
  reglasDe,
} from "./legible.mjs";

describe("la regla de tamaños", () => {
  it("es la del barrido: 28 y 48 en el proyector, 16 y 22 en el celular", () => {
    expect(REGLAS.proyector).toMatchObject({ ancho: 1920, alto: 1080, secundario: 28, principal: 48 });
    expect(REGLAS.celular).toMatchObject({ ancho: 390, alto: 844, secundario: 16, principal: 22 });
    expect(minimoPara(REGLAS.proyector, true)).toBe(48);
    expect(minimoPara(REGLAS.celular, false)).toBe(16);
  });

  it("se cambia con --reglas sin tocar la original, y una regla mal escrita avisa", () => {
    const r = reglasDe("proyector=30:50");
    expect(r.proyector).toMatchObject({ secundario: 30, principal: 50 });
    expect(r.celular.secundario).toBe(16);
    expect(REGLAS.proyector.secundario).toBe(28);
    expect(() => reglasDe("tablet=1:2")).toThrow(/mal escrita/);
  });
});

describe("juzgar los textos del DOM", () => {
  const t = (texto, px, ruta = "p", principal = false, extra = {}) => ({ texto, px, ruta, principal, x: 10, y: 20, w: 100, h: 18, ...extra });

  it("deja pasar lo que llega al mínimo de su rol, y exige más a lo principal", () => {
    const { medidos, grupos } = evaluarDom([t("Cuerpo", 28), t("Título", 40, "h1", true), t("Pie", 14, "footer.pie")], REGLAS.proyector);
    expect(medidos).toBe(3);
    expect(grupos.map((g) => g.ruta)).toEqual(["footer.pie", "h1"]);
    expect(grupos.find((g) => g.ruta === "h1")).toMatchObject({ minimo: 48, principal: true });
  });

  it("junta en una falla los textos del mismo selector y tamaño, y cuenta cuántos son", () => {
    const pie = Array.from({ length: 40 }, (_, i) => t(`Enlace ${i}`, 14, "a.pie", false, { y: 900 + i }));
    const { grupos } = evaluarDom(pie, REGLAS.proyector);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].textos).toHaveLength(40);
    expect(grupos[0].caja.y).toBe(900);
  });

  it("el mismo texto repetido en el mismo lugar cuenta una vez, con su tamaño mayor", () => {
    const { medidos, grupos } = evaluarDom([t("Hola", 10), t("Hola", 30), t("Hola", 12)], REGLAS.proyector);
    expect(medidos).toBe(1);
    expect(grupos).toEqual([]);
  });

  it("los más chicos respecto de lo que piden van primero", () => {
    const { grupos } = evaluarDom([t("a", 20, "x"), t("b", 8, "y"), t("c", 13, "z")], REGLAS.celular);
    expect(grupos.map((g) => g.ruta)).toEqual(["y", "z"]);
  });
});

describe("juzgar los textos del lienzo", () => {
  const e = (s, capa, n, mediana, max = mediana) => ({ s, capa, n, mediana, max, min: mediana, box: [0, 0, 10, 10], recorte: null });

  it("juzga la mediana, no el máximo, y el cartel es lo principal", () => {
    const { medidos, malos } = evaluarEstadio(
      [e("María Quispe", "nombres", 40, 20, 60), e("GANA María", "podio", 12, 70), e("GANA Jorge", "podio", 12, 40), e("Fugaz", "escena", 1, 5)],
      REGLAS.proyector,
    );
    expect(medidos).toBe(3);
    expect(malos.map((m) => m.texto)).toEqual(["María Quispe", "GANA Jorge"]);
    expect(malos.find((m) => m.texto === "GANA Jorge").minimo).toBe(48);
  });

  it("agrupa por capa y tamaño: veinte etiquetas iguales son una falla", () => {
    const nombres = Array.from({ length: 20 }, (_, i) => e(`Nombre ${i}`, "nombres", 30, 14.2 + (i % 2) * 0.1));
    const { malos } = evaluarEstadio([...nombres, e("Marcador", "hud", 30, 10)], REGLAS.proyector);
    const g = agruparEstadio(malos);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.capa === "nombres").textos).toHaveLength(20);
    expect(g[0].capa).toBe("hud");
  });
});

describe("el código que corre adentro de la página", () => {
  it("se manda como texto y compila", () => {
    expect(() => new Function(`return ${llamar(escanearDom, "#stadium")}`)).not.toThrow();
    expect(() => new Function(`return ${llamar(estadoDelSorteo)}`)).not.toThrow();
    expect(() => new Function(preludioEstadio({ cada: 16, principal: 48, secundario: 28 }))).not.toThrow();
  });

  /** Una página de mentira: el estadio, el lienzo, un reloj de fotogramas y las capas de Pixi. */
  const pagina = () => {
    const ctx = { console, Math };
    ctx.window = ctx;
    ctx.innerWidth = 1920;
    ctx.innerHeight = 1080;
    ctx.abierto = true;
    ctx.getComputedStyle = () => ({ display: ctx.abierto ? "block" : "none" });
    ctx.recortes = 0;
    ctx.document = {
      getElementById: (id) => (id === "stadium" ? {} : id === "pixi-canvas" ? { width: 1920 } : null),
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {
            ctx.recortes++;
          },
        }),
        toDataURL: () => "data:image/png;base64,AAAA",
      }),
    };
    vm.createContext(ctx);
    vm.runInContext(`(${instalarMuestreador.toString()})(${JSON.stringify({ principal: 48, secundario: 28 })})`, ctx);
    return ctx;
  };
  const caja = (...hijos) => ({ visible: true, renderable: true, alpha: 1, children: hijos });
  const texto = (s, fontSize, escala = 1, extra = {}) => ({
    visible: true,
    renderable: true,
    alpha: 1,
    text: s,
    style: { fontSize },
    worldTransform: { a: escala, b: 0 },
    getBounds: () => ({ x: 100, y: 200, width: 120, height: 30 }),
    children: [],
    ...extra,
  });

  it("anota el tamaño en pantalla de cada texto por capa: tamaño de letra por la escala del mundo", () => {
    const ctx = pagina();
    const nombre = texto("María Quispe", 20, 0.8);
    const cartel = texto("GANA María", 40, 2);
    ctx.__app = { stage: { children: [caja(), caja(nombre), caja(), caja(), caja(cartel)] } };
    for (let i = 0; i < 5; i++) ctx.__legible.muestrear();
    const r = ctx.__legible.resumen();
    const n = r.find((x) => x.s === "María Quispe");
    expect(n).toMatchObject({ capa: "escena", n: 5, mediana: 16, max: 16 });
    expect(r.find((x) => x.s === "GANA María")).toMatchObject({ capa: "podio", mediana: 80 });
    expect(ctx.__legible.muestras).toBe(5);
  });

  it("no cuenta lo invisible, lo apenas visible ni los textos de un solo carácter", () => {
    const ctx = pagina();
    const tenue = { ...caja(texto("hijo de lo tenue", 30)), alpha: 0.4 };
    ctx.__app = { stage: { children: [caja(texto("oculto", 30, 1, { visible: false }), texto("tenue", 30, 1, { alpha: 0.3 }), texto("x", 30)), tenue] } };
    ctx.__legible.muestrear();
    expect(ctx.__legible.resumen()).toEqual([]);
  });

  it("de un texto que queda chico guarda un recorte del lienzo; de uno que se lee, no", () => {
    const ctx = pagina();
    ctx.__app = { stage: { children: [caja(), caja(), caja(), caja(texto("Chico", 12), texto("Grande", 40))] } };
    ctx.__legible.muestrear();
    const r = ctx.__legible.resumen();
    expect(r.find((x) => x.s === "Chico").recorte).toMatch(/^data:image\/png/);
    expect(r.find((x) => x.s === "Grande").recorte).toBeNull();
    expect(ctx.recortes).toBe(1);
  });

  it("sabe cuándo terminó el show: lo vio abierto y ahora está cerrado", () => {
    const ctx = pagina();
    ctx.__app = { stage: { children: [] } };
    ctx.__legible.muestrear();
    expect(ctx.__legible.fin).toBe(false);
    ctx.abierto = false;
    ctx.__legible.muestrear();
    expect(ctx.__legible.fin).toBe(true);
  });
});

describe("el reloj del estadio", () => {
  it("sigue muestreando cuando el juego ya no pide cuadros, así se entera de que el show cerró", () => {
    const reales = [];
    const ctx = { console, performance: { now: () => 0 }, innerWidth: 1920, innerHeight: 1080, abierto: true };
    ctx.window = ctx;
    ctx.requestAnimationFrame = (cb) => reales.push(cb);
    ctx.cancelAnimationFrame = () => {};
    ctx.getComputedStyle = () => ({ display: ctx.abierto ? "block" : "none" });
    ctx.document = { getElementById: () => ({}) };
    vm.createContext(ctx);
    vm.runInContext(preludioEstadio({ cada: 4, principal: 48, secundario: 28 }), ctx);
    ctx.__app = { stage: { children: [] } };
    let pedidos = 0;
    const juego = () => {
      pedidos++;
      if (pedidos < 30) ctx.requestAnimationFrame(juego);
    };
    ctx.requestAnimationFrame(juego);
    const cuadroReal = () => reales.shift()();
    for (let i = 0; i < 5; i++) cuadroReal();
    // El juego pidió sus 30 cuadros (20 por cuadro real) y ya no pide más.
    expect(pedidos).toBe(30);
    expect(ctx.__legible.vio).toBe(true);
    expect(ctx.__legible.fin).toBe(false);
    ctx.abierto = false;
    for (let i = 0; i < 6; i++) cuadroReal();
    expect(ctx.__legible.fin).toBe(true);
  });
});

describe("nombres de archivo", () => {
  it("seguros para el disco, sin tildes ni símbolos", () => {
    expect(archivoDe("legible", "celular", "dark", "inicio (la lista)", "a.pie", "14px")).toBe("legible-celular-dark-inicio_la_lista_-a.pie-14px.png");
    expect(archivoDe("x", "ñandú: /\\?").endsWith(".png")).toBe(true);
    expect(archivoDe("a".repeat(300)).length).toBeLessThanOrEqual(94);
  });
});
