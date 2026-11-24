/**
 * Las bases del sorteo: se escriben solas a partir de lo cargado, en los dos idiomas, y quien arma la campaña las puede
 * cambiar. Cada renglón es una clave de texto, así la página recibe sus textos como las demás.
 */

import type { Lang } from "../../idioma";
import { horaTexto, montoTexto } from "../formato";
import type { Bilingue } from "../modelo";
import { sustituir } from "../sustituir";
import { UNIDADES_POR_DOLAR } from "./constantes";
import type { BasesDelFormulario } from "./estado";

export interface DatosDeLasBases {
  marca: string;
  ganan: number;
  monto: number;
  sorteoMs: number;
  zona: string;
  /** Si hay algún pedido: cambia el renglón de las redes. */
  conRedes: boolean;
  /** El costo de retirar escrito en cada idioma, o null si el sitio no cobra retiros. */
  costo: { es: string | null; en: string | null };
}

/** Busca el texto de una clave en un idioma: la página pasa el de su diccionario. */
export type Diccionario = (idioma: Lang, clave: string) => string;

/** Las claves de los renglones, escritas como cadenas para que la página las reciba. */
export const CLAVES_DE_LAS_BASES = [
  "ccBase1",
  "ccBase2Redes",
  "ccBase2Sin",
  "ccBase3Uno",
  "ccBase3Varios",
  "ccBase4",
  "ccBase5",
  "ccBase5Costo",
  "ccBase6",
  "ccBase7",
  "ccBase8",
] as const;

function renglones(d: DatosDeLasBases, dic: Diccionario, idioma: Lang): string {
  const valores = {
    marca: d.marca,
    n: String(d.ganan),
    monto: montoTexto(BigInt(d.monto) * UNIDADES_POR_DOLAR, idioma),
    hora: horaTexto(d.sorteoMs, d.zona, idioma),
  };
  const dicho = (clave: string, extra: Record<string, string> = {}): string => sustituir(dic(idioma, clave), { ...valores, ...extra });
  const costo = idioma === "es" ? d.costo.es : d.costo.en;
  const quinto = costo === null ? dicho("ccBase5") : `${dicho("ccBase5")} ${dicho("ccBase5Costo", { costo })}`;
  return [
    dicho("ccBase1"),
    d.conRedes ? dicho("ccBase2Redes") : dicho("ccBase2Sin"),
    d.ganan === 1 ? dicho("ccBase3Uno") : dicho("ccBase3Varios"),
    dicho("ccBase4"),
    quinto,
    dicho("ccBase6"),
    dicho("ccBase7"),
    dicho("ccBase8"),
  ].join("\n");
}

/** Las bases que se escriben solas, en los dos idiomas. */
export function basesAutomaticas(d: DatosDeLasBases, dic: Diccionario): Bilingue {
  return { es: renglones(d, dic, "es"), en: renglones(d, dic, "en") };
}

/**
 * Las bases que viajan: lo escrito a mano si lo hay y si no las automáticas. `desfasadas` dice si algún idioma editado se
 * escribió con otros datos que los de ahora (se cambió el premio después): nada se pisa sin avisar.
 */
export function basesFinales(b: BasesDelFormulario, automaticas: Bilingue): { bases: Bilingue; desfasadas: boolean } {
  const desfasadas = (b.es !== null && b.moldeEs !== automaticas.es) || (b.en !== null && b.moldeEn !== automaticas.en);
  return { bases: { es: b.es ?? automaticas.es, en: b.en ?? automaticas.en }, desfasadas };
}
