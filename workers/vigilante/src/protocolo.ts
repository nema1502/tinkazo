/**
 * El protocolo y los costos de la red, mirados cada vez que hace falta: la lógica, sin tocar la red ni a Cloudflare.
 *
 * Es el mismo criterio que el detector de GitHub (`scripts/lib/vigilar-red.mjs`, que queda de respaldo, issue 220):
 * el protocolo y los 17 parámetros de costo de Soroban contra la línea base guardada en el portero, con un aviso
 * por cambio y una sola vez. No lo importa acá porque esa librería usa cosas de Node (`node:crypto` y, por la
 * vía de los umbrales, `node:fs`) que en un Worker no hay: las piezas que se comparten están escritas igual y las
 * pruebas las comparan una por una con el detector, para que no se separen.
 *
 * Dos diferencias de verdad, más allá de la plomería:
 *  - la lectura de una red pide dos cosas chicas (`getLatestLedger` y los ajustes) y nada más: la pendiente de 24
 *    horas del detector trae el ledger de ayer (en mainnet, varios MB) y acá no hace falta, porque el vigilante
 *    no mira los niveles del estado, solo el protocolo y los costos;
 *  - las huellas salen de la Web Crypto (`crypto.subtle.digest`) y no de `node:crypto`: es el mismo SHA-256 del
 *    mismo JSON canónico, así que las huellas de acá y del detector coinciden (las pruebas lo comprueban).
 *
 * Un MB son 10^6 bytes. Un ledger cada cinco segundos, como en el resto del proyecto.
 */

/** Las RPC públicas de cada red, en orden de preferencia, las mismas que usa el detector. */
export const REDES: Record<string, { rpcUrls: string[] }> = {
  testnet: { rpcUrls: ["https://soroban-testnet.stellar.org"] },
  mainnet: {
    rpcUrls: ["https://mainnet.sorobanrpc.com", "https://rpc.lightsail.network/", "https://rpc.ankr.com/stellar_soroban"],
  },
};

/**
 * El id más alto de ajuste que se pide. El protocolo 29 usa del 0 al 17 y el 19 (el 18 no existe); el RPC acepta
 * hasta el 20 y rechaza el 21 con «cannot unmarshal key value». Un id nuevo llega con un protocolo nuevo, que ya
 * salta como cambio de `protocol_version`: ahí se sube este número.
 */
const MAX_SETTING_ID = 20;

/** Los ajustes que cambian solos en cada ledger: no son parámetros. */
const AJUSTES_SOLITARIOS = new Set(["live_soroban_state_size_window", "eviction_iterator"]);

/** `LedgerKey` de un `ConfigSetting`, en base64: tipo 8 y el id, 4 bytes cada uno. */
export function settingKey(id: number): string {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setUint32(0, 8);
  new DataView(buf.buffer).setUint32(4, id);
  let binario = "";
  for (const b of buf) binario += String.fromCharCode(b);
  return btoa(binario);
}

/**
 * Separa lo que devuelve `getLedgerEntries` (con `xdrFormat: "json"`) en los parámetros y el ledger donde cambió
 * cada uno por última vez. La ventana del estado y el iterador de desalojo no son parámetros, aunque el mismo
 * pedido los traiga.
 */
export function parseSettings(entries: unknown): { params: Record<string, unknown>; modified: Record<string, number> } {
  const params: Record<string, unknown> = {};
  const modified: Record<string, number> = {};
  for (const entrada of Array.isArray(entries) ? entries : []) {
    const e = entrada as { keyJson?: { config_setting?: { config_setting_id?: unknown } }; dataJson?: { config_setting?: Record<string, unknown> }; lastModifiedLedgerSeq?: unknown } | null;
    const nombre = e?.keyJson?.config_setting?.config_setting_id;
    const data = e?.dataJson?.config_setting;
    if (typeof nombre !== "string" || !data || typeof data !== "object") continue;
    const valor = nombre in data ? data[nombre] : Object.values(data)[0];
    if (AJUSTES_SOLITARIOS.has(nombre)) continue;
    params[nombre] = valor;
    modified[nombre] = Number(e?.lastModifiedLedgerSeq ?? 0);
  }
  return { params, modified };
}

