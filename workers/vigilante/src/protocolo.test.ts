// La mirada al protocolo y a los costos de la red (issue 220), con la red simulada: nada toca una red de verdad.
// Las reglas de acá son las mismas del detector de GitHub (`scripts/lib/vigilar-red.mjs`) y hay pruebas que lo
// comprueban: lo que acá compara o suma, lo compara o suma igual el detector. Lo que cambia: la lectura pide dos
// cosas chicas (el ledger nuevo y los ajustes) y nada más, y no hay niveles de estado, que el vigilante no mira.
import { describe, expect, it } from "vitest";
import {
  NETWORKS,
  diffParams as diffParamsDelDetector,
  fingerprint as huellaDelDetector,
  makeCaller,
} from "../../../scripts/lib/vigilar-red.mjs";
import {
  REDES,
  type Lectura,
  type LineaBase,
  diffParams,
  estadoDe,
  estadoVacio,
  flatten,
  huella,
  lineaBaseDe,
  leerRed,
  textoDeEstado,
  vigilarProtocolo,
} from "./protocolo";

// ---------- las figuras de las pruebas ----------

/** La línea base de prueba: el protocolo con dos parámetros, en las dos redes. */
const PARAMETROS = {
  protocol_version: 29,
  contract_ledger_cost_v0: { fee_write_ledger_entry: "1250", fee_disk_read1_kb: "223" },
  state_archival: { max_entry_ttl: 3110400 },
};

/** El protocolo nuevo: lo mismo con el protocolo 30. */
const PARAMETROS_PROTOCOLO_NUEVO = { ...PARAMETROS, protocol_version: 30 };

/** Un costo que cambia, sin tocar el protocolo: el sello por entrada escrita pasa de 1250 a 2000. */
const PARAMETROS_COSTO_NUEVO = {
  ...PARAMETROS,
  contract_ledger_cost_v0: { fee_write_ledger_entry: "2000", fee_disk_read1_kb: "223" },
};

const baseDe = (testnet: unknown = PARAMETROS, mainnet: unknown = PARAMETROS): LineaBase =>
  lineaBaseDe(
    JSON.stringify({
      version: 1,
      updated: "2026-11-20T00:00:00.000Z",
      networks: { testnet: { params: testnet }, mainnet: { params: mainnet } },
    }),
  )!;

const lecturaDe = (params: unknown, ledger = 900): Lectura => ({
  protocol: (params as Record<string, unknown>).protocol_version as number,
  ledger,
  closeTime: 1000,
  params: params as Record<string, unknown>,
  modified: Object.fromEntries(Object.keys(params as Record<string, unknown>).map((n) => [n, ledger - 1])),
});

const RED_S = ["testnet", "mainnet"];

// ---------- protocolo igual, protocolo nuevo, un costo que cambia, red caída ----------

