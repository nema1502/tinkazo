/**
 * Lo que el servicio de campañas guarda, en el SQLite de su objeto (#182): empresas con
 * identificadores opacos, campañas, eventos por ciudad, pasos, premios, quien organiza
 * cada evento y su estado, y las bases armadas con su huella. Ningún SQL queda afuera
 * de este archivo, para poder migrar el día que haga falta.
 *
 * Es código síncrono a propósito: un objeto de Cloudflare atiende de a uno mientras no haya un
 * `await` en el medio, así que guardar la campaña entera es una sola jugada. El reloj entra como
 * argumento (`ahora`, en ms): las pruebas lo corren a mano.
 */
import { huellaDeBases } from "../../../src/campana/huella-de-bases";
import type { Campana } from "../../../src/campana/modelo";

export interface Cursor {
  toArray(): Array<Record<string, unknown>>;
}
/** Lo que usa de `ctx.storage.sql` de un Durable Object (y de un SQLite de prueba). */
export interface Sql {
  exec(consulta: string, ...enlaces: unknown[]): Cursor;
  /** Todo o nada: `ctx.storage.transactionSync` en el objeto. Si `fn` lanza, no queda nada escrito. */
  transaccion<T>(fn: () => T): T;
}

const TABLAS = [
  // La empresa solo se conoce por su identificador opaco: sin nombres acá ni en el código.
  "CREATE TABLE IF NOT EXISTS empresas (id TEXT PRIMARY KEY, creado INTEGER NOT NULL)",
  // El evento de una campaña: lo que declara el archivo que la empresa cargó, con quien organiza y su estado.
  "CREATE TABLE IF NOT EXISTS campanas (evento TEXT PRIMARY KEY, empresa TEXT NOT NULL, cupo INTEGER NOT NULL, organizadora TEXT, estado TEXT NOT NULL, config TEXT NOT NULL, creado INTEGER NOT NULL, actualizada INTEGER NOT NULL)",
  // Los pasos y los premios, una fila por elemento, para contar y listar sin volver a leer el JSON.
  "CREATE TABLE IF NOT EXISTS pasos (evento TEXT NOT NULL, orden INTEGER NOT NULL, tipo TEXT NOT NULL, url TEXT, texto_es TEXT NOT NULL, texto_en TEXT NOT NULL, PRIMARY KEY (evento, orden))",
  "CREATE TABLE IF NOT EXISTS premios (evento TEXT NOT NULL, puesto INTEGER NOT NULL, monto TEXT NOT NULL, PRIMARY KEY (evento, puesto))",
  // Las bases armadas con los datos, publicadas con su huella: esa huella es la que va al depósito.
  "CREATE TABLE IF NOT EXISTS bases (evento TEXT PRIMARY KEY, documento TEXT NOT NULL, huella TEXT NOT NULL, publicado INTEGER NOT NULL)",
];

export function crearTablas(sql: Sql): void {
  for (const tabla of TABLAS) sql.exec(tabla);
}

/** Crea una empresa y devuelve su identificador opaco. */
export function guardarEmpresa(sql: Sql, id: string, ahora: number): void {
  sql.transaccion(() => sql.exec("INSERT INTO empresas (id, creado) VALUES (?, ?)", id, ahora));
}

/** Las bases armadas solas con los datos de la campaña: el documento que se publica y del que sale la huella. */
export function armarDocumento(campana: Campana): Record<string, unknown> {
  return {
    v: 1,
    evento: campana.evento,
    red: campana.red,
    empresa: campana.empresa.nombre,
    lugar: campana.lugar,
    zona: campana.zona,
    horas: { abreMs: campana.abreMs, cierraMs: campana.cierraMs, sorteoMs: campana.sorteoMs, recibirHastaMs: campana.recibirHastaMs },
    premios: campana.premios.map((monto) => monto.toString()),
    entrada: campana.entrada,
    texto: campana.bases,
  };
}

export interface AltaDeCampana {
  /** El cupo que decide el alta: cuántas personas admite el evento (una sala admite 300). */
  cupo: number;
  /** La cuenta de quien organiza el evento, si el alta la nombra. */
  organizadora: string | null;
  /** La configuración de la campaña, ya validada por `leerCampana`. */
  campana: Campana;
}

/** Qué guardó el alta: el evento, la huella de sus bases publicadas y quien organiza. */
export interface CampanaGuardada {
  evento: string;
  huellaBases: string;
  organizadora: string | null;
}

/** Por qué no se pudo guardar una campaña: el evento ya está cargado. */
export class EventoRepetido extends Error {}

/**
 * Guarda la campaña entera en una jugada: la campaña con su estado y su organizadora, los pasos,
 * los premios y las bases publicadas con su huella. Un evento repetido lanza `EventoRepetido`.
 */
