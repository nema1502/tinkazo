import { describe, expect, it } from "vitest";
import { DIA_MS, RESERVA_SORTEO_MS } from "./config";
import { Cupos, PURGA_USO_MS, type Limites } from "./cupos";
import { sqlDePrueba } from "./sqlite-prueba";

const CUENTA = "GCUENTAUNO";
const OTRA = "GCUENTADOS";
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0); // 10-nov-2026
const EST = 1_000_000; // 0,1 XLM
const LIM: Limites = { maxSellos: 20, maxSorteos: 40, topeGeneral: 150_000_000, reservaSorteo: EST };

const nuevo = () => {
  const sql = sqlDePrueba();
  return { sql, c: new Cupos(sql) };
};
let n = 0;
const res = (c: Cupos, cuenta: string, metodo: "seal" | "draw", ahora: number, lim = LIM, estimado = EST) => c.reservar({ hash: `h${++n}`, cuenta, metodo, estimado, vence: Math.floor(ahora / 1000) + 240 }, ahora, lim);

describe("el cupo de la cuenta, por mes", () => {
  it("el sello 20 pasa y el 21 da cupo-cuenta con la fecha en que se libera", () => {
    const { c } = nuevo();
    for (let i = 1; i <= 20; i++) {
      const r = res(c, CUENTA, "seal", T0 + i * 1000);
      expect(r.ok, `sello ${i}`).toBe(true);
      if (r.ok) expect(r.quedan).toBe(20 - i);
    }
    const r = res(c, CUENTA, "seal", T0 + 30_000);
    expect(r).toEqual({ ok: false, motivo: "cupo-cuenta", que: "sellos", liberaEn: Date.UTC(2026, 11, 1), max: 20 });
  });

  it("corriendo el reloj, el cupo se libera justo cuando se dijo", () => {
    const { c } = nuevo();
    for (let i = 0; i < 20; i++) res(c, CUENTA, "seal", T0 + i);
    const liberaEn = Date.UTC(2026, 11, 1);
    expect(res(c, CUENTA, "seal", liberaEn - 1).ok).toBe(false);
    expect(res(c, CUENTA, "seal", liberaEn).ok).toBe(true);
  });

  it("cada cuenta tiene su cupo", () => {
    const { c } = nuevo();
    for (let i = 0; i < 20; i++) res(c, CUENTA, "seal", T0);
    expect(res(c, CUENTA, "seal", T0).ok).toBe(false);
    expect(res(c, OTRA, "seal", T0).ok).toBe(true);
  });

  it("una cuenta verificada tiene 50", () => {
    const { c } = nuevo();
    const lim = { ...LIM, maxSellos: 50, maxSorteos: 100 };
    for (let i = 0; i < 50; i++) expect(res(c, CUENTA, "seal", T0, lim).ok).toBe(true);
    expect(res(c, CUENTA, "seal", T0, lim)).toMatchObject({ ok: false, motivo: "cupo-cuenta", max: 50 });
  });

  it("sortear no se frena por el cupo de sellos: tiene el suyo, el doble", () => {
    const { c } = nuevo();
    for (let i = 0; i < 20; i++) res(c, CUENTA, "seal", T0);
    expect(res(c, CUENTA, "seal", T0).ok).toBe(false);
    for (let i = 0; i < 40; i++) expect(res(c, CUENTA, "draw", T0).ok, `sorteo ${i + 1}`).toBe(true);
    expect(res(c, CUENTA, "draw", T0)).toMatchObject({ ok: false, motivo: "cupo-cuenta", que: "sorteos", max: 40 });
  });

  it("consultar dice lo que queda", () => {
    const { c } = nuevo();
    res(c, CUENTA, "seal", T0);
    res(c, CUENTA, "draw", T0);
    expect(c.consultar(CUENTA, T0, LIM)).toMatchObject({ mes: "2026-11", sellos: 1, sorteos: 1, quedan: 19, quedanSorteos: 39 });
    expect(c.consultar(OTRA, T0, LIM)).toMatchObject({ sellos: 0, quedan: 20 });
  });
});