describe("una ronda contra la línea base", () => {
  it("con la red igual a la línea base no avisa nada y no cambia lo avisado", async () => {
    const r = await vigilarProtocolo({ redes: RED_S, lecturas: { testnet: lecturaDe(PARAMETROS), mainnet: lecturaDe(PARAMETROS) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    expect(r.avisos).toEqual([]);
    expect(r.errores).toEqual([]);
    expect(r.siguiente).toEqual(estadoVacio());
  });

  it("con un protocolo nuevo avisa una sola vez: la corrida siguiente, con lo mismo, no repite el aviso", async () => {
    const primera = await vigilarProtocolo({ redes: RED_S, lecturas: { testnet: lecturaDe(PARAMETROS_PROTOCOLO_NUEVO), mainnet: lecturaDe(PARAMETROS) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    expect(primera.avisos).toHaveLength(1);
    expect(primera.avisos[0]!.red).toBe("testnet");
    expect(primera.avisos[0]!.asunto).toMatch(/cambió de protocolo/);
    expect(primera.avisos[0]!.texto).toContain("protocol_version");
    expect(primera.avisos[0]!.texto).toContain("29");
    expect(primera.avisos[0]!.texto).toContain("30");
    expect(primera.avisos[0]!.texto).toContain("--actualizar-base --red testnet");

    const segunda = await vigilarProtocolo({ redes: RED_S, lecturas: { testnet: lecturaDe(PARAMETROS_PROTOCOLO_NUEVO), mainnet: lecturaDe(PARAMETROS) }, fallas: {}, base: baseDe(), estado: primera.siguiente });
    expect(segunda.avisos).toEqual([]);
    // Lo avisado queda en memoria: es lo que evita el aviso repetido.
    expect(segunda.siguiente.el.testnet).toEqual(primera.siguiente.el.testnet);
  });

  it("si la red cambia otra vez desde lo avisado vuelve a avisar, y nombra qué cambió desde el último aviso", async () => {
    const primera = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(PARAMETROS_PROTOCOLO_NUEVO) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    const protocolo31 = { ...PARAMETROS_PROTOCOLO_NUEVO, protocol_version: 31 };
    const segunda = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(protocolo31) }, fallas: {}, base: baseDe(), estado: primera.siguiente });
    expect(segunda.avisos).toHaveLength(1);
    expect(segunda.avisos[0]!.texto).toContain("cambió otra vez desde el último aviso");
    expect(segunda.avisos[0]!.texto).toContain("protocol_version");
    // Y lo que queda avisado es el estado nuevo.
    expect(segunda.siguiente.el.testnet!.state).toBe(await huella(protocolo31));
  });

  it("con un costo que cambia avisa una sola vez, y el aviso nombra el parámetro con el antes y el ahora", async () => {
    const primera = await vigilarProtocolo({ redes: ["mainnet"], lecturas: { mainnet: lecturaDe(PARAMETROS_COSTO_NUEVO) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    expect(primera.avisos).toHaveLength(1);
    expect(primera.avisos[0]!.red).toBe("mainnet");
    expect(primera.avisos[0]!.asunto).toMatch(/cambió los costos/);
    expect(primera.avisos[0]!.texto).toContain("contract_ledger_cost_v0");
    expect(primera.avisos[0]!.texto).toContain("1250");
    expect(primera.avisos[0]!.texto).toContain("2000");
    const segunda = await vigilarProtocolo({ redes: ["mainnet"], lecturas: { mainnet: lecturaDe(PARAMETROS_COSTO_NUEVO) }, fallas: {}, base: baseDe(), estado: primera.siguiente });
    expect(segunda.avisos).toEqual([]);
  });

  it("con una red caída dice por qué no pudo leer y no avisa ningún cambio: lo avisado se conserva", async () => {
    // Antes de caerse, mainnet ya había avisado un cambio: tiene que seguir ahí cuando la red vuelve.
    const antes = await vigilarProtocolo({ redes: ["mainnet"], lecturas: { mainnet: lecturaDe(PARAMETROS_COSTO_NUEVO) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    const r = await vigilarProtocolo({ redes: RED_S, lecturas: { testnet: lecturaDe(PARAMETROS_PROTOCOLO_NUEVO), mainnet: undefined }, fallas: { mainnet: "getLatestLedger: mainnet.sorobanrpc.com: HTTP 503" }, base: baseDe(), estado: antes.siguiente });
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]!.red).toBe("testnet");
    expect(r.errores).toEqual([{ red: "mainnet", motivo: "getLatestLedger: mainnet.sorobanrpc.com: HTTP 503" }]);
    expect(r.siguiente.el.mainnet).toEqual(antes.siguiente.el.mainnet);
  });

  it("con una red sin línea base lo dice en los errores y no avisa cambio para esa red", async () => {
    const soloTestnet = lineaBaseDe(JSON.stringify({ version: 1, networks: { testnet: { params: PARAMETROS } } }))!;
    const r = await vigilarProtocolo({ redes: RED_S, lecturas: { testnet: lecturaDe(PARAMETROS), mainnet: lecturaDe(PARAMETROS) }, fallas: {}, base: soloTestnet, estado: estadoVacio() });
    expect(r.avisos).toEqual([]);
    expect(r.errores).toEqual([{ red: "mainnet", motivo: expect.stringContaining("línea base") }]);
  });

  it("una línea base nueva comprometida borra lo avisado cuando la red ya coincide con ella", async () => {
    const baseConCostosNuevos = baseDe(PARAMETROS_COSTO_NUEVO, PARAMETROS_COSTO_NUEVO);
    const trasCambio = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(PARAMETROS_COSTO_NUEVO) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    expect(trasCambio.siguiente.el.testnet).toBeDefined();
    // La base nueva (con el costo ya actualizado) y la red que coincide con ella: lo viejo se olvida, para que el
    // próximo cambio vuelva a avisar desde cero.
    const limpio = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(PARAMETROS_COSTO_NUEVO) }, fallas: {}, base: baseConCostosNuevos, estado: trasCambio.siguiente });
    expect(limpio.siguiente.el.testnet).toBeUndefined();
    expect(limpio.avisos).toEqual([]);
  });

  it("una red que vuelve a coincidir con la base una sola corrida (un RPC atrasado) conserva lo avisado", async () => {
    const trasCambio = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(PARAMETROS_PROTOCOLO_NUEVO) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    const atrasado = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(PARAMETROS) }, fallas: {}, base: baseDe(), estado: trasCambio.siguiente });
    expect(atrasado.avisos).toEqual([]);
    expect(atrasado.siguiente.el.testnet).toEqual(trasCambio.siguiente.el.testnet);
  });

  it("una red que no se pudo leer conserva también lo de una ronda anterior", async () => {
    const trasCambio = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: lecturaDe(PARAMETROS_PROTOCOLO_NUEVO) }, fallas: {}, base: baseDe(), estado: estadoVacio() });
    const caida = await vigilarProtocolo({ redes: ["testnet"], lecturas: { testnet: undefined }, fallas: { testnet: "corte" }, base: baseDe(), estado: trasCambio.siguiente });
    expect(caida.avisos).toEqual([]);
    expect(caida.errores).toEqual([{ red: "testnet", motivo: "corte" }]);
    expect(caida.siguiente).toEqual(trasCambio.siguiente);
  });
});

