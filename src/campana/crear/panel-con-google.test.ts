// @vitest-environment jsdom
/**
 * El armador con las campañas con Google prendidas: una campaña nueva con premio en dólares se arma de personas, con los mismos
 * pasos y los mismos controles que una de cuentas. No aparece ninguna pregunta ni control del modo. Cambian el tope de personas
 * que ganan (8), el resumen (el envío de los premios y un renglón que dice cómo se anota la gente), las bases y la vista del
 * celular. Activar sigue siendo la principal. Un archivo abierto manda: el de cuentas sigue de cuentas, el de premio en mano sigue
 * en mano y el de personas con montos ya no se convierte. Sin el pedido de modo, el armador es el de siempre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { TEXTOS_CAMPANA } from "../textos";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { comisionDelArmado } from "./costo";
import { CLAVE_DE_GUARDADO, formularioInicial } from "./estado";
import type { PedidoDeModo } from "./modo";
import { type Creador, type DepsDelCreador, montarCreador } from "./panel";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const LA_PAZ = "America/La_Paz";
const palabra = (idioma: "es" | "en", clave: string): string =>
  TEXTOS_CREAR_CAMPANA[idioma][clave] ?? TEXTOS_CAMPANA[idioma][clave] ?? (clave === "navMas" ? "Más" : clave);

/** Lo que pide el sitio con los dos interruptores prendidos y sin nada en la dirección. */
const CON_DOLARES: PedidoDeModo = { nueva: "personas-dolares", archivoConDolares: true };
/** Con los dos interruptores y `identidad=cuenta` en la dirección. */
const DE_CUENTAS: PedidoDeModo = { nueva: "cuentas", archivoConDolares: true };
/** Con los dos interruptores y `identidad=persona` en la dirección. */
const EN_MANO: PedidoDeModo = { nueva: "personas-en-mano", archivoConDolares: true };
/** El cobro de producción: 2 % de los premios con un mínimo de 1,50, y 0,50 por cada envío. */
const COBRO: Partial<DepsDelCreador> = { comision: comisionDelArmado({ pb: 200n, minimo: 15_000_000n }), envio: 0.5 };

let montados: Creador[] = [];
let bajadas: string[] = [];
let activadas: string[] = [];
let mensajes: Array<Record<string, unknown>> = [];

function crear(cambios: Partial<DepsDelCreador> = {}, idioma: "es" | "en" = "es"): Creador {
  document.body.innerHTML = '<span id="cmp-ejemplo" hidden></span><main id="ccp"></main>';
  const raiz = document.querySelector<HTMLElement>("#ccp") as HTMLElement;
  const deps: DepsDelCreador = {
    tx: (clave) => palabra(idioma, clave),
    dic: (i, clave) => palabra(i, clave),
    idioma: () => idioma,
    ahora: () => AHORA,
    zona: LA_PAZ,
    almacen: localStorage,
    demo: false,
    sufijo: () => "k3f9",
    achicar: vi.fn(async () => ({ tipo: "image/png" as const, datos: "AAAA" })),
    leerArchivo: async (archivo) => (archivo as File & { contenido: string }).contenido,
    validar: async (texto, ahora) => validarCampanaParaFirmar(texto, ahora),
    descargar: (_nombre, texto) => void bajadas.push(texto),
    compartir: null,
    costo: () => null,
    activar: (texto) => {
      activadas.push(texto);
      return true;
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
  const creador = montarCreador(raiz, deps);
  montados.push(creador);
  const marco = document.querySelector<HTMLIFrameElement>("#ccp-vista");
  if (marco?.contentWindow) {
    vi.spyOn(marco.contentWindow, "postMessage").mockImplementation((mensaje: unknown) => {
      mensajes.push(mensaje as Record<string, unknown>);
    });
  }
  return creador;
}

/** Suelta lo montado y deja la página limpia para montar de nuevo. Lo guardado en el navegador queda. */
function soltar(): void {
  for (const c of montados) c.desmontar();
  montados = [];
  bajadas = [];
  activadas = [];
  mensajes = [];
}

const q = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
const existe = (selector: string): boolean => document.querySelector(selector) !== null;
const clic = (id: string): void => q(`#${id}`).click();
const texto = (selector: string): string => q(selector).textContent ?? "";
const titulo = (): string => texto("#ccp-titulo");
const renglones = (): string[] => [...document.querySelectorAll(".ccp-resumen")].map((r) => r.textContent ?? "");
const costos = (): string[] => [...document.querySelectorAll(".ccp-resumen .ccp-total")].map((r) => r.textContent ?? "");
const botones = (): string[] => [...q(".ccp-botones").children].map((b) => b.id);
const ultimoMensaje = (): { campana: Record<string, unknown>; muestras: { premio: boolean } } =>
  mensajes[mensajes.length - 1] as { campana: Record<string, unknown>; muestras: { premio: boolean } };

/** Los controles del paso y de la barra de abajo, con su nombre y si están apagados. */
const controles = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".ccp-paso button, .ccp-paso input, .ccp-paso textarea, .ccp-paso select, .ccp-paso a, .ccp-accion button, .ccp-accion a")].map(
    (e) => `${e.tagName.toLowerCase()}#${e.id}${(e as HTMLButtonElement).disabled ? " apagado" : ""}`,
  );

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
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** Llena los cinco pasos con montos y deja la página en el sexto: 40 dólares para `ganan` personas. */
function llenar(ganan = 3): void {
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  clic("ccp-monto-40");
  for (let i = 1; i < ganan; i += 1) clic("ccp-ganan-mas");
  clic("ccp-seguir");
  clic("ccp-manana");
  escribir("ccp-lugar", "Hackathon");
  clic("ccp-seguir");
  clic("ccp-seguir");
  clic("ccp-seguir");
}

