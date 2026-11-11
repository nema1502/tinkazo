// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { select } from "../protocol/select";
import { alCopiarOrden } from "./lista-de-turnos";
import { htmlDeGanadores } from "./resultado-ganadores";

/**
 * El orden de turnos que se muestra (resultado, pantalla grande y lo que se copia), y la prueba que cuida la justicia:
 * el orden que se MUESTRA es exactamente el orden de los ganadores que da el sorteo, los mismos índices en el mismo
 * orden. Los ganadores salen de `select`, el sorteo de verdad; lo que se prueba es que ninguna pantalla los reordene.
 */

vi.mock("../enlace-corto", () => ({ acortar: async () => null, enlaceParaElQr: async () => ({ ahora: "", despues: Promise.resolve(null) }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => false }));
vi.mock("./logo-sorteo", () => ({ piezaParaLaSala: () => null }));

const numero = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
const huella = Uint8Array.from({ length: 32 }, (_, i) => (i * 91 + 5) & 255);
/** Nombres distintos, con caracteres que abrirían una etiqueta si no se escaparan. */
const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona <${i + 1}> & Co`);
/** El sorteo de verdad: todas las personas, en el orden que decide el número. */
const ganadoresDe = (n: number): number[] => select(numero, huella, n, n);
const avatar = (nombre: string): string => `data:cara-${nombre.length}`;
const TAMANOS = [2, 12, 300];

const pintar = (names: string[], winners: number[], prize: string): HTMLElement => {
  const caja = document.createElement("div");
  caja.id = "winner-cards";
  caja.innerHTML = htmlDeGanadores({ names, winners, prize, reemplazo: true, avatar });
  document.body.replaceChildren(caja);
  return caja;
};

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("el resultado de un orden de turnos", () => {
  it.each(TAMANOS)("con %i turnos: una lista «Turno 1 ... Turno N» desde el primero, sin tarjeta grande", (n) => {
    const names = nombres(n);
    const c = pintar(names, ganadoresDe(n), "Turnos");
    const filas = [...c.querySelectorAll<HTMLElement>(".winner-lista > li.winner-fila")];
    expect(filas).toHaveLength(n);
    expect(filas[0]?.querySelector(".winner-num")?.textContent).toBe("Turno 1");
    expect(filas[n - 1]?.querySelector(".winner-num")?.textContent).toBe(`Turno ${n}`);
    // El primero va en la lista como todos: ni tarjeta, ni cara, ni «Se lleva», ni «No está», ni «Siguiente premio».
    expect(c.querySelectorAll(".winner-card")).toHaveLength(0);
    expect(c.querySelectorAll("img")).toHaveLength(0);
    expect(c.querySelectorAll(".ausente, .ausente-btn")).toHaveLength(0);
    expect(c.querySelector(".winner-prize")).toBeNull();
    expect(c.textContent).not.toMatch(/Se lleva|No está|Siguiente|premio|ganador|gana/i);
    expect(c.querySelector("#winner-lista-t")?.textContent).toBe("El orden de los turnos");
    // Con más de ocho turnos, «Copiar el orden» está arriba y abajo de la lista; con pocos, solo abajo.
    expect(c.querySelectorAll("button")).toHaveLength(n > 8 ? 2 : 1);
    expect(c.querySelector("button")?.textContent).toBe("Copiar el orden");
    // Los nombres no abren etiquetas.
    expect(c.querySelectorAll("b, i, script")).toHaveLength(0);
  });

  it("en cada fila el nombre y «Avisarle» van juntos al lado del número, para que el nombre nunca baje debajo de él", () => {
    // En el celular «Avisarle» puede bajar debajo del nombre (styles.css, `.turno-resto`), pero el número y el nombre
    // quedan en el mismo renglón desde el «Turno 1» hasta el último, por más ancho que sea el número en esa letra.
    const c = pintar(nombres(12), ganadoresDe(12), "Turnos");
    const filas = [...c.querySelectorAll<HTMLElement>(".winner-lista > li.winner-fila")];
    expect(filas).toHaveLength(12);
    for (const fila of filas) {
      const hijos = [...fila.children].map((e) => e.className);
      expect(hijos).toEqual(["winner-num", "turno-resto"]);
      const resto = fila.querySelector(".turno-resto");
      expect([...(resto?.children ?? [])].map((e) => e.classList.contains("winner-name") || e.classList.contains("turno-avisar"))).toEqual([true, true]);
    }
  });

  it("el nombre del orden puede ser «Turnos de limpieza» o «Turns», y aun así es turnos", () => {
    for (const prize of ["Turnos de limpieza", "turnos", "Turns", "TURNS for the lab"]) {
      const c = pintar(nombres(12), ganadoresDe(12), prize);
      expect(c.querySelectorAll(".winner-lista > li"), prize).toHaveLength(12);
      expect(c.querySelectorAll(".winner-card"), prize).toHaveLength(0);
    }
  });

  it("3 poleras entre 3 personas no es turnos: tarjetas con «Se lleva», como siempre", () => {
    const c = pintar(nombres(3), ganadoresDe(3), "3 poleras");
    expect(c.querySelectorAll(".winner-card")).toHaveLength(3);
    expect(c.querySelector(".winner-prize")?.textContent).toBe("Se lleva: 3 poleras #1");
    expect(c.querySelector("[data-copiar-orden]")).toBeNull();
    expect(c.querySelectorAll(".ausente")).toHaveLength(3);
  });

  it("«Turnos de limpieza» con 3 de 12 no es turnos: sale como siempre", () => {
    const c = pintar(nombres(12), ganadoresDe(12).slice(0, 3), "Turnos de limpieza");
    expect(c.querySelectorAll(".winner-card")).toHaveLength(3);
    expect(c.querySelector("[data-copiar-orden]")).toBeNull();
    expect(c.querySelector(".winner-prize")?.textContent).toContain("Se lleva: Turnos de limpieza");
  });
});

describe("la justicia: el orden que se muestra es el orden del sorteo", () => {
  it.each(TAMANOS)("en el resultado, con %i turnos: los mismos índices, en el mismo orden", (n) => {
    const names = nombres(n);
    const ganadores = ganadoresDe(n);
    // Es una permutación completa de la lista, y no es la lista en su orden de carga: un orden «sin mezclar» no probaría nada.
    expect([...ganadores].sort((a, b) => a - b)).toEqual(names.map((_, i) => i));
    expect(ganadores).not.toEqual(names.map((_, i) => i));
    const c = pintar(names, ganadores, "Turnos");
    const mostrados = [...c.querySelectorAll<HTMLElement>(".winner-lista .winner-name")].map((e) => e.textContent);
    expect(mostrados).toEqual(ganadores.map((i) => names[i]));
    // Y cada renglón conserva su número y su id en la posición que le toca.
    [...c.querySelectorAll<HTMLElement>(".winner-lista > li")].forEach((li, k) => {
      expect(li.querySelector(".winner-num")?.textContent).toBe(`Turno ${k + 1}`);
      expect(li.querySelector(".winner-name")?.id).toBe(`wn-${k}`);
    });
  });

  it.each(TAMANOS)("en lo que se copia, con %i turnos: «1. Ana, 2. Beto...» en el orden del sorteo", async (n) => {
    const names = nombres(n);
    const ganadores = ganadoresDe(n);
    const c = pintar(names, ganadores, "Turnos");
    const escrito = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: escrito } });
    const boton = c.querySelector("[data-copiar-orden]") as HTMLButtonElement;
    expect(alCopiarOrden({ target: boton } as unknown as Event)).toBe(true);
    await vi.waitFor(() => expect(escrito).toHaveBeenCalledTimes(1));
    const esperado = ganadores.map((i, k) => `${k + 1}. ${names[i]}`).join(", ");
    expect(escrito).toHaveBeenCalledWith(esperado);
    expect(esperado.startsWith(`1. ${names[ganadores[0] as number]}, 2. ${names[ganadores[1] as number]}`)).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("un orden de turnos repartido", () => {
  it("el resultado y lo que se copia muestran el nombre sin el sufijo de la línea", () => {
    const names = ["Ana Quispe (1/2)", "Ana Quispe (2/2)", "Beto Rojas", "Carla Suárez (1/2)", "Carla Suárez (2/2)"];
    const winners = [4, 1, 2, 0, 3];
    const c = pintar(names, winners, "Turnos");
    const mostrados = [...c.querySelectorAll<HTMLElement>(".winner-lista .winner-name")].map((e) => e.textContent);
    expect(mostrados).toEqual(["Carla Suárez", "Ana Quispe", "Beto Rojas", "Ana Quispe", "Carla Suárez"]);
    expect(c.querySelector("[data-copiar-orden]")?.getAttribute("data-orden")).toBe(
      "1. Carla Suárez, 2. Ana Quispe, 3. Beto Rojas, 4. Ana Quispe, 5. Carla Suárez",
    );
  });

  it("la lista tal como se selló conserva el sufijo: sin la opción, las líneas se ven como están", async () => {
    const { htmlDeTurnos } = await import("./lista-de-turnos");
    const names = ["Ana Quispe (1/2)", "Ana Quispe (2/2)", "Beto Rojas"];
    const caja = document.createElement("div");
    caja.innerHTML = htmlDeTurnos(names, [1, 2, 0], { titulo: false });
    const mostrados = [...caja.querySelectorAll<HTMLElement>(".winner-lista .winner-name")].map((e) => e.textContent);
    expect(mostrados).toEqual(["Ana Quispe (2/2)", "Beto Rojas", "Ana Quispe (1/2)"]);
  });
});

describe("«Copiar el orden»", () => {
  it("con más de ocho turnos está arriba y abajo, y los dos copian lo mismo; la comprobación no lo duplica", async () => {
    const names = nombres(12);
    const ganadores = ganadoresDe(12);
    const c = pintar(names, ganadores, "Turnos");
    const botones = [...c.querySelectorAll<HTMLButtonElement>("[data-copiar-orden]")];
    expect(botones).toHaveLength(2);
    const lista = c.querySelector(".winner-lista") as HTMLElement;
    const [arriba, abajo] = botones as [HTMLButtonElement, HTMLButtonElement];
    expect(arriba.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(abajo.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(arriba.dataset.orden).toBe(abajo.dataset.orden);
    // Con ocho o menos, solo el de abajo.
    expect(pintar(nombres(8), ganadoresDe(8), "Turnos").querySelectorAll("[data-copiar-orden]")).toHaveLength(1);
    // La lista de la comprobación, sin la opción, conserva un solo botón.
    const { htmlDeTurnos } = await import("./lista-de-turnos");
    const caja = document.createElement("div");
    caja.innerHTML = htmlDeTurnos(names, ganadores, { titulo: false });
    expect(caja.querySelectorAll("[data-copiar-orden]")).toHaveLength(1);
  });

  it("avisa que copió, y vuelve a su texto", async () => {
    vi.useFakeTimers();
    try {
      const c = pintar(nombres(4), ganadoresDe(4), "Turnos");
      vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
      const boton = c.querySelector("[data-copiar-orden]") as HTMLButtonElement;
      alCopiarOrden({ target: boton } as unknown as Event);
      await vi.advanceTimersByTimeAsync(0);
      expect(boton.textContent).toBe(T.es.copied);
      await vi.advanceTimersByTimeAsync(2000);
      expect(boton.textContent).toBe("Copiar el orden");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("sin permiso para el portapapeles, el texto queda a la vista, ya elegido, una sola vez", async () => {
    const c = pintar(nombres(3), [2, 0, 1], "Turnos");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("sin permiso"))) } });
    const boton = c.querySelector("[data-copiar-orden]") as HTMLButtonElement;
    alCopiarOrden({ target: boton } as unknown as Event);
    await vi.waitFor(() => expect(c.querySelector("textarea.turnos-texto")).not.toBeNull());
    expect((c.querySelector("textarea.turnos-texto") as HTMLTextAreaElement).value).toBe("1. Persona <3> & Co, 2. Persona <1> & Co, 3. Persona <2> & Co");
    alCopiarOrden({ target: boton } as unknown as Event);
    await new Promise((r) => setTimeout(r, 10));
    expect(c.querySelectorAll("textarea.turnos-texto")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("un toque en otra cosa no es de este botón", () => {
    const c = pintar(nombres(3), ganadoresDe(3), "Turnos");
    expect(alCopiarOrden({ target: c.querySelector(".winner-name") } as unknown as Event)).toBe(false);
    expect(alCopiarOrden({ target: null } as unknown as Event)).toBe(false);
  });
});

describe("la pantalla grande de un orden de turnos", () => {
  async function abrir(names: string[], winners: number[], prize: string): Promise<HTMLElement> {
    vi.resetModules();
    document.body.innerHTML = "";
    const { app } = await import("../state");
    app.frozen = { names, listHash: "00".repeat(32), ts: 1, at: "", prize, round: 1 } as never;
    app.drawn = { beacon: { round: 1, randomness: "00".repeat(32), signature: "" }, winners } as never;
    const { mostrarResultado } = await import("./pantalla");
    await mostrarResultado("https://tinkazo.app/v#x");
    return document.querySelector(".pantalla") as HTMLElement;
  }

  it.each(TAMANOS)("con %i turnos: la lista en el orden del sorteo, «Turno k», sin caras ni «Se llevan»", async (n) => {
    const names = nombres(n);
    const ganadores = ganadoresDe(n);
    const p = await abrir(names, ganadores, "Turnos");
    expect(p.classList.contains("turnos")).toBe(true);
    expect(p.classList.contains("lista")).toBe(true);
    const nombresVistos = [...p.querySelectorAll<HTMLElement>(".pantalla-lista .pantalla-nombre")].map((e) => e.textContent);
    expect(nombresVistos).toEqual(ganadores.map((i) => names[i]));
    const filas = [...p.querySelectorAll<HTMLElement>(".pantalla-lista .pantalla-fila")];
    expect(filas).toHaveLength(n);
    expect(filas[0]?.querySelector(".pantalla-num")?.textContent).toBe("Turno 1");
    expect(filas[n - 1]?.querySelector(".pantalla-num")?.textContent).toBe(`Turno ${n}`);
    expect(p.querySelectorAll(".pantalla-ganador")).toHaveLength(0);
    expect(p.querySelectorAll(".pantalla-ganadores img")).toHaveLength(0);
    expect(p.querySelector(".pantalla-llevan")?.textContent).toBe("El orden de los turnos");
    expect(p.querySelector(".sala-pie")?.textContent).toBe("Nadie eligió este orden: la lista se cerró antes de que existiera el número que lo decidió.");
    expect(p.textContent).not.toMatch(/Se llevan?|premio|ganador|gana|suerte/i);
  });

  // Doce líneas para once equipos: dos se llaman «Grupo 4 (1/2)» y «Grupo 4 (2/2)» a propósito.
  const grupos = (): string[] => [
    ...Array.from({ length: 3 }, (_, i) => `Grupo ${i + 1}`),
    "Grupo 4 (1/2)",
    "Grupo 4 (2/2)",
    ...Array.from({ length: 7 }, (_, i) => `Grupo ${i + 5}`),
  ];
  const sinModo = (): void => {
    history.replaceState(null, "", "/");
    try {
      sessionStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
  };

  it("con los modos apagados, la pantalla grande muestra las líneas tal cual, como la página y la verificación", async () => {
    sinModo();
    const names = grupos();
    const p = await abrir(names, names.map((_, i) => i), "Turnos de exposición");
    const vistos = [...p.querySelectorAll<HTMLElement>(".pantalla-lista .pantalla-nombre")].map((e) => e.textContent);
    expect(vistos).toEqual(names);
    expect(vistos).toContain("Grupo 4 (1/2)");
    expect(vistos).toContain("Grupo 4 (2/2)");
  });

  it("con los modos a la vista, el reparto que cierra se lee por persona", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    try {
      const names = grupos();
      const p = await abrir(names, names.map((_, i) => i), "Turnos de exposición");
      const vistos = [...p.querySelectorAll<HTMLElement>(".pantalla-lista .pantalla-nombre")].map((e) => e.textContent);
      expect(vistos.filter((n) => n === "Grupo 4")).toHaveLength(2);
      expect(vistos.join("|")).not.toContain("(1/2)");
    } finally {
      sinModo();
    }
  });

  it("3 poleras entre 3 personas en grande sigue siendo lo de siempre", async () => {
    const p = await abrir(nombres(3), ganadoresDe(3), "3 poleras");
    expect(p.classList.contains("turnos")).toBe(false);
    expect(p.querySelectorAll(".pantalla-ganador")).toHaveLength(3);
    expect(p.querySelector(".pantalla-llevan")?.textContent).toBe("Se llevan: 3 poleras");
  });
});

describe("las palabras de turnos", () => {
  it("en los dos idiomas, sin las palabras de ganar", () => {
    const prohibidas = /ganador|ganan?\b|premio|pozo|suerte|aportes|winner|\bwins?\b|prize|\bpot\b|luck|rifa|lotería|raffle|lottery|pasanaku/i;
    for (const clave of ["turnsWord", "turnsResultTitle", "turnsCopy", "turnsPie", "turnsAgainFew"]) {
      for (const l of ["es", "en"] as const) {
        const v = T[l][clave];
        expect(typeof v, `${l}.${clave}`).toBe("string");
        expect(v as string, `${l}.${clave}`).not.toMatch(prohibidas);
        expect(v as string, `${l}.${clave}`).not.toContain(String.fromCharCode(0xb7));
      }
    }
    expect(T.en.turnsWord).toBe("Turn");
    expect(T.en.turnsResultTitle).toBe("The turn order");
    expect(T.en.turnsCopy).toBe("Copy the order");
  });
});
