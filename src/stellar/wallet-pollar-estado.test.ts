import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSPHRASE_TESTNET, almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * Cómo está la cuenta de la red principal (N5 del diseño de «Dejá tu cuenta lista»): si falta activarla, si falta
 * protegerla o confirmar este navegador, qué se guarda en memoria y quién avisa un cambio. Con el cliente simulado
 * (`pollar-falso.ts`). Y lo que no cambia: en modo Prueba nada de esto arma el cliente ni pregunta nada.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, puedeUsarDesbloqueo, CANAL_DE_LA_CUENTA } = await import("./wallet-pollar");

const P = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const LLAVE = "02aa11";
const OTRA_LLAVE = "03bb22";
const pedidoDeCrear = { id: "pedido-1", kind: "TX", network: "STELLAR", status: "PENDING", intent: "account_create", operation: "create_account", account: P, signWith: P };
const recuperacion = (o: { required?: boolean; configured?: boolean; llaves?: string[]; passkeys?: number; correo?: boolean } = {}) => ({
  required: o.required ?? true,
  configured: o.configured ?? false,
  subOrgId: "sub-org",
  email: { address: o.correo ? "ana@ejemplo.com" : null, verified: !!o.correo },
  passkeys: Array.from({ length: o.passkeys ?? 0 }, (_, i) => ({ authenticatorId: `a${i}`, credentialId: `c${i}`, name: "Tinkazo", createdAt: "" })),
  devices: (o.llaves ?? [LLAVE]).map((publicKey, i) => ({ apiKeyId: `k${i}`, name: "navegador", publicKey, createdAt: "" })),
});

beforeEach(() => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
  pollarWallet.address = P;
  h.impl.pending = async () => [pedidoDeCrear];
  h.impl["recovery.status"] = async () => recuperacion();
  h.impl.publicKeyHex = async () => LLAVE;
});

afterEach(async () => {
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la activación", () => {
  it("creándose y con el pedido de crear esta cuenta: falta", async () => {
    expect((await pollarWallet.estadoOficial()).activacion).toBe("falta");
  });

  it("creándose y sin pedido: se está preparando", async () => {
    h.impl.pending = async () => [];
    expect((await pollarWallet.estadoOficial()).activacion).toBe("preparando");
  });

  it("lista aunque haya un pedido pendiente: lo que dice la cuenta gana siempre", async () => {
    h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
    expect((await pollarWallet.estadoOficial()).activacion).toBe("lista");
  });

  it("existe en la red aunque el kit no diga READY: lista", async () => {
    h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: true };
    expect((await pollarWallet.estadoOficial()).activacion).toBe("lista");
  });

  it("FAILED: no salió", async () => {
    h.billetera = { address: P, provisioning: "FAILED", existsOnStellar: false };
    expect((await pollarWallet.estadoOficial()).activacion).toBe("fallo");
  });

  it("sin red y lo local creándose: no se sabe", async () => {
    h.impl.pending = async () => {
      throw new Error("Failed to fetch");
    };
    expect((await pollarWallet.estadoOficial()).activacion).toBe("no-se-sabe");
  });

  it("con fresco pregunta a Pollar dónde está la cuenta; sin fresco usa lo que el kit ya sabe", async () => {
    await pollarWallet.estadoOficial();
    expect(h.llamadas).toContain("refreshWalletState");
    h.llamadas = [];
    await pollarWallet.estadoOficial(false);
    expect(h.llamadas).not.toContain("refreshWalletState");
    expect(h.llamadas).toContain("pending");
  });
});

