// @vitest-environment jsdom
/** La tarjeta de confirmar el correo dentro de la página del celular: cuándo aparece, qué no rompe y cuándo se va. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import { setLang } from "../idioma";
import { AHORA, SESION, asentar, lectura, lecturasDe, pasar, prepararCelular as preparar, propio } from "./celular-falso";
import type { AccionesDeLaCuenta, DepsDelCelular } from "./celular";
import { MARCA_DEL_CODIGO, PROMESA_VERIFICADA } from "./confirmar-estado";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";

// La tarjeta se baja con import(): con el módulo ya cargado, la espera de la prueba son unos pocos turnos.
await import("./confirmar");

const es = TEXTOS_CONFIRMAR.es;
/** La frase que invita a confirmar: con la promesa apagada dice solo lo que se sabe. */
const CLAVE_LINEA = PROMESA_VERIFICADA ? "ccLinea" : "ccLineaSolo";
const FALTA = lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" });
const LISTA = lectura("lista", { protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true });

const errorDelKit = (code: string, body: Record<string, unknown> = {}): Error => Object.assign(new Error(code), { code, body });

function accionesFalsas(cambios: Partial<AccionesDeLaCuenta> = {}): { [K in keyof AccionesDeLaCuenta]: ReturnType<typeof vi.fn> } & AccionesDeLaCuenta {
  return {
    puedeDesbloqueo: vi.fn(async () => false),
    mandarCodigo: vi.fn(async () => undefined),
    confirmarCodigo: vi.fn(async (): Promise<LecturaDelCelular> => LISTA),
    usarDesbloqueo: vi.fn(async () => true),
    alCambiar: vi.fn(() => () => undefined),
    ...cambios,
  } as never;
}

/** Un reloj que corre solo con el reloj falso, como el de la página de verdad. */
const cada: DepsDelCelular["cada"] = (f, ms) => {
  const reloj = setInterval(f, ms);
  return () => clearInterval(reloj);
};

async function conTarjeta(
  leer: ReturnType<typeof lecturasDe> = lecturasDe(FALTA),
  acciones = accionesFalsas(),
  cambios: Partial<DepsDelCelular> = {},
) {
  const mundo = await preparar({
    sesion: async () => SESION,
    yo: async () => propio(),
    cada,
    cuenta: { leer, confirmar: async () => acciones },
    ...cambios,
  }, true);
  await pasar(3_000);
  return { mundo, acciones, leer };
}

const cuenta = (raiz: HTMLElement): HTMLElement => raiz.querySelector<HTMLElement>("#cmp-cuenta") as HTMLElement;
const principalesVisibles = (raiz: HTMLElement): Element[] => [...raiz.querySelectorAll(".primary")].filter((e) => e.closest("[hidden]") === null);
const apoyoDeAdentro = (raiz: HTMLElement): string => raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent ?? "";
const boton = (raiz: HTMLElement): HTMLButtonElement => cuenta(raiz).querySelector<HTMLButtonElement>(".primary") as HTMLButtonElement;
const campo = (raiz: HTMLElement): HTMLInputElement => cuenta(raiz).querySelector<HTMLInputElement>("input") as HTMLInputElement;

