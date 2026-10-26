import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La frontera del kit.
 *
 * El kit se diseña para publicarse después como paquete aparte: un equipo en una
 * hackatón hace su propio juego sobre Tinkazo. Para eso, nada de `kit/` puede
 * depender de textos, rutas ni estado internos de tinkazo.app, salvo por un
 * puerto: `anfitrion.ts` (y `catalogo.ts`, que es la entrada del sitio para cada
 * juego). Esta prueba lee los imports y falla si otro archivo se cuela.
 */
const DIR = new URL("./", import.meta.url);
const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** Lo de afuera que el núcleo puede usar: puro, sin DOM y sin nada del sitio. */
const PERMITIDOS = new Set(["../../drama", "../encuadre", "../foco", "../foco-vista", "../zoom-emocion", "../../emblemas", "../../nombres"]);
/** Los dos archivos que sí conocen al sitio. */
const PUERTOS = new Set(["anfitrion.ts", "catalogo.ts"]);

function importsDe(archivo: string): { spec: string; soloTipo: boolean }[] {
  const src = readFileSync(new URL(archivo, DIR), "utf8");
  const out: { spec: string; soloTipo: boolean }[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm)) {
    out.push({ spec: m[2] as string, soloTipo: !!m[1] });
  }
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1] as string, soloTipo: false });
  return out;
}

describe("la frontera del kit", () => {
  it("hay archivos que mirar", () => {
    expect(ARCHIVOS).toEqual(expect.arrayContaining(["tipos.ts", "guion.ts", "nombres.ts", "figuras.ts", "sonido.ts", "director.ts", "crear.ts", "anfitrion.ts", "catalogo.ts"]));
  });

  for (const archivo of ARCHIVOS.filter((f) => !PUERTOS.has(f))) {
    it(`${archivo} no importa nada del sitio`, () => {
      const malos = importsDe(archivo).filter(({ spec }) => {
        if (spec.startsWith("./")) return false;
        if (!spec.startsWith(".")) return spec !== "pixi.js";
        return !PERMITIDOS.has(spec);
      });
      expect(malos.map((x) => x.spec)).toEqual([]);
    });
  }

  it("solo anfitrion.ts importa el estado, los textos y el audio del sitio", () => {
    const delSitio = ARCHIVOS.filter((f) => importsDe(f).some(({ spec }) => /(?:^|\/)(?:i18n|state|sound|music|dom|avatar|vibrar|main)$/.test(spec) || /\/ui\//.test(spec)));
    expect(delSitio).toEqual(["anfitrion.ts"]);
  });

  it("el núcleo puro no carga PixiJS en tiempo de ejecución", () => {
    const puros = ["azar.ts", "guion.ts", "nombres.ts", "figuras.ts", "sonido.ts", "director.ts", "leyenda.ts", "marcador.ts", "respuestas.ts"];
    for (const f of puros) expect(importsDe(f).filter((x) => x.spec === "pixi.js" && !x.soloTipo), f).toEqual([]);
  });

  it("el catálogo solo carga los juegos de forma perezosa", () => {
    const src = readFileSync(new URL("catalogo.ts", DIR), "utf8");
    expect(src).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+["']\.\.\//m);
  });
});
