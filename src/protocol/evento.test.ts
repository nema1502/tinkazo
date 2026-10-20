import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { EVENTO_TOPE, EVENTO_VERSION, comprobanteDe, decodeEvento, encodeEvento, eventoUrl, type SorteoDelEvento } from "./evento";
import { PROOF_VERSION, encodeFragment } from "./proof";

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

const titulo = "Sorteos del 20 de octubre de 2026";

describe("enlace de evento", () => {
  it("va y vuelve sin perder nada", async () => {
    const sorteos = [sorteo(0), sorteo(1, { prize: "" }), sorteo(2, { ganadores: ["Ana", "Beto"] })];
    const ev = await decodeEvento(await encodeEvento(titulo, sorteos));
    expect(ev).toEqual({ v: EVENTO_VERSION, kind: "evento", titulo, sorteos });
    expect(ev.mas).toBeUndefined();
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

  it("con más sorteos que el tope, entran los primeros y se cuenta lo que queda fuera", async () => {
    const muchos = Array.from({ length: EVENTO_TOPE + 5 }, (_, i) => sorteo(i));
    const ev = await decodeEvento(await encodeEvento(titulo, muchos));
    expect(ev.sorteos).toHaveLength(EVENTO_TOPE);
    expect(ev.mas).toBe(5);
    expect(ev.sorteos[0]?.round).toBe(muchos[0]?.round);
  });

  it("el comprobante de un sorteo no lleva los ganadores: es lo que lee verificar.html", () => {
    const s = sorteo(0);
    const c = comprobanteDe(s);
    expect(Object.keys(c)).not.toContain("ganadores");
    expect(c.names).toEqual(s.names);
    expect(c.round).toBe(s.round);
  });

  it("el enlace va a evento.html, con el texto después del numeral", async () => {
    const url = await eventoUrl(titulo, [sorteo(0)], "https://tinkazo.app");
    expect(url.startsWith("https://tinkazo.app/evento.html#")).toBe(true);
    const ev = await decodeEvento(url.slice(url.indexOf("#") + 1));
    expect(ev.sorteos).toHaveLength(1);
  });
});
