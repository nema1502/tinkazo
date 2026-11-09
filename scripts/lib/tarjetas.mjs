/**
 * Las tarjetas de historia de todos los juegos, leídas del texto fuente.
 * Las de los juegos de siempre viven en `src/games/lore.ts` (`juego: [ {q, a, href, src} ]`);
 * las de los juegos del kit, en `src/games/pixi/kit/catalogo.ts` (`id: "juego"` y su `historia`).
 * `check-lore` y la boleta leen con esta misma función.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARJETA = /q:\s*"([^"]+)",\s*\n\s*a:\s*"([^"]+)",\s*\n\s*href:\s*"([^"]+)",\s*\n\s*src:\s*"([^"]+)"/g;

function leer(texto, claveDeJuego) {
  const juegos = [...texto.matchAll(claveDeJuego)].map((m) => ({ at: m.index ?? 0, juego: m[1] }));
  const juegoDe = (at) => juegos.filter((j) => j.at < at).at(-1)?.juego ?? "";
  return [...texto.matchAll(TARJETA)].map((m) => ({ q: m[1], a: m[2], href: m[3], src: m[4], juego: juegoDe(m.index ?? 0) }));
}

/** Todas las tarjetas, a partir del texto de `lore.ts` y, si se da, el de `catalogo.ts` del kit. */
export function tarjetasDeTextos(loreTs, catalogoTs = "") {
  return [...leer(loreTs, /^ {2}(\w+): \[/gm), ...(catalogoTs ? leer(catalogoTs, /^ {4}id: "(\w+)"/gm) : [])];
}

/** Las tarjetas de un juego. */
export function tarjetasDeJuego(loreTs, juego, catalogoTs = "") {
  return tarjetasDeTextos(loreTs, catalogoTs).filter((t) => t.juego === juego);
}

/** Lee las dos fuentes de la raíz del repo y devuelve todas las tarjetas. */
export function tarjetasDelRepo(raiz) {
  const rd = (r) => (existsSync(join(raiz, r)) ? readFileSync(join(raiz, r), "utf8") : "");
  return tarjetasDeTextos(rd("src/games/lore.ts"), rd("src/games/pixi/kit/catalogo.ts"));
}
