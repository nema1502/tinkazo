// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n";
import { CAMINAR_MS, ENTRADA_MS, PAPEL_MS, acompanar, enPantalla, type Acompanamiento } from "./llama-guia";
import { PANTALLAS_DE_CARGA, PANTALLAS_DE_COMPRA } from "./llama-guia-estado";

/**
 * La llama que acompaña los recorridos largos (la compra, la verificación, la carga): una llamada por pantalla. Monta,
 * actualiza sin rehacer, se quita, festeja una sola vez, respeta a quien pidió menos movimiento y se lee bien con un
 * lector de pantalla, en español y en inglés.
 */

let reducido = false;

beforeEach(() => {
  vi.useFakeTimers();
  reducido = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reducido && q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
  setLang("es");
  document.body.innerHTML = '<div class="dlg-cuerpo" id="c"><h3>Verificá tu identidad</h3><p class="dato">Bs 65</p></div>';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const c = (): HTMLElement => document.getElementById("c") as HTMLElement;
const llg = (): HTMLElement | null => c().querySelector<HTMLElement>(".llg");
const barra = (): HTMLElement | null => c().querySelector<HTMLElement>('[role="progressbar"]');
const poseDibujada = (): string | null => c().querySelector(".llg-svg")?.getAttribute("data-pose") ?? null;
const globo = (): HTMLElement | null => c().querySelector<HTMLElement>(".llg-globo");
const TRAMOS_ES = ["Tu cuenta", "Tu identidad", "Tu pago", "En camino"];
const paso2: Acompanamiento = { pose: "anima", linea: "Es una sola vez. Tené a mano tu carnet.", paso: 2, total: 4, avance: 0.25, tramos: TRAMOS_ES };

describe("una llamada por pantalla", () => {
  it("la primera monta la llama arriba del cuerpo, debajo del título, sin tocar lo demás", () => {
    acompanar(c(), paso2);
    const hijos = [...c().children];
    expect(hijos.map((h) => h.tagName.toLowerCase())).toEqual(["h3", "div", "p"]);
    expect(hijos[1]?.classList.contains("llg")).toBe(true);
    expect(c().querySelector(".dato")?.textContent).toBe("Bs 65");
    expect(llg()?.dataset.pose).toBe("anima");
    expect(poseDibujada()).toBe("anima");
    expect(globo()?.textContent).toBe("Es una sola vez. Tené a mano tu carnet.");
  });

  it("sin título, va primera en el contenedor", () => {
    document.body.innerHTML = '<div id="c"><p class="dato">Bs 65</p></div>';
    acompanar(c(), paso2);
    expect(c().firstElementChild?.classList.contains("llg")).toBe(true);
  });

  it("la segunda la actualiza sin rehacerla: la misma llama camina al lugar nuevo y cambia de pose y de línea", () => {
    acompanar(c(), paso2);
    const antes = llg();
    acompanar(c(), { pose: "espera", linea: "Apenas tu banco lo mande, seguimos.", paso: 3, total: 4, avance: 0.8, tramos: TRAMOS_ES });
    expect(llg()).toBe(antes);
    expect(c().querySelectorAll(".llg")).toHaveLength(1);
    expect(globo()?.textContent).toBe("Apenas tu banco lo mande, seguimos.");
    expect(llg()?.style.getPropertyValue("--x")).toBe("0.7");
    // Mientras camina va al trote, y al llegar toma la pose de la pantalla.
    expect(llg()?.classList.contains("llg-camina")).toBe(true);
    expect(poseDibujada()).toBe("anima");
    vi.advanceTimersByTime(CAMINAR_MS);
    expect(llg()?.classList.contains("llg-camina")).toBe(false);
    expect(poseDibujada()).toBe("espera");
    expect(llg()?.dataset.pose).toBe("espera");
  });

  it("la misma pose no vuelve a dibujar la llama: repintar la pantalla no reinicia sus movimientos", () => {
    acompanar(c(), paso2);
    const svg = c().querySelector(".llg-svg");
    acompanar(c(), { ...paso2, linea: "Otra línea." });
    expect(c().querySelector(".llg-svg")).toBe(svg);
    expect(llg()?.classList.contains("llg-camina")).toBe(false);
  });

  it("con null se va, y lo demás del cuerpo queda", () => {
    acompanar(c(), paso2);
    acompanar(c(), null);
    expect(llg()).toBeNull();
    expect(c().querySelector(".dato")).not.toBeNull();
    expect(() => acompanar(c(), null)).not.toThrow();
  });

  it("si la ventana rehace su cuerpo, la misma llama vuelve arriba sin armarse de nuevo", () => {
    acompanar(c(), paso2);
    const antes = llg();
    c().innerHTML = '<h3>Tu carnet y tu cara</h3><p class="dato">Otra</p>';
    acompanar(c(), { ...paso2, avance: 0.5 });
    expect(llg()).toBe(antes);
    expect(c().children[1]).toBe(antes);
  });
});

describe("el camino", () => {
  it("una parada por tramo, las alcanzadas en magenta, la llama en su lugar y la bandera al final", () => {
    acompanar(c(), paso2);
    const paradas = [...c().querySelectorAll<HTMLElement>(".llg-parada")];
    expect(paradas).toHaveLength(4);
    expect(paradas.map((p) => p.classList.contains("hecha"))).toEqual([true, true, false, false]);
    expect(paradas.map((p) => p.style.getPropertyValue("--x"))).toEqual(["0", "0.25", "0.5", "0.75"]);
    expect(llg()?.style.getPropertyValue("--x")).toBe("0.3125");
    expect(c().querySelector(".llg-bandera")).not.toBeNull();
    expect(llg()?.classList.contains("sin-camino")).toBe(false);
  });

  it("sin paso no hay camino: solo la llama y el globo, y nada que anuncie un avance", () => {
    acompanar(c(), { pose: "saluda", linea: "Cargá con el QR de tu banco." });
    expect(llg()?.classList.contains("sin-camino")).toBe(true);
    expect(barra()).toBeNull();
    expect(c().querySelectorAll(".llg-parada")).toHaveLength(0);
    expect(globo()?.textContent).toBe("Cargá con el QR de tu banco.");
  });

  it("una falla se queda donde estaba: no avanza ni vuelve, y se preocupa", () => {
    acompanar(c(), { ...paso2, paso: 3, avance: 0.5 });
    vi.advanceTimersByTime(CAMINAR_MS);
    acompanar(c(), { pose: "preocupa", linea: "Tu dinero está a salvo.", quedarse: true });
    expect(barra()?.getAttribute("aria-valuenow")).toBe("3");
    expect(llg()?.style.getPropertyValue("--x")).toBe("0.625");
    expect(llg()?.classList.contains("llg-camina")).toBe(false);
    expect(poseDibujada()).toBe("preocupa");
  });

  it("quedarse sin un lugar de antes no inventa un camino", () => {
    acompanar(c(), { pose: "espera", linea: "Preparando tu compra.", quedarse: true });
    expect(llg()?.classList.contains("sin-camino")).toBe(true);
    expect(barra()).toBeNull();
  });
});

describe("el festejo", () => {
  it("tira el papel picado una sola vez por montaje, no cada vez que la pantalla se repinta", () => {
    const listo: Acompanamiento = { pose: "festeja", linea: "Ya tenés tus 3 sorteos oficiales.", paso: 4, total: 4, avance: 1 };
    acompanar(c(), listo);
    expect(c().querySelectorAll(".llg-papel")).toHaveLength(1);
    expect(llg()?.classList.contains("llg-entra")).toBe(true);
    vi.advanceTimersByTime(Math.max(PAPEL_MS, ENTRADA_MS));
    expect(c().querySelector(".llg-papel")).toBeNull();
    expect(llg()?.classList.contains("llg-entra")).toBe(false);
    acompanar(c(), { ...listo, linea: "Otra vez." });
    acompanar(c(), { ...listo, pose: "anima" });
    acompanar(c(), listo);
    expect(c().querySelector(".llg-papel")).toBeNull();
    // Un montaje nuevo festeja de nuevo.
    acompanar(c(), null);
    acompanar(c(), listo);
    expect(c().querySelectorAll(".llg-papel")).toHaveLength(1);
  });

  it("si llega caminando, primero camina y después festeja", () => {
    acompanar(c(), { ...paso2, paso: 4, avance: 0.9 });
    acompanar(c(), { pose: "festeja", linea: "Listo.", paso: 4, total: 4, avance: 1 });
    expect(c().querySelector(".llg-papel")).toBeNull();
    expect(poseDibujada()).toBe("anima");
    vi.advanceTimersByTime(CAMINAR_MS);
    expect(poseDibujada()).toBe("festeja");
    expect(c().querySelectorAll(".llg-papel")).toHaveLength(1);
  });
});

describe("con menos movimiento", () => {
  beforeEach(() => {
    reducido = true;
  });

  it("no camina, no salta y no tira papel: la pose de la pantalla, quieta", () => {
    acompanar(c(), paso2);
    acompanar(c(), { ...paso2, paso: 3, avance: 0.5 });
    expect(llg()?.classList.contains("llg-camina")).toBe(false);
    expect(poseDibujada()).toBe("anima");
    expect(llg()?.style.getPropertyValue("--x")).toBe("0.625");
    acompanar(c(), { pose: "festeja", linea: "Listo.", paso: 4, total: 4, avance: 1 });
    expect(poseDibujada()).toBe("festeja");
    expect(c().querySelector(".llg-papel")).toBeNull();
    expect(llg()?.classList.contains("llg-entra")).toBe(false);
    expect(llg()?.hasAttribute("data-quieta")).toBe(true);
  });

  it("la hoja de estilos apaga todo movimiento con prefers-reduced-motion", () => {
    const css = readFileSync(resolve(__dirname, "llama-guia.css"), "utf8");
    const bloque = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(bloque.length).toBeGreaterThan(0);
    expect(bloque).toMatch(/animation:\s*none\s*!important/);
    expect(bloque).toMatch(/transition:\s*none\s*!important/);
    expect(css).toMatch(/\[data-quieta\][^{]*\{[^}]*animation:\s*none/);
  });
});

describe("con lector de pantalla", () => {
  it("el avance es una barra de progreso que dice el paso y el tramo", () => {
    acompanar(c(), paso2);
    const b = barra();
    expect(b?.getAttribute("aria-valuemin")).toBe("1");
    expect(b?.getAttribute("aria-valuemax")).toBe("4");
    expect(b?.getAttribute("aria-valuenow")).toBe("2");
    expect(b?.getAttribute("aria-valuetext")).toBe("Paso 2 de 4: Tu identidad");
    expect(b?.getAttribute("aria-label")).toBe("Tu avance");
    // A la vista también dice el tramo: Paso 3 de 4 solo no decía de qué.
    expect(b?.textContent).toBe("Paso 2 de 4: Tu identidad");
  });

  it("sin el nombre del tramo, dice solo el paso", () => {
    acompanar(c(), { pose: "anima", linea: "Seguimos.", paso: 1, total: 2 });
    expect(barra()?.getAttribute("aria-valuetext")).toBe("Paso 1 de 2");
  });

  it("la llama y el camino son decorativos, el globo se lee en su orden y nada se anuncia solo", () => {
    acompanar(c(), paso2);
    expect(c().querySelector(".llg-camino")?.getAttribute("aria-hidden")).toBe("true");
    expect(c().querySelector(".llg-svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(globo()?.tagName).toBe("P");
    expect(llg()?.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
    expect(llg()?.hasAttribute("aria-live")).toBe(false);
    expect(llg()?.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
  });

  it("la línea es texto: nada de lo que trae se vuelve marcado", () => {
    acompanar(c(), { ...paso2, linea: '<b onclick="x()">Hola</b>' });
    expect(globo()?.textContent).toBe('<b onclick="x()">Hola</b>');
    expect(globo()?.querySelector("b")).toBeNull();
  });
});

describe("en las dos lenguas", () => {
  it("en inglés el paso, el tramo y el nombre de la barra", () => {
    setLang("en");
    acompanar(c(), { ...enPantalla("compra", "CQ-ID"), linea: "Another tab opens." });
    expect(barra()?.textContent).toBe("Step 2 of 4: Your identity");
    expect(barra()?.getAttribute("aria-valuetext")).toBe("Step 2 of 4: Your identity");
    expect(barra()?.getAttribute("aria-label")).toBe("Your progress");
  });

  it("en español los nombres de los tramos de cada recorrido", () => {
    expect(enPantalla("compra", "CQ-ID").tramos).toEqual(TRAMOS_ES);
    expect(enPantalla("compraSiguiente", "CQ-QR").tramos).toEqual(["Tu pago", "En camino"]);
    expect(enPantalla("carga", "M1").tramos).toEqual(["Tu identidad", "Cuánto", "Tu pago", "En camino"]);
    expect(enPantalla("cargaVerificada", "M1").tramos).toEqual(["Cuánto", "Tu pago", "En camino"]);
    setLang("en");
    expect(enPantalla("carga", "M1").tramos).toEqual(["Your identity", "How much", "Your payment", "On its way"]);
  });
});

describe("enPantalla: la pantalla dice dónde va la llama", () => {
  it("una pantalla del camino trae la pose, el paso, el avance y los tramos", () => {
    expect(enPantalla("compra", "CQ-ID")).toEqual({ pose: "anima", paso: 2, total: 4, avance: 0.25, tramos: TRAMOS_ES });
  });

  it("una falla pide quedarse, y la primera pantalla de la carga saluda sin camino", () => {
    expect(enPantalla("compra", "CQ-FALLO")).toEqual({ pose: "preocupa", quedarse: true });
    expect(enPantalla("carga", "C1")).toEqual({ pose: "saluda" });
  });

  it("cada pantalla de la compra y de la carga se acompaña con una llamada", () => {
    for (const p of PANTALLAS_DE_COMPRA) {
      acompanar(c(), { ...enPantalla("compra", p), linea: p });
      expect(globo()?.textContent).toBe(p);
    }
    acompanar(c(), null);
    for (const p of PANTALLAS_DE_CARGA) {
      acompanar(c(), { ...enPantalla("carga", p), linea: p });
      expect(globo()?.textContent).toBe(p);
    }
    vi.advanceTimersByTime(CAMINAR_MS + PAPEL_MS);
    expect(c().querySelectorAll(".llg")).toHaveLength(1);
  });
});
