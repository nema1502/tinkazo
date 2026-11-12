/**
 * La vuelta del vigilante: cada diez minutos mira el estado del portero de mainnet, decide si hay algo que avisar y
 * avisa. Es el mismo criterio que usa el flujo de GitHub (`scripts/lib/revision-portero.mjs`), que acá queda de respaldo.
 *
 * Esta lógica no importa nada de Cloudflare: recibe el KV, el correo, el `fetch` y el reloj, así las pruebas la corren
 * con los de mentira (`mundo-falso.ts`). `index.ts` solo la enchufa al Worker. Ver README.md.
 *
 * Cada vuelta:
 *  1. Lee lo recordado del KV (una lectura).
 *  2. Le pide `GET /v1/patrocinio/estado` al portero con la clave de operar.
 *  3. Revisa la respuesta. Si el portero no contesta dos vueltas seguidas, eso es un problema. Con una sola es un tropiezo.
 *  4. Decide qué avisar: un problema nuevo, uno que empeoró, el mismo que sigue pasadas 23 horas, y un aviso corto cuando
 *     algo se arregla. Más el resumen, si le toca.
 *  5. Manda lo que debe y lo que quedó pendiente de otras vueltas. Lo que no sale se reintenta en la vuelta siguiente.
 *  6. Guarda todo junto (una escritura).
 *
 * Mejor un aviso repetido que uno perdido: se guarda después de enviar, y un envío que falla queda pendiente.
 */
import {
  SIN_LECTURA,
  arreglados as arregladosDe,
  decidirAviso,
  leerRecordado,
  revisarPortero,
} from "../../../scripts/lib/revision-portero.mjs";
import { type Canal, canalesActivos, faltaConfigurar, horasDeResumen, secreto, urlDelPortero } from "./config";
import { codigoDe, enviarPor, motivoDe } from "./envio";
import { olvidarMemoriaDeLaRuta } from "./memoria-ruta";
import { type Contexto, type Mensaje, mensajeDeAlerta, mensajeDeArreglo, mensajeDeResumen } from "./mensaje";
import type { Registrar } from "./registro";

export { RESUMEN_HORAS_POR_DEFECTO } from "./config";

/** Lo mínimo que se usa del KV de Cloudflare. */
export interface Libro {
  get(clave: string): Promise<string | null>;
  put(clave: string, valor: string): Promise<void>;
}

/** Lo mínimo que se usa del binding `send_email` de Cloudflare. */
export interface Correo {
  send(mensaje: { to: string[]; from: { email: string; name?: string }; subject: string; text: string }): Promise<unknown>;
}