describe("la protección", () => {
  it("pedida, sin forma de recuperarla y este navegador en la cuenta (la cuenta nueva): falta", async () => {
    const e = await pollarWallet.estadoOficial();
    expect(e.proteccion).toBe("falta");
    expect(e.unicoNavegador).toBe(true);
  });

  it("protegida y este navegador no está: hay que confirmar que es la persona", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ configured: true, llaves: [OTRA_LLAVE], passkeys: 1, correo: true });
    const e = await pollarWallet.estadoOficial();
    expect(e.proteccion).toBe("aparato-nuevo");
    expect(e.correoConfirmado).toBe(true);
    expect(e.tieneLlaves).toBe(true);
    expect(e.unicoNavegador).toBe(false);
  });

  it("sin protección y este navegador no está: no hay forma desde acá", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ llaves: [OTRA_LLAVE] });
    expect((await pollarWallet.estadoOficial()).proteccion).toBe("sin-forma");
  });

  it("protegida y este navegador en la cuenta: lista", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ configured: true, llaves: [OTRA_LLAVE, LLAVE] });
    const e = await pollarWallet.estadoOficial();
    expect(e.proteccion).toBe("lista");
  });

  it("la cuenta no pide protección: lista", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ required: false, llaves: [] });
    expect((await pollarWallet.estadoOficial()).proteccion).toBe("lista");
  });

  it("la llave de este navegador se compara sin importar mayúsculas", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ configured: true, llaves: [LLAVE.toUpperCase()] });
    expect((await pollarWallet.estadoOficial()).proteccion).toBe("lista");
  });

  it("si Pollar no contesta: no se sabe", async () => {
    h.impl["recovery.status"] = async () => {
      throw new Error("Failed to fetch");
    };
    expect((await pollarWallet.estadoOficial()).proteccion).toBe("no-se-sabe");
  });
});

describe("la memoria", () => {
  beforeEach(() => {
    h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
    h.impl["recovery.status"] = async () => recuperacion({ configured: true });
  });

  it("lo que dio lista no se vuelve a preguntar", async () => {
    expect(await pollarWallet.estadoOficial()).toMatchObject({ activacion: "lista", proteccion: "lista" });
    h.llamadas = [];
    expect(await pollarWallet.estadoOficial()).toMatchObject({ activacion: "lista", proteccion: "lista" });
    expect(h.llamadas.filter((n) => ["refreshWalletState", "pending", "recovery.status", "publicKeyHex"].includes(n))).toEqual([]);
  });

  it("lo que falta sí se vuelve a preguntar", async () => {
    h.impl["recovery.status"] = async () => recuperacion();
    await pollarWallet.estadoOficial();
    h.llamadas = [];
    await pollarWallet.estadoOficial();
    expect(h.llamadas).toContain("recovery.status");
    expect(h.llamadas).not.toContain("pending");
  });

  it("estadoOficialLocal no usa la red: lo local y la memoria", async () => {
    h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
    h.impl["recovery.status"] = async () => recuperacion();
    await pollarWallet.estadoOficial();
    h.llamadas = [];
    expect(pollarWallet.estadoOficialLocal()).toEqual({ activacion: "falta", proteccion: "no-se-sabe" });
    h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
    h.impl["recovery.status"] = async () => recuperacion({ configured: true });
    await pollarWallet.estadoOficial();
    h.llamadas = [];
    expect(pollarWallet.estadoOficialLocal()).toEqual({ activacion: "lista", proteccion: "lista" });
    expect(h.llamadas).toEqual([]);
  });

  it.each(["NONE", "FAILED"] as const)("estadoOficialLocal con %s no dice que falte activar: eso lo aclara la lectura con red", async (p) => {
    h.billetera = { address: P, provisioning: p, existsOnStellar: false };
    await pollarWallet.estadoOficial();
    expect(pollarWallet.estadoOficialLocal().activacion).toBe("no-se-sabe");
  });

  it("sin cliente armado, lo local no sabe nada", () => {
    expect(pollarWallet.estadoOficialLocal()).toEqual({ activacion: "no-se-sabe", proteccion: "no-se-sabe" });
  });

  it("cerrar sesión lo olvida", async () => {
    await pollarWallet.estadoOficial();
    await pollarWallet.disconnect();
    pollarWallet.address = P;
    h.llamadas = [];
    await pollarWallet.estadoOficial();
    expect(h.llamadas).toContain("recovery.status");
  });

  it("otra dirección empieza de cero", async () => {
    await pollarWallet.estadoOficial();
    const Q = P.replace("5ZLE", "6ZLE");
    h.billetera = { address: Q, provisioning: "CREATING", existsOnStellar: false };
    pollarWallet.address = Q;
    h.impl.pending = async () => [];
    h.llamadas = [];
    expect((await pollarWallet.estadoOficial()).activacion).toBe("preparando");
    expect(h.llamadas).toContain("recovery.status");
  });

  it("la dirección de la sesión no es la del kit: no se sabe nada", async () => {
    pollarWallet.address = P.replace("5ZLE", "6ZLE");
    expect(await pollarWallet.estadoOficial()).toMatchObject({ activacion: "no-se-sabe", proteccion: "no-se-sabe" });
  });
});

