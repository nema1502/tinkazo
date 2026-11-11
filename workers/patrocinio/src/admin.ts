/**
 * La administración de las altas del portero de mainnet, con dos claves:
 *
 *   Con `CUPONES_TOKEN` (cupones y altas a mano; vive en la laptop para `scripts/cupones.mjs`):
 *     POST /v1/admin/cupones          {lote, codigos:[hasta 500], sorteos, dias, vence, usos}   200 {creados, repetidos}   400 techo
 *     GET  /v1/admin/cupones?lote=    200 {lote, creados, canjeados, cuentas, sorteosUsados, vence, anulado, anulados}
 *     POST /v1/admin/cupones/anular   {lote} | {codigo}                                         200 {anulados}
 *     POST /v1/admin/altas            {cuenta, sorteos, dias, ref}                              200 {ok, repetido, altaNueva, sorteos}
 *     POST /v1/admin/derechos         {cuenta, sorteos, dias, ref}                              200 {ok, repetido, sorteos}   409 fuera-del-libro
 *     POST /v1/admin/ordenes/pagada   {orden, metodo:"a-mano"|"qr-bs", ref}                     200 {ok, repetido}   404 orden
 *     GET  /v1/admin/sueltos          200 {sueltos:[…], parciales?:[…], horizon?:false}
 *     POST /v1/admin/sueltos/asignar  {operacion, orden} | {operacion, devuelto:true, ref}      200 {ok, pagada, sobrante} | {ok, repetido}
 *   Con `ADMIN_TOKEN` (operar, como las rutas de siempre):
 *     POST /v1/admin/altas/pausar | reanudar                                                    200 {pausadas}
 *     POST /v1/admin/ventas/pausar | reanudar                                                   200 {ventaPausada}
 *
 * La clave de operar no crea cupones ni da sorteos, y la de cupones no apaga ni pausa nada. Sin la clave de una ruta
 * cargada, esa ruta no existe (404, como las de administración de siempre). Solo en mainnet con `ALTAS=1`: en testnet
 * `/v1/admin/` sigue sin existir.
 *
 * Los códigos llegan en claro y acá se convierten en su huella: el código no se guarda ni se anota. Los techos van en el
 * código, aunque se filtre la clave de cupones: 500 usos de cupones nuevos (`TECHO_CUPONES_DIA`) y 500 sorteos que
 * prometen (`TECHO_SORTEOS_CUPONES_DIA`), 50 altas a mano y 500 sorteos dados a mano por día (UTC). Los sorteos de los
 * cupones y los dados a mano tienen techos aparte: con la clave filtrada, un día promete como mucho 1.000.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { type Altas, FORMA_LOTE, MAX_CODIGOS_POR_PEDIDO, SECRETO_MINIMO, huella, normalizar } from "./altas";
import { AJUSTE_VENTA_PAUSADA, type Cobros, type LectorDeCobros, normalizarOrden, usdcTexto } from "./cobros";
import { type Config } from "./config";
import { type Cupos, entre } from "./cupos";
import { json } from "./http";
import type { Red } from "./red";
import { AJUSTE_PAUSA } from "./rutas-altas";
import type { Respuesta } from "./servicio";

/** Altas a mano nuevas por día (UTC). */
export const TECHO_ALTAS_DIA = 50;
/** Sorteos oficiales dados a mano por día (UTC). */
export const TECHO_SORTEOS_DIA = 500;
/** Lo más corto que se acepta de una clave de administración. */
export const CLAVE_MINIMA = 32;
/** Un pedido de 500 códigos pesa unos 10 KB. */
const MAX_CUERPO = 64 * 1024;
/** El `ref` de un alta a mano: lo que la explica (`pruebas-internas`, `venta-qr-0001`). */
const FORMA_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type AccionAdmin =
  | "cupones-crear"
  | "cupones-estado"
  | "cupones-anular"
  | "altas-admitir"
  | "altas-pausar"
  | "altas-reanudar"
  | "derechos-dar"
  | "ordenes-pagada"
  | "sueltos-lista"
  | "sueltos-asignar"
  | "ventas-pausar"
  | "ventas-reanudar";

/** El id de una operación de Horizon: un entero más grande que uno seguro de JavaScript, siempre en texto. */
const OPERACION = /^\d{1,30}$/;

type Registrar = (evento: string, datos?: Record<string, string | number>) => void;
const r = (estado: number, cuerpo: Record<string, unknown>): Respuesta => ({ estado, cuerpo });
const objeto = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

