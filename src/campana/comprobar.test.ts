/** La comprobación propia del sello: el celular lee la transacción de la red, sin creerle al servidor. */

import { describe, expect, it } from "vitest";
import { listHash } from "../protocol/canonical";
import { encodeProof, type Proof } from "../protocol/proof";
import { bytesToHex, roundAt, roundTime } from "../protocol/quicknet";
import type { LecturaDelHistorial, SelloDelHistorial } from "../stellar/historial";
import { comprobarMiCuenta, type PiezasDeLaComprobacion } from "./comprobar";

const AHORA = Date.UTC(2026, 10, 21, 18);
const RED = "mainnet";
const CONTRATO = `C${"A".repeat(63)}`;
const CUENTA = `G${"A".repeat(55)}`;
const OTRA = `G${"B".repeat(55)}`;
const TERCERA = `G${"C".repeat(55)}`;
const RONDA = 32_254_977;
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
    id: "7",
    signature: "0".repeat(96),
    stx: "2".repeat(64),
    ...extras,
  };
  const fragmento = await encodeProof(prueba);
  return `/verificar.html#${fragmento}`;
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

describe("comprobarMiCuenta: el celular se cree la red, no al servidor", () => {
  it("una transacción que incluye la cuenta dice esta", async () => {
    const enlace = await comprobanteDe([TERCERA, CUENTA, OTRA]);
    expect(
      await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([TERCERA, CUENTA, OTRA])),
    ).toBe("esta");
  });

  it("una transacción sellada con otra lista que no la incluye dice no-esta", async () => {
    const enlace = await comprobanteDe([TERCERA, OTRA]);
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([TERCERA, OTRA]))).toBe("no-esta");
  });

  it("la huella de la transacción que no es la del comprobante todavía no dice nada", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA]);
    expect(
      await comprobarMiCuenta(
        { comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO },
        piezas([CUENTA, OTRA], { listHash: "ab".repeat(32) }),
      ),
    ).toBeNull();
  });

  it("un comprobante que no está en orden canónico no dice nada", async () => {
    const enlace = await comprobanteDe([OTRA, CUENTA]);
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([CUENTA, OTRA]))).toBeNull();
  });

  it("sin transacción leíble no dice nada", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA]);
    expect(
      await comprobarMiCuenta(
        { comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO },
        piezas([CUENTA, OTRA], {}, { ok: false, error: "no-encontrada" }),
      ),
    ).toBeNull();
  });

  it("un comprobante sin el hash del sello no dice nada", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA], { stx: undefined });
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([CUENTA, OTRA]))).toBeNull();
  });

  it("un comprobante que no se puede leer no dice nada y no lanza", async () => {
    expect(
      await comprobarMiCuenta({ comprobante: "/verificar.html#no-es-nada", cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([CUENTA, OTRA])),
    ).toBeNull();
  });

  it("una campaña en otra red no acepta el comprobante de otra", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA]);
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: "testnet", contrato: CONTRATO }, piezas([CUENTA, OTRA]))).toBeNull();
  });

  it("el sello en otro contrato no aplica a esta campaña", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA]);
    expect(
      await comprobarMiCuenta(
        { comprobante: enlace, cuenta: CUENTA, red: RED, contrato: `C${"F".repeat(63)}` },
        piezas([CUENTA, OTRA], { contractId: `C${"Z".repeat(63)}` }),
      ),
    ).toBeNull();
  });

  it("el sello de una ronda que todavía no salió no dice nada", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA]);
    const rondaFutura = roundAt(AHORA / 1000) + 2;
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([CUENTA, OTRA], { round: rondaFutura }))).toBeNull();
  });

  it("la ronda del sello se mira con la hora de la campaña, no con la del reloj", async () => {
    const enlace = await comprobanteDe([CUENTA, OTRA]);
    const rondaQueYaSalió = roundAt(AHORA / 1000) - 5_000;
    expect(roundTime(rondaQueYaSalió) * 1000).toBeLessThanOrEqual(AHORA);
    expect(
      await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([CUENTA, OTRA], { round: rondaQueYaSalió })),
    ).toBe("esta");
  });

  it("una lista con algo que no sea una cuenta no dice nada", async () => {
    const enlace = await comprobanteDe(["Ana P.", OTRA]);
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas(["Ana P.", OTRA]))).toBeNull();
  });

  it("una lista de una sola persona también se comprueba", async () => {
    const enlace = await comprobanteDe([OTRA]);
    expect(await comprobarMiCuenta({ comprobante: enlace, cuenta: CUENTA, red: RED, contrato: CONTRATO }, piezas([OTRA]))).toBe("no-esta");
  });
});
