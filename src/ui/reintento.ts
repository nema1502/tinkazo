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
 * Lo que no se puede resolver solo (mainnet, el grifo caído, o que después de
 * cargar siga sin saldo) se avisa con `sinRecurso`, para que la pantalla ofrezca
 * el último recurso: la caja de fondos, a mano.
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
