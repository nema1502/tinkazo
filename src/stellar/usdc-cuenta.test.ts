import { afterEach, describe, expect, it, vi } from "vitest";
import { EMISOR_USDC } from "../../workers/cuenta/src/reglas";
import { USDC_MAINNET, USDC_TESTNET } from "./pagos";
import {
  type CuentaMirada,
  type EntradaParaRecibir,
  type EstadoParaRecibir,
  abrePasoDeLaCuenta,
  disponibleXlm,
  estadoParaRecibir,
  PAUSA_DE_LA_PUERTA_MS,
  PRESUPUESTO_DE_LA_PUERTA_MS,
  REINTENTOS_DE_LA_PUERTA,
  TOPE_DE_LA_PUERTA_MS,
  mirarAntesDeActivar,
  mirarCuenta,
  mirarPuertaDelPremio,
  muestraDireccion,
  puertaDelPremio,
  queLlego,
  tieneFirmanteAjeno,
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

describe("mirarCuenta: quién firma por la cuenta", () => {
  const firmantes = (signers: unknown) => cuentaDeHorizon([nativo("0.0000000")], { signers });

  it("lee la clave y el peso de cada firmante", async () => {
    const h = horizon(firmantes([{ key: YO, weight: 1, type: "ed25519_public_key" }, { key: OTRO_EMISOR, weight: 2, type: "ed25519_public_key" }]));
    const c = (await mirarCuenta("mainnet", YO, { fetch: h.fetch })) as CuentaMirada;
    expect(c.firmantes).toEqual([{ clave: YO, peso: 1 }, { clave: OTRO_EMISOR, peso: 2 }]);
  });

  it("sin el dato, o con uno que no se lee, es null: nunca una lista a medias", async () => {
    for (const signers of [undefined, "x", { key: YO }, [{ key: YO, weight: 1 }, { weight: 1 }], [{ key: YO, weight: "1" }], [{ key: YO, weight: -1 }], [null]]) {
      const c = (await mirarCuenta("mainnet", YO, { fetch: horizon(firmantes(signers)).fetch })) as CuentaMirada;
      expect(c.firmantes, JSON.stringify(signers)).toBeNull();
    }
  });

  it("tieneFirmanteAjeno: solo una clave con peso que no es la de la cuenta", () => {
    const con = (f: CuentaMirada["firmantes"]) => tieneFirmanteAjeno({ ...mirada(), firmantes: f }, YO);
    expect(con([{ clave: YO, peso: 1 }])).toBe(false);
    expect(con([{ clave: YO, peso: 1 }, { clave: OTRO_EMISOR, peso: 1 }])).toBe(true);
    expect(con([{ clave: YO, peso: 0 }, { clave: OTRO_EMISOR, peso: 1 }])).toBe(true);
    expect(con([{ clave: YO, peso: 1 }, { clave: OTRO_EMISOR, peso: 0 }])).toBe(false);
    expect(con(null)).toBe(false);
    expect(con(undefined)).toBe(false);
    expect(con([])).toBe(false);
  });

  it("la forma de una cuenta de Google de la red principal, medida el 18 de noviembre de 2026: su sola llave, sin aviso y libre", async () => {
    // Lo que contestó Horizon para una cuenta real creada por la activación, con direcciones inventadas.
    const CUENTA = "GAYTCMJRGEYTCMJRGEYTCMJRGEYTCMJRGEYTCMJRGEYTCMJRGEYTD543";
    const PATROCINADORA = "GAZDEMRSGIZDEMRSGIZDEMRSGIZDEMRSGIZDEMRSGIZDEMRSGIZDENU4";
    const respuesta = {
      account_id: CUENTA,
      sequence: "1",
      subentry_count: 0,
      num_sponsoring: 0,
      num_sponsored: 2,
      sponsor: PATROCINADORA,
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
      signers: [{ weight: 1, key: CUENTA, type: "ed25519_public_key" }],
      balances: [{ balance: "0.0000000", buying_liabilities: "0.0000000", selling_liabilities: "0.0000000", asset_type: "native" }],
    };
    const c = (await mirarCuenta("mainnet", CUENTA, { fetch: horizon(respuesta).fetch })) as CuentaMirada;
    expect(c.firmantes).toEqual([{ clave: CUENTA, peso: 1 }]);
    expect(c).toMatchObject({ xlm: "0.0000000", subentradas: 0, patrocinando: 0, patrocinadas: 2 });
    expect(tieneFirmanteAjeno(c, CUENTA)).toBe(false);
    expect(puertaDelPremio(respuesta, "mainnet")).toBe("libre");
    // Con la misma forma y una segunda llave con peso, la regla sí avisa: lo que cambia es la firma, no lo demás.
    const conOtraLlave = { ...respuesta, signers: [...respuesta.signers, { weight: 1, key: PATROCINADORA, type: "ed25519_public_key" }] };
    const d = (await mirarCuenta("mainnet", CUENTA, { fetch: horizon(conOtraLlave).fetch })) as CuentaMirada;
    expect(tieneFirmanteAjeno(d, CUENTA)).toBe(true);
  });
});

describe("puertaDelPremio: ¿puede la cuenta guardar dinero?", () => {
  const otra = (balance: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    asset_type: "credit_alphanum4",
    asset_code: "EURC",
    asset_issuer: OTRO_EMISOR,
    limit: "100.0000000",
    ...(balance === undefined ? {} : { balance }),
    ...extra,
  });
  const decide = (balances: Record<string, unknown>[], red: "mainnet" | "testnet" = "mainnet") => puertaDelPremio(cuentaDeHorizon(balances), red);

  it("la línea del dólar digital de Circle de la red frena con cualquier saldo, también cero, autorizada o no", () => {
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: "0.0000000" })])).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: "12.5000000" })])).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: "0.0000000", is_authorized: false })])).toBe("puede-guardar");
  });

  it("la línea de Circle con un saldo que no se lee frena igual: no se toma por cero", () => {
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: undefined })])).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: "mucho" })])).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: 5 })])).toBe("puede-guardar");
  });

  it("sin la línea y con XLM en cero, libre", () => {
    expect(decide([nativo("0.0000000")])).toBe("libre");
  });

  it("con XLM mayor que cero, sin líneas, sigue libre: cualquiera puede mandarle XLM a una cuenta", () => {
    expect(decide([nativo("0.0000001")])).toBe("libre");
    expect(decide([nativo("2.0000000")])).toBe("libre");
    expect(decide([nativo("5000000.0000000")])).toBe("libre");
  });

  it("el XLM, con cualquier saldo, no cambia lo que dicen las líneas: ni frena ni desfrena", () => {
    for (const xlm of ["0.0000000", "0.0000001", "10000.0000000"]) {
      expect(decide([nativo(xlm), lineaUsdc({ balance: "0.0000000" })]), xlm).toBe("puede-guardar");
      expect(decide([nativo(xlm), otra("3.0000000")]), xlm).toBe("puede-guardar");
      expect(decide([nativo(xlm), otra("0.0000000")]), xlm).toBe("libre");
      expect(decide([nativo(xlm), otra(undefined)]), xlm).toBe("no-se-sabe");
    }
  });

  it("otra moneda: con saldo frena, en cero no cuenta, con un saldo que no se lee no se sabe", () => {
    expect(decide([nativo("0.0000000"), otra("3.0000000")])).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), otra("0.0000000")])).toBe("libre");
    expect(decide([nativo("0.0000000"), otra(undefined)])).toBe("no-se-sabe");
    expect(decide([nativo("0.0000000"), otra("x")])).toBe("no-se-sabe");
    // Si ya hay algo que frena, frena: lo que no se lee no lo desmiente.
    expect(decide([nativo("0.0000000"), otra("3.0000000"), otra(undefined, { asset_code: "BRLT" })])).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: "0.0000000" }), otra(undefined)])).toBe("puede-guardar");
    // Con XLM no hay nada que frene: lo que no se lee deja la duda.
    expect(decide([nativo("1.0000000"), otra(undefined)])).toBe("no-se-sabe");
  });

  it("las acciones de un fondo común con saldo también frenan", () => {
    expect(decide([nativo("0.0000000"), { asset_type: "liquidity_pool_shares", liquidity_pool_id: "ab".repeat(32), balance: "4.0000000", limit: "100.0000000" }])).toBe("puede-guardar");
  });

  it("el dólar de la red de prueba, mirado en la red principal, no cuenta como el de Circle (y al revés)", () => {
    const deTestnet = (balance: string): Record<string, unknown> => lineaUsdc({ asset_issuer: USDC_TESTNET.issuer, balance });
    expect(decide([nativo("0.0000000"), deTestnet("0.0000000")], "mainnet")).toBe("libre");
    expect(decide([nativo("0.0000000"), deTestnet("2.0000000")], "mainnet")).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), deTestnet("0.0000000")], "testnet")).toBe("puede-guardar");
    expect(decide([nativo("0.0000000"), lineaUsdc({ balance: "0.0000000" })], "testnet")).toBe("libre");
  });

  it("lo que no se lee nunca da libre", () => {
    const sinXlm = cuentaDeHorizon([lineaUsdc()]);
    for (const cuerpo of [null, undefined, "texto", 3, {}, { balances: "x" }, { balances: [] }, { balances: [null] }, { balances: ["x"] }, sinXlm]) {
      expect(puertaDelPremio(cuerpo, "mainnet"), JSON.stringify(cuerpo)).toBe("no-se-sabe");
    }
    for (const balance of [undefined, "", "abc", "1e3", "-1.0000000", "1.12345678", "1,5", 4, null]) {
      expect(puertaDelPremio(cuentaDeHorizon([{ asset_type: "native", ...(balance === undefined ? {} : { balance }) }]), "mainnet"), String(balance)).toBe("no-se-sabe");
    }
  });
});

