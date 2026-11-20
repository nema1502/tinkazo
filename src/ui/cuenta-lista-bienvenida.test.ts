// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { type Bienvenida, type ErrorDeAlta, type EstadoDeAlta, type ReclamoDelRegalo, type ResultadoDeAlta, fechaDeAlta } from "../stellar/alta-api";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import {
  type AccesoDelPaso,
  type CuentaDelPaso,
  GUARDA_DE_TOQUE_MS,
  type OpcionesDelPaso,
  PEDIDO_CADA_MS,
  abrirCuentaLista,
  aceptarClicsDePrueba,
} from "./cuenta-lista";

/**
 * El regalo de quien entra con su cuenta en «Dejá tu cuenta lista», en jsdom, con un servidor de las altas y una cuenta
 * de mentira: sin red. «Activar mi cuenta» pide el regalo y sigue la misma cadena que el canje de un cupón (pedir,
 * esperar el pedido de crear la cuenta, activarla y volver a preguntar). Cada error del pedido, el servicio de antes (sin
 * el campo) y la línea del final con lo que queda.
 */

type Est = EstadoOficial;
const NUEVA: Est = {
  activacion: "falta",
  proteccion: "falta",
  correoConfirmado: false,
  tieneLlaves: false,
  unicoNavegador: true,
  correoDeLaCuenta: null,
};
const VENCE = Date.UTC(2027, 0, 19, 12);
const LISTA: Bienvenida = { estado: "lista", sorteos: 3 };

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const mal = (clave: string, motivo: string, estado: number): ErrorDeAlta => ({ ok: false, clave, vars: {}, motivo, estado });

/**
 * El servidor de las altas, de mentira: recuerda el acceso y el regalo, y cuántas veces se lo pidieron. Con `reclamar`
 * en `false`, el acceso es el de antes (no sabe pedir el regalo). `delRegalo`: cómo nombra el estado un alta nacida del
 * regalo, `admin` como el servidor de hoy (y `gratis` para ver que se tolera).
 */
function servidorFalso(o: { bienvenida?: Bienvenida | null; reclamar?: boolean; delRegalo?: EstadoDeAlta["acceso"] } = {}) {
  const s = {
    cuenta: "GAAA",
    acceso: "ninguno" as EstadoDeAlta["acceso"],
    delRegalo: o.delRegalo ?? ("admin" as EstadoDeAlta["acceso"]),
    bienvenida: o.bienvenida === undefined ? LISTA : o.bienvenida,
    pedidos: 0,
    /** Lo que contesta el próximo pedido del regalo (si no, sale bien y da los sorteos). */
    reclamarImpl: null as null | (() => Promise<ResultadoDeAlta<ReclamoDelRegalo>>),
  };
  const estadoDe = (): EstadoDeAlta => ({
    acceso: s.acceso,
    cuenta: s.cuenta,
    abierta: false,
    pedido: null,
    sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: s.acceso === "ninguno" ? null : { fecha: VENCE, cuantos: 3 } },
    orden: null,
    fondeo: "inmediato",
    ...(s.bienvenida ? { bienvenida: s.bienvenida } : {}),
  });
  const base = {
    estado: vi.fn(async () => ok(estadoDe())),
    canjear: vi.fn(async () => mal("altaErrNoExiste", "cupon-no-existe", 404)),
    cuponGuardado: vi.fn((): string | null => null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => s.cuenta),
  };
  const reclamar = vi.fn(async (): Promise<ResultadoDeAlta<ReclamoDelRegalo>> => {
    s.pedidos++;
    if (s.reclamarImpl) return s.reclamarImpl();
    s.acceso = s.delRegalo;
    s.bienvenida = null;
    const sorteos = { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } };
    return ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos, regalo: "dado", sigue: "activar" });
  });
  const acceso: AccesoDelPaso = o.reclamar === false ? base : { ...base, reclamar };
  return { s, acceso, base, reclamar };
}

