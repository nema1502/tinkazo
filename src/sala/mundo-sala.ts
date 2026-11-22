/**
 * El Worker de la sala entero en Node, sin red ni Cloudflare: los objetos persistentes tienen un SQLite de verdad en
 * memoria, el proveedor de cuentas es un `fetch` de mentira y el reloj lo mueve la prueba. Las pruebas que lo usan tienen que
 * declarar antes `vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"))`.
 */
import { DatabaseSync } from "node:sqlite";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair } from "@stellar/stellar-sdk/base";
import { vi } from "vitest";

type Valor = string | number | null;

/** Una sesión que el proveedor de mentira reconoce. */
export interface SesionDePrueba {
  usuario: string;
  /** Lo que se mezcla en el contenido del verify. `{ authProvider: undefined }` hace que el campo no venga. */
  contenido?: Record<string, unknown>;
}

/** El proveedor de cuentas de mentira: qué sesiones conoce y cuántas veces le preguntaron. */
export interface ProveedorFalso {
  sesiones: Map<string, SesionDePrueba>;
  billeteras: Map<string, string | null>;
  /** Cuántas veces se llamó a cada ruta del proveedor. */
  llamadas: Record<string, number>;
  caido: boolean;
  /** Las filas exactas que contesta `/v3/users` para una búsqueda `q` (para probar la búsqueda de un correo por la cuenta). */
  usuarios: Map<string, unknown[]>;
  /** Cada `q` con que se buscó en `/v3/users`, en orden. */
  busquedas: string[];
}

export const APP_DE_PRUEBA = "app_mainnet_inventada";
const SECRETO_DE_PRUEBA = "sec_mainnet_prueba_inventada_0000000000";

/** Un WebSocket de mentira: guarda lo que se le adjunta, lo que se le manda y cómo lo cerraron. */
export interface SocketFalso {
  cierres: { codigo: number | undefined; razon: string | undefined }[];
  mensajes: string[];
  serializeAttachment(valor: unknown): void;
  deserializeAttachment(): unknown;
  close(codigo?: number, razon?: string): void;
  send(texto: string): void;
}

/** Un socket que ya se presentó con el token (`presentado`) o que todavía no. */
export function socketFalso(presentado: boolean): SocketFalso {
  let adjunto: unknown = { ok: presentado, desde: 0 };
  const socket: SocketFalso = {
    cierres: [],
    mensajes: [],
    serializeAttachment: (valor) => void (adjunto = valor),
    deserializeAttachment: () => adjunto,
    close: (codigo, razon) => void socket.cierres.push({ codigo, razon }),
    send: (texto) => void socket.mensajes.push(texto),
  };
  return socket;
}

/** El estado de un objeto persistente: un SQLite en memoria con la misma forma de uso que el de Cloudflare. */
function estadoFalso() {
  let db = new DatabaseSync(":memory:");
  let alarma: number | null = null;
  const sockets: SocketFalso[] = [];
  return {
    storage: {
      sql: {
        exec(consulta: string, ...parametros: Valor[]) {
          const filas = db.prepare(consulta).all(...parametros) as unknown[];
          return {
            toArray: () => filas,
            one: () => {
              if (filas.length !== 1) throw new Error("se esperaba una sola fila");
              return filas[0];
            },
          };
        },
      },
      async setAlarm(ms: number) {
        alarma = ms;
      },
      async getAlarm() {
        return alarma;
      },
      async deleteAlarm() {
        alarma = null;
      },
      async deleteAll() {
        db.close();
        db = new DatabaseSync(":memory:");
      },
    },
    setWebSocketAutoResponse() {},
    getWebSockets: () => sockets,
    sockets,
    alarma: () => alarma,
  };
}

/** Lo que las pruebas le piden a un objeto de sala, como llamadas y respuestas. */
export interface ObjetoDeSala {
  viva(): Promise<boolean>;
  paseDeLaPantalla(token: string): Promise<{ ok: boolean; motivo?: string }>;
  cambiarToken(
    cuenta: string,
    huellaNueva: string,
    gen: number,
  ): Promise<{ ok: true; fase: string; vence: number } | { ok: false; motivo: string }>;
  sellarCampana(token: string, sorteo: string, sello: unknown): Promise<{ ok: boolean; evento?: string | null; sorteoMs?: number | null; motivo?: string }>;
  /** Lo que corre cuando vence la vida de la sala: borra todo. */
  alarm(): Promise<void>;
}

