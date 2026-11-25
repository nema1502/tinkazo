// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { type Bienvenida, type EstadoDeAlta, type ReclamoDelRegalo, type ResultadoDeAlta } from "../stellar/alta-api";
import type { EstadoOficial, ResultadoDeActivar } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, type OpcionesDelPaso, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";

/**
 * Activar la cuenta tiene topes que decide el sitio, medidos con la hora de verdad. Lo que ve la persona en «Activar mi
 * cuenta» (el toque directo y la cadena del regalo), con relojes simulados, una cuenta de mentira y un servidor de las
 * altas de mentira: sin red.
 * - Una billetera que no contesta no deja la ruedita para siempre: a los 45 segundos del toque, «Está tardando».
 * - Si el voto salió y la cuenta no aparece, se sigue mirando callado y la pantalla avanza sola si aparece.
 * - El pedido de crear la cuenta se espera 30 segundos, y su falta tiene su propio texto.
 * - Volver a la pestaña lee enseguida, y nunca vota.
 * - La relectura del acceso al activar se hace una sola vez, y solo si hubo un intento.
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
const LISTA_EST: Est = { ...NUEVA, activacion: "lista" };
const VENCE = Date.UTC(2027, 0, 19, 12);
const REGALO: Bienvenida = { estado: "lista", sorteos: 3 };

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });

/** El servidor de las altas, de mentira. Con regalo, «Activar mi cuenta» lo pide y sigue la cadena. Sin regalo, el acceso ya está. */
function servidorFalso(conRegalo: boolean) {
  const s = { cuenta: "GAAA", acceso: (conRegalo ? "ninguno" : "cupon") as EstadoDeAlta["acceso"], bienvenida: conRegalo ? REGALO : null };
  const estado = vi.fn(async (): Promise<ResultadoDeAlta<EstadoDeAlta>> =>
    ok({
      acceso: s.acceso,
      cuenta: s.cuenta,
      abierta: false,
      pedido: null,
      sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: s.acceso === "ninguno" ? null : { fecha: VENCE, cuantos: 3 } },
      orden: null,
      fondeo: "inmediato",
      ...(s.bienvenida ? { bienvenida: s.bienvenida } : {}),
    }),
  );
  const reclamar = vi.fn(async (): Promise<ResultadoDeAlta<ReclamoDelRegalo>> => {
    s.acceso = "admin";
    s.bienvenida = null;
    const sorteos = { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } };
    return ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos, regalo: "dado", sigue: "activar" });
  });
  const canjear = vi.fn(async () => ({ ok: false as const, clave: "altaErrNoExiste", vars: {}, motivo: "cupon-no-existe", estado: 404 }));
  const acceso: AccesoDelPaso = {
    estado,
    canjear,
    cuponGuardado: vi.fn((): string | null => null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => s.cuenta),
    ...(conRegalo ? { reclamar } : {}),
  };
  return { s, acceso, estado, reclamar, canjear };
}

/** La cuenta de mentira: `activarCuenta` la deja lista salvo que se le diga otra cosa. */
function cuentaFalsa(inicial: Partial<Est> = {}, activar?: () => Promise<ResultadoDeActivar>) {
  const e = { est: { ...NUEVA, ...inicial } as Est };
  const avisos = new Set<() => void>();
  const activarCuenta = vi.fn(
    activar ??
      (async () => {
        e.est = { ...e.est, activacion: "lista" };
        return "activada" as const;
      }),
  );
  const cuenta = {
    estadoOficial: vi.fn(async (_fresco?: boolean) => ({ ...e.est })),
    activarCuenta,
    alCambiarLaCuenta: (cb: () => void) => {
      avisos.add(cb);
      return () => avisos.delete(cb);
    },
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => true),
    mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
    confirmarCodigoParaEsteAparato: vi.fn(async () => true),
    protegerConPasskey: vi.fn(async () => true),
    mandarCodigoDeProteccion: vi.fn(async () => undefined),
    confirmarCodigoDeProteccion: vi.fn(async () => true),
  } satisfies CuentaDelPaso;
  return { cuenta, e, activarCuenta, avisar: () => avisos.forEach((f) => f()) };
}

const salidasFalsas = () => ({ cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() });

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const visibles = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const alerta = (): string => [...(raiz()?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])].map((x) => x.textContent).join(" ");
const parte = (): string | null | undefined => raiz()?.querySelector(".cl-paso")?.getAttribute("data-parte");
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

