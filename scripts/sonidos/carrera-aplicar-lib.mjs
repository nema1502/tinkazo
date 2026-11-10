/**
 * La lógica de `carrera-aplicar.mjs`, sin tocar el disco: de las elecciones hechas escuchando a `carrera-elegidas.ts`.
 *
 * La página de escucha guarda cada elección en `elecciones.json` como `musica["carrera:<pieza>"] = "a" | "b" | "c" |
 * "hoy" | "ninguno"` (o en `carrera.<pieza>` si el servidor es el nuevo). Acá se traduce:
 *
 * - `a`, `b`, `c` y `hoy` quedan como están.
 * - `ninguno` es "ninguna me convence": en la música y en el final va `base` (lo de hoy con el ritmo nuevo y con el
 *   silencio antes del golpe, que es lo que dice la dirección de la carrera), y en las demás, `hoy`.
 * - Sin elección, la pieza queda como está.
 *
 * Hay una elección más que no es una pieza del show: el bombo y el bajo de la música (`bomboBajo`, o `carrera:bomboBajo`
 * en la página). Es `hoy` (la mezcla para parlante chico solo suena con el arreglo de una candidata) o `chico` (suena
 * también sin candidatas, en la música de los diez juegos). `ninguno` es `hoy`. Se escribe en `BOMBO_Y_BAJO`.
 */

export const PIEZAS = ["musica", "pasos", "echarse", "obstaculos", "final", "festejo"];
/** La elección del bombo y del bajo: no es una pieza, pero se guarda y se aplica igual. */
export const CLAVE_MEZCLA = "bomboBajo";
const VALIDAS = new Set(["hoy", "base", "a", "b", "c"]);
const VALIDAS_MEZCLA = new Set(["hoy", "chico"]);
/** `base` (lo de hoy con el arreglo nuevo) solo existe en la música y en el final: en las demás piezas la carrera no lo lee. */
const USAN_BASE = new Set(["musica", "final"]);
const VALIDAS_SIN_BASE = new Set(["hoy", "a", "b", "c"]);
const validasDe = (pieza) => (pieza === CLAVE_MEZCLA ? VALIDAS_MEZCLA : USAN_BASE.has(pieza) ? VALIDAS : VALIDAS_SIN_BASE);

/**
 * Lo que se eligió para cada pieza, según `elecciones.json`: `{pieza: "a" | "b" | "c" | "hoy" | "ninguno"}` solo de las
 * que eligió, y `bomboBajo: "hoy" | "chico" | "ninguno"` si eligió el bombo y el bajo.
 */
export function eleccionesDeLaPagina(elecciones) {
  const out = {};
  for (const p of [...PIEZAS, CLAVE_MEZCLA]) {
    const v = elecciones?.carrera?.[p] ?? elecciones?.musica?.[`carrera:${p}`];
    if (typeof v === "string" && (validasDe(p).has(v) || v === "ninguno")) out[p] = v;
  }
  return out;
}

/** De la elección de la página al valor de `ELEGIDAS` (o de `BOMBO_Y_BAJO`). */
export function valorDeElegida(pieza, v) {
  if (v === "ninguno") return USAN_BASE.has(pieza) ? "base" : "hoy";
  if (v === "base" && !USAN_BASE.has(pieza)) return "hoy";
  return v;
}

/**
 * Las elecciones que quedan: las que había (`actuales`), cambiadas por las que eligió.
 * Devuelve también qué cambió y qué falta por elegir.
 */
export function aplicarElecciones(actuales, elecciones) {
  const pedidas = eleccionesDeLaPagina(elecciones);
  const nuevas = { ...actuales };
  const cambios = [];
  const faltan = [];
  for (const p of [...PIEZAS, CLAVE_MEZCLA]) {
    if (!(p in pedidas)) {
      faltan.push(p);
      continue;
    }
    const v = valorDeElegida(p, pedidas[p]);
    if (nuevas[p] !== v) cambios.push({ pieza: p, de: nuevas[p] ?? "hoy", a: v, dijo: pedidas[p] });
    nuevas[p] = v;
  }
  return { nuevas, cambios, faltan };
}

/** Las elecciones de hoy, leídas del texto de `carrera-elegidas.ts`. */
export function leerElegidas(texto) {
  const out = {};
  for (const p of PIEZAS) {
    const m = new RegExp(`^\\s*${p}:\\s*"(\\w+)"`, "m").exec(texto);
    if (!m || !validasDe(p).has(m[1])) throw new Error(`no encontré la elección de "${p}" en carrera-elegidas.ts`);
    out[p] = m[1];
  }
  const mezcla = /^export const BOMBO_Y_BAJO[^=]*=\s*"(\w+)"/m.exec(texto);
  if (!mezcla || !VALIDAS_MEZCLA.has(mezcla[1])) throw new Error("no encontré BOMBO_Y_BAJO en carrera-elegidas.ts");
  out[CLAVE_MEZCLA] = mezcla[1];
  return out;
}

/** El texto completo de `carrera-elegidas.ts` con estas elecciones. */
export function textoDeElegidas(elegidas) {
  const filas = PIEZAS.map((p) => `  ${p}: "${elegidas[p] ?? "hoy"}",`).join("\n");
  return `import type { Eleccion, Pieza } from "./carrera";

/**
 * Lo que suena en la carrera, pieza por pieza.
 *
 * Este archivo lo reescribe \`scripts/sonidos/carrera-aplicar.mjs\` con lo que se eligió escuchando en la página de
 * escucha (la que arma \`scripts/sonidos/carrera-armar-escucha.mjs\`). Mientras no se elija, todo es \`hoy\`:
 * el sitio suena exactamente como antes y ningún sonido nuevo se prende sin que alguien lo escuche.
 */
export const ELEGIDAS: Readonly<Record<Pieza, Eleccion>> = {
${filas}
};

/**
 * El bombo y el bajo de la música (\`MEZCLA_GRAVE_PARLANTE_CHICO\` en \`src/music.ts\`): \`hoy\` los deja como suenan en
 * producción y la mezcla para parlante chico solo suena con el arreglo de una candidata de la carrera; \`chico\` los pone
 * así también en la música de los diez juegos. Lo reescribe \`carrera-aplicar.mjs\` con lo que se eligió escuchando.
 */
export const BOMBO_Y_BAJO: "hoy" | "chico" = "${elegidas[CLAVE_MEZCLA] ?? "hoy"}";
`;
}
