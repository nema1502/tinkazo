import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { huellaDeLlave, huellaDePersona, leerTextoDeCampana, listaDeLaCampana, salDeCampana } from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import { leerParaActivar } from "../../workers/sala/src/activar";
import { lineaDePersona } from "../../workers/sala/src/linea-persona";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar } from "./activar-mundo";
import { campanaDePrueba, firmarParaLaPrueba, montarMundo, type MundoDeSala, type SalaDeCampana } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia cada prueba. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * El premio en mano de una campaña de personas: el texto firmado dice qué se entrega con `premio_en_mano` y los premios van en
 * "0". Solo lo firma Tinkazo a mano (la activación sola lo rechaza) y la sala sigue llevando la campaña si se apagan los
 * interruptores de las personas: solo deja de crear campañas de ese modo y de anotar gente nueva.
 */
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const CLIENTE = "cliente-de-prueba.apps.example.org";
const RONDA = 40_000_000;
const SORTEO = "123456789";
const COMPROBANTE = "/verificar.html?x=1";
const EN_MANO = { es: "Auriculares", en: "Headphones" };
const MANO = { identidad: "persona", premio_en_mano: EN_MANO, premios: ["0", "0"] };
const llaveDe = (n: number): string => `celular${n}`.padEnd(22, "x");

const lee = (cambios: Record<string, unknown>) => leerTextoDeCampana(JSON.stringify(campanaDePrueba(AHORA, cambios)), AHORA);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("premio_en_mano en el texto firmado", () => {
  it("con identidad persona y todos los premios en 0, se acepta", () => {
    expect(lee(MANO)).toMatchObject({ ok: true, identidad: "persona", premios: 2 });
    expect(lee({ ...MANO, premios: ["0"] })).toMatchObject({ ok: true, identidad: "persona", premios: 1 });
    expect(lee({ ...MANO, premios: Array(10).fill("0") })).toMatchObject({ ok: true, premios: 10 });
  });

  it("de 1 a 60 caracteres en cada idioma", () => {
    expect(lee({ ...MANO, premio_en_mano: { es: "a", en: "b" } })).toMatchObject({ ok: true });
    expect(lee({ ...MANO, premio_en_mano: { es: "a".repeat(60), en: "b".repeat(60) } })).toMatchObject({ ok: true });
    for (const malo of [
      { es: "", en: "Headphones" },
      { es: "Auriculares", en: "" },
      { es: "a".repeat(61), en: "Headphones" },
      { es: "Auriculares", en: "b".repeat(61) },
    ]) {
      expect(lee({ ...MANO, premio_en_mano: malo }), JSON.stringify(malo)).toEqual({ ok: false, motivo: "forma", campo: "premio_en_mano" });
    }
  });

  it("tiene que ser un objeto con los dos textos, sin controles, invisibles ni solo espacios", () => {
    const malos: unknown[] = [
      null,
      "Auriculares",
      1,
      true,
      [],
      [EN_MANO],
      {},
      { es: "Auriculares" },
      { en: "Headphones" },
      { es: 1, en: "Headphones" },
      { es: "Auriculares", en: null },
      { es: "Auriculares", en: ["Headphones"] },
      { es: "Auri\nculares", en: "Headphones" },
      { es: "Auriculares", en: "Head\tphones" },
      { es: "Auricu​culares", en: "Headphones" },
      { es: "Auriculares", en: "Head\u0085phones" },
      { es: "   ", en: "Headphones" },
      { es: "Auriculares", en: " " },
    ];
    for (const malo of malos) {
      expect(lee({ ...MANO, premio_en_mano: malo }), JSON.stringify(malo)).toEqual({ ok: false, motivo: "forma", campo: "premio_en_mano" });
    }
  });

  it("sin identidad persona no vale, con o sin identidad cuenta", () => {
    expect(lee({ premio_en_mano: EN_MANO, premios: ["0", "0"] })).toEqual({ ok: false, motivo: "forma", campo: "premio_en_mano" });
    expect(lee({ identidad: "cuenta", premio_en_mano: EN_MANO, premios: ["0", "0"] })).toEqual({ ok: false, motivo: "forma", campo: "premio_en_mano" });
    expect(lee({ premio_en_mano: EN_MANO })).toEqual({ ok: false, motivo: "forma", campo: "premio_en_mano" });
  });

  it("con algún monto distinto de 0 no vale: el premio en mano no lleva dólares", () => {
    for (const premios of [["400000000", "200000000"], ["0", "1"], ["1", "0"], ["00", "0"], ["0", "000"]]) {
      expect(lee({ ...MANO, premios }), JSON.stringify(premios)).toEqual({ ok: false, motivo: "forma", campo: "premios" });
    }
  });

  it("identidad persona con montos y sin premio en mano se sigue aceptando, y los premios en 0 sin él también", () => {
    expect(lee({ identidad: "persona" })).toMatchObject({ ok: true, identidad: "persona", premios: 2 });
    expect(lee({ premios: ["0", "0"] })).toMatchObject({ ok: true, premios: 2 });
    expect(lee({ identidad: "persona", premios: ["0", "0"] })).toMatchObject({ ok: true, identidad: "persona" });
  });

  it("una campaña sin el campo se lee exactamente como siempre", () => {
    expect(lee({})).toEqual({
      ok: true,
      evento: "feria-del-libro",
      red: "testnet",
      cierraMs: AHORA + 3_600_000,
      sorteoMs: AHORA + 7_200_000,
      premios: 2,
      organizadora: null,
    });
  });

  it("la forma se mira antes de que venza: una vencida con el campo mal dice el campo", () => {
    expect(lee({ ...MANO, premio_en_mano: "x", cierra_ms: AHORA - 1 })).toEqual({ ok: false, motivo: "forma", campo: "premio_en_mano" });
    expect(lee({ ...MANO, cierra_ms: AHORA - 1 })).toEqual({ ok: false, motivo: "vencida", campo: "cierra_ms" });
  });
});

