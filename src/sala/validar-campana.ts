/**
 * El validador que corre el firmador de campañas antes de firmar. No tiene lógica propia: junta los dos lectores que van a
 * leer el archivo después, el de la sala (`leerTextoDeCampana`, que corre al crear la sala) y el del sitio (`leerCampana`,
 * que corre al abrir la pantalla). Así lo que Tinkazo firma es exactamente lo que los dos aceptan, y un archivo con un campo
 * mal no llega recién el día del evento. Lo carga `scripts/campana-firmar.mjs`.
 */
import { leerTextoDeCampana } from "../../workers/sala/src/campana";
import { leerCampana } from "../campana/modelo";
import { network } from "../stellar/config";

export type ValidacionDeCampana =
  | { ok: true }
  | { ok: false; quien: "sala" | "sitio"; campo: string; motivo: string };

/**
 * Si los dos lectores aceptan el texto de la campaña tal como se va a firmar. `ahora` es la hora contra la que se compara el
 * cierre. La red del archivo no se compara con la del sitio que corre este código: una campaña de mainnet se firma igual
 * desde una copia que abre en testnet, así que para el lector del sitio se mira el resto del archivo con su red puesta.
 */
export function validarCampanaParaFirmar(texto: string, ahora: number): ValidacionDeCampana {
  const sala = leerTextoDeCampana(texto, ahora);
  if (!sala.ok) return { ok: false, quien: "sala", campo: sala.campo, motivo: sala.motivo };
  const datos = JSON.parse(texto) as Record<string, unknown>;
  const sitio = leerCampana({ ...datos, red: network.name });
  if (!sitio.ok) return { ok: false, quien: "sitio", campo: sitio.campo, motivo: sitio.motivo };
  return { ok: true };
}
