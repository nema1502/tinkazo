import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { verifyRound } from "./drand";
import { decodeEvento, encodeEvento } from "./evento";
import { PROOF_VERSION, type Proof, conHashesValidos, decodeProof, encodeFragment, encodeProof, hashDeTx, proofFile } from "./proof";
import { roundTime } from "./quicknet";
import { type Dependencias, type Registro, clavesDelSorteo, revisarComprobante } from "./verificacion";
import { crearLectorDeHistorial, leerHistorial } from "../stellar/historial";
import {
  CUENTA,
  CUENTA_QUE_PAGA,
  PASSPHRASE_MAINNET,
  argsDeSello,
  armarSello,
  armarTx,
  horizonFalso,
  registroDeHorizon,
} from "../stellar/horizon-falso";
import { contratoOficial } from "../stellar/oficiales";
// Registra el diccionario entero: sin él `t()` devuelve la clave y las líneas técnicas no se pueden leer.
import "../i18n";
import { codigoDelSello, detalleDelHistorial, porQueSinHistorial } from "../verificacion-textos";
import realSelloDel2 from "../stellar/fixtures/horizon-e418ebc4.json";
import realTxDelSorteoDel2 from "../stellar/fixtures/horizon-0a8671d0.json";
import realOtraLista from "../stellar/fixtures/horizon-66f498d7.json";
import realUltimoDel936 from "../stellar/fixtures/horizon-b5075505.json";
import realFeeBump352 from "../stellar/fixtures/horizon-ea551981.json";
import realFeeBump352PorLaInterior from "../stellar/fixtures/horizon-ea551981-por-el-hash-interior.json";

/**
 * Lo que un atacante, un Horizon que miente o una red que falla pueden hacerle a la
 * verificación por historial (docs/protocolo.md §7.1, docs/amenazas.md). Sin red: el
 * historial es un Horizon de mentira (`horizon-falso.ts`) o respuestas de verdad de
 * testnet grabadas en `stellar/fixtures/`; la firma de la ronda, la huella y la selección
 * son las de verdad. Varios de estos casos los escribieron los revisores del 25 de octubre
 * de 2026 contra la red real, y acá quedan como pruebas permanentes.
 *
 * Lo que fija este archivo:
 * - sin red nunca es falta ni rojo: si el historial no se pudo leer, el sorteo queda sin confirmar;
 * - por historial el número del sorteo no se comprueba, y el sorteo se identifica por otra cosa;
 * - un mismo sello citado de varias formas cuenta como uno en un evento;
 * - un lector que falla una vez no queda apagado para toda la sesión;
 * - los límites que se dicen en voz alta, como pruebas que pasan: la misma lista sellada dos
 *   veces sale verde las dos por historial, y si Horizon mintiera en la hora o el ledger, pasaría.
 */

const VIGENTE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const WASM_VIGENTE = "c2403e081fc2d91ee86ea5faf58861e2d91d38f4846585b4f08ad215d85a546e";
const ANTERIOR = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";
const { round: R, signature: FIRMA, randomness: SEMILLA } = vectors.quicknet;
const GANADORES = vectors.cases.find((c) => c.k === 3)?.winners as number[];
// La ronda y la firma de verdad del sorteo #936 del contrato anterior (docs/vectors.json no la trae).
const R2 = 33_375_876;
const FIRMA2 = "99168536f5dcc602ef7acd40001b0fae216c9a8b1fa099a8e53ad2863058d83e5bef26a8338dcecc810511cb848d4bd5";

const sinInstancia = (): Registro => ({ wasm: null, siguiente: null, sello: null, resultado: null });
const archivado = (siguiente = 10): Registro => ({ wasm: WASM_VIGENTE, siguiente, sello: null, resultado: null });
/** El estado de un sorteo con esta lista, esta ronda y tres ganadores, mientras el contrato todavía lo guarda. */
const vivo = (extra: Partial<NonNullable<Registro["sello"]>> = {}): Registro => ({
  wasm: WASM_VIGENTE,
  siguiente: 10,
  sello: {
    id: "4",
    organizer: CUENTA,
    listHash: vectors.list_hash,
    count: vectors.count,
    numWinners: 3,
    round: R,
    sealedAt: roundTime(R) - 60,
    sealedLedger: 5_000_000,
    meta: "Una polera",
    drawn: true,
    ...extra,
  },
  resultado: { raffleId: "4", round: R, signature: FIRMA, randomness: SEMILLA, winners: [...GANADORES], drawnAt: roundTime(R) + 5 },
});

const comprobante = (extra: Partial<Proof> = {}): Proof => ({
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: R,
  signature: FIRMA,
  sealedAt: roundTime(R) - 60,
  net: "testnet",
  contract: VIGENTE,
  id: "4",
  ...extra,
});

