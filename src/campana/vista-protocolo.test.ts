import { describe, expect, it } from "vitest";
import { VISTA_PREVIA, leerMensajeDeVista } from "./vista-protocolo";

const padre = { ventana: "arriba" };
const propio = { origen: "https://tinkazo.app", padre };
const datos = (cambio: Record<string, unknown> = {}): Record<string, unknown> => ({
  t: VISTA_PREVIA,
  campana: { v: 1 },
  pantalla: "hola",
  idioma: "en",
  muestras: { nombre: true, premio: false, lugar: false, horas: true },
  festejar: false,
  reglasAbiertas: true,
  ...cambio,
});
const evento = (data: unknown, cambio: { origin?: string; source?: unknown } = {}): { origin: string; source: unknown; data: unknown } => ({
  origin: cambio.origin ?? propio.origen,
  source: "source" in cambio ? cambio.source : padre,
  data,
});

describe("leerMensajeDeVista", () => {
  it("lee un mensaje del mismo origen y de la ventana de arriba", () => {
    expect(leerMensajeDeVista(evento(datos()), propio)).toEqual(datos());
  });

  it("no lee uno de otro origen ni de otra ventana", () => {
    expect(leerMensajeDeVista(evento(datos(), { origin: "https://ajena.example.org" }), propio)).toBeNull();
    expect(leerMensajeDeVista(evento(datos(), { source: {} }), propio)).toBeNull();
  });

  it("no lee nada si la página no tiene ventana de arriba", () => {
    expect(leerMensajeDeVista(evento(datos(), { source: null }), { origen: propio.origen, padre: null })).toBeNull();
  });

  it("no lee uno con otra forma", () => {
    for (const malo of [null, "x", [], datos({ t: "otro" }), datos({ campana: null }), datos({ pantalla: "x" }), datos({ idioma: "fr" }),
      datos({ muestras: null }), datos({ festejar: "si" }), datos({ reglasAbiertas: 1 })]) {
      expect(leerMensajeDeVista(evento(malo), propio)).toBeNull();
    }
  });
});
