import { describe, expect, it } from "vitest";
import rpcCC from "./fixtures/rpc-getLedgerEntries-premios-CCJGBEFC-promo8.json";
import rpcCD3 from "./fixtures/rpc-getLedgerEntries-premios-CD3FDTS7-promo1.json";
import rpcCD5 from "./fixtures/rpc-getLedgerEntries-premios-CD5UZXNV-promo1.json";
import type { ContratoDePremios } from "./oficiales";
import { type LecturaDeLaPromocion, type PremioDeLaPromocion, type Promocion, leerPromocion } from "./premios";
import { entregasDeLaPromocion, entregasDeLaRed } from "./entregas-decision";

/**
 * La decisión de entrega por premio (`entregas-decision.ts`), sin red y con la red simulada.
 *
 * Los fixtures son las respuestas de verdad del RPC de testnet del 19 de noviembre de 2026 de tres
 * contratos de premios que sellaron (`premios.test.ts` cuenta de qué ensayo salen). El servicio de
 * entregas (#176) decide con el estado que ya está en la red: los estados que no salen en un ensayo
 * se arman a partir de la promoción real del fixture, igual que en `premios.test.ts`.
 */

const CC = "CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY";
const CD3 = "CD3FDTS72H5E63UIXSLAFCRBJGFEFS4C7GT6JMMP2ODZJTVO6AS44A7P";
const CD5 = "CD5UZXNVKZILVXEF2AGZSJUUVUN74AACXZPAZFY7HOPKOHFK6F6Y3PPE";

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

/** La promoción del fixture, leída con el RPC falso, para que la prueba decida sobre lo que la red de verdad guarda. */
async function leida(fixture: { result: { latestLedger: number; entries: { key: string }[] } }, contrato: string, promo: string): Promise<LecturaDeLaPromocion> {
  return leerPromocion(deLaTabla(contrato), promo, { fetch: rpcFalso(fixture).fetch, esperaMs: 0 });
}

/** La lectura con los estados y el estado de la promoción que el ensayo no dejó: lo demás queda igual. */
function conEstados(lectura: LecturaDeLaPromocion, estadoDelPremio: PremioDeLaPromocion["state"] | null, estadoDeLaPromo?: Promocion["status"]): LecturaDeLaPromocion {
  if (!lectura.ok) return lectura;
  const premios = estadoDelPremio === null ? lectura.promocion.premios : lectura.promocion.premios.map((p) => ({ ...p, state: estadoDelPremio }));
  return { ...lectura, promocion: { ...lectura.promocion, premios, ...(estadoDeLaPromo ? { status: estadoDeLaPromo } : {}) } };
}

/** Un día de marzo de 2026, con la hora fija: la decisión nunca mira el reloj de la máquina. */
const AHORA = 1_772_000_000_000;
/** El plazo para cobrar del ensayo: un año después de `AHORA`. */
const HASTA = 2_088_000_000_000;

/** El reloj como lo ve la prueba: todas las cuentas con línea, menos las que el caso cambia. */
const lineas = (sinLinea: string[] = [], inciertas: string[] = []) => {
  const lineasDe: Record<string, boolean | null> = {};
  return (cuenta: string): boolean | null => {
    lineasDe[cuenta] = sinLinea.includes(cuenta) ? false : inciertas.includes(cuenta) ? null : true;
    return lineasDe[cuenta] as boolean | null;
  };
};

/** Las entradas tal como las decide, en orden de puesto: una fila por premio de la promoción. */
const filas = (r: { ok: true; entregas: unknown[] } | { ok: false; error: string }): unknown[] => (r.ok ? r.entregas : []);