/** Llena los pasos de una campaña con el premio escrito y deja la página en el sexto. */
function llenarEnMano(): void {
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  escribir("ccp-premio-mano", "Auriculares");
  clic("ccp-ganan-mas");
  clic("ccp-ganan-mas");
  clic("ccp-seguir");
  clic("ccp-manana");
  escribir("ccp-lugar", "Hackathon");
  clic("ccp-seguir");
  clic("ccp-seguir");
  clic("ccp-seguir");
}

/** Arma una campaña, la baja y deja todo limpio para abrirla en otra página. */
async function bajarUna(cambios: Partial<DepsDelCreador>, ganan = 3, enMano = false): Promise<Record<string, unknown>> {
  crear(cambios);
  if (enMano) llenarEnMano();
  else llenar(ganan);
  clic("ccp-descargar");
  await asentar();
  const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
  soltar();
  localStorage.clear();
  return archivo;
}

/** Recorre los seis pasos y anota el título y los controles de cada uno, antes y después de elegir el premio. */
function recorrido(cambios: Partial<DepsDelCreador>): string[][] {
  crear(cambios);
  const pasos: string[][] = [];
  const anotar = (): void => void pasos.push([titulo(), ...controles()]);
  anotar();
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  anotar();
  clic("ccp-monto-40");
  clic("ccp-ganan-mas");
  clic("ccp-ganan-mas");
  anotar();
  clic("ccp-seguir");
  anotar();
  clic("ccp-manana");
  escribir("ccp-lugar", "Hackathon");
  clic("ccp-seguir");
  anotar();
  clic("ccp-seguir");
  anotar();
  clic("ccp-seguir");
  anotar();
  soltar();
  localStorage.clear();
  return pasos;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  localStorage.clear();
  bajadas = [];
  activadas = [];
  mensajes = [];
});
afterEach(() => {
  for (const c of montados) c.desmontar();
  montados = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("los pasos de una campaña nueva con las campañas con Google", () => {
  it("son los de una campaña de cuentas, con los mismos títulos y los mismos controles en cada uno", () => {
    const deCuentas = recorrido({});
    const conGoogle = recorrido({ modo: CON_DOLARES, ...COBRO });
    expect(conGoogle).toEqual(deCuentas);
    expect(conGoogle.map((paso) => paso[0])).toEqual(["Tu marca", "El premio", "El premio", "Cuándo", "Tus redes", "Las bases", "Activá tu campaña"]);
    expect(conGoogle[6]).toContain("button#ccp-activar");
  });

  it("el paso del premio es el de los montos, sin premio escrito ni marca del modo", () => {
    crear({ modo: CON_DOLARES });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    expect(titulo()).toBe("El premio");
    expect(existe("#ccp-monto-40")).toBe(true);
    expect(existe("#ccp-otro")).toBe(true);
    expect(existe("#ccp-premio-mano")).toBe(false);
    expect(existe(".ccp-mano-marca")).toBe(false);
    clic("ccp-monto-40");
    clic("ccp-ganan-mas");
    expect(texto("#ccp-premio")).toBe("2 premios de 40 dólares digitales");
    expect(texto(".ccp-total")).toBe("En total 80 dólares digitales (2 por 40)");
  });

  it("no hay ningún control para elegir el modo ni la entrada, en ningún paso", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      clic(`ccp-ir-${n}`);
      expect(existe('input[type="radio"], input[type="checkbox"], select'), `paso ${n}`).toBe(false);
      expect(q(".ccp-col").textContent, `paso ${n}`).not.toMatch(/identidad|modo de personas|billetera/iu);
    }
  });
});

