import { Address, Keypair, Networks, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { armar, type Variante } from "./armar";
import { MAX_FIRMAS_VERIFICADAS, evaluar, type Autoridad, type ReglasLista } from "./lista-blanca";

const CONTRATO = deployments.testnet.contractId;
const OTRO_CONTRATO = deployments.testnet.anteriores[0]?.contractId as string;
const AHORA = Math.floor(Date.now() / 1000);
const REGLAS: ReglasLista = { passphrase: Networks.TESTNET, contractId: CONTRATO, ahoraS: AHORA, topeTx: 10_000_000, ventanaMaxS: 300 };
const kp = Keypair.random();
const base = (v: Partial<Variante> = {}): Variante => ({ firmante: kp, contrato: CONTRATO, ...v });

async function rechazo(v: Partial<Variante>, reglas = REGLAS) {
  const r = await evaluar(armar(base(v)).xdr, reglas);
  expect(r.ok, JSON.stringify(v)).toBe(false);
  return r.ok ? null : r;
}

describe("la lista blanca acepta lo que debe", () => {
  it("un seal y un draw bien armados, con su hash y su cuenta", async () => {
    for (const metodo of ["seal", "draw"] as const) {
      const t = armar(base({ metodo }));
      const r = await evaluar(t.xdr, REGLAS);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.tx.hash).toBe(t.hash);
        expect(r.tx.cuenta).toBe(kp.publicKey());
        expect(r.tx.metodo).toBe(metodo);
        expect(r.tx.resourceFee).toBe(50_000);
      }
    }
  });

  it("la ventana de 5 minutos justa pasa", async () => {
    expect((await evaluar(armar(base({ ventanaS: 290 })).xdr, REGLAS)).ok).toBe(true);
  });
});

describe("la lista blanca rechaza todo lo demás con 400", () => {
  it("otro contrato, incluido uno anterior de la misma red", async () => {
    expect((await rechazo({ contrato: OTRO_CONTRATO }))?.motivo).toBe("no-permitida");
  });

  it("otro método, y nunca extend", async () => {
    for (const metodo of ["extend", "get_raffle", "next_id", "transfer"]) expect((await rechazo({ metodo }))?.detalle, metodo).toBe("metodo");
  });

  it("dos operaciones, una operación con otro origen, una clásica", async () => {
    expect((await rechazo({ dosOperaciones: true }))?.detalle).toBe("operaciones");
    expect((await rechazo({ origenDeOperacion: Keypair.random().publicKey() }))?.detalle).toBe("origen-de-operacion");
    expect((await rechazo({ operacion: "pago" }))?.detalle).toBe("tipo");
    expect((await rechazo({ operacion: "bump" }))?.detalle).toBe("tipo");
  });

  it("seal con un organizador distinto del origen", async () => {
    expect((await rechazo({ organizador: Keypair.random().publicKey() }))?.detalle).toBe("organizador");
  });

  it("los argumentos con otra forma: un draw sin firma, un seal con un argumento de más", async () => {
    expect((await rechazo({ metodo: "draw", args: [nativeToScVal(1n, { type: "u64" })] }))?.detalle).toBe("argumentos");
    expect((await rechazo({ metodo: "seal", args: [new Address(kp.publicKey()).toScVal()] }))?.detalle).toBe("argumentos");
    expect((await rechazo({ metodo: "draw", args: [nativeToScVal(1n, { type: "u64" }), nativeToScVal(new Uint8Array(95), { type: "bytes" })] }))?.detalle).toBe("argumentos");
  });

  it("cualquier memo", async () => {
    expect((await rechazo({ memo: "hola" }))?.detalle).toBe("memo");
  });

  it("entradas para restaurar", async () => {
    expect((await rechazo({ archivadas: [0] }))?.motivo).toBe("restaurar");
  });

  it("sin datos de recursos", async () => {
    expect((await rechazo({ sinDatos: true }))?.detalle).toBe("sin-recursos");
  });

  it("resourceFee sobre el tope, y total sobre el tope", async () => {
    expect((await rechazo({ resourceFee: 10_000_001 }))?.motivo).toBe("fee-alta");
    expect((await rechazo({ resourceFee: 1_000, fee: 10_000_000 }))?.motivo).toBe("fee-alta");
    expect((await rechazo({ resourceFee: 9_000_000 }, { ...REGLAS, topeTx: 5_000_000 }))?.motivo).toBe("fee-alta");
  });

  it("ventana larga, sin ventana o vencida", async () => {
    expect((await rechazo({ ventanaS: 3600 }))?.detalle).toBe("larga");
    expect((await rechazo({ ventanaS: 0 }))?.detalle).toBe("sin-limite");
    expect((await rechazo({}, { ...REGLAS, ahoraS: AHORA + 1000 }))?.detalle).toBe("vencida");
  });

  it("sin firma, con la firma de otra cuenta, y con la firma de otra red", async () => {
    expect((await rechazo({ firmaDe: "ninguna" }))?.motivo).toBe("firma");
    expect((await rechazo({ firmaDe: Keypair.random() }))?.motivo).toBe("firma");
    // Firmada para la red pública: el hash es otro, la firma no vale acá.
    expect((await rechazo({ passphrase: Networks.PUBLIC }))?.motivo).toBe("firma");
  });

  it("un XDR roto, vacío o que no es una transacción", async () => {
    for (const roto of ["", "AAAA", "no es base64!!", armar(base()).xdr.slice(0, 40)]) {
      const r = await evaluar(roto, REGLAS);
      expect(r.ok, roto).toBe(false);
      if (!r.ok) expect(r.motivo).toBe("xdr");
    }
  });

  it("un fee-bump ya armado", async () => {
    const interna = TransactionBuilder.fromXDR(armar(base()).xdr, Networks.TESTNET);
    const envuelta = TransactionBuilder.buildFeeBumpTransaction(kp, "1000", interna as never, Networks.TESTNET);
    envuelta.sign(kp);
    const r = await evaluar(envuelta.toXDR(), REGLAS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalle).toBe("fee-bump");
  });
});

