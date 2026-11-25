import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RespuestaDelSorteo } from "../stellar/sorteo-servidor-api";
import { DISYUNTOR_MS, type Fuentes, type FinDelServicio, fuentesDeVerdad, loTomaElServicio, reiniciarElServicio, sortearPorElServicio } from "./sorteo-del-servicio";

/**
 * Cuándo toma el servicio un sorteo en esta pestaña, con la red principal, una cuenta de Google y la bandera prendida
 * simuladas: la marca de un sorteo que ya quedó por el camino de siempre, y el disyuntor que deja de lado al servicio
 * diez minutos después de una falla suya.
 */

const h = vi.hoisted(() => ({ pedir: vi.fn(), red: "mainnet", propia: false, ensayo: false, bandera: true, url: "https://pm.example" as string | null }));
vi.mock("./anchor", () => ({ readDraw: async () => null, SIN_GRABAR: "ensayo-sin-grabar" }));
vi.mock("../stellar/alta-config", async (orig) => ({ ...(await orig<typeof import("../stellar/alta-config")>()), sorteoPorServidor: () => h.bandera }));
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" ? h.red : Reflect.get(t, k)) }) };
});
vi.mock("../ensayo-modo", async (orig) => ({ ...(await orig<typeof import("../ensayo-modo")>()), sinGrabar: () => h.ensayo }));
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => ({ submitsItself: !h.propia }) }));
vi.mock("../stellar/patrocinio-config", async (orig) => ({ ...(await orig<typeof import("../stellar/patrocinio-config")>()), configDelPortero: () => ({ url: h.url, porDefecto: false }) }));
vi.mock("../stellar/sorteo-servidor-api", async (orig) => ({ ...(await orig<typeof import("../stellar/sorteo-servidor-api")>()), pedirElSorteo: (...a: unknown[]) => h.pedir(...a) }));

const FIRMA = new Uint8Array(96).fill(5);

beforeEach(() => {
  reiniciarElServicio();
  Object.assign(h, { red: "mainnet", propia: false, ensayo: false, bandera: true, url: "https://pm.example" });
  h.pedir.mockReset();
});

describe("loTomaElServicio", () => {
  it("con la bandera, la red principal, una cuenta de Google y el servicio a la vista, sí", () => {
    expect(loTomaElServicio(7n, false)).toBe(true);
  });
  it("la demo, la red de prueba, una billetera propia, la bandera apagada, sin servicio o pagando con la propia cuenta, no", () => {
    h.ensayo = true;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.ensayo = false;
    h.red = "testnet";
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.red = "mainnet";
    h.propia = true;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.propia = false;
    h.bandera = false;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.bandera = true;
    h.url = null;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.url = "http://no-es-https.example";
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.url = "https://pm.example";
    expect(loTomaElServicio(7n, true)).toBe(false);
    expect(loTomaElServicio(7n, false)).toBe(true);
  });
});

