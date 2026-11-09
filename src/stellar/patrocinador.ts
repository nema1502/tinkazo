import type { RespuestaEnvio } from "./envio";
import { network, type NetworkName } from "./config";
import { configDelPortero } from "./patrocinio-config";

/**
 * Quién paga la comisión de la red al sellar y al sortear, y cómo se le manda la transacción.
 *
 * Hay dos maneras, y la página no las elige: las elige el servicio que cuenta y paga (el portero,
 * `workers/patrocinio`), que dice en `/cupo` quién rige.
 *
 * - `pollar`: lo de siempre. La cuenta de Pollar firma y manda de una vez (`signAndSubmit`) y es Pollar
 *   quien paga, por la regla de contrato de su panel.
 * - `portero`: la cuenta de Pollar firma SIN patrocinio y la transacción firmada se manda al portero,
 *   que la pasa por su lista blanca, cuenta el cupo de la cuenta, la envuelve con su propio fee-bump y la
 *   manda a la red. El hash que devuelve es el de la transacción interna, el mismo que ya consulta
 *   `envio.ts`.
 *
 * **Sin portero configurado, nada cambia:** no hay ninguna consulta y rige Pollar, como hoy. La dirección sale de
 * la variable de esta red o, en `tinkazo.app` y en Prueba, de la de por defecto (`patrocinio-config.ts`). Si el
 * portero contesta que es de otra red, no se le manda nada: cerrado ante la duda.
 * **Con la variable puesta y sin respuesta, cerrado ante la duda:** no se paga con nadie y la pantalla lo dice. Un
 * portero que contesta que está apagado, o que le falta algo de su configuración, es lo mismo.
 * **Con la dirección por defecto y sin respuesta, rige Pollar:** el portero no es condición para sellar. Si
 * contesta y dice que está apagado, que no tiene fondo o que le falta configuración, también es cerrado: es la
 * palabra del servicio.
 *
 * Este archivo no toca la página: `fetch` entra inyectado, así se prueba con uno de mentira.
 */

/** La cuenta con la llave en ceros: válida para preguntar quién rige cuando todavía no hay sesión. */
const CUENTA_DE_CONSULTA = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Cuánto se espera la respuesta de `/cupo` la primera vez. */
export const TOPE_CUPO_MS = 6_000;
/**
 * Cuánto se espera después de una vez que no contestó a tiempo: con el servicio caído, la pantalla espera el tope entero
 * una sola vez por carga y no en cada chequeo. Una respuesta cualquiera vuelve al tope de siempre.
 */
export const TOPE_CUPO_TRAS_CAIDA_MS = 1_500;
/** Desde cuándo, con el pago en camino, se le dice a la persona que se está cubriendo la comisión. */
export const AVISO_DE_ESPERA_MS = 5_000;
/** Cuánto se espera un pago: el portero puede tardar hasta unos 48 s en el peor caso (tres llamadas a la red de 8 s). */
export const TOPE_PAGO_MS = 55_000;
/** Cuánto vale lo que se supo de `/cupo` antes de preguntar de nuevo. */
export const VIGENCIA_MS = 15_000;

type Fetch = typeof fetch;

/** La dirección del portero, sin barra al final, o `null` si no está puesta (entonces rige Pollar y no se consulta nada). */
export function urlDelPortero(): string | null {
  return configDelPortero().url;
}

/**
 * El día en que vuelve el cupo, para decirlo: "1 de diciembre" o "December 1". El mes del cupo corre en UTC,
 * así que el día se dice en UTC: nunca promete un día antes de tiempo.
 */
export function fechaDelCupo(liberaEn: number, idioma: string): string {
  try {
    return new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "es", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(liberaEn));
  } catch {
    try {
      return new Date(liberaEn).toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }
}

/**
 * El día en que vuelve el cupo para una frase, o `cerca` ("primero del mes que viene") si no hay un día que decir:
 * `liberaEn` que falta, cero, negativo, que no es un número o una fecha que no existe. Nunca "1 de enero".
 */
