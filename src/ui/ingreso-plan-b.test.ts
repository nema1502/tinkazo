import { describe, expect, it, vi } from "vitest";
import { WALLET_ERRORS } from "../stellar/wallet-lite";
import { AUTH_ERROR_CODES } from "@pollar/core";
import { problemasDeAlta } from "../stellar/alta-build";
import { ESPERA_INTERNET_MS, PERSONA_ENTRADA, hayInternet, ingresoPlanB, ingresoPlanBPrendida, ofrecerSalida, quienFalla, tituloDelAviso, type PasoDelIngreso } from "./ingreso-plan-b";

/**
 * El plan B del ingreso: cuándo está prendido y de quién es la culpa de que entrar falle.
 *
 * Solo se ofrece seguir sin cuenta si la falla no es de la persona. Lo de la persona se enumera (código equivocado o
 * vencido, ventana cerrada o bloqueada, cancelar, no tener internet): todo lo demás que pase al entrar con Pollar es
 * del proveedor, aunque no sepamos qué lo causó, porque el paquete no trae ningún código para un tope de cuentas.
 */

const err = (nombre: string): Error => new Error(nombre);
const conCodigo = (mensaje: string, code: string): Error => Object.assign(new Error(mensaje), { code });

describe("la bandera VITE_INGRESO_PLAN_B", () => {
  it("nace apagada: sin la variable, o con cualquier valor que no sea 1, no vale", () => {
    expect(ingresoPlanB({}, "testnet")).toBe(false);
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: "" }, "testnet")).toBe(false);
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: "0" }, "testnet")).toBe(false);
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: "true" }, "testnet")).toBe(false);
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: " 1" }, "testnet")).toBe(false);
  });
  it("con 1 vale en Prueba", () => {
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: "1" }, "testnet")).toBe(true);
  });
  it("en Oficial nunca vale, tenga lo que tenga la variable", () => {
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: "1" }, "mainnet")).toBe(false);
    expect(ingresoPlanB({ VITE_INGRESO_PLAN_B: "1" }, "otra-cosa")).toBe(false);
  });
  it("la variable sola, sin mirar la red, vale solo con 1: así se decide si limpiar lo que dejó el plan B", () => {
    expect(ingresoPlanBPrendida({ VITE_INGRESO_PLAN_B: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", " 1", "1 ", "si"]) expect(ingresoPlanBPrendida({ VITE_INGRESO_PLAN_B: v }), JSON.stringify(v)).toBe(false);
    expect(ingresoPlanBPrendida({})).toBe(false);
  });
  it("el build no sale con un valor que la dejaría apagada sin aviso, y no escribe el valor", () => {
    for (const v of ["true", "on", " 1", "1 ", "si", "2"]) {
      const p = problemasDeAlta({ VITE_INGRESO_PLAN_B: v });
      expect(p.some((x) => x.includes("VITE_INGRESO_PLAN_B") && x.includes("solo acepta 1 o 0")), JSON.stringify(v)).toBe(true);
      expect(p.join(" "), JSON.stringify(v)).not.toContain(`=${v}`);
    }
    for (const v of ["", "0", "1", "   "]) expect(problemasDeAlta({ VITE_INGRESO_PLAN_B: v }), JSON.stringify(v)).toEqual([]);
  });
});

describe("de quién es la falla: el proveedor", () => {
  const casos: Array<[PasoDelIngreso, string, unknown]> = [
    ["enviar", "no pudo crear la sesión", err(AUTH_ERROR_CODES.SESSION_CREATE_FAILED)],
    ["enviar", "no pudo mandar el código", err(AUTH_ERROR_CODES.EMAIL_SEND_FAILED)],
    ["enviar", "error inesperado", err(AUTH_ERROR_CODES.UNEXPECTED_ERROR)],
    ["enviar", "su servicio contestó con un error", conCodigo("el servicio contestó", "SDK_RATE_LIMITED")],
    ["enviar", "se cortó la conexión con internet en pie", new TypeError("Failed to fetch")],
    ["enviar", "el pedido venció", Object.assign(new Error("Request timed out after 30000ms"), { name: "PollarNetworkError", code: "SDK_NETWORK_TIMEOUT" })],
    // Al pedir el código no hay código que culpar, ni siquiera con su nombre.
    ["enviar", "un nombre de código al pedir el código", err("EMAIL_CODE_INVALID")],
    ["verificar", "no pudo comprobar el código", err(AUTH_ERROR_CODES.EMAIL_VERIFY_FAILED)],
    ["verificar", "no dejó crear la cuenta", err(AUTH_ERROR_CODES.WALLET_CONNECT_FAILED)],
    ["verificar", "falló la autenticación", err(AUTH_ERROR_CODES.AUTH_FAILED)],
    ["verificar", "la cuenta se está abriendo y no termina", err("SDK_WALLET_NOT_READY")],
    ["verificar", "un nombre que el proveedor no define no culpa al código", err("EXPIRED_EMAIL_CODE")],
    ["google", "no pudo armar la entrada", err(WALLET_ERRORS.popupNoSession)],
    ["google", "no autenticó", err(AUTH_ERROR_CODES.WALLET_AUTH_FAILED)],
    ["google", "no bajó el paquete del proveedor", new TypeError("Failed to fetch dynamically imported module")],
    ["google", "un fallo que nadie reconoce", "rechazo"],
    ["google", "un fallo sin nada", null],
  ];
  it.each(casos)("%s: %s", (paso, _que, e) => {
    expect(quienFalla(e, paso, true)).toBe("proveedor");
  });
  it("cada código de entrada del paquete que no es de la persona ni un plazo vencido cuenta como del proveedor", () => {
    const deLaPersona = new Set<string>([AUTH_ERROR_CODES.EMAIL_CODE_INVALID, AUTH_ERROR_CODES.EMAIL_CODE_EXPIRED, AUTH_ERROR_CODES.SESSION_EXPIRED, AUTH_ERROR_CODES.PASSKEY_FAILED]);
    const plazo = new Set<string>([AUTH_ERROR_CODES.LOGIN_TIMEOUT]);
    for (const codigo of Object.values(AUTH_ERROR_CODES)) {
      if (deLaPersona.has(codigo) || plazo.has(codigo)) continue;
      for (const paso of ["enviar", "verificar", "google"] as const) expect(quienFalla(err(codigo), paso, true), `${paso} ${codigo}`).toBe("proveedor");
    }
  });
});

describe("de quién es la falla: un plazo vencido no es de nadie", () => {
  // El plazo vence igual si el proveedor cuelga que si la persona deja la ventana de Google abierta: no se puede culpar a
  // ninguno de los dos. La salida se ofrece, y el aviso no dice que el proveedor falló.
  const plazos: Array<[PasoDelIngreso, string, unknown]> = [
    ["google", "el plazo del proveedor (LOGIN_TIMEOUT)", err(AUTH_ERROR_CODES.LOGIN_TIMEOUT)],
    ["google", "el plazo de la billetera (pollar-timeout)", err("pollar-timeout")],
    ["enviar", "el correo no salió a tiempo", err("pollar-timeout")],
    ["verificar", "el código no se comprobó a tiempo", err("pollar-timeout")],
    ["verificar", "el plazo del proveedor al comprobar", conCodigo("no se pudo verificar", "LOGIN_TIMEOUT")],
  ];
  it.each(plazos)("%s: %s", (paso, _que, e) => {
    expect(quienFalla(e, paso, true)).toBe("plazo");
  });
  it("sin internet sigue siendo de la persona, plazo o no", () => {
    expect(quienFalla(err("pollar-timeout"), "google", false)).toBe("persona");
    expect(quienFalla(err(AUTH_ERROR_CODES.LOGIN_TIMEOUT), "google", false)).toBe("persona");
  });
  it("el título del aviso es neutro para un plazo vencido, y solo señala al proveedor cuando contestó con un error", () => {
    for (const e of [err("LOGIN_TIMEOUT"), err("pollar-timeout"), conCodigo("x", "LOGIN_TIMEOUT")]) expect(tituloDelAviso(e)).toBe("ingresoPlazoTitulo");
    for (const e of [
      err(AUTH_ERROR_CODES.SESSION_CREATE_FAILED),
      err(AUTH_ERROR_CODES.EMAIL_SEND_FAILED),
      err(AUTH_ERROR_CODES.UNEXPECTED_ERROR),
      err(WALLET_ERRORS.popupNoSession),
      new TypeError("Failed to fetch"),
      // Un pedido al proveedor que no contestó: es una respuesta que no llegó, no el plazo del ingreso.
      Object.assign(new Error("Request timed out after 30000ms"), { name: "PollarNetworkError", code: "SDK_NETWORK_TIMEOUT" }),
      null,
    ]) {
      expect(tituloDelAviso(e)).toBe("ingresoCaidoTitulo");
    }
  });
  it("los dos títulos están en las dos lenguas, y el neutro no culpa a nadie", async () => {
    const { T } = await import("../i18n");
    expect(T.es.ingresoPlazoTitulo).toBe("No se completó el ingreso");
    expect(T.en.ingresoPlazoTitulo).toBe("Sign-in didn't finish");
    expect(T.es.ingresoCaidoTitulo).toBe("El ingreso no está respondiendo");
    expect(T.en.ingresoCaidoTitulo).toBe("Sign-in isn't responding");
  });
});

describe("de quién es la falla: la persona", () => {
  it.each(["EMAIL_CODE_INVALID", "INVALID_EMAIL_CODE", "SDK_EMAIL_CODE_INVALID", "EMAIL_CODE_EXPIRED", "SDK_EMAIL_CODE_EXPIRED"])("el código equivocado o vencido, %s, es suyo", (nombre) => {
    expect(quienFalla(err(nombre), "verificar", true)).toBe("persona");
    expect(quienFalla(conCodigo("no se pudo verificar", nombre), "verificar", true)).toBe("persona");
  });
  it("la sesión que venció mientras escribía el código es suya", () => {
    expect(quienFalla(err(AUTH_ERROR_CODES.SESSION_EXPIRED), "verificar", true)).toBe("persona");
  });
  it("la ventana de Google cerrada o bloqueada por el navegador es suya", () => {
    expect(quienFalla(err(WALLET_ERRORS.popupClosed), "google", true)).toBe("persona");
    expect(quienFalla(err(WALLET_ERRORS.popupBlocked), "google", true)).toBe("persona");
  });
  it("cancelar y la llave de acceso fallida son suyos", () => {
    expect(quienFalla(err(AUTH_ERROR_CODES.PASSKEY_FAILED), "verificar", true)).toBe("persona");
    expect(quienFalla(new Error("User rejected this request."), "google", true)).toBe("persona");
    expect(quienFalla(new Error("The user declined the transaction"), "verificar", true)).toBe("persona");
  });
  it("no tener internet es suyo, también cuando el error parece del proveedor", () => {
    expect(quienFalla(new TypeError("Failed to fetch"), "enviar", false)).toBe("persona");
    expect(quienFalla(err("pollar-timeout"), "google", false)).toBe("persona");
    expect(quienFalla(err(AUTH_ERROR_CODES.EMAIL_SEND_FAILED), "enviar", false)).toBe("persona");
  });
  it("los nombres de la ventana de Google son los que usa la billetera", () => {
    expect(PERSONA_ENTRADA).toContain(WALLET_ERRORS.popupBlocked);
    expect(PERSONA_ENTRADA).toContain(WALLET_ERRORS.popupClosed);
  });
});

describe("si hay internet", () => {
  it("la propia página contesta: hay", async () => {
    const f = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await hayInternet(f as unknown as typeof fetch)).toBe(true);
    expect(f).toHaveBeenCalledOnce();
  });
  it("la propia página contesta con un error del servidor: sigue habiendo internet", async () => {
    const f = async () => new Response(null, { status: 503 });
    expect(await hayInternet(f as unknown as typeof fetch)).toBe(true);
  });
  it("el pedido falla: no hay", async () => {
    const f = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await hayInternet(f as unknown as typeof fetch)).toBe(false);
  });
  it("el pedido no contesta a tiempo: no hay", async () => {
    const f = (_url: unknown, init?: RequestInit) => new Promise<Response>((_ok, no) => init?.signal?.addEventListener("abort", () => no(new DOMException("abortado", "AbortError"))));
    expect(await hayInternet(f as unknown as typeof fetch, 20)).toBe(false);
  });
  it("el tope es de seis segundos: con una red lenta, tres daban por caída una conexión que andaba", async () => {
    expect(ESPERA_INTERNET_MS).toBe(6_000);
    vi.useFakeTimers();
    try {
      let abortado = false;
      const f = (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, no) =>
          init?.signal?.addEventListener("abort", () => {
            abortado = true;
            no(new DOMException("abortado", "AbortError"));
          }),
        );
      const respuesta = hayInternet(f as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(5_900);
      expect(abortado).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(abortado).toBe(true);
      expect(await respuesta).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ofrecer la salida", () => {
  const conPlanB = { VITE_INGRESO_PLAN_B: "1" };
  const enLinea = async () => true;
  const sinLinea = async () => false;
  it("apagada la bandera, nunca, sea cual sea la falla", async () => {
    for (const e of [err("SESSION_CREATE_FAILED"), err("pollar-timeout"), new TypeError("Failed to fetch")]) {
      expect(await ofrecerSalida(e, "enviar", { env: {}, red: "testnet", hayInternet: enLinea })).toBe(false);
    }
  });
  it("en Oficial, nunca", async () => {
    expect(await ofrecerSalida(err("SESSION_CREATE_FAILED"), "enviar", { env: conPlanB, red: "mainnet", hayInternet: enLinea })).toBe(false);
  });
  it("prendida y en Prueba, una falla del proveedor la ofrece", async () => {
    expect(await ofrecerSalida(err("SESSION_CREATE_FAILED"), "enviar", { env: conPlanB, red: "testnet", hayInternet: enLinea })).toBe(true);
    expect(await ofrecerSalida(err("pollar-timeout"), "google", { env: conPlanB, red: "testnet", hayInternet: enLinea })).toBe(true);
  });
  it("un plazo vencido la ofrece, con internet, aunque no se sepa de quién es", async () => {
    for (const e of [err("LOGIN_TIMEOUT"), err("pollar-timeout")]) {
      expect(await ofrecerSalida(e, "google", { env: conPlanB, red: "testnet", hayInternet: enLinea })).toBe(true);
      expect(await ofrecerSalida(e, "google", { env: conPlanB, red: "testnet", hayInternet: sinLinea })).toBe(false);
    }
  });
  it("prendida y en Prueba, una falla de la persona no la ofrece", async () => {
    expect(await ofrecerSalida(err("EMAIL_CODE_INVALID"), "verificar", { env: conPlanB, red: "testnet", hayInternet: enLinea })).toBe(false);
    expect(await ofrecerSalida(err("popup-closed"), "google", { env: conPlanB, red: "testnet", hayInternet: enLinea })).toBe(false);
  });
  it("antes de ofrecerla se confirma que hay internet: si la propia página tampoco contesta, la falla es de la persona", async () => {
    for (const e of [new TypeError("Failed to fetch"), err("SESSION_CREATE_FAILED"), err("popup-nosession"), err("pollar-timeout")]) {
      expect(await ofrecerSalida(e, "enviar", { env: conPlanB, red: "testnet", hayInternet: sinLinea })).toBe(false);
      expect(await ofrecerSalida(e, "enviar", { env: conPlanB, red: "testnet", hayInternet: enLinea })).toBe(true);
    }
  });
  it("con la bandera apagada, en Oficial o ante una falla de la persona no se hace ni el pedido", async () => {
    const pregunta = vi.fn(async () => true);
    await ofrecerSalida(err("SESSION_CREATE_FAILED"), "enviar", { env: {}, red: "testnet", hayInternet: pregunta });
    await ofrecerSalida(err("SESSION_CREATE_FAILED"), "enviar", { env: conPlanB, red: "mainnet", hayInternet: pregunta });
    await ofrecerSalida(err("EMAIL_CODE_INVALID"), "verificar", { env: conPlanB, red: "testnet", hayInternet: pregunta });
    expect(pregunta).not.toHaveBeenCalled();
  });
});