/** Lo que las pruebas le piden al objeto de cupos. */
export interface ObjetoDeCupos {
  reservarCampana(evento: string, reemplazo: { sala: string; huella: string } | null): Promise<unknown>;
  duenaDelEvento(evento: string): Promise<string | null>;
  marcarSellado(evento: string, sorteoMs: number): Promise<void>;
  pendientesDeBarrido(): Promise<{ evento: string; sala: string }[]>;
  prepararToma(
    cuenta: string,
    evento: string,
    huellaNueva: string,
  ): Promise<{ ok: true; gen: number } | { ok: false; motivo: "no-existe" | "pausa"; esperaS?: number }>;
  confirmarToma(evento: string, gen: number): Promise<boolean>;
  salaDelIntento(evento: string, huella: string): Promise<{ sala: string; enMs: number } | null>;
}

interface ModuloDeLaSala {
  default: { fetch(req: Request, env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> };
  Sala: new (ctx: unknown, env: unknown) => object;
  Cupos: new (ctx: unknown, env: unknown) => object;
}

export interface MundoDeSala {
  env: Record<string, unknown>;
  proveedor: ProveedorFalso;
  /** La llave privada de la prueba: firma los archivos de las campañas que acepta el Worker local. */
  llavePrivada: Uint8Array;
  pedir(ruta: string, init?: { metodo?: string; cuerpo?: unknown; cabeceras?: Record<string, string>; base?: string }): Promise<Response>;
  /** Espera lo que el Worker dejó en `ctx.waitUntil`, como lo hace Cloudflare antes de cerrar el pedido. */
  esperarSegundoPlano(): Promise<void>;
  /** El objeto de una sala, para mirarlo por dentro como lo hace el Worker. */
  sala(id: string): ObjetoDeSala;
  cupos(): ObjetoDeCupos;
  /** Si una sala conserva su alarma programada (se borra sola al vencer). */
  alarmaDe(id: string): number | null;
  /** Conecta a una sala un socket de mentira: ya presentado con el token, o sin presentarse todavía. */
  agregarSocket(id: string, presentado: boolean): SocketFalso;
  /** Corre una consulta SQL directo en el almacén de un objeto ("cupos" o "sala:<id>"): para mirar o dejar un estado de antes. */
  ejecutar(objeto: string, consulta: string, ...parametros: Valor[]): Record<string, Valor>[];
  /** Hace fallar la creación de salas: `ocupado` da siempre un id ya usado y `corte` lanza un error, como un corte de red. */
  fallas: { crearCampana: "no" | "ocupado" | "corte" };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const respuesta = (estado: number, cuerpo: unknown): Response =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

/** La base donde pegan las pruebas: el servidor de desarrollo de esta máquina, el único que acepta la llave de prueba. */
export const BASE_LOCAL = "http://127.0.0.1:8792";
export const ORIGEN_DEL_SITIO = "https://tinkazo.app";

/**
 * Arma el Worker con módulos nuevos: el estado de una prueba no se cuela en la siguiente. `extra` pisa variables del Worker.
 * El proveedor de mentira se instala como el `fetch` global, que es por donde el Worker le habla.
 */
export async function montarMundo(extra: Record<string, string> = {}): Promise<MundoDeSala> {
  vi.resetModules();
  (globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair = class {};
  const ruta = "../../workers/sala/src/index";
  const modulo = (await import(/* @vite-ignore */ ruta)) as ModuloDeLaSala;
  const llavePrivada = ed25519.utils.randomSecretKey();
  const proveedor: ProveedorFalso = {
    sesiones: new Map(),
    billeteras: new Map(),
    llamadas: {},
    caido: false,
    usuarios: new Map(),
    busquedas: [],
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    proveedor.llamadas[u.pathname] = (proveedor.llamadas[u.pathname] ?? 0) + 1;
    if (proveedor.caido) return respuesta(503, { code: "DOWN", success: false });
    if (u.pathname === "/v3/tokens/verify") {
      const token = String((JSON.parse(String(init?.body)) as { token?: unknown }).token);
      const sesion = proveedor.sesiones.get(token);
      if (!sesion) return respuesta(401, { code: "SDK_AUTH_INVALID_TOKEN", success: false });
      const contenido = {
        userId: sesion.usuario,
        applicationId: APP_DE_PRUEBA,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        network: "mainnet",
        wallet: null,
        profile: {},
        authProvider: "google",
        ...sesion.contenido,
      };
      return respuesta(200, { code: "SERVER_TOKEN_VERIFIED", success: true, content: contenido });
    }
    if (u.pathname === "/v3/users") {
      const q = u.searchParams.get("q") ?? "";
      proveedor.busquedas.push(q);
      const filas = proveedor.usuarios.get(q);
      if (filas !== undefined) return respuesta(200, { code: "SERVER_SDK_USERS_LIST", success: true, content: { items: filas } });
      const cuenta = proveedor.billeteras.get(q);
      const items = cuenta === undefined ? [] : [{ id: q, wallets: cuenta ? [{ network: "STELLAR", public_key: cuenta }] : [] }];
      return respuesta(200, { code: "SERVER_SDK_USERS_LIST", success: true, content: { items } });
    }
    return respuesta(404, { code: "NOT_FOUND", success: false });
  });

  const pendientes: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>): void => void pendientes.push(p) };
  const fallas: MundoDeSala["fallas"] = { crearCampana: "no" };
  const objetos = new Map<string, { objeto: object; estado: ReturnType<typeof estadoFalso> }>();
  const env: Record<string, unknown> = {
    VIDA_PRUEBA_MS: "600000",
    LLAVE_CAMPANAS_PRUEBA: hex(ed25519.getPublicKey(llavePrivada)),
    POLLAR_SECRETO: SECRETO_DE_PRUEBA,
    POLLAR_APP_ID: APP_DE_PRUEBA,
    PASE: "0",
    ...extra,
  };
  const espacio = (clase: "sala" | "cupos") => ({
    idFromName: (nombre: string) => `${clase}:${nombre}`,
    get: (id: string) => {
      let hay = objetos.get(id);
      if (!hay) {
        const estado = estadoFalso();
        hay = { objeto: new (clase === "sala" ? modulo.Sala : modulo.Cupos)(estado, env), estado };
        objetos.set(id, hay);
      }
      const objeto = hay.objeto;
      return new Proxy(objeto, {
        get(destino, propiedad) {
          if (propiedad === "crearCampana" && fallas.crearCampana !== "no") {
            return async () => {
              if (fallas.crearCampana === "corte") throw new Error("corte de prueba");
              return false;
            };
          }
          const valor: unknown = Reflect.get(destino, propiedad, destino);
          return typeof valor === "function" ? valor.bind(destino) : valor;
        },
      });
    },
  });
  env.SALA = espacio("sala");
  env.CUPOS = espacio("cupos");

