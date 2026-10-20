import { getLang, t } from "../i18n";
import { roundTime } from "../protocol/quicknet";
import { network, txUrl } from "../stellar/config";
import { grifoApagado, grifoDisponible, hayAyudaDeFondos } from "../stellar/grifo";
import { conAyudaDeFondos, conCuentaLista, conTope, dormirCancelable, esperarCuenta, esperarHasta } from "./reintento";

/**
 * Sellar y sortear contra el contrato.
 *
 * Cada paso avisa por `onStep` para que la interfaz cuente qué está pasando:
 * una transacción que tarda sin decir nada parece una que se colgó.
 *
 * El SDK vive en un fragmento aparte, así que estas funciones lo cargan con
 * `import()` la primera vez que alguien sella de verdad.
 */

/**
 * Los dos últimos pasos solo los ve una cuenta de Pollar (ver `conFondos`):
 * `preparing` es la espera a que la red abra la cuenta, que Pollar crea de fondo
 * después de entrar y tarda unos segundos; `funding`, la carga con el grifo de
 * testnet cuando la comisión no la paga la app.
 */
export type AnchorStep = "simulating" | "signing" | "sending" | "confirmed" | "funding" | "preparing";

/**
 * `detail` lleva el costo estimado en el paso de firma y el hash de la
 * transacción al confirmar. Antes de firmar, quien paga la comisión tiene que
 * ver cuánto le va a salir. Con una cuenta de Pollar no hay costo que mostrar:
 * quizá la paga la app, y si no, la persona lo sabrá por la ayuda de fondos.
 */
export type OnStep = (step: AnchorStep, detail?: string) => void;

