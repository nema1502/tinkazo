/**
 * El acceso automático de quien organiza una campaña, sin Cloudflare: `PuertaAltas.organizadora` con el SQLite de prueba, la
 * configuración de sus variables y la puerta del Worker (`atenderOrganizadora`) con un objeto de mentira. Las cuentas son inventadas.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { atenderOrganizadora, esLaSala, leerPedidoDeOrganizadora } from "./acceso-organizadora";
import { T0, codigo, montarAltas } from "./altas-prueba";
import { DIA_MS, leerConfig } from "./config";
import { AJUSTE_PAUSA } from "./rutas-altas";
import { sqlQueFallaEn } from "./sqlite-prueba";

const EVENTO = "mi-campana-ab12";
const cuentaNueva = () => Keypair.random().publicKey();
const SECRETO = "s".repeat(40);

/** Lo que pide la sala. */
const pide = (m: ReturnType<typeof montarAltas>, cuenta: string, evento = EVENTO) => m.puerta.organizadora({ cuenta, evento });
const filas = (m: ReturnType<typeof montarAltas>, tabla: string) => m.sql.exec(`SELECT * FROM ${tabla}`).toArray();

describe("el acceso de quien organiza una campaña", () => {
  it("admite a la cuenta: 200, en el libro y con 3 sorteos por 7 días", async () => {
    const m = montarAltas();
    const cuenta = cuentaNueva();
    expect(await pide(m, cuenta)).toEqual({ estado: 200, cuerpo: { ok: true, ya: false } });
    expect(m.cupos.estaEnElLibro(cuenta)).toBe(true);
    expect(m.cupos.quedan({ cuenta }, T0)).toMatchObject({ quedan: 3, proximoVence: { fecha: T0 + 7 * DIA_MS, cuantos: 3 } });
  });

  it("queda en el mismo libro que el alta por cupón: alta cuenta:G con motivo admin, derecho con ref campana: y origen campana", async () => {
    const m = montarAltas();
    const cuenta = cuentaNueva();
    await pide(m, cuenta);
    const alta = { usuario: `cuenta:${cuenta}`, motivo: "admin", ref: `campana:${EVENTO}`, cuenta, estado: "autorizada", creada: T0 };
    expect(filas(m, "altas")).toMatchObject([alta]);
    expect(filas(m, "cuenta_app")).toMatchObject([{ cuenta, motivo: "admin", permanente: 1 }]);
    expect(filas(m, "derechos")).toMatchObject([
      { usuario: `cuenta:${cuenta}`, cuenta, origen: "campana", ref: `campana:${EVENTO}`, sorteos: 3, usados: 0, creado: T0, vence: T0 + 7 * DIA_MS },
    ]);
  });

  it("la cuenta que ya existe en la red entra como abierta, sin activación pendiente", async () => {
    const m = montarAltas();
    const cuenta = cuentaNueva();
    m.abiertas.add(cuenta);
    await pide(m, cuenta);
    expect(m.cupos.altaDeCuenta(cuenta)).toMatchObject({ estado: "abierta" });
  });

  it("el mismo evento con la misma cuenta es idempotente: ya true y no suma nada", async () => {
    const m = montarAltas();
    const cuenta = cuentaNueva();
    await pide(m, cuenta);
    const antes = JSON.stringify([filas(m, "altas"), filas(m, "derechos")]);
    m.mover(5000);
    expect(await pide(m, cuenta)).toEqual({ estado: 200, cuerpo: { ok: true, ya: true } });
    expect(JSON.stringify([filas(m, "altas"), filas(m, "derechos")])).toBe(antes);
    expect(filas(m, "cuenta_app")).toHaveLength(1);
    expect(m.cupos.quedan({ cuenta }, m.hora()).quedan).toBe(3);
  });

  it("el mismo evento con otra cuenta da 409 evento-usado y no escribe nada", async () => {
    const m = montarAltas();
    await pide(m, cuentaNueva());
    const otra = cuentaNueva();
    expect(await pide(m, otra)).toEqual({ estado: 409, cuerpo: { motivo: "evento-usado" } });
    expect(m.cupos.estaEnElLibro(otra)).toBe(false);
    expect(filas(m, "derechos")).toHaveLength(1);
  });

  it("otro evento de la misma cuenta suma otros 3 sorteos", async () => {
    const m = montarAltas();
    const cuenta = cuentaNueva();
    await pide(m, cuenta, "campana-uno-aaaa");
    await pide(m, cuenta, "campana-dos-bbbb");
    expect(m.cupos.quedan({ cuenta }, T0).quedan).toBe(6);
    expect(filas(m, "altas")).toHaveLength(1);
  });

  it("si la cuenta ya tenía alta de cupón, los sorteos van a esa alta y no nace otra", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([codigo(1)]);
    await m.cupon(ana.token, codigo(1));
    expect(await pide(m, ana.cuenta as string)).toMatchObject({ estado: 200, cuerpo: { ok: true, ya: false } });
    expect(filas(m, "altas")).toHaveLength(1);
    expect(filas(m, "derechos")).toMatchObject([
      { usuario: "usr_ana", origen: "cupon" },
      { usuario: "usr_ana", origen: "campana" },
    ]);
    expect(m.cupos.quedan({ cuenta: ana.cuenta as string }, T0).quedan).toBe(6);
  });

  it("respeta ORGANIZADORA_SORTEOS y ORGANIZADORA_DIAS", async () => {
    const m = montarAltas({ ORGANIZADORA_SORTEOS: "5", ORGANIZADORA_DIAS: "2" });
    const cuenta = cuentaNueva();
    await pide(m, cuenta);
    expect(m.cupos.quedan({ cuenta }, T0)).toMatchObject({ quedan: 5, proximoVence: { fecha: T0 + 2 * DIA_MS, cuantos: 5 } });
  });

  it("con el tope del día lleno da 429 cupo con la hora en que se libera, y pasadas 24 horas vuelve a admitir", async () => {
    const m = montarAltas({ ORGANIZADORAS_DIA: "2" });
    await pide(m, cuentaNueva(), "campana-uno-aaaa");
    m.mover(60_000);
    await pide(m, cuentaNueva(), "campana-dos-bbbb");
    const otra = cuentaNueva();
    expect(await pide(m, otra, "campana-tres-cccc")).toEqual({ estado: 429, cuerpo: { motivo: "cupo", liberaEn: T0 + DIA_MS } });
    expect(m.cupos.estaEnElLibro(otra)).toBe(false);
    m.mover(DIA_MS - 60_000 + 1);
    expect(await pide(m, otra, "campana-tres-cccc")).toMatchObject({ estado: 200 });
  });

  it("con el tope lleno, repetir un evento ya admitido sigue dando 200 ya true", async () => {
    const m = montarAltas({ ORGANIZADORAS_DIA: "1" });
    const cuenta = cuentaNueva();
    await pide(m, cuenta);
    expect(await pide(m, cuentaNueva(), "otra-campana-xxxx")).toMatchObject({ estado: 429 });
    expect(await pide(m, cuenta)).toEqual({ estado: 200, cuerpo: { ok: true, ya: true } });
  });

  it("el tope del día no cuenta los sorteos de altas a mano", async () => {
    const m = montarAltas({ ORGANIZADORAS_DIA: "1" });
    const aMano = { cuenta: cuentaNueva(), sorteos: 3, dias: 30, ref: "a-mano", abierta: false, techoAltas: 10, techoSorteos: 100 };
    m.altas.admitirAMano(aMano, T0);
    expect(await pide(m, cuentaNueva())).toMatchObject({ estado: 200 });
  });

  it("con el piso de créditos sin cubrir da 503 apagada con detalle pausa y no escribe nada", async () => {
    const m = montarAltas();
    m.pm.creditos = 0;
    const cuenta = cuentaNueva();
    expect(await pide(m, cuenta)).toEqual({ estado: 503, cuerpo: { motivo: "apagada", detalle: "pausa" } });
    expect(m.cupos.estaEnElLibro(cuenta)).toBe(false);
    expect(filas(m, "derechos")).toEqual([]);
  });

  it("con las altas pausadas a mano da 503 apagada", async () => {
    const m = montarAltas();
    m.cupos.fijarAjuste(AJUSTE_PAUSA, "1", T0);
    expect(await pide(m, cuentaNueva())).toEqual({ estado: 503, cuerpo: { motivo: "apagada", detalle: "pausa" } });
  });

  it("sin la llave de Pollar da 503 apagada", async () => {
    const m = montarAltas({}, { sinPollar: true });
    expect(await pide(m, cuentaNueva())).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
  });

  it("con una variable mal escrita da 503 apagada", async () => {
    const m = montarAltas({ ORGANIZADORAS_DIA: "treinta" });
    expect(await pide(m, cuentaNueva())).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
  });

  it("es todo o nada: si falla al escribir el derecho no queda ni el alta ni la cuenta en el libro", async () => {
    const m = montarAltas({}, { sql: sqlQueFallaEn(/INSERT INTO derechos/) });
    const cuenta = cuentaNueva();
    await expect(pide(m, cuenta)).rejects.toThrow();
    expect(filas(m, "altas")).toEqual([]);
    expect(m.cupos.estaEnElLibro(cuenta)).toBe(false);
  });

  it("un pedido mal armado es un error del código y no escribe", () => {
    const m = montarAltas();
    const p = { sorteos: 3, dias: 7, topeDia: 30, abierta: false };
    expect(() => m.altas.admitirOrganizadora({ ...p, cuenta: "no-es-una-cuenta", evento: EVENTO }, T0)).toThrow("organizadora-cuenta");
    expect(() => m.altas.admitirOrganizadora({ ...p, cuenta: cuentaNueva(), evento: "" }, T0)).toThrow("organizadora-forma");
    expect(filas(m, "derechos")).toEqual([]);
  });
});

