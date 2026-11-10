import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { actividadDe, calcular, comprobar, decodificarEvento, dia, marcaDe, mes, partesDelId, semana, unir } from "./metricas-cadena.mjs";

/**
 * Eventos inventados: no se toca la red. Las direcciones son de mentira.
 */
const C1 = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const A = "GBVGOF7TTAYFZQ4576VVA6EZADYEN7IHRDHPJD3CBRXRLTPQNXDSF254";
const B = "GAB2C66DMMHZBOGXMMX5N3I4KP6JLNMHGZMBMDP3YX4JQZQJYYFP7VQF";
const INTERNA = "GAYWGZ4P5NHJU2UL7TGWSP6ZF5BYEBZ4WP7TZDBDZ3FXUN5DHGAMDGKU";
const EJEMPLO = "e".repeat(64);
const h = (c) => c.repeat(64).slice(0, 64);

/** Un instante UTC en segundos. */
const t = (iso) => Math.floor(Date.parse(iso) / 1000);

let seq = 0;
const sello = (id, organizador, cuando, extra = {}) => ({
  tipo: "sealed",
  eventoId: `s${id}-${organizador.slice(0, 3)}-${++seq}`,
  contrato: C1,
  id,
  organizador,
  count: 10,
  numWinners: 1,
  round: 100 + id,
  listHash: h(String(id % 10)),
  ts: t(cuando),
  toid: BigInt(seq * 1000),
  ...extra,
});
const registro = (id, cuando, ganadores = [3]) => ({ tipo: "drawn", eventoId: `d${id}-${++seq}`, contrato: C1, id, round: 100 + id, ganadores, ts: t(cuando), toid: BigInt(seq * 1000) });
const ahora = t("2026-11-05T12:00:00Z");

const numeros = (eventos, op = {}) => calcular(unir(eventos).sorteos, { ahora, ...op });

describe("las fechas", () => {
  it("el día, la semana (por su lunes) y el mes son UTC", () => {
    expect(dia(t("2026-11-05T23:59:59Z"))).toBe("2026-11-05");
    expect(dia(t("2026-11-06T00:00:00Z"))).toBe("2026-11-06");
    expect(semana(t("2026-11-05T10:00:00Z"))).toBe("2026-11-02"); // jueves -> lunes
    expect(semana(t("2026-11-08T23:00:00Z"))).toBe("2026-11-02"); // domingo -> el mismo lunes
    expect(semana(t("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
    expect(mes(t("2026-10-31T23:00:00Z"))).toBe("2026-10");
  });
  it("el id de un evento trae ledger, orden y operación", () => {
    const toid = (5564036n << 32n) | (5n << 12n) | 1n;
    expect(partesDelId(`${toid.toString().padStart(18, "0")}-0000`)).toMatchObject({ ledger: 5564036, orden: 5, operacion: 1 });
  });
});

describe("la marca del meta", () => {
  it("reconoce #fila y #premios=N, y nada más", () => {
    expect(marcaDe("#fila Termo")).toEqual({ fila: true, premios: false });
    expect(marcaDe("#premios=3 Libro")).toEqual({ fila: false, premios: true });
    expect(marcaDe("#fila #premios=2")).toEqual({ fila: true, premios: true });
    expect(marcaDe("Sorteo de comunidad")).toEqual({ fila: false, premios: false });
    expect(marcaDe("a#fila")).toEqual({ fila: false, premios: false });
    expect(marcaDe("#premios=")).toEqual({ fila: false, premios: false });
  });
});

describe("decodificar un evento de verdad", () => {
  const tema = (x) => nativeToScVal(x, { type: "symbol" }).toXdr("base64");
  const u64 = (n) => nativeToScVal(BigInt(n), { type: "u64" }).toXdr("base64");
  it("un sealed trae organizador, lista y cantidad", () => {
    const campos = {
      count: nativeToScVal(18, { type: "u32" }),
      list_hash: nativeToScVal(Buffer.alloc(32, 7), { type: "bytes" }),
      num_winners: nativeToScVal(3, { type: "u32" }),
      round: nativeToScVal(99n, { type: "u64" }),
    };
    const cuerpo = xdr.ScVal.scvMap(Object.entries(campos).map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v }))).toXdr("base64");
    const e = decodificarEvento({ id: "023897352653787137-0000", ts: 1, contract: C1, topicsXdr: [tema("sealed"), u64(570), new Address(A).toScVal().toXdr("base64")], bodyXdr: cuerpo });
    expect(e).toMatchObject({ tipo: "sealed", id: 570, organizador: A, count: 18, numWinners: 3, round: 99, ledger: 5564036 });
    expect(e.listHash).toBe("07".repeat(32));
  });
  it("lo que no es sealed ni drawn se descarta", () => {
    expect(decodificarEvento({ id: "1-0", ts: 1, contract: C1, topicsXdr: [tema("otro")], bodyXdr: nativeToScVal(1, { type: "u32" }).toXdr("base64") })).toBeNull();
  });
});