describe("la decisión pura por premio", () => {
  it("el premio que espera, con línea y sin vencer, se llama una vez, con su puesto, cuenta y monto", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed");
    if (!lectura.ok) throw new Error("el fixture tiene que leerse");
    const premio = lectura.promocion.premios[0];
    if (!premio) throw new Error("el fixture tiene un premio");
    const r = entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() });
    expect(filas(r)).toHaveLength(1);
    expect((filas(r) as unknown[])[0]).toEqual({ puesto: 0, cuenta: premio.winner, monto: "50000000", accion: "llamar" });
  });

  it("el premio retenido (Held) espera igual que el prometido (Owed): con línea, se llama", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Held");
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: expect.arrayContaining([expect.objectContaining({ accion: "llamar" })]),
    });
  });

  it("el premio ya recibido no se llama, y el devuelto tampoco: volvió a la empresa", async () => {
    const recibido = await leida(rpcCD3, CD3, "1");
    expect(entregasDeLaPromocion(recibido, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: [{ puesto: 0, cuenta: "GA647PFT46KI2BVCRGL3DJBNJXT2KCEEPSNKCTPI4JFIWLLY4BHVIQ7C", monto: "50000000", accion: "no", motivo: "ya-recibido" }],
    });
    // El ensayo de la devolución en especie dejó el premio pagado: el estado devuelto (Returned) se arma como en premios.test.ts.
    const devuelto = conEstados(await leida(rpcCD5, CD5, "1"), "Returned");
    expect(entregasDeLaPromocion(devuelto, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: [expect.objectContaining({ accion: "no", motivo: "volvio" })],
    });
  });

  it("el plazo es solo el dato que llega: a los 8 días todavía se llama si se puede cobrar hasta el día 180, y a los 181 ya no", async () => {
    const DIA = 86_400_000;
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed");
    const cobrarHastaMs = AHORA + 180 * DIA;
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs, ahoraMs: AHORA + 8 * DIA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: [expect.objectContaining({ accion: "llamar" })],
    });
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs, ahoraMs: AHORA + 181 * DIA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: [expect.objectContaining({ accion: "no", motivo: "vencido" })],
    });
  });

  it("un plazo que no es un número finito no se adivina: no se llama y se dice sin saber", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed");
    for (const cobrarHastaMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(entregasDeLaPromocion(lectura, { cobrarHastaMs, ahoraMs: AHORA, laLineaDe: lineas() }), String(cobrarHastaMs)).toEqual({
        ok: true,
        entregas: [expect.objectContaining({ accion: "no", motivo: "no-se-sabe" })],
      });
    }
  });

  it("un momento de la vuelta que no es un número finito tampoco se adivina: no se llama y se dice sin saber", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed");
    for (const ahoraMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined as unknown as number, "1772000000000" as unknown as number]) {
      expect(entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs, laLineaDe: lineas() }), String(ahoraMs)).toEqual({
        ok: true,
        entregas: [expect.objectContaining({ accion: "no", motivo: "no-se-sabe" })],
      });
    }
  });

  it("vencido no se llama, con el plazo que llega: justo el día del plazo ya no va", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed");
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs: AHORA, ahoraMs: AHORA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: [expect.objectContaining({ accion: "no", motivo: "vencido" })],
    });
  });

  it("sin la línea de esa moneda no se llama; si la línea no se pudo saber, tampoco", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed");
    if (!lectura.ok) throw new Error("el fixture tiene que leerse");
    const cuenta = lectura.promocion.premios[0]?.winner as string;
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas([cuenta]) })).toEqual({
      ok: true,
      entregas: [{ puesto: 0, cuenta, monto: "50000000", accion: "no", motivo: "sin-linea" }],
    });
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas([], [cuenta]) })).toEqual({
      ok: true,
      entregas: [{ puesto: 0, cuenta, monto: "50000000", accion: "no", motivo: "no-se-sabe" }],
    });
  });

  it("una promoción cancelada o reembolsada no va a pagar lo que espera: volvió a la empresa", async () => {
    const lectura = await leida(rpcCD3, CD3, "1");
    for (const estado of ["Cancelled", "Refunded"] as const) {
      const quedaEsperando = conEstados(lectura, "Owed", estado);
      expect(entregasDeLaPromocion(quedaEsperando, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() }), estado).toEqual({
        ok: true,
        entregas: [expect.objectContaining({ accion: "no", motivo: "volvio" })],
      });
    }
  });

  it("el premio ya cobrado en una promoción cancelada o reembolsada sigue siendo recibido: no volvió a la empresa", async () => {
    const lectura = await leida(rpcCD3, CD3, "1");
    for (const estado of ["Cancelled", "Refunded"] as const) {
      expect(entregasDeLaPromocion(conEstados(lectura, "Paid", estado), { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() }), estado).toEqual({
        ok: true,
        entregas: [expect.objectContaining({ accion: "no", motivo: "ya-recibido" })],
      });
    }
  });

  it("una promoción sin sello no tiene nada que entregar, aunque el estado diga otra cosa", async () => {
    const lectura = conEstados(await leida(rpcCD3, CD3, "1"), "Owed", "Funded");
    expect(entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() })).toEqual({
      ok: true,
      entregas: [expect.objectContaining({ accion: "no", motivo: "sin-sello" })],
    });
  });

  it("varios premios: una fila por puesto, cada cual con su cuenta y su decisión", async () => {
    const lectura = await leida(rpcCC, CC, "8");
    if (!lectura.ok) throw new Error("el fixture tiene que leerse");
    const conUnoEsperando = conEstados(lectura, "Paid");
    if (!conUnoEsperando.ok) throw new Error("el fixture tiene que leerse");
    const ganadora = conUnoEsperando.promocion.premios[0]?.winner as string;
    // Todas esperan; la ganadora del primer puesto se quedó sin línea: solo la segunda se llama.
    const esperan = conEstados(lectura, "Owed");
    const decisiones = entregasDeLaPromocion(esperan, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas([ganadora]) });
    if (!decisiones.ok) throw new Error("la decisión no puede fallar");
    const llamadas = decisiones.entregas
      .map((e, puesto) => (e.accion === "llamar" ? puesto : null))
      .filter((puesto): puesto is number => puesto !== null);
    expect(llamadas).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(decisiones.entregas[0]).toEqual({ puesto: 0, cuenta: ganadora, monto: "100000000", accion: "no", motivo: "sin-linea" });
    // Del ensayo de verdad (todos pagados): diez decisiones, ninguna se llama.
    const reales = entregasDeLaPromocion(lectura, { cobrarHastaMs: HASTA, ahoraMs: AHORA, laLineaDe: lineas() });
    expect(reales.ok && reales.entregas.every((e) => e.accion === "no" && e.motivo === "ya-recibido")).toBe(true);
    expect(reales.ok && reales.entregas).toHaveLength(10);
  });
});

describe("lo que la red contesta para la decisión (get_prize)", () => {
  it("lee la promoción del contrato con el fetch falso y decide sobre ella, sin pedirle nada a la red de más", async () => {
    const rpc = rpcFalso(rpcCD3);
    const r = await entregasDeLaRed({
      contrato: deLaTabla(CD3),
      promo: "1",
      cobrarHastaMs: HASTA,
      ahoraMs: AHORA,
      laLineaDe: lineas(),
      fetch: rpc.fetch,
      esperaMs: 0,
    });
    expect(r.ok).toBe(true);
    // La lectura es por consulta de claves; ninguna llamada de más: el RPC falso rechaza otro método.
    expect(rpc.pedidos.length).toBeGreaterThan(0);
  });

  it("lo que la red no contesta no decide nada y no lanza", async () => {
    const caida = await entregasDeLaRed({
      contrato: deLaTabla(CC),
      promo: "8",
      cobrarHastaMs: HASTA,
      ahoraMs: AHORA,
      laLineaDe: lineas(),
      fetch: rpcFalso(rpcCC, "corte").fetch,
      esperaMs: 0,
      intentos: 1,
    });
    expect(caida).toEqual({ ok: false, error: "red-caida" });
  });
});
