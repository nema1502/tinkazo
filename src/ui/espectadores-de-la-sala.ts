import type { Game, Pace } from "../state";
import { network, type NetworkName } from "../stellar/config";

/**
 * Lo que la sala recuerda de los QR de espectadores que mostró, por sello.
 *
 * Desde que un QR de la espera en grande se ve, puede haber celulares mirando con el juego y la duración que lleva su
 * enlace (`espectador-enlace.ts`). La sala lo anota acá: cada enlace corto que llegó a verse (con su clave y su
 * permiso, para reescribirlo si el servicio lo deja), el juego y la duración publicados, y si después cambió alguno de
 * los dos. Con eso:
 *
 * - la sala sabe si hay celulares mirando y si puede grabar mientras juega (`puerta-de-la-grabacion.ts`);
 * - Cambiar de juego vuelve a estar con el QR a la vista: el cambio se publica en el mismo enlace o en uno nuevo
 *   (`espera.ts`), y se anota, porque algún celular puede seguir con el de antes.
 *
 * Hasta el 16 de noviembre de 2026, desde que el QR se veía el juego y la duración quedaban fijos (`espectador-fijo.ts`).
 *
 * Se guarda en `localStorage`: una recarga de la página no olvida que hay celulares mirando. Lo de más de un día se va.
 * Sin almacenamiento, se recuerda en la memoria de la página.
 */

export interface EnlaceMostrado {
  /** El id del enlace corto. */
  id: string;
  /** La clave del fragmento (base64url de 16 bytes): el contenido nuevo se cifra con la misma. */
  clave: string;
  /** El permiso del enlace, para reescribirlo. */
  permiso: string;
  /** El servicio dijo que este enlace se puede reescribir. */
  cambia: boolean;
  /** La versión que tiene el servicio, para reescribirlo sin pisar una más nueva. */
  version: string | null;
  /** El largo fijo del contenido: todas sus versiones miden lo mismo. */
  largo: number;
  /** El contador del contenido: el celular nunca vuelve a uno menor. */
  n: number;
  /** La huella del contenido que lleva ahora: volver a abrir la espera con lo mismo muestra este mismo QR. */
  huella?: string;
}

export interface DelSello {
  /** El juego y la duración publicados por última vez. */
  juego: Game;
  ritmo: Pace;
  enlaces: EnlaceMostrado[];
  /** Cambió el juego o la duración después de mostrar el primer QR. */
  cambio: boolean;
  /** Cuándo se tocó por última vez (ms). */
  t: number;
}

const GUARDADOS = "tinkazo.espectadores";
/** Lo que vive lo anotado. */
export const VIVE_MS = 24 * 60 * 60 * 1000;

let memoria: Record<string, DelSello> | null = null;

function leer(): Record<string, DelSello> {
  if (memoria) return memoria;
  let todo: Record<string, DelSello> = {};
  try {
    const raw = localStorage.getItem(GUARDADOS);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) todo = v as Record<string, DelSello>;
  } catch {
    /* sin almacenamiento: la memoria de la página */
  }
  const ahora = Date.now();
  for (const [k, d] of Object.entries(todo)) if (!d || typeof d.t !== "number" || ahora - d.t > VIVE_MS) delete todo[k];
  memoria = todo;
  return todo;
}

function escribir(): void {
  try {
    localStorage.setItem(GUARDADOS, JSON.stringify(memoria ?? {}));
  } catch {
    /* sin almacenamiento, queda en la memoria de la página */
  }
}

/** La clave de un sello: la red, el contrato y el número del sorteo. Sin sello en Stellar no hay QR, y no hay clave. */
export function claveDelSello(f: { raffleId?: bigint } | null | undefined, red: NetworkName = network.name, contrato: string | null = network.contractId): string | null {
  if (!f || f.raffleId === undefined || !contrato) return null;
  return `${red}:${contrato}:${f.raffleId}`;
}

