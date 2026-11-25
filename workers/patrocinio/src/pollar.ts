/**
 * Lo que el portero de mainnet le pregunta a Pollar con la llave secreta de la app (`POLLAR_SECRETO`): quién es la
 * persona que manda una sesión (`tokens/verify`), cuál es su billetera de Stellar (`users`), cuántos créditos le
 * quedan a la app y qué se cobró en el día (`billing/credits`, para el piso y la vigilancia de firmas), el patrocinio
 * de la app (`treasury/sponsorship`, solo lectura), las cuentas nuevas de la última hora (`billing/usage`, una consulta
 * por minuto como mucho, solo al leer el estado), en la fase 2, abrir la cuenta de quien tiene acceso
 * (`wallets/fund`) y, para el correo de bienvenida, el correo, el nombre de pila y el idioma de la fila de la persona
 * (`users`), que no se guardan. Nada más.
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
import { type IdiomaDelCorreo, MAX_NOMBRE, esCorreo, limpiarTexto } from "./correo-bienvenida";
import { type CuentasDeLaVentana, VENTANA_CUENTAS_MINUTOS, contarCuentasEnUso } from "./lectura-cuentas";
import { type Fetch, ServidorAjeno, haciaPollar } from "./servidores";
import { MAX_MOVIMIENTOS } from "./vigilancia";

/** Lo más que se espera a Pollar en cada llamada. */
export const ESPERA_POLLAR_MS = 8_000;
/** Cuánto se recuerda una sesión verificada (nunca más allá de su vencimiento). */
export const MEMORIA_SESION_MS = 60_000;
/** Cuánto se recuerda el saldo de créditos antes de volver a leerlo. */
export const MEMORIA_CREDITOS_MS = 60_000;
/** Con Pollar caído, hasta cuándo vale el último saldo leído. Después, lo nuevo se pausa. */
export const ULTIMO_CREDITOS_MS = 10 * 60_000;
/** Cuánto se recuerda el conteo de cuentas nuevas, bien o mal leído, antes de volver a consultar: una consulta por minuto como mucho. */
export const MEMORIA_CUENTAS_MS = 60_000;
export { VENTANA_CUENTAS_MINUTOS };
/** Tras una falla al leer los créditos, no se vuelve a preguntar durante este tiempo: un corte cuesta una espera, no una por pedido. */
export const PAUSA_CREDITOS_MS = 30_000;

const TOKEN_MIN = 20;
const TOKEN_MAX = 4096;
const MAX_RESPUESTA = 512 * 1024;
const MAX_RECORDADAS = 5_000;
const USUARIO = /^[A-Za-z0-9_\-.:|@]{1,200}$/;

/** Quién es la persona de una sesión, según Pollar. `cuenta` es su billetera de Stellar si el verify la trae sin dudas. */
export type Sesion =
  | { ok: true; usuario: string; vence: number; cuenta: string | null; via: "google" | "otra" | null }
  | { ok: false; motivo: "sesion" | "otra-app" | "pollar" };
export type Billetera = { ok: true; cuenta: string | null } | { ok: false };
export type Creditos = { ok: true; disponibles: number; leido: number; deMemoria: boolean } | { ok: false };
/** Cómo terminó pedirle a Pollar que abra una cuenta: un pedido que la persona aprueba, o ya abierta. */
export type Apertura = { ok: true; estado: "pedido"; pedido: string } | { ok: true; estado: "abierta" } | { ok: false; motivo: "sin-creditos" | "sin-billetera" | "pollar" };
/** Los últimos movimientos de los créditos, tal como vienen (los cuenta `vigilancia.ts`). */
export type Movimientos = { ok: true; movimientos: unknown[] } | { ok: false };
/** Las cuentas nuevas y las activaciones de los últimos 60 minutos, según la consulta de uso del proveedor. */
export type CuentasDeUso = ({ ok: true } & CuentasDeLaVentana) | { ok: false };
/** Las banderas del patrocinio de la app (`sponsor_…`). */
export type Patrocinio = { ok: true; banderas: Record<string, boolean> } | { ok: false };
/**
 * Lo que el correo de bienvenida lee de la fila de la persona: vive solo en la memoria del Worker mientras se arma y se
 * manda el correo. Nunca va a una tabla, al registro, a un error ni a una respuesta. `idioma` null es que la fila no lo dice.
 */
export interface DatosParaCorreo {
  correo: string;
  nombre: string | null;
  idioma: IdiomaDelCorreo | null;
}
/** Lo más que se espera la ficha de la persona para el correo: menos que las otras llamadas, como en la sala. */
export const ESPERA_FICHA_MS = 6_000;
/**
 * La ficha no se pudo leer por algo que puede andar en un rato (Pollar lento, sin red, con 429 o 5xx, o una respuesta
 * rara): todavía no se mandó nada, así que se puede volver a intentar sin escribirle dos veces a nadie.
 */
