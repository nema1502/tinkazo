import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it, vi } from "vitest";
import { PRECIOS_POR_DEFECTO, leerConfig, leerPrecios } from "./config";
import { HORIZON_MAINNET, POLLAR_SERVIDOR, ServidorAjeno, haciaHorizon, haciaPollar } from "./servidores";

/** Todas las variables nuevas prendidas y bien escritas: lo que diría el portero de mainnet el día que se use todo. */
const TODO_PRENDIDO = {
  ALTAS: "1",
  ALTAS_PAGO: "1",
  SORTEO_SERVIDOR: "1",
  POLLAR_APP_ID: "app_mainnet_1",
  POLLAR_FONDEO: "diferido",
  CUENTA_COBROS: Keypair.random().publicKey(),
  CUENTA_SORTEADORA: Keypair.random().publicKey(),
  PRECIOS: "alta:2:3:365,p10:5:10:365,p50:20:50:365",
  CREDITOS_POR_SORTEO: "20",
  CREDITOS_POR_ALTA: "45",
};

describe("las altas nacen apagadas", () => {
  it("sin variables, en las dos redes: ni libro, ni pago, ni sorteo del servidor", () => {
    for (const RED of ["testnet", "mainnet"]) {
      const cfg = leerConfig({ RED });
      expect(cfg.altas, RED).toBe(false);
      expect(cfg.altasPago, RED).toBe(false);
      expect(cfg.sorteoServidor, RED).toBe(false);
      expect(cfg.pollarAppId, RED).toBeNull();
      expect(cfg.cuentaCobros, RED).toBeNull();
      expect(cfg.cuentaSorteadora, RED).toBeNull();
      expect(cfg.faltaAltas, RED).toEqual([]);
    }
  });

  it("los valores por defecto del piso y del fondeo son los del sábado", () => {
    const cfg = leerConfig({ RED: "mainnet" });
    expect(cfg.creditosPorSorteo).toBe(40);
    expect(cfg.creditosPorAlta).toBe(30);
    expect(cfg.pollarFondeo).toBe("inmediato");
    expect(cfg.precios).toEqual(leerPrecios(PRECIOS_POR_DEFECTO));
  });

  it("solo un 1 prende: ni true, ni si, ni un espacio", () => {
    for (const v of ["true", "si", "yes", " 1", "01", "", "0"]) {
      const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ALTAS: v });
      expect(cfg.altas, JSON.stringify(v)).toBe(false);
      expect(cfg.altasPago, JSON.stringify(v)).toBe(false);
      expect(cfg.sorteoServidor, JSON.stringify(v)).toBe(false);
    }
  });

  it("en mainnet con todo bien escrito se prende todo", () => {
    const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO });
    expect(cfg).toMatchObject({ altas: true, altasPago: true, sorteoServidor: true, pollarAppId: "app_mainnet_1", pollarFondeo: "diferido", creditosPorSorteo: 20, creditosPorAlta: 45 });
    expect(cfg.cuentaCobros).toBe(TODO_PRENDIDO.CUENTA_COBROS);
    expect(cfg.cuentaSorteadora).toBe(TODO_PRENDIDO.CUENTA_SORTEADORA);
    expect(cfg.faltaAltas).toEqual([]);
  });

  it("el pago y el sorteo del servidor no se prenden sin el libro", () => {
    const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ALTAS: "0" });
    expect(cfg.altasPago).toBe(false);
    expect(cfg.sorteoServidor).toBe(false);
  });

  it("en testnet ALTAS se ignora, y todo lo demás también", () => {
    const cfg = leerConfig({ RED: "testnet", ...TODO_PRENDIDO });
    expect(cfg.altas).toBe(false);
    expect(cfg.altasPago).toBe(false);
    expect(cfg.sorteoServidor).toBe(false);
    expect(cfg.faltaAltas).toEqual([]);
    // Una red mal escrita es testnet, como hoy: tampoco prende nada.
    expect(leerConfig({ RED: "Mainnet", ...TODO_PRENDIDO }).altas).toBe(false);
  });

  it("lo que falta para lo que se prendió queda dicho con nombres fijos, sin valores", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", SORTEO_SERVIDOR: "1", POLLAR_FONDEO: "a-veces", CUENTA_COBROS: "GNOESUNACUENTA" });
    expect(cfg.faltaAltas).toEqual(["pollar-app", "pollar-fondeo", "cuenta-cobros", "cuenta-sorteadora"]);
    expect(cfg.altas).toBe(true);
    expect(cfg.altasPago).toBe(false);
    expect(cfg.sorteoServidor).toBe(false);
    expect(cfg.pollarFondeo).toBeNull();
    expect(cfg.cuentaCobros).toBeNull();
  });

  it("la cuenta de cobros es propia: si repite la que paga las comisiones o la sorteadora, el pago no se prende y nadie lee sus pagos", () => {
    const patrocinadora = Keypair.random().publicKey();
    const base = { RED: "mainnet", ...TODO_PRENDIDO, CUENTA_PATROCINADORA: patrocinadora };
    expect(leerConfig(base)).toMatchObject({ altasPago: true, cuentaCobros: TODO_PRENDIDO.CUENTA_COBROS, faltaAltas: [] });
    for (const repetida of [patrocinadora, TODO_PRENDIDO.CUENTA_SORTEADORA]) {
      const cfg = leerConfig({ ...base, CUENTA_COBROS: ` ${repetida} ` });
      expect(cfg.altasPago).toBe(false);
      expect(cfg.cuentaCobros).toBeNull();
      expect(cfg.faltaAltas).toEqual(["cuenta-cobros-repetida"]);
    }
    // Con el pago apagado igual se dice: con la cuenta cargada el servidor ya lee sus pagos.
    expect(leerConfig({ ...base, ALTAS_PAGO: "0", CUENTA_COBROS: patrocinadora })).toMatchObject({ cuentaCobros: null, faltaAltas: ["cuenta-cobros-repetida"] });
    // En testnet no se mira nada.
    expect(leerConfig({ ...base, RED: "testnet", CUENTA_COBROS: patrocinadora }).faltaAltas).toEqual([]);
  });

  it("un id de app de Pollar con caracteres raros no se toma", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app id/../x" }).pollarAppId).toBeNull();
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "  app_1  " }).pollarAppId).toBe("app_1");
  });
});

