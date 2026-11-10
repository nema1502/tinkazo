import { esc } from "../dom";
import { t } from "../i18n";
import { contextoHorizon, revisarCarga } from "../stellar/carga";
import { modoDeRampa, urlDeCuenta } from "../stellar/cuenta-config";
import { cotizarCarga } from "../stellar/rampa-pollar";
import { botonPrincipal, abrirDialogo, copiar, lineaDeEstado } from "./dialogo";
import { con } from "./monedas-vista";
import { pintarQr } from "./qr";

/**
 * "Cargá tu saldo": cómo pasar bolivianos a dólares digitales en la cuenta de Stellar de la persona.
 *
 * Con `VITE_RAMPA=meru` (lo que anda hoy) es una guía de cuatro pasos para hacerlo con la app de Meru: el QR de
 * Bolivia no cuesta, y Meru cobra 1 % más 1 dólar al mandar los dólares por Stellar. La dirección de la cuenta se
 * muestra grande, con copiar y un QR. Con `VITE_RAMPA=pollar` se suma arriba el precio de cargar desde acá
 * (`rampa-pollar.ts`); cargar sin salir de Tinkazo todavía no está listo y lo dice, y la guía de Meru sigue debajo.
 *
 * Tinkazo no cobra ni guarda nada: el dinero es de la persona y queda en su cuenta. "Ya cargué" mira por Horizon si
 * llegó un pago de USDC de 1 o más; si llegó, avisa y pide las monedas de regalo (`carga.ts`).
 */

const MERU = "https://getmeru.com";

export function abrirSaldo(o: { address: string }): void {
  const modo = modoDeRampa();
  if (modo === "apagada") return;
  const d = abrirDialogo({ titulo: t("saldoTitle") });
  const pasos = (["saldoP1", "saldoP2", "saldoP3", "saldoP4"] as const).map((k) => `<li>${esc(t(k))}</li>`).join("");

  d.cuerpo.innerHTML =
    `<p class="saldo-lead">${esc(t("saldoLead"))}</p>` +
    (modo === "pollar" ? pollarHtml() : "") +
    `<section class="acct-sec" aria-labelledby="saldo-pasos-h"><h3 class="kicker" id="saldo-pasos-h">${esc(t("saldoPasos"))}</h3>` +
    `<ol class="saldo-pasos">${pasos}</ol>` +
    `<div class="acct-more"><a class="mini" href="${MERU}" target="_blank" rel="noopener">${esc(t("saldoMeru"))} ↗</a></div>` +
    `<p class="note saldo-nota">${esc(t("saldoCosto"))}</p><p class="note saldo-nota">${esc(t("saldoMinimo"))}</p></section>` +
    `<section class="acct-sec" aria-labelledby="saldo-dir-h"><h3 class="kicker" id="saldo-dir-h">${esc(t("saldoDir"))}</h3>` +
    `<code class="saldo-dir" data-saldo="dir">${esc(o.address)}</code>` +
    `<div class="acct-more"><button type="button" class="mini" data-saldo="copiar" aria-label="${esc(t("saldoCopiarAria"))}">${esc(t("acctCopy"))}</button></div>` +
    `<img class="saldo-qr" data-saldo="qr" alt="${esc(t("saldoQrAlt"))}" width="176" height="176">` +
    `<p class="note saldo-nota">${esc(t("saldoDirAyuda"))}</p></section>`;

  const copiarBtn = d.cuerpo.querySelector<HTMLButtonElement>('[data-saldo="copiar"]');
  copiarBtn?.addEventListener("click", () => void copiar(copiarBtn, o.address, t("acctCopy")));
  const qr = d.cuerpo.querySelector<HTMLImageElement>('[data-saldo="qr"]');
  if (qr) void pintarQr(qr, o.address, 176).then((ok) => ok || qr.remove());
  if (modo === "pollar") cablearPollar(d.cuerpo);

  // El pie: lo que pasó con "Ya cargué" y la acción principal, siempre a la vista.
  const estado = lineaDeEstado();
  const ya = botonPrincipal(t("saldoYaCargue"));
  d.pie.append(estado, ya);
  ya.addEventListener("click", () => {
    if (ya.dataset.listo === "1") {
      d.cerrar();
      return;
    }
    ya.disabled = true;
    estado.textContent = t("saldoMirando");
    void revisarCarga(o.address, { horizon: contextoHorizon(), base: urlDeCuenta() }).then((r) => {
      ya.disabled = false;
      if (r.estado === "llego") {
        estado.textContent = r.monedas > 0 ? `${t("saldoLlego")}. ${con(t("saldoLlegoMonedas"), { n: r.monedas })}` : t("saldoLlego");
        estado.classList.add("ok");
        ya.textContent = t("acctClose");
        ya.dataset.listo = "1";
      } else {
        estado.classList.remove("ok");
        estado.textContent = t(r.estado === "no-llego" ? "saldoNoLlego" : "saldoError");
      }
    });
  });
}

/** Cargar desde acá con Pollar: el precio sí, el pago todavía no (ver `rampa-pollar.ts`). */
function pollarHtml(): string {
  return (
    `<section class="acct-sec" aria-labelledby="saldo-pollar-h"><h3 class="kicker" id="saldo-pollar-h">${esc(t("saldoPollarTitle"))}</h3>` +
    `<label class="kicker" for="saldo-bs">${esc(t("saldoPollarBs"))}</label>` +
    `<input id="saldo-bs" class="saldo-bs" type="number" inputmode="decimal" min="1" step="1" value="200">` +
    `<div class="acct-more"><button type="button" class="mini" data-saldo="ver">${esc(t("saldoPollarVer"))}</button></div>` +
    `<p class="note" data-saldo="cotizacion" role="status" aria-live="polite"></p>` +
    `<div class="acct-more"><button type="button" class="mini" data-saldo="cargar" disabled>${esc(t("saldoPollarCargar"))}</button></div>` +
    `<p class="note">${esc(t("saldoPollarNoListo"))}</p></section>`
  );
}

function cablearPollar(cuerpo: HTMLElement): void {
  const ver = cuerpo.querySelector<HTMLButtonElement>('[data-saldo="ver"]');
  const linea = cuerpo.querySelector<HTMLElement>('[data-saldo="cotizacion"]');
  const campo = cuerpo.querySelector<HTMLInputElement>("#saldo-bs");
  if (!ver || !linea || !campo) return;
  ver.addEventListener("click", () => {
    ver.disabled = true;
    linea.textContent = "";
    void import("../stellar/wallet-pollar")
      .then(({ pollarWallet }) => cotizarCarga({ quoteRamp: (b) => pollarWallet.cotizarRampa(b) }, Number(campo.value)))
      .catch(() => ({ estado: "error" as const }))
      .then((c) => {
        ver.disabled = false;
        if (c.estado === "ok") {
          const monto = c.recibis === null ? null : new Intl.NumberFormat(document.documentElement.lang || "es", { maximumFractionDigits: 2 }).format(c.recibis);
          linea.textContent = [monto === null ? "" : con(t("saldoPollarRecibis"), { n: monto }), c.minutos === null ? "" : con(t("saldoPollarTarda"), { m: c.minutos })].filter(Boolean).join(" ");
        } else linea.textContent = t(c.estado === "sin-ruta" ? "saldoPollarSinRuta" : "saldoPollarError");
      });
  });
}
