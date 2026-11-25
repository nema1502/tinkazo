// El aviso por las cuentas nuevas y las activaciones por hora (issue 177): el umbral configurable, la alternativa del
// evento abierto con su cupo, un solo aviso por hora y por motivo, y los textos en el patrón de los avisos del vigilante.
// Todo con movimientos simulados y el mundo de mentira: ninguna prueba toca una red.
import { describe, expect, it } from "vitest";
import { contarCuentasPorHora, type ConteoDeHora } from "../../../workers/patrocinio/src/lectura-cuentas";
import { asuntoDeClave, mensajeDeCuentas } from "./mensaje";
import { estadoBien, HORA, MINUTO, T0, mundoFalso } from "./mundo-falso";
import { CUENTAS_UMBRAL_POR_DEFECTO, cuentasDelEstado, umbralDeCuentas, vigilarCuentas } from "./cuentas";

const iso = (ms: number) => new Date(ms).toISOString();
const cuenta = (ms: number) => ({ event: "wallet.created:STELLAR:COSIGNED", amount: -15, createdAt: iso(ms) });
const activacion = (ms: number) => ({ event: "account.active:monthly", amount: -10, createdAt: iso(ms) });

/** Un bloque `cuentas` como el que manda el portero en `/estado`, contado desde movimientos simulados. */
function bloqueCuentas(movimientos: unknown[], desde: number, ahora: number): Record<string, unknown> {
  const { porHora, completo } = contarCuentasPorHora(movimientos, desde, ahora);
  return { porHora, completo };
}

describe("umbralDeCuentas: el umbral configurable de la vuelta", () => {
  it("por defecto es 200 por hora, que un evento de 150 personas no alcanza, y con el evento abierto es su cupo", () => {
    expect(CUENTAS_UMBRAL_POR_DEFECTO).toBe(200);
    expect(umbralDeCuentas({})).toEqual({ base: 200, cupoEvento: null });
    expect(umbralDeCuentas({ CUENTAS_UMBRAL: "120", CUENTAS_EVENTO_CUPO: "300" })).toEqual({ base: 120, cupoEvento: 300 });
  });

  it("un valor raro vuelve al de siempre (y el cupo del evento raro es: no hay evento)", () => {
    expect(umbralDeCuentas({ CUENTAS_UMBRAL: "mucho" })).toEqual({ base: CUENTAS_UMBRAL_POR_DEFECTO, cupoEvento: null });
    expect(umbralDeCuentas({ CUENTAS_UMBRAL: "0", CUENTAS_EVENTO_CUPO: "-3" })).toEqual({ base: CUENTAS_UMBRAL_POR_DEFECTO, cupoEvento: null });
    expect(umbralDeCuentas({ CUENTAS_EVENTO_CUPO: "0" })).toEqual({ base: CUENTAS_UMBRAL_POR_DEFECTO, cupoEvento: null });
  });
});

describe("cuentasDelEstado: lo que el portero manda del conteo por hora", () => {
  it("lee el bloque como viene y no se inventa nada con lo que falta", () => {
    const bloque = bloqueCuentas([cuenta(T0 - 30 * MINUTO)], T0 - HORA, T0);
    expect(cuentasDelEstado({ cuentas: bloque })).toEqual({ porHora: bloque.porHora, completo: true });
    expect(cuentasDelEstado(estadoBien())).toBeNull();
    expect(cuentasDelEstado({ cuentas: "no" })).toBeNull();
    expect(cuentasDelEstado({ cuentas: { porHora: [3] } })).toBeNull();
  });
});

