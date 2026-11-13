import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPOS_POR_MINUTO, NOMBRES_POR_MINUTO, VentanaPorMinuto } from "../../workers/sala/src/logica";

/**
 * El tope por minuto de la sala (`workers/sala/src/index.ts`). Los nombres que mandan los celulares y las altas de
 * equipos gastaban el mismo contador: con el id de la sala del QR, 120 nombres por minuto dejaban a todos los equipos en
 * Hay mucha gente anotándose. Ahora cada uno tiene su ventana.
 */

const fuente = readFileSync(join(process.cwd(), "workers", "sala", "src", "index.ts"), "utf8");
/** El cuerpo de un método de la clase `Sala`, hasta la llave que lo cierra con su sangría. */
const metodo = (nombre: string): string => new RegExp(`\\n  async ${nombre}\\([\\s\\S]*?\\r?\\n  \\}\\r?\\n`).exec(fuente)?.[0] ?? "";

describe("los topes por minuto de la sala", () => {
  it("120 nombres en un minuto no frenan un alta de equipo", () => {
    const nombres = new VentanaPorMinuto(NOMBRES_POR_MINUTO);
    const equipos = new VentanaPorMinuto(EQUIPOS_POR_MINUTO);
    const ahora = 1_000_000;
    for (let i = 0; i < NOMBRES_POR_MINUTO; i++) expect(nombres.intentar(ahora)).toBe(true);
    expect(nombres.intentar(ahora)).toBe(false);
    expect(equipos.intentar(ahora)).toBe(true);
  });

  it("los equipos tienen su propio tope, del mismo tamaño que el de los nombres", () => {
    expect(EQUIPOS_POR_MINUTO).toBe(NOMBRES_POR_MINUTO);
  });

  it("la sala usa una ventana para los nombres y otra para los equipos", () => {
    const sumar = metodo("sumar");
    const anotar = metodo("anotarEquipo");
    expect(sumar).not.toBe("");
    expect(anotar).not.toBe("");
    expect(sumar).toMatch(/this\.porMinuto\.intentar\(/);
    expect(anotar).toMatch(/this\.equiposPorMinuto\.intentar\(/);
    expect(anotar).not.toMatch(/this\.porMinuto\./);
    expect(fuente).toMatch(/private equiposPorMinuto = new VentanaPorMinuto\(EQUIPOS_POR_MINUTO\);/);
  });
});
