import { existsSync, readdirSync, readFileSync } from "node:fs";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

const EVENTO = "https://gdg.community.dev/events/details/google-gdg-tarija-presents-devfest-tarija-2026/";
const SPACE_APPS = "https://www.spaceappschallenge.org/2026/local-events/santa-cruz-de-la-sierra/";
const LANGS = ["es", "en"] as const;
const TEMAS = ["claro", "oscuro"] as const;

const leer = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const publico = (p: string): Buffer => readFileSync(new URL(`../public/marca/${p}`, import.meta.url));
/** El bloque de una tarjeta de la sección de eventos, por su id. */
const tarjeta = (html: string, id: string): string => html.match(new RegExp(`<article class="marca-evento[^"]*" id="${id}"[\\s\\S]*?</article>`))?.[0] ?? "";

/** Dibuja los módulos del QR de un SVG nuestro (el trazo con class="qr") y lo decodifica con jsQR. Devuelve también la medida. */
function decodificarSvg(svg: string): { dato: string; modulos: number; margen: number; lado: number } {
  const d = svg.match(/<path class="qr" d="([^"]+)"/)?.[1] ?? "";
  const rects = d.split("M").slice(1).map((sub) => {
    const nums = [...sub.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  });
  const x0 = Math.min(...rects.map((r) => r[0])), y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[2])), y1 = Math.max(...rects.map((r) => r[3]));
  const modulo = Math.min(...rects.map((r) => r[3] - r[1])) / 1.03; // los módulos solapan un 3 %
  const lado = Number(svg.match(/viewBox="0 0 ([\d.]+) /)?.[1]);
  const px = 6 / modulo, margen = 4 * modulo;
  const w = Math.ceil((x1 - x0 + 2 * margen) * px), h = Math.ceil((y1 - y0 + 2 * margen) * px);
  const img = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [a, b, c, e] of rects) {
    for (let y = Math.round((b - y0 + margen) * px); y < Math.round((e - y0 + margen) * px); y++) {
      for (let x = Math.round((a - x0 + margen) * px); x < Math.round((c - x0 + margen) * px); x++) img.set([0, 0, 0, 255], (y * w + x) * 4);
    }
  }
  return { dato: jsQR(img, w, h)?.data ?? "(no se pudo leer)", modulos: Math.round((x1 - x0) / modulo), margen: x0 / modulo, lado: lado / modulo };
}

describe("el DevFest Tarija en la página de marca", () => {
  it("el mensaje para WhatsApp dice fecha, lugar y el enlace para reservar, en los dos idiomas", () => {
    for (const l of LANGS) {
      const m = String(T[l].maDfWaMsg);
      expect(m, l).toContain(EVENTO);
      expect(m, l).toContain("UPDS");
      expect(m, l).toMatch(/28/);
      expect(m, l).not.toContain("·");
    }
  });

  it("el botón de WhatsApp funciona sin JavaScript, con el mensaje en español ya escrito", () => {
    const html = leer("marca.html");
    const href = html.match(/id="df-wa" href="([^"]+)"/)?.[1] ?? "";
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(String(T.es.maDfWaMsg));
  });
});