describe("las variables del acceso de quien organiza", () => {
  const base = { RED: "mainnet", ALTAS: "1" };

  it("vacías valen 3 sorteos, 7 días y 30 cuentas por día, sin anotar nada", () => {
    const cfg = leerConfig(base);
    expect(cfg.organizadoras).toEqual({ sorteos: 3, dias: 7, porDia: 30 });
    expect(cfg.faltaAltas).not.toContain("organizadoras");
  });

  it("se leen con dígitos", () => {
    const cfg = leerConfig({ ...base, ORGANIZADORA_SORTEOS: "2", ORGANIZADORA_DIAS: "14", ORGANIZADORAS_DIA: "60" });
    expect(cfg.organizadoras).toEqual({ sorteos: 2, dias: 14, porDia: 60 });
  });

  it("fuera de rango, con coma, con signo o con letras apagan el acceso y se anotan", () => {
    const malos = [
      { ORGANIZADORA_SORTEOS: "0" },
      { ORGANIZADORA_SORTEOS: "11" },
      { ORGANIZADORA_DIAS: "31" },
      { ORGANIZADORAS_DIA: "301" },
      { ORGANIZADORAS_DIA: "1,5" },
      { ORGANIZADORA_DIAS: "-7" },
      { ORGANIZADORA_SORTEOS: "tres" },
    ];
    for (const mal of malos) {
      const cfg = leerConfig({ ...base, ...mal });
      expect(cfg.organizadoras, JSON.stringify(mal)).toBeNull();
      expect(cfg.faltaAltas, JSON.stringify(mal)).toContain("organizadoras");
    }
  });

  it("sin ALTAS o fuera de mainnet no hay acceso, aunque las variables estén", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "0", ORGANIZADORA_SORTEOS: "3" }).organizadoras).toBeNull();
    expect(leerConfig({ RED: "testnet", ALTAS: "1", ORGANIZADORA_SORTEOS: "3" }).organizadoras).toBeNull();
  });

  it("sin ALTAS una variable mal escrita no se anota: la ruta no existe para nadie", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "0", ORGANIZADORA_SORTEOS: "tres" }).faltaAltas).not.toContain("organizadoras");
  });
});

