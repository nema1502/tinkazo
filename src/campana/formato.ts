/**
 * Formatos de premios y horarios de una campaña.
 * Usa los formatos internacionales para respetar idioma, separadores y zona del evento.
 */

import type { Lang } from "../idioma";
import type { Campana } from "./modelo";
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

/** Cómo se redondea un monto que no cae en un centavo justo: hacia abajo, hacia arriba (lo que hay que mandar) o sin recortar. */
export type RedondeoDeMonto = "abajo" | "arriba" | "exacto";

const UN_CENTAVO = 100000n;

/**
 * Un monto de plata como se lo muestra a la persona: siempre con dos decimales, con coma en español y punto en inglés.
 * Lo que no llega a un centavo se recorta con enteros, nunca con decimales sueltos, y por defecto hacia abajo para no
 * inventar plata. Lo que hay que mandar se pide con "arriba" para no quedarse corto. Un monto con más precisión que un
 * centavo se dice exacto (con hasta siete decimales) si se pide "exacto", o si es menor que un centavo, para que nunca
 * diga 0,00 cuando algo llegó.
 */
export function montoConCentavos(unidades: bigint, idioma: Lang, redondeo: RedondeoDeMonto = "abajo"): string {
  const local = idioma === "es" ? "es-BO" : "en-US";
  const resto = unidades % UN_CENTAVO;
  if (resto !== 0n && (redondeo === "exacto" || (redondeo === "abajo" && unidades < UN_CENTAVO))) {
    return new Intl.NumberFormat(local, { minimumFractionDigits: 2, maximumFractionDigits: 7 }).format(Number(unidades) / 1e7);
  }
  const centavos = unidades / UN_CENTAVO + (redondeo === "arriba" && resto !== 0n ? 1n : 0n);
  const numero = Number(centavos / 100n) + Number(centavos % 100n) / 100;
  return new Intl.NumberFormat(local, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numero);
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

/**
 * El premio que `premioParaElCuadro` puso en el cuadro (siempre en español, es lo que se sella), dicho en el idioma de la pantalla.
 * Solo para mostrarlo, por ejemplo en la barra de abajo: lo que se sella no cambia. Un texto que no tiene esa forma vuelve igual.
 */
export function premioDelCuadroEnIdioma(texto: string, idioma: Lang): string {
  if (idioma === "es") return texto;
  const molde = (TEXTOS_CAMPANA.es.cpPremio1 ?? "").split("{monto}");
  if (molde.length !== 2) return texto;
  const [antes = "", despues = ""] = molde;
  const t = texto.trim();
  if (!t.startsWith(antes) || !t.endsWith(despues) || t.length < antes.length + despues.length) return texto;
  const monto = t.slice(antes.length, t.length - despues.length);
  if (!/^[0-9]+(,[0-9]{2})?$/.test(monto)) return texto;
  return (TEXTOS_CAMPANA[idioma].cpPremio1 ?? "").replace("{monto}", monto.replace(",", "."));
}

/** Junta montos sin coma de serie en inglés y sin ambigüedad entre decimales en español. */
function listaDeMontos(montos: readonly string[], idioma: Lang): string {
  if (montos.length < 2) return montos[0] ?? "";
  if (idioma === "es" && montos.some((monto) => monto.includes(","))) return montos.join(" / ");
  const ultimo = montos[montos.length - 1] ?? "";
  const iniciales = montos.slice(0, -1).join(", ");
  return `${iniciales} ${idioma === "es" ? "y" : "and"} ${ultimo}`;
}

/**
 * Arma el texto del premio según la cantidad y si todos los montos coinciden. Con "conCentavos" cada monto lleva dos decimales,
 * como los demás montos de plata del panel del servicio. Sin él, como siempre: un monto entero no lleva decimales.
 */
export function premiosTexto(premios: readonly bigint[], idioma: Lang, conCentavos = false): string {
  const montos = premios.map((premio) => (conCentavos ? montoConCentavos(premio, idioma) : montoTexto(premio, idioma)));
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

/**
 * El premio de una campaña como lo lee la persona. En una campaña con el premio entregado en mano es lo que se escribió, en el
 * idioma de la pantalla, y con varias personas dice para cuántas: nunca un monto, porque los montos van en cero. Sin premio en
 * mano, el de siempre (`premiosTexto`). El texto se pone tal cual, sin tocar nada de lo que escribió quien organiza.
 */
export function textoDelPremio(c: Pick<Campana, "premios" | "premioEnMano">, idioma: Lang, conCentavos = false): string {
  if (c.premioEnMano === undefined) return premiosTexto(c.premios, idioma, conCentavos);
  const texto = TEXTOS_CAMPANA[idioma][c.premios.length === 1 ? "cpPremioMano1" : "cpPremioManoVarios"] ?? "";
  const valores: Record<string, string> = { premio: c.premioEnMano[idioma], n: String(c.premios.length) };
  return texto.replace(/\{(premio|n)\}/gu, (_, clave: string) => valores[clave] ?? "");
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
