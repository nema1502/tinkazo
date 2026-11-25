import { describe, expect, it } from "vitest";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { network } from "../../stellar/config";
import type { Bilingue } from "../modelo";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { armarCampana, formularioDesdeTexto } from "./armar";
import { basesAutomaticas, basesFinales, type DatosDeLasBases } from "./bases";
import { formularioInicial, leerGuardado, type FormularioDeCampana } from "./estado";
import { instanteDe } from "./horas";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const LA_PAZ = "America/La_Paz";
const dic = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";

function datosDeBases(f: FormularioDeCampana): DatosDeLasBases {
  return {
    marca: f.nombre.trim() || "Tu marca",
    ganan: f.ganan,
    monto: f.monto ?? 40,
    sorteoMs: instanteDe(f.fecha, f.sorteo, f.zona) ?? AHORA,
    zona: f.zona,
    conRedes: f.pasos.length > 0,
    costo: { es: null, en: null },
  };
}

const automaticas = (f: FormularioDeCampana): Bilingue => basesAutomaticas(datosDeBases(f), dic);

function lleno(): FormularioDeCampana {
  return {
    ...formularioInicial(LA_PAZ, "k3f9"),
    nombre: "Alcancía Andina",
    color: "verde",
    monto: 40,
    ganan: 3,
    fecha: "2026-11-21",
    lugar: "Hackathon",
  };
}

const armar = (f: FormularioDeCampana, identidad?: "persona"): Record<string, unknown> =>
  armarCampana(f, { bases: basesFinales(f.bases, automaticas(f)).bases, ...(identidad ? { identidad } : {}) });

const abrir = (texto: string): ReturnType<typeof formularioDesdeTexto> =>
  formularioDesdeTexto(texto, { zonaDelNavegador: "UTC", red: network.name, sufijo: "zzzz", automaticas });

describe("armarCampana y la identidad de las personas", () => {
  it("sin pedirla arma la campaña de siempre, sin ninguna clave nueva", () => {
    const a = armar(lleno());
    expect("identidad" in a).toBe(false);
    expect(Object.keys(a)).toEqual([
      "v", "evento", "red", "estado", "empresa", "lugar", "zona", "premios", "abre_ms", "cierra_ms", "sorteo_ms",
      "recibir_hasta_ms", "entrada", "pasos", "bases", "anotadas", "contrato", "promo", "comprobante",
    ]);
  });

  it("pidiéndola suma solo el campo y lo demás queda igual", () => {
    const sin = armar(lleno());
    const con = armar(lleno(), "persona");
    expect(con.identidad).toBe("persona");
    const { identidad: _identidad, ...resto } = con;
    expect(resto).toEqual(sin);
  });

  it("la campaña de personas pasa el validador de la sala y del sitio", () => {
    expect(validarCampanaParaFirmar(JSON.stringify(armar(lleno(), "persona")), AHORA)).toEqual({ ok: true });
  });

  it("un archivo de personas que se abre conserva el campo aunque no se vuelva a pedir", () => {
    const hecho = abrir(JSON.stringify(armar(lleno(), "persona")));
    expect(hecho.ok).toBe(true);
    if (!hecho.ok) return;
    expect(hecho.formulario.conservado?.identidad).toBe("persona");
    expect(armar(hecho.formulario).identidad).toBe("persona");
  });

  it("un archivo de siempre que se abre no gana el campo, ni siquiera pidiéndolo en otra campaña", () => {
    const hecho = abrir(JSON.stringify(armar(lleno())));
    expect(hecho.ok).toBe(true);
    if (!hecho.ok) return;
    expect(hecho.formulario.conservado && "identidad" in hecho.formulario.conservado).toBe(false);
    expect("identidad" in armar(hecho.formulario)).toBe(false);
  });

  it("un archivo con identidad cuenta es el de siempre", () => {
    const hecho = abrir(JSON.stringify({ ...armar(lleno()), identidad: "cuenta" }));
    expect(hecho.ok).toBe(true);
    if (!hecho.ok) return;
    expect("identidad" in armar(hecho.formulario)).toBe(false);
  });

  it("lo que se guardó de un borrador de personas se lee de nuevo con su campo", () => {
    const hecho = abrir(JSON.stringify(armar(lleno(), "persona")));
    if (!hecho.ok) throw new Error("no abrió");
    const leido = leerGuardado(JSON.stringify(hecho.formulario));
    expect(leido?.conservado?.identidad).toBe("persona");
  });

  it("un borrador de siempre se lee sin el campo", () => {
    const hecho = abrir(JSON.stringify(armar(lleno())));
    if (!hecho.ok) throw new Error("no abrió");
    const leido = leerGuardado(JSON.stringify(hecho.formulario));
    expect(leido?.conservado && "identidad" in leido.conservado).toBe(false);
  });
});
