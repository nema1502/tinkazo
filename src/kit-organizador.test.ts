import { readFileSync } from "node:fs";
import jsQR from "jsqr";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./pagina", () => ({}));
afterEach(() => vi.unstubAllGlobals());

const html = readFileSync(new URL("../sorteo-para-meetup.html", import.meta.url), "utf8");
// These checks read the shipped public HTML, not a second rendering of the guide.
describe("organizer kit public navigation and paper contract", () => {
  it("uses the clicked print action, resets after printing, and never changes the selected language", async () => {
    class PrintButton extends EventTarget {
      constructor(readonly dataset: { kitPrint: string }) { super(); }
    }
    const buttons = [new PrintButton({ kitPrint: "guide" }), new PrintButton({ kitPrint: "cards" })];
    const root = { dataset: {} as Record<string, string>, lang: "en" };
    const win = new EventTarget() as EventTarget & { print: ReturnType<typeof vi.fn> };
    win.print = vi.fn();
    vi.stubGlobal("document", { documentElement: root, querySelectorAll: () => buttons });
    vi.stubGlobal("window", win);
    await import("./kit-organizador");
    for (const [i, mode] of ["guide", "cards"].entries()) {
      buttons[i]!.dispatchEvent(new Event("click"));
      expect(root.dataset.kitPrint).toBe(mode);
      expect(root.lang).toBe("en");
      expect(win.print).toHaveBeenCalledTimes(i + 1);
      win.dispatchEvent(new Event("afterprint"));
      expect(root.dataset.kitPrint).toBeUndefined();
    }
  });

  it("declares A4, selected-language printing, intact tables/templates and physical card dimensions", () => {
    const css = readFileSync(new URL("./kit-organizador.css", import.meta.url), "utf8");
    expect(css).toContain("size: A4 portrait; margin: 10mm");
    expect(css).toContain('html:lang(en) .kit-language[lang="en"]');
    expect(css).toContain(".kit-template, .kit-table, .kit-table tr { break-inside: avoid;");
    expect(css).toContain("grid-template-rows: repeat(2, 135mm)");
    expect(css).toContain("width: 35mm; height: 35mm");
    expect(css).toContain("font-size: 16pt");
    expect(css).not.toMatch(/overflow:\s*hidden/);
  });
  it("independently decodes the shipped SVG and verifies four white modules on all four sides", () => {
    const svg = readFileSync(new URL("../public/kit-organizador/comprobacion.svg", import.meta.url), "utf8");
    expect(svg).toContain('viewBox="0 0 180 180"');
    expect(svg).toContain('fill="white"');
    expect(svg).toContain('fill="black"');
    const squares = [...svg.matchAll(/M(\d+),(\d+)l4,0 0,4 -4,0 0,-4z/g)];
    expect(squares.length).toBe(svg.match(/M\d+,\d+/g)?.length);
    const pixels = new Uint8ClampedArray(180 * 180 * 4).fill(255);
    for (const square of squares) {
      const x = Number(square[1]), y = Number(square[2]);
      expect(x).toBeGreaterThanOrEqual(16);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(x + 4).toBeLessThanOrEqual(164);
      expect(y + 4).toBeLessThanOrEqual(164);
      for (let row = y; row < y + 4; row++) for (let col = x; col < x + 4; col++) {
        const offset = (row * 180 + col) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    expect(jsQR(pixels, 180, 180)?.data).toBe("https://tinkazo.app/sorteo-para-meetup.html#comprobacion");
  });

  it("links the fixed public QR directly to the preserved explanation", () => {
    expect(html).toMatch(/<section\b[^>]*id="comprobacion"/);
    expect(html).toContain('href="https://tinkazo.app/sorteo-para-meetup.html#comprobacion"');
    expect(html).toContain('src="/kit-organizador/comprobacion.svg"');
  });
  it("offers both print actions and two complete bilingual cards without JavaScript duplication", () => {
    expect(html).toContain('data-kit-print="guide"');
    expect(html).toContain('data-kit-print="cards"');
    expect(html.match(/class="kit-card"/g)).toHaveLength(2);
    expect(html.match(/Este sorteo se puede comprobar/g)).toHaveLength(2);
    expect(html.match(/This draw can be checked/g)).toHaveLength(2);
  });
  it("keeps all five source sections in both languages and accessible navigation", () => {
    for (const lang of ["es", "en"]) {
      for (let step = 1; step <= 5; step++) {
        expect(html).toContain(`id="kit-${lang}-${step}"`);
        expect(html).toContain(`href="#kit-${lang}-${step}"`);
      }
    }
    expect(html).toContain('data-i-aria="kitNav"');
    expect(html).toContain('data-i-aria="kitQrAlt"');
  });
  it("keeps the existing SEO heading, names and explanation text", () => {
    expect(html).toContain('data-i="meetH1">Sorteo para tu meetup, en pantalla grande');
    expect(html).toContain('data-i="meetNamesB">Los nombres no se publican: quedan en tu equipo');
    expect(html).toContain('data-i="meetT1B">Cuando sellás, el número que decide todavía no nace.');
  });
});