describe("el código QR de cada evento", () => {
  it("el SVG del QR del DevFest existe, se lee y apunta al enlace oficial de inscripción", () => {
    const svg = publico("devfest/qr-devfest-tarija-2026.svg").toString("utf8");
    const r = decodificarSvg(svg);
    expect(r.dato).toBe(EVENTO);
    // Borde blanco de 4 módulos de cada lado, fondo blanco y módulos en tinta oscura: se lee desde una pantalla o un afiche.
    expect(r.margen).toBeCloseTo(4, 5);
    expect(r.lado).toBeCloseTo(r.modulos + 8, 5);
    expect(svg).toContain('<rect width="570" height="570" fill="#ffffff"/>');
    expect(svg).toContain('fill="#191919"');
  });

  it("el SVG del QR de Space Apps Santa Cruz existe, se lee y apunta a la página oficial de la edición local", () => {
    const svg = publico("space-apps/qr-space-apps-santa-cruz-2026.svg").toString("utf8");
    const r = decodificarSvg(svg);
    expect(r.dato).toBe(SPACE_APPS);
    expect(r.margen).toBeCloseTo(4, 5);
    expect(r.lado).toBeCloseTo(r.modulos + 8, 5);
  });

  it("el bloque del DevFest muestra el QR con su leyenda en los dos idiomas y lo ofrece para bajar", () => {
    const html = leer("marca.html");
    const b = tarjeta(html, "devfest");
    expect(b).toContain('<img src="/marca/devfest/qr-devfest-tarija-2026.svg"');
    expect(b).toContain('data-i="maDfQrCap"');
    expect(b).toContain('data-i-alt="maDfQrAlt"');
    expect(b).toContain('href="/marca/devfest/qr-devfest-tarija-2026.svg" download=');
    // El botón de reservar y el QR llevan al mismo enlace oficial.
    expect(b).toContain(`<a class="mini solid marca-df-rsvp" href="${EVENTO}"`);
    expect(T.es.maDfQrCap).toBe("Escaneá para reservar tu lugar");
    expect(T.en.maDfQrCap).toBe("Scan to save your seat");
    for (const l of LANGS) {
      expect(String(T[l].maDfQrAlt), l).toBeTruthy();
      expect(String(T[l].maQrBaja), l).toBeTruthy();
    }
    expect(T.en.maDfQrAlt).not.toBe(T.es.maDfQrAlt);
  });

  it("las imágenes para redes del DevFest (publicación, historia y panorámica, en los dos estilos, temas e idiomas) llevan el QR y se leen", async () => {
    const ruta = (p: string): string => new URL(`../scripts/marca/${p}`, import.meta.url).href; // .mjs sin tipos: se importa por su URL
    const { leerPng } = await import(/* @vite-ignore */ ruta("base.mjs")) as unknown as { leerPng: (b: Buffer) => { w: number; h: number; pix: Uint8Array } };
    const { TEXTO_IMPRESO } = await import(/* @vite-ignore */ ruta("impresos.mjs")) as unknown as { TEXTO_IMPRESO: Record<string, { reservar: string[] }> };
    // La leyenda de las imágenes es la misma de la página.
    for (const l of LANGS) expect(TEXTO_IMPRESO[l]!.reservar.join(" "), l).toBe(T[l].maDfQrCap);
    let leidas = 0;
    for (const id of ["sponsor-post", "sponsor-historia", "sponsor-panoramica"]) for (const estilo of ["", "-juegos"]) for (const t of TEMAS) for (const l of LANGS) {
      const n = `redes-${id}${estilo}-${t}-${l}.png`;
      const { w, h, pix } = leerPng(publico(n));
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0, j = 0; i < pix.length; i += 3, j += 4) { rgba[j] = pix[i]!; rgba[j + 1] = pix[i + 1]!; rgba[j + 2] = pix[i + 2]!; rgba[j + 3] = 255; }
      expect(jsQR(rgba, w, h)?.data, n).toBe(EVENTO);
      leidas++;
    }
    expect(leidas).toBe(24);
  }, 120_000);
});

describe("la sección de eventos", () => {
  it("tiene una tarjeta por evento, con su título y su barra de acceso, en los dos idiomas", () => {
    const html = leer("marca.html");
    expect(html).toContain('<section class="marca-eventos" id="eventos"');
    expect(html).toContain('href="#eventos" data-i="maIrEv"');
    expect(html).toContain('data-i="maEvT"');
    expect(T.es.maEvT).toBe("Eventos");
    expect(T.en.maEvT).toBe("Events");
    expect(tarjeta(html, "devfest")).not.toBe("");
    expect(tarjeta(html, "space-apps")).not.toBe("");
  });

  it("la tarjeta de Space Apps Santa Cruz enlaza a la página oficial, lleva su QR y no usa logos ni afiches de la NASA", () => {
    const html = leer("marca.html");
    const b = tarjeta(html, "space-apps");
    expect(b).toContain(`href="${SPACE_APPS}"`);
    expect(b).toContain('<img src="/marca/space-apps/qr-space-apps-santa-cruz-2026.svg"');
    // La única imagen de la tarjeta es el QR: sin logo ni afiche de NASA o Space Apps (sus marcas piden autorización).
    expect([...b.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1])).toEqual(["/marca/space-apps/qr-space-apps-santa-cruz-2026.svg"]);
    expect(readdirSync(new URL("../public/marca/space-apps/", import.meta.url))).toEqual(["qr-space-apps-santa-cruz-2026.svg"]);
    expect(existsSync(new URL("../public/marca/space-apps/logo.png", import.meta.url))).toBe(false);
    // La fecha es la de la fuente y el texto no promete una alianza que todavía no se confirmó.
    expect(T.es.maSaB).toContain("14 y 15 de noviembre de 2026");
    expect(T.en.maSaB).toContain("November 14 and 15, 2026");
    expect(T.es.maSaNota).toContain("no es parte de la NASA");
    expect(T.en.maSaNota).toContain("not part of NASA");
    for (const l of LANGS) {
      const textos = Object.keys(T[l]).filter((k) => /^maSa/.test(k)).map((k) => String(T[l][k]));
      expect(textos.length, l).toBe(8);
      for (const s of textos) expect(s, `${l}: ${s}`).not.toMatch(/·|aliad[oa]s? oficial|socio oficial|official (ally|allies|partner|sponsor)|patrocinador oficial/i);
    }
    expect(b).not.toMatch(/aliad[oa]s? oficial|official (ally|partner)/i);
    expect(T.es.maSaQrCap).toBe("Escaneá para inscribirte");
    expect(T.en.maSaQrCap).toBe("Scan to sign up");
  });
});
