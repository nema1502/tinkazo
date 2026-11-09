import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const t = (idioma: "es" | "en", clave: string): string => String(T[idioma][clave]);

describe("revisión de redacción de los textos visibles", () => {
  it("el plegado de precios no repite «Hoy» ni «Today» en oraciones seguidas", () => {
    expect(t("es", "nextBody").match(/\bHoy\b/g)).toHaveLength(1);
    expect(t("en", "nextBody").match(/\btoday\b/gi)).toHaveLength(1);
  });

  it("el texto inicial de precios.html es el del diccionario", () => {
    const html = leer("precios.html");
    expect(html).toContain(`data-i="nextBody">${t("es", "nextBody")}</p>`);
  });

  it("precios.html usa «comprobar» en el título, la descripción y los datos estructurados", () => {
    const html = leer("precios.html");
    expect(html).not.toMatch(/verificar/i);
    expect(t("es", "prNever3")).toBe("Comprobar un sorteo.");
    expect(t("es", "titPrecios")).toBe("Precios de Tinkazo: participar y comprobar es gratis");
    expect(html).toContain(`<title>${t("es", "titPrecios")}</title>`);
    expect(html).toContain(t("es", "descPrecios"));
    expect(t("es", "descPrecios")).not.toMatch(/verificar/i);
  });

  it("las monedas no hablan de «chances»: ni en los textos ni en el sitio", () => {
    expect(t("es", "monReglas")).toContain("nunca te dan más probabilidades en un sorteo");
    expect(t("en", "monReglas")).toContain("never improve your odds in a draw");
    for (const idioma of ["es", "en"] as const) {
      expect(t(idioma, "monReglas"), idioma).not.toMatch(/chances?/i);
      expect(t(idioma, "monNoCambia"), idioma).not.toMatch(/chances?/i);
    }
    for (const ruta of ["workers/cuenta/src/reglas.ts", "workers/cuenta/src/servidor.ts", "workers/cuenta/README.md"]) {
      expect(leer(ruta), ruta).not.toMatch(/compra(n)? chances/);
    }
  });

  it("el aviso de reintento no dice «momento» y no nombra la ronda", () => {
    expect(t("es", "txOtraRonda")).toBe("No quedó grabado a tiempo. Volvemos a probar un poco más adelante…");
    expect(t("en", "txOtraRonda")).toBe("It wasn't recorded in time. We'll try again a little later…");
    expect(`${t("es", "txOtraRonda")} ${t("en", "txOtraRonda")}`).not.toMatch(/ronda|round/i);
  });

  it("el plan del equipo no revela el tope del plan gratis", () => {
    expect(t("es", "planISorteos")).toBe("50 sorteos propios por 30 días.");
    expect(t("en", "planISorteos")).toBe("50 draws of your own for 30 days.");
  });

  it("el QR para tu arte explica la placa sin contradecirse y el archivo «es» de un tamaño, no «pesa»", () => {
    expect(t("es", "maQrEtB")).toContain("El código va sobre una placa blanca");
    expect(t("en", "maQrEtB")).toContain("The code sits on a white plate");
    expect(t("en", "maQrEtB")).not.toMatch(/transparent background/);
    expect(t("en", "maQrZipNota")).toMatch(/It is 1\.1 MB\.$/);
    expect(leer("marca.html")).toContain(`data-i="maQrEtB">${t("es", "maQrEtB")}</p>`);
  });

  it("el saldo mínimo dice qué parte de la comisión es la fija", () => {
    expect(t("es", "saldoMinimo")).toContain("la parte fija de la comisión (1 dólar)");
    expect(t("en", "saldoMinimo")).toContain("the fixed part of the fee (1 dollar)");
    expect(`${t("es", "saldoMinimo")} ${t("en", "saldoMinimo")}`).not.toMatch(/dólar fijo|fixed dollar/);
  });
});
