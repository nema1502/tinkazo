import { describe, expect, it } from "vitest";
import { EMISOR_USDC } from "../../workers/cuenta/src/reglas";
import { USDC_MAINNET, USDC_TESTNET } from "./pagos";
import {
  type CuentaMirada,
  type EntradaParaRecibir,
  type EstadoParaRecibir,
  abrePasoDeLaCuenta,
  disponibleXlm,
  estadoParaRecibir,
  mirarCuenta,
  muestraDireccion,
  queLlego,
  usdcDeLaRed,
} from "./usdc-cuenta";
import type { Pago } from "../../workers/cuenta/src/pagos";

/**
 * Antes de mostrar la dirección para traer dólares digitales, el sitio le pregunta a la red si la cuenta puede
 * recibirlos (`usdc-cuenta.ts`). La dirección se ve solo cuando puede: así nadie manda dinero a una cuenta que no lo
 * recibe.
 */

const YO = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const PATROCINA = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const OTRO_EMISOR = "GCQPYIVQSYUCGFCGTZ7KTLEZ62PML72P6XND4V2YQLRFK22QQJRPFIAE";

/** Una línea de USDC de Circle de la red principal, con lo que contesta Horizon. */
const lineaUsdc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  balance: "12.5000000",
  limit: "922337203685.4775807",
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: USDC_MAINNET.issuer,
  is_authorized: true,
  selling_liabilities: "0.0000000",
  ...extra,
});

const nativo = (balance: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  balance,
  asset_type: "native",
  selling_liabilities: "0.0000000",
  buying_liabilities: "0.0000000",
  ...extra,
});

const cuentaDeHorizon = (balances: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: YO,
  sequence: "23997580010586200",
  subentry_count: 0,
  num_sponsoring: 0,
  num_sponsored: 0,
  balances,
  ...extra,
});

/** Un Horizon que contesta `GET /accounts/{cuenta}` con lo que se le da: un objeto (JSON), un número (estado) o `"cuelga"`. */
function horizon(respuesta: unknown): { fetch: typeof fetch; pedidos: string[] } {
  const pedidos: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push(String(url));
    if (respuesta === "cuelga") {
      return new Promise<Response>((_, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(new Error("abortado"))));
    }
    if (respuesta === "lanza") throw new TypeError("Failed to fetch");
    if (typeof respuesta === "number") return new Response("", { status: respuesta });
    if (typeof respuesta === "string") return new Response(respuesta, { status: 200 });
    return new Response(JSON.stringify(respuesta), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, pedidos };
}

