/**
 * Le cuenta a la sala de la campaña lo que pasó en el sorteo de siempre, y la sala lo comprueba en la red: que el sorteo
 * quedó sellado (con la lista que pasó el panel) y cuál fue el resultado. Nunca manda lista, huella ni ganadoras: manda el
 * número del sorteo y el comprobante, y la sala lee el resto del contrato.
 *
 * El aviso de sellada es lo delicado. La sala solo lo acepta si la ronda todavía no salió (con 3 segundos de margen), y un
 * aviso rechazado por tarde le cuesta un sorteo a quien organiza. Por eso sale en el mismo turno en que la red confirma el
 * sello, sin esperar nada, y se repite hasta 5 segundos antes de la ronda y nunca después. Los pedidos no se cortan antes de
 * tiempo (el Worker lee la red hasta 10 segundos por cada RPC y un aviso que tarda igual entra): viven hasta 25 segundos
 * después de la ronda, y la decisión final de si se llegó o no se toma recién cuando ya nada puede cambiarla.
 *
 * Todo lo de afuera (la sala, el reloj, la pantalla) entra por `DepsDelResultado`, para probarlo sin red ni reloj. Nada de lo
 * que pasa por acá puede llevar el token de la sala, la clave de los nombres ni el token de la sesión: ni a la consola, ni a
 * un error, ni al detalle de un evento, ni al paso que dibuja el panel.
 */
import { type SorteoDeCampana, conSorteoSinResolver } from "../campana/en-curso";
import { formaDeLista } from "../campana/forma-de-lista";
import {
  type FilaDeGanadora,
  type PasoDelPuente,
  accionesDelPuente,
  pasoDelPuente,
  ponerPaso,
  ponerRechazo,
  registrarAcciones,
} from "../campana/puente";
import { roundTime } from "../protocol/quicknet";
import type {
  EstadoDeSala,
  FallaDeCodigos,
  FallaDeSala,
  FaseDeSala,
  RespuestaDeAviso,
  RespuestaDeResultado,
  RespuestaDeSellada,
  ResultadoDeSala,
  SalaDeCampana,
} from "../sala/campana-org";

/** Lo que se ve de la pantalla del sorteo: el sello que tiene, y si ya se sorteó. */
export interface SelloEnPantalla {
  raffleId: bigint | undefined;
  names: readonly string[];
  sinSello: boolean;
  round: number;
}

/** Lo que se sabe del sorteo ya hecho en pantalla. */
export interface SorteoHecho {
  /** La grabación del sorteo en la red ya terminó. */
  guardado: boolean;
  /** Las cuentas de quienes ganaron, en orden de puesto, o `null` si lo grabado no coincide con lo calculado. */
  ganadoras: string[] | null;
}

export interface DepsDelResultado {
  /** La sala de la campaña activa en esta red, con su token. */
  sala: () => SalaDeCampana | null;
  /** La fase en que esta compu recuerda esa sala. */
  faseDeLaSala: () => FaseDeSala | null;
  fijarFase: (fase: "sellada" | "sorteada") => void;
  entrada: () => SorteoDeCampana | null;
  guardar: (e: SorteoDeCampana) => void;
  sellado: () => SelloEnPantalla | null;
  sorteado: () => SorteoHecho | null;
  sinGrabar: () => boolean;
  /** La red y el contrato de esta pestaña. */
  contrato: () => string | null;
  /** Milisegundos, del reloj de la ronda (el que cuenta la espera), corregido con la hora de la sala si el propio no se midió. */
  ahora: () => number;
  /** Anota la hora que dijo la sala en una respuesta, si la dijo. */
  anotarHoraDeLaSala: (ms: number | null) => void;
  huella: (names: readonly string[]) => string;
  ponerSellada: (s: SalaDeCampana, sorteo: string, plazoMs: number) => Promise<{ r: RespuestaDeSellada; horaSala: number | null }>;
  estado: (s: SalaDeCampana) => Promise<EstadoDeSala | FallaDeSala>;
  guardarResultado: (s: SalaDeCampana, sorteo: string, comprobante: string) => Promise<RespuestaDeResultado>;
  /** `mezclada`: la sala devolvió ganadoras de cuenta junto a líneas de persona. No se sortea y reintentar no lo cambia. */
  resultado: (s: SalaDeCampana) => Promise<ResultadoDeSala | "sin-resultado" | "no-existe" | "red" | "mezclada">;
  avisar: (s: SalaDeCampana, cuenta: string) => Promise<RespuestaDeAviso>;
  /**
   * Los códigos de entrega de las ganadoras, en orden de puesto: solo se piden en una campaña de personas. Cada pedido lleva su
   * propio tope de tiempo y no se guarda en ningún lado: el código vive en la memoria de la pestaña.
   */
  codigos: (s: SalaDeCampana) => Promise<string[] | FallaDeCodigos>;
  /** Se puede soltar el sello de la pantalla: no hay juego en marcha ni pantalla grande abierta ni sorteo hecho. */
  sePuedeSoltar: () => boolean;
  /** Suelta el sello de la pantalla (deja el cuadro vacío): sigue el paso entero de pasar la lista. */
  soltarElSello: () => Promise<void> | void;
  /** Cómo se llama a una ganadora en la fila: su nombre, o algo que no dice nada de quién es. `puesto` empieza en 0. */
  nombreDe: (cuenta: string, puesto: number) => string;
  /** Si quien organiza entró con otra billetera que la de Google: el acceso de quien gana no se puede avisar solo. */
  otraBilletera: () => boolean;
  /**
   * Todavía no hay billetera activa: tras una recarga la sesión de Google se retoma aparte y puede llegar después de la sala.
   * Mientras sea cierto, `otraBilletera` no es una respuesta y no se dice que es otra billetera. Sin esta función, nunca pendiente.
   */
  billeteraPendiente?: () => boolean;
  /** Avisa cada vez que cambia la sesión de la página. Devuelve cómo dejar de escuchar. */
  alLlegarLaSesion?: (f: () => void) => () => void;
  /**
   * Hay una sala guardada en esta compu que esta cuenta todavía no puede mover: no hay sesión, o es una memoria de antes que no
   * dice de quién es y falta completarla. Con otra cuenta conectada no cuenta: esa sala no es de esta cuenta. Sin esta función,
   * nunca.
   */
  sinPoderMoverLaSala?: () => boolean;
  /** Completa la memoria de antes con la organizadora de la sala (con sesión) y vuelve cuando terminó, sirvió o no. */
  completarLaCuenta?: () => Promise<void>;
  /** Arranca el aviso de las cuentas ganadoras al servicio que da el acceso (después de que la sala dio su sí). */
  iniciarAltas: (sorteo: string, ganadoras: string[], alCambiar: () => void) => void;
  altasDe: () => Record<string, import("../campana/en-curso").EstadoDeAltaPremio>;
  esperar: (ms: number) => Promise<void>;
}

