// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferFalso, ContextoFalso, mp3Falso, type ParamFalso } from "./audio-falso";

/** Lo que dice el navegador del ahorro de datos, por prueba. */
const entorno = vi.hoisted(() => ({ ahorraDatos: false }));
/** La lista de pistas del sitio: vacía en cada prueba, para no depender de las pistas de verdad. */
const listaDelSitio = vi.hoisted(() => ({ PISTAS: {} as Record<string, unknown> }));
vi.mock("./pistas-lista", () => listaDelSitio);
vi.mock("./musica-remota", async (original) => ({
  ...(await original<typeof import("./musica-remota")>()),
  leerEntorno: () => ({ hostname: "", ahorraDatos: entorno.ahorraDatos }),
}));

import {
  baseDePistas,
  estadoDePistas,
  modoDeConstruccion,
  modoDeLaDireccion,
  modoDeMusica,
  permitirPistas,
  pistaArrancar,
  pistaCallar,
  pistaDelJuego,
  pistaParar,
  pistaRemata,
  pistaRetener,
  pistaSuena,
  pistasConContexto,
  pistaTension,
  precargarPista,
  reiniciarPistas,
} from "./pistas-enganche";

/**
 * Lo que une las pistas con el sitio: el interruptor, de dónde y cuándo se baja, y que cualquier falla deje sonando la
 * música de siempre. La red es de mentira (`fetch`), el contexto de audio también.
 */

const PISTA = {
  formato: 1,
  juego: "race",
  version: "m0",
  pulso: { bpm: 120, tiempos: 2, compas: 1 },
  secciones: {
    entrada: { archivo: "race-m0-entrada.mp3", inicio: 0, compases: 7 },
    cuerpo: { archivo: "race-m0-cuerpo.mp3", inicio: 0.5, compases: 32 },
    subida: { archivo: "race-m0-subida.mp3", inicio: 0.5, compases: 14, bucleDesde: 10 },
    golpe: { archivo: "race-m0-golpe.mp3", inicio: 0.05, compases: 2 },
    festejo: { archivo: "race-m0-festejo.mp3", inicio: 0.1 },
  },
};

/**
 * Cada archivo de mentira pesa distinto, y con eso el contexto de mentira sabe cuánto dura. Las pistas de otros juegos
 * (sapo, ruleta) pesan lo mismo más 10 y más 20, así se sabe de cuál es cada descarga.
 */
const PESO_A_DURACION: Record<number, number> = { 101: 7.5, 102: 33, 103: 15, 104: 2.4, 105: 4 };
for (const desvio of [10, 20]) for (const [peso, d] of Object.entries(PESO_A_DURACION).slice(0, 5)) PESO_A_DURACION[Number(peso) + desvio] = d;
const PESOS: Record<string, number> = {
  "race-m0-entrada.mp3": 101,
  "race-m0-cuerpo.mp3": 102,
  "race-m0-subida.mp3": 103,
  "race-m0-golpe.mp3": 104,
  "race-m0-festejo.mp3": 105,
};

const BASE_LOCAL = "http://127.0.0.1:8796/muestra/";

let red: ReturnType<typeof vi.fn>;
let respuestas: Record<string, (() => unknown) | null>;
let permitido: boolean;

function contexto(): ContextoFalso {
  const ctx = new ContextoFalso();
  ctx.decodificar = (ab) => {
    const d = PESO_A_DURACION[ab.byteLength];
    if (d === undefined) throw new Error("no decodifica");
    return bufferFalso(d);
  };
  return ctx;
}

const pedidos = (): string[] => red.mock.calls.map((c) => String(c[0]));

/** Un bus de la música de osciladores, de mentira, con su volumen. */
const bus = (ctx: ContextoFalso): GainNode => {
  const g = ctx.createGain();
  g.gain.value = 0.3;
  return g;
};

