import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar } from "./activar-mundo";
import { listHash } from "../protocol/canonical";
import {
  VENTANA_CAMPANA_MS,
  anotarPersona,
  crearTablasDeCampana,
  listaDeLaCampana,
  selloPublico,
  siYaEsta,
  type AltaDePersona,
} from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import {
  altaDe,
  campanaAbierta,
  firmarParaLaPrueba,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type PersonaDePrueba,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia cada prueba. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * Lo que el celular y la pantalla de otra compu necesitan saber del sorteo: el número y la ronda, solo con la lista sellada,
 * y si el token que presentan sigue siendo el de la sala. Y el reingreso, que con la clave nueva reemplaza el nombre cifrado.
 */
const AHORA = Date.UTC(2026, 10, 22, 15, 0, 0);
const RONDA = 40_000_000;
const SORTEO = "123456789";
const COMPROBANTE = "/verificar.html?x=1";
const TOKEN_AJENO = "A".repeat(22);

interface Estado {
  fase: string;
  sorteo?: string;
  ronda?: number;
  tuya?: boolean;
}

describe("el número del sorteo, la ronda y si el token es el vigente", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let personas: PersonaDePrueba[];

  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });
  const estado = async (extra: { token?: string; ruta?: string } = {}): Promise<{ r: Response; c: Estado & Record<string, unknown> }> => {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado${extra.ruta ?? ""}`, {
      cabeceras: extra.token === undefined ? {} : { Authorization: `Bearer ${extra.token}` },
    });
    return { r, c: (await r.json()) as Estado & Record<string, unknown> };
  };
  const yo = async (p: PersonaDePrueba): Promise<Record<string, unknown>> => {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/yo`, { cuerpo: { cuenta: p.cuenta, llave: p.llave } });
    return (await r.json()) as Record<string, unknown>;
  };
  const poner = (fase: string): Promise<Response> =>
    mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase }, cabeceras: auth() });

  /** Anota a tres, cierra y sella con la ronda de la prueba. Deja la lectura de la red lista para el resultado. */
  async function sellar(): Promise<void> {
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
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo: { fase: "sellada", sorteo: SORTEO },
      cabeceras: auth(),
    });
    expect(r.status).toBe(204);
    lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    sala = await campanaAbierta(mundo, AHORA);
    personas = [personaDePrueba(mundo, 1), personaDePrueba(mundo, 2), personaDePrueba(mundo, 3)];
    for (const p of personas) expect((await altaDe(mundo, sala.id, p)).status).toBe(201);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("antes de sellar no sale ni el número ni la ronda: la clave guarda ahí la hora del sorteo", async () => {
    for (const fase of ["abierta", "cerrada"]) {
      if (fase === "cerrada") expect((await poner("cerrada")).status).toBe(204);
      const { c } = await estado();
      expect(c.fase).toBe(fase);
      expect(c).not.toHaveProperty("sorteo");
      expect(c).not.toHaveProperty("ronda");
      const propio = await yo(personas[0] as PersonaDePrueba);
      expect(propio).not.toHaveProperty("sorteo");
      expect(propio).not.toHaveProperty("ronda");
      // Y la hora que la sala guarda ahí nunca se filtra con otro nombre.
      expect(JSON.stringify([c, propio])).not.toContain(String(AHORA + 7_200_000));
    }
  });

  it("sellada: el estado y la consulta propia traen el número del sorteo y la ronda del sello", async () => {
    expect((await poner("cerrada")).status).toBe(204);
    await sellar();
    const { c } = await estado();
    expect(c).toMatchObject({ fase: "sellada", sorteo: SORTEO, ronda: RONDA });
    expect(await yo(personas[1] as PersonaDePrueba)).toMatchObject({ fase: "sellada", anotada: true, sorteo: SORTEO, ronda: RONDA });
    // Quien no está anotada o no trae su llave ve lo mismo de público: el número y la ronda están en la cadena.
    const ajena = personaDePrueba(mundo, 99);
    expect(await yo(ajena)).toMatchObject({ fase: "sellada", anotada: false, sorteo: SORTEO, ronda: RONDA });
    const conOtraLlave = await mundo.pedir(`/v1/sala/${sala.id}/campana/yo`, {
      cuerpo: { cuenta: personas[0]?.cuenta, llave: "otra".padEnd(22, "z") },
    });
    expect(await conOtraLlave.json()).toMatchObject({ anotada: false, sorteo: SORTEO, ronda: RONDA });
  });

  it("sorteada: siguen estando, iguales a lo leído de la red", async () => {
    expect((await poner("cerrada")).status).toBe(204);
    await sellar();
    const guardado = await mundo.pedir(`/v1/sala/${sala.id}/campana/resultado`, {
      metodo: "PUT",
      cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE },
      cabeceras: auth(),
    });
    expect(guardado.status).toBe(204);
    const { c } = await estado();
    expect(c).toMatchObject({ fase: "sorteada", sorteo: SORTEO, ronda: RONDA });
    expect(await yo(personas[0] as PersonaDePrueba)).toMatchObject({ fase: "sorteada", sorteo: SORTEO, ronda: RONDA });
  });

  it("una sala sellada antes de esta versión trae el número y no la ronda, y el celular hace lo de siempre", async () => {
    expect((await poner("cerrada")).status).toBe(204);
    await sellar();
    mundo.ejecutar(`sala:${sala.id}`, "DELETE FROM sala WHERE k = 'ronda_sello'");
    const { c } = await estado();
    expect(c).toMatchObject({ fase: "sellada", sorteo: SORTEO });
    expect(c).not.toHaveProperty("ronda");
    const propio = await yo(personas[0] as PersonaDePrueba);
    expect(propio).toMatchObject({ sorteo: SORTEO });
    expect(propio).not.toHaveProperty("ronda");
  });

  it("la ronda se escribe junto con el sello, y una clave rota no se manda", async () => {
    expect((await poner("cerrada")).status).toBe(204);
    await sellar();
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'ronda_sello'")).toEqual([{ v: String(RONDA) }]);
    mundo.ejecutar(`sala:${sala.id}`, "UPDATE sala SET v = 'no es un número' WHERE k = 'ronda_sello'");
    const { c } = await estado();
    expect(c).toMatchObject({ sorteo: SORTEO });
    expect(c).not.toHaveProperty("ronda");
  });

  it("tuya: verdadera con el token de la sala, falsa con uno que no lo es, y ausente sin token", async () => {
    expect((await estado({ token: sala.token })).c.tuya).toBe(true);
    expect((await estado({ token: TOKEN_AJENO })).c.tuya).toBe(false);
    expect((await estado({ token: "no tiene forma de token" })).c.tuya).toBe(false);
    expect((await estado()).c).not.toHaveProperty("tuya");
  });

  it("el estado de quien presenta el token no deja de traer lo público", async () => {
    expect((await poner("cerrada")).status).toBe(204);
    await sellar();
    const { c } = await estado({ token: sala.token });
    expect(c).toMatchObject({ fase: "sellada", tuya: true, sorteo: SORTEO, ronda: RONDA });
  });
});