describe("cuántas personas ganan cuando cada premio se manda", () => {
  it("el contador llega a 8 y ahí se apaga el botón de sumar", () => {
    const creador = crear({ modo: CON_DOLARES });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-monto-40");
    for (let i = 0; i < 12; i += 1) clic("ccp-ganan-mas");
    expect(texto("#ccp-ganan-numero")).toBe("8");
    expect(q<HTMLButtonElement>("#ccp-ganan-mas").disabled).toBe(true);
    expect(q<HTMLButtonElement>("#ccp-ganan-menos").disabled).toBe(false);
    expect(creador.formulario().ganan).toBe(8);
    clic("ccp-ganan-menos");
    expect(texto("#ccp-ganan-numero")).toBe("7");
    expect(q<HTMLButtonElement>("#ccp-ganan-mas").disabled).toBe(false);
  });

  it("en una campaña de cuentas sigue llegando a 10, con el pedido de modo o sin él", () => {
    for (const cambios of [{}, { modo: DE_CUENTAS }]) {
      const creador = crear(cambios);
      escribir("ccp-nombre", "Alcancía Andina");
      clic("ccp-seguir");
      clic("ccp-monto-40");
      for (let i = 0; i < 12; i += 1) clic("ccp-ganan-mas");
      expect(texto("#ccp-ganan-numero")).toBe("10");
      expect(creador.formulario().ganan).toBe(10);
      soltar();
      localStorage.clear();
    }
  });

  it("un borrador guardado con 10 baja a 8 al entrar al modo", () => {
    const guardado = { ...formularioInicial(LA_PAZ, "k3f9"), nombre: "Alcancía Andina", monto: 40, ganan: 10, paso: 2, visitado: 2 };
    localStorage.setItem(CLAVE_DE_GUARDADO, JSON.stringify(guardado));
    const creador = crear({ modo: CON_DOLARES });
    expect(creador.formulario().ganan).toBe(8);
    expect(texto("#ccp-ganan-numero")).toBe("8");
    expect(texto("#ccp-premio")).toBe("8 premios de 40 dólares digitales");
  });

  it("el mismo borrador se queda en 10 en una campaña de cuentas y en una de premio en mano", () => {
    const guardado = { ...formularioInicial(LA_PAZ, "k3f9"), nombre: "Alcancía Andina", monto: 40, ganan: 10, paso: 2, visitado: 2 };
    for (const cambios of [{}, { modo: DE_CUENTAS }, { modo: EN_MANO, identidad: "persona" as const }]) {
      localStorage.setItem(CLAVE_DE_GUARDADO, JSON.stringify(guardado));
      expect(crear(cambios).formulario().ganan).toBe(10);
      soltar();
      localStorage.clear();
    }
  });

  it("un archivo de personas con 10 premios en dólares se abre con sus 10: no se le baja nada y no se puede sumar", async () => {
    const deDiez: Record<string, unknown> = { ...(await bajarUna({}, 10)), identidad: "persona" };
    expect(deDiez.premios).toHaveLength(10);
    const creador = crear({ modo: CON_DOLARES });
    elegirArchivo(JSON.stringify(deDiez));
    await asentar();
    expect(creador.formulario().ganan).toBe(10);
    clic("ccp-ir-2");
    expect(texto("#ccp-ganan-numero")).toBe("10");
    expect(q<HTMLButtonElement>("#ccp-ganan-mas").disabled).toBe(true);
    expect(q<HTMLButtonElement>("#ccp-ganan-menos").disabled).toBe(false);
  });
});

