// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import type { EstadoDeAlta, ResultadoDeAlta } from "../stellar/alta-api";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import {
  type AccesoDelPaso,
  type CuentaDelPaso,
  GUARDA_DE_TOQUE_MS,
  type OpcionesDelPaso,
  abrirCuentaLista,
  aceptarClicsDePrueba,
} from "./cuenta-lista";
import { accesoDelServidor } from "./cuenta-lista-acceso";
import type { Para } from "./cuenta-lista-estado";

/**
 * El paso de quien ganó un premio (`para: "premio"`), en jsdom y con un servidor de las altas de mentira: sin red.
 * Lo que se prueba con lo que la persona ve, escrito a mano. La propiedad que no se rompe: la entrada del premio no
 * salta el acceso, así que con el servidor mandando una cuenta sin activar y sin el acceso confirmado no se activa
 * nunca, con ningún `para`.
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
const LISTA: Est = { ...NUEVA, activacion: "lista", proteccion: "lista" };
const PARAS: Para[] = ["entrada", "entrada-con-lista", "sello", "sorteo", "premio"];

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });

/** El servidor de las altas, de mentira: contesta el acceso que se le diga, de la cuenta GAAA y con cero sorteos. */
function servidorFalso(acceso: EstadoDeAlta["acceso"] = "ninguno") {
  const s = { acceso };
  const estadoDe = (): EstadoDeAlta => ({
    acceso: s.acceso,
    cuenta: "GAAA",
    abierta: false,
    pedido: null,
    sorteos: { quedan: 0, proximoVence: null },
    orden: null,
    fondeo: "inmediato",
  });
  const acceso$ = {
    estado: vi.fn(async () => ok(estadoDe())),
    canjear: vi.fn(async () => {
      throw new Error("el premio no canjea cupones");
    }),
    cuponGuardado: vi.fn(() => null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => "GAAA"),
  } satisfies AccesoDelPaso;
  return { s, acceso: acceso$ };
}

/** La cuenta de Pollar, de mentira: activar la deja lista. */
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
const textosDeBotones = (): string[] => visibles().map((b) => b.textContent ?? "");
const hayBoton = (texto: string): boolean => textosDeBotones().includes(texto);
const textoDe = (): string => raiz()?.textContent ?? "";
const campoDelCupon = (): HTMLInputElement | null => raiz()?.querySelector<HTMLInputElement>("#cl-cupon") ?? null;
const campoALaVista = (): boolean => !!campoDelCupon() && !campoDelCupon()?.closest("[hidden]");
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

