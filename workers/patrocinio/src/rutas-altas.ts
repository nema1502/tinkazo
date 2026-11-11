/**
 * Las rutas de las altas del portero de mainnet: con la sesión de Pollar, qué acceso tiene la persona
 * (`POST /v1/alta/estado`) y el canje de un cupón (`POST /v1/alta/cupon`).
 *
 *   POST /v1/alta/estado   {}         200 {acceso, cuenta, abierta, pedido, sorteos:{quedan, proximoVence}, orden, fondeo}
 *   POST /v1/alta/cupon    {cupon}    200 {ok, repetido, sorteosSumados, sorteos, sigue}
 *        400 forma   404 cupon-no-existe   410 cupon-vencido {vence} | cupon-anulado   409 cupon-usado | lote-usado
 *        Comunes: 401 sesion   403 otra-app   502 pollar   503 apagado   429 intentos {reintentarEn}
 *
 * El orden es siempre el mismo: primero todo lo que espera (la sesión con Pollar, la huella del código, la billetera,
 * la red) y después se escribe todo de una vez, sin ningún `await` en el medio: el objeto atiende de a uno mientras no
 * haya un `await`, así que dos pedidos a la vez no se pisan. La persona es el `userId` que dio Pollar, nunca lo que
 * diga el navegador.
 *
 * El piso de créditos: un canje nuevo (y, cuando exista, una orden nueva) pasa solo si los créditos de Pollar, menos lo
 * que suma, no quedan por debajo de lo ya prometido (`piso`). Si no, `503 altas-pausadas` sin gastar el cupón. Lo ya
 * canjeado nunca se frena: el canje repetido, el estado y el sello no miran el piso.
 *
 * Solo en mainnet con `ALTAS=1`: en testnet las rutas no existen (`atenderAlta` devuelve null) y con `ALTAS=0` dan
 * `503 apagado`. La bitácora nunca lleva el token, el id de la persona, el código ni la cuenta.
 */
import { type Altas, huella, normalizar, SECRETO_MINIMO } from "./altas";
import { type Config, grupoDeIp } from "./config";
import { type Cupos, type FilaAlta, type Quedan } from "./cupos";
import { cors, json, origenPermitido } from "./http";
import { type Creditos, type MemoriaCreditos, type Pollar, type Sesion, formaDeToken } from "./pollar";
import type { PorIp } from "./por-ip";
import type { Red } from "./red";
import type { Respuesta } from "./servicio";

/** Códigos fallidos por persona y por hora. Pasado esto, 429 hasta que pase la hora. */
export const FALLIDOS_POR_USUARIO_HORA = 5;
/**
 * Códigos fallidos por dirección y por hora (en un evento casi todos salen por la misma). Los suma solo un código que no
 * vale en `/v1/alta/cupon`, y frena solo el canje: `/v1/alta/estado` no adivina nada y nunca se traba por dirección.
 */
export const FALLIDOS_POR_IP_HORA = 200;
/**
 * Tokens con forma de token que Pollar rechazó (inventados, vencidos o de la app de Prueba), por dirección y por hora.
 * Pasado esto, a un token nuevo de esa dirección ya no se le pregunta a Pollar. Nunca frena a una sesión que Pollar ya
 * dio por buena (`Pollar.conocida`). Lo que no tiene forma de token, o falta, no cuenta: ni llega a Pollar.
 */
export const TOKENS_NUEVOS_POR_IP_HORA = 200;
/**
 * Pedidos a `/v1/alta/*` por dirección y por hora, en la puerta del Worker (en memoria de cada nodo). Es para todo un
 * stand junto, que sale por la misma wifi: el freno de lo que se adivina son los topes de intentos, no este.
 */
export const ALTAS_POR_IP_HORA = 3000;
/** Lo que el piso guarda siempre, en créditos de Pollar, encima de lo prometido. */
export const PISO_BASE = 300;
/** El ajuste con el que se pausan las altas a mano (`"1"`). */
export const AJUSTE_PAUSA = "altas_pausadas";
/** El ajuste donde vive el último saldo de créditos leído, para que sobreviva a un reinicio del objeto. */
export const AJUSTE_CREDITOS = "creditos_ultimo";

/** Por qué se pausó algo nuevo: el piso, Pollar sin responder (sin un saldo reciente) o a mano. */
export type MotivoPausa = "piso" | "creditos" | "a-mano";

