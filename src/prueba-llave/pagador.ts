import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { RED_DE_PRUEBA } from "./red";

/**
 * La cuenta descartable que paga todo en la prueba: se crea en el navegador, vive solo en memoria y la fondea el grifo de
 * la red de prueba. Sin servidor nuestro, sin llaves nuestras. Cuando se cierra la página, la llave se pierde.
 */

export interface IntentoDeGrifo {
  /** El código HTTP que contestó, o `null` si el pedido ni llegó (corte, tope). */
  http: number | null;
  ms: number;
}

export interface Pagador {
  publica: string;
  /** Firma una transacción en base64 y la devuelve en base64. */
  firmar(txXdr: string): string;
  intentosDeGrifo: IntentoDeGrifo[];
  /** El grifo contestó que ya hay demasiados pedidos. */
  limitado: boolean;
}

export interface OpcionesDelPagador {
  fetchFn?: typeof fetch;
  /** Cuántas veces se le pide al grifo (3). */
  intentos?: number;
  /** Cuánto se espera cada pedido (20 s). */
  topeMs?: number;
  /** Cuánto se espera entre un intento y el siguiente (5 s). */
  esperaMs?: number;
  /** Hasta cuándo se espera que la cuenta aparezca en el RPC (15 s). */
  esperarCuentaMs?: number;
  /** La secuencia de la cuenta en la red, o `null` si todavía no existe. */
  secuencia: (cuenta: string) => Promise<string | null>;
  dormir?: (ms: number) => Promise<void>;
  ahora?: () => number;
}

/** Nadie lo capta: el grifo no pudo fondear la cuenta. Lleva lo que contestó cada intento. */
export class ErrorDeGrifo extends Error {
  readonly intentos: IntentoDeGrifo[];
  readonly limitado: boolean;
  constructor(intentos: IntentoDeGrifo[], limitado: boolean) {
    super("sin-fondos");
    this.name = "ErrorDeGrifo";
    this.intentos = intentos;
    this.limitado = limitado;
  }
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Crea la cuenta descartable y la fondea. Un 400 del grifo vale como "ya existe", un 429 se anota como limitado. Después
 * espera que la cuenta aparezca en el RPC, para que la primera simulación no falle por una cuenta que todavía no se ve.
 */
export async function crearPagador(o: OpcionesDelPagador): Promise<Pagador> {
  const fetchFn = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const intentos = o.intentos ?? 3;
  const topeMs = o.topeMs ?? 20_000;
  const esperaMs = o.esperaMs ?? 5_000;
  const esperarCuentaMs = o.esperarCuentaMs ?? 15_000;
  const dormir = o.dormir ?? dormirDeVerdad;
  const ahora = o.ahora ?? Date.now;

  const par = Keypair.random();
  const publica = par.publicKey();
  const registro: IntentoDeGrifo[] = [];
  let limitado = false;
  let fondeada = false;

  for (let i = 0; i < intentos && !fondeada; i++) {
    const t0 = ahora();
    let http: number | null = null;
    try {
      const res = await fetchFn(`${RED_DE_PRUEBA.friendbot}/?addr=${encodeURIComponent(publica)}`, { signal: AbortSignal.timeout(topeMs) });
      http = res.status;
    } catch {
      http = null;
    }
    registro.push({ http, ms: ahora() - t0 });
    if (http === 429) limitado = true;
    if (http !== null && (http === 400 || (http >= 200 && http < 300))) fondeada = true;
    else if (i < intentos - 1) await dormir(esperaMs);
  }
  if (!fondeada) throw new ErrorDeGrifo(registro, limitado);

  const limite = ahora() + esperarCuentaMs;
  for (;;) {
    let existe = false;
    try {
      existe = (await o.secuencia(publica)) !== null;
    } catch {
      existe = false;
    }
    if (existe) break;
    if (ahora() >= limite) throw new ErrorDeGrifo(registro, limitado);
    await dormir(1_000);
  }

  return {
    publica,
    intentosDeGrifo: registro,
    limitado,
    firmar(txXdr: string): string {
      const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase);
      tx.sign(par);
      return tx.toXDR();
    },
  };
}
