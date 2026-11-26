/**
 * La parte de las campañas que no depende de Cloudflare: la usan `index.ts` y las pruebas en Node.
 * Los paquetes 4, 6 y 9 suman acá las altas, el sellado y el resultado.
 */
import { listHash } from "../../../src/protocol/canonical";
import { roundTime } from "../../../src/protocol/quicknet";
import { diaUtc, esCuentaValida, grupoDeIp, iguales } from "./logica";
import { crearTablasDeEquipos, siguienteVersion } from "./registro";
import type { Ejecutar } from "./registro";
import { crearTablasDeVigilancia } from "./vigilancia-campana";
import { deHex, esPedidoLocal, verificarFirma } from "./firma";
import type { VariablesDePrueba } from "./firma";
import type { SelloEnLaRed } from "./cadena";
import { limpiarTexto } from "./correo";

export const VIDA_CAMPANA_MS = 24 * 3_600_000;
/**
 * Cuánto antes de que salga la ronda de drand tiene que llegar el sello: un período de quicknet. El contrato ya exige 30
 * segundos al sellar y el panel sella con 45 o más, así que esto solo corta un sello que llega con la semilla a la vista.
 */
export const MARGEN_DE_RONDA_MS = 3_000;
export const MAX_CUERPO_CAMPANA = 90_000;
export const MAX_TEXTO_CAMPANA = 80_000;
export const CAMPANAS_POR_DIA = 20;
export const CAMPANA_MAX = 300;
export const MAX_CUERPO_ALTA = 6_000;
export const VENTANA_CAMPANA_MS = 10 * 60_000;
/**
 * Sesiones que el proveedor rechazó, por conexión y por ventana. Todo el recinto sale por una dirección: el tope tiene que
 * dejar pasar a 150 personas honestas con algún error (sesión vencida, entrar con correo) y frenar solo a quien no para.
 * Cada ficha cuenta una sola vez acá (ver `RECHAZOS_POR_FICHA`) y lo que se rechaza antes de llamar al proveedor no cuenta.
 */
export const RECHAZOS_POR_CONEXION = 300;
/** Rechazos de una misma ficha por ventana. Repetir una ficha mala no sirve: cuando se pasa, ni se le pregunta al proveedor. */
export const RECHAZOS_POR_FICHA = 5;
/** Veces que una misma persona ya anotada puede volver a entrar (otro celular, otra pestaña) en una hora. */
export const REINGRESOS_POR_PERSONA_POR_HORA = 6;
/** Cuánto se recuerda en la sala que una ficha ya fue verificada: el mismo minuto que recuerda el proveedor. */
export const MEMORIA_DE_FICHA_MS = 60_000;
/** Cuánto vale un permiso de evento sin confirmar: pasado este tiempo se lo da por abandonado (hubo un corte). */
export const ESPERA_RESERVA_MS = 60_000;
/** Envíos con sesión verificada por conexión y por ventana, incluidos los de quien ya estaba. */
export const ENVIOS_CAMPANA_POR_CONEXION = 800;
/** Altas por minuto en la sala. Solo cuentan las sesiones verificadas. */
export const CAMPANA_POR_MINUTO = 300;
export const VENTANA_PASE_MS = 120_000;
/** La ventana actual y las 7 anteriores: entre 14 y 16 minutos para entrar con Google sin apuro. */
export const VENTANAS_DEL_PASE = 8;
export const ES_PASE = /^[A-Za-z0-9_-]{12}$/;
/** La misma forma de `evento` que `leerCampana` en src/campana/modelo.ts. Una prueba compara las dos. */
export const ES_EVENTO_CAMPANA = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;
export const FASES = ["lista", "abierta", "cerrada", "sellada", "sorteada"] as const;
export type Fase = (typeof FASES)[number];
export const esFase = (x: unknown): x is Fase => typeof x === "string" && (FASES as readonly string[]).includes(x);
export const MOTIVOS_DE_SALIDA = ["repetida", "evento", "pidio", "otro"] as const;
export type MotivoDeSalida = (typeof MOTIVOS_DE_SALIDA)[number];
export const esMotivoDeSalida = (x: unknown): x is MotivoDeSalida =>
  typeof x === "string" && (MOTIVOS_DE_SALIDA as readonly string[]).includes(x);

export interface CampanaFirmada {
  texto: string;
  firma: string;
  evento: string;
  red: "mainnet" | "testnet";
  cierraMs: number;
  sorteoMs: number;
  /** Cuántos premios firmó la empresa: es la cantidad de ganadoras que tiene que traer el sello en la red. */
  premios: number;
  /** La cuenta que tiene que sellar, si la campaña la nombra. Sin ella, el sello de cualquier cuenta sirve. */
  organizadora: string | null;
}
export type LecturaFirmada = ({ ok: true } & CampanaFirmada) | { ok: false; motivo: "forma" | "firma" | "vencida" };

/** Lo que sale de leer el texto de una campaña, sin mirar la firma. `campo` dice cuál no sirvió. */
export type LecturaDelTexto =
  | Omit<CampanaFirmada, "texto" | "firma"> & { ok: true }
  | { ok: false; motivo: "forma" | "vencida"; campo: string };

/** Un premio: un monto entero en unidades de siete decimales, como lo escribe el archivo que lee el sitio. */
const ES_PREMIO = /^\d{1,16}$/u;

/**
 * Lee del texto de una campaña lo que la sala necesita. La sala lo corre después de comprobar la firma y el firmador de
 * Tinkazo lo corre antes de firmar: lo que este lector rechaza, Tinkazo no lo firma.
 */
export function leerTextoDeCampana(texto: string, ahora: number): LecturaDelTexto {
  const forma = (campo: string): LecturaDelTexto => ({ ok: false, motivo: "forma", campo });
  if (texto.length < 1 || texto.length > MAX_TEXTO_CAMPANA) return forma("texto");
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return forma("texto");
  }
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return forma("texto");
  const c = datos as Record<string, unknown>;
  const evento = c.evento;
  const red = c.red;
  const cierraMs = c.cierra_ms;
  const sorteoMs = c.sorteo_ms;
  const premios = c.premios;
  const organizadora = c.organizadora ?? null;
  if (c.v !== 1) return forma("v");
  if (typeof evento !== "string" || !ES_EVENTO_CAMPANA.test(evento)) return forma("evento");
  if (red !== "mainnet" && red !== "testnet") return forma("red");
  if (typeof cierraMs !== "number" || !Number.isSafeInteger(cierraMs) || cierraMs <= 0) return forma("cierra_ms");
  if (typeof sorteoMs !== "number" || !Number.isSafeInteger(sorteoMs) || sorteoMs <= 0) return forma("sorteo_ms");
  if (!Array.isArray(premios) || premios.length < 1 || premios.length > 10) return forma("premios");
  if (premios.some((premio) => typeof premio !== "string" || !ES_PREMIO.test(premio))) return forma("premios");
  if (organizadora !== null && !esCuentaValida(organizadora)) return forma("organizadora");
  if (cierraMs <= ahora) return { ok: false, motivo: "vencida", campo: "cierra_ms" };
  return { ok: true, evento, red, cierraMs, sorteoMs, premios: premios.length, organizadora };
}

/** Lo más largo que se guarda del nombre de la empresa en la lista de Tus campañas. */
export const MAX_EMPRESA_EN_LISTA = 60;
/** El instante más lejano que acepta un Date. El mismo tope que el lector del sitio (`src/campana/modelo.ts`). */
const MAXIMO_DE_FECHA = 8_640_000_000_000_000;

/** Lo que Tus campañas necesita de un texto firmado, además de lo que ya lee la sala. */
export interface DatosDeLista {
  evento: string;
  /** La cuenta que nombra el texto, si la nombra. Sin ella el evento no tiene dueña conocida. */
  organizadora: string | null;
  empresa: string;
  zona: string;
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
}
export type LecturaDeLista = ({ ok: true } & DatosDeLista) | { ok: false; campo: string };

const esInstante = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0 && x <= MAXIMO_DE_FECHA;

