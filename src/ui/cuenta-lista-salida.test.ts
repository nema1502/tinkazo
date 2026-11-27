// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import type { CanjeDeCupon, ErrorDeAlta, EstadoDeAlta, ReclamoDelRegalo, ResultadoDeAlta } from "../stellar/alta-api";
import type { EstadoOficial, ResultadoDeActivar } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, type OpcionesDelPaso, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";

/**
 * La salida de una espera larga en «Dejá tu cuenta lista», en jsdom con relojes falsos y una cuenta y un servidor de
 * mentira: sin red. Lo primero que fija es que, con el proveedor de cuentas rápido, las llamadas son siempre las mismas.
 */

type Est = EstadoOficial;
const NUEVA: Est = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
const CODIGO = "K7M29QXA4HTR";
const VENCE = Date.UTC(2027, 0, 19, 12);

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });

/** El registro, en orden, de todo lo que el paso le pide a la cuenta y al servidor. */
type Registro = string[];

/** El servidor de las altas, de mentira: da el acceso con el regalo o el cupón, y anota cada llamada. */
function servidorFalso(
  reg: Registro,
  o: {
    acceso?: EstadoDeAlta["acceso"];
    guardado?: string | null;
    regalo?: boolean;
    /** Lo que hace cada pedido del estado antes de contestar (el primero es el 1): para hacerlo tardar. */
    antesDelEstado?: (n: number) => Promise<void>;
    /** Lo que contesta el pedido del regalo, en lugar de darlo. Recibe lo que sabe el servidor, para cambiarlo. */
    reclamarImpl?: (s: { acceso: EstadoDeAlta["acceso"] }) => Promise<ResultadoDeAlta<ReclamoDelRegalo>>;
    /** Lo que contesta el canje, en lugar de darlo. */
    canjearImpl?: () => Promise<ResultadoDeAlta<CanjeDeCupon>>;
  } = {},
) {
  const s = { acceso: o.acceso ?? ("ninguno" as EstadoDeAlta["acceso"]), guardado: o.guardado ?? null, regalo: o.regalo ?? false, pedidosDelEstado: 0 };
  const estadoDe = (): EstadoDeAlta => ({
    acceso: s.acceso,
    cuenta: "GAAA",
    abierta: false,
    pedido: null,
    sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: s.acceso === "ninguno" ? null : { fecha: VENCE, cuantos: 3 } },
    orden: null,
    fondeo: "inmediato",
    ...(s.regalo && s.acceso === "ninguno" ? { bienvenida: { estado: "lista" as const, sorteos: 3 } } : {}),
  });
  const base = {
    estado: vi.fn(async () => {
      reg.push("estado");
      await o.antesDelEstado?.(++s.pedidosDelEstado);
      return ok(estadoDe());
    }),
    canjear: vi.fn(async (): Promise<ResultadoDeAlta<CanjeDeCupon>> => {
      reg.push("canjear");
      if (o.canjearImpl) return o.canjearImpl();
      s.acceso = "cupon";
      return ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } }, sigue: "activar" });
    }),
    cuponGuardado: vi.fn(() => s.guardado),
    guardarCupon: vi.fn((c: string) => {
      reg.push("guardarCupon");
      s.guardado = c;
    }),
    olvidarCupon: vi.fn(() => {
      reg.push("olvidarCupon");
      s.guardado = null;
    }),
    refrescarCupo: vi.fn(() => void reg.push("refrescarCupo")),
    cuenta: vi.fn(() => "GAAA"),
  };
  const reclamar = vi.fn(async (): Promise<ResultadoDeAlta<ReclamoDelRegalo>> => {
    reg.push("reclamar");
    if (o.reclamarImpl) return o.reclamarImpl(s);
    s.acceso = "admin";
    return ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } }, regalo: "dado", sigue: "activar" });
  });
  const acceso: AccesoDelPaso = s.regalo ? { ...base, reclamar } : base;
  return { s, acceso, base, reclamar };
}

