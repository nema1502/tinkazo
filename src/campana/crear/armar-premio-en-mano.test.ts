import { describe, expect, it, vi } from "vitest";
import { validarCampanaParaElFirmador, validarCampanaParaFirmar } from "../../sala/validar-campana";
import { network } from "../../stellar/config";
import { leerCampana } from "../modelo";
import type { Bilingue } from "../modelo";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { armarCampana, campanaParaLaVista, faltasDelPaso, formularioDesdeTexto, pasoDelFallo } from "./armar";
import { basesAutomaticas, basesFinales, type DatosDeLasBases } from "./bases";
import { formularioInicial, leerGuardado, reducir, type FormularioDeCampana } from "./estado";
import { instanteDe } from "./horas";

/**
 * El armador de una campaña de personas con el premio en mano: el premio se escribe, los montos van en cero, el archivo lleva
 * premio_en_mano y las bases dicen la verdad. Una campaña de cuentas, con o sin la identidad pedida en la dirección, sale igual.
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
    ...(f.premioEnMano !== undefined ? { premioEnMano: f.premioEnMano.trim() || "Tu premio" } : {}),
  };
}
const automaticas = (f: FormularioDeCampana): Bilingue => basesAutomaticas(datosDeBases(f), dic);

function lleno(premio: string | null = "Auriculares"): FormularioDeCampana {
  return {
    ...formularioInicial(LA_PAZ, "k3f9"),
    nombre: "Alcancía Andina",
    color: "verde",
    monto: premio === null ? 40 : null,
    ganan: 3,
    fecha: "2026-11-21",
    lugar: "Hackathon",
    ...(premio !== null ? { premioEnMano: premio } : {}),
  };
}

const armar = (f: FormularioDeCampana, identidad?: "persona"): Record<string, unknown> =>
  armarCampana(f, { bases: basesFinales(f.bases, automaticas(f)).bases, ...(identidad ? { identidad } : {}) });
const abrir = (texto: string): ReturnType<typeof formularioDesdeTexto> =>
  formularioDesdeTexto(texto, { zonaDelNavegador: "UTC", red: network.name, sufijo: "zzzz", automaticas });

describe("el estado: escribir el premio", () => {
  it("la acción guarda el texto sin invisibles ni controles y lo corta a 60 caracteres", () => {
    const f = reducir(lleno(""), { t: "premio-mano", valor: `Una bici\u200B\n${"x".repeat(80)}` });
    expect(f.premioEnMano).toBe(`Una bici${"x".repeat(52)}`);
    expect(f.premioEnMano?.length).toBe(60);
  });

  it("sin premio escrito falta el premio, y lo dice con ccFaltaPremioMano en su campo", () => {
    expect(faltasDelPaso(lleno(""), 2, AHORA, automaticas(lleno("")))).toEqual([
      { paso: 2, clave: "ccFaltaPremioMano", donde: "ccp-premio-mano" },
    ]);
    expect(faltasDelPaso(lleno("   "), 2, AHORA, automaticas(lleno("   ")))).toHaveLength(1);
  });

  it("con premio escrito no falta nada, aunque no haya monto", () => {
    expect(faltasDelPaso(lleno("Auriculares"), 2, AHORA, automaticas(lleno()))).toEqual([]);
  });

  it("sin modo en mano sigue faltando el monto, como siempre", () => {
    const f = { ...lleno(null), monto: null };
    expect(faltasDelPaso(f, 2, AHORA, automaticas(f))).toEqual([{ paso: 2, clave: "ccFaltaMonto", donde: "ccp-monto" }]);
  });

  it("lo guardado en el navegador se lee de nuevo con el premio, y uno largo o raro se descarta", () => {
    const guardado = JSON.parse(JSON.stringify(lleno("Auriculares"))) as Record<string, unknown>;
    expect(leerGuardado(JSON.stringify(guardado))?.premioEnMano).toBe("Auriculares");
    expect(leerGuardado(JSON.stringify({ ...guardado, premioEnMano: "x".repeat(61) }))).toBeNull();
    expect(leerGuardado(JSON.stringify({ ...guardado, premioEnMano: 7 }))).toBeNull();
    const sin = JSON.parse(JSON.stringify(lleno(null))) as Record<string, unknown>;
    expect("premioEnMano" in (leerGuardado(JSON.stringify(sin)) ?? {})).toBe(false);
  });

  it("pasoDelFallo manda premio_en_mano al paso 2", () => {
    expect(pasoDelFallo("premio_en_mano", false)).toBe(2);
  });
});

describe("armarCampana con premio en mano", () => {
  it("escribe premio_en_mano en las dos lenguas y los premios en cero, uno por persona", () => {
    const a = armar(lleno("Auriculares"), "persona");
    expect(a.identidad).toBe("persona");
    expect(a.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    expect(a.premios).toEqual(["0", "0", "0"]);
  });

  it("recorta los espacios del premio", () => {
    expect(armar(lleno("  Una bici  "), "persona").premio_en_mano).toEqual({ es: "Una bici", en: "Una bici" });
  });

  it("lo acepta la sala, el sitio y el firmador, y el sitio lo lee con su premio", () => {
    const texto = JSON.stringify(armar(lleno("Auriculares"), "persona"));
    expect(validarCampanaParaFirmar(texto, AHORA)).toEqual({ ok: true });
    expect(validarCampanaParaElFirmador(texto, AHORA)).toEqual({ ok: true });
    const lectura = leerCampana({ ...(JSON.parse(texto) as Record<string, unknown>), red: network.name });
    expect(lectura.ok && lectura.campana.premioEnMano).toEqual({ es: "Auriculares", en: "Auriculares" });
  });

  it("sin pedir la identidad no hay premio en mano: sale la campaña de siempre con sus montos", () => {
    const a = armar(lleno("Auriculares"));
    expect("premio_en_mano" in a).toBe(false);
    expect("identidad" in a).toBe(false);
  });

  it("una campaña de cuentas con la identidad pedida sigue sin ninguna clave nueva", () => {
    const a = armar(lleno(null));
    expect("premio_en_mano" in a).toBe(false);
    expect(a.premios).toEqual(["400000000", "400000000", "400000000"]);
  });

  it("un archivo con premio en mano se abre con su premio y se vuelve a armar igual", () => {
    const original = armar(lleno("Auriculares"), "persona");
    const hecho = abrir(JSON.stringify(original));
    expect(hecho.ok).toBe(true);
    if (!hecho.ok) return;
    expect(hecho.formulario.premioEnMano).toBe("Auriculares");
    expect(hecho.formulario.monto).toBeNull();
    expect(hecho.formulario.ganan).toBe(3);
    expect(armar(hecho.formulario)).toEqual(original);
  });

  it("el inglés propio del archivo se repite mientras el español no cambie", () => {
    const original = { ...armar(lleno("Auriculares"), "persona"), premio_en_mano: { es: "Auriculares", en: "Headphones" } };
    const hecho = abrir(JSON.stringify(original));
    if (!hecho.ok) throw new Error("no abrió");
    expect(armar(hecho.formulario).premio_en_mano).toEqual({ es: "Auriculares", en: "Headphones" });
    const cambiado = reducir(hecho.formulario, { t: "premio-mano", valor: "Una bici" });
    expect(armar(cambiado).premio_en_mano).toEqual({ es: "Una bici", en: "Una bici" });
  });

  it("un archivo de cuentas abierto con la dirección de personas sigue siendo de cuentas", () => {
    const hecho = abrir(JSON.stringify(armar(lleno(null))));
    if (!hecho.ok) throw new Error("no abrió");
    expect(hecho.formulario.premioEnMano).toBeUndefined();
    const a = armar(hecho.formulario, "persona");
    expect("identidad" in a).toBe(false);
    expect("premio_en_mano" in a).toBe(false);
    expect(a.premios).toEqual(["400000000", "400000000", "400000000"]);
  });
});

describe("la vista de la campaña con premio en mano", () => {
  const opciones = (f: FormularioDeCampana): Parameters<typeof campanaParaLaVista>[1] => ({
    ahora: AHORA,
    muestraMarca: "Tu marca",
    muestraLugar: { es: "Tu evento", en: "Your event" },
    muestraPremio: { es: "Tu premio", en: "Your prize" },
    bases: automaticas(f),
  });

  it("la campaña de muestra la lee el sitio, con el premio escrito y sin montos", () => {
    const f = lleno("Auriculares");
    const { campana, muestras } = campanaParaLaVista(f, opciones(f));
    expect(campana.premios).toEqual(["0", "0", "0"]);
    expect(campana.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    expect(campana.identidad).toBe("persona");
    expect(muestras.premio).toBe(false);
    expect(leerCampana({ ...campana, red: network.name }).ok).toBe(true);
  });

  it("sin premio escrito pone uno de muestra y lo dice", () => {
    const f = lleno("");
    const { campana, muestras } = campanaParaLaVista(f, opciones(f));
    expect(campana.premio_en_mano).toEqual({ es: "Tu premio", en: "Your prize" });
    expect(muestras.premio).toBe(true);
    expect(leerCampana({ ...campana, red: network.name }).ok).toBe(true);
  });

  it("una campaña de cuentas se ve como siempre", () => {
    const f = lleno(null);
    const { campana } = campanaParaLaVista(f, opciones(f));
    expect("premio_en_mano" in campana).toBe(false);
    expect("identidad" in campana).toBe(false);
    expect(campana.premios).toEqual(["400000000", "400000000", "400000000"]);
  });
});

describe("las bases con premio en mano", () => {
  const datos = (cambio: Partial<DatosDeLasBases> = {}): DatosDeLasBases => ({
    marca: "Alcancía Andina",
    ganan: 3,
    monto: 40,
    sorteoMs: Date.UTC(2026, 10, 21, 22, 30),
    zona: LA_PAZ,
    conRedes: true,
    costo: { es: null, en: "0,5" },
    premioEnMano: "Auriculares",
    ...cambio,
  });

  it("en español con varias personas, sin dólares y con el premio después de dos puntos", () => {
    expect(basesAutomaticas(datos(), dic).es).toBe(
      [
        "Participar es gratis y es una vez por persona, entrando con tu cuenta de Google.",
        "Para participar hay que estar en el evento. Seguir a Alcancía Andina en sus redes es un pedido y no cambia quién gana.",
        "Hay 3 premios, uno para cada persona que gana: Auriculares. El sorteo es a las 18:30 y cualquiera puede comprobar el resultado.",
        "El premio se entrega en mano en el evento, a la persona que ganó. Si no está, Alcancía Andina decide qué hacer con él.",
        "Recibir el premio es gratis.",
        "Tu nombre de Google puede verse en la pantalla del evento. Lo que guarda Tinkazo está en sus Términos.",
        "Alcancía Andina pone los premios y responde por ellos. Tinkazo es la herramienta que hace el sorteo.",
        "La lista la sella la cuenta que organiza esta campaña, y solo vale el sello de la lista de personas anotadas que se ve en la pantalla. Un sello de otra cuenta o de otra lista no cuenta para esta campaña.",
      ].join("\n"),
    );
  });

  it("en inglés con una persona y sin redes", () => {
    const en = basesAutomaticas(datos({ ganan: 1, conRedes: false, premioEnMano: "Headphones" }), dic).en.split("\n");
    expect(en[1]).toBe("To take part you must be at the event.");
    expect(en[2]).toBe(
      "There is one prize for one of the people signed up: Headphones. The draw is at 18:30 and anyone can check the result.",
    );
    expect(en[3]).toBe("The prize is handed over in person at the event, to the person who won. If they aren't there, Alcancía Andina decides what to do with it.");
    expect(en[5]).toBe("Your Google name may show on the event screen. What Tinkazo keeps is in its Terms.");
  });

  it("no prometen qué guarda Tinkazo y mandan a sus Términos, con el interruptor del perfil apagado o prendido", () => {
    // Las bases quedan firmadas dentro de la campaña cuando se arma: no pueden depender de un interruptor que se prende después.
    const apagado = basesAutomaticas(datos(), dic);
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GUARDAR_PERFIL", "1");
    const prendido = basesAutomaticas(datos(), dic);
    vi.unstubAllEnvs();
    expect(prendido).toEqual(apagado);
    expect(apagado.es).toContain("Lo que guarda Tinkazo está en sus Términos.");
    expect(apagado.en).toContain("What Tinkazo keeps is in its Terms.");
    for (const idioma of ["es", "en"] as const) {
      expect(apagado[idioma], idioma).not.toMatch(/no guarda|doesn't store|does not store|don't keep|no guardamos/iu);
      expect(apagado[idioma], idioma).not.toMatch(/correo|email/iu);
    }
  });

  it("no nombra dólares, cuenta de Tinkazo, plazo de 7 días ni costo de retirar", () => {
    for (const idioma of ["es", "en"] as const) {
      const texto = basesAutomaticas(datos(), dic)[idioma];
      expect(texto).not.toMatch(/dólares|dollars|7 días|7 days|retirar|taking it out|llega a tu cuenta|arrives in your/iu);
    }
  });

  it("un premio con mayúsculas, llaves o punto final se pone tal cual", () => {
    const es = basesAutomaticas(datos({ ganan: 1, premioEnMano: "Un iPhone {hora}." }), dic).es;
    expect(es).toContain("una de las personas anotadas: Un iPhone {hora}. El sorteo es a las 18:30");
  });

  it("sin premio en mano las bases son las de siempre", () => {
    const { premioEnMano: _quitado, ...sin } = datos();
    expect(basesAutomaticas(sin, dic).es).toContain("Se sortean 3 premios de 40 dólares digitales");
    expect(basesAutomaticas({ ...sin, premioEnMano: null }, dic).es).toBe(basesAutomaticas(sin, dic).es);
  });
});
