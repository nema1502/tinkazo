// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n";
import type { LecturaDePago } from "../stellar/pagos";
import type { DatosDelPago, Preparacion } from "../stellar/pagos-envio";
import type { LectorDePagos } from "../stellar/pagos-red";
import { type Billetera, type ContextoDePago, type Dependencias, type PagoSolo, type ResultadoDelPremio, pagarPremioEn } from "./pagar-premio";
import { montarGanadores } from "./panel-ganadores";

/**
 * Pagar premio con el pago en duda o en camino: Pagar y Otro monto no se ven, queda Volver a mirar, que solo pregunta a la
 * red, y la fila del panel no dice Pendiente. Todo con la cuenta, la red y la billetera de mentira: nada se firma ni se manda.
 */

const cuentaNueva = (): string => Keypair.random().publicKey();
const [ORG, GANA] = [cuentaNueva(), cuentaNueva()];
const ACTIVO = { code: "USDC", issuer: cuentaNueva() };
const HASH = "ab".repeat(32);
const XDR = "AAAAAgAAAAArmado";
const DESDE = 1_800_000_000;
const NOTA = "tk:premio:777:0";
const SORTEO = 1_793_000_000;
const FILA = { puesto: 0, cuenta: GANA, nombre: "Equipo Cohete", nota: NOTA };
const PAGADO: LecturaDePago = { tipo: "pagado", hash: HASH, monto: "50.0000000", cuando: DESDE + 60, de: ORG };

interface Opciones {
  pago?: ResultadoDelPremio;
  /** Si un pago de ese premio con la cuenta todavía puede entrar. Sin esto, la cuenta no lo dice. */
  enCamino?: (nota: string) => boolean;
  /** Sin la cuenta que paga sola: la billetera de siempre, que firma adentro. */
  sinSola?: boolean;
}

/** Dependencias de mentira, con quién fue llamado. `buscar` contesta que no hay pago salvo que se le diga otra cosa. */
function armar(o: Opciones = {}): {
  deps: Dependencias;
  buscar: ReturnType<typeof vi.fn>;
  preparar: ReturnType<typeof vi.fn>;
  mandar: ReturnType<typeof vi.fn>;
  firmar: ReturnType<typeof vi.fn>;
  pagar: ReturnType<typeof vi.fn>;
} {
  const buscar = vi.fn(async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }));
  const preparar = vi.fn(async (d: DatosDelPago): Promise<Preparacion> => ({ ok: true, xdr: XDR, nota: NOTA, monto: d.monto }));
  const mandar = vi.fn(async () => ({ ok: false as const, rechazo: "sin-respuesta" as const, codigos: [] }));
  const firmar = vi.fn(async () => "firmado");
  const pagar = vi.fn(async (): Promise<ResultadoDelPremio> => o.pago ?? { estado: "incierto" });
  const sola: PagoSolo = { saldo: async () => 100n * 10_000_000n, pagar, ...(o.enCamino ? { enCamino: o.enCamino } : {}) };
  const billetera: Billetera = {
    direccion: ORG,
    firmaAdentro: true,
    ...(o.sinSola ? {} : { mandaSola: sola }),
    red: async () => null,
    firmar,
  };
  return { deps: { buscar, preparar, mandar, billetera }, buscar, preparar, mandar, firmar, pagar };
}

function contexto(dep: { deps: Dependencias }, extra: Partial<ContextoDePago> = {}): ContextoDePago {
  return {
    red: "mainnet",
    raffleId: "777",
    premio: "Beca de 50 USDC",
    activo: ACTIVO,
    pagadoras: new Set<string>([ORG]),
    desde: DESDE,
    esperaMs: 60_000,
    dependencias: async () => dep.deps,
    destinoDe: (puesto) => (puesto === FILA.puesto ? GANA : null),
    ...extra,
  };
}