// ---------- lo que se guarda entre corridas y lo que se lee ----------

describe("el estado de lo avisado", () => {
  it("lo que no se entiende se descarta, y una entrada con huellas raras no cuenta", () => {
    expect(estadoDe("no es json")).toEqual(estadoVacio());
    expect(estadoDe("[1,2]")).toEqual(estadoVacio());
    expect(estadoDe(JSON.stringify({ v: 1, el: { testnet: { state: 12, base: "x", params: {} } } }))).toEqual(estadoVacio());
    // Las huellas van en hex de 64: una que no, se suelta sin tirar el resto.
    const medio = JSON.stringify({
      v: 1,
      el: {
        testnet: { state: "0".repeat(64), base: "1".repeat(64), params: { protocol_version: "z" } },
        mainnet: { state: "2".repeat(64), base: "3".repeat(64) },
      },
    });
    const estado = estadoDe(medio);
    expect(estado.el.testnet).toBeDefined();
    expect(estado.el.mainnet).toEqual({ state: "2".repeat(64), base: "3".repeat(64) });
  });

  it("ida y vuelta por texto no pierde nada", () => {
    const estado = { v: 1 as const, el: { mainnet: { state: "a".repeat(64), base: "b".repeat(64), params: { protocol_version: "c".repeat(64) } } } };
    expect(estadoDe(textoDeEstado(estado))).toEqual(estado);
  });

  it("la línea base que no se entiende vale null", () => {
    expect(lineaBaseDe("")).toBeNull();
    expect(lineaBaseDe("{}")).toBeNull();
    expect(lineaBaseDe(JSON.stringify({ networks: [] }))).toBeNull();
    expect(lineaBaseDe(JSON.stringify({ networks: { testnet: { params: [] } } }))).toBeNull();
    expect(baseDe()).toEqual({
      version: 1,
      updated: "2026-11-20T00:00:00.000Z",
      networks: { testnet: { params: PARAMETROS }, mainnet: { params: PARAMETROS } },
    });
  });
});

// ---------- la lectura de la red, con dos pedidos chicos ----------

const RPC_TESTNET = "https://soroban-testnet.stellar.org";

/** El RPC de mentira: contesta con lo pedido, o se corta las `fallas` primeras veces. Anota cada método pedido. */
function rpcFalso(params: unknown, { fallas = 0 } = {}) {
  const metodos: string[] = [];
  let faltan = fallas;
  const fetchFalso = async (url: string | URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (faltan > 0) {
      faltan -= 1;
      throw new Error("corte de red de mentira");
    }
    const pedido = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
    metodos.push(pedido.method);
    if (pedido.method === "getLatestLedger") {
      const p = params as Record<string, unknown>;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sequence: 900, protocolVersion: p.protocol_version, closeTime: 1000 } }), { status: 200 });
    }
    if (pedido.method === "getLedgerEntries") {
      const p = params as Record<string, unknown>;
      const entradas = Object.entries(p)
        .filter(([nombre]) => nombre !== "protocol_version")
        .map(([nombre, valor]) => ({
          keyJson: { config_setting: { config_setting_id: nombre } },
          dataJson: { config_setting: { [nombre]: valor } },
          lastModifiedLedgerSeq: 899,
        }));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { entries: entradas } }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "método desconocido" } }), { status: 200 });
  };
  return { fetchFalso, metodos };
}

