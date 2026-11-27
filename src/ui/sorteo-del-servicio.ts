import { sinGrabar } from "../ensayo-modo";
import { formaDePortero } from "../stellar/alta-build";
import { sorteoPorServidor } from "../stellar/alta-config";
import { esCuentaDePollar } from "../stellar/cobro-oficial";
import { network } from "../stellar/config";
import { enviarYConfirmar, type Desenlace, type RespuestaConsulta } from "../stellar/envio";
import { olvidarElEstado } from "../stellar/patrocinador";
import { configDelPortero } from "../stellar/patrocinio-config";
import { rpcRed } from "../stellar/rpc-red";
import { pedirElSorteo, type RespuestaDelSorteo } from "../stellar/sorteo-servidor-api";
import { activeWallet } from "../stellar/wallet-lite";
import { horaDeLaRonda } from "../reloj-de-la-ronda";
import type { AnchorStep } from "./anchor";

/**
 * El sorteo de una cuenta de Google o de correo, mandado por el servicio de comisiones.
 *
 * El contrato no pide autorización para sortear: cualquiera manda la llamada con la firma de la ronda y el resultado no
 * depende de quién la manda ni de cuándo. Con `VITE_SORTEO_SERVIDOR=1` el sitio le pide al servicio que la mande desde
 * su propia cuenta (`sorteo-servidor-api.ts`), así quien organiza no tiene que aprobar nada en el momento del show.
 *
 * Reglas de este archivo:
 *
 * - **El resultado sale de la red.** Los ganadores y el número al azar salen de leer el contrato (`readDraw`) o, si el
 *   contrato no se deja leer o todavía se lee vacío, del valor que devolvió en la red la transacción que el servicio dijo
 *   pendiente para ESTE sorteo en esta pestaña, ya confirmada. Nunca de lo que diga el servicio. Solo esa transacción
 *   lleva su número, en el resultado y en un error, y en el resultado solo si lo que devolvió coincide con el contrato o si
 *   el contrato no dio nada que comparar. Un número repetido puede ser el de otro sorteo con el mismo sello: no se muestra.
 *   Lo que dice el servicio no se cree sin más: quien llama (`grabar-sorteo.ts`) compara los ganadores del resultado con los
 *   que la sala calculó y vio, y si no coinciden lo muestra como error grave. Es la protección contra un número ajeno.
 * - **Los noes seguros del servicio.** El servicio de esta versión atiende un sorteo a la vez. Si está con otro contesta
 *   ocupado, y si sus propias llamadas a la red tardaron tanto que su respuesta no llegaría a tiempo contesta tarde. En los
 *   dos casos no reservó, no mandó y no va a mandar este sorteo, y lo mismo con un error interno que declara sin mandar.
 *   Con cualquiera de los tres se sigue en el acto por el camino de siempre, sin el respiro de la duda, y esa respuesta no
 *   deja ninguna reserva nueva. La que dejó un pedido anterior de este mismo sorteo que no contestó en su tope se conserva
 *   hasta que se cierre sola: es el lado seguro, porque a lo sumo se espera de más. Ocupado no deja de lado al servicio
 *   porque anda bien, tarde lo deja de lado diez minutos porque su red anda mal, y el error interno, un minuto.
 * - **Un pedido que no contestó en su tope se vuelve a pedir mientras queden en la etapa al menos
 *   `TOPE_MINIMO_DEL_PEDIDO_MS`.** El servicio junta en un solo trabajo los pedidos iguales de un sorteo y no empieza a
 *   mandar uno que ya lleva 9 segundos, así que está hecho para que su respuesta (el envío, ocupado o tarde) salga dentro de los 20 segundos de la etapa, y el segundo pedido es el que la
 *   recibe. Con el servicio de antes, que hace cola, el segundo pedido espera su turno detrás del primero y, si el primero
 *   llegó a reservar, contesta el repetido.
 * - **Cuándo puede salir por los dos caminos.** Se pasa al camino de siempre (`camino-de-hoy`) solo cuando el servicio
 *   aseguró que no lo manda, cuando la red cerró su envío sin dejar el sorteo hecho, o cuando pasado un tope de reloj no hay
 *   una respuesta que se pueda comprobar y la red dice que el sorteo no está. Aun así el sorteo puede salir además por el
 *   servicio en estos casos, todos raros: un envío que la red tarda más que el minuto de la sala en cerrar (la red llena),
 *   un repetido de un envío cortado que entra después de sus 15 segundos, un envío del servicio que se cuelga en sus dos
 *   RPC más allá de la etapa y la duda, un sello de más de 35 días cuyo envío se cortó, y el servicio de antes con varios
 *   sorteos a la vez. El contrato acepta uno solo: el otro falla con `AlreadyDrawn`, cuesta una comisión y una cofirma y no
 *   cambia el resultado. Con la red sin poder leerse no se manda nada más.
 * - **Ninguna espera sin tope.** Todo se mide por el reloj de pared, no por vueltas: una pestaña en segundo plano estira
 *   los temporizadores, y al volver se revisa la hora y se abandona lo que ya pasó de su tope. Un pedido sin tiempo en la
 *   etapa no se manda. La etapa de pedir dura como mucho 20 segundos y la duda, con la red leyéndose, unos 8 más: eso es lo
 *   que la sala puede esperar de más antes de que arranque el camino de siempre, al que `grabar-sorteo.ts` le descuenta lo
 *   gastado con un mínimo. Un envío que el servicio dio por pendiente se espera como mucho `TOPE_DE_LA_SALA_MS` desde la
 *   entrada (lo que vive hoy la transacción de una cuenta de Google), y un repetido, `VISTO_SIN_RED_MS` desde que se vio.
 *   Pasado eso, con la red contestando y el contrato sin el sorteo, se sigue por el camino de siempre, que arma otra
 *   transacción con su comisión de ese momento y reintenta como hoy. Todo final que no sigue por el camino de siempre,
 *   también después de que la transacción entró, termina a más tardar a los `TOPE_DE_LA_DUDA_SIN_RED_MS` desde la entrada,
 *   lo mismo que el camino de siempre, y hasta ahí solo se mira el contrato. La primera lectura de la duda y la del envío
 *   que entró se hacen siempre: una pestaña que vuelve de segundo plano pasada esa hora mira el contrato una vez antes de
 *   terminar.
 * - **Reserva del servicio.** Si el pedido salió y no se sabe cómo terminó, el servicio puede tener reservado ese sorteo en
 *   el cupo de la cuenta unos catorce minutos (`reservaDelServicioViva`): quien sigue por el camino de siempre lo usa para
 *   no dar por definitivo un tope de sorteos que es de esa reserva. Un pedido que no se mandó por falta de tiempo no deja
 *   nada que recordar. Uno que falla sin conexión cuenta como salido, porque desde acá no se distingue de un corte. La
 *   reserva se mira también cuando el mismo sorteo, ya marcado, se vuelve a guardar en la misma pestaña.
 * - **Seguro con el servicio de antes.** Nada de lo que hace seguro a este archivo depende de las respuestas nuevas
 *   (ocupado, tarde, el error interno sin mandar): con un servicio que no las conoce, cada respuesta cae en una regla de
 *   siempre. Solo lo hacen más barato.
 * - **Sin textos nuevos.** Los pasos son solo `sending` y `confirmed`: con la cuenta de Google ninguno pide aprobar nada.
 *
 * La lógica es pura: lo que toca la red y la pantalla entra por `Fuentes`, y se prueba con un reloj manual.
 */

