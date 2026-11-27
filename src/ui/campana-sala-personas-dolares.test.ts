// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de quien organiza con una campaña de personas y premios en dólares: la gente se anotó con Google sin recibir ninguna
 * cuenta, y quien organiza le manda su premio a cada persona que gana. Antes de cobrar comprueba que la campaña se va a poder
 * activar y pide cargar también el envío de cada premio. Después del sorteo dice a quién mandarle cuánto, con el nombre, el código
 * y el monto siempre a la vista, y cada fila con su código lleva un botón para mandarlo. Mandar entra de mentira: acá no se abre
 * ninguna ventana ni se mueve plata. Con premio en mano y en cuentas todo queda como estaba.
 */

const h = vi.hoisted(() => ({ red: null as "testnet" | "mainnet" | null }));
// El modo de la pestaña, que cada prueba pone a mano: la línea del premio en la cuenta solo existe en el modo oficial.
vi.mock("../stellar/config", async (original) => {
  const real = await original<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" && h.red ? h.red : Reflect.get(t, k)) }) };
});
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CENTAVO } from "../campana/comision";
import type { LecturaDeComision } from "../campana/comision-red";
import { cuentaDePrueba, lineaDePrueba } from "../campana/cuentas-de-prueba";
import { type Campana, leerCampana } from "../campana/modelo";
import { type FilaDeGanadora, type PasoDelPuente, ponerPaso, registrarAcciones, reiniciarElPuente } from "../campana/puente";
import { type ResultadoDeActivar, guardarOrg } from "../sala/campana-org";
import type { ConfigDeComision } from "../stellar/comision-config";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import type { DepsDeComision } from "./campana-comision";
import {
  $,
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

const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const ORIGEN = cuentaDePrueba(5);
const CONFIG: ConfigDeComision = { pb: 200n, minimo: d(1.5), cuenta: cuentaDePrueba(2), costo: d(0.5), cobros: cuentaDePrueba(1) };
const FIRMA = "F".repeat(86);
const L1 = lineaDePrueba(1);
const L2 = lineaDePrueba(2);
const L3 = lineaDePrueba(3);

const TRES_DE_40 = ["400000000", "400000000", "400000000"];
/** Una campaña de personas con tres premios de 40 dólares digitales. */
const CON_DOLARES = { identidad: "persona", premios: TRES_DE_40 };
/** Una campaña de personas con el premio escrito, que se entrega en mano. */
const EN_MANO = { identidad: "persona", premios: ["0", "0", "0"], premio_en_mano: { es: "Auriculares", en: "Headphones" } };
/** Una campaña de cuentas con los mismos tres premios. */
const DE_CUENTAS = { premios: TRES_DE_40 };

const SIN_CODIGOS = "Esperá a ver los códigos antes de mandar un premio.";
const CON_CODIGOS = "Mirá el código en el celular de quien ganó y mandale su premio a la dirección que te pase.";
const AL_DEJAR = "Si la dejás ahora, ya no ves a quién le falta su premio.";
const AL_DEJAR_CON_AVISOS = "Si la dejás ahora, los celulares que todavía no recibieron su aviso se quedan sin verlo.";

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  reiniciarElPuente();
});
afterEach(() => {
  h.red = null;
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------ lo que arma cada prueba */

/** La campaña tal como la lee el sitio de lo que guarda la sala. */
function campanaLeida(cambios: Record<string, unknown>): Campana {
  const r = leerCampana(JSON.parse(JSON.stringify(campanaDeArchivo(cambios))));
  if (!r.ok) throw new Error(`la campaña de la prueba no se lee: ${r.campo}`);
  return r.campana;
}

/** El panel retomado con el sorteo ya hecho, con la sala que guarda esa campaña. */
async function enSorteada(m: Mundo, cambios: Record<string, unknown> = CON_DOLARES, cuenta?: string): Promise<Panel> {
  m.deps.campanaDeSala = async () => campanaLeida(cambios);
  guardarOrg(m.almacen, { sala: SALA, fase: "sorteada", ...(cuenta === undefined ? {} : { cuenta }) });
  m.sala.fase = "sorteada";
  const p = nuevoPanel(m);
  await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
  await suelta(3);
  return p;
}

type Abierta = "abierta" | "ocupada" | "sin-lectura";

interface Mandar {
  /** Lo que contesta si esta sesión puede mandar. */
  puede: boolean;
  preguntas: number;
  abiertas: { llega: bigint; para: string }[];
  /** Lo que contesta abrir la próxima vez, en orden. Sin nada, se abre. */
  respuestas: (Abierta | "falla")[];
  /** Si no es null, abrir espera a que la prueba lo suelte. */
  espera: Promise<void> | null;
}

/** Mandar de mentira: anota lo que se le pide y contesta lo que la prueba diga. */
function conMandar(m: Mundo, puede = true): Mandar {
  const x: Mandar = { puede, preguntas: 0, abiertas: [], respuestas: [], espera: null };
  m.deps.mandarPremio = {
    puede: async () => {
      x.preguntas++;
      return x.puede;
    },
    abrir: async (premio) => {
      x.abiertas.push(premio);
      if (x.espera) await x.espera;
      const r = x.respuestas.shift() ?? "abierta";
      if (r === "falla") throw new Error("la ventana no bajó");
      return r;
    },
  };
  return x;
}

const fila = (cuenta: string, nombre: string, cambios: Partial<FilaDeGanadora> = {}): FilaDeGanadora => ({
  cuenta,
  nombre,
  avisada: false,
  alta: "esperando",
  ...cambios,
});

/** El resultado de una lista de personas, como lo arma la herramienta: con la marca que sale de la forma de las ganadoras. */
const resultado = (filas: FilaDeGanadora[], sinCodigos = false): PasoDelPuente => ({
  paso: "resultado",
  otraBilletera: false,
  enMano: true,
  filas,
  ...(sinCodigos ? { sinCodigos: true as const } : {}),
});

const TRES_CON_CODIGO = (): FilaDeGanadora[] => [
  fila(L1, "Ana P.", { codigo: "0421" }),
  fila(L2, "Ganadora 2", { codigo: "7310" }),
  fila(L3, "Beto R.", { codigo: "0042" }),
];

const filasDelResultado = (p: Panel): HTMLLIElement[] => [...p.raiz.querySelectorAll<HTMLLIElement>("#cpo-ganadoras > li")];
/** Lo que dice cada pedazo de una fila, en el orden en que se ve. */
const partes = (li: HTMLLIElement): string[] => [...li.children].map((x) => (x.textContent ?? "").trim());
const botonesDe = (p: Panel): string[] => botones(p).map((b) => (b.textContent ?? "").trim());
const deMandar = (p: Panel): string[] => botonesDe(p).filter((b) => /^(?:Mandar|Send) /u.test(b));
/** El botón de una fila, por lo que dice. */
function botonDeLaFila(p: Panel, n: number, rotulo: string): HTMLButtonElement {
  const b = [...(filasDelResultado(p)[n]?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((x) => (x.textContent ?? "").trim() === rotulo);
  if (!b) throw new Error(`la fila ${n} no tiene "${rotulo}"`);
  return b;
}
/** Si algo se ve de verdad: ni él ni nada que lo contenga está escondido. */
function seVe(el: Element | null): boolean {
  for (let x: Element | null = el; x !== null; x = x.parentElement) {
    if (x instanceof HTMLElement && x.hidden) return false;
  }
  return el !== null;
}

/* ------------------------------------------------------------ el resultado */

describe("el resultado de una campaña de personas con premios en dólares", () => {
  it("sin los códigos todavía, la línea dice que se espere y cada fila dice su monto, sin botón de mandar", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(resultado([fila(L1, "Ana P."), fila(L2, "Ganadora 2"), fila(L3, "Beto R.")]));
    await suelta(3);
    expect(texto(p, "#cpo-h")).toBe("El sorteo ya se hizo.");
    expect(texto(p, "#cpo-linea")).toBe(SIN_CODIGOS);
    const filas = filasDelResultado(p);
    expect(filas).toHaveLength(3);
    expect(partes(filas[0] as HTMLLIElement)).toEqual(["Ana P.", "40,00 dólares digitales"]);
    expect(partes(filas[1] as HTMLLIElement)).toEqual(["Ganadora 2", "Avisar a Ganadora 2", "40,00 dólares digitales"]);
    expect(deMandar(p)).toEqual([]);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Avisar a Ana P."]);
    expect(mandar.abiertas).toEqual([]);
    expect(p.raiz.textContent).not.toContain("p1:");
  });

  it("con todos los códigos, la línea dice que se mire el código, y cada fila lleva su código, su monto y Mandar", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe(CON_CODIGOS);
    const filas = filasDelResultado(p);
    expect(partes(filas[0] as HTMLLIElement)).toEqual(["Ana P.", "Código 0421", "40,00 dólares digitales", "Mandar 40,00"]);
    expect(partes(filas[1] as HTMLLIElement)).toEqual(["Ganadora 2", "Avisar a Ganadora 2", "Código 7310", "40,00 dólares digitales", "Mandar 40,00"]);
    expect(partes(filas[2] as HTMLLIElement)).toEqual(["Beto R.", "Avisar a Beto R.", "Código 0042", "40,00 dólares digitales", "Mandar 40,00"]);
    // Mandar es un botón de apoyo: la acción principal sigue siendo una sola, avisarle a quien todavía no sabe.
    expect(principales(p).map((b) => b.textContent)).toEqual(["Avisar a Ana P."]);
    expect(botonDeLaFila(p, 0, "Mandar 40,00").className).toBe("ghost");
    expect(botonDeLaFila(p, 0, "Mandar 40,00").type).toBe("button");
  });

  it("el monto de la fila es un texto con la misma clase que el código, sin estilo nuevo", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    const marcas = [...(filasDelResultado(p)[0]?.querySelectorAll("span.cpo-marca") ?? [])].map((x) => x.textContent);
    expect(marcas).toEqual(["Código 0421", "40,00 dólares digitales"]);
  });

  it("con un código que falta, la línea sigue pidiendo esperar y Mandar sale solo en la fila que ya tiene el suyo", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(resultado([fila(L1, "Ana P.", { codigo: "0421" }), fila(L2, "Ganadora 2"), fila(L3, "Beto R.")]));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe(SIN_CODIGOS);
    const filas = filasDelResultado(p);
    expect(partes(filas[0] as HTMLLIElement)).toEqual(["Ana P.", "Código 0421", "40,00 dólares digitales", "Mandar 40,00"]);
    expect(partes(filas[1] as HTMLLIElement)).toEqual(["Ganadora 2", "Avisar a Ganadora 2", "40,00 dólares digitales"]);
    expect(deMandar(p)).toEqual(["Mandar 40,00"]);
  });

  it("si esta sesión no puede mandar no hay botón, y la línea, el código y el monto siguen a la vista", async () => {
    const m = mundo();
    const mandar = conMandar(m, false);
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(mandar.preguntas).toBeGreaterThan(0);
    expect(texto(p, "#cpo-linea")).toBe(CON_CODIGOS);
    expect(deMandar(p)).toEqual([]);
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Código 0421", "40,00 dólares digitales"]);
  });

  it("sin la forma de mandar conectada tampoco hay botón: el panel no ofrece lo que no puede hacer", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(deMandar(p)).toEqual([]);
    expect(partes(filasDelResultado(p)[2] as HTMLLIElement)).toEqual(["Beto R.", "Avisar a Beto R.", "Código 0042", "40,00 dólares digitales"]);
  });

  it("Mandar abre con el premio de ese puesto y el nombre de esa fila", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    const p = await enSorteada(m, { identidad: "persona", premios: ["400000000", "250000000", "105000000"] });
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(deMandar(p)).toEqual(["Mandar 40,00", "Mandar 25,00", "Mandar 10,50"]);
    expect(partes(filasDelResultado(p)[2] as HTMLLIElement)).toContain("10,50 dólares digitales");
    botonDeLaFila(p, 1, "Mandar 25,00").click();
    await suelta(3);
    expect(mandar.abiertas).toEqual([{ llega: 250_000_000n, para: "Ganadora 2" }]);
    botonDeLaFila(p, 2, "Mandar 10,50").click();
    await suelta(3);
    expect(mandar.abiertas[1]).toEqual({ llega: 105_000_000n, para: "Beto R." });
    expect(texto(p, "#cpo-aviso")).toBe("");
  });

  it("con otro envío en camino no se abre nada y arriba lo dice", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    mandar.respuestas.push("ocupada");
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    botonDeLaFila(p, 0, "Mandar 40,00").click();
    await suelta(3);
    expect(texto(p, "#cpo-aviso")).toBe("Hay otro pago en camino. Probá en unos minutos.");
    // Las filas siguen como estaban: nombre, código y monto a la vista, y el botón para probar más tarde.
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Código 0421", "40,00 dólares digitales", "Mandar 40,00"]);
    // Cuando después se abre bien, el aviso de antes se va.
    botonDeLaFila(p, 0, "Mandar 40,00").click();
    await suelta(3);
    expect(mandar.abiertas).toHaveLength(2);
    expect(texto(p, "#cpo-aviso")).toBe("");
  });

  it("si no se pudo leer el saldo, o la ventana no bajó, dice que no hay conexión y que se pruebe de nuevo", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    mandar.respuestas.push("sin-lectura", "falla");
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    botonDeLaFila(p, 0, "Mandar 40,00").click();
    await suelta(3);
    expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo.");
    botonDeLaFila(p, 2, "Mandar 40,00").click();
    await suelta(3);
    expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo.");
    expect(mandar.abiertas).toHaveLength(2);
  });

  it("un segundo toque mientras se abre no abre otra ventana, ni la de otra fila", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    let soltar: () => void = () => undefined;
    mandar.espera = new Promise<void>((r) => {
      soltar = r;
    });
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    botonDeLaFila(p, 0, "Mandar 40,00").click();
    botonDeLaFila(p, 0, "Mandar 40,00").click();
    botonDeLaFila(p, 1, "Mandar 40,00").click();
    await suelta(3);
    expect(mandar.abiertas).toEqual([{ llega: 400_000_000n, para: "Ana P." }]);
    soltar();
    mandar.espera = null;
    await suelta(3);
    // Ya abierta, la que sigue se puede mandar.
    botonDeLaFila(p, 1, "Mandar 40,00").click();
    await suelta(3);
    expect(mandar.abiertas).toHaveLength(2);
  });

  it("si los códigos no llegaron tras los pedidos, queda el enlace Ver los códigos y nadie puede mandar todavía", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    const pedir = vi.fn();
    registrarAcciones({ verCodigos: pedir });
    ponerPaso(resultado([fila(L1, "Ana P."), fila(L2, "Ganadora 2")], true));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe(SIN_CODIGOS);
    expect(deMandar(p)).toEqual([]);
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "40,00 dólares digitales"]);
    boton(p, "Ver los códigos").click();
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("con todas avisadas no queda acción principal, y cada fila sigue con su código, su monto y Mandar", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO().map((f) => ({ ...f, avisada: true }))));
    await suelta(3);
    expect(principales(p)).toHaveLength(0);
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Marcada como avisada.", "Código 0421", "40,00 dólares digitales", "Mandar 40,00"]);
    expect(texto(p, "#cpo-linea")).toBe(CON_CODIGOS);
  });

  it("nunca aparece Puede recibir, No se pudo preparar, Pagar premio ni avisarle a Tinkazo", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(
      resultado([
        fila(L1, "Ana P.", { codigo: "0421", alta: { estado: "puede" } }),
        fila(L2, "Ganadora 2", { codigo: "7310", alta: { estado: "fallo", motivo: "red" } }),
        fila(L3, "Beto R.", { alta: { estado: "fallo", motivo: "sin-acceso", final: true } }),
      ]),
    );
    await suelta(3);
    const todo = p.raiz.textContent ?? "";
    for (const prohibido of ["Puede recibir", "No se pudo preparar", "Pagar premio", "Probar de nuevo", "avisale a Tinkazo", "en mano"]) {
      expect(todo, prohibido).not.toContain(prohibido);
    }
  });

  it("si el último aviso no se pudo marcar lo dice arriba de la lista, como siempre, y las filas siguen completas", async () => {
    const m = mundo();
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso({ ...resultado(TRES_CON_CODIGO()), sinAviso: true } as PasoDelPuente);
    await suelta(3);
    expect(p.raiz.querySelector("#cpo-ganadoras [role=alert]")?.textContent).toBe("No se pudo marcar. Probá de nuevo o seguí con la entrega.");
    expect(deMandar(p)).toHaveLength(3);
  });

  it("en inglés todo sale en inglés", async () => {
    const m = mundo();
    m.idioma = "en";
    conMandar(m);
    const p = await enSorteada(m);
    ponerPaso(resultado([fila(L1, "Ana P."), fila(L2, "Winner 2")]));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe("Wait until you see the codes before sending a prize.");
    ponerPaso(resultado([fila(L1, "Ana P.", { codigo: "0421", avisada: true }), fila(L2, "Winner 2", { codigo: "7310" })]));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe("Check the code on the winner's phone and send their prize to the address they give you.");
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Marked as notified.", "Code 0421", "40.00 digital dollars", "Send 40.00"]);
  });
});

