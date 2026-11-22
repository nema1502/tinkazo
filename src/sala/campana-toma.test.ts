import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAUSA_ENTRE_TOMAS_MS, confirmarToma, crearTablasDeActivar, guardarCampanaDeCuenta, prepararToma } from "../../workers/sala/src/activar-cupos";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar, type MundoDeActivar } from "./activar-mundo";
import { firmarParaLaPrueba } from "./mundo-sala";
import { DatabaseSync } from "node:sqlite";
import type { Ejecutar } from "../../workers/sala/src/registro";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));
/** Lo que el Worker lee del contrato: las pruebas de rutas con el token viejo lo necesitan para llegar a la comprobación. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * La toma de una campaña, el lado del servidor: pasarla a otra compu cambia el token de la sala sin carreras. Con una sala
 * de verdad (la del Worker entero en Node), sockets de mentira y el reloj de la prueba.
 */
const EVENTO = "casa-andina-k7p2";
const huellaDe = (token: string): string => createHash("sha256").update(token).digest("hex");
const TOKEN_B = "B".repeat(22);
const TOKEN_C = "C".repeat(22);

let m: MundoDeActivar;
let sala: { id: string; token: string };
let cuenta: string;

/** Crea una sala con un archivo firmado que nombra a la cuenta de la prueba. */
async function crearSala(cambios: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
  const r = await m.mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana(cambios)) });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; token: string };
}

const huellaDeLaSala = (id: string): string | undefined => m.mundo.ejecutar(`sala:${id}`, "SELECT v FROM sala WHERE k = 'huella'")[0]?.v as string | undefined;
const huellaDelEvento = (evento: string = EVENTO): string | undefined =>
  m.mundo.ejecutar("cupos", "SELECT huella FROM eventos_campana WHERE evento = ?", evento)[0]?.huella as string | undefined;
const avanzar = (ms: number): void => void vi.setSystemTime(Date.now() + ms);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HORA_DE_LA_PRUEBA);
  m = await montarMundoDeActivar();
  cuenta = m.organizadora.cuenta;
  sala = await crearSala();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("el token de la sala y el SHA-256 que espera", () => {
  it("un pedido que esperaba con el token viejo mientras otra compu toma la campaña es rechazado", async () => {
    const objeto = m.mundo.sala(sala.id);
    const pendiente = objeto.paseDeLaPantalla(sala.token);
    const toma = await objeto.cambiarToken(cuenta, huellaDe(TOKEN_B), 1);
    expect(toma.ok).toBe(true);
    expect(await pendiente).toMatchObject({ ok: false, motivo: "token" });
    expect(await objeto.paseDeLaPantalla(TOKEN_B)).toMatchObject({ ok: true });
  });

  it("un sello en vuelo con el token viejo da token cuando la toma fue antes", async () => {
    const objeto = m.mundo.sala(sala.id);
    const sello = { listHash: "0".repeat(64), count: 0, numWinners: 2, sorteado: false, organizador: null, ronda: 40_000_000 };
    const enVuelo = objeto.sellarCampana(sala.token, "7", sello);
    await objeto.cambiarToken(cuenta, huellaDe(TOKEN_B), 1);
    expect(await enVuelo).toMatchObject({ ok: false, motivo: "token" });
  });

  it("después de la toma, el token viejo da 403 token en cada ruta y el nuevo es el que vale", async () => {
    expect((await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).ok).toBe(true);
    lectura.valor = {
      sello: { listHash: "0".repeat(64), count: 0, numWinners: 2, sorteado: true, organizador: null, ronda: 40_000_000 },
      ganadores: [0],
    };
    const viejo = { Authorization: `Bearer ${sala.token}` };
    const base = `/v1/sala/${sala.id}`;
    const casos: [string, Parameters<typeof m.mundo.pedir>[1]][] = [
      [`${base}/campana/pase`, { metodo: "GET", cabeceras: viejo }],
      [`${base}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: viejo }],
      [`${base}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "sellada", sorteo: "7" }, cabeceras: viejo }],
      [`${base}/campana/quitar`, { cuerpo: { n: 1, motivo: "otro" }, cabeceras: viejo }],
      [`${base}/campana/avisar`, { cuerpo: { cuenta }, cabeceras: viejo }],
      [`${base}/campana/resultado`, { metodo: "PUT", cuerpo: { sorteo: "7", comprobante: "/verificar.html#x" }, cabeceras: viejo }],
      [`${base}/nombres?desde=0`, { metodo: "GET", cabeceras: viejo }],
      [`${base}/equipos?desde=0`, { metodo: "GET", cabeceras: viejo }],
      [base, { metodo: "DELETE", cabeceras: viejo }],
    ];
    for (const [ruta, init] of casos) {
      const r = await m.mundo.pedir(ruta, init);
      expect(`${init?.metodo ?? "POST"} ${ruta}: ${r.status}`).toMatch(/: 403$/);
      expect(await r.json()).toEqual({ error: "token" });
    }
    const nuevo = await m.mundo.pedir(`${base}/campana/pase`, { metodo: "GET", cabeceras: { Authorization: `Bearer ${TOKEN_B}` } });
    expect(nuevo.status).toBe(200);
    // La sala sigue viva: ninguno de los intentos viejos la cerró.
    expect(await m.mundo.sala(sala.id).viva()).toBe(true);
  });
});

