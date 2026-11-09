import { esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { isTurnOrder } from "../modos/turnos";
import { salieronVariasVeces } from "../participaciones";
import { htmlDeTurnos } from "./lista-de-turnos";

/**
 * Los ganadores en la página del resultado (`#winner-cards`).
 *
 * Hasta seis, una tarjeta amarilla cada uno, con su cara, como siempre: es lo que se lee desde el fondo y lo que
 * recorren los auditores. Con más (el contrato admite hasta 300) las tarjetas no sirven: trescientas tarjetas de 130 px son una
 * página de 39.000 px, y la gente que busca su nombre no la recorre. Entonces el primero queda en su tarjeta grande (es
 * el primer premio, como en el cartel del juego) y los demás van en una lista numerada de renglones cortos, en columnas
 * donde hay lugar (el proyector) y de a uno en el celular, cada uno con su «No está» al lado.
 *
 * El HTML se arma acá, sin tocar el documento, para probarlo sin pantalla. También viven acá el botón de «No está», su
 * pregunta y el cambio de uno a otra; lo que pasa al confirmar (sortear de nuevo ese premio) lo hace quien llama (`draw.ts`).
 */

/** Hasta cuántos ganadores se muestran cada uno en su tarjeta. Con más, el primero en tarjeta y los demás en lista. */
export const MAX_TARJETAS = 6;

export interface DatosDeGanadores {
  names: readonly string[];
  winners: readonly number[];
  prize: string;
  /** Queda con quién volver a sortear: cada ganador ofrece «No está». */
  reemplazo: boolean;
  /** La cara de una persona (`avatar` de `state.ts`). */
  avatar: (nombre: string, px: number) => string;
  /** La lista se lee por persona (la bandera de los modos o `?modo=` a la vista): quien salió varias veces se avisa. */
  porPersona?: boolean;
}

/**
 * El botón «No está» de un ganador; describe a quién se refiere con su nombre (`wn-<k>`). En un renglón de la lista va el
 * corto («No está»): el de la tarjeta («¿No está? Sortear de nuevo») no entra al lado del nombre.
 */
export const botonAusente = (k: number, corto = false): string => {
  const clave = corto ? "ausenteBtnCorto" : "ausenteBtn";
  return `<button class="ausente-btn" type="button" data-ausente aria-describedby="wn-${k}" data-i="${clave}">${esc(t(clave))}</button>`;
};

const preguntaAusente = (): string =>
  `<p class="ausente-q" data-i="ausenteQ">${esc(t("ausenteQ"))}</p>` +
  `<button class="ausente-btn si" type="button" data-ausente-si data-i="ausenteSi">${esc(t("ausenteSi"))}</button>` +
  `<button class="ausente-btn" type="button" data-ausente-no data-i="ausenteNo">${esc(t("ausenteNo"))}</button>`;

/**
 * Un toque en «No está» (de una tarjeta o de un renglón): pide confirmación en el mismo lugar, porque un clic de más
 * frente a la sala no puede borrar al ganador de la pantalla. «Sí» llama a `alConfirmar` con el premio `k`; «Cancelar»
 * vuelve al botón, con el texto que le corresponde a su lugar.
 */
export function alTocarAusente(e: Event, alConfirmar: (k: number) => void): void {
  const b = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
  const caja = b?.closest<HTMLElement>(".ausente");
  if (!b || !caja) return;
  const k = Number(caja.dataset.k);
  if (b.dataset.ausenteSi !== undefined) {
    alConfirmar(k);
    return;
  }
  const preguntar = b.dataset.ausente !== undefined;
  caja.innerHTML = preguntar ? preguntaAusente() : botonAusente(k, caja.closest(".winner-fila") !== null);
  // El foco va a "Cancelar": con él en "Sí", dos Enter seguidos borraban al ganador.
  caja.querySelector<HTMLButtonElement>(preguntar ? "[data-ausente-no]" : "[data-ausente]")?.focus({ preventScroll: true });
}

/** ¿Alcanzan las tarjetas o van en lista? */
export const enLista = (cuantos: number): boolean => cuantos > MAX_TARJETAS;

function tarjeta(d: DatosDeGanadores, k: number): string {
  const name = d.names[d.winners[k] as number] ?? "";
  const varios = d.winners.length > 1;
  const tag = d.prize
    ? `<p class="winner-prize"><span data-i="winsPrize">${esc(t("winsPrize"))}</span> ${esc(d.prize)}${varios ? ` #${k + 1}` : ""}</p>`
    : varios
      ? `<p class="winner-prize">#${k + 1}</p>`
      : "";
  return `<div class="winner-card" style="transform: rotate(${k % 2 ? 1.5 : -1.5}deg)">
        <img src="${d.avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name" id="wn-${k}">${esc(name)}</p>
          ${tag}
          ${d.reemplazo ? `<div class="ausente" data-k="${k}">${botonAusente(k)}</div>` : ""}
        </div>
      </div>`;
}

/** Un renglón de la lista: su número, su nombre (con el id que lee `aria-describedby` del botón) y «No está». */
function fila(d: DatosDeGanadores, k: number): string {
  const name = d.names[d.winners[k] as number] ?? "";
  return `<li class="winner-fila" value="${k + 1}">
        <span class="winner-num" aria-hidden="true">#${k + 1}</span>
        <span class="winner-name" id="wn-${k}">${esc(name)}</span>
        ${d.reemplazo ? `<div class="ausente" data-k="${k}">${botonAusente(k, true)}</div>` : ""}
      </li>`;
}

/**
 * Las tarjetas, o la tarjeta del primero y debajo la lista de los demás. Los ids (`wn-<k>`) y los `data-k` son los de
 * siempre, con `k` desde cero en el orden de los premios: «No está» sortea de nuevo el premio `k`. Si el sorteo es un
 * orden de turnos (`isTurnOrder`), es la lista de turnos de `lista-de-turnos.ts`: «Turno 1 ... Turno N» desde el primero,
 * sin tarjeta grande, sin «Se lleva» y sin «No está».
 */
export function htmlDeGanadores(d: DatosDeGanadores): string {
  const n = d.winners.length;
  // Con más de ocho turnos, «Copiar el orden» va también arriba de la lista: el de abajo queda.
  if (isTurnOrder(d.names.length, n, d.prize))
    return htmlDeTurnos(d.names, d.winners, { avisar: true, sinSufijos: d.porPersona ?? true, copiarArriba: n > 8 });
  // Quien tiene varias participaciones puede salir más de una vez: abajo de los ganadores, con cuáles premios.
  const varias = salieronVariasVeces(d.names, d.winners, d.porPersona ?? true)
    .map((v) => `<p class="again-note">${esc(T[getLang()].salioVarias(v.nombre, v.veces, v.puestos))}</p>`)
    .join("");
  if (!enLista(n)) return d.winners.map((_, k) => tarjeta(d, k)).join(" ") + varias;
  const premio = d.prize ? `<p class="winner-prize winner-lista-premio"><span>${esc(t("winnersCadaUno"))}</span> ${esc(d.prize)}</p>` : "";
  return (
    tarjeta(d, 0) +
    `<h3 class="winner-lista-t" id="winner-lista-t">${esc(t("winnersOtros").replace("{n}", String(n - 1)))}</h3>${premio}` +
    `<ol class="winner-lista" aria-labelledby="winner-lista-t" start="2">${d.winners.map((_, k) => (k === 0 ? "" : fila(d, k))).join("")}</ol>` +
    varias
  );
}
