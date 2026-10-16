/**
 * Contar visitas, nunca personas ni nombres.
 *
 * Es la analítica de Vercel: qué página se abrió, desde qué país y en qué tipo
 * de equipo, sin cookies. Su script manda la dirección entera, y en el
 * comprobante y en la lista la dirección lleva los nombres después del `#`.
 * Por eso la dirección se corta antes de mandarse: queda el origen y la ruta,
 * sin `?…` ni `#…`. Si no se puede cortar, la visita no se cuenta.
 *
 * Solo corre en tinkazo.app: ni en localhost, ni en las vistas previas, ni en
 * las pruebas (el script de Vercel tampoco cuenta a un navegador automatizado).
 * Si el navegador pide que no lo sigan, no se carga. Los términos lo dicen en
 * "Y además"; si esto cambia, cambian ellos.
 */

const HOST = "tinkazo.app";
const SCRIPT = "/_vercel/insights/script.js";

/** La dirección hasta la ruta: lo que va después (`?…`, `#…`) no sale. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
}

/** El filtro que ve cada visita antes de salir. `null` la descarta. */
export function beforeSend<T extends { url: string }>(visit: T): T | null {
  const url = cleanUrl(visit.url);
  return url ? { ...visit, url } : null;
}

type PrivacyNavigator = Pick<Navigator, "doNotTrack"> & { globalPrivacyControl?: boolean };

/** Si esta visita se cuenta: el sitio de verdad, y un navegador que no pidió lo contrario. */
export function shouldCount(where: Pick<Location, "hostname">, nav: PrivacyNavigator): boolean {
  if (where.hostname !== HOST) return false;
  return nav.globalPrivacyControl !== true && nav.doNotTrack !== "1";
}

type Va = (command: string, arg?: unknown) => void;

/** Carga el contador, con el filtro puesto antes de que corra. */
export function countVisits(): void {
  if (!shouldCount(location, navigator)) return;
  const w = window as unknown as { va?: Va; vaq?: unknown[][] };
  // La cola que lee el script al cargar: el filtro tiene que estar antes de la
  // primera visita, que se manda apenas el script corre.
  w.va ??= (...args: unknown[]) => {
    (w.vaq ??= []).push(args);
  };
  w.va("beforeSend", beforeSend);
  if (document.head.querySelector(`script[src="${SCRIPT}"]`)) return;
  const s = document.createElement("script");
  s.src = SCRIPT;
  s.defer = true;
  document.head.appendChild(s);
}