describe("Sala.cambiarToken", () => {
  it("escribe la huella y la generación, y dice la fase y cuándo vence la sala según su alarma", async () => {
    const r = await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1);
    expect(r).toEqual({ ok: true, fase: "lista", vence: m.mundo.alarmaDe(sala.id) });
    expect(r.ok && r.vence).toBe(HORA_DE_LA_PRUEBA + 600_000);
    expect(huellaDeLaSala(sala.id)).toBe(huellaDe(TOKEN_B));
    expect(m.mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'gen'")).toEqual([{ v: "1" }]);
  });

  it("una sala sellada contesta sellada y no cambia nada", async () => {
    m.mundo.ejecutar(`sala:${sala.id}`, "UPDATE sala SET v = 'sellada' WHERE k = 'fase'");
    const antes = huellaDeLaSala(sala.id);
    expect(await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).toEqual({ ok: false, motivo: "sellada" });
    expect(huellaDeLaSala(sala.id)).toBe(antes);
    expect(m.mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'gen'")).toEqual([]);
    expect(await m.mundo.sala(sala.id).paseDeLaPantalla(sala.token)).toMatchObject({ ok: true });
  });

  it("una sorteada sí se toma: queda el comprobante para quien la retome", async () => {
    m.mundo.ejecutar(`sala:${sala.id}`, "UPDATE sala SET v = 'sorteada' WHERE k = 'fase'");
    expect(await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).toMatchObject({ ok: true, fase: "sorteada" });
  });

  it("otra cuenta, o una sala que no nombra cuenta, contesta no-existe y el token no cambia", async () => {
    const antes = huellaDeLaSala(sala.id);
    expect(await m.mundo.sala(sala.id).cambiarToken(Keypair.random().publicKey(), huellaDe(TOKEN_B), 1)).toEqual({ ok: false, motivo: "no-existe" });
    expect(huellaDeLaSala(sala.id)).toBe(antes);
    const sinCuenta = await crearSala({ evento: "sin-cuenta-x1", organizadora: undefined });
    const delOtra = huellaDeLaSala(sinCuenta.id);
    expect(await m.mundo.sala(sinCuenta.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).toEqual({ ok: false, motivo: "no-existe" });
    expect(huellaDeLaSala(sinCuenta.id)).toBe(delOtra);
  });

  it("una sala que no existe o ya se cerró contesta no-existe", async () => {
    expect(await m.mundo.sala("NoExiste").cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).toEqual({ ok: false, motivo: "no-existe" });
    await m.mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: { Authorization: `Bearer ${sala.token}` } });
    expect(await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).toEqual({ ok: false, motivo: "no-existe" });
  });

  it("una generación que no es mayor que la última es vieja, y lo mal escrito es forma", async () => {
    const objeto = m.mundo.sala(sala.id);
    expect((await objeto.cambiarToken(cuenta, huellaDe(TOKEN_B), 3)).ok).toBe(true);
    expect(await objeto.cambiarToken(cuenta, huellaDe(TOKEN_C), 3)).toEqual({ ok: false, motivo: "vieja" });
    expect(await objeto.cambiarToken(cuenta, huellaDe(TOKEN_C), 2)).toEqual({ ok: false, motivo: "vieja" });
    expect(huellaDeLaSala(sala.id)).toBe(huellaDe(TOKEN_B));
    expect(await objeto.cambiarToken(cuenta, "no-es-una-huella", 9)).toEqual({ ok: false, motivo: "forma" });
    expect(await objeto.cambiarToken(cuenta, huellaDe(TOKEN_C), 0)).toEqual({ ok: false, motivo: "forma" });
    expect(await objeto.cambiarToken(cuenta, huellaDe(TOKEN_C), 1.5)).toEqual({ ok: false, motivo: "forma" });
  });

  it("los sockets presentados reciben 4001 y los que todavía no se presentaron no se tocan", async () => {
    const presentado = m.mundo.agregarSocket(sala.id, true);
    const otro = m.mundo.agregarSocket(sala.id, true);
    const sinPresentar = m.mundo.agregarSocket(sala.id, false);
    await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1);
    expect(presentado.cierres).toEqual([{ codigo: 4001, razon: "tomada" }]);
    expect(otro.cierres).toEqual([{ codigo: 4001, razon: "tomada" }]);
    expect(sinPresentar.cierres).toEqual([]);
  });

  it("un socket que cae en el cierre no impide la toma", async () => {
    const roto = m.mundo.agregarSocket(sala.id, true);
    roto.close = () => {
      throw new Error("ya cerrado");
    };
    const bueno = m.mundo.agregarSocket(sala.id, true);
    expect((await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), 1)).ok).toBe(true);
    expect(bueno.cierres).toHaveLength(1);
  });
});