export const FICHA_PASAJERA = "pasajera";
/** Los códigos de la llamada que cuentan como falla pasajera de la ficha. */
const PASAJERAS: ReadonlySet<string> = new Set(["tiempo", "red", "ajeno", "largo"]);

/**
 * El idioma de una fila, solo si alguno de los campos que puede traer (`language`, `locale` o `lang`, por confirmar con
 * una respuesta de verdad) dice español o inglés sin dudas. Lo demás es null, y el correo va en los dos.
 */
function idiomaDeLaFila(fila: Record<string, unknown>): IdiomaDelCorreo | null {
  for (const campo of ["language", "locale", "lang"]) {
    const valor = fila[campo];
    if (typeof valor !== "string") continue;
    const m = /^(en|es)(?:[-_][A-Za-z0-9]{2,4})?$/iu.exec(valor.trim());
    if (m?.[1]) return m[1].toLowerCase() === "en" ? "en" : "es";
  }
  return null;
}

/** El id de un pedido de Pollar: se guarda en el alta, así que solo lo que tiene forma de id. */
const PEDIDO = /^[A-Za-z0-9_.:-]{1,200}$/;
/** Una bandera del patrocinio. */
const BANDERA = /^sponsor_[a-z0-9_]{1,60}$/;

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

/**
 * Dónde dice el verify por dónde entró la persona, y cómo dice que es Google. Es el único lugar donde viven las dos
 * cosas. Lo que se sabe: el campo existe, y con una cuenta de correo vale `email` en minúsculas (medido el 18 de noviembre
 * de 2026). La lista de usuarios de la herramienta de gestión del proveedor escribe las vías en mayúsculas (`GOOGLE`,
 * `EMAIL`), o sea que el proveedor escribe la misma vía de dos formas según por dónde se la pregunte. Lo que todavía no se
 * sabe: qué escribe el verify con una cuenta de Google. Por eso `viaDe` compara sin importar mayúsculas ni espacios
 * alrededor, y nada más. Mientras no se mida con una respuesta de verdad, la sala de las campañas rechaza a todos si el campo
 * no viene o dice otra cosa, que es lo seguro. Para corregirlo se cambia esta constante y nada más.
 */
export const VIA_DE_LA_SESION = { campo: "authProvider", google: "google" } as const;

/**
 * Por dónde entró la persona. Lo usa la sala de las campañas, que solo anota cuentas de Google, con una lista de lo
 * permitido: `google` solo si el campo, sin espacios al principio ni al final y pasado a minúsculas, dice exactamente el
 * valor de Google (`GOOGLE`, `Google` y ` google ` valen). Cualquier otro texto (`email`, `EMAIL`, `apple.com`, `google.com`,
 * `googlex`, `goo gle`, uno con un carácter invisible adentro) es `otra`. `null` es que el verify no lo dice: el campo falta,
 * no es texto o viene vacío.
 */
