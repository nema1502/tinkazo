// @vitest-environment jsdom
/**
 * La comprobación propia del sello en la pantalla del celular: se pide con lo que la sala dijo de esta campaña, la línea
 * aparece sin repintar nada (el festejo de quien ganó sigue en pie) y, si no se pudo comprobar, no se dice nada.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../idioma";
import type { DepsDelCelular } from "./celular";
import { AHORA, CUENTA, OTRA_CUENTA, SESION, pasar, prepararCelular, propio } from "./celular-falso";
import { TEXTOS_CAMPANA } from "./textos";

type Respuesta = "esta" | null;
type Comprobar = NonNullable<DepsDelCelular["comprobar"]>;

const es = TEXTOS_CAMPANA.es;
const en = TEXTOS_CAMPANA.en;
const COMPROBANTE = "/verificar.html#abc";
const lineaDelSello = (raiz: HTMLElement): string | null => raiz.querySelector("#cmp-estado .cmp-sello")?.textContent ?? null;

/** Una respuesta que se entrega cuando el test lo decide, para mirar la pantalla mientras la comprobación sigue en camino. */
function pendiente(): { comprobar: ReturnType<typeof vi.fn<Comprobar>>; entregar: (r: Respuesta) => Promise<void> } {
  let entrega: (r: Respuesta) => void = () => undefined;
  const comprobar = vi.fn<Comprobar>(() => new Promise<Respuesta>((resolver) => { entrega = resolver; }));
  return {
    comprobar,
    entregar: async (r) => {
      entrega(r);
      await pasar(0);
    },
  };
}

/** La página con el resultado ya dado: la cuenta ganó (o no) y la sala dice el sorteo, las ganadoras y el comprobante. */
async function conResultado(o: { gano: boolean; cambios?: Partial<DepsDelCelular>; sorteo?: string | null; comprobante?: string }) {
  const resultado = vi.fn(async () => ({
    ...(o.sorteo === null ? {} : { sorteo: o.sorteo ?? "7" }),
    ganadoras: o.gano ? [CUENTA] : [OTRA_CUENTA],
    comprobante: o.comprobante ?? COMPROBANTE,
  }));
  const mundo = await prepararCelular({
    sesion: async () => SESION,
    yo: async () => ({ ...propio("sorteada"), gano: o.gano }),
    resultado,
    ...o.cambios,
  }, true);
  await pasar(50);
  return { mundo, resultado };
}

beforeAll(async () => {
  await import("./premio");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
  setLang("es");
});

describe("la comprobación del sello se pide con lo que la sala dice de la campaña", () => {
  it("lleva el comprobante, la cuenta, el sorteo, las ganadoras y la promoción de la campaña", async () => {
    const { comprobar } = pendiente();
    const { mundo } = await conResultado({ gano: true, cambios: { comprobar } });
    expect(comprobar).toHaveBeenCalledTimes(1);
    expect(comprobar).toHaveBeenCalledWith({
      comprobante: COMPROBANTE,
      cuenta: CUENTA,
      campana: { sorteo: "7", ganadoras: [CUENTA], promo: mundo.deps.campana.promo },
    });
  });

  it("si la sala no dice el sorteo, lo pasa como null y es la comprobación la que no afirma", async () => {
    const { comprobar } = pendiente();
    await conResultado({ gano: false, sorteo: null, cambios: { comprobar } });
    expect(comprobar.mock.calls[0]?.[0].campana.sorteo).toBeNull();
  });

  it("no la pide sin comprobante, ni antes del resultado, ni sin la pieza que la hace", async () => {
    const sinComprobante = vi.fn<Comprobar>(async () => "esta");
    await conResultado({ gano: true, cambios: { comprobar: sinComprobante, resultado: async () => ({ ganadoras: [CUENTA], comprobante: null }) } });
    expect(sinComprobante).not.toHaveBeenCalled();

    const antes = vi.fn<Comprobar>(async () => "esta");
    await prepararCelular({ sesion: async () => SESION, yo: async () => propio("abierta"), comprobar: antes }, true);
    await pasar(50);
    expect(antes).not.toHaveBeenCalled();

    const { mundo } = await conResultado({ gano: true });
    expect(lineaDelSello(mundo.raiz)).toBeNull();
  });

  it("la pide una sola vez por comprobante aunque la sala se consulte otra vez", async () => {
    const comprobar = vi.fn<Comprobar>(async () => "esta");
    const { mundo, resultado } = await conResultado({ gano: true, cambios: { comprobar } });
    await mundo.volver();
    await pasar(50);
    expect(resultado.mock.calls.length).toBeGreaterThan(1);
    expect(comprobar).toHaveBeenCalledTimes(1);
  });
});

