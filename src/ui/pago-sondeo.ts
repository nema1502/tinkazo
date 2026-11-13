import type { PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";

/**
 * «Ya pagué»: se pregunta por el pago de la orden enseguida y después solo, cada 10 segundos durante 5 minutos (diseño
 * del cobro por uso, 4.2). Una pregunta por vez: la siguiente se programa cuando vuelve la anterior. Con cada respuesta,
 * quien lo usa decide si sigue mirando o para (llegó, o algo que no se arregla mirando de nuevo). A los 5 minutos, si
 * nadie paró, avisa que tarda y no pregunta más: la persona vuelve a tocar «Ya pagué» si quiere.
 *
 * Sin DOM: lo usan «Dejá tu cuenta lista» y la ventana de sumar sorteos. Nunca lanza.
 */

/** Cada cuánto se vuelve a preguntar. */
export const CADA_MS = 10_000;
/** Cuánto se sigue preguntando desde «Ya pagué». */
export const DURANTE_MS = 300_000;

export interface OpcionesDelSondeo {
  /** La pregunta: `POST /v1/alta/pago` de la orden. */
  preguntar(): Promise<ResultadoDeAlta<PagoDeOrden>>;
  /** Lo que contestó. `parar` termina el sondeo; `seguir` pregunta otra vez dentro de 10 segundos. */
  alResultado(r: ResultadoDeAlta<PagoDeOrden>): "seguir" | "parar";
  /** Pasaron los 5 minutos sin que nadie parara. */
  alTardar(): void;
  cadaMs?: number;
  duranteMs?: number;
  ahora?: () => number;
}

export interface Sondeo {
  /** Corta todo: lo que vuelva después no llega, y no se pregunta más. */
  parar(): void;
}

const SIN_SERVICIO: ResultadoDeAlta<PagoDeOrden> = { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };

export function vigilarPago(o: OpcionesDelSondeo): Sondeo {
  const ahora = o.ahora ?? Date.now;
  const cada = o.cadaMs ?? CADA_MS;
  const durante = o.duranteMs ?? DURANTE_MS;
  const desde = ahora();
  let parado = false;
  let reloj: ReturnType<typeof setTimeout> | null = null;

  const vuelta = async (): Promise<void> => {
    reloj = null;
    if (parado) return;
    let r: ResultadoDeAlta<PagoDeOrden>;
    try {
      r = await o.preguntar();
    } catch {
      r = SIN_SERVICIO;
    }
    if (parado) return;
    if (o.alResultado(r) === "parar") {
      parado = true;
      return;
    }
    if (parado) return;
    if (ahora() - desde + cada > durante) {
      parado = true;
      o.alTardar();
      return;
    }
    reloj = setTimeout(() => void vuelta(), cada);
  };

  reloj = setTimeout(() => void vuelta(), 0);
  return {
    parar() {
      parado = true;
      if (reloj) clearTimeout(reloj);
      reloj = null;
    },
  };
}
