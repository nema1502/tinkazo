import { createHmac } from "node:crypto";
import { type Dependencias, type Entorno, type Libro, type Memoria, CLAVE_MEMORIA, inicioDeResumen, leerMemoria, vuelta } from "./vuelta";
import { olvidarMemoriaDeLaRuta } from "./memoria-ruta";
import { olvidarPrueba } from "./publica";
import { type Registrar, registrador } from "./registro";

/**
 * Todo el mundo de mentira junto, para las pruebas: un portero que contesta lo que se le diga, un espacio de KV en
 * memoria, un binding de correo que anota lo que le mandan, un Telegram que hace lo mismo y un reloj que se mueve a
 * mano. Ninguna prueba toca una red de verdad. Solo lo usan las pruebas.
 */

/** Sábado 14 de noviembre de 2026, 09:00 UTC (las 5 de la mañana en Bolivia): el día del evento. */
export const T0 = Date.UTC(2026, 10, 14, 9, 0, 0);
export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;

/** Lo que son de mentira. Ninguno es un secreto de verdad. */
export const CLAVE_DE_OPERAR = "clave-de-operar-inventada-0123456789abcdef";
export const DESTINO = "dueno@example.org";
export const OTRO_DESTINO = "socia@example.org";
export const BOT = "123456:token-inventado-del-bot";
export const CHAT = "987654321";
export const PORTERO = "https://pm.tinkazo.app";

/** Un `/estado` del portero de mainnet con todo en orden (los campos que manda de verdad). */
export const estadoBien = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  modo: "portero",
  red: "mainnet",
  patrocinadora: "GPATROCINADORAINVENTADAPARALASPRUEBASDELPORTERODEMAINNET",
  llave: "GLLAVEINVENTADAPARALASPRUEBASDELPORTERODEMAINNETQUEFIRMA",
  alerta: false,
  balanceStroops: "500000000",
  saldoAlertaStroops: 200000000,
  creditos: 9000,
  piso: 2000,
  margen: 7000,
  altasPausadas: false,
  firmasSinExplicar: 2,
  firmas: { cobradas: 30, explicadas: 28, sellos: 20, sorteos: 6, activaciones: 2, completo: true, desde: 0 },
  patrocinioPollar: { esperado: true, prendidos: [] },
  // Los manda el portero vivo (con las altas prendidas en mainnet) aunque la venta esté cerrada. La revisión no los mira.
  pagosSueltos: 0,
  ventaPausada: false,
  ...extra,
});

export class LibroFalso implements Libro {
  datos = new Map<string, string>();
  lecturas = 0;
  escrituras = 0;
  fallaLectura = false;
  fallaEscritura = false;
  async get(clave: string): Promise<string | null> {
    this.lecturas++;
    if (this.fallaLectura) throw new Error("kv-caido");
    return this.datos.get(clave) ?? null;
  }
  async put(clave: string, valor: string): Promise<void> {
    this.escrituras++;
    if (this.fallaEscritura) throw new Error("kv-caido");
    this.datos.set(clave, valor);
  }
}

export interface MensajeEnviado {
  to: string[];
  from: { email: string; name?: string };
  subject: string;
  text: string;
  [otra: string]: unknown;
}

export class CorreoFalso {
  /** Todo lo que salió, en orden. */
  enviados: MensajeEnviado[] = [];
  /** Lo que salió sin los resúmenes del día: para las pruebas que cruzan las 12:00 UTC y no miran el resumen. */
  get avisos(): MensajeEnviado[] {
    return this.enviados.filter((c) => !c.subject.startsWith("Resumen del portero"));
  }
  intentos = 0;
  /** Si hay algo acá, el siguiente envío falla con ese código (como los errores de Cloudflare: Error con `code`). */
  falla: string | null = null;
  async send(mensaje: MensajeEnviado): Promise<{ messageId: string }> {
    this.intentos++;
    if (this.falla) throw Object.assign(new Error(`falla del correo: ${this.falla}`), { code: this.falla });
    this.enviados.push(mensaje);
    return { messageId: `id-${this.enviados.length}` };
  }
}

export type FallaDelPortero = "red" | "tiempo" | "json" | "invalido" | number | null;

export interface MundoFalso {
  env: Entorno;
  dep: Dependencias;
  libro: LibroFalso;
  correo: CorreoFalso;
  reloj: { ahora: number };
  /** Lo que contesta el portero a `/estado`. */
  portero: { estado: unknown; falla: FallaDelPortero; llamadas: Array<{ url: string; autorizacion: string | null; metodo: string }> };
  telegram: { llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }>; falla: number | null };
  /** Todo lo que el vigilante escribió en su registro, ya como texto. */
  registro: string[];
  /** Corre una vuelta, como la del reloj. */
  vuelta: () => Promise<Awaited<ReturnType<typeof vuelta>>>;
  /** Mueve el reloj y corre una vuelta. */
  vueltaEn: (minutos: number) => Promise<Awaited<ReturnType<typeof vuelta>>>;
  avanzar: (ms: number) => void;
  /** Lo que el vigilante tiene guardado. */
  memoria: () => Promise<Memoria>;
  /** Los asuntos de lo enviado por correo, en orden. */
  asuntos: () => string[];
}

