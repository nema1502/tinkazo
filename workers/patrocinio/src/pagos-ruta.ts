/**
 * La puerta del Worker para los pagos clásicos, sin Cloudflare (se prueba en Node):
 *
 *   POST /v1/patrocinio/pago   {"forma": "premio" | "retiro", "xdr": "<el sobre firmado, en base64>"}
 *        200 {hash, forma, vence, status, estado}
 *        503 {motivo:"apagado"|"fondo"}   400 {motivo:"cuerpo"|"no-permitida"|"fallaria"|"rechazada"}
 *        403 {motivo:"origen"|"cuenta-ajena"|"sorteo-ajeno"|"no-es-nuestro"|"destino-frenado"}
 *        409 {motivo:"sin-sortear"|"cupo-sorteo"|"puesto-usado"|"otro-en-curso"}
 *        429 {motivo:"cupo-ip"|"cupo-cuenta"}   502 {motivo:"red"}   405 {motivo:"metodo"}
 *
 * Solo en la red principal y con alguna de las dos formas prendida (`PAGOS_PREMIO` o `RETIROS`): fuera de eso devuelve null y la
 * ruta no existe, como si nunca la hubiéramos puesto (el pedido sigue de largo hasta el 404 del final del Worker).
 *
 * No lleva sesión: la cuenta sale del sobre y la prueba su firma. Abierta desde los orígenes del sitio con CORS como
 * `/v1/patrocinio`. Tiene su propio contador de pedidos por dirección, aparte del de los sellos: gastar uno no le gasta al otro.
 * Lo que decide quién paga y cuánto es el portero de los pagos (`pagos-servicio.ts`).
 */
import type { Config } from "./config";
import { cors, json, origenPermitido } from "./http";
import type { FormaDePago } from "./pagos-lista";
import type { PorIp } from "./por-ip";
import type { Respuesta } from "./servicio";

/** Lo más que se acepta de cuerpo: un pago firmado pesa menos de 2 KB. */
export const MAX_CUERPO_PAGO = 8 * 1024;

/**
 * Atiende un pedido de `/v1/patrocinio/pago`, o devuelve null si esta ruta no existe en esta configuración. `llamar` es el
 * objeto de Cloudflare: recibe la forma y el sobre y contesta lo que dice el portero de los pagos.
 */
export async function atenderPagoClasico(
  request: Request,
  cfg: Config,
  porIp: PorIp,
  llamar: (forma: FormaDePago, xdr: string) => Promise<Respuesta>,
): Promise<Response | null> {
  if (cfg.red !== "mainnet" || !(cfg.pagosPremio || cfg.retiros)) {
    return null;
  }
  const origen = request.headers.get("Origin");
  const cabeceras = cors(origen, false);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabeceras });
  }
  if (request.method !== "POST") {
    return json({ motivo: "metodo" }, 405, cabeceras);
  }
  // Un navegador manda su origen. Un programa puede mentirlo: la defensa de verdad es la firma, la forma exacta y los topes.
  if (!origenPermitido(origen)) {
    return json({ motivo: "origen" }, 403, cabeceras);
  }
  if (!porIp.toca(request.headers.get("CF-Connecting-IP") ?? "0.0.0.0", cfg.porIpPorHora)) {
    return json({ motivo: "cupo-ip" }, 429, cabeceras);
  }
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_CUERPO_PAGO) {
    return json({ motivo: "cuerpo" }, 400, cabeceras);
  }
  const texto = await request.text();
  if (texto.length > MAX_CUERPO_PAGO) {
    return json({ motivo: "cuerpo" }, 400, cabeceras);
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return json({ motivo: "cuerpo" }, 400, cabeceras);
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    return json({ motivo: "cuerpo" }, 400, cabeceras);
  }
  const { forma, xdr } = cuerpo as { forma?: unknown; xdr?: unknown };
  if ((forma !== "premio" && forma !== "retiro") || typeof xdr !== "string" || xdr.length === 0) {
    return json({ motivo: "cuerpo" }, 400, cabeceras);
  }
  // Cualquier excepción que se nos escape sale como 500 con cuerpo y CORS, no como el error pelado de Cloudflare.
  try {
    const r = await llamar(forma, xdr);
    return json(r.cuerpo, r.estado, cabeceras);
  } catch {
    return json({ motivo: "interno" }, 500, cabeceras);
  }
}
