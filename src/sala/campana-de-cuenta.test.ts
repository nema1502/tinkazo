import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import {
  MAX_BARRIDO,
  MAX_CAMPANAS_POR_CUENTA,
  anotarBarrido,
  barrerSalasViejas,
  crearTablasDeActivar,
  duenaDelEvento,
  eventoLibre,
  guardarCampanaDeCuenta,
  marcarEventoSellado,
  pendientesDeBarrido,
} from "../../workers/sala/src/activar-cupos";
import type { CampanaParaGuardar } from "../../workers/sala/src/activar-cupos";
import {
  confirmarEventoSql,
  crearTablaDeEventos,
  eventoYSorteoDelTexto,
  leerDatosDeLista,
  organizadoraDelTexto,
  reservarEventoSql,
} from "../../workers/sala/src/campana";
import type { Ejecutar } from "../../workers/sala/src/registro";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar, type MundoDeActivar } from "./activar-mundo";
import { firmarParaLaPrueba, personaDePrueba, type PersonaDePrueba } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));
/** Lo que el Worker lee del contrato al sellar: lo deja cada prueba. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * Tus campañas, el lado del servidor: de quién es cada evento, la lista que se guarda al activar y al crear la sala, los eventos
 * sellados y el barrido de las salas anteriores a la dueña. Un SQLite de verdad en memoria y, para lo que pasa por el Worker, la
 * activación entera con un Horizon, un portero y un proveedor de cuentas de mentira.
 */
const AHORA = HORA_DE_LA_PRUEBA;
const DIA = 86_400_000;
const EVENTO = "casa-andina-k7p2";
const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

/** El texto firmado de una campaña con todo lo que pide la lista. */
function texto(cambios: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    evento: EVENTO,
    red: "mainnet",
    estado: "abierta",
    empresa: { nombre: "Casa Andina", logo: null, color: "verde" },
    zona: "America/La_Paz",
    premios: ["500000000", "500000000"],
    abre_ms: AHORA,
    cierra_ms: AHORA + 3_600_000,
    sorteo_ms: AHORA + 7_200_000,
    organizadora: A,
    ...cambios,
  });
}

function campanaPara(cuenta: string, evento: string, cambios: Partial<CampanaParaGuardar> = {}): CampanaParaGuardar {
  return {
    cuenta,
    evento,
    texto: texto({ evento, organizadora: cuenta }),
    firma: "f".repeat(128),
    empresa: "Casa Andina",
    zona: "America/La_Paz",
    abreMs: AHORA,
    cierraMs: AHORA + 3_600_000,
    sorteoMs: AHORA + 7_200_000,
    ahora: AHORA,
    ...cambios,
  };
}

function baseNueva(): Ejecutar {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
  crearTablasDeActivar(sql);
  return sql;
}

