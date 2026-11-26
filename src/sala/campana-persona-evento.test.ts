import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPANA_MAX,
  CAMPANA_POR_MINUTO,
  ENVIOS_CAMPANA_POR_CONEXION,
  REINGRESOS_POR_PERSONA_POR_HORA,
  VENTANA_CAMPANA_MS,
} from "../../workers/sala/src/campana";
import { URL_DE_LLAVES_DE_GOOGLE } from "../../workers/sala/src/identidad-google";
import { esLineaDePersona } from "../../workers/sala/src/linea-persona";
import { leerAlta, type Lectura } from "./campana";
import { leerAltaDePersona } from "./celular-persona";
import {
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type PersonaDePrueba,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * Un evento de 150 personas por el mismo Wi-Fi. Todas llegan a la sala con la misma dirección de red, con el pase del QR
 * encendido (como en producción) y con un Google de mentira: los tokens se firman acá con una llave de prueba y las llaves
 * públicas las sirve un `fetch` falso que cuenta cuántas veces le piden. Se mira que entren las 150 repartidas en 15 minutos,
 * repartidas en 3 y todas juntas en un minuto, que ningún tope de la conexión, de la dirección ni de la sala frene a nadie,
 * que la segunda alta de una persona conteste que ya está, que las llaves de Google se pidan una sola vez y que no salga ni
 * un pedido al proveedor de cuentas. Después se compara con una campaña de cuentas y se llega a cada tope por su borde, en los
 * dos modos, para ver qué contesta y qué entiende el celular.
 *
 * Los topes que valen (`workers/sala/src/campana.ts`) son los mismos en los dos modos: la sala de personas llama a la misma
 * `anotarPersona` que la de cuentas.
 */
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const MINUTO = 60_000;
const IP = "190.129.10.20";
const CLIENTE = "cliente-de-prueba.apps.example.org";
const PERSONAS = 150;
const OTROS_CELULARES = [1, 50, 100, 150];
const llaveDe = (n: number, celular = 1): string => `celular${n}-${celular}`.padEnd(22, "x");

type Modo = "persona" | "cuenta";

interface Par {
  kid: string;
  privada: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

let google: Par;

beforeAll(async () => {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  google = { kid: "llave-1", privada: par.privateKey, jwk: { ...jwk, kid: "llave-1", alg: "RS256", use: "sig" } as Par["jwk"] };
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const aTexto = (o: unknown): string => b64(new TextEncoder().encode(JSON.stringify(o)));

/** Un token de identidad de Google de la persona `n`, firmado con la llave de prueba y vigente a la hora `ahora`. */
async function tokenDeGoogle(n: number, ahora: number, variante = 0): Promise<string> {
  const segundos = Math.floor(ahora / 1000);
  const cuerpo = {
    iss: "https://accounts.google.com",
    aud: CLIENTE,
    sub: `10000000000000000000${n}`,
    email: `persona${n}@example.org`,
    email_verified: true,
    iat: segundos - 10 - variante,
    exp: segundos + 3000,
  };
  const entrada = `${aTexto({ alg: "RS256", typ: "JWT", kid: google.kid })}.${aTexto(cuerpo)}`;
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", google.privada, new TextEncoder().encode(entrada)));
  return `${entrada}.${b64(firma)}`;
}

interface Respuesta {
  estado: number;
  cuerpo: string;
  espera: string | null;
}

/** Un evento armado: el Worker, la sala abierta, el Google de mentira y todo lo que se le pidió a la red. */
interface Evento {
  mundo: MundoDeSala;
  sala: SalaDeCampana;
  modo: Modo;
  /** Cuántas veces se pidieron las llaves públicas de Google. */
  llaves: { pedidas: number };
  /** Toda dirección distinta de las llaves de Google a la que salió un pedido. */
  otrosPedidos: string[];
  cuentas: Map<number, PersonaDePrueba>;
  /** La sesión de Google con la que entró cada persona: quien vuelve a tocar el botón la repite. */
  sesiones: Map<number, string>;
  pase: { p: string; hasta: number };
}

const objeto = (e: Evento): string => `sala:${e.sala.id}`;
const ruta = (e: Evento, resto: string): string => `/v1/sala/${e.sala.id}${resto}`;

async function armarEvento(modo: Modo, extra: Record<string, string> = {}): Promise<Evento> {
  const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, ...extra });
  const llaves = { pedidas: 0 };
  const otrosPedidos: string[] = [];
  const delResto = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    if (String(url) === URL_DE_LLAVES_DE_GOOGLE) {
      llaves.pedidas++;
      return new Response(JSON.stringify({ keys: [google.jwk] }), { status: 200, headers: { "cache-control": "public, max-age=3600" } });
    }
    otrosPedidos.push(new URL(String(url)).pathname);
    return delResto(url, init);
  });
  vi.setSystemTime(AHORA);
  const sala = await campanaAbierta(mundo, AHORA, { evento: `evento-${modo}`, ...(modo === "persona" ? { identidad: "persona" } : {}) });
  return { mundo, sala, modo, llaves, otrosPedidos, cuentas: new Map(), sesiones: new Map(), pase: { p: "", hasta: 0 } };
}

