import { describe, expect, it } from "vitest";
import { HORIZON_URLS } from "./config";
import { crearLectorDeHistorial, leerHistorial } from "./historial";
import { contratosOficiales, type ContratoOficial } from "./oficiales";
import {
  CUENTA,
  PASSPHRASE_MAINNET,
  argsDeSello,
  armarSello,
  armarTx,
  horizonFalso,
  registroDeHorizon,
  type ArgsDelSello,
} from "./horizon-falso";
import realVigente from "./fixtures/horizon-66f498d7.json";
import realUltimoDel936 from "./fixtures/horizon-b5075505.json";
import realUnicoDelOtro from "./fixtures/horizon-2d6b998c.json";
import realFeeBump from "./fixtures/horizon-5c1eaa8e.json";
import realFeeBumpPorLaInterior from "./fixtures/horizon-65060673-por-el-hash-interior.json";

/**
 * El lector del historial (`historial.ts`), sin red.
 *
 * Los cinco registros de `fixtures/` son las respuestas de verdad de Horizon de
 * testnet, grabadas el 25 de octubre de 2026: un sello del contrato vigente, el
 * último sello oficial de cada contrato anterior y un fee-bump (pedido por su hash
 * y por el de la transacción que envuelve). La testnet se borra el 16 de
 * diciembre: las pruebas no le piden nada a la red. El resto se arma con el SDK
 * (`horizon-falso.ts`).
 */

const VIGENTE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const ANTERIOR = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";
const ANTERIOR_VIEJO = "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ";
const AJENO = "CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3";
const ULTIMO_LEDGER_ANTERIOR = 5_381_472;
const ULTIMO_LEDGER_VIEJO = 4_709_441;

const HUELLA = "d16c5585a602e48c3ab270d93658a85d2a4e0d8e4731a2d75b25efe57b583398";
const SELLO: ArgsDelSello = { organizer: CUENTA, listHash: HUELLA, count: 3, numWinners: 1, round: 33_376_937, meta: "Prueba" };
const RONDAS = { esperaMs: 0 };

/** Pide `hash` a un Horizon que solo conoce `registros`. */
const leer = (hash: string, registros: Record<string, unknown>, op: Parameters<typeof leerHistorial>[2] = {}) => {
  const h = horizonFalso(registros);
  return leerHistorial("testnet", hash, { fetch: h.fetch, ...RONDAS, ...op }).then((r) => ({ r, pedidos: h.pedidos }));
};

