import type { SessionKind } from "../stellar/session-store";
import { esCuenta } from "./modelo";

/**
 * La cuenta con que ya se entró a Tinkazo en este celular, para la página de registro del equipo (`equipos.html`).
 *
 * Hasta el 8 de noviembre de 2026 la página solo miraba la sesión de Google: con Freighter o con la cuenta de prueba
 * abiertas en el mismo navegador, la cabecera mostraba la cuenta y la página pedía pegarla igual (ensayo del 6 de
 * noviembre). Ahora toma la sesión que quedó guardada, sea cual sea, sin abrir ninguna ventana ni pedir permiso: si
 * algo falla, devuelve `null` y la página ofrece entrar como siempre.
 *
 * Sin red ni DOM: cada vía entra como una función, para probarla sin billeteras.
 */
export interface FuentesDeSesion {
  /** El tipo de sesión que guardó la herramienta en esta red (`session-store.ts`), o `null`. */
  tipo: SessionKind | null;
  /** Hay entrada con Google en este sitio (la llave de Pollar). */
  hayPollar: boolean;
  /** La cuenta de Google ya abierta, sin abrir la ventana. */
  google: () => Promise<string | null>;
  /** La cuenta de Freighter, solo si este sitio ya tiene permiso (nunca abre la extensión). */
  freighter: () => Promise<string | null>;
  /** La cuenta de prueba guardada en este navegador (solo en la red de pruebas). */
  prueba: () => Promise<string | null>;
  /** Cuánto se espera a cada vía antes de seguir con la siguiente, en milisegundos (por defecto, `ESPERA_MAXIMA_MS`). */
  esperaMaximaMs?: number;
}

/** Lo que se espera a cada vía: si una extensión no contesta, la página sigue con la otra o con la entrada a mano. */
export const ESPERA_MAXIMA_MS = 3_000;

const valida = async (f: () => Promise<string | null>, esperaMs: number): Promise<string | null> => {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    const sinRespuesta = new Promise<null>((resolver) => {
      reloj = setTimeout(() => resolver(null), esperaMs);
    });
    const c = await Promise.race([f(), sinRespuesta]);
    return esCuenta(c) ? c : null;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
};

export async function cuentaDeLaSesion(f: FuentesDeSesion): Promise<string | null> {
  const espera = f.esperaMaximaMs ?? ESPERA_MAXIMA_MS;
  if (f.tipo === "freighter") {
    const c = await valida(f.freighter, espera);
    if (c) return c;
  }
  if (f.tipo === "guest") {
    const c = await valida(f.prueba, espera);
    if (c) return c;
  }
  // Google se mira también sin la marca guardada: es lo que hacía la página antes, y Pollar sabe si hay sesión.
  if (f.hayPollar) return valida(f.google, espera);
  return null;
}
