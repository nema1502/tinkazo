// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T, setLang } from "../i18n";
import { passphraseDe } from "../stellar/oficiales";
import { txUrl } from "../stellar/config";
import type { LecturaDePago } from "../stellar/pagos";
import type { Envio, Preparacion } from "../stellar/pagos-envio";
import { type Billetera, type ContextoDePago, type Dependencias, type PedidoDePago, type Resultado, mensajeDe, pagarPremioEn, pagarUnPremio } from "./pagar-premio";

const [ORG, GANA, OTRA, PAGA] = [Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey()] as [string, string, string, string];
const EMISOR = Keypair.random().publicKey();
const ACTIVO = { code: "USDC", issuer: EMISOR };
const HASH = "cd".repeat(32);
const XDR_ARMADO = "AAAAAgAAAAArmado";
const XDR_FIRMADO = "AAAAAgAAAAFirmado";

const DESDE = 1_800_000_000;
const PEDIDO: PedidoDePago = { red: "testnet", raffleId: "777", puesto: 2, destino: GANA, activo: ACTIVO, monto: "50", desde: DESDE };

const LISTO: Preparacion = { ok: true, xdr: XDR_ARMADO, nota: "tk:premio:777:2", monto: "50.0000000" };

interface Armado {
  deps: Dependencias;
  buscar: ReturnType<typeof vi.fn>;
  preparar: ReturnType<typeof vi.fn>;
  mandar: ReturnType<typeof vi.fn>;
  firmar: ReturnType<typeof vi.fn>;
  pasos: string[];
}

/** Dependencias de mentira: lo que contesta la red y la billetera, y quién fue llamado. */
function armar(
  o: { prep?: Preparacion; envio?: Envio; billetera?: Partial<Billetera> | null; firma?: "firma" | "rechaza"; previo?: LecturaDePago | (() => Promise<LecturaDePago>) } = {},
): Armado {
  const buscar = vi.fn(async (): Promise<LecturaDePago> => (typeof o.previo === "function" ? o.previo() : (o.previo ?? { tipo: "no-hay" })));
  const preparar = vi.fn(async () => o.prep ?? LISTO);
  const mandar = vi.fn(async () => o.envio ?? ({ ok: true, hash: HASH } as Envio));
  const firmar = vi.fn(async () => {
    if (o.firma === "rechaza") throw new Error("wallet-rejected");
    return XDR_FIRMADO;
  });
  const pasos: string[] = [];
  const billetera: Billetera | null =
    o.billetera === null
      ? null
      : { direccion: ORG, firmaAdentro: true, red: async () => passphraseDe("testnet"), firmar, ...o.billetera };
  return { deps: { buscar, preparar, mandar, billetera, alAvanzar: (p) => pasos.push(p) }, buscar, preparar, mandar, firmar, pasos };
}