export interface Entorno {
  /** El KV donde queda lo recordado entre vueltas. */
  MEMORIA: Libro;
  /** El binding de correo (`send_email`). */
  CORREO?: Correo;
  /** Variables sin secreto (wrangler.toml). */
  PORTERO_URL?: string;
  CORREO_USUARIO?: string;
  CORREO_DOMINIO?: string;
  RESUMEN_CADA_HORAS?: string;
  /** Secretos (`wrangler secret put`). */
  PORTERO_ADMIN_TOKEN?: string;
  AVISAR_A?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export interface Dependencias {
  fetch: typeof fetch;
  ahora: () => number;
  registrar: Registrar;
}

export type TipoDeAviso = "alerta" | "arreglo" | "resumen";

/** Un aviso que se armó y todavía no salió por todos sus canales. */
export interface Aviso {
  id: string;
  tipo: TipoDeAviso;
  asunto: string;
  texto: string;
  creado: string;
  /** Los canales por los que falta mandarlo. */
  canales: Canal[];
  intentos: number;
}

/** Todo lo que el vigilante recuerda entre vueltas, en una sola entrada del KV. */
export interface Memoria {
  v: 1;
  /** Los problemas ya avisados y cuándo fue el último aviso (lo lee `leerRecordado` del módulo compartido). */
  claves: string[];
  avisadoEn: string | null;
  /** Vueltas seguidas en que el portero no contestó. */
  sinRespuesta: number;
  ultimaVuelta: string | null;
  salioBien: boolean;
  /** El comienzo de la ranura del último resumen armado. */
  resumenEn: string | null;
  pendientes: Aviso[];
}

export const CLAVE_MEMORIA = "memoria";
/** Cuántas vueltas seguidas sin respuesta hacen falta para que sea un problema. */
export const SIN_RESPUESTA_MAX = 2;
/** El portero tiene que contestar en este tiempo. */
export const PORTERO_TIEMPO_MS = 20_000;
/** Un aviso que no puede salir en tanto tiempo se descarta: ya es viejo. */
export const PENDIENTE_MAX_HORAS = 24;
/** Cuántos avisos pendientes se guardan como mucho. */
export const PENDIENTES_MAX = 10;
/** El vigilante no puede entrar al portero: falta la clave o ya no vale. */
export const SIN_CLAVE = "vigilante-sin-clave";

const HORA_MS = 3_600_000;
/** Las ranuras del resumen se cuentan desde este instante, a las 12:00 UTC (las 8 de la mañana en Bolivia). */
const ANCLA_DEL_RESUMEN = Date.UTC(2026, 0, 1, 12, 0, 0);

export const memoriaVacia = (): Memoria => ({ v: 1, claves: [], avisadoEn: null, sinRespuesta: 0, ultimaVuelta: null, salioBien: false, resumenEn: null, pendientes: [] });

/** El comienzo de la ranura del resumen a la que pertenece `ahora`: cada `horas` horas, contadas desde las 12:00 UTC. */
export function inicioDeResumen(ahora: Date, horas: number): Date {
  const paso = horas * HORA_MS;
  return new Date(ANCLA_DEL_RESUMEN + Math.floor((ahora.getTime() - ANCLA_DEL_RESUMEN) / paso) * paso);
}

const fechaOnull = (x: unknown): string | null => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(Date.parse(x)).toISOString() : null);
const entero = (x: unknown): number => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : 0);
const TIPOS: TipoDeAviso[] = ["alerta", "arreglo", "resumen"];
const CANALES: Canal[] = ["correo", "telegram"];

function avisoDe(x: unknown): Aviso | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const canales = Array.isArray(o.canales) ? o.canales.filter((c): c is Canal => CANALES.includes(c as Canal)) : [];
  const creado = fechaOnull(o.creado);
  if (typeof o.id !== "string" || typeof o.asunto !== "string" || typeof o.texto !== "string" || !creado || canales.length === 0) return null;
  if (!TIPOS.includes(o.tipo as TipoDeAviso)) return null;
  return { id: o.id, tipo: o.tipo as TipoDeAviso, asunto: o.asunto, texto: o.texto, creado, canales, intentos: entero(o.intentos) };
}

/** Lo recordado a partir del texto del KV, o null si lo guardado no se entiende. */
export function memoriaDe(texto: string): Memoria | null {
  let j: Record<string, unknown>;
  try {
    const crudo: unknown = JSON.parse(texto);
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
    j = crudo as Record<string, unknown>;
  } catch {
    return null;
  }
  const recordado = leerRecordado(texto);
  return {
    v: 1,
    claves: recordado.claves,
    avisadoEn: recordado.avisadoEn,
    sinRespuesta: entero(j.sinRespuesta),
    ultimaVuelta: fechaOnull(j.ultimaVuelta),
    salioBien: j.salioBien === true,
    resumenEn: fechaOnull(j.resumenEn),
    pendientes: Array.isArray(j.pendientes) ? j.pendientes.map(avisoDe).filter((a): a is Aviso => a !== null) : [],
  };
}

