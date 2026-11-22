import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESPERA_ENTRE_CORREOS_DE_TOMA_MS,
  PAUSA_ENTRE_TOMAS_MS,
  type FichaDeCampana,
  type PreparacionDeToma,
} from "../../workers/sala/src/activar-cupos";
import { TOMAS_POR_CUENTA } from "../../workers/sala/src/activar";
import { horaDeLaToma, textoDelCorreoDeToma } from "../../workers/sala/src/correo";
import type { EnlaceDeCorreo } from "../../workers/sala/src/correo";
import { recuperarCampana, type DepsDeTus } from "../../workers/sala/src/tus-campanas";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar, type MundoDeActivar } from "./activar-mundo";
import { firmarParaLaPrueba, personaDePrueba, type PersonaDePrueba } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));
/** Lo que el Worker lee del contrato: las pruebas de rutas con el token viejo lo necesitan para llegar a la comprobación. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * Usar la campaña en esta compu (`POST /v1/campana/recuperar`), el lado del servidor: la toma de una sala viva, la sala muerta que
 * se libera, la campaña activada que todavía no tiene sala y el aviso por correo de cada toma. El Worker entero en Node, con
 * sockets de mentira, un proveedor de cuentas de mentira y el reloj de la prueba.
 */
const AHORA = HORA_DE_LA_PRUEBA;
const HORA = 3_600_000;
const EVENTO = "casa-andina-k7p2";
const TOKEN_22 = /^[A-Za-z0-9_-]{22}$/;
const INTENTO = "I".repeat(22);
const huellaDe = (token: string): string => createHash("sha256").update(token).digest("hex");

let m: MundoDeActivar;
let b: PersonaDePrueba;
let firmado: { texto: string; firma: string };
let sala: { id: string; token: string };

const avanzar = (ms: number): void => void vi.setSystemTime(Date.now() + ms);
const auth = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

const recuperar = (sesion: string, evento: string = EVENTO, extra: Parameters<MundoDeActivar["mundo"]["pedir"]>[1] = {}): Promise<Response> =>
  m.mundo.pedir("/v1/campana/recuperar", { cuerpo: { sesion, evento }, ...extra });

const huellaDelEvento = (): string | undefined =>
  m.mundo.ejecutar("cupos", "SELECT huella FROM eventos_campana WHERE evento = ?", EVENTO)[0]?.huella as string | undefined;

/** Crea la sala de la campaña con un archivo firmado a mano, como lo hace el panel, y deja su texto firmado a mano. */
async function crearSala(cambios: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
  firmado = firmarParaLaPrueba(m.mundo.llavePrivada, m.campana(cambios));
  const r = await m.mundo.pedir("/v1/campana", { cuerpo: { ...firmado, ...extra } });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; token: string };
}

const cerrarSala = async (s: { id: string; token: string }): Promise<void> => {
  const r = await m.mundo.pedir(`/v1/sala/${s.id}`, { metodo: "DELETE", cabeceras: auth(s.token) });
  expect(r.status).toBe(204);
};

