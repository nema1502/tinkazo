// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoFalso } from "../../workers/cuenta/src/horizon-falso";
import { BASE, mundoFalso } from "../../workers/cuenta/src/mundo-falso";
import { DIA_MS, EMISOR_USDC, PLAN, enlaceDePago, memoDePlan } from "../../workers/cuenta/src/reglas";
import { setLang, t } from "../i18n";
import { fechaLarga } from "./monedas-vista";
import { abrirPlan } from "./plan";

vi.mock("./qr", () => ({
  pintarQr: vi.fn(async (img: HTMLImageElement, texto: string) => {
    img.dataset.qr = texto;
    return true;
  }),
}));

/**
 * La compra del plan del equipo (`plan.ts`): lo que se muestra para pagar (cuenta, nota exacta, monto, QR y texto para
 * copiar), y "Ya pagué" contra un Horizon y un Worker simulados. Nunca firma nada: se paga desde otra billetera.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const PLANES = Keypair.random().publicKey();
const HOY = 1_790_000_000_000;
const pagoDePlan = (extra: Partial<PagoFalso> = {}): PagoFalso => ({ de: OTRA, a: PLANES, monto: "5.0000000", memo: memoDePlan(YO), tx: "p".repeat(64), ms: HOY - 1000, ...extra });

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};

function prender(): void {
  vi.stubEnv("VITE_MONEDAS", "1");
  vi.stubEnv("VITE_CUENTA_URL", BASE);
  vi.stubEnv("VITE_PLAN_EQUIPO", "1");
  vi.stubEnv("VITE_CUENTA_PLANES", PLANES);
}

beforeEach(() => {
  document.body.innerHTML = "";
  setLang("es");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lo que se muestra para pagar", () => {
  it("la cuenta de planes, la nota exacta, el monto, el QR de pago y el texto para copiar", () => {
    prender();
    abrirPlan({ address: YO });
    const cuerpo = dialogo()?.textContent ?? "";
    expect(document.querySelector('[data-plan="cuenta"]')?.textContent).toBe(PLANES);
    expect(document.querySelector('[data-plan="nota"]')?.textContent).toBe(`tk:plan:${YO.slice(-8)}`);
    expect(cuerpo).toContain("Pagá 5 USDC a esta cuenta, con esta nota");
    expect(cuerpo).toContain("Monto: 5 USDC");
    const qr = (document.querySelector('[data-plan="qr"]') as HTMLImageElement).dataset.qr as string;
    expect(qr).toBe(enlaceDePago({ destino: PLANES, cuenta: YO, red: "testnet" }));
    const q = new URL(qr.replace("web+stellar:", "https://x/")).searchParams;
    expect(q.get("destination")).toBe(PLANES);
    expect(q.get("amount")).toBe("5");
    expect(q.get("asset_code")).toBe("USDC");
    expect(q.get("asset_issuer")).toBe(EMISOR_USDC.testnet);
    expect(q.get("memo")).toBe(`tk:plan:${YO.slice(-8)}`);
  });

  it("copiar deja 'Pagá 5 USDC a <cuenta> con la nota <nota>'", async () => {
    prender();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    abrirPlan({ address: YO });
    (document.querySelector('[data-plan="copiar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith(`Pagá 5 USDC a ${PLANES} con la nota tk:plan:${YO.slice(-8)}`);
  });

  it("el texto público no promete lo que el código no hace", () => {
    prender();
    abrirPlan({ address: YO });
    const cuerpo = dialogo()?.textContent ?? "";
    expect(cuerpo).toContain("30 días de plan en tu cuenta.");
    expect(cuerpo).toContain("50 monedas de regalo, una sola vez.");
    // Lo que sube el cupo es real (lo averigua el portero): se dice sin «próximamente» y con el número del Worker de la cuenta.
    expect(cuerpo).toContain("50 sorteos propios por 30 días.");
    expect(cuerpo).not.toMatch(/Próximamente:[^.]*sorteos/);
    // El logo ya existe y es gratis para todos; el nombre del equipo en el show sigue siendo futuro.
    expect(cuerpo).toContain("es gratis para todos");
    expect(cuerpo).toMatch(/Próximamente: el nombre del equipo en el show\./);
  });

  it("los sorteos propios que promete el texto son los que da el plan, en español y en inglés", () => {
    prender();
    expect(PLAN.cupo.sellos).toBe(50);
    expect(PLAN.dias).toBe(30);
    abrirPlan({ address: YO });
    expect(dialogo()?.textContent).toContain(`${PLAN.cupo.sellos} sorteos propios por ${PLAN.dias} días`);
    document.body.innerHTML = "";
    setLang("en");
    abrirPlan({ address: YO });
    const cuerpo = dialogo()?.textContent ?? "";
    expect(cuerpo).toContain(`${PLAN.cupo.sellos} draws of your own for ${PLAN.dias} days.`);
    expect(cuerpo).toContain("Coming soon: the team name on the show.");
    expect(cuerpo).not.toMatch(/Coming soon:[^.]*draws/);
  });

  it("tiene una sola acción principal: Ya pagué", () => {
    prender();
    abrirPlan({ address: YO });
    expect(principal().textContent).toBe("Ya pagué");
  });

  it("en inglés", () => {
    prender();
    setLang("en");
    abrirPlan({ address: YO });
    expect(dialogo()?.textContent).toContain("Pay 5 USDC to this account, with this note");
    expect(principal().textContent).toBe("I've paid");
  });

  it("con la bandera apagada, o sin cuenta de planes, no abre nada", () => {
    abrirPlan({ address: YO });
    expect(dialogo()).toBeNull();
    prender();
    vi.stubEnv("VITE_PLAN_EQUIPO", "");
    abrirPlan({ address: YO });
    expect(dialogo()).toBeNull();
    vi.stubEnv("VITE_PLAN_EQUIPO", "1");
    vi.stubEnv("VITE_CUENTA_PLANES", "");
    abrirPlan({ address: YO });
    expect(dialogo()).toBeNull();
  });
});

describe("Ya pagué", () => {
  it("sin pago en la red dice que todavía no lo ve, y no activa nada", async () => {
    prender();
    const m = await mundoFalso({ ahora: HOY, horizon: { cuentas: [YO], pagos: { [PLANES]: [] } }, env: { CUENTA_PLANES: PLANES } });
    vi.stubGlobal("fetch", m.fetch);
    abrirPlan({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("Todavía no vemos tu pago"));
    expect(m.guardada(YO)).toBeNull();
    expect(principal().disabled).toBe(false);
  });

  it("con el pago de 5 USDC y la nota, activa el plan, regala 50 monedas y enlaza el pago", async () => {
    prender();
    const m = await mundoFalso({ ahora: HOY, horizon: { cuentas: [YO], pagos: { [PLANES]: [pagoDePlan()] } }, env: { CUENTA_PLANES: PLANES } });
    vi.stubGlobal("fetch", m.fetch);
    abrirPlan({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("Tu plan del equipo está activo hasta el"));
    expect(estado()).toContain(fechaLarga(HOY + 30 * DIA_MS, "es"));
    expect(estado()).toContain("Sumaste 50 monedas de regalo.");
    const enlace = document.querySelector<HTMLAnchorElement>(".dlg-estado a");
    expect(enlace?.href).toBe(`https://stellar.expert/explorer/testnet/tx/${"p".repeat(64)}`);
    expect(m.guardada(YO)).toMatchObject({ saldo: 50, plan: { inicio: HOY, vence: HOY + 30 * DIA_MS } });
    expect(principal().textContent).toBe(t("acctClose"));
  });

  it("volver a decir 'Ya pagué' con el mismo pago no activa ni regala otra vez", async () => {
    prender();
    const m = await mundoFalso({ ahora: HOY, horizon: { cuentas: [YO], pagos: { [PLANES]: [pagoDePlan()] } }, env: { CUENTA_PLANES: PLANES } });
    vi.stubGlobal("fetch", m.fetch);
    abrirPlan({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("activo hasta"));
    document.body.innerHTML = "";
    abrirPlan({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("activo hasta"));
    expect(estado()).not.toContain("monedas de regalo");
    expect(m.guardada(YO)).toMatchObject({ saldo: 50, plan: { vence: HOY + 30 * DIA_MS } });
  });

  it("un pago con la nota de otra cuenta no activa el plan de esta", async () => {
    prender();
    const m = await mundoFalso({ ahora: HOY, horizon: { cuentas: [YO], pagos: { [PLANES]: [pagoDePlan({ memo: memoDePlan(OTRA) })] } }, env: { CUENTA_PLANES: PLANES } });
    vi.stubGlobal("fetch", m.fetch);
    abrirPlan({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("Todavía no vemos tu pago"));
    expect(m.guardada(YO)).toBeNull();
  });

  it("con el Worker caído dice que no pudo mirar", async () => {
    prender();
    vi.stubGlobal("fetch", (async () => Promise.reject(new Error("sin red"))) as typeof fetch);
    abrirPlan({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("No pudimos mirar tu pago"));
  });

  it("si el plan ya estaba activo al abrir, lo dice sin pedir nada", () => {
    prender();
    abrirPlan({ address: YO, vence: Date.now() + 5 * DIA_MS });
    expect(estado()).toContain("Tu plan del equipo está activo hasta el");
  });
});