describe("leer el pedido", () => {
  it("lee una cuenta G y un evento con la forma de siempre", () => {
    const cuenta = cuentaNueva();
    expect(leerPedidoDeOrganizadora({ cuenta, evento: EVENTO })).toEqual({ cuenta, evento: EVENTO });
  });

  it("rechaza lo que no es una cuenta G válida", () => {
    // La última letra distinta de la que ya tiene: con una cuenta al azar que termina en A, cambiarla por A la dejaba válida.
    const valida = cuentaNueva();
    const sinSuma = `${valida.slice(0, -1)}${valida.endsWith("A") ? "B" : "A"}`;
    const malas = [undefined, 7, "", "G", sinSuma, "M".padEnd(69, "A"), cuentaNueva().toLowerCase()];
    for (const cuenta of malas) {
      expect(leerPedidoDeOrganizadora({ cuenta, evento: EVENTO }), String(cuenta)).toBeNull();
    }
  });

  it("rechaza un evento vacío o con otra forma", () => {
    const malos = [undefined, 5, "", "ab", "Mayusculas-aaaa", "con espacio", "-empieza", "termina-", "a".repeat(41)];
    for (const evento of malos) {
      expect(leerPedidoDeOrganizadora({ cuenta: cuentaNueva(), evento }), String(evento)).toBeNull();
    }
  });

  it("rechaza lo que no es un objeto", () => {
    const cosas = [null, undefined, "x", 3, [], [{ cuenta: cuentaNueva(), evento: EVENTO }]];
    for (const x of cosas) expect(leerPedidoDeOrganizadora(x), JSON.stringify(x)).toBeNull();
  });
});