describe("sumar", () => {
  const eventos = [
    sello(1, A, "2026-11-02T10:00:00Z", { count: 20 }),
    registro(1, "2026-11-02T10:05:00Z", [1, 2]),
    sello(2, A, "2026-11-04T09:00:00Z", { count: 30 }), // A vuelve otro día, misma semana
    registro(2, "2026-11-04T09:03:00Z"),
    sello(3, B, "2026-11-04T11:00:00Z", { count: 5 }), // se queda sin sortear
    sello(4, INTERNA, "2026-11-04T12:00:00Z", { count: 100 }),
    registro(4, "2026-11-04T12:02:00Z"),
    sello(5, B, "2026-11-05T11:30:00Z", { count: 7 }), // hace media hora: todavía no cuenta como abandonado
  ];
  const r = numeros(eventos, { internas: new Set([INTERNA]) });

  it("cuenta sellos, registros, lugares y ganadores, sin las internas", () => {
    expect(r.sinInternas.totales).toMatchObject({ sorteosSellados: 4, sorteosRegistrados: 2, lugaresEnListas: 62, ganadores: 3, organizadoresDistintos: 2 });
    expect(r.todas.totales).toMatchObject({ sorteosSellados: 5, sorteosRegistrados: 3, lugaresEnListas: 162, organizadoresDistintos: 3 });
    expect(r.internas).toEqual({ cuentasQueAparecen: 1, sorteosSellados: 1, sorteosRegistrados: 1, lugaresEnListas: 100 });
  });
  it("cierres sin sortear: solo pasada una hora", () => {
    expect(r.sinInternas.totales.cierresSinSortear).toBe(1);
    expect(r.todas.porDia["2026-11-04"].cierresSinSortear).toBe(1);
    expect(r.todas.porDia["2026-11-05"].cierresSinSortear).toBe(0);
  });
  it("por día: el registro cuenta en su día y los organizadores son distintos", () => {
    expect(r.sinInternas.porDia["2026-11-02"]).toMatchObject({ sorteosSellados: 1, sorteosRegistrados: 1, organizadoresDistintos: 1, organizadoresNuevos: 1 });
    expect(r.sinInternas.porDia["2026-11-04"]).toMatchObject({ sorteosSellados: 2, sorteosRegistrados: 1, organizadoresDistintos: 2, organizadoresNuevos: 1 });
  });
  it("por semana y mes", () => {
    expect(Object.keys(r.sinInternas.porSemana)).toEqual(["2026-11-02"]);
    expect(r.sinInternas.porSemana["2026-11-02"]).toMatchObject({ sorteosSellados: 4, organizadoresDistintos: 2, lugaresEnListas: 62 });
    expect(r.sinInternas.porMes["2026-11"].sorteosSellados).toBe(4);
  });
  it("quién vuelve: dos o más días, dos o más semanas", () => {
    expect(r.sinInternas.totales.organizadoresQueVuelvenDias).toBe(2); // A (2 y 4) y B (4 y 5)
    expect(r.sinInternas.totales.organizadoresQueVuelvenSemanas).toBe(0); // todo cae en la semana del lunes 2
  });
  it("tiempo hasta el primer sorteo de cada cuenta", () => {
    // A: sello 10:00, primer registro 10:05 = 300 s. B nunca registró.
    expect(r.sinInternas.totales.primerSorteo).toMatchObject({ cuentasConSorteo: 1, cuentasSinSorteoTodavia: 1, medianaSegundos: 300, maximoSegundos: 300 });
  });
});

