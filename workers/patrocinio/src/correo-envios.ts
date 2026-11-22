/**
 * El correo de bienvenida, desde la alarma del objeto: unos 20 minutos después de que una persona recibe su regalo (así no
 * llega mientras busca en su correo el código para proteger la cuenta, que vale 5 minutos), una sola vez por persona.
 *
 * Cómo recuerda a quién ya se le escribió: con los derechos `gratis:<persona>` que ya existen por el regalo y una sola marca,
 * el id del último regalo intentado, en los ajustes (`correo_bienvenida_hasta`). No hay tabla ni columna nueva, y la
 * dirección no se guarda en ningún lado: la lee la ficha de la persona en el momento, vive en la memoria mientras se manda
 * y se olvida. La marca avanza antes de mandar, así un reinicio en medio nunca manda dos veces. El registro lleva solo
 * `correo-bienvenida` con un código fijo (`enviado`, `viejo`, `tope`, el código de Cloudflare), nunca la persona.
 *
 * Los frenos: de a pocos por vuelta y con un presupuesto de tiempo, un tope de correos intentados por día UTC (la cuota de
 * Cloudflare es una sola con el aviso a quien gana una campaña), y al primer `E_DAILY_LIMIT_EXCEEDED` para hasta el otro
 * día sin mover la marca (esa persona lo recibe mañana). Si la ficha no se pudo leer por algo pasajero (Pollar lento o caído
 * un rato), la marca tampoco se mueve y se vuelve a mirar en un rato, hasta `REINTENTOS_FICHA` veces. Lo que tiene más de 48
 * horas se saltea. Lo demás que falla no se reintenta. Con el ajuste `correo_bienvenida_cerrado` en 1 no hace nada y la marca
 * no se mueve.
 *
 * Nunca lanza hacia afuera de `vuelta` sin que la alarma lo ataje, y va al final de la alarma: los sellos y los pagos ya se
 * cerraron. El reloj, la ficha y el mensajero entran como dependencias: las pruebas no tocan la red.
 */
import type { RegaloParaCorreo } from "./altas";
import { AJUSTE_CORREO_CERRADO, AJUSTE_CORREO_DIA, AJUSTE_CORREO_HASTA, AJUSTE_CORREO_HOY, CORREO_DIA_POR_DEFECTO, TECHO_CORREO_DIA } from "./config";
import { type Mensajero, conTope, textoDeBienvenida } from "./correo-bienvenida";
import { type DatosParaCorreo, FICHA_PASAJERA } from "./pollar";

/** Cuánto espera el correo desde el regalo: lo que tarda en vencer el código de proteger la cuenta, con margen. */
export const ESPERA_CORREO_MS = 20 * 60_000;
/** Un regalo de hace más de esto ya no recibe el correo: se saltea y se cuenta. */
export const VIEJO_CORREO_MS = 48 * 3_600_000;
/** Cuántas personas se intentan en una vuelta, y en una vuelta con sellos o pagos todavía en el aire. */
export const POR_VUELTA = 5;
export const POR_VUELTA_CON_ALGO_EN_EL_AIRE = 1;
/** Pasado esto desde que empezó la vuelta, ninguna persona nueva empieza: la alarma no se alarga. */
export const PRESUPUESTO_VUELTA_MS = 10_000;
/** Lo más que se espera a una persona entera: la ficha (6 s) y el envío (10 s), con margen. */
export const TOPE_PERSONA_MS = 18_000;
/** Con más regalos por mirar, cuándo vuelve la alarma: lo mismo que la de los sellos. */
export const VOLVER_PRONTO_MS = 20_000;
/** Cuántos regalos viejos se saltean en una vuelta, sin esperar a nadie, antes de dejar el resto para la siguiente. */
const VIEJOS_POR_VUELTA = 500;
/** El código de Cloudflare cuando se acabó la cuota del día. */
export const CUOTA_AGOTADA = "E_DAILY_LIMIT_EXCEEDED";
/**
 * Cuántas veces seguidas se intenta la ficha de una persona cuando la falla es pasajera, antes de saltearla: así un Pollar
 * caído un rato no le quita el correo a nadie y uno caído del todo no traba la cola. Entre una y otra espera el doble, desde
 * `VOLVER_PRONTO_MS`: 20, 40, 80, 160 y 320 segundos, unos 10 minutos en total.
 */
export const REINTENTOS_FICHA = 6;

type Registrar = (evento: string, datos?: Record<string, string | number>) => void;

export interface DependenciasDelCorreo {
  cupos: { ajuste(clave: string): string | undefined; fijarAjuste(clave: string, valor: string, ahora: number): void };
  altas: { regalosParaCorreo(despuesDe: number, cuantos: number): RegaloParaCorreo[]; ultimoRegalo(): number };
  /**
   * La ficha de la persona por su id (`Pollar.fichaParaCorreo`): null si no hay a quién escribirle y `FICHA_PASAJERA` si no
   * se pudo leer por algo que puede andar en un rato. Nunca lanza.
   */
  ficha(usuario: string): Promise<DatosParaCorreo | typeof FICHA_PASAJERA | null>;
  mensajero: Mensajero;
  reloj: () => number;
  registrar: Registrar;
}

