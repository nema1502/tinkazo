import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STROOPS_POR_ALTA,
  STROOPS_POR_XLM,
  analizarCuenta,
  analizarTransaccion,
  aStroops,
  aXlm,
  cotejarBilletera,
  cumpleLoEsperado,
  fondosQueRecibio,
  quienPago,
  resumenDeOperaciones,
} from "./patrocinio.mjs";

/**
 * Respuestas reales de Horizon testnet (`GET /transactions/<hash>`), bajadas con
 * curl el 20 de octubre de 2026 y guardadas tal cual: solo direcciones públicas y
 * hashes. Son las dos primeras transacciones patrocinadas que se vieron en la
 * red (un sello y un sorteo de la misma cuenta) y un sorteo que pagó su propia
 * cuenta.
 */
const muestra = (nombre) => JSON.parse(readFileSync(new URL(`./muestras-patrocinio/${nombre}.json`, import.meta.url), "utf8"));
const SELLO_PATROCINADO = muestra("tx-patrocinada-seal");
const SORTEO_PATROCINADO = muestra("tx-patrocinada-draw");
const SORTEO_PROPIO = muestra("tx-propia-draw");

const BILLETERA_DE_LA_APP = "GAYWGZ4P5NHJU2UL7TGWSP6ZF5BYEBZ4WP7TZDBDZ3FXUN5DHGAMDGKU";
const ORGANIZADOR = "GBVGOF7TTAYFZQ4576VVA6EZADYEN7IHRDHPJD3CBRXRLTPQNXDSF254";
const OTRA_CUENTA = "GAB2C66DMMHZBOGXMMX5N3I4KP6JLNMHGZMBMDP3YX4JQZQJYYFP7VQF";

describe("montos: siempre exactos, sin flotantes", () => {
  it("de XLM a stroops y de vuelta, con siete decimales", () => {
    expect(aStroops("9998.8158600")).toBe(99_988_158_600n);
    expect(aXlm(99_988_158_600n)).toBe("9998.8158600");
    expect(aXlm(aStroops("0.0000001"))).toBe("0.0000001");
    expect(aXlm(0n)).toBe("0.0000000");
    expect(aStroops("1")).toBe(STROOPS_POR_XLM);
  });

  it("no se pierde un stroop donde un flotante sí lo pierde", () => {
    // 0.1 + 0.2 no da 0.3 con flotantes; con stroops, sí.
    expect(aStroops("0.1") + aStroops("0.2")).toBe(aStroops("0.3"));
    // Un monto grande con el último decimal distinto de cero.
    expect(aXlm(aStroops("9999.9999999") - 1n)).toBe("9999.9999998");
  });

  it("acepta coma o punto, y pocos decimales", () => {
    expect(aStroops("9998,81586")).toBe(aStroops("9998.8158600"));
    expect(aStroops("5")).toBe(50_000_000n);
    expect(aStroops(" 0.5 ")).toBe(5_000_000n);
  });

  it.each(["", "abc", "-1", "1.00000001", "9.998,8158", "1e3", "1,2,3", "0x10"])("rechaza un monto inválido: %j", (malo) => {
    expect(() => aStroops(malo)).toThrow(/monto inválido/);
  });

  it("un monto negativo en stroops se escribe con su signo", () => {
    expect(aXlm(-5_000_000n)).toBe("-0.5000000");
  });
});

