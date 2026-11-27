// @vitest-environment jsdom
/**
 * El armador con una campaña de personas: el premio se escribe en lugar de elegir montos, la entrada queda fija en Google, no hay
 * ningún control del modo, las bases dicen que el premio se entrega en mano y el archivo lleva el premio escrito. Sin la identidad
 * pedida en la dirección el armador es el de siempre, y un archivo de cuentas abierto con ella no cambia de modo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarCampanaParaElFirmador } from "../../sala/validar-campana";
import { TEXTOS_CAMPANA } from "../textos";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { type Creador, type DepsDelCreador, montarCreador } from "./panel";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const palabra = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? TEXTOS_CAMPANA[idioma][clave] ?? clave;

let montados: Creador[] = [];
let bajadas: string[] = [];
let mensajes: Array<Record<string, unknown>> = [];

function crear(cambios: Partial<DepsDelCreador> = {}, idioma: "es" | "en" = "es"): void {
  document.body.innerHTML = '<span id="cmp-ejemplo" hidden></span><main id="ccp"></main>';
  const raiz = document.querySelector<HTMLElement>("#ccp") as HTMLElement;
  const deps: DepsDelCreador = {
    tx: (clave) => palabra(idioma, clave),
    dic: (i, clave) => palabra(i, clave),
    idioma: () => idioma,
    ahora: () => AHORA,
    zona: "America/La_Paz",
    almacen: localStorage,
    demo: false,
    sufijo: () => "k3f9",
    achicar: vi.fn(async () => ({ tipo: "image/png" as const, datos: "AAAA" })),
    leerArchivo: async (archivo) => (archivo as File & { contenido: string }).contenido,
    validar: async (texto, ahora) => validarCampanaParaElFirmador(texto, ahora),
    descargar: (_nombre, texto) => bajadas.push(texto),
    compartir: null,
    costo: () => null,
    origen: location.origin,
    tema: null,
    cuadro: (f) => f(),
    esperar: (f, ms) => {
      const temporizador = window.setTimeout(f, ms);
      return () => window.clearTimeout(temporizador);
    },
    escala: () => () => undefined,
    ...cambios,
  };
  montados.push(montarCreador(raiz, deps));
  const marco = document.querySelector<HTMLIFrameElement>("#ccp-vista");
  if (marco?.contentWindow) {
    vi.spyOn(marco.contentWindow, "postMessage").mockImplementation((mensaje: unknown) => {
      mensajes.push(mensaje as Record<string, unknown>);
    });
  }
}

const q = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
const existe = (selector: string): boolean => document.querySelector(selector) !== null;
const clic = (id: string): void => q(`#${id}`).click();
const texto = (selector: string): string => q(selector).textContent ?? "";
const linea = (): string => texto(".ccp-lineas");

function escribir(id: string, valor: string): void {
  const campo = q<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  campo.value = valor;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function elegirArchivo(contenido: string): void {
  const campo = q<HTMLInputElement>("#ccp-abrir-archivo");
  const archivo = Object.assign(new File([contenido], "campana.json", { type: "application/json" }), { contenido });
  Object.defineProperty(campo, "files", { value: [archivo], configurable: true });
  campo.dispatchEvent(new Event("change", { bubbles: true }));
}

async function asentar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** Llena los pasos con un premio escrito y deja la página en el sexto. */
function llenarEnMano(premio = "Auriculares", mas = 2): void {
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  escribir("ccp-premio-mano", premio);
  for (let i = 0; i < mas; i += 1) clic("ccp-ganan-mas");
  clic("ccp-seguir");
  clic("ccp-manana");
  escribir("ccp-lugar", "Hackathon");
  clic("ccp-seguir");
  clic("ccp-seguir");
  clic("ccp-seguir");
}

