import { Account, Address, MuxedAccount, Operation, StrKey, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { declaradoDeSobre } from "./cobro";
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

/**
 * La transferencia de monedas de prueba por su contrato de activo: `transfer(from, to, amount)`. Es el mismo mecanismo del
 * dólar digital de otras redes. `hacia` puede ser una G, una M (con su número de nota adentro) o una C. Sin entradas todavía.
 */
export function operacionDeTransferencia(o: { desde: string; hacia: string; monto: bigint }): OperacionDeContrato {
  return {
    contract: RED_DE_PRUEBA.activo,
    function: "transfer",
    args: [new Address(o.desde).toScVal(), new Address(o.hacia).toScVal(), nativeToScVal(o.monto, { type: "i128" })],
  };
}

/** De quién es una entrada de autorización: de la cuenta que manda la transacción, de una dirección, o de algo que no se entiende. */
export type Credencial = { tipo: "origen" } | { tipo: "direccion"; direccion: string } | { tipo: "otra" };

/** La credencial de una entrada de autorización. Nunca lanza. */
export function credencialDe(entradaB64: string): Credencial {
  try {
    const entrada = xdr.SorobanAuthorizationEntry.fromXDR(entradaB64, "base64");
    const tipo = (entrada.credentials as unknown as { type: string }).type;
    if (tipo === "sorobanCredentialsSourceAccount") return { tipo: "origen" };
    const dueno = duenoDeLaEntrada(entrada);
    return dueno === null ? { tipo: "otra" } : { tipo: "direccion", direccion: dueno };
  } catch {
    return { tipo: "otra" };
  }
}

/**
 * Cómo trae la entrada de autorización la llamada que autoriza. `exacta`: es la operación pedida, argumento por argumento.
 * `normalizada`: igual, salvo que el destino pedido era una dirección M y la entrada trae la G de abajo, sin el número.
 * `otra`: cualquier otra cosa, una subllamada o algo que no se entiende.
 */
export type Raiz = "exacta" | "normalizada" | "otra";

/** ¿El destino de la entrada es la G de abajo de la M que se pidió? */
function esLaGDeAbajo(pedido: xdr.ScVal, entrada: xdr.ScVal): boolean {
  try {
    const m = Address.fromScVal(pedido).toString();
    const g = Address.fromScVal(entrada).toString();
    if (!StrKey.isValidMed25519PublicKey(m) || !StrKey.isValidEd25519PublicKey(g)) return false;
    return MuxedAccount.fromAddress(m, "0").baseAccount().accountId() === g;
  } catch {
    return false;
  }
}

/** La forma de la raíz de la entrada frente a la operación que se quiere firmar. Nunca lanza. */
export function raizDeLaEntrada(entradaB64: string, operacion: OperacionDeContrato): Raiz {
  try {
    const entrada = xdr.SorobanAuthorizationEntry.fromXDR(entradaB64, "base64");
    const raiz = entrada.rootInvocation;
    if (raiz.subInvocations.length !== 0) return "otra";
    const f = raiz.function as unknown as { type: string; contractFn?: xdr.InvokeContractArgs; value?: xdr.InvokeContractArgs };
    if (f.type !== "sorobanAuthorizedFunctionTypeContractFn") return "otra";
    const llamada = f.contractFn ?? f.value;
    if (!llamada) return "otra";
    if (Address.fromScAddress(llamada.contractAddress).toString() !== operacion.contract) return "otra";
    if (llamada.functionName.toString() !== operacion.function) return "otra";
    if (llamada.args.length !== operacion.args.length) return "otra";
    let normalizada = false;
    for (let i = 0; i < operacion.args.length; i++) {
      const pedido = operacion.args[i];
      const traido = llamada.args[i];
      if (!pedido || !traido) return "otra";
      if (pedido.toXDR("base64") === traido.toXDR("base64")) continue;
      if (i === 1 && esLaGDeAbajo(pedido, traido)) {
        normalizada = true;
        continue;
      }
      return "otra";
    }
    return normalizada ? "normalizada" : "exacta";
  } catch {
    return "otra";
  }
}

/** La transacción tiene una sola operación y es esta invocación, con el mismo contrato, la misma función y los mismos argumentos. */
export function mismaOperacion(txXdr: string, operacion: OperacionDeContrato): boolean {
  try {
    const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase) as Transaction;
    if (tx.operations.length !== 1) return false;
    const op = tx.operations[0];
    if (!op || op.type !== "invokeHostFunction") return false;
    const esperada = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({ contractAddress: new Address(operacion.contract).toScAddress(), functionName: operacion.function, args: operacion.args }),
    );
    return op.func.toXDR("base64") === esperada.toXDR("base64");
  } catch {
    return false;
  }
}

/** La comisión por recursos que declara una transacción ya ensamblada, en stroops, o cero si no trae datos de Soroban. */
export function recursoDeclarado(txXdr: string): number {
  try {
    return declaradoDeSobre(xdr.TransactionEnvelope.fromXDR(txXdr, "base64")).recursoDeclarado;
  } catch {
    return 0;
  }
}
