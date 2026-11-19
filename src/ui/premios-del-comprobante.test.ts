import { describe, expect, it } from "vitest";
import type { PremioDelSello } from "../stellar/premios";
import { activoDe, htmlDeLosPremios, montoEnTexto, vistaDeLosPremios, type Idioma } from "./premios-del-comprobante";

/**
 * La sección de premios del comprobante (una campaña), sin DOM: lo que se arma es el HTML que la página
 * de verificación y la del evento pintan tal cual. Los datos son los de la promoción 8 de testnet
 * (100 cuentas, 10 premios de 10 XLM), leídos de su contrato por `premios.ts`.
 */

const XLM_TESTNET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const GANADOR = "GCCIWHCU5XZ4VAK2GAFJBBTJJXIWPWBPK56JOGEPS6N6LP7AYLILD7F3";

const premios = (cuantos: number, indice: (puesto: number) => number): PremioDelSello["premios"] =>
  Array.from({ length: cuantos }, (_, puesto) => ({
    position: puesto,
    index: indice(puesto),
    amount: "100000000",
    state: "Paid" as const,
    winner: GANADOR,
  }));

const promoción = (cambios: Partial<PremioDelSello> = {}): PremioDelSello => ({
  contrato: "CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY",
  promocionId: "8",
  sorteoId: "586",
  deposito: "30000000",
  token: XLM_TESTNET,
  inKind: false,
  rulesHash: "b0a55c1af779ec10c0b37f127a5a63cc139d2de4bd7f0b7d35241c0a757b49af",
  listHash: "91136c024fcaa190b35c2ff626097eb3017d35ce6c62687455a4fa600c8652af",
  premios: premios(3, (puesto) => [57, 6, 75][puesto] as number),
  ...cambios,
});

/** La revisión de la que salen los premios: los ganadores recomputados son los índices de la promoción. */
const revision = (p: PremioDelSello | null, veredicto: "verde" | "pendiente" | "mal" = "verde") => ({
  veredicto,
  premio: p,
  ganadores: p ? p.premios.map((x) => x.index) : [],
  nombres: Array.from({ length: 100 }, (_, i) => (i === 57 || i === 6 || i === 75 ? GANADOR : `G${String(i).padStart(55, "A")}`)),
});

describe("el monto de un premio", () => {
  it("se escribe en unidades del activo, sin ceros de más y con separador de miles", () => {
    expect(montoEnTexto("0", "es")).toBe("0");
    expect(montoEnTexto("10000000", "es")).toBe("1");
    expect(montoEnTexto("30000000", "es")).toBe("3");
    expect(montoEnTexto("1000000000", "es")).toBe("100");
    expect(montoEnTexto("12345678", "es")).toBe("1,2345678");
    expect(montoEnTexto("123456789012345", "es")).toBe("12.345.678,9012345");
    // En inglés, la coma y el punto al revés.
    expect(montoEnTexto("123456789012345", "en")).toBe("12,345,678.9012345");
  });

  it("el activo, por su dirección: el XLM de cada red, el USDC de Circle, y si no se conoce, abreviado", () => {
    expect(activoDe(XLM_TESTNET)).toBe("XLM");
    expect(activoDe("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75")).toBe("USDC");
    expect(activoDe("CDMCHQQU5AMPA3DMWUDVEHFXZ2YIQWXOCXQBBIK3WEU2LRVIEFODHRFB")).toBe("CDMC…HRFB");
    expect(activoDe(XLM_TESTNET)).not.toContain(XLM_TESTNET);
  });
});

