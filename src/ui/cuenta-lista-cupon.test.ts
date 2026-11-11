// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import type { CanjeDeCupon, ErrorDeAlta, EstadoDeAlta, ResultadoDeAlta } from "../stellar/alta-api";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, PEDIDO_CADA_MS, PEDIDO_VECES, type OpcionesDelPaso, abrirCuentaLista, aceptarClicsDePrueba, formatoDelCupon } from "./cuenta-lista";

/**
 * La caja del acceso de «Dejá tu cuenta lista» (W8 del cobro por uso), en jsdom, con un servidor de las altas y una
 * cuenta de Pollar de mentira: sin red. La cadena de «Activar con mi cupón» (canjear, esperar el pedido de crear la
 * cuenta, activarla y volver a preguntarle al servidor), un error en cada paso, el cupón del enlace ya puesto, las
 * salidas siempre a la vista, el doble toque y cerrar y volver a abrir a mitad de camino.
 */

type Est = EstadoOficial;
const NUEVA: Est = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
const CODIGO = "K7M29QXA4HTR";
const A_LA_VISTA = "K7M2-9QXA-4HTR";

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const mal = (clave: string, motivo: string, estado = 409, vars: Record<string, string> = {}): ErrorDeAlta => ({ ok: false, clave, vars, motivo, estado });

/**
 * El servidor de las altas, de mentira: recuerda el acceso, el cupón de la pestaña y lo que le pidieron. Con `pestana`,
 * el cupón vive ahí: dos sesiones en el mismo navegador comparten la pestaña.
 */
function servidorFalso(o: { acceso?: EstadoDeAlta["acceso"]; guardado?: string | null; cuenta?: string; pestana?: { guardado: string | null } } = {}) {
  const s = {
    /** La cuenta de la sesión: la que dice el servidor y la que tiene el paso. */
    cuenta: o.cuenta ?? "GAAA",
    acceso: o.acceso ?? ("ninguno" as EstadoDeAlta["acceso"]),
    guardado: o.guardado ?? null,
    canjes: [] as string[],
    /** Lo que contesta el próximo canje (si no, sale bien). */
    canjeImpl: null as null | ((c: string) => Promise<ResultadoDeAlta<CanjeDeCupon>>),
    /** Lo que contesta el próximo estado (si no, el de verdad). */
    estadoImpl: null as null | (() => Promise<ResultadoDeAlta<EstadoDeAlta>>),
    sigue: "activar" as CanjeDeCupon["sigue"],
  };
  const estadoDe = (): EstadoDeAlta => ({ acceso: s.acceso, cuenta: s.cuenta, abierta: false, pedido: null, sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: null }, orden: null, fondeo: "inmediato" });
  const pestana = o.pestana ?? s;
  const acceso = {
    estado: vi.fn(async () => (s.estadoImpl ? s.estadoImpl() : ok(estadoDe()))),
    canjear: vi.fn(async (c: string) => {
      s.canjes.push(c);
      if (s.canjeImpl) return s.canjeImpl(c);
      s.acceso = "cupon";
      return ok<CanjeDeCupon>({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: s.sigue });
    }),
    cuponGuardado: vi.fn(() => pestana.guardado),
    guardarCupon: vi.fn((c: string) => void (pestana.guardado = c)),
    olvidarCupon: vi.fn(() => void (pestana.guardado = null)),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => s.cuenta),
  } satisfies AccesoDelPaso;
  return { s, acceso };
}

/** La cuenta de Pollar, de mentira: activar la deja lista; sin pedido de crearla, `preparando`. */
function cuentaFalsa(inicial: Partial<Est> = {}, partes: Partial<CuentaDelPaso> = {}) {
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
    ...partes,
  } satisfies CuentaDelPaso;
  return { cuenta, estado };
}

const salidasFalsas = () => ({ cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() });

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
const campo = (): HTMLInputElement | null => raiz()?.querySelector<HTMLInputElement>("#cl-cupon") ?? null;
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const escribir = (valor: string): void => {
  const c = campo() as HTMLInputElement;
  c.value = valor;
  c.dispatchEvent(new Event("input", { bubbles: true }));
};
/** Las dos salidas, a la vista y prendidas. */
const salidasALaVista = (): void => {
  expect(boton(t("modeSwitchToTest")).disabled).toBe(false);
  expect(boton(t("acctSignOut")).disabled).toBe(false);
};

