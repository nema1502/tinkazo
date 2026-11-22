/**
 * Los topes de la activación de campañas y la lista de Tus campañas, en SQL sobre el objeto `Cupos` (que es donde los topes son
 * exactos). No dependen de Cloudflare: se prueban en Node con un SQLite en memoria.
 *
 * Qué se guarda de quien organiza: la sesión y la dirección nunca van en claro (los topes guardan una huella con sal de la hora).
 * Los topes diarios de la activación guardan la cuenta como huella con sal del día. Pero la lista de Tus campañas
 * (`campanas_de_cuenta`) guarda la cuenta en claro junto con el texto firmado de su campaña, hasta 30 días después del sorteo:
 * el texto ya trae la cuenta escrita y una huella no escondería nada. Los topes por cuenta de Tus campañas también la guardan en
 * claro, solo una ventana de 10 minutos.
 *
 * - Por conexión y por ventana de 10 minutos: los pedidos que cuestan una mirada a la red, y las sesiones que el proveedor
 *   rechazó (con los mismos números que el alta de quien participa).
 * - Por sesión: cuántas veces se rechazó la misma ficha. Repetir una ficha mala no llama a nadie.
 * - Por cuenta y por día: las campañas distintas que se activaron. Repetir el mismo evento no suma, así que reintentar un
 *   pedido que falló (la red, el portero) no gasta lugar.
 */
import { ACTIVACIONES_POR_DIA, ACTIVAR_POR_CONEXION, CUENTA_POR_CONEXION, LISTADOS_POR_CUENTA, TOMAS_POR_CUENTA } from "./activar";
import {
  DIAS_DE_LA_LISTA,
  RECHAZOS_POR_CONEXION,
  RECHAZOS_POR_FICHA,
  VENTANA_CAMPANA_MS,
  crearTablaDeEventos,
  eventoYSorteoDelTexto,
  leerDatosDeLista,
  organizadoraDelTexto,
} from "./campana";
import type { Ejecutar } from "./registro";

/** Las tablas de los topes y de la lista de Tus campañas. Se crean junto con las demás del objeto. */
export function crearTablasDeActivar(sql: Ejecutar): void {
  // La tabla de eventos, con sus columnas nuevas, antes que nada: el listado y la activación nunca tocan una que no existe.
  crearTablaDeEventos(sql);
  // Tus campañas: una fila por cuenta y evento, y un evento tiene una sola cuenta (el índice único lo hace imposible de otra forma).
  sql(
    "CREATE TABLE IF NOT EXISTS campanas_de_cuenta (cuenta TEXT NOT NULL, evento TEXT NOT NULL, texto TEXT NOT NULL, firma TEXT NOT NULL, " +
      "empresa TEXT NOT NULL, zona TEXT NOT NULL, abre_ms INTEGER NOT NULL, cierra_ms INTEGER NOT NULL, sorteo_ms INTEGER NOT NULL, " +
      "en_ms INTEGER NOT NULL, hasta_ms INTEGER NOT NULL, PRIMARY KEY (cuenta, evento))",
  );
  sql("CREATE UNIQUE INDEX IF NOT EXISTS campanas_de_cuenta_evento ON campanas_de_cuenta (evento)");
  sql("CREATE INDEX IF NOT EXISTS campanas_de_cuenta_hasta ON campanas_de_cuenta (hasta_ms)");
  // Las tomas de cada evento: la generación ordena dos tomas a la vez y la hora de la última da la pausa entre una y otra.
  sql(
    "CREATE TABLE IF NOT EXISTS tomas (evento TEXT PRIMARY KEY, gen INTEGER NOT NULL, huella_gen TEXT NOT NULL, " +
      "ultima_ms INTEGER NOT NULL, correo_ms INTEGER NOT NULL DEFAULT 0)",
  );
  const porVentana = "(grupo TEXT NOT NULL, ventana INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (grupo, ventana))";
  sql(`CREATE TABLE IF NOT EXISTS activar_ritmo ${porVentana}`);
  sql(`CREATE TABLE IF NOT EXISTS activar_rechazos ${porVentana}`);
  sql("CREATE TABLE IF NOT EXISTS activar_ficha (ficha TEXT NOT NULL, ventana INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ficha, ventana))");
  sql("CREATE TABLE IF NOT EXISTS activar_cuenta (cuenta TEXT NOT NULL, dia TEXT NOT NULL, evento TEXT NOT NULL, PRIMARY KEY (cuenta, dia, evento))");
  sql("CREATE TABLE IF NOT EXISTS activar_nota (nota TEXT PRIMARY KEY, evento TEXT NOT NULL, hasta INTEGER NOT NULL)");
  // Los listados y las tomas de cada cuenta por ventana de 10 minutos, para las rutas de Tus campañas.
  sql(`CREATE TABLE IF NOT EXISTS cuenta_ritmo ${porVentana}`);
}