export interface DependenciasAdmin {
  cfg: Config;
  cupos: Cupos;
  altas: Altas;
  /** `CUPON_SECRETO`. Sin él (o corto) lo de cupones da `503 apagado`; admitir y pausar siguen. */
  cuponSecreto: string | null;
  /** Para saber si la cuenta que se admite ya existe en la red. */
  red: Pick<Red, "leerCuenta">;
  reloj?: () => number;
  registrar?: Registrar;
  /** Las órdenes y los pagos sueltos. Sin esto, lo de los pagos da `503 apagado`. */
  cobros?: Cobros | null;
  /** Quien lee los pagos en Horizon: la lista de sueltos lee antes lo nuevo. Sin él, lista lo que ya se sabía. */
  lector?: LectorDeCobros | null;
}

export class Administracion {
  private readonly reloj: () => number;
  private readonly registrar: Registrar;

  constructor(private readonly d: DependenciasAdmin) {
    this.reloj = d.reloj ?? (() => Date.now());
    this.registrar = d.registrar ?? (() => {});
  }

  private prendida(): boolean {
    return this.d.cfg.red === "mainnet" && this.d.cfg.altas;
  }

  private secreto(): string | null {
    const s = this.d.cuponSecreto;
    return typeof s === "string" && s.length >= SECRETO_MINIMO ? s : null;
  }

  async atender(accion: AccionAdmin, datos: unknown): Promise<Respuesta> {
    if (!this.prendida()) return r(503, { motivo: "apagado" });
    const o = objeto(datos);
    switch (accion) {
      case "cupones-crear":
        return this.crear(o);
      case "cupones-estado":
        return this.estadoDelLote(o);
      case "cupones-anular":
        return this.anular(o);
      case "altas-admitir":
        return this.admitir(o);
      case "altas-pausar":
      case "altas-reanudar": {
        const pausadas = accion === "altas-pausar";
        this.d.cupos.fijarAjuste(AJUSTE_PAUSA, pausadas ? "1" : "0", this.reloj());
        this.registrar(pausadas ? "alta-pausa" : "alta-reanudar", pausadas ? { motivo: "a-mano" } : {});
        return r(200, { pausadas });
      }
      case "derechos-dar":
        return this.dar(o);
      case "sueltos-lista":
        return this.sueltosLista();
      case "ordenes-pagada":
      case "sueltos-asignar":
      case "ventas-pausar":
      case "ventas-reanudar":
        return this.pagos(accion, o);
      default:
        return r(404, { motivo: "accion" });
    }
  }

  /** Los códigos llegan en claro: se normalizan, se convierten en huella y recién ahí se escriben, todos o ninguno. */
  private async crear(o: Record<string, unknown>): Promise<Respuesta> {
    const secreto = this.secreto();
    if (!secreto) return r(503, { motivo: "apagado", detalle: "config" });
    const { codigos } = o;
    if (!Array.isArray(codigos) || codigos.length < 1 || codigos.length > MAX_CODIGOS_POR_PEDIDO) return r(400, { motivo: "cuerpo" });
    const normales = codigos.map((c) => normalizar(c));
    if (normales.some((c) => c === null)) return r(400, { motivo: "cuerpo", detalle: "codigo" });
    const usos = o.usos === undefined ? 1 : o.usos;
    if (typeof o.lote !== "string" || typeof o.sorteos !== "number" || typeof o.dias !== "number" || typeof o.vence !== "number" || typeof usos !== "number") return r(400, { motivo: "cuerpo" });
    const huellas = await Promise.all((normales as string[]).map((c) => huella(c, secreto)));
    const res = this.d.altas.crearCupones({ lote: o.lote, huellas, sorteos: o.sorteos, dias: o.dias, vence: o.vence, usos }, this.reloj());
    if (!res.ok) return r(400, { motivo: res.motivo });
    this.registrar("admin-cupones", { lote: o.lote, creados: res.creados, repetidos: res.repetidos });
    return r(200, { creados: res.creados, repetidos: res.repetidos });
  }

  private estadoDelLote(o: Record<string, unknown>): Respuesta {
    if (typeof o.lote !== "string" || !FORMA_LOTE.test(o.lote)) return r(400, { motivo: "cuerpo" });
    const e = this.d.altas.estadoDelLote(o.lote);
    return e ? r(200, { ...e }) : r(404, { motivo: "lote" });
  }

