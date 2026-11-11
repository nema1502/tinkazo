// Prueba que la alerta del fondo del portero, en .github/workflows/vigilar-red.yml, corra
// aunque falle un paso anterior. El recordatorio diario falla a propósito (una red en naranja
// o la línea base vieja) y, sin `always()`, GitHub saltea los pasos que siguen: la alerta del
// fondo no correría justo el día del recordatorio. Vale con el paso comentado, como está hasta
// que exista el portero, y el día que se descomente.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aqui = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(aqui, "..", "..", ".github", "workflows", "vigilar-red.yml");
const NOMBRE = "Fondo del portero de patrocinio";

/** Un renglón sin el `#` de comentario de adelante (si lo tiene), con su sangría. */
const sinComentario = (renglon) => renglon.replace(/^(\s*)#\s?/, "$1");

/**
 * Los renglones del paso con ese nombre, comentado o no: desde su `- name:` hasta el
 * próximo paso o hasta lo que ya no le pertenece (menos sangría que sus claves).
 */
function renglonesDelPaso(texto, nombre) {
  const renglones = texto.split(/\r?\n/).map(sinComentario);
  const inicio = renglones.findIndex((r) => {
    const m = r.match(/^\s*-\s*name:\s*(.+?)\s*$/);
    return m && m[1].replace(/^["']|["']$/g, "") === nombre;
  });
  if (inicio < 0) return null;
  const sangria = renglones[inicio].indexOf("-") + 2;
  const paso = [renglones[inicio]];
  for (const r of renglones.slice(inicio + 1)) {
    if (r.trim() === "") continue;
    const propia = r.length - r.trimStart().length;
    if (propia < sangria) break;
    paso.push(r);
  }
  return paso;
}

/** La condición del paso, sin `${{ }}`, o null si no tiene. */
function condicionDelPaso(texto, nombre) {
  const paso = renglonesDelPaso(texto, nombre);
  if (!paso) return null;
  const linea = paso.find((r) => /^\s*if:/.test(r));
  if (!linea) return null;
  return linea
    .replace(/^\s*if:\s*/, "")
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}\s*$/, "")
    .trim();
}

describe("vigilar-red.yml: la alerta del fondo del portero", () => {
  const texto = readFileSync(WORKFLOW, "utf8");

  it("el paso está una sola vez", () => {
    const veces = texto.split(/\r?\n/).filter((r) => r.includes(`name: ${NOMBRE}`)).length;
    expect(veces).toBe(1);
  });

  it("su condición empieza con always() &&, para correr aunque falle el recordatorio diario", () => {
    const condicion = condicionDelPaso(texto, NOMBRE);
    expect(condicion, "el paso no tiene if:").not.toBeNull();
    expect(condicion).toMatch(/^always\(\)\s*&&\s*/);
  });

  it("sigue siendo una vez al día: con el recordatorio de las 12:07 o a mano con diario", () => {
    const condicion = condicionDelPaso(texto, NOMBRE);
    const resto = condicion.replace(/^always\(\)\s*&&\s*/, "");
    expect(resto).toMatch(/^\(.*\)$/);
    expect(resto).toContain("github.event.schedule == '7 12 * * *'");
    expect(resto).toContain("inputs.diario");
  });
});

describe("condicionDelPaso", () => {
  const paso = (prefijo, condicion) =>
    [
      "    steps:",
      `${prefijo}  - name: Otro`,
      `${prefijo}    if: always()`,
      `${prefijo}  - name: ${NOMBRE}`,
      `${prefijo}    if: ${condicion}`,
      `${prefijo}    run: echo hola`,
      "      - name: Latido",
      "        if: always()",
    ].join("\r\n");

  it("lee la condición del paso comentado y del descomentado", () => {
    const cond = "${{ always() && (github.event.schedule == '7 12 * * *' || inputs.diario) }}";
    const esperado = "always() && (github.event.schedule == '7 12 * * *' || inputs.diario)";
    expect(condicionDelPaso(paso("    ", cond), NOMBRE)).toBe(esperado);
    expect(condicionDelPaso(paso("    # ", cond), NOMBRE)).toBe(esperado);
  });

  it("no toma la condición de otro paso", () => {
    const sinIf = ["      - name: " + NOMBRE, "        run: echo", "      - name: Latido", "        if: always()"].join("\n");
    expect(condicionDelPaso(sinIf, NOMBRE)).toBeNull();
  });

  it("sin always() la condición no pasa la regla", () => {
    const cond = "${{ github.event.schedule == '7 12 * * *' || inputs.diario }}";
    expect(condicionDelPaso(paso("    # ", cond), NOMBRE)).not.toMatch(/^always\(\)\s*&&/);
  });
});

describe("vigilar-red.yml: el portero de mainnet", () => {
  const texto = readFileSync(WORKFLOW, "utf8");
  const PASO = "Portero de mainnet";
  const crudo = texto.split(/\r?\n/);

  it("el paso está una sola vez, y prendido (no comentado)", () => {
    const veces = crudo.filter((r) => r.includes(`name: ${PASO}`));
    expect(veces).toHaveLength(1);
    expect(veces[0]).toMatch(/^\s*-\s*name:/);
  });

  it("corre una vez al día aunque falle el recordatorio: always() && (las 12:07 o a mano con diario)", () => {
    const condicion = condicionDelPaso(texto, PASO);
    expect(condicion).toMatch(/^always\(\)\s*&&\s*\(.*\)$/);
    expect(condicion).toContain("github.event.schedule == '7 12 * * *'");
    expect(condicion).toContain("inputs.diario");
  });

  it("la clave va por env desde los secretos, nunca adentro del comando, y mira pm.tinkazo.app con la revisión del repositorio", () => {
    const paso = renglonesDelPaso(texto, PASO).join("\n");
    expect(paso).toMatch(/PORTERO_ADMIN_TOKEN:\s*\$\{\{\s*secrets\.PORTERO_MAINNET_ADMIN_TOKEN\s*\}\}/);
    expect(paso).toContain("https://pm.tinkazo.app");
    const run = paso.slice(paso.indexOf("run:"));
    expect(run).not.toContain("${{");
    expect(run).toContain("/v1/patrocinio/estado");
    expect(run).toContain("node scripts/lib/vigilar-portero.mjs");
  });

  it("sin el secreto no falla: hasta que exista el despliegue, avisa y sale con 0", () => {
    const run = renglonesDelPaso(texto, PASO).join("\n");
    expect(run).toMatch(/if \[ -z "\$PORTERO_ADMIN_TOKEN" \]; then[\s\S]*exit 0/);
  });
});
