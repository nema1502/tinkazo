// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSiguiente } from "./siguiente";

/**
 * La barra de «lo que sigue» deja observadores vivos en el cuerpo de la página (`initSiguiente`). Al desarmarse el ambiente
 * de una prueba, la página deja de existir (no hay `document`) y, un instante después, el cuerpo cambia: los observadores
 * avisan igual. Sin un resguardo, cada aviso lanzaba «document is not defined» y ensuciaba los registros de las pruebas
 * (24 avisos por corrida de las tres pruebas de la barra). En el navegador la página siempre existe: no cambia nada.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la barra de lo que sigue con la página ya desarmada", () => {
  it("los observadores del cuerpo avisan sin que haya documento y no lanzan nada", async () => {
    document.body.dataset.vista = "app";
    document.body.dataset.tab = "nuevo";
    document.body.innerHTML =
      `<div id="stadium" style="display:none"></div><div id="winner-box" style="display:none"></div>` +
      `<ol id="pasos">${[1, 2, 3, 4].map((n) => `<li data-paso="${n}"><span class="p-n"></span><span class="p-e"></span></li>`).join("")}</ol>` +
      `<div id="names"></div><button id="btn-pegar" type="button">Pegar lista</button><button id="btn-freeze" type="button"></button><button id="btn-draw" type="button"></button>` +
      `<div id="again-row" style="display:none"><button id="btn-again-sin" type="button"></button></div><button id="btn-proof" type="button"></button>` +
      `<input id="prize" /><div id="prize-chips"></div><section id="sec-participants"></section>` +
      `<div id="siguiente"><p id="sig-paso"></p><button id="sig-btn" type="button"></button></div><div id="sig-aviso"></div>`;
    initSiguiente({ segundos: () => 0 });
    // Que terminen los avisos de armar la barra antes de desarmar la página.
    await new Promise((r) => setTimeout(r, 0));

    // Un oyente de errores de la ventana: jsdom le cuenta ahí lo que lanza un observador (y así la prueba no lo da por perdido).
    const errores: string[] = [];
    const alError = (e: ErrorEvent): void => {
      errores.push(e.message);
      e.preventDefault();
    };
    window.addEventListener("error", alError);

    // Lo que hace el ambiente al desarmarse: la página deja de existir y el cuerpo cambia.
    const pagina = document;
    const cuerpo = document.body;
    vi.stubGlobal("document", undefined);
    cuerpo.append(pagina.createElement("i"));
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
    window.removeEventListener("error", alError);

    expect(errores).toEqual([]);
  });
});