/* ------------------------------------------------------------ los tiempos */

/** Tras guardar el resultado, cuántas veces se vuelve a leer si la lectura dice que todavía no hay, y cuánto se espera entre una y otra. */
const REINTENTOS_TRAS_GUARDAR = 4;
const ESPERA_TRAS_GUARDAR_MS = 1_500;
/** Lo que se espera después de un fallo que llegó enseguida (la red caída): no se martilla. */
const ESPERA_TRAS_FALLO_MS = 2_000;
/** Si un pedido no contestó en tanto, sale otro del mismo sorteo sin cortar el anterior: la sala los ordena. */
const ESPERA_ENTRE_ENVIOS_MS = 8_000;
const MAX_EN_VUELO = 3;
/** El último envío sale como mucho tanto antes de la ronda: la sala corta 3 segundos antes y el viaje necesita su margen. */
const MARGEN_DE_ENVIO_MS = 5_000;
/** Un pedido vive hasta tanto después de la ronda: el Worker lee la red antes de mirar la hora. */
const VIDA_DEL_PEDIDO_MS = 25_000;
/** Pasado esto de la ronda (3 segundos antes, menos lo que dura un pedido) ya nada puede cambiar lo que dice la sala. */
const DECISION_TRAS_LA_RONDA_MS = VIDA_DEL_PEDIDO_MS - 3_000;
const ESPERA_DE_ESTADO_MS = 5_000;
const PREGUNTAS_DE_ESTADO = 12;
/** Lo máximo que se espera a que se retome la sesión antes de decir que es otra billetera: lo mismo que la cabecera. */
const ESPERA_DE_LA_SESION_MS = 12_000;
/** Cuántas veces seguidas la sala puede decir que el pedido está mal formado antes de dejar de insistir: no mejora solo. */
const MAX_RESPUESTAS_MAL_FORMADAS = 3;
/** Los códigos de entrega: tres pedidos con dos segundos entre uno y otro, cada uno con su tope. Como mucho 34 segundos. */
export const INTENTOS_DE_CODIGOS = 3;
export const ESPERA_DE_CODIGOS_MS = 2_000;
export const PLAZO_DE_CODIGOS_MS = 10_000;
const REINTENTO_RESULTADO_MS = 10_000;
const VIDA_DEL_REINTENTO_MS = 120_000;

/** El comprobante sin el dominio, como lo guarda la sala: el camino, la búsqueda y el fragmento. `null` si no es de verificar. */
export function caminoDelComprobante(enlace: string): string | null {
  try {
    const u = new URL(enlace, "https://tinkazo.invalid");
    const camino = `${u.pathname}${u.search}${u.hash}`;
    return camino.startsWith("/verificar.html") ? camino : null;
  } catch {
    return null;
  }
}

const unicos = (xs: readonly string[]): string[] => [...new Set(xs)];

/* ------------------------------------------------------------ lo que corre ahora (uno por evento) */

interface AvisoEnCurso {
  sorteo: string;
  /** El sorteo que llegó mientras este seguía sin decisión final: se resuelve cuando este termine. */
  siguiente: string | null;
}
const avisando = new Map<string, AvisoEnCurso>();
let generacionDelResultado = 0;
let enviandoResultado: string | null = null;
/** El sello llegó a la red pero la cuenta no podía mover la sala: se avisa apenas pueda (al llegar la sesión o completarse). */
let selloSinAvisar = false;
const avisadasPorCelular = new Set<string>();
/** Vuelve a dibujar a las ganadoras con lo último que se sabe de cada una. */
let repintarGanadoras: (() => void) | null = null;

/**
 * Los códigos de entrega de la campaña de personas que está a la vista. Viven solo acá, en la memoria de la pestaña: nunca en
 * el almacenamiento del navegador, ni en la entrada local, ni en un registro.
 */
