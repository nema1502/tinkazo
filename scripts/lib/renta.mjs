/**
 * Las piezas de scripts/check-renta.mjs que no tocan la red. Sin efectos al importarse.
 *
 * Lo que sostiene al contrato son dos entradas, y cada una paga su alquiler por separado:
 * la instancia (se extiende con `--id`) y el código (se extiende con `--wasm-hash`). Extender
 * solo la instancia deja que el código se archive, y entonces el contrato tampoco se lee.
 * Las dos opciones se comprobaron con `stellar contract extend --help` en la 28.1.0 y la 30.0.1.
 */

/**
 * El hash del código de un `ContractExecutable` del SDK, en hexadecimal, o null si no es un .wasm. El
 * SDK lo da como un objeto `Hash` (con `Buffer.from` lanzaba); se acepta también la forma vieja, con
 * `wasmHash()` como función. Si llega otra forma, lanza diciendo cuál: un hash falso daría una orden de
 * extensión equivocada.
 */
export function hashDelCodigo(ejecutable) {
  const h = typeof ejecutable?.wasmHash === "function" ? ejecutable.wasmHash() : ejecutable?.wasmHash;
  if (h == null) return null;
  let hex;
  try {
    hex = typeof h.toXdr === "function" ? h.toXdr("hex") : Buffer.isBuffer(h) || h instanceof Uint8Array ? Buffer.from(h).toString("hex") : null;
  } catch {
    hex = null;
  }
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/.test(hex)) {
    const forma = typeof h === "object" ? `${h.constructor?.name ?? "objeto"} de ${h.length ?? "?"} bytes` : typeof h;
    throw new Error(`el hash del código llegó con una forma inesperada (${forma})`);
  }
  return hex;
}

/** Unos 120 días a un ledger cada cinco segundos: lo que se viene extendiendo. */
export const LEDGERS_A_EXTENDER = 2_073_600;

/**
 * Las dos órdenes para extender el contrato: la instancia y el código. Lo que no se sepa
 * (el hash si no se pudo leer, la cuenta que paga) queda como `<…>` para completar a mano.
 */
export function sugerenciasDeExtension({ red, contrato, wasmHashHex, cuenta } = {}) {
  const resto =
    ` --ledgers-to-extend ${LEDGERS_A_EXTENDER} --durability persistent` +
    ` --source ${cuenta || "<cuenta>"} --network ${red || "<red>"}`;
  return [
    `stellar contract extend --id ${contrato || "<contrato>"}${resto}`,
    `stellar contract extend --wasm-hash ${wasmHashHex || "<hash del código>"}${resto}`,
  ];
}