beforeEach(() => {
  entorno.ahorraDatos = false;
  permitido = true;
  permitirPistas(() => permitido);
  respuestas = { [`${BASE_LOCAL}race.json`]: () => PISTA };
  for (const [n, peso] of Object.entries(PESOS)) respuestas[`${BASE_LOCAL}${n}`] = () => new ArrayBuffer(peso);
  red = vi.fn(async (url: string) => {
    const r = respuestas[url];
    if (!r) return { ok: false, status: 404 };
    const cuerpo = r();
    return { ok: true, status: 200, json: async () => cuerpo, arrayBuffer: async () => cuerpo as ArrayBuffer };
  });
  vi.stubGlobal("fetch", red);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(listaDelSitio.PISTAS)) delete listaDelSitio.PISTAS[k];
  reiniciarPistas();
  try {
    sessionStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});

const local = (extra: Record<string, unknown> = {}): void =>
  reiniciarPistas({ modo: "pistas", host: "localhost", busqueda: `?pistasdesde=${encodeURIComponent(BASE_LOCAL)}`, ...extra });

/** Baja y decodifica la pista de la carrera en local, y la deja lista. */
async function lista(ctx: ContextoFalso): Promise<void> {
  local();
  pistaDelJuego("race", ctx.comoContexto);
  await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
}

describe("el interruptor", () => {
  it("sin bandera de construcción las pistas van prendidas, y solo `sintetizada` las apaga para todos", () => {
    expect(modoDeConstruccion(undefined)).toBe("pistas");
    expect(modoDeConstruccion("")).toBe("pistas");
    expect(modoDeConstruccion("pistas")).toBe("pistas");
    expect(modoDeConstruccion("1")).toBe("pistas");
    expect(modoDeConstruccion("sintetizada")).toBe("sintetizada");
    expect(modoDeConstruccion(" Sintetizada ")).toBe("sintetizada");
  });

  it("la dirección pide una u otra", () => {
    expect(modoDeLaDireccion("?musica=pistas")).toBe("pistas");
    expect(modoDeLaDireccion("?musica=SINTETIZADA")).toBe("sintetizada");
    expect(modoDeLaDireccion("?musica=otra")).toBeNull();
    expect(modoDeLaDireccion("")).toBeNull();
  });

  it("la dirección manda sobre la bandera, y queda recordada en la pestaña", () => {
    expect(modoDeMusica(undefined, "?musica=sintetizada")).toBe("sintetizada");
    // Sin el parámetro (volvió de entrar con la cuenta), sigue lo que se pidió.
    expect(modoDeMusica(undefined, "")).toBe("sintetizada");
    expect(modoDeMusica("pistas", "")).toBe("sintetizada");
    expect(modoDeMusica("sintetizada", "?musica=pistas")).toBe("pistas");
    expect(modoDeMusica("sintetizada", "")).toBe("pistas");
    sessionStorage.clear();
    // Sin nada pedido en la pestaña, la de la bandera: prendida si no dice `sintetizada`.
    expect(modoDeMusica(undefined, "")).toBe("pistas");
    expect(modoDeMusica("sintetizada", "")).toBe("sintetizada");
  });
});

describe("de dónde se bajan", () => {
  it("en tinkazo.app, del servicio propio", () => {
    expect(baseDePistas("tinkazo.app", "")).toEqual({ base: "https://m.tinkazo.app/", local: false });
    expect(baseDePistas("www.tinkazo.app", "?pistasdesde=https://otro.example.org/")).toEqual({ base: "https://m.tinkazo.app/", local: false });
  });

  it("en una vista de prueba o una copia del sitio, de ningún lado", () => {
    expect(baseDePistas("tinkazo.vercel.app", "")).toBeNull();
    expect(baseDePistas("otro.example.org", "?pistasdesde=https://otro.example.org/")).toBeNull();
  });

  it("en la máquina de quien prueba, de la carpeta que diga la dirección, y solo por http", () => {
    expect(baseDePistas("localhost", "")).toBeNull();
    expect(baseDePistas("127.0.0.1", "?pistasdesde=http://127.0.0.1:8796/muestra")).toEqual({ base: "http://127.0.0.1:8796/muestra/", local: true });
    expect(baseDePistas("localhost", "?pistasdesde=javascript:alert(1)")).toBeNull();
    expect(baseDePistas("localhost", "?pistasdesde=no%20es%20una%20direccion")).toBeNull();
  });
});

