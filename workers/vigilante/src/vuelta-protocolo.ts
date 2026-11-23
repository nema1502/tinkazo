/**
 * El paso del protocolo y de los costos en la vuelta del vigilante (issue 220). Suma, sin tocar nada de lo que la
 * vuelta del portero ya mira, la vigilancia del detector de GitHub (`scripts/vigilar-red.mjs`, que queda de
 * respaldo): el protocolo y los 17 parámetros de costo de cada red contra la línea base guardada en el servicio,
 * cada diez minutos y sin depender del horario de GitHub.
 *
 * Cómo va la ronda:
 *  1. Lee lo avisado del KV, en su entrada propia (`protocolo`, al lado de `memoria`, que no toca).
 *  2. Mira los canales: sin por dónde avisar, termina (no da nada por avisado, y la red no se le pide).
 *  3. Le pide la línea base al portero (`GET /v1/patrocinio/linea-base`), de lectura y sin llaves. Si no la
 *     contesta, termina sin pedir nada a la red: no se puede mirar nada contra nada.
 *  4. Lee cada red con dos pedidos chicos (`getLatestLedger` y los ajustes). Si una no contesta, lo dice y
 *     termina sin avisar cambio: la red caída no es un cambio, y lo que ya se avisó se conserva.
 *  5. Compara y decide (la lógica en `protocolo.ts`): un aviso por cambio, una sola vez. El aviso sale por los
 *     canales, y solo queda marcado como avisado si salió por todos: mejor un aviso repetido que uno perdido.
 *  6. Guarda lo avisado (una escritura, y solo si cambió algo).
 *
 * La comparación usa el `fetch` y el reloj que le pasan (`Dependencias`), igual que la vuelta: las pruebas la
 * corren con los de mentira y ninguna toca una red de verdad.
 */
import { type Canal, canalesActivos, urlDelPortero } from "./config";
import { codigoDe, enviarPor, motivoDe } from "./envio";
import type { Mensaje } from "./mensaje";
import {
  REDES,
  type Lectura,
  type LineaBase,
  estadoDe,
  estadoVacio,
  lineaBaseDe,
  leerRed,
  textoDeEstado,
  vigilarProtocolo,
} from "./protocolo";
import { type Dependencias, type Entorno } from "./vuelta";

/** La entrada propia del KV para lo avisado del protocolo y los costos, al lado de la de la vuelta (`memoria`). */
export const CLAVE_PROTOCOLO = "protocolo";

/** La ruta de la línea base en el portero: read-mostly, sin llaves. La sirve `linea-base.ts` del portero. */
export const RUTA_LINEA_BASE = "/v1/patrocinio/linea-base";

/** Un pedido de línea base que no contesta en tanto tiempo se da por fallado: se prueba en la vuelta siguiente. */
export const LINEA_BASE_TIEMPO_MS = 20_000;

/** Lo que `pasoProtocolo` admite a mano: el descanso entre reintentos del RPC, para las pruebas. */
export interface OpcionesDelPaso {
  dormir?: (ms: number) => Promise<void>;
}

const dormirPorDefecto = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hostDe = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * La función que habla con el RPC de una red, como la del detector (`makeCaller`): cada pedido se intenta tres
 * veces con una espera creciente y, si el RPC no contesta, se pasa al siguiente de la lista; el que contesta
 * queda como activo para lo que sigue. Un error de parámetros o de método (-32602, -32601) no se reintenta. Todo
 * con el `fetch` que le pasan, que en las pruebas es de mentira.
 */
