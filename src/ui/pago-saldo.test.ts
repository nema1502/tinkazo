import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA_PAGO } from "../alta-textos-pago";
import { T } from "../i18n";
import type { OrdenDePago } from "../stellar/alta-api";
import type { MotivoDelPago } from "../stellar/pago-con-saldo";
import { type FaseDelSaldo, MEDIO_SALDO, lineaDelSaldo, mediosConSaldo, textoDelCorto, textoDelMotivo, trasPagar, vistaDelSaldo } from "./pago-saldo";
import { MEDIOS_DE_PAGO } from "./pago-vista";

/**
 * Lo que se ve al pagar con el saldo de la cuenta, sin DOM: cuándo se ofrece, la confirmación, cada falla, y que se vea
 * simple (un título corto, una línea de 14 palabras como mucho, una principal de 8) en los dos idiomas.
 */

const IDIOMAS = ["es", "en"] as const;
const palabras = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const poner = (l: "es" | "en", x: { clave: string; vars?: Record<string, string> }): string => Object.entries(x.vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), String(T[l][x.clave] ?? ""));
const ORDEN: OrdenDePago = { id: "ABCD2345", producto: "alta", usdc: "3", sorteos: 3, destino: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", nota: "tk:o:ABCD2345", memoId: "1", enlace: "web+stellar:pay?x", vence: 1 };
const SALDO_CLAVES = Object.keys(TEXTOS_ALTA_PAGO.es).filter((k) => k.startsWith("pagoSaldo") || k === "pagoMedioSaldo");

describe("cuándo se ofrece", () => {
  it("con saldo que alcanza: el saldo primero y el otro medio al lado", () => {
    expect(mediosConSaldo({ tipo: "saldo", saldo: "3.0000000" }, "3")).toEqual({ medios: [MEDIO_SALDO, ...MEDIOS_DE_PAGO], saldo: "3.0000000", corto: null });
  });
  it("con saldo que no alcanza: el medio de siempre, y lo que hay y lo que falta", () => {
    expect(mediosConSaldo({ tipo: "saldo", saldo: "1.5000000" }, "3")).toEqual({ medios: MEDIOS_DE_PAGO, saldo: "1.5000000", corto: { tiene: "1.5000000", falta: "1.5000000" } });
  });
  it("sin saldo, sin línea, sin cuenta o sin respuesta: como siempre, sin nada del saldo", () => {
    for (const s of [null, { tipo: "saldo", saldo: "0.0000000" }, { tipo: "sin-linea" }, { tipo: "sin-cuenta" }, { tipo: "sin-red" }] as const) {
      expect(mediosConSaldo(s, "3"), JSON.stringify(s)).toEqual({ medios: MEDIOS_DE_PAGO, saldo: null, corto: null });
    }
  });
});

describe("lo que dice", () => {
  it("cuánto hay, con coma en español y en singular si es uno", () => {
    expect(poner("es", lineaDelSaldo("12.5000000", "es"))).toBe("Tenés 12,50 dólares digitales en tu cuenta.");
    expect(poner("en", lineaDelSaldo("12.5000000", "en"))).toBe("You have 12.50 digital dollars in your account.");
    expect(poner("es", lineaDelSaldo("1.0000000", "es"))).toBe("Tenés 1 dólar digital en tu cuenta.");
    expect(poner("es", textoDelCorto({ tiene: "1.5000000", falta: "1.5000000" }, "es"))).toBe("Tenés 1,50 dólares digitales, faltan 1,50");
    expect(poner("es", textoDelCorto({ tiene: "1.0000000", falta: "2.0000000" }, "es"))).toBe("Tenés 1 dólar digital, faltan 2");
    expect(poner("en", textoDelCorto({ tiene: "1.0000000", falta: "2.0000000" }, "en"))).toBe("You have 1 digital dollar, 2 short");
  });

  it("la confirmación, con el monto y para qué, de la orden tal cual", () => {
    const v = vistaDelSaldo({ idioma: "es", saldo: "12.5000000", fase: "confirmar", incierto: false, motivo: null, buscando: false, tarda: false, errorDelSondeo: null }, ORDEN);
    expect(v.textos.map((x) => poner("es", x))).toEqual(["Vas a pagar 3 dólares a Tinkazo por 3 sorteos oficiales."]);
    expect(poner("es", v.principal)).toBe("Pagar 3 dólares");
    expect(v.principal.accion).toBe("saldo-pagar");
    expect(v.secundarios.map((b) => b.accion)).toEqual(["saldo-otro-medio"]);
    const en = vistaDelSaldo({ idioma: "en", saldo: "12.5000000", fase: "confirmar", incierto: false, motivo: null, buscando: false, tarda: false, errorDelSondeo: null }, ORDEN);
    expect(en.textos.map((x) => poner("en", x))).toEqual(["You're paying US$3 to Tinkazo for 3 Live draws."]);
    expect(poner("en", en.principal)).toBe("Pay US$3");
  });

  it("no alcanza: cuánto hay y cuánto falta, y si lo leído alcanzaba, que no se pudo", () => {
    expect(poner("es", textoDelMotivo("sin-saldo", { saldo: "1.0000000", monto: "3", idioma: "es" }))).toBe("Tu saldo no alcanza. Tenés 1 y faltan 2.");
    expect(textoDelMotivo("sin-saldo", { saldo: "5.0000000", monto: "3", idioma: "es" }).clave).toBe("pagoSaldoNoSalio");
  });

  it("después de pagar: salió o no se sabe, se mira; no salió, de vuelta a la confirmación con el motivo", () => {
    expect(trasPagar({ estado: "salio", hash: "x" })).toEqual({ fase: "mirando", incierto: false, motivo: null, mirar: true });
    expect(trasPagar({ estado: "incierto", vence: 1 })).toEqual({ fase: "mirando", incierto: true, motivo: null, mirar: true });
    expect(trasPagar({ estado: "no-salio", motivo: "cancelado" })).toEqual({ fase: "confirmar", incierto: false, motivo: "cancelado", mirar: false });
  });
});

describe("se ve simple, en cada estado y en los dos idiomas", () => {
  it("una sola línea de 14 palabras como mucho, una principal de 8, y nunca pagar de nuevo si no se sabe si salió", () => {
    const fases: FaseDelSaldo[] = ["confirmar", "pagando", "mirando"];
    const motivos: Array<MotivoDelPago | null> = [null, "sin-saldo", "sin-linea", "cancelado", "regla", "sin-patrocinio", "destino", "rechazado", "red", "sin-cuenta"];
    let n = 0;
    for (const idioma of IDIOMAS)
      for (const fase of fases)
        for (const motivo of motivos)
          for (const incierto of [false, true])
            for (const buscando of [false, true])
              for (const tarda of [false, true])
                for (const errorDelSondeo of [null, { clave: "pagoErrRed" }])
                  for (const saldo of ["12.5000000", "3.0000000", "1.2500000"])
                    for (const usdc of ["3", "2.85", "25"]) {
                      const v = vistaDelSaldo({ idioma, saldo, fase, incierto, motivo, buscando, tarda, errorDelSondeo }, { ...ORDEN, usdc });
                      const quien = JSON.stringify({ idioma, fase, motivo, incierto, buscando, tarda, errorDelSondeo, saldo, usdc });
                      const lineas = [...v.textos, ...(v.error ? [v.error] : [])];
                      expect(lineas.length, quien).toBeLessThanOrEqual(1);
                      for (const x of lineas) expect(palabras(poner(idioma, x)), `${quien} ${poner(idioma, x)}`).toBeLessThanOrEqual(14);
                      expect(palabras(poner(idioma, v.principal)), quien).toBeLessThanOrEqual(8);
                      expect(v.secundarios.some((b) => b.accion === v.principal.accion), quien).toBe(false);
                      if (incierto || fase !== "confirmar") expect([v.principal, ...v.secundarios].some((b) => b.accion === "saldo-pagar" && !b.apagado), quien).toBe(false);
                      n++;
                    }
    expect(n).toBeGreaterThan(4000);
  });

  it("los textos del saldo dicen dólares digitales: nunca el nombre de la moneda, la red ni la nota técnica", () => {
    expect(SALDO_CLAVES.length).toBeGreaterThan(15);
    for (const k of SALDO_CLAVES)
      for (const l of IDIOMAS) {
        const s = TEXTOS_ALTA_PAGO[l][k] as string;
        expect(s, `${l} ${k}`).not.toMatch(/\b(USDC|Stellar|memo|exchange|XLM|token|hash|firma|transacci[oó]n|transaction|signature)\b/i);
        expect(s, `${l} ${k}`).not.toMatch(/[«»;!¡]/);
      }
  });
});
