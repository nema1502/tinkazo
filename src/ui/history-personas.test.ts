// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";

/**
 * Mis sorteos con una campaña de personas. Quien organiza sortea con la lista de líneas de persona, y esas líneas
 * nunca se ven: ni en la tarjeta, ni en el detalle del evento, ni en el archivo que se baja, ni en lo que se comparte,
 * ni en lo que queda guardado en el navegador. Se ve el nombre, o el lugar en la lista.
 */

const h = vi.hoisted(() => ({ evento: vi.fn(), sorteo: vi.fn() }));
vi.mock("./compartir", () => ({
  compartirEvento: (...a: unknown[]) => h.evento(...a),
  compartirSorteo: (...a: unknown[]) => h.sorteo(...a),
}));

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const AHORA = 1_790_000_000;
const LINEAS = [lineaDePrueba(1), lineaDePrueba(2), lineaDePrueba(3), lineaDePrueba(4)];

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

/** La fila que anota el sorteo al revelar el resultado: los ganadores son las líneas de la lista sellada, tal cual. */
const sorteoDePersonas = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  organizer: WHO,
  listHash: "ab".repeat(32),
  count: LINEAS.length,
  numWinners: 2,
  round: 77,
  sealedAt: AHORA - 120,
  prize: "Auriculares",
  names: LINEAS,
  winners: [LINEAS[2], LINEAS[0]],
  id: "9",
  proof: "https://tinkazo.app/verificar.html#rPRUEBA",
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA * 1000);
  localStorage.clear();
  sessionStorage.clear();
  h.evento.mockReset();
  h.sorteo.mockReset();
  history.replaceState(null, "", "/?lang=es");
  document.body.innerHTML = `<div id="pendiente" style="display:none"></div>${seccionDeMisSorteos()}`;
  vi.stubGlobal("CompressionStream", undefined);
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function pintar(entrada: Record<string, unknown>): Promise<typeof import("./history")> {
  const hist = await import("./history");
  hist.remember(entrada as never);
  hist.renderHistory(WHO);
  return hist;
}

const tarjeta = (): HTMLElement => document.querySelector<HTMLElement>("#hist-list article") as HTMLElement;

describe("Mis sorteos con una lista de personas", () => {
  it("sin nombres, la tarjeta dice el lugar en la lista y nunca la línea", async () => {
    const { winnerLabel } = await pintar(sorteoDePersonas());
    expect(tarjeta().textContent).toContain("Lugar 3 de la lista, Lugar 1 de la lista");
    expect(tarjeta().innerHTML).not.toContain("p1:");
    const guardada = JSON.parse(localStorage.getItem(Object.keys(localStorage)[0] ?? "") ?? "[]")[0];
    expect(winnerLabel(guardada)).toBe("Lugar 3 de la lista, Lugar 1 de la lista");
  });

  it("con los nombres de esta pestaña, dice el nombre", async () => {
    const { ponerEtiquetas } = await import("../equipos/etiquetas");
    ponerEtiquetas(new Map([[LINEAS[2] as string, "Nora"]]), "personas");
    await pintar(sorteoDePersonas());
    expect(tarjeta().textContent).toContain("Nora, Lugar 1 de la lista");
    expect(tarjeta().innerHTML).not.toContain("p1:");
  });

  it("nada de lo guardado en el navegador lleva una línea", async () => {
    await pintar(sorteoDePersonas());
    const guardado = JSON.stringify(JSON.parse(localStorage.getItem(Object.keys(localStorage)[0] ?? "") ?? "[]"), (k, v) =>
      k === "names" ? undefined : v,
    );
    expect(guardado).not.toContain("p1:");
  });

  it("el archivo que se baja no lleva la línea de quienes ganaron", async () => {
    const hist = await pintar(sorteoDePersonas());
    const csv = hist.toCsv(WHO);
    expect(csv).toContain("Lugar 3 de la lista | Lugar 1 de la lista");
    expect(csv).not.toContain("p1:");
  });

  it("lo que se comparte lleva el lugar y no la línea", async () => {
    await pintar(sorteoDePersonas());
    tarjeta().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    expect(h.sorteo).toHaveBeenCalledTimes(1);
    const [, ganadores] = h.sorteo.mock.calls[0] as [string, string[]];
    expect(ganadores).toEqual(["Lugar 3 de la lista", "Lugar 1 de la lista"]);
    expect(JSON.stringify(ganadores)).not.toContain("p1:");
  });

  it("se anota en dos tiempos, al sellar y al sortear, y no vuelve la línea", async () => {
    const hist = await import("./history");
    const { winners: _w, ...alSellar } = sorteoDePersonas();
    hist.remember(alSellar as never);
    hist.remember(sorteoDePersonas() as never);
    hist.renderHistory(WHO);
    expect(document.querySelectorAll("#hist-list article").length).toBe(1);
    expect(tarjeta().innerHTML).not.toContain("p1:");
    expect(tarjeta().textContent).toContain("Lugar 3 de la lista");
  });

  it("una lista de cuentas sigue anotándose como siempre", async () => {
    const hist = await pintar(sorteoDePersonas({ names: ["Ana", "Beto", "Carla", "Diego"], winners: ["Carla", "Ana"] }));
    expect(tarjeta().textContent).toContain("Carla, Ana");
    expect(hist.toCsv(WHO)).toContain("Carla | Ana");
  });
});

