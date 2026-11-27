// @vitest-environment jsdom
/** Pruebas de las pantallas públicas con el marcado real de participar.html. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import type { BotonDeGoogle, DepsDelCelular, EstadoPublico, FallaDeEntrada } from "./celular";
import { depsDePersona } from "./conectar-persona";
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
    expect(raiz.querySelector(".cmp-cierre")?.textContent).toContain("Cierra a las 17:00");
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

  it("con correo prendido, lo plegado de las reglas dice que avisan por correo", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, { ...publico, correo: true }, () => undefined);
    expect(raiz.querySelector(".cmp-reglas")?.textContent).toContain("Si ganás, te avisamos por correo.");
  });

  it("con correo prendido y la interfaz en inglés, la línea sale en inglés", () => {
    const { raiz, deps, publico } = preparar();
    setLang("en");
    pintarLaCampana(raiz, deps, { ...publico, correo: true }, () => undefined);
    expect(raiz.querySelector(".cmp-reglas")?.textContent).toContain("If you win, we email you.");
  });

  it("con correo apagado, la línea del correo no aparece", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, { ...publico, correo: false }, () => undefined);
    expect(raiz.querySelector(".cmp-reglas")?.textContent).not.toContain("por correo");
  });

  it("con una sala vieja que no manda el campo, la línea del correo no aparece", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, publico, () => undefined);
    expect(raiz.querySelector(".cmp-reglas")?.textContent).not.toContain("por correo");
  });

  it("la hora de cierre y el contador de al lado terminan igual, sin punto", () => {
    const { raiz, deps, publico } = preparar();
    pintarLaCampana(raiz, deps, publico, () => undefined);
    expect(raiz.querySelector(".cmp-cierre")?.textContent?.endsWith(".")).toBe(false);
    expect(raiz.querySelector(".cmp-contador")?.textContent?.endsWith(".")).toBe(false);
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

describe("una campaña de personas: lo que la pantalla dice que se guarda", () => {
  const google: BotonDeGoogle = { montar: () => () => undefined };
  /** Los textos como los pide el celular de una campaña de personas de verdad: los que cambia `depsDePersona` según la bandera. */
  const txDePersona = (): DepsDelCelular["tx"] =>
    depsDePersona({
      base: {
        tx: texto,
        idioma: getLang,
        enApp: false,
        ahora: () => AHORA,
        cada: () => () => undefined,
        visible: () => true,
        alVolver: () => () => undefined,
        vibrar: () => undefined,
        movimientoReducido: () => false,
      },
      campana: campanaDeEjemplo(AHORA),
      servicio: "https://servicio.example.org",
      sala: "ABCDEFGH",
      clave: "abcdefghijklmnopqrstuv",
      pase: null,
      google: { montar: () => () => undefined },
      memoria: null,
      red: "testnet",
      enLinea: () => true,
      enlace: () => "https://tinkazo.example.org/participar.html",
    }).tx;
  const NOTA_DE_SIEMPRE = "Con Google confirmamos que sos vos. No te creamos ninguna cuenta.";
  const NOTA_CON_PERFIL = "Con Google confirmamos que sos vos. Guardamos tu correo, tu nombre y tu foto.";
  const REGLA_CON_PERFIL =
    "Qué guardamos: tu correo, tu nombre y tu foto de Google, para tu cuenta de Tinkazo. Quien organiza no los recibe. " +
    "En la lista del sorteo queda un código que no dice quién sos, y el nombre con que salís en la pantalla, hasta mañana.";

  const prender = (): void => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GUARDAR_PERFIL", "1");
  };

  /** Pinta la previa y devuelve su marcado entero, para comparar una pantalla con otra. */
  function previa(dePersonas: boolean, idioma: "es" | "en" = "es"): { raiz: HTMLElement; marcado: string } {
    const { raiz, deps, publico } = preparar(dePersonas ? { persona: { google }, tx: txDePersona() } : {});
    setLang(idioma);
    pintarLaCampana(raiz, deps, publico, () => undefined);
    return { raiz, marcado: raiz.querySelector("#cmp-saber")?.innerHTML ?? "" };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("con la bandera apagada dice lo de siempre, arriba del botón y en las reglas", () => {
    const { raiz } = previa(true);
    expect(raiz.querySelector(".cmp-accion .cmp-apoyo")?.textContent).toBe(NOTA_DE_SIEMPRE);
    const reglas = raiz.querySelector(".cmp-reglas")?.textContent ?? "";
    expect(reglas).toContain(TEXTOS_CAMPANA.es.cpQueGuardamosPersona);
    expect(raiz.textContent).not.toContain("Guardamos tu correo");
    expect(raiz.textContent).not.toContain("tu foto");
  });

  it("con la bandera prendida dice que se guardan el correo, el nombre y la foto, antes del botón de Google y en las reglas", () => {
    prender();
    const { raiz } = previa(true);
    const accion = raiz.querySelector(".cmp-accion") as HTMLElement;
    expect(accion.querySelector(".cmp-apoyo")?.textContent).toBe(NOTA_CON_PERFIL);
    // La línea va antes del lugar del botón: la persona la lee antes de entrar.
    expect(accion.firstElementChild?.classList.contains("cmp-apoyo")).toBe(true);
    expect(accion.querySelector(".cmp-apoyo ~ .cmp-google")).not.toBeNull();
    const reglas = raiz.querySelector(".cmp-reglas")?.textContent ?? "";
    expect(reglas).toContain(REGLA_CON_PERFIL);
    // Lo de antes ya no se dice: no queda en pantalla una promesa que el permiso del alta contradice.
    expect(raiz.textContent).not.toContain("no guardamos tu correo");
    expect(raiz.textContent).not.toContain("No te creamos ninguna cuenta");
  });

  it("con la bandera prendida y la página en inglés, las dos líneas salen en inglés", () => {
    prender();
    const { raiz } = previa(true, "en");
    expect(raiz.querySelector(".cmp-accion .cmp-apoyo")?.textContent).toBe("Google confirms it's you. We keep your email, name and photo.");
    const reglas = raiz.querySelector(".cmp-reglas")?.textContent ?? "";
    expect(reglas).toContain(
      "What we keep: your Google email, name and photo, for your Tinkazo account. The organizer doesn't get them. " +
        "The draw list only holds a code that doesn't say who you are, and the name you show up with on the screen, until tomorrow.",
    );
    expect(raiz.textContent).not.toContain("we don't keep your email");
    expect(raiz.textContent).not.toContain("We don't create any account");
  });

  it("con la bandera prendida, esas dos líneas son lo único que cambia de la pantalla", () => {
    const apagada = previa(true).marcado;
    prender();
    const prendida = previa(true).marcado;
    expect(prendida).not.toBe(apagada);
    expect(prendida.replace(NOTA_CON_PERFIL, NOTA_DE_SIEMPRE).replace(REGLA_CON_PERFIL, TEXTOS_CAMPANA.es.cpQueGuardamosPersona ?? "")).toBe(apagada);
  });

  const APAGADA: [string, Record<string, string>][] = [
    ["sin anotarse sin billetera", { VITE_ANOTARSE_SIN_BILLETERA: "", VITE_GUARDAR_PERFIL: "1" }],
    ["con la bandera en 0", { VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: "0" }],
    ["con la bandera en true", { VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GUARDAR_PERFIL: "true" }],
  ];

  it.each(APAGADA)("%s la pantalla es idéntica a la de hoy", (_caso, entorno) => {
    const deHoy = previa(true).marcado;
    for (const [nombre, valor] of Object.entries(entorno)) vi.stubEnv(nombre, valor);
    expect(previa(true).marcado).toBe(deHoy);
  });

  it("una campaña de cuentas no cambia en nada con la bandera prendida", () => {
    const deHoy = previa(false).marcado;
    prender();
    const { raiz, marcado } = previa(false);
    expect(marcado).toBe(deHoy);
    expect(raiz.querySelector(".cmp-accion .cmp-apoyo")?.textContent).toBe("Te creamos una cuenta de Tinkazo.");
    expect(raiz.querySelector(".cmp-reglas")?.textContent).toContain(TEXTOS_CAMPANA.es.cpQueGuardamos);
    expect(raiz.textContent).not.toContain("tu foto");
  });

  it("las reglas que se repiten en las demás pantallas dicen lo mismo que la previa", () => {
    const { raiz, deps } = preparar({ persona: { google }, tx: txDePersona() });
    const seccion = raiz.querySelector<HTMLElement>("#cmp-saber") as HTMLElement;
    pintarReglas(seccion, deps);
    expect(seccion.textContent).toContain(TEXTOS_CAMPANA.es.cpQueGuardamosPersona);
    seccion.replaceChildren();
    prender();
    pintarReglas(seccion, deps);
    expect(seccion.textContent).toContain(REGLA_CON_PERFIL);
    expect(seccion.textContent).not.toContain("no guardamos tu correo");
  });

  it("las dos líneas nuevas existen en los dos idiomas, con Google nombrado y sin prometer que no se guarda nada", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const clave of ["cpEntrarNotaPerfil", "cpQueGuardamosPerfil"]) {
        const dicho = TEXTOS_CAMPANA[idioma][clave] ?? "";
        expect(dicho, `${idioma}.${clave}`).toContain("Google");
        expect(dicho, `${idioma}.${clave}`).not.toMatch(/no guardamos|don't keep|ninguna cuenta|any account/u);
      }
    }
    // Las de siempre siguen como estaban, para la página construida sin la bandera.
    expect(TEXTOS_CAMPANA.es.cpEntrarNotaPersona).toBe(NOTA_DE_SIEMPRE);
    expect(TEXTOS_CAMPANA.en.cpEntrarNotaPersona).toBe("Google confirms it's you. We don't create any account for you.");
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
