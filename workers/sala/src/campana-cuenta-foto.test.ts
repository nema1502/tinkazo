import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba, lineaDePrueba } from "../../../src/campana/cuentas-de-prueba";
import { type Foto, compararConLaFoto } from "../../../src/campana/foto-de-hoy";
import { listHash } from "../../../src/protocol/canonical";
import { campanaDePrueba, firmarParaLaPrueba, montarMundo, sesionDePrueba, type MundoDeSala } from "../../../src/sala/mundo-sala";
import { leerParaActivar } from "./activar";
import { listaDeLaCampana } from "./campana";

vi.mock("cloudflare:workers", async () => await import("../../../src/sala/cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia el recorrido. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("./cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * La foto de hoy de la sala de una campaña de cuentas: lo que contestan el estado, el resultado y el aviso a quien ganó,
 * cómo se reserva el aviso por correo y qué firma el lector de campañas que se activan solas. Complementa a la prueba de
 * paridad de la sala (`src/sala/campana-paridad-cuenta.test.ts`), que compara cada respuesta en bruto contra la sala de la
 * rama principal: acá van las escenas que esa prueba no recorre, con lo que importa dicho a mano, y se compara con
 * `campana-cuenta-foto.base.json`. Sin el archivo grabado, deja lo anotado en el registro (`FOTO64`).
 */
const FOTO = fileURLToPath(new URL("./campana-cuenta-foto.base.json", import.meta.url));

const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const RONDA = 40_000_000;
const SORTEO = "123456789";
const COMPROBANTE = "/verificar.html?x=1";

const cuentaFija = (i: number): string => Keypair.fromRawEd25519Seed(Buffer.alloc(32, i)).publicKey();

interface Persona {
  usuario: string;
  token: string;
  cuenta: string;
  llave: string;
}

/** Una persona con su sesión en el proveedor de mentira, con una cuenta y una llave siempre iguales. */
function persona(mundo: MundoDeSala, n: number): Persona {
  const usuario = `usuario${n}`;
  const token = sesionDePrueba(usuario);
  const cuenta = cuentaFija(n);
  mundo.proveedor.sesiones.set(token, { usuario, contenido: { wallet: cuenta } });
  return { usuario, token, cuenta, llave: `llave${n}`.padEnd(22, "x") };
}

/** Lo que dejan escrito las respuestas, con lo que cambia entre corridas reemplazado por un nombre fijo. */
class Rastro {
  readonly lineas: string[] = [];
  private id = "";
  private token = "";

  conocer(datos: { id: string; token: string }): void {
    this.id = datos.id;
    this.token = datos.token;
  }

  limpiar(texto: string): string {
    let salida = texto.replace(/"firma":"[^"]*"/gu, '"firma":"<FIRMA>"');
    for (const [valor, nombre] of [
      [this.id, "<ID>"],
      [this.token, "<TOKEN>"],
    ] as const) {
      if (valor !== "") salida = salida.split(valor).join(nombre);
    }
    return salida;
  }

  /** Anota una respuesta: su estado, las cabeceras que importan y su cuerpo en bruto. Devuelve el cuerpo. */
  async ver(paso: string, r: Response): Promise<string> {
    const cuerpo = await r.text();
    const cabeceras = ["cache-control", "content-type", "retry-after"].flatMap((nombre) => {
      const valor = r.headers.get(nombre);
      return valor === null ? [] : [`${nombre}: ${valor}`];
    });
    this.lineas.push(`${paso} | ${r.status} | ${JSON.stringify(cabeceras)} | ${this.limpiar(cuerpo)}`);
    return cuerpo;
  }

  nota(paso: string, valor: unknown): void {
    this.lineas.push(`${paso} | ${this.limpiar(JSON.stringify(valor))}`);
  }
}

interface Anotado {
  lineas: string[];
  /** Los cuerpos del estado, por fase, ya leídos. */
  estados: Record<string, Record<string, unknown>>;
  /** Las respuestas de avisar con una línea de persona, con su estado y su cuerpo. */
  conLinea: { paso: string; estado: number; cuerpo: string }[];
  marcasDeCorreo: string[];
  ganadoras: string[];
  enviados: { to: string; subject: string }[];
}

/** Una campaña de cuentas de punta a punta, con el aviso por correo prendido o apagado. */
async function recorrer(conCorreo: boolean): Promise<Anotado> {
  const mundo = await montarMundo(conCorreo ? { CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org" } : {});
  const enviados: { to: string; subject: string }[] = [];
  if (conCorreo) {
    mundo.env.CORREO = { send: async (m: { to: string; subject: string }) => (enviados.push({ to: m.to, subject: m.subject }), { messageId: "m1" }) };
  }
  const rastro = new Rastro();
  const salida: Anotado = { lineas: rastro.lineas, estados: {}, conLinea: [], marcasDeCorreo: [], ganadoras: [], enviados };
  const creada = await mundo.pedir("/v1/campana", {
    cuerpo: firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, { empresa: { nombre: "Empresa de ejemplo" } })),
  });
  const { id, token } = (await creada.json()) as { id: string; token: string };
  rastro.conocer({ id, token });
  const auth = { Authorization: `Bearer ${token}` };
  const sala = (resto: string): string => `/v1/sala/${id}${resto}`;

  const estado = async (fase: string): Promise<void> => {
    const cuerpo = await rastro.ver(`estado en ${fase}`, await mundo.pedir(sala("/campana/estado")));
    salida.estados[fase] = JSON.parse(cuerpo) as Record<string, unknown>;
  };
  await estado("lista");

  await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras: auth });
  await estado("abierta");

  const gente = [1, 2, 3, 4].map((n) => persona(mundo, n));
  for (const p of gente) {
    await mundo.pedir(sala("/campana/alta"), { cuerpo: { token: p.token, d: "A".repeat(60), llave: p.llave }, cabeceras: { "CF-Connecting-IP": "190.129.10.20" } });
    mundo.proveedor.usuarios.set(p.cuenta, [
      { id: p.usuario, first_name: "Ana", last_name: "Quispe", email: `${p.usuario}@example.org`, wallet_public_key: p.cuenta, providers: ["GOOGLE"] },
    ]);
  }
  await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth });
  await estado("cerrada");

  const orden = listaDeLaCampana(gente.map((p) => p.cuenta));
  const sello = { listHash: Buffer.from(listHash(orden)).toString("hex"), count: orden.length, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA };
  const ganadoras = [orden[2] as string, orden[0] as string];
  salida.ganadoras = ganadoras;

  // Avisar antes del sorteo: a una cuenta y a una línea de persona. Ninguna sirve todavía.
  const avisar = async (paso: string, cuerpo: unknown, cabeceras: Record<string, string> = auth): Promise<void> => {
    const r = await mundo.pedir(sala("/campana/avisar"), { cuerpo, cabeceras });
    const estadoDeLaRespuesta = r.status;
    const texto = await rastro.ver(paso, r);
    if (typeof cuerpo === "object" && cuerpo !== null && typeof (cuerpo as { cuenta?: unknown }).cuenta === "string" && (cuerpo as { cuenta: string }).cuenta.startsWith("p1:")) {
      salida.conLinea.push({ paso, estado: estadoDeLaRespuesta, cuerpo: texto });
    }
  };
  await avisar("avisar antes del sorteo: una cuenta que no ganó", { cuenta: ganadoras[0] });
  await avisar("avisar antes del sorteo: una línea de persona", { cuenta: lineaDePrueba(1) });

  lectura.valor = { sello, ganadores: null };
  await mundo.pedir(sala("/campana/fase"), { metodo: "PUT", cuerpo: { fase: "sellada", sorteo: SORTEO }, cabeceras: auth });
  await estado("sellada");

  lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
  await rastro.ver("resultado: guardar", await mundo.pedir(sala("/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth }));
  await mundo.esperarSegundoPlano();
  await rastro.ver("resultado: leer", await mundo.pedir(sala("/campana/resultado")));
  await estado("sorteada");

  await avisar("avisar con el sorteo hecho: una línea de persona", { cuenta: lineaDePrueba(1) });
  await avisar("avisar con el sorteo hecho: otra línea de persona", { cuenta: lineaDePrueba(2) });
  await avisar("avisar con el sorteo hecho: una línea de persona sin token", { cuenta: lineaDePrueba(1) }, {});
  await avisar("avisar con el sorteo hecho: la cuenta de una que no ganó", { cuenta: orden[1] });
  await avisar("avisar con el sorteo hecho: una cuenta mal formada", { cuenta: `G${"B".repeat(55)}` });
  await avisar("avisar con el sorteo hecho: sin cuenta", {});
  await avisar("avisar con el sorteo hecho: la que ganó primero", { cuenta: ganadoras[0] });
  await avisar("avisar con el sorteo hecho: la misma otra vez", { cuenta: ganadoras[0] });
  await avisar("avisar con el sorteo hecho: la que ganó segundo", { cuenta: ganadoras[1] });

  rastro.nota("avisos guardados", mundo.ejecutar(`sala:${id}`, "SELECT cuenta FROM campana_avisos ORDER BY cuenta"));
  const marcas = mundo.ejecutar(`sala:${id}`, "SELECT k FROM sala WHERE k LIKE 'correo:%' ORDER BY k").map((f) => String(f.k));
  salida.marcasDeCorreo = marcas;
  rastro.nota("marcas de correo", marcas);
  rastro.nota("claves de la sala que son del correo o de una confirmación", mundo.ejecutar(`sala:${id}`, "SELECT k FROM sala WHERE k LIKE 'correo:%' OR k LIKE 'confirmo:%' ORDER BY k").map((f) => String(f.k)));
  rastro.nota("búsquedas al proveedor", mundo.proveedor.busquedas);
  rastro.nota("correos enviados", enviados.map((m) => ({ to: m.to, subject: m.subject })).sort((a, b) => (a.to < b.to ? -1 : 1)));
  return salida;
}

/* ------------------------------------------------------------ el lector de campañas que se activan solas */

const HORA = Date.UTC(2026, 10, 21, 15, 0, 0);

/** El texto de una campaña de una empresa que se puede activar sola, con `cambios` encima. */
function campanaParaActivar(cambios: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    evento: "casa-andina-k7p2",
    red: "mainnet",
    estado: "abierta",
    empresa: { nombre: "Casa Andina", logo: null, color: "verde" },
    lugar: { es: "Feria del libro", en: "Book fair" },
    zona: "America/La_Paz",
    premios: ["400000000", "400000000"],
    abre_ms: HORA,
    cierra_ms: HORA + 3_600_000,
    sorteo_ms: HORA + 7_200_000,
    recibir_hasta_ms: HORA + 30 * 86_400_000,
    entrada: "google",
    pasos: [],
    bases: { es: "Participar es gratis.", en: "Taking part is free." },
    anotadas: 0,
    contrato: null,
    promo: null,
    comprobante: null,
    organizadora: cuentaDePrueba(1),
    ...cambios,
  });
}