describe("las respuestas reales: quién pagó", () => {
  it("el sello patrocinado: lo pagó la billetera de la app, no la cuenta de quien selló", () => {
    const a = analizarTransaccion(SELLO_PATROCINADO);
    expect(a.veredicto).toBe("patrocinada");
    expect(a.exitosa).toBe(true);
    expect(a.esFeeBump).toBe(true);
    expect(a.pagadaPor).toBe(BILLETERA_DE_LA_APP);
    expect(a.deLaCuenta).toBe(ORGANIZADOR);
    expect(a.pagadaPor).not.toBe(a.deLaCuenta);
    expect(a.ledger).toBe(5287821);
    expect(a.hash).toBe("93a2c960028652fc075ace78b123aa015fc59584843561f30181a39394d7cbe0");
    // Los dos hashes del envoltorio: el de adentro (el del sello) y el del fee-bump.
    expect(a.hashDeAdentro).toBe("93a2c960028652fc075ace78b123aa015fc59584843561f30181a39394d7cbe0");
    expect(a.hashDeAfuera).toBe("ea551981f9b1a4dec4fabf89bb8623be762dc58868702f46dab893e236ff49fc");
  });

  it("la comisión cobrada, en stroops y en XLM", () => {
    const a = analizarTransaccion(SELLO_PATROCINADO);
    expect(a.comisionStroops).toBe(6_461_961n);
    expect(a.comisionXlm).toBe("0.6461961");
  });

  it("el sorteo patrocinado de la misma cuenta", () => {
    const a = analizarTransaccion(SORTEO_PATROCINADO);
    expect(a.veredicto).toBe("patrocinada");
    expect(a.pagadaPor).toBe(BILLETERA_DE_LA_APP);
    expect(a.deLaCuenta).toBe(ORGANIZADOR);
    expect(a.comisionStroops).toBe(5_376_738n);
  });

  it("el sorteo propio: lo pagó su misma cuenta, sin fee-bump", () => {
    const a = analizarTransaccion(SORTEO_PROPIO);
    expect(a.veredicto).toBe("propia");
    expect(a.exitosa).toBe(true);
    expect(a.esFeeBump).toBe(false);
    expect(a.pagadaPor).toBe(OTRA_CUENTA);
    expect(a.deLaCuenta).toBe(OTRA_CUENTA);
    expect(a.hashDeAfuera).toBeNull();
    expect(a.hashDeAdentro).toBeNull();
    expect(a.ledger).toBe(5285871);
    expect(a.comisionStroops).toBe(5_371_416n);
    expect(a.comisionXlm).toBe("0.5371416");
  });

});

describe("cumpleLoEsperado", () => {
  it("por defecto se espera patrocinada: el sello patrocinado cumple y el propio no", () => {
    expect(cumpleLoEsperado(analizarTransaccion(SELLO_PATROCINADO)).ok).toBe(true);
    const propia = cumpleLoEsperado(analizarTransaccion(SORTEO_PROPIO));
    expect(propia.ok).toBe(false);
    expect(propia.motivo).toMatch(/no hubo patrocinio/);
  });

  it("el control negativo, --espero-propia: al revés", () => {
    expect(cumpleLoEsperado(analizarTransaccion(SORTEO_PROPIO), "propia").ok).toBe(true);
    const patrocinada = cumpleLoEsperado(analizarTransaccion(SELLO_PATROCINADO), "propia");
    expect(patrocinada.ok).toBe(false);
    expect(patrocinada.motivo).toMatch(/otra cuenta/);
  });

  it("una transacción que no fue exitosa no cumple nunca, aunque la haya pagado quien se esperaba", () => {
    const fallida = analizarTransaccion({ ...SELLO_PATROCINADO, successful: false });
    expect(fallida.veredicto).toBe("patrocinada");
    expect(cumpleLoEsperado(fallida).ok).toBe(false);
    expect(cumpleLoEsperado(fallida).motivo).toMatch(/no fue exitosa/);
    expect(cumpleLoEsperado(analizarTransaccion({ ...SORTEO_PROPIO, successful: false }), "propia").ok).toBe(false);
  });
});

describe("quienPago: los casos de borde", () => {
  it("un fee-bump de la propia cuenta no es un patrocinio", () => {
    expect(quienPago({ esFeeBump: true, pagadaPor: ORGANIZADOR, deLaCuenta: ORGANIZADOR })).toBe("propia");
    const a = analizarTransaccion({ ...SELLO_PATROCINADO, fee_account: ORGANIZADOR });
    expect(a.esFeeBump).toBe(true);
    expect(a.veredicto).toBe("propia");
  });

  it("otra cuenta pagando SIN fee-bump no existe en la red: no se adivina", () => {
    expect(quienPago({ esFeeBump: false, pagadaPor: BILLETERA_DE_LA_APP, deLaCuenta: ORGANIZADOR })).toBe("sin-datos");
    const { fee_bump_transaction: _quitado, ...sinFeeBump } = SELLO_PATROCINADO;
    const a = analizarTransaccion(sinFeeBump);
    expect(a.esFeeBump).toBe(false);
    expect(a.veredicto).toBe("sin-datos");
    expect(cumpleLoEsperado(a).ok).toBe(false);
    expect(cumpleLoEsperado(a, "propia").ok).toBe(false);
  });

  it("sin fee_account o sin source_account no se concluye nada", () => {
    expect(quienPago({ esFeeBump: true, pagadaPor: null, deLaCuenta: ORGANIZADOR })).toBe("sin-datos");
    expect(quienPago({ esFeeBump: true, pagadaPor: BILLETERA_DE_LA_APP, deLaCuenta: null })).toBe("sin-datos");
  });

  it("una respuesta sin la comisión se rechaza en vez de inventar un cero", () => {
    expect(() => analizarTransaccion({ ...SELLO_PATROCINADO, fee_charged: undefined })).toThrow(/fee_charged/);
    expect(() => analizarTransaccion({ ...SELLO_PATROCINADO, fee_charged: "6.4" })).toThrow(/fee_charged/);
    expect(() => analizarTransaccion(null)).toThrow(/no devolvió nada/);
  });
});

