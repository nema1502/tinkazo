import { DatabaseSync } from "node:sqlite";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  campanaDeLaCuenta,
  campanasDeLaCuenta,
  crearTablasDeActivar,
  ESPERA_ENTRE_CORREOS_DE_TOMA_MS,
  guardarCampanaDeCuenta,
  marcarEventoSellado,
  prepararToma,
  reescribirHuellaDeEvento,
  reservarCorreoDeToma,
} from "../../workers/sala/src/activar-cupos";
import { LISTADOS_POR_CUENTA } from "../../workers/sala/src/activar";
import { confirmarEventoSql, reservarEventoSql } from "../../workers/sala/src/campana";
import type { Ejecutar } from "../../workers/sala/src/registro";
import { MAX_CAMPANAS_EN_LA_LISTA, leerPedidoDeTus, tusCampanasPrendido } from "../../workers/sala/src/tus-campanas";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar, type MundoDeActivar } from "./activar-mundo";
import { altaDe, firmarParaLaPrueba, personaDePrueba, sesionDePrueba, type PersonaDePrueba } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * Tus campañas, la ruta que lista las campañas de una cuenta (`POST /v1/mis-campanas`): el Worker entero en Node con un SQLite
 * de verdad, un proveedor de cuentas de mentira y el reloj de la prueba. Lo que no se ve nunca: la campaña de otra cuenta, el
 * texto firmado, el id de la sala ni su token.
 */
const AHORA = HORA_DE_LA_PRUEBA;
const HORA = 3_600_000;
const DIA = 86_400_000;
const EVENTO = "casa-andina-k7p2";
const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

let m: MundoDeActivar;
let b: PersonaDePrueba;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  m = await montarMundoDeActivar({ TUS_CAMPANAS: "1" });
  b = personaDePrueba(m.mundo, 2);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const listar = (sesion: string, extra: Parameters<MundoDeActivar["mundo"]["pedir"]>[1] = {}): Promise<Response> =>
  m.mundo.pedir("/v1/mis-campanas", { cuerpo: { sesion }, ...extra });

const delListado = async (sesion: string): Promise<{ evento: string; estado: string; fase?: string; total?: number }[]> => {
  const r = await listar(sesion);
  expect(r.status).toBe(200);
  return ((await r.json()) as { campanas: { evento: string; estado: string; fase?: string; total?: number }[] }).campanas;
};

/** Activa una campaña de la organizadora: paga la comisión de la prueba y firma. */
async function activar(cambios: Record<string, unknown> = {}): Promise<{ texto: string; firma: string }> {
  const evento = (cambios.evento as string | undefined) ?? EVENTO;
  m.horizon.pagos = [m.pagoCompleto(evento)];
  const r = await m.activar({ texto: JSON.stringify(m.campana(cambios)), sesion: m.organizadora.token });
  expect(r.status).toBe(200);
  return (await r.json()) as { texto: string; firma: string };
}

/** Crea la sala de una campaña (como lo hace el panel con el archivo firmado) y devuelve su id y su token. */
async function crearSala(cambios: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
  const r = await m.mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana(cambios)) });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; token: string };
}

const poner = (id: string, fase: string): void => void m.mundo.ejecutar(`sala:${id}`, "UPDATE sala SET v = ? WHERE k = 'fase'", fase);

