import { afterEach, describe, expect, it, vi } from "vitest";
import { type ContratoALeer, SCAN_MAX, escanearContrato, sealsOfAccount, sealsOnChain } from "./seals";
import { type ContratoFalso, type SelloFalso, rpcFalso } from "./rpc-falso";

/**
 * Los sorteos de una cuenta en TODOS los contratos de la red.
 *
 * El 25 de octubre de 2026 el sitio pasó a un contrato nuevo y los sellos de
 * antes se quedaron en el anterior: Mis sorteos solo leía el vigente, así que en
 * otro equipo (o con los datos del navegador borrados) la cuenta de prueba veía
 * 1 de sus 48 sorteos. Acá todo sale de un RPC de mentira con XDR de verdad
 * (`rpc-falso.ts`): sin red, y con las claves que arma `seals.ts` a mano.
 */

const ANA = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const BETO = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
// Direcciones de contrato válidas; el contenido de cada uno es inventado.
const VIGENTE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const ANTERIOR = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";
const VIEJO = "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ";
const RPC = "https://rpc.prueba.test";

afterEach(() => {
  vi.unstubAllGlobals();
});

const sello = (id: number, sealedAt: number, over: Partial<SelloFalso> = {}): SelloFalso => ({ id, organizer: ANA, sealedAt, ...over });

/** Instala el RPC de mentira con esos contratos y devuelve lo que se le pidió. */
function instalar(contratos: ContratoFalso[]): ReturnType<typeof rpcFalso>["pedidos"] {
  const rpc = rpcFalso(contratos);
  vi.stubGlobal("fetch", rpc.fetch);
  return rpc.pedidos;
}

/** Los tres contratos de la lista oficial, en el orden en que `contratosOficiales` los da: el vigente primero. */
const dosAnteriores = (ultimos: { anterior?: number; viejo?: number } = {}): ContratoALeer[] => [
  { contractId: VIGENTE, rpcUrl: RPC },
  { contractId: ANTERIOR, rpcUrl: RPC, ultimoId: ultimos.anterior ?? 1_000 },
  { contractId: VIEJO, rpcUrl: RPC, ultimoId: ultimos.viejo ?? 1_000 },
];

/** De cada sello, dónde está y cuándo se selló: lo que importa para el orden. */
const resumen = (r: { raffles: { contract?: string; id: string; sealedAt: number }[] } | null): [string | undefined, string, number][] =>
  (r?.raffles ?? []).map((x) => [x.contract, x.id, x.sealedAt]);

