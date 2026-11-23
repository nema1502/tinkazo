// @vitest-environment jsdom
/** La tarjeta de confirmar el correo, armada de verdad en jsdom, con el reloj y la sesión falsos. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import type { AccionesDeLaCuenta } from "./celular";
import { montarTarjeta, RELEER_SI_NACIENDO_MS, RELEER_SI_NO_QUEDO_MS, type DepsDeLaTarjeta, type TarjetaMontada } from "./confirmar";
import { AZAR_DEL_LIMITE_MS, CODIGO_VENCE_A_LOS_MS, ESPERA_POR_LIMITE_MS, HECHO_VISIBLE_MS, MARCA_DEL_CODIGO, PROMESA_VERIFICADA } from "./confirmar-estado";
import { textoDeLimite } from "./limite";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";

const AHORA = Date.UTC(2026, 10, 22, 15);
const es = TEXTOS_CONFIRMAR.es;
const en = TEXTOS_CONFIRMAR.en;
/** Las frases que invitan a confirmar y que siguen al desbloqueo: con la promesa apagada dicen solo lo que se sabe. */
const CLAVE_LINEA = PROMESA_VERIFICADA ? "ccLinea" : "ccLineaSolo";
const CLAVE_DESBLOQUEO_LISTO = PROMESA_VERIFICADA ? "ccDesbloqueoListo" : "ccDesbloqueoListoSolo";
const otroEn = (segundos: number): string => (es.ccOtroCodigoEn ?? "").replace("{s}", String(segundos));

const lectura = (resto: Partial<LecturaDelCelular> = {}): LecturaDelCelular => ({
  estado: "falta",
  protegida: false,
  correoDeLaSesionConfirmado: false,
  puedeMandar: true,
  correoTapado: "a•••@ejemplo.com",
  limite: false,
  ...resto,
});
const LISTA = lectura({ estado: "lista", protegida: true, correoDeLaSesionConfirmado: true });

const errorDelKit = (code: string, body: Record<string, unknown> = {}): Error => Object.assign(new Error(code), { code, body });
const OTP_MALO = errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 400, message: "the OTP code has either expired or is invalid" });

function almacen(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (c) => datos.get(c) ?? null,
    setItem: (c, v) => void datos.set(c, v),
    removeItem: (c) => void datos.delete(c),
  };
}

interface Mundo {
  pagina: HTMLElement;
  seccion: HTMLElement;
  tarjeta: TarjetaMontada;
  deps: DepsDeLaTarjeta;
  acciones: { [K in keyof AccionesDeLaCuenta]: ReturnType<typeof vi.fn> };
  marca: ReturnType<typeof almacen>;
  avisar: () => void;
}

async function montar(cambios: { deps?: Partial<DepsDeLaTarjeta>; acciones?: Partial<AccionesDeLaCuenta>; lectura?: LecturaDelCelular; marca?: string } = {}): Promise<Mundo> {
  document.body.innerHTML = '<main class="cmp"><section id="cmp-cuenta" hidden></section></main>';
  const pagina = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const seccion = document.querySelector<HTMLElement>("#cmp-cuenta") as HTMLElement;
  const marca = almacen();
  if (cambios.marca !== undefined) marca.datos.set(MARCA_DEL_CODIGO, cambios.marca);
  let avisar: () => void = () => undefined;
  const acciones = {
    puedeDesbloqueo: vi.fn(async () => true),
    mandarCodigo: vi.fn(async () => undefined),
    confirmarCodigo: vi.fn(async () => LISTA),
    usarDesbloqueo: vi.fn(async () => true),
    alCambiar: vi.fn((cb: () => void) => {
      avisar = cb;
      return () => undefined;
    }),
    ...cambios.acciones,
  } as unknown as Mundo["acciones"];
  const deps: DepsDeLaTarjeta = {
    txPagina: (clave) => (clave === "cpErrRed" ? "Sin conexión." : clave),
    idioma: () => "es",
    ahora: () => Date.now(),
    cada: (f, ms) => {
      const reloj = setInterval(f, ms);
      return () => clearInterval(reloj);
    },
    visible: () => true,
    enLinea: () => true,
    marca,
    acciones: acciones as unknown as AccionesDeLaCuenta,
    alIrse: vi.fn(),
    alConfirmar: vi.fn(),
    releerEn: vi.fn(),
    releer: vi.fn(),
    ...cambios.deps,
  };
  const tarjeta = montarTarjeta(seccion, pagina, cambios.lectura ?? lectura(), deps);
  await asentar();
  return { pagina, seccion, tarjeta, deps, acciones, marca, avisar: () => avisar() };
}

const asentar = async (): Promise<void> => {
  for (let vuelta = 0; vuelta < 10; vuelta += 1) await Promise.resolve();
};
const pasar = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await asentar();
};