/** Los correos de hoy (UTC): cuántos se intentaron y si Cloudflare dijo que se acabó la cuota. Solo cifras. */
interface Hoy {
  dia: string;
  intentados: number;
  cuota: boolean;
}

const diaUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Un minuto después de la medianoche UTC que sigue: cuándo vuelve a haber cuota y tope. */
const mananaUtc = (ms: number) => Date.parse(`${diaUtc(ms)}T00:00:00.000Z`) + 86_400_000 + 60_000;

export class EnviosDeBienvenida {
  /** Los conteos desde que arrancó el objeto, para `/v1/patrocinio/estado`. En memoria: un reinicio los vacía. */
  private readonly conteos = { enviados: 0, sinFicha: 0, errores: 0, viejos: 0, frenosPorTope: 0, frenosPorCuota: 0 };
  /** La vuelta en curso: dos llamadas a la vez esperan la misma, así nadie recibe dos correos. */
  private enCurso: Promise<number | null> | null = null;
  /**
   * La persona cuya ficha falló por algo pasajero: el id de su regalo, cuántas veces seguidas falló y desde cuándo se puede
   * volver a mirar. En memoria: un reinicio vuelve a empezar la cuenta, y el corte de las 48 horas pone el límite.
   */
  private pasajera: { id: number; veces: number; proxima: number } | null = null;

  constructor(private readonly d: DependenciasDelCorreo) {}

  /** Si el freno en caliente está puesto (`correo_bienvenida_cerrado` en 1). */
  cerrado(): boolean {
    return this.d.cupos.ajuste(AJUSTE_CORREO_CERRADO) === "1";
  }

  /** El tope de correos por día que vale ahora: el ajuste en caliente (de 1 a su techo) o el de por defecto. */
  topeDelDia(): number {
    const v = this.d.cupos.ajuste(AJUSTE_CORREO_DIA);
    const n = v !== undefined && /^\d{1,7}$/.test(v) ? Number(v) : 0;
    return n >= 1 && n <= TECHO_CORREO_DIA ? n : CORREO_DIA_POR_DEFECTO;
  }

  /**
   * La primera vez que el correo se prende, la marca arranca en el último regalo ya dado: quien recibió el regalo con el correo
   * apagado no lo recibe después. Si la marca ya existe (se apagó y se volvió a prender), se respeta.
   */
  arrancar(): void {
    if (this.marca() === null) this.d.cupos.fijarAjuste(AJUSTE_CORREO_HASTA, String(this.d.altas.ultimoRegalo()), this.d.reloj());
  }

  /** Cuándo toca el correo de un regalo dado `ahora`. */
  cuandoToca(ahora: number): number {
    return ahora + ESPERA_CORREO_MS;
  }

  private marca(): number | null {
    const v = this.d.cupos.ajuste(AJUSTE_CORREO_HASTA);
    return v !== undefined && /^\d{1,15}$/.test(v) ? Number(v) : null;
  }

  private fijarMarca(id: number): void {
    this.d.cupos.fijarAjuste(AJUSTE_CORREO_HASTA, String(id), this.d.reloj());
  }

  private hoy(ahora: number): Hoy {
    const dia = diaUtc(ahora);
    try {
      const o = JSON.parse(this.d.cupos.ajuste(AJUSTE_CORREO_HOY) ?? "null") as Partial<Hoy> | null;
      if (o && o.dia === dia && typeof o.intentados === "number" && Number.isFinite(o.intentados)) {
        return { dia, intentados: o.intentados, cuota: o.cuota === true };
      }
    } catch {
      // Lo que no se entiende es un día nuevo.
    }
    return { dia, intentados: 0, cuota: false };
  }

  private guardarHoy(h: Hoy): void {
    this.d.cupos.fijarAjuste(AJUSTE_CORREO_HOY, JSON.stringify(h), this.d.reloj());
  }

  /**
   * Una vuelta del correo: manda los que ya tocan, de a pocos. Devuelve cuándo hace falta la próxima vuelta (ms), o null si
   * no queda nada por mirar. `conAlgoEnElAire`: la alarma tiene sellos o pagos en el aire, y la vuelta se achica a una persona.
   */
  vuelta(o: { conAlgoEnElAire: boolean } = { conAlgoEnElAire: false }): Promise<number | null> {
    this.enCurso ??= this.correr(o.conAlgoEnElAire).finally(() => (this.enCurso = null));
    return this.enCurso;
  }