export function fechaOCercana(liberaEn: unknown, idioma: string, cerca: string): string {
  if (typeof liberaEn !== "number" || !Number.isFinite(liberaEn) || liberaEn <= 0 || Number.isNaN(new Date(liberaEn).getTime())) return cerca;
  return fechaDelCupo(liberaEn, idioma) || cerca;
}

/** El texto de la línea para este estado, o `null` si no hay nada que decir. */
export function textoDelCupo(estado: EstadoDelPatrocinio | null, idioma: string, decir: (clave: string) => string): string | null {
  if (!estado || estado.rige !== "portero") return null;
  const quedan = estado.cupo.sellos.quedan;
  if (quedan <= 0) return decir("cupoCero").replaceAll("{fecha}", fechaOCercana(estado.cupo.liberaEn, idioma, decir("errAnchor.cupoPronto")));
  return quedan === 1 ? decir("cupoQueda1") : decir("cupoQuedan").replaceAll("{n}", String(quedan));
}

/* ---------------------------------------------------------------- los errores */

/** Por qué el portero no pagó. Los de `/v1/patrocinio` del README del Worker, más `cerrado`: el Worker no contesta. */
export type MotivoDelPortero = "cupo-cuenta" | "cupo-ip" | "fondo" | "apagado" | "cerrado" | "no-permitida" | "cuenta-ajena" | "origen" | "fallaria" | "fee-alta" | "rechazada" | "red" | "interno" | "desconocido";

/**
 * El portero no pagó. Lo que importa de su respuesta, sin el XDR ni la cuenta. `errorKey` lo traduce a
 * lo que ve la persona (`errAnchor.portero*`).
 *
 * `reintentable`: se puede volver a mandar la MISMA transacción ya (un corte del portero con la red, un
 * error suyo). Lo demás es un no: nada quedó en el aire, y mandarla otra vez no cambia nada.
 */
export class ErrorPortero extends Error {
  readonly motivo: MotivoDelPortero;
  readonly estado: number;
  readonly que?: "sellos" | "sorteos";
  readonly liberaEn?: number;
  readonly max?: number;
  readonly razon?: string;
  readonly detalle?: string;
  readonly reintentable: boolean;
  /** Cuando el portero dice que ahora rige otro (`apagado` con `rige:"pollar"`): la próxima vez se pregunta de nuevo. */
  readonly rige?: string;

  constructor(motivo: MotivoDelPortero, estado: number, extra: { que?: "sellos" | "sorteos" | undefined; liberaEn?: number | undefined; max?: number | undefined; razon?: string | undefined; detalle?: string | undefined; rige?: string | undefined } = {}) {
    // `fallaria` lleva el error de la simulación (`Error(Contract, #5)`…), para que se lea como cualquier error del contrato.
    super(`portero-${motivo}${extra.razon ? `/${extra.razon}` : ""}${motivo === "fallaria" && extra.detalle ? ` ${extra.detalle}` : ""}`);
    this.name = "ErrorPortero";
    this.motivo = motivo;
    this.estado = estado;
    if (extra.que) this.que = extra.que;
    if (extra.liberaEn !== undefined) this.liberaEn = extra.liberaEn;
    if (extra.max !== undefined) this.max = extra.max;
    if (extra.razon) this.razon = extra.razon;
    if (extra.detalle) this.detalle = extra.detalle;
    if (extra.rige) this.rige = extra.rige;
    this.reintentable = motivo === "red" || motivo === "interno";
  }
}

/** Si un error es del portero. Por el nombre y la forma, no solo por la clase: el módulo se baja aparte. */
export function esErrorDelPortero(e: unknown): e is ErrorPortero {
  if (e instanceof ErrorPortero) return true;
  const x = e as { name?: unknown; motivo?: unknown; estado?: unknown } | null;
  return !!x && typeof x === "object" && x.name === "ErrorPortero" && typeof x.motivo === "string" && typeof x.estado === "number";
}

