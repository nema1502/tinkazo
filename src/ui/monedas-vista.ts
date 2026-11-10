import { REGLAS, type VistaDeCuenta } from "../../workers/cuenta/src/reglas";
import { esc } from "../dom";

/**
 * Lo que el panel de la cuenta muestra de las monedas, la tiendita y el plan del equipo, como texto HTML (el panel
 * lo arma con `innerHTML`). Sin DOM y con los textos que se le pasan (`tx`): se prueba sin navegador
 * (`monedas-vista.test.ts`). Todo lo que viene del Worker se escapa.
 *
 * Las reglas que se dicen acá son las del Worker (`REGLAS`): un número cambia en un solo lugar.
 */

export type EstadoDeCuenta = VistaDeCuenta | "cargando" | "error";
export type Tx = (clave: string) => string;

/** Rellena `{n}`, `{max}`… del texto. */
export function con(texto: string, valores: Record<string, string | number>): string {
  return Object.entries(valores).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), texto);
}

/** `12 de noviembre de 2026` / `November 12, 2026`. */
export function fechaLarga(ms: number, idioma: string): string {
  return new Date(ms).toLocaleDateString(idioma === "es" ? "es-BO" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "America/La_Paz" });
}

const REGLAS_A_MOSTRAR = [
  { tipo: "primer_sorteo", clave: "monReglaPrimerSorteo" },
  { tipo: "primera_carga", clave: "monReglaPrimeraCarga" },
  { tipo: "plan", clave: "monReglaPlan" },
  { tipo: "comprobar", clave: "monReglaComprobar" },
  { tipo: "invitar", clave: "monReglaInvitar" },
] as const;

/** "Tus monedas": el saldo, qué suma monedas y las reglas de siempre. */
export function monedasHtml(v: EstadoDeCuenta, tx: Tx): string {
  const cabeza = `<section class="acct-sec" aria-labelledby="acct-mon-h"><h3 class="kicker" id="acct-mon-h">${esc(tx("monTitle"))}</h3>`;
  if (v === "cargando") return `${cabeza}<p class="acct-empty" aria-busy="true">${esc(tx("monCargando"))}</p></section>`;
  if (v === "error") return `${cabeza}<p class="acct-empty">${esc(tx("monNoLeer"))}</p>${reglasDeSiempre(tx)}</section>`;
  const filas = REGLAS_A_MOSTRAR.map(({ tipo, clave }) => {
    const r = REGLAS[tipo];
    const hecha = (v.hechos[tipo] ?? 0) >= r.max;
    const texto = con(tx(clave), { n: r.monedas, max: r.max });
    return `<li class="mon-regla${hecha ? " hecha" : ""}">${hecha ? `<span aria-hidden="true">✓ </span><span class="sr-only">${esc(tx("monHecha"))}: </span>` : ""}${esc(texto)}</li>`;
  }).join("");
  return (
    `${cabeza}<p class="mon-saldo"><b>${esc(con(tx("monSaldo"), { n: v.saldo }))}</b></p>` +
    `<h4 class="mon-sub">${esc(tx("monQueSuma"))}</h4><ul class="mon-reglas">${filas}</ul>${reglasDeSiempre(tx)}</section>`
  );
}

const reglasDeSiempre = (tx: Tx): string => `<p class="note mon-nota">${esc(tx("monNoCambia"))}</p><p class="note mon-nota">${esc(tx("monReglas"))}</p>`;

/** "Tu tiendita": qué se puede canjear y qué falta para cada cosa, el código para el stand y lo ya canjeado. */
export function tienditaHtml(v: EstadoDeCuenta, o: { idioma: string; qr: boolean }, tx: Tx): string {
  if (v === "cargando" || v === "error") return "";
  const es = o.idioma === "es";
  const items = v.catalogo
    .map((c) => {
      const falta = c.costo - v.saldo;
      const estado = falta > 0 ? con(tx("tiendaFalta"), { n: falta }) : tx("tiendaAlcanza");
      return `<li class="tienda-item${falta > 0 ? "" : " alcanza"}"><span>${esc(con(tx("tiendaItem"), { nombre: es ? c.es : c.en, costo: c.costo }))}</span><span class="tienda-estado">${esc(estado)}</span></li>`;
    })
    .join("");
  const nombreDe = (codigo: string): string => {
    const c = v.catalogo.find((x) => x.codigo === codigo);
    return c ? (es ? c.es : c.en) : codigo;
  };
  const hechos = v.canjes
    .slice(0, 5)
    .map((c) => `<li class="tienda-item"><span>${esc(nombreDe(c.codigo))}</span><span class="tienda-estado">${esc(fechaLarga(c.ms, o.idioma))}</span></li>`)
    .join("");
  return (
    `<section class="acct-sec" aria-labelledby="acct-tienda-h"><h3 class="kicker" id="acct-tienda-h">${esc(tx("tiendaTitle"))}</h3>` +
    `<p class="acct-empty">${esc(tx("tiendaLead"))}</p><ul class="tienda-lista">${items}</ul>` +
    `<div class="acct-more"><button type="button" class="mini" data-k="tienda-qr" aria-expanded="${o.qr}">${esc(tx(o.qr ? "tiendaOcultar" : "tiendaMostrar"))}</button>` +
    `<button type="button" class="mini" data-k="canjear">${esc(tx("canjeLink"))}</button></div>` +
    (o.qr ? `<img class="tienda-qr" alt="${esc(tx("tiendaQrAlt"))}" width="176" height="176">` : "") +
    (hechos ? `<h4 class="mon-sub">${esc(tx("tiendaCanjes"))}</h4><ul class="tienda-lista">${hechos}</ul>` : "") +
    `</section>`
  );
}

/**
 * El plan del equipo en el panel: cuándo vence y cuántos sorteos propios lleva (si se pudieron contar), o el botón
 * para comprarlo. Sin plan y sin compra prendida, no sale nada.
 */
export function planHtml(v: EstadoDeCuenta, o: { idioma: string; sePuedeComprar: boolean; sorteos: number | null }, tx: Tx): string {
  if (v === "cargando" || v === "error") return "";
  if (!v.plan && !o.sePuedeComprar) return "";
  const cabeza = `<section class="acct-sec" aria-labelledby="acct-plan-h"><h3 class="kicker" id="acct-plan-h">${esc(tx("planTitle"))}</h3>`;
  const activo = v.plan
    ? `<p class="plan-vence"><b>${esc(con(tx("planVence"), { fecha: fechaLarga(v.plan.vence, o.idioma) }))}</b></p>` +
      (o.sorteos === null ? "" : `<p class="acct-empty">${esc(con(tx("planSorteos"), { n: o.sorteos }))}</p>`)
    : "";
  const boton = o.sePuedeComprar
    ? `<div class="acct-more"><button type="button" class="mini" data-k="plan">${esc(tx(v.plan ? "planRenovar" : "planBtn"))}</button></div>`
    : "";
  return `${cabeza}${activo}${boton}</section>`;
}

/** "Cargá tu saldo": el botón, y el aviso de que llegaron los primeros dólares si ya se supo. */
export function saldoHtml(o: { aviso: string }, tx: Tx): string {
  return (
    `<section class="acct-sec">` +
    (o.aviso ? `<p class="saldo-aviso" role="status"><b>${esc(o.aviso)}</b></p>` : "") +
    `<div class="acct-more"><button type="button" class="mini" data-k="saldo">${esc(tx("saldoBtn"))}</button></div></section>`
  );
}
