import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import {
  almacenEnMemoria,
  cargarConUnReintento,
  depsConectadas,
  type PiezasDelCelular,
} from "./conectar";
import { destinoDeRecibir } from "./recibir";
import type { DepsDelCelular, SesionDelCelular } from "./celular";
import { fetchFalso, type Llamada, type Paso } from "../sala/fetch-falso";
import type { SesionDeGoogle } from "./sesion";
import { descifrarEquipo } from "../equipos/datos";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";

const CUENTA = `G${"A".repeat(55)}`;
const OTRA = `G${"B".repeat(55)}`;
const SERVICIO = "https://servicio.example.org";
const SALA = "ABCDEFGH";
const CLAVE = "abcdefghijklmnopqrstuv";
const PASE = "ABCDEFGHIJKL";
const AHORA = 1_800_000_000_000;
const ESTADO_BUENO = { fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, pase: "vale" };
const YO_ANOTADA = { fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, anotada: true };
const ALTA_OK: Paso = { estado: 201, cuerpo: { cuenta: CUENTA } };

const error = (estado: number, motivo: string): Paso => ({ estado, cuerpo: { error: motivo } });

const LECTURA_LISTA: LecturaDelCelular = { estado: "lista", protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true, correoTapado: "a•••@ejemplo.com", limite: false };

/** Una página que guarda y lee del almacenamiento de mentira, para ver qué escribe. */
function almacenFalso(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (n) => [...datos.keys()][n] ?? null,
    removeItem: (clave) => {
      datos.delete(clave);
    },
    setItem: (clave, valor) => {
      datos.set(clave, valor);
    },
  };
}

/** Google de mentira: cada función es un espía, para mirar cuántas veces se llamó y cambiar lo que contesta. */
function googleFalso(tokens: (string | null)[], sigue: boolean) {
  let n = 0;
  return {
    retomar: vi.fn(async (): Promise<SesionDelCelular | null> => null),
    entrar: vi.fn(async (): Promise<SesionDelCelular> => ({ cuenta: CUENTA, nombre: "Ana P." })),
    token: vi.fn(async (): Promise<string | null> => tokens[Math.min(n++, tokens.length - 1)] ?? null),
    nombreTardio: vi.fn(async (): Promise<string | null> => null),
    estadoDeLaCuenta: vi.fn(async (): Promise<LecturaDelCelular> => LECTURA_LISTA),
    segundosDeLimite: vi.fn(async (): Promise<number | null> => null),
    soltar: vi.fn(async () => undefined),
    sigueLaSesion: vi.fn(async (_cuenta: string) => sigue),
    salir: vi.fn(async () => undefined),
    renovar: vi.fn(() => undefined),
  } satisfies SesionDeGoogle;
}

interface Montaje {
  deps: DepsDelCelular;
  llamadas: Llamada[];
  memoria: Storage;
  google: ReturnType<typeof googleFalso>;
  ir: ReturnType<typeof vi.fn>;
  /** Los nombres de los candados que se pidieron. */
  bloqueos: string[];
}

