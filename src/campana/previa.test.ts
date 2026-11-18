// @vitest-environment jsdom
/** Pruebas de las pantallas públicas con el marcado real de participar.html. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import type { DepsDelCelular, EstadoPublico, FallaDeEntrada } from "./celular";
import { depsDeDemostracion } from "./demostracion";
import { campanaDeEjemplo } from "./ejemplo";
import { pintarEstadoDeCarga, pintarLaCampana, pintarReglas, sustituir, type EstadoDeCarga } from "./previa";
import { TEXTOS_CAMPANA } from "./textos";

const html = readFileSync("participar.html", "utf8");
const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const AHORA = Date.UTC(2026, 10, 15, 18, 0);
usarTextos(TEXTOS_CAMPANA);

async function asentar(): Promise<void> {
  for (let vuelta = 0; vuelta < 10; vuelta += 1) await Promise.resolve();
}

function preparar(cambios: Partial<DepsDelCelular> = {}): {
  raiz: HTMLElement;
  deps: DepsDelCelular;
  publico: EstadoPublico;
} {
  document.body.innerHTML = main;
  setLang("es");
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const campana = campanaDeEjemplo(AHORA);
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
  const deps = { ...depsDeDemostracion(base, campana, null), ...cambios };
  const publico: EstadoPublico = {
    fase: "abierta",
    total: 37,
    cierraMs: campana.cierraMs,
    pase: "vale",
  };
  return { raiz, deps, publico };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("la campaña abierta", () => {
  it("muestra título, premio, contador, cierre y una sola acción principal", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, publico, () => undefined);
    expect(raiz.querySelector("h1")?.textContent).toBe("Sorteo de Alcancía Andina");
    expect(raiz.querySelector(".cmp-premio-etiqueta")?.textContent).toBe("Premio");
    expect(raiz.querySelector(".cmp-premio-texto")?.textContent).toBe("40 dólares digitales");
    expect(raiz.querySelector(".cmp-contador")?.textContent).toBe("37 personas ya se anotaron");
    expect(raiz.querySelector(".cmp-contador > .cmp-cifra")?.textContent).toBe("37");
    expect(raiz.querySelector(".cmp-cierre")?.textContent).toContain("Cierra a las 17:00.");
    expect(raiz.querySelectorAll("#cmp-saber .primary")).toHaveLength(1);
    expect(raiz.querySelector("#cmp-saber .primary")?.textContent).toBe("Entrar con Google");
    expect(raiz.querySelector(".cmp-contador")?.getAttribute("aria-live")).toBeNull();
  });

  it("dice que participar es gratis como rótulo del bloque del premio y no como una caja que parece botón", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, publico, () => undefined);
    const premio = raiz.querySelector(".cmp-premio") as HTMLElement;
    expect(premio.lastElementChild?.textContent).toBe("Participar es gratis");
    expect(premio.lastElementChild?.classList.contains("cmp-premio-etiqueta")).toBe(true);
    expect(raiz.querySelector(".cmp-gratis")).toBeNull();
    expect(raiz.querySelector(".cmp-der")?.textContent).not.toContain("Participar es gratis");
    expect(raiz.querySelector(".cmp-accion .cmp-apoyo")?.textContent).toBe("Te creamos una cuenta de Tinkazo.");
  });

  it("con varios premios el texto ya dice cuántos son, sin repetirlo, y achica la letra del premio largo", () => {
    const { raiz, deps, publico } = preparar();
    const campana = { ...deps.campana, premios: [400000000n, 400000000n, 400000000n] };
    pintarLaCampana(raiz, { ...deps, campana }, publico, () => undefined);
    expect(raiz.querySelector(".cmp-premio-texto")?.textContent).toBe("3 premios de 40 dólares digitales");
    expect(raiz.querySelector("#cmp-saber")?.textContent).not.toMatch(/Ganan 3/u);
    expect(raiz.querySelector(".cmp-premio-texto")?.classList.contains("cmp-largo")).toBe(true);
    pintarLaCampana(raiz, deps, publico, () => undefined);
    expect(raiz.querySelector(".cmp-premio-texto")?.classList.contains("cmp-largo")).toBe(false);
  });

  it("deja el bloque del premio a la izquierda y los datos, las reglas y la acción en orden", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, publico, () => undefined);
    const seccion = raiz.querySelector("#cmp-saber") as HTMLElement;
    const hijos = [...seccion.children].map((hijo) => hijo.className);
    expect(hijos).toEqual(["cmp-izq", "cmp-der", "cmp-reglas", "cmp-accion"]);
    expect(raiz.querySelector(".cmp-accion")?.lastElementChild?.classList.contains("primary")).toBe(true);
  });

  it("usa singular y la invitación cuando todavía no hay nadie", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, { ...publico, total: 0 }, () => undefined);
    expect(raiz.querySelector(".cmp-contador")?.textContent).toBe("Sé la primera persona en anotarte");
    pintarLaCampana(raiz, deps, { ...publico, total: 1 }, () => undefined);
    expect(raiz.querySelector(".cmp-contador")?.textContent).toBe("1 persona ya se anotó");
    expect(raiz.querySelector(".cmp-contador > .cmp-cifra")?.textContent).toBe("1");
    expect(raiz.querySelector(".cmp-contador")?.classList.contains("sube")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(raiz.querySelector(".cmp-contador")?.classList.contains("sube")).toBe(false);
  });

  it("en una app cambia la entrada por copiar el enlace", () => {
    const { raiz, deps, publico } = preparar({ enApp: true });
    pintarLaCampana(raiz, deps, publico, () => undefined);
    expect(raiz.querySelector(".cmp-en-app")?.textContent).toContain("abrí este enlace");
    expect(raiz.querySelector(".primary")?.textContent).toBe("Copiar el enlace");
    expect(raiz.querySelector("#cmp-saber")?.textContent).not.toContain("Entrar con Google");
  });

  it("mantiene el respaldo de copia en un solo campo de solo lectura", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("permiso")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { raiz, deps, publico } = preparar({ enApp: true });
    pintarLaCampana(raiz, deps, publico, () => undefined);
    const boton = raiz.querySelector<HTMLButtonElement>(".primary");
    boton?.click();
    await Promise.resolve();
    await Promise.resolve();
    boton?.click();
    await Promise.resolve();
    await Promise.resolve();
    const campos = raiz.querySelectorAll<HTMLInputElement>("input[data-cmp-copiar]");
    expect(campos).toHaveLength(1);
    expect(campos[0]?.readOnly).toBe(true);
    expect(campos[0]?.value).toContain("demo=campana");
  });

  it("avisa a los seis segundos si Google sigue abierto y entrega la sesión", async () => {
    let resolver: ((valor: { cuenta: string; nombre: string }) => void) | undefined;
    const entrar = vi.fn(() => new Promise<{ cuenta: string; nombre: string }>((resolve) => {
      resolver = resolve;
    }));
    const alEntrar = vi.fn();
    const { raiz, deps, publico } = preparar({ entrar });
    pintarLaCampana(raiz, deps, publico, alEntrar);
    expect(raiz.querySelector<HTMLElement>(".cmp-vuelve")?.hidden).toBe(true);
    expect(raiz.querySelector(".cmp-vuelve")?.textContent).toBe("Cuando Google termine, volvé a esta pestaña.");
    const boton = raiz.querySelector<HTMLButtonElement>(".primary");
    boton?.click();
    await asentar();
    expect(boton?.textContent).toBe("Entrando…");
    expect(boton?.disabled).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(raiz.querySelector<HTMLElement>(".cmp-vuelve")?.hidden).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(raiz.querySelector<HTMLElement>(".cmp-vuelve")?.hidden).toBe(false);
    resolver?.({ cuenta: `G${"A".repeat(55)}`, nombre: "Ana P." });
    await asentar();
    expect(alEntrar).toHaveBeenCalledWith({ cuenta: `G${"A".repeat(55)}`, nombre: "Ana P." });
  });

  it.each([
    ["ventana", "cpErrVentana"],
    ["cerrada", "cpErrCerrada"],
    ["google", "cpErrGoogle"],
    ["cuentas", "cpErrCuentas"],
  ] as const)("recupera el botón cuando la entrada falla con %s", async (motivo: FallaDeEntrada, clave) => {
    const { raiz, deps, publico } = preparar({ entrar: () => Promise.reject(new Error(motivo)) });
    pintarLaCampana(raiz, deps, publico, () => undefined);
    const boton = raiz.querySelector<HTMLButtonElement>(".primary");
    boton?.click();
    await asentar();
    expect(boton?.disabled).toBe(false);
    expect(boton?.textContent).toBe("Entrar con Google");
    expect(raiz.querySelector(".cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es[clave]);
  });
});

describe("los textos con un nombre abreviado", () => {
  it("no repiten el punto cuando el valor ya termina en punto", () => {
    expect(sustituir("Salís como {nombre}.", { nombre: "Ana P." })).toBe("Salís como Ana P.");
    expect(sustituir("Salís como {nombre}.", { nombre: "Ana" })).toBe("Salís como Ana.");
    expect(sustituir("{nombre}, hola", { nombre: "Ana P." })).toBe("Ana P., hola");
    expect(sustituir("Cierra a las {hora}.", { hora: "17:00" })).toBe("Cierra a las 17:00.");
  });
});

describe("las reglas y los estados de carga", () => {
  it("muestra el costo cuando existe y conserva los saltos de las bases", () => {
    const { raiz, deps } = preparar();
    const seccion = raiz.querySelector<HTMLElement>("#cmp-saber") as HTMLElement;
    pintarReglas(seccion, deps);
    expect(seccion.textContent).toContain("cada vez cuesta 0,50 dólares digitales");
    expect(seccion.querySelector(".cmp-bases")?.textContent).toBe(deps.campana.bases.es);
    seccion.replaceChildren();
    pintarReglas(seccion, { ...deps, costoDelRetiro: () => null });
    expect(seccion.textContent).not.toContain("cada vez cuesta");
  });

  it("pinta cada aviso a pantalla completa, con la llama de adorno y el fondo de problema solo si falla algo", () => {
    const { raiz } = preparar();
    const seccion = raiz.querySelector<HTMLElement>("#cmp-estado") as HTMLElement;
    pintarEstadoDeCarga(seccion, texto, "sin-red", () => undefined);
    expect(seccion.className).toBe("cmp-estado cmp-solo");
    expect(seccion.querySelector(".cmp-hero.cmp-alerta .cmp-grande")?.textContent).toBe("No hay conexión.");
    expect(seccion.textContent).not.toContain("Probá de nuevo");
    expect(seccion.querySelector(".cmp-hero svg.cmp-llama")?.getAttribute("aria-hidden")).toBe("true");
    expect(seccion.querySelector(":scope > .cmp-accion > .primary")?.textContent).toBe("Probar de nuevo");
    pintarEstadoDeCarga(seccion, texto, "cerrada", () => undefined);
    expect(seccion.querySelector(".cmp-alerta")).toBeNull();
    expect(seccion.querySelector(".cmp-accion")).toBeNull();
  });

  it.each([
    ["cerrada", "cpNoAbierta"],
    ["no-esta", "cpNoEsta"],
    ["sin-red", "cpSinRed"],
    ["mal", "cpMal"],
    ["pase-vencido", "cpPaseVencido"],
  ] as const)("pinta %s con su clave bilingüe", (estado: EstadoDeCarga, clave) => {
    const { raiz } = preparar();
    const seccion = raiz.querySelector<HTMLElement>("#cmp-estado") as HTMLElement;
    const reintentar = vi.fn();
    pintarEstadoDeCarga(seccion, texto, estado, reintentar);
    expect(seccion.textContent).toContain(TEXTOS_CAMPANA.es[clave]);
    const boton = seccion.querySelector<HTMLButtonElement>("button");
    if (estado === "sin-red") {
      expect(boton?.textContent).toBe("Probar de nuevo");
      boton?.click();
      expect(reintentar).toHaveBeenCalledOnce();
    } else {
      expect(boton).toBeNull();
    }
  });
});
