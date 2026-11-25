import { Account, Address, Operation, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { INCLUSION_BASE, RED_DE_PRUEBA } from "./red";

/**
 * Las transacciones de la prueba, armadas solo con el SDK 17 del sitio. Puras: no tocan la red.
 *
 * La cuenta de contrato no puede ser origen ni pagar. El origen y el pagador es siempre la cuenta descartable, y la llave
 * solo firma la entrada de autorización de `seal`. Entre el kit (que usa su propio SDK) y esto solo pasan cadenas base64.
 */

/** La vida de cada sobre, en segundos. */
export const VIDA_DEL_SOBRE_S = 30;

/** Una invocación de contrato, antes de armarse como operación: así se le pueden cambiar las entradas de autorización. */
export interface OperacionDeContrato {
  contract: string;
  function: string;
  args: xdr.ScVal[];
  auth?: xdr.SorobanAuthorizationEntry[];
}

export interface ArmadoBase {
  /** La cuenta descartable que paga y firma. */
  origen: string;
  /** Su secuencia actual: la transacción usa la siguiente. */
  secuencia: string;
  /** Lo que se paga de inclusión, en stroops. */
  inclusion?: string;
}

function armar(o: ArmadoBase, operacion: ReturnType<typeof Operation.invokeContractFunction>): string {
  return new TransactionBuilder(new Account(o.origen, o.secuencia), { fee: o.inclusion ?? INCLUSION_BASE, networkPassphrase: RED_DE_PRUEBA.passphrase })
    .addOperation(operacion)
    .setTimeout(VIDA_DEL_SOBRE_S)
    .build()
    .toXDR();
}

/** La creación de la cuenta tal como la armó el kit (la función y las entradas en base64), a nombre de la cuenta descartable. */
export function armarCreacion(o: ArmadoBase & { funcB64: string; authB64: string[] }): string {
  const operacion = Operation.invokeHostFunction({
    func: xdr.HostFunction.fromXDR(o.funcB64, "base64"),
    auth: o.authB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
  });
  return armar(o, operacion);
}

/** La llamada a `seal` de nuestro contrato, con el orden y el tipo de la firma de `lib.rs`. Sin entradas todavía. */
export function operacionDeSello(o: { organizador: string; huella: Uint8Array; cantidad: number; ganadores: number; ronda: number }): OperacionDeContrato {
  return {
    contract: RED_DE_PRUEBA.contrato,
    function: "seal",
    args: [
      new Address(o.organizador).toScVal(),
      xdr.ScVal.scvBytes(o.huella),
      nativeToScVal(o.cantidad, { type: "u32" }),
      nativeToScVal(o.ganadores, { type: "u32" }),
      nativeToScVal(BigInt(o.ronda), { type: "u64" }),
      nativeToScVal("", { type: "string" }),
    ],
  };
}

/** La invocación como operación del SDK. */
export function aOperacion(d: OperacionDeContrato): ReturnType<typeof Operation.invokeContractFunction> {
  return Operation.invokeContractFunction({ contract: d.contract, function: d.function, args: d.args, ...(d.auth ? { auth: d.auth } : {}) });
}

/**
 * La transacción de una operación, con su vida de 30 s tomada en este instante. Se usa dos veces en el sello: para la
 * simulación de grabar (un sobre que nunca se envía) y DESPUÉS del desbloqueo para el sobre final. Así un desbloqueo lento
 * no deja el sobre vencido ni cuesta otro desbloqueo.
 */
export function armarConOperacion(o: ArmadoBase & { operacion: OperacionDeContrato }): string {
  return armar(o, aOperacion(o.operacion));
}

/** El dueño de una entrada de autorización de dirección, o `null` si no es de dirección. */
function duenoDeLaEntrada(entrada: xdr.SorobanAuthorizationEntry): string | null {
  const c = entrada.credentials as unknown as { type: string; address?: { address: xdr.ScAddress }; addressV2?: { address: xdr.ScAddress }; value?: { address: xdr.ScAddress } };
  const direccion = c.type === "sorobanCredentialsAddress" ? (c.address ?? c.value) : c.type === "sorobanCredentialsAddressV2" ? (c.addressV2 ?? c.value) : undefined;
  if (!direccion) return null;
  return Address.fromScAddress(direccion.address).toString();
}

/**
 * Las entradas que hay que firmar de lo que devolvió la simulación. Rechaza cualquier cosa que no sea una credencial de
 * dirección cuyo dueño es el organizador: la llave solo aprueba lo suyo.
 */
export function entradasPorFirmar(simAuthB64: string[], organizador: string): string[] {
  if (simAuthB64.length === 0) throw new Error("sin-entradas");
  for (const b64 of simAuthB64) {
    const entrada = xdr.SorobanAuthorizationEntry.fromXDR(b64, "base64");
    if (duenoDeLaEntrada(entrada) !== organizador) throw new Error("entrada-ajena");
  }
  return [...simAuthB64];
}

/** La misma operación con las entradas ya firmadas. */
export function conEntradasFirmadas(operacion: OperacionDeContrato, firmadasB64: string[]): OperacionDeContrato {
  return { ...operacion, auth: firmadasB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")) };
}

/** Guarda de que el ensamblado no cambió la firma: las entradas de la transacción son las que firmó la llave, en orden. */
export function mismaAutorizacion(txXdr: string, firmadasB64: string[]): boolean {
  try {
    const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase) as Transaction;
    const op = tx.operations[0];
    if (!op || op.type !== "invokeHostFunction") return false;
    const auth = op.auth ?? [];
    if (auth.length !== firmadasB64.length) return false;
    return auth.every((a, i) => a.toXDR("base64") === firmadasB64[i]);
  } catch {
    return false;
  }
}

/** La llamada a `draw`: no pide la autorización de nadie. La firma va sin comprimir, de 96 bytes. */
export function armarSorteo(o: ArmadoBase & { id: bigint; firma96: Uint8Array }): string {
  const operacion = Operation.invokeContractFunction({
    contract: RED_DE_PRUEBA.contrato,
    function: "draw",
    args: [nativeToScVal(o.id, { type: "u64" }), xdr.ScVal.scvBytes(o.firma96)],
  });
  return armar(o, operacion);
}

/** La lectura de un sorteo que ya salió (`get_draw`): solo se simula, nunca se manda. */
export function armarLectura(o: ArmadoBase & { id: bigint }): string {
  const operacion = Operation.invokeContractFunction({
    contract: RED_DE_PRUEBA.contrato,
    function: "get_draw",
    args: [nativeToScVal(o.id, { type: "u64" })],
  });
  return armar(o, operacion);
}

/** El hash de una transacción armada, en hexadecimal: se conoce antes de mandarla. */
export function hashDeTransaccion(txXdr: string): string {
  const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase);
  return Array.from(tx.hash(), (n) => n.toString(16).padStart(2, "0")).join("");
}

/** Hasta qué segundo de la red vale la transacción (su `maxTime`). */
export function maxTimeDe(txXdr: string): number {
  const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase) as Transaction;
  return Number(tx.timeBounds?.maxTime ?? 0);
}