export function guardarCampana(sql: Sql, empresa: string, alta: AltaDeCampana, ahora: number): CampanaGuardada {
  const { campana } = alta;
  const documento = armarDocumento(campana);
  const huella = huellaDeBases(documento);
  sql.transaccion(() => {
    if (sql.exec("select evento from campanas where evento = ?", campana.evento).toArray().length > 0) {
      throw new EventoRepetido(campana.evento);
    }
    sql.exec(
      "INSERT INTO campanas (evento, empresa, cupo, organizadora, estado, config, creado, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      campana.evento,
      empresa,
      alta.cupo,
      alta.organizadora,
      campana.estado,
      JSON.stringify(campana, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      ahora,
      ahora,
    );
    campana.pasos.forEach((paso, orden) => {
      sql.exec(
        "INSERT INTO pasos (evento, orden, tipo, url, texto_es, texto_en) VALUES (?, ?, ?, ?, ?, ?)",
        campana.evento,
        orden,
        paso.tipo,
        paso.url,
        paso.texto.es,
        paso.texto.en,
      );
    });
    campana.premios.forEach((monto, i) => {
      sql.exec("INSERT INTO premios (evento, puesto, monto) VALUES (?, ?, ?)", campana.evento, i + 1, monto.toString());
    });
    sql.exec(
      "INSERT INTO bases (evento, documento, huella, publicado) VALUES (?, ?, ?, ?)",
      campana.evento,
      JSON.stringify(documento),
      huella,
      ahora,
    );
  });
  return { evento: campana.evento, huellaBases: huella, organizadora: alta.organizadora };
}

/** La fila de una campaña guardada, para el informe y la invitación. */
export function leerCampanaGuardada(sql: Sql, evento: string): Record<string, unknown> | null {
  return sql.exec("select evento, empresa, cupo, organizadora, estado, config from campanas where evento = ?", evento).toArray()[0] ?? null;
}

/** El inventario de campañas: lo que `GET /v1/campanas` lista para el comprobante y las entregas (#176). */
export function leerInventario(sql: Sql): Array<Record<string, unknown>> {
  return sql
    .exec("select evento, empresa, cupo, organizadora, estado, config from campanas order by creado, evento")
    .toArray()
    .map((fila) => {
      const evento = String(fila["evento"]);
      const campana = JSON.parse(String(fila["config"])) as Campana;
      return {
        evento,
        empresa: fila["empresa"],
        red: campana.red,
        estado: fila["estado"],
        lugar: campana.lugar,
        zona: campana.zona,
        cupo: fila["cupo"],
        anotadas: campana.anotadas,
        organizadora: fila["organizadora"],
        horas: { abreMs: campana.abreMs, cierraMs: campana.cierraMs, sorteoMs: campana.sorteoMs, recibirHastaMs: campana.recibirHastaMs },
        premios: sql
          .exec("select puesto, monto from premios where evento = ? order by puesto", evento)
          .toArray()
          .map((p) => ({ puesto: p["puesto"], monto: p["monto"] })),
        // Lo que declaró el archivo de la campaña. La designación de contratos de premios queda
        // vacía hasta #167: este inventario dice qué declaró cada campaña, no qué contratos
        // acepta Tinkazo.
        contrato: campana.contrato,
        promo: campana.promo,
        huellaBases: sql.exec("select huella from bases where evento = ?", evento).toArray()[0]?.["huella"] ?? null,
      };
    });
}

/** Las bases publicadas de un evento, con su huella. Null si el evento no existe. */
export function leerBases(sql: Sql, evento: string): { documento: unknown; huella: string; publicado: number } | null {
  const fila = sql.exec("select documento, huella, publicado from bases where evento = ?", evento).toArray()[0];
  return fila ? { documento: JSON.parse(String(fila["documento"])), huella: String(fila["huella"]), publicado: Number(fila["publicado"]) } : null;
}

/**
 * El informe de cierre de un evento: cantidades, cuentas ganadoras y premios recibidos y por
 * recibir, sin la lista. De las entregas todavía no sabe nada: mientras el servicio de entregas
 * (#176) no le informe lo que recibió cada cuenta, el informe cuenta todas por recibir.
 */
export function armarInforme(sql: Sql, evento: string): Record<string, unknown> | null {
  const fila = leerCampanaGuardada(sql, evento);
  if (!fila) return null;
  const campana = JSON.parse(String(fila["config"])) as Campana;
  const cuantos = campana.premios.length;
  return {
    evento,
    estado: fila["estado"],
    cantidades: { anotadas: campana.anotadas, cupo: fila["cupo"] },
    ganadoras: cuantos,
    premios: { cuantos, recibidos: 0, porRecibir: cuantos },
  };
}
