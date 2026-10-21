import { describe, expect, it } from "vitest";
import { listaCaidos } from "./pinata-labels";

const tamanos = [
  { w: 1280, h: 720, phone: false },
  { w: 1264, h: 625, phone: false },
  { w: 1920, h: 1080, phone: false },
  { w: 1024, h: 768, phone: false },
  { w: 390, h: 844, phone: true },
  { w: 320, h: 568, phone: true },
  { w: 844, h: 390, phone: false },
];

describe("listaCaidos: la lista de los que cayeron entra en la pantalla", () => {
  for (const { w, h, phone } of tamanos) {
    it(`entra en ${w}x${h}${phone ? " (celular)" : ""} y deja lugar para cuarenta nombres en escritorio`, () => {
      const k = Math.min(w / 420, h / 900);
      const top = 82, bottom = 106;
      const floor = h - bottom - 58 * k;
      const g = listaCaidos({ w, k, top, floor, phone });
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.w).toBeLessThanOrEqual(w);
      expect(g.y).toBeGreaterThanOrEqual(top);
      expect(g.y + g.h).toBeLessThanOrEqual(floor);
      expect(g.cap).toBe(g.cols * g.rows);
      expect(g.cap).toBeGreaterThanOrEqual(phone ? 3 : 8);
    });
  }

  it("en escritorio, la lista llega a unos treinta nombres a la vez en 720 de alto y a más de treinta en 1080", () => {
    const en720 = listaCaidos({ w: 1280, k: 1, top: 82, floor: 720 - 106 - 58, phone: false });
    const en1080 = listaCaidos({ w: 1920, k: 1080 / 720, top: 82, floor: 1080 - 106 - 58 * (1080 / 720), phone: false });
    expect(en720.cap).toBeGreaterThanOrEqual(30);
    expect(en1080.cap).toBeGreaterThanOrEqual(34);
  });

  it("las filas no se pisan: cada una ocupa su alto y sus columnas no se solapan", () => {
    const g = listaCaidos({ w: 1280, k: 1, top: 82, floor: 600, phone: false });
    expect(g.rowH).toBeGreaterThan(0);
    expect(g.colW * g.cols).toBeLessThanOrEqual(g.w + 1e-9);
    expect(g.y + g.rows * g.rowH).toBeLessThanOrEqual(600);
  });
});
