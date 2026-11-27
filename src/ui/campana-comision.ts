import { comisionDe, enlaceDePago, notaDeLaComision, totalDePremios, umbralPagado } from "../campana/comision";
import { type EstadoDeComision, type PorteroDeComision, RECHAZOS_QUE_SE_AGUANTAN, estadoDeComision, loQueSale } from "../campana/comision-panel";
import type { BusquedaDeComision, LecturaDeComision } from "../campana/comision-red";
import { horaTexto, montoConCentavos } from "../campana/formato";
import type { Campana } from "../campana/modelo";
import type { Lang } from "../idioma";
import type { ConfigDeComision } from "../stellar/comision-config";
import { USDC_MAINNET } from "../stellar/pagos";
import { rellenar } from "./campana-grande";

/**
 * El cobro de una campaña de empresa dentro del panel de quien organiza: mirar en la red si ya se pagó, decir en qué estado
 * está, pagar con la cuenta de Google (por el camino del retiro) y dejar el pago desde otra billetera como respaldo.
 *
 * Es un controlador sin DOM propio (el plegado del respaldo sí lo arma): el panel le pasa lo que sabe de la campaña y él
 * le devuelve el estado y lo que se muestra. Todo lo de afuera (la red, la cuenta, el servicio de comisiones, el candado
 * entre pestañas) entra por `DepsDeComision`, para probarlo sin red ni reloj. Sin la comisión configurada (`comision()` da
 * `null`) no hace nada y el panel queda como si no existiera.
 */

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Cuánto vive la marca de un pago en el aire: lo que dura el pago (240 s) y el margen de la regla (300 s), más un minuto. */
export const VIDA_DE_LA_MARCA_MS = 360_000;
/**
 * Con un pago en el aire el panel mira solo cada tanto si entró, en lugar de esperar los seis minutos de la marca. Es solo
 * lectura (la misma mirada de Volver a mirar), no toca la marca ni el botón de pagar, y con la pestaña oculta no pregunta.
 */
export const MIRAR_LA_DUDA_CADA_MS = 12_000;
/** La búsqueda no baja más de 30 días antes de abrirse la campaña: la nota sale del evento y un pago viejo de otro no vale. */
const MARGEN_DE_LA_BUSQUEDA_S = 30 * 86_400;

/** Lo que hace falta para mandar el pago con la cuenta de Google. */
export interface PedidoDePagoDeComision {
  origen: string;
  cuenta: string;
  cobros: string;
  costo: bigint;
  /** Lo que sale de la cuenta. */
  sale: bigint;
  nota: string;
  /** El panel pone la marca de un pago en el aire con la secuencia con que se armó y el hash, justo antes de mandar. */
  alMandar: (secuencia: string, hash: string | null) => void;
}

/** Cómo terminó el pago con la cuenta. */
export type ResultadoDelPagoDeComision =
  | { tipo: "listo"; hash: string | null }
  /** Salió pero no se sabe si entró. `hasta` es hasta cuándo vive la marca de la billetera (ms), si la hay. */
  | { tipo: "en-curso"; hasta: number | null }
  /** Una transacción de la cuenta con la nota ya está en la red: no se manda otra. */
  | { tipo: "ya-hay-pago" }
  | { tipo: "no-salio" }
  | { tipo: "recargar" }
  | { tipo: "sin-saldo" }
  /** La red contestó atrasada o no contestó: no se mandó nada. */
  | { tipo: "sin-mirar" }
  | { tipo: "ahora-no" }
  /** Hay otro pago de la billetera en camino. */
  | { tipo: "ocupada" };