function llenarDeCuentas(): void {
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  clic("ccp-monto-40");
  clic("ccp-ganan-mas");
  clic("ccp-ganan-mas");
  clic("ccp-seguir");
  clic("ccp-manana");
  escribir("ccp-lugar", "Hackathon");
  clic("ccp-seguir");
  clic("ccp-seguir");
  clic("ccp-seguir");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  localStorage.clear();
  bajadas = [];
  mensajes = [];
});
afterEach(() => {
  for (const c of montados) c.desmontar();
  montados = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("el paso del premio en una campaña de personas", () => {
  it("pide el premio escrito en lugar de los montos, con la marca y la línea de la entrega en mano", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    expect(texto(".ccp-mano-marca")).toBe("Premio en mano");
    expect(texto(".ccp-cuerpo")).toContain("Cada persona que gana se lleva");
    expect(texto(".ccp-mano-linea")).toBe("Lo entregás en mano en el evento.");
    expect(q<HTMLInputElement>("#ccp-premio-mano").maxLength).toBe(60);
    expect(existe("#ccp-monto-40")).toBe(false);
    expect(existe("#ccp-otro")).toBe(false);
    expect(texto(".ccp-cuerpo")).toContain("Cuántas personas ganan");
    expect(existe("#ccp-ganan-mas")).toBe(true);
  });

  it("no muestra ningún total ni dólares", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    escribir("ccp-premio-mano", "Auriculares");
    clic("ccp-ganan-mas");
    expect(texto(".ccp-cuerpo")).not.toMatch(/dólares|En total/u);
    expect(existe(".ccp-total")).toBe(false);
  });

  it("en inglés lleva sus textos", () => {
    crear({ identidad: "persona" }, "en");
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    expect(texto(".ccp-mano-marca")).toBe("Prize in hand");
    expect(texto(".ccp-mano-linea")).toBe("You hand it over in person at the event.");
  });

  it("seguir sin escribir el premio lo pide, y el foco va al campo", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-seguir");
    expect(linea()).toBe("Escribí qué se lleva cada persona.");
    expect(document.activeElement?.id).toBe("ccp-premio-mano");
    expect(q("#ccp-titulo").textContent).toBe("El premio");
  });

  it("un premio de solo espacios tampoco sirve", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    escribir("ccp-premio-mano", "     ");
    clic("ccp-seguir");
    expect(linea()).toBe("Escribí qué se lleva cada persona.");
  });

  it("lo escrito se guarda en el borrador y vuelve al recargar", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    escribir("ccp-premio-mano", "Auriculares");
    vi.advanceTimersByTime(5000);
    for (const c of montados) c.desmontar();
    montados = [];
    crear({ identidad: "persona" });
    expect(q<HTMLInputElement>("#ccp-premio-mano").value).toBe("Auriculares");
  });

  it("no hay ningún control para elegir el modo ni la entrada", () => {
    crear({ identidad: "persona" });
    llenarEnMano();
    expect(existe('input[type="radio"], select')).toBe(false);
    expect(document.body.textContent).not.toMatch(/identidad|entrada|modo de personas|persona\b.*cuenta/iu);
  });
});