const principal = (m: Mundo): HTMLButtonElement => m.seccion.querySelector<HTMLButtonElement>(".primary") as HTMLButtonElement;
const secundaria = (m: Mundo): HTMLButtonElement => m.seccion.querySelector<HTMLButtonElement>(".cmp-cuenta-otra") as HTMLButtonElement;
const campo = (m: Mundo): HTMLInputElement => m.seccion.querySelector<HTMLInputElement>("input") as HTMLInputElement;
const linea = (m: Mundo): string => m.seccion.querySelector(".cmp-cuenta-linea")?.textContent ?? "";
const nota = (m: Mundo): HTMLElement => m.seccion.querySelector<HTMLElement>(".cmp-cuenta-nota") as HTMLElement;
const visibles = (m: Mundo, selector: string): Element[] => [...m.seccion.querySelectorAll(selector)].filter((e) => !e.hasAttribute("hidden"));

function escribir(m: Mundo, texto: string): void {
  const c = campo(m);
  c.value = texto;
  c.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Del inicio al campo con el código mandado. */
async function conCodigo(m: Mundo): Promise<void> {
  principal(m).click();
  await pasar(10);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("la tarjeta recién abierta", () => {
  it("muestra la línea y una sola acción principal, y el desbloqueo como acción de texto", async () => {
    const m = await montar();
    expect(m.seccion.hidden).toBe(false);
    expect(linea(m)).toBe(es[CLAVE_LINEA]);
    expect(visibles(m, ".primary")).toHaveLength(1);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
    expect(secundaria(m).hidden).toBe(false);
    expect(secundaria(m).textContent).toBe(es.ccDesbloqueo);
    // El campo y el título no están hasta que haya un código.
    expect(campo(m).hidden).toBe(true);
    expect(m.seccion.querySelector<HTMLElement>(".cmp-cuenta-t")?.hidden).toBe(true);
    expect(m.pagina.classList.contains("cmp-con-codigo")).toBe(false);
  });

  it("no ofrece el desbloqueo si la cuenta ya está protegida o el celular no lo ofrece", async () => {
    expect(secundaria(await montar({ lectura: lectura({ protegida: true }) })).hidden).toBe(true);
    expect(secundaria(await montar({ acciones: { puedeDesbloqueo: async () => false } })).hidden).toBe(true);
    expect(secundaria(await montar({ acciones: { puedeDesbloqueo: async () => { throw new Error("no"); } } })).hidden).toBe(true);
  });

  it("en inglés dice sus frases en inglés", async () => {
    const m = await montar({ deps: { idioma: () => "en" } });
    expect(linea(m)).toBe(en[CLAVE_LINEA]);
    expect(principal(m).textContent).toBe(en.ccConfirmar);
  });

  it("el correo de la tarjeta nunca está entero en la página", async () => {
    const m = await montar();
    await conCodigo(m);
    expect(linea(m)).toBe("Te mandamos un código a a•••@ejemplo.com.");
    expect(document.body.textContent).not.toContain("@ejemplo.com.com");
  });
});

describe("mandar el código", () => {
  it("manda una vez, sin pasar ningún correo, y deja el campo listo con el foco", async () => {
    let salir: () => void = () => undefined;
    const m = await montar({ acciones: { mandarCodigo: vi.fn(() => new Promise<void>((resolver) => { salir = resolver; })) } });
    principal(m).click();
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(1);
    expect(m.acciones.mandarCodigo).toHaveBeenCalledWith();
    // Mientras tanto: apagada, con ruedita, y un segundo toque no manda otro.
    expect(principal(m).textContent).toBe(es.ccMandando);
    expect(principal(m).disabled).toBe(true);
    expect(principal(m).getAttribute("aria-busy")).toBe("true");
    principal(m).click();
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(1);
    salir();
    await pasar(10);
    expect(m.seccion.querySelector(".cmp-cuenta-t")?.textContent).toBe(es.ccCodigoT);
    expect(visibles(m, ".cmp-cuenta-t")).toHaveLength(1);
    expect(campo(m).hidden).toBe(false);
    expect(document.activeElement).toBe(campo(m));
    expect(m.pagina.classList.contains("cmp-con-codigo")).toBe(true);
    expect(principal(m).textContent).toBe(es.ccCodigoConfirmar);
    expect(principal(m).disabled).toBe(true);
    expect(principal(m).hasAttribute("aria-busy")).toBe(false);
  });

  it("anota solo la hora del envío, nada de la cuenta ni del correo", async () => {
    const m = await montar();
    await conCodigo(m);
    expect(m.marca.datos.get(MARCA_DEL_CODIGO)).toBe(String(AHORA));
    expect([...m.marca.datos.values()].join("")).not.toContain("ejemplo");
  });

  it("el campo es de letras y números: sin corrector, mayúsculas solas y relleno de un código de una sola vez", async () => {
    const m = await montar();
    await conCodigo(m);
    const c = campo(m);
    expect(c.getAttribute("autocapitalize")).toBe("characters");
    expect(c.getAttribute("autocomplete")).toBe("one-time-code");
    expect(c.getAttribute("inputmode")).toBe("text");
    expect(c.getAttribute("spellcheck")).toBe("false");
    expect(c.maxLength).toBe(24);
    expect(c.getAttribute("aria-label")).toBe(es.ccCodigoCampo);
  });

  it("Confirmar queda apagada con menos de cuatro caracteres", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "AB1");
    expect(principal(m).disabled).toBe(true);
    escribir(m, "AB12");
    expect(principal(m).disabled).toBe(false);
    escribir(m, "   ");
    expect(principal(m).disabled).toBe(true);
  });

  it("sin conexión no llama a nadie, lo dice y la principal vuelve a encenderse", async () => {
    const m = await montar({ deps: { enLinea: () => false } });
    principal(m).click();
    await pasar(10);
    expect(m.acciones.mandarCodigo).not.toHaveBeenCalled();
    expect(nota(m).hidden).toBe(false);
    expect(nota(m).textContent).toBe("Sin conexión.");
    expect(principal(m).disabled).toBe(false);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
  });

  it("si el servicio no contesta en un minuto dice que tarda y deja probar de nuevo", async () => {
    const m = await montar({ acciones: { mandarCodigo: vi.fn(() => new Promise<void>(() => undefined)) } });
    principal(m).click();
    await pasar(60_001);
    expect(nota(m).textContent).toBe(es.ccTarda);
    expect(principal(m).disabled).toBe(false);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
  });

  it("si el código sale después del tope, cuenta igual", async () => {
    let salir: () => void = () => undefined;
    const m = await montar({ acciones: { mandarCodigo: vi.fn(() => new Promise<void>((resolver) => { salir = resolver; })) } });
    principal(m).click();
    await pasar(60_001);
    salir();
    await pasar(10);
    expect(m.seccion.querySelector(".cmp-cuenta-t")?.textContent).toBe(es.ccCodigoT);
    expect(m.marca.datos.has(MARCA_DEL_CODIGO)).toBe(true);
  });

  it("una falla de la red o general lo dice y vuelve a la invitación", async () => {
    const m = await montar({ acciones: { mandarCodigo: vi.fn(async () => { throw new Error("rota"); }) } });
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccFalla);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
    expect(principal(m).disabled).toBe(false);
  });

  it("si el servicio frena por límite, dice cuánto falta con los segundos que dio y apaga la principal solo ese tiempo", async () => {
    const limite = errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 429 });
    const m = await montar({
      acciones: { mandarCodigo: vi.fn(async () => { throw limite; }), segundosDeLimite: vi.fn(() => 20) },
      deps: { azar: () => 0 },
    });
    principal(m).click();
    await pasar(10);
    // El límite es de la conexión que comparten todos: no se le dice a nadie que pidió muchos códigos.
    expect(nota(m).textContent).toBe(textoDeLimite("es", 20));
    expect(nota(m).textContent).not.toBe(es.ccMuchos);
    expect(principal(m).disabled).toBe(true);
    await pasar(10_000);
    expect(nota(m).textContent).toBe(textoDeLimite("es", 10));
    // Un segundo de margen: la tarjeta se pinta con su reloj de un segundo.
    await pasar(11_000);
    expect(principal(m).disabled).toBe(false);
    expect(nota(m).hidden).toBe(true);
  });

  it("sin los segundos del servicio espera la espera corta más unos segundos al azar, no cinco minutos", async () => {
    const limite = errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 429 });
    const m = await montar({ acciones: { mandarCodigo: vi.fn(async () => { throw limite; }) }, deps: { azar: () => 1 } });
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(textoDeLimite("es", (ESPERA_POR_LIMITE_MS + AZAR_DEL_LIMITE_MS) / 1000));
    await pasar(ESPERA_POR_LIMITE_MS + AZAR_DEL_LIMITE_MS + 1_000);
    expect(principal(m).disabled).toBe(false);
  });

  it("un límite al confirmar deja pedir otro código pasado el límite", async () => {
    const limite = errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 429 });
    const m = await montar({
      acciones: { confirmarCodigo: vi.fn(async () => { throw limite; }), segundosDeLimite: vi.fn(() => 15) },
      deps: { azar: () => 0 },
    });
    await conCodigo(m);
    await pasar(61_000);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(textoDeLimite("es", 15));
    expect(secundaria(m).hidden).toBe(true);
    await pasar(16_000);
    expect(secundaria(m).hidden).toBe(false);
    expect(secundaria(m).textContent).toBe(es.ccOtroCodigo);
  });

  it("con la cuenta recién creada, la tarjeta se va sin decir nada y se vuelve a leer a los 10 segundos", async () => {
    const naciendo = errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND", { reason: "this user has no Turnkey wallet" });
    const m = await montar({ acciones: { mandarCodigo: vi.fn(async () => { throw naciendo; }) } });
    principal(m).click();
    await pasar(10);
    expect(m.deps.alIrse).toHaveBeenCalledWith("naciendo");
    expect(m.deps.releerEn).toHaveBeenCalledWith(RELEER_SI_NACIENDO_MS);
    expect(m.seccion.textContent).not.toContain(es.ccFalla);
    expect(m.seccion.hidden).toBe(true);
  });

  it("con la sesión cerrada, la tarjeta se va enseguida y no repite No pudimos mandar el código", async () => {
    const m = await montar({ acciones: { mandarCodigo: vi.fn(async () => { throw new Error("sin-sesion"); }) } });
    principal(m).click();
    await pasar(10);
    expect(m.deps.alIrse).toHaveBeenCalledWith("no-hace-falta");
    expect(m.deps.releerEn).not.toHaveBeenCalled();
    expect(m.seccion.textContent).not.toContain(es.ccFalla);
    expect(m.seccion.hidden).toBe(true);
  });

  it("con la sesión cerrada al confirmar o al usar el desbloqueo, también se va", async () => {
    const alConfirmar = await montar({ acciones: { confirmarCodigo: vi.fn(async () => { throw new Error("sin-sesion"); }) } });
    await conCodigo(alConfirmar);
    escribir(alConfirmar, "ABCD12345");
    principal(alConfirmar).click();
    await pasar(10);
    expect(alConfirmar.deps.alIrse).toHaveBeenCalledWith("no-hace-falta");
    expect(alConfirmar.seccion.hidden).toBe(true);
    const alDesbloquear = await montar({ acciones: { usarDesbloqueo: vi.fn(async () => { throw new Error("sin-sesion"); }) } });
    secundaria(alDesbloquear).click();
    await pasar(10);
    expect(alDesbloquear.deps.alIrse).toHaveBeenCalledWith("no-hace-falta");
    expect(alDesbloquear.seccion.hidden).toBe(true);
  });

  it("con el servicio sin configurar o sin créditos, la tarjeta se va y no vuelve en esta carga", async () => {
    const sinServicio = errorDelKit("SDK_COSIGN_NOT_CONFIGURED", { reason: "no Auth Proxy config" });
    const m = await montar({ acciones: { mandarCodigo: vi.fn(async () => { throw sinServicio; }) } });
    principal(m).click();
    await pasar(10);
    expect(m.deps.alIrse).toHaveBeenCalledWith("no-hace-falta");
    expect(m.deps.releerEn).not.toHaveBeenCalled();
  });
});