describe("el sello de una transacción, del historial", () => {
  it("lee el sello de verdad del contrato vigente, con lo que se mandó y cuándo cerró el ledger", async () => {
    const hash = realVigente.hash;
    const { r, pedidos } = await leer(hash, { [hash]: realVigente });
    expect(r).toEqual({
      ok: true,
      sello: {
        hash: "66f498d7b937e20209f765bc995121c9e4c85567cd70232e9890c4e2f07cae0e",
        hashInterior: "66f498d7b937e20209f765bc995121c9e4c85567cd70232e9890c4e2f07cae0e",
        contractId: VIGENTE,
        organizer: CUENTA,
        listHash: HUELLA,
        count: 3,
        numWinners: 1,
        round: 33_376_937,
        meta: "Prueba del contrato de 7 dias, 25 oct",
        // Igual al `sealed_at` y al `sealed_ledger` que guarda el contrato para este sello (leídos el 25 de octubre).
        closedAt: 1_792_934_117,
        ledger: 5_382_106,
      },
    });
    expect(pedidos).toEqual([`${HORIZON_URLS.testnet}/transactions/${hash}`]);
  });

  it("el último sello oficial de cada contrato anterior cae justo en su ultimoLedger y pasa", async () => {
    const a = contratosOficiales("testnet").find((c) => c.contractId === ANTERIOR);
    const b = contratosOficiales("testnet").find((c) => c.contractId === ANTERIOR_VIEJO);
    expect(a?.ultimoLedger).toBe(ULTIMO_LEDGER_ANTERIOR);
    expect(b?.ultimoLedger).toBe(ULTIMO_LEDGER_VIEJO);
    const ultimo = await leer(realUltimoDel936.hash, { [realUltimoDel936.hash]: realUltimoDel936 });
    expect(ultimo.r).toMatchObject({ ok: true, sello: { contractId: ANTERIOR, ledger: ULTIMO_LEDGER_ANTERIOR, count: 18, numWinners: 1, round: 33_375_876 } });
    const unico = await leer(realUnicoDelOtro.hash, { [realUnicoDelOtro.hash]: realUnicoDelOtro });
    expect(unico.r).toMatchObject({ ok: true, sello: { contractId: ANTERIOR_VIEJO, ledger: ULTIMO_LEDGER_VIEJO, count: 18, numWinners: 3, round: 32_255_827 } });
  });

  it("un fee-bump de verdad se pide por su hash o por el de la transacción interior, y lee la interior", async () => {
    const exterior = realFeeBump.hash;
    const interior = realFeeBumpPorLaInterior.hash;
    expect(exterior).not.toBe(interior);
    const porExterior = await leer(exterior, { [exterior]: realFeeBump });
    const porInterior = await leer(interior, { [interior]: realFeeBumpPorLaInterior });
    expect(porExterior.r).toMatchObject({
      ok: true,
      sello: { hash: exterior, contractId: ANTERIOR, count: 5, numWinners: 1, round: 33_218_282, meta: "fondos-exp", ledger: 5_286_878 },
    });
    expect(porInterior.r).toMatchObject({ ok: true, sello: { hash: interior, contractId: ANTERIOR, count: 5, round: 33_218_282 } });
    // El mismo sello se lea por donde se lea.
    if (!porExterior.r.ok || !porInterior.r.ok) throw new Error("tenían que dar ok");
    expect({ ...porInterior.r.sello, hash: "" }).toEqual({ ...porExterior.r.sello, hash: "" });
    // Y su identidad es el hash de la transacción interior, cite el que cite.
    expect(porExterior.r.sello.hashInterior).toBe(interior);
    expect(porInterior.r.sello.hashInterior).toBe(interior);
  });

  it("armado con el SDK: una transacción simple y una envuelta por un fee-bump dan lo mismo", async () => {
    const simple = armarSello(VIGENTE, SELLO);
    const envuelta = armarSello(VIGENTE, SELLO, { feeBump: true });
    expect(envuelta.hash).not.toBe(simple.hash);
    expect(envuelta.hashInterior).toBe(simple.hash);
    const a = await leer(simple.hash, { [simple.hash]: registroDeHorizon(simple, { ledger: 7_000, cierre: 1_790_000_100 }) });
    const b = await leer(envuelta.hash, { [envuelta.hash]: registroDeHorizon(envuelta, { ledger: 7_000, cierre: 1_790_000_100 }) });
    // Horizon contesta por el hash de la transacción interior con ese mismo hash en `hash` e `id`.
    const c = await leer(envuelta.hashInterior, { [envuelta.hashInterior]: registroDeHorizon(envuelta, { hash: envuelta.hashInterior }) });
    const esperado = { contractId: VIGENTE, organizer: CUENTA, listHash: HUELLA, count: 3, numWinners: 1, round: 33_376_937, meta: "Prueba" };
    expect(a.r).toMatchObject({ ok: true, sello: { ...esperado, hash: simple.hash, hashInterior: simple.hash, closedAt: 1_790_000_100, ledger: 7_000 } });
    expect(b.r).toMatchObject({ ok: true, sello: { ...esperado, hash: envuelta.hash, hashInterior: envuelta.hashInterior } });
    expect(c.r).toMatchObject({ ok: true, sello: { ...esperado, hash: envuelta.hashInterior, hashInterior: envuelta.hashInterior } });
  });

  it("el hash tiene que ser el del sobre: la respuesta de otra transacción no sirve", async () => {
    const buena = armarSello(VIGENTE, SELLO);
    const otra = armarSello(VIGENTE, { ...SELLO, count: 4 });
    // Se pide una y contesta, honestamente, otra: su sobre y su hash son los de la otra.
    const otraHonesta = await leer(buena.hash, { [buena.hash]: registroDeHorizon(otra) });
    expect(otraHonesta.r).toEqual({ ok: false, error: "respuesta-invalida" });
    // Un registro que no dice su hash: lo único que lo ata a lo pedido es el sobre.
    const sinHash = { ...registroDeHorizon(otra), hash: undefined, id: undefined };
    expect((await leer(buena.hash, { [buena.hash]: sinHash })).r).toEqual({ ok: false, error: "respuesta-invalida" });
    // Horizon (o quien conteste en su lugar) devuelve el sobre de otra transacción bajo el hash pedido.
    const cambiada = await leer(buena.hash, { [buena.hash]: registroDeHorizon(otra, { hash: buena.hash }) });
    expect(cambiada.r).toEqual({ ok: false, error: "respuesta-invalida" });
    // Aunque el registro diga el hash pedido, el sobre manda.
    const mentirosa = await leer(buena.hash, { [buena.hash]: { ...registroDeHorizon(otra), hash: buena.hash, id: buena.hash } });
    expect(mentirosa.r).toEqual({ ok: false, error: "respuesta-invalida" });
    // Y al revés: el sobre es el bueno, pero el registro dice ser de otra transacción.
    const confundida = await leer(buena.hash, { [buena.hash]: registroDeHorizon(buena, { hash: otra.hash }) });
    expect(confundida.r).toEqual({ ok: false, error: "respuesta-invalida" });
    // La passphrase es parte del hash: una transacción de mainnet no es la de testnet.
    const demainnet = armarSello(VIGENTE, SELLO, { passphrase: PASSPHRASE_MAINNET });
    const equivocada = await leer(demainnet.hash, { [demainnet.hash]: registroDeHorizon(demainnet) });
    expect(equivocada.r).toEqual({ ok: false, error: "respuesta-invalida" });
  });

  it("una transacción que la red rechazó no selló nada", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    const { r } = await leer(tx.hash, { [tx.hash]: registroDeHorizon(tx, { successful: false }) });
    expect(r).toEqual({ ok: false, error: "fallida" });
  });

  it("si no llama a seal no es un sello: otra función, otra operación, varias operaciones", async () => {
    const draw = armarTx({ contrato: VIGENTE, funcion: "draw", args: argsDeSello(SELLO).slice(0, 2) });
    expect((await leer(draw.hash, { [draw.hash]: registroDeHorizon(draw) })).r).toEqual({ ok: false, error: "no-es-un-sello" });
    // Un pago común, que cualquier cuenta puede mandar: no es una llamada a un contrato.
    const { Account, Asset, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
    const pago = new TransactionBuilder(new Account(CUENTA, "1"), { fee: "100", networkPassphrase: "Test SDF Network ; September 2015" })
      .addOperation(Operation.payment({ destination: CUENTA, asset: Asset.native(), amount: "1" }))
      .setTimeout(30)
      .build();
    const hashPago = Buffer.from(pago.hash()).toString("hex");
    const r = await leer(hashPago, { [hashPago]: registroDeHorizon({ hash: hashPago, hashInterior: hashPago, envelopeXdr: pago.toXDR() }) });
    expect(r.r).toEqual({ ok: false, error: "no-es-un-sello" });
    // Dos operaciones: un sello es una sola llamada.
    const doble = new TransactionBuilder(new Account(CUENTA, "1"), { fee: "100", networkPassphrase: "Test SDF Network ; September 2015" })
      .addOperation(Operation.payment({ destination: CUENTA, asset: Asset.native(), amount: "1" }))
      .addOperation(Operation.payment({ destination: CUENTA, asset: Asset.native(), amount: "2" }))
      .setTimeout(30)
      .build();
    const hashDoble = Buffer.from(doble.hash()).toString("hex");
    const d = await leer(hashDoble, { [hashDoble]: registroDeHorizon({ hash: hashDoble, hashInterior: hashDoble, envelopeXdr: doble.toXDR() }) });
    expect(d.r).toEqual({ ok: false, error: "no-es-un-sello" });
  });

  it("un seal de un contrato que no es de Tinkazo no vale, ni en la red equivocada", async () => {
    const ajeno = armarSello(AJENO, SELLO);
    expect((await leer(ajeno.hash, { [ajeno.hash]: registroDeHorizon(ajeno) })).r).toEqual({ ok: false, error: "contrato-ajeno" });
    // Un contrato oficial de testnet, pedido como si fuera de mainnet: ahí no hay ninguno oficial.
    const tx = armarSello(VIGENTE, SELLO, { passphrase: PASSPHRASE_MAINNET });
    const h = horizonFalso({ [tx.hash]: registroDeHorizon(tx) });
    expect(await leerHistorial("mainnet", tx.hash, { fetch: h.fetch, ...RONDAS })).toEqual({ ok: false, error: "contrato-ajeno" });
    expect(h.pedidos).toEqual([`${HORIZON_URLS.mainnet}/transactions/${tx.hash}`]);
  });

  it("un contrato anterior vale hasta su último sello oficial: el siguiente ledger ya no", async () => {
    const tx = armarSello(ANTERIOR, { ...SELLO, count: 18 });
    const registro = (ledger: number): Record<string, unknown> => ({ [tx.hash]: registroDeHorizon(tx, { ledger }) });
    expect((await leer(tx.hash, registro(ULTIMO_LEDGER_ANTERIOR - 1))).r).toMatchObject({ ok: true });
    expect((await leer(tx.hash, registro(ULTIMO_LEDGER_ANTERIOR))).r).toMatchObject({ ok: true });
    // Cualquiera puede seguir sellando en un contrato anterior: lo que cae después no es un sorteo de Tinkazo.
    expect((await leer(tx.hash, registro(ULTIMO_LEDGER_ANTERIOR + 1))).r).toEqual({ ok: false, error: "contrato-ajeno", retirado: true });
    expect((await leer(tx.hash, registro(9_999_999))).r).toEqual({ ok: false, error: "contrato-ajeno", retirado: true });
    // El de verdad, con su ledger cambiado a uno más: lo mismo.
    const real = { ...realUltimoDel936, ledger: ULTIMO_LEDGER_ANTERIOR + 1 };
    expect((await leer(real.hash, { [real.hash]: real })).r).toEqual({ ok: false, error: "contrato-ajeno", retirado: true });
  });

  it("un contrato anterior al que le falta su ultimoLedger no se acepta por historial", async () => {
    const sinTope: ContratoOficial[] = contratosOficiales("testnet").map((c) => {
      const { ultimoLedger: _u, ...resto } = c;
      return resto;
    });
    const tx = armarSello(ANTERIOR, { ...SELLO, count: 18 });
    const { r } = await leer(tx.hash, { [tx.hash]: registroDeHorizon(tx, { ledger: 1 }) }, { contratos: sinTope });
    expect(r).toEqual({ ok: false, error: "contrato-ajeno", sinTope: true });
    // El vigente no lleva tope.
    const vigente = armarSello(VIGENTE, SELLO);
    expect((await leer(vigente.hash, { [vigente.hash]: registroDeHorizon(vigente, { ledger: 99_999_999 }) }, { contratos: sinTope })).r).toMatchObject({ ok: true });
  });

  it("lo que Horizon no conoce no se inventa: 404, y un hash que no es un hash ni se pregunta", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    const { r, pedidos } = await leer(tx.hash, {});
    expect(r).toEqual({ ok: false, error: "no-encontrada" });
    expect(pedidos).toHaveLength(1);
    for (const raro of ["", "abc", tx.hash.toUpperCase(), `${tx.hash}0`, "g".repeat(64), "../accounts"]) {
      const h = horizonFalso({});
      expect(await leerHistorial("testnet", raro, { fetch: h.fetch, ...RONDAS }), raro).toEqual({ ok: false, error: "no-encontrada" });
      expect(h.pedidos, raro).toEqual([]);
    }
  });

  it("una respuesta enorme se corta y no se lee entera", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    const enorme = JSON.stringify({ ...registroDeHorizon(tx), relleno: "x".repeat(300_000) });
    expect((await leer(tx.hash, { [tx.hash]: enorme })).r).toEqual({ ok: false, error: "respuesta-invalida" });
    // Con el tope más bajo, ni una respuesta normal pasa; con el de siempre, sí.
    const normal = registroDeHorizon(tx);
    expect((await leer(tx.hash, { [tx.hash]: normal }, { maxBytes: 100 })).r).toEqual({ ok: false, error: "respuesta-invalida" });
    expect((await leer(tx.hash, { [tx.hash]: normal })).r).toMatchObject({ ok: true });
    // Una que declara su tamaño y no lo cumple con el cuerpo, tampoco.
    const grande: typeof fetch = async () => new Response("{}", { status: 200, headers: { "content-length": "999999999" } });
    expect(await leerHistorial("testnet", tx.hash, { fetch: grande, ...RONDAS })).toEqual({ ok: false, error: "respuesta-invalida" });
  });

  it("la red caída es la red caída, no un sello falso: corte, tiempo agotado y 5xx, con un reintento", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    let llamadas = 0;
    const corte: typeof fetch = async () => {
      llamadas++;
      throw new TypeError("fetch failed");
    };
    expect(await leerHistorial("testnet", tx.hash, { fetch: corte, ...RONDAS })).toEqual({ ok: false, error: "red-caida" });
    expect(llamadas).toBe(2);
    for (const estado of [500, 502, 503, 429]) {
      const h = horizonFalso({ [tx.hash]: estado });
      expect(await leerHistorial("testnet", tx.hash, { fetch: h.fetch, ...RONDAS }), String(estado)).toEqual({ ok: false, error: "red-caida" });
      expect(h.pedidos).toHaveLength(2);
    }
    // Una que nunca contesta: se corta sola.
    const colgada: typeof fetch = () => new Promise<Response>(() => undefined);
    expect(await leerHistorial("testnet", tx.hash, { fetch: colgada, tiempoMs: 20, intentos: 1 })).toEqual({ ok: false, error: "red-caida" });
  });

  it("un 410 (before_history) es 'fuera-de-ventana': esa fuente ya no guarda algo tan antiguo; no se reintenta y no dice que la transacción no exista", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    const cuerpo = JSON.stringify({ type: "https://stellar.org/horizon-errors/before_history", title: "Data Requested Is Before Allowed History", status: 410 });
    let pedidos = 0;
    const f: typeof fetch = async () => {
      pedidos++;
      return new Response(cuerpo, { status: 410 });
    };
    expect(await leerHistorial("testnet", tx.hash, { fetch: f, ...RONDAS })).toEqual({ ok: false, error: "fuera-de-ventana" });
    expect(pedidos).toBe(1);
    // Y no es lo mismo que un 404: ese no dice por qué.
    expect((await leer(tx.hash, {})).r).toEqual({ ok: false, error: "no-encontrada" });
  });

  it("si el primer intento falla y el segundo sale bien, es un sello", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    let n = 0;
    const f: typeof fetch = async (u, i) => {
      if (++n === 1) return new Response("", { status: 429 });
      return horizonFalso({ [tx.hash]: registroDeHorizon(tx) }).fetch(u, i);
    };
    expect(await leerHistorial("testnet", tx.hash, { fetch: f, ...RONDAS })).toMatchObject({ ok: true });
    expect(n).toBe(2);
  });

  it("una respuesta que no es lo que Horizon contesta no es un sello", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    const bien = registroDeHorizon(tx);
    const casos: Record<string, unknown> = {
      "no es JSON": "<html>502 Bad Gateway</html>",
      "es null": "null",
      "es una lista": "[1,2]",
      "sin sobre": { ...bien, envelope_xdr: undefined },
      "sobre vacío": { ...bien, envelope_xdr: "" },
      "sobre que no decodifica": { ...bien, envelope_xdr: "AAAA" },
      "sin ledger": { ...bien, ledger: undefined },
      "ledger en texto": { ...bien, ledger: "5000000" },
      "ledger cero": { ...bien, ledger: 0 },
      "sin hora": { ...bien, created_at: undefined },
      "hora que no es hora": { ...bien, created_at: "ayer" },
      "sin resultado": { ...bien, successful: undefined },
      "resultado en texto": { ...bien, successful: "true" },
    };
    for (const [nombre, cuerpo] of Object.entries(casos)) {
      expect((await leer(tx.hash, { [tx.hash]: cuerpo })).r, nombre).toEqual({ ok: false, error: "respuesta-invalida" });
    }
    // Un 4xx que no es 404 tampoco dice nada de la transacción.
    expect((await leer(tx.hash, { [tx.hash]: 400 })).r).toEqual({ ok: false, error: "respuesta-invalida" });
  });

  it("un seal con argumentos que no son los del contrato no se lee: tipos, cantidad, tamaño de la huella", async () => {
    const bien = argsDeSello(SELLO);
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const malos: Record<string, ReturnType<typeof argsDeSello>> = {
      "falta un argumento": bien.slice(0, 5),
      "sobra uno": [...bien, nativeToScVal(1, { type: "u32" })],
      "la huella no mide 32": [bien[0]!, nativeToScVal(Uint8Array.from(Buffer.alloc(31))), ...bien.slice(2)],
      "la cantidad no es u32": [bien[0]!, bien[1]!, nativeToScVal(3, { type: "i32" }), ...bien.slice(3)],
      "la ronda no es u64": [...bien.slice(0, 4), nativeToScVal(33_376_937, { type: "u32" }), bien[5]!],
      "el organizador es un texto": [nativeToScVal(CUENTA, { type: "string" }), ...bien.slice(1)],
    };
    for (const [nombre, args] of Object.entries(malos)) {
      const tx = armarTx({ contrato: VIGENTE, args });
      expect((await leer(tx.hash, { [tx.hash]: registroDeHorizon(tx) })).r, nombre).toEqual({ ok: false, error: "respuesta-invalida" });
    }
  });

  it("lee el premio con tildes y emojis tal como se mandó, y una huella en minúsculas", async () => {
    const meta = "Cena para dos · Café Ñandú 🎁";
    const tx = armarSello(VIGENTE, { ...SELLO, meta, listHash: HUELLA.toUpperCase().toLowerCase() });
    const { r } = await leer(tx.hash, { [tx.hash]: registroDeHorizon(tx) });
    expect(r).toMatchObject({ ok: true, sello: { meta, listHash: HUELLA } });
  });
});

