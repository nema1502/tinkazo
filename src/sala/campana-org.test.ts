import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { campanaDeEjemplo } from "../campana/ejemplo";
import {
  CLAVE_EVENTOS_ORG,
  CLAVE_INTENTOS_ORG,
  CLAVE_ORG,
  type MemoriaDeOrg,
  type SalaDeCampana,
  borrarOrg,
  borrarSalaVacia,
  crearCampanaEnSala,
  estadoConToken,
  guardarIntentoDeArchivo,
  guardarOrg,
  guardarTokenDeEvento,
  intentoDeArchivo,
  leerCampanaDeSala,
  leerOrg,
  olvidarIntentoDeArchivo,
  pedirPase,
  ponerFase,
  puedeMoverLaSala,
  quitarConMotivo,
  tokenDeEvento,
} from "./campana-org";

/**
 * El cliente de quien organiza contra un `fetch` de mentira: cada ruta, método, cabecera y cuerpo, cada respuesta de la
 * sala por su motivo y el corte por tiempo. Sin red ni reloj.
 */

const SERVICIO = "https://s.test";
const TOKEN = "T".repeat(22);
const CLAVE = "C".repeat(22);
const ARCHIVO = { texto: '{"v":1}', firma: "F".repeat(86) };
const AHORA = 1_800_000_000_000;

const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: TOKEN,
  clave: CLAVE,
  vence: AHORA + 86_400_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};
const OTRA: SalaDeCampana = { ...SALA, id: "ZyXw9876", evento: "evento-dos", red: "mainnet" };

interface Llamada {
  url: string;
  init: RequestInit;
}

/** Un `fetch` que anota cada llamada y contesta lo que la prueba diga. */
function conRespuesta(estado: number, cuerpo?: unknown): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status: estado });
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

const cabecera = (l: Llamada | undefined, nombre: string): string | undefined =>
  (l?.init.headers as Record<string, string> | undefined)?.[nombre];