describe("mirarCuenta: la cuenta en la red", () => {
  it("lee la secuencia, las líneas con su patrocinador y los datos del XLM", async () => {
    const h = horizon(cuentaDeHorizon([lineaUsdc({ sponsor: PATROCINA }), nativo("1.0000000", { selling_liabilities: "0.2000000" })], { subentry_count: 1, num_sponsored: 1 }));
    const c = (await mirarCuenta("mainnet", YO, { fetch: h.fetch })) as CuentaMirada;
    expect(h.pedidos).toEqual([`https://horizon.stellar.org/accounts/${YO}`]);
    expect(c.secuencia).toBe("23997580010586200");
    expect(c.saldos).toEqual([{ code: "USDC", issuer: USDC_MAINNET.issuer, saldo: "12.5000000", limite: "922337203685.4775807", autorizada: true, patrocinador: PATROCINA }]);
    expect(c).toMatchObject({ xlm: "1.0000000", xlmComprometido: "0.2000000", subentradas: 1, patrocinando: 0, patrocinadas: 1 });
  });

  it("una línea sin `is_authorized` se toma como autorizada; con `false`, no", async () => {
    const h = horizon(cuentaDeHorizon([lineaUsdc({ is_authorized: undefined }), lineaUsdc({ asset_issuer: OTRO_EMISOR, is_authorized: false })]));
    const c = (await mirarCuenta("mainnet", YO, { fetch: h.fetch })) as CuentaMirada;
    expect(c.saldos.map((s) => s.autorizada)).toEqual([true, false]);
    expect(c.saldos[0]?.patrocinador).toBeNull();
  });

  it("los datos nuevos que faltan dan null, no una falla", async () => {
    const h = horizon({ sequence: "1", balances: [lineaUsdc()] });
    const c = (await mirarCuenta("mainnet", YO, { fetch: h.fetch })) as CuentaMirada;
    expect(c).toMatchObject({ xlm: null, xlmComprometido: null, subentradas: null, patrocinando: null, patrocinadas: null });
    expect(c.saldos).toHaveLength(1);
  });

  it("en la red de prueba va al Horizon de prueba; con `horizon`, a ese", async () => {
    const h = horizon(cuentaDeHorizon([]));
    await mirarCuenta("testnet", YO, { fetch: h.fetch });
    await mirarCuenta("testnet", YO, { fetch: h.fetch, horizon: "http://localhost:8000" });
    expect(h.pedidos).toEqual([`https://horizon-testnet.stellar.org/accounts/${YO}`, `http://localhost:8000/accounts/${YO}`]);
  });

  it("404 es que no existe; cualquier otra falla, que no se pudo leer", async () => {
    expect(await mirarCuenta("mainnet", YO, { fetch: horizon(404).fetch })).toBe("no-existe");
    for (const r of [500, 503, 429, "lanza", "no es json", { balances: [] }, { sequence: "abc", balances: [] }, { sequence: "1" }]) {
      expect(await mirarCuenta("mainnet", YO, { fetch: horizon(r).fetch }), JSON.stringify(r)).toBe("sin-red");
    }
  });

  it("si Horizon no contesta, corta al tope y no se sabe", async () => {
    expect(await mirarCuenta("mainnet", YO, { fetch: horizon("cuelga").fetch, tiempoMs: 20 })).toBe("sin-red");
  });
});

describe("el USDC de Circle de cada red", () => {
  it("es el mismo que reconoce el Worker de la cuenta", () => {
    expect(usdcDeLaRed("mainnet")).toEqual(USDC_MAINNET);
    expect(usdcDeLaRed("testnet")).toEqual(USDC_TESTNET);
    expect(USDC_MAINNET.issuer).toBe(EMISOR_USDC.mainnet);
    expect(USDC_TESTNET.issuer).toBe(EMISOR_USDC.testnet);
  });
});

/* ----------------------------------------------------------------- la decisión */

const mirada = (o: Partial<CuentaMirada> = {}): CuentaMirada => ({
  secuencia: "1",
  saldos: [],
  xlm: "1.0000000",
  xlmComprometido: "0.0000000",
  subentradas: 0,
  patrocinando: 0,
  patrocinadas: 0,
  ...o,
});
const conUsdc = (o: Partial<CuentaMirada["saldos"][number]> = {}, red: "mainnet" | "testnet" = "mainnet"): CuentaMirada =>
  mirada({ saldos: [{ code: "USDC", issuer: usdcDeLaRed(red).issuer, saldo: "12.5000000", limite: "922337203685.4775807", autorizada: true, patrocinador: null, ...o }] });

const google = (o: Partial<EntradaParaRecibir> = {}): EntradaParaRecibir => ({
  red: "mainnet",
  practica: false,
  billetera: { tipo: "google" },
  lectura: conUsdc(),
  proteccion: "lista",
  pendiente: false,
  catalogo: "patrocinada",
  ...o,
});
const propia = (o: Partial<EntradaParaRecibir> = {}): EntradaParaRecibir => ({
  red: "mainnet",
  practica: false,
  billetera: { tipo: "propia", red: "mainnet" },
  lectura: conUsdc(),
  ...o,
});

const estado = (e: EntradaParaRecibir): string => estadoParaRecibir(e).estado;

