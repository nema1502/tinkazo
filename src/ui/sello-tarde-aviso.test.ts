import { describe, expect, it } from "vitest";
import { errorDeRespuesta } from "../stellar/patrocinador";
import { T } from "../i18n";
import { avisoTrasFallarEnLaCadena, entroYFalloEnLaCadena } from "./sello-tarde-aviso";

/**
 * Lo que se dice después de un sello que entró a la cadena y falló ahí, con el portero cobrando sorteos oficiales. Es lo
 * que pasó el 13 de noviembre de 2026: la firma tardó, el sello entró tarde, el contrato lo rechazó y el reintento
 * encontró la cuenta en cero. La pantalla decía Se te acabaron los sorteos oficiales, como si fuera de la persona.
 */

/** Así se frena un sello antes de mandarlo (`RondaMuyCerca` en `anchor.ts`): no queda nada en la cadena. */
function frenadoAntes(): Error {
  const e = new Error("la ronda quedó cerca antes de mandar el sello (faltan 31 s): Error(Contract, #5)");
  e.name = "RondaMuyCerca";
  return e;
}

describe("qué intento entró a la cadena y falló ahí", () => {
  it("el sello que el portero mandó y falló en un ledger (tx-FAILED). El error 5 suelto, no (sello-tarde-detector.test.ts)", () => {
    expect(entroYFalloEnLaCadena(new Error("tx-FAILED"))).toBe(true);
    expect(entroYFalloEnLaCadena(new Error("Transaction failed!"))).toBe(true);
  });

  it("el que se frenó antes de mandar no: no gastó nada", () => {
    expect(entroYFalloEnLaCadena(frenadoAntes())).toBe(false);
  });

  it("lo que no entró a ningún ledger tampoco: vencido, la secuencia, un corte o el portero que dijo que no", () => {
    for (const m of ["tx-EXPIRED", "tx_bad_seq", "tx_too_late", "Failed to fetch", "rpc-sin-respuesta: 503"]) expect(entroYFalloEnLaCadena(new Error(m)), m).toBe(false);
    expect(entroYFalloEnLaCadena(errorDeRespuesta(402, { motivo: "sin-sorteos", vencieron: 0 }))).toBe(false);
    expect(entroYFalloEnLaCadena(null)).toBe(false);
  });
});

describe("qué se dice con el portero que devuelve (lo anunció en /cupo)", () => {
  const sinSorteos = errorDeRespuesta(402, { motivo: "sin-sorteos", vencieron: 0 });
  const nuevo = { cobroPorUso: true, devuelve: true };

  it("la noche del 13: entró tarde, falló, y el reintento encontró cero sorteos. No sale Se te acabaron", () => {
    expect(avisoTrasFallarEnLaCadena(sinSorteos, { fallosEnLaCadena: 1, ...nuevo })).toBe("sin-sorteos");
  });

  it("los tres intentos fallaron en la cadena: el error de siempre, con lo que pasa con el sorteo", () => {
    expect(avisoTrasFallarEnLaCadena(new Error("tx-FAILED"), { fallosEnLaCadena: 3, ...nuevo })).toBe("aviso");
  });

  it("sin ningún intento que haya entrado a la cadena, como siempre: con cero sorteos, Se te acabaron", () => {
    expect(avisoTrasFallarEnLaCadena(sinSorteos, { fallosEnLaCadena: 0, ...nuevo })).toBeNull();
    expect(avisoTrasFallarEnLaCadena(new Error("tx-FAILED"), { fallosEnLaCadena: 0, ...nuevo })).toBeNull();
  });

  it("sin el cobro por uso (la billetera propia, la cuenta de prueba, la red de prueba) no hay sorteo que nombrar", () => {
    expect(avisoTrasFallarEnLaCadena(new Error("tx-FAILED"), { fallosEnLaCadena: 2, cobroPorUso: false, devuelve: true })).toBeNull();
  });
});

describe("qué se dice con un portero de antes (no anunció la devolución)", () => {
  const sinSorteos = errorDeRespuesta(402, { motivo: "sin-sorteos", vencieron: 0 });
  const viejo = { cobroPorUso: true, devuelve: false };

  it("con cero sorteos, Se te acabaron como antes: ese portero no devuelve nada y no se promete", () => {
    expect(avisoTrasFallarEnLaCadena(sinSorteos, { fallosEnLaCadena: 1, ...viejo })).toBeNull();
  });

  it("con otro error, el de siempre y que no fue su error, con a dónde escribir, sin prometer que vuelve", () => {
    expect(avisoTrasFallarEnLaCadena(new Error("tx-FAILED"), { fallosEnLaCadena: 3, ...viejo })).toBe("aviso-sin-devolucion");
  });

  it("sin el cobro por uso, nada", () => {
    expect(avisoTrasFallarEnLaCadena(new Error("tx-FAILED"), { fallosEnLaCadena: 3, cobroPorUso: false, devuelve: false })).toBeNull();
  });
});

describe("los textos", () => {
  it("con el portero que devuelve: qué pasó, que no fue un error de la persona, que el sorteo vuelve y a dónde escribir si no lo ve", () => {
    expect(T.es.selloTardeSinSorteos).toBe(
      "La lista no quedó sellada a tiempo, y no fue un error tuyo. Ese intento usó un sorteo oficial. Si falló por llegar tarde, vuelve solo en unos minutos. Después tocá Sellar la lista otra vez. Si no lo ves de vuelta, escribinos a hola@tinkazo.app.",
    );
    expect(T.en.selloTardeSinSorteos).toBe(
      "Your list wasn't sealed in time, and it wasn't your fault. That attempt used a Live draw. If it failed because it arrived late, it comes back in a few minutes. Then tap Seal the list again. If you don't see it back, write to us at hola@tinkazo.app.",
    );
    expect(T.es.selloTardeAviso).toBe("No fue un error tuyo. Si algún intento usó un sorteo oficial, vuelve solo en unos minutos. Si no lo ves de vuelta, escribinos a hola@tinkazo.app.");
    expect(T.en.selloTardeAviso).toBe("It wasn't your fault. If an attempt used a Live draw, it comes back on its own in a few minutes. If you don't see it back, write to us at hola@tinkazo.app.");
  });

  it("con un portero de antes: no promete ninguna devolución", () => {
    expect(T.es.selloTardeAvisoSinDevolucion).toBe("No fue un error tuyo. Si algún intento usó un sorteo oficial y te hace falta, escribinos a hola@tinkazo.app.");
    expect(T.en.selloTardeAvisoSinDevolucion).toBe("It wasn't your fault. If an attempt used a Live draw and you need it back, write to us at hola@tinkazo.app.");
    for (const l of ["es", "en"] as const) expect(T[l].selloTardeAvisoSinDevolucion, l).not.toMatch(/vuelve solo|comes back/);
  });

  it("sin palabras técnicas, sin comillas angulares ni punto y coma", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of ["selloTardeSinSorteos", "selloTardeAviso", "selloTardeAvisoSinDevolucion"]) {
        const s = T[l][k] ?? "";
        expect(s, `${l}.${k}`).not.toBe("");
        expect(s, `${l}.${k}`).not.toMatch(/[«»;]/);
        expect(s, `${l}.${k}`).not.toMatch(/\b(ronda|round|firma|signature|ledger|contrato|contract|red|network|token|hash|transacci[oó]n|transaction|XLM|drand|rifa|raffle|ticket|loter[ií]a|lottery)\b/i);
      }
    }
  });
});
