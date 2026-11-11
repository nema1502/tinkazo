// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deployments from "./deployments.json";
import { MODE_STORAGE_KEY, changeMode, hayModoOficial, network, parseModeValue, resolveNetworkName, urlForMode } from "./config";

describe("el modo que se decide al cargar", () => {
  it("la dirección manda sobre la pestaña y sobre cómo abre el sitio", () => {
    expect(resolveNetworkName({ search: "?red=oficial", stored: "prueba", build: "testnet", hasOfficialContract: true })).toBe("mainnet");
    expect(resolveNetworkName({ search: "?red=prueba", stored: "oficial", build: "mainnet", hasOfficialContract: true })).toBe("testnet");
  });

  it("sin dirección manda la elección de la pestaña, en español y en inglés", () => {
    expect(resolveNetworkName({ stored: "oficial", build: "testnet", hasOfficialContract: true })).toBe("mainnet");
    expect(resolveNetworkName({ stored: "live", build: "testnet", hasOfficialContract: true })).toBe("mainnet");
    expect(resolveNetworkName({ stored: "prueba", build: "mainnet", hasOfficialContract: true })).toBe("testnet");
    expect(resolveNetworkName({ stored: "test", build: "mainnet", hasOfficialContract: true })).toBe("testnet");
  });

  it("sin dirección ni pestaña manda cómo abre el sitio, con Prueba por defecto", () => {
    expect(resolveNetworkName({ build: "mainnet", hasOfficialContract: true })).toBe("mainnet");
    expect(resolveNetworkName({ build: "testnet", hasOfficialContract: true })).toBe("testnet");
    expect(resolveNetworkName({ hasOfficialContract: true })).toBe("testnet");
    expect(resolveNetworkName({ build: "otra-cosa", hasOfficialContract: true })).toBe("testnet");
  });

  it("sin contrato oficial, Oficial no existe y todo abre en Prueba", () => {
    expect(resolveNetworkName({ search: "?red=oficial", hasOfficialContract: false })).toBe("testnet");
    expect(resolveNetworkName({ stored: "oficial", hasOfficialContract: false })).toBe("testnet");
    expect(resolveNetworkName({ build: "mainnet", hasOfficialContract: false })).toBe("testnet");
  });

  it("un valor que no se entiende no elige nada", () => {
    expect(parseModeValue("cualquiera")).toBeNull();
    expect(parseModeValue("")).toBeNull();
    expect(parseModeValue(null)).toBeNull();
    expect(resolveNetworkName({ search: "?red=cualquiera", stored: "oficial", hasOfficialContract: true })).toBe("mainnet");
  });

  it("el parámetro no se llama modo y no pisa los que ya existen", () => {
    expect(resolveNetworkName({ search: "?modo=oficial", hasOfficialContract: true })).toBe("testnet");
    expect(urlForMode("https://tinkazo.app/?red=oficial&demo=race&lead=5#sortear", "testnet")).toBe("https://tinkazo.app/?red=prueba&demo=race&lead=5#sortear");
    // Ya está en ese modo: la dirección no cambia y changeMode recarga.
    expect(urlForMode("/equipos.html?sala=ABCD1234&red=oficial#clave", "mainnet")).toBe("/equipos.html?sala=ABCD1234&red=oficial#clave");
  });

  // Mientras la lista no tenga contrato en mainnet corre esta; el día que lo tenga, la de abajo.
  it.runIf(!hayModoOficial)("con la lista real de hoy el sitio es el de siempre: Prueba y nada nuevo a la vista", () => {
    expect((deployments as { mainnet: unknown }).mainnet).toBeNull();
    expect(hayModoOficial).toBe(false);
    expect(network.name).toBe("testnet");
    expect(network.contractId).toBe(deployments.testnet.contractId);
  });

  it.runIf(hayModoOficial)("con contrato en la red real, Oficial existe y el sitio sigue abriendo en Prueba", () => {
    expect((deployments as unknown as { mainnet: { contractId?: string } | null }).mainnet?.contractId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(hayModoOficial).toBe(true);
    expect(network.name).toBe("testnet");
    expect(network.contractId).toBe(deployments.testnet.contractId);
  });
});

describe("cambiar de modo recarga siempre, con red= en la dirección", () => {
  it("urlForMode pone red= con el modo pedido y deja una dirección distinta con el resto intacto", () => {
    expect(urlForMode("/#sortear", "mainnet")).toBe("/?red=oficial#sortear");
    expect(urlForMode("/#sortear", "testnet")).toBe("/?red=prueba#sortear");
    expect(urlForMode("/#mis-sorteos", "mainnet")).toBe("/?red=oficial#mis-sorteos");
    expect(urlForMode("/#mis-sorteos", "testnet")).toBe("/?red=prueba#mis-sorteos");
    expect(urlForMode("/?demo=race#sortear", "mainnet")).toBe("/?demo=race&red=oficial#sortear");
    expect(urlForMode("/?demo=race#sortear", "testnet")).toBe("/?demo=race&red=prueba#sortear");
    expect(urlForMode("/", "mainnet")).toBe("/?red=oficial");
    expect(urlForMode("/", "testnet")).toBe("/?red=prueba");
    expect(urlForMode("https://tinkazo.app/#sortear", "mainnet")).toBe("https://tinkazo.app/?red=oficial#sortear");
    for (const actual of ["/#sortear", "/#mis-sorteos", "/?demo=race#sortear", "/"]) {
      for (const [modo, red] of [["mainnet", "red=oficial"], ["testnet", "red=prueba"]] as const) {
        const nueva = urlForMode(actual, modo);
        expect(nueva, `${actual} a ${modo}`).not.toBe(actual);
        expect(nueva, `${actual} a ${modo}`).toContain(red);
      }
    }
    // Lo que ya traía se conserva: los otros parámetros y el fragmento siguen.
    expect(urlForMode("/?demo=race#sortear", "mainnet")).toContain("demo=race");
    expect(urlForMode("/?demo=race#sortear", "mainnet")).toContain("#sortear");
    // Cambiar al modo que ya dice la dirección la deja igual: ahí changeMode recarga.
    expect(urlForMode("/?red=prueba#sortear", "testnet")).toBe("/?red=prueba#sortear");
  });

  describe("changeMode", () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      sessionStorage.clear();
    });

    it("pide navegar a la dirección con red= o recargar, en todas las direcciones", () => {
      for (const href of ["/#sortear", "/#mis-sorteos", "/?demo=race#sortear", "/"]) {
        const assign = vi.fn();
        const reload = vi.fn();
        vi.stubGlobal("location", { href, assign, reload, hostname: "localhost", search: "", pathname: "/" });
        sessionStorage.clear();
        expect(changeMode("testnet"), href).toBe(true);
        const pedido = assign.mock.calls[0]?.[0] as string | undefined;
        if (pedido === undefined) {
          expect(reload, href).toHaveBeenCalled();
        } else {
          expect(pedido, href).not.toBe(href);
          expect(pedido, href).toContain("red=prueba");
        }
        expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBe("prueba");
        vi.unstubAllGlobals();
      }
    });

    it("cuando la dirección ya trae el modo, recarga en vez de navegar a la misma", () => {
      const assign = vi.fn();
      const reload = vi.fn();
      vi.stubGlobal("location", { href: "/?red=prueba#sortear", assign, reload, hostname: "localhost", search: "?red=prueba", pathname: "/" });
      expect(changeMode("testnet")).toBe(true);
      expect(reload).toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBe("prueba");
    });

    it("si la recarga no se puede pedir, no deja el cambio pendiente", () => {
      const assign = vi.fn(() => {
        throw new Error("sin navegación");
      });
      const reload = vi.fn();
      vi.stubGlobal("location", { href: "/#sortear", assign, reload, hostname: "localhost", search: "", pathname: "/" });
      expect(changeMode("testnet")).toBe(false);
      expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

    it.runIf(!hayModoOficial)("a Oficial no hay a dónde pasar mientras no haya contrato: no toca nada", () => {
      const assign = vi.fn();
      const reload = vi.fn();
      vi.stubGlobal("location", { href: "/#sortear", assign, reload, hostname: "localhost", search: "", pathname: "/" });
      expect(hayModoOficial).toBe(false);
      expect(changeMode("mainnet")).toBe(false);
      expect(assign).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
    });
  });
});

