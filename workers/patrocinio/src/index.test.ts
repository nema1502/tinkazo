/**
 * El Worker y el objeto del portero enteros, sin Cloudflare: el módulo `cloudflare:workers` se reemplaza por una clase vacía, el
 * SQLite es el de prueba, el reloj es solo el de la fecha y el `fetch` es uno de mentira que hace de RPC y de Horizon. Lo que se
 * mira es lo que une las piezas: la puerta, el objeto, la alarma por partes, los bloques de `/cupo` y `/estado` y el exporte.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA_DE_PRUEBA, armarPago, type VariantePago } from "./armar-pago";
import { EMISOR_USDC } from "./cobros";
import { Portero } from "./servicio";
import { sqlDePrueba, sqlQueFallaEn } from "./sqlite-prueba";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));

// Lo que se importa después del mock: el Worker y su objeto.
const { default: trabajador, Patrocinio } = await import("./index");

const T0 = AHORA_DE_PRUEBA * 1000;
const llave = Keypair.random();
const patrocinadora = Keypair.random();
const COBROS = Keypair.random().publicKey();
const SITIO = "https://tinkazo.app";
/** Con la llave de la sesión el portero atiende el alta de quien ganó: sin ella la ruta contesta 503 apagado config. */
const CON_SESION = { POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000" };

// ---------- el mundo de mentira ----------

const linea = {
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: EMISOR_USDC,
  balance: "100.0000000",
  limit: "922337203685.4775807",
  buying_liabilities: "0.0000000",
  selling_liabilities: "0.0000000",
  is_authorized: true,
};
const nativo = { asset_type: "native", balance: "0.0000000", buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" };

/** Lo que contesta la red: ninguna cuenta existe, todo envío se toma y una transacción solo entra si se dice. */
const mundo = { entraron: new Map<string, "SUCCESS" | "FAILED">() };

function rpcDe(metodo: string, params: { hash?: string }): unknown {
  switch (metodo) {
    case "getLedgerEntries":
      return { entries: null };
    case "sendTransaction":
      return { status: "PENDING" };
    case "getTransaction":
      return { status: (params.hash && mundo.entraron.get(params.hash)) ?? "NOT_FOUND" };
    default:
      throw new Error(`el RPC de mentira no sabe ${metodo}`);
  }
}

async function fetchDeMentira(url: string | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url));
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  if (u.hostname === "horizon.stellar.org") {
    return /^\/accounts\//.test(u.pathname) ? json({ id: "G", balances: [nativo, linea], data: {} }) : json({}, 404);
  }
  const pedido = JSON.parse(String(init?.body)) as { method: string; params: { hash?: string } };
  return json({ jsonrpc: "2.0", id: 1, result: rpcDe(pedido.method, pedido.params) });
}

function montar(extra: Record<string, unknown> = {}, sql = sqlDePrueba()) {
  let alarma: number | null = null;
  const puestas: number[] = [];
  const ctx = {
    storage: {
      sql: { exec: (consulta: string, ...enlaces: unknown[]) => sql.exec(consulta, ...enlaces) },
      transactionSync: <T>(fn: () => T): T => sql.transaccion(fn),
      getAlarm: async () => alarma,
      setAlarm: async (ms: number) => {
        alarma = ms;
        puestas.push(ms);
      },
    },
  };
  const env: Record<string, unknown> = {
    RED: "mainnet",
    ALTAS: "1",
    POLLAR_APP_ID: "app_x",
    CUENTA_PATROCINADORA: patrocinadora.publicKey(),
    CLAVE_PATROCINADOR: llave.secret(),
    CUENTA_COBROS: COBROS,
    COSTO_RETIRO: "0.50",
    ADMIN_TOKEN: "o".repeat(40),
    CUPON_SECRETO: "c".repeat(32),
    POR_IP_POR_HORA: "600",
    PAGOS_PREMIO: "1",
    RETIROS: "1",
    ...extra,
  };
  const objeto = new Patrocinio(ctx as never, env as never);
  env.PATROCINIO = { idFromName: (nombre: string) => nombre, get: () => objeto };
  return { sql, objeto, env, alarma: () => alarma, puestas };
}
type Montaje = ReturnType<typeof montar>;

