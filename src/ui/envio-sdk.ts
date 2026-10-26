import { network } from "../stellar/config";
import type { Desenlace, IntentoDeSello, Resolucion, RespuestaConsulta, RespuestaEnvio } from "../stellar/envio";
import type { OnStep } from "./anchor";

/**
 * Cómo se habla con el SDK de Stellar al mandar una transacción: firmarla una
 * vez y mandarla hasta saber cómo terminó (Freighter, la cuenta de prueba),
 * entregársela a Pollar y preguntar por su hash, armarla sin disfrazar los
 * cortes de red, y averiguar si un sello cortado entró.
 *
 * Vive aparte de `anchor.ts`, que carga la página de entrada: esto se baja
 * recién cuando alguien sella o sortea, junto con el SDK.
 */

const toHex = (b: ArrayLike<number>): string => [...Array.from(b)].map((n) => n.toString(16).padStart(2, "0")).join("");

/** Los métodos que devuelven `Result` traen un envoltorio con `unwrap`. */
function unwrap<T>(value: unknown): T {
  if (value && typeof value === "object" && "unwrap" in value) {
    return (value as { unwrap(): T }).unwrap();
  }
  return value as T;
}

/** Lo que se usa de una transacción que armó el SDK (`AssembledTransaction`). */
export interface TxArmada {
  toXDR(): string;
  readonly simulationData: unknown;
  readonly built?: { fee?: string | number; hash(): ArrayLike<number>; timeBounds?: { maxTime?: string | number } };
  readonly signed?: { hash(): ArrayLike<number>; timeBounds?: { maxTime?: string | number } };
  sign(opts?: unknown): Promise<void>;
}

/**
 * Un desenlace que dice que la transacción no dejó nada, como error que
 * `errorKey` y `selloSinGrabar` entienden:
 *
 * - `tx-FAILED`: entró a un ledger y falló. Con el sello casi siempre es la ronda
 *   que quedó a menos de 30 s mientras la red andaba lenta (el SDK, en cambio,
 *   reventaba con `TypeError: Cannot read properties of undefined (reading
 *   'type')` al leer el resultado: 6 de 16 sellos con la cuenta de prueba el 20 de
 *   octubre de 2026).
 * - `tx-EXPIRED`: no entró y la red ya pasó su vencimiento.
 * - `tx-REJECTED <código>`: la red no la aceptó al recibirla (`tx_bad_seq`,
 *   `tx_insufficient_balance`…).
 */
export function errorDelDesenlace(d: Exclude<Desenlace, { estado: "entro" } | { estado: "sin-respuesta" }>): Error {
  if (d.estado === "fallo") return new Error("tx-FAILED");
  if (d.estado === "vencida") return new Error("tx-EXPIRED");
  return new Error(`tx-REJECTED ${d.codigo}`);
}

/** Pasa el valor que devolvió el contrato (un `ScVal`) a JavaScript. */
export async function valorNativo(valor: unknown): Promise<unknown> {
  if (valor === undefined || valor === null) throw new Error("tx-FAILED");
  const { scValToNative } = await import("@stellar/stellar-sdk");
  return scValToNative(valor as Parameters<typeof scValToNative>[0]);
}

/** El código del rechazo de `sendTransaction` (`tx_bad_seq`…), del `TransactionResult` que trae. */
function codigoDelRechazo(errorResult: unknown): string | undefined {
  if (!errorResult) return undefined;
  try {
    const r = (JSON.parse(JSON.stringify(errorResult)) as { result?: unknown }).result;
    if (typeof r === "string") return r;
    if (r && typeof r === "object") return Object.keys(r)[0];
  } catch {
    /* sin código legible: queda "ERROR" */
  }
  return undefined;
}

/** Lo que importa de la respuesta de `sendTransaction` del SDK. */
function leerEnvio(r: { status: string; errorResult?: unknown }): RespuestaEnvio {
  const codigo = codigoDelRechazo(r.errorResult);
  return { status: r.status, ...(codigo ? { codigo } : {}) };
}