describe("leerDatosDeLista", () => {
  it("lee la hora de abrir, la zona, la empresa y las horas del texto, y la cuenta si la nombra", () => {
    expect(leerDatosDeLista(texto())).toEqual({
      ok: true,
      evento: EVENTO,
      organizadora: A,
      empresa: "Casa Andina",
      zona: "America/La_Paz",
      abreMs: AHORA,
      cierraMs: AHORA + 3_600_000,
      sorteoMs: AHORA + 7_200_000,
    });
    expect(leerDatosDeLista(texto({ organizadora: undefined }))).toMatchObject({ ok: true, organizadora: null });
  });

  it("dice qué campo no sirvió: sin abre_ms, con una zona inventada, sin empresa o con un nombre que queda vacío", () => {
    expect(leerDatosDeLista(texto({ abre_ms: undefined }))).toEqual({ ok: false, campo: "abre_ms" });
    expect(leerDatosDeLista(texto({ abre_ms: 1.5 }))).toEqual({ ok: false, campo: "abre_ms" });
    expect(leerDatosDeLista(texto({ zona: "Marte/Olimpo" }))).toEqual({ ok: false, campo: "zona" });
    expect(leerDatosDeLista(texto({ zona: 7 }))).toEqual({ ok: false, campo: "zona" });
    expect(leerDatosDeLista(texto({ empresa: undefined }))).toEqual({ ok: false, campo: "empresa.nombre" });
    expect(leerDatosDeLista(texto({ empresa: { nombre: "​​" } }))).toEqual({ ok: false, campo: "empresa.nombre" });
    expect(leerDatosDeLista(texto({ evento: "A" }))).toEqual({ ok: false, campo: "evento" });
    expect(leerDatosDeLista(texto({ organizadora: "no-es-una-cuenta" }))).toEqual({ ok: false, campo: "organizadora" });
    expect(leerDatosDeLista("{")).toEqual({ ok: false, campo: "texto" });
  });

  it("limpia el nombre y lo corta a 60", () => {
    const r = leerDatosDeLista(texto({ empresa: { nombre: `  Casa ‮ Andina\n${"x".repeat(100)}` } }));
    expect(r.ok && r.empresa.length).toBeLessThanOrEqual(60);
    expect(r.ok && r.empresa.startsWith("Casa Andina x")).toBe(true);
  });

  it("no mira si el cierre ya pasó: una sala viva después del cierre sigue siendo de su cuenta", () => {
    expect(leerDatosDeLista(texto({ cierra_ms: 1000, sorteo_ms: 2000 }))).toMatchObject({ ok: true });
  });

  it("el evento y el sorteo salen del texto, y la cuenta también", () => {
    expect(eventoYSorteoDelTexto(texto())).toEqual({ evento: EVENTO, sorteoMs: AHORA + 7_200_000 });
    expect(eventoYSorteoDelTexto(texto({ sorteo_ms: "7" }))).toBeNull();
    expect(eventoYSorteoDelTexto(null)).toBeNull();
    expect(organizadoraDelTexto(texto())).toBe(A);
    expect(organizadoraDelTexto(texto({ organizadora: undefined }))).toBeNull();
    expect(organizadoraDelTexto("{")).toBeNull();
  });
});

describe("la lista de campañas de cada cuenta", () => {
  let sql: Ejecutar;
  beforeEach(() => {
    sql = baseNueva();
  });
  const filas = (): Record<string, unknown>[] => sql("SELECT * FROM campanas_de_cuenta ORDER BY evento");

  it("guardar dos veces la misma campaña es una sola fila, con lo último", () => {
    expect(guardarCampanaDeCuenta(sql, campanaPara(A, EVENTO))).toEqual({ ok: true });
    expect(guardarCampanaDeCuenta(sql, campanaPara(A, EVENTO, { empresa: "Otra", ahora: AHORA + 5 }))).toEqual({ ok: true });
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toMatchObject({ cuenta: A, evento: EVENTO, empresa: "Otra", zona: "America/La_Paz", abre_ms: AHORA, en_ms: AHORA + 5 });
  });

  it("vive hasta 30 días después de la hora del sorteo", () => {
    guardarCampanaDeCuenta(sql, campanaPara(A, EVENTO));
    expect(filas()[0]?.hasta_ms).toBe(AHORA + 7_200_000 + 30 * DIA);
  });

  it("una segunda cuenta para el mismo evento no se escribe y se le dice ajeno", () => {
    guardarCampanaDeCuenta(sql, campanaPara(A, EVENTO));
    expect(guardarCampanaDeCuenta(sql, campanaPara(B, EVENTO))).toEqual({ ok: false, motivo: "ajeno" });
    expect(filas().map((f) => f.cuenta)).toEqual([A]);
    // El índice único lo garantiza también por debajo.
    expect(() =>
      sql("INSERT INTO campanas_de_cuenta VALUES (?, ?, 't', 'f', 'e', 'z', 1, 1, 1, 1, 1)", B, EVENTO),
    ).toThrow();
  });

  it("lo vencido se borra al guardar y al preguntar de quién es un evento", () => {
    guardarCampanaDeCuenta(sql, campanaPara(A, "evento-uno"));
    guardarCampanaDeCuenta(sql, campanaPara(A, "evento-dos", { sorteoMs: AHORA + 20 * DIA }));
    sql("INSERT INTO tomas (evento, gen, huella_gen, ultima_ms) VALUES ('evento-uno', 1, 'h', 1)");
    const despues = AHORA + 7_200_000 + 30 * DIA + 1;
    expect(eventoLibre(sql, { cuenta: B, evento: "evento-uno", ahora: despues })).toBe(true);
    expect(filas().map((f) => f.evento)).toEqual(["evento-dos"]);
    expect(sql("SELECT * FROM tomas")).toHaveLength(0);
    // Y al guardar otra.
    const mucho = AHORA + 21 * DIA + 7_200_000 + 30 * DIA;
    guardarCampanaDeCuenta(sql, campanaPara(B, "evento-tres", { ahora: mucho, sorteoMs: mucho + DIA }));
    expect(filas().map((f) => f.evento)).toEqual(["evento-tres"]);
  });

  it("lo vencido de los eventos sellados también se borra", () => {
    marcarEventoSellado(sql, { evento: "evento-uno", sorteoMs: AHORA, ahora: AHORA });
    expect(sql("SELECT * FROM eventos_sellados")).toHaveLength(1);
    eventoLibre(sql, { cuenta: A, evento: "otro", ahora: AHORA + 30 * DIA + 1 });
    expect(sql("SELECT * FROM eventos_sellados")).toHaveLength(0);
  });

  it("la 51 borra la de sorteo más cercano, nunca la que se acaba de guardar", () => {
    for (let i = 1; i <= MAX_CAMPANAS_POR_CUENTA; i++) {
      guardarCampanaDeCuenta(sql, campanaPara(A, `evento-${String(i).padStart(2, "0")}`, { sorteoMs: AHORA + i * DIA }));
    }
    expect(filas()).toHaveLength(MAX_CAMPANAS_POR_CUENTA);
    sql("INSERT INTO tomas (evento, gen, huella_gen, ultima_ms) VALUES ('evento-01', 1, 'h', 1)");
    guardarCampanaDeCuenta(sql, campanaPara(A, "evento-nuevo", { sorteoMs: AHORA + 100 * DIA }));
    const eventos = filas().map((f) => f.evento);
    expect(eventos).toHaveLength(MAX_CAMPANAS_POR_CUENTA);
    expect(eventos).not.toContain("evento-01");
    expect(eventos).toContain("evento-02");
    expect(eventos).toContain("evento-nuevo");
    expect(sql("SELECT * FROM tomas")).toHaveLength(0);
    // Una campaña que sortea antes que todas las demás también se queda: se va otra.
    guardarCampanaDeCuenta(sql, campanaPara(A, "evento-temprano", { sorteoMs: AHORA + 1 }));
    expect(filas().map((f) => f.evento)).toContain("evento-temprano");
    expect(filas()).toHaveLength(MAX_CAMPANAS_POR_CUENTA);
  });

  it("otra cuenta tiene su propio tope de 50", () => {
    for (let i = 1; i <= MAX_CAMPANAS_POR_CUENTA; i++) guardarCampanaDeCuenta(sql, campanaPara(A, `evento-a${i}`));
    guardarCampanaDeCuenta(sql, campanaPara(B, "evento-b1"));
    expect(filas()).toHaveLength(MAX_CAMPANAS_POR_CUENTA + 1);
  });
});

