import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionKind, loadSessionKind, pickRestore, saveSessionKind } from "./session-store";

function fakeStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage & { data: Map<string, string> };
}

const throwing = (): Storage => {
  const boom = (): never => {
    throw new Error("blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom } as unknown as Storage;
};

afterEach(() => vi.unstubAllGlobals());

describe("session store", () => {
  it("round-trips each kind", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (const k of ["guest", "freighter", "google"] as const) {
      saveSessionKind(k, "testnet");
      expect(loadSessionKind("testnet")).toBe(k);
    }
  });

  it("returns null when nothing is stored", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadSessionKind("testnet")).toBeNull();
  });

  it("isolates networks", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveSessionKind("guest", "testnet");
    expect(loadSessionKind("mainnet")).toBeNull();
    saveSessionKind("freighter", "mainnet");
    expect(loadSessionKind("testnet")).toBe("guest");
    clearSessionKind("testnet");
    expect(loadSessionKind("mainnet")).toBe("freighter");
  });

  it("treats garbage as null", () => {
    const s = fakeStorage();
    vi.stubGlobal("localStorage", s);
    saveSessionKind("guest", "testnet");
    const key = [...s.data.keys()][0]!;
    for (const bad of ["", "admin", "{}", "GUEST", "__proto__"]) {
      s.data.set(key, bad);
      expect(loadSessionKind("testnet")).toBeNull();
    }
  });

  it("never throws with blocked storage", () => {
    vi.stubGlobal("localStorage", throwing());
    expect(() => saveSessionKind("guest", "testnet")).not.toThrow();
    expect(loadSessionKind("testnet")).toBeNull();
    expect(() => clearSessionKind("testnet")).not.toThrow();
  });

  it("never throws without localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveSessionKind("guest", "testnet")).not.toThrow();
    expect(loadSessionKind("testnet")).toBeNull();
  });

  it("clear removes it", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveSessionKind("google", "testnet");
    clearSessionKind("testnet");
    expect(loadSessionKind("testnet")).toBeNull();
  });
});

describe("pickRestore", () => {
  const base = { guestStored: true, guestAvailable: true, freighterAllowed: true };

  it("restores guest only when stored and available", () => {
    expect(pickRestore({ ...base, kind: "guest" })).toBe("guest");
    expect(pickRestore({ ...base, kind: "guest", guestStored: false })).toBeNull();
    expect(pickRestore({ ...base, kind: "guest", guestAvailable: false })).toBeNull();
  });

  it("restores freighter only when already allowed (no permission popup)", () => {
    expect(pickRestore({ ...base, kind: "freighter" })).toBe("freighter");
    expect(pickRestore({ ...base, kind: "freighter", freighterAllowed: false })).toBeNull();
  });

  it("hands google to the pollar path", () => {
    expect(pickRestore({ kind: "google", guestStored: false, guestAvailable: false, freighterAllowed: false })).toBe("google");
  });

  it("returns null without a saved kind", () => {
    expect(pickRestore({ ...base, kind: null })).toBeNull();
  });
});
