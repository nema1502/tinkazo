import { paraCompartir, params, playableGame, ver3DGuardado, type Game } from "../state";
import { aptoPorDefecto3D, permite3D, quiere3D, type Entorno3D } from "./permite3d";
import { ofrece3D } from "./tres/ofrecidos";

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

/**
 * `true` si hay que dibujar este juego en 3D en este equipo. Desde el 4 de noviembre de 2026 es lo que la sala ve por
 * defecto en los juegos que ganaron la comparación a ciegas (`JUEGOS_CON_3D`): se apaga con el interruptor del selector
 * (queda guardado en este navegador), con `?motor=clasico` (o `2d`, o `pixi`), y no corre donde `permite3D` no lo deja.
 * `?motor=3d` lo pide en cualquier juego que tenga versión, esté o no en la lista. La regla vive en `quiere3D`
 * (`permite3d.ts`), que se prueba sola.
 */
export function usa3D(juego: Game): boolean {
  const motor = params.get("motor");
  if (motor === "3d") return puede3D();
  if (!ofrece3D(juego)) return false;
  return quiere3D({ motor, guardado: ver3DGuardado(), apto: aptoPorDefecto3D(entorno3D(), juego) }) && puede3D();
}

/** `true` si este equipo y esta conexión aguantan el 3D: lo que decide si el selector ofrece el interruptor. */
export function puede3D(): boolean {
  return permite3D(entorno3D());
}

function entorno3D(): Entorno3D {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  let reducido = false;
  try {
    reducido = matchMedia("(prefers-reduced-data: reduce)").matches;
  } catch {
    reducido = false;
  }
  return {
    webgl: hasWebGL(),
    ahorroDeDatos: reducido || nav.connection?.saveData === true,
    conexion: nav.connection?.effectiveType ?? null,
    compartir: paraCompartir(),
    memoriaGB: nav.deviceMemory ?? null,
    nucleos: nav.hardwareConcurrency ?? null,
  };
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
  const g: Game = playableGame(game, people);
  if (pedidos.has(g)) return;
  pedidos.add(g);
  import("./pixi").then(
    (m) => m.preloadPixi(g),
    () => pedidos.delete(g),
  ).catch(() => pedidos.delete(g));
}