describe("reenviar", () => {
  it("el aviso de Spam llega a los 20 segundos y Otro código baja hasta el minuto", async () => {
    const m = await montar();
    await conCodigo(m);
    expect(visibles(m, ".cmp-cuenta-aparte").map((e) => e.textContent)).toEqual([otroEn(60)]);
    await pasar(20_000);
    expect(visibles(m, ".cmp-cuenta-aparte").map((e) => e.textContent)).toEqual([es.ccSpam, otroEn(40)]);
    expect(secundaria(m).hidden).toBe(true);
    await pasar(40_000);
    expect(visibles(m, ".cmp-cuenta-aparte").map((e) => e.textContent)).toEqual([es.ccSpam]);
    expect(secundaria(m).hidden).toBe(false);
    expect(secundaria(m).textContent).toBe(es.ccOtroCodigo);
  });

  it("mandar otro código usa el último y avisa que sirve el del correo más nuevo", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "ABCD12345");
    await pasar(61_000);
    secundaria(m).click();
    await pasar(10);
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(2);
    expect(visibles(m, ".cmp-cuenta-aparte").map((e) => e.textContent)).toContain(es.ccUsaElUltimo);
    // El campo vuelve limpio para el código nuevo.
    expect(campo(m).value).toBe("");
  });

  it("un reenvío que falla deja el código anterior a mano", async () => {
    const mandar = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rota"));
    const m = await montar({ acciones: { mandarCodigo: mandar } });
    await conCodigo(m);
    escribir(m, "ABCD12345");
    await pasar(61_000);
    secundaria(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccFalla);
    expect(campo(m).hidden).toBe(false);
    expect(campo(m).value).toBe("ABCD12345");
    expect(principal(m).textContent).toBe(es.ccCodigoConfirmar);
  });

  it("después de cinco códigos en 15 minutos, el sexto pedido no sale", async () => {
    const m = await montar();
    await conCodigo(m);
    for (let n = 0; n < 4; n += 1) {
      await pasar(61_000);
      secundaria(m).click();
      await pasar(10);
    }
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(5);
    await pasar(61_000);
    secundaria(m).click();
    await pasar(10);
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(5);
    expect(nota(m).textContent).toBe(es.ccMuchos);
    expect(secundaria(m).hidden).toBe(true);
  });
});

