import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVACIONES_POR_DIA, ACTIVAR_POR_CONEXION } from "../../workers/sala/src/activar";
import {
  DIAS_DE_LA_NOTA,
  anotarActivacion,
  antesDeActivar,
  contarRechazoDeActivar,
  crearTablasDeActivar,
  cupoDeCuenta,
  tomarNota,
} from "../../workers/sala/src/activar-cupos";
import { RECHAZOS_POR_CONEXION, RECHAZOS_POR_FICHA, VENTANA_CAMPANA_MS } from "../../workers/sala/src/campana";
import type { Ejecutar } from "../../workers/sala/src/registro";

/** Los topes de la activación en un SQLite de verdad, en memoria y sin reloj: la hora la pone cada prueba. */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const DIA = "2026-11-21";

let sql: Ejecutar;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  sql = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
  crearTablasDeActivar(sql);
});

describe("los pedidos de una conexión", () => {
  it("cada pedido que entra cuenta y al llegar al tope contesta cupo-conexion con el resto de la ventana", () => {
    for (let i = 0; i < ACTIVAR_POR_CONEXION; i++) expect(antesDeActivar(sql, { grupo: "g", ficha: `f${i}`, ahora: AHORA })).toEqual({ ok: true });
    const r = antesDeActivar(sql, { grupo: "g", ficha: "otra", ahora: AHORA });
    expect(r).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(r.ok === false && r.esperaS).toBeGreaterThan(0);
    expect(r.ok === false && r.esperaS).toBeLessThanOrEqual(VENTANA_CAMPANA_MS / 1000);
  });

  it("otra conexión no se ve afectada", () => {
    for (let i = 0; i < ACTIVAR_POR_CONEXION; i++) antesDeActivar(sql, { grupo: "g", ficha: `f${i}`, ahora: AHORA });
    expect(antesDeActivar(sql, { grupo: "h", ficha: "f", ahora: AHORA })).toEqual({ ok: true });
  });

  it("en la ventana siguiente el contador vuelve a cero", () => {
    for (let i = 0; i < ACTIVAR_POR_CONEXION; i++) antesDeActivar(sql, { grupo: "g", ficha: `f${i}`, ahora: AHORA });
    expect(antesDeActivar(sql, { grupo: "g", ficha: "f", ahora: AHORA + VENTANA_CAMPANA_MS })).toEqual({ ok: true });
  });
});

describe("los rechazos de sesión", () => {
  it("una misma ficha rechazada llega al tope y deja de preguntar", () => {
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazoDeActivar(sql, { grupo: "g", ficha: "mala", ahora: AHORA });
    expect(antesDeActivar(sql, { grupo: "g", ficha: "mala", ahora: AHORA })).toMatchObject({ ok: false, motivo: "rechazos" });
    expect(antesDeActivar(sql, { grupo: "g", ficha: "buena", ahora: AHORA })).toEqual({ ok: true });
  });

  it("la conexión suma solo la primera vez que ve una ficha mala: repetirla no la deja sin tope", () => {
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazoDeActivar(sql, { grupo: "g", ficha: "mala", ahora: AHORA });
    const filas = sql<{ n: number }>("SELECT n FROM activar_rechazos WHERE grupo = 'g'");
    expect(filas).toEqual([{ n: 1 }]);
  });

  it("con muchas fichas distintas rechazadas la conexión llega a su tope", () => {
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazoDeActivar(sql, { grupo: "g", ficha: `m${i}`, ahora: AHORA });
    expect(antesDeActivar(sql, { grupo: "g", ficha: "buena", ahora: AHORA })).toMatchObject({ ok: false, motivo: "rechazos" });
    expect(antesDeActivar(sql, { grupo: "h", ficha: "buena", ahora: AHORA })).toEqual({ ok: true });
  });

  it("al pasar la ventana se olvidan los rechazos", () => {
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazoDeActivar(sql, { grupo: "g", ficha: "mala", ahora: AHORA });
    expect(antesDeActivar(sql, { grupo: "g", ficha: "mala", ahora: AHORA + VENTANA_CAMPANA_MS })).toEqual({ ok: true });
    expect(sql("SELECT 1 FROM activar_ficha")).toEqual([]);
  });
});

describe("la nota de la comisión", () => {
  const tomar = (nota: string, evento: string, ahora = AHORA) => tomarNota(sql, { nota, evento, ahora });

  it("la primera activación se queda con la nota y otro evento con la misma nota no la toma", () => {
    expect(tomar("1234567890123", "evento-a")).toBe(true);
    expect(tomar("1234567890123", "evento-b")).toBe(false);
    expect(tomar("1234567890123", "evento-a")).toBe(true);
    expect(tomar("9999999999999", "evento-b")).toBe(true);
  });

  it("pasados los 31 días la nota se libera y se borra", () => {
    tomar("1234567890123", "evento-a");
    const despues = AHORA + DIAS_DE_LA_NOTA * 86_400_000 + 1;
    expect(tomar("1234567890123", "evento-b", despues)).toBe(true);
    expect(sql<{ evento: string }>("SELECT evento FROM activar_nota")).toEqual([{ evento: "evento-b" }]);
  });
});

describe("las campañas de una cuenta por día", () => {
  const cupo = (cuenta: string, evento: string, dia = DIA, ahora = AHORA) => cupoDeCuenta(sql, { cuenta, evento, dia, ahora });
  const anotar = (cuenta: string, evento: string, dia = DIA) => anotarActivacion(sql, { cuenta, evento, dia });

  it("caben cinco eventos distintos y el sexto no", () => {
    for (let i = 0; i < ACTIVACIONES_POR_DIA; i++) {
      expect(cupo("c", `e${i}`)).toEqual({ ok: true });
      anotar("c", `e${i}`);
    }
    const r = cupo("c", "e-nuevo");
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.esperaS).toBe(9 * 3600);
  });

  it("un evento ya activado hoy cabe siempre y anotarlo de nuevo no suma", () => {
    for (let i = 0; i < ACTIVACIONES_POR_DIA; i++) anotar("c", `e${i}`);
    anotar("c", "e0");
    expect(cupo("c", "e0")).toEqual({ ok: true });
    expect(sql<{ n: number }>("SELECT COUNT(*) AS n FROM activar_cuenta")[0]?.n).toBe(ACTIVACIONES_POR_DIA);
  });

  it("otra cuenta tiene su propio tope", () => {
    for (let i = 0; i < ACTIVACIONES_POR_DIA; i++) anotar("c", `e${i}`);
    expect(cupo("d", "e-nuevo")).toEqual({ ok: true });
  });

  it("al día siguiente vuelve a cero y se borra lo del día anterior", () => {
    for (let i = 0; i < ACTIVACIONES_POR_DIA; i++) anotar("c", `e${i}`);
    expect(cupo("c", "e-nuevo", "2026-11-22", AHORA + 86_400_000)).toEqual({ ok: true });
    expect(sql("SELECT 1 FROM activar_cuenta")).toEqual([]);
  });
});
