/**
 * El portero de Tinkazo: cuenta y paga las comisiones de `seal` y `draw`.
 *
 * El navegador arma, simula y firma la transacción (sin patrocinio) y la manda acá.
 * Si entra en la lista blanca, la cuenta tiene cupo y queda presupuesto, el portero la
 * envuelve en un fee-bump que paga su cuenta patrocinadora y la manda a la red. Así el
 * tope por cuenta y el general los pone Tinkazo y no dependen de lo que ofrezca nadie.
 *
 *   POST /v1/patrocinio            {"xdr": "<transacción firmada en base64>"}
 *        200 {hash, status, quedan, quedanSorteos}     429 {motivo:"cupo-cuenta", liberaEn, max}
 *        503 {motivo:"fondo"|"apagado"}   400 {motivo:"no-permitida"|"fallaria"|"rechazada"}
 *        403 {motivo:"cuenta-ajena"|"origen"}   502 {motivo:"red"}
 *   GET  /v1/patrocinio/cupo?cuenta=G…   lo que queda, si está prendido y quién rige (portero o pollar)
 *
 * Con la clave de administración (Authorization: Bearer <ADMIN_TOKEN>):
 *   POST /v1/patrocinio/apagar | encender | pollar     PUT /v1/patrocinio/ajustes {"clave","valor"}
 *   GET  /v1/patrocinio/estado                         GET /v1/patrocinio/exportar
 *
 * No guarda nombres ni listas ni direcciones IP: ver `cupos.ts` y README.md.
 * Comprobar un sorteo no depende de este servicio.
 */
import { DurableObject } from "cloudflare:workers";
import { type Env, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { Planes } from "./plan";
import { PorIp } from "./por-ip";
import { RpcRed } from "./red";
import { type Firmante, Portero, type Respuesta, firmanteDe } from "./servicio";

/** El registro del portero: una línea de JSON por hecho clave. Los `error-…` salen como error. Nunca lleva IP, nombres ni llaves. */
function registrar(evento: string, datos: Record<string, string | number> = {}): void {
  (evento.startsWith("error-") ? console.error : console.log)(JSON.stringify({ evento, ...datos }));
}

/** Lo más que se acepta de cuerpo: una transacción firmada de `seal` pesa unos 2 KB. */
const MAX_CUERPO = 8 * 1024;
const ADMIN_MINIMO = 32;
const ALARMA_MS = 20_000;
const SITIO = "https://tinkazo.app";

interface EnvPortero extends Env {
  /** La cuenta patrocinadora (G…): la que paga y reparte el peso de sus llaves. Pública. */
  CUENTA_PATROCINADORA?: string;
}

export class Patrocinio extends DurableObject<EnvPortero> {
  private cupos: Cupos;
  private portero: Portero | null = null;
  private firmante: Firmante | null = null;

  constructor(ctx: DurableObjectState, env: EnvPortero) {
    super(ctx, env);
    this.cupos = new Cupos(ctx.storage.sql);
  }

  private async obtener(): Promise<Portero> {
    if (this.portero) return this.portero;
    if (this.env.CLAVE_PATROCINADOR && !this.firmante) {
      try {
        this.firmante = await firmanteDe(this.env.CLAVE_PATROCINADOR);
      } catch {
        // Una llave mal pegada: se avisa en la bitácora (sin la llave) y el portero queda sin firmante, con /cupo diciendo "config".
        console.error("[patrocinio] la llave del Worker (CLAVE_PATROCINADOR) no se pudo leer: revisar el secreto");
        this.firmante = null;
      }
    }
    const cfg = leerConfig(this.env);
    // El plan del equipo sube el cupo: sin `CUENTA_URL` no se pregunta nada. Una dirección mal escrita se avisa y se ignora (no apaga al portero).
    if ((this.env.CUENTA_URL ?? "").trim() && !cfg.cuentaUrl) console.error(JSON.stringify({ evento: "error-config", falta: ["cuenta-url"] }));
    const planes = cfg.cuentaUrl ? new Planes(cfg.cuentaUrl, (...a: Parameters<typeof fetch>) => fetch(...a), () => Date.now(), registrar) : null;
    this.portero = new Portero(cfg, this.cupos, new RpcRed(cfg.rpcUrls), this.firmante, this.env.CUENTA_PATROCINADORA || null, () => Date.now(), () => void this.programar(), registrar, planes);
    const falta = this.portero.faltaDeConfig();
    if (falta.length) console.error(JSON.stringify({ evento: "error-config", falta }));
    // Un objeto que arranca con cosas en el aire (se reinició o se desplegó entre reservar y mandar) vuelve a armar su alarma.
    if (this.cupos.enElAire() > 0) await this.programar();
    return this.portero;
  }

  private async programar(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARMA_MS);
  }

  override async alarm(): Promise<void> {
    const p = await this.obtener();
    if (await p.reconciliar()) await this.ctx.storage.setAlarm(Date.now() + ALARMA_MS);
  }

  async pagar(xdr: string): Promise<Respuesta> {
    return (await this.obtener()).procesar(xdr);
  }

  async cupo(cuenta: string): Promise<Respuesta> {
    return (await this.obtener()).cupoDe(cuenta);
  }

  async administrar(accion: string, datos?: { clave?: string; valor?: number }): Promise<Respuesta> {
    const p = await this.obtener();
    switch (accion) {
      case "apagar":
        p.poner("apagado");
        return { estado: 200, cuerpo: { modo: p.modo() } };
      case "encender":
        p.poner("portero");
        return { estado: 200, cuerpo: { modo: p.modo() } };
      case "pollar":
        p.poner("pollar");
        return { estado: 200, cuerpo: { modo: p.modo() } };
      case "ajustes":
        return p.ajustar(String(datos?.clave), Number(datos?.valor)) ? { estado: 200, cuerpo: { ok: true } } : { estado: 400, cuerpo: { motivo: "ajuste" } };
      case "estado":
        return p.estado();
      case "exportar":
        return { estado: 200, cuerpo: { exportado: Date.now(), tablas: this.cupos.exportar() } };
      default:
        return { estado: 404, cuerpo: { motivo: "accion" } };
    }
  }
}

