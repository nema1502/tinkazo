// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Con una campaña viva en este navegador, el stand y el ejemplo no tocan el cuadro de la lista: ninguno entra, avisan en una línea y
 * la lista queda como estaba. Fuera de una campaña entran como siempre (`?stand` y el ejemplo siguen andando).
 *
 * El HTML es el de verdad y la lista y los modos también. La cuenta, el sello, el show y la barra de pasos van de mentira.
 */

const h = vi.hoisted(() => ({ campana: false }));
vi.mock("../campana/en-curso", () => ({ hayCampanaActiva: () => h.campana }));
vi.mock("./wallet-ui", () => ({
  MARCA_INGRESAR: "tinkazo.abrir",
  currentSession: () => ({ address: "Cuenta de prueba" }),
  refrescarPuerta: vi.fn(),
}));
vi.mock("./freeze", () => ({
  GUARDA_DESPUES_DE_SOLTAR_MS: 700,
  refreshFreezeLabel: vi.fn(),
  rotarJuego: vi.fn(),
  unfreeze: vi.fn(),
}));
vi.mock("./draw", () => ({ newDraw: vi.fn(), elegirOtroJuegoParaVer: vi.fn() }));
vi.mock("./siguiente", () => ({ actualizarPaso: vi.fn() }));

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const LISTA = "Ana\nBeto\nCarla";

type Pagina = {
  p: typeof import("./participants");
  stand: typeof import("./stand");
  ensayo: typeof import("./ensayo");
  modo: typeof import("../ensayo-modo");
  i18n: typeof import("../i18n");
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const cuadro = (): HTMLTextAreaElement => el<HTMLTextAreaElement>("ta");

async function cargar(hash = "#sortear"): Promise<Pagina> {
  vi.resetModules();
  document.body.removeAttribute("data-stand");
  document.body.removeAttribute("data-ensayo");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  vi.stubGlobal("location", { search: "", pathname: "/", hash, reload: vi.fn() });
  vi.stubGlobal("scrollTo", () => undefined);
  const [p, stand, ensayo, modo, i18n] = await Promise.all([
    import("./participants"),
    import("./stand"),
    import("./ensayo"),
    import("../ensayo-modo"),
    import("../i18n"),
  ]);
  i18n.setLang("es");
  p.bindParticipants();
  cuadro().value = LISTA;
  p.renderNames();
  return { p, stand, ensayo, modo, i18n };
}

afterEach(() => {
  h.campana = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.removeAttribute("data-stand");
  document.body.removeAttribute("data-ensayo");
  document.body.innerHTML = "";
});

describe("el stand y el ejemplo no pisan la lista de una campaña", () => {
  it("con una campaña viva Tengo un stand no entra, no vacía el cuadro y avisa", async () => {
    const pg = await cargar();
    h.campana = true;
    pg.stand.entrarAlStand();
    expect(pg.modo.enStand()).toBe(false);
    expect(document.body.dataset.stand).toBeUndefined();
    expect(cuadro().value).toBe(LISTA);
    expect(el("stand-aviso").hidden).toBe(false);
    expect(el("stand-aviso").textContent).toBe(pg.i18n.T.es.campanaNoPisa);
    expect(pg.i18n.T.en.campanaNoPisa).toBe("A campaign is in progress. Finish it before opening booth mode or the example.");
  });

  it("con una campaña viva el ejemplo no entra y deja la lista como estaba", async () => {
    const pg = await cargar();
    h.campana = true;
    pg.ensayo.entrarAlEnsayo();
    expect(pg.modo.enEnsayo()).toBe(false);
    expect(document.body.dataset.ensayo).toBeUndefined();
    expect(cuadro().value).toBe(LISTA);
    expect(el("stand-aviso").hidden).toBe(false);
  });

  it("desde la portada el aviso lleva a la herramienta", async () => {
    const pg = await cargar("");
    h.campana = true;
    const replace = vi.spyOn(history, "replaceState");
    pg.ensayo.entrarAlEnsayo();
    expect(replace).toHaveBeenCalledWith(null, "", "/#sortear");
  });

  it("sin campaña el stand entra y arranca con el cuadro vacío", async () => {
    const pg = await cargar();
    pg.stand.entrarAlStand();
    expect(pg.modo.enStand()).toBe(true);
    expect(cuadro().value).toBe("");
    expect(el("stand-aviso").hidden).toBe(true);
  });

  it("sin campaña el ejemplo entra y monta la lista de ejemplo", async () => {
    const pg = await cargar();
    pg.ensayo.entrarAlEnsayo();
    expect(pg.modo.enEnsayo()).toBe(true);
    expect(cuadro().value).toBe(pg.modo.LISTA_ENSAYO.join("\n"));
  });
});
