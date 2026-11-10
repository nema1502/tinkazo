import { describe, expect, it } from "vitest";
import { resumenDeMezcla, resumenDeSonido } from "./carrera-auditar.mjs";

const MEZCLA = `Midiendo la mezcla en http://localhost:4720

race        -28.8 LUFS · pico real -5.9 dBTP · corto máx -25.2 · sin graves de 150 Hz 3.7 LU, de 300 Hz 5.4 LU · golpe 21.7 LU · 63.7 s

race
  ✓ nada recorta · 0 muestras en 1 o más
  ✗ en un parlante que corta en 150 Hz pierde 3.5 LU o menos · 3.7 LU
  ✓ el ganador suena 2 LU más fuerte que lo de antes · 21.7 LU

RECHAZADO: 5/6 comprobaciones`;

describe("el resumen de los auditores", () => {
  it("lee la línea de audit-mezcla y sus fallas", () => {
    const r = resumenDeMezcla(MEZCLA);
    expect(r).toMatchObject({ lufs: -28.8, picoRealDb: -5.9, pierde150: 3.7, pierde300: 5.4, golpe: 21.7, seg: 63.7 });
    expect(r.fallas).toEqual(["en un parlante que corta en 150 Hz pierde 3.5 LU o menos · 3.7 LU"]);
  });

  it("si no puede leer la mezcla, lo dice", () => {
    expect(resumenDeMezcla("race ✗ no sonó nada").fallas.length).toBeGreaterThan(0);
  });

  it("lee audit-sound aprobado y rechazado", () => {
    const ok = resumenDeSonido("\nEscuchando http://x\n\n✓ race       141 notas de efectos (0 de archivo) y 4312 de música en 60.2 s · hueco máximo 2.2 s\n\nAPROBADO: 1/1 juegos\n");
    expect(ok.ok).toBe(true);
    expect(ok.linea).toMatch(/141 notas/);
    const mal = resumenDeSonido("\n✗ race       3 fuera de escala (130 Hz)\n\nRECHAZADO: 0/1 juegos\n");
    expect(mal.ok).toBe(false);
    expect(mal.fallas).toEqual(["3 fuera de escala (130 Hz)"]);
  });
});