describe("confirmar", () => {
  it("manda el código sin espacios, y al quedar confirmada muestra Listo y avisa a la página", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, " ab12 cd345 ");
    principal(m).click();
    expect(m.acciones.confirmarCodigo).toHaveBeenCalledWith("ab12cd345");
    expect(principal(m).textContent).toBe(es.ccConfirmando);
    expect(principal(m).getAttribute("aria-busy")).toBe("true");
    expect(campo(m).disabled).toBe(true);
    await pasar(10);
    expect(linea(m)).toBe(es.ccConfirmadoSolo);
    expect(m.deps.alConfirmar).toHaveBeenCalledWith(LISTA);
    expect(visibles(m, ".primary")).toHaveLength(0);
    // La marca del código ya no hace falta.
    expect(m.marca.datos.has(MARCA_DEL_CODIGO)).toBe(false);
    // A los cuatro segundos la tarjeta se va.
    await pasar(HECHO_VISIBLE_MS);
    expect(m.deps.alIrse).toHaveBeenCalledWith("hecho");
  });

  it("con Enter confirma, y con un código corto no", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "AB1");
    campo(m).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(m.acciones.confirmarCodigo).not.toHaveBeenCalled();
    escribir(m, "AB12CD345");
    campo(m).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(m.acciones.confirmarCodigo).toHaveBeenCalledTimes(1);
  });

  it("un código equivocado se queda en el campo, seleccionado, y deja pedir otro enseguida", async () => {
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(async () => { throw OTP_MALO; }) } });
    await conCodigo(m);
    escribir(m, "MALO12345");
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccCodigoMalo);
    expect(campo(m).value).toBe("MALO12345");
    expect(campo(m).disabled).toBe(false);
    expect(campo(m).selectionStart).toBe(0);
    expect(campo(m).selectionEnd).toBe(9);
    expect(secundaria(m).hidden).toBe(false);
    expect(secundaria(m).textContent).toBe(es.ccOtroCodigo);
  });

  it("pasados cinco minutos del envío, el código que no sirve se dice vencido y la principal pasa a pedir otro", async () => {
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(async () => { throw OTP_MALO; }) } });
    await conCodigo(m);
    escribir(m, "VIEJO1234");
    await pasar(CODIGO_VENCE_A_LOS_MS + 1_000);
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccCodigoVencido);
    expect(campo(m).hidden).toBe(true);
    expect(campo(m).value).toBe("");
    expect(principal(m).textContent).toBe(es.ccOtroCodigo);
    expect(principal(m).disabled).toBe(false);
  });

  it("un código que la página ya no tiene se dice viejo y deja pedir otro", async () => {
    const sinCodigo = errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND", { reason: "no code was sent" });
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(async () => { throw sinCodigo; }) } });
    await conCodigo(m);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccCodigoViejo);
    expect(principal(m).textContent).toBe(es.ccOtroCodigo);
  });

  it("con la cuenta recién creada al confirmar, la tarjeta se va sin decir que pida otro código", async () => {
    const naciendo = errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND", { reason: "this user has no Turnkey wallet" });
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(async () => { throw naciendo; }) } });
    await conCodigo(m);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    expect(m.deps.alIrse).toHaveBeenCalledWith("naciendo");
    expect(m.deps.releerEn).toHaveBeenCalledWith(RELEER_SI_NACIENDO_MS);
    expect(m.seccion.textContent).not.toContain(es.ccCodigoViejo);
  });

  it("sin conexión no confirma, lo dice y deja el código escrito", async () => {
    let enLinea = true;
    const m = await montar({ deps: { enLinea: () => enLinea } });
    await conCodigo(m);
    escribir(m, "ABCD12345");
    enLinea = false;
    principal(m).click();
    await pasar(10);
    expect(m.acciones.confirmarCodigo).not.toHaveBeenCalled();
    expect(nota(m).textContent).toBe("Sin conexión.");
    expect(campo(m).value).toBe("ABCD12345");
    expect(principal(m).disabled).toBe(false);
  });

  it("si el servicio dice que todavía no quedó confirmada, lo dice y vuelve a leer a los 5 segundos", async () => {
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(async () => lectura({ protegida: true })) } });
    await conCodigo(m);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccNoQuedo);
    expect(m.deps.releerEn).toHaveBeenCalledWith(RELEER_SI_NO_QUEDO_MS);
    expect(m.deps.alConfirmar).not.toHaveBeenCalled();
    expect(campo(m).disabled).toBe(false);
  });

  it("una respuesta que llega pasado el tope y dice que quedó confirmada cuenta igual", async () => {
    let contestar: (l: LecturaDelCelular) => void = () => undefined;
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(() => new Promise<LecturaDelCelular>((resolver) => { contestar = resolver; })) } });
    await conCodigo(m);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(60_001);
    expect(nota(m).textContent).toBe(es.ccTarda);
    contestar(LISTA);
    await pasar(10);
    expect(linea(m)).toBe(es.ccConfirmadoSolo);
    expect(m.deps.alConfirmar).toHaveBeenCalledWith(LISTA);
  });

  it("un toque doble en Confirmar confirma una vez", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "ABCD12345");
    principal(m).click();
    principal(m).click();
    expect(m.acciones.confirmarCodigo).toHaveBeenCalledTimes(1);
  });
});