/** El formulario abierto debajo de una fila, y las veces que avisó que cambió el estado del pago. */
function abrir(dep: { deps: Dependencias }, extra: Partial<ContextoDePago> = {}): { caja: HTMLElement; form: HTMLFormElement; cambios: number[] } {
  const caja = document.createElement("div");
  document.body.append(caja);
  const cambios: number[] = [];
  pagarPremioEn(contexto(dep, extra))(FILA, caja, () => undefined, () => cambios.push(1));
  return { caja, form: caja.querySelector("form") as HTMLFormElement, cambios };
}

const enviar = (form: HTMLFormElement): void => void form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
const botonCon = (caja: HTMLElement, rotulo: string): HTMLButtonElement | undefined =>
  [...caja.querySelectorAll("button")].find((b) => b.textContent === rotulo);
const q = <T extends HTMLElement>(caja: HTMLElement, sel: string): T => caja.querySelector(sel) as T;
const mensaje = (caja: HTMLElement): string => q(caja, ".gan-msg").textContent ?? "";
const principal = (caja: HTMLElement): HTMLButtonElement => q<HTMLButtonElement>(caja, "button[type=submit]");
const visible = (e: HTMLElement | null | undefined): boolean => !!e && !e.hidden && !e.closest("[hidden]");

const DUDA = "No sabemos si el pago salió. No vuelvas a pagar: lo estamos revisando.";
const EN_CAMINO = "Ya hay un pago de este premio en camino. No pagues de nuevo.";
const NO_SALIO = "Ese pago no salió. Podés volver a intentarlo.";
const SIN_RED = "Todavía no sabemos si salió. No vuelvas a pagar. Tocá Volver a mirar en un rato.";

beforeEach(() => {
  document.body.replaceChildren();
  setLang("es");
});
afterEach(() => vi.useRealTimers());

describe("en la duda, no se sabe si el pago salió", () => {
  it("Pagar no se ve: queda el aviso y Volver a mirar como único botón principal", async () => {
    const dep = armar({ pago: { estado: "incierto" } });
    const { caja, form } = abrir(dep);
    await vi.waitFor(() => expect(visible(botonCon(caja, "Pagar"))).toBe(true));
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe(DUDA));
    expect(visible(principal(caja))).toBe(false);
    expect(principal(caja).disabled).toBe(true);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
    // Un Enter con Pagar escondido no arma otro pago.
    enviar(form);
    await Promise.resolve();
    expect(dep.pagar).toHaveBeenCalledTimes(1);
  });

  it("con la billetera de siempre, que firma adentro, también se esconde Firmar y pagar", async () => {
    const dep = armar({ sinSola: true });
    const { caja, form } = abrir(dep);
    expect(visible(principal(caja))).toBe(true);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toContain("No supimos si el pago salió"));
    expect(visible(principal(caja))).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
    expect(dep.mandar).toHaveBeenCalledTimes(1);
    // Cuando la red dice con certeza que no está, vuelve el formulario de siempre.
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(visible(principal(caja))).toBe(true));
    expect(principal(caja).disabled).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(false);
  });

  it("al resolverse como que no salió, vuelven Pagar y Otro monto y se esconde Volver a mirar", async () => {
    const dep = armar({ pago: { estado: "incierto" } });
    const { caja, form } = abrir(dep);
    await vi.waitFor(() => expect(visible(botonCon(caja, "Pagar"))).toBe(true));
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe(DUDA));
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe(NO_SALIO));
    expect(visible(principal(caja))).toBe(true);
    expect(principal(caja).disabled).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(false);
  });
});

