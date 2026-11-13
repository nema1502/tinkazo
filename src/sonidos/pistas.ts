/**
 * Las pistas de música por secciones.
 *
 * Una pista es la música de un juego grabada en archivos y cortada en secciones que el show encadena:
 *
 * - la **entrada**, que suena una vez desde la tarjeta de cómo se juega;
 * - el **cuerpo**, un bucle de compases enteros que se repite sin costura todo lo que dure el juego (con dos personas
 *   dura diez segundos, con doscientas más de un minuto);
 * - la **subida**, que entra en un borde de compás cuando el relator pide tensión y después repite sus últimos compases;
 * - el **golpe** del ganador, que suena en el instante en que se corona, después del silencio corto que pide el juego;
 * - y el **festejo**, que sigue debajo del cartel y se apaga solo.
 *
 * Los pedidos son los mismos que recibe la música de osciladores (`src/music.ts`): la tensión de cada línea del relator,
 * retener y soltar la música (la mecánica de algunos juegos), el remate y parar. Ningún juego sabe que existe.
 *
 * Este módulo no toca la página ni la red: recibe el contexto de audio, la salida y los archivos ya decodificados (los
 * baja `pistas-enganche.ts`). Todas las horas salen del reloj del audio y de los pedidos del show, nunca del azar ni del
 * reloj de la página: la misma ronda suena igual y el reproductor no sabe quién gana. Suenan dos fuentes a la vez como
 * mucho (las dos de un fundido), y cada una se suelta del grafo cuando termina.
 */

export const SECCIONES = ["entrada", "cuerpo", "subida", "golpe", "festejo"] as const;
export type NombreSeccion = (typeof SECCIONES)[number];

/** Una sección, ya leída y con sus valores por defecto. */
export interface Seccion {
  /** El archivo, relativo a la base de donde se bajan las pistas: hasta 32 letras minúsculas, números o guiones y `.mp3`. */
  archivo: string;
  /** El segundo del archivo donde cae el primer tiempo de la sección. Lo que hay antes es el colchón del fundido. */
  inicio: number;
  /** Cuántos compases dura. La entrada, el cuerpo y la subida lo dicen siempre; el golpe, si hay festejo. */
  compases: number | null;
  /** Desde qué compás de la sección se repite: el cuerpo y la subida. `null` en las que suenan una vez. */
  bucleDesde: number | null;
  /** Los segundos del fundido con que entra la sección (y sale la anterior). */
  fundido: number;
  /** Cuánto suena la sección: 1 es el archivo tal cual. */
  ganancia: number;
  /** Solo la subida: desde qué tensión del relator entra (de 0 a 1). */
  tension: number;
  /** Solo la subida: cada cuántos compases puede entrar. */
  cuantizar: number;
  /** El festejo (o el golpe sin festejo): cuánto tarda en apagarse si el show termina antes que el archivo. */
  salida: number;
}

/** Una pista leída y comprobada (`leerPista`). */
export interface Pista {
  formato: 1;
  juego: string;
  /** Va en el nombre de los archivos: el servicio los entrega como inmutables, así que una pista nueva lleva otra versión. */
  version: string;
  /** Segundos por compás: el del bucle medido, si el JSON lo trae, o el que sale del pulso. */
  compas: number;
  /** Cuántos tiempos tiene un compás. */
  tiempos: number;
  /** El volumen de toda la pista en la salida. */
  ganancia: number;
  /** Dónde vuelve la música cuando el juego la suelta: en el uno del compás siguiente o en el tiempo siguiente. */
  retomarEn: "compas" | "tiempo";
  /** Si una sorpresa del relator (un salto de tensión) calla la música un tiempo, como la de osciladores. */
  sorpresas: boolean;
  secciones: { [K in NombreSeccion]?: Seccion } & { cuerpo: Seccion; golpe: Seccion };
}

/* ------------------------------------------------------------------ leer el JSON */