describe("la página que se recarga y el que se va a mirar el correo", () => {
  it("con una marca de menos de cinco minutos abre pidiendo otro código y avisando que la página se recargó", async () => {
    const m = await montar({ marca: String(AHORA - 60_000) });
    expect(nota(m).textContent).toBe(es.ccCodigoRecargado);
    expect(principal(m).textContent).toBe(es.ccOtroCodigo);
    expect(principal(m).disabled).toBe(false);
    expect(campo(m).hidden).toBe(true);
  });

  it("con una marca de más de cinco minutos la ignora y la borra", async () => {
    const m = await montar({ marca: String(AHORA - CODIGO_VENCE_A_LOS_MS - 1_000) });
    expect(nota(m).hidden).toBe(true);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
    expect(m.marca.datos.has(MARCA_DEL_CODIGO)).toBe(false);
  });

  it("sin la marca de almacenamiento tampoco se rompe", async () => {
    const m = await montar({ deps: { marca: null } });
    await conCodigo(m);
    expect(campo(m).hidden).toBe(false);
  });

  it("al volver a la pestaña con un código mandado, el campo recibe el foco y no pierde lo escrito", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "ABCD");
    (document.activeElement as HTMLElement).blur();
    m.tarjeta.alVolver();
    expect(document.activeElement).toBe(campo(m));
    expect(campo(m).value).toBe("ABCD");
  });

  it("repintar la tarjeta no pierde lo escrito ni el foco", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "AB12CD");
    campo(m).focus();
    m.tarjeta.pintar();
    m.tarjeta.alLeer(lectura());
    await asentar();
    expect(campo(m).value).toBe("AB12CD");
    expect(document.activeElement).toBe(campo(m));
  });

  it("con el teclado abierto la página lo sabe, y al soltar el campo vuelve todo", async () => {
    const m = await montar();
    await conCodigo(m);
    campo(m).dispatchEvent(new Event("focus"));
    expect(m.pagina.classList.contains("cmp-teclado")).toBe(true);
    campo(m).dispatchEvent(new Event("blur"));
    expect(m.pagina.classList.contains("cmp-teclado")).toBe(false);
  });

  it("con el campo apagado mientras confirma, la página no se queda plegada como si el teclado siguiera abierto", async () => {
    let contestar: (l: LecturaDelCelular) => void = () => undefined;
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(() => new Promise<LecturaDelCelular>((r) => { contestar = r; })) } });
    await conCodigo(m);
    campo(m).dispatchEvent(new Event("focus"));
    expect(m.pagina.classList.contains("cmp-teclado")).toBe(true);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    expect(campo(m).disabled).toBe(true);
    // El navegador no siempre avisa que un campo apagado perdió el foco: sin esto la espera y el pie quedaban escondidos.
    expect(m.pagina.classList.contains("cmp-teclado")).toBe(false);
    contestar(LISTA);
    await pasar(10);
  });

  it("con la tarjeta oculta tampoco queda el teclado marcado", async () => {
    const m = await montar({ acciones: { confirmarCodigo: vi.fn(async () => { throw new Error("sin-sesion"); }) } });
    await conCodigo(m);
    campo(m).dispatchEvent(new Event("focus"));
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    expect(m.seccion.hidden).toBe(true);
    expect(m.pagina.classList.contains("cmp-teclado")).toBe(false);
  });

  it("con una nota la página se achica para que la acción de texto quede a la vista, y sin nota vuelve", async () => {
    const m = await montar({ marca: String(AHORA - 30_000) });
    expect(nota(m).textContent).toBe(es.ccCodigoRecargado);
    expect(m.pagina.classList.contains("cmp-con-nota")).toBe(true);
    // Sin un código en juego no es la página del código: solo se achica la espera.
    expect(m.pagina.classList.contains("cmp-con-codigo")).toBe(false);
    principal(m).click();
    await pasar(10);
    expect(nota(m).hidden).toBe(true);
    expect(m.pagina.classList.contains("cmp-con-nota")).toBe(false);
    m.tarjeta.destruir(false);
    expect(m.pagina.classList.contains("cmp-con-nota")).toBe(false);
  });

  it("cerrar la sesión olvida la marca y deja la página limpia", async () => {
    const m = await montar();
    await conCodigo(m);
    campo(m).dispatchEvent(new Event("focus"));
    m.tarjeta.destruir(true);
    expect(m.marca.datos.has(MARCA_DEL_CODIGO)).toBe(false);
    expect(m.seccion.hidden).toBe(true);
    expect(m.seccion.children).toHaveLength(0);
    expect(m.pagina.classList.contains("cmp-con-codigo")).toBe(false);
    expect(m.pagina.classList.contains("cmp-teclado")).toBe(false);
  });

  it("salir de la espera con un código mandado deja la marca: el código sigue sirviendo desde Recibir", async () => {
    const m = await montar();
    await conCodigo(m);
    m.tarjeta.destruir(false);
    expect(m.marca.datos.has(MARCA_DEL_CODIGO)).toBe(true);
  });

  it("una tarjeta destruida no responde a nada de lo que llegue después", async () => {
    let salir: () => void = () => undefined;
    const m = await montar({ acciones: { mandarCodigo: vi.fn(() => new Promise<void>((resolver) => { salir = resolver; })) } });
    principal(m).click();
    m.tarjeta.destruir(false);
    salir();
    await pasar(10);
    expect(m.seccion.children).toHaveLength(0);
    expect(m.marca.datos.has(MARCA_DEL_CODIGO)).toBe(false);
  });
});

