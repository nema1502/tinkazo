import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CosignManager, type CosignRequest, type RampOrder, type RampOrderLeg, type RampOrderLegStep, type RampPendingAction } from "@pollar/core";
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { USDC_MAINNET } from "./pagos";
import { EMISOR_USDC_CIRCLE } from "./rampa-pollar";
import { LISTA_CERRADA, type PasoRevisado, motivoContraElPaso, motivoContraLaCuentaDePaso, motivoContraLaPropuesta, nombreEnLaLista, revisarCuentaDePaso, revisarPaso } from "./rampa-regla";

/**
 * La regla que aprueba los pasos de una carga que mueven dinero, contra transacciones de Polygon armadas acá byte por
 * byte y contra el `verify` del propio kit de Pollar. Cada exigencia tiene un caso que pasa y uno que no. Ante la duda,
 * la regla no aprueba: el dinero queda retenido en la cuenta de paso.
 */

/* ------------------------------------------------------------------ lo que se arma para probar */

const USDC = LISTA_CERRADA.usdcPolygon;
const USDT0 = LISTA_CERRADA.usdt0Polygon;
const ENRUTADOR = LISTA_CERRADA.enrutadorUniswap;
const MENSAJERO = LISTA_CERRADA.mensajeroCircle;
const REENVIADOR = LISTA_CERRADA.reenviadorStellar;

/** Variantes que Pollar podría usar y que no entran sin evidencia. */
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const MENSAJERO_CON_COMISION = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const ENRUTADOR_UNIVERSAL = "0x1095692A6237d83C6a72F3F5eFEdb9A670C49223";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ENRUTADOR_V1 = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const MENSAJERO_V1 = "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE";

const SUB = "sub-org-de-ana";
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTRA_CUENTA = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
/** La cuenta de paso de Ana en Polygon: la que firma. */
const PASO_DE_ANA = "0x1111111111111111111111111111111111111111";
const DE_OTRO = "0x2222222222222222222222222222222222222222";

