// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #102: «Siguiente premio» de a un lugar.
 *
 * Con más de un lugar sellado, el primer show muestra solo el primer lugar y «Siguiente premio»
 * muestra el que sigue del mismo resultado, con su show, sin sellar de nuevo. Al terminar los
 * lugares sellados, vuelve a lo de hoy: sellar entre quienes quedan. La lógica pura de la
 * progresión se prueba acá; el flujo de la sala (qué muestra y cuándo no sella), con la pantalla.
 */

const V = JSON.parse(readFileSync(join(process.cwd(), "docs/vectors.json"), "utf8")) as {
  list: string[];
  list_hash: string;
  quicknet: { round: number; signature: string; randomness: string };
  cases: { k: number; winners: number[] }[];
};

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  juego: vi.fn(),
  fin: null as null | (() => void),
  unfreeze: vi.fn(),
  fetchRound: vi.fn(),
  /** La tarjeta de cómo se juega (`showGameCard`): sus argumentos, y no se muestra. */
  tarjeta: vi.fn(),
  /** El sello es el de una campaña (`en-curso.ts`). */
  campana: false,
}));

vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  existenciaDelSorteo: async () => "existe",
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: async (o: { intentar: () => Promise<unknown> }) => ({ ok: true, valor: await o.intentar(), yaEstaba: false }),
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: (...a: unknown[]) => h.unfreeze(...a),
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 3.5, showGameCard: (...a: unknown[]) => h.tarjeta(...a) }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => true }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: () => undefined }));
vi.mock("../campana/en-curso", async (orig) => ({
  ...(await orig<typeof import("../campana/en-curso")>()),
  esSorteoDeCampana: (raffleId: bigint | undefined) => h.campana && raffleId === 7n,
}));
vi.mock("./campana-resultado-real", () => ({ alRevelarReal: () => undefined }));
vi.mock("../stellar/monedas-eventos", () => ({ acreditarEnSegundoPlano: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => true }));
vi.mock("../games/pixi", () => ({
  playPixi: async (_g: unknown, _n: unknown, winners: number[], _b: unknown, fin: () => void) => {
    h.juego([...winners]);
    h.fin = fin;
    return true;
  },
}));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const TX = "cd".repeat(32);
/** Un resultado de 3 lugares (la sala ve uno por vez). El orden de `winners` es el orden de los premios. */
const ESPERADOS = V.cases.find((c) => c.k === 3)?.winners ?? [];
const P1 = ESPERADOS[0] ?? -1;
const P2 = ESPERADOS[1] ?? -1;
const P3 = ESPERADOS[2] ?? -1;
const N1 = V.list[P1] ?? "";
const N2 = V.list[P2] ?? "";
const N3 = V.list[P3] ?? "";

/** Un sello confirmado con la lista y la ronda de los vectores, con la cantidad sellada de lugares. */
async function sellarCon(numWinners: number, prize = "Una pizza"): Promise<typeof import("../state")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize, round: V.quicknet.round, numWinners, raffleId: 7n } as never;
  return state;
}

const cards = (): string => document.getElementById("winner-cards")?.textContent ?? "";

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  h.drawOnChain.mockReset().mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
  h.juego.mockReset();
  h.unfreeze.mockReset();
  h.fin = null;
  h.campana = false;
  h.tarjeta.mockReset().mockReturnValue(null);
  h.fetchRound.mockReset().mockResolvedValue({ round: V.quicknet.round, signature: V.quicknet.signature });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

