// @vitest-environment jsdom
/**
 * Un celular compartido: quien recarga ya anotada vive de lo que su navegador recordaba y no retoma la sesión del proveedor.
 * Si otra persona entró con su cuenta en ese mismo navegador, la página no le atribuye la cuenta de la otra ni la manda a
 * recibir el premio con una sesión que no es la suya.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOPE_DE_RECIBIR_MS } from "./celular";
import { AHORA, CUENTA, OTRA_CUENTA, SESION, asentar, lectura, lecturasDe, pasar as pasarElReloj, prepararCelular, propio } from "./celular-falso";
import { guardarMemoria, leerMemoria } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

// Lo que la página baja con import() llega en unos pocos turnos si ya está cargado.
await import("./recordada");
await import("./premio");

const es = TEXTOS_CAMPANA.es;
const asentarTodo = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  await asentar();
};
const pasar = async (ms: number): Promise<void> => {
  await pasarElReloj(ms);
  await asentarTodo();
};
const preparar = async (cambios: Parameters<typeof prepararCelular>[0] = {}) => {
  const mundo = await prepararCelular(cambios, true);
  await asentarTodo();
  return mundo;
};

/** Un almacén de mentira para la memoria de la campaña (lo que guarda `localStorage`). */
function almacen(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (n) => [...datos.keys()][n] ?? null,
    removeItem: (clave) => void datos.delete(clave),
    setItem: (clave, valor) => void datos.set(clave, valor),
  };
}

const ganoAntes = (memoria: Storage): void =>
  guardarMemoria(memoria, "evento-ejemplo", { cuenta: CUENTA, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });

const recibir = (raiz: HTMLElement): HTMLButtonElement => raiz.querySelector<HTMLButtonElement>("#cmp-estado .primary") as HTMLButtonElement;
const ganaste = (raiz: HTMLElement): string => raiz.querySelector("#cmp-estado h1")?.textContent ?? "";

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
});

