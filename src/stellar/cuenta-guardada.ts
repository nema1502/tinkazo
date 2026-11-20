import { type NetworkName } from "./config";
import { hasPollarKey, leerMarcaPollar, type PollarKeyEnvironment } from "./pollar-config";
import { loadSessionKind } from "./session-store";

/**
 * Si en este navegador quedó una cuenta guardada de una red: el tipo de sesión
 * (`tinkazo.session.kind.<red>`, en `session-store`) o la marca de Google o de
 * correo (`tinkazo.pollar.intent.<red>`, en `pollar-config`, que solo se lee
 * cuando esa red tiene llave de Pollar).
 *
 * Es la misma pregunta que sabe retomar una sesión, pero sin abrir nada: la
 * usan la hoja de modo y la puerta para avisar que la cuenta quedó abierta en
 * el otro modo (nema1502/tinkazo#90). Se lee, nada más: nunca se abre acá la
 * sesión de la otra red — cada red retoma la suya cuando la página abre en ella.
 */

export interface CuentaGuardadaOpciones {
  /** Las llaves de Pollar, si quien llama ya las tiene a mano. Sin ellas, las del build. */
  env?: PollarKeyEnvironment | undefined;
  /** De dónde mirar la marca de Pollar: por defecto, el navegador. */
  almacen?: Pick<Storage, "getItem"> | undefined;
}

/** Si hay una cuenta guardada de esa red: tipo de sesión, o marca de Pollar con llave. */
export function hayCuentaGuardada(name: NetworkName, o: CuentaGuardadaOpciones = {}): boolean {
  if (loadSessionKind(name)) return true;
  try {
    return hasPollarKey(name, o.env) && leerMarcaPollar(o.almacen ?? localStorage, name) !== null;
  } catch {
    return false;
  }
}
