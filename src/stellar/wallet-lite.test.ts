import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `fundWithFriendbot` es lo único que de verdad regala XLM. Se prueba con el
 * módulo cargado como una página nueva: la dirección y la pestaña deciden si el
 * grifo está apagado (`?grifo=0`), y eso se lee una sola vez, al cargar.
 */
const DIR = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const FB = "https://friendbot.stellar.org";

function pestana(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v), removeItem: (k: string) => void datos.delete(k) };
}

async function cargar(search: string, red: "testnet" | "mainnet" = "testnet", almacen = pestana()) {
  vi.resetModules();
  vi.stubGlobal("location", { search });
  vi.stubGlobal("sessionStorage", almacen);
  vi.doMock("./config", async (orig) => {
    const real = await orig<typeof import("./config")>();
    return { ...real, network: { ...real.network, name: red, friendbotUrl: red === "testnet" ? FB : null } };
  });
  return import("./wallet-lite");
}

let fetchFalso: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchFalso = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("./config");
});

describe("fundWithFriendbot", () => {
  it("con el grifo prendido pide los fondos a la dirección del grifo", async () => {
    const w = await cargar("");
    await w.fundWithFriendbot(DIR);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso).toHaveBeenCalledWith(`${FB}/?addr=${DIR}`);
  });

  it("?grifo=0: no hace nada y no llama a la red", async () => {
    const w = await cargar("?grifo=0");
    await expect(w.fundWithFriendbot(DIR)).resolves.toBeUndefined();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("?grifo=0 recordado en la pestaña (se navegó o se volvió de Google): sigue sin llamar a la red", async () => {
    const w = await cargar("", "testnet", pestana({ "tinkazo.grifo": "0" }));
    await w.fundWithFriendbot(DIR);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("?grifo=1 lo prende de nuevo", async () => {
    const w = await cargar("?grifo=1", "testnet", pestana({ "tinkazo.grifo": "0" }));
    await w.fundWithFriendbot(DIR);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("en mainnet no hay grifo, con o sin parámetro", async () => {
    for (const search of ["", "?grifo=0", "?grifo=1"]) {
      const w = await cargar(search, "mainnet");
      await w.fundWithFriendbot(DIR);
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("un 400 es 'la cuenta ya existe': no es un error", async () => {
    fetchFalso.mockResolvedValue({ ok: false, status: 400 });
    const w = await cargar("");
    await expect(w.fundWithFriendbot(DIR)).resolves.toBeUndefined();
  });

  it("un 500 o un corte de red sí lo son", async () => {
    const w = await cargar("");
    fetchFalso.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(w.fundWithFriendbot(DIR)).rejects.toThrow("friendbot-failed");
    fetchFalso.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(w.fundWithFriendbot(DIR)).rejects.toThrow("friendbot-failed");
  });
});