function montar(
  guion: Record<string, Paso[]>,
  o: {
    memoria?: Storage;
    enLinea?: boolean;
    azar?: number;
    tokens?: (string | null)[];
    sigue?: boolean;
    /** Cuánto espera el candado a que otra pestaña termine, en milisegundos del reloj falso. */
    esperaDelCandado?: number;
    /** La configuración del build que dice el costo de retirar. */
    entorno?: Record<string, unknown>;
    idioma?: "es" | "en";
    /** La sesión de Google no sabe leer la cuenta (la demostración). */
    sinLectura?: boolean;
    /** La dirección del sitio y el menú de compartir de esta página, para el enlace del premio. */
    origen?: string;
    compartir?: (enlace: string) => Promise<void>;
    /** La sesión de Google no sabe soltarse ni decir el límite (la demostración). */
    sinSoltar?: boolean;
    /** La sesión de Google sabe decir si la sesión del navegador es de la cuenta (para ir a recibir). */
    laSesionEs?: (cuenta: string) => Promise<"si" | "otra" | "no-se-sabe">;
  } = {},
): Montaje {
  const { f, llamadas } = fetchFalso(guion);
  const memoria = o.memoria ?? almacenFalso();
  const google = googleFalso(o.tokens ?? ["tok_" + "x".repeat(30)], o.sigue ?? false);
  if (o.sinLectura) delete (google as { estadoDeLaCuenta?: unknown }).estadoDeLaCuenta;
  if (o.sinSoltar) delete (google as { soltar?: unknown }).soltar;
  if (o.laSesionEs) (google as { laSesionEs?: unknown }).laSesionEs = o.laSesionEs;
  const ir = vi.fn();
  const bloqueos: string[] = [];
  const bloquear = async <T>(nombre: string, trabajo: () => Promise<T>): Promise<T> => {
    bloqueos.push(nombre);
    if (o.esperaDelCandado) vi.setSystemTime(Date.now() + o.esperaDelCandado);
    return trabajo();
  };
  const piezas: PiezasDelCelular = {
    base: {
      tx: (clave) => clave,
      idioma: () => o.idioma ?? "es",
      enApp: false,
      ahora: () => Date.now(),
      cada: vi.fn(() => () => undefined),
      visible: () => true,
      alVolver: () => () => undefined,
      vibrar: () => undefined,
      movimientoReducido: () => true,
    },
    campana: campanaDeEjemplo(AHORA),
    servicio: SERVICIO,
    sala: SALA,
    clave: CLAVE,
    pase: PASE,
    google,
    memoria,
    red: "testnet",
    enLinea: () => o.enLinea ?? true,
    ir,
    enlace: () => "https://tinkazo.example.org/participar.html?c=x",
    ...(o.origen ? { origen: () => o.origen as string } : {}),
    ...(o.compartir ? { compartir: o.compartir } : {}),
    bloquear,
    dep: { fetch: f, azar: () => o.azar ?? 0.5 },
    ...(o.entorno ? { entorno: o.entorno } : {}),
  };
  return { deps: depsConectadas(piezas), llamadas, memoria, google, ir, bloqueos };
}

/** Una cuenta pública de testnet y un monto: lo mínimo para que el build diga que el retiro cuesta. */
const CON_COSTO = {
  VITE_RETIRO_COSTO: "0.50",
  VITE_RETIRO_CUENTA: "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT",
};

const esperaReal = globalThis.setTimeout;

/**
 * Corre el reloj falso de a poco hasta que la promesa termine. El cifrado y la huella del token son asíncronos de verdad:
 * entre paso y paso se les da un respiro real, para que los temporizadores se programen cuando les toca.
 */
async function correr<T>(promesa: Promise<T>, paso = 1_000): Promise<T> {
  let lista = false;
  void promesa.then(
    () => {
      lista = true;
    },
    () => {
      lista = true;
    },
  );
  for (let vuelta = 0; vuelta < 400 && !lista; vuelta += 1) {
    await new Promise<void>((resolver) => {
      esperaReal(resolver, 2);
    });
    await vi.advanceTimersByTimeAsync(paso);
  }
  return promesa;
}

/** La sesión de la página con esta cuenta, como si la persona ya hubiera entrado. */
async function conSesion(m: Montaje, cuenta = CUENTA): Promise<void> {
  m.google.entrar.mockResolvedValue({ cuenta, nombre: "Ana P." });
  await m.deps.entrar();
}

