import { roundTime } from "../protocol/quicknet";

/**
 * Mandar una transacción y saber, de verdad, cómo terminó.
 *
 * Lógica pura: lo que toca la red (mandar, preguntar, leer el contrato) y el
 * reloj entran inyectados, así se prueba con un RPC simulado.
 *
 * La regla de fondo, y por qué existe: **ningún reintento puede crear un segundo
 * sello.** Sellar la misma lista varias veces contra rondas distintas es el único
 * ataque que sigue abierto contra Tinkazo (la selección del compromiso, ver
 * seguridad.html). Si un corte de red hace creer que el primer sello no entró y
 * se manda otro, aunque sea sin querer, quedan dos sellos de la misma lista y la
 * sala ya no puede saber cuál era el bueno. Por eso:
 *
 * - **Reenviar la misma transacción firmada siempre es seguro.** Tiene la misma
 *   secuencia y el mismo hash: la red la aplica una vez como mucho. Mientras no
 *   se sabe, se reenvía la misma, nunca una nueva.
 * - **Una transacción nueva (rearmada, con otra secuencia u otra ronda) se manda
 *   solo cuando se sabe que la anterior no entró y ya no puede entrar**: falló
 *   adentro del ledger, la red la rechazó al recibirla, o venció.
 * - **Venció se sabe por la hora de la red, no por la del navegador**:
 *   `getTransaction` dice la hora de cierre del último ledger, y si pasó el
 *   `maxTime` de la transacción sin que apareciera, ya no puede aparecer.
 * - Para un sello hay además una ventana que pone el contrato: lo acepta mientras
 *   `now <= round_time - 30` (no toma una ronda que nazca a menos de 30 segundos
 *   del ledger). Un ledger que cierra justo en `round_time - 30` todavía lo acepta,
 *   y desde el Protocolo 30 (CAP-88) el ledger que sigue puede cerrar en el mismo
 *   segundo. Recién con un ledger que cierra después de `round_time - 30`, por la
 *   hora de la red, ese sello ya no puede entrar, venga de donde venga.
 * - Si la red no contesta, no se adivina: queda "no se sabe", y el próximo
 *   intento empieza por averiguarlo.
 */

/** Lo que importa de lo que contesta el RPC al mandar (`sendTransaction`). */
export interface RespuestaEnvio {
  status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR" | string;
  /** El código del rechazo, si lo hubo: `tx_bad_seq`, `tx_insufficient_balance`… */
  codigo?: string;
}

/** Lo que importa de lo que contesta el RPC al preguntar por una transacción (`getTransaction`). */
export interface RespuestaConsulta {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND" | string;
  /** La hora de cierre del último ledger que conoce el RPC, en segundos. */
  cierre: number;
  /** Lo que devolvió la invocación, si entró bien. */
  valor?: unknown;
}

/** Cómo terminó un envío. */
export type Desenlace =
  /** Entró a un ledger y salió bien. */
  | { estado: "entro"; valor?: unknown }
  /** Entró a un ledger y falló: no dejó nada grabado. */
  | { estado: "fallo" }
  /** La red no la aceptó, y nunca la había aceptado: no entró ni va a entrar. */
  | { estado: "rechazada"; codigo: string }
  /** No apareció y la red ya pasó su `maxTime`: no entró ni va a entrar. */
  | { estado: "vencida" }
  /** No se pudo hablar con la red: no se sabe. */
  | { estado: "sin-respuesta"; error: unknown };

export interface OpcionesEnvio {
  /**
   * Manda otra vez la MISMA transacción firmada. Sin esto solo se pregunta: es el
   * caso de Pollar, que la manda desde su servidor.
   */
  enviar?: () => Promise<RespuestaEnvio>;
  /** Pregunta por la transacción, por su hash. */
  consultar: () => Promise<RespuestaConsulta>;
  /** Hasta cuándo vale la transacción (`maxTime`), en segundos de la red. */
  venceEn: number;
  /** Cuánto se espera sin poder hablar con la red antes de rendirse (30 s). */
  sinRedMs?: number;
  /** Cada cuánto se vuelve a mandar mientras no aparece (12 s). Es la misma: no duplica nada. */
  reenviarCadaMs?: number;
  /** Cuánto se le da a cada pedido (10 s): el SDK no les pone tope y un pedido colgado colgaba el sorteo. */
  topePedidoMs?: number;
  /** Un tope de seguridad si el RPC deja de avanzar (4 min). */
  topeTotalMs?: number;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** Cada vuelta en que todavía no se sabe: la pantalla puede decir "confirmando…". */
  alEsperar?: (vuelta: number) => void;
}