/** Cuánto queda tomada la nota de un evento: más que los 30 días en que cuenta un pago, así un pago viejo nunca sirve a otro. */
export const DIAS_DE_LA_NOTA = 31;

/**
 * Toma la nota de la comisión para este evento. La nota sale de una huella del evento con unas 50 cifras binarias: con
 * millones de nombres se pueden encontrar dos eventos con la misma nota, y un solo pago activaría los dos. La primera
 * activación pagada se queda con la nota por 31 días; otro evento con la misma nota no se activa con ese pago. El mismo
 * evento siempre la vuelve a tomar. No guarda nada personal: la nota y el evento ya son públicos en la red y en la sala.
 */
export function tomarNota(sql: Ejecutar, a: { nota: string; evento: string; ahora: number }): boolean {
  sql("DELETE FROM activar_nota WHERE hasta < ?", a.ahora);
  const duena = sql<{ evento: string }>("SELECT evento FROM activar_nota WHERE nota = ?", a.nota)[0];
  if (duena !== undefined) return duena.evento === a.evento;
  sql("INSERT INTO activar_nota (nota, evento, hasta) VALUES (?, ?, ?)", a.nota, a.evento, a.ahora + DIAS_DE_LA_NOTA * 86_400_000);
  return true;
}

/** Cuántos segundos faltan para que termine la ventana. */
function esperaDeVentana(ahora: number, ventana: number): number {
  return Math.max(1, Math.ceil(((ventana + 1) * VENTANA_CAMPANA_MS - ahora) / 1000));
}

export type AntesDeActivar = { ok: true } | { ok: false; motivo: "rechazos" | "cupo-conexion"; esperaS: number };

/**
 * Lo que se mira antes de llamar al proveedor de cuentas: la ficha repetida, los rechazos de la conexión y su ritmo. Si todo
 * está en orden, este pedido queda contado en el ritmo de la conexión.
 */
export function antesDeActivar(sql: Ejecutar, a: { grupo: string; ficha: string; ahora: number }): AntesDeActivar {
  return mirarAntes(sql, { ...a, grupoDeRitmo: a.grupo, tope: ACTIVAR_POR_CONEXION, conocida: false });
}

/**
 * Lo mismo para las rutas de Tus campañas, con su grupo de ritmo propio (`cuenta|` y la conexión) y su tope de 300 por
 * ventana. Los rechazos siguen en las mismas tablas y con los mismos topes que activar. Una sesión que el proveedor ya dio por
 * buena (`conocida`) no se frena por la conexión, ni por su ritmo ni por sus rechazos: la ficha sí se mira.
 */
export function antesDeCuenta(sql: Ejecutar, a: { grupo: string; ficha: string; conocida: boolean; ahora: number }): AntesDeActivar {
  return mirarAntes(sql, { ...a, grupoDeRitmo: `cuenta|${a.grupo}`, tope: CUENTA_POR_CONEXION });
}