// ---------- el Worker de la puerta ----------

/** Dos contadores aparte: consultar el cupo no le gasta pedidos al POST. Ver `por-ip.ts`. */
const cupoPorIp = new PorIp();
const pagoPorIp = new PorIp();
/** Consultas de cupo por dirección y por hora. */
const CUPO_POR_HORA = 600;

function origenPermitido(origen: string | null): boolean {
  if (!origen) return false;
  if (origen === SITIO || origen === "https://www.tinkazo.app") return true;
  if (/^https:\/\/tinkazo(-[a-z0-9-]+)?\.vercel\.app$/.test(origen)) return true;
  return /^http:\/\/localhost:\d{2,5}$/.test(origen);
}

function json(cuerpo: unknown, estado: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra } });
}

function cors(origen: string | null, abierto: boolean): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": abierto ? "*" : origenPermitido(origen) && origen ? origen : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Si `dado` es la clave de administración, en tiempo constante. Sin clave cargada (o de menos de 32 caracteres) siempre da false. */
async function esAdmin(dado: string, env: Env): Promise<boolean> {
  const secreto = env.ADMIN_TOKEN ?? "";
  if (secreto.length < ADMIN_MINIMO || !dado) return false;
  const huella = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([huella(dado), huella(secreto)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request: Request, env: EnvPortero): Promise<Response> {
    const url = new URL(request.url);
    const origen = request.headers.get("Origin");
    const objeto = env.PATROCINIO.get(env.PATROCINIO.idFromName(env.RED === "mainnet" ? "mainnet" : "testnet")) as unknown as DurableObjectStub<Patrocinio>;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origen, url.pathname.endsWith("/cupo")) });

    // La consulta del cupo: abierta, solo lectura.
    if (url.pathname === "/v1/patrocinio/cupo" && request.method === "GET") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
      if (!cupoPorIp.toca(ip, CUPO_POR_HORA)) return json({ motivo: "cupo-ip" }, 429, cors(origen, true));
      const r = await objeto.cupo(url.searchParams.get("cuenta") ?? "");
      return json(r.cuerpo, r.estado, cors(origen, true));
    }

    // Administración: con la clave, y si no hay clave cargada, el camino no existe.
    const admin = /^\/v1\/patrocinio\/(apagar|encender|pollar|ajustes|estado|exportar)$/.exec(url.pathname);
    if (admin?.[1]) {
      if ((env.ADMIN_TOKEN ?? "").length < ADMIN_MINIMO) return json({ motivo: "no-existe" }, 404);
      const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
      if (!(await esAdmin(m?.[1] ?? "", env))) return json({ motivo: "clave" }, 401);
      const lee = admin[1] === "estado" || admin[1] === "exportar";
      if (lee ? request.method !== "GET" : admin[1] === "ajustes" ? request.method !== "PUT" : request.method !== "POST") return json({ motivo: "metodo" }, 405);
      let datos: { clave?: string; valor?: number } | undefined;
      if (admin[1] === "ajustes") {
        try {
          datos = (await request.json()) as typeof datos;
        } catch {
          return json({ motivo: "cuerpo" }, 400);
        }
      }
      const r = await objeto.administrar(admin[1], datos);
      return json(r.cuerpo, r.estado);
    }

    if (url.pathname === "/v1/patrocinio" && request.method === "POST") {
      const cabeceras = cors(origen, false);
      // Un navegador manda su origen; si es de otro sitio, no se paga. (Un script puede mentirlo: la defensa de verdad es la lista blanca y el cupo.)
      if (!origenPermitido(origen)) return json({ motivo: "origen" }, 403, cabeceras);
      const declarado = Number(request.headers.get("Content-Length") ?? "0");
      if (declarado > MAX_CUERPO) return json({ motivo: "no-permitida", razon: "tamano" }, 400, cabeceras);
      const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
      const cfg = leerConfig(env);
      if (!pagoPorIp.toca(ip, cfg.porIpPorHora)) return json({ motivo: "cupo-ip" }, 429, cabeceras);
      const texto = await request.text();
      if (texto.length > MAX_CUERPO) return json({ motivo: "no-permitida", razon: "tamano" }, 400, cabeceras);
      let xdr = texto.trim();
      if ((request.headers.get("Content-Type") ?? "").includes("json")) {
        try {
          const j = JSON.parse(texto) as { xdr?: unknown };
          xdr = typeof j.xdr === "string" ? j.xdr : "";
        } catch {
          return json({ motivo: "no-permitida", razon: "xdr", detalle: "cuerpo" }, 400, cabeceras);
        }
      }
      if (!xdr) return json({ motivo: "no-permitida", razon: "xdr", detalle: "vacio" }, 400, cabeceras);
      // Cualquier excepción que se nos escape sale como 500 con cuerpo y CORS, no como el error pelado de Cloudflare.
      try {
        const r = await objeto.pagar(xdr);
        return json(r.cuerpo, r.estado, cabeceras);
      } catch (e) {
        registrar("error-interno", { donde: "fetch", error: String(e).slice(0, 120) });
        return json({ motivo: "interno" }, 500, cabeceras);
      }
    }

    if (url.pathname === "/") return json({ servicio: "tinkazo-patrocinio" }, 200);
    return json({ motivo: "no-existe" }, 404);
  },
};
