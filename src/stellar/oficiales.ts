import deployments from "./deployments.json";
import { RPC_URLS, type NetworkName } from "./config";

/**
 * Los contratos de Tinkazo en los que se cree, por red.
 *
 * Un comprobante anclado trae la red, la dirección del contrato y el número del
 * sorteo. Hasta el 22 de octubre de 2026 la página de verificación le creía al
 * enlace la dirección: un contrato propio de veinte líneas, en testnet, que
 * devolviera lo que su dueño quisiera, salía "El sorteo cuadra y está en
 * Stellar". Ahora solo cuentan los de `deployments.json`, el vigente y los
 * anteriores, y además su instancia tiene que correr el `.wasm` que dice ahí
 * (`registro.ts` lo lee de la cadena): una dirección de la lista con otro código
 * tampoco vale.
 *
 * Es la fuente única: la usan verificar y evento, y la van a usar la CLI, el SDK
 * y el widget. Sin SDK de Stellar: es una tabla.
 */

export type Red = NetworkName;

export interface ContratoOficial {
  red: Red;
  contractId: string;
  /** sha256 del `.wasm` que tiene que correr la instancia, en hex. */
  wasmSha256: string;
  rpcUrl: string;
  passphrase: string;
  /** Es el contrato con el que sella hoy el sitio en esa red (los anteriores solo se leen). */
  vigente: boolean;
  /**
   * En un contrato anterior, el último número que dio mientras era el del sitio.
   * El contrato no tiene dueño ni se puede apagar: cualquiera puede seguir
   * sellando en él, y lo que selle ahí ya no es un sorteo de Tinkazo (ni aparece
   * en los otros sellos del organizador, que se leen del vigente).
   */
  ultimoId?: number;
  /**
   * En un contrato anterior, el ledger en que cayó ese último sello (el
   * `sealed_ledger` del sorteo `ultimoId`). La transacción de un sello no trae el
   * número del sorteo (lo devuelve el contrato), así que el historial no puede
   * aplicar `ultimoId`: lo que se selló en el contrato después de este ledger no
   * es un sorteo de Tinkazo. Un anterior sin esto no se acepta por historial
   * (`historial.ts`); por estado sigue valiendo con `ultimoId`.
   */
  ultimoLedger?: number;
}

interface Anterior {
  contractId: string;
  wasmSha256: string;
  deployedAt?: string;
  ultimoId?: number;
  ultimoLedger?: number;
}

interface Despliegue extends Anterior {
  rpcUrl?: string;
  networkPassphrase?: string;
  anteriores?: Anterior[];
}

const PASSPHRASE: Record<Red, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

const DESPLIEGUES = deployments as unknown as Partial<Record<Red, Despliegue | null>>;

const REDES: readonly Red[] = ["testnet", "mainnet"];

/** Todos los contratos oficiales, de una red o de todas. */
export function contratosOficiales(red?: Red): ContratoOficial[] {
  const out: ContratoOficial[] = [];
  for (const r of red ? [red] : REDES) {
    const d = DESPLIEGUES[r];
    if (!d?.contractId) continue;
    const comun = { red: r, rpcUrl: d.rpcUrl ?? RPC_URLS[r], passphrase: d.networkPassphrase ?? PASSPHRASE[r] };
    out.push({ ...comun, contractId: d.contractId, wasmSha256: d.wasmSha256.toLowerCase(), vigente: true });
    for (const a of d.anteriores ?? []) {
      // Un anterior sin `ultimoId` no se acepta: sin ese tope, quien quisiera podría
      // sellar en él hoy, fuera de la vista de los otros sellos.
      if (!Number.isSafeInteger(a.ultimoId) || (a.ultimoId as number) < 0) continue;
      const ultimoLedger = Number.isSafeInteger(a.ultimoLedger) && (a.ultimoLedger as number) > 0 ? (a.ultimoLedger as number) : null;
      out.push({
        ...comun,
        contractId: a.contractId,
        wasmSha256: a.wasmSha256.toLowerCase(),
        vigente: false,
        ultimoId: a.ultimoId as number,
        ...(ultimoLedger !== null ? { ultimoLedger } : {}),
      });
    }
  }
  return out;
}

/** La passphrase de una red, con la que se calcula el hash de sus transacciones. */
export const passphraseDe = (red: Red): string => PASSPHRASE[red];

/**
 * El contrato oficial que nombra un comprobante, o `null` si la red o la
 * dirección no son de Tinkazo. Compara el texto exacto: una dirección con otra
 * letra, en minúsculas o con espacios ya es otra.
 */
export function contratoOficial(net: unknown, contract: unknown): ContratoOficial | null {
  if (typeof net !== "string" || typeof contract !== "string") return null;
  if (!(REDES as readonly string[]).includes(net)) return null;
  return contratosOficiales(net as Red).find((c) => c.contractId === contract) ?? null;
}
