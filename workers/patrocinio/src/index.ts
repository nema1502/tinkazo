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
 * Solo en mainnet con ALTAS=1, con la sesión de Pollar (Authorization: Bearer <token>), ver `rutas-altas.ts`:
 *   POST /v1/alta/estado   POST /v1/alta/cupon   POST /v1/alta/abrir   POST /v1/alta/orden   POST /v1/alta/pago
 * y abierta: GET /v1/alta/precios. Los pagos en USDC se leen de Horizon (`cobros.ts`).
 *
 * Solo en mainnet con ALTAS=1 y SORTEO_SERVIDOR=1, abierta desde el sitio, ver `sorteadora.ts`:
 *   POST /v1/sorteo {"sorteo","firma"}   el `draw` de un sello del portero, mandado desde la cuenta sorteadora
 *
 * Con la clave de administración (Authorization: Bearer <ADMIN_TOKEN>):
 *   POST /v1/patrocinio/apagar | encender | pollar     PUT /v1/patrocinio/ajustes {"clave","valor"}
 *   GET  /v1/patrocinio/estado                         GET /v1/patrocinio/exportar
 *
 * Solo en mainnet con ALTAS=1, con dos claves, ver `admin.ts`: cupones y altas a mano con CUPONES_TOKEN,
 * y pausar o reanudar las altas con ADMIN_TOKEN:
 *   POST|GET /v1/admin/cupones   POST /v1/admin/cupones/anular   POST /v1/admin/altas   POST /v1/admin/altas/pausar | reanudar
 *   POST /v1/admin/derechos   POST /v1/admin/ordenes/pagada   GET /v1/admin/sueltos   POST /v1/admin/sueltos/asignar
 *   POST /v1/admin/ventas/pausar | reanudar
 *
 * No guarda nombres ni listas ni direcciones IP: ver `cupos.ts` y README.md.
 * Comprobar un sorteo no depende de este servicio.
 */
import { DurableObject } from "cloudflare:workers";
import { type AccionAdmin, Administracion, atenderAdmin } from "./admin";
import { Altas } from "./altas";
import { registrador } from "./registrador";
import { Cobros, LectorDeCobros } from "./cobros";
import { type Env, leerConfig } from "./config";
import { Cupos, type Sql } from "./cupos";
import { cors, json, origenPermitido } from "./http";
import { Planes } from "./plan";
import { pollarDe } from "./pollar";
import { PorIp } from "./por-ip";
import { RpcRed } from "./red";
import { type AccionAlta, type AccionPago, type PedidoAlta, PuertaAltas, atenderAlta, memoriaEnAjustes } from "./rutas-altas";
import { type Firmante, Portero, type Respuesta, firmanteDe } from "./servicio";
import { Sorteadora, atenderSorteo } from "./sorteadora";

/**
 * El registro del portero: una línea de JSON por hecho clave. Los `error-…` salen como error. Nunca lleva IP, nombres,
 * llaves, el id de Pollar, tokens, correos, códigos ni cuentas: `registrador.ts` lo tapa por si algo se escapa.
 */
const registrar = registrador();

/** Lo más que se acepta de cuerpo: una transacción firmada de `seal` pesa unos 2 KB. */
const MAX_CUERPO = 8 * 1024;
const ADMIN_MINIMO = 32;
const ALARMA_MS = 20_000;

interface EnvPortero extends Env {
  /** La cuenta patrocinadora (G…): la que paga y reparte el peso de sus llaves. Pública. */
  CUENTA_PATROCINADORA?: string;
}

export class Patrocinio extends DurableObject<EnvPortero> {
  private cupos: Cupos;
  private sql: Sql;
  private portero: Portero | null = null;
  private firmante: Firmante | null = null;
  /** Las rutas de altas: solo en mainnet. Sin la llave de Pollar o el secreto de los cupones, contestan `503 apagado`. */
  private puerta: PuertaAltas | null = null;
  /** La administración de las altas: solo en mainnet. */
  private administracion: Administracion | null = null;
  private exportaAltas = false;