/** La cuenta de mentira: activarla la deja lista. */
function cuentaFalsa(reg: Registro, inicial: Partial<Est> = {}) {
  const estado = { est: { ...NUEVA, ...inicial } as Est };
  const cuenta = {
    estadoOficial: vi.fn(async (fresco?: boolean) => (reg.push(`estadoOficial(${fresco === true})`), { ...estado.est })),
    activarCuenta: vi.fn(async (): Promise<ResultadoDeActivar> => {
      reg.push("activarCuenta");
      estado.est = { ...estado.est, activacion: "lista" };
      return "activada";
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

const salidasFalsas = () => ({ cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn(), recargar: vi.fn() });

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const visibles = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

async function abrir(srv: ReturnType<typeof servidorFalso>, cf: ReturnType<typeof cuentaFalsa>, op: Partial<OpcionesDelPaso> = {}) {
  const salidas = salidasFalsas();
  const promesa = abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.estado.est, acceso: srv.acceso, ...op });
  await pasa();
  return { salidas, promesa };
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
    // Con el paso a medias, Cerrar sesión. En el final no hay salidas: se cierra con su principal.
    await vi.advanceTimersByTimeAsync(GUARDA_DE_TOQUE_MS + 50);
    const cerrar = visibles().find((x) => x.textContent === t("acctSignOut"));
    if (cerrar) cerrar.click();
    else principal()?.click();
    await vi.advanceTimersByTimeAsync(10);
  }
  aceptarClicsDePrueba(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("con el proveedor de cuentas rápido, las llamadas son las de siempre", () => {
  it("camino directo con el acceso ya dado", async () => {
    const reg: Registro = [];
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cuentaFalsa(reg));
    reg.push("toque");
    principal().click();
    await pasa(1_000);
    expect(reg).toEqual(["estadoOficial(true)", "estado", "toque", "activarCuenta", "estadoOficial(false)", "estado", "refrescarCupo"]);
  });

  it("regalo", async () => {
    const reg: Registro = [];
    await abrir(servidorFalso(reg, { regalo: true }), cuentaFalsa(reg));
    reg.push("toque");
    principal().click();
    await pasa(10_000);
    expect(reg).toEqual([
      "estadoOficial(true)",
      "estado",
      "toque",
      "reclamar",
      "refrescarCupo",
      "estadoOficial(false)",
      "estado",
      "activarCuenta",
      "estado",
      "refrescarCupo",
      "estadoOficial(false)",
    ]);
  });

  it("cupón guardado", async () => {
    const reg: Registro = [];
    await abrir(servidorFalso(reg, { guardado: CODIGO }), cuentaFalsa(reg));
    reg.push("toque");
    principal().click();
    await pasa(10_000);
    expect(reg).toEqual([
      "estadoOficial(true)",
      "estado",
      "toque",
      "canjear",
      "olvidarCupon",
      "refrescarCupo",
      "estadoOficial(false)",
      "estado",
      "activarCuenta",
      "estado",
      "refrescarCupo",
      "estadoOficial(false)",
    ]);
  });
});

/* ------------------------------------------------ la salida de una espera larga */

const mal = (clave: string, motivo: string, estado: number): ErrorDeAlta => ({ ok: false, clave, vars: {}, motivo, estado });
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const recargarDelPaso = (): HTMLButtonElement | null => raiz()?.querySelector<HTMLButtonElement>('[data-accion="recargar"]') ?? null;
const dejarElPedido = (): HTMLButtonElement | null => raiz()?.querySelector<HTMLButtonElement>('[data-accion="dejar-el-pedido"]') ?? null;
const hayAlgunaSalida = (): boolean => recargarDelPaso() !== null || dejarElPedido() !== null;
const errores = (): number => raiz()?.querySelectorAll(".cl-error").length ?? 0;
const alerta = (): string => [...(raiz()?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])].map((x) => x.textContent).join(" ");
const pie = (): string => raiz()?.querySelector(".cl-estado")?.textContent ?? "";
const parteActual = (): string | null | undefined => raiz()?.querySelector(".cl-paso")?.getAttribute("data-parte");
const textoDe = (): string => raiz()?.textContent ?? "";

function diferido<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    resolver = a;
    rechazar = b;
  });
  return { p, ok: resolver, mal: rechazar };
}