describe("Cupos: preparar y confirmar la toma", () => {
  const cupos = () => m.mundo.cupos();

  it("la primera toma da la generación 1 y anota la huella y la hora", async () => {
    expect(await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_B))).toEqual({ ok: true, gen: 1 });
    expect(m.mundo.ejecutar("cupos", "SELECT evento, gen, huella_gen, ultima_ms, correo_ms FROM tomas")).toEqual([
      { evento: EVENTO, gen: 1, huella_gen: huellaDe(TOKEN_B), ultima_ms: HORA_DE_LA_PRUEBA, correo_ms: 0 },
    ]);
    // Preparar no cambia la huella del evento: eso lo hace confirmar.
    expect(huellaDelEvento()).not.toBe(huellaDe(TOKEN_B));
  });

  it("otra cuenta, un evento que no existe o sin dueña contestan no-existe y no anotan nada", async () => {
    expect(await cupos().prepararToma(Keypair.random().publicKey(), EVENTO, huellaDe(TOKEN_B))).toEqual({ ok: false, motivo: "no-existe" });
    expect(await cupos().prepararToma(cuenta, "evento-que-no-existe", huellaDe(TOKEN_B))).toEqual({ ok: false, motivo: "no-existe" });
    expect(m.mundo.ejecutar("cupos", "SELECT * FROM tomas")).toEqual([]);
  });

  it("la segunda toma antes de 60 segundos da pausa con lo que falta, y a los 60 segundos pasa", async () => {
    await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_B));
    avanzar(20_000);
    expect(await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_C))).toEqual({ ok: false, motivo: "pausa", esperaS: 40 });
    avanzar(PAUSA_ENTRE_TOMAS_MS - 20_000 - 1);
    expect(await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_C))).toMatchObject({ ok: false, motivo: "pausa", esperaS: 1 });
    avanzar(1);
    expect(await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_C))).toEqual({ ok: true, gen: 2 });
    // La pausa que se rechazó no movió la hora de la última.
    expect(m.mundo.ejecutar("cupos", "SELECT ultima_ms FROM tomas")).toEqual([{ ultima_ms: Date.now() }]);
  });

  it("cada campaña tiene su propia pausa", async () => {
    const otra = await crearSala({ evento: "otra-campana-x2" });
    await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_B));
    expect(await cupos().prepararToma(cuenta, "otra-campana-x2", huellaDe(TOKEN_B))).toEqual({ ok: true, gen: 1 });
    expect(otra.id).not.toBe(sala.id);
  });

  it("confirmar guarda la huella del token nuevo en el evento, y un reintento de creación con el token viejo ya no la encuentra", async () => {
    const viejo = huellaDe(sala.token);
    expect(await cupos().salaDelIntento(EVENTO, viejo)).toMatchObject({ sala: sala.id });
    const prep = await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_B));
    expect(prep.ok).toBe(true);
    expect((await m.mundo.sala(sala.id).cambiarToken(cuenta, huellaDe(TOKEN_B), prep.ok ? prep.gen : 0)).ok).toBe(true);
    expect(await cupos().confirmarToma(EVENTO, prep.ok ? prep.gen : 0)).toBe(true);
    expect(huellaDelEvento()).toBe(huellaDe(TOKEN_B));
    expect(await cupos().salaDelIntento(EVENTO, viejo)).toBeNull();
    expect(await cupos().salaDelIntento(EVENTO, huellaDe(TOKEN_B))).toMatchObject({ sala: sala.id });
  });

  it("confirmar una generación que no es la última o que nunca se preparó da falso y no cambia nada", async () => {
    const antes = huellaDelEvento();
    expect(await cupos().confirmarToma(EVENTO, 1)).toBe(false);
    await cupos().prepararToma(cuenta, EVENTO, huellaDe(TOKEN_B));
    expect(await cupos().confirmarToma(EVENTO, 2)).toBe(false);
    expect(huellaDelEvento()).toBe(antes);
  });
});

