import { describe, expect, it } from "vitest";
import { bordeSeCome, comprobacionesDePantalla, hayHallazgo } from "./pantalla-comprobaciones.mjs";

const INK = 0x1c1410, YELLOW = 0xf2b82a, CREAM = 0xfdf3dc, WHITE = 0xffffff;
const texto = (o) => ({ s: "María Quispe", px: 24, fill: INK, trazoColor: INK, trazoPx: 3, ...o });

describe("el borde no se come la letra", () => {
  it("la ficha de antes, tinta con borde de tinta de 3 px a 24 px de letra, falla", () => {
    expect(bordeSeCome(texto())).toEqual({ s: "María Quispe", px: 24, borde: 3, pct: 13 });
  });

  it("la de ahora, tinta con trazo amarillo de 1 px, pasa", () => {
    expect(bordeSeCome(texto({ trazoColor: YELLOW, trazoPx: 1 }))).toBeNull();
  });

  it("un nombre crema con borde de tinta es el contorno normal y pasa, por grueso que sea", () => {
    expect(bordeSeCome(texto({ fill: CREAM, trazoPx: 4 }))).toBeNull();
  });

  it("un borde claro grueso sobre letra clara falla", () => {
    expect(bordeSeCome(texto({ fill: CREAM, trazoColor: WHITE, trazoPx: 4 }))?.pct).toBe(17);
  });

  it("un borde fino del mismo tono pasa: el límite es el 8 % del tamaño", () => {
    expect(bordeSeCome(texto({ trazoPx: 1.9 }))).toBeNull();
    expect(bordeSeCome(texto({ trazoPx: 2.1 }))).not.toBeNull();
  });

  it("colores parecidos aunque no sean oscuros ni claros también se funden", () => {
    expect(bordeSeCome(texto({ fill: 0x3366cc, trazoColor: 0x3a6cc4, trazoPx: 4 }))).not.toBeNull();
  });

  it("sin borde o sin colores conocidos no hay nada que medir", () => {
    expect(bordeSeCome(texto({ trazoPx: 0 }))).toBeNull();
    expect(bordeSeCome(texto({ trazoColor: null }))).toBeNull();
    expect(bordeSeCome(texto({ fill: null }))).toBeNull();
    expect(bordeSeCome(null)).toBeNull();
  });
});

describe("las comprobaciones de pantalla cuentan el borde", () => {
  const base = { juego: "race", res: "1280x720", ok: true, destellos: { peorPorSegundo: 0 }, contraste: { sinContorno: [] } };

  it("sin bordes que se coman la letra pasa, y hayHallazgo no ve nada", () => {
    const c = comprobacionesDePantalla({ ...base, bordes: [] }).find((x) => x.name.endsWith("el borde no se come la letra"));
    expect(c.ok).toBe(true);
    expect(hayHallazgo({ ...base, bordes: [] })).toBe(false);
  });

  it("con uno falla, dice el texto, el tamaño, el borde y el porcentaje, y hayHallazgo lo cuenta", () => {
    const r = { ...base, bordes: [bordeSeCome(texto())] };
    const c = comprobacionesDePantalla(r).find((x) => x.name.endsWith("el borde no se come la letra"));
    expect(c.ok).toBe(false);
    expect(c.detail).toBe("«María Quispe» de 24 px con borde de 3 px (13 %)");
    expect(hayHallazgo(r)).toBe(true);
  });
});
