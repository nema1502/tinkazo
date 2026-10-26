import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COST_TYPE_NAMES, costTypeName } from "./tipos-de-costo.mjs";
import {
  NETWORKS,
  analyze,
  annotation,
  averageBytes,
  buildBase,
  decide,
  describeChange,
  diffParams,
  emptyState,
  evaluate,
  fieldLabel,
  fingerprint,
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
function fakeRpc({ stateMb = 1750, targetMb = 3000, pastMb = 1700, protocol = 29, pastFails = false, maxId = null, lanes = 2000, cpuConst = "434" } = {}) {
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
            { ext: "v0", const_term: cpuConst, linear_term: "16" },
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
    let state = emptyState();
    const codes = [];
    for (const mb of [1500, 1900, 2050, 2100, 2200, 2550, 2500, 2560, 1800]) {
      const a = await analyzed("mainnet", { stateMb: mb }, undefined, state.levels.mainnet ?? null);
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
    const state = nextState(emptyState(), [{ network: "mainnet", level: "amarillo" }, { network: "testnet", level: null }], when);
    expect(state).toEqual({ version: 1, when: "2026-10-26T01:30:00.000Z", levels: { mainnet: "amarillo", testnet: null }, notified: {} });
    const text = serializeState(state);
    expect(text.split("\n")).toHaveLength(2);
    expect(parseState(text)).toEqual({ levels: { mainnet: "amarillo" }, notified: {} });
    expect(parseState("no es json")).toEqual(emptyState());
    expect(parseState(undefined)).toEqual(emptyState());
    expect(parseState("null")).toEqual(emptyState());
    expect(parseState(JSON.stringify({ levels: { mainnet: "violeta", testnet: "rojo" } }))).toEqual({ levels: { testnet: "rojo" }, notified: {} });
  });

  it("una red que no se pudo mirar conserva su nivel de antes, y una que no se pidió también", () => {
    const state = nextState(
      { levels: { mainnet: "naranja", testnet: "rojo" } },
      [{ network: "mainnet", error: "HTTP 503" }],
      when,
    );
    expect(state.levels).toEqual({ mainnet: "naranja", testnet: "rojo" });
    const back = nextState(state, [{ network: "mainnet", level: null }], when);
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

describe("el aviso único de los parámetros", () => {
  const when = new Date("2026-10-26T19:00:00Z");
  const NAME = "contract_cost_params_cpu_instructions";
  const HINT_TESTNET = "Si el cambio es legítimo: node scripts/vigilar-red.mjs --actualizar-base --red testnet y commitear la línea base.";

  /** La línea base de testnet como estaba antes de que la red cambiara (`cpuConst` 434, protocolo 29). */
  const oldBase = async () => ({ networks: { testnet: { params: structuredClone((await read({ targetMb: 7000 })).params) } } });
  /** Una corrida de testnet sin red: la red dice esto, y `memory` es lo que dejó la corrida anterior. */
  const cycle = async ({ cpuConst, lanes, protocol, base, memory = emptyState(), daily = false }) =>
    evaluate({
      names: ["testnet"],
      reads: { testnet: await read({ targetMb: 7000, stateMb: 4311, cpuConst, lanes, protocol }) },
      base,
      memory,
      daily,
      when,
    });
  /** Lo que pasa entre una corrida y la siguiente: el archivo que guarda la caché de Actions. */
  const viaCache = (run) => parseState(serializeState(run.next));

  it("la primera corrida que ve el cambio falla, y guarda lo que avisó: el estado, la línea base y cada parámetro", async () => {
    const base = await oldBase();
    const first = await cycle({ cpuConst: "706689", base });
    expect(first.decision.code).toBe(1);
    expect(first.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "params"]]);
    expect(first.decision.alerts[0].message).toContain(NAME);
    expect(first.results[0].alreadyNotified).toBe(false);
    const entry = first.next.notified.testnet;
    expect(entry).toEqual({
      state: first.results[0].fingerprint,
      base: fingerprint(base.networks.testnet.params),
      params: first.results[0].paramFingerprints,
    });
    expect(entry.state).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.base).not.toBe(entry.state);
    expect(Object.keys(entry.params).sort()).toEqual(Object.keys(base.networks.testnet.params).sort());
    expect(summarize(first.results)).toBe("testnet normal · PARÁMETROS CAMBIADOS");
  });

  it("las corridas que siguen, con los mismos valores, pasan y lo dicen en el nombre del paso", async () => {
    const base = await oldBase();
    const first = await cycle({ cpuConst: "706689", base });
    const second = await cycle({ cpuConst: "706689", base, memory: viaCache(first) });
    expect(second.decision).toEqual({ code: 0, alerts: [], errors: [], daily: false });
    expect(second.results[0]).toMatchObject({ alreadyNotified: true, fingerprint: first.results[0].fingerprint });
    expect(summarize(second.results)).toBe(`testnet normal · línea base vieja: testnet, ${NAME}`);
    // Lo que se recuerda no se mueve mientras la red siga igual.
    expect(second.next.notified).toEqual(first.next.notified);
    const report = formatReport({ when, results: second.results, decision: second.decision });
    expect(report.split("\n")[0]).toBe(`Red de Stellar · testnet normal · línea base vieja: testnet, ${NAME}`);
    expect(report).toContain("CAMBIARON 1 de 5 (ya se avisó):");
    expect(report).toContain("Sin novedades nuevas: la línea base de testnet sigue vieja y ya se avisó");
    expect(report).not.toContain("Sin novedades:");
    expect(report).not.toContain("ALERTA");
    // Sin aviso que la lleve, la pista sale sola: una línea, con la red.
    expect(report.split("\n").filter((l) => l.includes("--actualizar-base"))).toEqual([HINT_TESTNET]);
    const json = toJson({ when, results: second.results, decision: second.decision });
    expect(json.ok).toBe(true);
    expect(json.networks.testnet).toMatchObject({ alreadyNotified: true, fingerprint: first.results[0].fingerprint });
  });

  it("el primer aviso no dice que ya se avisó", async () => {
    const first = await cycle({ cpuConst: "706689", base: await oldBase() });
    const report = formatReport({ when, results: first.results, decision: first.decision });
    expect(report).toContain("CAMBIARON 1 de 5:");
    expect(report).not.toContain("ya se avisó");
    expect(report).toContain("ALERTA testnet: cambió 1 parámetro");
  });

  it("el recordatorio diario sigue fallando mientras la base esté vieja, y no cuenta como un aviso nuevo", async () => {
    const base = await oldBase();
    const first = await cycle({ cpuConst: "706689", base });
    const daily = await cycle({ cpuConst: "706689", base, memory: viaCache(first), daily: true });
    expect(daily.decision.code).toBe(1);
    expect(daily.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "stale"]]);
    expect(daily.decision.alerts[0].message).toContain("recordatorio diario: la línea base sigue vieja, 1 parámetro distinto (ya se avisó)");
    expect(daily.decision.alerts[0].message).toContain(NAME);
    expect(summarize(daily.results)).toBe(`testnet normal · línea base vieja: testnet, ${NAME}`);
    const report = formatReport({ when, results: daily.results, decision: daily.decision });
    expect(report).toContain("ALERTA testnet: recordatorio diario: la línea base sigue vieja");
    // La pista va dentro del aviso, una sola vez.
    expect(report.split("\n").filter((l) => l.includes("--actualizar-base"))).toHaveLength(1);
    expect(daily.next.notified).toEqual(first.next.notified);
    // La corrida de media hora que viene después del recordatorio vuelve a pasar.
    expect((await cycle({ cpuConst: "706689", base, memory: viaCache(daily) })).decision.code).toBe(0);
  });

  it("si el cambio se ve por primera vez en la corrida diaria, es un aviso y no un recordatorio", async () => {
    const run = await cycle({ cpuConst: "706689", base: await oldBase(), daily: true });
    expect(run.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
    expect(run.next.notified.testnet.state).toBe(run.results[0].fingerprint);
  });

  it("si la red vuelve a cambiar, la huella es otra y avisa de nuevo, también una sola vez", async () => {
    const base = await oldBase();
    const first = await cycle({ cpuConst: "706689", base });
    const again = await cycle({ cpuConst: "800000", base, memory: viaCache(first) });
    expect(again.decision.code).toBe(1);
    expect(again.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
    expect(again.results[0].alreadyNotified).toBe(false);
    expect(again.results[0].fingerprint).not.toBe(first.results[0].fingerprint);
    expect(again.next.notified.testnet.state).toBe(again.results[0].fingerprint);
    // La línea base no cambió: la entrada sigue siendo contra la misma.
    expect(again.next.notified.testnet.base).toBe(first.next.notified.testnet.base);
    expect((await cycle({ cpuConst: "800000", base, memory: viaCache(again) })).decision.code).toBe(0);
  });

  it("sin memoria (la primera vez, o la caché vacía) se comporta como hoy: cada corrida avisa", async () => {
    const base = await oldBase();
    for (let i = 0; i < 2; i++) {
      const run = await cycle({ cpuConst: "706689", base });
      expect(run.decision.code).toBe(1);
      expect(run.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
    }
    // Un archivo de antes de que existieran las huellas se lee como si nada se hubiera avisado.
    const old = parseState(JSON.stringify({ version: 1, when: "2026-10-26T12:00:00.000Z", levels: { mainnet: null, testnet: null } }));
    expect(old).toEqual(emptyState());
    expect((await cycle({ cpuConst: "706689", base, memory: old })).decision.alerts.map((a) => a.kind)).toEqual(["params"]);
  });

  it("una red que no se pudo mirar, o que no tiene línea base, conserva lo que ya se avisó", async () => {
    const base = await oldBase();
    const first = await cycle({ cpuConst: "706689", base });
    const failed = evaluate({ names: ["testnet"], reads: {}, failures: { testnet: "getLatestLedger: HTTP 503" }, base, memory: viaCache(first), when });
    expect(failed.decision.code).toBe(2);
    expect(failed.next.notified).toEqual(first.next.notified);
    const net = await read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" });
    const blind = evaluate({ names: ["testnet"], reads: { testnet: net }, base: null, memory: viaCache(first), when });
    expect(blind.decision.code).toBe(2);
    expect(blind.next.notified).toEqual(first.next.notified);
    // Cuando la red vuelve a poder mirarse, el cambio ya avisado no se repite.
    expect((await cycle({ cpuConst: "706689", base, memory: viaCache(failed) })).decision.code).toBe(0);
  });

  it("cada red lleva lo suyo: lo avisado de una no calla a la otra", async () => {
    const base = { networks: { ...(await oldBase()).networks, mainnet: { params: structuredClone((await read()).params) } } };
    const names = ["testnet", "mainnet"];
    const reads = (mainnetCpu) =>
      Promise.all([read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" }), read({ cpuConst: mainnetCpu })]).then(([testnet, mainnet]) => ({ testnet, mainnet }));
    // Testnet cambia primero y se avisa; mainnet sigue igual que su base.
    const first = evaluate({ names, reads: await reads("434"), base, when });
    expect(first.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "params"]]);
    // Mainnet cambia después: se avisa de mainnet, y lo de testnet ya avisado queda en el nombre del paso.
    const second = evaluate({ names, reads: await reads("900000"), base, memory: viaCache(first), when });
    expect(second.decision.code).toBe(1);
    expect(second.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["mainnet", "params"]]);
    expect(summarize(second.results)).toBe(`testnet normal · mainnet normal · PARÁMETROS CAMBIADOS · línea base vieja: testnet, ${NAME}`);
    expect(Object.keys(second.next.notified).sort()).toEqual(["mainnet", "testnet"]);
    expect(evaluate({ names, reads: await reads("900000"), base, memory: viaCache(second), when }).decision.code).toBe(0);
  });

  it("el nombre del paso corta a tres parámetros con «y N más»", async () => {
    const net = await read({ targetMb: 7000, stateMb: 4311 });
    // La línea base difiere de la red en cinco parámetros.
    const oldParams = structuredClone(net.params);
    for (const name of ["contract_execution_lanes", "contract_ledger_cost_v0", "contract_max_size_bytes", "frozen_ledger_keys", "protocol_version"]) {
      oldParams[name] = ["viejo", oldParams[name]];
    }
    const base = { params: oldParams };
    const notice = { state: fingerprint(net.params), base: fingerprint(oldParams) };
    const a = analyze("testnet", net, base, null, notice);
    expect(a.changes).toHaveLength(5);
    expect(a.alreadyNotified).toBe(true);
    expect(summarize([a])).toBe("testnet normal · línea base vieja: testnet, contract_execution_lanes, contract_ledger_cost_v0, contract_max_size_bytes y 2 más");
  });

  it("evaluate le da a cada red el nivel que dejó la corrida anterior, y no el de la otra", async () => {
    const names = ["testnet", "mainnet"];
    const reads = { testnet: await read({ targetMb: 7000, stateMb: 6500 }), mainnet: await read({ stateMb: 2600 }) };
    const base = { networks: { testnet: { params: reads.testnet.params }, mainnet: { params: reads.mainnet.params } } };
    // Testnet en rojo y mainnet en naranja, como la corrida anterior los dejó.
    const memory = parseState(JSON.stringify({ version: 1, levels: { testnet: "rojo", mainnet: "naranja" } }));
    const run = evaluate({ names, reads, base, memory, when });
    expect(run.results.map((r) => [r.network, r.level, r.levelBefore])).toEqual([
      ["testnet", "rojo", "rojo"],
      ["mainnet", "naranja", "naranja"],
    ]);
    // El rojo falla en cada corrida; el naranja que sigue igual, no.
    expect(run.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "red"]]);
    expect(run.next.levels).toEqual({ testnet: "rojo", mainnet: "naranja" });
    // Con los niveles cruzados, cada red se habría movido: se nota que cada una mira el suyo.
    const crossed = parseState(JSON.stringify({ levels: { testnet: "naranja", mainnet: "rojo" } }));
    const other = evaluate({ names, reads, base, memory: crossed, when });
    expect(other.results.map((r) => r.levelBefore)).toEqual(["naranja", "rojo"]);
    expect(other.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "level"], ["mainnet", "level"]]);
  });

  it("--red testnet conserva lo que había de mainnet: su nivel y lo que se avisó", async () => {
    const mainnetBefore = await read({ stateMb: 2100 });
    const base = { networks: { ...(await oldBase()).networks, mainnet: { params: structuredClone(mainnetBefore.params) } } };
    const names = ["testnet", "mainnet"];
    const both = evaluate({
      names,
      reads: { testnet: await read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" }), mainnet: await read({ stateMb: 2100, cpuConst: "900000" }) },
      base,
      when,
    });
    expect(both.next.levels.mainnet).toBe("amarillo");
    expect(Object.keys(both.next.notified).sort()).toEqual(["mainnet", "testnet"]);
    // Una corrida a mano de una sola red, con lo que dejó la de las dos.
    const only = evaluate({
      names: ["testnet"],
      reads: { testnet: await read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" }) },
      base,
      memory: viaCache(both),
      when,
    });
    expect(only.decision.code).toBe(0);
    expect(only.next.levels.mainnet).toBe("amarillo");
    expect(only.next.notified.mainnet).toEqual(both.next.notified.mainnet);
    expect(only.next.notified.testnet).toEqual(both.next.notified.testnet);
  });

  describe("la huella no se mueve con lo que cambia solo", () => {
    it("otro ledger, otra hora, otro estado vivo y otros ledgers de cambio, con los mismos parámetros: la misma huella y silencio", async () => {
      const base = await oldBase();
      const net = await read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" });
      const later = {
        ...net,
        ledger: net.ledger + 1234,
        closeTime: net.closeTime + 6170,
        stateMb: net.stateMb + 7.5,
        modified: Object.fromEntries(Object.entries(net.modified).map(([name, ledger]) => [name, ledger + 99])),
        past: { ...net.past, ledger: net.past.ledger + 1234, closeTime: net.past.closeTime + 6170, stateMb: net.past.stateMb + 3 },
        rpc: { url: "https://respaldo.test/", backup: true },
      };
      const first = evaluate({ names: ["testnet"], reads: { testnet: net }, base, when });
      const second = evaluate({ names: ["testnet"], reads: { testnet: later }, base, memory: viaCache(first), when });
      expect(second.results[0].fingerprint).toBe(first.results[0].fingerprint);
      expect(second.results[0].paramFingerprints).toEqual(first.results[0].paramFingerprints);
      expect(second.decision).toEqual({ code: 0, alerts: [], errors: [], daily: false });
      expect(second.next.notified).toEqual(first.next.notified);
    });

    it("cualquier parámetro que cambie en la lectura, y también el protocolo, cambia la huella del análisis", async () => {
      const net = await read({ targetMb: 7000 });
      const original = analyze("testnet", net, { params: net.params }).fingerprint;
      expect(Object.keys(net.params)).toContain("protocol_version");
      for (const name of Object.keys(net.params)) {
        const changed = { ...net, params: { ...net.params, [name]: ["otro", net.params[name]] } };
        expect(analyze("testnet", changed, { params: net.params }).fingerprint, name).not.toBe(original);
      }
    });
  });

  describe("cuando solo cambia el protocolo", () => {
    it("avisa una vez, después calla, la diaria lo recuerda y se olvida con la base nueva", async () => {
      const base = await oldBase(); // protocolo 29, todo lo demás igual
      const first = await cycle({ protocol: 30, base });
      expect(first.decision.code).toBe(1);
      expect(first.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
      expect(first.decision.alerts[0].message).toContain("protocol_version: valor 29 -> 30");
      // El aviso de protocolo no trae ledger: no es un ajuste de configuración.
      expect(first.decision.alerts[0].message).not.toContain("(ledger");
      expect(first.results[0].changes.map((c) => c.name)).toEqual(["protocol_version"]);

      const second = await cycle({ protocol: 30, base, memory: viaCache(first) });
      expect(second.decision).toEqual({ code: 0, alerts: [], errors: [], daily: false });
      expect(summarize(second.results)).toBe("testnet normal · línea base vieja: testnet, protocol_version");

      const daily = await cycle({ protocol: 30, base, memory: viaCache(second), daily: true });
      expect(daily.decision.alerts.map((a) => a.kind)).toEqual(["stale"]);

      const updated = buildBase(base, { testnet: await read({ targetMb: 7000, stateMb: 4311, protocol: 30 }) }, when);
      const clean = await cycle({ protocol: 30, base: updated, memory: viaCache(daily), daily: true });
      expect(clean.decision).toEqual({ code: 0, alerts: [], errors: [], daily: true });
      expect(clean.next.notified).toEqual({});
      expect(summarize(clean.results)).toBe("testnet normal");
    });

    it("si el protocolo vuelve a cambiar con la base todavía vieja, avisa de nuevo y dice que fue el protocolo", async () => {
      const base = await oldBase();
      const first = await cycle({ protocol: 30, base });
      const again = await cycle({ protocol: 31, base, memory: viaCache(first) });
      expect(again.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
      expect(again.results[0].sinceNotice).toEqual(["protocol_version"]);
      expect(again.decision.alerts[0].message).toContain("cambió otra vez desde el último aviso: protocol_version. ");
      expect(again.decision.alerts[0].message).toContain("protocol_version: valor 29 -> 31");
      expect((await cycle({ protocol: 31, base, memory: viaCache(again) })).decision.code).toBe(0);
    });
  });

  describe("lo avisado se olvida solo cuando cambia la línea base", () => {
    it("un RPC atrasado que dice una vez el estado viejo no provoca un segundo correo por el mismo estado", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      // Un RPC atrasado (o de respaldo) contesta una vez lo de antes: coincide con la línea base.
      const lagging = await cycle({ cpuConst: "434", base, memory: viaCache(first) });
      expect(lagging.decision).toEqual({ code: 0, alerts: [], errors: [], daily: false });
      expect(summarize(lagging.results)).toBe("testnet normal");
      expect(lagging.next.notified).toEqual(first.next.notified);
      // La corrida que sigue vuelve a ver el estado nuevo: es el mismo aviso, calla.
      const back = await cycle({ cpuConst: "706689", base, memory: viaCache(lagging) });
      expect(back.decision).toEqual({ code: 0, alerts: [], errors: [], daily: false });
      expect(summarize(back.results)).toBe(`testnet normal · línea base vieja: testnet, ${NAME}`);
    });

    it("una vuelta atrás legítima de la red deja una entrada inofensiva hasta la próxima base", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      const rolledBack = await cycle({ cpuConst: "434", base, memory: viaCache(first) });
      expect(Object.keys(rolledBack.next.notified)).toEqual(["testnet"]);
      // Si cambia otra vez al mismo estado, con la misma base, no vuelve a avisar...
      const again = await cycle({ cpuConst: "706689", base, memory: viaCache(rolledBack) });
      expect(again.decision.code).toBe(0);
      // ...y la diaria lo sigue recordando mientras la base esté vieja.
      const daily = await cycle({ cpuConst: "706689", base, memory: viaCache(again), daily: true });
      expect(daily.decision.alerts.map((a) => a.kind)).toEqual(["stale"]);
    });

    it("al commitear una base nueva se olvida: la corrida siguiente no avisa ni recuerda nada, tampoco la diaria", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      // `--actualizar-base --red testnet`: lo que la red dice hoy pasa a ser la línea base.
      const updated = buildBase(base, { testnet: await read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" }) }, when);
      const clean = await cycle({ cpuConst: "706689", base: updated, memory: viaCache(first), daily: true });
      expect(clean.decision).toEqual({ code: 0, alerts: [], errors: [], daily: true });
      expect(clean.next.notified).toEqual({});
      expect(summarize(clean.results)).toBe("testnet normal");
      expect(formatReport({ when, results: clean.results, decision: clean.decision })).toContain("Sin novedades:");
      // Si después la red cambia, es un aviso nuevo, contra la base nueva y sin «otra vez».
      const next = await cycle({ cpuConst: "800000", base: updated, memory: viaCache(clean) });
      expect(next.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
      expect(next.decision.alerts[0].message).not.toContain("otra vez");
      expect(next.next.notified.testnet.base).toBe(fingerprint(updated.networks.testnet.params));
    });

    it("una base nueva que la red todavía no alcanza es un aviso nuevo, contra esa base", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      // Alguien commiteó una base intermedia y la red sigue en otro estado.
      const middle = buildBase(base, { testnet: await read({ targetMb: 7000, stateMb: 4311, cpuConst: "800000" }) }, when);
      const run = await cycle({ cpuConst: "706689", base: middle, memory: viaCache(first) });
      expect(run.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
      expect(run.decision.alerts[0].message).not.toContain("otra vez");
      expect(run.results[0].sinceNotice).toBeNull();
      expect(run.next.notified.testnet.base).toBe(fingerprint(middle.networks.testnet.params));
      expect(run.next.notified.testnet.base).not.toBe(first.next.notified.testnet.base);
    });
  });

  describe("el segundo aviso dice qué cambió desde el último", () => {
    it("con la base todavía vieja y otro estado de la red, nombra los parámetros que cambiaron desde el último aviso", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      expect(first.results[0].sinceNotice).toBeNull();
      expect(first.decision.alerts[0].message).not.toContain("otra vez");
      // Cambia otro parámetro (los carriles); el de costo sigue como en el primer aviso.
      const second = await cycle({ cpuConst: "706689", lanes: 2100, base, memory: viaCache(first) });
      expect(second.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
      expect(second.results[0].sinceNotice).toEqual(["contract_execution_lanes"]);
      const message = second.decision.alerts[0].message;
      expect(message).toMatch(/^cambió otra vez desde el último aviso: contract_execution_lanes\. Contra la línea base, cambiaron 2 parámetros: /);
      expect(message).toContain("ledger_max_tx_count 2000 -> 2100");
      expect(message.endsWith(HINT_TESTNET)).toBe(true);
      // El tercer aviso se compara con el segundo.
      const third = await cycle({ cpuConst: "706689", lanes: 2200, base, memory: viaCache(second) });
      expect(third.results[0].sinceNotice).toEqual(["contract_execution_lanes"]);
      expect(third.next.notified.testnet.params.contract_execution_lanes).not.toBe(second.next.notified.testnet.params.contract_execution_lanes);
    });

    it("si cambia otra vez el mismo parámetro, lo nombra, y si cambian varios, los nombra a todos", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      const again = await cycle({ cpuConst: "800000", base, memory: viaCache(first) });
      expect(again.results[0].sinceNotice).toEqual([NAME]);
      expect(again.decision.alerts[0].message).toContain(`cambió otra vez desde el último aviso: ${NAME}. Contra la línea base, cambió 1 parámetro: `);
      const both = await cycle({ cpuConst: "900000", lanes: 2100, base, memory: viaCache(again) });
      expect(both.results[0].sinceNotice).toEqual([NAME, "contract_execution_lanes"]);
      expect(both.decision.alerts[0].message).toContain(`desde el último aviso: ${NAME}, contract_execution_lanes. `);
    });

    it("sin el detalle de cada parámetro en la memoria avisa igual, solo que sin esa frase", async () => {
      const base = await oldBase();
      const first = await cycle({ cpuConst: "706689", base });
      const { params, ...sinDetalle } = first.next.notified.testnet;
      expect(params).toBeDefined();
      const memory = parseState(serializeState({ ...first.next, notified: { testnet: sinDetalle } }));
      const run = await cycle({ cpuConst: "800000", base, memory });
      expect(run.decision.alerts.map((a) => a.kind)).toEqual(["params"]);
      expect(run.results[0].sinceNotice).toBeNull();
      expect(run.decision.alerts[0].message).not.toContain("otra vez");
    });
  });

  it("a lo largo de varias corridas avisa una vez por cada estado distinto de la red", async () => {
    const base = await oldBase();
    let memory = emptyState();
    const log = [];
    // [lo que dice la red, ¿es la corrida diaria?]
    const runs = [["434"], ["706689"], ["706689"], ["706689", true], ["706689"], ["800000"], ["800000"], ["434"], ["800000"], ["706689"]];
    for (const [cpuConst, daily = false] of runs) {
      const run = await cycle({ cpuConst, base, memory, daily });
      log.push([run.decision.code, run.decision.alerts.map((a) => a.kind).join()]);
      memory = viaCache(run);
    }
    expect(log).toEqual([
      [0, ""], // igual que la línea base
      [1, "params"], // cambia: el correo
      [0, ""], // lo mismo: calla
      [1, "stale"], // la corrida diaria lo recuerda
      [0, ""], // y la de media hora siguiente vuelve a callar
      [1, "params"], // cambia otra vez: otra huella, otro correo
      [0, ""],
      [0, ""], // un RPC atrasado, o una vuelta atrás: coincide con la base y no pasa nada
      [0, ""], // y el estado de antes vuelve: ya se avisó contra esta base, calla
      [1, "params"], // otro estado distinto: otro correo
    ]);
  });

  it("la huella es el sha256 de los parámetros, sin importar el orden de las llaves", () => {
    const a = { protocol_version: 29, x: { b: [1, 2], a: "1" } };
    expect(fingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(a)).toBe(fingerprint({ x: { a: "1", b: [1, 2] }, protocol_version: 29 }));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, protocol_version: 30 }));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, x: { a: "1", b: [2, 1] } }));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, x: { a: 1, b: [1, 2] } }));
    // El texto que se hashea es JSON con las llaves en orden y sin espacios: si cambia, cambian todas las huellas guardadas.
    expect(fingerprint({})).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    expect(fingerprint({ b: [1, 2], a: 1 })).toBe("8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874");
  });

  describe("la memoria en el archivo de la caché", () => {
    const print = fingerprint({ a: 1 });
    const other = fingerprint({ a: 2 });
    const analysis = (extra = {}) => ({
      network: "testnet",
      level: null,
      changes: [{ name: "a" }],
      fingerprint: print,
      baseFingerprint: other,
      paramFingerprints: { a: print },
      ...extra,
    });

    it("se guarda en una línea y se lee igual, con el estado, la base y cada parámetro", () => {
      const state = nextState(emptyState(), [analysis()], when);
      expect(state.notified).toEqual({ testnet: { state: print, base: other, params: { a: print } } });
      const text = serializeState(state);
      expect(text.split("\n")).toHaveLength(2);
      expect(parseState(text).notified).toEqual(state.notified);
    });

    it("lo que no es una huella se descarta: la entrada entera si falla el estado o la base, y de a uno los parámetros", () => {
      const lee = (notified) => parseState(JSON.stringify({ notified })).notified;
      const junk = [print.toUpperCase(), print.slice(1), 12, [print], null, undefined, ""];
      for (const mala of junk) {
        expect(lee({ testnet: { state: mala, base: other } })).toEqual({});
        expect(lee({ testnet: { state: print, base: mala } })).toEqual({});
      }
      expect(lee({ testnet: print, mainnet: 12, otra: null, vacia: {} })).toEqual({});
      expect(lee({ testnet: { state: print, base: other, params: { a: print, b: "no", c: 3, d: other } } })).toEqual({
        testnet: { state: print, base: other, params: { a: print, d: other } },
      });
      // Sin detalle de parámetros la entrada vale igual.
      expect(lee({ testnet: { state: print, base: other, params: "texto" } })).toEqual({ testnet: { state: print, base: other } });
      expect(lee({ testnet: { state: print, base: other } })).toEqual({ testnet: { state: print, base: other } });
    });

    it("la entrada se queda mientras la base sea la misma, aunque la red coincida con ella; se va con otra base", () => {
      const entry = { state: print, base: other, params: { a: print } };
      const previous = { levels: {}, notified: { testnet: entry } };
      // Coincide con la base (sin cambios) y la base es la misma: se queda.
      expect(nextState(previous, [analysis({ changes: [] })], when).notified.testnet).toEqual(entry);
      // Coincide con la base y la base es otra (alguien commiteó una nueva): se va.
      expect(nextState(previous, [analysis({ changes: [], baseFingerprint: print })], when).notified).toEqual({});
      // Sin línea base, o sin poder mirar: se queda.
      expect(nextState(previous, [analysis({ changes: null, baseFingerprint: null })], when).notified.testnet).toEqual(entry);
      expect(nextState(previous, [{ network: "testnet", error: "HTTP 503" }], when).notified.testnet).toEqual(entry);
    });
  });
});

