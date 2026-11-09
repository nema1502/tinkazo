import "../equipos/equipos.css";
import { equiposActivo } from "../equipos/bandera";
import { descifrarEquipo, revisarEquipo } from "../equipos/datos";
import { enlaceDeRegistro } from "../equipos/enlace";
import { LAB_FIRMAR, type Aprobacion, aprobarYEnviar } from "../equipos/envio";
import { type Evidencia, accionSugerida, contarPorEstado, estadoEfectivo, listaDesdeCupones, paraDarCupon } from "../equipos/estado";
import { type OpcionesDeHorizon, type Pago, cuentasActivas, cuponesEnviados, leerCuenta, pagosDeLaCuenta, quedaPorLeer } from "../equipos/horizon";
import { type ConfigEquipos, type DatosDeEquipo, type Equipo, ES_CUENTA, EVENTO_POR_DEFECTO, cuentaCorta, esCuenta, esEstado, eventoValido, rango } from "../equipos/modelo";
import { horaValida, instanteDelSorteo } from "../equipos/pantalla-stand";
import { type LecturaDeSorteos, cuentasQueYaSortearon } from "../equipos/sorteos";
import { type PedidoDeCupones, type TransaccionDeCupones, armarCupones, tandas } from "../equipos/transacciones";
import { ponerEtiquetas } from "../equipos/etiquetas";
import { getLang, onLangChange, t } from "../i18n";
import { type EquipoDeSala, type EstadoDeConexion, type Sala, cerrarSala, crearSala, escucharSala } from "../sala/cliente";
import { cambiarEstadoEnSala, configurarRegistro, quitarEquipoEnSala } from "../sala/equipos";
import { accountUrl, network, txUrl } from "../stellar/config";
import { activeWallet } from "../stellar/wallet-lite";
import { app } from "../state";
import { type DatosDePantalla, type DepsDePantalla, type PantallaDelStand, crearPantallaDelStand } from "./pantalla-stand";
import { pintarQr, precargarQr } from "./qr";
import { setList } from "./participants";

/**
 * Los equipos con cupón, en la pantalla de quien organiza (Space Apps y parecidos). Detrás de la bandera
 * `VITE_EQUIPOS`: apagada, esto no existe.
 *
 * Quien organiza abre un registro (una sala de `workers/sala`, con un QR), y cada equipo se anota desde el celular
 * de su encargado con su cuenta (`equipos.html`). Los datos del equipo viajan cifrados con la clave del QR; la
 * cuenta, en claro. Acá se ven los equipos con el punto en que están, y hay tres pasos:
 *
 *  1. Aceptar (solo en el modo «con sorteo propio»): el equipo pidió participar y quien organiza lo acepta.
 *  2. Dar cupones: UNA transacción de hasta 100 pagos de 1 stroop de XLM a las cuentas de los equipos que les
 *     toca, con la nota `tk:cupon:<evento>`. En el modo de reserva toca a todos los anotados; en el de sorteo propio,
 *     a los aceptados que ya sellaron un sorteo con su cuenta (se lee del contrato). Las cuentas que todavía no
 *     existen en la red se dicen, no se mandan.
 *  3. Usar los equipos con cupón como lista: las cuentas, una por línea, en el orden en que recibieron el cupón. El
 *     nombre de cada equipo queda como etiqueta local para el show y el resultado.
 *
 * Para el proyector, «Mostrar la pantalla del stand» abre a pantalla completa el QR en grande, los equipos con su punto,
 * cuántos tienen cupón y, si se fijó la hora del sorteo, cuánto falta (`pantalla-stand.ts`).
 *
 * La verdad está en la cadena: cada cierto tiempo (y al tocar «Revisar de nuevo») la pantalla lee los pagos de la
 * cuenta del evento y los sorteos del contrato, y de ahí salen los estados. Lo que dice la sala es lo que ve el
 * celular del equipo.
 *
 * Solo se guarda en esta pestaña (`sessionStorage`): si se recarga, la sala sigue.
 */

const CLAVE = "tinkazo.equipos.sala";
const REVISAR_CADA_MS = 20_000;
const PAUSA_TRAS_ENVIAR_MS = 4_000;
/** Si la lectura de los pagos quedó a medias por su tope, la próxima va a los pocos segundos, sin pasarse del límite de Horizon. */
const SEGUIR_LEYENDO_MS = 5_000;

/* ------------------------------------------------------------ dependencias */

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DepsDelPanel {
  /** La hora de ahora, en milisegundos. */
  ahora: () => number;
  tx: (clave: string) => string;
  /** La cuenta con que se entró, para proponerla como cuenta del evento. */
  cuentaDeLaSesion: () => string | null;
  crearSala: () => Promise<Sala>;
  cerrarSala: (s: Sala) => Promise<boolean>;
  configurar: (s: Sala, c: ConfigEquipos) => Promise<boolean>;
  escuchar: typeof escucharSala;
  cambiarEstado: typeof cambiarEstadoEnSala;
  quitar: typeof quitarEquipoEnSala;
  descifrar: (clave: string, d: string) => Promise<DatosDeEquipo | null>;
  pagos: (cuenta: string) => Promise<Pago[] | null>;
  /** Si el último `null` de `pagos` es porque falta leer (no porque la red falló). */
  pagosPendientes?: (cuenta: string) => boolean;
  sorteos: (cuentas: readonly string[]) => Promise<LecturaDeSorteos | null>;
  activas: (cuentas: readonly string[]) => Promise<Map<string, boolean | null>>;
  leerCuenta: (cuenta: string) => Promise<Awaited<ReturnType<typeof leerCuenta>>>;
  armar: (p: PedidoDeCupones) => Promise<TransaccionDeCupones>;
  aprobar: (xdr: string, origen: string) => Promise<Aprobacion>;
  /** Pone el texto en el cuadro de la lista. `false` si no pudo (la lista ya está sellada). */
  ponerLista: (texto: string) => boolean;
  ponerEtiquetas: (m: ReadonlyMap<string, string>) => void;
  qr: (img: HTMLImageElement, enlace: string) => Promise<void>;
  precargarQr: () => Promise<void>;
  /** Cada cuánto mirar la red mientras el registro está abierto. Devuelve cómo parar. */
  cada: (f: () => void, ms: number) => () => void;
  esperar: (ms: number) => Promise<void>;
  almacen: Almacen;
  origen: () => string;
  passphrase: string;
  verCuenta: (cuenta: string) => string;
  verTransaccion: (hash: string) => string;
  portapapeles: (texto: string) => Promise<boolean>;
  /** La pantalla del stand, para el proyector. Recibe de dónde leer los datos. */
  pantalla: (datos: DepsDePantalla["datos"]) => PantallaDelStand;
}

