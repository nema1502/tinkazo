import { network } from "../stellar/config";

/**
 * Las grabaciones de sorteos que están en curso en esta página, una por sorteo. Las piden el show (`draw.ts`) y Guardarlo
 * ahora de Mis sorteos (`history.ts`), las dos por `grabar-sorteo.ts`, que pasa por acá. Mientras un sorteo se está
 * grabando, otro pedido del mismo sorteo espera ese y recibe cómo terminó, en vez de mandar otro.
 *
 * Hasta el 16 de noviembre de 2026 la guarda vivía en `draw.ts` y era por sello, así que Mis sorteos no la veía. Con la
 * billetera propia, el show pide la grabación al terminar, y en ese momento Mis sorteos ofrecía Guardarlo ahora para el
 * mismo sorteo: eran dos ventanas para aprobar y, aprobadas las dos, la segunda fallaba en la cadena y su comisión se
 * pagaba igual. El ganador no cambiaba (el contrato acepta un solo sorteo por sello).
 *
 * Vive aparte para que Mis sorteos pregunte si un sorteo se está grabando sin bajar lo que graba.
 */

const enCurso = new Map<string, Promise<unknown>>();

/** El sorteo en esta red y en este contrato: los números arrancan en 1 en cada contrato. */
const clave = (id: string | bigint): string => `${network.name}|${network.contractId ?? ""}|${String(id)}`;

/** Hay una grabación de este sorteo en curso en esta página. */
export function seEstaGrabando(id: string | bigint): boolean {
  return enCurso.has(clave(id));
}

/** Se cumple cuando termina la grabación en curso de este sorteo, haya terminado como haya terminado. Sin ninguna, enseguida. */
export async function alTerminarDeGrabar(id: string | bigint): Promise<void> {
  await enCurso.get(clave(id))?.catch(() => undefined);
}

/** Graba este sorteo con `grabar`, salvo que ya se esté grabando: entonces devuelve esa misma grabación. */
export function unaGrabacionALaVez<T>(id: string | bigint, grabar: () => Promise<T>): Promise<T> {
  const k = clave(id);
  const ya = enCurso.get(k);
  if (ya) return ya as Promise<T>;
  const p: Promise<T> = grabar().finally(() => {
    if (enCurso.get(k) === p) enCurso.delete(k);
  });
  enCurso.set(k, p);
  return p;
}
