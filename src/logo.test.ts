import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGO_MAX_BYTES,
  aBase64,
  deBase64,
  elegirPlaca,
  encajarLogo,
  huellaLogo,
  medidasDeCabecera,
  recortarMargenes,
  validarLogo,
  type Logo,
} from "./logo";
import { LOGO_DE_PRUEBA, alCambiarLogo, guardarLogo, logoActual, logoParaSellar, logoPorHuella, quitarLogo } from "./logo-guardado";

/* ------------------------------------------------- imágenes armadas a mano (solo la cabecera) */

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** Un PNG con la cabecera de verdad y un relleno detrás. */
function png(w: number, h: number, relleno = 40): Logo {
  const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 2, 0, 0, 0, 0, 0, 0, 0, ...new Array(relleno).fill(7)]);
  return { t: "image/png", b: aBase64(b) };
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** Un WebP de cada clase: `VP8 ` (con pérdida), `VP8L` (sin pérdida) o `VP8X` (extendido). */
function webp(clase: "VP8 " | "VP8L" | "VP8X", w: number, h: number, relleno = 40): Logo {
  let cuerpo: number[];
  if (clase === "VP8 ") cuerpo = [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >>> 8) & 0x3f, h & 255, (h >>> 8) & 0x3f];
  else if (clase === "VP8L") {
    const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
    cuerpo = [0x2f, ...le32(bits >>> 0)];
  } else cuerpo = [0, 0, 0, 0, (w - 1) & 255, ((w - 1) >>> 8) & 255, ((w - 1) >>> 16) & 255, (h - 1) & 255, ((h - 1) >>> 8) & 255, ((h - 1) >>> 16) & 255];
  const dentro = [...cuerpo, ...new Array(relleno).fill(9)];
  const total = [...ascii("WEBP"), ...ascii(clase), ...le32(dentro.length), ...dentro];
  return { t: "image/webp", b: aBase64(new Uint8Array([...ascii("RIFF"), ...le32(total.length), ...total])) };
}

