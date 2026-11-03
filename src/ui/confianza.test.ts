import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { T } from "../i18n";
it("incluye un lugar oculto después de comprobaciones, fuera del resultado", () => {
  const html = readFileSync("verificar.html", "utf8");
  expect(html).toContain('<aside id="confianza" hidden');
  expect(html.indexOf('id="confianza"')).toBeGreaterThan(html.indexOf('id="sec-checks"'));
});
it("prepara pregunta, confirmación e incertidumbre ES/EN sin activar ni fechar términos", () => {
  expect(T.es.trustQuestion).toBe("¿Confiaste en el resultado?");
  expect(T.en.trustQuestion).toBe("Did you trust the result?");
  expect(T.es.trustReceived).toBe("Respuesta recibida. Gracias");
  expect(T.en.trustReceived).toBe("Response received. Thank you");
  expect(T.es.trustUnknown).toMatch(/no sabemos.*dos veces/i);
  expect(T.en.trustUnknown).toMatch(/do not know.*twice/i);
  expect(T.es.tmTrust).toMatch(/apagado/);
  expect(T.en.tmTrust).toMatch(/off/);
});
