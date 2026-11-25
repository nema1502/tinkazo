/** La comprobación propia del sello: el celular lee el sello del historial, sin creerle al servidor. */

import { describe, expect, it } from "vitest";
import { listHash } from "../protocol/canonical";
import { encodeProof, type Proof } from "../protocol/proof";
import { bytesToHex, roundAt, roundTime } from "../protocol/quicknet";
import type { ErrorDelHistorial, LecturaDelHistorial, SelloDelHistorial } from "../stellar/historial";
import {
  comprobarConReintento,
  comprobarMiCuenta,
  ESPERAS_DEL_SELLO_MS,
  TOPE_DEL_SELLO_MS,
  type DeLaCampana,
  type PiezasConReintento,
  type PiezasDeLaComprobacion,
} from "./comprobar";

const AHORA = Date.UTC(2026, 10, 21, 18);
const RED = "mainnet";
const CONTRATO = `C${"A".repeat(63)}`;
const CONTRATO_DE_PREMIOS = `C${"P".repeat(55)}`;
const CUENTA = `G${"A".repeat(55)}`;
const OTRA = `G${"B".repeat(55)}`;
const TERCERA = `G${"C".repeat(55)}`;
const RONDA = 32_254_977;
const SORTEO = "7";
const rondaPasada = (): number => Math.floor(AHORA / 900_000) - 3;

function sello(nombres: string[], extras: Partial<SelloDelHistorial> = {}): SelloDelHistorial {
  return {
    hash: "0".repeat(64),
    hashInterior: "1".repeat(64),
    contractId: CONTRATO,
    organizer: `G${"D".repeat(55)}`,
    listHash: bytesToHex(listHash([...nombres])),
    count: nombres.length,
    numWinners: 1,
    round: rondaPasada(),
    meta: "",
    closedAt: Math.floor(AHORA / 1000) - 60,
    ledger: 12_345,
    ...extras,
  };
}

async function comprobanteDe(nombres: string[], extras: Partial<Proof> = {}): Promise<string> {
  const prueba: Proof = {
    v: 2,
    names: [...nombres],
    round: RONDA,
    net: RED,
    contract: CONTRATO,
    id: SORTEO,
    signature: "0".repeat(96),
    stx: "2".repeat(64),
    ...extras,
  };
  const fragmento = await encodeProof(prueba);
  return `/verificar.html#${fragmento}`;
}

/** Lo que la sala dice de la campaña: el sorteo que selló y la primera cuenta de la lista como ganadora. */
function campanaDe(nombres: string[], extras: Partial<DeLaCampana> = {}): DeLaCampana {
  return { sorteo: SORTEO, ganadoras: [nombres[0] as string], promo: null, ...extras };
}

function piezas(
  nombres: string[],
  extras: Partial<SelloDelHistorial> = {},
  lectura: LecturaDelHistorial | null = null,
): PiezasDeLaComprobacion {
  return {
    leer: async () => lectura ?? { ok: true, sello: sello(nombres, extras) },
    ahora: () => AHORA,
  };
}

async function comprobar(
  nombres: string[],
  p: PiezasDeLaComprobacion,
  o: { contrato?: string | null; red?: string; campana?: Partial<DeLaCampana>; comprobante?: Partial<Proof> } = {},
): Promise<"esta" | "no-esta" | null> {
  const enlace = await comprobanteDe(nombres, o.comprobante);
  return comprobarMiCuenta(
    {
      comprobante: enlace,
      cuenta: CUENTA,
      red: o.red ?? RED,
      contrato: o.contrato === undefined ? CONTRATO : o.contrato,
      campana: campanaDe(nombres, o.campana),
    },
    p,
  );
}

