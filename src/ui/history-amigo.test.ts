// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { decodeAmigo } from "../protocol/proof";

/**
 * Mis sorteos con un Amigo secreto. Sus lugares (`winnerIdx`, de este equipo o de la cadena) son el reparto: la tarjeta
 * y el archivo que se baja no los muestran, el sorteo no entra a un evento, y si la pestaña se cerró mientras se
 * mandaban los enlaces, se vuelven a armar desde la tarjeta sin abrir el comprobante.
 */

const h = vi.hoisted(() => ({ escribir: vi.fn(async (_: string) => undefined), evento: vi.fn(), sorteo: vi.fn() }));
vi.mock("./compartir", () => ({
  compartirEvento: (...a: unknown[]) => h.evento(...a),
  compartirSorteo: (...a: unknown[]) => h.sorteo(...a),
}));

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const AHORA = 1_790_000_000;
const NOMBRES = ["Ana", "Beto", "Carla", "Diego"];
/** El orden sorteado: Diego, Ana, Beto y Carla. Diego le regala a Ana, Ana a Beto, Beto a Carla y Carla a Diego. */
const SORTEADO = [3, 0, 1, 2];

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

/** Un Amigo secreto sellado en este navegador hace un rato, con lo que se pase encima. */
const amigo = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  organizer: WHO,
  listHash: "ab".repeat(32),
  count: 4,
  numWinners: 4,
  round: 77,
  sealedAt: AHORA - 120,
  prize: "Amigo secreto",
  names: NOMBRES,
  id: "9",
  proof: "https://tinkazo.app/verificar.html#rPRUEBA",
  ...over,
});

async function pintar(entrada: Record<string, unknown>): Promise<typeof import("./history")> {
  const hist = await import("./history");
  hist.remember(entrada as never);
  hist.renderHistory(WHO);
  return hist;
}

const tarjeta = (): HTMLElement => document.querySelector<HTMLElement>("#hist-list article") as HTMLElement;
const filas = (): HTMLLIElement[] => [...tarjeta().querySelectorAll<HTMLLIElement>(".amigo-fila")];
const copiado = (): string => String(h.escribir.mock.calls.at(-1)?.[0] ?? "");

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA * 1000);
  localStorage.clear();
  h.escribir.mockReset();
  h.escribir.mockImplementation(async () => undefined);
  h.evento.mockReset();
  h.sorteo.mockReset();
  history.replaceState(null, "", "/?lang=es");
  document.body.innerHTML = `<div id="pendiente" style="display:none"></div>${seccionDeMisSorteos()}`;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: (s: string) => h.escribir(s) }, configurable: true });
  // Los enlaces sin comprimir: jsdom no sabe leer un archivo como flujo.
  vi.stubGlobal("CompressionStream", undefined);
  // La cadena no contesta: lo que se mira es lo de este navegador.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("la tarjeta de un Amigo secreto no muestra el reparto", () => {
  it("con sus lugares dice cuántas personas son, sin puestos ni palabras de ganar", async () => {
    const { winnerLabel } = await import("./history");
    const e = amigo({ winnerIdx: SORTEADO }) as never;
    expect(winnerLabel(e)).toBe("4 personas");
    await pintar(amigo({ winnerIdx: SORTEADO }));
    const meta = tarjeta().querySelector(".hc-meta")?.textContent ?? "";
    expect(meta).toContain("4 personas");
    expect(meta).not.toMatch(/nº|#4, 1|ganó|ganaron/);
  });

  it("sorteado y todavía sin lugares (solo la grabación), no dice que falta sortear", async () => {
    const { winnerLabel } = await import("./history");
    expect(winnerLabel(amigo({ drawTx: "cd".repeat(32) }) as never)).toBe("4 personas");
    expect(winnerLabel(amigo({ drawTx: "cd".repeat(32) }) as never)).not.toBe(T.es.histPending);
  });

  it("el archivo que se baja deja vacía la columna de quiénes salieron", async () => {
    const hist = await pintar(amigo({ winnerIdx: SORTEADO }));
    const fila = hist.toCsv(WHO).split("\n")[1] ?? "";
    const columnas = fila.split('","');
    expect(columnas[5]).toBe("");
    expect(fila).not.toContain("#4");
  });

  it("no entra al evento del día junto a un sorteo común: el evento lo listaría en el orden sorteado", async () => {
    const hist = await import("./history");
    hist.remember(amigo({ winnerIdx: SORTEADO, listHash: "cd".repeat(32) }) as never);
    const comun = { listHash: "ef".repeat(32), count: 2, numWinners: 1, prize: "Termo", names: ["Ana", "Beto"], winners: ["Ana"] };
    await pintar({ ...amigo(), ...comun, id: "10", proof: "https://tinkazo.app/verificar.html#rOTRO" });
    const tarjetas = [...document.querySelectorAll<HTMLElement>("#hist-list article")];
    const delAmigo = tarjetas.find((a) => a.querySelector("h3")?.textContent === "Amigo secreto");
    const delTermo = tarjetas.find((a) => a.querySelector("h3")?.textContent === "Termo");
    expect(delAmigo?.closest(".hist-grupo")).toBeNull();
    expect(delTermo?.closest(".hist-grupo")?.querySelectorAll("article").length).toBe(1);
  });
});