async function armar(extra: Record<string, string> = {}): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  m = await montarMundoDeActivar({ TUS_CAMPANAS: "1", ...extra });
  b = personaDePrueba(m.mundo, 2);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la toma de una sala viva", () => {
  beforeEach(async () => {
    await armar();
    sala = await crearSala();
  });

  it("da un token nuevo con el id, cuándo vence la sala y su fase, y deja sin efecto el anterior en cada ruta", async () => {
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { estado: string; id: string; token: string; vence: number; fase: string };
    expect(Object.keys(cuerpo).sort()).toEqual(["estado", "fase", "id", "token", "vence"]);
    expect(cuerpo).toMatchObject({ estado: "viva", id: sala.id, fase: "lista", vence: m.mundo.alarmaDe(sala.id) });
    expect(cuerpo.token).toMatch(TOKEN_22);
    expect(cuerpo.token).not.toBe(sala.token);
    expect(huellaDelEvento()).toBe(huellaDe(cuerpo.token));

    lectura.valor = {
      sello: { listHash: "0".repeat(64), count: 0, numWinners: 2, sorteado: true, organizador: null, ronda: 40_000_000 },
      ganadores: [0],
    };
    const viejo = auth(sala.token);
    const base = `/v1/sala/${sala.id}`;
    const casos: [string, Parameters<typeof m.mundo.pedir>[1]][] = [
      [`${base}/campana/pase`, { metodo: "GET", cabeceras: viejo }],
      [`${base}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: viejo }],
      [`${base}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "sellada", sorteo: "7" }, cabeceras: viejo }],
      [`${base}/campana/quitar`, { cuerpo: { n: 1, motivo: "otro" }, cabeceras: viejo }],
      [`${base}/campana/avisar`, { cuerpo: { cuenta: m.organizadora.cuenta }, cabeceras: viejo }],
      [`${base}/campana/resultado`, { metodo: "PUT", cuerpo: { sorteo: "7", comprobante: "/verificar.html#x" }, cabeceras: viejo }],
      [`${base}/nombres?desde=0`, { metodo: "GET", cabeceras: viejo }],
      [`${base}/equipos?desde=0`, { metodo: "GET", cabeceras: viejo }],
      [base, { metodo: "DELETE", cabeceras: viejo }],
    ];
    for (const [ruta, init] of casos) {
      const mala = await m.mundo.pedir(ruta, init);
      expect(`${init?.metodo ?? "POST"} ${ruta}: ${mala.status}`).toMatch(/: 403$/);
      expect(await mala.json()).toEqual({ error: "token" });
    }
    const nuevo = await m.mundo.pedir(`${base}/campana/pase`, { metodo: "GET", cabeceras: auth(cuerpo.token) });
    expect(nuevo.status).toBe(200);
    expect(await m.mundo.sala(sala.id).viva()).toBe(true);
  });

  it("cierra con 4001 la pantalla que estaba presentada y no toca a la que todavía no se presentó", async () => {
    const presentada = m.mundo.agregarSocket(sala.id, true);
    const sinPresentar = m.mundo.agregarSocket(sala.id, false);
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    expect(presentada.cierres).toEqual([{ codigo: 4001, razon: "tomada" }]);
    expect(sinPresentar.cierres).toEqual([]);
  });

  it("dice la fase en que está la campaña", async () => {
    const abierta = await m.mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth(sala.token) });
    expect(abierta.status).toBe(204);
    expect(await (await recuperar(m.organizadora.token)).json()).toMatchObject({ estado: "viva", fase: "abierta" });
  });

  it("una sala en sellada no se toma: 409 sellada y el token de siempre sigue valiendo", async () => {
    m.mundo.ejecutar(`sala:${sala.id}`, "UPDATE sala SET v = 'sellada' WHERE k = 'fase'");
    const antes = huellaDelEvento();
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "sellada" });
    expect(huellaDelEvento()).toBe(antes);
    expect((await m.mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, { metodo: "GET", cabeceras: auth(sala.token) })).status).toBe(200);
  });

  it("una sala sorteada sí se toma", async () => {
    m.mundo.ejecutar(`sala:${sala.id}`, "UPDATE sala SET v = 'sorteada' WHERE k = 'fase'");
    expect(await (await recuperar(m.organizadora.token)).json()).toMatchObject({ estado: "viva", fase: "sorteada" });
  });

  it("una segunda toma antes de 60 segundos es 429 pausa con Retry-After, y después de la pausa vale otra vez", async () => {
    const primera = (await (await recuperar(m.organizadora.token)).json()) as { token: string };
    avanzar(30_000);
    const pausa = await recuperar(m.organizadora.token);
    expect(pausa.status).toBe(429);
    expect(await pausa.json()).toEqual({ error: "pausa" });
    expect(Number(pausa.headers.get("Retry-After"))).toBe(30);
    expect(pausa.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    // Nada cambió: el token de la primera toma sigue valiendo.
    expect((await m.mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, { metodo: "GET", cabeceras: auth(primera.token) })).status).toBe(200);
    avanzar(PAUSA_ENTRE_TOMAS_MS);
    const segunda = await recuperar(m.organizadora.token);
    expect(segunda.status).toBe(200);
    const cuerpo = (await segunda.json()) as { token: string };
    expect(cuerpo.token).not.toBe(primera.token);
    expect((await m.mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, { metodo: "GET", cabeceras: auth(primera.token) })).status).toBe(403);
    expect(huellaDelEvento()).toBe(huellaDe(cuerpo.token));
  });

  it("dos tomas a la vez dejan una sola ganadora: la otra espera la pausa, y la sala y el evento guardan el mismo token", async () => {
    const [x, y] = await Promise.all([recuperar(m.organizadora.token), recuperar(m.organizadora.token)]);
    expect([x.status, y.status].sort()).toEqual([200, 429]);
    const buena = (await (x.status === 200 ? x : y).json()) as { token: string };
    expect(huellaDelEvento()).toBe(huellaDe(buena.token));
    expect((await m.mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, { metodo: "GET", cabeceras: auth(buena.token) })).status).toBe(200);
  });

  it("el tope de tomas por cuenta: la once en 10 minutos es 429 cupo-cuenta, con permisos", async () => {
    for (let i = 0; i < TOMAS_POR_CUENTA; i++) {
      expect((await recuperar(m.organizadora.token)).status).toBe(200);
      // Se saltea la pausa de cada campaña para mirar solo el tope de la cuenta.
      m.mundo.ejecutar("cupos", "UPDATE tomas SET ultima_ms = 0");
    }
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "cupo-cuenta" });
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
  });

  it("el reintento de la creación con el intento de antes da ya-existe después de una toma", async () => {
    await m.mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: auth(sala.token) });
    // Una campaña nueva con un token inventado por quien organiza (así el pedido repetido devuelve la misma sala).
    const propia = await crearSala({ evento: "otra-campana-x1" }, { intento: INTENTO });
    expect(propia.token).toBe(INTENTO);
    const repetido = await m.mundo.pedir("/v1/campana", { cuerpo: { ...firmado, intento: INTENTO } });
    expect(repetido.status).toBe(201);
    expect(((await repetido.json()) as { id: string }).id).toBe(propia.id);
    expect((await recuperar(m.organizadora.token, "otra-campana-x1")).status).toBe(200);
    const despues = await m.mundo.pedir("/v1/campana", { cuerpo: { ...firmado, intento: INTENTO } });
    expect(despues.status).toBe(409);
    expect(await despues.json()).toEqual({ error: "ya-existe" });
  });
});