let ip = 0;
/** Una dirección distinta en cada prueba: los contadores del Worker viven en la memoria del módulo. */
const otraIp = () => `190.129.${++ip}.20`;

function pedido(ruta: string, o: { metodo?: string; cuerpo?: unknown; ip?: string } = {}): Request {
  const metodo = o.metodo ?? "POST";
  const cuerpo = o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo);
  const headers = { Origin: SITIO, "Content-Type": "application/json", "CF-Connecting-IP": o.ip ?? otraIp() };
  return new Request(`https://pm.tinkazo.app${ruta}`, { method: metodo, headers, ...(cuerpo !== undefined && metodo !== "GET" ? { body: cuerpo } : {}) });
}

const correr = async (m: Montaje, req: Request) => {
  const r = await trabajador.fetch(req, m.env as never);
  return { estado: r.status, cuerpo: await r.json().catch(() => null) as Record<string, unknown> | null };
};

const retiro = (o: Partial<VariantePago> = {}) => armarPago({ firmante: Keypair.random(), forma: "retiro", cobros: COBROS, ...o });

/** Deja correr lo que el objeto lanzó sin esperar (la alarma que se pide al reservar). */
const vaciar = () => new Promise<void>((listo) => setTimeout(listo, 0));

const estadoDe = async (m: Montaje) => (await m.objeto.administrar("estado")).cuerpo;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchDeMentira);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  mundo.entraron.clear();
  // La bitácora y los avisos de configuración salen por la consola: acá no se miran.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- la puerta ----------

describe("la puerta del Worker para el alta de quien ganó", () => {
  const cuerpo = { sorteo: "5", puesto: 1, cuenta: Keypair.random().publicKey() };

  it("con ALTAS_PREMIO apagada la ruta no existe: 404 no-existe, como hoy", async () => {
    const m = montar({ ALTAS_PREMIO: "0" });
    expect(await correr(m, pedido("/v1/alta/premio", { cuerpo }))).toEqual({ estado: 404, cuerpo: { motivo: "no-existe" } });
  });

  it("con ALTAS_PREMIO prendida la ruta llega al objeto: sin la llave de la sesión contesta 503 apagado config, no 404", async () => {
    const m = montar({ ALTAS_PREMIO: "1" });
    expect(await correr(m, pedido("/v1/alta/premio", { cuerpo }))).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "config" } });
  });

  it("en la red de prueba la ruta tampoco existe, aunque la variable diga que sí", async () => {
    const m = montar({ RED: "testnet", ALTAS_PREMIO: "1" });
    expect((await correr(m, pedido("/v1/alta/premio", { cuerpo }))).estado).toBe(404);
  });
});

describe("la puerta del Worker para los pagos", () => {
  it("con las dos formas apagadas la ruta no existe: el POST da 404 no-existe y el OPTIONS el 204 de siempre", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    expect(await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr } }))).toEqual({ estado: 404, cuerpo: { motivo: "no-existe" } });
    expect((await trabajador.fetch(pedido("/v1/patrocinio/pago", { metodo: "OPTIONS" }), m.env as never)).status).toBe(204);
    expect((await correr(m, pedido("/v1/patrocinio/pago", { metodo: "GET" }))).estado).toBe(404);
  });

  it("en la red de prueba la ruta tampoco existe, aunque las variables digan que sí", async () => {
    const m = montar({ RED: "testnet" });
    expect(await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr } }))).toEqual({ estado: 404, cuerpo: { motivo: "no-existe" } });
  });

  it("con alguna forma prendida un retiro se paga de punta a punta, con CORS", async () => {
    const m = montar();
    const t = retiro();
    const r = await trabajador.fetch(pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: t.xdr } }), m.env as never);
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(SITIO);
    expect(await r.json()).toEqual({ hash: t.hash, forma: "retiro", vence: AHORA_DE_PRUEBA + 240, status: "PENDING", estado: "en-camino" });
    await vaciar();
    expect(m.alarma()).not.toBeNull();
  });

  it("(ataque) el contador por dirección es propio: agotar el de los sellos no frena los pagos", async () => {
    const m = montar({ POR_IP_POR_HORA: "2" });
    const direccion = otraIp();
    const sello = () => correr(m, pedido("/v1/patrocinio", { cuerpo: { xdr: "" }, ip: direccion }));
    const pago = () => correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr }, ip: direccion }));
    await sello();
    await sello();
    expect((await sello()).estado).toBe(429);
    expect((await pago()).estado).toBe(200);
    expect((await pago()).estado).toBe(200);
    expect(await pago()).toEqual({ estado: 429, cuerpo: { motivo: "cupo-ip" } });
  });

  it("(ataque) el contador por dirección es propio: agotar el de los pagos no frena los sellos ni el cupo", async () => {
    const m = montar({ POR_IP_POR_HORA: "2" });
    const direccion = otraIp();
    const pago = () => correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr }, ip: direccion }));
    expect((await pago()).estado).toBe(200);
    expect((await pago()).estado).toBe(200);
    expect(await pago()).toEqual({ estado: 429, cuerpo: { motivo: "cupo-ip" } });
    // El sello pasa su contador y llega a mirar el sobre (vacío): no es el 429 de la dirección.
    expect(await correr(m, pedido("/v1/patrocinio", { cuerpo: { xdr: "" }, ip: direccion }))).toEqual({
      estado: 400,
      cuerpo: { motivo: "no-permitida", razon: "xdr", detalle: "vacio" },
    });
    expect((await correr(m, pedido(`/v1/patrocinio/cupo?cuenta=${Keypair.random().publicKey()}`, { metodo: "GET", ip: direccion }))).estado).toBe(200);
  });
});