/** El último saldo leído, guardado en los ajustes del objeto (`creditos_ultimo`). Lo que no se entiende no es un saldo. */
export function memoriaEnAjustes(cupos: Pick<Cupos, "ajuste" | "fijarAjuste">): MemoriaCreditos {
  return {
    leer() {
      try {
        const o = JSON.parse(cupos.ajuste(AJUSTE_CREDITOS) ?? "null") as { valor?: unknown; ms?: unknown } | null;
        return o && typeof o.valor === "number" && Number.isFinite(o.valor) && typeof o.ms === "number" && Number.isFinite(o.ms) ? { valor: o.valor, ms: o.ms } : null;
      } catch {
        return null;
      }
    },
    guardar(valor, ms) {
      cupos.fijarAjuste(AJUSTE_CREDITOS, JSON.stringify({ valor, ms }), ms);
    },
  };
}

/** Lo más que se acepta de cuerpo: `{"cupon":"…"}` pesa menos de 100 bytes. */
const MAX_CUERPO = 2 * 1024;
const HORA_MS = 3_600_000;

type Registrar = (evento: string, datos?: Record<string, string | number>) => void;
const r = (estado: number, cuerpo: Record<string, unknown>): Respuesta => ({ estado, cuerpo });

/** Fallidos por clave en una ventana de una hora desde el primero, en memoria del objeto. */
export class Intentos {
  private readonly cuentas = new Map<string, { n: number; vence: number }>();
  constructor(
    private readonly tope: number,
    private readonly reloj: () => number,
  ) {}

  /** Hasta cuándo está trabada la clave (ms), o null si puede seguir. */
  trabado(clave: string): number | null {
    const f = this.cuentas.get(clave);
    return f && f.vence > this.reloj() && f.n >= this.tope ? f.vence : null;
  }

  fallo(clave: string): void {
    const ahora = this.reloj();
    const f = this.cuentas.get(clave);
    if (f && f.vence > ahora) {
      f.n += 1;
      return;
    }
    if (this.cuentas.size > 5000) for (const [k, v] of this.cuentas) if (v.vence <= ahora) this.cuentas.delete(k);
    this.cuentas.set(clave, { n: 1, vence: ahora + HORA_MS });
  }
}

/** Lo que llega del Worker al objeto: el token (de la cabecera), la dirección y el cuerpo ya leído. */
export interface PedidoAlta {
  token: string | null;
  ip: string;
  cuerpo: unknown;
}

export type AccionAlta = "estado" | "cupon";

/** Lo que el canje no deja pasar porque alguien probó un código: cuenta como fallido. */
const FALLIDOS = new Set(["cupon-no-existe", "cupon-vencido", "cupon-anulado", "cupon-usado", "lote-usado"]);
const ESTADO_DEL_ERROR: Record<string, number> = {
  "cupon-no-existe": 404,
  "cupon-vencido": 410,
  "cupon-anulado": 410,
  "cupon-usado": 409,
  "lote-usado": 409,
  "cuenta-de-otro": 409,
  "altas-pausadas": 503,
};

export interface DependenciasAltas {
  cfg: Config;
  cupos: Cupos;
  altas: Altas;
  /** Null si falta la llave de Pollar o la app: entonces las rutas dan `503 apagado`. */
  pollar: Pollar | null;
  /** `CUPON_SECRETO`. Sin él (o con menos de 32 caracteres) no hay huella y las rutas dan `503 apagado`. */
  cuponSecreto: string | null;
  /** Para saber si la cuenta ya existe en la red (se activó). */
  red: Pick<Red, "leerCuenta">;
  reloj?: () => number;
  registrar?: Registrar;
}

export class PuertaAltas {
  private readonly reloj: () => number;
  private readonly registrar: Registrar;
  private readonly porUsuario: Intentos;
  /** Códigos fallidos por dirección: frenan solo el canje. */
  private readonly codigosPorIp: Intentos;
  /** Tokens nuevos que Pollar rechazó, por dirección: deciden solo si se le pregunta a Pollar por otro token nuevo. */
  private readonly tokensPorIp: Intentos;

  constructor(private readonly d: DependenciasAltas) {
    this.reloj = d.reloj ?? (() => Date.now());
    this.registrar = d.registrar ?? (() => {});
    this.porUsuario = new Intentos(FALLIDOS_POR_USUARIO_HORA, this.reloj);
    this.codigosPorIp = new Intentos(FALLIDOS_POR_IP_HORA, this.reloj);
    this.tokensPorIp = new Intentos(TOKENS_NUEVOS_POR_IP_HORA, this.reloj);
  }

