import { leerEntorno } from "./musica-remota";
import { buffersAlcanzan, leerPista, Reproductor, SECCIONES, type Buffers, type Corrimientos, type NombreSeccion, type Pista } from "./pistas";
import { PISTAS } from "./pistas-lista";
import { corrimientoDeDecodificacion, leerCabeceraMp3 } from "./pistas-mp3";

/**
 * Lo que une las pistas de música por secciones (`pistas.ts`) con el sitio.
 *
 * **El interruptor.** Dos músicas: `sintetizada` (la de osciladores de `src/music.ts`, la de siempre) y `pistas` (la
 * pista de archivo del juego, si tiene una). Manda, en este orden:
 *
 * 1. la dirección: `?musica=pistas` o `?musica=sintetizada`, que además queda recordada en la pestaña (entrar con la
 *    cuenta es irse a otra dirección y volver sin el parámetro);
 * 2. lo recordado en la pestaña;
 * 3. la bandera de construcción `VITE_MUSICA`: sin ella, `pistas`. Solo `VITE_MUSICA=sintetizada` las apaga para todos.
 *
 * Las pistas van prendidas por defecto, pero solo suenan los juegos de `pistas-lista.ts` (los que ya se escucharon dentro
 * del juego): los demás no piden ningún archivo y suenan con la de siempre.
 *
 * Con `sintetizada` ninguna función de este módulo hace nada: ni un pedido de red, ni un nodo de audio.
 *
 * **De dónde bajan.** En tinkazo.app, del servicio propio (`https://m.tinkazo.app/`, que solo le contesta al sitio). En
 * la máquina de quien prueba (localhost), de la carpeta que diga `?pistasdesde=<dirección>`, que también puede traer el
 * JSON de la pista (`<juego>.json`) para probar una antes de sumarla a `pistas-lista.ts`. En cualquier otro lado (las
 * vistas de prueba, una copia del sitio) no se baja nada.
 *
 * **Cuándo bajan.** Recién cuando hacen falta: al elegir el juego con la lista sellada, al empezar la cuenta regresiva
 * (`preloadGame`) o al sortear (`sonidoDelJuego`). Nunca en la portada, nunca antes del primer toque de la persona, nunca
 * con el sonido o la música apagados, nunca con ahorro de datos. Se decodifican una vez y quedan para el sorteo siguiente
 * (las de dos juegos como mucho, para cuidar la memoria de un celular).
 *
 * **Siempre suena algo.** Si la pista no llegó cuando arranca la música, entra si llega en el primer segundo y medio
 * (todavía suena la tarjeta) y si no, ese sorteo suena con la de siempre. Si un archivo no llega, no decodifica o no
 * alcanza, si el juego no tiene pista o si algo falla en medio del show, suena la de siempre, sin error a la vista.
 */

export type ModoMusica = "pistas" | "sintetizada";

const CLAVE_MODO = "tinkazo.musica-modo";
const MODOS: readonly ModoMusica[] = ["pistas", "sintetizada"];

/**
 * Lo que dice la bandera de construcción: las pistas, salvo `sintetizada`, que las apaga para todos. Cualquier otro valor
 * (o ninguno) deja lo normal, que es la música nueva.
 */
export function modoDeConstruccion(valor: unknown = leerBandera()): ModoMusica {
  return typeof valor === "string" && valor.trim().toLowerCase() === "sintetizada" ? "sintetizada" : "pistas";
}

function leerBandera(): unknown {
  try {
    return import.meta.env?.VITE_MUSICA;
  } catch {
    return undefined;
  }
}

/** El modo que pide la dirección, o `null`. */
export function modoDeLaDireccion(busqueda: string): ModoMusica | null {
  const v = (new URLSearchParams(busqueda).get("musica") ?? "").trim().toLowerCase();
  return MODOS.find((m) => m === v) ?? null;
}

function recordado(): ModoMusica | null {
  try {
    const v = sessionStorage.getItem(CLAVE_MODO);
    return MODOS.find((m) => m === v) ?? null;
  } catch {
    return null;
  }
}

function recordar(m: ModoMusica): void {
  try {
    sessionStorage.setItem(CLAVE_MODO, m);
  } catch {
    /* sin almacenamiento, vale mientras la dirección lo traiga */
  }
}

