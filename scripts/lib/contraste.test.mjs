import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LAVADO, UMBRALES, contrasteDeRegion, decodificarPng, lavar, luminancia, razon } from "./contraste.mjs";

/** Un PNG de prueba: `pixeles(x, y)` da [r, g, b, a]; cada fila usa un filtro distinto (0 a 4) para ejercitar el lector. */
function png(ancho, alto, pixeles, canales = 4) {
  const fila = ancho * canales;
  const filas = [];
  let previa = new Uint8Array(fila);
  for (let y = 0; y < alto; y++) {
    const actual = new Uint8Array(fila);
    for (let x = 0; x < ancho; x++) {
      const p = pixeles(x, y);
      for (let c = 0; c < canales; c++) actual[x * canales + c] = p[c];
    }
    const filtro = y % 5;
    const sal = Buffer.alloc(fila + 1);
    sal[0] = filtro;
    for (let x = 0; x < fila; x++) {
      const a = x >= canales ? actual[x - canales] : 0, b = previa[x], c = x >= canales ? previa[x - canales] : 0;
      let pred = 0;
      if (filtro === 1) pred = a;
      else if (filtro === 2) pred = b;
      else if (filtro === 3) pred = (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      sal[x + 1] = (actual[x] - pred) & 255;
    }
    filas.push(sal);
    previa = actual;
  }
  const trozo = (nombre, datos) => {
    const t = Buffer.alloc(12 + datos.length);
    t.writeUInt32BE(datos.length, 0);
    t.write(nombre, 4, "latin1");
    datos.copy(t, 8);
    return t;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = canales === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", deflateSync(Buffer.concat(filas))), trozo("IEND", Buffer.alloc(0))]);
}

describe("decodificarPng", () => {
  it("devuelve los mismos píxeles con cualquiera de los cinco filtros, en RGBA y en RGB", () => {
    const f = (x, y) => [(x * 37 + y * 11) & 255, (x * 5 + y * 91) & 255, (x * y + 3) & 255, 255];
    for (const canales of [4, 3]) {
      const img = decodificarPng(png(13, 10, f, canales));
      expect(img.ancho).toBe(13);
      expect(img.alto).toBe(10);
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 13; x++) {
          const o = (y * 13 + x) * 4;
          expect([...img.datos.slice(o, o + 4)]).toEqual(f(x, y));
        }
      }
    }
  });

  it("rechaza lo que no es un PNG", () => {
    expect(() => decodificarPng(Buffer.from("hola, esto no es una imagen, ni de cerca, ni de lejos"))).toThrow();
  });
});

describe("contraste", () => {
  it("coincide con los números medidos de docs/marca.md: tinta sobre amarillo, 11,19 a 1", () => {
    const tinta = luminancia(0x19, 0x19, 0x19), amarillo = luminancia(0xff, 0xc6, 0x29);
    expect(razon(tinta, amarillo)).toBeCloseTo(11.19, 1);
  });

  it("el lavado sube el negro a un 20 % de gris (por el brillo, un poco más) y baja el blanco", () => {
    expect(LAVADO).toEqual({ contraste: 0.6, brillo: 1.1 });
    expect(lavar([0, 0, 0])).toEqual([56, 56, 56]);
    expect(lavar([255, 255, 255])).toEqual([224, 224, 224]);
    // El gris del medio queda donde estaba, aclarado por el brillo.
    expect(lavar([128, 128, 128])[0]).toBeCloseTo(141, -1);
  });

  it("los umbrales: el cartel pide 7 sin lavado y 4,5 lavado; el resto, 4,5 siempre", () => {
    expect(UMBRALES.cartel).toEqual({ sin: 7, con: 4.5 });
    expect(UMBRALES.fichas).toEqual({ sin: 4.5, con: 4.5 });
    expect(UMBRALES.bandera).toEqual({ sin: 4.5, con: 4.5 });
  });
});

describe("contrasteDeRegion", () => {
  const TINTA = [0x19, 0x19, 0x19, 255], AMARILLO = [0xff, 0xc6, 0x29, 255];
  /** Una «letra» de tinta (un rectángulo en el medio) sobre amarillo. */
  const cartel = (x, y) => (x >= 20 && x < 60 && y >= 10 && y < 30 ? TINTA : AMARILLO);

  it("saca los dos tonos de una letra sobre su fondo y mide el contraste real", () => {
    const img = decodificarPng(png(80, 40, cartel));
    const r = contrasteDeRegion(img, { x: 0, y: 0, w: 80, h: 40 });
    expect(r.dosTonos).toBe(true);
    expect(r.razon).toBeCloseTo(11.19, 1);
  });

  it("lavado, el mismo cartel da lo que dice el filtro (4,9 a 1 con la tinta de la marca)", () => {
    const img = decodificarPng(png(80, 40, (x, y) => [...lavar(cartel(x, y).slice(0, 3)), 255]));
    const r = contrasteDeRegion(img, { x: 0, y: 0, w: 80, h: 40 });
    expect(r.razon).toBeGreaterThan(4.5);
    expect(r.razon).toBeLessThan(5.3);
    expect(r.razon).toBeLessThan(UMBRALES.cartel.sin);
  });

  it("una región lisa no tiene dos tonos: razón 1", () => {
    const img = decodificarPng(png(40, 40, () => AMARILLO));
    expect(contrasteDeRegion(img, { x: 0, y: 0, w: 40, h: 40 })).toMatchObject({ razon: 1, dosTonos: false });
  });

  it("un punto suelto de otro color (menos del 6 %) no cuenta como un segundo tono", () => {
    const img = decodificarPng(png(40, 40, (x, y) => (x === 3 && y === 3 ? TINTA : AMARILLO)));
    expect(contrasteDeRegion(img, { x: 0, y: 0, w: 40, h: 40 }).dosTonos).toBe(false);
  });

  it("una bandera a cuadros de tinta y blanco da 17,6 a 1, y lavada, 6,8 a 1", () => {
    const cuadros = (lav) => (x, y) => {
      const c = ((x >> 3) + (y >> 3)) % 2 ? [0xff, 0xff, 0xff] : [0x19, 0x19, 0x19];
      return [...(lav ? lavar(c) : c), 255];
    };
    const sin = contrasteDeRegion(decodificarPng(png(32, 32, cuadros(false))), { x: 0, y: 0, w: 32, h: 32 });
    const con = contrasteDeRegion(decodificarPng(png(32, 32, cuadros(true))), { x: 0, y: 0, w: 32, h: 32 });
    expect(sin.razon).toBeCloseTo(17.6, 0);
    expect(con.razon).toBeGreaterThan(6.5);
    expect(con.razon).toBeLessThan(7.2);
  });
});