type Rlp = Uint8Array | Rlp[];
const hexDe = (b: Uint8Array) => Buffer.from(b).toString("hex");
const deHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/i, ""), "hex"));
function prefijo(base: number, n: number): number[] {
  if (n <= 55) return [base + n];
  const l: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) l.unshift(x % 256);
  return [base + 55 + l.length, ...l];
}
function rlp(x: Rlp): Uint8Array {
  if (x instanceof Uint8Array) return x.length === 1 && (x[0] as number) < 0x80 ? x : Uint8Array.from([...prefijo(0x80, x.length), ...x]);
  const cuerpo = x.flatMap((e) => [...rlp(e)]);
  return Uint8Array.from([...prefijo(0xc0, cuerpo.length), ...cuerpo]);
}
const numero = (n: bigint) => (n === 0n ? new Uint8Array() : deHex(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0")));

interface Tx {
  to: string;
  data: string;
  value?: bigint;
  chainId?: bigint;
  accessList?: Rlp[];
}
/** Una transacción EIP-1559 sin firmar, como la que trae un pedido de Polygon. */
const transaccion = (t: Tx) =>
  `0x02${hexDe(rlp([numero(t.chainId ?? 137n), numero(7n), numero(30_000_000_000n), numero(60_000_000_000n), numero(150_000n), deHex(t.to), numero(t.value ?? 0n), deHex(t.data), t.accessList ?? []]))}`;

const palabra = (n: bigint) => n.toString(16).padStart(64, "0");
const palabraDe = (dir: string) => dir.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const permiso = (quien: string, monto: bigint) => `0x095ea7b3${palabraDe(quien)}${palabra(monto)}`;
interface Canje {
  tokenIn?: string;
  tokenOut?: string;
  fee?: bigint;
  recipient?: string;
  amountIn?: bigint;
  min?: bigint;
  limite?: bigint;
}
const canje = (c: Canje = {}) =>
  `0x04e45aaf${palabraDe(c.tokenIn ?? USDT0)}${palabraDe(c.tokenOut ?? USDC)}${palabra(c.fee ?? 100n)}${palabraDe(c.recipient ?? PASO_DE_ANA)}${palabra(c.amountIn ?? 24_900_000n)}${palabra(c.min ?? 24_651_000n)}${palabra(c.limite ?? 0n)}`;
/** Los datos que el reenviador de Circle lee para saber a qué cuenta de Stellar mandar. */
const gancho = (cuenta: string, o: { version?: number; largo?: number; extra?: string } = {}) =>
  `${"00".repeat(24)}${(o.version ?? 0).toString(16).padStart(8, "0")}${(o.largo ?? cuenta.length).toString(16).padStart(8, "0")}${Buffer.from(cuenta + (o.extra ?? ""), "ascii").toString("hex")}`;
interface Envio {
  amount?: bigint;
  dominio?: bigint;
  mintRecipient?: string;
  burnToken?: string;
  caller?: string;
  maxFee?: bigint;
  finality?: bigint;
  hook?: string;
  offset?: bigint;
}
const envio = (e: Envio = {}) => {
  const hook = e.hook ?? gancho(CUENTA);
  const largo = hook.length / 2;
  return `0x779b432d${palabra(e.amount ?? 24_850_000n)}${palabra(e.dominio ?? 27n)}${(e.mintRecipient ?? REENVIADOR).replace(/^0x/, "")}${palabraDe(e.burnToken ?? USDC)}${(e.caller ?? REENVIADOR).replace(/^0x/, "")}${palabra(e.maxFee ?? 248_500n)}${palabra(e.finality ?? 1000n)}${palabra(e.offset ?? 256n)}${palabra(BigInt(largo))}${hook.padEnd(Math.ceil(largo / 32) * 64, "0")}`;
};
const envioSinGancho = () => `0x8e0250ee${palabra(24_850_000n)}${palabra(27n)}${REENVIADOR.replace(/^0x/, "")}${palabraDe(USDC)}${REENVIADOR.replace(/^0x/, "")}${palabra(248_500n)}${palabra(1000n)}`;

function pedido(tx: Tx, p: Partial<CosignRequest> = {}): CosignRequest {
  return {
    id: "cos-1",
    kind: "TX",
    network: "POLYGON",
    status: "PENDING",
    subOrgId: SUB,
    activityId: null,
    fingerprint: null,
    signWith: PASO_DE_ANA,
    unsignedPayload: transaccion(tx),
    payloadHash: "00",
    refreshable: true,
    intent: "sign_and_send",
    operation: "evm_call",
    details: { to: tx.to.toLowerCase(), data: tx.data.toLowerCase(), value: String(tx.value ?? 0n) },
    expiresAt: "2026-11-17T15:00:00.000Z",
    createdAt: "2026-11-16T15:00:00.000Z",
    resolvedAt: null,
    ...p,
  };
}

/* La orden: Bs 300, Stereum entrega USDT0, el canje lo pasa a USDC y el puente lo deja en Stellar. */
const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" } as const;
const USDT0_POLYGON = { kind: "asset", code: "USDT0", identifier: USDT0, chain: "POLYGON" } as const;
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: USDC, chain: "POLYGON" } as const;
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" } as const;
const paso = (kind: RampOrderLegStep["kind"], status: RampOrderLegStep["status"] = "pending"): RampOrderLegStep => ({ kind, status, signs: kind === "approve" || kind === "swap" || kind === "burn", hash: null });
const tramo = (t: Partial<RampOrderLeg> & Pick<RampOrderLeg, "index" | "kind" | "from" | "to">): RampOrderLeg => ({
  status: "PENDING",
  amountInPlanned: "0",
  amountOutPlanned: "0",
  amountInActual: null,
  amountOutActual: null,
  onchainTxHash: null,
  signingMode: "COSIGNED",
  fundsLocation: null,
  failure: null,
  steps: [],
  etaSeconds: null,
  startedAt: null,
  ...t,
});
const FONDOS = { chain: "POLYGON", address: PASO_DE_ANA, asset: "USDT0", amount: "24900000" } as const;
type Espera = "permiso-cambio" | "cambio" | "permiso-envio" | "envio";
function ordenQueEspera(espera: Espera, o: { canjePlaneado?: string; envioPlaneado?: string; bs?: string; fondos?: RampOrderLeg["fundsLocation"]; accion?: RampPendingAction | null } = {}): RampOrder {
  const enCanje = espera === "permiso-cambio" || espera === "cambio";
  const pasosCanje = espera === "permiso-cambio" ? [paso("approve", "awaiting_approval"), paso("swap")] : espera === "cambio" ? [paso("approve", "done"), paso("swap", "awaiting_approval")] : [paso("approve", "done"), paso("swap", "done")];
  const pasosEnvio =
    espera === "permiso-envio" ? [paso("approve", "awaiting_approval"), paso("burn"), paso("attestation"), paso("mint")] : espera === "envio" ? [paso("approve", "done"), paso("burn", "awaiting_approval"), paso("attestation"), paso("mint")] : [paso("approve"), paso("burn"), paso("attestation"), paso("mint")];
  return {
    id: "ord_9f8e7d6c5b4a3210",
    direction: "ONRAMP",
    state: "processing",
    createdAt: "2026-11-16T15:00:00.000Z",
    updatedAt: "2026-11-16T15:05:00.000Z",
    legs: [
      tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT0_POLYGON, amountInPlanned: o.bs ?? "300", amountOutPlanned: "24.9", status: "COMPLETED", amountInActual: "300", amountOutActual: "24.9", signingMode: null }),
      tramo({ index: 1, kind: "SWAP", from: USDT0_POLYGON, to: USDC_POLYGON, amountInPlanned: o.canjePlaneado ?? "24.9", amountOutPlanned: "24.85", status: enCanje ? "AWAITING_ACTION" : "COMPLETED", fundsLocation: enCanje ? (o.fondos === undefined ? FONDOS : o.fondos) : null, steps: pasosCanje }),
      tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: o.envioPlaneado ?? "24.85", amountOutPlanned: "24.85", status: enCanje ? "PENDING" : "AWAITING_ACTION", fundsLocation: enCanje ? null : o.fondos === undefined ? { ...FONDOS, asset: "USDC" } : o.fondos, steps: pasosEnvio }),
    ],
    pendingAction: o.accion === undefined ? { kind: "COSIGN_APPROVAL", actionId: "act-1", legIndex: enCanje ? 1 : 2, cosignRequestId: "cos-1", summary: "Approve" } : o.accion,
    failure: null,
    nextPollAfter: "2026-11-16T15:05:10.000Z",
  };
}

/** Cada paso bueno: el que la orden espera, contra la lista cerrada, por el monto del tramo y hacia la cuenta de Ana. */
const BUENOS: Record<Espera, Tx> = {
  "permiso-cambio": { to: USDT0, data: permiso(ENRUTADOR, 24_900_000n) },
  cambio: { to: ENRUTADOR, data: canje() },
  "permiso-envio": { to: USDC, data: permiso(MENSAJERO, 24_850_000n) },
  envio: { to: MENSAJERO, data: envio() },
};

