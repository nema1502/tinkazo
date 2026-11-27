import { Address, StrKey, xdr } from "@stellar/stellar-sdk";
import { RED_DE_PRUEBA } from "./red";
import type { OperacionDeContrato } from "./transacciones";

/** Ayudas para las pruebas: nada de esto se importa desde la página. */

export const hex = (b: Uint8Array): string => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
export const aBase64 = (h: string): string => btoa(String.fromCharCode(...(h.match(/../g) ?? []).map((x) => parseInt(x, 16))));

/**
 * Una entrada de autorización con credenciales de dirección, escrita a mano en XDR: 1 (dirección), la dirección del
 * contrato (1 y sus 32 bytes), el nonce, el vencimiento, la firma vacía, y la raiz que invoca `seal` sin argumentos ni subllamadas.
 */
export function entradaDe(contrato: string, vence = 100): string {
  const quien = `00000001${hex(StrKey.decodeContract(contrato))}`;
  const raiz = `00000000${`00000001${hex(StrKey.decodeContract(RED_DE_PRUEBA.contrato))}`}00000004${hex(new TextEncoder().encode("seal"))}0000000000000000`;
  return aBase64(`00000001${quien}0000000000000000${vence.toString(16).padStart(8, "0")}00000001${raiz}`);
}

/**
 * Una entrada de autorización de la invocación dada, armada con los tipos de XDR del SDK. Con `origen` las credenciales son
 * las de la cuenta que manda la transacción. Con `direccion`, las de la dirección `cuenta`, con la firma vacía.
 * `subllamadas` suma esa cantidad de llamadas dentro de la raíz.
 */
export function entradaDeTransferencia(cuenta: string, operacion: OperacionDeContrato, credencial: "origen" | "direccion", subllamadas = 0): string {
  const llamada = (): xdr.SorobanAuthorizedInvocation =>
    new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(operacion.contract).toScAddress(), functionName: operacion.function, args: operacion.args }),
      ),
      subInvocations: [],
    });
  const raiz = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(operacion.contract).toScAddress(), functionName: operacion.function, args: operacion.args }),
    ),
    subInvocations: Array.from({ length: subllamadas }, llamada),
  });
  const credenciales =
    credencial === "origen"
      ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
      : xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({ address: new Address(cuenta).toScAddress(), nonce: 0n, signatureExpirationLedger: 100, signature: xdr.ScVal.scvVoid() }),
        );
  return new xdr.SorobanAuthorizationEntry({ credentials: credenciales, rootInvocation: raiz }).toXDR("base64");
}