describe("crear una sala con premio en mano", () => {
  const archivo = (mundo: MundoDeSala, cambios: Record<string, unknown>) => firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, cambios));

  it("con los interruptores prendidos se crea y es una sala de personas", async () => {
    const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    const r = await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo, MANO) });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(mundo.ejecutar(`sala:${id}`, "SELECT v FROM sala WHERE k = 'identidad'")).toEqual([{ v: "persona" }]);
  });

  it("con los interruptores apagados, la sala no la crea", async () => {
    const mundo = await montarMundo({});
    const r = await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo, MANO) });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "personas-apagadas" });
  });

  it("sin identidad persona no se crea con ningún interruptor, y el campo mal escrito tampoco", async () => {
    const prendido = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    for (const cambios of [{ premio_en_mano: EN_MANO, premios: ["0", "0"] }, { ...MANO, premio_en_mano: { es: "x" } }, { ...MANO, premios: ["5", "0"] }]) {
      const r = await prendido.pedir("/v1/campana", { cuerpo: archivo(prendido, cambios) });
      expect(r.status, JSON.stringify(cambios)).toBe(400);
      expect(await r.json()).toEqual({ error: "forma" });
    }
  });
});

describe("la activación sola no firma campañas de personas ni de premio en mano", () => {
  const hoy = (m: Awaited<ReturnType<typeof montarMundoDeActivar>>, cambios: Record<string, unknown>) => JSON.stringify(m.campana(cambios));

  it("el lector lo rechaza, sin importar nada más", async () => {
    const m = await montarMundoDeActivar({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    expect(leerParaActivar(hoy(m, {}), HORA_DE_LA_PRUEBA)).toMatchObject({ ok: true });
    expect(leerParaActivar(hoy(m, { identidad: "persona" }), HORA_DE_LA_PRUEBA)).toEqual({ ok: false, error: "forma", campo: "identidad" });
    expect(leerParaActivar(hoy(m, { identidad: "cuenta" }), HORA_DE_LA_PRUEBA)).toMatchObject({ ok: true });
    expect(leerParaActivar(hoy(m, { ...MANO }), HORA_DE_LA_PRUEBA)).toEqual({ ok: false, error: "forma", campo: "identidad" });
    expect(leerParaActivar(hoy(m, { premio_en_mano: EN_MANO }), HORA_DE_LA_PRUEBA)).toEqual({ ok: false, error: "forma", campo: "premio_en_mano" });
    expect(leerParaActivar(hoy(m, { premio_en_mano: null }), HORA_DE_LA_PRUEBA)).toEqual({ ok: false, error: "forma", campo: "premio_en_mano" });
  });

  it("el pedido de activar con los interruptores prendidos no firma nada ni gasta el pago", async () => {
    const m = await montarMundoDeActivar({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    vi.setSystemTime(HORA_DE_LA_PRUEBA);
    m.horizon.pagos = [m.pagoCompleto("casa-andina-k7p2")];
    for (const cambios of [{ identidad: "persona" }, MANO, { premio_en_mano: EN_MANO }]) {
      const r = await m.activar({ texto: hoy(m, cambios), sesion: m.organizadora.token });
      expect(r.status, JSON.stringify(cambios)).toBe(400);
      expect(await r.json()).toMatchObject({ error: "forma" });
    }
    expect(m.horizon.cuentasMiradas).toEqual([]);
    const buena = await m.activar({ texto: hoy(m, {}), sesion: m.organizadora.token });
    expect(buena.status).toBe(200);
  });
});

/** Una sala de personas con premio en mano, con cuatro personas anotadas, y la forma de apagarle los interruptores. */
describe("una sala de personas que ya existe, con los interruptores apagados", () => {
  const apagados: [string, (m: MundoDeSala) => void][] = [
    ["DIFERIDA en 0", (m) => void (m.env.DIFERIDA = "0")],
    ["DIFERIDA sin definir", (m) => void delete m.env.DIFERIDA],
    ["sin identificador de Google", (m) => void (m.env.GOOGLE_CLIENT_ID = "")],
    ["los dos", (m) => { m.env.DIFERIDA = "0"; m.env.GOOGLE_CLIENT_ID = ""; }],
  ];
  const auth = (sala: SalaDeCampana): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });
  const ruta = (sala: SalaDeCampana, resto: string): string => `/v1/sala/${sala.id}${resto}`;

  async function montar(apagar: (m: MundoDeSala) => void) {
    const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org" });
    mundo.env.CORREO = { send: vi.fn(async () => ({ messageId: "m" })) };
    const creada = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, MANO)) });
    expect(creada.status).toBe(201);
    const sala = (await creada.json()) as SalaDeCampana;
    const abierta = await mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth(sala) });
    expect(abierta.status).toBe(204);
    // La sal de la campaña nace con la primera persona: acá se pide la misma que usaría la sala.
    const sql = ((consulta: string, ...parametros: ValorSql[]) => mundo.ejecutar(`sala:${sala.id}`, consulta, ...parametros)) as unknown as Ejecutar;
    const sal = salDeCampana(sql);
    const lineas: string[] = [];
    for (let n = 1; n <= 4; n++) {
      const linea = await lineaDePersona(sal, `google:usuario${n}`);
      lineas.push(linea);
      mundo.ejecutar(`sala:${sala.id}`, "INSERT INTO equipos (cuenta, d, estado, v, llave) VALUES (?, 'x', 'aceptado', ?, ?)", linea, n, await huellaDeLlave(llaveDe(n)));
      mundo.ejecutar(`sala:${sala.id}`, "INSERT INTO personas (persona, cuenta) VALUES (?, ?)", await huellaDePersona(sql, `google:usuario${n}`), linea);
    }
    apagar(mundo);
    return { mundo, sala, lineas };
  }

  for (const [nombre, apagar] of apagados) {
    it(`${nombre}: se puede quitar, cerrar, sellar, guardar el resultado, avisar y mirar, y solo frena crear otra`, async () => {
      const { mundo, sala, lineas } = await montar(apagar);
      const poner = (fase: string, extra: Record<string, unknown> = {}) =>
        mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase, ...extra }, cabeceras: auth(sala) });

      // Se ve la lista y quien organiza saca a una persona.
      const lista = (await (await mundo.pedir(ruta(sala, "/equipos?desde=0"), { cabeceras: auth(sala) })).json()) as { n: number; cuenta: string }[];
      expect(lista.map((f) => f.cuenta).sort()).toEqual([...lineas].sort());
      const n4 = lista.find((f) => f.cuenta === lineas[3])?.n;
      expect((await mundo.pedir(ruta(sala, "/campana/quitar"), { cuerpo: { n: n4, motivo: "repetida" }, cabeceras: auth(sala) })).status).toBe(204);
      // Cada celular sigue pudiendo ver cómo va lo suyo.
      expect(await (await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { llave: llaveDe(1) } })).json()).toMatchObject({ fase: "abierta", anotada: true });
      expect(await (await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { llave: llaveDe(4) } })).json()).toMatchObject({ anotada: false, quitada: "repetida" });
      expect((await mundo.pedir(ruta(sala, "/campana/estado"))).status).toBe(200);
      // Se cierra y se sella.
      expect((await poner("cerrada")).status).toBe(204);
      const orden = listaDeLaCampana(lineas.slice(0, 3));
      const sello = { listHash: Buffer.from(listHash(orden)).toString("hex"), count: 3, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA };
      lectura.valor = { sello, ganadores: null };
      expect((await poner("sellada", { sorteo: SORTEO })).status).toBe(204);
      // Se guarda el resultado, y sin llamar a nadie: ni al proveedor de cuentas ni al correo.
      lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
      const guardo = await mundo.pedir(ruta(sala, "/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth(sala) });
      expect(guardo.status).toBe(204);
      await mundo.esperarSegundoPlano();
      expect(await (await mundo.pedir(ruta(sala, "/campana/resultado"))).json()).toEqual({ sorteo: SORTEO, ganadoras: [orden[2], orden[0]], comprobante: COMPROBANTE });
      expect(mundo.proveedor.busquedas).toEqual([]);
      expect(mundo.proveedor.llamadas).toEqual({});
      expect((mundo.env.CORREO as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();
      expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT k FROM sala WHERE k LIKE 'correo:%'")).toEqual([]);
      expect(await (await mundo.pedir(ruta(sala, "/campana/estado"))).json()).toMatchObject({ correo: false });
      // Se marca el aviso, y la marca guarda la línea.
      const avisar = (cuenta: string) => mundo.pedir(ruta(sala, "/campana/avisar"), { cuerpo: { cuenta }, cabeceras: auth(sala) });
      expect((await avisar(orden[2] as string)).status).toBe(204);
      expect((await avisar(orden[2] as string)).status).toBe(204);
      expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT cuenta FROM campana_avisos")).toEqual([{ cuenta: orden[2] }]);
      const perdedora = await avisar(orden[1] as string);
      expect(perdedora.status).toBe(400);
      expect(await perdedora.json()).toEqual({ error: "no-gano" });
      // Y lo que sí frena: crear otra campaña de personas.
      const otra = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, { ...MANO, evento: "otra-feria" })) });
      expect(otra.status).toBe(503);
      expect(await otra.json()).toEqual({ error: "personas-apagadas" });
    });
  }
});