const revisar = (espera: Espera, tx: Tx, p: Partial<CosignRequest> = {}, o: Parameters<typeof ordenQueEspera>[1] = {}, cuenta = CUENTA, subOrg = SUB) => revisarPaso(pedido(tx, p), ordenQueEspera(espera, o), cuenta, subOrg);
const motivo = (espera: Espera, tx: Tx, p: Partial<CosignRequest> = {}, o: Parameters<typeof ordenQueEspera>[1] = {}, cuenta = CUENTA, subOrg = SUB) => motivoContraElPaso(pedido(tx, p), ordenQueEspera(espera, o), cuenta, subOrg);

/** El `verify` del kit de verdad, con la red principal: arma la propuesta igual que antes de un voto. */
const kit = new CosignManager({
  api: {} as never,
  keyManager: {} as never,
  logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
  networkPassphrase: () => Networks.PUBLIC,
  onRequest: () => undefined,
});

const MOTIVOS = new Set([
  "orden",
  "pedido",
  "cuenta",
  "otro pedido",
  "no pendiente",
  "no es de Polygon",
  "otra organización",
  "tramo",
  "cuenta que firma",
  "transacción",
  "otra llamada",
  "fuera de la lista",
  "monto",
  "permiso de más",
  "canje a otra cuenta",
  "canje sin piso",
  "envío a otro destino",
  "comisión de más",
]);

/* ------------------------------------------------------------------ la lista cerrada */

describe("la lista cerrada", () => {
  it("tiene solo las siete entradas confirmadas, cada una con el enlace de su fuente oficial al lado", () => {
    // Confirmadas el 11 de noviembre de 2026 contra la documentación de Circle, de USDT0 y de Uniswap, y en la cadena.
    expect({ ...LISTA_CERRADA }).toEqual({
      usdcPolygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      usdt0Polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      enrutadorUniswap: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      mensajeroCircle: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      dominioStellar: 27,
      reenviadorStellar: "0x72bd20ff2f8281801bb05b7c29179026933256fabafeb13e94efd8ddbcfcf291",
      emisorUsdcStellar: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });
    const fuente = readFileSync(resolve(process.cwd(), "src/stellar/rampa-regla.ts"), "utf8");
    const lista = fuente.slice(fuente.indexOf("export const LISTA_CERRADA"), fuente.indexOf("});", fuente.indexOf("export const LISTA_CERRADA")));
    const oficiales = /https:\/\/(developers\.circle\.com|docs\.usdt0\.to|developers\.uniswap\.org|www\.circle\.com)\//;
    for (const clave of Object.keys(LISTA_CERRADA)) {
      const linea = lista.indexOf(`  ${clave}:`);
      expect(linea, clave).toBeGreaterThan(0);
      const comentario = lista.slice(lista.lastIndexOf("/**", linea), linea);
      expect(comentario, clave).toMatch(oficiales);
    }
    // Ninguna dirección de Polygon de las variantes en duda aparece en el archivo de la regla.
    for (const d of [USDC_E, MENSAJERO_CON_COMISION, ENRUTADOR_UNIVERSAL, PERMIT2, ENRUTADOR_V1, MENSAJERO_V1]) expect(fuente.toLowerCase()).not.toContain(d.slice(2).toLowerCase());
  });

  it("las direcciones de Polygon son direcciones, y el reenviador de Circle es el contrato de Stellar que dice su guía", () => {
    for (const d of [USDC, USDT0, ENRUTADOR, MENSAJERO]) expect(d).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(REENVIADOR).toBe(`0x${Buffer.from(StrKey.decodeContract("CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T")).toString("hex")}`);
    expect(LISTA_CERRADA.dominioStellar).toBe(27);
  });

  it("el emisor de USDC en Stellar es el mismo que usan los pagos y la ruta de la carga", () => {
    expect(LISTA_CERRADA.emisorUsdcStellar).toBe(USDC_MAINNET.issuer);
    expect(LISTA_CERRADA.emisorUsdcStellar).toBe(EMISOR_USDC_CIRCLE);
  });

  it("nombra lo que está en la lista, sin importar mayúsculas, y nada más", () => {
    expect(nombreEnLaLista(USDC.toLowerCase())).toBe("USDC de Polygon");
    expect(nombreEnLaLista(USDT0)).toBe("USDT0 de Polygon");
    expect(nombreEnLaLista(ENRUTADOR.toUpperCase().replace("0X", "0x"))).toBe("enrutador de Uniswap");
    expect(nombreEnLaLista(MENSAJERO)).toBe("mensajero de Circle");
    expect(nombreEnLaLista(REENVIADOR)).toBe("reenviador de Circle en Stellar");
    for (const d of [USDC_E, MENSAJERO_CON_COMISION, ENRUTADOR_UNIVERSAL, PERMIT2, ENRUTADOR_V1, MENSAJERO_V1, PASO_DE_ANA, "", null, 3]) expect(nombreEnLaLista(d)).toBeNull();
  });
});

/* ------------------------------------------------------------------ los cuatro pasos buenos */

