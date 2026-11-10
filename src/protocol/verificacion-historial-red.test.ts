import { describe, expect, it } from "vitest";
import { verifyRound } from "./drand";
import { PROOF_VERSION, type Proof } from "./proof";
import { fetchRound } from "./quicknet";
import { revisarComprobante, type Dependencias, type Registro } from "./verificacion";
import { crearLectorDeHistorial } from "../stellar/historial";
import { leerRegistro } from "../stellar/registro";

/**
 * La verificación por el historial contra testnet de verdad, con sorteos de hace más de una semana, cuando
 * el estado del contrato ya venció. Se corre a mano, con red (como los de `seals.test.ts`):
 *   TINKAZO_RED=1 pnpm test src/protocol/verificacion-historial-red
 *
 * Son sellos reales del contrato vigente de testnet (`CDNWNY26…`), de la lista de ejemplo del sitio, que
 * sellan las pruebas: ni la lista ni la ronda ni la transacción son inventadas. Los hashes y las rondas
 * salen de la transacción de cada sello (Horizon); los ganadores, de rehacer la selección con la firma de
 * la ronda, que es de drand. Medido el 6 de noviembre de 2026: el RPC de testnet todavía devolvía estas
 * entradas, marcadas como vencidas (`liveUntilLedgerSeq` 0), así que el "archivado" se simula con un estado
 * que contesta que el contrato ya no tiene el sorteo; Horizon y drand son los de verdad. Cuando el RPC las
 * desaloje, la prueba "con el RPC real" pasa a ser también por historial, sin cambiar nada.
 *
 * Testnet se borra el 16 de diciembre de 2026: después de esa fecha estos sorteos ya no existen y esta
 * prueba hay que mudarla a uno de mainnet.
 */

const EJEMPLO = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];
const VIGENTE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";

interface Real {
  id: string;
  stx: string;
  round: number;
  /** Cuándo cerró el ledger del sello, según Horizon. */
  cierre: string;
  ganadores: string[];
}
const ARCHIVADOS: Real[] = [
  { id: "2", stx: "e418ebc4c20692db82f77cffa25d362ca062bc2b2669a879b03dc5d534242c80", round: 33_376_978, cierre: "2026-10-25T13:17:37Z", ganadores: ["Camila Suárez", "Óscar Limachi"] },
  { id: "90", stx: "ea6059374c4d6d64613e6e61b78c783cc7738089b14dba3bb1af583f82f6f0bb", round: 33_406_417, cierre: "2026-10-26T13:49:32Z", ganadores: ["María Quispe"] },
  { id: "181", stx: "c238c87623071ba3c2bc6ed02608f5ff5b14a422269a1300492271c6cf289347", round: 33_449_809, cierre: "2026-10-28T01:59:10Z", ganadores: ["Ana Vargas", "Jorge Mamani"] },
];
/** Uno de hace unos días, cuyo estado todavía está vivo. */
const VIVO: Real = { id: "400", stx: "fd0d78aa12196da3154ff58da69697cdb1debfa8dfac1a56779b431e30715ba5", round: 33_626_757, cierre: "2026-11-03T05:26:40Z", ganadores: ["Paola Mendoza", "Jorge Mamani"] };

/** Lo que contesta el contrato cuando la entrada ya no está y la instancia tampoco. */
const YA_NO_ESTA: Registro = { wasm: null, siguiente: null, sello: null, resultado: null };

const comprobante = (s: Real, cambios: Partial<Proof> = {}): Proof => ({
  v: PROOF_VERSION,
  names: EJEMPLO,
  round: s.round,
  net: "testnet",
  contract: VIGENTE,
  id: s.id,
  stx: s.stx,
  ...cambios,
});

function dependencias(leer: Dependencias["leerRegistro"]): Dependencias {
  return {
    verificarFirma: async (r, f) => verifyRound(r, f),
    traerFirma: async (r) => (await fetchRound(r, { attempts: 4, delayMs: 1_000 })).signature,
    leerRegistro: leer,
    leerHistorial: crearLectorDeHistorial(),
  };
}

