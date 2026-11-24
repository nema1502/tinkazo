import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seguirVivo, SONDEO_PARTICIPANTE_MS } from "./participante";

/**
 * El sondeo de la sala desde el celular: mientras falta la ronda consulta cada 3 s, pero deja de
 * consultar cuando la ronda compartida ya llegó (el resultado de cada celular sale de la lista que
 * ya tiene) y se suelta mientras la pestaña está en segundo plano, para no gastar el cupo diario
 * del servicio con nadie mirando. Al volver la pestaña a la vista, el sondeo sigue solo. Y si lo que
 * falla es la red (cualquier cosa salvo un 404/410 de la sala), el sondeo no muere: reintenta con espera
 * creciente y avisa que reconecta, en vez de dejar al celular en «La sala se cerró».
 */

const respuesta = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const SALA = "AbCd1234";
const SERVICIO = "http://sala.test";
const RONDA = { r: 5, randomness: "a".repeat(64), listHash: "b".repeat(64), k: 1 };

/** Un documento de mentira (en Node no hay): el mismo par visible/oculto que la pestaña de verdad. */
function documentoDeMentira() {
  const escucha = new EventTarget();
  const documento = {
    hidden: false,
    addEventListener: (t: string, f: EventListener) => void escucha.addEventListener(t, f),
    removeEventListener: (t: string, f: EventListener) => void escucha.removeEventListener(t, f),
    dispatchEvent: (e: Event) => escucha.dispatchEvent(e),
  };
  const cambiar = (oculta: boolean): void => {
    documento.hidden = oculta;
    documento.dispatchEvent(new Event("visibilitychange"));
  };
  return { documento, cambiar };
}