describe("comprobarMiCuenta: el celular se cree la red, no al servidor", () => {
  it("una transacción que incluye la cuenta dice esta", async () => {
    const lista = [CUENTA, OTRA, TERCERA];
    expect(await comprobar(lista, piezas(lista))).toBe("esta");
  });

  it("una transacción sellada con otra lista que no la incluye dice no-esta", async () => {
    const lista = [OTRA, TERCERA];
    expect(await comprobar(lista, piezas(lista))).toBe("no-esta");
  });

  it("la huella de la transacción que no es la del comprobante no dice nada", async () => {
    const lista = [CUENTA, OTRA];
    expect(await comprobar(lista, piezas(lista, { listHash: "ab".repeat(32) }))).toBeNull();
  });

  it("un comprobante que no está en orden canónico no dice nada", async () => {
    const enlace = await comprobanteDe([OTRA, CUENTA]);
    expect(
      await comprobarMiCuenta(
        { comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO, campana: campanaDe([OTRA, CUENTA]) },
        piezas([CUENTA, OTRA]),
      ),
    ).toBeNull();
  });

  it("sin transacción legible no dice nada", async () => {
    const lista = [CUENTA, OTRA];
    expect(await comprobar(lista, piezas(lista, {}, { ok: false, error: "no-encontrada" }))).toBeNull();
  });

  it("un comprobante sin el hash del sello no dice nada", async () => {
    const lista = [CUENTA, OTRA];
    expect(await comprobar(lista, piezas(lista), { comprobante: { stx: undefined } })).toBeNull();
  });

  it("un comprobante que no se puede leer no dice nada y no lanza", async () => {
    expect(
      await comprobarMiCuenta(
        { comprobante: "/verificar.html#no-es-nada", cuenta: CUENTA, red: RED, contrato: CONTRATO, campana: campanaDe([CUENTA]) },
        piezas([CUENTA, OTRA]),
      ),
    ).toBeNull();
  });

  it("una campaña en otra red no acepta el comprobante de otra", async () => {
    const lista = [CUENTA, OTRA];
    expect(await comprobar(lista, piezas(lista), { red: "testnet" })).toBeNull();
  });

  it("el sello en otro contrato no aplica a esta campaña", async () => {
    const lista = [CUENTA, OTRA];
    expect(
      await comprobar(lista, piezas(lista, { contractId: `C${"Z".repeat(63)}` }), { contrato: `C${"F".repeat(63)}` }),
    ).toBeNull();
  });

  it("el sello de una ronda que todavía no salió no dice nada", async () => {
    const lista = [CUENTA, OTRA];
    const rondaFutura = roundAt(AHORA / 1000) + 2;
    expect(await comprobar(lista, piezas(lista, { round: rondaFutura }))).toBeNull();
  });

  it("la ronda del sello se mira con la hora de la campaña, no con la del reloj", async () => {
    const lista = [CUENTA, OTRA];
    const rondaQueYaSalio = roundAt(AHORA / 1000) - 5_000;
    expect(roundTime(rondaQueYaSalio) * 1000).toBeLessThanOrEqual(AHORA);
    expect(await comprobar(lista, piezas(lista, { round: rondaQueYaSalio }))).toBe("esta");
  });

  it("una lista con algo que no sea una cuenta no dice nada", async () => {
    const lista = ["Ana P.", OTRA];
    expect(await comprobar(lista, piezas(lista))).toBeNull();
  });

  it("una lista de una sola persona también se comprueba", async () => {
    const lista = [OTRA];
    expect(await comprobar(lista, piezas(lista))).toBe("no-esta");
  });
});

describe("comprobarMiCuenta: contra la campaña y no solo contra el contrato", () => {
  const lista = [CUENTA, OTRA, TERCERA];

  it("el comprobante de otro sorteo del mismo contrato no dice nada", async () => {
    expect(await comprobar(lista, piezas(lista), { comprobante: { id: "8" } })).toBeNull();
  });

  it("si la sala no dijo qué sorteo selló la campaña, no se afirma nada", async () => {
    expect(await comprobar(lista, piezas(lista), { campana: { sorteo: null } })).toBeNull();
  });

  it("si la cantidad de premios del sello no es la de la campaña, no dice nada", async () => {
    expect(await comprobar(lista, piezas(lista, { numWinners: 2 }))).toBeNull();
  });

  it("si una ganadora de la campaña no está en la lista sellada, no dice nada", async () => {
    expect(await comprobar(lista, piezas(lista), { campana: { ganadoras: [`G${"E".repeat(55)}`] } })).toBeNull();
  });

  it("con la promoción de la campaña, el sello tiene que ser de esa promoción", async () => {
    const delSello = { premio: { contrato: CONTRATO_DE_PREMIOS, promocionId: "41" } as unknown as SelloDelHistorial["premio"] };
    expect(await comprobar(lista, piezas(lista, delSello), { campana: { promo: "41" } })).toBe("esta");
    expect(await comprobar(lista, piezas(lista, delSello), { campana: { promo: "42" } })).toBeNull();
    // Un sello sin promoción detrás no es el de una campaña que la tiene.
    expect(await comprobar(lista, piezas(lista), { campana: { promo: "41" } })).toBeNull();
  });

  it("acepta el contrato de premios de la campaña cuando el sello es de una promoción", async () => {
    const delSello = { premio: { contrato: CONTRATO_DE_PREMIOS, promocionId: "41" } as unknown as SelloDelHistorial["premio"] };
    expect(
      await comprobar(lista, piezas(lista, delSello), { contrato: CONTRATO_DE_PREMIOS, campana: { promo: "41" } }),
    ).toBe("esta");
  });
});

