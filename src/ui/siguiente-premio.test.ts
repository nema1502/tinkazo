// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La línea de la barra con un premio largo (issue 26): antes se cortaba a las 18 letras sin mirar dónde caía el
 * corte y quedaba "¿Quién presenta p…". Ahora entra entero si hay lugar, y si no se corta en el último espacio
 * que entra. jsdom no dibuja nada: acá el ancho de cada cosa se simula (8 px por letra), y lo que se prueba es la
 * decisión de la barra, no el navegador.
 */

const PX = 8;
const PREMIO = "¿Quién presenta primero?";
const PALABRA_LARGA = "Supercalifragilísticoespialidosoextraordinario";

const CUERPO = (premio: string, lista = "Ana\nBeto\nCarla\nDora") =>
  '<div id="stadium"></div><div id="winner-box"></div>' +
  `<textarea id="ta">${lista}</textarea>` +
  `<div id="names">${lista.split("\n").map((n) => `<i>${n}</i>`).join("")}</div>` +
  `<input id="prize" value="${premio}"><div id="prize-chips"></div>` +
  '<section id="sec-participants"></section><button id="btn-freeze">Sellar la lista</button><button id="btn-pegar">Pegar lista</button>' +
  '<div id="siguiente"><span id="sig-paso"></span><button id="sig-btn"></button></div><span id="sig-aviso"></span>' +
  '<ol id="pasos"></ol>';

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const linea = (): string => byId("sig-paso").textContent ?? "";
/** La parte de la línea que sigue a "lista de 4 personas, ": el premio, como se ve. */
const premioVisto = (): string => linea().split(" personas")[1]?.replace(/^, /, "") ?? "";

/** Cuántos renglones ocupa un texto que se parte por los espacios, con `letras` letras por renglón. */
function renglones(texto: string, letras: number): number {
  let n = 1;
  let usado = 0;
  for (const palabra of texto.split(" ")) {
    const largo = Array.from(palabra).length;
    if (usado === 0) usado = largo;
    else if (usado + 1 + largo <= letras) usado += 1 + largo;
    else {
      n++;
      usado = largo;
    }
  }
  return n;
}

interface Pantalla {
  /** Lo que mide por dentro el renglón de la línea del paso, en px. */
  lugar: number;
  /** Cuántas veces se le preguntó al renglón cuánto ocupa su texto. */
  medidas: number;
}

/** Le da medidas a la barra: sin esto jsdom contesta cero a todo y no hay con qué decidir. */
function simular(pantalla: Pantalla): void {
  const def = (el: HTMLElement, propiedad: string, valor: () => number): void => {
    Object.defineProperty(el, propiedad, { configurable: true, get: valor });
  };
  const p = byId("sig-paso");
  const doble = (): boolean => p.classList.contains("doble");
  const letras = (): number => Math.floor(pantalla.lugar / PX);
  def(byId("siguiente"), "clientWidth", () => (pantalla.lugar > 0 ? pantalla.lugar + 160 : 0));
  def(byId("sig-btn"), "offsetWidth", () => 120);
  def(p, "clientWidth", () => pantalla.lugar);
  def(p, "clientHeight", () => 2 * 18);
  def(p, "scrollWidth", () => {
    pantalla.medidas++;
    const texto = p.textContent ?? "";
    // Con dos renglones el texto se parte: solo desborda de ancho una palabra que no se puede partir.
    return doble() ? Math.max(0, ...texto.split(" ").map((w) => Array.from(w).length * PX)) : Array.from(texto).length * PX;
  });
  def(p, "scrollHeight", () => renglones(p.textContent ?? "", letras()) * 18);
}

let alCambiarElAncho: () => void = () => undefined;

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/?lang=es");
  sessionStorage.clear();
  alCambiarElAncho = () => undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        alCambiarElAncho = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function abrir(premio: string, pantalla: Pantalla, lista?: string): Promise<{ actualizarPaso: () => void }> {
  document.body.innerHTML = CUERPO(premio, lista);
  simular(pantalla);
  await import("../i18n");
  const { initSiguiente, actualizarPaso } = await import("./siguiente");
  initSiguiente({ segundos: () => 0 });
  return { actualizarPaso };
}

