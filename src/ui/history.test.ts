import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeWithChain, type Entry } from "./history";
import { T } from "../i18n";
import { network } from "../stellar/config";
import { contratosOficiales } from "../stellar/oficiales";
import { rpcFalso, type ContratoFalso, type SelloFalso } from "../stellar/rpc-falso";
import { SCAN_MAX, type ChainRaffle } from "../stellar/seals";

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

const local = (over: Partial<Entry>): Entry => ({
  organizer: WHO,
  listHash: "aa",
  count: 10,
  numWinners: 1,
  round: 100,
  sealedAt: 1_000,
  prize: "",
  ...over,
});

const onChain = (over: Partial<ChainRaffle>): ChainRaffle => ({
  id: "1",
  organizer: WHO,
  listHash: "aa",
  count: 10,
  numWinners: 1,
  round: 100,
  sealedAt: 1_000,
  prize: "",
  drawn: false,
  ...over,
});

describe("mergeWithChain", () => {
  it("un sorteo que este equipo ya tiene no se duplica, y gana la fila con nombres", () => {
    const got = mergeWithChain(
      [local({ id: "7", winners: ["Ana"] })],
      [onChain({ id: "7", drawn: true, winners: [3] })],
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.winners).toEqual(["Ana"]);
    expect(got[0]!.fromChain).toBeUndefined();
  });

  it("lo que solo está en la cadena entra marcado, con el puesto de quien ganó", () => {
    const got = mergeWithChain([], [onChain({ id: "9", drawn: true, winners: [5], prize: "Libro" })]);
    expect(got).toEqual([
      expect.objectContaining({ id: "9", fromChain: true, winnerIdx: [5], prize: "Libro" }),
    ]);
  });

  it("si acá quedó pendiente y se sorteó en otro lado, la cadena lo completa", () => {
    const got = mergeWithChain([local({ id: "7" })], [onChain({ id: "7", drawn: true, winners: [2] })]);
    expect(got).toHaveLength(1);
    expect(got[0]!.winnerIdx).toEqual([2]);
    expect(got[0]!.fromChain).toBeUndefined();
  });

  it("el mismo id con otra lista es otro sorteo: el contrato se redesplegó", () => {
    const got = mergeWithChain([local({ id: "3", listHash: "aa" })], [onChain({ id: "3", listHash: "bb" })]);
    expect(got).toHaveLength(2);
  });

  it("los sorteos sin anclar del equipo quedan, y todo sale del más nuevo al más viejo", () => {
    const got = mergeWithChain(
      [local({ sealedAt: 2_000 }), local({ id: "1", sealedAt: 1_000 })],
      [onChain({ id: "2", listHash: "cc", sealedAt: 3_000 })],
    );
    expect(got.map((e) => e.sealedAt)).toEqual([3_000, 2_000, 1_000]);
  });

  describe("con sellos de varios contratos", () => {
    const VIGENTE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
    const ANTERIOR = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";

    it("lo que solo está en la cadena conserva la dirección de su contrato", () => {
      const got = mergeWithChain([], [onChain({ id: "9", contract: ANTERIOR })]);
      expect(got).toEqual([expect.objectContaining({ id: "9", contract: ANTERIOR, fromChain: true })]);
    });

    it("el mismo número y la misma lista en dos contratos son dos sorteos, no uno", () => {
      const got = mergeWithChain(
        [local({ id: "1", contract: VIGENTE, sealedAt: 2_000 })],
        [onChain({ id: "1", contract: ANTERIOR, sealedAt: 1_000 })],
      );
      expect(got.map((e) => [e.contract, e.fromChain])).toEqual([
        [VIGENTE, undefined],
        [ANTERIOR, true],
      ]);
    });

    it("si los dos saben su contrato y es el mismo, se juntan como siempre", () => {
      const got = mergeWithChain(
        [local({ id: "1", contract: ANTERIOR, winners: ["Ana"] })],
        [onChain({ id: "1", contract: ANTERIOR, drawn: true, winners: [3] })],
      );
      expect(got).toHaveLength(1);
      expect(got[0]!.winners).toEqual(["Ana"]);
    });

    it("una fila anotada antes de que se guardara el contrato lo toma de la cadena", () => {
      const got = mergeWithChain([local({ id: "4", winners: ["Ana"] })], [onChain({ id: "4", contract: ANTERIOR })]);
      expect(got).toHaveLength(1);
      expect(got[0]!.contract).toBe(ANTERIOR);
      expect(got[0]!.winners).toEqual(["Ana"]);
    });

    it("una fila sin contrato se junta con UN sello, no con los dos que repiten número y lista", () => {
      const got = mergeWithChain(
        [local({ id: "1" })],
        [onChain({ id: "1", contract: VIGENTE, sealedAt: 2_000 }), onChain({ id: "1", contract: ANTERIOR, sealedAt: 1_000 })],
      );
      expect(got.map((e) => e.contract).sort()).toEqual([ANTERIOR, VIGENTE].sort());
      expect(got.filter((e) => e.fromChain)).toHaveLength(1);
    });

    it("sin contrato en la cadena (filas de antes) se junta por número y lista, como siempre", () => {
      const got = mergeWithChain([local({ id: "1", contract: VIGENTE })], [onChain({ id: "1" })]);
      expect(got).toHaveLength(1);
    });

    it("todo sale del más nuevo al más viejo, vengan del contrato que vengan", () => {
      const got = mergeWithChain(
        [local({ id: "1", contract: VIGENTE, sealedAt: 3_000 })],
        [
          onChain({ id: "7", contract: ANTERIOR, listHash: "bb", sealedAt: 4_000 }),
          onChain({ id: "2", contract: ANTERIOR, listHash: "cc", sealedAt: 1_000 }),
        ],
      );
      expect(got.map((e) => [e.contract, e.id])).toEqual([
        [ANTERIOR, "7"],
        [VIGENTE, "1"],
        [ANTERIOR, "2"],
      ]);
    });
  });
});