const alta = (m: Montaje): Promise<unknown> => correr(m.deps.anotar("Ana", () => undefined));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("la consulta pública", () => {
  it("si la primera respuesta falla, repite una vez a los 3 segundos y sigue sin pasar por sin-red", async () => {
    const m = montar({ estado: [{ estado: 500, texto: "caído" }, { estado: 200, cuerpo: ESTADO_BUENO }] });
    const r = await correr(m.deps.publico());
    expect(r).toEqual({ fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, pase: "vale", correo: false });
    expect(m.llamadas.map((l) => l.en - (m.llamadas[0]?.en ?? 0))).toEqual([0, 3_000]);
  });

  it("si la primera y la repetición fallan, da red", async () => {
    const m = montar({ estado: [{ estado: 500, texto: "caído" }] });
    expect(await correr(m.deps.publico())).toBe("red");
    expect(m.llamadas).toHaveLength(2);
  });

  it("las consultas siguientes no se repiten", async () => {
    const m = montar({ estado: [{ estado: 200, cuerpo: ESTADO_BUENO }, { estado: 500, texto: "caído" }] });
    await correr(m.deps.publico());
    expect(await correr(m.deps.publico())).toBe("red");
    expect(m.llamadas).toHaveLength(2);
  });

  it("manda el pase del enlace", async () => {
    const m = montar({ estado: [{ estado: 200, cuerpo: ESTADO_BUENO }] });
    await correr(m.deps.publico());
    expect(m.llamadas[0]?.url).toContain(`?p=${PASE}`);
  });

  it("con el pase vencido y una llave guardada antes, sigue vencido: la sala no la reconoce sin pase", async () => {
    const memoria = almacenFalso();
    memoria.setItem("tinkazo.equipo.llaves", JSON.stringify([[SALA, "L".repeat(22)]]));
    const m = montar({ estado: [{ estado: 200, cuerpo: { ...ESTADO_BUENO, pase: "vencido" } }] }, { memoria });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "vencido" });
  });

  it("con el pase vencido y sin llave guardada antes, sigue vencido", async () => {
    const m = montar({ estado: [{ estado: 200, cuerpo: { ...ESTADO_BUENO, pase: "vencido" } }] });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "vencido" });
  });

  it("con el pase vigente no cambia nada", async () => {
    const m = montar({ estado: [{ estado: 200, cuerpo: ESTADO_BUENO }] });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "vale" });
  });
});

describe("el ritmo de las consultas", () => {
  const intervalo = (azar: number, ms: number, modo?: "azar" | "exacta"): number => {
    const llamado: number[] = [];
    const { f } = fetchFalso({});
    const deps = depsConectadas({
      base: {
        tx: (c) => c,
        idioma: () => "es",
        enApp: false,
        ahora: () => Date.now(),
        cada: (_f, tiempo) => {
          llamado.push(tiempo);
          return () => undefined;
        },
        visible: () => true,
        alVolver: () => () => undefined,
        vibrar: () => undefined,
        movimientoReducido: () => true,
      },
      campana: campanaDeEjemplo(AHORA),
      servicio: SERVICIO,
      sala: SALA,
      clave: CLAVE,
      pase: PASE,
      google: {
        retomar: async () => null,
        entrar: async () => ({ cuenta: CUENTA, nombre: null }),
        token: async () => null,
        nombreTardio: async () => null,
        sigueLaSesion: async () => false,
        salir: async () => undefined,
        renovar: () => undefined,
      },
      memoria: almacenFalso(),
      red: "testnet",
      enLinea: () => true,
      ir: () => undefined,
      enlace: () => "x",
      dep: { fetch: f, azar: () => azar },
    });
    deps.cada(() => undefined, ms, modo);
    return llamado[0] ?? 0;
  };

  it("los 15 segundos pasan a 30 con el azar al medio", () => {
    expect(intervalo(0.5, 15_000)).toBe(30_000);
  });

  it("cada celular se corre entre un 20 % menos y un 20 % más", () => {
    expect(intervalo(0, 15_000)).toBe(24_000);
    expect(intervalo(1, 15_000)).toBe(36_000);
  });

  it("los 60 segundos de después del sorteo quedan en 60 con el mismo factor", () => {
    expect(intervalo(0.5, 60_000)).toBe(60_000);
    expect(intervalo(0, 60_000)).toBe(48_000);
  });

  it("el resultado se mira cada 8 segundos con un azar de 20 %, sin estirar", () => {
    expect(intervalo(0.5, 8_000, "azar")).toBe(8_000);
    expect(intervalo(0, 8_000, "azar")).toBe(6_400);
    expect(intervalo(1, 8_000, "azar")).toBe(9_600);
  });

  it("y los 15 segundos de después de la ventana no se estiran a 30 con el modo azar", () => {
    expect(intervalo(0.5, 15_000, "azar")).toBe(15_000);
    expect(intervalo(0, 15_000, "azar")).toBe(12_000);
    expect(intervalo(1, 15_000, "azar")).toBe(18_000);
  });

  it("el reloj de la cuenta regresiva late cada segundo, sin azar ni estiramiento", () => {
    expect(intervalo(0, 1_000, "exacta")).toBe(1_000);
    expect(intervalo(1, 1_000, "exacta")).toBe(1_000);
    expect(intervalo(0.5, 15_000, "exacta")).toBe(15_000);
  });

  it("el peor caso son 150 celulares a 2 consultas por minuto: 18.000 por hora", () => {
    expect((150 * 3_600_000) / intervalo(0.5, 15_000)).toBe(18_000);
  });
});

