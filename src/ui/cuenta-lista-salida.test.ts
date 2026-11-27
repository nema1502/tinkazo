// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import type { CanjeDeCupon, EstadoDeAlta, ReclamoDelRegalo, ResultadoDeAlta } from "../stellar/alta-api";
import type { EstadoOficial, ResultadoDeActivar } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";

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
function servidorFalso(reg: Registro, o: { acceso?: EstadoDeAlta["acceso"]; guardado?: string | null; regalo?: boolean } = {}) {
  const s = { acceso: o.acceso ?? ("ninguno" as EstadoDeAlta["acceso"]), guardado: o.guardado ?? null, regalo: o.regalo ?? false };
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
    estado: vi.fn(async () => (reg.push("estado"), ok(estadoDe()))),
    canjear: vi.fn(async (): Promise<ResultadoDeAlta<CanjeDeCupon>> => {
      reg.push("canjear");
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
    s.acceso = "admin";
    return ok({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } }, regalo: "dado", sigue: "activar" });
  });
  const acceso: AccesoDelPaso = s.regalo ? { ...base, reclamar } : base;
  return { s, acceso, base, reclamar };
}

/** La cuenta de mentira: activarla la deja lista. */
function cuentaFalsa(reg: Registro, inicial: Partial<Est> = {}, partes: Partial<CuentaDelPaso> = {}) {
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
    ...partes,
  } satisfies CuentaDelPaso;
  return { cuenta, estado };
}

const salidasFalsas = () => ({ cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() });

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const visibles = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

async function abrir(srv: ReturnType<typeof servidorFalso>, cf: ReturnType<typeof cuentaFalsa>) {
  const salidas = salidasFalsas();
  const promesa = abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.estado.est, acceso: srv.acceso });
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
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
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
