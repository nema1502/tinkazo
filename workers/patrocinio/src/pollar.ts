/**
 * Lo que el portero de mainnet le pregunta a Pollar con la llave secreta de la app (`POLLAR_SECRETO`): quién es la
 * persona que manda una sesión (`tokens/verify`), cuál es su billetera de Stellar (`users`) y cuántos créditos le
 * quedan a la app (`billing/credits`, para el piso). Nada más: abrir cuentas (`wallets/fund`) entra en la fase 2.
 *
 * - El servidor de Pollar va fijo en el código (`servidores.ts`): ninguna variable puede mandar la llave a otro lado.
 * - Cada llamada espera 8 segundos como máximo. Una falla nunca se toma como un sí.
 * - Antes de llamar, un token tiene que tener forma de token (`formaDeToken`): lo que no, ni se pregunta.
 * - Lo verificado se recuerda 60 segundos, con la huella SHA-256 del token como clave: el token no se guarda.
 * - La bitácora lleva solo la llamada y un código fijo: nunca el token, la llave, el id de la persona ni su cuenta.
 *
 * El reloj y el `fetch` entran como argumentos: las pruebas nunca tocan la red.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { type Fetch, ServidorAjeno, haciaPollar } from "./servidores";

/** Lo más que se espera a Pollar en cada llamada. */
export const ESPERA_POLLAR_MS = 8_000;
/** Cuánto se recuerda una sesión verificada (nunca más allá de su vencimiento). */
export const MEMORIA_SESION_MS = 60_000;
/** Cuánto se recuerda el saldo de créditos antes de volver a leerlo. */
export const MEMORIA_CREDITOS_MS = 60_000;
/** Con Pollar caído, hasta cuándo vale el último saldo leído. Después, lo nuevo se pausa. */
export const ULTIMO_CREDITOS_MS = 10 * 60_000;
/** Tras una falla al leer los créditos, no se vuelve a preguntar durante este tiempo: un corte cuesta una espera, no una por pedido. */
export const PAUSA_CREDITOS_MS = 30_000;

const TOKEN_MIN = 20;
const TOKEN_MAX = 4096;
const MAX_RESPUESTA = 512 * 1024;
const MAX_RECORDADAS = 5_000;
const USUARIO = /^[A-Za-z0-9_\-.:|@]{1,200}$/;

/** Quién es la persona de una sesión, según Pollar. `cuenta` es su billetera de Stellar si el verify la trae sin dudas. */
export type Sesion = { ok: true; usuario: string; vence: number; cuenta: string | null } | { ok: false; motivo: "sesion" | "otra-app" | "pollar" };
export type Billetera = { ok: true; cuenta: string | null } | { ok: false };
export type Creditos = { ok: true; disponibles: number; leido: number; deMemoria: boolean } | { ok: false };

/** Dónde vive el último saldo leído: en memoria, o en los ajustes del objeto para que sobreviva a un reinicio. */
export interface MemoriaCreditos {
  leer(): { valor: number; ms: number } | null;
  guardar(valor: number, ms: number): void;
}

type Registrar = (evento: string, datos?: Record<string, string | number>) => void;

export interface OpcionesPollar {
  /** La llave secreta de la app de mainnet. Nunca sale de las cabeceras de los pedidos a Pollar. */
  secreto: string;
  /** El id de la app de mainnet: un token de otra app no pasa. */
  appId: string;
  fetch: Fetch;
  reloj?: () => number;
  registrar?: Registrar;
  esperaMs?: number;
  memoriaCreditos?: MemoriaCreditos;
}

/**
 * Si `t` tiene forma de token: entre 20 y 4.096 caracteres de letras, números, `-`, `_` y `.`. Si tiene puntos, es un
 * JWT: tres partes, la del medio un objeto JSON y, si trae `exp`, un número en el futuro. La forma real del token de
 * Pollar está por confirmar; esto solo descarta lo que seguro no es, para no llamar a Pollar por cualquier cosa.
 */