describe("la lista de una cuenta", () => {
  it("una cuenta sin campañas, o que nunca existió, recibe una lista vacía", async () => {
    expect(await delListado(m.organizadora.token)).toEqual([]);
    expect(await delListado(b.token)).toEqual([]);
  });

  it("una campaña activada sin sala y con el cierre por delante es activada, con sus horas y sin lo secreto", async () => {
    const firmada = await activar();
    const r = await listar(m.organizadora.token);
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({
      campanas: [
        {
          evento: EVENTO,
          empresa: "Casa Andina",
          zona: "America/La_Paz",
          abreMs: AHORA,
          cierraMs: AHORA + HORA,
          sorteoMs: AHORA + 2 * HORA,
          estado: "activada",
        },
      ],
    });
    // Nunca el texto firmado ni la firma.
    expect(cuerpo).not.toContain(firmada.firma);
    expect(cuerpo).not.toContain("texto");
    expect(cuerpo).not.toContain("firma");
  });

  it("una sala viva es viva con su fase y cuántas personas hay, y nunca dice su id ni su token", async () => {
    const sala = await crearSala();
    expect(await delListado(m.organizadora.token)).toMatchObject([{ evento: EVENTO, estado: "viva", fase: "lista", total: 0 }]);
    const abierta = await m.mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: { Authorization: `Bearer ${sala.token}` } });
    expect(abierta.status).toBe(204);
    for (const n of [10, 11, 12]) expect((await altaDe(m.mundo, sala.id, personaDePrueba(m.mundo, n))).status).toBe(201);
    const r = await listar(m.organizadora.token);
    const cuerpo = await r.text();
    expect((JSON.parse(cuerpo) as { campanas: unknown[] }).campanas).toMatchObject([{ evento: EVENTO, estado: "viva", fase: "abierta", total: 3 }]);
    expect(cuerpo).not.toContain(sala.id);
    expect(cuerpo).not.toContain(sala.token);
  });

  it("una sala sorteada sigue siendo viva, con su fase y su total", async () => {
    const sala = await crearSala();
    poner(sala.id, "sorteada");
    expect(await delListado(m.organizadora.token)).toMatchObject([{ estado: "viva", fase: "sorteada", total: 0 }]);
  });

  it("la sala viva gana: una sala en sellada con el evento ya sellado sigue siendo viva", async () => {
    const sala = await crearSala();
    poner(sala.id, "sellada");
    await m.mundo.cupos().marcarSellado(EVENTO, AHORA + 2 * HORA);
    expect(await delListado(m.organizadora.token)).toMatchObject([{ estado: "viva", fase: "sellada" }]);
  });

  it("un evento sellado sin sala viva es terminada, aunque el cierre esté por delante", async () => {
    await activar();
    await m.mundo.cupos().marcarSellado(EVENTO, AHORA + 2 * HORA);
    expect(await delListado(m.organizadora.token)).toMatchObject([{ evento: EVENTO, estado: "terminada" }]);
  });

  it("sin sala viva y con el cierre pasado es terminada, y una sala que murió con el cierre por delante vuelve a ser activada", async () => {
    const sala = await crearSala();
    const cerrada = await m.mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: { Authorization: `Bearer ${sala.token}` } });
    expect(cerrada.status).toBe(204);
    expect(await delListado(m.organizadora.token)).toMatchObject([{ estado: "activada" }]);
    vi.setSystemTime(AHORA + HORA + 1);
    expect(await delListado(m.organizadora.token)).toMatchObject([{ estado: "terminada" }]);
  });

  it("primero las vivas, después las activadas por hora de apertura y al final las terminadas, las más nuevas primero", async () => {
    // Tres filas escritas a mano con cuenta, eventos y horas distintas, y una sala viva.
    const poner3 = (evento: string, abre: number, cierra: number, sorteo: number): void =>
      void m.mundo.ejecutar(
        "cupos",
        "INSERT INTO campanas_de_cuenta (cuenta, evento, texto, firma, empresa, zona, abre_ms, cierra_ms, sorteo_ms, en_ms, hasta_ms) VALUES (?, ?, 't', 'f', ?, 'America/La_Paz', ?, ?, ?, ?, ?)",
        m.organizadora.cuenta,
        evento,
        `Empresa ${evento}`,
        abre,
        cierra,
        sorteo,
        AHORA,
        sorteo + 30 * DIA,
      );
    poner3("activada-tarde", AHORA + 5 * HORA, AHORA + 8 * HORA, AHORA + 9 * HORA);
    poner3("activada-pronto", AHORA + 2 * HORA, AHORA + 8 * HORA, AHORA + 9 * HORA);
    poner3("terminada-vieja", AHORA - 9 * HORA, AHORA - 8 * HORA, AHORA - 7 * HORA);
    poner3("terminada-nueva", AHORA - 5 * HORA, AHORA - 4 * HORA, AHORA - 3 * HORA);
    await crearSala();
    expect((await delListado(m.organizadora.token)).map((c) => `${c.estado}:${c.evento}`)).toEqual([
      `viva:${EVENTO}`,
      "activada:activada-pronto",
      "activada:activada-tarde",
      "terminada:terminada-nueva",
      "terminada:terminada-vieja",
    ]);
  });

  it("trae hasta 20 campañas", async () => {
    for (let i = 0; i < 25; i++) {
      m.mundo.ejecutar(
        "cupos",
        "INSERT INTO campanas_de_cuenta (cuenta, evento, texto, firma, empresa, zona, abre_ms, cierra_ms, sorteo_ms, en_ms, hasta_ms) VALUES (?, ?, 't', 'f', 'E', 'America/La_Paz', ?, ?, ?, ?, ?)",
        m.organizadora.cuenta,
        `evento-${String(i).padStart(2, "0")}`,
        AHORA + i * 1000,
        AHORA + 4 * HORA,
        AHORA + 5 * HORA,
        AHORA,
        AHORA + 40 * DIA,
      );
    }
    const lista = await delListado(m.organizadora.token);
    expect(lista).toHaveLength(MAX_CAMPANAS_EN_LA_LISTA);
    expect(lista[0]?.evento).toBe("evento-00");
  });
});

