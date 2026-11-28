import { afterEach, describe, expect, it, vi } from "vitest";

describe("Buffer global para el kit", () => {
  const original = globalThis.Buffer;
  afterEach(() => {
    globalThis.Buffer = original;
    vi.resetModules();
  });

  it("si el entorno no trae Buffer, el módulo lo pone", async () => {
    // @ts-expect-error se borra a propósito para ver que el módulo lo repone
    delete globalThis.Buffer;
    expect(typeof globalThis.Buffer).toBe("undefined");
    vi.resetModules();
    await import("./buffer-global");
    expect(typeof globalThis.Buffer).toBe("function");
    expect(globalThis.Buffer.from("hola").toString("hex")).toBe("686f6c61");
  });

  it("si ya trae uno, no lo pisa", async () => {
    vi.resetModules();
    await import("./buffer-global");
    expect(globalThis.Buffer).toBe(original);
  });
});
