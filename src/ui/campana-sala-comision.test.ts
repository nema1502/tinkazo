// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El cobro de Tinkazo en el panel de quien organiza, con el mundo de mentira de siempre y las dependencias del cobro
 * también de mentira: la red, el saldo, el servicio de comisiones y el pago. Sin red y sin reloj real. Los textos que se
 * comparan están escritos a mano: son lo que lee la persona.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CENTAVO } from "../campana/comision";
import type { LecturaDeComision } from "../campana/comision-red";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { CLAVE_ORG, guardarOrg } from "../sala/campana-org";
import type { ConfigDeComision } from "../stellar/comision-config";
import type { DepsDeComision, PedidoDePagoDeComision, ResultadoDelPagoDeComision } from "./campana-comision";
import {
  $,
  SALA,
  type Mundo,
  type Panel,
  archivoDe,
  boton,
  botones,
  cerrarTodos,
  elegirArchivo,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
  almacenFalso,
} from "./campana-sala-mundo";

const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const ORIGEN = cuentaDePrueba(5);
const CUENTA_COMISION = cuentaDePrueba(2);
const COBROS = cuentaDePrueba(1);
const CONFIG: ConfigDeComision = { pb: 200n, minimo: d(1.5), cuenta: CUENTA_COMISION, costo: d(0.5), cobros: COBROS };
/** Una campaña de 120: la comisión es 2,40 y se cargan 122,40. */
const DE_120 = { premios: ["1200000000"] };

/** Lo que el mundo del cobro contesta y lo que se le pidió: cada prueba lo ajusta. */
interface Cobro {
  config: ConfigDeComision | null;
  billetera: "google" | "otra";
  red: LecturaDeComision;
  saldo: bigint | "sin-red";
  portero: "atiende" | "no" | "sin-respuesta";
  resultado: ResultadoDelPagoDeComision;
  puedeVolver: boolean;
  confirmado: boolean | null;
  /** Lo que ocurre justo al pagar (por ejemplo, que la red ya vea el pago). */
  alPagar: ((p: PedidoDePagoDeComision) => void) | null;
  llamadas: string[];
  pedidos: PedidoDePagoDeComision[];
  cargas: string[];
  alCerrarLaCarga: (() => void) | null;
  deps: DepsDeComision;
}

function cobro(m: Mundo, cambios: Partial<Cobro> = {}): Cobro {
  const colas = new Map<string, Promise<unknown>>();
  const c: Cobro = {
    config: CONFIG,
    billetera: "google",
    red: { tipo: "no-pagada", suma: 0n },
    saldo: d(150),
    portero: "atiende",
    resultado: { tipo: "listo", hash: "a".repeat(64) },
    puedeVolver: true,
    confirmado: null,
    alPagar: null,
    llamadas: [],
    pedidos: [],
    cargas: [],
    alCerrarLaCarga: null,
    deps: undefined as never,
    ...cambios,
  };
  c.deps = {
    comision: () => c.config,
    billetera: async () => c.billetera,
    mirarRed: async () => {
      c.llamadas.push("red");
      return c.red;
    },
    saldo: async () => {
      c.llamadas.push("saldo");
      return c.saldo;
    },
    portero: async () => {
      c.llamadas.push("portero");
      return c.portero;
    },
    pagar: async (p) => {
      c.llamadas.push("pagar");
      c.pedidos.push(p);
      p.alMandar("1001", "b".repeat(64));
      c.alPagar?.(p);
      return c.resultado;
    },
    confirmar: async () => c.confirmado,
    puedeVolverALista: async () => c.puedeVolver,
    cargar: (cuenta, alCerrar) => {
      c.cargas.push(cuenta);
      c.alCerrarLaCarga = alCerrar;
    },
    // Un candado de mentira: lo que pide el mismo nombre corre de a uno, en orden.
    candado: (nombre, f) => {
      const antes = colas.get(nombre) ?? Promise.resolve();
      const sigue = antes.then(f, f);
      colas.set(nombre, sigue.catch(() => undefined));
      return sigue as Promise<never>;
    },
  };
  m.deps.comision = c.deps;
  return c;
}

