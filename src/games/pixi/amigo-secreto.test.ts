import { describe, expect, it } from "vitest";
import { T } from "../../i18n";
import { SELECTOR } from "../../ui/recomendar";
import { clavesDe, entradaDe } from "./kit/catalogo";

/**
 * El amigo secreto en el catálogo del kit. Nace apagado (sin captura aprobada
 * todavía): abre con `?demo=amigo` y `?pose=amigo`, y su rango arranca en dos
 * personas, que es el mínimo del juego.
 */
describe("Amigo secreto: el registro en el catálogo", () => {
  const entrada = entradaDe("amigo");

  it("está registrado con su id y su forma", () => {
    expect(entrada, "la entrada existe").toBeTruthy();
    expect(entrada?.forma).toBe("de-pie");
    expect(entrada?.id).toBe("amigo");
  });

  it("su rango arranca en dos personas y llega a doscientas, con el tramo ideal del show", () => {
    expect(entrada?.rango.minimo).toBe(2);
    expect(entrada?.rango.ideal).toEqual([8, 30]);
    expect(entrada?.rango.maximo).toBe(200);
  });

  it("nace apagado: sin captura aprobada, no está en el selector", () => {
    expect(entrada?.captura).toBe(false);
    expect(entrada?.selector).toBe(false);
    expect(SELECTOR).not.toContain("amigo");
  });

  it("las claves del sitio (botón, nombre, regla e historia) están en español y en inglés", () => {
    expect(entrada).toBeTruthy();
    const c = clavesDe("amigo");
    for (const clave of [c.boton, c.nombre, c.regla, c.varios, entrada!.historia!.q, entrada!.historia!.a]) {
      expect(typeof T.es[clave], `es.${clave}`).toBe("string");
      expect(typeof T.en[clave], `en.${clave}`).toBe("string");
      expect(String(T.es[clave]).length).toBeGreaterThan(0);
      expect(String(T.en[clave]).length).toBeGreaterThan(0);
    }
  });
});