describe("el resumen de una campaña de personas con dólares", () => {
  it("trae el servicio, el envío de los premios y el total con el envío sumado", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    expect(costos()).toEqual([
      "En total 120 dólares digitales (3 por 40)",
      "Servicio de Tinkazo: 2,40 dólares digitales",
      "Envío de los premios: 1,50 dólares digitales",
      "Total a poner: 123,90 dólares digitales",
    ]);
  });

  it("dice en un renglón, debajo del lugar, cómo se anota la gente y que el premio lo manda quien organiza", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    const dicho = renglones();
    expect(dicho).toHaveLength(5);
    expect(dicho[3]).toBe("Hackathon. Sin pedidos.");
    expect(dicho[4]).toBe("La gente se anota con Google. Después del sorteo le mandás el premio a cada persona que gana.");
    expect(document.querySelectorAll(".ccp-resumen-modo")).toHaveLength(1);
    expect(texto(".ccp-resumen-modo")).toBe(dicho[4]);
  });

  it("en inglés lo dice en inglés", () => {
    crear({ modo: CON_DOLARES, ...COBRO }, "en");
    llenar();
    expect(costos().slice(1)).toEqual([
      "Tinkazo service: 2.40 digital dollars",
      "Sending the prizes: 1.50 digital dollars",
      "Total to put in: 123.90 digital dollars",
    ]);
    expect(renglones()[4]).toBe("People sign up with Google. After the draw you send the prize to each winner.");
  });

  it("con un premio de 5 son 1,50 de servicio, 0,50 de envío y 7 en total", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-monto-5");
    clic("ccp-seguir");
    clic("ccp-manana");
    escribir("ccp-lugar", "Hackathon");
    clic("ccp-seguir");
    clic("ccp-seguir");
    clic("ccp-seguir");
    expect(costos().slice(1)).toEqual([
      "Servicio de Tinkazo: 1,50 dólares digitales",
      "Envío de los premios: 0,50 dólares digitales",
      "Total a poner: 7 dólares digitales",
    ]);
  });

  it("con 8 premios el envío es ocho veces el de uno", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar(8);
    expect(costos()).toEqual([
      "En total 320 dólares digitales (8 por 40)",
      "Servicio de Tinkazo: 6,40 dólares digitales",
      "Envío de los premios: 4 dólares digitales",
      "Total a poner: 330,40 dólares digitales",
    ]);
  });

  it("si el sitio no cobra el envío no hay renglón del envío, y el renglón del modo sigue", () => {
    for (const envio of [null, 0, undefined]) {
      crear({ modo: CON_DOLARES, comision: COBRO.comision, ...(envio === undefined ? {} : { envio }) });
      llenar();
      expect(costos(), String(envio)).toEqual([
        "En total 120 dólares digitales (3 por 40)",
        "Servicio de Tinkazo: 2,40 dólares digitales",
        "Total a poner: 122,40 dólares digitales",
      ]);
      expect(document.body.textContent, String(envio)).not.toContain("Envío de los premios");
      expect(renglones(), String(envio)).toHaveLength(5);
      soltar();
      localStorage.clear();
    }
  });

  it("sin el cobro configurado no hay servicio, envío ni total, como en una campaña de cuentas", () => {
    crear({ modo: CON_DOLARES, envio: 0.5, activar: undefined });
    llenar();
    expect(costos()).toEqual(["En total 120 dólares digitales (3 por 40)"]);
    expect(botones()).toEqual(["ccp-descargar"]);
  });
});

