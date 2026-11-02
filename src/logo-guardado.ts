import { conDemo } from "./ensayo-modo";
import { huellaLogo, validarLogo, type Logo, type LogoLeido } from "./logo";

/**
 * Dónde queda el logo en este navegador, y cuál va en el próximo sorteo.
 *
 * `localStorage["tinkazo.logos"]` guarda `{ actual: huella, m: { [huella]: { t, b, w, h, u } } }`:
 * hasta ocho logos, y si entra uno más se descarta el de uso más viejo (`u`).
 * `actual` es el que se pone en el próximo sorteo; los demás quedan para que un
 * sorteo de septiembre vuelva a compartirse con el logo de septiembre y no con
 * el de octubre (`Frozen.logo` y `Entry.logo` guardan solo la huella).
 *
 * Si el almacenamiento no responde, el logo vale hasta recargar y la
 * interfaz lo dice (`guardarLogo` devuelve `false`). Nada de esto sale del
 * navegador salvo dentro del enlace corto, cifrado (`enlace-corto.ts`).
 *
 * No toca la página y no importa `i18n`: la vista previa y el botón viven en
 * `ui/logo-ui.ts`.
 */

const CLAVE = "tinkazo.logos";
const MAX = 8;

interface Guardado extends Logo {
  w: number;
  h: number;
  /** La última vez que se usó, en milisegundos. */
  u: number;
}

interface Almacen {
  actual?: string;
  m: Record<string, Guardado>;
}

/** Lo que vale hasta recargar si `localStorage` no deja guardar. */
let respaldo: Almacen = { m: {} };
/** `localStorage` no dejó guardar (está lleno o bloqueado): lo que vale es el respaldo, aunque haya una copia vieja. */
let respaldoManda = false;
const oyentes: Array<() => void> = [];

/** Los logos de prueba (`?logo=prueba`) y los que no se pudieron guardar: nunca van a `localStorage`. */
const enMemoria = new Map<string, Logo>();

function limpio(x: unknown): Almacen {
  const salida: Almacen = { m: {} };
  if (!x || typeof x !== "object") return salida;
  const { actual, m } = x as { actual?: unknown; m?: unknown };
  if (m && typeof m === "object") {
    for (const [h, g] of Object.entries(m as Record<string, unknown>)) {
      const ok = validarLogo(g);
      if (!ok || huellaLogo(ok.logo) !== h) continue;
      const u = (g as { u?: unknown }).u;
      salida.m[h] = { ...ok.logo, w: ok.w, h: ok.h, u: typeof u === "number" ? u : 0 };
    }
  }
  if (typeof actual === "string" && Object.hasOwn(salida.m, actual)) salida.actual = actual;
  return salida;
}

function leer(): Almacen {
  if (respaldoManda) return respaldo;
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) return limpio(JSON.parse(raw));
  } catch {
    /* sin almacenamiento, o con datos rotos: vale el respaldo */
  }
  return respaldo;
}

function escribir(a: Almacen): boolean {
  respaldo = a;
  let guardado = true;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(a));
    respaldoManda = false;
  } catch {
    guardado = false;
    respaldoManda = true;
  }
  for (const fn of oyentes) {
    try {
      fn();
    } catch {
      /* un oyente roto no frena a los demás */
    }
  }
  return guardado;
}

/** Avisa cada vez que se pone, se cambia o se quita el logo. */
export function alCambiarLogo(fn: () => void): void {
  oyentes.push(fn);
}

/** Pone este logo como el de los próximos sorteos. Devuelve su huella y si quedó guardado en este navegador. */
export function guardarLogo(l: LogoLeido): { huella: string; guardado: boolean } {
  const a = leer();
  const huella = huellaLogo(l.logo);
  const m = { ...a.m, [huella]: { ...l.logo, w: l.w, h: l.h, u: Date.now() } };
  const sobran = Object.entries(m).sort((x, y) => x[1].u - y[1].u).slice(0, Math.max(0, Object.keys(m).length - MAX));
  for (const [h] of sobran) if (h !== huella) delete m[h];
  const guardado = escribir({ actual: huella, m });
  if (!guardado) enMemoria.set(huella, l.logo);
  return { huella, guardado };
}

