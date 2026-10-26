import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RAIZ, aplicar, archivosDe, bloqueCatalogo, bloqueI18n, capital, encender, insertarEntreMarcas, problemasDeId, rellenar, variables } from "./nuevo-juego.mjs";

const temporales = [];
afterEach(() => {
  for (const d of temporales.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CATALOGO = "src/games/pixi/kit/catalogo.ts";
const I18N = "src/i18n.ts";

/** Una copia mínima del repositorio: solo los dos archivos que el generador edita, con sus marcas. */
function raizDePrueba(eol = "\n") {
  const raiz = mkdtempSync(join(tmpdir(), "nuevo-juego-"));
  temporales.push(raiz);
  mkdirSync(join(raiz, "src/games/pixi/kit"), { recursive: true });
  writeFileSync(join(raiz, CATALOGO), ["export const CATALOGO = [", "  // >>> kit:catalogo (x)", "  // <<< kit:catalogo", "] as const;", ""].join(eol));
  writeFileSync(
    join(raiz, I18N),
    ["export const T = {", "  es: {", '    a: "a",', "    // >>> kit:i18n-es (x)", "    // <<< kit:i18n-es", "  },", "  en: {", '    a: "a",', "    // >>> kit:i18n-en (x)", "    // <<< kit:i18n-en", "  },", "};", ""].join(eol),
  );
  return raiz;
}
const leer = (raiz, ruta) => readFileSync(join(raiz, ruta), "utf8");
const veces = (texto, que) => texto.split(que).length - 1;

describe("nuevo-juego: el id", () => {
  it("son de tres a doce letras minúsculas", () => {
    for (const bueno of ["prueba", "abc", "abcdefghijkl", "guajojo"]) expect(problemasDeId(bueno)).toEqual([]);
    for (const malo of ["Prueba", "ab", "abcdefghijklm", "con-guion", "con_guion", "1234", "ñandú", "", undefined, "a b"]) {
      expect(problemasDeId(malo).length, String(malo)).toBeGreaterThan(0);
    }
  });

  it("rechaza los ids que el sitio ya usa", () => {
    for (const usado of ["quien", "race", "sapo", "tombola", "stellar", "wheel", "oruro", "trueque"]) {
      expect(problemasDeId(usado).join(" "), usado).toContain("ya es un juego del sitio");
    }
  });

  it("la capital sale del id", () => {
    expect(capital("prueba")).toBe("Prueba");
    expect(variables("guajojo", "El Guajojó")).toEqual({ id: "guajojo", cap: "Guajojo", nombre: "El Guajojó", nombreEn: "El Guajojó" });
    expect(variables("guajojo").nombre).toBe("Guajojo");
    expect(variables("guajojo", "El Guajojó", "The Guajojó").nombreEn).toBe("The Guajojó");
  });
});

describe("nuevo-juego: las plantillas", () => {
  it("rellenan las cuatro variables y no dejan ninguna sin rellenar", () => {
    const v = variables("prueba", "La Prueba", "The Test");
    expect(rellenar("__ID__ __CAP__ __NOMBRE__ __NOMBRE_EN__", v)).toBe("prueba Prueba La Prueba The Test");
  });

  it("el bloque del catálogo nace apagado, con la historia en borrador", () => {
    const b = bloqueCatalogo(variables("prueba")).join("\n");
    expect(b).toContain('id: "prueba"');
    expect(b).toContain("selector: false");
    expect(b).toContain("borrador: true");
    expect(b).toContain('import("../prueba")');
  });

  it("los bloques de i18n traen las mismas claves en español y en inglés, con textos distintos", () => {
    const v = variables("prueba");
    const clave = (l) => [...l.matchAll(/([A-Za-z]+): "/g)].map((m) => m[1]);
    const es = bloqueI18n(v, "es");
    const en = bloqueI18n(v, "en");
    expect(es.flatMap(clave)).toEqual(en.flatMap(clave));
    expect(es.flatMap(clave)).toEqual(["gamePrueba", "jgPruebaN", "jgPruebaB", "gcPrueba", "gcPruebaMany", "lorePruebaQ", "lorePruebaA"]);
    expect(es.join("")).not.toBe(en.join(""));
  });
});

describe("nuevo-juego: aplicar", () => {
  it("en seco calcula todo y no escribe nada", () => {
    const raiz = raizDePrueba();
    const antes = [leer(raiz, CATALOGO), leer(raiz, I18N)];
    const r = aplicar({ raiz, id: "prueba", dryRun: true });
    expect(r.creados).toEqual(archivosDe(variables("prueba")).map((a) => a.ruta));
    expect([leer(raiz, CATALOGO), leer(raiz, I18N)]).toEqual(antes);
    for (const f of r.creados) expect(existsSync(join(raiz, f))).toBe(false);
  });

  it("crea los cinco archivos, sin variables sin rellenar y con el nombre del juego", () => {
    const raiz = raizDePrueba();
    const r = aplicar({ raiz, id: "prueba", nombre: "La Prueba", nombreEn: "The Test" });
    expect(r.creados).toHaveLength(5);
    for (const f of r.creados) {
      const t = leer(raiz, f);
      expect(t, f).not.toMatch(/__[A-Z_]+__/);
      expect(t.length, f).toBeGreaterThan(200);
    }
    expect(leer(raiz, "src/games/pixi/prueba.ts")).toContain("export const pruebaPixi = crearJuego");
    expect(leer(raiz, "src/games/pixi/prueba-plan.ts")).toContain("export function planPrueba(");
    expect(leer(raiz, "docs/juegos/prueba.md")).toContain("# La Prueba");
    expect(leer(raiz, "docs/juegos/prueba.md")).toContain("La ficha del niño");
  });

  it("deja puestos los ganchos de la regla del niño: sentido, marcador, respuestas, hecho y meta", () => {
    const raiz = raizDePrueba();
    aplicar({ raiz, id: "prueba" });
    const plan = leer(raiz, "src/games/pixi/prueba-plan.ts");
    for (const gancho of ["sentido:", "marcador,", "respuestas,", "hecho:", "meta:", "problemasDe"]) {
      expect(plan + leer(raiz, "src/games/pixi/prueba-plan.test.ts"), gancho).toContain(gancho);
    }
    const prueba = leer(raiz, "src/games/pixi/prueba-plan.test.ts");
    for (const regla of ["problemasDeMarcador", "problemasDeRespuestas", "nino: true"]) expect(prueba, regla).toContain(regla);
    // El relator del generador cumple la regla: sin números.
    expect(leer(raiz, "src/games/pixi/prueba-textos.ts")).not.toMatch(/\$\{|\d/);
  });

  it("suma el juego una vez al catálogo y una vez a cada diccionario, entre las marcas", () => {
    const raiz = raizDePrueba();
    aplicar({ raiz, id: "prueba", nombre: "La Prueba", nombreEn: "The Test" });
    const cat = leer(raiz, CATALOGO);
    const i18n = leer(raiz, I18N);
    expect(veces(cat, 'id: "prueba"')).toBe(1);
    expect(cat.indexOf("// >>> kit:catalogo")).toBeLessThan(cat.indexOf('id: "prueba"'));
    expect(cat.indexOf('id: "prueba"')).toBeLessThan(cat.indexOf("// <<< kit:catalogo"));
    expect(veces(i18n, 'gamePrueba: "La Prueba"')).toBe(1);
    expect(veces(i18n, 'gamePrueba: "The Test"')).toBe(1);
    // La clave de `data-i` del botón aparece dos veces, una por idioma: lo que mira audit-game.
    expect(veces(i18n, "gamePrueba:")).toBe(2);
    expect(i18n.indexOf('gamePrueba: "La Prueba"')).toBeLessThan(i18n.indexOf("<<< kit:i18n-es"));
    expect(i18n.indexOf('gamePrueba: "The Test"')).toBeGreaterThan(i18n.indexOf(">>> kit:i18n-en"));
  });

  it("dos corridas con el mismo id no duplican nada: la segunda se rechaza y no toca nada", () => {
    const raiz = raizDePrueba();
    aplicar({ raiz, id: "prueba" });
    const despues = [leer(raiz, CATALOGO), leer(raiz, I18N)];
    expect(() => aplicar({ raiz, id: "prueba" })).toThrow(/ya está en el catálogo|ya existe/);
    expect([leer(raiz, CATALOGO), leer(raiz, I18N)]).toEqual(despues);
  });

  it("dos juegos distintos conviven entre las mismas marcas", () => {
    const raiz = raizDePrueba();
    aplicar({ raiz, id: "prueba" });
    aplicar({ raiz, id: "guajojo", nombre: "El Guajojó" });
    expect(veces(leer(raiz, CATALOGO), "selector: false")).toBe(2);
    expect(leer(raiz, I18N)).toContain('gameGuajojo: "El Guajojó"');
    // Un id que es prefijo de otro no se confunde con él.
    expect(() => aplicar({ raiz, id: "guajo" })).not.toThrow();
  });

  it("respeta los saltos de línea del archivo (CRLF)", () => {
    const raiz = raizDePrueba("\r\n");
    aplicar({ raiz, id: "prueba" });
    for (const f of [CATALOGO, I18N]) {
      const t = leer(raiz, f);
      expect(t.replace(/\r\n/g, "")).not.toContain("\n");
    }
  });

  it("si faltan las marcas, no queda nada a medias", () => {
    const raiz = raizDePrueba();
    writeFileSync(join(raiz, I18N), "export const T = { es: {}, en: {} };\n");
    expect(() => aplicar({ raiz, id: "prueba" })).toThrow(/faltan las marcas/);
    expect(existsSync(join(raiz, "src/games/pixi/prueba.ts"))).toBe(false);
    expect(leer(raiz, CATALOGO)).not.toContain('id: "prueba"');
  });

  it("insertarEntreMarcas respeta la sangría de la marca", () => {
    const t = insertarEntreMarcas("a\n    // >>> kit:x\n    // <<< kit:x\nb\n", "x", "j", ["// --- j", "  uno", "// --- /j"]);
    expect(t).toBe("a\n    // >>> kit:x\n    // --- j\n      uno\n    // --- /j\n    // <<< kit:x\nb\n");
  });

  it("las marcas están en el repositorio de verdad: un juego nuevo entra sin tocar nada a mano", () => {
    const r = aplicar({ raiz: RAIZ, id: "ejemplo", dryRun: true });
    expect(r.editados).toEqual([CATALOGO, I18N]);
    expect(existsSync(join(RAIZ, "src/games/pixi/ejemplo.ts"))).toBe(false);
  });
});

describe("nuevo-juego: encender", () => {
  /** Un juego completo: con captura, historia sin borrador y batería guardada. */
  function juegoListo() {
    const raiz = raizDePrueba();
    aplicar({ raiz, id: "prueba" });
    mkdirSync(join(raiz, "public/juegos"), { recursive: true });
    writeFileSync(join(raiz, "public/juegos/prueba.webp"), "x");
    mkdirSync(join(raiz, "docs/capturas/auditorias"), { recursive: true });
    writeFileSync(join(raiz, "docs/capturas/auditorias/2026-10-26.json"), JSON.stringify({ auditor: "audit-game", objetivo: "prueba", aprobadas: 20, total: 20, fallas: [] }));
    writeFileSync(join(raiz, CATALOGO), leer(raiz, CATALOGO).replace("borrador: true", "borrador: false"));
    return raiz;
  }

  it("un juego recién nacido no se puede encender, y dice qué le falta", () => {
    const raiz = raizDePrueba();
    aplicar({ raiz, id: "prueba" });
    try {
      encender({ raiz, id: "prueba" });
      throw new Error("tendría que haber fallado");
    } catch (e) {
      expect(e.message).toContain("captura");
      expect(e.message).toContain("borrador");
      expect(e.message).toContain("batería");
    }
    expect(leer(raiz, CATALOGO)).toContain("selector: false");
  });

  it("con todo en orden lo enciende: selector y captura en true", () => {
    const raiz = juegoListo();
    const r = encender({ raiz, id: "prueba" });
    const cat = leer(raiz, CATALOGO);
    expect(cat).toContain("selector: true");
    expect(cat).toContain("captura: true");
    expect(cat).not.toContain("selector: false");
    expect(r.siguientes.join(" ")).toContain("juegos.html");
    expect(() => encender({ raiz, id: "prueba" })).toThrow(/ya está encendido/);
  });

  it("en seco no escribe, y un id que no existe se rechaza", () => {
    const raiz = juegoListo();
    encender({ raiz, id: "prueba", dryRun: true });
    expect(leer(raiz, CATALOGO)).toContain("selector: false");
    expect(() => encender({ raiz, id: "otro" })).toThrow(/no está en el catálogo/);
  });
});
