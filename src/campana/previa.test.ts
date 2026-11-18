// @vitest-environment jsdom
/** Pruebas de la pantalla previa con el marcado real de participar.html. */

import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos, type Lang } from "../idioma";
import { campanaDeEjemplo } from "./ejemplo";
import type { Campana } from "./modelo";
import { montarPrevia, type DepsDePrevia, type VistaDePrevia } from "./previa";
import { TEXTOS_CAMPANA } from "./textos";

const html = readFileSync("participar.html", "utf8");
const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const AHORA = Date.UTC(2026, 10, 15, 18, 0);
usarTextos(TEXTOS_CAMPANA);

const memoria = (): Storage => {
  const valores = new Map<string, string>();
  return {
    getItem: (clave) => valores.get(clave) ?? null,
    setItem: (clave, valor) => void valores.set(clave, valor),
    removeItem: (clave) => void valores.delete(clave),
    clear: () => valores.clear(),
    key: () => null,
    length: 0,
  } as Storage;
};

type Cambios = Partial<DepsDePrevia> & { lang?: Lang };

interface Mundo {
  raiz: HTMLElement;
  campana: Campana;
  sesion: Storage;
  deps: DepsDePrevia;
  pintar: () => void;
  desmontar: () => void;
}

function preparar(cambios: Cambios = {}): Mundo {
  const { lang = "es", ...resto } = cambios;
  document.body.innerHTML = main;
  setLang(lang);
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const campana = resto.campana ?? campanaDeEjemplo(AHORA);
  const sesion = resto.sesion ?? memoria();
  const deps: DepsDePrevia = {
    tx: texto,
    idioma: getLang,
    campana,
    ejemplo: true,
    enApp: false,
    anotarme: () => undefined,
    ahora: () => AHORA,
    enlace: () => "https://tinkazo.app/participar.html?demo=campana",
    sesion,
    ...resto,
  };
  const vista: VistaDePrevia = montarPrevia(raiz, deps);
  return { raiz, campana, sesion, deps, pintar: vista.pintar, desmontar: vista.desmontar };
}

function campanaCon(cambios: Partial<Campana>): Campana {
  return { ...campanaDeEjemplo(AHORA), ...cambios };
}

function irAPasos(mundo: Mundo): void {
  mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .cmp-accion .primary")?.click();
}

function visible(elemento: Element): boolean {
  return elemento.closest("[hidden]") === null;
}