  return {
    env,
    proveedor,
    llavePrivada,
    async pedir(ruta, init = {}) {
      const cuerpo = init.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo);
      const cabeceras: Record<string, string> = { Origin: ORIGEN_DEL_SITIO, ...init.cabeceras };
      if (cuerpo !== undefined) cabeceras["Content-Length"] = String(Buffer.byteLength(cuerpo));
      const pedido = new Request(`${init.base ?? BASE_LOCAL}${ruta}`, {
        method: init.metodo ?? (cuerpo === undefined ? "GET" : "POST"),
        headers: cabeceras,
        ...(cuerpo === undefined ? {} : { body: cuerpo }),
      });
      return modulo.default.fetch(pedido, env, ctx);
    },
    async esperarSegundoPlano() {
      while (pendientes.length > 0) await Promise.allSettled(pendientes.splice(0));
    },
    sala: (id) => (env.SALA as ReturnType<typeof espacio>).get(`sala:${id}`) as ObjetoDeSala,
    cupos: () => (env.CUPOS as ReturnType<typeof espacio>).get("cupos:cupos") as ObjetoDeCupos,
    alarmaDe: (id) => objetos.get(`sala:${id}`)?.estado.alarma() ?? null,
    agregarSocket(id, presentado) {
      (env.SALA as ReturnType<typeof espacio>).get(`sala:${id}`);
      const socket = socketFalso(presentado);
      objetos.get(`sala:${id}`)?.estado.sockets.push(socket);
      return socket;
    },
    ejecutar(objeto, consulta, ...parametros) {
      const clave = objeto === "cupos" ? "cupos:cupos" : objeto;
      (env[clave.startsWith("cupos") ? "CUPOS" : "SALA"] as ReturnType<typeof espacio>).get(clave);
      const hay = objetos.get(clave);
      if (!hay) throw new Error(`no hay un objeto ${objeto}`);
      return hay.estado.storage.sql.exec(consulta, ...parametros).toArray() as Record<string, Valor>[];
    },
    fallas,
  };
}