describe("los nombres de los tipos de costo en el aviso", () => {
  const CPU = "contract_cost_params_cpu_instructions";
  const MEM = "contract_cost_params_memory_bytes";
  /** Una lista de costo de `n` elementos, todos iguales, como las de la red. */
  const list = (n) => Array.from({ length: n }, () => ({ ext: "v0", const_term: "1", linear_term: "2" }));

  it("el campo de una lista de costo lleva el nombre de su tipo; los demás se nombran como llegan", () => {
    expect(fieldLabel(CPU, "[9].const_term")).toBe("cpu[9] computeEd25519PubKey.const_term");
    expect(fieldLabel(MEM, "[10].linear_term")).toBe("mem[10] verifyEd25519Sig.linear_term");
    expect(fieldLabel(CPU, "[0].ext")).toBe("cpu[0] wasmInsnExec.ext");
    expect(fieldLabel(CPU, "[85].const_term")).toBe("cpu[85] bn254G1Msm.const_term");
    // Un índice que la lista no conoce se imprime como hasta ahora.
    expect(fieldLabel(CPU, "[86].const_term")).toBe("[86].const_term");
    expect(fieldLabel(MEM, "[200].const_term")).toBe("[200].const_term");
    // Otros parámetros, aunque sean listas, y un campo suelto.
    expect(fieldLabel("otra_lista", "[9].const_term")).toBe("[9].const_term");
    expect(fieldLabel("contract_ledger_cost_v0", "soroban_state_target_size_bytes")).toBe("soroban_state_target_size_bytes");
    expect(fieldLabel(CPU, "")).toBe("");
    expect(fieldLabel("contract_max_size_bytes", "")).toBe("");
  });

  it("los diez valores de la recalibración de testnet del 26 de octubre quedan nombrados", () => {
    // Posición en la lista → nombre, tal como cambiaron en el ledger 5.402.084.
    const cambiaron = {
      9: "computeEd25519PubKey",
      10: "verifyEd25519Sig",
      18: "int256Mul",
      20: "int256Pow",
      21: "int256Shift",
      54: "bls12381G1Mul",
      59: "bls12381G2Mul",
      75: "bn254G1ProjectiveToAffine",
      77: "bn254G1Mul",
    };
    for (const [index, name] of Object.entries(cambiaron)) expect(costTypeName(Number(index))).toBe(name);
    // Y lo que usa `draw`: sha256, hash_to_g1, pairing y decodificar/comprobar los puntos.
    const usaDraw = ["computeSha256Hash", "bls12381HashToG1", "bls12381Pairing", "bls12381DecodeFp", "bls12381EncodeFp"];
    for (const name of [...usaDraw, "bls12381G1CheckPointOnCurve", "bls12381G1CheckPointInSubgroup", "bls12381G2CheckPointOnCurve", "bls12381G2CheckPointInSubgroup"]) {
      expect(COST_TYPE_NAMES).toContain(name);
    }
  });

  it("describeChange nombra los campos de una lista de costo; el resto de la línea queda como estaba", () => {
    const base = { [CPU]: list(12), [MEM]: list(12) };
    const now = structuredClone(base);
    now[CPU][9].const_term = "5";
    now[CPU][10].const_term = "6";
    now[CPU][10].linear_term = "7";
    now[MEM][9].const_term = "8";
    const byName = Object.fromEntries(diffParams(base, now).map((c) => [c.name, c]));
    expect(describeChange(byName[CPU])).toBe(
      `${CPU}: cpu[9] computeEd25519PubKey.const_term 1 -> 5; cpu[10] verifyEd25519Sig.const_term 1 -> 6; cpu[10] verifyEd25519Sig.linear_term 2 -> 7`,
    );
    expect(describeChange(byName[MEM])).toBe(`${MEM}: mem[9] computeEd25519PubKey.const_term 1 -> 8`);
    // Con ledger de cambio y una lista más larga que la de nombres (86), el índice sin nombre sale como número.
    const full = list(86);
    const [change] = diffParams({ [CPU]: full }, { [CPU]: [...full, { ext: "v0", const_term: "3", linear_term: "4" }] }).map((c) => ({
      ...c,
      ledger: 5_402_084,
      minutesAgo: 120,
    }));
    expect(describeChange(change)).toBe(`${CPU} (ledger 5.402.084, hace 2 h): [86].ext (ausente) -> v0; [86].const_term (ausente) -> 3; [86].linear_term (ausente) -> 4`);
  });

  it("el texto corta a tres campos con «y N más», y el JSON trae todos, cada uno con su nombre", async () => {
    const net = await read();
    const baseList = list(22);
    const nowList = structuredClone(baseList);
    for (const [i, key] of [[9, "const_term"], [10, "const_term"], [10, "linear_term"], [18, "const_term"], [20, "const_term"]]) nowList[i][key] = "99";
    net.params[CPU] = nowList;
    const a = analyze("testnet", net, { params: { ...net.params, [CPU]: baseList } });
    const text = describeChange(a.changes.find((c) => c.name === CPU));
    expect(text).toContain("cpu[9] computeEd25519PubKey.const_term 1 -> 99; cpu[10] verifyEd25519Sig.const_term 1 -> 99; cpu[10] verifyEd25519Sig.linear_term 2 -> 99 y 2 más");
    expect(text).not.toContain("int256Mul");
    const json = toJson({ when: new Date(0), results: [a], decision: decide([a]) });
    const labels = json.networks.testnet.changes.find((c) => c.name === CPU).fields.map((f) => f.label);
    expect(labels).toEqual([
      "cpu[9] computeEd25519PubKey.const_term",
      "cpu[10] verifyEd25519Sig.const_term",
      "cpu[10] verifyEd25519Sig.linear_term",
      "cpu[18] int256Mul.const_term",
      "cpu[20] int256Pow.const_term",
    ]);
    // El mensaje del aviso trae los nombres, no los índices sueltos.
    expect(decide([a]).alerts[0].message).toContain("cpu[9] computeEd25519PubKey.const_term 1 -> 99");
    expect(decide([a]).alerts[0].message).not.toMatch(/ \[9\]\./);
  });
});

