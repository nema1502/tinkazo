import { describe, expect, it } from "vitest";
import { cabe, centrar, crecer, dentro, enPantalla, guardiaNombre, meter, tapada, unir, type Caja, type Zona } from "./encuadre";

/** Una pantalla de celular en vertical, con el cartel arriba y el relator abajo. */
const SW = 390, SH = 844;
const ZONA: Zona = { x0: 11, y0: 277, x1: 379, y1: 715 };

/** ¿La caja, vista así, cae entera adentro de la zona? (con medio píxel de tolerancia) */
const adentro = (c: Caja, z: Zona, v: { x: number; y: number; z: number }): boolean => {
  const p = enPantalla(c, v, SW, SH);
  return p.x >= z.x0 - 0.5 && p.y >= z.y0 - 0.5 && p.x + p.w <= z.x1 + 0.5 && p.y + p.h <= z.y1 + 0.5;
};

describe("encuadre: las cuentas", () => {
  it("unir cubre a todas, y crecer agranda parejo", () => {
    expect(unir([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(unir([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(crecer({ x: 0, y: 0, w: 10, h: 10 }, 2, 3)).toEqual({ x: -2, y: -3, w: 14, h: 16 });
  });

  it("enPantalla pone el centro de la vista en el medio de la pantalla", () => {
    const p = enPantalla({ x: 100, y: 50, w: 10, h: 20 }, { x: 100, y: 50, z: 2 }, SW, SH);
    expect(p).toEqual({ x: SW / 2, y: SH / 2, w: 20, h: 40 });
  });

  it("cabe da el acercamiento más grande con el que la caja entra", () => {
    expect(cabe({ x: 0, y: 0, w: 184, h: 100 }, ZONA)).toBeCloseTo(2, 6);
    expect(cabe({ x: 0, y: 0, w: 10, h: 876 }, ZONA)).toBeCloseTo(0.5, 6);
    expect(cabe({ x: 0, y: 0, w: 0, h: 0 }, ZONA)).toBe(Infinity);
  });

  it("dentro no toca una vista que ya deja la caja adentro", () => {
    const c: Caja = { x: -20, y: -20, w: 40, h: 40 };
    const v = { x: 0, y: 70, z: 1.2 };
    expect(adentro(c, ZONA, v)).toBe(true);
    expect(dentro(c, ZONA, v, SW, SH)).toEqual(v);
  });

  it("dentro corre el centro lo justo, sin cambiar el acercamiento si la caja entra", () => {
    // Una llama pegada al borde izquierdo: la cola quedaba afuera.
    const llama: Caja = { x: 1700, y: 300, w: 287, h: 430 };
    const v = { x: 2000, y: 450, z: 0.77 };
    expect(adentro(llama, ZONA, v)).toBe(false);
    const w = dentro(llama, ZONA, v, SW, SH);
    expect(w.z).toBe(0.77);
    expect(adentro(llama, ZONA, w)).toBe(true);
    // Lo justo: la cola queda en el borde de la zona, no en el medio.
    expect(enPantalla(llama, w, SW, SH).x).toBeCloseTo(ZONA.x0, 6);
  });

  it("dentro baja el acercamiento cuando la caja no entra, y la deja adentro", () => {
    const enorme: Caja = { x: 0, y: 0, w: 600, h: 900 };
    const w = dentro(enorme, ZONA, { x: 300, y: 450, z: 1.6 }, SW, SH);
    expect(w.z).toBeCloseTo(cabe(enorme, ZONA), 9);
    expect(adentro(enorme, ZONA, w)).toBe(true);
  });

  it("dentro respeta cualquier acercamiento: con más zoom, corre más", () => {
    const c: Caja = { x: 1000, y: 200, w: 200, h: 300 };
    for (const z of [0.4, 0.8, 1, 1.12, 1.18, 1.3]) {
      const w = dentro(c, ZONA, { x: 900, y: 100, z }, SW, SH);
      expect(adentro(c, ZONA, w)).toBe(true);
    }
  });

  it("centrar pone el medio de la caja en el medio de la zona", () => {
    const c: Caja = { x: 100, y: 200, w: 50, h: 80 };
    const v = centrar(c, ZONA, SW, SH, 1.5);
    const p = enPantalla(c, v, SW, SH);
    expect(p.x + p.w / 2).toBeCloseTo((ZONA.x0 + ZONA.x1) / 2, 6);
    expect(p.y + p.h / 2).toBeCloseTo((ZONA.y0 + ZONA.y1) / 2, 6);
  });

  it("tapada mide qué parte de una caja queda debajo de otra", () => {
    const a: Caja = { x: 0, y: 0, w: 10, h: 10 };
    expect(tapada(a, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(0.5, 9);
    expect(tapada(a, { x: 20, y: 0, w: 10, h: 10 })).toBe(0);
    expect(tapada(a, { x: -5, y: -5, w: 30, h: 30 })).toBe(1);
    expect(tapada({ x: 0, y: 0, w: 0, h: 10 }, a)).toBe(0);
  });

  it("meter no toca un nombre que ya está entero adentro, ni uno entero afuera", () => {
    expect(meter({ x: 20, y: 300, w: 120, h: 30 }, ZONA)).toBeNull();
    // Entero afuera no se ve: no se trae de lejos.
    expect(meter({ x: 400, y: 300, w: 120, h: 30 }, ZONA)).toBeNull();
    expect(meter({ x: 20, y: 760, w: 120, h: 30 }, ZONA)).toBeNull();
    expect(meter({ x: 20, y: 300, w: 0, h: 30 }, ZONA)).toBeNull();
  });

  it("meter corre lo justo al nombre cortado, de cada lado", () => {
    // "Valeria T…" contra el borde derecho del celular.
    expect(meter({ x: 300, y: 300, w: 120, h: 30 }, ZONA)).toEqual({ dx: ZONA.x1 - 420, dy: 0, s: 1 });
    // "Va", contra el borde izquierdo.
    expect(meter({ x: -60, y: 300, w: 120, h: 30 }, ZONA)).toEqual({ dx: ZONA.x0 + 60, dy: 0, s: 1 });
    // Debajo del relator y debajo de la barra de arriba.
    expect(meter({ x: 20, y: 700, w: 120, h: 30 }, ZONA)).toEqual({ dx: 0, dy: ZONA.y1 - 730, s: 1 });
    expect(meter({ x: 20, y: 260, w: 120, h: 30 }, ZONA)).toEqual({ dx: 0, dy: ZONA.y0 - 260, s: 1 });
    // En una esquina, en los dos ejes.
    expect(meter({ x: 370, y: 700, w: 40, h: 30 }, ZONA)).toEqual({ dx: ZONA.x1 - 410, dy: ZONA.y1 - 730, s: 1 });
  });

  it("meter achica lo que no entra, y después lo deja adentro", () => {
    const ancho: Caja = { x: -10, y: 300, w: 736, h: 30 };
    const m = meter(ancho, ZONA);
    expect(m?.s).toBeCloseTo((ZONA.x1 - ZONA.x0) / 736, 9);
    const c: Caja = { x: ancho.x + (m?.dx ?? 0), y: ancho.y + (m?.dy ?? 0), w: ancho.w * (m?.s ?? 1), h: ancho.h * (m?.s ?? 1) };
    expect(c.x).toBeCloseTo(ZONA.x0, 9);
    expect(c.x + c.w).toBeLessThanOrEqual(ZONA.x1 + 1e-9);
    expect(meter(c, ZONA)).toBeNull();
  });

  it("guardiaNombre: entero adentro o entero fuera de la pantalla, nada", () => {
    expect(guardiaNombre({ x: 20, y: 300, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "nada" });
    expect(guardiaNombre({ x: 500, y: 300, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "nada" });
    expect(guardiaNombre({ x: 20, y: -40, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "nada" });
  });

  it("guardiaNombre: detrás de la barra o del relator, no se dibuja", () => {
    expect(guardiaNombre({ x: 20, y: 40, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "tapar" });
    expect(guardiaNombre({ x: 20, y: 780, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "tapar" });
  });

  it("guardiaNombre: un poco cortado se corre lo justo; muy afuera no se dibuja", () => {
    // Un cuarto afuera del borde derecho: se corre.
    expect(guardiaNombre({ x: 289, y: 300, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "correr", dx: -30, dy: 0, s: 1 });
    // "Valeria" con "Torrez" afuera: más de la mitad del chip, su dueño quedó fuera de cuadro.
    expect(guardiaNombre({ x: 310, y: 300, w: 140, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "tapar" });
    // Medio metido debajo del relator: se sube.
    expect(guardiaNombre({ x: 20, y: 700, w: 120, h: 30 }, ZONA, SW, SH)).toEqual({ tipo: "correr", dx: 0, dy: -15, s: 1 });
    // Con otro tope, otro corte.
    expect(guardiaNombre({ x: 310, y: 300, w: 140, h: 30 }, ZONA, SW, SH, 0.6)).toEqual({ tipo: "correr", dx: -71, dy: 0, s: 1 });
  });

  it("es determinista: las mismas cajas dan la misma vista", () => {
    const c: Caja = { x: 1234.5, y: 77.25, w: 321, h: 456 };
    const v = { x: 1000, y: 300, z: 1.4 };
    expect(dentro(c, ZONA, v, SW, SH)).toEqual(dentro(c, ZONA, v, SW, SH));
  });
});