/** Lo que importa de la respuesta de `getTransaction` del SDK. */
function leerConsulta(c: { status: string; latestLedgerCloseTime?: number | string; returnValue?: unknown }): RespuestaConsulta {
  return { status: c.status, cierre: Number(c.latestLedgerCloseTime), ...(c.returnValue !== undefined ? { valor: c.returnValue } : {}) };
}

/**
 * Firma acá (Freighter o la cuenta de prueba) y manda esa misma transacción
 * hasta saber cómo terminó (`enviarYConfirmar`). Antes era `signAndSend` del SDK:
 * un corte de red a mitad dejaba un error que nadie entendía y, al volver a
 * apretar, se armaba y se firmaba otra (otra ventana de Freighter, y con el
 * sello, quizás un segundo sello). Ahora un corte se arregla mandando la misma,
 * que la red aplica una sola vez.
 */
/** La red devolvió `TRY_AGAIN_LATER`: se anota para que el chequeo de la red avise que anda saturada. */
const avisarSaturacion = (): void => void import("../stellar/registro-red").then((m) => m.anotarSaturacion());

export async function firmarYConfirmar(tx: TxArmada, onStep: OnStep, sinRedMs: number, revisar?: () => void): Promise<{ hash: string; desenlace: Desenlace }> {
  await tx.sign();
  revisar?.();
  const firmada = tx.signed;
  if (!firmada) throw new Error("tx-sin-firma");
  return mandarYConfirmar(firmada, onStep, sinRedMs);
}

/** Manda esa transacción firmada (la misma, las veces que haga falta) hasta saber cómo terminó. */
async function mandarYConfirmar(firmada: NonNullable<TxArmada["signed"]>, onStep: OnStep, sinRedMs: number): Promise<{ hash: string; desenlace: Desenlace }> {
  const hash = toHex(firmada.hash());
  const venceEn = Number(firmada.timeBounds?.maxTime) || Math.floor(Date.now() / 1000) + 300;
  onStep("sending", hash);
  const { server } = await import("../stellar/contract");
  const { enviarYConfirmar } = await import("../stellar/envio");
  const desenlace = await enviarYConfirmar({
    enviar: async () => leerEnvio(await server.sendTransaction(firmada as Parameters<typeof server.sendTransaction>[0])),
    consultar: async () => leerConsulta(await server.getTransaction(hash)),
    venceEn,
    sinRedMs,
    alSaturada: avisarSaturacion,
  });
  return { hash, desenlace };
}

/**
 * Pollar firma la transacción SIN patrocinio (la comisión la paga la cuenta de la persona)
 * y devuelve la firmada; el envío lo hace esta capa, como con Freighter. Es "Sellar pagando
 * con mi cuenta" cuando el sello cuesta más de lo que el patrocinador cubre.
 */
async function firmarSinPatrocinio(tx: TxArmada, wallet: { signUnsponsored?: (xdr: string) => Promise<string> }): Promise<NonNullable<TxArmada["signed"]> & { timeBounds?: { maxTime?: string | number } }> {
  if (!wallet.signUnsponsored) throw new Error("pollar-sin-pago-propio");
  const firmado = await wallet.signUnsponsored(tx.toXDR());
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  const leida = TransactionBuilder.fromXDR(firmado, network.networkPassphrase);
  // Un fee-bump quiere decir que Pollar patrocinó igual: no es lo que se pidió.
  if ("innerTransaction" in leida) throw new Error("pollar-patrocino-no-se-quito");
  return leida;
}

