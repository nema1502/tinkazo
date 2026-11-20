// @vitest-environment jsdom
/** Pruebas de las filas de pedidos y de su lectura segura de direcciones. */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import { cuentaDeRed, pintarHola } from "./adentro";
import type { DepsDelCelular } from "./celular";
import { depsDeDemostracion } from "./demostracion";
import { campanaDeEjemplo } from "./ejemplo";
import type { Campana } from "./modelo";
import { TEXTOS_CAMPANA } from "./textos";

const AHORA = Date.UTC(2026, 10, 21, 18);
usarTextos(TEXTOS_CAMPANA);

function preparar(pasos: Campana["pasos"]): { raiz: HTMLElement; deps: DepsDelCelular } {
  const html = readFileSync("participar.html", "utf8");
  document.body.innerHTML = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
  setLang("es");
  const campana = { ...campanaDeEjemplo(AHORA), pasos };
  const base = {
    tx: texto,
    idioma: getLang,
    enApp: false,
    ahora: () => AHORA,
    cada: () => () => undefined,
    visible: () => true,
    alVolver: () => () => undefined,
    vibrar: () => undefined,
    movimientoReducido: () => false,
  };
  const deps = depsDeDemostracion(base, campana, "hola");
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  return { raiz, deps };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("la cuenta visible de una red", () => {
  it.each([
    ["https://www.instagram.com/alguien/", "instagram", "alguien"],
    ["https://www.tiktok.com/@alguien", "tiktok", "alguien"],
    ["https://x.com/", "x", null],
    ["https://www.youtube.com/@alguien", "youtube", null],
  ] as const)("lee %s sin inventar cuentas para otras redes", (url, tipo, esperada) => {
    expect(cuentaDeRed(url, tipo)).toBe(esperada);
  });
});

describe("el saludo y el nombre abreviado", () => {
  it.each([
    ["es", "Hola, Ana P.", "Así salís en la pantalla del stand."],
    ["en", "Hi, Ana P.", "This is how you show up on the booth screen."],
  ] as const)("dice el nombre una sola vez y no deja dos puntos seguidos en %s", (idioma, saludo, frase) => {
    const { raiz, deps } = preparar([]);
    setLang(idioma);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const hero = raiz.querySelector(".cmp-hero") as HTMLElement;
    expect(hero.querySelector("h1")?.textContent).toBe(saludo);
    expect(hero.querySelector(".cmp-apoyo")?.textContent).toBe(frase);
    expect(raiz.querySelector("#cmp-hola")?.textContent).not.toContain("..");
  });

  it("cambiar de cuenta es un enlace dentro del bloque de arriba y la barra solo lleva el botón", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const enlace = raiz.querySelector<HTMLButtonElement>(".cmp-hero > .cmp-otra-cuenta");
    expect(enlace?.textContent).toBe("No soy Ana P.");
    expect(raiz.querySelectorAll(".cmp-accion button")).toHaveLength(1);
    expect(raiz.querySelector(".cmp-accion .primary")?.textContent).toBe("Acepto y me anoto");
  });

  it.each(["solo-google", "sesion"] as const)(
    "con el error %s el botón principal cambia de cuenta y ya no dice Acepto",
    (motivo) => {
      const { raiz, deps } = preparar([]);
      let salidas = 0;
      pintarHola(raiz, deps, { nombre: "Ana P.", error: motivo }, {
        alAnotar: () => undefined,
        alSalir: () => {
          salidas += 1;
        },
      });
      const principal = raiz.querySelectorAll(".cmp-accion .primary");
      expect(principal).toHaveLength(1);
      expect(principal[0]?.textContent).toBe("Usar otra cuenta");
      expect(raiz.querySelector(".cmp-accion")?.textContent).not.toContain("Acepto y me anoto");
      expect(raiz.querySelector(".cmp-otra-cuenta")).toBeNull();
      expect(raiz.querySelectorAll(".cmp-accion .cmp-error")).toHaveLength(1);
      raiz.querySelector<HTMLButtonElement>(".cmp-accion .primary")?.click();
      expect(salidas).toBe(1);
    },
  );

  it("con otro error el botón principal sigue siendo Acepto y el enlace de cambiar de cuenta sigue arriba", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: "red" });
    expect(raiz.querySelector(".cmp-accion .primary")?.textContent).toBe("Acepto y me anoto");
    expect(raiz.querySelector(".cmp-hero > .cmp-otra-cuenta")).not.toBeNull();
  });

  it("las reglas de esta pantalla no llevan la línea del correo", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    expect(raiz.querySelector(".cmp-reglas")?.textContent).not.toContain("por correo");
  });

  it("sin nombre ofrece usar otra cuenta", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: null, error: null });
    expect(raiz.querySelector(".cmp-otra-cuenta")?.textContent).toBe("Usar otra cuenta");
  });

  it("los pedidos van debajo de su título y sin una nota aparte: la aclaración vive en las reglas", () => {
    const { raiz, deps } = preparar([{ tipo: "x", url: "https://x.com/alguien", texto: { es: "", en: "" } }]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const der = raiz.querySelector(".cmp-der") as HTMLElement;
    const hijos = [...der.children].map((hijo) => hijo.tagName + "." + hijo.className);
    expect(hijos).toEqual(["H2.", "DIV.cmp-pasos"]);
    expect(raiz.querySelector(".cmp-reglas")?.textContent).toContain("Es un pedido. No cambia quién gana.");
  });

  it("con tres pedidos Hola no pasa de 40 palabras fuera de las reglas", () => {
    const pasos: Campana["pasos"] = ["instagram", "tiktok", "x"].map((tipo) => ({
      tipo: tipo as "instagram" | "tiktok" | "x",
      url: `https://${tipo}.example.org/alguien`,
      texto: { es: "", en: "" },
    }));
    const { raiz, deps } = preparar(pasos);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const copia = raiz.cloneNode(true) as HTMLElement;
    copia.querySelector(".cmp-reglas")?.remove();
    const palabras = (copia.textContent ?? "").trim().split(/\s+/u).filter(Boolean);
    expect(palabras.length).toBeLessThanOrEqual(40);
  });

  it("con más de tres pedidos deja tres a la vista y pliega el resto con su cuenta", () => {
    const pasos: Campana["pasos"] = Array.from({ length: 5 }, (_, i) => ({
      tipo: "enlace" as const,
      url: `https://sitio.example.org/${i}`,
      texto: { es: "", en: "" },
    }));
    const { raiz, deps } = preparar(pasos);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const der = raiz.querySelector(".cmp-der") as HTMLElement;
    expect(der.querySelectorAll(":scope > .cmp-pasos > .cmp-paso")).toHaveLength(3);
    const mas = der.querySelector<HTMLDetailsElement>(".cmp-mas-pedidos");
    expect(mas?.open).toBe(false);
    expect(mas?.querySelector("summary")?.textContent).toBe("Ver 2 más");
    expect(mas?.querySelectorAll(".cmp-paso")).toHaveLength(2);
  });

  it("con tres pedidos o menos no hay nada plegado", () => {
    const pasos: Campana["pasos"] = Array.from({ length: 3 }, (_, i) => ({
      tipo: "enlace" as const,
      url: `https://sitio.example.org/${i}`,
      texto: { es: "", en: "" },
    }));
    const { raiz, deps } = preparar(pasos);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    expect(raiz.querySelector(".cmp-mas-pedidos")).toBeNull();
  });
});