interface CodigosEnMano {
  sorteo: string;
  ganadoras: readonly string[];
  /** Todos los códigos, en orden de puesto, o `null` si todavía no se tienen. */
  codigos: readonly string[] | null;
  /** Se pidieron todas las veces y no se pudieron leer: el panel ofrece pedirlos de nuevo. */
  fallaron: boolean;
  /** Hay una serie de pedidos en marcha. */
  pidiendo: boolean;
  repintar: () => void;
}
let codigosEnMano: CodigosEnMano | null = null;
/**
 * En una campaña de personas: el último aviso a una ganadora no se pudo marcar. `null` fuera de ese modo, donde esto no existe
 * y el aviso fallido sigue callado como siempre. Se apaga con el próximo aviso que sale bien.
 */
let falloElAviso: boolean | null = null;

/** Para las pruebas: vuelve todo a como estaba. */
export function reiniciarElResultado(): void {
  avisando.clear();
  selloSinAvisar = false;
  generacionDelResultado = 0;
  enviandoResultado = null;
  avisadasPorCelular.clear();
  repintarGanadoras = null;
  codigosEnMano = null;
  falloElAviso = null;
}

function cambiarLaEntrada(d: DepsDelResultado, cambio: (e: SorteoDeCampana) => SorteoDeCampana): SorteoDeCampana | null {
  const e = d.entrada();
  if (!e) return null;
  const nueva = cambio(e);
  d.guardar(nueva);
  return nueva;
}

/* ------------------------------------------------------------ el sello */

/**
 * Le avisa a la sala que el sorteo quedó sellado, apenas la red lo confirma. Todas las comprobaciones son síncronas y el
 * primer pedido sale dentro de este mismo turno: entre la confirmación y el `fetch` no hay ningún `await` ni `import()`.
 */
export function publicarSellada(d: DepsDelResultado): void {
  if (d.sinGrabar()) return;
  const s = d.sala();
  const e = d.entrada();
  const f = d.sellado();
  if (!s && e && f && f.raffleId !== undefined && !f.sinSello && d.sinPoderMoverLaSala?.()) {
    // El sello quedó en la red y la sala no lo sabe: no se calla. Se dice que hace falta entrar, y se retoma al llegar la cuenta.
    // Si completar la cuenta alcanza, el aviso sale acá y la marca baja: la retomada siguiente no se gasta en este sello.
    selloSinAvisar = true;
    pedirLaCuenta(d, () => {
      selloSinAvisar = false;
      publicarSellada(d);
    });
    return;
  }
  if (!s || !e || !f || f.raffleId === undefined || f.sinSello) return;
  if (d.faseDeLaSala() !== "cerrada" || e.evento !== s.evento || e.red !== s.red || e.contrato !== (d.contrato() ?? "")) return;
  const sorteo = String(f.raffleId);
  // Una lista ya avisada o con un sorteo sin resolver no vuelve a publicarse: la sala queda atada a un solo sorteo.
  if (e.aviso === "hecho") return;
  const corriendo = avisando.get(e.evento);
  if (corriendo) {
    if (corriendo.sorteo !== sorteo) corriendo.siguiente = sorteo;
    return;
  }
  if (e.huella === "" || d.huella(f.names) !== e.huella) {
    ponerPaso({ paso: "otra-lista" });
    return;
  }
  ponerRechazo(null);
  const guardada = cambiarLaEntrada(d, (x) => ({
    ...x,
    sorteo,
    ronda: f.round,
    aviso: "pendiente",
    duda: false,
    mandados: unicos([...(x.mandados ?? []), sorteo]),
  }));
  if (!guardada) return;
  ponerPaso({ paso: "avisando" });
  void avisarHastaLaRonda(d, s, sorteo, f.round, true);
}

/**
 * Hay una sala en esta compu que esta cuenta todavía no puede mover (sin sesión, o una memoria de antes sin completar): se dice
 * en el panel, y mientras tanto se intenta completarla con la sesión. Con la cuenta ya completa se sigue con `seguir`.
 */
function pedirLaCuenta(d: DepsDelResultado, seguir: () => void): void {
  ponerPaso({ paso: "entrar-para-seguir" });
  void Promise.resolve(d.completarLaCuenta?.())
    .catch(() => undefined)
    .then(() => {
      if (d.sala()) seguir();
    });
}

type Resolucion = "hecho" | "rechazado" | "seguir";

/** Avisa sellada hasta 5 segundos antes de la ronda y nunca después, y decide recién cuando ya nada puede cambiar. */
async function avisarHastaLaRonda(d: DepsDelResultado, s: SalaDeCampana, sorteo: string, ronda: number, vigilar: boolean): Promise<void> {
  avisando.set(s.evento, { sorteo, siguiente: null });
  try {
    await correrElAviso(d, s, sorteo, ronda, vigilar);
  } finally {
    const fin = avisando.get(s.evento);
    avisando.delete(s.evento);
    const siguiente = fin?.siguiente ?? null;
    // Si quedó atado un sorteo que llegó mientras tanto, se resuelve ahora que el anterior tiene su decisión final.
    if (siguiente !== null) alTerminarOtro(d, siguiente);
  }
}

/** Con la decisión final del anterior tomada, el sorteo que esperaba se publica (si la sala sigue cerrada) o se descarta. */
function alTerminarOtro(d: DepsDelResultado, sorteo: string): void {
  const f = d.sellado();
  if (f?.raffleId === undefined || String(f.raffleId) !== sorteo) return;
  if (d.entrada()?.aviso === "hecho") {
    ponerPaso({ paso: "otro-sorteo" });
    return;
  }
  publicarSellada(d);
}

