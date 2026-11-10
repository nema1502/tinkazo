/**
 * El plan del equipo, visto desde el portero: ¿esta cuenta tiene un plan activo que le suba el cupo?
 *
 * Lo sabe el Worker de la cuenta (`workers/cuenta`, `GET /v1/cuenta/<cuenta>/plan`). El portero lo pregunta con un
 * tiempo máximo corto y guarda la respuesta en memoria. **Nunca bloquea por una falla del otro Worker**: si no
 * contesta a tiempo, contesta mal o está caído, la cuenta tiene el cupo de siempre. El plan solo puede subir un cupo,
 * nunca bajarlo, y sin dirección configurada (`CUENTA_URL`) no se pregunta nada.
 *
 * Es memoria del objeto, no del SQLite: si el objeto se reinicia, se vuelve a preguntar. Nada de esto se guarda.
 * El reloj y el `fetch` entran como argumentos: las pruebas los mueven a mano.
 */

/** Lo que da un plan activo, ya leído y comprobado. */
export interface CupoDePlan {
  sellos: number;
  sorteos: number;
  /** Hasta cuándo vale el plan, en ms. */
  vence: number;
}

/** Lo más que se espera al Worker de la cuenta. Pasado esto, vale el cupo de siempre. */
export const ESPERA_PLAN_MS = 1_500;
/** Cuánto se recuerda un plan activo (nunca más allá de su vencimiento). */
export const VIGENCIA_PLAN_MS = 5 * 60_000;
/**
 * Cuánto se recuerda que una cuenta no tiene plan. Más corto que el de un plan activo a propósito: quien llegó a su
 * tope, compra el plan y vuelve a sellar no tiene que esperar cinco minutos a que el portero se entere.
 */
export const VIGENCIA_SIN_PLAN_MS = 60_000;
/** Tras una falla no se vuelve a preguntar por nadie durante este tiempo: una caída del otro Worker cuesta una espera, no una por pedido. */
export const PAUSA_TRAS_FALLA_MS = 30_000;
/** Lo más que se acepta que diga un plan de un cupo mensual: lo que pase de esto es una respuesta rota, no un plan. */
export const TECHO_CUPO_PLAN = 1_000;

const MAX_ENTRADAS = 5_000;
const MAX_RESPUESTA = 1_024;

type Lectura = { ok: true; cupo: CupoDePlan | null } | { ok: false; motivo: string };

const entero = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= TECHO_CUPO_PLAN;

/**
 * Lo que dijo el Worker de la cuenta: `{activo:true, vence, cupo:{sellos, sorteos}}` o `{activo:false}`.
 * Algo que no tiene esa forma es una falla (`ok:false`), no «sin plan». Un plan que ya venció es «sin plan».
 */
export function leerPlan(x: unknown, ahora: number): Lectura {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  if (o.activo === false) return { ok: true, cupo: null };
  if (o.activo !== true) return { ok: false, motivo: "forma" };
  const cupo = (o.cupo && typeof o.cupo === "object" ? o.cupo : {}) as Record<string, unknown>;
  if (typeof o.vence !== "number" || !Number.isFinite(o.vence) || !entero(cupo.sellos) || !entero(cupo.sorteos)) return { ok: false, motivo: "forma" };
  if (o.vence <= ahora) return { ok: true, cupo: null };
  return { ok: true, cupo: { sellos: cupo.sellos, sorteos: cupo.sorteos, vence: o.vence } };
}

export class Planes {
  private readonly recordado = new Map<string, { hasta: number; cupo: CupoDePlan | null }>();
  private readonly enCurso = new Map<string, Promise<CupoDePlan | null>>();
  private caidoHasta = 0;

  constructor(
    /** La dirección base del Worker de la cuenta, sin barra final (`https://cuenta.tinkazo.app`). */
    private readonly base: string,
    private readonly pedir: typeof fetch,
    private readonly reloj: () => number = () => Date.now(),
    /** La bitácora del portero. Solo nombres fijos y un motivo: nunca la cuenta. */
    private readonly registrar: (evento: string, datos?: Record<string, string | number>) => void = () => {},
    private readonly esperaMs: number = ESPERA_PLAN_MS,
  ) {}