const ARCHIVO = /^[a-z0-9-]{1,32}\.mp3$/;
const VERSION = /^[a-z0-9]{1,8}$/;
/**
 * Lo más que puede sonar una sección sobre su archivo: la ganancia de la pista por la de la sección. La salida de la pista no
 * pasa por un compresor, así que un error de tipeo en el JSON (un 2 por un 0,2) saturaría la pantalla grande del evento.
 */
const GANANCIA_MAXIMA = 1.5;

type Objeto = Record<string, unknown>;
const esObjeto = (x: unknown): x is Objeto => typeof x === "object" && x !== null && !Array.isArray(x);

/** Un número dentro de [min, max], o el valor por defecto si no vino. `NaN` si vino y no sirve. */
function numero(x: unknown, min: number, max: number, defecto?: number): number {
  if (x === undefined && defecto !== undefined) return defecto;
  return typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : NaN;
}

/** Un entero dentro de [min, max], o `null` si no vino. `NaN` si vino y no sirve. */
function entero(x: unknown, min: number, max: number): number | null {
  if (x === undefined) return null;
  return typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : NaN;
}

function leerSeccion(nombre: NombreSeccion, x: unknown, fundido: number, hayFestejo: boolean): Seccion | null {
  if (!esObjeto(x) || typeof x.archivo !== "string" || !ARCHIVO.test(x.archivo)) return null;
  const compases = entero(x.compases, 1, 256);
  const bucleDesde = entero(x.bucleDesde, 0, 255);
  const s: Seccion = {
    archivo: x.archivo,
    inicio: numero(x.inicio, 0, 5),
    compases,
    bucleDesde,
    // El golpe arranca casi seco: con el fundido de las demás se le ablandaría el ataque.
    fundido: numero(x.fundido, 0.002, 0.2, nombre === "golpe" ? 0.005 : fundido),
    ganancia: numero(x.ganancia, 0, 4, 1),
    tension: numero(x.tension, 0, 1, 0.75),
    cuantizar: entero(x.cuantizar, 1, 16) ?? 1,
    salida: numero(x.salida, 0.05, 6, 1.5),
  };
  if ([s.inicio, s.fundido, s.ganancia, s.tension, s.cuantizar, s.salida].some(Number.isNaN)) return null;
  if (Number.isNaN(compases as number) || Number.isNaN(bucleDesde as number)) return null;
  const necesitaCompases = nombre === "entrada" || nombre === "cuerpo" || nombre === "subida" || (nombre === "golpe" && hayFestejo);
  if (necesitaCompases && compases === null) return null;
  // El cuerpo y la subida siempre se repiten (desde el compás 0 si no dice otro); la entrada, el golpe y el festejo, nunca.
  if (nombre === "cuerpo" || nombre === "subida") {
    s.bucleDesde = bucleDesde ?? 0;
    if (s.bucleDesde >= (compases as number)) return null;
  } else if (bucleDesde !== null) return null;
  return s;
}

/**
 * Lee el JSON de una pista y lo comprueba. Devuelve `null` si algo no cierra: entonces suena la música de siempre.
 * El formato, con un ejemplo, está escrito junto a las pistas (FORMATO.md de quien las arma).
 */