describe("el mismo hash", () => {
  it("reservado cinco veces cuenta uno", () => {
    const { c } = nuevo();
    const p = { hash: "mismo", cuenta: CUENTA, metodo: "seal" as const, estimado: EST, vence: 9_999_999_999 };
    const rs = Array.from({ length: 5 }, () => c.reservar(p, T0, LIM));
    expect(rs.map((r) => r.ok && r.yaContado)).toEqual([false, true, true, true, true]);
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(1);
    expect(c.gastoDeLaVentana(T0)).toBe(EST);
    expect(c.reservadoParaSorteos(T0)).toBe(EST);
  });
});

describe("lo guardado para el sorteo es un monto fijo", () => {
  it("no depende del estimado del sello ni del costo real del sello: se queda fijo hasta que el sorteo cierre", () => {
    const { c } = nuevo();
    const lim: Limites = { ...LIM, reservaSorteo: 80_000 };
    for (let i = 0; i < 8; i++) c.reservar({ hash: `s${i}`, cuenta: CUENTA, metodo: "seal", estimado: 9_000_000, vence: 1 }, T0 + i, lim);
    expect(c.reservadoParaSorteos(T0)).toBe(8 * 80_000);
    c.cerrar("s0", "ok", 50_000);
    c.cerrar("s1", "ok", 120_000);
    expect(c.reservadoParaSorteos(T0)).toBe(8 * 80_000);
    // Al cerrar el sorteo, la reserva ya usada deja de contar y el gasto pasa a lo real del sorteo.
    c.reservar({ hash: "d0", cuenta: CUENTA, metodo: "draw", estimado: 60_000, vence: 1 }, T0 + 100, lim);
    c.cerrar("d0", "ok", 54_000);
    expect(c.reservadoParaSorteos(T0)).toBe(7 * 80_000);
    expect(c.gastoDeLaVentana(T0)).toBe(50_000 + 120_000 + 6 * 9_000_000 + 54_000);
    // Un sello que falló suelta su reserva.
    c.cerrar("s2", "fallo", 10_000);
    expect(c.reservadoParaSorteos(T0)).toBe(6 * 80_000);
  });
});

describe("el tope general, en una ventana móvil de 24 horas", () => {
  const lim: Limites = { ...LIM, topeGeneral: 10 * EST };

  it("un sello se acepta solo si queda para él y para su sorteo", () => {
    const { c } = nuevo();
    // Cuatro sellos: 4 de gasto y 4 guardados para sus sorteos = 8 de 10.
    for (let i = 0; i < 4; i++) expect(res(c, OTRA, "seal", T0, lim).ok).toBe(true);
    expect(c.gastoDeLaVentana(T0) + c.reservadoParaSorteos(T0)).toBe(8 * EST);
    // El quinto necesitaría 2 más: justo entra (10).
    expect(res(c, OTRA, "seal", T0, lim).ok).toBe(true);
    // El sexto no.
    expect(res(c, OTRA, "seal", T0, lim)).toEqual({ ok: false, motivo: "fondo" });
  });

  it("con el tope lleno un seal se rechaza y el draw de un sello ya aceptado pasa", () => {
    const { c } = nuevo();
    for (let i = 0; i < 5; i++) res(c, CUENTA, "seal", T0, lim);
    expect(res(c, OTRA, "seal", T0, lim)).toEqual({ ok: false, motivo: "fondo" });
    for (let i = 0; i < 5; i++) expect(res(c, CUENTA, "draw", T0, lim).ok, `sorteo ${i}`).toBe(true);
    // Los cinco sorteos usaron lo guardado: el gasto sigue en 10, sin pasarse.
    expect(c.gastoDeLaVentana(T0)).toBe(10 * EST);
    expect(c.reservadoParaSorteos(T0)).toBe(0);
  });

  it("un draw sin sello guardado compite por el presupuesto", () => {
    const { c } = nuevo();
    for (let i = 0; i < 10; i++) expect(res(c, OTRA, "draw", T0, lim).ok).toBe(true);
    expect(res(c, OTRA, "draw", T0, lim)).toEqual({ ok: false, motivo: "fondo" });
  });

  it("lo guardado para un sorteo se libera al salir de su ventana", () => {
    const { c } = nuevo();
    for (let i = 0; i < 5; i++) res(c, CUENTA, "seal", T0, lim);
    expect(c.reservadoParaSorteos(T0)).toBe(5 * EST);
    expect(c.reservadoParaSorteos(T0 + RESERVA_SORTEO_MS - 1)).toBe(5 * EST);
    expect(c.reservadoParaSorteos(T0 + RESERVA_SORTEO_MS + 1)).toBe(0);
  });

  it("el gasto sale de la ventana a las 24 horas, no a medianoche", () => {
    const { c } = nuevo();
    res(c, CUENTA, "draw", T0, lim);
    expect(c.gastoDeLaVentana(T0 + DIA_MS - 1)).toBe(EST);
    expect(c.gastoDeLaVentana(T0 + DIA_MS + 1)).toBe(0);
  });

  it("lo real reemplaza a lo estimado cuando se sabe", () => {
    const { c } = nuevo();
    const r = c.reservar({ hash: "x", cuenta: CUENTA, metodo: "draw", estimado: EST, vence: 1 }, T0, lim);
    expect(r.ok).toBe(true);
    c.cerrar("x", "ok", 123_456);
    expect(c.gastoDeLaVentana(T0)).toBe(123_456);
  });
});

