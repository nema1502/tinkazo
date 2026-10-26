import type { NetworkName } from "./config";
import umbralesJson from "./red-umbrales.json";

/**
 * ¿La red está bien para sellar?, antes de que la sala espere.
 *
 * El 25 de octubre de 2026 el sello de testnet pasó de 0,7 a 69 XLM por el estado
 * de la red (no por Tinkazo) y lo único que vio quien sorteaba fue un error
 * genérico, después de esperar. Esto lo mira antes: simula un sello de muestra
 * (la red devuelve el costo antes de firmar nada, y la simulación es solo lectura),
 * mira el último ledger, las comisiones de inclusión y la versión del protocolo, y
 * dice verde, amarillo o rojo con la razón.
 *
 * Los cinco fallos (la especificación de la contingencia de red del 25 de octubre
 * de 2026, resumida en docs/ux.md, "Cuando la red falla"):
 *
 * 1. `costo-alto`: sellar cuesta más de lo que el patrocinador paga (Pollar apaga el
 *    patrocinio en silencio por encima de su tope), o pide restaurar el contrato.
 * 2. `rpc-caido`: los dos RPC fallan (rojo), o anda lento: el ledger tiene más de 30 s (amarillo).
 * 3. `saturada`: la comisión de inclusión del percentil 90 pasa de 1.000 stroops (amarillo).
 * 4. `sin-saldo`: la cuenta que paga por sí misma no alcanza (rojo).
 * 5. `protocolo`: la red anuncia una versión que no conocemos (amarillo, nunca frena
 *    por sí solo) o la simulación de muestra falla (rojo).
 *
 * Es lógica pura: lo que toca la red entra inyectado (`FuentesDelChequeo`), así se
 * prueba con fixtures. Y **nunca frena por una falla propia**: si el chequeo mismo se
 * rompe, dice verde y lo anota (`sinChequeo`). Una red que no se pudo mirar no es una
 * red mala; el sello de verdad tiene sus propios errores.
 */

export type Nivel = "verde" | "amarillo" | "rojo";
export type CasoRed = "costo-alto" | "rpc-caido" | "saturada" | "sin-saldo" | "protocolo";
/** Quién paga la comisión: el patrocinador de la app (Pollar) o la cuenta misma (Freighter, la de prueba). */
export type Pagador = "patrocinado" | "propio";
export type MetodoRpc = "getNetwork" | "getLatestLedger" | "getFeeStats";

export interface UmbralesDeRed {
  topePollarXlm: number;
  factorDelFeeBump: number;
  rojoXlm: number;
  amarilloXlm: number;
}
export interface UmbralesComunes {
  topeDeLlamadaMs: number;
  ledgerViejoS: number;
  inclusionP90Stroops: number;
  protocolosConocidos: number[];
  margenDeSaldo: number;
  cacheS: number;
  repetirCadaS: number;
  reintentosAntesDeSinSello: number;
  reintentarCadaS: number;
}
export interface Umbrales {
  red: UmbralesDeRed;
  comun: UmbralesComunes;
}

/** Los umbrales de una red. Una constante por red, en `red-umbrales.json`. */
export const umbralesDe = (red: NetworkName): Umbrales => ({ red: umbralesJson[red], comun: umbralesJson.comun });

/** Cuánto devolvió la simulación de un sello. */
export interface MuestraDeSello {
  /** `minResourceFee`, en stroops. */
  minResourceFee: number;
  /** La simulación pide restaurar entradas archivadas antes de poder sellar. */
  restaurar: boolean;
  /** La simulación falló (el contrato dijo que no, o la respuesta no se entiende). */
  error?: string;
}