function mirarAntes(
  sql: Ejecutar,
  a: { grupo: string; grupoDeRitmo: string; tope: number; ficha: string; conocida: boolean; ahora: number },
): AntesDeActivar {
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  sql("DELETE FROM activar_ritmo WHERE ventana < ?", ventana);
  sql("DELETE FROM activar_rechazos WHERE ventana < ?", ventana);
  sql("DELETE FROM activar_ficha WHERE ventana < ?", ventana);
  const deFicha = sql<{ n: number }>("SELECT n FROM activar_ficha WHERE ficha = ? AND ventana = ?", a.ficha, ventana)[0]?.n ?? 0;
  if (deFicha >= RECHAZOS_POR_FICHA) return { ok: false, motivo: "rechazos", esperaS: esperaDeVentana(a.ahora, ventana) };
  if (a.conocida) return { ok: true };
  const rechazos = sql<{ n: number }>("SELECT n FROM activar_rechazos WHERE grupo = ? AND ventana = ?", a.grupo, ventana)[0]?.n ?? 0;
  if (rechazos >= RECHAZOS_POR_CONEXION) return { ok: false, motivo: "rechazos", esperaS: esperaDeVentana(a.ahora, ventana) };
  const pedidos = sql<{ n: number }>("SELECT n FROM activar_ritmo WHERE grupo = ? AND ventana = ?", a.grupoDeRitmo, ventana)[0]?.n ?? 0;
  if (pedidos >= a.tope) return { ok: false, motivo: "cupo-conexion", esperaS: esperaDeVentana(a.ahora, ventana) };
  sql(
    "INSERT INTO activar_ritmo (grupo, ventana, n) VALUES (?, ?, 1) ON CONFLICT(grupo, ventana) DO UPDATE SET n = n + 1",
    a.grupoDeRitmo,
    ventana,
  );
  return { ok: true };
}

export type TipoDeTope = "listado" | "toma";

/**
 * El tope por cuenta de las rutas de Tus campañas: 30 listados y 10 tomas por ventana de 10 minutos. Va después de verificar la
 * sesión, así que la cuenta es la de verdad. Cada pedido que entra cuenta; el que pasa del tope no suma. La cuenta va en claro:
 * es la misma que el texto firmado de la campaña ya trae escrita, y estas filas viven una ventana.
 */
export function topeDeCuenta(
  sql: Ejecutar,
  a: { tipo: TipoDeTope; cuenta: string; ahora: number },
): { ok: true } | { ok: false; esperaS: number } {
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  sql("DELETE FROM cuenta_ritmo WHERE ventana < ?", ventana);
  const grupo = `${a.tipo}|${a.cuenta}`;
  const hechos = sql<{ n: number }>("SELECT n FROM cuenta_ritmo WHERE grupo = ? AND ventana = ?", grupo, ventana)[0]?.n ?? 0;
  if (hechos >= (a.tipo === "listado" ? LISTADOS_POR_CUENTA : TOMAS_POR_CUENTA)) return { ok: false, esperaS: esperaDeVentana(a.ahora, ventana) };
  sql("INSERT INTO cuenta_ritmo (grupo, ventana, n) VALUES (?, ?, 1) ON CONFLICT(grupo, ventana) DO UPDATE SET n = n + 1", grupo, ventana);
  return { ok: true };
}

/**
 * Anota una sesión que el proveedor rechazó. La ficha siempre suma. La conexión suma solo la primera vez que se ve esa ficha:
 * repetirla no cuesta otra llamada al proveedor, y una sola sesión mala no deja sin tope a las demás.
 */
export function contarRechazoDeActivar(sql: Ejecutar, a: { grupo: string; ficha: string; ahora: number }): void {
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  const vista = sql<{ n: number }>("SELECT n FROM activar_ficha WHERE ficha = ? AND ventana = ?", a.ficha, ventana)[0];
  sql(
    "INSERT INTO activar_ficha (ficha, ventana, n) VALUES (?, ?, 1) ON CONFLICT(ficha, ventana) DO UPDATE SET n = n + 1",
    a.ficha,
    ventana,
  );
  if (vista !== undefined) return;
  sql(
    "INSERT INTO activar_rechazos (grupo, ventana, n) VALUES (?, ?, 1) ON CONFLICT(grupo, ventana) DO UPDATE SET n = n + 1",
    a.grupo,
    ventana,
  );
}

