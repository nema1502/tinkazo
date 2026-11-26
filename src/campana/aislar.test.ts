// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aislarDelGuion } from "./aislar";

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

  it("la dirección de la barra queda entera: copiarla, abrirla en otro navegador o volver a ella sigue abriendo la campaña", () => {
    const antes = location.href;
    const estado = { otro: 1 };
    window.history.replaceState(estado, "", antes);
    aislarDelGuion();
    expect(location.href).toBe(antes);
    expect(location.search).toBe(`?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}`);
    expect(location.hash).toBe(`#${CLAVE}`);
    expect(history.state).toEqual(estado);
  });
});
