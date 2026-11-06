// @vitest-environment jsdom
import { Blob as BlobDeNode } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../state";
// El diccionario entero, como en la página del sorteo: compartir.ts lee sus textos de ahí.
import "../i18n";

/**
 * La foto con el fondo del juego que se jugó (odd/tasks/foto-juego.md, T1):
 *
 * - la foto (`foto.ts`): con `fondo`, primero la ilustración y encima la foto
 *   de siempre con paneles de tinta detrás de los textos; el QR, igual. Un
 *   juego sin ilustración deja la foto de siempre (S6);
 * - el diálogo (`compartir.ts`): con el juego y su ilustración, dos fotos lado
 *   a lado, la del juego elegida; se comparte y se descarga solo la elegida
 *   (S2, S3). Sin juego, la de siempre; los eventos, como siempre (S5);
 * - el sorteo (`draw.ts`): el juego que de verdad se jugó (con el cambio por
 *   cantidad o el motor de respaldo) va a compartir, y el último si se vio de
 *   nuevo con otro (S5).
 *
 * La ilustración es de `foto-fondos.ts` (otra tarea): acá se reemplaza por una
 * que solo tiene la carrera y anota que se pintó.
 */

const h = vi.hoisted(() => ({
  fondo: vi.fn((c: CanvasRenderingContext2D, juego: string, _w: number, _h: number): boolean => {
    if (juego !== "race") return false;
    c.fillStyle = "#123456";
    c.fillRect(0, 0, 1, 1);
    return true;
  }),
  contar: vi.fn(),
}));

/** Lo que controla el sorteo de la última parte: el motor, si arranca, y lo que llega a compartir. */
const s = { pixi: false, pixiAnda: true, abrir: vi.fn(), app: null as null | { game: Game } };

vi.mock("./foto-fondos", () => ({ pintarFondoJuego: (c: CanvasRenderingContext2D, j: string, w: number, a: number) => h.fondo(c, j, w, a) }));
vi.mock("../contar", async (orig) => ({ ...(await orig<typeof import("../contar")>()), contar: (...a: unknown[]) => h.contar(...a) }));

/* ------------------------------------------------------------- el lienzo de mentira (como foto-logo.test.ts) */

type Registro = string[];

function cualquiera(): unknown {
  const coso: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === "width" || p === "height" ? 10 : p === Symbol.toPrimitive ? () => 0 : coso),
    apply: () => coso,
  });
  return coso;
}

function ctxFalso(registro: Registro): CanvasRenderingContext2D {
  const estado: Record<string | symbol, unknown> = {};
  return new Proxy(estado, {
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
  }) as unknown as CanvasRenderingContext2D;
}

const fotoBase = {
  rotulo: "Sorteo #278 · 21 de octubre de 2026",
  titulo: "Ganó",
  personas: ["María Quispe"],
  lineas: ["Se lleva: Polera", "Entre 120 personas"],
  mas: "y {n} más",
  enlace: "https://tinkazo.app/c/AbCdEfGh#" + "A".repeat(22),
  escanear: "Escaneá para comprobarlo",
  sinQr: "El enlace va en el mensaje",
};

