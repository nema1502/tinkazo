import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RPC_LISTAS } from "./config";

/**
 * El auditor de flujo corta los RPC de testnet para simular el costo. El sitio cambia al segundo RPC cuando el primero
 * tarda más de 4 s, así que si el auditor no corta todos los de la lista, el segundo contesta lo de verdad y el aviso de
 * costo alto no sale (pasó el 4 de noviembre de 2026). Esta prueba amarra la lista del auditor a la del sitio.
 */
describe("el auditor de flujo y los RPC de testnet", () => {
  const fuente = readFileSync(new URL("../../scripts/audit-flujo.mjs", import.meta.url), "utf8");
  const lista = /const RPC_DE_TESTNET = \[([^\]]*)\]/.exec(fuente)?.[1] ?? "";

  it("corta cada RPC de la lista del sitio", () => {
    expect(lista).not.toBe("");
    for (const url of RPC_LISTAS.testnet) expect(lista).toContain(new URL(url).hostname);
  });

  it("los dos casos de costo alto usan esa lista", () => {
    expect(fuente.match(/interceptar\(p, RPC_DE_TESTNET,/g)?.length).toBe(2);
  });
});