/** Una entrada de mainnet inventada, con la forma de la real. La dirección son 32 bytes en cero: nunca un contrato real. */
const ENTRADA_SIMULADA = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  deployedAt: "2026-01-01",
  wasmSha256: "0".repeat(64),
  maxWinners: 300,
  rpcUrl: "https://mainnet.sorobanrpc.com",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  anteriores: [],
};

// Corre siempre, con o sin contrato en la lista real: el caso con Oficial no espera al día del despliegue para probarse.
describe("con una lista que trae contrato en mainnet (simulada)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.doUnmock("./deployments.json");
    vi.resetModules();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  /** `./config` cargado de nuevo, con la entrada simulada en la lista y esta dirección. */
  const cargar = async (search: string) => {
    const assign = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal("location", { href: `/${search}#sortear`, assign, reload, hostname: "localhost", search, pathname: "/" });
    vi.resetModules();
    vi.doMock("./deployments.json", () => ({ default: { ...deployments, mainnet: ENTRADA_SIMULADA } }));
    return { config: await import("./config"), assign, reload };
  };

  it("Oficial existe, el sitio sigue abriendo en Prueba y changeMode a Oficial navega con red=oficial", async () => {
    const { config, assign, reload } = await cargar("");
    expect(config.hayModoOficial).toBe(true);
    expect(config.network.name).toBe("testnet");
    expect(config.network.contractId).toBe(deployments.testnet.contractId);
    expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
    expect(config.changeMode("mainnet")).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0]?.[0] as string).toContain("red=oficial");
    expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBe("oficial");
  });

  it("con ?red=oficial abre en Oficial, con el contrato de la entrada, y lo guarda para la pestaña", async () => {
    const { config } = await cargar("?red=oficial");
    expect(config.network.name).toBe("mainnet");
    expect(config.network.contractId).toBe(ENTRADA_SIMULADA.contractId);
    expect(sessionStorage.getItem(MODE_STORAGE_KEY)).toBe("oficial");
  });
});
