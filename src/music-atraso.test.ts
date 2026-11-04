// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { tag } from "./music";

/** Un nodo de mentira con la hora del contexto que se le diga. */
function nodo(ahora: number) {
  const start = vi.fn();
  const stop = vi.fn();
  const n = { context: { currentTime: ahora }, start, stop } as unknown as AudioScheduledSourceNode;
  return { n, start, stop };
}

describe("las notas de la música que ya quedaron atrasadas", () => {
  it("una nota a tiempo arranca y se para como siempre", () => {
    const { n, start, stop } = nodo(10);
    const t = tag(n);
    t.start(10.02);
    t.stop(10.4);
    expect(start).toHaveBeenCalledWith(10.02);
    expect(stop).toHaveBeenCalledWith(10.4);
  });

  it("un tirón corto del hilo no la calla: hasta 150 ms atrasada todavía suena", () => {
    const { n, start } = nodo(10.14);
    tag(n).start(10);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("más de 150 ms atrasada no suena, y pararla después no lanza", () => {
    const { n, start, stop } = nodo(12);
    const t = tag(n);
    t.start(10.5);
    t.stop(10.9);
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("start(0) es ahora, no una hora vieja: la cama de archivo sigue arrancando", () => {
    const { n, start } = nodo(300);
    (tag(n) as unknown as AudioBufferSourceNode).start(0, 4.5);
    expect(start).toHaveBeenCalledWith(0, 4.5);
  });

  it("sigue marcando el nodo como música", () => {
    const { n } = nodo(1);
    expect((tag(n) as unknown as { __musica?: boolean }).__musica).toBe(true);
  });
});