describe("de quién es un evento", () => {
  let sql: Ejecutar;
  beforeEach(() => {
    sql = baseNueva();
  });

  it("sin dueña ni sala, de cualquiera", () => {
    expect(duenaDelEvento(sql, EVENTO)).toBeNull();
    expect(eventoLibre(sql, { cuenta: B, evento: EVENTO, ahora: AHORA })).toBe(true);
  });

  it("si activó una cuenta, es suyo y de nadie más", () => {
    guardarCampanaDeCuenta(sql, campanaPara(A, EVENTO));
    expect(duenaDelEvento(sql, EVENTO)).toBe(A);
    expect(eventoLibre(sql, { cuenta: A, evento: EVENTO, ahora: AHORA })).toBe(true);
    expect(eventoLibre(sql, { cuenta: B, evento: EVENTO, ahora: AHORA })).toBe(false);
  });

  it("la dueña de la sala manda sobre la que activó", () => {
    guardarCampanaDeCuenta(sql, campanaPara(A, EVENTO));
    const r = reservarEventoSql(sql, EVENTO, AHORA);
    expect(r.ok).toBe(true);
    if (r.ok) confirmarEventoSql(sql, EVENTO, { reserva: r.reserva, sala: "Sala0001", huella: "h", ahora: AHORA, organizadora: B });
    expect(duenaDelEvento(sql, EVENTO)).toBe(B);
  });

  it("una sala vieja sin dueña conocida ni revisar cuenta como ajena hasta que el barrido la mire", () => {
    sql("INSERT INTO eventos_campana (evento, dia, sala, huella, reserva, en_ms) VALUES (?, '2026-11-01', 'Sala0001', 'h', 'r', 1)", EVENTO);
    expect(eventoLibre(sql, { cuenta: A, evento: EVENTO, ahora: AHORA })).toBe(false);
    anotarBarrido(sql, { evento: EVENTO, sala: "Sala0001", ahora: AHORA, campana: null });
    expect(eventoLibre(sql, { cuenta: A, evento: EVENTO, ahora: AHORA })).toBe(true);
  });

  it("una reserva sin sala todavía no es de nadie", () => {
    reservarEventoSql(sql, EVENTO, AHORA);
    expect(eventoLibre(sql, { cuenta: B, evento: EVENTO, ahora: AHORA })).toBe(true);
  });
});