/** `{ a: { b: 1 } }` aplanado queda `{ "a.b": 1 }`, con los índices en las listas: `x[3].y`. Igual que el detector. */
export function flatten(value: unknown, path = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out[path] = value;
  }
  return out;
}

export interface Campo {
  path: string;
  before: unknown;
  after: unknown;
}

export interface Cambio {
  /** El nombre del parámetro: `contract_ledger_cost_v0`, `protocol_version`, etc. */
  name: string;
  kind: "added" | "removed" | "changed";
  fields: Campo[];
  total: number;
  /** El ledger donde cambió por última vez, y cuántos minutos van, de lo que trae cada lectura. */
  ledger: number | null;
  minutesAgo: number | null;
}

/**
 * Qué parámetros cambiaron entre la línea base y lo que dice la red hoy. Cada cambio nombra el parámetro y,
 * campo por campo, el antes y el ahora. Igual que el detector (`scripts/lib/vigilar-red.mjs`), campo por campo.
 */
export function diffParams(base: Record<string, unknown>, current: Record<string, unknown>): Delta[] {
  const nombres = [...new Set([...Object.keys(base ?? {}), ...Object.keys(current ?? {})])].sort();
  const cambios: Delta[] = [];
  for (const nombre of nombres) {
    if (!(nombre in (base ?? {}))) {
      cambios.push({ name: nombre, kind: "added", fields: [{ path: "", before: undefined, after: (current as Record<string, unknown>)[nombre] }], total: 1 });
    } else if (!(nombre in (current ?? {}))) {
      cambios.push({ name: nombre, kind: "removed", fields: [{ path: "", before: (base as Record<string, unknown>)[nombre], after: undefined }], total: 1 });
    } else {
      const antes = flatten((base as Record<string, unknown>)[nombre]);
      const ahora = flatten((current as Record<string, unknown>)[nombre]);
      const campos: Campo[] = [];
      for (const path of new Set([...Object.keys(antes), ...Object.keys(ahora)])) {
        if (JSON.stringify(antes[path]) !== JSON.stringify(ahora[path])) {
          campos.push({ path, before: antes[path], after: ahora[path] });
        }
      }
      if (campos.length > 0) cambios.push({ name: nombre, kind: "changed", fields: campos, total: campos.length });
    }
  }
  return cambios;
}

/** El cambio sin los tiempos, como o sale de `diffParams`; el de la red llega con el ledger y los minutos. */
export interface Delta {
  name: string;
  kind: "added" | "removed" | "changed";
  fields: Campo[];
  total: number;
}

/** JSON con las llaves en orden: el mismo valor da siempre el mismo texto, venga como venga. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico((valor as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor);
}

/**
 * La huella de un valor: el sha256 de su JSON canónico. Con la Web Crypto y no con `node:crypto`, que en un
 * Worker no hay. Es la misma huella que estampa el detector: las pruebas lo comprueban.
 */
export async function huella(valor: unknown): Promise<string> {
  const texto = canonico(valor);
  const digesto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  let hex = "";
  for (const b of new Uint8Array(digesto)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** La huella de cada parámetro por separado: dice cuáles cambiaron entre un aviso y el siguiente. */
async function huellasDe(params: Record<string, unknown>): Promise<Record<string, string>> {
  const porUno: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(params)) porUno[nombre] = await huella(valor);
  return porUno;
}

/** Los parámetros cuya huella es distinta, o que están en uno solo de los dos, en orden. */
function cambiados(before: Record<string, string>, after: Record<string, string>): string[] {
  const nombres = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...nombres].filter((nombre) => before[nombre] !== after[nombre]).sort();
}

// ---------- la lectura de una red ----------

/** Lo que se lee de una red con dos pedidos: el ledger nuevo y los ajustes, nada más. */
export interface Lectura {
  protocol: number;
  ledger: number;
  closeTime: number;
  /** El protocolo y los parámetros, como los arma el detector: `protocol_version` va adentro. */
  params: Record<string, unknown>;
  modified: Record<string, number>;
}