/** La cuenta de mentira: activar la deja lista. */
function cuentaFalsa(inicial: Partial<Est> = {}) {
  const estado = { est: { ...NUEVA, ...inicial } as Est };
  const cuenta = {
    estadoOficial: vi.fn(async () => ({ ...estado.est })),
    activarCuenta: vi.fn(async () => {
      estado.est = { ...estado.est, activacion: "lista" };
      return "activada" as const;
    }),
    alCambiarLaCuenta: () => () => undefined,
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => true),
    mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
    confirmarCodigoParaEsteAparato: vi.fn(async () => true),
    protegerConPasskey: vi.fn(async () => true),
    mandarCodigoDeProteccion: vi.fn(async () => undefined),
    confirmarCodigoDeProteccion: vi.fn(async () => true),
  } satisfies CuentaDelPaso;
  return { cuenta, estado };
}

const salidasFalsas = () => ({
  cerrarSesion: vi.fn(async () => undefined),
  pasarAPrueba: vi.fn(),
  puedePasarAPrueba: vi.fn(() => true),
  entrarDeNuevo: vi.fn(),
});

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const visibles = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const boton = (texto: string): HTMLButtonElement => {
  const b = visibles().find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay botón "${texto}": ${visibles().map((x) => x.textContent).join(" | ")}`);
  return b;
};
const alerta = (): string => [...(raiz()?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])].map((x) => x.textContent).join(" ");
const textoDe = (): string => raiz()?.textContent ?? "";
const bajada = (): string => raiz()?.querySelector(".cl-bajada")?.textContent ?? "";
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const LINEA = (): string => t("altaBienvenida").replace("{n}", "3");

/** Las dos salidas, a la vista y prendidas. */
const salidasALaVista = (): void => {
  expect(boton(t("modeSwitchToTest")).disabled).toBe(false);
  expect(boton(t("acctSignOut")).disabled).toBe(false);
};

async function abrir(o: { inicial?: Partial<Est>; srv?: ReturnType<typeof servidorFalso>; para?: "entrada" | "sello" } = {}) {
  const srv = o.srv ?? servidorFalso();
  const cf = cuentaFalsa(o.inicial);
  const salidas = salidasFalsas();
  const op: OpcionesDelPaso = { para: o.para ?? "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.estado.est, acceso: srv.acceso };
  const promesa = abrirCuentaLista(cf.cuenta, salidas, op);
  await pasa();
  return { srv, cf, salidas, promesa };
}

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<main id="pagina"><button id="btn-freeze">Sellar la lista</button></main>`;
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

afterEach(async () => {
  if (raiz()) {
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
    await vi.advanceTimersByTimeAsync(10);
  }
  aceptarClicsDePrueba(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("la cadena de «Activar mi cuenta» con el regalo", () => {
  it("pide el regalo, espera el pedido, activa, vuelve a preguntar y refresca el cupo", async () => {
    const { srv, cf } = await abrir();
    expect(textoDe()).toContain(LINEA());
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(principal().dataset.accion).toBe("reclamar");
    expect(boton(t("altaTengoCupon"))).toBeTruthy();
    salidasALaVista();
    expect(srv.base.estado).toHaveBeenCalledTimes(1);
    principal().click();
    await pasa(10);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    // Antes del voto, el estado de esta sesión; después de activar, otra vez.
    expect(srv.base.estado).toHaveBeenCalledTimes(3);
    expect(srv.base.refrescarCupo.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(srv.base.canjear).not.toHaveBeenCalled();
    // La parte 1 ya no se repite: queda solo proteger.
    expect(raiz()?.querySelector(".cl-paso")?.getAttribute("data-parte")).toBe("proteger");
    expect(textoDe()).toContain(t("clActivada"));
    expect(textoDe()).not.toContain(LINEA());
  });

  it("con la cuenta ya protegida, el final dice cuántos sorteos oficiales quedan y cuándo vencen", async () => {
    const { promesa } = await abrir({ inicial: { proteccion: "lista" } });
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(textoDe()).toContain(t("clListaTitulo"));
    const vence = t("cupoOfVencenTodos").replace("{fecha}", fechaDeAlta(VENCE, "es"));
    expect(bajada()).toBe(`${t("cupoOfQuedan").replace("{n}", "3")} ${vence}`);
    expect(principal().textContent).toBe(t("clSeguir"));
    // El final no tiene salidas: se cierra con su principal.
    await pasa();
    principal().click();
    await expect(promesa).resolves.toBe(true);
  });

  it("un doble toque pide el regalo una sola vez", async () => {
    const { srv } = await abrir();
    principal().click();
    principal().click();
    await pasa(10);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
  });

  it("con el regalo lleno: la línea lo dice, y «Activar mi cuenta» activa igual", async () => {
    const srv = servidorFalso({ bienvenida: { estado: "llena", sorteos: 3 } });
    srv.s.reclamarImpl = async () => {
      srv.s.acceso = srv.s.delRegalo;
      return ok({ ok: true, repetido: false, sorteosSumados: 0, sorteos: { quedan: 0, proximoVence: null }, regalo: "lleno", sigue: "activar" });
    };
    const { cf } = await abrir({ srv });
    expect(textoDe()).toContain(`${t("altaBienvenidaLlena")} ${t("altaBienvenidaMasTarde")}`);
    expect(principal().textContent).toBe(t("clActivarBoton"));
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("si el servidor activa sin el regalo, el final lo dice en lugar de callarlo", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => {
      srv.s.acceso = srv.s.delRegalo;
      srv.s.bienvenida = null;
      return ok({ ok: true, repetido: false, sorteosSumados: 0, sorteos: { quedan: 0, proximoVence: null }, regalo: "lleno", sigue: "activar" });
    };
    const { cf, promesa } = await abrir({ srv, inicial: { proteccion: "lista" } });
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(textoDe()).toContain(t("clListaTitulo"));
    expect(bajada()).toBe(t("altaBienvenidaLlena"));
    // El final no tiene salidas: se cierra con su principal.
    await pasa();
    principal().click();
    await expect(promesa).resolves.toBe(true);
  });
});

describe("cada error del pedido del regalo", () => {
  it.each(["bienvenida-llena", "altas-pausadas"])("503 %s: dice que la cuenta no se activó, y se puede probar de nuevo", async (motivo) => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => mal("altaSinActivarAhora", motivo, 503);
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("altaSinActivarAhora"));
    // No dice que se acabó el regalo ni sigue ofreciéndolo: lo que no salió es activar.
    expect(textoDe()).not.toContain(t("altaBienvenidaLlena"));
    expect(textoDe()).not.toContain(LINEA());
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(principal().disabled).toBe(false);
    expect(boton(t("altaTengoCupon"))).toBeTruthy();
    salidasALaVista();
    principal().click();
    await pasa();
    expect(srv.reclamar).toHaveBeenCalledTimes(2);
    expect(alerta()).toContain(t("altaSinActivarAhora"));
  });

  it("429 intentos: dice cuántos minutos esperar, sin decir que se acabó el regalo, y se puede probar de nuevo", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => ({ ...mal("altaErrIntentos", "intentos", 429), vars: { min: "5" } });
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("altaRegaloEspera").replace("{min}", "5"));
    // El texto de siempre habla de cupones: quien pide el regalo no usó ninguno.
    expect(alerta()).not.toContain(t("altaErrIntentos").replace("{min}", "5"));
    expect(textoDe()).not.toContain(t("altaBienvenidaLlena"));
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(principal().disabled).toBe(false);
    salidasALaVista();
  });

  it("404 (un servicio de antes, que no conoce el regalo): la caja del cupón, sin activar", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => mal("altaErrServicio", "no-existe", 404);
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(textoDe()).not.toContain(LINEA());
    expect(alerta()).toBe("");
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    salidasALaVista();
  });

  it("429 con un minuto de espera lo dice en singular", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => ({ ...mal("altaErrIntentos1", "intentos", 429), vars: { min: "1" } });
    await abrir({ srv });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("altaRegaloEspera1"));
  });

  it("409 ya tiene acceso: vuelve a leer el estado y sigue solo hasta activar", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => {
      srv.s.acceso = srv.s.delRegalo;
      srv.s.bienvenida = null;
      return mal("altaErrServicio", "ya-tiene-acceso", 409);
    };
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(raiz()?.querySelector(".cl-paso")?.getAttribute("data-parte")).toBe("proteger");
  });

  it("409 ya tiene acceso con admin y la activación que falla: dice que no se pudo activar, sin nombrar un cupón", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => {
      srv.s.acceso = "admin";
      srv.s.bienvenida = null;
      return mal("altaErrServicio", "ya-tiene-acceso", 409);
    };
    const { cf } = await abrir({ srv });
    cf.cuenta.activarCuenta.mockRejectedValueOnce(new Error("x"));
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(alerta()).toContain(t("clErrFallo"));
    expect(textoDe()).not.toContain(t("altaCuponGuardado"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
  });

  it("409 ya tiene acceso y el estado dice que no: la caja que toque, sin activar", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => {
      srv.s.bienvenida = null;
      return mal("altaErrServicio", "ya-tiene-acceso", 409);
    };
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(principal().textContent).toBe(t("altaTengoCupon"));
  });

  it("sin red: dice que no se pudo activar y «Activar mi cuenta» vuelve a probar", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => mal("altaErrServicio", "sin-red", 0);
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clErrFallo"));
    expect(principal().textContent).toBe(t("clActivarBoton"));
    salidasALaVista();
    srv.s.reclamarImpl = null;
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.reclamar).toHaveBeenCalledTimes(2);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("un pedido que lanza es como sin red, sin colgar el paso", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => Promise.reject(new Error("x"));
    await abrir({ srv });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clErrFallo"));
    expect(principal().disabled).toBe(false);
  });

  it("la cuenta de otra persona: su texto, y la principal es «Pasar a Prueba»", async () => {
    const srv = servidorFalso();
    srv.s.reclamarImpl = async () => mal("altaErrCuentaDeOtro", "cuenta-de-otro", 409);
    const { cf } = await abrir({ srv });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("altaErrCuentaDeOtro"));
    expect(principal().textContent).toBe(t("modeSwitchToTest"));
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });
});