describe("la línea del paso 2 con un premio largo", () => {
  it("con lugar de sobra, el premio va entero", async () => {
    await abrir(PREMIO, { lugar: 900, medidas: 0 });
    expect(linea()).toBe(`Paso 2 de 4: lista de 4 personas, ${PREMIO}`);
  });

  it("un premio de 60 letras también va entero si hay lugar", async () => {
    const largo = "Una notebook con su mochila, el cargador y un mouse inalámbrico";
    await abrir(largo, { lugar: 900, medidas: 0 });
    expect(linea()).toBe(`Paso 2 de 4: lista de 4 personas, ${largo}`);
  });

  it("sin lugar para todo, corta en el último espacio que entra y no deja una palabra a medias", async () => {
    // 40 letras de lugar: "Paso 2 de 4: lista de 4 personas, " ya ocupa 34.
    await abrir(PREMIO, { lugar: 44 * PX, medidas: 0 });
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién…");
    // Con un poco más entra una palabra más.
    vi.resetModules();
    await abrir(PREMIO, { lugar: 52 * PX, medidas: 0 });
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién presenta…");
  });

  it("para cualquier ancho, la línea entra y el premio es del principio y termina entre palabras", async () => {
    const premio = "Una notebook con su mochila y el cargador";
    const pantalla = { lugar: 0, medidas: 0 };
    const { actualizarPaso } = await abrir(premio, pantalla);
    // Desde lo justo para la lista sola (32 letras) hasta lo que le sobra al premio entero.
    for (let letras = 32; letras <= 90; letras++) {
      pantalla.lugar = letras * PX;
      actualizarPaso();
      const visto = premioVisto();
      const donde = `${letras} letras: ${linea()}`;
      expect(Array.from(linea()).length, donde).toBeLessThanOrEqual(letras);
      if (visto === premio || visto === "") continue;
      expect(visto.endsWith("…"), donde).toBe(true);
      const trozo = visto.slice(0, -1);
      expect(premio.startsWith(trozo), donde).toBe(true);
      expect(premio.charAt(trozo.length), donde).toBe(" ");
    }
  });

  it("si ni la primera palabra entra, queda solo la lista y no dice que no hay premio", async () => {
    await abrir(PALABRA_LARGA, { lugar: 44 * PX, medidas: 0 });
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas");
    expect(linea()).not.toMatch(/sin premio/);
  });

  it("una palabra larga sola va entera si entra", async () => {
    await abrir(PALABRA_LARGA, { lugar: 900, medidas: 0 });
    expect(linea()).toBe(`Paso 2 de 4: lista de 4 personas, ${PALABRA_LARGA}`);
  });

  it("sin premio, la línea de siempre", async () => {
    await abrir("", { lugar: 44 * PX, medidas: 0 });
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, sin premio");
  });

  it("con las dos cuentas (dos renglones), el premio entra en dos renglones", async () => {
    history.replaceState(null, "", "/?modo=varias&lang=es");
    const lista = "Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto";
    const premio = "Una notebook con su mochila y el cargador";
    const letras = 40;
    await abrir(premio, { lugar: letras * PX, medidas: 0 }, lista);
    expect(byId("sig-paso").classList.contains("doble")).toBe(true);
    expect(linea()).toContain("2 personas, 4 participaciones, ");
    expect(renglones(linea(), letras), linea()).toBeLessThanOrEqual(2);
    // Entra más que a las 18 letras de antes, y corta entre palabras.
    expect(linea().split("participaciones, ")[1]).toBe("Una notebook con su…");
  });

  it("sin medidas (la barra sin ancho) corta entre palabras en las 18 letras de un celular", async () => {
    await abrir(PREMIO, { lugar: 0, medidas: 0 });
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién presenta…");
    vi.resetModules();
    await abrir(PALABRA_LARGA, { lugar: 0, medidas: 0 });
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas");
  });
});