export interface FuentesDelChequeo {
  red: NetworkName;
  /** La passphrase de la red que esta página espera. Un RPC con otra es de otra red. */
  passphrase: string;
  /** Los RPC, el vigente primero. */
  rpcs: readonly string[];
  pagador: Pagador;
  /** Un método de JSON-RPC, con tope de `topeDeLlamadaMs`. Lanza si falla o tarda. */
  llamar(url: string, metodo: MetodoRpc): Promise<Record<string, unknown>>;
  /** Simula un sello de muestra contra ese RPC. Lanza si no llegó; devuelve `error` si llegó y falló. */
  simular(url: string): Promise<MuestraDeSello>;
  /** XLM de la cuenta que paga por sí misma; `-1` si no se sabe. */
  saldo?(): Promise<number>;
  sinInternet?(): boolean;
  /** Hubo un `TRY_AGAIN_LATER` hace poco: la red no tomó una transacción por estar llena. */
  saturacionReciente?(): boolean;
  ahora?(): number;
  umbrales?: Umbrales;
  /** El RPC elegido no es el vigente: que pase a serlo. */
  elegir?(url: string, motivo: string): void;
}

export interface SondaDeRpc {
  url: string;
  salud: "ok" | "viejo" | "error" | "otra-red";
  ms: number;
  ledger?: number;
  cierre?: number;
  protocolo?: number;
  p90?: number;
  muestra?: MuestraDeSello;
  razon?: string;
}

export interface Diagnostico {
  nivel: Nivel;
  /** El caso que manda (el más grave), o null si todo está bien. */
  caso: CasoRed | null;
  /** Todos los que aplican, para el registro. */
  casos: { caso: CasoRed; nivel: Nivel }[];
  red: NetworkName;
  /** El RPC con el que se midió. */
  rpc: string | null;
  pagador: Pagador;
  /** Lo que cuesta sellar hoy (la simulación de muestra más la inclusión), en XLM. */
  costoXlm: number | null;
  /** Desde cuánto el patrocinador deja de pagar, en XLM (`rojoXlm`). */
  rojoXlm: number;
  ms: number | null;
  ledger: number | null;
  protocolo: number | null;
  inclusionP90: number | null;
  saldoXlm: number | null;
  restaurar: boolean;
  /** Sin internet: lo cuenta el aviso de siempre, no un caso de la red. */
  sinInternet: boolean;
  /** El chequeo mismo no pudo correr: no frena nada. */
  sinChequeo: boolean;
  /** Para el registro, en una línea y sin datos de nadie. */
  motivo: string;
  /** Cuándo se midió (ms). */
  hora: number;
}

/** Qué caso manda cuando hay varios del mismo nivel. */
const PRIORIDAD: readonly CasoRed[] = ["rpc-caido", "costo-alto", "sin-saldo", "protocolo", "saturada"];
const RANGO: Record<Nivel, number> = { verde: 0, amarillo: 1, rojo: 2 };

const numero = (x: unknown): number | undefined => {
  const n = typeof x === "string" && x.trim() === "" ? Number.NaN : Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const dicho = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 80);

/** Lo que cuesta sellar, en XLM: la simulación más la comisión de inclusión (al menos la base, 100 stroops). */
export function costoDeSelloXlm(minResourceFee: number, inclusionP90 = 0): number {
  return (minResourceFee + Math.max(100, inclusionP90)) / 1e7;
}

/**
 * Qué nivel tiene un costo, según quién paga. Con el patrocinador, el tope de
 * Pollar lo corta: por encima de `rojoXlm` la oferta del fee-bump pasa el tope. Con
 * una cuenta que paga por sí misma no hay tope, solo un costo que avisar.
 */
export function nivelDelCosto(costoXlm: number, pagador: Pagador, red: NetworkName): Nivel {
  const u = umbralesDe(red).red;
  if (pagador === "patrocinado" && costoXlm > u.rojoXlm) return "rojo";
  return costoXlm >= u.amarilloXlm ? "amarillo" : "verde";
}

/**
 * La simulación de un sello de verdad (`sellar()`, antes de firmar o de entregárselo
 * a Pollar) da un costo por encima de lo que el patrocinador paga. Se lanza antes de
 * mandar nada: no se gastó ni se grabó nada, y la pantalla ofrece el camino del caso 1.
 */
