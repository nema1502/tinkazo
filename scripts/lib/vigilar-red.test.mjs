import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NETWORKS,
  analyze,
  annotation,
  averageBytes,
  buildBase,
  decide,
  diffParams,
  flatten,
  fmt,
  fmtDuration,
  formatReport,
  hoursUntil,
  levelFor,
  makeCaller,
  nextState,
  parseSettings,
  parseState,
  readNetwork,
  serializeBase,
  serializeState,
  settingKey,
  slopeMbPerHour,
  summarize,
  thresholdsFor,
  toJson,
} from "./vigilar-red.mjs";

/**
 * Sin red: las respuestas del RPC son pequeñas imitaciones de las reales
 * (`getLedgerEntries` y `getLedgers` con `xdrFormat: "json"`, vistas el 25 de
 * octubre de 2026). Ninguna prueba de acá toca la red.
 */
const NOW = 1_792_977_800;
const DAY = 86_400;

const entry = (name, value, modified = 100) => ({
  keyJson: { config_setting: { config_setting_id: name } },
  dataJson: { config_setting: { [name]: value } },
  lastModifiedLedgerSeq: modified,
  extJson: "v0",
});

const windowOf = (mb) => Array.from({ length: 30 }, () => String(Math.round(mb * 1e6)));

/** Un RPC falso de una red: lo que dice hoy y lo que decía hace un día. */
function fakeRpc({ stateMb = 1750, targetMb = 3000, pastMb = 1700, protocol = 29, pastFails = false, maxId = null, lanes = 2000 } = {}) {
  const calls = [];
  const call = async (method, params) => {
    calls.push(method);
    if (method === "getLatestLedger") return { sequence: 100_000, protocolVersion: protocol, closeTime: String(NOW) };
    if (method === "getLedgerEntries") {
      if (maxId !== null && params.keys.length > maxId) {
        throw new Error(`getLedgerEntries: cannot unmarshal key value AAAACAAAABU= at index ${maxId}`);
      }
      return {
        latestLedger: 100_000,
        entries: [
          entry("contract_max_size_bytes", 131072, 702),
          entry("contract_ledger_cost_v0", { fee_write_ledger_entry: "1250", soroban_state_target_size_bytes: String(targetMb * 1e6) }, 90_000),
          entry("contract_cost_params_cpu_instructions", [
            { ext: "v0", const_term: "4", linear_term: "0" },
            { ext: "v0", const_term: "434", linear_term: "16" },
          ], 2_000),
          entry("contract_execution_lanes", { ledger_max_tx_count: lanes }, 606),
          entry("live_soroban_state_size_window", windowOf(stateMb), 99_968),
          entry("eviction_iterator", { bucket_list_level: 9 }, 100_000),
          entry("frozen_ledger_keys", { keys: [] }, 2_000),
        ],
      };
    }
    if (method === "getLedgers") {
      if (pastFails) throw new Error("getLedgers: fuera de la retención");
      return {
        ledgers: [{
          sequence: 100_000 - 17_280,
          ledgerCloseTime: String(NOW - DAY),
          metadataJson: { v2: { total_byte_size_of_live_soroban_state: String(Math.round(pastMb * 1e6)) } },
        }],
      };
    }
    throw new Error(`método inesperado ${method}`);
  };
  return { call, calls };
}

const read = (options) => readNetwork(fakeRpc(options).call);
/** El análisis de una red; `change` toca la línea base y `previousLevel` es el nivel de la corrida anterior. */
const analyzed = async (network, options, change, previousLevel = null) => {
  const net = await read(options);
  const base = { params: structuredClone(net.params) };
  if (change) change(base.params);
  return analyze(network, net, base, previousLevel);
};

/** `fetch` de pega: cada host tiene una cola de respuestas, cada pedido gasta una y la última se repite. */
const ok = (result) => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result } });
const rpcError = (code, message, status = 200) => ({ status, body: { jsonrpc: "2.0", id: 1, error: { code, message } } });
const http = (status) => ({ status, text: "Service Unavailable" });
function scriptedFetch(plan) {
  const log = [];
  const fn = async (url) => {
    const host = new URL(url).host;
    log.push(host);
    const queue = plan[host];
    const step = queue.length > 1 ? queue.shift() : queue[0];
    if (step instanceof Error) throw step;
    const text = step.text ?? JSON.stringify(step.body);
    return { ok: step.status < 400, status: step.status, text: async () => text };
  };
  fn.log = log;
  return fn;
}
const sleeper = () => {
  const waits = [];
  const sleep = async (ms) => {
    waits.push(ms);
  };
  return { waits, sleep };
};