  private async correr(conAlgoEnElAire: boolean): Promise<number | null> {
    if (this.cerrado()) return null;
    this.arrancar();
    const inicio = this.d.reloj();
    const hoy = this.hoy(inicio);
    const maximo = conAlgoEnElAire ? POR_VUELTA_CON_ALGO_EN_EL_AIRE : POR_VUELTA;
    let hasta = this.marca() ?? 0;
    let intentadas = 0;
    let viejos = 0;
    for (;;) {
      const r = this.d.altas.regalosParaCorreo(hasta, 1)[0];
      if (!r) return null;
      const ahora = this.d.reloj();
      if (r.creado > ahora - ESPERA_CORREO_MS) return r.creado + ESPERA_CORREO_MS;
      if (ahora - r.creado > VIEJO_CORREO_MS) {
        if (viejos >= VIEJOS_POR_VUELTA) return ahora + VOLVER_PRONTO_MS;
        viejos += 1;
        this.conteos.viejos += 1;
        hasta = r.id;
        this.fijarMarca(hasta);
        this.d.registrar("correo-bienvenida", { codigo: "viejo" });
        continue;
      }
      if (hoy.cuota) {
        this.conteos.frenosPorCuota += 1;
        return mananaUtc(ahora);
      }
      if (hoy.intentados >= this.topeDelDia()) {
        this.conteos.frenosPorTope += 1;
        this.d.registrar("correo-bienvenida", { codigo: "tope" });
        return mananaUtc(ahora);
      }
      // A quien le falló la ficha hace poco se lo vuelve a mirar recién a su hora, aunque la alarma corra antes por los sellos.
      if (this.pasajera?.id === r.id && ahora < this.pasajera.proxima) return this.pasajera.proxima;
      if (intentadas >= maximo || ahora - inicio >= PRESUPUESTO_VUELTA_MS) return ahora + VOLVER_PRONTO_MS;
      // La marca avanza antes de esperar a nadie: si el objeto se reinicia en medio, a esta persona no se le escribe dos veces.
      const anterior = hasta;
      hasta = r.id;
      this.fijarMarca(hasta);
      intentadas += 1;
      const codigo = await conTope(this.intentar(r, hoy), TOPE_PERSONA_MS, "tiempo");
      if (codigo === CUOTA_AGOTADA) {
        // Sin cuota no salió: la marca vuelve atrás y esta persona lo recibe mañana, con la cuota nueva.
        hasta = anterior;
        this.fijarMarca(anterior);
        this.guardarHoy({ ...hoy, cuota: true });
        this.conteos.frenosPorCuota += 1;
        this.d.registrar("correo-bienvenida", { codigo });
        return mananaUtc(this.d.reloj());
      }
      if (codigo === FICHA_PASAJERA) {
        // La ficha no se pudo leer por algo pasajero y todavía no se mandó nada: la marca vuelve atrás y se mira otra vez en un
        // rato, cada vez más espaciado. Pasadas `REINTENTOS_FICHA` veces seguidas, se saltea como una ficha sin correo.
        const veces = (this.pasajera?.id === r.id ? this.pasajera.veces : 0) + 1;
        if (veces < REINTENTOS_FICHA) {
          hasta = anterior;
          this.fijarMarca(anterior);
          const proxima = this.d.reloj() + VOLVER_PRONTO_MS * 2 ** (veces - 1);
          this.pasajera = { id: r.id, veces, proxima };
          return proxima;
        }
        this.pasajera = null;
        this.conteos.sinFicha += 1;
        continue;
      }
      if (this.pasajera?.id === r.id) this.pasajera = null;
      if (codigo === "enviado") this.conteos.enviados += 1;
      else if (codigo === "sin-ficha") this.conteos.sinFicha += 1;
      else this.conteos.errores += 1;
      // La ficha ya anotó por qué no hubo a quién escribirle: acá no se repite.
      if (codigo !== "sin-ficha") this.d.registrar("correo-bienvenida", { codigo });
    }
  }

  /**
   * Una persona: su ficha, el correo armado con los sorteos y el vencimiento de su regalo, y el envío. Lo intentado cuenta para
   * el tope del día justo antes de mandar. Devuelve solo un código. Nunca lanza.
   */
  private async intentar(r: RegaloParaCorreo, hoy: Hoy): Promise<string> {
    try {
      const datos = await this.d.ficha(r.usuario);
      if (!datos) return "sin-ficha";
      if (datos === FICHA_PASAJERA) return FICHA_PASAJERA;
      const contenido = textoDeBienvenida(datos.idioma, { nombre: datos.nombre, sorteos: r.sorteos, vence: r.vence });
      hoy.intentados += 1;
      this.guardarHoy(hoy);
      const res = await this.d.mensajero.mandar(datos.correo, contenido);
      return res.ok ? "enviado" : res.codigo;
    } catch {
      return "inesperado";
    }
  }

  /** Lo que muestra `/v1/patrocinio/estado`: si está cerrado, el tope, lo de hoy y los conteos. Solo cifras. */
  resumen(): Record<string, unknown> {
    const hoy = this.hoy(this.d.reloj());
    return {
      prendido: !this.cerrado(),
      cerrado: this.cerrado(),
      topeDia: this.topeDelDia(),
      hoy: { intentados: hoy.intentados, cuotaAgotada: hoy.cuota },
      ...this.conteos,
    };
  }
}
