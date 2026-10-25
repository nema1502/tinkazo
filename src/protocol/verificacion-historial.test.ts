import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { verifyRound } from "./drand";
import { PROOF_VERSION, type Proof } from "./proof";
import { roundTime } from "./quicknet";
import {
  ESPERA_DEL_HISTORIAL_CON_ESTADO_MS,
  MIN_LEAD_SECS,
  type Dependencias,
  type Registro,
  premioDe,
  revisarComprobante,
} from "./verificacion";
import { leerHistorial, type LecturaDelHistorial, type SelloDelHistorial } from "../stellar/historial";
import { horizonFalso } from "../stellar/horizon-falso";
import realUltimoDel936 from "../stellar/fixtures/horizon-b5075505.json";
import realUnicoDelOtro from "../stellar/fixtures/horizon-2d6b998c.json";

/**
 * La verificación por el historial de transacciones (docs/protocolo.md §7.1).
 *
 * El estado del contrato vence; la transacción del sello, no. Con el hash del sello
 * en el comprobante (`stx`) y el estado sin el sorteo, el sello se lee del historial
 * y pasa por las mismas comprobaciones. Con el estado a mano, manda el estado. La
 * cadena, el historial y el faro son de mentira (las dependencias); la firma, la
 * huella y la selección son las de verdad, con los vectores de docs/vectors.json.
 * Al final, dos sorteos reales de contratos anteriores de testnet, con sus
 * respuestas de Horizon grabadas, su firma de drand y sus ganadores de la cadena.
 */

const { round: R, signature: FIRMA, randomness: SEMILLA } = vectors.quicknet;
const TESTNET = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const WASM_TESTNET = "c2403e081fc2d91ee86ea5faf58861e2d91d38f4846585b4f08ad215d85a546e";
const ANTERIOR = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";
const ANTERIOR_VIEJO = "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ";
const ORGANIZADOR = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const STX = "ab".repeat(32);
const GANADORES = vectors.cases.find((c) => c.k === 3)?.winners as number[];
const OTRA_FIRMA = "8d2c0e2b0d9a1b0f6f2b7d6f0f4b7c8f9a8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1";

const comprobante = (extra: Partial<Proof> = {}): Proof => ({
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: R,
  signature: FIRMA,
  sealedAt: roundTime(R) - 60,
  net: "testnet",
  contract: TESTNET,
  id: "4",
  stx: STX,
  ...extra,
});

/** Lo que leería el historial de la transacción de un sello de verdad con esta lista, esta ronda y tres ganadores. */
const sello = (cambios: Partial<SelloDelHistorial> = {}): SelloDelHistorial => ({
  hash: STX,
  hashInterior: STX,
  contractId: TESTNET,
  organizer: ORGANIZADOR,
  listHash: vectors.list_hash,
  count: vectors.count,
  numWinners: 3,
  round: R,
  meta: "Una polera",
  closedAt: roundTime(R) - 60,
  ledger: 5_000_000,
  ...cambios,
});
const lectura = (cambios: Partial<SelloDelHistorial> = {}): LecturaDelHistorial => ({ ok: true, sello: sello(cambios) });

type Parcial<T> = { [K in keyof T]?: T[K] | null };
/** El estado de un sorteo con esa lista, esa ronda y tres ganadores, cuando el contrato todavía lo tiene. */
const estado = (cambios: { sello?: Parcial<NonNullable<Registro["sello"]>> | null; resultado?: Partial<NonNullable<Registro["resultado"]>> | null } = {}): Registro => ({
  wasm: WASM_TESTNET,
  siguiente: 10,
  sello:
    cambios.sello === null
      ? null
      : ({
          id: "4",
          organizer: ORGANIZADOR,
          listHash: vectors.list_hash,
          count: vectors.count,
          numWinners: 3,
          round: R,
          sealedAt: roundTime(R) - 60,
          sealedLedger: 5_000_000,
          meta: "Una polera",
          drawn: true,
          ...cambios.sello,
        } as NonNullable<Registro["sello"]>),
  resultado:
    cambios.resultado === null
      ? null
      : {
          raffleId: "4",
          round: R,
          signature: FIRMA,
          randomness: SEMILLA,
          winners: [...GANADORES],
          drawnAt: roundTime(R) + 5,
          ...cambios.resultado,
        },
});
/** El estado cuando el sorteo ya no está: la entrada archivada (instancia viva) o la instancia ausente. */
const archivado = (): Registro => ({ wasm: WASM_TESTNET, siguiente: 10, sello: null, resultado: null });
const sinInstancia = (): Registro => ({ wasm: null, siguiente: null, sello: null, resultado: null });