describe("ORDEN_USDC_PILOTO: la lista del piloto de la orden en dólares digitales", () => {
  const G1 = Keypair.random().publicKey();
  const G2 = Keypair.random().publicKey();

  it("vacía (o en testnet) no pone lista propia: la orden mira el piloto de la compra con QR, como hoy", () => {
    for (const vacia of [undefined, "", " , "]) {
      const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ...(vacia === undefined ? {} : { ORDEN_USDC_PILOTO: vacia }) });
      expect(cfg.ordenUsdcTodos, JSON.stringify(vacia)).toBe(false);
      expect([...cfg.ordenUsdcPiloto], JSON.stringify(vacia)).toEqual([]);
      expect(cfg.ordenUsdcEnVariable, JSON.stringify(vacia)).toBe("ninguna");
      expect(cfg.faltaAltas, JSON.stringify(vacia)).toEqual([]);
    }
    const test = leerConfig({ RED: "testnet", ...TODO_PRENDIDO, ORDEN_USDC_PILOTO: G1 });
    expect(test).toMatchObject({ ordenUsdcTodos: false, ordenUsdcEnVariable: "ninguna" });
    expect([...test.ordenUsdcPiloto]).toEqual([]);
    expect(test.faltaAltas).toEqual([]);
  });

  it("lista de cuentas bien escritas, con espacios alrededor: esas y solo esas", () => {
    const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ORDEN_USDC_PILOTO: ` ${G1} , ${G2} ` });
    expect([...cfg.ordenUsdcPiloto].sort()).toEqual([G1, G2].sort());
    expect(cfg.ordenUsdcTodos).toBe(false);
    expect(cfg.ordenUsdcEnVariable).toBe("lista");
    expect(cfg.faltaAltas).toEqual([]);
  });

  it("todos abre a cualquiera solo con ORDEN_USDC_TODOS en 1; sin la confirmación cierra y se anota", () => {
    const base = { RED: "mainnet", ...TODO_PRENDIDO };
    const abierto = leerConfig({ ...base, ORDEN_USDC_PILOTO: "todos", ORDEN_USDC_TODOS: "1" });
    expect(abierto.ordenUsdcTodos).toBe(true);
    expect([...abierto.ordenUsdcPiloto]).toEqual([]);
    expect(abierto.faltaAltas).toEqual([]);
    // Con cuentas al lado también; con la confirmación, nada cambia para ellas.
    const conCuentas = leerConfig({ ...base, ORDEN_USDC_PILOTO: `todos, ${G1} `, ORDEN_USDC_TODOS: "1" });
    expect(conCuentas.ordenUsdcTodos).toBe(true);
    expect([...conCuentas.ordenUsdcPiloto]).toEqual([G1]);
    // Sin la confirmación explícita, `todos` es como una palabra mal escrita.
    for (const sinEso of [undefined, "0", "true", " 1"]) {
      const cfg = leerConfig({ ...base, ORDEN_USDC_PILOTO: "todos", ...(sinEso === undefined ? {} : { ORDEN_USDC_TODOS: sinEso }) });
      expect(cfg.ordenUsdcTodos, JSON.stringify(sinEso)).toBe(false);
      expect([...cfg.ordenUsdcPiloto], JSON.stringify(sinEso)).toEqual([]);
      expect(cfg.ordenUsdcEnVariable, JSON.stringify(sinEso)).toBe("mal");
      expect(cfg.faltaAltas, JSON.stringify(sinEso)).toEqual(["orden-usdc-piloto"]);
    }
  });

  it("mal escrita no se toma a medias: se anota con nombre fijo, sin valores, solo si la orden puede nacer", () => {
    for (const mal of [`${G1},beto`, `${G1};${G2}`, "Todos", "todas", "*"]) {
      const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ORDEN_USDC_PILOTO: mal });
      expect([...cfg.ordenUsdcPiloto], mal).toEqual([]);
      expect(cfg.ordenUsdcTodos, mal).toBe(false);
      expect(cfg.ordenUsdcEnVariable, mal).toBe("mal");
    }
    expect(leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ORDEN_USDC_PILOTO: `${G1},beto` }).faltaAltas).toEqual(["orden-usdc-piloto"]);
    // Con el pago apagado no se usa: no se anota.
    expect(leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ALTAS_PAGO: "0", ORDEN_USDC_PILOTO: `${G1},beto` }).faltaAltas).toEqual([]);
  });
});

