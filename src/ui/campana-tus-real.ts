/**
 * Lo de afuera de Tus campañas, armado con lo de verdad (`campana-sala.ts` lo usa en `depsReales`): pedir la lista y usar una
 * campaña en esta compu a la sala, armar lo que recuerda esta compu de un sorteo ya hecho, y el correo de ayuda. Nada de acá
 * guarda el token de la sesión: viaja en el cuerpo de cada pedido y no pasa de ahí.
 */
import { entradaDeUnSorteoRecuperado, entradaDelEvento, guardarSorteoDeCampana } from "../campana/en-curso";
import { misCampanas, recuperarCampana, resultadoDeSala, salaTieneTusCampanas } from "../sala/campana-org";
import { network } from "../stellar/config";
import type { DepsDeTus } from "./campana-sala";

/** La casilla de contacto de Tinkazo: la misma de la página de crear la campaña. */
export const CORREO_DE_AYUDA = "hola@tinkazo.app";

/** Si el panel se abrió desde la dirección de quien organiza (`?campana`): es la intención de organizar, y no un inicio de sesión cualquiera. */
export const abiertoDesdeLaDireccionDelPanel = (busqueda: string): boolean => new URLSearchParams(busqueda).has("campana");

export function depsDeTusReales(): DepsDeTus {
  return {
    alAbrir: () => abiertoDesdeLaDireccionDelPanel(location.search),
    disponible: () => salaTieneTusCampanas(),
    listar: (sesion) => misCampanas(sesion),
    recuperar: (sesion, evento) => recuperarCampana({ sesion, evento }),
    // Con el sorteo hecho en otra compu, esta arma su entrada con lo que la sala publica: el resultado es público desde el sello.
    armarSorteo: async (sala, cuenta) => {
      const leido = await resultadoDeSala(sala);
      if (typeof leido === "string") return false;
      const antes = entradaDelEvento(sala.red, sala.evento, undefined, cuenta);
      if (antes?.sorteo === leido.sorteo && antes.resultado === "hecho") return true;
      guardarSorteoDeCampana(
        entradaDeUnSorteoRecuperado({
          evento: sala.evento,
          red: sala.red,
          contrato: network.contractId ?? "",
          organizadora: cuenta,
          ahora: Date.now(),
          resultado: leido,
        }),
      );
      return true;
    },
    ayuda: (asunto) => `mailto:${CORREO_DE_AYUDA}?subject=${encodeURIComponent(asunto)}`,
  };
}
