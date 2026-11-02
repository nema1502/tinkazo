// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { type Proteccion, cancelo, protegerCuenta } from "./proteger-cuenta";

/**
 * "Protegé tu cuenta" (`proteger-cuenta.ts`) contra una cuenta simulada: sin Pollar, sin Turnkey. Lo que se mira es lo
 * que ve la persona: cuántas acciones principales hay en cada paso, cómo se sale, y que cerrar con la protección a
 * medias no deje un sello que no sigue.
 */

type Pendiente<T> = { promesa: Promise<T>; resolver: (v: T) => void; rechazar: (e: unknown) => void };
function pendiente<T>(): Pendiente<T> {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((a, b) => {
    resolver = a;
    rechazar = b;
  });
  return { promesa, resolver, rechazar };
}

function cuentaSimulada(puedeUsarPasskey: boolean, partes: Partial<Proteccion> = {}): Proteccion & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    puedeUsarPasskey,
    protegerConPasskey: async () => {
      llamadas.push("passkey");
      return true;
    },
    mandarCodigoDeProteccion: async (mail) => void llamadas.push(`mandar:${mail}`),
    confirmarCodigoDeProteccion: async (codigo) => {
      llamadas.push(`confirmar:${codigo}`);
      return true;
    },
    ...partes,
  };
}