/** El pase que muestra la pantalla: se renueva solo cuando vence, así que a veces el celular trae uno de hace un par de minutos. */
async function paseDeLaPantalla(e: Evento): Promise<string> {
  if (Date.now() >= e.pase.hasta) {
    const r = await e.mundo.pedir(ruta(e, "/campana/pase"), { cabeceras: { Authorization: `Bearer ${e.sala.token}` } });
    expect(r.status).toBe(200);
    e.pase = (await r.json()) as Evento["pase"];
  }
  return e.pase.p;
}

async function leer(r: Response): Promise<Respuesta> {
  return { estado: r.status, cuerpo: await r.text(), espera: r.headers.get("Retry-After") };
}

/**
 * El alta de la persona `n` desde su celular, a la hora que marque el reloj. `otroCelular` entra con una sesión recién emitida
 * y la llave de otro celular. Una campaña de cuentas usa la sesión de siempre del proveedor de mentira.
 */
async function enviar(e: Evento, n: number, p: string | null, otroCelular = false): Promise<Response> {
  const cabeceras = { "CF-Connecting-IP": IP };
  const llave = llaveDe(n, otroCelular ? 2 : 1);
  const pase = p === null ? {} : { p };
  if (e.modo === "persona") {
    let sesion = otroCelular ? undefined : e.sesiones.get(n);
    if (sesion === undefined) {
      sesion = await tokenDeGoogle(n, Date.now(), otroCelular ? 1 : 0);
      if (!otroCelular) e.sesiones.set(n, sesion);
    }
    return e.mundo.pedir(ruta(e, "/campana/alta"), { cuerpo: { google: sesion, d: "A".repeat(60), llave, ...pase }, cabeceras });
  }
  let persona = e.cuentas.get(n);
  if (!persona) {
    persona = personaDePrueba(e.mundo, n);
    e.cuentas.set(n, persona);
  }
  return e.mundo.pedir(ruta(e, "/campana/alta"), { cuerpo: { token: persona.token, d: "A".repeat(60), llave, ...pase }, cabeceras });
}

const consulta = (e: Evento, sql: string, ...parametros: (string | number)[]): Record<string, string | number | null>[] =>
  e.mundo.ejecutar(objeto(e), sql, ...parametros);

const maximoDeEnvios = (e: Evento): number => Number(consulta(e, "SELECT COALESCE(MAX(envios), 0) AS m FROM ritmo")[0]?.m ?? 0);

interface Resumen {
  estados: number[];
  cuerpos: string[];
  reentradas: Respuesta[];
  otrosCelulares: Respuesta[];
  /** La ventana de 10 minutos con más envíos de la conexión que la sala llegó a contar. */
  maxEnvios: number;
  /** Cuántas altas nuevas caen en el mismo minuto de reloj, como mucho, según el horario de la prueba. */
  maxAltasPorMinuto: number;
  llavesPedidas: number;
  llamadasAlProveedor: number;
  otrosPedidos: string[];
  filas: number;
  lineas: string[];
  numeros: number[];
  total: number;
  rechazosDeConexion: number;
  rechazosDeFicha: number;
  consola: string;
}

