import { describe, expect, it } from "vitest";
import rpcCC from "../stellar/fixtures/rpc-getLedgerEntries-premios-CCJGBEFC-promo8.json";
import rpcCD3 from "../stellar/fixtures/rpc-getLedgerEntries-premios-CD3FDTS7-promo1.json";
import rpcCD5 from "../stellar/fixtures/rpc-getLedgerEntries-premios-CD5UZXNV-promo1.json";
import type { ContratoDePremios } from "../stellar/oficiales";
import { type LecturaDeLaPromocion, type PremioDeLaPromocion, leerPromocion } from "../stellar/premios";
import { premiosDeLaCuenta, premiosDeLaCuentaDeLaRed } from "./premios-de-la-cuenta";

/**
 * Los premios de una cuenta, leídos de la red sin servidor (`premios-de-la-cuenta.ts`).
 *
 * Los fixtures son las respuestas de verdad del RPC de testnet de tres promociones que sellaron
 * (`premios.test.ts` cuenta de qué ensayo salen). La pieza cliente de `get_prize` se prueba con lo
 * que ya está en la red: los estados que faltan se arman a partir de la promoción real del fixture,
 * igual que lo hace `premios.test.ts` con sus variantes.
 */

const CC = "CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY";
const CD3 = "CD3FDTS72H5E63UIXSLAFCRBJGFEFS4C7GT6JMMP2ODZJTVO6AS44A7P";
const CD5 = "CD5UZXNVKZILVXEF2AGZSJUUVUN74AACXZPAZFY7HOPKOHFK6F6Y3PPE";
const GANADORA = "GCCIWHCU5XZ4VAK2GAFJBBTJJXIWPWBPK56JOGEPS6N6LP7AYLILD7F3";
/** Un premio de 10 dólares en unidades mínimas del activo. */
const DIEZ = "100000000";
const HASTA = 1_800_000_000_000;
/** Un momento de la vuelta antes del plazo (ms). */
const AHORA = 1_772_000_000_000;

const deLaTabla = (contractId: string): ContratoDePremios => ({
  red: "testnet",
  contractId,
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
});

/** Un RPC que solo conoce las entradas del fixture, como el de `premios.test.ts`: contesta lo pedido y anota. */
function rpcFalso(fixture: { result: { latestLedger: number; entries: { key: string }[] } }, falla: "corte" | number | null = null) {
  const pedidos: string[][] = [];
  const fetchFalso = (async (_url: unknown, init?: { body?: unknown }) => {
    if (falla === "corte") throw new TypeError("fetch failed");
    if (typeof falla === "number") return new Response("", { status: falla });
    const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: { keys?: string[] } };
    if (cuerpo.method !== "getLedgerEntries") throw new Error(`rpc-falso: método no previsto ${String(cuerpo.method)}`);
    const pedidas = cuerpo.params?.keys ?? [];
    pedidos.push(pedidas);
    const entries = fixture.result.entries.filter((e) => pedidas.includes(e.key));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { latestLedger: fixture.result.latestLedger, entries } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchFalso, pedidos };
}

/** La promoción del fixture, leída con el RPC falso, para que la prueba pura parta de algo de la red. */
async function leida(fixture: { result: { latestLedger: number; entries: { key: string }[] } }, contrato: string, promo: string): Promise<LecturaDeLaPromocion> {
  return leerPromocion(deLaTabla(contrato), promo, { fetch: rpcFalso(fixture).fetch, esperaMs: 0 });
}

