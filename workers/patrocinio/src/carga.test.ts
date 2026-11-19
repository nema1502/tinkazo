import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IP, codigo, montarAltas } from "./altas-prueba";
import { leerConfig } from "./config";
import { PorIp, cupoPorHora } from "./por-ip";
import { AJUSTE_PAUSA, PISO_BASE, atenderCarga } from "./rutas-altas";

/**
 * El tope de la carga con QR (`GET /v1/carga/cupo`): el sitio ofrece cargar con un QR del banco solo si el servidor dice
 * `abierta`. Abierta solo con `CARGAS=1`, las altas sin pausar y los créditos de Pollar por encima del piso más la
 * reserva. Ante cualquier duda, cerrada.
 */

describe("las variables de la carga", () => {
  it("nace cerrada: solo un 1 en CARGAS la abre, en mainnet y con el libro; la reserva es de 400 créditos", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1" })).toMatchObject({ cargas: false, reservaCargaCreditos: 400 });
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", CARGAS: "1", RESERVA_CARGA_CREDITOS: "1000" })).toMatchObject({ cargas: true, reservaCargaCreditos: 1000 });
    for (const v of ["true", " 1", "01", "0", ""]) expect(leerConfig({ RED: "mainnet", ALTAS: "1", CARGAS: v }).cargas, JSON.stringify(v)).toBe(false);
    expect(leerConfig({ RED: "mainnet", ALTAS: "0", CARGAS: "1" }).cargas).toBe(false);
    expect(leerConfig({ RED: "testnet", ALTAS: "1", CARGAS: "1" }).cargas).toBe(false);
    for (const v of ["-5", "mucho", ""]) expect(leerConfig({ RED: "mainnet", ALTAS: "1", RESERVA_CARGA_CREDITOS: v }).reservaCargaCreditos, v).toBe(400);
  });

  it("el archivo de mainnet la trae cerrada, con su reserva; el de testnet no tiene las variables", () => {
    const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const mainnet = texto.slice(texto.indexOf("[env.mainnet.vars]"));
    const arriba = texto.slice(0, texto.indexOf("[env.mainnet]"));
    expect(mainnet).toMatch(/^CARGAS = "0"$/m);
    // La semana del evento: lo que piden las tarjetas sin canjear, encima del piso. El lunes vuelve a 400.
    expect(mainnet).toMatch(/^RESERVA_CARGA_CREDITOS = "8400"$/m);
    expect(arriba).not.toMatch(/^CARGAS\b/m);
    expect(arriba).not.toMatch(/^RESERVA_CARGA_CREDITOS\b/m);
  });
});

describe("si la carga está abierta (el objeto)", () => {
  /** Lo mínimo para que esté abierta sin nada prometido: más que el piso de base y la reserva. */
  const UMBRAL = PISO_BASE + 400;

  it("abierta solo con los créditos por encima del piso más la reserva", async () => {
    const m = montarAltas({ CARGAS: "1" });
    m.pm.creditos = UMBRAL + 1;
    expect(await m.puerta.cargaAbierta()).toBe(true);
    m.pm.creditos = UMBRAL;
    m.mover(61_000);
    expect(await m.puerta.cargaAbierta()).toBe(false);
  });

  it("lo prometido sube el piso: un cupón canjeado de 3 sorteos suma 3 por 40 más 30 del alta", async () => {
    const m = montarAltas({ CARGAS: "1" });
    await m.lote([codigo(1)]);
    const ana = m.persona("usr_ana");
    expect((await m.cupon(ana.token, codigo(1))).estado).toBe(200);
    m.pm.creditos = UMBRAL + 150;
    m.mover(61_000);
    expect(await m.puerta.cargaAbierta()).toBe(false);
    m.pm.creditos = UMBRAL + 151;
    m.mover(61_000);
    expect(await m.puerta.cargaAbierta()).toBe(true);
  });

  it("la reserva sale de RESERVA_CARGA_CREDITOS", async () => {
    const m = montarAltas({ CARGAS: "1", RESERVA_CARGA_CREDITOS: "2000" });
    m.pm.creditos = PISO_BASE + 2000;
    expect(await m.puerta.cargaAbierta()).toBe(false);
    m.pm.creditos = PISO_BASE + 2001;
    m.mover(61_000);
    expect(await m.puerta.cargaAbierta()).toBe(true);
  });

  it("cerrada sin CARGAS, con las altas pausadas, sin Pollar o en testnet", async () => {
    for (const env of [{}, { CARGAS: "0" }, { CARGAS: "true" }, { CARGAS: "1", ALTAS: "0" }, { CARGAS: "1", RED: "testnet" }]) {
      const m = montarAltas(env);
      m.pm.creditos = 1_000_000;
      expect(await m.puerta.cargaAbierta(), JSON.stringify(env)).toBe(false);
    }
    const pausada = montarAltas({ CARGAS: "1" });
    pausada.pm.creditos = 1_000_000;
    pausada.cupos.fijarAjuste(AJUSTE_PAUSA, "1", pausada.hora());
    expect(await pausada.puerta.cargaAbierta()).toBe(false);
    pausada.cupos.fijarAjuste(AJUSTE_PAUSA, "0", pausada.hora());
    expect(await pausada.puerta.cargaAbierta()).toBe(true);
    const sinPollar = montarAltas({ CARGAS: "1" }, { sinPollar: true });
    expect(await sinPollar.puerta.cargaAbierta()).toBe(false);
    const sinSecreto = montarAltas({ CARGAS: "1" }, { cuponSecreto: null });
    sinSecreto.pm.creditos = 1_000_000;
    expect(await sinSecreto.puerta.cargaAbierta()).toBe(false);
  });

  it("sin una lectura de créditos que valga, cerrada: con Pollar caído vale la última de 10 minutos, después no", async () => {
    const nunca = montarAltas({ CARGAS: "1" });
    nunca.pm.creditosCaido = true;
    expect(await nunca.puerta.cargaAbierta()).toBe(false);

    const m = montarAltas({ CARGAS: "1" });
    m.pm.creditos = 1_000_000;
    expect(await m.puerta.cargaAbierta()).toBe(true);
    m.pm.creditosCaido = true;
    m.mover(5 * 60_000);
    expect(await m.puerta.cargaAbierta()).toBe(true);
    m.mover(6 * 60_000);
    expect(await m.puerta.cargaAbierta()).toBe(false);
  });

  it("un saldo que Pollar devuelve con una forma rara no abre nada", async () => {
    const m = montarAltas({ CARGAS: "1" });
    m.pm.creditos = "mucho" as unknown as number;
    expect(await m.puerta.cargaAbierta()).toBe(false);
  });
});