describe("dos tomas a la vez terminan con la misma huella en la sala y en el evento", () => {
  /** Las dos tomas se preparan una después de la otra (con la pausa en el medio) y sus mensajes llegan en el orden que diga la prueba. */
  const ordenes: [string, number[], number[]][] = [
    ["la sala recibe primero la 1 y confirma primero la 1", [1, 2], [1, 2]],
    ["la sala recibe primero la 2 y confirma primero la 2", [2, 1], [2, 1]],
    ["la sala recibe primero la 1 y confirma primero la 2", [1, 2], [2, 1]],
    ["la sala recibe primero la 2 y confirma primero la 1", [2, 1], [1, 2]],
  ];

  it.each(ordenes)("%s", async (_nombre, enLaSala, alConfirmar) => {
    const huellas = { 1: huellaDe(TOKEN_B), 2: huellaDe(TOKEN_C) } as Record<number, string>;
    const gens: Record<number, number> = {};
    for (const n of [1, 2]) {
      const p = await m.mundo.cupos().prepararToma(cuenta, EVENTO, huellas[n] as string);
      if (!p.ok) throw new Error("no preparó");
      gens[n] = p.gen;
      avanzar(PAUSA_ENTRE_TOMAS_MS);
    }
    expect(gens).toEqual({ 1: 1, 2: 2 });
    const respuestas: Record<number, boolean> = {};
    for (const n of enLaSala) {
      const r = await m.mundo.sala(sala.id).cambiarToken(cuenta, huellas[n] as string, gens[n] as number);
      respuestas[n] = r.ok;
    }
    expect(respuestas).toEqual({ 1: enLaSala[0] === 1, 2: true });
    for (const n of alConfirmar) await m.mundo.cupos().confirmarToma(EVENTO, gens[n] as number);
    expect(huellaDeLaSala(sala.id)).toBe(huellas[2]);
    expect(huellaDelEvento()).toBe(huellas[2]);
    expect(await m.mundo.sala(sala.id).paseDeLaPantalla(TOKEN_C)).toMatchObject({ ok: true });
    expect(await m.mundo.sala(sala.id).paseDeLaPantalla(TOKEN_B)).toMatchObject({ ok: false });
  });
});

describe("la toma con un SQLite suelto", () => {
  it("preparar, confirmar y la dueña desde la lista de la cuenta cuando todavía no hay sala", () => {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
    crearTablasDeActivar(sql);
    const A = Keypair.random().publicKey();
    guardarCampanaDeCuenta(sql, {
      cuenta: A,
      evento: EVENTO,
      texto: "{}",
      firma: "f",
      empresa: "Casa",
      zona: "America/La_Paz",
      abreMs: 1,
      cierraMs: 2,
      sorteoMs: HORA_DE_LA_PRUEBA,
      ahora: HORA_DE_LA_PRUEBA,
    });
    expect(prepararToma(sql, { cuenta: A, evento: EVENTO, huellaNueva: "h".repeat(64), ahora: HORA_DE_LA_PRUEBA })).toEqual({ ok: true, gen: 1 });
    // Sin sala no hay huella que guardar, pero la generación sigue su cuenta.
    expect(confirmarToma(sql, { evento: EVENTO, gen: 1 })).toBe(true);
    expect(prepararToma(sql, { cuenta: A, evento: EVENTO, huellaNueva: "i".repeat(64), ahora: HORA_DE_LA_PRUEBA + PAUSA_ENTRE_TOMAS_MS })).toEqual({ ok: true, gen: 2 });
  });

  it("las tomas de una campaña vencida se van con ella", () => {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = (consulta, ...parametros) => db.prepare(consulta).all(...parametros) as never;
    crearTablasDeActivar(sql);
    const A = Keypair.random().publicKey();
    guardarCampanaDeCuenta(sql, {
      cuenta: A, evento: EVENTO, texto: "{}", firma: "f", empresa: "Casa", zona: "America/La_Paz", abreMs: 1, cierraMs: 2, sorteoMs: HORA_DE_LA_PRUEBA, ahora: HORA_DE_LA_PRUEBA,
    });
    prepararToma(sql, { cuenta: A, evento: EVENTO, huellaNueva: "h".repeat(64), ahora: HORA_DE_LA_PRUEBA });
    expect(sql("SELECT * FROM tomas")).toHaveLength(1);
    expect(prepararToma(sql, { cuenta: A, evento: EVENTO, huellaNueva: "h".repeat(64), ahora: HORA_DE_LA_PRUEBA + 31 * 86_400_000 })).toEqual({ ok: false, motivo: "no-existe" });
    expect(sql("SELECT * FROM tomas")).toHaveLength(0);
  });
});
