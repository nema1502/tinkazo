/**
 * La sala de Tinkazo: que la gente de un stand escanee un QR, escriba su nombre
 * en el celular y lo vea aparecer en la pantalla grande. Solo alimenta rondas
 * de ejemplo (modo stand): esos nombres nunca van a un sorteo sellado ni a un
 * comprobante.
 *
 *   POST   /v1/sala                        → 201 {"id", "token", "vence"}   (solo desde los orígenes permitidos)
 *   POST   /v1/sala/<id>                   un nombre cifrado en text/plain → 201 {"n"}
 *   GET    /v1/sala/<id>/nombres?desde=N   Authorization: Bearer <token>   → 200 [{"n","d"}]
 *   DELETE /v1/sala/<id>/nombres/<n>       Authorization: Bearer <token>   → 204
 *   GET    /v1/sala/<id>/pantalla          WebSocket; el token va en el primer mensaje, no en la dirección
 *   DELETE /v1/sala/<id>                   Authorization: Bearer <token>   → 204 (cierra la sala y borra todo)
 *   GET    /<id>                           la página del celular (HTML, con su CSS y JS adentro)
 *
 * Los equipos de un evento (el registro con cuenta de `equipos.html` en el sitio):
 *   PUT    /v1/sala/<id>/config            Authorization: Bearer <token>   JSON {modo, evento, cuenta} → 204
 *   GET    /v1/sala/<id>/publico           sin token: cómo es el registro y cuántos equipos van → 200 {config, equipos}
 *   POST   /v1/sala/<id>/equipos           JSON {cuenta, d, llave}, con d cifrado con la clave del QR (solo desde el sitio) → 201 {n, estado}
 *                                           (una cuenta ya anotada solo se reescribe con la misma llave: si no, 409 {"error":"ajena"})
 *   GET    /v1/sala/<id>/equipos?desde=V   Authorization: Bearer <token>   → 200 [{n, cuenta, d, estado, v}]
 *   GET    /v1/sala/<id>/equipos/<cuenta>  sin token: en qué punto está ese equipo → 200 {n, estado}
 *   PUT    /v1/sala/<id>/equipos/<n>       Authorization: Bearer <token>   JSON {estado} → 204
 *   DELETE /v1/sala/<id>/equipos/<n>       Authorization: Bearer <token>   → 204
 *
 * Un Durable Object por sala, con SQLite: guarda los nombres CIFRADOS (la clave
 * viaja en el fragmento del QR y nunca llega acá), la huella SHA-256 del token y
 * la hora de creación. Una alarma a las 10 h de creada borra todo. No guarda
 * nombres en claro, ni direcciones IP, ni navegador, ni hora por persona (para
 * contar las salas que arma cada dirección guarda, a lo sumo una hora, una huella
 * con sal que no se devuelve a la dirección; para el tope de altas de equipos
 * por conexión, cada sala guarda una huella con una sal suya, que queda hasta
 * que se borra la sala (las ventanas de 10 minutos que ya pasaron se limpian con
 * cada envío), y de la llave del celular que anotó cada equipo guarda solo su
 * huella SHA-256). Los topes viven en el objeto, que es donde son exactos.
 *
 * El WebSocket hacia la pantalla usa la API de hibernación: un socket quieto
 * no cobra tiempo. Si se corta, la pantalla reconecta y consulta cada 3 s.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ES_ID,
  ES_TOKEN,
  MAX_CUERPO_CONFIG,
  MAX_CUERPO_EQUIPO,
  MAX_EQUIPOS,
  MAX_NOMBRES,
  MAX_SOCKETS,
  EQUIPOS_POR_MINUTO,
  NOMBRES_POR_MINUTO,
  PRESENTARSE_MS,
  SALAS_POR_DIA,
  SALAS_POR_IP_POR_HORA,
  SITIO,
  VIDA_MS,
  VentanaPorMinuto,
  diaUtc,
  equipoCifradoValido,
  esCuentaValida,
  esEstadoEquipo,
  grupoDeIp,
  horaUtc,
  intentarAlta,
  iguales,
  nombreCifradoValido,
  origenPermitido,
  validarConfigEquipos,
} from "./logica";
import type { AltasPorHora, ConfigEquipos, EstadoEquipo } from "./logica";
import { paginaCelular } from "./pagina";
import { ES_LLAVE, anotarEquipo as anotarEnRegistro, crearTablasDeEquipos, quitarEquipo as quitarDelRegistro, siguienteVersion } from "./registro";
import type { Ejecutar } from "./registro";

export interface Env {
  SALA: DurableObjectNamespace<Sala>;
  /** Un solo objeto, "cupos": cuenta las salas nuevas por dirección y por día. */
  CUPOS: DurableObjectNamespace<Cupos>;
  /** Solo para probar la alarma en local: `wrangler dev --var VIDA_PRUEBA_MS:3000`. En producción no existe. */
  VIDA_PRUEBA_MS?: string;
}

