import { params } from "../state";

/**
 * Qué motor dibuja los juegos.
 *
 * Desde el 28 de septiembre de 2026 es el nuevo, PixiJS con el director de
 * cámara (docs/motores.md). El de siempre queda de respaldo: se usa con
 * `?motor=clasico` y cuando el equipo no tiene WebGL, que el motor nuevo
 * necesita. Si WebGL está pero el motor nuevo no arranca igual, o no se
 * alcanza a descargar, `draw.ts` también cae al de siempre: el sorteo nunca
 * se queda sin show.
 */
export function usePixi(): boolean {
  if (params.get("motor") === "clasico") return false;
  return hasWebGL();
}

let webgl: boolean | null = null;

function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    webgl = !!gl;
    // Un contexto de prueba no tiene que ocupar un lugar: los navegadores
    // aguantan pocos a la vez.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}
