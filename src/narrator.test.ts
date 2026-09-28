import { afterEach, describe, expect, it, vi } from "vitest";
import { forSpeech, narrate, primeNarrator, shortVoiceName, stopNarrator } from "./narrator";

describe("el relator", () => {
  it("dice en minúsculas lo que la pantalla grita en mayúsculas", () => {
    expect(forSpeech("¡QUEDAN DOS!")).toBe("¡quedan dos!");
    expect(forSpeech("¡SE SUELTA LA DE Rodrigo Peña!")).toBe("¡se suelta la de Rodrigo Peña!");
    expect(forSpeech("¡Se baja Ana!")).toBe("¡Se baja Ana!");
  });

  it("muestra el nombre de la voz sin los apellidos técnicos", () => {
    expect(shortVoiceName("Microsoft Marcelo Online (Natural) - Spanish (Bolivia)")).toBe("Marcelo - Spanish (Bolivia)");
    expect(shortVoiceName("Microsoft Helena - Spanish (Spain)")).toBe("Helena - Spanish (Spain)");
  });
});

describe("la voz dice menos que el cartel", () => {
  afterEach(() => {
    stopNarrator();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Una voz de mentira: anota lo que dice y termina cuando se le pide. */
  function voz(): { dichas: string[]; termina: () => void } {
    const dichas: string[] = [];
    let viva: { onend?: () => void } | null = null;
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("SpeechSynthesisUtterance", function (this: { text: string }, text: string) {
      this.text = text;
    });
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [{ name: "Prueba", lang: "es-BO", localService: true }],
      speak: (u: { text: string; onend?: () => void }) => {
        if (!u.text.trim()) return;
        dichas.push(u.text);
        viva = u;
      },
      cancel: () => {
        const u = viva;
        viva = null;
        u?.onend?.();
      },
      addEventListener: () => {},
      resume: () => {},
      speaking: false,
      paused: false,
    });
    return {
      dichas,
      termina: () => {
        const u = viva;
        viva = null;
        u?.onend?.();
      },
    };
  }

  it("dice la primera línea y las fuertes, y calla las comunes que llegan sin silencio", () => {
    vi.useFakeTimers();
    const v = voz();
    primeNarrator();
    narrate("¡Llamas en la largada!", 0.1);
    narrate("¡Ana pasa a la punta!", 0.3);
    v.termina();
    vi.advanceTimersByTime(1000);
    narrate("¡Beto pasa a la punta!", 0.4);
    narrate("¡ÚLTIMA RECTA!", 0.85);
    v.termina();
    vi.advanceTimersByTime(3500);
    narrate("¡Ana se escapa!", 0.5);
    v.termina();
    narrate("¡GANA Ana!", 1);
    expect(v.dichas).toEqual(["¡Llamas en la largada!", "¡última recta!", "¡Ana se escapa!", "¡gana Ana!"]);
  });

  it("cada sorteo vuelve a decir su primera línea", () => {
    vi.useFakeTimers();
    const v = voz();
    primeNarrator();
    narrate("¡Se arma la ruleta!", 0.1);
    v.termina();
    stopNarrator();
    primeNarrator();
    narrate("¡Se tiende el aguayo!", 0.1);
    expect(v.dichas).toEqual(["¡Se arma la ruleta!", "¡Se tiende el aguayo!"]);
  });
});
