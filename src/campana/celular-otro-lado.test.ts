// @vitest-environment jsdom
/** El aviso de una cuenta usada en otro navegador: cuándo aparece, cuándo cambia el botón y cuándo no se repite. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import { AHORA, CUENTA, OTRA_CUENTA, SESION, asentar, lectura, lecturasDe, pasar, prepararCelular, propio, tocar } from "./celular-falso";
import { GUARDA_DE_TOQUE_MS, QUIETUD_PARA_CAMBIAR_MS } from "./guarda";
import { TEXTOS_CAMPANA } from "./textos";

const principal = (raiz: HTMLElement): string => raiz.querySelector("#cmp-hola .primary")?.textContent ?? "";
const hayAviso = (raiz: HTMLElement): boolean => raiz.querySelector("#cmp-hola .cmp-otro-lado") !== null;
const apoyoDeAdentro = (raiz: HTMLElement): string => raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent ?? "";
const preparar = (cambios: Parameters<typeof prepararCelular>[0] = {}) => prepararCelular(cambios, true);

/** Una lectura que se resuelve cuando la prueba dice: así se elige el momento exacto en que llega. */
function lecturaPendiente(): { leer: () => Promise<LecturaDelCelular>; llega: (l: LecturaDelCelular) => void } {
  let llega: (l: LecturaDelCelular) => void = () => undefined;
  const leer = vi.fn(() => new Promise<LecturaDelCelular>((resolver) => {
    llega = resolver;
  }));
  return { leer, llega: (l) => llega(l) };
}

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

describe("cuándo aparece el aviso en Hola", () => {
  it("Hola sale al instante con Acepto y el aviso entra cuando llega la lectura", async () => {
    const { leer, llega } = lecturaPendiente();
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer } });
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
    expect(hayAviso(mundo.raiz)).toBe(false);
    llega(lectura("sin-forma"));
    await asentar();
    expect(hayAviso(mundo.raiz)).toBe(true);
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-otro-lado")?.getAttribute("role")).toBe("status");
  });

  it("si nadie tocó la pantalla, el botón principal pasa enseguida a Usar otra cuenta", async () => {
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) } });
    expect(hayAviso(mundo.raiz)).toBe(true);
    expect(principal(mundo.raiz)).toBe("Usar otra cuenta");
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-anotarme-igual")?.textContent).toBe(TEXTOS_CAMPANA.es.cpAnotarmeIgual);
  });

  it("una lectura que llega un segundo después de un toque no mueve el botón hasta que haya quietud", async () => {
    const { leer, llega } = lecturaPendiente();
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer } });
    tocar(mundo.raiz);
    await pasar(1_000);
    llega(lectura("sin-forma"));
    await asentar();
    // El aviso se ve, pero el botón sigue siendo el mismo bajo el dedo.
    expect(hayAviso(mundo.raiz)).toBe(true);
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
    await pasar(QUIETUD_PARA_CAMBIAR_MS - 1_000 - 1);
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
    await pasar(1);
    expect(principal(mundo.raiz)).toBe("Usar otra cuenta");
  });

  it("otro toque mientras espera atrasa el cambio hasta que haya 1,5 segundos de quietud", async () => {
    const { leer, llega } = lecturaPendiente();
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer } });
    tocar(mundo.raiz);
    llega(lectura("sin-forma"));
    await pasar(1_200);
    tocar(mundo.raiz);
    await pasar(QUIETUD_PARA_CAMBIAR_MS - 1);
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
    await pasar(1);
    expect(principal(mundo.raiz)).toBe("Usar otra cuenta");
  });

  it("un toque a menos de 500 ms del cambio no cuenta, y a los 500 ms sí", async () => {
    const salir = vi.fn(async () => undefined);
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) }, salir });
    const usarOtra = (): HTMLButtonElement => mundo.raiz.querySelector("#cmp-hola .primary") as HTMLButtonElement;
    await pasar(GUARDA_DE_TOQUE_MS - 100);
    usarOtra().click();
    await asentar();
    expect(salir).not.toHaveBeenCalled();
    expect(principal(mundo.raiz)).toBe("Usar otra cuenta");
    await pasar(100);
    usarOtra().click();
    await asentar();
    expect(salir).toHaveBeenCalledTimes(1);
  });

  it("el mismo toque guardado vale para Acepto y me anoto igual", async () => {
    const anotar = vi.fn(async () => ({ ok: true as const, ya: false }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) }, anotar });
    const igual = (): HTMLButtonElement => mundo.raiz.querySelector("#cmp-hola .cmp-anotarme-igual") as HTMLButtonElement;
    igual().click();
    await asentar();
    expect(anotar).not.toHaveBeenCalled();
    await pasar(GUARDA_DE_TOQUE_MS);
    igual().click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
  });

  it.each(["lista", "falta", "otro-con-correo", "otro-con-desbloqueo", "naciendo", "no-se-sabe"] as const)("con la cuenta %s no hay aviso", async (dicho) => {
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura(dicho)) } });
    expect(hayAviso(mundo.raiz)).toBe(false);
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
  });

  it("sin la lectura en las dependencias no hay aviso", async () => {
    const mundo = await preparar({ sesion: async () => SESION });
    expect(hayAviso(mundo.raiz)).toBe(false);
  });

  it("una cuenta naciendo que después resulta sin forma recién avisa cuando lo sabe", async () => {
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("naciendo"), lectura("sin-forma")) } });
    expect(hayAviso(mundo.raiz)).toBe(false);
    await pasar(5_000);
    expect(hayAviso(mundo.raiz)).toBe(true);
  });
});