const enTexto = (x: unknown): string => JSON.stringify(x, (_clave, valor: unknown) => (typeof valor === "bigint" ? `${valor}n` : valor));

function escenaDeActivar(): string[] {
  const casos: [string, string][] = [
    ["un texto sin campos nuevos", campanaParaActivar()],
    ["un texto con un campo de más", campanaParaActivar({ campo_de_prueba: "x" })],
    ["premios en cero", campanaParaActivar({ premios: ["0", "0"] })],
    ["en la red de prueba", campanaParaActivar({ red: "testnet" })],
    ["entrada con correo", campanaParaActivar({ entrada: "google-correo" })],
    ["con anotadas", campanaParaActivar({ anotadas: 3 })],
    ["sin organizadora", campanaParaActivar({ organizadora: null })],
    ["con una organizadora mal escrita", campanaParaActivar({ organizadora: "GBBB" })],
    ["con un contrato", campanaParaActivar({ contrato: `C${"A".repeat(55)}` })],
    ["no es un texto de campaña", "esto no es un archivo"],
  ];
  return casos.map(([nombre, texto]) => `${nombre} | ${enTexto(leerParaActivar(texto, HORA))}`);
}

/* ------------------------------------------------------------ las pruebas */

const escenas: Foto = {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("la sala de una campaña de cuentas, con el aviso por correo apagado", () => {
  it("el estado no trae nada de personas y dice que no hay correo, en cada fase", async () => {
    const r = await recorrer(false);
    escenas["sala sin correo"] = r.lineas;
    expect(Object.keys(r.estados).sort()).toEqual(["abierta", "cerrada", "lista", "sellada", "sorteada"]);
    for (const [fase, cuerpo] of Object.entries(r.estados)) {
      expect(cuerpo.correo, fase).toBe(false);
      expect("personas" in cuerpo, fase).toBe(false);
      expect(cuerpo.fase, fase).toBe(fase);
    }
    expect(Object.keys(r.estados.cerrada ?? {}).sort()).toEqual(["cierraMs", "correo", "fase", "pase", "quitadas", "total"]);
    expect(Object.keys(r.estados.sorteada ?? {}).sort()).toEqual(["cierraMs", "correo", "fase", "pase", "quitadas", "ronda", "sorteo", "total"]);
    expect(r.estados.sorteada?.sorteo).toBe(SORTEO);
    expect(r.estados.sorteada?.total).toBe(4);
  }, 120_000);

  it("avisar con una línea de persona contesta 400 forma, antes y después del sorteo", async () => {
    const r = await recorrer(false);
    expect(r.conLinea).toHaveLength(4);
    for (const x of r.conLinea) {
      expect(x.estado, x.paso).toBe(400);
      expect(x.cuerpo, x.paso).toBe('{"error":"forma"}');
    }
  }, 120_000);

  it("sin el correo prendido la sala no reserva ninguna marca de correo", async () => {
    const r = await recorrer(false);
    expect(r.marcasDeCorreo).toEqual([]);
    expect(r.enviados).toEqual([]);
  }, 120_000);
});

describe("la sala de una campaña de cuentas, con el aviso por correo prendido", () => {
  it("reserva el aviso de quienes ganaron, el estado lo dice y no se avisa a nadie más", async () => {
    const r = await recorrer(true);
    escenas["sala con correo"] = r.lineas;
    expect(r.ganadoras).toHaveLength(2);
    expect(r.marcasDeCorreo.length).toBeGreaterThan(0);
    for (const clave of r.marcasDeCorreo) expect(r.ganadoras.some((c) => clave.includes(c)), clave).toBe(true);
    for (const [fase, cuerpo] of Object.entries(r.estados)) expect(cuerpo.correo, fase).toBe(true);
    for (const x of r.conLinea) expect(x.cuerpo, x.paso).toBe('{"error":"forma"}');
  }, 120_000);
});

describe("el lector de campañas que se activan solas", () => {
  it("un texto sin campos nuevos se lee y se firma como se escribió", () => {
    const texto = campanaParaActivar();
    const r = leerParaActivar(texto, HORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compacto).toBe(texto);
    expect(r.evento).toBe("casa-andina-k7p2");
    expect(r.organizadora).toBe(cuentaDePrueba(1));
    expect(r.premios).toEqual([400000000n, 400000000n]);
  });

  it("un campo de más viaja en el texto que se firma", () => {
    const texto = campanaParaActivar({ campo_de_prueba: "x" });
    const r = leerParaActivar(texto, HORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.compacto).toContain('"campo_de_prueba":"x"');
  });

  it("agujero de hoy: un campo de identidad todavía se firma igual, y lo cierra el paso que empieza a leerlo en la sala", () => {
    const r = leerParaActivar(campanaParaActivar({ identidad: "persona" }), HORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.compacto).toContain('"identidad":"persona"');
  });
});

describe("la foto de hoy de la sala de cuentas", () => {
  it("todo lo anotado sigue escribiéndose igual", () => {
    escenas["activar"] = escenaDeActivar();
    expect(Object.keys(escenas).sort()).toEqual(["activar", "sala con correo", "sala sin correo"]);
    compararConLaFoto(FOTO, "campana-cuenta-foto-sala", escenas);
  });
});
