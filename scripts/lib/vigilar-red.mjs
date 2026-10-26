/**
 * Vigilancia de la red de Stellar: la lógica, sin tocar la red.
 *
 * El 25 de octubre de 2026 el sello de testnet pasó de 0,7 a 69 XLM sin que
 * cambiara nada nuestro: el estado vivo de Soroban cruzó su objetivo
 * (`soroban_state_target_size_bytes`, entonces 4.000 MB) y la renta por KB se
 * multiplicó. A las 13:34 la SDF subió ese objetivo a 7.000 MB sin anunciarlo en
 * ningún lado. Esto es lo que se mira para enterarse a tiempo.
 *
 * La renta por KB sale del promedio de la ventana de tamaños del estado
 * (30 muestras, una cada 64 ledgers) frente al objetivo: piso hasta 2/3 del
 * objetivo, ×10 al 100 %, ×1.360 al 101 %. Ese promedio es el mismo número que
 * cada ledger trae como `total_byte_size_of_live_soroban_state`, así que el de
 * hoy se calcula con la ventana (una lectura chica) y el de hace 24 horas se lee
 * del ledger de entonces (`getLedgers` guarda 7 días).
 *
 * Para que el aviso sirva, la corrida falla solo cuando hay algo nuevo que
 * decir: un parámetro cambió, el nivel de alguna red se movió respecto de la
 * corrida anterior (hacia arriba o hacia abajo) o está en rojo. Un nivel que
 * sigue igual no hace fallar la corrida (salvo el recordatorio diario, desde
 * naranja): un correo cada media hora se acaba silenciando. El nivel anterior
 * lo guarda quien llama (en GitHub, la caché de Actions) en un archivo chico.
 *
 * Todo acá es puro y se prueba sin red. `readNetwork` recibe la función que
 * habla con el RPC (`makeCaller` hace la de verdad, con reintentos y RPC de
 * respaldo), y `scripts/vigilar-red.mjs` junta todo.
 *
 * Un MB son 10^6 bytes, como en la documentación de la red (3.000 MB = 3 GB).
 */

import { LEVELS, RED_PERCENT_OF_TARGET } from "./umbrales-red.mjs";

/**
 * Los RPC públicos de cada red, en orden de preferencia. El primero de mainnet
 * es el de `src/stellar/config.ts`. Los otros dos salen de la lista de
 * proveedores de la documentación de Stellar y el 25 de octubre de 2026
 * devolvían lo mismo que el primero: los mismos parámetros, el mismo estado y el
 * mismo ledger de ayer. Testnet usa solo el de la SDF.
 */
export const NETWORKS = {
  testnet: { rpcUrls: ["https://soroban-testnet.stellar.org"] },
  mainnet: {
    rpcUrls: ["https://mainnet.sorobanrpc.com", "https://rpc.lightsail.network/", "https://rpc.ankr.com/stellar_soroban"],
  },
};

/** Un ledger cada cinco segundos: 17.280 por día. */
export const LEDGERS_PER_DAY = 17_280;

const BYTES_PER_MB = 1_000_000;

/**
 * Los niveles por red, en MB de estado (promedio de la ventana), y el seguro del
 * porcentaje del objetivo: viven en `src/stellar/red-umbrales.json`, el mismo
 * archivo con el que decide la app antes de sellar (`src/stellar/chequeo-red.ts`),
 * y llegan por `./umbrales-red.mjs`, que lo comprueba y lanza con el motivo si no
 * tiene la forma que el detector espera. Se vuelven a exportar acá para quien los
 * importa de este módulo (`vigilar-red.test.mjs`).
 *
 * Mainnet (objetivo 3.000 MB): amarillo a 2.000 (2/3, donde la renta deja el
 * piso), naranja a 2.500 (el sello ya cuesta ≈ 0,5 XLM) y rojo a 2.850 (quedan
 * 150 MB, de 13 a 19 horas al ritmo más alto de la semana). Testnet (objetivo
 * 7.000 MB): un solo nivel, rojo a 6.000. Cambiar el objetivo exige un
 * proceso de la red que tarda de 13 a 17 días; por eso se avisa con tiempo.
 *
 * `RED_PERCENT_OF_TARGET` es el seguro por si el objetivo cambia: al 95 % del
 * objetivo vigente es rojo aunque los niveles no lo digan (con los objetivos de
 * hoy no cambia nada: mainnet 95 % = 2.850 y testnet 95 % = 6.650, más que 6.000).
 */
