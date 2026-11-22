import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSPHRASE_TESTNET, almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * La cuenta vista desde el celular de quien participa (`cuentaDelCelular` y `clasificarParaElCelular`): una lectura liviana
 * que solo mira, nunca vota, y que dice la verdad sobre lo que no sabe. Con el cliente simulado (`pollar-falso.ts`).
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, clasificarParaElCelular, esLimiteDelServicio } = await import("./wallet-pollar");

const P = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const TOKEN = "eyJ0b2tlbi1kZS1wcnVlYmEtbm8tZXMtcmVhbA.parte-dos.parte-tres";
const LLAVE = "02aa11";
const OTRA_LLAVE = "03bb22";
const MAIL = "ana@ejemplo.com";

interface Datos {
  required?: boolean;
  configured?: boolean;
  subOrgId?: string | null;
  llaves?: string[];
  passkeys?: number;
  correo?: string | null;
  verificado?: boolean;
}
const recuperacion = (o: Datos = {}) => ({
  required: o.required ?? true,
  configured: o.configured ?? false,
  subOrgId: o.subOrgId === undefined ? "sub-org" : o.subOrgId,
  endUserId: "usuario",
  authProxyConfigId: "config",
  email: { address: o.correo ?? null, verified: o.verificado ?? o.correo != null },
  passkeys: Array.from({ length: o.passkeys ?? 0 }, (_, i) => ({ authenticatorId: `a${i}`, credentialId: `c${i}`, name: "Tinkazo", createdAt: "" })),
  devices: (o.llaves ?? [LLAVE]).map((publicKey, i) => ({ apiKeyId: `k${i}`, name: "navegador", publicKey, createdAt: "" })),
});

/** Los métodos del kit que tocan una firma, un voto o un aparato: la lectura del celular no puede llamar a ninguno. */
const PROHIBIDOS = ["approve", "reject", "cancel", "relay", "settle", "revokeDevice", "recovery.addPasskey", "recovery.startEmail", "recovery.confirmEmail", "recovery.startEmailRecovery", "recovery.recoverWithPasskey", "recovery.recoverWithEmailCode", "signAndSubmitTx", "signTx"];

beforeEach(async () => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  h.verificada = true;
  h.token = TOKEN;
  pollarWallet.address = P;
  h.impl.publicKeyHex = async () => LLAVE;
  vi.spyOn(pollarWallet, "profile").mockReturnValue({ name: "Ana", mail: MAIL, avatar: "" });
  // Arma el cliente, como al entrar con Google, con una cuenta que todavía no está protegida en este navegador:
  // la memoria del paso de la cuenta empieza vacía.
  h.impl["recovery.status"] = async () => recuperacion({ llaves: [OTRA_LLAVE] });
  await pollarWallet.estadoOficial(false);
  h.impl["recovery.status"] = async () => recuperacion({ configured: true, correo: MAIL });
  h.llamadas = [];
});