/**
 * Lee de un texto firmado lo que hace falta para la lista de Tus campañas: la hora de abrir, la zona, el nombre de la empresa
 * y las horas de cierre y sorteo. Lo comparten activar y la creación de la sala. No mira si el cierre ya pasó: una sala viva
 * después del cierre sigue siendo la campaña de esa cuenta. Las reglas son las del sitio (`src/campana/modelo.ts`): la zona
 * tiene que ser una que `Intl` acepte y el nombre de la empresa, de 1 a 60 caracteres ya limpios. `campo` dice cuál no sirvió.
 */
export function leerDatosDeLista(texto: string): LecturaDeLista {
  const forma = (campo: string): LecturaDeLista => ({ ok: false, campo });
  if (typeof texto !== "string" || texto.length < 1 || texto.length > MAX_TEXTO_CAMPANA) return forma("texto");
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return forma("texto");
  }
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return forma("texto");
  const c = datos as Record<string, unknown>;
  if (typeof c.evento !== "string" || !ES_EVENTO_CAMPANA.test(c.evento)) return forma("evento");
  const organizadora = c.organizadora ?? null;
  if (organizadora !== null && !esCuentaValida(organizadora)) return forma("organizadora");
  if (!esInstante(c.abre_ms)) return forma("abre_ms");
  if (!esInstante(c.cierra_ms)) return forma("cierra_ms");
  if (!esInstante(c.sorteo_ms)) return forma("sorteo_ms");
  const zona = c.zona;
  if (typeof zona !== "string" || zona.length < 1 || zona.length > 64) return forma("zona");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zona }).format(0);
  } catch {
    return forma("zona");
  }
  const empresa = typeof c.empresa === "object" && c.empresa !== null ? (c.empresa as Record<string, unknown>).nombre : null;
  const nombre = limpiarTexto(empresa, MAX_EMPRESA_EN_LISTA);
  if (nombre === "") return forma("empresa.nombre");
  return { ok: true, evento: c.evento, organizadora, empresa: nombre, zona, abreMs: c.abre_ms, cierraMs: c.cierra_ms, sorteoMs: c.sorteo_ms };
}

/** El evento y la hora del sorteo del texto firmado de una sala, o null si no se leen. Nunca de la clave `sorteo` de la sala. */
export function eventoYSorteoDelTexto(texto: string | null): { evento: string; sorteoMs: number } | null {
  if (texto === null) return null;
  try {
    const c = JSON.parse(texto) as { evento?: unknown; sorteo_ms?: unknown } | null;
    if (!c || typeof c.evento !== "string" || !ES_EVENTO_CAMPANA.test(c.evento) || !esInstante(c.sorteo_ms)) return null;
    return { evento: c.evento, sorteoMs: c.sorteo_ms };
  } catch {
    return null;
  }
}

/** La cuenta que nombra el texto firmado de una sala, o null si no la nombra o no se lee. */
export function organizadoraDelTexto(texto: string | null): string | null {
  if (texto === null) return null;
  try {
    const c = JSON.parse(texto) as { organizadora?: unknown } | null;
    return c && esCuentaValida(c.organizadora) ? c.organizadora : null;
  } catch {
    return null;
  }
}

/**
 * Lee solo lo que la sala necesita de una campaña, y solo después de comprobar que Tinkazo firmó el texto entero. Valen
 * varias llaves (la de siempre y la de la activación automática): basta con que firme una. Sin ninguna, nada se firma.
 */
export function leerCampanaFirmada(
  cuerpo: unknown,
  llaves: string | null | readonly string[],
  ahora: number,
): LecturaFirmada {
  if (typeof cuerpo !== "object" || cuerpo === null) return { ok: false, motivo: "forma" };
  const entrada = cuerpo as Record<string, unknown>;
  const texto = entrada.texto;
  const firma = entrada.firma;
  if (typeof texto !== "string" || typeof firma !== "string" || texto.length < 1 || texto.length > MAX_TEXTO_CAMPANA) {
    return { ok: false, motivo: "forma" };
  }
  const validas: readonly (string | null)[] = typeof llaves === "string" || llaves === null ? [llaves] : llaves;
  if (!validas.some((llave) => verificarFirma(texto, firma, llave))) return { ok: false, motivo: "firma" };
  const lectura = leerTextoDeCampana(texto, ahora);
  if (!lectura.ok) return { ok: false, motivo: lectura.motivo };
  const { ok, ...datos } = lectura;
  return { ok, texto, firma, ...datos };
}

/**
 * Cuánto vive una sala de campaña: 24 horas. `VIDA_PRUEBA_MS` la acorta solo en el servidor de desarrollo (pedidos a
 * localhost o 127.0.0.1), como la llave de prueba: en un Worker desplegado, un valor olvidado no le corta la vida a la sala
 * de un evento con gente anotada.
 */
export function vidaDeCampana(env: VariablesDePrueba, direccion: string): number {
  const prueba = Number(env.VIDA_PRUEBA_MS);
  const vale = esPedidoLocal(direccion) && Number.isFinite(prueba) && prueba >= 1000 && prueba <= VIDA_CAMPANA_MS;
  return vale ? prueba : VIDA_CAMPANA_MS;
}

/** Qué cambio de fase puede pedir quien organiza. `abierta` a `abierta` es correr la hora de cierre. `sorteada` llega solo con el resultado. */
export function cambioValido(de: Fase, a: Fase): boolean {
  if (de === "lista") return a === "abierta";
  if (de === "abierta") return a === "abierta" || a === "cerrada";
  if (de === "cerrada") return a === "abierta" || a === "sellada";
  return false;
}

/**
 * La lista que se sella en una campaña: una cuenta por línea, sin repetidas, en orden de texto. No depende de quién se
 * anotó primero ni de quién descifró primero, y no une el orden de la pantalla con el del comprobante. No toca la justicia:
 * la lista se sella antes de que exista la semilla. La usan la sala y el sitio (src/campana/lista.ts), igual.
 */
export function listaDeLaCampana(cuentas: readonly string[]): string[] {
  return [...new Set(cuentas)].sort();
}

/** Las cuentas anotadas ahora, en el orden de la lista. */
export function listaDeLaSala(sql: Ejecutar): string[] {
  const filas = sql<{ cuenta: string }>("SELECT cuenta FROM equipos");
  return listaDeLaCampana(filas.map((fila) => fila.cuenta));
}

export type MotivoDeSelloRechazado =
  | "fase"
  | "lista-distinta"
  | "ganadores-distintos"
  | "organizador-distinto"
  | "ronda-pasada";

/**
 * Pasa la campaña a sellada con el número del sorteo. El sello de la red tiene que estar atado a lo que Tinkazo firmó:
 *  - la cantidad de ganadoras es la de premios del archivo firmado (si no, un sello con más ganadoras que premios
 *    haría ganar a cuentas que no tienen premio);
 *  - quien selló es la cuenta que la campaña nombra, si la nombra;
 *  - la huella es la de las cuentas anotadas y no quitadas, ordenadas por cuenta;
 *  - la ronda de drand del sello todavía no salió (con `MARGEN_DE_RONDA_MS`) y el sorteo no está hecho. Si no, quien tiene
 *    el token podría sellar varias veces la misma lista, esperar las semillas y avisar a la sala solo el sello que le
 *    conviene: la lista tiene que quedar atada a un sorteo antes de que exista el número que lo decide.
 * Lo que no coincide se rechaza con su motivo y la fase sigue `cerrada`, así que se puede reintentar. La huella se calcula
 * acá, en el mismo bloque, con `listHash` (síncrona): entre leer la lista y escribir no hay esperas.
 */
export function sellar(
  sql: Ejecutar,
  sorteo: string,
  sello: SelloEnLaRed,
  ahora: number,
): { ok: true } | { ok: false; motivo: MotivoDeSelloRechazado } {
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  if (fase !== "cerrada") return { ok: false, motivo: "fase" };
  // Con la semilla a la vista (o el sorteo ya hecho) el sello no ata nada: se rechaza y la campaña sigue cerrada.
  if (sello.sorteado || roundTime(sello.ronda) * 1000 - ahora < MARGEN_DE_RONDA_MS) {
    return { ok: false, motivo: "ronda-pasada" };
  }
  // Sin la cantidad firmada no hay con qué comparar: no se sella.
  const premios = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'premios'")[0]?.v);
  if (!Number.isSafeInteger(premios) || premios < 1 || sello.numWinners !== premios) {
    return { ok: false, motivo: "ganadores-distintos" };
  }
  const organizadora = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'organizadora'")[0]?.v;
  if (organizadora !== undefined && (sello.organizador === null || !iguales(organizadora, sello.organizador))) {
    return { ok: false, motivo: "organizador-distinto" };
  }
  const lista = listaDeLaSala(sql);
  if (lista.length !== sello.count || hexadecimal(listHash(lista)) !== sello.listHash) {
    return { ok: false, motivo: "lista-distinta" };
  }
  sql(
    "INSERT INTO sala (k, v) VALUES ('fase', 'sellada'), ('sorteo', ?), ('lista', ?), ('ronda_sello', ?) " +
      "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    sorteo,
    JSON.stringify(lista),
    String(sello.ronda),
  );
  return { ok: true };
}