/**
 * Lee la memoria del KV. Nunca falla, pero distingue tres casos:
 * - no hay nada (la primera vuelta de un Worker nuevo): una memoria vacía;
 * - lo guardado no se entiende: se anota y se sigue con una memoria vacía, que se escribe sana al final de la vuelta;
 * - el KV no se puede leer: null. Eso NO es una primera vuelta: no se sabe qué se avisó, así que no se puede avisar nada
 *   como nuevo ni escribir encima de lo recordado.
 */
export async function intentarLeerMemoria(libro: Libro, registrar: Registrar): Promise<Memoria | null> {
  let texto: string | null;
  try {
    texto = await libro.get(CLAVE_MEMORIA);
  } catch {
    registrar("error-kv", { donde: "lectura" });
    return null;
  }
  if (texto === null) return memoriaVacia();
  const memoria = memoriaDe(texto);
  if (memoria === null) {
    registrar("error-kv", { donde: "contenido" });
    return memoriaVacia();
  }
  return memoria;
}

/** Lo mismo para quien solo quiere mirar (la ruta pública, las pruebas): sin lectura, una memoria vacía. */
export async function leerMemoria(libro: Libro, registrar: Registrar): Promise<Memoria> {
  return (await intentarLeerMemoria(libro, registrar)) ?? memoriaVacia();
}

// ---------- el portero ----------

export type Lectura = { ok: true; estado: unknown } | { ok: false; motivo: "sin-clave" | "clave-rechazada" | "red" | "tiempo" | "http" | "redireccion" | "json" };

/**
 * `GET /v1/patrocinio/estado` con la clave de operar. Nunca falla: dice por qué no pudo.
 * El pedido con la clave no sigue redirecciones (`redirect: "manual"`): una redirección es una falla, así la clave no
 * puede terminar en otro lugar.
 */