describe("la lectura de la red", () => {
  it("pide el ajuste de configuración con su LedgerKey en base64", () => {
    expect(settingKey(0)).toBe("AAAACAAAAAA=");
    expect(settingKey(2)).toBe("AAAACAAAAAI=");
    expect(settingKey(21)).toBe("AAAACAAAABU=");
  });

  it("promedia la ventana con división entera, como stellar-core", () => {
    expect(averageBytes(["10", "11", "12"])).toBe(11n);
    expect(averageBytes(["1", "2"])).toBe(1n);
    expect(averageBytes([4_301_176_769, "4302094667"])).toBe(4_301_635_718n);
    expect(() => averageBytes([])).toThrow(/vac/);
  });

  it("separa parámetros, ledgers de cambio y ventana; la ventana y el iterador no son parámetros", () => {
    const { params, modified, window } = parseSettings([
      entry("contract_max_size_bytes", 131072, 702),
      entry("state_archival", { max_entry_ttl: 3110400 }, 2332),
      entry("live_soroban_state_size_window", ["1", "2"], 5),
      entry("eviction_iterator", { bucket_list_level: 9 }, 6),
    ]);
    expect(Object.keys(params)).toEqual(["contract_max_size_bytes", "state_archival"]);
    expect(params.contract_max_size_bytes).toBe(131072);
    expect(modified).toEqual({ contract_max_size_bytes: 702, state_archival: 2332 });
    expect(window).toEqual(["1", "2"]);
    expect(parseSettings(undefined)).toEqual({ params: {}, modified: {}, window: null });
  });

  it("lee estado, objetivo, protocolo y el estado de hace un día", async () => {
    const net = await read({ stateMb: 1758.5, pastMb: 1700, targetMb: 3000 });
    expect(net.stateMb).toBeCloseTo(1758.5, 6);
    expect(net.targetMb).toBe(3000);
    expect(net.protocol).toBe(29);
    expect(net.ledger).toBe(100_000);
    expect(net.past).toEqual({ ledger: 82_720, closeTime: NOW - DAY, stateMb: 1700 });
    expect(net.rpc).toBeNull();
    // El protocolo cuenta como un parámetro más; la ventana y el iterador no.
    expect(Object.keys(net.params).sort()).toEqual([
      "contract_cost_params_cpu_instructions",
      "contract_execution_lanes",
      "contract_ledger_cost_v0",
      "contract_max_size_bytes",
      "frozen_ledger_keys",
      "protocol_version",
    ]);
  });

  it("sin el ledger de ayer sigue: la pendiente queda sin dato y dice por qué", async () => {
    const net = await read({ pastFails: true });
    expect(net.past.error).toMatch(/retención/);
    const a = analyze("mainnet", net, { params: net.params });
    expect(a.slopeMbPerHour).toBeNull();
    expect(a.hoursToRed).toBeNull();
    expect(a.pastError).toMatch(/retención/);
    expect(decide([a]).code).toBe(0);
  });

  it("si el RPC rechaza ids que no conoce, vuelve a pedir hasta el último que sí", async () => {
    const rpc = fakeRpc({ maxId: 17 });
    const net = await readNetwork(rpc.call);
    expect(net.stateMb).toBeCloseTo(1750, 6);
    expect(rpc.calls.filter((m) => m === "getLedgerEntries")).toHaveLength(2);
  });

  it("un error que no es de ids se propaga, y una respuesta sin parámetros no pasa por buena", async () => {
    await expect(readNetwork(async () => { throw new Error("sin red"); })).rejects.toThrow("sin red");
    // Si fallan los ajustes, no se pide el ledger de ayer: nada queda colgado.
    const seen = [];
    const settingsFail = async (method) => {
      seen.push(method);
      if (method === "getLatestLedger") return { sequence: 100_000, protocolVersion: 29, closeTime: String(NOW) };
      throw new Error("getLedgerEntries: HTTP 503");
    };
    await expect(readNetwork(settingsFail)).rejects.toThrow("HTTP 503");
    expect(seen).toEqual(["getLatestLedger", "getLedgerEntries"]);
    const empty = async (method) => (method === "getLatestLedger" ? { sequence: 1, protocolVersion: 29, closeTime: "1" } : { entries: [], ledgers: [] });
    await expect(readNetwork(empty)).rejects.toThrow(/formato/);
  });
});