describe("el peor caso: sellos baratos y sorteos inflados (A1)", () => {
  const SELLO = 30_000;
  const FIJO = 82_000;
  const lim = (topeGeneral: number): Limites => ({ maxSellos: 20, maxSorteos: 40, topeGeneral, reservaSorteo: FIJO });
  const gastoTotal = (c: Cupos) => c.gastoDeLaVentana(T0);

  it("un sorteo con sello guardado y estimado inflado ya no se salta el presupuesto: lo que pasa de 2 montos fijos compite como un pedido nuevo", () => {
    const { c } = nuevo();
    const holgado = 20 * (SELLO + FIJO); // alcanza para 20 sellos con sus reservas
    for (let i = 0; i < 20; i++) expect(c.reservar({ hash: `s${i}`, cuenta: CUENTA, metodo: "seal", estimado: SELLO, vence: 1 }, T0, lim(holgado)).ok, `sello ${i}`).toBe(true);
    for (let i = 0; i < 20; i++) c.cerrar(`s${i}`, "ok", SELLO);
    // El fondo queda lleno (lo gastado más lo guardado). Sorteos con recursos inflados (1 millón de estimado, más de 12 veces
    // el monto fijo): antes pasaban los 20 porque el sello guardado se llevaba `falta = 0`; ahora ninguno pasa.
    const lleno = gastoTotal(c) + c.reservadoParaSorteos(T0);
    for (let i = 0; i < 20; i++) expect(c.reservar({ hash: `d${i}`, cuenta: CUENTA, metodo: "draw", estimado: 1_000_000, vence: 1 }, T0, lim(lleno)), `sorteo ${i}`).toEqual({ ok: false, motivo: "fondo" });
    expect(gastoTotal(c) + c.reservadoParaSorteos(T0)).toBe(lleno);
    // Con lugar para la diferencia (1 millón menos 2 montos fijos), uno pasa.
    expect(c.reservar({ hash: "d-ok", cuenta: CUENTA, metodo: "draw", estimado: 1_000_000, vence: 1 }, T0, lim(lleno + 1_000_000 - 2 * FIJO)).ok).toBe(true);
  });

  it("los sorteos que sí usan lo guardado (hasta 2 montos fijos) pasan, y el gasto no pasa del presupuesto más 20 reservas fijas", () => {
    const { c } = nuevo();
    const tope = 20 * (SELLO + FIJO);
    for (let i = 0; i < 20; i++) c.reservar({ hash: `s${i}`, cuenta: CUENTA, metodo: "seal", estimado: SELLO, vence: 1 }, T0, lim(tope));
    for (let i = 0; i < 20; i++) c.cerrar(`s${i}`, "ok", SELLO);
    for (let i = 0; i < 20; i++) expect(c.reservar({ hash: `d${i}`, cuenta: CUENTA, metodo: "draw", estimado: 2 * FIJO, vence: 1 }, T0, lim(tope)).ok, `sorteo ${i}`).toBe(true);
    for (let i = 0; i < 20; i++) c.cerrar(`d${i}`, "ok", 2 * FIJO);
    expect(gastoTotal(c)).toBe(20 * SELLO + 20 * 2 * FIJO);
    // Los sellos costaron menos de lo que se les presupuestó (SELLO contra SELLO + FIJO): el sobrante paga el exceso de los sorteos.
    expect(gastoTotal(c)).toBeLessThanOrEqual(tope + 20 * FIJO);
    // Y un sorteo más de esa cuenta, ya sin sello guardado, compite por todo su estimado con el fondo pasado de su tope: no pasa.
    expect(c.reservar({ hash: "d21", cuenta: CUENTA, metodo: "draw", estimado: 2 * FIJO, vence: 1 }, T0, lim(tope))).toEqual({ ok: false, motivo: "fondo" });
  });

  it("muchas cuentas con sellos baratos: nunca queda más gastado que el presupuesto más una reserva fija por cada sello aceptado", () => {
    const { c } = nuevo();
    const tope = 3_000_000;
    let aceptados = 0;
    for (let k = 0; k < 40; k++) {
      for (let i = 0; i < 20; i++) if (c.reservar({ hash: `s${k}-${i}`, cuenta: `G${k}`, metodo: "seal", estimado: SELLO, vence: 1 }, T0, lim(tope)).ok) aceptados++;
    }
    for (let k = 0; k < 40; k++) {
      for (let i = 0; i < 20; i++) c.reservar({ hash: `d${k}-${i}`, cuenta: `G${k}`, metodo: "draw", estimado: 5_000_000, vence: 1 }, T0, lim(tope));
    }
    expect(aceptados).toBeGreaterThan(0);
    expect(gastoTotal(c) + c.reservadoParaSorteos(T0)).toBeLessThanOrEqual(tope + aceptados * FIJO);
  });
});