describe("si esta sesión puede mandar se pregunta al entrar al resultado y cuando cambia la cuenta", () => {
  it("antes del resultado no se pregunta nada, y al entrar se pregunta una vez aunque el panel se pinte muchas veces", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    const p = await enSorteada(m);
    expect(mandar.preguntas).toBe(0);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(mandar.preguntas).toBe(1);
    p.pintar();
    p.pintar();
    ponerPaso(resultado(TRES_CON_CODIGO().map((f) => ({ ...f, avisada: true }))));
    await suelta(3);
    expect(mandar.preguntas).toBe(1);
  });

  it("sin sesión no hay botón, y cuando entra la cuenta que organiza se pregunta de nuevo y aparece", async () => {
    const m = mundo();
    const mandar = conMandar(m, false);
    const p = await enSorteada(m, CON_DOLARES, ORIGEN);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(deMandar(p)).toEqual([]);
    const antes = mandar.preguntas;
    m.cuenta = ORIGEN;
    mandar.puede = true;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: ORIGEN }));
    await suelta(4);
    expect(mandar.preguntas).toBeGreaterThan(antes);
    expect(deMandar(p)).toHaveLength(3);
  });

  it("si la sesión se cierra, el botón se va", async () => {
    const m = mundo();
    m.cuenta = ORIGEN;
    const mandar = conMandar(m);
    const p = await enSorteada(m, CON_DOLARES, ORIGEN);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(deMandar(p)).toHaveLength(3);
    m.cuenta = null;
    mandar.puede = false;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: null }));
    await suelta(4);
    expect(deMandar(p)).toEqual([]);
    // El nombre, el código y el monto no dependen de la sesión.
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Código 0421", "40,00 dólares digitales"]);
  });

  it("un aviso de sesión con la misma cuenta no hace parpadear los botones mientras se vuelve a preguntar", async () => {
    const m = mundo();
    m.cuenta = ORIGEN;
    const mandar = conMandar(m);
    const p = await enSorteada(m, CON_DOLARES, ORIGEN);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(deMandar(p)).toHaveLength(3);
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: ORIGEN }));
    // Todavía sin la respuesta nueva: los botones siguen.
    expect(deMandar(p)).toHaveLength(3);
    await suelta(4);
    expect(mandar.preguntas).toBe(2);
    expect(deMandar(p)).toHaveLength(3);
  });

  it("si la pregunta falla, no hay botón y el panel no se rompe", async () => {
    const m = mundo();
    m.deps.mandarPremio = {
      puede: async () => {
        throw new Error("no bajó");
      },
      abrir: async () => "abierta",
    };
    const p = await enSorteada(m);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(4);
    expect(deMandar(p)).toEqual([]);
    expect(texto(p, "#cpo-linea")).toBe(CON_CODIGOS);
  });
});