describe("la lógica pura de la progresión de lugares", () => {
  const w = [10, 3, 7];
  it("el lugar que sigue avanza de a uno, en el orden de `winners`", async () => {
    const { lugarQueSigue } = await import("./draw");
    expect(lugarQueSigue(w, 0)).toEqual({ indice: 0, lugar: 1, total: 3 });
    expect(lugarQueSigue(w, 1)).toEqual({ indice: 1, lugar: 2, total: 3 });
    expect(lugarQueSigue(w, 2)).toEqual({ indice: 2, lugar: 3, total: 3 });
  });

  it("sin lugares por mostrar, «Siguiente premio» vuelve a sellar entre quienes quedan", async () => {
    const { lugarQueSigue, lugaresSinMostrar } = await import("./draw");
    expect(lugarQueSigue(w, 3)).toBeNull();
    expect(lugarQueSigue(w, 99)).toBeNull();
    expect(lugaresSinMostrar(w, 3)).toBe(0);
    expect(lugaresSinMostrar(w, 99)).toBe(0);
  });

  it("sin la progresión en marcha no hay lugar que seguir: es el comportamiento de antes", async () => {
    const { lugarQueSigue, lugaresSinMostrar } = await import("./draw");
    expect(lugarQueSigue(w, undefined)).toBeNull();
    expect(lugaresSinMostrar(w, undefined)).toBe(0);
  });

  it("con un solo lugar sellado no hay progresión: se muestra y se pasa al próximo sello", async () => {
    const { lugarQueSigue } = await import("./draw");
    expect(lugarQueSigue([9], 0)).toBeNull();
    expect(lugarQueSigue([9], 1)).toBeNull();
  });

  it("sin un sorteo sellado, ningún lugar dice premio", async () => {
    const { premioDelLugar } = await import("./draw");
    expect(premioDelLugar(1)).toBe("");
    expect(premioDelLugar(2)).toBe("");
  });

  it("con un premio por lugar sellado, cada lugar dice el suyo y uno sin premio no dice nada", async () => {
    await sellarCon(3, "1.er premio: Bici, 3.er premio: Libro");
    const { premioDelLugar } = await import("./draw");
    expect([1, 2, 3].map(premioDelLugar)).toEqual(["Bici", "", "Libro"]);
  });

  it("con un solo premio para todos, ningún lugar dice premio, como antes", async () => {
    await sellarCon(3);
    const { premioDelLugar } = await import("./draw");
    expect(premioDelLugar(2)).toBe("");
  });
});

describe("un sello con tres lugares y un premio por lugar", () => {
  it("la línea del lugar y la tarjeta dicen el premio del lugar que la sala está viendo", async () => {
    await sellarCon(3, "1.er premio: Bici, 2.º premio: Termo, 3.er premio: Libro");
    const { draw, siguientePremio } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    h.fin?.();
    await vi.waitFor(() => expect(cards()).toContain(N1));
    expect(document.getElementById("lugar-actual")?.textContent).toBe("Lugar 1 de 3: Bici");
    expect(cards()).toContain("Se lleva: Bici");
    expect(cards()).not.toContain("Termo");
    siguientePremio();
    await vi.waitFor(() => expect(h.juego).toHaveBeenLastCalledWith([P2]));
    h.fin?.();
    await vi.waitFor(() => expect(document.getElementById("lugar-actual")?.textContent).toBe("Lugar 2 de 3: Termo"));
    expect(cards()).toContain("Se lleva: Termo #2");
    expect(cards()).not.toContain("Libro");
  });
});