/* ------------------------------- Mis sorteos, contra los contratos oficiales de la red */

const CUENTA = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

/** El almacenamiento del navegador, en memoria: el historial local se lee de ahí. */
function almacenFalso(inicial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/**
 * Un contrato falso por cada contrato oficial de la red. Cada uno guarda el
 * sorteo #1 de la cuenta, más nuevo cuanto más vigente. Los anteriores además
 * siguieron dando números después de su `ultimoId` (nadie apaga un contrato):
 * esos son los que no tienen que aparecer.
 */
function contratosFalsos(extra: (c: ReturnType<typeof contratosOficiales>[number]) => Partial<ContratoFalso> = () => ({})): ContratoFalso[] {
  return contratosOficiales(network.name).map((c, i) => {
    const sellos: SelloFalso[] = [
      { id: 1, organizer: CUENTA, sealedAt: 10_000 - i * 1_000, listHash: String(i + 1).padStart(64, "a"), prize: `Premio ${i}` },
    ];
    if (!c.vigente) {
      sellos.push({ id: (c.ultimoId ?? 0) + 1, organizer: CUENTA, sealedAt: 99_999, prize: "De un sello que no es de Tinkazo" });
    }
    return { contractId: c.contractId, nextId: c.vigente ? 2 : (c.ultimoId ?? 0) + 3, sellos, ...extra(c) };
  });
}

describe("Mis sorteos con el registro oficial de la red (vigente y anteriores)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", almacenFalso());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const historial = async (): Promise<typeof import("./history")> => import("./history");

  it("hay más de un contrato oficial: si no, esta prueba no probaría nada", () => {
    expect(contratosOficiales(network.name).length).toBeGreaterThan(1);
  });

  it("la cuenta ve sus sorteos de TODOS los contratos, cada uno con el suyo, y nada que pase de un ultimoId", async () => {
    const oficiales = contratosOficiales(network.name);
    vi.stubGlobal("fetch", rpcFalso(contratosFalsos()).fetch);
    const h = await historial();
    await h.askChain(CUENTA);
    const filas = h.historyOf(CUENTA);
    // Uno por contrato, del vigente (el más nuevo) al más viejo.
    expect(filas.map((f) => f.contract)).toEqual(oficiales.map((c) => c.contractId));
    expect(filas.every((f) => f.fromChain && f.id === "1")).toBe(true);
    expect(filas.some((f) => f.prize === "De un sello que no es de Tinkazo")).toBe(false);
    expect(h.chainTruncated(CUENTA)).toBe(false);
  });

  it("si un contrato pasa el tope de lectura, lo dice; y solo para la cuenta que lo trajo", async () => {
    const vigente = contratosOficiales(network.name).find((c) => c.vigente)!;
    vi.stubGlobal(
      "fetch",
      rpcFalso(contratosFalsos((c) => (c.contractId === vigente.contractId ? { nextId: SCAN_MAX + 2 } : {}))).fetch,
    );
    const h = await historial();
    await h.askChain(CUENTA);
    expect(h.chainTruncated(CUENTA)).toBe(true);
    expect(h.chainTruncated("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBe(false);
    expect(h.historyOf(CUENTA).length).toBeGreaterThan(1);
  });

  it("si la cadena no contesta, no cambia nada ni se avisa de nada, y se vuelve a intentar", async () => {
    vi.stubGlobal("fetch", rpcFalso(contratosFalsos(() => ({ falla: true }))).fetch);
    const h = await historial();
    await h.askChain(CUENTA);
    expect(h.historyOf(CUENTA)).toEqual([]);
    expect(h.chainTruncated(CUENTA)).toBe(false);
    // Vuelve la red: la próxima vez que se dibuje el historial, aparece.
    vi.stubGlobal("fetch", rpcFalso(contratosFalsos()).fetch);
    await h.askChain(CUENTA);
    expect(h.historyOf(CUENTA)).toHaveLength(contratosOficiales(network.name).length);
  });

  it("lo que este equipo recuerda no se duplica con lo de la cadena, y gana la fila con nombres", async () => {
    const vigente = contratosOficiales(network.name).find((c) => c.vigente)!;
    const delEquipo: Entry = {
      id: "1",
      contract: vigente.contractId,
      organizer: CUENTA,
      listHash: "1".padStart(64, "a"),
      count: 10,
      numWinners: 1,
      round: 1_000_001,
      sealedAt: 10_000,
      prize: "Premio 0",
      winners: ["Ana"],
      proof: "https://x/verificar.html#a",
    };
    vi.stubGlobal("localStorage", almacenFalso({ [`tinkazo.history.${network.name}`]: JSON.stringify([delEquipo]) }));
    vi.stubGlobal("fetch", rpcFalso(contratosFalsos()).fetch);
    const h = await historial();
    await h.askChain(CUENTA);
    const filas = h.historyOf(CUENTA);
    expect(filas).toHaveLength(contratosOficiales(network.name).length);
    expect(filas[0]).toMatchObject({ contract: vigente.contractId, winners: ["Ana"], proof: "https://x/verificar.html#a" });
    expect(filas[0]!.fromChain).toBeUndefined();
    expect(filas.slice(1).every((f) => f.fromChain)).toBe(true);
  });

  it("el CSV dice de qué contrato es cada sorteo, porque el número solo no alcanza", async () => {
    const oficiales = contratosOficiales(network.name);
    vi.stubGlobal("fetch", rpcFalso(contratosFalsos()).fetch);
    const h = await historial();
    await h.askChain(CUENTA);
    const [cabecera, ...filas] = h.toCsv(CUENTA).split("\n");
    const celdas = (linea: string): string[] => linea.slice(1, -1).split('","');
    expect(celdas(cabecera!).at(-1)).toBe("contrato");
    expect(filas.map((f) => celdas(f).at(-1))).toEqual(oficiales.map((c) => c.contractId));
  });
});

/**
 * Una página de mentira con solo los elementos de Mis sorteos: lo justo para que
 * `renderHistory` dibuje de verdad, con los sorteos de la cadena, sin navegador.
 * Los demás ids (el aviso de sello pendiente, por ejemplo) no existen, como en
 * una página sin ellos.
 */
type ElementoFalso = {
  id: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  textContent: string;
  innerHTML: string;
};

function paginaFalsa(): Map<string, ElementoFalso> {
  const elementos = new Map<string, ElementoFalso>();
  const nuevo = (id: string): ElementoFalso => {
    const base = {
      id,
      style: {} as Record<string, string>,
      dataset: {} as Record<string, string>,
      textContent: "",
      innerHTML: "",
      addEventListener() {},
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute() {},
      focus() {},
    };
    return base;
  };
  for (const id of ["sec-history", "hist-count", "hist-truncado", "hist-list", "hist-eventos"]) elementos.set(id, nuevo(id));
  // En index.html el aviso arranca escondido.
  elementos.get("hist-truncado")!.style.display = "none";
  vi.stubGlobal("document", {
    body: nuevo("body"),
    activeElement: null,
    getElementById: (id: string) => elementos.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent: () => true,
  });
  return elementos;
}

describe("la pantalla de Mis sorteos, dibujada de verdad", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", almacenFalso());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dibuja un sorteo por contrato y deja escondido el aviso si no se cortó nada", async () => {
    const pagina = paginaFalsa();
    vi.stubGlobal("fetch", rpcFalso(contratosFalsos()).fetch);
    const h = await import("./history");
    h.renderHistory(CUENTA);
    // Primero no hay nada que dibujar; cuando llega la cadena, aparecen los de todos los contratos.
    await vi.waitFor(() => expect(pagina.get("sec-history")!.style.display).toBe("block"));
    const n = contratosOficiales(network.name).length;
    expect(pagina.get("hist-list")!.innerHTML.match(/<article class="hist-card/g)).toHaveLength(n);
    expect(pagina.get("hist-count")!.textContent).toMatch(new RegExp(`^${n}\\b`));
    expect(pagina.get("hist-truncado")!.style.display).toBe("none");
  });

  it("muestra el aviso cuando algún contrato se cortó por el tope", async () => {
    const pagina = paginaFalsa();
    const vigente = contratosOficiales(network.name).find((c) => c.vigente)!;
    vi.stubGlobal(
      "fetch",
      rpcFalso(contratosFalsos((c) => (c.contractId === vigente.contractId ? { nextId: SCAN_MAX + 2 } : {}))).fetch,
    );
    const h = await import("./history");
    h.renderHistory(CUENTA);
    await vi.waitFor(() => expect(pagina.get("sec-history")!.style.display).toBe("block"));
    expect(pagina.get("hist-truncado")!.style.display).toBe("");
    // Y los sorteos que sí se leyeron se dibujan igual.
    expect(pagina.get("hist-list")!.innerHTML).toContain("hist-card");
  });

  it("si se cortó y la cuenta no tiene nada a la vista, la sección se queda para decirlo", async () => {
    const pagina = paginaFalsa();
    const vigente = contratosOficiales(network.name).find((c) => c.vigente)!;
    // Todos los sorteos de la cuenta son más viejos que lo que se lee: el #1 queda afuera.
    vi.stubGlobal(
      "fetch",
      rpcFalso(
        contratosFalsos((c) => (c.contractId === vigente.contractId ? { nextId: SCAN_MAX + 2, sellos: [] } : { sellos: [] })),
      ).fetch,
    );
    const h = await import("./history");
    h.renderHistory(CUENTA);
    await vi.waitFor(() => expect(h.chainTruncated(CUENTA)).toBe(true));
    expect(pagina.get("sec-history")!.style.display).toBe("block");
    expect(pagina.get("hist-truncado")!.style.display).toBe("");
    expect(pagina.get("hist-list")!.innerHTML).toBe("");
  });

  it("sin recorte y sin sorteos, la sección sigue escondida", async () => {
    const pagina = paginaFalsa();
    const rpc = rpcFalso(contratosFalsos(() => ({ sellos: [] })));
    vi.stubGlobal("fetch", rpc.fetch);
    const h = await import("./history");
    // Primero contesta la cadena (se preguntó a todos los contratos) y después se dibuja.
    await h.askChain(CUENTA);
    expect(rpc.pedidos.llamadas).toBeGreaterThan(0);
    h.renderHistory(CUENTA);
    expect(pagina.get("sec-history")!.style.display).toBe("none");
    expect(h.chainTruncated(CUENTA)).toBe(false);
  });
});

describe("el aviso de que la lista se cortó, en index.html", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const aviso = html.match(/<p[^>]*id="hist-truncado"[^>]*>([^<]*)<\/p>/);

  it("está en la sección de Mis sorteos, antes de la lista, escondido hasta que haga falta", () => {
    expect(aviso).not.toBeNull();
    expect(aviso![0]).toContain('style="display:none"');
    expect(aviso![0]).toContain('data-i="histTruncated"');
    const sec = html.indexOf('id="sec-history"');
    expect(html.indexOf('id="hist-truncado"')).toBeGreaterThan(sec);
    expect(html.indexOf('id="hist-truncado"')).toBeLessThan(html.indexOf('id="hist-list"'));
  });

  it("su texto de respaldo es el del diccionario en español, y en inglés hay otro", () => {
    expect(aviso![1]).toBe(T.es.histTruncated);
    expect(typeof T.en.histTruncated).toBe("string");
    expect(T.en.histTruncated).not.toBe(T.es.histTruncated);
  });

  it("no usa tecnicismos: ni cadena, ni contrato, ni hash, ni ledger", () => {
    for (const lang of ["es", "en"] as const) {
      expect(String(T[lang].histTruncated)).not.toMatch(/cadena|chain|contrato|contract|hash|huella|ledger|firma|signature/i);
    }
  });
});