/** Las siete variables de los pagos de premios, los retiros y el alta de quien ganó. */
const VARIABLES_DE_PAGOS = [
  "PAGOS_PREMIO",
  "RETIROS",
  "ALTAS_PREMIO",
  "COSTO_RETIRO",
  "TOPE_PAGOS_STROOPS",
  "PAGOS_RECHAZADOS_DIA",
  "ALTAS_PREMIO_DIA",
];
/** Los campos de `Config` que trajeron esas variables. */
const CAMPOS_DE_PAGOS = ["pagosPremio", "retiros", "altasPremio", "costoRetiro", "topePagos", "pagosRechazadosDia", "altasPremioDia"];

describe("los pagos de premios, los retiros y el alta de quien ganó", () => {
  const BASE = { RED: "mainnet", ...TODO_PRENDIDO };
  /** Las tres prendidas, con el costo del retiro bien escrito. */
  const TRES = { PAGOS_PREMIO: "1", RETIROS: "1", ALTAS_PREMIO: "1", COSTO_RETIRO: "0.50" };
  const formas = (cfg: ReturnType<typeof leerConfig>) => [cfg.pagosPremio, cfg.retiros, cfg.altasPremio];

  it("nacen apagadas, en las dos redes y con todo lo demás prendido, y los topes valen los de siempre", () => {
    for (const RED of ["testnet", "mainnet"]) {
      const cfg = leerConfig({ RED, ...TODO_PRENDIDO });
      expect(formas(cfg), RED).toEqual([false, false, false]);
      expect(cfg.costoRetiro, RED).toBeNull();
      expect(cfg.faltaAltas, RED).toEqual([]);
      expect(cfg, RED).toMatchObject({ topePagos: 20_000_000, pagosRechazadosDia: 20, altasPremioDia: 100 });
    }
  });

  it("solo un 1 prende cada una: ni true, ni si, ni un espacio", () => {
    for (const v of ["true", "si", "yes", " 1", "01", "", "0"]) {
      const cfg = leerConfig({ ...BASE, PAGOS_PREMIO: v, RETIROS: v, ALTAS_PREMIO: v, COSTO_RETIRO: "0.50" });
      expect(formas(cfg), JSON.stringify(v)).toEqual([false, false, false]);
      expect(cfg.faltaAltas, JSON.stringify(v)).toEqual([]);
    }
  });

  it("en la red principal, con el libro y todo bien escrito, cada una se prende sola", () => {
    const todas = leerConfig({ ...BASE, ...TRES });
    expect(formas(todas)).toEqual([true, true, true]);
    expect(todas.faltaAltas).toEqual([]);
    expect(formas(leerConfig({ ...BASE, PAGOS_PREMIO: "1" }))).toEqual([true, false, false]);
    expect(formas(leerConfig({ ...BASE, RETIROS: "1", COSTO_RETIRO: "0.50" }))).toEqual([false, true, false]);
    expect(formas(leerConfig({ ...BASE, ALTAS_PREMIO: "1" }))).toEqual([false, false, true]);
  });

  it("sin ALTAS no se prende ninguna y se dice cuáles faltan", () => {
    for (const ALTAS of [undefined, "0", "true"]) {
      const cfg = leerConfig({ RED: "mainnet", ...TRES, ...(ALTAS === undefined ? {} : { ALTAS }) });
      expect(formas(cfg), String(ALTAS)).toEqual([false, false, false]);
      expect(cfg.faltaAltas, String(ALTAS)).toEqual(["pagos-premio", "retiros", "alta-premio"]);
    }
  });

  it("en testnet se ignoran las tres, también con todo prendido", () => {
    const cfg = leerConfig({ RED: "testnet", ...TODO_PRENDIDO, ...TRES });
    expect(formas(cfg)).toEqual([false, false, false]);
    expect(cfg.costoRetiro).toBeNull();
    expect(cfg.faltaAltas).toEqual([]);
  });

  it("el retiro pide una cuenta de cobros propia", () => {
    const sinCobros = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", RETIROS: "1", COSTO_RETIRO: "0.50" };
    const cfg = leerConfig(sinCobros);
    expect(cfg.retiros).toBe(false);
    expect(cfg.faltaAltas).toEqual(["retiros"]);
    // La de cobros repetida, igual a la que paga las comisiones, no se toma.
    const g = Keypair.random().publicKey();
    const repetida = leerConfig({ ...sinCobros, CUENTA_PATROCINADORA: g, CUENTA_COBROS: g });
    expect(repetida.retiros).toBe(false);
    expect(repetida.faltaAltas).toEqual(["cuenta-cobros-repetida", "retiros"]);
  });

  it.each([
    ["vacío", ""],
    ["sin poner", undefined],
    ["en cero", "0"],
    ["en cero con decimales", "0.00"],
    ["de menos de un centavo", "0.001"],
    ["en 6", "6"],
    ["apenas por encima de 5", "5.0000001"],
    ["con coma", "0,50"],
    ["con letras", "cincuenta"],
    ["con signo", "-1"],
    ["con la moneda", "$0.50"],
  ])("un costo %s apaga el retiro y se anota", (_nombre, COSTO_RETIRO) => {
    const cfg = leerConfig({ ...BASE, RETIROS: "1", ...(COSTO_RETIRO === undefined ? {} : { COSTO_RETIRO }) });
    expect(cfg.retiros).toBe(false);
    expect(cfg.costoRetiro).toBeNull();
    expect(cfg.faltaAltas).toEqual(["costo-retiro"]);
  });

  it.each([
    ["0.50", 5_000_000],
    ["0.5", 5_000_000],
    ["0.01", 100_000],
    ["5", 50_000_000],
    ["5.0000000", 50_000_000],
    [" 1.25 ", 12_500_000],
  ])("el costo %j vale %i diezmillonésimas y prende el retiro", (texto, monto) => {
    const cfg = leerConfig({ ...BASE, RETIROS: "1", COSTO_RETIRO: texto });
    expect(cfg.retiros).toBe(true);
    expect(cfg.costoRetiro).toEqual({ usdc: texto.trim(), monto });
    expect(cfg.faltaAltas).toEqual([]);
  });

  it("un costo mal escrito se anota aunque el retiro esté apagado; vacío no, y en testnet tampoco", () => {
    expect(leerConfig({ ...BASE, COSTO_RETIRO: "0,50" }).faltaAltas).toEqual(["costo-retiro"]);
    expect(leerConfig({ ...BASE, COSTO_RETIRO: "" }).faltaAltas).toEqual([]);
    expect(leerConfig({ RED: "testnet", COSTO_RETIRO: "0,50" }).faltaAltas).toEqual([]);
  });

  it.each([
    ["TOPE_PAGOS_STROOPS", "tope-pagos", "topePagos", 20_000_000],
    ["PAGOS_RECHAZADOS_DIA", "pagos-rechazos", "pagosRechazadosDia", 20],
    ["ALTAS_PREMIO_DIA", "altas-premio-dia", "altasPremioDia", 100],
  ])("%s solo con dígitos: mal escrita se anota aunque la forma esté apagada y vale la de siempre", (variable, nombre, campo, porDefecto) => {
    for (const mal of ["8.400", "8,400", "8 400", "-5", "1e4", "mucho", "0x10"]) {
      const cfg = leerConfig({ ...BASE, [variable]: mal });
      expect(cfg.faltaAltas, mal).toEqual([nombre]);
      expect(cfg, mal).toMatchObject({ [campo]: porDefecto });
    }
    expect(leerConfig({ ...BASE, [variable]: " 15 " })).toMatchObject({ [campo]: 15, faltaAltas: [] });
    expect(leerConfig({ ...BASE, [variable]: "" })).toMatchObject({ [campo]: porDefecto, faltaAltas: [] });
    // En testnet no se lee ni se anota nada.
    expect(leerConfig({ RED: "testnet", [variable]: "mucho" })).toMatchObject({ [campo]: porDefecto, faltaAltas: [] });
  });

  it("un tope mal escrito apaga lo suyo y deja lo demás", () => {
    const prendido = { ...BASE, ...TRES };
    expect(formas(leerConfig({ ...prendido, TOPE_PAGOS_STROOPS: "2,5" }))).toEqual([false, false, true]);
    expect(formas(leerConfig({ ...prendido, PAGOS_RECHAZADOS_DIA: "veinte" }))).toEqual([false, false, true]);
    expect(formas(leerConfig({ ...prendido, ALTAS_PREMIO_DIA: "cien" }))).toEqual([true, true, false]);
  });

  it("los topes bien escritos se leen tal cual", () => {
    const cfg = leerConfig({ ...BASE, TOPE_PAGOS_STROOPS: "30000000", PAGOS_RECHAZADOS_DIA: "50", ALTAS_PREMIO_DIA: "300" });
    expect(cfg).toMatchObject({ topePagos: 30_000_000, pagosRechazadosDia: 50, altasPremioDia: 300, faltaAltas: [] });
  });

  it("cada tope en su techo se lee tal cual: 10 XLM, 100 rechazados y 300 altas", () => {
    const cfg = leerConfig({ ...BASE, ...TRES, TOPE_PAGOS_STROOPS: "100000000", PAGOS_RECHAZADOS_DIA: "100", ALTAS_PREMIO_DIA: "300" });
    expect(cfg).toMatchObject({ topePagos: 100_000_000, pagosRechazadosDia: 100, altasPremioDia: 300, faltaAltas: [] });
    expect(formas(cfg)).toEqual([true, true, true]);
  });

  it.each([
    ["TOPE_PAGOS_STROOPS", "200000000", "tope-pagos", "topePagos", 20_000_000, [false, false, true]],
    ["PAGOS_RECHAZADOS_DIA", "101", "pagos-rechazos", "pagosRechazadosDia", 20, [false, false, true]],
    ["ALTAS_PREMIO_DIA", "1000", "altas-premio-dia", "altasPremioDia", 100, [true, true, false]],
  ])("%s por encima de su techo (%s, un cero de más) es mal escrito y apaga lo suyo", (variable, valor, nombre, campo, porDefecto, prendidas) => {
    const cfg = leerConfig({ ...BASE, ...TRES, [variable]: valor });
    expect(cfg.faltaAltas).toEqual([nombre]);
    expect(cfg).toMatchObject({ [campo]: porDefecto });
    expect(formas(cfg)).toEqual(prendidas);
  });
});

