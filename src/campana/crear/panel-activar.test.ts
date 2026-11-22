// @vitest-environment jsdom
/**
 * El último paso de la página para armar campañas con la activación a la vista: el botón principal pasa a ser Activar mi
 * campaña, que deja la campaña como borrador y lleva al panel que cobra, y Descargar queda como segunda opción. Sin la
 * activación (el sitio sin el cobro configurado) la página es la de siempre. Todo inyectado, sin navegador ni red.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { TEXTOS_CAMPANA } from "../textos";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { MAX_CUERPO_DE_ACTIVAR, bytesDelPedidoDeActivar, faltaDeTamanoParaActivar } from "./armar";
import { CLAVE_DE_GUARDADO, sufijoNuevo } from "./estado";
import { type Creador, type DepsDelCreador, montarCreador } from "./panel";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const LA_PAZ = "America/La_Paz";
const h = vi.hoisted(() => ({ lang: "es" as "es" | "en" }));

const palabra = (idioma: "es" | "en", clave: string): string =>
  TEXTOS_CREAR_CAMPANA[idioma][clave] ?? TEXTOS_CAMPANA[idioma][clave] ?? (clave === "navMas" ? "Más" : clave);

let montados: Creador[] = [];

interface Mundo {
  deps: DepsDelCreador;
  activadas: string[];
  bajadas: string[];
}

function crear(cambios: Partial<DepsDelCreador> = {}, activa: (texto: string) => boolean = () => true): Mundo {
  document.body.innerHTML = '<span id="cmp-ejemplo" hidden></span><main id="ccp"></main>';
  const raiz = document.querySelector<HTMLElement>("#ccp") as HTMLElement;
  const activadas: string[] = [];
  const bajadas: string[] = [];
  const deps: DepsDelCreador = {
    tx: (clave) => palabra(h.lang, clave),
    dic: (idioma, clave) => palabra(idioma, clave),
    idioma: () => h.lang,
    ahora: () => AHORA,
    zona: LA_PAZ,
    almacen: localStorage,
    demo: false,
    sufijo: () => "k3f9",
    achicar: vi.fn(async () => ({ tipo: "image/png" as const, datos: "AAAA" })),
    leerArchivo: async () => "",
    validar: async (texto, ahora) => validarCampanaParaFirmar(texto, ahora),
    descargar: (nombre) => void bajadas.push(nombre),
    compartir: null,
    costo: () => null,
    activar: (texto) => {
      activadas.push(texto);
      return activa(texto);
    },
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
  return { deps, activadas, bajadas };
}

const q = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector) as T;
const existe = (selector: string): boolean => document.querySelector(selector) !== null;
const clic = (id: string): void => q(`#${id}`).click();
const texto = (selector: string): string => q(selector).textContent ?? "";
const titulo = (): string => texto("#ccp-titulo");
const linea = (): string => texto(".ccp-lineas");

function escribir(id: string, valor: string): void {
  const campo = q<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  campo.value = valor;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

async function asentar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** Llena los cinco pasos y deja la página en el sexto. */
function llenarHastaElFinal(): void {
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
  h.lang = "es";
});
afterEach(() => {
  for (const c of montados) c.desmontar();
  montados = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("el último paso con la activación a la vista", () => {
  it("el principal es Activar mi campaña y Descargar queda como segunda opción", () => {
    crear();
    llenarHastaElFinal();
    expect(titulo()).toBe("Activá tu campaña");
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-activar", "ccp-descargar"]);
    expect(q("#ccp-activar").classList.contains("primary")).toBe(true);
    expect(q("#ccp-activar").textContent).toBe("Activar mi campaña");
    expect(q("#ccp-descargar").classList.contains("primary")).toBe(false);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
  });

  it("la línea dice que se activa con la cuenta de Google y hasta cuándo", () => {
    crear();
    llenarHastaElFinal();
    expect(linea()).toBe("Se activa con tu cuenta de Google. Antes de las 10:00.");
  });

  it("en inglés dice lo mismo con sus palabras", () => {
    h.lang = "en";
    crear();
    llenarHastaElFinal();
    expect(titulo()).toBe("Activate your campaign");
    expect(texto("#ccp-activar")).toBe("Activate my campaign");
    expect(linea()).toMatch(/^It goes live with your Google account\. Before /);
  });

  it("sin la activación el último paso es el de siempre", () => {
    crear({ activar: undefined });
    llenarHastaElFinal();
    expect(titulo()).toBe("Mandala a Tinkazo");
    expect(existe("#ccp-activar")).toBe(false);
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-descargar"]);
  });

  it("la demostración no activa nada: no guarda nada", () => {
    crear({ demo: true });
    expect(existe("#ccp-activar")).toBe(false);
  });
});

describe("activar", () => {
  it("entrega el JSON de la campaña, sin firma y sin cuenta de nadie, y pasa el validador de siempre", async () => {
    const m = crear();
    llenarHastaElFinal();
    clic("ccp-activar");
    await asentar();
    expect(m.activadas).toHaveLength(1);
    const campana = JSON.parse(m.activadas[0] ?? "{}") as Record<string, unknown>;
    expect(campana.red).toBe("mainnet");
    expect(campana.estado).toBe("abierta");
    expect(campana.entrada).toBe("google");
    expect(campana.anotadas).toBe(0);
    expect(campana.organizadora).toBeUndefined();
    expect(campana.firma).toBeUndefined();
    expect(String(campana.evento)).toBe("alcancia-andina-k3f9-2026-11-19-1000");
    expect(validarCampanaParaFirmar(m.activadas[0] ?? "", AHORA)).toEqual({ ok: true });
    expect(m.bajadas).toEqual([]);
  });

  it("el evento lleva un sufijo de cuatro letras o números que cambia entre una página y otra", () => {
    const sufijos = new Set(Array.from({ length: 30 }, () => sufijoNuevo()));
    for (const s of sufijos) expect(s).toMatch(/^[a-z0-9]{4}$/u);
    expect(sufijos.size).toBeGreaterThan(20);
  });

  it("con algo que falta no activa y lo dice donde está", async () => {
    const m = crear();
    llenarHastaElFinal();
    clic("ccp-ir-1");
    escribir("ccp-nombre", "");
    clic("ccp-ir-6");
    clic("ccp-activar");
    await asentar();
    expect(m.activadas).toEqual([]);
    expect(linea()).toBe("Escribí el nombre de tu marca.");
  });

  it("si el navegador no deja guardar, se queda y lo dice", async () => {
    const m = crear({}, () => false);
    llenarHastaElFinal();
    clic("ccp-activar");
    await asentar();
    expect(m.activadas).toHaveLength(1);
    expect(titulo()).toBe("Activá tu campaña");
    expect(linea()).toBe("Algo no salió. Probá de nuevo.");
  });

  it("una campaña muy pesada para activarla dice qué achicar, y se puede descargar", async () => {
    const m = crear({ achicar: vi.fn(async () => ({ tipo: "image/png" as const, datos: "A".repeat(30_000) })) });
    escribir("ccp-nombre", "Alcancía Andina");
    const logo = q<HTMLInputElement>("#ccp-logo-archivo");
    Object.defineProperty(logo, "files", { value: [new File(["x"], "logo.png", { type: "image/png" })], configurable: true });
    logo.dispatchEvent(new Event("change", { bubbles: true }));
    await asentar();
    clic("ccp-seguir");
    clic("ccp-monto-40");
    clic("ccp-seguir");
    clic("ccp-manana");
    escribir("ccp-lugar", "Hackathon");
    clic("ccp-seguir");
    clic("ccp-seguir");
    clic("ccp-seguir");
    clic("ccp-activar");
    await asentar();
    expect(m.activadas).toEqual([]);
    expect(titulo()).toBe("Activá tu campaña");
    expect(linea()).toBe("Pesa mucho para activarla. Achicá el logo o descargala.");
    clic("ccp-descargar");
    await asentar();
    expect(m.bajadas).toHaveLength(1);
  });

  it("lo armado se queda guardado en la página para corregirlo", async () => {
    crear();
    llenarHastaElFinal();
    clic("ccp-activar");
    await asentar();
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).not.toBeNull();
  });
});

describe("el tamaño para activar", () => {
  it("cuenta el pedido entero con la sesión y deja pasar una campaña de tamaño común", () => {
    const comun = JSON.stringify({ v: 1, evento: "a-b-c-d", empresa: { nombre: "Alcancía", logo: null } });
    expect(bytesDelPedidoDeActivar(comun)).toBeLessThan(MAX_CUERPO_DE_ACTIVAR);
    expect(faltaDeTamanoParaActivar(comun)).toBeNull();
  });

  it("una con un logo grande no entra y se queda en el último paso, donde está Descargar", () => {
    const grande = { empresa: { logo: { datos: "A".repeat(30_000) } }, pasos: [], bases: { es: "x", en: "x" } };
    expect(faltaDeTamanoParaActivar(JSON.stringify(grande))).toEqual({ paso: 6, clave: "ccDemasiadoActivar" });
  });

  it("las comillas y los saltos pesan más: se miden como viajan", () => {
    const comillas = '"'.repeat(10_000);
    expect(bytesDelPedidoDeActivar(comillas)).toBeGreaterThan(20_000);
  });
});

describe("los textos de activar", () => {
  const CLAVES = ["ccPaso6Activar", "ccActivar", "ccListoLineaActivar", "ccDemasiadoActivar"];

  it("están en los dos idiomas", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_CREAR_CAMPANA.es[k], k).toBeTruthy();
      expect(TEXTOS_CREAR_CAMPANA.en[k], k).toBeTruthy();
    }
  });

  it("no llevan punto y coma, comillas, raya larga, exclamaciones, fee ni palabras de azar", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const t = TEXTOS_CREAR_CAMPANA[idioma][k] ?? "";
        expect(t, `${idioma}.${k}`).not.toMatch(/[;«»"“”—–·¡!]/u);
        expect(t, `${idioma}.${k}`).not.toMatch(/\b(?:fee|raffle|lottery|ticket|bet|rifa|boleto|apuesta|lotería)\b/iu);
      }
    }
  });
});
