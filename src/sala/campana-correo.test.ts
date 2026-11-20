import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import {
  VIDA_DE_RESERVA_DE_AVISO_MS,
  cerrarAvisoPorCorreo,
  crearTablasDeCampana,
  listaDeLaCampana,
  reservarAvisosPorCorreo,
} from "../../workers/sala/src/campana";
import { TOPE_POR_CUENTA_MS } from "../../workers/sala/src/correo";
import type { EnlaceDeCorreo } from "../../workers/sala/src/correo";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type PersonaDePrueba,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia cada prueba. El resto de la lectura de la red no se usa acá. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * El aviso por correo a quien gana, con el Worker entero en Node: el proveedor de cuentas, el enlace de envío y la lectura de
 * la red son de mentira. El correo y el nombre de la persona se buscan solos y no tienen que quedar en ningún lado.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
/** Una ronda que sale mucho después de AHORA, para que el sello se acepte. */
const RONDA = 40_000_000;
const SORTEO = "7";
const COMPROBANTE = "/verificar.html?x=1";
const CORREO_ANA = "ana@example.org";
const CORREO_NORA = "nora@example.org";
const CORREO_BETO = "beto@example.org";

interface Mensaje {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

describe("el aviso por correo a quien gana", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let personas: PersonaDePrueba[];
  /** Las ganadoras (la tercera y la primera de la lista ordenada) y la que no ganó. */
  let ganadoras: PersonaDePrueba[];
  let perdedora: PersonaDePrueba;
  let enviados: Mensaje[];
  let enlace: EnlaceDeCorreo;
  /** Todo lo que el Worker devolvió, para buscar ahí lo que no tiene que estar. */
  let devuelto: string[];
  let consola: { mock: { calls: unknown[][] } }[];

  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });

  /** Pide y junta el cuerpo de lo que contestó. */
  async function pedir(...args: Parameters<MundoDeSala["pedir"]>): Promise<Response> {
    const r = await mundo.pedir(...args);
    devuelto.push(await r.clone().text());
    return r;
  }

  /** Una fila del proveedor, como la mide la búsqueda de usuarios. */
  function fila(p: PersonaDePrueba, correo: string, nombre: string): Record<string, unknown> {
    return { id: p.usuario, first_name: nombre, last_name: "Quispe", email: correo, wallet_public_key: p.cuenta, providers: ["GOOGLE"] };
  }

  /** Anota a tres personas, cierra, sella y deja la lectura de la red lista con dos ganadoras. */
  async function dejarListoParaElResultado(desde: number = 1): Promise<void> {
    personas = [personaDePrueba(mundo, desde), personaDePrueba(mundo, desde + 1), personaDePrueba(mundo, desde + 2)];
    for (const p of personas) expect((await altaDe(mundo, sala.id, p)).status).toBe(201);
    const cerrada = await pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth() });
    expect(cerrada.status).toBe(204);
    const orden = listaDeLaCampana(personas.map((p) => p.cuenta));
    const sello = {
      listHash: Buffer.from(listHash(orden)).toString("hex"),
      count: orden.length,
      numWinners: 2,
      sorteado: false,
      organizador: null,
      ronda: RONDA,
    };
    lectura.valor = { sello, ganadores: null };
    const sellada = await pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo: { fase: "sellada", sorteo: SORTEO },
      cabeceras: auth(),
    });
    expect(sellada.status).toBe(204);
    // Los índices de la lista ordenada: la tercera cuenta gana primero y la primera, segunda.
    lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
    const porCuenta = new Map(personas.map((p) => [p.cuenta, p]));
    ganadoras = [orden[2], orden[0]].map((cuenta) => porCuenta.get(cuenta ?? "") as PersonaDePrueba);
    perdedora = porCuenta.get(orden[1] ?? "") as PersonaDePrueba;
    const [primera, segunda] = ganadoras as [PersonaDePrueba, PersonaDePrueba];
    mundo.proveedor.usuarios.set(primera.cuenta, [fila(primera, CORREO_ANA, "Ana")]);
    mundo.proveedor.usuarios.set(segunda.cuenta, [fila(segunda, CORREO_NORA, "Nora")]);
    mundo.proveedor.usuarios.set(perdedora.cuenta, [fila(perdedora, CORREO_BETO, "Beto")]);
    mundo.proveedor.busquedas.length = 0;
  }

  const guardarResultado = (comprobante: string = COMPROBANTE): Promise<Response> =>
    pedir(`/v1/sala/${sala.id}/campana/resultado`, { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante }, cabeceras: auth() });

  /** Prende el correo: el interruptor ya viene en la variable, el enlace se instala en el entorno del Worker. */
  function conEnlace(): void {
    mundo.env.CORREO = enlace;
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    enviados = [];
    devuelto = [];
    enlace = { send: vi.fn(async (m: Mensaje) => (enviados.push(m), { messageId: "m1" })) };
    consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    mundo = await montarMundo({ CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org" });
    conEnlace();
    sala = await campanaAbierta(mundo, AHORA, { empresa: { nombre: "Empresa de ejemplo" } });
    await dejarListoParaElResultado();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Lo que el Worker escribió en el registro y devolvió, junto. */
  const todoLoVisible = (): string => JSON.stringify([devuelto, ...consola.map((c) => c.mock.calls)]);

  it("con el interruptor apagado no se busca ni se manda nada", async () => {
    mundo.env.CORREO_GANADORAS = "0";
    expect((await guardarResultado()).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(mundo.proveedor.busquedas).toEqual([]);
    expect(enlace.send).not.toHaveBeenCalled();
  });

  it("sin el interruptor puesto, tampoco", async () => {
    delete mundo.env.CORREO_GANADORAS;
    expect((await guardarResultado()).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(mundo.proveedor.busquedas).toEqual([]);
    expect(enlace.send).not.toHaveBeenCalled();
  });

  it("sin el enlace de envío, o sin remitente, guarda el resultado y no falla", async () => {
    delete mundo.env.CORREO;
    expect((await guardarResultado()).status).toBe(204);
    mundo.env.CORREO = enlace;
    delete mundo.env.CORREO_DE;
    expect((await guardarResultado("/verificar.html?x=2")).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(mundo.proveedor.busquedas).toEqual([]);
    expect(enlace.send).not.toHaveBeenCalled();
    expect((await pedir(`/v1/sala/${sala.id}/campana/resultado`)).status).toBe(200);
  });

  it("el estado público dice si el correo está prendido", async () => {
    const leer = async (): Promise<unknown> => (await (await pedir(`/v1/sala/${sala.id}/campana/estado`)).json() as { correo: unknown }).correo;
    expect(await leer()).toBe(true);
    mundo.env.CORREO_GANADORAS = "0";
    expect(await leer()).toBe(false);
    mundo.env.CORREO_GANADORAS = "1";
    delete mundo.env.CORREO;
    expect(await leer()).toBe(false);
    mundo.env.CORREO = enlace;
    delete mundo.env.CORREO_DE;
    expect(await leer()).toBe(false);
  });

  it("con el interruptor prendido manda un correo a cada cuenta ganadora, y solo a ellas", async () => {
    expect((await guardarResultado()).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(enviados.map((m) => m.to)).toEqual([CORREO_ANA, CORREO_NORA]);
    expect(mundo.proveedor.busquedas).toEqual(ganadoras.map((p) => p.cuenta));
    const [ana] = enviados as [Mensaje];
    expect(ana.from).toEqual({ email: "sorteos@example.org", name: "Tinkazo" });
    expect(ana.replyTo).toBe("hola@tinkazo.app");
    expect(ana.subject).toBe("Ganaste el sorteo de Empresa de ejemplo");
    expect(ana.text).toContain("Hola Ana.");
    expect(ana.text).toContain("Ganaste 40 dólares digitales en el sorteo de Empresa de ejemplo.");
    expect(enviados[1]?.text).toContain("Ganaste 20 dólares digitales");
    expect(ana.html).toContain("Empresa de ejemplo");
  });

  it("en una campaña de prueba el correo lleva a recibir en Prueba, sin la sala, el pase ni la clave", async () => {
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    const [ana] = enviados as [Mensaje];
    expect(ana.text).toContain("\nhttps://tinkazo.app/?red=prueba&premio=1\n");
    expect(ana.html).toContain('href="https://tinkazo.app/?red=prueba&amp;premio=1"');
    const todo = `${ana.text}${ana.html}`;
    expect(todo).not.toContain("participar.html");
    expect(todo).not.toContain(sala.id);
    expect(todo).not.toContain(sala.token);
    expect(todo).not.toMatch(/[?&#](p|k|llave|token|pase)=/u);
  });

  it("en una campaña de la red principal el correo lleva a recibir en Oficial", async () => {
    sala = await campanaAbierta(mundo, AHORA, { red: "mainnet", evento: "otra-feria", empresa: { nombre: "Empresa de ejemplo" } });
    await dejarListoParaElResultado(11);
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    const [ana] = enviados as [Mensaje];
    expect(ana.text).toContain("\nhttps://tinkazo.app/?red=oficial&premio=1\n");
    expect(ana.html.split('href="https://tinkazo.app/?red=oficial&amp;premio=1"').length - 1).toBe(2);
    expect(`${ana.text}${ana.html}`).not.toContain(sala.id);
  });

  it("un resultado repetido no manda otra vez", async () => {
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    expect((await guardarResultado("/verificar.html?x=2")).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(2);
    expect(mundo.proveedor.busquedas).toHaveLength(2);
  });

  it("dos pedidos a la vez no mandan dos veces", async () => {
    const respuestas = await Promise.all([guardarResultado(), guardarResultado("/verificar.html?x=2"), guardarResultado("/verificar.html?x=3")]);
    expect(respuestas.map((r) => r.status)).toEqual([204, 204, 204]);
    await mundo.esperarSegundoPlano();
    expect(enviados.map((m) => m.to).sort()).toEqual([CORREO_ANA, CORREO_NORA]);
    expect(mundo.proveedor.busquedas).toHaveLength(2);
  });

  it("una cuenta que no ganó nunca recibe ni se le busca el correo", async () => {
    await guardarResultado();
    await guardarResultado("/verificar.html?x=2");
    await mundo.esperarSegundoPlano();
    expect(mundo.proveedor.busquedas).not.toContain(perdedora.cuenta);
    expect(enviados.map((m) => m.to)).not.toContain(CORREO_BETO);
  });

  it("con el token malo el resultado no se guarda y no sale ningún correo", async () => {
    const r = await pedir(`/v1/sala/${sala.id}/campana/resultado`, {
      metodo: "PUT",
      cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE },
      cabeceras: { Authorization: `Bearer ${"A".repeat(22)}` },
    });
    expect(r.status).toBe(403);
    await mundo.esperarSegundoPlano();
    expect(mundo.proveedor.busquedas).toEqual([]);
    expect(enlace.send).not.toHaveBeenCalled();
  });

  it("la respuesta no espera al correo", async () => {
    let soltar: () => void = () => {};
    const detenido = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    mundo.env.CORREO = { send: vi.fn(async () => (await detenido, { messageId: "m" })) };
    const r = await guardarResultado();
    expect(r.status).toBe(204);
    expect((await pedir(`/v1/sala/${sala.id}/campana/resultado`)).status).toBe(200);
    soltar();
    await mundo.esperarSegundoPlano();
  });

  it("si la búsqueda del proveedor falla, el resultado queda guardado y no sale nada", async () => {
    mundo.proveedor.caido = true;
    expect((await guardarResultado()).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(enlace.send).not.toHaveBeenCalled();
    const r = await pedir(`/v1/sala/${sala.id}/campana/resultado`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ganadoras: string[] }).ganadoras).toEqual(ganadoras.map((p) => p.cuenta));
  });

  it("si el envío falla, el resultado queda guardado y no se reintenta", async () => {
    const error = Object.assign(new Error(`no se pudo mandar a ${CORREO_ANA}`), { code: "E_DAILY_LIMIT_EXCEEDED" });
    const send = vi.fn(async () => Promise.reject(error));
    mundo.env.CORREO = { send };
    expect((await guardarResultado()).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect((await guardarResultado("/verificar.html?x=2")).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await pedir(`/v1/sala/${sala.id}/campana/resultado`)).status).toBe(200);
    expect(JSON.stringify(consola.map((c) => c.mock.calls))).toContain("E_DAILY_LIMIT_EXCEEDED");
  });

  it("encuentra a quien tiene su billetera de Stellar en la lista y otra cadena, o ninguna, como principal", async () => {
    const [primera, segunda] = ganadoras as [PersonaDePrueba, PersonaDePrueba];
    const stellar = (p: PersonaDePrueba): unknown[] => [
      { chain: "SOLANA", public_key: "5UfDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { chain: "STELLAR", network: "mainnet", public_key: p.cuenta },
    ];
    mundo.proveedor.usuarios.set(primera.cuenta, [
      { ...fila(primera, CORREO_ANA, "Ana"), wallet_public_key: "0x1111111111111111111111111111111111111111", wallets: stellar(primera) },
    ]);
    mundo.proveedor.usuarios.set(segunda.cuenta, [
      { ...fila(segunda, CORREO_NORA, "Nora"), wallet_public_key: null, wallets: stellar(segunda) },
    ]);
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    expect(enviados.map((m) => m.to)).toEqual([CORREO_ANA, CORREO_NORA]);
  });

  it("una cuenta que solo aparece como billetera de otra cadena no recibe nada", async () => {
    const [primera, segunda] = ganadoras as [PersonaDePrueba, PersonaDePrueba];
    mundo.proveedor.usuarios.set(primera.cuenta, [
      { ...fila(primera, CORREO_ANA, "Ana"), wallet_public_key: null, wallets: [{ chain: "POLYGON", public_key: primera.cuenta }] },
    ]);
    mundo.proveedor.usuarios.set(segunda.cuenta, []);
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    expect(enviados).toEqual([]);
  });

  it("un envío que se cuelga no frena a la otra cuenta ni se repite al llegar el resultado otra vez", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(AHORA);
    const colgado = new Promise<never>(() => {});
    const send = vi.fn(async (m: Mensaje) => {
      if (m.to === CORREO_ANA) return colgado;
      enviados.push(m);
      return { messageId: "m2" };
    });
    mundo.env.CORREO = { send };
    expect((await guardarResultado()).status).toBe(204);
    await vi.advanceTimersByTimeAsync(TOPE_POR_CUENTA_MS + 1_000);
    await mundo.esperarSegundoPlano();
    expect(enviados.map((m) => m.to)).toEqual([CORREO_NORA]);
    vi.setSystemTime(AHORA + 10 * VIDA_DE_RESERVA_DE_AVISO_MS);
    expect((await guardarResultado("/verificar.html?x=2")).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(consola.map((c) => c.mock.calls))).toContain('\\"codigo\\":\\"tiempo\\"');
  });

  it("si una cuenta no tiene correo, avisa a la otra", async () => {
    const [primera] = ganadoras as [PersonaDePrueba];
    mundo.proveedor.usuarios.set(primera.cuenta, [{ ...fila(primera, CORREO_ANA, "Ana"), email: null }]);
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    expect(enviados.map((m) => m.to)).toEqual([CORREO_NORA]);
  });

  it("si la búsqueda trae dos filas de la misma cuenta, no manda a ninguna de las dos", async () => {
    const [primera] = ganadoras as [PersonaDePrueba];
    mundo.proveedor.usuarios.set(primera.cuenta, [fila(primera, CORREO_ANA, "Ana"), fila(primera, CORREO_BETO, "Beto")]);
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    expect(enviados.map((m) => m.to)).toEqual([CORREO_NORA]);
  });

  it("el correo y el nombre no están en ninguna respuesta ni en el registro, con envío bueno o malo", async () => {
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    mundo.env.CORREO = { send: async () => Promise.reject(Object.assign(new Error(`falló para ${CORREO_ANA} ${CORREO_NORA}`), { code: "E_X" })) };
    await guardarResultado("/verificar.html?x=2");
    await pedir(`/v1/sala/${sala.id}/campana/estado`, { cabeceras: auth() });
    await pedir(`/v1/sala/${sala.id}/campana/resultado`);
    await pedir(`/v1/sala/${sala.id}/campana`);
    await pedir(`/v1/sala/${sala.id}/campana/yo`, { cuerpo: { cuenta: ganadoras[0]?.cuenta, llave: ganadoras[0]?.llave } });
    const todo = todoLoVisible();
    for (const secreto of [CORREO_ANA, CORREO_NORA, CORREO_BETO, "example.org", "Quispe", "ana@", "Nora", "Beto"]) {
      expect(todo, secreto).not.toContain(secreto);
    }
    // El nombre "Ana" es parte de palabras comunes: se busca como nombre propio entero.
    expect(todo).not.toMatch(/\bAna\b/u);
  });

  it("el registro solo lleva códigos fijos y conteos", async () => {
    await guardarResultado();
    await mundo.esperarSegundoPlano();
    type Evento = { evento: string; datos: Record<string, unknown> };
    const eventos = (consola[0]?.mock.calls ?? []).map((c: unknown[]) => JSON.parse(String(c[0])) as Evento);
    const delCorreo = eventos.filter((e) => e.evento.startsWith("correo-"));
    expect(delCorreo).toEqual([{ evento: "correo-fin", datos: { cuentas: 2, enviados: 2, intentadas: 2 } }]);
  });
});

describe("reservar las cuentas a las que se les avisa", () => {
  const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
  const cuenta = (i: number): string => `G${String(i).padStart(55, "B")}`;

  function sala(fase: string, premios: number, ganadoras: string[]): Ejecutar {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
    crearTablasDeCampana(sql);
    sql(
      "INSERT INTO sala (k, v) VALUES ('fase', ?), ('premios', ?), ('ganadoras', ?)",
      fase,
      String(premios),
      JSON.stringify(ganadoras),
    );
    return sql;
  }

  it("no pasa de la cantidad de premios firmada", () => {
    const sql = sala("sorteada", 2, [cuenta(1), cuenta(2), cuenta(3)]);
    expect(reservarAvisosPorCorreo(sql, AHORA)).toEqual([
      { cuenta: cuenta(1), puesto: 0 },
      { cuenta: cuenta(2), puesto: 1 },
    ]);
  });

  it("reserva una sola vez cada cuenta", () => {
    const sql = sala("sorteada", 2, [cuenta(1), cuenta(2)]);
    expect(reservarAvisosPorCorreo(sql, AHORA)).toHaveLength(2);
    expect(reservarAvisosPorCorreo(sql, AHORA)).toEqual([]);
  });

  it("una reserva que sigue sin terminar vuelve a reservarse solo pasado su tiempo", () => {
    const sql = sala("sorteada", 2, [cuenta(1), cuenta(2)]);
    reservarAvisosPorCorreo(sql, AHORA);
    expect(reservarAvisosPorCorreo(sql, AHORA + VIDA_DE_RESERVA_DE_AVISO_MS - 1)).toEqual([]);
    expect(reservarAvisosPorCorreo(sql, AHORA + VIDA_DE_RESERVA_DE_AVISO_MS)).toHaveLength(2);
  });

  it("una cuenta cuyo aviso ya se intentó no vuelve a reservarse nunca", () => {
    const sql = sala("sorteada", 2, [cuenta(1), cuenta(2)]);
    reservarAvisosPorCorreo(sql, AHORA);
    cerrarAvisoPorCorreo(sql, cuenta(1));
    expect(reservarAvisosPorCorreo(sql, AHORA + 100 * VIDA_DE_RESERVA_DE_AVISO_MS)).toEqual([{ cuenta: cuenta(2), puesto: 1 }]);
  });

  it("cerrar no crea marcas: una cuenta que nunca se reservó sigue sin marca", () => {
    const sql = sala("sorteada", 1, [cuenta(1)]);
    cerrarAvisoPorCorreo(sql, cuenta(9));
    expect(sql("SELECT k FROM sala WHERE k LIKE 'correo:%'")).toEqual([]);
  });

  it("antes del resultado, o sin cantidad de premios, no reserva nada", () => {
    expect(reservarAvisosPorCorreo(sala("sellada", 2, [cuenta(1)]), AHORA)).toEqual([]);
    expect(reservarAvisosPorCorreo(sala("sorteada", 0, [cuenta(1)]), AHORA)).toEqual([]);
    expect(reservarAvisosPorCorreo(sala("sorteada", 2, []), AHORA)).toEqual([]);
  });

  it("lo único que guarda es la marca de cada cuenta", () => {
    const sql = sala("sorteada", 1, [cuenta(1)]);
    reservarAvisosPorCorreo(sql, AHORA);
    const marcas = sql<{ k: string; v: string }>("SELECT k, v FROM sala WHERE k LIKE 'correo:%'");
    expect(marcas).toEqual([{ k: `correo:${cuenta(1)}`, v: `r${AHORA}` }]);
    cerrarAvisoPorCorreo(sql, cuenta(1));
    expect(sql("SELECT k, v FROM sala WHERE k LIKE 'correo:%'")).toEqual([{ k: `correo:${cuenta(1)}`, v: "1" }]);
  });
});
