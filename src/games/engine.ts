import { WHEEL_MAX, params, type Game } from "../state";

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

/**
 * Baja el motor y el juego elegido sin arrancarlos.
 *
 * Antes el motor se bajaba recién al tocar "Sortear", con la sala mirando: en
 * un celular con 4G lento eran casi tres segundos de estadio con el lienzo
 * vacío, y siete hasta el primer cuadro. La cuenta regresiva dura treinta
 * segundos o más y la conexión está ociosa; bajándolo ahí, el juego aparece en
 * poco más de un segundo (auditoría del stack, 29 de septiembre de 2026).
 *
 * Se llama al elegir un juego y al empezar la cuenta regresiva. Es solo una
 * descarga: no crea nada, no toca el sorteo, y si falla no pasa nada, porque
 * el sorteo lo vuelve a pedir igual.
 */
const pedidos = new Set<Game>();

export function preloadGame(game: Game, people: number): void {
  if (!usePixi()) return;
  // La misma sustitución que hace draw.ts: con mucha gente la ruleta no entra.
  const g: Game = game === "wheel" && people > WHEEL_MAX ? "ledger" : game;
  if (pedidos.has(g)) return;
  pedidos.add(g);
  import("./pixi").then(
    (m) => m.preloadPixi(g),
    () => pedidos.delete(g),
  ).catch(() => pedidos.delete(g));
}
