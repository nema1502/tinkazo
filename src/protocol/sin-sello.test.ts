import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { EVENTO_VERSION, type SorteoDelEvento, decodeEvento, encodeEvento, verificarUrlDe } from "./evento";
import { PROOF_VERSION, type Proof, conCamposValidos, decodeProof, encodeFragment, encodeProof, esSinSello, proofFile, proofUrl } from "./proof";
import { type Dependencias, anclaDe, revisarComprobante } from "./verificacion";

/**
 * La marca `sinSello` del comprobante (protocolo §8): lo que se siguió sin sello porque la red no dejó sellar
 * lleva una marca explícita que viaja en el enlace de verificación y en cada sorteo del enlace de evento.
 * Sin red: solo se arman y se leen enlaces, y la revisión corre con dependencias de mentira.
 */

const R = vectors.quicknet.round;
const FIRMA = vectors.quicknet.signature;
const BASE = "https://tinkazo.app";

const libre: Proof = {
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: R,
  signature: FIRMA,
  prize: "Una polera de Tinkazo",
  sealedAt: 1_792_500_000,
};
const sinSello: Proof = { ...libre, sinSello: true };
const anclado: Proof = {
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: R,
  signature: FIRMA,
  net: "testnet",
  contract: "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH",
  id: "4",
};

describe("la marca de sin sello en el comprobante", () => {
  it("va y vuelve en el enlace; un comprobante sin la marca sigue sin ella", async () => {
    expect(await decodeProof(await encodeProof(sinSello))).toEqual(sinSello);
    const sin = await decodeProof(await encodeProof(libre));
    expect(sin).toEqual(libre);
    expect("sinSello" in sin).toBe(false);
  });

  it("compatible hacia atrás: un comprobante de antes de la marca se lee igual, y la marca no estorba a un anclado", async () => {
    const deAntes = await decodeProof(await encodeFragment({ v: 2, names: ["Ana", "Beto"], round: R, signature: FIRMA }));
    expect(deAntes).toEqual({ v: 2, names: ["Ana", "Beto"], round: R, signature: FIRMA });
    expect(esSinSello(deAntes)).toBe(false);
    expect(await decodeProof(await encodeProof(anclado))).toEqual(anclado);
  });

  it("viaja en el enlace de verificación y en el archivo del comprobante", async () => {
    const url = await proofUrl(sinSello, BASE);
    expect(url.startsWith(`${BASE}/verificar.html#`)).toBe(true);
    expect((await decodeProof(url.slice(url.indexOf("#")))).sinSello).toBe(true);
    expect(JSON.parse(await proofFile(sinSello).text()).sinSello).toBe(true);
    expect("sinSello" in JSON.parse(await proofFile(libre).text())).toBe(false);
  });

  it("solo `true` pasa: cualquier otra cosa se descarta al leer y al armar", async () => {
    for (const raro of [false, "true", 1, "si", null, {}, []]) {
      const leido = await decodeProof(await encodeFragment({ ...libre, sinSello: raro }));
      expect("sinSello" in leido, `leído con ${JSON.stringify(raro)}`).toBe(false);
      expect("sinSello" in conCamposValidos({ ...libre, sinSello: raro as unknown as boolean })).toBe(false);
    }
    expect(conCamposValidos(sinSello).sinSello).toBe(true);
  });

  it("esSinSello: la marca y ningún ancla; si trae un ancla (entera o a medias), manda el ancla", () => {
    expect(esSinSello(sinSello)).toBe(true);
    expect(esSinSello(libre)).toBe(false);
    expect(esSinSello({ ...anclado, sinSello: true })).toBe(false);
    expect(esSinSello({ ...sinSello, net: "testnet" })).toBe(false);
    expect(esSinSello({ ...sinSello, id: "4" })).toBe(false);
    expect(esSinSello({ sinSello: "true" })).toBe(false);
    expect(esSinSello({})).toBe(false);
  });

  it("con la marca, la revisión da el mismo estado de siempre para uno sin anclar (libre); la página suma la frase", async () => {
    const deps: Dependencias = {
      verificarFirma: async () => true,
      traerFirma: async () => FIRMA,
      leerRegistro: async () => {
        throw new Error("un sorteo sin anclar no lee la cadena");
      },
    };
    const sin = await revisarComprobante(sinSello, deps, { k: 3 });
    const comun = await revisarComprobante(libre, deps, { k: 3 });
    expect(sin.veredicto).toBe("libre");
    expect(sin.ancla).toEqual({ tipo: "libre" });
    expect(anclaDe(sinSello).tipo).toBe("libre");
    // La marca no cambia la cuenta: la misma revisión, el mismo ganador.
    expect(sin).toEqual(comun);
    expect(sin.ganadores.length).toBe(3);
    // Lo que la página de verificación decide para mostrar la frase: marca y sin ancla.
    expect(esSinSello(sinSello) && sin.ancla.tipo === "libre").toBe(true);
    expect(esSinSello(libre) && comun.ancla.tipo === "libre").toBe(false);
  });
});

describe("la marca en el enlace de evento", () => {
  const sorteos: SorteoDelEvento[] = [
    { ...anclado, prize: "Polera", ganadores: ["Gabriela Flores"] },
    { ...sinSello, prize: "Libro", ganadores: ["Ana"] },
  ];

  it("cada sorteo conserva su marca: uno sellado y uno sin sello", async () => {
    const ev = await decodeEvento(await encodeEvento("Meetup", sorteos));
    expect(ev.sorteos.map((s) => esSinSello(s))).toEqual([false, true]);
    expect(ev.sorteos[0]).not.toHaveProperty("sinSello");
    expect(ev.sorteos[1]?.ganadores).toEqual(["Ana"]);
  });

  it("lo que no es `true` se descarta al leer el evento", async () => {
    const raro = await encodeFragment({
      v: EVENTO_VERSION,
      kind: "evento",
      titulo: "x",
      sorteos: [{ ...libre, sinSello: "true", ganadores: ["Ana"] }],
    });
    expect((await decodeEvento(raro)).sorteos[0]).not.toHaveProperty("sinSello");
  });

  it("un evento de antes de la marca se lee igual", async () => {
    const deAntes = await encodeFragment({ v: EVENTO_VERSION, kind: "evento", titulo: "Viejo", sorteos: [{ ...libre, ganadores: ["Ana"] }] });
    const ev = await decodeEvento(deAntes);
    expect(ev.titulo).toBe("Viejo");
    expect(esSinSello(ev.sorteos[0] as SorteoDelEvento)).toBe(false);
  });

  it("el enlace de verificación de un sorteo del evento lleva la marca", async () => {
    const ev = await decodeEvento(await encodeEvento("Meetup", sorteos));
    const url = await verificarUrlDe(ev.sorteos[1] as SorteoDelEvento, BASE);
    expect((await decodeProof(url.slice(url.indexOf("#")))).sinSello).toBe(true);
    const urlSellado = await verificarUrlDe(ev.sorteos[0] as SorteoDelEvento, BASE);
    expect(await decodeProof(urlSellado.slice(urlSellado.indexOf("#")))).not.toHaveProperty("sinSello");
  });
});