describe("los cuatro pasos de una carga, tal como deberían venir", () => {
  it("pasan la regla, con lo que se aprueba y cuántos dólares digitales", () => {
    expect(revisar("permiso-cambio", BUENOS["permiso-cambio"])).toMatchObject({ motivo: null, que: "permiso-cambio", dolares: 24.9 });
    expect(revisar("cambio", BUENOS.cambio)).toMatchObject({ motivo: null, que: "cambio", dolares: 24.9 });
    expect(revisar("permiso-envio", BUENOS["permiso-envio"])).toMatchObject({ motivo: null, que: "permiso-envio", dolares: 24.85 });
    expect(revisar("envio", BUENOS.envio)).toMatchObject({ motivo: null, que: "envio", dolares: 24.85 });
    for (const e of Object.keys(BUENOS) as Espera[]) expect(motivo(e, BUENOS[e]), e).toBeNull();
  });

  it("el verify del kit también los acepta, y su propuesta es exactamente la nuestra", async () => {
    for (const e of Object.keys(BUENOS) as Espera[]) {
      const p = pedido(BUENOS[e]);
      const v = await kit.verify(p);
      expect(v.ok, e).toBe(true);
      expect(motivoContraLaPropuesta(v, p, SUB), e).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ cada exigencia por separado */

describe("el pedido es el que espera la orden, pendiente, de Polygon y de esta sesión", () => {
  it("otro pedido que el que espera la orden no pasa", () => {
    expect(motivo("permiso-cambio", BUENOS["permiso-cambio"], { id: "cos-9" })).toBe("otro pedido");
  });

  it("un pedido ya votado, aprobado, rechazado o vencido no pasa", () => {
    for (const status of ["APPROVED", "REJECTED", "EXPIRED", "FAILED"] as const) expect(motivo("cambio", BUENOS.cambio, { status })).toBe("no pendiente");
    expect(motivo("cambio", BUENOS.cambio, { activityId: "act-turnkey" })).toBe("no pendiente");
  });

  it("un pedido que no es una transacción de Polygon no pasa", () => {
    expect(motivo("cambio", BUENOS.cambio, { kind: "MESSAGE" })).toBe("no es de Polygon");
    expect(motivo("cambio", BUENOS.cambio, { network: "STELLAR" })).toBe("no es de Polygon");
    expect(motivo("cambio", BUENOS.cambio, { network: "SOLANA" })).toBe("no es de Polygon");
  });

  it("un pedido de otra organización, o sin saber la de esta sesión, no pasa", () => {
    expect(motivo("cambio", BUENOS.cambio, { subOrgId: "sub-org-de-beto" })).toBe("otra organización");
    expect(motivo("cambio", BUENOS.cambio, {}, {}, CUENTA, "")).toBe("otra organización");
  });

  it("sin la cuenta de Stellar de la persona, o con una que no es una G, no se aprueba nada", () => {
    for (const c of ["", "MAAAA", CUENTA.toLowerCase(), `${CUENTA}X`]) expect(motivo("permiso-cambio", BUENOS["permiso-cambio"], {}, {}, c), c).toBe("cuenta");
  });

  it("una orden que no espera una aprobación, o que no se lee como una carga, no aprueba nada", () => {
    expect(motivo("cambio", BUENOS.cambio, {}, { accion: { kind: "NONE", actionId: "a", legIndex: 1 } })).toBe("orden");
    expect(motivo("cambio", BUENOS.cambio, {}, { accion: null })).toBe("orden");
    expect(motivoContraElPaso(pedido(BUENOS.cambio), null, CUENTA, SUB)).toBe("orden");
    expect(motivoContraElPaso(pedido(BUENOS.cambio), { ...ordenQueEspera("cambio"), direction: "OFFRAMP" }, CUENTA, SUB)).toBe("orden");
    expect(motivoContraElPaso(null, ordenQueEspera("cambio"), CUENTA, SUB)).toBe("pedido");
  });

  it("un pedido sobre el tramo de Stereum, o sobre un paso que no conocemos, no pasa", () => {
    const sobreStereum = { ...ordenQueEspera("cambio"), pendingAction: { kind: "COSIGN_APPROVAL", actionId: "a", legIndex: 0, cosignRequestId: "cos-1", summary: "x" } } as RampOrder;
    expect(motivoContraElPaso(pedido(BUENOS.cambio), sobreStereum, CUENTA, SUB)).toBe("tramo");
    const o = ordenQueEspera("cambio");
    const sinPaso = { ...o, legs: [o.legs[0], { ...(o.legs[1] as RampOrderLeg), steps: [paso("approve", "done"), paso("swap", "done")] }, o.legs[2]] } as RampOrder;
    expect(motivoContraElPaso(pedido(BUENOS.cambio), sinPaso, CUENTA, SUB)).toBe("tramo");
  });

  it("una cuenta que firma que no es una dirección de Polygon no pasa", () => {
    expect(motivo("cambio", BUENOS.cambio, { signWith: "GCUENTA" })).toBe("cuenta que firma");
  });
});

describe("la transacción es la que dice el pedido, en la red principal de Polygon", () => {
  it("de otra cadena, que manda POL, con lista de acceso o ilegible, no pasa", () => {
    expect(motivo("cambio", { ...BUENOS.cambio, chainId: 80002n })).toBe("transacción");
    expect(motivo("cambio", { ...BUENOS.cambio, chainId: 1n })).toBe("transacción");
    expect(motivo("cambio", { ...BUENOS.cambio, value: 1n })).toBe("transacción");
    expect(motivo("cambio", { ...BUENOS.cambio, accessList: [[deHex(ENRUTADOR), []]] })).toBe("transacción");
    for (const unsignedPayload of ["", "0x", "0x01", "zz", `${transaccion(BUENOS.cambio)}00`, transaccion(BUENOS.cambio).replace("0x02", "0x01")]) {
      expect(motivo("cambio", BUENOS.cambio, { unsignedPayload }), unsignedPayload.slice(0, 12)).toBe("transacción");
    }
  });

  it("si lo que dice el pedido no es la transacción que trae, no pasa", () => {
    expect(motivo("cambio", BUENOS.cambio, { details: { to: MENSAJERO.toLowerCase(), data: canje().toLowerCase(), value: "0" } })).toBe("transacción");
    expect(motivo("cambio", BUENOS.cambio, { details: { to: ENRUTADOR.toLowerCase(), data: canje({ recipient: DE_OTRO }), value: "0" } })).toBe("transacción");
    expect(motivo("cambio", BUENOS.cambio, { details: { to: ENRUTADOR.toLowerCase(), data: canje(), value: "1" } })).toBe("transacción");
    expect(motivo("cambio", BUENOS.cambio, { details: {} })).toBe("transacción");
    expect(motivo("cambio", BUENOS.cambio, { details: undefined })).toBe("transacción");
  });

  it("los argumentos mal armados no pasan", () => {
    expect(motivo("permiso-cambio", { to: USDT0, data: `${permiso(ENRUTADOR, 1n)}00` })).toBe("transacción");
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 1n).slice(0, 74) })).toBe("transacción");
    expect(motivo("permiso-cambio", { to: USDT0, data: `0x095ea7b3${"ff".repeat(12)}${ENRUTADOR.slice(2).toLowerCase()}${palabra(1n)}` })).toBe("transacción");
    expect(motivo("cambio", { to: ENRUTADOR, data: `${canje()}${palabra(0n)}` })).toBe("transacción");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ fee: 1n << 24n }) })).toBe("transacción");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ offset: 288n }) })).toBe("transacción");
    expect(motivo("envio", { to: MENSAJERO, data: `${envio()}${palabra(0n)}` })).toBe("transacción");
  });
});