describe("la lectura del protocolo y de los parámetros", () => {
  it("pide dos cosas y no más: el ledger nuevo y los ajustes, y arma la lectura", async () => {
    const { fetchFalso, metodos } = rpcFalso(PARAMETROS);
    const call = makeCaller([RPC_TESTNET], { fetchImpl: fetchFalso, sleep: () => Promise.resolve() });
    const r = await leerRed(call);
    expect(metodos).toEqual(["getLatestLedger", "getLedgerEntries"]);
    expect(r.protocol).toBe(29);
    expect(r.ledger).toBe(900);
    expect(r.params).toEqual({ protocol_version: 29, contract_ledger_cost_v0: PARAMETROS.contract_ledger_cost_v0, state_archival: PARAMETROS.state_archival });
    expect(r.modified.contract_ledger_cost_v0).toBe(899);
    // El pedido de los ajustes va completo, con todos los ids que el protocolo vigente usa.
  });

  it("un RPC que rechaza los ids que no conoce vuelve a pedir solo hasta el que tiene", async () => {
    const tamanosPedidos: number[] = [];
    const detalle = rpcFalso(PARAMETROS);
    const fetchFalso = async (url: string | URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const pedido = JSON.parse(String(init?.body)) as { method: string; params: { keys: unknown[] } };
      if (pedido.method === "getLedgerEntries") {
        tamanosPedidos.push(pedido.params.keys.length);
        if (pedido.params.keys.length > 18) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "cannot unmarshal key value: unknown variant: at index 18" } }), { status: 200 });
        }
      }
      return detalle.fetchFalso(url, init);
    };
    const call = makeCaller([RPC_TESTNET], { fetchImpl: fetchFalso, sleep: () => Promise.resolve() });
    const r = await leerRed(call);
    expect(r.params).toEqual({ protocol_version: 29, contract_ledger_cost_v0: PARAMETROS.contract_ledger_cost_v0, state_archival: PARAMETROS.state_archival });
    expect(tamanosPedidos).toEqual([21, 18]);
  });

  it("una respuesta sin los ajustes se rechaza diciendo por qué", async () => {
    const call = makeCaller([RPC_TESTNET], { fetchImpl: rpcFalso({}).fetchFalso, sleep: () => Promise.resolve() });
    await expect(leerRed(call)).rejects.toThrow(/no trae los parámetros/);
  });

  it("una red cortada falla con el motivo del corte, sin colgarse: con reintentos y la falla de siempre", async () => {
    const { fetchFalso } = rpcFalso(PARAMETROS, { fallas: Infinity });
    const call = makeCaller([RPC_TESTNET], { fetchImpl: fetchFalso, sleep: () => Promise.resolve() });
    await expect(leerRed(call)).rejects.toThrow("getLatestLedger: corte de red de mentira");
  });
});

// ---------- las reglas son las del detector: compara uno por uno ----------

describe("tal como las hace el detector", () => {
  const casos: Array<[unknown, unknown]> = [
    [{ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } }],
    [PARAMETROS, PARAMETROS_PROTOCOLO_NUEVO],
    [PARAMETROS, PARAMETROS_COSTO_NUEVO],
    [PARAMETROS, { ...PARAMETROS, param_nuevo: { x: 1 } }],
    [{ ...PARAMETROS, state_archival: undefined }, PARAMETROS],
  ];
  for (const [i, [antes, despues]] of casos.entries()) {
    it(`diffParams del caso ${i} da exactamente lo que da la del detector`, () => {
      expect(diffParams(antes as Record<string, unknown>, despues as Record<string, unknown>)).toEqual(
        diffParamsDelDetector(antes as Record<string, unknown>, despues as Record<string, unknown>),
      );
      // Y con el orden cambiado también.
      expect(diffParams(despues as Record<string, unknown>, antes as Record<string, unknown>)).toEqual(
        diffParamsDelDetector(despues as Record<string, unknown>, antes as Record<string, unknown>),
      );
    });
  }

  it("flatten achata igual que el del detector, con índices en las listas", () => {
    expect(flatten({ b: { c: [1, 2] } })).toEqual({ "b.c[0]": 1, "b.c[1]": 2 });
  });

  it("la huella es el sha256 del JSON canónico, la misma que estampa el detector", async () => {
    for (const valor of [PARAMETROS, PARAMETROS_PROTOCOLO_NUEVO, PARAMETROS_COSTO_NUEVO, { x: [{ a: 1 }, { b: "s" }] }]) {
      expect(await huella(valor)).toBe(huellaDelDetector(valor));
    }
    // El orden de las llaves no cambia la huella: es canónico.
    expect(await huella({ a: 1, b: 2 })).toBe(await huella({ b: 2, a: 1 }));
  });

  it("los RPC de cada red son los del detector", () => {
    expect(REDES.testnet.rpcUrls).toEqual(NETWORKS.testnet.rpcUrls);
    expect(REDES.mainnet.rpcUrls).toEqual(NETWORKS.mainnet.rpcUrls);
  });
});
