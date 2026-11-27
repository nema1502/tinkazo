// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de quien organiza cuando las campañas de personas no están prendidas: si la sala contesta que no las tiene, el
 * panel lo dice con un título, una línea y un botón, y nunca como una falta de conexión, porque repetir el pedido no lo
 * arregla. Una campaña de cuentas no pasa por nada de esto.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { reiniciarElPuente } from "../campana/puente";
import { type Mundo, type Panel, archivoDe, boton, botones, cerrarTodos, elegirArchivo, mundo, nuevoPanel, principales, suelta, texto, vistaDe } from "./campana-sala-mundo";

const EN_MANO = { identidad: "persona", premios: ["0"], premio_en_mano: { es: "Auriculares", en: "Headphones" } };
const TITULO = "Todavía no se puede abrir";
const LINEA = "Este modo todavía no está prendido. Avisale a Tinkazo.";
const conexion = (p: Panel): HTMLElement => p.raiz.querySelector("#cpo-conexion") as HTMLElement;
const rotulos = (p: Panel): string[] => botones(p).map((b) => (b.textContent ?? "").trim());
const rotulosPrincipales = (p: Panel): string[] => principales(p).map((b) => (b.textContent ?? "").trim());

async function conArchivoDePersonas(m: Mundo): Promise<Panel> {
  const p = nuevoPanel(m);
  await elegirArchivo(m, p, archivoDe(EN_MANO));
  await suelta(6);
  expect(vistaDe(p)).toBe("previa");
  return p;
}

beforeEach(() => {
  document.body.innerHTML = "";
  reiniciarElPuente();
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

describe("la sala contesta que las campañas de personas no están prendidas", () => {
  it("el panel lo dice con un título, una línea y un botón, y nunca como falta de conexión", async () => {
    const m = mundo();
    m.respuestasAlCrear.push("personas-apagadas");
    const p = await conArchivoDePersonas(m);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe(TITULO));
    expect(vistaDe(p)).toBe("previa");
    expect(texto(p, "#cpo-linea")).toBe(LINEA);
    expect(rotulosPrincipales(p)).toEqual(["Probar de nuevo"]);
    expect(rotulos(p)).not.toContain("Abrir la inscripción");
    // Dejar el archivo sigue a mano: el estado tiene salida.
    expect(rotulos(p)).toContain("Elegir otro archivo");
    // Lo dicen el título y la línea: el aviso no lo repite ni habla de la conexión.
    expect(texto(p, "#cpo-aviso")).toBe("");
    expect(conexion(p).hidden).toBe(true);
    expect(m.fases).toEqual([]);
    expect(m.qrs).toEqual([]);
  });

  it("Probar de nuevo vuelve a ofrecer abrir, y con la sala ya prendida la inscripción se abre", async () => {
    const m = mundo();
    m.respuestasAlCrear.push("personas-apagadas");
    const p = await conArchivoDePersonas(m);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe(TITULO));
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]));
    expect(texto(p, "#cpo-h")).not.toBe(TITULO);
    expect(texto(p, "#cpo-linea")).not.toBe(LINEA);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas).toHaveLength(2);
  });

  it("si la sala lo vuelve a decir, el panel lo vuelve a decir", async () => {
    const m = mundo();
    m.respuestasAlCrear.push("personas-apagadas", "personas-apagadas");
    const p = await conArchivoDePersonas(m);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe(TITULO));
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]));
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe(TITULO));
    expect(rotulosPrincipales(p)).toEqual(["Probar de nuevo"]);
  });

  it("en inglés lo dice en inglés", async () => {
    const m = mundo();
    m.idioma = "en";
    m.respuestasAlCrear.push("personas-apagadas");
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe(EN_MANO));
    await suelta(6);
    boton(p, "Open sign-up").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("It can't be opened yet"));
    expect(texto(p, "#cpo-linea")).toBe("This mode isn't turned on yet. Let Tinkazo know.");
    expect(rotulosPrincipales(p)).toEqual(["Try again"]);
    expect(texto(p, "#cpo-aviso")).toBe("");
  });

  it("al elegir otro archivo el estado no se arrastra a la campaña siguiente", async () => {
    const m = mundo();
    m.respuestasAlCrear.push("personas-apagadas");
    const p = await conArchivoDePersonas(m);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe(TITULO));
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
    await elegirArchivo(m, p, archivoDe(EN_MANO));
    await suelta(6);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-h")).not.toBe(TITULO);
  });

  it("una falta de conexión al crear sigue diciendo Sin conexión, como siempre", async () => {
    const m = mundo();
    m.respuestasAlCrear.push("red");
    const p = await conArchivoDePersonas(m);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo."));
    expect(texto(p, "#cpo-h")).not.toBe(TITULO);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
  });
});
