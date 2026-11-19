/**
 * Cancelar en la portada mientras se termina de entrar con Google (16 de noviembre de 2026).
 *
 * Con la ventana de Google ya cerrada, una cuenta nueva puede tardar hasta 50 segundos en quedar lista, y el botón grande
 * dice Terminando de entrar. La puerta de la herramienta ofrece Cancelar, pero en la portada no se ve: la persona no
 * tenía otra salida que recargar. Debajo de cada botón grande que entra va un Cancelar con forma de enlace. Arriba ocupa
 * el renglón de Otras formas de entrar, que mientras tanto no se ofrece, así la portada no cambia de alto y la cabecera
 * no se toca. Al final de la portada va en un renglón propio. El botón del final de la demo no lleva: no entra ahí mismo,
 * lleva a la herramienta.
 */

/** Lo que agrega esta pieza, para sacarlo después sin tocar lo demás. */
const MARCA = "data-cancelar-entrada";

/** Lo que hace Cancelar: lo último que se pintó (`cancelarLaEntrada` de wallet-ui.ts). */
let alCancelar: () => void = () => undefined;

export interface CancelarEnPortada {
  /** La ventana de Google ya se cerró y la cuenta se está creando o abriendo. */
  terminando: boolean;
  cancelar: () => void;
  tx: (clave: string) => string;
}

/** Pone o saca Cancelar debajo de los botones grandes de la portada. Se llama cada vez que cambia la cuenta (main.ts). */
export function pintarCancelarEnPortada(raiz: ParentNode, o: CancelarEnPortada): void {
  alCancelar = o.cancelar;
  for (const ctas of raiz.querySelectorAll<HTMLElement>(".hero-ctas")) {
    // Solo los botones que entran ahí mismo (`entrar` en main.ts), no el del final de la demo, que navega.
    const cta = ctas.querySelector<HTMLElement>('a[data-cta-entrar][href="#sortear"]');
    if (!cta) continue;
    const doc = ctas.ownerDocument;
    const siguiente = ctas.nextElementSibling;
    let renglon = siguiente instanceof HTMLElement && siguiente.matches("p.hero-otras") ? siguiente : null;
    const otras = renglon?.querySelector<HTMLElement>("[data-otras-formas]") ?? null;
    let boton = renglon?.querySelector<HTMLButtonElement>(`button[${MARCA}]`) ?? null;

    if (!o.terminando) {
      if (!boton) continue;
      const teniaElFoco = doc.activeElement === boton;
      if (renglon?.hasAttribute(MARCA)) renglon.remove();
      else boton.remove();
      if (otras?.dataset.ocultoAlCancelar) {
        otras.style.removeProperty("display");
        delete otras.dataset.ocultoAlCancelar;
      }
      if (teniaElFoco) cta.focus({ preventScroll: true });
      continue;
    }

    if (!boton) {
      if (!renglon) {
        renglon = doc.createElement("p");
        renglon.className = "hero-otras";
        renglon.setAttribute(MARCA, "");
        ctas.after(renglon);
      }
      // Otras formas de entrar no se ofrece mientras se está entrando: su lugar es de Cancelar. Si ya estaba escondido
      // por otra cosa, no se toca.
      if (otras && otras.style.display !== "none") {
        otras.style.display = "none";
        otras.dataset.ocultoAlCancelar = "1";
      }
      boton = doc.createElement("button");
      boton.type = "button";
      // El enlace de la portada (`.enlace`), el mismo de Otras formas de entrar, con su color sobre el morado del final.
      boton.className = "enlace";
      boton.setAttribute(MARCA, "");
      // Con su clave, la página lo traduce con todo lo demás al cambiar de idioma.
      boton.dataset.i = "cancel";
      boton.addEventListener("click", () => alCancelar());
      renglon.append(boton);
      // Desde el teclado el foco estaba en el botón grande: pasa a Cancelar. En el celular el toque no deja foco y no se mueve.
      if (doc.activeElement === cta) boton.focus({ preventScroll: true });
    }
    boton.textContent = o.tx("cancel");
  }
}
