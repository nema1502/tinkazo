// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de quien organiza cuando las campañas de personas no están prendidas: si la sala contesta que no las tiene, el
 * panel lo dice con un título, una línea y un botón, y nunca como una falta de conexión, porque repetir el pedido no lo
 * arregla. Y antes de ofrecer Abrir la inscripción de una campaña de personas pregunta si se puede: si el sitio no las sabe
 * abrir, o la sala no las tiene prendidas con el mismo identificador, lo dice ahí mismo y no crea ninguna sala, para que
 * quien organiza no se entere por la gente. Si la pregunta no tiene respuesta deja abrir, como siempre. Una campaña de
 * cuentas no pasa por nada de esto.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { leerCampana } from "../campana/modelo";
import { reiniciarElPuente } from "../campana/puente";
import { guardarOrg } from "../sala/campana-org";
import {
  SALA,
  type Mundo,
  type Panel,
  archivoDe,
  boton,
  botones,
  campanaDeArchivo,
  cerrarTodos,
  elegirArchivo,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
} from "./campana-sala-mundo";

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

/** Una pregunta que la prueba contesta cuando quiere, y la cuenta de cuántas veces se hizo. */
function conPregunta(m: Mundo): { veces: () => number; contestar: (r: boolean | null) => Promise<void> } {
  let veces = 0;
  const pendientes: ((r: boolean | null) => void)[] = [];
  m.deps.personasListas = () => {
    veces++;
    return new Promise((resolver) => pendientes.push(resolver));
  };
  return {
    veces: () => veces,
    contestar: async (r) => {
      pendientes.shift()?.(r);
      await suelta(3);
    },
  };
}

describe("antes de ofrecer abrir una campaña de personas", () => {
  it("pregunta si se puede, y mientras tanto dice que revisa y no ofrece abrir", async () => {
    const m = mundo();
    const q = conPregunta(m);
    const p = await conArchivoDePersonas(m);
    expect(q.veces()).toBe(1);
    expect(rotulos(p)).not.toContain("Abrir la inscripción");
    expect(rotulosPrincipales(p)).toEqual([]);
    expect(texto(p, "#cpo-fila")).toContain("Revisando que todo esté listo");
    await q.contestar(true);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-fila")).not.toContain("Revisando que todo esté listo");
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(q.veces()).toBe(1);
  });

  it("si no se puede, lo dice en lugar del botón y no crea ninguna sala", async () => {
    const m = mundo();
    const q = conPregunta(m);
    const p = await conArchivoDePersonas(m);
    await q.contestar(false);
    expect(texto(p, "#cpo-h")).toBe(TITULO);
    expect(texto(p, "#cpo-linea")).toBe(LINEA);
    expect(rotulosPrincipales(p)).toEqual(["Probar de nuevo"]);
    expect(rotulos(p)).not.toContain("Abrir la inscripción");
    expect(rotulos(p)).toContain("Elegir otro archivo");
    expect(m.creadas).toEqual([]);
    expect(m.fases).toEqual([]);
    expect(m.qrs).toEqual([]);
  });

  it("Probar de nuevo vuelve a preguntar, y cuando ya se puede ofrece abrir", async () => {
    const m = mundo();
    const q = conPregunta(m);
    const p = await conArchivoDePersonas(m);
    await q.contestar(false);
    boton(p, "Probar de nuevo").click();
    expect(q.veces()).toBe(2);
    expect(rotulosPrincipales(p)).toEqual([]);
    expect(texto(p, "#cpo-fila")).toContain("Revisando que todo esté listo");
    await q.contestar(false);
    expect(rotulosPrincipales(p)).toEqual(["Probar de nuevo"]);
    boton(p, "Probar de nuevo").click();
    await q.contestar(true);
    expect(q.veces()).toBe(3);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-h")).not.toBe(TITULO);
  });

  it("si la pregunta no tiene respuesta, deja abrir como siempre", async () => {
    const m = mundo();
    const q = conPregunta(m);
    const p = await conArchivoDePersonas(m);
    await q.contestar(null);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-h")).not.toBe(TITULO);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("si la pregunta falla, también deja abrir", async () => {
    const m = mundo();
    m.deps.personasListas = async () => {
      throw new Error("sin red");
    };
    const p = await conArchivoDePersonas(m);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
  });

  it("si deja abrir y la sala igual dice que no, queda dicho", async () => {
    const m = mundo();
    const q = conPregunta(m);
    m.respuestasAlCrear.push("personas-apagadas");
    const p = await conArchivoDePersonas(m);
    await q.contestar(null);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe(TITULO));
    expect(rotulosPrincipales(p)).toEqual(["Probar de nuevo"]);
  });

  it("una sala de personas que se retoma sin abrir también pregunta antes de ofrecer abrir", async () => {
    const m = mundo();
    const q = conPregunta(m);
    m.deps.campanaDeSala = async () => {
      const r = leerCampana(JSON.parse(JSON.stringify(campanaDeArchivo(EN_MANO))) as Record<string, unknown>);
      return r.ok ? r.campana : "rechazo";
    };
    guardarOrg(m.almacen, { sala: SALA, fase: "lista" });
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    expect(q.veces()).toBe(1);
    expect(rotulos(p)).not.toContain("Abrir la inscripción");
    await q.contestar(false);
    expect(texto(p, "#cpo-h")).toBe(TITULO);
    expect(rotulosPrincipales(p)).toEqual(["Probar de nuevo"]);
    expect(m.fases).toEqual([]);
  });

  it("una respuesta que llega tarde no toca a la campaña que se eligió después", async () => {
    const m = mundo();
    const q = conPregunta(m);
    const p = await conArchivoDePersonas(m);
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
    await elegirArchivo(m, p, archivoDe());
    await suelta(6);
    await q.contestar(false);
    expect(vistaDe(p)).toBe("previa");
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-h")).not.toBe(TITULO);
  });
});