export class CostoAlto extends Error {
  readonly costoXlm: number;
  readonly restaurar: boolean;
  constructor(costoXlm: number, restaurar = false) {
    super(`costo-alto: sellar cuesta ${costoXlm.toFixed(4)} XLM`);
    this.name = "CostoAlto";
    this.costoXlm = costoXlm;
    this.restaurar = restaurar;
  }
}

/** Por el nombre y la forma, no solo por la clase: los módulos se bajan aparte. */
export function esCostoAlto(e: unknown): e is CostoAlto {
  if (e instanceof CostoAlto) return true;
  const x = e as { name?: unknown; costoXlm?: unknown } | null;
  return !!x && x.name === "CostoAlto" && typeof x.costoXlm === "number";
}

async function sondear(f: FuentesDelChequeo, url: string, u: Umbrales, ahora: () => number): Promise<SondaDeRpc> {
  const t0 = ahora();
  const [net, led, fee, sim] = await Promise.allSettled([f.llamar(url, "getNetwork"), f.llamar(url, "getLatestLedger"), f.llamar(url, "getFeeStats"), f.simular(url)]);
  const ms = ahora() - t0;
  if (net.status === "rejected") return { url, salud: "error", ms, razon: `getNetwork: ${dicho(net.reason)}` };
  if (led.status === "rejected") return { url, salud: "error", ms, razon: `getLatestLedger: ${dicho(led.reason)}` };
  if (sim.status === "rejected") return { url, salud: "error", ms, razon: `simulación: ${dicho(sim.reason)}` };
  const passphrase = typeof net.value.passphrase === "string" ? net.value.passphrase : "";
  if (passphrase && passphrase !== f.passphrase) return { url, salud: "otra-red", ms, razon: "otra red" };
  const ledger = numero(led.value.sequence);
  const cierre = numero(led.value.closeTime);
  const protocolo = numero(net.value.protocolVersion) ?? numero(led.value.protocolVersion);
  const inclusion = fee.status === "fulfilled" ? (fee.value.sorobanInclusionFee as { p90?: unknown } | undefined) : undefined;
  const p90 = numero(inclusion?.p90);
  // El ledger más nuevo que conoce ese RPC, contra el reloj de acá. Un reloj corrido da amarillo y nada más.
  const viejo = cierre !== undefined && ahora() / 1000 - cierre > u.comun.ledgerViejoS;
  return {
    url,
    salud: viejo ? "viejo" : "ok",
    ms,
    ...(ledger !== undefined ? { ledger } : {}),
    ...(cierre !== undefined ? { cierre } : {}),
    ...(protocolo !== undefined ? { protocolo } : {}),
    ...(p90 !== undefined ? { p90 } : {}),
    muestra: sim.value,
    ...(viejo ? { razon: `ledger de hace ${Math.round(ahora() / 1000 - (cierre as number))} s` } : {}),
  };
}

