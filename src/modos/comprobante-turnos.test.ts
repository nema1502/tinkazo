// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { canonicalList, listHash } from "../protocol/canonical";
import { verifyRound } from "../protocol/drand";
import { PROOF_VERSION, type Proof } from "../protocol/proof";
import { bytesToHex, hexToBytes, roundTime } from "../protocol/quicknet";
import { select } from "../protocol/select";
import { type Dependencias, type Registro, premioDe, revisarComprobante } from "../protocol/verificacion";
import { T } from "../i18n";
import { htmlDeLosGanadores } from "../ui/ganadores-de-la-verificacion";
import { isTurnOrder } from "./turnos";

/**
 * Un comprobante de turnos se verifica como cualquiera, y la página de verificación lo muestra como orden.
 *
 * El comprobante NO cambia de forma: es el de siempre, con la lista, la ronda y la firma. Un orden de turnos es un sorteo
 * con tantos ganadores como personas y un nombre que empieza con «Turnos», dos datos que el sello ya tiene. La cadena y el
 * faro son de mentira (las dependencias); la firma, la huella y la selección son las de verdad, con los vectores de
 * docs/vectors.json, como en `src/protocol/verificacion.test.ts`.
 */

const { round: R, signature: FIRMA, randomness: SEMILLA } = vectors.quicknet;
const TESTNET = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const WASM_TESTNET = "c2403e081fc2d91ee86ea5faf58861e2d91d38f4846585b4f08ad215d85a546e";
const POR_DEFECTO = ["Sorteo de comunidad", "Community draw"];