export function formaDeToken(t: unknown, ahora: number): t is string {
  if (typeof t !== "string" || t.length < TOKEN_MIN || t.length > TOKEN_MAX || !/^[A-Za-z0-9\-_.]+$/.test(t)) return false;
  if (!t.includes(".")) return true;
  const partes = t.split(".");
  if (partes.length !== 3 || partes.some((p) => p === "")) return false;
  let carga: unknown;
  try {
    carga = JSON.parse(atob((partes[1] as string).replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return false;
  }
  if (!carga || typeof carga !== "object" || Array.isArray(carga)) return false;
  const exp = (carga as { exp?: unknown }).exp;
  if (exp === undefined) return true;
  return typeof exp === "number" && Number.isFinite(exp) && exp * 1000 > ahora;
}

/** Un código de Pollar, solo si tiene la forma de un código (mayúsculas y guiones bajos): lo demás no entra a la bitácora. */
const codigoDe = (x: unknown): string => (typeof x === "string" && /^[A-Z0-9_]{1,64}$/.test(x) ? x : "otro");

/** Un instante de Pollar en ms: texto ISO, o un número en ms o en segundos. null si no se entiende. */
function instante(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x) && x > 0) return x >= 1e12 ? x : x * 1000;
  if (typeof x === "string" && x.length <= 64) {
    const ms = Date.parse(x);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

type Red = "principal" | "prueba" | null;
/** Cómo escribe Pollar la red está por confirmar: se acepta solo lo que dice mainnet sin dudas, y se distingue lo de prueba. */
function redDe(x: unknown): Red {
  if (typeof x !== "string") return null;
  const n = x.trim().toLowerCase();
  if (/(^|[^a-z])(mainnet|pubnet|public)$/.test(n)) return "principal";
  if (/(^|[^a-z])(testnet|futurenet|devnet)$/.test(n)) return "prueba";
  return null;
}

/** Una G de Stellar con su suma de control, o null. */
const g = (x: unknown): string | null => (typeof x === "string" && StrKey.isValidEd25519PublicKey(x) ? x : null);

/**
 * Las cuentas de Stellar de la red principal que nombra una billetera de Pollar, en cualquiera de las formas en que puede
 * venir (texto, objeto con `publicKey`, `public_key` o `address`, o una lista). Lo de otra cadena o de la red de prueba no
 * cuenta. La forma exacta de `wallet` en el verify está por confirmar.
 */
function cuentasDe(w: unknown, profundidad = 0): string[] {
  if (profundidad > 2 || w === null || w === undefined) return [];
  if (typeof w === "string") {
    const c = g(w);
    return c ? [c] : [];
  }
  if (Array.isArray(w)) return w.slice(0, 20).flatMap((x) => cuentasDe(x, profundidad + 1));
  if (typeof w !== "object") return [];
  const o = w as Record<string, unknown>;
  if (o.chain !== undefined && String(o.chain).toUpperCase() !== "STELLAR") return [];
  // `network` puede traer la red (`mainnet`) o la cadena (`STELLAR`): se descarta lo de prueba y lo de otra cadena.
  if (o.network !== undefined) {
    const n = String(o.network).trim().toUpperCase();
    if (redDe(o.network) === "prueba" || (/^[A-Z]+$/.test(n) && CADENAS.includes(n) && n !== "STELLAR")) return [];
  }
  return [o.publicKey, o.public_key, o.address].map(g).filter((c): c is string => c !== null);
}

/** Las cadenas que nombra Pollar (`chain`). Una billetera de otra que no sea Stellar no cuenta. */
const CADENAS = ["STELLAR", "SOLANA", "POLYGON", "ETHEREUM", "BASE", "ARBITRUM"];

/** La única cuenta, o null si no hay ninguna o hay más de una distinta (no se elige a ciegas). */
function unica(cuentas: string[]): string | null {
  const s = new Set(cuentas);
  return s.size === 1 ? ([...s][0] as string) : null;
}

async function huellaDe(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Lectura = { ok: true; estado: number; cuerpo: Record<string, unknown> | null } | { ok: false; codigo: string };

export class Pollar {
  private readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>;
  private readonly secreto: string;
  private readonly appId: string;
  private readonly reloj: () => number;
  private readonly registrar: Registrar;
  private readonly esperaMs: number;
  private readonly memoria: MemoriaCreditos;
  private readonly sesiones = new Map<string, { hasta: number; sesion: Sesion }>();
  /** Las huellas de los tokens que Pollar dio por buenos, con su vencimiento: para no trabar por dirección a quien ya entró. */
  private readonly buenas = new Map<string, number>();
  private readonly enCurso = new Map<string, Promise<Sesion>>();
  private creditosEnCurso: Promise<number | null> | null = null;
  private creditosCaidoHasta = 0;

  constructor(o: OpcionesPollar) {
    if (typeof o.secreto !== "string" || o.secreto.trim().length < 16 || /^sec_testnet_/i.test(o.secreto)) throw new Error("pollar-llave");
    if (typeof o.appId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(o.appId)) throw new Error("pollar-app");
    this.secreto = o.secreto.trim();
    this.appId = o.appId;
    this.pedir = haciaPollar(o.fetch);
    this.reloj = o.reloj ?? (() => Date.now());
    this.registrar = o.registrar ?? (() => {});
    this.esperaMs = o.esperaMs ?? ESPERA_POLLAR_MS;
    let enMemoria: { valor: number; ms: number } | null = null;
    this.memoria = o.memoriaCreditos ?? { leer: () => enMemoria, guardar: (valor, ms) => void (enMemoria = { valor, ms }) };
  }

  /** Un pedido a Pollar con la llave y el tiempo máximo. No lanza: cualquier falla vuelve como `ok:false` con un código fijo. */
  private async llamar(ruta: string, init: RequestInit = {}): Promise<Lectura> {
    const control = new AbortController();
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const tiempo = new Promise<Lectura>((resolver) => {
      temporizador = setTimeout(() => {
        control.abort();
        resolver({ ok: false, codigo: "tiempo" });
      }, this.esperaMs);
    });
    const pedido = (async (): Promise<Lectura> => {
      try {
        const cabeceras = new Headers(init.headers);
        cabeceras.set("x-pollar-api-key", this.secreto);
        cabeceras.set("Accept", "application/json");
        const res = await this.pedir(ruta, { ...init, headers: cabeceras, signal: control.signal });
        const texto = await res.text();
        if (texto.length > MAX_RESPUESTA) return { ok: false, codigo: "largo" };
        let cuerpo: Record<string, unknown> | null = null;
        try {
          const j: unknown = JSON.parse(texto);
          cuerpo = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
        } catch {
          cuerpo = null;
        }
        return { ok: true, estado: res.status, cuerpo };
      } catch (e) {
        return { ok: false, codigo: e instanceof ServidorAjeno ? "ajeno" : control.signal.aborted ? "tiempo" : "red" };
      }
    })();
    try {
      return await Promise.race([pedido, tiempo]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  private falla(llamada: string, codigo: string | number): void {
    this.registrar("error-pollar", { llamada, codigo });
  }

  /** El contenido de una respuesta buena con este código de Pollar, o null (y queda anotado por qué). */
  private contenido(llamada: string, l: Lectura, codigoOk: string): Record<string, unknown> | null {
    const c = l.ok ? l.cuerpo?.content : undefined;
    const codigo = !l.ok ? l.codigo : l.estado !== 200 ? l.estado : l.cuerpo?.success !== true || l.cuerpo?.code !== codigoOk || !c || typeof c !== "object" || Array.isArray(c) ? "forma" : null;
    if (codigo !== null) {
      this.falla(llamada, codigo);
      return null;
    }
    return c as Record<string, unknown>;
  }

  /**
   * Quién es la persona de esta sesión. Exige `SERVER_TOKEN_VERIFIED`, la app de mainnet, la red principal y que no
   * haya vencido. `sesion`: el token no vale (o no tiene forma de token, y entonces no se llamó a nadie); `otra-app`: es
   * de otra app o de la red de prueba; `pollar`: Pollar no contestó, o contestó algo que no se entiende.
   */
  async verificar(token: unknown): Promise<Sesion> {
    const ahora = this.reloj();
    if (!formaDeToken(token, ahora)) return { ok: false, motivo: "sesion" };
    const clave = await huellaDe(token);
    const guardada = this.sesiones.get(clave);
    if (guardada && guardada.hasta > this.reloj()) return guardada.sesion;
    let pregunta = this.enCurso.get(clave);
    if (!pregunta) {
      pregunta = this.preguntarSesion(token, clave).finally(() => this.enCurso.delete(clave));
      this.enCurso.set(clave, pregunta);
    }
    return pregunta;
  }

  /**
   * Si Pollar ya dio este token por bueno y su sesión no venció, aunque haya pasado el minuto en que se recuerda la
   * respuesta entera. No le pregunta nada a nadie. Sirve para que una traba por dirección nunca frene a quien ya entró.
   */
  async conocida(token: unknown): Promise<boolean> {
    const ahora = this.reloj();
    if (!formaDeToken(token, ahora)) return false;
    const vence = this.buenas.get(await huellaDe(token));
    return vence !== undefined && vence > this.reloj();
  }

  private async preguntarSesion(token: string, clave: string): Promise<Sesion> {
    const l = await this.llamar("/v3/tokens/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const ahora = this.reloj();
    const sesion = this.leerSesion(l, ahora);
    if (sesion.ok) this.recordarBuena(clave, sesion.vence, ahora);
    else if (sesion.motivo !== "pollar") this.buenas.delete(clave);
    // Lo que Pollar dijo de este token se recuerda; un corte de Pollar no (el pedido siguiente vuelve a preguntar).
    if (!(sesion.ok === false && sesion.motivo === "pollar")) {
      const hasta = sesion.ok ? Math.min(ahora + MEMORIA_SESION_MS, sesion.vence) : ahora + MEMORIA_SESION_MS;
      this.recordar(clave, { hasta, sesion }, ahora);
    }
    return sesion;
  }

  private leerSesion(l: Lectura, ahora: number): Sesion {
    if (l.ok && l.estado === 401) {
      const codigo = codigoDe(l.cuerpo?.code);
      // Un 401 que no es de la sesión puede ser nuestra llave: igual es «sesión» para la persona, pero queda anotado.
      if (!codigo.startsWith("SDK_AUTH")) this.falla("verify", `401-${codigo}`);
      return { ok: false, motivo: "sesion" };
    }
    if (l.ok && l.estado === 403 && l.cuerpo?.code === "SDK_TOKEN_WRONG_APPLICATION") return { ok: false, motivo: "otra-app" };
    if (l.ok && l.estado === 403) return this.rota(`403-${codigoDe(l.cuerpo?.code)}`);
    const c = this.contenido("verify", l, "SERVER_TOKEN_VERIFIED");
    if (!c) return { ok: false, motivo: "pollar" };
    const usuario = c.userId;
    const vence = instante(c.expiresAt);
    const red = redDe(c.network);
    if (typeof usuario !== "string" || !USUARIO.test(usuario) || vence === null || typeof c.applicationId !== "string") return this.rota("forma");
    if (c.applicationId !== this.appId || red === "prueba") return { ok: false, motivo: "otra-app" };
    if (red === null) return this.rota("forma-red");
    if (vence <= ahora) return { ok: false, motivo: "sesion" };
    return { ok: true, usuario, vence, cuenta: unica(cuentasDe(c.wallet)) };
  }

  /** Una respuesta del verify que no se entiende: queda anotada y es «Pollar». */
  private rota(codigo: string): Sesion {
    this.falla("verify", codigo);
    return { ok: false, motivo: "pollar" };
  }

  private recordarBuena(clave: string, vence: number, ahora: number): void {
    this.buenas.delete(clave);
    this.buenas.set(clave, vence);
    if (this.buenas.size <= MAX_RECORDADAS) return;
    for (const [k, v] of this.buenas) if (v <= ahora) this.buenas.delete(k);
    for (const k of this.buenas.keys()) {
      if (this.buenas.size <= MAX_RECORDADAS) break;
      this.buenas.delete(k);
    }
  }

  private recordar(clave: string, valor: { hasta: number; sesion: Sesion }, ahora: number): void {
    this.sesiones.delete(clave);
    this.sesiones.set(clave, valor);
    if (this.sesiones.size <= MAX_RECORDADAS) return;
    for (const [k, v] of this.sesiones) if (v.hasta <= ahora) this.sesiones.delete(k);
    for (const k of this.sesiones.keys()) {
      if (this.sesiones.size <= MAX_RECORDADAS) break;
      this.sesiones.delete(k);
    }
  }

  /**
   * La billetera de Stellar de la persona, leída de su fila en `users`: la que tiene exactamente este id, aunque la
   * búsqueda traiga otras, y de ella la billetera de `wallets` que es de Stellar, nunca `wallet_public_key` (la principal,
   * que puede ser de otra cadena). Una fila sin billetera de Stellar da `cuenta: null` (todavía no la creó). Sin la fila,
   * con dos filas o con dos billeteras de Stellar distintas no se elige nada: `ok: false`, igual que una falla de Pollar.
   */
  async billeteraDe(usuario: string): Promise<Billetera> {
    if (typeof usuario !== "string" || !USUARIO.test(usuario)) return { ok: false };
    const l = await this.llamar(`/v3/users?q=${encodeURIComponent(usuario)}&limit=200`, { method: "GET" });
    const c = this.contenido("users", l, "SERVER_SDK_USERS_LIST");
    if (!c) return { ok: false };
    if (!Array.isArray(c.items)) {
      this.falla("users", "forma");
      return { ok: false };
    }
    const filas = c.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && (x as { id?: unknown }).id === usuario);
    if (filas.length !== 1) {
      this.falla("users", filas.length ? "filas-repetidas" : "sin-fila");
      return { ok: false };
    }
    const cuentas = new Set(cuentasDe((filas[0] as Record<string, unknown>).wallets));
    if (cuentas.size > 1) {
      this.falla("users", "billetera-ambigua");
      return { ok: false };
    }
    return { ok: true, cuenta: unica([...cuentas]) };
  }

  /**
   * Los créditos que le quedan a la app (`available`). Se recuerdan 60 segundos; si Pollar no contesta, vale el último
   * valor leído durante 10 minutos (`deMemoria`) y después no hay valor (`ok: false`): quien llama pausa lo nuevo.
   */
  async creditos(): Promise<Creditos> {
    const ahora = this.reloj();
    const ultimo = this.memoria.leer();
    if (ultimo && ahora - ultimo.ms < MEMORIA_CREDITOS_MS) return { ok: true, disponibles: ultimo.valor, leido: ultimo.ms, deMemoria: true };
    let valor: number | null = null;
    if (ahora >= this.creditosCaidoHasta) {
      this.creditosEnCurso ??= this.leerCreditos().finally(() => (this.creditosEnCurso = null));
      valor = await this.creditosEnCurso;
    }
    const despues = this.reloj();
    if (valor !== null) {
      this.memoria.guardar(valor, despues);
      return { ok: true, disponibles: valor, leido: despues, deMemoria: false };
    }
    if (ultimo && despues - ultimo.ms < ULTIMO_CREDITOS_MS) return { ok: true, disponibles: ultimo.valor, leido: ultimo.ms, deMemoria: true };
    return { ok: false };
  }

  private async leerCreditos(): Promise<number | null> {
    const l = await this.llamar("/v3/billing/credits?limit=1", { method: "GET" });
    const c = this.contenido("credits", l, "SERVER_BILLING_CREDITS");
    const n = c && (typeof c.available === "number" || (typeof c.available === "string" && /^-?\d{1,12}(\.\d{1,8})?$/.test(c.available))) ? Number(c.available) : null;
    if (c && (n === null || !Number.isFinite(n))) this.falla("credits", "forma");
    if (n === null || !Number.isFinite(n)) {
      this.creditosCaidoHasta = this.reloj() + PAUSA_CREDITOS_MS;
      return null;
    }
    this.creditosCaidoHasta = 0;
    return n;
  }
}

/** Un `Pollar` si la configuración alcanza (llave de mainnet y app), o null: entonces las rutas de altas no atienden. */
export function pollarDe(o: Omit<OpcionesPollar, "secreto" | "appId"> & { secreto: string | undefined; appId: string | null }): Pollar | null {
  if (!o.secreto || !o.appId) return null;
  try {
    return new Pollar({ ...o, secreto: o.secreto, appId: o.appId });
  } catch {
    return null;
  }
}