describe("los pasos de un pago de premio", () => {
  it("con la billetera de quien organiza: mira la red, pide la firma, manda y devuelve el hash", async () => {
    const a = armar();
    const r = await pagarUnPremio(a.deps, PEDIDO);
    expect(r).toEqual({ tipo: "listo", hash: HASH, origen: ORG });
    expect(a.pasos).toEqual(["mirando", "firmando", "enviando"]);
    expect(a.preparar).toHaveBeenCalledWith({ red: "testnet", origen: ORG, destino: GANA, activo: ACTIVO, monto: "50.0000000", raffleId: "777", puesto: 2 });
    expect(a.firmar).toHaveBeenCalledWith(XDR_ARMADO, passphraseDe("testnet"), ORG);
    expect(a.mandar).toHaveBeenCalledWith("testnet", XDR_FIRMADO);
  });

  it("con la billetera abierta paga su cuenta, no la que se haya escrito", async () => {
    const a = armar();
    await pagarUnPremio(a.deps, { ...PEDIDO, cuentaQuePaga: OTRA });
    expect(a.preparar.mock.calls[0]?.[0].origen).toBe(ORG);
  });

  it("un monto que no vale no llega a la red", async () => {
    for (const monto of ["", "0", "-5", "abc", "1.23456789", "50 USDC"]) {
      const a = armar();
      expect(await pagarUnPremio(a.deps, { ...PEDIDO, monto }), monto).toEqual({ tipo: "monto-malo" });
      expect(a.preparar).not.toHaveBeenCalled();
    }
  });

  it("si la cuenta ganadora no puede recibir, lo dice y no pide firmar ni manda nada", async () => {
    for (const motivo of ["destino-sin-linea", "destino-sin-cuenta", "destino-lleno", "origen-sin-saldo", "origen-sin-linea", "origen-sin-cuenta", "sin-red", "datos-invalidos"] as const) {
      const a = armar({ prep: { ok: false, motivo, ...(motivo === "origen-sin-saldo" ? { saldo: "10.0000000" } : {}) } });
      const r = await pagarUnPremio(a.deps, PEDIDO);
      expect(r, motivo).toMatchObject({ tipo: "no-se-puede", motivo });
      expect(a.firmar).not.toHaveBeenCalled();
      expect(a.mandar).not.toHaveBeenCalled();
    }
  });

  it("con una cuenta de Google (Pollar) no se firma acá: devuelve el pago armado, para firmarlo afuera", async () => {
    const a = armar({ billetera: { direccion: PAGA, firmaAdentro: false } });
    const r = await pagarUnPremio(a.deps, PEDIDO);
    expect(r).toEqual({ tipo: "afuera", xdr: XDR_ARMADO, nota: "tk:premio:777:2", origen: PAGA });
    expect(a.firmar).not.toHaveBeenCalled();
    expect(a.mandar).not.toHaveBeenCalled();
    expect(a.pasos).toEqual(["mirando"]);
  });

  it("firmando afuera se puede elegir la cuenta que paga, y tiene que ser una cuenta de verdad", async () => {
    const a = armar({ billetera: { direccion: PAGA, firmaAdentro: false } });
    const r = await pagarUnPremio(a.deps, { ...PEDIDO, cuentaQuePaga: OTRA });
    expect(r).toMatchObject({ tipo: "afuera", origen: OTRA });
    expect(a.preparar.mock.calls[0]?.[0].origen).toBe(OTRA);
    for (const mala of ["Ana", "GABC", `${OTRA}x`]) {
      const b = armar({ billetera: { direccion: PAGA, firmaAdentro: false } });
      expect(await pagarUnPremio(b.deps, { ...PEDIDO, cuentaQuePaga: mala }), mala).toEqual({ tipo: "cuenta-mala" });
      expect(b.preparar).not.toHaveBeenCalled();
    }
  });

  it("sin billetera y sin cuenta escrita, no hay quién pague", async () => {
    const a = armar({ billetera: null });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "cuenta-mala" });
    const b = armar({ billetera: null });
    expect(await pagarUnPremio(b.deps, { ...PEDIDO, cuentaQuePaga: OTRA })).toMatchObject({ tipo: "afuera", origen: OTRA });
  });

  it("si la billetera está en otra red, no pide firmar", async () => {
    const a = armar({ billetera: { red: async () => passphraseDe("mainnet") } });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "otra-red" });
    expect(a.firmar).not.toHaveBeenCalled();
    expect(a.mandar).not.toHaveBeenCalled();
    // Si no se sabe en qué red está, se sigue: la billetera avisa si no es.
    const b = armar({ billetera: { red: async () => null } });
    expect((await pagarUnPremio(b.deps, PEDIDO)).tipo).toBe("listo");
    const c = armar({ billetera: { red: async () => Promise.reject(new Error("sin respuesta")) } });
    expect((await pagarUnPremio(c.deps, PEDIDO)).tipo).toBe("listo");
  });

  it("si no se firma, no se manda nada", async () => {
    const a = armar({ firma: "rechaza" });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "no-firmado" });
    expect(a.mandar).not.toHaveBeenCalled();
    expect(a.pasos).toEqual(["mirando", "firmando"]);
  });

  it("si la red lo rechaza o no contesta, lo dice distinto", async () => {
    const r1 = await pagarUnPremio(armar({ envio: { ok: false, rechazo: "sin-linea", codigos: ["op_no_trust"] } }).deps, PEDIDO);
    expect(r1).toEqual({ tipo: "rechazado", rechazo: "sin-linea" });
    const r2 = await pagarUnPremio(armar({ envio: { ok: false, rechazo: "sin-respuesta", codigos: [] } }).deps, PEDIDO);
    expect(r2).toMatchObject({ tipo: "sin-respuesta", busqueda: { destino: GANA, nota: "tk:premio:777:2", desde: DESDE } });
  });
});

