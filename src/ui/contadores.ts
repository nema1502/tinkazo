import { type PropsDe, type Red } from "../../workers/enlaces/src/conteo";
import { contarUnaVez, origenActual } from "../contar";

/**
 * La parte del contador anónimo del embudo (`src/contar.ts`) que mira la interfaz de la billetera y el paso de la
 * cuenta (issue #83). La red de cada paso la lee quien llama, de `src/stellar/config`: acá no se importa, para que
 * este archivo siga chico y sin el modo de Vite.
 *
 * Se manda lo mismo que siempre: el nombre del evento y, a lo sumo, dos propiedades de una lista cerrada
 * (`workers/enlaces/src/conteo.ts`). Sin token, sin id, sin cuenta, sin nombre, sin horas, nada que una a una persona
 * con el siguiente paso. Lo que sale de la demo y del ensayo también lo corta `contar` de siempre.
 */

/** Las dos redes del contrato (las de `workers/enlaces/src/conteo.ts`). En Oficial es mainnet; en Prueba, testnet. */
export type { Red };
/**
 * La primera cuenta conectada de la pestaña, por la vía y por la red, con la misma clave del contador de siempre: la
 * conexión con Google en Prueba y en Oficial se suman por separado, y como una sola pestaña retomada no se cuenta dos
 * veces. La red va como propiedad opcional: los cuerpos que mandaba el sitio de antes siguen entrando en el Worker.
 * `red` es `network.name` en el momento de emitir (`src/stellar/config`).
 */
export function contarEntradaConRed(kind: PropsDe<"account_connected">["kind"], red: Red): boolean {
  return contarUnaVez("account_connected", "account_connected", { kind, network: red, from: origenActual() });
}

/**
 * Una etapa del paso «Dejá tu cuenta lista», contada una vez por pestaña y por etapa. El paso vive solo en la red
 * principal: lo que llega de Prueba no cuenta. Solo que pasó, nunca quién.
 */
export function contarPasoOficial(paso: PropsDe<"oficial_step">["paso"], red: Red): boolean {
  if (red !== "mainnet") return false;
  return contarUnaVez(`oficial_step:${paso}`, "oficial_step", { paso });
}
