import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import vectors from "../docs/vectors.json";
import { T } from "./i18n";
import { PROOF_VERSION, type Proof } from "./protocol/proof";
import { MOTIVOS, type Motivo, type Revision } from "./protocol/verificacion";
import { contratoOficial } from "./stellar/oficiales";
import type { LecturaDelHistorial, SelloDelHistorial } from "./stellar/historial";
import { codigoDelSello, detalleDelHistorial, detalleTecnico, porQueNoCuadra, porQueSinHistorial } from "./verificacion-textos";

/**
 * Los textos de la verificación: lo que cuentan `verificar.html` y `evento.html`
 * cuando algo no cuadra, y lo que dicen del historial de transacciones. Cada clave
 * que el código nombra existe en español y en inglés, con los mismos marcadores
 * ({tx}, {f}…), y cada motivo tiene su explicación y su línea técnica.
 */

const codigo = ["src/verify.ts", "src/verificacion-textos.ts", "src/evento.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
const claves = new Set([...codigo.matchAll(/["'`]((?:v[A-Z]|vTech|evCadena|evAnclado)[A-Za-z0-9]*)["'`]/g)].map((m) => m[1] as string));

describe("las claves de texto de la verificación", () => {
  it("el código pide claves, y todas existen en español y en inglés", () => {
    expect(claves.size).toBeGreaterThan(40);
    const faltan = [...claves].filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string");
    expect(faltan).toEqual([]);
  });

  it("cada texto con marcadores los tiene iguales en los dos idiomas", () => {
    const marcas = (s: string): string[] => [...s.matchAll(/\{[a-z]+\}/g)].map((m) => m[0]).sort();
    const distintas = [...claves].filter((k) => {
      const es = T.es[k];
      const en = T.en[k];
      return typeof es === "string" && typeof en === "string" && JSON.stringify(marcas(es)) !== JSON.stringify(marcas(en));
    });
    expect(distintas).toEqual([]);
  });

  it("los textos del historial que ve cualquiera no dicen firma, hash, bytes ni drand", () => {
    // Lo técnico va plegado (vTech…); el resto lo lee quien escaneó el QR.
    const planos = ["vVerdictOkHistoryDetail", "vVerdictOkHistoryDetailTest", "vTx", "vOfficialAddress", "vChainFromHistory", "vHistInvalidDetail", "vHistDistinctDetail", "vHistWhyDown", "vHistWhyOdd", "vHistWhyWindow", "vHistWhyNone", "vChainNotConfirmed", "vSelloCodigo", "evCadenaHistorial", "evCadenaSinHistorial", "evSelloCodigo", "evAncladoHistorial"];
    for (const l of ["es", "en"] as const) {
      for (const k of planos) {
        expect(String(T[l][k]), `${l}.${k}`).not.toMatch(/drand|\bbytes?\b|\bhash(es)?\b|\bfirmas?\b|\bfirmad[oa]s?\b|signature|\bBLS\b/i);
      }
    }
  });

  it("cada razón por la que el historial no pudo confirmar un sorteo existe en los dos idiomas, y ninguna dice que no existe ni promete nada", () => {
    const razones = ["vHistWhyDown", "vHistWhyOdd", "vHistWhyWindow", "vHistWhyNone"];
    for (const k of razones) {
      expect(String(T.es[k]), `es.${k}`).toMatch(/^El contrato ya no guarda este sorteo/);
      expect(String(T.en[k]), `en.${k}`).toMatch(/^The contract no longer holds this draw/);
      // Dicen que no se pudo comprobar, nunca que no está: una fuente que no contesta o que ya no guarda algo no prueba ausencia.
      expect(String(T.es[k]), `es.${k}`).toMatch(/no quiere decir|no puedo decir|probá de nuevo|solo que desde acá no puedo/);
      expect(String(T.en[k]), `en.${k}`).toMatch(/doesn't mean|can't say|try again|only that I can't/);
      expect(String(T.es[k]), `es.${k}`).not.toMatch(/tampoco aparece|para siempre|nunca existió|no existe\./i);
      expect(String(T.en[k]), `en.${k}`).not.toMatch(/doesn't show up|forever|never existed|doesn't exist\./i);
    }
    // La ventana vencida y el 404 hablan de lo que la fuente ya no guarda, cada una a su manera.
    expect(T.es.vHistWhyWindow).toMatch(/ya no guarda operaciones tan antiguas/);
    expect(T.en.vHistWhyWindow).toMatch(/no longer keeps operations that old/);
    expect(T.es.vHistWhyNone).toMatch(/ya no la guarde|enlace tenga un error/);
    expect(T.en.vHistWhyNone).toMatch(/no longer keep it|link may have a mistake/);
  });

  it("el verde por historial dice que el número de sorteo del enlace no se comprueba, y cómo se reconoce el sorteo", () => {
    for (const k of ["vVerdictOkHistoryDetail", "vVerdictOkHistoryDetailTest"]) {
      expect(String(T.es[k]), k).toMatch(/\{c\}/);
      expect(String(T.es[k]), k).toMatch(/número de sorteo que trae el enlace no se puede comprobar/);
      expect(String(T.en[k]), k).toMatch(/\{c\}/);
      expect(String(T.en[k]), k).toMatch(/draw number in the link can't be checked/);
    }
  });

  it("el verde por historial dice de dónde sale: el historial público de Stellar, la fecha del sello y que el número salió después", () => {
    expect(T.es.vVerdictOkHistoryDetail).toMatch(/historial público de Stellar.*\{f\}.*número público salió después/);
    expect(T.en.vVerdictOkHistoryDetail).toMatch(/public history.*\{f\}.*public number came out after/);
    // En testnet se dice que se borra: el historial de esa red también.
    expect(T.es.vVerdictOkHistoryDetailTest).toMatch(/16 de diciembre de 2026/);
    expect(T.en.vVerdictOkHistoryDetailTest).toMatch(/December 16, 2026/);
  });
});

const proof: Proof = {
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: vectors.quicknet.round,
  net: "testnet",
  contract: "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH",
  id: "936",
  stx: "ab".repeat(32),
};
const contrato = contratoOficial("testnet", proof.contract as string);
const sello: SelloDelHistorial = {
  hash: proof.stx as string,
  hashInterior: proof.stx as string,
  contractId: proof.contract as string,
  organizer: "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY",
  listHash: vectors.list_hash,
  count: vectors.count,
  numWinners: 1,
  round: vectors.quicknet.round,
  meta: "Una polera",
  closedAt: 1_792_930_947,
  ledger: 5_381_472,
};

/** Una revisión armada a mano, solo con lo que leen los textos. */
function revision(cambios: Partial<Revision> = {}): Revision {
  return {
    veredicto: "mal",
    motivos: [],
    falta: null,
    ancla: { tipo: "oficial", contrato: contrato as NonNullable<typeof contrato>, id: "936" },
    nombres: [...vectors.list],
    huella: vectors.list_hash,
    ronda: vectors.quicknet.round,
    firma: null,
    firmaOk: false,
    semilla: null,
    k: 1,
    ganadores: [],
    registro: null,
    fuente: "estado",
    historial: null,
    ...cambios,
  };
}

describe("el porqué y el detalle técnico de cada motivo", () => {
  it("cada motivo tiene su titular y su explicación, y las dos son claves que existen", () => {
    for (const m of MOTIVOS) {
      const { titulo, detalle } = porQueNoCuadra({ motivos: [m] });
      for (const k of [titulo, detalle]) {
        expect(typeof T.es[k], `${m} → ${k}`).toBe("string");
        expect(typeof T.en[k], `${m} → ${k}`).toBe("string");
      }
    }
  });

  it("los motivos del historial no caen en el texto genérico", () => {
    expect(porQueNoCuadra({ motivos: ["sello-invalido"] }).detalle).toBe("vHistInvalidDetail");
    expect(porQueNoCuadra({ motivos: ["historial-distinto"] }).detalle).toBe("vHistDistinctDetail");
  });

  it("cada motivo tiene su línea técnica, sin marcadores sin llenar", () => {
    const h: LecturaDelHistorial = { ok: true, sello };
    for (const m of MOTIVOS) {
      const lineas = detalleTecnico(revision({ motivos: [m] as Motivo[], historial: h }), proof);
      expect(lineas, m).toHaveLength(1);
      expect(lineas[0], m).toBeTruthy();
      expect(lineas[0], m).not.toMatch(/[{}]/);
    }
  });

  it("una transacción que falló y una que no es un sello se cuentan distinto, con el hash de la que cita el enlace", () => {
    const fallo = detalleTecnico(revision({ motivos: ["sello-invalido"], historial: { ok: false, error: "fallida" } }), proof);
    const otra = detalleTecnico(revision({ motivos: ["sello-invalido"], historial: { ok: false, error: "no-es-un-sello" } }), proof);
    expect(fallo[0]).toMatch(/falló/);
    expect(otra[0]).toMatch(/no es una llamada a seal/);
    for (const l of [fallo[0], otra[0]]) expect(l).toContain(proof.stx);
  });

  it("un contrato retirado por historial habla del ledger del último sello oficial, no del número", () => {
    const porNumero = detalleTecnico(revision({ motivos: ["contrato-retirado"] }), proof);
    expect(porNumero[0]).toContain("936");
    const porHistorial = detalleTecnico(revision({ motivos: ["contrato-retirado"], historial: { ok: false, error: "contrato-ajeno", retirado: true } }), proof);
    expect(porHistorial[0]).toContain(String(contrato?.ultimoLedger));
    expect(porHistorial[0]).toContain(proof.stx);
  });

  it("un contrato ajeno que sale del historial no acusa al contrato del enlace, que es oficial", () => {
    const enlace = detalleTecnico(revision({ motivos: ["contrato-ajeno"], ancla: { tipo: "ajeno", red: "testnet", contrato: "CAJENO" } }), { ...proof, contract: "CAJENO" });
    expect(enlace[0]).toContain("CAJENO");
    const historial = detalleTecnico(revision({ motivos: ["contrato-ajeno"] }), proof);
    expect(historial[0]).toContain(proof.stx);
    expect(historial[0]).not.toContain(proof.contract);
  });

  it("el estado y el historial que no coinciden dicen en qué campos", () => {
    const delContrato = {
      id: "936",
      organizer: sello.organizer,
      listHash: sello.listHash,
      count: sello.count,
      numWinners: 3,
      round: sello.round + 3,
      sealedAt: sello.closedAt,
      sealedLedger: sello.ledger,
      meta: sello.meta,
      drawn: true,
    };
    const l = detalleTecnico(revision({ motivos: ["historial-distinto"], registro: { wasm: null, siguiente: null, sello: delContrato, resultado: null }, historial: { ok: true, sello } }), proof);
    expect(l[0]).toContain("num_winners");
    expect(l[0]).toContain("round");
    expect(l[0]).not.toContain("count");
    // Sin sello en el estado, lo que no coincide es de qué contrato es la transacción.
    const otro = detalleTecnico(revision({ motivos: ["historial-distinto"], historial: { ok: true, sello: { ...sello, contractId: "COTRO" } } }), proof);
    expect(otro[0]).toContain("COTRO");
    expect(otro[0]).toContain(String(proof.contract));
  });

  it("los datos de un sello leído del historial se usan en las líneas de lo que no cuadra", () => {
    const r = revision({ motivos: ["lista-cambiada", "cantidad", "ronda", "ronda-temprana"], fuente: "historial", historial: { ok: true, sello: { ...sello, closedAt: 1_000 } } });
    const l = detalleTecnico(r, { ...proof, round: 7 });
    expect(l[0]).toContain(sello.listHash);
    expect(l[1]).toContain(String(sello.count));
    expect(l[2]).toContain(String(sello.round));
    expect(l[3]).toContain(String(sello.round));
  });
});

describe("por qué el historial no pudo confirmar un sorteo", () => {
  it("cada razón tiene su propio texto, y lo que no se sabe (sin lectura, un error nuevo) cae en el de la red", () => {
    const de = (h: LecturaDelHistorial | null) => porQueSinHistorial({ historial: h });
    expect(de({ ok: false, error: "red-caida" })).toBe("vHistWhyDown");
    expect(de({ ok: false, error: "respuesta-invalida" })).toBe("vHistWhyOdd");
    expect(de({ ok: false, error: "fuera-de-ventana" })).toBe("vHistWhyWindow");
    expect(de({ ok: false, error: "no-encontrada" })).toBe("vHistWhyNone");
    expect(de(null)).toBe("vHistWhyDown");
    // El 410 no se cuenta como "probá de nuevo en un rato" (la razón de la red) ni como "no existe".
    expect(de({ ok: false, error: "fuera-de-ventana" })).not.toBe(de({ ok: false, error: "red-caida" }));
    expect(de({ ok: false, error: "fuera-de-ventana" })).not.toBe(de({ ok: false, error: "no-encontrada" }));
  });
});

describe("el detalle de un verde por historial", () => {
  it("dice la transacción, el ledger, la hora del cierre y el contrato, el número que figura en el comprobante, y lo que ese camino no revisa", () => {
    const l = detalleDelHistorial(revision({ veredicto: "verde", fuente: "historial", historial: { ok: true, sello } }), proof);
    expect(l).toHaveLength(4);
    expect(l[0]).toContain(sello.hash);
    expect(l[0]).toContain("5381472");
    expect(l[0]).toContain("2026-10-25T12:22:27");
    expect(l[0]).toContain(sello.contractId);
    // El número del enlace va como lo que es: el que figura en el comprobante, sin comprobar.
    expect(l[1]).toMatch(/Número que figura en el comprobante: #936/);
    expect(l[1]).toMatch(/no se comprueba/);
    expect(l[2]).toMatch(/otros sellos/);
    // Una sola fuente, dicho.
    expect(l[3]).toMatch(/una sola fuente/);
    expect(l.join()).not.toMatch(/[{}]/);
  });

  it("sin el comprobante a mano no se nombra ningún número", () => {
    const l = detalleDelHistorial(revision({ veredicto: "verde", fuente: "historial", historial: { ok: true, sello } }));
    expect(l).toHaveLength(3);
    expect(l.join()).not.toMatch(/#936/);
  });

  it("el código del sello son los ocho primeros caracteres del hash de la transacción interior", () => {
    expect(codigoDelSello({ hashInterior: "5c1eaa8e1a6582d0ab4978b440753723f8643d3e5121390e71aa44b3eeacd951" })).toBe("5c1eaa8e");
    // Con un fee-bump, el que se muestra es el de la interior, cite el que cite el enlace.
    expect(codigoDelSello({ hashInterior: "65060673".padEnd(64, "0") })).toBe("65060673");
  });

  it("de un verde por el estado no hay nada que agregar", () => {
    expect(detalleDelHistorial(revision({ veredicto: "verde", fuente: "estado", historial: { ok: true, sello } }))).toEqual([]);
    expect(detalleDelHistorial(revision({ veredicto: "falta", fuente: "estado", historial: { ok: false, error: "red-caida" } }))).toEqual([]);
  });
});