describe("anotar", () => {
  it("anota con el token de la sesión, el nombre cifrado y el pase, y no manda la clave", async () => {
    const m = montar({ alta: [ALTA_OK] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: true, ya: false });
    const cuerpo = JSON.parse(String(m.llamadas[0]?.init.body)) as Record<string, string>;
    expect(cuerpo.token).toBe("tok_" + "x".repeat(30));
    expect(cuerpo.p).toBe(PASE);
    expect(cuerpo.d).not.toContain("Ana");
    expect(String(m.llamadas[0]?.init.body)).not.toContain(CLAVE);
    expect(m.llamadas[0]?.url).not.toContain(CLAVE);
  });

  /** El nombre que viaja cifrado en el alta. */
  async function nombreDelAlta(m: Montaje): Promise<string | undefined> {
    const cuerpo = JSON.parse(String(m.llamadas[0]?.init.body)) as { d: string };
    return (await descifrarEquipo(CLAVE, cuerpo.d))?.nombre;
  }

  it("si el nombre llegó tarde y el alta salió sin él, lo lee con el token en mano y lo cifra", async () => {
    const m = montar({ alta: [ALTA_OK] });
    m.google.nombreTardio.mockResolvedValue("Ana P.");
    await conSesion(m);
    await correr(m.deps.anotar(null, () => undefined));
    expect(m.google.nombreTardio).toHaveBeenCalledTimes(1);
    expect(await nombreDelAlta(m)).toBe("Ana P.");
  });

  it("si Google no tiene nombre el alta sale con el nombre vacío", async () => {
    const m = montar({ alta: [ALTA_OK] });
    await conSesion(m);
    await correr(m.deps.anotar(null, () => undefined));
    expect(await nombreDelAlta(m)).toBe("");
  });

  it("si el nombre ya estaba no se vuelve a pedir", async () => {
    const m = montar({ alta: [ALTA_OK] });
    await conSesion(m);
    await alta(m);
    expect(m.google.nombreTardio).not.toHaveBeenCalled();
    expect(await nombreDelAlta(m)).toBe("Ana");
  });

  it("la dependencia del celular trae el nombre tardío de la sesión de Google", async () => {
    const m = montar({});
    m.google.nombreTardio.mockResolvedValue("Ana P.");
    expect(await m.deps.nombreTardio?.()).toBe("Ana P.");
  });

  it("al anotarse con éxito renueva la marca de invitada", async () => {
    const m = montar({ alta: [ALTA_OK] });
    await conSesion(m);
    await alta(m);
    expect(m.google.renovar).toHaveBeenCalledTimes(1);
  });

  it("si la sala dice que ya estaba anotada también renueva la marca de invitada", async () => {
    const m = montar({ alta: [{ estado: 200, cuerpo: { cuenta: CUENTA, ya: true } }] });
    await conSesion(m);
    await alta(m);
    expect(m.google.renovar).toHaveBeenCalledTimes(1);
  });

  it("un alta que falla no toca la marca de invitada", async () => {
    const m = montar({ alta: [error(409, "cerrada")] });
    await conSesion(m);
    await alta(m);
    expect(m.google.renovar).not.toHaveBeenCalled();
  });

  it("espera su turno entre pestañas con un candado por sala", async () => {
    const m = montar({ alta: [ALTA_OK] });
    await conSesion(m);
    await alta(m);
    expect(m.bloqueos).toEqual([`tinkazo.campana.alta.${SALA}`]);
  });

  it("si la sala anotó otra cuenta que la de la sesión, dice otro sin nombrarla", async () => {
    const m = montar({ alta: [{ estado: 201, cuerpo: { cuenta: OTRA } }] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "otro" });
  });

  it("sin conexión devuelve red antes de pedir el token", async () => {
    const m = montar({ alta: [ALTA_OK] }, { enLinea: false });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "red" });
    expect(m.google.token).not.toHaveBeenCalled();
    expect(m.llamadas).toHaveLength(0);
  });

  it("sin token y con la sesión todavía en la página devuelve proveedor", async () => {
    const m = montar({ alta: [ALTA_OK] }, { tokens: [null], sigue: true });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "proveedor" });
    expect(m.llamadas).toHaveLength(0);
  });

  it("sin token y con el servicio de cuentas frenando por límite, lo dice con los segundos", async () => {
    const m = montar({ alta: [ALTA_OK] }, { tokens: [null], sigue: true });
    m.google.segundosDeLimite.mockResolvedValue(25);
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "limite", segundos: 25 });
    expect(m.llamadas).toHaveLength(0);
    // Pasado el límite, vuelve a ser lo de siempre.
    m.google.segundosDeLimite.mockResolvedValue(null);
    expect(await alta(m)).toEqual({ ok: false, motivo: "proveedor" });
  });

  it("con token, el límite del servicio de cuentas no se mira: la alta sigue su camino", async () => {
    const m = montar({ alta: [ALTA_OK] });
    m.google.segundosDeLimite.mockResolvedValue(25);
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: true, ya: false });
    expect(m.google.segundosDeLimite).not.toHaveBeenCalled();
  });

  it("sin token y sin sesión devuelve sesion", async () => {
    const m = montar({ alta: [ALTA_OK] }, { tokens: [null], sigue: false });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "sesion" });
  });

  it("tres toques después de solo-google hacen un solo pedido a la sala", async () => {
    const m = montar({ alta: [error(403, "solo-google")] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "solo-google" });
    expect(await alta(m)).toEqual({ ok: false, motivo: "solo-google" });
    expect(await alta(m)).toEqual({ ok: false, motivo: "solo-google" });
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(1);
  });

  it("entrar de nuevo suelta el solo-google recordado", async () => {
    const m = montar({ alta: [error(403, "solo-google"), ALTA_OK] });
    await conSesion(m);
    await alta(m);
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: true, ya: false });
  });

  it("con sesion rechazada, el mismo token no se manda de nuevo y uno nuevo sí", async () => {
    const a = "tok_" + "a".repeat(30);
    const b = "tok_" + "b".repeat(30);
    const m = montar({ alta: [error(401, "sesion"), ALTA_OK] }, { tokens: [a, a, b] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "sesion" });
    expect(await alta(m)).toEqual({ ok: false, motivo: "sesion" });
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(1);
    expect(await alta(m)).toEqual({ ok: true, ya: false });
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(2);
  });

  it("después de sesion, un rechazos de la sala sigue diciendo sesion y no wifi", async () => {
    const m = montar(
      { alta: [error(401, "sesion"), error(429, "rechazos")] },
      { tokens: ["tok_" + "a".repeat(30), "tok_" + "b".repeat(30)] },
    );
    await conSesion(m);
    await alta(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "sesion" });
  });

  it("después de solo-google con otra cuenta de la página, un rechazos sigue diciendo solo-google", async () => {
    const m = montar({ alta: [error(403, "solo-google"), error(429, "rechazos")] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "solo-google" });
    m.google.retomar.mockResolvedValue({ cuenta: OTRA, nombre: null });
    await m.deps.sesion();
    expect(await alta(m)).toEqual({ ok: false, motivo: "solo-google" });
  });

  it("un rechazos sin ningún rechazo anterior en la página dice espera y no wifi", async () => {
    const m = montar({ alta: [error(429, "rechazos")], yo: [{ estado: 200, cuerpo: { ...YO_ANOTADA, anotada: false } }] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "espera" });
  });

  it("después de cuentas, un rechazos de la sala sigue diciendo cuentas y no espera", async () => {
    const sinCuenta = error(409, "sin-billetera");
    const noEsta = { estado: 200, cuerpo: { ...YO_ANOTADA, anotada: false } };
    const m = montar({ alta: [sinCuenta, sinCuenta, sinCuenta, error(429, "rechazos")], yo: [noEsta] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "cuentas" });
    expect(await alta(m)).toEqual({ ok: false, motivo: "cuentas" });
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(4);
  });

  it("el tiempo que se espera el candado de otra pestaña no se descuenta del tope del toque", async () => {
    const m = montar({ alta: [error(429, "rapido"), ALTA_OK] }, { esperaDelCandado: 100_000 });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: true, ya: false });
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(2);
  });

  it("un alta que corta a los 25 segundos y un yo con anotada true terminan en Ya estabas en la lista", async () => {
    const m = montar({ alta: ["colgado"], yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: true, ya: true });
    expect(m.llamadas.filter((l) => l.ruta === "yo")).toHaveLength(1);
  });

  it("un alta que corta y un yo con anotada false devuelve el motivo original", async () => {
    const m = montar({ alta: ["colgado"], yo: [{ estado: 200, cuerpo: { ...YO_ANOTADA, anotada: false } }] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "red" });
  });

  it("una cuenta quitada por la sala no vuelve a preguntar por yo", async () => {
    const m = montar({ alta: [error(409, "quitada")], yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "quitada" });
    expect(m.llamadas.filter((l) => l.ruta === "yo")).toHaveLength(0);
  });

  it("después de un final de proveedor el toque siguiente hace un solo pedido", async () => {
    const m = montar({ alta: [error(502, "pollar")], yo: [{ estado: 200, cuerpo: { ...YO_ANOTADA, anotada: false } }] });
    await conSesion(m);
    expect(await alta(m)).toEqual({ ok: false, motivo: "proveedor" });
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(4);
    await alta(m);
    expect(m.llamadas.filter((l) => l.ruta === "alta")).toHaveLength(5);
  });

  it("el token no queda en el almacenamiento ni en la consola", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const m = montar({ alta: [ALTA_OK] });
    await conSesion(m);
    await alta(m);
    let guardado = "";
    for (let i = 0; i < m.memoria.length; i += 1) guardado += m.memoria.getItem(m.memoria.key(i) ?? "") ?? "";
    expect(guardado).not.toContain("tok_");
    expect(guardado).not.toContain(CLAVE);
    expect(guardado).not.toContain(PASE);
    for (const espia of consola) expect(espia).not.toHaveBeenCalled();
  });
});

