import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeProof, PROOF_VERSION } from "../protocol/proof";
import {
  type EventoGuardado,
  aSorteoDelEvento,
  borrarEvento,
  crearEvento,
  enlacesEnEventos,
  eventosDe,
  guardarEventos,
  leerEventos,
  nuevoId,
  quitarDeEvento,
  renombrarEvento,
  sorteosDelEvento,
  sumarAEvento,
} from "./eventos";

const ORG = "GAAAORGANIZADORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTRA = "GBBBOTRACUENTABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

/** Un enlace de comprobante de verdad (verificar.html con su fragmento), para un sorteo `n`. */
async function enlaceDe(n: number): Promise<string> {
  const fragmento = await encodeProof({ v: PROOF_VERSION, names: ["Ana", "Beto", "Carla"], round: 100 + n, prize: `Premio ${n}` });
  return `https://tinkazo.app/verificar.html#${fragmento}`;
}

describe("eventos: los cambios devuelven una lista nueva", () => {
  it("crear agrega un evento vacío con el nombre sin espacios; un nombre vacío no crea nada", () => {
    const lista = crearEvento([], ORG, "  Meetup Cochabamba  ", "e1");
    expect(lista).toEqual([{ id: "e1", nombre: "Meetup Cochabamba", organizer: ORG, sorteos: [] }]);
    expect(crearEvento(lista, ORG, "   ", "e2")).toBe(lista);
  });

  it("sumar un sorteo lo agrega al final, y el mismo enlace no se repite", async () => {
    const a = await enlaceDe(1);
    const b = await enlaceDe(2);
    let lista = crearEvento([], ORG, "Evento", "e1");
    lista = sumarAEvento(lista, "e1", { enlace: a, ganadores: ["Ana"] });
    lista = sumarAEvento(lista, "e1", { enlace: b, ganadores: ["Beto"] });
    lista = sumarAEvento(lista, "e1", { enlace: a, ganadores: ["Ana"] });
    expect(lista[0]?.sorteos.map((s) => s.enlace)).toEqual([a, b]);
  });

  it("quitar un sorteo saca solo ese; los demás eventos no se tocan", async () => {
    const a = await enlaceDe(1);
    const b = await enlaceDe(2);
    let lista = crearEvento([], ORG, "Uno", "e1");
    lista = crearEvento(lista, ORG, "Dos", "e2");
    lista = sumarAEvento(lista, "e1", { enlace: a, ganadores: ["Ana"] });
    lista = sumarAEvento(lista, "e2", { enlace: a, ganadores: ["Ana"] });
    lista = sumarAEvento(lista, "e2", { enlace: b, ganadores: ["Beto"] });
    lista = quitarDeEvento(lista, "e2", a);
    expect(lista.find((e) => e.id === "e1")?.sorteos).toHaveLength(1);
    expect(lista.find((e) => e.id === "e2")?.sorteos.map((s) => s.enlace)).toEqual([b]);
  });

  it("renombrar cambia el nombre; un nombre vacío deja el evento como estaba", () => {
    const lista = crearEvento([], ORG, "Viejo", "e1");
    expect(renombrarEvento(lista, "e1", " Nuevo ")[0]?.nombre).toBe("Nuevo");
    expect(renombrarEvento(lista, "e1", "  ")).toBe(lista);
  });

  it("borrar un evento lo saca de la lista, sin tocar los demás", () => {
    let lista = crearEvento([], ORG, "Uno", "e1");
    lista = crearEvento(lista, ORG, "Dos", "e2");
    expect(borrarEvento(lista, "e1").map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("eventos: de cada cuenta", () => {
  it("cada cuenta ve solo sus eventos, y los enlaces ocupados son los suyos", async () => {
    const a = await enlaceDe(1);
    const b = await enlaceDe(2);
    let lista = crearEvento([], ORG, "Mío", "e1");
    lista = crearEvento(lista, OTRA, "Ajeno", "e2");
    lista = sumarAEvento(lista, "e1", { enlace: a, ganadores: ["Ana"] });
    lista = sumarAEvento(lista, "e2", { enlace: b, ganadores: ["Beto"] });
    expect(eventosDe(lista, ORG).map((e) => e.nombre)).toEqual(["Mío"]);
    expect([...enlacesEnEventos(lista, ORG)]).toEqual([a]);
    expect([...enlacesEnEventos(lista, OTRA)]).toEqual([b]);
  });

  it("los identificadores al azar son hexadecimales de 16 caracteres, y no se repiten", () => {
    const ids = new Set(Array.from({ length: 50 }, () => nuevoId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("eventos: el sorteo que va al enlace de evento", () => {
  it("un comprobante que se lee vuelve con sus ganadores, en el mismo orden", async () => {
    const a = await enlaceDe(7);
    const s = await aSorteoDelEvento(a, ["Beto", "Carla"]);
    expect(s).toMatchObject({ v: PROOF_VERSION, round: 107, prize: "Premio 7", ganadores: ["Beto", "Carla"] });
    expect(s?.names).toEqual(["Ana", "Beto", "Carla"]);
  });

  it("un enlace que no se lee no entra: devuelve null y el evento sigue con los demás", async () => {
    const bueno = await enlaceDe(3);
    expect(await aSorteoDelEvento("https://tinkazo.app/verificar.html#rROTO!!", ["Ana"])).toBeNull();
    const ev: EventoGuardado = {
      id: "e1",
      nombre: "Evento",
      organizer: ORG,
      sorteos: [
        { enlace: "https://tinkazo.app/verificar.html#rROTO!!", ganadores: ["Ana"] },
        { enlace: bueno, ganadores: ["Beto"] },
      ],
    };
    const sorteos = await sorteosDelEvento(ev);
    expect(sorteos.map((s) => s.round)).toEqual([103]);
  });
});

describe("eventos: el almacenamiento del navegador", () => {
  const guardado = new Map<string, string>();
  let antes: unknown;

  beforeEach(() => {
    antes = (globalThis as { localStorage?: unknown }).localStorage;
    guardado.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => void guardado.set(k, v),
    };
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = antes;
  });

  it("va y vuelve, por red", () => {
    const lista = crearEvento([], ORG, "Guardado", "e1");
    guardarEventos("testnet", lista);
    expect(leerEventos("testnet")).toEqual(lista);
    expect(leerEventos("mainnet")).toEqual([]);
  });

  it("un dato roto o de otra forma no entra, y los que sí tienen forma de evento se conservan", () => {
    guardado.set(
      "tinkazo.eventos.testnet",
      JSON.stringify([
        { id: "bien", nombre: "Bien", organizer: ORG, sorteos: [] },
        { id: "sin-sorteos", nombre: "Mal", organizer: ORG },
        { id: "sorteo-mal", nombre: "Mal", organizer: ORG, sorteos: [{ enlace: 5 }] },
        "basura",
      ]),
    );
    expect(leerEventos("testnet").map((e) => e.id)).toEqual(["bien"]);
    guardado.set("tinkazo.eventos.testnet", "{no es json");
    expect(leerEventos("testnet")).toEqual([]);
  });
});
