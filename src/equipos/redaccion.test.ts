import { describe, expect, it } from "vitest";
import { TEXTOS_PAGOS } from "../ui/pagos-textos";
import { TEXTOS_EQUIPOS } from "./textos";

describe("redacción de los textos de equipos y de pagos", () => {
  it("los límites de apertura hablan de registros, no de salas", () => {
    expect(TEXTOS_EQUIPOS.es.eqErrCupoIp).toBe("Ya se abrieron varios registros desde esta conexión. Probá en una hora.");
    expect(TEXTOS_EQUIPOS.es.eqErrCupoDia).toBe("Hoy se llegó al límite de registros. Probá mañana.");
    expect(TEXTOS_EQUIPOS.en.eqErrCupoIp).toContain("sign-ups");
    expect(TEXTOS_EQUIPOS.en.eqErrCupoDia).toContain("sign-ups");
    for (const k of ["eqErrCupoIp", "eqErrCupoDia"]) {
      expect(TEXTOS_EQUIPOS.es[k]).not.toMatch(/sala/i);
      expect(TEXTOS_EQUIPOS.en[k]).not.toMatch(/room/i);
    }
  });

  it("en inglés los errores arrancan todos igual: «We could not…»", () => {
    const errores = Object.entries(TEXTOS_EQUIPOS.en).filter(([k]) => /^eqErr(Cerrar|Quitar|Aceptar|Crear|Configurar)$/.test(k));
    expect(errores).toHaveLength(5);
    for (const [k, v] of errores) expect(v, k).toMatch(/^We could not /);
  });

  it("la nota del panel de pagos no anida «que» ni repite «quien ganó» al final", () => {
    expect(TEXTOS_PAGOS.es.pgNotaLeer).toContain("y quien ganó confirma que la cuenta que lo recibe es la suya.");
    expect(TEXTOS_PAGOS.en.pgNotaLeer).toContain("and the winner confirms that the receiving account is theirs.");
    expect(TEXTOS_PAGOS.en.pgNotaLeer).not.toMatch(/is for the winner to confirm/);
  });
});
