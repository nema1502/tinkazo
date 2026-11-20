// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";
import { T } from "../i18n";

/**
 * Los números públicos que nacen mientras se espera la ronda elegida (issue #79): el acumulador que los junta por
 * ronda sin repetirlos, el contador de cuántos faltan para la elegida, el pintado en las dos esperas (la caja chica
 * de la página y la espera en grande), y el feed que le pregunta cada ronda al faro. Todo sin red: el faro es
 * `fetchRound` pedido a mano con un `fetchFn` falso o tapado, igual que en la espera de verdad.
 */

/** Una firma de quicknet (96 hex) distinta por ronda, armada a mano: solo sale de la prueba. */
const firma = (round: number): string => round.toString(16).padStart(6, "0") + "ab".repeat(45);

const cajaNueva = (): HTMLElement => {
  const caja = document.createElement("div");
  document.body.appendChild(caja);
  return caja;
};

/** El faro tapado cuando la prueba lo pide (la espera real); sin él, el `fetchRound` de verdad corre igual. */
const h = vi.hoisted(() => ({
  faro: null as null | ((round: number) => Promise<unknown>),
}));
vi.mock("../protocol/quicknet", async (orig) => {
  const o = await orig<typeof import("../protocol/quicknet")>();
  return {
    ...o,
    fetchRound: (...a: unknown[]) => (h.faro ? h.faro(...(a as [number])) : o.fetchRound(...(a as Parameters<typeof o.fetchRound>))),
  };
});
vi.mock("../protocol/firma", () => ({ prepararFirma: () => undefined, verifyRoundAsync: async () => true }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined, puede3D: () => false, usa3D: () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, contarUnaVez: () => undefined, contarPractica: () => undefined, errorContable: (c: string) => c, origenActual: () => "", refDe: () => ({}) }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));

describe("el acumulador de números vistos", () => {
  it("junta cada número público por su ronda, sin repetirlo y siempre en orden", async () => {
    const { numeroVisto } = await import("./freeze");
    let vistos = numeroVisto([], 24, firma(24).slice(0, 8));
    // Nace una ronda más vieja (el desfase del faro la trajo tarde): entra y la lista queda en orden.
    vistos = numeroVisto(vistos, 23, firma(23).slice(0, 8));
    // El mismo número otra vez (el faro repite la ronda, o dos preguntas se cruzaron): no se duplica.
    vistos = numeroVisto(vistos, 24, "xxxxxxxx");
    expect(vistos.map((v) => v.round)).toEqual([23, 24]);
    expect(vistos[1]?.hex).toBe(firma(24).slice(0, 8));
  });
});

describe("el contador de cuántos faltan para la ronda elegida", () => {
  it("cuenta desde el último número visto hasta la ronda elegida", async () => {
    const { faltanParaLaRonda } = await import("./freeze");
    // Si faltan 15 números, la sala lo ve.
    const vistos = [{ round: 10, hex: "a1b2c3d4" }];
    expect(faltanParaLaRonda(vistos, 25)).toBe(15);
    // Con el último visto ya son cero: nunca cuenta al revés.
    expect(faltanParaLaRonda([...vistos, { round: 25, hex: "c3d4e5f6" }], 25)).toBe(0);
    // Si todavía no nació ninguno, no hay contador que calcular por este lado.
    expect(faltanParaLaRonda([], 25)).toBeNull();
  });
});