/* ----------------------------------------------------------------- el estado */

export interface CupoDeLaCuenta {
  sellos: { usados: number; max: number; quedan: number };
  sorteos: { usados: number; max: number; quedan: number };
  /** El primer instante del mes que viene, en ms (UTC): cuándo vuelve el cupo. */
  liberaEn: number;
}

/**
 * Quién paga ahora, para esta cuenta.
 *
 * - `pollar`: como siempre (también si no hay portero configurado: `configurado: false`).
 * - `portero`: paga el portero. `cupo` trae lo que le queda a la cuenta.
 * - `cerrado`: no se paga con nadie. El portero no contesta, está apagado o le falta configuración.
 */
export type EstadoDelPatrocinio =
  | { rige: "pollar"; configurado: boolean }
  | { rige: "portero"; cupo: CupoDeLaCuenta }
  | { rige: "cerrado"; motivo: "sin-respuesta" | "apagado" | "config" | "fondo" };

const numero = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const cuenta = (x: unknown): { usados: number; max: number; quedan: number } => {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return { usados: numero(o.usados), max: numero(o.max), quedan: numero(o.quedan) };
};

/**
 * Lee la respuesta de `/cupo`. Cualquier cosa que no se entienda es `cerrado`: ante la duda no se paga.
 *
 * Primero `rige`, que dice quién paga: con `pollar` se sigue como siempre, sin mirar `prendido` (el Worker lo manda
 * en falso, con `motivo:"pollar"`, porque `prendido` solo dice si el portero paga ahora). Con `portero`, se usa
 * solo si `prendido` es verdadero; si no, cerrado, con el `motivo` (`config`, `apagado`, `fondo`).
 */
export function leerCupo(estado: number, cuerpo: unknown, redEsperada: NetworkName = network.name): EstadoDelPatrocinio {
  if (estado !== 200 || !cuerpo || typeof cuerpo !== "object") return { rige: "cerrado", motivo: "sin-respuesta" };
  const o = cuerpo as Record<string, unknown>;
  // El portero dice de qué red es. Si no es la de este modo, no se le manda nada.
  if (typeof o.red === "string" && o.red !== redEsperada) return { rige: "cerrado", motivo: "sin-respuesta" };
  if (o.rige === "pollar") return { rige: "pollar", configurado: true };
  if (o.rige !== "portero") return { rige: "cerrado", motivo: "sin-respuesta" };
  if (o.prendido !== true) return { rige: "cerrado", motivo: o.motivo === "config" ? "config" : o.motivo === "apagado" ? "apagado" : o.motivo === "fondo" ? "fondo" : "sin-respuesta" };
  // Sin cuánto le queda a la cuenta no hay nada que decir ni que contar: un cupo que falta no es un cupo de cero.
  const sellos = (o.sellos && typeof o.sellos === "object" ? o.sellos : {}) as Record<string, unknown>;
  if (typeof sellos.quedan !== "number" || !Number.isFinite(sellos.quedan)) return { rige: "cerrado", motivo: "sin-respuesta" };
  return { rige: "portero", cupo: { sellos: cuenta(o.sellos), sorteos: cuenta(o.sorteos), liberaEn: numero(o.liberaEn) } };
}

/** La última vez que se preguntó, el servicio no contestó a tiempo: la próxima espera menos. */
let seAgotoElTiempo = false;

/**
 * Pregunta a `/cupo`. Lanza si no contesta a tiempo.
 *
 * Después de una espera entera sin respuesta, la próxima espera menos. Con la dirección por defecto (`porDefecto`) eso
 * dura hasta que el servicio conteste: sin respuesta rige Pollar, así que cortar rápido no frena a nadie. Sin ella, no
 * contestar es `cerrado` y frena el sello: la espera corta vale una sola vez, y la siguiente vuelve a ser entera, para
 * que una demora suelta no deje el sello cerrado hasta recargar la página con un servicio que contesta en 2 o 3 s.
 */