describe("con la música sintetizada no cambia nada", () => {
  it("ni un pedido de red ni un nodo de audio, aunque todo lo demás esté listo", () => {
    reiniciarPistas({ modo: "sintetizada", host: "tinkazo.app", tocado: true });
    const ctx = contexto();
    const antes = ctx.nodos.length;
    precargarPista("race");
    pistaDelJuego("race", ctx.comoContexto);
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
    expect(pistaSuena()).toBe(false);
    expect(pistaTension(0.9, 0.2)).toBe(false);
    pistaRetener(true);
    expect(pistaRemata()).toBe(false);
    expect(red).not.toHaveBeenCalled();
    // El único nodo nuevo es el bus de mentira de esta prueba.
    expect(ctx.nodos.length).toBe(antes + 1);
  });
});

describe("cuándo no se baja nada", () => {
  it("con la música o el sonido apagados", () => {
    local();
    permitido = false;
    pistaDelJuego("race", contexto().comoContexto);
    expect(red).not.toHaveBeenCalled();
  });

  it("con ahorro de datos", () => {
    local();
    entorno.ahorraDatos = true;
    pistaDelJuego("race", contexto().comoContexto);
    expect(red).not.toHaveBeenCalled();
  });

  it("en el sitio, antes del primer toque de la persona", () => {
    reiniciarPistas({ modo: "pistas", host: "tinkazo.app", tocado: false });
    precargarPista("race");
    expect(red).not.toHaveBeenCalled();
  });

  it("en el sitio, un juego sin pista no pide nada a la red", () => {
    reiniciarPistas({ modo: "pistas", host: "tinkazo.app", tocado: true });
    const ctx = contexto();
    pistaDelJuego("race", ctx.comoContexto);
    expect(red).not.toHaveBeenCalled();
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
  });
});

describe("la lista de pistas del sitio", () => {
  it("en el sitio, el JSON sale de la lista y solo se piden los cinco archivos al servicio", async () => {
    listaDelSitio.PISTAS.race = PISTA;
    const servicio = "https://m.tinkazo.app/";
    for (const [n, peso] of Object.entries(PESOS)) respuestas[`${servicio}${n}`] = () => new ArrayBuffer(peso);
    reiniciarPistas({ modo: "pistas", host: "tinkazo.app", tocado: true });
    const ctx = contexto();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
    expect(pedidos().sort()).toEqual(Object.keys(PESOS).map((n) => `${servicio}${n}`).sort());
  });

  it("en el sitio, un juego que no está en la lista no pide nada aunque haya otros", () => {
    listaDelSitio.PISTAS.race = PISTA;
    reiniciarPistas({ modo: "pistas", host: "tinkazo.app", tocado: true });
    pistaDelJuego("sapo", contexto().comoContexto);
    expect(red).not.toHaveBeenCalled();
  });
});

