// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initSiguiente, verError } from "./siguiente";

/**
 * La barra de "lo que sigue" decide si el botón de verdad se ve descontando lo
 * que tapa el borde de arriba. En pantallas anchas es la cabecera fija; en las
 * angostas la cabecera se queda en su lugar, pero la cinta de versión nueva va
 * pegada arriba y publica su alto en `--cinta-alto`: un botón detrás de ella
 * no se ve. Sin la cinta, todo queda como antes.
 */

let margen = "";
const raiz = document.documentElement.style;

/** Rearma el observador como lo hace la página al cambiar de tamaño. */
const rearmar = async (): Promise<void> => {
  margen = "";
  window.dispatchEvent(new Event("resize"));
  await vi.waitFor(() => expect(margen).not.toBe(""));
};

const cabecera = (posicion: string, alto: number): HTMLElement => {
  const cab = document.querySelector("header") as HTMLElement;
  cab.style.position = posicion;
  cab.getBoundingClientRect = () => ({ top: 0, bottom: alto, left: 0, right: 390, width: 390, height: alto, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return cab;
};

beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(_cb: unknown, opciones?: IntersectionObserverInit) {
        margen = opciones?.rootMargin ?? "";
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  document.body.dataset.vista = "app";
  document.body.dataset.tab = "nuevo";
  document.body.innerHTML =
    `<header style="position: static"></header>` +
    `<div id="stadium" style="display:none"></div><div id="winner-box" style="display:none"></div>` +
    `<ol id="pasos">${[1, 2, 3, 4].map((n) => `<li data-paso="${n}"><span class="p-n"></span><span class="p-e"></span></li>`).join("")}</ol>` +
    `<div id="names"></div><button id="btn-pegar" type="button">Pegar lista</button><button id="btn-freeze" type="button"></button><button id="btn-draw" type="button"></button>` +
    `<div id="again-row" style="display:none"><button id="btn-again-sin" type="button"></button></div><button id="btn-proof" type="button"></button>` +
    `<input id="prize" /><div id="prize-chips"></div><section id="sec-participants"></section>` +
    `<div id="siguiente"><p id="sig-paso"></p><button id="sig-btn" type="button"></button></div><div id="sig-aviso"></div>`;
  initSiguiente({ segundos: () => 0 });
});

afterAll(() => {
  raiz.removeProperty("--cinta-alto");
  vi.unstubAllGlobals();
});

describe("lo que tapa el borde de arriba", () => {
  it("sin cinta y con la cabecera en su lugar (celular), no descuenta nada, como siempre", async () => {
    raiz.removeProperty("--cinta-alto");
    cabecera("static", 120);
    await rearmar();
    expect(margen).toBe("0px 0px 0px 0px");
  });

  it("sin cinta y con la cabecera fija (escritorio), descuenta la cabecera, como siempre", async () => {
    raiz.removeProperty("--cinta-alto");
    cabecera("sticky", 97);
    await rearmar();
    expect(margen).toBe("-97px 0px 0px 0px");
  });

  it("con la cinta pegada arriba (celular), un botón detrás de ella no cuenta como visible", async () => {
    raiz.setProperty("--cinta-alto", "62px");
    cabecera("static", 120);
    await rearmar();
    expect(margen).toBe("-62px 0px 0px 0px");
  });

  it("un error detrás de la cinta se lleva a la vista; sin la cinta, ahí ya se veía", () => {
    cabecera("static", 120);
    const mensaje = document.createElement("p");
    mensaje.textContent = "No pude hablar con la red";
    mensaje.getBoundingClientRect = () => ({ top: 20, bottom: 44, left: 0, right: 390, width: 390, height: 24, x: 0, y: 20, toJSON: () => ({}) }) as DOMRect;
    const llevar = vi.fn();
    mensaje.scrollIntoView = llevar;
    document.body.append(mensaje);
    raiz.removeProperty("--cinta-alto");
    verError(mensaje);
    expect(llevar).not.toHaveBeenCalled();
    raiz.setProperty("--cinta-alto", "62px");
    verError(mensaje);
    expect(llevar).toHaveBeenCalledTimes(1);
    mensaje.remove();
  });
});
