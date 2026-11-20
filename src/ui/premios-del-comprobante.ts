import { esc } from "../dom";
import type { Revision } from "../protocol/verificacion";
import type { EstadoDelPremio, PremioDelSello } from "../stellar/premios";

/**
 * La sección de premios de un comprobante de campaña.
 *
 * Un sorteo con premio no sella en el contrato del sorteo: sella en su contrato de premios, que guarda el
 * depósito, las bases y la lista y sella adentro, en el sorteo oficial (`stellar/premios.ts`). Cuando el sello
 * se acepta por historial, esa promoción viene en la revisión (`Revision.premio`) y esta sección la muestra en
 * palabras: cuánto quedó depositado y en qué activo, la huella de las bases (las reglas) y la de la lista, y el
 * pago de cada premio con su puesto, su monto, su estado y a quién se le pagó. Y si ese ganador es el que se
 * rehízo acá: los dos tienen que dar el mismo índice de la lista.
 *
 * Es solo lo que dice el contrato, sin afirmar nada nuevo: el veredicto lo decide `verificacion.ts`. Un sorteo
 * sin premio no tiene promoción y la sección no existe: sus comprobaciones quedan exactamente como estaban.
 *
 * Sin DOM y sin i18n: devuelve el HTML que las páginas pintan tal cual, con sus textos en los dos idiomas, así
 * la página de verificación y la del evento muestran lo mismo.
 */

export type Idioma = "es" | "en";

/** Un renglón por premio: el puesto, el monto, el estado del pago y la cuenta que lo recibió. */
export interface FilaDelPremio {
  puesto: number;
  monto: string;
  estado: string;
  ganador: string;
  /** El ganador que dice el contrato es el que se rehízo acá (mismo índice y misma entrada de la lista). */
  coincide: boolean;
}

export interface VistaDeLosPremios {
  titulo: string;
  /** El depósito: la suma de los premios, en el activo depositado o `en especie`. */
  deposito: string;
  /** El activo: su código si es uno conocido, o la dirección abreviada. */
  activo: string;
  /** La huella de las bases (las reglas), abreviada. */
  bases: string;
  /** La huella de la lista sellada, abreviada. */
  lista: string;
  filas: FilaDelPremio[];
}

/** Los siete decimales de un activo de Stellar. */
const ESCALA = 10n ** 7n;

/** El código de los activos que se conocen por su contrato: el XLM de cada red y el USDC de Circle. */
const ACTIVOS: Record<string, string> = {
  // El XLM de testnet (el mismo en todo el ecosistema de pruebas).
  CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: "XLM",
  // El XLM de mainnet.
  CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA: "XLM",
  // El USDC de Circle en mainnet.
  CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75: "USDC",
};

