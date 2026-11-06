// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { MAX_WINNERS } from "../protocol/select";
import { MAX_TARJETAS, alTocarAusente, enLista, htmlDeGanadores } from "./resultado-ganadores";

/**
 * Los ganadores en la página del resultado: tarjetas hasta seis, y con más la del primero y una lista numerada de
 * renglones cortos (hasta 100). Se prueba el markup y el cambio de «No está» a su pregunta; cómo se acomoda en un celular
 * o en un proyector se mira con un navegador.
 */

const nombres = (n: number): string[] => Array.from({ length: n + 5 }, (_, i) => `Persona <${i}> & Co`);
const ganan = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 2);
const avatar = (nombre: string): string => `data:cara-${nombre.length}`;
/** Un toque en ese elemento, como lo recibe el manejador de `#winner-cards`. */
const toque = (el: Element | null): Event => ({ target: el }) as unknown as Event;

function pintar(n: number, extra: { prize?: string; reemplazo?: boolean } = {}): HTMLElement {
  const caja = document.createElement("div");
  caja.id = "winner-cards";
  caja.innerHTML = htmlDeGanadores({ names: nombres(n), winners: ganan(n), prize: extra.prize ?? "", reemplazo: extra.reemplazo ?? true, avatar });
  document.body.replaceChildren(caja);
  return caja;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("hasta seis ganadores: una tarjeta cada uno, como siempre", () => {
  it.each([1, 2, MAX_TARJETAS])("con %i", (n) => {
    const c = pintar(n, { prize: "Termo" });
    expect(enLista(n)).toBe(false);
    expect(c.querySelectorAll(".winner-card")).toHaveLength(n);
    expect(c.querySelectorAll(".winner-card img")).toHaveLength(n);
    expect(c.querySelector(".winner-lista")).toBeNull();
    expect(c.querySelector("#wn-0")?.textContent).toBe("Persona <2> & Co");
    expect(c.querySelectorAll(".ausente")).toHaveLength(n);
    expect(c.querySelector('.ausente[data-k="0"] button')?.getAttribute("data-i")).toBe("ausenteBtn");
  });

  it("con un solo ganador no lleva número; con varios, sí, junto al premio", () => {
    expect(pintar(1, { prize: "Termo" }).querySelector(".winner-prize")?.textContent).toBe("Se lleva: Termo");
    expect(pintar(3, { prize: "Termo" }).querySelectorAll(".winner-prize")[2]?.textContent).toBe("Se lleva: Termo #3");
    expect(pintar(3).querySelectorAll(".winner-prize")[1]?.textContent).toBe("#2");
  });
});

describe("más de seis: la tarjeta del primero y una lista de los demás", () => {
  it.each([MAX_TARJETAS + 1, 32, 50, MAX_WINNERS])("con %i", (n) => {
    const c = pintar(n, { prize: "Termo" });
    expect(enLista(n)).toBe(true);
    // Una sola tarjeta (la del primer premio); los otros n - 1, en renglones, sin una imagen por persona.
    expect(c.querySelectorAll(".winner-card")).toHaveLength(1);
    expect(c.querySelectorAll("img")).toHaveLength(1);
    const filas = [...c.querySelectorAll<HTMLElement>(".winner-lista > li.winner-fila")];
    expect(filas).toHaveLength(n - 1);
    // En el orden de los premios: el segundo es #2, y el último, #n; con los ids que lee el botón de «No está».
    expect(filas[0]?.querySelector(".winner-num")?.textContent).toBe("#2");
    expect(filas[n - 2]?.querySelector(".winner-num")?.textContent).toBe(`#${n}`);
    expect(filas[0]?.querySelector(".winner-name")?.id).toBe("wn-1");
    expect(filas[n - 2]?.querySelector(".winner-name")?.id).toBe(`wn-${n - 1}`);
    expect(filas[0]?.querySelector(".winner-name")?.textContent).toBe("Persona <3> & Co");
    // Cada renglón ofrece «No está», el corto, y apunta a su premio.
    const botones = [...c.querySelectorAll<HTMLButtonElement>(".winner-lista .ausente button")];
    expect(botones).toHaveLength(n - 1);
    expect(botones[0]?.dataset.i).toBe("ausenteBtnCorto");
    expect(botones[0]?.getAttribute("aria-describedby")).toBe("wn-1");
  });

  it("dice cuántos son los otros y qué se lleva cada quien, una sola vez", () => {
    const c = pintar(50, { prize: "Una <b>polera</b>" });
    expect(c.querySelector(".winner-lista-t")?.textContent).toBe("Los otros 49 ganadores, en orden");
    expect(c.querySelectorAll(".winner-lista-premio")).toHaveLength(1);
    expect(c.querySelector(".winner-lista-premio")?.textContent).toBe("Cada quien se lleva: Una <b>polera</b>");
    // Y los nombres y el premio van como texto, nunca como etiquetas.
    expect(c.querySelectorAll("b")).toHaveLength(0);
    expect(c.querySelector(".winner-lista")?.getAttribute("aria-labelledby")).toBe("winner-lista-t");
    expect(c.querySelector("#winner-lista-t")).not.toBeNull();
  });

  it("sin premio no inventa la línea de lo que se llevan", () => {
    expect(pintar(20).querySelector(".winner-lista-premio")).toBeNull();
  });

  it("sin con quién volver a sortear, nadie ofrece «No está»", () => {
    const c = pintar(100, { reemplazo: false });
    expect(c.querySelectorAll(".ausente")).toHaveLength(0);
    expect(c.querySelectorAll(".winner-fila")).toHaveLength(99);
  });

  it("los textos nuevos están en español y en inglés", () => {
    for (const l of ["es", "en"] as const) {
      expect(T[l].winnersOtros, `${l}.winnersOtros`).toContain("{n}");
      for (const k of ["winnersCadaUno", "ausenteBtnCorto"]) expect(typeof T[l][k], `${l}.${k}`).toBe("string");
    }
  });
});

describe("«No está» en un renglón de la lista", () => {
  it("pregunta en el mismo lugar, «Cancelar» vuelve al botón corto, y «Sí» sortea de nuevo ese premio", () => {
    const c = pintar(20);
    const alConfirmar = vi.fn();
    const abrir = c.querySelector<HTMLButtonElement>('.winner-lista .ausente[data-k="7"] button');
    alTocarAusente(toque(abrir), alConfirmar);
    const caja = c.querySelector<HTMLElement>('.winner-lista .ausente[data-k="7"]') as HTMLElement;
    expect(caja.querySelector(".ausente-q")).not.toBeNull();
    expect(caja.querySelectorAll("button")).toHaveLength(2);
    // Cancelar: el botón corto otra vez, no el largo de las tarjetas.
    alTocarAusente(toque(caja.querySelector("[data-ausente-no]")), alConfirmar);
    expect(alConfirmar).not.toHaveBeenCalled();
    expect(caja.querySelector("button")?.getAttribute("data-i")).toBe("ausenteBtnCorto");
    // Sí: sortea de nuevo el premio 7 (el octavo), no otro.
    alTocarAusente(toque(caja.querySelector("button")), alConfirmar);
    alTocarAusente(toque(caja.querySelector("[data-ausente-si]")), alConfirmar);
    expect(alConfirmar).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("en una tarjeta, «Cancelar» vuelve al botón largo de siempre", () => {
    const c = pintar(3);
    alTocarAusente(toque(c.querySelector('.ausente[data-k="1"] button')), vi.fn());
    alTocarAusente(toque(c.querySelector('.ausente[data-k="1"] [data-ausente-no]')), vi.fn());
    expect(c.querySelector('.ausente[data-k="1"] button')?.getAttribute("data-i")).toBe("ausenteBtn");
  });

  it("un toque fuera de un botón de «No está» no hace nada", () => {
    const c = pintar(10);
    const alConfirmar = vi.fn();
    alTocarAusente(toque(c.querySelector(".winner-name")), alConfirmar);
    alTocarAusente(toque(null), alConfirmar);
    expect(alConfirmar).not.toHaveBeenCalled();
  });
});
