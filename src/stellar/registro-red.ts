import type { CasoRed, Diagnostico, Nivel } from "./chequeo-red";

/**
 * Qué pasó con la red, para saber después qué pasó.
 *
 * Cada chequeo y cada decisión (reintentar, sellar con otra fuente, seguir sin
 * sello) deja una línea en este navegador y en la consola: minuto, red, servidor,
 * paso, caso, nivel, costo, umbral, latencia, ledger, versión del protocolo, acción
 * y cómo terminó. **Sin dirección de cuenta, sin nombres, sin la huella de la lista,
 * sin hashes de transacción y sin IP**: solo se guardan los campos de abajo (una
 * lista cerrada, no lo que venga), y lo que se escriba a mano se limpia. No sale de
 * la máquina: si alguien tiene que contar qué pasó, lo copia desde "Ver detalle".
 *
 * Las últimas 50, en `localStorage`. Sin almacenamiento (una ventana privada)
 * quedan en memoria mientras dure la pestaña.
 */

export const CLAVE_REGISTRO = "tinkazo.red.registro";
export const MAX_REGISTRO = 50;

export type PasoDelRegistro = "chequeo" | "boton" | "sellar" | "reintento" | "pagar-propio" | "cargar-saldo" | "sin-sello" | "sello-tarde";

export interface EntradaDeRegistro {
  /** `2026-10-25T23:41Z`: el minuto, no el segundo. */
  minuto: string;
  red: string;
  /** El nombre del servidor (`soroban-testnet.stellar.org`), nunca la dirección entera. */
  rpc?: string;
  paso: PasoDelRegistro;
  caso?: CasoRed | "ninguno";
  nivel?: Nivel;
  costoXlm?: number;
  umbralXlm?: number;
  ms?: number;
  ledger?: number;
  protocolo?: number;
  accion?: string;
  final?: string;
}

/** Lo que se pasa para anotar: lo mismo sin el minuto, que lo pone el reloj. */
export type Anotacion = Omit<EntradaDeRegistro, "minuto">;

let enMemoria: EntradaDeRegistro[] = [];

/** Una dirección de cuenta o de contrato, o un hash de 64 hexadecimales: no entran, ni escritos a mano. */
const DATO_PERSONAL = /\b[GCMW][A-Z2-7]{55,68}\b|\b[0-9a-f]{64}\b/gi;
const limpiarTexto = (s: string): string => s.replace(DATO_PERSONAL, "***").replace(/\s+/g, " ").trim().slice(0, 80);
const esNumero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Deja solo los campos conocidos, del tipo que van. Lo demás (una cuenta, una huella, un nombre) se pierde. */
export function limpiar(e: Anotacion & { minuto?: string }, minuto: string): EntradaDeRegistro {
  const x = e as Record<string, unknown>;
  const texto = (k: string): string | undefined => (typeof x[k] === "string" && x[k] ? limpiarTexto(x[k] as string) : undefined);
  const numero = (k: string): number | undefined => (esNumero(x[k]) ? Math.round((x[k] as number) * 1e7) / 1e7 : undefined);
  const rpcCrudo = texto("rpc");
  // De una dirección solo el servidor: sin camino, sin consulta, sin llaves.
  let rpc = rpcCrudo;
  if (rpcCrudo) {
    try {
      rpc = new URL(rpcCrudo).hostname;
    } catch {
      rpc = rpcCrudo.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
    }
  }
  const salida: EntradaDeRegistro = { minuto, red: texto("red") ?? "?", paso: (texto("paso") as PasoDelRegistro | undefined) ?? "chequeo" };
  if (rpc) salida.rpc = rpc;
  const caso = texto("caso");
  if (caso) salida.caso = caso as EntradaDeRegistro["caso"];
  const nivel = texto("nivel");
  if (nivel === "verde" || nivel === "amarillo" || nivel === "rojo") salida.nivel = nivel;
  for (const k of ["costoXlm", "umbralXlm", "ms", "ledger", "protocolo"] as const) {
    const n = numero(k);
    if (n !== undefined) salida[k] = n;
  }
  const accion = texto("accion");
  if (accion) salida.accion = accion;
  const fin = texto("final");
  if (fin) salida.final = fin;
  return salida;
}

const minutoDe = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + "Z";