describe("lo que se recuerda después de una respuesta del servicio", () => {
  it("un no que es de este sorteo (no es del servicio) lo marca: ese sorteo va directo al camino de siempre, y los demás no", async () => {
    h.pedir.mockResolvedValue({ accion: "hoy", marca: true, disyuntor: false, olvidar: false });
    expect(await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA })).toEqual({ estado: "camino-de-hoy" });
    expect(h.pedir).toHaveBeenCalledTimes(1);
    expect(loTomaElServicio(7n, false)).toBe(false);
    expect(loTomaElServicio(8n, false)).toBe(true);
  });

  it("una falla del servicio apaga el servicio diez minutos en la pestaña, para todos los sorteos, y pasado ese tiempo vuelve a pedir", async () => {
    h.pedir.mockResolvedValue({ accion: "hoy", marca: false, disyuntor: true, olvidar: true });
    const salida = Date.now();
    expect(await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA })).toEqual({ estado: "camino-de-hoy" });
    expect(loTomaElServicio(8n, false)).toBe(false);
    expect(loTomaElServicio(7n, false)).toBe(false);
    expect(loTomaElServicio(8n, false, () => salida + DISYUNTOR_MS - 1000)).toBe(false);
    expect(loTomaElServicio(8n, false, () => salida + DISYUNTOR_MS + 1000)).toBe(true);
  });

  it("después de la duda que termina en el camino de siempre, el sorteo queda marcado y el servicio apagado un rato", async () => {
    h.pedir.mockResolvedValue({ accion: "incierto" });
    vi.useFakeTimers();
    try {
      const fin = sortearPorElServicio({ raffleId: 7n, firma96: FIRMA });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await fin).toEqual({ estado: "camino-de-hoy" });
      expect(h.pedir).toHaveBeenCalledTimes(1);
      expect(loTomaElServicio(7n, false)).toBe(false);
      expect(loTomaElServicio(8n, false)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un sorteo que ya se hizo para la demo no llama al servicio", async () => {
    h.ensayo = true;
    const r = await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA });
    expect(r.estado).toBe("error");
    expect((r as { error: Error }).error.message).toBe("ensayo-sin-grabar");
    expect(h.pedir).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------- cada salida al camino de siempre, y lo que no sale */

const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const GANADORES = { winners: [4, 11, 3], randomness: "00ff" };
const mandado = (hash: string, pendiente = true): RespuestaDelSorteo => ({ accion: "mandado", hash, pendiente });
const enSegundos = (): number => Date.now() / 1000;
const entro = async () => ({ status: "SUCCESS", cierre: enSegundos(), valor: "x" });

/** Las fuentes de verdad con la red y el servicio de mentira. El reloj de la red es el simulado. */
function fuentes(o: Partial<Fuentes>): Fuentes {
  return {
    ...fuentesDeVerdad(),
    rechazoSinGrabar: async () => null,
    pedir: async () => mandado(H1),
    consultar: async () => ({ status: "NOT_FOUND", cierre: enSegundos() }),
    leer: async () => null,
    valorDe: async () => GANADORES,
    alFallar: () => undefined,
    fijar: () => () => undefined,
    olvidarElEstado: () => undefined,
    horaDeLaRed: enSegundos,
    ...o,
  };
}

/** Corre con el reloj simulado hasta que termina. */
async function correr(f: Fuentes, id = 7n): Promise<FinDelServicio> {
  vi.useFakeTimers();
  try {
    let fin: FinDelServicio | undefined;
    void sortearPorElServicio({ raffleId: id, firma96: FIRMA }, f).then((r) => (fin = r));
    for (let ms = 0; ms < 900_000 && !fin; ms += 250) await vi.advanceTimersByTimeAsync(250);
    if (!fin) throw new Error("la prueba no terminó");
    return fin;
  } finally {
    vi.useRealTimers();
  }
}

const sinConfirmarCon = (r: FinDelServicio): { message: string; txHash?: string } => {
  expect(r.estado).toBe("error");
  return (r as { error: { message: string; txHash?: string } }).error;
};
const caido = (): Promise<never> => Promise.reject(new Error("rpc caído"));

describe("cada salida al camino de siempre deja marcado el sorteo, y solo ese", () => {
  const marcado = (): void => {
    expect(loTomaElServicio(7n, false)).toBe(false);
    // Es del sorteo y no del servicio: otro sorteo sigue yendo por el servicio.
    expect(loTomaElServicio(8n, false)).toBe(true);
  };

  it("el envío del servicio falló en la red y el contrato no tiene el sorteo", async () => {
    const r = await correr(fuentes({ consultar: async () => ({ status: "FAILED", cierre: enSegundos() }) }));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    marcado();
  });

  it("el envío del servicio venció sin entrar y el contrato no tiene el sorteo", async () => {
    const r = await correr(fuentes({ consultar: async () => ({ status: "NOT_FOUND", cierre: enSegundos() + 100_000 }) }));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    marcado();
  });

  it("un repetido que la red, contestando, no conoce", async () => {
    const r = await correr(fuentes({ pedir: async () => mandado(H1, false) }));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    marcado();
  });

  it("un sello gemelo que se repite", async () => {
    let pedidos = 0;
    const r = await correr(fuentes({ pedir: async () => (pedidos++ === 0 ? mandado(H1, false) : mandado(H2)), consultar: entro }));
    expect(pedidos).toBe(2);
    expect(r).toEqual({ estado: "camino-de-hoy" });
    marcado();
  });

  it("el servicio dice que ya está y la red no lo ve", async () => {
    const r = await correr(fuentes({ pedir: async () => ({ accion: "ya" }) }));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    marcado();
  });

  it("el servicio no puede en 20 segundos: se marca el sorteo y se deja de lado al servicio un rato", async () => {
    const r = await correr(fuentes({ pedir: async () => ({ accion: "espera" }) }));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    expect(loTomaElServicio(7n, false)).toBe(false);
    expect(loTomaElServicio(8n, false)).toBe(false);
    // El reloj simulado corrió unos segundos de más: se mira bien pasado el rato.
    expect(loTomaElServicio(8n, false, () => Date.now() + DISYUNTOR_MS + 60_000)).toBe(true);
  });
});

describe("con la red sin poder leerse no se manda nada más por el camino de siempre", () => {
  const sinMarca = (): void => {
    expect(loTomaElServicio(7n, false)).toBe(true);
  };

  it("el envío falló y el contrato no se deja leer: sin confirmar, con el enlace y sin marca", async () => {
    const pedir = vi.fn(async () => mandado(H1));
    const r = await correr(fuentes({ pedir, consultar: async () => ({ status: "FAILED", cierre: enSegundos() }), leer: caido }));
    expect(sinConfirmarCon(r)).toMatchObject({ message: "sin-confirmar", txHash: H1 });
    expect(pedir).toHaveBeenCalledTimes(1);
    sinMarca();
  });

  it("el envío venció y el contrato no se deja leer: lo mismo", async () => {
    const r = await correr(fuentes({ consultar: async () => ({ status: "NOT_FOUND", cierre: enSegundos() + 100_000 }), leer: caido }));
    expect(sinConfirmarCon(r)).toMatchObject({ message: "sin-confirmar", txHash: H1 });
    sinMarca();
  });

  it("un repetido que la red no conoce y el contrato no se deja leer: sin confirmar", async () => {
    const r = await correr(fuentes({ pedir: async () => mandado(H1, false), leer: caido }));
    expect(sinConfirmarCon(r)).toMatchObject({ message: "sin-confirmar" });
    sinMarca();
  });

  it("un repetido con la red muda: sin confirmar y sin el camino de siempre", async () => {
    const r = await correr(fuentes({ pedir: async () => mandado(H1, false), consultar: caido }));
    expect(sinConfirmarCon(r)).toMatchObject({ message: "sin-confirmar", txHash: H1 });
    sinMarca();
  });
});

describe("la última vuelta corta después de una red muda", () => {
  /** La red calla hasta que se la vuelve a llamar para la última vuelta: ahí `alFallar` ya avisó. */
  function redQueVuelve(trasLaVuelta: Fuentes["consultar"]): Pick<Fuentes, "consultar" | "alFallar"> {
    let avisado = false;
    return {
      alFallar: () => void (avisado = true),
      consultar: (hash) => (avisado ? trasLaVuelta(hash) : caido()),
    };
  }

  it("entró: el resultado sale del contrato y el enlace va", async () => {
    const r = await correr(fuentes({ ...redQueVuelve(entro), leer: async () => GANADORES }));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
  });

  it("falló y el contrato no tiene el sorteo: camino de siempre", async () => {
    const r = await correr(fuentes({ ...redQueVuelve(async () => ({ status: "FAILED", cierre: enSegundos() })) }));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    expect(loTomaElServicio(7n, false)).toBe(false);
  });

  it("la red sigue muda pero el contrato ya tiene el sorteo: se da por hecho, sin enlace", async () => {
    const r = await correr(fuentes({ consultar: caido, leer: async () => GANADORES }));
    expect(r).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });

  it("la red sigue muda y el contrato no se deja leer: sin confirmar, sin marca", async () => {
    const r = await correr(fuentes({ consultar: caido, leer: caido }));
    expect(sinConfirmarCon(r)).toMatchObject({ message: "sin-confirmar", txHash: H1 });
    expect(loTomaElServicio(7n, false)).toBe(true);
  });
});