async function abrir(srv: ReturnType<typeof servidorFalso>, cf: ReturnType<typeof cuentaFalsa>, o: Partial<OpcionesDelPaso> = {}) {
  const op: OpcionesDelPaso = { para: "entrada", correo: "ana@example.org", celular: true, inicial: cf.e.est, acceso: srv.acceso, ...o };
  const promesa = abrirCuentaLista(cf.cuenta, salidasFalsas(), op);
  await pasa();
  // Se devuelve dentro de un objeto: la promesa del paso solo se resuelve al cerrarlo y esperarla colgaría la prueba.
  return { promesa };
}

/** La hora de verdad corre sin que corran los relojes: lo que pasa con una pestaña congelada en segundo plano. */
const congelar = (ms: number): void => void vi.setSystemTime(Date.now() + ms);
const volverALaPestana = (): void => void document.dispatchEvent(new Event("visibilitychange"));

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
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  aceptarClicsDePrueba(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("«Activar mi cuenta» directo, con la cuenta ya con acceso", () => {
  it("una billetera que nunca contesta: a los 45 segundos del toque dice que tarda, con «Probar de nuevo»", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, () => new Promise<ResultadoDeActivar>(() => undefined));
    await abrir(srv, cf);
    expect(principal().dataset.accion).toBe("activar");
    principal().click();
    await pasa(44_000);
    expect(alerta()).toBe("");
    expect(principal().disabled).toBe(true);
    await pasa(1_500);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(principal().disabled).toBe(false);
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("después de tardar, una lectura de fondo no borra el aviso, y «Probar de nuevo» deja volver a activar", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, () => new Promise<ResultadoDeActivar>(() => undefined));
    await abrir(srv, cf);
    principal().click();
    await pasa(46_000);
    expect(alerta()).toContain(t("clErrTarda"));
    cf.avisar();
    await pasa(2_000);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    // La persona lo pide: el aviso se va y puede tocar Activar mi cuenta otra vez.
    principal().click();
    await pasa(2_000);
    expect(alerta()).toBe("");
    expect(principal().dataset.accion).toBe("activar");
  });

  it("el voto sale una sola vez aunque pase todo el tiempo y se vuelva a la pestaña", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, () => new Promise<ResultadoDeActivar>(() => undefined));
    await abrir(srv, cf);
    principal().click();
    await pasa(50_000);
    volverALaPestana();
    await pasa(120_000);
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("la billetera da pendiente a los 20 segundos y la cuenta aparece a los 50: tarda a los 45 y avanza sola cerca de los 52", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, async () => {
      await new Promise((r) => setTimeout(r, 20_000));
      return "pendiente" as const;
    });
    await abrir(srv, cf);
    principal().click();
    setTimeout(() => (cf.e.est = { ...cf.e.est, activacion: "lista" }), 50_000);
    await pasa(30_000);
    // Con la ruedita todavía: el voto salió y se espera mirando.
    expect(alerta()).toBe("");
    await pasa(16_000);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(parte()).toBe("activar");
    const portero = srv.estado.mock.calls.length;
    await pasa(4_000);
    // A los 50 segundos la cuenta existe, y la próxima lectura callada es a los 52.
    expect(alerta()).toContain(t("clErrTarda"));
    await pasa(3_000);
    expect(alerta()).toBe("");
    expect(parte()).toBe("proteger");
    expect(srv.estado.mock.calls.length - portero).toBe(1);
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
    // Pasado el minuto de lecturas calladas, nada más le pregunta al portero.
    await pasa(120_000);
    expect(srv.estado.mock.calls.length - portero).toBe(1);
  });

  it("pasado el minuto de lecturas calladas, la falla queda con «Probar de nuevo» y ya no se lee de más", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, async () => "pendiente" as const);
    await abrir(srv, cf);
    principal().click();
    await pasa(110_000);
    const lecturas = cf.cuenta.estadoOficial.mock.calls.length;
    expect(alerta()).toContain(t("clErrTarda"));
    await pasa(60_000);
    expect(cf.cuenta.estadoOficial.mock.calls.length).toBe(lecturas);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("si la billetera contesta tarde que quedó activada, la pantalla avanza", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, async () => {
      await new Promise((r) => setTimeout(r, 60_000));
      cf.e.est = { ...cf.e.est, activacion: "lista" };
      return "activada" as const;
    });
    await abrir(srv, cf);
    principal().click();
    await pasa(46_000);
    expect(alerta()).toContain(t("clErrTarda"));
    await pasa(16_000);
    expect(alerta()).toBe("");
    expect(parte()).toBe("proteger");
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("la billetera avisa que tardó más de lo que espera el sitio: dice que tarda, nunca que falló", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, async () => Promise.reject(new Error("pollar-activacion-lenta")));
    await abrir(srv, cf);
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clErrTarda"));
    expect(alerta()).not.toContain(t("clErrFallo"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
  });

  it("lo mismo sin conexión: dice que no hay conexión", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, async () => Promise.reject(new Error("pollar-activacion-lenta")));
    await abrir(srv, cf);
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clErrRed"));
    expect(alerta()).not.toContain(t("clErrFallo"));
  });

  it("una billetera que contesta rápido avanza como siempre, con una sola relectura del acceso", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    expect(srv.estado).toHaveBeenCalledTimes(1);
    principal().click();
    await pasa();
    expect(parte()).toBe("proteger");
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.estado).toHaveBeenCalledTimes(2);
    cf.avisar();
    cf.avisar();
    await pasa(5_000);
    expect(srv.estado).toHaveBeenCalledTimes(2);
  });
});