describe("la pista que llega", () => {
  it("baja el JSON y las cinco secciones de la carpeta, las decodifica una vez y suena en lugar de la de osciladores", async () => {
    const ctx = contexto();
    await lista(ctx);
    expect(pedidos().sort()).toEqual([`${BASE_LOCAL}race.json`, ...Object.keys(PESOS).map((n) => `${BASE_LOCAL}${n}`)].sort());
    const b = bus(ctx);
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, b, 0.3)).toBe(true);
    expect(pistaSuena()).toBe(true);
    expect(ctx.dePista("entrada")).toHaveLength(1);
    // La de osciladores queda muda.
    expect((b.gain as unknown as ParamFalso).en(0.1)).toBe(0);
    // El sorteo siguiente no vuelve a bajar nada.
    pistaDelJuego("race", ctx.comoContexto);
    precargarPista("race");
    expect(red).toHaveBeenCalledTimes(6);
  });

  it("lo que bajó en la cuenta regresiva se decodifica apenas la página tiene su contexto de audio", async () => {
    local();
    precargarPista("race");
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("bajada"));
    pistasConContexto(contexto().comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
  });

  it("cada pedido del show llega a la pista", async () => {
    const ctx = contexto();
    await lista(ctx);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    ctx.currentTime = 12;
    expect(pistaTension(0.9, 0.7)).toBe(true);
    expect(ctx.dePista("subida")).toHaveLength(1);
    ctx.currentTime = 20;
    pistaRetener(true);
    ctx.currentTime = 21;
    pistaRetener(false);
    expect(ctx.dePista("subida")).toHaveLength(2);
    ctx.currentTime = 25;
    expect(pistaRemata()).toBe(true);
    expect(ctx.dePista("golpe")).toHaveLength(1);
  });
});

describe("si algo falla, suena la de siempre", () => {
  it("el JSON no llega: no se pide ningún archivo", async () => {
    respuestas[`${BASE_LOCAL}race.json`] = null;
    const ctx = contexto();
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    expect(pedidos()).toEqual([`${BASE_LOCAL}race.json`]);
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
  });

  it("un JSON que no cierra", async () => {
    respuestas[`${BASE_LOCAL}race.json`] = () => ({ ...PISTA, formato: 9 });
    const ctx = contexto();
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
  });

  it("un archivo que no llega: la de siempre, y se vuelve a intentar hasta tres veces", async () => {
    respuestas[`${BASE_LOCAL}race-m0-golpe.mp3`] = null;
    const ctx = contexto();
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
    for (let i = 0; i < 4; i++) {
      precargarPista("race");
      await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    }
    expect(pedidos().filter((u) => u.endsWith("race.json"))).toHaveLength(3);
  });

  it("un archivo que no decodifica no se vuelve a pedir", async () => {
    respuestas[`${BASE_LOCAL}race-m0-cuerpo.mp3`] = () => new ArrayBuffer(7);
    const ctx = contexto();
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    precargarPista("race");
    expect(pedidos().filter((u) => u.endsWith("race.json"))).toHaveLength(1);
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
  });

  it("un archivo más corto de lo que dice el JSON", async () => {
    respuestas[`${BASE_LOCAL}race-m0-cuerpo.mp3`] = () => new ArrayBuffer(105);
    const ctx = contexto();
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
  });

  it("algo que se rompe en medio del show: la pista se calla y la de osciladores vuelve con su volumen", async () => {
    const ctx = contexto();
    await lista(ctx);
    const b = bus(ctx);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, b, 0.3);
    ctx.currentTime = 12;
    ctx.createBufferSource = (): AudioBufferSourceNode => {
      throw new Error("sin audio");
    };
    expect(pistaTension(0.9, 0.7)).toBe(false);
    expect(pistaSuena()).toBe(false);
    expect((b.gain as unknown as ParamFalso).en(12.01)).toBeCloseTo(0.3, 6);
    expect(pistaRemata()).toBe(false);
  });
});