describe("la campaña de otra cuenta no se ve", () => {
  it("con la sesión de otra cuenta no aparece nada de la campaña de la organizadora, con sala o sin ella", async () => {
    await activar();
    expect(await delListado(b.token)).toEqual([]);
    await crearSala();
    expect(await delListado(b.token)).toEqual([]);
    expect(await delListado(m.organizadora.token)).toHaveLength(1);
  });

  it("una cuenta que tiene una fila a mano del evento de otra no ve su fase ni su total, con la dueña escrita o sin escribir", async () => {
    const sala = await crearSala();
    expect(sala.id).toBeTruthy();
    // La fila de la organizadora se reemplaza por una de B para el mismo evento.
    m.mundo.ejecutar("cupos", "UPDATE campanas_de_cuenta SET cuenta = ? WHERE evento = ?", b.cuenta, EVENTO);
    // Con la dueña escrita en la sala (la de siempre): la fila de B no es de B y no sale.
    expect(await delListado(b.token)).toEqual([]);
    expect(await delListado(m.organizadora.token)).toEqual([]);
    // Sin la dueña escrita: la sala viva nombra a otra organizadora y tampoco sale, sin decir nada de ella.
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 1 WHERE evento = ?", EVENTO);
    const r = await listar(b.token);
    const cuerpo = await r.text();
    expect(JSON.parse(cuerpo)).toEqual({ campanas: [] });
    expect(cuerpo).not.toContain(EVENTO);
  });

  it("una sala firmada a mano sin organizadora no aparece en la lista de nadie", async () => {
    const sala = await crearSala({ organizadora: undefined });
    expect(sala.id).toBeTruthy();
    expect(await delListado(m.organizadora.token)).toEqual([]);
    expect(await delListado(b.token)).toEqual([]);
  });
});

describe("el barrido de las campañas de antes", () => {
  it("una campaña con sala viva y sin dueña escrita aparece en la lista, y queda escrita", async () => {
    const sala = await crearSala();
    m.mundo.ejecutar("cupos", "DELETE FROM campanas_de_cuenta");
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 0 WHERE evento = ?", EVENTO);
    const lista = await delListado(m.organizadora.token);
    expect(lista).toMatchObject([{ evento: EVENTO, estado: "viva", fase: "lista" }]);
    expect(m.mundo.ejecutar("cupos", "SELECT duena, revisada FROM eventos_campana WHERE evento = ?", EVENTO)).toEqual([
      { duena: m.organizadora.cuenta, revisada: 1 },
    ]);
    expect(sala.id).toBeTruthy();
  });
});