describe("la relectura del acceso al activar", () => {
  it("una cuenta que ya estaba lista al abrir no le suma ningún pedido al portero", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({ activacion: "lista" });
    await abrir(srv, cf);
    expect(srv.estado).toHaveBeenCalledTimes(1);
    cf.avisar();
    volverALaPestana();
    await pasa(70_000);
    expect(srv.estado).toHaveBeenCalledTimes(1);
    expect(cf.activarCuenta).not.toHaveBeenCalled();
  });

  it("una cuenta que aparece lista sin que nadie toque Activar tampoco le suma pedidos", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...cf.e.est, activacion: "lista" };
    cf.avisar();
    await pasa(5_000);
    expect(parte()).toBe("proteger");
    expect(srv.estado).toHaveBeenCalledTimes(1);
    expect(cf.activarCuenta).not.toHaveBeenCalled();
  });
});

describe("la cadena del regalo", () => {
  it("sin pedido: a los 30 segundos dice que se está preparando, y «Probar de nuevo» no vuelve a pedir el regalo", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(29_000);
    expect(alerta()).toBe("");
    await pasa(2_500);
    expect(alerta()).toContain(t("clErrSinPedido"));
    expect(alerta()).not.toContain(t("clErrFallo"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    principal().click();
    await pasa(10);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    expect(srv.canjear).not.toHaveBeenCalled();
    expect(cf.activarCuenta).not.toHaveBeenCalled();
  });

  it("después de no ver el pedido, si aparece, «Probar de nuevo» sigue desde ahí y no vuelve a pedir el regalo", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(32_000);
    expect(alerta()).toContain(t("clErrSinPedido"));
    cf.e.est = { ...NUEVA };
    principal().click();
    await pasa(3_000);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
    expect(parte()).toBe("proteger");
  });

  it("en una de cada dos vueltas se le pide a la billetera que relea de verdad", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    cf.cuenta.estadoOficial.mockClear();
    principal().click();
    await pasa(20_000);
    const frescas = cf.cuenta.estadoOficial.mock.calls.filter((c) => c[0] === true).length;
    const total = cf.cuenta.estadoOficial.mock.calls.length;
    expect(total).toBeGreaterThan(8);
    expect(frescas).toBeGreaterThanOrEqual(Math.floor(total / 2) - 1);
    expect(frescas).toBeLessThanOrEqual(Math.ceil(total / 2) + 1);
  });

  it("la billetera lenta: dice que tarda, a los 45 segundos de empezar a activar", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa({}, () => new Promise<ResultadoDeActivar>(() => undefined));
    await abrir(srv, cf);
    principal().click();
    await pasa(44_000);
    expect(alerta()).toBe("");
    await pasa(2_000);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(alerta()).not.toContain(t("clErrFallo"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
  });

  it("la billetera avisa que tardó: dice que tarda", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa({}, async () => Promise.reject(new Error("pollar-activacion-lenta")));
    await abrir(srv, cf);
    principal().click();
    await pasa(2_500);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
  });

  it("el voto salió y la cuenta aparece a los 50 segundos: tarda a los 45 y después avanza sola, sin votar otra vez", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa({}, async () => {
      await new Promise((r) => setTimeout(r, 20_000));
      return "pendiente" as const;
    });
    await abrir(srv, cf);
    principal().click();
    await pasa(1_000);
    setTimeout(() => (cf.e.est = { ...cf.e.est, activacion: "lista" }), 49_000);
    await pasa(46_000);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    await pasa(10_000);
    expect(alerta()).toBe("");
    expect(parte()).toBe("proteger");
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["SDK_NETWORK_TIMEOUT", new Error("SDK_NETWORK_TIMEOUT")],
    ["un corte de la red", new TypeError("Failed to fetch")],
  ])("con %s dice que no hay conexión", async (_nombre, error) => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa({}, async () => Promise.reject(error));
    await abrir(srv, cf);
    principal().click();
    await pasa(2_500);
    expect(alerta()).toContain(t("clErrRed"));
    expect(alerta()).not.toContain(t("clErrFallo"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it.each(["pollar-activacion-fallo", "pollar-activacion-rara", "SDK_CREDITS_INSUFFICIENT"])("con otro error (%s) dice que no se pudo, como siempre", async (codigo) => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa({}, async () => Promise.reject(new Error(codigo)));
    await abrir(srv, cf);
    principal().click();
    await pasa(2_500);
    expect(alerta()).toContain(t("clErrFallo"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("«Probar de nuevo» después de tardar sigue desde activar, sin volver a pedir el regalo", async () => {
    const srv = servidorFalso(true);
    let veces = 0;
    const cf = cuentaFalsa({}, async () => {
      veces++;
      if (veces === 1) throw new Error("pollar-activacion-lenta");
      cf.e.est = { ...cf.e.est, activacion: "lista" };
      return "activada" as const;
    });
    await abrir(srv, cf);
    principal().click();
    await pasa(2_500);
    expect(alerta()).toContain(t("clErrTarda"));
    principal().click();
    await pasa(2_500);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
    expect(cf.activarCuenta).toHaveBeenCalledTimes(2);
    expect(parte()).toBe("proteger");
  });
});

describe("volver a la pestaña", () => {
  it("escondida cinco minutos mientras se espera el pedido: al volver lee enseguida, y si la cuenta ya está lista avanza sin votar", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(4_000);
    const antes = cf.cuenta.estadoOficial.mock.calls.length;
    congelar(5 * 60_000);
    cf.e.est = { ...LISTA_EST };
    volverALaPestana();
    await pasa(50);
    expect(cf.cuenta.estadoOficial.mock.calls.length).toBeGreaterThan(antes);
    expect(parte()).toBe("proteger");
    expect(alerta()).toBe("");
    expect(cf.activarCuenta).not.toHaveBeenCalled();
  });

  it("escondida cinco minutos sin pedido: al volver dice que se está preparando, sin esperar cuatro minutos más", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(4_000);
    const antes = cf.cuenta.estadoOficial.mock.calls.length;
    congelar(5 * 60_000);
    volverALaPestana();
    await pasa(50);
    expect(cf.cuenta.estadoOficial.mock.calls.length).toBeGreaterThan(antes);
    expect(alerta()).toContain(t("clErrSinPedido"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(cf.activarCuenta).not.toHaveBeenCalled();
  });

  it("si el pedido apareció mientras estaba escondida, volver no vota: queda «Probar de nuevo»", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(4_000);
    congelar(5 * 60_000);
    cf.e.est = { ...NUEVA };
    volverALaPestana();
    await pasa(50);
    expect(cf.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("clErrSinPedido"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    // Lo vota la persona, con su toque.
    principal().click();
    await pasa(2_500);
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.reclamar).toHaveBeenCalledTimes(1);
  });

  it("al volver la conexión pasa lo mismo que al volver a la pestaña", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(4_000);
    congelar(5 * 60_000);
    cf.e.est = { ...LISTA_EST };
    window.dispatchEvent(new Event("online"));
    await pasa(50);
    expect(parte()).toBe("proteger");
    expect(cf.activarCuenta).not.toHaveBeenCalled();
  });

  it("con la pestaña escondida no se lee de más", async () => {
    const srv = servidorFalso(true);
    const cf = cuentaFalsa();
    await abrir(srv, cf);
    cf.e.est = { ...NUEVA, activacion: "preparando" };
    principal().click();
    await pasa(4_000);
    const antes = cf.cuenta.estadoOficial.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    volverALaPestana();
    await pasa(50);
    expect(cf.cuenta.estadoOficial.mock.calls.length).toBe(antes);
  });

  it("billetera lenta en el toque directo: al volver pasado el tope, dice que tarda en el acto", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, () => new Promise<ResultadoDeActivar>(() => undefined));
    await abrir(srv, cf);
    principal().click();
    await pasa(10_000);
    congelar(5 * 60_000);
    volverALaPestana();
    await pasa(50);
    expect(alerta()).toContain(t("clErrTarda"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("billetera lenta en el toque directo: al volver dentro del tiempo lee, y si la cuenta ya está lista avanza", async () => {
    const srv = servidorFalso(false);
    const cf = cuentaFalsa({}, () => new Promise<ResultadoDeActivar>(() => undefined));
    await abrir(srv, cf);
    principal().click();
    await pasa(10_000);
    cf.e.est = { ...LISTA_EST };
    volverALaPestana();
    await pasa(500);
    expect(parte()).toBe("proteger");
    expect(alerta()).toBe("");
    expect(cf.activarCuenta).toHaveBeenCalledTimes(1);
  });
});
