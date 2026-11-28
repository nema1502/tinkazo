import { Account, Keypair, MuxedAccount, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  armarCuentaQuePideNota,
  destinoDeLaPagina,
  destinoDelEnlace,
  direccionConNota,
  leerPedidoDePremio,
  llaveDeDestinoNueva,
  NOTA_MAXIMA,
  pideNota,
  rutaSinDestino,
} from "./destino";
import { NOTA_DE_PRUEBA } from "./premio";
import { RED_DE_PRUEBA } from "./red";

const g = Keypair.random().publicKey();
const m = new MuxedAccount(new Account(g, "0"), "77").accountId();
const c = RED_DE_PRUEBA.verificador;
const buscar = (q: Record<string, string>): string => `?${new URLSearchParams(q).toString()}`;

describe("lo que pide la dirección de la página", () => {
  it("sin el modo premio no se lee nada más, ni siquiera un destino malo", () => {
    expect(leerPedidoDePremio("")).toEqual({ ok: true, premio: null });
    expect(leerPedidoDePremio(buscar({ destino: "basura" }))).toEqual({ ok: true, premio: null });
    expect(leerPedidoDePremio(buscar({ modo: "otro", destino: g }))).toEqual({ ok: true, premio: null });
  });

  it("el modo premio solo, sin destino, deja que la página arme el destino", () => {
    expect(leerPedidoDePremio(buscar({ modo: "premio" }))).toEqual({ ok: true, premio: { destino: null } });
  });

  it("un destino G, M o C con su control vale, y sin nota queda sin nota", () => {
    for (const d of [g, m, c]) expect(leerPedidoDePremio(buscar({ modo: "premio", destino: d }))).toEqual({ ok: true, premio: { destino: { direccion: d, nota: null } } });
  });

  it("un destino con el control malo, vacío o de otro tipo da error de destino", () => {
    const malaG = `${g.slice(0, -1)}${g.endsWith("A") ? "B" : "A"}`;
    for (const d of [malaG, "", "basura", `${c}X`]) expect(leerPedidoDePremio(buscar({ modo: "premio", destino: d }))).toEqual({ ok: false, motivo: "destino" });
  });

  it("la nota va de 1 a 20 dígitos y como mucho el mayor de 64 bits, y solo con una G", () => {
    const con = (nota: string, destino = g): ReturnType<typeof leerPedidoDePremio> => leerPedidoDePremio(buscar({ modo: "premio", destino, nota }));
    expect(con("1")).toEqual({ ok: true, premio: { destino: { direccion: g, nota: 1n } } });
    expect(con(NOTA_MAXIMA.toString())).toEqual({ ok: true, premio: { destino: { direccion: g, nota: NOTA_MAXIMA } } });
    expect(con((NOTA_MAXIMA + 1n).toString())).toEqual({ ok: false, motivo: "nota" });
    expect(con("123456789012345678901")).toEqual({ ok: false, motivo: "nota" });
    expect(con("")).toEqual({ ok: false, motivo: "nota" });
    expect(con("0")).toEqual({ ok: false, motivo: "nota" });
    expect(con("-5")).toEqual({ ok: false, motivo: "nota" });
    expect(con("12a")).toEqual({ ok: false, motivo: "nota" });
    expect(con("5", m)).toEqual({ ok: false, motivo: "nota" });
    expect(con("5", c)).toEqual({ ok: false, motivo: "nota" });
    expect(leerPedidoDePremio(buscar({ modo: "premio", nota: "5" }))).toEqual({ ok: false, motivo: "nota" });
  });

  it("la ruta sin destino conserva la lengua y saca destino, nota y fuente", () => {
    expect(rutaSinDestino("/prueba/llave/", buscar({ lang: "en", modo: "premio", destino: g, nota: "5", fuente: "rpc" }))).toBe("/prueba/llave/?modo=premio&lang=en");
    expect(rutaSinDestino("/prueba/llave/", "")).toBe("/prueba/llave/?modo=premio");
  });
});