/** Las operaciones de una cuenta nueva de Pollar, como las cuenta Horizon (`/accounts/<G>/operations`). */
const ALTA_DE_POLLAR = [
  { type: "begin_sponsoring_future_reserves", source_account: BILLETERA_DE_LA_APP, sponsored_id: ORGANIZADOR },
  { type: "create_account", source_account: BILLETERA_DE_LA_APP, funder: BILLETERA_DE_LA_APP, account: ORGANIZADOR, starting_balance: "0.0000000" },
  { type: "end_sponsoring_future_reserves", source_account: ORGANIZADOR, begin_sponsor: BILLETERA_DE_LA_APP },
];
const SELLAR_Y_SORTEAR = [
  { type: "invoke_host_function", source_account: ORGANIZADOR },
  { type: "invoke_host_function", source_account: ORGANIZADOR },
];
const CUENTA_EN_CERO = {
  balances: [{ asset_type: "native", balance: "0.0000000" }],
  num_sponsored: 2,
};

describe("la cuenta del organizador", () => {
  it("una cuenta de Pollar que nunca recibió fondos: en cero, con sus dos entradas patrocinadas, y la prueba vale", () => {
    const r = analizarCuenta({ cuenta: ORGANIZADOR, cuentaHorizon: CUENTA_EN_CERO, operaciones: [...ALTA_DE_POLLAR, ...SELLAR_Y_SORTEAR] });
    expect(r.existe).toBe(true);
    expect(r.saldoXlm).toBe("0.0000000");
    expect(r.enCero).toBe(true);
    expect(r.numPatrocinadas).toBe(2);
    expect(r.fondosRecibidos).toEqual([]);
    expect(r.anulada).toBe(false);
    expect(r.totalDeOperaciones).toBe(5);
    expect(r.operaciones).toEqual([
      ["begin_sponsoring_future_reserves", 1],
      ["create_account", 1],
      ["end_sponsoring_future_reserves", 1],
      ["invoke_host_function", 2],
    ]);
  });

  it("si el grifo creó la cuenta con 10.000 XLM, la prueba queda anulada", () => {
    const grifo = [{ type: "create_account", funder: "GAGRIFO", account: ORGANIZADOR, starting_balance: "10000.0000000" }, ...SELLAR_Y_SORTEAR];
    const r = analizarCuenta({
      cuenta: ORGANIZADOR,
      cuentaHorizon: { balances: [{ asset_type: "native", balance: "9999.9999000" }], num_sponsored: 0 },
      operaciones: grifo,
    });
    expect(r.anulada).toBe(true);
    expect(r.fondosRecibidos).toEqual([{ tipo: "create_account", de: "GAGRIFO", monto: "10000.0000000 XLM" }]);
  });

  it("si el grifo le pagó a una cuenta que ya existía (payment), también", () => {
    const pago = { type: "payment", from: "GAGRIFO", to: ORGANIZADOR, asset_type: "native", amount: "10000.0000000" };
    expect(fondosQueRecibio(ORGANIZADOR, [...ALTA_DE_POLLAR, pago])).toEqual([{ tipo: "payment", de: "GAGRIFO", monto: "10000.0000000 XLM" }]);
    expect(analizarCuenta({ cuenta: ORGANIZADOR, cuentaHorizon: CUENTA_EN_CERO, operaciones: [...ALTA_DE_POLLAR, pago] }).anulada).toBe(true);
  });

  it("también cuentan un pago por camino, una fusión de cuentas hacia ella y un saldo reclamable", () => {
    const ops = [
      { type: "path_payment_strict_receive", from: "GAX", to: ORGANIZADOR, asset_type: "credit_alphanum4", asset_code: "USDC", amount: "5.0000000" },
      { type: "account_merge", account: "GAY", into: ORGANIZADOR },
      { type: "claim_claimable_balance", claimant: ORGANIZADOR },
    ];
    expect(fondosQueRecibio(ORGANIZADOR, ops).map((f) => f.tipo)).toEqual(["path_payment_strict_receive", "account_merge", "claim_claimable_balance"]);
    expect(fondosQueRecibio(ORGANIZADOR, ops)[0]?.monto).toBe("5.0000000 USDC");
  });

  it("lo que NO es recibir fondos: la alta con saldo inicial cero, un pago que sale de la cuenta, o una cuenta que ella crea", () => {
    const ops = [
      ...ALTA_DE_POLLAR,
      { type: "payment", from: ORGANIZADOR, to: "GOTRA", asset_type: "native", amount: "1.0000000" },
      { type: "create_account", funder: ORGANIZADOR, account: "GNUEVA", starting_balance: "5.0000000" },
      { type: "payment", from: "GAX", to: ORGANIZADOR, asset_type: "native", amount: "0.0000000" },
    ];
    expect(fondosQueRecibio(ORGANIZADOR, ops)).toEqual([]);
  });

  it("un saldo mayor que cero anula la prueba aunque no se vea de dónde salió", () => {
    const r = analizarCuenta({
      cuenta: ORGANIZADOR,
      cuentaHorizon: { balances: [{ asset_type: "native", balance: "0.0000100" }], num_sponsored: 2 },
      operaciones: ALTA_DE_POLLAR,
    });
    expect(r.fondosRecibidos).toEqual([]);
    expect(r.enCero).toBe(false);
    expect(r.anulada).toBe(true);
  });

  it("una cuenta que no existe en la red", () => {
    expect(analizarCuenta({ cuenta: ORGANIZADOR, cuentaHorizon: null, operaciones: [] })).toEqual({ existe: false, cuenta: ORGANIZADOR });
  });

  it("sin operaciones ni saldos todavía no rompe", () => {
    expect(resumenDeOperaciones(undefined)).toEqual([]);
    expect(fondosQueRecibio(ORGANIZADOR, undefined)).toEqual([]);
    const r = analizarCuenta({ cuenta: ORGANIZADOR, cuentaHorizon: { balances: [] }, operaciones: [] });
    expect(r.saldoStroops).toBe(0n);
    expect(r.numPatrocinadas).toBe(0);
  });
});

