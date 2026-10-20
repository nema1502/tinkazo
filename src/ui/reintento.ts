/**
 * Ayudar con los fondos solo cuando hace falta, y sin que la persona toque nada.
 *
 * Quien entra con Google o con un correo (una cuenta de Pollar) solo quiere
 * sortear y no tiene por qué saber qué es un XLM. Pollar puede pagar la
 * comisión por la app, y cuando lo hace esta ayuda no llega a activarse. Cuando
 * no lo hace (la regla de contrato del panel de Pollar está apagada, o la
 * billetera de la app se quedó sin saldo) Pollar manda la transacción tal cual
 * y la red contesta que la cuenta no tiene con qué pagar. Recién ahí se actúa:
 *
 * - en testnet se carga la cuenta sola con el grifo y se reintenta, UNA vez;
 * - en mainnet no hay grifo y no se puede hacer nada solo.
 *
 * Lo que no se puede resolver solo (mainnet, el grifo caído o apagado, o que
 * después de cargar siga sin saldo) se avisa con `sinRecurso`, y quien lo
 * implementa decide si hay algo que ofrecer: en testnet, la caja de fondos a
 * mano como último recurso; en mainnet nada, porque quien entra con Google o con
 * un correo no tiene por qué ver una caja que le pide XLM.
 *
 * Reintentar es seguro porque solo se reintenta ante falta de saldo: la red
 * rechaza esa transacción al recibirla, antes de entrar a ningún ledger, así
 * que no puede quedar grabada dos veces ni gastar la secuencia de la cuenta.
 *
 * Es lógica pura: todo lo que toca la red o la pantalla entra por `Ayuda`.
 */
export interface Ayuda {
  /** La wallet envía por su cuenta (Pollar). Con las demás no se cambia nada. */
  esPollar: boolean;
  /** Hay grifo en esta red: solo testnet. */
  hayGrifo: boolean;
  /** Este error es de falta de saldo, y de nada más. */
  sinSaldo: (e: unknown) => boolean;
  /** Se está preparando la cuenta: la pantalla lo cuenta. */
  avisar: () => void;
  /** Carga la cuenta con el grifo. Si falla, se sigue sin reintentar. */
  cargar: () => Promise<void>;
  /** Espera a que el saldo se vea, para no reintentar contra una red que todavía no lo sabe. */
  esperar: () => Promise<void>;
  /** No hay nada más que hacer solo: que la pantalla muestre el último recurso. */
  sinRecurso: () => void;
}

/**
 * Intenta la operación y, si la cuenta de Pollar no tiene con qué pagar, la
 * ayuda en testnet y reintenta una vez. Todo otro error sale como llegó.
 */
export async function conAyudaDeFondos<T>(intento: () => Promise<T>, ayuda: Ayuda): Promise<T> {
  try {
    return await intento();
  } catch (e) {
    // Otra wallet, u otro tipo de error: nada cambia.
    if (!ayuda.esPollar || !ayuda.sinSaldo(e)) throw e;
    // Mainnet: no hay grifo. Se dice qué hacer, pero no se inventa una solución.
    if (!ayuda.hayGrifo) {
      ayuda.sinRecurso();
      throw e;
    }
    ayuda.avisar();
    try {
      await ayuda.cargar();
    } catch {
      // El grifo no contestó. La persona ve el error de verdad y el último recurso.
      ayuda.sinRecurso();
      throw e;
    }
    await ayuda.esperar();
    try {
      return await intento();
    } catch (otra) {
      // Una sola vez. Si sigue sin saldo, a mano; si fue otra cosa (la ronda que
      // quedó cerca, la red ocupada), lo resuelve quien llamó.
      if (ayuda.sinSaldo(otra)) ayuda.sinRecurso();
      throw otra;
    }
  }
}

/**
 * Le pone tope de tiempo a algo que puede quedarse colgado. Si no termina en
 * `ms`, falla con `mensaje`; lo que se pidió sigue su curso por detrás, sin
 * que a nadie le importe. Sin esto, un grifo que no contesta dejaba el
 * sellado en "Preparando tu cuenta…" para siempre, con el botón apagado.
 */
export function conTope<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error(mensaje)), ms);
    promesa.then(
      (v) => {
        clearTimeout(reloj);
        resolver(v);
      },
      (e: unknown) => {
        clearTimeout(reloj);
        rechazar(e);
      },
    );
  });
}

/**
 * Espera a que `listo()` sea verdadero, mirando cada `cadaMs`, hasta `hastaMs`.
 * Devuelve si lo logró. Tiene tope de tiempo de verdad (no de vueltas): una
 * consulta lenta no estira la espera.
 */
