// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La barra de lo que sigue en el resultado de un Amigo secreto. «Compartir el resultado» no hace nada en este modo (la
 * foto y el mensaje llevarían el reparto), y lo que sigue es Copiar enlace en cada fila: la barra no ofrece ningún botón.
 * Se mira qué botón de verdad vigila la barra, que es el que repetiría: sin botón no hay barra.
 */

const vigilados: Element[] = [];

const CUERPO =
  `<div id="stadium" style="display:none"></div><div id="winner-box" style="display:block"></div>` +
  `<ol id="pasos">${[1, 2, 3, 4].map((n) => `<li data-paso="${n}"><span class="p-n"></span><span class="p-e"></span></li>`).join("")}</ol>` +
  `<div id="names"><i>Ana</i><i>Beto</i><i>Carla</i><i>Diego</i></div>` +
  `<button id="btn-pegar" type="button">Pegar lista</button><button id="btn-freeze" type="button"></button><button id="btn-draw" type="button"></button>` +
  `<div id="again-row" style="display:block"><button id="btn-again-sin" type="button" style="display:none"></button>` +
  `<button id="btn-proof" type="button">Compartir el resultado</button></div>` +
  `<input id="prize" /><div id="prize-chips"></div><section id="sec-participants"></section>` +
  `<div id="siguiente"><p id="sig-paso"></p><button id="sig-btn" type="button"></button></div><div id="sig-aviso"></div>`;

const NOMBRES = ["Ana", "Beto", "Carla", "Diego"];

/** Arma la barra con un resultado en pantalla: `ganadores` lugares de la lista y el nombre del sorteo. */
async function conResultado(ganadores: number[], prize: string): Promise<void> {
  const { app } = await import("../state");
  app.frozen = { names: NOMBRES, listHash: "00", ts: 1, at: "", prize, round: 7, raffleId: 5n } as never;
  app.drawn = { winners: ganadores, beacon: { round: 7, randomness: "00", signature: "00" } } as never;
  const { initSiguiente, actualizarPaso } = await import("./siguiente");
  initSiguiente({ segundos: () => 0 });
  actualizarPaso();
}

beforeEach(() => {
  vi.resetModules();
  vigilados.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(el: Element): void {
        vigilados.push(el);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  history.replaceState(null, "", "/?lang=es");
  document.body.dataset.vista = "app";
  document.body.dataset.tab = "nuevo";
  delete document.body.dataset.demo;
  document.body.innerHTML = CUERPO;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la barra en el resultado de un Amigo secreto", () => {
  it("no vigila «Compartir el resultado»: no hay botón que repetir", async () => {
    await conResultado([2, 0, 3, 1], "Amigo secreto");
    expect(vigilados.map((el) => el.id)).not.toContain("btn-proof");
  });

  it("lo que se anuncia al lector de pantalla no habla de ganadores", async () => {
    // Primero la espera: lo primero que se calcula no se anuncia, el paso al resultado sí.
    const box = document.getElementById("winner-box") as HTMLElement;
    box.style.display = "none";
    const { app } = await import("../state");
    app.frozen = { names: NOMBRES, listHash: "00", ts: 1, at: "", prize: "Amigo secreto", round: 7, raffleId: 5n } as never;
    app.drawn = null;
    const { initSiguiente, actualizarPaso } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    actualizarPaso();
    app.drawn = { winners: [2, 0, 3, 1], beacon: { round: 7, randomness: "00", signature: "00" } } as never;
    box.style.display = "block";
    actualizarPaso();
    const aviso = document.getElementById("sig-aviso")?.textContent ?? "";
    expect(aviso).toBe("Paso 4 de 4. Ya salió el amigo secreto.");
    expect(aviso).not.toMatch(/ganador/i);
  });

  it("en un sorteo común que terminó, la barra sigue ofreciendo «Compartir el resultado»", async () => {
    await conResultado([2], "Termo");
    expect(vigilados.map((el) => el.id)).toContain("btn-proof");
  });
});