describe("los premios de una cuenta, en estados claros", () => {
  it("la cuenta que ganó el primer premio lo ve recibido, con su monto y sin fecha", async () => {
    const r = premiosDeLaCuenta(await leida(rpcCC, CC, "8"), GANADORA, HASTA, AHORA);
    expect(r).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "recibido", hastaMs: null }] });
  });

  it("una cuenta que no ganó: la lista queda vacía, sin inventar un estado", async () => {
    const r = premiosDeLaCuenta(await leida(rpcCC, CC, "8"), "GDZWSRVKR5PHXSMC52J5TAJRFJTUD67XD6B6GRAEUN3A4LGFH5LMROFZ", HASTA, AHORA);
    expect(r).toEqual({ ok: true, premios: [] });
  });

  it("cada estado del premio: la promesa (Owed) y la retenida (Held) están por recibir hasta la fecha de la campaña", async () => {
    const promocion = (await leida(rpcCC, CC, "8"));
    if (!promocion.ok) throw new Error("el fixture tiene que leerse");
    for (const estado of ["Owed", "Held"] as const) {
      const conElEstado: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: promocion.promocion.premios.map((p) => ({ ...p, state: estado })) } };
      expect(premiosDeLaCuenta(conElEstado, GANADORA, HASTA, AHORA), estado).toEqual({
        ok: true,
        premios: [{ puesto: 0, monto: DIEZ, estado: "por-recibir", hastaMs: HASTA }],
      });
    }
  });

  it("el premio devuelto (Returned) volvió a la empresa, con el monto y sin fecha", async () => {
    const promocion = await leida(rpcCD3, CD3, "1");
    if (!promocion.ok) throw new Error("el fixture tiene que leerse");
    const devuelto: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: promocion.promocion.premios.map((p) => ({ ...p, state: "Returned" as const })) } };
    const ganadoraDevuelta = promocion.promocion.premios[0] as PremioDeLaPromocion;
    expect(premiosDeLaCuenta(devuelto, ganadoraDevuelta.winner, HASTA, AHORA)).toEqual({
      ok: true,
      premios: [{ puesto: 0, monto: "50000000", estado: "volvio", hastaMs: null }],
    });
  });

  it("una promoción cancelada o reembolsada: el premio sin pagar volvió a la empresa, y el pagado sigue recibido", async () => {
    const promocion = await leida(rpcCC, CC, "8");
    if (!promocion.ok) throw new Error("el fixture tiene que leerse");
    for (const status of ["Cancelled", "Refunded"] as const) {
      const quedaSinPagar: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: promocion.promocion.premios.map((p) => ({ ...p, state: "Held" as const })), status } };
      expect(premiosDeLaCuenta(quedaSinPagar, GANADORA, HASTA, AHORA), status).toEqual({
        ok: true,
        premios: [{ puesto: 0, monto: DIEZ, estado: "volvio", hastaMs: null }],
      });
      const primero = promocion.promocion.premios[0] as PremioDeLaPromocion;
      const segundo = promocion.promocion.premios[1] as PremioDeLaPromocion;
      const losDos: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: [{ ...primero, state: "Owed" as const, position: 0 }, { ...segundo, state: "Paid" as const, position: 1 }], status } };
      expect(premiosDeLaCuenta(losDos, segundo.winner, HASTA, AHORA), status).toEqual({
        ok: true,
        premios: [{ puesto: 1, monto: DIEZ, estado: "recibido", hastaMs: null }],
      });
    }
  });

  it("pasado el plazo para cobrar el premio que esperaba no se muestra por recibir: venció, sin fecha", async () => {
    const promocion = await leida(rpcCC, CC, "8");
    if (!promocion.ok) throw new Error("el fixture tiene que leerse");
    for (const estado of ["Owed", "Held"] as const) {
      const esperando: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: promocion.promocion.premios.map((p) => ({ ...p, state: estado })) } };
      // Justo el día del plazo ya está vencido, como lo decide la entrega.
      expect(premiosDeLaCuenta(esperando, GANADORA, HASTA, HASTA), estado).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "vencido", hastaMs: null }] });
      expect(premiosDeLaCuenta(esperando, GANADORA, HASTA, HASTA + 1), estado).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "vencido", hastaMs: null }] });
      expect(premiosDeLaCuenta(esperando, GANADORA, HASTA, HASTA - 1), estado).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "por-recibir", hastaMs: HASTA }] });
    }
  });

  it("una promoción sin sello o un estado que no se entiende no promete nada: sin confirmar, sin fecha", async () => {
    const promocion = await leida(rpcCC, CC, "8");
    if (!promocion.ok) throw new Error("el fixture tiene que leerse");
    const esperando = promocion.promocion.premios.map((p) => ({ ...p, state: "Owed" as const }));
    const sinSello: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: esperando, status: "Funded" } };
    expect(premiosDeLaCuenta(sinSello, GANADORA, HASTA, AHORA)).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "sin-confirmar", hastaMs: null }] });
    const raro: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: promocion.promocion.premios.map((p) => ({ ...p, state: "Otro" as unknown as "Owed" })) } };
    expect(premiosDeLaCuenta(raro, GANADORA, HASTA, AHORA)).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "sin-confirmar", hastaMs: null }] });
  });

  it("un plazo o un momento que no son un número finito no se adivinan: sin confirmar y sin fecha", async () => {
    const promocion = await leida(rpcCC, CC, "8");
    if (!promocion.ok) throw new Error("el fixture tiene que leerse");
    const esperando: LecturaDeLaPromocion = { ...promocion, promocion: { ...promocion.promocion, premios: promocion.promocion.premios.map((p) => ({ ...p, state: "Owed" as const })) } };
    for (const malo of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined as unknown as number, null as unknown as number]) {
      const esperado = { ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "sin-confirmar", hastaMs: null }] };
      expect(premiosDeLaCuenta(esperando, GANADORA, malo, AHORA), `plazo ${String(malo)}`).toEqual(esperado);
      expect(premiosDeLaCuenta(esperando, GANADORA, HASTA, malo), `momento ${String(malo)}`).toEqual(esperado);
    }
  });

  it("una promoción sin estado no inventa un premio: se dice que no se pudo leer", () => {
    expect(premiosDeLaCuenta({ ok: false, error: "sin-estado" }, GANADORA, HASTA, AHORA)).toEqual({ ok: false, error: "sin-estado" });
  });

  it("lo demás que no pudo leerse se dice tal cual: red caída, respuesta inválida y contrato ajeno", () => {
    for (const error of ["red-caida", "respuesta-invalida", "contrato-ajeno"] as const) {
      expect(premiosDeLaCuenta({ ok: false, error }, GANADORA, HASTA, AHORA)).toEqual({ ok: false, error });
    }
  });
});