describe("la pista que llega tarde", () => {
  it("si llega en el primer segundo y medio, entra y la de osciladores se va en 0,3 s", async () => {
    const ctx = contexto();
    let soltar: (() => void) | null = null;
    const decodificar = ctx.decodificar;
    local();
    pistaDelJuego("race", null);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("bajada"));
    // Decodifica recién cuando la prueba lo suelta.
    ctx.decodeAudioData = (ab: ArrayBuffer): Promise<AudioBuffer> => new Promise((ok) => {
      const antes = soltar;
      soltar = (): void => {
        antes?.();
        ok(decodificar(ab));
      };
    });
    const b = bus(ctx);
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, b, 0.3)).toBe(false);
    expect(pistaSuena()).toBe(false);
    ctx.currentTime = 1;
    (soltar as unknown as () => void)();
    await vi.waitFor(() => expect(pistaSuena()).toBe(true));
    expect((b.gain as unknown as ParamFalso).en(1.3)).toBeCloseTo(0, 6);
  });

  it("si llega después, ese sorteo sigue con la de osciladores y la pista queda para el siguiente", async () => {
    const ctx = contexto();
    let soltar: (() => void) | null = null;
    const decodificar = ctx.decodificar;
    local();
    pistaDelJuego("race", null);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("bajada"));
    ctx.decodeAudioData = (ab: ArrayBuffer): Promise<AudioBuffer> => new Promise((ok) => {
      const antes = soltar;
      soltar = (): void => {
        antes?.();
        ok(decodificar(ab));
      };
    });
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    ctx.currentTime = 2;
    (soltar as unknown as () => void)();
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
    expect(pistaSuena()).toBe(false);
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(true);
  });

  it("si el juego ya cortó la música, la pista que llega no entra en medio de la mecánica", async () => {
    const ctx = contexto();
    let soltar: (() => void) | null = null;
    const decodificar = ctx.decodificar;
    local();
    pistaDelJuego("race", null);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("bajada"));
    ctx.decodeAudioData = (ab: ArrayBuffer): Promise<AudioBuffer> => new Promise((ok) => {
      const antes = soltar;
      soltar = (): void => {
        antes?.();
        ok(decodificar(ab));
      };
    });
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    pistaRetener(true);
    (soltar as unknown as () => void)();
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
    expect(pistaSuena()).toBe(false);
  });

  it("con el contexto suspendido, entra cuando el contexto arranca", async () => {
    const ctx = contexto();
    await lista(ctx);
    ctx.state = "suspended";
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
    ctx.state = "running";
    for (const fn of ctx.escuchas.statechange ?? []) fn();
    expect(pistaSuena()).toBe(true);
  });
});

describe("la espera de una pista que no estaba lista no deja nada colgado", () => {
  const oyentes = (ctx: ContextoFalso): number => (ctx.escuchas.statechange ?? []).length;

  it("con la pista lista y el contexto sin correr no queda un aviso en la carga", async () => {
    const ctx = contexto();
    await lista(ctx);
    ctx.state = "suspended";
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
    // La carga ya está lista: nadie va a volver a avisar, así que no se le deja un aviso (que retendría el bus y la sala).
    expect(estadoDePistas().avisos).toBe(0);
    expect(oyentes(ctx)).toBe(1);
  });

  it("al entrar la pista, el oyente del contexto se quita en el acto", async () => {
    const ctx = contexto();
    await lista(ctx);
    ctx.state = "suspended";
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    ctx.state = "running";
    for (const fn of [...(ctx.escuchas.statechange ?? [])]) fn();
    expect(pistaSuena()).toBe(true);
    expect(oyentes(ctx)).toBe(0);
  });

  it.each([
    ["el juego retiene la música", (): void => pistaRetener(true)],
    ["el ganador", (): void => void pistaRemata()],
    ["se termina el show", (): void => pistaParar(false)],
  ])("si %s antes de que la pista entre, el oyente se quita", async (_, hacer) => {
    const ctx = contexto();
    await lista(ctx);
    ctx.state = "suspended";
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    expect(oyentes(ctx)).toBe(1);
    hacer();
    expect(oyentes(ctx)).toBe(0);
    // Y aunque el contexto arranque después, la pista no entra.
    ctx.state = "running";
    expect(pistaSuena()).toBe(false);
  });

  it("una pista que todavía baja deja su aviso en la carga, y lo saca cuando la espera termina", async () => {
    const ctx = contexto();
    local();
    // La decodificación queda esperando: la carga está en `decodificando`.
    ctx.decodeAudioData = (): Promise<AudioBuffer> => new Promise(() => undefined);
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("decodificando"));
    expect(estadoDePistas().avisos).toBe(0);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    expect(estadoDePistas().avisos).toBe(1);
    // Un sorteo nuevo que arranca de nuevo no suma otro aviso encima del anterior.
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    expect(estadoDePistas().avisos).toBe(1);
    pistaRetener(true);
    expect(estadoDePistas().avisos).toBe(0);
  });
});

