import { esc } from "../dom";
import { texto as t } from "../idioma";
import { turnOrder, turnOrderDisplayNames, turnOrderText } from "../modos/turnos";

/**
 * La lista de un orden de turnos: «Turno 1 ... Turno N» desde el primero, sin tarjeta grande, sin «Se lleva» y sin «No está»,
 * y el botón «Copiar el orden». La usan la página del resultado (`resultado-ganadores.ts`) y la de verificación
 * (`verify.ts`): es la misma lista, así que lo que se ve al sortear es lo que ve quien comprueba.
 *
 * Vive aparte y sin `i18n.ts` a propósito: la página de verificación no carga el diccionario entero, y todo lo que
 * importa estáticamente usa `idioma.ts` (`vite.config.ts`, «textos por página»). Las claves están escritas completas en
 * este archivo para que el plugin las encuentre.
 *
 * Los nombres salen de `turnOrder`, el mismo orden de los ganadores del sorteo: lo que se ve y lo que se copia son el mismo
 * arreglo, y nada lo reordena.
 */

export interface OpcionesDeTurnos {
  /** El título «El orden de los turnos» arriba de la lista. La verificación lo pone en su encabezado y no lo repite. */
  titulo?: boolean;
  /**
   * Un «Avisarle» al lado de cada persona, para mandarle su turno («Te tocó el turno 3 de 12»). Solo en la página del
   * resultado, que es de quien organiza. Nacen escondidos: quien arma el enlace (`draw.ts`, `setNotifyLinks`) los muestra
   * cuando el comprobante ya existe, porque el aviso lleva su enlace.
   */
  avisar?: boolean;
  /**
   * El resultado de un orden repartido muestra el nombre de la persona, sin el sufijo «(2/3)» de la línea sellada.
   * La lista sellada de la comprobación no lo pide: ahí cada línea se ve tal como se selló.
   */
  sinSufijos?: boolean;
  /**
   * Otro «Copiar el orden» arriba de la lista, además del de abajo: con un orden largo, quien ya encontró su
   * turno no tiene que bajar hasta el final para copiarlo. Solo lo pide el resultado; la comprobación no.
   */
  copiarArriba?: boolean;
}

/** El HTML de la lista de turnos. `names` es la lista sellada y `winners`, los índices del sorteo, en su orden. */
export function htmlDeTurnos(names: readonly string[], winners: readonly number[], op: OpcionesDeTurnos = {}): string {
  const orden = op.sinSufijos ? turnOrderDisplayNames(names, winners) : turnOrder(names, winners);
  const filas = orden
    .map(
      (name, k) => `<li class="winner-fila" value="${k + 1}">
        <span class="winner-num"><span data-i="turnsWord">${esc(t("turnsWord"))}</span> ${k + 1}</span>
        <span class="winner-name" id="wn-${k}">${esc(name)}</span>
        ${op.avisar ? `<a class="ghost mini turno-avisar" data-turno="${k}" aria-describedby="wn-${k}" target="_blank" rel="noopener" hidden data-i="turnsNotify">${esc(t("turnsNotify"))}</a>` : ""}
      </li>`,
    )
    .join("");
  const titulo = op.titulo === false ? "" : `<h3 class="winner-lista-t" id="winner-lista-t" data-i="turnsResultTitle">${esc(t("turnsResultTitle"))}</h3>`;
  const rotulo = op.titulo === false ? "" : ` aria-labelledby="winner-lista-t"`;
  const copiar = `<button class="ghost turnos-copiar" type="button" data-copiar-orden data-orden="${esc(turnOrderText(orden))}" data-i="turnsCopy">${esc(t("turnsCopy"))}</button>`;
  const copiarArriba = `<button class="ghost turnos-copiar turnos-copiar-arriba" type="button" data-copiar-orden data-orden="${esc(turnOrderText(orden))}" data-i="turnsCopy">${esc(t("turnsCopy"))}</button>`;
  return titulo + (op.copiarArriba ? copiarArriba : "") + `<ol class="winner-lista winner-turnos"${rotulo}>${filas}</ol>` + copiar;
}

/**
 * Un toque en «Copiar el orden»: deja «1. Ana, 2. Beto, ...» en el portapapeles. Devuelve si el toque era de ese botón.
 * Sin permiso para el portapapeles, el texto queda a la vista en un cuadro, ya elegido, para copiarlo a mano.
 */
export function alCopiarOrden(e: Event): boolean {
  const b = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-copiar-orden]");
  if (!b) return false;
  const texto = b.dataset.orden ?? "";
  void (async () => {
    try {
      await navigator.clipboard.writeText(texto);
      b.textContent = t("copied");
      setTimeout(() => {
        b.textContent = t("turnsCopy");
      }, 1600);
    } catch {
      if (b.nextElementSibling?.classList.contains("turnos-texto")) return;
      const caja = document.createElement("textarea");
      caja.className = "turnos-texto";
      caja.readOnly = true;
      caja.value = texto;
      caja.setAttribute("aria-label", t("turnsResultTitle"));
      b.after(caja);
      caja.select();
    }
  })();
  return true;
}
