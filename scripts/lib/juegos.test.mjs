import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FUERA_CON_GOLPE, FUERA_DEL_SELECTOR, SELECTOR, juegosDe, juegosDelKit } from "./juegos.mjs";
import { aplicar } from "./nuevo-juego.mjs";

describe("los juegos del kit, para los auditores", () => {
  it("salen del catálogo: De pie, el primero que migró, está", () => {
    const ids = juegosDelKit();
    expect(ids).toContain("quien");
    for (const id of ids) expect(id).toMatch(/^[a-z]{3,12}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("un juego recién generado entra sin tocar la lista", () => {
    const raiz = mkdtempSync(join(tmpdir(), "juegos-kit-"));
    try {
      mkdirSync(join(raiz, "src/games/pixi/kit"), { recursive: true });
      writeFileSync(join(raiz, "src/games/pixi/kit/catalogo.ts"), "export const CATALOGO = [\n  // >>> kit:catalogo (x)\n  // <<< kit:catalogo\n] as const;\n");
      writeFileSync(join(raiz, "src/i18n.ts"), "export const T = {\n  es: {\n    // >>> kit:i18n-es (x)\n    // <<< kit:i18n-es\n  },\n  en: {\n    // >>> kit:i18n-en (x)\n    // <<< kit:i18n-en\n  },\n};\n");
      expect(juegosDelKit(pathToFileURL(raiz + "/"))).toEqual([]);
      aplicar({ raiz, id: "prueba" });
      aplicar({ raiz, id: "guajojo" });
      expect(juegosDelKit(pathToFileURL(raiz + "/"))).toEqual(["prueba", "guajojo"]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("los del selector y los que salieron no se pisan, y 'todos' son los ocho del selector", () => {
    expect(SELECTOR).toHaveLength(8);
    for (const j of FUERA_DEL_SELECTOR) expect(SELECTOR).not.toContain(j);
    for (const j of FUERA_CON_GOLPE) expect(FUERA_DEL_SELECTOR).toContain(j);
    expect(juegosDe("todos")).toEqual(SELECTOR);
    expect(juegosDe("quien, sapo")).toEqual(["quien", "sapo"]);
  });
});