interface Pauta {
  modo: Modo;
  /** En cuánto tiempo llegan las 150, una cada tanto. */
  duracionMs: number;
  /** Todas a la vez, sin esperar la respuesta de ninguna. */
  juntas?: boolean;
  /** Quiénes vuelven a tocar el botón con la misma sesión cuando ya pasó todo. */
  reentran: "todas" | "algunas" | "ninguna";
}

/** Entran las 150 y se juntan todos los números que importan. */
async function correr(pauta: Pauta, consola: { mock: { calls: unknown[][] }; mockClear(): unknown }): Promise<Resumen> {
  consola.mockClear();
  const e = await armarEvento(pauta.modo, { PASE: "1" });
  const estados: number[] = [];
  const cuerpos: string[] = [];
  const horas: number[] = [];
  let maxEnvios = 0;
  if (pauta.juntas) {
    const p = await paseDeLaPantalla(e);
    const respuestas = await Promise.all(Array.from({ length: PERSONAS }, async (_, i) => leer(await enviar(e, i + 1, p))));
    for (const r of respuestas) {
      estados.push(r.estado);
      cuerpos.push(r.cuerpo);
      horas.push(AHORA);
    }
    maxEnvios = maximoDeEnvios(e);
  } else {
    for (let i = 1; i <= PERSONAS; i++) {
      const llega = AHORA + Math.floor(((i - 1) * pauta.duracionMs) / PERSONAS);
      vi.setSystemTime(llega);
      const r = await leer(await enviar(e, i, await paseDeLaPantalla(e)));
      estados.push(r.estado);
      cuerpos.push(r.cuerpo);
      horas.push(llega);
      maxEnvios = Math.max(maxEnvios, maximoDeEnvios(e));
    }
  }
  const porMinuto = new Map<number, number>();
  for (const h of horas) porMinuto.set(Math.floor(h / MINUTO), (porMinuto.get(Math.floor(h / MINUTO)) ?? 0) + 1);

  // Cuando ya pasó todo, quien vuelve a tocar el botón con la misma sesión.
  vi.setSystemTime(AHORA + pauta.duracionMs + 30_000);
  const reentradas: Respuesta[] = [];
  const quienes = pauta.reentran === "todas" ? PERSONAS : pauta.reentran === "algunas" ? 15 : 0;
  for (let i = 1; i <= quienes; i++) {
    // Con "algunas" son las que están a una distancia pareja de la lista: 10, 20, 30 y así.
    const n = pauta.reentran === "todas" ? i : i * 10;
    reentradas.push(await leer(await enviar(e, n, await paseDeLaPantalla(e))));
    maxEnvios = Math.max(maxEnvios, maximoDeEnvios(e));
  }
  const otrosCelulares: Respuesta[] = [];
  if (pauta.modo === "persona" && pauta.reentran !== "ninguna") {
    for (const n of OTROS_CELULARES) {
      otrosCelulares.push(await leer(await enviar(e, n, await paseDeLaPantalla(e), true)));
      maxEnvios = Math.max(maxEnvios, maximoDeEnvios(e));
    }
  }

  const filas = consulta(e, "SELECT n, cuenta FROM equipos ORDER BY n");
  const estadoPublico = (await (await e.mundo.pedir(ruta(e, "/campana/estado"))).json()) as { total: number };
  return {
    estados,
    cuerpos,
    reentradas,
    otrosCelulares,
    maxEnvios,
    maxAltasPorMinuto: Math.max(...porMinuto.values()),
    llavesPedidas: e.llaves.pedidas,
    llamadasAlProveedor: Object.values(e.mundo.proveedor.llamadas).reduce((a, b) => a + b, 0),
    otrosPedidos: e.otrosPedidos,
    filas: filas.length,
    lineas: filas.map((f) => String(f.cuenta)),
    numeros: filas.map((f) => Number(f.n)),
    total: estadoPublico.total,
    rechazosDeConexion: Number(consulta(e, "SELECT COALESCE(SUM(n), 0) AS s FROM campana_rechazos")[0]?.s ?? 0),
    rechazosDeFicha: Number(consulta(e, "SELECT COALESCE(SUM(n), 0) AS s FROM campana_rechazos_ficha")[0]?.s ?? 0),
    consola: consola.mock.calls.map((c) => c.map(String).join(" ")).join("\n"),
  };
}

