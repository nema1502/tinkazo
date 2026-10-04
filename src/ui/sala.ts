import { esc } from "../dom";
import { t } from "../i18n";
import { listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/drand";
import { previewUrl } from "../protocol/proof";
import { repetidos } from "../buscar";
import { parseNames } from "./participants";
import { qrDataUrl } from "./qr";

/**
 * La lista a la vista de la sala, antes de sellar.
 *
 * El sello impide cambiar la lista después, no armarla mal desde el
 * principio: alguien puede estar dos veces, o faltar. Esto la pone en el
 * proyector, numerada y con los repetidos marcados, y con un QR para que cada
 * uno se busque en su celular. Abajo va el principio de la huella: cuando se
 * selle, la huella del sorteo tiene que empezar igual, y cualquiera de la sala
 * lo puede comparar con lo que vio.
 */
export async function mostrarLista(): Promise<void> {
  const names = parseNames();
  if (names.length < 2) return;
  const prize = (document.getElementById("prize") as HTMLInputElement | null)?.value.trim() ?? "";
  const hash = bytesToHex(listHash(names));
  const rep = repetidos(names);

  const back = document.createElement("div");
  back.className = "sala";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", t("salaT"));
  back.innerHTML =
    `<div class="sala-top">` +
    `<div><span class="sticker">${esc(t("salaT"))}</span>` +
    `<h2>${esc(t("salaN").replace("{n}", String(names.length)))}</h2>` +
    `<p class="sala-huella mono">${esc(t("salaHuella"))} <b>${esc(hash.slice(0, 12))}</b>…</p></div>` +
    `<button class="ghost" type="button" data-cerrar>${esc(t("salaCerrar"))}</button>` +
    `</div>` +
    `<div class="sala-body">` +
    `<ol class="sala-nombres${names.length > 60 ? " densa" : ""}">` +
    names
      .map((n, i) => `<li${rep.has(i) ? ' class="rep"' : ""}>${esc(n)}${rep.has(i) ? ` <em>${esc(t("salaRep"))}</em>` : ""}</li>`)
      .join("") +
    `</ol>` +
    `<aside class="sala-qr"><img alt="" /><p>${esc(t("salaQr"))}</p>` +
    `<button class="ghost mini" type="button" data-copiar>${esc(t("salaCopiar"))}</button></aside>` +
    `</div>` +
    `<p class="sala-pie">${esc(t("salaPie"))}</p>`;
  document.body.appendChild(back);

  const cerrar = (): void => {
    back.remove();
    removeEventListener("keydown", tecla);
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  addEventListener("keydown", tecla);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", cerrar);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.focus();

  // El QR lleva la misma lista al celular de cada uno, para buscarse.
  const url = await previewUrl(names, prize);
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
  const png = await qrDataUrl(url);
  if (img && png) img.src = png;
  else back.querySelector(".sala-qr")?.remove();
}