describe("la cola del festejo", () => {
  /** Un sorteo que termina con el festejo todavía sonando: devuelve la fuente del festejo. */
  async function conFestejoSonando(ctx: ContextoFalso): Promise<ReturnType<ContextoFalso["dePista"]>[number]> {
    await lista(ctx);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    ctx.currentTime = 30;
    expect(pistaRemata()).toBe(true);
    ctx.currentTime = 33;
    pistaParar(false);
    const f = ctx.dePista("festejo")[0];
    if (!f) throw new Error("el festejo no sonó");
    return f;
  }

  it("se puede callar después de terminado el show, en 0,1 s", async () => {
    const ctx = contexto();
    const festejo = await conFestejoSonando(ctx);
    ctx.currentTime = 33.2;
    const antes = ctx.nivelFinal(festejo, 33.2);
    expect(antes).toBeGreaterThan(0.2);
    pistaCallar();
    expect(ctx.nivelFinal(festejo, 33.3)).toBeCloseTo(0, 6);
    // Pedirlo otra vez no hace nada.
    expect(() => pistaCallar()).not.toThrow();
  });

  it("sin nada sonando, callar no hace nada", () => {
    expect(() => pistaCallar()).not.toThrow();
  });

  it("con el sonido o la música apagados la pista se va sola en 0,35 s y no deja nada para callar", async () => {
    const ctx = contexto();
    await lista(ctx);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    ctx.currentTime = 30;
    pistaRemata();
    ctx.currentTime = 33;
    pistaParar(true);
    const festejo = ctx.dePista("festejo")[0];
    expect(festejo && ctx.nivelFinal(festejo, 33.35)).toBeCloseTo(0, 6);
  });

  it("un sorteo nuevo con pista no empieza encima de la cola del anterior", async () => {
    const ctx = contexto();
    const festejo = await conFestejoSonando(ctx);
    ctx.currentTime = 33.2;
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(true);
    expect(ctx.nivelFinal(festejo, 33.35)).toBeCloseTo(0, 6);
    expect(ctx.dePista("entrada")).toHaveLength(2);
  });

  it("parar de nuevo (el show llama dos veces) no corta el festejo", async () => {
    const ctx = contexto();
    const festejo = await conFestejoSonando(ctx);
    pistaParar(false);
    ctx.currentTime = 33.5;
    expect(ctx.nivelFinal(festejo, 33.5)).toBeGreaterThan(0.2);
  });
});