function almacen(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("crear la campaña", () => {
  it("manda el archivo tal cual y arma la sala con una clave nueva", async () => {
    const x = conRespuesta(201, { id: "AbCd1234", token: TOKEN, vence: AHORA });
    const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet" }, { fetch: x.fetch }, SERVICIO);
    expect(x.llamadas[0]?.url).toBe("https://s.test/v1/campana");
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(x.llamadas[0]?.init.body))).toEqual(ARCHIVO);
    expect(cabecera(x.llamadas[0], "Authorization")).toBeUndefined();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sala).toMatchObject({ id: "AbCd1234", token: TOKEN, vence: AHORA, evento: "evento-uno", red: "testnet", servicio: SERVICIO });
    expect(r.sala.clave).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  });

  it("con el token de la sala anterior del evento lo manda en la cabecera", async () => {
    const x = conRespuesta(201, { id: "AbCd1234", token: TOKEN, vence: AHORA });
    await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet", anterior: "Z".repeat(22) }, { fetch: x.fetch }, SERVICIO);
    expect(cabecera(x.llamadas[0], "Authorization")).toBe(`Bearer ${"Z".repeat(22)}`);
  });

  it("con un intento lo manda en el cuerpo junto al archivo, y toma el token que contesta la sala", async () => {
    const x = conRespuesta(201, { id: "AbCd1234", token: TOKEN, vence: AHORA });
    const intento = "I".repeat(22);
    const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet", intento }, { fetch: x.fetch }, SERVICIO);
    expect(JSON.parse(String(x.llamadas[0]?.init.body))).toEqual({ ...ARCHIVO, intento });
    expect(r.ok && r.sala.token).toBe(TOKEN);
  });

  it("traduce cada error por su motivo y no por el estado", async () => {
    const casos: [number, unknown, string][] = [
      [403, { error: "origen" }, "origen"],
      [403, { error: "firma" }, "firma"],
      [409, { error: "vencida" }, "vencida"],
      [409, { error: "ya-existe" }, "ya-existe"],
      [400, { error: "forma" }, "forma"],
      [429, { error: "cupo-campanas" }, "cupo-campanas"],
      [503, { error: "sin-llave" }, "red"],
      [503, { error: "ocupado" }, "red"],
      [500, undefined, "red"],
      [201, { id: "AbCd1234", vence: AHORA }, "red"],
      [201, { id: "mal", token: TOKEN, vence: AHORA }, "red"],
    ];
    for (const [estado, cuerpo, motivo] of casos) {
      const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet" }, { fetch: conRespuesta(estado, cuerpo).fetch }, SERVICIO);
      expect(r, `${estado} ${JSON.stringify(cuerpo)}`).toEqual({ ok: false, motivo });
    }
  });

  it("un fetch que lanza es falta de conexión", async () => {
    const f = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet" }, { fetch: f }, SERVICIO);
    expect(r).toEqual({ ok: false, motivo: "red" });
  });

  it("una llamada que nunca contesta da falta de conexión cuando se corta la espera", async () => {
    const corte = new AbortController();
    const colgado = ((_url: string, init: RequestInit) =>
      new Promise((_resolver, rechazar) => {
        init.signal?.addEventListener("abort", () => rechazar(new Error("cortada")));
      })) as unknown as typeof fetch;
    const dep = { fetch: colgado, senal: () => corte.signal };
    const pendiente = pedirPase(SALA, dep);
    corte.abort();
    expect(await pendiente).toBe("red");
  });

  it("cada llamada lleva una señal de corte propia", async () => {
    const x = conRespuesta(204);
    await ponerFase(SALA, "cerrada", null, { fetch: x.fetch });
    expect(x.llamadas[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("el pase", () => {
  it("va con el token en la cabecera y da el pase con su hora", async () => {
    const x = conRespuesta(200, { p: "AbCdEfGhIjKl", hasta: AHORA + 60_000 });
    const r = await pedirPase(SALA, { fetch: x.fetch });
    expect(x.llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/AbCd1234/campana/pase");
    expect(cabecera(x.llamadas[0], "Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(r).toEqual({ p: "AbCdEfGhIjKl", hasta: AHORA + 60_000 });
  });

  it("distingue la sala que no está, el token que ya no vale, el rechazo y la falta de conexión", async () => {
    expect(await pedirPase(SALA, { fetch: conRespuesta(404, { error: "no-existe" }).fetch })).toBe("no-existe");
    // Un 403 con el motivo token ya no es un rechazo común: la campaña la tomó otra compu (pantalla Tu campaña sigue en otra compu).
    expect(await pedirPase(SALA, { fetch: conRespuesta(403, { error: "token" }).fetch })).toBe("token");
    expect(await pedirPase(SALA, { fetch: conRespuesta(403, { error: "origen" }).fetch })).toBe("rechazo");
    expect(await pedirPase(SALA, { fetch: conRespuesta(200, { p: "corto", hasta: AHORA }).fetch })).toBe("red");
    expect(await pedirPase(SALA, { fetch: conRespuesta(502).fetch })).toBe("red");
  });
});

describe("la fase", () => {
  it("sin hora de cierre no manda el campo", async () => {
    const x = conRespuesta(204);
    expect(await ponerFase(SALA, "abierta", null, { fetch: x.fetch })).toBe(true);
    expect(x.llamadas[0]?.init.method).toBe("PUT");
    expect(x.llamadas[0]?.init.body).toBe('{"fase":"abierta"}');
    expect(cabecera(x.llamadas[0], "Content-Type")).toBe("application/json");
  });

  it("con hora de cierre la manda", async () => {
    const x = conRespuesta(204);
    await ponerFase(SALA, "abierta", AHORA + 900_000, { fetch: x.fetch });
    expect(x.llamadas[0]?.init.body).toBe(`{"fase":"abierta","cierraMs":${AHORA + 900_000}}`);
  });

  it("una transición que no vale da rechazo y una hora que no vale da forma", async () => {
    expect(await ponerFase(SALA, "cerrada", null, { fetch: conRespuesta(409, { error: "transicion" }).fetch })).toBe("rechazo");
    expect(await ponerFase(SALA, "abierta", AHORA, { fetch: conRespuesta(400, { error: "forma" }).fetch })).toBe("forma");
    expect(await ponerFase(SALA, "abierta", null, { fetch: conRespuesta(404, { error: "no-existe" }).fetch })).toBe("no-existe");
  });
});

describe("quitar", () => {
  it("da por hecho a quien ya no estaba", async () => {
    const x = conRespuesta(204);
    expect(await quitarConMotivo(SALA, 3, "pidio", { fetch: x.fetch })).toBe(true);
    expect(x.llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/AbCd1234/campana/quitar");
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(x.llamadas[0]?.init.body).toBe('{"n":3,"motivo":"pidio"}');
    expect(await quitarConMotivo(SALA, 3, "pidio", { fetch: conRespuesta(404, { error: "no-esta" }).fetch })).toBe(true);
  });

  it("la sala que no está y el rechazo de fase se distinguen", async () => {
    expect(await quitarConMotivo(SALA, 3, "otro", { fetch: conRespuesta(404, { error: "no-existe" }).fetch })).toBe("no-existe");
    expect(await quitarConMotivo(SALA, 3, "otro", { fetch: conRespuesta(409, { error: "fase" }).fetch })).toBe("rechazo");
    expect(await quitarConMotivo(SALA, 3, "otro", { fetch: conRespuesta(503).fetch })).toBe("red");
  });
});

describe("el estado y la campaña de la sala", () => {
  it("el estado con token devuelve fase, total y cierre", async () => {
    const x = conRespuesta(200, { fase: "abierta", total: 7, cierraMs: AHORA, pase: "sin", quitadas: {} });
    expect(await estadoConToken(SALA, { fetch: x.fetch })).toEqual({ fase: "abierta", total: 7, cierraMs: AHORA });
    expect(x.llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/AbCd1234/campana/estado");
    expect(cabecera(x.llamadas[0], "Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("una fase desconocida da falta de conexión", async () => {
    const x = conRespuesta(200, { fase: "rara", total: 7, cierraMs: AHORA });
    expect(await estadoConToken(SALA, { fetch: x.fetch })).toBe("red");
  });

  it("leer la campaña de la sala pasa por el lector del sitio", async () => {
    const ejemplo = campanaDeEjemplo(AHORA);
    const texto = JSON.stringify({
      ...ejemplo,
      premios: ejemplo.premios.map((p) => p.toString()),
      abre_ms: ejemplo.abreMs,
      cierra_ms: ejemplo.cierraMs,
      sorteo_ms: ejemplo.sorteoMs,
      recibir_hasta_ms: ejemplo.recibirHastaMs,
    });
    const r = await leerCampanaDeSala(SALA, { fetch: conRespuesta(200, { texto, firma: "F" }).fetch });
    expect(typeof r === "object" && r.empresa.nombre).toBe("Alcancía Andina");
    expect(await leerCampanaDeSala(SALA, { fetch: conRespuesta(200, { texto: "no es json", firma: "F" }).fetch })).toBe("rechazo");
    expect(await leerCampanaDeSala(SALA, { fetch: conRespuesta(404, { error: "no-existe" }).fetch })).toBe("no-existe");
  });

  it("borrar una sala vacía usa el token y da por hecho la que ya no está", async () => {
    const x = conRespuesta(204);
    expect(await borrarSalaVacia(SALA, { fetch: x.fetch })).toBe(true);
    expect(x.llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/AbCd1234");
    expect(x.llamadas[0]?.init.method).toBe("DELETE");
    expect(await borrarSalaVacia(SALA, { fetch: conRespuesta(404, { error: "no-existe" }).fetch })).toBe(true);
    expect(await borrarSalaVacia(SALA, { fetch: conRespuesta(403, { error: "token" }).fetch })).toBe(false);
  });
});

describe("lo que recuerda la compu", () => {
  let a: Storage;
  beforeEach(() => {
    a = almacen();
  });

  it("guarda, lee y borra", () => {
    const m: MemoriaDeOrg = { sala: SALA, fase: "abierta", mostradas: [2, 5], pendientes: [{ n: 4, motivo: "evento" }] };
    guardarOrg(a, m);
    expect(leerOrg(a, AHORA, "testnet", null)).toEqual(m);
    borrarOrg(a, "testnet");
    expect(leerOrg(a, AHORA, "testnet", null)).toBeNull();
    expect(a.getItem(CLAVE_ORG)).toBeNull();
  });

  it("sin almacén no hace nada y no lanza", () => {
    expect(() => guardarOrg(null, { sala: SALA, fase: "lista" })).not.toThrow();
    expect(() => borrarOrg(null, "testnet")).not.toThrow();
    expect(leerOrg(null, AHORA, "testnet", null)).toBeNull();
  });

  it("guarda una sala por red y borrar una no toca la otra", () => {
    guardarOrg(a, { sala: SALA, fase: "abierta" });
    guardarOrg(a, { sala: OTRA, fase: "cerrada" });
    expect(leerOrg(a, AHORA, "testnet", null)?.sala.id).toBe("AbCd1234");
    expect(leerOrg(a, AHORA, "mainnet", null)?.sala.id).toBe("ZyXw9876");
    borrarOrg(a, "testnet");
    expect(leerOrg(a, AHORA, "testnet", null)).toBeNull();
    expect(leerOrg(a, AHORA, "mainnet", null)?.fase).toBe("cerrada");
  });

  it("la memoria vencida se borra y la de la otra red queda", () => {
    guardarOrg(a, { sala: { ...SALA, vence: AHORA - 1 }, fase: "abierta" });
    guardarOrg(a, { sala: OTRA, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", null)).toBeNull();
    expect(JSON.parse(a.getItem(CLAVE_ORG) ?? "{}")).not.toHaveProperty("testnet");
    expect(leerOrg(a, AHORA, "mainnet", null)).not.toBeNull();
  });

  it("un JSON roto o una sala con campos que no valen dan nada", () => {
    a.setItem(CLAVE_ORG, "{no es json");
    expect(leerOrg(a, AHORA, "testnet", null)).toBeNull();
    guardarOrg(a, { sala: { ...SALA, token: "corto" }, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", null)).toBeNull();
    guardarOrg(a, { sala: { ...SALA, servicio: "https://otro.example.org" }, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", null)).toBeNull();
  });

  it("recuerda el token de cada evento, hasta cinco, y borrar la sala no lo borra", () => {
    guardarOrg(a, { sala: SALA, fase: "abierta" });
    guardarTokenDeEvento(a, { evento: SALA.evento, token: SALA.token });
    borrarOrg(a, "testnet");
    expect(tokenDeEvento(a, SALA.evento, null)).toBe(TOKEN);
    expect(tokenDeEvento(a, "otro-evento", null)).toBeNull();
    for (let i = 0; i < 6; i++) guardarTokenDeEvento(a, { evento: `evento-${i}x`, token: String(i).repeat(22) });
    expect(JSON.parse(a.getItem(CLAVE_EVENTOS_ORG) ?? "[]")).toHaveLength(5);
    expect(tokenDeEvento(a, SALA.evento, null)).toBeNull();
    expect(tokenDeEvento(a, "evento-5x", null)).toBe("5".repeat(22));
  });

  it("recuerda el intento de cada archivo, solo uno por evento, y lo olvida", () => {
    const firma = "S".repeat(86);
    guardarIntentoDeArchivo(a, { evento: SALA.evento, firma, intento: TOKEN });
    expect(intentoDeArchivo(a, SALA.evento, firma, null)).toBe(TOKEN);
    // Otro archivo del mismo evento, otra firma: no es el mismo intento.
    expect(intentoDeArchivo(a, SALA.evento, "T".repeat(86), null)).toBeNull();
    expect(intentoDeArchivo(a, "otro-evento", firma, null)).toBeNull();
    guardarIntentoDeArchivo(a, { evento: SALA.evento, firma: "T".repeat(86), intento: "N".repeat(22) });
    expect(JSON.parse(a.getItem(CLAVE_INTENTOS_ORG) ?? "[]")).toHaveLength(1);
    expect(intentoDeArchivo(a, SALA.evento, firma, null)).toBeNull();
    olvidarIntentoDeArchivo(a, SALA.evento);
    expect(a.getItem(CLAVE_INTENTOS_ORG)).toBeNull();
  });

  it("un intento guardado que no se entiende se ignora", () => {
    a.setItem(CLAVE_INTENTOS_ORG, JSON.stringify([{ evento: SALA.evento, firma: "S", intento: "corto" }, 7, null]));
    expect(intentoDeArchivo(a, SALA.evento, "S", null)).toBeNull();
    a.setItem(CLAVE_INTENTOS_ORG, "no es json");
    expect(intentoDeArchivo(a, SALA.evento, "S", null)).toBeNull();
  });

  it("el token de un evento se reemplaza por el de la sala nueva", () => {
    guardarTokenDeEvento(a, { evento: SALA.evento, token: TOKEN });
    guardarTokenDeEvento(a, { evento: SALA.evento, token: "N".repeat(22) });
    expect(tokenDeEvento(a, SALA.evento, null)).toBe("N".repeat(22));
    expect(JSON.parse(a.getItem(CLAVE_EVENTOS_ORG) ?? "[]")).toHaveLength(1);
  });

  it("un almacén que lanza no rompe nada", () => {
    const roto = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: vi.fn(() => {
        throw new Error("bloqueado");
      }),
      removeItem: () => undefined,
    };
    expect(() => guardarOrg(roto, { sala: SALA, fase: "lista" })).not.toThrow();
    expect(leerOrg(roto, AHORA, "testnet", null)).toBeNull();
    expect(tokenDeEvento(roto, "evento-uno", null)).toBeNull();
  });
});

describe("de quién es lo que recuerda la compu", () => {
  let a: Storage;
  const CUENTA_A = Keypair.random().publicKey();
  const CUENTA_B = Keypair.random().publicKey();
  beforeEach(() => {
    a = almacen();
  });

  it("la sala de una cuenta no se ve desde otra, pero sigue guardada", () => {
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.cuenta).toBe(CUENTA_A);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)).toBeNull();
    expect(a.getItem(CLAVE_ORG)).toContain(TOKEN);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.sala.token).toBe(TOKEN);
  });

  it("si otra cuenta crea o toma una campaña en la misma compu, la de la primera no se pisa y vuelve al retomarla", () => {
    const DE_B: SalaDeCampana = { ...SALA, id: "BbBb1234", token: "B".repeat(22), evento: "evento-de-b" };
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "sellada" }, AHORA);
    guardarOrg(a, { sala: DE_B, cuenta: CUENTA_B, fase: "lista" }, AHORA);
    // Cada cuenta ve la suya, con su token y su clave.
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)?.sala).toEqual(DE_B);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)).toMatchObject({ sala: SALA, fase: "sellada", cuenta: CUENTA_A });
    // Cuando la primera cuenta vuelve a guardar la suya, la de la segunda pasa al costado y tampoco se pierde.
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "sorteada" }, AHORA);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.fase).toBe("sorteada");
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)?.sala).toEqual(DE_B);
    // La de la otra red sigue donde estaba.
    guardarOrg(a, { sala: OTRA, cuenta: CUENTA_B, fase: "abierta" }, AHORA);
    expect(leerOrg(a, AHORA, "mainnet", CUENTA_B)?.sala).toEqual(OTRA);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.fase).toBe("sorteada");
  });

  it("una cuenta recuerda una sala por red aunque pase por ella otra: guardar la misma cuenta la reemplaza", () => {
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "lista" });
    guardarOrg(a, { sala: { ...SALA, token: "N".repeat(22) }, cuenta: CUENTA_A, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.sala.token).toBe("N".repeat(22));
    expect(JSON.parse(a.getItem(CLAVE_ORG) ?? "{}")).not.toHaveProperty("otras");
  });

  describe("muchas cuentas en la misma compu", () => {
    const cuentas = Array.from({ length: 10 }, () => Keypair.random().publicKey());
    const DIA = 86_400_000;
    const salaDe = (i: number, vence = AHORA + DIA + i): SalaDeCampana => ({
      ...SALA,
      id: `Sa${String(i).padStart(6, "0")}`,
      token: `K${String(i).padStart(2, "0")}`.padEnd(22, "x"),
      clave: `C${String(i).padStart(2, "0")}`.padEnd(22, "c"),
      evento: `evento-${i}x`,
      vence,
    });
    const guardar = (i: number, ahora: number, vence?: number): void =>
      guardarOrg(a, { sala: salaDe(i, vence), cuenta: cuentas[i] ?? null, fase: "abierta" }, ahora);
    const tokenDe = (i: number, ahora = AHORA): string | undefined => leerOrg(a, ahora, "testnet", cuentas[i] ?? null)?.sala.token;

    it("con siete cuentas cada una conserva su sala, su token y su clave", () => {
      for (let i = 0; i < 7; i++) guardar(i, AHORA);
      for (let i = 0; i < 7; i++) {
        expect(tokenDe(i)).toBe(salaDe(i).token);
        expect(leerOrg(a, AHORA, "testnet", cuentas[i] ?? null)?.sala.clave).toBe(salaDe(i).clave);
      }
    });

    it("si no entran, la que sale es la que vence primero y no la más vieja", () => {
      for (let i = 0; i < 8; i++) guardar(i, AHORA, i === 3 ? AHORA + 3_600_000 : undefined);
      expect(tokenDe(3)).toBeUndefined();
      for (const i of [0, 1, 2, 4, 5, 6, 7]) expect(tokenDe(i)).toBe(salaDe(i).token);
    });

    it("una sala vencida no se aparta ni ocupa el lugar de una viva", () => {
      const corta = AHORA + 1_000;
      const despues = AHORA + 2_000;
      for (let i = 0; i < 3; i++) guardar(i, AHORA, corta);
      guardar(3, AHORA);
      for (let i = 4; i < 10; i++) guardar(i, despues);
      for (let i = 3; i < 10; i++) expect(tokenDe(i, despues)).toBe(salaDe(i).token);
      const guardado = a.getItem(CLAVE_ORG) ?? "";
      for (let i = 0; i < 3; i++) expect(guardado).not.toContain(salaDe(i).token);
    });

    it("la sala en curso vencida de otra cuenta no pasa al costado", () => {
      guardar(0, AHORA, AHORA + 1_000);
      guardar(1, AHORA + 2_000);
      expect(a.getItem(CLAVE_ORG)).not.toContain(salaDe(0).token);
      expect(JSON.parse(a.getItem(CLAVE_ORG) ?? "{}")).not.toHaveProperty("otras");
    });
  });

  it("borrar la sala de una cuenta no toca la que otra cuenta dejó al costado, y al revés", () => {
    const DE_B: SalaDeCampana = { ...SALA, id: "BbBb1234", token: "B".repeat(22), evento: "evento-de-b" };
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "abierta" }, AHORA);
    guardarOrg(a, { sala: DE_B, cuenta: CUENTA_B, fase: "abierta" }, AHORA);
    borrarOrg(a, "testnet", CUENTA_A);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)).toBeNull();
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)?.sala).toEqual(DE_B);
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "abierta" }, AHORA);
    borrarOrg(a, "testnet", CUENTA_B);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)).toBeNull();
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.sala).toEqual(SALA);
  });

  it("sin sesión y sin sala en curso, dejar la campaña a la vista no borra las de otras cuentas", () => {
    const DE_B: SalaDeCampana = { ...SALA, id: "BbBb1234", token: "B".repeat(22), evento: "evento-de-b" };
    const DE_C: SalaDeCampana = { ...SALA, id: "CcCc1234", token: "Q".repeat(22), evento: "evento-de-c" };
    const CUENTA_C = Keypair.random().publicKey();
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "abierta" }, AHORA);
    guardarOrg(a, { sala: DE_B, cuenta: CUENTA_B, fase: "abierta" }, AHORA);
    guardarOrg(a, { sala: DE_C, cuenta: CUENTA_C, fase: "abierta" }, AHORA);
    // La de C se deja con su sesión: no queda sala en curso, y las de A y B siguen al costado.
    borrarOrg(a, "testnet", CUENTA_C);
    // Sin sesión se ve la primera de un costado. Dejarla saca solo esa.
    const vista = leerOrg(a, AHORA, "testnet", null);
    expect(vista?.sala.id).toBe(DE_B.id);
    borrarOrg(a, "testnet", null, vista?.sala.id);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)).toBeNull();
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.sala).toEqual(SALA);
    // Sin saber cuál se dejó, sin sesión no se borra ninguna de otra cuenta.
    borrarOrg(a, "testnet", null);
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.sala).toEqual(SALA);
  });

  it("sin sesión se ve la sala de cualquier cuenta, para mirarla", () => {
    guardarOrg(a, { sala: SALA, cuenta: CUENTA_A, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", null)?.sala.id).toBe(SALA.id);
  });

  it("una memoria de antes, sin cuenta, la ve cualquiera, y una campaña sin organizadora guarda null", () => {
    guardarOrg(a, { sala: SALA, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)?.cuenta).toBeUndefined();
    guardarOrg(a, { sala: SALA, cuenta: null, fase: "abierta" });
    expect(leerOrg(a, AHORA, "testnet", CUENTA_B)?.cuenta).toBeNull();
  });

  it("una cuenta que no es una cuenta se descarta al leer y queda como memoria de antes", () => {
    a.setItem(CLAVE_ORG, JSON.stringify({ testnet: { sala: SALA, fase: "abierta", cuenta: "no-es-una-cuenta" } }));
    expect(leerOrg(a, AHORA, "testnet", CUENTA_A)?.cuenta).toBeUndefined();
  });

  it("solo la cuenta dueña mueve la sala: sin cuenta guardada no se mueve nada, sin organizadora sí", () => {
    expect(puedeMoverLaSala(CUENTA_A, CUENTA_A)).toBe(true);
    expect(puedeMoverLaSala(CUENTA_A, CUENTA_B)).toBe(false);
    expect(puedeMoverLaSala(CUENTA_A, null)).toBe(false);
    expect(puedeMoverLaSala(null, null)).toBe(true);
    expect(puedeMoverLaSala(null, CUENTA_B)).toBe(true);
    expect(puedeMoverLaSala(undefined, CUENTA_A)).toBe(false);
    expect(puedeMoverLaSala(undefined, null)).toBe(false);
  });

  it("el token de un evento es de la cuenta que lo creó y el de otra no se pisa", () => {
    guardarTokenDeEvento(a, { evento: SALA.evento, token: TOKEN, cuenta: CUENTA_A });
    expect(tokenDeEvento(a, SALA.evento, CUENTA_A)).toBe(TOKEN);
    expect(tokenDeEvento(a, SALA.evento, CUENTA_B)).toBeNull();
    // Sin sesión tampoco se ofrece: el token da el control de una sala.
    expect(tokenDeEvento(a, SALA.evento, null)).toBeNull();
    guardarTokenDeEvento(a, { evento: SALA.evento, token: "N".repeat(22), cuenta: CUENTA_B });
    expect(tokenDeEvento(a, SALA.evento, CUENTA_A)).toBe(TOKEN);
    expect(tokenDeEvento(a, SALA.evento, CUENTA_B)).toBe("N".repeat(22));
    expect(JSON.parse(a.getItem(CLAVE_EVENTOS_ORG) ?? "[]")).toHaveLength(2);
  });

  it("un token de antes, sin cuenta, lo usa cualquiera", () => {
    guardarTokenDeEvento(a, { evento: SALA.evento, token: TOKEN });
    expect(tokenDeEvento(a, SALA.evento, CUENTA_B)).toBe(TOKEN);
    expect(tokenDeEvento(a, SALA.evento, null)).toBe(TOKEN);
  });

  it("el intento de un archivo es de la cuenta que lo guardó y olvidar el de una no toca el de la otra", () => {
    const firma = "S".repeat(86);
    guardarIntentoDeArchivo(a, { evento: SALA.evento, firma, intento: TOKEN, cuenta: CUENTA_A });
    expect(intentoDeArchivo(a, SALA.evento, firma, CUENTA_A)).toBe(TOKEN);
    expect(intentoDeArchivo(a, SALA.evento, firma, CUENTA_B)).toBeNull();
    guardarIntentoDeArchivo(a, { evento: SALA.evento, firma, intento: "N".repeat(22), cuenta: CUENTA_B });
    expect(intentoDeArchivo(a, SALA.evento, firma, CUENTA_A)).toBe(TOKEN);
    expect(intentoDeArchivo(a, SALA.evento, firma, CUENTA_B)).toBe("N".repeat(22));
    olvidarIntentoDeArchivo(a, SALA.evento, CUENTA_B);
    expect(intentoDeArchivo(a, SALA.evento, firma, CUENTA_A)).toBe(TOKEN);
    expect(intentoDeArchivo(a, SALA.evento, firma, CUENTA_B)).toBeNull();
  });
});