async function correrElAviso(d: DepsDelResultado, s: SalaDeCampana, sorteo: string, ronda: number, vigilar: boolean): Promise<void> {
  const rondaMs = roundTime(ronda) * 1000;
  const limiteDeEnvio = rondaMs - MARGEN_DE_ENVIO_MS;
  const finDelPedido = rondaMs + VIDA_DEL_PEDIDO_MS;
  const decision = rondaMs + DECISION_TRAS_LA_RONDA_MS;
  const llegadas: { r: RespuestaDeSellada; horaSala: number | null }[] = [];
  let enVuelo = 0;
  let ultimoEnvio = Number.NEGATIVE_INFINITY;
  let noAntesDe = Number.NEGATIVE_INFINITY;
  let fallos = 0;
  let malFormadas = 0;
  let despertar: (() => void) | null = null;
  const sigueEnPantalla = (): boolean => {
    if (!vigilar) return true;
    const f = d.sellado();
    return f !== null && f.raffleId !== undefined && String(f.raffleId) === sorteo;
  };
  const lanzar = (): void => {
    const plazo = Math.max(1, finDelPedido - d.ahora());
    enVuelo++;
    ultimoEnvio = d.ahora();
    const alLlegar = (x: { r: RespuestaDeSellada; horaSala: number | null }): void => {
      enVuelo--;
      llegadas.push(x);
      despertar?.();
    };
    d.ponerSellada(s, sorteo, plazo).then(alLlegar, () => alLlegar({ r: "red", horaSala: null }));
  };

  for (;;) {
    while (llegadas.length > 0) {
      const x = llegadas.shift();
      if (!x) break;
      d.anotarHoraDeLaSala(x.horaSala);
      const r = await resolver(d, s, sorteo, x.r);
      if (r === "hecho" || r === "rechazado") return;
      // Un pedido mal formado es un error de esta página y no mejora con más intentos: se dice y se deja de insistir.
      malFormadas = x.r === "forma" ? malFormadas + 1 : 0;
      if (malFormadas >= MAX_RESPUESTAS_MAL_FORMADAS) {
        ponerPaso({ paso: "aviso-roto" });
        return;
      }
      fallos++;
      noAntesDe = Math.max(noAntesDe, d.ahora() + ESPERA_TRAS_FALLO_MS);
    }
    const ahora = d.ahora();
    const proximoEnvio = enVuelo === 0 ? Math.max(ahora, noAntesDe) : Math.max(ultimoEnvio + ESPERA_ENTRE_ENVIOS_MS, noAntesDe);
    const puedeEnviar = enVuelo < MAX_EN_VUELO && ahora <= limiteDeEnvio && sigueEnPantalla();
    if (puedeEnviar && proximoEnvio <= ahora) {
      lanzar();
      continue;
    }
    if (ahora >= decision && enVuelo === 0) {
      await alVencerElPlazo(d, s, sorteo);
      return;
    }
    // En espera: mientras tanto el panel dice que se prueba solo (o que se está comprobando, ya sin mandar nada más).
    ponerPaso({ paso: ahora > limiteDeEnvio ? "comprobando" : fallos > 0 ? "no-avisamos" : "avisando" });
    const candidatos: number[] = [];
    if (puedeEnviar && proximoEnvio <= limiteDeEnvio) candidatos.push(proximoEnvio - ahora);
    // En el límite del último envío el panel deja de decir que se está avisando: ya no sale nada más.
    if (ahora <= limiteDeEnvio) candidatos.push(limiteDeEnvio - ahora + 1);
    if (ahora < decision) candidatos.push(decision - ahora);
    else if (enVuelo > 0) candidatos.push(Math.max(1, finDelPedido - ahora + 1));
    const espera = Math.max(1, Math.min(...candidatos));
    if (llegadas.length > 0) continue;
    await Promise.race([
      new Promise<void>((seguir) => {
        despertar = seguir;
      }),
      d.esperar(espera),
    ]);
    despertar = null;
  }
}

/** Qué hacer con cada respuesta de la sala al aviso de sellada. */
async function resolver(d: DepsDelResultado, s: SalaDeCampana, sorteo: string, r: RespuestaDeSellada): Promise<Resolucion> {
  if (r === "ok") {
    await quedoSellada(d, s, sorteo);
    return "hecho";
  }
  if (r === "fase") {
    // Un aviso repetido que ya había entrado también contesta fase: se pregunta en qué fase quedó la sala.
    const est = await d.estado(s);
    if (typeof est === "string") return est === "no-existe" || est === "token" ? rechazar(d, sorteo, est) : "seguir";
    if (est.fase === "sellada" || est.fase === "sorteada") {
      await quedoSellada(d, s, sorteo);
      return "hecho";
    }
    return est.fase === "abierta" || est.fase === "lista" ? rechazar(d, sorteo, "lista-distinta") : "seguir";
  }
  if (r === "red" || r === "sin-sorteo" || r === "forma") return "seguir";
  return rechazar(d, sorteo, r);
}