describe("la pista para actualizar la base", () => {
  const when = new Date("2026-10-26T19:00:00Z");
  const NAME = "contract_cost_params_cpu_instructions";
  const hint = (network) => `Si el cambio es legítimo: node scripts/vigilar-red.mjs --actualizar-base --red ${network} y commitear la línea base.`;
  const bothChanged = async (memory) => {
    const oldTestnet = await read({ targetMb: 7000, stateMb: 4311 });
    const oldMainnet = await read();
    const base = { networks: { testnet: { params: oldTestnet.params }, mainnet: { params: oldMainnet.params } } };
    const reads = {
      testnet: await read({ targetMb: 7000, stateMb: 4311, cpuConst: "706689" }),
      mainnet: await read({ cpuConst: "900000" }),
    };
    return { base, reads, run: (daily = false, mem = memory) => evaluate({ names: ["testnet", "mainnet"], reads, base, memory: mem, daily, when }) };
  };

  it("el aviso nombra la red que cambió, y la misma frase va en la anotación de GitHub", async () => {
    const { run } = await bothChanged();
    const first = run();
    expect(first.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "params"], ["mainnet", "params"]]);
    for (const a of first.decision.alerts) {
      expect(a.message.endsWith(hint(a.network))).toBe(true);
      expect(annotation(`${a.network}: ${a.message}`)).toContain(`--actualizar-base --red ${a.network} y commitear la línea base.`);
    }
    // En el log, una vez por red: dentro del aviso, sin repetirla aparte.
    const report = formatReport({ when, results: first.results, decision: first.decision });
    expect(report.split("\n").filter((l) => l.includes("--actualizar-base"))).toHaveLength(2);
    expect(report).toContain(`ALERTA testnet: cambió 1 parámetro: ${NAME}`);
    expect(report).not.toContain("[--red testnet|mainnet]");
  });

  it("el recordatorio diario también la lleva, y la corrida callada la imprime aparte, una línea por red", async () => {
    const { run } = await bothChanged();
    const first = run();
    const memory = parseState(serializeState(first.next));
    const daily = run(true, memory);
    expect(daily.decision.alerts.map((a) => [a.network, a.kind])).toEqual([["testnet", "stale"], ["mainnet", "stale"]]);
    for (const a of daily.decision.alerts) expect(a.message.endsWith(hint(a.network))).toBe(true);
    const quiet = run(false, memory);
    expect(quiet.decision.code).toBe(0);
    const lines = formatReport({ when, results: quiet.results, decision: quiet.decision }).split("\n");
    expect(lines.filter((l) => l.includes("--actualizar-base"))).toEqual([hint("testnet"), hint("mainnet")]);
  });

  it("si cambió una sola de las dos redes, la pista es solo de esa", async () => {
    const oldTestnet = await read({ targetMb: 7000, stateMb: 4311 });
    const oldMainnet = await read();
    const base = { networks: { testnet: { params: oldTestnet.params }, mainnet: { params: oldMainnet.params } } };
    const reads = { testnet: oldTestnet, mainnet: await read({ cpuConst: "900000" }) };
    const run = evaluate({ names: ["testnet", "mainnet"], reads, base, when });
    const report = formatReport({ when, results: run.results, decision: run.decision });
    expect(report.split("\n").filter((l) => l.includes("--actualizar-base"))).toHaveLength(1);
    expect(report).toContain("--actualizar-base --red mainnet");
    expect(report).not.toContain("--actualizar-base --red testnet");
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

describe("el guion real, como proceso, con un RPC falso", () => {
  const guion = fileURLToPath(new URL("../vigilar-red.mjs", import.meta.url));
  const rpcFalso = new URL("./vigilar-red-rpc-falso.mjs", import.meta.url).href;
  const cambio = { testnet: { contract_max_size_bytes: "cambiado-por-la-prueba" } };
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tinkazo-vigilar-red-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Lanza `scripts/vigilar-red.mjs` tal cual, con el RPC falso cargado antes de que arranque. */
  function lanzar(args, cambios = {}, env = {}) {
    const salida = join(dir, "github-output.txt");
    writeFileSync(salida, "");
    const r = spawnSync(process.execPath, ["--import", rpcFalso, guion, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, VIGILAR_FALSO_CAMBIOS: JSON.stringify(cambios), GITHUB_OUTPUT: salida, GITHUB_ACTIONS: "", ...env },
    });
    expect(r.error).toBeUndefined();
    return { codigo: r.status, texto: r.stdout, errores: r.stderr, salida: readFileSync(salida, "utf8") };
  }

  it("falla la primera vez que ve el cambio, calla las siguientes y deja el archivo de la caché escrito", () => {
    const memoria = join(dir, "estado-red", "niveles.json"); // la carpeta no existe: el guion la crea
    const args = ["--anterior", memoria, "--guardar", memoria];

    // La red igual que la línea base commiteada: nada que avisar, y el archivo queda con los niveles.
    const igual = lanzar(args);
    expect(igual.codigo).toBe(0);
    expect(igual.texto).toContain("Sin novedades: ningún parámetro cambió y ningún nivel se movió.");
    expect(igual.salida).toBe("resumen=testnet normal · mainnet normal\ncodigo=0\n");
    expect(JSON.parse(readFileSync(memoria, "utf8"))).toMatchObject({ version: 1, levels: { testnet: null, mainnet: null }, notified: {} });

    // Cambia un parámetro de testnet: la primera corrida falla (el correo) y guarda lo que avisó.
    const primera = lanzar(args, cambio, { GITHUB_ACTIONS: "true" });
    expect(primera.codigo).toBe(1);
    expect(primera.texto.split("\n")[0]).toBe("Red de Stellar · testnet normal · mainnet normal · PARÁMETROS CAMBIADOS");
    expect(primera.texto).toContain("ALERTA testnet: cambió 1 parámetro: contract_max_size_bytes");
    // La pista con la red concreta sale en el log y en la anotación de GitHub.
    expect(primera.texto).toContain("--actualizar-base --red testnet y commitear la línea base.");
    expect(primera.texto).toMatch(/^::error title=Red de Stellar::testnet: cambió 1 parámetro: .*--actualizar-base --red testnet y commitear/m);
    expect(primera.salida).toBe("resumen=testnet normal · mainnet normal · PARÁMETROS CAMBIADOS\ncodigo=1\n");
    const guardado = JSON.parse(readFileSync(memoria, "utf8"));
    expect(guardado.notified.testnet.state).toMatch(/^[0-9a-f]{64}$/);
    expect(guardado.notified.testnet.base).toMatch(/^[0-9a-f]{64}$/);
    expect(guardado.notified.mainnet).toBeUndefined();
    expect(readFileSync(memoria, "utf8").trimEnd().split("\n")).toHaveLength(1);

    // La misma red otra vez: pasa, y el nombre del paso dice que la línea base está vieja.
    const segunda = lanzar(args, cambio);
    expect(segunda.codigo).toBe(0);
    expect(segunda.salida).toBe("resumen=testnet normal · mainnet normal · línea base vieja: testnet, contract_max_size_bytes\ncodigo=0\n");
    expect(segunda.texto).toContain("Sin novedades nuevas: la línea base de testnet sigue vieja y ya se avisó");
    expect(JSON.parse(readFileSync(memoria, "utf8")).notified).toEqual(guardado.notified);

    // La corrida diaria la recuerda.
    const diaria = lanzar([...args, "--diario"], cambio);
    expect(diaria.codigo).toBe(1);
    expect(diaria.texto).toContain("ALERTA testnet: recordatorio diario: la línea base sigue vieja");
    expect(diaria.salida).toContain("codigo=1\n");

    // Un RPC atrasado dice una vez lo de antes, y vuelve lo nuevo: no hay un segundo correo por el mismo estado.
    expect(lanzar(args).codigo).toBe(0);
    expect(lanzar(args, cambio).codigo).toBe(0);
    expect(JSON.parse(readFileSync(memoria, "utf8")).notified).toEqual(guardado.notified);
  });

  it("sin archivo de memoria se comporta como un detector sin memoria: cada corrida avisa", () => {
    expect(lanzar([], cambio).codigo).toBe(1);
    expect(lanzar([], cambio).codigo).toBe(1);
  });

  it("si cambia el protocolo en las dos redes, avisa de las dos, una pista por red, y después calla", () => {
    const memoria = join(dir, "estado-protocolo", "niveles.json");
    const args = ["--anterior", memoria, "--guardar", memoria];
    const protocolo = { testnet: { protocol_version: 99 }, mainnet: { protocol_version: 99 } };
    // El protocolo de la línea base commiteada, sea el que sea hoy.
    const base = JSON.parse(readFileSync(new URL("../vigilar-red.base.json", import.meta.url), "utf8"));
    const primera = lanzar(args, protocolo);
    expect(primera.codigo).toBe(1);
    for (const red of ["testnet", "mainnet"]) {
      expect(primera.texto).toContain(`ALERTA ${red}: cambió 1 parámetro: protocol_version: valor ${base.networks[red].params.protocol_version} -> 99`);
    }
    expect(primera.texto.split("\n").filter((l) => l.includes("--actualizar-base"))).toHaveLength(2);
    expect(lanzar(args, protocolo).salida).toBe("resumen=testnet normal · mainnet normal · línea base vieja: testnet, protocol_version; mainnet, protocol_version\ncodigo=0\n");
  });
});