/** Si a esta cuenta todavía le cabe activar este evento hoy. Un evento que ya activó hoy siempre cabe (es repetir el pedido). */
export function cupoDeCuenta(
  sql: Ejecutar,
  a: { cuenta: string; evento: string; dia: string; ahora: number },
): { ok: true } | { ok: false; esperaS: number } {
  sql("DELETE FROM activar_cuenta WHERE dia < ?", a.dia);
  const ya = sql<{ n: number }>(
    "SELECT COUNT(*) AS n FROM activar_cuenta WHERE cuenta = ? AND dia = ? AND evento = ?",
    a.cuenta,
    a.dia,
    a.evento,
  )[0]?.n ?? 0;
  if (ya > 0) return { ok: true };
  const hoy = sql<{ n: number }>("SELECT COUNT(*) AS n FROM activar_cuenta WHERE cuenta = ? AND dia = ?", a.cuenta, a.dia)[0]?.n ?? 0;
  if (hoy < ACTIVACIONES_POR_DIA) return { ok: true };
  const finDelDia = (Math.floor(a.ahora / 86_400_000) + 1) * 86_400_000;
  return { ok: false, esperaS: Math.max(1, Math.ceil((finDelDia - a.ahora) / 1000)) };
}

/** Anota que esta cuenta activó este evento hoy. Anotarlo dos veces es lo mismo que una. */
export function anotarActivacion(sql: Ejecutar, a: { cuenta: string; evento: string; dia: string }): void {
  sql("INSERT OR IGNORE INTO activar_cuenta (cuenta, dia, evento) VALUES (?, ?, ?)", a.cuenta, a.dia, a.evento);
}

/* ------------------------------------------------------------------------ Tus campañas */

/** Campañas que se guardan por cuenta: al guardar la 51 se borra la de sorteo más cercano. */
export const MAX_CAMPANAS_POR_CUENTA = 50;
/** Salas con dueña por averiguar que se revisan en cada pedido. */
export const MAX_BARRIDO = 10;
const DIA_MS = 86_400_000;

/** Borra lo vencido: las campañas de la lista y los eventos sellados pasados los 30 días, y las tomas de las que se fueron. */
export function limpiarVencido(sql: Ejecutar, ahora: number): void {
  sql("DELETE FROM tomas WHERE evento IN (SELECT evento FROM campanas_de_cuenta WHERE hasta_ms < ?)", ahora);
  sql("DELETE FROM campanas_de_cuenta WHERE hasta_ms < ?", ahora);
  sql("DELETE FROM eventos_sellados WHERE hasta_ms < ?", ahora);
}

/**
 * La cuenta dueña de un evento: la que nombra el texto firmado de su sala (`eventos_campana.duena`) y, si todavía no hay sala,
 * la que activó primero (`campanas_de_cuenta`). Null si nadie lo tiene.
 */
export function duenaDelEvento(sql: Ejecutar, evento: string): string | null {
  const deLaSala = sql<{ duena: string | null }>("SELECT duena FROM eventos_campana WHERE evento = ?", evento)[0]?.duena ?? null;
  if (deLaSala !== null) return deLaSala;
  return sql<{ cuenta: string }>("SELECT cuenta FROM campanas_de_cuenta WHERE evento = ?", evento)[0]?.cuenta ?? null;
}

/**
 * Si esta cuenta puede activar este evento: sí si no tiene dueña o la dueña es ella. Una sala que ya existe y todavía no
 * se revisó (campañas de antes de que hubiera dueña) cuenta como ajena hasta que el barrido mire de quién es: mejor frenar
 * una vez de más que dejar que otra cuenta se quede con la de una empresa.
 */
export function eventoLibre(sql: Ejecutar, a: { cuenta: string; evento: string; ahora: number }): boolean {
  limpiarVencido(sql, a.ahora);
  const duena = duenaDelEvento(sql, a.evento);
  if (duena !== null) return duena === a.cuenta;
  const fila = sql<{ sala: string | null; revisada: number }>("SELECT sala, revisada FROM eventos_campana WHERE evento = ?", a.evento)[0];
  return !(fila !== undefined && fila.sala !== null && fila.revisada === 0);
}

export interface CampanaParaGuardar {
  cuenta: string;
  evento: string;
  texto: string;
  firma: string;
  empresa: string;
  zona: string;
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  ahora: number;
}

/**
 * Guarda la campaña de una cuenta: una fila por cuenta y evento, que se reescribe al repetir. Si el evento ya es de otra cuenta
 * no escribe nada y dice `ajeno`. Vive hasta 30 días después de la hora del sorteo, y una cuenta tiene hasta 50: al pasar, se
 * borra la de sorteo más cercano entre las otras (nunca la que se acaba de guardar).
 */
