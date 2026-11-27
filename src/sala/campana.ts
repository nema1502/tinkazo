import type { EstadoPropio, EstadoPublico, Fase, MotivoDeAlta, MotivoDeSalida } from "../campana/celular";
import type { Dependencias } from "./cliente";
import { horaDeLaSala } from "./hora";

/**
 * La sala de una campaña, vista desde el celular de quien participa. Lo que cuenta es lo que contesta el servicio
 * (`workers/sala/src/index.ts`): cada ruta, cuerpo y respuesta de acá se comprueba contra él, y una prueba corre este
 * cliente contra el servicio entero.
 *
 * Los pedidos que llevan cuerpo viajan sin cabecera `Content-Type`: el navegador manda el texto como `text/plain`, el
 * pedido es simple y no necesita la consulta previa de CORS, que en una wifi de evento es un viaje de ida y vuelta de más.
 * El servicio solo mira el largo y lee el cuerpo como JSON, así que lo acepta igual.
 *
 * El token de la sesión viaja solo en el cuerpo del alta. Nada de acá escribe en la consola ni guarda el token.
 */

/** Cuánto se espera a un pedido corriente. */
export const TOPE_PEDIDO_MS = 8_000;
/** El alta espera más: el servicio verifica la sesión con el proveedor y busca la cuenta, hasta unos 16 segundos. */
export const TOPE_ALTA_MS = 25_000;
/**
 * Lo máximo que dura un toque en Acepto y me anoto, contado desde el toque: pasado ese tiempo no se arranca otro pedido y
 * se devuelve el final de la familia. Así una persona con el proveedor caído no se queda esperando minutos.
 */
export const TOPE_TOQUE_MS = 90_000;
/**
 * Si el toque anterior terminó en un final de una familia que se reintenta hace menos de esto, el toque nuevo hace un solo
 * pedido y no reintenta: con el proveedor caído, 150 personas que tocan de nuevo no multiplican la carga.
 */
export const SOSIEGO_MS = 60_000;
/** Cuánto se espera antes de repetir un alta que quedó sin respuesta. */
export const ESPERA_SIN_RESPUESTA_MS = 3_000;
/** La espera más larga que se hace caso de lo que diga la sala. */
export const TOPE_ESPERA_MS = 30_000;
/**
 * Las esperas de cada familia que se reintenta. `rapido` espera de a 10, 20 y 30 segundos, pero la sala cuenta por minuto de
 * reloj y el azar acorta cada espera hasta un cuarto: por eso la última se estira, si hace falta, hasta pasar el cambio de
 * minuto (`esperaDe`). `creando` hace solo dos reintentos: cada pedido sin cuenta cuenta como un rechazo de la ficha y la sala
 * deja cinco, así un toque gasta tres y todavía queda margen para tocar otra vez.
 */
export const ESPERAS_MS = {
  rapido: [10_000, 20_000, 30_000],
  creando: [6_000, 15_000],
  pollar: [5_000, 10_000, 20_000],
} as const satisfies Record<string, readonly number[]>;
/** El minuto de reloj con que la sala cuenta las altas: la ventana de `rapido`. */
const MINUTO_MS = 60_000;
/** Lo más que se suma de azar después del cambio de minuto, para que 150 celulares no vuelvan en el mismo segundo. */
const AZAR_DEL_MINUTO_MS = 3_000;

export interface CuerpoDeAlta {
  token: string;
  d: string;
  llave: string;
  p: string | null;
}

export type AltaEnCampana =
  | { ok: true; cuenta: string; ya: boolean }
  /** `porRechazos` marca el tope de intentos de la sala: la página lo traduce según lo que le pasó antes a esa sesión. */
  | { ok: false; motivo: MotivoDeAlta; porRechazos?: true };

export interface DependenciasDeCampana extends Dependencias {
  /** Un número entre 0 y 1, para que 150 celulares no vuelvan a pedir en el mismo segundo. Por defecto, `Math.random`. */
  azar?: () => number;
  ahora?: () => number;
}

/** Lo que recuerda la página entre un toque y el siguiente. La página lo crea una vez y se lo pasa a cada alta. */
export interface SosiegoDelAlta {
  finalDeFamiliaEn: number | null;
}

export interface OpcionesDeAlta {
  /** El instante del toque. Sin él, el del pedido. */
  inicio?: number;
  sosiego?: SosiegoDelAlta;
}

