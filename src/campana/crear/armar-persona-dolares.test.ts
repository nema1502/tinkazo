import { describe, expect, it } from "vitest";
import { leerTextoDeCampana } from "../../../workers/sala/src/campana";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { network } from "../../stellar/config";
import { leerCampana, type Bilingue } from "../modelo";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { armarCampana, campanaParaLaVista, formularioDesdeTexto } from "./armar";
import { basesAutomaticas, basesFinales, type DatosDeLasBases } from "./bases";
import { formularioInicial, type FormularioDeCampana } from "./estado";
import { instanteDe } from "./horas";
import { GANAN_MAXIMO_CON_ENVIO } from "./modo";

/**
 * El archivo de una campaña de personas con el premio en dólares: lleva la identidad de personas y los montos de siempre, sin
 * premio escrito, con las bases de este modo. Lo leen la sala y el sitio. Y la campaña que se le manda a la vista del celular
 * lleva la identidad cuando se la piden, para que la vista sea la de una campaña de personas.
 */

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
    personas: true,
  };
}
const automaticas = (f: FormularioDeCampana): Bilingue => basesAutomaticas(datosDeBases(f), dic);

function lleno(cambios: Partial<FormularioDeCampana> = {}): FormularioDeCampana {
  return {
    ...formularioInicial(LA_PAZ, "k3f9"),
    nombre: "Alcancía Andina",
    color: "verde",
    monto: 40,
    ganan: 3,
    fecha: "2026-11-21",
    lugar: "Hackathon",
    ...cambios,
  };
}

const armar = (f: FormularioDeCampana): Record<string, unknown> =>
  armarCampana(f, { bases: basesFinales(f.bases, automaticas(f)).bases, identidad: "persona" });
const abrir = (texto: string): ReturnType<typeof formularioDesdeTexto> =>
  formularioDesdeTexto(texto, { zonaDelNavegador: "UTC", red: network.name, sufijo: "zzzz", automaticas });

const paraLaVista = (f: FormularioDeCampana, identidad?: "persona"): ReturnType<typeof campanaParaLaVista> =>
  campanaParaLaVista(f, {
    ahora: AHORA,
    muestraMarca: "Tu marca",
    muestraLugar: { es: "Tu evento", en: "Your event" },
    muestraPremio: { es: "Tu premio", en: "Your prize" },
    bases: automaticas(f),
    ...(identidad ? { identidad } : {}),
  });