const ventana = (): HTMLElement | null => document.querySelector(".modal-card.login");
const botones = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".modal-card.login button")];
const boton = (texto: string): HTMLButtonElement => {
  const b = botones().find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay botón "${texto}": ${botones().map((x) => x.textContent).join(" | ")}`);
  return b;
};
const hayBoton = (texto: string): boolean => botones().some((x) => x.textContent === texto);
const alerta = (): string => [...document.querySelectorAll<HTMLElement>(".login-err")].filter((x) => !x.hidden).map((x) => x.textContent).join("");
const esc = (): boolean => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
const dejar = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function escribir(selector: string, valor: string): void {
  const campo = document.querySelector<HTMLInputElement>(selector);
  if (!campo) throw new Error(`no hay ${selector}`);
  campo.value = valor;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}
const mandarFormulario = (): void => {
  document.querySelector<HTMLFormElement>(".modal-card.login form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe("una sola acción principal por paso", () => {
  it("con el desbloqueo del aparato: ese es el principal y el correo queda como secundario", () => {
    void protegerCuenta(cuentaSimulada(true), null);
    const principales = botones().filter((b) => b.classList.contains("login-go"));
    expect(principales.map((b) => b.textContent)).toEqual([t("protPasskey")]);
    expect(boton(t("protMailGo")).classList.contains("login-go")).toBe(false);
  });

  it("sin desbloqueo (el navegador no lo tiene): el principal es el código por correo", () => {
    void protegerCuenta(cuentaSimulada(false), null);
    const principales = botones().filter((b) => b.classList.contains("login-go"));
    expect(principales.map((b) => b.textContent)).toEqual([t("protMailGo")]);
    expect(hayBoton(t("protPasskey"))).toBe(false);
  });

  it("en el paso del código el principal es 'Confirmar' y es el único", async () => {
    void protegerCuenta(cuentaSimulada(true), null);
    escribir("#prot-mail", "ana@example.com");
    mandarFormulario();
    await dejar();
    expect(document.querySelector("#prot-code")).not.toBeNull();
    const principales = botones().filter((b) => b.classList.contains("login-go"));
    expect(principales.map((b) => b.textContent)).toEqual([t("protCodeGo")]);
  });
});

describe("siempre hay una salida a la vista", () => {
  it("en el primer paso: 'Ahora no' cierra y dice que la persona no la protegió", async () => {
    const r = protegerCuenta(cuentaSimulada(true), null);
    boton(t("protAhoraNo")).click();
    await expect(r).resolves.toBe(false);
    expect(ventana()).toBeNull();
  });

  it("en el paso del código también hay 'Ahora no' (en el celular no hay Esc ni fondo que tocar)", async () => {
    const r = protegerCuenta(cuentaSimulada(false), null);
    escribir("#prot-mail", "ana@example.com");
    mandarFormulario();
    await dejar();
    boton(t("protAhoraNo")).click();
    await expect(r).resolves.toBe(false);
    expect(ventana()).toBeNull();
  });

  it("Escape y tocar el fondo también cierran cuando no hay nada en marcha", async () => {
    const a = protegerCuenta(cuentaSimulada(true), null);
    esc();
    await expect(a).resolves.toBe(false);
    const b = protegerCuenta(cuentaSimulada(true), null);
    document.querySelector<HTMLElement>(".modal-back")?.click();
    await expect(b).resolves.toBe(false);
  });
});

describe("cerrar con la protección a medias", () => {
  it("con el desbloqueo en marcha, Escape, el fondo y 'Ahora no' no cierran; al completarse sigue el sello", async () => {
    const pk = pendiente<boolean>();
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => pk.promesa });
    const resultado = vi.fn();
    void protegerCuenta(cuenta, null).then(resultado);
    boton(t("protPasskey")).click();
    expect(boton(t("protAhoraNo")).disabled).toBe(true);

    esc();
    document.querySelector<HTMLElement>(".modal-back")?.click();
    boton(t("protAhoraNo")).click();
    await dejar();
    expect(ventana()).not.toBeNull();
    expect(resultado).not.toHaveBeenCalled();

    pk.resolver(true);
    await dejar();
    expect(resultado).toHaveBeenCalledTimes(1);
    expect(resultado).toHaveBeenCalledWith(true);
    expect(ventana()).toBeNull();
  });

  it("con el código en confirmación pasa lo mismo, y si el código no vale se puede salir de nuevo", async () => {
    const confirmacion = pendiente<boolean>();
    const cuenta = cuentaSimulada(false, { confirmarCodigoDeProteccion: () => confirmacion.promesa });
    const resultado = vi.fn();
    void protegerCuenta(cuenta, null).then(resultado);
    escribir("#prot-mail", "ana@example.com");
    mandarFormulario();
    await dejar();
    escribir("#prot-code", "123456");
    mandarFormulario();
    esc();
    boton(t("protAhoraNo")).click();
    await dejar();
    expect(ventana()).not.toBeNull();

    confirmacion.rechazar(new Error("INVALID_OTP"));
    await dejar();
    expect(alerta()).toBe(t("protBadCode"));
    expect(boton(t("protAhoraNo")).disabled).toBe(false);
    boton(t("protAhoraNo")).click();
    await dejar();
    expect(resultado).toHaveBeenCalledWith(false);
  });

  it("la protección completa cierra una sola vez, aunque se aprieten más cosas", async () => {
    const resultado = vi.fn();
    void protegerCuenta(cuentaSimulada(true), null).then(resultado);
    boton(t("protPasskey")).click();
    await dejar();
    esc();
    await dejar();
    expect(resultado).toHaveBeenCalledTimes(1);
    expect(resultado).toHaveBeenCalledWith(true);
  });
});

describe("cancelar el desbloqueo no es fallar", () => {
  it.each([
    ["el navegador (NotAllowedError)", () => Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" })],
    ["la ceremonia propia", () => new Error("passkey-cancelada")],
    ["envuelto por el SDK", () => new Error("SDK_RECOVERY_FAILED", { cause: Object.assign(new Error("x"), { name: "NotAllowedError" }) })],
  ])("%s: vuelve al paso, sin aviso rojo y con el botón disponible", async (_n, hacer) => {
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => Promise.reject(hacer()) });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await dejar();
    expect(alerta()).toBe("");
    expect(boton(t("protPasskey")).disabled).toBe(false);
    expect(boton(t("protAhoraNo")).disabled).toBe(false);
  });

  it("un error de verdad sí se dice", async () => {
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => Promise.reject(new Error("SDK_NETWORK")) });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await dejar();
    expect(alerta()).toBe(t("protPasskeyFalla"));
  });

  it("si el desbloqueo termina pero la cuenta no quedó protegida, se dice", async () => {
    const cuenta = cuentaSimulada(true, { protegerConPasskey: async () => false });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await dejar();
    expect(alerta()).toBe(t("protNoQuedo"));
  });

  it("cancelo: reconoce lo que es de la persona y no lo demás", () => {
    expect(cancelo(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(cancelo("passkey-cancelada")).toBe(true);
    expect(cancelo(new Error("SDK_NETWORK"))).toBe(false);
    expect(cancelo(undefined)).toBe(false);
  });
});

describe("el correo", () => {
  it("un correo al que le falta algo no manda nada", async () => {
    const cuenta = cuentaSimulada(false);
    void protegerCuenta(cuenta, null);
    escribir("#prot-mail", "ana@");
    expect(boton(t("protMailGo")).disabled).toBe(true);
    mandarFormulario();
    await dejar();
    expect(cuenta.llamadas).toEqual([]);
  });

  it("un código que no vale se dice con su texto, y otro error con el general", async () => {
    let n = 0;
    const cuenta = cuentaSimulada(false, {
      confirmarCodigoDeProteccion: async () => {
        throw new Error(n++ === 0 ? "INVALID_OTP" : "SDK_NETWORK");
      },
    });
    void protegerCuenta(cuenta, null);
    escribir("#prot-mail", "ana@example.com");
    mandarFormulario();
    await dejar();
    escribir("#prot-code", "000000");
    mandarFormulario();
    await dejar();
    expect(alerta()).toBe(t("protBadCode"));
    mandarFormulario();
    await dejar();
    expect(alerta()).toBe(t("protFalla"));
  });

  it("reenviar el código no cierra nada y lo dice", async () => {
    const cuenta = cuentaSimulada(false);
    void protegerCuenta(cuenta, null);
    escribir("#prot-mail", "ana@example.com");
    mandarFormulario();
    await dejar();
    boton(t("protOtroCodigo")).click();
    await dejar();
    expect(cuenta.llamadas.filter((x) => x.startsWith("mandar:"))).toHaveLength(2);
    expect(alerta()).toBe(t("protReenviado"));
    expect(ventana()).not.toBeNull();
  });
});
