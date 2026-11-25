import { describe, expect, it } from "vitest";
import { decodeProof } from "../protocol/proof";
import { armarComprobante, enlaceDeComprobante } from "./comprobante";
import { RED_DE_PRUEBA } from "./red";

const base = { nombres: ["Ana", "Nora", "Beto"], ronda: 4_000_000, id: 12n, hashSello: "ab".repeat(32), selladoEn: 1_800_000_000 };

describe("el comprobante de la prueba", () => {
  it("es de la red de prueba, con el contrato de la prueba y el número como texto", () => {
    const p = armarComprobante(base);
    expect(p.net).toBe("testnet");
    expect(p.contract).toBe(RED_DE_PRUEBA.contrato);
    expect(p.id).toBe("12");
    expect(p.names).toEqual(["Ana", "Nora", "Beto"]);
    expect(p.stx).toBe("ab".repeat(32));
  });

  it("sin la firma de la ronda no la lleva, y con ella sí", () => {
    expect(armarComprobante(base).signature).toBeUndefined();
    const firma = "cd".repeat(48);
    expect(armarComprobante({ ...base, firma48Hex: firma, hashSorteo: "ef".repeat(32) })).toMatchObject({ signature: firma, dtx: "ef".repeat(32) });
  });

  it("el enlace va a la verificación del mismo sitio y se lee de vuelta", async () => {
    const url = await enlaceDeComprobante(armarComprobante(base), "https://ejemplo.org");
    expect(url.startsWith("https://ejemplo.org/verificar.html#")).toBe(true);
    const leido = await decodeProof(url.split("#")[1] ?? "");
    expect(leido.names).toEqual(base.nombres);
    expect(leido.round).toBe(base.ronda);
    expect(leido.contract).toBe(RED_DE_PRUEBA.contrato);
  });
});
