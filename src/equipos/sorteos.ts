import { network } from "../stellar/config";
import { contratosOficiales } from "../stellar/oficiales";
import type { ChainRaffle } from "../stellar/seals";

/**
 * Qué equipos ya sortearon con Tinkazo desde su propia cuenta.
 *
 * En el modo «con sorteo propio», para recibir el cupón el equipo tiene que haber sellado al menos un sorteo con su
 * cuenta (la del encargado, con la que entró con Google) en la misma red del evento. Eso queda en el contrato: cada
 * sello guarda la cuenta de quien lo hizo. Se lee del contrato vigente y de los anteriores de la lista oficial, como
 * el historial de Mis sorteos (`sealsOfAccount`), pero recorriendo cada contrato UNA vez para todos los equipos y no
 * una por equipo.
 *
 * Los sorteos de ejemplo y las demos no graban nada en la cadena, así que no cuentan.
 */

export interface YaSorteo {
  /** El número del sorteo en su contrato. */
  id: string;
  /** El contrato donde está el sello. */
  contrato: string;
  /** Cuándo se selló (segundos). */
  sellado: number;
  /** El primero que hizo esta cuenta. */
  prize: string;
}

export interface LecturaDeSorteos {
  /** Por cuenta, su primer sorteo. Las que no están no sortearon (o su sello es más viejo de lo que se lee). */
  porCuenta: Map<string, YaSorteo>;
  /** Algún contrato tiene más sorteos de los que se leen: una cuenta ausente puede tener uno más viejo. */
  truncado: boolean;
}

type Escaneo = { todos: ChainRaffle[]; truncated: boolean } | null;

export interface OpcionesDeSorteos {
  /** Para las pruebas: otra forma de recorrer un contrato. */
  escanear?: (contractId: string, rpcUrl: string, ultimoId?: number) => Promise<Escaneo>;
  /** Para las pruebas: otra lista de contratos. */
  contratos?: readonly { contractId: string; rpcUrl: string; ultimoId?: number }[];
}

/**
 * Los equipos de `cuentas` que ya sellaron un sorteo, o `null` si no se pudo preguntar: sin respuesta no se afirma
 * nada (ni «sortearon» ni «no sortearon»). Un contrato anterior sin instancia viva se salta; si ninguno contesta,
 * es `null`.
 */
export async function cuentasQueYaSortearon(cuentas: readonly string[], o: OpcionesDeSorteos = {}): Promise<LecturaDeSorteos | null> {
  const contratos = o.contratos ?? (network.contractId ? contratosOficiales(network.name) : []);
  if (contratos.length === 0 || cuentas.length === 0) return contratos.length === 0 ? null : { porCuenta: new Map(), truncado: false };
  const escanear = o.escanear ?? (async (c, rpc, ultimo) => (await import("../stellar/seals")).escanearContrato(c, rpc, ultimo));
  const buscadas = new Set(cuentas);
  const porCuenta = new Map<string, YaSorteo>();
  let truncado = false;
  let leidos = 0;
  try {
    const escaneos = await Promise.all(contratos.map((c) => escanear(c.contractId, c.rpcUrl, c.ultimoId)));
    for (const e of escaneos) {
      if (!e) continue;
      leidos++;
      truncado ||= e.truncated;
      for (const r of e.todos) {
        if (!buscadas.has(r.organizer)) continue;
        const antes = porCuenta.get(r.organizer);
        if (antes && antes.sellado <= r.sealedAt) continue;
        porCuenta.set(r.organizer, { id: r.id, contrato: r.contract ?? "", sellado: r.sealedAt, prize: r.prize });
      }
    }
  } catch {
    return null;
  }
  return leidos === 0 ? null : { porCuenta, truncado };
}