describe("el desbloqueo del celular", () => {
  it("al quedar listo dice que ya sirve en este celular y sigue pidiendo el correo", async () => {
    const m = await montar();
    secundaria(m).click();
    expect(m.acciones.usarDesbloqueo).toHaveBeenCalledTimes(1);
    expect(principal(m).textContent).toBe(es.ccDesbloqueo);
    expect(principal(m).disabled).toBe(true);
    expect(principal(m).getAttribute("aria-busy")).toBe("true");
    await pasar(10);
    expect(linea(m)).toBe(es[CLAVE_DESBLOQUEO_LISTO]);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
    expect(secundaria(m).hidden).toBe(true);
    expect(m.deps.releer).toHaveBeenCalled();
    expect(m.deps.alConfirmar).not.toHaveBeenCalled();
    // Y desde ahí el código sale como siempre.
    principal(m).click();
    await pasar(10);
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(1);
  });

  it("a los 8 segundos sin respuesta dice que espera la huella o la clave", async () => {
    const m = await montar({ acciones: { usarDesbloqueo: vi.fn(() => new Promise<boolean>(() => undefined)) } });
    secundaria(m).click();
    expect(linea(m)).toBe(es[CLAVE_LINEA]);
    await pasar(8_000);
    expect(linea(m)).toBe(es.ccEsperandoDesbloqueo);
  });

  it("a los 8 segundos sin respuesta ofrece Confirmar mi correo, y tocarlo manda el código sin esperar al desbloqueo", async () => {
    const m = await montar({ acciones: { usarDesbloqueo: vi.fn(() => new Promise<boolean>(() => undefined)) } });
    secundaria(m).click();
    expect(secundaria(m).hidden).toBe(true);
    await pasar(8_000);
    expect(secundaria(m).hidden).toBe(false);
    expect(secundaria(m).textContent).toBe(es.ccConfirmar);
    expect(visibles(m, ".primary")).toHaveLength(1);
    secundaria(m).click();
    await pasar(10);
    expect(m.acciones.mandarCodigo).toHaveBeenCalledTimes(1);
    expect(campo(m).hidden).toBe(false);
    expect(linea(m)).toContain("a•••@ejemplo.com");
  });

  it("si el navegador no lo deja abrir lo dice, manda al correo y no lo vuelve a ofrecer", async () => {
    const noDeja = Object.assign(new Error("denegado"), { name: "NotAllowedError" });
    const m = await montar({ acciones: { usarDesbloqueo: vi.fn(async () => { throw noDeja; }) } });
    secundaria(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccDesbloqueoBloqueado);
    expect(secundaria(m).hidden).toBe(true);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
    m.tarjeta.alLeer(lectura());
    expect(secundaria(m).hidden).toBe(true);
  });

  it("si la persona cancela vuelve a la invitación sin ningún error", async () => {
    const cancelada = new Error("passkey-cancelada");
    const m = await montar({ acciones: { usarDesbloqueo: vi.fn(async () => { throw cancelada; }) } });
    secundaria(m).click();
    await pasar(10);
    expect(nota(m).hidden).toBe(true);
    expect(secundaria(m).hidden).toBe(false);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
  });

  it("si no queda protegida o falla de otra manera, lo dice y vuelve a la invitación", async () => {
    const m = await montar({ acciones: { usarDesbloqueo: vi.fn(async () => false) } });
    secundaria(m).click();
    await pasar(10);
    expect(nota(m).textContent).toBe(es.ccFalla);
    expect(principal(m).textContent).toBe(es.ccConfirmar);
  });
});