describe("rechazada sin entrar o entró y falló", () => {
  it("devolver deja el cupo y el presupuesto como estaban, y se puede volver a reservar", () => {
    const { c } = nuevo();
    c.reservar({ hash: "a", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(1);
    c.devolver("a");
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(0);
    expect(c.gastoDeLaVentana(T0)).toBe(0);
    expect(c.reservadoParaSorteos(T0)).toBe(0);
    expect(c.buscar("a")?.estado).toBe("devuelto");
    const otra = c.reservar({ hash: "a", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    expect(otra).toMatchObject({ ok: true, yaContado: false });
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(1);
  });

  it("cerrar no resucita una fila devuelta: no vuelve a contar el cupo ni el gasto ni a guardar lo del sorteo", () => {
    const { c } = nuevo();
    c.reservar({ hash: "a", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    c.devolver("a");
    // La red la cerró de todos modos (una carrera entre dos pedidos del mismo hash): llega un cierre sobre una fila devuelta.
    c.cerrar("a", "ok", 54_000);
    expect(c.buscar("a")).toMatchObject({ estado: "devuelto", real: 54_000 });
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(0);
    expect(c.gastoDeLaVentana(T0)).toBe(0);
    expect(c.reservadoParaSorteos(T0)).toBe(0);
    expect(c.pendientes(T0 + 10 * 60_000)).toEqual([]);
    // Para volver a contar tiene que pasar por reservar.
    expect(c.reservar({ hash: "a", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM)).toMatchObject({ ok: true, yaContado: false });
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(1);
    expect(c.buscar("a")?.estado).toBe("reservado");
  });

  it("devolver es una sola vez: no resta dos veces", () => {
    const { c } = nuevo();
    c.reservar({ hash: "a", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    c.reservar({ hash: "b", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    c.devolver("a");
    c.devolver("a");
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(1);
  });

  it("si un sorteo es rechazado, lo guardado vuelve al sello que lo tenía", () => {
    const { c } = nuevo();
    c.reservar({ hash: "s", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    c.reservar({ hash: "d", cuenta: CUENTA, metodo: "draw", estimado: EST, vence: 1 }, T0, LIM);
    expect(c.reservadoParaSorteos(T0)).toBe(0);
    c.devolver("d");
    expect(c.reservadoParaSorteos(T0)).toBe(EST);
  });

  it("si entró y falló, se pagó y sigue contando; si era un sello, se suelta lo de su sorteo", () => {
    const { c } = nuevo();
    c.reservar({ hash: "s", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    c.cerrar("s", "fallo", 500_000);
    expect(c.consultar(CUENTA, T0, LIM).sellos).toBe(1);
    expect(c.gastoDeLaVentana(T0)).toBe(500_000);
    expect(c.reservadoParaSorteos(T0)).toBe(0);
  });

  it("los pendientes son los que siguen en el aire desde antes de cierto momento", () => {
    const { c } = nuevo();
    c.reservar({ hash: "a", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0, LIM);
    c.reservar({ hash: "b", cuenta: CUENTA, metodo: "seal", estimado: EST, vence: 1 }, T0 + 60_000, LIM);
    c.marcarEnviado("a");
    expect(c.pendientes(T0 + 1000).map((f) => f.hash)).toEqual(["a"]);
    c.cerrar("a", "ok", 1);
    expect(c.pendientes(T0 + 120_000).map((f) => f.hash)).toEqual(["b"]);
  });
});

describe("el objeto se reinicia", () => {
  it("los conteos siguen porque están en SQLite y no en memoria", () => {
    const { sql, c } = nuevo();
    for (let i = 0; i < 20; i++) res(c, CUENTA, "seal", T0);
    const despues = new Cupos(sql);
    expect(despues.consultar(CUENTA, T0, LIM).sellos).toBe(20);
    expect(res(despues, CUENTA, "seal", T0).ok).toBe(false);
  });
});

describe("lo que se guarda", () => {
  it("solo cuentas, meses, contadores, hashes con su resultado y el gasto", () => {
    const { c } = nuevo();
    res(c, CUENTA, "seal", T0);
    const todo = c.exportar();
    expect(Object.keys(todo).sort()).toEqual(["ajustes", "cuenta_app", "cuentas", "reserva", "uso"]);
    expect(Object.keys(todo.uso?.[0] ?? {}).sort()).toEqual(["creado", "cuenta", "estado", "estimado", "hash", "mes", "metodo", "real", "vence"]);
    expect(JSON.stringify(todo)).not.toMatch(/ip|nombre|correo|email/i);
  });

  it("se purga lo viejo al escribir, y lo que sigue en el aire no", () => {
    const { c } = nuevo();
    c.reservar({ hash: "viejo", cuenta: CUENTA, metodo: "draw", estimado: EST, vence: 1 }, T0, LIM);
    c.cerrar("viejo", "ok", 1);
    c.reservar({ hash: "aire", cuenta: CUENTA, metodo: "draw", estimado: EST, vence: 1 }, T0, LIM);
    c.purgar(T0 + PURGA_USO_MS + 1);
    expect(c.buscar("viejo")).toBeUndefined();
    expect(c.buscar("aire")).toBeDefined();
  });

  it("las cuentas abiertas por la app se recuerdan, y los ajustes se leen", () => {
    const { c } = nuevo();
    expect(c.cuentaConocida(CUENTA)).toBe(false);
    c.recordarCuenta(CUENTA, T0);
    expect(c.cuentaConocida(CUENTA)).toBe(true);
    expect(c.ajuste("modo")).toBeUndefined();
    c.fijarAjuste("modo", "apagado", T0);
    expect(c.ajuste("modo")).toBe("apagado");
  });
});