describe("quien ganó: la línea aparece sin repintar y el festejo sigue", () => {
  it("suma la línea a la pantalla que ya está, con los mismos elementos y el festejo en pie", async () => {
    const { comprobar, entregar } = pendiente();
    const { mundo } = await conResultado({ gano: true, cambios: { comprobar } });
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    const titulo = estado.querySelector("h1");
    const festejo = estado.querySelector(".cmp-festejo");
    const recibir = estado.querySelector(".primary");
    expect(festejo).not.toBeNull();
    expect(lineaDelSello(mundo.raiz)).toBeNull();

    await entregar("esta");

    expect(lineaDelSello(mundo.raiz)).toBe(es.cpMiSelloEsta);
    expect(estado.querySelector("h1")).toBe(titulo);
    expect(estado.querySelector(".cmp-festejo")).toBe(festejo);
    expect(festejo?.isConnected).toBe(true);
    expect(estado.querySelector(".primary")).toBe(recibir);
    expect(estado.querySelectorAll(".primary")).toHaveLength(1);
  });

  it("la línea va dentro del bloque del resultado, antes del enlace para ver cómo se eligió", async () => {
    const { comprobar, entregar } = pendiente();
    const { mundo } = await conResultado({ gano: true, cambios: { comprobar } });
    await entregar("esta");
    const bloque = mundo.raiz.querySelector("#cmp-estado .cmp-izq") as HTMLElement;
    const hijos = [...bloque.children];
    const linea = hijos.findIndex((h) => h.classList.contains("cmp-sello"));
    const enlace = hijos.findIndex((h) => h.tagName === "A");
    expect(linea).toBeGreaterThan(-1);
    expect(enlace).toBeGreaterThan(linea);
  });

  it("si la pantalla se repinta después (otro idioma), la línea sigue y no se vuelve a comprobar", async () => {
    const comprobar = vi.fn<Comprobar>(async () => "esta");
    const { mundo } = await conResultado({ gano: true, cambios: { comprobar } });
    expect(lineaDelSello(mundo.raiz)).toBe(es.cpMiSelloEsta);
    setLang("en");
    mundo.vista.pintar();
    expect(lineaDelSello(mundo.raiz)).toBe(en.cpMiSelloEsta);
    expect(comprobar).toHaveBeenCalledTimes(1);
  });

  it("una comprobación que llega tarde, de otro comprobante, no se dice", async () => {
    let cambiar = false;
    const entregas: ((r: Respuesta) => void)[] = [];
    const comprobar = vi.fn<Comprobar>(() => new Promise<Respuesta>((resolver) => { entregas.push(resolver); }));
    const { mundo } = await conResultado({
      gano: true,
      cambios: {
        comprobar,
        resultado: async () => ({ sorteo: "7", ganadoras: [CUENTA], comprobante: cambiar ? "/verificar.html#otro" : COMPROBANTE }),
      },
    });
    cambiar = true;
    await mundo.volver();
    await pasar(50);
    entregas[0]?.("esta");
    await pasar(0);
    expect(lineaDelSello(mundo.raiz)).toBeNull();
  });

  it("un comprobante nuevo que llega mientras se comprueba el anterior se comprueba cuando termina aquella", async () => {
    let cambiar = false;
    const entregas: ((r: Respuesta) => void)[] = [];
    const comprobar = vi.fn<Comprobar>(() => new Promise<Respuesta>((resolver) => { entregas.push(resolver); }));
    const { mundo } = await conResultado({
      gano: true,
      cambios: {
        comprobar,
        resultado: async () => ({ sorteo: "7", ganadoras: [CUENTA], comprobante: cambiar ? "/verificar.html#otro" : COMPROBANTE }),
      },
    });
    cambiar = true;
    await mundo.volver();
    await pasar(50);
    // Mientras la primera sigue en vuelo, la segunda no se pide todavía (una a la vez por celular).
    expect(comprobar).toHaveBeenCalledTimes(1);
    entregas[0]?.("esta");
    await pasar(0);
    expect(lineaDelSello(mundo.raiz)).toBeNull();
    expect(comprobar).toHaveBeenCalledTimes(2);
    expect(comprobar.mock.calls[1]?.[0].comprobante).toBe("/verificar.html#otro");
    entregas[1]?.("esta");
    await pasar(0);
    expect(lineaDelSello(mundo.raiz)).toBe(es.cpMiSelloEsta);
  });
});

describe("quien no ganó", () => {
  it("dice que su cuenta está en la lista sellada, sin repintar el resultado", async () => {
    const { comprobar, entregar } = pendiente();
    const { mundo } = await conResultado({ gano: false, cambios: { comprobar } });
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    const titulo = estado.querySelector("h1");
    await entregar("esta");
    expect(lineaDelSello(mundo.raiz)).toBe(es.cpMiSelloEsta);
    expect(estado.querySelector("h1")).toBe(titulo);
    expect(titulo?.textContent).toBe(es.cpOtraPersona);
  });

  it("nunca le dice a nadie que no está: cualquier cosa que no sea esta no se pinta", async () => {
    const { mundo } = await conResultado({ gano: false, cambios: { comprobar: (async () => "no-esta") as unknown as Comprobar } });
    expect(lineaDelSello(mundo.raiz)).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe(es.cpOtraPersona);
    expect(Object.keys(es)).not.toContain("cpMiSelloNo");
    expect(Object.keys(en)).not.toContain("cpMiSelloNo");
  });
});

describe("cuando no se pudo comprobar, la pantalla no dice nada", () => {
  it("con null no hay línea", async () => {
    const { mundo } = await conResultado({ gano: true, cambios: { comprobar: async () => null } });
    expect(lineaDelSello(mundo.raiz)).toBeNull();
  });

  it("si la comprobación falla, la pantalla sigue entera", async () => {
    const { mundo } = await conResultado({
      gano: true,
      cambios: { comprobar: async () => { throw new Error("sin conexión"); } },
    });
    expect(lineaDelSello(mundo.raiz)).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe(es.cpGanaste);
  });
});

describe("los textos", () => {
  it("están en los dos idiomas, sin tecnicismos y sin los signos que el sitio no usa", () => {
    for (const idioma of [es, en]) {
      for (const clave of ["cpMiSelloEsta"] as const) {
        const texto = idioma[clave];
        expect(texto, clave).toBeTruthy();
        expect(texto, clave).not.toMatch(/[;«»"“”—–·!]/u);
        expect(texto, clave).not.toMatch(/blockchain|stellar|hash|firma|token|\bred\b|chain|ledger/iu);
      }
    }
  });
});