/** Fee de la transacción ya simulada, en XLM, para mostrarlo antes de firmar. */
function feeInXlm(tx: { built?: { fee?: string | number } }): string | undefined {
  const raw = tx.built?.fee;
  if (raw === undefined) return undefined;
  const stroops = Number(raw);
  if (!Number.isFinite(stroops)) return undefined;
  // Es el tope que se firma, no lo que se cobra: la red devuelve lo que no usa.
  return (stroops / 1e7).toLocaleString(getLang() === "en" ? "en-US" : "es-BO", { maximumFractionDigits: 2 }) + " XLM";
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
export function sealOnChain(args: SealArgs, onStep: OnStep): Promise<SealResult> {
  return conFondos(() => sellar(args, onStep), onStep);
}

/**
 * Cuántos segundos tienen que faltar para que nazca la ronda al empezar a armar
 * el sello.
 *
 * El contrato rechaza (`RoundTooSoon`, #5) una ronda que nazca a menos de 30 s de
 * cuando la transacción entra a un ledger. `freeze.ts` elige la ronda con 45 s de
 * margen al hacer clic, y de ahí salen unos segundos para simular, firmar y
 * entrar. Si antes se esperó a que Pollar abriera la cuenta, el margen se come: la
 * simulación todavía pasa (mira el último ledger, unos segundos atrás) y la
 * transacción entra al ledger y falla. Se vio el 20 de octubre de 2026 con una
 * cuenta nueva: costó una comisión y unos veinte segundos. Con menos de esto se
 * pide otra ronda antes de mandar nada.
 */
const MARGEN_DE_RONDA_S = 40;

/**
 * La ronda ya no alcanza. Es el mismo caso que el contrato rechaza con `RoundTooSoon`
 * (#5), y por eso lleva ese texto: `selloSinGrabar` lo reconoce y `freeze.ts` reintenta
 * con una ronda nueva, sin que haya quedado nada en la cadena; si fuera lo último que
 * pasa, `errorKey` lo cuenta como "esa ronda está demasiado cerca".
 */
class RondaMuyCerca extends Error {
  constructor(faltan: number) {
    super(`la ronda quedó cerca antes de mandar el sello (faltan ${Math.max(0, Math.round(faltan))} s): Error(Contract, #5)`);
    this.name = "RondaMuyCerca";
  }
}

async function sellar(args: SealArgs, onStep: OnStep): Promise<SealResult> {
  const { getClient } = await import("../stellar/contract");
  const client = await getClient();
  const faltan = roundTime(args.round) - Date.now() / 1000;
  if (faltan < MARGEN_DE_RONDA_S) throw new RondaMuyCerca(faltan);
  onStep("simulating");
  const tx = await client.seal({
    organizer: args.organizer,
    list_hash: args.listHash as unknown as Buffer,
    count: args.count,
    num_winners: args.numWinners,
    round: BigInt(args.round),
    meta: args.meta.slice(0, 160),
  });
  onStep("signing", await costoVisible(tx));

  const delegated = await submitElsewhere(tx, onStep);
  if (delegated) {
    return { raffleId: unwrap<bigint>(delegated.value), txHash: delegated.hash };
  }

  const sent = await tx.signAndSend();
  const raffleId = unwrap<bigint>(resultadoDe(sent));
  const txHash = sent.sendTransactionResponse?.hash ?? "";
  onStep("confirmed", txHash);
  return { raffleId, txHash };
}

/**
 * Lo que devolvió una invocación que `signAndSend` mandó y esperó.
 *
 * Si la transacción entró a un ledger y falló (con el sello, casi siempre porque
 * la ronda quedó a menos de 30 s mientras la red andaba lenta), el SDK no lo
 * dice: con el protocolo 23 o posterior la respuesta trae `returnValue` como una
 * clave sin valor, `sent.result` la lee igual y revienta con
 * `TypeError: Cannot read properties of undefined (reading 'type')`. Ese error
 * no lo reconoce nadie, así que el sello no se reintentaba con otra ronda y
 * quien entraba con Freighter o con la cuenta de prueba veía "la red rechazó la
 * transacción" y tenía que apretar de nuevo (medido el 20 de octubre de 2026 con
 * la cuenta de prueba: 6 de 16 sellos fallaron así, por igual antes y después
 * de los cambios de fondos).
 *
 * Se mira el estado antes de leer el resultado y se lanza `tx-FAILED`, que es lo
 * mismo que dice `readReturnValue` y lo que `selloSinGrabar` y `errorKey` ya
 * entienden. Una transacción fallida no deja nada grabado, así que reintentar no
 * puede dejar dos sellos.
 */
function resultadoDe(sent: { result: unknown; getTransactionResponse?: { status?: string } }): unknown {
  const estado = sent.getTransactionResponse?.status;
  if (estado && estado !== "SUCCESS") throw new Error("tx-" + estado);
  return sent.result;
}

/**
 * Algunas wallets firman y envían de una sola vez contra su propio servidor.
 * Ahí no se puede usar `signAndSend`, porque la transacción saldría dos veces:
 * se les entrega el XDR y el resultado de la invocación se lee de la red.
 *
 * Devuelve `null` si la wallet activa no es de ese tipo, y sigue el camino
 * normal de firmar acá y enviar nosotros.
 */
async function submitElsewhere(
  tx: { toXDR(): string; readonly simulationData: unknown },
  onStep: OnStep,
): Promise<{ hash: string; value: unknown } | null> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([
    import("../stellar/wallet"),
    import("../stellar/wallet-pollar"),
  ]);
  const wallet = activeWallet();
  if (!submitsItself(wallet)) return null;
  // `signAndSend` del SDK mira la simulación antes de firmar y lanza si el
  // contrato dijo que no ("Transaction simulation failed: Error(Contract, #5)":
  // la ronda quedó demasiado cerca). Esta wallet recibe el XDR sin pasar por ahí,
  // y `client.seal()` no lanza cuando la simulación falla: devuelve la
  // transacción sin armar, con la comisión base y sin datos de Soroban, que la
  // red rechaza como malformada (`txMALFORMED`, que Pollar cuenta como
  // `txFailed`). Se vio el 19 de octubre de 2026, y es lo que pasaba con una
  // ronda cerca. Leer la simulación acá lanza el error de verdad, igual que con
  // las otras wallets, y `freeze.ts` reintenta con otra ronda.
  void tx.simulationData;
  const hash = await wallet.signAndSubmit(tx.toXDR());
  onStep("sending", hash);
  const value = await readReturnValue(hash);
  onStep("confirmed", hash);
  return { hash, value };
}

/**
 * El costo que se le muestra a quien firma. Con una cuenta de Pollar no se
 * muestra: puede que la comisión la pague la app y entonces es cero, y un
 * número que quizá paga otro asusta a quien solo quiere sortear. Con las demás
 * wallets es el de siempre, porque ahí lo paga quien firma.
 */