describe("comprobarConReintento: lee con reintento y con tope", () => {
  const lista = [CUENTA, OTRA];

  /** Un lector que contesta lo que se le diga, en orden, y cuenta cuántas veces se lo llamó. */
  function lector(respuestas: (LecturaDelHistorial | "lanza")[]): {
    piezas: PiezasConReintento;
    llamadas: () => number;
    esperas: number[];
    reloj: { ahora: number };
  } {
    const reloj = { ahora: AHORA };
    const esperas: number[] = [];
    let n = 0;
    return {
      reloj,
      esperas,
      llamadas: () => n,
      piezas: {
        leer: async () => {
          const r = respuestas[Math.min(n, respuestas.length - 1)] as LecturaDelHistorial | "lanza";
          n += 1;
          if (r === "lanza") throw new Error("sin conexión");
          return r;
        },
        ahora: () => reloj.ahora,
        esperar: async (ms) => {
          esperas.push(ms);
          reloj.ahora += ms;
        },
      },
    };
  }
  const buena: LecturaDelHistorial = { ok: true, sello: sello(lista) };
  const mala = (error: ErrorDelHistorial): LecturaDelHistorial => ({ ok: false, error });

  async function correr(p: PiezasConReintento): Promise<"esta" | "no-esta" | null> {
    return comprobarConReintento(
      { comprobante: await comprobanteDe(lista), cuenta: CUENTA, red: RED, contrato: CONTRATO, campana: campanaDe(lista) },
      p,
    );
  }

  it("a la primera no espera nada", async () => {
    const l = lector([buena]);
    expect(await correr(l.piezas)).toBe("esta");
    expect(l.llamadas()).toBe(1);
    expect(l.esperas).toEqual([]);
  });

  it("si la red se cae, espera y vuelve a leer hasta conseguirlo", async () => {
    const l = lector([mala("red-caida"), mala("red-caida"), buena]);
    expect(await correr(l.piezas)).toBe("esta");
    expect(l.llamadas()).toBe(3);
    expect(l.esperas).toEqual([...ESPERAS_DEL_SELLO_MS]);
  });

  it("una lectura que lanza también se reintenta y no rompe", async () => {
    const l = lector(["lanza", buena]);
    expect(await correr(l.piezas)).toBe("esta");
    expect(l.llamadas()).toBe(2);
  });

  it("una transacción que todavía no se ve se vuelve a pedir", async () => {
    const l = lector([mala("no-encontrada"), buena]);
    expect(await correr(l.piezas)).toBe("esta");
  });

  it("tiene tope de intentos: si nunca contesta, no dice nada", async () => {
    const l = lector([mala("red-caida")]);
    expect(await correr(l.piezas)).toBeNull();
    expect(l.llamadas()).toBe(ESPERAS_DEL_SELLO_MS.length + 1);
  });

  it("tiene tope de tiempo: no sigue esperando pasado el límite", async () => {
    const l = lector([mala("red-caida")]);
    l.piezas.esperar = async (ms) => {
      l.esperas.push(ms);
      l.reloj.ahora += TOPE_DEL_SELLO_MS;
    };
    expect(await correr(l.piezas)).toBeNull();
    expect(l.llamadas()).toBe(2);
  });

  it("lo que la red contradice no se reintenta ni se afirma", async () => {
    for (const error of ["fallida", "no-es-un-sello", "contrato-ajeno", "fuera-de-ventana"] as const) {
      const l = lector([mala(error), buena]);
      expect(await correr(l.piezas), error).toBeNull();
      expect(l.llamadas(), error).toBe(1);
    }
  });

  it("un no-esta también sale tras reintentar", async () => {
    const otra = [OTRA, TERCERA];
    const l = lector([mala("red-caida"), { ok: true, sello: sello(otra) }]);
    expect(
      await comprobarConReintento(
        { comprobante: await comprobanteDe(otra), cuenta: CUENTA, red: RED, contrato: CONTRATO, campana: campanaDe(otra) },
        l.piezas,
      ),
    ).toBe("no-esta");
  });
});
