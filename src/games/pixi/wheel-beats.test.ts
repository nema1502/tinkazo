import { describe, expect, it } from "vitest";
import { FALSA, T_CROWN, T_HOLD, T_LOCK, beatFor, cameraBeats } from "./wheel-beats";

describe.each([false, true])("cameraBeats (falsa=%s)", (falsa) => {
  const beats = cameraBeats(falsa);
  const shakes = beats.filter((b) => b.kind === "shake");

  it("has exactly one shake", () => {
    expect(shakes).toHaveLength(1);
  });

  it("shakes only once the real winner is locked, never at the false stop", () => {
    const s = shakes[0]!;
    expect(s.at).toBeGreaterThanOrEqual(T_LOCK);
    expect(s.strength).toBeGreaterThan(0);
    for (const b of beats) if (b.at < T_LOCK) expect(b.kind).not.toBe("shake");
    // no shake while the decoy is still showing
    expect(s.at).toBeGreaterThan(T_HOLD + FALSA);
  });

  it("is time-ordered, finite and has no shake pair closer than 1 s", () => {
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i]!;
      expect(Number.isFinite(b.at)).toBe(true);
      expect(Number.isFinite(b.strength)).toBe(true);
      if (i > 0) expect(b.at).toBeGreaterThanOrEqual(beats[i - 1]!.at);
    }
    for (let i = 1; i < shakes.length; i++) expect(shakes[i]!.at - shakes[i - 1]!.at).toBeGreaterThanOrEqual(1);
  });

  it("crown carries the shake", () => {
    expect(shakes[0]!.at).toBe(T_CROWN);
    expect(beatFor(falsa, "crown")?.kind).toBe("shake");
  });
});

describe("tease beat", () => {
  it("exists only in the falsa arc, is not a shake, and sits at the false stop", () => {
    const tease = cameraBeats(true).filter((b) => b.reason === "tease");
    expect(tease).toHaveLength(1);
    expect(tease[0]!.kind).not.toBe("shake");
    expect(tease[0]!.at).toBe(T_HOLD + FALSA);
    expect(cameraBeats(false).some((b) => b.reason === "tease")).toBe(false);
  });

  it("lock beat is not a shake in either arc", () => {
    for (const f of [false, true]) expect(beatFor(f, "lock")?.kind).not.toBe("shake");
  });
});