const argsSello = (extra: Record<string, unknown> = {}) => ({
  organizer: CUENTA,
  listHash: vectors.list_hash,
  count: vectors.count,
  numWinners: 3,
  round: R,
  meta: "Una polera",
  ...extra,
});

/** Verificar la firma de una ronda es lo caro; la misma firma de la misma ronda da siempre lo mismo. */
const firmasVistas = new Map<string, boolean>();
const verificarFirma: Dependencias["verificarFirma"] = async (ronda, firma) => {
  const clave = `${ronda}:${firma}`;
  const antes = firmasVistas.get(clave);
  if (antes !== undefined) return antes;
  const ok = await verifyRound(ronda, firma);
  firmasVistas.set(clave, ok);
  return ok;
};

/** Las dependencias, con el lector REAL del historial contra un `fetch` de mentira. */
function depsReales(reg: Registro, f: typeof fetch, op: Parameters<typeof crearLectorDeHistorial>[0] = {}): Dependencias {
  return {
    verificarFirma,
    traerFirma: async () => FIRMA,
    leerRegistro: async () => reg,
    leerHistorial: crearLectorDeHistorial({ fetch: f, esperaMs: 0, ...op }),
  };
}

/* ----------------------------------------------------------------------------------------- */

describe("sin red nunca es falta: si el historial no se pudo leer, el sorteo queda sin confirmar", () => {
  const tx = armarSello(VIGENTE, argsSello());
  const buena = registroDeHorizon(tx, { cierre: roundTime(R) - 60 });
  const cortado: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const otraTx = armarSello(VIGENTE, argsSello({ count: 5 }));
  const casos: Array<[string, typeof fetch, string]> = [
    ["la red cortada", cortado, "red-caida"],
    ["un 429 (límite de pedidos)", horizonFalso({ [tx.hash]: 429 }).fetch, "red-caida"],
    ["un 503", horizonFalso({ [tx.hash]: 503 }).fetch, "red-caida"],
    ["un 410 (before_history: esa fuente ya no guarda algo tan antiguo)", horizonFalso({ [tx.hash]: 410 }).fetch, "fuera-de-ventana"],
    ["un 404 (no distingue 'nunca existió' de 'ya no la guardo')", horizonFalso({}).fetch, "no-encontrada"],
    ["un 400", horizonFalso({ [tx.hash]: 400 }).fetch, "respuesta-invalida"],
    ["algo que no es JSON", horizonFalso({ [tx.hash]: "<html>502 Bad Gateway</html>" }).fetch, "respuesta-invalida"],
    ["un sobre que no decodifica", horizonFalso({ [tx.hash]: { ...buena, envelope_xdr: "AAAA" } }).fetch, "respuesta-invalida"],
    ["la respuesta de otra transacción", horizonFalso({ [tx.hash]: registroDeHorizon(otraTx) }).fetch, "respuesta-invalida"],
  ];

  for (const [nombre, f, error] of casos) {
    it(`${nombre}: con el estado vencido es 'sin-red' y dice por qué, nunca 'falta' ni 'mal'`, async () => {
      for (const reg of [sinInstancia(), archivado()]) {
        const r = await revisarComprobante(comprobante({ stx: tx.hash }), depsReales(reg, f));
        expect(r.veredicto).toBe("sin-red");
        expect(r.falta).toBe("sin-historial");
        expect(r.motivos).toEqual([]);
        expect(r.fuente).toBe("estado");
        expect(r.historial).toEqual({ ok: false, error });
        // La interfaz tiene qué decir, y es distinto de "no está".
        expect(porQueSinHistorial(r)).toMatch(/^vHistWhy/);
      }
    });

    it(`${nombre}: con el estado a mano no cambia un verde por estado`, async () => {
      const r = await revisarComprobante(comprobante({ stx: tx.hash }), depsReales(vivo(), f));
      expect(r.veredicto).toBe("verde");
      expect(r.fuente).toBe("estado");
      expect(r.motivos).toEqual([]);
    });
  }

  it("el 410 tiene su propio motivo y no se confunde con 'probá de nuevo en un rato' ni con 'no existe'", async () => {
    const r410 = await revisarComprobante(comprobante({ stx: tx.hash }), depsReales(sinInstancia(), horizonFalso({ [tx.hash]: 410 }).fetch));
    const r429 = await revisarComprobante(comprobante({ stx: tx.hash }), depsReales(sinInstancia(), horizonFalso({ [tx.hash]: 429 }).fetch));
    const r404 = await revisarComprobante(comprobante({ stx: tx.hash }), depsReales(sinInstancia(), horizonFalso({}).fetch));
    const textos = new Set([porQueSinHistorial(r410), porQueSinHistorial(r429), porQueSinHistorial(r404)]);
    expect(textos.size).toBe(3);
    expect(porQueSinHistorial(r410)).toBe("vHistWhyWindow");
  });

  it("'falta' queda para lo que no trae el hash del sello: no hay qué consultar", async () => {
    const f = horizonFalso({ [tx.hash]: buena });
    for (const reg of [sinInstancia(), archivado()]) {
      const r = await revisarComprobante(comprobante(), depsReales(reg, f.fetch));
      expect(r.veredicto).toBe("falta");
    }
    expect(f.pedidos).toEqual([]);
  });

  it("solo una contradicción es 'mal': una transacción que se leyó y no es un sello oficial", async () => {
    const draw = armarTx({ contrato: VIGENTE, funcion: "draw", args: argsDeSello(argsSello()) });
    const falla = registroDeHorizon(tx, { successful: false });
    for (const [que, f] of [
      ["otra función del contrato", horizonFalso({ [draw.hash]: registroDeHorizon(draw) }).fetch],
      ["una transacción que la red rechazó", horizonFalso({ [tx.hash]: falla }).fetch],
    ] as const) {
      const r = await revisarComprobante(comprobante({ stx: que === "otra función del contrato" ? draw.hash : tx.hash }), depsReales(sinInstancia(), f));
      expect(r.veredicto, que).toBe("mal");
      expect(r.motivos, que).toEqual(["sello-invalido"]);
    }
  });
});