export function depsReales(): DepsDelPanel {
  const horizon: OpcionesDeHorizon = {};
  return {
    tx: t,
    cuentaDeLaSesion: () => activeWallet()?.address ?? null,
    crearSala: () => crearSala(),
    cerrarSala: (s) => cerrarSala(s),
    configurar: (s, c) => configurarRegistro(s, c),
    escuchar: escucharSala,
    cambiarEstado: cambiarEstadoEnSala,
    quitar: quitarEquipoEnSala,
    descifrar: descifrarEquipo,
    pagos: (c) => pagosDeLaCuenta(c, horizon),
    pagosPendientes: (c) => quedaPorLeer(c, horizon),
    sorteos: (cs) => cuentasQueYaSortearon(cs),
    activas: (cs) => cuentasActivas(cs, horizon),
    leerCuenta: (c) => leerCuenta(c, horizon),
    armar: armarCupones,
    aprobar: (xdr, origen) => aprobarYEnviar(xdr, origen, { billetera: activeWallet(), passphrase: network.networkPassphrase }),
    ponerLista: (texto) => {
      if (app.frozen) return false;
      setList(texto);
      return true;
    },
    ponerEtiquetas,
    ahora: () => Date.now(),
    qr: async (img, enlace) => void (await pintarQr(img, enlace, 300)),
    precargarQr: async () => void (await precargarQr()),
    cada: (f, ms) => {
      const id = setInterval(f, ms);
      return () => clearInterval(id);
    },
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    almacen: sessionStorage,
    origen: () => location.origin,
    passphrase: network.networkPassphrase,
    verCuenta: accountUrl,
    verTransaccion: txUrl,
    portapapeles: async (texto) => {
      try {
        await navigator.clipboard.writeText(texto);
        return true;
      } catch {
        return false;
      }
    },
    pantalla: (datos) =>
      crearPantallaDelStand({
        tx: t,
        idioma: getLang,
        datos,
        qr: async (img, enlace, lado) => void (await pintarQr(img, enlace, lado)),
        ahora: () => Date.now(),
        cada: (f, ms) => {
          const id = setInterval(f, ms);
          return () => clearInterval(id);
        },
        ventana: () => ({ ancho: innerWidth, alto: innerHeight }),
      }),
  };
}

/* -------------------------------------------------------------- el panel */

interface Guardada {
  sala: Sala;
  config: ConfigEquipos;
  dejados: number[];
  /** La hora del sorteo para la cuenta regresiva de la pantalla del stand («18:30»), o vacío. Solo vive en esta pestaña. */
  hora?: string;
  /** El instante del sorteo que salió de esa hora cuando se fijó, para que no cambie al pasar la medianoche. */
  instante?: number;
}

type Ocupado = "" | "revisando" | "cupones";

export interface PanelDeEquipos {
  /** La raíz, para ponerla en la página. */
  raiz: HTMLElement;
  /** Vuelve a pintar (por ejemplo, al cambiar el idioma). */
  pintar: () => void;
  /** Mira la red de nuevo: pagos, sorteos y cuentas. */
  revisar: (fresco?: boolean) => Promise<void>;
  darCupones: () => Promise<void>;
  usarComoLista: () => void | Promise<void>;
  /** Para parar los temporizadores y la escucha (en las pruebas). */
  detener: () => void;
}