describe("estadoParaRecibir: un caso por estado", () => {
  it("puede: tiene la línea de USDC de Circle, autorizada y con lugar", () => {
    expect(estadoParaRecibir(google())).toEqual({ estado: "puede", saldo: "12.5000000" });
    expect(estadoParaRecibir(propia())).toEqual({ estado: "puede", saldo: "12.5000000" });
  });

  it("fuera de la red principal y sin práctica: solo en Oficial", () => {
    expect(estado(google({ red: "testnet" }))).toBe("solo-oficial");
    expect(estado(propia({ red: "testnet", billetera: { tipo: "propia", red: "testnet" } }))).toBe("solo-oficial");
  });

  it("en la práctica, en la red de prueba, con el USDC de prueba de Circle", () => {
    const lectura = conUsdc({}, "testnet");
    expect(estado(google({ red: "testnet", practica: true, lectura, proteccion: undefined }))).toBe("puede");
    expect(estado(propia({ red: "testnet", practica: true, lectura, billetera: { tipo: "propia", red: "testnet" } }))).toBe("puede");
    // El USDC de la red principal no cuenta en la de prueba.
    expect(estado(propia({ red: "testnet", practica: true, lectura: { ...conUsdc(), xlm: "10.0000000" }, billetera: { tipo: "propia", red: "testnet" } }))).toBe("falta-activar");
  });

  it("otra-red: la billetera propia está en otra red que el sitio", () => {
    expect(estado(propia({ billetera: { tipo: "propia", red: "testnet" } }))).toBe("otra-red");
    // Una red que el sitio no conoce también es otra red.
    expect(estado(propia({ billetera: { tipo: "propia", red: "otra" } }))).toBe("otra-red");
    // Sin saber en qué red está, se sigue.
    expect(estado(propia({ billetera: { tipo: "propia", red: null } }))).toBe("puede");
  });

  it("no-se-sabe: Horizon no contestó", () => {
    expect(estado(google({ lectura: "sin-red" }))).toBe("no-se-sabe");
    expect(estado(propia({ lectura: "sin-red" }))).toBe("no-se-sabe");
  });

  it("creandose: la cuenta de Google todavía no existe; billetera-nueva: la propia", () => {
    expect(estado(google({ lectura: "no-existe" }))).toBe("creandose");
    expect(estado(propia({ lectura: "no-existe" }))).toBe("billetera-nueva");
  });

  it("falta-proteger: Google en la red principal sin forma de recuperarla, antes que puede", () => {
    expect(estado(google({ proteccion: "falta" }))).toBe("falta-proteger");
    expect(estado(google({ proteccion: null }))).toBe("no-se-sabe");
    expect(estado(google({ proteccion: undefined }))).toBe("no-se-sabe");
    // En la red de prueba no se pide.
    expect(estado(google({ red: "testnet", practica: true, lectura: conUsdc({}, "testnet"), proteccion: "falta" }))).toBe("puede");
    // A la billetera propia no se le pide.
    expect(estado(propia({ proteccion: "falta" }))).toBe("puede");
  });

  it("no-recibe-mas: la línea no está autorizada o no le queda lugar para 1 dólar", () => {
    expect(estado(google({ lectura: conUsdc({ autorizada: false }) }))).toBe("no-recibe-mas");
    expect(estado(google({ lectura: conUsdc({ limite: "13.0000000", saldo: "12.5000000" }) }))).toBe("no-recibe-mas");
    expect(estado(propia({ lectura: conUsdc({ limite: "13.4999999", saldo: "12.5000000" }) }))).toBe("no-recibe-mas");
    expect(estado(propia({ lectura: conUsdc({ limite: "13.5000000", saldo: "12.5000000" }) }))).toBe("puede");
  });

  it("una línea de USDC de otro emisor no cuenta", () => {
    const lectura = mirada({ xlm: "10.0000000", saldos: [{ code: "USDC", issuer: OTRO_EMISOR, saldo: "5.0000000", limite: "1000.0000000", autorizada: true, patrocinador: null }] });
    expect(estado(propia({ lectura }))).toBe("falta-activar");
    expect(estado(google({ lectura }))).toBe("falta-activar");
  });

  it("activandose: con Google, un pedido de la línea de USDC ya espera", () => {
    expect(estado(google({ lectura: mirada(), pendiente: true }))).toBe("activandose");
    expect(estado(google({ lectura: mirada(), pendiente: null }))).toBe("no-se-sabe");
  });

  it("falta-activar con Google: la paga la app solo si el catálogo de Pollar lo dice", () => {
    expect(estadoParaRecibir(google({ lectura: mirada() }))).toEqual({ estado: "falta-activar", paga: "app" });
    expect(estado(google({ lectura: mirada(), catalogo: null }))).toBe("no-se-sabe");
    expect(estado(google({ lectura: mirada(), catalogo: undefined }))).toBe("no-se-sabe");
  });

  it("no-puede-app: con Google, sin patrocinio, no se le pide a la cuenta que aparte su XLM en la red principal", () => {
    expect(estado(google({ lectura: mirada(), catalogo: "no-patrocinada" }))).toBe("no-puede-app");
    expect(estado(google({ lectura: mirada({ xlm: "50.0000000" }), catalogo: "no-patrocinada" }))).toBe("no-puede-app");
  });

  it("en la práctica, con Google y XLM de prueba libre, la línea la paga la cuenta", () => {
    const base = { red: "testnet" as const, practica: true, proteccion: undefined, catalogo: "no-patrocinada" as const };
    expect(estadoParaRecibir(google({ ...base, lectura: mirada({ xlm: "10000.0000000" }) }))).toEqual({ estado: "falta-activar", paga: "cuenta" });
    expect(estado(google({ ...base, lectura: mirada({ xlm: "1.0000000" }) }))).toBe("no-puede-app");
  });

  it("falta-activar con billetera propia: lo libre alcanza para el medio XLM y la comisión", () => {
    // 2 reservas base (1 XLM) + 0,5001 = 1,5001.
    expect(estadoParaRecibir(propia({ lectura: mirada({ xlm: "1.5001000" }) }))).toEqual({ estado: "falta-activar", paga: "cuenta" });
    expect(estadoParaRecibir(propia({ lectura: mirada({ xlm: "1.5000000" }) }))).toEqual({ estado: "falta-xlm", necesita: "0.5001000", tiene: "0.5000000" });
  });

  it("falta-xlm: dice cuánto hace falta y cuánto tiene libre, sin bajar de cero", () => {
    expect(estadoParaRecibir(propia({ lectura: mirada({ xlm: "1.2000000" }) }))).toEqual({ estado: "falta-xlm", necesita: "0.5001000", tiene: "0.2000000" });
    expect(estadoParaRecibir(propia({ lectura: mirada({ xlm: "0.9000000" }) }))).toEqual({ estado: "falta-xlm", necesita: "0.5001000", tiene: "0.0000000" });
  });

  it("sin los datos del XLM, con billetera propia no se sabe", () => {
    for (const falta of ["xlm", "xlmComprometido", "subentradas", "patrocinando", "patrocinadas"] as const) {
      expect(estado(propia({ lectura: mirada({ xlm: "100.0000000", [falta]: null }) })), falta).toBe("no-se-sabe");
    }
  });
});

