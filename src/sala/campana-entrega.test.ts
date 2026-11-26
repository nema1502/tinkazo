import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { huellaDeLlave, huellaDePersona, listaDeLaCampana, salDeCampana } from "../../workers/sala/src/campana";
import { codigosDeEntrega, lineaDePersona } from "../../workers/sala/src/linea-persona";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import { campanaDePrueba, firmarParaLaPrueba, montarMundo, type MundoDeSala, type SalaDeCampana } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia cada prueba. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * El código de entrega de una campaña de personas: cuatro cifras por ganadora que salen de su línea con la sal de la sala. Las ve
 * quien organiza (con su token, en orden de puesto) y cada ganadora (solo el suyo, con la llave de su celular). La sala no guarda
 * nada para darlo y no lo escribe en ningún registro.
 */
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const CLIENTE = "cliente-de-prueba.apps.example.org";
const RONDA = 40_000_000;
const SORTEO = "123456789";
const COMPROBANTE = "/verificar.html?x=1";
const MANO = { identidad: "persona", premio_en_mano: { es: "Auriculares", en: "Headphones" }, premios: ["0", "0"] };
const llaveDe = (n: number): string => `celular${n}`.padEnd(22, "x");
const auth = (sala: SalaDeCampana): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });
const ruta = (sala: SalaDeCampana, resto: string): string => `/v1/sala/${sala.id}${resto}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Una sala de personas con premio en mano y tres personas anotadas, lista para pasar de fase. */
async function montar(extra: Record<string, string> = {}) {
  const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, ...extra });
  const creada = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, MANO)) });
  expect(creada.status).toBe(201);
  const sala = (await creada.json()) as SalaDeCampana;
  const abierta = await mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth(sala) });
  expect(abierta.status).toBe(204);
  const sql = ((consulta: string, ...parametros: ValorSql[]) => mundo.ejecutar(`sala:${sala.id}`, consulta, ...parametros)) as unknown as Ejecutar;
  const sal = salDeCampana(sql);
  const lineas: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const linea = await lineaDePersona(sal, `google:usuario${n}`);
    lineas.push(linea);
    mundo.ejecutar(`sala:${sala.id}`, "INSERT INTO equipos (cuenta, d, estado, v, llave) VALUES (?, 'x', 'aceptado', ?, ?)", linea, n, await huellaDeLlave(llaveDe(n)));
    mundo.ejecutar(`sala:${sala.id}`, "INSERT INTO personas (persona, cuenta) VALUES (?, ?)", await huellaDePersona(sql, `google:usuario${n}`), linea);
  }
  const orden = listaDeLaCampana(lineas);
  const poner = (fase: string, cuerpo: Record<string, unknown> = {}) =>
    mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase, ...cuerpo }, cabeceras: auth(sala) });
  const sello = { listHash: Buffer.from(listHash(orden)).toString("hex"), count: 3, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA };
  /** Cierra, sella y guarda el resultado: ganan el tercer y el primer lugar de la lista. */
  async function sortear(): Promise<string[]> {
    expect((await poner("cerrada")).status).toBe(204);
    lectura.valor = { sello, ganadores: null };
    expect((await poner("sellada", { sorteo: SORTEO })).status).toBe(204);
    lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
    const guardo = await mundo.pedir(ruta(sala, "/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth(sala) });
    expect(guardo.status).toBe(204);
    await mundo.esperarSegundoPlano();
    return [orden[2] as string, orden[0] as string];
  }
  const entrega = (cabeceras: Record<string, string> = auth(sala)) => mundo.pedir(ruta(sala, "/campana/entrega"), { cabeceras });
  const yo = async (llave: string): Promise<Record<string, unknown>> =>
    (await (await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { llave } })).json()) as Record<string, unknown>;
  /** La llave del celular de la persona de esa línea. */
  const llaveDeLinea = (linea: string): string => llaveDe(lineas.indexOf(linea) + 1);
  return { mundo, sala, sal, lineas, orden, poner, sortear, entrega, yo, llaveDeLinea };
}

/** Todo lo que la sala guarda de una campaña: lo que una lectura no puede cambiar. */
function loGuardado(mundo: MundoDeSala, sala: SalaDeCampana): string {
  const tablas = ["sala", "equipos", "personas", "campana_avisos", "campana_quitadas"];
  return JSON.stringify(tablas.map((t) => mundo.ejecutar(`sala:${sala.id}`, `SELECT * FROM ${t} ORDER BY 1, 2`)));
}

describe("GET campana/entrega", () => {
  it("sorteada y con el token, da un código de cuatro cifras por ganadora en orden de puesto, sin guardarse en el borde", async () => {
    const { sal, sortear, entrega } = await montar();
    const ganadoras = await sortear();
    const r = await entrega();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const cuerpo = (await r.json()) as { codigos: string[] };
    expect(Object.keys(cuerpo)).toEqual(["codigos"]);
    expect(cuerpo.codigos).toEqual(await codigosDeEntrega(sal, ganadoras));
    expect(cuerpo.codigos).toHaveLength(2);
    for (const codigo of cuerpo.codigos) expect(codigo).toMatch(/^[0-9]{4}$/);
    expect(new Set(cuerpo.codigos).size).toBe(2);
  });

  it("pedido otra vez da lo mismo, y no escribe nada en la sala", async () => {
    const { mundo, sala, sortear, entrega } = await montar();
    await sortear();
    const antes = loGuardado(mundo, sala);
    const primera = await (await entrega()).json();
    const segunda = await (await entrega()).json();
    expect(segunda).toEqual(primera);
    expect(loGuardado(mundo, sala)).toBe(antes);
  });

  it("dos pedidos a la vez dan lo mismo", async () => {
    const { sortear, entrega } = await montar();
    await sortear();
    const [a, b, c] = await Promise.all([entrega(), entrega(), entrega()]);
    const cuerpos = await Promise.all([a, b, c].map((r) => r.json()));
    expect(cuerpos[1]).toEqual(cuerpos[0]);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
  });

  it("sin token o con un token que no es el de la sala da 403, aunque ya se haya sorteado", async () => {
    const { sala, sortear, entrega } = await montar();
    await sortear();
    for (const cabeceras of [{}, { Authorization: "Bearer " }, { Authorization: "Bearer no-es-el-token" }, { Authorization: `Bearer ${sala.token}x` }]) {
      const r = await entrega(cabeceras);
      expect(r.status, JSON.stringify(cabeceras)).toBe(403);
      expect(await r.json()).toEqual({ error: "token" });
    }
  });

  it("antes del sorteo da 409 fase, en cada fase", async () => {
    const { mundo, sala, poner, entrega } = await montar();
    const esperar409 = async () => {
      const r = await entrega();
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "fase" });
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    };
    await esperar409();
    expect((await poner("cerrada")).status).toBe(204);
    await esperar409();
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'fase'")).toEqual([{ v: "cerrada" }]);
  });

  it("sellada y todavía sin resultado da 409 fase", async () => {
    const { orden, poner, entrega } = await montar();
    expect((await poner("cerrada")).status).toBe(204);
    lectura.valor = {
      sello: { listHash: Buffer.from(listHash(orden)).toString("hex"), count: 3, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA },
      ganadores: null,
    };
    expect((await poner("sellada", { sorteo: SORTEO })).status).toBe(204);
    const r = await entrega();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "fase" });
  });

  it("en una sala de cuentas da 409 no-es-de-personas, y sin token 403 como siempre", async () => {
    const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    const creada = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA)) });
    expect(creada.status).toBe(201);
    const sala = (await creada.json()) as SalaDeCampana;
    const r = await mundo.pedir(ruta(sala, "/campana/entrega"), { cabeceras: auth(sala) });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "no-es-de-personas" });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const sinToken = await mundo.pedir(ruta(sala, "/campana/entrega"));
    expect(sinToken.status).toBe(403);
    expect(await sinToken.json()).toEqual({ error: "token" });
  });

  it("en una sala que no existe da 404 no-existe", async () => {
    const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    const r = await mundo.pedir("/v1/sala/AbCdEf12/campana/entrega", { cabeceras: { Authorization: `Bearer ${"x".repeat(20)}` } });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no-existe" });
  });

  it("no es un pedido de escritura: con otro método no da códigos", async () => {
    const { mundo, sala, sortear } = await montar();
    await sortear();
    for (const metodo of ["POST", "PUT", "DELETE"]) {
      const r = await mundo.pedir(ruta(sala, "/campana/entrega"), { metodo, cabeceras: auth(sala), ...(metodo === "DELETE" ? {} : { cuerpo: {} }) });
      expect(r.status, metodo).not.toBe(200);
      expect(await r.text(), metodo).not.toMatch(/codigos/);
    }
  });

  it("con los interruptores de las personas apagados la campaña en curso sigue dando los códigos", async () => {
    const { mundo, sal, sortear, entrega } = await montar();
    const ganadoras = await sortear();
    mundo.env.DIFERIDA = "0";
    mundo.env.GOOGLE_CLIENT_ID = "";
    const r = await entrega();
    expect(r.status).toBe(200);
    expect(((await r.json()) as { codigos: string[] }).codigos).toEqual(await codigosDeEntrega(sal, ganadoras));
  });

  it("no deja ningún código, token ni línea en los registros", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const { sala, sal, sortear, entrega, yo, llaveDeLinea } = await montar();
    const ganadoras = await sortear();
    const codigos = await codigosDeEntrega(sal, ganadoras);
    await entrega();
    await entrega({});
    await yo(llaveDeLinea(ganadoras[0] as string));
    const escrito = JSON.stringify(consola.map((c) => c.mock.calls));
    for (const secreto of [...codigos, sala.token, ...ganadoras]) expect(escrito).not.toContain(secreto);
  });
});

describe("el código propio en la consulta del celular de una persona", () => {
  it("quien ganó recibe su código y solo el suyo, el del puesto que le tocó", async () => {
    const { sal, sortear, yo, llaveDeLinea } = await montar();
    const ganadoras = await sortear();
    const codigos = await codigosDeEntrega(sal, ganadoras);
    for (const [puesto, linea] of ganadoras.entries()) {
      const r = await yo(llaveDeLinea(linea));
      expect(r).toMatchObject({ fase: "sorteada", anotada: true, gano: true, puesto, codigo: codigos[puesto] });
      expect(JSON.stringify(r)).not.toContain(codigos[1 - puesto] as string);
    }
  });

  it("lo que ya devuelve no cambia: solo se suma el campo codigo a quien ganó", async () => {
    const { sortear, yo, llaveDeLinea } = await montar();
    const ganadoras = await sortear();
    const ganadora = await yo(llaveDeLinea(ganadoras[0] as string));
    expect(Object.keys(ganadora).sort()).toEqual(["anotada", "cierraMs", "codigo", "fase", "gano", "puesto", "ronda", "sorteo", "total"]);
    expect(ganadora.codigo).toMatch(/^[0-9]{4}$/);
  });

  it("quien no ganó no recibe ningún código ni la clave", async () => {
    const { lineas, sal, sortear, yo, llaveDeLinea } = await montar();
    const ganadoras = await sortear();
    const perdedora = lineas.find((l) => !ganadoras.includes(l)) as string;
    const r = await yo(llaveDeLinea(perdedora));
    expect(r).toMatchObject({ fase: "sorteada", anotada: true, gano: false });
    expect("codigo" in r).toBe(false);
    for (const codigo of await codigosDeEntrega(sal, ganadoras)) expect(JSON.stringify(r)).not.toContain(codigo);
  });

  it("una llave que no es de nadie no recibe ningún código", async () => {
    const { sortear, yo } = await montar();
    await sortear();
    const r = await yo(llaveDe(99));
    expect(r).toMatchObject({ fase: "sorteada", anotada: false });
    expect("codigo" in r).toBe(false);
    expect("gano" in r).toBe(false);
  });

  it("antes del sorteo nadie recibe un código", async () => {
    const { poner, yo, llaveDeLinea, lineas } = await montar();
    for (const linea of lineas) expect("codigo" in (await yo(llaveDeLinea(linea)))).toBe(false);
    expect((await poner("cerrada")).status).toBe(204);
    for (const linea of lineas) expect("codigo" in (await yo(llaveDeLinea(linea)))).toBe(false);
  });

  it("sigue dando el código con los interruptores de las personas apagados", async () => {
    const { mundo, sortear, yo, llaveDeLinea } = await montar();
    const ganadoras = await sortear();
    mundo.env.DIFERIDA = "0";
    mundo.env.GOOGLE_CLIENT_ID = "";
    expect(((await yo(llaveDeLinea(ganadoras[1] as string))) as { codigo?: string }).codigo).toMatch(/^[0-9]{4}$/);
  });

  it("es el mismo código que ve quien organiza para esa ganadora", async () => {
    const { sortear, entrega, yo, llaveDeLinea } = await montar();
    const ganadoras = await sortear();
    const { codigos } = (await (await entrega()).json()) as { codigos: string[] };
    for (const [puesto, linea] of ganadoras.entries()) expect((await yo(llaveDeLinea(linea))).codigo).toBe(codigos[puesto]);
  });
});
