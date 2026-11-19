import type { Registro } from "./protocol/verificacion";
import type { ContratoOficial } from "./stellar/oficiales";
import { leerRegistro } from "./stellar/registro";
import { respaldoDe } from "./stellar/rpc-red";

/**
 * El registro de un sorteo para la verificación. Si el servicio de lectura del contrato no contesta (cien celulares
 * desde la misma wifi pueden toparse con su límite), se lee del otro de su lista (`respaldoDe`), como ya hace la
 * lectura de los otros sellos (`seals.ts`). Es solo lectura: lo que conteste el segundo pasa por las mismas
 * comprobaciones. Si el servicio no está en ninguna lista, o los dos fallan, falla como siempre.
 */
export async function leerRegistroConRespaldo(
  contrato: ContratoOficial,
  id: string,
  leer: (contrato: ContratoOficial, id: string) => Promise<Registro> = leerRegistro,
): Promise<Registro> {
  try {
    return await leer(contrato, id);
  } catch (e) {
    const respaldo = respaldoDe(contrato.rpcUrl);
    if (!respaldo || respaldo.otro === contrato.rpcUrl) throw e;
    return leer({ ...contrato, rpcUrl: respaldo.otro }, id);
  }
}
