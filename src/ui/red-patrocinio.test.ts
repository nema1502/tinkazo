import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { type DetalleDelPatrocinio, type Diagnostico } from "../stellar/chequeo-red";
import { ErrorPortero, textoDelCupo } from "../stellar/patrocinador";
import { type ContextoDelPanel, panelDe, respuestaDelBoton } from "./red-acciones";

/**
 * El caso 6, `sin-patrocinio`: la red está bien y lo que paga la comisión por la persona no puede. Una sola
 * acción principal en cada situación, y ninguna palabra de saldo, XLM, comisión de red en XLM ni "patrocinio" para
 * quien entró con Google.
 */

const diag = (patrocinio: DetalleDelPatrocinio): Diagnostico => ({
  nivel: "rojo",
  caso: "sin-patrocinio",
  casos: [{ caso: "sin-patrocinio", nivel: "rojo" }],
  red: "mainnet",
  rpc: null,
  pagador: "patrocinado",
  costoXlm: 0.2,
  rojoXlm: 1,
  ms: 300,
  ledger: 1,
  protocolo: 29,
  inclusionP90: 100,
  saldoXlm: null,
  restaurar: false,
  sinInternet: false,
  sinChequeo: false,
  motivo: "x",
  hora: 0,
  patrocinio,
});
const ctx = (o: Partial<ContextoDelPanel> = {}): ContextoDelPanel => ({ red: "mainnet", intentos: 0, grifo: false, saldoXlm: null, costoXlm: 0.2, ...o });
const LIBERA = Date.UTC(2026, 11, 1);

