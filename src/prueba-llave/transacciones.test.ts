import { Keypair, Networks, StrKey, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RED_DE_PRUEBA } from "./red";
import { aOperacion, armarConOperacion, armarCreacion, armarSorteo, conEntradasFirmadas, entradasPorFirmar, mismaAutorizacion, operacionDeSello, VIDA_DEL_SOBRE_S } from "./transacciones";

const origen = Keypair.random().publicKey();
const organizador = RED_DE_PRUEBA.contrato;

const hex = (b: Uint8Array): string => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
const aBase64 = (h: string): string => btoa(String.fromCharCode(...(h.match(/../g) ?? []).map((x) => parseInt(x, 16))));

/**
 * Una entrada de autorización con credenciales de dirección, escrita a mano en XDR: 1 (dirección), la dirección del
 * contrato (1 y sus 32 bytes), el nonce, el vencimiento, la firma vacía, y la raíz que invoca `seal` sin argumentos ni subllamadas.
 */
function entradaDe(contrato: string, vence = 100): string {
  const c = hex(StrKey.decodeContract(contrato));
  const dueño = `00000001${c}`;
  const raiz = `00000000${`00000001${hex(StrKey.decodeContract(RED_DE_PRUEBA.contrato))}`}00000004${hex(new TextEncoder().encode("seal"))}0000000000000000`;
  return aBase64(`00000001${dueño}0000000000000000${vence.toString(16).padStart(8, "0")}00000001${raiz}`);
}

const huella = new Uint8Array(32).fill(7);
const operacion = operacionDeSello({ organizador, huella, cantidad: 3, ganadores: 1, ronda: 4_000_000 });

afterEach(() => {
  vi.useRealTimers();
});

describe("la llamada a seal", () => {
  it("lleva los seis argumentos en el orden y el tipo del contrato", () => {
    expect(operacion.contract).toBe(RED_DE_PRUEBA.contrato);
    expect(operacion.function).toBe("seal");
    expect(operacion.args).toHaveLength(6);
    const nativos = operacion.args.map((a) => scValToNative(a));
    expect(nativos[0]).toBe(organizador);
    expect(hex(nativos[1] as Uint8Array)).toBe(hex(huella));
    expect(nativos[2]).toBe(3);
    expect(nativos[3]).toBe(1);
    expect(nativos[4]).toBe(4_000_000n);
    expect(nativos[5]).toBe("");
  });

  it("la red de la prueba es la de testnet del SDK", () => {
    expect(RED_DE_PRUEBA.passphrase).toBe(Networks.TESTNET);
  });
});

describe("armar con la vida de ahora", () => {
  it("el sobre vence 30 s después del instante en que se arma, y un sobre armado después vence después", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    const antes = armarConOperacion({ origen, secuencia: "100", operacion });
    vi.setSystemTime(new Date("2026-11-25T12:00:50Z"));
    const despues = armarConOperacion({ origen, secuencia: "100", operacion });
    const maxTime = (x: string): number => Number((TransactionBuilder.fromXDR(x, Networks.TESTNET) as Transaction).timeBounds?.maxTime);
    const t0 = Math.floor(new Date("2026-11-25T12:00:00Z").getTime() / 1000);
    expect(maxTime(antes)).toBe(t0 + VIDA_DEL_SOBRE_S);
    expect(maxTime(despues)).toBe(t0 + 50 + VIDA_DEL_SOBRE_S);
  });

  it("la transacción es del origen descartable, con una sola operación y la secuencia siguiente", () => {
    const tx = TransactionBuilder.fromXDR(armarConOperacion({ origen, secuencia: "100", operacion }), Networks.TESTNET) as Transaction;
    expect(tx.source).toBe(origen);
    expect(tx.sequence).toBe("101");
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
    expect(tx.fee).toBe("100");
  });

  it("la inclusión alta se aplica cuando se pide", () => {
    const tx = TransactionBuilder.fromXDR(armarConOperacion({ origen, secuencia: "1", operacion, inclusion: "1000" }), Networks.TESTNET) as Transaction;
    expect(tx.fee).toBe("1000");
  });
});

describe("las entradas de autorización", () => {
  it("las que son de la cuenta del organizador se aceptan", () => {
    const e = entradaDe(organizador);
    expect(entradasPorFirmar([e], organizador)).toEqual([e]);
  });

  it("las de otro dueño se rechazan", () => {
    const otro = RED_DE_PRUEBA.verificador;
    expect(() => entradasPorFirmar([entradaDe(otro)], organizador)).toThrow("entrada-ajena");
    expect(() => entradasPorFirmar([entradaDe(organizador), entradaDe(otro)], organizador)).toThrow("entrada-ajena");
  });

  it("sin entradas, o con algo que no es XDR, se rechaza", () => {
    expect(() => entradasPorFirmar([], organizador)).toThrow("sin-entradas");
    expect(() => entradasPorFirmar(["no es xdr"], organizador)).toThrow();
  });

  it("la operación con las entradas firmadas las lleva, y la guarda comprueba que no cambiaron", () => {
    const firmada = entradaDe(organizador, 555);
    const con = conEntradasFirmadas(operacion, [firmada]);
    expect(con.auth).toHaveLength(1);
    expect(operacion.auth).toBeUndefined();
    const tx = armarConOperacion({ origen, secuencia: "9", operacion: con });
    expect(mismaAutorizacion(tx, [firmada])).toBe(true);
    expect(mismaAutorizacion(tx, [entradaDe(organizador, 556)])).toBe(false);
    expect(mismaAutorizacion(tx, [])).toBe(false);
    expect(mismaAutorizacion(armarConOperacion({ origen, secuencia: "9", operacion }), [firmada])).toBe(false);
    expect(mismaAutorizacion("no es xdr", [firmada])).toBe(false);
  });

  it("aOperacion arma la invocación del SDK", () => {
    expect(aOperacion(operacion)).toBeDefined();
  });
});

describe("la llamada a draw", () => {
  it("lleva el número del sorteo y la firma de 96 bytes, y no pide autorización de nadie", () => {
    const firma = new Uint8Array(96).fill(5);
    const tx = TransactionBuilder.fromXDR(armarSorteo({ origen, secuencia: "20", id: 12n, firma96: firma }), Networks.TESTNET) as Transaction;
    const op = tx.operations[0];
    expect(op?.type).toBe("invokeHostFunction");
    if (op?.type !== "invokeHostFunction") throw new Error("no es una invocación");
    expect(op.auth ?? []).toHaveLength(0);
  });
});

describe("la creación de la cuenta", () => {
  it("con algo que no es XDR no se arma", () => {
    expect(() => armarCreacion({ origen, secuencia: "1", funcB64: "no es xdr", authB64: [] })).toThrow();
  });
});