async function abrir(o: { inicial?: Partial<Est>; acceso?: ReturnType<typeof servidorFalso>; cuenta?: ReturnType<typeof cuentaFalsa>; op?: Partial<OpcionesDelPaso> } = {}) {
  const srv = o.acceso ?? servidorFalso();
  const cf = o.cuenta ?? cuentaFalsa(o.inicial);
  const salidas = salidasFalsas();
  const promesa = abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.estado.est, acceso: srv.acceso, ...o.op });
  await pasa();
  return { srv, cf, salidas, promesa };
}

/** Cierra el paso abierto con su salida «Cerrar sesión» (la de mentira no toca el cupón). */
async function cerrarElPaso(): Promise<void> {
  boton(t("acctSignOut")).click();
  await vi.advanceTimersByTimeAsync(10);
  expect(raiz()).toBeNull();
}

let consola: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<main id="pagina"><button id="btn-freeze">Sellar la lista</button></main>`;
  consola = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});

afterEach(async () => {
  // El código de un cupón nunca va a la consola.
  for (const c of consola) for (const llamada of c.mock.calls) expect(JSON.stringify(llamada)).not.toMatch(/K7M2-?9QXA-?4HTR/i);
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

describe("la cadena de «Activar con mi cupón»", () => {
  it("con el cupón del enlace ya puesto: canjea, espera el pedido, activa, vuelve a preguntar y refresca el cupo", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const { cf } = await abrir({ acceso: srv });
    // El cupón del enlace, a la vista y listo.
    expect(textoDe()).toContain(t("altaCuponListo").replace("{codigo}", A_LA_VISTA));
    expect(raiz()?.querySelector(".cl-cupon-listo")?.textContent).toBe(A_LA_VISTA);
    expect(principal().textContent).toBe(t("altaActivarConCupon"));
    expect(textoDe()).toContain(t("altaNoTengo"));
    // Nunca «Activar mi cuenta» sin el acceso.
    expect(visibles().some((b) => b.dataset.accion === "activar")).toBe(false);
    expect(srv.acceso.estado).toHaveBeenCalledTimes(1);
    principal().click();
    await pasa(10);
    expect(srv.s.canjes).toEqual([CODIGO]);
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    // Antes del voto, el estado de esta sesión; después de activar, otra vez (así el servidor no cuenta dos veces la
    // activación) y el cupo.
    expect(srv.acceso.estado).toHaveBeenCalledTimes(3);
    expect(srv.acceso.refrescarCupo.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(srv.acceso.olvidarCupon).toHaveBeenCalled();
    expect(srv.s.guardado).toBeNull();
    // La parte 1 lista, y ahora proteger.
    expect(raiz()?.querySelector('[data-parte="activar"]')?.getAttribute("data-estado")).toBe("lista");
    expect(textoDe()).toContain(t("clActivada"));
    expect(principal().dataset.accion).not.toBe("usar-cupon");
  });

  it("escrito a mano: los guiones se ponen solos, se guarda antes de mandarlo, y Enter lo canjea", async () => {
    const { srv } = await abrir();
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    principal().click();
    await pasa();
    const c = campo() as HTMLInputElement;
    expect(c).not.toBeNull();
    expect(c.getAttribute("inputmode")).toBe("text");
    expect(c.getAttribute("autocapitalize")).toBe("characters");
    expect(c.autocomplete).toBe("off");
    expect(raiz()?.querySelector('label[for="cl-cupon"]')?.textContent).toBe(t("altaCuponLabel"));
    expect(textoDe()).toContain(t("altaCuponAyuda"));
    expect(principal().textContent).toBe(t("altaActivarConCupon"));
    expect(principal().disabled).toBe(true);
    escribir("k7m2 9qxa 4ht");
    expect(c.value).toBe("K7M2-9QXA-4HT");
    expect(principal().disabled).toBe(true);
    escribir("k7m29qxa4htr");
    expect(c.value).toBe(A_LA_VISTA);
    expect(principal().disabled).toBe(false);
    await pasa();
    (raiz()?.querySelector(".cl-form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await pasa(10);
    expect(srv.acceso.guardarCupon).toHaveBeenCalledWith(CODIGO);
    expect(srv.s.canjes).toEqual([CODIGO]);
  });

  it("la O se lee 0 y la I o la L, 1; lo que no es del alfabeto no entra; un enlace pegado deja solo el cupón", () => {
    expect(formatoDelCupon("kom2-9qxa-4htr")).toBe("K0M2-9QXA-4HTR");
    expect(formatoDelCupon("iL")).toBe("11");
    expect(formatoDelCupon("u!@ #k")).toBe("K");
    expect(formatoDelCupon("https://tinkazo.app/?red=oficial#cupon=K7M29QXA4HTR")).toBe(A_LA_VISTA);
    expect(formatoDelCupon("K7M29QXA4HTRXYZ")).toBe(A_LA_VISTA);
  });

  it("con la cuenta ya activada y protegida, sin acceso: la caja igual; un canje que dice «lista» lleva al final", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    srv.s.sigue = "lista";
    const { cf, promesa } = await abrir({ acceso: srv, inicial: { activacion: "lista", proteccion: "lista" }, op: { para: "sello" } });
    expect(textoDe()).toContain(t("altaYaActivada"));
    expect(textoDe()).toContain(t("altaTituloSorteos"));
    expect(textoDe()).toContain(t("altaBajadaUnPaso"));
    expect(textoDe()).not.toContain(t("clListaTitulo"));
    expect(principal().textContent).toBe(t("cupoOfUsarCupon"));
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(textoDe()).toContain(t("clListaTitulo"));
    expect(principal().textContent).toBe(t("freeze"));
    principal().click();
    await expect(promesa).resolves.toBe(true);
  });

  it("con acceso ya confirmado (volvió a abrir), «Activar mi cuenta» con el texto del cupón, y después pregunta otra vez", async () => {
    const srv = servidorFalso({ acceso: "cupon" });
    const { cf } = await abrir({ acceso: srv });
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(textoDe()).toContain(t("altaActivarCupon"));
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.acceso.estado).toHaveBeenCalledTimes(2);
    expect(srv.acceso.refrescarCupo).toHaveBeenCalled();
    expect(srv.s.canjes).toEqual([]);
  });
});

describe("un error en cada paso", () => {
  it.each([
    ["cupon-no-existe", "altaErrNoExiste", {}],
    ["cupon-vencido", "altaErrVencido", { fecha: "14 de diciembre" }],
    ["cupon-anulado", "altaErrAnulado", {}],
    ["cupon-usado", "altaErrUsado", {}],
    ["lote-usado", "altaErrLote", {}],
    ["forma", "altaErrForma", {}],
  ] as const)("el canje dice %s: el texto, el cupón se olvida y queda en el campo para corregirlo", async (motivo, clave, vars) => {
    const srv = servidorFalso({ guardado: CODIGO });
    srv.s.canjeImpl = async () => mal(clave, motivo, 409, vars);
    const { cf } = await abrir({ acceso: srv });
    principal().click();
    await pasa();
    let esperado = t(clave);
    for (const [k, x] of Object.entries(vars)) esperado = esperado.replace(`{${k}}`, x);
    expect(alerta()).toContain(esperado);
    expect(srv.s.guardado).toBeNull();
    expect(campo()?.value).toBe(A_LA_VISTA);
    expect(principal().dataset.accion).toBe("usar-cupon");
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    salidasALaVista();
    // Al corregir, el error se va.
    escribir("K7M2-9QXA-4HTS");
    expect(alerta()).toBe("");
  });

  it.each([["cupon-usado", "altaErrUsado"], ["lote-usado", "altaErrLote"]] as const)(
    "el canje dice %s: el error, que es largo, se lleva a la vista entero (en un celular chico quedaba bajo el pie)",
    async (motivo, clave) => {
      const llevados: Element[] = [];
      const antes = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element) {
        llevados.push(this);
      };
      try {
        const srv = servidorFalso({ guardado: CODIGO });
        srv.s.canjeImpl = async () => mal(clave, motivo);
        await abrir({ acceso: srv });
        principal().click();
        await pasa();
        const error = raiz()?.querySelector(".cl-form .cl-error");
        expect(error?.textContent).toContain(t(clave));
        // Primero el campo, y después el error que va debajo: lo último que se lleva a la vista es el error.
        expect(llevados.at(-1)).toBe(error);
      } finally {
        Element.prototype.scrollIntoView = antes;
      }
    },
  );

  it.each([["cupon-no-existe", "altaErrNoExiste"], ["cupon-vencido", "altaErrAnulado"], ["cupon-anulado", "altaErrAnulado"], ["cupon-usado", "altaErrUsado"], ["lote-usado", "altaErrLote"]] as const)(
    "el canje dice %s: con el mismo cupón en el campo, la principal queda apagada (otro toque solo sumaba un intento); al cambiarlo, se prende",
    async (motivo, clave) => {
      const srv = servidorFalso({ guardado: CODIGO });
      srv.s.canjeImpl = async () => mal(clave, motivo);
      await abrir({ acceso: srv });
      principal().click();
      await pasa();
      expect(campo()?.value).toBe(A_LA_VISTA);
      expect(principal().dataset.accion).toBe("usar-cupon");
      expect(principal().disabled).toBe(true);
      principal().click();
      await pasa();
      expect(srv.s.canjes).toEqual([CODIGO]);
      escribir("K7M2-9QXA-4HTS");
      expect(principal().disabled).toBe(false);
      // Volver a escribir el mismo que no sirvió la deja apagada otra vez.
      escribir(A_LA_VISTA);
      expect(principal().disabled).toBe(true);
    },
  );

  it.each([
    ["altas-pausadas", "altaErrServicio", 503, {}],
    ["sin-red", "altaErrServicio", 0, {}],
    ["intentos", "altaErrIntentos", 429, { min: "12" }],
  ] as const)("el canje no se pudo (%s): el texto, y el cupón sigue guardado para probar de nuevo", async (motivo, clave, estado, vars) => {
    const srv = servidorFalso({ guardado: CODIGO });
    srv.s.canjeImpl = async () => mal(clave, motivo, estado, vars);
    await abrir({ acceso: srv });
    principal().click();
    await pasa();
    let esperado = t(clave);
    for (const [k, x] of Object.entries(vars)) esperado = esperado.replace(`{${k}}`, x);
    expect(alerta()).toContain(esperado);
    expect(srv.s.guardado).toBe(CODIGO);
    expect(principal().textContent).toBe(t("altaActivarConCupon"));
    salidasALaVista();
    srv.s.canjeImpl = null;
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.s.canjes).toEqual([CODIGO, CODIGO]);
  });

  it("la cuenta que no coincide con su acceso: el texto y «Pasar a Prueba», sin probar de nuevo", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    srv.s.canjeImpl = async () => mal("altaErrCuentaDeOtro", "cuenta-de-otro");
    const { salidas } = await abrir({ acceso: srv });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("altaErrCuentaDeOtro"));
    expect(principal().dataset.accion).toBe("pasar-a-prueba");
    principal().click();
    expect(salidas.pasarAPrueba).toHaveBeenCalled();
  });

  it("después del canje, el servidor dice que el acceso quedó en otra cuenta: su texto y «Pasar a Prueba», no «Probá de nuevo»", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    await abrir({ acceso: srv });
    srv.s.estadoImpl = async () => mal("altaErrCuentaDeOtro", "cuenta-de-otro", 0);
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(alerta()).toContain(t("altaErrCuentaDeOtro"));
    expect(alerta()).not.toContain(t("altaCuponGuardado"));
    expect(principal().dataset.accion).toBe("pasar-a-prueba");
    salidasALaVista();
  });

  it("el canje sale bien pero el acceso está atado a otra cuenta: no se vota la activación, se dice antes", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const { cf } = await abrir({ acceso: srv });
    srv.s.estadoImpl = async () => mal("altaErrCuentaDeOtro", "cuenta-de-otro", 409);
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.s.canjes).toEqual([CODIGO]);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("altaErrCuentaDeOtro"));
    expect(principal().dataset.accion).toBe("pasar-a-prueba");
    salidasALaVista();
  });

  it("el canje sale bien pero el servidor dice otra cuenta que la de la sesión: no se vota", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const { cf } = await abrir({ acceso: srv });
    srv.acceso.cuenta.mockReturnValue("GBBB");
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("altaErrCuentaDeOtro"));
  });

  it("el canje sale bien pero el servidor no ve acceso en esta sesión: no se vota, y vuelve la caja del cupón", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    srv.s.canjeImpl = async () => ok<CanjeDeCupon>({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" });
    const { cf } = await abrir({ acceso: srv });
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(visibles().some((b) => b.dataset.accion === "activar")).toBe(false);
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    salidasALaVista();
  });

  it("antes del voto el servidor no contesta: no se vota, y «Probar de nuevo» pregunta otra vez y recién ahí activa", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const { cf } = await abrir({ acceso: srv });
    srv.s.estadoImpl = async () => mal("altaErrServicio", "sin-red", 0);
    principal().click();
    await pasa(PEDIDO_CADA_MS * 2);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("altaCuponGuardado"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    srv.s.estadoImpl = null;
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.s.canjes).toEqual([CODIGO]);
  });

  it("al abrir no se supo el acceso: lo dice y «Probar de nuevo» solo vuelve a preguntar", async () => {
    const srv = servidorFalso();
    srv.s.estadoImpl = async () => mal("altaErrServicio", "sin-red", 0);
    const { cf } = await abrir({ acceso: srv });
    expect(alerta()).toContain(t("altaErrServicio"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    salidasALaVista();
    srv.s.estadoImpl = null;
    principal().click();
    await pasa();
    expect(srv.acceso.estado).toHaveBeenCalledTimes(2);
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });

  it("el pedido de crear la cuenta no aparece: «Tu cupón ya quedó en tu cuenta» y «Probar de nuevo» espera otra vez, sin canjear", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const cf = cuentaFalsa({ activacion: "preparando" });
    await abrir({ acceso: srv, cuenta: cf });
    // Mientras se prepara, la caja espera: no se puede canjear todavía sin saber cómo está la cuenta.
    cf.estado.est = { ...cf.estado.est, activacion: "preparando" };
    await pasa(25_000);
    principal().click();
    await pasa(PEDIDO_CADA_MS * (PEDIDO_VECES + 2));
    expect(alerta()).toContain(t("altaCuponGuardado"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    salidasALaVista();
    // Aparece el pedido.
    cf.estado.est = { ...cf.estado.est, activacion: "falta" };
    principal().click();
    await pasa(PEDIDO_CADA_MS);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.s.canjes).toEqual([CODIGO]);
  });

  it("la activación falla: el cupón quedó, y «Probar de nuevo» activa sin canjear otra vez", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    let veces = 0;
    const cf = cuentaFalsa(
      {},
      {
        activarCuenta: vi.fn(async () => {
          veces++;
          if (veces === 1) throw new Error("pollar-activacion-fallo");
          cf.estado.est = { ...cf.estado.est, activacion: "lista" };
          return "activada" as const;
        }),
      },
    );
    await abrir({ acceso: srv, cuenta: cf });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("altaCuponGuardado"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    salidasALaVista();
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(2);
    expect(srv.s.canjes).toEqual([CODIGO]);
    expect(raiz()?.querySelector('[data-parte="activar"]')?.getAttribute("data-estado")).toBe("lista");
  });

  it("la activación queda pendiente y no entra en un minuto: el cupón quedó, y se puede seguir", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const cf = cuentaFalsa({}, { activarCuenta: vi.fn(async () => "pendiente" as const) });
    await abrir({ acceso: srv, cuenta: cf });
    principal().click();
    await pasa(70_000);
    expect(alerta()).toContain(t("altaCuponGuardado"));
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
  });

  it("la activación sin arreglo desde acá (el tope): se dice como siempre, y el cupón no se vuelve a canjear", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const cf = cuentaFalsa({}, { activarCuenta: vi.fn(async () => Promise.reject(new Error("pollar-activacion-tope"))) });
    await abrir({ acceso: srv, cuenta: cf });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("clErrTope"));
    expect(principal().textContent).toBe(t("clSalirYEntrar"));
    expect(srv.s.canjes).toEqual([CODIGO]);
  });

  it("después de activar no contesta el servidor: el cupón quedó, y «Probar de nuevo» solo vuelve a preguntar", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const cf = cuentaFalsa(
      {},
      {
        activarCuenta: vi.fn(async () => {
          cf.estado.est = { ...cf.estado.est, activacion: "lista" };
          // Activada: desde acá el servidor no contesta.
          srv.s.estadoImpl = async () => mal("altaErrServicio", "sin-red", 0);
          return "activada" as const;
        }),
      },
    );
    await abrir({ acceso: srv, cuenta: cf });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("altaCuponGuardado"));
    srv.s.estadoImpl = null;
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.s.canjes).toEqual([CODIGO]);
    expect(raiz()?.querySelector('[data-parte="activar"]')?.getAttribute("data-estado")).toBe("lista");
  });
});

describe("lo que no se negocia", () => {
  it("doble toque: un solo canje", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    let soltar!: (r: ResultadoDeAlta<CanjeDeCupon>) => void;
    srv.s.canjeImpl = () => new Promise((r) => (soltar = r));
    await abrir({ acceso: srv });
    principal().click();
    principal().click();
    await pasa();
    principal().click();
    await pasa();
    expect(srv.acceso.canjear).toHaveBeenCalledTimes(1);
    expect(principal().textContent).toBe(t("altaRevisando"));
    expect(principal().disabled).toBe(true);
    expect(principal().getAttribute("aria-busy")).toBe("true");
    salidasALaVista();
    srv.s.acceso = "cupon";
    soltar(ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }));
    await pasa(PEDIDO_CADA_MS);
    expect(srv.acceso.canjear).toHaveBeenCalledTimes(1);
  });

  it("cerrar y volver a abrir con el canje en camino: el cupón sigue, y no se canjea de nuevo", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    let soltar!: (r: ResultadoDeAlta<CanjeDeCupon>) => void;
    srv.s.canjeImpl = () => new Promise((r) => (soltar = r));
    const cf = cuentaFalsa();
    await abrir({ acceso: srv, cuenta: cf });
    principal().click();
    await pasa(10);
    await cerrarElPaso();
    expect(srv.s.guardado).toBe(CODIGO);
    // Vuelve a abrir mientras el servidor todavía no contestó: el cupón sigue en mano.
    await abrir({ acceso: srv, cuenta: cf });
    expect(textoDe()).toContain(A_LA_VISTA);
    principal().click();
    await pasa(10);
    expect(srv.acceso.canjear).toHaveBeenCalledTimes(1);
    srv.s.acceso = "cupon";
    soltar(ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }));
    await pasa(PEDIDO_CADA_MS * 2);
    expect(srv.acceso.canjear).toHaveBeenCalledTimes(1);
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.s.guardado).toBeNull();
  });

  it("se cierra la sesión con el canje en camino y entra otra cuenta con el mismo cupón: canjea con su sesión y no sigue con el canje de la anterior", async () => {
    const srvA = servidorFalso({ guardado: CODIGO, cuenta: "GAAA" });
    let soltar!: (r: ResultadoDeAlta<CanjeDeCupon>) => void;
    srvA.s.canjeImpl = () => new Promise((r) => (soltar = r));
    await abrir({ acceso: srvA });
    principal().click();
    await pasa(10);
    await cerrarElPaso();
    // Entra la cuenta B y escribe el mismo cupón. Para el servidor, ese cupón ya es de A.
    const srvB = servidorFalso({ cuenta: "GBBB" });
    srvB.s.canjeImpl = async () => mal("altaErrUsado", "cupon-usado");
    const cfB = cuentaFalsa();
    await abrir({ acceso: srvB, cuenta: cfB });
    principal().click();
    await pasa();
    escribir(A_LA_VISTA);
    await pasa();
    principal().click();
    await pasa(10);
    expect(srvB.acceso.canjear).toHaveBeenCalledTimes(1);
    // El canje de A sale bien después: B no sigue con eso.
    srvA.s.acceso = "cupon";
    soltar(ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }));
    await pasa(PEDIDO_CADA_MS * 3);
    expect(cfB.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(alerta()).toContain(t("altaErrUsado"));
  });

  it("una sola pestaña para dos personas: el canje de la primera que sale bien tarde no borra el cupón que guardó la segunda, ni le refresca el cupo", async () => {
    const OTRO = "B7M29QXA4HTS";
    const srvA = servidorFalso({ guardado: CODIGO, cuenta: "GAAA" });
    let soltarA!: (r: ResultadoDeAlta<CanjeDeCupon>) => void;
    srvA.s.canjeImpl = () => new Promise((r) => (soltarA = r));
    await abrir({ acceso: srvA });
    principal().click();
    await pasa(10);
    expect(srvA.s.canjes).toEqual([CODIGO]);
    // A cierra la sesión con el canje en camino: el cupón de la pestaña se olvida (`cupon-enlace.ts`) y la sesión pasa a B.
    await cerrarElPaso();
    srvA.s.guardado = null;
    srvA.acceso.cuenta.mockReturnValue("GBBB");
    // B entra en la misma pestaña y escribe su cupón: se guarda antes de mandarlo.
    const srvB = servidorFalso({ cuenta: "GBBB", pestana: srvA.s });
    let soltarB!: (r: ResultadoDeAlta<CanjeDeCupon>) => void;
    srvB.s.canjeImpl = () => new Promise((r) => (soltarB = r));
    await abrir({ acceso: srvB });
    principal().click();
    await pasa();
    escribir("B7M2-9QXA-4HTS");
    await pasa();
    principal().click();
    await pasa(10);
    expect(srvB.s.canjes).toEqual([OTRO]);
    expect(srvA.s.guardado).toBe(OTRO);
    // Llega tarde la respuesta buena del canje de A: el cupón de B sigue, y el cupo de B no se toca por el canje de A.
    srvA.s.acceso = "cupon";
    soltarA(ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }));
    await pasa(10);
    expect(srvA.s.guardado).toBe(OTRO);
    expect(srvA.acceso.refrescarCupo).not.toHaveBeenCalled();
    // El canje de B no sale por la red: su cupón sigue guardado, y al volver a abrir el paso está listo para probar de nuevo.
    soltarB(mal("altaErrServicio", "sin-red", 0));
    await pasa();
    expect(alerta()).toContain(t("altaErrServicio"));
    expect(srvA.s.guardado).toBe(OTRO);
    await cerrarElPaso();
    await abrir({ acceso: srvB });
    expect(raiz()?.querySelector(".cl-cupon-listo")?.textContent).toBe("B7M2-9QXA-4HTS");
  });

  it("se cierra el paso, no la sesión, y el canje sale bien después: el cupón se olvida igual y el cupo se refresca", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    let soltar!: (r: ResultadoDeAlta<CanjeDeCupon>) => void;
    srv.s.canjeImpl = () => new Promise((r) => (soltar = r));
    await abrir({ acceso: srv });
    principal().click();
    await pasa(10);
    await cerrarElPaso();
    expect(srv.s.guardado).toBe(CODIGO);
    srv.s.acceso = "cupon";
    soltar(ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }));
    await pasa(10);
    expect(srv.acceso.olvidarCupon).toHaveBeenCalledTimes(1);
    expect(srv.s.guardado).toBeNull();
    expect(srv.acceso.refrescarCupo).toHaveBeenCalledTimes(1);
  });

  it("cerrar y volver a abrir después del canje y antes de activar: el acceso ya está, y se activa sin canjear", async () => {
    const srv = servidorFalso({ guardado: CODIGO });
    const cf = cuentaFalsa({ activacion: "preparando" });
    await abrir({ acceso: srv, cuenta: cf });
    cf.estado.est = { ...cf.estado.est, activacion: "falta" };
    await pasa(25_000);
    // Mientras espera el pedido de crear la cuenta, se cierra.
    cf.estado.est = { ...cf.estado.est, activacion: "preparando" };
    principal().click();
    await pasa(10);
    expect(srv.s.canjes).toEqual([CODIGO]);
    await cerrarElPaso();
    cf.estado.est = { ...cf.estado.est, activacion: "falta" };
    await abrir({ acceso: srv, cuenta: cf });
    expect(textoDe()).toContain(t("altaActivarCupon"));
    expect(principal().textContent).toBe(t("clActivarBoton"));
    principal().click();
    await pasa();
    expect(cf.cuenta.activarCuenta).toHaveBeenCalledTimes(1);
    expect(srv.acceso.canjear).toHaveBeenCalledTimes(1);
  });

  it("las salidas, prendidas en cada estado del acceso", async () => {
    const srv = servidorFalso();
    let soltarEstado!: (r: ResultadoDeAlta<EstadoDeAlta>) => void;
    srv.s.estadoImpl = () => new Promise((r) => (soltarEstado = r));
    await abrir({ acceso: srv });
    // Preguntando el acceso.
    salidasALaVista();
    srv.s.estadoImpl = null;
    soltarEstado(ok({ acceso: "ninguno", cuenta: "GAAA", abierta: false, pedido: null, sorteos: { quedan: 0, proximoVence: null }, orden: null, fondeo: "inmediato" }));
    await pasa();
    // Sin cupón, escribiendo, con el campo lleno y volviendo.
    salidasALaVista();
    principal().click();
    await pasa();
    salidasALaVista();
    escribir(A_LA_VISTA);
    salidasALaVista();
    boton(t("clVolver")).click();
    await pasa();
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    salidasALaVista();
  });

  it("abierto para usar un cupón («Se te acabaron»): directo al campo, con el foco ahí", async () => {
    await abrir({ inicial: { activacion: "lista", proteccion: "lista" }, acceso: servidorFalso({ acceso: "cupon" }), op: { para: "sello", cupon: "escribir" } });
    expect(campo()).not.toBeNull();
    expect(document.activeElement).toBe(campo());
    expect(textoDe()).toContain(t("altaTituloSorteos"));
    expect(principal().textContent).toBe(t("cupoOfUsarCupon"));
    expect(principal().disabled).toBe(true);
    salidasALaVista();
  });

  it("abierto para usar un cupón con la cuenta ya lista: «Volver» y Escape vuelven a la página, sin canjear nada", async () => {
    const srv = servidorFalso({ acceso: "cupon" });
    const { promesa } = await abrir({ inicial: { activacion: "lista", proteccion: "lista" }, acceso: srv, op: { para: "sello", cupon: "escribir" } });
    expect(visibles().filter((b) => b.textContent === t("clVolver"))).toHaveLength(1);
    boton(t("clVolver")).click();
    await pasa(10);
    await expect(promesa).resolves.toBe(false);
    expect(raiz()).toBeNull();
    expect(srv.acceso.canjear).not.toHaveBeenCalled();

    const otra = await abrir({ inicial: { activacion: "lista", proteccion: "lista" }, acceso: servidorFalso({ acceso: "cupon" }), op: { para: "sello", cupon: "escribir" } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await pasa(10);
    await expect(otra.promesa).resolves.toBe(false);
  });

  it("el mismo cupón otra vez, ya gastado (repetido, sin sorteos que sumar ni que queden): «Ese cupón ya se usó», sin seguir", async () => {
    const srv = servidorFalso({ acceso: "cupon", guardado: CODIGO });
    srv.s.canjeImpl = async () => ok<CanjeDeCupon>({ ok: true, repetido: true, sorteosSumados: 0, sorteos: { quedan: 0, proximoVence: null }, sigue: "lista" });
    const { cf } = await abrir({ inicial: { activacion: "lista", proteccion: "lista" }, acceso: srv, op: { para: "sello", cupon: "escribir" } });
    principal().click();
    await pasa();
    expect(alerta()).toContain(t("altaErrUsado"));
    expect(campo()?.value).toBe(A_LA_VISTA);
    expect(principal().disabled).toBe(true);
    expect(textoDe()).not.toContain(t("clListaTitulo"));
    expect(srv.acceso.estado).toHaveBeenCalledTimes(1);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });

  it("el mismo cupón otra vez con sorteos que todavía quedan: sigue, como cualquier canje", async () => {
    const srv = servidorFalso({ acceso: "cupon", guardado: CODIGO });
    srv.s.sigue = "lista";
    srv.s.canjeImpl = async () => ok<CanjeDeCupon>({ ok: true, repetido: true, sorteosSumados: 0, sorteos: { quedan: 2, proximoVence: null }, sigue: "lista" });
    await abrir({ inicial: { activacion: "lista", proteccion: "lista" }, acceso: srv, op: { para: "sello", cupon: "escribir" } });
    principal().click();
    await pasa();
    expect(alerta()).toBe("");
    expect(textoDe()).toContain(t("clListaTitulo"));
    // El final no tiene las salidas del pie: se cierra con «Volver».
    boton(t("clVolver")).click();
    await pasa(10);
    expect(raiz()).toBeNull();
  });

  it("el campo no corta lo que se pega: un enlace entero o el código con un espacio adelante quedan en el cupón", async () => {
    await abrir();
    principal().click();
    await pasa();
    const c = campo() as HTMLInputElement;
    // El navegador recorta lo pegado al tope del campo antes del evento: el tope tiene que dejar entrar un enlace entero.
    const enlace = "https://tinkazo.app/?red=oficial#cupon=K7M29QXA4HTR";
    expect(c.maxLength === -1 || c.maxLength >= enlace.length * 2).toBe(true);
    escribir(enlace);
    expect(c.value).toBe(A_LA_VISTA);
    escribir(" K7M2-9QXA-4HTR");
    expect(c.value).toBe(A_LA_VISTA);
    expect(principal().disabled).toBe(false);
  });

  it("abierto para usar un cupón con uno guardado: ese, listo para usar", async () => {
    await abrir({ inicial: { activacion: "lista", proteccion: "lista" }, acceso: servidorFalso({ acceso: "cupon", guardado: CODIGO }), op: { para: "sello", cupon: "escribir" } });
    expect(campo()).toBeNull();
    expect(textoDe()).toContain(A_LA_VISTA);
    expect(principal().textContent).toBe(t("cupoOfUsarCupon"));
  });

  it("con el acceso por cupón apagado en la red principal (cerrado): lo dice, deja las salidas y nunca activa", async () => {
    const cf = cuentaFalsa();
    const salidas = salidasFalsas();
    void abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", celular: true, inicial: cf.estado.est, acceso: "cerrado" });
    await pasa();
    expect(textoDe()).toContain(t("clErrServicio"));
    expect(visibles().some((b) => b.dataset.accion === "activar")).toBe(false);
    expect(principal().textContent).toBe(t("modeSwitchToTest"));
    expect(boton(t("acctSignOut")).disabled).toBe(false);
    principal().click();
    await pasa();
    expect(salidas.pasarAPrueba).toHaveBeenCalled();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });
});
