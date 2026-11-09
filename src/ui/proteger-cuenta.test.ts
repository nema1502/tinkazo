// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { type Proteccion, TOPE_DE_ESPERA_MS, cancelo, protegerCuenta } from "./proteger-cuenta";

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

  it("un corte de la red de Pollar al proteger se dice, y no se toma por haber cancelado", async () => {
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => Promise.reject(new Error("Aborted")) });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await dejar();
    expect(alerta()).toBe(t("protPasskeyFalla"));
    expect(boton(t("protPasskey")).disabled).toBe(false);
  });
});

describe("el navegador no deja abrir el desbloqueo", () => {
  const noPermitido = () => new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
  /** El texto de ayuda de siempre, debajo del botón del desbloqueo. */
  const ayuda = (): HTMLElement | null => [...document.querySelectorAll<HTMLElement>(".modal-card.login .login-note")].find((x) => x.textContent === t("protPasskeyAyuda")) ?? null;
  /** La nota que dice qué hacer cuando el navegador no deja abrir el desbloqueo: una región de estado, escondida hasta que hace falta. */
  const aviso = (): HTMLElement | null => document.querySelector<HTMLElement>('.modal-card.login p[role="status"]');

  it("se dice qué hacer: el código por correo, o abrir el enlace en Chrome o Safari; y no es un aviso rojo", async () => {
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => Promise.reject(noPermitido()) });
    void protegerCuenta(cuenta, null);
    expect(aviso()?.hidden).toBe(true);
    boton(t("protPasskey")).click();
    await dejar();
    expect(aviso()?.hidden).toBe(false);
    expect(aviso()?.textContent).toBe(t("protPasskeyBloqueada"));
    expect(aviso()?.className).toContain("login-aviso");
    // La ayuda de un desbloqueo que acá no se abre sobra mientras la nota está: no ocupa lugar en un celular chico.
    expect(ayuda()?.hidden).toBe(true);
    expect(alerta()).toBe("");
    // El botón sigue ahí para volver a probar, y el correo está a la vista.
    expect(boton(t("protPasskey")).disabled).toBe(false);
    expect(hayBoton(t("protMailGo"))).toBe(true);
  });

  it("el aviso nombra las dos salidas, en español y en inglés", async () => {
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

  it("el aviso envuelto por el SDK también se muestra, y se va al volver a intentarlo", async () => {
    let n = 0;
    const cuenta = cuentaSimulada(true, {
      protegerConPasskey: () => (n++ === 0 ? Promise.reject(new Error("SDK_RECOVERY_FAILED", { cause: noPermitido() })) : new Promise<boolean>(() => undefined)),
    });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await dejar();
    expect(aviso()?.hidden).toBe(false);
    boton(t("protPasskey")).click();
    expect(aviso()?.hidden).toBe(true);
    expect(aviso()?.textContent).toBe("");
    expect(ayuda()?.hidden).toBe(false);
  });

  it("si la persona canceló con la ceremonia propia (sin cuadro que se haya negado), no hay aviso", async () => {
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => Promise.reject(new Error("passkey-cancelada")) });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await dejar();
    expect(aviso()?.hidden).toBe(true);
    expect(alerta()).toBe("");
  });
});