describe("la barra vuelve a medir cuando cambia lo que decide", () => {
  it("al cambiar el ancho de la ventana", async () => {
    const pantalla = { lugar: 44 * PX, medidas: 0 };
    await abrir(PREMIO, pantalla);
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién…");
    pantalla.lugar = 900;
    alCambiarElAncho();
    expect(linea()).toBe(`Paso 2 de 4: lista de 4 personas, ${PREMIO}`);
    pantalla.lugar = 44 * PX;
    alCambiarElAncho();
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién…");
  });

  it("al escribir otro premio", async () => {
    const pantalla = { lugar: 44 * PX, medidas: 0 };
    await abrir("Termo", pantalla);
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, Termo");
    const campo = byId("prize") as HTMLInputElement;
    campo.value = PREMIO;
    campo.dispatchEvent(new Event("input"));
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién…");
  });

  it("al cambiar de idioma", async () => {
    const pantalla = { lugar: 44 * PX, medidas: 0 };
    await abrir(PREMIO, pantalla);
    const { setLang } = await import("../idioma");
    setLang("en");
    expect(linea()).toBe("Step 2 of 4: list of 4 people, ¿Quién…");
  });

  it("sin cambios no vuelve a medir: un renglón fijo no se mide en cada vuelta", async () => {
    const pantalla = { lugar: 44 * PX, medidas: 0 };
    const { actualizarPaso } = await abrir(PREMIO, pantalla);
    const antes = pantalla.medidas;
    expect(antes).toBeGreaterThan(0);
    // Doce vueltas más (lo que pasa con la cuenta regresiva, la vista del botón y los cambios de la lista).
    for (let i = 0; i < 12; i++) actualizarPaso();
    expect(pantalla.medidas).toBe(antes);
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién…");
  });

  it("mide pocas veces: el entero y unas pocas más, no una por palabra", async () => {
    const pantalla = { lugar: 44 * PX, medidas: 0 };
    const { actualizarPaso } = await abrir("uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce", pantalla);
    // Las barras de las pruebas anteriores siguen mirando el mismo cuerpo y miden una vez cada una al armarse la página:
    // se espera a que terminen y se cuenta recién desde un ancho nuevo, que es lo que obliga a esta barra a medir.
    await new Promise((r) => setTimeout(r, 0));
    pantalla.medidas = 0;
    pantalla.lugar = 45 * PX;
    actualizarPaso();
    expect(pantalla.medidas).toBeGreaterThan(0);
    expect(pantalla.medidas).toBeLessThanOrEqual(8);
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, uno dos…");
  });
});

describe("lo que anuncia el lector de pantalla", () => {
  it("lleva el premio entero aunque la barra lo corte", async () => {
    const lista = "Ana\nBeto\nCarla\nDora";
    document.body.innerHTML = CUERPO("Termo", lista);
    simular({ lugar: 44 * PX, medidas: 0 });
    await import("../i18n");
    const { initSiguiente, actualizarPaso } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    // La primera vez no se anuncia: se pasa de paso. Con una sola persona la clave es otra y volver a dos cambia.
    byId("names").innerHTML = "<i>Ana</i>";
    (byId("ta") as HTMLTextAreaElement).value = "Ana";
    actualizarPaso();
    (byId("prize") as HTMLInputElement).value = PREMIO;
    byId("names").innerHTML = "<i>Ana</i><i>Beto</i><i>Carla</i><i>Dora</i>";
    (byId("ta") as HTMLTextAreaElement).value = lista;
    actualizarPaso();
    expect(byId("sig-aviso").textContent).toContain(PREMIO);
    expect(linea()).toBe("Paso 2 de 4: lista de 4 personas, ¿Quién…");
  });
});
