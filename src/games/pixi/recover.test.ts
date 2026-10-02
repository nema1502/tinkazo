import { describe, expect, it, vi } from "vitest";
import { RECOVER_WINDOW_MS, watchRecovery } from "./recover";

type Fn = (e?: unknown) => void;

function fakeTarget() {
  const map = new Map<string, Set<Fn>>();
  return {
    addEventListener: (t: string, f: Fn) => void (map.get(t) ?? map.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: Fn) => void map.get(t)?.delete(f),
    fire: (t: string, e: unknown = {}) => [...(map.get(t) ?? [])].forEach((f) => f(e)),
    count: () => [...map.values()].reduce((n, s) => n + s.size, 0),
  };
}

function setup(opts: { onReturn?: () => void; onRestore?: () => void } = {}) {
  const canvas = fakeTarget();
  const doc = Object.assign(fakeTarget(), { visibilityState: "visible" as string });
  let t = 1000;
  const onReturn = vi.fn(opts.onReturn);
  const onRestore = vi.fn(opts.onRestore);
  const dispose = watchRecovery(canvas, doc, { onReturn, onRestore }, () => t);
  const lose = () => canvas.fire("webglcontextlost", { preventDefault: () => {} });
  return { canvas, doc, onReturn, onRestore, dispose, lose, advance: (ms: number) => void (t += ms) };
}

describe("watchRecovery", () => {
  it("prevents default on context loss and calls nothing", () => {
    const { canvas, onReturn, onRestore } = setup();
    const preventDefault = vi.fn();
    canvas.fire("webglcontextlost", { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onReturn).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("healthy visible return calls onReturn once, hidden calls nothing", () => {
    const { doc, onReturn, onRestore } = setup();
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(onReturn).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    expect(onReturn).toHaveBeenCalledOnce();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("while the context is lost, visible does nothing and restore triggers onRestore once", () => {
    const { canvas, doc, onReturn, onRestore, lose } = setup();
    lose();
    doc.fire("visibilitychange");
    expect(onReturn).not.toHaveBeenCalled();
    canvas.fire("webglcontextrestored");
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onReturn).not.toHaveBeenCalled();
  });

  it("after a restore, visible returns call onReturn again", () => {
    const { canvas, doc, onReturn, lose } = setup();
    lose();
    canvas.fire("webglcontextrestored");
    doc.fire("visibilitychange");
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("restore is never debounced, even right after a visibility call, and runs while hidden", () => {
    const { canvas, doc, onRestore, onReturn } = setup();
    doc.fire("visibilitychange");
    canvas.fire("webglcontextrestored");
    canvas.fire("webglcontextrestored");
    expect(onReturn).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledTimes(2);
    doc.visibilityState = "hidden";
    canvas.fire("webglcontextrestored");
    expect(onRestore).toHaveBeenCalledTimes(3);
  });

  it("debounces visibility only, with the boundary exactly at the window", () => {
    const { doc, onReturn, advance } = setup();
    doc.fire("visibilitychange");
    advance(RECOVER_WINDOW_MS - 1);
    doc.fire("visibilitychange");
    expect(onReturn).toHaveBeenCalledOnce();
    advance(1);
    doc.fire("visibilitychange");
    expect(onReturn).toHaveBeenCalledTimes(2);
  });

  it("a throwing callback does not stop later signals", () => {
    const boom = () => {
      throw new Error("boom");
    };
    const { canvas, doc, onReturn, onRestore, advance } = setup({ onReturn: boom, onRestore: boom });
    expect(() => canvas.fire("webglcontextrestored")).not.toThrow();
    expect(() => doc.fire("visibilitychange")).not.toThrow();
    advance(RECOVER_WINDOW_MS);
    doc.fire("visibilitychange");
    canvas.fire("webglcontextrestored");
    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(onReturn).toHaveBeenCalledTimes(2);
  });

  it("dispose removes every listener and is idempotent", () => {
    const { canvas, doc, onReturn, onRestore, dispose } = setup();
    dispose();
    expect(canvas.count() + doc.count()).toBe(0);
    canvas.fire("webglcontextrestored");
    doc.fire("visibilitychange");
    expect(onReturn).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });
});
