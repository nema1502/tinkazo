import { describe, expect, it, vi } from "vitest";
import vectors from "../../docs/vectors.json";
import { verifyRound } from "./drand";
import { PROOF_VERSION, type Proof } from "./proof";
import { roundTime } from "./quicknet";
import {
  type Dependencias,
  MIN_LEAD_SECS,
  type Registro,
  anclaDe,
  premioDe,
  revisarComprobante,
} from "./verificacion";
import { type ContratoOficial, contratoOficial, contratosOficiales } from "../stellar/oficiales";

/**
 * Que nadie pueda falsificar un "verificado" (22 de octubre de 2026).
 *
 * Cada caso le miente a la verificación de una forma distinta, y ninguno puede
 * dar verde. La cadena y el faro son de mentira (las dependencias); la firma, la
 * huella y la selección son las de verdad, con los vectores de docs/vectors.json.
 */

const { round: R, signature: FIRMA, randomness: SEMILLA } = vectors.quicknet;
const TESTNET = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const WASM_TESTNET = "c2403e081fc2d91ee86ea5faf58861e2d91d38f4846585b4f08ad215d85a546e";
/** El contrato ajeno de la prueba de la fase 1 (scripts/check-verificacion.mjs). */
const AJENO = "CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3";
const OTRA_FIRMA = "8d2c0e2b0d9a1b0f6f2b7d6f0f4b7c8f9a8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1";
const GANADORES = vectors.cases.find((c) => c.k === 3)?.winners as number[];

const comprobante = (extra: Partial<Proof> = {}): Proof => ({
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: R,
  signature: FIRMA,
  sealedAt: roundTime(R) - 60,
  net: "testnet",
  contract: TESTNET,
  id: "4",
  ...extra,
});