/** Qué entiende el celular de una respuesta del alta, sin la cuenta ni la línea. */
function queEntiendeElCelular(modo: Modo, r: Respuesta): unknown {
  const lectura: Lectura = (modo === "persona" ? leerAltaDePersona : leerAlta)(r.estado, JSON.parse(r.cuerpo));
  return lectura.tipo === "listo" ? { tipo: "listo", ya: lectura.ya } : lectura;
}

let consola: { mock: { calls: unknown[][] }; mockClear(): unknown };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  consola = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lo que tiene que valer en cualquier evento de 150 personas por la misma red, sea cual sea el reparto. */
function entraronTodas(r: Resumen): void {
  expect(r.estados).toHaveLength(PERSONAS);
  expect(r.estados.filter((e) => e !== 201)).toEqual([]);
  expect(new Set(r.cuerpos)).toEqual(new Set(['{"anotada":true}']));
  expect(r.filas).toBe(PERSONAS);
  expect(r.total).toBe(PERSONAS);
  expect(new Set(r.lineas).size).toBe(PERSONAS);
  expect(r.lineas.every(esLineaDePersona)).toBe(true);
  expect(r.numeros).toEqual(Array.from({ length: PERSONAS }, (_, i) => i + 1));
}

/** Nada frenó a nadie: ningún tope de la conexión, de la dirección ni de la sala. */
function nadieFrenado(r: Resumen): void {
  expect(r.rechazosDeConexion).toBe(0);
  expect(r.rechazosDeFicha).toBe(0);
  expect(r.maxEnvios).toBeLessThan(ENVIOS_CAMPANA_POR_CONEXION);
  expect(r.maxAltasPorMinuto).toBeLessThanOrEqual(CAMPANA_POR_MINUTO);
}

/** Lo que no puede pasar con personas: pedir cuentas, guardar algo que las identifique o dejarlo en la consola. */
function sinProveedorNiRastros(r: Resumen): void {
  expect(r.llamadasAlProveedor).toBe(0);
  expect(r.otrosPedidos).toEqual([]);
  expect(r.consola).not.toMatch(/p1:|example\.org|10000000000000000000|eyJ/u);
}

describe("150 personas por la misma red anotándose con Google", () => {
  it("repartidas en 15 minutos entran todas y nada las frena", async () => {
    const r = await correr({ modo: "persona", duracionMs: 15 * MINUTO, reentran: "todas" }, consola);
    entraronTodas(r);
    nadieFrenado(r);
    sinProveedorNiRastros(r);
    // Una alta cada 6 segundos son 10 por minuto: lejos de las 300 que acepta la sala.
    expect(r.maxAltasPorMinuto).toBe(10);
    // Las llaves públicas de Google se piden una vez y sirven para las 150 y para quienes vuelven.
    expect(r.llavesPedidas).toBe(1);
  }, 60_000);

  it("la segunda alta de la misma persona contesta que ya está, con la misma sesión o desde otro celular", async () => {
    const r = await correr({ modo: "persona", duracionMs: 15 * MINUTO, reentran: "todas" }, consola);
    expect(r.reentradas).toHaveLength(PERSONAS);
    expect(r.reentradas.filter((x) => x.estado !== 200 || x.cuerpo !== '{"anotada":true,"ya":true}')).toEqual([]);
    expect(r.otrosCelulares).toHaveLength(OTROS_CELULARES.length);
    expect(r.otrosCelulares.filter((x) => x.estado !== 200 || x.cuerpo !== '{"anotada":true,"ya":true}')).toEqual([]);
    // Nadie quedó repetida: siguen las 150 filas, con los mismos números.
    expect(r.filas).toBe(PERSONAS);
    expect(r.total).toBe(PERSONAS);
    // El celular lo entiende como anotada, no como un error.
    expect(queEntiendeElCelular("persona", r.reentradas[0]!)).toEqual({ tipo: "listo", ya: true });
    // Volver a entrar no llamó a nadie más.
    expect(r.llavesPedidas).toBe(1);
    expect(r.llamadasAlProveedor).toBe(0);
  }, 60_000);

  it("repartidas en 3 minutos tampoco las frena ningún tope", async () => {
    const r = await correr({ modo: "persona", duracionMs: 3 * MINUTO, reentran: "algunas" }, consola);
    entraronTodas(r);
    nadieFrenado(r);
    sinProveedorNiRastros(r);
    // Una alta cada 1,2 segundos son 50 por minuto: la sala acepta 300.
    expect(r.maxAltasPorMinuto).toBe(50);
    expect(r.llavesPedidas).toBe(1);
    expect(r.reentradas).toHaveLength(15);
    expect(r.reentradas.filter((x) => x.estado !== 200)).toEqual([]);
  }, 60_000);

  it("todas en el mismo minuto y a la vez tampoco: cada una entra y las llaves de Google se piden una sola vez", async () => {
    const r = await correr({ modo: "persona", duracionMs: 0, juntas: true, reentran: "ninguna" }, consola);
    entraronTodas(r);
    nadieFrenado(r);
    sinProveedorNiRastros(r);
    expect(r.maxAltasPorMinuto).toBe(PERSONAS);
    expect(r.maxEnvios).toBe(PERSONAS);
    // Los 150 pedidos llegan juntos y comparten un solo pedido a Google.
    expect(r.llavesPedidas).toBe(1);
  }, 60_000);
});