describe("por historial el número del sorteo no se comprueba: el sorteo se identifica por otra cosa", () => {
  const tx = armarSello(VIGENTE, argsSello());
  const h = horizonFalso({ [tx.hash]: registroDeHorizon(tx, { cierre: roundTime(R) - 60 }) });
  const ids = ["1", "2", "9", "170", "18446744073709551615"];

  it("el mismo sello con cualquier número sale verde, y sus claves y su código no dependen del número", async () => {
    const vistos = new Set<string>();
    for (const id of ids) {
      const p = comprobante({ stx: tx.hash, id });
      const r = await revisarComprobante(p, depsReales(sinInstancia(), h.fetch));
      expect(r.veredicto, id).toBe("verde");
      expect(r.fuente, id).toBe("historial");
      const claves = clavesDelSorteo(p, r);
      // Ninguna clave nombra el número que trae el enlace.
      expect(
        claves.filter((c) => c.startsWith(`testnet:${VIGENTE}:`)),
        id,
      ).toEqual([]);
      vistos.add(claves.join("|"));
      // Se reconoce por el código del sello, que es el mismo; el número, si se muestra, va rotulado y aparte.
      if (!r.historial?.ok) throw new Error("tenía que haber leído el sello");
      expect(codigoDelSello(r.historial.sello), id).toBe(tx.hash.slice(0, 8));
      const detalle = detalleDelHistorial(r, p);
      expect(detalle.filter((l) => l.includes(`#${id}`)), id).toHaveLength(1);
      expect(detalle[1], id).toMatch(/Número que figura en el comprobante/);
    }
    // Con cinco números distintos, un solo sorteo.
    expect(vistos.size).toBe(1);
  });

  it("con la entrada archivada, un número que el contrato sí dio también pasa; uno que nunca dio, no", async () => {
    for (const id of ["1", "2", "9"]) {
      const r = await revisarComprobante(comprobante({ stx: tx.hash, id }), depsReales(archivado(10), h.fetch));
      expect(r.veredicto, id).toBe("verde");
      expect(r.fuente, id).toBe("historial");
    }
    // Eso sí lo ve el estado: el contrato va por el 10, y el 4000 nunca existió.
    const nunca = await revisarComprobante(comprobante({ stx: tx.hash, id: "4000" }), depsReales(archivado(10), h.fetch));
    expect(nunca.veredicto).toBe("mal");
    expect(nunca.motivos).toContain("numero-inexistente");
    expect(nunca.historial).toBeNull();
  });
});