describe("sin-patrocinio: una sola acción principal", () => {
  it("se acabó el cupo de la cuenta: seguir sin sello, con el día en que vuelve", () => {
    const p = panelDe(diag({ motivo: "cupo-cuenta", que: "sellos", liberaEn: LIBERA }), ctx());
    expect(p).toMatchObject({ nivel: "rojo", caso: "sin-patrocinio", frase: "errAnchor.porteroCupoSellos", principal: "seguir-sin-sello", bloquea: true, liberaEn: LIBERA });
  });
  it("el servicio no contesta o no puede pagar: volver a probar, y seguir sin sello en chiquito", () => {
    for (const motivo of ["cerrado", "fondo"] as const) {
      const p = panelDe(diag({ motivo }), ctx());
      expect(p).toMatchObject({ frase: "errAnchor.porteroFondo", principal: "reintentar", secundarias: ["seguir-sin-sello"], bloquea: true });
    }
  });
  it("la cuenta no es de las que se cubren: seguir sin sello, y sellar con la propia si puede", () => {
    expect(panelDe(diag({ motivo: "ajena" }), ctx())).toMatchObject({ frase: "errAnchor.porteroAjena", principal: "seguir-sin-sello" });
    expect(panelDe(diag({ motivo: "ajena" }), ctx({ saldoXlm: 50 }))).toMatchObject({ frase: "errAnchor.porteroAjenaPropia", principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"] });
  });
  it("si la cuenta tiene con qué pagar la suya, esa es la acción en cualquiera de los casos", () => {
    for (const motivo of ["cerrado", "fondo", "cupo-cuenta"] as const) {
      expect(panelDe(diag({ motivo }), ctx({ saldoXlm: 50 })).principal).toBe("sellar-con-mi-cuenta");
    }
  });
  it("en testnet, con el grifo, se carga saldo de prueba y se sella con la propia", () => {
    expect(panelDe(diag({ motivo: "cerrado" }), ctx({ red: "testnet", grifo: true }))).toMatchObject({ principal: "sellar-con-mi-cuenta", cargaPrevia: true });
  });
  it("el botón de la red no repite 'Hoy no se puede sellar' delante de estas frases", () => {
    const d = diag({ motivo: "fondo" });
    expect(respuestaDelBoton(d, panelDe(d, ctx()))).toEqual({ clave: "errAnchor.porteroFondo", nivel: "rojo" });
  });
});

const PROHIBIDAS = /saldo|balance|XLM|\bfee\b|patrocin|sponsor|lumens?|stroop/i;

describe("los textos nuevos", () => {
  const claves = ["errAnchor.porteroCupoSellos", "errAnchor.porteroCupoSorteos", "errAnchor.porteroFondo", "errAnchor.porteroFondoSorteo", "errAnchor.porteroAjena", "errAnchor.porteroAjenaPropia", "errAnchor.cupoPronto", "cupoQuedan", "cupoQueda1", "cupoCero", "sortearPropio", "sorteoMasTarde", "tmPatrocinio", "prPatrocinioNota", "txCubriendo"];

  it("están en español y en inglés", () => {
    for (const k of claves) {
      expect(typeof T.es[k], `es ${k}`).toBe("string");
      expect(typeof T.en[k], `en ${k}`).toBe("string");
    }
  });
  it("no dicen saldo, XLM, fee ni patrocinio, ni llevan el punto medio", () => {
    for (const k of claves) for (const l of ["es", "en"] as const) {
      const v = String(T[l][k]);
      expect(v, `${l} ${k}`).not.toMatch(PROHIBIDAS);
      expect(v, `${l} ${k}`).not.toContain("·");
    }
  });
  it("las frases con día llevan el hueco {fecha} y nunca culpan a la persona", () => {
    for (const l of ["es", "en"] as const) {
      expect(String(T[l]["errAnchor.porteroCupoSellos"])).toContain("{fecha}");
      expect(String(T[l]["errAnchor.porteroCupoSorteos"])).toContain("{fecha}");
      expect(String(T[l]["cupoCero"])).toContain("{fecha}");
    }
  });
  it("con una cuenta de Google en mainnet, ninguna respuesta del portero muestra saldo ni XLM", async () => {
    const { errorKey } = await import("../stellar/errores");
    const respuestas = [
      new ErrorPortero("cupo-cuenta", 429, { que: "sellos", liberaEn: LIBERA, max: 20 }),
      new ErrorPortero("cupo-cuenta", 429, { que: "sorteos", liberaEn: LIBERA, max: 40 }),
      new ErrorPortero("fondo", 503, { detalle: "txInsufficientBalance" }),
      new ErrorPortero("apagado", 503),
      new ErrorPortero("no-permitida", 400, { razon: "firma" }),
      new ErrorPortero("cuenta-ajena", 403),
      new ErrorPortero("cerrado", 0),
    ];
    for (const e of respuestas) for (const l of ["es", "en"] as const) {
      const clave = errorKey(e);
      expect(clave).toMatch(/^portero/);
      expect(String(T[l]["errAnchor." + clave]), `${l} ${clave}`).not.toMatch(PROHIBIDAS);
    }
  });
});

describe("la línea del cupo", () => {
  const portero = (quedan: number) => ({ rige: "portero" as const, cupo: { sellos: { usados: 20 - quedan, max: 20, quedan }, sorteos: { usados: 0, max: 40, quedan: 40 }, liberaEn: LIBERA } });
  const decir = (l: "es" | "en") => (k: string): string => String(T[l][k]);

  it("cuenta los que quedan, en singular y en plural", () => {
    expect(textoDelCupo(portero(18), "es", decir("es"))).toBe("Te quedan 18 sorteos gratis este mes.");
    expect(textoDelCupo(portero(1), "es", decir("es"))).toBe("Te queda 1 sorteo gratis este mes.");
    expect(textoDelCupo(portero(18), "en", decir("en"))).toBe("You have 18 free draws left this month.");
    expect(textoDelCupo(portero(1), "en", decir("en"))).toBe("You have 1 free draw left this month.");
  });
  it("con 0 dice cuándo vuelve", () => {
    expect(textoDelCupo(portero(0), "es", decir("es"))).toBe("Ya usaste los sorteos gratis de este mes. Vuelven el 1 de diciembre.");
    expect(textoDelCupo(portero(0), "en", decir("en"))).toBe("You've used this month's free draws. They're back on December 1.");
  });
  it("no dice nada si no paga el portero", () => {
    expect(textoDelCupo(null, "es", decir("es"))).toBeNull();
    expect(textoDelCupo({ rige: "pollar", configurado: true }, "es", decir("es"))).toBeNull();
    expect(textoDelCupo({ rige: "cerrado", motivo: "apagado" }, "es", decir("es"))).toBeNull();
  });
});
