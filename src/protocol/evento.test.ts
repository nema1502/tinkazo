import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { EVENTO_PRESUPUESTO_CARACTERES, EVENTO_VERSION, comprobanteDe, decodeEvento, encodeEvento, eventoUrl, eventosUrls, partirEvento, verificarUrlDe, type SorteoDelEvento } from "./evento";
import { PROOF_VERSION, decodeProof, encodeFragment } from "./proof";

const sorteo = (i: number, extra: Partial<SorteoDelEvento> = {}): SorteoDelEvento => ({
  v: PROOF_VERSION,
  names: vectors.list,
  round: vectors.quicknet.round + i,
  signature: vectors.quicknet.signature,
  prize: `Premio ${i}`,
  sealedAt: 1_789_568_200 + i * 600,
  ganadores: [vectors.list[i % vectors.list.length] ?? ""],
  ...extra,
});

/** Nombres distintos, para que cada sorteo pese lo que pesa uno real. */
const personas = (n: number, prefijo: string): string[] => Array.from({ length: n }, (_, i) => `${prefijo} ${i + 1}`);
/** Doce sorteos de 200 personas cada uno: no caben en un solo enlace. */
const doce = (): SorteoDelEvento[] =>
  Array.from({ length: 12 }, (_, i) => sorteo(i, { names: personas(200, `Persona${i}`), ganadores: [`Persona${i} 1`] }));

const titulo = "Sorteos del 20 de octubre de 2026";