async function costoVisible(tx: Parameters<typeof feeInXlm>[0]): Promise<string | undefined> {
  const [{ activeWallet }, { submitsItself }] = await Promise.all([
    import("../stellar/wallet-lite"),
    import("../stellar/wallet-pollar"),
  ]);
  return submitsItself(activeWallet()) ? undefined : feeInXlm(tx);
}

/** Cuándo se le pidió fondos al grifo a cada cuenta, para no insistir. */
const grifoPedido = new Map<string, number>();
const ENTRE_PEDIDOS_MS = 90_000;

/**
 * Sellar y sortear con una cuenta de Pollar no debe trabar a nadie.
 *
 * Primero, que la cuenta exista. Pollar la abre en la red de fondo después de
 * entrar y tarda de 5 a 62 segundos: antes de simular se espera a que aparezca
 * (hasta 90 s, con la línea "Preparando tu cuenta…") y nunca se la confunde con
 * una cuenta sin saldo. Si pasan los 90 segundos, se le dice que todavía no está
 * lista y que pruebe de nuevo.
 *
 * Después se intenta como siempre. Si Pollar paga la comisión por la app (con la
 * regla de contrato de su panel prendida) no pasa nada más. Si no la paga y la
 * red dice que la cuenta no tiene con qué, en testnet se la carga sola con el
 * grifo y se reintenta una vez, con una línea de estado y sin que la persona
 * toque nada. Lo que no se puede resolver solo avisa con el evento
 * `tinkazo:sin-fondos` y la pantalla muestra la caja de fondos como último
 * recurso, pero solo en testnet y con el grifo prendido: en mainnet no hay grifo
 * y la persona ve el error de falta de saldo, tal cual.
 *
 * Con otra wallet no cambia nada.
 */
async function conFondos<T>(intento: () => Promise<T>, onStep: OnStep): Promise<T> {
  const [w, { submitsItself }, contrato] = await Promise.all([
    import("../stellar/wallet-lite"),
    import("../stellar/wallet-pollar"),
    import("../stellar/contract"),
  ]);
  const wallet = w.activeWallet();
  const address = wallet?.address ?? "";
  const esPollar = submitsItself(wallet);
  // Si la persona cierra la sesión o cambia de cuenta mientras se espera, se deja de esperar.
  const sesion = esPollar ? cancelarSiCambiaLaSesion(address) : null;
  // El sorteo reintenta varias veces y cada una pasaría por acá: un pedido al
  // grifo cada tanto alcanza, más no cambia nada.
  const reciente = Date.now() - (grifoPedido.get(address) ?? 0) < ENTRE_PEDIDOS_MS;
  const cuentaLista = (): Promise<T> =>
    conCuentaLista(intento, {
      esPollar,
      esperar: (hastaMs) =>
        esperarCuenta({
          existe: () => contrato.accountOnRpc(address),
          alEsperar: () => onStep("preparing"),
          hastaMs,
          ...(sesion ? { signal: sesion.signal } : {}),
        }),
      noExiste: contrato.esCuentaInexistente,
      respirar: (ms) => dormirCancelable(ms, sesion?.signal),
    });
  try {
    return await conAyudaDeFondos(cuentaLista, {
      esPollar,
      // Con `?grifo=0` no hay grifo aunque sea testnet: la persona ve el error tal cual.
      hayGrifo: grifoDisponible() && !reciente,
      sinSaldo: contrato.esSinSaldo,
      avisar: () => {
        console.warn("[tinkazo] la cuenta no tiene con qué pagar la comisión: se la carga con el grifo y se reintenta una vez");
        onStep("funding");
      },
      cargar: async () => {
        grifoPedido.set(address, Date.now());
        // Con tope: el grifo a veces no contesta, y el sellado no puede quedarse
        // esperándolo para siempre. Si no llega, se sigue con el último recurso.
        await conTope(w.fundWithFriendbot(address), 20_000, "friendbot-timeout");
      },
      esperar: async () => {
        // El grifo ya contestó, pero el saldo tarda un instante en verse. Y un
        // respiro más: el RPC, que es el que simula, puede ir un poco atrás de
        // Horizon, que es al que se le pregunta.
        const visto = await esperarHasta(async () => (await w.xlmBalance(address)) >= 1, { cadaMs: 700, hastaMs: 10_000 });
        if (visto) await new Promise((r) => setTimeout(r, 800));
      },
      sinRecurso: () => {
        // La caja de fondos de último recurso es la del grifo: en mainnet no existe
        // (quien entra con Google o con un correo nunca ve una caja que le pide
        // XLM), y con `?grifo=0` quien prueba quiere ver el error y nada más.
        if (!hayAyudaDeFondos(network.name, grifoApagado)) return;
        if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("tinkazo:sin-fondos", { detail: { address } }));
      },
    });
  } finally {
    sesion?.soltar();
  }
}