/** La música que toca en esta pestaña: la de la dirección, la recordada o la de la bandera. */
export function modoDeMusica(valor: unknown = leerBandera(), busqueda: string = buscar()): ModoMusica {
  const pedido = modoDeLaDireccion(busqueda);
  if (pedido) {
    recordar(pedido);
    return pedido;
  }
  return recordado() ?? modoDeConstruccion(valor);
}

const buscar = (): string => {
  try {
    return location.search;
  } catch {
    return "";
  }
};

const SERVICIO = "https://m.tinkazo.app/";
const SITIOS = ["tinkazo.app", "www.tinkazo.app"];
const LOCALES = ["localhost", "127.0.0.1", "[::1]", "::1"];

/** De dónde se bajan los archivos de las pistas en este host, o `null` si acá no se bajan. */
export function baseDePistas(host: string, busqueda: string): { base: string; local: boolean } | null {
  if (LOCALES.includes(host)) {
    const pedida = new URLSearchParams(busqueda).get("pistasdesde");
    if (!pedida) return null;
    try {
      const u = new URL(pedida);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return { base: u.href.endsWith("/") ? u.href : `${u.href}/`, local: true };
    } catch {
      return null;
    }
  }
  return SITIOS.includes(host) ? { base: SERVICIO, local: false } : null;
}

/* ------------------------------------------------------------------ el estado */

interface Config {
  modo: ModoMusica;
  host: string;
  busqueda: string;
  /** Con `?auditar=` en la dirección: el registro queda a la vista de los auditores (`window.__tinkazoPista`). */
  auditar: boolean;
}

type Estado = "bajando" | "bajada" | "decodificando" | "lista" | "fallo";

interface Carga {
  juego: string;
  estado: Estado;
  pista: Pista | null;
  bytes: { [K in NombreSeccion]?: ArrayBuffer };
  buffers: Buffers;
  /** Lo que corrió este navegador el audio de cada archivo al decodificarlo: cero en Chrome y Firefox. */
  corrimientos: Corrimientos;
  intentos: number;
  /** Un fallo que bajar otra vez no arregla: el JSON, o los archivos, no cierran. */
  definitivo: boolean;
  avisar: (() => void)[];
  /** Corta los pedidos de red de esta carga: se usa cuando ya nadie va a necesitarla. */
  ctl: AbortController | null;
}

interface Pendiente {
  c: Carga;
  ctx: BaseAudioContext;
  destino: AudioNode;
  bus: GainNode;
  vol: number;
  plazo: number;
  /** Suelta lo que esta espera dejó colgado: su aviso en la carga y su oyente del contexto de audio. */
  quitar: () => void;
}

/** Lo que tarda como mucho una pista en llegar después de que arrancó la música para entrar igual (segundos del audio). */
const GRACIA = 1.5;
/** Las pistas que quedan decodificadas a la vez. */
const MAX_CARGAS = 2;
/** Los intentos de bajar una pista que falló por la red. */
const MAX_INTENTOS = 3;
/** Lo que puede tardar en bajar una pista entera (el JSON y los cinco archivos), en milisegundos. */
const TOPE_DE_BAJADA = 45000;

let config: Config | null = null;
let permiso: () => boolean = () => false;
let tocado = false;
let juegoActual: string | null = null;
let ctxConocido: BaseAudioContext | null = null;
const cargas = new Map<string, Carga>();
let vigente: Reproductor | null = null;
/** La pista del sorteo anterior, mientras su festejo se apaga con su propia salida: a mano para poder callarla. */
let saliente: Reproductor | null = null;
let sesion: { ctx: BaseAudioContext; bus: GainNode; vol: number } | null = null;
let pendiente: Pendiente | null = null;
const registro: { t: number; que: string }[] = [];

function anotar(que: string, t = ctxConocido?.currentTime ?? -1): void {
  if (registro.length >= 300) registro.shift();
  registro.push({ t: Math.round(t * 1000) / 1000, que });
}

function cfg(): Config {
  if (config) return config;
  let host = "";
  try {
    host = location.hostname;
  } catch {
    /* sin dirección */
  }
  const busqueda = buscar();
  config = { modo: modoDeMusica(undefined, busqueda), host, busqueda, auditar: new URLSearchParams(busqueda).has("auditar") };
  if (config.modo === "pistas") escucharToque();
  if (config.auditar) exponer();
  return config;
}

/** El primer toque de la persona: antes no se baja nada (salvo en la máquina de quien prueba, con `?pistasdesde=`). */
function escucharToque(): void {
  try {
    const marcar = (): void => {
      tocado = true;
    };
    for (const e of ["pointerdown", "keydown", "touchend"]) addEventListener(e, marcar, { capture: true, passive: true, once: true });
  } catch {
    /* sin página */
  }
}

