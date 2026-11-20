import { arranqueDelShow, msHasta } from "../arranque-del-show";
import { horaDeLaRonda } from "../reloj-de-la-ronda";
import { drawOnChain, readDraw, type AnchorStep } from "./anchor";
import { unaGrabacionALaVez } from "./grabacion-en-curso";

/**
 * Grabar el sorteo en la cadena, aparte del show.
 *
 * El juego arranca con el resultado calculado en el navegador (`sorteo-local.ts`) y el sorteo se graba mientras
 * tanto, cuando la cadena lo acepta (`MARGEN_DE_LA_CADENA_S`), con los mismos reintentos de siempre
 * (`sorteo-seguro.ts`). El contrato no pide autorización para grabar: lo puede mandar cualquiera, cuando sea, y acepta
 * uno solo por sello. El ganador no depende de quién lo manda ni de cuándo.
 *
 * Cuando el contrato devuelve los ganadores, se comparan con los calculados. Si no coinciden, es un error grave del
 * programa, y quien llama lo tiene que mostrar: nunca se calla.
 */

export type FinDeLaGrabacion =
  | { estado: "guardado"; txHash?: string; yaEstaba: boolean }
  | { estado: "no-coincide"; esperados: number[]; grabados: number[] }
  | { estado: "fallo"; error: unknown };

export interface PedidoDeGrabacion {
  raffleId: bigint;
  /** La ronda sellada. */
  round: number;
  /** La firma de la ronda, comprimida, en hex, ya verificada. */
  signature: string;
  /** Los ganadores que calculó el navegador y que la sala ya vio. */
  esperados: readonly number[];
  pagarConMiCuenta?: boolean;
  alPaso?: (step: AnchorStep, detail?: string) => void;
  alReintentar?: (proximo: number, total: number, e: unknown) => void;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

/** Los mismos puestos y en el mismo orden: el orden es el de los premios. */
export function mismosGanadores(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ahoraDeLaRondaMs = (): number => horaDeLaRonda() * 1000;

/** Lo que guarda Mis sorteos de un sorteo jugado y sin guardar: alcanza para rehacerlo y grabarlo (`history.ts`). */
export interface SorteoSinGuardar {
  id: string;
  round: number;
  listHash: string;
  count: number;
  numWinners: number;
}

/**
 * Termina de guardar, más tarde, un sorteo que la sala ya vio (se cerró la pestaña durante la grabación, o falló). Pide
 * el número de la ronda, lo comprueba, rehace el resultado con lo sellado y lo graba como siempre, comparando. `o`, lo
 * mismo que el sorteo: pagar con la cuenta propia y los pasos de la grabación (con la billetera propia, la aprobación).
 *
 * Pasa por la misma guarda que el show desde el primer paso (`grabacion-en-curso.ts`): si ese sorteo ya se está
 * grabando, espera esa grabación y dice cómo terminó, sin mandar otra.
 */
export function terminarDeGrabar(e: SorteoSinGuardar, o: Pick<PedidoDeGrabacion, "pagarConMiCuenta" | "alPaso"> = {}): Promise<FinDeLaGrabacion> {
  return unaGrabacionALaVez<FinDeLaGrabacion>(e.id, async () => {
    const [{ fetchRound, bytesToHex, randomnessOf }, { verifyRoundAsync }, { conPlazo, PLAZO_DEL_RELAY_MS }, { resultadoDelSello }] = await Promise.all([
      import("../protocol/quicknet"),
      import("../protocol/firma"),
      import("../pedido-con-plazo"),
      import("../sorteo-local"),
    ]);
    const { signature } = await fetchRound(e.round, { fetchFn: conPlazo(fetch, PLAZO_DEL_RELAY_MS) });
    if (!(await verifyRoundAsync(e.round, signature))) return { estado: "fallo", error: new Error("bad-signature") };
    const esperados = resultadoDelSello({ listHash: e.listHash, count: e.count, numWinners: e.numWinners }, { randomness: bytesToHex(randomnessOf(signature)) });
    return grabar({ raffleId: BigInt(e.id), round: e.round, signature, esperados, ...o });
  });
}

/**
 * Graba el sorteo y compara. Uno a la vez por sorteo, también entre el show y Mis sorteos (`grabacion-en-curso.ts`): si
 * ya se está grabando, devuelve esa misma grabación en vez de mandar otra.
 */
export function grabarElSorteo(p: PedidoDeGrabacion): Promise<FinDeLaGrabacion> {
  return unaGrabacionALaVez(p.raffleId, () => grabar(p));
}

async function grabar(p: PedidoDeGrabacion): Promise<FinDeLaGrabacion> {
  const dormir = p.dormir ?? dormirDeVerdad;
  // La cadena acepta el sorteo unos segundos después de nacer el número: hasta entonces, nada que mandar. Con el reloj de
  // la ronda (`reloj-de-la-ronda.ts`), el mismo de la puerta de la grabación: sin medir, es el de la compu.
  const falta = msHasta(arranqueDelShow(p.round).grabable, (p.ahora ?? ahoraDeLaRondaMs)());
  if (falta > 0) await dormir(falta);
  const [{ decompressG1 }, { sortearConReintentos, sorteoReintentable }] = await Promise.all([import("../protocol/drand"), import("./sorteo-seguro")]);
  const fin = await sortearConReintentos<{ winners: number[]; randomness: string; txHash?: string }>({
    intentar: () => drawOnChain(p.raffleId, decompressG1(p.signature), p.alPaso ?? (() => undefined), { pagarConMiCuenta: !!p.pagarConMiCuenta }),
    yaEsta: () => readDraw(p.raffleId),
    reintentable: sorteoReintentable,
    alReintentar: p.alReintentar ?? (() => undefined),
    ...(p.ahora ? { ahora: p.ahora } : {}),
    dormir,
  });
  if (!fin.ok) return { estado: "fallo", error: fin.error };
  const grabados = [...fin.valor.winners];
  if (!mismosGanadores(p.esperados, grabados)) return { estado: "no-coincide", esperados: [...p.esperados], grabados };
  return { estado: "guardado", ...(fin.valor.txHash ? { txHash: fin.valor.txHash } : {}), yaEstaba: fin.yaEstaba };
}