/** Avanza de a un segundo, mirando en cada uno. */
async function recorrer(segundos: number, mirar: (s: number) => void): Promise<void> {
  for (let s = 1; s <= segundos; s++) {
    await vi.advanceTimersByTimeAsync(1_000);
    mirar(s);
  }
}

/** La activación de la cuenta tarda `ms` en contestar (el proveedor lento pero sano). */
function activarTarda(cf: ReturnType<typeof cuentaFalsa>, reg: Registro, ms: number): void {
  cf.cuenta.activarCuenta.mockImplementation(async (): Promise<ResultadoDeActivar> => {
    reg.push("activarCuenta");
    await esperar(ms);
    cf.estado.est = { ...cf.estado.est, activacion: "lista" };
    return "activada";
  });
}

/** La activación de la cuenta que nunca contesta (el cuerpo de la respuesta que no termina de llegar). */
function activarColgada(cf: ReturnType<typeof cuentaFalsa>, reg: Registro): void {
  cf.cuenta.activarCuenta.mockImplementation(() => {
    reg.push("activarCuenta");
    return new Promise<ResultadoDeActivar>(() => undefined);
  });
}

/** Mientras el pedido de crear la cuenta no está, cada lectura tarda `ms` y dice que se está preparando. */
function pedidoDespues(cf: ReturnType<typeof cuentaFalsa>, reg: Registro, ms: number, aparece: () => boolean): void {
  cf.cuenta.estadoOficial.mockImplementation(async (fresco?: boolean) => {
    reg.push(`estadoOficial(${fresco === true})`);
    if (fresco === true) return { ...cf.estado.est };
    await esperar(ms);
    return aparece() || cf.estado.est.activacion === "lista" ? { ...cf.estado.est } : { ...cf.estado.est, activacion: "preparando" as const };
  });
}

const tocar = async (): Promise<number> => {
  const t0 = Date.now();
  principal().click();
  await vi.advanceTimersByTimeAsync(0);
  return t0;
};

