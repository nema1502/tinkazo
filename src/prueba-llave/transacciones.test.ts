import { Account, Address, Keypair, MuxedAccount, Networks, SorobanDataBuilder, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entradaDe, entradaDeTransferencia, hex } from "./ayuda-de-pruebas";
import { RED_DE_PRUEBA } from "./red";
import {
  aOperacion,
  armarConOperacion,
  armarCreacion,
  armarLectura,
  armarSorteo,
  conEntradasFirmadas,
  credencialDe,
  entradasPorFirmar,
  hashDeTransaccion,
  maxTimeDe,
  mismaAutorizacion,
  mismaOperacion,
  operacionDeSello,
  operacionDeTransferencia,
  raizDeLaEntrada,
  recursoDeclarado,
  VIDA_DEL_SOBRE_S,
} from "./transacciones";

const origen = Keypair.random().publicKey();
const organizador = RED_DE_PRUEBA.contrato;

const huella = new Uint8Array(32).fill(7);
const hexDe = hex;
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
    expect(hexDe(nativos[1] as Uint8Array)).toBe(hexDe(huella));
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

describe("lo que se sabe de una transacción antes de mandarla", () => {
  it("el hash son 64 hexadecimales y no cambia", () => {
    const tx = armarLectura({ origen, secuencia: "5", id: 3n });
    expect(hashDeTransaccion(tx)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeTransaccion(tx)).toBe(hashDeTransaccion(tx));
  });

  it("el maxTime es el de su vida de 30 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    const tx = armarLectura({ origen, secuencia: "5", id: 3n });
    expect(maxTimeDe(tx)).toBe(Math.floor(new Date("2026-11-25T12:00:00Z").getTime() / 1000) + VIDA_DEL_SOBRE_S);
  });
});

describe("la transferencia de monedas de prueba", () => {
  const cuenta = RED_DE_PRUEBA.verificador;
  const g = Keypair.random().publicKey();
  const m = new MuxedAccount(new Account(g, "0"), "1234567890").accountId();
  const monto = 100_000_000n;
  const pedida = operacionDeTransferencia({ desde: cuenta, hacia: m, monto });

  it("llama a transfer del contrato de las monedas con origen, destino y monto en ese orden, y el destino puede ser G, M o C", () => {
    for (const hacia of [g, m, RED_DE_PRUEBA.contrato]) {
      const o = operacionDeTransferencia({ desde: cuenta, hacia, monto });
      expect(o.contract).toBe(RED_DE_PRUEBA.activo);
      expect(o.function).toBe("transfer");
      expect(o.args).toHaveLength(3);
      expect(Address.fromScVal(o.args[0]!).toString()).toBe(cuenta);
      expect(Address.fromScVal(o.args[1]!).toString()).toBe(hacia);
      expect(scValToNative(o.args[2]!)).toBe(monto);
    }
  });

  it("la credencial de una entrada es de origen, de una dirección, o otra si no se entiende", () => {
    expect(credencialDe(entradaDeTransferencia(cuenta, pedida, "origen"))).toEqual({ tipo: "origen" });
    expect(credencialDe(entradaDeTransferencia(cuenta, pedida, "direccion"))).toEqual({ tipo: "direccion", direccion: cuenta });
    expect(credencialDe("esto no es un xdr")).toEqual({ tipo: "otra" });
  });

  it("la raíz es exacta cuando la entrada trae la misma llamada, argumento por argumento", () => {
    expect(raizDeLaEntrada(entradaDeTransferencia(cuenta, pedida, "direccion"), pedida)).toBe("exacta");
  });

  it("la raíz es normalizada cuando el destino pedido era una M y la entrada trae la G de abajo", () => {
    const sinNota = operacionDeTransferencia({ desde: cuenta, hacia: g, monto });
    expect(raizDeLaEntrada(entradaDeTransferencia(cuenta, sinNota, "direccion"), pedida)).toBe("normalizada");
  });

  it("la raíz es otra con otro destino, otro monto, otro contrato, otra función, una subllamada o algo ilegible", () => {
    const otraG = Keypair.random().publicKey();
    const casos: Array<ReturnType<typeof operacionDeTransferencia>> = [
      operacionDeTransferencia({ desde: cuenta, hacia: otraG, monto }),
      operacionDeTransferencia({ desde: cuenta, hacia: m, monto: monto + 1n }),
      operacionDeTransferencia({ desde: RED_DE_PRUEBA.contrato, hacia: m, monto }),
      { ...pedida, contract: RED_DE_PRUEBA.contrato },
      { ...pedida, function: "transfer_from" },
      { ...pedida, args: pedida.args.slice(0, 2) },
    ];
    for (const c of casos) expect(raizDeLaEntrada(entradaDeTransferencia(cuenta, c, "direccion"), pedida)).toBe("otra");
    expect(raizDeLaEntrada(entradaDeTransferencia(cuenta, pedida, "direccion", 1), pedida)).toBe("otra");
    expect(raizDeLaEntrada("esto no es un xdr", pedida)).toBe("otra");
    // Una M de otra cuenta no es la G de abajo del destino pedido.
    const deOtra = operacionDeTransferencia({ desde: cuenta, hacia: otraG, monto });
    expect(raizDeLaEntrada(entradaDeTransferencia(cuenta, deOtra, "direccion"), pedida)).toBe("otra");
  });

  it("la transacción armada es la operación pedida y no otra", () => {
    const tx = armarConOperacion({ origen, secuencia: "100", operacion: pedida });
    expect(mismaOperacion(tx, pedida)).toBe(true);
    expect(mismaOperacion(tx, { ...pedida, function: "balance" })).toBe(false);
    expect(mismaOperacion(tx, operacionDeTransferencia({ desde: cuenta, hacia: g, monto }))).toBe(false);
    expect(mismaOperacion("esto no es un xdr", pedida)).toBe(false);
  });

  it("la comisión por recursos declarada sale de los datos de Soroban, y sin ellos es cero", () => {
    const sin = armarConOperacion({ origen, secuencia: "100", operacion: pedida });
    expect(recursoDeclarado(sin)).toBe(0);
    expect(recursoDeclarado("esto no es un xdr")).toBe(0);
    const con = new TransactionBuilder(new Account(origen, "100"), { fee: "100", networkPassphrase: RED_DE_PRUEBA.passphrase })
      .addOperation(aOperacion(pedida))
      .setTimeout(30)
      .setSorobanData(new SorobanDataBuilder().setResourceFee(1234).build())
      .build()
      .toXDR();
    expect(recursoDeclarado(con)).toBe(1234);
  });
});