describe("la tabla de eventos de antes", () => {
  it("el ALTER suma las dos columnas a una tabla vieja con filas, sin perderlas", () => {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
    sql(
      "CREATE TABLE eventos_campana (evento TEXT PRIMARY KEY, dia TEXT NOT NULL, sala TEXT, huella TEXT, reserva TEXT NOT NULL, en_ms INTEGER NOT NULL)",
    );
    sql("INSERT INTO eventos_campana VALUES ('evento-uno', '2026-11-01', 'Sala0001', 'h1', 'r1', 100)");
    sql("INSERT INTO eventos_campana VALUES ('evento-dos', '2026-11-02', NULL, NULL, 'r2', 200)");
    crearTablasDeActivar(sql);
    const nombres = sql<{ name: string }>("PRAGMA table_info(eventos_campana)").map((c) => c.name);
    expect(nombres).toEqual(expect.arrayContaining(["duena", "revisada"]));
    expect(sql("SELECT evento, sala, huella, en_ms, duena, revisada FROM eventos_campana ORDER BY en_ms")).toEqual([
      { evento: "evento-uno", sala: "Sala0001", huella: "h1", en_ms: 100, duena: null, revisada: 0 },
      { evento: "evento-dos", sala: null, huella: null, en_ms: 200, duena: null, revisada: 0 },
    ]);
    // Volver a crear las tablas no cambia nada ni falla.
    crearTablasDeActivar(sql);
    crearTablaDeEventos(sql);
    expect(sql("SELECT COUNT(*) AS n FROM eventos_campana")[0]).toEqual({ n: 2 });
  });

  it("una tabla nueva ya nace con las dos columnas", () => {
    const sql = baseNueva();
    expect(sql<{ name: string }>("PRAGMA table_info(eventos_campana)").map((c) => c.name)).toEqual(
      expect.arrayContaining(["duena", "revisada"]),
    );
  });
});

describe("un evento sellado no se reabre", () => {
  it("con el token de la sala vieja o sin él, reservar da ya-existe", () => {
    const sql = baseNueva();
    const r = reservarEventoSql(sql, EVENTO, AHORA);
    if (!r.ok) throw new Error("no reservó");
    confirmarEventoSql(sql, EVENTO, { reserva: r.reserva, sala: "Sala0001", huella: "h1", ahora: AHORA });
    const conSuToken = { sala: "Sala0001", huella: "h1" };
    expect(reservarEventoSql(sql, EVENTO, AHORA + 1_000, conSuToken)).toMatchObject({ ok: true });
    // Después de sellar, ya no.
    marcarEventoSellado(sql, { evento: EVENTO, sorteoMs: AHORA + 7_200_000, ahora: AHORA });
    expect(reservarEventoSql(sql, EVENTO, AHORA + 2_000, conSuToken)).toEqual({ ok: false, motivo: "ya-existe", sala: "Sala0001" });
    expect(reservarEventoSql(sql, EVENTO, AHORA + 2_000)).toEqual({ ok: false, motivo: "ya-existe", sala: "Sala0001" });
  });

  it("sellar dos veces es lo mismo que una, y otro evento no se afecta", () => {
    const sql = baseNueva();
    marcarEventoSellado(sql, { evento: EVENTO, sorteoMs: AHORA, ahora: AHORA });
    marcarEventoSellado(sql, { evento: EVENTO, sorteoMs: AHORA, ahora: AHORA + 5 });
    expect(sql("SELECT evento, en_ms, hasta_ms FROM eventos_sellados")).toEqual([{ evento: EVENTO, en_ms: AHORA + 5, hasta_ms: AHORA + 30 * DIA }]);
    expect(reservarEventoSql(sql, "otro-evento", AHORA + 6)).toMatchObject({ ok: true });
  });
});

