// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearFilaViva } from "./fila-viva";

const css = readFileSync("src/styles.css", "utf8");

let el: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement("div");
  document.body.append(el);
});
afterEach(() => {
  vi.useRealTimers();
  el.remove();
});

describe("la fila viva", () => {
  it("revisando: la ruedita de siempre y el texto, y es un aviso que se anuncia con cortesía", () => {
    const f = crearFilaViva(el);
    f.revisando("Esperando tu envío");
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.classList.contains("fv-revisando")).toBe(true);
    expect(el.querySelector(".fv-ico")?.classList.contains("cc-gira")).toBe(true);
    expect(el.querySelector(".fv-ico")?.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector(".fv-texto")?.textContent).toBe("Esperando tu envío");
    expect(f.estado()).toBe("revisando");
  });

  it("llegó: el tilde y el texto, sin ruedita", () => {
    const f = crearFilaViva(el);
    f.revisando("Esperando");
    f.llego("Llegaron 1,50 dólares digitales");
    expect(el.classList.contains("fv-llego")).toBe(true);
    expect(el.classList.contains("fv-revisando")).toBe(false);
    expect(el.querySelector(".cc-gira")).toBeNull();
    expect(el.querySelector(".fv-ico")?.textContent).toBe("");
    expect(el.textContent).toBe("Llegaron 1,50 dólares digitales");
    expect(el.querySelector(".fv-texto")?.textContent).toBe("Llegaron 1,50 dólares digitales");
  });

  it("no salió: la marca de aviso y el texto", () => {
    const f = crearFilaViva(el);
    f.noSalio("Sin conexión");
    expect(el.classList.contains("fv-no-salio")).toBe(true);
    expect(el.textContent).toBe("Sin conexión");
  });

  it("lo que no cambió no se reescribe, para que el lector de pantalla lo diga una sola vez", () => {
    const f = crearFilaViva(el);
    f.revisando("Mirando");
    const texto = el.querySelector(".fv-texto");
    f.revisando("Mirando");
    expect(el.querySelector(".fv-texto")).toBe(texto);
    f.revisando("Mirando otra cosa");
    expect(el.querySelector(".fv-texto")).not.toBe(texto);
  });

  it("limpiar deja el contenedor vacío", () => {
    const f = crearFilaViva(el);
    f.llego("Listo");
    f.limpiar();
    expect(el.childNodes.length).toBe(0);
    expect(f.estado()).toBeNull();
    expect(el.classList.contains("fv-llego")).toBe(false);
  });

  it("sin movimiento reducido no hay reloj de «hace N s»", () => {
    const f = crearFilaViva(el, { hace: (n) => `Mirado hace ${n} s`, reducido: () => false });
    f.revisando("Mirando");
    f.mirada();
    vi.advanceTimersByTime(5000);
    expect(el.querySelector(".fv-hace")?.textContent).toBe("");
  });

  it("con movimiento reducido dice cuándo se miró por última vez y lo actualiza cada segundo", () => {
    const f = crearFilaViva(el, { hace: (n) => `Mirado hace ${n} s`, reducido: () => true });
    f.revisando("Mirando");
    expect(el.querySelector(".fv-hace")?.textContent).toBe("");
    f.mirada();
    expect(el.querySelector(".fv-hace")?.textContent).toBe("Mirado hace 0 s");
    vi.advanceTimersByTime(4000);
    expect(el.querySelector(".fv-hace")?.textContent).toBe("Mirado hace 4 s");
    f.mirada();
    expect(el.querySelector(".fv-hace")?.textContent).toBe("Mirado hace 0 s");
  });

  it("el «hace N s» va escondido de los lectores de pantalla y se apaga al llegar", () => {
    const f = crearFilaViva(el, { hace: (n) => `Mirado hace ${n} s`, reducido: () => true });
    f.revisando("Mirando");
    f.mirada();
    expect(el.querySelector(".fv-hace")?.getAttribute("aria-hidden")).toBe("true");
    f.llego("Listo");
    expect(el.querySelector(".fv-hace")?.textContent).toBe("");
    // Ya no queda un reloj corriendo.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("detener frena el reloj", () => {
    const f = crearFilaViva(el, { hace: (n) => `${n}`, reducido: () => true });
    f.revisando("Mirando");
    expect(vi.getTimerCount()).toBe(1);
    f.detener();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("el estilo de la fila viva", () => {
  it("usa la ruedita de siempre y con movimiento reducido el tilde no salta", () => {
    expect(css).toMatch(/\.fila-viva\.fv-llego \.fv-ico \{ background: var\(--teal\); animation: fv-pop/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fila-viva\.fv-llego \.fv-ico \{ animation: none; \}/);
  });
  it("el tilde y la marca de aviso los dibuja el estilo, no el texto", () => {
    expect(css).toContain('.fila-viva.fv-llego .fv-ico::before { content: "\\2713"; }');
    expect(css).toContain('.fila-viva.fv-no-salio .fv-ico::before { content: "!"; }');
  });
  it("sin nada adentro no se ve", () => {
    expect(css).toMatch(/\.fila-viva:empty \{ display: none; \}/);
  });
});