/** Lo más que dura la etapa de pedirle al servicio, desde la entrada, antes de que acepte. */
export const TOPE_DEL_SERVICIO_MS = 20_000;
/** Lo que se le da a cada pedido. Un pedido tras una espera arranca solo si cabe entero antes de `TOPE_DEL_SERVICIO_MS`. */
export const TOPE_DEL_PEDIDO_MS = 10_000;
/** Tras un pedido que no contestó en su tope, otro arranca si queda al menos esto de la etapa, y se le da lo que quede. */
export const TOPE_MINIMO_DEL_PEDIDO_MS = 5_000;
/** Las esperas entre pedidos cuando el servicio dice que no mandó nada. */
export const ESPERAS_DEL_SERVICIO_MS = [2000, 4000] as const;
/** Cuánto se espera, desde que algo quedó incierto, antes de la lectura que decide. Cubre lo que el servicio tarde en cerrar. */
export const RESPIRO_DE_LA_DUDA_MS = 8_000;
/**
 * Lo más que dura la duda desde la entrada cuando la red no deja leer el contrato: lo mismo que el camino de siempre
 * (`PRESUPUESTO_DEL_SORTEO_MS`). Se sigue mirando sin mandar nada: el camino de siempre se recuperaba solo de un corte de
 * la red de unos segundos, y esto también.
 */
export const TOPE_DE_LA_DUDA_SIN_RED_MS = 90_000;
/** Cada cuánto se lee el sorteo mientras se duda. */
export const LEER_CADA_MS = 3_000;
/** Lo que se le da a cada lectura de la red. */
export const TOPE_DE_LECTURA_MS = 5_000;
/** Lo que se le da a cada lectura del contrato cuando la transacción ya entró: un celular lento tarda más y nada urge. */
export const TOPE_DE_LECTURA_DEL_QUE_ENTRO_MS = 12_000;
/** Lo que se sigue leyendo el contrato después de que la transacción entró, antes de rendirse. */
export const TOPE_DE_LAS_LECTURAS_DEL_QUE_ENTRO_MS = 30_000;
/**
 * Lo que se le da a un número de transacción que el servicio dio por repetido, sin haberlo visto pendiente, para que la red
 * lo conozca. Un repetido puede ser el de un envío cortado que quizás nunca llegó: con la red contestando y sin conocerlo,
 * no se espera más y se mira el contrato.
 */
