import { t } from "../i18n";
import { reparto } from "../modos/amigo";
import { amigoUrl } from "../protocol/proof";

/**
 * Los enlaces personales de un Amigo secreto y cómo se copian. Los usan el resultado (`draw.ts`, `pintarAmigo`) y Mis
 * sorteos (`history.ts`), que los vuelve a armar si la pestaña se cerró o se recargó mientras se mandaban.
 */

/**
 * El enlace de cada persona, por su posición en la lista sellada. El enlace k del reparto es el de quien salió en el
 * lugar k, o sea la persona `winners[k]`: indexar por la posición sellada hace que nadie que mire el mapa (o el DOM que
 * se arma con él) vea el orden sorteado.
 */
export function enlacesDelReparto(
  names: readonly string[],
  winners: readonly number[],
  round: number,
  prize: string,
): Map<number, Promise<string>> {
  return new Map(
    reparto(names, winners).map((a, k) => [winners[k] ?? -1, amigoUrl({ round, from: a.from, to: a.to, ...(prize ? { prize } : {}) })]),
  );
}

/**
 * Copia un texto en el mismo gesto del toque: Safari en el iPhone no deja escribir el portapapeles después de un `await`.
 * Sin permiso para el portapapeles, el texto queda en un cuadro debajo de `donde`, ya elegido, para copiarlo a mano: uno
 * solo por lugar, aunque se toque de nuevo. `alCopiar`, si se copió: Mis sorteos lo anota para que la fila siga en
 * Copiado aunque la lista se vuelva a pintar.
 */
export function copiarEnElGesto(texto: string, boton: HTMLButtonElement, donde: HTMLElement, rotulo: string, alCopiar?: () => void): void {
  const listo = (): void => {
    // Queda en «Copiado», con la clave puesta: el cambio de idioma lo sigue, y con 20 personas se sabe a quién ya se le mandó.
    boton.dataset.i = "copied";
    boton.textContent = t("copied");
    donde.classList.add("copiado");
    alCopiar?.();
  };
  const aMano = (): void => {
    let caja = donde.querySelector<HTMLTextAreaElement>("textarea.amigo-a-mano");
    if (!caja) {
      caja = document.createElement("textarea");
      caja.className = "turnos-texto amigo-a-mano";
      caja.readOnly = true;
      donde.appendChild(caja);
    }
    caja.value = texto;
    caja.setAttribute("aria-label", rotulo);
    caja.select();
  };
  try {
    void navigator.clipboard.writeText(texto).then(listo, aMano);
  } catch {
    aMano();
  }
}