describe("lo que se le dice a la persona", () => {
  const todos: Resultado[] = [
    { tipo: "monto-malo" },
    { tipo: "cuenta-mala" },
    ...(["destino-sin-cuenta", "destino-sin-linea", "destino-lleno", "origen-sin-cuenta", "origen-sin-linea", "origen-sin-saldo", "sin-red", "datos-invalidos"] as const).map((motivo): Resultado => ({ tipo: "no-se-puede", motivo, saldo: "3.5000000" })),
    { tipo: "afuera", xdr: "x", nota: "n", origen: ORG },
    { tipo: "otra-red" },
    { tipo: "no-firmado" },
    ...(["sin-saldo", "sin-linea", "sin-cuenta", "lleno", "secuencia", "vencido", "firma", "otro"] as const).map((rechazo): Resultado => ({ tipo: "rechazado", rechazo })),
    { tipo: "sin-respuesta", busqueda: { red: "testnet", destino: GANA, activo: ACTIVO, nota: "tk:premio:777:2", pagadoras: [ORG], desde: DESDE } },
    { tipo: "ya-pagado", hash: HASH, origen: ORG },
    { tipo: "sin-consulta" },
    { tipo: "listo", hash: HASH, origen: ORG },
  ];

  it("cada resultado tiene un texto en español y en inglés, sin dejar variables sin reemplazar", () => {
    for (const r of todos) {
      const m = mensajeDe(r, { quien: "Equipo Cohete", red: "testnet", monto: "50" });
      for (const l of ["es", "en"] as const) {
        const texto = T[l][m.clave];
        expect(typeof texto, `${l} ${m.clave}`).toBe("string");
        let s = texto as string;
        for (const [k, v] of Object.entries(m.vars)) s = s.split(`{${k}}`).join(v);
        expect(s, `${l} ${m.clave}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("ofrece 'Avisarle' cuando el problema se arregla del lado de quien ganó", () => {
    const avisa = todos.filter((r) => mensajeDe(r, { quien: "x", red: "testnet", monto: "1" }).avisar);
    expect(avisa).toEqual([
      { tipo: "no-se-puede", motivo: "destino-sin-cuenta", saldo: "3.5000000" },
      { tipo: "no-se-puede", motivo: "destino-sin-linea", saldo: "3.5000000" },
      { tipo: "rechazado", rechazo: "sin-linea" },
      { tipo: "rechazado", rechazo: "sin-cuenta" },
    ]);
  });

  it("nombra a la persona, el saldo y la red cuando hace falta", () => {
    expect(T.es[mensajeDe({ tipo: "no-se-puede", motivo: "destino-sin-linea" }, { quien: "Equipo Cohete", red: "testnet", monto: "50" }).clave]).toContain("{quien}");
    const saldo = mensajeDe({ tipo: "no-se-puede", motivo: "origen-sin-saldo", saldo: "12.5000000" }, { quien: "x", red: "testnet", monto: "50" });
    expect(saldo.vars).toMatchObject({ saldo: "12.5", monto: "50" });
    expect(mensajeDe({ tipo: "otra-red" }, { quien: "x", red: "mainnet", monto: "1" }).vars.red).toBe("mainnet");
  });

  it("los textos no dicen memo, hash, transacción ni usan el punto medio", () => {
    for (const l of ["es", "en"] as const) {
      for (const [k, v] of Object.entries(T[l])) {
        if (!k.startsWith("pg") || typeof v !== "string") continue;
        expect(v, `${l} ${k}`).not.toMatch(/\b(memo|hash|xdr|transacci[oó]n|transaction)\b|·/i);
      }
    }
  });

  it("no se amplía la firma de Pollar: este flujo no la toca", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/ui/pagar-premio.ts"), "utf8");
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/signAndSubmit\(|signUnsponsored\(|atenderFirmas|esperadas/);
    const pollar = readFileSync(resolve(process.cwd(), "src/stellar/wallet-pollar.ts"), "utf8");
    // La lista blanca sigue siendo la del sello y la del sorteo: dos firmas, las que arman `signAndSubmit` y `signUnsponsored`.
    expect(pollar).toContain('p.kind !== "sign" && p.kind !== "sign_and_send"');
    expect(pollar).toContain("!esperadas.has(p.unsignedXdr)");
  });
});

/* ------------------------------------------------------------------- la pantalla */

const FILA = { puesto: 2, cuenta: GANA, nombre: "Equipo Cohete", nota: "tk:premio:777:2" };

function abrir(dep: Armado, extra: Partial<ContextoDePago> = {}): { caja: HTMLElement; terminados: number[]; pagadoras: Set<string>; form: HTMLFormElement } {
  const caja = document.createElement("div");
  document.body.append(caja);
  const pagadoras = new Set<string>([ORG]);
  const terminados: number[] = [];
  const pagar = pagarPremioEn({ red: "testnet", raffleId: "777", premio: "Beca de 50 USDC", activo: ACTIVO, pagadoras, desde: DESDE, dependencias: async () => dep.deps, ...extra });
  pagar(FILA, caja, () => terminados.push(1));
  return { caja, terminados, pagadoras, form: caja.querySelector("form") as HTMLFormElement };
}

const campos = (caja: HTMLElement): { monto: HTMLInputElement; cuenta: HTMLInputElement; mensaje: HTMLElement; enviar: HTMLButtonElement } => ({
  monto: caja.querySelector(".gan-campo input") as HTMLInputElement,
  cuenta: caja.querySelectorAll<HTMLInputElement>(".gan-campo input")[1] as HTMLInputElement,
  mensaje: caja.querySelector(".gan-msg") as HTMLElement,
  enviar: caja.querySelector("button[type=submit]") as HTMLButtonElement,
});
const enviar = (form: HTMLFormElement): void => void form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
const botonCon = (caja: HTMLElement, texto: string): HTMLButtonElement | undefined => [...caja.querySelectorAll("button")].find((b) => b.textContent === texto);

beforeEach(() => {
  document.body.replaceChildren();
  setLang("es");
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("el formulario de 'Pagar premio'", () => {
  it("se abre debajo de la fila con el monto que dice el premio y la nota del pago", () => {
    const { caja } = abrir(armar());
    const { monto, enviar: boton } = campos(caja);
    expect(monto.value).toBe("50");
    expect(caja.textContent).toContain("Monto en USDC");
    expect(caja.textContent).toContain("Vas a pagar a Equipo Cohete");
    expect(caja.textContent).toContain("tk:premio:777:2");
    expect(boton.textContent).toBe("Firmar y pagar");
    expect(botonCon(caja, "Cancelar")).toBeDefined();
  });

  it("sin un monto claro en el premio, el campo queda vacío para escribirlo", () => {
    const { caja } = abrir(armar(), { premio: "Una polera" });
    expect(campos(caja).monto.value).toBe("");
  });

  it("Cancelar o Escape lo cierran; tocar 'Pagar premio' otra vez también", () => {
    const dep = armar();
    const a = abrir(dep);
    botonCon(a.caja, "Cancelar")?.click();
    expect(a.caja.childElementCount).toBe(0);

    const b = abrir(dep);
    b.form.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(b.caja.childElementCount).toBe(0);

    const c = abrir(dep);
    const pagar = pagarPremioEn({ red: "testnet", raffleId: "777", premio: "", activo: ACTIVO, pagadoras: new Set(), desde: DESDE, dependencias: async () => dep.deps });
    pagar(FILA, c.caja, () => undefined);
    expect(c.caja.childElementCount).toBe(0);
  });

  it("con un monto que no vale, lo dice y no toca la red", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep);
    const { monto, mensaje } = campos(caja);
    monto.value = "abc";
    enviar(form);
    await vi.waitFor(() => expect(mensaje.textContent).toBe("Escribí un monto mayor que cero, con hasta 7 decimales."));
    expect(mensaje.classList.contains("bad")).toBe(true);
    expect(dep.preparar).not.toHaveBeenCalled();
  });

  it("paga con la billetera: dice en qué paso va y al terminar muestra el enlace al pago y avisa", async () => {
    const dep = armar();
    const { caja, form, terminados, pagadoras } = abrir(dep);
    const { mensaje, enviar: boton } = campos(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje.textContent).toBe("Listo, el pago salió."));
    expect(dep.firmar).toHaveBeenCalledTimes(1);
    expect(dep.mandar).toHaveBeenCalledWith("testnet", XDR_FIRMADO);
    const enlace = caja.querySelector("a") as HTMLAnchorElement;
    expect(enlace.hidden).toBe(false);
    expect(enlace.href).toBe(txUrl(HASH, "testnet"));
    expect(enlace.textContent).toBe("Ver el pago ↗");
    expect(terminados).toHaveLength(1);
    expect(boton.hidden).toBe(true);
    expect(pagadoras.has(ORG)).toBe(true);
    expect(mensaje.classList.contains("bad")).toBe(false);
  });

  it("con el pago hecho, el monto, la explicación y 'Cancelar' se van: queda la confirmación y el enlace", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep);
    expect(caja.querySelector<HTMLElement>(".gan-campo")?.hidden).toBe(false);
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Listo, el pago salió."));
    expect(caja.querySelector<HTMLElement>(".gan-campo")?.hidden).toBe(true);
    expect(caja.querySelector<HTMLElement>(".gan-explica")?.hidden).toBe(true);
    expect(caja.querySelector<HTMLElement>(".row")?.hidden).toBe(true);
    expect(caja.querySelector<HTMLAnchorElement>("a")?.hidden).toBe(false);
  });

  it("mientras espera la firma, lo dice", async () => {
    let firmar: (x: string) => void = () => undefined;
    const dep = armar({ billetera: { firmar: () => new Promise<string>((r) => (firmar = r)) } });
    const { caja, form } = abrir(dep);
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Confirmá el pago en tu billetera…"));
    expect(campos(caja).enviar.disabled).toBe(true);
    firmar(XDR_FIRMADO);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Listo, el pago salió."));
  });

  it("si la cuenta ganadora no tiene USDC activado, lo dice sin firmar y ofrece 'Avisarle', que copia un mensaje", async () => {
    const dep = armar({ prep: { ok: false, motivo: "destino-sin-linea" } });
    const { caja, form, terminados } = abrir(dep);
    const { mensaje } = campos(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje.textContent).toBe("La cuenta de Equipo Cohete todavía no puede recibir USDC: no lo activó en su billetera."));
    expect(dep.firmar).not.toHaveBeenCalled();
    expect(dep.mandar).not.toHaveBeenCalled();
    expect(terminados).toHaveLength(0);
    const avisar = botonCon(caja, "Avisarle") as HTMLButtonElement;
    expect(avisar.hidden).toBe(false);
    avisar.click();
    await vi.waitFor(() => expect(mensaje.textContent).toBe("Mensaje copiado. Pegalo donde hables con esa persona."));
    const copiado = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(copiado).toContain("50 USDC");
    expect(copiado).toContain(GANA);
    expect(copiado).not.toMatch(/\{\w+\}/);
  });

  it("sin portapapeles, muestra el mensaje para copiarlo a mano", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const dep = armar({ prep: { ok: false, motivo: "destino-sin-cuenta" } });
    const { caja, form } = abrir(dep);
    enviar(form);
    await vi.waitFor(() => expect((botonCon(caja, "Avisarle") as HTMLButtonElement).hidden).toBe(false));
    (botonCon(caja, "Avisarle") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Copiá este mensaje y mandáselo:"));
    const manual = caja.querySelector("textarea.gan-copia:not(.mono)") as HTMLTextAreaElement;
    expect(manual.hidden).toBe(false);
    expect(manual.value).toContain(GANA);
  });

  it("'Avisarle' no se ofrece cuando el problema es de quien paga", async () => {
    const dep = armar({ prep: { ok: false, motivo: "origen-sin-saldo", saldo: "10.0000000" } });
    const { caja, form } = abrir(dep);
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("La cuenta que paga tiene 10 USDC y el premio es de 50."));
    expect((botonCon(caja, "Avisarle") as HTMLButtonElement).hidden).toBe(true);
  });

  it("si la billetera no firma, lo dice y no manda nada; se puede volver a intentar", async () => {
    const dep = armar({ firma: "rechaza" });
    const { caja, form, terminados } = abrir(dep);
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("No se firmó el pago, así que no se mandó nada."));
    expect(dep.mandar).not.toHaveBeenCalled();
    expect(terminados).toHaveLength(0);
    expect(campos(caja).enviar.hidden).toBe(false);
    expect(campos(caja).enviar.disabled).toBe(false);
  });

  it("si no se sabe si el pago salió, lo dice y vuelve a mirar la red más tarde", async () => {
    const dep = armar({ envio: { ok: false, rechazo: "sin-respuesta", codigos: [] } });
    const { caja, form, terminados } = abrir(dep, { esperaMs: 60_000 });
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toContain("No supimos si el pago salió"));
    expect(terminados).toHaveLength(1);
  });

  it("con una cuenta de Google pide la cuenta que paga y muestra el pago listo para firmar afuera", async () => {
    const dep = armar({ billetera: { direccion: PAGA, firmaAdentro: false } });
    const { caja, form, pagadoras } = abrir(dep);
    await vi.waitFor(() => expect((caja.querySelector(".gan-campo:nth-of-type(2)") as HTMLElement).hidden).toBe(false));
    const { cuenta, mensaje, enviar: boton } = campos(caja);
    expect(cuenta.value).toBe(PAGA);
    expect(boton.textContent).toBe("Armar el pago");
    cuenta.value = OTRA;
    enviar(form);
    await vi.waitFor(() => expect(mensaje.textContent).toContain("entró con Google"));
    const afuera = caja.querySelector("details.gan-afuera") as HTMLDetailsElement;
    expect(afuera.hidden).toBe(false);
    expect(afuera.open).toBe(true);
    expect((afuera.querySelector("textarea") as HTMLTextAreaElement).value).toBe(XDR_ARMADO);
    expect(afuera.querySelector("summary")?.textContent).toBe("El pago listo para firmar");
    expect(dep.preparar.mock.calls[0]?.[0].origen).toBe(OTRA);
    expect(dep.firmar).not.toHaveBeenCalled();
    expect(dep.mandar).not.toHaveBeenCalled();
    // El panel reconoce después el pago de esa cuenta.
    expect(pagadoras.has(OTRA)).toBe(true);
    // Copiar el pago.
    (afuera.querySelector("button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(afuera.querySelector("button")?.textContent).toBe("Copiado"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(XDR_ARMADO);
  });

  it("con Freighter no pregunta la cuenta que paga", async () => {
    const { caja } = abrir(armar());
    await vi.waitFor(() => expect(campos(caja).cuenta.closest("label")?.hidden).toBe(true));
  });

  it("al cambiar de idioma, el formulario y el mensaje cambian", async () => {
    const dep = armar({ prep: { ok: false, motivo: "destino-sin-linea" } });
    const { caja, form } = abrir(dep);
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toContain("todavía no puede recibir USDC"));
    setLang("en");
    expect(campos(caja).mensaje.textContent).toBe("Equipo Cohete's account can't receive USDC yet: it isn't turned on in their wallet.");
    expect(caja.textContent).toContain("Amount in USDC");
    expect(campos(caja).enviar.textContent).toBe("Sign and pay");
    expect(botonCon(caja, "Let them know")).toBeDefined();
  });
});

/* ------------------------------------------------------- un premio se paga una vez */

const PAGADO: LecturaDePago = { tipo: "pagado", hash: HASH, monto: "50.0000000", cuando: DESDE + 60, de: ORG };

/**
 * Una red de mentira con memoria: lo que se manda queda pagado (aunque conteste que no supo), y buscar lo encuentra.
 * Sirve para ver que un premio no se paga dos veces.
 */
function redConMemoria(o: { contesta?: "ok" | "sin-respuesta" } = {}): { armar: () => Armado; mandados: () => number } {
  let pagos = 0;
  const armarUna = (): Armado => {
    const a = armar();
    a.buscar.mockImplementation(async (): Promise<LecturaDePago> => (pagos > 0 ? PAGADO : { tipo: "no-hay" }));
    a.mandar.mockImplementation(async (): Promise<Envio> => {
      pagos++;
      return o.contesta === "sin-respuesta" ? { ok: false, rechazo: "sin-respuesta", codigos: [] } : { ok: true, hash: HASH };
    });
    return a;
  };
  return { armar: armarUna, mandados: () => pagos };
}

describe("antes de armar un pago se mira si el premio ya está pagado", () => {
  it("busca en la red el pago con la nota de ese premio, desde las cuentas que pagan y la que va a pagar", async () => {
    const a = armar();
    await pagarUnPremio(a.deps, { ...PEDIDO, pagadoras: [OTRA] });
    expect(a.buscar).toHaveBeenCalledWith({ red: "testnet", destino: GANA, activo: ACTIVO, nota: "tk:premio:777:2", pagadoras: [OTRA, ORG], desde: DESDE });
    // Primero se mira, después se arma.
    expect(a.buscar.mock.invocationCallOrder[0]).toBeLessThan(a.preparar.mock.invocationCallOrder[0] as number);
  });

  it("si ya tiene su pago, no arma nada, no pide firmar y no manda", async () => {
    const a = armar({ previo: PAGADO });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "ya-pagado", hash: HASH, origen: ORG });
    expect(a.preparar).not.toHaveBeenCalled();
    expect(a.firmar).not.toHaveBeenCalled();
    expect(a.mandar).not.toHaveBeenCalled();
  });

  it("si la red no deja saberlo, no paga a ciegas", async () => {
    const a = armar({ previo: { tipo: "sin-consulta" } });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "sin-consulta" });
    expect(a.preparar).not.toHaveBeenCalled();
    const b = armar({ previo: () => Promise.reject(new Error("se cortó")) });
    expect(await pagarUnPremio(b.deps, PEDIDO)).toEqual({ tipo: "sin-consulta" });
    expect(b.preparar).not.toHaveBeenCalled();
  });

  it("firmando afuera también mira antes: un premio pagado no se vuelve a armar", async () => {
    const a = armar({ billetera: { direccion: PAGA, firmaAdentro: false }, previo: { ...PAGADO, de: PAGA } });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "ya-pagado", hash: HASH, origen: PAGA });
    expect(a.preparar).not.toHaveBeenCalled();
  });
});

describe("si la red no confirma si el pago salió, no se vuelve a ofrecer pagar a ciegas", () => {
  it("el botón queda en pausa; si el pago estaba, pasa a pagado y no se manda otro", async () => {
    const red = redConMemoria({ contesta: "sin-respuesta" });
    const dep = red.armar();
    let mirar: () => void = () => undefined;
    // La consulta de después tarda: mientras tanto el botón no se puede usar.
    dep.buscar.mockImplementationOnce(async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }));
    dep.buscar.mockImplementationOnce(() => new Promise<LecturaDePago>((r) => (mirar = () => r(PAGADO))));
    const { caja, form, terminados } = abrir(dep, { esperaMs: 0 });
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Mirando en la red si el pago salió…"));
    expect(campos(caja).enviar.disabled).toBe(true);
    // Otro Enter u otro toque no arman nada.
    enviar(form);
    enviar(form);
    mirar();
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Listo, el pago salió."));
    expect(campos(caja).enviar.hidden).toBe(true);
    expect((caja.querySelector("a") as HTMLAnchorElement).href).toBe(txUrl(HASH, "testnet"));
    expect(red.mandados()).toBe(1);
    expect(dep.preparar).toHaveBeenCalledTimes(1);
    expect(terminados.length).toBeGreaterThanOrEqual(1);
  });

  it("si la red dice con certeza que el pago no está, vuelve el botón", async () => {
    const dep = armar({ envio: { ok: false, rechazo: "sin-respuesta", codigos: [] } });
    const { caja, form } = abrir(dep, { esperaMs: 0 });
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Miramos en la red y ese pago no está. Podés volver a intentarlo."));
    expect(campos(caja).enviar.disabled).toBe(false);
    expect(campos(caja).enviar.hidden).toBe(false);
  });

  it("si la red no contesta, sigue en pausa, lo explica y deja volver a mirar", async () => {
    const dep = armar({ envio: { ok: false, rechazo: "sin-respuesta", codigos: [] } });
    const respuestas: LecturaDePago[] = [{ tipo: "no-hay" }, { tipo: "sin-consulta" }, { tipo: "no-hay" }];
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => respuestas.shift() ?? { tipo: "sin-consulta" });
    const { caja, form } = abrir(dep, { esperaMs: 0 });
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toContain("Todavía no pudimos mirar en la red si el pago salió"));
    // Es texto plano: sin decir que es un botón, Volver a mirar se lee como parte de la frase.
    expect(campos(caja).mensaje.textContent).toContain("En un momento, tocá el botón Volver a mirar.");
    expect(campos(caja).mensaje.classList.contains("bad")).toBe(true);
    expect(campos(caja).enviar.disabled).toBe(true);
    const volver = botonCon(caja, "Volver a mirar") as HTMLButtonElement;
    expect(volver.hidden).toBe(false);
    // Con el botón en pausa, mandar el formulario no hace nada.
    enviar(form);
    await Promise.resolve();
    expect(dep.preparar).toHaveBeenCalledTimes(1);
    volver.click();
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Miramos en la red y ese pago no está. Podés volver a intentarlo."));
    expect(campos(caja).enviar.disabled).toBe(false);
    expect(volver.hidden).toBe(true);
    expect(dep.mandar).toHaveBeenCalledTimes(1);
  });

  it("cerrar y volver a abrir el formulario no devuelve el botón: se ve el mismo, en pausa", async () => {
    const dep = armar({ envio: { ok: false, rechazo: "sin-respuesta", codigos: [] } });
    const caja = document.createElement("div");
    document.body.append(caja);
    const pagar = pagarPremioEn({
      red: "testnet",
      raffleId: "777",
      premio: "50 USDC",
      activo: ACTIVO,
      pagadoras: new Set([ORG]),
      desde: DESDE,
      esperaMs: 60_000,
      dependencias: async () => dep.deps,
    });
    pagar(FILA, caja, () => undefined);
    enviar(caja.querySelector("form") as HTMLFormElement);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toContain("No supimos si el pago salió"));
    pagar(FILA, caja, () => undefined);
    expect(caja.childElementCount).toBe(0);
    pagar(FILA, caja, () => undefined);
    expect(campos(caja).mensaje.textContent).toContain("No supimos si el pago salió");
    expect(campos(caja).enviar.disabled).toBe(true);
    enviar(caja.querySelector("form") as HTMLFormElement);
    await Promise.resolve();
    expect(dep.preparar).toHaveBeenCalledTimes(1);
    expect(dep.mandar).toHaveBeenCalledTimes(1);
  });

  it("un toque doble manda un solo pago", async () => {
    const red = redConMemoria();
    const dep = red.armar();
    const { caja, form } = abrir(dep);
    enviar(form);
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Listo, el pago salió."));
    expect(red.mandados()).toBe(1);
    expect(dep.buscar).toHaveBeenCalledTimes(1);
  });
});

describe("el premio pagado desde otra parte", () => {
  it("con la página recargada justo después de pagar: 'Firmar y pagar' encuentra el pago y no arma otro", async () => {
    const red = redConMemoria();
    const antes = red.armar();
    const a = abrir(antes);
    enviar(a.form);
    await vi.waitFor(() => expect(campos(a.caja).mensaje.textContent).toBe("Listo, el pago salió."));
    // La página nueva no sabe nada del pago: el panel todavía lo puede mostrar pendiente.
    document.body.replaceChildren();
    const despues = red.armar();
    const b = abrir(despues);
    enviar(b.form);
    await vi.waitFor(() => expect(campos(b.caja).mensaje.textContent).toBe("Este premio ya está pagado, así que no hace falta pagarlo de nuevo."));
    expect(campos(b.caja).mensaje.classList.contains("bad")).toBe(false);
    expect(campos(b.caja).enviar.hidden).toBe(true);
    expect((b.caja.querySelector("a") as HTMLAnchorElement).hidden).toBe(false);
    expect(b.terminados).toHaveLength(1);
    expect(despues.firmar).not.toHaveBeenCalled();
    expect(red.mandados()).toBe(1);
  });

  it("con dos pestañas abiertas, la segunda no paga lo que pagó la primera", async () => {
    const red = redConMemoria();
    const una = abrir(red.armar());
    const otra = abrir(red.armar());
    enviar(una.form);
    await vi.waitFor(() => expect(campos(una.caja).mensaje.textContent).toBe("Listo, el pago salió."));
    enviar(otra.form);
    await vi.waitFor(() => expect(campos(otra.caja).mensaje.textContent).toBe("Este premio ya está pagado, así que no hace falta pagarlo de nuevo."));
    expect(red.mandados()).toBe(1);
  });

  it("si no se puede mirar antes, lo dice, no arma nada y deja volver a probar", async () => {
    const dep = armar({ previo: { tipo: "sin-consulta" } });
    const { caja, form } = abrir(dep);
    enviar(form);
    await vi.waitFor(() =>
      expect(campos(caja).mensaje.textContent).toBe("No pudimos mirar en la red si este premio ya está pagado, así que no armamos el pago. Probá otra vez en un momento."),
    );
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(campos(caja).enviar.disabled).toBe(false);
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }));
    enviar(form);
    await vi.waitFor(() => expect(campos(caja).mensaje.textContent).toBe("Listo, el pago salió."));
    expect(dep.buscar).toHaveBeenCalledTimes(2);
  });

  it("en inglés, los avisos nuevos también", async () => {
    const dep = armar({ envio: { ok: false, rechazo: "sin-respuesta", codigos: [] } });
    const respuestas: LecturaDePago[] = [{ tipo: "no-hay" }, { tipo: "sin-consulta" }];
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => respuestas.shift() ?? { tipo: "sin-consulta" });
    const { caja, form } = abrir(dep, { esperaMs: 0 });
    enviar(form);
    await vi.waitFor(() => expect(botonCon(caja, "Volver a mirar")?.hidden).toBe(false));
    setLang("en");
    expect(campos(caja).mensaje.textContent).toBe("We still couldn't check the network for the payment. So it isn't paid twice, the button stays paused. In a moment, tap the Check again button.");
    expect(botonCon(caja, "Check again")).toBeDefined();
  });
});