describe("los mismos topes que una campaña de cuentas", () => {
  it("el mismo evento en una campaña de cuentas deja las mismas cuentas de envíos, filas y rechazos", async () => {
    const personas = await correr({ modo: "persona", duracionMs: 3 * MINUTO, reentran: "algunas" }, consola);
    const cuentas = await correr({ modo: "cuenta", duracionMs: 3 * MINUTO, reentran: "algunas" }, consola);
    expect(cuentas.estados).toEqual(personas.estados);
    expect(cuentas.reentradas.map((x) => x.estado)).toEqual(personas.reentradas.map((x) => x.estado));
    // Las cuatro altas desde otro celular son solo de personas: cada una suma un envío más.
    expect(cuentas.maxEnvios).toBe(personas.maxEnvios - personas.otrosCelulares.length);
    expect(cuentas.maxAltasPorMinuto).toBe(personas.maxAltasPorMinuto);
    expect(cuentas.filas).toBe(personas.filas);
    expect(cuentas.total).toBe(personas.total);
    expect(cuentas.rechazosDeConexion).toBe(personas.rechazosDeConexion);
    expect(cuentas.rechazosDeFicha).toBe(personas.rechazosDeFicha);
    // La diferencia es la que se busca: cuentas le pregunta al proveedor por cada sesión nueva y personas no le pregunta nada.
    expect(cuentas.llamadasAlProveedor).toBeGreaterThanOrEqual(PERSONAS);
    expect(personas.llamadasAlProveedor).toBe(0);
    // Y Google no entra en las campañas de cuentas.
    expect(cuentas.llavesPedidas).toBe(0);
    expect(personas.llavesPedidas).toBe(1);
  }, 60_000);

  it("los topes por sala y por conexión son números que dejan pasar a 150 personas con holgura", () => {
    // La sala acepta 300 personas y 300 altas nuevas por minuto: con la sala llena la respuesta es llena, nunca rapido.
    expect(CAMPANA_MAX).toBeGreaterThanOrEqual(PERSONAS * 2);
    expect(CAMPANA_POR_MINUTO).toBeGreaterThanOrEqual(CAMPANA_MAX);
    // 800 envíos en 10 minutos son más de cinco por persona: cada alta y cada vez que alguien vuelve a tocar el botón suma uno.
    expect(ENVIOS_CAMPANA_POR_CONEXION / PERSONAS).toBeGreaterThan(5);
    expect(VENTANA_CAMPANA_MS).toBe(10 * MINUTO);
    // Quien vuelve a entrar tiene su propio tope por hora, que no depende de la conexión.
    expect(REINGRESOS_POR_PERSONA_POR_HORA).toBeGreaterThanOrEqual(2);
  });

  /** Lleva cada tope a su borde y anota lo que contesta la sala y lo que entiende el celular. */
  async function bordes(modo: Modo): Promise<{ envios: Respuesta[]; llena: Respuesta }> {
    const e = await armarEvento(modo);
    const primera = await leer(await enviar(e, 1, null));
    expect(primera.estado).toBe(201);
    // El envío 800 de la conexión: con 799 todavía entra una más, la siguiente no.
    consulta(e, "UPDATE ritmo SET envios = ?", ENVIOS_CAMPANA_POR_CONEXION - 1);
    const ultima = await leer(await enviar(e, 2, null));
    const frenada = await leer(await enviar(e, 3, null));
    const otraVez = await leer(await enviar(e, 3, null));
    // Quien ya estaba anotada puede volver a entrar aunque el tope esté agotado: no es un envío nuevo.
    const yaEstaba = await leer(await enviar(e, 1, null));
    const envios = [ultima, frenada, otraVez, yaEstaba];

    const lleno = await armarEvento(modo);
    for (let i = 0; i < CAMPANA_MAX; i++) {
      lleno.mundo.ejecutar(
        `sala:${lleno.sala.id}`,
        "INSERT INTO equipos (cuenta, d, estado, v, llave) VALUES (?, 'x', 'aceptado', ?, ?)",
        `relleno${i}`,
        i + 1,
        `llave${i}`,
      );
    }
    const llena = await leer(await enviar(lleno, 1, null));
    return { envios, llena };
  }

  it("llegar al envío 800 de la conexión frena a la siguiente con la misma respuesta y el mismo aviso que en cuentas", async () => {
    const personas = await bordes("persona");
    const cuentas = await bordes("cuenta");
    const [ultima, frenada, otraVez, yaEstaba] = personas.envios;
    expect(ultima?.estado).toBe(201);
    expect(frenada).toEqual({ estado: 429, cuerpo: '{"error":"cupo-conexion"}', espera: "600" });
    expect(otraVez).toEqual(frenada);
    // Quien ya estaba anotada no se frena.
    expect(yaEstaba?.estado).toBe(200);
    // La respuesta es la misma en los dos modos, estado, cuerpo y espera.
    expect(cuentas.envios.map((r) => r.estado)).toEqual(personas.envios.map((r) => r.estado));
    expect(cuentas.envios[1]).toEqual(frenada);
    // Y el celular la lee igual: es un final, no se reintenta, y le sugiere salir por los datos del celular.
    const final = { tipo: "final", motivo: "wifi" };
    expect(queEntiendeElCelular("persona", frenada!)).toEqual(final);
    expect(queEntiendeElCelular("cuenta", cuentas.envios[1]!)).toEqual(final);
  }, 60_000);

  it("la sala con 300 personas contesta llena igual que en cuentas, y el celular no reintenta", async () => {
    const personas = await bordes("persona");
    const cuentas = await bordes("cuenta");
    expect(personas.llena).toEqual({ estado: 429, cuerpo: '{"error":"llena"}', espera: null });
    expect(cuentas.llena).toEqual(personas.llena);
    const final = { tipo: "final", motivo: "llena" };
    expect(queEntiendeElCelular("persona", personas.llena)).toEqual(final);
    expect(queEntiendeElCelular("cuenta", cuentas.llena)).toEqual(final);
  }, 60_000);

  it("un tope por conexión que sí avisa de esperar es el de rapido, y el celular lo reintenta", () => {
    // rapido es el único que le dice al celular que repita. Con la sala en 300 y 300 por minuto no se alcanza con personas nuevas.
    const rapido = { estado: 429, cuerpo: '{"error":"rapido"}', espera: "30" };
    expect(queEntiendeElCelular("persona", rapido)).toMatchObject({ tipo: "otra-vez", familia: "rapido" });
    expect(queEntiendeElCelular("cuenta", rapido)).toMatchObject({ tipo: "otra-vez", familia: "rapido" });
  });
});
