// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T, setLang, t } from "../i18n";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type CuentaDelPaso, GUARDA_DE_TOQUE_MS, MARCA_CODIGO, TOPE_CERRAR_MS, type OpcionesDelPaso, type SalidasDelPaso, abrirCuentaLista, aceptarClicsDePrueba, cuentaListaAbierta } from "./cuenta-lista";

/**
 * «Dejá tu cuenta lista» (`cuenta-lista.ts`) contra una cuenta simulada: sin Pollar, sin red. Lo que se mira es lo que ve
 * y puede hacer la persona: una sola acción principal, que no se puede seguir en Oficial sin la cuenta lista, que las
 * salidas funcionan siempre, el foco y el teclado, y que cada error dice lo suyo y ofrece su arreglo.
 */

type Est = EstadoOficial;
const NUEVA: Est = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };

function cuentaSimulada(inicial: Partial<Est> = {}, partes: Partial<CuentaDelPaso> = {}) {
  const llamadas: string[] = [];
  const estado = { est: { ...NUEVA, ...inicial } as Est };
  const avisos = new Set<() => void>();
  const cuenta: CuentaDelPaso = {
    estadoOficial: vi.fn(async () => {
      llamadas.push("estadoOficial");
      return { ...estado.est };
    }),
    activarCuenta: vi.fn(async () => {
      llamadas.push("activarCuenta");
      estado.est = { ...estado.est, activacion: "lista" };
      return "activada" as const;
    }),
    alCambiarLaCuenta: (cb) => {
      avisos.add(cb);
      return () => avisos.delete(cb);
    },
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => {
      llamadas.push("aparatoDesbloqueo");
      estado.est = { ...estado.est, proteccion: "lista" };
      return true;
    }),
    mandarCodigoParaEsteAparato: vi.fn(async () => void llamadas.push("aparatoMandar")),
    confirmarCodigoParaEsteAparato: vi.fn(async (c: string) => {
      llamadas.push(`aparatoConfirmar:${c}`);
      estado.est = { ...estado.est, proteccion: "lista" };
      return true;
    }),
    protegerConPasskey: vi.fn(async () => {
      llamadas.push("passkey");
      estado.est = { ...estado.est, proteccion: "lista" };
      return true;
    }),
    mandarCodigoDeProteccion: vi.fn(async (m: string) => void llamadas.push(`mandar:${m}`)),
    confirmarCodigoDeProteccion: vi.fn(async (c: string) => {
      llamadas.push(`confirmar:${c}`);
      estado.est = { ...estado.est, proteccion: "lista" };
      return true;
    }),
    ...partes,
  };
  return { cuenta, llamadas, estado, avisar: () => avisos.forEach((f) => f()) };
}

function salidasSimuladas(puede = true) {
  const s = {
    cerrarSesion: vi.fn(async () => undefined),
    pasarAPrueba: vi.fn(),
    puedePasarAPrueba: vi.fn(() => puede),
    entrarDeNuevo: vi.fn(),
  } satisfies SalidasDelPaso;
  return s;
}

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const botones = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const boton = (texto: string): HTMLButtonElement => {
  const b = botones().find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay botón "${texto}": ${botones().map((x) => x.textContent).join(" | ")}`);
  return b;
};
const hayBoton = (texto: string): boolean => botones().some((x) => x.textContent === texto);
const alerta = (): string => [...(raiz()?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])].map((x) => x.textContent).join(" ");
const textoDe = (): string => raiz()?.textContent ?? "";
const esc = (): boolean => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const escribir = (sel: string, valor: string): void => {
  const c = raiz()?.querySelector<HTMLInputElement>(sel) as HTMLInputElement;
  c.value = valor;
  c.dispatchEvent(new Event("input", { bubbles: true }));
};

async function abrir(inicial: Partial<Est> = {}, o: Partial<OpcionesDelPaso> = {}, partes: Partial<CuentaDelPaso> = {}, puede = true) {
  const sim = cuentaSimulada(inicial, partes);
  const salidas = salidasSimuladas(puede);
  const promesa = abrirCuentaLista(sim.cuenta, salidas, { para: "entrada", correo: "nora@gmail.com", aviso: "Entraste con Google como Nora.", celular: false, inicial, ...o });
  await pasa();
  return { ...sim, salidas, promesa };
}

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<header id="cab">cabecera</header><main id="pagina"><button id="btn-freeze">Sellar la lista</button><button id="btn-pegar">Pegar lista</button></main>`;
  try {
    sessionStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});