describe("la comparación con la línea base", () => {
  it("lo igual no cambia", () => {
    const params = { a: 1, b: { x: "1", y: [1, 2] }, c: [] };
    expect(diffParams(params, structuredClone(params))).toEqual([]);
  });

  it("aplana objetos y listas con su ruta", () => {
    expect(flatten({ a: { b: 1 }, l: [{ k: "v" }, 2], e: [], o: {} })).toEqual({ "a.b": 1, "l[0].k": "v", "l[1]": 2, e: [], o: {} });
    expect(flatten(5)).toEqual({ "": 5 });
  });

  it("un campo cambiado nombra el parámetro, el campo, el antes y el ahora", () => {
    const base = { contract_ledger_cost_v0: { soroban_state_target_size_bytes: "4000000000", fee: "1" }, otro: 1 };
    const now = { contract_ledger_cost_v0: { soroban_state_target_size_bytes: "7000000000", fee: "1" }, otro: 1 };
    expect(diffParams(base, now)).toEqual([
      {
        name: "contract_ledger_cost_v0",
        kind: "changed",
        fields: [{ path: "soroban_state_target_size_bytes", before: "4000000000", after: "7000000000" }],
        total: 1,
      },
    ]);
  });

  it("un valor suelto, un elemento de una lista y el protocolo también se notan", () => {
    const base = { contract_max_size_bytes: 131072, cpu: [{ c: "4" }, { c: "5" }], protocol_version: 29 };
    const now = { contract_max_size_bytes: 262144, cpu: [{ c: "4" }, { c: "6" }, { c: "7" }], protocol_version: 30 };
    const byName = Object.fromEntries(diffParams(base, now).map((c) => [c.name, c]));
    expect(byName.contract_max_size_bytes.fields).toEqual([{ path: "", before: 131072, after: 262144 }]);
    expect(byName.cpu.total).toBe(2);
    expect(byName.cpu.fields.map((f) => f.path)).toEqual(["[1].c", "[2].c"]);
    expect(byName.protocol_version.fields[0]).toEqual({ path: "", before: 29, after: 30 });
  });

  it("un parámetro nuevo o uno que desaparece son cambios", () => {
    const changes = diffParams({ viejo: 1, igual: 2 }, { nuevo: 3, igual: 2 });
    expect(changes.map((c) => [c.name, c.kind])).toEqual([["nuevo", "added"], ["viejo", "removed"]]);
  });
});

describe("los niveles", () => {
  it("mainnet: amarillo a 2.000 MB, naranja a 2.500 y rojo a 2.850", () => {
    expect(levelFor("mainnet", 1999.9, 3000)).toBeNull();
    expect(levelFor("mainnet", 2000, 3000)).toBe("amarillo");
    expect(levelFor("mainnet", 2499.9, 3000)).toBe("amarillo");
    expect(levelFor("mainnet", 2500, 3000)).toBe("naranja");
    expect(levelFor("mainnet", 2849.9, 3000)).toBe("naranja");
    expect(levelFor("mainnet", 2850, 3000)).toBe("rojo");
    expect(levelFor("mainnet", 3100, 3000)).toBe("rojo");
  });

  it("testnet: un solo nivel, rojo a 6.000 MB", () => {
    expect(levelFor("testnet", 4311, 7000)).toBeNull();
    expect(levelFor("testnet", 5999.9, 7000)).toBeNull();
    expect(levelFor("testnet", 6000, 7000)).toBe("rojo");
  });

  it("si el objetivo baja, el rojo es el 95 % del objetivo vigente", () => {
    expect(thresholdsFor("testnet", 7000).at(-1).mb).toBe(6000);
    expect(thresholdsFor("testnet", 4000).at(-1).mb).toBe(3800);
    expect(thresholdsFor("mainnet", 3000).at(-1).mb).toBe(2850);
    expect(levelFor("testnet", 3800, 4000)).toBe("rojo");
    expect(levelFor("testnet", 3799, 4000)).toBeNull();
    // Sin objetivo conocido, valen los umbrales a secas.
    expect(levelFor("testnet", 3800, null)).toBeNull();
  });
});

describe("la pendiente y las horas hasta el rojo", () => {
  it("pendiente en MB por hora con el tiempo real entre los dos ledgers", () => {
    expect(slopeMbPerHour(1780, NOW, 1700, NOW - DAY)).toBeCloseTo(80 / 24, 9);
    expect(slopeMbPerHour(1700, NOW, 1780, NOW - DAY)).toBeCloseTo(-80 / 24, 9);
    expect(slopeMbPerHour(1700, NOW, 1700, NOW)).toBeNull();
    expect(slopeMbPerHour(1700, NOW, undefined, NOW - DAY)).toBeNull();
  });

  it("horas hasta la meta: 0 si ya pasó, nulo si no se acerca", () => {
    expect(hoursUntil(1000, 2850, 10)).toBeCloseTo(185, 9);
    expect(hoursUntil(2850, 2850, 10)).toBe(0);
    expect(hoursUntil(3000, 2850, -5)).toBe(0);
    expect(hoursUntil(1000, 2850, 0)).toBeNull();
    expect(hoursUntil(1000, 2850, -2)).toBeNull();
    expect(hoursUntil(1000, 2850, null)).toBeNull();
  });

  it("el análisis junta porcentaje, pendiente de 24 horas y horas a rojo", async () => {
    const a = await analyzed("mainnet", { stateMb: 1758.5, pastMb: 1700 });
    expect(a.percent).toBeCloseTo((1758.5 / 3000) * 100, 6);
    expect(a.slopeMbPerHour).toBeCloseTo(58.5 / 24, 9);
    expect(a.slopeHours).toBe(24);
    expect(a.redMb).toBe(2850);
    expect(a.hoursToRed).toBeCloseTo((2850 - 1758.5) / (58.5 / 24), 6);
    expect(a.level).toBeNull();
    expect(a.levelBefore).toBeNull();
    expect(a.watched).toBe(5);
  });
});