export interface OpcionesDelMundo {
  env?: Partial<Entorno>;
  /** Cuando es true, la primera vuelta no manda el resumen del día (ya se mandó en la ranura de ahora). Por defecto, sí está mandado. */
  sinResumenPendiente?: boolean;
  estado?: unknown;
  conTelegram?: boolean;
  ahora?: number;
}

/** El mundo, con el portero en orden y el resumen de la ranura de ahora ya mandado (para no ensuciar las pruebas que miran otra cosa). */
export function mundoFalso(o: OpcionesDelMundo = {}): MundoFalso {
  // Lo que el Worker guarda en la memoria del módulo no pasa de un mundo al siguiente.
  olvidarMemoriaDeLaRuta();
  olvidarPrueba();
  const libro = new LibroFalso();
  const correo = new CorreoFalso();
  const reloj = { ahora: o.ahora ?? T0 };
  const portero: MundoFalso["portero"] = { estado: "estado" in o ? o.estado : estadoBien(), falla: null, llamadas: [] };
  const telegram: MundoFalso["telegram"] = { llamadas: [], falla: null };
  const registro: string[] = [];
  // El registrador de verdad (con su limpieza), escribiendo en una lista en vez de en la consola.
  const registrar: Registrar = registrador({ log: (l) => void registro.push(l), error: (l) => void registro.push(l) });

  const env: Entorno = {
    MEMORIA: libro,
    CORREO: correo,
    PORTERO_URL: PORTERO,
    PORTERO_ADMIN_TOKEN: CLAVE_DE_OPERAR,
    AVISAR_A: DESTINO,
    CORREO_USUARIO: "avisos",
    CORREO_DOMINIO: "tinkazo.app",
    RESUMEN_CADA_HORAS: "24",
    ...(o.conTelegram ? { TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_CHAT_ID: CHAT } : {}),
    ...o.env,
  };

  const fetchFalso = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    if (url.startsWith("https://api.telegram.org/")) {
      const cuerpo = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      telegram.llamadas.push({ url, cuerpo });
      if (telegram.falla) return new Response(JSON.stringify({ ok: false, description: "falla inventada" }), { status: telegram.falla });
      return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.llamadas.length } }), { status: 200 });
    }
    if (url.startsWith(PORTERO)) {
      portero.llamadas.push({ url, autorizacion: new Headers(init.headers).get("Authorization"), metodo: init.method ?? "GET" });
      const f = portero.falla;
      if (f === "red") throw new TypeError("fetch failed");
      if (f === "tiempo") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      if (f === "json") return new Response("<html>502</html>", { status: 200, headers: { "Content-Type": "text/html" } });
      if (typeof f === "number") return new Response(JSON.stringify({ motivo: "error" }), { status: f });
      return new Response(JSON.stringify(portero.estado), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`la prueba intentó llamar a una red de verdad: ${url}`);
  }) as typeof fetch;

  const dep: Dependencias = { fetch: fetchFalso, ahora: () => reloj.ahora, registrar };

  // El resumen de la ranura de ahora, ya mandado: así la primera vuelta no manda uno que las pruebas no esperan.
  if (!o.sinResumenPendiente) {
    const memoria: Partial<Memoria> = { v: 1, resumenEn: inicioDeResumen(new Date(reloj.ahora), 24).toISOString() };
    libro.datos.set(CLAVE_MEMORIA, JSON.stringify(memoria));
  }

  const mundo: MundoFalso = {
    env,
    dep,
    libro,
    correo,
    reloj,
    portero,
    telegram,
    registro,
    vuelta: () => vuelta(env, dep),
    avanzar: (ms) => void (reloj.ahora += ms),
    vueltaEn: (minutos) => {
      reloj.ahora += minutos * MINUTO;
      return vuelta(env, dep);
    },
    memoria: async () => leerMemoria(libro, registrar),
    asuntos: () => correo.enviados.map((c) => c.subject),
  };
  return mundo;
}

/**
 * Lo que manda quien pide `POST /prueba`: el derivado de la clave de operar, calculado como lo calcula la herramienta de
 * quien opera (Node, `createHmac`), no como lo calcula el Worker. Así las pruebas atrapan si los dos se desalinean.
 */
export const CLAVE_DE_PRUEBA = createHmac("sha256", CLAVE_DE_OPERAR).update("tinkazo-vigilante/prueba/v1").digest("hex");