/** La forma del `call` que arman `makeCaller` y quien la copia: el resultado del RPC o un error. */
export type Llamada = (metodo: string, params: unknown, extra?: { attempts?: number }) => Promise<unknown>;

/** Los ajustes, menos ids de los que un RPC acepte: vuelve a pedir solo hasta el que tiene, como el detector. */
async function leerAjustes(call: Llamada): Promise<unknown> {
  let count = MAX_SETTING_ID + 1;
  for (;;) {
    try {
      return await call("getLedgerEntries", { keys: Array.from({ length: count }, (_, id) => settingKey(id)), xdrFormat: "json" });
    } catch (e) {
      // Un RPC más viejo que el protocolo rechaza los ids que no conoce y dice cuál es el primero
      // («... at index 17»): se vuelve a pedir hasta ahí.
      const index = Number(/at index (\d+)/.exec(e instanceof Error ? e.message : "")?.[1]);
      if (!(index > 0 && index < count)) throw e;
      count = index;
    }
  }
}

/**
 * La lectura de una red: dos pedidos y nada más. Falla con el motivo del corte (el que trae el `call`, con sus
 * reintentos) o con el que dice que la respuesta no trae lo que se espera.
 */
export async function leerRed(call: Llamada): Promise<Lectura> {
  const latest = (await call("getLatestLedger", {})) as { sequence: unknown; protocolVersion: unknown; closeTime: unknown };
  const ledger = Number(latest.sequence);
  const ajustes = await leerAjustes(call);
  const { params, modified } = parseSettings((ajustes as { entries?: unknown }).entries);
  if (Object.keys(params).length === 0) {
    throw new Error("la respuesta del RPC no trae los parámetros (¿cambió el formato?)");
  }
  const protocol = Number(latest.protocolVersion);
  return { protocol, ledger, closeTime: Number(latest.closeTime), params: { protocol_version: protocol, ...params }, modified };
}

// ---------- la línea base y el estado de lo avisado ----------

/** La línea base, como la sirve el portero (`/v1/patrocinio/linea-base`) y la guarda el repositorio. */
export interface LineaBase {
  version: unknown;
  updated: unknown;
  networks: Record<string, { params: Record<string, unknown> }>;
}

/** La línea base a partir del texto que contestó el portero, o null si no se entiende. */
export function lineaBaseDe(texto: string): LineaBase | null {
  let j: Record<string, unknown>;
  try {
    const crudo: unknown = JSON.parse(texto);
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
    j = crudo as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j.networks || typeof j.networks !== "object" || Array.isArray(j.networks)) return null;
  const redes: Record<string, { params: Record<string, unknown> }> = {};
  for (const [red, bloques] of Object.entries(j.networks as Record<string, unknown>)) {
    if (!bloques || typeof bloques !== "object" || Array.isArray(bloques)) return null;
    const params = (bloques as Record<string, unknown>).params;
    if (!params || typeof params !== "object" || Array.isArray(params)) return null;
    redes[red] = { params: params as Record<string, unknown> };
  }
  if (Object.keys(redes).length === 0) return null;
  return { version: j.version, updated: j.updated, networks: redes };
}

/** Una entrada de lo avisado: la huella del estado de la red (`state`), de la línea base (`base`) y de cada parámetro (`params`). */
export interface Avisado {
  state: string;
  base: string;
  params?: Record<string, string>;
}

/** Lo que el paso recuerda entre vueltas: por red, lo que ya se avisó. Va en su propia entrada del KV. */
export interface EstadoProtocolo {
  v: 1;
  el: Record<string, Avisado>;
}

const HUELLA = /^[0-9a-f]{64}$/;

export const estadoVacio = (): EstadoProtocolo => ({ v: 1, el: {} });