export function guardarCampanaDeCuenta(sql: Ejecutar, a: CampanaParaGuardar): { ok: true } | { ok: false; motivo: "ajeno" } {
  limpiarVencido(sql, a.ahora);
  const duena = duenaDelEvento(sql, a.evento);
  if (duena !== null && duena !== a.cuenta) return { ok: false, motivo: "ajeno" };
  sql(
    "INSERT INTO campanas_de_cuenta (cuenta, evento, texto, firma, empresa, zona, abre_ms, cierra_ms, sorteo_ms, en_ms, hasta_ms) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cuenta, evento) DO UPDATE SET texto = excluded.texto, firma = excluded.firma, " +
      "empresa = excluded.empresa, zona = excluded.zona, abre_ms = excluded.abre_ms, cierra_ms = excluded.cierra_ms, " +
      "sorteo_ms = excluded.sorteo_ms, en_ms = excluded.en_ms, hasta_ms = excluded.hasta_ms",
    a.cuenta,
    a.evento,
    a.texto,
    a.firma,
    a.empresa,
    a.zona,
    a.abreMs,
    a.cierraMs,
    a.sorteoMs,
    a.ahora,
    a.sorteoMs + DIAS_DE_LA_LISTA * DIA_MS,
  );
  const cuantas = sql<{ n: number }>("SELECT COUNT(*) AS n FROM campanas_de_cuenta WHERE cuenta = ?", a.cuenta)[0]?.n ?? 0;
  if (cuantas > MAX_CAMPANAS_POR_CUENTA) {
    const vieja = sql<{ evento: string }>(
      "SELECT evento FROM campanas_de_cuenta WHERE cuenta = ? AND evento <> ? ORDER BY hasta_ms ASC LIMIT 1",
      a.cuenta,
      a.evento,
    )[0]?.evento;
    if (vieja !== undefined) {
      sql("DELETE FROM tomas WHERE evento = ?", vieja);
      sql("DELETE FROM campanas_de_cuenta WHERE cuenta = ? AND evento = ?", a.cuenta, vieja);
    }
  }
  return { ok: true };
}

/**
 * Anota que el evento ya se selló. La hora que vale es la del sorteo del texto firmado, no la clave `sorteo` de la sala (que
 * después de sellar guarda el número del sorteo).
 */
export function marcarEventoSellado(sql: Ejecutar, a: { evento: string; sorteoMs: number; ahora: number }): void {
  limpiarVencido(sql, a.ahora);
  sql(
    "INSERT INTO eventos_sellados (evento, en_ms, hasta_ms) VALUES (?, ?, ?) ON CONFLICT(evento) DO UPDATE SET " +
      "en_ms = excluded.en_ms, hasta_ms = excluded.hasta_ms",
    a.evento,
    a.ahora,
    a.sorteoMs + DIAS_DE_LA_LISTA * DIA_MS,
  );
}

/** Las salas anteriores a la dueña que todavía no se miraron, hasta `MAX_BARRIDO` por pedido. */
export function pendientesDeBarrido(sql: Ejecutar): { evento: string; sala: string }[] {
  return sql<{ evento: string; sala: string }>(
    "SELECT evento, sala FROM eventos_campana WHERE sala IS NOT NULL AND duena IS NULL AND revisada = 0 ORDER BY en_ms DESC LIMIT ?",
    MAX_BARRIDO,
  );
}

/**
 * Lo que se vio al mirar una sala vieja. Si vive y su texto firmado nombra una cuenta, esa cuenta es la dueña del evento y su
 * campaña entra a la lista. Viva o muerta, la sala queda revisada: una sala muerta sin dueña conocida sigue como estaba y
 * nadie la recupera.
 */