describe("la llave de este celular", () => {
  it("se lee de nuevo antes de cada alta: dos pestañas usan la que quedó guardada", async () => {
    const m = montar({ alta: [{ estado: 200, cuerpo: { cuenta: CUENTA, ya: true } }] });
    await conSesion(m);
    await alta(m);
    m.memoria.setItem("tinkazo.equipo.llaves", JSON.stringify([[SALA, "Z".repeat(22)]]));
    await alta(m);
    const llaves = m.llamadas.filter((l) => l.ruta === "alta").map((l) => (JSON.parse(String(l.init.body)) as { llave: string }).llave);
    expect(llaves[1]).toBe("Z".repeat(22));
    expect(llaves[0]).not.toBe(llaves[1]);
  });

  it("yo usa la llave guardada y la cuenta de la sesión", async () => {
    const m = montar({ yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    await conSesion(m);
    await correr(m.deps.yo());
    const cuerpo = JSON.parse(String(m.llamadas[0]?.init.body)) as { cuenta: string; llave: string };
    expect(cuerpo.cuenta).toBe(CUENTA);
    expect(cuerpo.llave).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  });

  it("la marca de correo confirmado está apagada: aunque la página la pida, el cuerpo de yo es el de siempre", async () => {
    const m = montar({ yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    await conSesion(m);
    expect(m.deps.marcaDeCorreo).toBeUndefined();
    await correr(m.deps.yo(true));
    expect(Object.keys(JSON.parse(String(m.llamadas[0]?.init.body)) as object).sort()).toEqual(["cuenta", "llave"]);
  });

  it("yo sin cuenta da red sin preguntar", async () => {
    const m = montar({ yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    expect(await correr(m.deps.yo())).toBe("red");
    expect(m.llamadas).toHaveLength(0);
  });

  it("yo usa la cuenta de la memoria si la página todavía no tiene sesión", async () => {
    const memoria = almacenFalso();
    memoria.setItem(`tinkazo.campana.${SALA}`, JSON.stringify({ cuenta: OTRA, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA }));
    const m = montar({ yo: [{ estado: 200, cuerpo: YO_ANOTADA }] }, { memoria });
    await correr(m.deps.yo());
    expect((JSON.parse(String(m.llamadas[0]?.init.body)) as { cuenta: string }).cuenta).toBe(OTRA);
  });

  it("el almacén en memoria guarda y devuelve", () => {
    const a = almacenEnMemoria();
    expect(a.getItem("x")).toBeNull();
    a.setItem("x", "1");
    expect(a.getItem("x")).toBe("1");
  });
});

describe("el resto de las dependencias", () => {
  it("resultado pasa terminada a red y deja pasar lo demás", async () => {
    const terminada = montar({ resultado: [error(404, "no-existe")] });
    expect(await correr(terminada.deps.resultado())).toBe("red");
    const aun = montar({ resultado: [error(404, "sin-resultado")] });
    expect(await correr(aun.deps.resultado())).toBeNull();
  });

  it("recibir lleva a la herramienta según la red", () => {
    const m = montar({});
    m.deps.recibir();
    expect(m.ir).toHaveBeenCalledWith("/?red=prueba&premio=1");
    expect(destinoDeRecibir("mainnet")).toBe("/?red=oficial&premio=1");
    expect(destinoDeRecibir("testnet")).toBe("/?red=prueba&premio=1");
  });

  it("el enlace del premio es entero, con la dirección del sitio y la red de la página", () => {
    const m = montar({}, { origen: "https://tinkazo.app" });
    expect(m.deps.enlaceDelPremio?.()).toBe("https://tinkazo.app/?red=prueba&premio=1");
    // Sin la dirección del sitio (la demostración) no se ofrece mandarlo.
    expect(montar({}).deps.enlaceDelPremio).toBeUndefined();
  });

  it("el menú de compartir del navegador pasa tal cual, y sin él no hay", async () => {
    const compartir = vi.fn(async () => undefined);
    const m = montar({}, { compartir });
    await m.deps.compartir?.("https://tinkazo.app/?x=1");
    expect(compartir).toHaveBeenCalledWith("https://tinkazo.app/?x=1");
    expect(montar({}).deps.compartir).toBeUndefined();
  });

  it("soltar la sesión del proveedor llega a la sesión de Google, y sin esa función no hay cómo soltar", async () => {
    const m = montar({});
    m.deps.soltarSesion?.();
    expect(m.google.soltar).toHaveBeenCalledTimes(1);
    expect(montar({}, { sinSoltar: true }).deps.soltarSesion).toBeUndefined();
  });

  it("salir cierra la sesión de Google", async () => {
    const m = montar({});
    await conSesion(m);
    await m.deps.salir();
    expect(m.google.salir).toHaveBeenCalledTimes(1);
    expect(await correr(m.deps.yo())).toBe("red");
  });

  it("la sesión que devuelve retomar queda para anotar y para yo", async () => {
    const m = montar({ alta: [ALTA_OK] });
    m.google.retomar.mockResolvedValue({ cuenta: CUENTA, nombre: null });
    await m.deps.sesion();
    expect(await alta(m)).toEqual({ ok: true, ya: false });
  });

  it("sin costo de retiro configurado en el build, no hay costo y la sala es la del enlace", () => {
    const m = montar({}, { entorno: {} });
    expect(m.deps.costoDelRetiro()).toBeNull();
    expect(m.deps.sala).toBe(SALA);
  });

  it("con el costo sin la cuenta que lo recibe, tampoco hay costo", () => {
    const m = montar({}, { entorno: { VITE_RETIRO_COSTO: "0.50" } });
    expect(m.deps.costoDelRetiro()).toBeNull();
  });

  it("con el costo configurado, lo da escrito en español con coma", () => {
    const m = montar({}, { entorno: CON_COSTO });
    expect(m.deps.costoDelRetiro()).toBe("0,50");
  });

  it("con el costo configurado y la interfaz en inglés, lo da con punto", () => {
    const m = montar({}, { entorno: CON_COSTO, idioma: "en" });
    expect(m.deps.costoDelRetiro()).toBe("0.50");
  });
});

describe("cargarConUnReintento", () => {
  const envuelto = (): { texto: string; firma: string } => ({ texto: JSON.stringify({ v: 1, evento: "nada" }), firma: "f" });

  it("si la primera carga no tiene red, repite una vez a los 3 segundos", async () => {
    const { f, llamadas } = fetchFalso([{ estado: 500, texto: "caído" }, { estado: 200, cuerpo: envuelto() }]);
    const promesa = cargarConUnReintento(f, SERVICIO, SALA, "evento-ejemplo");
    const r = await correr(promesa);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana`);
    // La segunda respuesta llegó, aunque no sea una campaña válida: ya no es un problema de red.
    expect(r).toEqual({ ok: false, estado: "mal" });
  });

  it("si la sala dice que no hay campaña, no repite", async () => {
    const { f, llamadas } = fetchFalso([error(404, "no-existe")]);
    expect(await correr(cargarConUnReintento(f, SERVICIO, SALA, "evento-ejemplo"))).toEqual({ ok: false, estado: "no-esta" });
    expect(llamadas).toHaveLength(1);
  });

  it("si las dos cargas fallan, da sin-red", async () => {
    const { f, llamadas } = fetchFalso(["corte"]);
    expect(await correr(cargarConUnReintento(f, SERVICIO, SALA, "evento-ejemplo"))).toEqual({ ok: false, estado: "sin-red" });
    expect(llamadas).toHaveLength(2);
  });
});

describe("la ventana rápida del resultado", () => {
  it("viene apagada: las dependencias no la piden, y traen el azar que reparte el primer pedido", () => {
    const m = montar({});
    expect(m.deps.ventanaRapida).toBeUndefined();
    expect(typeof m.deps.azar).toBe("function");
  });
});

describe("la lectura de la cuenta", () => {
  it("lee con la sesión de Google y devuelve lo que ella dice", async () => {
    const m = montar({});
    const lectura = m.deps.cuenta?.leer(CUENTA);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await lectura).toEqual(LECTURA_LISTA);
    expect(m.google.estadoDeLaCuenta).toHaveBeenCalledTimes(1);
    // Con la cuenta de la página: una sesión de otra persona no se le atribuye.
    expect(m.google.estadoDeLaCuenta).toHaveBeenCalledWith(CUENTA);
  });

  it("para ir a recibir, la comparación de la sesión con la cuenta sale de la sesión de Google, si la tiene", () => {
    expect(montar({}).deps.cuenta?.laSesionEs).toBeUndefined();
    const laSesionEs = vi.fn(async () => "si" as const);
    expect(montar({}, { laSesionEs }).deps.cuenta?.laSesionEs).toBe(laSesionEs);
  });

  it("espera un retraso corto al azar antes de leer: sin azar es inmediato y con el máximo, un segundo y medio", async () => {
    const sin = montar({}, { azar: 0 });
    void sin.deps.cuenta?.leer(CUENTA);
    await vi.advanceTimersByTimeAsync(0);
    expect(sin.google.estadoDeLaCuenta).toHaveBeenCalledTimes(1);

    const con = montar({}, { azar: 0.999 });
    void con.deps.cuenta?.leer(CUENTA);
    await vi.advanceTimersByTimeAsync(1_400);
    expect(con.google.estadoDeLaCuenta).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(con.google.estadoDeLaCuenta).toHaveBeenCalledTimes(1);
  });

  it("una sesión sin esa lectura no deja la dependencia: la página queda como estaba", () => {
    expect(montar({}, { sinLectura: true }).deps.cuenta).toBeUndefined();
    expect(montar({}).deps.cuenta).toBeDefined();
  });

  it("no toca la sala ni hace pedidos propios", async () => {
    const m = montar({});
    const lectura = m.deps.cuenta?.leer(CUENTA);
    await vi.advanceTimersByTimeAsync(2_000);
    await lectura;
    expect(m.llamadas).toHaveLength(0);
  });
});