export const VISTO_SIN_RED_MS = 15_000;
/** Lo más que la sala espera, desde la entrada, un envío del servicio que la red todavía no cerró: lo que vive la transacción de hoy. */
export const TOPE_DE_LA_SALA_MS = 60_000;
/** Cuánto se espera sin poder hablar con la red antes de rendirse (lo mismo que espera hoy un envío). */
export const SIN_RED_MS = 15_000;
/** La vida de la transacción del servicio, y la holgura entre el reloj del servicio y el de la red. */
export const VENTANA_DEL_SERVICIO_S = 240;
export const HOLGURA_DE_RELOJES_S = 30;
/** Cuánto se deja de lado al servicio en esta pestaña después de una falla suya. */
export const DISYUNTOR_MS = 600_000;
/** Lo mismo cuando lo que falló fue un mal momento de la red (una ronda que no llega, la red llena) y no el servicio. */
export const DISYUNTOR_CORTO_MS = 60_000;
const ULTIMA_VUELTA_MS = 10_000;
const LECTURAS_VACIAS_DEL_QUE_ENTRO = 3;
const ENTRE_LECTURAS_DEL_QUE_ENTRO_MS = 2_000;
const YA_DICHO_POR_EL_SERVICIO_MS = 10_000;
const RED_CONTESTANDO_MS = 5_000;

/** Lo que dice el contrato de un sorteo. */
export interface Ganadores {
  winners: number[];
  randomness: string;
}

export interface QuienSortea {
  /** `sorteoPorServidor()`: la red principal, `VITE_ALTA=1`, la dirección del servicio y `VITE_SORTEO_SERVIDOR=1`. */
  bandera: boolean;
  red: string;
  /** La demo, el ensayo o el modo stand: nada se graba. */
  ensayo: boolean;
  /** La cuenta es la de un proveedor que firma y manda sola. */
  cuentaDelProveedor: boolean;
  pagarConMiCuenta: boolean;
  /** La dirección del servicio, solo si tiene forma de portero de la red principal. */
  url: string | null;
  /** El servicio falló hace poco en esta pestaña. */
  apagadoPorAhora: boolean;
  /** Este sorteo ya quedó por el camino de siempre. */
  noParaEsteSorteo: boolean;
}

/** Las ocho condiciones, todas a la vez. Pura. */
export function usaElSorteoDelServicio(q: QuienSortea): boolean {
  return q.bandera && q.red === "mainnet" && !q.ensayo && q.cuentaDelProveedor && !q.pagarConMiCuenta && q.url !== null && !q.apagadoPorAhora && !q.noParaEsteSorteo;
}

/* --------------------------------------------------------- lo que se recuerda en esta pestaña */

/**
 * Un número de transacción que el servicio dio: cuándo se vio por primera vez (hora del reloj de la ronda, en segundos),
 * si alguna vez llegó como pendiente y para qué sorteo (`sorteo`, solo si llegó pendiente), y la hora de cierre del primer
 * ledger que la red dijo conocer (`cierre`, en segundos): con esa se acota el vencimiento si el reloj del aparato anda atrás.
 */
interface Visto {
  primera: number;
  pendiente: boolean;
  sorteo?: string;
  cierre?: number;
}
const vistos = new Map<string, Visto>();
/** Los sorteos que ya quedaron por el camino de siempre: no se le vuelve a pedir al servicio. */
const marcados = new Set<string>();
/**
 * Los sorteos para los que el servicio pudo dejar una reserva en su cupo del mes sin saber si el envío llegó, y hasta
 * cuándo. Esa reserva se cierra sola en unos catorce minutos, y mientras tanto cuenta como un sorteo más de la cuenta.
 */
const reservas = new Map<string, number>();
/** Cuánto se da por viva una reserva del servicio de la que no se supo el final: un poco más de lo que tarda en cerrarla. */
export const RESERVA_DEL_SERVICIO_MS = 15 * 60_000;
let disyuntorHasta = 0;
/** Deja de lado al servicio hasta `hasta`, sin acortar un tiempo que ya estaba corriendo. */
const dejarDeLado = (hasta: number): void => {
  disyuntorHasta = Math.max(disyuntorHasta, hasta);
};

/** Olvida todo lo que se recordaba (las pruebas). Nada de esto se guarda en el navegador: una recarga lo pierde. */
export function reiniciarElServicio(): void {
  vistos.clear();
  marcados.clear();
  reservas.clear();
  disyuntorHasta = 0;
}

/**
 * Si el servicio pudo dejar reservado un sorteo de esta cuenta sin que se sepa cómo terminó: quien sigue por el camino de
 * siempre tiene que saber que un tope de sorteos del mes que se alcanza justo ahora puede ser de esa reserva y no del uso
 * real. Pura.
 */
export function reservaDelServicioViva(raffleId: bigint, ahora: () => number = Date.now): boolean {
  const hasta = reservas.get(claveDe(raffleId));
  return hasta !== undefined && ahora() < hasta;
}

/** El sorteo en esta red y en este contrato: los números arrancan en 1 en cada contrato. */
const claveDe = (id: bigint): string => `${network.name}|${network.contractId ?? ""}|${String(id)}`;

/** Si este sorteo lo manda el servicio, según lo que hay en esta pestaña. */
export function loTomaElServicio(raffleId: bigint, pagarConMiCuenta: boolean, ahora: () => number = Date.now): boolean {
  const url = configDelPortero().url;
  return usaElSorteoDelServicio({
    bandera: sorteoPorServidor(),
    red: network.name,
    ensayo: sinGrabar(),
    cuentaDelProveedor: esCuentaDePollar(activeWallet()),
    pagarConMiCuenta,
    url: url !== null && formaDePortero(url) !== null ? url : null,
    apagadoPorAhora: ahora() < disyuntorHasta,
    noParaEsteSorteo: marcados.has(claveDe(raffleId)),
  });
}