describe("lo libre del XLM", () => {
  it("resta las reservas de las subentradas, de lo que patrocina y lo comprometido; lo patrocinado no cuenta", () => {
    expect(disponibleXlm(mirada({ xlm: "10.0000000" }))).toBe(90_000_000n);
    expect(disponibleXlm(mirada({ xlm: "10.0000000", subentradas: 2 }))).toBe(80_000_000n);
    expect(disponibleXlm(mirada({ xlm: "10.0000000", subentradas: 2, patrocinadas: 2 }))).toBe(90_000_000n);
    expect(disponibleXlm(mirada({ xlm: "10.0000000", patrocinando: 1 }))).toBe(85_000_000n);
    expect(disponibleXlm(mirada({ xlm: "10.0000000", xlmComprometido: "1.5000000" }))).toBe(75_000_000n);
    expect(disponibleXlm(mirada({ xlm: null }))).toBeNull();
  });
});

describe("la dirección, solo cuando puede", () => {
  const todos: EstadoParaRecibir[] = [
    { estado: "puede", saldo: "0.0000000" },
    { estado: "solo-oficial" },
    { estado: "falta-activar", paga: "app" },
    { estado: "falta-activar", paga: "cuenta" },
    { estado: "falta-proteger" },
    { estado: "creandose" },
    { estado: "activandose" },
    { estado: "no-se-sabe" },
    { estado: "otra-red" },
    { estado: "falta-xlm", necesita: "0.5001000", tiene: "0.0000000" },
    { estado: "billetera-nueva" },
    { estado: "no-recibe-mas" },
    { estado: "no-puede-app" },
  ];
  it("ningún otro estado muestra la dirección", () => {
    for (const e of todos) expect(muestraDireccion(e), e.estado).toBe(e.estado === "puede");
  });

  it("con Google en Oficial, sin la cuenta lista, lleva al paso de la cuenta", () => {
    expect(abrePasoDeLaCuenta({ estado: "falta-proteger" }, "mainnet")).toBe(true);
    expect(abrePasoDeLaCuenta({ estado: "creandose" }, "mainnet")).toBe(true);
    // En la red de prueba no hay paso de la cuenta.
    expect(abrePasoDeLaCuenta({ estado: "creandose" }, "testnet")).toBe(false);
    for (const e of todos.filter((x) => x.estado !== "falta-proteger" && x.estado !== "creandose")) expect(abrePasoDeLaCuenta(e, "mainnet"), e.estado).toBe(false);
  });
});