describe("la llamada es la del paso, y nunca una transferencia", () => {
  it("cada paso solo con su llamada", () => {
    expect(motivo("permiso-cambio", BUENOS.cambio)).toBe("otra llamada");
    expect(motivo("cambio", BUENOS["permiso-cambio"])).toBe("otra llamada");
    expect(motivo("permiso-envio", BUENOS.envio)).toBe("otra llamada");
    expect(motivo("envio", BUENOS["permiso-envio"])).toBe("otra llamada");
  });

  it("una transferencia o un envío directo de POL no se aprueban nunca, aunque el kit los reconozca", async () => {
    const transferencia = { to: USDC, data: `0xa9059cbb${palabraDe(DE_OTRO)}${palabra(24_850_000n)}` };
    const directo = { to: DE_OTRO, data: "0x", value: 0n };
    for (const e of Object.keys(BUENOS) as Espera[]) {
      expect(motivo(e, transferencia), e).toBe("otra llamada");
      expect(motivo(e, directo), e).toBe("otra llamada");
    }
    // El kit las acepta como llamadas conocidas: por eso la regla no se apoya solo en él.
    expect((await kit.verify(pedido(transferencia))).ok).toBe(true);
    expect((await kit.verify(pedido(directo))).ok).toBe(true);
  });

  it("el envío a Stellar sin los datos del gancho se quedaría trabado: no pasa", () => {
    expect(motivo("envio", { to: MENSAJERO, data: envioSinGancho() })).toBe("otra llamada");
  });
});

describe("los contratos salen de la lista cerrada", () => {
  it("el permiso del canje: USDT0, para el enrutador de Uniswap", () => {
    expect(motivo("permiso-cambio", { to: USDC_E, data: permiso(ENRUTADOR, 24_900_000n) })).toBe("fuera de la lista");
    expect(motivo("permiso-cambio", { to: DE_OTRO, data: permiso(ENRUTADOR, 24_900_000n) })).toBe("fuera de la lista");
    for (const quien of [PERMIT2, ENRUTADOR_UNIVERSAL, ENRUTADOR_V1, MENSAJERO, DE_OTRO, PASO_DE_ANA]) expect(motivo("permiso-cambio", { to: USDT0, data: permiso(quien, 24_900_000n) }), quien).toBe("fuera de la lista");
  });

  it("el canje: en el enrutador de Uniswap, de USDT0 a USDC", () => {
    for (const to of [ENRUTADOR_UNIVERSAL, ENRUTADOR_V1, DE_OTRO]) expect(motivo("cambio", { to, data: canje() }), to).toBe("fuera de la lista");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ tokenIn: USDC_E }) })).toBe("fuera de la lista");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ tokenIn: USDC }) })).toBe("fuera de la lista");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ tokenOut: USDT0 }) })).toBe("fuera de la lista");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ tokenOut: USDC_E }) })).toBe("fuera de la lista");
  });

  it("el permiso del envío: USDC, para el mensajero de Circle", () => {
    expect(motivo("permiso-envio", { to: USDT0, data: permiso(MENSAJERO, 24_850_000n) })).toBe("fuera de la lista");
    for (const quien of [MENSAJERO_CON_COMISION, MENSAJERO_V1, ENRUTADOR, DE_OTRO]) expect(motivo("permiso-envio", { to: USDC, data: permiso(quien, 24_850_000n) }), quien).toBe("fuera de la lista");
  });

  it("el envío: en el mensajero de Circle, quemando USDC", () => {
    for (const to of [MENSAJERO_CON_COMISION, MENSAJERO_V1, DE_OTRO]) expect(motivo("envio", { to, data: envio() }), to).toBe("fuera de la lista");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ burnToken: USDT0 }) })).toBe("fuera de la lista");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ burnToken: USDC_E }) })).toBe("fuera de la lista");
  });
});

