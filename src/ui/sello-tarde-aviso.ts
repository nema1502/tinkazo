/**
 * Lo que dice la pantalla después de un sello pagado por el portero que entró a la cadena y falló ahí.
 *
 * Es lo que pasó el 13 de noviembre de 2026 en la red principal: la firma de la cuenta de Google tardó medio minuto, el
 * sello entró a un ledger con 25 s para su ronda, el contrato lo rechazó y el portero contó como gastado el único sorteo
 * oficial de la cuenta. El reintento encontró la cuenta en cero y la pantalla abrió Se te acabaron los sorteos oficiales,
 * como si la persona los hubiera usado. El portero nuevo devuelve ese sorteo solo, después de comprobar en la cadena que
 * fue por la ronda (`workers/patrocinio/src/sello-tarde.ts`), y lo anuncia en `/cupo`. Con ese anuncio la pantalla dice
 * qué pasó, que no fue un error de la persona, que el sorteo vuelve y a dónde escribir si no lo ve. Sin el anuncio no
 * promete nada. Lo técnico queda en el detalle plegado de siempre.
 *
 * Solo cuenta lo que entró a un ledger. Un sello que se frenó antes de mandarlo (`RondaMuyCerca` en `anchor.ts`) no dejó
 * nada en la cadena ni gastó ningún sorteo: después de ese, con cero sorteos, Se te acabaron sigue siendo cierto.
 */

/**
 * Lo que dice cada camino de un sello que entró a un ledger y falló ahí (`envio-sdk.ts`, el SDK de Stellar y Pollar, como
 * `ENTRO_Y_FALLO` de `stellar/errores.ts`). El error 5 del contrato suelto NO: también sale de la simulación, antes de
 * firmar, y del portero que rechaza antes de reservar, y ahí no entró nada ni se gastó ningún sorteo.
 */
const FALLO_EN_LA_CADENA = /tx-FAILED|Transaction failed!|txFailed|tx_failed|TX_CONTRACT_FAILED/;

/**
 * Si el error es de un sello que entró a un ledger y falló ahí. El que se frenó antes de mandar (`RondaMuyCerca`), el
 * que el portero rechazó (`ErrorPortero`) y el que falló en la simulación, no: ninguno gastó nada.
 */
export function entroYFalloEnLaCadena(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "RondaMuyCerca" || e.name === "ErrorPortero") return false;
  if (/simulation/i.test(e.message)) return false;
  return FALLO_EN_LA_CADENA.test(e.message);
}

/** El portero dijo que la cuenta no tiene sorteos oficiales que alcancen (`ErrorPortero`, `sin-sorteos`). */
function sinSorteosDelPortero(e: unknown): boolean {
  const x = e as { name?: unknown; motivo?: unknown } | null;
  return !!x && typeof x === "object" && x.name === "ErrorPortero" && x.motivo === "sin-sorteos";
}

/**
 * Qué decir cuando el sello no se pudo terminar y antes algún intento entró a la cadena y falló, pagado por el portero.
 * `devuelve`: el portero dijo en `/cupo` que devuelve solo el sorteo de un sello que entró tarde (solo el portero nuevo
 * lo dice, y solo mientras ni la cuenta ni el portero llegaron a su tope de devoluciones del día). Sin eso no se promete
 * ninguna devolución: el sitio puede estar delante de un portero que no la hace, o de uno que ya sabe que no la va a hacer.
 *
 * - `"sin-sorteos"`: con `devuelve`, el último intento encontró la cuenta sin sorteos. En lugar de Se te acabaron,
 *   `selloTardeSinSorteos`. Sin `devuelve`, `null`: Se te acabaron, como siempre, que es verdad con ese portero.
 * - `"aviso"`: otro error, con `devuelve`. Va el mensaje de siempre y, a continuación, `selloTardeAviso`.
 * - `"aviso-sin-devolucion"`: otro error, sin `devuelve`. El mensaje de siempre y `selloTardeAvisoSinDevolucion`, que
 *   no promete nada. Los dos avisos, solo con el cobro por uso: sin él (la billetera propia, la cuenta de prueba, la red
 *   de prueba) no hay sorteos oficiales que nombrar.
 * - `null`: ningún intento entró a la cadena. Todo como siempre.
 */
export function avisoTrasFallarEnLaCadena(e: unknown, o: { fallosEnLaCadena: number; cobroPorUso: boolean; devuelve: boolean }): "sin-sorteos" | "aviso" | "aviso-sin-devolucion" | null {
  if (o.fallosEnLaCadena <= 0) return null;
  if (sinSorteosDelPortero(e)) return o.devuelve ? "sin-sorteos" : null;
  if (!o.cobroPorUso) return null;
  return o.devuelve ? "aviso" : "aviso-sin-devolucion";
}