describe("sealsOfAccount: el vigente y los anteriores", () => {
  it("junta los sellos de todos los contratos, del más nuevo al más viejo, cada uno con la dirección de su contrato", async () => {
    instalar([
      { contractId: VIGENTE, nextId: 3, sellos: [sello(2, 5_000), sello(1, 4_500, { organizer: BETO })] },
      { contractId: ANTERIOR, nextId: 6, sellos: [sello(5, 1_000), sello(4, 3_000), sello(3, 2_000, { organizer: BETO })] },
      { contractId: VIEJO, nextId: 2, sellos: [sello(1, 500)] },
    ]);
    const got = await sealsOfAccount(ANA, dosAnteriores({ anterior: 5, viejo: 1 }));
    expect(resumen(got)).toEqual([
      [VIGENTE, "2", 5_000],
      [ANTERIOR, "4", 3_000],
      [ANTERIOR, "5", 1_000],
      [VIEJO, "1", 500],
    ]);
    expect(got?.truncated).toBe(false);
    // Solo los de la cuenta: los de Beto no entran.
    expect(got?.raffles.every((r) => r.organizer === ANA)).toBe(true);
  });

  it("el mismo número de sorteo en dos contratos son dos sorteos: cada uno con el suyo", async () => {
    instalar([
      { contractId: VIGENTE, nextId: 2, sellos: [sello(1, 2_000, { listHash: "aa", prize: "Del vigente" })] },
      { contractId: VIEJO, nextId: 2, sellos: [sello(1, 1_000, { listHash: "aa", prize: "Del viejo" })] },
    ]);
    const got = await sealsOfAccount(ANA, [dosAnteriores()[0]!, dosAnteriores()[2]!]);
    expect(got?.raffles.map((r) => [r.contract, r.id, r.prize])).toEqual([
      [VIGENTE, "1", "Del vigente"],
      [VIEJO, "1", "Del viejo"],
    ]);
  });

  it("en un contrato anterior solo valen los números hasta su ultimoId, aunque el contador haya seguido subiendo", async () => {
    // Nadie apaga un contrato: después del cambio, alguien siguió sellando en el anterior.
    const pedidos = instalar([
      { contractId: VIGENTE, nextId: 2, sellos: [sello(1, 9_000)] },
      { contractId: ANTERIOR, nextId: 10, sellos: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => sello(n, n * 100)) },
    ]);
    const got = await sealsOfAccount(ANA, [dosAnteriores()[0]!, { contractId: ANTERIOR, rpcUrl: RPC, ultimoId: 3 }]);
    expect(resumen(got)).toEqual([
      [VIGENTE, "1", 9_000],
      [ANTERIOR, "3", 300],
      [ANTERIOR, "2", 200],
      [ANTERIOR, "1", 100],
    ]);
    // Y ni siquiera se pidieron: no se lee de más para tirarlo después.
    expect([...(pedidos.raffles.get(ANTERIOR) ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("un anterior con ultimoId 0 (nunca dio un número) no se lee", async () => {
    const pedidos = instalar([{ contractId: ANTERIOR, nextId: 5, sellos: [sello(1, 100), sello(2, 200)] }]);
    const got = await sealsOfAccount(ANA, [{ contractId: ANTERIOR, rpcUrl: RPC, ultimoId: 0 }]);
    expect(got).toEqual({ raffles: [], truncated: false });
    expect(pedidos.raffles.get(ANTERIOR) ?? []).toEqual([]);
  });

  it("a la misma hora gana el contrato que viene primero (el vigente) y, dentro de uno, el número mayor", async () => {
    instalar([
      { contractId: VIGENTE, nextId: 3, sellos: [sello(1, 1_000), sello(2, 1_000)] },
      { contractId: ANTERIOR, nextId: 4, sellos: [sello(3, 1_000), sello(1, 1_000)] },
    ]);
    const got = await sealsOfAccount(ANA, dosAnteriores().slice(0, 2));
    expect(resumen(got)).toEqual([
      [VIGENTE, "2", 1_000],
      [VIGENTE, "1", 1_000],
      [ANTERIOR, "3", 1_000],
      [ANTERIOR, "1", 1_000],
    ]);
  });

  it("cada sello recibe los ganadores de SU contrato, aunque el número se repita", async () => {
    const pedidos = instalar([
      {
        contractId: VIGENTE,
        nextId: 4,
        sellos: [sello(1, 3_000, { winners: [4] }), sello(2, 2_500, { organizer: BETO, winners: [9] }), sello(3, 2_000)],
      },
      { contractId: ANTERIOR, nextId: 2, sellos: [sello(1, 1_000, { winners: [7, 8] })] },
    ]);
    const got = await sealsOfAccount(ANA, dosAnteriores().slice(0, 2));
    expect(got?.raffles.map((r) => [r.contract, r.id, r.drawn, r.winners])).toEqual([
      [VIGENTE, "1", true, [4]],
      [VIGENTE, "3", false, undefined],
      [ANTERIOR, "1", true, [7, 8]],
    ]);
    // Los ganadores se piden solo de lo que ya se sorteó y es de la cuenta.
    expect(pedidos.draws.get(VIGENTE)).toEqual([1]);
    expect(pedidos.draws.get(ANTERIOR)).toEqual([1]);
  });

  it("cada contrato se pregunta por su propio RPC", async () => {
    const pedidos = instalar([
      { contractId: VIGENTE, nextId: 2, sellos: [sello(1, 2_000)] },
      { contractId: ANTERIOR, nextId: 2, sellos: [sello(1, 1_000)] },
    ]);
    await sealsOfAccount(ANA, [
      { contractId: VIGENTE, rpcUrl: "https://uno.test" },
      { contractId: ANTERIOR, rpcUrl: "https://dos.test", ultimoId: 1 },
    ]);
    expect([...(pedidos.urls.get(VIGENTE) ?? [])]).toEqual(["https://uno.test"]);
    expect([...(pedidos.urls.get(ANTERIOR) ?? [])]).toEqual(["https://dos.test"]);
  });

  it("una cuenta que nunca selló: lista vacía, no null", async () => {
    instalar([{ contractId: VIGENTE, nextId: 2, sellos: [sello(1, 1_000, { organizer: BETO })] }]);
    expect(await sealsOfAccount(ANA, [{ contractId: VIGENTE, rpcUrl: RPC }])).toEqual({ raffles: [], truncated: false });
  });
});

describe("sealsOfAccount: el tope de lectura por contrato", () => {
  it("avisa que se cortó cuando un contrato tiene más de SCAN_MAX sorteos, y lee los más nuevos", async () => {
    const pedidos = instalar([
      // Con SCAN_MAX + 2 números, el 1 queda afuera: se leen del 2 al SCAN_MAX + 1.
      { contractId: VIGENTE, nextId: SCAN_MAX + 2, sellos: [sello(SCAN_MAX + 1, 9_000), sello(2, 100), sello(1, 50)] },
    ]);
    const got = await sealsOfAccount(ANA, [{ contractId: VIGENTE, rpcUrl: RPC }]);
    expect(got?.truncated).toBe(true);
    expect(got?.raffles.map((r) => r.id)).toEqual([String(SCAN_MAX + 1), "2"]);
    const pedidos1 = pedidos.raffles.get(VIGENTE) ?? [];
    expect(pedidos1).toHaveLength(SCAN_MAX);
    expect(Math.min(...pedidos1)).toBe(2);
  });

  it("con exactamente SCAN_MAX sorteos se lee todo y no se avisa nada", async () => {
    const pedidos = instalar([{ contractId: VIGENTE, nextId: SCAN_MAX + 1, sellos: [sello(SCAN_MAX, 9_000), sello(1, 50)] }]);
    const got = await sealsOfAccount(ANA, [{ contractId: VIGENTE, rpcUrl: RPC }]);
    expect(got?.truncated).toBe(false);
    expect(got?.raffles.map((r) => r.id)).toEqual([String(SCAN_MAX), "1"]);
    expect(pedidos.raffles.get(VIGENTE)).toHaveLength(SCAN_MAX);
  });

  it("el tope es por contrato, y se cuenta desde el ultimoId del anterior", async () => {
    const pedidos = instalar([
      { contractId: VIGENTE, nextId: 3, sellos: [sello(1, 9_000), sello(2, 9_500)] },
      // Anterior con 5.000 números dados y 6.000 en el contador: valen del 1 al 5.000 y se leen los 2.000 últimos.
      {
        contractId: ANTERIOR,
        nextId: 6_000,
        sellos: [sello(5_001, 8_000), sello(5_000, 7_000), sello(3_001, 6_000), sello(3_000, 5_000)],
      },
    ]);
    const got = await sealsOfAccount(ANA, [dosAnteriores()[0]!, { contractId: ANTERIOR, rpcUrl: RPC, ultimoId: 5_000 }]);
    // Alcanza con que se corte uno para avisar, aunque el vigente se haya leído entero.
    expect(got?.truncated).toBe(true);
    expect(got?.raffles.map((r) => [r.contract, r.id])).toEqual([
      [VIGENTE, "2"],
      [VIGENTE, "1"],
      [ANTERIOR, "5000"],
      [ANTERIOR, "3001"],
    ]);
    const leidos = pedidos.raffles.get(ANTERIOR) ?? [];
    expect(Math.max(...leidos)).toBe(5_000);
    expect(Math.min(...leidos)).toBe(3_001);
  });
});

describe("sealsOfAccount: cuando un contrato no contesta", () => {
  it("si no se pudo preguntar a alguno, no se afirma nada: null (y la pantalla vuelve a intentar)", async () => {
    instalar([
      { contractId: VIGENTE, nextId: 2, sellos: [sello(1, 2_000)] },
      { contractId: ANTERIOR, nextId: 2, sellos: [sello(1, 1_000)], falla: true },
    ]);
    expect(await sealsOfAccount(ANA, dosAnteriores().slice(0, 2))).toBeNull();
  });

  it("un contrato sin instancia viva (se archivó) se salta y los demás se muestran", async () => {
    instalar([
      { contractId: VIGENTE, nextId: 2, sellos: [sello(1, 2_000)] },
      { contractId: ANTERIOR, nextId: 2, sellos: [sello(1, 1_000)], sinInstancia: true },
    ]);
    const got = await sealsOfAccount(ANA, dosAnteriores().slice(0, 2));
    expect(resumen(got)).toEqual([[VIGENTE, "1", 2_000]]);
    expect(got?.truncated).toBe(false);
  });

  it("si ninguno tiene instancia, null", async () => {
    instalar([{ contractId: VIGENTE, nextId: 2, sellos: [sello(1, 2_000)], sinInstancia: true }]);
    expect(await sealsOfAccount(ANA, [{ contractId: VIGENTE, rpcUrl: RPC }])).toBeNull();
  });

  it("sin contratos que mirar, null y sin llamar a la red", async () => {
    const pedidos = instalar([]);
    expect(await sealsOfAccount(ANA, [])).toBeNull();
    expect(pedidos.llamadas).toBe(0);
  });

  it("un ultimoId que no es un entero no se interpreta: null y sin leer nada", async () => {
    const pedidos = instalar([{ contractId: ANTERIOR, nextId: 3, sellos: [sello(1, 100), sello(2, 200)] }]);
    for (const malo of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await sealsOfAccount(ANA, [{ contractId: ANTERIOR, rpcUrl: RPC, ultimoId: malo }])).toBeNull();
    }
    expect(pedidos.llamadas).toBe(0);
    await expect(escanearContrato(ANTERIOR, RPC, -1)).rejects.toThrow("ultimo-id-invalido");
  });
});

describe("con un solo contrato todo queda como estaba", () => {
  it("sealsOfAccount da lo mismo que sealsOnChain", async () => {
    instalar([
      {
        contractId: VIGENTE,
        nextId: 6,
        sellos: [
          sello(1, 1_000, { winners: [2], prize: "Libro" }),
          sello(2, 2_000, { organizer: BETO }),
          sello(3, 3_000),
          sello(4, 3_000, { winners: [0, 5] }),
          sello(5, 5_000, { count: 77 }),
        ],
      },
    ]);
    const viejo = await sealsOnChain(ANA, VIGENTE, RPC);
    const nuevo = await sealsOfAccount(ANA, [{ contractId: VIGENTE, rpcUrl: RPC }]);
    expect(nuevo?.raffles).toEqual(viejo?.raffles);
    expect(nuevo?.truncated).toBe(viejo?.truncated);
    expect(nuevo?.raffles.map((r) => r.id)).toEqual(["5", "4", "3", "1"]);
  });

  it("también cuando se corta por el tope", async () => {
    instalar([{ contractId: VIGENTE, nextId: SCAN_MAX + 3, sellos: [sello(SCAN_MAX + 2, 9_000), sello(1, 10)] }]);
    const viejo = await sealsOnChain(ANA, VIGENTE, RPC);
    const nuevo = await sealsOfAccount(ANA, [{ contractId: VIGENTE, rpcUrl: RPC }]);
    expect(viejo?.truncated).toBe(true);
    expect(nuevo?.truncated).toBe(true);
    expect(nuevo?.raffles).toEqual(viejo?.raffles);
  });

  it("sealsOnChain sigue mirando un solo contrato y anota en cada sello cuál es", async () => {
    instalar([
      { contractId: VIGENTE, nextId: 2, sellos: [sello(1, 2_000)] },
      { contractId: ANTERIOR, nextId: 2, sellos: [sello(1, 1_000)] },
    ]);
    const got = await sealsOnChain(ANA, VIGENTE, RPC);
    expect(resumen(got)).toEqual([[VIGENTE, "1", 2_000]]);
  });
});