/**
 * Arma (cliente, simulación) sin mandar nada todavía. Dos errores de esta etapa
 * se disfrazaban:
 *
 * - "Account not found": el SDK lo dice también cuando la consulta no llegó (un
 *   corte de red). Con Freighter o la cuenta de prueba, que caían en "tu cuenta no
 *   tiene saldo", se le pregunta a la red de verdad (`accountOnRpc`, que ante un
 *   corte lanza): si la cuenta existe, fue un corte pasajero y se arma de nuevo;
 *   si la red no contesta, es un corte. Con Pollar lo resuelve `conCuentaLista`.
 * - Una respuesta que no se entiende (un portal cautivo que devuelve su página,
 *   un error de JSON-RPC sin código conocido): el SDK revienta con un `TypeError`.
 *   Acá todavía no se mandó nada, así que es la red que no contestó bien.
 */
export async function armar<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    const errores = await import("../stellar/errores");
    if (errores.esCuentaInexistente(e)) {
      const [{ activeWallet }, { submitsItself }, { accountOnRpc }] = await Promise.all([
        import("../stellar/wallet-lite"),
        import("../stellar/wallet-pollar"),
        import("../stellar/contract"),
      ]);
      const w = activeWallet();
      if (w?.address && !submitsItself(w)) {
        let existe: boolean;
        try {
          existe = await accountOnRpc(w.address);
        } catch (corte) {
          throw new Error("rpc-sin-respuesta: no se pudo preguntar por la cuenta", { cause: corte });
        }
        if (existe) return await f();
      }
      throw e;
    }
    const raro = e instanceof TypeError || e instanceof SyntaxError || (e !== null && typeof e === "object" && !(e instanceof Error));
    if (raro && errores.errorKey(e) === "unknown") throw new Error(`rpc-sin-respuesta: ${errores.codigoTecnico(e)}`, { cause: e });
    throw e;
  }
}

/**
 * Lo que devolvió Pollar cuando no pudo, y no se sabe si mandó: un corte, su tope
 * de tiempo, un error que no se entiende, `TRY_AGAIN_LATER` (que la red también
 * contesta cuando la transacción ya entró). Lo demás (sin saldo, la secuencia, un
 * código de resultado de la red) es la red contestando que no la tomó.
 */
async function pollarNoSabe(e: unknown): Promise<boolean> {
  const { errorKey, esDeRed, textoDelError } = await import("../stellar/errores");
  const clave = errorKey(e);
  return esDeRed(e) || clave === "unknown" || clave === "unconfirmed" || /TRY_AGAIN_LATER|DUPLICATE/.test(textoDelError(e));
}

/**
 * Algunas wallets firman y envían de una sola vez contra su propio servidor.
 * Ahí no se puede firmar y mandar acá, porque la transacción saldría dos veces:
 * se les entrega el XDR y el resultado se lee de la red, por su hash.
 *
 * Devuelve `null` si la wallet activa no es de ese tipo, y sigue el camino
 * normal de firmar acá y enviar nosotros.
 *
 * Con `intento` (un sello), lo que no se sabe si entró sale como `SelloIncierto`,
 * con el hash de la transacción que se entregó: Pollar la envuelve para pagar la
 * comisión, y el RPC la encuentra igual por ese hash (medido el 21 de octubre de
 * 2026 con el sello patrocinado 93a2c960…).
 */