function escribir(raiz: HTMLElement, texto: string): void {
  campo(raiz).value = texto;
  campo(raiz).dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  setLang("es");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("cuándo aparece la tarjeta", () => {
  it("con la cuenta en falta, la espera ofrece una sola acción: Confirmar mi correo", async () => {
    const { mundo } = await conTarjeta();
    expect(cuenta(mundo.raiz).hidden).toBe(false);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
    expect(boton(mundo.raiz).textContent).toBe(es.ccConfirmar);
    expect(mundo.raiz.querySelector("#cmp-cuenta .cmp-cuenta-linea")?.textContent).toBe(es[CLAVE_LINEA]);
    // La línea de apoyo de la espera la reemplaza la de la tarjeta: sigue siendo un título, una línea y un botón.
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-apoyo")).toBeNull();
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(true);
    expect(mundo.raiz.querySelector("#cmp-adentro h1")?.textContent).toBe(TEXTOS_CAMPANA.es.cpAdentro);
  });

  it("sin la tarjeta en las dependencias la página queda como estaba", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(FALTA) } });
    await pasar(3_000);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
  });

  it.each([
    ["lista", LISTA],
    ["otro-con-correo", lectura("otro-con-correo")],
    ["otro-con-desbloqueo", lectura("otro-con-desbloqueo")],
    ["sin-forma", lectura("sin-forma")],
    ["naciendo", lectura("naciendo")],
    ["no-se-sabe", lectura("no-se-sabe")],
    ["falta pero sin forma de mandar el código", lectura("falta", { puedeMandar: false })],
  ])("con la cuenta %s no hay tarjeta", async (_nombre, dicho) => {
    const { mundo } = await conTarjeta(lecturasDe(dicho));
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(false);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("la espera sin la tarjeta no tiene ninguna acción principal", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio() });
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("no aparece en Hola, antes de anotarse", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      cuenta: { leer: lecturasDe(FALTA), confirmar: async () => accionesFalsas() },
    });
    await pasar(3_000);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(false);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
  });

  it("no baja la tarjeta si no hace falta", async () => {
    const confirmar = vi.fn(async () => accionesFalsas());
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(LISTA), confirmar } });
    await pasar(3_000);
    expect(confirmar).not.toHaveBeenCalled();
  });
});

describe("lo que la página no le rompe a la tarjeta", () => {
  it("una respuesta de la sala con un código a medio escribir deja el campo con su valor y su foco", async () => {
    const { mundo } = await conTarjeta();
    boton(mundo.raiz).click();
    await pasar(10);
    escribir(mundo.raiz, "AB12CD");
    campo(mundo.raiz).focus();
    const nodo = campo(mundo.raiz);
    // La sala contesta (cada 24 a 36 segundos) y también cambia el número de personas.
    mundo.deps.yo = async () => ({ ...propio(), total: 38 });
    await pasar(40_000);
    expect(campo(mundo.raiz)).toBe(nodo);
    expect(campo(mundo.raiz).value).toBe("AB12CD");
    expect(document.activeElement).toBe(nodo);
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-contador")?.textContent).toBe("38 personas en la lista");
  });

  it("un cambio de fase repinta la espera pero no la tarjeta", async () => {
    const { mundo } = await conTarjeta();
    const nodo = boton(mundo.raiz);
    mundo.deps.yo = async () => propio("cerrada");
    await pasar(40_000);
    expect(mundo.raiz.querySelector("#cmp-fase")?.textContent).toBe(TEXTOS_CAMPANA.es.cpYaCerro);
    expect(boton(mundo.raiz)).toBe(nodo);
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-apoyo")).toBeNull();
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
  });

  it("el idioma cambia también en la tarjeta", async () => {
    const { mundo } = await conTarjeta();
    setLang("en");
    mundo.vista.pintar();
    expect(boton(mundo.raiz).textContent).toBe(TEXTOS_CONFIRMAR.en.ccConfirmar);
    expect(cuenta(mundo.raiz).querySelector(".cmp-cuenta-linea")?.textContent).toBe(TEXTOS_CONFIRMAR.en[CLAVE_LINEA]);
  });

  it("con un código en juego, la espera pasa a un título chico y la página lo marca", async () => {
    const { mundo } = await conTarjeta();
    boton(mundo.raiz).click();
    await pasar(10);
    expect(mundo.raiz.classList.contains("cmp-con-codigo")).toBe(true);
    expect(cuenta(mundo.raiz).querySelector(".cmp-cuenta-t")?.textContent).toBe(es.ccCodigoT);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
    expect(boton(mundo.raiz).textContent).toBe(es.ccCodigoConfirmar);
  });
});

