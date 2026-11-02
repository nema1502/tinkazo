/**
 * Lo que decide si el prototipo en 3D de la carrera (`?motor=3d`, docs/motores.md) puede correr.
 * Puro, para probarlo: el pedido tiene que estar y nada de lo que lo prohíbe.
 *
 * Se ignora, sin aviso y con la carrera de siempre, cuando no hay WebGL, cuando el navegador pide ahorrar
 * datos (`prefers-reduced-data`, `saveData`), cuando la conexión es lenta (3G o menos) y cuando está
 * prendido el modo para compartir (la pantalla se transmite comprimida y three.js pesa).
 */
export interface Entorno3D {
  motor: string | null;
  webgl: boolean;
  ahorroDeDatos: boolean;
  conexion: string | null;
  compartir: boolean;
}

export function permite3D(e: Entorno3D): boolean {
  if (e.motor !== "3d" || !e.webgl || e.ahorroDeDatos || e.compartir) return false;
  return e.conexion === null || e.conexion === "4g";
}