type Historial = LecturaDelHistorial | Error | Promise<LecturaDelHistorial>;
interface DepsDePrueba extends Dependencias {
  /** Lo que se pidió al historial: red y hash. */
  historias: Array<[string, string]>;
  leidas: string[];
}
/** Las dependencias de mentira. Sin `historial`, ni siquiera existe `leerHistorial`. */
function deps(reg: Registro | Error, historial?: Historial, faro: string | Error = FIRMA): DepsDePrueba {
  const historias: Array<[string, string]> = [];
  const leidas: string[] = [];
  return {
    historias,
    leidas,
    verificarFirma: async (r, s) => verifyRound(r, s),
    traerFirma: async () => {
      if (faro instanceof Error) throw faro;
      return faro;
    },
    leerRegistro: async (c, id) => {
      leidas.push(`${c.red}:${c.contractId}:${id}`);
      if (reg instanceof Error) throw reg;
      return reg;
    },
    ...(historial === undefined
      ? {}
      : {
          leerHistorial: async (red: string, hash: string) => {
            historias.push([red, hash]);
            if (historial instanceof Error) throw historial;
            return historial;
          },
        }),
  };
}

describe("verde por el historial, cuando el estado del contrato ya no tiene el sorteo", () => {
  it("la instancia ya no está: con el hash del sello da verde y los ganadores son los de siempre", async () => {
    const d = deps(sinInstancia(), lectura());
    const r = await revisarComprobante(comprobante(), d);
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("historial");
    expect(r.motivos).toEqual([]);
    expect(r.falta).toBeNull();
    expect(r.ganadores).toEqual(GANADORES);
    expect(r.k).toBe(3);
    expect(r.ronda).toBe(R);
    expect(r.historial).toEqual(lectura());
    expect(d.historias).toEqual([["testnet", STX]]);
    // El premio sale de la transacción del sello, no del enlace.
    expect(premioDe(r, "Un auto 0 km", ["Sorteo de comunidad"])).toBe("Una polera");
    expect(premioDe({ ...r, historial: lectura({ meta: "Sorteo de comunidad" }) }, "Un auto 0 km", ["Sorteo de comunidad"])).toBe("");
  });

  it("la entrada archivada, con la instancia viva: lo mismo", async () => {
    const r = await revisarComprobante(comprobante(), deps(archivado(), lectura()));
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("historial");
    expect(r.ganadores).toEqual(GANADORES);
  });

  it("no hay un resultado grabado que esperar: el ganador sale de la firma de la ronda, y por eso no es 'pendiente'", async () => {
    const r = await revisarComprobante(comprobante(), deps(sinInstancia(), lectura()));
    expect(r.registro?.resultado).toBeNull();
    expect(r.veredicto).toBe("verde");
  });

  it("sin la firma en el enlace, la trae del faro y se comprueba igual", async () => {
    const { signature: _s, ...sinFirma } = comprobante();
    const r = await revisarComprobante(sinFirma as Proof, deps(sinInstancia(), lectura()));
    expect(r.veredicto).toBe("verde");
    const mala = await revisarComprobante(sinFirma as Proof, deps(sinInstancia(), lectura(), OTRA_FIRMA));
    expect(mala.veredicto).toBe("mal");
    expect(mala.motivos).toContain("firma");
  });

  it("el sello vence antes que el resultado: si queda el resultado, tiene que coincidir con lo que se rehace", async () => {
    const bien = await revisarComprobante(comprobante(), deps(estado({ sello: null }), lectura()));
    expect(bien.veredicto).toBe("verde");
    expect(bien.fuente).toBe("historial");
    const otrosGanadores = await revisarComprobante(comprobante(), deps(estado({ sello: null, resultado: { winners: [0, 1, 2] } }), lectura()));
    expect(otrosGanadores.veredicto).toBe("mal");
    expect(otrosGanadores.motivos).toContain("ganadores");
    const otraSemilla = await revisarComprobante(comprobante(), deps(estado({ sello: null, resultado: { randomness: "00".repeat(32) } }), lectura()));
    expect(otraSemilla.motivos).toContain("semilla");
    const otraFirma = await revisarComprobante(comprobante(), deps(estado({ sello: null, resultado: { signature: OTRA_FIRMA } }), lectura()));
    expect(otraFirma.motivos).toContain("firma-registro");
  });

  it("los ganadores que se rehacen son los que dice la transacción: uno solo con numWinners 1", async () => {
    const r = await revisarComprobante(comprobante(), deps(sinInstancia(), lectura({ numWinners: 1 })));
    expect(r.veredicto).toBe("verde");
    expect(r.k).toBe(1);
    expect(r.ganadores).toEqual([4]);
  });
});