export function leerPista(x: unknown, juego: string): Pista | null {
  if (!esObjeto(x) || x.formato !== 1 || x.juego !== juego) return null;
  if (typeof x.version !== "string" || !VERSION.test(x.version)) return null;
  const pulso = x.pulso;
  if (!esObjeto(pulso)) return null;
  const bpm = numero(pulso.bpm, 30, 260);
  const tiempos = entero(pulso.tiempos, 1, 12);
  if (Number.isNaN(bpm) || tiempos === null || Number.isNaN(tiempos)) return null;
  const nominal = (60 / bpm) * tiempos;
  const compas = numero(pulso.compas, nominal * 0.97, nominal * 1.03, nominal);
  const ganancia = numero(x.ganancia, 0, 2, 0.5);
  const fundido = numero(x.fundido, 0.005, 0.2, 0.03);
  if ([compas, ganancia, fundido].some(Number.isNaN)) return null;
  const retomarEn = x.retomarEn === undefined ? "compas" : x.retomarEn;
  if (retomarEn !== "compas" && retomarEn !== "tiempo") return null;
  const sorpresas = x.sorpresas === undefined ? true : x.sorpresas;
  if (typeof sorpresas !== "boolean") return null;
  if (!esObjeto(x.secciones)) return null;
  const crudas = x.secciones;
  // Una clave que no es una sección es un error de quien arma la pista: mejor no sonar que sonar a medias.
  if (Object.keys(crudas).some((k) => !(SECCIONES as readonly string[]).includes(k))) return null;
  const secciones: { [K in NombreSeccion]?: Seccion } = {};
  for (const nombre of SECCIONES) {
    if (crudas[nombre] === undefined) continue;
    const s = leerSeccion(nombre, crudas[nombre], fundido, crudas.festejo !== undefined);
    if (!s || ganancia * s.ganancia > GANANCIA_MAXIMA) return null;
    secciones[nombre] = s;
  }
  const { cuerpo, golpe } = secciones;
  if (!cuerpo || !golpe) return null;
  return { formato: 1, juego, version: x.version, compas, tiempos, ganancia, retomarEn, sorpresas, secciones: { ...secciones, cuerpo, golpe } };
}

/** Los archivos decodificados, uno por sección. */
export type Buffers = { [K in NombreSeccion]?: AudioBuffer };

/**
 * Cuánto corrió el navegador el audio de cada archivo hacia adelante al decodificarlo, en segundos (ver `pistas-mp3.ts`).
 * En Chrome y Firefox es cero y no figura. Se suma al inicio de la sección: el primer tiempo cae ahí.
 */
export type Corrimientos = { [K in NombreSeccion]?: number };

/** El segundo del archivo donde cae el primer tiempo de la sección, con el corrimiento de la decodificación. */
const inicioDe = (s: Seccion, corr: Corrimientos, nombre: NombreSeccion): number => s.inicio + (corr[nombre] ?? 0);

/** Lo que dura la parte musical de una sección (sin el colchón de antes ni la cola de después), en segundos. */
function largoDe(p: Pista, s: Seccion, b: AudioBuffer, inicio: number): number {
  return s.compases !== null ? s.compases * p.compas : Math.max(0, b.duration - inicio);
}

/**
 * `true` si cada archivo alcanza para lo que la pista dice de él. Un bucle necesita cola después de su último compás:
 * un decodificador que corre el audio unos milisegundos no tiene que dejar el empalme fuera del archivo.
 */
