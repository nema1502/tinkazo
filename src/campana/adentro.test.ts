// @vitest-environment jsdom
/** Pruebas de las filas de pedidos y de su lectura segura de direcciones. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import { REVISION_DE_LA_SENAL_MS, SIN_RESPUESTA_MS, actualizarElContador, cuentaDeRed, latirAlDia, pintarAdentro, pintarHola } from "./adentro";
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

describe("Anotando", () => {
  it("el botón apagado lleva la ruedita y se la saca al terminar", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null }, { alAnotar: () => undefined, alSalir: () => undefined, anotando: true });
    const boton = raiz.querySelector<HTMLButtonElement>(".cmp-accion .primary");
    expect(boton?.textContent).toBe("Anotando…");
    expect(boton?.disabled).toBe(true);
    expect(boton?.getAttribute("aria-busy")).toBe("true");
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null });
    expect(raiz.querySelector(".cmp-accion .primary")?.hasAttribute("aria-busy")).toBe(false);
  });
});

describe("la señal de que la espera está al día", () => {
  const DATOS = { ya: false, total: 37, fase: "abierta" as const, cierraMs: AHORA + 3_600_000 };
  let reloj = AHORA;
  let visible = true;
  let revisar: (() => void) | null = null;
  let cancelada = false;

  function montar(extra: Partial<Parameters<typeof pintarAdentro>[2]> = {}, movimientoReducido = false): { raiz: HTMLElement; deps: DepsDelCelular; limpiar: () => void } {
    const { raiz, deps } = preparar([]);
    const propias: DepsDelCelular = {
      ...deps,
      ahora: () => reloj,
      visible: () => visible,
      movimientoReducido: () => movimientoReducido,
      cada: (f, ms) => {
        expect(ms).toBe(REVISION_DE_LA_SENAL_MS);
        revisar = f;
        return () => {
          cancelada = true;
          revisar = null;
        };
      },
    };
    const limpiar = pintarAdentro(raiz, propias, { ...DATOS, ...extra });
    return { raiz, deps: propias, limpiar };
  }

  const senal = (raiz: HTMLElement): HTMLElement => raiz.querySelector<HTMLElement>("#cmp-adentro .cmp-al-dia") as HTMLElement;

  beforeEach(() => {
    reloj = AHORA;
    visible = true;
    revisar = null;
    cancelada = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debajo de las horas dice Al día, no se anuncia y no suma una segunda línea que se anuncie", () => {
    const { raiz } = montar();
    const der = raiz.querySelector("#cmp-adentro .cmp-der") as HTMLElement;
    const hijos = [...der.children].map((hijo) => hijo.className);
    expect(hijos.slice(0, 2)).toEqual(["cmp-horas", "cmp-al-dia"]);
    expect(senal(raiz).textContent).toBe("Al día");
    expect(senal(raiz).getAttribute("aria-hidden")).toBe("true");
    expect(raiz.querySelectorAll("#cmp-adentro [aria-live]")).toHaveLength(1);
  });

  it("en inglés dice Up to date", () => {
    const { raiz, deps } = montar();
    setLang("en");
    pintarAdentro(raiz, deps, DATOS);
    expect(senal(raiz).textContent).toBe("Up to date");
  });

  it("sin la hora de la última respuesta siempre dice Al día", () => {
    const { raiz } = montar();
    reloj += 10 * SIN_RESPUESTA_MS;
    revisar?.();
    expect(senal(raiz).dataset.estado).toBe("al-dia");
  });

  it("pasados 75 segundos sin respuesta buena y con la pestaña a la vista pasa a Buscando conexión", () => {
    const { raiz } = montar({ respuestaDesde: () => AHORA });
    reloj = AHORA + SIN_RESPUESTA_MS;
    revisar?.();
    expect(senal(raiz).dataset.estado).toBe("al-dia");
    reloj = AHORA + SIN_RESPUESTA_MS + 1;
    revisar?.();
    expect(senal(raiz).dataset.estado).toBe("buscando");
    expect(senal(raiz).textContent).toBe("Buscando conexión…");
  });

  it("con la pestaña escondida no cambia nada", () => {
    const { raiz } = montar({ respuestaDesde: () => AHORA });
    visible = false;
    reloj = AHORA + 10 * SIN_RESPUESTA_MS;
    revisar?.();
    expect(senal(raiz).dataset.estado).toBe("al-dia");
  });

  it("si nació con la respuesta ya vieja, nace buscando", () => {
    reloj = AHORA + 2 * SIN_RESPUESTA_MS;
    const { raiz } = montar({ respuestaDesde: () => AHORA });
    expect(senal(raiz).dataset.estado).toBe("buscando");
  });

  it("una respuesta buena la vuelve a Al día y hace latir el punto una vez", () => {
    vi.useFakeTimers();
    const { raiz, deps } = montar({ respuestaDesde: () => AHORA });
    reloj = AHORA + 2 * SIN_RESPUESTA_MS;
    revisar?.();
    expect(senal(raiz).dataset.estado).toBe("buscando");
    latirAlDia(raiz, deps);
    expect(senal(raiz).dataset.estado).toBe("al-dia");
    expect(senal(raiz).textContent).toBe("Al día");
    expect(senal(raiz).classList.contains("cmp-late")).toBe(true);
    vi.advanceTimersByTime(1_200);
    expect(senal(raiz).classList.contains("cmp-late")).toBe(false);
  });

  it("con movimiento reducido no late, pero sí vuelve a Al día", () => {
    const { raiz, deps } = montar({ respuestaDesde: () => AHORA }, true);
    reloj = AHORA + 2 * SIN_RESPUESTA_MS;
    revisar?.();
    latirAlDia(raiz, deps);
    expect(senal(raiz).dataset.estado).toBe("al-dia");
    expect(senal(raiz).classList.contains("cmp-late")).toBe(false);
  });

  it("la limpieza que devuelve apaga el reloj de la señal", () => {
    const { limpiar } = montar();
    expect(cancelada).toBe(false);
    limpiar();
    expect(cancelada).toBe(true);
  });

  it("sin la espera pintada, latir no hace nada ni falla", () => {
    const { raiz, deps } = preparar([]);
    expect(() => latirAlDia(raiz, deps)).not.toThrow();
  });
});

describe("el contador y la línea de fase de la espera", () => {
  const DATOS = { ya: false, total: 37, fase: "abierta" as const, cierraMs: AHORA + 3_600_000 };

  it("cambia el número en su lugar, con el singular, sin tocar el resto", () => {
    const { raiz, deps } = preparar([]);
    pintarAdentro(raiz, deps, DATOS);
    const titulo = raiz.querySelector("#cmp-adentro h1");
    const contador = raiz.querySelector("#cmp-adentro .cmp-contador") as HTMLElement;
    expect(actualizarElContador(raiz, deps, 41)).toBe(true);
    expect(raiz.querySelector("#cmp-adentro .cmp-numero")?.textContent).toBe("41");
    expect(contador.textContent).toBe("41 personas en la lista");
    expect(raiz.querySelector("#cmp-adentro .cmp-contador")).toBe(contador);
    expect(raiz.querySelector("#cmp-adentro h1")).toBe(titulo);
    actualizarElContador(raiz, deps, 1);
    expect(contador.textContent).toBe("1 persona en la lista");
  });

  it("sube una vez y, con movimiento reducido, no", () => {
    const { raiz, deps } = preparar([]);
    pintarAdentro(raiz, deps, DATOS);
    actualizarElContador(raiz, deps, 40);
    expect(raiz.querySelector(".cmp-contador")?.classList.contains("sube")).toBe(true);
    const quieto = preparar([]);
    const reducidos: DepsDelCelular = { ...quieto.deps, movimientoReducido: () => true };
    pintarAdentro(quieto.raiz, reducidos, DATOS);
    actualizarElContador(quieto.raiz, reducidos, 40);
    expect(quieto.raiz.querySelector(".cmp-contador")?.classList.contains("sube")).toBe(false);
  });

  it("sin la espera pintada no hay contador", () => {
    const { raiz, deps } = preparar([]);
    expect(actualizarElContador(raiz, deps, 3)).toBe(false);
  });

  it("la línea de fase salta solo cuando se pide y no con movimiento reducido", () => {
    const una = preparar([]);
    pintarAdentro(una.raiz, una.deps, { ...DATOS, salta: true });
    expect(una.raiz.querySelector("#cmp-fase")?.classList.contains("cmp-salta")).toBe(true);
    const otra = preparar([]);
    pintarAdentro(otra.raiz, otra.deps, DATOS);
    expect(otra.raiz.querySelector("#cmp-fase")?.classList.contains("cmp-salta")).toBe(false);
    const quieta = preparar([]);
    pintarAdentro(quieta.raiz, { ...quieta.deps, movimientoReducido: () => true }, { ...DATOS, salta: true });
    expect(quieta.raiz.querySelector("#cmp-fase")?.classList.contains("cmp-salta")).toBe(false);
  });

  it("la línea de apoyo es la de siempre y, para quien no tiene nada que hacer, la libre", () => {
    const { raiz, deps } = preparar([]);
    pintarAdentro(raiz, deps, DATOS);
    expect(raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
    pintarAdentro(raiz, deps, { ...DATOS, libre: true });
    expect(raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent).toBe(TEXTOS_CAMPANA.es.cpDejaAbiertaLibre);
  });
});

describe("una cuenta usada en otro navegador", () => {
  it("Hola pone el aviso arriba del saludo, con role status, y deja Acepto como principal si el botón todavía no cambió", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null, otroLado: { principal: false } });
    const hero = raiz.querySelector(".cmp-hero") as HTMLElement;
    const aviso = hero.querySelector<HTMLElement>(".cmp-otro-lado");
    expect(aviso?.getAttribute("role")).toBe("status");
    expect(aviso?.querySelector(".cmp-otro-lado-t")?.textContent).toBe(TEXTOS_CAMPANA.es.cpOtroLadoT);
    expect(aviso?.textContent).toContain(TEXTOS_CAMPANA.es.cpOtroLado);
    // Arriba de todo: antes del título.
    expect(hero.firstElementChild).toBe(aviso);
    expect(raiz.querySelector(".cmp-accion .primary")?.textContent).toBe("Acepto y me anoto");
    expect(raiz.querySelector(".cmp-anotarme-igual")).toBeNull();
    expect(raiz.querySelector(".cmp-hero > .cmp-otra-cuenta")).not.toBeNull();
  });

  it("con el botón cambiado la principal es Usar otra cuenta y Acepto y me anoto igual queda debajo, sin ser principal", () => {
    const { raiz, deps } = preparar([]);
    const alSalir = vi.fn();
    const alAnotarIgual = vi.fn();
    const alAnotar = vi.fn();
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null, otroLado: { principal: true } }, { alAnotar, alAnotarIgual, alSalir });
    const principales = raiz.querySelectorAll(".primary");
    expect(principales).toHaveLength(1);
    expect(principales[0]?.textContent).toBe("Usar otra cuenta");
    const igual = raiz.querySelector<HTMLButtonElement>(".cmp-accion .cmp-anotarme-igual");
    expect(igual?.textContent).toBe("Acepto y me anoto igual");
    // El enlace chico de arriba sobra: cambiar de cuenta ya es la principal.
    expect(raiz.querySelector(".cmp-hero > .cmp-otra-cuenta")).toBeNull();
    (principales[0] as HTMLButtonElement).click();
    igual?.click();
    expect(alSalir).toHaveBeenCalledTimes(1);
    expect(alAnotarIgual).toHaveBeenCalledTimes(1);
    expect(alAnotar).not.toHaveBeenCalled();
  });

  it("en inglés el aviso y los botones están traducidos", () => {
    const { raiz, deps } = preparar([]);
    setLang("en");
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null, otroLado: { principal: true } });
    expect(raiz.querySelector(".cmp-otro-lado-t")?.textContent).toBe(TEXTOS_CAMPANA.en.cpOtroLadoT);
    expect(raiz.querySelector(".cmp-anotarme-igual")?.textContent).toBe(TEXTOS_CAMPANA.en.cpAnotarmeIgual);
  });

  it("sin aviso Hola queda como siempre", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: null, otroLado: null });
    expect(raiz.querySelector(".cmp-otro-lado")).toBeNull();
    expect(raiz.querySelector(".cmp-anotarme-igual")).toBeNull();
    expect(raiz.querySelectorAll(".cmp-accion button")).toHaveLength(1);
  });

  it("una cuenta que no sirve para el sorteo no ofrece anotarse igual", () => {
    const { raiz, deps } = preparar([]);
    pintarHola(raiz, deps, { nombre: "Ana P.", error: "solo-google", otroLado: { principal: true } });
    expect(raiz.querySelector(".cmp-anotarme-igual")).toBeNull();
    expect(raiz.querySelector(".cmp-accion .primary")?.textContent).toBe("Usar otra cuenta");
  });

  it("la espera dice que quizás haya que recibirlo en el otro navegador, y la línea del aviso gana a la libre", () => {
    const { raiz, deps } = preparar([]);
    pintarAdentro(raiz, deps, { ya: false, total: 3, fase: "abierta", cierraMs: AHORA + 3_600_000, otroLado: true, libre: true });
    expect(raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
    // Sigue sin botón: una espera sin acción principal.
    expect(raiz.querySelector("#cmp-adentro button")).toBeNull();
  });

  it("los textos nuevos están en español y en inglés", () => {
    for (const clave of ["cpOtroLadoT", "cpOtroLado", "cpAnotarmeIgual", "cpOtroLadoAdentro"] as const) {
      expect(TEXTOS_CAMPANA.es[clave], clave).toBeTruthy();
      expect(TEXTOS_CAMPANA.en[clave], clave).toBeTruthy();
    }
  });
});

describe("la espera con la tarjeta de confirmar el correo a la vista", () => {
  it("no pone su línea de apoyo (la dice la tarjeta) y deja las reglas en el pie, debajo de la tarjeta", () => {
    const { raiz, deps } = preparar([]);
    pintarAdentro(raiz, deps, { ya: false, total: 3, fase: "abierta", cierraMs: AHORA + 3_600_000, conTarjeta: true });
    expect(raiz.querySelector("#cmp-adentro .cmp-apoyo")).toBeNull();
    expect(raiz.querySelector("#cmp-adentro details")).toBeNull();
    const pie = raiz.querySelector<HTMLElement>("#cmp-pie");
    expect(pie?.hidden).toBe(false);
    expect(pie?.querySelectorAll("details")).toHaveLength(1);
    expect(pie?.querySelector("summary")?.textContent).toBe(TEXTOS_CAMPANA.es.cpReglas);
    // Sigue sin botón: la acción principal es la de la tarjeta, que vive en su propia sección.
    expect(raiz.querySelector("#cmp-adentro button")).toBeNull();
  });

  it("al repintar no duplica las reglas del pie", () => {
    const { raiz, deps } = preparar([]);
    const datos = { ya: false, total: 3, fase: "abierta" as const, cierraMs: AHORA + 3_600_000, conTarjeta: true };
    pintarAdentro(raiz, deps, datos);
    pintarAdentro(raiz, deps, { ...datos, total: 4 });
    expect(raiz.querySelectorAll("#cmp-pie details")).toHaveLength(1);
  });

  it("sin la tarjeta las reglas siguen dentro de la espera y el pie queda vacío", () => {
    const { raiz, deps } = preparar([]);
    pintarAdentro(raiz, deps, { ya: false, total: 3, fase: "abierta", cierraMs: AHORA + 3_600_000 });
    expect(raiz.querySelectorAll("#cmp-adentro details")).toHaveLength(1);
    expect(raiz.querySelector("#cmp-pie")?.children).toHaveLength(0);
    expect(raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")).not.toBeNull();
  });
});