describe("enlace de evento", () => {
  it("va y vuelve sin perder nada", async () => {
    const sorteos = [sorteo(0), sorteo(1, { prize: "" }), sorteo(2, { ganadores: ["Ana", "Beto"] })];
    const ev = await decodeEvento(await encodeEvento(titulo, sorteos));
    expect(ev).toEqual({ v: EVENTO_VERSION, kind: "evento", titulo, sorteos });
  });

  it("una lista vacía va y vuelve, sin sorteos ni aviso de más", async () => {
    const ev = await decodeEvento(await encodeEvento(titulo, []));
    expect(ev).toEqual({ v: EVENTO_VERSION, kind: "evento", titulo, sorteos: [] });
  });

  it("una versión que esta página no conoce se rechaza entera", async () => {
    const otra = await encodeFragment({ v: 2, kind: "evento", titulo, sorteos: [] });
    await expect(decodeEvento(otra)).rejects.toThrow("evento-version");
  });

  it("un texto que no es un evento se rechaza", async () => {
    await expect(decodeEvento(await encodeFragment({ v: 1, kind: "lista", names: ["Ana"] }))).rejects.toThrow("evento-malformed");
    await expect(decodeEvento("x")).rejects.toThrow();
  });

  it("un sorteo sin ganadores no pasa la lectura", async () => {
    const roto = { v: 1, kind: "evento", titulo, sorteos: [{ names: ["Ana", "Beto"], round: 1 }] };
    await expect(decodeEvento(await encodeFragment(roto))).rejects.toThrow("evento-malformed");
  });

  it("pocos sorteos y pocas personas: un solo enlace, sin sufijo de parte", async () => {
    const partes = await partirEvento(titulo, [sorteo(0), sorteo(1), sorteo(2)]);
    expect(partes).toHaveLength(1);
    expect(partes[0]).toHaveLength(3);
    const [url] = await eventosUrls(titulo, [sorteo(0)], undefined, "https://tinkazo.app");
    const ev = await decodeEvento(url!.slice(url!.indexOf("#") + 1));
    expect(ev.titulo).toBe(titulo);
  });

  it("muchos sorteos grandes: se reparte en enlaces que no pasan el presupuesto, sin perder ninguno y en orden", async () => {
    const grandes = doce();
    const partes = await partirEvento(titulo, grandes);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) {
      if (p.length > 1) expect((await encodeEvento(titulo, p)).length).toBeLessThanOrEqual(EVENTO_PRESUPUESTO_CARACTERES);
    }
    expect(partes.flat().map((s) => s.round)).toEqual(grandes.map((s) => s.round));
  });

  it("un sorteo que no entra solo va en un enlace propio y no se deja afuera", async () => {
    const enorme = sorteo(0, { names: personas(3000, "Gente") });
    const partes = await partirEvento(titulo, [sorteo(1), enorme, sorteo(2)]);
    expect(partes.map((p) => p.map((s) => s.round))).toEqual([[sorteo(1).round], [enorme.round], [sorteo(2).round]]);
  });

  it("cada parte dice cuál es, y todos los enlaces van a evento.html", async () => {
    const enlaces = await eventosUrls(titulo, doce(), (i, n) => ` · parte ${i} de ${n}`, "https://tinkazo.app");
    expect(enlaces.length).toBeGreaterThan(1);
    const primera = await decodeEvento(enlaces[0]!.slice(enlaces[0]!.indexOf("#") + 1));
    expect(primera.titulo).toBe(`${titulo} · parte 1 de ${enlaces.length}`);
    expect(enlaces.every((u) => u.startsWith("https://tinkazo.app/evento.html#"))).toBe(true);
  });

  it("el comprobante de un sorteo no lleva los ganadores: es lo que lee verificar.html", () => {
    const s = sorteo(0);
    const c = comprobanteDe(s);
    expect(Object.keys(c)).not.toContain("ganadores");
    expect(c.names).toEqual(s.names);
    expect(c.round).toBe(s.round);
  });

  it("cada sorteo conserva los hashes de sus transacciones (stx, dtx), y se descarta lo mal formado", async () => {
    const stx = "66f498d7b937e20209f765bc995121c9e4c85567cd70232e9890c4e2f07cae0e";
    const dtx = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const ev = await decodeEvento(await encodeEvento(titulo, [sorteo(0, { stx, dtx }), sorteo(1, { stx })]));
    expect(ev.sorteos[0]).toMatchObject({ stx, dtx });
    expect(ev.sorteos[1]?.stx).toBe(stx);
    expect("dtx" in (ev.sorteos[1] ?? {})).toBe(false);
    // Un enlace armado a mano con basura en esos campos: no pasa.
    const roto = { v: 1, kind: "evento", titulo, sorteos: [{ ...sorteo(0), stx: "x", dtx: ["a"] }, { ...sorteo(1), stx: stx.toUpperCase() }] };
    const leido = await decodeEvento(await encodeFragment(roto));
    expect("stx" in (leido.sorteos[0] ?? {}) || "dtx" in (leido.sorteos[0] ?? {})).toBe(false);
    expect(leido.sorteos[1]?.stx).toBe(stx);
    // El comprobante de un sorteo, el que lee verificar.html, los lleva.
    expect(comprobanteDe(sorteo(0, { stx, dtx }))).toMatchObject({ stx, dtx });
  });

  it("un sorteo del evento viaja entero al enlace de verificación, con sus hashes", async () => {
    const stx = "66f498d7b937e20209f765bc995121c9e4c85567cd70232e9890c4e2f07cae0e";
    const url = await verificarUrlDe(sorteo(0, { stx }), "https://tinkazo.app");
    expect(url.startsWith("https://tinkazo.app/verificar.html#")).toBe(true);
    const proof = await decodeProof(url.slice(url.indexOf("#")));
    expect(proof.stx).toBe(stx);
    expect("ganadores" in proof).toBe(false);
  });

  it("el enlace va a evento.html, con el texto después del numeral", async () => {
    const url = await eventoUrl(titulo, [sorteo(0)], "https://tinkazo.app");
    expect(url.startsWith("https://tinkazo.app/evento.html#")).toBe(true);
    const ev = await decodeEvento(url.slice(url.indexOf("#") + 1));
    expect(ev.sorteos).toHaveLength(1);
  });
});