describe("el camino directo: la salida a los 45 segundos y nada se corta", () => {
  for (const segundos of [30, 50, 80]) {
    it(`una activación sana de ${segundos} s termina sola, con las mismas llamadas`, async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg);
      activarTarda(cf, reg, segundos * 1_000);
      const { salidas } = await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
      await tocar();
      await recorrer(segundos - 1, (s) => {
        expect(errores(), `${s} s`).toBe(0);
        // La salida es una oferta desde los 45 s: antes, nada.
        expect(recargarDelPaso() !== null, `${s} s`).toBe(s >= 45);
        expect(principal().getAttribute("aria-busy")).toBe("true");
        // El pie sigue diciendo que puede tardar: ni un error ni una instrucción de probar de nuevo.
        if (s >= 45) expect(pie()).toBe(t("clActivarLento"));
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(parteActual()).toBe("proteger");
      expect(hayAlgunaSalida()).toBe(false);
      expect(errores()).toBe(0);
      expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
      expect(salidas.recargar).not.toHaveBeenCalled();
    });
  }

  it("la salida aparece a los 45.000 ms y no a los 44.999", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarTarda(cf, reg, 50_000);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(recargarDelPaso()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const salida = recargarDelPaso();
    expect(salida?.textContent).toBe(t("loginRecargar"));
    expect(salida?.disabled).toBe(false);
    expect(principal().getAttribute("aria-busy")).toBe("true");
    expect(principal().disabled).toBe(true);
    expect(pie()).toBe(t("clActivarLento"));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(parteActual()).toBe("proteger");
    expect(hayAlgunaSalida()).toBe(false);
  });

  it("colgada de verdad, la salida queda a la vista y sigue sin cortar nada", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(recargarDelPaso()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(recargarDelPaso()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(recargarDelPaso()).not.toBeNull();
    expect(principal().textContent).toBe(t("clActivarHaciendo"));
    expect(errores()).toBe(0);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("al volver a la pestaña la salida se mira en el acto, sin esperar ningún temporizador", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recargarDelPaso()).toBeNull();
    // La pestaña estuvo en segundo plano: la hora corrió y los temporizadores no.
    vi.setSystemTime(Date.now() + 120_000);
    const estado = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(recargarDelPaso()).not.toBeNull();
    expect(pie()).toBe(t("clActivarLento"));
    estado.mockRestore();
  });

  it("escondida, la pestaña no repinta", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    vi.setSystemTime(Date.now() + 120_000);
    const estado = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(recargarDelPaso()).toBeNull();
    estado.mockRestore();
  });

  it("tocar Volver a cargar recarga una vez y no llama a nada más", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    const srv = servidorFalso(reg, { acceso: "cupon" });
    const { salidas } = await abrir(srv, cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(45_000);
    const antes = [...reg];
    recargarDelPaso()?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(salidas.recargar).toHaveBeenCalledTimes(1);
    expect(reg).toEqual(antes);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("con la salida a la vista, si lo que corría termina bien, gana el final bueno", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    const d = diferido<ResultadoDeActivar>();
    cf.cuenta.activarCuenta.mockImplementation(() => (reg.push("activarCuenta"), d.p));
    const { salidas } = await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recargarDelPaso()).not.toBeNull();
    cf.estado.est = { ...cf.estado.est, activacion: "lista" };
    d.ok("activada");
    await vi.advanceTimersByTimeAsync(10);
    expect(parteActual()).toBe("proteger");
    expect(hayAlgunaSalida()).toBe(false);
    expect(errores()).toBe(0);
    expect(salidas.recargar).not.toHaveBeenCalled();
  });

  it("con la salida a la vista, si lo que corría falla, se ve su falla de siempre y la salida se va", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    const d = diferido<ResultadoDeActivar>();
    cf.cuenta.activarCuenta.mockImplementation(() => (reg.push("activarCuenta"), d.p));
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recargarDelPaso()).not.toBeNull();
    d.mal(new Error("pollar-activacion-fallo"));
    await vi.advanceTimersByTimeAsync(10);
    expect(alerta()).toContain(t("clErrFallo"));
    expect(principal().dataset.accion).toBe("leer");
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(hayAlgunaSalida()).toBe(false);
  });

  it("el reloj vuelve a cero con cada espera nueva", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    const primera = diferido<ResultadoDeActivar>();
    // La primera activación falla a los 40 s. La segunda no contesta nunca.
    activarColgada(cf, reg);
    cf.cuenta.activarCuenta.mockImplementationOnce(() => (reg.push("activarCuenta"), primera.p));
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(recargarDelPaso()).toBeNull();
    primera.mal(new Error("SDK_NETWORK_TIMEOUT"));
    await pasa();
    expect(alerta()).toContain(t("clErrRed"));
    // Probar de nuevo solo lee y vuelve a Activar mi cuenta.
    principal().click();
    await pasa();
    expect(principal().dataset.accion).toBe("activar");
    await pasa();
    await tocar();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(recargarDelPaso()).toBeNull();
    await vi.advanceTimersByTimeAsync(39_998);
    expect(recargarDelPaso()).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(recargarDelPaso()).not.toBeNull();
  });

  it("con la hora de pared atrasada, el temporizador da la espera por cumplida igual", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(recargarDelPaso()).toBeNull();
    // El celular corrigió la hora al recuperar la red.
    vi.setSystemTime(Date.now() - 3_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(recargarDelPaso()).not.toBeNull();
  });

  it("si la hora de pared se atrasa después de que la salida apareció, la salida se queda", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(recargarDelPaso()).not.toBeNull();
    // El celular corrige la hora hacia atrás al recuperar la red, y la pantalla se pinta otra vez.
    vi.setSystemTime(Date.now() - 20_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recargarDelPaso()).not.toBeNull();
    expect(principal().getAttribute("aria-busy")).toBe("true");
  });

  it("al perder la conexión con la salida a la vista, la salida se va en el acto", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(recargarDelPaso()).not.toBeNull();
    const enLinea = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(recargarDelPaso()).toBeNull();
    expect(principal().getAttribute("aria-busy")).toBe("true");
    enLinea.mockRestore();
  });

  it("sin conexión no se ofrece recargar, y vuelve en el acto con la conexión", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    const { salidas } = await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    const enLinea = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recargarDelPaso()).toBeNull();
    expect(principal().getAttribute("aria-busy")).toBe("true");
    enLinea.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(recargarDelPaso()).not.toBeNull();
    // Se cortó otra vez sin que se avise: tocarla no recarga y la salida se va.
    enLinea.mockReturnValue(false);
    recargarDelPaso()?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(salidas.recargar).not.toHaveBeenCalled();
    expect(recargarDelPaso()).toBeNull();
    enLinea.mockRestore();
  });

  it("volver a la pestaña sin una espera en curso no repinta", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    const paso = raiz()?.querySelector(".cl-paso");
    expect(paso).not.toBeNull();
    expect(principal().dataset.accion).toBe("activar");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("offline"));
    expect(raiz()?.querySelector(".cl-paso")).toBe(paso);
  });

  it("al cerrar el paso no queda nada: ni oyentes ni temporizadores que pinten", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    const enDocumento = vi.spyOn(document, "addEventListener");
    const sinDocumento = vi.spyOn(document, "removeEventListener");
    const enVentana = vi.spyOn(window, "addEventListener");
    const sinVentana = vi.spyOn(window, "removeEventListener");
    await abrir(servidorFalso(reg, { acceso: "cupon" }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(20_000);
    const tipos = ["visibilitychange", "online", "offline"];
    const puestos = [...enDocumento.mock.calls, ...enVentana.mock.calls].filter(([tipo]) => tipos.includes(tipo));
    expect(puestos.some(([tipo]) => tipo === "visibilitychange")).toBe(true);
    // Cerrar sesión cierra el paso.
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(raiz()).toBeNull();
    // Cada oyente puesto se sacó, con el mismo oyente.
    const sacados = [...sinDocumento.mock.calls, ...sinVentana.mock.calls];
    for (const [tipo, oyente] of puestos) expect(sacados.some(([t2, o2]) => t2 === tipo && o2 === oyente), tipo).toBe(true);
    // Ni el reloj de la espera ni ningún otro temporizador del paso quedó armado.
    expect(vi.getTimerCount()).toBe(0);
    const llamadas = reg.length;
    const hijos = document.body.children.length;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(raiz()).toBeNull();
    expect(document.body.children.length).toBe(hijos);
    expect(reg).toHaveLength(llamadas);
  });
});

