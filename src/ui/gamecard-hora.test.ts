// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La tarjeta de cómo se juega con la hora fija del ancla (`gamecard.ts`): la sala que va con horario termina su tarjeta
 * a la hora que le da el número que llegó (`arranque-del-show.ts`), con la cuenta de 3, 2, 1 justo antes. Si abrió con
 * poca lectura por delante, o el resultado llegó tarde, lee y cuenta como siempre.
 */

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  document.body.innerHTML = `<div id="stadium" style="display:none"></div>`;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** A la hora, con 2 ms de margen: un temporizador de cero dispara en el paso siguiente del reloj de prueba. */
const aLaHora = (real: number | undefined, esperada: number): void => {
  expect(real).toBeDefined();
  expect(Math.abs((real ?? 0) - esperada)).toBeLessThanOrEqual(2);
};

async function abrir(cuenta: number, espera: Promise<unknown>) {
  const { showGameCard } = await import("./gamecard");
  const numeros: { n: number; en: number }[] = [];
  const card = showGameCard("race", 8, 1, cuenta, (n) => numeros.push({ n, en: performance.now() }), "", espera);
  let listaEn = -1;
  void card.ready.then(() => (listaEn = performance.now()));
  return { card, numeros, lista: () => listaEn };
}

describe("la tarjeta con hora fija", () => {
  it("termina a la hora fijada, con la cuenta justo antes, aunque el resultado llegue enseguida", async () => {
    const t0 = performance.now();
    let resolver: (v: unknown) => void = () => undefined;
    const { numeros, lista } = await abrir(3, new Promise((r) => (resolver = r)));
    // La tarjeta abre 2 s antes del número; el número llega a los 2,1 s y el juego va a los 6,5 s de abrir.
    await vi.advanceTimersByTimeAsync(2_100);
    resolver({ terminaEn: t0 + 6_500 });
    await vi.advanceTimersByTimeAsync(5_000);
    aLaHora(lista(), t0 + 6_500);
    expect(numeros.map((x) => x.n)).toEqual([3, 2, 1]);
    aLaHora(numeros[0]?.en, t0 + 3_500);
  });

  it("si la hora deja más lectura, la lectura dura hasta la cuenta", async () => {
    const t0 = performance.now();
    const { lista, numeros } = await abrir(3, Promise.resolve({ terminaEn: t0 + 8_000 }));
    await vi.advanceTimersByTimeAsync(9_000);
    aLaHora(numeros[0]?.en, t0 + 5_000);
    aLaHora(lista(), t0 + 8_000);
  });

  it("sin cuenta (Rápido) termina a la hora fijada", async () => {
    const t0 = performance.now();
    const { lista } = await abrir(0, Promise.resolve({ terminaEn: t0 + 3_600 }));
    await vi.advanceTimersByTimeAsync(5_000);
    aLaHora(lista(), t0 + 3_600);
  });

  it("con menos de 1,5 s de lectura por delante lee y cuenta como siempre: esa sala ya es tardía", async () => {
    const t0 = performance.now();
    const { lista } = await abrir(3, Promise.resolve({ terminaEn: t0 + 4_000 }));
    await vi.advanceTimersByTimeAsync(8_000);
    aLaHora(lista(), t0 + 6_500);
  });

  it("si el resultado llega después de cuando tenía que empezar la cuenta, cuenta entera desde que llega", async () => {
    const t0 = performance.now();
    let resolver: (v: unknown) => void = () => undefined;
    const { lista, numeros } = await abrir(3, new Promise((r) => (resolver = r)));
    await vi.advanceTimersByTimeAsync(4_000);
    resolver({ terminaEn: t0 + 6_500 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(numeros.map((x) => x.n)).toEqual([3, 2, 1]);
    aLaHora(lista(), t0 + 7_000);
  });

  it("sin hora (el celular de antes, el botón) lee 3,5 s y cuenta 3 desde que hay resultado", async () => {
    const t0 = performance.now();
    const { lista } = await abrir(3, Promise.resolve(undefined));
    await vi.advanceTimersByTimeAsync(8_000);
    aLaHora(lista(), t0 + 6_500);
  });
});