describe("una cuenta ajena no toma nada", () => {
  beforeEach(async () => {
    await armar();
    sala = await crearSala();
  });

  const intactaLaSala = async (): Promise<void> => {
    expect((await m.mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, { metodo: "GET", cabeceras: auth(sala.token) })).status).toBe(200);
  };

  it("sin campaña de esa cuenta es 404 no-existe, igual que un evento que no existe", async () => {
    const ajena = await recuperar(b.token);
    expect(ajena.status).toBe(404);
    expect(await ajena.json()).toEqual({ error: "no-existe" });
    const inexistente = await recuperar(m.organizadora.token, "evento-que-no-existe");
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual({ error: "no-existe" });
    await intactaLaSala();
  });

  it("con una fila a mano del evento de otra cuenta: 404, con la dueña escrita o sin escribir, y el token no cambia", async () => {
    m.mundo.ejecutar("cupos", "UPDATE campanas_de_cuenta SET cuenta = ? WHERE evento = ?", b.cuenta, EVENTO);
    const antes = huellaDelEvento();
    // La dueña escrita en el evento es la organizadora: la fila de B no vale.
    expect((await recuperar(b.token)).status).toBe(404);
    expect(huellaDelEvento()).toBe(antes);
    await intactaLaSala();
    // Sin la dueña escrita pasa la primera comprobación, pero la sala nombra a otra cuenta: 404 y el token sigue siendo el mismo.
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 1 WHERE evento = ?", EVENTO);
    const r = await recuperar(b.token);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no-existe" });
    expect(huellaDelEvento()).toBe(antes);
    await intactaLaSala();
    expect(m.mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'gen'")).toEqual([]);
  });

  it("con la sala muerta tampoco: 404 y el token no se reescribe", async () => {
    await cerrarSala(sala);
    const antes = huellaDelEvento();
    expect((await recuperar(b.token)).status).toBe(404);
    expect(huellaDelEvento()).toBe(antes);
    m.mundo.ejecutar("cupos", "UPDATE campanas_de_cuenta SET cuenta = ? WHERE evento = ?", b.cuenta, EVENTO);
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 1 WHERE evento = ?", EVENTO);
    expect((await recuperar(b.token)).status).toBe(404);
    expect(huellaDelEvento()).toBe(antes);
  });
});

