// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIN_RESPUESTA, TOPE_DE_ESPERA_MS, cancelo, codigoMalo, conTope, mailOk, noPermitido } from "./proteger-cuenta";

/**
 * Lo que quedó de «Protegé tu cuenta» (`proteger-cuenta.ts`) y reusa el paso «Dejá tu cuenta lista»: reconocer cuándo la
 * persona cerró el cuadro del desbloqueo (no es una falla) y cuándo el navegador no lo deja abrir, el código que no vale,
 * y la espera con tope. La pantalla del paso se prueba en `cuenta-lista.test.ts`.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("cancelar el desbloqueo no es fallar", () => {
  it("cancelo: reconoce lo que es de la persona y no lo demás", () => {
    expect(cancelo(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"))).toBe(true);
    expect(cancelo(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe(true);
    expect(cancelo(new Error("SDK_RECOVERY_FAILED", { cause: new DOMException("x", "NotAllowedError") }))).toBe(true);
    expect(cancelo("passkey-cancelada")).toBe(true);
    expect(cancelo(new Error("passkey-cancelada"))).toBe(true);
    expect(cancelo(new Error("SDK_NETWORK"))).toBe(false);
    expect(cancelo(undefined)).toBe(false);
  });

  it("cancelo: un pedido de la red cortado a mitad no es la persona diciendo que no", () => {
    // Pollar cuenta así un pedido cortado ("Aborted"), y Safari dice "cancelled" cuando el navegador corta uno.
    expect(cancelo(new Error("Aborted"))).toBe(false);
    expect(cancelo(Object.assign(new Error("Aborted"), { name: "AbortError" }))).toBe(false);
    expect(cancelo(new DOMException("The operation was aborted.", "AbortError"))).toBe(false);
    expect(cancelo(new DOMException("signal is aborted without reason", "AbortError"))).toBe(false);
    expect(cancelo(new Error("The request was cancelled"))).toBe(false);
    expect(cancelo(new Error("cancelled"))).toBe(false);
    expect(cancelo(new Error("SDK_NETWORK_TIMEOUT", { cause: new Error("Aborted") }))).toBe(false);
  });

  it("cancelo: un AbortError del navegador, que no es un corte de la red, sí cuenta", () => {
    expect(cancelo(new DOMException("", "AbortError"))).toBe(true);
  });

  it("cancelo: una causa que se apunta a sí misma no cuelga el cuadro", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(cancelo(a)).toBe(false);
  });

  it("noPermitido: el navegador no siguió (también envuelto por el kit), y nada más", () => {
    expect(noPermitido(new DOMException("x", "NotAllowedError"))).toBe(true);
    expect(noPermitido(new Error("SDK", { cause: new DOMException("x", "NotAllowedError") }))).toBe(true);
    expect(noPermitido(new Error("passkey-cancelada"))).toBe(false);
    expect(noPermitido(new Error("boom"))).toBe(false);
  });
});

describe("el aviso del navegador que no deja abrir el desbloqueo", () => {
  it("nombra las dos salidas, en español y en inglés", async () => {
    const { T } = await import("../i18n");
    expect(T.es.protPasskeyBloqueada).toMatch(/correo/);
    expect(T.es.protPasskeyBloqueada).toMatch(/Chrome/);
    expect(T.es.protPasskeyBloqueada).toMatch(/Safari/);
    expect(T.en.protPasskeyBloqueada).toMatch(/email/);
    expect(T.en.protPasskeyBloqueada).toMatch(/Chrome/);
    expect(T.en.protPasskeyBloqueada).toMatch(/Safari/);
    // Sin tecnicismos ni puntos medios.
    for (const l of ["es", "en"] as const) expect(String(T[l].protPasskeyBloqueada)).not.toMatch(/passkey|WebAuthn|·|\bfirma/i);
  });
});

describe("el correo y el código", () => {
  it("un correo con forma de correo", () => {
    expect(mailOk("ana@mail.com")).toBe(true);
    expect(mailOk(" ana@mail.com ")).toBe(true);
    expect(mailOk("ana@mail")).toBe(false);
    expect(mailOk("ana mail.com")).toBe(false);
    expect(mailOk("")).toBe(false);
  });

  it("un código que Pollar no aceptó, por su código de error", () => {
    expect(codigoMalo(new Error("SDK_INVALID_OTP"))).toBe(true);
    expect(codigoMalo(new Error("OTP EXPIRED"))).toBe(true);
    expect(codigoMalo(new Error("Failed to fetch"))).toBe(false);
  });

  // El servicio de códigos contestó 500 con {"code":2,"message":"turnkey: the OTP code has either expired or is
  // invalid (status=401)"}. El SDK (`authProxy`) lo lanza como `PollarApiError("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus,
  // message })`: su `message` es solo el código y lo que dijo el servicio queda en `body.message`.
  it("un código que el servicio de códigos rechazó: lo dice en el detalle del error, no en su mensaje", async () => {
    const { PollarApiError } = await import("@pollar/core");
    const rechazo = (message?: string) => new PollarApiError("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 500, ...(message ? { message } : {}) });
    expect(rechazo().message).toBe("SDK_COSIGN_TURNKEY_REJECTED");
    expect(codigoMalo(rechazo("turnkey: the OTP code has either expired or is invalid (status=401)"))).toBe(true);
    expect(codigoMalo(rechazo("turnkey: invalid OTP code"))).toBe(true);
    // Un rechazo del servicio que no habla del código no culpa al código.
    expect(codigoMalo(rechazo("turnkey: internal error (status=500)"))).toBe(false);
    expect(codigoMalo(rechazo("Turnkey's Auth Proxy answered 500"))).toBe(false);
    expect(codigoMalo(rechazo())).toBe(false);
    // Otro error del SDK con el mismo detalle no cuenta: solo el rechazo del servicio de códigos.
    expect(codigoMalo(Object.assign(new Error("SDK_COSIGN_UPSTREAM_ERROR"), { code: "SDK_COSIGN_UPSTREAM_ERROR", body: { message: "the OTP code is invalid" } }))).toBe(false);
  });
});

describe("la espera con tope", () => {
  it("el tope es de 60 segundos", () => {
    expect(TOPE_DE_ESPERA_MS).toBe(60_000);
  });

  it("pasado el tope rechaza con SIN_RESPUESTA; si después contesta que sí, lo avisa por `tarde`", async () => {
    vi.useFakeTimers();
    let contestar!: (v: boolean) => void;
    const tarde = vi.fn();
    const p = conTope(new Promise<boolean>((r) => (contestar = r)), tarde);
    const resultado = p.then(
      () => "resolvio",
      (e: unknown) => (e === SIN_RESPUESTA ? "sin-respuesta" : "otro"),
    );
    await vi.advanceTimersByTimeAsync(TOPE_DE_ESPERA_MS + 10);
    expect(await resultado).toBe("sin-respuesta");
    contestar(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(tarde).toHaveBeenCalledWith(true);
  });

  it("una respuesta a tiempo pasa tal cual y no deja el reloj armado", async () => {
    vi.useFakeTimers();
    const tarde = vi.fn();
    await expect(conTope(Promise.resolve(7), tarde)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
    await expect(conTope(Promise.reject(new Error("x")), tarde)).rejects.toThrow("x");
    expect(vi.getTimerCount()).toBe(0);
    expect(tarde).not.toHaveBeenCalled();
  });
});