describe("un pago de este premio en camino, con la cuenta que todavía puede entrar", () => {
  it("no hay Pagar ni Otro monto, y sí Volver a mirar como botón principal", async () => {
    const dep = armar({ enCamino: () => true });
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(q(caja, ".gan-explica").textContent).toBe(EN_CAMINO));
    expect(visible(principal(caja))).toBe(false);
    expect(principal(caja).disabled).toBe(true);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(false);
    expect(visible(q(caja, ".gan-otra"))).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
  });

  it("Volver a mirar solo pregunta a la red: no arma, no firma ni manda nada", async () => {
    const dep = armar({ enCamino: () => true });
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(q(caja, ".gan-explica").textContent).toBe(EN_CAMINO));
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe(SIN_RED));
    // Preguntó una vez, por la nota de ese premio y la cuenta de quien ganó, y nada más.
    expect(dep.buscar).toHaveBeenCalledTimes(1);
    expect(dep.buscar.mock.calls[0]?.[0]).toMatchObject({ destino: GANA, nota: NOTA, desde: DESDE });
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(dep.pagar).not.toHaveBeenCalled();
    expect(dep.firmar).not.toHaveBeenCalled();
    expect(dep.mandar).not.toHaveBeenCalled();
    // Con la marca todavía viva sigue frenado.
    expect(visible(principal(caja))).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
  });

  it("si el pago aparece en la red, queda pagado sin pagar otra vez", async () => {
    const dep = armar({ enCamino: () => true });
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => PAGADO);
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(q(caja, ".gan-explica").textContent).toBe(EN_CAMINO));
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(visible(principal(caja))).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(false);
    expect(dep.pagar).not.toHaveBeenCalled();
  });

  it("al vencer la marca y decir la red que no entró, vuelve el formulario de siempre", async () => {
    let vivo = true;
    const dep = armar({ enCamino: () => vivo });
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(q(caja, ".gan-explica").textContent).toBe(EN_CAMINO));
    vivo = false;
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe(NO_SALIO));
    expect(visible(principal(caja))).toBe(true);
    expect(principal(caja).disabled).toBe(false);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(true);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(false);
    expect(q(caja, ".gan-explica").textContent).toContain("Pagás a Equipo Cohete");
    expect(dep.pagar).not.toHaveBeenCalled();
  });

  it("avisa al panel cuando el pago pasa a estar en camino y cuando deja de estarlo", async () => {
    let vivo = true;
    const dep = armar({ enCamino: () => vivo });
    const { caja, cambios } = abrir(dep);
    await vi.waitFor(() => expect(cambios).toHaveLength(1));
    vivo = false;
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(cambios).toHaveLength(2));
  });

  it("si la marca vence pero la red no contesta, sigue frenado hasta que la red diga que no entró", async () => {
    let vivo = true;
    const dep = armar({ enCamino: () => vivo });
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => ({ tipo: "sin-consulta" }));
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(q(caja, ".gan-explica").textContent).toBe(EN_CAMINO));
    vivo = false;
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe(SIN_RED));
    // El mensaje pide no pagar y tocar Volver a mirar: ese es el botón que queda, y Pagar no se ve.
    expect(visible(principal(caja))).toBe(false);
    expect(principal(caja).disabled).toBe(true);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(false);
    expect(visible(q(caja, ".gan-otra"))).toBe(false);
    // Repintar (cambiar de idioma) con la marca ya vencida no devuelve Pagar sin preguntar.
    setLang("en");
    setLang("es");
    expect(visible(principal(caja))).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
    // Recién cuando la red dice que no está, vuelve el formulario.
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }));
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe(NO_SALIO));
    expect(visible(principal(caja))).toBe(true);
    expect(principal(caja).disabled).toBe(false);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(false);
    expect(dep.buscar).toHaveBeenCalledTimes(2);
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(dep.pagar).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ la fila del panel */

/** El panel de un solo premio, con el manejador de pagos de verdad y las dependencias de mentira. */
function montarPanel(dep: { deps: Dependencias }, lector: LectorDePagos): { raiz: HTMLElement; fila: HTMLElement } {
  const raiz = document.createElement("section");
  document.body.append(raiz);
  montarGanadores(raiz, {
    red: "mainnet",
    raffleId: "777",
    premio: "Beca de 50 USDC",
    activo: ACTIVO,
    ganadores: [{ puesto: 0, entrada: GANA }],
    sorteoEn: SORTEO,
    desde: DESDE,
    pagadoras: new Set([ORG]),
    lector,
    ahora: () => SORTEO + 3600,
    etiquetaDe: () => "Equipo Cohete",
    pagar: pagarPremioEn(contexto(dep)),
  });
  return { raiz, fila: raiz.querySelector(".gan-fila") as HTMLElement };
}

