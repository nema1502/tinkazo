// Prueba la revisión diaria del portero de mainnet (scripts/lib/vigilar-portero.mjs) con respuestas de `/estado`
// inventadas: ninguna prueba le habla al portero.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MARGEN_MINIMO, MAX_SIN_EXPLICAR, principal, revisarPortero } from "./vigilar-portero.mjs";

/** Un `/estado` del portero de mainnet con todo en orden. */
const bien = (extra = {}) => ({
  modo: "portero",
  red: "mainnet",
  alerta: false,
  balanceStroops: "500000000",
  creditos: 9000,
  piso: 2000,
  margen: 7000,
  firmasSinExplicar: 2,
  firmas: { cobradas: 30, explicadas: 28, sellos: 20, sorteos: 6, activaciones: 2, completo: true, desde: 0 },
  patrocinioPollar: { esperado: true, prendidos: [] },
  ...extra,
});

describe("revisarPortero", () => {
  it("con todo en orden no hay problemas, y el resumen dice las cifras", () => {
    const r = revisarPortero(bien());
    expect(r.problemas).toEqual([]);
    expect(r.resumen).toMatch(/9000/);
    expect(r.resumen).toMatch(/2000/);
  });

  it(`los créditos por debajo del piso más ${MARGEN_MINIMO}: falla; justo en el borde, no`, () => {
    expect(MARGEN_MINIMO).toBe(1000);
    expect(revisarPortero(bien({ creditos: 2999, piso: 2000 })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ creditos: 3000, piso: 2000 })).problemas).toEqual([]);
    // Sin saldo leído (Pollar caído), también: no se sabe.
    expect(revisarPortero(bien({ creditos: null })).problemas).toHaveLength(1);
    expect(revisarPortero(bien({ piso: undefined })).problemas).toHaveLength(1);
  });

  it("la patrocinadora baja o sin leer: falla", () => {
    expect(revisarPortero(bien({ alerta: true, motivoAlerta: "saldo-bajo" })).problemas[0]).toMatch(/saldo-bajo/);
    expect(revisarPortero(bien({ alerta: undefined })).problemas).toHaveLength(1);
  });

  it(`más de ${MAX_SIN_EXPLICAR} firmas sin explicar: falla; sin la vigilancia, también`, () => {
    expect(MAX_SIN_EXPLICAR).toBe(10);
    expect(revisarPortero(bien({ firmasSinExplicar: 10 })).problemas).toEqual([]);
    expect(revisarPortero(bien({ firmasSinExplicar: 11 })).problemas[0]).toMatch(/11/);
    expect(revisarPortero(bien({ firmasSinExplicar: null })).problemas).toHaveLength(1);
  });

  it("el patrocinio de la app prendido, o sin leer: falla y nombra lo prendido", () => {
    expect(revisarPortero(bien({ patrocinioPollar: { esperado: false, prendidos: ["sponsor_trustlines"] } })).problemas[0]).toMatch(/sponsor_trustlines/);
    expect(revisarPortero(bien({ patrocinioPollar: null })).problemas).toHaveLength(1);
  });

  it("si no es el portero de mainnet (o no trae nada de las altas), falla: no se mira el portero equivocado", () => {
    expect(revisarPortero(bien({ red: "testnet" })).problemas.length).toBeGreaterThan(0);
    expect(revisarPortero({ red: "mainnet", alerta: false }).problemas.length).toBeGreaterThanOrEqual(3);
    expect(revisarPortero(null).problemas.length).toBeGreaterThan(0);
  });

  it("con la página de movimientos llena lo avisa en el resumen, sin fallar por eso", () => {
    const r = revisarPortero(bien({ firmas: { ...bien().firmas, completo: false } }));
    expect(r.problemas).toEqual([]);
    expect(r.resumen).toMatch(/puede haber más/);
  });
});

describe("principal: lee el archivo y sale con 1 si hay problemas", () => {
  const dir = mkdtempSync(join(tmpdir(), "tinkazo-vigilar-portero-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const archivo = (nombre, contenido) => {
    const f = join(dir, nombre);
    writeFileSync(f, contenido);
    return f;
  };

  it("bien, 0; con un problema, 1; un archivo que no es JSON o que falta, 1", () => {
    const lineas = [];
    const log = (s) => lineas.push(String(s));
    expect(principal([archivo("bien.json", JSON.stringify(bien()))], { log })).toBe(0);
    expect(principal([archivo("mal.json", JSON.stringify(bien({ firmasSinExplicar: 40 })))], { log })).toBe(1);
    expect(lineas.join("\n")).toMatch(/40/);
    expect(principal([archivo("roto.json", "no es json")], { log })).toBe(1);
    expect(principal([join(dir, "no-existe.json")], { log })).toBe(1);
    expect(principal([], { log })).toBe(1);
  });
});