describe("la foto con el fondo del juego", () => {
  let registro: Registro;
  beforeEach(() => {
    registro = [];
    h.fondo.mockClear();
    const lienzo = (): HTMLCanvasElement =>
      ({ width: 0, height: 0, getContext: () => ctxFalso(registro), toBlob: (f: (b: Blob | null) => void) => f(new Blob(["png"], { type: "image/png" })) }) as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: (t: string) => (t === "canvas" ? lienzo() : cualquiera()) });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function llamadas(extra: Record<string, unknown> = {}): Promise<string[]> {
    const { dibujarFoto } = await import("./foto");
    registro.length = 0;
    await dibujarFoto({ ...fotoBase, ...extra });
    return [...registro];
  }

  it("un juego sin ilustración deja la foto de siempre, llamada por llamada", async () => {
    const base = await llamadas();
    expect(h.fondo).not.toHaveBeenCalled();
    const sin = await llamadas({ fondo: "trompo" });
    expect(h.fondo).toHaveBeenCalledTimes(1);
    expect(h.fondo.mock.calls[0]?.slice(1)).toEqual(["trompo", 1080, 1350]);
    expect(sin).toEqual(base);
  });

  it("con ilustración: primero el fondo, sin el relleno oscuro entero encima", async () => {
    const con = await llamadas({ fondo: "race" });
    expect(con.slice(0, 3)).toEqual(["set textBaseline=alphabetic", "set fillStyle=#123456", "fillRect(0,0,1,1)"]);
    expect(con).not.toContain("fillRect(0,0,1080,1350)");
    // La franja de cinco colores sigue arriba y abajo.
    expect(con).toContain("fillRect(0,0,60,16)");
    expect(con).toContain("fillRect(0,1334,60,16)");
  });

  it("con ilustración: un panel de tinta oscuro detrás del rótulo, del medio y de 'Escaneá', antes de cada texto", async () => {
    const con = await llamadas({ fondo: "race" });
    // Un panel: sombra dura de tinta, el relleno oscuro y el borde de tinta.
    const paneles = con.flatMap((x, i) =>
      x.startsWith("fillRect(") && con[i - 1] === "set fillStyle=#171126" && con[i - 3] === "set fillStyle=#000000" && con.slice(i + 1, i + 4).some((y) => y.startsWith("strokeRect(")) ? [i] : [],
    );
    expect(paneles).toHaveLength(3);
    const textos = ["fillText(Tinka,", "fillText(S,", "fillText(Ganó,", "fillText(Escaneá"].map((t) => con.findIndex((x) => x.startsWith(t)));
    textos.forEach((i) => expect(i).toBeGreaterThan(0));
    const [marca, rotulo, titulo, escanear] = textos as [number, number, number, number];
    const [p1, p2, p3] = paneles as [number, number, number];
    expect(p1).toBeLessThan(marca);
    expect(p1).toBeLessThan(rotulo);
    expect(p2).toBeGreaterThan(rotulo);
    expect(p2).toBeLessThan(titulo);
    expect(p3).toBeGreaterThan(titulo);
    expect(p3).toBeLessThan(escanear);
  });

  it("con ilustración: la tarjeta del QR y el QR, iguales y en el mismo lugar; sin degradados ni desenfoque", async () => {
    // El QR se pega en su lugar; las caras (que en la foto del juego son más chicas) se pegan en 0,0 de su calcomanía.
    const qr = (l: string[]): string[] => l.filter((x) => /(544|558),(816|830)|^drawImage\(\[obj\],\d+,\d+,\d+,\d+\)$/.test(x) && !x.startsWith("drawImage([obj],0,0,"));
    const base = await llamadas();
    const con = await llamadas({ fondo: "race" });
    expect(qr(base).length).toBeGreaterThan(2);
    expect(qr(con)).toEqual(qr(base));
    expect(con.filter((x) => /Gradient|shadowBlur|filter|globalAlpha/.test(x))).toEqual([]);
  });

  it("fotoDelJuegoPng: la foto del juego si hay ilustración; si no, nada", async () => {
    const { fotoDelJuegoPng } = await import("./foto");
    expect(await fotoDelJuegoPng({ ...fotoBase, fondo: "race" })).toBeInstanceOf(Blob);
    expect(await fotoDelJuegoPng({ ...fotoBase, fondo: "trompo" })).toBeNull();
    expect(await fotoDelJuegoPng(fotoBase)).toBeNull();
  });
});

/* ------------------------------------------------------------- la ilustración se ve (T2b) */

/**
 * Un lienzo que mide el texto según su letra, más o menos como el del
 * navegador (0,65 del tamaño por letra en negrita, 0,6 en la monoespaciada),
 * y anota los paneles de tinta: sombra de tinta, relleno oscuro y borde.
 */
function ctxMedido(registro: Registro): CanvasRenderingContext2D {
  const estado: Record<string | symbol, unknown> = {};
  return new Proxy(estado, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === "measureText")
        return (s: string) => {
          const font = String(t.font ?? "");
          const tam = Number(/(\d+)px/.exec(font)?.[1] ?? 10);
          return { width: Array.from(String(s)).length * tam * (/monospace/.test(font) ? 0.6 : /^(900|800)/.test(font) ? 0.65 : 0.6) };
        };
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
  }) as unknown as CanvasRenderingContext2D;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Los paneles de tinta, en orden: arriba, el medio y "Escaneá". Con su sombra de 12 px abajo a la derecha. */