describe("un sello con tres lugares", () => {
  it("el primer show muestra solo el primer lugar, con el contador y la línea de la verdad", async () => {
    const { app } = await sellarCon(3);
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    // Solo el primer lugar en la pantalla, aunque el resultado ya trae los tres.
    expect(h.juego).toHaveBeenCalledWith([P1]);
    expect(app.drawn?.winners).toEqual(ESPERADOS);
    expect(app.drawn?.revelados).toBe(1);
    h.fin?.();
    await vi.waitFor(() => expect(cards()).toContain(N1));
    expect(cards()).not.toContain(N2);
    expect(document.getElementById("lugar-actual")?.textContent).toMatch(/1 de 3/);
    expect(document.getElementById("lugar-actual")?.style.display).not.toBe("none");
    // La verdad a la sala: los lugares quedaron fijos al nacer el número y cualquiera los puede calcular.
    const fijos = document.getElementById("lugares-fijos");
    expect(fijos?.style.display).not.toBe("none");
    expect(fijos?.textContent).toMatch(/quedaron fijos al nacer el número/);
    // El comprobante ya lleva los tres lugares, en el orden de la sala.
    expect(document.getElementById("proof")?.textContent).toContain(`winners=[${ESPERADOS.join(",")}]`);
    // La fila de lo que sigue habla del lugar que viene, no de las personas del próximo sello.
    expect(document.getElementById("again-left")?.textContent).toMatch(/2 de 3/);
    expect((document.getElementById("btn-again-sin") as HTMLButtonElement).textContent).toBe("Siguiente premio");
  });

  it("«Siguiente premio» muestra el segundo y después el tercero, sin unfreeze ni sello nuevo", async () => {
    const { app } = await sellarCon(3);
    const { draw, siguientePremio } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    h.fin?.();
    await vi.waitFor(() => expect(cards()).toContain(N1));

    // Segundo lugar: su show, sin abrir la lista.
    siguientePremio();
    await vi.waitFor(() => expect(h.juego).toHaveBeenLastCalledWith([P2]));
    expect(h.unfreeze).not.toHaveBeenCalled();
    h.fin?.();
    await vi.waitFor(() => expect(document.getElementById("lugar-actual")?.textContent).toMatch(/2 de 3/));
    expect(cards()).toContain(N2);
    expect(cards()).not.toContain(N3);
    expect(app.drawn?.revelados).toBe(2);

    // Tercero.
    siguientePremio();
    await vi.waitFor(() => expect(h.juego).toHaveBeenLastCalledWith([P3]));
    expect(h.unfreeze).not.toHaveBeenCalled();
    h.fin?.();
    await vi.waitFor(() => expect(document.getElementById("lugar-actual")?.textContent).toMatch(/3 de 3/));
    expect(app.drawn?.revelados).toBe(3);

    // Al terminar los tres: vuelve a lo de hoy, sellar entre quienes quedan.
    siguientePremio();
    expect(h.unfreeze).toHaveBeenCalledTimes(1);
    expect(app.drawn).toBeNull();
    expect((document.getElementById("btn-draw") as HTMLButtonElement).dataset.i).toBe("draw");
  });

  it("la tarjeta del primer show habla de un premio: el cartel del final corona a uno solo", async () => {
    await sellarCon(3);
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    // La primera es la de `sortear`, antes del número: la que la sala lee mientras espera.
    expect(h.tarjeta.mock.calls[0]?.[2]).toBe(1);
  });

  it("desde el segundo lugar, la página encuadra la tarjeta de quien acaba de ganar", async () => {
    const encuadrados: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      encuadrados.push(this);
    };
    await sellarCon(3);
    const { draw, siguientePremio } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    h.fin?.();
    // El primero, como siempre: la sección entera.
    await vi.waitFor(() => expect(encuadrados.at(-1)?.id).toBe("sec-draw"));
    const antes = encuadrados.length;
    siguientePremio();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(2));
    h.fin?.();
    await vi.waitFor(() => expect(encuadrados.length).toBeGreaterThan(antes));
    const ultimo = encuadrados.at(-1);
    expect(ultimo?.classList.contains("winner-card")).toBe(true);
    expect(ultimo?.textContent).toContain(N2);
    expect(ultimo?.textContent).not.toContain(N1);
  });

  it("la vista de la sala vuelve a «Siguiente premio» de siempre cuando se terminan los lugares", async () => {
    const { app } = await sellarCon(3);
    const { draw, siguientePremio } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    for (let lugar = 1; lugar <= 3; lugar++) {
      if (lugar > 1) {
        siguientePremio();
        // El show nuevo montó: el `fin` de la prueba es el del lugar de ahora.
        await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(lugar));
      }
      h.fin?.();
      await vi.waitFor(() => expect(app.drawn?.revelados).toBe(lugar));
    }
    // Con los tres lugares vistos, la fila vuelve a hablar de personas, como antes de este issue.
    const left = document.getElementById("again-left")?.textContent ?? "";
    expect(left).not.toMatch(/de 3/);
    expect(left).toMatch(/quedan|Quedan/);
  });
});

describe("el sorteo de una campaña con tres premios", () => {
  it("se juega en un solo show con los tres lugares: su panel no tiene «Siguiente premio»", async () => {
    h.campana = true;
    const { app } = await sellarCon(3);
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    expect(h.juego).toHaveBeenCalledWith(ESPERADOS);
    expect(app.drawn?.revelados).toBeUndefined();
    h.fin?.();
    await vi.waitFor(() => expect(cards()).toContain(N1));
    expect(cards()).toContain(N2);
    expect(cards()).toContain(N3);
    expect(document.getElementById("lugar-actual")?.style.display).toBe("none");
  });

  it("su tarjeta sigue hablando de los tres premios, como el cartel del final", async () => {
    h.campana = true;
    await sellarCon(3);
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    expect(h.tarjeta.mock.calls[0]?.[2]).toBe(3);
  });
});

describe("con un solo lugar sellado no cambia nada", () => {
  it("se muestra como hoy y «Siguiente premio» abre la lista sin el ganador", async () => {
    const { app } = await sellarCon(1);
    const { draw, siguientePremio } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledWith([P1]));
    expect(app.drawn?.revelados).toBeUndefined();
    h.fin?.();
    await vi.waitFor(() => expect(cards()).toContain(N1));
    // Sin contador de lugares: no hay de a uno que seguir.
    expect(document.getElementById("lugar-actual")?.style.display).toBe("none");
    // Y «Siguiente premio» vuelve a lo de hoy de una.
    siguientePremio();
    expect(h.unfreeze).toHaveBeenCalledTimes(1);
    expect(app.drawn).toBeNull();
  });
});