function viaDe(contenido: Record<string, unknown>): "google" | "otra" | null {
  const x = contenido[VIA_DE_LA_SESION.campo];
  if (typeof x !== "string" || x.trim() === "") return null;
  return x.trim().toLowerCase() === VIA_DE_LA_SESION.google ? "google" : "otra";
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
  private cuentasMemoria: { ms: number; valor: CuentasDeUso } | null = null;
  private cuentasEnCurso: Promise<CuentasDeUso> | null = null;

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

  /**
   * Un pedido a Pollar con la llave y el tiempo máximo (el de siempre, o uno más corto para la ficha del correo). No lanza:
   * cualquier falla vuelve como `ok:false` con un código fijo.
   */
  private async llamar(ruta: string, init: RequestInit = {}, esperaMs: number = this.esperaMs): Promise<Lectura> {
    const control = new AbortController();
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const tiempo = new Promise<Lectura>((resolver) => {
      temporizador = setTimeout(() => {
        control.abort();
        resolver({ ok: false, codigo: "tiempo" });
      }, esperaMs);
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
    return { ok: true, usuario, vence, cuenta: unica(cuentasDe(c.wallet)), via: viaDe(c) };
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
   * Lo que el correo de bienvenida necesita de la persona, leído de su fila en `users` con la llave secreta: la fila que
   * tiene exactamente este id (el que dio la sesión verificada, nunca algo que mande el navegador), aunque la búsqueda
   * traiga otras. Su correo tiene que tener forma de correo, el nombre de pila sale limpio y a 40 caracteres, y el idioma
   * solo si la fila lo dice claro. Sin la fila, con dos filas, sin correo o con Pollar caído, lento o raro: null. Espera
   * menos que las otras llamadas (`ESPERA_FICHA_MS`). Nunca lanza, nunca guarda lo que leyó y el registro lleva solo
   * `correo-bienvenida` con un código fijo: nunca la dirección, el nombre ni el id.
   */
  async datosParaCorreo(usuario: string): Promise<DatosParaCorreo | null> {
    const f = await this.fichaParaCorreo(usuario);
    return f === FICHA_PASAJERA ? null : f;
  }

  /**
   * Lo mismo que `datosParaCorreo`, pero dice aparte cuándo la falla es pasajera (`FICHA_PASAJERA`): sin respuesta a tiempo,
   * sin red, con 429 o 5xx, o con algo inesperado. Con eso el correo vuelve a mirar en un rato en lugar de dar por perdida a
   * esa persona. Sin fila, con dos, sin correo o con una forma que no se entiende sigue siendo null. El registro, igual.
   */
  async fichaParaCorreo(usuario: string): Promise<DatosParaCorreo | typeof FICHA_PASAJERA | null> {
    const sin = (codigo: string | number): null => {
      this.registrar("correo-bienvenida", { codigo });
      return null;
    };
    const pasajera = (codigo: string): typeof FICHA_PASAJERA => {
      this.registrar("correo-bienvenida", { codigo });
      return FICHA_PASAJERA;
    };
    try {
      if (typeof usuario !== "string" || !USUARIO.test(usuario)) return sin("usuario");
      const ruta = `/v3/users?q=${encodeURIComponent(usuario)}&limit=200`;
      const l = await this.llamar(ruta, { method: "GET" }, Math.min(ESPERA_FICHA_MS, this.esperaMs));
      if (!l.ok) return PASAJERAS.has(l.codigo) ? pasajera(l.codigo) : sin(l.codigo);
      if (l.estado === 429 || l.estado >= 500) return pasajera("estado");
      if (l.estado !== 200) return sin("estado");
      const c = l.cuerpo?.content;
      const items = c && typeof c === "object" && !Array.isArray(c) ? (c as { items?: unknown }).items : undefined;
      if (l.cuerpo?.success !== true || l.cuerpo.code !== "SERVER_SDK_USERS_LIST" || !Array.isArray(items)) return sin("forma");
      const filas = items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && (x as { id?: unknown }).id === usuario);
      if (filas.length !== 1) return sin(filas.length ? "filas-repetidas" : "sin-fila");
      const fila = filas[0] as Record<string, unknown>;
      if (!esCorreo(fila.email)) return sin("sin-correo");
      const nombre = limpiarTexto(fila.first_name, MAX_NOMBRE);
      return { correo: fila.email, nombre: nombre === "" ? null : nombre, idioma: idiomaDeLaFila(fila) };
    } catch {
      return pasajera("inesperado");
    }
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

  /**
   * El último saldo guardado, sin preguntar nada: vale lo mismo que `creditos` con Pollar caído (el último valor durante 10
   * minutos) y, si no hay o es más viejo, `ok: false`. Para mirar el piso adentro de una transacción, sin esperar a nadie.
   */
  creditosGuardados(): Creditos {
    const ultimo = this.memoria.leer();
    if (!ultimo || this.reloj() - ultimo.ms >= ULTIMO_CREDITOS_MS) return { ok: false };
    return { ok: true, disponibles: ultimo.valor, leido: ultimo.ms, deMemoria: true };
  }

  /**
   * Fase 2: le pide a Pollar que abra la cuenta de Stellar de esta billetera (`POST /v3/wallets/fund`). Con una billetera
   * de Turnkey no se abre sola: queda un pedido (202, con su `requestId`) que la persona aprueba en su sesión; pedirlo de
   * nuevo con el pedido abierto devuelve el mismo. 200 o `409 WALLET_ALREADY_FUNDED`: ya está abierta. 402: faltan
   * créditos. `404 WALLET_NOT_FOUND`: Pollar no conoce esa billetera (todavía no se creó). Lo demás es Pollar, y queda
   * anotado con su código (nunca la cuenta).
   */
  async abrir(cuenta: string): Promise<Apertura> {
    if (g(cuenta) === null) return { ok: false, motivo: "pollar" };
    const l = await this.llamar("/v3/wallets/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicKey: cuenta }) });
    if (!l.ok) {
      this.falla("fund", l.codigo);
      return { ok: false, motivo: "pollar" };
    }
    const code = codigoDe(l.cuerpo?.code);
    const c = l.cuerpo?.content;
    const contenido = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
    const exito = l.cuerpo?.success === true && contenido !== null && (contenido.publicKey === undefined || contenido.publicKey === cuenta);
    if (l.estado === 202 && code === "SERVER_WALLET_ACCOUNT_REQUESTED" && exito && typeof contenido?.requestId === "string" && PEDIDO.test(contenido.requestId)) {
      return { ok: true, estado: "pedido", pedido: contenido.requestId };
    }
    if ((l.estado === 200 && code === "SERVER_WALLET_FUNDED" && exito) || (l.estado === 409 && code === "WALLET_ALREADY_FUNDED")) return { ok: true, estado: "abierta" };
    if (l.estado === 402) {
      this.falla("fund", `402-${code}`);
      return { ok: false, motivo: "sin-creditos" };
    }
    if (l.estado === 404 && code === "WALLET_NOT_FOUND") return { ok: false, motivo: "sin-billetera" };
    this.falla("fund", l.estado === 200 || l.estado === 202 ? `${l.estado}-forma` : `${l.estado}-${code}`);
    return { ok: false, motivo: "pollar" };
  }

  /**
   * Los movimientos de los créditos desde `desde` (ms), los más nuevos primero y hasta `MAX_MOVIMIENTOS`: para la
   * vigilancia de firmas. Sin memoria: se pide cuando se mira `/estado`.
   */
  async movimientos(desde: number): Promise<Movimientos> {
    const desdeIso = new Date(Math.max(0, desde)).toISOString();
    const l = await this.llamar(`/v3/billing/credits?since=${encodeURIComponent(desdeIso)}&limit=${MAX_MOVIMIENTOS}`, { method: "GET" });
    const c = this.contenido("credits", l, "SERVER_BILLING_CREDITS");
    if (!c) return { ok: false };
    if (!Array.isArray(c.movements)) {
      this.falla("credits", "forma-movimientos");
      return { ok: false };
    }
    return { ok: true, movimientos: c.movements };
  }

  /**
   * Las cuentas nuevas y las activaciones de los últimos 60 minutos corridos, con UNA consulta de uso por ventana de
   * tiempo (`GET /v3/billing/usage?from=…&to=…`, los dos en ISO 8601 con Z): la cantidad exacta por tipo de cobro aunque
   * haya miles de firmas. El resultado se recuerda un minuto, bien o mal leído, y las lecturas a la vez comparten la
   * consulta: como mucho una por minuto por instancia. Se pide solo al leer el estado, nunca en el camino de un pago. Si la
   * consulta falla, tarda más que la espera de siempre o no tiene la forma esperada, no hay conteo (`ok: false`): nunca un cero.
   */
  async cuentasDeLaUltimaHora(): Promise<CuentasDeUso> {
    const ahora = this.reloj();
    const guardada = this.cuentasMemoria;
    if (guardada && ahora - guardada.ms >= 0 && ahora - guardada.ms < MEMORIA_CUENTAS_MS) return guardada.valor;
    this.cuentasEnCurso ??= this.leerCuentas(ahora).finally(() => (this.cuentasEnCurso = null));
    return this.cuentasEnCurso;
  }

  private async leerCuentas(ahora: number): Promise<CuentasDeUso> {
    let valor: CuentasDeUso = { ok: false };
    try {
      const hasta = new Date(ahora).toISOString();
      const desde = new Date(ahora - VENTANA_CUENTAS_MINUTOS * 60_000).toISOString();
      const l = await this.llamar(`/v3/billing/usage?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`, { method: "GET" });
      const c = this.contenido("usage", l, "SERVER_BILLING_USAGE");
      if (c) {
        const n = contarCuentasEnUso(c.events);
        if (n) valor = { ok: true, ...n };
        else this.falla("usage", "forma-eventos");
      }
    } catch {
      this.falla("usage", "interno");
    }
    this.cuentasMemoria = { ms: ahora, valor };
    return valor;
  }

  /**
   * Las banderas del patrocinio de la app (`GET /v3/treasury/sponsorship`), solo lectura: las `sponsor_…` que vienen en
   * el contenido (o adentro de `sponsorship`) con un sí o un no. Sin ninguna, no hay lectura: no se da por apagado lo que
   * no se vio. El código de la respuesta está por confirmar, así que basta con `success`.
   */
  async patrocinio(): Promise<Patrocinio> {
    const l = await this.llamar("/v3/treasury/sponsorship", { method: "GET" });
    const c = l.ok && l.estado === 200 && l.cuerpo?.success === true ? l.cuerpo.content : undefined;
    const base = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
    const anidado = base?.sponsorship;
    const fuente = anidado && typeof anidado === "object" && !Array.isArray(anidado) ? (anidado as Record<string, unknown>) : base;
    const banderas: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(fuente ?? {})) if (BANDERA.test(k) && typeof v === "boolean") banderas[k] = v;
    if (!Object.keys(banderas).length) {
      this.falla("sponsorship", !l.ok ? l.codigo : l.estado !== 200 ? l.estado : "forma");
      return { ok: false };
    }
    return { ok: true, banderas };
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