describe("el silencio del codificador en el navegador de la persona", () => {
  // 1.263 cuadros de 1.152 muestras a 44,1 kHz: 32,993 s en bruto y 32,957 s sin los 576 y los 1.000 del codificador.
  const BRUTO = (1263 * 1152) / 44100;
  const RECORTADO = (1263 * 1152 - 576 - 1000) / 44100;
  const cabecera = (cuadros: number): ArrayBuffer => mp3Falso({ id3: 34, cuadros, retardo: 576, relleno: 1000 });

  /** Baja la pista de la carrera con un cuerpo cuya cabecera dice 1.263 cuadros y que el navegador decodifica con esa duración. */
  async function conCuerpoDecodificadoEn(duracion: number, cuadros = 1263): Promise<ContextoFalso> {
    respuestas[`${BASE_LOCAL}race-m0-cuerpo.mp3`] = () => cabecera(cuadros);
    const ctx = contexto();
    const otros = ctx.decodificar;
    ctx.decodificar = (ab) => (ab.byteLength === 4000 ? bufferFalso(duracion) : otros(ab));
    await lista(ctx);
    return ctx;
  }

  it("si el navegador recortó el silencio (Chrome y Firefox), el bucle queda en el inicio del JSON y no se anota nada", async () => {
    const ctx = await conCuerpoDecodificadoEn(RECORTADO);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    expect(ctx.dePista("cuerpo")[0]?.loopStart).toBeCloseTo(0.5, 6);
    expect(estadoDePistas().registro.some((r) => r.que.startsWith("corre"))).toBe(false);
  });

  it("si no lo recortó, todos los puntos de esa sección se corren 25 ms y queda anotado", async () => {
    const ctx = await conCuerpoDecodificadoEn(BRUTO);
    pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3);
    const cuerpo = ctx.dePista("cuerpo")[0];
    expect(cuerpo?.loopStart).toBeCloseTo(0.5 + 1105 / 44100, 6);
    expect(cuerpo?.loopEnd).toBeCloseTo(0.5 + 1105 / 44100 + 32, 6);
    expect(estadoDePistas().registro.map((r) => r.que)).toContain("corre race/cuerpo 25.1 ms");
    // Las demás secciones no traen cabecera de LAME: no se les toca nada.
    expect(ctx.dePista("entrada")[0]?.inicio?.desde).toBe(0);
  });

  it("si con el corrimiento el archivo ya no tiene la cola que pide el bucle, suena la de siempre", async () => {
    // 1.245 cuadros sin recortar duran 32,522 s: alcanzan para 0,5 + 32 + 20 ms de cola, pero no con 25 ms de corrimiento.
    const ctx = contexto();
    respuestas[`${BASE_LOCAL}race-m0-cuerpo.mp3`] = () => cabecera(1245);
    const otros = ctx.decodificar;
    ctx.decodificar = (ab) => (ab.byteLength === 4000 ? bufferFalso((1245 * 1152) / 44100) : otros(ab));
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("fallo"));
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
  });
});

describe("la memoria del celular", () => {
  it("quedan las pistas de dos juegos como mucho", () => {
    local();
    for (const j of ["race", "sapo", "wheel"]) precargarPista(j);
    expect(Object.keys(estadoDePistas().cargas)).toHaveLength(2);
  });
});

/** La pista de prueba de otro juego: los mismos cinco archivos con otros nombres y otro peso (`desvio` más). */
function pistaDe(juego: string, desvio: number): void {
  const nombres = ["entrada", "cuerpo", "subida", "golpe", "festejo"];
  const secciones = Object.fromEntries(
    Object.entries(PISTA.secciones).map(([n, s]) => [n, { ...s, archivo: `${juego}-m0-${n}.mp3` }]),
  );
  respuestas[`${BASE_LOCAL}${juego}.json`] = () => ({ ...PISTA, juego, secciones });
  nombres.forEach((n, i) => {
    respuestas[`${BASE_LOCAL}${juego}-m0-${n}.mp3`] = () => new ArrayBuffer(101 + i + desvio);
  });
}

interface Retenido {
  url: string;
  signal: AbortSignal | undefined;
  /** Contesta el pedido que estaba esperando. */
  soltar: () => void;
}

/**
 * Una red de mentira que se queda con los pedidos de los archivos que cumplen `retiene` hasta que la prueba los suelta.
 * Un pedido retenido contesta con un error de corte cuando se le corta la señal, como el de verdad, salvo con `ignoraCorte`.
 */
function redRetenida(retiene: (url: string) => boolean, ignoraCorte = false): Retenido[] {
  const retenidos: Retenido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string, init?: { signal?: AbortSignal }) =>
        new Promise((ok, mal) => {
          const contestar = (): void => {
            const r = respuestas[url];
            if (!r) return ok({ ok: false, status: 404 });
            const cuerpo = r();
            ok({ ok: true, status: 200, json: async () => cuerpo, arrayBuffer: async () => cuerpo as ArrayBuffer });
          };
          if (!retiene(url)) return contestar();
          retenidos.push({ url, signal: init?.signal, soltar: contestar });
          if (!ignoraCorte) init?.signal?.addEventListener("abort", () => mal(new DOMException("cortado", "AbortError")));
        }),
    ),
  );
  return retenidos;
}

const esperarUnPoco = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

