/**
 * El paso «Dejá tu cuenta lista» del celular de una campaña: después de entrar con Google, y antes de anotarse, la
 * cuenta se deja lista en la red principal con el paso que ya existe para quien organiza (`ui/cuenta-lista.ts`, con
 * `ui/proteger-cuenta.ts`): activarla y protegerla según la decisión de el modo de la herramienta, abierta a la vista
 * del celular (`celular: true`).
 *
 * Es un envoltorio chico a propósito: lo que el paso muestra y decide lo maneja `cuenta-lista.ts` de siempre. Acá se
 * mira primero, sin red, qué se sabe de la cuenta (`estadoOficialLocal` de la billetera de Pollar); solo lo que no se
 * sabe se pregunta con la red, con tope, y lo que ni la red confirma no bloquea a la persona: el alta con la sala ya
 * sabe decir que la cuenta no se creó. En la red de prueba no hay nada que activar ni proteger, y sin la sesión de
 * cuentas del proveedor tampoco: en esos casos no se abre nada y se sigue.
 */

import type { NetworkName } from "../stellar/config";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import type { CuentaDelPaso, OpcionesDelPaso, SalidasDelPaso, abrirCuentaLista } from "../ui/cuenta-lista";

/** La parte de la billetera de Pollar que este envoltorio mira. En las pruebas, un reemplazo. */
export interface BilleteraDeLaCuenta {
  address: string | null;
  estadoOficialLocal(): { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" };
  estadoOficial(fresco?: boolean): Promise<EstadoOficial>;
  sesionViva(): boolean;
}

/** Con qué se abre el paso. `abrir` y `billetera` son reemplazos en las pruebas. */
export interface PiezasDeLaCuenta {
  red: NetworkName | "mainnet" | "testnet";
  /** La sesión de cuentas ya abierta en el navegador, o `null` si no la hay. */
  billetera: () => Promise<BilleteraDeLaCuenta | null>;
  /** Cerrar la sesión desde el paso tiene que cerrar la de la campaña con ella. */
  salidas: Pick<SalidasDelPaso, "cerrarSesion">;
  /** La recarga de la página cuando en el paso hay que entrar de nuevo y la sesión de la campaña no puede. */
  recargar?: () => void;
  abrir: typeof abrirCuentaLista;
}

/** Cuánto se espera a la lectura con red, cuando lo local no dice nada. */
export const TOPE_DE_LECTURA_MS = 8_000;

/** Lo que le falta a una cuenta para estar lista, una vez leída. Lo que no se sabe no cuenta. */
function faltaAlgo(e: EstadoOficial): boolean {
  return e.activacion === "falta" || e.activacion === "preparando" || e.activacion === "fallo"
    || e.proteccion === "falta" || e.proteccion === "aparato-nuevo" || e.proteccion === "sin-forma";
}

async function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, no) => {
    reloj = setTimeout(() => no(new Error("tope")), ms);
  });
  return Promise.race([p, tope]).finally(() => clearTimeout(reloj));
}

/** Todo lo que se sabe de la cuenta sin red: si el almacenamiento falla, no se sabe nada. */
function localDe(b: BilleteraDeLaCuenta): { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" } {
  try {
    return b.estadoOficialLocal();
  } catch {
    return { activacion: "no-se-sabe", proteccion: "no-se-sabe" };
  }
}

/** Abre el paso y espera lo que la persona eligió: `true` si siguió con la cuenta lista. */
export function pasoDeLaCuenta(p: PiezasDeLaCuenta): () => Promise<boolean> {
  return async (): Promise<boolean> => {
    // En cada red que no es la principal la cuenta ya está lista, como el paso mismo entiende fuera de Oficial.
    if (p.red !== "mainnet") return true;
    const b = await p.billetera().catch(() => null);
    if (!b || !b.address) return true;
    const local = localDe(b);
    if (local.activacion === "lista" && local.proteccion === "lista") return true;
    let inicial: Partial<EstadoOficial>;
    if (local.activacion === "falta") {
      inicial = { activacion: "falta" };
    } else {
      // Lo que no se sabe no se dice: se mira con la red, con tope, y lo que no contesta no bloquea a la persona.
      let e: EstadoOficial;
      try {
        e = await conTope(b.estadoOficial(true), TOPE_DE_LECTURA_MS);
      } catch {
        return true;
      }
      if (!faltaAlgo(e)) return true;
      inicial = e;
    }
    try {
      const eleccion = await p.abrir(
        b as unknown as CuentaDelPaso,
        {
          // «Pasar a Prueba» no existe en una campaña de la red principal, y cerrar la sesión es la de la campaña.
          cerrarSesion: p.salidas.cerrarSesion,
          pasarAPrueba: () => undefined,
          puedePasarAPrueba: () => false,
          entrarDeNuevo: () => p.recargar?.(),
        },
        {
          para: "entrada",
          celular: true,
          direccion: b.address,
          inicial,
        } satisfies OpcionesDelPaso,
      );
      return eleccion === true;
    } catch (e) {
      // Si el paso no se pudo abrir (el wifi cortó la descarga), se avisa y se ofrece volver a cargar, y se deja que el
      // fallo suba: no es que la persona haya elegido no seguir, y cerrar su sesión por una descarga sería peor.
      console.warn("[tinkazo] no se pudo abrir el paso de la cuenta", e);
      // Se baja aparte: trae el diccionario de la herramienta, que la página del celular solo carga cuando hace falta.
      await import("../ui/aviso-no-cargo").then(({ avisarQueNoCargo }) => avisarQueNoCargo(p.recargar)).catch(() => undefined);
      throw e;
    }
  };
}