describe("activar y descargar una campaña de personas con dólares", () => {
  it("Activar mi campaña es la principal y Descargar queda debajo", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    expect(titulo()).toBe("Activá tu campaña");
    expect(botones()).toEqual(["ccp-activar", "ccp-descargar"]);
    expect(q("#ccp-activar").classList.contains("primary")).toBe(true);
    expect(q("#ccp-descargar").classList.contains("primary")).toBe(false);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
    expect(texto(".ccp-lineas")).toBe("Se activa con tu cuenta de Google. Antes de las 10:00.");
  });

  it("Activar guarda un borrador con la identidad de personas, los montos y sin premio escrito, que leen la sala y el sitio", async () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    clic("ccp-activar");
    await asentar();
    expect(activadas).toHaveLength(1);
    const borrador = JSON.parse(activadas[0] ?? "{}") as Record<string, unknown>;
    expect(borrador.identidad).toBe("persona");
    expect(borrador.premios).toEqual(["400000000", "400000000", "400000000"]);
    expect("premio_en_mano" in borrador).toBe(false);
    expect(borrador.entrada).toBe("google");
    expect(borrador.red).toBe("mainnet");
    expect(borrador.organizadora).toBeUndefined();
    expect(validarCampanaParaFirmar(activadas[0] ?? "", AHORA)).toEqual({ ok: true });
    expect(bajadas).toEqual([]);
  });

  it("Descargar baja lo mismo que guarda Activar", async () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    clic("ccp-activar");
    await asentar();
    clic("ccp-descargar");
    await asentar();
    expect(bajadas).toHaveLength(1);
    expect(JSON.parse(bajadas[0] ?? "{}")).toEqual(JSON.parse(activadas[0] ?? "null"));
  });

  it("con 8 personas también se activa", async () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar(8);
    clic("ccp-activar");
    await asentar();
    expect((JSON.parse(activadas[0] ?? "{}") as { premios: string[] }).premios).toHaveLength(8);
  });
});

describe("las bases y la vista del celular", () => {
  it("las bases que se escriben solas son las de este modo, en los dos idiomas", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    clic("ccp-ir-5");
    const bases = q<HTMLTextAreaElement>("#ccp-bases").value;
    expect(bases.split("\n")).toHaveLength(8);
    expect(bases).toContain("Se sortean 3 premios de 40 dólares digitales entre todas las personas anotadas.");
    expect(bases).toContain(
      "Quien gana le muestra su código a Alcancía Andina el día del evento y le pasa la dirección donde recibe dólares digitales. Alcancía Andina le manda el premio ahí.",
    );
    expect(bases.split("\n")[4]).toBe("Recibir el premio es gratis.");
    expect(bases.split("\n")[5]).toBe(TEXTOS_CREAR_CAMPANA.es.ccBase6Mano);
    // El sexto renglón sale de una clave cuyo texto no es de esta prueba: lo demás no nombra nada de una campaña de cuentas.
    expect(bases.split("\n").filter((_, i) => i !== 5).join("\n")).not.toMatch(/cuenta de Tinkazo|7 días|retir/u);
    expect(existe("#ccp-rehacer")).toBe(false);
    clic("ccp-bases-en");
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("The winner shows their code to Alcancía Andina on the day of the event");
  });

  it("el archivo lleva esas mismas bases", async () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    clic("ccp-descargar");
    await asentar();
    const archivo = JSON.parse(bajadas[0] ?? "{}") as { bases: { es: string; en: string } };
    expect(archivo.bases.es).toContain("Quien gana le muestra su código a Alcancía Andina el día del evento");
    expect(archivo.bases.en).toContain("The winner shows their code to Alcancía Andina on the day of the event");
    expect(archivo.bases.es).not.toContain("El premio llega a tu cuenta de Tinkazo");
  });

  it("la vista del celular recibe una campaña de personas con sus montos y sin premio escrito", () => {
    crear({ modo: CON_DOLARES });
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-monto-40");
    clic("ccp-ganan-mas");
    const ultimo = ultimoMensaje();
    expect(ultimo.campana.identidad).toBe("persona");
    expect("premio_en_mano" in ultimo.campana).toBe(false);
    expect(ultimo.campana.premios).toEqual(["400000000", "400000000"]);
    expect(ultimo.muestras.premio).toBe(false);
  });

  it("antes de elegir el monto ya es de personas, con un premio de muestra", () => {
    crear({ modo: CON_DOLARES });
    escribir("ccp-nombre", "Alcancía Andina");
    const ultimo = ultimoMensaje();
    expect(ultimo.campana.identidad).toBe("persona");
    expect(ultimo.muestras.premio).toBe(true);
  });
});

