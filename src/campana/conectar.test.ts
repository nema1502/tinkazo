import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import {
  almacenEnMemoria,
  cargarConUnReintento,
  depsConectadas,
  destinoDeRecibir,
  teniaLlave,
  type PiezasDelCelular,
} from "./conectar";
import type { DepsDelCelular, SesionDelCelular } from "./celular";
import { fetchFalso, type Llamada, type Paso } from "../sala/fetch-falso";
import type { SesionDeGoogle } from "./sesion";

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
    sigueLaSesion: vi.fn(async (_cuenta: string) => sigue),
    salir: vi.fn(async () => undefined),
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
    hayMarca?: boolean;
    azar?: number;
    tokens?: (string | null)[];
    sigue?: boolean;
    /** Cuánto espera el candado a que otra pestaña termine, en milisegundos del reloj falso. */
    esperaDelCandado?: number;
  } = {},
): Montaje {
  const { f, llamadas } = fetchFalso(guion);
  const memoria = o.memoria ?? almacenFalso();
  const google = googleFalso(o.tokens ?? ["tok_" + "x".repeat(30)], o.sigue ?? false);
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
      idioma: () => "es",
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
    hayMarcaDelProveedor: () => o.hayMarca ?? false,
    ir,
    enlace: () => "https://tinkazo.example.org/participar.html?c=x",
    bloquear,
    dep: { fetch: f, azar: () => o.azar ?? 0.5 },
  };
  return { deps: depsConectadas(piezas), llamadas, memoria, google, ir, bloqueos };
}

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
    expect(r).toEqual({ fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, pase: "vale" });
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

  it("con el pase vencido, una llave guardada antes y la marca del proveedor, sigue como sin pase", async () => {
    const memoria = almacenFalso();
    memoria.setItem("tinkazo.equipo.llaves", JSON.stringify([[SALA, "L".repeat(22)]]));
    const m = montar({ estado: [{ estado: 200, cuerpo: { ...ESTADO_BUENO, pase: "vencido" } }] }, { memoria, hayMarca: true });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "sin" });
  });

  it("con el pase vencido y sin llave guardada antes, sigue vencido", async () => {
    const m = montar({ estado: [{ estado: 200, cuerpo: { ...ESTADO_BUENO, pase: "vencido" } }] }, { hayMarca: true });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "vencido" });
  });

  it("con el pase vencido y sin marca del proveedor, sigue vencido", async () => {
    const memoria = almacenFalso();
    memoria.setItem("tinkazo.equipo.llaves", JSON.stringify([[SALA, "L".repeat(22)]]));
    const m = montar({ estado: [{ estado: 200, cuerpo: { ...ESTADO_BUENO, pase: "vencido" } }] }, { memoria, hayMarca: false });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "vencido" });
  });

  it("con el pase vigente no cambia nada", async () => {
    const m = montar({ estado: [{ estado: 200, cuerpo: ESTADO_BUENO }] }, { hayMarca: true });
    expect(await correr(m.deps.publico())).toMatchObject({ pase: "vale" });
  });
});

describe("el ritmo de las consultas", () => {
  const intervalo = (azar: number, ms: number): number => {
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
        sigueLaSesion: async () => false,
        salir: async () => undefined,
      },
      memoria: almacenFalso(),
      red: "testnet",
      enLinea: () => true,
      hayMarcaDelProveedor: () => false,
      ir: () => undefined,
      enlace: () => "x",
      dep: { fetch: f, azar: () => azar },
    });
    deps.cada(() => undefined, ms);
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

  it("teniaLlave dice si ya había una llave y no escribe nada", () => {
    const memoria = almacenFalso();
    expect(teniaLlave(SALA, memoria)).toBe(false);
    expect(memoria.length).toBe(0);
    memoria.setItem("tinkazo.equipo.llaves", JSON.stringify([[SALA, "L".repeat(22)]]));
    expect(teniaLlave(SALA, memoria)).toBe(true);
    expect(teniaLlave("OTRASALA", memoria)).toBe(false);
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

  it("no hay costo de retiro todavía y la sala es la del enlace", () => {
    const m = montar({});
    expect(m.deps.costoDelRetiro()).toBeNull();
    expect(m.deps.sala).toBe(SALA);
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
