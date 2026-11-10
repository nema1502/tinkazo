import { describe, expect, it } from "vitest";
import { diagnosticoDeArranque, filaDelCaso, motorDeLaFila, pide3D } from "./medir-3d-motor.mjs";

describe("qué motor se pidió", () => {
  it("sin --motor o con 3d se pide el 3D; pixi, clasico y 2d son el 2D", () => {
    expect(pide3D("")).toBe(true);
    expect(pide3D(undefined)).toBe(true);
    expect(pide3D("3d")).toBe(true);
    for (const m of ["pixi", "clasico", "2d"]) expect(pide3D(m)).toBe(false);
  });
});

describe("la fila vale solo si dibujó el motor pedido", () => {
  it("pidió el 3D y hubo 3D al abrir y al terminar: vale", () => {
    expect(motorDeLaFila({ motor: "", inicio3D: true, fin3D: true })).toEqual({ ok: true, motivo: "" });
  });

  it("el caso del 6 de noviembre: pidió el 3D por defecto y midió el 2D: no vale, y lo dice", () => {
    const r = motorDeLaFila({ motor: "", inicio3D: false, fin3D: false });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/3D y la página dibujó en 2D/);
  });

  it("pidió el 2D y hubo 3D: tampoco vale", () => {
    const r = motorDeLaFila({ motor: "pixi", inicio3D: true, fin3D: true });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/2D y la página dibujó en 3D/);
    expect(motorDeLaFila({ motor: "pixi", inicio3D: false, fin3D: false }).ok).toBe(true);
  });

  it("si el motor cambió a mitad de la medida, mezcla dos motores y no vale", () => {
    expect(motorDeLaFila({ motor: "3d", inicio3D: true, fin3D: false }).motivo).toMatch(/ya no estaba/);
    expect(motorDeLaFila({ motor: "3d", inicio3D: false, fin3D: true }).motivo).toMatch(/apareció después/);
  });
});

describe("la pista de por qué cayó al 2D", () => {
  it("una conexión que no es 4g es la primera pista", () => {
    expect(diagnosticoDeArranque({ conexiones: ["4g/100/1.5", "3g/400/0.7"] })).toMatch(/3g/);
  });

  it("sin WebGL y los avisos de la consola, tal cual", () => {
    const d = diagnosticoDeArranque({ webgl: false, avisos: ["warning: [3d] no arrancó, sigue el 2D Error: x"] });
    expect(d).toMatch(/sin WebGL/);
    expect(d).toMatch(/\[3d\] no arrancó/);
  });

  it("si no hay ninguna pista, dice que no la hubo y qué lienzos había", () => {
    expect(diagnosticoDeArranque({ conexiones: ["4g/100/1.5"], lienzos: ["wheel", "pixi-canvas"] })).toMatch(/sin avisos.*wheel, pixi-canvas/);
  });
});

describe("la fila del caso", () => {
  const corrida = (valida, fps, motivo = "") => ({ valida, motivo, fila: { juego: "race", fps, pasa: fps >= 30 } });

  it("vale la mejor de las corridas válidas, y cuenta las descartadas", () => {
    const f = filaDelCaso([corrida(false, 70, "2D"), corrida(true, 31), corrida(true, 44)]);
    expect(f.fps).toBe(44);
    expect(f.intentos).toBe(3);
    expect(f.descartadas).toBe(1);
    expect(f.error).toBeUndefined();
  });

  it("si ninguna fue del motor pedido, la fila no pasa, trae el error y no usa los cuadros del otro motor", () => {
    const f = filaDelCaso([corrida(false, 61, "se pidió el 3D y la página dibujó en 2D"), corrida(false, 73, "se pidió el 3D y la página dibujó en 2D")]);
    expect(f.pasa).toBe(false);
    expect(f.error).toMatch(/no se pudo medir el motor pedido en 2 intento/);
    expect(f.error).toMatch(/dibujó en 2D/);
    expect(f.descartadas).toBe(2);
    expect(f.fps).toBeUndefined();
  });
});
