// El aviso por las cuentas nuevas por hora (issue 177): el umbral configurable, la alternativa del evento abierto con su
// cupo, un solo aviso por oleada (nada de repetirlo durante 60 minutos) y los textos en el patrón de los avisos del
// vigilante. El portero manda las cuentas de los últimos 60 minutos corridos, ya contadas por el proveedor.
// Todo con bloques simulados y el mundo de mentira: ninguna prueba toca una red.
import { describe, expect, it } from "vitest";
import { asuntoDeClave, mensajeDeCuentas } from "./mensaje";
import { estadoBien, HORA, MINUTO, T0, mundoFalso } from "./mundo-falso";
import { CUENTAS_UMBRAL_POR_DEFECTO, VENTANA_CUENTAS_MINUTOS, cuentasDelEstado, umbralDeCuentas, vigilarCuentas } from "./cuentas";

const iso = (ms: number) => new Date(ms).toISOString();
/** Un bloque `cuentas` como el que manda el portero en `/estado`. */
const bloque = (nuevas: number, activaciones = 0): Record<string, unknown> => ({ minutos: 60, nuevas, activaciones });

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

describe("cuentasDelEstado: lo que el portero manda del conteo de los últimos 60 minutos", () => {
  it("lee el bloque como viene y no se inventa nada con lo que falta", () => {
    expect(VENTANA_CUENTAS_MINUTOS).toBe(60);
    expect(cuentasDelEstado({ cuentas: bloque(7, 2) })).toEqual({ nuevas: 7, activaciones: 2 });
    expect(cuentasDelEstado({ cuentas: bloque(0, 0) })).toEqual({ nuevas: 0, activaciones: 0 });
    expect(cuentasDelEstado(estadoBien())).toBeNull();
    expect(cuentasDelEstado({ cuentas: null })).toBeNull();
    expect(cuentasDelEstado({ cuentas: "no" })).toBeNull();
    expect(cuentasDelEstado({ cuentas: [] })).toBeNull();
    expect(cuentasDelEstado({ cuentas: { porHora: [3] } })).toBeNull();
    expect(cuentasDelEstado(null)).toBeNull();
  });

  it("un campo que no es un entero seguro mayor o igual a cero invalida el bloque entero: sin conteo, no un cero", () => {
    for (const malo of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "7", null, undefined, true]) {
      expect(cuentasDelEstado({ cuentas: { minutos: 60, nuevas: malo, activaciones: 0 } }), `nuevas ${String(malo)}`).toBeNull();
      expect(cuentasDelEstado({ cuentas: { minutos: 60, nuevas: 3, activaciones: malo } }), `activaciones ${String(malo)}`).toBeNull();
    }
  });

  it("un bloque de otra ventana no se lee como si fuera de 60 minutos", () => {
    for (const minutos of [30, 61, 1440, "60", null, undefined]) expect(cuentasDelEstado({ cuentas: { minutos, nuevas: 3, activaciones: 0 } }), String(minutos)).toBeNull();
  });
});