describe("PRECIOS", () => {
  it("una cadena con los tres productos los da todos, con el monto en diezmillonésimas", () => {
    expect(leerPrecios("alta:2:3:365,p10:5:10:365,p50:20:50:365")).toEqual([
      { id: "alta", usdc: "2", monto: 20_000_000, sorteos: 3, dias: 365 },
      { id: "p10", usdc: "5", monto: 50_000_000, sorteos: 10, dias: 365 },
      { id: "p50", usdc: "20", monto: 200_000_000, sorteos: 50, dias: 365 },
    ]);
    expect(leerPrecios(" alta:1.5:3:365 , p10:4.0000001:10:30 ")).toEqual([
      { id: "alta", usdc: "1.5", monto: 15_000_000, sorteos: 3, dias: 365 },
      { id: "p10", usdc: "4.0000001", monto: 40_000_001, sorteos: 10, dias: 30 },
    ]);
  });

  it("lo mal escrito se rechaza entero: nada a medias", () => {
    for (const mal of [
      "alta:2:3",
      "alta:2:3:365:9",
      "alta:2:3:365,",
      "alta:2:3:365,,p10:5:10:365",
      "alta:dos:3:365",
      "alta:-2:3:365",
      "alta:0:3:365",
      "alta:2,5:3:365",
      "alta:2.12345678:3:365",
      "alta:1e3:3:365",
      "alta:2:0:365",
      "alta:2:3.5:365",
      "alta:2:3:0",
      "alta:2:100000:365",
      "alta:2:3:99999",
      "alta:2:3:365,alta:3:3:365",
      "p10:5:10:365",
      "ALTA:2:3:365",
      "alta:2:3:365,p20:5:10:365",
      "alta:2:3:365,p10:5:10:365,p50:20:50:365,x",
    ]) {
      expect(leerPrecios(mal), mal).toBeNull();
    }
  });

  it("un PRECIOS mal escrito no prende nada: el pago queda apagado y se anota", () => {
    const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, PRECIOS: "alta:2:3" });
    expect(cfg.precios).toBeNull();
    expect(cfg.altasPago).toBe(false);
    expect(cfg.faltaAltas).toEqual(["precios"]);
  });

  it("sin PRECIOS (o vacío) valen los del diseño", () => {
    expect(leerConfig({ RED: "mainnet", PRECIOS: "" }).precios).toEqual(leerPrecios(PRECIOS_POR_DEFECTO));
    expect(leerConfig({ RED: "mainnet" }).precios).toEqual(leerPrecios(PRECIOS_POR_DEFECTO));
  });
});

