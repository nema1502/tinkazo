import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Cabecera {
  key: string;
  value: string;
}
interface Regla {
  source: string;
  headers: Cabecera[];
}

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: Regla[] };

describe("quién puede poner una página del sitio dentro de un marco", () => {
  it.each(["/participar.html", "/crear-campana.html"])("%s solo se enmarca dentro del mismo sitio", (ruta) => {
    const regla = config.headers.find((r) => r.source === ruta);
    const politica = regla?.headers.find((c) => c.key === "Content-Security-Policy");
    expect(politica?.value).toBe("frame-ancestors 'self'");
  });

  it("la vista en vivo sigue andando: la página que la enmarca es del mismo sitio", () => {
    const entrada = readFileSync("src/campana/crear/panel.ts", "utf8");
    expect(entrada).toContain("/participar.html?vista=previa");
  });
});