describe("el historial pasa por las mismas comprobaciones que el estado", () => {
  const rojo = async (cambios: Partial<SelloDelHistorial>, p: Proof = comprobante()) => revisarComprobante(p, deps(sinInstancia(), lectura(cambios)));

  it("la lista tiene que ser exactamente la sellada: un nombre cambiado no pasa", async () => {
    const names = [...vectors.list];
    names[3] = "Otra Persona";
    const r = await revisarComprobante(comprobante({ names }), deps(sinInstancia(), lectura()));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("lista-cambiada");
    // Y con la huella de otra lista en la transacción.
    expect((await rojo({ listHash: "00".repeat(32) })).motivos).toContain("lista-cambiada");
  });

  it("la cantidad de gente tiene que ser la de la lista", async () => {
    const r = await rojo({ count: 10 });
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("cantidad");
  });

  it("la ronda del enlace tiene que ser la de la transacción", async () => {
    const r = await rojo({ round: R + 7 });
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("ronda");
    const otra = await revisarComprobante(comprobante({ round: R + 1 }), deps(sinInstancia(), lectura()));
    expect(otra.motivos).toContain("ronda");
  });

  it("ronda demasiado temprana: se compara con la hora de cierre del ledger de la transacción", async () => {
    for (const antes of [MIN_LEAD_SECS - 1, 1, 0, -60]) {
      const r = await rojo({ closedAt: roundTime(R) - antes });
      expect(r.veredicto, String(antes)).toBe("mal");
      expect(r.motivos, String(antes)).toContain("ronda-temprana");
    }
    // Justo los 30 segundos que exige el contrato: pasa.
    expect((await rojo({ closedAt: roundTime(R) - MIN_LEAD_SECS })).veredicto).toBe("verde");
  });

  it("la cantidad de ganadores tiene que caber en la lista", async () => {
    for (const numWinners of [0, vectors.count + 1, 33]) {
      const r = await rojo({ numWinners });
      expect(r.veredicto, String(numWinners)).toBe("mal");
      expect(r.motivos, String(numWinners)).toContain("registro-incoherente");
    }
  });

  it("un sello de otro contrato oficial no es el sello de este comprobante", async () => {
    const r = await rojo({ contractId: ANTERIOR });
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toEqual(["historial-distinto"]);
  });

  it("una firma que no es la de la ronda es roja, también por el historial", async () => {
    const r = await revisarComprobante(comprobante({ signature: OTRA_FIRMA }), deps(sinInstancia(), lectura()));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("firma");
  });

  it("la ronda que todavía no salió no da verde ni rojo: no hay firma que comprobar", async () => {
    const { signature: _s, ...sinFirma } = comprobante();
    const r = await revisarComprobante(sinFirma as Proof, deps(sinInstancia(), lectura(), new Error("la ronda no salió")));
    expect(r.veredicto).toBe("sin-red");
    expect(r.falta).toBe("sin-ronda");
    expect(r.ganadores).toEqual([]);
  });
});