describe("vigilarCuentas: debajo del umbral no avisa y arriba avisa una sola vez por oleada", () => {
  const umbrales = { base: 60, cupoEvento: null as number | null };
  const T = T0;

  it("debajo del umbral, o justo en él, no avisa", () => {
    expect(vigilarCuentas({ cuentas: bloque(59, 2), ...umbrales, ahoraMs: T, recordado: {} })).toEqual({ avisar: [], conDatos: true });
    expect(vigilarCuentas({ cuentas: bloque(60), ...umbrales, ahoraMs: T, recordado: {} }).avisar).toEqual([]);
  });

  it("pasando el umbral avisa, con la cifra exacta de la ventana", () => {
    const r = vigilarCuentas({ cuentas: bloque(61), ...umbrales, ahoraMs: T, recordado: {} });
    expect(r).toEqual({ avisar: [{ motivo: "cuentas-nuevas", hubo: 61, umbral: 60 }], conDatos: true });
  });

  it("después de avisar no repite durante 60 minutos, cambie o no la hora de reloj", () => {
    const recordado = { "cuentas-nuevas": iso(T) };
    // Cruza una hora de reloj entera (de las 9:50 a las 10:05): sigue siendo la misma oleada.
    const desde = T0 + 50 * MINUTO;
    const avisado = { "cuentas-nuevas": iso(desde) };
    expect(vigilarCuentas({ cuentas: bloque(500), ...umbrales, ahoraMs: desde + 15 * MINUTO, recordado: avisado }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas: bloque(500), ...umbrales, ahoraMs: T + 59 * MINUTO + 59_000, recordado }).avisar).toEqual([]);
    // Pasados los 60 minutos, si sigue arriba, es un recordatorio.
    expect(vigilarCuentas({ cuentas: bloque(500), ...umbrales, ahoraMs: T + HORA, recordado }).avisar).toHaveLength(1);
  });

  it("un aviso con fecha en el futuro (un reloj que volvió atrás) no calla para siempre", () => {
    expect(vigilarCuentas({ cuentas: bloque(500), ...umbrales, ahoraMs: T, recordado: { "cuentas-nuevas": iso(T + 5 * HORA) } }).avisar).toHaveLength(1);
  });

  it("las activaciones no avisan hasta que se confirme el nombre de su cobro: por defecto el aviso de activaciones está apagado", () => {
    expect(vigilarCuentas({ cuentas: bloque(1, 500), ...umbrales, ahoraMs: T, recordado: {} }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas: bloque(61, 500), ...umbrales, ahoraMs: T, recordado: {} }).avisar.map((a) => a.motivo)).toEqual(["cuentas-nuevas"]);
  });

  it("con las activaciones prendidas cada motivo se cuenta aparte y se recuerda aparte", () => {
    const r = vigilarCuentas({ cuentas: bloque(1, 75), ...umbrales, conActivaciones: true, ahoraMs: T, recordado: {} });
    expect(r.avisar).toEqual([{ motivo: "activaciones", hubo: 75, umbral: 60 }]);
    const juntas = vigilarCuentas({ cuentas: bloque(61, 61), ...umbrales, conActivaciones: true, ahoraMs: T, recordado: {} });
    expect(juntas.avisar.map((a) => a.motivo)).toEqual(["cuentas-nuevas", "activaciones"]);
    // Las cuentas nuevas se avisaron hace 10 minutos y las activaciones recién ahora: cada una espera lo suyo.
    const mezcla = vigilarCuentas({ cuentas: bloque(61, 61), ...umbrales, conActivaciones: true, ahoraMs: T + 10 * MINUTO, recordado: { "cuentas-nuevas": iso(T) } });
    expect(mezcla.avisar.map((a) => a.motivo)).toEqual(["activaciones"]);
  });

  it("con un evento abierto usa su cupo como umbral", () => {
    expect(vigilarCuentas({ cuentas: bloque(61), base: 60, cupoEvento: 100, ahoraMs: T, recordado: {} }).avisar).toEqual([]);
    expect(vigilarCuentas({ cuentas: bloque(101), base: 60, cupoEvento: 100, ahoraMs: T, recordado: {} }).avisar).toEqual([{ motivo: "cuentas-nuevas", hubo: 101, umbral: 100 }]);
  });

  it("sin el bloque, o cuando no se entiende, no avisa y dice que no hay datos", () => {
    expect(vigilarCuentas({ cuentas: null, ...umbrales, ahoraMs: T, recordado: {} })).toEqual({ avisar: [], conDatos: false });
    expect(vigilarCuentas({ cuentas: { minutos: 60, nuevas: -4, activaciones: 0 }, ...umbrales, ahoraMs: T, recordado: {} })).toEqual({ avisar: [], conDatos: false });
  });
});