describe("la sección de premios del comprobante", () => {
  it("un sorteo sin promoción no la muestra: la comprobación de un sorteo sin premio queda intacta", () => {
    expect(vistaDeLosPremios(revision(null), "es")).toBeNull();
    expect(htmlDeLosPremios(revision(null), "es")).toBe("");
    // Tampoco con `undefined`, como un comprobante anterior a esta versión.
    expect(htmlDeLosPremios({ veredicto: "verde", premio: undefined, ganadores: [], nombres: [] }, "es")).toBe("");
  });

  it("solo con el sello aceptado: un rojo no muestra los premios de una campaña que no cuadra", () => {
    expect(htmlDeLosPremios(revision(promoción(), "mal"), "es")).toBe("");
  });

  it("muestra el depósito, la huella de las bases, la de la lista y el pago de cada premio", () => {
    const html = htmlDeLosPremios(revision(promoción()), "es");
    expect(html).toContain("Los premios de la campaña");
    // El depósito: la suma de los premios, en el activo depositado.
    expect(html).toContain("El depósito");
    expect(html).toContain("3 XLM");
    // Las dos huellas de las bases, abreviadas (la de las reglas y la de la lista sellada).
    expect(html).toContain("La huella de las bases");
    expect(html).toContain("La huella de la lista");
    expect(html).toContain("b0a55c1af779");
    expect(html).toContain("91136c024fca");
    expect(html).not.toContain("b0a55c1af779ec10c0b37f127a5a63cc139d2de4bd7f0b7d35241c0a757b49af");
    // Un renglón por premio, con su monto, su estado y a quién se le pagó.
    expect(html.match(/Premio \d/g)).toHaveLength(3);
    expect(html).toContain("Premio 1 · 10 XLM");
    expect(html).toContain("Pagado");
    expect(html).toContain("GCCIWHCU…LILD7F3");
    // Y que es el ganador que se rehizo acá, no solo el que dice el contrato.
    expect(html).toContain("es el ganador recomputado");
  });

  it("un premio cuyo ganador no es el recomputado se marca, y no dice que coincide", () => {
    const p = promoción({ premios: premios(3, (puesto) => [57, 99, 75][puesto] as number) });
    const html = htmlDeLosPremios(revision(p), "es");
    expect(html).toContain("no coincide con el ganador recomputado");
    expect(html.match(/es el ganador recomputado/g)).toHaveLength(2);
    // El que no coincide va marcado como lo que no cuadra, no como lo que sí.
    expect(html).toContain('class="check bad"');
  });

  it("los estados del pago que no son 'pagado' se dicen en palabras", () => {
    const estados = ["Owed", "Held", "Returned"] as const;
    for (const [i, estado] of estados.entries()) {
      const p = promoción({ premios: [{ ...premios(1, () => 57)[0]!, state: estado }] });
      const html = htmlDeLosPremios(revision(p), "es");
      expect(html, estado).toContain(["Reclamable", "En depósito", "Devuelto"][i] as string);
      expect(html, estado).not.toContain("Pagado");
    }
  });

  it("en inglés, sus textos", () => {
    const html = htmlDeLosPremios(revision(promoción()), "en");
    expect(html).toContain("The campaign prizes");
    expect(html).toContain("The deposit");
    expect(html).toContain("Paid");
    expect(html).not.toContain("Pagado");
  });

  it("un premio en especie lo dice: el monto es una referencia, no el activo depositado", () => {
    expect(htmlDeLosPremios(revision(promoción({ inKind: true })), "es")).toContain("en especie");
  });

  it("lo que viene del contrato se escapa: un título con etiquetas no se pinta", () => {
    const p = promoción({ premios: [{ ...premios(1, () => 57)[0]!, winner: "<b>GCCIWHCU</b>" }] });
    const html = htmlDeLosPremios(revision(p), "es");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>GCCIWHCU</b>");
  });
});

describe("el idioma", () => {
  it("cada idioma pide sus textos completos", () => {
    for (const idioma of ["es", "en"] as Idioma[]) {
      const vista = vistaDeLosPremios(revision(promoción()), idioma);
      expect(vista?.titulo.length, idioma).toBeGreaterThan(0);
      expect(vista?.filas).toHaveLength(3);
    }
  });
});
