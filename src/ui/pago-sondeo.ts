import type { PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";

/**
 * «Ya pagué»: se pregunta por el pago de la orden enseguida y después solo, cada 10 segundos durante 5 minutos (diseño
 * del cobro por uso, 4.2). Una pregunta por vez: la siguiente se programa cuando vuelve la anterior. Con cada respuesta,
 * quien lo usa decide si sigue mirando o para (llegó, o algo que no se arregla mirando de nuevo). A los 5 minutos, si
 * nadie paró, avisa que tarda y no pregunta más: la persona vuelve a tocar «Ya pagué» si quiere.
 *
 * Mirar solo (la venta por unidad, `ritmo` y `pestana`): el mismo sondeo, con el ritmo que cambia con el tiempo (cada
 * 10 segundos los primeros 2 minutos y después cada 30, hasta 30 minutos), frenado mientras la pestaña está oculta y
 * con una pregunta enseguida al volver a ella. `mirarYa` pregunta ahora (el «Ya pagué» chico).
 *
 * Sin DOM, salvo `pestanaDelNavegador`, que lo lee solo cuando se la llama: lo usan «Dejá tu cuenta lista» y la
 * ventana de sumar sorteos. Nunca lanza.
 */

/** Cada cuánto se vuelve a preguntar. */
export const CADA_MS = 10_000;
/** Cuánto se sigue preguntando desde «Ya pagué». */
export const DURANTE_MS = 300_000;

/** Mirando solo: los primeros 2 minutos cada 10 segundos, y después cada 30. */
export const PRIMEROS_MS = 120_000;
export const DESPUES_CADA_MS = 30_000;
/** Mirando solo: hasta 30 minutos desde que se mostró la orden. */
export const DURANTE_SOLO_MS = 30 * 60_000;
/** Lo que espera una vuelta a la pestaña desde la última pregunta antes de preguntar de nuevo: el foco y la vista llegan juntos. */
export const VOLVER_MS = 3_000;

/** El ritmo de mirar solo, según cuánto pasó desde que se empezó. */
export const ritmoSolo = (transcurrido: number): number => (transcurrido < PRIMEROS_MS ? CADA_MS : DESPUES_CADA_MS);

/** Lo que el sondeo sabe de la pestaña: si se ve, y cómo enterarse de que se volvió a ella (devuelve cómo soltarlo). */
export interface Pestana {
  visible(): boolean;
  alVolver(f: () => void): () => void;
}

export interface OpcionesDelSondeo {
  /** La pregunta: `POST /v1/alta/pago` de la orden. */
  preguntar(): Promise<ResultadoDeAlta<PagoDeOrden>>;
  /** Lo que contestó. `parar` termina el sondeo; `seguir` pregunta otra vez dentro de 10 segundos. */
  alResultado(r: ResultadoDeAlta<PagoDeOrden>): "seguir" | "parar";
  /** Pasaron los 5 minutos sin que nadie parara. */
  alTardar(): void;
  cadaMs?: number;
  duranteMs?: number;
  /** El ritmo según cuánto pasó desde el principio. Sin decirlo, siempre `cadaMs`. */
  ritmo?: (transcurrido: number) => number;
  /** Con la pestaña: oculta no se pregunta, y al volver se pregunta enseguida. Sin decirlo, se pregunta siempre. */
  pestana?: Pestana;
  ahora?: () => number;
}

export interface Sondeo {
  /** Corta todo: lo que vuelva después no llega, y no se pregunta más. */
  parar(): void;
  /** Pregunta ahora, si no hay una pregunta en camino, y sigue con el ritmo desde ahí. */
  mirarYa(): void;
}

const SIN_SERVICIO: ResultadoDeAlta<PagoDeOrden> = { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };

export function vigilarPago(o: OpcionesDelSondeo): Sondeo {
  const ahora = o.ahora ?? Date.now;
  const cada = o.cadaMs ?? CADA_MS;
  const ritmo = o.ritmo ?? ((): number => cada);
  const durante = o.duranteMs ?? DURANTE_MS;
  const desde = ahora();
  let parado = false;
  let enCamino = false;
  /** Tocaba preguntar con la pestaña oculta: al volver se pregunta sin esperar nada. */
  let pendiente = false;
  let ultima = Number.NEGATIVE_INFINITY;
  let reloj: ReturnType<typeof setTimeout> | null = null;
  let soltar: (() => void) | null = null;

  const terminar = (): void => {
    parado = true;
    if (reloj) clearTimeout(reloj);
    reloj = null;
    soltar?.();
    soltar = null;
  };

  const vuelta = async (): Promise<void> => {
    reloj = null;
    if (parado || enCamino) return;
    // Oculta, no se pregunta: la próxima es al volver a la pestaña.
    if (o.pestana && !o.pestana.visible()) {
      pendiente = true;
      return;
    }
    pendiente = false;
    enCamino = true;
    ultima = ahora();
    let r: ResultadoDeAlta<PagoDeOrden>;
    try {
      r = await o.preguntar();
    } catch {
      r = SIN_SERVICIO;
    }
    enCamino = false;
    if (parado) return;
    if (o.alResultado(r) === "parar") {
      terminar();
      return;
    }
    if (parado) return;
    const pasado = ahora() - desde;
    const siguiente = ritmo(pasado);
    if (pasado + siguiente > durante) {
      terminar();
      o.alTardar();
      return;
    }
    reloj = setTimeout(() => void vuelta(), siguiente);
  };

  /** Una pregunta ya, en lugar de la que estaba programada. */
  const ya = (): void => {
    if (parado || enCamino) return;
    if (reloj) clearTimeout(reloj);
    void vuelta();
  };

  if (o.pestana) {
    // Al volver, una pregunta enseguida: es cuando la persona suele volver de pagar en otra app. Si recién se preguntó
    // (el foco y la vista llegan juntos), no otra, salvo que una haya quedado pendiente por la pestaña oculta.
    soltar = o.pestana.alVolver(() => {
      if (!pendiente && ahora() - ultima < VOLVER_MS) return;
      ya();
    });
  }
  reloj = setTimeout(() => void vuelta(), 0);
  return {
    parar: terminar,
    mirarYa: ya,
  };
}

/** La pestaña del navegador: oculta según `visibilityState`, y se vuelve a ella con `visibilitychange` o `focus`. */
export function pestanaDelNavegador(): Pestana | undefined {
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  return {
    visible: () => document.visibilityState !== "hidden",
    alVolver(f) {
      const alCambiar = (): void => {
        if (document.visibilityState !== "hidden") f();
      };
      document.addEventListener("visibilitychange", alCambiar);
      window.addEventListener("focus", f);
      return () => {
        document.removeEventListener("visibilitychange", alCambiar);
        window.removeEventListener("focus", f);
      };
    },
  };
}
