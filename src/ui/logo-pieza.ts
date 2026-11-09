import "../logo.css";
import { texto as t } from "../idioma";
import { logoALienzo, type Logo } from "../logo";

/**
 * La pieza del logo, la misma en todas partes: una placa con el logo y su
 * borde, y al lado "Hecho con Tinkazo". El logo se dibuja en un `<canvas>`
 * (nunca por `innerHTML`): la imagen se valida antes (`validarLogo`) y queda
 * el primer cuadro, así que lo que llega de un enlace no ejecuta nada.
 *
 * Los dos temas se resuelven en la imagen, que ya viene aplanada sobre su
 * placa (`logo.ts`): no hace falta medir el contraste en cada juego.
 *
 * Los textos salen de `idioma.ts`: lo usa también la página de comprobar, que
 * no carga el diccionario entero. Las claves van entre comillas para que
 * `vite.config.ts` las incluya ("logoHecho", "logoAlt").
 */

export interface OpcionesPieza {
  /** Una clase más para el contenedor: `st-logo`, `logo-sala`… */
  clase?: string;
  /** Sin el "Hecho con Tinkazo" (la vista previa lo pone aparte). */
  sinHecho?: boolean;
}

/**
 * Crea la pieza. Sale vacía y se llena cuando el logo está decodificado; si no
 * se puede abrir, se quita sola: nunca queda un hueco ni un error. `alAbrir`
 * avisa cuando quedó lista (la vista en grande vuelve a medir).
 */
export function crearPieza(logo: Logo, op: OpcionesPieza = {}, alAbrir?: () => void): HTMLElement {
  const pieza = document.createElement("span");
  pieza.className = `logo-pieza${op.clase ? ` ${op.clase}` : ""}`;
  pieza.dataset.logoPieza = "";
  const placa = document.createElement("span");
  placa.className = "logo-placa";
  pieza.append(placa);
  if (!op.sinHecho) {
    const hecho = document.createElement("span");
    hecho.className = "logo-hecho";
    hecho.dataset.i = "logoHecho";
    hecho.textContent = t("logoHecho");
    pieza.append(hecho);
  }
  void logoALienzo(logo).then((fuente) => {
    if (!fuente) {
      pieza.remove();
      return;
    }
    // Un lienzo propio por pieza: el decodificado se comparte y un nodo solo puede estar en un lugar.
    const c = document.createElement("canvas");
    c.width = fuente.width;
    c.height = fuente.height;
    c.getContext("2d")?.drawImage(fuente, 0, 0);
    c.setAttribute("role", "img");
    c.dataset.iAria = "logoAlt";
    c.setAttribute("aria-label", t("logoAlt"));
    placa.append(c);
    pieza.dataset.listo = "1";
    alAbrir?.();
  });
  return pieza;
}
