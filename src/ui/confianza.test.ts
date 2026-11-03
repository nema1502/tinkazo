import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { T } from "../i18n";
it("incluye un lugar oculto justo debajo del veredicto y antes del resultado", () => {
  const html = readFileSync("verificar.html", "utf8");
  expect(html).toContain('<aside id="confianza" hidden');
  // Justo debajo del veredicto, no al final de la página: poca gente llega a 1.900 px de scroll.
  expect(html.indexOf('id="confianza"')).toBeGreaterThan(html.indexOf('id="verdict"'));
  expect(html.indexOf('id="confianza"')).toBeLessThan(html.indexOf('id="sec-result"'));
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
it("los términos hablan sin tecnicismos y dicen que la marca queda en el navegador", () => {
  for (const lang of ["es", "en"] as const) {
    expect(T[lang].tmTrust).not.toMatch(/UTC|URL|fragmento|fragment|huella|hash|identificadores|identifiers|pestaña|tab\b/);
  }
  expect(T.es.tmTrust).toMatch(/Este navegador recuerda/);
  expect(T.en.tmTrust).toMatch(/This browser remembers/);
});