  /** null si se puede atender; si no, el 503 que corresponde. */
  private apagado(): Respuesta | null {
    const { cfg, pollar, cuponSecreto } = this.d;
    if (cfg.red !== "mainnet" || !cfg.altas) return r(503, { motivo: "apagado" });
    if (!pollar || !cfg.pollarAppId || !cfg.pollarFondeo || !cuponSecreto || cuponSecreto.length < SECRETO_MINIMO) return r(503, { motivo: "apagado", detalle: "config" });
    return null;
  }

  /**
   * La sesión de la persona, preguntada a Pollar.
   *
   * - Sin token, o con algo que no tiene forma de token: `401 sesion` sin preguntar ni contar nada. No le cuesta nada a
   *   nadie y no adivina nada, así que no puede trabar una dirección.
   * - Una sesión que Pollar ya dio por buena (`conocida`) nunca se traba por dirección: en un evento todos salen por la misma.
   * - Un token nuevo que Pollar rechaza suma en `tokensPorIp`; pasado su tope, a otro token nuevo de esa dirección ya no
   *   se le pregunta (`429 intentos`) hasta que pase la hora.
   */
  private async sesion(token: string | null, ip: string): Promise<{ ok: true; s: Extract<Sesion, { ok: true }> } | { ok: false; r: Respuesta }> {
    if (!formaDeToken(token, this.reloj())) return { ok: false, r: r(401, { motivo: "sesion" }) };
    const pollar = this.d.pollar as Pollar;
    const grupo = grupoDeIp(ip);
    const conocida = await pollar.conocida(token);
    if (!conocida) {
      const trabada = this.tokensPorIp.trabado(grupo);
      if (trabada !== null) return { ok: false, r: r(429, { motivo: "intentos", reintentarEn: trabada }) };
    }
    const s = await pollar.verificar(token);
    if (s.ok && !s.usuario.startsWith("cuenta:")) return { ok: true, s };
    if (s.ok || s.motivo === "pollar") return { ok: false, r: r(502, { motivo: "pollar" }) };
    if (!conocida) this.tokensPorIp.fallo(grupo);
    return { ok: false, r: s.motivo === "otra-app" ? r(403, { motivo: "otra-app" }) : r(401, { motivo: "sesion" }) };
  }

  /**
   * La cuenta de Stellar de la persona: la que ya tiene atada su alta, la que trae el verify o, si no, la de su fila en
   * `users`. `ok: false` si Pollar no contesta o no se puede saber sin dudas (no se ata nada a ciegas).
   */
  private async cuentaDe(s: Extract<Sesion, { ok: true }>, alta: FilaAlta | null): Promise<{ ok: true; cuenta: string | null } | { ok: false }> {
    if (alta?.cuenta) return { ok: true, cuenta: alta.cuenta };
    if (s.cuenta) return { ok: true, cuenta: s.cuenta };
    return (this.d.pollar as Pollar).billeteraDe(s.usuario);
  }

  /** Si la cuenta ya existe en la red. Si la red no contesta, se toma como que no: lo peor es pedir una activación de más. */
  private async abierta(cuenta: string | null, alta: FilaAlta | null): Promise<boolean> {
    if (!cuenta) return false;
    if (alta?.estado === "abierta") return true;
    try {
      return (await this.d.red.leerCuenta(cuenta)) !== null;
    } catch {
      return false;
    }
  }

  /** El alta que le da acceso: la suya o, si administración admitió su cuenta a mano, esa. */
  private altaQueVale(usuario: string, cuenta: string | null): FilaAlta | null {
    const suya = this.d.cupos.altaDe(usuario);
    if (suya) return suya;
    return cuenta ? this.d.cupos.altaDe(`cuenta:${cuenta}`) : null;
  }

  private sorteos(usuario: string, cuenta: string | null, ahora: number): { quedan: number; proximoVence: Quedan["proximoVence"] } {
    const q = this.d.cupos.quedan(cuenta && this.d.cupos.estaEnElLibro(cuenta) ? { cuenta } : { usuario }, ahora);
    return { quedan: q.quedan, proximoVence: q.proximoVence };
  }

  /**
   * El piso de créditos ahora: `CREDITOS_POR_SORTEO` por cada sorteo prometido sin usar ni vencer, más
   * `CREDITOS_POR_ALTA` por cada alta sin activar, más `PISO_BASE`. Síncrono: se puede llamar adentro de una transacción.
   */
  piso(ahora: number): number {
    const p = this.d.cupos.prometido(ahora);
    return this.d.cfg.creditosPorSorteo * p.sorteos + this.d.cfg.creditosPorAlta * p.altas + PISO_BASE;
  }