  constructor(ctx: DurableObjectState, env: EnvPortero) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // Lo que vale plata se escribe todo o nada: `transactionSync` del objeto.
    this.sql = { exec: (consulta, ...enlaces) => sql.exec(consulta, ...enlaces), transaccion: (fn) => ctx.storage.transactionSync(fn) };
    this.cupos = new Cupos(this.sql);
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
    const red = new RpcRed(cfg.rpcUrls);
    // La sorteadora, solo con el sorteo del servidor prendido y su llave cargada. Sin ella, `/v1/sorteo` da 503 apagado.
    let sorteadora: Sorteadora | null = null;
    if (cfg.sorteoServidor && cfg.cuentaSorteadora && cfg.contractId) {
      try {
        if (this.env.CLAVE_SORTEADORA) {
          const firmante = await firmanteDe(this.env.CLAVE_SORTEADORA);
          sorteadora = new Sorteadora({ passphrase: cfg.passphrase, contractId: cfg.contractId, cuenta: cfg.cuentaSorteadora, red, firmante });
        }
      } catch {
        sorteadora = null;
      }
      if (!sorteadora) console.error(JSON.stringify({ evento: "error-config", faltaAltas: ["clave-sorteadora"] }));
    }
    this.portero = new Portero(cfg, this.cupos, red, this.firmante, this.env.CUENTA_PATROCINADORA || null, () => Date.now(), () => void this.programar(), registrar, planes, sorteadora);
    if (cfg.red === "mainnet") {
      // El último saldo de créditos vive en los ajustes: si el objeto arranca de nuevo con Pollar caído, sigue valiendo sus 10 minutos.
      const pollar = pollarDe({ secreto: this.env.POLLAR_SECRETO, appId: cfg.pollarAppId, fetch: (u, i) => fetch(u, i), registrar, memoriaCreditos: memoriaEnAjustes(this.cupos) });
      const altas = new Altas(this.sql, this.cupos);
      // Los pagos: las órdenes nuevas solo con ALTAS_PAGO=1, pero los pagos de las que ya existen se leen igual.
      const cobros = new Cobros(this.sql, this.cupos);
      const lector = cfg.cuentaCobros ? new LectorDeCobros({ cobros, cuenta: cfg.cuentaCobros, fetch: (u, i) => fetch(u, i), registrar }) : null;
      this.puerta = new PuertaAltas({ cfg, cupos: this.cupos, altas, pollar, cuponSecreto: this.env.CUPON_SECRETO ?? null, red, registrar, cobros, lector });
      this.administracion = new Administracion({ cfg, cupos: this.cupos, altas, cuponSecreto: this.env.CUPON_SECRETO ?? null, red, registrar, cobros, lector });
      this.exportaAltas = true;
      if (cfg.altas && (this.env.CUPONES_TOKEN ?? "").length >= 32 && this.env.CUPONES_TOKEN === this.env.ADMIN_TOKEN) console.error(JSON.stringify({ evento: "error-config", faltaAltas: ["claves-iguales"] }));
      // Los secretos que faltan para las altas (nombres fijos, sin valores): las rutas dan 503 apagado hasta cargarlos.
      const faltaSecretos = [...(cfg.altas && !pollar ? ["pollar-llave"] : []), ...(cfg.altas && (this.env.CUPON_SECRETO ?? "").length < 32 ? ["cupon-secreto"] : [])];
      if (faltaSecretos.length) console.error(JSON.stringify({ evento: "error-config", faltaAltas: faltaSecretos }));
    }
    const falta = this.portero.faltaDeConfig();
    if (falta.length) console.error(JSON.stringify({ evento: "error-config", falta }));
    // Lo que se prendió de las altas y no se puede usar (nombres fijos, sin valores): no apaga al portero, solo eso.
    if (cfg.faltaAltas.length) console.error(JSON.stringify({ evento: "error-config", faltaAltas: cfg.faltaAltas }));
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