describe("los permisos y los rechazos", () => {
  it("toda respuesta lleva los permisos de origen, también las de las rutas apagadas y las que fallan", async () => {
    const casos: Parameters<MundoDeActivar["mundo"]["pedir"]>[1][] = [
      { cuerpo: { sesion: m.organizadora.token } },
      { cuerpo: { sesion: 7 } },
      { cuerpo: { sesion: "corta" } },
      { cuerpo: { sesion: b.token }, cabeceras: { Origin: "https://malo.example" } },
      { metodo: "GET" },
      { metodo: "OPTIONS" },
    ];
    for (const init of casos) {
      const r = await m.mundo.pedir("/v1/mis-campanas", init);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
      expect(r.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    }
    const apagado = await montarMundoDeActivar();
    for (const ruta of ["/v1/mis-campanas", "/v1/campana/recuperar"]) {
      const r = await apagado.mundo.pedir(ruta, { cuerpo: { sesion: apagado.organizadora.token, evento: EVENTO } });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: "apagada" });
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    }
  });

  it("el preflight contesta 204 y cualquier otro método, 404, los dos con permisos", async () => {
    expect((await m.mundo.pedir("/v1/mis-campanas", { metodo: "OPTIONS" })).status).toBe(204);
    const get = await m.mundo.pedir("/v1/mis-campanas", { metodo: "GET" });
    expect(get.status).toBe(404);
    expect(get.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
  });

  it("sin JSON o sin sesión de texto es 400 forma", async () => {
    const sinCuerpo = await m.mundo.pedir("/v1/mis-campanas", { metodo: "POST" });
    expect(sinCuerpo.status).toBe(400);
    expect(await sinCuerpo.json()).toEqual({ error: "forma", campo: "cuerpo" });
    for (const cuerpo of [{}, { sesion: 7 }, { sesion: null }]) {
      const r = await m.mundo.pedir("/v1/mis-campanas", { cuerpo });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "forma", campo: "sesion" });
    }
  });

  it("fuera del sitio es 403 origen, y una sesión sin forma de token es 401 sin tocar al proveedor ni gastar el cupo", async () => {
    const fuera = await listar(m.organizadora.token, { cabeceras: { Origin: "https://malo.example" } });
    expect(fuera.status).toBe(403);
    expect(await fuera.json()).toEqual({ error: "origen" });
    const antes = { ...m.mundo.proveedor.llamadas };
    for (const basura of ["x", "con espacios y cosas raras que no son un token", "a.b", "a".repeat(5000)]) {
      const r = await listar(basura);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "sesion" });
    }
    expect(m.mundo.proveedor.llamadas).toEqual(antes);
    expect(m.mundo.ejecutar("cupos", "SELECT * FROM activar_ritmo")).toEqual([]);
    expect(m.mundo.ejecutar("cupos", "SELECT * FROM activar_ficha")).toEqual([]);
  });

  it("una sesión con forma pero que el proveedor no reconoce es 401 y cuenta un rechazo", async () => {
    // La forma es la de la sesión del proveedor, un JWT de tres partes: un texto sin puntos ya no llega al proveedor.
    const r = await listar(sesionDePrueba("desconocida"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "sesion" });
    expect(m.mundo.ejecutar("cupos", "SELECT n FROM activar_ficha")).toEqual([{ n: 1 }]);
    // El rechazo de la conexión se cuenta en el grupo de Tus campañas, aparte del de activar.
    const grupos = m.mundo.ejecutar("cupos", "SELECT grupo FROM activar_rechazos") as { grupo: string }[];
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.grupo.startsWith("cuenta|")).toBe(true);
  });

  it("un texto sin forma de sesión de tres partes es 401 sin llamar al proveedor ni contar nada", async () => {
    const antes = { ...m.mundo.proveedor.llamadas };
    const r = await listar("tok_desconocida_" + "z".repeat(24));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "sesion" });
    expect(m.mundo.proveedor.llamadas).toEqual(antes);
    expect(m.mundo.ejecutar("cupos", "SELECT * FROM activar_ficha")).toEqual([]);
    expect(m.mundo.ejecutar("cupos", "SELECT * FROM activar_rechazos")).toEqual([]);
  });

  it("quien no entró por Google es 403 no-google, quien no tiene cuenta es 409 sin-billetera y el proveedor caído es 502 red", async () => {
    const correo = personaDePrueba(m.mundo, 5, { authProvider: "email" });
    const noGoogle = await listar(correo.token);
    expect(noGoogle.status).toBe(403);
    expect(await noGoogle.json()).toEqual({ error: "no-google" });
    const sinCuenta = personaDePrueba(m.mundo, 6, { wallet: null });
    m.mundo.proveedor.billeteras.set(sinCuenta.usuario, null);
    const r409 = await listar(sinCuenta.token);
    expect(r409.status).toBe(409);
    expect(await r409.json()).toEqual({ error: "sin-billetera" });
    m.mundo.proveedor.caido = true;
    const caido = await listar(b.token);
    expect(caido.status).toBe(502);
    expect(await caido.json()).toEqual({ error: "red" });
    // Un corte del proveedor no cuenta como rechazo.
    expect(m.mundo.ejecutar("cupos", "SELECT n FROM activar_rechazos")).toEqual([{ n: 1 }]);
  });

  it("el listado 31 de una cuenta en 10 minutos es 429 cupo-cuenta con Retry-After", async () => {
    for (let i = 0; i < LISTADOS_POR_CUENTA; i++) expect((await listar(m.organizadora.token)).status).toBe(200);
    const r = await listar(m.organizadora.token);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "cupo-cuenta" });
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    // Otra cuenta no se ve afectada.
    expect((await listar(b.token)).status).toBe(200);
  });

  it("un fallo inesperado del servidor es 503 ocupado y con permisos, no una caída sin respuesta", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    m.mundo.ejecutar("cupos", "DROP TABLE campanas_de_cuenta");
    const r = await listar(m.organizadora.token);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "ocupado" });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
  });
});

