/**
 * El servicio de campañas de Tinkazo (#182): empresas, eventos por ciudad y bases con su huella.
 *
 * Un Worker con un Durable Object con SQLite. El objeto guarda las empresas (con identificadores
 * opacos), las campañas con sus eventos por ciudad, sus pasos, sus premios, quien organiza cada
 * evento y su estado, y las bases armadas con los datos, publicadas con su huella. Alrededor:
 *
 *   POST /v1/empresas                              (con la clave de administración) crea una empresa
 *        200 {id}                                  503 {motivo:"apagado"}   401 {motivo:"clave"}
 *   POST /v1/empresas/<id>/campanas                (con el secreto de esa empresa) carga la campaña
 *        200 {evento, huellaBases, organizadora}   400 {motivo:"cupo"|"campana"|"organizadora"|"cuerpo", campo?}
 *        404 {motivo:"empresa"}   409 {motivo:"evento-repetido"}   503 {motivo:"secreto"}
 *   GET  /v1/campanas                              el inventario que consume el comprobante y las entregas (#176)
 *   GET  /v1/campanas/<evento>/bases               las bases publicadas, con su huella (va al depósito)
 *   GET  /v1/campanas/<evento>/invitacion          la invitación a quien organiza, con un enlace
 *   GET  /v1/campanas/<evento>/informe             el informe de cierre, sin la lista
 *        404 {motivo:"no-existe"}
 *
 * Los secretos de cada empresa son un secreto de Wrangler cada uno (`SECRETO_<ID>`, con el
 * identificador opaco en mayúsculas): el código no guarda nombres ni secretos, solo los lee del
 * entorno (S6). Al dar de alta una campaña, el servicio le pasa a comisiones solo lo que el alta
 * decidió —cupo, horas y estado— por el enlace `COMISIONES_URL` (S5); sus rutas no se tocan (S8).
 */
import { DurableObject } from "cloudflare:workers";
import { avisarComisiones, type AvisoDeComisiones, type EnvDeComisiones } from "./comisiones";
import {
  EventoRepetido,
  armarInforme,
  crearTablas,
  guardarCampana,
  guardarEmpresa,
  leerBases,
  leerCampanaGuardada,
  leerInventario,
  type Sql,
} from "./datos";
import { leerCampana, type Campana, type EstadoDeCampana } from "../../../src/campana/modelo";

/** Lo más que se acepta de cuerpo: la configuración de la campaña pesa menos de 90 KB en la sala. */
const MAX_CUERPO = 120_000;
/** El tope de la clave de administración. */
const ADMIN_MINIMO = 32;
/** El cupo que el alta puede decidir: una sala de campaña admite 300 personas. */
const CUPO_MAXIMO = 300;
const ES_CUENTA = /^G[A-Z2-7]{55}$/u;
const ENLACE_BASE = "https://tinkazo.app";

export interface EnvCampanas extends EnvDeComisiones {
  /** El objeto con el SQLite de las campañas. */
  CAMPANAS: unknown;
  /** La clave de administración que crea empresas. Sin ella, `POST /v1/empresas` contesta apagada. */
  ADMIN_TOKEN?: string;
  /** La base de los enlaces de invitación. Sin ella, el sitio público de siempre. */
  ENLACE_BASE?: string;
  /** El secreto de cada empresa: `SECRETO_<ID>`, con el identificador opaco en mayúsculas. */
  [clave: string]: unknown;
}

function json(cuerpo: unknown, estado: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra },
  });
}

/** Si `dado` es el secreto esperado, en tiempo constante: se comparan las huellas SHA-256 de los dos (siempre de 32 bytes) juntando todas las diferencias. No usa `timingSafeEqual` de Cloudflare para que se pueda probar en Node, como en el portero. */
async function esElSecreto(dado: string, secreto: string): Promise<boolean> {
  const huella = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([huella(dado), huella(secreto)]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diferencia = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diferencia |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferencia === 0;
}

const conBearer = (request: Request): string => /^Bearer (.+)$/u.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";

const esEntero = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);

