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
 * La compra con QR, también con la sesión: POST /v1/compra/empezar | cargar | anular (`compras.ts`).
 * Abierta como el cupo, sin sesión: GET /v1/carga/cupo {abierta}, si el sitio ofrece la carga con QR (`CARGAS=1`).
 *
 * Solo en mainnet con ALTAS=1 y SORTEO_SERVIDOR=1, abierta desde el sitio, ver `sorteadora.ts`:
 *   POST /v1/sorteo {"sorteo","firma"}   el `draw` de un sello del portero, mandado desde la cuenta sorteadora
 *
 * Solo en mainnet con ALTAS=1 y PAGOS_PREMIO=1 o RETIROS=1, abierta desde el sitio y sin sesión, ver `pagos-ruta.ts`:
 *   POST /v1/patrocinio/pago {"forma":"premio"|"retiro","xdr"}   la comisión de un pago de premio o de un retiro con su costo
 *        200 {hash, forma, vence, status, estado}   Sus errores traen `pudoSalir`. Lo que paga y lo que mira: `pagos-servicio.ts`.
 *   Con alguna de las dos prendida, `GET /v1/patrocinio/cupo` suma el bloque `pagos` y `/estado` el suyo.
 *
 * Solo en mainnet con ALTAS=1 y ALTAS_PREMIO=1, con la sesión de Google de quien organiza, ver `altas-premio.ts` y `rutas-altas.ts`:
 *   POST /v1/alta/premio {"sorteo","puesto","cuenta"}   quien organiza deja entrar a la cuenta de quien ganó un puesto de su sorteo
 *        200 {estado:"admitida"|"ya-tiene-acceso"|"no-hace-falta"}   Sin cupón ni sorteos: la cuenta solo puede activarse y recibir.
 *   Con esa prendida, aunque no lo esté ninguna de las otras dos, `/cupo` y `/estado` también traen el bloque `pagos`.
 *
 * Solo en mainnet con ALTAS=1 y el secreto SALA_SECRETO, lo llama la sala de las campañas (cabecera x-sala-secreto), ver `acceso-organizadora.ts`:
 *   POST /v1/alta/organizadora {"cuenta","evento"}   admite a quien organiza una campaña con su comisión pagada, con sus sorteos de la campaña
 *        200 {ok:true, ya}   Sin el secreto cargado contesta 503 apagada. Idempotente por evento.
 *
 * Con la clave de administración (Authorization: Bearer <ADMIN_TOKEN>):
 *   POST /v1/patrocinio/apagar | encender | pollar     PUT /v1/patrocinio/ajustes {"clave","valor"}
 *   GET  /v1/patrocinio/estado                         GET /v1/patrocinio/exportar
 *
 * Solo en mainnet con ALTAS=1, con dos claves, ver `admin.ts`: cupones y altas a mano con CUPONES_TOKEN,
 * y pausar o reanudar las altas con ADMIN_TOKEN:
 *   POST|GET /v1/admin/cupones   POST /v1/admin/cupones/anular   POST /v1/admin/altas   POST /v1/admin/altas/pausar | reanudar
 *   POST /v1/admin/derechos   POST /v1/admin/ordenes/pagada   GET /v1/admin/sueltos   POST /v1/admin/sueltos/asignar
 *   POST /v1/admin/ventas/pausar | reanudar   POST /v1/admin/compras/cerrar (con ADMIN_TOKEN)
 *   POST /v1/admin/pagos/pausar | reanudar {"forma"}   POST /v1/admin/pagos/tope   (con ADMIN_TOKEN, también con los pagos apagados)
 *
 * Solo en mainnet con ALTAS=1 y CORREO_BIENVENIDA=1 (nace en 0): el correo de bienvenida, unos 20 minutos después del regalo,
 * desde la alarma y después de los sellos y los pagos (`correo-envios.ts`). La dirección se lee de la ficha y no se guarda.
 *
 * Solo en mainnet con la venta por unidad (`sorteo` en `PRECIOS`): la alarma lee sola los pagos mientras haya órdenes vivas
 * (`VigilanteDeCobros`), con su propio try/catch, y `/estado` suma el bloque `cobros`.
 *
 * No guarda nombres ni listas ni direcciones IP: ver `cupos.ts` y README.md.
 * Comprobar un sorteo no depende de este servicio.
 */