/** Mira la red y dice cómo está. Nunca lanza. */
export async function chequearRed(f: FuentesDelChequeo): Promise<Diagnostico> {
  const ahora = f.ahora ?? Date.now;
  const u = f.umbrales ?? umbralesDe(f.red);
  const base: Diagnostico = {
    nivel: "verde",
    caso: null,
    casos: [],
    red: f.red,
    rpc: ((): string | null => {
      try {
        return f.rpcs[0] ?? null;
      } catch {
        return null;
      }
    })(),
    pagador: f.pagador,
    costoXlm: null,
    rojoXlm: u.red.rojoXlm,
    ms: null,
    ledger: null,
    protocolo: null,
    inclusionP90: null,
    saldoXlm: null,
    restaurar: false,
    sinInternet: false,
    sinChequeo: false,
    motivo: "ok",
    hora: ahora(),
  };
  try {
    if (f.sinInternet?.()) return { ...base, sinInternet: true, motivo: "sin-internet" };

    // Los RPC en orden: el primero que anda bien se queda. Si ninguno anda bien pero alguno
    // contesta con un ledger viejo, ese. Si ninguno contesta, el caso 2 en rojo.
    const sondas: SondaDeRpc[] = [];
    let elegida: SondaDeRpc | undefined;
    for (const url of f.rpcs) {
      const s = await sondear(f, url, u, ahora);
      sondas.push(s);
      if (s.salud === "ok") {
        elegida = s;
        break;
      }
    }
    elegida ??= sondas.find((s) => s.salud === "viejo");
    const razones = sondas.filter((s) => s.salud !== "ok").map((s) => `${new URL(s.url).hostname}: ${s.razon ?? s.salud}`);
    if (!elegida) {
      return {
        ...base,
        nivel: "rojo",
        caso: "rpc-caido",
        casos: [{ caso: "rpc-caido", nivel: "rojo" }],
        ms: sondas.reduce((m, s) => Math.max(m, s.ms), 0),
        motivo: razones.join(" | ") || "sin respuesta",
      };
    }
    if (elegida.url !== f.rpcs[0]) f.elegir?.(elegida.url, razones.join(" | ") || "cambio");

    const muestra = elegida.muestra as MuestraDeSello;
    const casos: { caso: CasoRed; nivel: Nivel }[] = [];
    const p90 = elegida.p90 ?? 0;
    const costoXlm = muestra.error ? null : costoDeSelloXlm(muestra.minResourceFee, p90);

    if (elegida.salud === "viejo") casos.push({ caso: "rpc-caido", nivel: "amarillo" });
    // Caso 5: una versión que no conocemos avisa pero no frena; lo que frena es que la simulación falle.
    if (muestra.error) casos.push({ caso: "protocolo", nivel: "rojo" });
    else if (elegida.protocolo !== undefined && !u.comun.protocolosConocidos.includes(elegida.protocolo)) casos.push({ caso: "protocolo", nivel: "amarillo" });
    // Caso 1: restaurar es plata y un segundo paso que el patrocinio no hace.
    if (!muestra.error && muestra.restaurar) casos.push({ caso: "costo-alto", nivel: "rojo" });

    let saldoXlm: number | null = null;
    if (costoXlm !== null && !muestra.restaurar) {
      const porCosto = nivelDelCosto(costoXlm, f.pagador, f.red);
      if (f.pagador === "propio") {
        // Caso 4: la cuenta que paga por sí misma tiene que cubrir el sello con margen.
        const s = f.saldo ? await f.saldo().catch(() => -1) : -1;
        saldoXlm = s >= 0 ? s : null;
        if (saldoXlm !== null && saldoXlm < u.comun.margenDeSaldo * costoXlm) casos.push({ caso: "sin-saldo", nivel: "rojo" });
        else if (porCosto !== "verde") casos.push({ caso: "costo-alto", nivel: "amarillo" });
      } else if (porCosto !== "verde") {
        casos.push({ caso: "costo-alto", nivel: porCosto });
      }
    }
    // Caso 3: la red está llena.
    if (p90 > u.comun.inclusionP90Stroops || f.saturacionReciente?.()) casos.push({ caso: "saturada", nivel: "amarillo" });

    let nivel: Nivel = "verde";
    for (const c of casos) if (RANGO[c.nivel] > RANGO[nivel]) nivel = c.nivel;
    const deNivel = casos.filter((c) => c.nivel === nivel);
    const caso = PRIORIDAD.find((p) => deNivel.some((c) => c.caso === p)) ?? null;

    return {
      ...base,
      nivel,
      caso,
      casos,
      rpc: elegida.url,
      costoXlm,
      ms: elegida.ms,
      ledger: elegida.ledger ?? null,
      protocolo: elegida.protocolo ?? null,
      inclusionP90: elegida.p90 ?? null,
      saldoXlm,
      restaurar: !muestra.error && muestra.restaurar,
      motivo: muestra.error ? `simulación: ${muestra.error.slice(0, 80)}` : razones.join(" | ") || "ok",
    };
  } catch (e) {
    // El chequeo es una ayuda, no una puerta: si se rompe, no frena el sello.
    return { ...base, sinChequeo: true, motivo: `el chequeo falló: ${dicho(e)}` };
  }
}

