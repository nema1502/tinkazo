import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { enlaceDePago, memoDePlan } from "../../workers/cuenta/src/reglas";
import { network, txUrl } from "../stellar/config";
import { activarPlan } from "../stellar/cuenta-api";
import { planDelEquipo, urlDeCuenta } from "../stellar/cuenta-config";
import { botonPrincipal, abrirDialogo, copiar, lineaDeEstado } from "./dialogo";
import { con, fechaLarga } from "./monedas-vista";
import { pintarQr } from "./qr";

/**
 * El plan del equipo: 5 USDC, 30 días, 50 monedas de regalo. Detrás de `VITE_PLAN_EQUIPO` (apagada por defecto).
 *
 * No se paga desde Tinkazo: no se firma nada acá. La pantalla muestra a qué cuenta pagar, cuánto y con qué nota (la
 * nota liga el pago a la cuenta de Tinkazo de quien compra, aunque pague desde Meru u otra billetera), con un QR de
 * pago de Stellar (SEP-7) y el texto para copiar. "Ya pagué" le pide al Worker de la cuenta que lo active: el Worker
 * mira el pago en la red por su cuenta, y activa el plan una sola vez por pago (`workers/cuenta`).
 *
 * Lo que dice el texto público es lo que hace el código hoy: el plan queda anotado en la cuenta por 30 días, regala 50
 * monedas y sube el cupo del portero a 50 sellos por mes (`workers/patrocinio` lo averigua en `workers/cuenta`; el
 * panel muestra "te quedan N" con ese cupo). El logo ya se puede poner gratis, y el nombre del equipo en el show figura
 * como "próximamente": no se promete lo que el código no hace.
 */

export function abrirPlan(o: { address: string; vence?: number | null; onActivo?: () => void }): void {
  const config = planDelEquipo();
  const base = urlDeCuenta();
  if (!config || !base) return;
  const nota = memoDePlan(o.address);
  const enlace = enlaceDePago({ destino: config.cuenta, cuenta: o.address, red: network.name });
  const texto = con(t("planTexto"), { cuenta: config.cuenta, nota });
  const d = abrirDialogo({ titulo: t("planTitle") });

  d.cuerpo.innerHTML =
    `<p class="saldo-lead"><b>${esc(t("planLead"))}</b></p>` +
    `<section class="acct-sec" aria-labelledby="plan-inc-h"><h3 class="kicker" id="plan-inc-h">${esc(t("planIncluye"))}</h3>` +
    `<ul class="plan-lista"><li>${esc(t("planI1"))}</li><li>${esc(t("planISorteos"))}</li><li>${esc(t("planI2"))}</li><li>${esc(t("planI3"))}</li></ul>` +
    `<p class="note">${esc(t("planPronto"))}</p></section>` +
    `<section class="acct-sec" aria-labelledby="plan-paga-h"><h3 class="kicker" id="plan-paga-h">${esc(t("planPaga"))}</h3>` +
    `<p class="kicker plan-et">${esc(t("planCuenta"))}</p><code class="saldo-dir" data-plan="cuenta">${esc(config.cuenta)}</code>` +
    `<p class="kicker plan-et">${esc(t("planNota"))}</p><code class="saldo-dir" data-plan="nota">${esc(nota)}</code>` +
    `<p><b>${esc(t("planMonto"))}</b></p>` +
    `<div class="acct-more"><button type="button" class="mini" data-plan="copiar">${esc(t("planCopiarTodo"))}</button></div>` +
    `<img class="saldo-qr" data-plan="qr" alt="${esc(t("planQrAlt"))}" width="176" height="176">` +
    `<p class="note">${esc(t("planQr"))}</p><p class="note">${esc(t("planNotaAyuda"))}</p></section>`;

  const copiarBtn = d.cuerpo.querySelector<HTMLButtonElement>('[data-plan="copiar"]');
  copiarBtn?.addEventListener("click", () => void copiar(copiarBtn, texto, t("planCopiarTodo")));
  const qr = d.cuerpo.querySelector<HTMLImageElement>('[data-plan="qr"]');
  if (qr) void pintarQr(qr, enlace, 176).then((ok) => ok || qr.remove());

  const estado = lineaDeEstado();
  const ya = botonPrincipal(t("planYaPague"));
  d.pie.append(estado, ya);
  const idioma = getLang();
  const activo = (vence: number, tx?: string, monedas = 0): void => {
    estado.classList.add("ok");
    estado.replaceChildren(document.createTextNode([con(t("planActivo"), { fecha: fechaLarga(vence, idioma) }), monedas > 0 ? con(t("planGracias"), { n: monedas }) : ""].filter(Boolean).join(" ")));
    if (tx) {
      const a = document.createElement("a");
      a.href = txUrl(tx);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = ` ${t("planVerPago")} ↗`;
      estado.appendChild(a);
    }
    ya.textContent = t("acctClose");
    ya.dataset.listo = "1";
  };
  if (o.vence && o.vence > Date.now()) estado.textContent = con(t("planActivo"), { fecha: fechaLarga(o.vence, idioma) });

  ya.addEventListener("click", () => {
    if (ya.dataset.listo === "1") {
      d.cerrar();
      return;
    }
    ya.disabled = true;
    estado.classList.remove("ok");
    estado.textContent = t("planBuscando");
    void activarPlan(base, o.address).then((r) => {
      ya.disabled = false;
      if (r === "apagado") estado.textContent = t("planApagado");
      else if (!r) estado.textContent = t("planError");
      else if (r.activado && r.plan) {
        activo(r.plan.vence, r.plan.tx, r.monedas ?? 0);
        o.onActivo?.();
      } else if (r.motivo === "ya" && r.plan) activo(r.plan.vence, r.plan.tx);
      else estado.textContent = t(r.motivo === "ya" ? "planYa" : "planSinPago");
    });
  });
}