/** Una cuenta de Stellar: una G y 55 caracteres de base 32 en mayúsculas. Lo que devuelve la sala se mira con esto. */
export function cuentaValida(x: unknown): x is string {
  return typeof x === "string" && /^G[A-Z2-7]{55}$/u.test(x);
}

const FASES: readonly Fase[] = ["lista", "abierta", "cerrada", "sellada", "sorteada"];
const MOTIVOS_DE_SALIDA: readonly MotivoDeSalida[] = ["repetida", "evento", "pidio", "otro"];
const PASES: readonly EstadoPublico["pase"][] = ["vale", "vencido", "sin"];

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const esFase = (x: unknown): x is Fase => typeof x === "string" && FASES.includes(x as Fase);
const esTotal = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const esHora = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Una ronda de drand: un entero seguro de 1 en adelante. */
const esRonda = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
/** El número del sorteo viaja como texto, de 1 a 20 cifras: es un entero grande y JSON no lo escribe. */
const esSorteo = (x: unknown): x is string => typeof x === "string" && /^[0-9]{1,20}$/u.test(x);

interface Respuesta {
  estado: number;
  cuerpo: unknown;
  /** Lo que dice `Retry-After`, si el navegador deja leerlo (desde otro origen solo se lee si la sala lo expone, y lo hace). */
  espera: string | null;
  /** La hora de la sala según la cabecera `Date`, si el navegador la deja leer. */
  horaSala: number | null;
}

/**
 * Lo que la sala suma desde que se sella la lista: la ronda de la semilla y el número del sorteo. Las salas de antes no lo
 * mandan, y un valor que no tiene la forma se descarta sin romper nada: sin la ronda el celular hace lo de siempre. Con la
 * ronda viaja también la hora de la sala, para que la cuenta regresiva no dependa del reloj del celular.
 */
function datosDeLaRonda(c: Record<string, unknown>, fase: Fase, horaSala: number | null): { ronda?: number; sorteo?: string; horaSala?: number } {
  if ((fase !== "sellada" && fase !== "sorteada") || !esRonda(c.ronda)) return {};
  return {
    ronda: c.ronda,
    ...(esSorteo(c.sorteo) ? { sorteo: c.sorteo } : {}),
    ...(horaSala !== null ? { horaSala } : {}),
  };
}

/** Un pedido con su tope, cuerpo incluido. Da `null` si no hubo respuesta completa. Nunca escribe nada en la consola. */
async function pedir(dep: Dependencias, url: string, init: RequestInit, tope: number): Promise<Respuesta | null> {
  const poner = dep.setTimeout ?? setTimeout;
  const sacar = dep.clearTimeout ?? clearTimeout;
  const corte = new AbortController();
  const reloj = poner(() => corte.abort(), tope);
  try {
    const r = await (dep.fetch ?? fetch)(url, { ...init, cache: "no-store", signal: corte.signal });
    let cuerpo: unknown = null;
    try {
      cuerpo = await r.json();
    } catch {
      cuerpo = null;
    }
    // Una respuesta cortada a la mitad no cuenta como respuesta: el cuerpo que falta podía decir otra cosa.
    if (corte.signal.aborted) return null;
    let espera: string | null = null;
    try {
      espera = r.headers.get("Retry-After");
    } catch {
      espera = null;
    }
    return { estado: r.status, cuerpo, espera, horaSala: horaDeLaSala(r) };
  } catch {
    return null;
  } finally {
    sacar(reloj);
  }
}

const direccionDe = (servicio: string, sala: string, ruta: string): string =>
  `${servicio}/v1/sala/${encodeURIComponent(sala)}/campana${ruta}`;

/** Lo público de la sala: fase, cuántas van, hora de cierre y si el pase del enlace vale. 404 es que la sala terminó. */
export async function estadoPublico(
  servicio: string,
  sala: string,
  pase: string | null,
  dep: Dependencias = {},
): Promise<EstadoPublico | "red" | "terminada"> {
  const consulta = pase ? `?p=${encodeURIComponent(pase)}` : "";
  const r = await pedir(dep, `${direccionDe(servicio, sala, "/estado")}${consulta}`, { method: "GET" }, TOPE_PEDIDO_MS);
  if (!r) return "red";
  if (r.estado === 404) return "terminada";
  const c = r.cuerpo;
  if (r.estado !== 200 || !esObjeto(c)) return "red";
  const vigencia = c.pase;
  if (!esFase(c.fase) || !esTotal(c.total) || !esHora(c.cierraMs)) return "red";
  if (typeof vigencia !== "string" || !PASES.includes(vigencia as EstadoPublico["pase"])) return "red";
  // Una sala vieja no manda `correo`: sin el campo, no se promete ningún aviso.
  return {
    fase: c.fase,
    total: c.total,
    cierraMs: c.cierraMs,
    pase: vigencia as EstadoPublico["pase"],
    correo: c.correo === true,
    ...datosDeLaRonda(c, c.fase, r.horaSala),
  };
}

