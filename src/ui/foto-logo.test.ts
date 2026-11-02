import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aBase64, deBase64 } from "../logo";
import { LOGO_DE_PRUEBA } from "../logo-guardado";
import { dibujarFoto, type Foto } from "./foto";

/**
 * La foto para compartir con el logo de la comunidad. En Node no hay lienzo: se
 * usa uno de mentira que anota cada llamada, y se compara la foto con logo y la
 * de siempre. La comparación de píxeles de verdad (sin logo, igual a la de
 * antes de existir el logo) se mide en el navegador.
 */

type Registro = string[];

/** Un objeto que acepta cualquier llamada y cualquier propiedad, y devuelve otro igual. */
function cualquiera(): unknown {
  const coso: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === "width" || p === "height" ? 10 : p === Symbol.toPrimitive ? () => 0 : coso),
    apply: () => coso,
  });
  return coso;
}

function lienzoFalso(registro: Registro, ancho = 0, alto = 0): HTMLCanvasElement {
  const estado: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(estado, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === "measureText") return (s: string) => ({ width: 11 * String(s).length });
      return (...a: unknown[]) => {
        registro.push(`${String(p)}(${a.map((x) => (typeof x === "object" && x ? "[obj]" : String(x))).join(",")})`);
        return cualquiera();
      };
    },
    set: (t, p, v) => {
      registro.push(`set ${String(p)}=${String(v)}`);
      t[p] = v;
      return true;
    },
  });
  return { width: ancho, height: alto, getContext: () => ctx, toBlob: (f: (b: Blob | null) => void) => f(null) } as unknown as HTMLCanvasElement;
}

const foto = (extra: Partial<Foto> = {}): Foto => ({
  rotulo: "Sorteo #278 · 21 de octubre de 2026",
  titulo: "Ganó",
  personas: ["María Quispe"],
  lineas: ["Se lleva: Polera", "Entre 120 personas"],
  mas: "y {n} más",
  enlace: "https://tinkazo.app/c/AbCdEfGh#" + "A".repeat(22),
  escanear: "Escaneá para comprobarlo",
  sinQr: "El enlace va en el mensaje",
  ...extra,
});

let registro: Registro;
beforeEach(() => {
  registro = [];
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { createElement: (t: string) => (t === "canvas" ? lienzoFalso(registro) : cualquiera()) });
  vi.stubGlobal("createImageBitmap", async () => ({ width: 128, height: 64, close: () => undefined }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Las llamadas del lienzo de la foto, sin las de los lienzos auxiliares (avatares, QR) de otro orden. */
async function llamadas(f: Foto): Promise<string[]> {
  registro.length = 0;
  await dibujarFoto(f);
  return [...registro];
}

describe("foto con logo", () => {
  it("sin logo no cambia nada: el mismo dibujo con `logo` indefinido o ausente", async () => {
    const base = await llamadas(foto());
    const indefinido = await llamadas(foto({ logo: undefined, hecho: undefined }));
    expect(indefinido).toEqual(base);
    expect(base.length).toBeGreaterThan(50);
  });

  it("un `hecho` suelto, sin logo, no dibuja nada", async () => {
    expect(await llamadas(foto({ hecho: "Hecho con Tinkazo" }))).toEqual(await llamadas(foto()));
  });

  it("con logo solo se suma un bloque: todo lo demás, incluido el QR, queda igual y en el mismo orden", async () => {
    const base = await llamadas(foto());
    const con = await llamadas(foto({ logo: LOGO_DE_PRUEBA, hecho: "Hecho con Tinkazo" }));
    expect(con.length).toBeGreaterThan(base.length);
    // Lo de más es una inserción pura: el prefijo y el sufijo comunes cubren la foto de siempre entera.
    let p = 0;
    while (p < base.length && base[p] === con[p]) p++;
    let s = 0;
    while (s < base.length - p && base[base.length - 1 - s] === con[con.length - 1 - s]) s++;
    expect(p + s).toBe(base.length);
    const sumado = con.slice(p, con.length - s);
    // El bloque dibuja la placa con el logo y el texto en dos renglones.
    const textos = sumado.filter((x) => x.startsWith("fillText"));
    expect(textos).toHaveLength(2);
    expect(textos[0]).toContain("fillText(Hecho con,");
    expect(textos[1]).toContain("fillText(Tinkazo,");
    expect(sumado.some((x) => x.startsWith("drawImage"))).toBe(true);
  });

  it("la placa va arriba a la derecha, de y=34 a y=158, y el rótulo arranca más abajo", async () => {
    const con = await llamadas(foto({ logo: LOGO_DE_PRUEBA, hecho: "Hecho con Tinkazo" }));
    // El logo de prueba mide 128 x 64: a 124 px de alto son 248 de ancho, pegado al margen derecho (996).
    const dibujo = con.find((x) => x.startsWith("drawImage") && x.includes(",0,0,248,124"));
    expect(dibujo).toBeDefined();
    // La placa se gira desde su centro: (996 - 248) + 124 = 872 y 34 + 62 = 96.
    expect(con).toContain("translate(872,96)");
    expect(con).toContain("fillRect(8,8,248,124)");
  });

  it("un logo que el navegador no abre deja la foto de siempre, sin el texto suelto", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("no abre");
    });
    const base = await llamadas(foto());
    // Un logo distinto del de las otras pruebas: la imagen ya abierta de aquel no se vuelve a abrir.
    const bytes = new Uint8Array(deBase64(LOGO_DE_PRUEBA.b) as Uint8Array);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 2;
    const roto = await llamadas(foto({ logo: { t: "image/png", b: aBase64(bytes) }, hecho: "Hecho con Tinkazo" }));
    expect(roto).toEqual(base);
  });

  it("un logo que no pasa la validación no se dibuja", async () => {
    const base = await llamadas(foto());
    const malo = await llamadas(foto({ logo: { t: "image/svg+xml" as never, b: "PHN2Zz4=" }, hecho: "Hecho con Tinkazo" }));
    expect(malo).toEqual(base);
  });
});
