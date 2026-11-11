import { mostrar, normalizar } from "./cupon-codigo";

/**
 * El cupón que llegó en el enlace (`https://tinkazo.app/?red=oficial#cupon=K7M29QXA4HTR`) y lo que se hace con él en el
 * navegador. El código va en el fragmento (`#`), que el navegador no manda a ningún servidor; acá se lee, se normaliza
 * y se guarda solo el código en `sessionStorage`, para que aguante la ventana de Google y una recarga. No se escribe
 * nunca en la consola ni en un mensaje de error.
 *
 * Quien lo usa en una pantalla (el paso «Dejá tu cuenta lista») pide `cuponGuardado()` y, al canjearlo, `olvidarCupon()`.
 * Sin dependencias de la página: el almacén entra como argumento, así se prueba solo.
 */

/** Donde vive el cupón en la pestaña. */
export const CLAVE_CUPON = "tinkazo.cupon";

/** Lo mínimo que se le pide a un almacén (`sessionStorage`). */
export interface AlmacenDeCupon {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** El de la pestaña, o `null` si el navegador no deja tocarlo (modo privado, datos bloqueados). */
function elDeLaPestana(): AlmacenDeCupon | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Lo que trae un fragmento de dirección: si pide un cupón (`cupon=…`, venga bien o mal escrito) y cuál es, ya
 * normalizado, o `null` si no tiene la forma de un cupón.
 */
export function cuponDelFragmento(fragmento: string): { hay: boolean; codigo: string | null } {
  const sin = fragmento.startsWith("#") ? fragmento.slice(1) : fragmento;
  let valor: string | null = null;
  let hay = false;
  for (const par of sin.split("&")) {
    const i = par.indexOf("=");
    if ((i < 0 ? par : par.slice(0, i)).toLowerCase() !== "cupon") continue;
    hay = true;
    if (valor === null) {
      const crudo = i < 0 ? "" : par.slice(i + 1);
      try {
        valor = decodeURIComponent(crudo);
      } catch {
        valor = null;
      }
    }
  }
  return { hay, codigo: normalizar(valor) };
}

/** La dirección sin el cupón: lo que había en el fragmento queda, menos `cupon=…`. */
export function direccionSinCupon(ruta: string, busqueda: string, fragmento: string): string {
  const sin = fragmento.startsWith("#") ? fragmento.slice(1) : fragmento;
  const resto = sin.split("&").filter((par) => (par.indexOf("=") < 0 ? par : par.slice(0, par.indexOf("="))).toLowerCase() !== "cupon" && par !== "");
  return `${ruta}${busqueda}${resto.length ? `#${resto.join("&")}` : ""}`;
}

/** Guarda el cupón de esta pestaña. `false` si no tiene la forma de un cupón o si no se pudo guardar: nada queda a medias. */
export function guardarCupon(entrada: unknown, almacen: AlmacenDeCupon | null = elDeLaPestana()): boolean {
  const codigo = normalizar(entrada);
  if (!codigo || !almacen) return false;
  try {
    almacen.setItem(CLAVE_CUPON, codigo);
    return almacen.getItem(CLAVE_CUPON) === codigo;
  } catch {
    return false;
  }
}

/**
 * El cupón guardado en esta pestaña, ya normalizado (12 caracteres), o `null`. Lo que haya en el almacén se vuelve a
 * normalizar: un valor que alguien escribió a mano y no tiene la forma de un cupón no se entrega.
 */
export function cuponGuardado(almacen: AlmacenDeCupon | null = elDeLaPestana()): string | null {
  if (!almacen) return null;
  try {
    return normalizar(almacen.getItem(CLAVE_CUPON));
  } catch {
    return null;
  }
}

/** Se canjeó, o se cerró la sesión: el cupón se olvida. */
export function olvidarCupon(almacen: AlmacenDeCupon | null = elDeLaPestana()): void {
  try {
    almacen?.removeItem(CLAVE_CUPON);
  } catch {
    /* sin almacén, no hay nada que olvidar */
  }
}

/** El cupón guardado como se muestra: `K7M2-9QXA-4HTR`, o `null`. */
export function cuponParaMostrar(almacen: AlmacenDeCupon | null = elDeLaPestana()): string | null {
  const c = cuponGuardado(almacen);
  return c ? mostrar(c) : null;
}

/** El enlace que lleva este cupón: el que se copia para abrirlo en otro navegador. */
export function enlaceConCupon(origen: string, ruta: string, busqueda: string, codigo: string): string {
  return `${origen}${ruta}${busqueda}#cupon=${codigo}`;
}
