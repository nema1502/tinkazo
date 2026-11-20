// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * En el stand nadie gana: al llegar al resultado, el aviso para el lector de pantalla dice quién salió, no quién ganó.
 * Fuera del stand el aviso es el de siempre.
 */

const CUERPO =
  '<div id="stadium"></div><div id="winner-box" style="display:none"></div>' +
  '<textarea id="ta">Ana\nBeto\nNora\nLeo\nIris\nMax\nPía\nTeo</textarea>' +
  '<div id="names"></div><input id="prize" value=""><div id="prize-chips"></div>' +
  '<section id="sec-participants"></section><button id="btn-freeze">Empezar la ronda</button>' +
  '<div id="siguiente"><span id="sig-paso"></span><button id="sig-btn"></button></div><span id="sig-aviso"></span>' +
  '<ol id="pasos"></ol><button id="btn-draw"></button><button id="btn-proof"></button><button id="btn-again-sin"></button>' +
  '<div id="again-row"></div><button id="btn-pegar"></button>';

const NOMBRES = ["Ana", "Beto", "Nora", "Leo", "Iris", "Max", "Pía", "Teo"];

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = CUERPO;
});

/** Arranca la barra con la lista lista, sella la ronda y muestra el resultado con `salieron` personas. Devuelve el aviso. */
async function resultadoCon(salieron: number, stand: boolean, lang: "es" | "en"): Promise<string> {
  history.replaceState(null, "", `/?lang=${lang}#sortear`);
  if (stand) sessionStorage.setItem("tinkazo.stand", "1");
  const i18n = await import("../i18n");
  i18n.setLang(lang);
  const { app } = await import("../state");
  const { initSiguiente, actualizarPaso } = await import("./siguiente");
  initSiguiente({ segundos: () => 0 });
  // La ronda empezó: lista cerrada, sin resultado todavía.
  app.frozen = { names: NOMBRES } as never;
  actualizarPaso();
  // El resultado se ve.
  app.drawn = { winners: Array.from({ length: salieron }, (_, i) => i) } as never;
  (document.getElementById("winner-box") as HTMLElement).style.display = "block";
  actualizarPaso();
  return document.getElementById("sig-aviso")?.textContent ?? "";
}

describe("el aviso al llegar al resultado", () => {
  it("en el stand, con una persona que salió: Ya se ve quién salió", async () => {
    expect(await resultadoCon(1, true, "es")).toBe("Ya se ve quién salió");
  });

  it("en el stand, con varias: Ya se ve quiénes salieron", async () => {
    expect(await resultadoCon(3, true, "es")).toBe("Ya se ve quiénes salieron");
  });

  it("en inglés, sin la palabra winner", async () => {
    const uno = await resultadoCon(1, true, "en");
    expect(uno).toBe("Now showing who was picked");
    vi.resetModules();
    document.body.innerHTML = CUERPO;
    const varias = await resultadoCon(3, true, "en");
    expect(varias).toBe("Now showing everyone who was picked");
    expect(`${uno} ${varias}`).not.toMatch(/winner|won\b/i);
  });

  it("fuera del stand queda el aviso de siempre", async () => {
    const aviso = await resultadoCon(3, false, "es");
    expect(aviso).toContain("Ya salieron los ganadores");
  });
});
