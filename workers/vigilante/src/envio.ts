/**
 * Cómo sale un aviso: por el correo (el binding `send_email` de Cloudflare) y, si está prendido, por Telegram.
 *
 * El correo usa la forma nueva de `send()`: un objeto con `to`, `from`, `subject` y `text`. Cloudflare exige que el
 * remitente sea de un dominio de la cuenta (con el ruteo de correo prendido) y que, sin dominio de envío dado de alta,
 * el destino sea una dirección ya verificada de la cuenta. Un fallo llega como un `Error` con `code` (`E_…`).
 */
import { type Canal, destinatarios, remitente, secreto } from "./config";
import type { Mensaje } from "./mensaje";
import type { Entorno } from "./vuelta";

/** Un envío de correo que no termina en este tiempo se da por fallado: queda pendiente y se reintenta en la vuelta siguiente. */
export const CORREO_TIEMPO_MS = 15_000;
const TELEGRAM = "https://api.telegram.org";
const TELEGRAM_TIEMPO_MS = 15_000;
/** Telegram corta los mensajes de más de 4.096 caracteres. */
const TELEGRAM_MAX = 4000;

/** El código de un error de envío: el `E_…` de Cloudflare, el de Telegram o el nombre del error. Nunca el mensaje entero. */
export function codigoDe(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; name?: unknown };
    if (typeof o.code === "string" && o.code) return o.code.slice(0, 60);
    if (typeof o.name === "string" && o.name) return o.name.slice(0, 60);
  }
  return "desconocido";
}

/** El texto de un error, para el registro (que lo limpia). */
export function motivoDe(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
}

/** Espera a `promesa`, pero no más de `ms`: si vence, falla con un error con `code`. El reloj se apaga al terminar. */
async function conTope<T>(promesa: Promise<T>, ms: number, codigo: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(Object.assign(new Error("el envío tardó más de lo permitido"), { code: codigo })), ms);
  });
  try {
    return await Promise.race([promesa, tope]);
  } finally {
    clearTimeout(reloj);
  }
}

/** Manda por Telegram con `sendMessage`. Falla con un error con `code` si Telegram no contesta bien. */
export async function enviarTelegram(llamar: typeof fetch, bot: string, chat: string, texto: string): Promise<void> {
  const res = await llamar(`${TELEGRAM}/bot${bot}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: texto.slice(0, TELEGRAM_MAX), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TELEGRAM_TIEMPO_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`telegram contestó ${res.status}`), { code: `TELEGRAM_${res.status}` });
  const cuerpo = (await res.json().catch(() => null)) as { ok?: unknown } | null;
  if (cuerpo && cuerpo.ok === false) throw Object.assign(new Error("telegram dijo que no"), { code: "TELEGRAM_RECHAZO" });
}

/** Manda un mensaje por un canal. Falla si no sale. */
export async function enviarPor(canal: Canal, mensaje: Mensaje, env: Entorno, llamar: typeof fetch): Promise<void> {
  if (canal === "correo") {
    if (!env.CORREO) throw Object.assign(new Error("sin binding de correo"), { code: "SIN_CORREO" });
    const correo = env.CORREO;
    // Con un tope: un envío que se cuelga no puede cortar la vuelta.
    await conTope((async () => correo.send({ to: destinatarios(env.AVISAR_A), from: remitente(env), subject: mensaje.asunto, text: mensaje.texto }))(), CORREO_TIEMPO_MS, "CORREO_TIEMPO");
    return;
  }
  const bot = secreto(env.TELEGRAM_BOT_TOKEN);
  const chat = secreto(env.TELEGRAM_CHAT_ID);
  if (!bot || !chat) throw Object.assign(new Error("Telegram apagado"), { code: "SIN_TELEGRAM" });
  await enviarTelegram(llamar, bot, chat, `${mensaje.asunto}\n\n${mensaje.texto}`);
}