describe("el archivo de una campaña de personas con dólares", () => {
  it("lleva la identidad de personas y los montos, sin premio escrito", () => {
    const a = armar(lleno());
    expect(a.identidad).toBe("persona");
    expect(a.premios).toEqual(["400000000", "400000000", "400000000"]);
    expect("premio_en_mano" in a).toBe(false);
    expect(a.entrada).toBe("google");
    expect(Object.keys(a)).toEqual([
      "v", "evento", "red", "estado", "empresa", "lugar", "zona", "premios", "abre_ms", "cierra_ms", "sorteo_ms",
      "recibir_hasta_ms", "entrada", "pasos", "bases", "anotadas", "contrato", "promo", "comprobante", "identidad",
    ]);
  });

  it("sus bases son las de este modo, en los dos idiomas", () => {
    const bases = armar(lleno()).bases as Bilingue;
    expect(bases.es).toContain("Quien gana le muestra su código a Alcancía Andina el día del evento");
    expect(bases.en).toContain("The winner shows their code to Alcancía Andina on the day of the event");
    expect(bases.es).not.toContain("El premio llega a tu cuenta de Tinkazo");
  });

  it("lo aceptan la sala y el sitio, y cada uno lee la identidad", () => {
    const texto = JSON.stringify(armar(lleno()));
    expect(validarCampanaParaFirmar(texto, AHORA)).toEqual({ ok: true });
    const sala = leerTextoDeCampana(texto, AHORA);
    expect(sala).toMatchObject({ ok: true, premios: 3, identidad: "persona" });
    const sitio = leerCampana({ ...(JSON.parse(texto) as Record<string, unknown>), red: network.name });
    expect(sitio.ok).toBe(true);
    if (!sitio.ok) return;
    expect(sitio.campana.identidad).toBe("persona");
    expect(sitio.campana.premioEnMano).toBeUndefined();
    expect(sitio.campana.premios).toEqual([400000000n, 400000000n, 400000000n]);
  });

  it("con el tope de personas que ganan en este modo también lo aceptan los dos", () => {
    const texto = JSON.stringify(armar(lleno({ ganan: GANAN_MAXIMO_CON_ENVIO, monto: 5 })));
    expect(validarCampanaParaFirmar(texto, AHORA)).toEqual({ ok: true });
    expect((JSON.parse(texto) as { premios: string[] }).premios).toHaveLength(8);
  });

  it("al abrirlo conserva la identidad, el monto y cuántas ganan, y sus bases siguen siendo las automáticas", () => {
    const hecho = abrir(JSON.stringify(armar(lleno())));
    expect(hecho.ok).toBe(true);
    if (!hecho.ok) return;
    const f = hecho.formulario;
    expect(f.conservado?.identidad).toBe("persona");
    expect(f.conservado && "premioEnMano" in f.conservado).toBe(false);
    expect("premioEnMano" in f).toBe(false);
    expect(f.monto).toBe(40);
    expect(f.ganan).toBe(3);
    expect(f.bases).toEqual({ es: null, en: null, moldeEs: null, moldeEn: null });
    // Vuelve a armarse igual, sin pedir nada.
    const deNuevo = armarCampana(f, { bases: basesFinales(f.bases, automaticas(f)).bases });
    expect(deNuevo.identidad).toBe("persona");
    expect(deNuevo.premios).toEqual(["400000000", "400000000", "400000000"]);
    expect("premio_en_mano" in deNuevo).toBe(false);
  });
});

describe("la campaña que se le manda a la vista del celular", () => {
  it("con la identidad pedida la lleva, con sus montos y sin premio escrito", () => {
    const { campana, muestras } = paraLaVista(lleno(), "persona");
    expect(campana.identidad).toBe("persona");
    expect("premio_en_mano" in campana).toBe(false);
    expect(campana.premios).toEqual(["400000000", "400000000", "400000000"]);
    expect(muestras.premio).toBe(false);
    const lectura = leerCampana({ ...campana, red: network.name });
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.campana.identidad).toBe("persona");
    expect(lectura.campana.premioEnMano).toBeUndefined();
  });

  it("sin monto elegido muestra uno de muestra y lo dice, también con la identidad", () => {
    const { campana, muestras } = paraLaVista(lleno({ monto: null, ganan: 1 }), "persona");
    expect(campana.identidad).toBe("persona");
    expect(campana.premios).toEqual(["400000000"]);
    expect(muestras.premio).toBe(true);
    expect(leerCampana({ ...campana, red: network.name }).ok).toBe(true);
  });

  it("sin pedirla es la de siempre, sin ninguna clave nueva", () => {
    const sin = paraLaVista(lleno()).campana;
    expect("identidad" in sin).toBe(false);
    const { identidad: _identidad, ...resto } = paraLaVista(lleno(), "persona").campana;
    expect(resto).toEqual(sin);
  });

  it("con el premio escrito la vista es la de premio en mano, se pida o no la identidad", () => {
    const enMano = lleno({ monto: null, premioEnMano: "Auriculares" });
    const pidiendo = paraLaVista(enMano, "persona").campana;
    expect(pidiendo).toEqual(paraLaVista(enMano).campana);
    expect(pidiendo.identidad).toBe("persona");
    expect(pidiendo.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    expect(pidiendo.premios).toEqual(["0", "0", "0"]);
  });
});