describe("el sondeo del participante", () => {
  let documento: ReturnType<typeof documentoDeMentira>;

  beforeEach(() => {
    vi.useFakeTimers();
    documento = documentoDeMentira();
    vi.stubGlobal("document", documento.documento);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mientras no hay ronda el sondeo sigue cada 3 s", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] }));
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn() }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS);
    expect(f).toHaveBeenCalledTimes(3);
    s.parar();
  });

  it("la ronda compartida avisa una sola vez y después el celular deja de consultar", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 2, estado: "cerrada", ronda: RONDA, ns: [1, 2], nombres: [] }));
    const alRonda = vi.fn();
    const alVencida = vi.fn();
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn(), alRonda, alVencida }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(alRonda).toHaveBeenCalledTimes(1);
    expect(alRonda).toHaveBeenCalledWith(RONDA);
    const hastaAca = f.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS * 5);
    expect(f.mock.calls.length).toBe(hastaAca);
    expect(alVencida).not.toHaveBeenCalled();
    s.parar();
  });

  it("con la pestaña oculta no consulta, y al volver a la vista el sondeo sigue", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] }));
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn() }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(1);

    documento.cambiar(true);
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS * 3);
    expect(f).toHaveBeenCalledTimes(1);

    // Un celular que consulta cuando ya se esconde no agenda de más: al leer la respuesta, no hay un segundo pedido.
    documento.cambiar(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS);
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
    s.parar();
  });

  it("al parar no queda la escucha de la pestaña pegada al documento", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] }));
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn() }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    s.parar();
    documento.cambiar(false);
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS * 3);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("una falla de red nunca da la sala por vencida: reintenta con espera creciente y avisa que reconecta", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const alVencida = vi.fn();
    const alReconectando = vi.fn();
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn(), alVencida, alReconectando }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(alReconectando).toHaveBeenLastCalledWith(1);
    // 3 s, el doble en cada falla: 3, 6, 12, 24, 48 y después el tope de 60 s, pedido tras pedido.
    for (const [espera, pedidos] of [[3_000, 2], [6_000, 3], [12_000, 4], [24_000, 5], [48_000, 6], [60_000, 7], [60_000, 8]] as const) {
      await vi.advanceTimersByTimeAsync(espera);
      expect(f, `pedido ${pedidos} tras esperar ${espera}`).toHaveBeenCalledTimes(pedidos);
      expect(alVencida).not.toHaveBeenCalled();
    }
    expect(alReconectando).toHaveBeenLastCalledWith(8);
    s.parar();
  });

  it("una respuesta buena limpia el aviso de reconexión y el próximo sondeo vuelve a los 3 s", async () => {
    let pedido = 0;
    const f = vi.fn().mockImplementation(async () => {
      pedido++;
      if (pedido <= 2) throw new TypeError("Failed to fetch");
      return respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] });
    });
    const alReconectando = vi.fn();
    const alReconecto = vi.fn();
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn(), alReconectando, alReconecto }, { fetch: f });
    await vi.advanceTimersByTimeAsync(3_000 + 10);
    expect(f, "el primer reintento sale a los 3 s").toHaveBeenCalledTimes(2);
    expect(alReconectando.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    // El segundo reintento sale a los 6 s, y con él vuelve la señal: el aviso se limpia una sola vez.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f).toHaveBeenCalledTimes(3);
    expect(alReconecto).toHaveBeenCalledTimes(1);
    // Si la espera no volviera a cero, este pedido saldría a los 12 s, no a los 3.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f).toHaveBeenCalledTimes(4);
    expect(alReconecto).toHaveBeenCalledTimes(1);
    s.parar();
  });

  it("si la pestaña se esconde y vuelve con un pedido en camino, queda una sola cadena de sondeo", async () => {
    let llamadas = 0;
    let contestarElPrimero: (r: Response) => void = () => {};
    const vacia = (): Response => respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] });
    const f = vi.fn().mockImplementation(() => {
      llamadas++;
      // El primer pedido queda colgado, como en una red lenta.
      if (llamadas === 1) return new Promise<Response>((res) => (contestarElPrimero = res));
      return Promise.resolve(vacia());
    });
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn() }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(1);

    // Se esconde y vuelve a verse con ese pedido todavía en camino: sale uno nuevo.
    documento.cambiar(true);
    documento.cambiar(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(2);

    // El primero contesta tarde: su respuesta se descarta y no agenda nada.
    contestarElPrimero(vacia());
    await vi.advanceTimersByTimeAsync(10);
    const hastaAca = f.mock.calls.length;

    // Una sola cadena: un pedido cada 3 s. Con dos cadenas serían ocho.
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS * 4);
    expect(f.mock.calls.length - hastaAca).toBe(4);
    s.parar();
  });

  it("al volver la señal no espera lo que quede del reintento: pide enseguida, con un poco de azar", async () => {
    let sinSenal = true;
    const f = vi.fn().mockImplementation(async () => {
      if (sinSenal) throw new TypeError("Failed to fetch");
      return respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] });
    });
    const red = new EventTarget();
    const alReconecto = vi.fn();
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn(), alReconecto }, { fetch: f, red, azar: () => 0.5 });
    await vi.advanceTimersByTimeAsync(10);
    // Seis fallas seguidas: el próximo reintento quedaría a un minuto.
    for (const espera of [3_000, 6_000, 12_000, 24_000, 48_000]) await vi.advanceTimersByTimeAsync(espera);
    expect(f).toHaveBeenCalledTimes(6);

    sinSenal = false;
    red.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(499);
    expect(f, "con el azar en 0,5 el pedido sale a los 500 ms, no antes").toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(2);
    expect(f).toHaveBeenCalledTimes(7);
    expect(alReconecto).toHaveBeenCalledTimes(1);

    // Lo que había agendado para dentro de un minuto ya no está: el próximo pedido sale a los 3 s.
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS);
    expect(f).toHaveBeenCalledTimes(8);
    s.parar();
  });

  it("con la pestaña oculta, volver la señal no pide nada", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] }));
    const red = new EventTarget();
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn() }, { fetch: f, red, azar: () => 0 });
    await vi.advanceTimersByTimeAsync(10);
    documento.cambiar(true);
    red.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(SONDEO_PARTICIPANTE_MS * 3);
    expect(f).toHaveBeenCalledTimes(1);
    s.parar();
  });

  it("al parar no queda la escucha de la señal pegada", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] }));
    const red = new EventTarget();
    const s = seguirVivo(SALA, "c".repeat(22), SERVICIO, { alNombre: vi.fn() }, { fetch: f, red, azar: () => 0 });
    await vi.advanceTimersByTimeAsync(10);
    s.parar();
    red.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