/** Lo anotado de un sello, o null. */
export function delSello(f: { raffleId?: bigint } | null | undefined, red?: NetworkName, contrato?: string | null): DelSello | null {
  const k = claveDelSello(f, red, contrato);
  return k ? (leer()[k] ?? null) : null;
}

/** Se vio un QR de espectadores de este sello. */
export const hayEspectadores = (f: { raffleId?: bigint } | null | undefined, red?: NetworkName, contrato?: string | null): boolean => (delSello(f, red, contrato)?.enlaces.length ?? 0) > 0;

/** Cambió el juego o la duración después de mostrar el QR de este sello. */
export const cambioConQr = (f: { raffleId?: bigint } | null | undefined, red?: NetworkName, contrato?: string | null): boolean => delSello(f, red, contrato)?.cambio === true;

/** El juego y la duración publicados por última vez para este sello, o null. */
export function publicado(f: { raffleId?: bigint } | null | undefined, red?: NetworkName, contrato?: string | null): { juego: Game; ritmo: Pace } | null {
  const d = delSello(f, red, contrato);
  return d ? { juego: d.juego, ritmo: d.ritmo } : null;
}

/** Un QR de este sello llegó a verse, con este juego y esta duración. */
export function anotarQrMostrado(f: { raffleId?: bigint }, juego: Game, ritmo: Pace, enlace: EnlaceMostrado, red?: NetworkName, contrato?: string | null): void {
  const k = claveDelSello(f, red, contrato);
  if (!k) return;
  const todo = leer();
  const d = todo[k];
  if (!d) todo[k] = { juego, ritmo, enlaces: [enlace], cambio: false, t: Date.now() };
  else {
    const i = d.enlaces.findIndex((e) => e.id === enlace.id);
    if (i >= 0) d.enlaces[i] = enlace;
    else d.enlaces.push(enlace);
    d.juego = juego;
    d.ritmo = ritmo;
    d.t = Date.now();
  }
  escribir();
}

/** Lo que el servicio dijo de un enlace después de reescribirlo: su versión y su contador nuevos. */
export function anotarVersion(f: { raffleId?: bigint }, id: string, version: string | null, n: number, red?: NetworkName, contrato?: string | null): void {
  const d = delSello(f, red, contrato);
  const e = d?.enlaces.find((x) => x.id === id);
  if (!d || !e) return;
  e.version = version;
  e.n = n;
  d.t = Date.now();
  escribir();
}

/**
 * La sala eligió este juego y esta duración. Si ya se vio un QR de este sello y no son los publicados, queda anotado
 * que cambió (y no se borra aunque vuelva al de antes: algún celular pudo leer el del medio). Devuelve si fue un cambio.
 */
export function anotarCambio(f: { raffleId?: bigint } | null | undefined, juego: Game, ritmo: Pace, red?: NetworkName, contrato?: string | null): boolean {
  const d = delSello(f, red, contrato);
  if (!d || !d.enlaces.length) return false;
  if (d.juego === juego && d.ritmo === ritmo) return false;
  d.cambio = true;
  d.juego = juego;
  d.ritmo = ritmo;
  d.t = Date.now();
  escribir();
  return true;
}

/** Para las pruebas: olvida todo, o solo la memoria de la página (lo guardado queda, como al recargar). */
export function olvidarEspectadores(o: { soloMemoria?: boolean } = {}): void {
  memoria = null;
  if (o.soloMemoria) return;
  try {
    localStorage.removeItem(GUARDADOS);
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * La sala cambió el juego o la duración (el selector, la espera, la duración de la página). Si ya se vio un QR de este
 * sello, se anota y se avisa: la espera, si está abierta, lo publica en el mismo enlace o en uno nuevo (`espera.ts`).
 */
export function avisarCambioConQr(f: { raffleId?: bigint } | null | undefined, juego: Game, ritmo: Pace): void {
  if (!anotarCambio(f, juego, ritmo)) return;
  document.dispatchEvent(new CustomEvent("tinkazo:cambio-con-qr"));
}
