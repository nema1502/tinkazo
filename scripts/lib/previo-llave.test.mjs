import { Contract } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { RED_DE_PRUEBA } from "../../src/prueba-llave/red";
import { claveDeCodigo, claveDeInstancia, controlPrevio, RED } from "./previo-llave.mjs";

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status });

/** Una red de mentira. `cambios` pisa lo que contesta cada parte. */
function redFalsa(cambios = {}) {
  const pedidos = [];
  const bien = {
    ledger: { result: { sequence: 5_000_000 } },
    entradas: { result: { entries: [{ xdr: "x" }] } },
    horizon: { signers: [{ key: RED.desplegador, weight: 1 }], thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 } },
    friendbot: { status: 400 },
    drand: { round: 123 },
  };
  const c = { ...bien, ...cambios };
  const fetchFn = async (url, init) => {
    const u = String(url);
    pedidos.push(u);
    if (u === RED.rpc) {
      const { method } = JSON.parse(String(init?.body));
      if (method === "getLatestLedger") return c.ledger instanceof Error ? Promise.reject(c.ledger) : respuesta(c.ledger);
      if (method === "getLedgerEntries") return typeof c.entradas === "function" ? respuesta(c.entradas(JSON.parse(String(init?.body)).params.keys[0])) : respuesta(c.entradas);
    }
    if (u.startsWith(RED.horizon)) return c.horizon === 404 ? respuesta({}, 404) : respuesta(c.horizon);
    if (u.startsWith(RED.friendbot)) return c.friendbot instanceof Error ? Promise.reject(c.friendbot) : respuesta({}, c.friendbot.status);
    if (u.includes("drand")) return c.drand instanceof Error ? Promise.reject(c.drand) : respuesta(c.drand);
    return respuesta({}, 404);
  };
  return { fetchFn, pedidos };
}

describe("las direcciones del control previo", () => {
  it("son las de la prueba", () => {
    for (const k of ["rpc", "horizon", "friendbot", "contrato", "codigoCuenta", "verificador", "desplegador"]) {
      expect(RED[k], k).toBe(RED_DE_PRUEBA[k]);
    }
  });

  it("la llave de la instancia es la que arma el SDK", () => {
    for (const c of [RED.contrato, RED.verificador]) {
      expect(claveDeInstancia(c)).toBe(new Contract(c).getFootprint().toXDR("base64"));
    }
  });

  it("la llave del código lleva el tipo 7 y el hash", () => {
    const b = Buffer.from(claveDeCodigo(RED.codigoCuenta), "base64");
    expect(b.length).toBe(36);
    expect(b.readUInt32BE(0)).toBe(7);
    expect(b.subarray(4).toString("hex")).toBe(RED.codigoCuenta);
  });
});

describe("el control previo", () => {
  it("con todo en su lugar sale con 0", async () => {
    const r = await controlPrevio({ fetchFn: redFalsa().fetchFn });
    expect(r.salida).toBe(0);
    expect(r.motivo).toBeNull();
    expect(r.datos).toMatchObject({ codigo: true, verificador: true, contrato: true, desplegadorIntacto: true, friendbot: 400, drand: true });
  });

  it("si falta el código, el verificador o el contrato, la red de prueba cambió", async () => {
    const r = await controlPrevio({ fetchFn: redFalsa({ entradas: { result: { entries: [] } } }).fetchFn });
    expect(r.salida).toBe(2);
    expect(r.motivo).toBe("la-red-de-prueba-cambio");
    expect(r.fallas).toHaveLength(3);
  });

  it("si el desplegador desapareció o cambió de firmantes, la red de prueba cambió", async () => {
    expect((await controlPrevio({ fetchFn: redFalsa({ horizon: 404 }).fetchFn })).motivo).toBe("la-red-de-prueba-cambio");
    const otro = { signers: [{ key: RED.desplegador, weight: 1 }, { key: "GOTRA", weight: 1 }], thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 } };
    expect((await controlPrevio({ fetchFn: redFalsa({ horizon: otro }).fetchFn })).motivo).toBe("la-red-de-prueba-cambio");
    const umbral = { signers: [{ key: RED.desplegador, weight: 1 }], thresholds: { low_threshold: 0, med_threshold: 2, high_threshold: 0 } };
    expect((await controlPrevio({ fetchFn: redFalsa({ horizon: umbral }).fetchFn })).motivo).toBe("la-red-de-prueba-cambio");
  });

  it("si el grifo o el servicio de azar no contestan, no se pudo medir", async () => {
    const grifo = await controlPrevio({ fetchFn: redFalsa({ friendbot: new Error("caído") }).fetchFn });
    expect(grifo.salida).toBe(2);
    expect(grifo.motivo).toBe("no-se-pudo-medir");
    const grifo5xx = await controlPrevio({ fetchFn: redFalsa({ friendbot: { status: 503 } }).fetchFn });
    expect(grifo5xx.motivo).toBe("no-se-pudo-medir");
    const azar = await controlPrevio({ fetchFn: redFalsa({ drand: new Error("caído") }).fetchFn });
    expect(azar.motivo).toBe("no-se-pudo-medir");
  });

  it("un grifo que contesta 400 o 200 a un pedido sin dirección cuenta como vivo", async () => {
    for (const status of [200, 400, 404]) {
      expect((await controlPrevio({ fetchFn: redFalsa({ friendbot: { status } }).fetchFn })).salida).toBe(0);
    }
  });

  it("no mira ningún índice ajeno: ningún pedido va a uno", async () => {
    const mundo = redFalsa();
    const r = await controlPrevio({ fetchFn: mundo.fetchFn });
    expect(r.datos).not.toHaveProperty("atrasoDelIndice");
    expect(mundo.pedidos.filter((u) => /mercury|indexer/i.test(u))).toEqual([]);
  });

  it("nunca sale con 1, que es el de la prueba fallida", async () => {
    const r = await controlPrevio({ fetchFn: redFalsa({ ledger: new Error("caído"), friendbot: new Error("caído") }).fetchFn });
    expect([0, 2]).toContain(r.salida);
  });
});
