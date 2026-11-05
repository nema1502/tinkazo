/**
 * Diagnóstico de la música en equipos lentos. Solo con `?diag=audio` en la dirección, y solo en la rama de prueba de la
 * VPS (`guido/vps-prueba`): no va a main. Sin el parámetro, `diagAudio` es null y nada de esto corre.
 *
 * Separa dos causas de que la música se corte:
 * - huecos: el temporizador llegó tarde y lo programado ya se había acabado (se arregla con más margen);
 * - deriva / cortes: el reloj del audio se atrasa respecto del de la página, o el navegador informa cortes del hilo de
 *   audio, aunque haya notas programadas (el teléfono no da abasto para sintetizar; se arregla con música más liviana).
 */
export interface DatosAudio {
  ticks: number;
  peorTickMs: number;
  ticksSobre220: number;
  ticksSobre1000: number;
  margen: number;
  margenMax: number;
  huecos: number;
  huecoTotal: number;
  huecoMax: number;
  derivaAudio: number;
  programadas: number;
  descartadas: number;
}

export const datosVacios = (): DatosAudio => ({
  ticks: 0, peorTickMs: 0, ticksSobre220: 0, ticksSobre1000: 0, margen: 0, margenMax: 0,
  huecos: 0, huecoTotal: 0, huecoMax: 0, derivaAudio: 0, programadas: 0, descartadas: 0,
});

export interface Tick {
  intervaloMs: number;
  margen: number;
  /** Segundos del reloj del audio que pasaron sin notas programadas antes de este tick. */
  hueco: number;
  escondida: boolean;
  /** Cuánto se atrasó el reloj del audio respecto del de la página desde el tick anterior, en segundos. */
  deriva: number;
}

export function registrarTick(d: DatosAudio, t: Tick): void {
  d.ticks++;
  d.margen = t.margen;
  // Con la pestaña escondida el silencio es a propósito: no se cuenta.
  if (t.escondida) return;
  d.margenMax = Math.max(d.margenMax, t.margen);
  if (Number.isFinite(t.intervaloMs)) {
    d.peorTickMs = Math.max(d.peorTickMs, Math.round(t.intervaloMs));
    if (t.intervaloMs > 220) d.ticksSobre220++;
    if (t.intervaloMs > 1000) d.ticksSobre1000++;
  }
  if (t.hueco > 0.005) {
    d.huecos++;
    d.huecoTotal += t.hueco;
    d.huecoMax = Math.max(d.huecoMax, t.hueco);
  }
  if (Number.isFinite(t.deriva)) d.derivaAudio += t.deriva;
}

export function registrarNota(d: DatosAudio, descartada: boolean): void {
  if (descartada) d.descartadas++;
  else d.programadas++;
}

export interface Contexto {
  estado: string;
  latencia: number | null;
  /** Cortes del hilo de audio, si el navegador los informa (`playbackStats`). */
  cortes: { eventos: number; segundos: number } | null;
}

export function texto(d: DatosAudio, c: Contexto): string {
  const s = (x: number): string => x.toFixed(2);
  return [
    "diag=audio",
    `peor tick ${d.peorTickMs} ms · ticks ${d.ticks}`,
    `ticks >220 ms: ${d.ticksSobre220} · ticks >1 s: ${d.ticksSobre1000}`,
    `margen ${s(d.margen)} s (máx ${s(d.margenMax)})`,
    `huecos ${d.huecos} · ${s(d.huecoTotal)} s (peor ${s(d.huecoMax)})`,
    `notas ${d.programadas} · descartadas ${d.descartadas}`,
    `deriva del audio ${s(d.derivaAudio)} s`,
    `audio ${c.estado} · latencia ${c.latencia === null ? "?" : `${Math.round(c.latencia * 1000)} ms`}`,
    `cortes del hilo de audio: ${c.cortes ? `${c.cortes.eventos} · ${s(c.cortes.segundos)} s` : "no informa"}`,
  ].join("\n");
}

const activo = typeof location !== "undefined" && new URLSearchParams(location.search).get("diag") === "audio";

function crearDiag() {
  let d = datosVacios();
  let reloj: { audio: number; pagina: number } | null = null;
  let caja: HTMLElement | null = null;
  let pintado = 0;
  let ctxActual: AudioContext | null = null;
  const contexto = (): Contexto => {
    const ctx = ctxActual;
    const stats = (ctx as unknown as { playbackStats?: { underrunEvents?: number; underrunDuration?: number } } | null)?.playbackStats;
    return {
      estado: ctx?.state ?? "sin audio",
      latencia: ctx ? (ctx.outputLatency || ctx.baseLatency || null) : null,
      cortes: stats && typeof stats.underrunEvents === "number"
        ? { eventos: stats.underrunEvents, segundos: stats.underrunDuration ?? 0 }
        : null,
    };
  };
  const pintar = (forzar = false): void => {
    const ahora = performance.now();
    if (!forzar && ahora - pintado < 250) return;
    pintado = ahora;
    if (!caja) {
      caja = document.createElement("pre");
      caja.setAttribute("aria-hidden", "true");
      caja.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:2147483647;margin:0;padding:6px 8px;"
        + "background:rgba(0,0,0,.8);color:#fff;font:11px/1.35 ui-monospace,monospace;pointer-events:none;"
        + "white-space:pre;border-radius:4px;max-width:96vw;overflow:hidden";
      document.body.appendChild(caja);
    }
    caja.textContent = texto(d, contexto());
  };
  return {
    /** Cada show empieza de cero; el cuadro queda a la vista después del show. */
    inicio(ctx: AudioContext): void {
      d = datosVacios();
      reloj = null;
      ctxActual = ctx;
      pintar(true);
    },
    tick(ctx: AudioContext, intervaloMs: number, margen: number, proxima: number): void {
      ctxActual = ctx;
      const ahora = performance.now();
      const escondida = document.hidden;
      const deriva = reloj ? (ahora - reloj.pagina) / 1000 - (ctx.currentTime - reloj.audio) : 0;
      reloj = { audio: ctx.currentTime, pagina: ahora };
      registrarTick(d, { intervaloMs, margen, hueco: ctx.currentTime - proxima, escondida, deriva });
      pintar();
    },
    nota(descartada: boolean): void {
      registrarNota(d, descartada);
    },
  };
}

export const diagAudio = activo ? crearDiag() : null;
