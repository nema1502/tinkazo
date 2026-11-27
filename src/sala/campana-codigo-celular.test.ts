import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { huellaDeLlave, huellaDePersona, listaDeLaCampana, salDeCampana } from "../../workers/sala/src/campana";
import { lineaDePersona } from "../../workers/sala/src/linea-persona";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import { codigosDeEntrega } from "./campana-org";
import type { Sala } from "./cliente";
import { miEstadoDePersona } from "./celular-persona";
import { campanaDePrueba, firmarParaLaPrueba, montarMundo, type MundoDeSala, type SalaDeCampana } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia cada prueba. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * El código de entrega de punta a punta, con la sala de verdad en memoria y los clientes de verdad de cada lado: el celular de
 * quien ganó (su consulta propia) y el panel de quien organiza (el pedido de los códigos). El código que lee el celular de cada
 * ganadora tiene que ser el que el panel muestra para ella, y a quien no ganó no le llega ninguno. La pantalla Ganaste que lo
 * pinta se prueba en `celular-codigo.test.ts`, que necesita un documento y no puede convivir con el Worker en un mismo archivo.
 */
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const CLIENTE = "cliente-de-prueba.apps.example.org";
const RONDA = 40_000_000;
const SORTEO = "123456789";
const MANO = { identidad: "persona", premio_en_mano: { es: "Auriculares", en: "Headphones" }, premios: ["0", "0"] };
const llaveDe = (n: number): string => `celular${n}`.padEnd(22, "x");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Una sala de personas con premio en mano, tres personas anotadas y el sorteo hecho: ganan el tercer y el primer lugar. */
async function sorteada() {
  const mundo: MundoDeSala = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
  const creada = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, MANO)) });
  expect(creada.status).toBe(201);
  const sala = (await creada.json()) as SalaDeCampana;
  const ruta = (resto: string): string => `/v1/sala/${sala.id}${resto}`;
  const auth = { Authorization: `Bearer ${sala.token}` };
  const poner = (fase: string, cuerpo: Record<string, unknown> = {}) =>
    mundo.pedir(ruta("/campana/fase"), { metodo: "PUT", cuerpo: { fase, ...cuerpo }, cabeceras: auth });
  expect((await poner("abierta")).status).toBe(204);
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
  const sello = { listHash: Buffer.from(listHash(orden)).toString("hex"), count: 3, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA };
  expect((await poner("cerrada")).status).toBe(204);
  lectura.valor = { sello, ganadores: null };
  expect((await poner("sellada", { sorteo: SORTEO })).status).toBe(204);
  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
  const guardo = await mundo.pedir(ruta("/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: "/verificar.html?x=1" }, cabeceras: auth });
  expect(guardo.status).toBe(204);
  await mundo.esperarSegundoPlano();
  const ganadoras = [orden[2] as string, orden[0] as string];

  /** El `fetch` del navegador, llevado a la sala. */
  const fetchDeLaSala: typeof fetch = async (url, init) => {
    const u = new URL(String(url));
    const cuerpo = typeof init?.body === "string" ? init.body : undefined;
    const cabeceras = Object.fromEntries(new Headers(init?.headers).entries());
    return mundo.pedir(`${u.pathname}${u.search}`, {
      metodo: init?.method ?? "GET",
      ...(cuerpo === undefined ? {} : { cuerpo: JSON.parse(cuerpo) as unknown }),
      cabeceras,
      base: u.origin,
    });
  };
  const dep = { fetch: fetchDeLaSala, azar: () => 0.5 };
  const delPanel: Sala = { id: sala.id, token: sala.token, clave: "C".repeat(22), vence: AHORA + 3_600_000, servicio: "http://127.0.0.1:8792" };
  const llaveDeLinea = (linea: string): string => llaveDe(lineas.indexOf(linea) + 1);
  return { lineas, ganadoras, dep, delPanel, llaveDeLinea, servicio: "http://127.0.0.1:8792", id: sala.id };
}

describe("el código del celular y el del panel, con la sala de verdad", () => {
  it("el cliente del celular lee el código de cada ganadora y es el que el panel pide para su puesto", async () => {
    const { ganadoras, dep, delPanel, llaveDeLinea, servicio, id } = await sorteada();
    const delOrganizador = await codigosDeEntrega(delPanel, dep);
    expect(Array.isArray(delOrganizador)).toBe(true);
    const codigos = delOrganizador as string[];
    expect(codigos).toHaveLength(2);
    for (const [puesto, linea] of ganadoras.entries()) {
      const propio = await miEstadoDePersona(servicio, id, llaveDeLinea(linea), dep);
      expect(propio).toMatchObject({ anotada: true, gano: true, codigo: codigos[puesto] });
    }
  });

  it("quien no ganó no trae código, y una llave que no es de nadie tampoco", async () => {
    const { lineas, ganadoras, dep, llaveDeLinea, servicio, id } = await sorteada();
    const perdedora = lineas.find((l) => !ganadoras.includes(l)) as string;
    const propio = await miEstadoDePersona(servicio, id, llaveDeLinea(perdedora), dep);
    expect(propio).toMatchObject({ anotada: true, gano: false });
    expect(propio).not.toHaveProperty("codigo");
    const ajena = await miEstadoDePersona(servicio, id, llaveDe(99), dep);
    expect(ajena).not.toHaveProperty("codigo");
  });
});
