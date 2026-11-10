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

  it("con la lista real de hoy el sitio es el de siempre: Prueba y nada nuevo a la vista", () => {
    expect((deployments as { mainnet: unknown }).mainnet).toBeNull();
    expect(hayModoOficial).toBe(false);
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

    it("a Oficial no hay a dónde pasar mientras no haya contrato: no toca nada", () => {
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