/* ------------------------------------------------------------ lo que no cambia */

describe("con premio en mano todo queda como estaba", () => {
  it("el resultado dice que se entrega, sin montos, sin Mandar y sin preguntar si se puede mandar", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    const p = await enSorteada(m, EN_MANO);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio a quien te muestre su código.");
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Código 0421"]);
    expect(deMandar(p)).toEqual([]);
    expect(p.raiz.textContent).not.toMatch(/dólares|Mandar/u);
    expect(mandar.preguntas).toBe(0);
    expect(seVe($(p, "#cpo-pie"))).toBe(false);
    ponerPaso(resultado([fila(L1, "Ana P."), fila(L2, "Ganadora 2")]));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio en mano.");
  });

  it("con todas avisadas, Elegir otro archivo deja la campaña sin preguntar, como siempre", async () => {
    const m = mundo();
    const p = await enSorteada(m, EN_MANO);
    ponerPaso(resultado(TRES_CON_CODIGO().map((f) => ({ ...f, avisada: true }))));
    await suelta(3);
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
  });

  it("con alguien sin avisar pregunta con la línea de los avisos, como siempre", async () => {
    const m = mundo();
    const p = await enSorteada(m, EN_MANO);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    expect(texto(p, "#cpo-linea")).toBe(AL_DEJAR_CON_AVISOS);
  });
});