describe("el barrido de las salas anteriores a la dueña", () => {
  let sql: Ejecutar;
  beforeEach(() => {
    sql = baseNueva();
  });
  const sala = (n: number): string => `Sala${String(n).padStart(4, "0")}`;
  const evento = (n: number): string => `evento-${String(n).padStart(3, "0")}`;
  function salaVieja(n: number): void {
    sql("INSERT INTO eventos_campana (evento, dia, sala, huella, reserva, en_ms) VALUES (?, '2026-11-01', ?, 'h', 'r', ?)", evento(n), sala(n), n);
  }

  it("una sala viva con dueña escribe la dueña y la campaña de esa cuenta, y queda revisada", () => {
    salaVieja(1);
    const t = texto({ evento: evento(1) });
    anotarBarrido(sql, { evento: evento(1), sala: sala(1), ahora: AHORA, campana: { texto: t, firma: "f".repeat(128) } });
    expect(sql("SELECT duena, revisada FROM eventos_campana")).toEqual([{ duena: A, revisada: 1 }]);
    expect(sql("SELECT cuenta, evento, texto, empresa FROM campanas_de_cuenta")).toEqual([
      { cuenta: A, evento: evento(1), texto: t, empresa: "Casa Andina" },
    ]);
  });

  it("una sala muerta, o sin cuenta en su texto, solo queda revisada", () => {
    salaVieja(1);
    salaVieja(2);
    anotarBarrido(sql, { evento: evento(1), sala: sala(1), ahora: AHORA, campana: null });
    anotarBarrido(sql, {
      evento: evento(2),
      sala: sala(2),
      ahora: AHORA,
      campana: { texto: texto({ evento: evento(2), organizadora: undefined }), firma: "f" },
    });
    expect(sql("SELECT duena, revisada FROM eventos_campana ORDER BY evento")).toEqual([
      { duena: null, revisada: 1 },
      { duena: null, revisada: 1 },
    ]);
    expect(sql("SELECT * FROM campanas_de_cuenta")).toHaveLength(0);
  });

  it("un texto con otro evento no se cree: solo se marca revisada", () => {
    salaVieja(1);
    anotarBarrido(sql, { evento: evento(1), sala: sala(1), ahora: AHORA, campana: { texto: texto({ evento: evento(9) }), firma: "f" } });
    expect(sql("SELECT duena, revisada FROM eventos_campana")).toEqual([{ duena: null, revisada: 1 }]);
    expect(sql("SELECT * FROM campanas_de_cuenta")).toHaveLength(0);
  });

  it("una sala con dueña falta de datos para la lista deja la dueña y no la fila", () => {
    salaVieja(1);
    anotarBarrido(sql, {
      evento: evento(1),
      sala: sala(1),
      ahora: AHORA,
      campana: { texto: texto({ evento: evento(1), abre_ms: undefined }), firma: "f" },
    });
    expect(sql("SELECT duena, revisada FROM eventos_campana")).toEqual([{ duena: A, revisada: 1 }]);
    expect(sql("SELECT * FROM campanas_de_cuenta")).toHaveLength(0);
  });

  it("una sala que ya estaba sellada deja su evento anotado como sellado, aunque no nombre cuenta, y no se reemplaza", () => {
    salaVieja(1);
    salaVieja(2);
    const sellada = texto({ evento: evento(1) });
    anotarBarrido(sql, { evento: evento(1), sala: sala(1), ahora: AHORA, campana: { texto: sellada, firma: "f".repeat(128), sellada: true } });
    anotarBarrido(sql, { evento: evento(2), sala: sala(2), ahora: AHORA, campana: { texto: texto({ evento: evento(2), organizadora: undefined }), firma: "f", sellada: true } });
    expect(sql("SELECT evento, hasta_ms FROM eventos_sellados ORDER BY evento")).toEqual([
      { evento: evento(1), hasta_ms: JSON.parse(sellada).sorteo_ms + 30 * DIA },
      { evento: evento(2), hasta_ms: JSON.parse(texto({ evento: evento(2) })).sorteo_ms + 30 * DIA },
    ]);
  });

  it("una sala sin sellar no anota nada como sellado, y un texto de otro evento tampoco", () => {
    salaVieja(1);
    salaVieja(2);
    anotarBarrido(sql, { evento: evento(1), sala: sala(1), ahora: AHORA, campana: { texto: texto({ evento: evento(1) }), firma: "f".repeat(128), sellada: false } });
    anotarBarrido(sql, { evento: evento(2), sala: sala(2), ahora: AHORA, campana: { texto: texto({ evento: evento(9) }), firma: "f", sellada: true } });
    expect(sql("SELECT * FROM eventos_sellados")).toHaveLength(0);
  });

  it("no pasa de 10 por pedido y lo que falla queda pendiente", async () => {
    for (let n = 1; n <= 13; n++) salaVieja(n);
    const vistas: string[] = [];
    const puerto = {
      pendientes: async () => pendientesDeBarrido(sql),
      campana: async (s: string) => {
        vistas.push(s);
        if (s === sala(13) || s === sala(12)) throw new Error("la sala no contesta");
        return null;
      },
      anotar: async (e: string, s: string, c: { texto: string; firma: string; sellada: boolean } | null) => anotarBarrido(sql, { evento: e, sala: s, campana: c, ahora: AHORA }),
    };
    expect(MAX_BARRIDO).toBe(10);
    // Las 10 más nuevas (el orden es de la más reciente) y dos de ellas fallan.
    const primera = await barrerSalasViejas(puerto);
    expect(vistas).toHaveLength(10);
    expect(primera).toBe(8);
    expect(sql("SELECT COUNT(*) AS n FROM eventos_campana WHERE revisada = 1")[0]).toEqual({ n: 8 });
    // El segundo pedido toma lo que falta y reintenta lo que falló.
    vistas.length = 0;
    await barrerSalasViejas({ ...puerto, campana: async (s) => (vistas.push(s), null) });
    expect(vistas.sort()).toEqual([sala(1), sala(2), sala(3), sala(12), sala(13)].sort());
    expect(sql("SELECT COUNT(*) AS n FROM eventos_campana WHERE revisada = 0")[0]).toEqual({ n: 0 });
  });

  it("las reservas sin sala y las salas con dueña no se barren", () => {
    reservarEventoSql(sql, "reserva-sola", AHORA);
    sql("INSERT INTO eventos_campana (evento, dia, sala, huella, reserva, en_ms, duena) VALUES ('con-duena', '2026-11-01', 'Sala0009', 'h', 'r', 1, ?)", A);
    expect(pendientesDeBarrido(sql)).toEqual([]);
  });
});