async function preguntar(url: string, g: string, f: Fetch, porDefecto: boolean): Promise<EstadoDelPatrocinio> {
  const control = new AbortController();
  const tope = seAgotoElTiempo ? TOPE_CUPO_TRAS_CAIDA_MS : TOPE_CUPO_MS;
  if (!porDefecto) seAgotoElTiempo = false;
  const reloj = setTimeout(() => control.abort(), tope);
  try {
    const r = await f(`${url}/v1/patrocinio/cupo?cuenta=${encodeURIComponent(g)}`, { method: "GET", cache: "no-store", signal: control.signal });
    seAgotoElTiempo = false;
    let cuerpo: unknown = null;
    try {
      cuerpo = await r.json();
    } catch {
      /* sin cuerpo que se entienda: cerrado */
    }
    return leerCupo(r.status, cuerpo);
  } catch (e) {
    if (control.signal.aborted && tope === TOPE_CUPO_MS) seAgotoElTiempo = true;
    throw e;
  } finally {
    clearTimeout(reloj);
  }
}

interface Guardado {
  g: string;
  hasta: number;
  estado: EstadoDelPatrocinio;
}
let guardado: Guardado | null = null;
let enCurso: { g: string; p: Promise<EstadoDelPatrocinio> } | null = null;

export interface OpcionesDeEstado {
  /** No usar lo que se supo hace poco: preguntar de nuevo. */
  forzar?: boolean;
  fetch?: Fetch;
  ahora?: () => number;
  /** Dirección del portero, si no es la del entorno (las pruebas). */
  url?: string | null;
  /** La dirección es la de por defecto (`patrocinio-config.ts`): sin respuesta, rige Pollar. Solo con `url`. */
  porDefecto?: boolean;
}

/** La dirección del portero y si es la de por defecto, según lo que se pasó o el entorno. */
function configDe(o: OpcionesDeEstado): { url: string | null; porDefecto: boolean } {
  return o.url === undefined ? configDelPortero() : { url: o.url, porDefecto: o.porDefecto === true };
}

/** Vuelve a esperar el tope entero la próxima vez que se pregunte (las pruebas; en la página, una respuesta lo hace sola). */
export function olvidarLaCaida(): void {
  seAgotoElTiempo = false;
}

/** Olvida lo que se supo del portero (cambió la cuenta, o se acaba de gastar un sello). */
export function olvidarElEstado(): void {
  guardado = null;
}

/**
 * Quién rige para esta cuenta y, si es el portero, lo que le queda. Sin portero configurado no consulta nada.
 * Lo último que se supo vale `VIGENCIA_MS` (`forzar` no lo usa); las preguntas en curso se comparten, también con `forzar`.
 */
export async function estadoDelPatrocinio(g: string | null | undefined, o: OpcionesDeEstado = {}): Promise<EstadoDelPatrocinio> {
  const config = configDe(o);
  const url = config.url;
  if (!url) return { rige: "pollar", configurado: false };
  const quien = g || CUENTA_DE_CONSULTA;
  const ahora = (o.ahora ?? Date.now)();
  if (!o.forzar && guardado && guardado.g === quien && guardado.hasta > ahora) return guardado.estado;
  // Una consulta en curso se espera, también con `forzar`: dos preguntas seguidas no son dos esperas.
  if (enCurso && enCurso.g === quien) return enCurso.p;
  const f = o.fetch ?? fetch;
  const p = preguntar(url, quien, f, config.porDefecto)
    .catch((): EstadoDelPatrocinio => ({ rige: "cerrado", motivo: "sin-respuesta" }))
    .then((estado) => {
      // Un "cerrado" por no contestar no se guarda: la próxima pregunta vuelve a intentar.
      guardado = estado.rige === "cerrado" && estado.motivo === "sin-respuesta" ? null : { g: quien, hasta: ahora + VIGENCIA_MS, estado };
      if (enCurso?.p === p) enCurso = null;
      // Con la dirección por defecto, un portero que no contesta no frena a nadie: rige Pollar, sin error a la vista.
      const rige: EstadoDelPatrocinio = config.porDefecto && estado.rige === "cerrado" && estado.motivo === "sin-respuesta" ? { rige: "pollar", configurado: false } : estado;
      avisar(quien, rige);
      return rige;
    });
  enCurso = { g: quien, p };
  return p;
}