// ---------- /cupo y /estado ----------

describe("los bloques de /cupo y /estado", () => {
  it("con todo apagado no cambian: ni bloque pagos ni clave nueva", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    const cuenta = Keypair.random().publicKey();
    const cupo = await m.objeto.cupo(cuenta);
    expect(cupo.estado).toBe(200);
    expect(Object.keys(cupo.cuerpo)).not.toContain("pagos");
    // Es exactamente lo que contesta el portero de los sellos.
    const portero = await (m.objeto as unknown as { obtener(): Promise<Portero> }).obtener();
    expect(cupo).toEqual(await portero.cupoDe(cuenta));
    const estado = await estadoDe(m);
    expect(Object.keys(estado)).not.toContain("pagos");
    expect(Object.keys(estado)).not.toContain("firmasPagos");
    expect(Object.keys(estado)).toEqual(expect.arrayContaining(["modo", "firmasSinExplicar", "firmas", "patrocinioPollar"]));
  });

  it("con todo apagado, /cupo, /estado, el exporte y la alarma son los de un objeto sin ninguna pieza de los pagos ni del alta", async () => {
    const conPiezas = montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "0" });
    const cuenta = Keypair.random().publicKey();
    const cupo = await conPiezas.objeto.cupo(cuenta);
    const estado = await estadoDe(conPiezas);
    const exporte = (await conPiezas.objeto.administrar("exportar")).cuerpo;
    await conPiezas.objeto.alarm();
    // El objeto de antes: sin las tablas, sin el portero de los pagos, sin el reconocimiento del costo en los cobros y sin la
    // tabla del alta de quien ganó.
    vi.spyOn(Patrocinio.prototype as unknown as { armarPagos(): void }, "armarPagos").mockImplementation(() => {});
    vi.spyOn(Patrocinio.prototype as unknown as { armarAltaPremio(): void }, "armarAltaPremio").mockImplementation(() => {});
    const sinPiezas = montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "0" });
    expect(await sinPiezas.objeto.cupo(cuenta)).toEqual(cupo);
    // Que la comparación no sea de un objeto consigo mismo: uno tiene las tablas nuevas y el otro no.
    const nuevas = "SELECT name FROM sqlite_master WHERE name IN ('pagos_portero', 'altas_premio') ORDER BY name";
    const tablas = (o: Montaje) => o.sql.exec(nuevas).toArray();
    expect(tablas(conPiezas)).toEqual([{ name: "altas_premio" }, { name: "pagos_portero" }]);
    expect(tablas(sinPiezas)).toEqual([]);
    expect(await estadoDe(sinPiezas)).toEqual(estado);
    expect((await sinPiezas.objeto.administrar("exportar")).cuerpo).toEqual(exporte);
    await sinPiezas.objeto.alarm();
    expect(conPiezas.puestas).toEqual(sinPiezas.puestas);
    // La vuelta de la alarma no dejó ninguna línea nueva en la bitácora.
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("alarma-pagos"));
  });

  it("con las formas prendidas /cupo suma el bloque pagos con lo que está en curso, y /estado el suyo con el pago en el aire", async () => {
    const m = montar();
    const org = Keypair.random();
    const t = retiro({ firmante: org });
    await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: t.xdr } }));
    const cupo = await m.objeto.cupo(org.publicKey());
    expect(cupo.cuerpo).toMatchObject({
      pagos: { premio: true, retiro: true, altaPremio: false, costoRetiro: { usdc: "0.50", monto: 5_000_000 }, enCurso: { hash: t.hash, forma: "retiro", vence: AHORA_DE_PRUEBA + 240 } },
    });
    const estado = await estadoDe(m);
    expect(estado).toMatchObject({
      pagos: { retiro: { prendido: true, pausado: false, enElAire: 1, costo: { usdc: "0.50", monto: 5_000_000 } }, gasto24h: 30_000 },
      firmasPagos: { premios: 0, retiros: 0 },
    });
  });

  it("con solo el alta de quien ganó prendida, /cupo suma el bloque pagos con ella en true y las otras dos formas en false", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "1", ...CON_SESION });
    const cupo = await m.objeto.cupo(Keypair.random().publicKey());
    expect(cupo.cuerpo).toMatchObject({ pagos: { premio: false, retiro: false, altaPremio: true, costoRetiro: null, enCurso: null } });
    expect(await estadoDe(m)).toMatchObject({ pagos: { altaPremio: { prendido: true, pausado: false, hoy: 0 } } });
  });

  it("sin la llave de la sesión el portero no atiende el alta de quien ganó: /cupo dice false aunque la variable esté prendida", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "1" });
    expect((await m.objeto.cupo(Keypair.random().publicKey())).cuerpo).toMatchObject({ pagos: { altaPremio: false } });
  });

  it("con el alta de quien ganó pausada, /cupo dice false y /estado muestra la pausa", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "1", ...CON_SESION });
    const cuenta = Keypair.random().publicKey();
    expect((await m.objeto.cupo(cuenta)).cuerpo).toMatchObject({ pagos: { altaPremio: true } });
    m.sql.exec("INSERT OR REPLACE INTO ajustes (clave, valor, cambiado) VALUES ('altas_premio_pausado', '1', ?)", T0);
    expect((await m.objeto.cupo(cuenta)).cuerpo).toMatchObject({ pagos: { altaPremio: false } });
    expect(await estadoDe(m)).toMatchObject({ pagos: { altaPremio: { prendido: true, pausado: true, hoy: 0 } } });
  });

  it("/estado cuenta las altas de quien ganó de las últimas 24 horas, sin cuentas", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0", ALTAS_PREMIO: "1" });
    await m.objeto.administrar("estado");
    const alta = "INSERT INTO altas_premio (contrato, sorteo, puesto, cuenta, organizador, sello, ms) VALUES ('C', '5', ?, 'G1', 'G2', 'S', ?)";
    m.sql.exec(alta, 0, T0 - 1000);
    m.sql.exec(alta, 1, T0 - 2 * 86_400_000);
    const estado = await estadoDe(m);
    expect(estado).toMatchObject({ pagos: { altaPremio: { prendido: true, hoy: 1 } } });
    expect(JSON.stringify(estado)).not.toContain("G1");
  });

  it("con el alta de quien ganó prendida y los pagos en su sitio, /cupo trae las tres formas", async () => {
    const m = montar({ ALTAS_PREMIO: "1", ...CON_SESION });
    expect((await m.objeto.cupo(Keypair.random().publicKey())).cuerpo).toMatchObject({ pagos: { premio: true, retiro: true, altaPremio: true } });
  });

  it("una cuenta que no se entiende no rompe el cupo: 400 como siempre, sin bloque", async () => {
    const m = montar();
    expect(await m.objeto.cupo("esto no es una cuenta")).toEqual({ estado: 400, cuerpo: { motivo: "cuenta" } });
  });

  it("pausada una forma, /estado muestra el bloque aunque no haya variables prendidas", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    expect(Object.keys(await estadoDe(m))).not.toContain("pagos");
    m.sql.exec("INSERT OR REPLACE INTO ajustes (clave, valor, cambiado) VALUES ('retiros_pausado', '1', ?)", T0);
    expect(await estadoDe(m)).toMatchObject({ pagos: { retiro: { prendido: false, pausado: true }, premio: { pausado: false } } });
  });
});

