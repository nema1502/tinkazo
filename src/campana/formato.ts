/**
 * Formatos de premios y horarios de una campaña.
 * Usa los formatos internacionales para respetar idioma, separadores y zona del evento.
 */

import type { Lang } from "../idioma";
import { TEXTOS_CAMPANA } from "./textos";

/** Convierte unidades de siete decimales a un monto visible, truncado a centavos. */
export function montoTexto(unidades: bigint, idioma: Lang): string {
  const entero = unidades / 10000000n;
  const centavos = (unidades % 10000000n) / 100000n;
  const numero = Number(entero) + Number(centavos) / 100;
  return new Intl.NumberFormat(idioma === "es" ? "es-BO" : "en-US", {
    minimumFractionDigits: centavos > 0n ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(numero);
}

/**
 * El premio de una campaña como se pone en el cuadro del sorteo: siempre en español y sin separador de miles, con coma para
 * los centavos. Quien paga el premio lee el monto de ese texto, y "1.000" se leería como 1.
 */
export function premioParaElCuadro(unidades: bigint): string {
  const entero = unidades / 10000000n;
  const centavos = (unidades % 10000000n) / 100000n;
  const monto = centavos > 0n ? `${entero},${String(centavos).padStart(2, "0")}` : String(entero);
  return (TEXTOS_CAMPANA.es.cpPremio1 ?? "").replace("{monto}", monto);
}

/** Junta montos sin coma de serie en inglés y sin ambigüedad entre decimales en español. */
function listaDeMontos(montos: readonly string[], idioma: Lang): string {
  if (montos.length < 2) return montos[0] ?? "";
  if (idioma === "es" && montos.some((monto) => monto.includes(","))) return montos.join(" / ");
  const ultimo = montos[montos.length - 1] ?? "";
  const iniciales = montos.slice(0, -1).join(", ");
  return `${iniciales} ${idioma === "es" ? "y" : "and"} ${ultimo}`;
}

/** Arma el texto del premio según la cantidad y si todos los montos coinciden. */
export function premiosTexto(premios: readonly bigint[], idioma: Lang): string {
  const montos = premios.map((premio) => montoTexto(premio, idioma));
  const lista = listaDeMontos(montos, idioma);
  const clave = premios.length === 1
    ? "cpPremio1"
    : premios.every((premio) => premio === premios[0])
      ? "cpPremioIguales"
      : "cpPremioDistintos";
  const texto = TEXTOS_CAMPANA[idioma][clave] ?? "";
  const monto = montos[0] ?? "";
  return texto.replace("{monto}", monto).replace("{montos}", lista).replace("{n}", String(premios.length));
}

/** Formatea un día en la zona de la campaña, con año solo cuando se pide para un plazo. */
export function fechaTexto(ms: number, zona: string, idioma: Lang, conAnio = false): string {
  return new Intl.DateTimeFormat(idioma === "es" ? "es-BO" : "en-US", {
    timeZone: zona,
    day: "numeric",
    month: "long",
    ...(conAnio ? { year: "numeric" as const } : {}),
  }).format(ms);
}

/** Formatea una hora en la zona de la campaña, de 00:00 a 23:59. */
export function horaTexto(ms: number, zona: string, idioma: Lang): string {
  return new Intl.DateTimeFormat(idioma === "es" ? "es-BO" : "en-US", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}
