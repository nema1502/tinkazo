import { xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fuentesDeVerdad, reiniciarElServicio, sortearPorElServicio } from "./sorteo-del-servicio";

/**
 * El cableado real de las fuentes del sorteo por el servicio (`fuentesDeVerdad`): lo que se le pregunta a la red, lo que se
 * lee del contrato y cómo se entiende el valor que devolvió la transacción. Solo el RPC y el servicio son de mentira:
 * el SDK de Stellar, `leerConsulta`, `valorNativo` y `readDraw` son los de verdad, con valores armados como los arma la red.
 */

const HASH = "a1".repeat(32);
const AZAR = new Uint8Array(32).fill(0xab);
const AZAR_HEX = "ab".repeat(32);
const FIRMA = new Uint8Array(96).fill(5);
const FIRMA_HEX = "05".repeat(96);

const h = vi.hoisted(() => ({ getTransaction: vi.fn(), getDraw: vi.fn(), url: "https://pm.example" }));
vi.mock("../stellar/contract", async (orig) => {
  const real = await orig<typeof import("../stellar/contract")>();
  return { ...real, getClient: async () => ({ get_draw: (...a: unknown[]) => h.getDraw(...a) }), server: { getTransaction: (...a: unknown[]) => h.getTransaction(...a) } };
});
vi.mock("../stellar/patrocinio-config", async (orig) => ({ ...(await orig<typeof import("../stellar/patrocinio-config")>()), configDelPortero: () => ({ url: h.url, porDefecto: false }) }));

/** Lo que devuelve el contrato al sortear: un mapa con los puestos y el número al azar, como lo trae `getTransaction`. */
function dibujo(ganadores: number[], azar: Uint8Array = AZAR): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("randomness"), val: xdr.ScVal.scvBytes(Buffer.from(azar)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("winners"), val: xdr.ScVal.scvVec(ganadores.map((g) => xdr.ScVal.scvU32(g))) }),
  ]);
}

const responder = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  reiniciarElServicio();
  h.getTransaction.mockReset();
  h.getDraw.mockReset();
  h.url = "https://pm.example";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("consultar", () => {
  it("pregunta por el hash al RPC y devuelve el estado, la hora de cierre y el valor", async () => {
    const valor = dibujo([4, 11, 3]);
    h.getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: "1800000100", returnValue: valor });
    const c = await fuentesDeVerdad().consultar(HASH);
    expect(h.getTransaction).toHaveBeenCalledWith(HASH);
    expect(c).toEqual({ status: "SUCCESS", cierre: 1_800_000_100, valor });
  });

  it("una transacción que la red no conoce vuelve sin valor", async () => {
    h.getTransaction.mockResolvedValue({ status: "NOT_FOUND", latestLedgerCloseTime: 1_800_000_050 });
    expect(await fuentesDeVerdad().consultar(HASH)).toEqual({ status: "NOT_FOUND", cierre: 1_800_000_050 });
  });
});

describe("valorDe", () => {
  it("entiende el valor que devuelve el contrato: los puestos como números y el número al azar en hexadecimal", async () => {
    expect(await fuentesDeVerdad().valorDe(dibujo([4, 11, 3]))).toEqual({ winners: [4, 11, 3], randomness: AZAR_HEX });
  });

  it("un valor que no tiene la forma de un sorteo se entiende como nada, y no se inventa un resultado", async () => {
    expect(await fuentesDeVerdad().valorDe(xdr.ScVal.scvVoid())).toBeNull();
    expect(await fuentesDeVerdad().valorDe(xdr.ScVal.scvU32(7))).toBeNull();
    const sinAzar = xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("winners"), val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(1)]) })]);
    expect(await fuentesDeVerdad().valorDe(sinAzar)).toBeNull();
  });

  it("sin valor, lanza: quien llama lo trata como un valor que no se entiende", async () => {
    await expect(fuentesDeVerdad().valorDe(undefined)).rejects.toThrow("tx-FAILED");
  });
});

describe("leer", () => {
  it("lee el sorteo del contrato con su número", async () => {
    h.getDraw.mockResolvedValue({ result: { winners: [4, 11, 3], randomness: AZAR } });
    expect(await fuentesDeVerdad().leer(7n)).toEqual({ winners: [4, 11, 3], randomness: AZAR_HEX });
    expect(h.getDraw).toHaveBeenCalledWith({ raffle_id: 7n });
  });

  it("un sorteo que el contrato todavía no tiene es nada", async () => {
    h.getDraw.mockResolvedValue({ result: undefined });
    expect(await fuentesDeVerdad().leer(7n)).toBeNull();
  });
});

describe("pedir", () => {
  it("manda al servicio el número del sorteo y la firma en hexadecimal, a la dirección configurada", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => responder(200, { hash: HASH, status: "PENDING" }));
    vi.stubGlobal("fetch", f);
    const r = await fuentesDeVerdad().pedir(7n, FIRMA, new AbortController().signal);
    expect(r).toEqual({ accion: "mandado", hash: HASH, pendiente: true });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pm.example/v1/sorteo");
    expect(JSON.parse(String(init.body))).toEqual({ sorteo: "7", firma: FIRMA_HEX });
  });
});

describe("la máquina con las fuentes de verdad", () => {
  it("el servicio manda, la red confirma y el resultado sale de leer el contrato, con el enlace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responder(200, { hash: HASH, status: "PENDING", winners: [9, 9, 9], randomness: "ff" })));
    h.getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)), returnValue: dibujo([4, 11, 3]) });
    h.getDraw.mockResolvedValue({ result: { winners: [4, 11, 3], randomness: AZAR } });
    const pasos: string[] = [];
    const r = await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA, alPaso: (s) => void pasos.push(s) });
    expect(r).toEqual({ estado: "listo", valor: { winners: [4, 11, 3], randomness: AZAR_HEX, txHash: HASH }, yaEstaba: false });
    expect(pasos).toEqual(["sending", "sending", "confirmed"]);
  });

  it("lo que diga el cuerpo del servicio no es el resultado: si el contrato dice otra cosa, vale el contrato y sin enlace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responder(200, { hash: HASH, status: "PENDING" })));
    h.getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)), returnValue: dibujo([1, 2, 3]) });
    h.getDraw.mockResolvedValue({ result: { winners: [4, 11, 3], randomness: AZAR } });
    const r = await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA });
    expect(r).toEqual({ estado: "listo", valor: { winners: [4, 11, 3], randomness: AZAR_HEX }, yaEstaba: true });
  });
});