describe("la ruta en la puerta del Worker", () => {
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", CARGAS: "1" });
  const pedido = (init: { metodo?: string; origen?: string; ip?: string; ruta?: string } = {}) => {
    const h = new Headers({ "CF-Connecting-IP": init.ip ?? IP });
    if (init.origen) h.set("Origin", init.origen);
    return new Request(`https://pm.tinkazo.app${init.ruta ?? "/v1/carga/cupo"}`, { method: init.metodo ?? "GET", headers: h });
  };

  it("GET contesta {abierta}, abierta a cualquier origen como /cupo y sin guardarse en caché", async () => {
    for (const abierta of [true, false]) {
      const r = (await atenderCarga(pedido({ origen: "https://otro.example" }), cfg, new PorIp(), async () => abierta)) as Response;
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ abierta });
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    const sinOrigen = (await atenderCarga(pedido(), cfg, new PorIp(), async () => true)) as Response;
    expect(await sinOrigen.json()).toEqual({ abierta: true });
  });

  it("si el objeto falla o contesta otra cosa, cerrada", async () => {
    const falla = (await atenderCarga(pedido(), cfg, new PorIp(), async () => Promise.reject(new Error("caido")))) as Response;
    expect([falla.status, await falla.json()]).toEqual([200, { abierta: false }]);
    const raro = (await atenderCarga(pedido(), cfg, new PorIp(), async () => "si" as unknown as boolean)) as Response;
    expect(await raro.json()).toEqual({ abierta: false });
  });

  it("el preflight y los métodos: OPTIONS 204, otro que no sea GET 405", async () => {
    const op = (await atenderCarga(pedido({ metodo: "OPTIONS", origen: "https://tinkazo.app" }), cfg, new PorIp(), async () => true)) as Response;
    expect(op.status).toBe(204);
    expect(op.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const post = (await atenderCarga(pedido({ metodo: "POST" }), cfg, new PorIp(), async () => true)) as Response;
    expect([post.status, await post.json()]).toEqual([405, { motivo: "metodo" }]);
  });

  it(`por dirección y por hora, el mismo tope que /cupo (${cupoPorHora("mainnet")}); otra dirección sigue`, async () => {
    const porIp = new PorIp();
    let preguntas = 0;
    const consultar = async () => (preguntas++, true);
    for (let i = 0; i < cupoPorHora("mainnet"); i++) expect((await atenderCarga(pedido(), cfg, porIp, consultar))?.status).toBe(200);
    const pasado = (await atenderCarga(pedido(), cfg, porIp, consultar)) as Response;
    expect([pasado.status, await pasado.json()]).toEqual([429, { motivo: "cupo-ip" }]);
    expect(pasado.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preguntas).toBe(cupoPorHora("mainnet"));
    expect((await atenderCarga(pedido({ ip: "200.87.1.2" }), cfg, porIp, consultar))?.status).toBe(200);
  });

  it("solo en mainnet y solo esa ruta: en testnet no existe", async () => {
    expect(await atenderCarga(pedido(), leerConfig({ RED: "testnet" }), new PorIp(), async () => true)).toBeNull();
    expect(await atenderCarga(pedido({ ruta: "/v1/carga/otra" }), cfg, new PorIp(), async () => true)).toBeNull();
  });

  it("el Worker la atiende con su propio contador, antes que lo demás, y el objeto la contesta", () => {
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(index).toMatch(/const cargaPorIp = new PorIp\(\);/);
    expect(index).toMatch(/atenderCarga\(request, leerConfig\(env\), cargaPorIp, \(\) => objeto\.carga\(\)\)/);
    expect(index.indexOf("atenderCarga(")).toBeLessThan(index.indexOf('if (request.method === "OPTIONS")'));
    expect(index).toMatch(/async carga\(\): Promise<boolean>/);
  });
});