export { LEVELS, RED_PERCENT_OF_TARGET };

const LEVEL_NAMES = new Set(["amarillo", "naranja", "rojo"]);

/** Los ajustes que cambian solos en cada ledger: no son parámetros. */
const IGNORED_SETTINGS = new Set(["live_soroban_state_size_window", "eviction_iterator"]);

/**
 * El id más alto de ajuste que se pide. El protocolo 29 usa del 0 al 17 y el 19
 * (el 18 no existe); el RPC acepta hasta el 20 y rechaza el 21 con «cannot
 * unmarshal key value». Un id nuevo llega con un protocolo nuevo, que ya salta
 * como cambio de `protocol_version`: ahí se sube este número.
 */
const MAX_SETTING_ID = 20;

/** `LedgerKey` de un `ConfigSetting`, en base64: tipo 8 y el id, 4 bytes cada uno. */
export function settingKey(id) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(8, 0);
  buf.writeUInt32BE(id, 4);
  return buf.toString("base64");
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * La función que habla con el RPC de una red: `call(método, parámetros,
 * { attempts })` devuelve el `result` o lanza un error. Cada RPC tiene sus malos
 * ratos, así que cada pedido se intenta `attempts` veces (tres, salvo que se
 * pidan menos) con una espera creciente, y si el RPC no contesta se pasa al
 * siguiente de la lista. El que contesta queda como el activo para los pedidos
 * que siguen (no se vuelve a esperar a uno caído). Un error de parámetros o de
 * método (-32602, -32601) no se reintenta ni se pasa a otro RPC: pedir lo mismo
 * da lo mismo. `call.endpoint()` dice cuál quedó activo y si es de respaldo.
 */
export function makeCaller(urls, { fetchImpl = globalThis.fetch, sleep = defaultSleep } = {}) {
  let active = 0;

  async function request(url, method, params, timeoutMs) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // no es JSON: se cuenta abajo según el estado HTTP
    }
    if (body?.error) {
      const error = new Error(body.error.message ?? "error del RPC");
      error.permanent = body.error.code === -32602 || body.error.code === -32601;
      throw error;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (body === null) throw new Error("la respuesta no es JSON");
    return body.result;
  }

  async function call(method, params, { attempts = 3 } = {}) {
    // `getLedgers` trae el ledger entero (en mainnet, varios MB); lo demás es chico.
    const timeoutMs = method === "getLedgers" ? 40_000 : 20_000;
    const order = [active, ...urls.keys()].filter((index, i, all) => all.indexOf(index) === i);
    const failures = [];
    for (const index of order) {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const result = await request(urls[index], method, params, timeoutMs);
          active = index;
          return result;
        } catch (e) {
          if (e.permanent) throw new Error(`${method}: ${e.message}`);
          if (attempt < attempts) await sleep(attempt * 3000);
          else failures.push({ host: hostOf(urls[index]), message: e.message });
        }
      }
    }
    const detail = urls.length === 1 ? failures[0].message : failures.map((f) => `${f.host}: ${f.message}`).join("; ");
    throw new Error(`${method}: ${detail}`);
  }

  call.endpoint = () => ({ url: urls[active], backup: active !== 0 });
  return call;
}

/** Promedio entero de la ventana, en bytes: la misma división que hace stellar-core. */
export function averageBytes(window) {
  if (!Array.isArray(window) || window.length === 0) {
    throw new Error("la ventana del tamaño del estado viene vacía");
  }
  const sum = window.reduce((acc, x) => acc + BigInt(x), 0n);
  return sum / BigInt(window.length);
}

export const bytesToMb = (bytes) => Number(bytes) / BYTES_PER_MB;

/**
 * Separa lo que devuelve `getLedgerEntries` (con `xdrFormat: "json"`) en los
 * parámetros, el ledger donde cambió cada uno por última vez y la ventana del
 * estado. El nombre del ajuste es la variante del XDR: `contract_ledger_cost_v0`,
 * `state_archival`, etc. La ventana y el iterador de desalojo no son parámetros.
 */