const ALFABETO = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Un id de 8 caracteres de base 62, sin sesgo: se descartan los bytes de 248 en adelante. */
function nuevoId(): string {
  let id = "";
  while (id.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && id.length < 8) id += ALFABETO[b % 62];
    }
  }
  return id;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cors(origen: string | null, metodos: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origenPermitido(origen) && origen ? origen : SITIO,
    "Access-Control-Allow-Methods": metodos,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(cuerpo: unknown, estado: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra },
  });
}

/* ------------------------------------------------------------------ los cupos */

type Permiso = { ok: true } | { ok: false; motivo: "cupo-ip" | "cupo-dia" };

/**
 * Cuántas salas se crean: 5 por dirección y por hora y 100 por día en total,
 * las dos cuentas en el SQLite de este objeto, para que dormirse o reiniciarse
 * no las ponga en cero (una cuenta en memoria dejaba a un script pedir otras 5
 * salas cada vez que el objeto se dormía, hasta agotar el día).
 *
 * La dirección no se guarda: el grupo es una huella SHA-256 de la dirección más
 * una sal al azar de esa hora, cortada a 16 caracteres. La sal y las altas de
 * las horas que pasaron se borran en cada alta nueva, así que a lo sumo una
 * hora queda una huella que no se puede devolver a una dirección. Es un objeto
 * aparte para que el tope del día sea uno solo.
 *
 * Sobre el binding de límite de pedidos de Cloudflare (`[[ratelimits]]`): solo
 * admite ventanas de 10 o 60 segundos y sus conteos son aproximados, por
 * ubicación. No puede decir «5 por hora» ni «100 por día», así que no se usa
 * para esto; los topes exactos viven acá y en cada sala.
 */