describe("el permiso no pasa lo que lleva el tramo", () => {
  it("un permiso sin límite, o por más que el tramo, no pasa", () => {
    const sinLimite = (1n << 256n) - 1n;
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, sinLimite) })).toBe("permiso de más");
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 24_900_001n) })).toBe("permiso de más");
    expect(motivo("permiso-envio", { to: USDC, data: permiso(MENSAJERO, 24_850_001n) })).toBe("permiso de más");
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 24_000_000n) })).toBeNull();
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 0n) })).toBe("monto");
  });

  it("el monto del tramo se cuenta con 6 decimales, y lo que pasa del sexto no suma", () => {
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 24_900_000n) }, {}, { canjePlaneado: "24.9000009" })).toBeNull();
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 24_900_001n) }, {}, { canjePlaneado: "24.9000009" })).toBe("permiso de más");
    for (const canjePlaneado of ["", "veinte", "-5", "1e3", " 24.9"]) expect(motivo("permiso-cambio", BUENOS["permiso-cambio"], {}, { canjePlaneado }), canjePlaneado).not.toBeNull();
  });

  it("aunque el tramo viniera en otra unidad, nunca más dólares que los bolivianos que se pagaron", () => {
    // Un tramo con el monto en unidades de 6 decimales daría un tope de millones: el de los bolivianos lo frena.
    const o = { canjePlaneado: "24900000" };
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 300_000_001n) }, {}, o)).toBe("permiso de más");
    expect(motivo("permiso-cambio", { to: USDT0, data: permiso(ENRUTADOR, 24_900_000n) }, {}, o)).toBeNull();
  });
});

describe("el canje le llega a la cuenta de paso que firma, con un piso", () => {
  it("con otro receptor no pasa", () => {
    for (const recipient of [DE_OTRO, ENRUTADOR, "0x0000000000000000000000000000000000000000"]) expect(motivo("cambio", { to: ENRUTADOR, data: canje({ recipient }) }), recipient).toBe("canje a otra cuenta");
  });

  it("con piso cero o del 98 % no pasa; con el 99 % justo, sí", () => {
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ min: 0n }) })).toBe("canje sin piso");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ min: 24_402_000n }) })).toBe("canje sin piso");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ min: 24_650_999n }) })).toBe("canje sin piso");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ min: 24_651_000n }) })).toBeNull();
  });

  it("el canje tampoco usa más que el tramo", () => {
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ amountIn: 24_900_001n, min: 24_900_001n }) })).toBe("monto");
    expect(motivo("cambio", { to: ENRUTADOR, data: canje({ amountIn: 0n, min: 0n }) })).toBe("monto");
  });
});

describe("el envío a Stellar va al reenviador de Circle, para la cuenta de la persona", () => {
  it("con otro dominio no pasa", () => {
    for (const dominio of [0n, 7n, 5n, 28n]) expect(motivo("envio", { to: MENSAJERO, data: envio({ dominio }) }), String(dominio)).toBe("envío a otro destino");
  });

  it("con quien recibe o quien termina el envío distintos del reenviador no pasa: el dinero quedaría trabado", () => {
    const cuentaComoBytes = `0x${Buffer.from(StrKey.decodeEd25519PublicKey(CUENTA)).toString("hex")}`;
    for (const otro of [cuentaComoBytes, palabraDe(PASO_DE_ANA), `0x${"00".repeat(32)}`]) {
      expect(motivo("envio", { to: MENSAJERO, data: envio({ mintRecipient: otro }) })).toBe("envío a otro destino");
      expect(motivo("envio", { to: MENSAJERO, data: envio({ caller: otro }) })).toBe("envío a otro destino");
    }
  });

  it("el gancho lleva la cuenta de la persona, y nada más", () => {
    expect(motivo("envio", { to: MENSAJERO, data: envio({ hook: gancho(OTRA_CUENTA) }) })).toBe("envío a otro destino");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ hook: gancho(CUENTA, { version: 1 }) }) })).toBe("envío a otro destino");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ hook: gancho(CUENTA, { extra: "x" }) }) })).toBe("envío a otro destino");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ hook: gancho(CUENTA, { largo: 55 }) }) })).toBe("envío a otro destino");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ hook: gancho(CUENTA).slice(0, 60) }) })).toBe("envío a otro destino");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ hook: "" }) })).toBe("envío a otro destino");
    // La misma carga con la cuenta de otra persona como dueña tampoco.
    expect(motivo("envio", BUENOS.envio, {}, {}, OTRA_CUENTA)).toBe("envío a otro destino");
  });

  it("con una comisión del 2 % no pasa; con el 1 % justo, sí", () => {
    expect(motivo("envio", { to: MENSAJERO, data: envio({ maxFee: 497_000n }) })).toBe("comisión de más");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ maxFee: 248_501n }) })).toBe("comisión de más");
    expect(motivo("envio", { to: MENSAJERO, data: envio({ maxFee: 248_500n }) })).toBeNull();
    expect(motivo("envio", { to: MENSAJERO, data: envio({ maxFee: 0n }) })).toBeNull();
  });

  it("el envío tampoco manda más que el tramo", () => {
    expect(motivo("envio", { to: MENSAJERO, data: envio({ amount: 24_850_001n, maxFee: 0n }) })).toBe("monto");
  });
});

