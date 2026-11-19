// Prueba la sugerencia de scripts/check-renta.mjs (scripts/lib/renta.mjs): con alarma tiene que
// decir cómo extender las dos entradas del contrato, la instancia y el código. Sin red.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { LEDGERS_A_EXTENDER, hashDelCodigo, sugerenciasDeExtension } from "./renta.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const CONTRATO = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const HASH = "ab".repeat(32);

describe("sugerenciasDeExtension", () => {
  it("da dos órdenes: la instancia por --id y el código por --wasm-hash", () => {
    const ordenes = sugerenciasDeExtension({ red: "mainnet", contrato: CONTRATO, wasmHashHex: HASH });
    expect(ordenes).toHaveLength(2);
    expect(ordenes[0]).toBe(
      `stellar contract extend --id ${CONTRATO} --ledgers-to-extend 2073600` +
        " --durability persistent --source <cuenta> --network mainnet",
    );
    expect(ordenes[1]).toBe(
      `stellar contract extend --wasm-hash ${HASH} --ledgers-to-extend 2073600` +
        " --durability persistent --source <cuenta> --network mainnet",
    );
  });

  it("las dos extienden lo mismo, en la misma red y con la misma cuenta", () => {
    const [instancia, codigo] = sugerenciasDeExtension({ red: "testnet", contrato: CONTRATO, wasmHashHex: HASH, cuenta: "tinkazo-deployer" });
    const cola = (o) => o.slice(o.indexOf(" --ledgers-to-extend"));
    expect(cola(instancia)).toBe(cola(codigo));
    expect(instancia).toContain("--source tinkazo-deployer --network testnet");
    expect(LEDGERS_A_EXTENDER).toBe(2_073_600);
  });

  it("lo que no se sabe queda para completar a mano, sin perder la orden del código", () => {
    const ordenes = sugerenciasDeExtension({ red: "testnet", contrato: CONTRATO });
    expect(ordenes).toHaveLength(2);
    expect(ordenes[1]).toContain("--wasm-hash <hash del código>");
    expect(sugerenciasDeExtension()[0]).toContain("--id <contrato>");
  });
});

describe("el hash del código", () => {
  it("sale en hexadecimal de un ContractExecutable de verdad del SDK", () => {
    const ejecutable = xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 0xab));
    expect(hashDelCodigo(ejecutable)).toBe("ab".repeat(32));
    // Y del que vuelve de la red, que llega como XDR.
    expect(hashDelCodigo(xdr.ContractExecutable.fromXdr(ejecutable.toXdr()))).toBe("ab".repeat(32));
  });

  it("un ejecutable sin .wasm da null", () => {
    expect(hashDelCodigo(xdr.ContractExecutable.contractExecutableStellarAsset())).toBeNull();
    expect(hashDelCodigo(undefined)).toBeNull();
  });

  it("una forma rara lanza y dice cuál llegó, en vez de dar un hash falso", () => {
    expect(() => hashDelCodigo({ wasmHash: "ab".repeat(32) })).toThrow(/forma inesperada \(string\)/);
    expect(() => hashDelCodigo({ wasmHash: {} })).toThrow(/forma inesperada/);
    expect(() => hashDelCodigo({ wasmHash: Buffer.alloc(31, 1) })).toThrow(/forma inesperada \(Buffer de 31 bytes\)/);
    expect(hashDelCodigo({ wasmHash: Buffer.alloc(32, 0xab) })).toBe("ab".repeat(32));
  });
});

describe("check-renta.mjs usa las dos órdenes", () => {
  const guion = readFileSync(resolve(aqui, "..", "check-renta.mjs"), "utf8");

  it("importa la sugerencia y ya no escribe una sola orden a mano", () => {
    expect(guion).toMatch(/import\s*\{[^}]*sugerenciasDeExtension[^}]*\}\s*from\s*"\.\/lib\/renta\.mjs"/);
    expect(guion).not.toContain("extend --id <contrato>");
  });

  it("le pasa el hash del código leído de la red", () => {
    expect(guion).toMatch(/sugerenciasDeExtension\(\{[^}]*wasmHashHex/);
    expect(guion).toMatch(/wasmHashHex = hashDelCodigo\(ejecutable\)/);
  });
});