describe("mirarPuertaDelPremio: la lectura de la puerta", () => {
  afterEach(() => vi.useRealTimers());

  /** Un Horizon que anota el pedido completo y contesta lo que se le da. */
  function lector(respuesta: unknown): { fetch: typeof fetch; pedidos: Array<{ url: string; init: RequestInit | undefined }> } {
    const pedidos: Array<{ url: string; init: RequestInit | undefined }> = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ url: String(url), init });
      if (respuesta === "cuelga") return new Promise<Response>((_, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(new Error("abortado"))));
      if (respuesta === "lanza") throw new TypeError("Failed to fetch");
      if (typeof respuesta === "number") return new Response("", { status: respuesta });
      if (typeof respuesta === "string") return new Response(respuesta, { status: 200 });
      return new Response(JSON.stringify(respuesta), { status: 200 });
    }) as typeof fetch;
    return { fetch: f, pedidos };
  }

  it("pide al Horizon de la red indicada, sin caché y con la señal del tope", async () => {
    const l = lector(cuentaDeHorizon([nativo("0.0000000")]));
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: l.fetch })).toBe("libre");
    await mirarPuertaDelPremio("testnet", YO, { fetch: l.fetch });
    expect(l.pedidos.map((p) => p.url)).toEqual([`https://horizon.stellar.org/accounts/${YO}`, `https://horizon-testnet.stellar.org/accounts/${YO}`]);
    for (const p of l.pedidos) {
      expect(p.init?.cache).toBe("no-store");
      expect(p.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("200 con la línea de Circle: puede guardar. 200 sin ella: libre. 200 con la línea sin saldo: puede guardar", async () => {
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: lector(cuentaDeHorizon([nativo("0.0000000"), lineaUsdc()])).fetch })).toBe("puede-guardar");
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: lector(cuentaDeHorizon([nativo("0.0000000")])).fetch })).toBe("libre");
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: lector(cuentaDeHorizon([nativo("0.0000000"), lineaUsdc({ balance: undefined })])).fetch })).toBe("puede-guardar");
  });

  it("200 sin líneas y con mucho XLM: libre, con una sola lectura", async () => {
    const l = lector(cuentaDeHorizon([nativo("250000.0000000")]));
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: l.fetch, pausaMs: 0 })).toBe("libre");
    expect(l.pedidos).toHaveLength(1);
  });

  it("404 es que Horizon no la conoce todavía: lo espera, y si sigue sin verla da no-existe", async () => {
    const l = lector(404);
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: l.fetch, pausaMs: 0 })).toBe("no-existe");
    expect(l.pedidos).toHaveLength(1 + REINTENTOS_DE_LA_PUERTA);
  });

  it("cualquier otra falla es que no se sabe: 500, 429, un corte, un cuerpo que no es JSON", async () => {
    for (const r of [500, 503, 429, 403, "lanza", "no es json"]) {
      expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: lector(r).fetch, pausaMs: 0 }), JSON.stringify(r)).toBe("no-se-sabe");
    }
  });

  it("un pedido que no contesta se corta a los 5 segundos, se vuelve a probar con lo que queda y a los 7 no se sabe", async () => {
    expect(TOPE_DE_LA_PUERTA_MS).toBe(5_000);
    expect(PRESUPUESTO_DE_LA_PUERTA_MS).toBe(7_000);
    vi.useFakeTimers();
    let dicho: string | null = null;
    const l = lector("cuelga");
    const listo = mirarPuertaDelPremio("mainnet", YO, { fetch: l.fetch }).then((r) => (dicho = r));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(dicho).toBeNull();
    expect(l.pedidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    // La primera lectura se cortó a los 5 segundos: queda poco, y la segunda espera su pausa.
    expect(dicho).toBeNull();
    await vi.advanceTimersByTimeAsync(PAUSA_DE_LA_PUERTA_MS + 1);
    expect(l.pedidos).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(PRESUPUESTO_DE_LA_PUERTA_MS);
    await listo;
    expect(dicho).toBe("no-se-sabe");
    // Nunca más de dos lecturas con lo que queda, ni más de siete segundos en total.
    expect(l.pedidos).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("con otro Horizon y otro tope, usa esos", async () => {
    const l = lector(cuentaDeHorizon([nativo("0.0000000")]));
    await mirarPuertaDelPremio("mainnet", YO, { fetch: l.fetch, horizon: "http://localhost:8000" });
    expect(l.pedidos[0]?.url).toBe(`http://localhost:8000/accounts/${YO}`);
    expect(await mirarPuertaDelPremio("mainnet", YO, { fetch: lector("cuelga").fetch, tiempoMs: 20, pausaMs: 0 })).toBe("no-se-sabe");
  });
});

describe("mirarPuertaDelPremio: ante una duda vuelve a leer, ante una respuesta no", () => {
  afterEach(() => vi.useRealTimers());

  const LIBRE = cuentaDeHorizon([nativo("0.0000000")]);
  const GUARDA = cuentaDeHorizon([nativo("0.0000000"), lineaUsdc()]);

  /** Un Horizon que contesta, en orden, lo que se le da (la última se repite) y anota cuántas veces lo llamaron. */
  function enOrden(respuestas: unknown[]): { fetch: typeof fetch; pedidos: number } {
    const estado = { fetch: undefined as unknown as typeof fetch, pedidos: 0 };
    estado.fetch = (async () => {
      const r = respuestas[Math.min(estado.pedidos, respuestas.length - 1)];
      estado.pedidos += 1;
      if (r === "lanza") throw new TypeError("Failed to fetch");
      if (typeof r === "number") return new Response("", { status: r });
      return new Response(JSON.stringify(r), { status: 200 });
    }) as typeof fetch;
    return estado;
  }
  const mira = (e: { fetch: typeof fetch }, extra: Record<string, unknown> = {}) => mirarPuertaDelPremio("mainnet", YO, { fetch: e.fetch, pausaMs: 0, ...extra });

  it("una respuesta que dice algo no se repite: libre, una sola lectura", async () => {
    const e = enOrden([LIBRE, GUARDA]);
    expect(await mira(e)).toBe("libre");
    expect(e.pedidos).toBe(1);
  });

  it("puede-guardar no se repite nunca, aunque una lectura siguiente diría otra cosa", async () => {
    const e = enOrden([GUARDA, LIBRE]);
    expect(await mira(e)).toBe("puede-guardar");
    expect(e.pedidos).toBe(1);
  });

  it("un 5xx, un 429 o un corte seguidos de una respuesta: sale esa respuesta", async () => {
    for (const falla of [500, 503, 429, "lanza"]) {
      const libre = enOrden([falla, LIBRE]);
      expect(await mira(libre), String(falla)).toBe("libre");
      expect(libre.pedidos).toBe(2);
      const guarda = enOrden([falla, falla, GUARDA]);
      expect(await mira(guarda), String(falla)).toBe("puede-guardar");
      expect(guarda.pedidos).toBe(3);
    }
  });

  it("un 404 seguido de la cuenta (Horizon va unos segundos atrás): sale la respuesta de la cuenta", async () => {
    const e = enOrden([404, LIBRE]);
    expect(await mira(e)).toBe("libre");
    expect(e.pedidos).toBe(2);
    const g = enOrden([404, 404, GUARDA]);
    expect(await mira(g)).toBe("puede-guardar");
  });

  it("tres dudas seguidas: la duda, con tres lecturas y no más", async () => {
    const e = enOrden([500, 404, "lanza", LIBRE]);
    expect(await mira(e)).toBe("no-se-sabe");
    expect(e.pedidos).toBe(1 + REINTENTOS_DE_LA_PUERTA);
    const nueva = enOrden([500, 500, 404, LIBRE]);
    expect(await mira(nueva)).toBe("no-existe");
    expect(nueva.pedidos).toBe(3);
  });

  it("un cuerpo que no se lee también se vuelve a pedir, y nunca da libre mientras no se lee", async () => {
    const e = enOrden([{ sequence: "1" }, { balances: "x" }, { sequence: "2" }]);
    expect(await mira(e)).toBe("no-se-sabe");
    expect(e.pedidos).toBe(3);
  });

  it("sinReintentarNoExiste: un 404 se toma como respuesta, pero un 5xx se sigue reintentando", async () => {
    const e = enOrden([404, LIBRE]);
    expect(await mira(e, { sinReintentarNoExiste: true })).toBe("no-existe");
    expect(e.pedidos).toBe(1);
    const f = enOrden([500, 404, LIBRE]);
    expect(await mira(f, { sinReintentarNoExiste: true })).toBe("no-existe");
    expect(f.pedidos).toBe(2);
  });

  it("espera su pausa entre una lectura y la siguiente", async () => {
    vi.useFakeTimers();
    const e = enOrden([500, LIBRE]);
    let dicho: string | null = null;
    const listo = mirarPuertaDelPremio("mainnet", YO, { fetch: e.fetch }).then((r) => (dicho = r));
    await vi.advanceTimersByTimeAsync(PAUSA_DE_LA_PUERTA_MS - 1);
    expect(e.pedidos).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    await listo;
    expect(e.pedidos).toBe(2);
    expect(dicho).toBe("libre");
  });
});

describe("mirarAntesDeActivar: lo que se mira antes de pedir la línea", () => {
  function lector(r: unknown): typeof fetch {
    return (async () => {
      if (r === "lanza") throw new TypeError("Failed to fetch");
      if (typeof r === "number") return new Response("", { status: r });
      return new Response(JSON.stringify(r), { status: 200 });
    }) as typeof fetch;
  }
  const mira = (r: unknown) => mirarAntesDeActivar("mainnet", YO, { fetch: lector(r), pausaMs: 0 });
  const otraConSaldo = (): Record<string, unknown> => ({ asset_type: "credit_alphanum4", asset_code: "EURC", asset_issuer: OTRO_EMISOR, balance: "3.0000000", limit: "10.0000000" });

  it("sin la línea y sin otra con saldo (tenga o no XLM), o una cuenta que Horizon no conoce: libre, se puede pedir", async () => {
    expect(await mira(cuentaDeHorizon([nativo("0.0000000")]))).toBe("libre");
    // El XLM no cuenta: si lo contara, mandarle unas fracciones a quien va a recibir un premio le cerraría la activación.
    expect(await mira(cuentaDeHorizon([nativo("0.0000001")]))).toBe("libre");
    expect(await mira(cuentaDeHorizon([nativo("1.0000000")]))).toBe("libre");
    expect(await mira(404)).toBe("libre");
  });

  it("con la línea ya puesta (con saldo o sin él, y con XLM o sin él): ya está, no se pide otra", async () => {
    expect(await mira(cuentaDeHorizon([nativo("0.0000000"), lineaUsdc()]))).toBe("ya-esta");
    expect(await mira(cuentaDeHorizon([nativo("1.5000000"), lineaUsdc({ balance: "9.0000000" })]))).toBe("ya-esta");
  });

  it("con otra moneda con saldo y sin la línea, o si la red no deja saberlo: no se sabe, no se pide nada", async () => {
    expect(await mira(cuentaDeHorizon([nativo("0.0000000"), otraConSaldo()]))).toBe("no-se-sabe");
    expect(await mira(cuentaDeHorizon([nativo("1.0000000"), otraConSaldo()]))).toBe("no-se-sabe");
    for (const r of [500, 429, "lanza", { sequence: "1" }]) expect(await mira(r), JSON.stringify(r)).toBe("no-se-sabe");
  });

  it("la línea del dólar de la otra red no cuenta como la línea de esta", async () => {
    const deTestnet = lineaUsdc({ asset_issuer: USDC_TESTNET.issuer, balance: "0.0000000" });
    expect(await mira(cuentaDeHorizon([nativo("0.0000000"), deTestnet]))).toBe("libre");
    expect(await mira(cuentaDeHorizon([nativo("0.0000000"), deTestnet, lineaUsdc()]))).toBe("ya-esta");
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
