import { describe, expect, it } from "vitest";
import { aJson, medidasVacias, VERSION_DEL_KIT } from "./medidas";
import { RED_DE_PRUEBA } from "./red";

describe("las medidas", () => {
  it("el archivo dice que son cifras de la red de prueba y que no se proyectan", () => {
    const m = medidasVacias(new Date("2026-11-25T12:00:00Z"));
    expect(m.aviso).toContain("red de prueba");
    expect(m.red).toBe("testnet");
    expect(m.kit).toBe(VERSION_DEL_KIT);
    expect(m.inclusionFijada).toBe(100);
    expect(m.ttlMinimoPersistente).toBe(120_960);
    expect(m.inicio).toBe("2026-11-25T12:00:00.000Z");
  });

  it("la versión 2 suma el contrato de las monedas y los pasos de recibir y mandar, vacíos al empezar", () => {
    const m = medidasVacias();
    expect(m.version).toBe(2);
    expect(m.activo).toBe(RED_DE_PRUEBA.activo);
    expect(m.premio).toBeNull();
    expect(m.envios).toEqual([]);
    expect(m.destinoDePrueba).toBeNull();
  });

  it("el JSON escribe los enteros grandes como texto y se lee de vuelta", () => {
    const m = medidasVacias();
    const j = aJson({ ...m, fallas: [{ paso: "sellar", motivo: "cancelada", conFoco: true, detalle: 5n as unknown as string }] });
    const leido = JSON.parse(j) as { fallas: Array<{ detalle: string }>; version: number };
    expect(leido.version).toBe(2);
    expect(leido.fallas[0]?.detalle).toBe("5");
  });
});