/* ------------------------------------------------------------------ la caché */

export interface Chequeo {
  /** El diagnóstico, de la caché si tiene menos de `maxEdadMs` (60 s por defecto), y si no, uno nuevo. */
  verificar(opciones?: { maxEdadMs?: number; forzar?: boolean }): Promise<Diagnostico>;
  /** El último que hay, sin preguntar. */
  ultimo(): Diagnostico | null;
  /** Olvida el último (cambió la cuenta, o falló un sello). */
  olvidar(): void;
}

/**
 * Un chequeo con caché de 60 s. Varios pedidos a la vez comparten la misma
 * medición: la red no se consulta dos veces por lo mismo.
 */
export function crearChequeo(medir: () => Promise<Diagnostico>, opciones: { ahora?: () => number; cacheMs?: number } = {}): Chequeo {
  const ahora = opciones.ahora ?? Date.now;
  const cacheMs = opciones.cacheMs ?? umbralesJson.comun.cacheS * 1000;
  let ultimo: Diagnostico | null = null;
  let enCurso: Promise<Diagnostico> | null = null;
  return {
    verificar({ maxEdadMs = cacheMs, forzar = false } = {}) {
      if (!forzar && ultimo && ahora() - ultimo.hora < maxEdadMs) return Promise.resolve(ultimo);
      if (enCurso) return enCurso;
      const este = Promise.resolve()
        .then(medir)
        .then((d) => {
          ultimo = d;
          return d;
        })
        .finally(() => {
          if (enCurso === este) enCurso = null;
        });
      enCurso = este;
      return este;
    },
    ultimo: () => ultimo,
    olvidar() {
      ultimo = null;
    },
  };
}

/* ------------------------------------------------- hablar con el RPC, sin el SDK */

/**
 * Un método de JSON-RPC con tope de tiempo (4 s por defecto). Lanza si el RPC no
 * contesta a tiempo, contesta 429 o 5xx (a veces con una página que no es JSON) o
 * devuelve un error de JSON-RPC. La respuesta de un RPC que anda bien es `result`.
 */
export async function llamarRpc(
  url: string,
  metodo: string,
  params: unknown = null,
  opciones: { ms?: number; fetchFn?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  const ms = opciones.ms ?? umbralesJson.comun.topeDeLlamadaMs;
  const fetchFn = opciones.fetchFn ?? fetch;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
    signal: AbortSignal.timeout(ms),
  });
  if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
  const cuerpo = (await res.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
  if (cuerpo.error) throw new Error(cuerpo.error.message ?? "rpc-error");
  return cuerpo.result ?? {};
}

/**
 * Simula una transacción ya armada (en XDR) contra un RPC y lee lo que importa del
 * resultado crudo, sin el SDK: el costo, si pide restaurar, y el error si el
 * contrato dijo que no. Lanza si el RPC no contestó (eso es del RPC, no del sello).
 */
export async function simularConRpc(
  url: string,
  transaccionXdr: string,
  llamar: (url: string, metodo: string, params: unknown) => Promise<Record<string, unknown>> = (u, m, p) => llamarRpc(u, m, p),
): Promise<MuestraDeSello> {
  const r = await llamar(url, "simulateTransaction", { transaction: transaccionXdr });
  if (typeof r.error === "string" && r.error) return { minResourceFee: 0, restaurar: false, error: r.error };
  const fee = numero(r.minResourceFee);
  if (fee === undefined) return { minResourceFee: 0, restaurar: false, error: "la simulación no trae el costo" };
  const preambulo = r.restorePreamble as { transactionData?: unknown } | undefined;
  return { minResourceFee: fee, restaurar: !!preambulo && typeof preambulo === "object" && !!preambulo.transactionData };
}
