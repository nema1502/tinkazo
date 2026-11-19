// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «Dejá tu cuenta lista» en la red principal sin decirle de dónde sale el acceso (W3): falla cerrado. Sin el servidor de
 * las altas no se ofrece «Activar», salvo en el build del plan B1 (`VITE_ALTA_LIBRE=1`).
 */

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, network: { ...o.network, name: "mainnet" } };
});

const { setLang, t } = await import("../i18n");
const { GUARDA_DE_TOQUE_MS, abrirCuentaLista, aceptarClicsDePrueba } = await import("./cuenta-lista");

const NUEVA = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null } as const;

function cuenta() {
  return {
    estadoOficial: vi.fn(async () => ({ ...NUEVA })),
    activarCuenta: vi.fn(async () => "activada" as const),
    alCambiarLaCuenta: () => () => undefined,
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => true),
    mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
    confirmarCodigoParaEsteAparato: vi.fn(async () => true),
    protegerConPasskey: vi.fn(async () => true),
    mandarCodigoDeProteccion: vi.fn(async () => undefined),
    confirmarCodigoDeProteccion: vi.fn(async () => true),
  };
}
const salidas = () => ({ cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: () => true, entrarDeNuevo: vi.fn() });
const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const acciones = (): string[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button[data-accion]") ?? [])].filter((b) => !b.closest("[hidden]")).map((b) => b.dataset.accion ?? "");

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<main id="pagina"></main>`;
});

afterEach(async () => {
  raiz()?.querySelector<HTMLButtonElement>('[data-salida="cerrar-sesion"]')?.click();
  await vi.advanceTimersByTimeAsync(10);
  aceptarClicsDePrueba(false);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("en la red principal, sin el servidor de las altas", () => {
  it("con el acceso por cupón apagado y sin el plan B1, no hay «Activar»: lo dice y deja «Pasar a Prueba»", async () => {
    vi.stubEnv("VITE_ALTA", "");
    vi.stubEnv("VITE_ALTA_LIBRE", "");
    const c = cuenta();
    void abrirCuentaLista(c, salidas(), { para: "entrada", celular: true, inicial: { ...NUEVA } });
    await vi.advanceTimersByTimeAsync(GUARDA_DE_TOQUE_MS + 50);
    expect(acciones()).not.toContain("activar");
    expect(raiz()?.textContent).toContain(t("clErrServicio"));
    expect(raiz()?.querySelector<HTMLButtonElement>(".cl-principal")?.dataset.accion).toBe("pasar-a-prueba");
    raiz()?.querySelector<HTMLButtonElement>(".cl-principal")?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.activarCuenta).not.toHaveBeenCalled();
  });

  it("con el acceso por cupón prendido pero sin el servidor puesto en el paso, tampoco", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", "https://pm.prueba.invalid");
    const c = cuenta();
    void abrirCuentaLista(c, salidas(), { para: "entrada", celular: true, inicial: { ...NUEVA } });
    await vi.advanceTimersByTimeAsync(GUARDA_DE_TOQUE_MS + 50);
    expect(acciones()).not.toContain("activar");
  });

  it("el build del plan B1 (VITE_ALTA_LIBRE=1) deja activar sin preguntar, como antes", async () => {
    vi.stubEnv("VITE_ALTA_LIBRE", "1");
    const c = cuenta();
    void abrirCuentaLista(c, salidas(), { para: "entrada", celular: true, inicial: { ...NUEVA } });
    await vi.advanceTimersByTimeAsync(GUARDA_DE_TOQUE_MS + 50);
    expect(raiz()?.querySelector<HTMLButtonElement>(".cl-principal")?.textContent).toBe(t("clActivarBoton"));
    raiz()?.querySelector<HTMLButtonElement>(".cl-principal")?.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.activarCuenta).toHaveBeenCalledTimes(1);
  });
});