/** El mundo con la cuenta de Google entrada y el cobro armado. */
function armar(cambios: Partial<Cobro> = {}): { m: Mundo; c: Cobro } {
  const m = mundo();
  m.cuenta = ORIGEN;
  m.deps.cambiarDeCuenta = () => void (m.cuenta = null);
  const c = cobro(m, cambios);
  return { m, c };
}

const eligiendo = async (m: Mundo, p: Panel, cambios: Record<string, unknown> = DE_120): Promise<void> => {
  await elegirArchivo(m, p, archivoDe(cambios));
  await suelta(6);
};

const botonesDe = (p: Panel): string[] => botones(p).map((b) => (b.textContent ?? "").trim());

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cerrarTodos();
  vi.restoreAllMocks();
});

describe("falta cargar", () => {
  it("elegir el archivo mira la red y, sin saldo, dice cuánto cargar en total", async () => {
    const { m, c } = armar({ saldo: 0n });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(c.llamadas).toContain("red");
    expect(texto(p, "#cpo-h")).toBe("Cargá 122,40");
    expect(texto(p, "#cpo-linea")).toBe("120 de premio y 2,40 del servicio de Tinkazo.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cargar dólares digitales"]);
    expect(botonesDe(p)).not.toContain("Abrir la inscripción");
  });

  it("con un premio chico la comisión es el mínimo y la línea lo cuenta", async () => {
    const { m } = armar({ saldo: 0n });
    const p = nuevoPanel(m);
    await eligiendo(m, p, { premios: ["120000000"] });
    // 12 de premios: la comisión es el mínimo (1,50) y se cargan 13,50.
    expect(texto(p, "#cpo-h")).toBe("Cargá 13,50");
    expect(texto(p, "#cpo-linea")).toBe("12 de premio y 1,50 del servicio de Tinkazo.");
  });

  it("con un saldo que no alcanza, dice cuánto tiene y cuánto falta, un solo número de carga", async () => {
    const { m } = armar({ saldo: d(100) });
    const p = nuevoPanel(m);
    await eligiendo(m, p, { premios: ["1000000000"] });
    expect(texto(p, "#cpo-h")).toBe("Cargá 2 más");
    expect(texto(p, "#cpo-linea")).toBe("Tenés 100. Son 100 de premio y 2 del servicio.");
  });

  it("Cargar abre la ventana con la cuenta y, al cerrarla, vuelve a mirar", async () => {
    const { m, c } = armar({ saldo: 0n });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Cargar dólares digitales").click();
    expect(c.cargas).toEqual([ORIGEN]);
    const antes = c.llamadas.filter((x) => x === "red").length;
    c.saldo = d(1300);
    c.alCerrarLaCarga?.();
    await suelta(6);
    expect(c.llamadas.filter((x) => x === "red").length).toBe(antes + 1);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
  });

  it("deja abierto el pago desde otra billetera, plegado", async () => {
    const { m } = armar({ saldo: 0n });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    const plegado = $<HTMLDetailsElement>(p, "#cpo-comision");
    expect(plegado.hidden).toBe(false);
    expect(plegado.open).toBe(false);
  });
});

describe("listo para pagar", () => {
  it("con el saldo, un solo botón principal con lo que sale, y no hay Abrir la inscripción", async () => {
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
    expect(texto(p, "#cpo-linea")).toBe("Es el servicio. Los 120 quedan para el premio.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
    expect(botonesDe(p)).not.toContain("Abrir la inscripción");
    expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
  });

  it("el ensayo de un premio de 1 paga el mínimo: Pagar 1,50", async () => {
    const { m } = armar({ saldo: d(2.5) });
    const p = nuevoPanel(m);
    await eligiendo(m, p, { premios: ["10000000"] });
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 1,50"]);
  });

  it("un centavo menos que los premios más la comisión, falta cargar", async () => {
    const { m } = armar({ saldo: d(2.49) });
    const p = nuevoPanel(m);
    await eligiendo(m, p, { premios: ["10000000"] });
    expect(texto(p, "#cpo-h")).toBe("Cargá 0,01 más");
  });

  it("un premio con fracción de centavo no se acepta", async () => {
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p, { premios: ["1000000001"] });
    expect(texto(p, "#cpo-aviso")).toBe("Revisá el campo premios.");
    expect(vistaDe(p)).toBe("elegir");
  });
});

