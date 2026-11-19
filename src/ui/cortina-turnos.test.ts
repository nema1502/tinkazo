// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * La cortina y la tarjeta leen el mismo modo, calculado una sola vez antes de que exista el resultado. Desde el 16 de
 * noviembre de 2026 la tarjeta sale antes del número y hace de cortina: la cortina sale solo si no hay tarjeta.
 */

const h = vi.hoisted(() => ({ fetchRound: vi.fn() }));

vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: async () => ({ winners: [0], randomness: "00" }),
  escribirError: async () => undefined,
  existenciaDelSorteo: async () => null,
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("./freeze", () => ({
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: () => undefined,
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./wallet-ui", () => ({ currentSession: () => null }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/race", () => ({ stadiumRace: () => undefined }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => 0, sonidoDelJuego: () => "" }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  h.fetchRound.mockReset();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  document.body.innerHTML =
    '<button id="btn-draw"></button><div id="draw-status"></div><div id="sec-draw"></div>' +
    '<div id="seed-label"></div><input id="nw" type="number" value="1">';
});

afterEach(() => {
  // La tarjeta de mentira de `sinTarjeta` es solo de ese caso.
  vi.doUnmock("./gamecard");
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

/**
 * Frena el número hasta que la cortina esté visible; después deja que el sorteo llegue a la tarjeta. `sinTarjeta`: la
 * tarjeta no sale (como si no hubiera dónde mostrarla), y entonces sí la cortina.
 */
async function presentacion(orden: boolean, sinTarjeta = false): Promise<{ cortina: string; antes: HTMLElement | null; tarjeta: HTMLElement | null }> {
  if (sinTarjeta) vi.doMock("./gamecard", async (orig) => ({ ...(await orig<typeof import("./gamecard")>()), showGameCard: () => null }));
  const { app } = await import("../state");
  app.game = "race";
  app.drawn = null;
  app.frozen = {
    names: ["Ana", "Beto", "Cami"],
    listHash: "00".repeat(32),
    ts: 1,
    at: "",
    prize: orden ? "Turnos" : "Termo",
    round: 1,
  };
  (document.getElementById("nw") as HTMLInputElement).value = orden ? "3" : "1";
  let publicar: (firma: { signature: string }) => void = () => undefined;
  h.fetchRound.mockReturnValue(new Promise<{ signature: string }>((resolve) => (publicar = resolve)));
  const { draw } = await import("./draw");
  const sorteando = draw();
  await vi.advanceTimersByTimeAsync(350);
  const cortina = document.querySelector<HTMLElement>(".cortina")?.textContent ?? "";
  // La tarjeta que la sala lee mientras llega el número.
  const antes = document.querySelector<HTMLElement>(".game-card");
  publicar({ signature: "01".repeat(48) });
  await sorteando;
  return { cortina, antes, tarjeta: document.querySelector<HTMLElement>(".game-card") };
}

describe("la cortina y la tarjeta con el mismo sorteo", () => {
  it("en un orden, la tarjeta sale antes del número, anuncia el orden y la regla habla del turno 1", async () => {
    const { cortina, antes, tarjeta } = await presentacion(true);
    // Con la tarjeta arriba no hay cortina: la tarjeta hace de cortina, y es la misma que sigue con el juego.
    expect(cortina).toBe("");
    expect(antes).not.toBeNull();
    expect(tarjeta).toBe(antes);
    expect(tarjeta?.querySelector(".gc-premio")?.textContent).toBe(T.es.cortinaSeOrden);
    expect(tarjeta?.querySelector(".gc-regla")?.textContent).toBe(T.es.gcRaceOrden);
    expect(tarjeta?.textContent).not.toContain("Termo");
  });

  it("en un orden sin tarjeta, la cortina anuncia el orden", async () => {
    const { cortina } = await presentacion(true, true);
    expect(cortina).toContain(T.es.cortinaSeOrden);
    expect(cortina).not.toContain("Turnos");
  });

  it("en un sorteo de premios, la tarjeta sale antes del número, nombra el premio y conserva la regla común", async () => {
    const { cortina, antes, tarjeta } = await presentacion(false);
    expect(cortina).toBe("");
    expect(tarjeta).toBe(antes);
    expect(tarjeta?.querySelector(".gc-premio")?.textContent).toBe(`${T.es.cortinaSe} Termo`);
    expect(tarjeta?.querySelector(".gc-regla")?.textContent).toBe(T.es.gcRace);
    expect(tarjeta?.textContent).not.toContain(T.es.cortinaSeOrden);
  });

  it("en un sorteo de premios sin tarjeta, la cortina nombra el premio", async () => {
    const { cortina } = await presentacion(false, true);
    expect(cortina).toContain(T.es.cortinaSe);
    expect(cortina).toContain("Termo");
    expect(cortina).not.toContain(T.es.cortinaSeOrden);
  });

  it("la línea del orden no habla de ganar ni de premios en ninguno de los dos idiomas", () => {
    expect(T.es.cortinaSeOrden).not.toMatch(/ganar|gana|ganador|premio/i);
    expect(T.en.cortinaSeOrden).not.toMatch(/\bwin|\bwinner|\bprize/i);
  });
});