describe("las firmas, contra los firmantes y el umbral de la cuenta", () => {
  const firmada = (quienes: Keypair[]) => {
    const t = TransactionBuilder.fromXDR(armar(base({ firmaDe: "ninguna" })).xdr, Networks.TESTNET);
    t.sign(...quienes);
    return t.toXDR();
  };
  const aut = (firmantes: Array<[Keypair, number]>, umbral: number): Autoridad => ({ firmantes: firmantes.map(([k, peso]) => ({ clave: k.rawPublicKey(), peso })), umbral });
  const con = (a: Autoridad | null): ReglasLista => ({ ...REGLAS, autoridad: async () => a });

  it("suma los pesos de las firmas válidas hasta el umbral medio", async () => {
    const a = Keypair.random();
    const b = Keypair.random();
    const dos = aut([[kp, 0], [a, 1], [b, 1]], 2);
    expect((await evaluar(firmada([a, b]), con(dos))).ok).toBe(true);
    const una = await evaluar(firmada([a]), con(dos));
    expect(una.ok).toBe(false);
    if (!una.ok) expect(una.detalle).toBe("peso-insuficiente");
  });

  it("sin la lectura de la cadena vale solo la llave de la cuenta, con peso 1", async () => {
    expect((await evaluar(firmada([kp]), con(null))).ok).toBe(true);
    expect((await evaluar(firmada([Keypair.random()]), con(null))).ok).toBe(false);
  });

  it("sin ninguna firma ni siquiera pregunta por la cuenta", async () => {
    let preguntas = 0;
    const r = await evaluar(firmada([]), { ...REGLAS, autoridad: async () => (preguntas++, null) });
    expect(r.ok).toBe(false);
    expect(preguntas).toBe(0);
  });

  it(`solo se verifican ${MAX_FIRMAS_VERIFICADAS} firmas: la válida en el sexto lugar no cuenta`, async () => {
    const buena = Keypair.random();
    const basura = Array.from({ length: MAX_FIRMAS_VERIFICADAS }, () => Keypair.random());
    const de = aut([[kp, 0], [buena, 1]], 1);
    expect((await evaluar(firmada([buena, ...basura]), con(de))).ok).toBe(true);
    expect((await evaluar(firmada([...basura, buena]), con(de))).ok).toBe(false);
  });
});

describe("la inclusión declarada", () => {
  it("más que la oferta del fee-bump no se paga: la red exigiría una oferta igual o mayor", async () => {
    const r = await evaluar(armar(base({ fee: 10_001 })).xdr, { ...REGLAS, inclusionMax: 10_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.motivo, r.detalle]).toEqual(["fee-alta", "inclusion"]);
    expect((await evaluar(armar(base({ fee: 10_000 })).xdr, { ...REGLAS, inclusionMax: 10_000 })).ok).toBe(true);
  });
});
