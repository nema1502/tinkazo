/** Tipos de scripts/lib/revision-portero.mjs, que es JavaScript sin dependencias: lo importan el guion de GitHub y el Worker. */

export declare const MARGEN_MINIMO: number;
export declare const MAX_SIN_EXPLICAR: number;
export declare const TRAMOS_SIN_EXPLICAR: number[];
export declare const RECORDATORIO_HORAS: number;
export declare const SIN_LECTURA: string;
export declare const HORA_MS: number;

export interface Revision {
  /** Los problemas con palabras, sin cifras. */
  problemas: string[];
  /** Una clave estable por problema, en el mismo orden que `problemas`. */
  claves: string[];
}

export interface Recordado {
  claves: string[];
  avisadoEn: string | null;
}

export interface Decision {
  avisar: boolean;
  motivo: "sin-problemas" | "sin-memoria" | "nuevo" | "recordatorio" | "ya-avisado";
  nuevos: string[];
  siguiente: Recordado;
}

/** Un texto del portero en una sola línea: caracteres de control y espacios seguidos a un espacio, cortado en `max` (70 por defecto). */
export declare function textoLimpio(x: unknown, max?: number): string;
/** Las banderas prendidas del patrocinio, limpias, ordenadas y diez como mucho. Lo que no es una lista, una lista vacía. */
export declare function prendidosLimpios(prendidos: unknown): string[];
export declare function revisarPortero(estado: unknown): Revision;
export declare const sinRecordar: () => Recordado;
export declare function leerRecordado(texto: string): Recordado;
export declare const escribirRecordado: (recordado: Recordado) => string;
export declare function decidirAviso(datos: { claves: string[]; recordado?: Recordado; ahora: Date; usarMemoria?: boolean }): Decision;
export declare function grupoDeClave(clave: string): string;
export declare function arreglados(recordadas: string[], actuales: string[]): string[];
