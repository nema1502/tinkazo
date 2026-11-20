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
 *
 * La misma tabla tiene los contratos de premios (`premios`): las campañas que pueden sellar en el
 * sorteo oficial de su red. Está vacía mientras la designación oficial esté pendiente (#167), y una
 * red sin entradas no acepta ningún sello de premios.
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

/**
 * Un contrato de premios: las campañas de una red que pueden sellar en el sorteo oficial de esa red.
 *
 * Una campaña con premio no sella en el contrato del sorteo: llama a `seal` del contrato de premios,
 * que guarda la promoción (el depósito, las bases, la lista) y sella adentro, en el sorteo oficial que
 * declara su `Config.raffle`. Por eso el comprobante de una campaña cita una transacción que no es un
 * `seal` del contrato del sorteo: esta tabla es la que dice en qué contratos de premios se cree, y solo
 * en esos (`historial.ts` y `premios.ts`).
 */
export interface ContratoDePremios {
  red: Red;
  contractId: string;
  /**
   * sha256 del `.wasm` que tiene que correr la instancia, si la tabla lo declara. Un contrato no puede
   * cambiar su código: si no coincide, el RPC no está contestando por ese contrato.
   */
  wasmSha256?: string;
  rpcUrl: string;
  passphrase: string;
}

interface PremioDesplegado {
  contractId: string;
  deployedAt?: string;
  wasmSha256?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

/** La tabla de contratos de premios de `deployments.json`, por red. */
export type TablaDePremios = Partial<Record<Red, readonly PremioDesplegado[]>>;

const PASSPHRASE: Record<Red, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

const DESPLIEGUES = deployments as unknown as Partial<Record<Red, Despliegue | null>>;

/**
 * La tabla de contratos de premios. Vacía en las dos redes mientras la designación oficial esté
 * pendiente (issue #167): una red sin entradas no acepta ningún sello de premios.
 */
const TABLA_DE_PREMIOS = (deployments as unknown as { premios?: TablaDePremios }).premios ?? {};

const REDES: readonly Red[] = ["testnet", "mainnet"];

/** Los contratos de premios designados, de una red o de todas. */
export function contratosDePremios(red?: Red, tabla: TablaDePremios = TABLA_DE_PREMIOS): ContratoDePremios[] {
  const out: ContratoDePremios[] = [];
  for (const r of red ? [red] : REDES) {
    for (const p of tabla[r] ?? []) {
      // Una entrada sin dirección no designa nada: no se acepta un contrato que no está escrito.
      if (typeof p?.contractId !== "string" || !p.contractId) continue;
      out.push({
        red: r,
        contractId: p.contractId,
        ...(p.wasmSha256 ? { wasmSha256: p.wasmSha256.toLowerCase() } : {}),
        rpcUrl: p.rpcUrl ?? RPC_URLS[r],
        passphrase: p.networkPassphrase ?? PASSPHRASE[r],
      });
    }
  }
  return out;
}

/**
 * El contrato de premios que nombra una transacción, o `null` si esa red no lo tiene designado. Compara
 * el texto exacto, como `contratoOficial`: una dirección con otra letra ya es otro contrato.
 */
export function contratoDePremios(net: unknown, contract: unknown, tabla: TablaDePremios = TABLA_DE_PREMIOS): ContratoDePremios | null {
  if (typeof net !== "string" || typeof contract !== "string") return null;
  if (!(REDES as readonly string[]).includes(net)) return null;
  return contratosDePremios(net as Red, tabla).find((c) => c.contractId === contract) ?? null;
}

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
