/**
 * La vigilancia de firmas del portero de mainnet: cuántas firmas de cuentas de Google cobró Pollar en el día y cuántas
 * explican nuestros números. Cada firma de una billetera de Turnkey le cuesta a Tinkazo 20 créditos, la mande nuestro
 * sitio o un programa armado por fuera con nuestra llave publicable. Las que explicamos son los sellos y sorteos que
 * llegaron al portero desde cuentas del libro, y las activaciones del día; lo demás (`firmasSinExplicar`) es lo que hay
 * que mirar.
 *
 * Funciones puras: lo que se le pregunta a Pollar está en `pollar.ts` y lo que sabe el portero, en `cupos.ts`.
 *
 * Por confirmar con Pollar: cómo se llama cada campo de un movimiento (el evento es `cosign.signature:STELLAR`, medido
 * el 10 de noviembre; el monto y la fecha se buscan con los nombres esperables) y si un movimiento puede agrupar varias
 * firmas (`count`).
 */

/** Lo más que se pide de movimientos de una vez (el máximo de `billing/credits`). Con la página llena puede haber más. */
export const MAX_MOVIMIENTOS = 200;
/** Más que esto sin explicar en 24 horas es para mirar: va a la bitácora y la vigilancia diaria falla. */
export const FIRMAS_SIN_EXPLICAR_MAX = 10;

/** El evento con que Pollar cobra una firma de una billetera co-firmada (`cosign.signature:STELLAR`). */
const EVENTO_FIRMA = /^cosign\.signature(?::[A-Z_]{1,20})?$/;

/** Un número de un campo de Pollar: número o texto con forma de número. null si no. */
function numero(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && /^-?\d{1,12}(\.\d{1,8})?$/.test(x)) return Number(x);
  return null;
}

/** Un instante de Pollar en ms (texto ISO, o un número en ms o en segundos), o null. */
function instante(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x) && x > 0) return x >= 1e12 ? x : x * 1000;
  if (typeof x === "string" && x.length <= 64) {
    const ms = Date.parse(x);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Las firmas cobradas en estos movimientos desde `desde` (ms): los cobros (monto negativo, o sin monto) cuyo evento es
 * el de una firma. Un movimiento con `count` entero cuenta esa cantidad. Uno con fecha anterior a `desde` no cuenta (la
 * consulta ya pide desde ahí; es por las dudas). Lo que no se entiende no cuenta. `completo: false` si vino la página
 * llena: el número es entonces lo menos que se cobró.
 */
export function contarFirmas(movimientos: unknown, desde: number): { firmas: number; completo: boolean } {
  if (!Array.isArray(movimientos)) return { firmas: 0, completo: true };
  let firmas = 0;
  for (const m of movimientos.slice(0, MAX_MOVIMIENTOS)) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const o = m as Record<string, unknown>;
    if (typeof o.event !== "string" || !EVENTO_FIRMA.test(o.event)) continue;
    const monto = numero(o.amount ?? o.credits ?? o.delta);
    if (monto !== null && monto >= 0) continue;
    const cuando = instante(o.createdAt ?? o.created_at ?? o.at ?? o.timestamp);
    if (cuando !== null && cuando < desde) continue;
    const n = o.count;
    firmas += typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
  }
  return { firmas, completo: movimientos.length < MAX_MOVIMIENTOS };
}

/**
 * El patrocinio de la app tiene que estar todo apagado, salvo lo `permitido` (`PATROCINIO_PERMITIDO`: la compra con QR
 * necesita prendidos el de las líneas y el de los envíos de cuentas co-firmadas). Lo que esté prendido sin estar
 * permitido se nombra, en orden.
 */
export function patrocinioEsperado(banderas: Record<string, boolean>, permitido: readonly string[] = []): { esperado: boolean; prendidos: string[] } {
  const prendidos = Object.keys(banderas)
    .filter((k) => banderas[k] === true && !permitido.includes(k))
    .sort();
  return { esperado: prendidos.length === 0, prendidos };
}