async function abrir(o: { est?: Partial<Est>; acceso?: ReturnType<typeof servidorFalso>; op?: Partial<OpcionesDelPaso>; para?: Para } = {}) {
  const srv = o.acceso ?? servidorFalso();
  const cf = cuentaFalsa(o.est);
  const salidas = salidasFalsas();
  const opciones: OpcionesDelPaso = {
    para: o.para ?? "premio",
    correo: "ana@example.org",
    celular: true,
    inicial: cf.estado.est,
    acceso: srv.acceso,
    ...o.op,
  };
  const promesa = abrirCuentaLista(cf.cuenta, salidas, opciones);
  await pasa();
  return { srv, cf, salidas, promesa };
}

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<main id="pagina"><button id="btn-freeze">Sellar la lista</button></main>`;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  // En el final, Escape cierra el paso (Seguir o Volver). Antes del final solo mueve el foco: ahí queda Cerrar sesión.
  if (raiz()) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
  }
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

describe("el premio sin el acceso confirmado: la espera", () => {
  it("se ve el título, la línea y la principal de volver a preguntar, y nada de cupón ni de Prueba", async () => {
    await abrir();
    expect(textoDe()).toContain("Tu premio se está preparando");
    expect(textoDe()).toContain("Probá de nuevo en un minuto.");
    expect(principal().textContent).toBe("Probar de nuevo");
    expect(hayBoton("Cerrar sesión")).toBe(true);
    expect(hayBoton("Pasar a Prueba")).toBe(false);
    expect(hayBoton("Tengo un cupón")).toBe(false);
    expect(campoDelCupon()).toBeNull();
    expect(textoDe()).not.toContain("Activar mi cuenta");
  });

  it("en inglés dice lo mismo, en inglés", async () => {
    setLang("en");
    await abrir();
    expect(textoDe()).toContain("Your prize is being prepared");
    expect(textoDe()).toContain("Try again in a minute.");
    expect(principal().textContent).toBe("Try again");
    expect(hayBoton("Sign out")).toBe(true);
    expect(hayBoton("Switch to Test")).toBe(false);
  });

  it("tocar la principal vuelve a preguntar el acceso y nunca activa", async () => {
    const { srv, cf } = await abrir();
    const antes = srv.acceso.estado.mock.calls.length;
    principal().click();
    await pasa();
    expect(srv.acceso.estado.mock.calls.length).toBeGreaterThan(antes);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(srv.acceso.canjear).not.toHaveBeenCalled();
  });

  it("si el servidor contesta premio y se toca Probar de nuevo, aparece Activar mi cuenta, que activa una vez y sigue con proteger", async () => {
    const srv = servidorFalso("ninguno");
    const { cf } = await abrir({ acceso: srv });
    srv.s.acceso = "premio";
    principal().click();
    await pasa();
    expect(principal().textContent).toBe("Activar mi cuenta");
    expect(hayBoton("Pasar a Prueba")).toBe(false);
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(textoDe()).toContain("Protegé tu cuenta");
  });

  it("para quien organiza, el acceso premio también deja activar, con el mismo toque", async () => {
    const { cf } = await abrir({ para: "entrada", acceso: servidorFalso("premio") });
    expect(principal().textContent).toBe("Activar mi cuenta");
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("con la cuenta ya activada y cero sorteos, sigue con proteger sin pedir sorteos ni cupón", async () => {
    await abrir({ est: { activacion: "lista" } });
    expect(textoDe()).toContain("Protegé tu cuenta");
    expect(textoDe()).not.toContain(t("altaTituloSorteos"));
    expect(hayBoton("Tengo un cupón")).toBe(false);
    expect(hayBoton("Pasar a Prueba")).toBe(false);
  });
});

describe("la entrada del premio no salta el acceso", () => {
  it.each(PARAS)("con para %s y el servidor sin acceso: tocar la principal, Escape y el resto no activan nada", async (para) => {
    const { srv, cf } = await abrir({ para });
    expect(hayBoton("Activar mi cuenta")).toBe(false);
    const antes = srv.acceso.estado.mock.calls.length;
    // La principal hace lo suyo, y se ve que el toque llegó: con el premio vuelve a preguntar, con los otros abre el cupón.
    principal().click();
    await pasa();
    if (para === "premio") expect(srv.acceso.estado.mock.calls.length, "volvió a preguntar").toBeGreaterThan(antes);
    else expect(campoALaVista(), "se abrió el campo del cupón").toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    raiz()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(hayBoton("Activar mi cuenta")).toBe(false);
  });

  it("aunque la principal llegara a decir activar, el paso no vota sin el acceso confirmado", async () => {
    const { cf } = await abrir({ acceso: servidorFalso("ninguno") });
    principal().dataset.accion = "activar";
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });

  it("el control: con el acceso premio confirmado, esa misma acción sí vota, una sola vez", async () => {
    const { cf } = await abrir({ acceso: servidorFalso("premio") });
    principal().dataset.accion = "activar";
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });
});

describe("el acceso premio de otra cuenta", () => {
  it("si el servidor contesta premio para otra cuenta, el paso lo dice, sin Activar mi cuenta y sin activar nada", async () => {
    const sorteos = { quedan: 0, proximoVence: null };
    const cuerpo = { acceso: "premio", cuenta: "GAAA", abierta: false, pedido: null, sorteos, orden: null, fondeo: "inmediato" };
    const pedido = async (): Promise<Response> => ({ status: 200, json: async () => cuerpo }) as unknown as Response;
    const sesion = { token: async () => "token-de-la-sesion-de-prueba-0123456789", sesionViva: () => true, cuenta: () => "GBBB" };
    const real = accesoDelServidor(sesion, { url: "https://pm.prueba.invalid", fetch: pedido as unknown as typeof fetch });
    const acceso: AccesoDelPaso = { ...servidorFalso().acceso, estado: () => real.estado(), cuenta: () => "GBBB" };
    const cf = cuentaFalsa();
    void abrirCuentaLista(cf.cuenta, salidasFalsas(), { para: "premio", correo: "ana@example.org", celular: true, inicial: cf.estado.est, acceso });
    await pasa();
    expect(textoDe()).toContain(t("altaErrCuentaDeOtro"));
    expect(hayBoton("Activar mi cuenta")).toBe(false);
    expect(hayBoton("Pasar a Prueba")).toBe(false);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });
});

describe("el final del premio", () => {
  const conPrimerSello = () => ({ pendiente: vi.fn(() => true), marcar: vi.fn() });

  it("dice que la cuenta está lista, ofrece Seguir, no ofrece Volver y no nombra el primer sello", async () => {
    const primerOficial = conPrimerSello();
    await abrir({ est: LISTA, op: { primerOficial } });
    expect(textoDe()).toContain("Tu cuenta está lista");
    expect(textoDe()).toContain("Ya podés recibir tu premio.");
    expect(textoDe()).not.toContain("Solo se publica el sello, nunca los nombres.");
    expect(principal().textContent).toBe("Seguir");
    expect(hayBoton("Volver")).toBe(false);
  });

  it("Seguir devuelve verdadero y no marca el primer sello", async () => {
    const primerOficial = conPrimerSello();
    const { promesa } = await abrir({ est: LISTA, op: { primerOficial } });
    principal().click();
    await expect(promesa).resolves.toBe(true);
    expect(primerOficial.marcar).not.toHaveBeenCalled();
  });

  it("Escape en el final también devuelve verdadero, sin marcar el primer sello", async () => {
    const primerOficial = conPrimerSello();
    const { promesa } = await abrir({ est: LISTA, op: { primerOficial } });
    raiz()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(promesa).resolves.toBe(true);
    expect(primerOficial.marcar).not.toHaveBeenCalled();
  });

  it("si quien organiza toca Sellar con el paso abierto como premio, sube a sello: muestra el primer sello y lo marca una vez", async () => {
    const primerOficial = conPrimerSello();
    const alSeguir = vi.fn();
    const cf = cuentaFalsa(LISTA);
    const acceso = servidorFalso("cupon").acceso;
    const base = { correo: "ana@example.org", celular: true, inicial: cf.estado.est, acceso, primerOficial };
    const promesa = abrirCuentaLista(cf.cuenta, salidasFalsas(), { ...base, para: "premio" });
    await pasa();
    void abrirCuentaLista(cf.cuenta, salidasFalsas(), { ...base, para: "sello", alSeguir });
    await pasa();
    expect(textoDe()).toContain("Solo se publica el sello, nunca los nombres.");
    expect(principal().textContent).toBe("Sellar la lista");
    principal().click();
    await expect(promesa).resolves.toBe(true);
    expect(primerOficial.marcar).toHaveBeenCalledTimes(1);
    expect(alSeguir).toHaveBeenCalledTimes(1);
  });

  it("con un paso abierto para sellar, abrir otro como premio lo deja en sellar", async () => {
    const cf = cuentaFalsa(LISTA);
    const base = { correo: "ana@example.org", celular: true, inicial: cf.estado.est, acceso: servidorFalso("cupon").acceso };
    void abrirCuentaLista(cf.cuenta, salidasFalsas(), { ...base, para: "sello" });
    await pasa();
    void abrirCuentaLista(cf.cuenta, salidasFalsas(), { ...base, para: "premio" });
    await pasa();
    expect(principal().textContent).toBe("Sellar la lista");
    expect(textoDe()).not.toContain("Ya podés recibir tu premio.");
  });
});
