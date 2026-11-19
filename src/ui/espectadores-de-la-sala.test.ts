// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIVE_MS, anotarCambio, anotarQrMostrado, cambioConQr, claveDelSello, delSello, hayEspectadores, olvidarEspectadores, publicado } from "./espectadores-de-la-sala";

/**
 * Lo que la sala recuerda de los QR de espectadores que mostró (`espectadores-de-la-sala.ts`): por sello, los enlaces
 * que llegaron a verse, con lo que hace falta para reescribirlos, el juego y la duración que llevan, y si se cambiaron
 * después de mostrarlos. Sobrevive a una recarga de la página.
 */

const SELLO = { raffleId: 1055n };
const ENLACE = { id: "Ab12Cd34", clave: "k".repeat(22), permiso: "p", cambia: true, version: "1", largo: 512, n: 1 };

beforeEach(() => {
  localStorage.clear();
  olvidarEspectadores();
});

describe("los espectadores de la sala", () => {
  it("la clave es la red, el contrato y el número del sorteo; sin sello en Stellar, no hay", () => {
    expect(claveDelSello(SELLO, "testnet", "CXYZ")).toBe("testnet:CXYZ:1055");
    expect(claveDelSello({}, "testnet", "CXYZ")).toBeNull();
    expect(claveDelSello(SELLO, "testnet", null)).toBeNull();
  });

  it("anota el QR mostrado con su juego y su duración, y lo recuerda tras recargar", () => {
    expect(hayEspectadores(SELLO, "testnet", "CXYZ")).toBe(false);
    anotarQrMostrado(SELLO, "race", "normal", ENLACE, "testnet", "CXYZ");
    expect(hayEspectadores(SELLO, "testnet", "CXYZ")).toBe(true);
    olvidarEspectadores({ soloMemoria: true });
    const d = delSello(SELLO, "testnet", "CXYZ");
    expect(d?.juego).toBe("race");
    expect(d?.ritmo).toBe("normal");
    expect(d?.enlaces).toEqual([ENLACE]);
    expect(publicado(SELLO, "testnet", "CXYZ")).toEqual({ juego: "race", ritmo: "normal" });
  });

  it("un cambio de juego o de duración después del QR se anota y no se olvida al volver al de antes", () => {
    anotarQrMostrado(SELLO, "race", "normal", ENLACE, "testnet", "CXYZ");
    expect(anotarCambio(SELLO, "race", "normal", "testnet", "CXYZ")).toBe(false);
    expect(cambioConQr(SELLO, "testnet", "CXYZ")).toBe(false);
    expect(anotarCambio(SELLO, "sapo", "normal", "testnet", "CXYZ")).toBe(true);
    expect(cambioConQr(SELLO, "testnet", "CXYZ")).toBe(true);
    anotarCambio(SELLO, "race", "normal", "testnet", "CXYZ");
    expect(cambioConQr(SELLO, "testnet", "CXYZ")).toBe(true);
    expect(anotarCambio(SELLO, "race", "rapido", "testnet", "CXYZ")).toBe(true);
  });

  it("un cambio antes de mostrar ningún QR no cuenta", () => {
    expect(anotarCambio(SELLO, "sapo", "normal", "testnet", "CXYZ")).toBe(false);
    expect(cambioConQr(SELLO, "testnet", "CXYZ")).toBe(false);
  });

  it("lo de más de un día se olvida", () => {
    vi.useFakeTimers();
    anotarQrMostrado(SELLO, "race", "normal", ENLACE, "testnet", "CXYZ");
    vi.setSystemTime(Date.now() + VIVE_MS + 1_000);
    anotarQrMostrado({ raffleId: 2n }, "sapo", "normal", { ...ENLACE, id: "Zz99Yy88" }, "testnet", "CXYZ");
    olvidarEspectadores({ soloMemoria: true });
    expect(hayEspectadores(SELLO, "testnet", "CXYZ")).toBe(false);
    expect(hayEspectadores({ raffleId: 2n }, "testnet", "CXYZ")).toBe(true);
    vi.useRealTimers();
  });

  it("sin almacenamiento se recuerda en la memoria de la página", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("lleno");
    });
    anotarQrMostrado(SELLO, "race", "normal", ENLACE, "testnet", "CXYZ");
    expect(hayEspectadores(SELLO, "testnet", "CXYZ")).toBe(true);
    set.mockRestore();
  });
});
