/**
 * Lo que decide si el 3D de un juego (docs/motores.md) puede correr y si arranca solo. Puro, para probarlo.
 *
 * Dos preguntas distintas:
 *
 * 1. `permite3D`: ¿este equipo y esta conexión pueden con el 3D? No: sin WebGL, con ahorro de datos (`prefers-reduced-data`,
 *    `saveData`), con conexión de 3G o menos, con el modo para compartir prendido (la pantalla se transmite comprimida y
 *    three.js pesa), y en los equipos más justos: el navegador que dice tener 2 GB de memoria o menos, o 2 núcleos o menos
 *    (`deviceMemory` y `hardwareConcurrency`; los cuadros por segundo se midieron con la CPU frenada cuatro veces, que no
 *    frena la placa de video, así que en lo más básico no se promete). Donde el navegador no lo dice, se confía. Sin esto
 *    no hay 3D ni interruptor: el show es el 2D de siempre, sin aviso.
 * 2. `aptoPorDefecto3D`: ¿el 3D arranca solo, sin que nadie lo pida? Sí en cuanto `permite3D` lo deja, salvo en los juegos
 *    que midieron más pesado: ahí el equipo tiene que tener más de lo mínimo (`UMBRAL_POR_JUEGO`). Si no llega, el show es 2D
 *    pero el interruptor sigue ahí: quien organiza puede prenderlo a mano.
 *
 * `quiere3D` junta el pedido: `?motor=` manda sobre todo (`3d` lo pide; cualquier otro valor, `clasico` o `2d` o `pixi`, es
 * el 2D), después la preferencia guardada (apagado queda apagado) y, si nunca lo tocó, la regla por defecto.
 */
export interface Entorno3D {
  webgl: boolean;
  ahorroDeDatos: boolean;
  conexion: string | null;
  compartir: boolean;
  /** GB de memoria que dice tener el equipo (`navigator.deviceMemory`, solo en Chrome), si lo dice. */
  memoriaGB?: number | null;
  /** Núcleos de CPU (`navigator.hardwareConcurrency`), si lo dice. */
  nucleos?: number | null;
}

export function permite3D(e: Entorno3D): boolean {
  if (!e.webgl || e.ahorroDeDatos || e.compartir) return false;
  if ((e.memoriaGB ?? 99) <= 2 || (e.nucleos ?? 99) <= 2) return false;
  return e.conexion === null || e.conexion === "4g";
}

/** Lo mínimo que tiene que decir tener el equipo para que el 3D de ese juego arranque solo: más núcleos y más GB que estos. */
export interface Umbral3D {
  nucleos: number;
  memoriaGB: number;
}

/**
 * Los juegos cuyo 3D, con la CPU frenada cuatro veces (un celular mediano), no llegó a 30 cuadros por segundo o tuvo un p95 de
 * más de 70 ms: ahí arranca solo recién con más de 4 núcleos y 4 GB. Los que aguantaron no están acá y siguen el mínimo de
 * `permite3D`. (Medido el 4 de noviembre de 2026 con `scripts/medir-3d.mjs`, ver docs/motores.md.)
 */
export const UMBRAL_POR_JUEGO: Readonly<Record<string, Umbral3D>> = {
  // La carrera con 18 personas: 13 a 19 cuadros por segundo en seis y cuatro intentos (el 2D, 38), con 60 apenas 30 a 42.
  race: { nucleos: 4, memoriaGB: 4 },
};

export function aptoPorDefecto3D(e: Entorno3D, juego: string, umbrales: Readonly<Record<string, Umbral3D>> = UMBRAL_POR_JUEGO): boolean {
  if (!permite3D(e)) return false;
  const u = umbrales[juego];
  if (!u) return true;
  return (e.nucleos ?? 99) > u.nucleos && (e.memoriaGB ?? 99) > u.memoriaGB;
}

export interface Pedido3D {
  /** `?motor=` de la dirección, si está. */
  motor: string | null;
  /** La preferencia guardada: `true` lo prendió, `false` lo apagó, `null` nunca lo tocó. */
  guardado: boolean | null;
  /** `aptoPorDefecto3D` de este juego en este equipo. */
  apto: boolean;
}

/** `true` si lo que se pidió (o la regla por defecto) es el 3D. Después hay que sumarle `permite3D` y que el juego lo ofrezca. */
export function quiere3D(p: Pedido3D): boolean {
  if (p.motor) return p.motor === "3d";
  if (p.guardado !== null) return p.guardado;
  return p.apto;
}