// ---------- el exporte ----------

describe("el exporte", () => {
  it("en mainnet suma las dos tablas de los pagos, y las otras quedan como están", async () => {
    const m = montar();
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown[]>;
    expect(tablas.pagos_portero).toEqual([]);
    expect(tablas.retiros_cobrados).toEqual([]);
    expect(Object.keys(tablas)).toEqual(expect.arrayContaining(["uso", "cuentas", "sellos_portero", "pagos_sueltos"]));
  });

  it("con un retiro pagado, su fila sale sin cuentas de más: solo la huella de lo que se guarda", async () => {
    const m = montar();
    const t = retiro();
    await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: t.xdr } }));
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, Array<Record<string, unknown>>>;
    expect(tablas.pagos_portero).toHaveLength(1);
    expect(tablas.pagos_portero?.[0]).toMatchObject({ hash: t.hash, forma: "retiro", estado: "enviado", destino_huella: null });
    expect(tablas.retiros_cobrados).toHaveLength(1);
  });

  it("con todo apagado y sin nada guardado el exporte de mainnet es el de siempre, sin las tablas de los pagos", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown>;
    expect(Object.keys(tablas)).not.toContain("pagos_portero");
    expect(Object.keys(tablas)).not.toContain("retiros_cobrados");
    expect(Object.keys(tablas)).toContain("pagos_sueltos");
  });

  it("con todo apagado pero con un retiro guardado (se prendió y se volvió a apagar), el exporte lo trae", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    // Las tablas se crean cuando el objeto arma sus piezas: se lo despierta antes.
    await m.objeto.administrar("estado");
    m.sql.exec("INSERT INTO retiros_cobrados (hash, envuelta, cuenta, costo, ms) VALUES (?, NULL, ?, 5000000, ?)", "a".repeat(64), "G", T0);
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown[]>;
    expect(tablas.retiros_cobrados).toHaveLength(1);
    expect(tablas.pagos_portero).toEqual([]);
  });

  it("con el alta de quien ganó prendida el exporte suma su tabla, vacía", async () => {
    const m = montar({ ALTAS_PREMIO: "1" });
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown[]>;
    expect(tablas.altas_premio).toEqual([]);
  });

  it("con todo apagado y sin nada guardado el exporte no trae la tabla del alta de quien ganó", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown>;
    expect(Object.keys(tablas)).not.toContain("altas_premio");
  });

  it("con todo apagado pero con un alta de quien ganó guardada (se prendió y se volvió a apagar), el exporte la trae", async () => {
    const m = montar({ PAGOS_PREMIO: "0", RETIROS: "0" });
    await m.objeto.administrar("estado");
    const alta = "INSERT INTO altas_premio (contrato, sorteo, puesto, cuenta, organizador, sello, ms) VALUES ('C', '5', 0, 'G1', 'G2', 'S', ?)";
    m.sql.exec(alta, T0);
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown[]>;
    expect(tablas.altas_premio).toHaveLength(1);
  });

  it("en la red de prueba el exporte es el de siempre", async () => {
    const m = montar({ RED: "testnet" });
    const tablas = (await m.objeto.administrar("exportar")).cuerpo.tablas as Record<string, unknown>;
    expect(Object.keys(tablas).sort()).toEqual(["ajustes", "cuenta_app", "cuentas", "reserva", "uso"]);
  });
});