/** La sala quedó sellada: el aviso está hecho, y si el sorteo ya se reveló mientras tanto, el resultado sale enseguida. */
async function quedoSellada(d: DepsDelResultado, s: SalaDeCampana, sorteo: string): Promise<void> {
  const e = cambiarLaEntrada(d, (x) => ({
    ...x,
    sorteo,
    aviso: "hecho",
    // La sala no dice a qué sorteo quedó atada: con más de uno mandado, se sabe cuál es al sortear.
    duda: (x.mandados ?? []).some((m) => m !== sorteo),
  }));
  d.fijarFase("sellada");
  ponerRechazo(null);
  const f = d.sellado();
  const distinta = f?.raffleId !== undefined && String(f.raffleId) !== sorteo;
  ponerPaso({ paso: distinta ? "otro-sorteo" : "avisada" });
  if (e?.comprobante !== undefined && (e.resultado === "pendiente" || d.sorteado() !== null)) void mandarResultado(d, s, sorteo);
}

type MotivoDeRechazo = "ronda-pasada" | "lista-distinta" | "ganadores-distintos" | "organizador-distinto" | "no-existe" | "token";

/** El sello no sirve para esta campaña: se dice por qué, se suelta (si se puede) y la lista se vuelve a pasar. */
async function rechazar(d: DepsDelResultado, sorteo: string, motivo: MotivoDeRechazo): Promise<Resolucion> {
  const e = d.entrada();
  const paso: PasoDelPuente =
    motivo === "ronda-pasada"
      ? { paso: "tarde" }
      : motivo === "lista-distinta"
        ? { paso: "lista-cambio" }
        : motivo === "ganadores-distintos"
          ? { paso: "ganadoras", n: e?.premios ?? 1 }
          : motivo === "organizador-distinto"
            ? { paso: "otra-cuenta", fin: e?.organizadora?.slice(-4) ?? "" }
            : motivo === "token"
              ? { paso: "tomada" }
              : { paso: "sala-borrada" };
  // Respuesta definitiva de la sala para este sorteo: ya no cuenta como mandado sin respuesta.
  cambiarLaEntrada(d, (x) => {
    const nueva: SorteoDeCampana = { ...x, duda: false, mandados: (x.mandados ?? []).filter((m) => m !== sorteo) };
    // El comprobante y el resultado pendiente eran de ese sorteo: no deben viajar con el próximo sello de esta lista.
    if (x.sorteo === sorteo) {
      delete nueva.comprobante;
      delete nueva.resultado;
    }
    delete nueva.sorteo;
    delete nueva.ronda;
    delete nueva.aviso;
    return nueva;
  });
  ponerPaso(paso);
  if (motivo === "no-existe" || motivo === "token") return "rechazado";
  ponerRechazo(paso);
  if (d.sePuedeSoltar()) {
    await d.soltarElSello();
    // Toda suelta del sello vuelve a pasar la lista entera: el premio y la cantidad de ganadoras vuelven a ser los del archivo.
    accionesDelPuente().reintentarPaso?.();
  }
  return "rechazado";
}

/** Pasado el plazo de los pedidos: ahora sí se pregunta en qué quedó la sala, y se sigue preguntando si no contesta. */
async function alVencerElPlazo(d: DepsDelResultado, s: SalaDeCampana, sorteo: string): Promise<void> {
  for (let i = 0; i < PREGUNTAS_DE_ESTADO; i++) {
    const est = await d.estado(s);
    if (typeof est === "object") {
      if (est.fase === "sellada" || est.fase === "sorteada") return quedoSellada(d, s, sorteo);
      await rechazar(d, sorteo, est.fase === "cerrada" ? "ronda-pasada" : "lista-distinta");
      return;
    }
    if (est === "no-existe" || est === "token") {
      await rechazar(d, sorteo, est);
      return;
    }
    // No contestó: no se toma como cerrada. Queda en duda, guardada, y se vuelve a preguntar.
    ponerPaso({ paso: "comprobando" });
    await d.esperar(ESPERA_DE_ESTADO_MS);
  }
  // La sala no contestó en todo el minuto: la entrada sigue pendiente y quien organiza tiene una acción, no un cartel sin salida.
  ponerPaso({ paso: "no-comprobo" });
}

/** Escucha los dos eventos de la herramienta: el sello que entró y el que entró tarde. */
export function escucharSellos(d: DepsDelResultado): () => void {
  const alSellar = (): void => publicarSellada(d);
  document.addEventListener("tinkazo:sellado", alSellar);
  document.addEventListener("tinkazo:sello", alSellar);
  return () => {
    document.removeEventListener("tinkazo:sellado", alSellar);
    document.removeEventListener("tinkazo:sello", alSellar);
  };
}

/* ------------------------------------------------------------ el resultado */

function filasDelResultado(d: DepsDelResultado, ganadoras: readonly string[], enMano: boolean, codigos: readonly string[] | null = null): FilaDeGanadora[] {
  // En mano no hay servicio del acceso: ninguna fila lleva su estado de alta, aunque la entrada local guarde alguno.
  const altas: Record<string, import("../campana/en-curso").EstadoDeAltaPremio> = enMano ? {} : d.altasDe();
  return ganadoras.map((cuenta, puesto) => {
    const fila: FilaDeGanadora = {
      cuenta,
      nombre: d.nombreDe(cuenta, puesto),
      avisada: avisadasPorCelular.has(cuenta),
      alta: altas[String(puesto)] ?? "esperando",
    };
    // La fila solo lleva la clave del código cuando se tiene: así las de una campaña de cuentas quedan como siempre.
    const codigo = codigos?.[puesto];
    if (codigo !== undefined) fila.codigo = codigo;
    return fila;
  });
}