describe("la sala muerta", () => {
  beforeEach(async () => {
    await armar();
    sala = await crearSala();
  });

  it("con el cierre por delante y la dueña igual da el texto, la firma y un token anterior que reemplaza la sala", async () => {
    await cerrarSala(sala);
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { estado: string; texto: string; firma: string; anterior: string };
    expect(cuerpo).toMatchObject({ estado: "activada", texto: firmado.texto, firma: firmado.firma });
    expect(cuerpo.anterior).toMatch(TOKEN_22);
    expect(huellaDelEvento()).toBe(huellaDe(cuerpo.anterior));

    // Sin el token, o con el de la sala vieja, sigue siendo ya-existe: la sala no se regala.
    const sinToken = await m.mundo.pedir("/v1/campana", { cuerpo: firmado });
    expect(sinToken.status).toBe(409);
    const conElViejo = await m.mundo.pedir("/v1/campana", { cuerpo: firmado, cabeceras: auth(sala.token) });
    expect(conElViejo.status).toBe(409);
    // Con el anterior, la sala se reemplaza.
    const nueva = await m.mundo.pedir("/v1/campana", { cuerpo: firmado, cabeceras: auth(cuerpo.anterior) });
    expect(nueva.status).toBe(201);
    const creada = (await nueva.json()) as { id: string; token: string };
    expect(creada.id).not.toBe(sala.id);
    expect(await m.mundo.sala(creada.id).viva()).toBe(true);
  });

  it("una sala que venció sola por su alarma se libera igual", async () => {
    await m.mundo.sala(sala.id).alarm();
    expect(await m.mundo.sala(sala.id).viva()).toBe(false);
    expect(await (await recuperar(m.organizadora.token)).json()).toMatchObject({ estado: "activada", anterior: expect.stringMatching(TOKEN_22) });
  });

  it("si la sala no dejó dueña escrita, nadie la recupera: 404", async () => {
    await cerrarSala(sala);
    m.mundo.ejecutar("cupos", "UPDATE eventos_campana SET duena = NULL, revisada = 1 WHERE evento = ?", EVENTO);
    const antes = huellaDelEvento();
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no-existe" });
    expect(huellaDelEvento()).toBe(antes);
  });

  it("un evento sellado no se reabre: 409 terminada, y el token viejo sigue sin reemplazarlo", async () => {
    await cerrarSala(sala);
    await m.mundo.cupos().marcarSellado(EVENTO, AHORA + 2 * HORA);
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "terminada" });
    const reemplazo = await m.mundo.pedir("/v1/campana", { cuerpo: firmado, cabeceras: auth(sala.token) });
    expect(reemplazo.status).toBe(409);
  });

  it("con el cierre ya pasado es 409 terminada", async () => {
    await cerrarSala(sala);
    avanzar(HORA + 1);
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "terminada" });
  });
});

describe("la campaña activada que todavía no tiene sala", () => {
  let activada: { texto: string; firma: string };

  beforeEach(async () => {
    await armar();
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar({ texto: JSON.stringify(m.campana()), sesion: m.organizadora.token });
    expect(r.status).toBe(200);
    activada = (await r.json()) as { texto: string; firma: string };
  });

  it("da el texto y la firma, sin token anterior, para crear la sala por el camino de siempre", async () => {
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "activada", texto: activada.texto, firma: activada.firma });
    const creada = await m.mundo.pedir("/v1/campana", { cuerpo: activada });
    expect(creada.status).toBe(201);
  });

  it("con el cierre pasado o con el evento sellado es 409 terminada", async () => {
    await m.mundo.cupos().marcarSellado(EVENTO, AHORA + 2 * HORA);
    expect(await (await recuperar(m.organizadora.token)).json()).toEqual({ error: "terminada" });
    m.mundo.ejecutar("cupos", "DELETE FROM eventos_sellados");
    avanzar(HORA + 1);
    const r = await recuperar(m.organizadora.token);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "terminada" });
  });

  it("una reserva reciente es 409 ocupado, y una reserva vieja que nunca se confirmó vuelve a ser activada", async () => {
    m.mundo.ejecutar("cupos", "INSERT INTO eventos_campana (evento, dia, sala, reserva, en_ms) VALUES (?, '2026-11-21', NULL, 'r', ?)", EVENTO, AHORA - 10_000);
    const ocupado = await recuperar(m.organizadora.token);
    expect(ocupado.status).toBe(409);
    expect(await ocupado.json()).toEqual({ error: "ocupado" });
    avanzar(60_000);
    expect(await (await recuperar(m.organizadora.token)).json()).toMatchObject({ estado: "activada" });
  });
});