/** Un sorteo con esa cantidad de personas y de ganadores, y los ganadores que da el número de los vectores. */
const sorteo = (n: number, k: number) => {
  const names = canonicalList(Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n"));
  const huella = bytesToHex(listHash(names));
  const ganadores = select(hexToBytes(SEMILLA), hexToBytes(huella), n, k);
  return { names, huella, ganadores };
};

const comprobante = (names: string[]): Proof => ({
  v: PROOF_VERSION,
  names,
  round: R,
  signature: FIRMA,
  sealedAt: roundTime(R) - 60,
  net: "testnet",
  contract: TESTNET,
  id: "4",
});

/** El registro de la cadena de ese sorteo: lo que el sello y el resultado grabaron. */
const registro = (huella: string, count: number, numWinners: number, meta: string, winners: number[]): Registro => ({
  wasm: WASM_TESTNET,
  siguiente: 10,
  sello: {
    id: "4",
    organizer: "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY",
    listHash: huella,
    count,
    numWinners,
    round: R,
    sealedAt: roundTime(R) - 60,
    meta,
    drawn: true,
  },
  resultado: { raffleId: "4", round: R, signature: FIRMA, randomness: SEMILLA, winners, drawnAt: roundTime(R) + 5 },
});

const deps = (reg: Registro): Dependencias => ({
  verificarFirma: async (r, s) => verifyRound(r, s),
  traerFirma: async () => FIRMA,
  leerRegistro: async () => reg,
});

const avatar = (nombre: string): string => `data:cara-${nombre.length}`;
const pagina = (html: string): HTMLElement => {
  const caja = document.createElement("div");
  caja.innerHTML = html;
  return caja;
};

describe("un comprobante de turnos", () => {
  it.each([12, 300])("de %i personas se verifica en verde y la página lo muestra en el orden del sorteo", async (n) => {
    const { names, huella, ganadores } = sorteo(n, n);
    // Los turnos son una permutación completa de la lista, y no la lista en el orden en que se cargó.
    expect([...ganadores].sort((a, b) => a - b)).toEqual(names.map((_, i) => i));
    expect(ganadores).not.toEqual(names.map((_, i) => i));

    const r = await revisarComprobante(comprobante(names), deps(registro(huella, n, n, "Turnos de limpieza", ganadores)));
    expect(r.motivos).toEqual([]);
    expect(r.veredicto).toBe("verde");
    expect(r.k).toBe(n);
    expect(r.ganadores).toEqual(ganadores);

    // Lo que la página de verificación dibuja sale del sello (la cantidad y el nombre), sin ningún campo nuevo en el comprobante.
    const premio = premioDe(r, undefined, POR_DEFECTO);
    expect(premio).toBe("Turnos de limpieza");
    expect(isTurnOrder(r.nombres.length, r.ganadores.length, premio)).toBe(true);
    const c = pagina(htmlDeLosGanadores(r.nombres, r.ganadores, premio, avatar));
    const mostrados = [...c.querySelectorAll<HTMLElement>(".winner-lista .winner-name")].map((e) => e.textContent);
    // Los mismos índices, en el mismo orden que el registro de la cadena y que la selección.
    expect(mostrados).toEqual(ganadores.map((i) => names[i]));
    expect(mostrados).toEqual(r.ganadores.map((i) => r.nombres[i]));
    expect(c.querySelector(".winner-lista > li:first-child .winner-num")?.textContent).toBe("Turno 1");
    expect(c.querySelector(".winner-lista > li:last-child .winner-num")?.textContent).toBe(`Turno ${n}`);
    // Una tarjeta por persona eran decenas de miles de píxeles con 300: ahora, renglones y ninguna imagen.
    expect(c.querySelectorAll(".winner-card, img")).toHaveLength(0);
    expect(c.querySelectorAll(".winner-lista > li")).toHaveLength(n);
    expect(c.textContent).not.toMatch(/Se lleva|premio|ganador|gana/i);
  });

  it("el comprobante de turnos tiene la forma de siempre: ni un campo más que uno común", async () => {
    const { names, huella, ganadores } = sorteo(12, 12);
    const turnos = comprobante(names);
    const comun = comprobante(sorteo(12, 3).names);
    expect(Object.keys(turnos).sort()).toEqual(Object.keys(comun).sort());
    const r = await revisarComprobante(turnos, deps(registro(huella, 12, 12, "Turns", ganadores)));
    expect(r.veredicto).toBe("verde");
    expect(isTurnOrder(r.nombres.length, r.ganadores.length, premioDe(r, undefined, POR_DEFECTO))).toBe(true);
  });

  it("3 poleras entre 3 personas, o «Turnos de limpieza» con 3 de 12, se siguen mostrando como tarjetas con «Se lleva»", async () => {
    for (const [n, k, meta] of [[3, 3, "3 poleras"], [12, 3, "Turnos de limpieza"]] as const) {
      const { names, huella, ganadores } = sorteo(n, k);
      const r = await revisarComprobante(comprobante(names), deps(registro(huella, n, k, meta, ganadores)));
      expect(r.veredicto).toBe("verde");
      const premio = premioDe(r, undefined, POR_DEFECTO);
      expect(isTurnOrder(r.nombres.length, r.ganadores.length, premio), meta).toBe(false);
      const c = pagina(htmlDeLosGanadores(r.nombres, r.ganadores, premio, avatar));
      expect(c.querySelectorAll(".winner-card"), meta).toHaveLength(k);
      expect(c.querySelector(".winner-prize")?.textContent, meta).toBe(`${T.es.winsPrize} ${meta}`);
      expect(c.querySelector("[data-copiar-orden]"), meta).toBeNull();
      expect([...c.querySelectorAll(".winner-name")].map((e) => e.textContent), meta).toEqual(ganadores.map((i) => names[i]));
    }
  });

  it("el encabezado de la página no repite el título de la lista", () => {
    const { names, ganadores } = sorteo(12, 12);
    const c = pagina(htmlDeLosGanadores(names, ganadores, "Turnos", avatar));
    expect(c.querySelector("h3")).toBeNull();
    expect(c.querySelector("ol")?.hasAttribute("aria-labelledby")).toBe(false);
  });
});
