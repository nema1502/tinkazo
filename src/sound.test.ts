// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ContextoFalso } from "./sonidos/audio-falso";
import { reanudarSiHaceFalta } from "./sound";

/**
 * El núcleo que no se corta: el iPhone nombra `interrupted` a su estado de contexto cortado (una llamada,
 * el ahorro de batería), y `src/sound.ts` solo reanudaba `suspended`: después de una interrupción el sorteo
 * entero corría mudo y nada lo volvía a prender. Acá se prueba la reanudación desde los dos estados y el camino
 * de la pestaña que vuelve a la vista; el enganche con `chain()` y el listener de `visibilitychange` se mira en el
 * código, como el resto de la costura interna de sound.ts.
 */

describe("reanudarSiHaceFalta", () => {
  it("un contexto suspendido se reanuda, como siempre", () => {
    const ctx = new ContextoFalso();
    ctx.state = "suspended";
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(ctx.state).toBe("running");
  });

  it("un contexto interrumpido (iPhone) también: acá estaba el hueco", () => {
    const ctx = new ContextoFalso();
    ctx.state = "interrupted";
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(ctx.state).toBe("running");
  });

  it("un contexto que ya está andando no se toca", () => {
    const ctx = new ContextoFalso();
    ctx.state = "running";
    const resume = vi.spyOn(ctx, "resume");
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(resume).not.toHaveBeenCalled();
  });

  it("un contexto cerrado no se reanuda (lanzaría o quedaría en nada)", () => {
    const ctx = new ContextoFalso();
    ctx.state = "closed";
    const resume = vi.spyOn(ctx, "resume");
    reanudarSiHaceFalta(ctx as unknown as AudioContext);
    expect(resume).not.toHaveBeenCalled();
  });
});

describe("sound.ts usa la reanudación en los dos caminos", () => {
  // En jsdom `import.meta.url` no es un archivo: la ruta sale desde la raíz del trabajo.
  const src = readFileSync(resolve(process.cwd(), "src/sound.ts"), "utf8");

  it("chain() reanuda con la nueva regla, no con una comparación solitaria de suspended", () => {
    expect(src).toContain("export function reanudarSiHaceFalta");
    expect(src).toMatch(/if \(c\) reanudarSiHaceFalta\(c\.ctx\);/);
    expect(src).not.toMatch(/state === "suspended"\) void c\.ctx\.resume/);
  });

  it("cuando la pestaña vuelve a la vista, el contexto se reanuda si quedó suspendido o interrumpido", () => {
    expect(src).toMatch(/document\.addEventListener\("visibilitychange", alVolverALaVista\);/);
    expect(src).toMatch(/function alVolverALaVista\(\): void \{\s*\n\s*if \(document\.visibilityState !== "visible"\) return;\s*\n\s*if \(audioCtx\) reanudarSiHaceFalta\(audioCtx\);\s*\n\s*\}/);
  });

  it("reanudarSiHaceFalta mira los dos estados, no solo suspended", () => {
    expect(src).toMatch(/estado === "suspended" \|\| estado === "interrupted"/);
  });
});