describe("el lector de la red: la pieza cliente de get_prize", () => {
  it("lee los premios del contrato de verdad con el fetch falso: sin lanzar nunca", async () => {
    const r = await premiosDeLaCuentaDeLaRed({ contrato: deLaTabla(CC), promo: "8", cuenta: GANADORA, cobrarHastaMs: HASTA, ahoraMs: AHORA, fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 });
    expect(r).toEqual({ ok: true, premios: [{ puesto: 0, monto: DIEZ, estado: "recibido", hastaMs: null }] });
    // El premio del otro contrato, el que quedó pagado en el ensayo chico.
    const uno = await premiosDeLaCuentaDeLaRed({ contrato: deLaTabla(CD3), promo: "1", cuenta: "GA647PFT46KI2BVCRGL3DJBNJXT2KCEEPSNKCTPI4JFIWLLY4BHVIQ7C", cobrarHastaMs: HASTA, ahoraMs: AHORA, fetch: rpcFalso(rpcCD3).fetch, esperaMs: 0 });
    expect(uno).toEqual({ ok: true, premios: [{ puesto: 0, monto: "50000000", estado: "recibido", hastaMs: null }] });
    // El del contrato anterior, con un Config viejo: se lee igual, y una cuenta sin premio no inventa nada.
    const otro = await premiosDeLaCuentaDeLaRed({ contrato: deLaTabla(CD5), promo: "1", cuenta: GANADORA, cobrarHastaMs: HASTA, ahoraMs: AHORA, fetch: rpcFalso(rpcCD5).fetch, esperaMs: 0 });
    expect(otro).toEqual({ ok: true, premios: [] });
  });

  it("lo que la red no contesta no lanza y no se inventa", async () => {
    const caida = await premiosDeLaCuentaDeLaRed({ contrato: deLaTabla(CC), promo: "8", cuenta: GANADORA, cobrarHastaMs: HASTA, ahoraMs: AHORA, fetch: rpcFalso(rpcCC, "corte").fetch, esperaMs: 0, intentos: 1 });
    expect(caida).toEqual({ ok: false, error: "red-caida" });
    // El contrato de premios no designa nada todavía (#167): la consulta de la instancia archivada es sin estado.
    const sinPromo = await premiosDeLaCuentaDeLaRed({ contrato: deLaTabla(CC), promo: "9", cuenta: GANADORA, cobrarHastaMs: HASTA, ahoraMs: AHORA, fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 });
    expect(sinPromo).toEqual({ ok: false, error: "sin-estado" });
  });
});
