import { esc } from "../dom";
import { t } from "../i18n";
import { listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/quicknet";
import { previewUrl } from "../protocol/proof";
import { repetidos } from "../buscar";
import { app } from "../state";
import { parseNames } from "./participants";
import { pintarQr } from "./qr";

/**
 * La lista a la vista de la sala, antes de sellar.
 *
 * El sello impide cambiar la lista después, no armarla mal desde el
 * principio: alguien puede estar dos veces, o faltar. Esto la pone en el
 * proyector, numerada y con los repetidos marcados, y con un QR para que cada
 * uno se busque en su celular. Abajo va el principio de la huella: cuando se
 * selle, la huella del sorteo tiene que empezar igual, y cualquiera de la sala
 * lo puede comparar con lo que vio.
 *
 * Con la lista ya sellada muestra la sellada, con su huella, y lo dice: la
 * espera sirve para que cada uno se busque. Hasta el 21 de octubre de 2026
 * leía el cuadro y decía siempre "antes de sellar", aunque el cuadro hubiera
 * cambiado después del sello (buscador de detalles, D01).
 */
/**
 * La letra de la lista, lo más grande que entre sin dejar a nadie afuera. Con
 * dieciocho nombres usaba medio proyector, y con sesenta, a 1280 × 720, se
 * veían cuarenta y dos (revisiones del 16 de octubre de 2026). Las columnas
 * se miden en em, así que crecen con la letra.
 */
function encajar(ol: HTMLElement): void {
  const entra = (): boolean => ol.scrollHeight <= ol.clientHeight + 1 && ol.scrollWidth <= ol.clientWidth + 1;
  let chico = 11;
  let grande = 46;
  while (grande - chico > 1) {
    const medio = Math.floor((chico + grande) / 2);
    ol.style.fontSize = `${medio}px`;
    if (entra()) chico = medio;
    else grande = medio;
  }
  ol.style.fontSize = `${chico}px`;
}

export async function mostrarLista(): Promise<void> {
  const sellada = app.frozen;
  const names = sellada ? sellada.names : parseNames();
  if (names.length < 2) return;
  const prize = sellada ? sellada.prize : ((document.getElementById("prize") as HTMLInputElement | null)?.value.trim() ?? "");
  const hash = sellada ? sellada.listHash : bytesToHex(listHash(names));
  const rep = repetidos(names);
  const titulo = t(sellada ? "salaTSellada" : "salaT");

  const back = document.createElement("div");
  back.className = "sala";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", titulo);
  back.innerHTML =
    `<div class="sala-top">` +
    `<div><span class="sticker">${esc(titulo)}</span>` +
    `<h2>${esc(t("salaN").replace("{n}", String(names.length)))}</h2>` +
    `<p class="sala-huella mono">${esc(t("salaHuella"))} <b>${esc(hash.slice(0, 12))}</b>…</p></div>` +
    `<button class="ghost" type="button" data-cerrar>${esc(t("salaCerrar"))}</button>` +
    `</div>` +
    `<div class="sala-body">` +
    `<ol class="sala-nombres">` +
    names
      .map((n, i) => `<li${rep.has(i) ? ' class="rep"' : ""}>${esc(n)}${rep.has(i) ? ` <em>${esc(t("salaRep"))}</em>` : ""}</li>`)
      .join("") +
    `</ol>` +
    `<aside class="sala-qr"><img alt="" /><p>${esc(t("salaQr"))}</p>` +
    `<button class="ghost mini" type="button" data-copiar>${esc(t("salaCopiar"))}</button></aside>` +
    `</div>` +
    `<p class="sala-pie">${esc(t(sellada ? "salaPieSellada" : "salaPie"))}</p>`;
  document.body.appendChild(back);
  const ol = back.querySelector<HTMLElement>(".sala-nombres");
  const ajustar = (): void => {
    if (ol) encajar(ol);
  };
  ajustar();
  addEventListener("resize", ajustar);

  const cerrar = (): void => {
    back.remove();
    removeEventListener("keydown", tecla);
    removeEventListener("resize", ajustar);
    // El foco vuelve al botón que la abrió, y no al cuerpo de la página.
    document.getElementById("btn-sala")?.focus({ preventScroll: true });
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  addEventListener("keydown", tecla);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", cerrar);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.focus();

  // El QR lleva la misma lista al celular de cada uno, para buscarse. La sellada
  // lo dice también allá: "antes de sellar" ya no es cierto (lista.ts).
  const enlace = new URL(await previewUrl(names, prize));
  if (sellada) enlace.searchParams.set("sellada", "1");
  const url = enlace.toString();
  // Para pegarlo en el grupo del evento, si alguien no puede escanear.
  const copiar = back.querySelector<HTMLButtonElement>("[data-copiar]");
  copiar?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(url).then(
      () => (copiar.textContent = t("salaCopiado")),
      () => window.prompt(t("salaCopiar"), url),
    );
  });
  back.dataset.url = url;
  const img = back.querySelector<HTMLImageElement>(".sala-qr img");
  const listo = img ? await pintarQr(img, url, Math.min(260, innerWidth * 0.2)) : false;
  if (!listo) back.querySelector(".sala-qr")?.remove();
  ajustar();
}
