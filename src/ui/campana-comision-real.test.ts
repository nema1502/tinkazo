import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { USDC_MAINNET } from "../stellar/pagos";

/**
 * El pago de la comisión con la cuenta de Google, con todo lo de afuera de mentira: Mandar, la billetera, la red y el
 * servicio de comisiones. Lo que se comprueba es el orden y lo que no se hace: nada se manda sin la prueba de que la red
 * está al día, y ningún caso que sale mal deja algo en el aire.
 */

const h = vi.hoisted(() => ({
  costo: null as { stroops: bigint; destino: string } | null,
  preparado: { ok: true, xdr: "" } as { ok: true; xdr: string } | { ok: false; motivo: string },
  enviado: "listo" as string,
  llamadas: [] as string[],
  datos: null as unknown,
  marca: null as number | null,
  /** La marca que deja la billetera al firmar: aparece recién cuando el pago sale. */
  marcaAlEnviar: null as number | null,
  prueba: { tipo: "al-dia" } as { tipo: string; hash?: string },
  pruebas: [] as bigint[],
  pagos: { tipo: "pagos", pagos: { premio: true, retiro: true, costoRetiro: 5_000_000n, enCurso: null } } as unknown,
  cuentaMirada: { secuencia: "1000", saldos: [] } as unknown,
  rpc: "no-se-sabe" as string,
}));

vi.mock("./mandar-usdc", () => ({
  depsDelSitio: () => ({
    costo: async () => h.costo,
    preparar: async (d: unknown) => {
      h.llamadas.push("preparar");
      h.datos = d;
      return h.preparado;
    },
    enviar: async () => {
      h.llamadas.push("enviar");
      if (h.marcaAlEnviar !== null) h.marca = h.marcaAlEnviar;
      return h.enviado;
    },
  }),
}));
vi.mock("../stellar/wallet-pollar", () => ({ MARCA_DEL_RETIRO: "marca", leerMarcaDeLaCuenta: () => h.marca, submitsItself: () => true }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => ({ address: "x" }) }));
vi.mock("../stellar/patrocinio-config", () => ({ configDelPortero: () => ({ url: "https://portero.ejemplo", porDefecto: false }) }));
vi.mock("../stellar/pago-portero", () => ({ mirarPagos: async () => h.pagos }));
vi.mock("../stellar/usdc-cuenta", () => ({ mirarCuenta: async () => h.cuentaMirada }));
vi.mock("../campana/comision-red", async (original) => ({
  ...(await original<typeof import("../campana/comision-red")>()),
  pruebaDeSecuencia: async (_o: string, secuencia: bigint) => {
    h.llamadas.push("prueba");
    h.pruebas.push(secuencia);
    return h.prueba;
  },
  estadoPorRpc: async () => h.rpc,
}));

import { network } from "../stellar/config";
import type { PedidoDePagoDeComision } from "./campana-comision";
import { depsDeComisionReales } from "./campana-comision-real";

const ORIGEN = cuentaDePrueba(5);
const CUENTA = cuentaDePrueba(2);
const COBROS = cuentaDePrueba(1);

/** Un pago armado de verdad con el SDK: la secuencia de la cuenta es 1000 y la de la transacción 1001. */
function xdrArmado(): string {
  const usdc = new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);
  return new TransactionBuilder(new Account(ORIGEN, "1000"), { fee: "1000", networkPassphrase: network.networkPassphrase })
    .addOperation(Operation.payment({ destination: CUENTA, asset: usdc, amount: "1.9000000" }))
    .addOperation(Operation.payment({ destination: COBROS, asset: usdc, amount: "0.5000000" }))
    .setTimeout(240)
    .build()
    .toXDR();
}

function pedido(): PedidoDePagoDeComision & { marcas: Array<[string, string | null]> } {
  const marcas: Array<[string, string | null]> = [];
  return {
    origen: ORIGEN,
    cuenta: CUENTA,
    cobros: COBROS,
    costo: 5_000_000n,
    sale: 24_000_000n,
    nota: "710126854477769",
    alMandar: (seq, hash) => void marcas.push([seq, hash]),
    marcas,
  };
}