describe("los sorteos del mes", () => {
  it("en mainnet son tantos como los sellos; en testnet, el doble como hoy", () => {
    const main = leerConfig({ RED: "mainnet", MAX_SELLOS_MES: "100", MAX_SELLOS_VERIFICADA: "150" });
    expect(main).toMatchObject({ maxSellos: 100, maxSorteos: 100, maxSellosVerificada: 150, maxSorteosVerificada: 150 });
    const test = leerConfig({ RED: "testnet" });
    expect(test).toMatchObject({ maxSellos: 20, maxSorteos: 40, maxSellosVerificada: 50, maxSorteosVerificada: 100 });
  });
});

describe("Pollar y Horizon van fijos en el código", () => {
  const ok = () => vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));

  it("una ruta va al servidor fijo, sin seguir redirecciones", async () => {
    const f = ok();
    await haciaPollar(f)("/v3/tokens/verify", { method: "POST" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[0]).toBe(`${POLLAR_SERVIDOR}/v3/tokens/verify`);
    expect(f.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "manual" });
    expect(POLLAR_SERVIDOR).toBe("https://server.api.pollar.xyz");
    const h = ok();
    await haciaHorizon(h)("/accounts/GX/payments?order=asc");
    expect(h.mock.calls[0]?.[0]).toBe(`${HORIZON_MAINNET}/accounts/GX/payments?order=asc`);
  });

  it("fetch hacia otro servidor de Pollar falla sin llamar a nadie", async () => {
    const f = ok();
    const pollar = haciaPollar(f);
    for (const otra of [
      "https://otro.example/v3/tokens/verify",
      "https://server.api.pollar.xyz.otro.example/v3/tokens/verify",
      "//otro.example/v3/tokens/verify",
      "/\\otro.example/v3",
      "\\\\otro.example/v3",
      "v3/tokens/verify",
      "http://server.api.pollar.xyz/v3/tokens/verify",
      "/@otro.example/v3",
    ]) {
      await expect(pollar(otra), otra).rejects.toBeInstanceOf(ServidorAjeno);
    }
    // "/@otro.example" sería una ruta del servidor fijo, pero se rechaza igual: solo se aceptan rutas limpias.
    expect(f).not.toHaveBeenCalled();
  });

  it("una redirección del servidor no se sigue: falla y no lleva la llave a otro lado", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://otro.example/" } }));
    await expect(haciaPollar(f)("/v3/billing/credits")).rejects.toBeInstanceOf(ServidorAjeno);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ninguna variable cambia el servidor: la configuración no tiene ni lee una dirección de Pollar ni de Horizon", () => {
    const cfg = leerConfig({ RED: "mainnet", ...TODO_PRENDIDO, ...({ POLLAR_URL: "https://otro.example", HORIZON_URL: "https://otro.example" } as object) });
    expect(JSON.stringify(cfg)).not.toContain("otro.example");
    expect(JSON.stringify(cfg)).not.toContain("pollar.xyz");
  });
});