describe("los avisos de cambio", () => {
  it("el aviso del canal llama al cb, y el mensaje no trae la dirección", async () => {
    const cb = vi.fn();
    const soltar = pollarWallet.alCambiarLaCuenta(cb);
    await vi.waitFor(() => expect(h.oyentes.billetera.size).toBe(1));
    cb.mockClear();
    const otra = new BroadcastChannel(CANAL_DE_LA_CUENTA);
    const recibido: unknown[] = [];
    otra.onmessage = (ev: MessageEvent) => recibido.push(ev.data);
    const emisor = new BroadcastChannel(CANAL_DE_LA_CUENTA);
    emisor.postMessage({ tipo: "cambio" });
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    emisor.close();
    // Lo que manda la billetera cuando algo cambia: solo el tipo.
    const { avisarCambioDeLaCuenta } = await import("./wallet-pollar");
    avisarCambioDeLaCuenta();
    await vi.waitFor(() => expect(recibido.length).toBeGreaterThanOrEqual(2));
    for (const m of recibido) expect(m).toEqual({ tipo: "cambio" });
    expect(JSON.stringify(recibido)).not.toContain(P);
    otra.close();
    soltar();
  });

  it("un cambio de la billetera o de la co-firma llama al cb, y soltar corta todo", async () => {
    const cb = vi.fn();
    const soltar = pollarWallet.alCambiarLaCuenta(cb);
    await vi.waitFor(() => expect(h.oyentes.cofirma.size).toBe(1));
    cb.mockClear();
    for (const o of h.oyentes.billetera) o("READY");
    for (const o of h.oyentes.cofirma) o({ pending: [pedidoDeCrear] });
    expect(cb).toHaveBeenCalledTimes(2);
    soltar();
    expect(h.oyentes.billetera.size).toBe(0);
    expect(h.oyentes.cofirma.size).toBe(0);
  });

  it("la co-firma avisa solo si cambiaron los pedidos: el eco del kit al leer los pendientes no cuenta", async () => {
    const cb = vi.fn();
    const soltar = pollarWallet.alCambiarLaCuenta(cb);
    await vi.waitFor(() => expect(h.oyentes.cofirma.size).toBe(1));
    cb.mockClear();
    const cofirma = (s: unknown): void => {
      for (const o of h.oyentes.cofirma) o(s);
    };
    cofirma({ pending: [pedidoDeCrear] });
    expect(cb).toHaveBeenCalledTimes(1);
    // Lo mismo otra vez, en otro objeto: es lo que hace el kit con cada lectura.
    cofirma({ pending: [{ ...pedidoDeCrear }] });
    cofirma({ pending: [{ ...pedidoDeCrear }] });
    expect(cb).toHaveBeenCalledTimes(1);
    // Cambió de verdad: votado (con su actividad), resuelto y otro pedido.
    cofirma({ pending: [{ ...pedidoDeCrear, activityId: "act-1" }] });
    cofirma({ pending: [], lastResolved: { ...pedidoDeCrear, status: "APPROVED" } });
    cofirma({ pending: [{ ...pedidoDeCrear, id: "pedido-2" }], lastResolved: { ...pedidoDeCrear, status: "APPROVED" } });
    expect(cb).toHaveBeenCalledTimes(4);
    soltar();
  });

  it("leer el estado con el pedido pendiente no dispara otra lectura: el aviso no se vuelve un bucle", async () => {
    vi.useFakeTimers();
    try {
      let releer: ReturnType<typeof setTimeout> | null = null;
      // Lo mismo que hace el paso: cada aviso, una lectura a los 300 ms.
      const soltar = pollarWallet.alCambiarLaCuenta(() => {
        if (releer) return;
        releer = setTimeout(() => {
          releer = null;
          void pollarWallet.estadoOficial(true);
        }, 300);
      });
      await pollarWallet.estadoOficial(true);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.llamadas.filter((n) => n === "pending").length).toBeLessThanOrEqual(2);
      soltar();
    } finally {
      vi.useRealTimers();
    }
  });

  it("firmaDeLaCofirma: el orden de los pedidos no importa, y lo que no tiene forma no rompe", async () => {
    const { firmaDeLaCofirma } = await import("./wallet-pollar");
    const a = { id: "a", status: "PENDING" };
    const b = { id: "b", status: "PENDING", activityId: "x" };
    expect(firmaDeLaCofirma({ pending: [a, b] })).toBe(firmaDeLaCofirma({ pending: [b, a] }));
    expect(firmaDeLaCofirma({ pending: [a] })).not.toBe(firmaDeLaCofirma({ pending: [a], lastResolved: { id: "c", status: "APPROVED" } }));
    for (const raro of [null, undefined, 3, "x", {}, { pending: null }, { pending: [null, 1] }]) expect(typeof firmaDeLaCofirma(raro)).toBe("string");
  });

  it("los avisos solo llaman al cb: nunca votan ni piden nada", async () => {
    const soltar = pollarWallet.alCambiarLaCuenta(() => undefined);
    await vi.waitFor(() => expect(h.oyentes.cofirma.size).toBe(1));
    for (const o of h.oyentes.billetera) o("CREATING");
    for (const o of h.oyentes.cofirma) o({ pending: [pedidoDeCrear] });
    expect(h.llamadas.filter((n) => ["relay", "verify", "refresh", "approve"].includes(n))).toEqual([]);
    soltar();
  });
});