import { DurableObject } from "cloudflare:workers";
import { type PedidoDeOrganizadora, atenderOrganizadora } from "./acceso-organizadora";
import { type AccionAdmin, Administracion, atenderAdmin } from "./admin";
import { Altas } from "./altas";
import { AltasPorPremio } from "./altas-premio";
import { registrador } from "./registrador";
import { Cobros, type Conversion, LectorDeCobros, VIGILAR_DESPUES_MS, VigilanteDeCobros } from "./cobros";
import { ComprasQr } from "./compras";
import { AJUSTE_CORREO_CERRADO, AJUSTE_CORREO_DIA, type Config, type Env, leerConfig, unidadDe } from "./config";
import { esEnlaceDeCorreo, mensajeroDeCloudflare } from "./correo-bienvenida";
import { EnviosDeBienvenida } from "./correo-envios";
import { Cupos, type Sql } from "./cupos";
import { cors, json, origenPermitido } from "./http";
import type { FormaDePago } from "./pagos-lista";
import { atenderPagoClasico } from "./pagos-ruta";
import { type PorteroDePagos, armarPorteroDePagos, pagosPrendidos, vueltaDeAlarma } from "./pagos-servicio";
import { UsoDePagos } from "./pagos-uso";
import { Planes } from "./plan";
import { type Pollar, pollarDe } from "./pollar";
import { PorIp, cupoPorHora } from "./por-ip";
import { RpcRed } from "./red";
import { type AccionAlta, type AccionCompra, type AccionPago, type PedidoAlta, PuertaAltas, atenderAlta, atenderCarga, memoriaEnAjustes } from "./rutas-altas";
import { type Firmante, Portero, type Respuesta, firmanteDe } from "./servicio";
import { haciaHorizon } from "./servidores";
import { atenderLineaBase, RUTA_LINEA_BASE } from "./linea-base";
import { Sorteadora, atenderSorteo, leerSorteo } from "./sorteadora";

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
  /** El enlace de envío de correo de Cloudflare (`[[env.mainnet.send_email]]`), para el correo de bienvenida. */
  CORREO?: unknown;
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
  /** Lo que guardan los pagos de premios y los retiros: solo en mainnet. Sus tablas se crean aparte, con su propio try/catch. */
  private usoPagos: UsoDePagos | null = null;
  /** El portero de los pagos clásicos: solo en mainnet. Null si no se pudo armar: la ruta contesta `503 apagado` y los sellos siguen. */
  private pagos: PorteroDePagos | null = null;
  /** Las órdenes y los pagos que llegan a la cuenta de cobros: de acá sale cuántos costos de retiro se cobraron, para `/estado`. */
  private cobros: Cobros | null = null;
  /** Lo que guarda el alta de quien ganó: solo mainnet. Su tabla se crea aparte, con su propio try/catch. */
  private altasPremio: AltasPorPremio | null = null;
  /** Si alguna forma de pago está prendida en la configuración: con todo apagado, el exporte no suma las tablas vacías de los pagos. */
  private pagosEnConfig = false;
  /**
   * El correo de bienvenida: solo en mainnet, con `CORREO_BIENVENIDA=1`, el remitente, el enlace de envío y la llave de Pollar.
   * Null con el correo apagado: entonces ni la alarma, ni `/gratis`, ni `/estado` hacen nada distinto.
   */
  private correo: EnviosDeBienvenida | null = null;
  /** Si la variable del correo está prendida (aunque falte algo): `/estado` muestra su bloque solo así. */
  private correoEnConfig = false;
  /** Lo que falta para el correo prendido por la variable, con nombres fijos. */
  private faltaCorreo: string[] = [];
  /** Quien lee los pagos de la cuenta de cobros (solo mainnet, con `CUENTA_COBROS`). */
  private lector: LectorDeCobros | null = null;
  /**
   * La alarma de cobros: solo con la venta por unidad en `PRECIOS`. Null sin ella: entonces ni la alarma, ni `/orden`, ni
   * `/estado` hacen nada distinto.
   */
  private vigilante: VigilanteDeCobros | null = null;

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
      // Los pagos de premios y los retiros: sus tablas y su portero, cada uno con su try/catch (lo nuevo no tumba a los sellos).
      this.armarPagos(cfg, red, this.portero);
      // La tabla del alta de quien ganó, igual: apagada o no, se crea sin poder tumbar nada.
      this.armarAltaPremio();
      // Los pagos: las órdenes nuevas solo con ALTAS_PAGO=1, pero los pagos de las que ya existen se leen igual. Con las tablas de
      // los retiros, el costo que paga quien retira se reconoce por su transacción y no cae a los pagos sueltos.
      // Con la venta por unidad en `PRECIOS`, lo que llega de más o dos veces a una de sus órdenes se convierte en sorteos con los
      // frenos de la puerta, y cada lectura refresca antes el saldo que miran. Sin el producto, la lectura de siempre.
      const unidad = unidadDe(cfg);
      const conversion: Conversion | null = unidad
        ? { precio: () => unidad, permite: (c, ahora) => this.puerta?.permiteConvertir(c, ahora) ?? false }
        : null;
      // Con la venta por unidad, además, la lectura nueva: los pagos chicos sin orden no escriben fila, se pone al día con muchas
      // páginas y la alarma lee sola mientras haya órdenes vivas (`VigilanteDeCobros`).
      const vigilante = unidad !== null;
      const opcionesCobros = {
        ...(this.usoPagos ? { costos: this.usoPagos } : {}),
        ...(conversion ? { conversion } : {}),
        ...(vigilante ? { vigilante } : {}),
      };
      const cobros = new Cobros(this.sql, this.cupos, opcionesCobros);
      this.cobros = cobros;
      const antes = unidad && pollar ? { antes: () => pollar.creditos() } : {};
      const alDia = vigilante ? { alDia: true } : {};
      const cuentaCobros = cfg.cuentaCobros;
      const lector = cuentaCobros
        ? new LectorDeCobros({ cobros, cuenta: cuentaCobros, fetch: (u, i) => fetch(u, i), registrar, ...antes, ...alDia })
        : null;
      this.lector = lector;
      this.vigilante = vigilante && lector ? new VigilanteDeCobros({ cobros, lector }) : null;
      // La compra con QR: las compras en curso y sus reservas se leen siempre (también con COMPRAS_QR en "0"), para
      // terminar lo que ya empezó y para el piso.
      const compras = new ComprasQr(this.sql, cfg);
      // Sin la hora del último aviso (no se pudo sumar al arrancar), la vigilancia de firmas cuenta sin ella.
      if (this.cupos.faltaColumna("compras_qr", "avisada")) compras.sinHoraDeAviso();
      // Cómo lee la puerta un sorteo de la red, para el alta de quien ganó: solo existe con el contrato oficial de la red.
      const contrato = cfg.contractId;
      const leerElSorteo = contrato
        ? (origen: string, id: bigint) => leerSorteo(red, { passphrase: cfg.passphrase, contractId: contrato, origen }, id)
        : null;
      // El correo de bienvenida, con su try/catch: apagado (o sin lo que necesita) es null y la puerta no recibe el aviso.
      this.correo = this.armarCorreo(cfg, pollar, altas);
      this.puerta = new PuertaAltas({
        cfg,
        cupos: this.cupos,
        altas,
        pollar,
        cuponSecreto: this.env.CUPON_SECRETO ?? null,
        red,
        registrar,
        cobros,
        lector,
        compras,
        pagos: this.usoPagos,
        altasPremio: this.altasPremio,
        cuentaPatrocinadora: this.env.CUENTA_PATROCINADORA || null,
        ...(leerElSorteo ? { leerSorteo: leerElSorteo } : {}),
        ...(this.correo ? { alRegalar: () => void this.programarCorreo("regalo") } : {}),
        // Con la alarma de cobros, crear una orden la pide: el pago se acredita aunque la persona cierre la pantalla.
        ...(this.vigilante ? { alCrearOrden: () => void this.programar() } : {}),
      });
      this.administracion = new Administracion({ cfg, cupos: this.cupos, altas, cuponSecreto: this.env.CUPON_SECRETO ?? null, red, registrar, cobros, lector, compras });
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
    // Una columna nueva que no se pudo sumar al arrancar: el objeto sigue (sellos, sorteos y cupones) y la venta queda cerrada.
    const columnas = this.cupos.columnasQueFaltan();
    if (columnas.length) console.error(JSON.stringify({ evento: "error-config", faltaAltas: ["columnas-nuevas"], columnas, error: this.cupos.errorDeColumnas() }));
    // Un objeto que arranca con cosas en el aire (se reinició o se desplegó entre reservar y mandar) vuelve a armar su alarma.
    if (this.cupos.enElAire() > 0 || this.pagosEnElAire() > 0 || this.cobrosVivos()) await this.programar();
    return this.portero;
  }

  /** Si la alarma de cobros tiene órdenes vivas que mirar. Sin la venta por unidad, nunca. Nunca lanza. */
  private cobrosVivos(): boolean {
    try {
      return this.vigilante?.hayQueVigilar() ?? false;
    } catch {
      return false;
    }
  }

  /**
   * La parte de cobros de la alarma, con su propio try/catch: cuándo vuelve a hacer falta (ms), o null sin órdenes vivas o con
   * la venta por unidad apagada. Si falla, se anota y se vuelve a mirar en 5 minutos: nunca pide la alarma a cada rato.
   */
  private async vueltaDeCobros(): Promise<number | null> {
    const vigilante = this.vigilante;
    if (!vigilante) return null;
    try {
      return await vigilante.vuelta();
    } catch (e) {
      registrar("error-interno", { donde: "alarma-cobros", error: e instanceof Error ? e.name : "desconocido" });
      return Date.now() + VIGILAR_DESPUES_MS;
    }
  }

  /**
   * El bloque `cobros` de `/estado`, con la venta por unidad: órdenes vivas, los sorteos que reservan en el piso, pagos chicos de
   * hoy y el atraso. Solo cifras.
   */
  private estadoDeCobros(): Record<string, unknown> | null {
    try {
      const ahora = Date.now();
      const cobros = this.cobros;
      if (!this.vigilante || !cobros) return null;
      return {
        ordenesVivas: cobros.ordenesVivas(ahora),
        sorteosEnOrdenes: cobros.sorteosEnOrdenesVivas(ahora),
        pagosChicosHoy: cobros.pagosChicosHoy(ahora),
        ...(this.lector?.atraso() ?? {}),
      };
    } catch (e) {
      registrar("error-interno", { donde: "estado-cobros", error: e instanceof Error ? e.name : "desconocido" });
      return null;
    }
  }

  /**
   * Las tablas y el portero de los pagos de premios y de los retiros (solo mainnet). Cada cosa se arma adentro de su try/catch: un
   * `CREATE` o una dependencia que lanzaran acá tumbarían el objeto entero, y con él todos los sellos. Si algo falla, lo de los pagos
   * queda apagado (la ruta contesta `503 apagado`), se anota y el portero de los sellos sigue como siempre.
   */
  private armarPagos(cfg: Config, red: RpcRed, portero: Portero): void {
    this.usoPagos = null;
    this.pagos = null;
    this.pagosEnConfig = pagosPrendidos(cfg);
    try {
      this.usoPagos = new UsoDePagos(this.sql, registrar);
    } catch {
      console.error(JSON.stringify({ evento: "error-config", faltaAltas: ["pagos"] }));
      return;
    }
    const uso = this.usoPagos;
    this.pagos = armarPorteroDePagos(
      () => ({
        cfg,
        uso,
        cupos: this.cupos,
        red,
        redesSueltas: cfg.rpcUrls.map((url) => new RpcRed([url])),
        pedirHorizon: haciaHorizon((u, i) => fetch(u, i)),
        firmante: this.firmante,
        cuentaPatrocinadora: this.env.CUENTA_PATROCINADORA || null,
        modo: () => portero.modo(),
        alQuedarEnElAire: () => void this.programar(),
        registrar,
      }),
      registrar,
    );
  }

  /**
   * La tabla del alta de quien ganó (solo mainnet), con su propio try/catch: como las de los pagos, un `CREATE` que lanzara acá
   * tumbaría el objeto entero y con él todos los sellos. Si algo falla, esa ruta queda apagada (`503 apagado`) y se anota.
   */
  private armarAltaPremio(): void {
    this.altasPremio = null;
    try {
      this.altasPremio = new AltasPorPremio(this.sql, this.cupos);
    } catch {
      console.error(JSON.stringify({ evento: "error-config", faltaAltas: ["alta-premio"] }));
    }
  }

  /** Cuántos pagos de premios y retiros siguen en el aire. Nunca lanza: unas tablas rotas no pueden tumbar el arranque. */
  private pagosEnElAire(): number {
    try {
      return this.usoPagos?.disponible() ? this.usoPagos.enElAire() : 0;
    } catch {
      return 0;
    }
  }

  /**
   * El correo de bienvenida (solo mainnet): null con la variable apagada, sin remitente, sin el enlace de envío o sin la llave de
   * Pollar. Lo que falta se anota con nombres fijos. Armarlo nunca tumba al objeto: si algo lanza, el correo queda apagado.
   */
  private armarCorreo(cfg: Config, pollar: Pollar | null, altas: Altas): EnviosDeBienvenida | null {
    this.correoEnConfig = cfg.correoBienvenida;
    this.faltaCorreo = [];
    if (!cfg.correoBienvenida || !cfg.correoDe) return null;
    const enlace = this.env.CORREO;
    this.faltaCorreo = [...(esEnlaceDeCorreo(enlace) ? [] : ["correo-enlace"]), ...(pollar ? [] : ["pollar-llave"])];
    if (!esEnlaceDeCorreo(enlace) || !pollar) {
      console.error(JSON.stringify({ evento: "error-config", faltaCorreo: this.faltaCorreo }));
      return null;
    }
    try {
      const envios = new EnviosDeBienvenida({
        cupos: this.cupos,
        altas,
        ficha: (usuario) => pollar.fichaParaCorreo(usuario),
        mensajero: mensajeroDeCloudflare(enlace, cfg.correoDe),
        reloj: () => Date.now(),
        registrar,
      });
      envios.arrancar();
      return envios;
    } catch (e) {
      this.faltaCorreo = ["correo"];
      registrar("error-interno", { donde: "armar-correo", error: e instanceof Error ? e.name : "desconocido" });
      return null;
    }
  }

  /**
   * La alarma de lo que quedó en el aire, a 20 segundos. Si ya hay una antes, queda esa. Si la que hay es la del correo de
   * bienvenida (más lejos), se adelanta: el correo nunca demora a los sellos ni a los pagos. Sin el correo, toda alarma puesta
   * está a 20 segundos o menos, así que esto es lo de siempre.
   */
  private async programar(): Promise<void> {
    const actual = await this.ctx.storage.getAlarm();
    const pronto = Date.now() + ALARMA_MS;
    if (actual === null || actual > pronto) await this.ctx.storage.setAlarm(pronto);
  }

  /**
   * La alarma del correo de bienvenida: al darse un regalo, para cuando toca su correo (20 minutos), y al reabrir el correo o
   * subir su tope, enseguida. Nunca atrasa una alarma que ya está antes. Nunca lanza: lo que falla queda anotado.
   */
  private async programarCorreo(motivo: "regalo" | "ajuste"): Promise<void> {
    try {
      const correo = this.correo;
      if (!correo || correo.cerrado()) return;
      const ahora = Date.now();
      const cuando = motivo === "regalo" ? correo.cuandoToca(ahora) : ahora + ALARMA_MS;
      const actual = await this.ctx.storage.getAlarm();
      if (actual === null || actual > cuando) await this.ctx.storage.setAlarm(cuando);
    } catch (e) {
      registrar("error-interno", { donde: "programar-correo", error: e instanceof Error ? e.name : "desconocido" });
    }
  }

  /**
   * La parte del correo de bienvenida, después de las otras dos y con su propio try/catch: cuándo vuelve a hacer falta (ms), o
   * null. Con el correo apagado no hace nada. Una falla nunca vuelve a pedir la alarma a cada rato.
   */
  private async vueltaDelCorreo(conAlgoEnElAire: boolean): Promise<number | null> {
    const correo = this.correo;
    if (!correo) return null;
    try {
      return await correo.vuelta({ conAlgoEnElAire });
    } catch (e) {
      registrar("error-interno", { donde: "alarma-correo", error: e instanceof Error ? e.name : "desconocido" });
      return Date.now() + 10 * 60_000;
    }
  }

  /**
   * La alarma cierra lo que quedó en el aire, en dos partes, cada una en su try/catch: los sellos y los sorteos, y los pagos de
   * premios y retiros. Si una lanza, la otra corre igual, queda anotado y se vuelve a pedir la alarma: lo que sigue en el aire
   * no se queda sin nadie que lo mire. Con la venta por unidad, la parte de cobros, que lee los pagos mientras haya órdenes
   * vivas. Con el correo de bienvenida prendido, una parte más al final, cuando las otras ya cerraron lo suyo. Cada una con su
   * try/catch: ninguna frena a las otras. La alarma vuelve cuando haga falta la primera de las cosas.
   */
  override async alarm(): Promise<void> {
    const p = await this.obtener();
    const pagos = this.pagos;
    const hayQueVolver = await vueltaDeAlarma(
      [
        { donde: "alarma-sellos", correr: () => p.reconciliar() },
        { donde: "alarma-pagos", correr: () => (pagos ? pagos.reconciliar() : Promise.resolve(false)) },
      ],
      registrar,
    );
    const cobros = await this.vueltaDeCobros();
    if (!this.correo && cobros === null) {
      // Sin el correo y sin órdenes que mirar, lo de siempre.
      if (hayQueVolver) await this.ctx.storage.setAlarm(Date.now() + ALARMA_MS);
      return;
    }
    const correo = this.correo ? await this.vueltaDelCorreo(hayQueVolver) : null;
    const ahora = Date.now();
    const vueltas = [
      ...(hayQueVolver ? [ahora + ALARMA_MS] : []),
      ...(correo === null ? [] : [Math.max(correo, ahora + 1_000)]),
      ...(cobros === null ? [] : [Math.max(cobros, ahora + 1_000)]),
    ];
    if (!vueltas.length) return;
    // Mientras el correo esperaba, un sello o un pago pudo pedir la alarma: si quedó antes, se respeta. Una que ya pasó es esta.
    const actual = await this.ctx.storage.getAlarm();
    const objetivo = Math.min(...vueltas);
    if (actual === null || actual <= ahora || actual > objetivo) await this.ctx.storage.setAlarm(objetivo);
  }

  async pagar(xdr: string): Promise<Respuesta> {
    return (await this.obtener()).procesar(xdr);
  }

  /**
   * `GET /v1/patrocinio/cupo`: lo de siempre y, con alguna forma de pago prendida, el bloque `pagos`. Ese bloque nunca hace fallar
   * al cupo: si no se puede armar, el cupo sale como antes (y el sitio lo toma como un portero sin pagos).
   */
  async cupo(cuenta: string): Promise<Respuesta> {
    const r = await (await this.obtener()).cupoDe(cuenta);
    if (r.estado !== 200 || !this.pagos) return r;
    try {
      const pagos = this.pagos.cupoDe(cuenta);
      // El alta de quien ganó la conoce la puerta de las altas: dice si la atendería ahora (variable, pausa, configuración y tabla).
      const altaPremio = this.puerta?.altaPremioAtiende() ?? false;
      return pagos ? { ...r, cuerpo: { ...r.cuerpo, pagos: { ...pagos, altaPremio } } } : r;
    } catch (e) {
      registrar("error-interno", { donde: "cupo-pagos", error: e instanceof Error ? e.name : "desconocido" });
      return r;
    }
  }

  /**
   * `POST /v1/patrocinio/pago` (solo mainnet): la comisión de la red de un pago de premio o de un retiro. Cualquier error que se
   * escape sale como 500 `interno`, con `pudoSalir` según el hash del sobre: verdadero solo si ese pago sigue reservado o enviado.
   */
  async pagoClasico(forma: FormaDePago, xdr: string): Promise<Respuesta> {
    try {
      await this.obtener();
      if (!this.pagos) return { estado: 503, cuerpo: { motivo: "apagado", forma, detalle: "config", pudoSalir: false } };
      return await this.pagos.procesar(forma, xdr);
    } catch (e) {
      registrar("error-interno", { donde: "pago-clasico", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno", pudoSalir: this.pagos?.pudoSalir(xdr) ?? false } };
    }
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

  /** `POST /v1/alta/organizadora` (solo mainnet): el acceso de quien organiza con su comisión pagada. El secreto ya lo miró el Worker. */
  async organizadora(pedido: PedidoDeOrganizadora): Promise<Respuesta> {
    await this.obtener();
    if (!this.puerta) return { estado: 503, cuerpo: { motivo: "apagada" } };
    try {
      return await this.puerta.organizadora(pedido);
    } catch (e) {
      registrar("error-interno", { donde: "organizadora", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno" } };
    }
  }

  /** Las rutas de la compra con QR, `/v1/compra/empezar` y `/v1/compra/cargar` (solo mainnet). */
  async compra(accion: AccionCompra, pedido: PedidoAlta): Promise<Respuesta> {
    await this.obtener();
    if (!this.puerta) return { estado: 503, cuerpo: { motivo: "apagado" } };
    try {
      return await this.puerta.atenderCompra(accion, pedido);
    } catch (e) {
      registrar("error-interno", { donde: "compra", error: e instanceof Error ? e.name : "desconocido" });
      return { estado: 500, cuerpo: { motivo: "interno" } };
    }
  }

  /** `GET /v1/carga/cupo` (solo mainnet): si la carga con QR está abierta. Ante cualquier error, cerrada. */
  async carga(): Promise<boolean> {
    try {
      await this.obtener();
      return this.puerta ? await this.puerta.cargaAbierta() : false;
    } catch (e) {
      registrar("error-interno", { donde: "carga", error: e instanceof Error ? e.name : "desconocido" });
      return false;
    }
  }

  /** Lo que dice `GET /v1/alta/precios` del regalo de bienvenida: sus sorteos si está abierto, 0 si no o si algo falla. */
  async bienvenida(): Promise<number> {
    try {
      await this.obtener();
      return this.puerta ? this.puerta.bienvenidaPublica() : 0;
    } catch (e) {
      registrar("error-interno", { donde: "bienvenida", error: e instanceof Error ? e.name : "desconocido" });
      return 0;
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

  /** El bloque `pagos` de `/estado`, o null si no hay nada que mostrar. Nunca hace fallar al estado. */
  private estadoDePagos(): Record<string, unknown> | null {
    try {
      const sinCostos = { cuantos: 0, monto: 0 };
      const bloque = this.pagos?.resumenDeEstado(Date.now(), (desde) => this.cobros?.costosDeRetiro(desde) ?? sinCostos) ?? null;
      if (!bloque) return null;
      // El alta de quien ganó la conoce la puerta de las altas: si está prendida y cuántas se dieron en el día. La pausa ya viene.
      const altaPremio = { ...(bloque.altaPremio as Record<string, unknown>), ...(this.puerta?.altaPremioDelEstado() ?? {}) };
      return { ...bloque, altaPremio };
    } catch (e) {
      registrar("error-interno", { donde: "estado-pagos", error: e instanceof Error ? e.name : "desconocido" });
      return null;
    }
  }

  /**
   * Las tablas de los pagos de premios y retiros, para el exporte: con alguna forma prendida o con algo guardado. Con todo apagado
   * y sin nada guardado el exporte es el de siempre. Vacío si las tablas no están: unas tablas rotas no tumban el exporte.
   */
  private tablasDePagos(): Record<string, Array<Record<string, unknown>>> {
    try {
      const uso = this.usoPagos;
      if (!this.exportaAltas || !uso?.disponible()) return {};
      const tablas = uso.exportar();
      const hayDatos = tablas.pagos_portero.length > 0 || tablas.retiros_cobrados.length > 0;
      return this.pagosEnConfig || hayDatos ? tablas : {};
    } catch (e) {
      registrar("error-interno", { donde: "exportar-pagos", error: e instanceof Error ? e.name : "desconocido" });
      return {};
    }
  }

  /**
   * La tabla del alta de quien ganó, para el exporte: con la forma prendida o con algo guardado. Con todo apagado y sin nada
   * guardado el exporte es el de siempre. Vacío si la tabla no está: una tabla rota no tumba el exporte.
   */
  private tablaDeAltaPremio(): Record<string, Array<Record<string, unknown>>> {
    try {
      const altas = this.altasPremio;
      if (!this.exportaAltas || !altas?.disponible()) return {};
      const tabla = altas.exportar();
      const prendida = this.puerta?.altaPremioDelEstado().prendido ?? false;
      return prendida || tabla.altas_premio.length > 0 ? tabla : {};
    } catch (e) {
      registrar("error-interno", { donde: "exportar-alta-premio", error: e instanceof Error ? e.name : "desconocido" });
      return {};
    }
  }

  /** El bloque del correo de bienvenida en `/estado`: lo de `EnviosDeBienvenida.resumen` o, si no se pudo armar, qué falta. Solo cifras. */
  private estadoDelCorreo(): Record<string, unknown> {
    try {
      return this.correo ? this.correo.resumen() : { prendido: false, falta: this.faltaCorreo };
    } catch (e) {
      registrar("error-interno", { donde: "estado-correo", error: e instanceof Error ? e.name : "desconocido" });
      return { prendido: false, falta: ["correo"] };
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
      case "ajustes": {
        const clave = String(datos?.clave);
        if (!p.ajustar(clave, Number(datos?.valor))) return { estado: 400, cuerpo: { motivo: "ajuste" } };
        // Reabrir el correo o moverle el tope: lo que esperaba sale en la vuelta siguiente, sin esperar otro regalo.
        if (clave === AJUSTE_CORREO_CERRADO || clave === AJUSTE_CORREO_DIA) await this.programarCorreo("ajuste");
        return { estado: 200, cuerpo: { ok: true } };
      }
      case "estado": {
        // En mainnet con las altas, también el saldo de créditos de Pollar y el piso.
        // Y las altas de 24 horas y los cupones de hoy, y la vigilancia de firmas: firmasSinExplicar y patrocinioPollar.
        // Y, con los pagos de premios y retiros prendidos, con algún pago en el día o con alguna pausa puesta, el bloque `pagos`.
        const e = await p.estado();
        if (!this.puerta) return e;
        const pagos = this.estadoDePagos();
        const cobros = this.estadoDeCobros();
        return {
          ...e,
          cuerpo: {
            ...e.cuerpo,
            ...(await this.puerta.resumen()),
            ...(this.administracion?.resumen() ?? {}),
            ...(await this.puerta.vigilancia()),
            ...(pagos ? { pagos } : {}),
            // El correo de bienvenida, solo con su variable prendida: apagado, el estado es el de siempre.
            ...(this.correoEnConfig ? { correoBienvenida: this.estadoDelCorreo() } : {}),
            // La lectura de los pagos, solo con la venta por unidad: apagada, el estado es el de siempre.
            ...(cobros ? { cobros } : {}),
          },
        };
      }
      case "exportar": {
        // En mainnet, también las tablas de las altas, las de los pagos de premios y retiros y la del alta de quien ganó.
        const tablas = { ...this.cupos.exportar(this.exportaAltas), ...this.tablasDePagos(), ...this.tablaDeAltaPremio() };
        return { estado: 200, cuerpo: { exportado: Date.now(), tablas } };
      }
      default:
        return { estado: 404, cuerpo: { motivo: "accion" } };
    }
  }
}

// ---------- el Worker de la puerta ----------

/** Dos contadores aparte: consultar el cupo no le gasta pedidos al POST. Ver `por-ip.ts`. */
const cupoPorIp = new PorIp();
const pagoPorIp = new PorIp();
/** Los pedidos a `/v1/alta/*`, con su propio contador. */
const altaPorIp = new PorIp();
/** Los pedidos a `/v1/sorteo`, con el suyo. */
const sorteoPorIp = new PorIp();
/** Los pedidos a `/v1/patrocinio/pago`, con el suyo: agotar los de los sellos no frena los pagos, ni al revés. */
const pagoClasicoPorIp = new PorIp();
/** Las consultas de `/v1/carga/cupo`, con el suyo: consultar la carga no le gasta consultas al cupo. */
const cargaPorIp = new PorIp();

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

    // El acceso de quien organiza una campaña, también solo en mainnet y con el secreto de la sala: va antes del resto de `/v1/alta/`
    // porque no es una ruta del navegador (sin origen, sin sesión de Pollar), y si no atiende, sigue de largo al 404 de siempre.
    if (url.pathname === "/v1/alta/organizadora" && env.RED === "mainnet") {
      const r = await atenderOrganizadora(request, leerConfig(env), env.SALA_SECRETO, (pedido) => objeto.organizadora(pedido));
      if (r) return r;
    }

    // Las rutas de altas y de la compra con QR existen solo en mainnet; en testnet siguen sin existir, como siempre.
    if ((url.pathname.startsWith("/v1/alta/") || url.pathname.startsWith("/v1/compra/")) && env.RED === "mainnet") {
      const r = await atenderAlta(
        request,
        leerConfig(env),
        (accion, pedido) => objeto.alta(accion, pedido),
        altaPorIp,
        (accion, pedido) => objeto.pagoAlta(accion, pedido),
        (accion, pedido) => objeto.compra(accion, pedido),
        () => objeto.bienvenida(),
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

    // El tope de la carga con QR, también solo en mainnet: abierta y de solo lectura, como el cupo.
    if (url.pathname === "/v1/carga/cupo" && env.RED === "mainnet") {
      const r = await atenderCarga(request, leerConfig(env), cargaPorIp, () => objeto.carga());
      if (r) return r;
    }

    // Los pagos de premios y retiros, también solo en mainnet y con alguna forma prendida: si no, la ruta no existe y el pedido
    // sigue de largo hasta el 404 del final, como siempre.
    if (url.pathname === "/v1/patrocinio/pago" && env.RED === "mainnet") {
      const r = await atenderPagoClasico(request, leerConfig(env), pagoClasicoPorIp, (forma, xdr) => objeto.pagoClasico(forma, xdr));
      if (r) return r;
    }

    // La línea base de la red (issue #220): lectura sin llaves, la misma base que el detector de GitHub.
    if (url.pathname === RUTA_LINEA_BASE && request.method === "GET") return atenderLineaBase(request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origen, url.pathname.endsWith("/cupo")) });

    // La consulta del cupo: abierta, solo lectura.
    if (url.pathname === "/v1/patrocinio/cupo" && request.method === "GET") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
      if (!cupoPorIp.toca(ip, cupoPorHora(env.RED ?? ""))) return json({ motivo: "cupo-ip" }, 429, cors(origen, true));
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