describe("validarLogo: lo que llega de un enlace no es de fiar", () => {
  it("acepta un PNG y un WebP de cada clase, con sus medidas", () => {
    expect(validarLogo(png(256, 128))).toMatchObject({ w: 256, h: 128 });
    expect(validarLogo(png(130, 256))).toMatchObject({ w: 130, h: 256 });
    expect(validarLogo(webp("VP8 ", 200, 100))).toMatchObject({ w: 200, h: 100 });
    expect(validarLogo(webp("VP8L", 256, 256))).toMatchObject({ w: 256, h: 256 });
    expect(validarLogo(webp("VP8X", 40, 77))).toMatchObject({ w: 40, h: 77 });
  });

  it("acepta el logo de prueba y devuelve solo t y b", () => {
    const r = validarLogo({ ...LOGO_DE_PRUEBA, extra: "<script>", onerror: "x" });
    expect(r?.logo).toEqual(LOGO_DE_PRUEBA);
    expect(Object.keys(r?.logo ?? {}).sort()).toEqual(["b", "t"]);
    expect(r).toMatchObject({ w: 128, h: 64 });
  });

  it("rechaza lo que no es un objeto, y los tipos que no son webp ni png", () => {
    for (const x of [null, undefined, 3, "x", [], true]) expect(validarLogo(x)).toBeNull();
    expect(validarLogo({ t: "image/svg+xml", b: png(10, 10).b })).toBeNull();
    expect(validarLogo({ t: "image/jpeg", b: png(10, 10).b })).toBeNull();
    expect(validarLogo({ t: "image/gif", b: png(10, 10).b })).toBeNull();
    expect(validarLogo({ t: "text/html", b: aBase64(new TextEncoder().encode("<svg onload=alert(1)>")) })).toBeNull();
    expect(validarLogo({ b: png(10, 10).b })).toBeNull();
  });

  it("rechaza una base64 inválida o que no es texto", () => {
    expect(validarLogo({ t: "image/png", b: "no es base64!!" })).toBeNull();
    expect(validarLogo({ t: "image/png", b: png(10, 10).b + "=" })).toBeNull();
    expect(validarLogo({ t: "image/png", b: "" })).toBeNull();
    expect(validarLogo({ t: "image/png", b: 42 })).toBeNull();
    expect(validarLogo({ t: "image/png", b: { toString: () => "x" } })).toBeNull();
  });

  it("rechaza lo que pesa más de 48 KB, justo en el borde", () => {
    // La cabecera de un PNG de 33 bytes más el relleno: 48 KB justos entran, un byte más no.
    const justo = png(10, 10, LOGO_MAX_BYTES - 33);
    expect(deBase64(justo.b)?.length).toBe(LOGO_MAX_BYTES);
    expect(validarLogo(justo)).not.toBeNull();
    const pasado = png(10, 10, LOGO_MAX_BYTES - 33 + 1);
    expect(validarLogo(pasado)).toBeNull();
    // Y mucho más, sin siquiera decodificarlo.
    expect(validarLogo({ t: "image/png", b: "A".repeat(10_000_000) })).toBeNull();
  });

  it("rechaza si los primeros bytes no coinciden con el tipo", () => {
    expect(validarLogo({ t: "image/png", b: webp("VP8 ", 10, 10).b })).toBeNull();
    expect(validarLogo({ t: "image/webp", b: png(10, 10).b })).toBeNull();
    const roto = png(10, 10);
    const bytes = deBase64(roto.b) as Uint8Array;
    bytes[1] = 0x51;
    expect(validarLogo({ t: "image/png", b: aBase64(bytes) })).toBeNull();
  });

  it("rechaza lo que mide más de 256 píxeles, cero o no se puede leer (la bomba de descompresión)", () => {
    expect(validarLogo(png(257, 100))).toBeNull();
    expect(validarLogo(png(100, 257))).toBeNull();
    expect(validarLogo(png(65535, 65535))).toBeNull();
    // Una tira de 256 x 1, o más apaisada que 2:1, es un logo armado a mano: la placa va de 1:1 a 2:1.
    expect(validarLogo(png(256, 1))).toBeNull();
    expect(validarLogo(png(256, 100))).toBeNull();
    expect(validarLogo(png(1, 256))).toBeNull();
    expect(validarLogo(webp("VP8L", 256, 64))).toBeNull();
    expect(validarLogo(png(256, 128))).not.toBeNull();
    expect(validarLogo(png(0, 10))).toBeNull();
    expect(validarLogo(webp("VP8L", 257, 10))).toBeNull();
    expect(validarLogo(webp("VP8X", 16384, 16384))).toBeNull();
    expect(validarLogo(webp("VP8 ", 300, 10))).toBeNull();
    // Cabecera cortada o de un trozo que no conocemos.
    expect(validarLogo({ t: "image/png", b: aBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) })).toBeNull();
    const raro = deBase64(webp("VP8X", 10, 10).b) as Uint8Array;
    raro.set(ascii("ZZZZ"), 12);
    expect(validarLogo({ t: "image/webp", b: aBase64(raro) })).toBeNull();
    const sinFirma = deBase64(webp("VP8L", 10, 10).b) as Uint8Array;
    sinFirma[20] = 0;
    expect(validarLogo({ t: "image/webp", b: aBase64(sinFirma) })).toBeNull();
  });

  it("las medidas salen de la cabecera", () => {
    expect(medidasDeCabecera(deBase64(png(17, 23).b) as Uint8Array, "image/png")).toEqual({ w: 17, h: 23 });
    expect(medidasDeCabecera(deBase64(webp("VP8L", 17, 23).b) as Uint8Array, "image/webp")).toEqual({ w: 17, h: 23 });
  });
});

