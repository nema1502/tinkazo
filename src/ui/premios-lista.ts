import { type EstadoVistoDelPremio, type VistaDeLosPremios } from "../campana/premios-de-la-cuenta";

/**
 * La lista Tus premios de la pantalla de quien ganó, sin DOM ni red (como la vista
 * del paso de la cuenta en `cuenta-lista-estado.ts`): cada premio de esa cuenta en el orden en que la
 * promoción los guarda, con el texto de su estado (`textos-premios.ts`) y el monto como se ve en pantalla.
 *
 * Lo que no se pudo leer no se muestra ni se inventa: la lista va vacía y la pantalla dice por qué.
 */

/** Un texto de la lista: la clave de los textos de la pantalla y lo que va en sus {huecos}. */
export interface TextoDeLaLista {
  clave: string;
  vars?: Record<string, string>;
}

/** Un renglón de la lista: el estado como texto y el monto ya legible, o `null` si no se supo. */
export interface FilaDeLosPremios {
  texto: TextoDeLaLista;
  monto: string | null;
}

/** Cuándo se puede recibir, escrito para mostrar. Quien la llama decide como se ve la fecha. */
export interface OpcionesDeLaLista {
  premios: VistaDeLosPremios;
  /** La fecha límite, ya escrita en el idioma de la pantalla. */
  fecha: (hastaMs: number) => string;
  /** `(es | en)`, para el punto decimal del monto. */
  idioma: "es" | "en";
}

/** El texto de la fecha límite de un premio: el renglón del estado lleva la fecha y nada más. */
const textoDelEstado = (estado: EstadoVistoDelPremio, fecha: (hastaMs: number) => string, hastaMs: number): TextoDeLaLista =>
  estado === "por-recibir" ? { clave: "prEstadoPorRecibir", vars: { fecha: fecha(hastaMs) } } : { clave: estado === "recibido" ? "prEstadoRecibido" : "prEstadoVolvio" };

/** El monto, como lo ve la pantalla: las unidades mínimas del activo, con el punto decimal del idioma. */
export const montoLegible = (unidades: string, idioma: "es" | "en"): string | null => {
  if (!/^\d+$/u.test(unidades)) return null;
  try {
    return new Intl.NumberFormat(idioma === "en" ? "en" : "es", { maximumFractionDigits: 7 }).format(Number(unidades) / 1e7);
  } catch {
    return null;
  }
};

/** Los renglones de «Tus premios»: uno por premio de la cuenta, en el orden en que la promoción los guarda. */
export function filasDeLosPremios(o: OpcionesDeLaLista): { filas: FilaDeLosPremios[] } {
  if (!o.premios.ok) return { filas: [] };
  return {
    filas: o.premios.premios.map((p) => ({
      texto: textoDelEstado(p.estado, o.fecha, p.hastaMs ?? 0),
      monto: p.monto === null ? null : montoLegible(p.monto, o.idioma),
    })),
  };
}