/** Lo que el objeto responde a un alta de campaña: el resultado o por qué no. */
export type RespuestaDeAlta =
  | { ok: true; evento: string; huellaBases: string; organizadora: string | null }
  | { ok: false; motivo: "empresa" | "evento-repetido" | "cupo" | "campana" | "organizadora" | "forma"; campo?: string };

export class Campanas extends DurableObject<EnvCampanas> {
  private sql: Sql;
  private reloj: () => number;

  constructor(ctx: DurableObjectState, env: EnvCampanas, reloj: () => number = () => Date.now()) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.sql = { exec: (consulta, ...enlaces) => sql.exec(consulta, ...enlaces), transaccion: (fn) => ctx.storage.transactionSync(fn) };
    this.reloj = reloj;
    crearTablas(this.sql);
  }

  /** `POST /v1/empresas`: una empresa nueva, conocida solo por su identificador opaco. */
  altaEmpresa(): { id: string } {
    const id = crypto.randomUUID().replaceAll("-", "");
    guardarEmpresa(this.sql, id, this.reloj());
    return { id };
  }

  /** `POST /v1/empresas/<id>/campanas`: guarda la campaña, sus tablas y sus bases con su huella. */
  altaCampana(empresa: string, pedido: unknown): RespuestaDeAlta {
    if (!esEntero((pedido as Record<string, unknown>)["cupo"])) return { ok: false, motivo: "cupo" };
    const cupo = (pedido as Record<string, unknown>)["cupo"] as number;
    if (cupo < 1 || cupo > CUPO_MAXIMO) return { ok: false, motivo: "cupo" };
    const organizadora = (pedido as Record<string, unknown>)["organizadora"];
    if (organizadora !== null && !(typeof organizadora === "string" && ES_CUENTA.test(organizadora))) {
      return { ok: false, motivo: "organizadora" };
    }
    const lectura = leerCampana((pedido as Record<string, unknown>)["campana"]);
    if (!lectura.ok) return { ok: false, motivo: "campana", campo: lectura.campo };
    if (!sqlTieneEmpresa(this.sql, empresa)) return { ok: false, motivo: "empresa" };
    const guardada = guardarCampana(this.sql, empresa, { cupo, organizadora: organizadora as string | null, campana: lectura.campana }, this.reloj());
    return { ok: true, ...guardada };
  }

  /** `GET /v1/campanas`: el inventario de campañas, con lo que cada una declaró. */
  inventario(): { campanas: Array<Record<string, unknown>> } {
    return { campanas: leerInventario(this.sql) };
  }

  /** `GET /v1/campanas/<evento>/bases`: las bases publicadas con su huella. */
  basesDe(evento: string): Record<string, unknown> | null {
    const bases = leerBases(this.sql, evento);
    return bases ? { ...bases } : null;
  }

  /** `GET /v1/campanas/<evento>/invitacion`: la invitación a quien organiza, con un enlace. */
  invitacionDe(evento: string): Record<string, unknown> | null {
    const fila = leerCampanaGuardada(this.sql, evento);
    if (!fila) return null;
    const base = (String(this.env["ENLACE_BASE"] ?? "") || ENLACE_BASE).replace(/\/+$/u, "");
    return { evento, organizadora: fila["organizadora"], enlace: `${base}/?campana=${evento}` };
  }

  /** `GET /v1/campanas/<evento>/informe`: el informe de cierre, sin la lista. */
  informeDe(evento: string): Record<string, unknown> | null {
    return armarInforme(this.sql, evento);
  }
}

function sqlTieneEmpresa(sql: Sql, id: string): boolean {
  return sql.exec("select id from empresas where id = ?", id).toArray().length > 0;
}

// ---------- el Worker de la puerta ----------