/** Las anotaciones que hay, de la más nueva a la más vieja. */
export function leerRegistro(): EntradaDeRegistro[] {
  try {
    const raw = localStorage.getItem(CLAVE_REGISTRO);
    const lista = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(lista)) {
      return lista.filter((e): e is EntradaDeRegistro => !!e && typeof e === "object" && typeof (e as EntradaDeRegistro).minuto === "string").slice(0, MAX_REGISTRO);
    }
  } catch {
    /* sin almacenamiento, o con datos rotos: lo que haya en memoria */
  }
  return enMemoria.slice(0, MAX_REGISTRO);
}

/** Una línea legible: lo que se copia para contar qué pasó. */
export function lineaDelRegistro(e: EntradaDeRegistro): string {
  const partes: string[] = [e.minuto, e.paso, e.red];
  if (e.rpc) partes.push(e.rpc);
  if (e.caso) partes.push(`caso ${e.caso}`);
  if (e.nivel) partes.push(e.nivel);
  if (e.costoXlm !== undefined) partes.push(`costo ${e.costoXlm} XLM${e.umbralXlm !== undefined ? ` (umbral ${e.umbralXlm})` : ""}`);
  if (e.ms !== undefined) partes.push(`${e.ms} ms`);
  if (e.ledger !== undefined) partes.push(`ledger ${e.ledger}`);
  if (e.protocolo !== undefined) partes.push(`protocolo ${e.protocolo}`);
  if (e.accion) partes.push(`acción ${e.accion}`);
  if (e.final) partes.push(`final ${e.final}`);
  return partes.join(" · ");
}

/** Las últimas, listas para pegar en un mensaje. */
export function registroParaCopiar(cuantas = 10): string {
  return leerRegistro().slice(0, cuantas).map(lineaDelRegistro).join("\n");
}

/** Anota una línea. Nunca lanza: el registro no puede romper un sorteo. */
export function anotar(a: Anotacion, ahora = Date.now()): EntradaDeRegistro {
  const entrada = limpiar(a, minutoDe(ahora));
  const lista = [entrada, ...leerRegistro()].slice(0, MAX_REGISTRO);
  enMemoria = lista;
  try {
    localStorage.setItem(CLAVE_REGISTRO, JSON.stringify(lista));
  } catch {
    /* ventana privada o almacenamiento lleno: queda en memoria */
  }
  try {
    console.info("[tinkazo] red:", lineaDelRegistro(entrada));
  } catch {
    /* sin consola */
  }
  return entrada;
}

/** La anotación de un chequeo, con lo que mide. */
export function anotarChequeo(paso: PasoDelRegistro, d: Diagnostico, extra: Pick<Anotacion, "accion" | "final"> = {}, ahora = Date.now()): EntradaDeRegistro {
  return anotar(
    {
      red: d.red,
      ...(d.rpc ? { rpc: d.rpc } : {}),
      paso,
      caso: d.caso ?? "ninguno",
      nivel: d.nivel,
      ...(d.costoXlm !== null ? { costoXlm: d.costoXlm } : {}),
      umbralXlm: d.rojoXlm,
      ...(d.ms !== null ? { ms: d.ms } : {}),
      ...(d.ledger !== null ? { ledger: d.ledger } : {}),
      ...(d.protocolo !== null ? { protocolo: d.protocolo } : {}),
      ...extra,
    },
    ahora,
  );
}

/** Borra todo (las pruebas, y quien quiera empezar de cero). */
export function olvidarRegistro(): void {
  enMemoria = [];
  ultimaSaturacion = 0;
  try {
    localStorage.removeItem(CLAVE_REGISTRO);
  } catch {
    /* nada que borrar */
  }
}

/* ------------------------------------------- la red dijo "estoy llena" hace poco */

let ultimaSaturacion = 0;

/** Una transacción volvió con `TRY_AGAIN_LATER`: la red no la tomó por estar llena. */
export function anotarSaturacion(ahora = Date.now()): void {
  ultimaSaturacion = ahora;
}

/** Hubo un `TRY_AGAIN_LATER` en los últimos 5 minutos. */
export function saturacionReciente(ahora = Date.now(), ventanaMs = 5 * 60_000): boolean {
  return ultimaSaturacion > 0 && ahora - ultimaSaturacion < ventanaMs;
}