describe("cuando la cuenta se lee de nuevo", () => {
  it("con la cuenta lista, con otra forma de entrar o sin forma, la tarjeta ya no hace falta", async () => {
    for (const estado of ["lista", "otro-con-correo", "otro-con-desbloqueo", "sin-forma"] as const) {
      const m = await montar();
      m.tarjeta.alLeer(lectura({ estado }));
      expect(m.deps.alIrse, estado).toHaveBeenCalledWith("no-hace-falta");
      expect(m.seccion.hidden, estado).toBe(true);
    }
  });

  it("con una duda (se está creando o no se sabe) se queda", async () => {
    for (const estado of ["naciendo", "no-se-sabe"] as const) {
      const m = await montar();
      await conCodigo(m);
      m.tarjeta.alLeer(lectura({ estado, puedeMandar: false }));
      expect(m.deps.alIrse, estado).not.toHaveBeenCalled();
      expect(campo(m).hidden, estado).toBe(false);
    }
  });

  it("si ya no se puede mandar el código, se va", async () => {
    const m = await montar();
    m.tarjeta.alLeer(lectura({ puedeMandar: false }));
    expect(m.deps.alIrse).toHaveBeenCalledWith("no-hace-falta");
  });

  it("si la cuenta quedó protegida con el desbloqueo en otra pestaña, no se ofrece más", async () => {
    const m = await montar();
    expect(secundaria(m).hidden).toBe(false);
    m.tarjeta.alLeer(lectura({ protegida: true }));
    expect(secundaria(m).hidden).toBe(true);
  });

  it("mientras muestra Listo no se va por una lectura que llega en el medio", async () => {
    const m = await montar();
    await conCodigo(m);
    escribir(m, "ABCD12345");
    principal(m).click();
    await pasar(10);
    m.tarjeta.alLeer(lectura());
    m.tarjeta.alLeer(LISTA);
    expect(linea(m)).toBe(es.ccConfirmadoSolo);
    expect(m.deps.alIrse).not.toHaveBeenCalledWith("no-hace-falta");
  });

  it("un aviso de que la cuenta cambió (otra pestaña, volver a esta) pide leerla de nuevo", async () => {
    const m = await montar();
    m.avisar();
    expect(m.deps.releer).toHaveBeenCalledTimes(1);
  });
});