export function parseSettings(entries) {
  const params = {};
  const modified = {};
  let window = null;
  for (const entry of entries ?? []) {
    const name = entry?.keyJson?.config_setting?.config_setting_id;
    const data = entry?.dataJson?.config_setting;
    if (typeof name !== "string" || !data || typeof data !== "object") continue;
    const value = name in data ? data[name] : Object.values(data)[0];
    if (name === "live_soroban_state_size_window") {
      window = value;
      continue;
    }
    if (IGNORED_SETTINGS.has(name)) continue;
    params[name] = value;
    modified[name] = Number(entry.lastModifiedLedgerSeq);
  }
  return { params, modified, window };
}

/** `{ a: { b: 1 } }` → `{ "a.b": 1 }`; las listas llevan el índice: `x[3].y`. */
export function flatten(value, path = "", out = {}) {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out[path] = value;
  }
  return out;
}

/**
 * Qué parámetros cambiaron entre la línea base y lo que dice la red hoy.
 * Cada cambio nombra el parámetro y, campo por campo, el antes y el ahora.
 */
export function diffParams(base, current) {
  const names = [...new Set([...Object.keys(base ?? {}), ...Object.keys(current ?? {})])].sort();
  const changes = [];
  for (const name of names) {
    if (!(name in (base ?? {}))) {
      changes.push({ name, kind: "added", fields: [{ path: "", before: undefined, after: current[name] }], total: 1 });
    } else if (!(name in (current ?? {}))) {
      changes.push({ name, kind: "removed", fields: [{ path: "", before: base[name], after: undefined }], total: 1 });
    } else {
      const before = flatten(base[name]);
      const after = flatten(current[name]);
      const fields = [];
      for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[path]) !== JSON.stringify(after[path])) {
          fields.push({ path, before: before[path], after: after[path] });
        }
      }
      if (fields.length > 0) changes.push({ name, kind: "changed", fields, total: fields.length });
    }
  }
  return changes;
}

/** Los umbrales de una red; el rojo nunca pasa del 95 % del objetivo vigente. */
export function thresholdsFor(network, targetMb = null) {
  const levels = (LEVELS[network] ?? []).map((l) => ({ ...l }));
  if (levels.length > 0 && targetMb) {
    const last = levels[levels.length - 1];
    last.mb = Math.min(last.mb, (targetMb * RED_PERCENT_OF_TARGET) / 100);
  }
  return levels;
}

/** El nivel más alto que alcanza el estado, o null si está por debajo de todos. */
export function levelFor(network, stateMb, targetMb = null) {
  let level = null;
  for (const l of thresholdsFor(network, targetMb)) if (stateMb >= l.mb) level = l.name;
  return level;
}

/** MB por hora entre dos mediciones; null si falta alguna o no pasó el tiempo. */
export function slopeMbPerHour(nowMb, nowTime, thenMb, thenTime) {
  if (![nowMb, nowTime, thenMb, thenTime].every(Number.isFinite)) return null;
  const hours = (nowTime - thenTime) / 3600;
  return hours > 0 ? (nowMb - thenMb) / hours : null;
}

/** Horas hasta llegar a `goalMb` al ritmo dado: 0 si ya pasó, null si no se acerca. */
export function hoursUntil(stateMb, goalMb, slope) {
  if (stateMb >= goalMb) return 0;
  if (slope === null || !(slope > 0)) return null;
  return (goalMb - stateMb) / slope;
}

/**
 * Todo lo que se necesita de una red, pidiéndolo con `call(método, parámetros,
 * { attempts })`, que devuelve el `result` del RPC o lanza un error (`attempts`
 * es cuántas veces insistir; sin él, las que quiera quien llama). La pendiente de 24 horas es
 * opcional: si el RPC no entrega el ledger de ayer, `past.error` lo dice y el
 * resto sigue valiendo.
 */
