// @vitest-environment jsdom
/**
 * El armador con una campaña de personas: no calcula comisión, no muestra el servicio ni el total a poner y no ofrece Activar,
 * aunque el sitio tenga el cobro configurado y la activación. La campaña se baja y la firma Tinkazo. Una campaña de cuentas,
 * con el mismo cobro, muestra lo de siempre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { TEXTOS_CAMPANA } from "../textos";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { comisionDelArmado } from "./costo";
import { type Creador, type DepsDelCreador, montarCreador } from "./panel";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const palabra = (clave: string): string => TEXTOS_CREAR_CAMPANA.es[clave] ?? TEXTOS_CAMPANA.es[clave] ?? clave;

let montados: Creador[] = [];
let activadas: string[] = [];

function crear(cambios: Partial<DepsDelCreador> = {}): void {
  document.body.innerHTML = '<span id="cmp-ejemplo" hidden></span><main id="ccp"></main>';
  const raiz = document.querySelector<HTMLElement>("#ccp") as HTMLElement;
  const deps: DepsDelCreador = {
    tx: palabra,
    dic: (_idioma, clave) => palabra(clave),
    idioma: () => "es",
    ahora: () => AHORA,
    zona: "America/La_Paz",
    almacen: localStorage,
    demo: false,
    sufijo: () => "k3f9",
    achicar: vi.fn(async () => ({ tipo: "image/png" as const, datos: "AAAA" })),
    leerArchivo: async () => "",
    validar: async (texto, ahora) => validarCampanaParaFirmar(texto, ahora),
    descargar: () => undefined,
    compartir: null,
    costo: () => null,
    activar: (texto) => {
      activadas.push(texto);
      return true;
    },
    comision: comisionDelArmado({ pb: 200n, minimo: 15_000_000n }),
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
}

const q = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
const clic = (id: string): void => q(`#${id}`).click();

function escribir(id: string, valor: string): void {
  const campo = q<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  campo.value = valor;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function llenarHastaElFinal(): void {
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  // Una campaña de personas escribe el premio y una de cuentas elige el monto.
  if (document.querySelector("#ccp-premio-mano")) escribir("ccp-premio-mano", "Auriculares");
  else clic("ccp-monto-40");
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
  activadas = [];
});
afterEach(() => {
  for (const c of montados) c.desmontar();
  montados = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("el armador con una campaña de personas y el cobro prendido", () => {
  it("el resumen no trae el servicio de Tinkazo ni el total a poner", () => {
    crear({ identidad: "persona" });
    llenarHastaElFinal();
    expect(document.body.textContent).not.toContain("Servicio de Tinkazo");
    expect(document.body.textContent).not.toContain("Total a poner");
  });

  it("no ofrece Activar: queda Descargar como única acción y el título es el de bajar", () => {
    crear({ identidad: "persona" });
    llenarHastaElFinal();
    expect(document.querySelector("#ccp-activar")).toBeNull();
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-descargar"]);
    expect(q("#ccp-titulo").textContent).toBe("Mandala a Tinkazo");
    expect(activadas).toEqual([]);
  });

  it("una campaña de cuentas con el mismo cobro muestra el servicio, el total y Activar", () => {
    crear();
    llenarHastaElFinal();
    expect(document.body.textContent).toContain("Servicio de Tinkazo: 2,40 dólares digitales");
    expect(document.body.textContent).toContain("Total a poner: 122,40 dólares digitales");
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-activar", "ccp-descargar"]);
  });
});

/**
 * El cobro y Activar salen de la campaña que se abre, no del parámetro de la dirección: un archivo de personas abierto sin pedirlas
 * no ofrece cobrar ni activar, y uno de cuentas abierto pidiendo personas conserva el servicio, el total y Activar.
 */
describe("el cobro sigue a la campaña abierta y no a la dirección", () => {
  const bajadas: string[] = [];

  function elegirArchivo(contenido: string): void {
    const campo = q<HTMLInputElement>("#ccp-abrir-archivo");
    const archivo = Object.assign(new File([contenido], "campana.json", { type: "application/json" }), { contenido });
    Object.defineProperty(campo, "files", { value: [archivo], configurable: true });
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const asentar = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  const cambiosDeArchivo: Partial<DepsDelCreador> = {
    leerArchivo: async (archivo) => (archivo as File & { contenido: string }).contenido,
    descargar: (_nombre, texto) => {
      bajadas.push(texto);
    },
  };

  /** Arma y baja una campaña con los pasos del panel, y deja la página limpia para abrirla. */
  async function bajarUna(cambios: Partial<DepsDelCreador>): Promise<string> {
    bajadas.length = 0;
    crear({ ...cambiosDeArchivo, ...cambios });
    llenarHastaElFinal();
    clic("ccp-descargar");
    await asentar();
    const texto = bajadas[0] ?? "";
    for (const c of montados) c.desmontar();
    montados = [];
    localStorage.clear();
    return texto;
  }

  it("un archivo de personas abierto sin pedirlas en la dirección no ofrece Activar ni calcula el servicio", async () => {
    const dePersonas = await bajarUna({ identidad: "persona" });
    expect(dePersonas).toContain('"identidad"');
    crear(cambiosDeArchivo);
    elegirArchivo(dePersonas);
    await asentar();
    clic("ccp-ir-6");
    expect(document.querySelector("#ccp-activar")).toBeNull();
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-descargar"]);
    expect(q("#ccp-titulo").textContent).toBe("Mandala a Tinkazo");
    expect(document.body.textContent).not.toContain("Servicio de Tinkazo");
    expect(document.body.textContent).not.toContain("Total a poner");
    expect(activadas).toEqual([]);
  });

  it("un archivo de cuentas abierto pidiendo personas en la dirección conserva el servicio, el total y Activar", async () => {
    const deCuentas = await bajarUna({});
    expect(deCuentas).not.toContain('"identidad"');
    crear({ ...cambiosDeArchivo, identidad: "persona" });
    elegirArchivo(deCuentas);
    await asentar();
    clic("ccp-ir-6");
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-activar", "ccp-descargar"]);
    expect(document.body.textContent).toContain("Servicio de Tinkazo: 2,40 dólares digitales");
    expect(document.body.textContent).toContain("Total a poner: 122,40 dólares digitales");
  });
});