/**
 * El archivo que se baja se abre en una planilla, y una planilla ejecuta como fórmula lo que empieza con =, +, -, @, una
 * tabulación o un retorno de carro. En una campaña de personas el nombre de quien ganó lo eligió cada persona en su cuenta,
 * así que esos valores llevan un apóstrofo adelante, en todas las columnas. Lo demás del archivo no cambia.
 */
describe("el archivo de Mis sorteos y las fórmulas de una planilla", () => {
  const CABECERA = '"id","fecha","cuenta","list_hash","participantes","ganadores","ronda","premio","tx_sello","tx_sorteo","comprobante","origen","contrato"';
  const celdas = (linea: string): string[] => linea.slice(1, -1).split('","');
  const fila = (csv: string): string[] => celdas(csv.split("\n")[1] ?? "");

  it("el nombre de una ganadora que empieza con = sale con un apóstrofo adelante", async () => {
    const etiquetas = await import("../equipos/etiquetas");
    etiquetas.ponerEtiquetas(new Map([[LINEAS[2] as string, "=SUMA(A1:A9)"]]), "personas");
    const hist = await pintar(sorteoDePersonas());
    const csv = hist.toCsv(WHO);
    expect(fila(csv)[5]).toBe("'=SUMA(A1:A9) | Lugar 1 de la lista");
    expect(csv).not.toContain('"=');
    expect(csv).not.toContain("p1:");
  });

  it("vale para cada forma de empezar una fórmula y en todas las columnas", async () => {
    const hist = await import("./history");
    const casos = ["=1+1", "+1+1", "-1+1", "@SUMA(A1)", "\tcmd", "\rcmd"];
    casos.forEach((valor, i) => {
      hist.remember(sorteoDePersonas({ names: [valor, "Beto", "Carla", "Diego"], winners: [valor, "Beto"], prize: valor, id: valor, round: 100 + i }) as never);
    });
    // El retorno de carro va adentro de una celda entre comillas: las filas se separan solo por el salto de línea.
    const filas = hist.toCsv(WHO).split("\n").slice(1);
    expect(filas).toHaveLength(casos.length);
    for (const valor of casos) {
      const suya = filas.map(celdas).find((c) => c[7] === `'${valor}`);
      expect(suya, JSON.stringify(valor)).toBeDefined();
      expect(suya?.[0]).toBe(`'${valor}`);
      expect(suya?.[5]).toBe(`'${valor} | Beto`);
    }
    for (const f of filas) for (const celda of celdas(f)) expect(celda).not.toMatch(/^[=+\-@\t\r]/u);
  });

  it("un signo que no está al principio de la celda queda como estaba", async () => {
    const hist = await pintar(sorteoDePersonas({ names: ["Ana", "=1+1", "Carla", "Diego"], winners: ["Ana", "=1+1"], prize: "2 + 2 = 4" }));
    const celda = fila(hist.toCsv(WHO));
    expect(celda[5]).toBe("Ana | =1+1");
    expect(celda[7]).toBe("2 + 2 = 4");
  });

  it("un sorteo de nombres comunes sale igual que siempre, letra por letra", async () => {
    const hist = await pintar(sorteoDePersonas({ names: ["Ana", "Beto", "Carla", "Diego"], winners: ["Carla", 'Ana "la'], prize: "Auriculares, x2" }));
    expect(hist.toCsv(WHO)).toBe(
      [
        CABECERA,
        `"9","${new Date((AHORA - 120) * 1000).toISOString()}","${WHO}","${"ab".repeat(32)}","4","Carla | Ana ""la","77","Auriculares, x2","","","https://tinkazo.app/verificar.html#rPRUEBA","equipo",""`,
      ].join("\n"),
    );
  });
});
