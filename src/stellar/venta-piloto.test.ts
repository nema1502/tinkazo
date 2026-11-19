// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreciosDeAlta, ResultadoDeAlta } from "./alta-api";

/**
 * La venta en piloto (`venta-piloto.ts`). Las tres banderas de la venta son del build y valen para todos: con ellas
 * prendidas y sin la marca del piloto en este navegador, el sitio es exactamente el de las tres apagadas (las
 * banderas, el diccionario, lo que se le pregunta al servidor, las páginas de lectura y el camino de pago). Con la marca,
 * o con `VITE_VENTA_ABIERTA=1`, la venta está a la vista. Cada caso carga los módulos de nuevo, como una página nueva.
 */

const PORTERO = "https://pm.tinkazo.app";
const PRENDIDAS = { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO, VITE_ALTA_PAGO: "1", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1" };
const APAGADAS = { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO, VITE_ALTA_PAGO: "", VITE_PAGO_CON_SALDO: "", VITE_COMPRA_QR: "" };
const VALORES = ["", "0", "1"] as const;
const CLAVE = "tinkazo.venta.piloto";
/** La raíz del repositorio: Vitest corre desde ahí (en jsdom, `import.meta.url` no es una dirección de archivo). */
const RAIZ = process.cwd();

/** La dirección de la pestaña, con lo que va después del `?`. */
const enLaDireccion = (consulta: string): void => history.replaceState(null, "", `/${consulta}`);

/** El sitio cargado de nuevo, con este entorno del build y en esta red. */
async function sitio(env: Record<string, string>, red: "mainnet" | "testnet" = "mainnet") {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const k of ["VITE_ALTA", "VITE_PATROCINIO_URL_MAINNET", "VITE_ALTA_PAGO", "VITE_PAGO_CON_SALDO", "VITE_COMPRA_QR", "VITE_VENTA_ABIERTA"]) vi.stubEnv(k, env[k] ?? "");
  vi.doMock("./config", async (orig) => {
    const real = await orig<typeof import("./config")>();
    return { ...real, network: { ...real.network, name: red } };
  });
  return {
    config: await import("./alta-config"),
    puerta: await import("./venta-piloto"),
    oferta: await import("./alta-oferta"),
    textos: await import("../alta-textos-con-cobro"),
  };
}

/** El diccionario de una página nueva, sin las funciones (dos cargas no comparten las mismas). */
async function diccionario(env: Record<string, string>): Promise<unknown> {
  await sitio(env);
  return JSON.parse(JSON.stringify((await import("../i18n")).T));
}

const PRECIOS: ResultadoDeAlta<PreciosDeAlta> = {
  ok: true,
  datos: { red: "mainnet", pago: true, alta: { usdc: "4", sorteos: 3, dias: 90, pausado: false }, paquetes: [{ id: "p10", usdc: "10", sorteos: 10, dias: 365, pausado: false }], recargoQr: { primera: "4", siguientes: "0.5" } },
};

const pagina = (archivo: string): Document => new DOMParser().parseFromString(readFileSync(join(RAIZ, archivo), "utf8"), "text/html");

beforeEach(() => {
  enLaDireccion("");
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  enLaDireccion("");
  localStorage.clear();
});