describe("el veredicto y el código de salida", () => {
  it("todo igual: código 0", async () => {
    const results = [await analyzed("mainnet", { stateMb: 1758 }), await analyzed("testnet", { stateMb: 4311, targetMb: 7000 })];
    expect(decide(results)).toEqual({ code: 0, alerts: [], errors: [], daily: false });
  });

  it("un parámetro cambiado: código 1 y nombra el parámetro", async () => {
    const a = await analyzed("testnet", { targetMb: 7000, stateMb: 4311 }, (p) => {
      p.contract_ledger_cost_v0.soroban_state_target_size_bytes = "4000000000";
    });
    const d = decide([a]);
    expect(d.code).toBe(1);
    expect(d.alerts).toHaveLength(1);
    expect(d.alerts[0]).toMatchObject({ network: "testnet", kind: "params" });
    expect(d.alerts[0].message).toContain("contract_ledger_cost_v0");
    expect(d.alerts[0].message).toContain("soroban_state_target_size_bytes");
    expect(d.alerts[0].message).toContain("4000000000 -> 7000000000");
    // Se sabe en qué ledger cambió y hace cuánto.
    expect(a.changes[0]).toMatchObject({ ledger: 90_000, minutesAgo: Math.round((10_000 * 5) / 60) });
  });

  it("el protocolo nuevo también es un cambio", async () => {
    const a = await analyzed("mainnet", {}, (p) => { p.protocol_version = 28; });
    const d = decide([a]);
    expect(d.code).toBe(1);
    expect(d.alerts[0].message).toContain("protocol_version");
  });

  it("sin memoria de la corrida anterior, mainnet desde 2.000 MB es código 1 con el nivel", async () => {
    for (const [mb, level] of [[2000, "amarillo"], [2500, "naranja"], [2850, "rojo"]]) {
      const d = decide([await analyzed("mainnet", { stateMb: mb })]);
      expect(d.code).toBe(1);
      expect(d.alerts).toEqual([
        { network: "mainnet", kind: "level", level, before: null, message: expect.stringContaining(`pasó de normal a ${level}`) },
      ]);
    }
    expect(decide([await analyzed("mainnet", { stateMb: 1999.9 })]).code).toBe(0);
  });

  it("testnet en 6.000 MB o más: código 1; menos, 0", async () => {
    expect(decide([await analyzed("testnet", { stateMb: 5999, targetMb: 7000 })]).code).toBe(0);
    expect(decide([await analyzed("testnet", { stateMb: 6000, targetMb: 7000 })]).code).toBe(1);
  });

  it("no poder mirar es código 2, salvo que haya una alarma, que pesa más", async () => {
    const failed = { network: "mainnet", error: "getLatestLedger: HTTP 503" };
    expect(decide([failed])).toEqual({ code: 2, alerts: [], errors: [{ network: "mainnet", message: "getLatestLedger: HTTP 503" }], daily: false });
    const alarm = await analyzed("testnet", { stateMb: 6500, targetMb: 7000 });
    expect(decide([failed, alarm]).code).toBe(1);
    const net = await read();
    expect(decide([analyze("testnet", net, null)]).code).toBe(2);
  });

  it("sin línea base igual se mira el nivel: un cambio de nivel no se pierde", async () => {
    const net = await read({ stateMb: 2100 });
    const d = decide([analyze("mainnet", net, null, null)]);
    expect(d.code).toBe(1);
    expect(d.errors).toHaveLength(1);
    expect(d.alerts.map((a) => a.kind)).toEqual(["level"]);
  });
});