describe("pagar", () => {
  it("crea la sala primero, después paga, y recién pagado muestra Abrir la inscripción", async () => {
    const { m, c } = armar();
    const registro: string[] = [];
    const crearAntes = m.deps.crear;
    m.deps.crear = async (a, de) => {
      registro.push("crear");
      return crearAntes(a, de);
    };
    c.alPagar = () => registro.push("pagar");
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(registro).toEqual(["crear", "pagar"]);
    expect(m.creadas).toHaveLength(1);
    expect(m.fases).toEqual([]);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
    expect(texto(p, "#cpo-h")).toBe("Sorteo de Alcancía Andina");
  });

  it("pone la marca con la secuencia antes de mandar", async () => {
    const { m, c } = armar();
    let marca: string | null = null;
    c.alPagar = () => {
      marca = m.almacen.getItem("tinkazo.comision.marca.evento-uno");
    };
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(JSON.parse(marca ?? "{}")).toMatchObject({ seq: "1001", hash: "b".repeat(64) });
  });

  it("lo pagado se guarda con el hash y el umbral", async () => {
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(JSON.parse(m.almacen.getItem("tinkazo.comision.evento-uno") ?? "{}")).toEqual({ pagada: "a".repeat(64), umbral: String(d(1.9)) });
    expect(m.almacen.getItem("tinkazo.comision.marca.evento-uno")).toBeNull();
  });

  it("después de pagar, Abrir la inscripción abre sin crear otra sala", async () => {
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas).toHaveLength(1);
    expect(m.fases).toEqual([["abierta", null]]);
  });

  it("si crear la sala falla, no se arma ningún pago: firma, ya existe y cupo lleno", async () => {
    const casos: Array<["firma" | "ya-existe" | "cupo-campanas" | "vencida", string]> = [
      ["firma", "Pedile a Tinkazo el archivo firmado."],
      ["ya-existe", "Ya se abrió. Pedile otro archivo a Tinkazo."],
      ["cupo-campanas", "Cupo de hoy lleno. Avisale a Tinkazo."],
      ["vencida", "Esta campaña ya terminó."],
    ];
    for (const [motivo, aviso] of casos) {
      document.body.innerHTML = "";
      const { m, c } = armar();
      m.respuestasAlCrear.push(motivo);
      const p = nuevoPanel(m);
      await eligiendo(m, p);
      boton(p, "Pagar 2,40").click();
      await suelta(8);
      expect(texto(p, "#cpo-aviso"), motivo).toBe(aviso);
      expect(c.llamadas.filter((x) => x === "pagar"), motivo).toEqual([]);
      expect(principales(p).map((b) => b.textContent), motivo).toEqual(["Pagar 2,40"]);
      cerrarTodos();
    }
  });

  it("abrir la inscripción no crea la sala sin el cobro pagado, aunque se toque un botón viejo", async () => {
    // Sin el cobro prendido el botón es el de siempre; con el cobro prendido y sin pagar, tocar ese botón viejo no abre nada.
    const { m, c } = armar({ config: null });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    const viejo = boton(p, "Abrir la inscripción");
    c.config = CONFIG;
    viejo.click();
    await suelta(8);
    expect(m.creadas).toHaveLength(0);
    expect(m.fases).toEqual([]);
  });

  it("mientras paga, el botón dice Pagando y no deja dejar la campaña", async () => {
    const { m, c } = armar();
    let soltar: (() => void) | null = null;
    c.deps.pagar = (p) => {
      p.alMandar("1001", null);
      return new Promise((r) => {
        soltar = () => r({ tipo: "listo", hash: null });
      });
    };
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Pagando 2,40 a Tinkazo");
    expect(texto(p, "#cpo-linea")).toBe("Los 120 quedan para el premio.");
    expect(botonesDe(p)).toEqual(["Pagando…"]);
    (soltar as (() => void) | null)?.();
    await suelta(8);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });
});