  private async anular(o: Record<string, unknown>): Promise<Respuesta> {
    const porLote = o.lote !== undefined;
    if (porLote === (o.codigo !== undefined)) return r(400, { motivo: "cuerpo" });
    if (porLote) {
      if (typeof o.lote !== "string" || !FORMA_LOTE.test(o.lote)) return r(400, { motivo: "cuerpo" });
      const { anulados } = this.d.altas.anular({ lote: o.lote });
      this.registrar("admin-anular", { por: "lote", lote: o.lote, anulados });
      return r(200, { anulados });
    }
    const secreto = this.secreto();
    if (!secreto) return r(503, { motivo: "apagado", detalle: "config" });
    const codigo = normalizar(o.codigo);
    if (!codigo) return r(400, { motivo: "forma" });
    const { anulados } = this.d.altas.anular({ huella: await huella(codigo, secreto) });
    this.registrar("admin-anular", { por: "codigo", anulados });
    return r(200, { anulados });
  }

  /**
   * Admite una cuenta que ya existe (la de quien mantiene el proyecto, una venta por QR): la mete en el libro y le da
   * sus sorteos con `ref` `admin:<ref>`. Primero se espera a la red (si la cuenta ya existe) y después se escribe todo de
   * una vez, sin `await` en el medio.
   */
  private async admitir(o: Record<string, unknown>): Promise<Respuesta> {
    const { cuenta, sorteos, dias, ref } = o;
    if (typeof cuenta !== "string" || !StrKey.isValidEd25519PublicKey(cuenta)) return r(400, { motivo: "cuerpo" });
    if (!entre(sorteos, 1, TECHO_SORTEOS_DIA) || !entre(dias, 1, 3650) || typeof ref !== "string" || !FORMA_REF.test(ref)) return r(400, { motivo: "cuerpo" });
    let abierta = false;
    try {
      abierta = (await this.d.red.leerCuenta(cuenta)) !== null;
    } catch {
      // Sin red se toma como que no existe: lo peor es contarla de más en el piso.
      abierta = false;
    }
    const ahora = this.reloj();
    const res = this.d.altas.admitirAMano({ cuenta, sorteos, dias, ref, abierta, techoAltas: TECHO_ALTAS_DIA, techoSorteos: TECHO_SORTEOS_DIA }, ahora);
    if (!res.ok) return res.motivo === "ref-usado" ? r(409, { motivo: "ref-usado" }) : r(400, { motivo: "techo", que: res.motivo === "techo-altas" ? "altas" : "sorteos" });
    if (!res.repetido) this.registrar("admin-alta", { sorteos, dias, altaNueva: res.altaNueva ? 1 : 0 });
    const q = this.d.cupos.quedan({ cuenta }, ahora);
    return r(200, { ok: true, repetido: res.repetido, altaNueva: res.altaNueva, sorteos: { quedan: q.quedan, proximoVence: q.proximoVence } });
  }

  /**
   * Sorteos a mano para una cuenta que ya está en el libro (`cupones.mjs dar`), con `ref` `admin:<ref>` y el techo de
   * sorteos dados a mano del día.
   */
  private dar(o: Record<string, unknown>): Respuesta {
    const { cuenta, sorteos, dias, ref } = o;
    if (typeof cuenta !== "string" || !StrKey.isValidEd25519PublicKey(cuenta)) return r(400, { motivo: "cuerpo" });
    if (!entre(sorteos, 1, TECHO_SORTEOS_DIA) || !entre(dias, 1, 3650) || typeof ref !== "string" || !FORMA_REF.test(ref)) return r(400, { motivo: "cuerpo" });
    const ahora = this.reloj();
    const res = this.d.altas.darAMano({ cuenta, sorteos, dias, ref, techoSorteos: TECHO_SORTEOS_DIA }, ahora);
    if (!res.ok) return res.motivo === "techo-sorteos" ? r(400, { motivo: "techo", que: "sorteos" }) : r(409, { motivo: res.motivo });
    if (!res.repetido) this.registrar("admin-derechos", { sorteos, dias });
    const q = this.d.cupos.quedan({ cuenta }, ahora);
    return r(200, { ok: true, repetido: res.repetido, sorteos: { quedan: q.quedan, proximoVence: q.proximoVence } });
  }