describe("Recibir mi premio de quien recargó ya anotada", () => {
  const ganadora = async (laSesionEs: (cuenta: string) => Promise<"si" | "otra" | "no-se-sabe">, cambios: Parameters<typeof prepararCelular>[0] = {}) => {
    const memoria = almacen();
    ganoAntes(memoria);
    const recibirDeLaPagina = vi.fn();
    const sesion = vi.fn(async () => ({ cuenta: OTRA_CUENTA, nombre: "Beto" }));
    // La sala sabe que la cuenta de Ana ganó. Cuando la página compara y dice que ahora es otra, quien entra es Beto: no anotado.
    let esBeto = false;
    const comparar = async (cuenta: string): Promise<"si" | "otra" | "no-se-sabe"> => {
      const quien = await laSesionEs(cuenta);
      if (quien === "otra") esBeto = true;
      return quien;
    };
    const mundo = await preparar({
      memoria,
      sesion,
      recibir: recibirDeLaPagina,
      yo: async () => (esBeto ? { ...propio(), anotada: false } : { ...propio("sorteada"), gano: true }),
      cuenta: { leer: lecturasDe(lectura("lista")), laSesionEs: comparar },
      ...cambios,
    });
    return { mundo, memoria, recibirDeLaPagina, sesion };
  };

  it("si la sesión de este navegador es de otra persona, no la manda a recibir: olvida lo que recordaba y abre para quien entró", async () => {
    const laSesionEs = vi.fn(async () => "otra" as const);
    const { mundo, memoria, recibirDeLaPagina, sesion } = await ganadora(laSesionEs);
    expect(ganaste(mundo.raiz)).toBe(es.cpGanaste);
    expect(sesion).not.toHaveBeenCalled();
    recibir(mundo.raiz).click();
    await pasar(100);
    expect(laSesionEs).toHaveBeenCalledWith(CUENTA);
    expect(recibirDeLaPagina).not.toHaveBeenCalled();
    expect(leerMemoria(memoria, "evento-ejemplo", AHORA)).toBeNull();
    // La página abre como si recién llegara: con la sesión de quien entró ahora, que se anota con lo suyo.
    expect(sesion).toHaveBeenCalledTimes(1);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-estado")?.hidden).toBe(true);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(false);
    expect(mundo.raiz.querySelector("#cmp-hola")?.textContent).toContain("Beto");
  });

  it.each([["si"], ["no-se-sabe"]] as const)("si la comparación dice %s, sigue a recibir con una sola llamada", async (respuesta) => {
    const laSesionEs = vi.fn(async () => respuesta);
    const { mundo, memoria, recibirDeLaPagina } = await ganadora(laSesionEs);
    recibir(mundo.raiz).click();
    await pasar(100);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
    expect(leerMemoria(memoria, "evento-ejemplo", AHORA)).not.toBeNull();
  });

  it("si la comparación falla, sigue a recibir: el sitio lo resuelve con la cuenta que tenga", async () => {
    const laSesionEs = vi.fn(async (): Promise<"si"> => {
      throw new Error("falla");
    });
    const { mundo, recibirDeLaPagina } = await ganadora(laSesionEs);
    recibir(mundo.raiz).click();
    await pasar(100);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
  });

  it("dos toques seguidos no lanzan dos comparaciones", async () => {
    let contestar: (v: "si") => void = () => undefined;
    const laSesionEs = vi.fn(() => new Promise<"si">((resolver) => { contestar = resolver; }));
    const { mundo, recibirDeLaPagina } = await ganadora(laSesionEs);
    recibir(mundo.raiz).click();
    recibir(mundo.raiz).click();
    await pasar(10);
    expect(laSesionEs).toHaveBeenCalledTimes(1);
    contestar("si");
    await pasar(10);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
  });

  it("Recibir queda ocupado desde el toque mientras compara, y no se tocan dos veces", async () => {
    let contestar: (v: "no-se-sabe") => void = () => undefined;
    const laSesionEs = vi.fn(() => new Promise<"no-se-sabe">((resolver) => { contestar = resolver; }));
    const { mundo, recibirDeLaPagina } = await ganadora(laSesionEs);
    const boton = recibir(mundo.raiz);
    boton.click();
    await pasar(10);
    expect(boton.getAttribute("aria-busy")).toBe("true");
    expect(boton.disabled).toBe(true);
    expect(recibirDeLaPagina).not.toHaveBeenCalled();
    contestar("no-se-sabe");
    await pasar(10);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
    expect(boton.hasAttribute("aria-busy")).toBe(false);
  });

  it("si la comparación no contesta nunca, Recibir no queda muerto: sigue a recibir pasado su tope", async () => {
    const laSesionEs = vi.fn(() => new Promise<"si">(() => undefined));
    const { mundo, recibirDeLaPagina } = await ganadora(laSesionEs);
    recibir(mundo.raiz).click();
    await pasar(TOPE_DE_RECIBIR_MS - 100);
    expect(recibirDeLaPagina).not.toHaveBeenCalled();
    await pasar(200);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
    // La bandera se soltó: otro toque vuelve a funcionar.
    recibir(mundo.raiz).click();
    await pasar(TOPE_DE_RECIBIR_MS + 100);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(2);
  });

  it("quien llegó con la sesión de la página no compara nada: ya es de su cuenta", async () => {
    const laSesionEs = vi.fn(async () => "otra" as const);
    const recibirDeLaPagina = vi.fn();
    const mundo = await preparar({
      sesion: async () => SESION,
      recibir: recibirDeLaPagina,
      yo: async () => ({ ...propio("sorteada"), gano: true }),
      cuenta: { leer: lecturasDe(lectura("lista")), laSesionEs },
    });
    expect(ganaste(mundo.raiz)).toBe(es.cpGanaste);
    recibir(mundo.raiz).click();
    await pasar(50);
    expect(laSesionEs).not.toHaveBeenCalled();
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
  });

  it("sin cómo comparar (la demostración) Recibir sigue de largo", async () => {
    const memoria = almacen();
    ganoAntes(memoria);
    const recibirDeLaPagina = vi.fn();
    const mundo = await preparar({ memoria, recibir: recibirDeLaPagina, yo: async () => ({ ...propio("sorteada"), gano: true }) });
    recibir(mundo.raiz).click();
    await pasar(50);
    expect(recibirDeLaPagina).toHaveBeenCalledTimes(1);
  });
});

describe("la lectura de la cuenta de la página", () => {
  it("lleva la cuenta de la página, para que una sesión de otra persona no se le atribuya", async () => {
    const leer = lecturasDe(lectura("lista"));
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    expect(leer).toHaveBeenCalledWith(CUENTA);
  });
});