function huboToque(): boolean {
  try {
    const n = navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } };
    if (n.userActivation?.hasBeenActive === true) return true;
  } catch {
    /* sin el dato */
  }
  return tocado;
}

/** Lo que da permiso a la música: la registra `src/music.ts` (música prendida y sonido prendido). */
export function permitirPistas(fn: () => boolean): void {
  permiso = fn;
}

/** De dónde bajar ahora, o `null` si ahora no se baja nada. */
function puedeBajar(): { base: string; local: boolean } | null {
  const c = cfg();
  if (c.modo !== "pistas" || !permiso()) return null;
  const b = baseDePistas(c.host, c.busqueda);
  if (!b || leerEntorno().ahorraDatos) return null;
  if (!b.local && !huboToque()) return null;
  return b;
}

/* ------------------------------------------------------------------ bajar y decodificar */

/** Avisa a quien esperaba una carga (la lista o la que falló). */
function avisar(c: Carga): void {
  const fns = c.avisar.splice(0);
  for (const fn of fns) {
    try {
      fn();
    } catch {
      /* que un aviso falle no frena a los otros */
    }
  }
}

/** `true` si la carga sigue en la lista: la que se descartó (`recortar`) o se reinició ya no la espera nadie. */
const sigueViva = (c: Carga): boolean => cargas.get(c.juego) === c;

/** Suelta lo que una carga retiene (los pedidos de red, los bytes y los buffers) porque nadie la va a usar. */
function descartar(c: Carga): void {
  c.ctl?.abort();
  c.ctl = null;
  c.bytes = {};
  c.buffers = {};
  c.corrimientos = {};
  c.avisar.length = 0;
}

function falla(c: Carga, definitivo: boolean, por: string): void {
  // Una carga descartada que se cae después (la red cortó su pedido) no tiene a quién avisar.
  if (!sigueViva(c)) return;
  c.estado = "fallo";
  c.definitivo = definitivo;
  c.bytes = {};
  c.buffers = {};
  c.corrimientos = {};
  anotar(`falla ${c.juego}: ${por}`);
  avisar(c);
}

