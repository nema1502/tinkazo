import { t } from "../i18n";
import { network, txUrl } from "../stellar/config";

/**
 * Sellar y sortear contra el contrato.
 *
 * Cada paso avisa por `onStep` para que la interfaz cuente qué está pasando:
 * una transacción que tarda sin decir nada parece una que se colgó.
 *
 * El SDK vive en un fragmento aparte, así que estas funciones lo cargan con
 * `import()` la primera vez que alguien sella de verdad.
 */

export type AnchorStep = "simulating" | "signing" | "sending" | "confirmed";

/**
 * `detail` lleva el costo estimado en el paso de firma y el hash de la
 * transacción al confirmar. Antes de firmar, el organizador tiene que ver
 * cuánto le va a salir.
 */
export type OnStep = (step: AnchorStep, detail?: string) => void;

/** Fee de la transacción ya simulada, en XLM, para mostrarlo antes de firmar. */
function feeInXlm(tx: { built?: { fee?: string | number } }): string | undefined {
  const raw = tx.built?.fee;
  if (raw === undefined) return undefined;
  const stroops = Number(raw);
  if (!Number.isFinite(stroops)) return undefined;
  return (stroops / 1e7).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " XLM";
}

export interface SealArgs {
  organizer: string;
  listHash: Uint8Array;
  count: number;
  numWinners: number;
  round: number;
  meta: string;
}

export interface SealResult {
  raffleId: bigint;
  txHash: string;
}

export interface DrawResult {
  winners: number[];
  randomness: string;
  txHash: string;
}

const toHex = (b: Uint8Array | ArrayLike<number>): string =>
  [...Array.from(b as ArrayLike<number>)].map((n) => n.toString(16).padStart(2, "0")).join("");

/** Registra el sello en el contrato. Exige la firma del organizador. */
export async function sealOnChain(args: SealArgs, onStep: OnStep): Promise<SealResult> {
  const { getClient } = await import("../stellar/contract");
  const client = await getClient();
  onStep("simulating");
  const tx = await client.seal({
    organizer: args.organizer,
    list_hash: args.listHash as unknown as Buffer,
    count: args.count,
    num_winners: args.numWinners,
    round: BigInt(args.round),
    meta: args.meta.slice(0, 160),
  });
  onStep("signing", feeInXlm(tx));
  const sent = await tx.signAndSend();
  const raw = sent.result as unknown;
  const raffleId = unwrap<bigint>(raw);
  const txHash = sent.sendTransactionResponse?.hash ?? "";
  onStep("confirmed", txHash);
  return { raffleId, txHash };
}

/**
 * Finaliza el sorteo en el contrato con la firma de la ronda. No exige
 * autorización del organizador: cualquiera puede hacerlo una vez que la ronda
 * existe, así que el organizador no puede retener un resultado que no le gusta.
 */
export async function drawOnChain(
  raffleId: bigint,
  signature96: Uint8Array,
  onStep: OnStep,
): Promise<DrawResult> {
  const { getClient } = await import("../stellar/contract");
  const client = await getClient();
  onStep("simulating");
  const tx = await client.draw({
    raffle_id: raffleId,
    signature: signature96 as unknown as Buffer,
  });
  onStep("signing", feeInXlm(tx));
  const sent = await tx.signAndSend();
  const draw = unwrap<{ winners: number[]; randomness: Uint8Array }>(sent.result as unknown);
  const txHash = sent.sendTransactionResponse?.hash ?? "";
  onStep("confirmed", txHash);
  return {
    winners: [...draw.winners],
    randomness: toHex(draw.randomness),
    txHash,
  };
}

/** Lee un sorteo ya registrado. Sirve para reanudar y para `AlreadyDrawn`. */
export async function readDraw(
  raffleId: bigint,
): Promise<{ winners: number[]; randomness: string } | null> {
  const { getClient } = await import("../stellar/contract");
  const client = await getClient();
  const res = await client.get_draw({ raffle_id: raffleId });
  const d = res.result;
  if (!d) return null;
  return { winners: [...d.winners], randomness: toHex(d.randomness as unknown as Uint8Array) };
}

/** Los métodos que devuelven `Result` traen un envoltorio con `unwrap`. */
function unwrap<T>(value: unknown): T {
  if (value && typeof value === "object" && "unwrap" in value) {
    return (value as { unwrap(): T }).unwrap();
  }
  return value as T;
}

/* --------------------------------------------------------------- interfaz */

/** Texto de cada paso, para el botón y la línea de estado. */
export function stepLabel(step: AnchorStep): string {
  return t(
    step === "simulating"
      ? "txSimulating"
      : step === "signing"
        ? "txSigning"
        : step === "sending"
          ? "txSending"
          : "txConfirmed",
  );
}

/**
 * Línea de estado bajo el botón. Al confirmarse deja el enlace a la
 * transacción en el explorador, que es lo que el organizador va a compartir.
 */
export function showTxStatus(containerId: string, step: AnchorStep, detail?: string): void {
  const host = document.getElementById(containerId);
  if (!host) return;
  host.style.display = "block";
  host.className = step === "confirmed" ? "txstatus ok" : "txstatus";
  host.textContent = stepLabel(step);
  if (step === "signing" && detail) {
    // El costo antes de firmar, no después.
    host.textContent = `${stepLabel(step)} ${t("txCost")} ${detail}`;
    return;
  }
  const txHash = step === "confirmed" ? detail : undefined;
  if (step === "confirmed" && txHash) {
    host.textContent = stepLabel(step) + " ";
    const a = document.createElement("a");
    a.href = txUrl(txHash);
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "mono";
    a.textContent = `${txHash.slice(0, 8)}… ↗`;
    host.appendChild(a);
    const net = document.createElement("span");
    net.className = "kicker";
    net.style.marginLeft = "8px";
    net.textContent = network.name;
    host.appendChild(net);
  }
}

export function hideTxStatus(containerId: string): void {
  const host = document.getElementById(containerId);
  if (host) host.style.display = "none";
}

/** Mensaje de error de una invocación, ya traducido. */
export async function anchorErrorText(e: unknown): Promise<string> {
  const { errorKey } = await import("../stellar/contract");
  return t("errAnchor." + errorKey(e)) || t("errAnchor.unknown");
}
