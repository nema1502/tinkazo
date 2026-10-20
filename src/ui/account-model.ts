import { getLang, t } from "../i18n";
import type { Entry } from "./history";

/**
 * Las decisiones del panel de la cuenta, sin DOM: qué se muestra del saldo,
 * cómo se lee cada sorteo y qué letra lleva la cara de quien no trae foto.
 * Vive aparte de `account.ts` para poder probarlo sin navegador.
 */

/** Cuántos sorteos muestra el panel; el resto queda detrás de "Ver todos". */
export const LAST_DRAWS = 4;

/**
 * Las cuentas cuya comisión cubre Tinkazo con Pollar: las que entran con Google
 * o con un correo. Su dueño no tiene por qué saber qué es un XLM ni cuántos
 * tiene, así que el panel no le muestra el saldo mientras no llegue a 1 ni le
 * ofrece el grifo de pruebas. La etiqueta sale de `PollarWallet.label`.
 *
 * Ojo: que la comisión de verdad la cubra Pollar depende de una regla en el
 * panel de Pollar (Wallets, Sponsorship) para el contrato del sorteo, o de
 * "Sponsor all contracts". Si esa regla no está, quien entra con Google y no
 * tiene un XLM no puede sellar, y el panel no se lo va a decir.
 */
export const feeCovered = (label: string): boolean => label === "Google" || label === "Email";

export interface MoneyLine {
  /** El saldo para la insignia, `"unknown"` si no se pudo leer, `null` si no se muestra. */
  balance: number | "unknown" | null;
  /** El botón de conseguir XLM de prueba. */
  fund: boolean;
}

/**
 * Qué muestra el panel de la plata.
 *
 * Google y correo: nada mientras haya menos de 1 XLM (también si no se pudo
 * leer), y nunca el grifo. Las demás (Freighter, la cuenta de prueba): el saldo
 * como siempre, y el grifo en testnet con menos de 20, salvo que esté apagado
 * (`grifo` es falso con `?grifo=0`, ver `stellar/grifo.ts`).
 */
export function moneyLine(label: string, raw: number, net: string, grifo = true): MoneyLine {
  // Un saldo que no es un número (la red contestó algo raro) es un saldo que no se pudo leer.
  const balance = Number.isFinite(raw) ? raw : -1;
  if (feeCovered(label)) return { balance: balance >= 1 ? balance : null, fund: false };
  return {
    balance: balance < 0 ? "unknown" : balance,
    fund: grifo && net === "testnet" && balance >= 0 && balance < 20,
  };
}

/** `10.000 XLM` o `10,000 XLM`, según el idioma, con hasta dos decimales. */
export function fmtBalance(n: number): string {
  return `${new Intl.NumberFormat(getLang() === "es" ? "es-BO" : "en-US", { maximumFractionDigits: 2 }).format(n)} XLM`;
}

/** `GDVZ…5ZLE`: una dirección sin ocupar media pantalla. */
export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** La letra de la cara cuando no hay foto: la primera del nombre, en mayúscula. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : "";
}

/** Cómo se llama la cuenta en la pantalla: la cuenta de prueba viene con el nombre escrito en español. */
export const kindText = (label: string): string => (label === "Cuenta de prueba" ? t("guestWallet") : label);

/** `17 oct`: el día y el mes, sin año, en el idioma de ahora. Vacío si no hay fecha. */
export function shortDate(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleDateString(getLang() === "es" ? "es-BO" : "en-US", { day: "numeric", month: "short" });
}

export interface DrawRow {
  /** El premio; sin premio, "Sorteo #3". */
  title: string;
  /** `27 personas · 17 oct`, y `· sin sortear` si solo se selló. */
  meta: string;
  /** El enlace del comprobante, si hay. */
  proof: string | null;
}

/** Una fila de "Tus sorteos". */
export function drawRow(e: Entry): DrawRow {
  const done = !!(e.winners?.length || e.winnerIdx?.length || e.drawTx);
  const title = e.prize?.trim() || (e.id ? `${t("histDraw")} #${e.id}` : t("histDraw"));
  const parts = [`${e.count} ${t("histPeople")}`, shortDate(e.sealedAt)];
  if (!done) parts.push(t("acctPending"));
  return { title, meta: parts.filter(Boolean).join(" · "), proof: e.proof || null };
}