describe("el regalo y el cupón: la salida y la espera del pedido", () => {
  for (const segundos of [30, 50, 80]) {
    it(`el regalo con una activación sana de ${segundos} s llega al final sin un solo error`, async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg, { proteccion: "lista" });
      activarTarda(cf, reg, segundos * 1_000);
      const srv = servidorFalso(reg, { regalo: true });
      const { salidas } = await abrir(srv, cf);
      await tocar();
      await recorrer(segundos - 1, (s) => {
        expect(errores(), `${s} s`).toBe(0);
        expect(recargarDelPaso() !== null, `${s} s`).toBe(s >= 45);
        expect(dejarElPedido()).toBeNull();
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(textoDe()).toContain(t("clListaTitulo"));
      expect(hayAlgunaSalida()).toBe(false);
      expect(errores()).toBe(0);
      expect(srv.reclamar).toHaveBeenCalledTimes(1);
      expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
      expect(salidas.recargar).not.toHaveBeenCalled();
    });

    it(`el cupón con una activación sana de ${segundos} s llega al final sin un solo error`, async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg, { proteccion: "lista" });
      activarTarda(cf, reg, segundos * 1_000);
      const srv = servidorFalso(reg, { guardado: CODIGO });
      const { salidas } = await abrir(srv, cf);
      await tocar();
      await recorrer(segundos - 1, (s) => {
        expect(errores(), `${s} s`).toBe(0);
        expect(recargarDelPaso() !== null, `${s} s`).toBe(s >= 45);
        expect(dejarElPedido()).toBeNull();
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(textoDe()).toContain(t("clListaTitulo"));
      expect(hayAlgunaSalida()).toBe(false);
      expect(srv.base.canjear).toHaveBeenCalledTimes(1);
      expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
      expect(salidas.recargar).not.toHaveBeenCalled();
    });
  }

  it("el pedido a los 48 s con lecturas de 3 s: Probar de nuevo hasta que aparece, Volver a cargar después, y llega solo", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg, { proteccion: "lista" });
    activarTarda(cf, reg, 2_000);
    const t0 = Date.now();
    pedidoDespues(cf, reg, 3_000, () => Date.now() - t0 >= 48_000);
    const { salidas } = await abrir(servidorFalso(reg, { regalo: true }), cf);
    // El toque cuenta desde acá: el pedido aparece a los 48 s de este toque.
    const toque = await tocar();
    expect(toque).toBeGreaterThanOrEqual(t0);
    await vi.advanceTimersByTimeAsync(44_000);
    expect(hayAlgunaSalida()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000 + (toque - t0));
    expect(dejarElPedido()).not.toBeNull();
    expect(recargarDelPaso()).toBeNull();
    // A los 48 s del primer momento aparece el pedido: sigue la cadena, y la salida pasa a recargar.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(recargarDelPaso()).not.toBeNull();
    expect(dejarElPedido()).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(textoDe()).toContain(t("clListaTitulo"));
    expect(hayAlgunaSalida()).toBe(false);
    expect(errores()).toBe(0);
    expect(salidas.recargar).not.toHaveBeenCalled();
  });

  it("el regalo colgado en el voto: Volver a cargar a los 45 s del toque, no del pedido", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    pedidoDespues(cf, reg, 3_000, () => true);
    const { salidas } = await abrir(servidorFalso(reg, { regalo: true }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(hayAlgunaSalida()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(recargarDelPaso()).not.toBeNull();
    expect(dejarElPedido()).toBeNull();
    expect(pie()).toBe(t("clActivarLento"));
    recargarDelPaso()?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(salidas.recargar).toHaveBeenCalledTimes(1);
  });

  it("tras tocar Volver a cargar, la cadena de la página que se va no vota, y un toque nuevo sí", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg, { proteccion: "lista" });
    // El regalo (20 s) y la pregunta del acceso antes del voto (28 s) pasan de 45 s: la salida se toca antes del voto, y la
    // recarga todavía no descargó la página.
    const srv = servidorFalso(reg, {
      regalo: true,
      reclamarImpl: async (s) => {
        await esperar(20_000);
        s.acceso = "admin";
        return ok<ReclamoDelRegalo>({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } }, regalo: "dado", sigue: "activar" });
      },
      antesDelEstado: async (n) => {
        if (n === 2) await esperar(28_000);
      },
    });
    const { salidas } = await abrir(srv, cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(recargarDelPaso()).not.toBeNull();
    recargarDelPaso()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(salidas.recargar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    // El acceso llegó, pero la cadena vieja no vota: queda la falla de hoy con su Probar de nuevo.
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("clErrFallo"));
    expect(principal().dataset.accion).toBe("seguir-cupon");
    // Un toque de la persona sí sigue, con un solo voto.
    principal().click();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(textoDe()).toContain(t("clListaTitulo"));
  });

  it("el cupón colgado en el voto: Volver a cargar a los 45 s del toque", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    activarColgada(cf, reg);
    await abrir(servidorFalso(reg, { guardado: CODIGO }), cf);
    await tocar();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(hayAlgunaSalida()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(recargarDelPaso()).not.toBeNull();
  });

  it("el canje que nunca contesta también ofrece Volver a cargar", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg);
    const canje = diferido<ResultadoDeAlta<CanjeDeCupon>>();
    const srv = servidorFalso(reg, { guardado: CODIGO, canjearImpl: () => canje.p });
    await abrir(srv, cf);
    try {
      await tocar();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(hayAlgunaSalida()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(recargarDelPaso()).not.toBeNull();
      expect(principal().textContent).toBe(t("altaRevisando"));
    } finally {
      // Se suelta el canje para que no quede colgado en las pruebas que siguen (es del módulo, no del paso).
      canje.mal(new Error("fin de la prueba"));
      await vi.advanceTimersByTimeAsync(10);
    }
  });

  it("el cupón con la cuenta ya activada no tiene salida: sus esperas terminan solas", async () => {
    const reg: Registro = [];
    const cf = cuentaFalsa(reg, { activacion: "lista", proteccion: "lista" });
    const srv = servidorFalso(reg, {
      acceso: "cupon",
      guardado: CODIGO,
      canjearImpl: async () => {
        await esperar(40_000);
        return ok<CanjeDeCupon>({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "lista" });
      },
      antesDelEstado: async (n) => {
        if (n > 1) await esperar(20_000);
      },
    });
    const { salidas } = await abrir(srv, cf, { para: "sello", cupon: "escribir" });
    expect(principal().textContent).toBe(t("cupoOfUsarCupon"));
    await tocar();
    await recorrer(65, (s) => {
      expect(hayAlgunaSalida(), `${s} s`).toBe(false);
    });
    expect(textoDe()).toContain(t("clListaTitulo"));
    expect(salidas.recargar).not.toHaveBeenCalled();
  });

  describe("esperando el pedido de crear la cuenta, la salida no recarga", () => {
    it("a los 45 s ofrece Probar de nuevo, y tocarlo corta la espera y deja la falla de hoy, sin recargar", async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg);
      pedidoDespues(cf, reg, 3_000, () => false);
      const { salidas } = await abrir(servidorFalso(reg, { regalo: true }), cf);
      await tocar();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(hayAlgunaSalida()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(dejarElPedido()?.textContent).toBe(t("clProbarDeNuevo"));
      expect(recargarDelPaso()).toBeNull();
      expect(pie()).toBe(t("clErrTarda"));
      await vi.advanceTimersByTimeAsync(4_000);
      const lecturas = (): number => reg.filter((x) => x === "estadoOficial(false)").length;
      const antes = lecturas();
      const antesDelToque = [...reg];
      dejarElPedido()?.click();
      await vi.advanceTimersByTimeAsync(0);
      // La lectura en curso no se corta, y la salida se va sin ofrecer otra.
      expect(dejarElPedido()).toBeNull();
      expect(recargarDelPaso()).toBeNull();
      expect(reg.slice(0, antesDelToque.length)).toEqual(antesDelToque);
      expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
      await recorrer(8, () => {
        expect(hayAlgunaSalida()).toBe(false);
        expect(raiz()?.querySelector('[data-accion="salir-y-entrar"]')).toBeNull();
        expect(raiz()?.querySelector('[data-accion="entrar-de-nuevo"]')).toBeNull();
      });
      // A lo sumo una lectura más, y enseguida la falla de hoy con su Probar de nuevo que sigue desde ahí.
      expect(lecturas() - antes).toBeLessThanOrEqual(2);
      expect(alerta()).toContain(t("clErrFallo"));
      expect(principal().dataset.accion).toBe("seguir-cupon");
      expect(principal().textContent).toBe(t("clProbarDeNuevo"));
      const quedo = lecturas();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(lecturas()).toBe(quedo);
      expect(salidas.recargar).not.toHaveBeenCalled();
      // Probar de nuevo desde la falla vuelve a esperar el pedido desde la primera vuelta.
      principal().click();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lecturas()).toBeGreaterThan(quedo);
      expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    });

    it("variante A: el pedido aparece mientras corre la lectura del toque y la cadena sigue sola, sin recargar", async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg, { proteccion: "lista" });
      let aparece = false;
      pedidoDespues(cf, reg, 3_000, () => aparece);
      const { salidas } = await abrir(servidorFalso(reg, { regalo: true }), cf);
      await tocar();
      await vi.advanceTimersByTimeAsync(49_000);
      expect(dejarElPedido()).not.toBeNull();
      dejarElPedido()?.click();
      aparece = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
      expect(textoDe()).toContain(t("clListaTitulo"));
      expect(hayAlgunaSalida()).toBe(false);
      expect(errores()).toBe(0);
      expect(salidas.recargar).not.toHaveBeenCalled();
    });

    it("variante B: el pedido nunca aparece y la cadena termina en su falla de hoy, sin pedir cerrar sesión en ningún momento", async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg);
      pedidoDespues(cf, reg, 3_000, () => false);
      await abrir(servidorFalso(reg, { regalo: true }), cf);
      await tocar();
      await recorrer(46, () => undefined);
      dejarElPedido()?.click();
      await recorrer(220, () => {
        expect(raiz()?.querySelector('[data-accion="salir-y-entrar"]')).toBeNull();
        expect(raiz()?.querySelector('[data-accion="entrar-de-nuevo"]')).toBeNull();
        expect(recargarDelPaso()).toBeNull();
      });
      expect(alerta()).toContain(t("clErrFallo"));
      expect(principal().dataset.accion).toBe("seguir-cupon");
    });

    it("variante C: el regalo que ya estaba y dos llamadas lentas: la espera empieza pasada de tiempo y ya es Probar de nuevo", async () => {
      const reg: Registro = [];
      const cf = cuentaFalsa(reg);
      pedidoDespues(cf, reg, 3_000, () => false);
      const srv = servidorFalso(reg, {
        regalo: true,
        reclamarImpl: async (s) => {
          await esperar(20_000);
          s.acceso = "admin";
          return mal("altaErrServicio", "ya-tiene-acceso", 409);
        },
        antesDelEstado: async (n) => {
          if (n === 2) await esperar(26_000);
        },
      });
      const { salidas } = await abrir(srv, cf);
      await tocar();
      await vi.advanceTimersByTimeAsync(45_500);
      // Todavía se pregunta el acceso: esa espera sí se recarga.
      expect(recargarDelPaso()).not.toBeNull();
      await recorrer(30, (s) => {
        // Desde que empieza la espera del pedido (a los 46 s), siempre Probar de nuevo, nunca recargar.
        expect(dejarElPedido() !== null, `${s} s`).toBe(true);
        expect(recargarDelPaso(), `${s} s`).toBeNull();
      });
      expect(salidas.recargar).not.toHaveBeenCalled();
    });
  });
});