describe("el pedido y sus rechazos", () => {
  beforeEach(async () => {
    await armar();
    sala = await crearSala();
  });

  it("un evento con otra forma es 400 forma con el campo evento, y sin JSON es 400 forma cuerpo", async () => {
    for (const evento of [undefined, 7, "A", "con espacio", "x".repeat(60)]) {
      const r = await m.mundo.pedir("/v1/campana/recuperar", { cuerpo: { sesion: m.organizadora.token, evento } });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "forma", campo: "evento" });
    }
    const sinCuerpo = await m.mundo.pedir("/v1/campana/recuperar", { metodo: "POST" });
    expect(sinCuerpo.status).toBe(400);
    expect(await sinCuerpo.json()).toEqual({ error: "forma", campo: "cuerpo" });
  });

  it("una sesión sin forma de token es 401 sin llamar al proveedor, y fuera del sitio es 403 origen, los dos con permisos", async () => {
    const antes = { ...m.mundo.proveedor.llamadas };
    const sinForma = await recuperar("corta");
    expect(sinForma.status).toBe(401);
    expect(m.mundo.proveedor.llamadas).toEqual(antes);
    expect(sinForma.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    const fuera = await recuperar(m.organizadora.token, EVENTO, { cabeceras: { Origin: "https://malo.example" } });
    expect(fuera.status).toBe(403);
    expect(await fuera.json()).toEqual({ error: "origen" });
    expect(fuera.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
  });

  it("una sesión que el proveedor no reconoce es 401, y el proveedor caído es 502, sin tocar la sala", async () => {
    const antes = huellaDelEvento();
    expect((await recuperar("tok_desconocida_" + "z".repeat(24))).status).toBe(401);
    m.mundo.proveedor.caido = true;
    expect((await recuperar(b.token)).status).toBe(502);
    expect(huellaDelEvento()).toBe(antes);
  });

  it("el preflight y los permisos de la ruta de usar la campaña", async () => {
    const o = await m.mundo.pedir("/v1/campana/recuperar", { metodo: "OPTIONS" });
    expect(o.status).toBe(204);
    expect(o.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    const get = await m.mundo.pedir("/v1/campana/recuperar", { metodo: "GET" });
    expect(get.status).toBe(404);
    expect(get.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
  });

  it("crear una campaña sigue igual: la ruta de siempre no se confunde con la nueva", async () => {
    const otra = await m.mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(m.mundo.llavePrivada, m.campana({ evento: "otra-campana-y2" })) });
    expect(otra.status).toBe(201);
  });
});