  /**
   * El cupo que da el plan de la cuenta, o null si no tiene plan activo **o no se pudo saber**. Quien llama usa el
   * cupo de siempre con null: no distingue (ni tiene que distinguir) entre «no tiene» y «no pude preguntar».
   * Las preguntas en curso por la misma cuenta se comparten.
   */
  async cupoDe(cuenta: string): Promise<CupoDePlan | null> {
    const ahora = this.reloj();
    const guardado = this.recordado.get(cuenta);
    if (guardado && guardado.hasta > ahora) return guardado.cupo;
    if (ahora < this.caidoHasta) return null;
    let pregunta = this.enCurso.get(cuenta);
    if (!pregunta) {
      pregunta = this.preguntar(cuenta).finally(() => this.enCurso.delete(cuenta));
      this.enCurso.set(cuenta, pregunta);
    }
    return pregunta;
  }

  /** Pregunta, con tiempo máximo. No rechaza nunca: cualquier falla es «no se sabe». */
  private async preguntar(cuenta: string): Promise<CupoDePlan | null> {
    const control = new AbortController();
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const tiempo = new Promise<Lectura>((resolver) => {
      temporizador = setTimeout(() => {
        control.abort();
        resolver({ ok: false, motivo: "tiempo" });
      }, this.esperaMs);
    });
    let lectura: Lectura;
    try {
      lectura = await Promise.race([this.leer(cuenta, control.signal), tiempo]);
    } finally {
      clearTimeout(temporizador);
    }
    const ahora = this.reloj();
    if (!lectura.ok) {
      this.caidoHasta = ahora + PAUSA_TRAS_FALLA_MS;
      this.registrar("plan-sin-respuesta", { motivo: lectura.motivo });
      return null;
    }
    this.caidoHasta = 0;
    this.recordar(cuenta, { hasta: lectura.cupo ? Math.min(ahora + VIGENCIA_PLAN_MS, lectura.cupo.vence) : ahora + VIGENCIA_SIN_PLAN_MS, cupo: lectura.cupo }, ahora);
    return lectura.cupo;
  }

  private async leer(cuenta: string, senal: AbortSignal): Promise<Lectura> {
    try {
      const r = await this.pedir(`${this.base}/v1/cuenta/${cuenta}/plan`, { method: "GET", headers: { Accept: "application/json" }, signal: senal });
      if (r.status !== 200) return { ok: false, motivo: `http-${r.status}` };
      const texto = await r.text();
      if (texto.length > MAX_RESPUESTA) return { ok: false, motivo: "largo" };
      return leerPlan(JSON.parse(texto), this.reloj());
    } catch {
      return { ok: false, motivo: senal.aborted ? "tiempo" : "red" };
    }
  }

  private recordar(cuenta: string, valor: { hasta: number; cupo: CupoDePlan | null }, ahora: number): void {
    this.recordado.delete(cuenta);
    this.recordado.set(cuenta, valor);
    if (this.recordado.size <= MAX_ENTRADAS) return;
    // Primero lo vencido; si no alcanza, lo más viejo (un Map recuerda el orden en que se agregó cada una).
    for (const [k, v] of this.recordado) if (v.hasta <= ahora) this.recordado.delete(k);
    for (const k of this.recordado.keys()) {
      if (this.recordado.size <= MAX_ENTRADAS) break;
      this.recordado.delete(k);
    }
  }
}

/**
 * La dirección base del Worker de la cuenta que dice la variable `CUENTA_URL`, o null si está vacía o no sirve.
 * Solo `https` (o `http` en localhost, para probar) y solo el origen, sin ruta ni credenciales: la ruta la pone el portero.
 */
export function leerCuentaUrl(crudo: string | undefined): string | null {
  const t = (crudo ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    if (u.pathname.replace(/\/+$/, "") !== "" || u.search || u.hash || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}