/** El estado a partir del texto del KV. Lo que no se entiende se descarta, entrada por entrada. */
export function estadoDe(texto: string): EstadoProtocolo {
  const estado = estadoVacio();
  let j: Record<string, unknown>;
  try {
    const crudo: unknown = JSON.parse(texto);
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return estado;
    j = crudo as Record<string, unknown>;
  } catch {
    return estado;
  }
  const el = j.el;
  if (!el || typeof el !== "object" || Array.isArray(el)) return estado;
  for (const [red, entrada] of Object.entries(el as Record<string, unknown>)) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) continue;
    const o = entrada as Record<string, unknown>;
    if (typeof o.state !== "string" || !HUELLA.test(o.state) || typeof o.base !== "string" || !HUELLA.test(o.base)) continue;
    const avisado: Avisado = { state: o.state, base: o.base };
    if (o.params && typeof o.params === "object" && !Array.isArray(o.params)) {
      const params = Object.fromEntries(Object.entries(o.params as Record<string, unknown>).filter(([, p]) => typeof p === "string" && HUELLA.test(p)));
      if (Object.keys(params).length > 0) avisado.params = params as Record<string, string>;
    }
    estado.el[red] = avisado;
  }
  return estado;
}

/** El estado como texto, para el KV. */
export function textoDeEstado(estado: EstadoProtocolo): string {
  return JSON.stringify(estado);
}

// ---------- la ronda: qué avisar y qué queda ----------

/** Un aviso por una red: el texto que sale cuando alguien lo comparte, tal como dejan los textos de los avisos. */
export interface Aviso {
  red: string;
  asunto: string;
  texto: string;
  /** Lo que queda avisado para esa red en cuanto se manda el aviso. */
  avisado: Avisado;
}

export interface ErrorDeRed {
  red: string;
  /** Por qué no se pudo mirar: el motivo del corte del RPC, o que no hay línea base de esa red. */
  motivo: string;
}

export interface ConsignaProtocolo {
  /** Las redes que se miran, en orden: testnet y mainnet. */
  redes: string[];
  /** Lo que se leyó de cada red, o nada si no se pudo. */
  lecturas: Record<string, Lectura | undefined>;
  /** Por qué no se pudo leer cada red que falta. */
  fallas: Record<string, string>;
  base: LineaBase;
  /** Lo avisado hasta ahora. */
  estado: EstadoProtocolo;
}

export interface RondaProtocolo {
  avisos: Aviso[];
  errores: ErrorDeRed[];
  /** Lo que queda después de la ronda: lo nuevo avisado más lo que se conserva de antes. */
  siguiente: EstadoProtocolo;
}

const MINUTOS = (ledgers: number): number => (ledgers * 5) / 60;

/** Cuánto hace, con el tiempo en minutos: la misma forma que en el detector. */
function hace(minutos: number | null): string {
  if (minutos === null) return "";
  if (minutos < 120) return `hace ${minutos} min`;
  if (minutos < 48 * 60) return `hace ${Math.round((minutos / 60) * 10) / 10} h`;
  return `hace ${Math.round((minutos / 1440) * 10) / 10} días`;
}

function mostrar(valor: unknown): string {
  if (valor === undefined) return "(ausente)";
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  return texto.length > 60 ? `${texto.slice(0, 57)}...` : texto;
}

/** Una línea por parámetro cambiado: el nombre, cuándo cambió y los primeros tres campos, con el resto en un recuento. */
export function describir(c: Cambio): string {
  const cuando = c.ledger ? ` (ledger ${c.ledger}, ${hace(c.minutesAgo)})` : "";
  if (c.kind === "added") return `${c.name}${cuando}: parámetro nuevo, vale ${mostrar(c.fields[0]?.after)}`;
  if (c.kind === "removed") return `${c.name}: ya no está en la red (valía ${mostrar(c.fields[0]?.before)})`;
  const campos = c.fields
    .slice(0, 3)
    .map((f) => `${f.path || "valor"} ${mostrar(f.before)} -> ${mostrar(f.after)}`)
    .join(", ");
  const mas = c.total > 3 ? ` y ${c.total - 3} más` : "";
  return `${c.name}${cuando}: ${campos}${mas}`;
}

