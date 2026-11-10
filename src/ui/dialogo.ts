import { esc } from "../dom";
import { t } from "../i18n";

/**
 * La ventana de las pantallas nuevas de la cuenta (cargar saldo, plan del equipo, canjear): la misma forma que el
 * panel de la cuenta (encabezado y pie fijos, cuerpo que se recorre), un diálogo de verdad que atrapa el foco, se
 * cierra con Escape y devuelve el foco a quien la abrió. El pie lleva la acción principal: siempre a la vista.
 */

export interface Dialogo {
  card: HTMLElement;
  cuerpo: HTMLElement;
  /** El pie: el mensaje de estado y la acción principal. */
  pie: HTMLElement;
  cerrar(): void;
}

const CLOSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

let n = 0;

export function abrirDialogo(o: { titulo: string; onCerrar?: () => void }): Dialogo {
  const id = `dlg-${++n}`;
  const volverA = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const back = document.createElement("div");
  back.className = "modal-back acct-back";
  const card = document.createElement("div");
  card.className = "modal-card acct-card dlg-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", id);
  card.tabIndex = -1;
  card.innerHTML =
    `<div class="acct-head"><h2 class="dlg-h" id="${id}">${esc(o.titulo)}</h2>` +
    `<button type="button" class="acct-x" data-dlg="x" aria-label="${esc(t("acctClose"))}">${CLOSE}</button></div>` +
    `<div class="acct-body dlg-cuerpo"></div><div class="dlg-pie"></div>`;
  back.appendChild(card);
  const cuerpo = card.querySelector<HTMLElement>(".dlg-cuerpo") as HTMLElement;
  const pie = card.querySelector<HTMLElement>(".dlg-pie") as HTMLElement;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      card.focus({ preventScroll: true });
      return;
    }
    const on = document.activeElement;
    if (!(on instanceof Node) || !card.contains(on)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && (on === first || on === card)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && on === last) {
      e.preventDefault();
      first.focus();
    }
  };

  let abierto = true;
  function cerrar(): void {
    if (!abierto) return;
    abierto = false;
    document.removeEventListener("keydown", onKey, true);
    back.remove();
    o.onCerrar?.();
    if (volverA?.isConnected) volverA.focus({ preventScroll: true });
  }
  back.addEventListener("click", (e) => {
    if (e.target === back) cerrar();
  });
  card.querySelector('[data-dlg="x"]')?.addEventListener("click", cerrar);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(back);
  card.focus({ preventScroll: true });
  return { card, cuerpo, pie, cerrar };
}

/** Copia `texto` y lo dice en el botón un momento ("Copiado ✓"). Sin permiso del navegador, deja el texto elegido si puede. */
export async function copiar(boton: HTMLElement, texto: string, original = boton.textContent ?? ""): Promise<boolean> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(texto);
    ok = true;
  } catch {
    ok = false;
  }
  if (ok) {
    boton.textContent = t("acctCopied");
    setTimeout(() => {
      if (boton.isConnected) boton.textContent = original;
    }, 2200);
  }
  return ok;
}

/** Una línea de estado que los lectores de pantalla oyen con calma. */
export function lineaDeEstado(): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "dlg-estado";
  p.setAttribute("role", "status");
  p.setAttribute("aria-live", "polite");
  return p;
}

/** El botón principal del pie. */
export function botonPrincipal(texto: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dlg-main";
  b.textContent = texto;
  return b;
}