describe("un mismo sello citado de varias formas cuenta como uno solo en un evento", () => {
  const cierre = roundTime(R) - 60;
  const comparten = (a: string[], b: string[]): boolean => a.some((c) => b.includes(c));

  it("un fee-bump citado por su hash de afuera y por el de adentro", async () => {
    const tx = armarSello(VIGENTE, argsSello(), { feeBump: true });
    expect(tx.hash).not.toBe(tx.hashInterior);
    const h = horizonFalso({
      [tx.hash]: registroDeHorizon(tx, { cierre }),
      [tx.hashInterior]: registroDeHorizon(tx, { cierre, hash: tx.hashInterior }),
    });
    const p1 = comprobante({ stx: tx.hash });
    const p2 = comprobante({ stx: tx.hashInterior, id: "9" });
    const r1 = await revisarComprobante(p1, depsReales(sinInstancia(), h.fetch));
    const r2 = await revisarComprobante(p2, depsReales(sinInstancia(), h.fetch));
    expect(r1.veredicto).toBe("verde");
    expect(r2.veredicto).toBe("verde");
    // Los dos leyeron la misma transacción interior.
    if (!r1.historial?.ok || !r2.historial?.ok) throw new Error("tenían que haber leído el sello");
    expect(r1.historial.sello.hashInterior).toBe(tx.hashInterior);
    expect(r2.historial.sello.hashInterior).toBe(tx.hashInterior);
    expect(comparten(clavesDelSorteo(p1, r1), clavesDelSorteo(p2, r2))).toBe(true);
  });

  it("el sello visto por el estado (clave por número) y por el historial (clave por hash)", async () => {
    const tx = armarSello(VIGENTE, argsSello());
    const h = horizonFalso({ [tx.hash]: registroDeHorizon(tx, { cierre, ledger: 5_000_000 }) });
    const p1 = comprobante({ stx: tx.hash, id: "4" });
    const p2 = comprobante({ stx: tx.hash, id: "7" });
    const r1 = await revisarComprobante(p1, depsReales(vivo(), h.fetch));
    const r2 = await revisarComprobante(p2, depsReales(archivado(10), h.fetch));
    expect(r1.fuente).toBe("estado");
    expect(r2.veredicto).toBe("verde");
    expect(r2.fuente).toBe("historial");
    expect(comparten(clavesDelSorteo(p1, r1), clavesDelSorteo(p2, r2))).toBe(true);
  });

  it("aunque el enlace del estado vivo no traiga el hash, se lo reconoce por lo que dice el sello", async () => {
    const tx = armarSello(VIGENTE, argsSello());
    const h = horizonFalso({ [tx.hash]: registroDeHorizon(tx, { cierre }) });
    const p1 = comprobante({ id: "4" });
    const p2 = comprobante({ stx: tx.hash, id: "7" });
    const r1 = await revisarComprobante(p1, depsReales(vivo(), h.fetch));
    const r2 = await revisarComprobante(p2, depsReales(archivado(10), h.fetch));
    expect(r1.historial).toBeNull();
    expect(r2.fuente).toBe("historial");
    expect(comparten(clavesDelSorteo(p1, r1), clavesDelSorteo(p2, r2))).toBe(true);
  });

  it("dos sellos de verdad distintos no se confunden: otra cuenta, otra ronda u otra lista", async () => {
    const a = armarSello(VIGENTE, argsSello());
    const otraCuenta = armarSello(VIGENTE, argsSello({ organizer: CUENTA_QUE_PAGA }));
    const otraRonda = armarSello(VIGENTE, argsSello({ round: R2 }));
    const h = horizonFalso({
      [a.hash]: registroDeHorizon(a, { cierre }),
      [otraCuenta.hash]: registroDeHorizon(otraCuenta, { cierre }),
      [otraRonda.hash]: registroDeHorizon(otraRonda, { cierre: roundTime(R2) - 60 }),
    });
    const pa = comprobante({ stx: a.hash });
    const ra = await revisarComprobante(pa, depsReales(sinInstancia(), h.fetch));
    const pb = comprobante({ stx: otraCuenta.hash });
    const rb = await revisarComprobante(pb, depsReales(sinInstancia(), h.fetch));
    const pc = comprobante({ stx: otraRonda.hash, round: R2, signature: FIRMA2 });
    const rc = await revisarComprobante(pc, depsReales(sinInstancia(), h.fetch));
    for (const r of [ra, rb, rc]) expect(r.veredicto).toBe("verde");
    expect(comparten(clavesDelSorteo(pa, ra), clavesDelSorteo(pb, rb))).toBe(false);
    expect(comparten(clavesDelSorteo(pa, ra), clavesDelSorteo(pc, rc))).toBe(false);
    expect(comparten(clavesDelSorteo(pb, rb), clavesDelSorteo(pc, rc))).toBe(false);
  });

  it("sin anclar y con un ancla ajena quedan como antes: por la ronda y la lista, o por lo que dice el enlace", async () => {
    const libre: Proof = { v: PROOF_VERSION, names: [...vectors.list], round: R, signature: FIRMA };
    const rl = await revisarComprobante(libre, depsReales(sinInstancia(), horizonFalso({}).fetch));
    expect(clavesDelSorteo(libre, rl)).toEqual([`libre:${R}:${rl.huella}`]);
    const ajeno = comprobante({ contract: "CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3" });
    const ra = await revisarComprobante(ajeno, depsReales(sinInstancia(), horizonFalso({}).fetch));
    expect(clavesDelSorteo(ajeno, ra)).toEqual([`otro:testnet:CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3:4`]);
  });
});

