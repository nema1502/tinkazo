import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * El auditor de interfaz no se corre acá (pide un navegador). Esta prueba cuida que la comprobación de la línea que
 * tranquiliza bajo Entrar para sellar no se despegue del diccionario: el auditor compara el comienzo de la frase en los
 * dos idiomas, y el diccionario tiene que seguir empezando igual. Si el texto cambia de arranque, falla acá y no con
 * fallas falsas en el auditor.
 */
describe("el auditor de interfaz acompaña a la línea de Entrar para sellar", () => {
  const auditor = readFileSync(new URL("../scripts/audit-ui.mjs", import.meta.url), "utf8");
  const comienzos = /const COMIENZO_LINEA_SELLAR = \{ es: "([^"]+)", en: "([^"]+)" \};/.exec(auditor);

  it("declara el comienzo de la frase en español y en inglés", () => {
    expect(comienzos).not.toBeNull();
  });

  it("el diccionario empieza igual en los dos idiomas", () => {
    expect(String(T.es.sellarSinCuenta).startsWith(comienzos?.[1] ?? "?")).toBe(true);
    expect(String(T.en.sellarSinCuenta).startsWith(comienzos?.[2] ?? "?")).toBe(true);
  });

  it("la comprobación usa ese comienzo y no la frase entera de antes", () => {
    expect(auditor).not.toContain('f.lineaTexto === "Tu gente no necesita crear cuenta."');
    expect(auditor).toContain("lineaTranquiliza(f.lineaTexto)");
  });
});