export function crearPanelDeEquipos(deps: DepsDelPanel): PanelDeEquipos {
  const tx = deps.tx;
  const raiz = document.createElement("section");
  raiz.className = "equipos-panel";
  raiz.id = "equipos-panel";
  raiz.setAttribute("aria-labelledby", "eq-t");
  raiz.hidden = true;

  let sala: Sala | null = null;
  let config: ConfigEquipos | null = null;
  let estadoRed: EstadoDeConexion = "conectando";
  const equipos = new Map<number, Equipo>();
  const evidencias = new Map<string, Evidencia>();
  const dejados = new Set<number>();
  let ocupado: Ocupado = "";
  let mensaje = "";
  let progreso = "";
  let xdr: { texto: string; porque: "pollar" | "otra-cuenta" | "sin-billetera" } | null = null;
  let ultimaTransaccion = "";
  /** `pagos`: los cupones no se pudieron mirar enteros; `leyendo`: porque falta leer, no porque la red falló. */
  let avisos = { pagos: false, leyendo: false, sorteos: false, truncado: false };
  let escucha: { parar: () => void } | null = null;
  let pararReloj: (() => void) | null = null;
  let qrDe = "";
  let enlaceCopiado = false;
  /** Para no pisar un envío con la lectura periódica. */
  let revisandoYa: Promise<void> | null = null;
  /** La hora del sorteo que fijó quien organiza, para la pantalla del stand. */
  let hora = "";
  /** El instante de esa hora, calculado una sola vez al fijarla. */
  let instante: number | null = null;
  let pantalla: PantallaDelStand | null = null;

  const fmt = (clave: string, vars: Record<string, string | number>): string =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), tx(clave));

  /* ---------------------------------------------------------------- armado */

  raiz.innerHTML =
    `<h3 id="eq-t" data-eq="eqT"></h3>` +
    `<div id="eq-config">` +
    `<p class="note" data-eq="eqB"></p>` +
    `<fieldset class="eq-modo"><legend data-eq="eqModoT"></legend>` +
    `<label class="eq-opcion"><input type="radio" name="eq-modo" value="sorteo" checked /><span><b data-eq="eqModoSorteo"></b><small data-eq="eqModoSorteoB"></small></span></label>` +
    `<label class="eq-opcion"><input type="radio" name="eq-modo" value="cupon" /><span><b data-eq="eqModoCupon"></b><small data-eq="eqModoCuponB"></small></span></label>` +
    `</fieldset>` +
    `<div class="field"><label for="eq-evento" data-eq="eqEvento"></label><input id="eq-evento" type="text" maxlength="19" autocomplete="off" spellcheck="false" /><small data-eq="eqEventoAyuda"></small></div>` +
    `<div class="field"><label for="eq-cuenta" data-eq="eqCuentaEvento"></label><input id="eq-cuenta" type="text" maxlength="56" autocomplete="off" spellcheck="false" class="mono" /><small data-eq="eqCuentaEventoAyuda"></small></div>` +
    `<button class="ghost" type="button" id="eq-abrir" data-eq="eqAbrir"></button>` +
    `</div>` +
    `<p class="ss-error" id="eq-error" role="status" hidden></p>` +
    `<div id="eq-sala" hidden>` +
    `<div class="ss-qr">` +
    `<img id="eq-qr" alt="" />` +
    `<div class="ss-lado">` +
    `<p class="ss-estado" id="eq-estado" role="status" aria-live="polite"></p>` +
    `<p class="ss-cuenta" id="eq-cuenta-n" aria-live="polite"></p>` +
    `<p class="eq-resumen" id="eq-resumen"></p>` +
    `<div class="row">` +
    `<button class="ghost" type="button" id="eq-pantalla" aria-haspopup="dialog" data-eq="eqStAbrir"></button>` +
    `<button class="ghost" type="button" id="eq-copiar" data-eq="eqCopiarEnlace"></button>` +
    `<button class="ghost" type="button" id="eq-cerrar" data-eq="eqCerrar"></button>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `<div class="field eq-hora"><label for="eq-hora" data-eq="eqStHora"></label><input id="eq-hora" type="time" step="60" /><small data-eq="eqStHoraAyuda"></small></div>` +
    `<div class="eq-acciones row">` +
    `<button class="ghost" type="button" id="eq-aceptar-todos" hidden></button>` +
    `<button class="ghost" type="button" id="eq-dar"></button>` +
    `<button class="ghost" type="button" id="eq-lista" data-eq="eqUsarLista" hidden></button>` +
    `<button class="mini" type="button" id="eq-revisar" data-eq="eqRevisar"></button>` +
    `</div>` +
    `<p class="note" id="eq-progreso" role="status" aria-live="polite" hidden></p>` +
    `<div class="eq-xdr" id="eq-xdr" hidden>` +
    `<h4 data-eq="eqXdrT"></h4><p class="note" id="eq-xdr-porque"></p><p class="note" data-eq="eqXdrPasos"></p>` +
    `<textarea id="eq-xdr-texto" readonly rows="4" spellcheck="false" class="mono"></textarea>` +
    `<div class="row"><button class="ghost" type="button" id="eq-xdr-copiar" data-eq="eqXdrCopiar"></button>` +
    `<a class="ghost btn-like" id="eq-xdr-lab" href="${LAB_FIRMAR}" target="_blank" rel="noopener" data-eq="eqXdrLab"></a>` +
    `<button class="ghost" type="button" id="eq-xdr-ya" data-eq="eqXdrYa"></button></div>` +
    `</div>` +
    `<p class="note" data-eq="eqEtiquetaNota"></p>` +
    `<ul class="eq-equipos" id="eq-equipos"></ul>` +
    `<div class="ss-revisar" id="eq-para-revisar" hidden><h4 data-eq="eqParaRevisar"></h4><p class="note" data-eq="eqParaRevisarB"></p><ul class="eq-equipos" id="eq-para-revisar-lista"></ul></div>` +
    `</div>`;

  const q = <T extends HTMLElement>(id: string): T => raiz.querySelector<T>(`#${id}`) as T;

  /* --------------------------------------------------------------- guardar */

  function guardar(): void {
    try {
      if (sala && config) deps.almacen.setItem(CLAVE, JSON.stringify({ sala, config, dejados: [...dejados], hora, ...(instante === null ? {} : { instante }) } satisfies Guardada));
      else deps.almacen.removeItem(CLAVE);
    } catch {
      /* sin almacenamiento, el registro dura lo que la página */
    }
  }

  function leerGuardada(): Guardada | null {
    try {
      const x = JSON.parse(deps.almacen.getItem(CLAVE) ?? "null") as Partial<Guardada> | null;
      if (!x?.sala || typeof x.sala.id !== "string" || typeof x.sala.token !== "string" || typeof x.sala.clave !== "string" || !x.config) return null;
      if (x.sala.vence && x.sala.vence < Date.now()) return null;
      if ((x.config.modo !== "cupon" && x.config.modo !== "sorteo") || !esCuenta(x.config.cuenta) || typeof x.config.evento !== "string") return null;
      return {
        sala: x.sala,
        config: x.config,
        dejados: Array.isArray(x.dejados) ? x.dejados.filter((n): n is number => typeof n === "number") : [],
        hora: typeof x.hora === "string" && horaValida(x.hora) ? x.hora : "",
        ...(typeof x.instante === "number" && Number.isFinite(x.instante) ? { instante: x.instante } : {}),
      };
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- estado */

  const lista = (): Equipo[] => [...equipos.values()].sort((a, b) => a.n - b.n);
  const modo = (): ConfigEquipos["modo"] => config?.modo ?? "sorteo";

  /** Lo que muestra la pantalla del stand: el QR del registro, los equipos con lo que dice la red y la hora fijada. */
  function datosDePantalla(): DatosDePantalla | null {
    if (!sala || !config) return null;
    return { enlace: enlaceDeRegistro(sala, deps.origen()), modo: config.modo, equipos: lista(), evidencias, instante };
  }

  function aviso(texto: string): void {
    mensaje = texto;
    pintar();
  }

  /** Los equipos que quedaron afuera por la cuenta, para decirlos por nombre: los tres primeros y cuántos más. */
  function nombresDe(equipos: readonly Equipo[]): string {
    const nombres = equipos.map((e) => e.nombre);
    return nombres.length <= 3 ? nombres.join(", ") : `${nombres.slice(0, 3).join(", ")} ${fmt("eqYMas", { n: nombres.length - 3 })}`;
  }

  const notaDeCuentasMalas = (malas: readonly Equipo[]): string => (malas.length ? fmt("eqCuentasMalas", { quienes: nombresDe(malas) }) : "");

  async function activasDe(cuentas: string[]): Promise<void> {
    if (cuentas.length === 0) return;
    const m = await deps.activas(cuentas);
    for (const e of equipos.values()) {
      const a = m.get(e.cuenta);
      if (a !== undefined) e.activa = a;
    }
    pintar();
  }

  async function recibir(x: EquipoDeSala): Promise<void> {
    const s = sala;
    if (!s) return;
    const datos = await deps.descifrar(s.clave, x.d);
    if (sala !== s) return;
    const rev = datos ? revisarEquipo(datos) : null;
    if (!datos || !rev) {
      // De otra clave, roto o con un enlace: no se muestra y tampoco ocupa un lugar en la sala.
      void deps.quitar(s, x.n);
      return;
    }
    const antes = equipos.get(x.n);
    if (antes && antes.v > x.v) return;
    equipos.set(x.n, {
      n: x.n,
      cuenta: x.cuenta,
      nombre: rev.equipo.nombre,
      integrantes: rev.equipo.integrantes,
      guardado: esEstado(x.estado) ? x.estado : "solicitud",
      v: x.v,
      revisar: rev.revisar && !dejados.has(x.n),
      activa: antes?.activa ?? null,
    });
    pintar();
    if (!antes || antes.activa === null) void activasDe([x.cuenta]);
  }

  function seQuito(n: number): void {
    if (equipos.delete(n)) {
      dejados.delete(n);
      pintar();
    }
  }

  /** Mira la red: los cupones que ya salieron, quiénes ya sortearon y qué cuentas ya existen. Sube lo que cambió a la sala. */
  async function revisar(fresco = false): Promise<void> {
    const s = sala;
    const c = config;
    if (!s || !c) return;
    if (revisandoYa) {
      // Una lectura ya en curso: sirve, salvo que se pida una posterior a lo que acaba de pasar (después de mandar cupones).
      if (!fresco) return revisandoYa;
      await revisandoYa;
      if (sala !== s) return;
    }
    revisandoYa = (async () => {
      if (ocupado === "") ocupado = "revisando";
      pintar();
      try {
        const cuentas = lista().map((e) => e.cuenta);
        const sinSaber = lista().filter((e) => e.activa !== true).map((e) => e.cuenta);
        const [pagos, sorteos] = await Promise.all([deps.pagos(c.cuenta), c.modo === "sorteo" && cuentas.length ? deps.sorteos(cuentas) : Promise.resolve(undefined), activasDe(sinSaber)]);
        if (sala !== s) return;
        avisos = {
          pagos: pagos === null,
          leyendo: pagos === null && !!deps.pagosPendientes?.(c.cuenta),
          sorteos: c.modo === "sorteo" && sorteos === null,
          truncado: !!sorteos?.truncado,
        };
        if (pagos) {
          const cupones = cuponesEnviados(pagos, c.cuenta, c.evento);
          for (const cuenta of cuentas) {
            const cupon = cupones.get(cuenta);
            if (cupon) evidencias.set(cuenta, { ...evidencias.get(cuenta), cupon });
          }
        }
        if (sorteos) {
          for (const cuenta of cuentas) {
            const y = sorteos.porCuenta.get(cuenta);
            if (y) evidencias.set(cuenta, { ...evidencias.get(cuenta), yaSorteo: { id: y.id, contrato: y.contrato } });
          }
        }
        // Lo que la red dice y la sala todavía no: se sube, para que el celular del equipo lo vea.
        for (const e of lista()) {
          const ef = estadoEfectivo(c.modo, e.guardado, evidencias.get(e.cuenta));
          if (rango(ef) > rango(e.guardado)) void deps.cambiarEstado(s, e.n, ef);
        }
      } finally {
        revisandoYa = null;
        if (ocupado === "revisando") ocupado = "";
        pintar();
        // Lo que faltó leer se sigue leyendo sin esperar la revisión periódica.
        if (sala === s && avisos.leyendo)
          void deps.esperar(SEGUIR_LEYENDO_MS).then(() => {
            if (sala === s && ocupado === "") void revisar();
          });
      }
    })();
    return revisandoYa;
  }

  /* ------------------------------------------------------------- las acciones */

  async function abrir(): Promise<void> {
    const evento = q<HTMLInputElement>("eq-evento").value.trim();
    const cuenta = q<HTMLInputElement>("eq-cuenta").value.trim();
    const elegido = raiz.querySelector<HTMLInputElement>('input[name="eq-modo"]:checked')?.value;
    if (!eventoValido(evento)) return aviso(tx("eqErrEvento"));
    if (!esCuenta(cuenta)) return aviso(tx(ES_CUENTA.test(cuenta) ? "eqErrCuentaCopiada" : "eqErrCuenta"));
    const nuevo: ConfigEquipos = { modo: elegido === "cupon" ? "cupon" : "sorteo", evento, cuenta };
    q<HTMLButtonElement>("eq-abrir").disabled = true;
    aviso(tx("eqAbriendo"));
    void deps.precargarQr();
    let creada: Sala | null = null;
    try {
      creada = await deps.crearSala();
      if (!(await deps.configurar(creada, nuevo))) {
        void deps.cerrarSala(creada);
        mensaje = tx("eqErrConfigurar");
        creada = null;
      }
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "otro";
      mensaje = tx(motivo === "red" ? "eqErrRedCrear" : motivo === "cupo-ip" ? "eqErrCupoIp" : motivo === "cupo-dia" ? "eqErrCupoDia" : "eqErrCrear");
    }
    q<HTMLButtonElement>("eq-abrir").disabled = false;
    if (!creada) return pintar();
    mensaje = "";
    sala = creada;
    config = nuevo;
    guardar();
    escuchar(creada);
    pintar();
  }

  function escuchar(s: Sala): void {
    escucha?.parar();
    pararReloj?.();
    estadoRed = "conectando";
    escucha = deps.escuchar(s, {
      alNombre: () => undefined,
      alEquipo: (x) => void recibir(x),
      alEquipoQuitado: seQuito,
      alEstado: (e) => {
        estadoRed = e;
        pintar();
      },
      alCerrada: () => {
        mensaje = tx("eqVencida");
        olvidar();
        pintar();
      },
    });
    pararReloj = deps.cada(() => {
      if (ocupado === "") void revisar();
    }, REVISAR_CADA_MS);
    // Una primera mirada enseguida: puede haber cupones de antes (se recargó la pantalla).
    void revisar();
  }

  function olvidar(): void {
    escucha?.parar();
    escucha = null;
    pararReloj?.();
    pararReloj = null;
    sala = null;
    config = null;
    equipos.clear();
    evidencias.clear();
    dejados.clear();
    xdr = null;
    progreso = "";
    ultimaTransaccion = "";
    hora = "";
    instante = null;
    avisos = { pagos: false, leyendo: false, sorteos: false, truncado: false };
    pantalla?.cerrar();
    guardar();
  }

  async function cerrar(): Promise<void> {
    const s = sala;
    if (!s) return;
    q<HTMLButtonElement>("eq-cerrar").disabled = true;
    const bien = await deps.cerrarSala(s);
    q<HTMLButtonElement>("eq-cerrar").disabled = false;
    if (!bien) return aviso(tx("eqErrCerrar"));
    olvidar();
    aviso(tx("eqCerradaMsg"));
  }

  async function aceptar(ns: number[]): Promise<void> {
    const s = sala;
    if (!s) return;
    const falla: number[] = [];
    await Promise.all(
      ns.map(async (n) => {
        const e = equipos.get(n);
        if (!e || e.guardado !== "solicitud") return;
        e.guardado = "aceptado";
        if (!(await deps.cambiarEstado(s, n, "aceptado"))) {
          e.guardado = "solicitud";
          falla.push(n);
        }
      }),
    );
    mensaje = falla.length ? tx("eqErrAceptar") : "";
    pintar();
    // Un equipo que ya sorteó antes pasa enseguida a «ya sorteó»: sin esperar a la próxima mirada.
    if (!falla.length) void revisar();
  }

  async function quitar(n: number): Promise<void> {
    const s = sala;
    const e = equipos.get(n);
    if (!s || !e) return;
    seQuito(n);
    if (!(await deps.quitar(s, n)) && sala === s) {
      equipos.set(n, e);
      mensaje = tx("eqErrQuitar");
      pintar();
    }
  }

  function mostrar(n: number): void {
    const e = equipos.get(n);
    if (!e) return;
    e.revisar = false;
    dejados.add(n);
    guardar();
    pintar();
  }

  const MOTIVOS_DE_ENVIO: Record<string, string> = {
    "sin-destino": "eqErrSinDestino",
    "sin-saldo": "eqErrSinSaldo",
    secuencia: "eqErrSecuencia",
    tarde: "eqErrTarde",
    red: "eqErrRed",
    rechazada: "eqErrRechazada",
    "otra-red": "eqErrOtraRed",
    cancelada: "eqErrCancelada",
  };

  /** Si el error es de conexión (el navegador no llegó a la red); cualquier otro es un fallo nuestro y no se dice «sin conexión». */
  function esErrorDeRed(e: unknown): boolean {
    if (e instanceof DOMException) return e.name === "AbortError" || e.name === "TimeoutError" || e.name === "NetworkError";
    return e instanceof TypeError && /fetch|network|load failed|conexi/i.test(e.message);
  }

  async function darCupones(): Promise<void> {
    const s = sala;
    const c = config;
    if (!s || !c || ocupado === "cupones") return;
    ocupado = "cupones";
    xdr = null;
    mensaje = "";
    progreso = tx("eqDandoCupones");
    pintar();
    try {
      // Con lo último que dice la red: quién ya tiene el cupón, quién ya sorteó, qué cuentas existen.
      await revisar(true);
      if (sala !== s) return;
      // Sin todos los pagos a la vista no se sabe quién ya tiene su cupón: no se manda nada.
      if (avisos.pagos) {
        progreso = "";
        return sinPagosLeidos();
      }
      const { listos, inactivos, malas } = paraDarCupon(c.modo, lista(), evidencias);
      // Una cuenta mal escrita nunca entra a la tanda: haría fallar el cupón de todos. Se deja afuera y se dice cuál es.
      const notaMalas = notaDeCuentasMalas(malas);
      if (listos.length === 0) {
        progreso = "";
        return aviso([notaMalas, inactivos.length ? fmt("eqNoActivas", { n: inactivos.length }) : ""].filter(Boolean).join(" ") || tx("eqSinQuienDar"));
      }
      const tanda = tandas(listos)[0] ?? [];
      const cuenta = await deps.leerCuenta(c.cuenta);
      if (cuenta === null) {
        progreso = "";
        return aviso(tx("eqErrRed"));
      }
      if (!cuenta.existe) {
        progreso = "";
        return aviso(tx("eqErrCuentaEvento"));
      }
      const hecha = await deps.armar({ origen: c.cuenta, secuencia: cuenta.secuencia, destinos: tanda.map((e) => e.cuenta), evento: c.evento, passphrase: deps.passphrase });
      progreso = tx("eqEnviandoCupones");
      pintar();
      const r = await deps.aprobar(hecha.xdr, c.cuenta);
      if (r.tipo === "a-mano") {
        xdr = { texto: r.xdr, porque: r.porque };
        progreso = "";
        return pintar();
      }
      if (r.tipo === "fallo") {
        progreso = "";
        return aviso(tx(MOTIVOS_DE_ENVIO[r.motivo] ?? "eqErrRechazada"));
      }
      ultimaTransaccion = r.hash;
      // Horizon tarda unos segundos en mostrar el pago: se mira hasta tres veces.
      for (let i = 0; i < 3; i++) {
        await deps.esperar(PAUSA_TRAS_ENVIAR_MS);
        await revisar(true);
        if (tanda.every((e) => evidencias.get(e.cuenta)?.cupon)) break;
      }
      const quedan = listos.length - tanda.length;
      const resultado = quedan > 0 ? fmt("eqCuponesTanda", { n: tanda.length, m: quedan }) : fmt("eqCuponesListos", { n: tanda.length });
      progreso = notaMalas ? `${resultado} ${notaMalas}` : resultado;
    } catch (e) {
      progreso = "";
      mensaje = tx(e instanceof Error && e.message.startsWith("cupones:") ? "eqErrRechazada" : esErrorDeRed(e) ? "eqErrRed" : "eqErrInesperado");
    } finally {
      ocupado = "";
      pintar();
    }
  }

  const textoDePagos = (): string => (avisos.leyendo ? "eqPagosLeyendo" : "eqPagosNoLeidos");
  /** Deja a la vista el aviso de los pagos (que se va solo cuando la lectura termina), sin otro mensaje que lo tape. */
  const sinPagosLeidos = (): void => aviso("");

  function usarComoLista(): void | Promise<void> {
    // Con una lectura de la red en curso (al abrir la pantalla tarda unos segundos), los cupones todavía están llegando:
    // se espera a que termine. Sin esto, un toque temprano decía «Hacen falta al menos dos equipos con cupón» con dos ya a la vista.
    if (revisandoYa) return revisandoYa.then(() => usarComoLista());
    // Con los pagos sin leer enteros, la lista puede quedar sin equipos que sí tienen su cupón: no se arma.
    if (avisos.pagos) return sinPagosLeidos();
    const { lineas, etiquetas } = listaDesdeCupones(lista(), evidencias);
    if (lineas.length < 2) return aviso(tx("eqListaPocos"));
    if (!deps.ponerLista(lineas.join("\n"))) return aviso(tx("eqListaSellada"));
    deps.ponerEtiquetas(etiquetas);
    aviso(fmt("eqListaPuesta", { n: lineas.length }));
  }

  /* ------------------------------------------------------------------ la vista */

  function fila(e: Equipo, conAceptar: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "eq-equipo";
    li.dataset.n = String(e.n);
    const ev = evidencias.get(e.cuenta);
    const ef = estadoEfectivo(modo(), e.guardado, ev);
    li.dataset.estado = ef;
    const cabeza = document.createElement("div");
    cabeza.className = "eq-cabeza";
    const nombre = document.createElement("b");
    nombre.className = "eq-nombre";
    nombre.textContent = e.revisar ? tx("eqSinMostrar") : e.nombre;
    cabeza.append(nombre);
    const estado = document.createElement("span");
    estado.className = "eq-chip";
    estado.textContent = tx(ef === "cupon" ? "eqEstCupon" : ef === "sorteo" ? "eqEstSorteo" : ef === "aceptado" ? (modo() === "cupon" ? "eqEstAnotado" : "eqEstAceptado") : "eqEstSolicitud");
    cabeza.append(estado);
    li.append(cabeza);
    if (!e.revisar) {
      const quienes = document.createElement("small");
      quienes.className = "eq-quienes";
      quienes.textContent = `${tx("eqIntegrantes")}: ${e.integrantes.join(", ")}`;
      li.append(quienes);
    }
    const cuenta = document.createElement("a");
    cuenta.className = "eq-cuenta mono";
    cuenta.href = deps.verCuenta(e.cuenta);
    cuenta.target = "_blank";
    cuenta.rel = "noopener";
    cuenta.textContent = cuentaCorta(e.cuenta);
    li.append(cuenta);
    if (ev?.cupon) {
      const v = document.createElement("a");
      v.className = "eq-cuenta";
      v.href = deps.verTransaccion(ev.cupon.hash);
      v.target = "_blank";
      v.rel = "noopener";
      v.textContent = tx("eqCuponDe");
      li.append(v);
    }
    if (e.activa === false && ef !== "cupon") {
      const w = document.createElement("p");
      w.className = "eq-aviso";
      w.textContent = `${tx("eqInactiva")}. ${tx("eqInactivaAyuda")}`;
      li.append(w);
    }
    if (!esCuenta(e.cuenta) && ef !== "cupon") {
      const w = document.createElement("p");
      w.className = "eq-aviso";
      w.dataset.cuentaMala = "1";
      w.textContent = tx("eqCuentaMala");
      li.append(w);
    }
    const botones = document.createElement("div");
    botones.className = "row eq-botones";
    const boton = (clave: string, alClick: () => void): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mini";
      b.textContent = tx(clave);
      b.setAttribute("aria-label", `${tx(clave)}: ${e.revisar ? tx("eqSinMostrar") : e.nombre}`);
      b.addEventListener("click", alClick);
      botones.append(b);
    };
    if (e.revisar) boton("eqMostrar", () => mostrar(e.n));
    else if (conAceptar && e.guardado === "solicitud") boton("eqAceptar", () => void aceptar([e.n]));
    boton("eqQuitar", () => void quitar(e.n));
    li.append(botones);
    return li;
  }

  function pintar(): void {
    for (const el of raiz.querySelectorAll<HTMLElement>("[data-eq]")) el.textContent = tx(el.dataset.eq ?? "");
    const abierta = sala !== null && config !== null;
    q("eq-config").hidden = abierta;
    q("eq-sala").hidden = !abierta;
    const error = q("eq-error");
    const texto = mensaje || (abierta && avisos.pagos ? tx(textoDePagos()) : "") || (abierta && avisos.sorteos ? tx("eqSorteosNoLeidos") : "");
    error.textContent = texto;
    error.hidden = !texto;
    const prog = q("eq-progreso");
    const aparte = abierta && config ? paraDarCupon(config.modo, lista(), evidencias) : null;
    const sinActivar = aparte?.inactivos.length ?? 0;
    // Las dos notas de lo que queda afuera de los cupones (cuenta mal copiada, cuenta sin activar) van juntas: una no tapa a la otra.
    const queDaAfuera = [aparte ? notaDeCuentasMalas(aparte.malas) : "", sinActivar ? fmt("eqNoActivas", { n: sinActivar }) : ""].filter(Boolean).join(" ");
    const nota =
      progreso ||
      (ocupado === "revisando" && abierta ? tx(modo() === "sorteo" ? "eqLeyendoSorteos" : "eqRevisando") : "") ||
      queDaAfuera ||
      (abierta && avisos.truncado ? tx("eqSorteosTruncado") : "");
    prog.textContent = nota;
    prog.hidden = !nota;
    if (!abierta || !sala || !config) {
      qrDe = "";
      return;
    }
    const enlace = enlaceDeRegistro(sala, deps.origen());
    if (qrDe !== enlace) {
      qrDe = enlace;
      void deps.qr(q<HTMLImageElement>("eq-qr"), enlace);
      q<HTMLImageElement>("eq-qr").setAttribute("aria-label", tx("eqQrAlt"));
    }
    q("eq-estado").textContent = tx(estadoRed === "en-vivo" ? "eqEnVivo" : estadoRed === "sondeo" ? "eqSondeo" : "eqConectando");
    q("eq-estado").dataset.estado = estadoRed;
    const todos = lista();
    const visibles = todos.filter((e) => !e.revisar);
    q("eq-cuenta-n").textContent = todos.length === 1 ? tx("eqCuenta1") : todos.length ? fmt("eqCuentaN", { n: todos.length }) : tx("eqVacia");
    const c = contarPorEstado(config.modo, todos, evidencias);
    q("eq-resumen").textContent = !todos.length
      ? ""
      : config.modo === "sorteo"
        ? fmt("eqResumenSorteo", { a: c.solicitud, b: c.aceptado, c: c.sorteo, d: c.cupon })
        : fmt("eqResumenCupon", { a: c.aceptado, d: c.cupon });

    // Los botones: uno solo va marcado como lo que conviene hacer ahora.
    const sugerida = accionSugerida(config.modo, todos, evidencias);
    const solicitudes = todos.filter((e) => e.guardado === "solicitud" && !e.revisar);
    const aceptarTodos = q<HTMLButtonElement>("eq-aceptar-todos");
    aceptarTodos.hidden = !(config.modo === "sorteo" && solicitudes.length > 0);
    aceptarTodos.textContent = fmt("eqAceptarTodos", { n: solicitudes.length });
    aceptarTodos.dataset.sugerida = sugerida === "aceptar" ? "1" : "";
    aceptarTodos.disabled = ocupado === "cupones";
    const { listos } = paraDarCupon(config.modo, todos, evidencias);
    const dar = q<HTMLButtonElement>("eq-dar");
    dar.textContent = listos.length ? fmt("eqDarCupones", { n: listos.length }) : tx("eqDarCuponesCero");
    dar.dataset.sugerida = sugerida === "cupones" ? "1" : "";
    dar.disabled = ocupado === "cupones" || avisos.pagos;
    const usar = q<HTMLButtonElement>("eq-lista");
    usar.hidden = !todos.some((e) => evidencias.get(e.cuenta)?.cupon);
    usar.dataset.sugerida = sugerida === "lista" ? "1" : "";
    usar.disabled = avisos.pagos;
    q<HTMLButtonElement>("eq-revisar").disabled = ocupado !== "";
    q<HTMLButtonElement>("eq-copiar").textContent = tx(enlaceCopiado ? "eqCopiado" : "eqCopiarEnlace");
    const campoHora = q<HTMLInputElement>("eq-hora");
    if (campoHora.value !== hora && document.activeElement !== campoHora) campoHora.value = hora;

    const cajaXdr = q("eq-xdr");
    cajaXdr.hidden = xdr === null;
    if (xdr) {
      q("eq-xdr-porque").textContent = tx(xdr.porque === "pollar" ? "eqXdrPollar" : xdr.porque === "otra-cuenta" ? "eqXdrOtra" : "eqXdrSin");
      q<HTMLTextAreaElement>("eq-xdr-texto").value = xdr.texto;
      q("eq-xdr-texto").setAttribute("aria-label", tx("eqXdrAria"));
    }

    const ul = q("eq-equipos");
    ul.setAttribute("aria-label", tx("eqListaAria"));
    ul.replaceChildren(...visibles.map((e) => fila(e, true)));
    const aRevisar = todos.filter((e) => e.revisar);
    q("eq-para-revisar").hidden = aRevisar.length === 0;
    q("eq-para-revisar-lista").replaceChildren(...aRevisar.map((e) => fila(e, false)));
    if (pantalla?.abierta()) pantalla.pintar();
    if (ultimaTransaccion && progreso) {
      // El enlace a la transacción va junto al aviso de que se mandó.
      const a = document.createElement("a");
      a.href = deps.verTransaccion(ultimaTransaccion);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = ` ${tx("eqVerTransaccion")}`;
      prog.append(a);
    }
  }

  /* ---------------------------------------------------------------- eventos */

  q("eq-abrir").addEventListener("click", () => void abrir());
  q("eq-cerrar").addEventListener("click", () => void cerrar());
  q("eq-aceptar-todos").addEventListener("click", () => void aceptar(lista().filter((e) => e.guardado === "solicitud" && !e.revisar).map((e) => e.n)));
  q("eq-dar").addEventListener("click", () => void darCupones());
  q("eq-lista").addEventListener("click", usarComoLista);
  q("eq-revisar").addEventListener("click", () => void revisar());
  q("eq-xdr-ya").addEventListener("click", () => {
    xdr = null;
    void revisar();
  });
  q("eq-xdr-copiar").addEventListener("click", () => {
    const texto = q<HTMLTextAreaElement>("eq-xdr-texto").value;
    void deps.portapapeles(texto).then((ok) => {
      if (!ok) {
        q<HTMLTextAreaElement>("eq-xdr-texto").select();
        return;
      }
      q<HTMLButtonElement>("eq-xdr-copiar").textContent = tx("eqCopiado");
    });
  });
  q("eq-copiar").addEventListener("click", () => {
    if (!sala) return;
    void deps.portapapeles(enlaceDeRegistro(sala, deps.origen())).then((ok) => {
      enlaceCopiado = ok;
      pintar();
    });
  });
  q("eq-pantalla").addEventListener("click", () => {
    pantalla ??= deps.pantalla(datosDePantalla);
    pantalla.abrir(q("eq-pantalla"));
  });
  q<HTMLInputElement>("eq-hora").addEventListener("change", () => {
    const v = q<HTMLInputElement>("eq-hora").value;
    hora = horaValida(v) ? v : "";
    instante = hora ? instanteDelSorteo(hora, deps.ahora()) : null;
    guardar();
    if (pantalla?.abierta()) pantalla.pintar();
  });
  // Cuenta y evento a la vista: el evento de Space Apps y la cuenta con que se entró.
  q<HTMLInputElement>("eq-evento").value = EVENTO_POR_DEFECTO;
  q<HTMLInputElement>("eq-cuenta").value = deps.cuentaDeLaSesion() ?? "";

  // El registro sigue donde estaba si se recargó la pantalla.
  const g = leerGuardada();
  if (g) {
    sala = g.sala;
    config = g.config;
    for (const n of g.dejados) dejados.add(n);
    hora = g.hora ?? "";
    // Si lo guardado es de antes de que se guardara el instante, se calcula ahora, una vez.
    instante = hora ? (g.instante ?? instanteDelSorteo(hora, deps.ahora())) : null;
    escuchar(sala);
  }
  pintar();

  return {
    raiz,
    pintar: () => {
      // La cuenta de la sesión puede haber llegado después: se propone si el campo sigue vacío.
      const campo = q<HTMLInputElement>("eq-cuenta");
      if (!campo.value) campo.value = deps.cuentaDeLaSesion() ?? "";
      pintar();
    },
    revisar,
    darCupones,
    usarComoLista,
    detener: () => {
      escucha?.parar();
      pararReloj?.();
    },
  };
}

