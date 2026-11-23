// El conteo de cuentas nuevas y de activaciones por hora (issue 177): desde los movimientos de los créditos de Pollar,
// como los lee `pollar.ts` y los cuenta por evento `vigilancia.ts`. Módulo puro, con el reloj entrando como argumento:
// ninguna prueba toca una red.
import { describe, expect, it } from "vitest";
import { MAX_MOVIMIENTOS } from "./vigilancia";
import { contarCuentasPorHora } from "./lectura-cuentas";

const HORA = 3_600_000;
/** Sábado 14 de noviembre de 2026, 09:00 UTC: la misma ancla que usan las otras pruebas de los movimientos. */
const T0 = Date.UTC(2026, 10, 14, 9, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const horaDe = (ms: number) => iso(Math.floor(ms / HORA) * HORA);

/** Una cuenta nueva: el cobro de crear la billetera de Turnkey, medido en la vigilancia de firmas. */
const nueva = (ms: number, extra: Record<string, unknown> = {}) => ({ event: "wallet.created:STELLAR:COSIGNED", amount: -15, createdAt: iso(ms), ...extra });
/** Una activación: el cobro de poner la cuenta en la red (`account.active`). */
const activacion = (ms: number, extra: Record<string, unknown> = {}) => ({ event: "account.active:monthly", amount: -10, createdAt: iso(ms), ...extra });

describe("contarCuentasPorHora: las cuentas nuevas y las activaciones de cada hora", () => {
  it("cuenta solo los cobros de crear billetera y de activar, desde el comienzo de la ventana", () => {
    const movimientos = [
      nueva(T0 - MINUTOS(10)),
      nueva(T0 - 30 * 60_000),
      activacion(T0 - 20 * 60_000),
      // Firmas, devoluciones y otros cobros no cuentan.
      { event: "cosign.signature:STELLAR", amount: -20, createdAt: iso(T0 - MINUTOS(5)) },
      activacion(T0 - MINUTOS(30), { amount: 10 }),
      nueva(T0 - 2 * HORA),
      { event: "otra.cosa", amount: -3, createdAt: iso(T0) },
    ];
    const r = contarCuentasPorHora(movimientos, T0 - HORA, T0);
    expect(r.porHora).toEqual([
      { hora: horaDe(T0 - HORA), nuevas: 2, activaciones: 1 },
      { hora: horaDe(T0), nuevas: 0, activaciones: 0 },
    ]);
    expect(r.completo).toBe(true);
  });

  it("lo que se mide distingue las horas del día con el reloj que entra como argumento", () => {
    const movimientos = [nueva(T0 - MINUTOS(10)), activacion(T0 - 90 * 60_000)];
    const r = contarCuentasPorHora(movimientos, T0 - 2 * HORA, T0);
    expect(r.porHora).toEqual([
      { hora: horaDe(T0 - 2 * HORA), nuevas: 0, activaciones: 1 },
      { hora: horaDe(T0 - HORA), nuevas: 1, activaciones: 0 },
      { hora: horaDe(T0), nuevas: 0, activaciones: 0 },
    ]);
  });

  it("un movimiento que agrupa varias cuenta las que dice, y lo que no se entiende no cuenta", () => {
    const r = contarCuentasPorHora(
      [nueva(T0 - MINUTOS(10), { count: 4 }), activacion(T0 - MINUTOS(20), { count: 2 }), null, 3, "x", { amount: -15 }, { event: "wallet.created:STELLAR:COSIGNED" }, nueva(T0 - MINUTOS(5), { count: -2 })],
      T0 - HORA,
      T0,
    );
    expect(r.porHora).toEqual([
      { hora: horaDe(T0 - HORA), nuevas: 5, activaciones: 2 },
      // El cobro sin fecha no se sabe de qué hora es: cuenta en la hora del reloj.
      { hora: horaDe(T0), nuevas: 1, activaciones: 0 },
    ]);
  });

  it("lo que no sea una lista de movimientos da cero y completo", () => {
    expect(contarCuentasPorHora("no es una lista", T0 - HORA, T0)).toEqual({
      porHora: [
        { hora: horaDe(T0 - HORA), nuevas: 0, activaciones: 0 },
        { hora: horaDe(T0), nuevas: 0, activaciones: 0 },
      ],
      completo: true,
    });
  });

  it("con la página llena, dice que puede haber más", () => {
    const movimientos = Array.from({ length: MAX_MOVIMIENTOS }, (_, i) => nueva(T0 - i * 1000));
    const r = contarCuentasPorHora(movimientos, T0 - HORA, T0);
    expect(r.completo).toBe(false);
  });

  it("ninguna ventana de más de un día: el conteo se pide desde la misma ventana que la vigilancia", () => {
    const movimientos = Array.from({ length: 30 }, (_, i) => nueva(T0 - i * HORA - MINUTOS(30)));
    const r = contarCuentasPorHora(movimientos, T0 - 24 * HORA, T0);
    expect(r.porHora).toHaveLength(25);
  });
});

function MINUTOS(n: number): number {
  return n * 60_000;
}
