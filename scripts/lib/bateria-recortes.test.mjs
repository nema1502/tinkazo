/**
 * Lo que se sacó de la batería el 25 de octubre de 2026, y que no se vuelva a
 * meter sin querer: la lista de juegos de cada `todos`, pantalla dentro de
 * rigor, y el conteo de corridas contra el que había.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contar, planDe } from "./bateria.mjs";
import { FUERA_DEL_SELECTOR, SELECTOR } from "./juegos.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuente = (f) => readFileSync(join(scripts, f), "utf8");

describe("los auditores que entienden `todos`", () => {
  it("toman los juegos de lib/juegos.mjs, no una lista propia con los que salieron", () => {
    for (const f of ["audit-rigor", "audit-identidad", "audit-emocion", "audit-mezcla", "audit-sound", "audit-pantalla", "audit-delatores"]) {
      const src = fuente(`${f}.mjs`);
      expect(src, f).toMatch(/from "\.\/lib\/juegos\.mjs"/);
      expect(src, f).not.toMatch(/const (TODOS|JUEGOS) = \[/);
      for (const j of FUERA_DEL_SELECTOR) expect(src, `${f} nombra ${j} en una lista`).not.toMatch(new RegExp(`"${j}",\\s*"`));
    }
  });

  it("el trueque, que pantalla se salteaba, está en el selector", () => {
    expect(SELECTOR).toContain("trueque");
  });
});

describe("pantalla dentro de rigor", () => {
  it("rigor carga el auditor de pantalla y cuenta sus comprobaciones en la misma corrida", () => {
    const src = fuente("audit-rigor.mjs");
    expect(src).toMatch(/import\("\.\/audit-pantalla\.mjs"\)/);
    expect(src).toMatch(/comprobacionesDePantalla\(await medirPantalla\(/);
    expect(src).toMatch(/--sin-pantalla/);
  });

  it("pantalla exporta lo que rigor usa y sigue corriendo sola", () => {
    const src = fuente("audit-pantalla.mjs");
    expect(src).toMatch(/export async function medirJuego\(/);
    expect(src).toMatch(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]/);
  });

  it("la batería ya no la corre aparte, pero se puede pedir", () => {
    expect(planDe().map((t) => t.auditor)).not.toContain("audit-pantalla");
    expect(planDe({ solo: ["pantalla"] })).toHaveLength(1);
  });
});

describe("espera y detalles siguen en la batería", () => {
  // El 25 de octubre de 2026 se comparó lo que comprueba cada uno con lo de
  // audit-flujo y audit-ui (docs/juegos.md): ninguna de sus comprobaciones está
  // repetida, así que quitarlos era perder comprobaciones.
  it("están en la batería de siempre", () => {
    const a = planDe().map((t) => t.auditor);
    expect(a).toContain("audit-espera");
    expect(a).toContain("audit-detalles");
  });
});

describe("cuánto se recortó el `todos` (juego × auditor, y arranques de Chrome)", () => {
  // Cuántos juegos miraba cada uno antes: rigor, identidad, emoción, sonido y
  // mezcla, trece (los diez y tres que nadie puede elegir); pantalla, doce
  // (sin El Trueque); audit-game y delatores, los diez.
  const ANTES = { "audit-game": 10, "audit-rigor": 13, "audit-identidad": 13, "audit-pantalla": 12, "audit-delatores": 10, "audit-emocion": 13, "audit-sound": 13, "audit-mezcla": 13 };
  const escenasAntes = (conMezcla) => Object.entries(ANTES).filter(([a]) => conMezcla || a !== "audit-mezcla").reduce((s, [, n]) => s + n, 0);
  const escenasDespues = (plan) => {
    let n = 0;
    for (const t of plan) {
      if (!(t.auditor in ANTES) || t.auditor === "audit-pantalla") continue;
      n += t.objetivo === "todos" ? SELECTOR.length : 1;
      if (t.auditor === "audit-rigor") n += t.objetivo === "todos" ? SELECTOR.length : 1; // el grupo de pantalla
    }
    return n;
  };

  it("de 84 a 70 escenas de juego sin la mezcla, y de 97 a 80 con ella", () => {
    expect(escenasAntes(false)).toBe(84);
    expect(escenasAntes(true)).toBe(97);
    expect(escenasDespues(planDe())).toBe(70);
    expect(escenasDespues(planDe({ noche: true }))).toBe(80);
  });

  it("un arranque de Chrome menos: pantalla ya no tiene el suyo", () => {
    // Antes: 10 de audit-game, 7 de los que miran juegos (rigor, identidad,
    // pantalla, delatores, emoción, sonido; la mezcla de noche) y 10 sueltos.
    expect(contar(planDe()).chromes).toBe(10 + 5 + 10);
    expect(contar(planDe({ noche: true })).chromes).toBe(10 + 6 + 10);
  });
});