/**
 * Lo que la sala sabe de este celular. Solo con la llave correcta suma si salió, si ganó y si le avisaron. Con `correoConfirmado`
 * le avisa que el correo de la cuenta está confirmado (`c: true`): sin eso el cuerpo es el de siempre.
 */
export async function miEstado(
  servicio: string,
  sala: string,
  cuenta: string,
  llave: string,
  dep: Dependencias = {},
  correoConfirmado = false,
): Promise<EstadoPropio | "red" | "terminada"> {
  const cuerpo = JSON.stringify(correoConfirmado ? { cuenta, llave, c: true } : { cuenta, llave });
  return consultarYo(servicio, sala, cuerpo, dep);
}

/** El pedido de `yo` con su cuerpo ya escrito, y la lectura de lo que contesta la sala. Lo comparten las dos formas de campaña. */
export async function consultarYo(
  servicio: string,
  sala: string,
  cuerpo: string,
  dep: Dependencias = {},
): Promise<EstadoPropio | "red" | "terminada"> {
  const r = await pedir(dep, direccionDe(servicio, sala, "/yo"), { method: "POST", body: cuerpo }, TOPE_PEDIDO_MS);
  if (!r) return "red";
  if (r.estado === 404) return "terminada";
  const c = r.cuerpo;
  if (r.estado !== 200 || !esObjeto(c)) return "red";
  if (!esFase(c.fase) || !esTotal(c.total) || !esHora(c.cierraMs) || typeof c.anotada !== "boolean") return "red";
  const propio: EstadoPropio = { fase: c.fase, total: c.total, cierraMs: c.cierraMs, anotada: c.anotada, ...datosDeLaRonda(c, c.fase, r.horaSala) };
  if (typeof c.quitada === "string" && MOTIVOS_DE_SALIDA.includes(c.quitada as MotivoDeSalida)) {
    propio.quitada = c.quitada as MotivoDeSalida;
  }
  if (typeof c.gano === "boolean") propio.gano = c.gano;
  if (c.avisado === true) propio.avisado = true;
  // El código de entrega de una campaña de personas: cuatro cifras y solo a quien ganó. Cualquier otra cosa no sirve para nada.
  if (propio.gano === true && typeof c.codigo === "string" && /^[0-9]{4}$/u.test(c.codigo)) propio.codigo = c.codigo;
  return propio;
}

/** Las cuentas elegidas y el enlace al comprobante. `null` es que todavía no hay resultado. */
export async function resultadoDeCampana(
  servicio: string,
  sala: string,
  dep: Dependencias = {},
  /** Qué forma tiene cada ganadora: una cuenta, o una línea de persona en las campañas de personas. */
  valida: (x: unknown) => boolean = cuentaValida,
): Promise<{ ganadoras: string[]; comprobante: string | null } | null | "red" | "terminada"> {
  const r = await pedir(dep, direccionDe(servicio, sala, "/resultado"), { method: "GET" }, TOPE_PEDIDO_MS);
  if (!r) return "red";
  const c = r.cuerpo;
  if (r.estado === 404) return esObjeto(c) && c.error === "sin-resultado" ? null : "terminada";
  if (r.estado !== 200 || !esObjeto(c) || !Array.isArray(c.ganadoras) || !c.ganadoras.every((g) => valida(g))) return "red";
  const comprobante = typeof c.comprobante === "string" && c.comprobante.startsWith("/verificar.html") ? c.comprobante : null;
  return { ganadoras: [...(c.ganadoras as string[])], comprobante };
}

type Familia = keyof typeof ESPERAS_MS;

export type Lectura =
  | { tipo: "listo"; cuenta: string; ya: boolean }
  | { tipo: "final"; motivo: MotivoDeAlta; porRechazos?: true }
  | { tipo: "otra-vez"; familia: Familia; aviso: "mucha" | "creando"; alFinal: "wifi" | "cuentas" | "proveedor" };

