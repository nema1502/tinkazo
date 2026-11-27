import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { RespuestaCruda } from "./cobro";
import { notaDelEnvio, transferenciaDelEvento } from "./evento";
import { RED_DE_PRUEBA } from "./red";

const activo = RED_DE_PRUEBA.activo;
const desde = RED_DE_PRUEBA.verificador;
const hacia = Keypair.random().publicKey();

/** Un evento de contrato en base64, con los temas y el dato dados. */
function evento(contrato: string, temas: xdr.ScVal[], dato: xdr.ScVal): string {
  return new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: new xdr.ContractId(StrKey.decodeContract(contrato)),
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics: temas, data: dato })),
  }).toXDR("base64");
}

const temasDeTransfer = (): xdr.ScVal[] => [nativeToScVal("transfer", { type: "symbol" }), new Address(desde).toScVal(), new Address(hacia).toScVal(), nativeToScVal("native", { type: "string" })];
const conNota = (monto: bigint, nota: bigint): xdr.ScVal => nativeToScVal({ amount: monto, to_muxed_id: nota }, { type: { amount: ["symbol", "i128"], to_muxed_id: ["symbol", "u64"] } });
const cruda = (...eventos: string[]): RespuestaCruda => ({ status: "SUCCESS", events: { contractEventsXdr: [eventos] } });

describe("la transferencia que dejó la red", () => {
  it("un evento con mapa trae el monto y el número de nota", () => {
    const r = transferenciaDelEvento(cruda(evento(activo, temasDeTransfer(), conNota(100_000_000n, 1_234_567_890n))), activo);
    expect(r).toEqual({ monto: 100_000_000n, nota: 1_234_567_890n });
  });

  it("un evento con un solo número trae el monto y ninguna nota", () => {
    const r = transferenciaDelEvento(cruda(evento(activo, temasDeTransfer(), nativeToScVal(100_000_000n, { type: "i128" }))), activo);
    expect(r).toEqual({ monto: 100_000_000n, nota: null });
  });

  it("ignora lo que no es una transferencia del contrato de las monedas", () => {
    const deOtro = evento(RED_DE_PRUEBA.contrato, temasDeTransfer(), conNota(1n, 2n));
    const otroTema = evento(activo, [nativeToScVal("mint", { type: "symbol" })], conNota(1n, 2n));
    expect(transferenciaDelEvento(cruda(deOtro, otroTema), activo)).toBeNull();
    expect(transferenciaDelEvento(cruda(deOtro, otroTema, evento(activo, temasDeTransfer(), conNota(7n, 9n))), activo)).toEqual({ monto: 7n, nota: 9n });
  });

  it("sin eventos, con eventos ilegibles o con otra forma da null y nunca lanza", () => {
    expect(transferenciaDelEvento({ status: "SUCCESS" }, activo)).toBeNull();
    expect(transferenciaDelEvento({ status: "SUCCESS", events: {} }, activo)).toBeNull();
    expect(transferenciaDelEvento(cruda("esto no es un xdr"), activo)).toBeNull();
    expect(transferenciaDelEvento({ status: "SUCCESS", events: { contractEventsXdr: "mal" as unknown as string[][] } }, activo)).toBeNull();
  });
});

describe("la nota del envío", () => {
  it("sin nota pedida es no-pedida, aunque la red traiga una", () => {
    expect(notaDelEnvio(null, null)).toBe("no-pedida");
    expect(notaDelEnvio(null, { monto: 1n, nota: 5n })).toBe("no-pedida");
  });

  it("con nota pedida: sin evento es sin-dato, igual es confirmada y cualquier otra cosa es distinta", () => {
    expect(notaDelEnvio(5n, null)).toBe("sin-dato");
    expect(notaDelEnvio(5n, { monto: 1n, nota: 5n })).toBe("confirmada");
    expect(notaDelEnvio(5n, { monto: 1n, nota: 6n })).toBe("distinta");
    expect(notaDelEnvio(5n, { monto: 1n, nota: null })).toBe("distinta");
  });
});