/** Tope de tiempo para una promesa que puede quedarse colgada. */
function conTope<T>(p: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error(mensaje)), ms);
    p.then(
      (v) => {
        clearTimeout(reloj);
        resolver(v);
      },
      (e: unknown) => {
        clearTimeout(reloj);
        rechazar(e);
      },
    );
  });
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Manda (si hace falta) y pregunta hasta saber cómo terminó.
 *
 * - `PENDING` o `DUPLICATE`: la red la tiene. Se pregunta hasta que aparezca;
 *   cada tanto se reenvía la misma, por si se cayó de la cola.
 * - `TRY_AGAIN_LATER`: la red no la tomó (la cola está llena, o la cuenta ya
 *   tiene otra esperando) o, como se midió en la testnet, ya está aplicada. Se
 *   pregunta, y se vuelve a mandar la misma con una espera que crece.
 * - `ERROR` en el primer envío: rechazada, con su código. Si antes la red ya la
 *   había tomado, o un envío se cortó sin respuesta, un `ERROR` al reenviar no
 *   prueba nada (la secuencia ya pudo usarse porque entró): se sigue preguntando.
 * - Un corte al mandar o al preguntar: se sigue, hasta `sinRedMs` sin respuesta.
 * - `NOT_FOUND` mientras la transacción sigue viva no es una falla: se espera.
 *   Con la hora de la red pasada de `venceEn`, venció.
 */
export async function enviarYConfirmar(op: OpcionesEnvio): Promise<Desenlace> {
  const ahora = op.ahora ?? Date.now;
  const dormir = op.dormir ?? dormirDeVerdad;
  const sinRedMs = op.sinRedMs ?? 30_000;
  const reenviarCadaMs = op.reenviarCadaMs ?? 12_000;
  const tope = op.topePedidoMs ?? 10_000;
  const topeTotal = op.topeTotalMs ?? 240_000;
  const inicio = ahora();
  // Sin `enviar`, otro ya la mandó (Pollar): se la da por tomada.
  let tomada = !op.enviar;
  let quizasTomada = false;
  let ultimoContacto = inicio;
  let ultimoError: unknown = null;
  let proximoEnvio = 0;
  let reintentosEnvio = 0;
  let espera = 1000;
  let vuelta = 0;

  for (;;) {
    if (op.enviar && ahora() >= proximoEnvio) {
      try {
        const r = await conTope(op.enviar(), tope, "envio-lento");
        ultimoContacto = ahora();
        if (r.status === "PENDING" || r.status === "DUPLICATE") {
          tomada = true;
          proximoEnvio = ahora() + reenviarCadaMs;
        } else if (r.status === "ERROR") {
          if (!tomada && !quizasTomada) return { estado: "rechazada", codigo: r.codigo ?? "ERROR" };
          // Ya la había tomado (o quizás): no se reenvía más, se pregunta.
          proximoEnvio = Number.POSITIVE_INFINITY;
        } else {
          // TRY_AGAIN_LATER (o algo que no se conoce): la misma, más tarde.
          reintentosEnvio++;
          proximoEnvio = ahora() + Math.min(8000, 1000 * 2 ** reintentosEnvio);
        }
      } catch (e) {
        // Un corte al mandar: quizás llegó. Desde acá, un ERROR al reenviar ya no prueba nada.
        ultimoError = e;
        quizasTomada = true;
        reintentosEnvio++;
        proximoEnvio = ahora() + Math.min(8000, 1000 * 2 ** reintentosEnvio);
      }
    }

    try {
      const c = await conTope(op.consultar(), tope, "consulta-lenta");
      ultimoContacto = ahora();
      if (c.status === "SUCCESS") return { estado: "entro", valor: c.valor };
      if (c.status === "FAILED") return { estado: "fallo" };
      if (Number.isFinite(c.cierre) && c.cierre > op.venceEn) return { estado: "vencida" };
    } catch (e) {
      ultimoError = e;
    }

    if (ahora() - ultimoContacto >= sinRedMs || ahora() - inicio >= topeTotal) {
      return { estado: "sin-respuesta", error: ultimoError ?? new Error("sin-confirmar") };
    }
    op.alEsperar?.(++vuelta);
    await dormir(espera);
    espera = Math.min(Math.round(espera * 1.5), 4000);
  }
}