describe("la sala que ya no acepta el token", () => {
  const SIN_TOKEN = (): ReturnType<typeof conRespuesta> => conRespuesta(403, { error: "token" });

  it("un 403 con el motivo token es otra falla, aparte del rechazo común y de la caída", async () => {
    expect(await pedirPase(SALA, { fetch: SIN_TOKEN().fetch })).toBe("token");
    expect(await ponerFase(SALA, "cerrada", null, { fetch: SIN_TOKEN().fetch })).toBe("token");
    expect(await quitarConMotivo(SALA, 3, "otro", { fetch: SIN_TOKEN().fetch })).toBe("token");
    expect(await estadoConToken(SALA, { fetch: SIN_TOKEN().fetch })).toBe("token");
    expect(await leerCampanaDeSala(SALA, { fetch: SIN_TOKEN().fetch })).toBe("token");
  });

  it("otro 403 sigue siendo un rechazo, y un 500 una caída", async () => {
    expect(await pedirPase(SALA, { fetch: conRespuesta(403, { error: "origen" }).fetch })).toBe("rechazo");
    expect(await ponerFase(SALA, "abierta", null, { fetch: conRespuesta(409, { error: "fase" }).fetch })).toBe("rechazo");
    expect(await pedirPase(SALA, { fetch: conRespuesta(500, { error: "token" }).fetch })).toBe("red");
  });

  it("el estado dice si el token es el vigente cuando la sala lo sabe decir, y no inventa nada si no", async () => {
    const base = { fase: "abierta", total: 3, cierraMs: AHORA };
    expect(await estadoConToken(SALA, { fetch: conRespuesta(200, { ...base, tuya: true }).fetch })).toMatchObject({ tuya: true });
    expect(await estadoConToken(SALA, { fetch: conRespuesta(200, { ...base, tuya: false }).fetch })).toMatchObject({ tuya: false });
    const sin = await estadoConToken(SALA, { fetch: conRespuesta(200, base).fetch });
    expect(sin).not.toHaveProperty("tuya");
    const raro = await estadoConToken(SALA, { fetch: conRespuesta(200, { ...base, tuya: "si" }).fetch });
    expect(raro).not.toHaveProperty("tuya");
  });
});
