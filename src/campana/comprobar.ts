/**
 * La comprobación propia del sello por el celular de una campaña: después del sello, el celular lee en la red la
 * transacción del sello y comprueba él mismo que su cuenta está en la lista, sin creerle al servidor.
 *
 * Qué lee y con qué se compra:
 *  - el comprobante (`/verificar.html#…`) que da la sala trae la lista canónica y el hash de la transacción del sello;
 *  - la transacción del sello se lee del historial público de la red con ese hash (`stellar/historial.ts`) y de ahí salen
 *    el contrato, la huella de la lista sellada, la cantidad, las ganadoras y la ronda;
 *  - la huella se vuelve a calcular acá, con la lista del comprobante: si la red y el comprobante no cuentan lo mismo,
 *    el celular no afirma nada (`null`), ni bien ni mal;
 *  - la cuenta va en la lista del comprobante: si está, sale el `esta` que la pantalla cuenta. Si no está, o si algo no
 *    cuadra, no se dice nada: la persona nunca se entera por acá de que no está, porque la cuenta que se mira puede no ser
 *    la que se anotó y una lectura rara no puede sonar a alarma.
 *
 * No se comprueba la firma de la ronda ni la matemática del sorteo: eso lo hace la página de verificación entera, a la
 * que van los enlaces «Ver cómo se eligió». Acá solo se atestigua que la lista sellada tiene la cuenta, leído en la red.
 */

import { canonicalList, listHash } from "../protocol/canonical";
import { decodeProof } from "../protocol/proof";
import { bytesToHex, roundTime } from "../protocol/quicknet";
import { cuentaValida } from "../sala/campana";
import type { LecturaDelHistorial } from "../stellar/historial";
import type { NetworkName } from "../stellar/config";

/** Lo que la comprobación es capaz de decir. `null`: no se pudo comprobar, y la pantalla no dice nada. */
export type ComprobacionDelSello = "esta" | null;

/** Lo que apoya la comprobación. `leer` es el historial de la red; en las pruebas, el simulador. */
export interface PiezasDeLaComprobacion {
  leer: (red: string, hash: string) => Promise<LecturaDelHistorial>;
  ahora?: () => number;
}

/**
 * Lo que la sala dice de esta campaña, para que la comprobación no sea solo contra un contrato: el sello que la red
 * atestigua tiene que ser el de esta campaña y no el de otro sorteo cualquiera del mismo contrato.
 */
export interface DeLaCampana {
  /** El número del sorteo que la sala guardó al sellar. Sin él no se afirma nada. */
  sorteo: string | null;
  /** Las cuentas que la sala dio como ganadoras. */
  ganadoras: readonly string[];
  /** El número de la promoción, si la campaña la tiene. */
  promo: string | null;
}

/** Pasa a reintentar solo con lo que puede ser pasajero. Lo que la red contradice o ya no guarda no se vuelve a pedir. */
const REINTENTABLES: ReadonlySet<string> = new Set(["red-caida", "no-encontrada", "respuesta-invalida"]);

/**
 * Las esperas entre una lectura y la siguiente: dos lecturas como mucho por celular. Con 300 celulares detrás de la misma
 * conexión, cada lectura de más es un pedido más a la misma dirección de la red, justo cuando esa red ya puede estar limitando.
 */
export const ESPERAS_DEL_SELLO_MS: readonly number[] = [8_000];
/** Desde el primer pedido, pasado esto no se espera ni se pide más. */
export const TOPE_DEL_SELLO_MS = 40_000;

export interface PiezasConReintento extends PiezasDeLaComprobacion {
  esperar: (ms: number) => Promise<void>;
  /** Las esperas entre lecturas. Vacías, se lee una sola vez (el sello de una campaña con premios suma lecturas al RPC). */
  esperas?: readonly number[];
}

/** Un lector del historial real, armado a la primera y reusado después. Nunca lanza: los fallos vuelven como lectura. */
export async function lectorDelHistorial(): Promise<(red: string, hash: string) => Promise<LecturaDelHistorial>> {
  const { crearLectorDeHistorial } = await import("../stellar/historial");
  const lector = crearLectorDeHistorial();
  return (red, hash) => lector(red as NetworkName, hash);
}

/** Reduce un texto a su hash de transacción, en minúsculas, o `null` si no tiene forma de uno. */
function hashDeTx(valor: unknown): string | null {
  return typeof valor === "string" && /^[0-9a-fA-F]{64}$/u.test(valor) ? valor.toLowerCase() : null;
}

/**
 * Comprueba la cuenta contra el sello que la red guarda. Nunca lanza: lo que no se pudo leer es `null`, y la pantalla
 * se queda callada en vez de inventar un veredicto.
 */