afterEach(async () => {
  // Si una prueba dejó el paso abierto, se cierra con su salida.
  if (raiz()) {
    const b = botones().find((x) => x.textContent === t("acctSignOut"));
    b?.click();
    await vi.advanceTimersByTimeAsync(10);
  }
  aceptarClicsDePrueba(false);
  vi.useRealTimers();
});

describe("la forma del paso", () => {
  it("tapa todo: los hermanos quedan inertes, una sola principal (la única magenta) y con el foco", async () => {
    await abrir();
    expect(raiz()?.getAttribute("role")).toBe("dialog");
    expect(raiz()?.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById("cab")?.inert).toBe(true);
    expect(document.getElementById("pagina")?.inert).toBe(true);
    expect(document.documentElement.classList.contains("con-cuenta-lista")).toBe(true);
    expect(raiz()?.querySelectorAll(".cl-principal").length).toBe(1);
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(document.activeElement).toBe(principal());
    expect(textoDe()).toContain("Entraste con Google como Nora.");
    expect(textoDe()).toContain(t("clTitulo"));
  });

  it("no hay «Ahora no» ni X, y Escape no cierra: lleva el foco a «Pasar a Prueba»", async () => {
    await abrir();
    expect(hayBoton("Ahora no")).toBe(false);
    expect(raiz()?.querySelector(".acct-x, [aria-label='Cerrar']")).toBeNull();
    esc();
    await pasa(10);
    expect(raiz()).not.toBeNull();
    expect(document.activeElement?.textContent).toBe(t("modeSwitchToTest"));
  });

  it("un toque simulado (no de una persona) o uno apenas se abre no hace nada", async () => {
    const sim = cuentaSimulada();
    const salidas = salidasSimuladas();
    void abrirCuentaLista(sim.cuenta, salidas, { para: "entrada", celular: false });
    await vi.advanceTimersByTimeAsync(10);
    // Antes de 500 ms: el Enter del código de entrada que cae en el paso recién abierto.
    principal().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sim.cuenta.activarCuenta).not.toHaveBeenCalled();
    await pasa();
    aceptarClicsDePrueba(false);
    principal().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sim.cuenta.activarCuenta).not.toHaveBeenCalled();
    aceptarClicsDePrueba(true);
    principal().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sim.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("si ya hay uno abierto, devuelve el mismo y sube el motivo", async () => {
    const { promesa, cuenta } = await abrir();
    const otra = abrirCuentaLista(cuenta, salidasSimuladas(), { para: "sello" });
    expect(document.querySelectorAll(".cuenta-lista").length).toBe(1);
    expect(cuentaListaAbierta()).toBe(true);
    void promesa;
    void otra;
  });
});

