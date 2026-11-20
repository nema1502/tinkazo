/**
 * El acceso automático de quien organiza una campaña: `POST /v1/alta/organizadora`, que llama la sala de las campañas cuando
 * comprueba en la red que la comisión del evento se pagó desde la cuenta de quien organiza. Acá vive lo de la puerta del Worker:
 * quién llama (el secreto de la sala) y cómo se lee el cuerpo. Lo que se da (sorteos, libro, topes) vive en
 * `Altas.admitirOrganizadora` y en `PuertaAltas.organizadora`, el mismo camino de las altas a mano.
 *
 * No es una ruta del navegador: la llama la sala, de servidor a servidor, con la cabecera `x-sala-secreto`. Por eso no lleva CORS ni
 * sesión de Pollar. El secreto se compara en tiempo constante; sin el secreto cargado (o de menos de 32 caracteres) la ruta no
 * atiende y contesta `503 apagada`, y en testnet no existe.
 *
 *   POST /v1/alta/organizadora   {cuenta, evento}   cabecera x-sala-secreto
 *        200 {ok:true, ya}    400 forma    401 secreto    409 evento-usado    429 cupo {liberaEn}    503 apagada
 *
 * Nunca anota la cuenta ni el evento en el registro.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { type Config, SALA_SECRETO_MINIMO } from "./config";
import { json } from "./http";
import type { Respuesta } from "./servicio";

/** El cuerpo ya leído: la cuenta G de quien organiza y el id del evento de la campaña. */
export interface PedidoDeOrganizadora {
  cuenta: string;
  evento: string;
}

/** Lo más que se acepta de cuerpo: `{"cuenta":"G…","evento":"…"}` pesa unos 150 bytes. */
const MAX_CUERPO = 1024;
/** La forma del id de un evento, igual que la que exige el sitio y la sala. */
const FORMA_EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;

/** Lee `{cuenta, evento}`: una cuenta G válida (nunca una M) y un evento con la forma de siempre. Todo lo demás, null. */
export function leerPedidoDeOrganizadora(cuerpo: unknown): PedidoDeOrganizadora | null {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return null;
  const { cuenta, evento } = cuerpo as Record<string, unknown>;
  if (typeof cuenta !== "string" || !StrKey.isValidEd25519PublicKey(cuenta)) return null;
  if (typeof evento !== "string" || !FORMA_EVENTO.test(evento)) return null;
  return { cuenta, evento };
}

/**
 * Si `dado` es el secreto de la sala, en tiempo constante: se comparan las huellas SHA-256 de los dos (siempre de 32 bytes, así no
 * importa cuánto del texto coincide) juntando todas las diferencias en lugar de cortar en la primera. No usa `timingSafeEqual` de
 * Cloudflare para que se pueda probar en Node. Sin secreto cargado (o corto) o sin dato, siempre false.
 */
export async function esLaSala(dado: string | null, secreto: string | undefined): Promise<boolean> {
  if (!dado || !secreto || secreto.length < SALA_SECRETO_MINIMO) return false;
  const huella = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([huella(dado), huella(secreto)]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diferencia = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diferencia |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferencia === 0;
}

/**
 * La puerta del Worker para `/v1/alta/organizadora`. Null si la ruta no existe (no es esa ruta, o no es mainnet). Orden de las
 * respuestas: apagada (sin ALTAS, sin las variables bien escritas o sin el secreto cargado), método, secreto, forma y, por último,
 * el objeto, que mira topes y escribe.
 */
export async function atenderOrganizadora(
  request: Request,
  cfg: Config,
  secreto: string | undefined,
  llamar: (pedido: PedidoDeOrganizadora) => Promise<Respuesta>,
): Promise<Response | null> {
  if (cfg.red !== "mainnet" || new URL(request.url).pathname !== "/v1/alta/organizadora") return null;
  if (!cfg.altas || !cfg.organizadoras || !secreto || secreto.length < SALA_SECRETO_MINIMO) return json({ motivo: "apagada" }, 503);
  if (request.method !== "POST") return json({ motivo: "metodo" }, 405);
  if (!(await esLaSala(request.headers.get("x-sala-secreto"), secreto))) return json({ motivo: "secreto" }, 401);
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_CUERPO) return json({ motivo: "forma" }, 400);
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json({ motivo: "forma" }, 400);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return json({ motivo: "forma" }, 400);
  }
  const pedido = leerPedidoDeOrganizadora(cuerpo);
  if (!pedido) return json({ motivo: "forma" }, 400);
  try {
    const res = await llamar(pedido);
    return json(res.cuerpo, res.estado);
  } catch {
    // Sin el error en el registro: podría llevar algo del pedido. El objeto anota lo suyo.
    return json({ motivo: "interno" }, 500);
  }
}
