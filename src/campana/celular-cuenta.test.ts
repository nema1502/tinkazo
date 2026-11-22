// @vitest-environment jsdom
/** La lectura liviana de la cuenta en la página del celular: cuándo sale, cuándo se repite y qué cambia en la espera. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import { AHORA, SESION, asentar, lectura, lecturasDe, pasar, prepararCelular as preparar, propio } from "./celular-falso";
import { TEXTOS_CAMPANA } from "./textos";

const apoyoDeAdentro = (raiz: HTMLElement): string => raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("cuándo sale la lectura de la cuenta", () => {
  it("sin la lectura en las dependencias la página queda como estaba", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio() });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
  });

  it("arranca apenas hay sesión y Hola no la espera", async () => {
    const leer = vi.fn(() => new Promise<LecturaDelCelular>(() => undefined));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer } });
    expect(leer).toHaveBeenCalledTimes(1);
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Ana P.");
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(false);
  });

  it("sin sesión no lee nada", async () => {
    const leer = lecturasDe(lectura("lista"));
    await preparar({ sesion: async () => null, cuenta: { leer } });
    expect(leer).not.toHaveBeenCalled();
  });

  it("al entrar con Google desde el toque, lee una vez", async () => {
    const leer = lecturasDe(lectura("lista"));
    const mundo = await preparar({ cuenta: { leer } });
    expect(leer).not.toHaveBeenCalled();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    await pasar(1_000);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("la lectura que tarda no frena la alta", async () => {
    const leer = vi.fn(() => new Promise<LecturaDelCelular>(() => undefined));
    const anotar = vi.fn(async () => ({ ok: true as const, ya: false }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer }, anotar });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(mundo.raiz.querySelector("#cmp-adentro h1")?.textContent).toBe(TEXTOS_CAMPANA.es.cpAdentro);
  });

  it("una lectura que falla no corta nada y la página sigue", async () => {
    const leer = vi.fn(async (): Promise<LecturaDelCelular> => {
      throw new Error("sin red");
    });
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
  });
});

describe("qué dice la espera según la cuenta", () => {
  it.each(["lista", "otro-con-correo", "otro-con-desbloqueo"] as const)("con la cuenta %s dice la línea libre y no vuelve a leer", async (dicho) => {
    const leer = lecturasDe(lectura(dicho));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbiertaLibre);
    await pasar(10 * 60_000);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("con la cuenta falta no vuelve a leer y la línea sigue pidiendo este navegador", async () => {
    const leer = lecturasDe(lectura("falta"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
    await pasar(10 * 60_000);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("naciendo pasa a lista y la línea cambia sin tocar el resto de la espera", async () => {
    const leer = lecturasDe(lectura("naciendo"), lectura("lista"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    const seccion = mundo.raiz.querySelector("#cmp-adentro") as HTMLElement;
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
    await pasar(5_000);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbiertaLibre);
    expect(mundo.raiz.querySelector("#cmp-adentro")).toBe(seccion);
    await pasar(60_000);
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("una respuesta de la sala con la misma línea no recrea la espera", async () => {
    const leer = lecturasDe(lectura("lista"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    const titulo = mundo.raiz.querySelector("#cmp-adentro h1");
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-adentro h1")).toBe(titulo);
  });

  it("la lectura que llega con la espera a la vista la repinta una sola vez", async () => {
    let llega: (l: LecturaDelCelular) => void = () => undefined;
    const leer = vi.fn(() => new Promise<LecturaDelCelular>((resolver) => {
      llega = resolver;
    }));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    const titulo = mundo.raiz.querySelector("#cmp-adentro h1");
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
    llega(lectura("lista"));
    await asentar();
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbiertaLibre);
    expect(mundo.raiz.querySelector("#cmp-adentro h1")).not.toBe(titulo);
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-salta")).toBeNull();
  });
});

describe("la agenda de lecturas", () => {
  it("naciendo vuelve a leer a los 5, 10, 20 y 40 segundos y después cada 60", async () => {
    const leer = lecturasDe(lectura("naciendo"));
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    for (const esperado of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
      const antes = leer.mock.calls.length;
      await pasar(esperado - 1);
      expect(leer.mock.calls.length, `antes de ${esperado}`).toBe(antes);
      await pasar(1);
      expect(leer.mock.calls.length, `a los ${esperado}`).toBe(antes + 1);
    }
  });

  it("como mucho 12 veces más, y se queda sin saber", async () => {
    const leer = lecturasDe(lectura("no-se-sabe"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    await pasar(60 * 60_000);
    expect(leer).toHaveBeenCalledTimes(13);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
  });

  it("con la pestaña escondida no lee, y al volver lee una vez", async () => {
    const leer = lecturasDe(lectura("naciendo"), lectura("lista"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    mundo.ponerVisible(false);
    await pasar(5 * 60_000);
    expect(leer).toHaveBeenCalledTimes(1);
    mundo.ponerVisible(true);
    await mundo.volver();
    expect(leer).toHaveBeenCalledTimes(2);
    await mundo.volver();
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("si el servicio frenó el pedido por límite espera 30 segundos antes de probar otra vez", async () => {
    const leer = lecturasDe(lectura("no-se-sabe", { limite: true }), lectura("lista"));
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    await pasar(29_999);
    expect(leer).toHaveBeenCalledTimes(1);
    await pasar(1);
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("al llegar a Ganaste sin saber cómo está la cuenta lee una vez más", async () => {
    const leer = lecturasDe(...Array.from({ length: 13 }, () => lectura("no-se-sabe")), lectura("lista"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    await pasar(60 * 60_000);
    expect(leer).toHaveBeenCalledTimes(13);
    mundo.deps.yo = async () => ({ ...propio("sorteada"), gano: true });
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe(TEXTOS_CAMPANA.es.cpGanaste);
    expect(leer).toHaveBeenCalledTimes(14);
  });

  it("al llegar a Ganaste sabiendo cómo está la cuenta no vuelve a leer", async () => {
    const leer = lecturasDe(lectura("lista"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    mundo.deps.yo = async () => ({ ...propio("sorteada"), gano: true });
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe(TEXTOS_CAMPANA.es.cpGanaste);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("cambiar de cuenta empieza de nuevo y una lectura tardía de la anterior no cuenta", async () => {
    let llega: (l: LecturaDelCelular) => void = () => undefined;
    const leer = vi.fn()
      .mockImplementationOnce(() => new Promise<LecturaDelCelular>((resolver) => {
        llega = resolver;
      }))
      .mockImplementation(async () => lectura("lista"));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer } });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-otra-cuenta")?.click();
    await asentar();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    await pasar(1_000);
    expect(leer).toHaveBeenCalledTimes(2);
    llega(lectura("sin-forma"));
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Ana P.");
  });

  it("al desmontar los relojes de la lectura se apagan", async () => {
    const leer = lecturasDe(lectura("naciendo"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    mundo.vista.desmontar();
    const llamadas = leer.mock.calls.length;
    await pasar(10 * 60_000);
    expect(leer.mock.calls.length).toBe(llamadas);
  });
});
