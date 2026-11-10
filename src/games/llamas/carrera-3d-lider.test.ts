import { Color, Group, MeshLambertMaterial, Scene } from "three";
import { describe, expect, it } from "vitest";
import { MODO_LIDER_BASE, MODOS_LIDER, crearLider3D, modoLider } from "./carrera-3d-lider";
import type { Entrada3D } from "./carrera-3d-mapa";

describe("la marca de quien va adelante en el 3D", () => {
  it("sin pedirla, o con algo que no existe, es el aro dorado", () => {
    expect(MODO_LIDER_BASE).toBe("aro");
    expect(modoLider("")).toBe("aro");
    expect(modoLider("?motor=3d")).toBe("aro");
    expect(modoLider("?lider=cohete")).toBe("aro");
  });

  it("cada una de las marcas se pide con ?lider=", () => {
    for (const m of MODOS_LIDER) expect(modoLider(`?demo=race&motor=3d&lider=${m}`)).toBe(m);
  });

  it("al cambiar de dueña el aro no salta: mientras la borla vuela sigue su punto, y al aterrizar se queda en la llama de su dueña", () => {
    const llama = new Group();
    llama.position.set(500, 0, 300);
    llama.scale.setScalar(0.02);
    const mat = new MeshLambertMaterial();
    const lider = crearLider3D("aro", {
      escena: new Scene(),
      basura: { add: (x) => x },
      duenia: () => ({ raiz: llama, mantaMat: mat, mantaBase: new Color() }),
      tinta: mat,
    });
    const s = 1;
    const entrada = (vuela: boolean, x: number): Entrada3D => ({
      t: 10, w: 1280, h: 720, u: 1, cam: { x: 0, y: 0, zoom: 1, rot: 0 }, gente: [], campeona: 0, corona: -5, efectos: [], horas: [],
      borla: { x, pie: 200, alto: 50, radio: 10, duenia: 3, vuela },
    });
    // Volando: el aro va donde va la borla (de 100 a 400 en x), no donde está la llama de su dueña.
    const xs: number[] = [];
    for (const x of [100, 200, 300, 400]) {
      lider.frame(entrada(true, x), s);
      xs.push((lider.centro?.() as { x: number }).x);
    }
    for (let i = 1; i < xs.length; i++) expect((xs[i] as number) - (xs[i - 1] as number)).toBeCloseTo(100, 6);
    expect(xs[0]).toBeLessThan(llama.position.x);
    // Aterrizó: va en la llama de su dueña.
    lider.frame(entrada(false, 400), s);
    expect((lider.centro?.() as { x: number; z: number }).z).toBeCloseTo(llama.position.z, 6);
    lider.destruir();
  });
});