describe("cuándo se va la tarjeta", () => {
  it("al llegar el resultado se va, también con un código a medio poner, y la marca del código queda", async () => {
    const { mundo } = await conTarjeta();
    boton(mundo.raiz).click();
    await pasar(10);
    escribir(mundo.raiz, "AB12");
    expect(sessionStorage.getItem(MARCA_DEL_CODIGO)).not.toBeNull();
    mundo.deps.yo = async () => ({ ...propio("sorteada"), gano: true });
    await pasar(40_000);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-estado")?.textContent).toContain(TEXTOS_CAMPANA.es.cpGanaste);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(cuenta(mundo.raiz).children).toHaveLength(0);
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(false);
    expect(mundo.raiz.classList.contains("cmp-con-codigo")).toBe(false);
    expect(sessionStorage.getItem(MARCA_DEL_CODIGO)).not.toBeNull();
  });

  it("al desmontar la página la tarjeta se va y no deja relojes", async () => {
    const { mundo } = await conTarjeta();
    mundo.vista.desmontar();
    expect(cuenta(mundo.raiz).children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("al confirmar el correo muestra Listo, a los 4 segundos se va y la espera dice la línea libre, sin leer de nuevo", async () => {
    const { mundo, leer, acciones } = await conTarjeta();
    boton(mundo.raiz).click();
    await pasar(10);
    escribir(mundo.raiz, "ABCD12345");
    boton(mundo.raiz).click();
    await pasar(10);
    expect(acciones.confirmarCodigo).toHaveBeenCalledWith("ABCD12345");
    expect(cuenta(mundo.raiz).querySelector(".cmp-cuenta-linea")?.textContent).toBe(es.ccConfirmadoSolo);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
    // Sigue sin línea de apoyo de la espera mientras se ve Listo.
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-apoyo")).toBeNull();
    await pasar(4_000);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(false);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbiertaLibre);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
    // Lo que contestó el servicio al confirmar alcanza: no hay otra lectura.
    expect(leer).toHaveBeenCalledTimes(1);
    await pasar(10 * 60_000);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("si la cuenta se estaba creando, la tarjeta se va sin decir nada y la lectura se repite a los 10 segundos", async () => {
    const naciendo = errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND", { reason: "this user has no Turnkey wallet" });
    const acciones = accionesFalsas({ mandarCodigo: vi.fn(async () => { throw naciendo; }) });
    const { mundo, leer } = await conTarjeta(lecturasDe(FALTA, FALTA), acciones);
    boton(mundo.raiz).click();
    await pasar(10);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
    expect(leer).toHaveBeenCalledTimes(1);
    await pasar(10_000);
    expect(leer).toHaveBeenCalledTimes(2);
    // La cuenta ya nació: la tarjeta vuelve.
    expect(cuenta(mundo.raiz).hidden).toBe(false);
    expect(boton(mundo.raiz).textContent).toBe(es.ccConfirmar);
  });

  it("si el servicio no está para esto, la tarjeta se va y no vuelve en esta carga", async () => {
    const sinServicio = errorDelKit("SDK_COSIGN_NOT_CONFIGURED", { reason: "no Auth Proxy config" });
    let aviso: () => void = () => undefined;
    const acciones = accionesFalsas({
      mandarCodigo: vi.fn(async () => { throw sinServicio; }),
      alCambiar: vi.fn((cb: () => void) => { aviso = cb; return () => undefined; }),
    });
    const { mundo, leer } = await conTarjeta(lecturasDe(FALTA), acciones);
    boton(mundo.raiz).click();
    await pasar(10);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    // Un aviso de cambio y otra lectura que sigue diciendo falta: ya no se arma.
    aviso();
    await pasar(3_000);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
  });

  it("si otra pestaña confirmó, la lectura siguiente la saca", async () => {
    let aviso: () => void = () => undefined;
    const acciones = accionesFalsas({ alCambiar: vi.fn((cb: () => void) => { aviso = cb; return () => undefined; }) });
    const { mundo, leer } = await conTarjeta(lecturasDe(FALTA, LISTA), acciones);
    expect(cuenta(mundo.raiz).hidden).toBe(false);
    await pasar(4_000);
    aviso();
    await pasar(3_000);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbiertaLibre);
  });

  it("volver a la pestaña o recuperar la conexión con la tarjeta quieta no le pregunta nada al proveedor, pero lo de otra pestaña sí", async () => {
    let aviso: (origen?: "canal" | "kit" | "vista") => void = () => undefined;
    const acciones = accionesFalsas({ alCambiar: vi.fn((cb: (origen?: "canal" | "kit" | "vista") => void) => { aviso = cb; return () => undefined; }) });
    const { leer } = await conTarjeta(lecturasDe(FALTA), acciones);
    expect(leer).toHaveBeenCalledTimes(1);
    await pasar(4_000);
    aviso("vista");
    await pasar(100);
    expect(leer).toHaveBeenCalledTimes(1);
    // Lo que avisa otra pestaña, o el kit, no espera.
    aviso("canal");
    await pasar(100);
    expect(leer).toHaveBeenCalledTimes(2);
    // Ni pasados diez minutos: con la tarjeta quieta, volver a la pestaña o recuperar la conexión no vuelve a leer.
    for (let vuelta = 0; vuelta < 10; vuelta += 1) {
      await pasar(60_000);
      aviso("vista");
      await pasar(100);
    }
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("con un código en juego, volver a la pestaña sí vuelve a leer: es cuando puede haber cambiado la cuenta", async () => {
    let aviso: (origen?: "canal" | "kit" | "vista") => void = () => undefined;
    const acciones = accionesFalsas({ alCambiar: vi.fn((cb: (origen?: "canal" | "kit" | "vista") => void) => { aviso = cb; return () => undefined; }) });
    const { mundo, leer } = await conTarjeta(lecturasDe(FALTA), acciones);
    boton(mundo.raiz).click();
    await pasar(4_000);
    expect(acciones.mandarCodigo).toHaveBeenCalledTimes(1);
    const antes = leer.mock.calls.length;
    aviso("vista");
    await pasar(100);
    expect(leer.mock.calls.length).toBe(antes + 1);
  });

  it("una ráfaga de avisos de cambio vale como una sola lectura", async () => {
    let aviso: () => void = () => undefined;
    const acciones = accionesFalsas({ alCambiar: vi.fn((cb: () => void) => { aviso = cb; return () => undefined; }) });
    const { leer } = await conTarjeta(lecturasDe(FALTA), acciones);
    await pasar(4_000);
    aviso();
    aviso();
    aviso();
    await pasar(100);
    expect(leer).toHaveBeenCalledTimes(2);
  });
});

describe("la tarjeta no se baja si la red falla", () => {
  it("si la tarjeta no baja, la espera sigue como estaba", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio(),
      cuenta: {
        leer: lecturasDe(FALTA),
        confirmar: async () => {
          throw new Error("sin red");
        },
      },
    });
    await pasar(3_000);
    await asentar();
    expect(cuenta(mundo.raiz).hidden).toBe(true);
    expect(apoyoDeAdentro(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpDejaAbierta);
  });
});

describe("las reglas del sorteo y la demostración", () => {
  it("con la tarjeta, las reglas pasan al pie y al irse la tarjeta vuelven a la espera", async () => {
    const { mundo } = await conTarjeta();
    expect(mundo.raiz.querySelectorAll("#cmp-adentro details")).toHaveLength(0);
    expect(mundo.raiz.querySelectorAll("#cmp-pie details")).toHaveLength(1);
    boton(mundo.raiz).click();
    await pasar(10);
    escribir(mundo.raiz, "ABCD12345");
    boton(mundo.raiz).click();
    await pasar(4_100);
    expect(mundo.raiz.querySelectorAll("#cmp-adentro details")).toHaveLength(1);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-pie")?.hidden).toBe(true);
  });

  it("en otra pantalla el pie se esconde", async () => {
    const { mundo } = await conTarjeta();
    mundo.deps.yo = async () => ({ ...propio("sorteada"), gano: true });
    await pasar(40_000);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-pie")?.hidden).toBe(true);
  });

  it("la demostración con estado=confirmar muestra la tarjeta y la termina sin red", async () => {
    const { depsDeDemostracion } = await import("./demostracion");
    const { campanaDeEjemplo } = await import("./ejemplo");
    const { getLang, texto } = await import("../idioma");
    const base = { tx: texto, idioma: getLang, enApp: false, ahora: () => Date.now(), cada, visible: () => true, alVolver: () => () => undefined, vibrar: () => undefined, movimientoReducido: () => false };
    const mundo = await preparar(depsDeDemostracion(base, campanaDeEjemplo(AHORA), "confirmar"), true);
    await pasar(3_000);
    expect(boton(mundo.raiz).textContent).toBe(es.ccConfirmar);
    boton(mundo.raiz).click();
    await pasar(1_000);
    expect(cuenta(mundo.raiz).querySelector(".cmp-cuenta-t")?.textContent).toBe(es.ccCodigoT);
    escribir(mundo.raiz, "DEMO12345");
    boton(mundo.raiz).click();
    await pasar(1_000);
    expect(cuenta(mundo.raiz).querySelector(".cmp-cuenta-linea")?.textContent).toBe(es.ccConfirmadoSolo);
  });
});