describe("si Pollar o el navegador no contestan nunca", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("el desbloqueo: pasado el tope se avisa, se vuelve a poder salir y se puede reintentar", async () => {
    const nunca = (): Promise<boolean> => new Promise<boolean>(() => undefined);
    let llamadas = 0;
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => (llamadas++, nunca()) });
    const resultado = vi.fn();
    void protegerCuenta(cuenta, null).then(resultado);
    boton(t("protPasskey")).click();
    expect(boton(t("protAhoraNo")).disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(TOPE_DE_ESPERA_MS - 1);
    expect(alerta()).toBe("");
    expect(boton(t("protAhoraNo")).disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(alerta()).toBe(t("protTarda"));
    expect(boton(t("protPasskey")).disabled).toBe(false);
    expect(boton(t("protAhoraNo")).disabled).toBe(false);

    boton(t("protPasskey")).click();
    expect(llamadas).toBe(2);
    expect(alerta()).toBe("");
    expect(resultado).not.toHaveBeenCalled();
  });

  it("el tope es de 60 segundos", () => {
    expect(TOPE_DE_ESPERA_MS).toBe(60_000);
  });

  it("el código: pasado el tope se avisa, el botón vuelve y se puede salir", async () => {
    let llamadas = 0;
    const cuenta = cuentaSimulada(false, { confirmarCodigoDeProteccion: () => (llamadas++, new Promise<boolean>(() => undefined)) });
    const resultado = vi.fn();
    void protegerCuenta(cuenta, null).then(resultado);
    escribir("#prot-mail", "ana@example.com");
    mandarFormulario();
    await vi.advanceTimersByTimeAsync(0);
    escribir("#prot-code", "123456");
    mandarFormulario();
    expect(boton(t("protAhoraNo")).disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(TOPE_DE_ESPERA_MS);
    expect(alerta()).toBe(t("protTarda"));
    expect(boton(t("protCodeGo")).disabled).toBe(false);
    expect(boton(t("protAhoraNo")).disabled).toBe(false);

    // Reintentar vuelve a llamar (y a esperar con tope).
    mandarFormulario();
    expect(llamadas).toBe(2);
    expect(boton(t("protAhoraNo")).disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(TOPE_DE_ESPERA_MS);
    boton(t("protAhoraNo")).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(resultado).toHaveBeenCalledWith(false);
  });

  it("si lo que no contestaba contesta después y la cuenta quedó protegida, la ventana lo toma y sigue", async () => {
    const tarde = pendiente<boolean>();
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => tarde.promesa });
    const resultado = vi.fn();
    void protegerCuenta(cuenta, null).then(resultado);
    boton(t("protPasskey")).click();
    await vi.advanceTimersByTimeAsync(TOPE_DE_ESPERA_MS);
    expect(alerta()).toBe(t("protTarda"));
    tarde.resolver(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(resultado).toHaveBeenCalledWith(true);
    expect(ventana()).toBeNull();
  });

  it("y si contesta tarde con un error, no pisa lo que la persona está viendo", async () => {
    const tarde = pendiente<boolean>();
    const cuenta = cuentaSimulada(true, { protegerConPasskey: () => tarde.promesa });
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await vi.advanceTimersByTimeAsync(TOPE_DE_ESPERA_MS);
    tarde.rechazar(new Error("SDK_NETWORK"));
    await vi.advanceTimersByTimeAsync(0);
    expect(alerta()).toBe(t("protTarda"));
  });

  it("una respuesta a tiempo no deja el reloj armado", async () => {
    const cuenta = cuentaSimulada(true);
    void protegerCuenta(cuenta, null);
    boton(t("protPasskey")).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("al cerrar, el foco no se pierde", () => {
  // Con reloj falso y limpieza propia: el sondeo del foco que queda a medias no pasa a la prueba siguiente.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  /** La página de un sello o un sorteo: el botón principal, apagado mientras se hace, y su línea de estado. */
  function pagina(): { boton: HTMLButtonElement; estado: HTMLElement } {
    document.body.innerHTML = `<button id="btn-freeze">Sellar</button><p class="txstatus" id="seal-status" style="display:none"></p>`;
    const boton = document.getElementById("btn-freeze") as HTMLButtonElement;
    const estado = document.getElementById("seal-status") as HTMLElement;
    boton.focus();
    boton.disabled = true; // como en `freeze.ts`: el foco ya cayó en el cuerpo de la página
    return { boton, estado };
  }
  /** Deja pasar el instante en que el flujo sigue y la ventana mira a dónde devolver el foco. */
  const siguiente = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(5));

  it("si la persona no protegió la cuenta, el foco vuelve al botón en cuanto el flujo lo vuelve a prender", async () => {
    const { boton: principal, estado } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protAhoraNo")).click();
    // Lo que hace `freeze.ts` apenas termina la ventana: prender el botón y escribir el error.
    await expect(r).resolves.toBe(false);
    principal.disabled = false;
    estado.style.display = "block";
    await siguiente();
    expect(document.activeElement).toBe(principal);
  });

  it("si la cuenta quedó protegida y el sello sigue, el foco va a la línea de estado, que se puede enfocar", async () => {
    const { boton: principal, estado } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protPasskey")).click();
    await expect(r).resolves.toBe(true);
    // El sello vuelve a empezar: el botón sigue apagado y la línea de estado se muestra.
    estado.style.display = "block";
    estado.textContent = "Sellando…";
    await siguiente();
    expect(principal.disabled).toBe(true);
    expect(document.activeElement).toBe(estado);
    expect(estado.getAttribute("tabindex")).toBe("-1");
  });

  it("si el botón ya no está en la página, también va a la línea de estado", async () => {
    const { boton: principal, estado } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protPasskey")).click();
    await expect(r).resolves.toBe(true);
    principal.remove();
    estado.style.display = "block";
    await siguiente();
    expect(document.activeElement).toBe(estado);
  });

  it("sin botón guardado (el cuerpo de la página no sirve de destino), cae en la línea de estado", async () => {
    const { estado } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), document.body, "seal-status");
    boton(t("protPasskey")).click();
    await expect(r).resolves.toBe(true);
    estado.style.display = "block";
    await siguiente();
    expect(document.activeElement).toBe(estado);
  });

  it("si la línea de estado está escondida, no hay a dónde ir y no falla", async () => {
    const { boton: principal } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protPasskey")).click();
    await expect(r).resolves.toBe(true);
    await siguiente();
    expect(document.activeElement).toBe(document.body);
  });

  it("si el flujo tarda en prender el botón (un módulo que se carga), el foco lo espera y lo toma cuando está", async () => {
    const { boton: principal } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protAhoraNo")).click();
    await expect(r).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(document.activeElement).toBe(document.body);
    principal.disabled = false;
    await vi.advanceTimersByTimeAsync(150);
    expect(document.activeElement).toBe(principal);
  });

  it("no le quita el foco a quien ya lo puso en otro lado", async () => {
    const { boton: principal } = pagina();
    const otro = document.createElement("input");
    document.body.append(otro);
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protAhoraNo")).click();
    await expect(r).resolves.toBe(false);
    otro.focus();
    principal.disabled = false;
    await siguiente();
    expect(document.activeElement).toBe(otro);
  });

  it("deja de mirar pasado un rato: no queda un reloj dando vueltas", async () => {
    const { boton: principal } = pagina();
    const r = protegerCuenta(cuentaSimulada(true), principal, "seal-status");
    boton(t("protAhoraNo")).click();
    await expect(r).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(document.activeElement).toBe(document.body);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sin a dónde devolver el foco (ni botón ni línea de estado), no arma ningún reloj", async () => {
    const r = protegerCuenta(cuentaSimulada(true), null);
    // jsdom arma un reloj propio al enfocar la ventana (el de la selección): se vacía antes de contar los nuestros.
    await vi.advanceTimersByTimeAsync(0);
    boton(t("protAhoraNo")).click();
    await expect(r).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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