describe("la sucesión de una cuenta nueva", () => {
  it("activar, proteger con el desbloqueo del celular y seguir: resuelve true y corre lo del final dentro del toque", async () => {
    const alSeguir = vi.fn();
    const { promesa, llamadas } = await abrir({}, { celular: true, puedeUsarDesbloqueo: async () => true, alSeguir });
    principal().click();
    await pasa();
    expect(llamadas).toContain("activarCuenta");
    expect(textoDe()).toContain(t("clActivada"));
    expect(principal().textContent).toBe(t("clDesbloqueoCel"));
    principal().click();
    await pasa();
    expect(llamadas).toContain("passkey");
    expect(principal().textContent).toBe(t("clSeguir"));
    expect(textoDe()).toContain(t("clListaTitulo"));
    // Al final no hay salidas.
    expect(hayBoton(t("modeSwitchToTest"))).toBe(false);
    principal().click();
    expect(alSeguir).toHaveBeenCalledTimes(1);
    await expect(promesa).resolves.toBe(true);
    expect(raiz()).toBeNull();
    expect(document.getElementById("cab")?.inert).toBe(false);
  });

  it("un voto que queda pendiente no se repite: se espera leyendo, y a los 60 segundos dice que tarda", async () => {
    const { llamadas, cuenta } = await abrir({}, {}, { activarCuenta: vi.fn(async () => "pendiente" as const) });
    principal().click();
    await pasa(9_000);
    expect(textoDe()).toContain(t("clActivarLento"));
    await pasa(60_000);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(llamadas.filter((x) => x === "estadoOficial").length).toBeGreaterThan(3);
    // «Probar de nuevo» solo lee.
    principal().click();
    await pasa();
    expect(cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["pollar-activacion-tope", "clErrTope", "clSalirYEntrar"],
    ["pollar-activacion-rara", "clErrRara", "clProbarDeNuevo"],
    ["pollar-activacion-fallo", "clErrFallo", "clProbarDeNuevo"],
    ["SDK_NETWORK_TIMEOUT", "clErrRed", "clProbarDeNuevo"],
    ["SDK_CREDITS_INSUFFICIENT", "clErrServicio", "clProbarDeNuevo"],
  ])("si la activación falla con %s: su mensaje y su arreglo", async (codigo, clave, arreglo) => {
    await abrir({}, {}, { activarCuenta: vi.fn(async () => Promise.reject(new Error(codigo))) });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t(clave));
    expect(principal().textContent).toBe(t(arreglo));
  });

  it("«Cerrar sesión y entrar de nuevo» cierra la sesión y abre la entrada", async () => {
    const { salidas, promesa } = await abrir({}, {}, { activarCuenta: vi.fn(async () => Promise.reject(new Error("pollar-activacion-tope"))) });
    principal().click();
    await pasa();
    principal().click();
    await pasa(10);
    expect(salidas.cerrarSesion).toHaveBeenCalledTimes(1);
    expect(salidas.entrarDeNuevo).toHaveBeenCalledTimes(1);
    await expect(promesa).resolves.toBe(false);
  });

  it("sin pedido todavía: «Revisando…» 20 segundos y después lo dice; la segunda vez, cerrar sesión y entrar de nuevo", async () => {
    await abrir({ activacion: "preparando" });
    expect(principal().textContent).toBe(t("clRevisando"));
    await pasa(25_000);
    expect(alerta()).toContain(t("clErrSinPedido"));
    principal().click();
    await pasa(25_000);
    expect(alerta()).toContain(t("clErrSinPedidoFin"));
    expect(principal().textContent).toBe(t("clSalirYEntrar"));
  });

  it("sin red al leer: lo dice y deja probar de nuevo", async () => {
    await abrir({}, {}, { estadoOficial: vi.fn(async () => Promise.reject(new Error("Failed to fetch"))) });
    expect(alerta()).toContain(t("clErrRed"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
  });

  it("la sesión se cerró: pide entrar de nuevo", async () => {
    await abrir({}, {}, { sesionViva: () => false });
    expect(alerta()).toContain(t("clErrSesion"));
    expect(principal().textContent).toBe(t("clEntrarDeNuevo"));
  });
});

describe("proteger con el correo", () => {
  it("mandar, código malo, vencido, y el bueno; el código se confirma con Enter", async () => {
    const malos = ["SDK_INVALID_OTP", "OTP EXPIRED"];
    const ref: { estado?: { est: Est } } = {};
    const confirmar = vi.fn(async (c: string) => {
      const e = malos.shift();
      if (e) throw new Error(e);
      if (c === "123456" && ref.estado) ref.estado.est = { ...ref.estado.est, proteccion: "lista" };
      return c === "123456";
    });
    const { llamadas, promesa, estado } = await abrir({ activacion: "lista" }, {}, { confirmarCodigoDeProteccion: confirmar });
    ref.estado = estado;
    expect(principal().textContent).toBe(t("clMandarA").replace("{mail}", "n•••@gmail.com"));
    principal().click();
    await pasa();
    expect(llamadas).toContain("mandar:nora@gmail.com");
    expect(textoDe()).toContain(t("protCodeTitulo"));
    expect(principal().disabled).toBe(true);
    // «Confirmar» espera el código: apagada, pero no ocupada.
    expect(principal().hasAttribute("aria-busy")).toBe(false);
    escribir("#cl-codigo", "11 11");
    expect(principal().disabled).toBe(false);
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("protBadCode"));
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clCodigoVencido"));
    expect(principal().textContent).toBe(t("protOtroCodigo"));
    principal().click();
    await pasa();
    escribir("#cl-codigo", "123456");
    (raiz()?.querySelector(".cl-form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await pasa();
    expect(confirmar.mock.calls.map((c) => c[0])).toEqual(["1111", "1111", "123456"]);
    expect(textoDe()).toContain(t("clListaTitulo"));
    expect(sessionStorage.getItem(MARCA_CODIGO)).toBeNull();
    principal().click();
    await expect(promesa).resolves.toBe(true);
  });

  it("el código del correo es de letras y números: el campo abre el teclado de texto, en mayúsculas y sin corrector", async () => {
    await abrir({ activacion: "lista" });
    principal().click();
    await pasa();
    const c = raiz()?.querySelector<HTMLInputElement>("#cl-codigo") as HTMLInputElement;
    expect(c.getAttribute("inputmode")).toBe("text");
    expect(c.getAttribute("autocapitalize")).toBe("characters");
    expect(c.getAttribute("autocorrect")).toBe("off");
    expect(c.getAttribute("spellcheck")).toBe("false");
    expect(c.autocomplete).toBe("one-time-code");
    // Nada que sugiera seis números, y lugar de sobra para lo pegado con espacios.
    expect(c.placeholder).not.toMatch(/\d|^•{6}$/);
    expect(c.maxLength).toBeGreaterThanOrEqual(16);
  });

  it("al confirmar, los espacios de más se sacan y las letras quedan como las escribió la persona", async () => {
    const confirmar = vi.fn(async (_c: string) => true);
    await abrir({ activacion: "lista" }, {}, { confirmarCodigoDeProteccion: confirmar });
    principal().click();
    await pasa();
    escribir("#cl-codigo", "  aB3d 9fGh7 ");
    principal().click();
    await pasa();
    expect(confirmar.mock.calls.map((c) => c[0])).toEqual(["aB3d9fGh7"]);
  });

  // El servicio de códigos contestó 500 con {"code":2,"message":"turnkey: the OTP code has either expired or is invalid
  // (status=401)"} y el SDK de Pollar (`authProxy`) lo lanza como un `PollarApiError`: su `message` es solo el código
  // `SDK_COSIGN_TURNKEY_REJECTED` y lo que dijo el servicio queda en `body.message`.
  describe.each([
    ["proteger la cuenta", { activacion: "lista" as const }, "confirmarCodigoDeProteccion" as const],
    ["sumar este navegador", { proteccion: "aparato-nuevo" as const, correoConfirmado: true, correoDeLaCuenta: "cuenta@mail.com", unicoNavegador: false }, "confirmarCodigoParaEsteAparato" as const],
  ])("el servicio de códigos rechaza el código (%s)", (_nombre, inicial, metodo) => {
    const rechazo = async (mensaje: string) => {
      const { PollarApiError } = await import("@pollar/core");
      return new PollarApiError("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 500, message: mensaje });
    };

    it("si dice que el código venció o no sirve, sale el aviso del código y no el genérico", async () => {
      const error = await rechazo("turnkey: the OTP code has either expired or is invalid (status=401)");
      const confirmar = vi.fn(async (_c: string): Promise<boolean> => {
        throw error;
      });
      await abrir(inicial, {}, { [metodo]: confirmar });
      principal().click();
      await pasa();
      escribir("#cl-codigo", "AB12CD34E");
      principal().click();
      await pasa();
      expect(confirmar).toHaveBeenCalledTimes(1);
      expect(alerta()).toContain(t("protBadCode"));
      expect(alerta()).not.toContain(t("protFalla"));
      // Sigue el campo del código para volver a probar.
      expect(raiz()?.querySelector("#cl-codigo")).not.toBeNull();
    });

    it("si el servicio rechaza por otra cosa, sigue el aviso genérico: no se culpa al código sin evidencia", async () => {
      const error = await rechazo("turnkey: internal error (status=500)");
      await abrir(inicial, {}, { [metodo]: vi.fn(async (_c: string): Promise<boolean> => { throw error; }) });
      principal().click();
      await pasa();
      escribir("#cl-codigo", "AB12CD34E");
      principal().click();
      await pasa();
      expect(alerta()).toContain(t("protFalla"));
      expect(alerta()).not.toContain(t("protBadCode"));
    });
  });

  it("los textos del código dicen cómo es y que puede estar vencido, en las dos lenguas", () => {
    expect(T.es.protBadCode).toBe("Ese código no es o ya venció. Pedí otro y usalo enseguida.");
    expect(T.en.protBadCode).toBe("That code is wrong or has expired. Ask for another one and use it right away.");
    expect(T.es.clCorreoLlega).toBe("El correo puede venir en inglés. El código tiene letras y números, y vence en pocos minutos.");
    expect(T.en.clCorreoLlega).toBe("The email may come in English. The code has letters and numbers, and expires in a few minutes.");
  });

  it("con otro correo escrito a mano, se muestra entero", async () => {
    const { llamadas } = await abrir({ activacion: "lista" });
    boton(t("clOtroCorreo")).click();
    await pasa(10);
    expect(principal().textContent).toBe(t("protMailGo"));
    expect(principal().disabled).toBe(true);
    escribir("#cl-correo", "otra@correo.com");
    expect(principal().disabled).toBe(false);
    await pasa();
    principal().click();
    await pasa();
    expect(llamadas).toContain("mandar:otra@correo.com");
    expect(raiz()?.querySelector(".cl-texto-caja b")?.textContent).toBe("otra@correo.com");
  });

  it("«¿No llegó?» a los 20 segundos y otro código recién a los 30", async () => {
    await abrir({ activacion: "lista" });
    principal().click();
    await pasa();
    expect(textoDe()).not.toContain(t("clCorreoSpam"));
    const otro = (): HTMLButtonElement => raiz()?.querySelector('[data-accion="otro-codigo"]') as HTMLButtonElement;
    expect(otro().disabled).toBe(true);
    expect(otro().textContent).toMatch(/Otro código en \d+ segundos/);
    await pasa(20_000);
    expect(textoDe()).toContain(t("clCorreoSpam"));
    expect(otro().disabled).toBe(true);
    await pasa(10_000);
    expect(otro().disabled).toBe(false);
    expect(otro().textContent).toBe(t("protOtroCodigo"));
  });

  it("si la página se recargó con un código mandado, lo dice y no manda otro solo", async () => {
    sessionStorage.setItem(MARCA_CODIGO, "1");
    const { llamadas } = await abrir({ activacion: "lista" });
    expect(textoDe()).toContain(t("clCodigoRecargado"));
    expect(llamadas.some((x) => x.startsWith("mandar"))).toBe(false);
  });

  it("la marca de un código mandado es la que la billetera borra al cerrar sesión", async () => {
    const { MARCAS_DE_LA_CUENTA } = await import("../stellar/wallet-pollar");
    expect(MARCA_CODIGO).toBe(MARCAS_DE_LA_CUENTA.codigo);
  });

  it("si el desbloqueo falla, el correo pasa a ser lo principal; cerrar el cuadro no es una falla", async () => {
    let veces = 0;
    const proteger = vi.fn(async () => {
      veces++;
      if (veces === 1) throw Object.assign(new Error("cerró"), { name: "AbortError" });
      throw new Error("algo raro");
    });
    await abrir({ activacion: "lista" }, { celular: true, puedeUsarDesbloqueo: async () => true }, { protegerConPasskey: proteger });
    expect(principal().textContent).toBe(t("clDesbloqueoCel"));
    principal().click();
    await pasa();
    expect(principal().textContent).toBe(t("clDesbloqueoCel"));
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clDesbloqueoFalla"));
    expect(principal().dataset.accion).toBe("mandar-codigo");
  });
});

describe("otro celular u otra compu", () => {
  it("confirmar que sos vos va primero, por el correo de la cuenta, y después activar", async () => {
    const inicial = { proteccion: "aparato-nuevo" as const, correoConfirmado: true, correoDeLaCuenta: "cuenta@mail.com", unicoNavegador: false };
    const { llamadas } = await abrir(inicial);
    const cajas = [...(raiz()?.querySelectorAll<HTMLElement>(".cl-paso") ?? [])];
    expect(cajas[0]?.dataset.parte).toBe("proteger");
    expect(cajas[0]?.textContent).toContain(t("clAparatoTitulo"));
    expect(principal().textContent).toBe(t("clMandarA").replace("{mail}", "c•••@mail.com"));
    principal().click();
    await pasa();
    expect(llamadas).toContain("aparatoMandar");
    escribir("#cl-codigo", "123456");
    principal().click();
    await pasa();
    expect(llamadas).toContain("aparatoConfirmar:123456");
    expect(textoDe()).toContain(t("clConfirmadoActivar"));
    expect(principal().textContent).toBe(t("clActivarBoton"));
  });
});

describe("sin forma desde acá", () => {
  it("dice qué hacer y la principal es «Pasar a Prueba»", async () => {
    const { salidas } = await abrir({ activacion: "lista", proteccion: "sin-forma", unicoNavegador: false });
    expect(textoDe()).toContain(t("clSinForma"));
    expect(principal().textContent).toBe(t("modeSwitchToTest"));
    expect(botones().filter((b) => b.textContent === t("modeSwitchToTest")).length).toBe(1);
    principal().click();
    expect(salidas.pasarAPrueba).toHaveBeenCalledTimes(1);
  });
});

describe("las salidas", () => {
  it("«Cerrar sesión» funciona mientras se protege, y el paso devuelve false", async () => {
    const { salidas, promesa } = await abrir({ activacion: "lista" }, { celular: true, puedeUsarDesbloqueo: async () => true }, { protegerConPasskey: () => new Promise<boolean>(() => undefined) });
    principal().click();
    await pasa(10);
    expect(principal().disabled).toBe(true);
    const salir = boton(t("acctSignOut"));
    expect(salir.disabled).toBe(false);
    expect(boton(t("modeSwitchToTest")).disabled).toBe(false);
    salir.click();
    await pasa(10);
    expect(salidas.cerrarSesion).toHaveBeenCalledTimes(1);
    await expect(promesa).resolves.toBe(false);
    expect(raiz()).toBeNull();
  });

  it("«Pasar a Prueba» llama al cambio de modo; desde el sorteo queda apagado con la nota de por qué", async () => {
    const { salidas } = await abrir();
    boton(t("modeSwitchToTest")).click();
    expect(salidas.pasarAPrueba).toHaveBeenCalledTimes(1);
    boton(t("acctSignOut")).click();
    await pasa(10);
    await abrir({}, { para: "sorteo" }, {}, false);
    expect(boton(t("modeSwitchToTest")).disabled).toBe(true);
    expect(textoDe()).toContain(t("modeSwitchBlocked"));
  });

  it("«Cerrar sesión» con la red colgada: a los 12 segundos el paso se cierra igual y nadie queda encerrado", async () => {
    const { salidas, promesa } = await abrir();
    salidas.cerrarSesion.mockImplementation(() => new Promise<undefined>(() => undefined));
    boton(t("acctSignOut")).click();
    await pasa(10);
    expect(raiz()).not.toBeNull();
    expect(textoDe()).toContain(t("clCerrando"));
    await pasa(TOPE_CERRAR_MS);
    await expect(promesa).resolves.toBe(false);
    expect(raiz()).toBeNull();
  });

  it("con la red colgada, «Cerrar sesión y entrar de nuevo» cierra el paso pero no vuelve a entrar encima del cierre", async () => {
    const { salidas, promesa } = await abrir({}, {}, { activarCuenta: vi.fn(async () => Promise.reject(new Error("pollar-activacion-tope"))) });
    salidas.cerrarSesion.mockImplementation(() => new Promise<undefined>(() => undefined));
    principal().click();
    await pasa();
    principal().click();
    await pasa(TOPE_CERRAR_MS + 10);
    await expect(promesa).resolves.toBe(false);
    expect(salidas.entrarDeNuevo).not.toHaveBeenCalled();
  });

  it("la sesión cambia con el paso abierto: se cierra con false", async () => {
    const { promesa } = await abrir({}, { direccion: "GAAA" });
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: "GBBB" }));
    await expect(promesa).resolves.toBe(false);
    expect(raiz()).toBeNull();
  });
});

describe("los avisos de la cuenta", () => {
  it("un aviso mientras se lee no arma otra lectura encima: se lee una sola vez más, al terminar", async () => {
    let lecturas = 0;
    const lenta = vi.fn(
      () =>
        new Promise<Est>((r) => {
          lecturas++;
          setTimeout(() => r({ ...NUEVA }), 1_000);
        }),
    );
    const { avisar } = await abrir({}, {}, { estadoOficial: lenta });
    // La lectura al abrir sigue en vuelo: dos avisos separados, como los de la co-firma del kit.
    expect(lecturas).toBe(1);
    avisar();
    await pasa(400);
    avisar();
    expect(lecturas).toBe(1);
    await pasa(5_000);
    expect(lecturas).toBe(2);
  });
});

describe("el final", () => {
  it("para sellar: el texto del primer sello en Oficial, lo marca al tocar, y el foco vuelve al botón", async () => {
    const marcar = vi.fn();
    const volverA = document.getElementById("btn-freeze") as HTMLButtonElement;
    const alSeguir = vi.fn();
    const { promesa } = await abrir({ activacion: "lista", proteccion: "lista" }, { para: "sello", primerOficial: { pendiente: () => true, marcar }, volverA, alSeguir });
    expect(textoDe()).toContain(t("firstOfficialBody"));
    expect(principal().textContent).toBe(t("freeze"));
    principal().click();
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(alSeguir).toHaveBeenCalledTimes(1);
    await expect(promesa).resolves.toBe(true);
    expect(document.activeElement).toBe(volverA);
  });

  it("«Volver» resuelve false sin sellar; Escape al final tampoco sella", async () => {
    const alSeguir = vi.fn();
    const a = await abrir({ activacion: "lista", proteccion: "lista" }, { para: "sello", alSeguir });
    boton(t("clVolver")).click();
    await expect(a.promesa).resolves.toBe(false);
    const b = await abrir({ activacion: "lista", proteccion: "lista" }, { para: "sorteo", alSeguir });
    esc();
    await expect(b.promesa).resolves.toBe(false);
    expect(alSeguir).not.toHaveBeenCalled();
  });
});

describe("el idioma", () => {
  it("cambiar el idioma repinta el paso", async () => {
    await abrir();
    expect(textoDe()).toContain("Dejá tu cuenta lista");
    boton("EN").click();
    await pasa(10);
    expect(textoDe()).toContain("Get your account ready");
    expect(principal().textContent).toBe("Activate my account");
    setLang("es");
  });

  it("la línea de quién entró, dada como función, cambia de idioma con ES y EN", async () => {
    const aviso = (): string => `${t("cuentaAvisoGoogle").replace("{n}", "Nora")}.`;
    await abrir({}, { aviso });
    expect(raiz()?.querySelector(".cl-quien")?.textContent).toBe("Entraste con Google como Nora.");
    boton("EN").click();
    await pasa(10);
    expect(raiz()?.querySelector(".cl-quien")?.textContent).toBe("Signed in with Google as Nora.");
    boton("ES").click();
    await pasa(10);
    expect(raiz()?.querySelector(".cl-quien")?.textContent).toBe("Entraste con Google como Nora.");
  });
});

describe("lo que se ve mientras activa", () => {
  it("«Activando…» se lee una sola vez, en la principal; la línea de estado lo dice solo para el lector de pantalla", async () => {
    await abrir({}, {}, { activarCuenta: vi.fn(() => new Promise<never>(() => undefined)) });
    principal().click();
    await pasa(10);
    expect(principal().disabled).toBe(true);
    expect(principal().textContent).toBe(t("clActivarHaciendo"));
    // Ocupada, no a la espera de algo: entera y con la ruedita, no con el borde punteado de «Confirmar» sin código.
    expect(principal().getAttribute("aria-busy")).toBe("true");
    const estado = raiz()?.querySelector(".cl-estado") as HTMLElement;
    expect(estado.textContent).toBe(t("clActivarHaciendo"));
    expect(estado.classList.contains("sr-only")).toBe(true);
    const palabra = raiz()?.querySelector('.cl-paso[data-parte="activar"] .cl-palabra') as HTMLElement;
    expect(palabra.hidden).toBe(true);
    // A los 8 segundos la línea dice otra cosa, y entonces sí se ve.
    await pasa(8_100);
    expect(estado.textContent).toBe(t("clActivarLento"));
    expect(estado.classList.contains("sr-only")).toBe(false);
  });
});

describe("la muestra y la pantalla no traen la billetera", () => {
  it("cuenta-lista.ts solo usa los tipos de la billetera (no la importa)", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/ui/cuenta-lista.ts"), "utf8");
    const imports = fuente.split("\n").filter((l) => /^import /.test(l) && l.includes("wallet-pollar"));
    expect(imports.every((l) => l.startsWith("import type"))).toBe(true);
  });
});
