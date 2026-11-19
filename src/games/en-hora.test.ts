import { afterEach, describe, expect, it } from "vitest";
import { PASO_S, finalSoltado, pasoIntermedio, pedirHorario, ponerseAlDiaAlVolver, relojDelShow, soltarElFinal, tomarHorario } from "./en-hora";

/**
 * El reloj del show con horario (`en-hora.ts`): el juego de la sala y el del celular siguen la hora fija que les dio el
 * ancla, aunque la pantalla dibuje pocos cuadros. Se prueba sin estadio: el juego es una función que suma `dt`.
 */

afterEach(() => {
  pedirHorario(null);
  tomarHorario();
});

/** Un juego de mentira: suma lo que le dan, y anota cada llamada. */
function juego() {
  const llamadas: number[] = [];
  let t = 0;
  return {
    llamadas,
    t: () => t,
    paso: (dt: number) => {
      llamadas.push(dt);
      t += dt;
    },
  };
}

describe("el reloj del show con horario", () => {
  it("a 60 cuadros por segundo da un paso por cuadro, del largo del cuadro", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 1_000 }, { ritmo: 1 });
    for (let i = 0; i <= 60; i++) r.cuadro(1_000 + i * (1000 / 60), j.paso, () => false);
    expect(j.t()).toBeCloseTo(1, 6);
    expect(j.llamadas.filter((d) => d > 0).every((d) => d <= PASO_S + 1e-9)).toBe(true);
  });

  it("a 15 cuadros por segundo no se atrasa: reparte cada cuadro en pasos de 0,05 s", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    for (let i = 0; i <= 150; i++) r.cuadro(i * (1000 / 15), j.paso, () => false);
    // Diez segundos de juego en diez segundos de reloj, no 7,5 como con el tope de 0,05 por cuadro.
    expect(j.t()).toBeCloseTo(10, 4);
    expect(Math.max(...j.llamadas)).toBeLessThanOrEqual(PASO_S + 1e-9);
    expect(r.estado.atraso).toBeLessThan(0.01);
  });

  it("el ritmo estira el juego: con 1,5, un segundo de reloj son 0,667 s de juego", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1.5 });
    for (let i = 0; i <= 60; i++) r.cuadro(i * (1000 / 60), j.paso, () => false);
    expect(j.t()).toBeCloseTo(1 / 1.5, 4);
  });

  it("cuenta desde la hora fijada, no desde el primer cuadro: unas décimas tarde se saltan", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    r.cuadro(400, j.paso, () => false);
    expect(j.t()).toBeCloseTo(0.4, 6);
    expect(r.estado.tardeAlArrancar).toBeCloseTo(0.4, 6);
    expect(r.estado.reanclado).toBe(false);
  });

  it("la sala que arranca más de 1,5 s tarde arranca desde cero y queda marcada", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    r.cuadro(2_000, j.paso, () => false);
    expect(j.t()).toBe(0);
    expect(r.estado.reanclado).toBe(true);
    r.cuadro(2_500, j.paso, () => false);
    expect(j.t()).toBeCloseTo(0.5, 6);
  });

  it("antes de la hora fijada el juego espera quieto y se sigue dibujando", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 1_000 }, { ritmo: 1 });
    r.cuadro(800, j.paso, () => false);
    expect(j.t()).toBe(0);
    expect(j.llamadas).toEqual([0]);
  });

  it("la sala que se esconde se pausa: al volver sigue donde estaba y queda marcada", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    r.cuadro(0, j.paso, () => false);
    r.cuadro(1_000, j.paso, () => false);
    r.esconder(1_000);
    r.mostrar(9_000);
    r.cuadro(9_016, j.paso, () => false);
    expect(j.t()).toBeCloseTo(1.016, 4);
    expect(r.estado.seEscondio).toBe(true);
  });

  it("mientras la sala está escondida queda marcada como oculta, y al volver deja de estarlo", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    r.cuadro(0, j.paso, () => false);
    r.cuadro(1_000, j.paso, () => false);
    expect(r.estado.oculto).toBe(false);
    // Escondida: no corre ningún cuadro, así que el atraso no cambia. Lo que lo dice es esta marca.
    r.esconder(1_000);
    expect(r.estado.oculto).toBe(true);
    expect(r.estado.atraso).toBe(0);
    r.mostrar(9_000);
    expect(r.estado.oculto).toBe(false);
  });

  it("la sala que ya grabó a la par no se pausa al esconderse: al volver se pone al día, callada", () => {
    const j = juego();
    const callado: boolean[] = [];
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1, callar: (c) => callado.push(c) });
    r.cuadro(0, j.paso, () => false);
    r.cuadro(1_000, j.paso, () => false);
    ponerseAlDiaAlVolver();
    r.esconder(1_000);
    r.mostrar(9_000);
    let now = 9_000;
    for (let i = 0; i < 30; i++) r.cuadro((now += 16), j.paso, () => false);
    // Los celulares siguieron a horario mientras estuvo escondida: la sala no puede quedar atrás de ellos.
    expect(j.t()).toBeGreaterThan(now / 1000 - 0.05);
    expect(r.estado.atraso).toBeLessThan(0.05);
    expect(r.estado.seEscondio).toBe(false);
    expect(callado).toContain(true);
    expect(callado.at(-1)).toBe(false);
  });

  it("un show nuevo vuelve a pausarse al esconderse", () => {
    ponerseAlDiaAlVolver();
    pedirHorario(null);
    const j = juego();
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    r.cuadro(0, j.paso, () => false);
    r.cuadro(1_000, j.paso, () => false);
    r.esconder(1_000);
    r.mostrar(9_000);
    r.cuadro(9_016, j.paso, () => false);
    expect(j.t()).toBeCloseTo(1.016, 4);
  });

  it("el celular que se apaga se pone al día al volver, de a varios pasos por cuadro y callado", () => {
    const j = juego();
    const callado: boolean[] = [];
    const r = relojDelShow({ inicio: 0, alcanzar: true }, { ritmo: 1, callar: (c) => callado.push(c) });
    r.cuadro(0, j.paso, () => false);
    r.cuadro(1_000, j.paso, () => false);
    r.esconder(1_000);
    r.mostrar(9_000);
    let now = 9_000;
    for (let i = 0; i < 40 && r.estado.atraso + 9 > 0 && j.t() < 8.99; i++) r.cuadro((now += 16), j.paso, () => false);
    expect(j.t()).toBeGreaterThan(8.9);
    // Mientras se ponía al día, los efectos callados; al llegar, otra vez con sonido.
    expect(callado).toContain(true);
    expect(callado.at(-1)).toBe(false);
  });

  it("retiene en el momento decisivo hasta que se suelta, y sigue desde ahí sin saltar", () => {
    const j = juego();
    let retuvo = 0;
    const r = relojDelShow({ inicio: 0, retener: true }, { ritmo: 1, avisos: { alRetener: () => retuvo++ } });
    const decisivo = (): boolean => j.t() >= 2;
    let now = 0;
    for (let i = 0; i < 300; i++) r.cuadro((now += 1000 / 60), j.paso, decisivo);
    // Cinco segundos de reloj: el juego quedó en el momento decisivo (a lo sumo un paso más).
    expect(j.t()).toBeGreaterThanOrEqual(2);
    expect(j.t()).toBeLessThan(2 + PASO_S + 1e-9);
    expect(retuvo).toBe(1);
    expect(r.estado.retenido).toBe(true);
    soltarElFinal();
    expect(finalSoltado()).toBe(true);
    const antes = j.t();
    r.cuadro((now += 1000 / 60), j.paso, decisivo);
    // Sigue desde donde quedó: un cuadro más de juego, no los tres segundos que estuvo quieto.
    expect(j.t() - antes).toBeLessThan(0.02);
  });

  it("ponerse al día nunca pasa el momento decisivo sin soltar", () => {
    const j = juego();
    const r = relojDelShow({ inicio: 0, alcanzar: true, retener: true }, { ritmo: 1 });
    // El celular abre 20 s tarde y el decisivo es a los 12 s.
    let now = 20_000;
    for (let i = 0; i < 200; i++) r.cuadro((now += 16), j.paso, () => j.t() >= 12);
    expect(j.t()).toBeGreaterThanOrEqual(12);
    expect(j.t()).toBeLessThan(12 + PASO_S + 1e-9);
  });

  it("el 3D dibuja una vez por cuadro: los pasos de en medio no lo dibujan", () => {
    const vistos: boolean[] = [];
    const r = relojDelShow({ inicio: 0 }, { ritmo: 1 });
    r.cuadro(0, () => undefined, () => false);
    r.cuadro(130, () => void vistos.push(pasoIntermedio()), () => false);
    // 130 ms son tres pasos: los dos primeros, de en medio; el último, no.
    expect(vistos).toEqual([true, true, false]);
    expect(pasoIntermedio()).toBe(false);
  });

  it("el horario pedido se toma una sola vez", () => {
    pedirHorario({ inicio: 5 });
    expect(tomarHorario()?.horario.inicio).toBe(5);
    expect(tomarHorario()).toBeNull();
  });
});
