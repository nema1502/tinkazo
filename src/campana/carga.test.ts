import { describe, expect, it, vi } from "vitest";
import { RELOJ_DEL_NAVEGADOR, cargarCampana, type RelojDeCarga } from "./carga";

const cuerpo = (): Record<string, unknown> => ({
  v: 1,
  evento: "abc",
  red: "testnet",
  estado: "abierta",
  empresa: { nombre: "Empresa", logo: null, color: "verde" },
  lugar: { es: "Lugar", en: "Place" },
  zona: "America/La_Paz",
  premios: ["400000000"],
  abre_ms: 1,
  cierra_ms: 2,
  sorteo_ms: 3,
  recibir_hasta_ms: 4,
  entrada: "google",
  pasos: [],
  bases: { es: "Bases", en: "Rules" },
  anotadas: 0,
  contrato: null,
  promo: null,
  comprobante: null,
});

/** Lo que contesta la sala: el texto firmado de la campaña y su firma. */
const envuelto = (campana: unknown = cuerpo()): { texto: string; firma: string } => ({
  texto: JSON.stringify(campana),
  firma: "f",
});

function respuesta(status: number, json: () => Promise<unknown>): Response {
  return { status, ok: status >= 200 && status < 300, json } as Response;
}

function relojFalso(): {
  reloj: RelojDeCarga;
  programar: ReturnType<typeof vi.fn>;
  limpiar: ReturnType<typeof vi.fn>;
  disparar: () => void;
} {
  let pendiente: (() => void) | undefined;
  const programar = vi.fn((handler: () => void, _timeout: number) => {
    pendiente = handler;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  });
  const limpiar = vi.fn((_id: ReturnType<typeof setTimeout>) => {
    pendiente = undefined;
  });
  return {
    reloj: { setTimeout: programar, clearTimeout: limpiar },
    programar,
    limpiar,
    disparar: () => pendiente?.(),
  };
}

function pedir(fetchServicio: typeof fetch, evento = "abc") {
  const reloj = relojFalso();
  const resultado = cargarCampana(fetchServicio, "https://servicio", "ABCDEFGH", evento, reloj.reloj);
  return { ...reloj, resultado };
}

describe("cargarCampana", () => {
  it("carga y valida una campaña válida", async () => {
    const pedido = pedir(async () => respuesta(200, async () => envuelto()));
    await expect(pedido.resultado).resolves.toMatchObject({ ok: true });
  });

  it("programa el tope en exactamente 8000 ms y lo limpia al terminar", async () => {
    const pedido = pedir(async () => respuesta(200, async () => envuelto()));
    expect(pedido.programar).toHaveBeenCalledWith(expect.any(Function), 8000);
    await pedido.resultado;
    expect(pedido.limpiar).toHaveBeenCalledTimes(1);
  });

  it("pide la respuesta sin reutilizar una copia guardada", async () => {
    let opciones: RequestInit | undefined;
    const fetchServicio: typeof fetch = async (_url, recibidas) => {
      opciones = recibidas;
      return respuesta(200, async () => envuelto());
    };
    const pedido = pedir(fetchServicio);
    await pedido.resultado;
    expect(opciones?.cache).toBe("no-store");
  });

  it("traduce un 404 a no-esta", async () => {
    const pedido = pedir(async () => respuesta(404, async () => ({})));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "no-esta" });
  });

  it("traduce un error del servicio a sin-red", async () => {
    const pedido = pedir(async () => respuesta(500, async () => ({})));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "sin-red" });
  });

  it("traduce una configuración inválida a mal", async () => {
    const pedido = pedir(async () => respuesta(200, async () => envuelto({ v: 2 })));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "mal" });
  });

  it("rechaza una campaña válida de otro evento", async () => {
    const pedido = pedir(async () => respuesta(200, async () => envuelto({ ...cuerpo(), evento: "otro" })));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "mal" });
  });

  it("traduce un cuerpo que no es JSON a mal", async () => {
    const pedido = pedir(async () => respuesta(200, async () => {
      throw new SyntaxError("JSON inválido");
    }));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "mal" });
  });

  it("pide la campaña a la ruta de la sala", async () => {
    let direccion = "";
    const fetchServicio: typeof fetch = async (url) => {
      direccion = String(url);
      return respuesta(200, async () => envuelto());
    };
    await pedir(fetchServicio).resultado;
    expect(direccion).toBe("https://servicio/v1/sala/ABCDEFGH/campana");
  });

  it("un texto firmado que no es JSON da mal", async () => {
    const pedido = pedir(async () => respuesta(200, async () => ({ texto: "no es json", firma: "f" })));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "mal" });
  });

  it("un cuerpo sin texto da mal", async () => {
    const pedido = pedir(async () => respuesta(200, async () => ({ firma: "f" })));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "mal" });
  });

  it("un texto que no es una campaña da mal aunque sea JSON", async () => {
    const pedido = pedir(async () => respuesta(200, async () => ({ texto: "[1,2]", firma: "f" })));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "mal" });
  });

  it("traduce un TypeError durante la lectura del cuerpo a sin-red", async () => {
    const pedido = pedir(async () => respuesta(200, async () => {
      throw new TypeError("conexión cortada");
    }));
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "sin-red" });
  });

  it("traduce un AbortError durante la lectura del cuerpo a sin-red", async () => {
    const fetchServicio: typeof fetch = async (_url, opciones) => respuesta(200, () => new Promise((_resolve, reject) => {
      opciones?.signal?.addEventListener("abort", () => {
        reject(new DOMException("tiempo vencido", "AbortError"));
      }, { once: true });
    }));
    const pedido = pedir(fetchServicio);
    await Promise.resolve();
    await Promise.resolve();
    pedido.disparar();
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "sin-red" });
  });

  it("corta una espera que supera el límite sin usar el reloj real", async () => {
    const fetchLento: typeof fetch = async (_url, opciones) => new Promise<Response>((_resolve, reject) => {
      opciones?.signal?.addEventListener("abort", () => {
        reject(new DOMException("tiempo vencido", "AbortError"));
      }, { once: true });
    });
    const pedido = pedir(fetchLento);
    pedido.disparar();
    await expect(pedido.resultado).resolves.toEqual({ ok: false, estado: "sin-red" });
  });
});

/**
 * El reloj de siempre, el que usa la página del celular. En un navegador, setTimeout y clearTimeout tiran Illegal invocation
 * si se llaman como método de otro objeto. Node no lo exige, así que acá se los reemplaza por unos que sí lo hacen.
 */
describe("cargarCampana con el reloj del navegador", () => {
  const comoEnUnNavegador = <A extends unknown[], R>(nativa: (...a: A) => R) =>
    function (this: unknown, ...a: A): R {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return nativa(...a);
    };

  it("sin pasarle un reloj, carga la campaña en vez de romperse al programar el tope", async () => {
    const programar = globalThis.setTimeout;
    const limpiar = globalThis.clearTimeout;
    vi.stubGlobal("setTimeout", comoEnUnNavegador(programar));
    vi.stubGlobal("clearTimeout", comoEnUnNavegador(limpiar));
    try {
      const resultado = cargarCampana(async () => respuesta(200, async () => envuelto()), "https://servicio", "ABCDEFGH", "abc");
      await expect(resultado).resolves.toMatchObject({ ok: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("el reloj de siempre no depende de quién lo llama", () => {
    const { setTimeout: programar, clearTimeout: limpiar } = RELOJ_DEL_NAVEGADOR;
    const otro = { programar, limpiar };
    const id = otro.programar(() => undefined, 60_000);
    expect(() => otro.limpiar(id)).not.toThrow();
  });
});