describe("una campaña de cuentas no pregunta nada", () => {
  it("al elegir el archivo ofrece abrir de una, y abre, sin hacer la pregunta", async () => {
    const m = mundo();
    const q = conPregunta(m);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    await suelta(6);
    expect(q.veces()).toBe(0);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-fila")).toBe("");
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(q.veces()).toBe(0);
  });

  it("al retomar su sala sin abrir tampoco", async () => {
    const m = mundo();
    const q = conPregunta(m);
    guardarOrg(m.almacen, { sala: SALA, fase: "lista" });
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    expect(q.veces()).toBe(0);
    expect(rotulosPrincipales(p)).toEqual(["Abrir la inscripción"]);
  });
});

describe("la pregunta que hace el panel de verdad", () => {
  const CLIENTE = "123-abc.apps.googleusercontent.com";
  /** Una sala de mentira que contesta eso a cualquier pedido, y la lista de lo que se le pidió. */
  function salaQueDice(cuerpo: unknown): string[] {
    const pedidos: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      pedidos.push(String(url));
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    });
    return pedidos;
  }

  it("con el sitio construido sin la entrada de personas dice que no, sin pedirle nada a la sala", async () => {
    const pedidos = salaQueDice({ prendido: true, cliente: CLIENTE });
    const { depsReales } = await import("./campana-sala");
    expect(await depsReales().personasListas?.()).toBe(false);
    expect(pedidos).toEqual([]);
  });

  it("con la entrada en el sitio le pregunta a la sala, y el identificador tiene que ser el mismo", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", CLIENTE);
    const { depsReales } = await import("./campana-sala");
    const pedidos = salaQueDice({ prendido: true, cliente: CLIENTE });
    expect(await depsReales().personasListas?.()).toBe(true);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatch(/\/v1\/personas\/estado$/);
    salaQueDice({ prendido: true, cliente: "otro.apps.googleusercontent.com" });
    expect(await depsReales().personasListas?.()).toBe(false);
    salaQueDice({ prendido: false, cliente: "" });
    expect(await depsReales().personasListas?.()).toBe(false);
  });
});