async function pedir(url: string, senal: AbortSignal): Promise<Response | null> {
  try {
    const r = await fetch(url, { credentials: "omit", signal: senal });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

async function bajar(c: Carga, b: { base: string; local: boolean }): Promise<void> {
  // Un solo corte para toda la bajada: lo dispara el tiempo tope, o `descartar` si la pista ya no hace falta.
  const ctl = new AbortController();
  c.ctl = ctl;
  const tope = setTimeout(() => ctl.abort(), TOPE_DE_BAJADA);
  c.estado = "bajando";
  c.intentos++;
  anotar(`baja ${c.juego}`);
  try {
    let cruda: unknown = PISTAS[c.juego];
    if (b.local) {
      const r = await pedir(`${b.base}${c.juego}.json`, ctl.signal);
      if (r) cruda = await r.json();
    }
    if (!sigueViva(c)) return;
    const pista = cruda === undefined ? null : leerPista(cruda, c.juego);
    if (!pista) {
      falla(c, true, cruda === undefined ? "el juego no tiene pista" : "el JSON no cierra");
      return;
    }
    c.pista = pista;
    const nombres = SECCIONES.filter((n) => pista.secciones[n]);
    const bytes = await Promise.all(
      nombres.map(async (n) => {
        const r = await pedir(`${b.base}${pista.secciones[n]?.archivo ?? ""}`, ctl.signal);
        if (!r) throw new Error(`no llegó ${n}`);
        return r.arrayBuffer();
      }),
    );
    // Se cambió de juego mientras bajaba y esta carga se descartó: no se guarda ni se decodifica.
    if (!sigueViva(c)) return;
    nombres.forEach((n, i) => {
      c.bytes[n] = bytes[i];
    });
    c.estado = "bajada";
    anotar(`bajada ${c.juego}`);
    decodificar(c);
  } catch (e) {
    falla(c, false, String(e));
  } finally {
    clearTimeout(tope);
  }
}

/** `decodeAudioData` con promesa y con las llamadas de vuelta: el Safari viejo solo conoce las segundas. */
function decodificarUno(ctx: BaseAudioContext, ab: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((ok, mal) => {
    try {
      const p = ctx.decodeAudioData(ab, ok, mal) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === "function") p.then(ok, mal);
    } catch (e) {
      mal(e);
    }
  });
}

function decodificar(c: Carga): void {
  const ctx = ctxConocido;
  const pista = c.pista;
  if (!ctx || !pista || c.estado !== "bajada") return;
  // Descartada mientras esperaba el contexto de audio: decodificarla es gastar memoria en algo que nadie va a tocar.
  if (!sigueViva(c)) {
    descartar(c);
    return;
  }
  c.estado = "decodificando";
  const nombres = SECCIONES.filter((n) => c.bytes[n]);
  // La cabecera del MP3 se lee antes de decodificar: `decodeAudioData` se queda con los bytes.
  const cabeceras = nombres.map((n) => leerCabeceraMp3(c.bytes[n] as ArrayBuffer));
  void Promise.all(nombres.map((n) => decodificarUno(ctx, c.bytes[n] as ArrayBuffer))).then(
    (bs) => {
      if (c.estado !== "decodificando") return;
      // Se descartó mientras decodificaba (se cambió de juego): los buffers se tiran en lugar de guardarlos.
      if (!sigueViva(c)) {
        descartar(c);
        return;
      }
      c.bytes = {};
      const corrimientos: Corrimientos = {};
      nombres.forEach((n, i) => {
        const b = bs[i] as AudioBuffer;
        c.buffers[n] = b;
        // Si este navegador no recortó el silencio del codificador, el audio cayó más tarde que lo que dice el JSON.
        const k = corrimientoDeDecodificacion(cabeceras[i] ?? null, b.duration);
        if (k > 0) {
          corrimientos[n] = k;
          anotar(`corre ${c.juego}/${n} ${(k * 1000).toFixed(1)} ms`);
        }
      });
      c.corrimientos = corrimientos;
      if (!buffersAlcanzan(pista, c.buffers, corrimientos)) {
        falla(c, true, "un archivo no alcanza");
        return;
      }
      c.estado = "lista";
      anotar(`lista ${c.juego}`);
      avisar(c);
    },
    () => falla(c, true, "no decodifica"),
  );
}

/** Deja como mucho `MAX_CARGAS` pistas en memoria: se van las más viejas que no están sonando ni por sonar. */
function recortar(): void {
  for (const [juego, c] of cargas) {
    if (cargas.size <= MAX_CARGAS) break;
    if (juego === juegoActual || pendiente?.c === c) continue;
    cargas.delete(juego);
    // Sacarla del mapa no alcanza: su bajada sigue en la red y, al terminar, se decodificaría para nada.
    descartar(c);
  }
}

/**
 * Baja la pista de un juego, si la tiene y hoy toca. Lo llama `preloadGame` al elegir el juego con la lista sellada y al
 * empezar la cuenta regresiva. Es solo una descarga: decodifica cuando el sitio ya tiene su contexto de audio.
 */
export function precargarPista(juego: string): void {
  try {
    const b = puedeBajar();
    if (!b) return;
    let c = cargas.get(juego);
    if (c) {
      // Lo que ya está (o va) no se pide de nuevo. Una falla de la red se reintenta, hasta tres veces.
      if (c.estado !== "fallo" || c.definitivo || c.intentos >= MAX_INTENTOS) {
        if (c.estado === "bajada") decodificar(c);
        return;
      }
    } else {
      c = { juego, estado: "bajando", pista: null, bytes: {}, buffers: {}, corrimientos: {}, intentos: 0, definitivo: false, avisar: [], ctl: null };
      cargas.delete(juego);
      cargas.set(juego, c);
      recortar();
      // Con los dos lugares ocupados (el juego que suena y el que espera), la recién creada es la que se va: no se baja.
      if (!sigueViva(c)) return;
    }
    void bajar(c, b);
  } catch {
    /* suena la de siempre */
  }
}

/**
 * El contexto de audio de la página, apenas existe (lo llama `src/sound.ts` al armarlo): con él se decodifica lo que
 * bajó durante la cuenta regresiva, así la pista ya está lista cuando sale la tarjeta.
 */
export function pistasConContexto(ctx: BaseAudioContext): void {
  try {
    if (cfg().modo !== "pistas") return;
    ctxConocido ??= ctx;
    for (const c of cargas.values()) if (c.estado === "bajada") decodificar(c);
  } catch {
    /* suena la de siempre */
  }
}

/** El juego que va a sonar, y el contexto de audio con que se decodifica. Lo llama `sonidoDelJuego` al sortear. */
export function pistaDelJuego(juego: string, ctx: BaseAudioContext | null): void {
  try {
    if (cfg().modo !== "pistas") return;
    juegoActual = juego;
    if (ctx) ctxConocido = ctx;
    precargarPista(juego);
    const c = cargas.get(juego);
    if (c?.estado === "bajada") decodificar(c);
  } catch {
    /* suena la de siempre */
  }
}

/* ------------------------------------------------------------------ los pedidos del show */

const corriendo = (ctx: BaseAudioContext): boolean => {
  const estado = (ctx as { state?: string }).state;
  return estado === undefined || estado === "running";
};

function tomar(c: Carga, ctx: BaseAudioContext, destino: AudioNode, bus: GainNode, vol: number, tarde: boolean): boolean {
  if (!c.pista) return false;
  // La cola del festejo del sorteo anterior no se queda sonando debajo de la entrada del que empieza.
  pistaCallar();
  const r = new Reproductor(ctx, destino, c.pista, c.buffers, (que, t) => anotar(que, t), c.corrimientos);
  r.arrancar();
  vigente = r;
  sesion = { ctx, bus, vol };
  // La de osciladores queda muda. Si ya sonaba (la pista llegó tarde), se va en 0,3 s.
  const t = ctx.currentTime;
  const g = bus.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(tarde ? g.value : 0, t);
  if (tarde) g.linearRampToValueAtTime(0, t + 0.3);
  anotar(`pista ${c.juego}${tarde ? " (llegó en la gracia)" : ""}`, t);
  return true;
}

/** Termina la espera de una pista que no estaba lista: ya no la espera nadie, y se sueltan su aviso y su oyente. */
function soltarPendiente(): void {
  const p = pendiente;
  pendiente = null;
  p?.quitar();
}

function intentarPendiente(p: Pendiente): void {
  if (pendiente !== p) return;
  if (p.c.estado === "fallo") {
    soltarPendiente();
    return;
  }
  if (p.c.estado !== "lista" || !corriendo(p.ctx)) return;
  soltarPendiente();
  if (p.ctx.currentTime > p.plazo) {
    anotar(`${p.c.juego} llegó tarde: este sorteo suena con la de siempre`);
    return;
  }
  tomar(p.c, p.ctx, p.destino, p.bus, p.vol, true);
}

/** Algo falló en medio del show: la pista se calla y vuelve la de osciladores. */
function caer(e: unknown): void {
  anotar(`cae a la de siempre: ${String(e)}`);
  try {
    vigente?.parar(true);
  } catch {
    /* que se apague como pueda */
  }
  vigente = null;
  const s = sesion;
  sesion = null;
  if (!s) return;
  try {
    const t = s.ctx.currentTime;
    s.bus.gain.cancelScheduledValues(t);
    s.bus.gain.setValueAtTime(s.vol, t);
  } catch {
    /* sin audio */
  }
}

/**
 * Arranca la pista del juego, si está lista: la llama `startMusic`. `bus` es el de la música de osciladores (queda mudo
 * mientras suena la pista) y `vol` su volumen, para devolvérselo si algo falla. `true` si la pista es la música de este
 * sorteo. Si todavía está bajando, devuelve `false` y entra igual si llega en la gracia.
 */
export function pistaArrancar(ctx: BaseAudioContext, destino: AudioNode, bus: GainNode, vol: number): boolean {
  soltarPendiente();
  try {
    if (cfg().modo !== "pistas" || !permiso() || !juegoActual) return false;
    const c = cargas.get(juegoActual);
    if (!c || c.estado === "fallo") return false;
    ctxConocido ??= ctx;
    if (c.estado === "lista" && corriendo(ctx)) return tomar(c, ctx, destino, bus, vol, false);
    const p: Pendiente = { c, ctx, destino, bus, vol, plazo: ctx.currentTime + GRACIA, quitar: () => undefined };
    const alAvisar = (): void => intentarPendiente(p);
    // Una carga que ya está lista no vuelve a avisar: el aviso solo se deja donde alguien lo va a llamar.
    if (c.estado !== "lista") c.avisar.push(alAvisar);
    // Un contexto que todavía no corre (un iPhone antes del toque) avisa cuando cambia de estado.
    if (!corriendo(ctx)) ctx.addEventListener("statechange", alAvisar);
    p.quitar = (): void => {
      const i = c.avisar.indexOf(alAvisar);
      if (i >= 0) c.avisar.splice(i, 1);
      ctx.removeEventListener("statechange", alAvisar);
    };
    pendiente = p;
    if (c.estado === "bajada") decodificar(c);
    return false;
  } catch (e) {
    caer(e);
    return false;
  }
}

/** `true` mientras la pista es la música del sorteo: el secuenciador de osciladores no arma nada. */
export function pistaSuena(): boolean {
  try {
    return vigente?.suena() ?? false;
  } catch {
    return false;
  }
}

/** La tensión de una línea del relator. `true` si la tomó la pista. */
export function pistaTension(calor: number, nivel: number): boolean {
  if (!vigente?.suena()) return false;
  try {
    vigente.tension(calor, nivel);
    return true;
  } catch (e) {
    caer(e);
    return false;
  }
}

/** El juego corta (`true`) o suelta (`false`) la música. */
export function pistaRetener(si: boolean): void {
  // Una pista que no llegó a tiempo no entra en medio de la mecánica del juego.
  soltarPendiente();
  if (!vigente) return;
  try {
    vigente.retener(si);
  } catch (e) {
    caer(e);
  }
}

/** El ganador. `true` si la pista toca el golpe y el festejo: entonces no suena otro remate ni otra fanfarria. */
export function pistaRemata(): boolean {
  soltarPendiente();
  if (!vigente) return false;
  try {
    return vigente.rematar();
  } catch (e) {
    caer(e);
    return false;
  }
}

/** La música termina: `rapido` con el sonido o la música apagados; si no, el festejo se apaga con su salida. */
export function pistaParar(rapido: boolean): void {
  soltarPendiente();
  const r = vigente;
  vigente = null;
  sesion = null;
  if (!r) return;
  try {
    r.parar(rapido);
  } catch {
    /* que se apague como pueda */
  }
  // En el festejo la pista sigue sonando hasta que termina su salida (hasta 6 s): queda a mano para callarla.
  saliente = rapido ? null : r;
}

/**
 * Calla en 0,1 s la cola del festejo que sigue sonando después de terminado el show. La llaman el botón de sonido, el de
 * música y el sorteo siguiente (con pista o sin ella): sin esto, ninguno de los tres la alcanzaba.
 */
export function pistaCallar(): void {
  const r = saliente;
  saliente = null;
  try {
    r?.callar();
  } catch {
    /* que se apague como pueda */
  }
}

/* ------------------------------------------------------------------ pruebas y auditores */

/** Lo que se sabe de las pistas en esta pestaña. */
export function estadoDePistas(): {
  modo: ModoMusica;
  juego: string | null;
  cargas: Record<string, Estado>;
  /** Cuántos avisos esperan a que una carga esté lista: en reposo, ninguno. */
  avisos: number;
  suena: boolean;
  registro: { t: number; que: string }[];
} {
  const out: Record<string, Estado> = {};
  let avisos = 0;
  for (const [j, c] of cargas) {
    out[j] = c.estado;
    avisos += c.avisar.length;
  }
  return { modo: cfg().modo, juego: juegoActual, cargas: out, avisos, suena: pistaSuena(), registro: [...registro] };
}

function exponer(): void {
  try {
    (window as unknown as { __tinkazoPista?: () => unknown }).__tinkazoPista = estadoDePistas;
  } catch {
    /* sin página */
  }
}

/** Para las pruebas: vuelve a empezar, con la configuración que se pida. */
export function reiniciarPistas(c: Partial<Config> & { tocado?: boolean } = {}): void {
  config = null;
  const { tocado: t, ...resto } = c;
  if (Object.keys(resto).length) config = { modo: "sintetizada", host: "", busqueda: "", auditar: false, ...resto };
  tocado = t ?? false;
  juegoActual = null;
  ctxConocido = null;
  cargas.clear();
  vigente = null;
  saliente = null;
  sesion = null;
  soltarPendiente();
  registro.length = 0;
}

/** Para las pruebas: una pista ya decodificada, como si hubiera bajado. */
export function ponerPistaLista(juego: string, pista: Pista, buffers: Buffers, corrimientos: Corrimientos = {}): void {
  cargas.set(juego, { juego, estado: "lista", pista, bytes: {}, buffers, corrimientos, intentos: 1, definitivo: false, avisar: [], ctl: null });
}
