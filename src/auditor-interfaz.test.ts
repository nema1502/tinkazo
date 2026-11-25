import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * El auditor de interfaz no se corre acá (pide un navegador). Esta prueba cuida que la comprobación de la línea que
 * tranquiliza bajo Entrar para sellar no se despegue del diccionario: el auditor lee la frase completa, en los dos idiomas,
 * de `src/i18n.ts`, y la compara entera. Si el texto cambia, el auditor ya lo sabe y no da fallas falsas ni deja pasar una
 * frase distinta que empieza igual.
 */
describe("el auditor de interfaz acompaña a la línea de Entrar para sellar", () => {
  const auditor = readFileSync(new URL("../scripts/audit-ui.mjs", import.meta.url), "utf8");
  const ayuda = async (): Promise<{ frasesDeLaLinea: (t: string) => string[]; esLaLinea: (frases: string[], texto: unknown) => boolean }> => {
    const ruta = "../scripts/lib/linea-sellar.mjs";
    return import(/* @vite-ignore */ ruta);
  };
  const fuente = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");

  it("lee las dos frases del diccionario y son las que dice el diccionario", async () => {
    const { frasesDeLaLinea } = await ayuda();
    expect(frasesDeLaLinea(fuente)).toEqual([String(T.es.sellarSinCuenta), String(T.en.sellarSinCuenta)]);
  });

  it("compara la frase completa: una que solo empieza igual no pasa", async () => {
    const { frasesDeLaLinea, esLaLinea } = await ayuda();
    const frases = frasesDeLaLinea(fuente);
    expect(esLaLinea(frases, String(T.es.sellarSinCuenta))).toBe(true);
    expect(esLaLinea(frases, String(T.en.sellarSinCuenta).replace("'", "\u2019"))).toBe(true);
    expect(esLaLinea(frases, "Tu gente no necesita crear cuenta")).toBe(false);
    expect(esLaLinea(frases, "Tu gente no necesita crear cuenta, salvo que quieras otra cosa.")).toBe(false);
    expect(esLaLinea(frases, "Your people don't need an account")).toBe(false);
    expect(esLaLinea(frases, undefined)).toBe(false);
  });

  it("el auditor usa esa ayuda y no un comienzo escrito a mano", () => {
    expect(auditor).toContain('from "./lib/linea-sellar.mjs"');
    expect(auditor).not.toContain("COMIENZO_LINEA_SELLAR");
    expect(auditor).not.toContain("startsWith(c)");
    expect(auditor).toContain("esLaLinea(FRASES_LINEA_SELLAR, f.lineaTexto)");
  });
});