export async function submitElsewhere(tx: TxArmada, onStep: OnStep, sinRedMs: number, intento?: IntentoDeSello, opciones: { pagarConMiCuenta?: boolean } = {}): Promise<{ hash: string; value: unknown } | null> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([
    import("../stellar/wallet"),
    import("../stellar/wallet-pollar"),
  ]);
  const wallet = activeWallet();
  if (!submitsItself(wallet)) return null;
  // El SDK mira la simulación antes de firmar y lanza si el contrato dijo que no
  // ("Transaction simulation failed: Error(Contract, #5)": la ronda quedó
  // demasiado cerca). Esta wallet recibe el XDR sin pasar por ahí, y
  // `client.seal()` no lanza cuando la simulación falla: devuelve la transacción
  // sin armar, con la comisión base y sin datos de Soroban, que la red rechaza
  // como malformada (`txMALFORMED`, que Pollar cuenta como `txFailed`). Se vio el
  // 19 de octubre de 2026, y es lo que pasaba con una ronda cerca. Leer la
  // simulación acá lanza el error de verdad, igual que con las otras wallets, y
  // `freeze.ts` reintenta con otra ronda.
  void tx.simulationData;
  const propio = tx.built ? toHex(tx.built.hash()) : undefined;
  let venceEn = Number(tx.built?.timeBounds?.maxTime) || Math.floor(Date.now() / 1000) + 300;
  const { server } = await import("../stellar/contract");
  let hash: string;
  let enviar: (() => Promise<RespuestaEnvio>) | undefined;
  if (opciones.pagarConMiCuenta) {
    // Pollar solo firma (sin patrocinio) y la manda esta capa: la misma transacción las veces que haga
    // falta, con el mismo hash. Un fallo al firmar es antes de mandar nada: no hay nada en el aire.
    const firmada = await firmarSinPatrocinio(tx, wallet);
    hash = toHex(firmada.hash());
    venceEn = Number(firmada.timeBounds?.maxTime) || venceEn;
    enviar = async () => leerEnvio(await server.sendTransaction(firmada as unknown as Parameters<typeof server.sendTransaction>[0]));
  } else {
    try {
      hash = await wallet.signAndSubmit(tx.toXDR());
    } catch (e) {
      if (intento && (await pollarNoSabe(e))) throw new (await import("../stellar/envio")).SelloIncierto({ ...intento, ...(propio ? { hash: propio } : {}) }, e);
      throw e;
    }
  }
  onStep("sending", hash);
  // Con Pollar patrocinando, ya la mandó (y a veces ya la vio entrar): solo se pregunta, mientras siga viva.
  const { enviarYConfirmar, SelloIncierto } = await import("../stellar/envio");
  const d = await enviarYConfirmar({ ...(enviar ? { enviar } : {}), consultar: async () => leerConsulta(await server.getTransaction(hash)), venceEn, sinRedMs, alSaturada: avisarSaturacion });
  if (d.estado === "entro") {
    let value: unknown;
    try {
      value = await valorNativo(d.valor);
    } catch (sinValor) {
      // Entró y no se pudo leer lo que devolvió: con un sello, nunca "otra ronda" (serían dos).
      if (intento) throw new SelloIncierto({ ...intento, hash }, sinValor);
      throw sinValor;
    }
    onStep("confirmed", hash);
    return { hash, value };
  }
  if (d.estado === "sin-respuesta") {
    if (intento) throw new SelloIncierto({ ...intento, hash }, d.error);
    throw Object.assign(new Error("sin-confirmar", { cause: d.error }), { txHash: hash });
  }
  throw errorDelDesenlace(d);
}

/**
 * Averigua si un sello que se cortó entró (`resolverSello`), con la red de
 * testigo: la hora de cierre del último ledger, el contrato y, si se sabe, el
 * hash de su transacción.
 */
export async function resolverSelloEnLaRed(intento: IntentoDeSello, onStep?: OnStep): Promise<Resolucion> {
  const contractId = network.contractId;
  if (!contractId) return { estado: "no-se-sabe", error: new Error("no-contract-on-network") };
  onStep?.("verifying");
  const [{ ultimoLedger, selloDelIntento }, { server }, { resolverSello }, { rpcActual }] = await Promise.all([import("../stellar/seals"), import("../stellar/contract"), import("../stellar/envio"), import("../stellar/rpc-red")]);
  return resolverSello(intento, {
    // El RPC vigente en cada vuelta: si el que se usaba se cae mientras se averigua, la próxima pregunta sale por el otro.
    ultimoLedger: () => ultimoLedger(rpcActual()),
    buscarSello: (i) => selloDelIntento(i, contractId, rpcActual()),
    consultarHash: async (hash) => {
      const c = await server.getTransaction(hash);
      if (c.status !== "SUCCESS") return { status: c.status };
      try {
        return { status: c.status, raffleId: String(unwrap<bigint>(await valorNativo(c.returnValue))) };
      } catch {
        return { status: c.status };
      }
    },
  });
}