describe("las transiciones de nivel entre corridas", () => {
  // [nivel de la corrida anterior, MB de hoy, ¿recordatorio diario?, código, aviso esperado]
  const casos = [
    [null, 2000, false, 1, "level"], // sin nivel -> amarillo: falla
    ["amarillo", 2000, false, 0, null], // amarillo -> amarillo: pasa
    ["amarillo", 2500, false, 1, "level"], // amarillo -> naranja: falla
    ["naranja", 2000, false, 1, "level"], // naranja -> amarillo: falla, hacia abajo también
    ["naranja", 2500, false, 0, null], // naranja estable: pasa
    ["naranja", 2500, true, 1, "daily"], // --diario con naranja: falla aunque no cambie
    ["amarillo", 2000, true, 0, null], // --diario con amarillo estable: pasa
    ["rojo", 2850, false, 1, "red"], // rojo -> rojo: falla, en cada corrida
    ["rojo", 2850, true, 1, "red"], // y con --diario es un solo aviso
    ["naranja", 2850, false, 1, "level"], // naranja -> rojo: falla
    ["rojo", 2600, false, 1, "level"], // rojo -> naranja: falla
    ["amarillo", 1500, false, 1, "level"], // amarillo -> normal: el aviso de que pasó
    [null, 1500, false, 0, null], // normal estable: pasa
    [null, 1500, true, 0, null], // y con --diario también
  ];

  it.each(casos)("antes %s, hoy %s MB, diario %s: código %s (%s)", async (before, mb, daily, code, kind) => {
    const a = await analyzed("mainnet", { stateMb: mb }, undefined, before);
    const d = decide([a], { daily });
    expect(d.code).toBe(code);
    expect(d.alerts.map((x) => x.kind)).toEqual(kind ? [kind] : []);
  });

  it("el aviso dice de dónde a dónde se movió", async () => {
    const d = decide([await analyzed("mainnet", { stateMb: 2600 }, undefined, "amarillo")]);
    expect(d.alerts[0]).toEqual({
      network: "mainnet",
      kind: "level",
      level: "naranja",
      before: "amarillo",
      message: "nivel: pasó de amarillo a naranja: el estado está en 2.600,0 MB de 3.000 MB (86,7 %)",
    });
    const down = decide([await analyzed("mainnet", { stateMb: 1500 }, undefined, "amarillo")]);
    expect(down.alerts[0].message).toContain("pasó de amarillo a normal");
  });

  it("testnet en rojo también falla en cada corrida", async () => {
    const a = await analyzed("testnet", { stateMb: 6500, targetMb: 7000 }, undefined, "rojo");
    expect(decide([a]).alerts.map((x) => x.kind)).toEqual(["red"]);
  });

  it("un nivel guardado que no existe se toma como normal", async () => {
    const a = await analyzed("mainnet", { stateMb: 1500 }, undefined, "violeta");
    expect(a.levelBefore).toBeNull();
    expect(decide([a]).code).toBe(0);
  });

  it("a lo largo de varias corridas avisa en cada cambio y calla mientras no cambia", async () => {
    let state = {};
    const codes = [];
    for (const mb of [1500, 1900, 2050, 2100, 2200, 2550, 2500, 2560, 1800]) {
      const a = await analyzed("mainnet", { stateMb: mb }, undefined, state.mainnet ?? null);
      codes.push(decide([a]).code);
      state = parseState(serializeState(nextState(state, [a], new Date(0))));
    }
    // normal, normal, ->amarillo, amarillo, amarillo, ->naranja, naranja, naranja, ->normal
    expect(codes).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });
});

describe("el nivel entre corridas", () => {
  const when = new Date("2026-10-26T01:30:00Z");

  it("se guarda en una línea de JSON y se lee igual; lo que no se entiende se descarta", () => {
    const state = nextState({}, [{ network: "mainnet", level: "amarillo" }, { network: "testnet", level: null }], when);
    expect(state).toEqual({ version: 1, when: "2026-10-26T01:30:00.000Z", levels: { mainnet: "amarillo", testnet: null } });
    const text = serializeState(state);
    expect(text.split("\n")).toHaveLength(2);
    expect(parseState(text)).toEqual({ mainnet: "amarillo" });
    expect(parseState("no es json")).toEqual({});
    expect(parseState(undefined)).toEqual({});
    expect(parseState("null")).toEqual({});
    expect(parseState(JSON.stringify({ levels: { mainnet: "violeta", testnet: "rojo" } }))).toEqual({ testnet: "rojo" });
  });

  it("una red que no se pudo mirar conserva su nivel de antes, y una que no se pidió también", () => {
    const state = nextState(
      { mainnet: "naranja", testnet: "rojo" },
      [{ network: "mainnet", error: "HTTP 503" }],
      when,
    );
    expect(state.levels).toEqual({ mainnet: "naranja", testnet: "rojo" });
    const back = nextState(state.levels, [{ network: "mainnet", level: null }], when);
    expect(back.levels).toEqual({ mainnet: null, testnet: "rojo" });
  });

  it("el nivel de la primera línea del log: igual que antes, el cambio y la red sin mirar", async () => {
    const stable = await analyzed("mainnet", { stateMb: 2100 }, undefined, "amarillo");
    const moved = await analyzed("mainnet", { stateMb: 2600 }, undefined, "amarillo");
    const quiet = await analyzed("testnet", { stateMb: 4311, targetMb: 7000 });
    expect(summarize([stable, quiet])).toBe("mainnet amarillo (igual que antes) · testnet normal");
    expect(summarize([moved])).toBe("mainnet naranja (antes amarillo)");
    expect(summarize([{ network: "mainnet", error: "x" }, quiet])).toBe("mainnet sin mirar · testnet normal");
    const changed = await analyzed("testnet", { stateMb: 4311, targetMb: 7000 }, (p) => { p.contract_max_size_bytes = 1; });
    expect(summarize([quiet, changed])).toBe("testnet normal · testnet normal · PARÁMETROS CAMBIADOS");
  });
});

