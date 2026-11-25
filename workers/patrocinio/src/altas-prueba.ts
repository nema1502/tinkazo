/**
 * Lo que comparten las pruebas de las rutas de altas: un portero de mainnet con las altas prendidas, un Pollar de
 * mentira (sesiones, billeteras y créditos que dice la prueba), una red de mentira que solo sabe qué cuentas existen y
 * cupones de verdad (con su huella). Sin red ni Cloudflare. No entra en el Worker.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { ALFABETO, Altas, huella } from "./altas";
import { DIA_MS, type Env, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { type MemoriaCreditos, Pollar } from "./pollar";
import type { CuentaEnRed } from "./red";
import { PuertaAltas } from "./rutas-altas";
import { sqlDePrueba } from "./sqlite-prueba";

export const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
/** Inventados, solo para las pruebas. */
export const APP = "app_mainnet_inventada";
export const SECRETO_POLLAR = "sec_mainnet_prueba_inventada_0000000000";
export const SECRETO_CUPON = "c".repeat(32);
export const LOTE = "space-apps-14nov";
export const IP = "190.129.10.20";

/** Un token de sesión inventado con forma de token, distinto para cada persona. */
export const tokenDe = (usuario: string) => `tok_${usuario.replace(/[^A-Za-z0-9]/g, "")}_${"x".repeat(24)}`;

/** El código número `i`, de 12 caracteres del alfabeto de los cupones. */
export function codigo(i: number): string {
  let s = "";
  let n = i + 1_000_003;
  for (let k = 0; k < 12; k++) {
    s += ALFABETO[n % 32];
    n = Math.floor(n / 32) + 7 * (k + 1);
  }
  return s;
}

export interface PollarDeMentira {
  /** token → persona. Lo que no está da 401. */
  sesiones: Map<string, { usuario: string; app?: string; red?: string; wallet?: unknown }>;
  /** persona → su billetera de Stellar (null: todavía no tiene). Lo que no está no tiene fila. */
  billeteras: Map<string, string | null>;
  creditos: number;
  /** Cada llamada falla con 503. */
  caido: boolean;
  /** Solo `users` falla. */
  usersCaido: boolean;
  /** Solo `billing/credits` falla. */
  creditosCaido: boolean;
  /** Los últimos movimientos de los créditos, como los devuelve `billing/credits`. */
  movimientos: unknown[];
  /** Los eventos que contesta la consulta de uso `billing/usage` (`[{ event, count, credits }]`). Por defecto, ninguno. */
  uso: unknown;
  /** Solo `billing/usage` falla. */
  usoCaido: boolean;
  /** Las ventanas que pidió `billing/usage`, tal como llegaron (`from` y `to`). */
  consultasDeUso: Array<{ from: string | null; to: string | null }>;
  /** Lo que contesta `treasury/sponsorship` (su contenido), o null para que falle. */
  patrocinio: Record<string, unknown> | null;
  /** Lo que contesta `wallets/fund` para una cuenta: el estado y el código. Por defecto, el pedido abierto (202). */
  fondeo: (cuenta: string) => { status: number; code: string };
  /** Los cuerpos que recibió `wallets/fund`. */
  fondeos: unknown[];
  llamadas: string[];
  /** Lo que se suma a la fila de `users` de una persona (su correo, su nombre, su idioma). Lo que no está, la fila de siempre. */
  fichas: Map<string, Record<string, unknown>>;
}

export interface OpcionesDelMontaje {
  sinPollar?: boolean;
  cuponSecreto?: string | null;
  memoriaCreditos?: MemoriaCreditos;
  sql?: ReturnType<typeof sqlDePrueba>;
  /** Lo que la puerta llama al dar un regalo, para el correo de bienvenida. Sin esto, como siempre. */
  alRegalar?: () => void;
}