/** Guarda el resultado leído de la red. Las ganadoras salen de la lista sellada de la sala, nunca del pedido. */
export function guardarResultado(
  sql: Ejecutar,
  a: { sorteo: string; ganadores: readonly number[]; numWinners: number; comprobante: string },
): { ok: true; primera: boolean } | { ok: false; motivo: "fase" | "distinto" } {
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  const sorteo = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'sorteo'")[0]?.v;
  if (fase === "sorteada" && sorteo !== a.sorteo) return { ok: false, motivo: "distinto" };
  if ((fase !== "sellada" && fase !== "sorteada") || sorteo !== a.sorteo) {
    return { ok: false, motivo: "fase" };
  }
  const cruda = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'lista'")[0]?.v;
  if (!cruda || a.ganadores.length !== a.numWinners) return { ok: false, motivo: "distinto" };
  // La cantidad firmada manda también acá: un resultado con más ganadoras que premios no se guarda.
  const premios = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'premios'")[0]?.v);
  if (!Number.isSafeInteger(premios) || a.numWinners !== premios) return { ok: false, motivo: "distinto" };
  let lista: unknown;
  try {
    lista = JSON.parse(cruda);
  } catch {
    return { ok: false, motivo: "distinto" };
  }
  if (!Array.isArray(lista)) return { ok: false, motivo: "distinto" };
  const desconocidas = lista as unknown[];
  if (desconocidas.some((cuenta) => typeof cuenta !== "string")) return { ok: false, motivo: "distinto" };
  const cuentas = desconocidas as string[];
  const ganadoras: string[] = [];
  for (const indice of a.ganadores) {
    if (!Number.isSafeInteger(indice) || indice < 0) return { ok: false, motivo: "distinto" };
    const cuenta = cuentas[indice];
    if (cuenta === undefined) return { ok: false, motivo: "distinto" };
    ganadoras.push(cuenta);
  }
  if (fase === "sorteada") {
    const anteriores = ganadorasGuardadas(sql);
    const mismas = anteriores.length === ganadoras.length && anteriores.every((cuenta, i) => cuenta === ganadoras[i]);
    if (!mismas) return { ok: false, motivo: "distinto" };
    sql(
      "INSERT INTO sala (k, v) VALUES ('comprobante', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      a.comprobante,
    );
    return { ok: true, primera: false };
  }
  sql(
    "INSERT INTO sala (k, v) VALUES ('fase', 'sorteada'), ('ganadoras', ?), ('comprobante', ?) " +
      "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    JSON.stringify(ganadoras),
    a.comprobante,
  );
  return { ok: true, primera: true };
}

/** Una hora de cierre que quien organiza puede poner: entre 1 minuto y 12 horas desde ahora. */
export function cierreValido(x: unknown, ahora: number): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= ahora + 60_000 && x <= ahora + 12 * 3_600_000;
}

export const ventanaDelPase = (ahora: number): number => Math.floor(ahora / VENTANA_PASE_MS);