describe("sin el testigo del historial, el resultado es el de siempre y nunca verde", () => {
  it("sin el hash del sello en el comprobante no se pregunta nada y queda 'no está'", async () => {
    const { stx: _x, ...sinStx } = comprobante();
    const d = deps(sinInstancia(), lectura());
    const r = await revisarComprobante(sinStx as Proof, d);
    expect(r.veredicto).toBe("falta");
    expect(r.falta).toBe("sin-contrato");
    expect(r.fuente).toBe("estado");
    expect(r.historial).toBeNull();
    expect(d.historias).toEqual([]);
    const archivada = await revisarComprobante(sinStx as Proof, deps(archivado(), lectura()));
    expect(archivada.veredicto).toBe("falta");
    expect(archivada.falta).toBe("sin-sello");
  });

  it("un hash que no tiene la forma de un hash es como no traerlo", async () => {
    for (const stx of ["", "abc", "zz".repeat(32), `${STX}0`, 5, null, ["a"]] as unknown[]) {
      const d = deps(sinInstancia(), lectura());
      const r = await revisarComprobante(comprobante({ stx } as Partial<Proof>), d);
      expect(r.veredicto, JSON.stringify(stx)).toBe("falta");
      expect(d.historias, JSON.stringify(stx)).toEqual([]);
    }
  });

  it("sin la dependencia del historial (un llamador viejo) todo queda como antes", async () => {
    const r = await revisarComprobante(comprobante(), deps(sinInstancia()));
    expect(r.veredicto).toBe("falta");
    expect(r.fuente).toBe("estado");
  });

  it("el historial que no se pudo leer (sin red, una respuesta rara, una ventana vencida o una transacción que no conoce): no confirmado, nunca 'no está' ni rojo", async () => {
    const errores: LecturaDelHistorial[] = [
      { ok: false, error: "red-caida" },
      { ok: false, error: "no-encontrada" },
      { ok: false, error: "respuesta-invalida" },
      { ok: false, error: "fuera-de-ventana" },
    ];
    for (const e of errores) {
      for (const [nombre, reg] of [["sin instancia", sinInstancia()], ["archivado", archivado()]] as const) {
        const r = await revisarComprobante(comprobante(), deps(reg, e));
        expect(r.veredicto, `${nombre} ${e.ok ? "" : e.error}`).toBe("sin-red");
        expect(r.falta).toBe("sin-historial");
        expect(r.fuente).toBe("estado");
        expect(r.motivos).toEqual([]);
        expect(r.historial).toEqual(e);
      }
    }
    // Y si la dependencia lanza, cuenta como historial caído.
    const lanza = await revisarComprobante(comprobante(), deps(sinInstancia(), new Error("boom")));
    expect(lanza.veredicto).toBe("sin-red");
    expect(lanza.falta).toBe("sin-historial");
    expect(lanza.historial).toEqual({ ok: false, error: "red-caida" });
  });

  it("una transacción que no es un sello del sitio es roja: falló, llama a otra función o es de un contrato ajeno", async () => {
    for (const error of ["fallida", "no-es-un-sello"] as const) {
      const r = await revisarComprobante(comprobante(), deps(sinInstancia(), { ok: false, error }));
      expect(r.veredicto, error).toBe("mal");
      expect(r.motivos, error).toEqual(["sello-invalido"]);
    }
    const ajeno = await revisarComprobante(comprobante(), deps(sinInstancia(), { ok: false, error: "contrato-ajeno" }));
    expect(ajeno.veredicto).toBe("mal");
    expect(ajeno.motivos).toEqual(["contrato-ajeno"]);
  });

  it("un sello de un contrato anterior posterior a su último sello oficial es 'retirado'; sin tope, no se acepta pero no se acusa", async () => {
    const retirado = await revisarComprobante(comprobante(), deps(sinInstancia(), { ok: false, error: "contrato-ajeno", retirado: true }));
    expect(retirado.veredicto).toBe("mal");
    expect(retirado.motivos).toEqual(["contrato-retirado"]);
    const sinTope = await revisarComprobante(comprobante(), deps(sinInstancia(), { ok: false, error: "contrato-ajeno", sinTope: true }));
    expect(sinTope.veredicto).toBe("falta");
    expect(sinTope.motivos).toEqual([]);
  });

  it("si no se pudo leer el estado, el historial no lo reemplaza: queda 'sin red'", async () => {
    const d = deps(new Error("sin red"), lectura());
    const r = await revisarComprobante(comprobante(), d);
    expect(r.veredicto).toBe("sin-red");
    expect(r.falta).toBe("sin-cadena");
    expect(r.fuente).toBe("estado");
    expect(r.historial).toBeNull();
  });

  it("un código ajeno o un número que el contrato nunca dio es rojo, y el historial no lo arregla", async () => {
    // El historial se pide a la vez que el estado: si el estado deja algo mal, su lectura se descarta.
    const d1 = deps({ wasm: "766877a896b518ea81012e693d938a2f331d52c2d236c04bcbac3810b0735ed0", siguiente: null, sello: null, resultado: null }, lectura());
    const ajeno = await revisarComprobante(comprobante(), d1);
    expect(ajeno.veredicto).toBe("mal");
    expect(ajeno.motivos).toContain("codigo-ajeno");
    expect(ajeno.fuente).toBe("estado");
    expect(ajeno.historial).toBeNull();
    const d2 = deps(archivado(), lectura());
    const nunca = await revisarComprobante(comprobante({ id: "4000" }), d2);
    expect(nunca.veredicto).toBe("mal");
    expect(nunca.motivos).toContain("numero-inexistente");
    expect(nunca.fuente).toBe("estado");
    expect(nunca.historial).toBeNull();
  });

  it("lo que no está anclado en un contrato oficial no pregunta por el historial", async () => {
    const casos: Array<[string, Proof]> = [
      ["libre", { v: PROOF_VERSION, names: [...vectors.list], round: R, signature: FIRMA, stx: STX }],
      ["ajeno", comprobante({ contract: "CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3" })],
      ["otra red", comprobante({ net: "mainnet" })],
      ["deforme", comprobante({ id: "04" })],
    ];
    for (const [nombre, p] of casos) {
      const d = deps(sinInstancia(), lectura());
      await revisarComprobante(p, d);
      expect(d.historias, nombre).toEqual([]);
    }
  });

  it("nunca lanza, ni con un hash raro dentro de un comprobante de cualquier forma", async () => {
    const raros = [
      comprobante({ stx: { toString: () => { throw new Error("no me conviertas"); } } as unknown as string }),
      comprobante({ stx: undefined }),
    ];
    for (const p of raros) {
      const r = await revisarComprobante(p, deps(sinInstancia(), lectura()));
      expect(["falta", "verde"]).toContain(r.veredicto);
    }
  });
});

