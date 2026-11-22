import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escucharSala, type Sala } from "./cliente";

/**
 * Cuando otra compu toma la campaña con la misma cuenta, la sala deja de aceptar el token de esta pantalla: cierra el socket
 * con 4001 (o con 4401 si el token no valía al presentarse) o contesta 403 al sondeo. Quien escucha lo sabe por una respuesta
 * concreta y no deja de escuchar por una caída cualquiera. Sin respuesta nunca es una toma.
 */

const sala: Sala = { id: "AbCd1234", token: "t".repeat(22), clave: "c".repeat(22), vence: 0, servicio: "http://sala.test" };
const respuesta = (cuerpo: unknown, status = 200): Response => new Response(JSON.stringify(cuerpo), { status });

class SocketFalso {
  static ultimo: SocketFalso | null = null;
  static creados = 0;
  oyentes: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public url: string) {
    SocketFalso.ultimo = this;
    SocketFalso.creados++;
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.oyentes[t] ??= []).push(f);
  }
  send(): void {}
  close(): void {}
  emitir(t: string, e: unknown = {}): void {
    for (const f of this.oyentes[t] ?? []) f(e);
  }
}
const socket = (u: string): WebSocket => new SocketFalso(u) as unknown as WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  SocketFalso.ultimo = null;
  SocketFalso.creados = 0;
});
afterEach(() => vi.useRealTimers());

describe("el socket cerrado por la sala", () => {
  it.each([4001, 4401])("con el cierre %i avisa que la tomaron y no vuelve a intentar", async (codigo) => {
    const alTomada = vi.fn();
    escucharSala(sala, { alNombre: vi.fn(), alTomada }, { fetch: vi.fn().mockResolvedValue(respuesta([])), socket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("close", { code: codigo });
    expect(alTomada).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(SocketFalso.creados).toBe(1);
  });

  it("el cierre 4000 (otra pantalla de la misma sala) sigue en sondeo y no es una toma", async () => {
    const alTomada = vi.fn();
    const alEstado = vi.fn();
    escucharSala(sala, { alNombre: vi.fn(), alTomada, alEstado }, { fetch: vi.fn().mockResolvedValue(respuesta([])), socket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("close", { code: 4000 });
    await vi.advanceTimersByTimeAsync(10);
    expect(alTomada).not.toHaveBeenCalled();
    expect(alEstado).toHaveBeenLastCalledWith("sondeo");
  });

  it("una caída común (1006) sigue como siempre: sondeo y reintento", async () => {
    const alTomada = vi.fn();
    escucharSala(sala, { alNombre: vi.fn(), alTomada }, { fetch: vi.fn().mockResolvedValue(respuesta([])), socket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("close", { code: 1006 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(alTomada).not.toHaveBeenCalled();
    expect(SocketFalso.creados).toBeGreaterThan(1);
  });

  it("sin quien escuche la toma, el cierre 4401 sigue siendo una caída como antes", async () => {
    escucharSala(sala, { alNombre: vi.fn() }, { fetch: vi.fn().mockResolvedValue(respuesta([])), socket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("close", { code: 4401 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(SocketFalso.creados).toBeGreaterThan(1);
  });
});

describe("el sondeo que la sala contesta con 403", () => {
  it("un 403 con el motivo token en los nombres avisa que la tomaron", async () => {
    const alTomada = vi.fn();
    const f = vi.fn().mockResolvedValue(respuesta({ error: "token" }, 403));
    escucharSala(sala, { alNombre: vi.fn(), alTomada }, { fetch: f, socket });
    await vi.advanceTimersByTimeAsync(10);
    expect(alTomada).toHaveBeenCalledTimes(1);
  });

  it("un 403 con el motivo token en los equipos avisa que la tomaron", async () => {
    const alTomada = vi.fn();
    const f = vi.fn(async (url: string) => (url.includes("/equipos") ? respuesta({ error: "token" }, 403) : respuesta([])));
    escucharSala(sala, { alNombre: vi.fn(), alEquipo: vi.fn(), alTomada }, { fetch: f as unknown as typeof fetch, socket });
    await vi.advanceTimersByTimeAsync(10);
    expect(alTomada).toHaveBeenCalledTimes(1);
  });

  it("otro 403 (de origen) o un 500 no son una toma", async () => {
    const alTomada = vi.fn();
    const f = vi.fn().mockResolvedValueOnce(respuesta({ error: "origen" }, 403)).mockResolvedValue(respuesta({}, 500));
    escucharSala(sala, { alNombre: vi.fn(), alTomada }, { fetch: f, socket });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(alTomada).not.toHaveBeenCalled();
  });

  it("un 403 sin cuerpo de la sala (una página del borde o un proxy) no es una toma", async () => {
    const alTomada = vi.fn();
    const html = new Response("<html><body>Acceso denegado</body></html>", { status: 403, headers: { "Content-Type": "text/html" } });
    const f = vi
      .fn()
      .mockResolvedValueOnce(html)
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValue(respuesta({}, 500));
    escucharSala(sala, { alNombre: vi.fn(), alEquipo: vi.fn(), alTomada }, { fetch: f, socket });
    // Con el socket caído la pantalla sondea cada pocos segundos: pasa por la página del borde, por el 403 vacío y por el 500.
    (SocketFalso.ultimo as SocketFalso).emitir("close", { code: 1006 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.mock.calls.length).toBeGreaterThan(2);
    expect(alTomada).not.toHaveBeenCalled();
  });

  it("sin respuesta (sin red) tampoco es una toma", async () => {
    const alTomada = vi.fn();
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    escucharSala(sala, { alNombre: vi.fn(), alTomada }, { fetch: f, socket });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(alTomada).not.toHaveBeenCalled();
  });

  it("sin quien escuche la toma, un 403 se calla como antes", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ error: "token" }, 403));
    escucharSala(sala, { alNombre: vi.fn() }, { fetch: f, socket });
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalled();
  });
});