/**
 * Cuando el sorteo se revela: guarda el comprobante y, si la sala ya está sellada, se lo manda. Espera la promesa del
 * comprobante, que se arma aparte. Si el aviso de sellada todavía no terminó, el resultado sale apenas termine.
 */
export async function alRevelar(enlace: Promise<string>, d: DepsDelResultado): Promise<void> {
  if (d.sinGrabar()) return;
  const f = d.sellado();
  if (!f || f.raffleId === undefined) return;
  const sorteo = String(f.raffleId);
  const antes = d.entrada();
  if (!antes || (antes.sorteo !== sorteo && !(antes.mandados ?? []).includes(sorteo))) return;
  const url = await enlace.catch(() => "");
  const comprobante = url ? caminoDelComprobante(url) : null;
  const e = d.entrada();
  if (!comprobante || !e || (e.sorteo !== sorteo && !(e.mandados ?? []).includes(sorteo))) return;
  // Una sola vez por comprobante: si el resultado se revela otra vez (otro juego), el mismo no se vuelve a mandar.
  if (e.resultado === "hecho" && e.comprobante === comprobante) return;
  d.guardar({ ...e, sorteo: e.sorteo ?? sorteo, comprobante, resultado: "pendiente" });
  if (e.aviso === "hecho") void mandarResultado(d, d.sala(), sorteo);
}

/** Manda el resultado con reintentos cada 10 segundos durante 2 minutos, y después ofrece el botón. */
async function mandarResultado(d: DepsDelResultado, sala: SalaDeCampana | null, sorteo: string): Promise<void> {
  if (!sala) {
    // El resultado queda guardado como pendiente y sale solo cuando la cuenta pueda mover la sala: mientras tanto se dice.
    if (d.sinPoderMoverLaSala?.()) pedirLaCuenta(d, () => retomarAlArrancar(d));
    return;
  }
  const miGeneracion = ++generacionDelResultado;
  enviandoResultado = sorteo;
  const empezo = d.ahora();
  for (;;) {
    const e = d.entrada();
    const comprobante = e?.comprobante;
    if (!e || !comprobante) return;
    ponerPaso({ paso: "mandando" });
    const r = await d.guardarResultado(sala, sorteo, comprobante);
    if (miGeneracion !== generacionDelResultado) return;
    if (r === "ok") return void (await resultadoHecho(d, sala, sorteo, e));
    if (r === "token") return ponerPaso({ paso: "tomada" });
    if (r === "no-existe") return ponerPaso({ paso: "sala-borrada" });
    if (r === "distinto" || (r === "fase" && e.duda === true)) {
      // La sala quedó atada a otro sorteo de esta lista: este no es el que vale.
      return ponerPaso({ paso: "otro-sorteo" });
    }
    if (d.ahora() - empezo >= VIDA_DEL_REINTENTO_MS) {
      // La grabación del sorteo es la que tarda: sin ella la sala no tiene qué leer. Se dice eso y no se ofrece mandar.
      return ponerPaso({ paso: d.sorteado()?.guardado === false ? "guardar-sorteo" : "boton-resultado" });
    }
    await d.esperar(REINTENTO_RESULTADO_MS);
    if (miGeneracion !== generacionDelResultado) return;
  }
}

/** La sala ya tiene el resultado: el panel pasa a sorteada y dibuja a las ganadoras, y se avisa al servicio del acceso. */
async function resultadoHecho(d: DepsDelResultado, sala: SalaDeCampana, sorteo: string, e: SorteoDeCampana): Promise<void> {
  enviandoResultado = null;
  d.guardar({ ...e, resultado: "hecho" });
  d.fijarFase("sorteada");
  // La sala acaba de decir que guardó el resultado: si la lectura todavía dice que no hay, es un resto pasajero y se vuelve a mirar.
  await mostrarGanadoras(d, sala, sorteo, REINTENTOS_TRAS_GUARDAR);
}