describe("el aviso por correo de cada toma", () => {
  interface Mensaje {
    to: string;
    from: { email: string; name: string };
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  }
  let enviados: Mensaje[];
  let registro: string[];
  let enlace: EnlaceDeCorreo;
  const CORREO = "ana@example.org";

  const fila = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "usuario1",
    first_name: "Ana",
    email: CORREO,
    ...extra,
  });

  async function armarConCorreo(extra: Record<string, string> = {}): Promise<void> {
    await armar({ CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org", CORREO_TOMA: "1", ...extra });
    enviados = [];
    enlace = { send: vi.fn(async (msg: Mensaje) => (enviados.push(msg), { messageId: "m1" })) };
    m.mundo.env.CORREO = enlace;
    m.mundo.proveedor.usuarios.set("usuario1", [fila()]);
    registro = [];
    for (const canal of ["log", "warn", "error"] as const) {
      vi.spyOn(console, canal).mockImplementation((...args: unknown[]) => void registro.push(args.map(String).join(" ")));
    }
    sala = await crearSala();
  }

  it("una toma buena le escribe a la cuenta de la sesión, con la hora de la campaña, y nada más", async () => {
    await armarConCorreo();
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(1);
    const c = enviados[0] as Mensaje;
    expect(c.to).toBe(CORREO);
    expect(c.replyTo).toBe("hola@tinkazo.app");
    expect(c.subject).toBe("Tu campaña de Casa Andina se abrió en otra compu");
    expect(c.text).toBe(
      [
        "Hola Ana.",
        "",
        "Tu campaña de Casa Andina se abrió con tu cuenta en otra compu a las 11:00.",
        "",
        "Si fuiste vos, no hace falta hacer nada. Si no fuiste vos, respondé este correo.",
        "",
        "Tinkazo nunca te pide una contraseña ni un pago.",
      ].join("\n"),
    );
    for (const texto of [c.subject, c.text]) expect(texto).not.toMatch(/[;«»—→·]/u);
    for (const texto of [c.subject, c.text, c.html]) expect(texto).not.toContain("hola@tinkazo.app");
    expect(c.html).not.toMatch(/[«»—→·]/u);
    expect(c.html).not.toContain("<a ");
  });

  it("sale en inglés si la ficha de la persona lo dice", async () => {
    await armarConCorreo();
    m.mundo.proveedor.usuarios.set("usuario1", [fila({ language: "en" })]);
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    const c = enviados[0] as Mensaje;
    expect(c.subject).toBe("Your Casa Andina campaign was opened on another computer");
    expect(c.text).toContain("Hi Ana.");
    expect(c.text).toContain("Your Casa Andina campaign was opened with your account on another computer at 11:00.");
    expect(c.text).toContain("If it was you, there's nothing to do. If it wasn't you, reply to this email.");
    for (const texto of [c.subject, c.text]) expect(texto).not.toMatch(/[;«»—→·]/u);
  });

  it("sale una vez aunque haya dos tomas en 10 minutos, y otra cuando pasaron los 10 minutos", async () => {
    await armarConCorreo();
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    avanzar(PAUSA_ENTRE_TOMAS_MS + 1_000);
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(1);
    avanzar(ESPERA_ENTRE_CORREOS_DE_TOMA_MS);
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(2);
  });

  it("no sale con el interruptor apagado ni sin el correo prendido, y la toma anda igual", async () => {
    await armarConCorreo({ CORREO_TOMA: "0" });
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(0);
    await armarConCorreo({ CORREO_GANADORAS: "0" });
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(0);
    await armarConCorreo({ CORREO_TOMA: "" });
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(0);
  });

  it("no sale en la rama de la campaña activada ni cuando la toma no se hace", async () => {
    await armarConCorreo();
    m.mundo.ejecutar(`sala:${sala.id}`, "UPDATE sala SET v = 'sellada' WHERE k = 'fase'");
    expect((await recuperar(m.organizadora.token)).status).toBe(409);
    expect((await recuperar(b.token)).status).toBe(404);
    await cerrarSala(sala);
    avanzar(PAUSA_ENTRE_TOMAS_MS);
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(0);
  });

  it("si la ficha no tiene correo o el envío falla, la toma se hace igual y el registro no dice nada de la persona", async () => {
    await armarConCorreo();
    m.mundo.proveedor.usuarios.set("usuario1", [fila({ email: undefined })]);
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(0);
    avanzar(PAUSA_ENTRE_TOMAS_MS + ESPERA_ENTRE_CORREOS_DE_TOMA_MS);
    m.mundo.proveedor.usuarios.set("usuario1", [fila()]);
    enlace.send = vi.fn(async () => {
      throw Object.assign(new Error(`no sale a ${CORREO}`), { code: "E_DAILY_LIMIT_EXCEEDED" });
    });
    expect((await recuperar(m.organizadora.token)).status).toBe(200);
    await m.mundo.esperarSegundoPlano();
    const todo = registro.join("\n");
    expect(todo).toContain("correo-toma");
    for (const secreto of [CORREO, "Ana", m.organizadora.cuenta, m.organizadora.token, sala.token]) expect(todo).not.toContain(secreto);
  });

  it("el registro de una toma buena tampoco lleva la dirección, el nombre, la cuenta ni la sesión", async () => {
    await armarConCorreo();
    const r = await recuperar(m.organizadora.token);
    const cuerpo = (await r.json()) as { token: string };
    await m.mundo.esperarSegundoPlano();
    expect(enviados).toHaveLength(1);
    const todo = registro.join("\n");
    for (const secreto of [CORREO, "Ana", m.organizadora.cuenta, m.organizadora.token, cuerpo.token, sala.token]) expect(todo).not.toContain(secreto);
  });
});

