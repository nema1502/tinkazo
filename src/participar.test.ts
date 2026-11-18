import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("participar.html", "utf8");

describe("el marcado de participar.html", () => {
  it("mantiene un único aviso accesible como hijo fijo de la pantalla", () => {
    const avisos = html.match(/<p id="cmp-mensaje"/gu) ?? [];
    expect(avisos).toHaveLength(1);
    expect(html).toMatch(/<main class="cmp">[\s\S]*<p id="cmp-mensaje"[^>]*role="status"/u);
    expect(html).toMatch(/<p id="cmp-mensaje"[^>]*aria-live="polite"/u);
  });
});
