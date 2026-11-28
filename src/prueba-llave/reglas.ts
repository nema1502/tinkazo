/**
 * La revisión propia de las reglas de la cuenta, más estricta que la del kit. El kit exige que la llave aparezca una vez
 * en la regla 0 y tolera otros firmantes y otras reglas. Esta prueba pide más: en toda la historia de la cuenta una sola
 * regla, con un solo firmante, ninguna política y sin vencimiento. Es la prueba en código de que Tinkazo no quedó como
 * firmante ni como administrador de la cuenta, y corre en las tres formas de conectar.
 *
 * Pura: recibe lo ya leído de la cuenta, y la lectura la hace `puente-kit.ts`.
 */

export type ResultadoDeReglas = { ok: true } | { ok: false; motivo: "otra-regla" | "ilegible" | "sin-firmante" | "firmante-de-mas" | "politicas" | "vencida" };

type Obj = Record<string, unknown>;

/**
 * `cantidad` es el contador de reglas que cuenta todas las que se crearon alguna vez. `regla0` es la regla 0 tal como la
 * lee el kit, con sus `signers`, sus `policies` y su `valid_until`.
 */
export function revisarReglas(cantidad: unknown, regla0: unknown): ResultadoDeReglas {
  if (Number(cantidad) !== 1) return { ok: false, motivo: "otra-regla" };
  if (typeof regla0 !== "object" || regla0 === null) return { ok: false, motivo: "ilegible" };
  const r = regla0 as Obj;
  const firmantes = r["signers"];
  const politicas = r["policies"];
  if (!Array.isArray(firmantes) || !Array.isArray(politicas)) return { ok: false, motivo: "ilegible" };
  if (firmantes.length === 0) return { ok: false, motivo: "sin-firmante" };
  if (firmantes.length > 1) return { ok: false, motivo: "firmante-de-mas" };
  if (politicas.length > 0) return { ok: false, motivo: "politicas" };
  if (r["valid_until"] !== undefined && r["valid_until"] !== null) return { ok: false, motivo: "vencida" };
  return { ok: true };
}