describe("un Amigo secreto ya sorteado en Mis sorteos", () => {
  it("con sus lugares no se ofrece retomar como si no se hubiera sorteado", async () => {
    await pintar(amigo({ winnerIdx: SORTEADO }));
    expect(document.getElementById("pendiente")?.style.display).toBe("none");
    expect(tarjeta().querySelector("[data-retomar]")).toBeNull();
  });

  it("si la grabación se cortó, se puede terminar de guardar: le alcanzan sus lugares", async () => {
    const { falteGrabar } = await import("./history");
    expect(falteGrabar(amigo({ winnerIdx: SORTEADO, porGrabar: true }) as never)).toBe(true);
  });

  it("los enlaces se vuelven a armar en el orden pegado, y cada uno copia el de su persona", async () => {
    await pintar(amigo({ winnerIdx: SORTEADO }));
    tarjeta().querySelector<HTMLButtonElement>("[data-amigo-enlaces]")?.click();
    await vi.waitFor(() => expect(filas().every((li) => !li.querySelector("button")?.disabled)).toBe(true));
    expect(filas().map((li) => li.querySelector(".winner-name")?.textContent)).toEqual(NOMBRES);
    const esperado: Record<string, string> = { Diego: "Ana", Ana: "Beto", Beto: "Carla", Carla: "Diego" };
    for (const li of filas()) {
      const nombre = li.querySelector(".winner-name")?.textContent ?? "";
      li.querySelector<HTMLButtonElement>("[data-amigo-copiar]")?.click();
      await vi.waitFor(() => expect(copiado()).toContain("/confirmar.html#"));
      const parte = await decodeAmigo(copiado().split("#")[1] ?? "");
      expect(parte.from).toBe(nombre);
      expect(parte.to).toBe(esperado[nombre]);
      expect(parte.round).toBe(77);
    }
  });

  it("lo ya copiado sigue en Copiado aunque Mis sorteos se vuelva a pintar", async () => {
    const hist = await pintar(amigo({ winnerIdx: SORTEADO }));
    tarjeta().querySelector<HTMLButtonElement>("[data-amigo-enlaces]")?.click();
    await vi.waitFor(() => expect(filas()[1]?.querySelector("button")?.disabled).toBe(false));
    filas()[1]?.querySelector<HTMLButtonElement>("button")?.click();
    await vi.waitFor(() => expect(filas()[1]?.classList.contains("copiado")).toBe(true));
    hist.renderHistory(WHO);
    expect(filas()[1]?.querySelector("button")?.textContent).toBe(T.es.copied);
    expect(filas()[0]?.querySelector("button")?.textContent).toBe(T.es.amigoCopiar);
  });
});