describe("la sesión y el desbloqueo", () => {
  it("sesionViva sigue a la sesión del kit", async () => {
    await pollarWallet.estadoOficial();
    expect(pollarWallet.sesionViva()).toBe(true);
    h.paso = "idle";
    expect(pollarWallet.sesionViva()).toBe(false);
  });

  const conNavegador = (ua: string, disponible: () => Promise<boolean>) => {
    vi.stubGlobal("window", { PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: disponible } });
    vi.stubGlobal("navigator", { userAgent: ua, credentials: { create: () => undefined, get: () => undefined } });
  };

  it("con huella o clave del celular disponible: sí", async () => {
    conNavegador("Mozilla/5.0 (Linux; Android 14) Chrome/130", async () => true);
    await expect(puedeUsarDesbloqueo()).resolves.toBe(true);
  });

  it("sin desbloqueo en este navegador: no", async () => {
    conNavegador("Mozilla/5.0 Chrome/130", async () => false);
    await expect(puedeUsarDesbloqueo()).resolves.toBe(false);
  });

  it("en el navegador de una aplicación (Instagram): no", async () => {
    conNavegador("Mozilla/5.0 (iPhone) Instagram 300.0", async () => true);
    await expect(puedeUsarDesbloqueo()).resolves.toBe(false);
  });

  it("si el navegador no contesta a tiempo: no", async () => {
    conNavegador("Mozilla/5.0 Chrome/130", () => new Promise<boolean>(() => undefined));
    await expect(puedeUsarDesbloqueo(30)).resolves.toBe(false);
  });

  it("sin llaves de acceso en el navegador: no", async () => {
    await expect(puedeUsarDesbloqueo()).resolves.toBe(false);
  });
});

// Vale con y sin contrato en la red principal: el modo sale de la red que se le pone acá, no de la lista de contratos.
describe("en modo Prueba y con billetera propia, nada cambia", () => {
  beforeEach(() => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.redDelCliente = "testnet";
  });

  it("el estado dice todo listo sin armar el cliente ni preguntar nada", async () => {
    expect(await pollarWallet.estadoOficial()).toMatchObject({ activacion: "lista", proteccion: "lista" });
    expect(pollarWallet.estadoOficialLocal()).toEqual({ activacion: "lista", proteccion: "lista" });
    expect(h.construidos).toBe(0);
    expect(h.llamadas).toEqual([]);
  });

  it("activar no arma el cliente y no vota", async () => {
    await expect(pollarWallet.activarCuenta()).rejects.toThrow("pollar-sin-cuenta");
    expect(h.construidos).toBe(0);
    expect(h.llamadas).toEqual([]);
  });

  it("los avisos no arman el cliente", () => {
    const soltar = pollarWallet.alCambiarLaCuenta(() => undefined);
    soltar();
    expect(h.construidos).toBe(0);
  });

  it("cerrar sesión no toca los navegadores de la cuenta", async () => {
    await pollarWallet.signAndSubmit("XDR-DEL-SELLO");
    await pollarWallet.disconnect();
    expect(h.llamadas.filter((n) => n === "devices" || n === "revokeDevice")).toEqual([]);
    expect(h.llamadas).toContain("logout");
  });
});