describe("con las banderas prendidas y sin la marca del piloto, el sitio es el de las banderas apagadas", () => {
  it("cada combinación de las tres banderas da lo mismo que las tres apagadas", async () => {
    let casos = 0;
    for (const pago of VALORES)
      for (const saldo of VALORES)
        for (const qr of VALORES) {
          const env = { ...APAGADAS, VITE_ALTA_PAGO: pago, VITE_PAGO_CON_SALDO: saldo, VITE_COMPRA_QR: qr };
          const { config } = await sitio(env);
          const caso = JSON.stringify(env);
          expect(config.banderasDeAlta(), caso).toEqual({ alta: true, libre: false, pago: false, sorteoServidor: false, qr: false });
          expect(config.banderasDeAlta(undefined, "mainnet"), caso).toEqual(config.banderasDeAlta(APAGADAS, "mainnet"));
          expect(config.altaPagoActivo(), caso).toBe(false);
          expect(config.pagoConSaldoActivo(), caso).toBe(false);
          expect(config.compraQrActiva(), caso).toBe(false);
          casos++;
        }
    expect(casos).toBe(27);
  });

  it("el diccionario es el mismo, clave por clave, en los dos idiomas", async () => {
    const con = await diccionario(PRENDIDAS);
    const sin = await diccionario(APAGADAS);
    expect(con).toEqual(sin);
  });

  it("las páginas públicas dicen lo de hoy: ningún texto de la compra", async () => {
    const { textos } = await sitio(PRENDIDAS);
    expect(textos.cobroEnElBuild()).toBe(false);
  });

  it("no le pregunta nada al servidor: ni la oferta ni los precios", async () => {
    const f = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", f);
    const { oferta } = await sitio(PRENDIDAS);
    expect(await oferta.leerOferta({ fetch: f as unknown as typeof fetch, url: PORTERO })).toEqual({ alta: null, paquetes: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it("precios.html y terminos.html no bajan lo de la compra: sus secciones quedan guardadas", async () => {
    const { config } = await sitio(PRENDIDAS);
    const { cargaElCobro } = await import("../cobro-en-la-pagina");
    // Lo mismo que pregunta pagina.ts.
    const pago = config.banderasDeAlta(undefined, "mainnet").pago;
    expect(pago).toBe(false);
    for (const archivo of ["precios.html", "terminos.html"]) expect(cargaElCobro(pagina(archivo), pago), archivo).toBe(false);
  });

  it("el camino de pago es el de hoy y el recargo del QR no se lee", async () => {
    const { config, oferta } = await sitio(PRENDIDAS);
    const { medioPorDefecto } = await import("../ui/medio-de-pago");
    expect(medioPorDefecto({ enElBuild: config.compraQrActiva(), servidor: { puede: true, motivo: null }, elegido: "qr", zona: "America/La_Paz" })).toEqual({ medio: "app", cambio: false });
    expect(oferta.recargoQrDe(PRECIOS, config.compraQrActiva())).toBeNull();
  });

  it("Sumar sorteos sigue con la regla de los 2 sorteos", async () => {
    const { puerta } = await sitio(PRENDIDAS);
    expect(puerta.sumarConCualquierCupo()).toBe(false);
  });
});

describe("con la marca del piloto, la venta está a la vista", () => {
  it("?piloto=compra la pone y queda guardada, y ?piloto=no la saca", async () => {
    enLaDireccion("?piloto=compra");
    const { config } = await sitio(PRENDIDAS);
    expect(config.banderasDeAlta()).toEqual({ alta: true, libre: false, pago: true, sorteoServidor: false, qr: true });
    expect(config.pagoConSaldoActivo()).toBe(true);
    // Guarda cuándo se puso: vale por unas horas, no para siempre.
    expect(Number(localStorage.getItem(CLAVE))).toBeGreaterThan(Date.now() - 60_000);
    // Sin la marca en la dirección, la guardada.
    enLaDireccion("");
    expect(config.compraQrActiva()).toBe(true);
    enLaDireccion("?piloto=no");
    expect(config.compraQrActiva()).toBe(false);
    expect(localStorage.getItem(CLAVE)).toBeNull();
    enLaDireccion("");
    expect(config.compraQrActiva()).toBe(false);
  });

  it("se lee al preguntar y no al cargar: vale desde la primera pregunta de la primera carga", async () => {
    const { config } = await sitio(PRENDIDAS);
    expect(config.compraQrActiva()).toBe(false);
    enLaDireccion("?piloto=compra");
    expect(config.compraQrActiva()).toBe(true);
  });

  it("el diccionario de la primera carga ya dice la compra, y la oferta le pregunta al servidor", async () => {
    enLaDireccion("?piloto=compra");
    const { textos, oferta } = await sitio(PRENDIDAS);
    expect(textos.cobroEnElBuild()).toBe(true);
    const T = (await import("../i18n")).T;
    const con = textos.textosConCobro();
    for (const l of ["es", "en"] as const) for (const [k, v] of Object.entries(con[l])) expect(T[l][k], `${l} ${k}`).toBe(v);
    const f = vi.fn(async () => new Response(JSON.stringify(PRECIOS.ok ? PRECIOS.datos : {}), { status: 200 }));
    await oferta.leerOferta({ fetch: f as unknown as typeof fetch, url: PORTERO });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("precios.html y terminos.html ponen sus secciones de la compra", async () => {
    enLaDireccion("?piloto=compra");
    const { config } = await sitio(PRENDIDAS);
    const { cargaElCobro } = await import("../cobro-en-la-pagina");
    const pago = config.banderasDeAlta(undefined, "mainnet").pago;
    for (const archivo of ["precios.html", "terminos.html"]) expect(cargaElCobro(pagina(archivo), pago), archivo).toBe(true);
  });

  it("Sumar sorteos se ofrece con cualquier cantidad de sorteos", async () => {
    enLaDireccion("?piloto=compra");
    const { puerta } = await sitio(PRENDIDAS);
    expect(puerta.sumarConCualquierCupo()).toBe(true);
  });

  it("la marca sola no prende nada: con las banderas apagadas, o en Prueba, todo sigue apagado", async () => {
    enLaDireccion("?piloto=compra");
    const apagadas = await sitio(APAGADAS);
    expect(apagadas.config.banderasDeAlta()).toEqual({ alta: true, libre: false, pago: false, sorteoServidor: false, qr: false });
    const prueba = await sitio(PRENDIDAS, "testnet");
    expect(prueba.config.banderasDeAlta()).toEqual({ alta: false, libre: false, pago: false, sorteoServidor: false, qr: false });
    expect(prueba.config.compraQrActiva()).toBe(false);
  });

  it("sin un almacén que funcione no se rompe nada: la dirección vale para esa carga y sin ella no hay marca", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const { config } = await sitio(PRENDIDAS);
    expect(config.compraQrActiva()).toBe(false);
    enLaDireccion("?piloto=compra");
    expect(config.compraQrActiva()).toBe(true);
    enLaDireccion("?piloto=no");
    expect(config.compraQrActiva()).toBe(false);
  });

  it("otra palabra en la dirección no cambia lo guardado", async () => {
    localStorage.setItem(CLAVE, String(Date.now()));
    enLaDireccion("?piloto=si");
    const { config } = await sitio(PRENDIDAS);
    expect(config.compraQrActiva()).toBe(true);
    localStorage.clear();
    expect(config.compraQrActiva()).toBe(false);
  });
});

describe("la marca vence sola y no queda en la dirección", () => {
  const HORA = 60 * 60 * 1000;
  const T0 = Date.UTC(2026, 10, 13, 20, 0);

  it("vale seis horas desde que se puso, y después se borra sola", async () => {
    const { puerta } = await sitio(PRENDIDAS);
    expect(puerta.VIDA_DE_LA_MARCA_MS).toBe(6 * HORA);
    const pestana = (search: string, ahora: number) => ({ location: { search, pathname: "/", hash: "" }, localStorage, history, ahora: () => ahora });
    expect(puerta.marcaDelPiloto(pestana("?piloto=compra", T0))).toBe(true);
    expect(puerta.marcaDelPiloto(pestana("", T0 + 6 * HORA - 1))).toBe(true);
    expect(puerta.marcaDelPiloto(pestana("", T0 + 6 * HORA))).toBe(false);
    expect(localStorage.getItem(CLAVE)).toBeNull();
    // Abrir de nuevo con ?piloto=compra la vuelve a poner por seis horas más.
    expect(puerta.marcaDelPiloto(pestana("?piloto=compra", T0 + 7 * HORA))).toBe(true);
    expect(puerta.marcaDelPiloto(pestana("", T0 + 12 * HORA))).toBe(true);
  });

  it("una marca sin la hora, o con una hora que no cierra, no vale", async () => {
    const { puerta } = await sitio(PRENDIDAS);
    for (const guardado of ["1", "si", "", "-5", String(Date.now() + 60 * 60 * 1000)]) {
      localStorage.setItem(CLAVE, guardado);
      expect(puerta.marcaDelPiloto(), guardado).toBe(false);
    }
  });

  it("con la marca guardada, ?piloto=compra sale de la dirección y lo demás queda", async () => {
    enLaDireccion("?piloto=compra&lang=en#sortear");
    const { config } = await sitio(PRENDIDAS);
    expect(config.compraQrActiva()).toBe(true);
    expect(location.search).toBe("?lang=en");
    expect(location.hash).toBe("#sortear");
    // Sigue valiendo con la guardada.
    expect(config.compraQrActiva()).toBe(true);
  });

  it("?piloto=no también sale de la dirección", async () => {
    localStorage.setItem(CLAVE, String(Date.now()));
    enLaDireccion("?piloto=no");
    const { config } = await sitio(PRENDIDAS);
    expect(config.compraQrActiva()).toBe(false);
    expect(location.search).toBe("");
  });

  it("sin almacén, la dirección se queda: es lo único que hace valer la marca en esa carga", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    enLaDireccion("?piloto=compra");
    const { config } = await sitio(PRENDIDAS);
    expect(config.compraQrActiva()).toBe(true);
    expect(location.search).toBe("?piloto=compra");
  });
});

describe("VITE_VENTA_ABIERTA=1 saca el piloto", () => {
  it("la venta a la vista para todos, sin la marca", async () => {
    const { config, textos } = await sitio({ ...PRENDIDAS, VITE_VENTA_ABIERTA: "1" });
    expect(config.banderasDeAlta()).toEqual({ alta: true, libre: false, pago: true, sorteoServidor: false, qr: true });
    expect(config.altaPagoActivo()).toBe(true);
    expect(config.pagoConSaldoActivo()).toBe(true);
    expect(config.compraQrActiva()).toBe(true);
    expect(textos.cobroEnElBuild()).toBe(true);
  });

  it("sola no prende ninguna bandera", async () => {
    const { config } = await sitio({ ...APAGADAS, VITE_VENTA_ABIERTA: "1" });
    expect(config.banderasDeAlta()).toEqual({ alta: true, libre: false, pago: false, sorteoServidor: false, qr: false });
  });

  it("con la venta abierta, Sumar sorteos vuelve a la regla de los 2 aunque haya marca", async () => {
    enLaDireccion("?piloto=compra");
    const { puerta } = await sitio({ ...PRENDIDAS, VITE_VENTA_ABIERTA: "1" });
    expect(puerta.sumarConCualquierCupo()).toBe(false);
  });
});

describe("con un entorno en la mano (el control del build y las pruebas), las banderas son las de ese entorno", () => {
  it("sin mirar la marca de este navegador", async () => {
    const { config, puerta } = await sitio(APAGADAS);
    expect(config.banderasDeAlta(PRENDIDAS, "mainnet")).toEqual({ alta: true, libre: false, pago: true, sorteoServidor: false, qr: true });
    expect(puerta.banderasDeVenta(PRENDIDAS)).toEqual({ pago: true, saldo: true, qr: true });
    expect(puerta.banderasDeVenta(APAGADAS)).toEqual({ pago: false, saldo: false, qr: false });
  });
});