/** "Quitar": borra el logo actual y todos los guardados. */
export function quitarLogo(): void {
  respaldoManda = false;
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento, solo la memoria */
  }
  enMemoria.clear();
  escribir({ m: {} });
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* igual */
  }
}

/** El logo que se pondría en el próximo sorteo, si hay. Con `?logo=prueba`, el de prueba. */
export function logoActual(): { huella: string; logo: Logo } | null {
  if (esDePrueba()) return { huella: huellaLogo(LOGO_DE_PRUEBA), logo: LOGO_DE_PRUEBA };
  const a = leer();
  const g = a.actual && Object.hasOwn(a.m, a.actual) ? a.m[a.actual] : undefined;
  return a.actual && g ? { huella: a.actual, logo: { t: g.t, b: g.b } } : null;
}

/** El logo de una huella (la de un sorteo ya sellado). Null si este navegador no lo tiene: sin logo, nunca error. */
export function logoPorHuella(huella: string | undefined): Logo | null {
  if (!huella) return null;
  if (esDePrueba() && huella === huellaLogo(LOGO_DE_PRUEBA)) return LOGO_DE_PRUEBA;
  const guardados = leer().m;
  const g = Object.hasOwn(guardados, huella) ? guardados[huella] : undefined;
  if (g) return { t: g.t, b: g.b };
  return enMemoria.get(huella) ?? null;
}

/**
 * El logo de un evento: el de sus sorteos si todos tienen el mismo; si
 * difieren, o a alguno le falta, ninguno. Así un evento nunca lleva el logo de
 * un solo sorteo como si fuera de todos.
 */
export function logoComun(huellas: ReadonlyArray<string | undefined>): Logo | null {
  const primera = huellas[0];
  if (!primera || huellas.some((h) => h !== primera)) return null;
  return logoPorHuella(primera);
}

/**
 * La huella del logo que se sella con el sorteo, o undefined. La demo
 * (`?demo=`) nunca lleva logo, para que los auditores miren lo mismo de
 * siempre; solo `?logo=prueba` lo pone. El ensayo sí lo lleva: es donde quien
 * organiza prueba cómo se ve. Cuenta como uso, para no descartarlo primero.
 */
export function logoParaSellar(): string | undefined {
  if (conDemo() && !esDePrueba()) return undefined;
  const a = logoActual();
  if (!a) return undefined;
  if (!esDePrueba()) {
    const l = leer();
    const g = l.m[a.huella];
    if (g) escribir({ ...l, m: { ...l.m, [a.huella]: { ...g, u: Date.now() } } });
  }
  return a.huella;
}

/* ------------------------------------------------------------- el logo de prueba */

/**
 * `?logo=prueba`: un PNG chico de 128 × 64, solo para auditores y capturas, y
 * también junto con `?demo=`. Nunca viene de un enlace ni de la interfaz.
 */
export const LOGO_DE_PRUEBA: Logo = {
  t: "image/png",
  b: "iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAIAAABdtOgoAAAAx0lEQVR42u3ZvQ2AIBCAUVawYgOnckodwcG01MIQf4KgvC/X0d1rvBgWFS1YAQAAAgBAAAAIAAABACAAAAQAgAAAEIBkseuLDAAAWRumbQAAAAAAwH8A9ss9MwAAAMj+2drSIQYAAAAAAAAAKHqIvbJuAAAAAAAAAAAAAM8B4jzeHgAfBci3IAAAAAC4AZB7AAAAAABALYcYgIou4Y+vvs4AAAAAAAAAAAAAAGgcoEmD63/E0itLvB4+AQAAAAAAAAAAAGgSYAUHYmAQHysXIAAAAABJRU5ErkJggg==",
};

/** Si la dirección pide el logo de prueba. */
export function esDePrueba(): boolean {
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).get("logo") === "prueba";
  } catch {
    return false;
  }
}