/* -------------------------------------------------------------------------- las fuentes */

/** Todo lo que toca la red, la pantalla o el reloj de la ronda. Se inyecta para probarlo con un reloj manual. */
export interface Fuentes {
  clave(id: bigint): string;
  /** En la demo y el ensayo: el error con que se niega a grabar. Si se puede grabar, `null`. */
  rechazoSinGrabar(): Promise<Error | null>;
  pedir(id: bigint, firma96: Uint8Array, signal: AbortSignal): Promise<RespuestaDelSorteo>;
  /** `getTransaction` del RPC vigente. */
  consultar(hash: string): Promise<RespuestaConsulta>;
  /** El sorteo que dice el contrato, o `null` si todavía no está. */
  leer(id: bigint): Promise<Ganadores | null>;
  /** Lo que devolvió la transacción ya confirmada, o `null` si no se entiende. */
  valorDe(valor: unknown): Promise<Ganadores | null>;
  /** Una lectura o una consulta falló: si el RPC no sirve, se pasa al otro. */
  alFallar(e: unknown): void;
  /** La red no tomó la transacción del servicio por estar llena: el chequeo de la red lo cuenta (amarillo). */
  saturada?(): void;
  /** Fija el RPC vigente mientras dura la confirmación. Devuelve cómo soltarlo. */
  fijar(): () => void;
  olvidarElEstado(): void;
  /** La hora de la red, en segundos (el reloj de la ronda). */
  horaDeLaRed(): number;
}

const hex = (b: ArrayLike<number>): string => Array.from(b as ArrayLike<number>, (n) => n.toString(16).padStart(2, "0")).join("");

/** Las fuentes de verdad. Lo pesado se baja recién cuando hace falta. */
export function fuentesDeVerdad(): Fuentes {
  return {
    clave: claveDe,
    rechazoSinGrabar: async () => {
      if (!sinGrabar()) return null;
      const { SIN_GRABAR } = await import("./anchor");
      return new Error(SIN_GRABAR);
    },
    pedir: (id, firma96, signal) => pedirElSorteo({ url: configDelPortero().url, raffleId: id, firma96, signal }),
    consultar: async (hash) => {
      const [{ server }, { leerConsulta }] = await Promise.all([import("../stellar/contract"), import("./envio-sdk")]);
      return leerConsulta(await server.getTransaction(hash));
    },
    leer: async (id) => (await import("./anchor")).readDraw(id),
    valorDe: async (valor) => {
      const { valorNativo } = await import("./envio-sdk");
      const nativo = await valorNativo(valor);
      const d = (nativo && typeof nativo === "object" && "unwrap" in nativo ? (nativo as { unwrap(): unknown }).unwrap() : nativo) as { winners?: unknown; randomness?: unknown } | null;
      if (!d || !Array.isArray(d.winners) || !(d.randomness instanceof Uint8Array)) return null;
      return { winners: d.winners.map(Number), randomness: hex(d.randomness) };
    },
    alFallar: (e) => void rpcRed().fallo(e),
    saturada: () => void import("../stellar/registro-red").then((m) => m.anotarSaturacion()),
    fijar: () => rpcRed().fijar(),
    olvidarElEstado,
    horaDeLaRed: horaDeLaRonda,
  };
}

/* --------------------------------------------------------------------- el reloj de pared */

const hayPagina = (): boolean => typeof document !== "undefined" && typeof document.addEventListener === "function";

/**
 * Espera `promesa` hasta `hastaMs` del reloj de pared. Si el temporizador se estiró (la pestaña estuvo en segundo plano),
 * al volver la pestaña se compara la hora y, si ya pasó, se abandona en el acto. Lo que se abandonó puede seguir por
 * detrás: `alAbandonar` lo corta si se puede (el pedido al servicio).
 */
function conTopeDeReloj<T>(promesa: Promise<T>, hastaMs: number, ahora: () => number, alAbandonar?: () => void): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    let terminado = false;
    const revisar = (): void => {
      if (ahora() >= hastaMs) abandonar();
    };
    const terminar = (): void => {
      terminado = true;
      clearTimeout(reloj);
      if (hayPagina()) document.removeEventListener("visibilitychange", revisar);
    };
    const abandonar = (): void => {
      if (terminado) return;
      terminar();
      alAbandonar?.();
      rechazar(new Error("sin-confirmar: tope de tiempo"));
    };
    const reloj = setTimeout(abandonar, Math.max(0, hastaMs - ahora()));
    if (hayPagina()) document.addEventListener("visibilitychange", revisar);
    promesa.then(
      (v) => {
        if (terminado) return;
        terminar();
        resolver(v);
      },
      (e: unknown) => {
        if (terminado) return;
        terminar();
        rechazar(e);
      },
    );
  });
}

/** Duerme `ms`, pero si al volver la pestaña ya pasó la hora, sigue en el acto. */
function dormirDeReloj(dormir: (ms: number) => Promise<void>, ms: number, ahora: () => number): Promise<void> {
  const hasta = ahora() + ms;
  return new Promise<void>((resolver) => {
    let terminado = false;
    const salir = (): void => {
      if (terminado) return;
      terminado = true;
      if (hayPagina()) document.removeEventListener("visibilitychange", revisar);
      resolver();
    };
    const revisar = (): void => {
      if (ahora() >= hasta) salir();
    };
    if (hayPagina()) document.addEventListener("visibilitychange", revisar);
    void dormir(ms).then(salir, salir);
  });
}

