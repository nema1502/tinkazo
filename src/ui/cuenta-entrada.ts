import { t } from "../i18n";
import { modesVisible, requestedMode } from "../modos/bandera";
import { contar, seCuentaPorPersona } from "../participaciones";
import type { Entry } from "./history";

/**
 * La cuenta de personas y participaciones de una entrada de Mis sorteos, sin DOM: la usan la tarjeta de Mis sorteos
 * (`history.ts`) y el panel de la cuenta (`account-model.ts`) para decir lo mismo.
 */

/**
 * Cuántas personas y cuántas líneas tiene la lista de la entrada. Con la lista en este equipo, con la regla de todos
 * (`seCuentaPorPersona`): los modos a la vista o un modo en el enlace del comprobante, como lo cuenta la verificación de
 * ese enlace. Sin la lista (lo trajo la cadena, o es de otro equipo), cada línea es una persona, como siempre.
 */
export function cuentasDe(e: Entry): { personas: number; participaciones: number } {
  if (!e.names?.length) return { personas: e.count, participaciones: e.count };
  let delEnlace = false;
  try {
    delEnlace = !!e.proof && requestedMode(new URL(e.proof, "https://tinkazo.app").search) !== null;
  } catch {
    /* un enlace roto no trae modo */
  }
  return contar(e.names, seCuentaPorPersona(e.names, modesVisible() || delEnlace));
}

/** «12 personas», o «3 personas, 5 participaciones» cuando alguien tiene más de una: lo mismo que dicen la espera y la verificación. */
export function cuentaDeLaEntrada(e: Entry): string {
  const { personas, participaciones } = cuentasDe(e);
  return personas === participaciones
    ? `${personas} ${t("histPeople")}`
    : t("vCuentaPart").replace("{n}", String(personas)).replace("{k}", String(participaciones));
}