describe("las filas de los pedidos", () => {
  it("dice Abrir en una fila que no se tocó y Listo después de tocarla", () => {
    const pasos: Campana["pasos"] = [{ tipo: "x", url: "https://x.com/alguien", texto: { es: "", en: "" } }];
    const { raiz, deps } = preparar(pasos);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const listo = raiz.querySelector<HTMLElement>(".cmp-listo") as HTMLElement;
    expect(listo.textContent).toBe("Abrir");
    expect(listo.classList.contains("cmp-hecho")).toBe(false);
    raiz.querySelector<HTMLAnchorElement>("a.cmp-paso")?.addEventListener("click", (e) => e.preventDefault());
    raiz.querySelector<HTMLAnchorElement>("a.cmp-paso")?.click();
    expect(listo.textContent).toBe("✓ Listo");
    expect(listo.classList.contains("cmp-hecho")).toBe(true);
  });

  it("no dice Abrir en una fila sin dirección", () => {
    const pasos: Campana["pasos"] = [{ tipo: "whatsapp", url: null, texto: { es: "", en: "" } }];
    const { raiz, deps } = preparar(pasos);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    expect(raiz.querySelector<HTMLElement>(".cmp-listo")?.hidden).toBe(true);
  });

  it("usa texto sin enlace solo para el pedido escrito y abre Instagram de forma segura", () => {
    const pasos: Campana["pasos"] = [
      { tipo: "texto", url: null, texto: { es: "Leé el cartel", en: "Read the sign" } },
      {
        tipo: "instagram",
        url: "https://www.instagram.com/alguien/",
        texto: { es: "Un texto distinto", en: "Different text" },
      },
    ];
    const { raiz, deps } = preparar(pasos);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    const filas = raiz.querySelectorAll(".cmp-paso");
    expect(filas[0]?.tagName).toBe("DIV");
    expect(filas[0]?.textContent).toBe("Leé el cartel");
    const instagram = filas[1] as HTMLAnchorElement;
    expect(instagram.tagName).toBe("A");
    expect(instagram.target).toBe("_blank");
    expect(instagram.rel).toBe("noopener noreferrer");
    expect(instagram.textContent).toContain("Seguir en Instagram");
    expect(instagram.textContent).toContain("@alguien");
    expect(instagram.textContent).not.toContain("Un texto distinto");
  });

  it("recuerda el tilde al volver sin convertir el pedido en un requisito", () => {
    const pasos: Campana["pasos"] = [{
      tipo: "x",
      url: "https://x.com/alguien",
      texto: { es: "Otro texto", en: "Other text" },
    }];
    const primero = preparar(pasos);
    pintarHola(primero.raiz, primero.deps, { nombre: null, error: null });
    primero.raiz.querySelector<HTMLAnchorElement>("a.cmp-paso")?.click();
    expect(sessionStorage.getItem("tinkazo.campana.evento-ejemplo.0")).toBe("1");
    const segundo = preparar(pasos);
    pintarHola(segundo.raiz, segundo.deps, { nombre: null, error: null });
    const listo = segundo.raiz.querySelector<HTMLElement>(".cmp-listo");
    expect(listo?.hidden).toBe(false);
    expect(listo?.textContent).toContain("Listo");
    expect(segundo.raiz.querySelector(".primary")?.textContent).toBe("Acepto y me anoto");
  });
});
