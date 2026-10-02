import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * wheel.ts cannot be imported under Node (it pulls Pixi), so the camera rule is
 * pinned on its source: the shake is reserved for the single moment the real
 * winner is confirmed, and every camera effect goes through the schedule.
 */
const src = readFileSync(new URL("./wheel.ts", import.meta.url), "utf8");

describe("wheel camera guard", () => {
  it("has exactly one cam.shake call site, inside the beat helper", () => {
    const shakes = src.match(/\.shake\(/g) ?? [];
    expect(shakes).toHaveLength(1);
  });

  it("fires the crown beat from the crown, the only place the shake is reached", () => {
    expect(src).toContain('camBeat("crown")');
  });

  it("does not shake from the false stop or the lock directly", () => {
    // Those moments only go through camBeat, which never shakes for them.
    expect(src).not.toMatch(/cam\.shake\(\s*10/);
    expect(src).not.toMatch(/cam\.shake\(\s*9/);
    expect(src).not.toMatch(/cam\.shake\(\s*2\s*\*/);
  });
});