function paneles(con: string[]): Rect[] {
  return con.flatMap((x, i) => {
    if (!(x.startsWith("fillRect(") && con[i - 1] === "set fillStyle=#171126" && con[i - 3] === "set fillStyle=#000000" && con.slice(i + 1, i + 4).some((y) => y.startsWith("strokeRect(")))) return [];
    const [rx, ry, rw, rh] = x.slice(9, -1).split(",").map(Number) as [number, number, number, number];
    return [{ x: rx, y: ry, w: rw, h: rh }];
  });
}

const ARTE = { arriba: 236, abajo: 540 };
const seCruzaConElArte = (r: Rect): boolean => r.y < ARTE.abajo && r.y + r.h + 12 > ARTE.arriba;

describe("la foto del juego deja ver la ilustración (T2b)", () => {
  let registro: Registro;
  beforeEach(() => {
    registro = [];
    h.fondo.mockClear();
    const lienzo = (): HTMLCanvasElement =>
      ({ width: 0, height: 0, getContext: () => ctxMedido(registro), toBlob: (f: (b: Blob | null) => void) => f(new Blob(["png"], { type: "image/png" })) }) as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: (t: string) => (t === "canvas" ? lienzo() : cualquiera()) });
  });
  afterEach(() => vi.unstubAllGlobals());

  // Como la foto de la evidencia v1: sorteo de prueba con fecha, sin premio.
  const juego = (personas: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...fotoBase,
    rotulo: "Sorteo #589, red de prueba, 5 de noviembre de 2026",
    personas,
    lineas: ["Salió entre 2 personas"],
    fondo: "race",
    ...extra,
  });
  async function dibujo(f: Record<string, unknown>): Promise<string[]> {
    const { dibujarFoto } = await import("./foto");
    registro.length = 0;
    await dibujarFoto(f as never);
    return [...registro];
  }

  it("el panel de arriba abraza la marca y el rótulo (en dos renglones si es largo), entre y=40 y y=220", async () => {
    const [arriba] = paneles(await dibujo(juego(["Guido"])));
    expect(arriba).toBeDefined();
    const r = arriba as Rect;
    expect(r.x).toBe(56);
    expect(r.y).toBe(40);
    expect(r.y + r.h).toBeLessThanOrEqual(220);
    // "SORTEO #589, RED DE PRUEBA," en 25 px espaciado: unos 470 px, no los 930 del ancho.
    expect(r.w).toBeLessThan(600);
    const con = await dibujo(juego(["Guido"]));
    const rotulo = con.filter((x) => /^fillText\(.,[\d.]+,(176|204)\)$/.test(x));
    expect(rotulo.some((x) => x.endsWith(",176)"))).toBe(true);
    expect(rotulo.some((x) => x.endsWith(",204)"))).toBe(true);
  });

  it.each([
    ["un nombre corto", ["Guido"], {}],
    ["un nombre largo", ["María Fernanda Guadalupe Quispe"], {}],
    ["un nombre corto con premio", ["Guido"], { lineas: ["Se lleva: Polera", "Salió entre 2 personas"] }],
    ["un nombre largo con premio", ["María Fernanda Guadalupe Quispe"], { lineas: ["Se lleva: Polera", "Salió entre 2 personas"] }],
  ])("%s: ningún panel pisa la ventana del arte (y 236–540); el medio va en su franja (556–800) y abraza el texto", async (_n, personas, extra) => {
    const con = await dibujo(juego(personas, extra));
    const ps = paneles(con);
    expect(ps).toHaveLength(3);
    ps.forEach((r) => expect(seCruzaConElArte(r)).toBe(false));
    const m = ps[1] as Rect;
    expect(m.x).toBe(56);
    expect(m.y).toBeGreaterThanOrEqual(556);
    expect(m.y + m.h).toBeLessThanOrEqual(800);
    expect(m.w).toBeLessThan(968);
    // El nombre entero, sin recortar, y dentro del panel.
    const nombre = personas[0] as string;
    const renglones = con.filter((x) => x.startsWith("fillText(") && nombre.includes(x.slice(9).split(",")[0] as string) && (x.slice(9).split(",")[0] as string).length > 3);
    expect(renglones.map((x) => x.slice(9).split(",")[0]).join(" ")).toBe(nombre);
  });

  it("el nombre se lee: nunca más chico que 'Ganó' ni que 33 px", async () => {
    for (const personas of [["Guido"], ["María Fernanda Guadalupe Quispe"]]) {
      const con = await dibujo(juego(personas, { lineas: ["Se lleva: Polera", "Salió entre 2 personas"] }));
      const fuentes = con.filter((x) => x.startsWith("set font=900 ")).map((x) => Number(/(\d+)px/.exec(x)?.[1]));
      const iGano = con.findIndex((x) => x.startsWith("fillText(Ganó,"));
      const iNombre = con.findIndex((x) => x.startsWith("fillText(") && (personas[0] as string).startsWith(x.slice(9).split(",")[0] as string) && (x.slice(9).split(",")[0] as string).length > 3);
      const tamAntes = (i: number): number => Number(/(\d+)px/.exec(con.slice(0, i).reverse().find((x) => x.startsWith("set font=")) ?? "")?.[1]);
      expect(fuentes.length).toBeGreaterThan(0);
      expect(tamAntes(iNombre)).toBeGreaterThanOrEqual(Math.max(33, tamAntes(iGano)));
    }
  });

  it("lo que no entra en la franja (muchos ganadores) sube desde y=800, nunca debajo del panel de arriba", async () => {
    const ps = paneles(await dibujo(juego(["Ana", "Beto", "Carla", "Diego", "Elena"], { titulo: "Ganaron" })));
    expect(ps).toHaveLength(3);
    const [arriba, m] = ps as [Rect, Rect];
    expect(m.y + m.h).toBe(800);
    expect(m.y).toBeGreaterThanOrEqual(arriba.y + arriba.h + 16);
  });

  it("la fila de abajo no cambia: 'Escaneá' a la izquierda y la tarjeta del QR en 544–996 × 816–1268", async () => {
    const con = await dibujo(juego(["Guido"]));
    expect(con).toContain("fillRect(544,816,452,452)");
    expect(con).toContain("fillRect(558,830,452,452)");
    const abajo = paneles(con)[2] as Rect;
    expect(abajo.x).toBe(56);
    expect(abajo.x + abajo.w).toBe(528);
    expect(abajo.y).toBeGreaterThan(816);
  });

  it("con logo, el panel de arriba sigue de lado a lado y el rótulo en un renglón, como antes", async () => {
    const { LOGO_DE_PRUEBA } = await import("../logo-guardado");
    vi.stubGlobal("createImageBitmap", async () => ({ width: 128, height: 64, close: () => undefined }));
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const con = await dibujo(juego(["Guido"], { logo: LOGO_DE_PRUEBA, hecho: "Hecho con Tinkazo" }));
    const arriba = paneles(con)[0] as Rect;
    expect(arriba).toEqual({ x: 56, y: 40, w: 968, h: 170 });
    expect(con.some((x) => /^fillText\(S,84,196\)$/.test(x))).toBe(true);
  });
});