describe("los límites que se dicen en voz alta, como pruebas que pasan", () => {
  it("la misma lista sellada dos veces (rondas y cuentas distintas) sale verde las dos veces por historial", async () => {
    // Por este camino no se ven los otros sellos de la lista: eso solo se lee del estado vivo (protocolo §7.1).
    const txA = armarSello(VIGENTE, argsSello({ round: R }));
    const txB = armarSello(VIGENTE, argsSello({ round: R2, organizer: CUENTA_QUE_PAGA }));
    const h = horizonFalso({
      [txA.hash]: registroDeHorizon(txA, { cierre: roundTime(R) - 60 }),
      [txB.hash]: registroDeHorizon(txB, { cierre: roundTime(R2) - 60 }),
    });
    const pa = comprobante({ stx: txA.hash, id: "11" });
    const pb = comprobante({ stx: txB.hash, id: "12", round: R2, signature: FIRMA2 });
    const a = await revisarComprobante(pa, depsReales(sinInstancia(), h.fetch));
    const b = await revisarComprobante(pb, depsReales(sinInstancia(), h.fetch));
    expect(a.veredicto).toBe("verde");
    expect(b.veredicto).toBe("verde");
    expect(a.fuente).toBe("historial");
    expect(b.fuente).toBe("historial");
    // Y la interfaz lo dice en lo técnico: no se revisaron otros sellos de esta lista.
    expect(detalleDelHistorial(a, pa).join("\n")).toMatch(/otros sellos de esta lista/);
  });

  it("la hora y el ledger se le creen a Horizon: si mintiera en ellos (una sola fuente), el verde se equivocaría", async () => {
    // El hash del sobre ata los argumentos; lo que Horizon dice de cuándo cerró no lo ata nada. Se documenta.
    const tx = armarSello(VIGENTE, argsSello());
    const mentira = registroDeHorizon(tx, { cierre: roundTime(R) - 3_600, ledger: 1 });
    const r = await leerHistorial("testnet", tx.hash, { fetch: horizonFalso({ [tx.hash]: mentira }).fetch, esperaMs: 0 });
    expect(r.ok).toBe(true);
    // Y el detalle técnico de un verde por historial lo dice: una sola fuente.
    const rev = await revisarComprobante(comprobante({ stx: tx.hash }), depsReales(sinInstancia(), horizonFalso({ [tx.hash]: mentira }).fetch));
    expect(detalleDelHistorial(rev, comprobante()).join("\n")).toMatch(/una sola fuente/);
  });
});