/* ---------------------------------------------------------------------------- la máquina */

export interface PedidoDelServicio {
  raffleId: bigint;
  /** La firma de la ronda, sin comprimir: los 96 bytes que pide `draw`. */
  firma96: Uint8Array;
  alPaso?: (step: AnchorStep, detail?: string) => void;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export type FinDelServicio =
  /** El sorteo está en la red. Con `txHash` si lo mandó el servicio y es el de este sorteo. */
  | { estado: "listo"; valor: { winners: number[]; randomness: string; txHash?: string }; yaEstaba: boolean }
  /** Un no que se muestra, o que no se sabe (`sin-confirmar`): no se manda nada más por el otro camino. */
  | { estado: "error"; error: unknown }
  /** El servicio no lo manda y la red no lo tiene: sigue el camino de siempre, con todo su presupuesto. */
  | { estado: "camino-de-hoy" };

const mismosNumeros = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

type Lectura = { ok: true; v: Ganadores | null } | { ok: false; error: unknown };

/**
 * Manda el sorteo por el servicio y dice cómo terminó. Nunca lanza. Quien llama decide, con `camino-de-hoy`, si sigue por
 * el camino de siempre.
 */
export async function sortearPorElServicio(p: PedidoDelServicio, f: Fuentes = fuentesDeVerdad()): Promise<FinDelServicio> {
  const ahora = p.ahora ?? Date.now;
  const dormirBase = p.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const alPaso = p.alPaso ?? (() => undefined);
  const clave = f.clave(p.raffleId);
  const esperar = (ms: number): Promise<void> => dormirDeReloj(dormirBase, ms, ahora);
  const conTope = <T>(promesa: Promise<T>, hasta: number, alAbandonar?: () => void): Promise<T> => conTopeDeReloj(promesa, hasta, ahora, alAbandonar);

  const rechazo = await f.rechazoSinGrabar();
  if (rechazo) return { estado: "error", error: rechazo };

  /** La hora de la entrada: de acá se miden los topes de la sala, que no se reinician con una vuelta. */
  const inicio = ahora();
  /** El comienzo de la etapa de pedir. Una vuelta por un sello gemelo arranca otra etapa, pero no pasa del minuto de la sala. */
  let entrada = inicio;
  const hastaSala = inicio + TOPE_DE_LA_SALA_MS;
  alPaso("sending");

  const caminoDeHoy = (o: { marca?: boolean; disyuntor?: boolean; disyuntorCorto?: boolean } = {}): FinDelServicio => {
    if (o.marca) marcados.add(clave);
    if (o.disyuntor) dejarDeLado(ahora() + DISYUNTOR_MS);
    else if (o.disyuntorCorto) dejarDeLado(ahora() + DISYUNTOR_CORTO_MS);
    return { estado: "camino-de-hoy" };
  };
  const listo = (v: Ganadores, yaEstaba: boolean, txHash?: string): FinDelServicio => ({
    estado: "listo",
    valor: { winners: [...v.winners], randomness: v.randomness, ...(txHash ? { txHash } : {}) },
    yaEstaba,
  });
  const sinConfirmar = (causa: unknown, txHash?: string): FinDelServicio => ({
    estado: "error",
    error: Object.assign(new Error("sin-confirmar", { cause: causa }), txHash ? { txHash } : {}),
  });

  /** Lee el sorteo en la red con su tope. Un error de lectura no lanza: avisa al RPC y se devuelve. */
  const leer = async (hastaMs: number, topeMs: number = TOPE_DE_LECTURA_MS): Promise<Lectura> => {
    try {
      return { ok: true, v: await conTope(f.leer(p.raffleId), Math.min(ahora() + topeMs, hastaMs)) };
    } catch (e) {
      f.alFallar(e);
      return { ok: false, error: e };
    }
  };

  /** Lo que se hace con una respuesta que dejó todo incierto: mirar la red hasta saber. */
  const duda = async (): Promise<FinDelServicio> => {
    const t0 = ahora();
    const fin = inicio + TOPE_DE_LA_DUDA_SIN_RED_MS;
    let ultimoError: unknown = new Error("sin-confirmar");
    for (let vuelta = 0; ; vuelta++) {
      // La primera lectura se hace siempre: si la pestaña volvió con el reloj adelantado, igual hay que mirar la red.
      const l = await leer(vuelta === 0 ? Number.POSITIVE_INFINITY : fin);
      if (l.ok && l.v) return listo(l.v, true);
      if (l.ok) {
        // Limpio y vacío. El respiro cubre lo que el servicio tarde en cerrar lo que mandó hace un instante.
        if (ahora() >= t0 + RESPIRO_DE_LA_DUDA_MS) return caminoDeHoy({ marca: true, disyuntor: true });
      } else {
        ultimoError = l.error;
      }
      if (ahora() >= fin) return sinConfirmar(ultimoError);
      const cuanto = l.ok ? Math.min(LEER_CADA_MS, Math.max(1, t0 + RESPIRO_DE_LA_DUDA_MS - ahora())) : LEER_CADA_MS;
      await esperar(Math.min(cuanto, fin - ahora()));
    }
  };

  /** El servicio dice que el sorteo ya está hecho: se comprueba en la red antes de creerlo. */
  const yaDicho = async (): Promise<FinDelServicio> => {
    const hasta = ahora() + YA_DICHO_POR_EL_SERVICIO_MS;
    for (;;) {
      const l = await leer(hasta);
      if (l.ok && l.v) return listo(l.v, true);
      if (ahora() + LEER_CADA_MS > hasta) {
        // El servicio acaba de decir que el sorteo existe: si la red no se deja leer, no se sabe nada y no se manda por el
        // otro camino. Sin marca, el botón Guardar vuelve a preguntar.
        if (!l.ok) return sinConfirmar(l.error);
        // Limpio y vacío: el servicio aseguró que no manda nada y el camino de siempre lo encuentra con su propia
        // simulación. Con la marca, un nuevo clic en Guardar no vuelve a pasar por acá.
        return caminoDeHoy({ marca: true });
      }
      await esperar(LEER_CADA_MS);
    }
  };

  /**
   * Un final sin confirmar no se da por perdido mientras quede lo que da el camino de siempre (`TOPE_DE_LA_DUDA_SIN_RED_MS`
   * desde la entrada): el camino de siempre se recuperaba solo de una red lenta, y esto también. Solo se mira el contrato:
   * no se manda nada.
   */
  const rematar = async (fin: FinDelServicio): Promise<FinDelServicio> => {
    if (fin.estado !== "error" || !(fin.error instanceof Error) || fin.error.message !== "sin-confirmar") return fin;
    const hasta = inicio + TOPE_DE_LA_DUDA_SIN_RED_MS;
    while (ahora() + LEER_CADA_MS < hasta) {
      await esperar(LEER_CADA_MS);
      const l = await leer(hasta);
      if (l.ok && l.v) return listo(l.v, true);
    }
    return fin;
  };

  let volvioAPedir = false;

  /** El servicio mandó el sorteo: se confirma en la red. `"otra-vez"` es el caso de un sello gemelo. */
  const confirmar = async (hash: string, pendienteAhora: boolean): Promise<FinDelServicio | "otra-vez"> => {
    const visto: Visto = vistos.get(hash) ?? { primera: f.horaDeLaRed(), pendiente: false };
    vistos.set(hash, visto);
    if (pendienteAhora) {
      visto.pendiente = true;
      visto.sorteo = clave;
    }
    const esPendiente = visto.pendiente;
    // Solo una transacción que el servicio dijo pendiente para ESTE sorteo es seguro que es de este sorteo.
    const esPropio = visto.pendiente && visto.sorteo === clave;
    /** El número que va en un error: solo el de una transacción que es de este sorteo. Un repetido puede ser de un gemelo. */
    const hashDelError = esPropio ? hash : undefined;
    const primera = visto.primera;
    alPaso("sending", hash);
    const venceEn = Math.floor(primera) + VENTANA_DEL_SERVICIO_S + HOLGURA_DE_RELOJES_S;
    let ultimaRespuesta = Number.NEGATIVE_INFINITY;
    const consultar = async (): Promise<RespuestaConsulta> => {
      const c = await conTope(f.consultar(hash), ahora() + TOPE_DE_LECTURA_MS);
      ultimaRespuesta = ahora();
      if (!Number.isFinite(c.cierre)) return c;
      // El vencimiento se compara con la hora de cierre de la red: si el reloj del aparato anda atrás, `venceEn` queda
      // antes de lo real y una transacción que sigue viva se daría por vencida. Se toma lo que dice la red, y se corre
      // la hora de cierre que ve quien compara en lo mismo.
      visto.cierre ??= c.cierre;
      const corrido = Math.max(0, visto.cierre + VENTANA_DEL_SERVICIO_S + HOLGURA_DE_RELOJES_S - venceEn);
      return corrido > 0 ? { ...c, cierre: c.cierre - corrido } : c;
    };
    const suelta = f.fijar();
    try {
      /**
       * Entró: el resultado sale del contrato para este sorteo, y el enlace solo si la transacción es de este sorteo y lo
       * que devolvió coincide. Si el contrato no se deja leer, o se lee vacío porque el RPC está atrasado, y la transacción es
       * de este sorteo, vale lo que devolvió en la red. Si no, se sigue leyendo un rato y no se manda nada más.
       */
      const entro = async (valor: unknown): Promise<FinDelServicio | "otra-vez"> => {
        // También después de entrar, el tope es el de siempre: 90 segundos desde la entrada. La primera lectura se hace siempre,
        // como en la duda: una pestaña que vuelve de segundo plano pasada esa hora igual mira el contrato una vez.
        const fin = inicio + TOPE_DE_LA_DUDA_SIN_RED_MS;
        const hasta = Math.min(ahora() + TOPE_DE_LAS_LECTURAS_DEL_QUE_ENTRO_MS, fin);
        let devuelto: Promise<Ganadores | null> | undefined;
        /** Lo que devolvió en la red la transacción de este sorteo, leído una sola vez. */
        const valorPropio = (): Promise<Ganadores | null> => (devuelto ??= Promise.resolve().then(() => f.valorDe(valor)).catch(() => null));
        let vacias = 0;
        let ultimoError: unknown = null;
        for (let vuelta = 0; ; vuelta++) {
          const l = await leer(vuelta === 0 ? Number.POSITIVE_INFINITY : fin, TOPE_DE_LECTURA_DEL_QUE_ENTRO_MS);
          if (l.ok && l.v) {
            const propio = esPropio ? await valorPropio() : null;
            const coincide = !!propio && mismosNumeros(propio.winners, l.v.winners) && propio.randomness.toLowerCase() === l.v.randomness.toLowerCase();
            if (coincide) {
              alPaso("confirmed", hash);
              return listo(l.v, false, hash);
            }
            return listo(l.v, true);
          }
          if (esPropio) {
            // La transacción es de este sorteo y entró bien: el contrato tiene el sorteo. Si no se deja leer, o el que se lee
            // está atrasado y lo da vacío, vale lo que devolvió en la red.
            const propio = await valorPropio();
            if (propio) {
              alPaso("confirmed", hash);
              return listo(propio, false, hash);
            }
          }
          if (l.ok) {
            vacias++;
          } else {
            vacias = 0;
            ultimoError = l.error;
          }
          if (vacias >= LECTURAS_VACIAS_DEL_QUE_ENTRO) {
            // Entró una transacción que no es de este sorteo (un sello gemelo, con la misma lista y la misma ronda): el
            // servicio ya cerró la del gemelo y manda la de este número. Se pide una sola vez más.
            if (!volvioAPedir) {
              volvioAPedir = true;
              return "otra-vez";
            }
            return caminoDeHoy({ marca: true });
          }
          if (ahora() >= hasta) return sinConfirmar(ultimoError, hashDelError);
          await esperar(Math.min(l.ok ? ENTRE_LECTURAS_DEL_QUE_ENTRO_MS : LEER_CADA_MS, Math.max(0, hasta - ahora())));
        }
      };

      /** La red cerró el envío del servicio sin dejar este sorteo hecho, o no se sabe. */
      const sinSorteo = async (): Promise<FinDelServicio> => {
        const l = await leer(Number.POSITIVE_INFINITY);
        if (l.ok && l.v) return listo(l.v, true);
        if (l.ok) return caminoDeHoy({ marca: true });
        return sinConfirmar(l.error, hashDelError);
      };

      const resolver = async (d: Desenlace, ultima: boolean): Promise<FinDelServicio | "otra-vez"> => {
        if (d.estado === "entro") return entro(d.valor);
        if (d.estado === "fallo" || d.estado === "vencida" || d.estado === "rechazada") return sinSorteo();
        // Sin respuesta de la red.
        if (!esPendiente && ahora() - ultimaRespuesta <= RED_CONTESTANDO_MS) {
          // Un repetido que la red, contestando, no conoce: no es una respuesta del servicio que se pueda comprobar.
          return sinSorteo();
        }
        if (esPendiente && ahora() >= hastaSala && ahora() - ultimaRespuesta <= RED_CONTESTANDO_MS) {
          // No es un fallo de la red: el envío sigue vivo y tarda más de lo que la sala espera. Una última mirada al contrato.
          // Hoy una transacción de una cuenta de Google vive un minuto y, vencida, se arma y se manda otra: con la red ocupada
          // la sala tiene que recuperarse igual. Con la red contestando y el sorteo todavía sin estar, se sigue por el camino
          // de siempre: el contrato acepta uno solo, y si el envío del servicio entra después, uno de los dos falla con
          // `AlreadyDrawn` (cuesta una comisión y no cambia el resultado). Si el contrato no se deja leer, no se manda nada.
          const l = await leer(Number.POSITIVE_INFINITY);
          if (l.ok && l.v) return listo(l.v, true);
          return l.ok ? caminoDeHoy({ marca: true }) : sinConfirmar(l.error, hashDelError);
        }
        if (ultima) return sinConfirmar(d.error, hashDelError);
        f.alFallar(d.error);
        // Una última vuelta corta: la red puede haber vuelto.
        const hasta = ahora() + ULTIMA_VUELTA_MS;
        try {
          const c = await conTope(f.consultar(hash), Math.min(ahora() + TOPE_DE_LECTURA_MS, hasta));
          if (c.status === "SUCCESS") return resolver({ estado: "entro", ...(c.valor !== undefined ? { valor: c.valor } : {}) }, true);
          if (c.status === "FAILED") return resolver({ estado: "fallo" }, true);
        } catch (e) {
          f.alFallar(e);
        }
        const l = await leer(hasta);
        if (l.ok && l.v) return listo(l.v, true);
        return sinConfirmar(d.error, hashDelError);
      };

      // La transacción del servicio vive 240 segundos y la de hoy 60: la sala no espera más que un minuto desde la entrada.
      const topeDeLaSalaMs = Math.max(3_000, hastaSala - ahora());
      const topeTotalMs = Math.min(topeDeLaSalaMs, esPendiente ? Math.max(0, venceEn - f.horaDeLaRed()) * 1000 + RED_CONTESTANDO_MS : Math.max(3_000, (primera + VISTO_SIN_RED_MS / 1000 - f.horaDeLaRed()) * 1000));
      const d = await enviarYConfirmar({ consultar, venceEn, sinRedMs: SIN_RED_MS, topePedidoMs: TOPE_DE_LECTURA_MS, topeTotalMs, ahora, dormir: esperar });
      return await resolver(d, false);
    } finally {
      suelta();
    }
  };

  for (;;) {
    // La etapa de pedirle al servicio: como mucho `TOPE_DEL_SERVICIO_MS` desde su comienzo, y sin pasar del minuto de la sala.
    const hastaServicio = Math.min(entrada + TOPE_DEL_SERVICIO_MS, hastaSala);
    let vez = 0;
    let siguiente: FinDelServicio | "otra-vez" | null = null;
    while (siguiente === null) {
      const topePedido = Math.min(TOPE_DEL_PEDIDO_MS, hastaServicio - ahora());
      if (topePedido <= 0) {
        // La pestaña volvió de segundo plano con la etapa ya vencida. Un pedido sin tiempo no se manda: podría llegar al servicio
        // y salir después de que esta pestaña siguió de largo. Lo que hayan dejado los pedidos de antes se mira en la red.
        siguiente = await duda();
        break;
      }
      const ac = new AbortController();
      let porTope = false;
      let r: RespuestaDelSorteo;
      try {
        r = await conTope(f.pedir(p.raffleId, p.firma96, ac.signal), ahora() + topePedido, () => {
          porTope = true;
          ac.abort();
        });
      } catch {
        // Un corte, un tope o una respuesta que no se entiende: puede haber salido.
        r = { accion: "incierto" };
      }
      // Si el pedido salió y no se sabe cómo terminó, el servicio puede tener reservado este sorteo en el cupo de la cuenta.
      if (r.accion === "mandado" || r.accion === "red-del-servicio" || r.accion === "incierto") reservas.set(clave, ahora() + RESERVA_DEL_SERVICIO_MS);
      if (r.accion === "hoy") {
        if (r.olvidar) f.olvidarElEstado();
        siguiente = caminoDeHoy(r);
      } else if (r.accion === "error") {
        siguiente = { estado: "error", error: r.error };
      } else if (r.accion === "espera") {
        const espera = r.fijaMs ?? (ESPERAS_DEL_SERVICIO_MS[Math.min(vez, ESPERAS_DEL_SERVICIO_MS.length - 1)] as number);
        vez++;
        // La red llena se anota para el aviso de red saturada, como lo hace el envío de siempre.
        if (r.causa === "ocupada") f.saturada?.();
        // Otro pedido tiene que caber entero: si no, el servicio aseguró que no mandó y se sigue por el camino de siempre.
        // Antes se mira el contrato una vez: una red ocupada o una secuencia a veces responden después de haber mandado.
        // Un servicio que no puede en 20 segundos se deja de lado diez minutos, para que el siguiente sorteo no pague la
        // etapa. Si la causa fue la red (una ronda que no llega, la red llena) y no el servicio, solo un minuto.
        if (ahora() + espera + TOPE_DEL_PEDIDO_MS > hastaServicio) {
          const l = await leer(Number.POSITIVE_INFINITY);
          const deLaRed = r.causa === "ronda" || r.causa === "ocupada";
          siguiente = l.ok && l.v ? listo(l.v, true) : caminoDeHoy({ marca: true, ...(deLaRed ? { disyuntorCorto: true } : { disyuntor: true }) });
        } else await esperar(espera);
      } else if (r.accion === "red-del-servicio" && ahora() + (ESPERAS_DEL_SERVICIO_MS[Math.min(vez, ESPERAS_DEL_SERVICIO_MS.length - 1)] as number) + TOPE_MINIMO_DEL_PEDIDO_MS <= hastaServicio) {
        // Un error del RPC del servicio, quizás antes de mandar y quizás después: pedir otra vez es seguro (devuelve el mismo
        // número si ya salió). Un tropiezo de un instante no deja a la sala sin el servicio.
        await esperar(ESPERAS_DEL_SERVICIO_MS[Math.min(vez, ESPERAS_DEL_SERVICIO_MS.length - 1)] as number);
        vez++;
      } else if (r.accion === "ya") {
        siguiente = await yaDicho();
      } else if (r.accion === "mandado") {
        f.olvidarElEstado();
        siguiente = await confirmar(r.hash, r.pendiente);
      } else if (porTope && hastaServicio - ahora() >= TOPE_MINIMO_DEL_PEDIDO_MS) {
        // El servicio no contestó en su tope. Se vuelve a pedir una vez: los pedidos iguales comparten un solo trabajo allá, así
        // que no cuesta nada, y la respuesta (el envío, ocupado o tarde) sale antes del fin de la etapa. Con el servicio de
        // antes, el repetido: no manda dos veces el mismo sello y devuelve el mismo número.
        vez++;
      } else {
        // Un corte, o un tope sin lugar para otro pedido: se mira la red hasta saber, sin mandar nada por el otro camino.
        siguiente = await duda();
      }
    }
    if (siguiente !== "otra-vez") return rematar(siguiente);
    // Otra etapa de pedir cabe solo si queda lugar en el minuto de la sala: la vuelta no reinicia el tope.
    if (hastaSala - ahora() < TOPE_DEL_PEDIDO_MS) return caminoDeHoy({ marca: true });
    entrada = ahora();
  }
}
