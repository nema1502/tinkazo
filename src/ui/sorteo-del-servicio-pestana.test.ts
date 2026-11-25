// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RespuestaDelSorteo } from "../stellar/sorteo-servidor-api";
import { type Fuentes, reiniciarElServicio, sortearPorElServicio } from "./sorteo-del-servicio";

/**
 * Una pestaña en segundo plano estira los temporizadores. Los topes del sorteo por el servicio se miden por reloj de pared:
 * al volver la pestaña se revisa la hora y lo que ya pasó de su tope se abandona en el acto, sin esperar al temporizador.
 */

const GANADORES = { winners: [4, 11, 3], randomness: "00ff" };
const FIRMA = new Uint8Array(96).fill(5);

beforeEach(() => reiniciarElServicio());

function fuentes(o: Partial<Fuentes>): Fuentes {
  return {
    clave: (id) => `pestana|${id}`,
    rechazoSinGrabar: async () => null,
    pedir: async () => ({ accion: "incierto" }),
    consultar: async () => ({ status: "NOT_FOUND", cierre: 0 }),
    leer: async () => null,
    valorDe: async () => null,
    alFallar: () => undefined,
    fijar: () => () => undefined,
    olvidarElEstado: () => undefined,
    horaDeLaRed: () => 0,
    ...o,
  };
}

describe("una pestaña que estuvo en segundo plano", () => {
  it("un pedido colgado, el reloj que salta 60 segundos y la pestaña que vuelve: se abandona en el acto, se aborta y se sigue por la duda", async () => {
    let t = 1_000_000;
    let senal: AbortSignal | undefined;
    const f = fuentes({
      pedir: (_id, _firma, s) => {
        senal = s;
        return new Promise<RespuestaDelSorteo>(() => undefined);
      },
      leer: async () => GANADORES,
    });
    const fin = sortearPorElServicio({ raffleId: 7n, firma96: FIRMA, ahora: () => t, dormir: async (ms) => void (t += ms) }, f);
    await vi.waitFor(() => expect(senal).toBeDefined());
    expect(senal?.aborted).toBe(false);
    t += 60_000;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await fin).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(senal?.aborted).toBe(true);
  });

  it("una lectura colgada se abandona igual: la duda sigue y termina sin confirmar", async () => {
    let t = 1_000_000;
    const f = fuentes({ leer: () => new Promise(() => undefined) });
    const fin = sortearPorElServicio({ raffleId: 7n, firma96: FIRMA, ahora: () => t, dormir: async (ms) => void (t += ms) }, f);
    // Las lecturas cuelgan: cada vez que la pestaña vuelve con el reloj adelantado, se abandona la que estaba esperando.
    const volver = setInterval(() => {
      t += 6_000;
      document.dispatchEvent(new Event("visibilitychange"));
    }, 5);
    const r = await fin;
    clearInterval(volver);
    expect(r.estado).toBe("error");
  });

  it("si dormir adelanta el reloj cinco veces lo pedido, termina dentro de los mismos topes con menos pedidos", async () => {
    let t = 1_000_000;
    const inicio = t;
    const pedir = vi.fn(async (): Promise<RespuestaDelSorteo> => ({ accion: "espera" }));
    const f = fuentes({ pedir: pedir as unknown as Fuentes["pedir"] });
    const fin = await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA, ahora: () => t, dormir: async (ms) => void (t += ms * 5) }, f);
    expect(fin).toEqual({ estado: "camino-de-hoy" });
    // Con el reloj normal serían cuatro pedidos (a los 0, 2, 6 y 10 segundos).
    expect(pedir.mock.calls.length).toBeLessThan(4);
    expect(t - inicio).toBeLessThanOrEqual(30_000);
  });
});