/* ------------------------------------------------------------- el diálogo de compartir */

describe("el diálogo: dos fotos lado a lado y se comparte la elegida", () => {
  const bajadas: string[] = [];
  const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
  const datos = { enlace, ganadores: ["Ana"], total: 12, premio: "Pizza", numero: "278", red: "testnet" };

  beforeEach(() => {
    bajadas.length = 0;
    h.contar.mockReset();
    document.body.innerHTML = "";
    const registro: Registro = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctxFalso(registro) as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((f: BlobCallback) => f(new Blob(["png"], { type: "image/png" })));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      bajadas.push(this.download);
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
      HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      };
    }
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("open", vi.fn());
  });
  afterEach(() => {
    document.querySelector("dialog")?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrir(d: Record<string, unknown>): Promise<HTMLDialogElement> {
    const { abrirSorteo } = await import("./compartir");
    abrirSorteo({ ...datos, ...d }, "es", { corto: false });
    const dlg = document.querySelector("dialog") as HTMLDialogElement;
    await vi.waitFor(() => expect(dlg.querySelector<HTMLButtonElement>("[data-whatsapp]")?.disabled).toBe(false));
    return dlg;
  }
  const opciones = (dlg: HTMLElement): HTMLButtonElement[] => [...dlg.querySelectorAll<HTMLButtonElement>(".cmp-fotos button[aria-pressed]")];

  it("con el juego y su ilustración: dos fotos, la del juego primero y elegida, con botones de verdad", async () => {
    const dlg = await abrir({ juego: "race" });
    const fotos = dlg.querySelector(".cmp-fotos") as HTMLElement;
    expect(fotos.classList.contains("varias")).toBe(true);
    const [juego, clasica] = opciones(dlg) as [HTMLButtonElement, HTMLButtonElement];
    expect(opciones(dlg)).toHaveLength(2);
    expect(juego.getAttribute("aria-label")).toBe("Foto con el juego");
    expect(clasica.getAttribute("aria-label")).toBe("Foto clásica");
    expect(juego.getAttribute("aria-pressed")).toBe("true");
    expect(clasica.getAttribute("aria-pressed")).toBe("false");
    expect(juego.type).toBe("button");
    expect(juego.querySelector("img.cmp-png")).not.toBeNull();
    expect(dlg.querySelector<HTMLButtonElement>("[data-bajar]")?.textContent).toBe("Descargar la foto");
    // La foto del juego se pidió con el fondo del juego; la clásica, sin.
    expect(h.fondo.mock.calls.some((c) => c[1] === "race")).toBe(true);
  });

  it("descargar baja solo la elegida: primero la del juego, y la clásica si se toca", async () => {
    const dlg = await abrir({ juego: "race" });
    const bajar = dlg.querySelector<HTMLButtonElement>("[data-bajar]") as HTMLButtonElement;
    bajar.click();
    expect(bajadas).toEqual(["tinkazo-sorteo-278-juego.png"]);
    const [juego, clasica] = opciones(dlg) as [HTMLButtonElement, HTMLButtonElement];
    clasica.click();
    expect(clasica.getAttribute("aria-pressed")).toBe("true");
    expect(juego.getAttribute("aria-pressed")).toBe("false");
    bajar.click();
    expect(bajadas).toEqual(["tinkazo-sorteo-278-juego.png", "tinkazo-sorteo-278.png"]);
  });

  it("WhatsApp con la hoja del sistema: solo la elegida, con el mismo mensaje", async () => {
    const share = vi.fn(async (_d: ShareData) => undefined);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { canShare: () => true, share }));
    const dlg = await abrir({ juego: "race" });
    const wa = dlg.querySelector<HTMLButtonElement>("[data-whatsapp]") as HTMLButtonElement;
    wa.click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const primera = share.mock.calls[0]?.[0] as ShareData;
    expect(primera.files?.map((f) => f.name)).toEqual(["tinkazo-sorteo-278-juego.png"]);
    expect(primera.text).toBe((dlg.querySelector("#cmp-txt") as HTMLTextAreaElement).value);
    (opciones(dlg)[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(wa.disabled).toBe(false));
    await new Promise((r) => setTimeout(r, 0));
    wa.click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect((share.mock.calls[1]?.[0] as ShareData).files?.map((f) => f.name)).toEqual(["tinkazo-sorteo-278.png"]);
  });

  it("en la computadora, sin hoja del sistema: copia la elegida y no baja nada", async () => {
    const write = vi.fn(async () => undefined);
    class Item {
      constructor(public datos: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { canShare: undefined, clipboard: { write } }));
    const dlg = await abrir({ juego: "race" });
    (opciones(dlg)[1] as HTMLButtonElement).click();
    (dlg.querySelector("[data-whatsapp]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item = (write.mock.calls[0] as unknown as [Item[]])[0][0] as Item;
    expect((item.datos["image/png"] as File).name).toBe("tinkazo-sorteo-278.png");
    expect(bajadas).toEqual([]);
  });

  it("sin juego: la foto de siempre, sola, sin nada que elegir (S5)", async () => {
    h.fondo.mockClear();
    const dlg = await abrir({});
    expect(opciones(dlg)).toEqual([]);
    expect(dlg.querySelectorAll(".cmp-fotos img.cmp-png")).toHaveLength(1);
    expect(dlg.querySelector(".cmp-fotos")?.classList.contains("varias")).toBe(false);
    expect(h.fondo).not.toHaveBeenCalled();
    (dlg.querySelector("[data-bajar]") as HTMLButtonElement).click();
    expect(bajadas).toEqual(["tinkazo-sorteo-278.png"]);
  });

  it("un juego sin ilustración: también la de siempre, sola", async () => {
    const dlg = await abrir({ juego: "trompo" });
    expect(opciones(dlg)).toEqual([]);
    expect(dlg.querySelectorAll(".cmp-fotos img.cmp-png")).toHaveLength(1);
  });

  it("un evento en varias partes: las fotos de siempre, sin elegir, y se bajan y comparten todas", async () => {
    const { abrirCompartir, fotoDeSorteo } = await import("./compartir");
    const share = vi.fn(async (_d: ShareData) => undefined);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { canShare: () => true, share }));
    const f = fotoDeSorteo("es", datos, enlace);
    abrirCompartir({ titulo: "Evento", preparar: async () => ({ mensaje: "m", fotos: [f, f], archivo: "tinkazo-ev", corto: false }), medir: { evento: true } }, "es");
    const dlg = document.querySelector("dialog") as HTMLDialogElement;
    await vi.waitFor(() => expect(dlg.querySelector<HTMLButtonElement>("[data-whatsapp]")?.disabled).toBe(false));
    expect(opciones(dlg)).toEqual([]);
    expect(dlg.querySelectorAll(".cmp-fotos > img.cmp-png")).toHaveLength(2);
    expect(dlg.querySelector<HTMLButtonElement>("[data-bajar]")?.textContent).toBe("Descargar las fotos");
    (dlg.querySelector("[data-bajar]") as HTMLButtonElement).click();
    expect(bajadas).toEqual(["tinkazo-ev-1.png", "tinkazo-ev-2.png"]);
    (dlg.querySelector("[data-whatsapp]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect((share.mock.calls[0]?.[0] as ShareData).files).toHaveLength(2);
  });

  it("los eventos no llevan foto del juego", async () => {
    // El enlace del evento comprime con `Blob.stream`, que el Blob de jsdom no tiene.
    vi.stubGlobal("Blob", BlobDeNode);
    const { prepararEvento } = await import("./compartir");
    const r = await prepararEvento("Meetup", [{ v: 2, names: ["a", "b"], round: 1, signature: "ab".repeat(48), ganadores: ["a"] } as never], "es", { corto: false, base: "https://tinkazo.app" });
    expect("juego" in r).toBe(false);
  });

  it("Mis sorteos y la página de verificación no pasan el juego (S5)", async () => {
    const { datosDeComprobante } = await import("./compartir");
    const d = datosDeComprobante({ v: 2, names: ["a", "b"], round: 1, signature: "ab".repeat(48) } as never, enlace, ["a"]);
    expect("juego" in d).toBe(false);
    for (const archivo of ["src/verify.ts", "src/ui/history.ts"]) expect(readFileSync(archivo, "utf8")).not.toMatch(/\bjuego\s*:/);
  });
});

/* ------------------------------------------------------------- el sorteo: el juego que se jugó */

describe("el sorteo pasa a compartir el juego que de verdad se jugó", () => {
  beforeEach(async () => {
    vi.resetModules();
    s.abrir.mockReset();
    s.pixi = false;
    s.pixiAnda = true;
    vi.doMock("./compartir", () => ({ abrirSorteo: (...a: unknown[]) => s.abrir(...a) }));
    vi.doMock("./anchor", () => ({
      cuentaPatrocinada: async () => true,
      drawOnChain: async () => undefined,
      escribirError: async () => undefined,
      limpiarDetalle: () => undefined,
      readDraw: async () => null,
      showTxStatus: () => undefined,
      stepLabel: (p: string) => p,
    }));
    vi.doMock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
    vi.doMock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
    vi.doMock("../protocol/drand", () => ({ decompressG1: (x: string) => x }));
    vi.doMock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
    vi.doMock("./freeze", () => ({
      rotarJuego: () => undefined,
      secondsToRound: () => 0,
      unfreeze: () => undefined,
      alElegirDespuesDelResultado: () => undefined,
      irAlSelectorParaOtro: () => undefined,
      juegoParaVerDeNuevo: (g: Game) => {
        if (s.app) s.app.game = g;
      },
      marcarShow: () => undefined,
      pintarNotaDelJuego: () => undefined,
    }));
    vi.doMock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
    vi.doMock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
    vi.doMock("./wallet-ui", () => ({ currentSession: () => null }));
    vi.doMock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
    vi.doMock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
    vi.doMock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
    vi.doMock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
    vi.doMock("../games/engine", () => ({ usePixi: () => s.pixi }));
    vi.doMock("../games/lore", () => ({ loreFor: () => null }));
    vi.doMock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
    vi.doMock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
    vi.doMock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => undefined }));
    vi.doMock("../enlace-corto", () => ({ acortar: async () => null, alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));
    const termina = (...a: unknown[]): void => (a[3] as () => void)();
    vi.doMock("../games/race", () => ({ stadiumRace: termina }));
    vi.doMock("../games/wheel", () => ({ wheelSpin: termina }));
    vi.doMock("../games/tombola", () => ({ tombola: termina }));
    vi.doMock("../games/pixi", () => ({
      playPixi: async (_g: Game, _n: string[], _w: number[], _b: unknown, done: () => void) => {
        if (!s.pixiAnda) return false;
        done();
        return true;
      },
    }));
    document.body.innerHTML = `<div id="lore-box"></div><div id="leyenda-box"></div><button id="btn-replay"></button>`;
  });
  afterEach(() => {
    for (const m of ["./compartir", "./anchor", "./proteger-flujo", "./siguiente", "../protocol/drand", "../protocol/firma", "./freeze", "./pantalla-completa", "./gamecard", "./wallet-ui", "./qr", "./leyenda", "./participants", "./premios", "../games/engine", "../games/lore", "../games/overlay", "../music", "../sound", "../enlace-corto", "../games/race", "../games/wheel", "../games/tombola", "../games/pixi"]) vi.doUnmock(m);
  });

  async function preparar(game: Game, personas = 3): Promise<typeof import("./draw")> {
    const { app } = await import("../state");
    s.app = app;
    app.game = game;
    app.frozen = { names: Array.from({ length: personas }, (_, i) => `P${i}`), listHash: "00".repeat(32), ts: 1_792_600_000, at: "", prize: "Pizza", round: 7 } as never;
    app.drawn = { beacon: { round: 7, randomness: "00".repeat(32), signature: "01".repeat(48) }, winners: [0] };
    return import("./draw");
  }

  /** Lo que el sorteo le pasa a compartir. */
  async function compartido(d: typeof import("./draw")): Promise<Record<string, unknown>> {
    s.abrir.mockReset();
    d.shareProof();
    await vi.waitFor(() => expect(s.abrir).toHaveBeenCalledTimes(1));
    return s.abrir.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  async function verlo(d: typeof import("./draw"), juego?: Game): Promise<void> {
    d.verDeNuevo(juego);
    // Termina el show: el botón de repetir vuelve.
    await vi.waitFor(() => expect((document.getElementById("btn-replay") as HTMLButtonElement).disabled).toBe(false));
  }

  it("sin que se haya jugado nada, no pasa juego", async () => {
    const d = await preparar("race");
    expect("juego" in (await compartido(d))).toBe(false);
  });

  it("el motor de respaldo cuenta el sapo como carrera: pasa la carrera, no el sapo", async () => {
    const d = await preparar("sapo");
    await verlo(d);
    expect((await compartido(d)).juego).toBe("race");
  });

  it("el motor nuevo con la ruleta y demasiada gente juega la tómbola: pasa la tómbola", async () => {
    s.pixi = true;
    const d = await preparar("wheel", 201);
    await verlo(d);
    expect((await compartido(d)).juego).toBe("tombola");
  });

  it("si el motor nuevo no arranca, pasa el juego del de respaldo", async () => {
    s.pixi = true;
    s.pixiAnda = false;
    const d = await preparar("trompo");
    await verlo(d);
    expect((await compartido(d)).juego).toBe("race");
  });

  it("visto de nuevo con otro juego, pasa el último que se jugó", async () => {
    s.pixi = true;
    const d = await preparar("trompo");
    await verlo(d);
    expect((await compartido(d)).juego).toBe("trompo");
    await verlo(d, "wheel");
    expect((await compartido(d)).juego).toBe("wheel");
  });
});