/** Un archivo de campaña firmado con la llave de la prueba: el cuerpo de `POST /v1/campana`. */
export function firmarParaLaPrueba(llavePrivada: Uint8Array, datos: Record<string, unknown>): { texto: string; firma: string } {
  const texto = JSON.stringify(datos);
  return { texto, firma: Buffer.from(ed25519.sign(new TextEncoder().encode(texto), llavePrivada)).toString("base64url") };
}

/** Un archivo de campaña válido para el lector de la sala: las horas salen del reloj de la prueba. */
export function campanaDePrueba(ahora: number, cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    evento: "feria-del-libro",
    red: "testnet",
    cierra_ms: ahora + 3_600_000,
    sorteo_ms: ahora + 7_200_000,
    premios: ["400000000", "200000000"],
    ...cambios,
  };
}

/** Una persona con su sesión en el proveedor de mentira, su cuenta de Stellar y la llave de su celular. */
export interface PersonaDePrueba {
  usuario: string;
  token: string;
  cuenta: string;
  llave: string;
}

/** Da de alta una sesión en el proveedor de mentira. `contenido` pisa lo que dice el verify (por ejemplo `authProvider`). */
export function personaDePrueba(mundo: MundoDeSala, n: number, contenido: Record<string, unknown> = {}): PersonaDePrueba {
  const usuario = `usuario${n}`;
  const token = `tok_${usuario}_${"x".repeat(24)}`;
  const cuenta = Keypair.random().publicKey();
  mundo.proveedor.sesiones.set(token, { usuario, contenido: { wallet: cuenta, ...contenido } });
  return { usuario, token, cuenta, llave: `llave${n}`.padEnd(22, "x") };
}

/** Lo que manda el celular al anotarse: la sesión, su nombre cifrado y la llave de ese celular. */
export function cuerpoDeAlta(persona: PersonaDePrueba, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { token: persona.token, d: "A".repeat(60), llave: persona.llave, ...extra };
}

export interface SalaDeCampana {
  id: string;
  token: string;
}

/** Crea una sala de campaña con su archivo firmado, la abre, y devuelve su id y el token de quien organiza. */
export async function campanaAbierta(mundo: MundoDeSala, ahora: number, cambios: Record<string, unknown> = {}): Promise<SalaDeCampana> {
  const r = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(ahora, cambios)) });
  if (r.status !== 201) throw new Error(`la campaña de prueba no se creó: ${r.status}`);
  const sala = (await r.json()) as SalaDeCampana;
  const abierta = await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
    metodo: "PUT",
    cuerpo: { fase: "abierta" },
    cabeceras: { Authorization: `Bearer ${sala.token}` },
  });
  if (abierta.status !== 204) throw new Error(`la campaña de prueba no abrió: ${abierta.status}`);
  return sala;
}

/** El alta de una persona, como la manda su celular. `ip` es la conexión desde donde llega. */
export function altaDe(
  mundo: MundoDeSala,
  id: string,
  persona: PersonaDePrueba,
  extra: { cuerpo?: Record<string, unknown>; ip?: string } = {},
): Promise<Response> {
  return mundo.pedir(`/v1/sala/${id}/campana/alta`, {
    cuerpo: cuerpoDeAlta(persona, extra.cuerpo),
    cabeceras: { "CF-Connecting-IP": extra.ip ?? "190.129.10.20" },
  });
}
