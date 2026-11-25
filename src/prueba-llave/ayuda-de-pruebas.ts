import { StrKey } from "@stellar/stellar-sdk";
import { RED_DE_PRUEBA } from "./red";

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
