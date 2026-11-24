import { roundTime } from "../protocol/quicknet";
import { app } from "../state";
import { sinGrabar } from "../ensayo-modo";
import { getLang, textos } from "../idioma";
import { network } from "../stellar/config";
import {
  activoDePagos,
  cuentasDescartadasDe,
  cuentasQuePagan,
  esDireccionG,
  pagosActivos,
} from "../stellar/pagos";
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

/**
 * La cuenta de quien ganó en un puesto, releída de la lista sellada en este momento (`app.frozen` y `app.drawn`): nunca de
 * lo que quedó pintado en la pantalla ni de un campo que se pueda editar. Es `null` si el sorteo que está en la página ya
 * no es el de `raffleId`, si el puesto no existe o si lo que dice la lista en ese puesto no es una cuenta de Stellar.
 */
export function destinoDeLaLista(raffleId: string, puesto: number): string | null {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || frozen.raffleId === undefined || String(frozen.raffleId) !== raffleId) return null;
  const indice = drawn.winners[puesto];
  if (indice === undefined) return null;
  const entrada = frozen.names[indice];
  return typeof entrada === "string" && esDireccionG(entrada) ? entrada : null;
}

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
  const desde = sorteoEn - 600;

  const destinoDe = (puesto: number): string | null => destinoDeLaLista(raffleId, puesto);
  montarGanadores(caja, {
    red: network.name,
    raffleId,
    premio: frozen.prize,
    activo,
    ganadores: drawn.winners.map((i, puesto) => ({ puesto, entrada: frozen.names[i] ?? "" })),
    sorteoEn,
    desde,
    pagadoras,
    lector,
    ...(sesion ? { pagar: pagarPremioEn({ red: network.name, raffleId, premio: frozen.prize, activo, pagadoras, desde, destinoDe }) } : {}),
  });
  // Un typo en la lista de cuentas que pagan no se paga solo: si la bandera está prendida y la
  // configuración trae algo que no es una dirección, se dice en el panel (montarGanadores rellena
  // la caja: el aviso va después, para que no lo borre). Avisa también cuando se descarta solo una de varias.
  if (cuentasDescartadasDe() > 0) {
    const ninguna = cuentasQuePagan().length === 0;
    const aviso = document.createElement("p");
    aviso.dataset.pagos = ninguna ? "sin-cuentas" : "cuentas-descartadas";
    aviso.textContent = textos(getLang())[ninguna ? "pgSinCuentas" : "pgCuentasDescartadas"] ?? "";
    caja.append(aviso);
  }
  caja.style.display = "block";
}