// ---------- la alarma ----------

describe("la alarma, en dos partes", () => {
  it("cierra los pagos que entraron y no vuelve a pedirse si no queda nada en el aire", async () => {
    const m = montar();
    const t = retiro();
    await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: t.xdr } }));
    await vaciar();
    expect(m.puestas).toHaveLength(1);
    mundo.entraron.set(t.hash, "SUCCESS");
    vi.setSystemTime(new Date(T0 + 20_000));
    await m.objeto.alarm();
    expect(m.puestas).toHaveLength(1);
    expect(await estadoDe(m)).toMatchObject({ pagos: { retiro: { enElAire: 0, ok24h: 1 } } });
  });

  it("(ataque) si la parte de los sellos lanza, la de los pagos corre igual y la alarma se vuelve a pedir", async () => {
    const m = montar();
    const t = retiro();
    await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: t.xdr } }));
    await vaciar();
    mundo.entraron.set(t.hash, "SUCCESS");
    vi.setSystemTime(new Date(T0 + 20_000));
    vi.spyOn(Portero.prototype, "reconciliar").mockRejectedValue(new TypeError("se rompió la de los sellos"));
    await m.objeto.alarm();
    // Los pagos se cerraron igual, y como la parte de los sellos lanzó, la alarma se pide de nuevo.
    expect(await estadoDe(m)).toMatchObject({ pagos: { retiro: { enElAire: 0, ok24h: 1 } } });
    expect(m.puestas).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("alarma-sellos"));
  });

  it("un pago en el aire de un objeto que arranca de nuevo vuelve a armar su alarma", async () => {
    const sql = sqlDePrueba();
    const m = montar({}, sql);
    await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr } }));
    // El mismo SQLite con un objeto nuevo: el que se reinició o se desplegó entre reservar y mandar.
    const despues = montar({}, sql);
    expect(despues.alarma()).toBeNull();
    await despues.objeto.administrar("estado");
    expect(despues.alarma()).not.toBeNull();
  });
});