/* ------------------------------------------------------------------ cableado */

/**
 * Se llama una vez, con la herramienta armada. Con la bandera apagada no hace nada: no agrega ni un elemento.
 * Con la bandera prendida pone un enlace («Tengo equipos») junto al del stand, y el panel, plegado, arriba del
 * cuadro de la lista.
 */
export function initEquiposSala(deps: DepsDelPanel = depsReales()): PanelDeEquipos | null {
  if (!equiposActivo()) return null;
  const origenes = document.getElementById("origenes");
  const pie = document.getElementById("btn-stand");
  if (!origenes || !pie) return null;
  const panel = crearPanelDeEquipos(deps);
  const entrada = document.createElement("button");
  entrada.type = "button";
  entrada.className = "enlace";
  entrada.id = "btn-equipos";
  entrada.setAttribute("aria-expanded", "false");
  entrada.setAttribute("aria-controls", "equipos-panel");
  const texto = (): void => {
    entrada.textContent = t("eqEntrada");
  };
  texto();
  entrada.addEventListener("click", () => {
    panel.raiz.hidden = !panel.raiz.hidden;
    entrada.setAttribute("aria-expanded", String(!panel.raiz.hidden));
    if (!panel.raiz.hidden) panel.pintar();
  });
  origenes.before(panel.raiz);
  pie.after(entrada);
  // Si el registro sigue abierto (se recargó la pantalla), el panel se ve.
  if (panel.raiz.querySelector("#eq-sala:not([hidden])")) {
    panel.raiz.hidden = false;
    entrada.setAttribute("aria-expanded", "true");
  }
  onLangChange(() => {
    texto();
    panel.pintar();
  });
  // La sesión puede llegar después de armarse la herramienta: se vuelve a proponer la cuenta.
  document.addEventListener("tinkazo:sesion", () => panel.pintar());
  return panel;
}