describe("wrangler.toml: el portero de testnet no cambia y el de mainnet es otro Worker", () => {
  const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  /** Las líneas de cada tabla del TOML, sin comentarios: "" es lo de arriba de todo. */
  const secciones = new Map<string, string[]>();
  let actual = "";
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.replace(/\s+#.*$/, "").trim();
    if (!l || l.startsWith("#")) continue;
    const t = /^\[\[?([^\]]+)\]\]?$/.exec(l);
    if (t?.[1]) {
      actual = t[1].trim();
      if (!secciones.has(actual)) secciones.set(actual, []);
      continue;
    }
    secciones.set(actual, [...(secciones.get(actual) ?? []), l]);
  }
  const valor = (seccion: string, clave: string) => {
    const l = (secciones.get(seccion) ?? []).find((x) => x.startsWith(`${clave} `) || x.startsWith(`${clave}=`));
    return l ? l.slice(l.indexOf("=") + 1).trim() : undefined;
  };

  it("lo de arriba sigue siendo testnet, en p.tinkazo.app, con su nombre", () => {
    expect(valor("", "name")).toBe('"tinkazo-patrocinio"');
    expect(valor("", "routes")).toBe('[{ pattern = "p.tinkazo.app", custom_domain = true }]');
    expect(valor("vars", "RED")).toBe('"testnet"');
    expect(valor("vars", "ALTAS")).toBeUndefined();
    expect(valor("vars", "POLLAR_APP_ID")).toBeUndefined();
  });

  it("mainnet tiene su nombre, su dominio, su objeto y sus variables", () => {
    expect(valor("env.mainnet", "name")).toBe('"tinkazo-patrocinio-mainnet"');
    expect(valor("env.mainnet", "routes")).toBe('[{ pattern = "pm.tinkazo.app", custom_domain = true }]');
    expect(valor("env.mainnet", "workers_dev")).toBe("false");
    expect(valor("env.mainnet.durable_objects.bindings", "name")).toBe('"PATROCINIO"');
    expect(valor("env.mainnet.durable_objects.bindings", "class_name")).toBe('"Patrocinio"');
    expect(valor("env.mainnet.vars", "RED")).toBe('"mainnet"');
    expect(valor("env.mainnet.vars", "ALTAS")).toBe('"1"');
    // El pago se prende cambiando ALTAS_PAGO a "1" (ver abajo); el sorteo del servidor, todavía no: el sitio no lo usa.
    expect(['"0"', '"1"']).toContain(valor("env.mainnet.vars", "ALTAS_PAGO"));
    expect(valor("env.mainnet.vars", "SORTEO_SERVIDOR")).toBe('"0"');
    expect(valor("env.mainnet.vars", "MAX_SELLOS_MES")).toBe('"100"');
    expect(valor("env.mainnet.vars", "RESERVA_SORTEO_STROOPS")).toBe('"1236000"');
    // Vacía a propósito: con el libro, la puerta no mira quién abrió la cuenta.
    expect(valor("env.mainnet.vars", "PATROCINADORES_APP")).toBe('""');
    const precios = valor("env.mainnet.vars", "PRECIOS");
    expect(precios && leerPrecios(JSON.parse(precios) as string)).toEqual(leerPrecios(PRECIOS_POR_DEFECTO));
  });

  /** Las variables de `[env.mainnet.vars]`, como las lee el Worker. */
  const varsDeMainnet = (): Record<string, string> =>
    Object.fromEntries(
      (secciones.get("env.mainnet.vars") ?? []).flatMap((l) => {
        const m = /^([A-Z_]+)\s*=\s*"([^"]*)"$/.exec(l);
        return m ? [[m[1] as string, m[2] as string]] : [];
      }),
    );

  it("prender el pago es cambiar variables: ALTAS_PAGO en 1 con la cuenta de cobros cargada prende el pago sin que falte nada", () => {
    const vars = varsDeMainnet();
    const cobros = Keypair.random().publicKey();
    const cfg = leerConfig({ ...vars, ALTAS_PAGO: "1", CUENTA_COBROS: cobros });
    expect(cfg).toMatchObject({ red: "mainnet", altas: true, altasPago: true, sorteoServidor: false, cuentaCobros: cobros, faltaAltas: [] });
    expect(cfg.precios).toEqual(leerPrecios(PRECIOS_POR_DEFECTO));
    // Lo que diga el archivo hoy: con el pago prendido, su cuenta de cobros es válida y propia.
    const hoy = leerConfig(vars);
    expect(hoy.faltaAltas).toEqual([]);
    if (vars.ALTAS_PAGO === "1") expect(hoy.altasPago).toBe(true);
    else expect(vars.CUENTA_COBROS === "" || hoy.cuentaCobros === vars.CUENTA_COBROS).toBe(true);
  });

  it("los precios de la venta: 3 sorteos por 4 dólares por 90 días y 10 por 10 dólares por un año, sin el de 50", () => {
    expect(leerPrecios(PRECIOS_POR_DEFECTO)).toEqual([
      { id: "alta", usdc: "4", monto: 40_000_000, sorteos: 3, dias: 90 },
      { id: "p10", usdc: "10", monto: 100_000_000, sorteos: 10, dias: 365 },
    ]);
  });

  it("ningún precio de mainnet pierde en el peor caso con la persona firmando el sorteo, y el piso guarda sus dos firmas", () => {
    const vars = varsDeMainnet();
    const precios = leerPrecios(vars.PRECIOS ?? "");
    expect(precios).not.toBeNull();
    // Las cuentas del costo de un paquete, en micro-dólares: el crédito de Pollar a US$0,01, 35 por la cuenta, 10 por mes
    // con un sorteo por mes (hasta 12), 20 por firma, y US$0,156 de red por sorteo en el peor caso. Sin el sorteo del
    // servidor la persona firma el sello y el sorteo, con reintentos: 2,5 firmas por sorteo. Entra el 95 % del precio.
    const firmasMil = vars.SORTEO_SERVIDOR === "1" ? 1250 : 2500;
    const deja = (p: NonNullable<typeof precios>[number]) => {
      const costo = 350_000 + Math.min(p.sorteos, 12) * 100_000 + p.sorteos * ((firmasMil * 200_000) / 1000 + 156_000);
      return Math.floor((p.monto * 95) / 1000) - costo;
    };
    for (const p of precios ?? []) expect(deja(p), p.id).toBeGreaterThanOrEqual(0);
    expect(Object.fromEntries((precios ?? []).map((p) => [p.id, deja(p)]))).toEqual({ alta: 1_182_000, p10: 1_590_000 });
    // Mientras la persona firme el sorteo, el piso guarda 40 créditos por sorteo prometido: el sello y el sorteo.
    expect(vars.SORTEO_SERVIDOR).toBe("0");
    expect(Number(vars.CREDITOS_POR_SORTEO)).toBeGreaterThanOrEqual(40);
  });

  it("mainnet paga el draw solo de los sellos del portero desde el primer despliegue; testnet no tiene la variable", () => {
    expect(valor("env.mainnet.vars", "SOLO_SELLOS_PORTERO")).toBe('"1"');
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", SOLO_SELLOS_PORTERO: "1" }).soloSellosDelPortero).toBe(true);
    expect(valor("vars", "SOLO_SELLOS_PORTERO")).toBeUndefined();
  });

  it("mainnet fija sus pagos por dirección para un stand que sale por la misma wifi", () => {
    expect(valor("env.mainnet.vars", "POR_IP_POR_HORA")).toBe('"600"');
    expect(valor("vars", "POR_IP_POR_HORA")).toBeUndefined();
  });

  it("las siete variables de los pagos están solo en mainnet: las tres de prender en 0 y los números de siempre", () => {
    expect(varsDeMainnet()).toMatchObject({
      PAGOS_PREMIO: "0",
      RETIROS: "0",
      ALTAS_PREMIO: "0",
      COSTO_RETIRO: "0.50",
      TOPE_PAGOS_STROOPS: "20000000",
      PAGOS_RECHAZADOS_DIA: "20",
      ALTAS_PREMIO_DIA: "100",
    });
    // Lo de arriba de todo es la red de prueba: no tiene ninguna.
    for (const s of VARIABLES_DE_PAGOS) {
      expect(valor("vars", s), s).toBeUndefined();
    }
  });

  it("con las siete líneas, el portero de hoy no falta nada y las tres formas siguen apagadas", () => {
    const cfg = leerConfig(varsDeMainnet());
    expect(cfg.faltaAltas).toEqual([]);
    expect(cfg).toMatchObject({
      pagosPremio: false,
      retiros: false,
      altasPremio: false,
      costoRetiro: { usdc: "0.50", monto: 5_000_000 },
      topePagos: 20_000_000,
      pagosRechazadosDia: 20,
      altasPremioDia: 100,
    });
  });

  it("con las tres apagadas, la configuración es la misma que sin las siete líneas, salvo los campos nuevos", () => {
    const vars = varsDeMainnet();
    const sinLasSiete = Object.fromEntries(Object.entries(vars).filter(([k]) => !VARIABLES_DE_PAGOS.includes(k)));
    const sinCamposNuevos = (cfg: object) => Object.fromEntries(Object.entries(cfg).filter(([k]) => !CAMPOS_DE_PAGOS.includes(k)));
    expect(sinCamposNuevos(leerConfig(vars))).toEqual(sinCamposNuevos(leerConfig(sinLasSiete)));
  });

  it("prender las tres es cambiar variables: con los tres interruptores en 1 se prenden sin que falte nada", () => {
    const cfg = leerConfig({ ...varsDeMainnet(), PAGOS_PREMIO: "1", RETIROS: "1", ALTAS_PREMIO: "1" });
    expect(cfg).toMatchObject({ pagosPremio: true, retiros: true, altasPremio: true, faltaAltas: [] });
  });

  it("ningún secreto ni dirección de Pollar o de Horizon en el archivo", () => {
    for (const s of ["POLLAR_SECRETO", "CUPONES_TOKEN", "CUPON_SECRETO", "CLAVE_SORTEADORA", "CLAVE_PATROCINADOR", "ADMIN_TOKEN"]) {
      expect(valor("vars", s), s).toBeUndefined();
      expect(valor("env.mainnet.vars", s), s).toBeUndefined();
    }
    expect(texto).not.toMatch(/sec_|pollar\.xyz|horizon\.stellar\.org/);
  });
});
