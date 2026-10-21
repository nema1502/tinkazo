import { esc } from "../dom";
import { t } from "../i18n";
import { app, avatar } from "../state";
import { pintarQr } from "./qr";

/**
 * El resultado en grande, para el proyector: quién salió, qué se lleva, y el
 * QR del comprobante para que la sala lo compruebe desde el celular. Sin el
 * resto de la página alrededor, en pantalla completa si el navegador deja.
 *
 * Es el momento en que la sala saca el celular: el QR tiene que leerse desde
 * el fondo, así que es lo segundo más grande después del nombre.
 *
 * La abre el botón "Mostrar en grande" y, desde el 21 de octubre de 2026, el
 * final del show cuando el sorteo arrancó desde la espera en grande (`draw.ts`):
 * ahí el enlace llega después (el comprobante se arma aparte) y el QR aparece
 * cuando está. `volverA` es lo que queda con el foco al cerrar: "Siguiente
 * premio", que es lo que sigue. Salir de la pantalla completa también la
 * cierra, como a la espera: Escape la suelta el navegador sin avisarle a la
 * página, y quedaba la vista en grande dentro de la ventana.
 */
export async function mostrarResultado(enlace: string | Promise<string>, volverA?: HTMLElement): Promise<void> {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || document.querySelector(".pantalla")) return;
  const premio = frozen.prize;
  const n = drawn.winners.length;
  const varios = n > 1;
  // Con varios, el premio va una vez arriba y cada tarjeta lleva su número:
  // repetido en cada una, partía los nombres y no entraban todos (revisiones
  // del 16 de octubre de 2026). Con más de cinco, en dos columnas.
  const muchos = n > 5;

  const back = document.createElement("div");
  back.className = `sala pantalla${varios ? " varios" : ""}${muchos ? " muchos" : ""}`;
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", t("pantallaT"));
  back.innerHTML =
    `<div class="sala-top"><span class="sticker">${esc(t("pantallaT"))}${varios && premio ? ` · ${esc(premio)}` : ""}</span>` +
    `<button class="ghost" type="button" data-cerrar>${esc(t("salaCerrar"))}</button></div>` +
    `<div class="pantalla-body">` +
    `<div class="pantalla-ganadores">` +
    drawn.winners
      .map((i, k) => {
        const nombre = frozen.names[i] ?? "";
        const pie = varios ? `#${k + 1}` : premio ? `${esc(t("winsPrize"))} ${esc(premio)}` : "";
        return (
          `<div class="pantalla-ganador"><img src="${avatar(nombre, 160)}" alt="" />` +
          `<div><p class="pantalla-nombre">${esc(nombre)}</p>${pie ? `<p class="pantalla-premio">${pie}</p>` : ""}</div></div>`
        );
      })
      .join("") +
    `</div>` +
    `<aside class="pantalla-qr"><img alt="" /><p>${esc(t("pantallaQr"))}</p><p class="mono">tinkazo.app</p></aside>` +
    `</div>` +
    `<p class="sala-pie">${esc(t(varios ? "imgPieVarios" : "pantallaPie"))}</p>`;
  document.body.appendChild(back);

  const ajustar = (): void => encajar(back, n);
  ajustar();
  // Al pasar a pantalla completa cambia el tamaño: se vuelve a medir.
  addEventListener("resize", ajustar);

  let cerrada = false;
  const cerrar = (): void => {
    if (cerrada) return;
    cerrada = true;
    back.remove();
    removeEventListener("keydown", tecla);
    removeEventListener("resize", ajustar);
    document.removeEventListener("fullscreenchange", pantalla);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    // A lo que sigue, a la vista si hacía falta; sin eso, al botón que la abrió.
    if (volverA && volverA.offsetParent !== null) volverA.focus();
    else document.getElementById("btn-grande")?.focus({ preventScroll: true });
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  let estuvo = !!document.fullscreenElement;
  const pantalla = (): void => {
    if (document.fullscreenElement) estuvo = true;
    else if (estuvo) cerrar();
  };
  addEventListener("keydown", tecla);
  document.addEventListener("fullscreenchange", pantalla);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", cerrar);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.focus();
  // Se pide con el clic todavía fresco: pasado ese momento, el navegador la niega.
  // Desde el show ya está puesta (la heredó de la espera) y no se pide.
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);

  // El comprobante se arma aparte después del sorteo: si todavía no está, el
  // cartel sale sin QR y no se queda esperando. Lo más grande que deje la
  // pantalla junto a los nombres: con cincuenta nombres el QR tiene más de
  // cien módulos por lado, y desde las sillas cada píxel cuenta.
  const img = back.querySelector<HTMLImageElement>(".pantalla-qr img");
  const celular = innerWidth <= 700;
  const lado = celular
    ? innerWidth * 0.7
    : muchos
      ? Math.min(innerHeight * 0.5, innerWidth * 0.28)
      : varios
        ? Math.min(innerHeight * 0.56, innerWidth * 0.32)
        : Math.min(innerHeight * 0.6, innerWidth * 0.36);
  const link = await Promise.resolve(enlace).catch(() => "");
  if (cerrada) return;
  const listo = link && img ? await pintarQr(img, link, lado) : false;
  if (!listo) back.querySelector(".pantalla-qr")?.remove();
  ajustar();
}

/**
 * La letra de los nombres: la más grande con la que entran todos sin partir
 * una palabra a la mitad y sin salirse de la pantalla. Con tamaños fijos, a
 * 1280 × 720 no entraban cuatro ganadores con nombres largos y un apellido
 * se partía en "Gutiérre/z" (revisión del 16 de octubre de 2026). En el
 * celular la pantalla se puede desplazar: ahí solo cuenta que entre a lo ancho.
 */
function encajar(back: HTMLElement, n: number): void {
  const caja = back.querySelector<HTMLElement>(".pantalla-ganadores");
  const cuerpo = back.querySelector<HTMLElement>(".pantalla-body");
  if (!caja || !cuerpo) return;
  const celular = innerWidth <= 700;
  const nombres = [...back.querySelectorAll<HTMLElement>(".pantalla-nombre")];
  const entra = (): boolean =>
    nombres.every((e) => e.scrollWidth <= e.clientWidth + 1) &&
    cuerpo.scrollWidth <= cuerpo.clientWidth + 1 &&
    (celular || cuerpo.scrollHeight <= cuerpo.clientHeight + 1);
  let chico = 14;
  let grande = n === 1 ? 132 : n <= 5 ? 84 : 52;
  caja.style.setProperty("--letra", `${grande}px`);
  if (entra()) return;
  while (grande - chico > 1) {
    const medio = Math.floor((chico + grande) / 2);
    caja.style.setProperty("--letra", `${medio}px`);
    if (entra()) chico = medio;
    else grande = medio;
  }
  caja.style.setProperty("--letra", `${chico}px`);
}