export async function esperarHasta(
  listo: () => Promise<boolean>,
  opciones: {
    cadaMs: number;
    hastaMs: number;
    ahora?: () => number;
    dormir?: (ms: number) => Promise<void>;
  },
): Promise<boolean> {
  const ahora = opciones.ahora ?? Date.now;
  const dormir = opciones.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fin = ahora() + opciones.hastaMs;
  for (;;) {
    if (await listo()) return true;
    if (ahora() + opciones.cadaMs > fin) return false;
    await dormir(opciones.cadaMs);
  }
}

/* ------------------------------------------------ esperar a que exista la cuenta */

/**
 * Una cuenta de Pollar la abre Pollar en la red, de fondo, después de entrar, y
 * tarda de 5 a 62 segundos (mediana de 7; la documentación promete menos de 3).
 * Quien aprieta "Sellar" antes la encuentra sin abrir, y simular contra ella
 * falla con "Account not found". No es falta de saldo ni un error de nadie: hay
 * que esperar, y decirlo.
 *
 * Todo lo que toca la red entra inyectado (la consulta, el reloj, la pausa), así
 * que se prueba sin red y sin esperar de verdad.
 */

/** Cuánto se espera a que exista la cuenta antes de rendirse. */
export const ESPERA_CUENTA_MS = 90_000;
/** Entre una consulta y la siguiente: nunca más de una por segundo. */
export const ENTRE_CONSULTAS_MS = 1000;
/** Una consulta que no contesta en este tiempo cuenta como un corte de red. */
export const CONSULTA_LENTA_MS = 10_000;
/** Si la simulación dice que la cuenta no existe después de haberla visto, el respiro antes de mirar otra vez. */
export const RESPIRO_MS = 2000;
/** Y lo que se espera esa segunda vez. */
export const SEGUNDA_ESPERA_MS = 20_000;

/**
 * Cómo terminó la espera:
 * - `existe`: la red ya la conoce.
 * - `no-llego`: se acabó el tiempo y la red dice que todavía no existe.
 * - `sin-red`: se acabó el tiempo sin que la red contestara ni una vez.
 * - `cancelada`: alguien canceló la espera (cerró la sesión, por ejemplo).
 */
export type EsperaDeCuenta = "existe" | "no-llego" | "sin-red" | "cancelada";

export interface OpcionesEsperaDeCuenta {
  /** ¿La red ya conoce la cuenta? Si falla (red caída) cuenta como "todavía no sé" y se sigue esperando. */
  existe: () => Promise<boolean>;
  /** Se llama una vez, la primera vez que no se confirma la cuenta: la pantalla lo cuenta. */
  alEsperar?: () => void;
  /** Hasta cuándo se espera (por defecto 90 s). */
  hastaMs?: number;
  /** Entre consultas, nunca menos de 1 s (por defecto 1 s). */
  cadaMs?: number;
  /** Cuánto se le da a cada consulta antes de darla por perdida (por defecto 10 s). */
  consultaMs?: number;
  /** Cancela la espera: sale ya, sin esperar a la consulta que esté en vuelo. */
  signal?: AbortSignal;
  ahora?: () => number;
  dormir?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Espera a que la red conozca la cuenta. Mira apenas se la llama, y si ya existe
 * vuelve sin esperar ni avisar nada. Si no, avisa una vez y vuelve a mirar cada
 * segundo hasta `hastaMs`. Una consulta que falla o tarda demasiado no corta la
 * espera: es un corte de red, y puede volver.
 */
export async function esperarCuenta(op: OpcionesEsperaDeCuenta): Promise<EsperaDeCuenta> {
  const ahora = op.ahora ?? Date.now;
  const dormir = op.dormir ?? dormirCancelable;
  const cada = Math.max(ENTRE_CONSULTAS_MS, op.cadaMs ?? ENTRE_CONSULTAS_MS);
  const fin = ahora() + (op.hastaMs ?? ESPERA_CUENTA_MS);
  const { signal } = op;
  const cancelacion = alCancelar(signal);
  let dijoQueNo = false;
  let avisado = false;
  try {
    for (;;) {
      if (signal?.aborted) return "cancelada";
      const r = await Promise.race([consultar(op.existe, op.consultaMs ?? CONSULTA_LENTA_MS), cancelacion.promesa]);
      if (r === "cancelada") return "cancelada";
      if (r === true) return "existe";
      if (r === false) dijoQueNo = true;
      if (!avisado) {
        avisado = true;
        op.alEsperar?.();
      }
      if (ahora() + cada > fin) return dijoQueNo ? "no-llego" : "sin-red";
      await dormir(cada, signal);
    }
  } finally {
    cancelacion.soltar();
  }
}

/** Una consulta que nunca lanza: `true`, `false`, o `"error"` si falló o tardó demasiado. */
async function consultar(existe: () => Promise<boolean>, limiteMs: number): Promise<boolean | "error"> {
  try {
    return await conTope(existe(), limiteMs, "consulta-lenta");
  } catch {
    return "error";
  }
}

/** Una promesa que se cumple cuando se cancela, y cómo soltar el oyente al terminar. */
function alCancelar(signal?: AbortSignal): { promesa: Promise<"cancelada">; soltar: () => void } {
  if (!signal) return { promesa: new Promise<"cancelada">(() => undefined), soltar: () => undefined };
  let soltar: () => void = () => undefined;
  const promesa = new Promise<"cancelada">((resolver) => {
    if (signal.aborted) {
      resolver("cancelada");
      return;
    }
    const alAbortar = (): void => resolver("cancelada");
    signal.addEventListener("abort", alAbortar, { once: true });
    soltar = () => signal.removeEventListener("abort", alAbortar);
  });
  return { promesa, soltar };
}

/** Duerme `ms`, o menos si se cancela. */
export function dormirCancelable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolver) => {
    if (signal?.aborted) {
      resolver();
      return;
    }
    const terminar = (): void => {
      clearTimeout(reloj);
      signal?.removeEventListener("abort", terminar);
      resolver();
    };
    const reloj = setTimeout(terminar, ms);
    signal?.addEventListener("abort", terminar, { once: true });
  });
}