/** El pase de una ventana: los primeros 9 bytes del HMAC-SHA256 del secreto de la sala sobre `pase|<ventana>`, en base64url. */
export async function paseDe(secretoHex: string, ventana: number): Promise<string> {
  // La copia precisa el respaldo de los bytes que pide WebCrypto, sin cambiar el secreto ni el pase calculado.
  const secreto = new Uint8Array(deHex(secretoHex));
  const llave = await crypto.subtle.importKey("raw", secreto, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mensaje = new TextEncoder().encode(`pase|${ventana}`);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", llave, mensaje)).subarray(0, 9);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Si `p` es el pase de la ventana actual o de una de las 7 anteriores. */
export async function paseValido(secretoHex: string, p: unknown, ahora: number): Promise<boolean> {
  if (typeof p !== "string" || !ES_PASE.test(p)) return false;
  const actual = ventanaDelPase(ahora);
  let vale = false;
  for (let k = 0; k < VENTANAS_DEL_PASE; k++) {
    if (iguales(await paseDe(secretoHex, actual - k), p)) vale = true;
  }
  return vale;
}

/** Hasta cuándo vale el pase de ahora como pase de la pantalla: el panel pide otro en ese instante. */
export const hastaDelPase = (ahora: number): number => (ventanaDelPase(ahora) + 1) * VENTANA_PASE_MS;

/**
 * Los eventos de las campañas firmadas. Un evento tiene una sola sala viva a la vez, y el permiso se da en dos tiempos:
 * se reserva antes de crear la sala y se confirma, con el id de la sala, recién cuando quedó creada. Si la creación falla
 * se suelta la reserva. Así un corte o un cierre no deja el evento quemado: cuando su sala ya no existe, se vuelve a usar.
 * Con la sala confirmada se guarda la huella de su token (`huella`): el archivo firmado es público desde que la sala existe
 * (`GET campana`), así que tomar el lugar de una sala que ya no existe pide el token de esa sala, no solo el archivo.
 */
export function crearTablaDeEventos(sql: Ejecutar): void {
  sql(
    "CREATE TABLE IF NOT EXISTS eventos_campana " +
      "(evento TEXT PRIMARY KEY, dia TEXT NOT NULL, sala TEXT, huella TEXT, reserva TEXT NOT NULL, en_ms INTEGER NOT NULL, " +
      "duena TEXT, revisada INTEGER NOT NULL DEFAULT 0)",
  );
  // Un `CREATE TABLE IF NOT EXISTS` no agrega columnas a una tabla que ya existe: las campañas que se crearon antes de que
  // hubiera dueña tienen la tabla sin `duena` ni `revisada`, y se las suma una vez, sin tocar sus filas.
  const columnas = sql<{ name: string }>("PRAGMA table_info(eventos_campana)").map((columna) => columna.name);
  if (!columnas.includes("duena")) sql("ALTER TABLE eventos_campana ADD COLUMN duena TEXT");
  if (!columnas.includes("revisada")) sql("ALTER TABLE eventos_campana ADD COLUMN revisada INTEGER NOT NULL DEFAULT 0");
  // Las salas que de verdad se crearon por día, aunque después se cierren: es lo que gasta el cupo.
  sql("CREATE TABLE IF NOT EXISTS campanas_creadas (dia TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  // Los eventos que ya se sellaron: no se reabren ni se reemplazan, tampoco con el token de su sala. Viven hasta 30 días
  // después de la hora del sorteo que dice el texto firmado.
  sql("CREATE TABLE IF NOT EXISTS eventos_sellados (evento TEXT PRIMARY KEY, en_ms INTEGER NOT NULL, hasta_ms INTEGER NOT NULL)");
}

/** Cuánto se recuerda un evento sellado, y una campaña en Tus campañas, después de la hora del sorteo: 30 días. */
export const DIAS_DE_LA_LISTA = 30;

export type ReservaDeEvento =
  | { ok: true; reserva: string }
  | { ok: false; motivo: "ya-existe"; sala: string | null }
  | { ok: false; motivo: "cupo-campanas" };

/** Una sala confirmada que quien llama comprobó que ya no existe, con la huella del token de esa sala que presentó. */
export interface ReemplazoDeSala {
  sala: string;
  huella: string;
}

/**
 * Reserva el evento para crear su sala. `ya-existe` trae el id de la sala que lo tiene (null si es una reserva en curso):
 * quien llama mira si esa sala vive y, si no, vuelve a pedir con `reemplazo` para tomar su lugar. El reemplazo vale solo
 * si trae la huella del token de esa misma sala: quien copió el archivo público de una sala cerrada o vencida no se queda
 * con el evento ni gasta el cupo del día. El cupo de `CAMPANAS_POR_DIA` cuenta solo las salas que de verdad se crearon, no
 * las reservas; si no hay lugar, el evento queda como estaba.
 */
export function reservarEventoSql(
  sql: Ejecutar,
  evento: string,
  ahora: number,
  reemplazo: ReemplazoDeSala | null = null,
): ReservaDeEvento {
  crearTablaDeEventos(sql);
  const hay = sql<{ sala: string | null; huella: string | null; en_ms: number }>(
    "SELECT sala, huella, en_ms FROM eventos_campana WHERE evento = ?",
    evento,
  )[0];
  // Un evento sellado no se reabre por ningún camino: ni con el archivo público ni con el token de su sala vieja.
  if (sql("SELECT 1 FROM eventos_sellados WHERE evento = ? AND hasta_ms >= ?", evento, ahora).length > 0) {
    return { ok: false, motivo: "ya-existe", sala: hay?.sala ?? null };
  }
  if (hay) {
    // Una reserva sin confirmar y vieja es un corte entre reservar y crear: el archivo todavía no se mostró en ninguna sala.
    // Una sala confirmada solo se reemplaza si quien llama comprobó que esa misma sala ya no existe y trae su token.
    const abandonada = hay.sala === null && ahora - hay.en_ms >= ESPERA_RESERVA_MS;
    const mismaSala = hay.sala !== null && reemplazo !== null && hay.sala === reemplazo.sala;
    const conSuToken = mismaSala && hay.huella !== null && reemplazo !== null && iguales(hay.huella, reemplazo.huella);
    if (!abandonada && !conSuToken) return { ok: false, motivo: "ya-existe", sala: hay.sala };
  }
  const dia = diaUtc(ahora);
  const creadas = sql<{ n: number }>("SELECT n FROM campanas_creadas WHERE dia = ?", dia)[0]?.n ?? 0;
  if (creadas >= CAMPANAS_POR_DIA) return { ok: false, motivo: "cupo-campanas" };
  const reserva = nuevaReserva();
  if (hay?.sala === null) {
    // Una reserva abandonada: la fila sigue sin sala y sin huella, y vuelve a correr la espera.
    sql("UPDATE eventos_campana SET dia = ?, reserva = ?, en_ms = ? WHERE evento = ?", dia, reserva, ahora, evento);
  } else if (hay) {
    // El reemplazo de una sala muerta: la fila conserva la sala y la huella de su token hasta que la nueva se confirme.
    // Si la creación falla o el Worker se corta, el evento no queda libre para quien solo tenga el archivo público.
    sql("UPDATE eventos_campana SET reserva = ? WHERE evento = ?", reserva, evento);
  } else {
    sql(
      "INSERT INTO eventos_campana (evento, dia, sala, reserva, en_ms) VALUES (?, ?, NULL, ?, ?)",
      evento,
      dia,
      reserva,
      ahora,
    );
  }
  return { ok: true, reserva };
}

/** Una reserva nueva, que nadie puede adivinar. */
const nuevaReserva = (): string => hexadecimal(crypto.getRandomValues(new Uint8Array(16)));

/**
 * La sala confirmada de este evento si su token es el del intento que llega: quien pide otra vez porque no le llegó la
 * respuesta de la primera. Solo quien inventó el token tiene su huella, así que el archivo público no alcanza para nada.
 */
export function salaDelIntentoSql(sql: Ejecutar, evento: string, huella: string): { sala: string; enMs: number } | null {
  crearTablaDeEventos(sql);
  const hay = sql<{ sala: string | null; huella: string | null; en_ms: number }>(
    "SELECT sala, huella, en_ms FROM eventos_campana WHERE evento = ?",
    evento,
  )[0];
  if (!hay || hay.sala === null || hay.huella === null || !iguales(hay.huella, huella)) return null;
  return { sala: hay.sala, enMs: hay.en_ms };
}

/**
 * Confirma la reserva con el id de la sala ya creada y la huella de su token, y gasta un lugar del día. Falso si la reserva
 * ya no es la de este pedido.
 */
export function confirmarEventoSql(
  sql: Ejecutar,
  evento: string,
  a: { reserva: string; sala: string; huella: string; ahora: number; organizadora?: string | null },
): boolean {
  crearTablaDeEventos(sql);
  // La fila puede traer la sala muerta que esta reserva viene a reemplazar: manda la reserva, no que no tenga sala.
  const hay = sql<{ reserva: string }>("SELECT reserva FROM eventos_campana WHERE evento = ?", evento)[0];
  if (!hay || !iguales(hay.reserva, a.reserva)) return false;
  const ahora = a.ahora;
  const dia = diaUtc(ahora);
  // La reserva usada se cambia: no sirve para confirmar otra vez. En un reemplazo, `en_ms` pasa a ser el de la sala nueva.
  // La dueña del evento es la cuenta que nombra el texto firmado de esta sala (null si no la nombra), y ya se sabe: no hay nada
  // que revisar después.
  sql(
    "UPDATE eventos_campana SET sala = ?, huella = ?, dia = ?, reserva = ?, en_ms = CASE WHEN sala IS NULL THEN en_ms ELSE ? END, " +
      "duena = ?, revisada = 1 WHERE evento = ?",
    a.sala,
    a.huella,
    dia,
    nuevaReserva(),
    ahora,
    a.organizadora ?? null,
    evento,
  );
  sql("INSERT INTO campanas_creadas (dia, n) VALUES (?, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1", dia);
  sql("DELETE FROM campanas_creadas WHERE dia < ?", diaUtc(ahora - 3 * 86_400_000));
  return true;
}

/**
 * Deshace una reserva que no llegó a confirmarse (la creación falló). Una reserva nueva se borra. La de un reemplazo deja
 * la fila como estaba, con la sala y la huella de su token (solo se invalida la reserva): así quien organiza puede volver a
 * intentar y quien solo tiene el archivo público sigue sin poder tomar el evento. No toca una sala confirmada.
 */
export function soltarEventoSql(sql: Ejecutar, evento: string, reserva: string): void {
  crearTablaDeEventos(sql);
  sql("DELETE FROM eventos_campana WHERE evento = ? AND sala IS NULL AND reserva = ?", evento, reserva);
  sql("UPDATE eventos_campana SET reserva = ? WHERE evento = ? AND sala IS NOT NULL AND reserva = ?", nuevaReserva(), evento, reserva);
}

/** Las tablas de una sala de campaña. Se crean al crearla, nunca al despertar. Los paquetes 4 y 6 suman las suyas acá. */
export function crearTablasDeCampana(sql: Ejecutar): void {
  crearTablasDeEquipos(sql);
  // La vigilancia de las altas: las activaciones explicadas de la ruta, por día.
  crearTablasDeVigilancia(sql);
  // Una persona, una vez: la huella del id del proveedor con la sal de la sala, y con qué cuenta entró.
  sql("CREATE TABLE IF NOT EXISTS personas (persona TEXT PRIMARY KEY, cuenta TEXT NOT NULL UNIQUE)");
  // Las sesiones que el proveedor rechazó, por conexión y por ventana de 10 minutos.
  sql(
    "CREATE TABLE IF NOT EXISTS campana_rechazos " +
      "(grupo TEXT NOT NULL, ventana INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (grupo, ventana))",
  );
  // Lo mismo por ficha (la huella con sal de la sesión): repetir una ficha mala no gasta el tope de toda la conexión.
  sql(
    "CREATE TABLE IF NOT EXISTS campana_rechazos_ficha " +
      "(ficha TEXT NOT NULL, ventana INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ficha, ventana))",
  );
  // Cuántas veces volvió a entrar cada persona ya anotada, por hora: nadie gira la llave del celular sin límite.
  sql(
    "CREATE TABLE IF NOT EXISTS campana_reingresos " +
      "(persona TEXT NOT NULL, hora INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (persona, hora))",
  );
  // Quien salió con su motivo. La llena el paquete 6. Acá ya se consulta, para que nadie vuelva a entrar.
  sql(
    "CREATE TABLE IF NOT EXISTS campana_quitadas " +
      "(cuenta TEXT PRIMARY KEY, persona TEXT NOT NULL, llave TEXT NOT NULL, motivo TEXT NOT NULL)",
  );
  // Un aviso por cuenta ganadora. Repetir el pedido no agrega otra fila.
  sql("CREATE TABLE IF NOT EXISTS campana_avisos (cuenta TEXT PRIMARY KEY)");
}

function hexadecimal(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return hexadecimal(bytes);
}

/** La sal propia de las huellas de campaña: se inventa una vez y desaparece al borrar la sala. */
export function salDeCampana(sql: Ejecutar): string {
  const hay = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'sal-campana'")[0]?.v;
  if (hay) return hay;
  const sal = hexadecimal(crypto.getRandomValues(new Uint8Array(16)));
  sql("INSERT INTO sala (k, v) VALUES ('sal-campana', ?) ON CONFLICT(k) DO NOTHING", sal);
  return sql<{ v: string }>("SELECT v FROM sala WHERE k = 'sal-campana'")[0]?.v ?? sal;
}

/** La huella del id que dio el proveedor: ni ese id ni una huella sin sal se guardan en la sala. */
export async function huellaDePersona(sql: Ejecutar, usuario: string): Promise<string> {
  // La copia de los bytes mantiene el tipo que pide WebCrypto y no altera la sal.
  const sal = new Uint8Array(deHex(salDeCampana(sql)));
  const clave = await crypto.subtle.importKey("raw", sal, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(usuario));
  return hexadecimal(new Uint8Array(firma));
}

/** El grupo de conexión, irreconocible sin la sal de la sala. */
export async function grupoDeConexion(sql: Ejecutar, ip: string): Promise<string> {
  return (await sha256Hex(`${grupoDeIp(ip)}|${salDeCampana(sql)}`)).slice(0, 16);
}

/** La llave del celular nunca se guarda: solo esta huella sirve para reconocerlo. */
export async function huellaDeLlave(llave: string): Promise<string> {
  return sha256Hex(llave);
}

/** La huella con sal de la ficha (el token de la sesión): sirve para contar repeticiones y no deja el token en la sala. */
export async function huellaDeFicha(sql: Ejecutar, token: string): Promise<string> {
  return (await sha256Hex(`ficha|${salDeCampana(sql)}|${token}`)).slice(0, 16);
}

function esperaDeVentana(ahora: number, ventana: number): number {
  return Math.max(1, Math.ceil(((ventana + 1) * VENTANA_CAMPANA_MS - ahora) / 1000));
}

type TopeDeRechazos = { ok: true } | { ok: false; motivo: "rechazos"; esperaS: number };

/** El tope de la conexión: protege las llamadas al proveedor, así que solo cuenta lo que costó una. */
export function topeDeConexion(sql: Ejecutar, grupo: string, ahora: number): TopeDeRechazos {
  const ventana = Math.floor(ahora / VENTANA_CAMPANA_MS);
  sql("DELETE FROM campana_rechazos WHERE ventana < ?", ventana);
  const n = sql<{ n: number }>("SELECT n FROM campana_rechazos WHERE grupo = ? AND ventana = ?", grupo, ventana)[0]?.n ?? 0;
  if (n >= RECHAZOS_POR_CONEXION) return { ok: false, motivo: "rechazos", esperaS: esperaDeVentana(ahora, ventana) };
  return { ok: true };
}

/**
 * Lo que se mira antes de verificar la sesión: la fase, el pase ya comprobado y los topes de rechazos. Ninguno de estos
 * rechazos gasta el tope de la conexión: no cuestan una llamada al proveedor. El de la ficha corta a quien repite una
 * ficha mala sin llamar a nadie. El de la conexión se saltea si la ficha es de una sesión que ya se verificó hace poco
 * (`reconocida`): esa no va a llamar al proveedor.
 */
export function antesDeVerificar(
  sql: Ejecutar,
  a: { grupo: string; ficha: string; paseVale: boolean; ahora: number; reconocida?: boolean },
): { ok: true } | { ok: false; motivo: "cerrada" | "pase" } | { ok: false; motivo: "rechazos"; esperaS: number } {
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  if (fase !== "abierta") return { ok: false, motivo: "cerrada" };
  // Entre las horas de la campaña: la fase puede seguir «abierta» después de la hora de cierre (nadie la cambió, o la
  // pantalla se quedó sin quien la maneje). Pasada la hora de cierre, el alta no entra y no pregunta nada a nadie.
  const cierra = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'cierra'")[0]?.v ?? 0);
  if (Number.isSafeInteger(cierra) && cierra > 0 && a.ahora >= cierra) return { ok: false, motivo: "cerrada" };
  if (!a.paseVale) return { ok: false, motivo: "pase" };
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  sql("DELETE FROM campana_rechazos_ficha WHERE ventana < ?", ventana);
  const deFicha = sql<{ n: number }>(
    "SELECT n FROM campana_rechazos_ficha WHERE ficha = ? AND ventana = ?",
    a.ficha,
    ventana,
  )[0]?.n ?? 0;
  if (deFicha >= RECHAZOS_POR_FICHA) return { ok: false, motivo: "rechazos", esperaS: esperaDeVentana(a.ahora, ventana) };
  if (a.reconocida === true) return { ok: true };
  return topeDeConexion(sql, a.grupo, a.ahora);
}

/**
 * Anota una sesión que el proveedor rechazó. La ficha siempre suma. La conexión suma solo la primera vez que se ve esa
 * ficha: repetirla no cuesta otra llamada al proveedor, y una sola persona no puede dejar sin tope a las demás. Con
 * `contarConexion` en falso solo suma la ficha: es el caso de la sesión que el proveedor ya dio por buena y todavía
 * espera su cuenta, que no es un rechazo de la conexión (300 personas con cuenta nueva detrás de la misma wifi no pueden
 * llenarlo solas) y sigue frenada por su propio tope de la ficha.
 */
export function contarRechazo(sql: Ejecutar, grupo: string, ficha: string, ahora: number, contarConexion = true): void {
  const ventana = Math.floor(ahora / VENTANA_CAMPANA_MS);
  const vista = sql<{ n: number }>("SELECT n FROM campana_rechazos_ficha WHERE ficha = ? AND ventana = ?", ficha, ventana)[0];
  sql(
    "INSERT INTO campana_rechazos_ficha (ficha, ventana, n) VALUES (?, ?, 1) " +
      "ON CONFLICT(ficha, ventana) DO UPDATE SET n = n + 1",
    ficha,
    ventana,
  );
  if (vista !== undefined || !contarConexion) return;
  sql(
    "INSERT INTO campana_rechazos (grupo, ventana, n) VALUES (?, ?, 1) " +
      "ON CONFLICT(grupo, ventana) DO UPDATE SET n = n + 1",
    grupo,
    ventana,
  );
}

/**
 * Las fichas que el proveedor dio por buenas hace menos de un minuto, cada una con su persona. Solo en memoria y nunca se
 * guardan: si el objeto se desaloja, la persona vuelve a verificarse con el proveedor. Sirve para no llamarlo otra vez por
 * la misma ficha. Pocas a la vez: pasado el máximo se sueltan primero las vencidas y después la más vieja.
 */
export class FichasVerificadas {
  private readonly fichas = new Map<string, { persona: string; hasta: number }>();
  constructor(private readonly maximo = 2_000) {}

  /** La persona de una ficha que sigue vigente, o null. */
  personaDe(ficha: string, ahora: number): string | null {
    const recordada = this.fichas.get(ficha);
    if (!recordada) return null;
    if (recordada.hasta > ahora) return recordada.persona;
    this.fichas.delete(ficha);
    return null;
  }

  /** Recuerda la ficha por `MEMORIA_DE_FICHA_MS`, o hasta que venza su sesión si es antes. */
  recordar(ficha: string, persona: string, ahora: number, vence: number): void {
    if (this.fichas.size >= this.maximo) {
      for (const [clave, valor] of this.fichas) {
        if (valor.hasta <= ahora) this.fichas.delete(clave);
      }
      const masVieja = this.fichas.keys().next().value;
      if (this.fichas.size >= this.maximo && masVieja !== undefined) this.fichas.delete(masVieja);
    }
    this.fichas.delete(ficha);
    this.fichas.set(ficha, { persona, hasta: Math.min(ahora + MEMORIA_DE_FICHA_MS, vence) });
  }

  get cantidad(): number {
    return this.fichas.size;
  }
}

export type PrealtaDeCampana =
  | { ok: true; cuenta: string | null; nombre?: { n: number; v: number; d: string; estado: string } }
  | { ok: false; motivo: "cerrada" | "pase" | "quitada" }
  | { ok: false; motivo: "rechazos" | "cupo-conexion"; esperaS: number };

/**
 * Todo lo que se decide antes de llamar al proveedor, con las huellas ya calculadas. Fase, pase y los topes de rechazos
 * (ver `antesDeVerificar`). Y si la ficha es de una sesión que ya se verificó hace menos de un minuto y su persona sigue
 * anotada, es un reingreso: se resuelve acá, sin llamar al proveedor, y `cuenta` trae su cuenta. Si no, `cuenta` es null
 * y sigue la verificación. El reingreso tiene su propio tope por persona. Si esa persona salió con su motivo, la respuesta
 * es `quitada`, también sin llamar al proveedor: repetir el alta no le sirve y no gasta nada de nadie.
 */
export function prealtaDeCampana(
  sql: Ejecutar,
  fichas: FichasVerificadas,
  a: { grupo: string; ficha: string; llave: string; paseVale: boolean; ahora: number; d?: string },
): PrealtaDeCampana {
  const persona = fichas.personaDe(a.ficha, a.ahora);
  const antes = antesDeVerificar(sql, { ...a, reconocida: persona !== null });
  if (!antes.ok) return antes;
  if (persona === null) return { ok: true, cuenta: null };
  if (sql("SELECT persona FROM campana_quitadas WHERE persona = ? LIMIT 1", persona)[0]) {
    return { ok: false, motivo: "quitada" };
  }
  const anterior = siYaEsta(sql, { persona, llave: a.llave, grupo: a.grupo, ahora: a.ahora, ...(a.d !== undefined ? { d: a.d } : {}) });
  if (anterior === null) {
    // La persona ya no está y no salió con motivo: hay que llamar al proveedor, así que vale el tope de la conexión.
    const tope = topeDeConexion(sql, a.grupo, a.ahora);
    return tope.ok ? { ok: true, cuenta: null } : tope;
  }
  return anterior;
}

/**
 * El reingreso de una persona ya verificada por el proveedor: su cuenta si ya estaba anotada (y la llave de este
 * celular pasa a ser la suya), con su tope por hora. Recuerda la ficha para no llamar al proveedor otra vez en un minuto.
 */
export function reingresoDeCampana(
  sql: Ejecutar,
  fichas: FichasVerificadas,
  a: Reingreso & { ficha: string; vence: number },
): ReingresoDePersona | null {
  const r = siYaEsta(sql, a);
  if (r?.ok === true) fichas.recordar(a.ficha, a.persona, a.ahora, a.vence);
  return r;
}

export type ModoSoloGoogle = "estricto" | "suave";

/** El modo de la exigencia de Google. Solo el valor exacto `suave` la ablanda: cualquier otro, o ninguno, es estricto. */
export const modoSoloGoogle = (valor: string | undefined): ModoSoloGoogle => (valor === "suave" ? "suave" : "estricto");

/**
 * Si se anota a una persona según por dónde dice el proveedor que entró. Es una lista de lo permitido: entra quien el
 * proveedor dice que es de Google, comparado sin importar mayúsculas ni espacios alrededor (eso lo resuelve quien lee la
 * sesión). El modo suave es un interruptor de emergencia: además deja pasar a quien el proveedor no dice por dónde entró
 * (`sin-dato`, que se cuenta aparte). Una vía conocida que no es Google no entra nunca.
 */
export function viaPermitida(
  via: "google" | "otra" | null,
  modo: ModoSoloGoogle,
): { ok: true; via: "google" | "sin-dato" } | { ok: false } {
  if (via === "google") return { ok: true, via: "google" };
  if (via === null && modo === "suave") return { ok: true, via: "sin-dato" };
  return { ok: false };
}

function ritmoDeCampana(sql: Ejecutar, grupo: string, ahora: number) {
  const ventana = Math.floor(ahora / VENTANA_CAMPANA_MS);
  sql("DELETE FROM ritmo WHERE ventana < ?", ventana);
  const ritmo = sql<{ altas: number; envios: number }>(
    "SELECT altas, envios FROM ritmo WHERE grupo = ? AND ventana = ?",
    grupo,
    ventana,
  )[0] ?? { altas: 0, envios: 0 };
  return { ...ritmo, ventana, esperaS: esperaDeVentana(ahora, ventana) };
}

/** Cuenta un envío verificado y, solo en un alta nueva, también una persona de esta conexión. */
function contarEnvio(sql: Ejecutar, grupo: string, ventana: number, nueva: boolean): void {
  sql(
    "INSERT INTO ritmo (grupo, ventana, altas, envios) VALUES (?, ?, ?, 1) " +
      "ON CONFLICT(grupo, ventana) DO UPDATE SET altas = altas + excluded.altas, envios = envios + 1",
    grupo,
    ventana,
    nueva ? 1 : 0,
  );
}

interface Reingreso {
  persona: string;
  llave: string;
  grupo: string;
  ahora: number;
  /**
   * El nombre cifrado que trae el alta. Con el servidor de tu campaña en otra compu, quien vuelve a escanear el QR nuevo trae su
   * nombre con la clave nueva: mientras la fase acepte altas reemplaza al de su fila. Sin él, el reingreso solo cambia la llave.
   */
  d?: string;
}

const HORA_MS = 3_600_000;

/** `nombre` viene solo cuando el reingreso cambió el nombre cifrado de la fila: la pantalla se entera con eso. */
type Reanotada =
  | { ok: true; cuenta: string; n: number; v: number; nombre?: { d: string; estado: string } }
  | { ok: false; esperaS: number };

/**
 * Reconoce a la persona y cambia la huella de su celular sin crear otra fila ni alterar sus datos cifrados. Cada persona
 * puede reingresar `REINGRESOS_POR_PERSONA_POR_HORA` veces por hora: pasado el tope no se escribe nada, así nadie gira la
 * llave de su otro celular ni llena el almacén repitiendo el alta. Si el alta trae su nombre cifrado y la fase todavía acepta
 * altas, la fila pasa también al nombre nuevo (con la clave de la compu nueva): sube `v` igual y la clave nunca viaja.
 */
function reanotar(sql: Ejecutar, a: Reingreso): Reanotada | null {
  const hay = sql<{ cuenta: string; n: number; d: string; estado: string }>(
    "SELECT p.cuenta AS cuenta, e.n AS n, e.d AS d, e.estado AS estado " +
      "FROM personas p JOIN equipos e ON e.cuenta = p.cuenta WHERE p.persona = ?",
    a.persona,
  )[0];
  if (!hay) return null;
  const hora = Math.floor(a.ahora / HORA_MS);
  sql("DELETE FROM campana_reingresos WHERE hora < ?", hora);
  const usados = sql<{ n: number }>("SELECT n FROM campana_reingresos WHERE persona = ? AND hora = ?", a.persona, hora)[0]?.n ?? 0;
  if (usados >= REINGRESOS_POR_PERSONA_POR_HORA) {
    return { ok: false, esperaS: Math.max(1, Math.ceil(((hora + 1) * HORA_MS - a.ahora) / 1000)) };
  }
  sql(
    "INSERT INTO campana_reingresos (persona, hora, n) VALUES (?, ?, 1) ON CONFLICT(persona, hora) DO UPDATE SET n = n + 1",
    a.persona,
    hora,
  );
  const v = siguienteVersion(sql);
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  const nombreNuevo = a.d !== undefined && fase === "abierta";
  if (nombreNuevo && a.d !== undefined) sql("UPDATE equipos SET llave = ?, d = ?, v = ? WHERE n = ?", a.llave, a.d, v, hay.n);
  else sql("UPDATE equipos SET llave = ?, v = ? WHERE n = ?", a.llave, v, hay.n);
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  contarEnvio(sql, a.grupo, ventana, false);
  const nombre = nombreNuevo && a.d !== undefined && a.d !== hay.d ? { d: a.d, estado: hay.estado } : undefined;
  return { ok: true, cuenta: hay.cuenta, n: hay.n, v, ...(nombre ? { nombre } : {}) };
}

/** `nombre` viene solo si el reingreso cambió el nombre cifrado de la fila (con `v` y `n` para avisar a la pantalla). */
export type ReingresoDePersona =
  | { ok: true; cuenta: string; nombre?: { n: number; v: number; d: string; estado: string } }
  | { ok: false; motivo: "cupo-conexion"; esperaS: number };

/**
 * Si la persona ya está anotada: su cuenta, y la llave de este celular pasa a ser la suya (es ella en otro celular).
 * Con el tope de la hora agotado da `cupo-conexion` y no toca nada. Si no está anotada, null.
 */
export function siYaEsta(sql: Ejecutar, a: Reingreso): ReingresoDePersona | null {
  const r = reanotar(sql, a);
  if (r === null) return null;
  if (!r.ok) return { ok: false, motivo: "cupo-conexion", esperaS: r.esperaS };
  return r.nombre ? { ok: true, cuenta: r.cuenta, nombre: { n: r.n, v: r.v, ...r.nombre } } : { ok: true, cuenta: r.cuenta };
}

export interface AltaDePersona extends Reingreso {
  cuenta: string;
  d: string;
  via: "google" | "sin-dato";
}

export type ResultadoDeAltaDePersona =
  | { ok: true; cuenta: string; ya: boolean; v: number; n: number; nombre?: { d: string; estado: string } }
  | { ok: false; motivo: "cerrada" | "quitada" | "ajena" | "rapido" | "llena" }
  | { ok: false; motivo: "cupo-conexion"; esperaS: number };

/** Anota a una persona ya verificada. Desde la primera lectura hasta la última escritura no hay ninguna espera. */
export function anotarPersona(
  sql: Ejecutar,
  alta: AltaDePersona,
  porMinuto: () => boolean,
): ResultadoDeAltaDePersona {
  const ritmo = ritmoDeCampana(sql, alta.grupo, alta.ahora);
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  // Se repite la hora de cierre acá, después de todas las esperas: lo que se comprueba antes puede ser viejo cuando el
  // pedido vuelve de la red. Fuera de hora la respuesta es «cerrada», como con la fase, y el envío de la conexión se
  // cuenta igual: también costó una llamada al proveedor.
  const cierra = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'cierra'")[0]?.v ?? 0);
  if (
    fase !== "abierta" ||
    (Number.isSafeInteger(cierra) && cierra > 0 && alta.ahora >= cierra)
  ) {
    contarEnvio(sql, alta.grupo, ritmo.ventana, false);
    return { ok: false, motivo: "cerrada" };
  }
  const quitada = sql(
    "SELECT cuenta FROM campana_quitadas WHERE persona = ? OR cuenta = ? LIMIT 1",
    alta.persona,
    alta.cuenta,
  )[0];
  if (quitada) {
    // No suma a los envíos de la conexión: quien ya salió repitiendo su alta no puede agotarlos y dejar afuera a las demás.
    return { ok: false, motivo: "quitada" };
  }
  // Se repite la consulta después de la espera del proveedor: dos celulares de la misma persona no se duplican.
  const existente = reanotar(sql, alta);
  if (existente?.ok === false) return { ok: false, motivo: "cupo-conexion", esperaS: existente.esperaS };
  if (existente) {
    return { ok: true, cuenta: existente.cuenta, n: existente.n, v: existente.v, ya: true, ...(existente.nombre ? { nombre: existente.nombre } : {}) };
  }
  if (sql("SELECT cuenta FROM equipos WHERE cuenta = ?", alta.cuenta)[0]) {
    contarEnvio(sql, alta.grupo, ritmo.ventana, false);
    return { ok: false, motivo: "ajena" };
  }
  // El cupo antes que los topes de ritmo (issue #168, en este orden): con la sala llena la respuesta es «llena», no una
  // espera que nunca la va a abrir. Contar el envío de la conexión igual: el alta costó su llamada al proveedor.
  if ((sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c ?? 0) >= CAMPANA_MAX) {
    contarEnvio(sql, alta.grupo, ritmo.ventana, false);
    return { ok: false, motivo: "llena" };
  }
  if (ritmo.envios >= ENVIOS_CAMPANA_POR_CONEXION) {
    return { ok: false, motivo: "cupo-conexion", esperaS: ritmo.esperaS };
  }
  // Recién cuentan las sesiones verificadas: un token malo no gasta el ritmo de toda la sala.
  if (!porMinuto()) {
    contarEnvio(sql, alta.grupo, ritmo.ventana, false);
    return { ok: false, motivo: "rapido" };
  }
  const v = siguienteVersion(sql);
  const n = sql<{ n: number }>(
    "INSERT INTO equipos (cuenta, d, estado, v, llave) VALUES (?, ?, 'aceptado', ?, ?) RETURNING n",
    alta.cuenta,
    alta.d,
    v,
    alta.llave,
  )[0]?.n;
  if (typeof n !== "number") throw new Error("el alta no devolvió su número");
  sql("INSERT INTO personas (persona, cuenta) VALUES (?, ?)", alta.persona, alta.cuenta);
  contarEnvio(sql, alta.grupo, ritmo.ventana, true);
  sql(
    "INSERT INTO sala (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1",
    alta.via === "google" ? "via-google" : "via-sin-dato",
  );
  return { ok: true, cuenta: alta.cuenta, ya: false, v, n };
}

/**
 * Saca a una persona de la lista con su motivo. Sus filas de `equipos` y `personas` pasan a `campana_quitadas`,
 * con la huella de la llave de su celular para que ese celular sepa el motivo. No puede volver a entrar con esa
 * persona ni con esa cuenta. Solo antes de sellar: después del sello nadie sale de la lista.
 */
export function quitarPersona(
  sql: Ejecutar,
  n: number,
  motivo: MotivoDeSalida,
): { ok: true; cuenta: string } | { ok: false; motivo: "fase" | "no-esta" } {
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  if (fase !== "abierta" && fase !== "cerrada") return { ok: false, motivo: "fase" };
  const equipo = sql<{ cuenta: string; llave: string }>(
    "SELECT cuenta, llave FROM equipos WHERE n = ?",
    n,
  )[0];
  if (!equipo) return { ok: false, motivo: "no-esta" };
  const persona = sql<{ persona: string }>(
    "SELECT persona FROM personas WHERE cuenta = ?",
    equipo.cuenta,
  )[0]?.persona;
  if (!persona) return { ok: false, motivo: "no-esta" };
  sql(
    "INSERT INTO campana_quitadas (cuenta, persona, llave, motivo) VALUES (?, ?, ?, ?)",
    equipo.cuenta,
    persona,
    equipo.llave,
    motivo,
  );
  sql("DELETE FROM equipos WHERE n = ?", n);
  sql("DELETE FROM personas WHERE cuenta = ?", equipo.cuenta);
  return { ok: true, cuenta: equipo.cuenta };
}

/** Cuántas salieron por cada motivo. Nunca quiénes. */
export function quitadasPorMotivo(sql: Ejecutar): Record<MotivoDeSalida, number> {
  const totales: Record<MotivoDeSalida, number> = { repetida: 0, evento: 0, pidio: 0, otro: 0 };
  const filas = sql<{ motivo: string; c: number }>(
    "SELECT motivo, COUNT(*) AS c FROM campana_quitadas GROUP BY motivo",
  );
  for (const fila of filas) {
    if (esMotivoDeSalida(fila.motivo)) totales[fila.motivo] = fila.c;
  }
  return totales;
}

/** Las cuentas ganadoras que guardó el resultado, en orden de puesto. Vacío si todavía no hay. */
export function ganadorasGuardadas(sql: Ejecutar): string[] {
  const crudo = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'ganadoras'")[0]?.v;
  if (!crudo) return [];
  try {
    const datos: unknown = JSON.parse(crudo);
    if (!Array.isArray(datos)) return [];
    const cuentas: string[] = [];
    for (const cuenta of datos) {
      if (typeof cuenta !== "string") return [];
      cuentas.push(cuenta);
    }
    return cuentas;
  } catch {
    return [];
  }
}

/** Cuánto vive una reserva de aviso sin terminar: pasado este tiempo, el trabajo en segundo plano ya no puede seguir vivo. */
export const VIDA_DE_RESERVA_DE_AVISO_MS = 120_000;
/** La marca de una cuenta con su aviso ya intentado, y el comienzo de la de una cuenta reservada con su hora. */
const AVISO_HECHO = "1";
const AVISO_RESERVADO = "r";

/** La hora de una reserva de aviso sin terminar, o `null` si la marca es de un aviso ya intentado o no se entiende. */
function horaDeReserva(marca: string): number | null {
  if (!marca.startsWith(AVISO_RESERVADO)) return null;
  const hora = Number(marca.slice(AVISO_RESERVADO.length));
  return Number.isSafeInteger(hora) ? hora : null;
}

/**
 * Reserva, para avisarles por correo, a las ganadoras que todavía no tienen su marca. Lo hace en el mismo bloque síncrono
 * donde lee las marcas, así que dos pedidos a la vez no reservan la misma cuenta. La marca (`correo:<cuenta>`) es lo único
 * que se guarda: ni el correo, ni el nombre, ni el id del proveedor. Las cuentas salen de lo que la sala guardó del resultado
 * (nunca del pedido) y no pasan de la cantidad de premios firmada. La marca nace como reserva con su hora y pasa a "hecha"
 * cuando el intento termina (`cerrarAvisoPorCorreo`), salga bien o mal: un aviso intentado no se repite. Una reserva que nunca
 * terminó, porque el trabajo en segundo plano se cortó o el Worker se reinició, vuelve a reservarse pasado
 * `VIDA_DE_RESERVA_DE_AVISO_MS`, así que a esa cuenta se le avisa la próxima vez que llegue el resultado.
 */
export function reservarAvisosPorCorreo(
  sql: Ejecutar,
  ahora: number,
  opciones: { marca?: boolean } = {},
): { cuenta: string; puesto: number; confirmo?: true }[] {
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  if (fase !== "sorteada") return [];
  const premios = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'premios'")[0]?.v);
  if (!Number.isSafeInteger(premios) || premios < 1) return [];
  const reservadas: { cuenta: string; puesto: number; confirmo?: true }[] = [];
  const ganadoras = ganadorasGuardadas(sql).slice(0, premios);
  ganadoras.forEach((cuenta, puesto) => {
    const clave = `correo:${cuenta}`;
    const marca = sql<{ v: string }>("SELECT v FROM sala WHERE k = ?", clave)[0]?.v;
    if (marca !== undefined) {
      const hora = horaDeReserva(marca);
      if (hora === null || hora + VIDA_DE_RESERVA_DE_AVISO_MS > ahora) return;
    }
    sql(
      "INSERT INTO sala (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      clave,
      `${AVISO_RESERVADO}${ahora}`,
    );
    // La marca de correo confirmado solo se mira si el Worker la acepta: con ella apagada, nadie sale con la versión B por esto.
    const confirmo = opciones.marca === true && sql<{ v: string }>("SELECT v FROM sala WHERE k = ?", `confirmo:${cuenta}`)[0]?.v === "1";
    reservadas.push(confirmo ? { cuenta, puesto, confirmo: true } : { cuenta, puesto });
  });
  return reservadas;
}

/**
 * Anota que el celular de esta cuenta dice que su correo es el de la sesión y está confirmado. Solo la deja quien presenta la
 * llave de su propio celular (una cuenta anotada, sin motivo de salida), y escribe solo si hay algo nuevo que escribir: 300
 * celulares repitiéndola no suman escrituras. Si alguien la manda sin ser verdad, solo cambia el texto de su propio correo.
 */
export function marcarCorreoConfirmado(sql: Ejecutar, cuenta: string, llave: string): boolean {
  const equipo = sql<{ llave: string }>("SELECT llave FROM equipos WHERE cuenta = ?", cuenta)[0];
  if (equipo === undefined || !iguales(equipo.llave, llave)) return false;
  if (sql("SELECT cuenta FROM campana_quitadas WHERE cuenta = ?", cuenta)[0]) return false;
  const clave = `confirmo:${cuenta}`;
  if (sql<{ v: string }>("SELECT v FROM sala WHERE k = ?", clave)[0]?.v === "1") return false;
  sql("INSERT INTO sala (k, v) VALUES (?, '1') ON CONFLICT(k) DO NOTHING", clave);
  return true;
}

/** Deja la marca de una cuenta en "hecha": su aviso ya se intentó y no se repite. Solo toca una reserva que existe. */
export function cerrarAvisoPorCorreo(sql: Ejecutar, cuenta: string): void {
  sql("UPDATE sala SET v = ? WHERE k = ? AND v LIKE 'r%'", AVISO_HECHO, `correo:${cuenta}`);
}

/** Quien organiza le avisa a una ganadora que la esperan en el stand. Solo sorteada y a una cuenta que ganó. */
export function avisarGanadora(sql: Ejecutar, cuenta: string): { ok: true } | { ok: false; motivo: "no-gano" } {
  const fase = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  if (fase !== "sorteada" || !ganadorasGuardadas(sql).includes(cuenta)) {
    return { ok: false, motivo: "no-gano" };
  }
  sql("INSERT INTO campana_avisos (cuenta) VALUES (?) ON CONFLICT(cuenta) DO NOTHING", cuenta);
  return { ok: true };
}

/**
 * El número del sorteo y la ronda de drand del sello, solo con la lista sellada o sorteada. Antes del sello la clave `sorteo`
 * guarda la HORA del sorteo, no el número: por eso nunca se manda en otra fase. Los dos son públicos en la cadena desde el sello.
 * Una sala sellada antes de que se guardara la ronda trae el número y no la ronda (el celular hace lo de siempre).
 */
export function selloPublico(sql: Ejecutar, fase: Fase): { sorteo?: string; ronda?: number } {
  if (fase !== "sellada" && fase !== "sorteada") return {};
  const sorteo = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'sorteo'")[0]?.v;
  if (sorteo === undefined || !/^[0-9]{1,20}$/.test(sorteo)) return {};
  const ronda = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'ronda_sello'")[0]?.v);
  return Number.isSafeInteger(ronda) && ronda >= 1 ? { sorteo, ronda } : { sorteo };
}

export interface EstadoDeCelular {
  fase: Fase;
  total: number;
  cierraMs: number;
  anotada: boolean;
  sorteo?: string;
  ronda?: number;
  quitada?: MotivoDeSalida;
  gano?: boolean;
  puesto?: number;
  avisado?: boolean;
}

/** Lo que ve un celular de sí mismo. Sin la llave correcta, solo lo público y `anotada: false`. */
export function estadoDeCelular(sql: Ejecutar, cuenta: string, llave: string): EstadoDeCelular {
  const valor = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'fase'")[0]?.v;
  if (!esFase(valor)) throw new Error("la campaña no tiene una fase válida");
  const total = sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c ?? 0;
  const cierraMs = Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'cierra'")[0]?.v ?? 0);
  const equipo = sql<{ llave: string }>("SELECT llave FROM equipos WHERE cuenta = ?", cuenta)[0];
  const salida = sql<{ llave: string; motivo: string }>(
    "SELECT llave, motivo FROM campana_quitadas WHERE cuenta = ?",
    cuenta,
  )[0];
  const llaveDeEquipo = equipo !== undefined && iguales(equipo.llave, llave);
  const salidaPropia = salida !== undefined && iguales(salida.llave, llave) ? salida : undefined;
  const sello = selloPublico(sql, valor);
  if (!llaveDeEquipo && !salidaPropia) return { fase: valor, total, cierraMs, anotada: false, ...sello };
  const estado: EstadoDeCelular = {
    fase: valor,
    total,
    cierraMs,
    anotada: llaveDeEquipo && salidaPropia === undefined,
    ...sello,
  };
  if (salidaPropia && esMotivoDeSalida(salidaPropia.motivo)) estado.quitada = salidaPropia.motivo;
  if (valor === "sorteada") {
    const puesto = ganadorasGuardadas(sql).indexOf(cuenta);
    if (puesto >= 0) {
      estado.gano = true;
      estado.puesto = puesto;
    } else if (estado.anotada) {
      estado.gano = false;
    }
  }
  if (sql("SELECT cuenta FROM campana_avisos WHERE cuenta = ?", cuenta)[0]) estado.avisado = true;
  return estado;
}
