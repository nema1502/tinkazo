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

  it("cada motivo se cuenta aparte: con las activaciones arriba, avisa por ellas", () => {
    const r = vigilarCuentas({ cuentas: { porHora: [{ hora: iso(T0), nuevas: 1, activaciones: 75 }], completo: true }, ...umbrales, recordado: sinAviso });
    expect(r.avisar).toEqual([{ motivo: "activaciones", hubo: 75, umbral: 60, hora: iso(T0) }]);
  });

  it("los dos motivos arriba en la misma hora avisan juntos y quedan anotados los dos", () => {
    const cuentas = { porHora: [{ hora: iso(T0), nuevas: 61, activaciones: 61 }], completo: true };
    const r = vigilarCuentas({ cuentas: cuentas, ...umbrales, recordado: sinAviso });
    expect(r.avisar.map((a) => a.motivo)).toEqual(["cuentas-nuevas", "activaciones"]);
    const despues = vigilarCuentas({ cuentas: cuentas, ...umbrales, recordado: { hora: iso(T0), motivos: r.avisar.map((a) => a.motivo) } });
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

describe("lo que se documenta: los avisos nuevos tienen fila y las variables existen", () => {
  it("los dos motivos tienen su texto, y sin cifras raras en la de arriba del umbral", () => {
    expect(asuntoDeClave("desbordado:cuentas-nuevas")).toBeNull();
    expect(mensajeDeCuentas(
      { desbordados: [{ motivo: "activaciones", hubo: 65, umbral: 30, hora: iso(T0) }], completo: true, hora: iso(T0) },
      { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" },
    ).asunto).toBe("Muchas activaciones en una hora");
  });
});