describe("proteger: Mandando el código tiene salida y confirmar, no", () => {
  const abrirParaProteger = async (reg: Registro, preparar: (cf: ReturnType<typeof cuentaFalsa>) => void) => {
    const cf = cuentaFalsa(reg, { activacion: "lista" });
    preparar(cf);
    return { cf, ...(await abrir(servidorFalso(reg, { acceso: "cupon" }), cf)) };
  };

  it("mandar el código que no sale: Volver a cargar a los 45 s, en la caja de proteger", async () => {
    const reg: Registro = [];
    const { salidas } = await abrirParaProteger(reg, (cf) => cf.cuenta.mandarCodigoDeProteccion.mockImplementation(() => new Promise<undefined>(() => undefined)));
    expect(principal().dataset.accion).toBe("mandar-codigo");
    await tocar();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(recargarDelPaso()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const salida = recargarDelPaso();
    expect(salida?.textContent).toBe(t("loginRecargar"));
    expect(salida?.closest(".cl-paso")?.getAttribute("data-parte")).toBe("proteger");
    expect(principal().dataset.accion).toBe("mandar-codigo");
    expect(pie()).toBe(t("clActivarLento"));
    salida?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(salidas.recargar).toHaveBeenCalledTimes(1);
  });

  it("confirmar el código colgado: sin salida, y a los 60 s su aviso de siempre", async () => {
    const reg: Registro = [];
    const { cf } = await abrirParaProteger(reg, (cf) => cf.cuenta.confirmarCodigoDeProteccion.mockImplementation(() => new Promise<boolean>(() => undefined)));
    principal().click();
    await pasa(100);
    const campo = raiz()?.querySelector<HTMLInputElement>("#cl-codigo");
    expect(campo).not.toBeNull();
    (campo as HTMLInputElement).value = "ABCD1234E";
    (campo as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));
    await pasa();
    expect(principal().dataset.accion).toBe("confirmar-codigo");
    await tocar();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(hayAlgunaSalida()).toBe(false);
    expect(principal().getAttribute("aria-busy")).toBe("true");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(alerta()).toContain(t("protTarda"));
    expect(hayAlgunaSalida()).toBe(false);
    expect(cf.cuenta.confirmarCodigoDeProteccion).toHaveBeenCalledTimes(1);
  });
});