describe("vigilarCuentas: debajo del umbral no avisa y arriba avisa una vez por hora y por motivo", () => {
  const umbrales = { base: 60, cupoEvento: null as number | null };
  const conCuentas = (nuevas: number, activaciones: number): ConteoDeHora => ({ hora: iso(T0 - MINUTO), nuevas, activaciones });
  const sinAviso = { hora: null, motivos: [] as string[] };

  it("debajo del umbral no avisa", () => {
    const r = vigilarCuentas({ cuentas: { porHora: [conCuentas(3, 2), { hora: iso(T0), nuevas: 59, activaciones: 1 }], completo: true }, ...umbrales, recordado: sinAviso });
    expect(r.hora).toBe(iso(T0));
    expect(r.avisar).toEqual([]);
  });

  it("una página llena de movimientos solo dice cuántos hay por lo menos: llegar al umbral ya avisa, y con el conteo completo hace falta pasarlo", () => {
    const hora = (nuevas: number, completo: boolean) => ({ porHora: [{ hora: iso(T0), nuevas, activaciones: 0 }], completo });
    const con = { base: 200, cupoEvento: null as number | null, recordado: sinAviso };
    expect(vigilarCuentas({ cuentas: hora(200, false), ...con }).avisar).toEqual([{ motivo: "cuentas-nuevas", hubo: 200, umbral: 200, hora: iso(T0) }]);
    expect(vigilarCuentas({ cuentas: hora(199, false), ...con }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas: hora(200, true), ...con }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas: hora(201, true), ...con }).avisar).toHaveLength(1);
  });

  it("arriba avisa una vez, y dentro de la misma hora no vuelve a avisar el mismo motivo", () => {
    const cuentas = { porHora: [{ hora: iso(T0), nuevas: 61, activaciones: 0 }], completo: true };
    const primera = vigilarCuentas({ cuentas: cuentas, ...umbrales, recordado: sinAviso });
    expect(primera.avisar).toEqual([{ motivo: "cuentas-nuevas", hubo: 61, umbral: 60, hora: iso(T0) }]);
    const segunda = vigilarCuentas({
      cuentas: cuentas,
      ...umbrales,
      recordado: { hora: iso(T0), motivos: ["cuentas-nuevas"] },
    });
    expect(segunda.avisar).toEqual([]);
  });

  it("en la hora siguiente, si sigue arriba, avisa otra vez", () => {
    const cuentas = { porHora: [{ hora: iso(T0 - HORA), nuevas: 61, activaciones: 0 }, { hora: iso(T0), nuevas: 61, activaciones: 0 }], completo: true };
    const r = vigilarCuentas({ cuentas: cuentas, ...umbrales, recordado: { hora: iso(T0 - HORA), motivos: ["cuentas-nuevas"] } });
    expect(r.avisar.map((a) => a.motivo)).toEqual(["cuentas-nuevas"]);
  });

  it("una oleada repartida entre dos horas de reloj se suma con la parte de la hora anterior que todavía cuenta", () => {
    const base = { base: 200, cupoEvento: null as number | null, recordado: sinAviso };
    const dosHoras = (anterior: number, actual: number) => ({ porHora: [{ hora: iso(T0), nuevas: anterior, activaciones: 0 }, { hora: iso(T0 + HORA), nuevas: actual, activaciones: 0 }], completo: true });
    // 190 a las 9:50 y 190 a las 10:05: a las 10:06 son 380 en 16 minutos, y ninguna hora de reloj pasa de 200.
    const r = vigilarCuentas({ cuentas: dosHoras(190, 190), ...base, ahoraMs: T0 + HORA + 6 * MINUTO });
    expect(r.avisar).toEqual([{ motivo: "cuentas-nuevas", hubo: 190 + Math.round((190 * 54) / 60), umbral: 200, hora: iso(T0 + HORA) }]);
    // La misma cifra, sin el reloj, mira solo la hora de reloj que empezó: lo de siempre.
    expect(vigilarCuentas({ cuentas: dosHoras(190, 190), ...base }).avisar).toEqual([]);
    // Un evento de 150 personas no alcanza el umbral en ninguna de las dos horas ni sumadas.
    expect(vigilarCuentas({ cuentas: dosHoras(75, 75), ...base, ahoraMs: T0 + HORA + MINUTO }).avisar).toEqual([]);
  });

  it("lo de la hora anterior pesa cada vez menos: 150 a las 9:05 y 150 a las 10:55 no son una oleada", () => {
    const base = { base: 200, cupoEvento: null as number | null, recordado: sinAviso };
    const cuentas = { porHora: [{ hora: iso(T0), nuevas: 150, activaciones: 0 }, { hora: iso(T0 + HORA), nuevas: 150, activaciones: 0 }], completo: true };
    expect(vigilarCuentas({ cuentas, ...base, ahoraMs: T0 + HORA + 55 * MINUTO }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas, ...base, ahoraMs: T0 + HORA + 5 * MINUTO }).avisar).toHaveLength(1);
  });

  it("solo se suma la hora que viene pegada: con un hueco, o con un reloj que no se entiende, vale la hora de reloj sola", () => {
    const base = { base: 200, cupoEvento: null as number | null, recordado: sinAviso };
    const conHueco = { porHora: [{ hora: iso(T0 - HORA), nuevas: 500, activaciones: 0 }, { hora: iso(T0 + HORA), nuevas: 10, activaciones: 0 }], completo: true };
    expect(vigilarCuentas({ cuentas: conHueco, ...base, ahoraMs: T0 + HORA + MINUTO }).avisar).toEqual([]);
    const pegadas = { porHora: [{ hora: iso(T0), nuevas: 500, activaciones: 0 }, { hora: iso(T0 + HORA), nuevas: 10, activaciones: 0 }], completo: true };
    for (const ahoraMs of [Number.NaN, Number.POSITIVE_INFINITY]) expect(vigilarCuentas({ cuentas: pegadas, ...base, ahoraMs }).avisar, String(ahoraMs)).toEqual([]);
    // Un reloj que va antes de la hora nueva cuenta toda la hora anterior, nunca más.
    expect(vigilarCuentas({ cuentas: pegadas, ...base, ahoraMs: T0 }).avisar).toHaveLength(1);
  });

  it("cada motivo se cuenta aparte: con las activaciones arriba y el aviso de activaciones prendido, avisa por ellas", () => {
    const r = vigilarCuentas({ cuentas: { porHora: [{ hora: iso(T0), nuevas: 1, activaciones: 75 }], completo: true }, ...umbrales, conActivaciones: true, recordado: sinAviso });
    expect(r.avisar).toEqual([{ motivo: "activaciones", hubo: 75, umbral: 60, hora: iso(T0) }]);
  });

  it("las activaciones no avisan hasta que se confirme el nombre de su cobro: por defecto el aviso de activaciones está apagado", () => {
    const cuentas = { porHora: [{ hora: iso(T0), nuevas: 1, activaciones: 500 }], completo: true };
    expect(vigilarCuentas({ cuentas, ...umbrales, recordado: sinAviso }).avisar).toEqual([]);
    const juntas = { porHora: [{ hora: iso(T0), nuevas: 61, activaciones: 500 }], completo: true };
    expect(vigilarCuentas({ cuentas: juntas, ...umbrales, recordado: sinAviso }).avisar.map((a) => a.motivo)).toEqual(["cuentas-nuevas"]);
  });

  it("los dos motivos arriba en la misma hora avisan juntos y quedan anotados los dos", () => {
    const cuentas = { porHora: [{ hora: iso(T0), nuevas: 61, activaciones: 61 }], completo: true };
    const r = vigilarCuentas({ cuentas: cuentas, ...umbrales, conActivaciones: true, recordado: sinAviso });
    expect(r.avisar.map((a) => a.motivo)).toEqual(["cuentas-nuevas", "activaciones"]);
    const despues = vigilarCuentas({ cuentas: cuentas, ...umbrales, conActivaciones: true, recordado: { hora: iso(T0), motivos: r.avisar.map((a) => a.motivo) } });
    expect(despues.avisar).toEqual([]);
  });

  it("con un evento abierto usa su cupo como umbral", () => {
    const cuentas = { porHora: [{ hora: iso(T0), nuevas: 61, activaciones: 0 }], completo: true };
    const r = vigilarCuentas({ cuentas: cuentas, base: 60, cupoEvento: 100, recordado: sinAviso });
    expect(r.avisar).toEqual([]);
    const arriba = vigilarCuentas({ cuentas: { porHora: [{ hora: iso(T0), nuevas: 101, activaciones: 0 }], completo: true }, base: 60, cupoEvento: 100, recordado: sinAviso });
    expect(arriba.avisar).toEqual([{ motivo: "cuentas-nuevas", hubo: 101, umbral: 100, hora: iso(T0) }]);
  });

  it("sin el bloque, o cuando no se entiende, no avisa", () => {
    expect(vigilarCuentas({ cuentas: null, ...umbrales, recordado: sinAviso }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas: { porHora: "no" }, ...umbrales, recordado: sinAviso }).avisar).toEqual([]);
  });
});

