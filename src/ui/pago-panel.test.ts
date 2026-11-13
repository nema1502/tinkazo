// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pintarQr } = vi.hoisted(() => ({ pintarQr: vi.fn(async (_img: HTMLImageElement, _texto: string, _ancho?: number) => true) }));
vi.mock("./qr", () => ({ pintarQr }));

import { setLang, t } from "../i18n";
import { armarPanelDePago } from "./pago-panel";
import type { PanelDePago } from "./pago-vista";

/**
 * Los datos para pagar, en pantalla: a qué cuenta, cuánto y con qué nota, cada uno con «Copiar»; el QR del enlace de
 * pago y «Abrir en mi app de pagos». Todo sale del panel (que sale de la orden) tal cual: lo que se copia es exactamente
 * lo que mandó el servidor, y el sitio no arma ningún dato por su cuenta.
 */

const PANEL: PanelDePago = {
  correo: "a•••@gmail.com",
  destino: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  cuentaCorta: "GBRP…OX2H",
  usdc: "2.5",
  monto: "2,50",
  nota: "tk:o:ABCD2345",
  enlace: "web+stellar:pay?destination=GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H&amount=2.5",
  vence: Date.UTC(2026, 10, 14),
  detalles: [{ clave: "pagoParaCuenta", vars: { correo: "a•••@gmail.com" } }, { clave: "pagoSirve" }, { clave: "pagoDeMas" }],
};

let copiado: string[] = [];

beforeEach(() => {
  setLang("es");
  copiado = [];
  pintarQr.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async (x: string) => void copiado.push(x)) } });
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

const valor = (el: HTMLElement, dato: string): string => el.querySelector(`[data-dato="${dato}"]`)?.textContent ?? "";
const copiar = (el: HTMLElement, dato: string): HTMLButtonElement => el.querySelector(`[data-copiar="${dato}"]`) as HTMLButtonElement;

