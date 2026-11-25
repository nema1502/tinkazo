// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * La demostración (`?demo=`, con o sin `?n=`) nunca deja un borrador en la pestaña: la lista de ejemplo, de dieciocho o de
 * dos mil nombres, no le aparece después a quien organiza en la misma computadora (la del proyector). Y el borrador de
 * quien no está en la demostración se guarda como siempre.
 */

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
vi.mock("./draw", () => ({ newDraw: vi.fn() }));
vi.mock("./siguiente", () => ({ actualizarPaso: vi.fn() }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const BORRADOR = "tinkazo.borrador";
const cuadro = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;

async function montar(search: string, guardado: string | null = null) {
  vi.resetModules();
  sessionStorage.clear();
  if (guardado !== null) sessionStorage.setItem(BORRADOR, guardado);
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  history.replaceState(null, "", "/#sortear");
  vi.stubGlobal("location", { search, pathname: "/", hash: "#sortear", reload: vi.fn() });
  vi.stubGlobal("scrollTo", () => undefined);
  const [p, estado, i18n] = await Promise.all([import("./participants"), import("../state"), import("../i18n")]);
  i18n.setLang("es");
  return { p, estado };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("la demostración no deja borrador", () => {
  for (const [nombre, search, cantidad] of [
    ["con la lista de siempre", "?demo=wheel", null],
    ["con ?n=18", "?demo=wheel&n=18", 18],
    ["con ?n=2000", "?demo=race&n=2000", 2000],
  ] as const) {
    it(`${nombre}, ni al escribir ni al irse de la página`, async () => {
      vi.useFakeTimers();
      const { p, estado } = await montar(search);
      if (cantidad === null) p.loadSample();
      else p.setList(estado.nombresDeEjemplo(cantidad).join("\n"));
      expect(cuadro().value.length).toBeGreaterThan(0);
      vi.advanceTimersByTime(2000);
      dispatchEvent(new Event("pagehide"));
      p.guardarBorrador();
      p.guardarAntesDelStand();
      expect(sessionStorage.getItem(BORRADOR)).toBeNull();
    });
  }

  it("el borrador de quien organiza en esa misma pestaña ni se pisa ni se borra", async () => {
    vi.useFakeTimers();
    const suyo = JSON.stringify({ texto: "Ana\nBeto", premio: "Termo", nw: 1 });
    const { p, estado } = await montar("?demo=wheel&n=2000", suyo);
    p.setList(estado.nombresDeEjemplo(2000).join("\n"));
    vi.advanceTimersByTime(2000);
    p.olvidarBorrador();
    expect(sessionStorage.getItem(BORRADOR)).toBe(suyo);
  });

  it("al abrir la demostración no se repone un borrador viejo en el cuadro", async () => {
    const suyo = JSON.stringify({ texto: "Ana\nBeto", premio: "Termo", nw: 1 });
    const { p } = await montar("?demo=wheel", suyo);
    p.reponerBorrador();
    expect(cuadro().value).toBe("");
  });

  it("sin demostración, la misma lista sí se guarda: la prueba mira lo que debe", async () => {
    vi.useFakeTimers();
    const { p, estado } = await montar("");
    p.setList(estado.nombresDeEjemplo(30).join("\n"));
    vi.advanceTimersByTime(2000);
    expect(sessionStorage.getItem(BORRADOR)).not.toBeNull();
  });
});