describe("el reloj de la tarjeta", () => {
  it("con la pestaña escondida no repinta, y al volver se pone al día", async () => {
    let visible = true;
    const m = await montar({ deps: { visible: () => visible } });
    await conCodigo(m);
    visible = false;
    await pasar(25_000);
    expect(visibles(m, ".cmp-cuenta-aparte").map((e) => e.textContent)).toEqual([otroEn(60)]);
    visible = true;
    await pasar(1_000);
    expect(visibles(m, ".cmp-cuenta-aparte").map((e) => e.textContent)).toContain(es.ccSpam);
  });

  it("una vez destruida suelta el reloj", async () => {
    const m = await montar();
    await conCodigo(m);
    m.tarjeta.destruir(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("las notas del servicio se anuncian y las frases no repiten el mismo texto cuando no cambia", async () => {
    const m = await montar();
    await conCodigo(m);
    const parrafo = m.seccion.querySelector(".cmp-cuenta-linea") as HTMLElement;
    const nodo = parrafo.firstChild;
    await pasar(5_000);
    expect(parrafo.firstChild).toBe(nodo);
    expect(parrafo.getAttribute("aria-live")).toBe("polite");
    expect(nota(m).getAttribute("role")).toBe("status");
  });
});

describe("avisar a la página si la confirmación está en curso", () => {
  it("avisa al empezar a confirmar y al terminar, y solo cuando cambia", async () => {
    const alCambiarElCurso = vi.fn();
    const m = await montar({ deps: { alCambiarElCurso } });
    expect(m.tarjeta.enCurso()).toBe(false);
    expect(alCambiarElCurso).not.toHaveBeenCalled();
    await conCodigo(m);
    expect(m.tarjeta.enCurso()).toBe(true);
    const alEmpezar = alCambiarElCurso.mock.calls.length;
    expect(alEmpezar).toBeGreaterThanOrEqual(1);
    // Repintar con el mismo estado no vuelve a avisar.
    await pasar(5_000);
    expect(alCambiarElCurso).toHaveBeenCalledTimes(alEmpezar);
    escribir(m, "ABCD1234E");
    principal(m).click();
    await pasar(10);
    await pasar(HECHO_VISIBLE_MS + 100);
    expect(m.tarjeta.enCurso()).toBe(false);
    expect(alCambiarElCurso.mock.calls.length).toBeGreaterThan(alEmpezar);
  });

  it("una página recargada con un código en camino empieza en curso", async () => {
    const m = await montar({ marca: String(AHORA - 60_000) });
    expect(m.tarjeta.enCurso()).toBe(true);
  });
});