/**
 * Un `AbortSignal` que se dispara cuando la sesión deja de ser de `address`: se
 * cerró, o se entró con otra cuenta. La pantalla avisa cada vez que se repinta
 * con `tinkazo:sesion` (y lo hace también al cambiar de idioma, con la misma
 * cuenta: ahí no se cancela nada).
 */
function cancelarSiCambiaLaSesion(address: string): { signal: AbortSignal; soltar: () => void } {
  const control = new AbortController();
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
    return { signal: control.signal, soltar: () => undefined };
  }
  const alCambiar = (e: Event): void => {
    if ((e as CustomEvent<string | null>).detail !== address) control.abort();
  };
  document.addEventListener("tinkazo:sesion", alCambiar);
  return { signal: control.signal, soltar: () => document.removeEventListener("tinkazo:sesion", alCambiar) };
}

/** Lee lo que devolvió la invocación, ya confirmada en la red. */
async function readReturnValue(hash: string): Promise<unknown> {
  const { scValToNative } = await import("@stellar/stellar-sdk");
  const { server } = await import("../stellar/contract");
  const res = await server.pollTransaction(hash, { attempts: 12 });
  if (res.status !== "SUCCESS" || !res.returnValue) throw new Error("tx-" + res.status);
  return scValToNative(res.returnValue);
}

/**
 * Finaliza el sorteo en el contrato con la firma de la ronda. No exige
 * autorización del organizador: cualquiera puede hacerlo una vez que la ronda
 * existe, así que el organizador no puede retener un resultado que no le gusta.
 */
export function drawOnChain(
  raffleId: bigint,
  signature96: Uint8Array,
  onStep: OnStep,
): Promise<DrawResult> {
  return conFondos(() => sortear(raffleId, signature96, onStep), onStep);
}

async function sortear(raffleId: bigint, signature96: Uint8Array, onStep: OnStep): Promise<DrawResult> {
  const { getClient } = await import("../stellar/contract");
  const client = await getClient();
  onStep("simulating");
  const tx = await client.draw({
    raffle_id: raffleId,
    signature: signature96 as unknown as Buffer,
  });
  onStep("signing", await costoVisible(tx));

  const delegated = await submitElsewhere(tx, onStep);
  if (delegated) {
    const d = unwrap<{ winners: number[]; randomness: Uint8Array }>(delegated.value);
    return { winners: [...d.winners], randomness: toHex(d.randomness), txHash: delegated.hash };
  }

  const sent = await tx.signAndSend();
  const draw = unwrap<{ winners: number[]; randomness: Uint8Array }>(resultadoDe(sent));
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
          : step === "funding"
            ? "txFunding"
            : step === "preparing"
              ? "txPreparing"
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

/**
 * Si el sello falló sin dejar nada en la cadena, y por el reloj: la ronda
 * quedó demasiado cerca (el contrato devuelve el error 5 al simular), o la
 * transacción entró y falló. En los dos casos reintentar no puede dejar dos
 * sellos. Un plazo vencido o un corte de red no entran: ahí no se sabe si
 * el primero quedó grabado.
 *
 * "Entró y falló" se lee distinto según la wallet: "Transaction failed!" y
 * `tx-FAILED` salen del SDK de Stellar y de esta capa, y Pollar lo cuenta como
 * `txFailed`. Sin este último, quien entra con Google veía "la red rechazó la
 * transacción" y tenía que apretar de nuevo a mano, y el reintento con el grifo,
 * que suma unos segundos, hace que la ronda quede cerca más seguido.
 */
export function selloSinGrabar(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Error\(Contract,\s*#5\)|Transaction failed!|tx-FAILED|txFailed|tx_failed/.test(msg);
}

/** Mensaje de error de una invocación, ya traducido. */
export async function anchorErrorText(e: unknown): Promise<string> {
  const { errorKey } = await import("../stellar/contract");
  return t("errAnchor." + errorKey(e)) || t("errAnchor.unknown");
}
