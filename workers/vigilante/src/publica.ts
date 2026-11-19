/**
 * Las rutas del vigilante.
 *
 *   GET  /        {"servicio","ultimaVuelta","salioBien"}: la hora de la última vuelta y si salió bien. Pública y sin
 *                 ningún secreto ni cifra: para que algo de afuera (un servicio de latidos, un navegador) mire que el
 *                 vigilante sigue vivo. Si la hora es vieja (más de 30 minutos), el reloj se cayó.
 *   POST /prueba  Authorization: Bearer <la clave de prueba>, un derivado de la clave de operar (ver claveDePrueba).
 *                 Manda un aviso de prueba por el correo (y por Telegram si está prendido), con las cifras de ahora,
 *                 y dice cómo salió. No cambia lo recordado.
 *
 * Todo lo demás es 404. Nada de acá llama a otro lugar que no sea el portero y los canales de aviso.
 */
import { canalesActivos, secreto, urlDelPortero } from "./config";
import { codigoDe, enviarPor } from "./envio";
import { mensajeDePrueba } from "./mensaje";
import { memoriaDeLaRuta } from "./memoria-ruta";
import { type Dependencias, type Entorno, leerMemoria, leerPortero } from "./vuelta";

const CABECERAS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

const json = (estado: number, cuerpo: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CABECERAS, ...extra } });

const metodoNoPermitido = (permitidos: string): Response => json(405, { motivo: "metodo" }, { Allow: permitidos });

/** Entre una prueba y la siguiente pasan al menos 60 segundos: la ruta manda un correo cada vez. */
export const ESPERA_PRUEBA_MS = 60_000;

/** Cuándo se puede hacer la próxima prueba (milisegundos). Es una variable del módulo, de cada instancia del Worker. */
let proximaPrueba = 0;

/** Borra el enfriamiento. Las pruebas lo llaman al armar su mundo. */
export function olvidarPrueba(): void {
  proximaPrueba = 0;
}

/** El texto fijo del que sale la clave de prueba. Lleva versión: si un día cambia, cambia también la clave de prueba. */
export const CONTEXTO_PRUEBA = "tinkazo-vigilante/prueba/v1";

/**
 * La clave de prueba: el HMAC-SHA-256 de `CONTEXTO_PRUEBA` con la clave de operar (sin los espacios de los extremos)
 * como llave, en hexadecimal minúsculo, 64 caracteres. Quien pide `POST /prueba` manda esto y no la clave de operar,
 * que así no viaja hasta el vigilante. De la clave de prueba no se puede sacar la clave de operar, y el portero no la
 * acepta. Quien opera la calcula en Node:
 *
 *   createHmac("sha256", clave.trim()).update("tinkazo-vigilante/prueba/v1").digest("hex")
 */
export async function claveDePrueba(claveDeOperar: string): Promise<string> {
  const texto = new TextEncoder();
  const llave = await crypto.subtle.importKey("raw", texto.encode(claveDeOperar.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", llave, texto.encode(CONTEXTO_PRUEBA)));
  return Array.from(firma, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Si dos textos son iguales, comparando sus huellas SHA-256 byte a byte y sin cortar en el primer error. */
async function iguales(a: string, b: string): Promise<boolean> {
  const huella = async (t: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  const [x, y] = await Promise.all([huella(a), huella(b)]);
  let distinto = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) distinto |= x[i]! ^ (y[i] ?? 0);
  return distinto === 0;
}

async function vivo(env: Entorno, dep: Dependencias, soloCabeceras: boolean): Promise<Response> {
  if (soloCabeceras) return new Response(null, { status: 200, headers: CABECERAS });
  // Lo leído vale 60 segundos: una lluvia de pedidos casi nunca llega al KV (ver memoria-ruta.ts).
  const m = await memoriaDeLaRuta(() => leerMemoria(env.MEMORIA, dep.registrar), dep.ahora());
  return json(200, { servicio: "tinkazo-vigilante", ultimaVuelta: m.ultimaVuelta, salioBien: m.ultimaVuelta !== null && m.salioBien });
}

async function probar(req: Request, env: Entorno, dep: Dependencias): Promise<Response> {
  // La clave de prueba sale de la clave de operar sin los espacios ni el salto de línea de los extremos: un secreto
  // cargado a mano suele traer uno al final.
  const deOperar = secreto(env.PORTERO_ADMIN_TOKEN);
  if (!deOperar) return json(503, { motivo: "sin-clave" });
  const dada = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("Authorization") ?? "")?.[1];
  if (!dada) return json(401, { motivo: "sin-clave" });
  // Solo la forma exacta: 64 caracteres hexadecimales en minúscula. La clave de operar cruda no la tiene.
  if (!/^[0-9a-f]{64}$/.test(dada) || !(await iguales(dada, await claveDePrueba(deOperar)))) return json(403, { motivo: "clave" });

  const canales = canalesActivos(env);
  if (canales.length === 0) return json(409, { correo: "sin-configurar", telegram: "apagado" });
  // Un enfriamiento entre pruebas. Solo cuenta lo que pasó la clave y tenía a quién avisar: el resto no lo arranca.
  const ahora = dep.ahora();
  if (ahora < proximaPrueba) {
    const segundos = Math.ceil((proximaPrueba - ahora) / 1000);
    return json(429, { motivo: "espera", segundos }, { "Retry-After": String(segundos) });
  }
  proximaPrueba = ahora + ESPERA_PRUEBA_MS;
  const lectura = await leerPortero(env, dep);
  const mensaje = mensajeDePrueba({ leyo: lectura.ok }, { estado: lectura.ok ? lectura.estado : null, ahora: new Date(dep.ahora()), portero: urlDelPortero(env.PORTERO_URL) });

  const resultado: Record<string, string> = {};
  let fallo = false;
  for (const canal of ["correo", "telegram"] as const) {
    if (!canales.includes(canal)) {
      resultado[canal] = canal === "correo" ? "sin-configurar" : "apagado";
      continue;
    }
    try {
      await enviarPor(canal, mensaje, env, dep.fetch);
      resultado[canal] = "enviado";
    } catch (e) {
      fallo = true;
      resultado[canal] = "error";
      resultado[canal === "correo" ? "codigo" : "codigoTelegram"] = codigoDe(e);
      dep.registrar("error-envio", { canal, codigo: codigoDe(e), tipo: "prueba", intentos: 1 });
    }
  }
  return json(fallo ? 502 : 200, resultado);
}

export async function servir(req: Request, env: Entorno, dep: Dependencias): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/") {
    if (req.method !== "GET" && req.method !== "HEAD") return metodoNoPermitido("GET, HEAD");
    return vivo(env, dep, req.method === "HEAD");
  }
  if (pathname === "/prueba") {
    if (req.method !== "POST") return metodoNoPermitido("POST");
    return probar(req, env, dep);
  }
  return json(404, { motivo: "ruta" });
}