describe("la duda", () => {
  const conPagoEnCurso = async (): Promise<{ m: Mundo; c: Cobro; p: Panel }> => {
    const { m, c } = armar({ resultado: { tipo: "en-curso", hasta: null } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    return { m, c, p };
  };

  it("un pago que quizás salió deja Todavía no sabemos, con Volver a mirar y sin Pagar", async () => {
    const { p } = await conPagoEnCurso();
    expect(texto(p, "#cpo-h")).toBe("Todavía no sabemos si se pagó");
    expect(texto(p, "#cpo-linea")).toMatch(/^No pagues de nuevo\. Se aclara antes de las \d{2}:\d{2}\.$/);
    // En la duda no se invita a empezar de nuevo: solo Volver a mirar.
    expect(botonesDe(p)).toEqual(["Volver a mirar"]);
    expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
  });

  it("recargar sigue en duda: un panel nuevo con el mismo almacén", async () => {
    const { m } = await conPagoEnCurso();
    document.body.innerHTML = "";
    const otro = nuevoPanel(m);
    await eligiendo(m, otro);
    expect(texto(otro, "#cpo-h")).toBe("Todavía no sabemos si se pagó");
    expect(botonesDe(otro)).not.toContain("Pagar 2,40");
  });

  it("Volver a mirar con la red pagada borra la marca y deja abrir", async () => {
    const { m, c, p } = await conPagoEnCurso();
    c.red = { tipo: "pagada", suma: d(1.9) };
    boton(p, "Volver a mirar").click();
    await suelta(8);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
    expect(m.almacen.getItem("tinkazo.comision.marca.evento-uno")).toBeNull();
  });

  it("el respaldo que no es Horizon confirma un pago cuyo hash se conoce", async () => {
    const { c, p } = await conPagoEnCurso();
    c.confirmado = true;
    boton(p, "Volver a mirar").click();
    await suelta(8);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("al vencer la marca se mira sola y, sin pago a la vista y con la mirada consistente, vuelve a Pagar", async () => {
    const { m, p } = await conPagoEnCurso();
    await m.correr(361_000);
    await suelta(8);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
  });

  it("al vencer la marca con la secuencia consumida y sin el pago a la vista, sigue sin ofrecer Pagar", async () => {
    const { m, c, p } = await conPagoEnCurso();
    c.puedeVolver = false;
    await m.correr(361_000);
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    expect(botonesDe(p)).not.toContain("Pagar 2,40");
  });

  it("al vencer la marca con el pago ya visible en la red, queda pagada", async () => {
    const { m, c, p } = await conPagoEnCurso();
    c.red = { tipo: "pagada", suma: d(1.9) };
    await m.correr(361_000);
    await suelta(8);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("una marca vencida sin secuencia no queda trabada: con la mirada consistente vuelve a Pagar", async () => {
    const { m, c } = armar();
    const pedidas: string[] = [];
    c.deps.puedeVolverALista = async (_origen, secuencia) => {
      pedidas.push(secuencia);
      return true;
    };
    m.almacen.setItem("tinkazo.comision.marca.evento-uno", JSON.stringify({ hasta: m.ahora - 1_000, seq: null, hash: null }));
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(pedidas).toEqual(["0"]);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
    expect(m.almacen.getItem("tinkazo.comision.marca.evento-uno")).toBeNull();
  });

  it("una marca con una secuencia que no es un número se mira como sin secuencia", async () => {
    const { m, c } = armar();
    const pedidas: string[] = [];
    c.deps.puedeVolverALista = async (_origen, secuencia) => {
      pedidas.push(secuencia);
      return false;
    };
    m.almacen.setItem("tinkazo.comision.marca.evento-uno", JSON.stringify({ hasta: m.ahora - 1_000, seq: "x1", hash: null }));
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(pedidas).toEqual(["0"]);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
  });

  it("dos paneles con el mismo candado: el segundo no llama a pagar", async () => {
    const { m, c } = armar({ resultado: { tipo: "en-curso", hasta: null } });
    const p1 = nuevoPanel(m);
    await eligiendo(m, p1);
    const p2 = nuevoPanel(m);
    await eligiendo(m, p2);
    boton(p1, "Pagar 2,40").click();
    boton(p2, "Pagar 2,40").click();
    await suelta(12);
    expect(c.llamadas.filter((x) => x === "pagar")).toHaveLength(1);
    expect(texto(p2, "#cpo-h")).toBe("Todavía no sabemos si se pagó");
  });
});

describe("lo que sale mal al pagar", () => {
  it("un pago que no salió deja Pagar con el aviso y sin marca", async () => {
    const { m, c } = armar({ resultado: { tipo: "no-salio" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-aviso")).toBe("No se pagó nada. Probá de nuevo.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
    expect(m.almacen.getItem("tinkazo.comision.marca.evento-uno")).toBeNull();
    expect(c.pedidos).toHaveLength(1);
  });

  it("después de dos intentos que no salieron, queda el pago desde otra billetera", async () => {
    const { m } = armar({ resultado: { tipo: "no-salio" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Falta pagar a Tinkazo");
    expect(texto(p, "#cpo-linea")).toBe("Tu cuenta no puede ahora. Usá otra billetera.");
    expect($<HTMLDetailsElement>(p, "#cpo-comision").open).toBe(true);
    expect(botonesDe(p)).not.toContain("Pagar 2,40");
  });

  it("pedir recargar la página dice eso", async () => {
    const { m } = armar({ resultado: { tipo: "recargar" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-aviso")).toBe("No se pagó nada. Recargá la página.");
  });

  it("otro retiro en camino dice que se pruebe en unos minutos y no marca nada", async () => {
    const { m } = armar({ resultado: { tipo: "ocupada" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-aviso")).toBe("Hay otro pago en camino. Probá en unos minutos.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
  });

  it("sin saldo al preparar, vuelve a Falta cargar", async () => {
    const { m, c } = armar({ resultado: { tipo: "sin-saldo" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    c.saldo = d(10);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Cargá 112,40 más");
  });

  it("una red atrasada o sin respuesta antes de mandar deja Sin conexión y nunca Pagar", async () => {
    const { m } = armar({ resultado: { tipo: "sin-mirar" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    expect(texto(p, "#cpo-linea")).toBe("No pudimos ver si ya se pagó.");
    expect(botonesDe(p)).toEqual(["Volver a mirar", "Elegir otro archivo"]);
  });

  it("una transacción de la cuenta con la nota ya en la red no se paga de nuevo", async () => {
    const { m, c } = armar({ resultado: { tipo: "ya-hay-pago" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(10);
    expect(c.pedidos).toHaveLength(1);
    expect(botonesDe(p)).not.toContain("Pagar 2,40");
  });

  it("un error antes de mandar no deja una duda: no se pagó nada y se puede probar de nuevo", async () => {
    const { m, c } = armar();
    c.deps.pagar = async () => {
      c.llamadas.push("pagar");
      throw new Error("un pedazo del sitio que no bajó");
    };
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-aviso")).toBe("No se pagó nada. Probá de nuevo.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
    expect(m.almacen.getItem("tinkazo.comision.marca.evento-uno")).toBeNull();
  });

  it("un error después de poner la marca sí deja la duda, sin Pagar", async () => {
    const { m, c } = armar();
    c.deps.pagar = async (pedido) => {
      pedido.alMandar("1001", "b".repeat(64));
      throw new Error("se cortó con el pago en el aire");
    };
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Todavía no sabemos si se pagó");
    expect(botonesDe(p)).not.toContain("Pagar 2,40");
  });

  it("el servicio que ya no atiende al pagar deja el pago desde otra billetera", async () => {
    const { m } = armar({ resultado: { tipo: "ahora-no" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pagar 2,40").click();
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Falta pagar a Tinkazo");
  });
});

describe("el servicio de comisiones y la red", () => {
  it("con el servicio que no atiende retiros, no hay Pagar ni Probá en un rato: queda otra billetera", async () => {
    const { m } = armar({ portero: "no" });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Falta pagar a Tinkazo");
    expect(texto(p, "#cpo-linea")).not.toMatch(/en un rato/);
    expect($<HTMLDetailsElement>(p, "#cpo-comision").open).toBe(true);
    expect(botonesDe(p)).not.toContain("Pagar 2,40");
  });

  it("si el servicio no contesta, Sin conexión con Volver a mirar", async () => {
    const { m } = armar({ portero: "sin-respuesta" });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Volver a mirar"]);
  });

  it("una mirada que se rompe no se queda en Un momento: Sin conexión con Volver a mirar", async () => {
    const { m, c } = armar();
    c.deps.saldo = async () => {
      throw new Error("un pedazo del sitio que no bajó");
    };
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    expect(botonesDe(p)).toEqual(["Volver a mirar", "Elegir otro archivo"]);
  });

  it("si la red no contesta, Sin conexión y Volver a mirar, nunca Pagar", async () => {
    const { m } = armar({ red: { tipo: "sin-consulta" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    expect(botonesDe(p)).toEqual(["Volver a mirar", "Elegir otro archivo"]);
  });

  it("un pago que ya vio la red desde otra billetera abre la inscripción como hoy, sin pedir saldo", async () => {
    const { m, c } = armar({ red: { tipo: "pagada", suma: d(1.9) }, billetera: "otra" });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
    expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
    expect(c.pedidos).toHaveLength(0);
  });

  it("una pagada que esta compu ya vio entrar no vuelve a preguntar a la red", async () => {
    const { m, c } = armar();
    m.almacen.setItem("tinkazo.comision.evento-uno", JSON.stringify({ pagada: "a".repeat(64), umbral: String(d(1.9)) }));
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(c.llamadas).toEqual([]);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("una pagada guardada con una comisión menor que la de ahora no vale", async () => {
    const { m } = armar();
    m.almacen.setItem("tinkazo.comision.evento-uno", JSON.stringify({ pagada: "a".repeat(64), umbral: String(d(0.5)) }));
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
  });
});

describe("el pago a medias", () => {
  it("con una parte llegada y un resto de un dólar o más, paga el resto más el costo", async () => {
    const { m } = armar({ red: { tipo: "no-pagada", suma: d(0.8) }, saldo: d(500) });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 1,60"]);
  });

  it("con un resto de menos de un dólar solo queda el pago desde otra billetera", async () => {
    const { m } = armar({ red: { tipo: "no-pagada", suma: d(1.0) }, saldo: d(500) });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Falta pagar a Tinkazo");
    expect(texto(p, "#cpo-linea")).toBe("Mandá 1,40 desde tu billetera y volvé a mirar.");
    expect(botonesDe(p)).not.toContain("Pagar 1,60");
  });
});

describe("otra billetera y otra cuenta", () => {
  it("una sesión que no es de Google: Falta pagar a Tinkazo, con Entrar con Google, sin Cargar y con el plegado", async () => {
    const { m, c } = armar({ billetera: "otra" });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Falta pagar a Tinkazo");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
    expect(botonesDe(p)).toContain("Volver a mirar");
    expect(botonesDe(p)).not.toContain("Cargar dólares digitales");
    expect(c.llamadas).not.toContain("saldo");
    expect(texto(p, "#cpo-linea")).toBe("Entrá con Google y pagás 2,40 con un toque.");
    const plegado = $<HTMLDetailsElement>(p, "#cpo-comision");
    expect(plegado.open).toBe(false);
    expect(plegado.textContent).toContain(CUENTA_COMISION);
    expect(plegado.textContent).toContain("2,40");
    expect(plegado.textContent).toMatch(/\d{13,15}/);
  });

  it("el código del plegado lleva la cuenta, el monto y la nota como número", async () => {
    const { m } = armar({ billetera: "otra" });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    const enlace = m.qrs.at(-1)?.texto ?? "";
    expect(enlace).toContain("web+stellar:pay?");
    expect(enlace).toContain(`destination=${CUENTA_COMISION}`);
    expect(enlace).toContain("amount=2.40");
    expect(enlace).toContain("memo_type=MEMO_ID");
    expect(enlace).toMatch(/memo=\d{13,15}/);
  });

  it("sin cómo entrar, el botón principal es Volver a mirar", async () => {
    const { m } = armar({ billetera: "otra" });
    m.deps.cambiarDeCuenta = undefined;
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Volver a mirar"]);
  });

  it("una campaña que pide otra cuenta: título de entrar con esa, Cambiar de cuenta, sin Cargar ni Pagar", async () => {
    const pide = cuentaDePrueba(7);
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p, { ...DE_120, organizadora: pide });
    expect(texto(p, "#cpo-h")).toBe(`Entrá con la cuenta que termina en ${pide.slice(-4)}.`);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cambiar de cuenta"]);
    expect(botonesDe(p)).not.toContain("Cargar dólares digitales");
    expect(botonesDe(p)).not.toContain("Pagar 2,40");
    // No se repite en el aviso.
    expect(texto(p, "#cpo-aviso")).toBe("");
  });

  it("con la cuenta equivocada pero ya pagado en la red, abre", async () => {
    const pide = cuentaDePrueba(7);
    const { m } = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    const p = nuevoPanel(m);
    await eligiendo(m, p, { ...DE_120, organizadora: pide });
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("con la cuenta que la campaña pide, el cobro sigue su camino", async () => {
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p, { ...DE_120, organizadora: ORIGEN });
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
  });
});

describe("retomar y despertar", () => {
  it("una sala retomada en fase lista también pide el cobro", async () => {
    const m = mundo();
    m.cuenta = ORIGEN;
    const c = cobro(m);
    guardarOrg(m.almacen, { sala: SALA, fase: "lista" });
    expect(m.almacen.getItem(CLAVE_ORG)).not.toBeNull();
    const p = nuevoPanel(m);
    await suelta(10);
    expect(vistaDe(p)).toBe("previa");
    expect(c.llamadas).toContain("red");
    expect(botonesDe(p)).not.toContain("Abrir la inscripción");
  });

  it("una sala retomada abierta no mira el cobro", async () => {
    const m = mundo();
    m.cuenta = ORIGEN;
    m.sala.fase = "abierta";
    const c = cobro(m);
    guardarOrg(m.almacen, { sala: SALA, fase: "abierta" });
    const p = nuevoPanel(m);
    await suelta(10);
    expect(vistaDe(p)).toBe("abierta");
    expect(c.llamadas).toEqual([]);
  });

  it("al volver la compu de dormir, en la vista previa sin sala, se vuelve a mirar", async () => {
    const { m, c } = armar({ red: { tipo: "sin-consulta" } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    c.red = { tipo: "no-pagada", suma: 0n };
    window.dispatchEvent(new Event("online"));
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
  });
});

describe("en inglés", () => {
  it("los mismos estados con sus claves en inglés", async () => {
    const { m } = armar({ saldo: 0n });
    m.idioma = "en";
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Load 122.40");
    expect(texto(p, "#cpo-linea")).toBe("120 for the prize and 2.40 for Tinkazo's service.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Add digital dollars"]);
  });

  it("listo para pagar y el botón en inglés", async () => {
    const { m } = armar();
    m.idioma = "en";
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Pay Tinkazo 2.40");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pay 2.40"]);
  });
});

describe("con la comisión apagada el panel es el de siempre", () => {
  /** El recorrido de siempre: elegir, previa, abrir, abierta. */
  async function recorrido(m: Mundo): Promise<string[]> {
    document.body.innerHTML = "";
    const p = nuevoPanel(m);
    const pasos: string[] = [p.raiz.outerHTML];
    await elegirArchivo(m, p, archivoDe());
    await suelta(6);
    pasos.push(p.raiz.outerHTML);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await suelta(4);
    pasos.push(p.raiz.outerHTML.replace(/PASE\d+/g, "PASE"));
    expect(p.raiz.dataset.comision).toBeUndefined();
    expect(p.raiz.querySelector("#cpo-comision")).toBeNull();
    cerrarTodos();
    return pasos;
  }

  it("sin las dependencias nuevas y con la comisión apagada el DOM es idéntico en cada paso", async () => {
    const solo = await recorrido(mundo({ almacen: almacenFalso() }));
    const m = mundo({ almacen: almacenFalso() });
    const c = cobro(m, { config: null });
    const apagado = await recorrido(m);
    expect(apagado).toEqual(solo);
    expect(c.llamadas).toEqual([]);
    expect(c.pedidos).toEqual([]);
    expect(c.cargas).toEqual([]);
  });
});

describe("lo que dice el panel de cada estado", () => {
  it("ya pagado, el panel lo marca con Servicio pagado y sigue como siempre", async () => {
    const { m } = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    const marca = $<HTMLElement>(p, "#cpo-marca");
    expect(marca.hidden).toBe(false);
    expect(marca.textContent).toBe("Servicio pagado");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("sin pagar no hay marca de pagado", async () => {
    const { m } = armar();
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect($<HTMLElement>(p, "#cpo-marca")).toBeNull();
  });

  it("sin cómo entrar, la línea manda a pagar desde la billetera y el plegado queda abierto", async () => {
    const { m } = armar({ billetera: "otra" });
    m.deps.cambiarDeCuenta = undefined;
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-linea")).toBe("Mandá 2,40 desde tu billetera y volvé a mirar.");
    expect($<HTMLDetailsElement>(p, "#cpo-comision").open).toBe(true);
  });

  it("en inglés la duda dice que no hay que pagar de nuevo", async () => {
    const { m } = armar({ resultado: { tipo: "en-curso", hasta: null } });
    m.idioma = "en";
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    boton(p, "Pay 2.40").click();
    await suelta(8);
    expect(texto(p, "#cpo-linea")).toMatch(/^Don't pay again\. We'll know by /);
    expect(botonesDe(p)).toEqual(["Check again"]);
  });

  it("con el saldo a medias, el título dice cuánto falta y la línea cuenta el premio y el servicio", async () => {
    const { m } = armar({ saldo: d(120) });
    const p = nuevoPanel(m);
    await eligiendo(m, p);
    expect(texto(p, "#cpo-h")).toBe("Cargá 2,40 más");
    expect(texto(p, "#cpo-linea")).toBe("Tenés 120. Son 120 de premio y 2,40 del servicio.");
  });
});

describe("los textos nuevos", () => {
  const CLAVES = Object.keys(TEXTOS_SALA_CAMPANA.es).filter((k) => k.startsWith("cpoCm"));

  it("hay claves nuevas y las dos listas las tienen", () => {
    expect(CLAVES.length).toBeGreaterThan(15);
    for (const k of CLAVES) expect(TEXTOS_SALA_CAMPANA.en[k], k).toBeTruthy();
  });

  it("ninguna lleva punto y coma, comillas, raya larga, punto medio, exclamaciones, fee, comisión ni palabras de azar", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const t = TEXTOS_SALA_CAMPANA[idioma][k] ?? "";
        expect(t, `${idioma}.${k}`).not.toMatch(/[;«»"“”—–·¡!]/u);
        expect(t, `${idioma}.${k}`).not.toMatch(/\b(?:fee|raffle|lottery|ticket|bet|rifa|boleto|apuesta|lotería)\b|comisi[oó]n/iu);
      }
    }
  });

  it("ninguna lleva palabras técnicas: ni memo, ni red, ni firma, ni hash, ni transacción", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const t = TEXTOS_SALA_CAMPANA[idioma][k] ?? "";
        expect(t, `${idioma}.${k}`).not.toMatch(/\b(?:memo|red|firma|hash|transacci[oó]n|network|signature|transaction|blockchain)\b/iu);
      }
    }
  });
});