describe("el reingreso reemplaza el nombre cifrado", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let anotada: PersonaDePrueba;
  const nombre = (letra: string): string => letra.repeat(60);

  const equipos = async (): Promise<{ n: number; cuenta: string; d: string; v: number }[]> => {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/equipos?desde=0`, { cabeceras: { Authorization: `Bearer ${sala.token}` } });
    return (await r.json()) as { n: number; cuenta: string; d: string; v: number }[];
  };
  const reingresar = (n: number, d: string, persona = anotada): Promise<Response> =>
    altaDe(mundo, sala.id, persona, { cuerpo: { llave: `celular${n}`.padEnd(22, "x"), d } });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    sala = await campanaAbierta(mundo, AHORA);
    anotada = personaDePrueba(mundo, 1);
    expect((await altaDe(mundo, sala.id, anotada, { cuerpo: { d: nombre("A") } })).status).toBe(201);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("con la misma ficha dentro del minuto, la fila pasa al nombre nuevo y sube su versión", async () => {
    const [antes] = await equipos();
    expect(antes?.d).toBe(nombre("A"));
    const r = await reingresar(2, nombre("B"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cuenta: anotada.cuenta, ya: true });
    const [despues] = await equipos();
    expect(despues?.d).toBe(nombre("B"));
    expect(despues?.n).toBe(antes?.n);
    expect(despues?.v).toBeGreaterThan(antes?.v ?? 0);
  });

  it("con otra sesión de la misma persona (verificada de nuevo) también reemplaza el nombre", async () => {
    const otraSesion: PersonaDePrueba = { ...anotada, token: `tok_otro_celular_${"z".repeat(24)}` };
    mundo.proveedor.sesiones.set(otraSesion.token, { usuario: anotada.usuario, contenido: { wallet: anotada.cuenta } });
    const r = await reingresar(2, nombre("C"), otraSesion);
    expect(r.status).toBe(200);
    expect((await equipos())[0]?.d).toBe(nombre("C"));
    // La sesión se verificó con el proveedor: este camino no usa la memoria de fichas.
    expect(mundo.proveedor.llamadas["/v3/tokens/verify"]).toBe(2);
  });

  it("le avisa a la pantalla presentada, con el nombre nuevo y la versión nueva", async () => {
    const pantalla = mundo.agregarSocket(sala.id, true);
    await reingresar(2, nombre("B"));
    const mensajes = pantalla.mensajes.map((m) => JSON.parse(m) as Record<string, unknown>);
    expect(mensajes).toHaveLength(1);
    const [fila] = await equipos();
    expect(mensajes[0]).toEqual({ t: "equipo", v: fila?.v, n: fila?.n, cuenta: anotada.cuenta, d: nombre("B"), estado: "aceptado" });
    // Volver con el mismo nombre no mueve nada en la pantalla.
    pantalla.mensajes.length = 0;
    await reingresar(3, nombre("B"));
    expect(pantalla.mensajes).toEqual([]);
  });

  it("no suma gente ni cambia a otras personas, y la cuenta y el total quedan igual", async () => {
    const otra = personaDePrueba(mundo, 2);
    expect((await altaDe(mundo, sala.id, otra, { cuerpo: { d: nombre("D") } })).status).toBe(201);
    await reingresar(2, nombre("B"));
    const filas = await equipos();
    expect(filas.map((f) => f.d).sort()).toEqual([nombre("B"), nombre("D")]);
    expect(filas).toHaveLength(2);
  });

  it("respeta el tope por hora: pasado el tope no cambia ni la llave ni el nombre", async () => {
    for (let n = 2; n <= 7; n++) expect((await reingresar(n, nombre("B"))).status).toBe(200);
    const antes = await equipos();
    const r = await reingresar(50, nombre("E"));
    expect(r.status).toBe(429);
    expect(await equipos()).toEqual(antes);
  });

  it("después de cerrar la lista no cambia nada: ese camino ni siquiera se abre", async () => {
    const cerrar = await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo: { fase: "cerrada" },
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
    expect(cerrar.status).toBe(204);
    const antes = await equipos();
    const r = await reingresar(2, nombre("B"));
    expect(r.status).toBe(409);
    expect(await equipos()).toEqual(antes);
  });

  it("el nombre no puede traer la clave: el alta con nombre mal formado se rechaza antes de tocar la fila", async () => {
    const antes = await equipos();
    const r = await reingresar(2, "esto no es base64 url!!");
    expect(r.status).toBe(400);
    expect(await equipos()).toEqual(antes);
  });
});

describe("el reingreso en una fase que no acepta altas (la regla pura)", () => {
  const T0 = 1_000 * VENTANA_CAMPANA_MS;
  const huella = (s: string): string => createHash("sha256").update(s).digest("hex");

  function sala(): Ejecutar {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
    crearTablasDeCampana(sql);
    sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?), ('premios', '1')", String(T0 + 3_600_000));
    return sql;
  }

  const alta: AltaDePersona = {
    persona: huella("persona-1"),
    cuenta: `G${"B".repeat(55)}`,
    d: "nombre-viejo",
    llave: huella("llave-1"),
    grupo: "conexion-1",
    ahora: T0,
    via: "google",
  };
  const fila = (sql: Ejecutar): { d: string; llave: string; v: number } =>
    sql<{ d: string; llave: string; v: number }>("SELECT d, llave, v FROM equipos")[0] as { d: string; llave: string; v: number };

  it("abierta: reemplaza el nombre y cuenta el cambio para la pantalla", () => {
    const sql = sala();
    expect(anotarPersona(sql, alta, () => true).ok).toBe(true);
    const r = siYaEsta(sql, { persona: alta.persona, llave: huella("llave-2"), grupo: alta.grupo, ahora: T0 + 1, d: "nombre-nuevo" });
    expect(r).toMatchObject({ ok: true, cuenta: alta.cuenta, nombre: { d: "nombre-nuevo", estado: "aceptado" } });
    expect(fila(sql).d).toBe("nombre-nuevo");
  });

  it("cerrada o sellada: cambia la llave de su celular, como siempre, pero deja el nombre", () => {
    for (const fase of ["cerrada", "sellada", "sorteada"]) {
      const sql = sala();
      expect(anotarPersona(sql, alta, () => true).ok).toBe(true);
      sql("UPDATE sala SET v = ? WHERE k = 'fase'", fase);
      const antes = fila(sql);
      const r = siYaEsta(sql, { persona: alta.persona, llave: huella("llave-2"), grupo: alta.grupo, ahora: T0 + 1, d: "nombre-nuevo" });
      expect(r).toEqual({ ok: true, cuenta: alta.cuenta });
      const despues = fila(sql);
      expect(despues.d).toBe(antes.d);
      expect(despues.llave).toBe(huella("llave-2"));
    }
  });

  it("sin nombre en el pedido, el reingreso es el de antes: solo la llave", () => {
    const sql = sala();
    expect(anotarPersona(sql, alta, () => true).ok).toBe(true);
    const r = siYaEsta(sql, { persona: alta.persona, llave: huella("llave-2"), grupo: alta.grupo, ahora: T0 + 1 });
    expect(r).toEqual({ ok: true, cuenta: alta.cuenta });
    expect(fila(sql).d).toBe("nombre-viejo");
  });
});

describe("selloPublico, la regla pura", () => {
  function sala(valores: Record<string, string>): Ejecutar {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
    crearTablasDeCampana(sql);
    for (const [k, v] of Object.entries(valores)) sql("INSERT INTO sala (k, v) VALUES (?, ?)", k, v);
    return sql;
  }

  it("en lista, abierta y cerrada no dice nada, aunque la clave guarde la hora", () => {
    const sql = sala({ sorteo: "1795000000000", ronda_sello: "55" });
    for (const fase of ["lista", "abierta", "cerrada"] as const) expect(selloPublico(sql, fase)).toEqual({});
  });

  it("en sellada y sorteada dice el número y la ronda", () => {
    const sql = sala({ sorteo: "77", ronda_sello: "55" });
    for (const fase of ["sellada", "sorteada"] as const) expect(selloPublico(sql, fase)).toEqual({ sorteo: "77", ronda: 55 });
  });

  it("descarta lo que no tiene forma: un número con letras, una ronda en cero o fraccionaria", () => {
    expect(selloPublico(sala({ sorteo: "7x" }), "sellada")).toEqual({});
    expect(selloPublico(sala({ sorteo: "7", ronda_sello: "0" }), "sellada")).toEqual({ sorteo: "7" });
    expect(selloPublico(sala({ sorteo: "7", ronda_sello: "1.5" }), "sellada")).toEqual({ sorteo: "7" });
    expect(selloPublico(sala({ sorteo: "7", ronda_sello: "9007199254740993" }), "sellada")).toEqual({ sorteo: "7" });
  });
});

describe("tuya cuando otra compu toma la campaña", () => {
  const huellaDe = (token: string): string => createHash("sha256").update(token).digest("hex");
  const TOKEN_B = "B".repeat(22);

  it("el token viejo pasa a tuya falso y el nuevo a verdadero, desde la toma", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HORA_DE_LA_PRUEBA);
    const m = await montarMundoDeActivar();
    try {
      const r = await m.mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana()) });
      expect(r.status).toBe(201);
      const sala = (await r.json()) as { id: string; token: string };
      const leer = async (token: string): Promise<unknown> =>
        ((await (await m.mundo.pedir(`/v1/sala/${sala.id}/campana/estado`, { cabeceras: { Authorization: `Bearer ${token}` } })).json()) as Estado).tuya;
      expect(await leer(sala.token)).toBe(true);
      expect((await m.mundo.sala(sala.id).cambiarToken(m.organizadora.cuenta, huellaDe(TOKEN_B), 1)).ok).toBe(true);
      expect(await leer(sala.token)).toBe(false);
      expect(await leer(TOKEN_B)).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