  /** `POST /v1/sorteo` (solo mainnet): el `draw` mandado desde la cuenta sorteadora. */
  async sortear(sorteo: string, firma: string): Promise<Respuesta> {
    try {
      return await (await this.obtener()).sortear(sorteo, firma);
    } catch (e) {
      registrar("error-interno", { donde: "sorteo", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno" } };
    }
  }

  /** Las rutas `/v1/alta/*` (solo mainnet). */
  async alta(accion: AccionAlta, pedido: PedidoAlta): Promise<Respuesta> {
    await this.obtener();
    if (!this.puerta) return { estado: 503, cuerpo: { motivo: "apagado" } };
    try {
      return await this.puerta.atender(accion, pedido);
    } catch (e) {
      // Solo el nombre del error: el mensaje podría llevar algo del pedido.
      registrar("error-interno", { donde: "alta", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno" } };
    }
  }

  /** Las rutas del pago, `/v1/alta/orden` y `/v1/alta/pago` (solo mainnet). */
  async pagoAlta(accion: AccionPago, pedido: PedidoAlta): Promise<Respuesta> {
    await this.obtener();
    if (!this.puerta) return { estado: 503, cuerpo: { motivo: "apagado" } };
    try {
      return await this.puerta.atenderPago(accion, pedido);
    } catch (e) {
      registrar("error-interno", { donde: "pago", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno" } };
    }
  }

  /** Las rutas `/v1/admin/*` (solo mainnet): cupones, altas a mano, pagos y las pausas. La clave ya la miró el Worker. */
  async adminAltas(accion: AccionAdmin, datos: unknown): Promise<Respuesta> {
    await this.obtener();
    if (!this.administracion) return { estado: 503, cuerpo: { motivo: "apagado" } };
    try {
      return await this.administracion.atender(accion, datos);
    } catch (e) {
      registrar("error-interno", { donde: "admin", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno" } };
    }
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
      case "estado": {
        // En mainnet con las altas, también el saldo de créditos de Pollar y el piso.
        // Y las altas de 24 horas y los cupones de hoy, y la vigilancia de firmas: firmasSinExplicar y patrocinioPollar.
        const e = await p.estado();
        return this.puerta ? { ...e, cuerpo: { ...e.cuerpo, ...(await this.puerta.resumen()), ...(this.administracion?.resumen() ?? {}), ...(await this.puerta.vigilancia()) } } : e;
      }
      case "exportar":
        // En mainnet, también las tablas de las altas.
        return { estado: 200, cuerpo: { exportado: Date.now(), tablas: this.cupos.exportar(this.exportaAltas) } };
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
/** Los pedidos a `/v1/alta/*`, con su propio contador. */
const altaPorIp = new PorIp();
/** Los pedidos a `/v1/sorteo`, con el suyo. */
const sorteoPorIp = new PorIp();

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

    // Las rutas de altas existen solo en mainnet; en testnet siguen sin existir, como siempre.
    if (url.pathname.startsWith("/v1/alta/") && env.RED === "mainnet") {
      const r = await atenderAlta(
        request,
        leerConfig(env),
        (accion, pedido) => objeto.alta(accion, pedido),
        altaPorIp,
        (accion, pedido) => objeto.pagoAlta(accion, pedido),
      );
      if (r) return r;
    }

    // La administración de las altas, también solo en mainnet: en testnet `/v1/admin/` sigue sin existir.
    if (url.pathname.startsWith("/v1/admin/") && env.RED === "mainnet") {
      const r = await atenderAdmin(request, env, leerConfig(env), (accion, datos) => objeto.adminAltas(accion, datos));
      if (r) return r;
    }

    // El sorteo del servidor, también solo en mainnet: en testnet `/v1/sorteo` sigue sin existir.
    if (url.pathname === "/v1/sorteo" && env.RED === "mainnet") {
      const r = await atenderSorteo(request, leerConfig(env), sorteoPorIp, (sorteo, firma) => objeto.sortear(sorteo, firma));
      if (r) return r;
    }

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
