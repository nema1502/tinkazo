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
  | { ok: false; quien: "sala" | "sitio" | "firmador"; campo: string; motivo: string };

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

/**
 * Lo que valida el firmador de Tinkazo: lo que aceptan la sala y el sitio, y además que una campaña de personas lleve su premio
 * en mano. Una campaña de personas no tiene cuenta a quien pagarle en dólares y las bases prometerían un pago que no hay, así que
 * la sala y el sitio la leen (para no atar las dos cosas) pero el firmador no la firma. Esta validación también la corre el armador
 * antes de bajar el archivo, y por eso el armador pide siempre el premio escrito en una campaña de personas, incluso al abrir un
 * archivo viejo que traía montos: así lo que baja es lo que el firmador acepta.
 */
export function validarCampanaParaElFirmador(texto: string, ahora: number): ValidacionDeCampana {
  const lectura = validarCampanaParaFirmar(texto, ahora);
  if (!lectura.ok) return lectura;
  const datos = JSON.parse(texto) as Record<string, unknown>;
  if (datos.identidad === "persona" && datos.premio_en_mano === undefined) {
    return { ok: false, quien: "firmador", campo: "premio_en_mano", motivo: "persona-sin-premio-en-mano" };
  }
  return { ok: true };
}