export interface DepsDeComision {
  /** Lo que se cobra, o `null` si la comisión está apagada (sin las tres variables, o fuera de la red principal). */
  comision: () => ConfigDeComision | null;
  /** Con qué se entra: una cuenta de Google que vota por contenido, una del mismo proveedor que entró con correo, u otra cosa. */
  billetera: () => Promise<"google" | "correo" | "otra">;
  mirarRed: (b: BusquedaDeComision, umbral: bigint) => Promise<LecturaDeComision>;
  saldo: (cuenta: string) => Promise<bigint | "sin-red">;
  portero: (cuenta: string, costo: bigint) => Promise<PorteroDeComision>;
  pagar: (p: PedidoDePagoDeComision) => Promise<ResultadoDelPagoDeComision>;
  /** El respaldo que no es Horizon para un hash conocido: `true` si entró, `false` si falló, `null` si no se sabe. */
  confirmar: (hash: string) => Promise<boolean | null>;
  /** Con un pago que venció sin verse: ¿se puede ofrecer pagar de nuevo? Solo si la mirada es consistente y no lo muestra. */
  puedeVolverALista: (origen: string, secuencia: string, nota: string) => Promise<boolean>;
  /** Abre la ventana de los dólares para cargar. `alCerrar` avisa cuando se cierra. */
  /** `falta` es lo que hay que mandar, ya escrito (por ejemplo 1,50): la ventana lo dice junto a la dirección. */
  cargar: (cuenta: string, alCerrar: () => void, falta?: string) => void;
  /** Corre `f` con un candado entre pestañas. Sin candados en el navegador, corre `f` solo. */
  candado: <T>(nombre: string, f: () => Promise<T>) => Promise<T>;
  /**
   * La cuenta lista para pagar desde esta compu (`cuenta-lista-flujo.ts`, `cuentaListaParaGrabar("pago")`), antes de armar nada:
   * `lista` si ya lo estaba y se puede pagar en este mismo toque, `paso` si hubo que dejarla lista (se abrió el paso y la persona
   * lo terminó: vuelve a tocar Pagar), `no` si no se pudo o se dejó. Sin esto, no se mira nada y se paga como siempre.
   * `alRevisar` avisa mientras se revisa la cuenta en la red (hasta 4 segundos): el botón queda apagado y lo dice.
   */
  cuentaLista?: (alRevisar?: (revisando: boolean) => void) => Promise<"lista" | "paso" | "no">;
}

/** Lo que el controlador le pide al panel. */
export interface ContextoDeComision {
  campana: () => Campana | null;
  /** La cuenta que la campaña pide para sellar, si pide una. */
  pide: () => string | null;
  /** La cuenta con la que se entró, si se entró. */
  cuenta: () => string | null;
  /** El panel está en la vista previa: solo ahí se cobra. */
  enPrevia: () => boolean;
  /** Crea la sala de la campaña (en fase lista) si no existe. `null` si quedó creada; si no, el texto de por qué no. */
  crearSala: () => Promise<string | null>;
  alCambiar: () => void;
  aviso: (texto: string) => void;
  tx: (clave: string) => string;
  idioma: () => Lang;
  ahora: () => number;
  esperar: (f: () => void, ms: number) => () => void;
  /** ¿Se ve la pestaña? Con la pestaña oculta la mirada sola de la duda no pregunta. Sin esto, siempre se ve. */
  visible?: () => boolean;
  /** Se llama cada vez que termina de mirar la red, para que la pantalla pueda decir que sigue mirando. */
  alMirar?: () => void;
  almacen: Almacen | null;
  /** Hay una forma de cambiar de cuenta o entrar. */
  puedeEntrar: () => boolean;
  /**
   * La campaña es un borrador sin firma: el pago tiene que salir de la cuenta de Google de quien organiza y la sala lo comprueba
   * en la red. Pagar desde otra billetera no sirve, así que no se ofrece el plegado. Sin esto, la campaña viene firmada.
   */
  conBorrador?: () => boolean;
}

/**
 * Lo que la persona ya tiene o ya puso (el saldo, los premios) se dice hacia abajo; lo que tiene que mandar o cargar, hacia
 * arriba: el número que se lee nunca queda por debajo de lo que sale de la cuenta.
 */
const montoTiene = (unidades: bigint, idioma: Lang): string => montoConCentavos(unidades, idioma, "abajo");
const montoSale = (unidades: bigint, idioma: Lang): string => montoConCentavos(unidades, idioma, "arriba");

export type AccionDeComision = "cargar" | "pagar" | "mirar" | "entrar";

/** Lo que se dibuja de un estado. `null` en una parte es lo de siempre. */
export interface DescripcionDeComision {
  titulo: string | null;
  linea: string | null;
  principal: { texto: string; accion: AccionDeComision; apagado: boolean } | null;
  secundario: { texto: string; accion: AccionDeComision } | null;
  /** El plegado de pagar desde otra billetera: `null` si no se muestra, y si se muestra, abierto o cerrado. */
  plegado: "abierto" | "cerrado" | null;
}

interface Marca {
  hasta: number;
  seq: string | null;
  hash: string | null;
}