describe("las descargas de pistas que ya nadie va a usar", () => {
  it("al descartarse una carga, su descarga se corta", async () => {
    pistaDe("sapo", 10);
    pistaDe("wheel", 20);
    const ctx = contexto();
    local();
    const retenidos = redRetenida((u) => u.includes("sapo-m0-"));
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
    precargarPista("sapo");
    await vi.waitFor(() => expect(retenidos).toHaveLength(5));
    expect(retenidos.some((p) => p.signal?.aborted)).toBe(false);
    // El juego que suena es la carrera: al pedir la tercera pista, la del sapo (la más vieja de las otras) se va.
    precargarPista("wheel");
    expect(retenidos.every((p) => p.signal?.aborted)).toBe(true);
    expect(Object.keys(estadoDePistas().cargas).sort()).toEqual(["race", "wheel"]);
  });

  it("una descarga que termina después de descartada no se guarda ni se decodifica", async () => {
    pistaDe("sapo", 10);
    pistaDe("wheel", 20);
    const ctx = contexto();
    local();
    // Esta red no hace caso del corte: la descarga termina igual, tarde.
    const retenidos = redRetenida((u) => u.includes("sapo-m0-"), true);
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
    const decodificadas = vi.spyOn(ctx, "decodeAudioData");
    precargarPista("sapo");
    await vi.waitFor(() => expect(retenidos).toHaveLength(5));
    precargarPista("wheel");
    retenidos.forEach((p) => p.soltar());
    await esperarUnPoco();
    await vi.waitFor(() => expect(estadoDePistas().cargas.wheel).toBe("lista"));
    // Solo se decodificaron los cinco archivos de la ruleta: ninguno del sapo.
    expect(decodificadas).toHaveBeenCalledTimes(5);
    expect(estadoDePistas().registro.map((r) => r.que)).not.toContain("bajada sapo");
  });

  it("una pista que se descarta mientras se decodifica se tira en lugar de quedar lista", async () => {
    pistaDe("sapo", 10);
    pistaDe("wheel", 20);
    const ctx = contexto();
    local();
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("lista"));
    // Los archivos del sapo se quedan decodificando hasta que la prueba los suelta.
    const decodificar = ctx.decodeAudioData.bind(ctx);
    const esperando: (() => void)[] = [];
    ctx.decodeAudioData = (ab: ArrayBuffer): Promise<AudioBuffer> =>
      ab.byteLength > 110 && ab.byteLength < 120 ? new Promise((ok) => esperando.push(() => ok(decodificar(ab)))) : decodificar(ab);
    precargarPista("sapo");
    await vi.waitFor(() => expect(estadoDePistas().cargas.sapo).toBe("decodificando"));
    precargarPista("wheel");
    esperando.forEach((fn) => fn());
    await esperarUnPoco();
    expect(estadoDePistas().registro.map((r) => r.que)).not.toContain("lista sapo");
    expect(Object.keys(estadoDePistas().cargas)).not.toContain("sapo");
  });

  it("con los dos lugares ocupados, la pista recién pedida no se baja", async () => {
    pistaDe("sapo", 10);
    pistaDe("wheel", 20);
    const ctx = contexto();
    local();
    // La carrera espera su decodificación y el show ya la pidió; después se elige el sapo, y es el juego de ahora.
    ctx.decodeAudioData = (): Promise<AudioBuffer> => new Promise(() => undefined);
    pistaDelJuego("race", ctx.comoContexto);
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("decodificando"));
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus(ctx), 0.3)).toBe(false);
    pistaDelJuego("sapo", ctx.comoContexto);
    await vi.waitFor(() => expect(pedidos()).toContain(`${BASE_LOCAL}sapo-m0-festejo.mp3`));
    const antes = pedidos().length;
    precargarPista("wheel");
    await esperarUnPoco();
    expect(pedidos()).toHaveLength(antes);
    expect(Object.keys(estadoDePistas().cargas).sort()).toEqual(["race", "sapo"]);
  });
});