describe("las direcciones con nota", () => {
  it("una G con un número da una M que vuelve a dar la G y el número", () => {
    const x = direccionConNota(g, 1_234_567_890n);
    expect(StrKey.isValidMed25519PublicKey(x)).toBe(true);
    const de = MuxedAccount.fromAddress(x, "0");
    expect(de.baseAccount().accountId()).toBe(g);
    expect(de.id()).toBe("1234567890");
  });

  it("el destino del enlace: G sin nota, G con nota (M), M tal cual y C", () => {
    const propia = RED_DE_PRUEBA.contrato;
    const sinNota = destinoDelEnlace({ direccion: g, nota: null }, propia);
    expect(sinNota).toEqual({ hacia: g, base: g, tipo: "G", nota: null, fin: g.slice(-4), origen: "enlace" });
    const conNota = destinoDelEnlace({ direccion: g, nota: 5n }, propia);
    expect(conNota).toMatchObject({ hacia: direccionConNota(g, 5n), base: g, tipo: "M", nota: 5n, origen: "enlace" });
    expect(destinoDelEnlace({ direccion: m, nota: null }, propia)).toEqual({ hacia: m, base: g, tipo: "M", nota: 77n, fin: g.slice(-4), origen: "enlace" });
    expect(destinoDelEnlace({ direccion: c, nota: null }, propia)).toEqual({ hacia: c, base: c, tipo: "C", nota: null, fin: c.slice(-4), origen: "enlace" });
  });

  it("mandarse a la propia cuenta no se puede", () => {
    expect(destinoDelEnlace({ direccion: c, nota: null }, c)).toEqual({ motivo: "a-si-misma" });
  });

  it("el destino de la página es una M de esa cuenta con la nota de prueba", () => {
    const d = destinoDeLaPagina(g);
    expect(d).toEqual({ hacia: direccionConNota(g, NOTA_DE_PRUEBA), base: g, tipo: "M", nota: NOTA_DE_PRUEBA, fin: g.slice(-4), origen: "pagina" });
  });
});

describe("la cuenta de prueba que pide nota", () => {
  it("se arma con dos operaciones: crearla con saldo y ponerle la marca, que firma ella", () => {
    const origen = Keypair.random().publicKey();
    const tx = TransactionBuilder.fromXDR(armarCuentaQuePideNota({ origen, secuencia: "100", destino: g }), RED_DE_PRUEBA.passphrase) as Transaction;
    expect(tx.operations).toHaveLength(2);
    expect(tx.source).toBe(origen);
    expect(tx.operations[0]).toMatchObject({ type: "createAccount", destination: g, startingBalance: "2.0000000" });
    expect(tx.operations[1]).toMatchObject({ type: "manageData", name: "config.memo_required", source: g });
    const valor = (tx.operations[1] as unknown as { value: Uint8Array }).value;
    expect(new TextDecoder().decode(valor)).toBe("1");
    expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThan(0);
  });

  it("la llave del destino firma sin guardarse, y la firma es de esa cuenta", () => {
    const llave = llaveDeDestinoNueva();
    expect(StrKey.isValidEd25519PublicKey(llave.publica)).toBe(true);
    const origen = Keypair.random().publicKey();
    const firmada = llave.firmar(armarCuentaQuePideNota({ origen, secuencia: "100", destino: llave.publica }));
    const tx = TransactionBuilder.fromXDR(firmada, RED_DE_PRUEBA.passphrase) as Transaction;
    expect(tx.signatures).toHaveLength(1);
    expect(llaveDeDestinoNueva().publica).not.toBe(llave.publica);
  });
});

describe("saber si una cuenta pide nota", () => {
  const respuesta = (cuerpo: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;

  it("con la marca en el historial pide nota, sin ella no", async () => {
    expect(await pideNota(g, { fetchFn: respuesta({ data: { "config.memo_required": "MQ==" } }) })).toBe(true);
    expect(await pideNota(g, { fetchFn: respuesta({ data: {} }) })).toBe(false);
    expect(await pideNota(g, { fetchFn: respuesta({}) })).toBe(false);
  });

  it("una cuenta que todavía no está, un 5xx o un corte dan null, nunca falso", async () => {
    expect(await pideNota(g, { fetchFn: respuesta({}, 404) })).toBeNull();
    expect(await pideNota(g, { fetchFn: respuesta({}, 503) })).toBeNull();
    const corte = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    expect(await pideNota(g, { fetchFn: corte })).toBeNull();
  });

  it("pregunta al historial de la red de prueba por esa cuenta", async () => {
    const vistas: string[] = [];
    const f = (async (url: string) => {
      vistas.push(String(url));
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await pideNota(g, { fetchFn: f });
    expect(vistas).toEqual([`${RED_DE_PRUEBA.horizon}/accounts/${g}`]);
  });
});
