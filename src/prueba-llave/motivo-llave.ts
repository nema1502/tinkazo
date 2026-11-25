import { ErrorDeEntrada, type MotivoDeEntrada } from "./error-de-entrada";

/**
 * Por qué no salió una llave, en cinco palabras, o el motivo de entrada si el error es uno de los de la prueba. Pura, sin
 * el navegador.
 *
 * El navegador contesta con un `DOMException` y la librería de passkeys lo envuelve en un error propio que lo guarda en
 * `cause`. Se miran las dos formas. Una cancelación y el vencimiento de los 60 s dan el mismo `NotAllowedError`, así que el
 * motivo cancelada también es el del vencimiento. Si la página no tenía el foco, el mismo error no es una cancelación:
 * es que el navegador no dejó pedirla (`sin-foco`).
 */
export type MotivoDeLlave = "cancelada" | "no-soporta" | "dominio" | "sin-foco" | "otro" | MotivoDeEntrada;

function nombreDe(e: unknown): string {
  if (typeof e === "object" && e !== null && "name" in e && typeof (e as { name: unknown }).name === "string") return (e as { name: string }).name;
  return "";
}

/** El nombre del error y el de su causa, en ese orden. */
function nombres(e: unknown): string[] {
  const cause = typeof e === "object" && e !== null && "cause" in e ? (e as { cause: unknown }).cause : undefined;
  return [nombreDe(e), nombreDe(cause)].filter((n) => n !== "");
}

export function motivoDeLaLlave(e: unknown, conFoco: boolean): MotivoDeLlave {
  if (e instanceof ErrorDeEntrada) return e.motivo;
  const ns = nombres(e);
  if (ns.includes("NotAllowedError") || ns.includes("AbortError")) return conFoco ? "cancelada" : "sin-foco";
  if (ns.includes("NotSupportedError")) return "no-soporta";
  if (ns.includes("SecurityError")) return "dominio";
  return "otro";
}
