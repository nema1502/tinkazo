/**
 * La línea de cuando el servicio de cuentas frena el ingreso por límite, con la cuenta que baja. Se baja con `import()`
 * recién cuando pasa: casi nadie lo ve, y la página del celular no carga nada de esto.
 *
 * Es un diccionario propio: no pasa por el armado del sitio, que mete en el HTML solo las claves que nombran los archivos de
 * la página.
 */

import type { Lang } from "../idioma";
import { sustituir } from "./sustituir";

export const TEXTOS_LIMITE: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    lmEspera: "Hay mucha gente entrando. Probá en {n} segundos.",
    lmEspera1: "Hay mucha gente entrando. Probá en 1 segundo.",
  },
  en: {
    lmEspera: "Lots of people are signing in. Try again in {n} seconds.",
    lmEspera1: "Lots of people are signing in. Try again in 1 second.",
  },
};

/** La línea del límite con lo que falta, en el idioma de la persona. */
export function textoDeLimite(idioma: Lang, segundos: number): string {
  const textos = TEXTOS_LIMITE[idioma];
  return segundos <= 1 ? textos.lmEspera1 ?? "" : sustituir(textos.lmEspera ?? "", { n: String(segundos) });
}

/** Lo que la cuenta que baja necesita de la pantalla de Entrar. */
export interface PiezasDelLimite {
  /** La línea de error: se muestra mientras dura el límite y se esconde al liberarse. */
  error: HTMLElement;
  /** El botón de Entrar: apagado mientras dura, y se prende solo al liberarse. Abrir Google sigue pidiendo un toque. */
  entrar: HTMLButtonElement;
  ahora: () => number;
  idioma: () => Lang;
  /** Programa algo con un temporizador que la pantalla apaga al pintarse de nuevo. */
  programar: (f: () => void, ms: number) => number;
}

/**
 * Dice cuánto falta, cada segundo, hasta `hasta` (hora del reloj de la página). La línea se anuncia una sola vez para el
 * lector de pantalla: los números que bajan no se leen cada segundo.
 */
export function contarElLimite(p: PiezasDelLimite, hasta: number): void {
  const faltan = Math.ceil((hasta - p.ahora()) / 1000);
  if (faltan <= 0) {
    p.error.hidden = true;
    p.error.removeAttribute("role");
    p.entrar.disabled = false;
    return;
  }
  p.entrar.disabled = true;
  if (p.error.hidden) p.error.setAttribute("role", "status");
  p.error.textContent = textoDeLimite(p.idioma(), faltan);
  p.error.hidden = false;
  p.programar(() => {
    p.error.removeAttribute("role");
    contarElLimite(p, hasta);
  }, 1000);
}
