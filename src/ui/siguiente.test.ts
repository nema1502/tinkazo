// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { actualizarPaso, initSiguiente, mandaListaDeCupones } from "./siguiente";

/** Una sola acción principal por paso: con equipos con cupón, manda la lista del panel, no "Pegar lista". */

describe("con equipos con cupón", () => {
  it("la barra cede el paso a la lista del panel", () => {
    document.body.innerHTML = `<button id="eq-lista" type="button">Usar los equipos con cupón como lista</button>`;
    expect(mandaListaDeCupones()).toBe(true);
  });

  it("sin panel, o con su botón escondido, la barra sigue ofreciendo lo suyo", () => {
    document.body.innerHTML = "";
    expect(mandaListaDeCupones()).toBe(false);
    document.body.innerHTML = `<button id="eq-lista" type="button" hidden>Usar los equipos con cupón como lista</button>`;
    expect(mandaListaDeCupones()).toBe(false);
  });

  it("con un contenedor escondido, el botón no manda aunque el suyo diga que se ve", () => {
    document.body.innerHTML = `<div hidden><button id="eq-lista" type="button">Usar los equipos con cupón como lista</button></div>`;
    expect(mandaListaDeCupones()).toBe(false);
    document.body.innerHTML = `<section hidden><div><button id="eq-lista" type="button">Usar los equipos con cupón como lista</button></div></section>`;
    expect(mandaListaDeCupones()).toBe(false);
  });
});

describe("la barra entera, con el panel de equipos", () => {
  it("cede cuando el botón de la lista aparece y vuelve cuando desaparece, sin otro estímulo", async () => {
    let alVer: (entradas: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void = () => undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: typeof alVer) {
          alVer = cb;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    document.body.dataset.vista = "app";
    document.body.dataset.tab = "nuevo";
    delete document.body.dataset.demo;
    document.body.innerHTML =
      `<div id="stadium" style="display:none"></div><div id="winner-box" style="display:none"></div>` +
      `<ol id="pasos">${[1, 2, 3, 4].map((n) => `<li data-paso="${n}"><span class="p-n"></span><span class="p-e"></span></li>`).join("")}</ol>` +
      `<div id="names"></div><button id="btn-pegar" type="button">Pegar lista</button><button id="btn-freeze" type="button"></button><button id="btn-draw" type="button"></button>` +
      `<div id="again-row" style="display:none"><button id="btn-again-sin" type="button"></button></div><button id="btn-proof" type="button"></button>` +
      `<input id="prize" /><div id="prize-chips"></div><section id="sec-participants"></section>` +
      `<div id="panel"><div id="eq-sala"><button id="eq-lista" type="button" hidden>Usar los equipos con cupón como lista</button></div></div>` +
      `<div id="siguiente"><p id="sig-paso"></p><button id="sig-btn" type="button"></button></div><div id="sig-aviso"></div>`;
    initSiguiente({ segundos: () => 0 });
    const barra = document.getElementById("siguiente") as HTMLElement;
    const botonLista = document.getElementById("eq-lista") as HTMLButtonElement;
    // El botón de verdad queda fuera de la pantalla: la barra ofrece «Pegar lista».
    alVer([{ isIntersecting: false, intersectionRatio: 0 }]);
    await vi.waitFor(() => expect(barra.classList.contains("on")).toBe(true), { timeout: 2_000 });
    expect(document.getElementById("sig-btn")?.textContent).toBe("Pegar lista");
    // Aparece el botón del panel, sin que pase nada más: la barra tiene que ceder.
    botonLista.hidden = false;
    await vi.waitFor(() => expect(barra.classList.contains("on")).toBe(false), { timeout: 2_000 });
    // Y cuando ese botón desaparece, la barra vuelve a ofrecer lo suyo.
    botonLista.hidden = true;
    // El navegador avisa la vista del botón de verdad recién cuando lo vuelve a vigilar.
    await new Promise((r) => setTimeout(r, 0));
    alVer([{ isIntersecting: false, intersectionRatio: 0 }]);
    await vi.waitFor(() => expect(barra.classList.contains("on")).toBe(true), { timeout: 2_000 });
    expect(document.getElementById("sig-btn")?.textContent).toBe("Pegar lista");
    // Que los observadores terminen de avisar antes de cerrar el ambiente de la prueba.
    await new Promise((r) => setTimeout(r, 10));
    vi.unstubAllGlobals();
  });
});

describe("con el paso «Dejá tu cuenta lista» abierto", () => {
  it("la barra de lo que sigue no se ve: el paso tapa todo y tiene su propia acción", async () => {
    let alVer: (entradas: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void = () => undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: typeof alVer) {
          alVer = cb;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    document.body.dataset.vista = "app";
    document.body.dataset.tab = "nuevo";
    delete document.body.dataset.demo;
    document.body.innerHTML =
      `<div id="stadium" style="display:none"></div><div id="winner-box" style="display:none"></div>` +
      `<ol id="pasos">${[1, 2, 3, 4].map((n) => `<li data-paso="${n}"><span class="p-n"></span><span class="p-e"></span></li>`).join("")}</ol>` +
      `<div id="names"></div><button id="btn-pegar" type="button">Pegar lista</button><button id="btn-freeze" type="button"></button><button id="btn-draw" type="button"></button>` +
      `<div id="again-row" style="display:none"><button id="btn-again-sin" type="button"></button></div><button id="btn-proof" type="button"></button>` +
      `<input id="prize" /><div id="prize-chips"></div><section id="sec-participants"></section>` +
      `<div id="siguiente"><p id="sig-paso"></p><button id="sig-btn" type="button"></button></div><div id="sig-aviso"></div>`;
    initSiguiente({ segundos: () => 0 });
    const barra = document.getElementById("siguiente") as HTMLElement;
    alVer([{ isIntersecting: false, intersectionRatio: 0 }]);
    await vi.waitFor(() => expect(barra.classList.contains("on")).toBe(true), { timeout: 2_000 });
    const paso = document.createElement("div");
    paso.className = "cuenta-lista";
    document.body.append(paso);
    actualizarPaso();
    await vi.waitFor(() => expect(barra.classList.contains("on")).toBe(false), { timeout: 2_000 });
    paso.remove();
    actualizarPaso();
    await vi.waitFor(() => expect(barra.classList.contains("on")).toBe(true), { timeout: 2_000 });
    await new Promise((r) => setTimeout(r, 10));
    vi.unstubAllGlobals();
  });
});
