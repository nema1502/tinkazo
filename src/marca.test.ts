import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import config from "../vite.config";

// La integración usa el hook público de Vite, como dev y build.
async function textosInyectados(pagina: string): Promise<Record<string, Record<string, string>> | null> {
  const plugins = config.plugins as Array<{ name: string; transformIndexHtml?: { handler: Function } }>;
  const plugin = plugins.find(p => p.name === "tinkazo:textos-por-pagina")!;
  const archivo = new URL(`../${pagina}`, import.meta.url);
  const resultado = await plugin.transformIndexHtml!.handler.call({ warn: (s: string) => { throw new Error(s); } }, leer(pagina), { filename: archivo.pathname, path: `/${pagina}` });
  return resultado ? JSON.parse(resultado[0].children) : null;
}
const leer = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
describe("recursos públicos de marca", () => {
  it("ofrece la página, entradas y descargas del mismo origen", () => {
    expect(existsSync(new URL("../marca.html", import.meta.url))).toBe(true);
    const html = leer("marca.html");
    for (const recurso of ["llama.svg", "llama.png", "sello-es.svg", "sello-en.svg"]) {
      expect(existsSync(new URL(`../public/marca/${recurso}`, import.meta.url))).toBe(true);
    }
    expect(html).toContain('download="tinkazo-llama.svg"');
    expect(html).toContain('download="tinkazo-llama.png"');
    expect(html).toContain('/src/marca.ts');
    expect(leer("src/marca.ts")).toContain('import "./pagina"');
    expect(leer("vite.config.ts")).toContain('marca: resolve(__dirname, "marca.html")');
    expect(leer("public/sitemap.xml")).toContain('https://tinkazo.app/marca.html');
    expect(leer("index.html")).toContain('href="/marca.html"');
  });
  it("cada texto y atributo traducible existe en ambos idiomas y el español coincide", () => {
    const html = leer("marca.html");
    for (const m of html.matchAll(/data-i="([^"]+)"[^>]*>([^<]*)</g)) {
      expect(T.es[m[1]!], m[1]).toBe(m[2]);
      expect(typeof T.en[m[1]!], m[1]).toBe("string");
    }
    for (const m of html.matchAll(/data-(?:i-aria|titulo-clave|desc-clave)="([^"]+)"/g)) {
      for (const lang of ["es", "en"] as const) expect(typeof T[lang][m[1]!]).toBe("string");
    }
    expect(T.es.maLimite).toContain("comprobante verificable");
    expect(T.en.maLimite).toContain("verifiable receipt");
  });
  it("Vite inyecta los textos dinámicos de marca sin cargar el diccionario entero", async () => {
    const textos = await textosInyectados("marca.html");
    for (const lang of ["es", "en"] as const) {
      for (const clave of ["maCopiado", "maError", "maFondo", "maMorado", "maH1", "navComoUsa"]) {
        expect(textos?.[lang]?.[clave]).toBe(T[lang][clave]);
      }
      expect(Object.keys(textos![lang]!).length).toBeLessThan(100);
    }
  });
  it("PRESERVE: Historia conserva su diccionario reducido y la herramienta no recibe uno duplicado", async () => {
    const textos = await textosInyectados("historia.html");
    expect(textos?.en?.hiTitle).toBe(T.en.hiTitle);
    expect(textos?.es?.hiTitle).toBe(T.es.hiTitle);
    expect(textos?.es?.maH1).toBeUndefined();
    expect(await textosInyectados("index.html")).toBeNull();
  });
  it("la silueta SVG es exactamente la del icono sin su fondo", () => {
    const icono = leer("public/icon.svg");
    const llama = leer("public/marca/llama.svg");
    expect(llama.match(/<g[\s\S]*<\/g>/)?.[0]).toBe(icono.match(/<g[\s\S]*<\/g>/)?.[0]);
    expect(llama).not.toMatch(/rx=|<image|<script|<filter/);
  });
  it("el PNG RGBA de 2048 conserva exactamente la máscara pixelada y el magenta", () => {
    const b = readFileSync(new URL("../public/marca/llama.png", import.meta.url));
    expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]]).toEqual([2048, 2048, 8, 6]);
    const idat: Buffer[] = [];
    for (let i = 8; i < b.length;) {
      const n = b.readUInt32BE(i);
      if (b.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(b.subarray(i + 8, i + 8 + n));
      i += n + 12;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const rects = [...leer("public/icon.svg").matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
    let opacos = 0;
    for (let y = 0; y < 2048; y++) {
      if (raw[y * 8193] !== 0) throw new Error("filtro inesperado");
      for (let x = 0; x < 2048; x++) {
        const u = ((x + .5) / 4 - 256) / 14 + 11, v = ((y + .5) / 4 - 256) / 14 + 11;
        const dentro = rects.some(([rx, ry, w, h]) => u >= rx! && u < rx! + w! && v >= ry! && v < ry! + h!);
        const i = y * 8193 + 1 + x * 4;
        if (raw[i + 3] !== (dentro ? 255 : 0)) throw new Error(`alpha distinto en ${x},${y}`);
        if (dentro) {
          opacos++;
          if (raw[i] !== 233 || raw[i + 1] !== 61 || raw[i + 2] !== 156) throw new Error("magenta distinto");
        }
      }
    }
    expect(opacos).toBeGreaterThan(0);
    expect(opacos).toBeLessThan(2048 * 2048);
  });
  it.each([['es', 'Sorteo verificable con'], ['en', 'Verifiable draw with']])("sello %s: transparente, legible y sin fuentes remotas", (lang, frase) => {
    const svg = leer(`public/marca/sello-${lang}.svg`);
    expect(svg).toContain(frase);
    expect(svg).toContain('Tinkazo');
    expect(svg).toContain('system-ui');
    expect(svg).not.toMatch(/<image|@import|https?:\/\/(?!www.w3.org)/);
  });
});