  /**
   * `GET /v1/admin/sueltos`: primero lee los pagos nuevos (nadie tiene que haber tocado «Ya pagué»), y después los pagos
   * sueltos sin resolver y, si hay, las órdenes pagadas a medias (`parciales`, vencidas o no, sin la persona), que no
   * están en los sueltos porque lo que llegó ya está atado a su orden. Si Horizon no contestó, `horizon: false` y lo que
   * ya se sabía.
   */
  private async sueltosLista(): Promise<Respuesta> {
    const cobros = this.d.cobros;
    if (!cobros) return r(503, { motivo: "apagado", detalle: "config" });
    const lectura = this.d.lector ? await this.d.lector.leer() : { ok: true };
    const parciales = cobros.parciales(this.reloj());
    return r(200, { sueltos: cobros.sueltos(), ...(parciales.length ? { parciales } : {}), ...(lectura.ok ? {} : { horizon: false }) });
  }

  /** Las órdenes pagadas por fuera, los pagos sueltos y la venta pausada. */
  private pagos(accion: AccionAdmin, o: Record<string, unknown>): Respuesta {
    const cobros = this.d.cobros;
    if (!cobros) return r(503, { motivo: "apagado", detalle: "config" });
    const ahora = this.reloj();
    switch (accion) {
      case "ordenes-pagada": {
        const orden = normalizarOrden(o.orden);
        const { metodo, ref } = o;
        if (!orden || (metodo !== "a-mano" && metodo !== "qr-bs") || typeof ref !== "string" || !FORMA_REF.test(ref)) return r(400, { motivo: "cuerpo" });
        const res = cobros.marcarPagadaAMano({ orden, metodo, ref, techoAltas: TECHO_ALTAS_DIA, techoSorteos: TECHO_SORTEOS_DIA }, ahora);
        if (!res.ok) return res.motivo === "orden" ? r(404, { motivo: "orden" }) : r(400, { motivo: "techo", que: res.motivo === "techo-altas" ? "altas" : "sorteos" });
        if (!res.repetido) this.registrar("admin-pagada", { metodo, producto: cobros.orden(orden)?.producto ?? "?" });
        return r(200, { ok: true, repetido: res.repetido });
      }
      case "sueltos-asignar": {
        const { operacion, orden, devuelto, ref } = o;
        if (typeof operacion !== "string" || !OPERACION.test(operacion)) return r(400, { motivo: "cuerpo" });
        if (devuelto === true) {
          if (orden !== undefined || typeof ref !== "string" || !FORMA_REF.test(ref)) return r(400, { motivo: "cuerpo" });
          const res = cobros.devolver({ operacion, ref });
          if (!res.ok) return res.motivo === "suelto" ? r(404, { motivo: "suelto" }) : r(409, { motivo: "ya-resuelto", estado: res.estado });
          if (!res.repetido) this.registrar("admin-suelto", { accion: "devuelto" });
          return r(200, { ok: true, repetido: res.repetido });
        }
        const id = normalizarOrden(orden);
        if (devuelto !== undefined || !id) return r(400, { motivo: "cuerpo" });
        const res = cobros.asignar({ operacion, orden: id }, ahora);
        if (!res.ok) return res.motivo === "ya-resuelto" ? r(409, { motivo: "ya-resuelto", estado: res.estado }) : res.motivo === "no-asignable" ? r(409, { motivo: "no-asignable" }) : r(404, { motivo: res.motivo });
        this.registrar("admin-suelto", { accion: "asignado", pagada: res.pagada ? 1 : 0 });
        return r(200, { ok: true, pagada: res.pagada, sobrante: usdcTexto(res.sobrante) });
      }
      case "ventas-pausar":
      case "ventas-reanudar": {
        const ventaPausada = accion === "ventas-pausar";
        this.d.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, ventaPausada ? "1" : "0", ahora);
        this.registrar("venta-pausa", { pausada: ventaPausada ? 1 : 0 });
        return r(200, { ventaPausada });
      }
      default:
        return r(404, { motivo: "accion" });
    }
  }

  /**
   * Para `/v1/patrocinio/estado`: altas de las últimas 24 horas y cupones canjeados y creados hoy (UTC). Con los pagos,
   * también cuántos pagos sueltos quedan sin resolver y si la venta está pausada. Sin cuentas.
   */
  resumen(): Record<string, number | boolean> {
    if (!this.prendida()) return {};
    const base = this.d.altas.resumen(this.reloj());
    const cobros = this.d.cobros;
    return cobros ? { ...base, pagosSueltos: cobros.sueltosSinResolver(), ventaPausada: this.d.cupos.ajuste(AJUSTE_VENTA_PAUSADA) === "1" } : base;
  }
}