/** El aviso para una red: el asunto para la pantalla bloqueada y el texto con el detalle y el camino a seguir. */
function mensajeDe(red: string, cambios: Cambio[], otraVez: string[]): { asunto: string; texto: string } {
  const cuenta = cambios.length === 1 ? "cambió 1 parámetro" : `cambiaron ${cambios.length} parámetros`;
  const protocoloCambio = cambios.some((c) => c.name === "protocol_version");
  const asunto = `${protocoloCambio ? "La red de Stellar cambió de protocolo" : "La red de Stellar cambió los costos"} (${red})`;
  const por = cambios.map(describir);
  const quePaso = otraVez.length > 0
    ? `${red}: ${cuenta} contra la línea base guardada en el portero, y cambió otra vez desde el último aviso: ${otraVez.slice(0, 5).join(", ")}.`
    : `${red}: ${cuenta} contra la línea base guardada en el portero.`;
  const texto = [quePaso, ...por.map((p) => `- ${p}`), "", `Si el cambio es legítimo: correr node scripts/vigilar-red.mjs --actualizar-base --red ${red}, commitear scripts/vigilar-red.base.json y volver a desplegar el portero con la línea nueva. El detector de GitHub queda como respaldo.`].join("\n");
  return { asunto, texto };
}

/**
 * Una ronda entera, sin red ni KV: lo que se leyó de cada red o por qué no se pudo, la línea base y lo que ya se
 * avisó dan los avisos de ahora y lo que queda avisado para la próxima ronda. Un cambio avisa una sola vez: le
 * aviso vale para esta línea base (las huellas del estado y de la base quedan guardadas), así que la misma
 * combinación ya no repite, y una base nueva comprometida lo borra cuando la red coincide con ella.
 */
export async function vigilarProtocolo(o: ConsignaProtocolo): Promise<RondaProtocolo> {
  const avisos: Aviso[] = [];
  const errores: ErrorDeRed[] = [];
  // Lo avisado de cada red se conserva por omisión: una red que no se pudo mirar, o que no tiene línea base,
  // conserva lo que ya tenía (un RPC caído un rato no inventa un cambio ni repite un aviso cuando vuelve).
  const siguiente: EstadoProtocolo = { v: 1, el: { ...o.estado.el } };
  for (const red of o.redes) {
    const falla = o.fallas[red];
    if (falla) {
      errores.push({ red, motivo: falla });
      continue;
    }
    const lectura = o.lecturas[red];
    if (!lectura) {
      errores.push({ red, motivo: "sin lectura" });
      continue;
    }
    const baseRed = o.base.networks?.[red];
    if (!baseRed || !baseRed.params) {
      errores.push({ red, motivo: `no hay línea base de esta red (node scripts/vigilar-red.mjs --actualizar-base --red ${red})` });
      continue;
    }
    const cambios: Cambio[] = diffParams(baseRed.params, lectura.params).map((c) => {
      const ledger = lectura.modified[c.name] ?? null;
      return { ...c, ledger, minutesAgo: ledger !== null ? Math.round(MINUTOS(lectura.ledger - ledger)) : null };
    });
    const huellaEstado = await huella(lectura.params);
    const huellaBase = await huella(baseRed.params);
    const porParametro = await huellasDe(lectura.params);
    const avisado = o.estado.el[red];
    const hayCambios = cambios.length > 0;
    // El aviso vale para esta línea base: si alguien commiteó otra, es un aviso nuevo.
    const mismaBase = hayCambios && avisado?.base === huellaBase;
    const yaAviso = mismaBase && avisado!.state === huellaEstado;
    const desdeAviso = mismaBase && !yaAviso && avisado?.params ? cambiados(avisado.params, porParametro) : [];
    if (hayCambios && !yaAviso) {
      const datos = { state: huellaEstado, base: huellaBase, params: porParametro };
      const mensaje = mensajeDe(red, cambios, desdeAviso);
      avisos.push({ red, ...mensaje, avisado: datos });
      siguiente.el[red] = datos;
      continue;
    }
    // Sin cambios: lo avisado se conserva, salvo que alguien commiteó una base nueva y la red ya coincida con
    // ella. Que la red coincida con la base una sola corrida (un RPC atrasado) o vuelva atrás de verdad no borra
    // nada: la entrada queda inofensiva hasta la próxima base, y evita un segundo aviso por el mismo estado.
    const anterior = o.estado.el[red];
    if (anterior && anterior.base === huellaBase) siguiente.el[red] = anterior;
    else if (anterior) delete siguiente.el[red];
  }
  return { avisos, errores, siguiente };
}