export function anotarBarrido(
  sql: Ejecutar,
  a: { evento: string; sala: string; ahora: number; campana: { texto: string; firma: string; sellada?: boolean } | null },
): void {
  if (a.campana !== null) {
    const organizadora = organizadoraDelTexto(a.campana.texto);
    const datos = leerDatosDeLista(a.campana.texto);
    const delTexto = eventoYSorteoDelTexto(a.campana.texto);
    // Una sala que ya estaba sellada antes de que existiera esta lista deja su evento anotado como sellado: así no se reabre
    // aunque la sala se cierre después. Sin esto, ese evento solo quedaría marcado si el sello se hacía de nuevo.
    if (a.campana.sellada === true && delTexto?.evento === a.evento) {
      marcarEventoSellado(sql, { evento: a.evento, sorteoMs: delTexto.sorteoMs, ahora: a.ahora });
    }
    // El texto de la sala tiene que ser el de este evento: si no, no se le cree.
    if (organizadora !== null && delTexto?.evento === a.evento) {
      sql("UPDATE eventos_campana SET duena = ? WHERE evento = ? AND sala = ? AND duena IS NULL", organizadora, a.evento, a.sala);
      if (datos.ok) {
        guardarCampanaDeCuenta(sql, {
          cuenta: organizadora,
          evento: a.evento,
          texto: a.campana.texto,
          firma: a.campana.firma,
          empresa: datos.empresa,
          zona: datos.zona,
          abreMs: datos.abreMs,
          cierraMs: datos.cierraMs,
          sorteoMs: datos.sorteoMs,
          ahora: a.ahora,
        });
      }
    }
  }
  sql("UPDATE eventos_campana SET revisada = 1 WHERE evento = ? AND sala = ?", a.evento, a.sala);
}

/* --------------------------------------------------------------------------- la toma */

/** Cuánto tiene que pasar entre dos tomas de la misma campaña: así nadie la quita una y otra vez a su dueña. */
export const PAUSA_ENTRE_TOMAS_MS = 60_000;

export type PreparacionDeToma =
  | { ok: true; gen: number }
  | { ok: false; motivo: "no-existe" }
  | { ok: false; motivo: "pausa"; esperaS: number };

/**
 * El primer paso de pasar la campaña a otra compu, todo en un solo bloque sin esperas: comprueba otra vez que el evento es de
 * esta cuenta, mira la pausa de 60 segundos desde la última toma, y anota la generación nueva con la huella del token nuevo.
 * La generación ordena dos tomas que llegan casi juntas: la sala se queda con la de número mayor. La toma no cambia nada más
 * hasta que la sala confirma (`confirmarToma`). La pausa cuenta desde el pedido anterior aunque no haya llegado a buen puerto:
 * quien reintenta espera un minuto.
 */
export function prepararToma(
  sql: Ejecutar,
  a: { cuenta: string; evento: string; huellaNueva: string; ahora: number },
): PreparacionDeToma {
  limpiarVencido(sql, a.ahora);
  if (duenaDelEvento(sql, a.evento) !== a.cuenta) return { ok: false, motivo: "no-existe" };
  const antes = sql<{ gen: number; ultima_ms: number }>("SELECT gen, ultima_ms FROM tomas WHERE evento = ?", a.evento)[0];
  if (antes !== undefined && a.ahora - antes.ultima_ms < PAUSA_ENTRE_TOMAS_MS) {
    return { ok: false, motivo: "pausa", esperaS: Math.max(1, Math.ceil((antes.ultima_ms + PAUSA_ENTRE_TOMAS_MS - a.ahora) / 1000)) };
  }
  const gen = (antes?.gen ?? 0) + 1;
  sql(
    "INSERT INTO tomas (evento, gen, huella_gen, ultima_ms) VALUES (?, ?, ?, ?) ON CONFLICT(evento) DO UPDATE SET " +
      "gen = excluded.gen, huella_gen = excluded.huella_gen, ultima_ms = excluded.ultima_ms",
    a.evento,
    gen,
    a.huellaNueva,
    a.ahora,
  );
  return { ok: true, gen };
}

/**
 * El último paso: cuando la sala ya cambió su token, el evento guarda la huella del token nuevo, pero solo si esta generación
 * sigue siendo la última. Con dos tomas a la vez, la sala y el evento terminan con la misma huella: la de la generación mayor.
 */
