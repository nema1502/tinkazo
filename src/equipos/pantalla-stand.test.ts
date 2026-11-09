import { describe, expect, it } from "vitest";
import type { Evidencia } from "./estado";
import type { Equipo } from "./modelo";
import { ALTO_EN_LETRAS, deLaPagina, disposicion, estadoEnPantalla, filasDePantalla, horaValida, instanteDelSorteo, regresiva } from "./pantalla-stand";

/** La pantalla del stand sin DOM: la cuenta regresiva, qué dice cada equipo y cómo entran en el proyector. */

const local = (h: number, min: number, s = 0, dia = 14): number => new Date(2026, 10, dia, h, min, s).getTime();

const equipo = (n: number, o: Partial<Equipo> = {}): Equipo => ({
  n,
  cuenta: `G${String(n).padStart(55, "A")}`,
  nombre: `Equipo ${n}`,
  integrantes: ["Ana", "Beto"],
  guardado: "solicitud",
  v: 1,
  revisar: false,
  activa: true,
  ...o,
});

describe("la hora del sorteo", () => {
  it("acepta lo que escribe un campo de hora y nada más", () => {
    expect(horaValida("18:30")).toBe(true);
    expect(horaValida("00:00")).toBe(true);
    for (const x of ["", "8:30", "24:00", "18:60", "18:30:00", "seis"]) expect(horaValida(x), x).toBe(false);
  });

  it("es hoy a esa hora, también si ya pasó hace poco", () => {
    expect(instanteDelSorteo("18:00", local(17, 30))).toBe(local(18, 0));
    expect(instanteDelSorteo("18:00", local(19, 0))).toBe(local(18, 0));
  });

  it("si quedó más de doce horas atrás, es la de mañana (un sorteo pasada la medianoche)", () => {
    expect(instanteDelSorteo("00:30", local(23, 0))).toBe(local(0, 30, 0, 15));
  });

  it("sin hora no hay instante", () => {
    expect(instanteDelSorteo("", local(17, 0))).toBeNull();
  });
});

describe("la cuenta regresiva", () => {
  it("dice minutos y segundos, y desde una hora también las horas", () => {
    expect(regresiva(local(18, 0), local(17, 30))).toEqual({ llego: false, segundos: 1800, texto: "30:00" });
    expect(regresiva(local(18, 0), local(17, 55, 55))).toMatchObject({ texto: "4:05" });
    expect(regresiva(local(18, 0), local(16, 55, 55))).toMatchObject({ texto: "1:04:05" });
  });

  it("redondea para arriba y llega justo en cero", () => {
    expect(regresiva(local(18, 0), local(18, 0) - 300)).toMatchObject({ llego: false, texto: "0:01" });
    expect(regresiva(local(18, 0), local(18, 0))).toEqual({ llego: true });
    expect(regresiva(local(18, 0), local(18, 5))).toEqual({ llego: true });
  });
});

describe("qué dice cada equipo", () => {
  const sin = new Map<string, Evidencia>();
  it("pedir participar y estar anotado son lo mismo para la sala", () => {
    expect(estadoEnPantalla("sorteo", equipo(1), sin)).toBe("anotado");
    expect(estadoEnPantalla("cupon", equipo(1, { guardado: "aceptado" }), sin)).toBe("anotado");
  });

  it("con sorteo propio: aceptado, ya sorteó y con cupón", () => {
    const e = equipo(1, { guardado: "aceptado" });
    expect(estadoEnPantalla("sorteo", e, sin)).toBe("aceptado");
    expect(estadoEnPantalla("sorteo", e, new Map([[e.cuenta, { yaSorteo: { id: "1", contrato: "C" } }]]))).toBe("sorteo");
    expect(estadoEnPantalla("sorteo", e, new Map([[e.cuenta, { cupon: { orden: 1n, hash: "h" } }]]))).toBe("cupon");
  });

  it("los equipos van en el orden en que se anotaron, sin los que hay que revisar, y el contador cuenta solo a los que se ven", () => {
    const a = equipo(2, { nombre: "Las Wawas" });
    const b = equipo(1, { nombre: "Los Cóndores", guardado: "aceptado" });
    const c = equipo(3, { nombre: "Para revisar", revisar: true });
    const ev = new Map<string, Evidencia>([
      [a.cuenta, { cupon: { orden: 5n, hash: "x" } }],
      [c.cuenta, { cupon: { orden: 6n, hash: "y" } }],
    ]);
    const r = filasDePantalla("cupon", [a, b, c], ev);
    expect(r.filas).toEqual([
      { n: 1, nombre: "Los Cóndores", estado: "anotado" },
      { n: 2, nombre: "Las Wawas", estado: "cupon" },
    ]);
    // El equipo para revisar tiene cupón en la red, pero no se ve en la pantalla: no entra en la cuenta.
    expect(r.conCupon).toBe(1);
    expect(r.total).toBe(2);
  });

  it("si dos equipos se llaman igual, el segundo lleva (2): solo lo que se muestra", () => {
    const a = equipo(1, { nombre: "Equipo 7" });
    const b = equipo(2, { nombre: "equipo 7" });
    const c = equipo(3, { nombre: "Los Cóndores" });
    const r = filasDePantalla("cupon", [a, b, c], new Map());
    expect(r.filas.map((f) => f.nombre)).toEqual(["Equipo 7", "equipo 7 (2)", "Los Cóndores"]);
    // Las cuentas, que es lo que se sella, no cambian.
    expect(a.cuenta).not.toBe(b.cuenta);
  });
});

describe("cómo entran en el proyector", () => {
  // El lugar de los equipos en 1920 x 1080, y la letra de la sala: 28 a 54 px.
  const [ancho, alto, min, max] = [1060, 640, 28, 54];

  it("con pocos equipos, la letra más grande y una sola columna", () => {
    const d = disposicion(2, ancho, alto, min, max);
    expect(d.letra).toBe(54);
    expect(d.columnas).toBe(1);
    expect(d.paginas).toBe(1);
  });

  it("la letra baja a medida que llegan equipos, sin bajar nunca de la mínima de la sala", () => {
    let antes = Infinity;
    for (const n of [1, 4, 8, 12, 20, 30, 60, 100]) {
      const d = disposicion(n, ancho, alto, min, max);
      expect(d.letra, `n=${n}`).toBeLessThanOrEqual(antes);
      expect(d.letra, `n=${n}`).toBeGreaterThanOrEqual(min);
      // Lo que entra en una página entra de verdad en el lugar.
      expect(d.filas * d.letra * ALTO_EN_LETRAS, `n=${n}`).toBeLessThanOrEqual(alto);
      expect(d.columnas, `n=${n}`).toBeLessThanOrEqual(4);
      antes = d.letra;
    }
  });

  it("si con la mínima no entran, pasan en páginas", () => {
    const d = disposicion(100, ancho, alto, min, max);
    expect(d.letra).toBe(min);
    expect(d.paginas).toBeGreaterThan(1);
    expect(d.porPagina * d.paginas).toBeGreaterThanOrEqual(100);
  });

  it("las páginas dan la vuelta", () => {
    const xs = Array.from({ length: 7 }, (_, i) => i);
    expect(deLaPagina(xs, 3, 0)).toEqual([0, 1, 2]);
    expect(deLaPagina(xs, 3, 2)).toEqual([6]);
    expect(deLaPagina(xs, 3, 3)).toEqual([0, 1, 2]);
  });
});
