// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destinoDeRecibir } from "../campana/conectar";
import { CLAVE_INVITADA, CLAVE_VENTANA, marcarInvitada, marcarVentana } from "../campana/invitada";

/**
 * El camino de quien ganó, de punta a punta con las marcas puestas: la persona participó (la marca de invitada vive 48 horas
 * en este navegador y una marca de la ventana de Google pudo quedar en su pestaña), toca Recibir mi premio y llega a la
 * herramienta por la dirección que arma la página de la campaña. Las marcas no le cierran el paso: se abre la ventana del
 * saldo, lo que se abre solo para quien organiza sigue cerrado, y Tus dólares abre el paso con textos de premio.
 */

type Local = { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" };

const h = vi.hoisted(() => ({
  abrir: vi.fn(),
  abrirSaldo: vi.fn(),
  billetera: null as unknown,
  estado: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, network: { ...o.network, name: "mainnet" } };
});
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false, enPractica: () => false }));
vi.mock("../state", () => ({ app: { frozen: null, drawn: null } }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => h.billetera }));
vi.mock("./cuenta-lista", () => ({ abrirCuentaLista: (...a: unknown[]) => h.abrir(...a) }));
vi.mock("../stellar/wallet-pollar", () => ({ pollarWallet: { label: "Google" }, puedeUsarDesbloqueo: async () => false }));
vi.mock("./wallet-ui", () => ({
  currentSession: () => ({ address: "GAAA", mail: "ana@example.org" }),
  estadoDeLaCuenta: () => ({ estado: "dentro", via: "google", nombre: "Ana", inicial: "A", foto: "", direccion: "GAAA" }),
  cerrarSesion: async () => undefined,
  entrar: async () => undefined,
  openPicker: async () => undefined,
}));
vi.mock("./modo-ui", () => ({
  pasarAModo: () => true,
  puedeCambiarDeModo: () => true,
  haceFaltaConfirmar: () => true,
  yaConfirmoPrimerOficial: () => false,
  marcarPrimerOficial: () => undefined,
}));
vi.mock("./participants", () => ({ parseNames: () => [] }));
vi.mock("./freeze", () => ({ freeze: async () => undefined }));
vi.mock("./saldo", () => ({ abrirSaldo: (...a: unknown[]) => h.abrirSaldo(...a) }));
vi.mock("@stellar/stellar-sdk", () => ({}));

const FALTA: Local = { activacion: "falta", proteccion: "no-se-sabe" };

/** Lo que recibió el paso en el último `abrirCuentaLista`: el tercer argumento. */
const opciones = (): { para: string } => h.abrir.mock.calls[0]?.[2] as never;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_CAMPANAS", "1");
  vi.stubEnv("VITE_RAMPA", "premios");
  h.abrir.mockReset().mockResolvedValue(true);
  h.abrirSaldo.mockReset().mockResolvedValue(undefined);
  h.estado.mockReset();
  h.billetera = {
    submitsItself: true,
    address: "GAAA",
    label: "Google",
    estadoOficialLocal: () => FALTA,
    estadoOficial: (...a: unknown[]) => h.estado(...a),
  };
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("quien ganó llega con la marca de invitada puesta", () => {
  it("Recibir mi premio lleva a la herramienta con el premio en la dirección, en la red principal", () => {
    expect(destinoDeRecibir("mainnet")).toBe("/?red=oficial&premio=1");
  });

  it("abre la ventana del saldo para su cuenta aunque la marca de invitada y una marca vieja de la ventana sigan puestas", async () => {
    marcarInvitada(localStorage, Date.now());
    marcarVentana(sessionStorage, Date.now());
    history.replaceState(null, "", destinoDeRecibir("mainnet"));
    (await import("./campana-arranque")).arrancar();
    await vi.waitFor(() => expect(h.abrirSaldo).toHaveBeenCalledWith({ address: "GAAA" }));
    expect(location.search).toBe("?red=oficial");
    expect(sessionStorage.getItem(CLAVE_VENTANA)).toBeNull();
    expect(localStorage.getItem(CLAVE_INVITADA)).not.toBeNull();
  });

  it("lo que se abre solo para quien organiza sigue cerrado y Tus dólares abre el paso para recibir", async () => {
    marcarInvitada(localStorage, Date.now());
    history.replaceState(null, "", destinoDeRecibir("mainnet"));
    (await import("./campana-arranque")).arrancar();
    const flujo = await import("./cuenta-lista-flujo");
    expect(await flujo.revisarCuentaOficial("entrada")).toBe(false);
    expect(await flujo.revisarCuentaOficial("retomar")).toBe(false);
    expect(flujo.vaAAbrirseAlEntrar()).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
    expect(await flujo.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("premio");
  });

  it("la marca de invitada sola, sin haber pasado por Recibir mi premio, no abre el paso para recibir", async () => {
    marcarInvitada(localStorage, Date.now());
    const flujo = await import("./cuenta-lista-flujo");
    expect(await flujo.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("entrada");
  });
});