describe("los testigos anotan y no frenan", () => {
  const testigos = (r: PasoRevisado) => Object.fromEntries(r.testigos.map((t) => [t.que, t.valor]));

  it("la comisión del canje, el límite de precio y la rapidez del puente se anotan, y el paso pasa igual", () => {
    const r = revisar("cambio", { to: ENRUTADOR, data: canje({ fee: 3000n, limite: 5n }) });
    expect(r.motivo).toBeNull();
    expect(testigos(r)).toMatchObject({ "comisión del canje": "3000", "límite de precio": "con límite" });
    expect(testigos(revisar("cambio", BUENOS.cambio))).toMatchObject({ "comisión del canje": "100", "límite de precio": "ninguno" });
    const e = revisar("envio", { to: MENSAJERO, data: envio({ finality: 2000n }) });
    expect(e.motivo).toBeNull();
    expect(testigos(e)).toMatchObject({ "rapidez del puente": "2000", "comisión del puente": "1 %" });
  });

  it("si la cuenta que firma es la de los fondos del tramo se anota, sin la dirección", () => {
    expect(testigos(revisar("cambio", BUENOS.cambio))).toMatchObject({ "cuenta que firma y fondos": "coinciden", intención: "sign_and_send" });
    expect(testigos(revisar("cambio", BUENOS.cambio, {}, { fondos: { ...FONDOS, address: DE_OTRO } }))).toMatchObject({ "cuenta que firma y fondos": "no coinciden" });
    expect(revisar("cambio", BUENOS.cambio, {}, { fondos: { ...FONDOS, address: DE_OTRO } }).motivo).toBeNull();
    expect(testigos(revisar("cambio", BUENOS.cambio, {}, { fondos: null }))).toMatchObject({ "cuenta que firma y fondos": "sin dato" });
  });

  it("ni los testigos ni los motivos llevan las cuentas de la persona", () => {
    const casos: PasoRevisado[] = [
      ...(Object.keys(BUENOS) as Espera[]).map((e) => revisar(e, BUENOS[e])),
      revisar("cambio", { to: ENRUTADOR, data: canje({ recipient: DE_OTRO }) }),
      revisar("envio", { to: MENSAJERO, data: envio({ hook: gancho(OTRA_CUENTA) }) }),
      revisar("permiso-cambio", { to: DE_OTRO, data: permiso(DE_OTRO, 1n) }),
    ];
    for (const r of casos) {
      const todo = JSON.stringify(r).toLowerCase();
      for (const secreto of [CUENTA, OTRA_CUENTA, PASO_DE_ANA, DE_OTRO]) expect(todo).not.toContain(secreto.toLowerCase());
      if (r.motivo !== null) expect(MOTIVOS.has(r.motivo), r.motivo).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ la propuesta que se estampa */

describe("lo que se estampa es la transacción revisada, para esta cuenta de paso y esta organización", () => {
  async function propuesta() {
    const p = pedido(BUENOS.cambio);
    const v = await kit.verify(p);
    if (!v.ok) throw new Error(v.reason);
    return { p, v };
  }
  const cambiada = (v: unknown, f: (c: { ok: boolean; localHash: string; proposal: { path: string; body: Record<string, unknown> & { parameters: Record<string, unknown> } } }) => void) => {
    const c = structuredClone(v) as Parameters<typeof f>[0];
    f(c);
    return c;
  };

  it("la que arma el kit pasa", async () => {
    const { p, v } = await propuesta();
    expect(motivoContraLaPropuesta(v, p, SUB)).toBeNull();
  });

  it("cualquier otra cosa no", async () => {
    const { p, v } = await propuesta();
    const malas = [
      cambiada(v, (c) => void (c.ok = false)),
      cambiada(v, (c) => void (c.proposal.path = "/public/v1/submit/sign_raw_payload")),
      cambiada(v, (c) => void (c.proposal.body.type = "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2")),
      cambiada(v, (c) => void (c.proposal.body.organizationId = "sub-org-de-beto")),
      cambiada(v, (c) => void (c.proposal.body.otro = 1)),
      cambiada(v, (c) => void (c.proposal.body.timestampMs = "ahora")),
      cambiada(v, (c) => void (c.proposal.body.parameters.signWith = DE_OTRO)),
      cambiada(v, (c) => void (c.proposal.body.parameters.unsignedTransaction = transaccion(BUENOS["permiso-cambio"]).slice(2))),
      cambiada(v, (c) => void (c.proposal.body.parameters.type = "TRANSACTION_TYPE_SOLANA")),
      cambiada(v, (c) => void (c.proposal.body.parameters.extra = "x")),
      cambiada(v, (c) => void (c.localHash = "00")),
    ];
    for (const m of malas) expect(motivoContraLaPropuesta(m, p, SUB), JSON.stringify(m).slice(0, 120)).not.toBeNull();
    expect(motivoContraLaPropuesta(v, p, "sub-org-de-beto")).not.toBeNull();
    expect(motivoContraLaPropuesta(v, { ...p, subOrgId: "sub-org-de-beto" }, SUB)).not.toBeNull();
    for (const x of [null, {}, { ok: true }, { ok: true, proposal: null }]) expect(motivoContraLaPropuesta(x, p, SUB)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ la cuenta de paso */

describe("crear la cuenta de paso: no mueve dinero, y se aprueba solo la de esta sesión", () => {
  const DERIVACION = { walletId: "wal-ana", accounts: [{ curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" }] };
  const pedidoDeCuenta = (p: Partial<CosignRequest> = {}): CosignRequest => ({ ...pedido(BUENOS.cambio), kind: "ACCOUNT", intent: "add_accounts", unsignedPayload: JSON.stringify(DERIVACION), details: {}, ...p });

  it("la que arma el kit pasa, y se anota qué pidió", async () => {
    const p = pedidoDeCuenta();
    const v = await kit.verify(p);
    expect(v.ok).toBe(true);
    expect(motivoContraLaCuentaDePaso(p, v, SUB)).toBeNull();
    const r = revisarCuentaDePaso(p, v, SUB);
    expect(Object.fromEntries(r.testigos.map((t) => [t.que, t.valor]))).toEqual({ intención: "add_accounts", red: "POLYGON", formato: "ADDRESS_FORMAT_ETHEREUM" });
  });

  it("otro tipo de pedido, uno ya votado o de otra organización no pasa", async () => {
    const v = await kit.verify(pedidoDeCuenta());
    expect(motivoContraLaCuentaDePaso(pedidoDeCuenta({ kind: "TX" }), v, SUB)).toBe("tipo");
    expect(motivoContraLaCuentaDePaso(pedidoDeCuenta({ status: "APPROVED" }), v, SUB)).toBe("no pendiente");
    expect(motivoContraLaCuentaDePaso(pedidoDeCuenta({ activityId: "act" }), v, SUB)).toBe("no pendiente");
    expect(motivoContraLaCuentaDePaso(pedidoDeCuenta({ subOrgId: "sub-org-de-beto" }), v, SUB)).toBe("otra organización");
    expect(motivoContraLaCuentaDePaso(pedidoDeCuenta(), v, "")).toBe("otra organización");
    expect(motivoContraLaCuentaDePaso(pedidoDeCuenta({ unsignedPayload: "{" }), v, SUB)).toBe("derivación");
    expect(motivoContraLaCuentaDePaso(null, v, SUB)).toBe("pedido");
  });

  it("una propuesta que no es crear esas mismas cuentas en esta organización no pasa", async () => {
    const p = pedidoDeCuenta();
    const v = (await kit.verify(p)) as unknown as { ok: true; proposal: { path: string; body: Record<string, unknown> & { parameters: Record<string, unknown> } } };
    const con = (f: (c: typeof v) => void) => {
      const c = structuredClone(v);
      f(c);
      return c;
    };
    const malas = [
      con((c) => void (c.proposal.path = "/public/v1/submit/sign_transaction")),
      con((c) => void (c.proposal.body.type = "ACTIVITY_TYPE_SIGN_TRANSACTION_V2")),
      con((c) => void (c.proposal.body.organizationId = "sub-org-de-beto")),
      con((c) => void (c.proposal.body.parameters.walletId = "wal-beto")),
      con((c) => void ((c.proposal.body.parameters.accounts as unknown[]).push({ ...DERIVACION.accounts[0], path: "m/44'/60'/0'/0/1" }))),
      con((c) => void (c.proposal.body.otro = 1)),
      con((c) => void (c.ok = false as true)),
    ];
    for (const m of malas) expect(motivoContraLaCuentaDePaso(p, m, SUB), JSON.stringify(m).slice(0, 120)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ el kit que la regla da por sabido */

describe("el kit de Pollar que la regla da por sabido", () => {
  const QUE_RELEER =
    "Cambió @pollar/core. Antes de subirlo, releer en node_modules/@pollar/core/dist/index.mjs KNOWN_SELECTORS, " +
    "recognizeEvmCall, checkEvmRequest, polygonChainIdFor y verify (las ramas ACCOUNT y POLYGON), y comparar con rampa-regla.ts.";
  const kitTexto = readFileSync(resolve(process.cwd(), "node_modules/@pollar/core/dist/index.mjs"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "node_modules/@pollar/core/package.json"), "utf8")) as { version: string };

  it("es la versión 0.12.0", () => {
    expect(pkg.version, QUE_RELEER).toBe("0.12.0");
  });

  it("conoce las cinco llamadas de siempre, con sus nombres", () => {
    for (const [selector, nombre] of [
      ["0xa9059cbb", "erc20_transfer"],
      ["0x095ea7b3", "erc20_approve"],
      ["0x04e45aaf", "swap_exact_input_single"],
      ["0x8e0250ee", "cctp_deposit_for_burn"],
      ["0x779b432d", "cctp_deposit_for_burn_with_hook"],
    ]) {
      expect(kitTexto, `${selector}: ${QUE_RELEER}`).toMatch(new RegExp(`"${selector}": \\{ kind: "${nombre}", minArgsWords: \\d+ \\}`));
    }
    const conocidas = /var KNOWN_SELECTORS = \{([\s\S]*?)\n\};/.exec(kitTexto)?.[1] ?? "";
    expect(conocidas.match(/"0x[0-9a-f]{8}"/g), QUE_RELEER).toHaveLength(5);
  });

  it("compara la transacción con lo que dice el pedido, y la cadena es 137 en la red principal", () => {
    expect(kitTexto, QUE_RELEER).toContain("if (tx.to !== to || tx.data !== data || tx.value !== value) {");
    expect(kitTexto, QUE_RELEER).toContain('return networkPassphrase.startsWith("Public Global Stellar Network") ? 137n : 80002n;');
  });

  it("la propuesta de Polygon y la de la cuenta de paso tienen la forma que la regla exige", () => {
    expect(kitTexto, QUE_RELEER).toMatch(/organizationId: request\.subOrgId,\s+parameters\s+\}\);/);
    expect(kitTexto, QUE_RELEER).toMatch(
      /request\.network === "POLYGON"[\s\S]{0,400}const localHash = request\.unsignedPayload\.replace\(\/\^0x\/i, ""\)\.toLowerCase\(\);[\s\S]{0,200}path: "\/public\/v1\/submit\/sign_transaction",\s+body: signed\("ACTIVITY_TYPE_SIGN_TRANSACTION_V2", \{\s+signWith: request\.signWith,\s+unsignedTransaction: localHash,\s+type: "TRANSACTION_TYPE_ETHEREUM"\s+\}\)/,
    );
    expect(kitTexto, QUE_RELEER).toMatch(/path: "\/public\/v1\/submit\/create_wallet_accounts",\s+body: signed\("ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS", derivation\)/);
    expect(kitTexto, QUE_RELEER).toContain('var ACCOUNT_FIELDS = ["curve", "pathFormat", "path", "addressFormat"];');
  });
});