export class Cupos extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cuotas (dia TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS altas (grupo TEXT NOT NULL, hora INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (grupo, hora))");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sal (hora INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  }

  /** La huella de la dirección en esta hora: la sal se inventa la primera vez que se pide. */
  private async huella(ip: string, hora: number): Promise<string> {
    const sql = this.ctx.storage.sql;
    let sal = sql.exec<{ v: string }>("SELECT v FROM sal WHERE hora = ?", hora).toArray()[0]?.v;
    if (!sal) {
      sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      sql.exec("INSERT INTO sal (hora, v) VALUES (?, ?)", hora, sal);
    }
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${grupoDeIp(ip)}|${sal}`));
    return Array.from(new Uint8Array(h).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async permitir(ip: string): Promise<Permiso> {
    const ahora = Date.now();
    const dia = diaUtc(ahora);
    const sql = this.ctx.storage.sql;
    const hoy = sql.exec<{ n: number }>("SELECT n FROM cuotas WHERE dia = ?", dia).toArray()[0]?.n ?? 0;
    if (hoy >= SALAS_POR_DIA) return { ok: false, motivo: "cupo-dia" };
    const grupo = await this.huella(ip, horaUtc(ahora));
    const altas: AltasPorHora = {
      leer: (g, h) => sql.exec<{ n: number }>("SELECT n FROM altas WHERE grupo = ? AND hora = ?", g, h).toArray()[0]?.n ?? 0,
      sumar: (g, h) => void sql.exec("INSERT INTO altas (grupo, hora, n) VALUES (?, ?, 1) ON CONFLICT(grupo, hora) DO UPDATE SET n = n + 1", g, h),
      olvidarAntes: (h) => {
        sql.exec("DELETE FROM altas WHERE hora < ?", h);
        sql.exec("DELETE FROM sal WHERE hora < ?", h);
      },
    };
    if (!intentarAlta(altas, grupo, ahora, SALAS_POR_IP_POR_HORA)) return { ok: false, motivo: "cupo-ip" };
    sql.exec("INSERT INTO cuotas (dia, n) VALUES (?, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1", dia);
    if (hoy === 0) sql.exec("DELETE FROM cuotas WHERE dia < ?", diaUtc(ahora - 3 * 86_400_000));
    return { ok: true };
  }
}

/* ------------------------------------------------------------------- la sala */

interface Presentacion {
  /** El socket ya mostró el token. */
  ok: boolean;
  /** Cuándo se conectó, para soltar a los que no se presentan. */
  desde: number;
}

/** Lo que el Worker le pide a la sala, por RPC. */
export type Resultado<T = object> =
  | ({ ok: true } & T)
  | { ok: false; motivo: "no-existe" | "token" | "llena" | "rapido" | "sin-registro" | "ajena" }
  | { ok: false; motivo: "cupo-conexion"; esperaS: number };

export class Sala extends DurableObject<Env> {
  private porMinuto = new VentanaPorMinuto(NOMBRES_POR_MINUTO);
  /** Las altas de equipos, aparte de los nombres: unos no pueden dejar afuera a los otros (`EQUIPOS_POR_MINUTO`). */
  private equiposPorMinuto = new VentanaPorMinuto(EQUIPOS_POR_MINUTO);
  private readonly sql: Ejecutar = (consulta, ...parametros) => this.ctx.storage.sql.exec(consulta, ...parametros).toArray() as never;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Un ping de la pantalla se contesta solo, sin despertar al objeto: un socket quieto no cobra.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /**
   * Las tablas nacen al crear la sala, nunca al despertar: cualquiera puede pedir un id al azar, y crearlas
   * ahí dejaría un objeto vacío por cada pedido, sin alarma que lo borre. `deleteAll()` se las lleva también.
   */
  private crearTablas(): void {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sala (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS nombres (n INTEGER PRIMARY KEY AUTOINCREMENT, d TEXT NOT NULL)");
    this.crearTablaDeEquipos();
  }

  /**
   * Los equipos: la cuenta va en claro (es pública y es lo que identifica al equipo); el nombre y los integrantes, cifrados.
   * `v` sube con cada cambio, para que la pantalla que consulta pida solo lo que cambió. Las salas que ya existían antes
   * de esto la crean la primera vez que se las configura. Las tablas y las reglas del alta viven en `registro.ts`.
   */
  private crearTablaDeEquipos(): void {
    crearTablasDeEquipos(this.sql);
  }

  /** Sin tablas no hay sala: nunca se creó, o ya se cerró. */
  private dato(k: string): string | null {
    try {
      return this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM sala WHERE k = ?", k).toArray()[0]?.v ?? null;
    } catch {
      return null;
    }
  }

  private async tokenValido(token: string): Promise<boolean> {
    const huella = this.dato("huella");
    if (!huella || !ES_TOKEN.test(token)) return false;
    return iguales(huella, await sha256Hex(token));
  }

  /** Crea la sala. Una sola vez: un id ya usado devuelve false. */
  async crear(huella: string, vida: number = VIDA_MS): Promise<boolean> {
    if (this.dato("huella")) return false;
    const ahora = Date.now();
    this.crearTablas();
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('huella', ?), ('creada', ?)", huella, String(ahora));
    await this.ctx.storage.setAlarm(ahora + vida);
    return true;
  }

  /** Un nombre cifrado de un celular. */
  async sumar(d: string): Promise<Resultado<{ n: number }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!this.porMinuto.intentar(Date.now())) return { ok: false, motivo: "rapido" };
    const hay = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM nombres").one().c;
    if (hay >= MAX_NOMBRES) return { ok: false, motivo: "llena" };
    const n = this.ctx.storage.sql.exec<{ n: number }>("INSERT INTO nombres (d) VALUES (?) RETURNING n", d).one().n;
    this.avisar({ t: "nombre", n, d });
    return { ok: true, n };
  }

  /** Los nombres de `desde` en adelante, para quien tiene el token: la pantalla que se recargó, o que consulta cada 3 s. */
  async leer(token: string, desde: number): Promise<Resultado<{ nombres: { n: number; d: string }[] }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const nombres = this.ctx.storage.sql
      .exec<{ n: number; d: string }>("SELECT n, d FROM nombres WHERE n > ? ORDER BY n LIMIT ?", desde, MAX_NOMBRES)
      .toArray();
    return { ok: true, nombres };
  }

  /** Saca un nombre, también del objeto. */
  async quitar(token: string, n: number): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    this.ctx.storage.sql.exec("DELETE FROM nombres WHERE n = ?", n);
    this.avisar({ t: "quitado", n });
    return { ok: true };
  }

  /** La configuración del registro de equipos, o null si todavía no se armó. */
  private config(): ConfigEquipos | null {
    const crudo = this.dato("config");
    if (!crudo) return null;
    try {
      return validarConfigEquipos(JSON.parse(crudo));
    } catch {
      return null;
    }
  }

  /** Quien organiza arma (o rearma) el registro: con qué modo y con qué cuenta del evento. */
  async configurar(token: string, config: ConfigEquipos): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    this.crearTablaDeEquipos();
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('config', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(config));
    return { ok: true };
  }

  /** Lo que ve cualquiera con el enlace: cómo es el registro y cuántos equipos van. Nada de nombres. */
  async publico(): Promise<Resultado<{ config: ConfigEquipos | null; equipos: number }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    let equipos = 0;
    try {
      equipos = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM equipos").one().c;
    } catch {
      /* sala anterior a los equipos */
    }
    return { ok: true, config: this.config(), equipos };
  }

  private siguienteVersion(): number {
    return siguienteVersion(this.sql);
  }

  /**
   * Un equipo de un celular. La misma cuenta otra vez, con la misma llave, cambia los datos del equipo, no lo duplica:
   * conserva su número y su estado. Con otra llave (o sin ella) se rechaza y lo que estaba queda igual.
   */
  async anotarEquipo(cuenta: string, d: string, llave: string, ip: string): Promise<Resultado<{ n: number; estado: EstadoEquipo }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    const config = this.config();
    if (!config) return { ok: false, motivo: "sin-registro" };
    const r = await anotarEnRegistro(this.sql, { cuenta, d, llave, ip, ahora: Date.now(), modo: config.modo }, () => this.equiposPorMinuto.intentar(Date.now()));
    if (!r.ok) return r;
    this.avisar({ t: "equipo", v: r.v, n: r.n, cuenta, d, estado: r.estado });
    return { ok: true, n: r.n, estado: r.estado };
  }

  /** Los equipos que cambiaron desde la versión `desde`, para quien tiene el token. */
  async leerEquipos(token: string, desde: number): Promise<Resultado<{ equipos: { n: number; cuenta: string; d: string; estado: string; v: number }[] }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    let equipos: { n: number; cuenta: string; d: string; estado: string; v: number }[] = [];
    try {
      equipos = this.ctx.storage.sql
        .exec<{ n: number; cuenta: string; d: string; estado: string; v: number }>("SELECT n, cuenta, d, estado, v FROM equipos WHERE v > ? ORDER BY v LIMIT ?", desde, MAX_EQUIPOS)
        .toArray();
    } catch {
      /* sala anterior a los equipos */
    }
    return { ok: true, equipos };
  }

  /** En qué punto está el equipo de esta cuenta. Lo pregunta el celular de su encargado. */
  async equipoDe(cuenta: string): Promise<Resultado<{ n: number; estado: string }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    let fila: { n: number; estado: string } | undefined;
    try {
      fila = this.ctx.storage.sql.exec<{ n: number; estado: string }>("SELECT n, estado FROM equipos WHERE cuenta = ?", cuenta).toArray()[0];
    } catch {
      /* sala anterior a los equipos */
    }
    return fila ? { ok: true, n: fila.n, estado: fila.estado } : { ok: false, motivo: "no-existe" };
  }

  /** Quien organiza cambia el punto en que está un equipo: lo ve el celular de su encargado. */
  async cambiarEstado(token: string, n: number, estado: EstadoEquipo): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const sql = this.ctx.storage.sql;
    let fila: { cuenta: string; d: string } | undefined;
    try {
      fila = sql.exec<{ cuenta: string; d: string }>("SELECT cuenta, d FROM equipos WHERE n = ?", n).toArray()[0];
    } catch {
      /* sala anterior a los equipos */
    }
    if (!fila) return { ok: false, motivo: "no-existe" };
    const v = this.siguienteVersion();
    sql.exec("UPDATE equipos SET estado = ?, v = ? WHERE n = ?", estado, v, n);
    this.avisar({ t: "equipo", v, n, cuenta: fila.cuenta, d: fila.d, estado });
    return { ok: true };
  }

  /** Saca un equipo, también del objeto. */
  async quitarEquipo(token: string, n: number): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    try {
      quitarDelRegistro(this.sql, n);
    } catch {
      /* sala anterior a los equipos */
    }
    this.avisar({ t: "equipo-quitado", n });
    return { ok: true };
  }

  /** Cierra la sala: avisa a la pantalla, suelta los sockets y borra todo, la alarma también. */
  async cerrar(token: string): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    await this.borrarTodo("cerrada");
    return { ok: true };
  }

  private async borrarTodo(motivo: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, motivo);
      } catch {
        /* ya cerrado */
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** A las 10 h de creada: no queda nada. */
  override async alarm(): Promise<void> {
    await this.borrarTodo("vencida");
  }

  /** Manda un mensaje a la pantalla presentada. */
  private avisar(m: object): void {
    const texto = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Presentacion | null)?.ok) {
        try {
          ws.send(texto);
        } catch {
          /* el socket se cae solo */
        }
      }
    }
  }

  /** La pantalla abre un WebSocket. El token no va en la dirección: va en el primer mensaje. */
  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Se esperaba un WebSocket.", { status: 426 });
    if (!this.dato("huella")) return new Response("No existe.", { status: 404 });
    const ahora = Date.now();
    const abiertos = this.ctx.getWebSockets();
    if (abiertos.length >= MAX_SOCKETS) {
      // Hay lugar si alguno lleva callado más de lo que se permite sin presentarse.
      let libre = false;
      for (const ws of abiertos) {
        const p = ws.deserializeAttachment() as Presentacion | null;
        if (!p?.ok && ahora - (p?.desde ?? 0) > PRESENTARSE_MS) {
          ws.close(4408, "sin presentarse");
          libre = true;
        }
      }
      if (!libre) return new Response("Demasiadas conexiones.", { status: 429 });
    }
    const [cliente, servidor] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(servidor);
    servidor.serializeAttachment({ ok: false, desde: ahora } satisfies Presentacion);
    return new Response(null, { status: 101, webSocket: cliente });
  }

  override async webSocketMessage(ws: WebSocket, mensaje: ArrayBuffer | string): Promise<void> {
    let m: { t?: unknown; token?: unknown } = {};
    try {
      m = JSON.parse(typeof mensaje === "string" ? mensaje : new TextDecoder().decode(mensaje)) as typeof m;
    } catch {
      /* no es JSON */
    }
    const estado = ws.deserializeAttachment() as Presentacion | null;
    if (m.t === "hola" && typeof m.token === "string" && (await this.tokenValido(m.token))) {
      // Una sola pantalla a la vez: la que se presenta desplaza a la anterior.
      for (const otro of this.ctx.getWebSockets()) {
        if (otro !== ws && (otro.deserializeAttachment() as Presentacion | null)?.ok) otro.close(4000, "reemplazada");
      }
      ws.serializeAttachment({ ok: true, desde: estado?.desde ?? Date.now() } satisfies Presentacion);
      const hay = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM nombres").one().c;
      ws.send(JSON.stringify({ t: "listo", hay }));
      return;
    }
    // Cualquier otra cosa antes de presentarse es un error; después, no se espera nada.
    if (!estado?.ok) ws.close(4401, "token");
  }

  override async webSocketClose(ws: WebSocket, codigo: number, razon: string): Promise<void> {
    try {
      ws.close(codigo >= 1000 && codigo < 5000 && codigo !== 1005 && codigo !== 1006 ? codigo : 1000, razon);
    } catch {
      /* ya cerrado */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      /* ya cerrado */
    }
  }
}

/* --------------------------------------------------------------- el Worker */

const CABECERAS_PAGINA = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  // Solo lo suyo: ningún otro origen, ni de imágenes, ni de scripts, ni de conexiones.
  "Content-Security-Policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function bearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
}

/** El cuerpo de un pedido como JSON, o `null` si no es JSON o pasa del tope. */
async function leerJson(req: Request, tope: number): Promise<unknown> {
  const largo = Number(req.headers.get("Content-Length") ?? "NaN");
  if (!Number.isFinite(largo) || largo <= 0 || largo > tope) return null;
  try {
    return JSON.parse(await req.text());
  } catch {
    return null;
  }
}

const MOTIVOS: Record<string, number> = { "no-existe": 404, token: 403, llena: 429, rapido: 429, "sin-registro": 409, ajena: 409, "cupo-conexion": 429 };

function falla(r: { motivo: string; esperaS?: number }, h: Record<string, string>): Response {
  const extra = r.motivo === "rapido" ? { ...h, "Retry-After": "30" } : r.motivo === "cupo-conexion" ? { ...h, "Retry-After": String(r.esperaS ?? 600) } : h;
  return json({ error: r.motivo }, MOTIVOS[r.motivo] ?? 400, extra);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origen = req.headers.get("Origin");
    const partes = url.pathname.split("/").filter(Boolean);
    const salaDe = (id: string) => env.SALA.get(env.SALA.idFromName(id));

    if (partes[0] === "v1" && partes[1] === "sala") {
      const id = partes[2];
      const metodos = "GET, POST, PUT, DELETE, OPTIONS";
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origen, metodos) });
      const h = cors(origen, metodos);

      // Crear una sala: solo desde el sitio.
      if (partes.length === 2 && req.method === "POST") {
        if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
        const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
        const permiso = await env.CUPOS.get(env.CUPOS.idFromName("cupos")).permitir(ip);
        if (!permiso.ok) return json({ error: permiso.motivo }, 429, { ...h, "Retry-After": permiso.motivo === "cupo-ip" ? "3600" : "86400" });
        const token = base64url(crypto.getRandomValues(new Uint8Array(16)));
        const prueba = Number(env.VIDA_PRUEBA_MS);
        const vida = Number.isFinite(prueba) && prueba >= 1000 && prueba < VIDA_MS ? prueba : VIDA_MS;
        for (let intento = 0; intento < 5; intento++) {
          const nuevo = nuevoId();
          if (await salaDe(nuevo).crear(await sha256Hex(token), vida)) return json({ id: nuevo, token, vence: Date.now() + vida }, 201, h);
        }
        return json({ error: "ocupado" }, 503, h);
      }

      if (!id || !ES_ID.test(id)) return json({ error: "no-existe" }, 404, h);

      // Un nombre cifrado, desde el celular (la página de abajo, del mismo origen).
      if (partes.length === 3 && req.method === "POST") {
        const largo = Number(req.headers.get("Content-Length") ?? "NaN");
        if (!Number.isFinite(largo)) return json({ error: "largo" }, 411, h);
        if (largo <= 0 || largo > 400) return json({ error: "tamaño" }, 413, h);
        const cuerpo = (await req.text()).trim();
        if (!nombreCifradoValido(cuerpo)) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).sumar(cuerpo);
        return r.ok ? json({ n: r.n }, 201, h) : falla(r, h);
      }

      // Cerrar la sala.
      if (partes.length === 3 && req.method === "DELETE") {
        const r = await salaDe(id).cerrar(bearer(req));
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // Los nombres, para la pantalla que se recargó o que consulta cada 3 s.
      if (partes.length === 4 && partes[3] === "nombres" && req.method === "GET") {
        const desde = Math.max(0, Math.floor(Number(url.searchParams.get("desde") ?? "0")) || 0);
        const r = await salaDe(id).leer(bearer(req), desde);
        return r.ok ? json(r.nombres, 200, h) : falla(r, h);
      }

      // Quitar un nombre.
      if (partes.length === 5 && partes[3] === "nombres" && req.method === "DELETE") {
        const n = Number(partes[4]);
        if (!Number.isInteger(n) || n < 1) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).quitar(bearer(req), n);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // Los equipos: el registro con cuenta. Quien organiza lo configura; el celular de cada encargado anota su equipo.
      if (partes[3] === "config" && partes.length === 4 && req.method === "PUT") {
        const cuerpo = await leerJson(req, MAX_CUERPO_CONFIG);
        const config = cuerpo === null ? null : validarConfigEquipos(cuerpo);
        if (!config) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).configurar(bearer(req), config);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }
      if (partes[3] === "publico" && partes.length === 4 && req.method === "GET") {
        const r = await salaDe(id).publico();
        return r.ok ? json({ config: r.config, equipos: r.equipos }, 200, h) : falla(r, h);
      }
      if (partes[3] === "equipos") {
        if (partes.length === 4 && req.method === "POST") {
          if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
          const cuerpo = (await leerJson(req, MAX_CUERPO_EQUIPO)) as { cuenta?: unknown; d?: unknown; llave?: unknown } | null;
          if (!cuerpo || typeof cuerpo.cuenta !== "string" || !esCuentaValida(cuerpo.cuenta) || !equipoCifradoValido(cuerpo.d)) return json({ error: "forma" }, 400, h);
          // La llave del celular: sin ella no hay forma de probar después que es el mismo celular.
          if (typeof cuerpo.llave !== "string" || !ES_LLAVE.test(cuerpo.llave)) return json({ error: "forma" }, 400, h);
          const r = await salaDe(id).anotarEquipo(cuerpo.cuenta, cuerpo.d, cuerpo.llave, req.headers.get("CF-Connecting-IP") ?? "sin-ip");
          return r.ok ? json({ n: r.n, estado: r.estado }, 201, h) : falla(r, h);
        }
        if (partes.length === 4 && req.method === "GET") {
          const desde = Math.max(0, Math.floor(Number(url.searchParams.get("desde") ?? "0")) || 0);
          const r = await salaDe(id).leerEquipos(bearer(req), desde);
          return r.ok ? json(r.equipos, 200, h) : falla(r, h);
        }
        const quien = partes[4] ?? "";
        if (partes.length === 5 && req.method === "GET" && esCuentaValida(quien)) {
          const r = await salaDe(id).equipoDe(quien);
          return r.ok ? json({ n: r.n, estado: r.estado }, 200, h) : falla(r, h);
        }
        if (partes.length === 5 && (req.method === "PUT" || req.method === "DELETE")) {
          const n = Number(quien);
          if (!Number.isInteger(n) || n < 1) return json({ error: "forma" }, 400, h);
          if (req.method === "DELETE") {
            const r = await salaDe(id).quitarEquipo(bearer(req), n);
            return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
          }
          const cuerpo = (await leerJson(req, 200)) as { estado?: unknown } | null;
          if (!cuerpo || !esEstadoEquipo(cuerpo.estado)) return json({ error: "forma" }, 400, h);
          const r = await salaDe(id).cambiarEstado(bearer(req), n, cuerpo.estado);
          return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
        }
      }

      // La pantalla abre su WebSocket. Los navegadores mandan el origen: solo el sitio.
      if (partes.length === 4 && partes[3] === "pantalla" && req.method === "GET") {
        if (origen && !origenPermitido(origen)) return json({ error: "origen" }, 403, h);
        return salaDe(id).fetch(req);
      }
      return json({ error: "no-existe" }, 404, h);
    }

    // La página del celular: s.tinkazo.app/<id>. No toca la sala: la pregunta la hace la página al sumar.
    if (req.method === "GET" && partes.length === 1 && partes[0] && ES_ID.test(partes[0])) {
      return new Response(paginaCelular(), { headers: CABECERAS_PAGINA });
    }
    if (req.method === "GET" && partes.length === 0) return Response.redirect(SITIO, 302);
    return new Response("No existe.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
} satisfies ExportedHandler<Env>;
