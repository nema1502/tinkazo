// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { conservarVistaEnLaCabecera, soloParametrosDeVista } from "./enlaces-cabecera";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

describe("soloParametrosDeVista", () => {
  it("acepta lang y theme, solos o juntos", () => {
    expect(soloParametrosDeVista("?lang=en")).toBe(true);
    expect(soloParametrosDeVista("?theme=dark")).toBe(true);
    expect(soloParametrosDeVista("?lang=en&theme=dark")).toBe(true);
  });

  it("sin parámetros da falso", () => {
    expect(soloParametrosDeVista("")).toBe(false);
  });

  it("con la demo, el stand o algo más da falso", () => {
    expect(soloParametrosDeVista("?demo=race")).toBe(false);
    expect(soloParametrosDeVista("?stand")).toBe(false);
    expect(soloParametrosDeVista("?lang=en&demo=race")).toBe(false);
  });
});

describe("conservarVistaEnLaCabecera", () => {
  it("con ?theme=dark, tocar Sortear conserva el parámetro y cambia el hash", () => {
    history.replaceState(null, "", "/?theme=dark");
    document.body.innerHTML = '<header><a href="/#sortear">Sortear</a></header>';
    conservarVistaEnLaCabecera();
    const a = document.querySelector<HTMLAnchorElement>("header a") as HTMLAnchorElement;
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(true);
    expect(location.search).toBe("?theme=dark");
    expect(location.hash).toBe("#sortear");
  });

  it("sin parámetros no se previene", () => {
    history.replaceState(null, "", "/");
    document.body.innerHTML = '<header><a href="/#sortear">Sortear</a></header>';
    conservarVistaEnLaCabecera();
    const a = document.querySelector<HTMLAnchorElement>("header a") as HTMLAnchorElement;
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(false);
  });

  const aperturas: Array<[string, MouseEventInit]> = [
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["el botón del medio", { button: 1 }],
  ];

  it.each(aperturas)("con %s el navegador maneja el enlace", (_nombre, opciones) => {
    history.replaceState(null, "", "/?theme=dark");
    document.body.innerHTML = '<header><a href="/#sortear">Sortear</a></header>';
    conservarVistaEnLaCabecera();
    const a = document.querySelector<HTMLAnchorElement>("header a") as HTMLAnchorElement;
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true, ...opciones });

    a.dispatchEvent(clic);

    expect(clic.defaultPrevented).toBe(false);
    expect(location.hash).toBe("");
  });

  it("un clic ya prevenido no se vuelve a manejar", () => {
    history.replaceState(null, "", "/?theme=dark");
    document.body.innerHTML = '<header><a href="/#sortear">Sortear</a></header>';
    const a = document.querySelector<HTMLAnchorElement>("header a") as HTMLAnchorElement;
    a.addEventListener("click", (e) => e.preventDefault());
    conservarVistaEnLaCabecera();
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });

    a.dispatchEvent(clic);

    expect(location.hash).toBe("");
  });
});