describe("el RPC de respaldo", () => {
  const A = "https://a.test";
  const B = "https://b.test";

  it("si el primero contesta, el de respaldo ni se toca", async () => {
    const fetchImpl = scriptedFetch({ "a.test": [ok(5)], "b.test": [ok(6)] });
    const call = makeCaller([A, B], { fetchImpl, sleep: sleeper().sleep });
    await expect(call("getLatestLedger", {})).resolves.toBe(5);
    expect(fetchImpl.log).toEqual(["a.test"]);
    expect(call.endpoint()).toEqual({ url: A, backup: false });
  });

  it("si el primero falla tres veces, usa el segundo, y los pedidos que siguen van directo a él", async () => {
    const fetchImpl = scriptedFetch({ "a.test": [http(503)], "b.test": [ok("desde b")] });
    const { waits, sleep } = sleeper();
    const call = makeCaller([A, B], { fetchImpl, sleep });
    await expect(call("getLatestLedger", {})).resolves.toBe("desde b");
    expect(fetchImpl.log).toEqual(["a.test", "a.test", "a.test", "b.test"]);
    expect(waits).toEqual([3000, 6000]);
    expect(call.endpoint()).toEqual({ url: B, backup: true });
    await expect(call("getLedgerEntries", {})).resolves.toBe("desde b");
    expect(fetchImpl.log.slice(4)).toEqual(["b.test"]);
  });

  it("un fallo pasajero se reintenta en el mismo RPC sin cambiar de RPC", async () => {
    const fetchImpl = scriptedFetch({ "a.test": [http(503), ok("bien")], "b.test": [ok("b")] });
    const { waits, sleep } = sleeper();
    const call = makeCaller([A, B], { fetchImpl, sleep });
    await expect(call("getLatestLedger", {})).resolves.toBe("bien");
    expect(fetchImpl.log).toEqual(["a.test", "a.test"]);
    expect(waits).toEqual([3000]);
    expect(call.endpoint().backup).toBe(false);
  });

  it("se cae a la red también por un error de conexión, un HTML o un límite de uso", async () => {
    for (const falla of [new Error("fetch failed"), { status: 200, text: "<html>" }, rpcError(-32029, "Too Many Requests")]) {
      const fetchImpl = scriptedFetch({ "a.test": [falla], "b.test": [ok("desde b")] });
      const call = makeCaller([A, B], { fetchImpl, sleep: sleeper().sleep });
      await expect(call("getLatestLedger", {})).resolves.toBe("desde b");
      expect(call.endpoint().backup).toBe(true);
    }
  });

  it("un error de parámetros no se reintenta ni pasa a otro RPC, aunque venga con estado HTTP 400", async () => {
    for (const status of [200, 400]) {
      const fetchImpl = scriptedFetch({ "a.test": [rpcError(-32602, "cannot unmarshal key value X at index 21", status)], "b.test": [ok("b")] });
      const { waits, sleep } = sleeper();
      const call = makeCaller([A, B], { fetchImpl, sleep });
      await expect(call("getLedgerEntries", {})).rejects.toThrow("getLedgerEntries: cannot unmarshal key value X at index 21");
      expect(fetchImpl.log).toEqual(["a.test"]);
      expect(waits).toEqual([]);
    }
  });

  it("si ninguno contesta, el error dice cuál falló y cómo", async () => {
    const both = makeCaller([A, B], { fetchImpl: scriptedFetch({ "a.test": [http(503)], "b.test": [{ status: 200, text: "<html>" }] }), sleep: sleeper().sleep });
    await expect(both("getLatestLedger", {})).rejects.toThrow("getLatestLedger: a.test: HTTP 503; b.test: la respuesta no es JSON");
    const single = makeCaller([A], { fetchImpl: scriptedFetch({ "a.test": [http(503)] }), sleep: sleeper().sleep });
    await expect(single("getLatestLedger", {})).rejects.toThrow(/^getLatestLedger: HTTP 503$/);
  });

  it("los intentos por RPC se pueden bajar (el ledger de ayer solo insiste dos veces)", async () => {
    const fetchImpl = scriptedFetch({ "a.test": [http(503)], "b.test": [ok(1)] });
    const { waits, sleep } = sleeper();
    const call = makeCaller([A, B], { fetchImpl, sleep });
    await expect(call("getLedgers", {}, { attempts: 2 })).resolves.toBe(1);
    expect(fetchImpl.log).toEqual(["a.test", "a.test", "b.test"]);
    expect(waits).toEqual([3000]);
  });

  it("leer una red entera con el primero caído sale por el de respaldo, con los mismos números", async () => {
    const rpc = fakeRpc({ stateMb: 1758.5, pastMb: 1700, maxId: 17 });
    const fetchImpl = async (url, init) => {
      if (new URL(url).host === "a.test") return { ok: false, status: 503, text: async () => "Service Unavailable" };
      const { method, params } = JSON.parse(init.body);
      let body;
      try {
        body = { result: await rpc.call(method, params) };
      } catch (e) {
        body = { error: { code: -32602, message: e.message } };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const net = await readNetwork(makeCaller([A, B], { fetchImpl, sleep: sleeper().sleep }));
    expect(net.rpc).toEqual({ url: B, backup: true });
    expect(net.stateMb).toBeCloseTo(1758.5, 6);
    expect(net.past.stateMb).toBe(1700);
    const a = analyze("mainnet", net, { params: net.params });
    expect(formatReport({ when: new Date(0), results: [a], decision: decide([a]) })).toContain("· RPC de respaldo b.test");
  });

  it("mainnet tiene respaldos distintos del primero; testnet, solo el de la SDF", () => {
    expect(NETWORKS.testnet.rpcUrls).toEqual(["https://soroban-testnet.stellar.org"]);
    expect(NETWORKS.mainnet.rpcUrls[0]).toBe("https://mainnet.sorobanrpc.com");
    expect(NETWORKS.mainnet.rpcUrls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(NETWORKS.mainnet.rpcUrls).size).toBe(NETWORKS.mainnet.rpcUrls.length);
    for (const url of NETWORKS.mainnet.rpcUrls) expect(url).toMatch(/^https:\/\//);
  });
});

describe("lo que se imprime", () => {
  const when = new Date("2026-10-26T01:30:00Z");

  it("números a la española", () => {
    expect(fmt(1758.5, 1)).toBe("1.758,5");
    expect(fmt(65_138_405)).toBe("65.138.405");
    expect(fmt(-0.004, 2)).toBe("0,00");
    expect(fmt(-12.345, 1)).toBe("-12,3");
    expect(fmtDuration(0.5)).toBe("menos de 1 h");
    expect(fmtDuration(30.2)).toBe("30 h");
    expect(fmtDuration(134.2)).toBe("134 h (5,6 días)");
    expect(fmtDuration(157)).toBe("157 h (6,5 días)");
    expect(fmtDuration(24 * 400)).toBe("más de un año");
    expect(fmtDuration(null)).toBeNull();
  });

  it("el texto trae el nivel en la primera línea, una tabla por red y el veredicto", async () => {
    const results = [await analyzed("mainnet", { stateMb: 2600 }, undefined, "naranja"), await analyzed("testnet", { stateMb: 4311, targetMb: 7000 })];
    const decision = decide(results);
    const text = formatReport({ when, results, decision });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Red de Stellar · mainnet naranja (igual que antes) · testnet normal");
    expect(lines[1]).toBe("Vigilancia 2026-10-26 01:30 UTC");
    expect(text).toContain("mainnet · protocolo 29 · ledger 100.000");
    expect(text).toContain("estado      2.600,0 MB de 3.000 MB (86,7 %) · NIVEL NARANJA (igual que antes)");
    expect(text).toContain("estado      4.311,0 MB de 7.000 MB (61,6 %) · normal");
    expect(text).toContain("pendiente   +");
    expect(text).toContain("hasta rojo  2.850 MB: faltan 250,0 MB");
    // Naranja estable pasa: sin alerta.
    expect(decision.code).toBe(0);
    expect(text).toContain("Sin novedades");
    expect(text).not.toContain("ALERTA");
  });

  it("un cambio de nivel sale en la primera línea y en la alerta; el recordatorio diario se anuncia", async () => {
    const results = [await analyzed("mainnet", { stateMb: 2600 }, undefined, "amarillo")];
    const text = formatReport({ when, results, decision: decide(results, { daily: true }) });
    expect(text.split("\n")[0]).toBe("Red de Stellar · mainnet naranja (antes amarillo)");
    expect(text.split("\n")[1]).toBe("Vigilancia 2026-10-26 01:30 UTC · recordatorio diario");
    expect(text).toContain("NIVEL NARANJA (antes amarillo)");
    expect(text).toContain("ALERTA mainnet: nivel: pasó de amarillo a naranja");
    expect(text).not.toContain("Sin novedades");
  });

  it("un cambio de parámetro muestra cómo actualizar la base", async () => {
    const quiet = [await analyzed("mainnet", {})];
    expect(formatReport({ when, results: quiet, decision: decide(quiet) })).toContain("Sin novedades");
    const changed = [await analyzed("mainnet", {}, (p) => { p.contract_max_size_bytes = 1; })];
    const text = formatReport({ when, results: changed, decision: decide(changed) });
    expect(text).toContain("CAMBIARON 1 de 5");
    expect(text).toContain("contract_max_size_bytes (ledger 702, hace 6 días): valor 1 -> 131072");
    expect(text).toContain("--actualizar-base");
  });

  it("sin la pendiente de ayer y con una red caída, igual imprime", async () => {
    const results = [await analyzed("mainnet", { pastFails: true }), { network: "testnet", error: "getLedgerEntries: HTTP 429" }];
    const text = formatReport({ when, results, decision: decide(results) });
    expect(text).toContain("pendiente   no disponible (getLedgers: fuera de la retención)");
    expect(text).toContain("testnet: NO SE PUDO MIRAR (getLedgerEntries: HTTP 429)");
    expect(text.split("\n")[0]).toBe("Red de Stellar · mainnet normal · testnet sin mirar");
  });

  it("el JSON cabe en una línea y trae lo mismo", async () => {
    const results = [await analyzed("mainnet", { stateMb: 2000 }, undefined, "amarillo"), { network: "testnet", error: "sin red" }];
    const line = JSON.stringify(toJson({ when, results, decision: decide(results) }));
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ ok: false, code: 2, daily: false, summary: "mainnet amarillo (igual que antes) · testnet sin mirar", when: "2026-10-26T01:30:00.000Z" });
    expect(parsed.networks.mainnet).toMatchObject({ protocol: 29, level: "amarillo", levelBefore: "amarillo", targetMb: 3000, redMb: 2850, watched: 5 });
    expect(parsed.networks.mainnet.slopeMbPerHour).toBeCloseTo(300 / 24, 3);
    expect(parsed.networks.testnet).toEqual({ error: "sin red" });
  });

  it("la anotación de GitHub Actions escapa lo que lo rompería", () => {
    expect(annotation("mainnet: 100 %\nsigue")).toBe("::error title=Red de Stellar::mainnet: 100 %25%0Asigue");
  });
});

describe("la línea base", () => {
  const params = { b: { x: "1" }, a: 1, protocol_version: 29 };

  it("se guarda con un parámetro por línea y vuelve igual", () => {
    const base = buildBase(null, { testnet: { params }, mainnet: { params: { z: [1, 2] } } }, new Date("2026-10-26T01:30:00Z"));
    const text = serializeBase(base);
    expect(JSON.parse(text)).toEqual(base);
    expect(text.split("\n").filter((l) => l.includes('"x":"1"'))).toHaveLength(1);
    expect(text.indexOf('"mainnet"')).toBeLessThan(text.indexOf('"testnet"'));
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("actualizar una red deja la otra como estaba", () => {
    const first = buildBase(null, { testnet: { params: { a: 1 } }, mainnet: { params: { a: 1 } } }, new Date(0));
    const second = buildBase(first, { testnet: { params: { a: 2 } } }, new Date(1000));
    expect(second.networks.testnet.params.a).toBe(2);
    expect(second.networks.mainnet.params.a).toBe(1);
    expect(second.updated).toBe("1970-01-01T00:00:01.000Z");
  });

  it("la que está commiteada es JSON válido y trae las dos redes completas", () => {
    const base = JSON.parse(readFileSync(new URL("../vigilar-red.base.json", import.meta.url), "utf8"));
    expect(Object.keys(base.networks).sort()).toEqual(["mainnet", "testnet"]);
    for (const network of ["mainnet", "testnet"]) {
      const names = Object.keys(base.networks[network].params);
      // Los 17 parámetros de costo de Soroban y el protocolo.
      expect(names).toHaveLength(18);
      expect(names).toContain("protocol_version");
      expect(names).toContain("contract_ledger_cost_v0");
      expect(names).not.toContain("live_soroban_state_size_window");
      expect(names).not.toContain("eviction_iterator");
      expect(base.networks[network].params.contract_ledger_cost_v0.soroban_state_target_size_bytes).toMatch(/^\d+$/);
    }
  });
});