describe("el panel del pago", () => {
  it("la moneda como dato, el monto con su moneda, la nota y la cuenta corta, en ese orden y de la orden tal cual", () => {
    const el = armarPanelDePago(PANEL);
    expect([...el.querySelectorAll(".pago-dato .pago-et")].map((x) => x.textContent)).toEqual(["Moneda", t("pagoMonto"), t("compraNotaRotulo"), t("pagoCuenta")]);
    // La moneda, a la vista y sin Copiar: es la única pantalla que la nombra, porque con otra el dinero se pierde.
    expect(valor(el, "moneda")).toBe("USDC en Stellar");
    expect(copiar(el, "moneda")).toBeNull();
    expect(valor(el, "monto")).toBe("2,50 USDC");
    expect(valor(el, "nota")).toBe(PANEL.nota);
    // La cuenta va corta a la vista: nadie la tipea, se copia entera.
    expect(valor(el, "destino")).toBe("GBRP…OX2H");
  });

  it("la línea de ayuda es la de pagar desde tu app, sin la moneda: la moneda va como dato", () => {
    expect(t("compraAppLinea")).not.toMatch(/USDC|Stellar/);
  });

  it("el QR del enlace y Abrir en mi app de pagos van plegados: en el celular nadie escanea su propia pantalla", () => {
    const el = armarPanelDePago(PANEL);
    const mas = el.querySelector<HTMLDetailsElement>('details[data-pago="detalles"]') as HTMLDetailsElement;
    expect(mas.contains(el.querySelector("img.pago-qr"))).toBe(true);
    expect(mas.contains(el.querySelector("a[data-pago='app']"))).toBe(true);
  });

  it("con el cambio ofrecido, Estoy en Bolivia va primero, antes de los datos, y su toque lo atiende quien muestra el panel", () => {
    const alCambiar = vi.fn();
    const el = armarPanelDePago({ ...PANEL, cambio: { clave: "compraEstoy" } }, { alCambiar });
    const primero = el.firstElementChild as HTMLElement;
    expect(primero.dataset.pago).toBe("cambio");
    expect(primero.textContent).toBe(t("compraEstoy"));
    primero.click();
    expect(alCambiar).toHaveBeenCalledTimes(1);
    // Sin el cambio, o sin quien lo atienda, no hay enlace.
    expect(armarPanelDePago(PANEL, { alCambiar }).querySelector('[data-pago="cambio"]')).toBeNull();
    expect(armarPanelDePago({ ...PANEL, cambio: { clave: "compraEstoy" } }).querySelector('[data-pago="cambio"]')).toBeNull();
  });

  it("cada «Copiar» copia exactamente lo del servidor, y lo dice en el botón un momento", async () => {
    vi.useFakeTimers();
    const el = armarPanelDePago(PANEL);
    document.body.append(el);
    for (const [dato, esperado] of [
      ["destino", PANEL.destino],
      ["monto", "2.5"],
      ["nota", PANEL.nota],
    ] as const) {
      const b = copiar(el, dato);
      expect(b.textContent).toBe(t("pagoCopiar"));
      b.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(copiado.at(-1)).toBe(esperado);
      expect(b.textContent).toBe(t("pagoCopiado"));
      await vi.advanceTimersByTimeAsync(3000);
      expect(b.textContent).toBe(t("pagoCopiar"));
    }
  });

  it("sin permiso para copiar, deja elegido el dato para copiarlo a mano", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => Promise.reject(new Error("no"))) } });
    const el = armarPanelDePago(PANEL);
    document.body.append(el);
    copiar(el, "nota").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(String(window.getSelection())).toBe(PANEL.nota);
    expect(copiar(el, "nota").textContent).toBe(t("pagoCopiar"));
  });

  it("el QR y «Abrir en mi app de pagos» llevan el enlace de pago del servidor, sin tocarlo", () => {
    const el = armarPanelDePago(PANEL);
    expect(pintarQr).toHaveBeenCalledTimes(1);
    expect(pintarQr.mock.calls[0]?.[1]).toBe(PANEL.enlace);
    const a = el.querySelector<HTMLAnchorElement>("a[data-pago='app']");
    expect(a?.getAttribute("href")).toBe(PANEL.enlace);
    expect(a?.textContent).toBe(t("pagoAbrirApp"));
    expect(el.querySelector("img")?.getAttribute("alt")).toBe(t("pagoQrAlt"));
  });

  it("si el QR no se puede dibujar, no queda un recuadro roto", async () => {
    pintarQr.mockResolvedValueOnce(false);
    const el = armarPanelDePago(PANEL);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a[data-pago='app']")).not.toBeNull();
  });

  it("cada «Copiar» dice qué copia a quien no ve la pantalla, y ningún botón nombra una moneda ni una red", () => {
    const el = armarPanelDePago(PANEL);
    document.body.append(el);
    for (const dato of ["destino", "monto", "nota"]) {
      const b = copiar(el, dato) as HTMLButtonElement;
      const id = b.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(id)?.textContent?.trim(), dato).toBeTruthy();
    }
    for (const b of el.querySelectorAll("button, a")) expect(b.textContent ?? "").not.toMatch(/\b(USDC|XLM|Stellar|memo|token|hash)\b/i);
  });

  it("lo que no hace falta para pagar va plegado en Más detalles, cerrado, con sus datos puestos", () => {
    const el = armarPanelDePago(PANEL);
    const mas = el.querySelector<HTMLDetailsElement>('details[data-pago="detalles"]');
    expect(mas?.open).toBe(false);
    expect(mas?.querySelector("summary")?.textContent).toBe(t("pagoMasDetalles"));
    expect([...(mas?.querySelectorAll("p.pago-detalle") ?? [])].map((p) => p.textContent)).toEqual(["Este pago es para la cuenta a•••@gmail.com.", t("pagoSirve"), t("pagoDeMas")]);
    // Sin nada más para plegar, el pliegue igual lleva el QR del enlace y Abrir en mi app de pagos.
    expect(armarPanelDePago({ ...PANEL, detalles: [] }).querySelector("details a[data-pago='app']")).not.toBeNull();
  });

  it("en inglés, sus rótulos en inglés", () => {
    setLang("en");
    const el = armarPanelDePago({ ...PANEL, monto: "2.50" });
    expect(el.textContent).toContain(t("pagoCuenta"));
    expect(valor(el, "monto")).toBe("2.50 USDC");
    expect(valor(el, "moneda")).toBe("USDC on Stellar");
    expect(el.textContent).toContain("Memo");
    expect(copiar(el, "destino").textContent).toBe(t("pagoCopiar"));
    setLang("es");
  });
});
