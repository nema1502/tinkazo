import { esDeRed } from "../stellar/errores";

/**
 * Lo que quedó de «Protegé tu cuenta», la ventana que se abría cuando el sello fallaba por la cuenta, y que reusa el paso
 * «Dejá tu cuenta lista» (`cuenta-lista.ts`), que la reemplazó el 11 de noviembre de 2026.
 *
 * Lo aprendido sigue valiendo: para el navegador, cerrar el cuadro del desbloqueo es lo mismo que no dejarlo abrir
 * (`NotAllowedError`), y no es una falla; un pedido de la red cortado a mitad no es la persona diciendo que no
 * (`cancelo`); y una espera a Pollar o al navegador tiene tope (`conTope`): pasado el tope se avisa y se deja reintentar,
 * y si la respuesta llega tarde y la cuenta quedó protegida, cuenta igual.
 */

/** Un correo con forma de correo. Pollar revisa el resto. */
export const mailOk = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

type Visto = { name?: unknown; message?: unknown; cause?: unknown };

/** Mira el error y sus causas (el SDK envuelve lo del navegador), hasta cuatro niveles: una causa que se apunta a sí misma no cuelga nada. */
function algunoDe(e: unknown, mira: (x: Visto | string) => boolean): boolean {
  let x: unknown = e;
  for (let nivel = 0; nivel < 4; nivel++) {
    if (typeof x === "string") return mira(x);
    if (!x || typeof x !== "object") return false;
    if (mira(x as Visto)) return true;
    x = (x as Visto).cause;
  }
  return false;
}

/**
 * El navegador no siguió con el desbloqueo: la persona cerró el cuadro, se acabó el tiempo o no se permite abrirlo acá
 * (un navegador que va dentro de otra aplicación, una página dentro de otra). Para WebAuthn las tres son lo mismo, un
 * `NotAllowedError`: no se puede saber cuál fue.
 */
export function noPermitido(e: unknown): boolean {
  return algunoDe(e, (x) => typeof x !== "string" && x.name === "NotAllowedError");
}

/**
 * La persona dijo que no al desbloqueo: no es una falla. Es un `NotAllowedError` del navegador, o el aviso de la ceremonia
 * propia cuando el navegador no devolvió nada (`passkey-cancelada`). El SDK puede envolverlo, así que se mira también la causa.
 *
 * No entra cualquier "abort" ni "cancel": Pollar cuenta así un pedido de la red cortado a mitad ("Aborted") y Safari dice
 * "cancelled" cuando el navegador corta uno, y eso no es la persona. Un `AbortError` vale solo si lo lanzó el navegador y su
 * texto no es el de un corte de la red (`esDeRed`, sin mirar el nombre, que ya diría "abort"): ahí se dice que falló.
 */
export function cancelo(e: unknown): boolean {
  return algunoDe(e, (x) => {
    if (typeof x === "string") return x === "passkey-cancelada";
    if (x.name === "NotAllowedError" || x.message === "passkey-cancelada") return true;
    return x.name === "AbortError" && typeof DOMException !== "undefined" && x instanceof DOMException && !esDeRed(new Error(typeof x.message === "string" ? x.message : ""));
  });
}

/** El motivo por el que Pollar no aceptó un código, si lo dice con su código de error. */
export const codigoMalo = (e: unknown): boolean => /OTP|CODE|INVALID|EXPIRED/i.test(e instanceof Error ? e.message : String(e));

/** Cuánto se espera a Pollar o al navegador: pasado esto el paso avisa y deja reintentar. */
export const TOPE_DE_ESPERA_MS = 60_000;
export const SIN_RESPUESTA = new Error("proteccion-sin-respuesta");

/**
 * Espera una llamada que puede no contestar nunca (Pollar sin red a mitad de camino, un cuadro del navegador que no
 * aparece). Pasado el tope rechaza con `SIN_RESPUESTA`. Si la llamada contesta después, `tarde` recibe lo que dijo: una
 * cuenta que quedó protegida cuenta, con tope o sin él.
 */
export function conTope<T>(llamada: Promise<T>, tarde: (valor: T) => void): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    let vencio = false;
    const reloj = setTimeout(() => {
      vencio = true;
      rechazar(SIN_RESPUESTA);
    }, TOPE_DE_ESPERA_MS);
    llamada.then(
      (valor) => {
        clearTimeout(reloj);
        if (vencio) tarde(valor);
        else resolver(valor);
      },
      (e: unknown) => {
        clearTimeout(reloj);
        if (!vencio) rechazar(e);
      },
    );
  });
}
