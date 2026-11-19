/**
 * Un contexto de audio de mentira para las pruebas: no suena, anota todo y sabe cuánto vale cada ganancia en cada
 * instante (con `setValueAtTime`, `linearRampToValueAtTime` y `cancelScheduledValues`, como el de verdad). La hora la
 * mueve la prueba (`ctx.currentTime = 12`). Alcanza para el reproductor de pistas y para armar la banda de osciladores
 * de `src/music.ts`: cualquier nodo que no conoce lo arma igual, con sus parámetros a pedido.
 */

interface Evento {
  t: number;
  v: number;
  tipo: "fijo" | "rampa";
}

/** Un parámetro de audio que se puede evaluar en cualquier hora. */
export class ParamFalso {
  ev: Evento[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number): this {
    this.poner({ t, v, tipo: "fijo" });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.poner({ t, v, tipo: "rampa" });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    return this.linearRampToValueAtTime(v, t);
  }
  setTargetAtTime(v: number, t: number): this {
    return this.setValueAtTime(v, t);
  }
  setValueCurveAtTime(c: Float32Array, t: number, d: number): this {
    this.poner({ t, v: c[0] ?? 0, tipo: "fijo" });
    this.poner({ t: t + d, v: c[c.length - 1] ?? 0, tipo: "rampa" });
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.ev = this.ev.filter((e) => e.t < t);
    return this;
  }
  private poner(e: Evento): void {
    // Ordenados por hora; a la misma hora, en el orden en que se pidieron.
    let i = this.ev.length;
    while (i > 0 && (this.ev[i - 1] as Evento).t > e.t) i--;
    this.ev.splice(i, 0, e);
  }
  /** Lo que vale en la hora `t`. */
  en(t: number): number {
    let pt = -Infinity;
    let pv = this.value;
    for (const e of this.ev) {
      if (e.t > t) {
        if (e.tipo === "rampa" && Number.isFinite(pt)) return pv + ((e.v - pv) * (t - pt)) / Math.max(1e-9, e.t - pt);
        return pv;
      }
      pt = e.t;
      pv = e.v;
    }
    return pv;
  }
}

const PARAMETROS = new Set(["gain", "frequency", "Q", "detune", "pan", "threshold", "ratio", "attack", "release", "knee", "playbackRate"]);

export interface NodoFalso {
  tipo: string;
  conectado: unknown[];
  desconectado: boolean;
  connect(n: unknown): unknown;
  disconnect(): void;
  [k: string]: unknown;
}

export interface FuenteFalsa extends NodoFalso {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  inicio: { cuando: number; desde: number } | null;
  parada: number | null;
  onended: (() => void) | null;
  __musica?: boolean;
  __pista?: string;
}

/** El contexto de mentira. */
export class ContextoFalso {
  currentTime = 0;
  state = "running";
  sampleRate = 48000;
  readonly destination = this.nodo("destino");
  readonly nodos: NodoFalso[] = [];
  readonly fuentes: FuenteFalsa[] = [];
  readonly escuchas: Record<string, (() => void)[]> = {};

  nodo(tipo: string): NodoFalso {
    const base: NodoFalso = {
      tipo,
      context: this,
      conectado: [],
      desconectado: false,
      connect(n: unknown): unknown {
        base.conectado.push(n);
        return n;
      },
      disconnect(): void {
        base.desconectado = true;
      },
    };
    const p = new Proxy(base, {
      get(o, k) {
        if (typeof k === "string" && !(k in o) && PARAMETROS.has(k)) o[k] = new ParamFalso(k === "gain" ? 1 : 0);
        return o[k as string];
      },
    });
    this.nodos?.push(p);
    return p;
  }

  createGain(): GainNode {
    return this.nodo("ganancia") as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const ctx = this;
    const f = this.nodo("fuente") as FuenteFalsa;
    Object.assign(f, { buffer: null, loop: false, loopStart: 0, loopEnd: 0, inicio: null, parada: null, onended: null });
    f.start = (cuando = 0, desde = 0): void => {
      if (f.inicio) throw new Error("InvalidStateError: ya arrancó");
      f.inicio = { cuando, desde };
    };
    f.stop = (cuando?: number): void => {
      f.parada = cuando ?? ctx.currentTime;
    };
    this.fuentes.push(f);
    return f as unknown as AudioBufferSourceNode;
  }

  createOscillator(): OscillatorNode {
    const o = this.nodo("oscilador");
    o.start = (): void => undefined;
    o.stop = (): void => undefined;
    return o as unknown as OscillatorNode;
  }

  createBuffer(canales: number, largo: number, sr: number): AudioBuffer {
    return bufferFalso(largo / sr, canales, sr);
  }