export interface ControlDeComision {
  /** ¿La comisión está prendida para este sitio? */
  activo: () => boolean;
  estado: () => EstadoDeComision;
  /** Mientras la comisión no esté pagada, no se abre la inscripción. */
  bloqueaElAbrir: () => boolean;
  /** Mira la red, el saldo y el servicio. */
  mirar: () => Promise<void>;
  /** En qué va el pago mientras se manda: armándolo, o ya mandado y esperando que la red lo confirme. */
  etapaDelPago: () => "armando" | "mandado" | null;
  pagar: () => Promise<void>;
  /** Abre la ventana de los dólares. Al cerrarla vuelve a mirar y después avisa con `despues`. */
  cargar: (despues?: () => void) => void;
  descripcion: () => DescripcionDeComision;
  /** Todo lo que cambia lo que se dibuja, para saber si hay que repintar los botones. */
  firma: () => string;
  /** Empieza de nuevo (se eligió otro archivo, o se dejó la campaña). */
  reiniciar: () => void;
  detener: () => void;
  /** Los datos del plegado del respaldo, o `null` si no corresponde mostrarlo. */
  datosDelPlegado: () => { cuenta: string; monto: bigint; nota: string; enlace: string } | null;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** La marca de un pago en el aire y lo ya pagado se guardan por evento, en el almacén de esta compu. */
const claveDeLaMarca = (evento: string): string => `tinkazo.comision.marca.${evento}`;
const claveDeLoPagado = (evento: string): string => `tinkazo.comision.${evento}`;

/** El enlace de pago del plegado: el de `comision.ts`, con el activo de la red principal. */
export const enlaceDePagoDeLaComision = (cuenta: string, monto: bigint, nota: string): string => enlaceDePago(cuenta, monto, nota, USDC_MAINNET);

export function crearControlDeComision(deps: DepsDeComision, ctx: ContextoDeComision): ControlDeComision {
  let red: LecturaDeComision | null = null;
  let billetera: "google" | "correo" | "otra" = "otra";
  let saldo: bigint | "sin-red" | null = null;
  let portero: PorteroDeComision = null;
  let pagadaAca = false;
  let pagando = false;
  /** Mientras se mira la cuenta (o está abierto el paso de dejarla lista), otro toque en Pagar no empieza otro. */
  let revisandoLaCuenta = false;
  /** La parte de esa revisión que espera la red: el botón de pagar se apaga y dice Revisando tu cuenta. */
  let revisandoEnLaRed = false;
  let rechazos = 0;
  let mirada = 0;
  /** Sube al reiniciar o detener: una vuelta de la duda que ya estaba en el aire no vuelve a armar la mirada. */
  let epoca = 0;
  /** La marca cuando el almacén no deja guardar: vive lo que vive la pestaña. */
  let marcaEnMemoria: Marca | null = null;
  let pararEspera: (() => void) | null = null;
  let pararDuda: (() => void) | null = null;
  let etapaDelPago: "armando" | "mandado" | null = null;
  const premiosDe = (c: Campana): bigint => totalDePremios(c.premios);

  /* --- lo guardado --- */

  function leerMarca(evento: string): Marca | null {
    let crudo: unknown = null;
    try {
      const t = ctx.almacen?.getItem(claveDeLaMarca(evento));
      crudo = t ? (JSON.parse(t) as unknown) : null;
    } catch {
      crudo = null;
    }
    if (esObjeto(crudo) && typeof crudo.hasta === "number" && Number.isFinite(crudo.hasta)) {
      return {
        hasta: crudo.hasta,
        // La secuencia es un número: otra cosa (un almacén tocado a mano) cuenta como sin secuencia y no rompe la mirada.
        seq: typeof crudo.seq === "string" && /^\d{1,20}$/.test(crudo.seq) ? crudo.seq : null,
        hash: typeof crudo.hash === "string" ? crudo.hash : null,
      };
    }
    return marcaEnMemoria;
  }

  function ponerMarca(evento: string, m: Marca): void {
    marcaEnMemoria = m;
    try {
      ctx.almacen?.setItem(claveDeLaMarca(evento), JSON.stringify(m));
    } catch {
      /* sin almacenamiento: vive lo que vive la pestaña */
    }
  }

  function borrarMarca(evento: string): void {
    marcaEnMemoria = null;
    try {
      ctx.almacen?.removeItem(claveDeLaMarca(evento));
    } catch {
      /* ya no está */
    }
  }

  /** ¿Esta compu ya vio entrar el pago de este evento, con una comisión igual o mayor a la de ahora? */
  function loPagado(evento: string, umbral: bigint): boolean {
    try {
      const t = ctx.almacen?.getItem(claveDeLoPagado(evento));
      const x: unknown = t ? JSON.parse(t) : null;
      return esObjeto(x) && typeof x.umbral === "string" && /^\d{1,20}$/.test(x.umbral) && BigInt(x.umbral) >= umbral;
    } catch {
      return false;
    }
  }

  function guardarPagado(evento: string, hash: string | null, umbral: bigint): void {
    try {
      ctx.almacen?.setItem(claveDeLoPagado(evento), JSON.stringify({ pagada: hash ?? "", umbral: umbral.toString() }));
    } catch {
      /* sin almacenamiento: la próxima vez se vuelve a mirar la red */
    }
  }

  const marcaViva = (evento: string): Marca | null => {
    const m = leerMarca(evento);
    return m !== null && m.hasta > ctx.ahora() ? m : null;
  };

  /* --- lo que se cobra --- */

  function numeros(cfg: ConfigDeComision, c: Campana): { premios: bigint; comision: bigint; umbral: bigint; nota: string; desde: number } {
    const comision = comisionDe(c.premios, cfg.pb, cfg.minimo);
    return {
      premios: premiosDe(c),
      comision,
      umbral: umbralPagado(comision, cfg.costo),
      nota: notaDeLaComision(c.evento),
      desde: Math.floor(c.abreMs / 1000) - MARGEN_DE_LA_BUSQUEDA_S,
    };
  }

  /**
   * Lo que se cobra por la campaña de ahora. Una campaña con el premio en mano (de personas) no cobra nada: no hay premio en
   * dólares que mover ni a quién pagarle, así que es como si el cobro estuviera apagado, esté como esté el sitio.
   */
  const config = (): ConfigDeComision | null => (ctx.campana()?.premioEnMano !== undefined ? null : deps.comision());
  const activo = (): boolean => config() !== null;

  function estado(): EstadoDeComision {
    const cfg = config();
    const c = ctx.campana();
    if (!cfg || !c) return { tipo: "pagada" };
    const n = numeros(cfg, c);
    const pide = ctx.pide();
    return estadoDeComision({
      red,
      pagadaAca,
      pagando,
      marcaViva: marcaViva(c.evento) !== null,
      billetera,
      soloGoogle: ctx.conBorrador?.() === true,
      cuentaEquivocada: pide !== null && ctx.cuenta() !== pide,
      puedeEntrar: ctx.puedeEntrar(),
      saldo,
      premios: n.premios,
      comision: n.comision,
      umbral: n.umbral,
      costo: cfg.costo,
      portero,
      rechazos,
    });
  }

  /* --- mirar --- */

  /** Al vencer la marca de un pago en el aire se mira sola una vez: pagada, o se vuelve a ofrecer pagar. */
  function programarLaEspera(evento: string): void {
    pararEspera?.();
    pararEspera = null;
    const m = marcaViva(evento);
    programarLaMirada(evento);
    if (!m) return;
    pararEspera = ctx.esperar(() => {
      pararEspera = null;
      void mirar();
    }, Math.max(1_000, m.hasta - ctx.ahora() + 1_000));
  }

  /**
   * Mientras la marca de un pago en el aire siga viva, mira sola cada tanto si ya entró. Mira en silencio: no vuelve a
   * Un momento ni toca nada más que lo que la red dice. Al vencer la marca queda la mirada de siempre, la de `programarLaEspera`.
   */
  function programarLaMirada(evento: string): void {
    pararDuda?.();
    pararDuda = null;
    if (marcaViva(evento) === null) return;
    pararDuda = ctx.esperar(() => {
      pararDuda = null;
      void vueltaDeLaDuda(evento);
    }, MIRAR_LA_DUDA_CADA_MS);
  }

  async function vueltaDeLaDuda(evento: string): Promise<void> {
    const c = ctx.campana();
    if (!c || c.evento !== evento || !ctx.enPrevia() || pagando || marcaViva(evento) === null) return;
    const mi = epoca;
    // Con la pestaña oculta no se pregunta: la próxima vuelta mira si ya se volvió a verla.
    if (ctx.visible?.() !== false) await mirar(true);
    if (mi === epoca && c === ctx.campana() && pararDuda === null) programarLaMirada(evento);
  }

  /** `callado`: la mirada que corre sola en la duda no borra lo que se sabía, así la pantalla no parpadea en Un momento. */
  async function mirar(callado = false): Promise<void> {
    const cfg = config();
    const c = ctx.campana();
    if (!cfg || !c || !ctx.enPrevia() || pagando) return;
    const n = numeros(cfg, c);
    const mia = ++mirada;
    if (loPagado(c.evento, n.umbral)) {
      pagadaAca = true;
      ctx.alCambiar();
      return;
    }
    if (!callado) {
      red = null;
      saldo = null;
      portero = null;
      ctx.alCambiar();
    }
    try {
      await mirarDesdeCero(mia, cfg, c, n);
    } catch {
      // Algo que no se esperaba (un pedazo del sitio que no bajó, una respuesta que rompe): no se queda en Un momento con el
      // botón apagado. Se dice que no se pudo ver, con Volver a mirar, y no se ofrece pagar ni abrir.
      if (mia !== mirada) return;
      // La mirada sola de la duda no cambia nada si falla: la próxima vuelta lo intenta de nuevo.
      if (callado) return;
      red = { tipo: "sin-consulta" };
      ctx.alCambiar();
    }
  }

  async function mirarDesdeCero(mia: number, cfg: ConfigDeComision, c: Campana, n: ReturnType<typeof numeros>): Promise<void> {
    const cuenta = ctx.cuenta();
    const quien = await deps.billetera();
    if (mia !== mirada) return;
    billetera = cuenta === null ? "otra" : quien;
    // La de correo también es una cuenta del proveedor: con un archivo firmado paga con un toque, y con un borrador el estado
    // la frena antes de ofrecer cargar o pagar (`solo-google`).
    const origen = billetera !== "otra" ? cuenta : null;
    const marca = leerMarca(c.evento);
    const [lectura, elSaldo, elPortero] = await Promise.all([
      deps.mirarRed({ cuenta: cfg.cuenta, nota: n.nota, desde: n.desde, origen }, n.umbral),
      origen !== null ? deps.saldo(origen) : Promise.resolve(null),
      origen !== null ? deps.portero(origen, cfg.costo) : Promise.resolve(null),
    ]);
    if (mia !== mirada) return;
    let lo: LecturaDeComision = lectura;
    // Si la red no lo ve pero se conoce el hash del pago que salió, el RPC (que no es Horizon) puede confirmarlo.
    if (lo.tipo !== "pagada" && marca?.hash) {
      const entro = await deps.confirmar(marca.hash);
      if (mia !== mirada) return;
      if (entro === true) lo = { tipo: "pagada", suma: n.umbral };
    }
    if (lo.tipo === "pagada") {
      guardarPagado(c.evento, marca?.hash ?? null, n.umbral);
      borrarMarca(c.evento);
      pagadaAca = true;
    } else if (marca !== null && marca.hasta <= ctx.ahora()) {
      // La marca venció y no se ve el pago: se ofrece pagar de nuevo solo si la mirada es consistente y no lo muestra. Una
      // marca sin secuencia (de un pago que no llegó a armarse) se compara desde cero: decide solo la mirada consistente de la
      // cuenta, y nunca queda trabada para siempre en Sin conexión.
      const puede = origen !== null ? await deps.puedeVolverALista(origen, marca.seq ?? "0", n.nota) : false;
      if (mia !== mirada) return;
      if (puede || origen === null) borrarMarca(c.evento);
      else lo = { tipo: "sin-consulta" };
    }
    red = lo;
    saldo = elSaldo;
    portero = elPortero;
    programarLaEspera(c.evento);
    ctx.alMirar?.();
    ctx.alCambiar();
  }

  /* --- pagar --- */

  async function pagar(): Promise<void> {
    const cfg = config();
    const c = ctx.campana();
    const origen = ctx.cuenta();
    if (!cfg || !c || !origen || estado().tipo !== "lista" || revisandoLaCuenta) return;
    // Antes de cobrar, la cuenta tiene que poder pagar desde esta compu: si falta confirmarla o protegerla, se hace acá y no
    // después, en otra compu donde nadie sabría entrar. No cambia cuándo se paga: solo pone el paso delante.
    if (deps.cuentaLista) {
      revisandoLaCuenta = true;
      const alRevisar = (revisando: boolean): void => {
        if (revisandoEnLaRed === revisando) return;
        revisandoEnLaRed = revisando;
        ctx.alCambiar();
      };
      const cuenta = await deps.cuentaLista(alRevisar).catch((): "lista" => "lista");
      revisandoLaCuenta = false;
      alRevisar(false);
      if (cuenta === "no") return;
      if (cuenta === "paso") {
        // El paso terminó: lo que se sabe de la cuenta cambió y el pago sale con el toque que sigue, no con este. Una línea lo dice.
        await mirar();
        if (ctx.campana() === c && estado().tipo === "lista") ctx.aviso(ctx.tx("cpoCmCuentaLista"));
        return;
      }
    }
    // Lo que se mira de nuevo: durante la revisión de la cuenta la pantalla pudo cambiar.
    const e = estado();
    const origenAhora = ctx.cuenta();
    if (ctx.campana() !== c || origenAhora !== origen || e.tipo !== "lista") return;
    const n = numeros(cfg, c);
    pagando = true;
    etapaDelPago = "armando";
    ctx.aviso("");
    ctx.alCambiar();
    type Salida = ResultadoDelPagoDeComision | { tipo: "duda" } | { tipo: "sala"; texto: string };
    /** Si ya se puso la marca, justo antes de mandar: un error de antes no mandó nada y no deja una duda que no existe. */
    let mandado = false;
    const salida: Salida = await deps
      .candado(`tinkazo-comision-${c.evento}`, async (): Promise<Salida> => {
        // La otra pestaña pudo terminar mientras esta esperaba el candado: se mira lo guardado antes de armar nada.
        if (marcaViva(c.evento) !== null || loPagado(c.evento, n.umbral)) return { tipo: "duda" };
        // Primero la sala: si el archivo no sirve (sin firma, evento tomado, cupo lleno), no se paga nada.
        const falla = await ctx.crearSala();
        if (falla !== null) return { tipo: "sala", texto: falla };
        return deps.pagar({
          origen,
          cuenta: cfg.cuenta,
          cobros: cfg.cobros,
          costo: cfg.costo,
          sale: e.sale,
          nota: n.nota,
          alMandar: (seq, hash) => {
            mandado = true;
            ponerMarca(c.evento, { hasta: ctx.ahora() + VIDA_DE_LA_MARCA_MS, seq, hash });
            programarLaEspera(c.evento);
            // Solo se dice en pantalla que ya salió: no cambia nada de lo que se manda. El dibujo va después de que el envío
            // arranca y un fallo suyo no lo frena: el pago nunca depende de lo que se pinta.
            etapaDelPago = "mandado";
            queueMicrotask(() => {
              try {
                ctx.alCambiar();
              } catch {
                /* la pantalla se corrige en el próximo cambio */
              }
            });
          },
        });
      })
      // Un error después de la marca puede haber mandado el pago: es una duda. Antes de la marca no salió nada.
      .catch((): Salida => (mandado ? { tipo: "en-curso", hasta: null } : { tipo: "no-salio" }));
    pagando = false;
    etapaDelPago = null;
    if (salida.tipo === "duda") return void mirar();
    if (salida.tipo === "sala") {
      ctx.aviso(salida.texto);
      return;
    }
    if (salida.tipo === "listo") {
      guardarPagado(c.evento, salida.hash, n.umbral);
      borrarMarca(c.evento);
      pagadaAca = true;
      ctx.aviso("");
      ctx.alCambiar();
      return;
    }
    if (salida.tipo === "en-curso") {
      // La marca de la billetera puede durar más que la del panel: el panel espera lo que dure la más larga.
      const m = leerMarca(c.evento);
      if (m !== null && salida.hasta !== null && salida.hasta > m.hasta) ponerMarca(c.evento, { ...m, hasta: salida.hasta });
      else if (m === null) ponerMarca(c.evento, { hasta: ctx.ahora() + VIDA_DE_LA_MARCA_MS, seq: null, hash: null });
      programarLaEspera(c.evento);
      ctx.aviso("");
      ctx.alCambiar();
      return;
    }
    borrarMarca(c.evento);
    if (salida.tipo === "ya-hay-pago") {
      await mirar();
      if (!pagadaAca && red?.tipo !== "pagada") red = { tipo: "sin-consulta" };
      ctx.alCambiar();
      return;
    }
    if (salida.tipo === "sin-saldo") return void mirar();
    if (salida.tipo === "sin-mirar") {
      red = { tipo: "sin-consulta" };
      ctx.aviso("");
      ctx.alCambiar();
      return;
    }
    if (salida.tipo === "ahora-no") {
      portero = "no";
      ctx.aviso("");
      ctx.alCambiar();
      return;
    }
    if (salida.tipo === "ocupada") {
      ctx.aviso(ctx.tx("cpoCmOcupada"));
      return;
    }
    // No salió nada: se puede probar de nuevo, y después de dos intentos seguidos solo queda el pago desde otra billetera.
    rechazos++;
    if (rechazos >= RECHAZOS_QUE_SE_AGUANTAN) {
      ctx.aviso("");
      ctx.alCambiar();
      return;
    }
    ctx.aviso(ctx.tx(salida.tipo === "recargar" ? "cpoCmRecargar" : "cpoCmNoSalio"));
  }

  function cargar(despues?: () => void): void {
    const cuenta = ctx.cuenta();
    if (cuenta !== null) {
      // Lo que falta mandar, si ya se sabe: la ventana de la dirección lo dice en su título.
      const e = estado();
      const falta = e.tipo === "falta-cargar" ? montoSale(e.falta, ctx.idioma()) : undefined;
      deps.cargar(
        cuenta,
        () => {
          void mirar().then(() => despues?.());
        },
        falta,
      );
    }
  }

  /* --- lo que se dibuja --- */

  function descripcion(): DescripcionDeComision {
    const cfg = config();
    const c = ctx.campana();
    const vacia: DescripcionDeComision = { titulo: null, linea: null, principal: null, secundario: null, plegado: null };
    if (!cfg || !c || !ctx.enPrevia()) return vacia;
    const e = estado();
    const idioma = ctx.idioma();
    const tx = ctx.tx;
    const fmt = (clave: string, v: Record<string, string | number>): string => rellenar(tx(clave), v);
    const n = numeros(cfg, c);
    // Con un borrador el pago sale de la cuenta de Google y de ninguna otra: no se ofrece pagar a mano desde otra billetera.
    const borrador = ctx.conBorrador?.() === true;
    const mirarBoton = (apagado = false): NonNullable<DescripcionDeComision["principal"]> => ({ texto: tx("cpoCmMirar"), accion: "mirar", apagado });
    switch (e.tipo) {
      case "pagada":
        return vacia;
      case "mirando":
        return { titulo: tx("cpoCargando"), linea: "", principal: { texto: tx("cpoCargando"), accion: "mirar", apagado: true }, secundario: null, plegado: null };
      case "pagando": {
        // Lo que sale es lo mismo que decía el botón de pagar: la comisión entera, o lo que falta si ya llegó una parte.
        const llegado = red !== null && red.tipo !== "sin-consulta" ? red.suma : 0n;
        const sale = loQueSale({ comision: n.comision, umbral: n.umbral, costo: cfg.costo }, llegado) ?? n.comision;
        return {
          titulo: fmt("cpoCmPagandoT", { c: montoSale(sale, idioma) }),
          linea: fmt("cpoCmPagandoL", { premios: montoTiene(n.premios, idioma) }),
          principal: { texto: tx("cpoCmPagando"), accion: "pagar", apagado: true },
          secundario: null,
          plegado: null,
        };
      }
      case "duda": {
        const hasta = marcaViva(c.evento)?.hasta ?? ctx.ahora();
        return {
          titulo: tx("cpoCmDudaT"),
          linea: fmt("cpoCmDudaL", { hora: horaTexto(hasta, c.zona, idioma) }),
          principal: mirarBoton(),
          secundario: null,
          plegado: null,
        };
      }
      case "sin-mirar":
        return { titulo: tx("cpoSinConexionT"), linea: tx("cpoCmSinMirarL"), principal: mirarBoton(), secundario: null, plegado: null };
      case "falta-cargar": {
        // El título dice cuánto cargar y la línea la cuenta: cuánto es del premio y cuánto del servicio.
        const premios = montoTiene(n.premios, idioma);
        const servicio = montoSale(e.sale, idioma);
        const sinSaldo = e.saldo === 0n;
        return {
          titulo: sinSaldo
            ? fmt("cpoCmCargarT", { total: montoSale(e.cargar, idioma) })
            : fmt("cpoCmCargarFaltaT", { falta: montoSale(e.falta, idioma) }),
          linea: sinSaldo
            ? fmt("cpoCmCargarL", { premios, servicio })
            : fmt("cpoCmCargarFalta", { saldo: montoTiene(e.saldo, idioma), premios, servicio }),
          principal: { texto: tx("cpoCmCargar"), accion: "cargar", apagado: false },
          secundario: null,
          plegado: borrador ? null : "cerrado",
        };
      }
      case "lista":
        return {
          titulo: fmt("cpoCmListaT", { c: montoSale(e.sale, idioma) }),
          linea: fmt("cpoCmListaL", { saldo: montoTiene(e.saldo, idioma), premios: montoTiene(n.premios, idioma) }),
          principal: revisandoEnLaRed
            ? { texto: tx("cpoCmRevisando"), accion: "pagar", apagado: true }
            : { texto: fmt("cpoCmPagar", { c: montoSale(e.sale, idioma) }), accion: "pagar", apagado: false },
          secundario: null,
          plegado: null,
        };
      case "otra-billetera":
        return {
          titulo: tx("cpoCmOtraT"),
          // Si se puede entrar con Google, la línea dice lo mismo que el botón y pagar a mano queda plegado.
          // Con un borrador, antes de entrar: lo que va a poner en total, premios y servicio, como lo dijo el armado.
          linea:
            e.entrar && borrador
              ? fmt("cpoCmBorradorEntrarL", {
                  total: montoSale(n.premios + e.monto, idioma),
                  premios: montoTiene(n.premios, idioma),
                  servicio: montoSale(e.monto, idioma),
                })
              : fmt(e.entrar ? "cpoCmOtraEntrarL" : "cpoCmOtraL", { c: montoSale(e.monto, idioma) }),
          principal: e.entrar ? { texto: tx("cpoCmEntrar"), accion: "entrar", apagado: false } : mirarBoton(),
          secundario: e.entrar ? { texto: tx("cpoCmMirar"), accion: "mirar" } : null,
          plegado: borrador ? null : e.entrar ? "cerrado" : "abierto",
        };
      case "otra-cuenta": {
        const pide = ctx.pide() ?? "";
        return {
          titulo: fmt("cpoEntraCon", { fin: pide.slice(-4) }),
          linea: "",
          principal: ctx.puedeEntrar() ? { texto: tx("cpoCmCambiar"), accion: "entrar", apagado: false } : mirarBoton(),
          secundario: null,
          plegado: null,
        };
      }
      case "solo-google":
        // Lo mismo que dice la activación cuando la sala pide Google, pero antes de cargar y de pagar: nada se cobra.
        return {
          titulo: tx("cpoAcGoogleT"),
          linea: tx("cpoAcGoogleL"),
          principal: ctx.puedeEntrar() ? { texto: tx("cpoCmEntrar"), accion: "entrar", apagado: false } : mirarBoton(),
          secundario: null,
          plegado: null,
        };
      case "ahora-no":
        return {
          titulo: tx("cpoCmOtraT"),
          linea: tx(borrador ? "cpoAcAhoraNoL" : "cpoCmAhoraNoL"),
          principal: mirarBoton(),
          secundario: null,
          plegado: borrador ? null : "abierto",
        };
    }
  }

  function datosDelPlegado(): { cuenta: string; monto: bigint; nota: string; enlace: string } | null {
    const cfg = config();
    const c = ctx.campana();
    if (!cfg || !c) return null;
    const e = estado();
    const monto = e.tipo === "falta-cargar" || e.tipo === "otra-billetera" || e.tipo === "ahora-no" ? e.monto : null;
    if (monto === null) return null;
    const nota = notaDeLaComision(c.evento);
    return { cuenta: cfg.cuenta, monto, nota, enlace: enlaceDePagoDeLaComision(cfg.cuenta, monto, nota) };
  }

  function firma(): string {
    const e = estado();
    const c = ctx.campana();
    const hasta = c ? (marcaViva(c.evento)?.hasta ?? 0) : 0;
    return [activo(), JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), hasta, ctx.idioma(), ctx.puedeEntrar(), etapaDelPago, revisandoEnLaRed].join("|");
  }

  function reiniciar(): void {
    mirada++;
    epoca++;
    pararEspera?.();
    pararEspera = null;
    pararDuda?.();
    pararDuda = null;
    etapaDelPago = null;
    red = null;
    saldo = null;
    portero = null;
    billetera = "otra";
    pagadaAca = false;
    pagando = false;
    revisandoLaCuenta = false;
    revisandoEnLaRed = false;
    rechazos = 0;
    marcaEnMemoria = null;
  }

  return {
    activo,
    estado,
    bloqueaElAbrir: () => activo() && estado().tipo !== "pagada",
    mirar: () => mirar(),
    etapaDelPago: () => etapaDelPago,
    pagar,
    cargar,
    descripcion,
    firma,
    reiniciar,
    detener: () => {
      mirada++;
      epoca++;
      pararEspera?.();
      pararEspera = null;
      pararDuda?.();
      pararDuda = null;
    },
    datosDelPlegado,
  };
}
