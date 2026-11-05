import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOLGURA_3D } from "./ganador-altura";

// The 3D clearance converges on the 4 px margin from below: the matrix measured 3.97–3.9998 px
// in Piñata and Race 3D because perspective is not linear. The 3D callers ask for 1 px of slack;
// the 2D callers keep the exact 4 px margin they had.
const src = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

describe("3D clearance slack", () => {
  it("is one pixel", () => {
    expect(HOLGURA_3D).toBe(1);
  });

  it("widens both margins of the band, and defaults to none", () => {
    const stage = src("./stage.ts");
    expect(stage).toMatch(/despejarGanador\(cuerpo: \{ x: number; y: number; w: number; h: number \}, holgura\?: number\): number;/);
    expect(stage).toMatch(/despejarGanador\(cuerpo, holgura = 0\) \{/);
    expect(stage).toMatch(/fondo\.y \+ fondo\.h \+ 4 \+ holgura/);
    expect(stage).toMatch(/relator\.top - r\.top - 4 - holgura - reservaPop/);
  });

  it("is asked by the three 3D callers only", () => {
    expect(src("./sapo.ts")).toMatch(/S\.despejarGanador\(caja, HOLGURA_3D\);/);
    expect(src("./sapo.ts")).toMatch(/if \(!v3\) S\.despejarGanador\(cuerpo\);/);
    expect(src("../llamas/carrera.ts")).toMatch(/despejar: \(c\) => S\.despejarGanador\(c, HOLGURA_3D\),/);
    expect(src("../llamas/carrera.ts")).toMatch(/if \(el\) S\.despejarGanador\(cajaVisible\(el\)\);/);
    expect(src("./pinata.ts")).toMatch(/S\.despejarGanador\(v3\.cajaParaDespejar\(e\) \?\? caja2D\(\), HOLGURA_3D\);/);
    expect(src("./pinata.ts")).toMatch(/if \(!despejaEl3D\(\)\) S\.despejarGanador\(caja2D\(\)\);/);
    expect(src("./wheel.ts")).toMatch(/S\.despejarGanador\(selectedBody\(false\)\);/);
  });
});