describe("un archivo abierto manda sobre el modo", () => {
  it("uno de personas con montos no se convierte: sigue con sus dólares y ofrece Activar", async () => {
    const dePersonas = await bajarUna({ modo: CON_DOLARES, ...COBRO });
    expect(dePersonas.identidad).toBe("persona");
    for (const modo of [CON_DOLARES, DE_CUENTAS, EN_MANO]) {
      crear({ modo, ...COBRO, ...(modo === EN_MANO ? { identidad: "persona" as const } : {}) });
      elegirArchivo(JSON.stringify(dePersonas));
      await asentar();
      clic("ccp-ir-2");
      expect(existe("#ccp-monto-40"), modo.nueva).toBe(true);
      expect(existe("#ccp-premio-mano"), modo.nueva).toBe(false);
      clic("ccp-ir-5");
      expect(existe("#ccp-rehacer"), modo.nueva).toBe(false);
      clic("ccp-ir-6");
      expect(botones(), modo.nueva).toEqual(["ccp-activar", "ccp-descargar"]);
      expect(costos(), modo.nueva).toContain("Envío de los premios: 1,50 dólares digitales");
      expect(costos(), modo.nueva).toContain("Total a poner: 123,90 dólares digitales");
      expect(texto(".ccp-resumen-modo"), modo.nueva).toBe("La gente se anota con Google. Después del sorteo le mandás el premio a cada persona que gana.");
      clic("ccp-descargar");
      await asentar();
      const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
      expect(archivo.identidad, modo.nueva).toBe("persona");
      expect(archivo.premios, modo.nueva).toEqual(["400000000", "400000000", "400000000"]);
      expect("premio_en_mano" in archivo, modo.nueva).toBe(false);
      soltar();
      localStorage.clear();
    }
  });

  it("uno de la etapa anterior, de cuentas con la identidad agregada, tampoco se convierte y se puede activar", async () => {
    const viejo = { ...(await bajarUna({})), identidad: "persona" };
    crear({ modo: CON_DOLARES, ...COBRO });
    elegirArchivo(JSON.stringify(viejo));
    await asentar();
    clic("ccp-ir-2");
    expect(existe("#ccp-monto-40")).toBe(true);
    expect(existe("#ccp-premio-mano")).toBe(false);
    clic("ccp-ir-6");
    expect(botones()).toEqual(["ccp-activar", "ccp-descargar"]);
    clic("ccp-activar");
    await asentar();
    const borrador = JSON.parse(activadas[0] ?? "{}") as Record<string, unknown>;
    expect(borrador.identidad).toBe("persona");
    expect(borrador.premios).toEqual(["400000000", "400000000", "400000000"]);
    expect("premio_en_mano" in borrador).toBe(false);
  });

  it("sin el pedido de modo ese mismo archivo pide el premio escrito, como siempre", async () => {
    const viejo = { ...(await bajarUna({})), identidad: "persona" };
    crear({ ...COBRO });
    elegirArchivo(JSON.stringify(viejo));
    await asentar();
    clic("ccp-ir-2");
    expect(existe("#ccp-monto-40")).toBe(false);
    expect(q<HTMLInputElement>("#ccp-premio-mano").value).toBe("");
    clic("ccp-ir-6");
    expect(botones()).toEqual(["ccp-descargar"]);
  });

  it("uno de cuentas sigue de cuentas: sin identidad, sin envío, sin renglón del modo y con hasta 10 personas", async () => {
    const deCuentas = await bajarUna({});
    expect("identidad" in deCuentas).toBe(false);
    crear({ modo: CON_DOLARES, ...COBRO });
    elegirArchivo(JSON.stringify(deCuentas));
    await asentar();
    clic("ccp-ir-2");
    for (let i = 0; i < 12; i += 1) clic("ccp-ganan-mas");
    expect(texto("#ccp-ganan-numero")).toBe("10");
    for (let i = 0; i < 7; i += 1) clic("ccp-ganan-menos");
    clic("ccp-ir-5");
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("El premio llega a tu cuenta de Tinkazo.");
    clic("ccp-ir-6");
    expect(costos()).toEqual([
      "En total 120 dólares digitales (3 por 40)",
      "Servicio de Tinkazo: 2,40 dólares digitales",
      "Total a poner: 122,40 dólares digitales",
    ]);
    expect(renglones()).toHaveLength(4);
    expect(existe(".ccp-resumen-modo")).toBe(false);
    expect(botones()).toEqual(["ccp-activar", "ccp-descargar"]);
    expect("identidad" in ultimoMensaje().campana).toBe(false);
    clic("ccp-descargar");
    await asentar();
    const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
    expect("identidad" in archivo).toBe(false);
    expect("premio_en_mano" in archivo).toBe(false);
  });

  it("uno de premio en mano sigue en mano y sin cobro", async () => {
    const enMano = await bajarUna({ identidad: "persona" }, 3, true);
    expect(enMano.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    crear({ modo: CON_DOLARES, ...COBRO });
    elegirArchivo(JSON.stringify(enMano));
    await asentar();
    clic("ccp-ir-2");
    expect(q<HTMLInputElement>("#ccp-premio-mano").value).toBe("Auriculares");
    expect(existe("#ccp-monto-40")).toBe(false);
    clic("ccp-ir-6");
    expect(titulo()).toBe("Mandala a Tinkazo");
    expect(botones()).toEqual(["ccp-descargar"]);
    expect(document.body.textContent).not.toMatch(/Servicio de Tinkazo|Envío de los premios|Total a poner|dólares/u);
    expect(texto(".ccp-resumen-modo")).toBe("La gente se anota sin cuenta y el premio se entrega en mano.");
    clic("ccp-descargar");
    await asentar();
    const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
    expect(archivo.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
    expect(archivo.premios).toEqual(["0", "0", "0"]);
  });
});

describe("lo que pide la dirección con los dos interruptores prendidos", () => {
  it("con el pedido de cuentas todo es de cuentas y no hay renglón del envío", async () => {
    crear({ modo: DE_CUENTAS, ...COBRO });
    llenar();
    expect(costos()).toEqual([
      "En total 120 dólares digitales (3 por 40)",
      "Servicio de Tinkazo: 2,40 dólares digitales",
      "Total a poner: 122,40 dólares digitales",
    ]);
    expect(renglones()).toHaveLength(4);
    expect(existe(".ccp-resumen-modo")).toBe(false);
    expect("identidad" in ultimoMensaje().campana).toBe(false);
    clic("ccp-ir-5");
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("El premio llega a tu cuenta de Tinkazo. Tenés 7 días para recibirlo.");
    clic("ccp-ir-6");
    clic("ccp-activar");
    await asentar();
    const borrador = JSON.parse(activadas[0] ?? "{}") as Record<string, unknown>;
    expect("identidad" in borrador).toBe(false);
    expect("premio_en_mano" in borrador).toBe(false);
  });

  it("con el pedido de premio en mano se escribe el premio y no hay cobro ni Activar", async () => {
    crear({ modo: EN_MANO, identidad: "persona", ...COBRO });
    llenarEnMano();
    expect(titulo()).toBe("Mandala a Tinkazo");
    expect(botones()).toEqual(["ccp-descargar"]);
    expect(document.body.textContent).not.toMatch(/Servicio de Tinkazo|Envío de los premios|Total a poner/u);
    expect(texto(".ccp-resumen-modo")).toBe("La gente se anota sin cuenta y el premio se entrega en mano.");
    clic("ccp-descargar");
    await asentar();
    const archivo = JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>;
    expect(archivo.identidad).toBe("persona");
    expect(archivo.premio_en_mano).toEqual({ es: "Auriculares", en: "Auriculares" });
  });

  it("la demostración es de cuentas: sin renglón del modo, sin envío, y su archivo no lleva identidad", async () => {
    crear({ modo: CON_DOLARES, ...COBRO, demo: true });
    clic("ccp-ir-6");
    expect(existe(".ccp-resumen-modo")).toBe(false);
    expect(document.body.textContent).not.toContain("Envío de los premios");
    expect("identidad" in ultimoMensaje().campana).toBe(false);
    clic("ccp-ir-5");
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("El premio llega a tu cuenta de Tinkazo.");
    clic("ccp-ir-6");
    clic("ccp-descargar");
    await asentar();
    expect(bajadas).toHaveLength(1);
    expect("identidad" in (JSON.parse(bajadas[0] ?? "{}") as Record<string, unknown>)).toBe(false);
  });
});

describe("un borrador guardado con las bases escritas a mano que entra al modo", () => {
  /** Deja guardado un borrador de cuentas con las bases en español cambiadas a mano. */
  function guardarConBasesAMano(): string {
    crear({ ...COBRO });
    llenar();
    clic("ccp-ir-5");
    const escritas = `${q<HTMLTextAreaElement>("#ccp-bases").value}\nTraé tu entrada.`;
    escribir("ccp-bases", escritas);
    vi.advanceTimersByTime(5000);
    soltar();
    return escritas;
  }

  it("avisa que las bases no acompañan y no ofrece Dejarlas así: queda Volver a escribirlas, y lo escrito no se borra solo", () => {
    const escritas = guardarConBasesAMano();
    expect(escritas).toContain("El premio llega a tu cuenta de Tinkazo.");
    crear({ modo: CON_DOLARES, ...COBRO });
    clic("ccp-ir-5");
    expect(texto(".ccp-desfasadas .ccp-error")).toBe("Cambiaste datos de antes y las bases no.");
    expect(existe("#ccp-rehacer")).toBe(true);
    expect(existe("#ccp-dejarlas")).toBe(false);
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toBe(escritas);
    // Sin resolverlo no se sigue: el aviso manda.
    clic("ccp-seguir");
    expect(titulo()).toBe("Las bases");
    clic("ccp-rehacer");
    expect(existe(".ccp-desfasadas")).toBe(false);
    const nuevas = q<HTMLTextAreaElement>("#ccp-bases").value;
    expect(nuevas).toContain("Quien gana le muestra su código a Alcancía Andina el día del evento");
    expect(nuevas).not.toContain("El premio llega a tu cuenta de Tinkazo");
    clic("ccp-seguir");
    expect(titulo()).toBe("Activá tu campaña");
  });

  it("ese mismo borrador en una campaña de cuentas no avisa nada", () => {
    const escritas = guardarConBasesAMano();
    for (const cambios of [{}, { modo: DE_CUENTAS }]) {
      crear({ ...cambios, ...COBRO });
      clic("ccp-ir-5");
      expect(existe(".ccp-desfasadas")).toBe(false);
      expect(q<HTMLTextAreaElement>("#ccp-bases").value).toBe(escritas);
      for (const c of montados) c.desmontar();
      montados = [];
    }
  });

  it("unas bases escritas ya en el modo y desfasadas por cambiar el premio siguen ofreciendo las dos salidas", () => {
    crear({ modo: CON_DOLARES, ...COBRO });
    llenar();
    clic("ccp-ir-5");
    escribir("ccp-bases", `${q<HTMLTextAreaElement>("#ccp-bases").value}\nTraé tu entrada.`);
    clic("ccp-ir-2");
    clic("ccp-ganan-mas");
    clic("ccp-ir-5");
    expect(existe("#ccp-rehacer")).toBe(true);
    expect(existe("#ccp-dejarlas")).toBe(true);
    clic("ccp-dejarlas");
    expect(existe(".ccp-desfasadas")).toBe(false);
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("Traé tu entrada.");
  });
});

describe("sin el pedido de modo el armador es el de siempre", () => {
  it("el resumen tiene sus cuatro renglones, sin envío aunque llegue su costo, y el archivo no lleva identidad", async () => {
    crear({ ...COBRO });
    llenar();
    expect(costos()).toEqual([
      "En total 120 dólares digitales (3 por 40)",
      "Servicio de Tinkazo: 2,40 dólares digitales",
      "Total a poner: 122,40 dólares digitales",
    ]);
    expect(renglones()).toHaveLength(4);
    expect("identidad" in ultimoMensaje().campana).toBe(false);
    clic("ccp-activar");
    await asentar();
    expect("identidad" in (JSON.parse(activadas[0] ?? "{}") as Record<string, unknown>)).toBe(false);
  });
});