export async function comprobarMiCuenta(
  o: { comprobante: string; cuenta: string; red: string; contrato: string | null; campana: DeLaCampana },
  piezas: PiezasDeLaComprobacion,
): Promise<ComprobacionDelSello> {
  const corte = o.comprobante.indexOf("#");
  if (corte < 0) return null;
  let prueba: Awaited<ReturnType<typeof decodeProof>>;
  try {
    prueba = await decodeProof(o.comprobante.slice(corte));
  } catch {
    return null;
  }
  if (prueba.net !== o.red) return null;
  const stx = hashDeTx(prueba.stx);
  if (!stx) return null;
  const nombres = prueba.names;
  if (!Array.isArray(nombres)) return null;
  for (const nombre of nombres) {
    if (typeof nombre !== "string" || !cuentaValida(nombre)) return null;
  }
  // La lista que el comprobante trae tiene que estar ya canónica (como la sella la sala): si canonicalizarla la cambia,
  // el comprobante y lo que la red atestigua no son la misma lista, y no se afirma nada.
  const canonica = canonicalList(nombres.join("\n"));
  if (canonica.length !== nombres.length || canonica.some((nombre, i) => nombre !== nombres[i])) return null;
  let lectura: LecturaDelHistorial;
  try {
    lectura = await piezas.leer(o.red, stx);
  } catch {
    return null;
  }
  if (!lectura.ok) return null;
  const sello = lectura.sello;
  // La lectura es de la transacción del comprobante: la pedida o, si un fee-bump la envolvió, la interior.
  if (sello.hash.toLowerCase() !== stx && sello.hashInterior.toLowerCase() !== stx) return null;
  // Y de la ronda del comprobante: el sello de la red y el comprobante hablan del mismo sorteo.
  if (prueba.round !== sello.round) return null;
  // Es el sello de esta campaña: el sorteo que la sala guardó, la cantidad de premios y la promoción son los mismos.
  if (o.campana.sorteo === null || prueba.id !== o.campana.sorteo) return null;
  if (sello.numWinners !== o.campana.ganadoras.length) return null;
  if (o.campana.promo !== null && sello.premio?.promocionId !== o.campana.promo) return null;
  if (bytesToHex(listHash(canonica)) !== sello.listHash.toLowerCase()) return null;
  if (sello.count !== canonica.length) return null;
  // Una campaña con premios sella en su contrato de premios, que sella adentro en el del sorteo: vale cualquiera de los dos.
  const contratos = [sello.contractId, sello.premio?.contrato].filter((c): c is string => typeof c === "string");
  if (o.contrato !== null && !contratos.some((c) => c.toLowerCase() === (o.contrato as string).toLowerCase())) return null;
  // La ronda todavía no salió: no puede atestiguar una lista para un sorteo que no existe.
  if (!Number.isSafeInteger(sello.round) || sello.round < 1 || roundTime(sello.round) * 1000 > (piezas.ahora ?? Date.now)()) {
    return null;
  }
  // Las ganadoras que la sala dio salen de esta misma lista.
  if (!o.campana.ganadoras.every((g) => canonica.includes(g))) return null;
  return canonica.includes(o.cuenta) ? "esta" : null;
}

/** La lectura, o una red caída si no terminó en `ms`: una lectura en vuelo no pasa del tope. Nunca lanza. */
function conTope(lectura: Promise<LecturaDelHistorial>, ms: number): Promise<LecturaDelHistorial> {
  return new Promise((resolver) => {
    const caida: LecturaDelHistorial = { ok: false, error: "red-caida" };
    const t = setTimeout(() => resolver(caida), Math.max(0, ms));
    void lectura.then(
      (l) => {
        clearTimeout(t);
        resolver(l);
      },
      () => {
        clearTimeout(t);
        resolver(caida);
      },
    );
  });
}

/**
 * La misma comprobación, con la lectura repetida si la red falla. Dos lecturas como mucho (una espera de 8 segundos) y nada
 * pasados los 40 segundos desde el primer pedido: el tope corta también una lectura que no contesta. Solo se repite lo que
 * puede ser pasajero: lo que la red contradice (una transacción fallida, que no es un sello o de un contrato ajeno) se queda
 * sin decir, y si la red contestó que hay demasiados pedidos no se vuelve a pedir: repetir solo sumaría al límite.
 */
export async function comprobarConReintento(
  o: Parameters<typeof comprobarMiCuenta>[0],
  piezas: PiezasConReintento,
): Promise<ComprobacionDelSello> {
  const ahora = piezas.ahora ?? Date.now;
  const esperas = piezas.esperas ?? ESPERAS_DEL_SELLO_MS;
  const inicio = ahora();
  const leer = async (red: string, hash: string): Promise<LecturaDelHistorial> => {
    let ultima: LecturaDelHistorial = { ok: false, error: "red-caida" };
    for (let intento = 0; ; intento += 1) {
      ultima = await conTope(Promise.resolve().then(() => piezas.leer(red, hash)), TOPE_DEL_SELLO_MS - (ahora() - inicio));
      if (ultima.ok || !REINTENTABLES.has(ultima.error) || ultima.limitado) return ultima;
      const espera = esperas[intento];
      if (espera === undefined || ahora() - inicio + espera > TOPE_DEL_SELLO_MS) return ultima;
      await piezas.esperar(espera);
      if (ahora() - inicio > TOPE_DEL_SELLO_MS) return ultima;
    }
  };
  return comprobarMiCuenta(o, { leer, ahora });
}
