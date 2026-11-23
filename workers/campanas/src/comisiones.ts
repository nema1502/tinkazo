/**
 * El enlace de servicio hacia el servicio de comisiones (S5 de #182): cuando el alta decide el
 * cupo, las horas y el estado de un evento, el servicio de campañas le pasa solo eso, por el
 * enlace que trae la configuración (`COMISIONES_URL`). Las rutas del otro lado no se tocan (S8):
 * el aviso es de solo escritura, no espera nada y un fallo suyo nunca tumba el alta.
 */

/** Lo único que el alta decide y que comisiones necesita de un evento. */
export interface AvisoDeComisiones {
  evento: string;
  /** El identificador opaco de la empresa, no su nombre. */
  empresa: string;
  /** Cuántas personas admite el evento. */
  cupo: number;
  horas: { abreMs: number; cierraMs: number; sorteoMs: number; recibirHastaMs: number };
  estado: string;
}

export interface EnvDeComisiones {
  /** El enlace completo del servicio de comisiones que recibe el aviso. Vacío o ausente: no se avisa. */
  COMISIONES_URL?: string;
  /** El secreto del enlace de servicio, en `Authorization: Bearer`. Opcional. */
  COMISIONES_SECRETO?: string;
}

/**
 * Manda el aviso. Nunca lanza: si el enlace no está configurado no llama a nadie, y si la llamada
 * falla lo anota en la bitácora (sin datos del evento) y el alta sigue como si nada.
 */
export async function avisarComisiones(env: EnvDeComisiones, aviso: AvisoDeComisiones, buscar: typeof fetch = fetch): Promise<void> {
  const url = (env.COMISIONES_URL ?? "").trim();
  if (!url) return;
  try {
    const cabeceras: Record<string, string> = { "Content-Type": "application/json" };
    if ((env.COMISIONES_SECRETO ?? "").length > 0) cabeceras.Authorization = `Bearer ${env.COMISIONES_SECRETO}`;
    const r = await buscar(url, { method: "POST", headers: cabeceras, body: JSON.stringify(aviso) });
    if (!r.ok) throw new Error(`estado ${r.status}`);
  } catch {
    console.error(JSON.stringify({ evento: "comisiones-fallo" }));
  }
}