describe("mensajeDeCuentas: el texto en el patrón de los avisos", () => {
  it("dice qué pasó, el umbral y qué hacer; el asunto se entiende en la pantalla bloqueada", () => {
    const aviso = mensajeDeCuentas(
      { desbordados: [{ motivo: "cuentas-nuevas", hubo: 78, umbral: 60 }] },
      { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" },
    );
    expect(aviso.asunto).toBe("Muchas cuentas nuevas en una hora");
    expect(aviso.texto).toContain("78");
    expect(aviso.texto).toContain("60");
    expect(aviso.texto).toContain("Qué hacer:");
    // La cifra es exacta: ningún "puede ser más" por una lista cortada.
    expect(aviso.texto).not.toContain("puede ser más");
    expect(aviso.texto).not.toMatch(/[;«“”—–·]/);
  });

  it("con los dos motivos, nombra los dos; el asunto como el de fila de la hoja", () => {
    const aviso = mensajeDeCuentas(
      {
        desbordados: [
          { motivo: "cuentas-nuevas", hubo: 61, umbral: 60 },
          { motivo: "activaciones", hubo: 90, umbral: 60 },
        ],
      },
      { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" },
    );
    expect(aviso.asunto).toBe("Muchas cuentas nuevas y activaciones en una hora");
    expect(aviso.texto).toContain("activaciones");
  });
});

describe("la vuelta con el conteo del portero: debajo de todo, un aviso por oleada y ni uno más", () => {
  it("arriba del umbral manda un correo, no repite durante 60 minutos aunque cambie la hora de reloj, y pasados los 60 recuerda", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: bloque(201) }) });
    const r = await m.vuelta();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]?.subject).toBe("Muchas cuentas nuevas en una hora");
    expect(r.avisos).toBe(1);
    expect((await m.memoria()).cuentasAviso).toEqual({ "cuentas-nuevas": iso(T0) });
    // Vueltas cada 10 minutos, cruzando la hora de reloj (las 9:00 pasan a las 10:00): la misma oleada, ningún correo nuevo.
    for (let i = 0; i < 5; i++) await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(1);
    // A los 60 minutos justos del aviso, si sigue arriba, vuelve a avisar una vez.
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("un evento de 150 personas que se anotan en la hora no dispara el aviso con el umbral de siempre", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: bloque(150) }) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
  });

  it("debajo del umbral no manda nada", async () => {
    const m = mundoFalso({ estado: estadoBien({ cuentas: bloque(3) }) });
    await m.vuelta();
    expect(m.correo.enviados).toEqual([]);
  });

  it("con el cupo del evento puesto, el umbral es el cupo y no el de siempre", async () => {
    const m = mundoFalso({ env: { CUENTAS_EVENTO_CUPO: "300" }, estado: estadoBien({ cuentas: bloque(201) }) });
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
    const m = mundoFalso({ estado: estadoBien({ cuentas: { minutos: 60, nuevas: -1, activaciones: 0 } }) });
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
    m.portero.estado = estadoBien({ cuentas: bloque(0) });
    await m.vueltaEn(10);
    expect(m.correo.enviados).toHaveLength(2);
    expect(m.correo.enviados[1]?.text).toContain("volvió a contar las cuentas nuevas");
    expect((await m.memoria()).cuentasSinConteo).toBe(0);
  });

  it("un bloque que no se entiende cuenta igual, y un tropiezo suelto no deja nada", async () => {
    const raro = mundoFalso({ estado: estadoBien({ cuentas: { minutos: 60, nuevas: 1.5, activaciones: 0 } }) });
    await raro.vuelta();
    await raro.vueltaEn(10);
    expect(raro.correo.enviados.map((c) => c.subject)).toEqual(["No se están contando las cuentas nuevas"]);
    const suelto = mundoFalso({ estado: estadoBien({ cuentas: null }) });
    await suelto.vuelta();
    suelto.portero.estado = estadoBien({ cuentas: bloque(0) });
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
    expect(
      mensajeDeCuentas({ desbordados: [{ motivo: "activaciones", hubo: 65, umbral: 30 }] }, { estado: estadoBien(), ahora: new Date(T0), portero: "https://pm.tinkazo.app" }).asunto,
    ).toBe("Muchas activaciones en una hora");
  });
});