export function montarAltas(env: Partial<Env> = {}, opciones: OpcionesDelMontaje = {}) {
  let ahora = T0;
  // Un SQLite propio de la prueba (por ejemplo, con datos de antes o uno que falla), o uno nuevo y vacío.
  const sql = opciones.sql ?? sqlDePrueba();
  const cupos = new Cupos(sql);
  const altas = new Altas(sql, cupos);
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: APP, ...env });
  const pm: PollarDeMentira = {
    sesiones: new Map(),
    billeteras: new Map(),
    creditos: 100_000,
    caido: false,
    usersCaido: false,
    creditosCaido: false,
    movimientos: [],
    uso: [],
    usoCaido: false,
    consultasDeUso: [],
    patrocinio: { sponsor_trustlines: false, sponsor_swap_venues: false, sponsor_all_contracts: false, sponsor_signer_rotation: false },
    fondeo: () => ({ status: 202, code: "SERVER_WALLET_ACCOUNT_REQUESTED" }),
    fondeos: [],
    llamadas: [],
    fichas: new Map(),
  };
  const resp = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    pm.llamadas.push(u.pathname);
    if (pm.caido) return resp(503, { code: "DOWN", success: false });
    if (u.pathname === "/v3/tokens/verify") {
      const s = pm.sesiones.get(String(JSON.parse(String(init?.body)).token));
      if (!s) return resp(401, { code: "SDK_AUTH_INVALID_TOKEN", success: false });
      return resp(200, { code: "SERVER_TOKEN_VERIFIED", success: true, content: { userId: s.usuario, applicationId: s.app ?? APP, expiresAt: new Date(ahora + 3_600_000).toISOString(), network: s.red ?? "mainnet", wallet: s.wallet ?? null, profile: {}, authProvider: "google" } });
    }
    if (u.pathname === "/v3/users") {
      if (pm.usersCaido) return resp(503, { code: "DOWN", success: false });
      const q = u.searchParams.get("q") ?? "";
      const wallets = pm.billeteras.get(q) ? [{ network: "STELLAR", public_key: pm.billeteras.get(q) }] : [];
      const items = pm.billeteras.has(q) ? [{ id: q, email: "x@y.z", wallet_public_key: null, wallets, ...(pm.fichas.get(q) ?? {}) }] : [];
      return resp(200, { code: "SERVER_SDK_USERS_LIST", success: true, content: { items, total: items.length, page: 1, limit: 200, totalPages: 1, stats: {} } });
    }
    if (u.pathname === "/v3/billing/credits" && pm.creditosCaido) return resp(503, { code: "DOWN", success: false });
    if (u.pathname === "/v3/billing/credits") return resp(200, { code: "SERVER_BILLING_CREDITS", success: true, content: { billingModel: "PREPAID", available: pm.creditos, movements: pm.movimientos } });
    if (u.pathname === "/v3/billing/usage") {
      pm.consultasDeUso.push({ from: u.searchParams.get("from"), to: u.searchParams.get("to") });
      if (pm.usoCaido) return resp(503, { code: "DOWN", success: false });
      return resp(200, { code: "SERVER_BILLING_USAGE", success: true, content: { from: u.searchParams.get("from"), to: u.searchParams.get("to"), totalCredits: "0", events: pm.uso } });
    }
    if (u.pathname === "/v3/treasury/sponsorship") return pm.patrocinio ? resp(200, { code: "SERVER_TREASURY_SPONSORSHIP", success: true, content: pm.patrocinio }) : resp(503, { code: "DOWN", success: false });
    if (u.pathname === "/v3/wallets/fund" && init?.method === "POST") {
      const cuerpo = JSON.parse(String(init.body)) as { publicKey: string };
      pm.fondeos.push(cuerpo);
      const f = pm.fondeo(cuerpo.publicKey);
      const ok = f.status === 200 || f.status === 202;
      return resp(f.status, { code: f.code, success: ok, ...(ok ? { content: f.status === 202 ? { publicKey: cuerpo.publicKey, requestId: `req_${cuerpo.publicKey.slice(1, 9)}` } : { publicKey: cuerpo.publicKey, startingBalance: "0" } } : {}) });
    }
    return resp(404, { code: "NOT_FOUND", success: false });
  };
  /** Lo que anotan las rutas y Pollar, como en el Worker: una sola bitácora. */
  const anotado: Array<[string, Record<string, string | number> | undefined]> = [];
  const pollar = opciones.sinPollar
    ? null
    : new Pollar({ secreto: SECRETO_POLLAR, appId: APP, fetch, reloj: () => ahora, registrar: (e, d) => void anotado.push([e, d]), ...(opciones.memoriaCreditos ? { memoriaCreditos: opciones.memoriaCreditos } : {}) });
  /** Las cuentas que existen en la red. */
  const abiertas = new Set<string>();
  const red = {
    caida: false,
    async leerCuenta(g: string): Promise<CuentaEnRed | null> {
      if (red.caida) throw new Error("rpc-corte");
      return abiertas.has(g) ? { patrocinador: null, balance: 0n } : null;
    },
  };
  const puerta = new PuertaAltas({
    cfg,
    cupos,
    altas,
    pollar,
    cuponSecreto: opciones.cuponSecreto === undefined ? SECRETO_CUPON : opciones.cuponSecreto,
    red,
    reloj: () => ahora,
    registrar: (e, d) => void anotado.push([e, d]),
    ...(opciones.alRegalar ? { alRegalar: opciones.alRegalar } : {}),
  });

  /** Una persona con su sesión y, si se dice, su billetera de Stellar. */
  const persona = (usuario: string, billetera: string | null = Keypair.random().publicKey()) => {
    pm.sesiones.set(tokenDe(usuario), { usuario });
    pm.billeteras.set(usuario, billetera);
    return { usuario, token: tokenDe(usuario), cuenta: billetera };
  };
  /** Un lote con estos códigos, de verdad: guarda sus huellas. */
  const lote = async (codigos: string[], extra: Partial<Parameters<Altas["crearCupones"]>[0]> = {}) =>
    altas.crearCupones({ lote: LOTE, huellas: await Promise.all(codigos.map((c) => huella(c, SECRETO_CUPON))), sorteos: 3, dias: 60, vence: T0 + 30 * DIA_MS, usos: 1, ...extra }, ahora);
  const cupon = (token: string | null, c: unknown, ip = IP) => puerta.cupon({ token, ip, cuerpo: { cupon: c } });
  const estado = (token: string | null, ip = IP) => puerta.estado({ token, ip, cuerpo: {} });
  const abrir = (token: string | null, ip = IP) => puerta.abrir({ token, ip, cuerpo: {} });
  const gratis = (token: string | null, ip = IP) => puerta.gratis({ token, ip, cuerpo: {} });

  return {
    sql,
    cupos,
    altas,
    cfg,
    pm,
    pollar,
    abiertas,
    red,
    anotado,
    puerta,
    persona,
    lote,
    cupon,
    estado,
    abrir,
    gratis,
    mover: (ms: number) => (ahora += ms),
    hora: () => ahora,
  };
}