afterEach(async () => {
  vi.useRealTimers();
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clasificarParaElCelular, la función pura", () => {
  it("sin respuesta del servicio no se sabe", () => {
    expect(clasificarParaElCelular(null, LLAVE, "READY", MAIL).estado).toBe("no-se-sabe");
  });

  it("este navegador es de la cuenta y el correo está confirmado: lista", () => {
    const l = clasificarParaElCelular(recuperacion({ configured: true, correo: MAIL }), LLAVE, "READY", MAIL);
    expect(l).toMatchObject({ estado: "lista", protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true, correoTapado: "a•••@ejemplo.com", limite: false });
  });

  it("este navegador es de la cuenta y no hay correo confirmado: falta, protegida o no", () => {
    expect(clasificarParaElCelular(recuperacion(), LLAVE, "READY", MAIL)).toMatchObject({ estado: "falta", protegida: false });
    expect(clasificarParaElCelular(recuperacion({ configured: true, passkeys: 1 }), LLAVE, "READY", MAIL)).toMatchObject({ estado: "falta", protegida: true });
  });

  it("este navegador no es de la cuenta y el correo está confirmado: entra con un código", () => {
    expect(clasificarParaElCelular(recuperacion({ llaves: [OTRA_LLAVE], correo: MAIL, configured: true }), LLAVE, "READY", MAIL).estado).toBe("otro-con-correo");
  });

  it("este navegador no es de la cuenta y solo hay desbloqueo: otro-con-desbloqueo", () => {
    expect(clasificarParaElCelular(recuperacion({ llaves: [OTRA_LLAVE], configured: true, passkeys: 1 }), LLAVE, "READY", MAIL).estado).toBe("otro-con-desbloqueo");
  });

  it("este navegador no es de la cuenta, sin correo ni desbloqueo: sin-forma, y solo con aparatos en la lista", () => {
    expect(clasificarParaElCelular(recuperacion({ llaves: [OTRA_LLAVE] }), LLAVE, "READY", MAIL).estado).toBe("sin-forma");
    // Protegida pero sin llaves de acceso: tampoco hay forma desde acá.
    expect(clasificarParaElCelular(recuperacion({ llaves: [OTRA_LLAVE], configured: true, passkeys: 0 }), LLAVE, "READY", MAIL).estado).toBe("sin-forma");
  });

  it("los aparatos vacíos son una cuenta naciendo, nunca sin-forma", () => {
    expect(clasificarParaElCelular(recuperacion({ llaves: [] }), LLAVE, "READY", MAIL).estado).toBe("naciendo");
    expect(clasificarParaElCelular(recuperacion({ llaves: [], configured: true, passkeys: 1 }), LLAVE, "READY", MAIL).estado).toBe("naciendo");
  });

  it("sin organización de la billetera todavía: naciendo", () => {
    expect(clasificarParaElCelular(recuperacion({ subOrgId: null }), LLAVE, "READY", MAIL).estado).toBe("naciendo");
  });

  it("required falso mientras la billetera se crea, falta o no existe: naciendo, no lista", () => {
    for (const prov of ["CREATING", "NONE", null, undefined]) {
      expect(clasificarParaElCelular(recuperacion({ required: false }), LLAVE, prov, MAIL).estado, String(prov)).toBe("naciendo");
    }
  });

  it("required falso con la billetera creada: lista. Con la creación fallada: no se sabe", () => {
    expect(clasificarParaElCelular(recuperacion({ required: false }), LLAVE, "READY", MAIL).estado).toBe("lista");
    expect(clasificarParaElCelular(recuperacion({ required: false }), LLAVE, "FAILED", MAIL).estado).toBe("no-se-sabe");
  });

  it("sin la llave de este navegador no se sabe", () => {
    expect(clasificarParaElCelular(recuperacion(), null, "READY", MAIL).estado).toBe("no-se-sabe");
  });

  it("el correo confirmado de otra dirección no es el de la sesión, pero igual deja entrar con un código", () => {
    const l = clasificarParaElCelular(recuperacion({ llaves: [OTRA_LLAVE], correo: "otra@ejemplo.com" }), LLAVE, "READY", MAIL);
    expect(l.estado).toBe("otro-con-correo");
    expect(l.correoDeLaSesionConfirmado).toBe(false);
  });

  it("el correo de la sesión se compara sin mayúsculas ni espacios", () => {
    const l = clasificarParaElCelular(recuperacion({ correo: "Ana@Ejemplo.com" }), LLAVE, "READY", "  ana@ejemplo.COM ");
    expect(l.correoDeLaSesionConfirmado).toBe(true);
  });

  it("un correo sin verificar no cuenta como confirmado", () => {
    const l = clasificarParaElCelular(recuperacion({ correo: MAIL, verificado: false }), LLAVE, "READY", MAIL);
    expect(l.estado).toBe("falta");
    expect(l.correoDeLaSesionConfirmado).toBe(false);
  });

  it("sin correo en el perfil no se puede mandar el código y no hay correo para mostrar", () => {
    const l = clasificarParaElCelular(recuperacion(), LLAVE, "READY", null);
    expect(l.puedeMandar).toBe(false);
    expect(l.correoTapado).toBeNull();
  });

  it("sin la configuración del servicio de cuentas no se puede mandar el código", () => {
    const s = { ...recuperacion(), authProxyConfigId: null };
    expect(clasificarParaElCelular(s, LLAVE, "READY", MAIL).puedeMandar).toBe(false);
  });

  it("el correo nunca sale entero", () => {
    const l = clasificarParaElCelular(recuperacion(), LLAVE, "READY", MAIL);
    expect(JSON.stringify(l)).not.toContain(MAIL);
  });

  it("un perfil con un correo que no es un correo no se muestra", () => {
    expect(clasificarParaElCelular(recuperacion(), LLAVE, "READY", "ana").correoTapado).toBeNull();
  });
});