/** Lo último que se supo de esta cuenta, sin preguntar nada. */
export function ultimoEstado(g: string | null | undefined): EstadoDelPatrocinio | null {
  return guardado && guardado.g === (g || CUENTA_DE_CONSULTA) ? guardado.estado : null;
}

/** La página se entera de que cambió lo que queda (la línea de "Te quedan…"). */
function avisar(g: string, estado: EstadoDelPatrocinio): void {
  if (typeof document === "undefined" || typeof document.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
  document.dispatchEvent(new CustomEvent("tinkazo:patrocinio", { detail: { cuenta: g, estado } }));
}

/* ------------------------------------------------------------- el patrocinador */

export interface Patrocinador {
  readonly nombre: "pollar" | "portero";
  /**
   * `true`: la billetera firma sin patrocinio y esta capa manda la transacción firmada (portero).
   * `false`: la billetera firma y manda de una vez (Pollar).
   */
  readonly firmaAntes: boolean;
  /**
   * Manda la transacción. Con el portero, `xdr` es la firmada. Con Pollar es la que se le entrega para que
   * la firme y la mande. Devuelve el hash y cómo la tomó la red (`PENDING` o `DUPLICATE`).
   */
  mandar(xdr: string): Promise<RespuestaEnvio & { hash: string }>;
  /** Quién rige y lo que le queda a la cuenta. */
  consultar(g: string): Promise<EstadoDelPatrocinio>;
}

/** Una billetera que firma y manda de una vez, como la de Pollar. */
export interface BilleteraQueManda {
  signAndSubmit(xdr: string): Promise<string>;
}

/** El camino de hoy: Pollar firma y paga. */
export function crearPollar(wallet: BilleteraQueManda, o: OpcionesDeEstado = {}): Patrocinador {
  return {
    nombre: "pollar",
    firmaAntes: false,
    mandar: async (xdr) => ({ status: "PENDING", hash: await wallet.signAndSubmit(xdr) }),
    consultar: (g) => estadoDelPatrocinio(g, o),
  };
}

const ESTADOS_QUE_DICE_EL_PORTERO = new Set(["PENDING", "DUPLICATE"]);

/** Traduce un no del portero a su error. */
export function errorDeRespuesta(estado: number, cuerpo: unknown): ErrorPortero {
  const o = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const texto = (x: unknown): string | undefined => (typeof x === "string" && x ? x.slice(0, 200) : undefined);
  const motivo = texto(o.motivo);
  const extra = {
    que: o.que === "sorteos" ? ("sorteos" as const) : o.que === "sellos" ? ("sellos" as const) : undefined,
    liberaEn: typeof o.liberaEn === "number" ? o.liberaEn : undefined,
    max: typeof o.max === "number" ? o.max : undefined,
    razon: texto(o.razon),
    detalle: texto(o.detalle) ?? texto(o.codigo),
    rige: texto(o.rige),
  };
  const conocido: Record<string, MotivoDelPortero> = {
    "cupo-cuenta": "cupo-cuenta",
    "cupo-ip": "cupo-ip",
    fondo: "fondo",
    apagado: "apagado",
    "no-permitida": "no-permitida",
    "cuenta-ajena": "cuenta-ajena",
    origen: "origen",
    fallaria: "fallaria",
    "fee-alta": "fee-alta",
    rechazada: "rechazada",
    red: "red",
    interno: "interno",
  };
  const m = (motivo && conocido[motivo]) || (estado === 502 ? "red" : estado >= 500 ? "interno" : "desconocido");
  return new ErrorPortero(m, estado, extra);
}

/** El portero: manda la transacción firmada y cuenta lo que queda. */
export function crearPortero(url: string, o: OpcionesDeEstado = {}): Patrocinador {
  const f = o.fetch ?? fetch;
  return {
    nombre: "portero",
    firmaAntes: true,
    async mandar(xdr) {
      // Un corte de red o el tope de tiempo se dejan como están: quien manda los trata como "quizás llegó".
      const r = await f(`${url}/v1/patrocinio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xdr }),
        signal: AbortSignal.timeout(TOPE_PAGO_MS),
      });
      let cuerpo: unknown = null;
      try {
        cuerpo = await r.json();
      } catch {
        /* sin cuerpo */
      }
      const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
      if (r.status !== 200) {
        // El portero ya no rige (se apagó o lo devolvieron a Pollar): la próxima vez se le pregunta de nuevo.
        if (r.status === 503) olvidarElEstado();
        throw errorDeRespuesta(r.status, cuerpo);
      }
      const hash = typeof c.hash === "string" ? c.hash : "";
      const status = typeof c.status === "string" && ESTADOS_QUE_DICE_EL_PORTERO.has(c.status) ? c.status : "PENDING";
      if (!/^[0-9a-f]{64}$/i.test(hash)) throw new ErrorPortero("interno", 200, { detalle: "sin-hash" });
      // Se gastó un sello: lo que queda cambió, y la línea de la página lo muestra sin preguntar otra vez.
      const previo = guardado && guardado.estado.rige === "portero" ? guardado : null;
      if (previo && previo.estado.rige === "portero" && typeof c.quedan === "number") {
        const cupo = previo.estado.cupo;
        const quedanSorteos = typeof c.quedanSorteos === "number" ? c.quedanSorteos : cupo.sorteos.quedan;
        const nuevo: EstadoDelPatrocinio = {
          rige: "portero",
          cupo: { ...cupo, sellos: { ...cupo.sellos, quedan: c.quedan, usados: Math.max(0, cupo.sellos.max - c.quedan) }, sorteos: { ...cupo.sorteos, quedan: quedanSorteos, usados: Math.max(0, cupo.sorteos.max - quedanSorteos) } },
        };
        guardado = { ...previo, estado: nuevo };
        avisar(previo.g, nuevo);
      } else {
        olvidarElEstado();
      }
      return { status, hash: hash.toLowerCase() };
    },
    consultar: (g) => estadoDelPatrocinio(g, { ...o, url }),
  };
}

/**
 * Quién paga a esta cuenta ahora. Lanza `ErrorPortero("cerrado")` si no se sabe o no se puede: antes de
 * pedirle a la persona que firme nada.
 */
export async function elegirPatrocinador(g: string, wallet: BilleteraQueManda, o: OpcionesDeEstado = {}): Promise<Patrocinador> {
  const { url, porDefecto } = configDe(o);
  // Con portero y sin dirección de la cuenta no se pregunta nada: el cupo sería el de una cuenta que no es de la persona.
  // Con la dirección por defecto el portero no es condición: sin cuenta que contar, rige Pollar, como antes de que existiera.
  if (url && !g && porDefecto) return crearPollar(wallet, { ...o, url, porDefecto });
  if (url && !g) throw new ErrorPortero("cerrado", 0, { detalle: "sin-cuenta" });
  const opciones = { ...o, url, porDefecto };
  const estado = await estadoDelPatrocinio(g, opciones);
  if (estado.rige === "pollar") return crearPollar(wallet, opciones);
  if (estado.rige === "cerrado" || !url) throw new ErrorPortero("cerrado", 0, { detalle: estado.rige === "cerrado" ? estado.motivo : "sin-url" });
  return crearPortero(url, opciones);
}