describe("huella del logo", () => {
  it("es de 22 letras, estable, y cambia con un solo byte", () => {
    const a = huellaLogo(LOGO_DE_PRUEBA);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(huellaLogo({ ...LOGO_DE_PRUEBA })).toBe(a);
    const bytes = deBase64(LOGO_DE_PRUEBA.b) as Uint8Array;
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 1;
    expect(huellaLogo({ t: "image/png", b: aBase64(bytes) })).not.toBe(a);
  });
});

/* ------------------------------------------------- lo que se hace con los píxeles */

/** Un cuadro de píxeles con una función que dice de qué color es cada uno. */
function cuadro(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return d;
}

describe("recortarMargenes", () => {
  it("saca el vacío transparente de alrededor, con un poco de aire", () => {
    const d = cuadro(100, 100, (x, y) => (x >= 40 && x < 60 && y >= 30 && y < 70 ? [200, 0, 0, 255] : [0, 0, 0, 0]));
    const c = recortarMargenes(d, 100, 100);
    expect(c.x).toBeLessThanOrEqual(40);
    expect(c.x).toBeGreaterThanOrEqual(36);
    expect(c.y).toBeLessThanOrEqual(30);
    expect(c.x + c.w).toBeGreaterThanOrEqual(60);
    expect(c.y + c.h).toBeGreaterThanOrEqual(70);
    expect(c.w).toBeLessThan(30);
    expect(c.h).toBeLessThan(55);
  });

  it("en una imagen opaca, saca el fondo liso de las esquinas", () => {
    const d = cuadro(100, 100, (x, y) => (x >= 20 && x < 80 && y >= 40 && y < 60 ? [10, 20, 30, 255] : [250, 250, 250, 255]));
    const c = recortarMargenes(d, 100, 100);
    expect(c.w).toBeLessThan(70);
    expect(c.h).toBeLessThan(30);
  });

  it("una imagen toda vacía, o lisa, se queda entera", () => {
    expect(recortarMargenes(cuadro(10, 10, () => [0, 0, 0, 0]), 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(recortarMargenes(cuadro(10, 10, () => [255, 255, 255, 255]), 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(recortarMargenes(new Uint8ClampedArray(0), 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("elegirPlaca", () => {
  it("un logo negro con fondo transparente va sobre la placa clara", () => {
    const d = cuadro(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(elegirPlaca(d, 20, 20)).toBe("clara");
  });

  it("un logo blanco con fondo transparente va sobre la oscura: no desaparece", () => {
    const d = cuadro(20, 20, (x) => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(elegirPlaca(d, 20, 20)).toBe("oscura");
  });

  it("el corte está en 0,8 de luminancia media", () => {
    const con = (g: number): "clara" | "oscura" => elegirPlaca(cuadro(20, 20, (x) => (x < 10 ? [g, g, g, 255] : [0, 0, 0, 0])), 20, 20);
    expect(con(190)).toBe("clara");
    expect(con(215)).toBe("oscura");
  });

  it("un JPG opaco de borde claro va sobre la clara, y de borde oscuro sobre la oscura", () => {
    expect(elegirPlaca(cuadro(20, 20, () => [250, 250, 250, 255]), 20, 20)).toBe("clara");
    expect(elegirPlaca(cuadro(20, 20, () => [10, 10, 30, 255]), 20, 20)).toBe("oscura");
  });

  it("una imagen sin un solo píxel opaco va sobre la clara", () => {
    expect(elegirPlaca(cuadro(8, 8, () => [255, 255, 255, 0]), 8, 8)).toBe("clara");
  });
});

describe("encajarLogo", () => {
  it("un logo cuadrado ocupa la placa de 256 x 256", () => {
    const g = encajarLogo(500, 500);
    expect([g.ancho, g.alto]).toEqual([256, 256]);
    expect(g.dw).toBe(g.dh);
    expect(g.dx).toBe(g.dy);
  });

  it("uno apaisado a 2:1 usa la placa de 256 x 128", () => {
    const g = encajarLogo(400, 200);
    expect([g.ancho, g.alto]).toEqual([256, 128]);
    expect(g.dw / g.dh).toBeCloseTo(2, 1);
  });

  it("uno más apaisado que 2:1 lleva relleno arriba y abajo, sin pasar de la placa", () => {
    const g = encajarLogo(1200, 200);
    expect(g.alto).toBe(128);
    expect(g.dh).toBeLessThan(128 / 2);
    expect(g.dy).toBeGreaterThan(0);
    expect(g.dx).toBeGreaterThanOrEqual(0);
    expect(g.dx + g.dw).toBeLessThanOrEqual(256);
  });

  it("uno alto lleva relleno a los costados y la placa nunca pasa de 256 de alto", () => {
    const g = encajarLogo(100, 400);
    expect([g.ancho, g.alto]).toEqual([256, 256]);
    expect(g.dx).toBeGreaterThan(0);
    expect(g.dy + g.dh).toBeLessThanOrEqual(256);
  });

  it("la placa achicada (192, 128, 96) guarda las proporciones", () => {
    expect(encajarLogo(400, 200, 96)).toMatchObject({ ancho: 96, alto: 48 });
    expect(encajarLogo(300, 300, 128)).toMatchObject({ ancho: 128, alto: 128 });
  });

  it("nunca da medidas cero, ni con una imagen de un píxel", () => {
    const g = encajarLogo(1, 1);
    expect(g.dw).toBeGreaterThan(0);
    expect(g.dh).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------- el guardado en este navegador */

class Almacen {
  m = new Map<string, string>();
  roto = false;
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.roto) throw new Error("lleno");
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

let alm: Almacen;
beforeEach(() => {
  alm = new Almacen();
  vi.stubGlobal("localStorage", alm);
  vi.stubGlobal("location", { search: "", origin: "https://tinkazo.app" });
  quitarLogo();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Un logo distinto por número, para llenar el mapa. */
const logoN = (n: number): Logo => png(10 + n, 20, 40 + n);

describe("guardado del logo", () => {
  it("sin logo no hay nada: ni actual ni para sellar", () => {
    expect(logoActual()).toBeNull();
    expect(logoParaSellar()).toBeUndefined();
    expect(logoPorHuella("inexistente")).toBeNull();
    expect(logoPorHuella(undefined)).toBeNull();
  });

  it("guardar lo deja como actual, y se puede pedir por su huella", () => {
    const l = validarLogo(logoN(1)) as NonNullable<ReturnType<typeof validarLogo>>;
    const r = guardarLogo(l);
    expect(r.guardado).toBe(true);
    expect(logoActual()?.huella).toBe(r.huella);
    expect(logoParaSellar()).toBe(r.huella);
    expect(logoPorHuella(r.huella)).toEqual(l.logo);
    expect(alm.getItem("tinkazo.logos")).toContain(r.huella);
  });

  it("un logo nuevo pasa a ser el actual, pero el viejo se sigue encontrando por su huella", () => {
    const a = guardarLogo(validarLogo(logoN(1)) as never);
    const b = guardarLogo(validarLogo(logoN(2)) as never);
    expect(logoActual()?.huella).toBe(b.huella);
    expect(logoPorHuella(a.huella)).not.toBeNull();
  });

  it("guarda hasta ocho y descarta el de uso más viejo, nunca el recién puesto", () => {
    const ahora = vi.spyOn(Date, "now");
    const huellas: string[] = [];
    for (let n = 1; n <= 9; n++) {
      ahora.mockReturnValue(1000 + n);
      huellas.push(guardarLogo(validarLogo(logoN(n)) as never).huella);
    }
    expect(logoPorHuella(huellas[0])).toBeNull();
    for (const h of huellas.slice(1)) expect(logoPorHuella(h)).not.toBeNull();
    expect(logoActual()?.huella).toBe(huellas[8]);
    ahora.mockRestore();
  });

  it("quitar borra el actual y el mapa entero", () => {
    const a = guardarLogo(validarLogo(logoN(1)) as never);
    guardarLogo(validarLogo(logoN(2)) as never);
    quitarLogo();
    expect(logoActual()).toBeNull();
    expect(logoPorHuella(a.huella)).toBeNull();
    expect(alm.getItem("tinkazo.logos")).toBeNull();
  });

  it("sin almacenamiento, vale hasta recargar y lo dice", () => {
    alm.roto = true;
    const r = guardarLogo(validarLogo(logoN(1)) as never);
    expect(r.guardado).toBe(false);
    expect(logoPorHuella(r.huella)).not.toBeNull();
    expect(logoActual()?.huella).toBe(r.huella);
  });

  it("con el almacenamiento lleno, el logo nuevo manda y no vuelve el viejo", () => {
    const a = guardarLogo(validarLogo(logoN(1)) as never);
    alm.roto = true;
    const b = guardarLogo(validarLogo(logoN(2)) as never);
    expect(b.guardado).toBe(false);
    expect(logoActual()?.huella).toBe(b.huella);
    expect(logoParaSellar()).toBe(b.huella);
    expect(logoPorHuella(a.huella)).not.toBeNull();
    alm.roto = false;
    quitarLogo();
    expect(logoActual()).toBeNull();
  });

  it("una huella heredada del objeto (constructor, __proto__) no es un logo", () => {
    expect(logoPorHuella("constructor")).toBeNull();
    expect(logoPorHuella("__proto__")).toBeNull();
    alm.setItem("tinkazo.logos", JSON.stringify({ actual: "constructor", m: {} }));
    expect(logoActual()).toBeNull();
  });

  it("un almacén con datos rotos, o con una imagen cambiada, no da error ni logo", () => {
    alm.setItem("tinkazo.logos", "{no es json");
    expect(logoActual()).toBeNull();
    const l = validarLogo(logoN(1)) as NonNullable<ReturnType<typeof validarLogo>>;
    const h = huellaLogo(l.logo);
    // Una entrada cuya huella no coincide con sus bytes se descarta.
    alm.setItem("tinkazo.logos", JSON.stringify({ actual: h, m: { [h]: { ...logoN(2), w: 1, h: 1, u: 1 } } }));
    expect(logoActual()).toBeNull();
    expect(logoPorHuella(h)).toBeNull();
    // Y una entrada que no es un logo.
    alm.setItem("tinkazo.logos", JSON.stringify({ actual: "x", m: { x: { t: "image/svg+xml", b: "AAAA" } } }));
    expect(logoActual()).toBeNull();
  });

  it("avisa cada vez que cambia", () => {
    const fn = vi.fn();
    alCambiarLogo(fn);
    guardarLogo(validarLogo(logoN(1)) as never);
    quitarLogo();
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("la demo nunca lleva logo, aunque haya uno guardado; el ensayo sí", () => {
    const r = guardarLogo(validarLogo(logoN(1)) as never);
    vi.stubGlobal("location", { search: "?demo=wheel", origin: "https://tinkazo.app" });
    expect(logoParaSellar()).toBeUndefined();
    vi.stubGlobal("location", { search: "", origin: "https://tinkazo.app" });
    expect(logoParaSellar()).toBe(r.huella);
  });

  it("?logo=prueba pone el logo de prueba, también con la demo, y no toca lo guardado", () => {
    vi.stubGlobal("location", { search: "?demo=wheel&logo=prueba", origin: "https://tinkazo.app" });
    const h = logoParaSellar();
    expect(h).toBe(huellaLogo(LOGO_DE_PRUEBA));
    expect(logoPorHuella(h)).toEqual(LOGO_DE_PRUEBA);
    expect(alm.getItem("tinkazo.logos")).toBeNull();
    vi.stubGlobal("location", { search: "?demo=wheel", origin: "https://tinkazo.app" });
    expect(logoPorHuella(h)).toBeNull();
  });
});