describe("esLimiteDelServicio", () => {
  it("lo reconoce por el código, por el cuerpo o por el estado 429", () => {
    expect(esLimiteDelServicio({ code: "RATE_LIMITED" })).toBe(true);
    expect(esLimiteDelServicio({ code: "SDK_COSIGN_UPSTREAM_ERROR", body: { code: "RATE_LIMITED" } })).toBe(true);
    expect(esLimiteDelServicio({ body: { message: "Too Many Requests" } })).toBe(true);
    expect(esLimiteDelServicio({ code: "SDK_COSIGN_TURNKEY_REJECTED", body: { turnkeyStatus: 429 } })).toBe(true);
    expect(esLimiteDelServicio({ status: 429 })).toBe(true);
  });

  it("otros errores no son límite", () => {
    expect(esLimiteDelServicio(new Error("tope"))).toBe(false);
    expect(esLimiteDelServicio({ code: "SDK_COSIGN_UPSTREAM_ERROR", body: { status: 500 } })).toBe(false);
    expect(esLimiteDelServicio(null)).toBe(false);
    expect(esLimiteDelServicio("RATE_LIMITED")).toBe(false);
  });
});

describe("cuentaDelCelular, la lectura con el cliente simulado", () => {
  it("una cuenta de este navegador con correo confirmado está lista, con un solo pedido a recuperación", async () => {
    const l = await pollarWallet.cuentaDelCelular();
    expect(l.estado).toBe("lista");
    expect(h.llamadas.filter((n) => n === "recovery.status")).toHaveLength(1);
  });

  it("con una cuenta esperada, la sesión de otra cuenta no se lee ni se le atribuye", async () => {
    const otra = P.replace("5ZLE", "6ZLE");
    const l = await pollarWallet.cuentaDelCelular(undefined, otra);
    expect(l).toMatchObject({ estado: "no-se-sabe", correoTapado: null, puedeMandar: false });
    expect(h.llamadas.filter((n) => n === "recovery.status")).toHaveLength(0);
    // Con la cuenta de la sesión lee como siempre, y sin decir cuál se espera también.
    expect((await pollarWallet.cuentaDelCelular(undefined, P)).estado).toBe("lista");
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("lista");
  });

  it("solo lee: ningún método de firma, voto o aparato", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ llaves: [OTRA_LLAVE] });
    await pollarWallet.cuentaDelCelular();
    h.impl["recovery.status"] = async () => recuperacion();
    await pollarWallet.cuentaDelCelular();
    expect(h.llamadas.filter((n) => PROHIBIDOS.includes(n))).toEqual([]);
    expect(new Set(h.llamadas)).toEqual(new Set(["recovery.status", "publicKeyHex"]));
  });

  it("required falso con la billetera creándose da naciendo y no deja la protección en memoria", async () => {
    h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
    h.impl["recovery.status"] = async () => recuperacion({ required: false });
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("naciendo");
    // La memoria no dice que está protegida: el paso Dejá tu cuenta lista vuelve a preguntar.
    h.impl["recovery.status"] = async () => recuperacion({ llaves: [OTRA_LLAVE] });
    h.llamadas = [];
    await pollarWallet.estadoOficial(false);
    expect(h.llamadas).toContain("recovery.status");
  });

  it("aparatos vacíos da naciendo y tampoco deja memoria", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ llaves: [], configured: true, passkeys: 1 });
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("naciendo");
    h.llamadas = [];
    await pollarWallet.estadoOficial(false);
    expect(h.llamadas).toContain("recovery.status");
  });

  it("protegida en este navegador deja la memoria: el paso de la cuenta no vuelve a preguntar", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ configured: true, passkeys: 1 });
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("falta");
    h.llamadas = [];
    const e = await pollarWallet.estadoOficial(false);
    expect(h.llamadas).not.toContain("recovery.status");
    expect(e.proteccion).toBe("lista");
  });

  it("sin protección o en otro navegador no deja memoria", async () => {
    h.impl["recovery.status"] = async () => recuperacion();
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("falta");
    h.impl["recovery.status"] = async () => recuperacion({ llaves: [OTRA_LLAVE], configured: true, passkeys: 1 });
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("otro-con-desbloqueo");
    h.llamadas = [];
    await pollarWallet.estadoOficial(false);
    expect(h.llamadas).toContain("recovery.status");
  });

  it("este navegador fuera de la cuenta y sin forma de entrar: sin-forma", async () => {
    h.impl["recovery.status"] = async () => recuperacion({ llaves: [OTRA_LLAVE] });
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("sin-forma");
  });

  it("sin la sesión verificada espera el token y, si no llega, no se sabe y no pregunta nada", async () => {
    vi.useFakeTimers();
    h.verificada = false;
    const lectura = pollarWallet.cuentaDelCelular(2_000);
    await vi.advanceTimersByTimeAsync(2_001);
    expect((await lectura).estado).toBe("no-se-sabe");
    expect(h.llamadas).not.toContain("recovery.status");
  });

  it("la sesión que se verifica mientras espera deja leer", async () => {
    vi.useFakeTimers();
    h.verificada = false;
    const lectura = pollarWallet.cuentaDelCelular(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const { emitirSesion } = await import("./pollar-falso");
    emitirSesion(h, { verificada: true });
    expect((await lectura).estado).toBe("lista");
  });

  it("sin la dirección de la cuenta no se sabe", async () => {
    pollarWallet.address = "";
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("no-se-sabe");
    expect(h.llamadas).toEqual([]);
  });

  it("si el pedido falla no se sabe y no lanza", async () => {
    h.impl["recovery.status"] = async () => {
      throw new Error("sin red");
    };
    expect(await pollarWallet.cuentaDelCelular()).toMatchObject({ estado: "no-se-sabe", limite: false });
  });

  it("si el servicio frena el pedido por límite lo dice", async () => {
    h.impl["recovery.status"] = async () => {
      throw Object.assign(new Error("SDK_COSIGN_UPSTREAM_ERROR"), { code: "SDK_COSIGN_UPSTREAM_ERROR", body: { code: "RATE_LIMITED" } });
    };
    expect(await pollarWallet.cuentaDelCelular()).toMatchObject({ estado: "no-se-sabe", limite: true });
  });

  it("un pedido que no contesta termina en el tope", async () => {
    vi.useFakeTimers();
    h.impl["recovery.status"] = () => new Promise(() => undefined);
    const lectura = pollarWallet.cuentaDelCelular(3_000);
    await vi.advanceTimersByTimeAsync(3_001);
    expect((await lectura).estado).toBe("no-se-sabe");
  });

  it("sin la llave de este navegador no se sabe, aunque el servicio conteste", async () => {
    h.impl.publicKeyHex = async () => {
      throw new Error("sin llave");
    };
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("no-se-sabe");
  });

  it("fuera de la red principal todo está listo y no arma ni pregunta nada", async () => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.llamadas = [];
    const l = await pollarWallet.cuentaDelCelular();
    expect(l.estado).toBe("lista");
    expect(h.llamadas).toEqual([]);
  });

  it("sin cliente armado (nadie entró) no se sabe", async () => {
    await pollarWallet.disconnect();
    pollarWallet.address = P;
    expect((await pollarWallet.cuentaDelCelular()).estado).toBe("no-se-sabe");
  });

  it("lleva el correo de la sesión tapado, no entero", async () => {
    const l = await pollarWallet.cuentaDelCelular();
    expect(l.correoTapado).toBe("a•••@ejemplo.com");
    expect(JSON.stringify(l)).not.toContain(MAIL);
  });
});

