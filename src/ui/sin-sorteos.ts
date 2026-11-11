import { t } from "../i18n";
import { type Acceso, consultarAcceso } from "../stellar/acceso-oficial";
import { esNoDelPortero } from "../stellar/errores";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import { abrirDialogo, botonPrincipal } from "./dialogo";
import { pasarAModo, puedeCambiarDeModo } from "./modo-ui";
import { mostrarSinPatrocinio } from "./red";
import { currentSession } from "./wallet-ui";

/**
 * Las compuertas del acceso con el cobro por uso del modo Oficial (`cobro-oficial.ts`), con lo que ve la persona. Solo
 * las llama quien ya sabe que rige el cobro (`freeze.ts` y `draw.ts`); la decisión, sin pantalla, es de
 * `stellar/acceso-oficial.ts`. Ninguna pide una firma: dicen si se puede pedir.
 *
 * - Sin acceso: se abre «Dejá tu cuenta lista» (`abrirParaElError` de `cuenta-lista-flujo.ts`), donde se usa el cupón o
 *   se compra el primer paquete. Al volver, se pregunta de nuevo al portero: lo que diga el paso no alcanza.
 * - Sin sorteos que alcancen para el sello: la ventana «Se te acabaron los sorteos oficiales». Puede estar proyectada
 *   frente a la sala, así que la acción principal nunca es un cobro: es «Usar un cupón», y al lado «Pasar a Prueba».
 * - Llegó al tope de sellos del mes, o el portero no contesta: la caja de la red, con su frase y su acción.
 */

export interface OpcionesDeLaCompuerta {
  /** A dónde vuelve el foco al cerrarse el paso de la cuenta. */
  volverA?: HTMLElement | null;
  /** Mientras se le pregunta al portero (hasta 6 segundos la primera vez). */
  alRevisar?: (revisando: boolean) => void;
  /** La persona eligió «Usar un cupón» (la caja de la red): sin acceso, el paso abre en el campo del cupón. */
  cupon?: boolean;
}

/** Cuántas veces se vuelve a mirar después de que la persona usó el paso, como mucho: nunca un ir y venir sin fin. */
const VUELTAS = 3;

async function revisar(para: "sello" | "sorteo", ganadores: number | undefined, o: OpcionesDeLaCompuerta): Promise<Acceso> {
  o.alRevisar?.(true);
  try {
    // Siempre lo de ahora: lo que se supo hace un rato puede ser de antes del último sello.
    return await consultarAcceso(currentSession()?.address, para, ganadores, { forzar: true });
  } finally {
    o.alRevisar?.(false);
  }
}

/**
 * Abre «Dejá tu cuenta lista» para conseguir el acceso. `true` si la persona siguió; si salió o no bajó, `false`. Con
 * `cupon`, la persona eligió «Usar un cupón»: el paso abre directo en el campo del cupón (o con el que ya tenga guardado).
 */
async function abrirElPaso(para: "sello" | "sorteo", volverA: HTMLElement | null | undefined, cupon = false): Promise<boolean> {
  let flujo: typeof import("./cuenta-lista-flujo");
  try {
    flujo = await import("./cuenta-lista-flujo");
  } catch {
    avisarQueNoCargo();
    return false;
  }
  return cupon ? flujo.abrirParaElError(para, volverA ?? null, { cupon: "escribir" }) : flujo.abrirParaElError(para, volverA ?? null);
}

export type EleccionSinSorteos = "cupon" | "prueba" | "cerrar";

/**
 * La ventana «Se te acabaron los sorteos oficiales». Devuelve lo que eligió la persona: «Usar un cupón» (la principal),
 * «Pasar a Prueba» (ya pedido el cambio de modo, si se podía) o cerrarla.
 */
export function abrirSeAcabaron(): Promise<EleccionSinSorteos> {
  return new Promise((resolve) => {
    let listo = false;
    const terminar = (e: EleccionSinSorteos): void => {
      if (listo) return;
      listo = true;
      resolve(e);
    };
    const dlg = abrirDialogo({ titulo: t("cupoOfCeroTitulo"), onCerrar: () => terminar("cerrar") });
    dlg.card.classList.add("sin-sorteos");
    const texto = document.createElement("p");
    texto.textContent = t("cupoOfCeroTexto");
    dlg.cuerpo.appendChild(texto);
    const cupon = botonPrincipal(t("cupoOfUsarCupon"));
    cupon.dataset.accion = "cupon";
    cupon.addEventListener("click", () => {
      terminar("cupon");
      dlg.cerrar();
    });
    const prueba = document.createElement("button");
    prueba.type = "button";
    prueba.className = "mini ghost";
    prueba.dataset.accion = "prueba";
    prueba.textContent = t("modeSwitchToTest");
    prueba.disabled = !puedeCambiarDeModo();
    prueba.addEventListener("click", () => {
      terminar("prueba");
      dlg.cerrar();
      pasarAModo("testnet");
    });
    dlg.pie.append(cupon, prueba);
  });
}

/** El no del portero, o del candado de antes de la firma, es que no quedan sorteos oficiales que alcancen. */
export const esSinSorteos = (e: unknown): boolean => esNoDelPortero(e) && e.motivo === "sin-sorteos";

/** Después de un sello que no salió por falta de sorteos: la ventana y, si elige «Usar un cupón», el paso. */
export async function alQuedarseSinSorteos(o: OpcionesDeLaCompuerta = {}): Promise<void> {
  if ((await abrirSeAcabaron()) === "cupon") await abrirElPaso("sello", o.volverA, true);
}

/**
 * La compuerta del sello: `true` si se puede pedir la firma. Si no, ya dijo por qué (o abrió lo que hace falta) y
 * devuelve `false`.
 */
export async function accesoParaSellar(ganadores: number, o: OpcionesDeLaCompuerta = {}): Promise<boolean> {
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    const a = await revisar("sello", ganadores, o);
    switch (a.que) {
      case "sigue":
        return true;
      case "sin-acceso":
        // La primera vez, el paso de la cuenta. Si sale de él, o volvió y sigue sin acceso, se dice por qué no se selló.
        if (vuelta === 0 && (await abrirElPaso("sello", o.volverA, o.cupon === true))) continue;
        await mostrarSinPatrocinio({ motivo: "ajena" });
        return false;
      case "sin-sorteos": {
        const eleccion = await abrirSeAcabaron();
        if (eleccion === "cupon" && (await abrirElPaso("sello", o.volverA, true))) continue;
        return false;
      }
      case "tope-mes":
        await mostrarSinPatrocinio({ motivo: "cupo-cuenta", que: "sellos", ...(a.liberaEn !== undefined ? { liberaEn: a.liberaEn } : {}) });
        return false;
      case "cerrado":
        await mostrarSinPatrocinio({ motivo: "cerrado" });
        return false;
    }
  }
  return false;
}

/**
 * La compuerta del sorteo: el acceso, y nada más. Si no deja seguir, la clave de lo que se le dice a la persona (quien
 * llama la escribe donde va el error del sorteo).
 */
export async function accesoParaSortear(o: OpcionesDeLaCompuerta = {}): Promise<{ sigue: true } | { sigue: false; clave: string }> {
  let a = await revisar("sorteo", undefined, o);
  if (a.que === "sin-acceso" && (await abrirElPaso("sorteo", o.volverA))) a = await revisar("sorteo", undefined, o);
  if (a.que === "sigue") return { sigue: true };
  return { sigue: false, clave: a.que === "sin-acceso" ? "errAnchor.porteroSinAlta" : "errAnchor.porteroFondoSorteo" };
}