function llamador(urls: string[], { fetchImpl, sleep }: { fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void> }) {
  let activo = 0;

  async function pedido(url: string, metodo: string, params: unknown): Promise<unknown> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await res.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      // no es JSON: se cuenta abajo según el estado HTTP
    }
    const o = cuerpo as { error?: { code?: number; message?: string }; result?: unknown } | null;
    if (o?.error && typeof o.error === "object") {
      const error = new Error(o.error.message ?? "error del RPC");
      (error as { permanent?: boolean }).permanent = o.error.code === -32602 || o.error.code === -32601;
      throw error;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (o === null || o.result === undefined) throw new Error("la respuesta no es JSON");
    return o.result;
  }

  return async function call(metodo: string, params: unknown, { attempts = 3 } = {}): Promise<unknown> {
    const orden = [activo, ...urls.keys()].filter((indice, i, todos) => todos.indexOf(indice) === i);
    const caidas: Array<{ host: string; message: string }> = [];
    for (const indice of orden) {
      for (let intento = 1; intento <= attempts; intento++) {
        try {
          const resultado = await pedido(urls[indice]!, metodo, params);
          activo = indice;
          return resultado;
        } catch (e) {
          if ((e as { permanent?: boolean }).permanent) throw new Error(`${metodo}: ${e instanceof Error ? e.message : "error del RPC"}`);
          if (intento < attempts) await sleep(intento * 3000);
          else caidas.push({ host: hostDe(urls[indice]!), message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    const detalle = urls.length === 1 ? caidas[0]!.message : caidas.map((c) => `${c.host}: ${c.message}`).join("; ");
    throw new Error(`${metodo}: ${detalle}`);
  };
}

/** La línea base que guarda el portero: la ruta que sirve `linea-base.ts`. Nunca falla: dice por qué no pudo. */
export async function leerLineaBase(portero: string, llamar: typeof fetch): Promise<{ ok: true; base: LineaBase } | { ok: false; motivo: string }> {
  let res: Response;
  try {
    // Sin la clave de operar ni ninguna otra: es de lectura, y una redirección es una falla.
    res = await llamar(`${portero}${RUTA_LINEA_BASE}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(LINEA_BASE_TIEMPO_MS),
    });
  } catch (e) {
    const nombre = e && typeof e === "object" ? String((e as { name?: unknown }).name) : "";
    return { ok: false, motivo: nombre === "TimeoutError" || nombre === "AbortError" ? "tiempo" : "red" };
  }
  if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}` };
  try {
    const base = lineaBaseDe(await res.text());
    return base ? { ok: true, base } : { ok: false, motivo: "la respuesta no es una línea base que se entienda" };
  } catch {
    return { ok: false, motivo: "la respuesta no es JSON" };
  }
}

/**
 * El paso de protocolo y costos de la vuelta. Nunca se cae: lo que sale mal queda anotado en el registro y se
 * reintenta en la vuelta siguiente. No devuelve nada: lo que se pudo mirar y lo que se avisó van por el registro
 * (`wrangler tail` o el panel de Cloudflare), con una corrida cada diez minutos en el log. En los finales de
 * cada intento, un `return` por camino: nada de lo que quedó pendiente se tira, y la vuelta del portero sigue
 * igual aunque este paso entero se caiga.
 */
export async function pasoProtocolo(env: Entorno, dep: Dependencias, opciones: OpcionesDelPaso = {}): Promise<void> {
  const { registrar } = dep;
  try {
    // 1. Lo avisado. Sin saber qué ya se avisó, no se puede avisar nada como nuevo: termina, y la red ni se pide.
    let texto: string | null;
    try {
      texto = await env.MEMORIA.get(CLAVE_PROTOCOLO);
    } catch {
      registrar("error-kv", { donde: "protocolo-lectura" });
      return;
    }
    const estado = texto === null ? estadoVacio() : estadoDe(texto);

    // 2. Los canales. Sin por dónde avisar, no se puede decir nada: termina sin pedir nada, y lo que ya hubo de
    // avisar queda como estaba, para que con canales de vuelta salga como nuevo.
    const canales: Canal[] = canalesActivos(env);
    if (canales.length === 0) {
      registrar("protocolo", { avisos: 0, errores: 0, canales: 0 });
      return;
    }

    // 3. La línea base del portero. Sin ella no hay comparación: termina sin pedir nada a la red.
    const base = await leerLineaBase(urlDelPortero(env.PORTERO_URL), dep.fetch);
    if (!base.ok) {
      registrar("protocolo-sin-base", { motivo: base.motivo });
      return;
    }

    // 4. La red, red por red y a la vez: dos pedidos chicos por red. La que no contesta queda anotada con el
    // motivo de su corte, y la ronda la lista entre los errores, sin confundir una caída con un cambio.
    const lecturas: Record<string, Lectura | undefined> = {};
    const fallas: Record<string, string> = {};
    await Promise.all(
      Object.keys(REDES).map(async (red) => {
        const call = llamador(REDES[red]!.rpcUrls, { fetchImpl: dep.fetch, sleep: opciones.dormir ?? dormirPorDefecto });
        try {
          lecturas[red] = await leerRed(call);
        } catch (e) {
          fallas[red] = motivoDe(e);
          registrar("protocolo-sin-red", { red, motivo: fallas[red] });
        }
      }),
    );

    // 5. La ronda: comparar contra la línea base y decidir, con un aviso por cambio y una sola vez.
    const ronda = await vigilarProtocolo({ redes: Object.keys(REDES), lecturas, fallas, base: base.base, estado });
    let cambio = false;
    for (const aviso of ronda.avisos) {
      const mensaje: Mensaje = { asunto: aviso.asunto, texto: aviso.texto };
      let salieron = 0;
      for (const canal of canales) {
        try {
          await enviarPor(canal, mensaje, env, dep.fetch);
          salieron += 1;
          registrar("aviso-enviado", { canal, tipo: "protocolo", red: aviso.red });
        } catch (e) {
          registrar("error-envio", { canal, codigo: codigoDe(e), motivo: motivoDe(e), tipo: "protocolo", red: aviso.red });
        }
      }
      // Solo lo que salió por todos los canales cuenta como avisado: con un canal faltante, la vuelta siguiente
      // repite el aviso (y el canal que salió bien lo recibe dos veces: mejor repetido que perdido).
      if (salieron === canales.length) {
        estado.el[aviso.red] = aviso.avisado;
        cambio = true;
      }
    }

    // 6. Guardar lo avisado, una escritura y solo si cambió algo. Si falla, queda sin marcar: el aviso se repite
    // en la vuelta siguiente.
    if (cambio) {
      try {
        await env.MEMORIA.put(CLAVE_PROTOCOLO, textoDeEstado(estado));
      } catch {
        registrar("error-kv", { donde: "protocolo-escritura" });
      }
    }
    registrar("protocolo", { avisos: ronda.avisos.length, errores: ronda.errores.length });
  } catch (e) {
    // Una falla que el paso no esperaba: queda anotada y no sube, para no tumbar la vuelta del portero.
    registrar("error-interno", { donde: "protocolo", error: e instanceof Error ? e.name : "desconocido" });
  }
}
