// @vitest-environment jsdom
/** Los estados nuevos de la demostración: Ganaste según la cuenta y el límite del servicio de cuentas. Sin red ni Google. */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, texto } from "../idioma";
import { AHORA, pasar, prepararCelular } from "./celular-falso";
import { depsDeDemostracion } from "./demostracion";
import { campanaDeEjemplo } from "./ejemplo";
import { TEXTOS_LIMITE } from "./limite";
import { TEXTOS_PREMIO } from "./textos-premio";

const base = {
  tx: texto,
  idioma: getLang,
  enApp: false,
  ahora: () => Date.now(),
  cada: ((f: () => void, ms: number) => {
    const reloj = setInterval(f, ms);
    return () => clearInterval(reloj);
  }) as never,
  visible: () => true,
  alVolver: () => () => undefined,
  vibrar: () => undefined,
  movimientoReducido: () => false,
};
const demo = (estado: string) => depsDeDemostracion(base, campanaDeEjemplo(AHORA), estado);
const barra = (raiz: HTMLElement): HTMLElement => raiz.querySelector("#cmp-estado .cmp-accion") as HTMLElement;

beforeAll(async () => {
  await import("./premio");
  await import("./limite");
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
});

describe("Ganaste según la cuenta, en la demostración", () => {
  it.each([
    ["ganaste-listo", TEXTOS_PREMIO.es.cgListo, "Recibir mi premio"],
    ["ganaste-otro", TEXTOS_PREMIO.es.cgOtro, "Recibir mi premio"],
    ["ganaste-desbloqueo", TEXTOS_PREMIO.es.cgDesbloqueo, "Recibir mi premio"],
    ["ganaste-sinforma", TEXTOS_PREMIO.es.cgAlla, "Copiar el enlace"],
  ])("%s dice su línea y su principal", async (estado, linea, principal) => {
    const mundo = await prepararCelular(demo(estado), true);
    await pasar(3_000);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    expect(barra(mundo.raiz).querySelector(".cmp-apoyo")?.textContent).toBe(linea);
    expect(barra(mundo.raiz).querySelector(".primary")?.textContent).toBe(principal);
    expect(barra(mundo.raiz).querySelectorAll(".primary")).toHaveLength(1);
  });

  it("ganaste, el de siempre, no cambia", async () => {
    const mundo = await prepararCelular(demo("ganaste"), true);
    await pasar(3_000);
    expect(barra(mundo.raiz).querySelector(".cmp-apoyo")?.textContent).toContain("Vas a necesitar abrir tu correo");
  });
});

describe("el límite del servicio de cuentas, en la demostración", () => {
  it("entrar se rechaza con el límite y 20 segundos, y la pantalla lo dice", async () => {
    const deps = demo("limite");
    const rechazo = deps.entrar().then(() => null, (e: unknown) => e as Error & { segundos?: number });
    await pasar(600);
    const error = await rechazo;
    expect(error?.message).toBe("limite");
    expect(error?.segundos).toBe(20);

    const mundo = await prepararCelular(demo("limite"), true);
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    await pasar(1_000);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-error")?.textContent).toMatch(/^Hay mucha gente entrando\. Probá en \d+ segundos\.$/u);
    expect(TEXTOS_LIMITE.es.lmEspera).toContain("{n}");
  });
});