describe("las semanas que se cruzan", () => {
  it("una cuenta que sella en dos lunes distintos vuelve por semanas", () => {
    const r = numeros([sello(1, A, "2026-10-29T10:00:00Z"), sello(2, A, "2026-11-03T10:00:00Z"), sello(3, B, "2026-11-03T10:00:00Z")]);
    expect(r.todas.totales).toMatchObject({ organizadoresQueVuelvenDias: 1, organizadoresQueVuelvenSemanas: 1, organizadoresDistintos: 2 });
    // Dentro de una semana concreta, A solo se ve en un día de esa semana.
    expect(r.todas.porSemana["2026-11-02"].organizadoresQueVuelvenSemanas).toBe(0);
  });
});

describe("marcas y listas repetidas", () => {
  it("separa #fila, #premios y sin marca (el meta sale de la transacción)", () => {
    const evs = [sello(1, A, "2026-11-04T10:00:00Z"), sello(2, A, "2026-11-04T11:00:00Z"), sello(3, B, "2026-11-04T12:00:00Z")];
    const tx = (e, meta) => ({ hash: `h${e.id}`, cerroEn: e.ts, exitosa: true, comisionStroops: 100, cuentaFuente: e.organizador, cuentaQuePaga: e.organizador, llamada: { funcion: "seal", contrato: C1, listHash: e.listHash, count: e.count, organizador: e.organizador, meta } });
    const txs = { [evs[0].eventoId]: tx(evs[0], "#fila"), [evs[1].eventoId]: tx(evs[1], "#premios=2 Termo"), [evs[2].eventoId]: tx(evs[2], "") };
    const u = unir(evs, txs);
    expect(u.problemas).toEqual([]);
    const r = calcular(u.sorteos, { ahora });
    expect(r.todas.totales.marcas).toEqual({ fila: 1, premios: 1, sinMarca: 1 });
    expect(r.todas.totales.comisionStroops).toBe(300);
  });
  it("la misma lista sellada más de una vez", () => {
    const r = numeros([sello(1, A, "2026-11-04T10:00:00Z", { listHash: h("a") }), sello(2, B, "2026-11-04T10:10:00Z", { listHash: h("a") }), sello(3, A, "2026-11-04T10:20:00Z", { listHash: h("a") }), sello(4, A, "2026-11-04T10:30:00Z", { listHash: h("b") })]);
    expect(r.todas.totales.listasRepetidas).toEqual({ listasDistintas: 2, listasSelladasMasDeUnaVez: 1, sellosEnListasRepetidas: 3, sellosSobrantes: 2, vecesMaxima: 3, selladasPorMasDeUnaCuenta: 1 });
  });
  it("la vista sin la lista de ejemplo la descuenta", () => {
    const r = numeros([sello(1, A, "2026-11-04T10:00:00Z", { listHash: EJEMPLO }), sello(2, B, "2026-11-04T10:10:00Z", { listHash: h("a") })], { ejemplos: new Set([EJEMPLO]) });
    expect(r.todas.totales.sorteosSellados).toBe(2);
    expect(r.sinInternasNiEjemplo.totales).toMatchObject({ sorteosSellados: 1, organizadoresDistintos: 1 });
    expect(r.ejemplo).toMatchObject({ sorteosSellados: 1, organizadoresDistintos: 1 });
  });
});