describe("el texto del correo de toma", () => {
  it("la hora sale en la zona de la campaña y una zona que no existe no pierde el aviso", () => {
    expect(horaDeLaToma(AHORA, "America/La_Paz", "es")).toBe("11:00");
    expect(horaDeLaToma(AHORA, "America/La_Paz", "en")).toBe("11:00");
    expect(horaDeLaToma(AHORA + 14 * HORA, "America/La_Paz", "es")).toBe("01:00");
    expect(horaDeLaToma(AHORA, "Marte/Olimpo", "es")).toBe("15:00");
  });

  it("sin nombre saluda sin nombre, limpia el de la empresa y escapa lo que va al HTML", () => {
    const c = textoDelCorreoDeToma("es", { nombre: null, empresa: "  Casa <b>Andina</b> \n ", hora: "11:00" });
    expect(c.texto.split("\n")[0]).toBe("Hola.");
    expect(c.html).toContain("Casa &lt;b&gt;Andina&lt;/b&gt;");
    expect(c.html).not.toContain("<b>");
    const vacio = textoDelCorreoDeToma("en", { nombre: null, empresa: "\u200b", hora: "11:00" });
    expect(vacio.asunto).toBe("Your Tinkazo campaign was opened on another computer");
  });
});

/* -------------------------------------------------------------- las ramas raras, con puertos de mentira */