describe("avisar con la línea de una persona", () => {
  const LINEA = "p1:abcdefghijklmnopqrstuvwxy4";

  /** La respuesta de avisar con ese cuerpo: estado, cuerpo y las cabeceras. */
  async function respuesta(mundo: MundoDeSala, sala: { id: string; token: string }, cuenta: unknown) {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/avisar`, { cuerpo: { cuenta }, cabeceras: { Authorization: `Bearer ${sala.token}` } });
    return { estado: r.status, cuerpo: await r.text(), cabeceras: [...r.headers.entries()].sort() };
  }

  it("en una sala de cuentas contesta lo mismo que a cualquier cosa que no es una cuenta", async () => {
    const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    const creada = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA)) });
    const sala = (await creada.json()) as SalaDeCampana;
    const linea = await respuesta(mundo, sala, LINEA);
    expect(linea.estado).toBe(400);
    expect(JSON.parse(linea.cuerpo)).toEqual({ error: "forma" });
    expect(linea).toEqual(await respuesta(mundo, sala, "no es una cuenta"));
    expect(linea).toEqual(await respuesta(mundo, { ...sala, token: "token-que-no-es" }, LINEA));
  });

  it("en una sala que no existe contesta lo mismo, con los interruptores como estén", async () => {
    const interruptores: Record<string, string>[] = [{}, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE }];
    for (const extra of interruptores) {
      const mundo = await montarMundo(extra);
      const nueva = { id: "AbCdEf12", token: "x".repeat(20) };
      const linea = await respuesta(mundo, nueva, LINEA);
      expect(linea.estado).toBe(400);
      expect(JSON.parse(linea.cuerpo)).toEqual({ error: "forma" });
      expect(linea).toEqual(await respuesta(mundo, nueva, "no es una cuenta"));
    }
  });
});
