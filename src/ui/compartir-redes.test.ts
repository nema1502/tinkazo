// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// El diccionario entero, como en la página del sorteo: compartir.ts lee sus textos de ahí.
import "../i18n";

/**
 * Facebook e Instagram en el diálogo de compartir (`compartir.ts`): solo enlaces de compartir, sin código de terceros.
 * Facebook publica el enlace del comprobante (no el mensaje entero) y no se ofrece sin comprobante. Instagram solo en
 * el celular: baja la foto elegida y abre Instagram. WhatsApp sigue siendo la acción principal.
 */

const h = vi.hoisted(() => ({ contar: vi.fn(), tactil: false }));

vi.mock("./foto", () => ({ fotoPng: async () => new Blob(["png"], { type: "image/png" }), fotoDelJuegoPng: async () => null }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), refDe: () => ({}) }));

import { abrirCompartir, type Listo } from "./compartir";
import type { Foto } from "./foto";
import { T } from "../i18n";

const ENLACE = "https://tinkazo.app/c/Abcd1234#" + "k".repeat(22);
const foto = (enlace: string): Foto => ({ rotulo: "Sorteo #1", titulo: "Ganó", personas: ["Ana"], enlace } as unknown as Foto);

const abiertas: Array<[string, string]> = [];

beforeEach(() => {
  abiertas.length = 0;
  h.contar.mockReset();
  document.body.innerHTML = "";
  vi.stubGlobal("open", (url: string, destino: string) => {
    abiertas.push([url, destino]);
    return null;
  });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("pointer: coarse") && h.tactil, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  URL.createObjectURL = () => "blob:prueba";
  URL.revokeObjectURL = () => undefined;
  // Bajar la foto es un enlace que se toca: jsdom no navega.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  // jsdom no trae los diálogos modales: lo justo para abrir y cerrar.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function abrir(enlace: string): Promise<HTMLDialogElement> {
  const listo: Listo = { mensaje: `Ganó Ana.\nComprobalo acá:\n${enlace}`, fotos: [foto(enlace)], archivo: "tinkazo-sorteo-1", corto: true };
  abrirCompartir({ titulo: "Sorteo", preparar: async () => listo }, "es");
  const dlg = document.querySelector("dialog") as HTMLDialogElement;
  await vi.waitFor(() => expect(dlg.querySelector<HTMLButtonElement>("[data-whatsapp]")?.disabled).toBe(false));
  return dlg;
}

describe("compartir en Facebook e Instagram", () => {
  it("Facebook publica el enlace del comprobante, no el mensaje entero", async () => {
    const dlg = await abrir(ENLACE);
    const fb = dlg.querySelector<HTMLButtonElement>("[data-facebook]");
    expect(fb?.hidden).toBe(false);
    expect(fb?.textContent).toBe(T.es.cmpFb);
    fb?.click();
    expect(abiertas).toHaveLength(1);
    const [url] = abiertas[0] ?? [""];
    expect(url).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(ENLACE)}`);
    expect(decodeURIComponent(url)).not.toContain("Ganó");
  });

  it("sin comprobante (un sorteo sin sello) no hay enlace que publicar y Facebook no se ofrece", async () => {
    const dlg = await abrir("");
    expect(dlg.querySelector<HTMLButtonElement>("[data-facebook]")?.hidden).toBe(true);
  });

  it("en la computadora Instagram no aparece: no hay camino para subir la foto", async () => {
    h.tactil = false;
    const dlg = await abrir(ENLACE);
    expect(dlg.querySelector<HTMLButtonElement>("[data-instagram]")?.hidden).toBe(true);
  });

  it("en el celular Instagram baja la foto, abre Instagram y lo dice con su propio texto", async () => {
    h.tactil = true;
    const dlg = await abrir(ENLACE);
    const ig = dlg.querySelector<HTMLButtonElement>("[data-instagram]");
    expect(ig?.hidden).toBe(false);
    ig?.click();
    expect(abiertas.map(([u]) => u)).toEqual(["https://www.instagram.com/"]);
    expect(dlg.querySelector(".cmp-aviso")?.textContent).toBe(T.es.cmpIgAviso);
    expect(dlg.querySelector(".cmp-aviso")?.textContent).not.toMatch(/WhatsApp/);
    h.tactil = false;
  });

  it("WhatsApp sigue siendo la única acción principal", async () => {
    const dlg = await abrir(ENLACE);
    expect(dlg.querySelectorAll("button.primary")).toHaveLength(1);
    expect(dlg.querySelector<HTMLButtonElement>("[data-facebook]")?.classList.contains("ghost")).toBe(true);
  });

  it("los textos van en los dos idiomas, sin comillas angulares ni punto y coma", () => {
    for (const k of ["cmpFb", "cmpIg", "cmpIgAviso"]) {
      for (const lang of ["es", "en"] as const) {
        const texto = T[lang][k];
        expect(typeof texto, `${lang}.${k}`).toBe("string");
        expect(texto as string).not.toMatch(/[«»;]/);
      }
    }
  });
});
