import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { HAY_MODO_OFICIAL, TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";

const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const t = (idioma: "es" | "en", clave: string): string => String(T[idioma][clave]);

describe("revisión de redacción de los textos visibles", () => {
  it("el plegado de precios no repite «Hoy» ni «Today» en oraciones seguidas", () => {
    // Sin modo Oficial dice una vez «Hoy… funciona en modo prueba»; con él, «En el modo Prueba…», sin «Hoy» (`i18n-modo-oficial.ts`).
    const veces = HAY_MODO_OFICIAL ? 0 : 1;
    expect(t("es", "nextBody").match(/\bHoy\b/g) ?? []).toHaveLength(veces);
    expect(t("en", "nextBody").match(/\btoday\b/gi) ?? []).toHaveLength(veces);
  });

  it("el texto inicial de precios.html es el del diccionario", () => {
    const html = leer("precios.html");
    expect(html).toContain(`data-i="nextBody">${t("es", "nextBody")}</p>`);
  });

  it("las páginas traen en el HTML el texto del diccionario de las claves que cambian con el modo Oficial", () => {
    // El HTML es lo que se ve antes de que cargue el JavaScript y lo que leen los buscadores: si difiere del diccionario,
    // la página salta de un texto al otro. El día que se cargue el contrato real, esto dice qué página cambiar y con qué.
    const raiz = new URL("../", import.meta.url);
    const vistas: string[] = [];
    const desfasadas: string[] = [];
    for (const pagina of readdirSync(raiz).filter((f) => f.endsWith(".html"))) {
      const html = leer(pagina);
      for (const clave of Object.keys(TEXTOS_MODO_OFICIAL.es)) {
        if (!html.includes(`data-i="${clave}"`)) continue;
        vistas.push(`${pagina}:${clave}`);
        if (!html.includes(`data-i="${clave}">${t("es", clave)}<`)) desfasadas.push(`${pagina}, data-i="${clave}"`);
      }
    }
    expect(vistas).toEqual(
      expect.arrayContaining([
        "precios.html:nextBody",
        "precios.html:prNote",
        "index.html:faq3a",
        "terminos.html:tmPatrocinio",
        "terminos.html:tmMore1",
        "sorteo-verificable.html:verifN3",
        "terminos.html:tmMore3",
      ]),
    );
    const donde = HAY_MODO_OFICIAL ? "el de i18n-modo-oficial.ts" : "el de i18n.ts";
    expect(desfasadas, `El HTML tiene que llevar el texto del diccionario (${donde}) en`).toEqual([]);
  });

  it("como-funciona.html trae en el HTML el texto de quién paga la comisión, el único que lleva un enlace", () => {
    expect(leer("como-funciona.html")).toContain(`data-i-html="cfCostoB">${t("es", "cfCostoB")}</p>`);
  });

  it("precios.html usa «comprobar» en el título, la descripción y los datos estructurados", () => {
    const html = leer("precios.html");
    expect(html).not.toMatch(/verificar/i);
    expect(t("es", "prNever3")).toBe("Comprobar un sorteo es gratis, siempre.");
    expect(t("es", "titPrecios")).toBe("Precios de Tinkazo: participar y comprobar es gratis");
    expect(html).toContain(`<title>${t("es", "titPrecios")}</title>`);
    expect(html).toContain(t("es", "descPrecios"));
    expect(t("es", "descPrecios")).not.toMatch(/verificar/i);
  });

  it("las monedas no hablan de «chances»: ni en los textos ni en el sitio", () => {
    expect(t("es", "monReglas")).toContain("nunca te dan más probabilidades en un sorteo");
    expect(t("en", "monReglas")).toContain("never improve your odds in a draw");
    for (const idioma of ["es", "en"] as const) {
      expect(t(idioma, "monReglas"), idioma).not.toMatch(/\bchances?\b/i);
      expect(t(idioma, "monNoCambia"), idioma).not.toMatch(/\bchances?\b/i);
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

  it("la cuenta 3, 2, 1 de la tarjeta del juego no vuelve a decir Contemos juntos, que quien organiza rechazó", () => {
    // La primera versión de la espera cerraba con esa frase y salió el 17 de octubre de 2026 (`ui/espera.ts`).
    expect(t("es", "gcCuenta")).toBe("¡Cuenten conmigo!");
    expect(t("en", "gcCuenta")).toBe("Count with me!");
    expect(`${t("es", "gcCuenta")} ${t("en", "gcCuenta")}`).not.toMatch(/contemos juntos|count down together/i);
  });
});
