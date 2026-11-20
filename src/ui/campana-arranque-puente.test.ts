// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El arranque del sorteo de una empresa (`arrancar`): las escuchas del sello se registran al cargar la página, con el módulo
 * ya bajado, y el panel de quien organiza se monta con `?campana` o cuando esta compu tiene una sala de campaña activa. Sin
 * ninguna de las dos cosas, el panel no existe y el cuadro de la lista de siempre se ve.
 */

const h = vi.hoisted(() => ({ puente: vi.fn(), panel: vi.fn(), arrancarPremio: vi.fn() }));

vi.mock("./wallet-ui", () => ({ currentSession: () => null }));
vi.mock("./cuenta-lista-flujo", () => ({
  callarPasoEnEstaCarga: () => undefined,
  esperarAQuienGano: () => undefined,
  nadaSeAbreSolo: () => false,
  permitirPasoDelPremio: () => undefined,
}));
vi.mock("./campana-resultado-real", () => ({ arrancarElPuente: () => h.puente() }));
vi.mock("./campana-sala", () => ({ montarPanelDeCampana: () => h.panel() }));
vi.mock("./premio-entrada", () => ({ arrancarPremio: (...a: unknown[]) => h.arrancarPremio(...a) }));

const dejarCorrer = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const arrancar = async (): Promise<void> => (await import("./campana-arranque")).arrancar();

function ponerSala(fase: string, red: string): void {
  localStorage.setItem(
    "tinkazo.campana.org",
    JSON.stringify({
      [red]: {
        sala: {
          id: "AbCd1234",
          token: "T".repeat(22),
          clave: "C".repeat(22),
          vence: Date.now() + 3_600_000,
          servicio: "https://s.tinkazo.app",
          evento: "evento-uno",
          red,
        },
        fase,
      },
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_CAMPANAS", "1");
  h.puente.mockReset();
  h.panel.mockReset();
  h.arrancarPremio.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("el arranque del sorteo de una empresa", () => {
  it("sin ?campana y sin sala de campaña, no monta el panel pero deja registradas las escuchas del sello", async () => {
    await arrancar();
    await dejarCorrer();
    expect(h.puente).toHaveBeenCalledTimes(1);
    expect(h.panel).not.toHaveBeenCalled();
    expect(document.getElementById("cpo-panel")).toBeNull();
  });

  it("con ?campana monta el panel", async () => {
    history.replaceState(null, "", "/?campana");
    await arrancar();
    await dejarCorrer();
    expect(h.panel).toHaveBeenCalledTimes(1);
    expect(h.puente).toHaveBeenCalledTimes(1);
  });

  it.each(["abierta", "cerrada", "sellada", "sorteada"])("con la sala en %s y sin ?campana (vuelve de Google) monta el panel", async (fase) => {
    const { network } = await import("../stellar/config");
    ponerSala(fase, network.name);
    await arrancar();
    await dejarCorrer();
    expect(h.panel).toHaveBeenCalledTimes(1);
    expect(h.puente).toHaveBeenCalledTimes(1);
  });

  it("con la sala de la otra red no monta el panel", async () => {
    const { network } = await import("../stellar/config");
    ponerSala("cerrada", network.name === "mainnet" ? "testnet" : "mainnet");
    await arrancar();
    await dejarCorrer();
    expect(h.panel).not.toHaveBeenCalled();
  });

  it("quien entra a ver su premio no monta nada del sorteo de una empresa", async () => {
    history.replaceState(null, "", "/?premio=1&campana");
    await arrancar();
    await dejarCorrer();
    expect(h.panel).not.toHaveBeenCalled();
    expect(h.puente).not.toHaveBeenCalled();
    expect(h.arrancarPremio).toHaveBeenCalledTimes(1);
  });
});
