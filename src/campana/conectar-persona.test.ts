import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { descifrarEquipo } from "../equipos/datos";
import { fetchFalso, type Llamada, type Paso } from "../sala/fetch-falso";
import type { DepsDelCelular, SesionDelCelular } from "./celular";
import { depsDePersona, type PiezasDeLaPersona } from "./conectar-persona";
import { campanaDeEjemplo } from "./ejemplo";
import type { BotonDeGoogleDeVerdad } from "./google";
import { SIN_CUENTA } from "./memoria";

const SERVICIO = "https://servicio.example.org";
const SALA = "ABCDEFGH";
const CLAVE = "abcdefghijklmnopqrstuv";
const PASE = "ABCDEFGHIJKL";
const AHORA = 1_800_000_000_000;
const ESTADO_BUENO = { fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, pase: "vale" };
const YO_ANOTADA = { fase: "abierta", total: 5, cierraMs: AHORA + 3_600_000, anotada: true };
const ALTA_OK: Paso = { estado: 201, cuerpo: { anotada: true } };
const error = (estado: number, motivo: string): Paso => ({ estado, cuerpo: { error: motivo } });

const tokenDe = (nombre: string): string => {
  const parte = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${parte({ alg: "RS256" })}.${parte({ name: nombre, email: "ana@example.org" })}.firma`;
};

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

interface Montaje {
  deps: DepsDelCelular;
  llamadas: Llamada[];
  memoria: Storage;
  /** Lo que el botón de Google entrega al entrar una persona. */
  entrar: (credencial: string) => SesionDelCelular | null;
  bloqueos: string[];
  /** El `cada` de la base: lo que la página le pide al reloj. */
  cada: ReturnType<typeof vi.fn>;
}

function montar(guion: Record<string, Paso[]>, o: { enLinea?: boolean; memoria?: Storage; congelado?: boolean } = {}): Montaje {
  const { f, llamadas } = fetchFalso(guion);
  const memoria = o.memoria ?? almacenFalso();
  let alEntrar: (credencial: string) => void = () => undefined;
  const google: BotonDeGoogleDeVerdad = {
    montar: (_contenedor, entrar) => {
      alEntrar = entrar;
      return () => undefined;
    },
  };
  const bloqueos: string[] = [];
  const cada = vi.fn((_f: () => void, _ms: number, _modo?: "azar" | "exacta") => () => undefined);
  const piezas: PiezasDeLaPersona = {
    base: {
      tx: (clave) => clave,
      idioma: () => "es",
      enApp: false,
      ahora: () => Date.now(),
      cada,
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
    enlace: () => "https://tinkazo.example.org/participar.html?c=x",
    bloquear: async (nombre, trabajo) => {
      bloqueos.push(nombre);
      return trabajo();
    },
    // Con el reloj congelado el tope del toque no se pasa, así que cada pedido sin respuesta espera y se vuelve a intentar.
    dep: { fetch: f, azar: () => 0.5, ...(o.congelado ? { ahora: () => AHORA } : {}) },
  };
  const deps = depsDePersona(piezas);
  const entrar = (credencial: string): SesionDelCelular | null => {
    let sesion: SesionDelCelular | null = null;
    deps.persona?.google.montar({} as HTMLElement, (s) => {
      sesion = s;
    }, () => undefined);
    alEntrar(credencial);
    return sesion;
  };
  return { deps, llamadas, memoria, entrar, bloqueos, cada };
}

/** Deja correr el reloj falso hasta que todo lo pendiente termine. */
async function correr<T>(promesa: Promise<T>, ms = 300_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promesa;
}

/** Como `correr`, pero en pasos: entre uno y otro el reloj falso deja avanzar lo que no depende de él. */
async function correrDeAPoco<T>(promesa: Promise<T>): Promise<T> {
  for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(5_000);
  return promesa;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("depsDePersona", () => {
  it("la entrada es el botón de Google: da la sesión sin cuenta y con el nombre del perfil", () => {
    const { entrar } = montar({});
    expect(entrar(tokenDe("Ana Pérez"))).toEqual({ cuenta: SIN_CUENTA, nombre: "Ana P." });
  });

  it("no hay sesión que retomar ni ventana de entrada, y no se declara ninguna lectura de cuenta", async () => {
    const { deps } = montar({});
    expect(await deps.sesion()).toBeNull();
    await expect(deps.entrar()).rejects.toThrow("google");
    expect(deps.cuenta).toBeUndefined();
    expect(deps.soltarSesion).toBeUndefined();
    expect(deps.nombreTardio).toBeUndefined();
    expect(deps.ventanaRapida).toBeUndefined();
    expect(deps.costoDelRetiro()).toBeNull();
  });

  it("lo público se pide a la sala con el pase", async () => {
    const { deps, llamadas } = montar({ estado: [{ estado: 200, cuerpo: ESTADO_BUENO }] });
    expect(await deps.publico()).toMatchObject({ fase: "abierta", total: 5, pase: "vale" });
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/estado?p=${PASE}`);
  });

  it("anotar manda el token de Google, el nombre cifrado con la clave del QR, la llave y el pase", async () => {
    const { deps, llamadas, entrar, bloqueos } = montar({ alta: [ALTA_OK] });
    const token = tokenDe("Ana Pérez");
    const sesion = entrar(token);
    const r = await correr(deps.anotar(sesion?.nombre ?? null, () => undefined));
    expect(r).toEqual({ ok: true, ya: false });
    expect(bloqueos).toEqual([`tinkazo.campana.alta.${SALA}`]);
    const cuerpo = JSON.parse(String(llamadas[0]?.init.body)) as Record<string, string>;
    expect(Object.keys(cuerpo).sort()).toEqual(["d", "google", "llave", "p"]);
    expect(cuerpo.google).toBe(token);
    expect(cuerpo.p).toBe(PASE);
    expect(await descifrarEquipo(CLAVE, cuerpo.d ?? "")).toMatchObject({ nombre: "Ana P." });
  });

  it("el token no se manda más de una vez cuando el alta salió bien, y no se guarda en ningún lado", async () => {
    const { deps, entrar, memoria } = montar({ alta: [ALTA_OK] });
    const token = tokenDe("Ana");
    entrar(token);
    await correr(deps.anotar("Ana", () => undefined));
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "sesion" });
    expect(JSON.stringify(Object.fromEntries([...Array(memoria.length).keys()].map((n) => [n, memoria.getItem(memoria.key(n) ?? "")])))).not.toContain(token);
  });

  it("sin haber entrado con Google no se anota nada", async () => {
    const { deps, llamadas } = montar({ alta: [ALTA_OK] });
    expect(await correr(deps.anotar(null, () => undefined))).toEqual({ ok: false, motivo: "sesion" });
    expect(llamadas).toHaveLength(0);
  });

  it("sin conexión ni se manda", async () => {
    const { deps, llamadas, entrar } = montar({ alta: [ALTA_OK] }, { enLinea: false });
    entrar(tokenDe("Ana"));
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "red" });
    expect(llamadas).toHaveLength(0);
  });

  it("una sesión que la sala rechazó no se vuelve a mandar: hay que entrar de nuevo", async () => {
    const { deps, llamadas, entrar } = montar({ alta: [error(401, "sesion")] });
    entrar(tokenDe("Ana"));
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "sesion" });
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "sesion" });
    expect(llamadas.filter((l) => l.ruta === "alta")).toHaveLength(1);
  });

  it("si la respuesta se perdió, se repite el alta con el mismo token y la sala la reconoce: cuenta como anotada", async () => {
    const { deps, llamadas, entrar } = montar({
      alta: ["corte", "corte", { estado: 200, cuerpo: { anotada: true, ya: true } }],
      yo: [{ estado: 200, cuerpo: YO_ANOTADA }],
    }, { congelado: true });
    const token = tokenDe("Ana");
    entrar(token);
    expect(await correrDeAPoco(deps.anotar("Ana", () => undefined))).toEqual({ ok: true, ya: true });
    const altas = llamadas.filter((l) => l.ruta === "alta");
    expect(altas).toHaveLength(3);
    expect((JSON.parse(String(altas[2]?.init.body)) as { google: string }).google).toBe(token);
    // Lo que dice la llave del celular no prueba que esta persona quedó anotada: no se pregunta.
    expect(llamadas.some((l) => l.ruta === "yo")).toBe(false);
  });

  it("si otra persona usó antes este celular, su anotación no da por anotada a quien falló", async () => {
    const { deps, llamadas, entrar } = montar({ alta: ["corte"], yo: [{ estado: 200, cuerpo: YO_ANOTADA }] }, { congelado: true });
    entrar(tokenDe("Beto"));
    expect(await correrDeAPoco(deps.anotar("Beto", () => undefined))).toEqual({ ok: false, motivo: "red" });
    expect(llamadas.some((l) => l.ruta === "yo")).toBe(false);
  });

  it("si al repetir la sala dice que el token no sirve, hay que entrar de nuevo", async () => {
    const { deps, entrar } = montar({ alta: ["corte", "corte", error(401, "sesion")] }, { congelado: true });
    entrar(tokenDe("Ana"));
    expect(await correrDeAPoco(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "sesion" });
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "sesion" });
  });

  it("si la sala dijo que no anotó nada (tope de la conexión), no se repite ni se pregunta", async () => {
    const { deps, llamadas, entrar } = montar({ alta: [error(429, "cupo-conexion")], yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    entrar(tokenDe("Ana"));
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "wifi" });
    expect(llamadas.filter((l) => l.ruta === "alta")).toHaveLength(1);
    expect(llamadas.some((l) => l.ruta === "yo")).toBe(false);
  });

  it("No soy yo suelta la llave de este celular: la próxima persona no hereda lo que anotó la anterior", async () => {
    const { deps, llamadas, entrar, memoria } = montar({ alta: [ALTA_OK], yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    entrar(tokenDe("Ana"));
    await correr(deps.anotar("Ana", () => undefined));
    await deps.yo();
    const antes = (JSON.parse(String(llamadas.find((l) => l.ruta === "yo")?.init.body)) as { llave: string }).llave;
    await deps.salir();
    await deps.yo();
    const yos = llamadas.filter((l) => l.ruta === "yo");
    const despues = (JSON.parse(String(yos[1]?.init.body)) as { llave: string }).llave;
    expect(despues).not.toBe(antes);
    expect(memoria.getItem("tinkazo.equipo.llaves") ?? "").not.toContain(antes);
  });

  it("un rechazo que no se pudo perder no pregunta nada más", async () => {
    const { deps, llamadas, entrar } = montar({ alta: [error(409, "pase")] });
    entrar(tokenDe("Ana"));
    expect(await correr(deps.anotar("Ana", () => undefined))).toEqual({ ok: false, motivo: "pase" });
    expect(llamadas.some((l) => l.ruta === "yo")).toBe(false);
  });

  it("yo pregunta por la llave de este celular, la misma del alta, sin cuenta", async () => {
    const { deps, llamadas, entrar } = montar({ alta: [ALTA_OK], yo: [{ estado: 200, cuerpo: YO_ANOTADA }] });
    entrar(tokenDe("Ana"));
    await correr(deps.anotar("Ana", () => undefined));
    const llaveDelAlta = (JSON.parse(String(llamadas.find((l) => l.ruta === "alta")?.init.body)) as { llave: string }).llave;
    expect(await deps.yo()).toMatchObject({ anotada: true });
    expect(JSON.parse(String(llamadas.find((l) => l.ruta === "yo")?.init.body))).toEqual({ llave: llaveDelAlta });
  });

  it("la llave se guarda en el celular y es la misma al volver a abrir la página", async () => {
    const memoria = almacenFalso();
    const a = montar({ yo: [{ estado: 200, cuerpo: YO_ANOTADA }] }, { memoria });
    await a.deps.yo();
    const b = montar({ yo: [{ estado: 200, cuerpo: YO_ANOTADA }] }, { memoria });
    await b.deps.yo();
    expect(a.llamadas[0]?.init.body).toBe(b.llamadas[0]?.init.body);
  });

  it("el resultado nombra a las ganadoras por su línea", async () => {
    const linea = "p1:aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { deps } = montar({ resultado: [{ estado: 200, cuerpo: { sorteo: "5", ganadoras: [linea], comprobante: "/verificar.html?x=1" } }] });
    expect(await deps.resultado()).toEqual({ ganadoras: [linea], comprobante: "/verificar.html?x=1" });
  });

  it("las consultas de cada 15 segundos se estiran a 30, y las exactas y las del resultado no", () => {
    const { deps, cada } = montar({});
    deps.cada(() => undefined, 15_000);
    deps.cada(() => undefined, 15_000, "exacta");
    deps.cada(() => undefined, 8_000, "azar");
    // Con el azar a la mitad el factor es 1: 30 s la consulta estirada, y los otros dos como venían.
    expect(cada.mock.calls.map((c) => c[1])).toEqual([30_000, 15_000, 8_000]);
  });
});