/** Una falla pasajera del lado del proveedor o del propio servicio: se repite el mismo alta. */
const delProveedor: Lectura = { tipo: "otra-vez", familia: "pollar", aviso: "mucha", alFinal: "proveedor" };

/**
 * Traduce una respuesta del alta. La tabla es la de `workers/sala/src/index.ts` (ruta `campana/alta`). Lo que el servicio
 * no dice con su forma (un 500 o un 503 con texto o con una página, que contesta la plataforma cuando el objeto de la sala
 * se reinicia o está lleno) es pasajero: el alta se puede repetir sin riesgo, porque la sala contesta `ya`.
 */
export function leerAlta(estado: number, cuerpo: unknown): Lectura {
  const error = esObjeto(cuerpo) && typeof cuerpo.error === "string" ? cuerpo.error : null;
  if (estado === 201 || estado === 200) {
    const cuenta = esObjeto(cuerpo) ? cuerpo.cuenta : undefined;
    const ya = esObjeto(cuerpo) && cuerpo.ya === true;
    if (!cuentaValida(cuenta) || (estado === 200) !== ya) return { tipo: "final", motivo: "otro" };
    return { tipo: "listo", cuenta, ya };
  }
  if (estado === 429 && error === "rapido") return { tipo: "otra-vez", familia: "rapido", aviso: "mucha", alFinal: "wifi" };
  // El tope de la conexión dura minutos: repetir en segundos no lo destraba, y con los datos del celular sí se sale.
  if (estado === 429 && error === "cupo-conexion") return { tipo: "final", motivo: "wifi" };
  // El tope de intentos de una sesión es de la ficha y no de la conexión: cambiar de red no lo destraba, solo esperar.
  if (estado === 429 && error === "rechazos") return { tipo: "final", motivo: "espera", porRechazos: true };
  if (estado === 409 && error === "sin-billetera") {
    return { tipo: "otra-vez", familia: "creando", aviso: "creando", alFinal: "cuentas" };
  }
  // Sin el secreto del proveedor la sala no funciona: esperar no lo arregla.
  if (estado === 503 && error === "sin-pollar") return { tipo: "final", motivo: "proveedor" };
  if (estado >= 500 && estado <= 504) return delProveedor;
  if (estado === 429 && error === "llena") return { tipo: "final", motivo: "llena" };
  if ((estado === 409 && error === "cerrada") || estado === 404) return { tipo: "final", motivo: "cerro" };
  if (estado === 409 && error === "pase") return { tipo: "final", motivo: "pase" };
  if (estado === 409 && error === "quitada") return { tipo: "final", motivo: "quitada" };
  if (estado === 401 && error === "sesion") return { tipo: "final", motivo: "sesion" };
  // Una app del proveedor que no es la de la sala, o una sesión de la red de prueba: entrar de nuevo no lo arregla.
  if (estado === 403 && error === "otra-app") return { tipo: "final", motivo: "otro" };
  // Desde este celular la única parte que puede venir mal formada es el token vencido.
  if (estado === 400 && error === "forma") return { tipo: "final", motivo: "sesion" };
  if (estado === 403 && error === "solo-google") return { tipo: "final", motivo: "solo-google" };
  return { tipo: "final", motivo: "otro" };
}

/**
 * Cuánto esperar antes del reintento `i`: lo que diga la sala hasta 30 segundos, o la tabla, con un poco de azar. La última
 * espera de `rapido` llega al menos hasta el próximo cambio de minuto del reloj: la sala cuenta las altas por minuto, y sin
 * esto los cuatro pedidos podían caer dentro del mismo minuto y fallar los cuatro.
 */
function esperaDe(familia: Familia, i: number, dicho: string | null, azar: () => number, ahoraMs: number): number {
  const segundos = Number(dicho ?? "");
  const tabla: readonly number[] = ESPERAS_MS[familia];
  const base = Number.isInteger(segundos) && segundos > 0
    ? Math.min(segundos * 1000, TOPE_ESPERA_MS)
    : tabla[i] ?? TOPE_ESPERA_MS;
  const espera = Math.round(base * (0.75 + azar() * 0.5));
  if (familia !== "rapido" || i < tabla.length - 1) return espera;
  const hastaElMinuto = MINUTO_MS - (ahoraMs % MINUTO_MS) + Math.round(azar() * AZAR_DEL_MINUTO_MS);
  return Math.max(espera, hastaElMinuto);
}

function dormir(dep: Dependencias, ms: number): Promise<void> {
  const poner = dep.setTimeout ?? setTimeout;
  return new Promise((resolver) => {
    poner(resolver, ms);
  });
}