describe("el mismo resultado con los mismos eventos", () => {
  it("el orden de entrada no cambia nada", () => {
    const evs = [sello(1, A, "2026-11-02T10:00:00Z"), registro(1, "2026-11-02T10:05:00Z"), sello(2, B, "2026-11-03T10:00:00Z"), sello(3, A, "2026-11-04T10:00:00Z")];
    const una = JSON.stringify(numeros(evs));
    const otra = JSON.stringify(numeros([...evs].reverse()));
    expect(otra).toBe(una);
  });
  it("sin el momento del corte no calcula", () => {
    expect(() => calcular([], {})).toThrow(/corte/);
  });
});

describe("unir avisa lo que no cuadra", () => {
  it("un registro sin sello, un sello repetido y un registro repetido", () => {
    const s = sello(1, A, "2026-11-04T10:00:00Z");
    const u = unir([s, { ...s, eventoId: "otro", toid: s.toid + 1n }, registro(9, "2026-11-04T11:00:00Z"), registro(1, "2026-11-04T11:00:00Z"), registro(1, "2026-11-04T12:00:00Z")]);
    expect(u.sorteos).toHaveLength(1);
    expect(u.problemas.map((p) => p.split(":")[0]).sort()).toEqual(["registro repetido", "registro sin sello", "sellado repetido"]);
  });
  it("un sello que no coincide con su transacción", () => {
    const s = sello(1, A, "2026-11-04T10:00:00Z");
    const u = unir([s], { [s.eventoId]: { hash: "x", cerroEn: s.ts, exitosa: true, comisionStroops: 1, cuentaFuente: A, cuentaQuePaga: A, llamada: { funcion: "seal", contrato: C1, listHash: h("f"), count: s.count, organizador: A, meta: "" } } });
    expect(u.problemas[0]).toMatch(/no coincide/);
  });
  it("la comisión pagada por otra cuenta cuenta como patrocinada", () => {
    const s = sello(1, A, "2026-11-04T10:00:00Z");
    const u = unir([s], { [s.eventoId]: { hash: "x", cerroEn: s.ts, exitosa: true, comisionStroops: 1, cuentaFuente: A, cuentaQuePaga: B, llamada: { funcion: "seal", contrato: C1, listHash: s.listHash, count: s.count, organizador: A, meta: "" } } });
    expect(calcular(u.sorteos, { ahora }).todas.totales.patrocinadas).toBe(1);
  });
});

describe("comprobar", () => {
  const contratos = [{ contractId: C1 }];
  const sellos = (...ids) => ids.map((id) => ({ contrato: C1, tipo: "sealed", id }));
  it("cuadra con next_id y sin huecos", () => {
    expect(comprobar({ contratos, eventos: sellos(1, 2, 3), nextIds: { [C1]: 4 } }).ok).toBe(true);
  });
  it("falla con un hueco, con un next_id distinto o con eventos sin transacción", () => {
    expect(comprobar({ contratos, eventos: sellos(1, 3), nextIds: { [C1]: 4 } }).ok).toBe(false);
    expect(comprobar({ contratos, eventos: sellos(1, 2, 3), nextIds: { [C1]: 5 } }).ok).toBe(false);
    expect(comprobar({ contratos, eventos: sellos(1, 2, 3), nextIds: { [C1]: 4 }, sinTransaccion: 1 }).ok).toBe(false);
    expect(comprobar({ contratos, eventos: sellos(1, 2, 3), nextIds: { [C1]: 4 }, problemas: ["x"] }).ok).toBe(false);
  });
  it("un next_id que no se pudo leer se avisa pero no falla", () => {
    const r = comprobar({ contratos, eventos: sellos(1, 2), nextIds: {} });
    expect(r.ok).toBe(true);
    expect(r.lineas.some((l) => l.startsWith("--"))).toBe(true);
  });
});

