import type { MotivoDeBusqueda } from "./buscar-cuenta";

/**
 * Por qué no se pudo entrar con una llave que no está en este aparato. Cruza el puente como un error común: el kit y el SDK
 * que trae no se ven desde afuera.
 * - `sin-cuenta`, `vencida`: la búsqueda no encontró la cuenta o ya terminó.
 * - `sin-nacimiento`, `ambigua`, `firmantes`, `rechazada`: la cuenta existe pero no se pudo dar por buena. Por cuidado no se usa.
 * - `red`: no se pudo leer la red ahora. Puede pasar y se prueba de nuevo.
 */
export type MotivoDeEntrada = MotivoDeBusqueda | "firmantes" | "rechazada";

export class ErrorDeEntrada extends Error {
  readonly motivo: MotivoDeEntrada;

  constructor(motivo: MotivoDeEntrada, detalle?: string) {
    super(detalle ? `${motivo}: ${detalle}` : motivo);
    this.name = "ErrorDeEntrada";
    this.motivo = motivo;
  }
}

/** Los códigos de error del kit que dicen que la cuenta no se pudo dar por buena. */
const CODIGO_DE_CODIGO_NO_ACEPTADO = 2004;
const CODIGO_DE_NACIMIENTO_SIN_VERIFICAR = 2005;
const CODIGO_DE_FIRMANTE_SIN_VERIFICAR = 2006;
const CODIGO_DE_CUENTA_AMBIGUA = 2007;

/**
 * Pasa un error del kit a uno de la prueba, mirando su código y su contexto y no su texto. Lo que no es del kit (el rechazo del
 * navegador, por ejemplo) vuelve igual, para que se lo pueda reconocer.
 * - 2005 con `transaction_not_found`: la red todavía no mostraba lo que se acababa de encontrar. Es pasajero.
 * - 2004, 2005 con otra razón, 2006 y 2007: la cuenta se rechaza.
 * - El error común de que no hay contrato: la instancia se había leído un momento antes. Es pasajero.
 */
export function clasificarErrorDelKit(e: unknown): unknown {
  if (e instanceof ErrorDeEntrada) return e;
  if (typeof e !== "object" || e === null) return e;
  const o = e as { code?: unknown; context?: unknown; message?: unknown };
  const razon = typeof o.context === "object" && o.context !== null ? (o.context as { reason?: unknown }).reason : undefined;
  const detalle = typeof razon === "string" ? razon : typeof o.code === "number" ? String(o.code) : undefined;
  if (o.code === CODIGO_DE_NACIMIENTO_SIN_VERIFICAR) return new ErrorDeEntrada(razon === "transaction_not_found" ? "red" : "rechazada", detalle);
  if (o.code === CODIGO_DE_CODIGO_NO_ACEPTADO || o.code === CODIGO_DE_FIRMANTE_SIN_VERIFICAR || o.code === CODIGO_DE_CUENTA_AMBIGUA) return new ErrorDeEntrada("rechazada", detalle);
  if (typeof o.message === "string" && o.message.startsWith("Smart account contract not found")) return new ErrorDeEntrada("red", "instancia");
  return e;
}
