import { afterEach, describe, expect, it } from "vitest";
import { FINAL_BASE, PERFIL_BASE, problemasDeCandidata } from "./carrera";
import { avisarJuego, bomboYBajoChico, eleccionDe, festejoPropio, finalPropio, golpePropio, hayCandidatas, pedidoDeLaDireccion, perfilDeMusica, reiniciarPedido } from "./carrera-eleccion";
import { BOMBO_Y_BAJO, ELEGIDAS } from "./carrera-elegidas";

afterEach(() => {
  avisarJuego(null);
  reiniciarPedido(null);
});

describe("qué suena en la carrera", () => {
  it("hoy no se eligió nada: todo es 'hoy' y el sitio suena como antes", () => {
    for (const e of Object.values(ELEGIDAS)) expect(e).toBe("hoy");
    avisarJuego("race");
    reiniciarPedido({});
    expect(perfilDeMusica()).toBeNull();
    expect(golpePropio()).toBe(false);
    expect(festejoPropio()).toBe(false);
    expect(finalPropio()).toBe(false);
    expect(hayCandidatas()).toBe(false);
    // Tampoco se eligió la mezcla del bombo y del bajo para parlante chico: solo suena con las candidatas.
    expect(BOMBO_Y_BAJO).toBe("hoy");
    expect(bomboYBajoChico()).toBe(false);
  });

  it("la mezcla lleva techo solo cuando la carrera suena con alguna candidata", () => {
    avisarJuego("race");
    reiniciarPedido({ pasos: "c" });
    expect(hayCandidatas()).toBe(true);
    avisarJuego("wheel");
    expect(hayCandidatas()).toBe(false);
  });

  it("'base' solo reemplaza un sonido en la música y en el final: en otra pieza no prende el techo de la mezcla", () => {
    avisarJuego("race");
    for (const pieza of ["pasos", "echarse", "obstaculos", "festejo"] as const) {
      reiniciarPedido({ [pieza]: "base" });
      expect(eleccionDe(pieza)).toBe("hoy");
      expect(hayCandidatas()).toBe(false);
    }
    reiniciarPedido({ musica: "base" });
    expect(hayCandidatas()).toBe(true);
    reiniciarPedido({ final: "base" });
    expect(hayCandidatas()).toBe(true);
    // Un 'base' perdido en pasos no se suma a nada, pero tampoco le quita su techo a una música que sí lo pide.
    reiniciarPedido({ pasos: "base", musica: "a" });
    expect(hayCandidatas()).toBe(true);
    reiniciarPedido({ pasos: "base", echarse: "hoy" });
    expect(hayCandidatas()).toBe(false);
  });

  it("los otros juegos nunca usan las candidatas, aunque se pidan", () => {
    avisarJuego("wheel");
    reiniciarPedido({ musica: "a", final: "b", festejo: "c" });
    expect(eleccionDe("musica")).toBe("hoy");
    expect(perfilDeMusica()).toBeNull();
    expect(golpePropio()).toBe(false);
  });

  it("la dirección pide candidatas solo si trae ?auditar", () => {
    expect(pedidoDeLaDireccion("?sonido=pasos:b,musica:a")).toEqual({});
    expect(pedidoDeLaDireccion("?auditar=sonido&sonido=pasos:b,musica:a")).toEqual({ pasos: "b", musica: "a" });
    expect(pedidoDeLaDireccion("?auditar=mezcla&sonido=final:base,echarse:z,otra:a,festejo:hoy")).toEqual({ final: "base", festejo: "hoy" });
    expect(pedidoDeLaDireccion("")).toEqual({});
  });

  it("con una candidata pedida suena esa, y el golpe y el festejo son propios solo con una candidata", () => {
    avisarJuego("race");
    reiniciarPedido({ musica: "b", final: "a", festejo: "hoy" });
    expect(eleccionDe("musica")).toBe("b");
    expect(perfilDeMusica()?.zamponaDesde).toBe(0.2);
    expect(golpePropio()).toBe(true);
    expect(festejoPropio()).toBe(false);
    expect(finalPropio()).toBe(true);
    reiniciarPedido({ musica: "base", final: "base" });
    expect(perfilDeMusica()).toBe(PERFIL_BASE);
    expect(golpePropio()).toBe(true);
    expect(festejoPropio()).toBe(false);
  });

  it("'ninguno' en el final trae el silencio y el golpe de hoy con el arreglo del parlante, y cumple lo mismo que las candidatas", () => {
    expect(problemasDeCandidata(FINAL_BASE)).toEqual([]);
    const golpe = (FINAL_BASE.variantes[0] ?? []).filter((g) => g.ev === "golpe");
    expect(golpe.some((g) => g.k === "bombo")).toBe(true);
    expect(golpe.some((g) => g.k === "kick")).toBe(true);
    expect(golpe.some((g) => g.k === "crash")).toBe(true);
    // El cuerpo grave del golpe de hoy sube una octava: 130 Hz no sale por un proyector.
    for (const g of golpe) if (g.k === "nota") expect(g.grado).toBeGreaterThanOrEqual(5);
  });
});