const chip = (fila: HTMLElement): HTMLElement => fila.querySelector(".gan-est") as HTMLElement;
const sinPago: LectorDePagos = async () => ({ tipo: "no-hay" });

describe("la fila de esa persona en el panel", () => {
  it("con el pago en duda dice Sin confirmar, y al resolverse vuelve a Pendiente", async () => {
    const dep = armar({ pago: { estado: "incierto" } });
    const { fila } = montarPanel(dep, sinPago);
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Pendiente"));
    (fila.querySelector(".gan-pagar") as HTMLButtonElement).click();
    const caja = fila.querySelector(".gan-pago") as HTMLElement;
    await vi.waitFor(() => expect(visible(botonCon(caja, "Pagar"))).toBe(true));
    enviar(q(caja, "form"));
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Sin confirmar"));
    expect(chip(fila).classList.contains("sin-consulta")).toBe(true);
    expect(chip(fila).classList.contains("pendiente")).toBe(false);
    // Cerrar el formulario no cambia lo que dice la fila: el pago sigue en duda.
    (fila.querySelector(".gan-pagar") as HTMLButtonElement).click();
    expect(chip(fila).textContent).toBe("Sin confirmar");
    // Se vuelve a abrir, la red dice que ese pago no está y la fila vuelve a Pendiente.
    (fila.querySelector(".gan-pagar") as HTMLButtonElement).click();
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Pendiente"));
    expect(chip(fila).classList.contains("pendiente")).toBe(true);
  });

  it("con un pago en camino, sin abrir el formulario, dice Sin confirmar, y al vencer la marca vuelve a Pendiente", async () => {
    let vivo = true;
    const dep = armar({ enCamino: () => vivo });
    const { raiz, fila } = montarPanel(dep, sinPago);
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Sin confirmar"));
    expect(chip(fila).classList.contains("sin-consulta")).toBe(true);
    // Pagar premio sigue ahí para abrir el formulario, que muestra el aviso y Volver a mirar.
    expect(visible(fila.querySelector(".gan-pagar"))).toBe(true);
    vivo = false;
    (raiz.querySelector(".gan-actualizar") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Pendiente"));
    expect(chip(fila).classList.contains("pendiente")).toBe(true);
  });

  it("un premio ya pagado dice Pagado, aunque la marca siga viva", async () => {
    const dep = armar({ enCamino: () => true });
    const { fila } = montarPanel(dep, async () => PAGADO);
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Pagado"));
    expect(chip(fila).classList.contains("pagado")).toBe(true);
  });

  it("sin pago en duda ni en camino, o sin quien lo pregunte, dice Pendiente como siempre", async () => {
    const { fila } = montarPanel(armar({ enCamino: () => false }), sinPago);
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Pendiente"));
    const raiz = document.createElement("section");
    document.body.append(raiz);
    montarGanadores(raiz, {
      red: "mainnet",
      raffleId: "777",
      premio: "",
      activo: ACTIVO,
      ganadores: [{ puesto: 0, entrada: GANA }],
      sorteoEn: SORTEO,
      desde: DESDE,
      pagadoras: new Set([ORG]),
      lector: sinPago,
      ahora: () => SORTEO + 3600,
      etiquetaDe: () => undefined,
    });
    await vi.waitFor(() => expect(raiz.querySelector(".gan-est")?.textContent).toBe("Pendiente"));
  });

  it("en inglés dice Not confirmed", async () => {
    setLang("en");
    const { fila } = montarPanel(armar({ enCamino: () => true }), sinPago);
    await vi.waitFor(() => expect(chip(fila).textContent).toBe("Not confirmed"));
    setLang("es");
    expect(chip(fila).textContent).toBe("Sin confirmar");
  });

  it("sin pagar con Google en la red principal no pregunta por la billetera: la fila queda como siempre", async () => {
    const manejador = pagarPremioEn({
      red: "testnet",
      raffleId: "777",
      premio: "Beca de 50 USDC",
      activo: ACTIVO,
      pagadoras: new Set([ORG]),
      desde: DESDE,
    });
    expect(await manejador.sinConfirmar?.(FILA)).toBe(false);
  });
});