describe("el número que entrega el faro", () => {
  it("devuelve la ronda con su número público en hex corto", async () => {
    const { pedirNumero } = await import("./freeze");
    const visto = await pedirNumero(1000231, { fetchFn: (async () => new Response(JSON.stringify({ round: 1000231, signature: firma(1000231) }))) as unknown as typeof fetch });
    expect(visto).toEqual({ round: 1000231, hex: firma(1000231).slice(0, 8) });
  });

  it("con la ronda que todavía no nació falla, y el tic vuelve a preguntar un segundo después", async () => {
    const { pedirNumero, ticDeLaEspera } = await import("./freeze");
    // El relay contesta 404 mientras la ronda no nace.
    await expect(pedirNumero(7, { fetchFn: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch })).rejects.toThrow();
    const feed = { elegida: 10, siguiente: 7, inicial: 3, vistos: [] as { round: number; hex: string }[], cuando: 0, enVuelo: false };
    const pedir = vi.fn(async () => Promise.reject(new Error("relay 404")) as never);
    // Antes de la hora de la ronda menos el margen, el tic no pregunta; después sí, y reintenta a un segundo.
    const hora = roundTime(7) * 1000;
    expect(await ticDeLaEspera(feed, { ahora: hora, pedir: pedir as never })).toBeNull();
    expect(pedir).not.toHaveBeenCalled();
    expect(await ticDeLaEspera(feed, { ahora: hora + 1200, pedir: pedir as never })).toBeNull();
    expect(pedir).toHaveBeenCalledTimes(1);
    // Reintento recién un segundo después, no en cada tic.
    expect(await ticDeLaEspera(feed, { ahora: hora + 1400, pedir: pedir as never })).toBeNull();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(await ticDeLaEspera(feed, { ahora: hora + 2300, pedir: pedir as never })).toBeNull();
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("el tic junta cada ronda que nace y avanza a la siguiente; nunca pide la ronda elegida, esa la verifica el sorteo", async () => {
    const { ticDeLaEspera } = await import("./freeze");
    const feed = { elegida: 25, siguiente: 23, inicial: 2, vistos: [] as { round: number; hex: string }[], cuando: 0, enVuelo: false };
    // Después de la hora en que las dos rondas debieron nacer: el reloj deja pasarlas.
    const opciones = { ahora: (roundTime(24) + 2) * 1000, pedir: vi.fn(async (round: number) => ({ round, hex: firma(round).slice(0, 8) }) as never) };
    const primera = await ticDeLaEspera(feed, opciones);
    expect(primera).toEqual({ round: 23, hex: firma(23).slice(0, 8) });
    expect(feed.siguiente).toBe(24);
    // Con un pedido en vuelo, el tic no manda otro.
    feed.enVuelo = true;
    expect(await ticDeLaEspera(feed, opciones)).toBeNull();
    feed.enVuelo = false;
    const segunda = await ticDeLaEspera(feed, opciones);
    expect(segunda).toEqual({ round: 24, hex: firma(24).slice(0, 8) });
    // La elegida ya es la siguiente: el feed se termina, el sorteo se encarga de ella.
    expect(feed.siguiente).toBe(25);
    expect(await ticDeLaEspera(feed, opciones)).toBeNull();
    expect(opciones.pedir).toHaveBeenCalledTimes(2);
    expect(feed.vistos.map((v) => v.round)).toEqual([23, 24]);
  });
});

describe("el render de los números y del contador", () => {
  it("muestra los números vistos con su ronda y el contador de faltantes", async () => {
    const { pintarNumerosVistos } = await import("./freeze");
    const caja = cajaNueva();
    pintarNumerosVistos(caja, [{ round: 10, hex: "a1b2c3d4" }, { round: 11, hex: "b2c3d4e5" }], 25);
    expect(caja.textContent).toContain("#10 a1b2c3d4");
    expect(caja.textContent).toContain("#11 b2c3d4e5");
    expect(caja.textContent).toContain(String(T.es.espFaltanN(14)));
  });

  it("entre ficha y ficha va un espacio, sin otros signos", async () => {
    const { pintarNumerosVistos } = await import("./freeze");
    const caja = cajaNueva();
    pintarNumerosVistos(caja, [{ round: 10, hex: "a1b2c3d4" }, { round: 11, hex: "b2c3d4e5" }], 25);
    expect(caja.querySelector("p")?.textContent).toBe("#10 a1b2c3d4 #11 b2c3d4e5");
  });

  it("el contador va en singular con uno, y sin números vistos arranca en el total del sello", async () => {
    const { pintarNumerosVistos } = await import("./freeze");
    const caja = cajaNueva();
    pintarNumerosVistos(caja, [{ round: 24, hex: "d4e5f6a7" }], 25, 2);
    expect(caja.textContent).toContain(T.es.espFaltanN(1));
    // Nadie nació todavía: el contador dice cuántos van a nacer mientras se espera.
    pintarNumerosVistos(caja, [], 25, 15);
    expect(caja.textContent).toContain(T.es.espFaltanN(15));
    expect(caja.textContent).not.toContain("#");
  });

  it("con una lista larga muestra las últimas fichas y no se va del cuadro", async () => {
    const { pintarNumerosVistos, NUMEROS_EN_PANTALLA } = await import("./freeze");
    const caja = cajaNueva();
    const vistos = Array.from({ length: NUMEROS_EN_PANTALLA + 5 }, (_, i) => ({ round: i + 1, hex: firma(i + 1).slice(0, 8) }));
    pintarNumerosVistos(caja, vistos, vistos[vistos.length - 1]!.round + 20, 0);
    expect(caja.textContent).not.toContain("#5 ");
    expect(caja.textContent).toContain(`#${vistos[vistos.length - 1]!.round}`);
  });

  it("pinta lo mismo en la espera en grande", async () => {
    const { pintarNumerosVistos } = await import("./freeze");
    const caja = cajaNueva();
    caja.className = "espera-feed";
    pintarNumerosVistos(caja, [{ round: 9, hex: "e5f6a7b8" }], 25);
    expect(caja.textContent).toContain("#9 e5f6a7b8");
    expect(caja.textContent).toContain(T.es.espFaltanN(16));
  });
});

describe("la espera de verdad junta los números que nacen", () => {
  const montar = async (lead: number): Promise<{ ronda: number; resta: number }> => {
    const freeze = await import("./freeze");
    const { targetRound, roundAt } = await import("../protocol/quicknet");
    const { listHash } = await import("../protocol/canonical");
    const { bytesToHex } = await import("@noble/hashes/utils.js");
    const nombres = ["Ana", "Beto", "Caro"];
    const ahora = Math.floor(Date.now() / 1000);
    const ronda = targetRound(ahora, lead);
    freeze.resumeFrozen({ names: nombres, listHash: bytesToHex(listHash(nombres)), sealedAt: ahora, prize: "Una pizza", round: ronda, numWinners: 1 });
    return { ronda, resta: Math.max(0, ronda - roundAt(ahora + 1)) };
  };

  beforeEach(() => {
    history.replaceState(null, "", "/?lead=5");
    document.body.innerHTML = new DOMParser().parseFromString(readFileSync(join(process.cwd(), "index.html"), "utf8"), "text/html").body.innerHTML;
    Element.prototype.scrollIntoView = () => undefined;
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined })) as unknown as typeof window.matchMedia;
    // El faro de la prueba: sirve cada ronda con su firma en cuanto se le pregunta.
    h.faro = async (round: number) => ({ round, signature: firma(round) });
  });

  afterEach(() => {
    h.faro = null;
    history.replaceState(null, "", "/");
  });

  it("durante la espera muestra los números que van naciendo y el contador baja hasta el 1", { timeout: 20000 }, async () => {
    const { ronda, resta } = await montar(5);
    // El contador arranca con los que van a nacer, antes de que caiga el primero.
    expect(document.getElementById("wait-feed")).not.toBeNull();
    expect(document.getElementById("wait-feed")?.textContent).toContain(T.es.espFaltanN(resta));
    // Mientras nacen, cada número público aparece con su ronda y quita uno del contador.
    await vi.waitFor(() => expect(document.getElementById("wait-feed")?.textContent).toContain(`#${ronda - 1}`), { timeout: 9000, interval: 100 });
    expect(document.getElementById("wait-feed")?.textContent).toContain(T.es.espFaltanN(1));
    // Lo mismo se ve en la espera en grande, si la sala la abre: la abre el botón de la página, como siempre.
    document.getElementById("btn-espera")?.click();
    await vi.waitFor(() => expect(document.querySelector(".espera .espera-feed")?.textContent).toContain(`#${ronda - 1}`), { timeout: 4000, interval: 100 });
  });
});
