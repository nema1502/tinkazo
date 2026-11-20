/**
 * Si un texto es una cuenta de Stellar (`G...`), sin el SDK y sin nada del navegador.
 *
 * Vive aparte de `pagos.ts` porque la lee también `vite.config.ts` (el control del costo del retiro, que valida la
 * cuenta que lo recibe antes de armar el sitio), y el control del build no puede traer la configuración de la red.
 * Sin imports a propósito. `pagos.ts` lo vuelve a exportar: quien ya lo importaba de ahí no cambia.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** CRC16 XModem, el que Stellar usa para el final de una dirección. */
function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * ¿Es una cuenta de Stellar (`G…`)? Mide 56 caracteres, empieza con G y su final de control cuadra: una dirección
 * con una letra cambiada no pasa. No usa el SDK, así se puede preguntar al pintar la pantalla del resultado.
 */
export function esDireccionG(s: unknown): s is string {
  if (typeof s !== "string" || !/^G[A-Z2-7]{55}$/.test(s)) return false;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s) {
    acc = (acc << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  // 35 bytes: la versión (6 << 3 = cuenta), la llave de 32 y el control de 2, en ese orden.
  if (bytes.length !== 35 || bytes[0] !== 6 << 3) return false;
  const control = (bytes[34] as number) * 256 + (bytes[33] as number);
  return crc16(bytes.slice(0, 33)) === control;
}