describe.skipIf(!process.env.TINKAZO_RED)("verificar por el historial, contra testnet de verdad", () => {
  for (const s of ARCHIVADOS) {
    it(`#${s.id}, de hace más de una semana: con el estado archivado da verde leyendo Horizon y drand, y los ganadores son los de siempre`, async () => {
      const desde = Date.now();
      const r = await revisarComprobante(comprobante(s), dependencias(async () => YA_NO_ESTA), { k: 1 });
      expect(r.veredicto).toBe("verde");
      expect(r.fuente).toBe("historial");
      expect(r.motivos).toEqual([]);
      expect(r.falta).toBeNull();
      expect(r.ganadores.map((i) => r.nombres[i])).toEqual(s.ganadores);
      expect(r.historial?.ok && new Date(r.historial.sello.closedAt * 1000).toISOString().slice(0, 19) + "Z").toBe(s.cierre);
      expect(r.historial?.ok && r.historial.sello.hashInterior).toBe(s.stx);
      // Lo que tarda es Horizon y el faro: segundos, no minutos.
      expect(Date.now() - desde).toBeLessThan(30_000);
    }, 60_000);

    it(`#${s.id}: con el RPC real da verde o pendiente y nunca algo mal, y si el estado ya no está, lo respalda el historial`, async () => {
      const r = await revisarComprobante(comprobante(s), dependencias((c, id) => leerRegistro(c, id)), { k: 1 });
      expect(r.motivos).toEqual([]);
      expect(["verde", "pendiente"]).toContain(r.veredicto);
      if (r.fuente === "historial") expect(r.veredicto).toBe("verde");
      // El número de ganadores lo decide el sello, del estado o de la transacción: son los mismos.
      expect(r.ganadores.map((i) => r.nombres[i])).toEqual(s.ganadores);
    }, 90_000);
  }

  it("un sorteo reciente, con el estado vivo, da el mismo veredicto por el estado y por el historial", async () => {
    const porEstado = await revisarComprobante(comprobante(VIVO), dependencias((c, id) => leerRegistro(c, id)), { k: 1 });
    const porHistorial = await revisarComprobante(comprobante(VIVO), dependencias(async () => YA_NO_ESTA), { k: 1 });
    expect(porEstado.fuente).toBe("estado");
    expect(porHistorial.fuente).toBe("historial");
    expect(porHistorial.veredicto).toBe("verde");
    expect(["verde", "pendiente"]).toContain(porEstado.veredicto);
    expect(porHistorial.ganadores).toEqual(porEstado.ganadores);
    expect(porHistorial.ganadores.map((i) => porHistorial.nombres[i])).toEqual(VIVO.ganadores);
    // Y los dos leyeron la misma hora de cierre: la del ledger del sello.
    expect(porEstado.historial?.ok && porEstado.historial.sello.closedAt).toBe(porHistorial.historial?.ok && porHistorial.historial.sello.closedAt);
  }, 90_000);

  it("la transacción de otro sorteo, o un hash que Horizon no conoce, no da verde ni 'no está': rojo o no confirmado", async () => {
    const ajena = await revisarComprobante(comprobante(ARCHIVADOS[0] as Real, { stx: (ARCHIVADOS[1] as Real).stx }), dependencias(async () => YA_NO_ESTA), { k: 1 });
    // Es un sello real de este contrato, pero de otra ronda y otra gente: la ronda del enlace no es la suya.
    expect(ajena.veredicto).toBe("mal");
    expect(ajena.motivos).toContain("ronda");
    const inventada = await revisarComprobante(comprobante(ARCHIVADOS[0] as Real, { stx: "ab".repeat(32) }), dependencias(async () => YA_NO_ESTA), { k: 1 });
    expect(inventada.veredicto).toBe("sin-red");
    expect(inventada.falta).toBe("sin-historial");
    expect(inventada.motivos).toEqual([]);
  }, 90_000);
});
