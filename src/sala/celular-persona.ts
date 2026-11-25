import type { EstadoPropio } from "../campana/celular";
import {
  anotarConLector,
  consultarYo,
  leerAlta,
  resultadoDeCampana,
  type AltaEnCampana,
  type DependenciasDeCampana,
  type Lectura,
  type OpcionesDeAlta,
} from "./campana";
import type { Dependencias } from "./cliente";

/**
 * La sala de una campaña de personas, vista desde el celular de quien se anota. Es la misma sala y las mismas esperas que en
 * una campaña de cuentas (`campana.ts`), con tres diferencias: el alta lleva el token de identidad de Google y no una sesión
 * del proveedor de cuentas, la consulta propia va solo con la llave de este celular y el resultado nombra a quienes ganaron por
 * su línea de persona. Lo que contesta el servicio está en `workers/sala/src/index.ts` (ruta `campana/alta`).
 *
 * El token de Google viaja solo en el cuerpo del alta. Nada de acá lo guarda ni lo escribe en la consola.
 */

/** Una línea de persona, con su única escritura posible: 26 letras y la última con los dos bits de sobra en cero. */
export function esLineaDePersona(x: unknown): x is string {
  return typeof x === "string" && /^p1:[a-z2-7]{25}[aeimquy4]$/u.test(x);
}

export interface CuerpoDeAltaDePersona {
  /** El token de identidad que entregó el botón de Google. */
  google: string;
  d: string;
  llave: string;
  p: string | null;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Traduce una respuesta del alta de una campaña de personas. Lo que sale bien no lleva cuenta ni línea, solo `anotada`. Lo demás
 * se lee como el alta de siempre, con dos diferencias: Google sin contestar (`502 google`) es pasajero y se repite, y la sala
 * con el modo apagado (`503 personas-apagadas`) no se arregla esperando.
 */
export function leerAltaDePersona(estado: number, cuerpo: unknown): Lectura {
  const error = esObjeto(cuerpo) && typeof cuerpo.error === "string" ? cuerpo.error : null;
  if (estado === 201 || estado === 200) {
    const ya = esObjeto(cuerpo) && cuerpo.ya === true;
    if (!esObjeto(cuerpo) || cuerpo.anotada !== true || (estado === 200) !== ya) return { tipo: "final", motivo: "otro" };
    // La lectura compartida pide una cuenta: acá no hay ninguna y quien llama no la usa.
    return { tipo: "listo", cuenta: "", ya };
  }
  if (estado === 503 && error === "personas-apagadas") return { tipo: "final", motivo: "apagada" };
  return leerAlta(estado, cuerpo);
}

/**
 * Anota a la persona con el token de identidad de Google. Se repite sola cuando la sala o Google están llenos y avisa con
 * `alReintentar`. Un pedido que queda sin respuesta se manda una vez más: si entonces contesta `ya`, es un alta nueva.
 */
export async function anotarPersonaEnCampana(
  servicio: string,
  sala: string,
  cuerpo: CuerpoDeAltaDePersona,
  dep: DependenciasDeCampana = {},
  alReintentar: (aviso: "mucha" | "creando") => void = () => undefined,
  opciones: OpcionesDeAlta = {},
): Promise<AltaEnCampana> {
  const cuerpoJson = JSON.stringify({ google: cuerpo.google, d: cuerpo.d, llave: cuerpo.llave, p: cuerpo.p });
  return anotarConLector(servicio, sala, cuerpoJson, leerAltaDePersona, dep, alReintentar, opciones);
}

/** Lo que la sala sabe de este celular, por su llave sola: el celular de una campaña de personas no tiene cuenta que mandar. */
export function miEstadoDePersona(
  servicio: string,
  sala: string,
  llave: string,
  dep: Dependencias = {},
): Promise<EstadoPropio | "red" | "terminada"> {
  return consultarYo(servicio, sala, JSON.stringify({ llave }), dep);
}

/** Las líneas elegidas y el enlace al comprobante. `null` es que todavía no hay resultado. */
export function resultadoDeCampanaDePersona(
  servicio: string,
  sala: string,
  dep: Dependencias = {},
): ReturnType<typeof resultadoDeCampana> {
  return resultadoDeCampana(servicio, sala, dep, esLineaDePersona);
}