describe("una campaña de cuentas queda como estaba", () => {
  it("su resultado no lleva montos por fila, ni Mandar, ni pie, y no pregunta si se puede mandar", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    const p = await enSorteada(m, DE_CUENTAS);
    ponerPaso({
      paso: "resultado",
      otraBilletera: false,
      filas: [fila("GANA", "Ana P.", { avisada: true, alta: { estado: "puede" } }), fila("GNORA", "Nora L.", { codigo: "0042" })],
    });
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe("Los celulares ya pueden ver quién ganó.");
    expect(partes(filasDelResultado(p)[0] as HTMLLIElement)).toEqual(["Ana P.", "Le avisamos en su celular.", "Puede recibir"]);
    expect(deMandar(p)).toEqual([]);
    expect(p.raiz.querySelector("#cpo-ganadoras")?.textContent).not.toMatch(/dólares|0042/u);
    expect(mandar.preguntas).toBe(0);
    expect(seVe($(p, "#cpo-pie"))).toBe(false);
  });

  it("con todas avisadas, Elegir otro archivo deja la campaña sin preguntar, como siempre", async () => {
    const m = mundo();
    const p = await enSorteada(m, DE_CUENTAS);
    ponerPaso({ paso: "resultado", otraBilletera: false, filas: [fila("GANA", "Ana P.", { avisada: true })] });
    await suelta(3);
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
  });

  it("una lista de personas en una sala cuya campaña es de cuentas se trata como en mano: sin plata", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    const p = await enSorteada(m, DE_CUENTAS);
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio a quien te muestre su código.");
    expect(deMandar(p)).toEqual([]);
    expect(p.raiz.querySelector("#cpo-ganadoras")?.textContent).not.toContain("dólares");
    expect(mandar.preguntas).toBe(0);
  });
});

describe("con la campaña sin leer, el resultado no habla de plata", () => {
  it("si la sala no dejó leer la campaña y otra compu la tomó, no hay montos, ni Mandar, ni preguntas", async () => {
    const m = mundo();
    const mandar = conMandar(m);
    m.deps.campanaDeSala = async () => "red";
    m.respuestaAlEstado.push({ fase: "sorteada", total: 3, cierraMs: m.sala.cierraMs, tuya: false });
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("tomada"));
    ponerPaso(resultado(TRES_CON_CODIGO()));
    await suelta(3);
    expect(p.raiz.textContent).not.toMatch(/dólares|Mandar|Código/u);
    expect(deMandar(p)).toEqual([]);
    expect(mandar.preguntas).toBe(0);
    expect(seVe($(p, "#cpo-pie"))).toBe(false);
  });
});