describe("el nombre del acceso que contesta el servidor no cambia lo que se ve", () => {
  it("con el regalo recibido y la activación que falla, dice que no se pudo activar aunque el estado diga admin", async () => {
    const srv = servidorFalso({ delRegalo: "admin" });
    const { cf } = await abrir({ srv });
    cf.cuenta.activarCuenta.mockRejectedValueOnce(new Error("x"));
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(alerta()).toContain(t("clErrFallo"));
    expect(textoDe()).not.toContain(t("altaCuponGuardado"));
  });

  it("con gratis, que se tolera si llega, el final dice lo mismo que con admin", async () => {
    const { promesa } = await abrir({ srv: servidorFalso({ delRegalo: "gratis" }), inicial: { proteccion: "lista" } });
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    const vence = t("cupoOfVencenTodos").replace("{fecha}", fechaDeAlta(VENCE, "es"));
    expect(bajada()).toBe(`${t("cupoOfQuedan").replace("{n}", "3")} ${vence}`);
    // El final no tiene salidas: se cierra con su principal.
    await pasa();
    principal().click();
    await expect(promesa).resolves.toBe(true);
  });

  it("al volver a abrir el paso con el alta del regalo como admin y la cuenta sin activar: «Activar» de siempre", async () => {
    const srv = servidorFalso({ bienvenida: null });
    srv.s.acceso = "admin";
    const { cf } = await abrir({ srv });
    expect(principal().dataset.accion).toBe("activar");
    expect(textoDe()).not.toContain(LINEA());
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.reclamar).not.toHaveBeenCalled();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });
});

describe("lo de siempre cuando no hay regalo", () => {
  it("el servicio de antes, sin el campo: «Tengo un cupón» y nada del regalo", async () => {
    const { srv } = await abrir({ srv: servidorFalso({ bienvenida: null }) });
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    expect(textoDe()).not.toContain(LINEA());
    expect(textoDe()).not.toContain(t("altaBienvenidaLlena"));
    expect(srv.reclamar).not.toHaveBeenCalled();
  });

  it("un acceso que no sabe pedir el regalo no lo ofrece aunque el estado lo traiga", async () => {
    await abrir({ srv: servidorFalso({ reclamar: false }) });
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    expect(textoDe()).not.toContain(LINEA());
  });

  it("«Tengo un cupón» desde el regalo abre el campo, y Volver vuelve al regalo", async () => {
    await abrir();
    boton(t("altaTengoCupon")).click();
    await pasa();
    expect(raiz()?.querySelector("#cl-cupon")).not.toBeNull();
    boton(t("clVolver")).click();
    await pasa();
    expect(textoDe()).toContain(LINEA());
    expect(principal().dataset.accion).toBe("reclamar");
  });
});