describe("las ramas que el mundo de pruebas no puede provocar", () => {
  const CUENTA = Keypair.random().publicKey();
  const SESION = "tok_buena_" + "x".repeat(30);
  const ficha = (cambios: Partial<FichaDeCampana> = {}): FichaDeCampana => ({
    texto: "{}",
    firma: "f",
    cierraMs: AHORA + HORA,
    sorteoMs: AHORA + 2 * HORA,
    empresa: "Casa Andina",
    zona: "America/La_Paz",
    hayFila: true,
    sala: "Sala0001",
    enMs: AHORA,
    duena: CUENTA,
    sellado: false,
    ...cambios,
  });

  interface Cuenta {
    llamadas: string[];
    deps(c: {
      ficha?: FichaDeCampana | null;
      prepararToma?: PreparacionDeToma;
      cambiarToken?: { ok: true; fase: "abierta"; vence: number } | { ok: false; motivo: string };
      confirmarToma?: boolean;
      reescribir?: boolean;
      vivas?: boolean[];
      aviso?: boolean;
      avisoPrendido?: boolean;
    }): DepsDeTus;
  }

  const mundillo: Cuenta = {
    llamadas: [],
    deps(c) {
      const vivas = [...(c.vivas ?? [true])];
      const registrar = (x: string): void => void mundillo.llamadas.push(x);
      return {
        verificar: {
          ip: "g1",
          ahora: AHORA,
          proveedor: {
            verificar: async () => ({ ok: true as const, usuario: "u1", vence: AHORA + HORA, cuenta: CUENTA, via: "google" as const }),
            billeteraDe: async () => ({ ok: true as const, cuenta: CUENTA }),
            conocida: async () => false,
          },
          topes: { antes: async () => ({ ok: true as const }), rechazo: async () => undefined, tope: async () => ({ ok: true as const }) },
        },
        cupos: {
          campanasDeCuenta: async () => [],
          campanaDeCuenta: async () => (c.ficha === undefined ? ficha() : c.ficha),
          prepararToma: async () => (registrar("preparar"), c.prepararToma ?? { ok: true as const, gen: 1 }),
          confirmarToma: async () => (registrar("confirmar"), c.confirmarToma ?? true),
          reescribirHuella: async () => (registrar("reescribir"), c.reescribir ?? true),
          reservarCorreoDeToma: async () => (registrar("reservar-correo"), c.aviso ?? true),
        },
        sala: () => ({
          resumenDeCampana: async () => ({ viva: false as const }),
          viva: async () => vivas.length > 1 ? (vivas.shift() as boolean) : (vivas[0] as boolean),
          cambiarToken: async () => (registrar("cambiar"), c.cambiarToken ?? { ok: true as const, fase: "abierta" as const, vence: AHORA + HORA }),
        }),
        barrer: async () => undefined,
        nuevoToken: () => "N".repeat(22),
        huellaDe: async (t) => `h-${t}`,
        avisoDeTomaPrendido: c.avisoPrendido ?? false,
      };
    },
  };

  beforeEach(() => {
    mundillo.llamadas = [];
  });

  it("una toma buena confirma al final y arma el aviso solo con el aviso prendido y un cupo de correo", async () => {
    const sin = await recuperarCampana(SESION, EVENTO, mundillo.deps({}));
    expect(sin.respuesta).toEqual({ estado: 200, cuerpo: { estado: "viva", id: "Sala0001", token: "N".repeat(22), vence: AHORA + HORA, fase: "abierta" } });
    expect(sin.aviso).toBeUndefined();
    expect(mundillo.llamadas).toEqual(["preparar", "cambiar", "confirmar"]);
    mundillo.llamadas = [];
    const con = await recuperarCampana(SESION, EVENTO, mundillo.deps({ avisoPrendido: true }));
    expect(con.aviso).toEqual({ evento: EVENTO, empresa: "Casa Andina", zona: "America/La_Paz", ahora: AHORA });
    expect(mundillo.llamadas).toEqual(["preparar", "cambiar", "confirmar", "reservar-correo"]);
    mundillo.llamadas = [];
    const yaAvisada = await recuperarCampana(SESION, EVENTO, mundillo.deps({ avisoPrendido: true, aviso: false }));
    expect(yaAvisada.aviso).toBeUndefined();
    expect(yaAvisada.respuesta.estado).toBe(200);
  });

  it("si la sala murió en el medio de la toma, sigue por la rama de la sala muerta y da el token anterior", async () => {
    const r = await recuperarCampana(SESION, EVENTO, mundillo.deps({ vivas: [true, false], cambiarToken: { ok: false, motivo: "no-existe" } }));
    expect(r.respuesta).toEqual({ estado: 200, cuerpo: { estado: "activada", texto: "{}", firma: "f", anterior: "N".repeat(22) } });
    expect(mundillo.llamadas).toEqual(["preparar", "cambiar", "reescribir"]);
    expect(r.aviso).toBeUndefined();
  });

  it("si la sala murió en el medio y el evento ya se selló, es terminada y no libera nada", async () => {
    const r = await recuperarCampana(SESION, EVENTO, mundillo.deps({ ficha: ficha({ sellado: true }), vivas: [true, false], cambiarToken: { ok: false, motivo: "no-existe" } }));
    expect(r.respuesta).toEqual({ estado: 409, cuerpo: { error: "terminada" } });
    expect(mundillo.llamadas).not.toContain("reescribir");
  });

  it("si la sala dice que no existe pero sigue viva, nombra a otra cuenta: 404 y no se confirma nada", async () => {
    const r = await recuperarCampana(SESION, EVENTO, mundillo.deps({ vivas: [true, true], cambiarToken: { ok: false, motivo: "no-existe" } }));
    expect(r.respuesta).toEqual({ estado: 404, cuerpo: { error: "no-existe" } });
    expect(mundillo.llamadas).toEqual(["preparar", "cambiar"]);
  });

  it("una toma que perdió contra otra (vieja), una forma rara o una confirmación perdida es 409 ocupado, sin aviso", async () => {
    for (const c of [
      { cambiarToken: { ok: false as const, motivo: "vieja" } },
      { cambiarToken: { ok: false as const, motivo: "forma" } },
      { confirmarToma: false },
    ]) {
      const r = await recuperarCampana(SESION, EVENTO, mundillo.deps({ ...c, avisoPrendido: true }));
      expect(r.respuesta).toEqual({ estado: 409, cuerpo: { error: "ocupado" } });
      expect(r.aviso).toBeUndefined();
    }
    expect(mundillo.llamadas).not.toContain("reservar-correo");
  });

  it("la pausa trae cuántos segundos faltan, y una dueña que cambió entre la lectura y la toma es 404", async () => {
    const pausa = await recuperarCampana(SESION, EVENTO, mundillo.deps({ prepararToma: { ok: false, motivo: "pausa", esperaS: 42 } }));
    expect(pausa.respuesta).toEqual({ estado: 429, cuerpo: { error: "pausa" }, esperaS: 42 });
    const otra = await recuperarCampana(SESION, EVENTO, mundillo.deps({ prepararToma: { ok: false, motivo: "no-existe" } }));
    expect(otra.respuesta).toEqual({ estado: 404, cuerpo: { error: "no-existe" } });
    expect(mundillo.llamadas).not.toContain("cambiar");
  });

  it("si el token de la sala muerta no se puede reescribir porque la sala cambió, es 409 ocupado", async () => {
    const r = await recuperarCampana(SESION, EVENTO, mundillo.deps({ vivas: [false], reescribir: false }));
    expect(r.respuesta).toEqual({ estado: 409, cuerpo: { error: "ocupado" } });
  });
});
