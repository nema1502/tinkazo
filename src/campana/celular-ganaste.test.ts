// @vitest-environment jsdom
/** Ganaste según cómo está la cuenta de este navegador: la línea de cada estado y, con una cuenta usada en otro lado, el enlace. */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../idioma";
import { AHORA, SESION, lectura, lecturasDe, pasar, prepararCelular, propio } from "./celular-falso";
import { TEXTOS_PREMIO } from "./textos-premio";
import { TEXTOS_CAMPANA } from "./textos";
import type { DepsDelCelular } from "./celular";

const ENLACE = "https://tinkazo.app/?red=oficial&premio=1";
const barra = (raiz: HTMLElement): HTMLElement => raiz.querySelector("#cmp-estado .cmp-accion") as HTMLElement;
const principal = (raiz: HTMLElement): string => barra(raiz).querySelector(".primary")?.textContent ?? "";
const linea = (raiz: HTMLElement): string => barra(raiz).querySelector(".cmp-apoyo")?.textContent ?? "";
const deTexto = (raiz: HTMLElement): HTMLButtonElement | null => barra(raiz).querySelector<HTMLButtonElement>(".cmp-de-texto");
const es = TEXTOS_PREMIO.es;

/** La página con la cuenta que ganó y la lectura que se diga. */
async function conGanaste(cambios: Partial<DepsDelCelular>, estado: ReturnType<typeof lectura> | null, conEnlace = true) {
  const mundo = await prepararCelular({
    sesion: async () => SESION,
    yo: async () => ({ ...propio("sorteada"), gano: true }),
    ...(conEnlace ? { enlaceDelPremio: () => ENLACE } : {}),
    ...(estado ? { cuenta: { leer: lecturasDe(estado) } } : {}),
    ...cambios,
  }, true);
  await pasar(50);
  return mundo;
}

beforeAll(async () => {
  // Con el módulo ya bajado, el import() de la página se resuelve enseguida y la prueba no depende de cuánto tarde en transformarse.
  await import("./premio");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("la línea de Ganaste según la cuenta", () => {
  it("sin saber cómo está la cuenta es la de siempre y la principal es Recibir mi premio", async () => {
    const mundo = await conGanaste({}, null);
    expect(linea(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpParaRecibir);
    expect(principal(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpRecibir);
    expect(deTexto(mundo.raiz)).toBeNull();
  });

  it.each([
    ["lista", {}, "cgListo"],
    ["falta", { protegida: true }, "cgListo"],
    ["otro-con-correo", {}, "cgOtro"],
    ["otro-con-desbloqueo", {}, "cgDesbloqueo"],
  ] as const)("con la cuenta %s dice lo que corresponde y Recibir sigue siendo la principal", async (estado, resto, clave) => {
    const mundo = await conGanaste({}, lectura(estado, resto));
    expect(linea(mundo.raiz)).toBe(es[clave]);
    expect(principal(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpRecibir);
    expect(deTexto(mundo.raiz)).toBeNull();
  });

  it("con la cuenta en falta y sin ninguna protección sigue la línea de siempre, que pide abrir el correo", async () => {
    const mundo = await conGanaste({}, lectura("falta", { protegida: false }));
    expect(linea(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpParaRecibir);
  });

  it.each(["naciendo", "no-se-sabe"] as const)("con la cuenta %s sigue la línea de siempre", async (estado) => {
    const mundo = await conGanaste({}, lectura(estado));
    expect(linea(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpParaRecibir);
    expect(principal(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpRecibir);
  });

  it("la línea sale en inglés cuando la página está en inglés", async () => {
    const mundo = await conGanaste({}, lectura("otro-con-correo"));
    setLang("en");
    mundo.vista.pintar();
    expect(linea(mundo.raiz)).toBe(TEXTOS_PREMIO.en.cgOtro);
  });

  it("una lectura que llega con Ganaste ya a la vista cambia la línea sin esperar otra consulta", async () => {
    let llega: (l: ReturnType<typeof lectura>) => void = () => undefined;
    const leer = vi.fn(() => new Promise<ReturnType<typeof lectura>>((resolver) => {
      llega = resolver;
    }));
    const mundo = await conGanaste({ cuenta: { leer } }, null);
    expect(linea(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpParaRecibir);
    llega(lectura("otro-con-correo"));
    await pasar(50);
    expect(linea(mundo.raiz)).toBe(es.cgOtro);
  });
});

describe("con la cuenta usada en otro navegador", () => {
  it("la principal es Mandarme el enlace, Recibir queda de texto y la línea manda al otro navegador", async () => {
    const compartir = vi.fn(async () => undefined);
    const recibir = vi.fn();
    const mundo = await conGanaste({ compartir, recibir }, lectura("sin-forma"));
    expect(principal(mundo.raiz)).toBe(es.cgMandarme);
    expect(linea(mundo.raiz)).toBe(es.cgAlla);
    expect(barra(mundo.raiz).querySelectorAll(".primary")).toHaveLength(1);
    expect(deTexto(mundo.raiz)?.textContent).toBe(TEXTOS_CAMPANA.es.cpRecibir);
    (barra(mundo.raiz).querySelector(".primary") as HTMLButtonElement).click();
    await pasar(10);
    expect(compartir).toHaveBeenCalledWith(ENLACE);
    expect(recibir).not.toHaveBeenCalled();
    (deTexto(mundo.raiz) as HTMLButtonElement).click();
    expect(recibir).toHaveBeenCalledTimes(1);
  });

  it("si la persona cierra el menú de compartir no pasa nada", async () => {
    const escribir = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: escribir } });
    const compartir = vi.fn(async () => {
      throw new DOMException("cerrado", "AbortError");
    });
    const mundo = await conGanaste({ compartir }, lectura("sin-forma"));
    (barra(mundo.raiz).querySelector(".primary") as HTMLButtonElement).click();
    await pasar(10);
    expect(escribir).not.toHaveBeenCalled();
    expect(barra(mundo.raiz).querySelector("[data-cmp-copia]")).toBeNull();
  });

  it("donde no hay menú la principal es Copiar el enlace: lo copia y lo dice", async () => {
    const escribir = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: escribir } });
    const mundo = await conGanaste({}, lectura("sin-forma"));
    expect(principal(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpCopiar);
    (barra(mundo.raiz).querySelector(".primary") as HTMLButtonElement).click();
    await pasar(10);
    expect(escribir).toHaveBeenCalledWith(ENLACE);
    expect(barra(mundo.raiz).querySelector("[data-cmp-copia]")?.textContent).toBe(TEXTOS_CAMPANA.es.cpCopiado);
    expect(barra(mundo.raiz).querySelector("[data-cmp-copia]")?.getAttribute("role")).toBe("status");
  });

  it("sin portapapeles el enlace queda a la vista en un campo de solo lectura", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const mundo = await conGanaste({}, lectura("sin-forma"));
    (barra(mundo.raiz).querySelector(".primary") as HTMLButtonElement).click();
    await pasar(10);
    const campo = barra(mundo.raiz).querySelector<HTMLInputElement>("input[data-cmp-copiar]");
    expect(campo?.value).toBe(ENLACE);
    expect(campo?.readOnly).toBe(true);
  });

  it("sin la dirección de la página (la vista previa) no se ofrece mandar nada: queda Recibir como principal", async () => {
    const mundo = await conGanaste({}, lectura("sin-forma"), false);
    expect(principal(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpRecibir);
    expect(linea(mundo.raiz)).toBe(es.cgAlla);
    expect(deTexto(mundo.raiz)).toBeNull();
  });
});