  /**
   * Si algo nuevo que promete `costo` créditos tiene que esperar: pausado a mano, sin un saldo reciente de Pollar o con
   * el saldo, menos el costo, por debajo del piso. null si puede seguir. Síncrono, para llamarlo en la misma jugada que
   * escribe (así dos canjes a la vez no se apoyan en el mismo margen).
   */
  pausa(creditos: Creditos, costo: number, ahora: number): MotivoPausa | null {
    if (this.d.cupos.ajuste(AJUSTE_PAUSA) === "1") return "a-mano";
    if (!creditos.ok) return "creditos";
    return creditos.disponibles - costo < this.piso(ahora) ? "piso" : null;
  }

  /** Para `/v1/patrocinio/estado`: el saldo de créditos, el piso y la diferencia. Sin saldo reciente, null. */
  async resumen(): Promise<Record<string, unknown>> {
    if (this.d.cfg.red !== "mainnet" || !this.d.cfg.altas) return {};
    const creditos = this.d.pollar ? await this.d.pollar.creditos() : ({ ok: false } as const);
    const piso = this.piso(this.reloj());
    return {
      creditos: creditos.ok ? creditos.disponibles : null,
      creditosLeidos: creditos.ok ? creditos.leido : null,
      piso,
      margen: creditos.ok ? creditos.disponibles - piso : null,
      altasPausadas: this.d.cupos.ajuste(AJUSTE_PAUSA) === "1",
    };
  }

  private sigue(cuenta: string | null, abierta: boolean): "crear-billetera" | "abrir" | "activar" | "lista" {
    if (!cuenta) return "crear-billetera";
    if (abierta) return "lista";
    return this.d.cfg.pollarFondeo === "diferido" ? "abrir" : "activar";
  }

  async atender(accion: AccionAlta, p: PedidoAlta): Promise<Respuesta> {
    return accion === "cupon" ? this.cupon(p) : this.estado(p);
  }

  /**
   * `POST /v1/alta/estado`: qué acceso tiene la persona y cuántos sorteos oficiales le quedan. Si tiene alta y la cuenta
   * todavía no estaba atada, la ata y la mete en el libro.
   */
  async estado(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const suya = this.d.cupos.altaDe(usuario);
    const c = await this.cuentaDe(ses.s, suya);
    if (!c.ok) return r(502, { motivo: "pollar" });
    const cuenta = c.cuenta;
    const abierta = await this.abierta(cuenta, suya ?? (cuenta ? this.d.cupos.altaDe(`cuenta:${cuenta}`) : null));

    // Desde acá, sin await: leer y escribir es una sola jugada.
    const ahora = this.reloj();
    const alta = this.altaQueVale(usuario, cuenta);
    if (alta && cuenta) {
      const atado = this.d.cupos.transaccion(() => {
        const a = alta.usuario === usuario && (alta.cuenta === null || !this.d.cupos.estaEnElLibro(cuenta)) ? this.d.cupos.atar(usuario, cuenta, ahora) : "ok";
        if (a === "ok" && abierta) this.d.cupos.marcarAbierta(alta.usuario, ahora);
        return a;
      });
      if (atado === "cuenta-de-otro") {
        this.registrar("error-alta", { motivo: "cuenta-de-otro" });
        return r(409, { motivo: "cuenta-de-otro" });
      }
    }
    const final = alta ? this.d.cupos.altaDe(alta.usuario) : null;
    return r(200, {
      acceso: final ? final.motivo : "ninguno",
      cuenta,
      abierta,
      pedido: final?.pedido ?? null,
      sorteos: this.sorteos(usuario, cuenta, ahora),
      orden: null,
      fondeo: this.d.cfg.pollarFondeo,
    });
  }

  /**
   * `POST /v1/alta/cupon`: canjea un cupón para la persona de la sesión. El mismo cupón otra vez es lo mismo (sin gastar
   * otro uso). Un código que no vale le suma un fallido a la persona y a la dirección; pasado el tope de cualquiera de
   * los dos, el canje da `429 intentos` (la dirección frena solo el canje, nunca `/estado`).
   */
  async cupon(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const trabado = this.porUsuario.trabado(usuario) ?? this.codigosPorIp.trabado(grupoDeIp(p.ip));
    if (trabado !== null) return r(429, { motivo: "intentos", reintentarEn: trabado });
    const codigo = normalizar(p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { cupon?: unknown }).cupon : undefined);
    if (!codigo) {
      this.fallido(usuario, p.ip);
      return r(400, { motivo: "forma" });
    }
    const h = await huella(codigo, this.d.cuponSecreto as string);
    const suya = this.d.cupos.altaDe(usuario);
    const c = await this.cuentaDe(ses.s, suya);
    if (!c.ok) return r(502, { motivo: "pollar" });
    const cuenta = c.cuenta;
    const abierta = await this.abierta(cuenta, suya);
    // El saldo se lee antes (con su memoria de 60 s); si el canje resulta repetido, ni se mira.
    const creditos = await (this.d.pollar as Pollar).creditos();

