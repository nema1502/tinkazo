// @vitest-environment jsdom
/** La línea del límite del servicio de cuentas y su cuenta que baja, sin la página: las piezas y el reloj son de mentira. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_LIMITE, contarElLimite, textoDeLimite } from "./limite";
import { TEXTOS_CAMPANA } from "./textos";

const AHORA = Date.UTC(2026, 10, 22, 15);

function piezas() {
  const error = document.createElement("p");
  error.hidden = true;
  const entrar = document.createElement("button");
  const programadas: Array<() => void> = [];
  return {
    error,
    entrar,
    programadas,
    p: {
      error,
      entrar,
      ahora: () => Date.now(),
      idioma: () => "es" as const,
      programar: (f: () => void, ms: number): number => {
        programadas.push(f);
        return window.setTimeout(f, ms);
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("los textos del límite", () => {
  it("tienen las mismas claves en los dos idiomas y el marcador de los segundos", () => {
    expect(Object.keys(TEXTOS_LIMITE.es)).toEqual(Object.keys(TEXTOS_LIMITE.en));
    expect(TEXTOS_LIMITE.es.lmEspera).toContain("{n}");
    expect(TEXTOS_LIMITE.en.lmEspera).toContain("{n}");
  });

  it("no usan signos prohibidos, palabras de juegos de azar ni términos técnicos, y dicen la verdad", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const [clave, texto] of Object.entries(TEXTOS_LIMITE[idioma])) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;«»"“”„—–·¡!]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[←-⇿⟵-⟿]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(/rifa|lotería|boleto|ticket|apuesta|raffle|lottery|stellar|usdc|blockchain|wallet|token|turnkey|pollar|passkey/iu);
        // Es un aviso de que hay mucha gente: no dice que la cuenta no se pudo crear ni que algo falló.
        expect(texto, `${idioma}.${clave}`).not.toMatch(/crear|create|falló|failed/iu);
      }
    }
  });

  it("no repiten claves de la página y no importan el diccionario del sitio", () => {
    expect(Object.keys(TEXTOS_LIMITE.es).filter((c) => c in TEXTOS_CAMPANA.es)).toEqual([]);
    const codigo = readFileSync("src/campana/limite.ts", "utf8");
    expect(codigo).not.toMatch(/from\s+["']\.\.\/i18n["']/u);
    const usadas = [...codigo.matchAll(/\b(lm[A-Z][A-Za-z0-9]*)\b/gu)].map((m) => m[1] ?? "");
    for (const clave of Object.keys(TEXTOS_LIMITE.es)) expect(usadas.includes(clave), clave).toBe(true);
  });

  it("textoDeLimite pone los segundos, en singular con uno, y en el idioma de la persona", () => {
    expect(textoDeLimite("es", 20)).toBe("Hay mucha gente entrando. Probá en 20 segundos.");
    expect(textoDeLimite("es", 1)).toBe("Hay mucha gente entrando. Probá en 1 segundo.");
    expect(textoDeLimite("en", 20)).toBe("Lots of people are signing in. Try again in 20 seconds.");
    expect(textoDeLimite("en", 1)).toBe("Lots of people are signing in. Try again in 1 second.");
  });
});

describe("la cuenta que baja", () => {
  it("baja cada segundo, apaga el botón mientras dura y lo prende solo al liberarse", () => {
    const { error, entrar, p } = piezas();
    contarElLimite(p, AHORA + 3_000);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(textoDeLimite("es", 3));
    expect(entrar.disabled).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(error.textContent).toBe(textoDeLimite("es", 2));
    vi.advanceTimersByTime(1_000);
    expect(error.textContent).toBe(textoDeLimite("es", 1));
    expect(entrar.disabled).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(error.hidden).toBe(true);
    expect(entrar.disabled).toBe(false);
    // No queda nada programado: al liberarse, nadie abre nada ni vuelve a contar.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("se anuncia una sola vez: el aviso queda como región viva solo al principio", () => {
    const { error, p } = piezas();
    contarElLimite(p, AHORA + 5_000);
    expect(error.getAttribute("role")).toBe("status");
    vi.advanceTimersByTime(1_000);
    expect(error.getAttribute("role")).toBeNull();
  });

  it("con el límite ya pasado no muestra nada y deja el botón prendido", () => {
    const { error, entrar, p } = piezas();
    entrar.disabled = true;
    contarElLimite(p, AHORA - 1_000);
    expect(error.hidden).toBe(true);
    expect(entrar.disabled).toBe(false);
  });
});