/** El nombre del activo de un premio: su código si se conoce, o su dirección abreviada. */
export function activoDe(token: string): string {
  return ACTIVOS[token] ?? `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Un monto en unidades mínimas de un activo de Stellar, como se escribe: siete decimales, sin ceros de más,
 * con separador de miles y coma decimal en español. Es texto y no número: un i128 no entra en un `number`.
 */
export function montoEnTexto(unidades: string, idioma: Idioma): string {
  const n = BigInt(unidades);
  const negativo = n < 0n;
  const abs = negativo ? -n : n;
  const entero = (abs / ESCALA).toString().replace(/\B(?=(\d{3})+(?!\d))/g, idioma === "es" ? "." : ",");
  const resto = (abs % ESCALA).toString().padStart(7, "0").replace(/0+$/, "");
  const coma = idioma === "es" ? "," : ".";
  return `${negativo ? "-" : ""}${entero}${resto ? coma + resto : ""}`;
}

const TEXTOS = {
  es: {
    titulo: "Los premios de la campaña",
    kicker: "{n} premios",
    deposito: "El depósito",
    bases: "La huella de las bases",
    lista: "La huella de la lista",
    enEspecie: "en especie",
    premio: "Premio {n}",
    pagado: "Se le pagó al ganador",
    coincide: "es el ganador recomputado",
    noCoincide: "no coincide con el ganador recomputado",
  },
  en: {
    titulo: "The campaign prizes",
    kicker: "{n} prizes",
    deposito: "The deposit",
    bases: "The hash of the rules",
    lista: "The hash of the list",
    enEspecie: "in kind",
    premio: "Prize {n}",
    pagado: "Paid to the winner",
    coincide: "is the recomputed winner",
    noCoincide: "does not match the recomputed winner",
  },
} as const;

const ESTADOS: Record<Idioma, Record<EstadoDelPremio, string>> = {
  es: { Paid: "Pagado", Owed: "Reclamable", Held: "En depósito", Returned: "Devuelto" },
  en: { Paid: "Paid", Owed: "Claimable", Held: "Held", Returned: "Returned" },
};

/** Lo que necesita la sección de una revisión: la promoción y el resultado que se rehízo. */
export type DeLaRevision = Pick<Revision, "veredicto" | "premio" | "ganadores" | "nombres">;

/** Una huella, abreviada para la vista: los primeros y los últimos caracteres. */
const corta = (h: string): string => (h.length <= 24 ? h : `${h.slice(0, 12)}…${h.slice(-8)}`);

/** Una dirección, abreviada para la vista. */
const cortaDireccion = (d: string): string => (d.length <= 20 ? d : `${d.slice(0, 8)}…${d.slice(-7)}`);

/**
 * Los datos que muestra la sección, o `null` si este comprobante no es el de una campaña. Solo aparece con el
 * sello aceptado (verde o pendiente de registro): en un rojo no se muestra nada de la promoción.
 */
export function vistaDeLosPremios(r: DeLaRevision, idioma: Idioma): VistaDeLosPremios | null {
  const promocion = r.premio;
  if (!promocion || (r.veredicto !== "verde" && r.veredicto !== "pendiente")) return null;
  const t = TEXTOS[idioma];
  const activo = activoDe(promocion.token);
  const filas: FilaDelPremio[] = promocion.premios.map((p) => {
    const monto = `${montoEnTexto(p.amount, idioma)} ${activo}`;
    // El índice del contrato tiene que ser el ganador que salió de la selección, y esa entrada de la lista la
    // cuenta que el contrato dice que cobró.
    const indiceRecomputado = r.ganadores[p.position];
    const coincide = indiceRecomputado === p.index && r.nombres[p.index] === p.winner;
    return { puesto: p.position, monto, estado: ESTADOS[idioma][p.state], ganador: p.winner, coincide };
  });
  return {
    titulo: t.titulo,
    deposito: promocion.inKind ? `${montoEnTexto(promocion.deposito, idioma)} ${t.enEspecie}` : `${montoEnTexto(promocion.deposito, idioma)} ${activo}`,
    activo,
    bases: corta(promocion.rulesHash),
    lista: corta(promocion.listHash),
    filas,
  };
}

/**
 * El HTML de la sección, listo para meter en la página. Vacío si el comprobante no es de una campaña: ni un
 * marco vacío, ni una sección que no corresponda.
 */
export function htmlDeLosPremios(r: DeLaRevision, idioma: Idioma): string {
  const vista = vistaDeLosPremios(r, idioma);
  if (!vista) return "";
  const t = TEXTOS[idioma];
  const colon = (etiqueta: string, valor: string, estado = "ok"): string =>
    `<li class="check ${estado}"><b>${esc(etiqueta)}</b><span class="mono">${esc(valor)}</span></li>`;
  const filas = vista.filas.map((f) => {
    const como = `${f.estado} · ${cortaDireccion(f.ganador)} · ${f.coincide ? t.coincide : t.noCoincide}`;
    return colon(t.premio.replace("{n}", String(f.puesto + 1)) + ` · ${f.monto}`, como, f.coincide ? "ok" : "bad");
  });
  return (
    `<div class="premios-del-comprobante">` +
    `<div class="head"><h2>${esc(vista.titulo)}</h2><span class="kicker">${esc(t.kicker.replace("{n}", String(vista.filas.length)))}</span></div>` +
    `<div class="body">` +
    `<ul class="checks">${colon(t.deposito, vista.deposito)}${colon(t.bases, vista.bases)}${colon(t.lista, vista.lista)}</ul>` +
    `<ul class="checks">${filas.join("")}</ul>` +
    `</div></div>`
  );
}