export default {
  async fetch(request: Request, env: EnvCampanas): Promise<Response> {
    const url = new URL(request.url);
    const objeto = env.CAMPANAS as unknown as { get(id: unknown): Campanas; idFromName(nombre: string): unknown };
    const campanas = objeto.get(objeto.idFromName("campanas"));

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" },
      });
    }

    // Una empresa nueva: solo con la clave de administración. Sin clave cargada, apagada.
    if (url.pathname === "/v1/empresas" && request.method === "POST") {
      const clave = env.ADMIN_TOKEN ?? "";
      if (clave.length < ADMIN_MINIMO) return json({ motivo: "apagado" }, 503);
      if (!(await esElSecreto(conBearer(request), clave))) return json({ motivo: "clave" }, 401);
      return json(campanas.altaEmpresa(), 200);
    }

    // El alta de una campaña de una empresa: con su secreto, que es un secreto de Wrangler.
    const alta = /^\/v1\/empresas\/([A-Za-z0-9]{1,64})\/campanas$/u.exec(url.pathname);
    if (alta?.[1]) {
      if (request.method !== "POST") return json({ motivo: "metodo" }, 405);
      const id = alta[1];
      const secreto = env[`SECRETO_${id.toUpperCase()}`];
      if (typeof secreto !== "string" || secreto.length < ADMIN_MINIMO) return json({ motivo: "secreto" }, 503);
      if (!(await esElSecreto(conBearer(request), secreto))) return json({ motivo: "secreto" }, 401);
      let texto = await request.text();
      if (texto.length > MAX_CUERPO) return json({ motivo: "cuerpo" }, 413);
      let pedido: unknown;
      try {
        pedido = JSON.parse(texto);
      } catch {
        return json({ motivo: "cuerpo" }, 400);
      }
      let r: RespuestaDeAlta;
      try {
        r = campanas.altaCampana(id, pedido);
      } catch (e) {
        if (e instanceof EventoRepetido) return json({ motivo: "evento-repetido" }, 409);
        return json({ motivo: "interno" }, 500);
      }
      if (!r.ok) return json({ motivo: r.motivo, ...(r.campo !== undefined ? { campo: r.campo } : {}) }, 400);
      // El aviso a comisiones sale después de guardar el alta, y un fallo suyo no la tumba (S5).
      const lectura = leerConfigDelAlta(pedido);
      if (lectura) {
        const aviso: AvisoDeComisiones = { evento: r.evento, empresa: id, cupo: lectura.cupo, horas: lectura.horas, estado: lectura.estado };
        await avisarComisiones(env, aviso);
      }
      return json({ evento: r.evento, huellaBases: r.huellaBases, organizadora: r.organizadora }, 200);
    }

    // El inventario público: lo que el comprobante y las entregas (#176) miran de cada campaña.
    if (url.pathname === "/v1/campanas") {
      if (request.method !== "GET") return json({ motivo: "metodo" }, 405);
      return json(campanas.inventario(), 200, { "Access-Control-Allow-Origin": "*" });
    }

    // Las rutas públicas de un evento: sus bases, la invitación de quien organiza y el informe.
    const evento = /^\/v1\/campanas\/([a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9]))\/(bases|invitacion|informe)$/u.exec(url.pathname);
    if (evento?.[1]) {
      if (request.method !== "GET") return json({ motivo: "metodo" }, 405);
      const cuerpo = evento[2] === "bases" ? campanas.basesDe(evento[1]) : evento[2] === "invitacion" ? campanas.invitacionDe(evento[1]) : campanas.informeDe(evento[1]);
      return cuerpo ? json(cuerpo, 200) : json({ motivo: "no-existe" }, 404);
    }

    return json({ motivo: "no-existe" }, 404);
  },
};

/**
 * Lo que el aviso a comisiones lleva, leído del pedido ya validado: solo el cupo, las horas y el
 * estado que decidió el alta. Si algo no cuadra, el aviso no sale (el alta ya quedó guardada).
 */
function leerConfigDelAlta(pedido: unknown): { cupo: number; horas: { abreMs: number; cierraMs: number; sorteoMs: number; recibirHastaMs: number }; estado: EstadoDeCampana } | null {
  const x = pedido as Record<string, unknown> | null;
  if (!x || !esEntero(x["cupo"])) return null;
  const lectura = leerCampana(x["campana"]);
  if (!lectura.ok) return null;
  const c: Campana = lectura.campana;
  return {
    cupo: x["cupo"],
    horas: { abreMs: c.abreMs, cierraMs: c.cierraMs, sorteoMs: c.sorteoMs, recibirHastaMs: c.recibirHastaMs },
    estado: c.estado,
  };
}