function principalesVisibles(mundo: Mundo): Element[] {
  return [...mundo.raiz.querySelectorAll(".primary")].filter(visible);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  document.body.innerHTML = "";
  setLang("es");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("montarPrevia", () => {
  it("la vista de ejemplo muestra la franja de ejemplo y la pantalla inicial", () => {
    const mundo = preparar();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-ejemplo")?.hidden).toBe(false);
    expect(mundo.raiz.querySelector("#cmp-ejemplo")?.textContent).toBe(
      "Vista de ejemplo: así lo va a ver la gente. Acá no se anota a nadie.",
    );
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(false);
  });

  it("la pantalla inicial muestra textos fijos en español", () => {
    const mundo = preparar();
    expect(mundo.raiz.querySelector("h1")?.textContent).toBe("Sorteo de Empresa de ejemplo en Evento de ejemplo");
    expect(mundo.raiz.querySelector(".cmp-organiza")?.textContent).toBe(
      "Organiza Empresa de ejemplo. Tinkazo hace el sorteo y cualquiera puede comprobar cómo se eligió.",
    );
    expect(mundo.raiz.querySelector(".cmp-premio")?.textContent).toBe(
      "Premio: 40 dólares digitales para 1 persona.",
    );
    const lineas = [...mundo.raiz.querySelectorAll("#cmp-saber > ul > li")].map((linea) => linea.textContent);
    expect(lineas).toEqual([
      "Participar es gratis. No pagás nada, ni ahora ni después.",
      "Revisamos los datos: una persona, una cuenta y una sola vez. " +
        "Lo que no cumpla sale de la lista antes del sorteo, y queda escrito por qué.",
      "Tu cuenta queda en una lista pública, sin tu nombre ni tu correo.",
      "La lista cierra el 15 de noviembre a las 17:00.",
    ]);
  });

  it("la pantalla inicial muestra textos fijos en inglés", () => {
    const mundo = preparar({ lang: "en" });
    expect(mundo.raiz.querySelector("h1")?.textContent).toBe("Empresa de ejemplo draw at Sample event");
    expect(mundo.raiz.querySelector(".cmp-organiza")?.textContent).toBe(
      "Organized by Empresa de ejemplo. Tinkazo runs the draw and anyone can check how the winner was chosen.",
    );
    expect(mundo.raiz.querySelector(".cmp-premio")?.textContent).toBe(
      "Prize: 40 digital dollars for 1 person.",
    );
    const lineas = [...mundo.raiz.querySelectorAll("#cmp-saber > ul > li")].map((linea) => linea.textContent);
    expect(lineas).toEqual([
      "Taking part is free. You pay nothing, now or later.",
      "We check the details: one person, one account, one time. " +
        "Anything that doesn't comply leaves the list before the draw, and the reason is written down.",
      "Your account goes on a public list, without your name or your email.",
      "The list closes on November 15 at 17:00.",
    ]);
  });

  it("fija el renglón de cierre y el plazo con año en español", () => {
    const campana = campanaCon({
      abreMs: Date.UTC(2025, 10, 1),
      cierraMs: Date.UTC(2025, 10, 30, 1, 0),
      sorteoMs: Date.UTC(2025, 10, 30, 2, 0),
      recibirHastaMs: Date.UTC(2026, 0, 15, 12),
    });
    const mundo = preparar({ campana, ahora: () => Date.UTC(2025, 10, 15) });
    const lineas = mundo.raiz.querySelectorAll("#cmp-saber > ul > li");
    expect(lineas[lineas.length - 1]?.textContent).toBe("La lista cierra el 29 de noviembre a las 21:00.");
    const plazo = mundo.raiz.querySelectorAll("#cmp-saber > details")[0]?.querySelectorAll("li")[2];
    expect(plazo?.textContent).toBe(
      "Tenés hasta el 15 de enero de 2026 para recibirlo. Después vuelve a Empresa de ejemplo.",
    );
  });

  it("fija el renglón de cierre y el plazo con año en inglés", () => {
    const campana = campanaCon({
      abreMs: Date.UTC(2025, 10, 1),
      cierraMs: Date.UTC(2025, 10, 30, 1, 0),
      sorteoMs: Date.UTC(2025, 10, 30, 2, 0),
      recibirHastaMs: Date.UTC(2026, 0, 15, 12),
    });
    const mundo = preparar({ lang: "en", campana, ahora: () => Date.UTC(2025, 10, 15) });
    const lineas = mundo.raiz.querySelectorAll("#cmp-saber > ul > li");
    expect(lineas[lineas.length - 1]?.textContent).toBe("The list closes on November 29 at 21:00.");
    const plazo = mundo.raiz.querySelectorAll("#cmp-saber > details")[0]?.querySelectorAll("li")[2];
    expect(plazo?.textContent).toBe(
      "You have until January 15, 2026 to receive it. After that it goes back to Empresa de ejemplo.",
    );
  });

  it("mantiene los tres avisos secundarios dentro del primer plegado", () => {
    const mundo = preparar();
    const mas = mundo.raiz.querySelectorAll("#cmp-saber > details")[0];
    expect(mas?.querySelector("summary")?.textContent).toBe("Más sobre este sorteo");
    expect(mas?.textContent).toContain("Te creamos tu cuenta de Tinkazo con un toque.");
    expect(mas?.textContent).toContain("Si ganás, el premio llega a tu cuenta de Tinkazo");
    expect(mas?.textContent).toContain("Tenés hasta el");
  });

  it("ninguna pantalla muestra una llave sin reemplazar", () => {
    for (const lang of ["es", "en"] as const) {
      const abierta = preparar({ lang });
      expect(abierta.raiz.textContent).not.toMatch(/\{\w+\}/u);
      irAPasos(abierta);
      expect(abierta.raiz.textContent).not.toMatch(/\{\w+\}/u);
      for (const campana of [
        campanaCon({ estado: "borrador" }),
        campanaCon({ estado: "cerrada" }),
        campanaCon({ estado: "sorteada" }),
        campanaCon({ estado: "sorteada", comprobante: "/verificar.html?demo=1" }),
      ]) {
        const estado = preparar({ lang, campana });
        expect(estado.raiz.textContent).not.toMatch(/\{\w+\}/u);
      }
    }
  });

  it("sin pasos la acción es Anotarme y con pasos Seguir lleva a ellos y Volver regresa", () => {
    const sinPasos = preparar({ campana: campanaCon({ pasos: [] }) });
    expect(principalesVisibles(sinPasos)[0]?.textContent).toBe("Anotarme");
    const conPasos = preparar();
    expect(principalesVisibles(conPasos)[0]?.textContent).toBe("Seguir");
    irAPasos(conPasos);
    expect(conPasos.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(true);
    expect(conPasos.raiz.querySelector<HTMLElement>("#cmp-pasos")?.hidden).toBe(false);
    conPasos.raiz.querySelector<HTMLButtonElement>("#cmp-pasos .cmp-accion > .ghost")?.click();
    expect(conPasos.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(false);
    expect(conPasos.raiz.querySelector<HTMLElement>("#cmp-pasos")?.hidden).toBe(true);
  });

  it("dos pasos del mismo tipo conservan cada uno su propio texto", () => {
    const pasos: Campana["pasos"] = [
      { tipo: "texto", url: null, texto: { es: "Primer pedido", en: "First request" } },
      { tipo: "texto", url: null, texto: { es: "Segundo pedido", en: "Second request" } },
    ];
    const mundo = preparar({ campana: campanaCon({ pasos }) });
    irAPasos(mundo);
    const textos = [...mundo.raiz.querySelectorAll(".cmp-paso > p")].map((paso) => paso.textContent);
    expect(textos).toEqual(["Primer pedido", "Segundo pedido"]);
  });

  it("las casillas no cambian Anotarme y se recuerdan por evento", () => {
    const sesion = memoria();
    const campana = campanaDeEjemplo(AHORA);
    const mundo = preparar({ campana, sesion });
    irAPasos(mundo);
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-pasos .primary");
    expect(boton?.disabled).toBe(false);
    const casillas = mundo.raiz.querySelectorAll<HTMLInputElement>(".cmp-paso input[type=checkbox]");
    casillas[0]?.click();
    expect(boton?.disabled).toBe(false);
    expect(sesion.getItem("tinkazo.campana.evento-ejemplo.0")).toBe("1");
    casillas[0]?.click();
    expect(boton?.disabled).toBe(false);
    expect(sesion.getItem("tinkazo.campana.evento-ejemplo.0")).toBeNull();
    casillas[0]?.click();
    casillas[1]?.click();
    const recordada = preparar({ campana, sesion });
    irAPasos(recordada);
    const marcadas = [...recordada.raiz.querySelectorAll<HTMLInputElement>(".cmp-paso input")].map(
      (casilla) => casilla.checked,
    );
    expect(marcadas).toEqual([true, true, false]);
    const otroEvento = preparar({ campana: campanaCon({ evento: "otro-evento" }), sesion });
    irAPasos(otroEvento);
    const nuevas = [...otroEvento.raiz.querySelectorAll<HTMLInputElement>(".cmp-paso input")].map(
      (casilla) => casilla.checked,
    );
    expect(nuevas).toEqual([false, false, false]);
  });

  it("Abrir sale de forma segura y el paso de texto no tiene Abrir", () => {
    const mundo = preparar();
    irAPasos(mundo);
    const pasos = [...mundo.raiz.querySelectorAll(".cmp-paso")];
    for (const paso of pasos.slice(0, 2)) {
      const enlace = paso.querySelector<HTMLAnchorElement>("a.ghost");
      expect(enlace?.textContent).toBe("Abrir");
      expect(enlace?.target).toBe("_blank");
      expect(enlace?.rel).toBe("noopener noreferrer");
    }
    expect(pasos[2]?.querySelector("a")).toBeNull();
  });

  it("un nombre de empresa con etiquetas se ve como texto y no crea elementos", () => {
    const ejemplo = campanaDeEjemplo(AHORA);
    const campana = { ...ejemplo, empresa: { ...ejemplo.empresa, nombre: "<b>Empresa</b>" } };
    const mundo = preparar({ campana });
    expect(mundo.raiz.querySelector("b")).toBeNull();
    expect(mundo.raiz.querySelector("h1")?.textContent).toContain("<b>Empresa</b>");
  });

  it("el logo usa exactamente el tipo y los datos recibidos", () => {
    const ejemplo = campanaDeEjemplo(AHORA);
    const logo = { tipo: "image/png", datos: "iVBORw0KGgo=" };
    const campana = { ...ejemplo, empresa: { ...ejemplo.empresa, logo } };
    const mundo = preparar({ campana });
    const imagen = mundo.raiz.querySelector<HTMLImageElement>("img.cmp-logo");
    expect(imagen?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(imagen?.alt).toBe("Empresa de ejemplo");
  });

  it("las bases completas muestran el texto recibido sin convertirlo en HTML", () => {
    const bases = { es: "Primera base\nSegunda base con <b>texto</b>", en: "First rule" };
    const mundo = preparar({ campana: campanaCon({ bases }) });
    const detalles = mundo.raiz.querySelectorAll("#cmp-saber > details")[1];
    expect(detalles?.querySelector("p")?.textContent).toBe("Primera base\nSegunda base con <b>texto</b>");
    expect(detalles?.querySelector("b")).toBeNull();
  });

  it("en el navegador de una app hay Copiar el enlace con su aviso en las dos pantallas", () => {
    const mundo = preparar({ enApp: true });
    expect(mundo.raiz.querySelector("#cmp-saber .primary")?.textContent).toBe("Copiar el enlace");
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-en-app")?.textContent).toContain(
      "Desde esta aplicación no se puede crear tu cuenta.",
    );
    expect(mundo.raiz.querySelector("#cmp-saber")?.textContent).not.toContain("Anotarme");
    const pasos = preparar();
    irAPasos(pasos);
    pasos.deps.enApp = true;
    pasos.pintar();
    expect(pasos.raiz.querySelector("#cmp-pasos .primary")?.textContent).toBe("Copiar el enlace");
    expect(pasos.raiz.querySelector("#cmp-pasos .cmp-en-app")?.textContent).toContain(
      "Desde esta aplicación no se puede crear tu cuenta.",
    );
    expect(pasos.raiz.querySelector("#cmp-pasos")?.textContent).not.toContain("Anotarme");
  });

  it("sin portapapeles Copiar el enlace muestra el enlace en un campo de solo lectura", () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    const enlace = "https://tinkazo.app/participar.html?c=evento-ejemplo";
    const mundo = preparar({ enApp: true, enlace: () => enlace });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    const campo = mundo.raiz.querySelector<HTMLInputElement>("#cmp-saber .cmp-accion input");
    expect(campo?.value).toBe(enlace);
    expect(campo?.readOnly).toBe(true);
  });

  it("un permiso denegado al copiar muestra el mismo campo de respaldo", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("permiso denegado")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const enlace = "https://tinkazo.app/participar.html?c=evento-ejemplo";
    const mundo = preparar({ enApp: true, enlace: () => enlace });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    await Promise.resolve();
    await Promise.resolve();
    const campo = mundo.raiz.querySelector<HTMLInputElement>("#cmp-saber .cmp-accion input");
    expect(campo?.value).toBe(enlace);
    expect(campo?.readOnly).toBe(true);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-en-app")?.getAttribute("role")).toBe("status");
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-en-app")?.getAttribute("aria-live")).toBe("polite");
  });

  it("varios intentos de copiar reutilizan un solo campo", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("permiso denegado")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const mundo = preparar({ enApp: true });
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary");
    boton?.click();
    await Promise.resolve();
    await Promise.resolve();
    boton?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(mundo.raiz.querySelectorAll("#cmp-saber .cmp-accion input")).toHaveLength(1);
  });

  it("antes de abrir muestra la fecha y hora fijas de apertura", () => {
    const campana = campanaCon({ abreMs: AHORA + 60 * 60 * 1000 });
    const mundo = preparar({ campana });
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe(
      "La inscripción abre el 15 de noviembre a las 15:00.",
    );
  });

  it("una campaña cerrada dice que la inscripción ya cerró", () => {
    const mundo = preparar({ campana: campanaCon({ estado: "cerrada" }) });
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe("La inscripción ya cerró.");
  });

  it("una campaña sorteada sin comprobante no ofrece una acción", () => {
    const mundo = preparar({ campana: campanaCon({ estado: "sorteada", comprobante: null }) });
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe("Este sorteo ya se hizo.");
    expect(mundo.raiz.querySelector("#cmp-estado .primary")).toBeNull();
  });

  it("una campaña sorteada con comprobante ofrece Ver cómo se eligió", () => {
    const mundo = preparar({
      campana: campanaCon({ estado: "sorteada", comprobante: "/verificar.html?demo=1" }),
    });
    const enlace = mundo.raiz.querySelector<HTMLAnchorElement>("#cmp-estado a.primary");
    expect(enlace?.textContent).toBe("Ver cómo se eligió");
    expect(enlace?.getAttribute("href")).toBe("/verificar.html?demo=1");
  });

  it("hay exactamente una acción principal visible solo donde corresponde", () => {
    const inicial = preparar();
    expect(principalesVisibles(inicial)).toHaveLength(1);
    irAPasos(inicial);
    expect(principalesVisibles(inicial)).toHaveLength(1);
    const sorteada = preparar({
      campana: campanaCon({ estado: "sorteada", comprobante: "/verificar.html?demo=1" }),
    });
    expect(principalesVisibles(sorteada)).toHaveLength(1);
    for (const campana of [
      campanaCon({ estado: "borrador" }),
      campanaCon({ estado: "cerrada" }),
      campanaCon({ estado: "sorteada", comprobante: null }),
    ]) {
      expect(principalesVisibles(preparar({ campana }))).toHaveLength(0);
    }
  });

  it("cambiar de idioma repinta la pantalla inicial en el idioma nuevo", () => {
    const mundo = preparar();
    setLang("en");
    mundo.pintar();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(false);
    expect(mundo.raiz.querySelector("h1")?.textContent).toBe("Empresa de ejemplo draw at Sample event");
    expect(mundo.raiz.querySelector("#cmp-saber .primary")?.textContent).toBe("Continue");
    expect(mundo.raiz.querySelector("#cmp-ejemplo")?.textContent).toBe(
      "Sample view: this is how people will see it. Nobody signs up here.",
    );
  });

  it("cambiar de idioma en los pasos deja solo los pasos a la vista en el idioma nuevo", () => {
    const mundo = preparar();
    irAPasos(mundo);
    setLang("en");
    mundo.pintar();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(true);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-pasos")?.hidden).toBe(false);
    expect(mundo.raiz.querySelector("#cmp-pasos h2")?.textContent).toBe("What Empresa de ejemplo asks you");
    expect(mundo.raiz.querySelector(".cmp-paso > p")?.textContent).toBe("Follow Empresa de ejemplo on Instagram");
    expect(mundo.raiz.querySelector("#cmp-pasos .primary")?.textContent).toBe("Sign me up");
  });

  it("tocar Anotarme llama a anotarme una vez", () => {
    const anotarme = vi.fn();
    const mundo = preparar({ campana: campanaCon({ pasos: [] }), anotarme });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    expect(anotarme).toHaveBeenCalledTimes(1);
  });

  it("Anotarme después del cierre no ejecuta la acción y muestra el estado cerrado", () => {
    let ahora = AHORA;
    const anotarme = vi.fn();
    const campana = campanaCon({ pasos: [], cierraMs: AHORA + 1000 });
    const mundo = preparar({ campana, anotarme, ahora: () => ahora });
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary");
    ahora = AHORA + 1000;
    boton?.click();
    expect(anotarme).not.toHaveBeenCalled();
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe("La inscripción ya cerró.");
  });

  it("Seguir después del cierre no abre los pasos y muestra el estado cerrado", () => {
    let ahora = AHORA;
    const campana = campanaCon({ cierraMs: AHORA + 1000 });
    const mundo = preparar({ campana, ahora: () => ahora });
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary");
    ahora = AHORA + 1000;
    boton?.click();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-pasos")?.hidden).toBe(true);
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe("La inscripción ya cerró.");
  });

  it("la pantalla se abre sola cuando llega la hora de apertura", () => {
    let ahora = AHORA;
    const campana = campanaCon({ abreMs: AHORA + 1000, cierraMs: AHORA + 2000 });
    const mundo = preparar({ campana, ahora: () => ahora });
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-estado")?.hidden).toBe(false);
    ahora = AHORA + 1000;
    vi.advanceTimersByTime(1000);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-estado")?.hidden).toBe(true);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(false);
  });

  it("la pantalla se cierra sola cuando llega la hora de cierre", () => {
    let ahora = AHORA;
    const campana = campanaCon({ cierraMs: AHORA + 1000 });
    const mundo = preparar({ campana, ahora: () => ahora });
    ahora = AHORA + 1000;
    vi.advanceTimersByTime(1000);
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe("La inscripción ya cerró.");
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(true);
  });

  it("limita la espera del temporizador al máximo admitido", () => {
    const programar = vi.spyOn(window, "setTimeout");
    const campana = campanaCon({ abreMs: AHORA + 3_000_000_000, cierraMs: AHORA + 3_000_001_000 });
    preparar({ campana });
    expect(programar).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
  });

  it("repintar no duplica el temporizador y desmontar lo limpia", () => {
    const mundo = preparar();
    expect(vi.getTimerCount()).toBe(1);
    mundo.pintar();
    expect(vi.getTimerCount()).toBe(1);
    mundo.desmontar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("el aviso queda fijo en la raíz y se limpia al cambiar de pantalla", () => {
    const mundo = preparar();
    const mensaje = mundo.raiz.querySelector<HTMLElement>("#cmp-mensaje");
    expect(mensaje?.parentElement).toBe(mundo.raiz);
    if (mensaje) mensaje.textContent = "Aviso anterior";
    irAPasos(mundo);
    expect(mensaje?.textContent).toBe("");
    if (mensaje) mensaje.textContent = "Otro aviso";
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-pasos .cmp-accion > .ghost")?.click();
    expect(mensaje?.textContent).toBe("");
    expect(mensaje?.parentElement).toBe(mundo.raiz);
  });

  it("el acento de la empresa se comparte entre pantallas y el color nulo usa el del sitio", () => {
    for (const color of ["rojo", "naranja", "amarillo", "verde", "azul", "morado"] as const) {
      const ejemplo = campanaDeEjemplo(AHORA);
      const campana = { ...ejemplo, empresa: { ...ejemplo.empresa, color } };
      const mundo = preparar({ campana });
      expect(mundo.raiz.style.getPropertyValue("--cmp-acento")).toBe(`var(--cmp-${color})`);
      irAPasos(mundo);
      expect(mundo.raiz.style.getPropertyValue("--cmp-acento")).toBe(`var(--cmp-${color})`);
    }
    const ejemplo = campanaDeEjemplo(AHORA);
    const campana = { ...ejemplo, empresa: { ...ejemplo.empresa, color: null } };
    expect(preparar({ campana }).raiz.style.getPropertyValue("--cmp-acento")).toBe("var(--magenta)");
  });
});