describe("queLlego: lo que contesta Ya lo mandé", () => {
  const pago = (tx: string, o: Partial<Pago> = {}): Pago => ({ de: PATROCINA, a: YO, monto: 50_000_000n, tx, memo: null, ms: 2_000, ...o });

  it("con una base sin pagos, todo lo que llegó es nuevo y se suma", () => {
    expect(queLlego([pago("b"), pago("a", { monto: 10_000_000n })], YO, { ms: 1_000, ultimoTx: null })).toEqual({ tipo: "llegaron", monto: 60_000_000n, ultimoTx: "b" });
  });

  it("con una base, son nuevos los que están antes del pago guardado", () => {
    expect(queLlego([pago("c"), pago("b"), pago("a")], YO, { ms: 1_000, ultimoTx: "b" })).toEqual({ tipo: "llegaron", monto: 50_000_000n, ultimoTx: "c" });
  });

  it("si el pago guardado ya no está entre los leídos, cuentan los más nuevos que la base", () => {
    expect(queLlego([pago("c", { ms: 5_000 }), pago("b", { ms: 500 })], YO, { ms: 1_000, ultimoTx: "z" })).toEqual({ tipo: "llegaron", monto: 50_000_000n, ultimoTx: "c" });
  });

  it("sin nada nuevo dice el último que llegó, con su fecha", () => {
    expect(queLlego([pago("b", { ms: 9_000 }), pago("a")], YO, { ms: 10_000, ultimoTx: "b" })).toEqual({ tipo: "ultimo", monto: 50_000_000n, ms: 9_000 });
  });

  it("sin base no se sabe cuál es nuevo: dice el último, nunca que no llegó", () => {
    expect(queLlego([pago("b", { ms: 9_000 })], YO, null)).toEqual({ tipo: "ultimo", monto: 50_000_000n, ms: 9_000 });
    expect(queLlego([], YO, null)).toEqual({ tipo: "ninguno" });
  });

  it("los pagos de la misma cuenta y los de Tinkazo (nota tk:) no cuentan", () => {
    const pagos = [pago("x", { de: YO }), pago("y", { memo: "tk:premio:1:0" })];
    expect(queLlego(pagos, YO, { ms: 0, ultimoTx: null })).toEqual({ tipo: "ninguno" });
  });
});
