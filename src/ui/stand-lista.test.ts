// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** El modo stand con el cuadro de verdad: su resumen y la lista que se puede llevar a un sorteo. */

const h = vi.hoisted(() => ({ recargar: vi.fn() }));
vi.mock("./wallet-ui", () => ({
  MARCA_INGRESAR: "tinkazo.abrir",
  currentSession: () => ({ address: "Cuenta de prueba" }),
  refrescarPuerta: vi.fn(),
}));
vi.mock("./freeze", () => ({ refreshFreezeLabel: vi.fn(), rotarJuego: vi.fn() }));
vi.mock("./draw", () => ({ newDraw: vi.fn() }));
vi.mock("./siguiente", () => ({ actualizarPaso: vi.fn() }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const CLAVE = "tinkazo.stand-lista";
const BORRADOR = "tinkazo.borrador";
const cuadro = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
const resumen = (): HTMLElement => document.getElementById("sellar-resumen") as HTMLElement;
const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");

async function montar(lista: string, enStand = true, search = "") {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  history.replaceState(null, "", "/#sortear");
  h.recargar = vi.fn();
  vi.stubGlobal("location", { search, pathname: "/", hash: "#sortear", reload: h.recargar });
  const [p, stand, modo, i18n] = await Promise.all([
    import("./participants"),
    import("./stand"),
    import("../ensayo-modo"),
    import("../i18n"),
  ]);
  i18n.setLang("es");
  modo.marcarStand(enStand);
  cuadro().value = lista;
  p.renderNames();
  return { p, stand, modo, i18n };
}

function poner(p: typeof import("./participants"), lista: string): void {
  cuadro().value = lista;
  p.renderNames();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("el resumen de la ronda de ejemplo", () => {
  it("cuenta personas sin hablar de ganadores, premios ni sello, en los dos idiomas", async () => {
    const { p, modo, i18n } = await montar("Ana\nBeto");
    expect(resumen().textContent).toBe("2 personas en la ronda");
    expect(resumen().textContent).not.toMatch(/ganador|premio|sellar/i);
    poner(p, "Ana");
    expect(resumen().textContent).toBe("1 persona en la ronda");
    poner(p, "Ana\nBeto");

    i18n.setLang("en");
    p.renderNames();
    expect(resumen().textContent).toBe("2 people in the round");
    expect(resumen().textContent).not.toMatch(/winner|prize|seal/i);

    poner(p, "Ana");
    expect(resumen().style.display).toBe("");
    expect(resumen().textContent).toBe("1 person in the round");

    // Fuera del stand, el resumen de siempre queda igual.
    modo.marcarStand(false);
    i18n.setLang("es");
    poner(p, "Ana\nBeto");
    expect(resumen().textContent).toBe(i18n.T.es.sellarResumen(2, 1, ""));
    expect(resumen().textContent).toContain("1 ganador");
    expect(resumen().textContent).toContain("Al sellar");
  });
});

describe("llevar la lista del stand al sorteo de verdad", () => {
  it("con dos nombres pregunta, avisa qué borrador reemplaza y guarda el texto antes de recargar", async () => {
    const { stand, i18n } = await montar("Llama Lupe\nCóndor Beto\nVicuña Vale");
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: "Ana\nBeto", premio: "Termo" }));

    const salida = stand.salirDelStand();
    expect(dialogo()).not.toBeNull();
    expect(dialogo()?.textContent).toContain(i18n.t("standLlevarReemplaza"));
    expect(h.recargar).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CLAVE)).toBeNull();

    (dialogo()?.querySelector(".dlg-main") as HTMLButtonElement).click();
    await salida;
    expect(sessionStorage.getItem(CLAVE)).toBe("Llama Lupe\nCóndor Beto\nVicuña Vale");
    expect(h.recargar).toHaveBeenCalledTimes(1);
  });

  it("con un borrador ilegible avisa que la lista del stand lo reemplaza", async () => {
    const { stand, i18n } = await montar("Llama Lupe\nCóndor Beto");
    sessionStorage.setItem(BORRADOR, "{no se puede leer");

    const salida = stand.salirDelStand();
    expect(dialogo()?.textContent).toContain(i18n.t("standLlevarReemplaza"));
    (dialogo()?.querySelector('[data-dlg="x"]') as HTMLButtonElement).click();
    await salida;
  });

  it("si no se puede guardar avisa, conserva la lista y no recarga", async () => {
    const lista = "Llama Lupe\nCóndor Beto\nVicuña Vale";
    const { stand, modo, i18n } = await montar(lista);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, clave: string, valor: string) {
      if (clave === CLAVE) throw new Error("almacenamiento lleno");
      original.call(this, clave, valor);
    });

    const salida = stand.salirDelStand();
    (dialogo()?.querySelector(".dlg-main") as HTMLButtonElement).click();
    await salida;

    expect(h.recargar).not.toHaveBeenCalled();
    expect(cuadro().value).toBe(lista);
    expect(modo.enStand()).toBe(true);
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    const aviso = document.getElementById("sala-error");
    expect(aviso?.hidden).toBe(false);
    expect(aviso?.textContent).toBe(i18n.t("standLlevarError"));
    expect(i18n.T.en.standLlevarError).toBe("The list could not be carried into the draw. Copy it by hand: it is still in the box.");
  });

  it("salir sin llevarla conserva el borrador anterior y no escribe la clave", async () => {
    const { stand } = await montar("Llama Lupe\nCóndor Beto");
    const anterior = JSON.stringify({ texto: "Ana\nBeto", premio: "Termo" });
    sessionStorage.setItem(BORRADOR, anterior);

    const salida = stand.salirDelStand();
    (dialogo()?.querySelector(".dlg-pie .mini") as HTMLButtonElement).click();
    await salida;
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    expect(sessionStorage.getItem(BORRADOR)).toBe(anterior);
    expect(h.recargar).toHaveBeenCalledTimes(1);
  });

  it("cerrar la pregunta no recarga ni guarda nada", async () => {
    const { stand } = await montar("Llama Lupe\nCóndor Beto");
    const salida = stand.salirDelStand();
    (dialogo()?.querySelector('[data-dlg="x"]') as HTMLButtonElement).click();
    await salida;
    expect(dialogo()).toBeNull();
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    expect(h.recargar).not.toHaveBeenCalled();
  });

  it("con menos de dos nombres sale directamente y sin escribir la clave", async () => {
    const { stand } = await montar("Llama Lupe");
    await stand.salirDelStand();
    expect(dialogo()).toBeNull();
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    expect(h.recargar).toHaveBeenCalledTimes(1);
  });

  it("en la demo no se puede entrar al stand ni escribir la lista", async () => {
    const { stand, modo } = await montar("Llama Lupe\nCóndor Beto", false, "?demo=wheel");
    const escrituras = vi.spyOn(Storage.prototype, "setItem");

    stand.entrarAlStand();

    expect(modo.enStand()).toBe(false);
    expect(dialogo()).toBeNull();
    expect(escrituras).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
    expect(h.recargar).not.toHaveBeenCalled();
  });

  it("la página nueva pone la lista llevada y borra la clave en esa misma lectura", async () => {
    const { p, modo } = await montar("");
    // La recarga apaga el stand antes de reponer, como en main.ts.
    modo.marcarStand(false);
    sessionStorage.setItem(CLAVE, "Llama Lupe\nCóndor Beto");
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: "Ana\nBeto", premio: "Termo" }));

    p.reponerBorrador();
    expect(cuadro().value).toBe("Llama Lupe\nCóndor Beto");
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
  });
});
