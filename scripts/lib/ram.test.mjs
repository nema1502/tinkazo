import { describe, expect, it } from "vitest";
import { esperarRam } from "./ram.mjs";

const GB = 1024 ** 3;

describe("esperar la memoria libre", () => {
  it("con memoria de sobra no espera ni imprime", async () => {
    const dicho = [];
    const r = await esperarRam({ minimo: 1.2, libre: () => 2 * GB, decir: (x) => dicho.push(x), dormir: async () => {} });
    expect(r).toMatchObject({ esperadoMs: 0, alcanzo: true });
    expect(dicho).toEqual([]);
  });

  it("espera de a tandas imprimiendo lo que hay, hasta que alcanza", async () => {
    const lecturas = [0.5, 0.8, 1.3];
    const dicho = [];
    const r = await esperarRam({ minimo: 1.2, cada: 1000, libre: () => (lecturas.shift() ?? 1.3) * GB, decir: (x) => dicho.push(x), dormir: async () => {} });
    expect(r.alcanzo).toBe(true);
    expect(r.esperadoMs).toBe(2000);
    expect(dicho.filter((x) => /esperando RAM/.test(x))).toHaveLength(2);
    expect(dicho.at(-1)).toMatch(/se abre Chrome/);
  });

  it("pasado el máximo sigue igual y lo dice", async () => {
    const dicho = [];
    const r = await esperarRam({ minimo: 1.2, cada: 1000, maximo: 3000, libre: () => 0.4 * GB, decir: (x) => dicho.push(x), dormir: async () => {} });
    expect(r.alcanzo).toBe(false);
    expect(r.esperadoMs).toBe(3000);
    expect(dicho.at(-1)).toMatch(/igual/);
  });
});