// ---------- lo nuevo no puede tumbar a los sellos ----------

describe("lo de los pagos no tumba al objeto", () => {
  it("si las tablas de los pagos no se pueden crear, el objeto arranca, los pagos dan apagado config y lo demás sigue", async () => {
    const m = montar({}, sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS pagos_portero/));
    const cuenta = Keypair.random().publicKey();
    expect((await m.objeto.cupo(cuenta)).estado).toBe(200);
    expect(await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr } }))).toEqual({
      estado: 503,
      cuerpo: { motivo: "apagado", forma: "retiro", detalle: "config", pudoSalir: false },
    });
    const estado = await estadoDe(m);
    expect(estado.faltaAltas).toContain("tablas-pagos");
    expect(Object.keys(estado)).not.toContain("pagos");
    // El exporte tampoco se cae por unas tablas que no están.
    expect((await m.objeto.administrar("exportar")).estado).toBe(200);
    expect(await m.objeto.pagoClasico("retiro", retiro().xdr)).toMatchObject({ estado: 503 });
  });

  it("si la tabla del alta de quien ganó no se puede crear, el objeto arranca, /estado lo dice y los pagos siguen", async () => {
    const m = montar({ ALTAS_PREMIO: "1", ...CON_SESION }, sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS altas_premio/));
    const cuenta = Keypair.random().publicKey();
    expect((await m.objeto.cupo(cuenta)).cuerpo).toMatchObject({ pagos: { retiro: true, altaPremio: false } });
    expect((await estadoDe(m)).faltaAltas).toContain("tablas-alta-premio");
    const alta = await correr(m, pedido("/v1/alta/premio", { cuerpo: { sorteo: "5", puesto: 1, cuenta } }));
    expect(alta).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "config" } });
    // Un retiro se sigue pagando, y el exporte no se cae por la tabla que no está.
    expect((await correr(m, pedido("/v1/patrocinio/pago", { cuerpo: { forma: "retiro", xdr: retiro().xdr } }))).estado).toBe(200);
    expect((await m.objeto.administrar("exportar")).estado).toBe(200);
  });

  it("un error nuestro en el pago sale como 500 interno con pudoSalir, sin lanzar", async () => {
    const m = montar();
    const objeto = m.objeto as unknown as { pagos: { procesar: (forma: string, xdr: string) => Promise<unknown> } };
    await m.objeto.administrar("estado");
    objeto.pagos.procesar = async () => {
      throw new Error("algo nuestro");
    };
    expect(await m.objeto.pagoClasico("retiro", retiro().xdr)).toEqual({ estado: 500, cuerpo: { motivo: "interno", pudoSalir: false } });
  });
});
