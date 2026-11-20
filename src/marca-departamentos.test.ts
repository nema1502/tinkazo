import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// La serie de stickers de los nueve departamentos, el Tinku y los tiernos: scripts/marca/departamentos.mjs (el corredor)
// y scripts/marca/departamentos/ (un archivo por zona), archivos en public/marca/departamentos/.
type St = { id: string; nombre: string; frase: string[]; nota?: string; zona: string };
const DIR = "../public/marca/departamentos/";
const archivo = (n: string): Buffer => readFileSync(new URL(`${DIR}${n}`, import.meta.url));
const existe = (n: string): boolean => existsSync(new URL(`${DIR}${n}`, import.meta.url));

describe("stickers de los nueve departamentos", async () => {
  const m = await import(/* @vite-ignore */ new URL("../scripts/marca/departamentos.mjs", import.meta.url).href) as unknown as {
    SERIE: St[]; LUGARES: Record<string, string>; HOJAS: Record<string, { ids: string[]; cm: number }>;
    revisarSerie: () => string[];
    medidas: (st: St) => { w: number; h: number; capMin: number; capSello: number; fallas: string[] };
    elegir: (solo?: string) => St[];
  };

  it("cada sticker tiene un id que empieza con su lugar, nombre, frase y dibujo, sin repetirse ni decir lo que no va", () => {
    expect(m.SERIE.length).toBe(45);
    expect(m.revisarSerie()).toEqual([]);
    for (const st of m.SERIE) {
      expect(Object.keys(m.LUGARES), st.id).toContain(st.id.split("-")[0]);
      expect(st.frase.join(" "), st.id).not.toMatch(/[«»;·—–]|suerte|apuest|casino|singani|chicha|cerveza/i);
    }
    // Las de referencia, que marcan el estilo para las demás.
    for (const id of ["lapaz-illimani", "tinku-montera", "tierno-perezoso"]) expect(m.SERIE.some((st) => st.id === id), id).toBe(true);
  });

  it("se leen a 5 cm: troquel de una pieza, frase de 2,8 mm o más y tinkazo.app de 2,2 mm o más, igual en todos", () => {
    const sellos: number[] = [];
    for (const st of m.SERIE) {
      const r = m.medidas(st);
      expect(Math.max(r.w, r.h), st.id).toBeCloseTo(50, 3);
      expect(r.fallas, st.id).toEqual([]);
      sellos.push(r.capSello);
    }
    expect(Math.max(...sellos) - Math.min(...sellos)).toBeLessThan(0.05);
  });

  it("cada uno tiene su PNG de 5 cm a 300 ppp con fondo transparente", () => {
    for (const st of m.SERIE) {
      const b = archivo(`${st.id}.png`);
      expect([Math.max(b.readUInt32BE(16), b.readUInt32BE(20)), b[24], b[25]], st.id).toEqual([591, 8, 6]);
      const phys = b.indexOf("pHYs");
      expect([b.readUInt32BE(phys + 4), b.readUInt32BE(phys + 8), b[phys + 12]], st.id).toEqual([11811, 11811, 1]);
      const idat: Buffer[] = [];
      for (let i = 8; i < b.length;) { const k = b.readUInt32BE(i); if (b.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(b.subarray(i + 8, i + 8 + k)); i += k + 12; }
      expect(inflateSync(Buffer.concat(idat))[4], `${st.id}: la esquina es transparente`).toBe(0);
    }
  });

  // Los archivos sueltos de imprenta no viajan en el repositorio: se generan con node scripts/marca/departamentos.mjs.
  // Cuando están en la máquina, se comprueban igual que siempre.
  it.skipIf(!existe("imprenta"))("los archivos de imprenta generados llevan 3 mm de sangrado y la capa de corte, en 5 y 7 cm", () => {
    for (const st of m.SERIE) {
      for (const cm of [5, 7]) {
        const svg = archivo(`imprenta/tinkazo-${st.id}-${cm}cm.svg`).toString("utf8").replace(/\r\n/g, "\n");
        const [w, h] = [Number(svg.match(/width="([\d.]+)mm"/)![1]), Number(svg.match(/height="([\d.]+)mm"/)![1])];
        expect(Math.max(w, h), `${st.id} ${cm}`).toBeCloseTo(cm * 10 + 6, 2); // 3 mm de sangrado por lado
        expect(svg).toMatch(/<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0\.25">\n<path d="M[^"]+Z"\/>\n<\/g>/);
        expect(svg).not.toMatch(/<text|<tspan|font-family|<image|<script/);
        const pdf = archivo(`imprenta/tinkazo-${st.id}-${cm}cm.pdf`).toString("latin1");
        expect(pdf.startsWith("%PDF-1.5"), `${st.id} ${cm}`).toBe(true);
        expect(pdf).toContain("/OCG");
      }
    }
  });

  it("la página muestra los 45 PNG y permite bajar las hojas", () => {
    const html = readFileSync(new URL("../marca.html", import.meta.url), "utf8");
    const bloque = html.split('id="departamentos"')[1]!.split('id="qr"')[0]!;
    expect((bloque.match(/src="\/marca\/departamentos\/[^/]+\.png"/g) ?? []).length).toBe(45);
    for (const st of m.SERIE) {
      expect(bloque, st.id).toContain(`<img src="/marca/departamentos/${st.id}.png" width="591" height="591" alt="`);
      expect(bloque, st.id).toContain(`href="/marca/departamentos/${st.id}.png" download="tinkazo-sticker-${st.id}.png"`);
    }
    expect((bloque.match(/loading="lazy"/g) ?? []).length).toBeGreaterThanOrEqual(45);
    expect(bloque).toContain('width="591" height="591"');
    for (const hoja of ["a4-postales-tinku", "a4-occidente", "a4-valles", "a4-oriente", "a4-tiernos", "a4-litoral", "a3-todos"]) {
      expect(bloque, hoja).toContain(`href="/marca/departamentos/hojas/hoja-${hoja}.pdf"`);
      expect(bloque, hoja).toContain(`src="/marca/departamentos/hojas/hoja-${hoja}.png" width="1131" height="1600"`);
      expect(archivo(`hojas/hoja-${hoja}.pdf`).toString("latin1").startsWith("%PDF-"), hoja).toBe(true);
      const vista = archivo(`hojas/hoja-${hoja}.png`);
      expect([vista.readUInt32BE(16), vista.readUInt32BE(20)], hoja).toEqual([1131, 1600]);
    }
  });

  it("frases.txt trae la frase y la nota de cada uno, sin los signos que la marca no usa", () => {
    const txt = archivo("frases.txt").toString("utf8");
    for (const st of m.SERIE) {
      expect(txt, st.id).toContain(st.frase.join(" "));
      if (st.nota) expect(txt, st.id).toContain(st.nota);
    }
    expect(txt).toContain("@tinkazo.app");
    expect(txt).not.toMatch(/[«»;·—–]/);
  });

  it("las hojas del plan suman los 42 y --solo elige por zona, por lugar o por id", () => {
    expect(m.HOJAS["hoja-a3-todos"]!.ids.length).toBe(42);
    for (const [nombre, h] of Object.entries(m.HOJAS)) {
      if (nombre !== "hoja-a3-todos") expect(h.ids.length, nombre).toBe(12);
      if (existe(`hojas/${nombre}.pdf`)) expect(h.ids.every((id) => m.SERIE.some((st) => st.id === id)), nombre).toBe(true);
    }
    // Cochabamba entra con el silpancho y no con la llajua, que queda de repuesto: la A3 de 42 no tiene lugar para las dos.
    expect(m.HOJAS["hoja-a3-todos"]!.ids).toContain("cochabamba-silpancho");
    expect(m.HOJAS["hoja-a3-todos"]!.ids).not.toContain("cochabamba-llajua");
    expect(m.elegir("bolivia").every((st) => st.zona === "bolivia")).toBe(true);
    expect(m.elegir("lapaz").every((st) => st.id.startsWith("lapaz-"))).toBe(true);
    expect(m.elegir("tierno-perezoso").map((st) => st.id)).toEqual(["tierno-perezoso"]);
    expect(() => m.elegir("narnia")).toThrow();
  });

  it("las hojas armadas llevan los stickers del plan, sin tocarse, con margen y con el tamaño que pide el plan", () => {
    expect(existe("hojas/hojas.json")).toBe(true);
    const info = JSON.parse(archivo("hojas/hojas.json").toString("utf8")) as { hojas: { nombre: string; ancho: number; cm: number; aire: number; margen: number; ids: string[] }[] };
    expect(info.hojas.map((h) => h.nombre).sort()).toEqual(Object.keys(m.HOJAS).sort());
    for (const h of info.hojas) {
      const plan = m.HOJAS[h.nombre]!;
      expect([...h.ids].sort(), h.nombre).toEqual([...plan.ids].sort()); // los mismos, en otro orden si alternan colores
      expect(h.cm, h.nombre).toBeGreaterThanOrEqual(plan.cm);
      expect(h.aire, `${h.nombre}: aire entre troqueles`).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(h.margen, `${h.nombre}: margen contra el papel`).toBeGreaterThanOrEqual(10 - 1e-6);
      for (const ext of ["pdf", "png"]) expect(existe(`hojas/${h.nombre}.${ext}`), `${h.nombre}.${ext}`).toBe(true);
      const pdf = archivo(`hojas/${h.nombre}.pdf`).toString("latin1");
      expect(pdf.startsWith("%PDF-1.5"), h.nombre).toBe(true);
      expect(pdf, `${h.nombre}: la línea de corte va en su capa`).toContain("/OCG");
    }
  });
});