/**
 * Se esperó todo lo razonable y la cuenta sigue sin existir: lo que se le dice a
 * la persona es que todavía no está lista y que pruebe de nuevo, no que le falta
 * saldo ni que "algo falló".
 */
export class CuentaNoLista extends Error {
  constructor() {
    super("account-not-ready");
    this.name = "CuentaNoLista";
  }
}

/** Se canceló la espera (la sesión se cerró o cambió de cuenta). */
export class EsperaCancelada extends Error {
  constructor() {
    super("account-wait-cancelled");
    this.name = "EsperaCancelada";
  }
}

export interface PreparaCuenta {
  /** La wallet es de Pollar: solo ella tiene que esperar a que su cuenta exista. */
  esPollar: boolean;
  /** Espera a que la red conozca la cuenta, hasta `hastaMs` (ver `esperarCuenta`). */
  esperar: (hastaMs: number) => Promise<EsperaDeCuenta>;
  /** Este error dice que la cuenta no existe. El SDK lo dice también cuando la consulta falló por un corte de red. */
  noExiste: (e: unknown) => boolean;
  /** Una pausa corta, cancelable, antes de volver a mirar. */
  respirar: (ms: number) => Promise<void>;
}

/**
 * Espera a que exista la cuenta de Pollar ANTES de simular, y no solo después de
 * un fallo.
 *
 * Con otra wallet no cambia nada. Con Pollar: si pasan 90 segundos y la cuenta
 * sigue sin existir, falla con `CuentaNoLista`; sin respuesta de la red, con un
 * error de red; cancelada, con `EsperaCancelada`. Ninguno es "sin saldo".
 *
 * Si la red mostró la cuenta pero la simulación dice que no existe (el RPC que
 * simula puede ir un instante detrás del que se consultó, y el SDK dice "Account
 * not found" también ante un corte), se da un respiro, se mira otra vez y se
 * reintenta UNA vez. Reintentar es seguro: la simulación falla antes de mandar
 * nada a la red.
 */
export async function conCuentaLista<T>(operacion: () => Promise<T>, prepara: PreparaCuenta): Promise<T> {
  if (!prepara.esPollar) return operacion();
  await cuentaConocida(prepara, ESPERA_CUENTA_MS);
  try {
    return await operacion();
  } catch (e) {
    if (!prepara.noExiste(e)) throw e;
    await prepara.respirar(RESPIRO_MS);
    await cuentaConocida(prepara, SEGUNDA_ESPERA_MS);
    try {
      return await operacion();
    } catch (otra) {
      throw prepara.noExiste(otra) ? new CuentaNoLista() : otra;
    }
  }
}

/** Espera y convierte lo que no sea "existe" en el error que corresponde. */
async function cuentaConocida(prepara: PreparaCuenta, hastaMs: number): Promise<void> {
  const r = await prepara.esperar(hastaMs);
  if (r === "existe") return;
  if (r === "cancelada") throw new EsperaCancelada();
  throw r === "no-llego" ? new CuentaNoLista() : new Error("account-check-network");
}