describe("qué pasa con Acepto, anotada y la misma cuenta", () => {
  it("Acepto con el aviso a la vista sigue la alta y el aviso pasa a la línea de la espera", async () => {
    const { leer, llega } = lecturaPendiente();
    const anotar = vi.fn(async () => ({ ok: true as const, ya: false }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer }, anotar });
    tocar(mundo.raiz);
    llega(lectura("sin-forma"));
    await asentar();
    // El botón todavía no cambió: el dedo que va a Acepto anota, como siempre.
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
    (mundo.raiz.querySelector("#cmp-hola .primary") as HTMLButtonElement).click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(mundo.raiz.querySelector("#cmp-adentro h1")?.textContent).toBe(TEXTOS_CAMPANA.es.cpAdentro);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
  });

  it("una lectura que llega con Anotando en marcha no corta la alta ni pinta el aviso en Hola", async () => {
    const { leer, llega } = lecturaPendiente();
    let terminar: (r: { ok: true; ya: boolean }) => void = () => undefined;
    const anotar = vi.fn(() => new Promise<{ ok: true; ya: boolean }>((resolver) => {
      terminar = resolver;
    }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer }, anotar });
    (mundo.raiz.querySelector("#cmp-hola .primary") as HTMLButtonElement).click();
    await asentar();
    llega(lectura("sin-forma"));
    await asentar();
    expect(hayAviso(mundo.raiz)).toBe(false);
    expect(mundo.raiz.querySelector("#cmp-hola .primary")?.textContent).toBe("Anotando…");
    terminar({ ok: true, ya: false });
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
  });

  it("Acepto y me anoto igual anota, lo recuerda en la pestaña y la espera lleva la línea del otro navegador", async () => {
    const anotar = vi.fn(async () => ({ ok: true as const, ya: false }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) }, anotar });
    await pasar(GUARDA_DE_TOQUE_MS);
    (mundo.raiz.querySelector("#cmp-hola .cmp-anotarme-igual") as HTMLButtonElement).click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`tinkazo.cmp.otrolado.${mundo.deps.sala}`)).toBe(CUENTA);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
  });

  it("después de anotada no se ofrece cambiar de cuenta: la espera no tiene botón", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("sin-forma")) } });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
    expect(mundo.raiz.querySelector("#cmp-adentro button")).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-hola")?.hasAttribute("hidden")).toBe(true);
  });

  it("anotada por otra vía, la lectura que llega después cambia la línea sin repintar de más", async () => {
    const { leer, llega } = lecturaPendiente();
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer } });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
    llega(lectura("sin-forma"));
    await asentar();
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
  });

  it("Usar otra cuenta cierra la sesión, y si Google vuelve a entrar la misma, Hola sale sin aviso", async () => {
    const salir = vi.fn(async () => undefined);
    const anotar = vi.fn(async () => ({ ok: true as const, ya: false }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) }, salir, anotar });
    await pasar(GUARDA_DE_TOQUE_MS);
    (mundo.raiz.querySelector("#cmp-hola .primary") as HTMLButtonElement).click();
    await asentar();
    expect(salir).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`tinkazo.cmp.otrolado.${mundo.deps.sala}`)).toBe(CUENTA);
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    await pasar(1_000);
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Ana P.");
    expect(hayAviso(mundo.raiz)).toBe(false);
    expect(principal(mundo.raiz)).toBe("Acepto y me anoto");
    // Y anotarse igual la deja pasar a la espera con la línea del otro navegador.
    (mundo.raiz.querySelector("#cmp-hola .primary") as HTMLButtonElement).click();
    await asentar();
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
  });

  it("si Google entra con otra cuenta sin forma, el aviso vuelve a aparecer para ella", async () => {
    const entrar = vi.fn(async () => ({ cuenta: OTRA_CUENTA, nombre: "Luis R." }));
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) }, entrar });
    await pasar(GUARDA_DE_TOQUE_MS);
    (mundo.raiz.querySelector("#cmp-hola .primary") as HTMLButtonElement).click();
    await asentar();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    await pasar(1_000);
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Luis R.");
    expect(hayAviso(mundo.raiz)).toBe(true);
  });

  it("sin almacenamiento de la pestaña, el aviso sigue funcionando", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("sin-forma")) } });
    expect(hayAviso(mundo.raiz)).toBe(true);
  });

  it("al desmontar se apaga el reloj de la quietud", async () => {
    // jsdom avisa cada escritura en el almacenamiento con un temporizador propio: no es de la página y no cuenta acá.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
    const { leer, llega } = lecturaPendiente();
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer } });
    tocar(mundo.raiz);
    llega(lectura("sin-forma"));
    await asentar();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    mundo.vista.desmontar();
    expect(vi.getTimerCount()).toBe(0);
  });
});
