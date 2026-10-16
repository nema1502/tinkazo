import { esc } from "../dom";
import { t } from "../i18n";
import { app, avatar } from "../state";
import { qrDataUrl } from "./qr";

/**
 * El resultado en grande, para el proyector: quién salió, qué se lleva, y el
 * QR del comprobante para que la sala lo compruebe desde el celular. Sin el
 * resto de la página alrededor, en pantalla completa si el navegador deja.
 *
 * Es el momento en que la sala saca el celular: el QR tiene que leerse desde
 * el fondo, así que es lo segundo más grande después del nombre.
 */
export async function mostrarResultado(enlace: string): Promise<void> {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || document.querySelector(".pantalla")) return;
  const premio = frozen.prize;
  const varios = drawn.winners.length > 1;

  const back = document.createElement("div");
  back.className = `sala pantalla${varios ? " varios" : ""}`;
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", t("pantallaT"));
  back.innerHTML =
    `<div class="sala-top"><span class="sticker">${esc(t("pantallaT"))}</span>` +
    `<button class="ghost" type="button" data-cerrar>${esc(t("salaCerrar"))}</button></div>` +
    `<div class="pantalla-body">` +
    `<div class="pantalla-ganadores">` +
    drawn.winners
      .map((i, k) => {
        const nombre = frozen.names[i] ?? "";
        const pie = premio
          ? `${esc(t("winsPrize"))} ${esc(premio)}${varios ? ` · #${k + 1}` : ""}`
          : varios
            ? `#${k + 1}`
            : "";
        return (
          `<div class="pantalla-ganador"><img src="${avatar(nombre, 160)}" alt="" />` +
          `<div><p class="pantalla-nombre">${esc(nombre)}</p>${pie ? `<p class="pantalla-premio">${pie}</p>` : ""}</div></div>`
        );
      })
      .join("") +
    `</div>` +
    `<aside class="pantalla-qr"><img alt="" /><p>${esc(t("pantallaQr"))}</p><p class="mono">tinkazo.app</p></aside>` +
    `</div>` +
    `<p class="sala-pie">${esc(t("pantallaPie"))}</p>`;
  document.body.appendChild(back);

  const cerrar = (): void => {
    back.remove();
    removeEventListener("keydown", tecla);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    document.getElementById("btn-grande")?.focus({ preventScroll: true });
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  addEventListener("keydown", tecla);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", cerrar);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.focus();
  // Se pide con el clic todavía fresco: pasado ese momento, el navegador la niega.
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);

  // El comprobante se arma aparte después del sorteo: si todavía no está, el
  // cartel sale sin QR y no se queda esperando.
  const img = back.querySelector<HTMLImageElement>(".pantalla-qr img");
  const png = enlace ? await qrDataUrl(enlace) : null;
  if (img && png) img.src = png;
  else back.querySelector(".pantalla-qr")?.remove();
}