describe("el resumen y el archivo de una campaña de personas", () => {
  it("el resumen dice el premio y para cuántas personas, sin costos", () => {
    crear({ identidad: "persona" });
    llenarEnMano();
    const renglones = [...document.querySelectorAll(".ccp-resumen")].map((r) => r.textContent ?? "");
    expect(renglones[1]).toBe("Auriculares, para 3 personas");
    expect(document.body.textContent).not.toMatch(/dólares|Total a poner|Servicio de Tinkazo/u);
  });

  it("con una sola persona el resumen dice solo el premio", () => {
    crear({ identidad: "persona" });
    llenarEnMano("Una bici", 0);
    const renglones = [...document.querySelectorAll(".ccp-resumen")].map((r) => r.textContent ?? "");
    expect(renglones[1]).toBe("Una bici");
  });

  it("Descargar baja el archivo con identidad persona, el premio escrito y los montos en cero, y lo acepta el firmador", async () => {
    crear({ identidad: "persona" });
    llenarEnMano();
    clic("ccp-descargar");
    await asentar();
    expect(bajadas).toHaveLength(1);
    const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
    expect(archivo.identidad).toBe("persona");
    expect(archivo.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    expect(archivo.premios).toEqual(["0", "0", "0"]);
    expect(archivo.entrada).toBe("google");
    expect(validarCampanaParaElFirmador(JSON.stringify(archivo), AHORA)).toEqual({ ok: true });
  });

  it("las bases dicen que el premio se entrega en mano y que si no está decide quien organiza", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    escribir("ccp-premio-mano", "Auriculares");
    clic("ccp-ganan-mas");
    clic("ccp-seguir");
    clic("ccp-manana");
    escribir("ccp-lugar", "Hackathon");
    clic("ccp-seguir");
    clic("ccp-seguir");
    const bases = q<HTMLTextAreaElement>("#ccp-bases").value;
    expect(bases).toContain("Hay 2 premios, uno para cada persona que gana: Auriculares.");
    expect(bases).toContain("El premio se entrega en mano en el evento, a la persona que ganó. Si no está, Alcancía Andina decide qué hacer con él.");
    expect(bases).toContain("Lo que guarda Tinkazo está en sus Términos.");
    expect(bases).not.toContain("no guarda tu correo");
    expect(bases).not.toMatch(/dólares|7 días|retir/u);
    clic("ccp-bases-en");
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("The prize is handed over in person at the event");
  });

  it("la vista del celular recibe una campaña de personas con el premio escrito", () => {
    crear({ identidad: "persona" });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    escribir("ccp-premio-mano", "Auriculares");
    vi.advanceTimersByTime(200);
    const ultimo = mensajes[mensajes.length - 1] as { campana: Record<string, unknown>; muestras: { premio: boolean } } | undefined;
    expect(ultimo?.campana.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    expect(ultimo?.campana.identidad).toBe("persona");
    expect(ultimo?.muestras.premio).toBe(false);
  });
});

describe("el armador de siempre", () => {
  it("sin la identidad pedida el paso del premio es el de los montos", () => {
    crear();
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    expect(existe("#ccp-monto-40")).toBe(true);
    expect(existe("#ccp-premio-mano")).toBe(false);
    expect(existe(".ccp-mano-marca")).toBe(false);
  });

  it("baja la campaña de cuentas sin identidad ni premio escrito", async () => {
    crear();
    llenarDeCuentas();
    clic("ccp-descargar");
    await asentar();
    const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
    expect("identidad" in archivo).toBe(false);
    expect("premio_en_mano" in archivo).toBe(false);
  });

  it("un archivo de cuentas abierto con la dirección de personas sigue siendo de cuentas", async () => {
    crear();
    llenarDeCuentas();
    clic("ccp-descargar");
    await asentar();
    const deCuentas = bajadas[0] ?? "";
    localStorage.clear();
    for (const c of montados) c.desmontar();
    montados = [];
    bajadas = [];
    crear({ identidad: "persona" });
    elegirArchivo(deCuentas);
    await asentar();
    clic("ccp-ir-2");
    expect(existe("#ccp-monto-40")).toBe(true);
    expect(existe("#ccp-premio-mano")).toBe(false);
    clic("ccp-ir-6");
    clic("ccp-descargar");
    await asentar();
    const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
    expect("identidad" in archivo).toBe(false);
    expect("premio_en_mano" in archivo).toBe(false);
  });

  it("un archivo de personas abierto con su premio lo muestra escrito, se pida o no en la dirección", async () => {
    crear({ identidad: "persona" });
    llenarEnMano();
    clic("ccp-descargar");
    await asentar();
    const dePersonas = bajadas[0] ?? "";
    localStorage.clear();
    for (const c of montados) c.desmontar();
    montados = [];
    bajadas = [];
    crear();
    elegirArchivo(dePersonas);
    await asentar();
    clic("ccp-ir-2");
    expect(q<HTMLInputElement>("#ccp-premio-mano").value).toBe("Auriculares");
    expect(existe("#ccp-monto-40")).toBe(false);
  });
});