describe("confirmarCorreoDelCelular, la confirmación del correo desde el celular", () => {
  /** El canal que avisa a las otras pestañas, anotando qué se avisó. */
  function canalFalso(): string[] {
    const avisos: string[] = [];
    vi.stubGlobal("BroadcastChannel", class {
      postMessage(datos: { tipo?: string }): void {
        avisos.push(String(datos.tipo));
      }
      close(): void {}
    });
    return avisos;
  }

  it("dice cómo quedó la cuenta con lo que contesta el propio servicio, sin otra lectura", async () => {
    const avisos = canalFalso();
    h.impl["recovery.status"] = async () => recuperacion();
    h.impl["recovery.confirmEmail"] = async () => recuperacion({ configured: true, correo: MAIL });
    h.llamadas = [];
    const l = await pollarWallet.confirmarCorreoDelCelular("ABCD12345");
    expect(l).toMatchObject({ estado: "lista", correoDeLaSesionConfirmado: true, protegida: true });
    expect(h.argumentos["recovery.confirmEmail"]).toEqual([["ABCD12345"]]);
    expect(h.llamadas).not.toContain("recovery.status");
    expect(avisos).toEqual(["cambio"]);
  });

  it("una cuenta que ya tenía su desbloqueo no cuenta como confirmada si el correo no quedó", async () => {
    const avisos = canalFalso();
    h.impl["recovery.confirmEmail"] = async () => recuperacion({ configured: true, passkeys: 1 });
    const l = await pollarWallet.confirmarCorreoDelCelular("ABCD12345");
    expect(l).toMatchObject({ estado: "falta", protegida: true, correoDeLaSesionConfirmado: false });
    // Sin correo confirmado no hay nada que avisarle a las otras pestañas.
    expect(avisos).toEqual([]);
  });

  it("un correo confirmado de otra dirección no es el de la sesión", async () => {
    h.impl["recovery.confirmEmail"] = async () => recuperacion({ configured: true, correo: "otra@ejemplo.com" });
    expect((await pollarWallet.confirmarCorreoDelCelular("ABCD12345")).correoDeLaSesionConfirmado).toBe(false);
  });

  it("deja la protección en memoria cuando la cuenta quedó lista en este navegador", async () => {
    h.impl["recovery.confirmEmail"] = async () => recuperacion({ configured: true, correo: MAIL });
    await pollarWallet.confirmarCorreoDelCelular("ABCD12345");
    h.llamadas = [];
    const e = await pollarWallet.estadoOficial(false);
    expect(h.llamadas).not.toContain("recovery.status");
    expect(e.proteccion).toBe("lista");
  });

  it("el error del servicio sale tal cual, con su código y su detalle", async () => {
    const rechazo = Object.assign(new Error("SDK_COSIGN_REQUEST_NOT_FOUND"), { code: "SDK_COSIGN_REQUEST_NOT_FOUND", body: { reason: "no code was sent" } });
    h.impl["recovery.confirmEmail"] = async () => {
      throw rechazo;
    };
    await expect(pollarWallet.confirmarCorreoDelCelular("ABCD12345")).rejects.toBe(rechazo);
  });

  it("no pide ninguna firma ni suma ningún aparato", async () => {
    h.impl["recovery.confirmEmail"] = async () => recuperacion({ configured: true, correo: MAIL });
    h.llamadas = [];
    await pollarWallet.confirmarCorreoDelCelular("ABCD12345");
    const prohibidos = PROHIBIDOS.filter((n) => n !== "recovery.confirmEmail");
    expect(h.llamadas.filter((n) => prohibidos.includes(n))).toEqual([]);
  });
});