describe("la lista y la dueña en el Worker entero", () => {
  let m: MundoDeActivar;
  let b: PersonaDePrueba;
  const cuentas = (): unknown[] => m.mundo.ejecutar("cupos", "SELECT cuenta, evento, empresa, zona, abre_ms, hasta_ms, texto, firma FROM campanas_de_cuenta ORDER BY evento");

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HORA_DE_LA_PRUEBA);
    m = await montarMundoDeActivar();
    b = personaDePrueba(m.mundo, 2);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedido = (cambios: Record<string, unknown> = {}, sesion: string = m.organizadora.token) => ({
    texto: JSON.stringify(m.campana(cambios)),
    sesion,
  });
  const activarPagada = (cambios: Record<string, unknown> = {}): Promise<Response> => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    return m.activar(pedido(cambios));
  };
  /** Crea la sala con un archivo firmado a mano, como se hacía antes de activar sola. */
  async function crearSala(cambios: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
    const r = await m.mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana(cambios)) });
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string; token: string };
  }

  it("activar guarda la campaña de la cuenta con lo que necesita la lista, y repetir no suma una fila", async () => {
    const r = await activarPagada();
    expect(r.status).toBe(200);
    const firmada = (await r.json()) as { texto: string; firma: string };
    expect(cuentas()).toEqual([
      {
        cuenta: m.organizadora.cuenta,
        evento: EVENTO,
        empresa: "Casa Andina",
        zona: "America/La_Paz",
        abre_ms: HORA_DE_LA_PRUEBA,
        hasta_ms: HORA_DE_LA_PRUEBA + 7_200_000 + 30 * DIA,
        texto: firmada.texto,
        firma: firmada.firma,
      },
    ]);
    expect((await activarPagada()).status).toBe(200);
    expect(cuentas()).toHaveLength(1);
  });

  it("un evento de otra cuenta da 409 evento-ajeno antes de mirar la red, sin portero y sin gastar su lugar del día", async () => {
    expect((await activarPagada()).status).toBe(200);
    const pedidosDeRed = m.horizon.paginasPedidas;
    const llamadasAlPortero = m.portero.llamadas.length;
    const delOtra = m.campana({ organizadora: b.cuenta });
    m.horizon.pagos = [m.pagoCompleto(EVENTO), m.pagoCompleto(EVENTO, { from: b.cuenta })];
    const r = await m.activar({ texto: JSON.stringify(delOtra), sesion: b.token });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "evento-ajeno" });
    expect(m.horizon.paginasPedidas).toBe(pedidosDeRed);
    expect(m.portero.llamadas).toHaveLength(llamadasAlPortero);
    expect(m.mundo.ejecutar("cupos", "SELECT * FROM activar_cuenta WHERE evento = ?", EVENTO)).toHaveLength(1);
    expect((cuentas() as { cuenta: string }[]).map((c) => c.cuenta)).toEqual([m.organizadora.cuenta]);
    // La dueña sigue pudiendo.
    expect((await activarPagada()).status).toBe(200);
  });

  it("un evento con sala de otra cuenta tampoco se activa", async () => {
    await crearSala();
    const delOtra = m.campana({ organizadora: b.cuenta });
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: b.cuenta })];
    const r = await m.activar({ texto: JSON.stringify(delOtra), sesion: b.token });
    expect(r.status).toBe(409);
    expect(m.horizon.paginasPedidas).toBe(0);
  });

  it("un texto sin hora de abrir o con una zona inventada se firma igual y no escribe la fila", async () => {
    const sinAbrir = await activarPagada({ abre_ms: undefined });
    expect(sinAbrir.status).toBe(200);
    expect(cuentas()).toHaveLength(0);
    const zona = await activarPagada({ zona: "Marte/Olimpo" });
    expect(zona.status).toBe(200);
    expect(cuentas()).toHaveLength(0);
    const sinNombre = await activarPagada({ empresa: { nombre: "​", logo: null, color: "verde" } });
    expect(sinNombre.status).toBe(200);
    expect(cuentas()).toHaveLength(0);
    // Con todo, sí.
    expect((await activarPagada()).status).toBe(200);
    expect(cuentas()).toHaveLength(1);
  });

  it("una sala creada con un archivo firmado que nombra a su cuenta deja la dueña y la fila, ya revisada", async () => {
    const sala = await crearSala();
    expect(m.mundo.ejecutar("cupos", "SELECT evento, sala, duena, revisada FROM eventos_campana")).toEqual([
      { evento: EVENTO, sala: sala.id, duena: m.organizadora.cuenta, revisada: 1 },
    ]);
    expect(cuentas()).toHaveLength(1);
  });

  it("una sala sin cuenta en su texto queda sin dueña y sin fila, pero ya revisada", async () => {
    await crearSala({ organizadora: undefined });
    expect(m.mundo.ejecutar("cupos", "SELECT duena, revisada FROM eventos_campana")).toEqual([{ duena: null, revisada: 1 }]);
    expect(cuentas()).toHaveLength(0);
  });

  it("el barrido de una sala de antes escribe la dueña y la fila, y entonces otra cuenta no puede activar", async () => {
    await crearSala();
    // Como estaba antes de esta versión: sin dueña, sin revisar y sin lista.
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 0");
    m.mundo.ejecutar("cupos", "DELETE FROM campanas_de_cuenta");
    const delOtra = m.campana({ organizadora: b.cuenta });
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: b.cuenta })];
    const r = await m.activar({ texto: JSON.stringify(delOtra), sesion: b.token });
    expect(r.status).toBe(409);
    expect(m.horizon.paginasPedidas).toBe(0);
    expect(m.mundo.ejecutar("cupos", "SELECT duena, revisada FROM eventos_campana")).toEqual([{ duena: m.organizadora.cuenta, revisada: 1 }]);
    expect((cuentas() as { cuenta: string }[]).map((c) => c.cuenta)).toEqual([m.organizadora.cuenta]);
    // Y la dueña activa sin trabas.
    expect((await activarPagada()).status).toBe(200);
  });

  it("el barrido de una sala de antes que ya murió deja el evento como estaba: lo puede activar otra cuenta", async () => {
    const sala = await crearSala();
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 0");
    m.mundo.ejecutar("cupos", "DELETE FROM campanas_de_cuenta");
    const cierre = await m.mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: { Authorization: `Bearer ${sala.token}` } });
    expect(cierre.status).toBe(204);
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: b.cuenta })];
    const r = await m.activar({ texto: JSON.stringify(m.campana({ organizadora: b.cuenta })), sesion: b.token });
    expect(r.status).toBe(200);
    expect(m.mundo.ejecutar("cupos", "SELECT revisada FROM eventos_campana")).toEqual([{ revisada: 1 }]);
  });

  it("cada pedido de activar revisa a lo sumo 10 salas viejas", async () => {
    for (let n = 1; n <= 12; n++) {
      m.mundo.ejecutar(
        "cupos",
        "INSERT INTO eventos_campana (evento, dia, sala, huella, reserva, en_ms) VALUES (?, '2026-11-01', ?, 'h', 'r', ?)",
        `evento-viejo-${n}`,
        `SinSala${String(n).padStart(2, "0")}`,
        n,
      );
    }
    expect((await activarPagada()).status).toBe(200);
    expect(m.mundo.ejecutar("cupos", "SELECT COUNT(*) AS n FROM eventos_campana WHERE revisada = 1")[0]).toEqual({ n: 10 });
    expect((await activarPagada()).status).toBe(200);
    expect(m.mundo.ejecutar("cupos", "SELECT COUNT(*) AS n FROM eventos_campana WHERE revisada = 1")[0]).toEqual({ n: 12 });
  });

  describe("al sellar", () => {
    const RONDA = 40_000_000;
    const SORTEO = "7";

    async function selladaLaSala(): Promise<{ id: string; token: string }> {
      const sala = await crearSala();
      const auth = { Authorization: `Bearer ${sala.token}` };
      const persona = personaDePrueba(m.mundo, 5);
      const alta = await m.mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth });
      expect(alta.status).toBe(204);
      const anotada = await m.mundo.pedir(`/v1/sala/${sala.id}/campana/alta`, {
        cuerpo: { token: persona.token, d: "A".repeat(60), llave: persona.llave },
        cabeceras: { "CF-Connecting-IP": "190.129.10.20" },
      });
      expect(anotada.status).toBe(201);
      const cerrada = await m.mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth });
      expect(cerrada.status).toBe(204);
      lectura.valor = {
        sello: {
          listHash: createHash("sha256").update("x").digest("hex"),
          count: 1,
          numWinners: 2,
          sorteado: false,
          organizador: m.organizadora.cuenta,
          ronda: RONDA,
        },
        ganadores: null,
      };
      const lista = [persona.cuenta];
      (lectura.valor as { sello: { listHash: string } }).sello.listHash = Buffer.from(listHash(lista)).toString("hex");
      const sellada = await m.mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
        metodo: "PUT",
        cuerpo: { fase: "sellada", sorteo: SORTEO },
        cabeceras: auth,
      });
      expect(sellada.status).toBe(204);
      return sala;
    }

    it("el evento queda sellado hasta 30 días después de la hora del sorteo del texto, no de la clave sorteo de la sala", async () => {
      const sala = await selladaLaSala();
      expect(m.mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'sorteo'")).toEqual([{ v: SORTEO }]);
      const sellados = m.mundo.ejecutar("cupos", "SELECT evento, en_ms, hasta_ms FROM eventos_sellados");
      expect(sellados).toEqual([{ evento: EVENTO, en_ms: HORA_DE_LA_PRUEBA, hasta_ms: HORA_DE_LA_PRUEBA + 7_200_000 + 30 * DIA }]);
    });

    it("con la sala sellada y cerrada, reemplazarla con su propio token da ya-existe", async () => {
      const sala = await selladaLaSala();
      const cierre = await m.mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: { Authorization: `Bearer ${sala.token}` } });
      expect(cierre.status).toBe(204);
      const otra = await m.mundo.pedir("/v1/campana", {
        cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana()),
        cabeceras: { Authorization: `Bearer ${sala.token}` },
      });
      expect(otra.status).toBe(409);
      expect(await otra.json()).toEqual({ error: "ya-existe" });
    });

    it("sin sellar, la sala cerrada sí se reemplaza con su token", async () => {
      const sala = await crearSala();
      await m.mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: { Authorization: `Bearer ${sala.token}` } });
      const otra = await m.mundo.pedir("/v1/campana", {
        cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana()),
        cabeceras: { Authorization: `Bearer ${sala.token}` },
      });
      expect(otra.status).toBe(201);
    });
  });
});