export function buffersAlcanzan(p: Pista, b: Buffers, corr: Corrimientos = {}): boolean {
  for (const nombre of SECCIONES) {
    const s = p.secciones[nombre];
    if (!s) continue;
    const buf = b[nombre];
    const inicio = inicioDe(s, corr, nombre);
    if (!buf || !(buf.duration > inicio + 0.05)) return false;
    if (s.compases === null) continue;
    const fin = inicio + s.compases * p.compas;
    if (s.bucleDesde !== null ? fin + 0.02 > buf.duration : fin > buf.duration + 0.02) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ el reproductor */

/** Una sección lista para sonar: su archivo y sus medidas en segundos. */
interface Lista {
  nombre: NombreSeccion;
  buffer: AudioBuffer;
  inicio: number;
  largo: number;
  /** El tramo que se repite, en segundos desde el primer tiempo de la sección. */
  bucle: { desde: number; hasta: number } | null;
  fundido: number;
  ganancia: number;
}

/** Una fuente que suena (o va a sonar) con su ganancia propia. */
interface Voz {
  sec: Lista;
  src: AudioBufferSourceNode;
  g: GainNode;
  /** La hora del audio en que cae el primer tiempo de la sección (la posición 0). Con la sección retomada, la que tendría. */
  t0: number;
  /** Cuándo arranca la fuente, y cuándo termina su fundido de entrada. */
  arranque: number;
  lleno: number;
  /** Cuándo deja de sonar: el final del archivo o la hora de su fundido de salida. */
  fin: number;
  /** Cuándo termina el archivo (en un bucle, nunca). */
  finArchivo: number;
}

/** En qué está la música. */
type Fase = "lista" | "musica" | "retenida" | "remate" | "parada";

/** Lo que tarda en apagarse todo cuando se para la música en medio del juego: lo mismo que la de osciladores. */
const PARADA_RAPIDA = 0.35;
/** Lo que tarda en callarse todo cuando la persona apaga el sonido o la música, o empieza otro sorteo encima de la cola del festejo. */
const CALLAR = 0.1;
/** Lo que se adelanta el primer sonido respecto de la hora del pedido: lo que tarda en llegar al hilo del audio. */
const ADELANTO = 0.06;
/** Lo mínimo que tiene que quedar entre la hora de ahora y un fundido que se programa. */
const MARGEN = 0.02;

/** El reproductor de una pista en un sorteo. Uno por sorteo: al terminar se tira. */
export class Reproductor {
  private readonly secs: { [K in NombreSeccion]?: Lista } & { cuerpo: Lista; golpe: Lista };
  private readonly corte: GainNode;
  private readonly salida: GainNode;
  private readonly vivas = new Set<Voz>();
  private fase: Fase = "lista";
  /** `true` cuando `callar` ya bajó el volumen de toda la pista. */
  private callada = false;
  private actual: Voz | null = null;
  private proxima: Voz | null = null;
  private quiereSubida = false;
  private retenida: { sec: NombreSeccion; pos: number } | null = null;
  /** Hasta cuándo calla una sorpresa. */
  private calladaHasta = -1;

  constructor(
    private readonly ctx: BaseAudioContext,
    destino: AudioNode,
    private readonly pista: Pista,
    buffers: Buffers,
    private readonly anotar: (que: string, t: number) => void = () => undefined,
    corrimientos: Corrimientos = {},
  ) {
    const lista = (nombre: NombreSeccion): Lista | undefined => {
      const s = pista.secciones[nombre];
      const b = buffers[nombre];
      if (!s || !b) return undefined;
      // Un navegador que no recorta el silencio del codificador corre el audio: todos los puntos de la sección se corren lo mismo,
      // y el bucle sigue tomando el final de su último compás y no un trozo del colchón.
      const inicio = inicioDe(s, corrimientos, nombre);
      const largo = largoDe(pista, s, b, inicio);
      const bucle = s.bucleDesde !== null ? { desde: s.bucleDesde * pista.compas, hasta: largo } : null;
      return { nombre, buffer: b, inicio, largo, bucle, fundido: s.fundido, ganancia: s.ganancia };
    };
    const cuerpo = lista("cuerpo");
    const golpe = lista("golpe");
    if (!cuerpo || !golpe) throw new Error("la pista no trae cuerpo o golpe");
    this.secs = { entrada: lista("entrada"), cuerpo, subida: lista("subida"), golpe, festejo: lista("festejo") };
    // Fuente, su ganancia, el corte de las sorpresas, el volumen de la pista y la salida de la mezcla.
    this.corte = ctx.createGain();
    this.salida = ctx.createGain();
    this.salida.gain.value = pista.ganancia;
    this.corte.connect(this.salida);
    this.salida.connect(destino);
  }

  /** `true` mientras la pista es la música del sorteo (también callada por el juego y en el festejo). */
  suena(): boolean {
    return this.fase === "musica" || this.fase === "retenida" || this.fase === "remate";
  }

  /** Arranca por la entrada (o por el cuerpo, si la pista no tiene entrada). */
  arrancar(): void {
    if (this.fase !== "lista") return;
    const T = this.ctx.currentTime + ADELANTO;
    const primera = this.secs.entrada ?? this.secs.cuerpo;
    this.fase = "musica";
    this.actual = this.voz(primera, T, 0, primera.fundido);
    this.encadenar();
  }

  /**
   * Lo que dice el relator, con su tensión de 0 a 1, y la tensión que venía sonando. Un salto grande es una sorpresa: la
   * música calla un tiempo y vuelve en el tiempo siguiente. Desde la tensión de la subida, la subida entra en el próximo
   * borde de compás (o al terminar la entrada) y ya no se vuelve al cuerpo.
   */
  tension(calor: number, nivel: number): void {
    if (this.fase !== "musica") {
      // Callada por el juego: la subida entra cuando la suelte.
      if (this.fase === "retenida" && this.secs.subida && calor >= (this.pista.secciones.subida?.tension ?? 1)) this.quiereSubida = true;
      return;
    }
    this.avanzar();
    if (this.pista.sorpresas && calor - nivel >= 0.3) this.sorpresa();
    const sub = this.secs.subida;
    const umbral = this.pista.secciones.subida?.tension ?? 1;
    if (!sub || this.quiereSubida || calor < umbral) return;
    this.quiereSubida = true;
    const ahora = this.ctx.currentTime;
    const p = this.proxima;
    // La entrada todavía no dio paso al cuerpo: la subida va en su lugar, al terminar la entrada.
    if (p && p.sec.nombre === "cuerpo" && p.arranque > ahora + MARGEN) {
      this.cambiarA(sub, p.t0);
      return;
    }
    const base = p ?? this.actual;
    if (!base || base.sec.nombre === "subida") return;
    this.cambiarA(sub, this.borde(base, (this.pista.secciones.subida?.cuantizar ?? 1) * this.pista.compas, sub.fundido));
  }

  /** El juego corta la música en seco (`true`) o la suelta (`false`): vuelve en el uno del compás siguiente. */
  retener(si: boolean): void {
    const ahora = this.ctx.currentTime;
    if (si) {
      if (this.fase !== "musica") return;
      this.avanzar();
      const base = this.actual;
      const pos = base ? Math.max(0, ahora - base.t0) : 0;
      // En seco: 25 ms, como la de osciladores. Un corte con cola no se oye como corte.
      this.apagarTodas(ahora + 0.025, 0.02);
      this.soltarCorte(ahora + 0.03);
      this.retenida = { sec: base?.sec.nombre ?? "cuerpo", pos };
      this.actual = this.proxima = null;
      this.fase = "retenida";
      this.anotar(`retiene ${this.retenida.sec} ${pos.toFixed(3)}`, ahora);
      return;
    }
    if (this.fase !== "retenida" || !this.retenida) return;
    const { sec: nombre, pos } = this.retenida;
    this.retenida = null;
    const sub = this.secs.subida;
    let sec = this.secs[nombre] ?? this.secs.cuerpo;
    let p: number;
    if (this.quiereSubida && sub && sec !== sub) {
      sec = sub;
      p = 0;
    } else {
      const u = this.pista.retomarEn === "tiempo" ? this.pista.compas / this.pista.tiempos : this.pista.compas;
      p = Math.ceil(pos / u - 1e-6) * u;
      if (!sec.bucle && p >= sec.largo - 1e-6) {
        sec = this.quiereSubida && sub ? sub : this.secs.cuerpo;
        p = 0;
      }
    }
    this.fase = "musica";
    // Vuelve ya, con un fundido de 10 ms que termina justo en el uno.
    this.actual = this.voz(sec, ahora + 0.03, p, 0.01);
    this.encadenar();
    this.anotar(`suelta ${sec.nombre} ${p.toFixed(3)}`, ahora);
  }

  /**
   * El ganador: el golpe en este instante y el festejo detrás. Devuelve `true` si la pista se hizo cargo del final
   * (entonces no suena otro), también si ya lo había hecho.
   */
  rematar(): boolean {
    if (this.fase === "remate") return true;
    if (this.fase !== "musica" && this.fase !== "retenida") return false;
    const ahora = this.ctx.currentTime;
    const T = ahora + MARGEN;
    this.apagarTodas(T + 0.01, 0.02);
    this.soltarCorte(T - 0.01);
    this.retenida = null;
    this.fase = "remate";
    const golpe = this.secs.golpe;
    this.actual = this.voz(golpe, T, 0, golpe.fundido);
    this.proxima = null;
    const fest = this.secs.festejo;
    if (fest) {
      const B = T + golpe.largo;
      this.proxima = this.voz(fest, B, 0, fest.fundido);
      this.apagar(this.actual, B, fest.fundido);
    }
    return true;
  }

  /**
   * La música termina. En medio del juego (o con el sonido apagado: `rapido`) baja en 0,35 s; en el festejo, que suena
   * debajo del cartel, se apaga con su propia salida.
   */
  parar(rapido: boolean): void {
    if (this.fase === "parada") return;
    const ahora = this.ctx.currentTime;
    const enFestejo = !rapido && this.fase === "remate";
    const seccion = this.pista.secciones.festejo ?? this.pista.secciones.golpe;
    const largo = enFestejo ? seccion.salida : PARADA_RAPIDA;
    this.fase = "parada";
    this.actual = this.proxima = null;
    for (const v of [...this.vivas]) {
      if (v.arranque > ahora) this.matar(v);
      else if (v.fin > ahora) {
        // Lo que todavía suena se apaga en `largo`, aunque tuviera otra hora: si el festejo no llegó a entrar, la cola
        // del golpe no se corta en el borde donde iba a entrar.
        const X = Math.min(ahora + largo, v.finArchivo);
        if (X > ahora + 0.005) this.apagar(v, X, X - ahora, true);
      }
    }
    this.anotar(`para ${enFestejo ? "festejo" : "rapido"}`, ahora);
    if (this.vivas.size === 0) this.soltar();
  }

  /**
   * Calla todo en 0,1 s, esté en la fase que esté, también cuando ya se había pedido parar y el festejo seguía sonando con su
   * propia salida (hasta 6 s): el botón de sonido o de música, o un sorteo nuevo que arranca encima. El volumen de la pista entera
   * baja a cero, así que no importa en qué punto de su propio fundido estaba cada voz.
   */
  callar(): void {
    if (this.callada) return;
    this.callada = true;
    const ahora = this.ctx.currentTime;
    this.fase = "parada";
    this.actual = this.proxima = null;
    const g = this.salida.gain;
    g.cancelScheduledValues(ahora);
    g.setValueAtTime(this.pista.ganancia, ahora);
    g.linearRampToValueAtTime(0, ahora + CALLAR);
    for (const v of [...this.vivas]) {
      if (v.arranque > ahora) this.matar(v);
      else {
        // Que pare apenas termine la bajada, sin esperar al final de su propio festejo.
        const X = Math.min(v.fin + 0.02, ahora + CALLAR + 0.02);
        try {
          v.src.stop(X);
        } catch {
          /* ya parada */
        }
        v.fin = Math.min(v.fin, X);
      }
    }
    this.anotar("calla", ahora);
    if (this.vivas.size === 0) this.soltar();
  }

  /* ------------------------------------------------------------------ por dentro */

  /** Si la sección que venía programada ya entró, pasa a ser la actual. */
  private avanzar(): void {
    const p = this.proxima;
    if (p && this.ctx.currentTime >= p.t0 - p.sec.fundido) {
      this.actual = p;
      this.proxima = null;
    }
  }

  /** Si la actual suena una vez (la entrada), programa lo que viene cuando termina: el cuerpo, o la subida si ya se pidió. */
  private encadenar(): void {
    const a = this.actual;
    if (!a || a.sec.bucle || this.fase !== "musica") return;
    const sub = this.secs.subida;
    const sig = this.quiereSubida && sub ? sub : this.secs.cuerpo;
    this.cambiarA(sig, a.t0 + a.sec.largo);
  }

  /** El próximo borde de `paso` segundos de la voz `v` en el que todavía entra un fundido de `f`. */
  private borde(v: Voz, paso: number, f: number): number {
    const desde = this.ctx.currentTime + MARGEN + f;
    const k = Math.max(v.arranque <= this.ctx.currentTime + MARGEN ? 1 : 0, Math.ceil((desde - v.t0) / paso - 1e-9));
    return v.t0 + k * paso;
  }

  /** Programa la sección `sec` con su primer tiempo en `B`: lo que suena se apaga en el fundido y lo que no llegó a sonar se tira. */
  private cambiarA(sec: Lista, B: number): void {
    const f = sec.fundido;
    let previa: Voz | null = null;
    for (const v of [...this.vivas]) {
      if (v.arranque >= B - f) this.matar(v);
      else {
        this.apagar(v, B, f);
        if (!previa || v.arranque > previa.arranque) previa = v;
      }
    }
    // La última que arrancó sigue siendo la actual hasta que entre la nueva.
    const nueva = this.voz(sec, B, 0, f);
    this.actual = previa ?? nueva;
    this.proxima = previa ? nueva : null;
    this.anotar(`programa ${sec.nombre}`, B);
  }

  /** Apaga todo lo que suena con un fundido que termina en `X`, y tira lo que todavía no sonó. */
  private apagarTodas(X: number, f: number): void {
    for (const v of [...this.vivas]) this.apagar(v, X, f);
  }

  /** Una sorpresa: la música calla ya y vuelve en el tiempo que cae un tiempo después. */
  private sorpresa(): void {
    const v = this.actual ?? this.proxima;
    if (!v) return;
    const ahora = this.ctx.currentTime;
    const tiempo = this.pista.compas / this.pista.tiempos;
    const vuelve = v.t0 + Math.ceil((ahora + tiempo - v.t0) / tiempo - 1e-9) * tiempo;
    const g = this.corte.gain;
    g.cancelScheduledValues(ahora);
    g.setValueAtTime(this.calladaHasta > ahora ? 0 : 1, ahora);
    g.linearRampToValueAtTime(0, ahora + 0.03);
    g.setValueAtTime(0, Math.max(ahora + 0.03, vuelve - 0.01));
    g.linearRampToValueAtTime(1, Math.max(ahora + 0.04, vuelve));
    this.calladaHasta = vuelve;
    this.anotar("sorpresa", ahora);
  }

  /** Termina una sorpresa que estuviera callando la música: el corte vuelve a 1 en `t`. */
  private soltarCorte(t: number): void {
    if (this.calladaHasta < 0) return;
    const g = this.corte.gain;
    const ahora = this.ctx.currentTime;
    g.cancelScheduledValues(ahora);
    g.setValueAtTime(this.calladaHasta > ahora ? 0 : 1, ahora);
    g.setValueAtTime(1, Math.max(ahora, t));
    this.calladaHasta = -1;
  }

  /** La posición `p` (segundos desde el primer tiempo) de una sección, en segundos de su archivo: el bucle da la vuelta. */
  private offsetDe(sec: Lista, p: number): number {
    const b = sec.bucle;
    let q = p;
    if (b && q >= b.hasta) q = b.desde + ((q - b.desde) % (b.hasta - b.desde));
    return sec.inicio + q;
  }

  /**
   * Una fuente de la sección `sec` que a la hora `T` está en la posición `p`, con un fundido de entrada de `f` segundos
   * que termina en `T`: el primer tiempo llega entero. Si el archivo no tiene colchón antes, el fundido va después.
   */
  private voz(sec: Lista, T: number, p: number, f: number): Voz {
    const ctx = this.ctx;
    const off = this.offsetDe(sec, p);
    let arranque = T - f;
    let desde = off - f;
    // A la hora `cae` suena la posición `p`: es la que fija la grilla de compases de la voz.
    let cae = T;
    if (desde < 0 || arranque < ctx.currentTime) {
      arranque = Math.max(T, ctx.currentTime);
      desde = off;
      cae = arranque;
    }
    const src = ctx.createBufferSource();
    src.buffer = sec.buffer;
    if (sec.bucle) {
      src.loop = true;
      src.loopStart = sec.inicio + sec.bucle.desde;
      src.loopEnd = sec.inicio + sec.bucle.hasta;
    }
    // Para los auditores de sonido: es música, y de qué sección.
    Object.assign(src, { __musica: true, __pista: `${this.pista.juego}/${sec.nombre}` });
    const g = ctx.createGain();
    const lleno = arranque + f;
    g.gain.value = 0;
    g.gain.setValueAtTime(0, arranque);
    g.gain.linearRampToValueAtTime(sec.ganancia, lleno);
    src.connect(g);
    g.connect(this.corte);
    const finArchivo = sec.bucle ? Infinity : arranque + (sec.buffer.duration - desde);
    const v: Voz = { sec, src, g, t0: cae - p, arranque, lleno, fin: finArchivo, finArchivo };
    src.onended = (): void => this.fuera(v);
    src.start(arranque, desde);
    this.vivas.add(v);
    this.anotar(`suena ${sec.nombre} desde ${desde.toFixed(3)}`, arranque);
    return v;
  }

  /** El volumen que tiene la voz en la hora `t`, antes de cualquier fundido de salida. */
  private nivelEn(v: Voz, t: number): number {
    if (t >= v.lleno) return v.sec.ganancia;
    if (t <= v.arranque) return 0;
    return (v.sec.ganancia * (t - v.arranque)) / Math.max(1e-6, v.lleno - v.arranque);
  }

  /** Apaga la voz con un fundido que termina en `X` y dura `f` (o lo que quede). `forzar` puede alargarle la vida. */
  private apagar(v: Voz, X: number, f: number, forzar = false): void {
    const ahora = this.ctx.currentTime;
    if (v.arranque > ahora && X - f <= v.arranque) {
      this.matar(v);
      return;
    }
    // Ya termina antes: no se le alarga la vida.
    if (v.fin <= X && !forzar) return;
    const u = Math.max(X - f, ahora);
    const fin = Math.max(X, u + 0.005);
    const g = v.g.gain;
    g.cancelScheduledValues(u);
    g.setValueAtTime(this.nivelEn(v, u), u);
    g.linearRampToValueAtTime(0, fin);
    try {
      v.src.stop(fin + 0.02);
    } catch {
      /* ya parada */
    }
    v.fin = forzar ? fin : Math.min(v.fin, fin);
  }

  /** Tira una voz que no llegó a sonar. */
  private matar(v: Voz): void {
    v.src.onended = null;
    try {
      v.src.stop();
    } catch {
      /* ya parada */
    }
    this.fuera(v);
  }

  /** Una voz que terminó: se suelta del grafo. */
  private fuera(v: Voz): void {
    if (!this.vivas.delete(v)) return;
    try {
      v.src.disconnect();
      v.g.disconnect();
    } catch {
      /* ya soltada */
    }
    if (this.actual === v) this.actual = null;
    if (this.proxima === v) this.proxima = null;
    if (this.fase === "parada" && this.vivas.size === 0) this.soltar();
  }

  private soltar(): void {
    try {
      this.corte.disconnect();
      this.salida.disconnect();
    } catch {
      /* ya soltada */
    }
  }

  /** Para las pruebas y los auditores: cuántas fuentes de la pista siguen en el grafo. */
  fuentesVivas(): number {
    return this.vivas.size;
  }
}