/** Lee las ganadoras de la sala, las dibuja y, si coinciden con lo que se calculó acá, arranca el aviso al acceso. */
async function mostrarGanadoras(d: DepsDelResultado, sala: SalaDeCampana, sorteo: string, reintentos = 0): Promise<void> {
  let leido = await d.resultado(sala);
  for (let i = 0; i < reintentos && leido === "sin-resultado"; i++) {
    await d.esperar(ESPERA_TRAS_GUARDAR_MS);
    leido = await d.resultado(sala);
  }
  // Una mezcla de cuentas y líneas de persona no se sortea y volver a leer no la cambia: se dice y no hay botón.
  if (leido === "mezclada") return ponerPaso({ paso: "lista-rara" });
  if (typeof leido === "string") return ponerPaso({ paso: "boton-resultado" });
  const resultado = leido;
  // El premio en mano se sabe por las ganadoras mismas, no por un dato aparte que se pueda perder: si todas son líneas de
  // persona no hay cuenta ni billetera, así que no se espera la sesión, no se avisa al servicio del acceso y no se paga.
  if (formaDeLista(resultado.ganadoras) === "persona") {
    // Con las mismas ganadoras de este sorteo que ya se leyeron, los códigos que ya se tienen se conservan.
    const previo = codigosEnMano;
    const mismas =
      previo !== null &&
      previo.sorteo === sorteo &&
      previo.ganadoras.length === resultado.ganadoras.length &&
      previo.ganadoras.every((g, i) => g === resultado.ganadoras[i]);
    const estado: CodigosEnMano = {
      sorteo,
      ganadoras: resultado.ganadoras,
      codigos: mismas ? previo.codigos : null,
      fallaron: false,
      pidiendo: false,
      repintar: () => undefined,
    };
    const repintarEnMano = (): void =>
      ponerPaso({
        paso: "resultado",
        filas: filasDelResultado(d, resultado.ganadoras, true, estado.codigos),
        otraBilletera: false,
        enMano: true,
        ...(estado.fallaron && estado.codigos === null ? { sinCodigos: true as const } : {}),
        ...(falloElAviso === true ? { sinAviso: true as const } : {}),
      });
    estado.repintar = repintarEnMano;
    codigosEnMano = estado;
    if (!mismas || falloElAviso === null) falloElAviso = false;
    repintarGanadoras = repintarEnMano;
    // Primero se pintan las ganadoras: los códigos llegan después y repintan. Sin ellos la fila ya sirve.
    repintarEnMano();
    if (estado.codigos === null) void pedirLosCodigos(d, sala, estado);
    return;
  }
  falloElAviso = null;
  // Tras una recarga la sesión de Google se retoma aparte: hasta que llegue (o pase el tope) no se dice que es otra billetera.
  let esperandoLaSesion = d.otraBilletera() && (d.billeteraPendiente?.() ?? false);
  const repintar = (): void =>
    ponerPaso({ paso: "resultado", filas: filasDelResultado(d, resultado.ganadoras, false), otraBilletera: d.otraBilletera() && !esperandoLaSesion });
  repintarGanadoras = repintar;
  repintar();
  if (esperandoLaSesion) {
    await esperarLaSesion(d);
    esperandoLaSesion = false;
    repintar();
  }
  // El servicio del acceso solo se avisa con lo que la sala confirmó, y solo si es lo mismo que se calculó acá.
  const locales = d.sorteado()?.ganadoras ?? null;
  const coinciden = locales !== null && locales.length === resultado.ganadoras.length && locales.every((c, i) => c === resultado.ganadoras[i]);
  if (coinciden || d.sorteado() === null) {
    if (!d.otraBilletera()) d.iniciarAltas(sorteo, resultado.ganadoras, repintar);
  }
}

/**
 * Pide los códigos de entrega: hasta tres veces, con dos segundos entre una y otra y un tope por pedido, así que en el peor caso
 * tarda unos 34 segundos y termina. Con todos a la vista repinta las filas. Si ninguna vez se pudo, repinta con el aviso de que
 * no se leyeron, y el panel ofrece volver a pedirlos. Nunca deja la espera sin salida y nunca escribe un código en ningún lado.
 */
async function pedirLosCodigos(d: DepsDelResultado, sala: SalaDeCampana, estado: CodigosEnMano): Promise<void> {
  estado.pidiendo = true;
  estado.fallaron = false;
  const sigueVigente = (): boolean => codigosEnMano === estado;
  const repintarSiHaceFalta = (): void => {
    // Si el panel ya pasó a otro paso (otra compu tomó la campaña, por ejemplo), no se lo pisa: los códigos quedan guardados.
    if (pasoDelPuente().paso === "resultado") estado.repintar();
  };
  try {
    for (let i = 0; i < INTENTOS_DE_CODIGOS; i++) {
      if (i > 0) {
        await d.esperar(ESPERA_DE_CODIGOS_MS);
        if (!sigueVigente()) return;
      }
      const tope = d.esperar(PLAZO_DE_CODIGOS_MS).then((): "red" => "red");
      const pedido = Promise.resolve()
        .then(() => d.codigos(sala))
        .catch((): "red" => "red");
      const r = await Promise.race([pedido, tope]);
      if (!sigueVigente()) return;
      if (Array.isArray(r) && r.length === estado.ganadoras.length) {
        estado.codigos = r;
        repintarSiHaceFalta();
        return;
      }
    }
    estado.fallaron = true;
    repintarSiHaceFalta();
  } finally {
    estado.pidiendo = false;
  }
}

/** Espera a que haya una billetera activa, hasta el tope. Se vuelve a mirar cada vez que cambia la sesión de la página. */
async function esperarLaSesion(d: DepsDelResultado): Promise<void> {
  let vencio = false;
  const tope = d.esperar(ESPERA_DE_LA_SESION_MS).then(() => {
    vencio = true;
  });
  while (d.otraBilletera() && (d.billeteraPendiente?.() ?? false) && !vencio) {
    let dejar: () => void = () => undefined;
    const llego = new Promise<void>((seguir) => {
      dejar = d.alLlegarLaSesion?.(seguir) ?? dejar;
    });
    await Promise.race([llego, tope]);
    dejar();
  }
}

/** Escucha el comprobante que llega cuando termina la grabación del sorteo: la sala lo acepta en lugar del anterior. */
export function escucharComprobante(d: DepsDelResultado): () => void {
  const alLlegar = (ev: Event): void => {
    const enlace = (ev as CustomEvent<unknown>).detail;
    const comprobante = typeof enlace === "string" ? caminoDelComprobante(enlace) : null;
    const f = d.sellado();
    const e = d.entrada();
    if (!comprobante || !f || f.raffleId === undefined || !e) return;
    const sorteo = String(f.raffleId);
    if (e.sorteo !== sorteo || e.resultado === undefined || e.comprobante === comprobante) return;
    d.guardar({ ...e, comprobante, resultado: "pendiente" });
    if (e.aviso === "hecho") void mandarResultado(d, d.sala(), sorteo);
  };
  document.addEventListener("tinkazo:comprobante", alLlegar);
  return () => document.removeEventListener("tinkazo:comprobante", alLlegar);
}