export async function leerPortero(env: Entorno, dep: Dependencias): Promise<Lectura> {
  const clave = secreto(env.PORTERO_ADMIN_TOKEN);
  if (!clave) return { ok: false, motivo: "sin-clave" };
  let res: Response;
  try {
    res = await dep.fetch(`${urlDelPortero(env.PORTERO_URL)}/v1/patrocinio/estado`, {
      method: "GET",
      headers: { Authorization: `Bearer ${clave}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(PORTERO_TIEMPO_MS),
    });
  } catch (e) {
    const nombre = e && typeof e === "object" ? String((e as { name?: unknown }).name) : "";
    return { ok: false, motivo: nombre === "TimeoutError" || nombre === "AbortError" ? "tiempo" : "red" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, motivo: "clave-rechazada" };
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return { ok: false, motivo: "redireccion" };
  if (!res.ok) return { ok: false, motivo: "http" };
  try {
    return { ok: true, estado: await res.json() };
  } catch {
    return { ok: false, motivo: "json" };
  }
}

// ---------- la vuelta ----------

export interface ResultadoDeVuelta {
  /** Se pudo mirar al portero, no falta nada de configuración y no quedó ningún aviso sin mandar. */
  salioBien: boolean;
  avisos: number;
  pendientes: number;
}

const unicas = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Lo que no dice cómo está el portero: no se pudo hablar con él, no hay clave o la respuesta no se entiende. Si es todo lo
 * que hay ahora, no se sabe qué se arregló ni qué sigue mal: no se da nada por arreglado y se conserva lo avisado, para que
 * al recuperar el acceso lo que seguía mal no se avise otra vez como si fuera nuevo.
 */
const SIN_DATOS = new Set<string>([SIN_LECTURA, SIN_CLAVE, "respuesta-invalida"]);

export async function vuelta(env: Entorno, dep: Dependencias): Promise<ResultadoDeVuelta> {
  const { registrar } = dep;
  const ahora = new Date(dep.ahora());
  const m = await intentarLeerMemoria(env.MEMORIA, registrar);
  if (m === null) {
    // Sin poder leer lo recordado no se sabe qué ya se avisó: no se manda nada, no se da nada por nuevo y no se escribe.
    // Lo que había en el KV queda como estaba, con sus avisos pendientes, y la ruta pública deja de mostrar vueltas nuevas.
    registrar("vuelta", { bien: false, memoria: "sin-leer" });
    return { salioBien: false, avisos: 0, pendientes: 0 };
  }
  const recordado = { claves: m.claves, avisadoEn: m.avisadoEn };
  const falta = faltaConfigurar(env);
  if (falta.length > 0) registrar("error-config", { falta: falta.join(",") });
  const portero = urlDelPortero(env.PORTERO_URL);
  // Sin a quién avisar no se da nada por avisado ni se arma ningún resumen: cuando se configure, avisa como si fuera la primera vez.
  const canales = canalesActivos(env);

  // 1. Mirar al portero.
  const lectura = await leerPortero(env, dep);
  let claves: string[] | null = null;
  let problemas: string[] = [];
  if (lectura.ok) {
    m.sinRespuesta = 0;
    ({ claves, problemas } = revisarPortero(lectura.estado));
  } else if (lectura.motivo === "sin-clave" || lectura.motivo === "clave-rechazada") {
    registrar("portero-sin-acceso", { motivo: lectura.motivo });
    claves = [SIN_CLAVE];
    problemas = ["el vigilante no puede entrar al portero: falta la clave de operar o ya no vale"];
  } else {
    m.sinRespuesta += 1;
    registrar("portero-sin-respuesta", { motivo: lectura.motivo, seguidas: m.sinRespuesta });
    if (m.sinRespuesta >= SIN_RESPUESTA_MAX) {
      claves = [SIN_LECTURA];
      problemas = ["el portero no contesta"];
    }
  }
  const estado: unknown = lectura.ok ? lectura.estado : null;
  const contexto: Contexto = { estado, ahora, portero };

  // 2. Decidir qué avisar.
  const nuevos: Array<{ tipo: TipoDeAviso; mensaje: Mensaje }> = [];
  if (claves !== null && canales.length > 0) {
    const decision = decidirAviso({ claves, recordado, ahora });
    const actuales = unicas(claves);
    const sinDatos = actuales.length > 0 && actuales.every((c) => SIN_DATOS.has(c));
    const arreglados = sinDatos ? [] : arregladosDe(recordado.claves, claves);
    const textos = new Map(claves.map((c, i) => [c, problemas[i] ?? ""]));
    m.claves = sinDatos ? unicas([...recordado.claves, ...decision.siguiente.claves]).sort() : decision.siguiente.claves;
    m.avisadoEn = decision.siguiente.avisadoEn;
    if (decision.avisar) {
      const recordatorio = decision.motivo === "recordatorio";
      const delAviso = recordatorio ? actuales : (decision.nuevos as string[]);
      nuevos.push({
        tipo: "alerta",
        mensaje: mensajeDeAlerta(
          { claves: delAviso, problemas: delAviso.map((c) => textos.get(c) ?? ""), recordatorio, arreglados, siguen: actuales.filter((c) => !delAviso.includes(c)) },
          contexto,
        ),
      });
    } else if (arreglados.length > 0) {
      nuevos.push({ tipo: "arreglo", mensaje: mensajeDeArreglo({ arreglados, siguen: actuales }, contexto) });
    }
  }

  // 3. El resumen, si le toca: una vez por ranura, en la primera vuelta que la encuentra.
  const horas = horasDeResumen(env.RESUMEN_CADA_HORAS);
  const ranura = inicioDeResumen(ahora, horas);
  const resumenPendiente = canales.length > 0 && (m.resumenEn === null || Date.parse(m.resumenEn) < ranura.getTime());
  if (resumenPendiente) {
    m.resumenEn = ranura.toISOString();
    const sinAcceso = !lectura.ok && (lectura.motivo === "sin-clave" || lectura.motivo === "clave-rechazada");
    const datos = lectura.ok
      ? { leyo: true, claves: claves ?? [], problemas }
      : sinAcceso
        ? { leyo: true, claves: [SIN_CLAVE], problemas }
        : { leyo: false, claves: [] as string[], problemas: [] as string[] };
    nuevos.push({ tipo: "resumen", mensaje: mensajeDeResumen({ ...datos, horas }, contexto) });
  }

  // 4. Mandar: primero lo que quedó pendiente, y después lo de ahora.
  let lista = m.pendientes;
  if (nuevos.some((n) => n.tipo === "resumen")) {
    for (const p of lista.filter((a) => a.tipo === "resumen")) registrar("aviso-descartado", { motivo: "reemplazado", tipo: p.tipo, intentos: p.intentos });
    lista = lista.filter((a) => a.tipo !== "resumen");
  }
  nuevos.forEach((n, i) => {
    lista = [...lista, { id: `${ahora.getTime()}-${i}`, tipo: n.tipo, asunto: n.mensaje.asunto, texto: n.mensaje.texto, creado: ahora.toISOString(), canales: [...canales], intentos: 0 }];
  });
  const restantes: Aviso[] = [];
  for (const aviso of lista) {
    if (ahora.getTime() - Date.parse(aviso.creado) > PENDIENTE_MAX_HORAS * HORA_MS) {
      registrar("aviso-descartado", { motivo: "vencido", tipo: aviso.tipo, intentos: aviso.intentos });
      continue;
    }
    // Sin ningún canal activo no hay por dónde mandarlo: se guarda tal cual y sale cuando vuelva a haber a quién avisar
    // (dentro de las 24 horas). Así cumple lo que dice el comentario de `canales`, también para lo ya pendiente.
    if (canales.length === 0) {
      restantes.push(aviso);
      continue;
    }
    const aMandar = aviso.canales.filter((c) => canales.includes(c));
    if (aMandar.length === 0) {
      registrar("aviso-descartado", { motivo: "sin-canales", tipo: aviso.tipo, intentos: aviso.intentos });
      continue;
    }
    const faltan: Canal[] = [];
    for (const canal of aMandar) {
      try {
        await enviarPor(canal, { asunto: aviso.asunto, texto: aviso.texto }, env, dep.fetch);
        registrar("aviso-enviado", { canal, tipo: aviso.tipo, intentos: aviso.intentos + 1 });
      } catch (e) {
        faltan.push(canal);
        registrar("error-envio", { canal, codigo: codigoDe(e), motivo: motivoDe(e), tipo: aviso.tipo, intentos: aviso.intentos + 1 });
      }
    }
    if (faltan.length > 0) restantes.push({ ...aviso, canales: faltan, intentos: aviso.intentos + 1 });
  }
  for (const viejo of restantes.splice(0, Math.max(0, restantes.length - PENDIENTES_MAX))) registrar("aviso-descartado", { motivo: "de-sobra", tipo: viejo.tipo, intentos: viejo.intentos });
  m.pendientes = restantes;

  // 5. Guardar, una sola vez.
  m.ultimaVuelta = ahora.toISOString();
  m.salioBien = lectura.ok && falta.length === 0 && restantes.length === 0;
  let guardado = true;
  try {
    await env.MEMORIA.put(CLAVE_MEMORIA, JSON.stringify(m));
  } catch {
    guardado = false;
    registrar("error-kv", { donde: "escritura" });
  }
  // La ruta pública guarda lo que lee por un minuto: la vuelta nueva se tiene que ver enseguida.
  olvidarMemoriaDeLaRuta();
  const salioBien = m.salioBien && guardado;
  registrar("vuelta", { bien: salioBien, leyo: lectura.ok, avisos: nuevos.length, pendientes: restantes.length, sinRespuesta: m.sinRespuesta });
  return { salioBien, avisos: nuevos.length, pendientes: restantes.length };
}
