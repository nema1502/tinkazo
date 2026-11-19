import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CHIP_SCALE, escalaChipLegible, letraMinima, unidadDePantalla } from "./letra";

// Same source-guard boundary as wheel-camera-guard: no WebGL or git history.
const source = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
const expression = source.match(/chip\(textoGanador,\s*(.*?),\s*textoGanador,/)?.[1];

it.each([[320, 521], [320, 600], [1024, 560]])(
  "keeps the complete bridge legible at %ix%i", (w, h) => {
    expect(expression).toBeDefined();
    const k = unidadDePantalla(w, h);
    const scale = Function("u", "escalaChipLegible", `return (${expression})`)(
      () => k, escalaChipLegible,
    );
    const minimum = letraMinima(k);
    // One ULP for floating-point multiplication; not a visual/font allowance.
    expect(12 * CHIP_SCALE * k * scale + Number.EPSILON * minimum).toBeGreaterThanOrEqual(minimum);
  },
);