/* ------------------------------------------------------------ las acciones del panel y el retomar */

/** Registra lo que el panel puede pedir: avisar a una ganadora, mandar el resultado, avisar a los celulares. */
export function registrarLasAcciones(d: DepsDelResultado): void {
  registrarAcciones({
    avisarA: (cuenta) => {
      const s = d.sala();
      if (!s) return;
      void d.avisar(s, cuenta).then((r) => {
        if (r === "token") return ponerPaso({ paso: "tomada" });
        if (r !== "ok") {
          // En mano el aviso es lo único que hace el botón: si no salió, se dice y el botón sigue para probar de nuevo.
          if (falloElAviso === null) return;
          falloElAviso = true;
          return repintarGanadoras?.();
        }
        if (falloElAviso === true) falloElAviso = false;
        avisadasPorCelular.add(cuenta);
        repintarGanadoras?.();
      });
    },
    mandarResultado: () => {
      const e = d.entrada();
      if (e?.sorteo) void mandarResultado(d, d.sala(), e.sorteo);
    },
    comprobarDeNuevo: () => retomarAlArrancar(d),
    verCodigos: () => {
      const e = codigosEnMano;
      const s = d.sala();
      if (!e || !s || e.codigos !== null || e.pidiendo) return;
      // Mientras se vuelve a pedir el enlace no se ofrece: el panel lo vuelve a mostrar solo si no se pudo otra vez.
      e.fallaron = false;
      e.repintar();
      void pedirLosCodigos(d, s, e);
    },
    avisarCelulares: () => {
      const e = d.entrada();
      const f = d.sellado();
      // Un toque tarde no manda nada: el límite se vuelve a mirar acá y no solo al dibujar el botón.
      if (!e || e.ronda === undefined || !f || d.ahora() >= roundTime(e.ronda) * 1000 - MARGEN_DE_ENVIO_MS) {
        ponerPaso({ paso: "comprobando" });
        return;
      }
      publicarSellada(d);
    },
  });
}

/**
 * Retoma lo que quedó a medias al cargar la página, sin depender de que el panel se monte: un aviso de sellada pendiente
 * (la sala comprueba todo en la red, el aviso se repite con el número guardado), un resultado pendiente, o el resultado
 * que ya tiene la sala. Se puede llamar más de una vez: lo que ya corre no arranca otra vez.
 */
export function retomarAlArrancar(d: DepsDelResultado): void {
  const s = d.sala();
  const antes = d.entrada();
  if (!s || !antes || antes.evento !== s.evento || antes.red !== s.red || d.sinGrabar()) return;
  // El sello que no se pudo avisar por falta de cuenta sale ahora que la sala se puede mover. Lo demás sigue en la misma vuelta:
  // si el aviso ya estaba hecho, el resultado pendiente o las ganadoras se retoman igual.
  if (selloSinAvisar) {
    selloSinAvisar = false;
    publicarSellada(d);
  }
  const e = d.entrada() ?? antes;
  if (e.evento !== s.evento || e.red !== s.red) return;
  if (e.aviso === "pendiente" && e.sorteo !== undefined && e.ronda !== undefined) {
    if (!avisando.has(s.evento)) {
      ponerPaso({ paso: "avisando" });
      void avisarHastaLaRonda(d, s, e.sorteo, e.ronda, false);
    }
    return;
  }
  if (e.aviso === "hecho" && e.sorteo !== undefined) {
    if (e.resultado === "pendiente" && e.comprobante !== undefined) {
      if (enviandoResultado !== e.sorteo) void mandarResultado(d, s, e.sorteo);
      return;
    }
    if (e.resultado === "hecho" || d.faseDeLaSala() === "sorteada") {
      void mostrarGanadoras(d, s, e.sorteo);
      return;
    }
    // La sala está sellada y el sorteo todavía no se hizo en esta pestaña: se retoma desde Mis sorteos.
    if (e.ronda !== undefined && d.ahora() >= roundTime(e.ronda) * 1000 && e.comprobante === undefined) ponerPaso({ paso: "sorteo-pendiente" });
    else ponerPaso({ paso: "avisada" });
  }
}

/**
 * Se recargó entre mandar el sello y que la red lo confirmara: el sello puede estar en la red sin número en la entrada, y solo
 * se recupera tocando Sellar la lista (la herramienta retoma el intento guardado). Si el cuadro tiene la lista de la entrada,
 * la entrada todavía no tiene sorteo y hay un intento guardado de esa lista, quien organiza tiene una sola acción. Pasada la
 * ronda de ese intento, el sello ya no sirve para la campaña: se dice que no se llegó.
 */
export function pasoDelSelloPorConfirmar(a: {
  huellaDelCuadro: string;
  entrada: SorteoDeCampana | null;
  fase: FaseDeSala | null;
  /** La ronda del intento de sello guardado para esta cuenta, esta lista, esta red y este contrato. */
  intento: { round: number } | null;
  ahora: number;
}): PasoDelPuente | null {
  const e = a.entrada;
  if (!e || e.huella === "" || e.huella !== a.huellaDelCuadro || e.sorteo !== undefined || a.fase !== "cerrada" || !a.intento) return null;
  return { paso: a.ahora >= roundTime(a.intento.round) * 1000 ? "tarde" : "sello-por-confirmar" };
}

export { conSorteoSinResolver };