describe("el interruptor y la forma del pedido", () => {
  it("las rutas atienden solo con la variable en 1", () => {
    expect(tusCampanasPrendido({ TUS_CAMPANAS: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "si", " 1"]) expect(tusCampanasPrendido({ TUS_CAMPANAS: v })).toBe(false);
  });

  it("el pedido de usar una campaña pide un evento con la forma de siempre", () => {
    expect(leerPedidoDeTus({ sesion: "s", evento: "feria-sc-28nov-ab12" }, true)).toEqual({ ok: true, sesion: "s", evento: "feria-sc-28nov-ab12" });
    for (const evento of [undefined, 7, "A", "con espacio", "x".repeat(60)]) {
      expect(leerPedidoDeTus({ sesion: "s", evento }, true)).toMatchObject({ ok: false, respuesta: { estado: 400, cuerpo: { error: "forma", campo: "evento" } } });
    }
    expect(leerPedidoDeTus(null, false)).toMatchObject({ ok: false, respuesta: { estado: 400 } });
  });
});

describe("lo que leen las rutas, en SQL", () => {
  function base(): Ejecutar {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
    crearTablasDeActivar(sql);
    return sql;
  }
  const campana = (cuenta: string, evento: string) => ({
    cuenta,
    evento,
    texto: JSON.stringify({ evento, organizadora: cuenta }),
    firma: "f".repeat(64),
    empresa: "Casa Andina",
    zona: "America/La_Paz",
    abreMs: AHORA,
    cierraMs: AHORA + HORA,
    sorteoMs: AHORA + 2 * HORA,
    ahora: AHORA,
  });

  it("campanasDeLaCuenta trae solo las de la cuenta y deja afuera una fila cuyo evento tiene otra dueña", () => {
    const sql = base();
    guardarCampanaDeCuenta(sql, campana(A, "evento-de-a"));
    guardarCampanaDeCuenta(sql, campana(B, "evento-de-b"));
    expect(campanasDeLaCuenta(sql, { cuenta: A, ahora: AHORA }).map((f) => f.evento)).toEqual(["evento-de-a"]);
    // Una sala del evento de A que dice ser de B: la fila de A deja de ser suya.
    const r = reservarEventoSql(sql, "evento-de-a", AHORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(confirmarEventoSql(sql, "evento-de-a", { reserva: r.reserva, sala: "Sala0001", huella: "h", ahora: AHORA, organizadora: B })).toBe(true);
    expect(campanasDeLaCuenta(sql, { cuenta: A, ahora: AHORA })).toEqual([]);
  });

  it("campanasDeLaCuenta dice la sala y si el evento se selló, y se olvida de lo vencido", () => {
    const sql = base();
    guardarCampanaDeCuenta(sql, campana(A, "con-sala"));
    guardarCampanaDeCuenta(sql, campana(A, "sellada"));
    const r = reservarEventoSql(sql, "con-sala", AHORA);
    if (r.ok) confirmarEventoSql(sql, "con-sala", { reserva: r.reserva, sala: "Sala0001", huella: "h", ahora: AHORA, organizadora: A });
    marcarEventoSellado(sql, { evento: "sellada", sorteoMs: AHORA + 2 * HORA, ahora: AHORA });
    const filas = Object.fromEntries(campanasDeLaCuenta(sql, { cuenta: A, ahora: AHORA }).map((f) => [f.evento, f]));
    expect(filas["con-sala"]).toMatchObject({ sala: "Sala0001", salaEnMs: AHORA, sellado: false });
    expect(filas["sellada"]).toMatchObject({ sala: null, salaEnMs: null, sellado: true });
    expect(campanasDeLaCuenta(sql, { cuenta: A, ahora: AHORA + 2 * HORA + 31 * DIA })).toEqual([]);
  });

  it("campanaDeLaCuenta es null para otra cuenta, para un evento que no existe y para uno de otra dueña", () => {
    const sql = base();
    guardarCampanaDeCuenta(sql, campana(A, "evento-de-a"));
    expect(campanaDeLaCuenta(sql, { cuenta: A, evento: "evento-de-a", ahora: AHORA })).toMatchObject({ hayFila: false, sala: null, sellado: false, cierraMs: AHORA + HORA });
    expect(campanaDeLaCuenta(sql, { cuenta: B, evento: "evento-de-a", ahora: AHORA })).toBeNull();
    expect(campanaDeLaCuenta(sql, { cuenta: A, evento: "no-existe-1", ahora: AHORA })).toBeNull();
    const r = reservarEventoSql(sql, "evento-de-a", AHORA);
    if (r.ok) confirmarEventoSql(sql, "evento-de-a", { reserva: r.reserva, sala: "Sala0001", huella: "h", ahora: AHORA, organizadora: B });
    expect(campanaDeLaCuenta(sql, { cuenta: A, evento: "evento-de-a", ahora: AHORA })).toBeNull();
  });

  it("reescribirHuellaDeEvento cambia la huella solo si el evento sigue con esa sala", () => {
    const sql = base();
    guardarCampanaDeCuenta(sql, campana(A, "con-sala"));
    const r = reservarEventoSql(sql, "con-sala", AHORA);
    if (r.ok) confirmarEventoSql(sql, "con-sala", { reserva: r.reserva, sala: "Sala0001", huella: "vieja", ahora: AHORA, organizadora: A });
    expect(reescribirHuellaDeEvento(sql, { evento: "con-sala", sala: "Sala0002", huella: "nueva" })).toBe(false);
    expect(sql("SELECT huella FROM eventos_campana WHERE evento = 'con-sala'")).toEqual([{ huella: "vieja" }]);
    expect(reescribirHuellaDeEvento(sql, { evento: "con-sala", sala: "Sala0001", huella: "nueva" })).toBe(true);
    expect(sql("SELECT huella FROM eventos_campana WHERE evento = 'con-sala'")).toEqual([{ huella: "nueva" }]);
    expect(reescribirHuellaDeEvento(sql, { evento: "sin-fila", sala: "Sala0001", huella: "x" })).toBe(false);
  });

  it("reservarCorreoDeToma deja un correo cada 10 minutos por campaña y ninguno si no hubo toma", () => {
    const sql = base();
    guardarCampanaDeCuenta(sql, campana(A, "con-sala"));
    expect(reservarCorreoDeToma(sql, { evento: "con-sala", ahora: AHORA })).toBe(false);
    expect(prepararToma(sql, { cuenta: A, evento: "con-sala", huellaNueva: "h".repeat(64), ahora: AHORA }).ok).toBe(true);
    expect(reservarCorreoDeToma(sql, { evento: "con-sala", ahora: AHORA })).toBe(true);
    expect(reservarCorreoDeToma(sql, { evento: "con-sala", ahora: AHORA + ESPERA_ENTRE_CORREOS_DE_TOMA_MS - 1 })).toBe(false);
    expect(reservarCorreoDeToma(sql, { evento: "con-sala", ahora: AHORA + ESPERA_ENTRE_CORREOS_DE_TOMA_MS })).toBe(true);
  });
});