describe("quién llama: el secreto de la sala", () => {
  it("acepta el secreto igual y rechaza otro, uno vacío o ninguno", async () => {
    expect(await esLaSala(SECRETO, SECRETO)).toBe(true);
    expect(await esLaSala(`${SECRETO}x`, SECRETO)).toBe(false);
    expect(await esLaSala("", SECRETO)).toBe(false);
    expect(await esLaSala(null, SECRETO)).toBe(false);
  });

  it("sin secreto cargado, o de menos de 32 caracteres, nadie pasa ni con el mismo texto", async () => {
    expect(await esLaSala("corto", "corto")).toBe(false);
    expect(await esLaSala("x", undefined)).toBe(false);
    expect(await esLaSala("", "")).toBe(false);
  });
});

describe("la puerta del Worker", () => {
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1" });
  const llamadas: unknown[] = [];
  const objeto = async (p: unknown) => {
    llamadas.push(p);
    return { estado: 200, cuerpo: { ok: true, ya: false } };
  };
  const cuenta = cuentaNueva();
  const req = (o: { metodo?: string; secreto?: string | null; cuerpo?: string; ruta?: string } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (o.secreto !== null) headers["x-sala-secreto"] = o.secreto ?? SECRETO;
    const metodo = o.metodo ?? "POST";
    const cuerpo = o.cuerpo ?? JSON.stringify({ cuenta, evento: EVENTO });
    const url = `https://pm.tinkazo.app${o.ruta ?? "/v1/alta/organizadora"}`;
    return new Request(url, { method: metodo, headers, ...(metodo === "GET" ? {} : { body: cuerpo }) });
  };
  /** `secreto` es el SALA_SECRETO del Worker: `null` es que no está puesto. */
  const correr = async (r: Request, c = cfg, secreto: string | null = SECRETO) => {
    llamadas.length = 0;
    const res = await atenderOrganizadora(r, c, secreto ?? undefined, objeto);
    return res ? { estado: res.status, cuerpo: await res.json() } : null;
  };

  it("con el secreto bueno y el cuerpo bien hecho llega al objeto y devuelve lo suyo", async () => {
    expect(await correr(req())).toEqual({ estado: 200, cuerpo: { ok: true, ya: false } });
    expect(llamadas).toEqual([{ cuenta, evento: EVENTO }]);
  });

  it("con el secreto malo da 401 secreto y no llega al objeto", async () => {
    expect(await correr(req({ secreto: "x".repeat(40) }))).toEqual({ estado: 401, cuerpo: { motivo: "secreto" } });
    expect(llamadas).toEqual([]);
  });

  it("sin la cabecera del secreto da 401 secreto y no llega al objeto", async () => {
    expect(await correr(req({ secreto: null }))).toEqual({ estado: 401, cuerpo: { motivo: "secreto" } });
    expect(llamadas).toEqual([]);
  });

  it("sin SALA_SECRETO puesto contesta 503 apagada aunque la cabecera traiga algo", async () => {
    expect(await correr(req(), cfg, null)).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
    expect(llamadas).toEqual([]);
  });

  it("con SALA_SECRETO de menos de 32 caracteres contesta 503 apagada aunque coincida", async () => {
    expect(await correr(req({ secreto: "corto" }), cfg, "corto")).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
    expect(llamadas).toEqual([]);
  });

  it("sin ALTAS contesta 503 apagada", async () => {
    expect(await correr(req(), leerConfig({ RED: "mainnet", ALTAS: "0" }))).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
  });

  it("con una variable mal escrita contesta 503 apagada", async () => {
    const mal = leerConfig({ RED: "mainnet", ALTAS: "1", ORGANIZADORA_DIAS: "0" });
    expect(await correr(req(), mal)).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
  });

  it("una cuenta inválida da 400 forma", async () => {
    expect(await correr(req({ cuerpo: JSON.stringify({ cuenta: "GABC", evento: EVENTO }) }))).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
    expect(llamadas).toEqual([]);
  });

  it("un evento vacío da 400 forma", async () => {
    expect(await correr(req({ cuerpo: JSON.stringify({ cuenta, evento: "" }) }))).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
  });

  it("un cuerpo que no es JSON da 400 forma", async () => {
    expect(await correr(req({ cuerpo: "no es json" }))).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
  });

  it("un cuerpo demasiado grande da 400 forma", async () => {
    const grande = JSON.stringify({ cuenta, evento: EVENTO, relleno: "x".repeat(2000) });
    expect(await correr(req({ cuerpo: grande }))).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
  });

  it("otro método da 405", async () => {
    expect(await correr(req({ metodo: "GET" }))).toEqual({ estado: 405, cuerpo: { motivo: "metodo" } });
  });

  it("en testnet la puerta no existe", async () => {
    expect(await correr(req(), leerConfig({ RED: "testnet", ALTAS: "1" }))).toBeNull();
  });

  it("en otra ruta de altas la puerta no se mete", async () => {
    expect(await correr(req({ ruta: "/v1/alta/cupon" }))).toBeNull();
  });

  it("un error del objeto sale como 500 interno, sin detalle", async () => {
    const res = await atenderOrganizadora(req(), cfg, SECRETO, async () => {
      throw new Error(`falla con ${cuenta}`);
    });
    expect(res?.status).toBe(500);
    expect(await res?.text()).toBe(JSON.stringify({ motivo: "interno" }));
  });

  it("pasa lo que contesta el objeto, con su estado (429 cupo)", async () => {
    const lleno = async () => ({ estado: 429, cuerpo: { motivo: "cupo", liberaEn: 5 } });
    const res = await atenderOrganizadora(req(), cfg, SECRETO, lleno);
    expect({ estado: res?.status, cuerpo: await res?.json() }).toEqual({ estado: 429, cuerpo: { motivo: "cupo", liberaEn: 5 } });
  });
});
