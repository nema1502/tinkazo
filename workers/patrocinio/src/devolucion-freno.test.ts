/**
 * `/cupo` es abierto y la cuenta es un dato público: cada pedido de una cuenta con un sello en el aire le preguntaba a la
 * red por ese sello, sin freno. Ahora el mismo sello no se pregunta de nuevo antes de `ASENTAR_CADA_MS`, los pedidos a la
 * vez de una cuenta comparten una sola consulta y, pasado el tope de espera, la consulta se corta.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { escena } from "./devolucion-prueba";
import { ErrorDeRed, RpcRed } from "./red";
import { ASENTAR_CADA_MS, TOPE_ASENTAR_MS } from "./servicio";

afterEach(() => {
  vi.useRealTimers();
});

describe("/cupo no le pregunta a la red sin freno", () => {
  it("dos /cupo seguidos de la misma cuenta preguntan una sola vez por el mismo sello; pasado el freno, otra vez", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    await m.cupoDe(org.publicKey());
    await m.cupoDe(org.publicKey());
    expect(s.e.red.preguntas).toEqual([a.hash]);
    s.e.ahora += ASENTAR_CADA_MS;
    await m.cupoDe(org.publicKey());
    expect(s.e.red.preguntas).toEqual([a.hash, a.hash]);
  });

  it("muchos /cupo a la vez de la misma cuenta comparten una sola consulta", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    s.entroTarde(a);
    let soltar: () => void = () => {};
    s.e.red.frenar = new Promise<void>((r) => (soltar = r));
    const todos = Promise.all(Array.from({ length: 10 }, () => m.cupoDe(org.publicKey())));
    await new Promise((r) => setTimeout(r, 5));
    soltar();
    const respuestas = await todos;
    expect(s.e.red.preguntas).toEqual([a.hash]);
    // Todos contestan con el sorteo ya devuelto.
    for (const r of respuestas) expect((r.cuerpo as { oficial: { sorteos: { quedan: number } } }).oficial.sorteos.quedan).toBe(1);
  });

  it("el sello nuevo que llega sin sorteos pregunta igual, aunque /cupo acabe de preguntar: es el reintento de la persona", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    // /cupo pregunta y la red todavía no lo tiene.
    await m.cupoDe(org.publicKey());
    // Un segundo después ya lo tiene: el sello nuevo lo averigua, vuelve el sorteo y pasa.
    s.entroTarde(a);
    s.e.ahora += 1_000;
    const b = s.sello(org, { ronda: 33_939_013 });
    expect(await m.procesar(b.xdr)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(s.e.red.preguntas).toEqual([a.hash, a.hash]);
  });

  it("pasado el tope de espera, la consulta en curso se corta", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    await m.procesar(s.sello(org).xdr);
    s.e.red.frenar = new Promise<void>(() => {});
    vi.useFakeTimers();
    const p = m.cupoDe(org.publicKey());
    await vi.advanceTimersByTimeAsync(TOPE_ASENTAR_MS + 10);
    expect((await p).estado).toBe(200);
    expect(s.e.red.senales).toHaveLength(1);
    expect(s.e.red.senales[0]?.aborted).toBe(true);
  });
});

describe("RpcRed corta la consulta cuando se lo piden", () => {
  it("con la señal cortada no sigue con el RPC siguiente y avisa con un error de red", async () => {
    const urls: string[] = [];
    const pedir = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      return new Promise<Response>((_, mal) => {
        init?.signal?.addEventListener("abort", () => mal(new DOMException("cortado", "AbortError")));
      });
    }) as unknown as typeof fetch;
    const red = new RpcRed(["https://uno.ejemplo", "https://dos.ejemplo"], pedir);
    const corte = new AbortController();
    const p = red.consultar("a".repeat(64), corte.signal);
    await new Promise((r) => setTimeout(r, 5));
    corte.abort();
    await expect(p).rejects.toBeInstanceOf(ErrorDeRed);
    expect(urls).toEqual(["https://uno.ejemplo"]);
  });

  it("sin señal, como siempre: un RPC que se corta pasa al siguiente", async () => {
    const urls: string[] = [];
    const pedir = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      if (urls.length === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "NOT_FOUND" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const red = new RpcRed(["https://uno.ejemplo", "https://dos.ejemplo"], pedir);
    expect(await red.consultar("a".repeat(64))).toEqual({ status: "NOT_FOUND" });
    expect(urls).toEqual(["https://uno.ejemplo", "https://dos.ejemplo"]);
  });
});