export function confirmarToma(sql: Ejecutar, a: { evento: string; gen: number }): boolean {
  const toma = sql<{ gen: number; huella_gen: string }>("SELECT gen, huella_gen FROM tomas WHERE evento = ?", a.evento)[0];
  if (toma === undefined || toma.gen !== a.gen) return false;
  sql("UPDATE eventos_campana SET huella = ? WHERE evento = ? AND sala IS NOT NULL", toma.huella_gen, a.evento);
  return true;
}

/** Lo que el barrido le pide al resto del Worker: las salas por mirar, el texto de una sala viva y dónde anotar lo visto. */
export interface PuertoDeBarrido {
  pendientes(): Promise<{ evento: string; sala: string }[]>;
  /** El texto firmado público de la sala y si ya está sellada, o null si ya no existe. Lanza si no se pudo preguntar. */
  campana(sala: string): Promise<{ texto: string; firma: string; sellada: boolean } | null>;
  anotar(evento: string, sala: string, campana: { texto: string; firma: string; sellada: boolean } | null): Promise<void>;
}

/**
 * Mira, en paralelo, hasta 10 salas anteriores a la dueña. Lo que falla queda pendiente y se vuelve a mirar en el pedido
 * siguiente. Devuelve cuántas se anotaron.
 */
export async function barrerSalasViejas(puerto: PuertoDeBarrido): Promise<number> {
  const filas = await puerto.pendientes();
  let anotadas = 0;
  await Promise.all(
    filas.slice(0, MAX_BARRIDO).map(async (fila) => {
      try {
        await puerto.anotar(fila.evento, fila.sala, await puerto.campana(fila.sala));
        anotadas++;
      } catch {
        /* queda sin revisar: un pedido con la sala caída no la da por muerta */
      }
    }),
  );
  return anotadas;
}

/* ------------------------------------------------------------------ lo que leen las rutas */

/** Una campaña de la lista de una cuenta, con lo que hace falta para decir en qué está (ver `tus-campanas.ts`). */
export interface FilaDeLaLista {
  evento: string;
  empresa: string;
  zona: string;
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  /** El id de la sala confirmada del evento, o null si no tiene. Nunca sale del servidor. */
  sala: string | null;
  /** Cuándo se creó esa sala, para mirar primero las más nuevas. */
  salaEnMs: number | null;
  /** El evento ya se selló. */
  sellado: boolean;
}

/**
 * Las campañas de una cuenta. Una fila cuyo evento tiene otra dueña (la de su sala) no es de esta cuenta y no sale: la lista
 * nunca muestra nada de una campaña ajena, aunque haya quedado una fila vieja o escrita a mano.
 */
export function campanasDeLaCuenta(sql: Ejecutar, a: { cuenta: string; ahora: number }): FilaDeLaLista[] {
  limpiarVencido(sql, a.ahora);
  const filas = sql<{
    evento: string;
    empresa: string;
    zona: string;
    abre_ms: number;
    cierra_ms: number;
    sorteo_ms: number;
    sala: string | null;
    sala_en_ms: number | null;
    sellado: number | null;
  }>(
    "SELECT c.evento AS evento, c.empresa AS empresa, c.zona AS zona, c.abre_ms AS abre_ms, c.cierra_ms AS cierra_ms, " +
      "c.sorteo_ms AS sorteo_ms, e.sala AS sala, e.en_ms AS sala_en_ms, " +
      "(SELECT 1 FROM eventos_sellados s WHERE s.evento = c.evento AND s.hasta_ms >= ?) AS sellado " +
      "FROM campanas_de_cuenta c LEFT JOIN eventos_campana e ON e.evento = c.evento " +
      "WHERE c.cuenta = ? AND (e.duena IS NULL OR e.duena = c.cuenta)",
    a.ahora,
    a.cuenta,
  );
  return filas.map((f) => ({
    evento: f.evento,
    empresa: f.empresa,
    zona: f.zona,
    abreMs: f.abre_ms,
    cierraMs: f.cierra_ms,
    sorteoMs: f.sorteo_ms,
    sala: f.sala,
    salaEnMs: f.sala === null ? null : f.sala_en_ms,
    sellado: f.sellado !== null,
  }));
}

