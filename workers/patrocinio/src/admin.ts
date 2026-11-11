/**
 * La administración de las altas del portero de mainnet, con dos claves:
 *
 *   Con `CUPONES_TOKEN` (cupones y altas a mano; vive en la laptop para `scripts/cupones.mjs`):
 *     POST /v1/admin/cupones          {lote, codigos:[hasta 500], sorteos, dias, vence, usos}   200 {creados, repetidos}   400 techo
 *     GET  /v1/admin/cupones?lote=    200 {lote, creados, canjeados, cuentas, sorteosUsados, vence, anulado, anulados}
 *     POST /v1/admin/cupones/anular   {lote} | {codigo}                                         200 {anulados}
 *     POST /v1/admin/altas            {cuenta, sorteos, dias, ref}                              200 {ok, repetido, altaNueva, sorteos}
 *   Con `ADMIN_TOKEN` (operar, como las rutas de siempre):
 *     POST /v1/admin/altas/pausar | reanudar                                                    200 {pausadas}
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

export type AccionAdmin = "cupones-crear" | "cupones-estado" | "cupones-anular" | "altas-admitir" | "altas-pausar" | "altas-reanudar";

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

  /** Para `/v1/patrocinio/estado`: altas de las últimas 24 horas y cupones canjeados y creados hoy (UTC). Sin cuentas. */
  resumen(): Record<string, number> {
    return this.prendida() ? this.d.altas.resumen(this.reloj()) : {};
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