/* ------------------------------------------------------------------- el sello */

/**
 * Lo que identifica un intento de sellar: quién, qué lista y contra qué ronda.
 * Dos sellos de la misma cuenta, de la misma lista y con la misma ronda son el
 * mismo intento: el contrato guarda la ronda, así que se lo puede buscar ahí.
 */
export interface IntentoDeSello {
  organizer: string;
  /** La huella de la lista, en hex. */
  listHash: string;
  round: number;
  /** Lo demás que se selló, para retomarlo igual si resulta que entró. */
  count: number;
  numWinners: number;
  meta: string;
  /** Cuándo se empezó, en segundos. */
  desde: number;
  /**
   * El hash de la transacción, si se sabe. Con Freighter o la cuenta de prueba es
   * el de la que se firmó acá. Con Pollar es el de la que se le entregó: Pollar la
   * envuelve para pagar la comisión y el RPC la encuentra por ese hash (medido el
   * 21 de octubre de 2026 con un sello patrocinado), pero si algún día la cambiara,
   * no aparecería. Por eso, que no aparezca nunca prueba que no entró: lo prueba
   * el contrato.
   */
  hash?: string;
}

/**
 * Se mandó un sello y no se sabe si entró: un corte de red, un tope de tiempo,
 * una respuesta que no llegó. Quien lo recibe no puede mandar otro sin antes
 * averiguarlo (`resolverSello`).
 */
export class SelloIncierto extends Error {
  readonly intento: IntentoDeSello;
  constructor(intento: IntentoDeSello, causa: unknown) {
    super("sin-confirmar", { cause: causa });
    this.name = "SelloIncierto";
    this.intento = intento;
  }
}

/**
 * Si un error es un `SelloIncierto`. Por el nombre y la forma, no solo por la
 * clase: el módulo se baja aparte (`import()`) y una copia distinta de la clase
 * no tiene que poder colarse como "no incierto".
 */
export function esSelloIncierto(e: unknown): e is SelloIncierto {
  if (e instanceof SelloIncierto) return true;
  const x = e as { name?: unknown; intento?: { round?: unknown; organizer?: unknown } } | null;
  return !!x && x.name === "SelloIncierto" && typeof x.intento?.round === "number" && typeof x.intento?.organizer === "string";
}

/** Cuántos segundos antes de la ronda deja de aceptar sellos el contrato (`MIN_LEAD_SECS`). */
export const MARGEN_DEL_CONTRATO_S = 30;

export interface FuentesDelSello {
  /** El último ledger que conoce la red: su número y su hora de cierre, en segundos. */
  ultimoLedger: () => Promise<{ secuencia: number; cierre: number }>;
  /** Busca el sello del intento en el contrato. `secuencia` es el ledger del que leyó. */
  buscarSello: (intento: IntentoDeSello) => Promise<{ id?: string; secuencia: number }>;
  /** El estado de una transacción por su hash y, si entró, el número del sorteo que devolvió. */
  consultarHash?: (hash: string) => Promise<{ status: string; raffleId?: string }>;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** Cuánto se espera sin poder hablar con la red (20 s). */
  sinRedMs?: number;
  /** Un tope de seguridad si la red deja de avanzar (3 min). */
  topeTotalMs?: number;
  alEsperar?: (vuelta: number) => void;
}

