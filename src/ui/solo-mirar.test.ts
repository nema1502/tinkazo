// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSoloMirar } from "../solo-mirar";
import { CARD_SECONDS, showGameCard } from "./gamecard";
import { registerSkip, skipGame } from "../games/overlay";

/**
 * En la vista de espectador el show se mira entero (`solo-mirar.ts`): con el Saltar del estadio o el de la tarjeta, el
 * celular veía quién gana antes que la sala. Fuera de esa vista, todo se salta como siempre.
 */

afterEach(() => {
  setSoloMirar(false);
  registerSkip(null);
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("la vista de espectador no salta el show", () => {
  it("el Saltar del estadio no hace nada, y fuera de la vista salta como siempre", () => {
    const saltar = vi.fn();
    registerSkip(saltar);
    setSoloMirar(true);
    skipGame();
    expect(saltar).not.toHaveBeenCalled();
    setSoloMirar(false);
    skipGame();
    expect(saltar).toHaveBeenCalledTimes(1);
  });

  it("la tarjeta sale sin Saltar, y ni un toque ni Enter ni Escape la adelantan", async () => {
    vi.useFakeTimers();
    setSoloMirar(true);
    const card = showGameCard("race", 6, 1, 3);
    let lista = false;
    void card.ready.then(() => (lista = true));
    const el = document.querySelector<HTMLElement>(".game-card");
    expect(el?.querySelector(".gc-saltar")).toBeNull();
    el?.click();
    for (const key of ["Enter", " ", "Escape"]) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lista).toBe(false);
    await vi.advanceTimersByTimeAsync((CARD_SECONDS + 3) * 1000);
    expect(lista).toBe(true);
    card.hide();
  });

  it("mientras se graba tampoco: un toque no la deja largar sin la cuenta apenas queda grabado", async () => {
    vi.useFakeTimers();
    setSoloMirar(true);
    let grabar: () => void = () => undefined;
    const card = showGameCard("race", 6, 1, 3, undefined, "", new Promise<void>((r) => (grabar = r)));
    let lista = false;
    void card.ready.then(() => (lista = true));
    document.querySelector<HTMLElement>(".game-card")?.click();
    await vi.advanceTimersByTimeAsync(CARD_SECONDS * 1000 + 500);
    grabar();
    await vi.advanceTimersByTimeAsync(500);
    // La cuenta de 3 s corre igual, como en la sala.
    expect(lista).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lista).toBe(true);
    card.hide();
  });

  it("fuera de la vista de espectador la tarjeta se salta como siempre", async () => {
    vi.useFakeTimers();
    const card = showGameCard("race", 6, 1, 3);
    let lista = false;
    void card.ready.then(() => (lista = true));
    document.querySelector<HTMLElement>(".gc-saltar")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(lista).toBe(true);
    card.hide();
  });
});
