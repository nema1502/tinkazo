import { roundTime } from "../protocol/quicknet";
import { app } from "../state";
import { sinGrabar } from "../ensayo-modo";
import { network } from "../stellar/config";
import { activoDePagos, cuentasQuePagan, esDireccionG, pagosActivos } from "../stellar/pagos";
import { crearLectorDePagos } from "../stellar/pagos-red";
import { hayCuentas, montarGanadores } from "./panel-ganadores";
import { pagarPremioEn } from "./pagar-premio";
import { currentSession } from "./wallet-ui";

/**
 * El panel de ganadores en la pantalla del resultado, para quien organiza.
 *
 * Solo con la bandera prendida, con un sorteo anclado (el número del sorteo va en la nota del pago) y cuando entre los
 * ganadores hay cuentas de Stellar: con una lista de nombres no hay a quién pagarle desde acá. Con una cuenta abierta,
 * cada fila con cuenta trae "Pagar premio"; sin ella, el panel solo muestra el estado, como en el comprobante.
 */

/** Un solo lector para la página: lo que ya se leyó no se vuelve a pedir enseguida. */
const lector = crearLectorDePagos();

export function mostrarPagosDelResultado(): void {
  const caja = document.getElementById("pagos-box");
  const { frozen, drawn } = app;
  if (!caja || !pagosActivos() || sinGrabar() || !frozen || !drawn || frozen.raffleId === undefined) return;
  const entradas = drawn.winners.map((i) => frozen.names[i] ?? "");
  if (!hayCuentas(entradas)) return;

  const raffleId = String(frozen.raffleId);
  const sesion = currentSession();
  // Valen los pagos de la cuenta con que se selló (la que está abierta) y de las cuentas de evento configuradas.
  const pagadoras = new Set<string>(cuentasQuePagan());
  if (sesion && esDireccionG(sesion.address)) pagadoras.add(sesion.address);
  // La ronda nace en un instante fijo y público: de ahí se cuentan los 7 días.
  const sorteoEn = roundTime(drawn.beacon.round);
  const activo = activoDePagos(network.name);

  montarGanadores(caja, {
    red: network.name,
    raffleId,
    premio: frozen.prize,
    activo,
    ganadores: drawn.winners.map((i, puesto) => ({ puesto, entrada: frozen.names[i] ?? "" })),
    sorteoEn,
    desde: sorteoEn - 600,
    pagadoras,
    lector,
    ...(sesion ? { pagar: pagarPremioEn({ red: network.name, raffleId, premio: frozen.prize, activo, pagadoras }) } : {}),
  });
  caja.style.display = "block";
}
