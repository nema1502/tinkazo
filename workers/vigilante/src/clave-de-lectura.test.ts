// Qué clave viaja al portero (issue 219): con la de solo lectura cargada es la que abre /estado y la de operar no sale
// del vigilante; sin ella, la de operar de siempre. Y qué pasa si el portero todavía no conoce la de lectura: la vuelta
// lo dice con palabras que mandan al orden de carga, y se arregla borrando la de lectura. Los valores son de prueba.
import { describe, expect, it } from "vitest";
import { CLAVE_DE_OPERAR, mundoFalso } from "./mundo-falso";

const LECTURA = "clave-de-lectura-inventada-fedcba9876543210";

describe("la clave que viaja al portero", () => {
  it("con la de solo lectura cargada, viaja esa y la de operar no sale del vigilante", async () => {
    const m = mundoFalso({ env: { PORTERO_TOKEN_LECTURA: LECTURA } });
    await m.vuelta();
    expect(m.portero.llamadas.length).toBeGreaterThan(0);
    for (const llamada of m.portero.llamadas) {
      expect(llamada.autorizacion).toBe(`Bearer ${LECTURA}`);
      expect(llamada.metodo).toBe("GET");
      expect(llamada.url).toMatch(/\/v1\/patrocinio\/estado$/);
    }
    expect(JSON.stringify(m.portero.llamadas)).not.toContain(CLAVE_DE_OPERAR);
  });

  it("sin la de solo lectura, viaja la de operar como siempre", async () => {
    const m = mundoFalso({ env: { PORTERO_TOKEN_LECTURA: undefined } });
    await m.vuelta();
    expect(m.portero.llamadas.length).toBeGreaterThan(0);
    for (const llamada of m.portero.llamadas) expect(llamada.autorizacion).toBe(`Bearer ${CLAVE_DE_OPERAR}`);
  });

  it("con la de solo lectura en blanco (solo espacios), viaja la de operar", async () => {
    const m = mundoFalso({ env: { PORTERO_TOKEN_LECTURA: "  \n" } });
    await m.vuelta();
    for (const llamada of m.portero.llamadas) expect(llamada.autorizacion).toBe(`Bearer ${CLAVE_DE_OPERAR}`);
  });

  it("la de lectura con espacios o salto de línea al final viaja sin ellos", async () => {
    const m = mundoFalso({ env: { PORTERO_TOKEN_LECTURA: `${LECTURA}\n` } });
    await m.vuelta();
    for (const llamada of m.portero.llamadas) expect(llamada.autorizacion).toBe(`Bearer ${LECTURA}`);
  });
});

describe("la clave de lectura cargada en el vigilante antes que en el portero", () => {
  it("el portero la rechaza (401): avisa que falta la clave, con qué hacer, y no inventa un estado", async () => {
    const m = mundoFalso({ env: { PORTERO_TOKEN_LECTURA: LECTURA } });
    m.portero.falla = 401;
    await m.vuelta();
    expect(m.correo.avisos).toHaveLength(1);
    expect(m.correo.avisos[0]!.subject).toMatch(/falta la clave/i);
    expect(m.correo.avisos[0]!.text).toContain("PORTERO_TOKEN_LECTURA");
    expect(m.correo.avisos[0]!.text).toContain("PORTERO_ADMIN_TOKEN");
    expect(m.correo.avisos[0]!.text).not.toContain(LECTURA);
    expect(m.correo.avisos[0]!.text).not.toContain(CLAVE_DE_OPERAR);
  });

  it("al borrar la de lectura del vigilante vuelve a mirar con la de operar y avisa que se arregló", async () => {
    const m = mundoFalso({ env: { PORTERO_TOKEN_LECTURA: LECTURA } });
    m.portero.falla = 401;
    await m.vuelta();
    m.portero.falla = null;
    m.env.PORTERO_TOKEN_LECTURA = undefined;
    await m.vueltaEn(10);
    expect(m.portero.llamadas.at(-1)!.autorizacion).toBe(`Bearer ${CLAVE_DE_OPERAR}`);
    expect(m.asuntos().some((a) => /^Arreglado: /.test(a))).toBe(true);
  });
});
