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

const CLAVE_DEL_ESTADO: Record<Exclude<EstadoVistoDelPremio, "por-recibir">, string> = {
  recibido: "prEstadoRecibido",
  volvio: "prEstadoVolvio",
  vencido: "prEstadoVencido",
  "sin-confirmar": "prEstadoSinConfirmar",
};

/**
 * El texto del estado de un premio. Por recibir lleva la fecha límite y nada más. Sin una fecha que se pueda escribir
 * (no es un número finito, o quien la escribe falla) no se inventa ninguna: el renglón dice que falta confirmar.
 */
function textoDelEstado(estado: EstadoVistoDelPremio, fecha: (hastaMs: number) => string, hastaMs: number | null): TextoDeLaLista {
  if (estado !== "por-recibir") return { clave: CLAVE_DEL_ESTADO[estado] };
  if (hastaMs === null || !Number.isFinite(hastaMs)) return { clave: CLAVE_DEL_ESTADO["sin-confirmar"] };
  try {
    return { clave: "prEstadoPorRecibir", vars: { fecha: fecha(hastaMs) } };
  } catch {
    return { clave: CLAVE_DEL_ESTADO["sin-confirmar"] };
  }
}

/** El monto, como lo ve la pantalla: las unidades mínimas del activo, con el punto decimal del idioma. */
export const montoLegible = (unidades: string, idioma: "es" | "en"): string | null => {
  if (!/^\d+$/u.test(unidades)) return null;
  try {
    // Del texto, sin pasar por un número de coma flotante: la parte entera como BigInt y las siete cifras de la fracción tal cual.
    const lleno = unidades.padStart(8, "0");
    const entera = BigInt(lleno.slice(0, -7));
    const fraccion = lleno.slice(-7).replace(/0+$/u, "");
    const formato = new Intl.NumberFormat(idioma === "en" ? "en" : "es");
    const texto = formato.format(entera);
    if (fraccion === "") return texto;
    const coma = formato.formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";
    return `${texto}${coma}${fraccion}`;
  } catch {
    return null;
  }
};

/** Los renglones de «Tus premios»: uno por premio de la cuenta, en el orden en que la promoción los guarda. */
export function filasDeLosPremios(o: OpcionesDeLaLista): { filas: FilaDeLosPremios[] } {
  if (!o.premios.ok) return { filas: [] };
  return {
    filas: o.premios.premios.map((p) => ({
      texto: textoDelEstado(p.estado, o.fecha, p.hastaMs),
      monto: p.monto === null ? null : montoLegible(p.monto, o.idioma),
    })),
  };
}