beforeEach(() => {
  h.costo = { stroops: 5_000_000n, destino: COBROS };
  h.preparado = { ok: true, xdr: xdrArmado() };
  h.enviado = "listo";
  h.llamadas = [];
  h.datos = null;
  h.marca = null;
  h.marcaAlEnviar = null;
  h.prueba = { tipo: "al-dia" };
  h.pruebas = [];
  h.pagos = { tipo: "pagos", pagos: { premio: true, retiro: true, costoRetiro: 5_000_000n, enCurso: null } };
  h.cuentaMirada = { secuencia: "1000", saldos: [] };
  h.rpc = "no-se-sabe";
});

describe("pagar con la cuenta", () => {
  it("con todo en regla arma, prueba la secuencia, pone la marca y manda, en ese orden", async () => {
    const p = pedido();
    const r = await depsDeComisionReales().pagar(p);
    expect(h.llamadas).toEqual(["preparar", "prueba", "enviar"]);
    expect(r.tipo).toBe("listo");
    expect(p.marcas).toHaveLength(1);
    expect(p.marcas[0]?.[0]).toBe("1001");
    expect(p.marcas[0]?.[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pide armar el pago con la nota como número, el costo del retiro y lo que sale", async () => {
    await depsDeComisionReales().pagar(pedido());
    expect(h.datos).toMatchObject({
      origen: ORIGEN,
      destino: CUENTA,
      monto: 24_000_000n,
      nota: { tipo: "id", valor: "710126854477769" },
      costo: { stroops: 5_000_000n, destino: COBROS },
    });
  });

  it("la prueba de secuencia se hace con la secuencia de la cuenta, no con la de la transacción", async () => {
    await depsDeComisionReales().pagar(pedido());
    expect(h.pruebas).toEqual([1000n]);
  });

  it("una secuencia nueva con los pagos viejos da sin-mirar y no manda", async () => {
    h.prueba = { tipo: "atrasada" };
    const p = pedido();
    expect((await depsDeComisionReales().pagar(p)).tipo).toBe("sin-mirar");
    expect(h.llamadas).not.toContain("enviar");
    expect(p.marcas).toHaveLength(0);
  });

  it("sin poder ver la red tampoco manda", async () => {
    h.prueba = { tipo: "sin-consulta" };
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("sin-mirar");
    expect(h.llamadas).not.toContain("enviar");
  });

  it("una transacción de la cuenta con la nota ya en la red no se paga de nuevo", async () => {
    h.prueba = { tipo: "ya-hay-pago", hash: "c".repeat(64) };
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("ya-hay-pago");
    expect(h.llamadas).not.toContain("enviar");
  });

  it("un costo del retiro distinto del pedido no se paga", async () => {
    h.costo = { stroops: 7_000_000n, destino: COBROS };
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("ahora-no");
    expect(h.llamadas).toEqual([]);
  });

  it("una cuenta sin costo de retiro (no es de Google) no se paga", async () => {
    h.costo = null;
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("ahora-no");
  });

  it("con otra marca de la billetera viva no arma nada", async () => {
    h.marca = Math.floor(Date.now() / 1000) + 200;
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("ocupada");
    expect(h.llamadas).toEqual([]);
  });

  it("una marca de la billetera ya vencida no frena", async () => {
    h.marca = Math.floor(Date.now() / 1000) - 10;
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("listo");
  });

  it("sin saldo al preparar es sin-saldo", async () => {
    h.preparado = { ok: false, motivo: "sin-saldo" };
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("sin-saldo");
  });

  it("sin red al preparar es sin-mirar", async () => {
    h.preparado = { ok: false, motivo: "sin-red" };
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("sin-mirar");
  });

  it("una cuenta que no recibe, una regla o datos malos es ahora-no", async () => {
    for (const motivo of ["no-recibe", "regla", "datos", "sin-retiro", "apagado"]) {
      h.preparado = { ok: false, motivo };
      expect((await depsDeComisionReales().pagar(pedido())).tipo, motivo).toBe("ahora-no");
    }
  });

  it("un pago que quizás salió es en-curso, con hasta cuándo vive la marca de la billetera", async () => {
    h.enviado = "en-curso";
    h.marcaAlEnviar = 1_900_000_000;
    expect(await depsDeComisionReales().pagar(pedido())).toEqual({ tipo: "en-curso", hasta: 1_900_000_000_000 });
  });

  it("no-coincide-tope pide recargar y el resto de lo que no salió es no-salio", async () => {
    h.enviado = "no-coincide-tope";
    expect((await depsDeComisionReales().pagar(pedido())).tipo).toBe("recargar");
    for (const e of ["no-aprobado", "no-salio", "no-coincide"]) {
      h.enviado = e;
      expect((await depsDeComisionReales().pagar(pedido())).tipo, e).toBe("no-salio");
    }
  });
});

describe("el servicio de comisiones", () => {
  it("atiende retiros con el costo del cobro", async () => {
    expect(await depsDeComisionReales().portero(ORIGEN, 5_000_000n)).toBe("atiende");
  });

  it("con los retiros apagados dice que no", async () => {
    h.pagos = { tipo: "pagos", pagos: { premio: true, retiro: false, costoRetiro: 5_000_000n, enCurso: null } };
    expect(await depsDeComisionReales().portero(ORIGEN, 5_000_000n)).toBe("no");
  });

  it("con otro costo dice que no", async () => {
    expect(await depsDeComisionReales().portero(ORIGEN, 6_000_000n)).toBe("no");
  });

  it("sin el bloque de pagos dice que no, y sin respuesta, sin-respuesta", async () => {
    h.pagos = { tipo: "sin-pagos" };
    expect(await depsDeComisionReales().portero(ORIGEN, 5_000_000n)).toBe("no");
    h.pagos = { tipo: "sin-respuesta" };
    expect(await depsDeComisionReales().portero(ORIGEN, 5_000_000n)).toBe("sin-respuesta");
  });

  it("con otro pago de la cuenta en el aire, ahora no se puede mirar", async () => {
    h.pagos = { tipo: "pagos", pagos: { premio: true, retiro: true, costoRetiro: 5_000_000n, enCurso: { hash: "d".repeat(64), forma: "retiro", vence: 1 } } };
    expect(await depsDeComisionReales().portero(ORIGEN, 5_000_000n)).toBe("sin-respuesta");
  });
});

describe("después de que venció un pago", () => {
  it("si la cuenta no llegó a la secuencia del pago, se puede volver a ofrecer", async () => {
    h.cuentaMirada = { secuencia: "1000", saldos: [] };
    expect(await depsDeComisionReales().puedeVolverALista(ORIGEN, "1001", "1")).toBe(true);
    expect(h.llamadas).not.toContain("prueba");
  });

  it("si llegó y el listado consistente no muestra el pago, se puede volver a ofrecer", async () => {
    h.cuentaMirada = { secuencia: "1001", saldos: [] };
    h.prueba = { tipo: "al-dia" };
    expect(await depsDeComisionReales().puedeVolverALista(ORIGEN, "1001", "1")).toBe(true);
  });

  it("si llegó y el listado no es consistente, no", async () => {
    h.cuentaMirada = { secuencia: "1001", saldos: [] };
    h.prueba = { tipo: "atrasada" };
    expect(await depsDeComisionReales().puedeVolverALista(ORIGEN, "1001", "1")).toBe(false);
  });

  it("si la cuenta no se puede mirar, no", async () => {
    h.cuentaMirada = "sin-red";
    expect(await depsDeComisionReales().puedeVolverALista(ORIGEN, "1001", "1")).toBe(false);
  });
});

describe("el respaldo y la configuración", () => {
  it("el RPC confirma un hash conocido", async () => {
    h.rpc = "entro";
    expect(await depsDeComisionReales().confirmar("e".repeat(64))).toBe(true);
    h.rpc = "fallo";
    expect(await depsDeComisionReales().confirmar("e".repeat(64))).toBe(false);
    h.rpc = "no-esta";
    expect(await depsDeComisionReales().confirmar("e".repeat(64))).toBeNull();
  });

  it("fuera de la red principal la comisión está apagada", () => {
    expect(network.name).not.toBe("mainnet");
    expect(depsDeComisionReales().comision()).toBeNull();
  });
});
