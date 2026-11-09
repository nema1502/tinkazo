import { esc } from "../dom";
import { texto as t } from "../idioma";
import { isTurnOrder } from "../modos/turnos";
import { htmlDeTurnos } from "./lista-de-turnos";

/**
 * Lo que la página de verificación muestra en «Quién ganó» (`#v-winners`).
 *
 * Un sorteo común: una tarjeta por ganador, con su cara y «Se lleva: premio», como siempre.
 *
 * Un orden de turnos (`isTurnOrder`: ganan tantas personas como hay en la lista y el nombre empieza con «Turnos» o
 * «Turns»): la misma lista de turnos que la herramienta, `Turno 1 ... Turno N`. Con 300 personas una tarjeta por cada una
 * son decenas de miles de píxeles, y «Se lleva» no es lo que dice un orden. El comprobante no cambia de forma: el orden se
 * reconoce por la cantidad y el nombre que ya trae.
 *
 * Vive aparte, sin `state.ts` ni `i18n.ts` (la página de verificación no los carga): la cara de cada persona la pasa quien llama.
 * Para probar sin cargar toda la página.
 */
export function htmlDeLosGanadores(
  names: readonly string[],
  winners: readonly number[],
  premio: string,
  avatar: (nombre: string, px: number) => string,
): string {
  // Sin título: el encabezado de la página (`#v-result-t`) ya dice «El orden de los turnos».
  if (isTurnOrder(names.length, winners.length, premio)) return htmlDeTurnos(names, winners, { titulo: false });
  return winners
    .map((i) => {
      const name = names[i] ?? "";
      return `<div class="winner-card">
        <img src="${avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name">${esc(name)}</p>
          ${premio ? `<p class="winner-prize">${esc(t("winsPrize"))} ${esc(premio)}</p>` : ""}
        </div>
      </div>`;
    })
    .join(" ");
}
