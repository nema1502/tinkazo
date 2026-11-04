/**
 * Lo que decide si el prototipo en 3D de la carrera (`?motor=3d`, docs/motores.md) puede correr.
 * Puro, para probarlo: el pedido tiene que estar y nada de lo que lo prohíbe.
 *
 * Se ignora, sin aviso y con la carrera de siempre, cuando no hay WebGL, cuando el navegador pide ahorrar
 * datos (`prefers-reduced-data`, `saveData`), cuando la conexión es lenta (3G o menos) y cuando está
 * prendido el modo para compartir (la pantalla se transmite comprimida y three.js pesa). Y en los equipos más
 * justos: el navegador que dice tener 2 GB de memoria o menos, o 2 núcleos o menos (`deviceMemory` y
 * `hardwareConcurrency`; los cuadros por segundo se midieron con la CPU frenada cuatro veces, que no frena la
 * placa de video, así que en lo más básico no se promete). Donde el navegador no lo dice, se confía.
 */
export interface Entorno3D {
  motor: string | null;
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
  if (e.motor !== "3d" || !e.webgl || e.ahorroDeDatos || e.compartir) return false;
  if ((e.memoriaGB ?? 99) <= 2 || (e.nucleos ?? 99) <= 2) return false;
  return e.conexion === null || e.conexion === "4g";
}