export async function readNetwork(call) {
  const latest = await call("getLatestLedger", {});
  const ledger = Number(latest.sequence);
  // En fila y no a la vez: si falla la lectura de los ajustes, no queda un
  // pedido de ledger colgado alargando la salida del guion.
  const settings = await readSettings(call);
  const past = await readPast(call, ledger);
  const { params, modified, window } = parseSettings(settings.entries);
  if (Object.keys(params).length === 0 || !window) {
    throw new Error("la respuesta del RPC no trae los parámetros ni la ventana del estado (¿cambió el formato?)");
  }
  const protocol = Number(latest.protocolVersion);
  const cost = params.contract_ledger_cost_v0;
  const targetBytes = cost?.soroban_state_target_size_bytes;
  return {
    protocol,
    ledger,
    closeTime: Number(latest.closeTime),
    stateMb: bytesToMb(averageBytes(window)),
    targetMb: targetBytes === undefined ? null : bytesToMb(BigInt(targetBytes)),
    params: { protocol_version: protocol, ...params },
    modified,
    past,
    // Cuál RPC contestó al final y si es de respaldo (solo si `call` lo sabe decir).
    rpc: typeof call.endpoint === "function" ? call.endpoint() : null,
  };
}

async function readSettings(call) {
  let count = MAX_SETTING_ID + 1;
  for (;;) {
    try {
      return await call("getLedgerEntries", {
        keys: Array.from({ length: count }, (_, id) => settingKey(id)),
        xdrFormat: "json",
      });
    } catch (e) {
      // Un RPC más viejo que el protocolo rechaza los ids que no conoce y dice
      // cuál es el primero («... at index 17»): se vuelve a pedir hasta ahí.
      const index = Number(/at index (\d+)/.exec(e.message)?.[1]);
      if (!(index > 0 && index < count)) throw e;
      count = index;
    }
  }
}

/**
 * El promedio de la ventana en el ledger de hace un día, de su metadato. Es solo
 * información, así que no se insiste: dos intentos y, si no sale, sin pendiente.
 */
async function readPast(call, latestLedger) {
  try {
    const res = await call(
      "getLedgers",
      { startLedger: latestLedger - LEDGERS_PER_DAY, pagination: { limit: 1 }, xdrFormat: "json" },
      { attempts: 2 },
    );
    const ledger = res?.ledgers?.[0];
    const meta = ledger?.metadataJson ? Object.values(ledger.metadataJson)[0] : null;
    const bytes = meta?.total_byte_size_of_live_soroban_state;
    if (bytes === undefined || bytes === null) throw new Error("ese ledger no trae el tamaño del estado");
    return { ledger: Number(ledger.sequence), closeTime: Number(ledger.ledgerCloseTime), stateMb: bytesToMb(BigInt(bytes)) };
  } catch (e) {
    return { error: e.message };
  }
}

/** Minutos que tienen `ledgers` ledgers, a 5 segundos cada uno. */
const ledgersToMinutes = (ledgers) => (ledgers * 5) / 60;

/**
 * Lo que sale de una lectura: porcentaje, pendiente de 24 horas, horas hasta el
 * rojo, nivel (y el que tenía en la corrida anterior, `previousLevel`) y cambios
 * contra la línea base (null si no hay línea base).
 */
export function analyze(network, read, baseNetwork, previousLevel = null) {
  const percent = read.targetMb ? (read.stateMb / read.targetMb) * 100 : null;
  const hasPast = read.past && !read.past.error;
  const slope = hasPast ? slopeMbPerHour(read.stateMb, read.closeTime, read.past.stateMb, read.past.closeTime) : null;
  const redMb = thresholdsFor(network, read.targetMb).at(-1).mb;
  const changes = baseNetwork
    ? diffParams(baseNetwork.params, read.params).map((c) => ({
        ...c,
        ledger: read.modified[c.name] ?? null,
        minutesAgo: read.modified[c.name] ? Math.round(ledgersToMinutes(read.ledger - read.modified[c.name])) : null,
      }))
    : null;
  return {
    network,
    protocol: read.protocol,
    ledger: read.ledger,
    rpc: read.rpc ?? null,
    stateMb: read.stateMb,
    targetMb: read.targetMb,
    percent,
    slopeMbPerHour: slope,
    slopeHours: hasPast ? (read.closeTime - read.past.closeTime) / 3600 : null,
    pastLedger: hasPast ? read.past.ledger : null,
    pastError: read.past?.error ?? null,
    redMb,
    hoursToRed: hoursUntil(read.stateMb, redMb, slope),
    level: levelFor(network, read.stateMb, read.targetMb),
    levelBefore: LEVEL_NAMES.has(previousLevel) ? previousLevel : null,
    watched: Object.keys(read.params).length - 1,
    changes,
  };
}

