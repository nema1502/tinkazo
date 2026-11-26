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

/**
 * Si el error es el tope de sorteos del mes que el servicio de comisiones le puso a la cuenta (`cupo-cuenta` de los
 * sorteos). Por el nombre y la forma, como `esErrorDelPortero`: el módulo del portero se baja aparte.
 */
function esTopeDeSorteos(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const x = e as { name?: unknown; motivo?: unknown; que?: unknown };
  return x.name === "ErrorPortero" && x.motivo === "cupo-cuenta" && x.que === "sorteos";
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
  // Apagado en el build, la condición es una constante falsa y todo este bloque desaparece: el camino de siempre, sin
  // cargar nada de más. Prendido, el servicio de comisiones manda el sorteo de una cuenta de Google en la red principal
  // (`sorteo-del-servicio.ts`) y, si asegura que no lo manda, sigue el camino de abajo. Lo que se esperó al servicio se
  // descuenta de los reintentos de ese camino, con un mínimo (`sorteo-seguro.ts`): la etapa del servicio tiene sus propios
  // topes y la sala puede esperar ese tiempo de más antes de que arranque el camino de siempre, pero nunca se queda sin
  // reintentos. Si ni siquiera se puede preparar el servicio (un módulo que no baja, una configuración que no se lee),
  // todavía no se pidió nada y se sigue por el camino de siempre.
  let yaGastadoMs: number | undefined;
  let reservaPosible = false;
  if (import.meta.env.VITE_SORTEO_SERVIDOR === "1") {
    let servicio: typeof import("./sorteo-del-servicio") | null = null;
    try {
      const [{ sorteoPorServidor }, modulo] = await Promise.all([import("../stellar/alta-config"), import("./sorteo-del-servicio")]);
      if (sorteoPorServidor() && modulo.loTomaElServicio(p.raffleId, !!p.pagarConMiCuenta, p.ahora)) servicio = modulo;
    } catch {
      servicio = null;
    }
    if (servicio) {
      const ahora = p.ahora ?? Date.now;
      const desde = ahora();
      const r = await servicio.sortearPorElServicio({
        raffleId: p.raffleId,
        firma96: decompressG1(p.signature),
        ...(p.alPaso ? { alPaso: p.alPaso } : {}),
        ...(p.ahora ? { ahora: p.ahora } : {}),
        dormir,
      });
      if (r.estado === "listo") return comparar(p.esperados, r.valor, r.yaEstaba);
      if (r.estado === "error") return { estado: "fallo", error: r.error };
      yaGastadoMs = Math.max(0, ahora() - desde);
      reservaPosible = servicio.reservaDelServicioViva(p.raffleId, p.ahora);
    }
  }
  // Si el servicio pudo dejar reservado este sorteo en el cupo de la cuenta sin que se sepa cómo terminó (se cierra solo en
  // unos catorce minutos), un tope de sorteos del mes que aparece ahora puede ser de esa reserva: el sorteo quizás ya está o
  // está por entrar. No se da por definitivo ni se firma de nuevo: se sigue mirando la red con las esperas de siempre.
  let esperandoAlServicio: unknown = null;
  const fin = await sortearConReintentos<{ winners: number[]; randomness: string; txHash?: string }>({
    intentar: async () => {
      if (esperandoAlServicio) throw esperandoAlServicio;
      try {
        return await drawOnChain(p.raffleId, decompressG1(p.signature), p.alPaso ?? (() => undefined), { pagarConMiCuenta: !!p.pagarConMiCuenta });
      } catch (e) {
        if (reservaPosible && esTopeDeSorteos(e)) esperandoAlServicio = e;
        throw e;
      }
    },
    yaEsta: () => readDraw(p.raffleId),
    reintentable: (e) => (esperandoAlServicio !== null && e === esperandoAlServicio) || sorteoReintentable(e),
    alReintentar: p.alReintentar ?? (() => undefined),
    ...(p.ahora ? { ahora: p.ahora } : {}),
    ...(yaGastadoMs !== undefined ? { yaGastadoMs } : {}),
    dormir,
  });
  if (!fin.ok) {
    // El tope de sorteos que se esperaba por la reserva del servicio y nunca se confirmó como real: si el envío del servicio no
    // llegó, la fecha del mes que viene sería falsa (el tope vuelve a aceptarse cuando el servicio cierra su reserva, unos
    // catorce minutos). Se dice lo que es verdad con el texto de siempre: no se pudo cubrir el sorteo ahora y queda en Mis sorteos.
    if (import.meta.env.VITE_SORTEO_SERVIDOR === "1" && esperandoAlServicio !== null && fin.error === esperandoAlServicio) return { estado: "fallo", error: await sinCubrirPorAhora(fin.error) };
    return { estado: "fallo", error: fin.error };
  }
  return comparar(p.esperados, fin.valor, fin.yaEstaba);
}

/** El no del portero que dice lo que es verdad mientras la reserva del servicio siga viva. Si el módulo no baja, el de antes. */
async function sinCubrirPorAhora(e: unknown): Promise<unknown> {
  try {
    const { ErrorPortero } = await import("../stellar/patrocinador");
    return new ErrorPortero("fondo", 503, { detalle: "reserva-del-servicio" });
  } catch {
    return e;
  }
}

/** Compara los ganadores que dice el contrato con los que la sala ya vio. */
function comparar(esperados: readonly number[], valor: { winners: readonly number[]; txHash?: string }, yaEstaba: boolean): FinDeLaGrabacion {
  const grabados = [...valor.winners];
  if (!mismosGanadores(esperados, grabados)) return { estado: "no-coincide", esperados: [...esperados], grabados };
  return { estado: "guardado", ...(valor.txHash ? { txHash: valor.txHash } : {}), yaEstaba };
}