describe("el lector de una página", () => {
  it("el mismo hash no se pide dos veces", async () => {
    const tx = armarSello(VIGENTE, SELLO);
    const h = horizonFalso({ [tx.hash]: registroDeHorizon(tx) });
    const leerPagina = crearLectorDeHistorial({ fetch: h.fetch, ...RONDAS });
    const [a, b] = await Promise.all([leerPagina("testnet", tx.hash), leerPagina("testnet", tx.hash)]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(h.pedidos).toHaveLength(1);
  });

  it("si Horizon no contesta una vez, no se vuelve a esperar por cada sorteo de la página", async () => {
    let llamadas = 0;
    const caido: typeof fetch = async () => {
      llamadas++;
      throw new TypeError("fetch failed");
    };
    const leerPagina = crearLectorDeHistorial({ fetch: caido, ...RONDAS });
    const uno = armarSello(VIGENTE, SELLO);
    const otro = armarSello(VIGENTE, { ...SELLO, count: 9 });
    expect(await leerPagina("testnet", uno.hash)).toEqual({ ok: false, error: "red-caida" });
    const antes = llamadas;
    expect(await leerPagina("testnet", otro.hash)).toEqual({ ok: false, error: "red-caida" });
    expect(llamadas).toBe(antes);
  });

  it("un 404 no apaga el lector: el siguiente sorteo sí se pregunta", async () => {
    const buena = armarSello(VIGENTE, SELLO);
    const h = horizonFalso({ [buena.hash]: registroDeHorizon(buena) });
    const leerPagina = crearLectorDeHistorial({ fetch: h.fetch, ...RONDAS });
    expect(await leerPagina("testnet", "a".repeat(64))).toEqual({ ok: false, error: "no-encontrada" });
    expect((await leerPagina("testnet", buena.hash)).ok).toBe(true);
  });

  describe("una falla pasajera no lo apaga para toda la sesión", () => {
    /** Un reloj a mano y un Horizon que falla mientras `cae.testnet` / `cae.mainnet` sea verdad. */
    const montar = (registros: Record<string, unknown>) => {
      let ahora = 1_000_000;
      const cae = { testnet: false, mainnet: false };
      const pedidos: string[] = [];
      const bueno = horizonFalso(registros);
      const f: typeof fetch = async (u, i) => {
        const url = String(u);
        pedidos.push(url);
        const red = url.includes("horizon-testnet") ? "testnet" : "mainnet";
        if (cae[red]) return new Response("", { status: 429 });
        return bueno.fetch(u, i);
      };
      const lector = crearLectorDeHistorial({ fetch: f, ...RONDAS, ahora: () => ahora, reposoMs: 30_000 });
      return { lector, cae, pedidos, pasan: (ms: number) => (ahora += ms) };
    };

    it("dos 429 seguidos dejan a esa red descansar 30 segundos, y pasado ese tiempo se vuelve a preguntar", async () => {
      const a = armarSello(VIGENTE, SELLO);
      const b = armarSello(VIGENTE, { ...SELLO, count: 9 });
      const m = montar({ [a.hash]: registroDeHorizon(a), [b.hash]: registroDeHorizon(b) });
      m.cae.testnet = true;
      expect(await m.lector("testnet", a.hash)).toEqual({ ok: false, error: "red-caida" });
      expect(m.pedidos).toHaveLength(2); // los dos intentos del primer sorteo
      // Mientras descansa no se vuelve a esperar por cada sorteo.
      expect(await m.lector("testnet", b.hash)).toEqual({ ok: false, error: "red-caida" });
      expect(m.pedidos).toHaveLength(2);
      m.pasan(29_999);
      expect(await m.lector("testnet", b.hash)).toEqual({ ok: false, error: "red-caida" });
      expect(m.pedidos).toHaveLength(2);
      // Pasado el descanso, con Horizon de vuelta, lee: y el mismo hash que falló se vuelve a pedir.
      m.cae.testnet = false;
      m.pasan(1);
      expect((await m.lector("testnet", b.hash)).ok).toBe(true);
      expect((await m.lector("testnet", a.hash)).ok).toBe(true);
    });

    it("el descanso es por red: que una no conteste no apaga la otra", async () => {
      const a = armarSello(VIGENTE, SELLO);
      const m = montar({ [a.hash]: registroDeHorizon(a) });
      m.cae.testnet = true;
      expect(await m.lector("testnet", a.hash)).toEqual({ ok: false, error: "red-caida" });
      const antes = m.pedidos.length;
      // La otra red sí se pregunta (acá contesta 404: es una respuesta, no un corte).
      expect(await m.lector("mainnet", "b".repeat(64))).toEqual({ ok: false, error: "no-encontrada" });
      expect(m.pedidos.length).toBe(antes + 1);
      expect(m.pedidos[antes]).toContain("horizon.stellar.org");
    });

    it("una falla por red o una respuesta rara no se recuerda; lo que Horizon contestó de verdad, sí", async () => {
      const a = armarSello(VIGENTE, SELLO);
      const h = horizonFalso({ [a.hash]: registroDeHorizon(a) });
      let n = 0;
      const f: typeof fetch = async (u, i) => {
        n++;
        // El primer pedido se corta en una respuesta rara (no se entiende), el segundo llega bien.
        if (n === 1) return new Response("<html>", { status: 200 });
        return h.fetch(u, i);
      };
      const lector = crearLectorDeHistorial({ fetch: f, ...RONDAS });
      expect(await lector("testnet", a.hash)).toEqual({ ok: false, error: "respuesta-invalida" });
      expect((await lector("testnet", a.hash)).ok).toBe(true);
      const despues = n;
      // Ya leído, no se vuelve a pedir.
      expect((await lector("testnet", a.hash)).ok).toBe(true);
      expect(n).toBe(despues);
      // Un 404 y un 410 son respuestas de la fuente: tampoco se piden dos veces.
      const g = horizonFalso({});
      const otro = crearLectorDeHistorial({ fetch: g.fetch, ...RONDAS });
      await otro("testnet", "c".repeat(64));
      await otro("testnet", "c".repeat(64));
      expect(g.pedidos).toHaveLength(1);
      const ventana = horizonFalso({ ["d".repeat(64)]: 410 });
      const lectorV = crearLectorDeHistorial({ fetch: ventana.fetch, ...RONDAS });
      expect(await lectorV("testnet", "d".repeat(64))).toEqual({ ok: false, error: "fuera-de-ventana" });
      await lectorV("testnet", "d".repeat(64));
      expect(ventana.pedidos).toHaveLength(1);
    });

    it("un 410 no apaga el lector ni deja a la red descansando: el siguiente sorteo sí se pregunta", async () => {
      const buena = armarSello(VIGENTE, SELLO);
      const h = horizonFalso({ ["e".repeat(64)]: 410, [buena.hash]: registroDeHorizon(buena) });
      const lector = crearLectorDeHistorial({ fetch: h.fetch, ...RONDAS });
      expect(await lector("testnet", "e".repeat(64))).toEqual({ ok: false, error: "fuera-de-ventana" });
      expect((await lector("testnet", buena.hash)).ok).toBe(true);
    });
  });
});
