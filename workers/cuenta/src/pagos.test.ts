import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { type PagoFalso, horizonFalso } from "./horizon-falso";
import { buscarCarga, buscarPagosDePlan, cuentaExiste, pagosEntrantes } from "./pagos";
import { EMISOR_USDC, memoDePlan } from "./reglas";

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const PLANES = Keypair.random().publicKey();

const pago = (extra: Partial<PagoFalso> = {}): PagoFalso => ({ de: OTRA, a: YO, monto: "5.0000000", tx: "a".repeat(64), ...extra });
const ctx = (h: ReturnType<typeof horizonFalso>, red: "testnet" | "mainnet" = "testnet") => ({ red, fetch: h.fetch });

describe("la primera carga", () => {
  it("encuentra un pago de USDC de 1 o más que llegó de otra cuenta", async () => {
    const h = horizonFalso({ pagos: { [YO]: [pago()] } });
    const r = await buscarCarga(YO, ctx(h));
    expect(r).toMatchObject({ ok: true, valor: { de: OTRA, a: YO, monto: 50_000_000n } });
  });

  it("un dólar justo alcanza; menos de uno, no", async () => {
    const justo = horizonFalso({ pagos: { [YO]: [pago({ monto: "1.0000000" })] } });
    expect(await buscarCarga(YO, ctx(justo))).toMatchObject({ ok: true, valor: { monto: 10_000_000n } });
    const poco = horizonFalso({ pagos: { [YO]: [pago({ monto: "0.9999999" })] } });
    expect(await buscarCarga(YO, ctx(poco))).toEqual({ ok: true, valor: null });
  });

  it("no cuenta lo que no es una carga", async () => {
    const casos: Record<string, PagoFalso> = {
      "USDC de otro emisor": pago({ emisor: Keypair.random().publicKey() }),
      "otra moneda": pago({ codigo: "EURC" }),
      "una transacción fallida": pago({ exitoso: false }),
      "un pago que salió de la cuenta": pago({ de: YO, a: OTRA }),
      "un pago de la cuenta a sí misma": pago({ de: YO, a: YO }),
      "un premio o un cupón de Tinkazo": pago({ memo: "tk:premio:12:0" }),
      "un pago a otra cuenta": pago({ a: OTRA }),
      "otra operación": pago({ tipo: "create_account" }),
    };
    for (const [nombre, p] of Object.entries(casos)) {
      const h = horizonFalso({ pagos: { [YO]: [p] } });
      expect(await buscarCarga(YO, ctx(h)), nombre).toEqual({ ok: true, valor: null });
    }
  });

  it("un pago con una nota cualquiera sí cuenta; los de ruta también", async () => {
    const h = horizonFalso({ pagos: { [YO]: [pago({ memo: "para vos" })] } });
    expect((await buscarCarga(YO, ctx(h))).ok).toBe(true);
    const ruta = horizonFalso({ pagos: { [YO]: [pago({ tipo: "path_payment_strict_send" })] } });
    expect(await buscarCarga(YO, ctx(ruta))).toMatchObject({ ok: true, valor: { monto: 50_000_000n } });
  });

  it("en mainnet vale el emisor de mainnet y no el de testnet", async () => {
    const h = horizonFalso({ red: "mainnet", pagos: { [YO]: [pago({ emisor: EMISOR_USDC.testnet })] } });
    expect(await buscarCarga(YO, ctx(h, "mainnet"))).toEqual({ ok: true, valor: null });
    const bien = horizonFalso({ red: "mainnet", pagos: { [YO]: [pago()] } });
    expect((await buscarCarga(YO, ctx(bien, "mainnet"))).ok).toBe(true);
  });

  it("una cuenta que no existe no tiene pagos; con Horizon caído no se afirma nada", async () => {
    expect(await buscarCarga(YO, ctx(horizonFalso()))).toEqual({ ok: true, valor: null });
    expect(await buscarCarga(YO, ctx(horizonFalso({ caido: true })))).toEqual({ ok: false });
  });

  it("sigue a la página siguiente, y se detiene al encontrar", async () => {
    const relleno = Array.from({ length: 200 }, (_, i) => pago({ monto: "0.5000000", tx: String(i).padStart(64, "0") }));
    const h = horizonFalso({ pagos: { [YO]: [...relleno, pago({ tx: "b".repeat(64) })] } });
    expect(await buscarCarga(YO, ctx(h))).toMatchObject({ ok: true, valor: { tx: "b".repeat(64) } });
    expect(h.pedidos).toHaveLength(2);

    const temprano = horizonFalso({ pagos: { [YO]: [pago(), ...relleno] } });
    await buscarCarga(YO, ctx(temprano));
    expect(temprano.pedidos).toHaveLength(1);
  });

  it("pide los pagos de la cuenta con la nota de cada transacción", async () => {
    const h = horizonFalso({ pagos: { [YO]: [pago()] } });
    await buscarCarga(YO, ctx(h));
    const u = new URL(h.pedidos[0] as string);
    expect(u.pathname).toBe(`/accounts/${YO}/payments`);
    expect(u.searchParams.get("join")).toBe("transactions");
    expect(u.searchParams.get("include_failed")).toBe("false");
  });

  it("no visita una dirección de 'siguiente' que no es de Horizon", async () => {
    const visitadas: string[] = [];
    const f = (async (u: string | URL | Request) => {
      visitadas.push(String(u));
      const registros = Array.from({ length: 200 }, () => ({}));
      return new Response(JSON.stringify({ _links: { next: { href: "https://malo.example/robar" } }, _embedded: { records: registros } }), { status: 200 });
    }) as typeof fetch;
    const r = await pagosEntrantes(YO, { red: "testnet", fetch: f });
    expect(r).toEqual({ ok: true, valor: [] });
    expect(visitadas).toHaveLength(1);
  });
});