/** Lo que se sabe de una campaña de la cuenta para usarla en otra compu: su texto firmado y en qué está su evento. */
export interface FichaDeCampana {
  texto: string;
  firma: string;
  cierraMs: number;
  sorteoMs: number;
  empresa: string;
  zona: string;
  /** Si el evento tiene fila en `eventos_campana` (una reserva o una sala). */
  hayFila: boolean;
  /** El id de la sala confirmada, o null si la fila es una reserva sin sala (o no hay fila). */
  sala: string | null;
  /** Cuándo se reservó el evento o se creó su sala. */
  enMs: number | null;
  /** La cuenta que nombra el texto firmado de la sala, o null si no la nombra o no hay sala. */
  duena: string | null;
  sellado: boolean;
}

/**
 * La campaña de esta cuenta con este evento, o null si no hay fila o si la dueña del evento es otra cuenta. La misma respuesta
 * para un evento ajeno, uno que no existe y uno que ya venció: quien llama contesta lo mismo en los tres casos.
 */
export function campanaDeLaCuenta(sql: Ejecutar, a: { cuenta: string; evento: string; ahora: number }): FichaDeCampana | null {
  limpiarVencido(sql, a.ahora);
  const f = sql<{
    texto: string;
    firma: string;
    cierra_ms: number;
    sorteo_ms: number;
    empresa: string;
    zona: string;
    hay: string | null;
    sala: string | null;
    en_ms: number | null;
    duena: string | null;
    sellado: number | null;
  }>(
    "SELECT c.texto AS texto, c.firma AS firma, c.cierra_ms AS cierra_ms, c.sorteo_ms AS sorteo_ms, c.empresa AS empresa, " +
      "c.zona AS zona, e.evento AS hay, e.sala AS sala, e.en_ms AS en_ms, e.duena AS duena, " +
      "(SELECT 1 FROM eventos_sellados s WHERE s.evento = c.evento AND s.hasta_ms >= ?) AS sellado " +
      "FROM campanas_de_cuenta c LEFT JOIN eventos_campana e ON e.evento = c.evento WHERE c.cuenta = ? AND c.evento = ?",
    a.ahora,
    a.cuenta,
    a.evento,
  )[0];
  if (f === undefined || duenaDelEvento(sql, a.evento) !== a.cuenta) return null;
  return {
    texto: f.texto,
    firma: f.firma,
    cierraMs: f.cierra_ms,
    sorteoMs: f.sorteo_ms,
    empresa: f.empresa,
    zona: f.zona,
    hayFila: f.hay !== null,
    sala: f.sala,
    enMs: f.en_ms,
    duena: f.duena,
    sellado: f.sellado !== null,
  };
}

/**
 * Cambia la huella del token de la sala muerta de un evento por la de un token nuevo, para que quien lo trae pueda reemplazar
 * esa sala con el mismo archivo firmado. Solo si el evento sigue teniendo esa misma sala. Dice si cambió.
 */
export function reescribirHuellaDeEvento(sql: Ejecutar, a: { evento: string; sala: string; huella: string }): boolean {
  sql("UPDATE eventos_campana SET huella = ? WHERE evento = ? AND sala = ?", a.huella, a.evento, a.sala);
  return sql<{ huella: string | null }>("SELECT huella FROM eventos_campana WHERE evento = ? AND sala = ?", a.evento, a.sala)[0]?.huella === a.huella;
}

/** Entre un correo de aviso de toma y el siguiente de la misma campaña: 10 minutos. */
export const ESPERA_ENTRE_CORREOS_DE_TOMA_MS = 600_000;

/**
 * Si toca mandar el correo de aviso de una toma: como mucho uno cada 10 minutos por campaña. Si toca, deja anotada la hora. No
 * guarda nada de la persona: solo cuándo se mandó el último.
 */
export function reservarCorreoDeToma(sql: Ejecutar, a: { evento: string; ahora: number }): boolean {
  const toma = sql<{ correo_ms: number }>("SELECT correo_ms FROM tomas WHERE evento = ?", a.evento)[0];
  if (toma === undefined) return false;
  if (toma.correo_ms !== 0 && a.ahora - toma.correo_ms < ESPERA_ENTRE_CORREOS_DE_TOMA_MS) return false;
  sql("UPDATE tomas SET correo_ms = ? WHERE evento = ?", a.ahora, a.evento);
  return true;
}
