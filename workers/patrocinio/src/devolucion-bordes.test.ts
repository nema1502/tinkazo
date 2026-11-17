/**
 * Los bordes de `Cupos.devolverSelloTardio` que no tenían prueba: un sello que gastó sorteos de dos derechos, un sello
 * de un mes que se devuelve en el siguiente y una devolución que se corta a la mitad.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { Cupos, type Sql } from "./cupos";
import { escena } from "./devolucion-prueba";
import { DEVOLUCIONES_POR_DIA, DEVOLUCIONES_POR_DIA_EN_TOTAL } from "./servicio";
import { sqlDePrueba } from "./sqlite-prueba";

const lim = { maxSellos: 100, maxSorteos: 100, topeGeneral: 150_000_000, reservaSorteo: 82_000, porSorteos: true };
const d = { ronda: 33_939_006, faltaban: 25, tope: DEVOLUCIONES_POR_DIA, topeGeneral: DEVOLUCIONES_POR_DIA_EN_TOTAL };
const H = "e".repeat(64);

/** Una cuenta del libro con un derecho de `sorteos` por cada número de la lista. */
function conDerechos(cupos: Cupos, ahora: number, ...derechos: number[]): string {
  const g = Keypair.random().publicKey();
  cupos.admitir(g, "cupon", ahora);
  derechos.forEach((n, i) => cupos.otorgar({ usuario: `u-${g}`, cuenta: g, origen: "cupon", ref: `cupon:${i}:${g}`, sorteos: n, dias: 60 }, ahora));
  return g;
}

describe("un sello que gastó sorteos de dos derechos", () => {
  it("con más de 50 ganadores tomó uno de cada derecho, y vuelve uno a cada uno", async () => {
    const s = escena();
    const m = await s.portero();
    // Una cuenta con dos derechos de un sorteo cada uno, de orígenes distintos. El sello lo firma la cuenta: hace falta su llave.
    const k = Keypair.random();
    s.e.red.cuentas.set(k.publicKey(), { patrocinador: null, balance: 100_000_000n });
    s.e.cupos.admitir(k.publicKey(), "cupon", s.e.ahora);
    s.e.cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "cupon", ref: `cupon:a:${k.publicKey()}`, sorteos: 1, dias: 60 }, s.e.ahora);
    s.e.cupos.otorgar({ usuario: `u-${k.publicKey()}`, cuenta: k.publicKey(), origen: "paquete", ref: `orden:b:${k.publicKey()}`, sorteos: 1, dias: 90 }, s.e.ahora);
    const a = s.sello(k, { ganadores: 60 });
    expect((await m.procesar(a.xdr)).estado).toBe(200);
    expect(s.quedan(k)).toBe(0);
    const suyos = () => (s.e.cupos.exportar(true).derechos ?? []).filter((x) => x.cuenta === k.publicKey());
    expect(suyos().map((x) => x.usados)).toEqual([1, 1]);
    s.entroTarde(a);
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.quedan(k)).toBe(2);
    expect(suyos().map((x) => x.usados)).toEqual([0, 0]);
    expect(s.e.anotado).toContainEqual({ evento: "sorteo-devuelto", datos: { hash: a.hash.slice(0, 8), motivo: "ronda-cerca", faltaban: 25, sorteos: 2 } });
  });
});

describe("un sello de un mes que se devuelve en el siguiente", () => {
  it("vuelve el sello del mes en que se gastó, y el mes nuevo no se toca", () => {
    const cupos = new Cupos(sqlDePrueba());
    const finDeMes = Date.UTC(2026, 10, 30, 23, 59, 50);
    const g = conDerechos(cupos, finDeMes, 2);
    expect(cupos.reservar({ hash: H, cuenta: g, metodo: "seal", estimado: 100_000, vence: Math.floor(finDeMes / 1000) + 240, ganadores: 1 }, finDeMes, lim)).toMatchObject({ ok: true });
    cupos.cerrar(H, "fallo", 6_000);
    const diciembre = Date.UTC(2026, 11, 1, 0, 0, 30);
    // Un sello del mes nuevo, que sí entró.
    expect(cupos.reservar({ hash: "f".repeat(64), cuenta: g, metodo: "seal", estimado: 100_000, vence: Math.floor(diciembre / 1000) + 240, ganadores: 1 }, diciembre, lim)).toMatchObject({ ok: true });
    expect(cupos.devolverSelloTardio(H, diciembre, d)).toEqual({ que: "devuelto", sorteos: 1 });
    expect(cupos.consultar(g, finDeMes, lim).sellos).toBe(0);
    expect(cupos.consultar(g, diciembre, lim).sellos).toBe(1);
    expect(cupos.quedan({ cuenta: g }, diciembre).quedan).toBe(1);
  });
});

describe("una devolución que se corta a la mitad", () => {
  it("no deja nada a medias: ni los sorteos, ni el sello del mes, ni la marca de devuelto; y la próxima vez se hace entera", () => {
    const base = sqlDePrueba();
    let cortar = false;
    const sql: Sql = {
      exec: (q, ...a) => {
        if (cortar && /INSERT INTO devoluciones/.test(q)) throw new Error("se cortó");
        return base.exec(q, ...a);
      },
      transaccion: (fn) => base.transaccion(fn),
    };
    const cupos = new Cupos(sql);
    const ahora = Date.now();
    const g = conDerechos(cupos, ahora, 1);
    cupos.reservar({ hash: H, cuenta: g, metodo: "seal", estimado: 100_000, vence: Math.floor(ahora / 1000) + 240, ganadores: 1 }, ahora, lim);
    cupos.cerrar(H, "fallo", 6_000);
    const foto = () => {
      const t = cupos.exportar(true);
      return { derechos: t.derechos, consumos: t.consumos, cuentas: t.cuentas, devoluciones: t.devoluciones };
    };
    const antes = foto();
    cortar = true;
    expect(() => cupos.devolverSelloTardio(H, ahora, d)).toThrow("se cortó");
    expect(foto()).toEqual(antes);
    expect(cupos.quedan({ cuenta: g }, ahora).quedan).toBe(0);
    cortar = false;
    expect(cupos.devolverSelloTardio(H, ahora, d)).toEqual({ que: "devuelto", sorteos: 1 });
    expect(cupos.quedan({ cuenta: g }, ahora).quedan).toBe(1);
  });
});