/** El registro de un sorteo de verdad con esa lista, esa ronda y tres ganadores. */
const registro = (cambios: { sello?: Partial<NonNullable<Registro["sello"]>> | null; resultado?: Partial<NonNullable<Registro["resultado"]>> | null; wasm?: string | null; siguiente?: number | null } = {}): Registro => ({
  wasm: cambios.wasm === undefined ? WASM_TESTNET : cambios.wasm,
  siguiente: cambios.siguiente === undefined ? 10 : cambios.siguiente,
  sello:
    cambios.sello === null
      ? null
      : {
          id: "4",
          organizer: "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY",
          listHash: vectors.list_hash,
          count: vectors.count,
          numWinners: 3,
          round: R,
          sealedAt: roundTime(R) - 60,
          meta: "Una polera",
          drawn: true,
          ...cambios.sello,
        },
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

/** Las dependencias de mentira: la cadena devuelve `reg` (o falla) y el faro, la firma de los vectores. */
function deps(reg: Registro | Error = registro(), faro: string | Error = FIRMA): Dependencias & { leidas: string[] } {
  const leidas: string[] = [];
  return {
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
  };
}

describe("los contratos oficiales", () => {
  it("son los de deployments.json, con su .wasm, y nada más", () => {
    const todos = contratosOficiales();
    expect(todos.length).toBeGreaterThan(0);
    for (const c of todos) {
      expect(c.contractId).toMatch(/^C[A-Z2-7]{55}$/);
      expect(c.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(contratoOficial("testnet", TESTNET)?.wasmSha256).toBe(WASM_TESTNET);
    expect(contratoOficial("testnet", TESTNET)?.vigente).toBe(true);
  });

  it("no aceptan otra red, otra dirección ni la misma escrita distinto", () => {
    expect(contratoOficial("mainnet", TESTNET)).toBeNull();
    expect(contratoOficial("futurenet", TESTNET)).toBeNull();
    expect(contratoOficial("Testnet", TESTNET)).toBeNull();
    expect(contratoOficial("testnet", AJENO)).toBeNull();
    expect(contratoOficial("testnet", TESTNET.toLowerCase())).toBeNull();
    expect(contratoOficial("testnet", ` ${TESTNET}`)).toBeNull();
    expect(contratoOficial(undefined, TESTNET)).toBeNull();
  });

  it("el ancla de un comprobante: ninguna, rota, ajena u oficial", () => {
    expect(anclaDe({}).tipo).toBe("libre");
    expect(anclaDe({ net: "testnet", contract: TESTNET }).tipo).toBe("deforme");
    for (const id of ["07", "0", "-1", "4.0", "abc", "18446744073709551616", " 4"]) {
      expect(anclaDe({ net: "testnet", contract: TESTNET, id }).tipo, id).toBe("deforme");
    }
    expect(anclaDe({ net: "testnet", contract: TESTNET, id: "18446744073709551615" }).tipo).toBe("oficial");
    expect(anclaDe({ net: "testnet", contract: AJENO, id: "278" }).tipo).toBe("ajeno");
    expect(anclaDe({ net: "mainnet", contract: TESTNET, id: "278" }).tipo).toBe("ajeno");
  });
});

describe("revisar un comprobante (protocolo §7)", () => {
  it("uno de verdad da verde, y su ganador es el de los vectores", async () => {
    const r = await revisarComprobante(comprobante(), deps());
    expect(r.veredicto).toBe("verde");
    expect(r.motivos).toEqual([]);
    expect(r.ganadores).toEqual(GANADORES);
    expect(r.k).toBe(3);
    expect(premioDe(r, "Un auto 0 km", ["Sorteo de comunidad"])).toBe("Una polera");
  });

  it("sin la firma en el enlace, usa la del registro, que tiene que verificar", async () => {
    const { signature: _s, ...sinFirma } = comprobante();
    const d = deps(registro(), new Error("el faro no hace falta"));
    const r = await revisarComprobante(sinFirma as Proof, d);
    expect(r.veredicto).toBe("verde");
  });

  it("contrato ajeno: rojo, y ni siquiera se lee la cadena", async () => {
    const d = deps();
    const r = await revisarComprobante(comprobante({ contract: AJENO, id: "278" }), d);
    expect(r.veredicto).toBe("mal");
    expect(r.motivos[0]).toBe("contrato-ajeno");
    expect(d.leidas).toEqual([]);
  });

  it("red distinta: el contrato de testnet anunciado como de mainnet, o en una red que no existe", async () => {
    for (const net of ["mainnet", "futurenet", "TESTNET", ""]) {
      const d = deps();
      const r = await revisarComprobante(comprobante({ net }), d);
      expect(r.veredicto, net).toBe("mal");
      expect(d.leidas, net).toEqual([]);
    }
  });

  it(".wasm distinto: una dirección oficial que corriera otro código no vale", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ wasm: "766877a896b518ea81012e693d938a2f331d52c2d236c04bcbac3810b0735ed0" })));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos[0]).toBe("codigo-ajeno");
  });

  it("ronda distinta: el enlace dice otra ronda que la sellada", async () => {
    // La firma es la de R, que es la del sello: lo único que miente es el número del enlace.
    const r = await revisarComprobante(comprobante({ round: R + 1 }), deps());
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("ronda");
    // Y al revés: el sello es de otra ronda que la del enlace y su firma.
    const r2 = await revisarComprobante(comprobante(), deps(registro({ sello: { round: R + 7 }, resultado: { round: R + 7 } })));
    expect(r2.veredicto).toBe("mal");
    expect(r2.motivos).toEqual(expect.arrayContaining(["ronda", "firma"]));
  });

  it("ronda demasiado temprana: el número ya existía, o casi, cuando se selló", async () => {
    for (const antes of [MIN_LEAD_SECS - 1, 0, -60]) {
      const r = await revisarComprobante(comprobante(), deps(registro({ sello: { sealedAt: roundTime(R) - antes } })));
      expect(r.veredicto, String(antes)).toBe("mal");
      expect(r.motivos, String(antes)).toContain("ronda-temprana");
    }
    const justo = await revisarComprobante(comprobante(), deps(registro({ sello: { sealedAt: roundTime(R) - MIN_LEAD_SECS } })));
    expect(justo.veredicto).toBe("verde");
  });

  it("randomness distinto: el registro dice otra semilla que la de la firma", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ resultado: { randomness: "00".repeat(32) } })));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("semilla");
  });

  it("firma distinta en el registro", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ resultado: { signature: OTRA_FIRMA } })));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("firma-registro");
  });

  it("count distinto: sellado con menos gente que la lista, para que los últimos no puedan ganar", async () => {
    // Lo que haría el contrato con count 10: los ganadores salen de los diez primeros.
    const r = await revisarComprobante(comprobante(), deps(registro({ sello: { count: 10 } })));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("cantidad");
  });

  it("ganadores distintos en el registro", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ resultado: { winners: [0, 1, 2] } })));
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("ganadores");
  });

  it("una lista con un nombre cambiado no es la sellada", async () => {
    const names = [...vectors.list];
    names[3] = "Otra Persona";
    const r = await revisarComprobante(comprobante({ names }), deps());
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("lista-cambiada");
  });

  it("una lista que canonicalizada cambia no se acepta, aunque su huella sea la sellada", async () => {
    // "Ana, Juan Pérez" se sella como "Ana": Juan se vería en la lista sin haber estado.
    for (const extra of [[`${vectors.list[0]}, Juan Pérez`], [`${vectors.list[0]} `], ["X"]]) {
      const names = [...vectors.list, ...extra];
      const r = await revisarComprobante(comprobante({ names }), deps());
      expect(r.veredicto, extra[0]).toBe("mal");
      expect(r.motivos, extra[0]).toContain("lista-deforme");
    }
  });

  it("un ancla rota es roja, no amarilla", async () => {
    const { id: _i, ...sinId } = comprobante();
    for (const p of [sinId as Proof, comprobante({ id: "abc" }), comprobante({ id: "04" })]) {
      const r = await revisarComprobante(p, deps());
      expect(r.veredicto).toBe("mal");
      expect(r.motivos[0]).toBe("ancla-deforme");
    }
  });

  it("un número que el contrato nunca dio es rojo; uno archivado, amarillo", async () => {
    const nunca = await revisarComprobante(comprobante({ id: "4000" }), deps(registro({ sello: null, resultado: null })));
    expect(nunca.veredicto).toBe("mal");
    expect(nunca.motivos).toContain("numero-inexistente");
    const archivado = await revisarComprobante(comprobante(), deps(registro({ sello: null, resultado: null })));
    expect(archivado.veredicto).toBe("falta");
    expect(archivado.falta).toBe("sin-sello");
  });

  it("un contrato anterior solo vale hasta el último número que dio siendo el del sitio", async () => {
    const ANTERIOR = "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ";
    const oficial = contratoOficial("testnet", ANTERIOR);
    expect(oficial?.vigente).toBe(false);
    expect(oficial?.ultimoId).toBe(1);
    // Sigue abierto: cualquiera puede sellar hoy el #2, fuera de la vista de los otros sellos.
    const d = deps(registro({ wasm: oficial?.wasmSha256 ?? "" }));
    const despues = await revisarComprobante(comprobante({ contract: ANTERIOR, id: "2" }), d);
    expect(despues.veredicto).toBe("mal");
    expect(despues.motivos[0]).toBe("contrato-retirado");
    expect(d.leidas).toEqual([]);
    const antes = await revisarComprobante(comprobante({ contract: ANTERIOR, id: "1" }), d);
    expect(d.leidas).toEqual([`testnet:${ANTERIOR}:1`]);
    expect(antes.motivos).not.toContain("contrato-retirado");
  });

  it("todo contrato anterior de la lista tiene su último número", () => {
    for (const c of contratosOficiales()) {
      if (!c.vigente) expect(Number.isSafeInteger(c.ultimoId), c.contractId).toBe(true);
      else expect(c.ultimoId, c.contractId).toBeUndefined();
    }
  });

  it("un resultado sin su sello (el sello se archivó antes) es amarillo, no rojo", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ sello: null })));
    expect(r.veredicto).toBe("falta");
    expect(r.motivos).toEqual([]);
  });

  it("un número apenas más allá del contador puede ser un sello que el RPC todavía no ve: amarillo", async () => {
    const cerca = await revisarComprobante(comprobante({ id: "15" }), deps(registro({ sello: null, resultado: null, siguiente: 10 })));
    expect(cerca.veredicto).toBe("falta");
    const lejos = await revisarComprobante(comprobante({ id: "110" }), deps(registro({ sello: null, resultado: null, siguiente: 10 })));
    expect(lejos.veredicto).toBe("mal");
    expect(lejos.motivos).toContain("numero-inexistente");
  });

  it("sin la instancia del contrato (testnet borrada) es amarillo, sin testigo", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ wasm: null, siguiente: null, sello: null, resultado: null })));
    expect(r.veredicto).toBe("falta");
    expect(r.falta).toBe("sin-contrato");
  });

  it("sin conexión con la cadena no afirma nada", async () => {
    const r = await revisarComprobante(comprobante(), deps(new Error("sin red")));
    expect(r.veredicto).toBe("sin-red");
    expect(r.falta).toBe("sin-cadena");
  });

  it("sellado y todavía sin sortear: pendiente, con el ganador que va a salir", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ sello: { drawn: false }, resultado: null })));
    expect(r.veredicto).toBe("pendiente");
    expect(r.ganadores).toEqual(GANADORES);
  });

  it("un registro que no cierra consigo mismo es rojo", async () => {
    const sinSortear = await revisarComprobante(comprobante(), deps(registro({ sello: { drawn: false } })));
    expect(sinSortear.motivos).toContain("registro-incoherente");
    const otroNumero = await revisarComprobante(comprobante(), deps(registro({ resultado: { raffleId: "5" } })));
    expect(otroNumero.motivos).toContain("registro-incoherente");
    const otroSello = await revisarComprobante(comprobante(), deps(registro({ sello: { id: "5" } })));
    expect(otroSello.motivos).toContain("registro-incoherente");
    const sinResultado = await revisarComprobante(comprobante(), deps(registro({ resultado: null })));
    expect(sinResultado.veredicto).toBe("falta");
  });

  it("una firma que no es la de la ronda es roja", async () => {
    const r = await revisarComprobante(comprobante({ signature: OTRA_FIRMA }), deps());
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toContain("firma");
    const deforme = await revisarComprobante(comprobante({ signature: "zz" }), deps());
    expect(deforme.motivos).toContain("firma");
  });

  it("sin anclar es amarillo y rehace k ganadores; sin firma ni faro, no afirma nada", async () => {
    const libre: Proof = { v: PROOF_VERSION, names: [...vectors.list], round: R, signature: FIRMA };
    const r = await revisarComprobante(libre, deps(), { k: 3 });
    expect(r.veredicto).toBe("libre");
    expect(r.ganadores).toEqual(GANADORES);
    const { signature: _s, ...sinFirma } = libre;
    const sinFaro = await revisarComprobante(sinFirma as Proof, deps(registro(), new Error("sin faro")));
    expect(sinFaro.veredicto).toBe("sin-red");
    expect(sinFaro.falta).toBe("sin-ronda");
  });

  it("nunca lanza, ni con un comprobante de cualquier forma", async () => {
    const raros = [
      { v: 2, names: [1, 2, 3], round: R },
      { v: 2, names: "Ana\nBeto", round: R },
      { v: 2, names: ["Ana"], round: R, signature: FIRMA },
      { v: 2, names: [...vectors.list], round: 1e300, signature: FIRMA },
      { v: 2, names: [...vectors.list], round: -5, net: "testnet", contract: TESTNET, id: "4" },
    ] as unknown as Proof[];
    for (const p of raros) {
      const r = await revisarComprobante(p, deps());
      expect(r.veredicto).toBe("mal");
    }
  });

  it("el premio sale del sello; el texto por defecto no es premio", async () => {
    const r = await revisarComprobante(comprobante(), deps(registro({ sello: { meta: "Sorteo de comunidad" } })));
    expect(premioDe(r, "Un auto 0 km", ["Sorteo de comunidad", "Community draw"])).toBe("");
    const libre = await revisarComprobante({ v: 2, names: [...vectors.list], round: R, signature: FIRMA }, deps());
    expect(premioDe(libre, "Una polera", [])).toBe("Una polera");
  });

  it("la lectura de la cadena va al contrato y al número del enlace, nunca a otro", async () => {
    const leer = vi.fn(async (_c: ContratoOficial, _id: string) => registro());
    await revisarComprobante(comprobante(), { ...deps(), leerRegistro: leer });
    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer.mock.calls[0]?.[0]).toMatchObject({ red: "testnet", contractId: TESTNET, wasmSha256: WASM_TESTNET });
    expect(leer.mock.calls[0]?.[1]).toBe("4");
  });
});