/** Si `dado` es `secreto`, comparando las huellas de los dos byte por byte sin cortar antes. */
export async function claveIgual(dado: string, secreto: string): Promise<boolean> {
  if (!dado || secreto.length < CLAVE_MINIMA) return false;
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([h(dado), h(secreto)]);
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= (a[i] as number) ^ (b[i] as number);
  return diferencia === 0;
}

const RUTAS: Record<string, { clave: "cupones" | "operar"; metodos: Partial<Record<string, AccionAdmin>> }> = {
  "/v1/admin/cupones": { clave: "cupones", metodos: { POST: "cupones-crear", GET: "cupones-estado" } },
  "/v1/admin/cupones/anular": { clave: "cupones", metodos: { POST: "cupones-anular" } },
  "/v1/admin/altas": { clave: "cupones", metodos: { POST: "altas-admitir" } },
  "/v1/admin/altas/pausar": { clave: "operar", metodos: { POST: "altas-pausar" } },
  "/v1/admin/altas/reanudar": { clave: "operar", metodos: { POST: "altas-reanudar" } },
  "/v1/admin/derechos": { clave: "cupones", metodos: { POST: "derechos-dar" } },
  "/v1/admin/ordenes/pagada": { clave: "cupones", metodos: { POST: "ordenes-pagada" } },
  "/v1/admin/sueltos": { clave: "cupones", metodos: { GET: "sueltos-lista" } },
  "/v1/admin/sueltos/asignar": { clave: "cupones", metodos: { POST: "sueltos-asignar" } },
  "/v1/admin/ventas/pausar": { clave: "operar", metodos: { POST: "ventas-pausar" } },
  "/v1/admin/ventas/reanudar": { clave: "operar", metodos: { POST: "ventas-reanudar" } },
};

/**
 * La puerta del Worker para `/v1/admin/*`: solo en mainnet (fuera de mainnet, o fuera de `/v1/admin/`, devuelve null y
 * la ruta sigue sin existir). Mira la clave de la ruta, el método y el cuerpo, y le pasa el pedido al objeto con
 * `llamar`. Sin CORS: no se llama desde el navegador.
 */
export async function atenderAdmin(
  request: Request,
  env: { ADMIN_TOKEN?: string | undefined; CUPONES_TOKEN?: string | undefined },
  cfg: Config,
  llamar: (accion: AccionAdmin, datos: unknown) => Promise<Respuesta>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (cfg.red !== "mainnet" || !url.pathname.startsWith("/v1/admin/")) return null;
  const ruta = RUTAS[url.pathname];
  if (!ruta) return json({ motivo: "no-existe" }, 404);
  const operar = env.ADMIN_TOKEN ?? "";
  const cupones = env.CUPONES_TOKEN ?? "";
  const secreto = ruta.clave === "cupones" ? cupones : operar;
  if (secreto.length < CLAVE_MINIMA) return json({ motivo: "no-existe" }, 404);
  const dado = /^Bearer (\S{1,512})$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
  if (!(await claveIgual(dado, secreto))) return json({ motivo: "clave" }, 401);
  // Dos claves iguales son una sola: la de operar daría sorteos. Lo de cupones no se atiende hasta separarlas.
  if (ruta.clave === "cupones" && cupones === operar) return json({ motivo: "apagado", detalle: "claves-iguales" }, 503);
  const accion = ruta.metodos[request.method];
  if (!accion) return json({ motivo: "metodo" }, 405);

  let datos: unknown = {};
  if (request.method === "GET") datos = { lote: url.searchParams.get("lote") };
  else {
    if (Number(request.headers.get("Content-Length") ?? "0") > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400);
    const texto = await request.text();
    if (texto.length > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400);
    if (texto.trim()) {
      try {
        datos = JSON.parse(texto);
      } catch {
        return json({ motivo: "cuerpo" }, 400);
      }
    }
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return json({ motivo: "cuerpo" }, 400);
  }
  try {
    const res = await llamar(accion, datos);
    return json(res.cuerpo, res.estado);
  } catch {
    // Sin el error: podría llevar algo del pedido (un código). El objeto anota lo suyo.
    return json({ motivo: "interno" }, 500);
  }
}