describe("con el estado a mano, manda el estado; si el historial dice otra cosa, es rojo", () => {
  it("si coinciden, es verde por el estado y el historial queda como cruce", async () => {
    const d = deps(estado(), lectura());
    const r = await revisarComprobante(comprobante(), d);
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("estado");
    expect(r.motivos).toEqual([]);
    expect(r.historial?.ok).toBe(true);
    expect(d.historias).toEqual([["testnet", STX]]);
    expect(r.ganadores).toEqual(GANADORES);
  });

  it("el cruce no cambia lo de antes: un sorteo pendiente sigue pendiente y un registro roto sigue roto", async () => {
    const pendiente = await revisarComprobante(comprobante(), deps(estado({ sello: { drawn: false }, resultado: null }), lectura()));
    expect(pendiente.veredicto).toBe("pendiente");
    const roto = await revisarComprobante(comprobante(), deps(estado({ sello: { count: 10 } }), lectura({ count: 10 })));
    expect(roto.veredicto).toBe("mal");
    expect(roto.motivos).toContain("cantidad");
  });

  it("si el estado y el historial no cuentan lo mismo del sello, es rojo, en cada dato", async () => {
    const cambios: Array<[string, Partial<SelloDelHistorial>]> = [
      ["quién selló", { organizer: "GA3TE4A6H6DO56YG2NSTR3PCS7EOFVXSMRANPEWOS5J3PNAU7JFA4CIM" }],
      ["la huella", { listHash: "11".repeat(32) }],
      ["la cantidad de gente", { count: vectors.count + 1 }],
      ["los ganadores", { numWinners: 2 }],
      ["la ronda", { round: R + 3 }],
      ["la hora del sello", { closedAt: roundTime(R) - 90 }],
      ["el ledger", { ledger: 5_000_001 }],
      ["el premio", { meta: "Un auto 0 km" }],
      ["el contrato", { contractId: ANTERIOR }],
    ];
    for (const [que, c] of cambios) {
      const r = await revisarComprobante(comprobante(), deps(estado(), lectura(c)));
      expect(r.veredicto, que).toBe("mal");
      expect(r.motivos, que).toEqual(["historial-distinto"]);
    }
  });

  it("si el estado no trae el ledger (un contrato que no lo guarda), ese dato no se cruza", async () => {
    const r = await revisarComprobante(comprobante(), deps(estado({ sello: { sealedLedger: undefined } }), lectura({ ledger: 123 })));
    expect(r.veredicto).toBe("verde");
  });

  it("un hash que apunta a una transacción que no es un sello es rojo aunque el estado esté bien", async () => {
    for (const error of ["fallida", "no-es-un-sello"] as const) {
      const r = await revisarComprobante(comprobante(), deps(estado(), { ok: false, error }));
      expect(r.veredicto, error).toBe("mal");
      expect(r.motivos, error).toEqual(["sello-invalido"]);
    }
    const ajeno = await revisarComprobante(comprobante(), deps(estado(), { ok: false, error: "contrato-ajeno" }));
    expect(ajeno.motivos).toEqual(["contrato-ajeno"]);
  });

  it("un historial caído, sin noticias o que contesta cualquier cosa no cambia el veredicto del estado", async () => {
    const callado: LecturaDelHistorial[] = [
      { ok: false, error: "red-caida" },
      { ok: false, error: "no-encontrada" },
      { ok: false, error: "respuesta-invalida" },
      { ok: false, error: "contrato-ajeno", sinTope: true },
    ];
    for (const e of callado) {
      const r = await revisarComprobante(comprobante(), deps(estado(), e));
      expect(r.veredicto, JSON.stringify(e)).toBe("verde");
      expect(r.fuente).toBe("estado");
    }
    const lanza = await revisarComprobante(comprobante(), deps(estado(), new Error("boom")));
    expect(lanza.veredicto).toBe("verde");
  });

  it("un historial lento no demora el veredicto del estado: se espera poco y sigue", async () => {
    expect(ESPERA_DEL_HISTORIAL_CON_ESTADO_MS).toBeLessThanOrEqual(5_000);
    const colgado = new Promise<LecturaDelHistorial>(() => undefined);
    const antes = Date.now();
    const r = await revisarComprobante(comprobante(), deps(estado(), colgado), { esperaDelHistorialMs: 30 });
    expect(r.veredicto).toBe("verde");
    expect(r.historial).toBeNull();
    expect(Date.now() - antes).toBeLessThan(2_000);
  });

  it("sin el hash del sello no se cruza nada: un comprobante de antes se verifica igual que antes", async () => {
    const { stx: _x, ...sinStx } = comprobante();
    const d = deps(estado(), lectura({ count: 99 }));
    const r = await revisarComprobante(sinStx as Proof, d);
    expect(r.veredicto).toBe("verde");
    expect(d.historias).toEqual([]);
  });

  it("si ya hay algo mal en el estado, el historial no cambia el rojo ni queda en el resultado", async () => {
    const d = deps(estado({ sello: { listHash: "11".repeat(32) } }), lectura());
    const r = await revisarComprobante(comprobante(), d);
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toEqual(["lista-cambiada"]);
    expect(r.historial).toBeNull();
  });

  it("el estado y el historial se piden a la vez, no uno después del otro", async () => {
    // Si se pidieran en serie, el historial no se llamaría hasta que el estado contestara.
    let contesta: (r: Registro) => void = () => undefined;
    const estadoLento = new Promise<Registro>((res) => {
      contesta = res;
    });
    let estadoYaContesto = false;
    const historialLlamadoCon: boolean[] = [];
    const d: Dependencias = {
      verificarFirma: async (r, s) => verifyRound(r, s),
      traerFirma: async () => FIRMA,
      leerRegistro: async () => {
        const r = await estadoLento;
        estadoYaContesto = true;
        return r;
      },
      leerHistorial: async () => {
        historialLlamadoCon.push(estadoYaContesto);
        return lectura();
      },
    };
    const pendiente = revisarComprobante(comprobante(), d);
    await new Promise((r) => setTimeout(r, 20));
    expect(historialLlamadoCon).toEqual([false]);
    contesta(estado());
    const r = await pendiente;
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("estado");
    expect(r.historial?.ok).toBe(true);
  });

  it("pedirlos a la vez no cambia el resultado: manda el estado, el historial cruza, discrepar es rojo y fallar no cambia un verde", async () => {
    const delEstado = await revisarComprobante(comprobante(), deps(estado(), lectura()));
    expect(delEstado.veredicto).toBe("verde");
    expect(delEstado.fuente).toBe("estado");
    const discrepa = await revisarComprobante(comprobante(), deps(estado(), lectura({ count: vectors.count + 1 })));
    expect(discrepa.veredicto).toBe("mal");
    expect(discrepa.motivos).toEqual(["historial-distinto"]);
    for (const e of ["red-caida", "respuesta-invalida", "no-encontrada", "fuera-de-ventana"] as const) {
      const r = await revisarComprobante(comprobante(), deps(estado(), { ok: false, error: e }));
      expect(r.veredicto, e).toBe("verde");
      expect(r.fuente, e).toBe("estado");
    }
  });
});

