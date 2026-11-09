import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * Las páginas que no son la herramienta reciben al construir solo los textos
 * de sus `data-i*` (ver `textosPorPagina` en vite.config.ts). Una clave del
 * markup que no es una cadena en los dos idiomas se queda con el texto del
 * HTML, en español, también en inglés: mejor que falle acá.
 */
describe("textos de las páginas", () => {
  const paginas = readdirSync(".").filter((f) => f.endsWith(".html"));

  it("hay páginas que revisar", () => {
    expect(paginas.length).toBeGreaterThan(5);
  });

  it("cada clave del markup es una cadena en español y en inglés", () => {
    const faltan = paginas.flatMap((p) =>
      [...readFileSync(p, "utf8").matchAll(/\bdata-(?:i|i-html|i-ph|i-title|i-aria|label-i)="([^"]+)"/g)]
        .map((m) => m[1] as string)
        .filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string")
        .map((k) => `${p}: ${k}`),
    );
    expect(faltan).toEqual([]);
  });
});

/**
 * La página de verificación y los textos de turnos y de participaciones.
 *
 * Esa página no carga el diccionario entero: las claves las junta el armado
 * (`textosPorPagina` en vite.config.ts) de los literales del código, y si una
 * dejara de juntarse, quien abriera un comprobante de turnos o de un reparto
 * vería la clave cruda («turnsMsgCab», «vCuentaPart») sin que nada falle. Esta
 * prueba arma la página como el armado y exige las claves que esos dos caminos
 * leen: la lista y su copia, lo que se comprobó, el mensaje para el grupo y la
 * foto. La lista de claves exigidas se escribe a mano, leyendo `verify.ts` y
 * lo que importa, y cada una tiene que seguir entre las que el armado junta:
 * si una deja de juntarse, esta prueba falla.
 */
describe("la página de verificación trae las claves de turnos y de participaciones", () => {
  /** Resuelve un import relativo a un archivo del proyecto, o null si no existe (lo mismo que el plugin). */
  const resolver = (desde: string, spec: string): string | null => {
    const base = resolve(dirname(desde), spec);
    for (const f of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      if (existsSync(f) && statSync(f).isFile()) return f;
    }
    return null;
  };

  /** La entrada y todo lo que importa de forma estática, sin src/i18n.ts (lo mismo que el plugin). */
  const alcanzables = (entrada: string): string[] => {
    const vistos = new Set<string>();
    const pendientes = [entrada];
    while (pendientes.length) {
      const f = pendientes.pop() as string;
      if (vistos.has(f) || f === resolve("src/i18n.ts") || !f.endsWith(".ts")) continue;
      vistos.add(f);
      for (const m of readFileSync(f, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gm)) {
        const r = resolver(f, m[1] as string);
        if (r) pendientes.push(r);
      }
    }
    return [...vistos];
  };

  /** Las claves que el armado le pone a una página: las de su markup y las de los literales de su código. */
  const clavesDeLaPagina = (pagina: string): Set<string> => {
    const fuente = readFileSync(pagina, "utf8");
    const entradas = [...fuente.matchAll(/<script[^>]*\bsrc="\/(src\/[^"]+\.ts)"/g)].map((m) => resolve(m[1] as string));
    const esClave = (k: string): boolean => typeof T.es[k] === "string" && typeof T.en[k] === "string";
    const claves = new Set<string>();
    for (const m of fuente.matchAll(/\bdata-(?:i|i-html|i-ph|i-title|i-aria|i-alt|label-i|titulo-clave|desc-clave)="([^"]+)"/g)) {
      if (esClave(m[1] as string)) claves.add(m[1] as string);
    }
    for (const archivo of entradas.flatMap(alcanzables)) {
      for (const m of readFileSync(archivo, "utf8").matchAll(/(["'`])([A-Za-z][A-Za-z0-9]*)\1/g)) {
        if (esClave(m[2] as string)) claves.add(m[2] as string);
      }
    }
    return claves;
  };

  it("las que usan sus caminos de turnos y de participaciones están todas, y no arrastra el diccionario entero", () => {
    const trae = clavesDeLaPagina("verificar.html");
    // La lista de turnos y su copia (lista-de-turnos.ts), el encabezado y «El orden recomputado» (verify.ts).
    const usa = ["turnsWord", "turnsResultTitle", "turnsCopy", "copied", "vCheckOrden"];
    // El mensaje para el grupo, con y sin sello (modos/mensajes.ts, por compartir.ts).
    usa.push("turnsMsgCab", "turnsPie", "cmpVerificarUno", "cmpPie", "redSinSelloEtiqueta", "cmpVerSinSello");
    // La foto del orden (compartir.ts).
    usa.push("turnsOption", "turnsFotoLinea", "turnsFotoLineaPart", "cmpFotoAlt");
    // La lista con participaciones: la cuenta de arriba y cuántas tiene cada persona (verify.ts).
    usa.push("kEntries", "vCuentaPart", "vEntriesDe");
    // El mensaje para el grupo de un reparto: la cabeza dice las dos cuentas (compartir.ts).
    usa.push("cmpCabPremioUnoPart", "cmpCabPremioVariosPart", "cmpCabUnoPart", "cmpCabVariosPart");
    // La foto de un reparto: también dice las dos cuentas (compartir.ts).
    usa.push("fotoEntreUnoPart", "fotoEntreVariosPart");
    const faltan = usa.filter((k) => !trae.has(k));
    expect(faltan, `verificar.html se arma sin claves de turnos o de participaciones: ${faltan.join(", ")}`).toEqual([]);
    // La ayuda de la opción es de la herramienta: si esta imitación arrastrara el diccionario entero, no probaría nada.
    expect(trae.has("turnsHelp")).toBe(false);
  });
});