describe("actividadDe", () => {
  const json = (o) => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(o) });
  it("pide una cuenta o un contrato, no los dos ni ninguno", async () => {
    await expect(actividadDe({})).rejects.toThrow();
    await expect(actividadDe({ cuenta: A, contrato: C1 })).rejects.toThrow();
  });
  it("de un contrato: ledger, hora, tema y firmante de cada evento", async () => {
    const temas = [nativeToScVal("sealed", { type: "symbol" }).toXdr("base64")];
    const fake = () => json({ _embedded: { records: [{ id: "023897352653787137-0000", ts: 1793843820, initiator: A, topicsXdr: temas, bodyXdr: nativeToScVal(1, { type: "u32" }).toXdr("base64") }] } });
    const filas = await actividadDe({ contrato: C1 }, { fetch: fake });
    expect(filas).toEqual([{ ledger: 5564036, cerroEn: 1793843820, eventoId: "023897352653787137-0000", tema: "sealed", temas: ["sealed"], cuerpo: 1, firmante: A }]);
  });
  it("de una cuenta: sus transacciones con ledger y hora", async () => {
    const fake = () => json({ _embedded: { records: [{ ledger: 10, created_at: "2026-11-05T01:57:00Z", hash: "ab", successful: true, source_account: A, paging_token: "99" }] } });
    expect(await actividadDe({ cuenta: A }, { fetch: fake })).toEqual([{ ledger: 10, cerroEn: t("2026-11-05T01:57:00Z"), hash: "ab", exitosa: true, cuentaFuente: A, cursor: "99" }]);
  });
});

describe("la lista pública de cuentas internas y el archivo de totales", () => {
  it("contratosDe pone el vigente primero y mainnet sin contrato da vacío", async () => {
    const { contratosDe, cuentasInternas, listasDeEjemplo } = await import("../metricas-cadena.mjs");
    const d = { testnet: { contractId: "C1", anteriores: [{ contractId: "C0", ultimoId: 9 }] }, mainnet: null };
    expect(contratosDe(d, "testnet")).toEqual([
      { contractId: "C1", vigente: true },
      { contractId: "C0", vigente: false, ultimoId: 9 },
    ]);
    expect(contratosDe(d, "mainnet")).toEqual([]);
    const lista = { cuentas: [{ direccion: "GA", etiqueta: "interna", red: "testnet" }, { direccion: "GB", etiqueta: "interna", red: "mainnet" }, { direccion: "GC", etiqueta: "otra" }], listasDeEjemplo: [{ listHash: "ab" }] };
    expect([...cuentasInternas(lista, "testnet")]).toEqual(["GA"]);
    expect([...listasDeEjemplo(lista)]).toEqual(["ab"]);
  });
  it("docs/cuentas-internas.json solo trae direcciones etiquetadas, sin nombres de personas", async () => {
    const { readFileSync } = await import("node:fs");
    const lista = JSON.parse(readFileSync(new URL("../../docs/cuentas-internas.json", import.meta.url), "utf8"));
    for (const c of lista.cuentas) {
      expect(Object.keys(c).sort()).toEqual(["direccion", "etiqueta", "motivo", "red"]);
      expect(c.etiqueta).toBe("interna");
      expect(c.direccion).toMatch(/^G[A-Z2-7]{55}$/);
    }
  });
  it("los totales versionados no traen ninguna cuenta ni lista", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../docs/metricas/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => /^totales-.*\.json$/.test(x))) {
      const texto = readFileSync(new URL(f, dir), "utf8");
      expect(texto, f).not.toMatch(/\bG[A-Z2-7]{55}\b/);
      expect(texto, f).not.toMatch(/[0-9a-f]{64}/);
    }
  });
});

describe("pedirJson", () => {
  it("espera y reintenta ante un 429, y da null en un 404", async () => {
    const { pedirJson } = await import("./metricas-cadena.mjs");
    let n = 0;
    const f = () => {
      n++;
      return Promise.resolve(n === 1 ? { status: 429, ok: false, headers: { get: () => "0" } } : { status: 200, ok: true, json: () => Promise.resolve({ listo: true }) });
    };
    expect(await pedirJson("x", { fetch: f, esperaMs: 1 })).toEqual({ listo: true });
    expect(n).toBe(2);
    expect(await pedirJson("x", { fetch: () => Promise.resolve({ status: 404, ok: false }) })).toBeNull();
  });
});