/** Los números a la española: punto de miles y coma decimal, igual en cualquier máquina. */
export function fmt(n, decimals = 0) {
  const text = Math.abs(n).toFixed(decimals);
  const [int, frac] = text.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const negative = n < 0 && Number(text) !== 0;
  return `${negative ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

const fmtSigned = (n, decimals) => `${n >= 0 && Number(n.toFixed(decimals)) !== 0 ? "+" : ""}${fmt(n, decimals)}`;

export function fmtDuration(hours) {
  if (hours === null || hours === undefined) return null;
  if (hours < 1) return "menos de 1 h";
  if (hours < 48) return `${fmt(hours, 0)} h`;
  if (hours / 24 >= 365) return "más de un año";
  return `${fmt(hours, 0)} h (${fmt(hours / 24, 1)} días)`;
}

function fmtAge(minutes) {
  if (minutes === null) return "";
  if (minutes < 120) return `hace ${fmt(minutes)} min`;
  if (minutes < 48 * 60) return `hace ${fmt(minutes / 60)} h`;
  return `hace ${fmt(minutes / 1440)} días`;
}

function show(value) {
  if (value === undefined) return "(ausente)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Una línea por parámetro cambiado: el nombre, los primeros campos y cuándo cambió. */
export function describeChange(change) {
  const when = change.ledger ? ` (ledger ${fmt(change.ledger)}, ${fmtAge(change.minutesAgo)})` : "";
  if (change.kind === "added") return `${change.name}${when}: parámetro nuevo, vale ${show(change.fields[0].after)}`;
  if (change.kind === "removed") return `${change.name}: ya no está en la red (valía ${show(change.fields[0].before)})`;
  const shown = change.fields
    .slice(0, 3)
    .map((f) => `${f.path || "valor"} ${show(f.before)} -> ${show(f.after)}`)
    .join("; ");
  const more = change.total > 3 ? ` y ${change.total - 3} más` : "";
  return `${change.name}${when}: ${shown}${more}`;
}

/**
 * Veredicto de una corrida. `results` trae, por red, un análisis (`analyze`) o
 * `{ network, error }` si no se pudo preguntar. Código 1 (falla y avisa) solo si:
 *   - cambió un parámetro de costo o el protocolo (`params`);
 *   - el nivel de la red se movió respecto de la corrida anterior, hacia arriba
 *     o hacia abajo, incluido salir de un nivel y volver a «normal» (`level`);
 *   - la red está en rojo, en cada corrida (`red`);
 *   - es el recordatorio diario (`daily`) y la red está en naranja (`daily`).
 * El mismo nivel que antes, amarillo o naranja, pasa con código 0. Código 2 si
 * solo hubo redes que no se pudieron mirar (ni tras los reintentos y el RPC de
 * respaldo) o falta la línea base: el vigilante ciego también avisa. Una alarma
 * pesa más que un error: si hay las dos, es 1.
 */
export function decide(results, { daily = false } = {}) {
  const alerts = [];
  const errors = [];
  for (const r of results) {
    if (r.error) {
      errors.push({ network: r.network, message: r.error });
      continue;
    }
    if (r.changes === null) {
      errors.push({ network: r.network, message: "no hay línea base de esta red (node scripts/vigilar-red.mjs --actualizar-base)" });
    } else if (r.changes.length > 0) {
      const count = r.changes.length === 1 ? "cambió 1 parámetro" : `cambiaron ${r.changes.length} parámetros`;
      alerts.push({ network: r.network, kind: "params", message: `${count}: ${r.changes.map(describeChange).join(" | ")}` });
    }
    const before = r.levelBefore ?? null;
    const detail =
      `el estado está en ${fmt(r.stateMb, 1)} MB de ${r.targetMb ? fmt(r.targetMb) : "?"} MB` +
      (r.percent === null ? "" : ` (${fmt(r.percent, 1)} %)`);
    if (r.level !== before) {
      alerts.push({
        network: r.network,
        kind: "level",
        level: r.level,
        before,
        message: `nivel: pasó de ${before ?? "normal"} a ${r.level ?? "normal"}: ${detail}`,
      });
    } else if (r.level === "rojo") {
      alerts.push({ network: r.network, kind: "red", level: r.level, before, message: `sigue en rojo: ${detail}` });
    } else if (daily && r.level === "naranja") {
      alerts.push({
        network: r.network,
        kind: "daily",
        level: r.level,
        before,
        message: `recordatorio diario: sigue en naranja: ${detail}`,
      });
    }
  }
  return { code: alerts.length > 0 ? 1 : errors.length > 0 ? 2 : 0, alerts, errors, daily };
}

/**
 * El nivel de cada red en una línea: va primera en el log y es el nombre del paso
 * en GitHub. «mainnet amarillo (igual que antes) · testnet normal».
 */
export function summarize(results) {
  const parts = results.map((r) => {
    if (r.error) return `${r.network} sin mirar`;
    const before = r.levelBefore ?? null;
    if (r.level === before) return r.level ? `${r.network} ${r.level} (igual que antes)` : `${r.network} normal`;
    return `${r.network} ${r.level ?? "normal"} (antes ${before ?? "normal"})`;
  });
  if (results.some((r) => r.changes?.length > 0)) parts.push("PARÁMETROS CAMBIADOS");
  return parts.join(" · ");
}

/** El nivel que se guarda entre corridas: `{ mainnet: "amarillo" }`; lo que no se entiende se descarta. */
export function parseState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  const levels = {};
  for (const [network, level] of Object.entries(data?.levels ?? {})) {
    if (LEVEL_NAMES.has(level)) levels[network] = level;
  }
  return levels;
}

/**
 * El estado para la próxima corrida: el nivel de cada red que se pudo mirar hoy
 * (null es «normal»); una red que no se pudo mirar conserva el de antes, así un
 * RPC caído un rato no inventa un cambio de nivel cuando vuelve.
 */
export function nextState(previous, results, when) {
  const levels = { ...previous };
  for (const r of results) if (!r.error) levels[r.network] = r.level;
  return { version: 1, when: when.toISOString(), levels };
}

export const serializeState = (state) => `${JSON.stringify(state)}\n`;

/** La anotación de GitHub Actions: se ve arriba de la corrida, sin abrir el log. */
export function annotation(text) {
  return `::error title=Red de Stellar::${text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`;
}

function levelText(r) {
  const before = r.levelBefore ?? null;
  const name = r.level ? `NIVEL ${r.level.toUpperCase()}` : "normal";
  if (r.level === before) return r.level ? `${name} (igual que antes)` : name;
  return `${name} (antes ${before ?? "normal"})`;
}

/** El texto de la corrida: el nivel en la primera línea, un bloque corto por red y el veredicto. */
export function formatReport({ when, results, decision }) {
  const stamp = when.toISOString().slice(0, 16).replace("T", " ");
  const lines = [
    `Red de Stellar · ${summarize(results)}`,
    `Vigilancia ${stamp} UTC${decision.daily ? " · recordatorio diario" : ""}`,
    "",
  ];
  for (const r of results) {
    if (r.error) {
      lines.push(`${r.network}: NO SE PUDO MIRAR (${r.error})`, "");
      continue;
    }
    const backup = r.rpc?.backup ? ` · RPC de respaldo ${new URL(r.rpc.url).host}` : "";
    lines.push(`${r.network} · protocolo ${r.protocol} · ledger ${fmt(r.ledger)}${backup}`);
    const pct = r.percent === null ? "" : ` (${fmt(r.percent, 1)} %)`;
    lines.push(`  estado      ${fmt(r.stateMb, 1)} MB de ${r.targetMb ? `${fmt(r.targetMb)} MB` : "?"}${pct} · ${levelText(r)}`);
    if (r.slopeMbPerHour === null) {
      lines.push(`  pendiente   no disponible${r.pastError ? ` (${r.pastError})` : ""}`);
    } else {
      lines.push(`  pendiente   ${fmtSigned(r.slopeMbPerHour, 2)} MB/h en las últimas ${fmt(r.slopeHours, 1)} h (desde el ledger ${fmt(r.pastLedger)})`);
    }
    const left = r.redMb - r.stateMb;
    const toRed =
      r.hoursToRed === 0
        ? "ya está en rojo"
        : r.hoursToRed === null
          ? `faltan ${fmt(left, 1)} MB; no se acerca (el estado ${r.slopeMbPerHour === null ? "no tiene pendiente" : "baja o no cambia"})`
          : `faltan ${fmt(left, 1)} MB, ${fmtDuration(r.hoursToRed)} al ritmo de hoy`;
    lines.push(`  hasta rojo  ${fmt(r.redMb)} MB: ${toRed}`);
    if (r.changes === null) {
      lines.push("  parámetros  sin línea base");
    } else if (r.changes.length === 0) {
      lines.push(`  parámetros  ${r.watched} y el protocolo, sin cambios`);
    } else {
      lines.push(`  parámetros  CAMBIARON ${r.changes.length} de ${r.watched}:`);
      for (const c of r.changes) lines.push(`              - ${describeChange(c)}`);
    }
    lines.push("");
  }
  if (decision.code === 0) lines.push("Sin novedades: ningún parámetro cambió y ningún nivel se movió.");
  for (const a of decision.alerts) lines.push(`ALERTA ${a.network}: ${a.message}`);
  for (const e of decision.errors) lines.push(`SIN MIRAR ${e.network}: ${e.message}`);
  if (decision.alerts.some((a) => a.kind === "params")) {
    lines.push("Si el cambio es legítimo: node scripts/vigilar-red.mjs --actualizar-base [--red testnet|mainnet] y commitear la línea base.");
  }
  return lines.join("\n");
}

const round = (n, decimals) => (n === null || n === undefined ? null : Number(n.toFixed(decimals)));

/** Lo mismo que `formatReport`, para una máquina: un objeto que va en una sola línea. */
export function toJson({ when, results, decision }) {
  return {
    ok: decision.code === 0,
    code: decision.code,
    daily: decision.daily,
    summary: summarize(results),
    when: when.toISOString(),
    alerts: decision.alerts,
    errors: decision.errors,
    networks: Object.fromEntries(
      results.map((r) => [
        r.network,
        r.error
          ? { error: r.error }
          : {
              protocol: r.protocol,
              ledger: r.ledger,
              rpc: r.rpc,
              stateMb: round(r.stateMb, 3),
              targetMb: r.targetMb,
              percent: round(r.percent, 2),
              level: r.level,
              levelBefore: r.levelBefore,
              slopeMbPerHour: round(r.slopeMbPerHour, 3),
              slopeHours: round(r.slopeHours, 2),
              pastError: r.pastError,
              redMb: r.redMb,
              hoursToRed: round(r.hoursToRed, 1),
              watched: r.watched,
              changes: r.changes,
            },
      ]),
    ),
  };
}

export const BASE_NOTE =
  "Línea base de los parámetros de costo de Soroban y del protocolo, por red. La compara scripts/vigilar-red.mjs; " +
  "si la red cambia alguno, la corrida falla. Cuando el cambio es legítimo: node scripts/vigilar-red.mjs --actualizar-base, " +
  "y se commitea. Explicación en docs/deployments.md, Vigilancia de la red.";

/** La línea base como la guarda el repo: un parámetro por línea, así el diff de git lee. */
export function serializeBase(base) {
  const networks = Object.keys(base.networks).sort();
  const lines = [
    "{",
    `  "version": ${JSON.stringify(base.version)},`,
    `  "updated": ${JSON.stringify(base.updated)},`,
    `  "note": ${JSON.stringify(base.note)},`,
    '  "networks": {',
  ];
  networks.forEach((network, i) => {
    const params = base.networks[network].params;
    const names = Object.keys(params).sort();
    lines.push(`    ${JSON.stringify(network)}: {`, '      "params": {');
    names.forEach((name, j) => lines.push(`        ${JSON.stringify(name)}: ${JSON.stringify(params[name])}${j < names.length - 1 ? "," : ""}`));
    lines.push("      }", `    }${i < networks.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

/** La línea base nueva: las redes leídas hoy pisan a las de la anterior; las demás se quedan. */
export function buildBase(previous, reads, when) {
  const networks = { ...(previous?.networks ?? {}) };
  for (const [network, read] of Object.entries(reads)) networks[network] = { params: read.params };
  return { version: 1, updated: when.toISOString(), note: BASE_NOTE, networks };
}
