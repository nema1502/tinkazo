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

  it("un id de app de Pollar con caracteres raros no se toma", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app id/../x" }).pollarAppId).toBeNull();
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "  app_1  " }).pollarAppId).toBe("app_1");
  });
});

describe("PRECIOS", () => {
  it("la cadena del diseño da los tres productos, con el monto en diezmillonésimas", () => {
    expect(leerPrecios(PRECIOS_POR_DEFECTO)).toEqual([
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
    expect(valor("env.mainnet.vars", "ALTAS_PAGO")).toBe('"0"');
    expect(valor("env.mainnet.vars", "SORTEO_SERVIDOR")).toBe('"0"');
    expect(valor("env.mainnet.vars", "MAX_SELLOS_MES")).toBe('"100"');
    expect(valor("env.mainnet.vars", "RESERVA_SORTEO_STROOPS")).toBe('"1236000"');
    // Vacía a propósito: con el libro, la puerta no mira quién abrió la cuenta.
    expect(valor("env.mainnet.vars", "PATROCINADORES_APP")).toBe('""');
    const precios = valor("env.mainnet.vars", "PRECIOS");
    expect(precios && leerPrecios(JSON.parse(precios) as string)).toEqual(leerPrecios(PRECIOS_POR_DEFECTO));
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

  it("ningún secreto ni dirección de Pollar o de Horizon en el archivo", () => {
    for (const s of ["POLLAR_SECRETO", "CUPONES_TOKEN", "CUPON_SECRETO", "CLAVE_SORTEADORA", "CLAVE_PATROCINADOR", "ADMIN_TOKEN"]) {
      expect(valor("vars", s), s).toBeUndefined();
      expect(valor("env.mainnet.vars", s), s).toBeUndefined();
    }
    expect(texto).not.toMatch(/sec_|pollar\.xyz|horizon\.stellar\.org/);
  });
});
