// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aislarDelGuion, enlaceCompleto } from "./aislar";
import { leerEnlaceDeLaPagina } from "./enlace";

const CLAVE = "abcdefghijklmnopqrstuv";
const PASE = "ABCDEFGHIJKL";
const ENLACE = `?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}#${CLAVE}`;

const meta = (): Element | null => document.head.querySelector('meta[name="referrer"]');

beforeEach(() => {
  window.history.replaceState(null, "", `/participar.html${ENLACE}`);
});

afterEach(() => {
  meta()?.remove();
  window.history.replaceState(null, "", "/");
});

describe("aislarDelGuion", () => {
  it("la página deja de mandar de dónde viene antes de que el guion de Google entre", () => {
    expect(meta()).toBeNull();
    aislarDelGuion();
    expect(meta()?.getAttribute("content")).toBe("no-referrer");
    aislarDelGuion();
    expect(document.head.querySelectorAll('meta[name="referrer"]')).toHaveLength(1);
  });

  it("la dirección queda sin la campaña, la sala, el pase ni la clave, y conserva el resto", () => {
    window.history.replaceState(null, "", `/participar.html?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}&lang=en&theme=dark#${CLAVE}`);
    aislarDelGuion();
    expect(location.pathname).toBe("/participar.html");
    expect(location.hash).toBe("");
    expect(new URLSearchParams(location.search).toString()).toBe("lang=en&theme=dark");
    for (const parte of [PASE, CLAVE, "ABCDEFGH", "evento-ejemplo"]) expect(location.href).not.toContain(parte);
  });

  it("lo que se saca no va a ningún almacenamiento: queda en el historial de esta pestaña", () => {
    aislarDelGuion();
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain(CLAVE);
    expect(JSON.stringify(history.state)).toContain(CLAVE);
  });

  it("sin nada que sacar no toca la dirección ni el historial", () => {
    window.history.replaceState({ otro: 1 }, "", "/participar.html?lang=en");
    aislarDelGuion();
    expect(history.state).toEqual({ otro: 1 });
    expect(location.search).toBe("?lang=en");
  });
});

describe("leerEnlaceDeLaPagina y enlaceCompleto", () => {
  it("antes de limpiar, leen la dirección", () => {
    expect(leerEnlaceDeLaPagina()).toEqual({ evento: "evento-ejemplo", q: null, clave: CLAVE, sala: "ABCDEFGH", pase: PASE });
    expect(enlaceCompleto()).toBe(`${location.origin}/participar.html${ENLACE}`);
  });

  it("después de limpiar, recargar sigue abriendo la misma campaña y el enlace para compartir es el entero", () => {
    aislarDelGuion();
    expect(leerEnlaceDeLaPagina()).toEqual({ evento: "evento-ejemplo", q: null, clave: CLAVE, sala: "ABCDEFGH", pase: PASE });
    expect(enlaceCompleto()).toBe(`${location.origin}/participar.html${ENLACE}`);
  });

  it("el idioma que se cambió después de limpiar vale más que el guardado", () => {
    window.history.replaceState(null, "", `/participar.html?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}&lang=es#${CLAVE}`);
    aislarDelGuion();
    window.history.replaceState(history.state, "", "/participar.html?lang=en");
    const entero = new URL(enlaceCompleto());
    expect(entero.searchParams.get("lang")).toBe("en");
    expect(entero.searchParams.get("s")).toBe("ABCDEFGH");
    expect(entero.hash).toBe(`#${CLAVE}`);
  });

  it("una dirección sin campaña y sin historial guardado no abre nada", () => {
    window.history.replaceState(null, "", "/participar.html");
    expect(leerEnlaceDeLaPagina()).toBeNull();
    window.history.replaceState({ tinkazoEnlace: { search: 5, hash: "x" } }, "", "/participar.html");
    expect(leerEnlaceDeLaPagina()).toBeNull();
    window.history.replaceState({ tinkazoEnlace: { search: "?c=Mal", hash: "" } }, "", "/participar.html");
    expect(leerEnlaceDeLaPagina()).toBeNull();
  });
});
