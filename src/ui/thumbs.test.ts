import { describe, expect, it } from "vitest";
import { paintThumb } from "./thumbs";

type Call = [string, ...number[]];

/** Fake 2D context that records calls and models a resettable transform. */
function fakeCtx() {
  const calls: Call[] = [];
  let transform: number[] = [1, 0, 0, 1, 0, 0];
  const ctx = {
    setTransform: (...a: number[]) => {
      transform = a;
      calls.push(["setTransform", ...a]);
    },
    clearRect: (...a: number[]) => {
      calls.push(["clearRect", ...a]);
    },
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    reset: () => {
      transform = [1, 0, 0, 1, 0, 0];
    },
    transform: () => transform,
  };
}

describe("paintThumb", () => {
  const col = (k: number): string => `c${k}`;

  it("sets the dpr transform, then clears logical W x H, then paints", () => {
    const f = fakeCtx();
    const seen: unknown[][] = [];
    const paint = (...a: unknown[]): void => {
      f.calls.push(["paint"]);
      seen.push(a);
    };
    paintThumb(f.ctx, paint as never, 1.5, col, 2, 116, 66);
    expect(f.calls).toEqual([
      ["setTransform", 2, 0, 0, 2, 0, 0],
      ["clearRect", 0, 0, 116, 66],
      ["paint"],
    ]);
    expect(seen[0]).toEqual([f.ctx, 1.5, col]);
  });

  it("restores the transform on every frame, even after a context reset", () => {
    const f = fakeCtx();
    const active: number[][] = [];
    const paint = (): void => {
      active.push(f.transform());
    };
    paintThumb(f.ctx, paint, 0, col, 2, 116, 66);
    f.reset(); // browser dropped the context state (discard / restore)
    paintThumb(f.ctx, paint, 1, col, 2, 116, 66);
    expect(active).toEqual([
      [2, 0, 0, 2, 0, 0],
      [2, 0, 0, 2, 0, 0],
    ]);
    expect(f.calls.filter((c) => c[0] === "setTransform")).toHaveLength(2);
  });
});
