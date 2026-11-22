// @vitest-environment jsdom
/**
 * La marca de correo confirmado en la consulta propia: cuándo sale (una vez por carga y enseguida después de confirmar, solo si
 * el correo de la sesión está confirmado) y que apagada no manda nada nuevo ni consulta de más.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import type { AccionesDeLaCuenta, DepsDelCelular, EstadoPropio } from "./celular";
import { AHORA, SESION, asentar, lectura, lecturasDe, pasar, prepararCelular, propio } from "./celular-falso";

// La tarjeta se baja con import(): con el módulo ya cargado, la espera de la prueba son unos pocos turnos.
await import("./confirmar");

const FALTA = lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" });
const LISTA = lectura("lista", { protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true });
/** Una cuenta protegida (con el desbloqueo, por ejemplo) pero cuyo correo no es el confirmado de la sesión. */
const LISTA_SIN_CORREO = lectura("lista", { protegida: true, correoDeLaSesionConfirmado: false, puedeMandar: true });

const asentarTodo = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  await asentar();
};

async function montar(cambios: Partial<DepsDelCelular>) {
  const yo = vi.fn(async (_conMarca?: boolean): Promise<EstadoPropio | "red" | "terminada"> => propio());
  const mundo = await prepararCelular({ sesion: async () => SESION, yo, ...cambios }, true);
  await asentarTodo();
  return { mundo, yo };
}

/** Los argumentos con que se llamó a yo, llamada por llamada: [] es la consulta de siempre y [true] la que lleva la marca. */
const llamadas = (yo: ReturnType<typeof vi.fn>): unknown[][] => yo.mock.calls;

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

describe("con la marca apagada", () => {
  it("la consulta propia es siempre la de siempre, aunque el correo esté confirmado", async () => {
    const { mundo, yo } = await montar({ cuenta: { leer: lecturasDe(LISTA) } });
    await mundo.disparar(15_000);
    await mundo.disparar(15_000);
    expect(llamadas(yo).length).toBeGreaterThanOrEqual(3);
    expect(llamadas(yo).every((a) => a.length === 0)).toBe(true);
  });

  it("confirmar el correo no dispara ninguna consulta de más", async () => {
    const acciones = accionesFalsas();
    const { mundo, yo } = await montar({ cuenta: { leer: lecturasDe(FALTA), confirmar: async () => acciones } });
    await pasar(3_000);
    const antes = llamadas(yo).length;
    await confirmarPorLaTarjeta(mundo.raiz);
    expect(acciones.confirmarCodigo).toHaveBeenCalledTimes(1);
    expect(llamadas(yo)).toHaveLength(antes);
  });
});

describe("con la marca encendida", () => {
  it("con el correo de la sesión confirmado, la lleva en la primera consulta que sigue a la lectura y no en las demás", async () => {
    const { mundo, yo } = await montar({ marcaDeCorreo: true, cuenta: { leer: lecturasDe(LISTA) } });
    // La primera consulta de la página sale antes de que se sepa cómo está la cuenta: va sin marca.
    expect(llamadas(yo)[0]).toEqual([]);
    await mundo.disparar(15_000);
    expect(llamadas(yo).at(-1)).toEqual([true]);
    await mundo.disparar(15_000);
    await mundo.disparar(15_000);
    expect(llamadas(yo).filter((a) => a[0] === true)).toHaveLength(1);
    expect(llamadas(yo).slice(-2).every((a) => a.length === 0)).toBe(true);
  });

  it("con el correo sin confirmar, o confirmado pero distinto al de la sesión, nunca la lleva", async () => {
    for (const dicho of [FALTA, LISTA_SIN_CORREO, lectura("otro-con-correo"), lectura("sin-forma"), lectura("naciendo")]) {
      const { mundo, yo } = await montar({ marcaDeCorreo: true, cuenta: { leer: lecturasDe(dicho) } });
      await mundo.disparar(15_000);
      await mundo.disparar(15_000);
      expect(llamadas(yo).some((a) => a[0] === true), dicho.estado).toBe(false);
      mundo.vista.desmontar();
    }
  });

  it("sin la lectura de la cuenta nunca la lleva", async () => {
    const { mundo, yo } = await montar({ marcaDeCorreo: true });
    await mundo.disparar(15_000);
    expect(llamadas(yo).some((a) => a[0] === true)).toBe(false);
  });

  it("recién confirmado el correo, la marca sale enseguida, una sola vez", async () => {
    const acciones = accionesFalsas();
    const { mundo, yo } = await montar({ marcaDeCorreo: true, cuenta: { leer: lecturasDe(FALTA), confirmar: async () => acciones } });
    await pasar(3_000);
    expect(llamadas(yo).some((a) => a[0] === true)).toBe(false);
    await confirmarPorLaTarjeta(mundo.raiz);
    expect(llamadas(yo).filter((a) => a[0] === true)).toHaveLength(1);
    await mundo.disparar(15_000);
    await mundo.disparar(15_000);
    expect(llamadas(yo).filter((a) => a[0] === true)).toHaveLength(1);
  });

  it("si la consulta con la marca no llega, se vuelve a intentar en la siguiente", async () => {
    let n = 0;
    const yo = vi.fn(async (conMarca?: boolean): Promise<EstadoPropio | "red" | "terminada"> => (conMarca === true && ++n < 3 ? "red" : propio()));
    const mundo = await prepararCelular({ sesion: async () => SESION, yo, marcaDeCorreo: true, cuenta: { leer: lecturasDe(LISTA) } }, true);
    await asentarTodo();
    await mundo.disparar(15_000);
    await mundo.disparar(15_000);
    await mundo.disparar(15_000);
    await mundo.disparar(15_000);
    expect(yo.mock.calls.filter((a) => a[0] === true)).toHaveLength(3);
  });
});

/* ------------------------------------------------ ayudas para confirmar por la tarjeta */

function accionesFalsas(): { [K in keyof AccionesDeLaCuenta]: ReturnType<typeof vi.fn> } & AccionesDeLaCuenta {
  return {
    puedeDesbloqueo: vi.fn(async () => false),
    mandarCodigo: vi.fn(async () => undefined),
    confirmarCodigo: vi.fn(async (): Promise<LecturaDelCelular> => LISTA),
    usarDesbloqueo: vi.fn(async () => true),
    alCambiar: vi.fn(() => () => undefined),
  } as never;
}

/** Del enlace Confirmar mi correo al correo confirmado: manda el código, lo escribe y lo confirma. */
async function confirmarPorLaTarjeta(raiz: HTMLElement): Promise<void> {
  raiz.querySelector<HTMLButtonElement>("#cmp-cuenta .primary")?.click();
  await pasar(100);
  const campo = raiz.querySelector<HTMLInputElement>("#cmp-cuenta input") as HTMLInputElement;
  campo.value = "ABCD1234E";
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  raiz.querySelector<HTMLButtonElement>("#cmp-cuenta .primary")?.click();
  await pasar(100);
}
