// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La barra de lo que sigue cuenta personas con la misma función que el cuadro y el resumen
 * (`contar(canonicalList(ta.value), true)`), no leyendo el texto de las fichas: el texto de una
 * ficha puede traer la cuenta de participaciones al lado, y la barra contaba otra cosa.
 */

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/?modo=varias&lang=es");
  document.body.innerHTML =
    '<div id="stadium"></div><div id="winner-box"></div>' +
    '<textarea id="ta">Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto</textarea>' +
    // Las fichas dicen otra cosa a propósito: la barra no tiene que contar desde acá.
    '<div id="names"><i>Ana, primera</i><i>Ana, segunda</i><i>Ana, tercera</i><i>Beto</i></div>' +
    '<input id="prize" value="Una pizza"><div id="prize-chips"></div>' +
    '<section id="sec-participants"></section><button id="btn-freeze">Sellar la lista</button>' +
    '<div id="siguiente"><span id="sig-paso"></span><button id="sig-btn"></button></div><span id="sig-aviso"></span>' +
    '<ol id="pasos"></ol>';
});

describe("la barra de lo que sigue con varias participaciones", () => {
  it("cuenta las personas del cuadro, no el texto de las fichas", async () => {
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    // Dos personas (Ana con tres participaciones y Beto), cuatro líneas.
    expect(document.getElementById("sig-paso")?.textContent).toContain("lista de 2 personas, 4 participaciones");
  });
});