/**
 * Dos sorteos de verdad de los contratos anteriores de testnet, con la lista de
 * ejemplo de `docs/vectors.json`: la transacción del sello es la respuesta de
 * Horizon grabada el 25 de octubre de 2026 (`fixtures/`), la firma es la que publicó
 * drand para esa ronda y los ganadores son los que guardó el contrato en su `Draw`
 * (leídos de la cadena ese día). Todo corre sin red, con la cuenta BLS de verdad.
 */
describe("sorteos reales de testnet, verificados solo con el historial", () => {
  // `get_draw(936)` de CD2SSHBU…: ronda 33375876, un ganador.
  const FIRMA_936 = "99168536f5dcc602ef7acd40001b0fae216c9a8b1fa099a8e53ad2863058d83e5bef26a8338dcecc810511cb848d4bd5";
  // `get_draw(1)` de CDVAI2RK…: ronda 32255827, tres ganadores.
  const FIRMA_1 = "8ad29156f585b9c5bf998dff09709fc7f367a33d9e059f7f592b6b56b272b884913d12d4e999238c839e0987b719cea6";

  /** El historial de verdad: el lector real contra un Horizon que solo conoce estas respuestas. */
  const horizon = (registros: Record<string, unknown>): DepsDePrueba => {
    const h = horizonFalso(registros);
    return { ...deps(sinInstancia()), leerHistorial: (red, hash) => leerHistorial(red, hash, { fetch: h.fetch, esperaMs: 0 }) };
  };
  const proof936 = (extra: Partial<Proof> = {}): Proof => ({
    v: PROOF_VERSION,
    names: [...vectors.list],
    round: 33_375_876,
    signature: FIRMA_936,
    net: "testnet",
    contract: ANTERIOR,
    id: "936",
    stx: realUltimoDel936.hash,
    ...extra,
  });

  it("el último sello del contrato anterior (el #936), que cae justo en su ultimoLedger, da verde y el mismo ganador que grabó la cadena", async () => {
    const r = await revisarComprobante(proof936(), horizon({ [realUltimoDel936.hash]: realUltimoDel936 }));
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("historial");
    expect(r.motivos).toEqual([]);
    expect(r.ganadores).toEqual([14]);
    expect(r.nombres[14]).toBe("Paola Mendoza");
    expect(r.semilla).toBe("548be1a509b2c384921de6be63eb4de725802971af1d62c2bef54e8ddc9778b7");
    expect(r.historial).toMatchObject({ ok: true, sello: { ledger: 5_381_472, closedAt: 1_792_930_947, numWinners: 1, count: 18 } });
  });

  it("el único sorteo del otro contrato anterior (el #1), con tres ganadores", async () => {
    const p: Proof = { ...proof936(), round: 32_255_827, signature: FIRMA_1, contract: ANTERIOR_VIEJO, id: "1", stx: realUnicoDelOtro.hash };
    const r = await revisarComprobante(p, horizon({ [realUnicoDelOtro.hash]: realUnicoDelOtro }));
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("historial");
    expect(r.ganadores).toEqual([11, 16, 0]);
    expect(r.k).toBe(3);
  });

  it("la misma transacción un ledger después del último sello oficial ya no es un sorteo de Tinkazo", async () => {
    const tarde = { ...realUltimoDel936, ledger: realUltimoDel936.ledger + 1 };
    const r = await revisarComprobante(proof936(), horizon({ [tarde.hash]: tarde }));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toEqual(["contrato-retirado"]);
  });

  it("citar la transacción de un contrato con el comprobante de otro no vale", async () => {
    const r = await revisarComprobante(proof936({ contract: ANTERIOR_VIEJO, id: "1" }), horizon({ [realUltimoDel936.hash]: realUltimoDel936 }));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toEqual(["historial-distinto"]);
  });

  it("con otra lista, o con la ronda de otro sorteo, es rojo", async () => {
    const names = [...vectors.list];
    names[0] = "Alguien que no estaba";
    const lista = await revisarComprobante(proof936({ names }), horizon({ [realUltimoDel936.hash]: realUltimoDel936 }));
    expect(lista.veredicto).toBe("mal");
    expect(lista.motivos).toContain("lista-cambiada");
    const ronda = await revisarComprobante(proof936({ round: 33_375_877 }), horizon({ [realUltimoDel936.hash]: realUltimoDel936 }));
    expect(ronda.veredicto).toBe("mal");
    expect(ronda.motivos).toContain("ronda");
  });

  it("un hash que Horizon no conoce no da verde ni 'no está': no confirmado (puede que esa fuente ya no lo guarde)", async () => {
    const r = await revisarComprobante(proof936({ stx: "cd".repeat(32) }), horizon({}));
    expect(r.veredicto).toBe("sin-red");
    expect(r.falta).toBe("sin-historial");
    expect(r.historial).toEqual({ ok: false, error: "no-encontrada" });
  });
});