describe("mensajeDeCuentas: el texto en el patrón de los avisos", () => {
  it("dice qué pasó, el umbral y qué hacer; el asunto se entiende en la pantalla bloqueada", () => {
    const aviso = mensajeDeCuentas(
      { desbordados: [{ motivo: "cuentas-nuevas", hubo: 78, umbral: 60, hora: iso(T0) }], completo: false, hora: iso(T0) },
      { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" },
    );
    expect(aviso.asunto).toBe("Muchas cuentas nuevas en una hora");
    expect(aviso.texto).toContain("78");
    expect(aviso.texto).toContain("60");
    expect(aviso.texto).toContain("puede ser más");
    expect(aviso.texto).toContain("Qué hacer:");
    expect(aviso.texto).not.toMatch(/[;«“”—–·]/);
  });

  it("con los dos motivos, nombra los dos; el asunto como el de fila de la hoja", () => {
    const aviso = mensajeDeCuentas(
      {
        desbordados: [
          { motivo: "cuentas-nuevas", hubo: 61, umbral: 60, hora: iso(T0) },
          { motivo: "activaciones", hubo: 90, umbral: 60, hora: iso(T0) },
        ],
        completo: true,
        hora: iso(T0),
      },
      { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" },
    );
    expect(aviso.asunto).toBe("Muchas cuentas nuevas y activaciones en una hora");
    expect(aviso.texto).toContain("activaciones");
  });
});

describe("la vuelta con el conteo del portero: debajo de todo, un aviso y ni uno más", () => {
  /** Una ronda de guion: cuentas nuevas todas dentro de la hora corriente. */
  const conMovimientosArriba = (cuantos: number): unknown[] => Array.from({ length: cuantos }, (_, i) => cuenta(T0 + i * 1000));
  const desde = T0;
  const ahora = T0 + MINUTO;

  it("arriba del umbral manda un correo, dentro de la misma hora no repite y en la hora siguiente vuelve a avisar", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: bloqueCuentas(conMovimientosArriba(201), desde, ahora) }) });
    const r = await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]?.subject).toBe("Muchas cuentas nuevas en una hora");
    expect(r.avisos).toBe(1);
    expect((await m.memoria()).cuentasAviso).toEqual({ hora: iso(T0), motivos: ["cuentas-nuevas"] });
    // Una vuelta de más, dentro de la misma hora: ningún correo nuevo.
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    // Pasada la hora, con la cuenta del guion siguiendo: avisa otra vez, una sola en la hora nueva.
    m.portero.estado = estadoBien({
      cuentas: {
        porHora: [
          { hora: iso(T0), nuevas: 201, activaciones: 0 },
          { hora: iso(T0 + HORA), nuevas: 205, activaciones: 0 },
        ],
        completo: true,
      },
    });
    await m.vueltaEn(60);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("un evento de 150 personas que se anotan en la hora no dispara el aviso con el umbral de siempre", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: bloqueCuentas(conMovimientosArriba(150), desde, ahora) }) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
  });

  it("debajo del umbral no manda nada", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: bloqueCuentas(conMovimientosArriba(3), desde, ahora) }) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
  });

  it("con el cupo del evento puesto, el umbral es el cupo y no el de siempre", async () => {
    const m = mundoFalso({ env: { CUENTAS_EVENTO_CUPO: "300" }, estado: estadoBien({ cuentas: bloqueCuentas(conMovimientosArriba(201), desde, ahora) }) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
  });

  it("el estado de siempre, sin bloque de cuentas, no cambia nada: los avisos que ya existen quedan como están", async () => {
    const m = mundoFalso();
    const r = await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    expect(r.salioBien).toBe(true);
    expect((await m.memoria()).cuentasAviso).toBeNull();
  });

  it("con un bloque de cuentas que no se entiende, anota el error y no avisa nada", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: { porHora: "no" } }) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    expect(m.registro.some((l) => l.includes("error-cuentas"))).toBe(true);
  });
});