describe("el pago del plan", () => {
  it("encuentra los pagos de 5 USDC o más con la nota exacta", async () => {
    const h = horizonFalso({
      pagos: { [PLANES]: [pago({ a: PLANES, de: OTRA, memo: memoDePlan(YO), tx: "c".repeat(64) }), pago({ a: PLANES, de: OTRA, memo: memoDePlan(YO), monto: "7.5000000", tx: "d".repeat(64) })] },
    });
    const r = await buscarPagosDePlan(PLANES, YO, ctx(h));
    expect(r.ok && r.valor.map((p) => p.tx)).toEqual(["c".repeat(64), "d".repeat(64)]);
  });

  it("no cuenta la nota de otra cuenta, sin nota, ni menos de 5", async () => {
    const h = horizonFalso({
      pagos: {
        [PLANES]: [
          pago({ a: PLANES, memo: memoDePlan(OTRA) }),
          pago({ a: PLANES }),
          pago({ a: PLANES, memo: `${memoDePlan(YO)} ` }),
          pago({ a: PLANES, memo: memoDePlan(YO).toUpperCase() }),
          pago({ a: PLANES, memo: memoDePlan(YO), monto: "4.9999999" }),
          pago({ a: PLANES, memo: memoDePlan(YO), codigo: "EURC" }),
          pago({ a: PLANES, memo: memoDePlan(YO), exitoso: false }),
        ],
      },
    });
    expect(await buscarPagosDePlan(PLANES, YO, ctx(h))).toEqual({ ok: true, valor: [] });
  });

  it("con Horizon caído no se afirma nada", async () => {
    expect(await buscarPagosDePlan(PLANES, YO, ctx(horizonFalso({ caido: true })))).toEqual({ ok: false });
  });
});

describe("si la cuenta existe", () => {
  it("lo dice, y no lo adivina si Horizon no contesta", async () => {
    expect(await cuentaExiste(YO, ctx(horizonFalso({ cuentas: [YO] })))).toEqual({ ok: true, valor: true });
    expect(await cuentaExiste(YO, ctx(horizonFalso()))).toEqual({ ok: true, valor: false });
    expect(await cuentaExiste(YO, ctx(horizonFalso({ caido: true })))).toEqual({ ok: false });
  });
});