    // Desde acá, sin await: el canje comprueba, mira el piso y gasta en una transacción.
    const ahora = this.reloj();
    const pausa: { motivo: MotivoPausa | null } = { motivo: null };
    const freno = (x: { sorteos: number; altaNueva: boolean }) => {
      pausa.motivo = this.pausa(creditos, this.d.cfg.creditosPorSorteo * x.sorteos + (x.altaNueva ? this.d.cfg.creditosPorAlta : 0), ahora);
      return pausa.motivo ? ("altas-pausadas" as const) : null;
    };
    const res = this.d.altas.canjear({ huella: h, usuario, cuenta, freno }, ahora);
    if (pausa.motivo) this.registrar("alta-pausa", { motivo: pausa.motivo });
    if (!res.ok) {
      if (FALLIDOS.has(res.motivo)) this.fallido(usuario, p.ip);
      if (res.motivo === "cuenta-de-otro") this.registrar("error-alta", { motivo: "cuenta-de-otro" });
      return r(ESTADO_DEL_ERROR[res.motivo] ?? 400, res.motivo === "cupon-vencido" ? { motivo: res.motivo, vence: res.vence } : { motivo: res.motivo });
    }
    if (abierta) this.d.cupos.marcarAbierta(usuario, ahora);
    if (!res.repetido) this.registrar("alta-canje", { lote: res.lote, sorteos: res.sorteosSumados, altaNueva: res.altaNueva ? 1 : 0 });
    return r(200, { ok: true, repetido: res.repetido, sorteosSumados: res.sorteosSumados, sorteos: this.sorteos(usuario, cuenta, ahora), sigue: this.sigue(cuenta, abierta) });
  }

  private fallido(usuario: string, ip: string): void {
    this.porUsuario.fallo(usuario);
    this.codigosPorIp.fallo(grupoDeIp(ip));
  }
}

/**
 * La puerta del Worker para `/v1/alta/*`: solo en mainnet (en testnet devuelve null y la ruta sigue sin existir, como
 * siempre). Controla el método, el origen, el tamaño y el cuerpo, saca el token de `Authorization: Bearer` y le pasa
 * el pedido al objeto con `llamar`. Nunca pone el token en una dirección ni en la bitácora.
 */
export async function atenderAlta(request: Request, cfg: Config, llamar: (accion: AccionAlta, p: PedidoAlta) => Promise<Respuesta>, porIp: PorIp): Promise<Response | null> {
  if (cfg.red !== "mainnet") return null;
  const url = new URL(request.url);
  const origen = request.headers.get("Origin");
  const cabeceras = cors(origen, false, true);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras });
  const m = /^\/v1\/alta\/(estado|cupon)$/.exec(url.pathname);
  if (!m?.[1]) return json({ motivo: "no-existe" }, 404, cabeceras);
  if (request.method !== "POST") return json({ motivo: "metodo" }, 405, cabeceras);
  if (!cfg.altas) return json({ motivo: "apagado" }, 503, cabeceras);
  // Un navegador manda su origen; un programa puede mentirlo: la defensa de verdad es la sesión de Pollar y los topes.
  if (!origenPermitido(origen)) return json({ motivo: "origen" }, 403, cabeceras);
  const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  if (!porIp.toca(ip, ALTAS_POR_IP_HORA)) return json({ motivo: "cupo-ip" }, 429, cabeceras);
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400, cabeceras);
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400, cabeceras);
  let cuerpo: unknown = {};
  if (texto.trim()) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return json({ motivo: "cuerpo" }, 400, cabeceras);
    }
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return json({ motivo: "cuerpo" }, 400, cabeceras);
  const token = /^Bearer (\S{1,8192})$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
  try {
    const res = await llamar(m[1] as AccionAlta, { token, ip, cuerpo });
    return json(res.cuerpo, res.estado, cabeceras);
  } catch {
    // Sin el error en la bitácora: podría llevar algo del pedido. El objeto anota lo suyo.
    return json({ motivo: "interno" }, 500, cabeceras);
  }
}