describe("la vuelta con el conteo del portero sin leer: el aviso no queda mudo sin rastro", () => {
  it("con el bloque en null (el proveedor de cuentas no contestó) anota el error y no avisa nada", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: null }) });
    const r = await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
    expect(r.salioBien).toBe(true);
    expect(m.registro.some((l) => l.includes("error-cuentas"))).toBe(true);
  });
});

describe("la vuelta con el conteo sin leer vuelta tras vuelta: ya no es solo un renglón del registro", () => {
  it("con el bloque en null dos vueltas seguidas manda un aviso propio, no repite y avisa cuando el conteo vuelve", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: null }) });
    await m.vuelta();
    // Una sola vez es un tropiezo: no se avisa.
    expect(m.correo.enviados).toEqual([]);
    expect((await m.memoria()).cuentasSinConteo).toBe(1);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]?.subject).toBe("No se están contando las cuentas nuevas");
    expect((await m.memoria()).cuentasSinConteo).toBe(2);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    m.portero.estado = estadoBien({ cuentas: bloqueCuentas([], T0 - HORA, T0 + 30 * MINUTO) });
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    expect(m.correo.enviados[1]?.text).toContain("volvió a contar las cuentas nuevas");
    expect((await m.memoria()).cuentasSinConteo).toBe(0);
  });

  it("un bloque que no se entiende cuenta igual, y un tropiezo suelto no deja nada", async () => {
    const raro = mundoFalso({ estado: estadoBien({ cuentas: { porHora: "no" } }) });
    await raro.vuelta();
    await raro.vueltaEn(10);
    expect(raro.correo.enviados.map((c) => c.subject)).toEqual(["No se están contando las cuentas nuevas"]);
    const suelto = mundoFalso({ estado: estadoBien({ cuentas: null }) });
    await suelto.vuelta();
    suelto.portero.estado = estadoBien({ cuentas: bloqueCuentas([], T0 - HORA, T0 + 30 * MINUTO) });
    await suelto.vueltaEn(10);
    suelto.portero.estado = estadoBien({ cuentas: null });
    await suelto.vueltaEn(10);
    expect(suelto.correo.enviados).toEqual([]);
    expect((await suelto.memoria()).cuentasSinConteo).toBe(1);
  });

  it("sin el bloque (un portero que no es el de mainnet) no cuenta como sin leer: el estado de siempre no avisa nada", async () => {
    const m = mundoFalso();
    await m.vuelta();
    await m.vueltaEn(10);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toEqual([]);
    expect((await m.memoria()).cuentasSinConteo).toBe(0);
  });
});

describe("lo que se documenta: los avisos nuevos tienen fila y las variables existen", () => {
  it("los dos motivos tienen su texto, y sin cifras raras en la de arriba del umbral", () => {
    expect(asuntoDeClave("desbordado:cuentas-nuevas")).toBeNull();
    expect(mensajeDeCuentas(
      { desbordados: [{ motivo: "activaciones", hubo: 65, umbral: 30, hora: iso(T0) }], completo: true, hora: iso(T0) },
      { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" },
    ).asunto).toBe("Muchas activaciones en una hora");
  });
});
