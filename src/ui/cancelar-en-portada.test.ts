// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { pintarCancelarEnPortada } from "./cancelar-en-portada";

/**
 * Cancelar en la portada mientras se termina de entrar con Google (16 de noviembre de 2026), con el markup de verdad.
 *
 * Con una cuenta nueva, terminar de entrar puede tardar hasta 50 segundos, y en la portada la puerta con su Cancelar no
 * se ve. Debajo de cada botón grande que entra va un Cancelar con forma de enlace. En el de arriba ocupa el renglón de
 * Otras formas de entrar, que mientras tanto no se ofrece, así la portada no cambia de alto y la cabecera no se toca.
 */

const html = readFileSync("index.html", "utf8");
const main = /<main>[\s\S]*<\/main>/.exec(html)?.[0] ?? "";

const hero = (): HTMLElement => document.querySelector(".hero-portada .hero-ctas") as HTMLElement;
const fin = (): HTMLElement => document.querySelector(".portada-fin .hero-ctas") as HTMLElement;
const otras = (): HTMLElement => document.querySelector("[data-otras-formas]") as HTMLElement;
const cancelares = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>("button[data-cancelar-entrada]")];

beforeEach(() => {
  document.body.innerHTML = main;
  setLang("es");
});

describe("Cancelar debajo del botón grande de la portada", () => {
  it("mientras se termina de entrar, aparece debajo de cada botón grande y cancela", () => {
    const cancelar = vi.fn();
    pintarCancelarEnPortada(document, { terminando: true, cancelar, tx: t });
    expect(cancelares()).toHaveLength(2);
    // Arriba, en el renglón de Otras formas de entrar, que no se ofrece mientras tanto.
    const arriba = hero().nextElementSibling as HTMLElement;
    expect(arriba.matches("p.hero-otras")).toBe(true);
    const deArriba = arriba.querySelector<HTMLButtonElement>("button[data-cancelar-entrada]");
    expect(deArriba?.textContent).toBe(t("cancel"));
    expect(otras().style.display).toBe("none");
    // Con forma de enlace, como Otras formas de entrar: subrayado, sin caja.
    expect(deArriba?.className).toBe("enlace");
    expect(deArriba?.type).toBe("button");
    // Al final, en un renglón propio.
    const abajo = fin().nextElementSibling as HTMLElement;
    expect(abajo.querySelector("button[data-cancelar-entrada]")?.textContent).toBe(t("cancel"));
    deArriba?.click();
    abajo.querySelector<HTMLButtonElement>("button[data-cancelar-entrada]")?.click();
    expect(cancelar).toHaveBeenCalledTimes(2);
  });

  it("al terminar todo vuelve a como estaba, y pintar dos veces no repite nada", () => {
    const antes = document.querySelector("main")?.textContent;
    const cancelar = vi.fn();
    pintarCancelarEnPortada(document, { terminando: true, cancelar, tx: t });
    pintarCancelarEnPortada(document, { terminando: true, cancelar, tx: t });
    expect(cancelares()).toHaveLength(2);
    pintarCancelarEnPortada(document, { terminando: false, cancelar, tx: t });
    expect(cancelares()).toHaveLength(0);
    expect(document.querySelectorAll("[data-cancelar-entrada]")).toHaveLength(0);
    expect(otras().style.display).toBe("");
    expect(document.querySelector("main")?.textContent).toBe(antes);
    // Sin una entrada en curso no agrega nada.
    pintarCancelarEnPortada(document, { terminando: false, cancelar, tx: t });
    expect(document.querySelectorAll("[data-cancelar-entrada]")).toHaveLength(0);
  });

  it("no toca Otras formas de entrar si ya estaba escondido por otra cosa", () => {
    otras().style.display = "none";
    pintarCancelarEnPortada(document, { terminando: true, cancelar: () => undefined, tx: t });
    pintarCancelarEnPortada(document, { terminando: false, cancelar: () => undefined, tx: t });
    expect(otras().style.display).toBe("none");
  });

  it("el botón del final de la demo no lleva Cancelar: ese no entra, lleva a la herramienta", () => {
    pintarCancelarEnPortada(document, { terminando: true, cancelar: () => undefined, tx: t });
    const demo = document.querySelector('a[data-cta-entrar][href="/#sortear"]')?.closest(".hero-ctas") as HTMLElement;
    expect(demo).not.toBeNull();
    expect(demo.parentElement?.querySelector("[data-cancelar-entrada]")).toBeNull();
  });

  it("si el foco estaba en el botón grande pasa a Cancelar, y al terminar vuelve al botón", () => {
    const cta = hero().querySelector<HTMLElement>("[data-cta-entrar]") as HTMLElement;
    cta.focus();
    pintarCancelarEnPortada(document, { terminando: true, cancelar: () => undefined, tx: t });
    const deArriba = (hero().nextElementSibling as HTMLElement).querySelector("button[data-cancelar-entrada]");
    expect(document.activeElement).toBe(deArriba);
    pintarCancelarEnPortada(document, { terminando: false, cancelar: () => undefined, tx: t });
    expect(document.activeElement).toBe(cta);
  });

  it("sin el foco en el botón grande no se lo mueve (en el celular el toque no deja foco)", () => {
    pintarCancelarEnPortada(document, { terminando: true, cancelar: () => undefined, tx: t });
    expect(document.activeElement).toBe(document.body);
  });

  it("en inglés dice Cancel, y cambia de idioma con la página", () => {
    setLang("en");
    pintarCancelarEnPortada(document, { terminando: true, cancelar: () => undefined, tx: t });
    expect(cancelares().map((b) => b.textContent)).toEqual(["Cancel", "Cancel"]);
    // Lleva su clave: al cambiar de idioma, la página lo traduce con todo lo demás.
    expect(cancelares().every((b) => b.dataset.i === "cancel")).toBe(true);
  });

  it("el botón grande de la portada lo pinta cada vez que cambia la cuenta, con el Cancelar de la puerta", () => {
    const codigo = readFileSync("src/main.ts", "utf8");
    expect(codigo).toMatch(/pintarCancelarEnPortada\(document, \{[^}]*cancelar: cancelarLaEntrada/);
  });
});