  createBiquadFilter(): BiquadFilterNode {
    return this.nodo("filtro") as unknown as BiquadFilterNode;
  }
  createDynamicsCompressor(): DynamicsCompressorNode {
    return this.nodo("compresor") as unknown as DynamicsCompressorNode;
  }
  createWaveShaper(): WaveShaperNode {
    return this.nodo("techo") as unknown as WaveShaperNode;
  }
  createConvolver(): ConvolverNode {
    return this.nodo("sala") as unknown as ConvolverNode;
  }
  createStereoPanner(): StereoPannerNode {
    return this.nodo("paneo") as unknown as StereoPannerNode;
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  addEventListener(tipo: string, fn: () => void): void {
    (this.escuchas[tipo] ??= []).push(fn);
  }
  removeEventListener(tipo: string, fn: () => void): void {
    this.escuchas[tipo] = (this.escuchas[tipo] ?? []).filter((x) => x !== fn);
  }

  /** Decodifica lo que diga la prueba: `decodificar` devuelve el buffer o lanza. */
  decodificar: (ab: ArrayBuffer) => AudioBuffer = () => bufferFalso(10);
  decodeAudioData(ab: ArrayBuffer): Promise<AudioBuffer> {
    try {
      return Promise.resolve(this.decodificar(ab));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Como contexto de la página. */
  get comoContexto(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }

  /** Las fuentes de una sección de la pista (`__pista` termina en `/<seccion>`). */
  dePista(seccion?: string): FuenteFalsa[] {
    return this.fuentes.filter((f) => f.__pista !== undefined && (seccion === undefined || f.__pista.endsWith(`/${seccion}`)));
  }

  /** Cuánto suena una fuente de la pista en la hora `t`: su ganancia por la del corte de las sorpresas (0 si no arrancó o ya paró). */
  nivel(f: FuenteFalsa, t: number): number {
    if (!f.inicio || t < f.inicio.cuando || (f.parada !== null && t >= f.parada)) return 0;
    const g = f.conectado[0] as NodoFalso | undefined;
    const corte = g?.conectado[0] as NodoFalso | undefined;
    const vg = (g?.gain as ParamFalso | undefined)?.en(t) ?? 1;
    const vc = (corte?.gain as ParamFalso | undefined)?.en(t) ?? 1;
    return vg * vc;
  }

  /** El nodo de volumen de toda la pista al que llega una fuente de la pista (fuente, voz, corte de las sorpresas, salida). */
  salidaDe(f: FuenteFalsa): NodoFalso | undefined {
    const voz = f.conectado[0] as NodoFalso | undefined;
    const corte = voz?.conectado[0] as NodoFalso | undefined;
    return corte?.conectado[0] as NodoFalso | undefined;
  }

  /** Lo que de verdad suena de una fuente de la pista: su nivel (`nivel`) por el volumen de toda la pista. */
  nivelFinal(f: FuenteFalsa, t: number): number {
    const salida = this.salidaDe(f);
    return this.nivel(f, t) * ((salida?.gain as ParamFalso | undefined)?.en(t) ?? 1);
  }

  /** Avisa que terminaron las fuentes que ya pararon (lo que hace el navegador con `onended`). */
  terminar(): void {
    for (const f of this.fuentes) if (f.parada !== null && f.parada <= this.currentTime && f.onended) {
      const fn = f.onended;
      f.onended = null;
      fn();
    }
  }
}

/** Un buffer de mentira de `segundos` de largo. */
export function bufferFalso(segundos: number, canales = 1, sr = 48000): AudioBuffer {
  return {
    duration: segundos,
    length: Math.round(segundos * sr),
    sampleRate: sr,
    numberOfChannels: canales,
    getChannelData: () => new Float32Array(Math.max(1, Math.round(segundos * sr))),
  } as unknown as AudioBuffer;
}

/** Lo que lleva la cabecera de un MP3 de mentira (`mp3Falso`). */
export interface Mp3Falso {
  /** Bytes del archivo. */
  largo?: number;
  /** Bytes de la etiqueta ID3 del principio, o 0 si no hay. */
  id3?: number;
  /** 3 es MPEG 1, 2 es MPEG 2 y 0 es MPEG 2.5. */
  version?: number;
  /** 0, 1 o 2: la frecuencia dentro de las tres de la versión. */
  tasa?: number;
  mono?: boolean;
  /** `Info` (ffmpeg y LAME en tasa fija) o `Xing`. */
  etiqueta?: string;
  /** Qué campos trae el cuadro: 1 cuadros, 2 bytes, 4 tabla, 8 calidad. */
  banderas?: number;
  cuadros?: number;
  retardo?: number;
  relleno?: number;
}

/**
 * Los primeros bytes de un MP3 de LAME, sin audio: la etiqueta ID3 si se pide, el cuadro de cabecera y el cuadro Xing o
 * Info con los cuadros, el retardo y el relleno. Alcanza para probar la lectura de la cabecera sin guardar música.
 */
export function mp3Falso(o: Mp3Falso = {}): ArrayBuffer {
  const { largo = 4000, id3 = 0, version = 3, tasa = 0, mono = true, etiqueta = "Info", banderas = 1, cuadros = 1000, retardo = 576, relleno = 1000 } = o;
  const b = new Uint8Array(largo);
  const dv = new DataView(b.buffer);
  let p = 0;
  if (id3 > 0) {
    b.set([0x49, 0x44, 0x33, 4, 0, 0], 0);
    b[6] = (id3 >> 21) & 0x7f;
    b[7] = (id3 >> 14) & 0x7f;
    b[8] = (id3 >> 7) & 0x7f;
    b[9] = id3 & 0x7f;
    p = 10 + id3;
  }
  b[p] = 0xff;
  b[p + 1] = 0xe0 | (version << 3) | (1 << 1) | 1;
  b[p + 2] = (9 << 4) | (tasa << 2);
  b[p + 3] = mono ? 0xc0 : 0;
  const marca = p + (version === 3 ? (mono ? 21 : 36) : mono ? 13 : 21);
  b.set([...etiqueta].map((c) => c.charCodeAt(0)), marca);
  dv.setUint32(marca + 4, banderas);
  let q = marca + 8;
  if (banderas & 1) {
    dv.setUint32(q, cuadros);
    q += 4;
  }
  if (banderas & 2) q += 4;
  if (banderas & 4) q += 100;
  if (banderas & 8) q += 4;
  b.set([..."LAME3.100"].map((c) => c.charCodeAt(0)), q);
  b[q + 21] = retardo >> 4;
  b[q + 22] = ((retardo & 0x0f) << 4) | (relleno >> 8);
  b[q + 23] = relleno & 0xff;
  return b.buffer;
}