/**
 * Anota a la persona en la campaña con el token de su sesión de Google. Se repite sola cuando la sala o el proveedor están
 * llenos (`rapido`, `sin-billetera`, el proveedor lento) y avisa con `alReintentar`. Un pedido que queda sin respuesta se
 * manda una vez más, porque la sala pudo anotar a la persona y perderse la respuesta: si entonces contesta `ya`, es un alta
 * nueva y se festeja. El token va solo en el cuerpo y no se guarda.
 */
export async function anotarmeEnCampana(
  servicio: string,
  sala: string,
  cuerpo: CuerpoDeAlta,
  dep: DependenciasDeCampana = {},
  alReintentar: (aviso: "mucha" | "creando") => void = () => undefined,
  opciones: OpcionesDeAlta = {},
): Promise<AltaEnCampana> {
  const cuerpoJson = JSON.stringify({ token: cuerpo.token, d: cuerpo.d, llave: cuerpo.llave, p: cuerpo.p });
  return anotarConLector(servicio, sala, cuerpoJson, leerAlta, dep, alReintentar, opciones);
}

/**
 * El alta con sus reintentos, para cualquier forma de campaña: lo único que cambia es el cuerpo que se manda y cómo se lee lo
 * que contesta la sala (`leer`). Las esperas, los topes y el cuidado de no repetir un toque son los mismos.
 */
export async function anotarConLector(
  servicio: string,
  sala: string,
  cuerpoJson: string,
  leer: (estado: number, cuerpo: unknown) => Lectura,
  dep: DependenciasDeCampana = {},
  alReintentar: (aviso: "mucha" | "creando") => void = () => undefined,
  opciones: OpcionesDeAlta = {},
): Promise<AltaEnCampana> {
  const ahora = dep.ahora ?? ((): number => Date.now());
  const azar = dep.azar ?? Math.random;
  const inicio = opciones.inicio ?? ahora();
  const sosiego = opciones.sosiego;
  const anterior = sosiego?.finalDeFamiliaEn ?? null;
  const sosegado = anterior !== null && ahora() - anterior < SOSIEGO_MS;
  const url = direccionDe(servicio, sala, "/alta");
  const pasoElToque = (): boolean => ahora() - inicio >= TOPE_TOQUE_MS;
  const terminar = (resultado: AltaEnCampana, deFamilia: boolean): AltaEnCampana => {
    if (sosiego) sosiego.finalDeFamiliaEn = deFamilia ? ahora() : null;
    return resultado;
  };
  let reintentos = 0;
  let sinRespuesta = false;
  /** Si en este toque la sala ya dijo que la cuenta se estaba creando: un tope de intentos después es de la cuenta. */
  let vistoCreando = false;
  for (;;) {
    const r = await pedir(dep, url, { method: "POST", body: cuerpoJson }, TOPE_ALTA_MS);
    if (r === null) {
      if (sinRespuesta || pasoElToque()) return terminar({ ok: false, motivo: "red" }, false);
      sinRespuesta = true;
      await dormir(dep, Math.round(ESPERA_SIN_RESPUESTA_MS * (0.75 + azar() * 0.5)));
      if (pasoElToque()) return terminar({ ok: false, motivo: "red" }, false);
      continue;
    }
    const lectura = leer(r.estado, r.cuerpo);
    if (lectura.tipo === "listo") {
      return terminar({ ok: true, cuenta: lectura.cuenta, ya: lectura.ya && !sinRespuesta }, false);
    }
    if (lectura.tipo === "final") {
      // Cada pedido sin cuenta gastó un rechazo de la ficha: si el tope llega ahí, lo que pasa es que la cuenta no se creó.
      const motivo = lectura.porRechazos && vistoCreando ? "cuentas" : lectura.motivo;
      return terminar(lectura.porRechazos ? { ok: false, motivo, porRechazos: true } : { ok: false, motivo }, false);
    }
    if (lectura.familia === "creando") vistoCreando = true;
    const alFinal: AltaEnCampana = { ok: false, motivo: lectura.alFinal };
    if (sosegado || reintentos >= ESPERAS_MS[lectura.familia].length || pasoElToque()) return terminar(alFinal, true);
    alReintentar(lectura.aviso);
    await dormir(dep, esperaDe(lectura.familia, reintentos, r.espera, azar, ahora()));
    if (pasoElToque()) return terminar(alFinal, true);
    reintentos += 1;
  }
}