describe("la billetera que paga: al stroop", () => {
  const sello = analizarTransaccion(SELLO_PATROCINADO).comisionStroops;
  const sorteo = analizarTransaccion(SORTEO_PATROCINADO).comisionStroops;
  // Los saldos de antes y de después son los del 20 de octubre (la billetera bajó de 9999,99976 a
  // 9998,81586 XLM con una alta nueva en el medio), con las comisiones reales de las dos transacciones.
  const ANTES = aStroops("9999.9997600");
  const AHORA = aStroops("9998.8158601");

  it("la diferencia son exactamente las dos comisiones más 300 stroops de la alta", () => {
    const r = cotejarBilletera({ antes: ANTES, ahora: AHORA, comisiones: [sello, sorteo] });
    expect(r.ok).toBe(true);
    expect(r.altas).toBe(1);
    expect(r.diferencia).toBe(11_838_999n);
    expect(r.suma).toBe(sello + sorteo);
    expect(STROOPS_POR_ALTA).toBe(300n);
  });

  it("sin alta en el medio (la cuenta ya existía): exactamente las comisiones", () => {
    const r = cotejarBilletera({ antes: ANTES, ahora: ANTES - sello - sorteo, comisiones: [sello, sorteo] });
    expect(r).toMatchObject({ ok: true, altas: 0 });
  });

  it("un stroop de más o de menos ya no cuadra", () => {
    for (const desvio of [1n, -1n, 299n, 301n, 600n]) {
      const r = cotejarBilletera({ antes: ANTES, ahora: AHORA - desvio, comisiones: [sello, sorteo] });
      expect(r.ok, `desvío de ${desvio}`).toBe(false);
    }
    const r = cotejarBilletera({ antes: ANTES, ahora: AHORA - 1n, comisiones: [sello, sorteo] });
    expect(r.sobra).toBe(STROOPS_POR_ALTA + 1n);
  });

  it("si la billetera no bajó nada, la comisión la pagó otra: no cuadra", () => {
    expect(cotejarBilletera({ antes: ANTES, ahora: ANTES, comisiones: [sello, sorteo] }).ok).toBe(false);
  });

  it("una sola comisión", () => {
    expect(cotejarBilletera({ antes: ANTES, ahora: ANTES - sello, comisiones: [sello] }).ok).toBe(true);
  });
});
