// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El show de la vista de espectador (`showDelEspectador` en draw.ts): el mismo juego de la sala con lo que ya decidió la
 * ronda. Lo que importa es lo que NO hace, como `verDeNuevo` (no sortea, no graba, no toca la cadena ni cuenta), y que
 * con un sorteo sellado la tarjeta salga ya y el juego espere a que quede grabado, como en la sala.
 */

interface TarjetaFalsa {
  ready: Promise<void>;
  hide: () => void;
  update: (g: string) => void;
  soltar: () => void;
  espera: Promise<unknown> | undefined;
}

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  readDraw: vi.fn(),
  contar: vi.fn(),
  juego: vi.fn(),
  tarjetas: [] as TarjetaFalsa[],
}));

vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async () => undefined,
  existenciaDelSorteo: async () => "presente",
  limpiarDetalle: () => undefined,
  readDraw: (...a: unknown[]) => h.readDraw(...a),
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), contarPractica: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("./freeze", () => ({
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: () => undefined,
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: async () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
// La tarjeta del juego: anota con qué espera salió y deja que la prueba la cierre.
vi.mock("./gamecard", () => ({
  CARD_SECONDS: 5,
  showGameCard: (_g: string, _p: number, _w: number, _c: number, _s: unknown, _z: string, espera?: Promise<unknown>) => {
    let soltar: () => void = () => undefined;
    const ready = new Promise<void>((r) => (soltar = r));
    const t: TarjetaFalsa = { ready, hide: () => soltar(), update: () => undefined, soltar: () => soltar(), espera };
    h.tarjetas.push(t);
    return t;
  },
}));
vi.mock("./wallet-ui", () => ({ currentSession: () => null }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => undefined }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, rutaDe: () => "" }));
// El motor de respaldo: el "juego" solo anota con qué lo llamaron y termina.
vi.mock("../games/race", () => ({
  stadiumRace: (names: string[], winners: number[], beacon: { round: number }, fin: () => void) => {
    h.juego(names, winners, beacon.round);
    fin();
  },
}));

const BEACON = { round: 777, randomness: "ab".repeat(32), signature: "cd".repeat(48) };

async function prepararEstado(prize = "Una pizza", winners = [2]): Promise<void> {
  const { app } = await import("../state");
  app.frozen = { names: ["Ana", "Beto", "Carla"], listHash: "00".repeat(32), ts: 1, at: "-", prize, round: 777 } as never;
  app.drawn = { beacon: BEACON, winners } as never;
  app.game = "race";
}

beforeEach(() => {
  vi.resetModules();
  for (const m of [h.drawOnChain, h.readDraw, h.contar, h.juego]) m.mockReset();
  h.tarjetas = [];
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><div id="winner-cards"></div><div id="leyenda-box"></div><div id="lore-box"></div>`;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sin red: el show del espectador no la toca"));
  history.replaceState(null, "", "/");
});

describe("el show de la vista de espectador", () => {
  it("sin cadena juega enseguida con los ganadores y la ronda que ya decidió el número, sin sortear ni grabar", async () => {
    await prepararEstado();
    const { showDelEspectador } = await import("./draw");
    const show = showDelEspectador(null);
    expect(show).not.toBeNull();
    // Sin cadena la sala no espera nada: la tarjeta sale al jugar, no antes.
    expect(h.tarjetas).toHaveLength(0);
    const fin = vi.fn();
    show?.jugar(fin);
    h.tarjetas[0]?.soltar();
    await vi.waitFor(() => expect(fin).toHaveBeenCalledTimes(1));
    expect(h.juego).toHaveBeenCalledWith(["Ana", "Beto", "Carla"], [2], 777);
    expect(h.drawOnChain).not.toHaveBeenCalled();
    expect(h.readDraw).not.toHaveBeenCalled();
    expect(h.contar).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // No revela nada en la página de atrás.
    expect(document.getElementById("winner-cards")?.textContent).toBe("");
  });

  it("con un sorteo sellado la tarjeta sale ya, con la espera de lo grabado, y el juego espera a jugar", async () => {
    await prepararEstado();
    const { showDelEspectador } = await import("./draw");
    let grabar: () => void = () => undefined;
    const grabado = new Promise<void>((r) => (grabar = r));
    const show = showDelEspectador(grabado);
    expect(h.tarjetas).toHaveLength(1);
    expect(h.tarjetas[0]?.espera).toBe(grabado);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.juego).not.toHaveBeenCalled();
    grabar();
    const fin = vi.fn();
    show?.jugar(fin);
    h.tarjetas[0]?.soltar();
    await vi.waitFor(() => expect(fin).toHaveBeenCalledTimes(1));
    // La misma tarjeta: no sale una segunda.
    expect(h.tarjetas).toHaveLength(1);
    expect(h.juego).toHaveBeenCalledWith(["Ana", "Beto", "Carla"], [2], 777);
  });

  it("si la tarjeta se fue sola antes de que quedara grabado, el juego sale con una tarjeta nueva", async () => {
    await prepararEstado();
    const { showDelEspectador } = await import("./draw");
    let grabar: () => void = () => undefined;
    const grabado = new Promise<void>((r) => (grabar = r));
    const show = showDelEspectador(grabado);
    // Quien organiza tardó: la tarjeta se cerró por su tope.
    h.tarjetas[0]?.soltar();
    await new Promise((r) => setTimeout(r, 0));
    grabar();
    show?.jugar(() => undefined);
    expect(h.tarjetas).toHaveLength(2);
    expect(h.tarjetas[1]?.espera).toBeUndefined();
  });

  it("jugar dos veces no monta dos shows", async () => {
    await prepararEstado();
    const { showDelEspectador } = await import("./draw");
    const show = showDelEspectador(null);
    show?.jugar(() => undefined);
    show?.jugar(() => undefined);
    expect(h.tarjetas).toHaveLength(1);
  });

  it("un orden de turnos lo dice el cartel final, como en la sala", async () => {
    await prepararEstado("Turnos de la semana", [2, 0, 1]);
    const { showDelEspectador } = await import("./draw");
    const { esResultadoDeTurnos, setResultadoDeTurnos } = await import("../modos/turnos");
    setResultadoDeTurnos(false);
    showDelEspectador(null);
    expect(esResultadoDeTurnos()).toBe(true);
    await prepararEstado("Una pizza", [2]);
    showDelEspectador(null);
    expect(esResultadoDeTurnos()).toBe(false);
  });

  it("cancelar saca la tarjeta", async () => {
    await prepararEstado();
    const { showDelEspectador } = await import("./draw");
    const show = showDelEspectador(new Promise(() => undefined));
    let salio = false;
    void h.tarjetas[0]?.ready.then(() => (salio = true));
    show?.cancelar();
    await new Promise((r) => setTimeout(r, 0));
    expect(salio).toBe(true);
  });

  it("sin lista ni resultado no hay show", async () => {
    const { app } = await import("../state");
    app.frozen = null;
    app.drawn = null;
    const { showDelEspectador } = await import("./draw");
    expect(showDelEspectador(null)).toBeNull();
  });
});