describe("el lector ante un Horizon que miente o contesta cosas raras", () => {
  const tx = armarSello(VIGENTE, argsSello());
  const bien = registroDeHorizon(tx, { cierre: roundTime(R) - 60 });
  const leer = (cuerpo: unknown, op: Parameters<typeof leerHistorial>[2] = {}) =>
    leerHistorial("testnet", tx.hash, { fetch: horizonFalso({ [tx.hash]: cuerpo }).fetch, esperaMs: 0, ...op });

  it("__proto__ y constructor en el JSON no completan un registro ni contaminan", async () => {
    const solo = `{"__proto__":{"successful":true,"ledger":5000000,"created_at":"2026-10-25T12:00:00Z","envelope_xdr":"${tx.envelopeXdr}"}}`;
    expect(await leer(solo)).toEqual({ ok: false, error: "respuesta-invalida" });
    const mezcla = JSON.stringify(bien).replace(/^\{/, '{"__proto__":{"successful":false},"constructor":{"prototype":{"successful":false}},');
    expect((await leer(mezcla)).ok).toBe(true);
    expect(({} as Record<string, unknown>).successful).toBeUndefined();
  });

  it("números y horas imposibles no son una respuesta de Horizon", async () => {
    const malos: Record<string, Record<string, unknown>> = {
      "ledger no entero": { ledger: 5.5 },
      "ledger 2^53": { ledger: 2 ** 53 },
      "ledger enorme": { ledger: 1e308 },
      "ledger negativo": { ledger: -1 },
      "ledger nulo": { ledger: null },
      "hora que es solo un número": { created_at: "1" },
      "hora anterior a 1970": { created_at: "1969-12-31T23:59:59Z" },
      "hora de un año de seis cifras": { created_at: "+275760-09-13T00:00:00.000Z" },
      "hora con otra zona": { created_at: "2026-10-25T08:22:27-04:00" },
      "hora sin zona": { created_at: "2026-10-25T08:22:27" },
    };
    for (const [nombre, cambio] of Object.entries(malos)) {
      expect(await leer({ ...bien, ...cambio }), nombre).toEqual({ ok: false, error: "respuesta-invalida" });
    }
    // La hora de siempre, con o sin fracción, sí.
    expect((await leer({ ...bien, created_at: "2026-10-25T12:22:27Z" })).ok).toBe(true);
    expect((await leer({ ...bien, created_at: "2026-10-25T12:22:27.999999999Z" })).ok).toBe(true);
  });

  it("un carácter cambiado en el sobre, en cualquier lugar, nunca da otro sello", async () => {
    const original = tx.envelopeXdr;
    const base = await leer(bien);
    expect(base.ok).toBe(true);
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let semilla = 12345;
    const azar = (): number => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let aceptados = 0;
    for (let i = 0; i < 150; i++) {
      const pos = Math.floor(azar() * original.length);
      const c = alfabeto[Math.floor(azar() * alfabeto.length)] as string;
      if (original[pos] === c) continue;
      const mutado = original.slice(0, pos) + c + original.slice(pos + 1);
      const r = await leer({ ...bien, envelope_xdr: mutado });
      // Cambiar un carácter cambia el hash del sobre (o no decodifica): ni uno solo pasa.
      if (r.ok) aceptados++;
    }
    expect(aceptados).toBe(0);
  });

  it("basura al final del sobre no pasa", async () => {
    expect(await leer({ ...bien, envelope_xdr: tx.envelopeXdr + "AAAA" })).toEqual({ ok: false, error: "respuesta-invalida" });
  });

  it("una respuesta lenta, en trozos chicos, se corta por tiempo y cuenta como red caída", async () => {
    const lento: typeof fetch = async (_u, init) => {
      const flujo = new ReadableStream<Uint8Array>({
        start(c) {
          const t = setInterval(() => c.enqueue(new TextEncoder().encode("x".repeat(10))), 5);
          init?.signal?.addEventListener("abort", () => {
            clearInterval(t);
            c.error(new Error("abortado"));
          });
        },
      });
      return new Response(flujo, { status: 200 });
    };
    const antes = Date.now();
    expect(await leerHistorial("testnet", tx.hash, { fetch: lento, tiempoMs: 150, intentos: 1 })).toEqual({ ok: false, error: "red-caida" });
    expect(Date.now() - antes).toBeLessThan(3_000);
  });

  it("un fee-bump cuya transacción interior tiene dos operaciones no es un sello", async () => {
    const { Account, Contract, TransactionBuilder } = await import("@stellar/stellar-sdk");
    const pass = "Test SDF Network ; September 2015";
    const interior = new TransactionBuilder(new Account(CUENTA, "1000"), { fee: "100", networkPassphrase: pass })
      .addOperation(new Contract(VIGENTE).call("seal", ...argsDeSello(argsSello())))
      .addOperation(new Contract(VIGENTE).call("seal", ...argsDeSello(argsSello())))
      .setTimeout(30)
      .build();
    const fb = TransactionBuilder.buildFeeBumpTransaction(CUENTA_QUE_PAGA, "200", interior, pass);
    const hash = Buffer.from(fb.hash()).toString("hex");
    const h = horizonFalso({ [hash]: registroDeHorizon({ hash, hashInterior: Buffer.from(interior.hash()).toString("hex"), envelopeXdr: fb.toXDR() }) });
    expect(await leerHistorial("testnet", hash, { fetch: h.fetch, esperaMs: 0 })).toEqual({ ok: false, error: "no-es-un-sello" });
  });

  it("otra función con los mismos seis argumentos no es un sello", async () => {
    for (const nombre of ["Seal", "seal_", "sell", "draw", "sealx"]) {
      const t = armarTx({ contrato: VIGENTE, funcion: nombre, args: argsDeSello(argsSello()) });
      const h = horizonFalso({ [t.hash]: registroDeHorizon(t) });
      expect(await leerHistorial("testnet", t.hash, { fetch: h.fetch, esperaMs: 0 }), nombre).toEqual({ ok: false, error: "no-es-un-sello" });
    }
  });

  it("un sobre de mainnet pedido como testnet no es el hash pedido", async () => {
    const m = armarSello(VIGENTE, argsSello(), { passphrase: PASSPHRASE_MAINNET });
    const h = horizonFalso({ [m.hash]: registroDeHorizon(m) });
    expect(await leerHistorial("testnet", m.hash, { fetch: h.fetch, esperaMs: 0 })).toEqual({ ok: false, error: "respuesta-invalida" });
  });
});

describe("un lector que falló no queda apagado para toda la sesión", () => {
  it("tras dos 429 la revisión queda sin confirmar, y pasado el descanso la misma página lee y da verde", async () => {
    const tx = armarSello(VIGENTE, argsSello());
    const bueno = horizonFalso({ [tx.hash]: registroDeHorizon(tx, { cierre: roundTime(R) - 60 }) });
    let ahora = 1_000_000;
    let pedidos = 0;
    let cae = true;
    const f: typeof fetch = async (u, i) => {
      pedidos++;
      return cae ? new Response("", { status: 429 }) : bueno.fetch(u, i);
    };
    const d = depsReales(sinInstancia(), f, { ahora: () => ahora, reposoMs: 30_000 });
    const p = comprobante({ stx: tx.hash });

    const r1 = await revisarComprobante(p, d);
    expect(r1.veredicto).toBe("sin-red");
    expect(r1.historial).toEqual({ ok: false, error: "red-caida" });
    expect(pedidos).toBe(2);

    // Otro sorteo del mismo evento, enseguida: no se vuelve a esperar a una red que acaba de fallar.
    const r2 = await revisarComprobante(p, d);
    expect(r2.veredicto).toBe("sin-red");
    expect(pedidos).toBe(2);

    // Pasado el descanso, con Horizon de vuelta, el mismo hash que falló se lee de nuevo.
    cae = false;
    ahora += 30_000;
    const r3 = await revisarComprobante(p, d);
    expect(r3.veredicto).toBe("verde");
    expect(r3.fuente).toBe("historial");
  });
});

describe("el enlace con hashes hostiles no inyecta nada ni se rompe", () => {
  it("hashDeTx y conHashesValidos descartan todo lo que no son 64 hexadecimales", () => {
    const h = "ab".repeat(32);
    const hostiles: unknown[] = [
      `${h}\n`,
      `\n${h}`,
      ` ${h}`,
      `${h} `,
      h + "0",
      h.slice(1),
      "<script>".padEnd(64, "a"),
      "%61".repeat(32),
      "ａ".repeat(64),
      "١".repeat(64),
      "../../ledgers?x=" + "a".repeat(40),
      { toString: () => h },
      [h],
      5,
      null,
      undefined,
      true,
    ];
    for (const malo of hostiles) expect(hashDeTx(malo), String(malo)).toBeNull();
    expect(hashDeTx(h.toUpperCase())).toBe(h);
    const raro = JSON.parse(`{"v":2,"names":["a","b"],"round":1,"__proto__":{"stx":"${h}"},"stx":"<img src=x onerror=alert(1)>","dtx":["x"]}`);
    const limpio = conHashesValidos(raro);
    expect("stx" in limpio).toBe(false);
    expect("dtx" in limpio).toBe(false);
    expect(Object.getPrototypeOf(limpio)).toBe(Object.prototype);
    expect((limpio as { stx?: string }).stx).toBeUndefined();
  });

  it("ida y vuelta por el enlace, el archivo y el evento", async () => {
    const h = "ab".repeat(32);
    const p = comprobante({ stx: h.toUpperCase(), dtx: "cd".repeat(32) });
    const de = await decodeProof("#" + (await encodeProof(p)));
    expect(de.stx).toBe(h);
    expect(de.dtx).toBe("cd".repeat(32));
    const json = JSON.parse(await proofFile({ ...p, stx: "no", dtx: "cd".repeat(32) } as Proof).text());
    expect("stx" in json).toBe(false);
    expect(json.dtx).toBe("cd".repeat(32));
    const ev = await decodeEvento("#" + (await encodeEvento("Evento", [{ ...p, ganadores: ["a"] }])));
    expect(ev.sorteos[0]?.stx).toBe(h);
    for (const roto of [
      { v: 1, kind: "evento", titulo: "x", sorteos: [null] },
      { v: 1, kind: "evento", titulo: "x", sorteos: [{ names: ["a", "b"], round: 1 }] },
    ]) {
      await expect(decodeEvento("#" + (await encodeFragment(roto)))).rejects.toThrow();
    }
  });
});

/**
 * Tres casos de verdad de testnet, con las respuestas de Horizon grabadas el 25 de octubre
 * de 2026 (`stellar/fixtures/`), la firma que publicó drand para cada ronda y los ganadores que
 * guardó la cadena. Testnet se borra el 16 de diciembre de 2026: las pruebas no le piden nada.
 */
describe("sorteos reales de testnet con el estado vencido", () => {
  const EJEMPLO_FIRMA_2 = "a841bea33b52e82b497b8d632e655cd4b82978e567bb1958f54e103a6ef184460163e84783f08fc8fe0b3c620fbe84d3";
  const EJEMPLO_FIRMA_352 = "aab9a9d574daa98a149d0068e4319b1260488ac0be04be4809ff4520a41849d00b4176210f95de7f85df315099a38304";
  const real2 = (extra: Partial<Proof> = {}): Proof =>
    comprobante({ round: 33_376_978, signature: EJEMPLO_FIRMA_2, id: "2", stx: realSelloDel2.hash, dtx: realTxDelSorteoDel2.hash, ...extra });
  const registros = {
    [realSelloDel2.hash]: realSelloDel2,
    [realTxDelSorteoDel2.hash]: realTxDelSorteoDel2,
    [realOtraLista.hash]: realOtraLista,
    [realUltimoDel936.hash]: realUltimoDel936,
  };

  it("el sorteo #2 del contrato vigente, con dos ganadores: verde por historial y los mismos que grabó la cadena", async () => {
    const p = real2();
    for (const reg of [sinInstancia(), archivado(4)]) {
      const r = await revisarComprobante(p, depsReales(reg, horizonFalso(registros).fetch));
      expect(r.veredicto).toBe("verde");
      expect(r.fuente).toBe("historial");
      expect(r.motivos).toEqual([]);
      expect(r.k).toBe(2);
      expect(r.ganadores).toEqual([12, 17]);
      // Se identifica por la transacción del sello, no por el "2" del enlace.
      expect(clavesDelSorteo(p, r)).not.toContain(`testnet:${VIGENTE}:2`);
      if (!r.historial?.ok) throw new Error("tenía que haber leído el sello");
      expect(codigoDelSello(r.historial.sello)).toBe("e418ebc4");
    }
  });

  it("con el mismo sello real: cambiar un nombre, la ronda o citar otra transacción real es rojo, no verde ni 'no está'", async () => {
    const f = horizonFalso(registros).fetch;
    const nombres = [...vectors.list];
    nombres[3] = "Carlos Choke";
    const cambiado = await revisarComprobante(real2({ names: nombres }), depsReales(sinInstancia(), f));
    expect(cambiado.veredicto).toBe("mal");
    expect(cambiado.motivos).toContain("lista-cambiada");
    // La transacción del sorteo (draw) citada como si fuera el sello.
    const delSorteo = await revisarComprobante(real2({ stx: realTxDelSorteoDel2.hash }), depsReales(sinInstancia(), f));
    expect(delSorteo.veredicto).toBe("mal");
    expect(delSorteo.motivos).toEqual(["sello-invalido"]);
    // El sello de otro sorteo real: otra lista.
    const otraLista = await revisarComprobante(real2({ stx: realOtraLista.hash }), depsReales(sinInstancia(), f));
    expect(otraLista.veredicto).toBe("mal");
    expect(otraLista.motivos).toContain("lista-cambiada");
    // El sello real de un sorteo de otro contrato oficial.
    const otroContrato = await revisarComprobante(real2({ stx: realUltimoDel936.hash }), depsReales(sinInstancia(), f));
    expect(otroContrato.veredicto).toBe("mal");
    expect(otroContrato.motivos).toEqual(["historial-distinto"]);
  });

  it("un sorteo del contrato anterior sellado con la comisión de otra cuenta (fee-bump), citado por el hash de afuera o por el de adentro: el mismo sorteo", async () => {
    const afuera = realFeeBump352.hash;
    const adentro = realFeeBump352PorLaInterior.hash;
    expect(afuera).not.toBe(adentro);
    const anterior = contratoOficial("testnet", ANTERIOR);
    if (!anterior) throw new Error("el contrato anterior tiene que ser oficial");
    const estadoViejo: Registro = { wasm: anterior.wasmSha256, siguiente: 937, sello: null, resultado: null };
    const f = horizonFalso({ [afuera]: realFeeBump352, [adentro]: realFeeBump352PorLaInterior }).fetch;
    const base = { contract: ANTERIOR, id: "352", round: 33_219_790, signature: EJEMPLO_FIRMA_352 };
    const pa = comprobante({ ...base, stx: afuera });
    const pb = comprobante({ ...base, stx: adentro, id: "353" });
    const ra = await revisarComprobante(pa, depsReales(estadoViejo, f));
    const rb = await revisarComprobante(pb, depsReales(estadoViejo, f));
    for (const r of [ra, rb]) {
      expect(r.veredicto).toBe("verde");
      expect(r.fuente).toBe("historial");
      expect(r.ganadores).toEqual([2]);
    }
    expect(clavesDelSorteo(pa, ra).some((c) => clavesDelSorteo(pb, rb).includes(c))).toBe(true);
  });
});