export type Resolucion =
  /** Entró: este es el sorteo. */
  | { estado: "entro"; raffleId: string; hash?: string }
  /** No entró y ya no puede entrar: se puede sellar de nuevo. */
  | { estado: "no-entro" }
  /** No se pudo averiguar: no se sella de nuevo. */
  | { estado: "no-se-sabe"; error: unknown };

/**
 * Averigua si un sello que se mandó entró. Pregunta hasta saberlo, con la red de
 * testigo y nunca con el reloj del navegador:
 *
 * - Si está en el contrato (la misma cuenta, la misma lista, la misma ronda),
 *   entró: ese es el sorteo.
 * - Si su transacción falló adentro de un ledger, no entró.
 * - Si la red ya cerró un ledger a una hora posterior a `round_time - 30` y el
 *   contrato, leído en ese ledger o en uno posterior, no lo tiene, no entró ni
 *   puede entrar: cualquier ledger que venga lo rechaza (`RoundTooSoon`). Posterior
 *   de verdad (`>`, no `>=`): el contrato acepta mientras `now <= round_time - 30`
 *   y, desde el Protocolo 30 (CAP-88), dos ledgers seguidos pueden cerrar en el
 *   mismo segundo. Tras un ledger que cierra justo en `round_time - 30` sin el
 *   sello puede venir otro, del mismo segundo, que sí lo incluye: darlo por
 *   perdido ahí diría "no entró" con el sello vivo y dejaría sellar de nuevo.
 *   Cuesta, como mucho, un ledger más de espera.
 * - Si no, todavía puede entrar: se espera.
 * - Sin respuesta de la red durante `sinRedMs` (20 s), no se sabe.
 */
export async function resolverSello(intento: IntentoDeSello, f: FuentesDelSello): Promise<Resolucion> {
  const ahora = f.ahora ?? Date.now;
  const dormir = f.dormir ?? dormirDeVerdad;
  const sinRedMs = f.sinRedMs ?? 20_000;
  const topeTotal = f.topeTotalMs ?? 180_000;
  // La última hora de cierre en que el contrato todavía acepta el sello: `now <= round_time - 30`.
  const limite = roundTime(intento.round) - MARGEN_DEL_CONTRATO_S;
  const inicio = ahora();
  let ultimoContacto = inicio;
  let ultimoError: unknown = null;
  let espera = 1500;
  let vuelta = 0;
  let entroPorHash = false;

  for (;;) {
    try {
      // Primero la hora de la red; después el contrato, leído en ese ledger o en uno posterior.
      // Cuenta como respuesta solo la vuelta entera: si el contrato no se deja leer, no se sabe.
      const ledger = await f.ultimoLedger();
      if (intento.hash && f.consultarHash && !entroPorHash) {
        const c = await f.consultarHash(intento.hash);
        if (c.status === "FAILED") return { estado: "no-entro" };
        if (c.status === "SUCCESS") {
          if (c.raffleId) return { estado: "entro", raffleId: c.raffleId, hash: intento.hash };
          // Entró, pero no se pudo leer el número: lo dice el contrato.
          entroPorHash = true;
        }
      }
      const s = await f.buscarSello(intento);
      ultimoContacto = ahora();
      if (s.id) return { estado: "entro", raffleId: s.id, ...(intento.hash && entroPorHash ? { hash: intento.hash } : {}) };
      // Estricto: con `cierre == limite` el contrato todavía acepta, y otro ledger del mismo segundo puede traerlo.
      if (!entroPorHash && ledger.cierre > limite && s.secuencia >= ledger.secuencia) return { estado: "no-entro" };
    } catch (e) {
      // Un corte, o una respuesta que no se entiende: se vuelve a preguntar hasta `sinRedMs`.
      ultimoError = e;
    }
    if (ahora() - ultimoContacto >= sinRedMs || ahora() - inicio >= topeTotal) {
      return { estado: "no-se-sabe", error: ultimoError ?? new Error("sin-confirmar") };
    }
    f.alEsperar?.(++vuelta);
    await dormir(espera);
    espera = Math.min(Math.round(espera * 1.5), 5000);
  }
}
