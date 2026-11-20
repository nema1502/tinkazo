// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La sala lanzada desde la espera en grande sigue la línea de tiempo común (`draw.ts`): trae el número con el pedido que
 * espera su nacimiento (el ancla), su tarjeta termina y su estadio arranca a la hora fija desde esa llegada, y con
 * celulares mirando graba mientras juega solo si va a la par; si no, después de mostrar quién gana. Sin celulares, como
 * siempre. Con la lista y el número de `docs/vectors.json`.
 */

const V = JSON.parse(readFileSync(join(process.cwd(), "docs/vectors.json"), "utf8")) as {
  list: string[];
  list_hash: string;
  quicknet: { round: number; signature: string; randomness: string };
  cases: { k: number; winners: number[] }[];
};

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  fetchRound: vi.fn(),
  juego: vi.fn(),
  fin: null as null | (() => void),
  ancla: null as null | { llegada: number; retenido: boolean; idaYVuelta: number | null; firma: string | null },
  espera: null as null | Promise<unknown>,
  horario: vi.fn(),
  show: null as null | Record<string, unknown>,
  alDia: vi.fn(),
  virtual: null as number | null,
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
  sortearConReintentos: async (o: { intentar: () => Promise<unknown> }) => {
    try {
      return { ok: true, valor: await o.intentar(), yaEstaba: false };
    } catch (error) {
      return { ok: false, error };
    }
  },
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("../reloj-de-la-ronda", async (orig) => ({
  ...(await orig<typeof import("../reloj-de-la-ronda")>()),
  anclaDeLaRondaUnaVez: async () => h.ancla,
  anclaVirtual: () => h.virtual,
}));
vi.mock("../games/en-hora", async (orig) => ({
  ...(await orig<typeof import("../games/en-hora")>()),
  pedirHorario: (...a: unknown[]) => h.horario(...a),
  estadoDelShow: () => h.show,
  ponerseAlDiaAlVolver: () => h.alDia(),
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
vi.mock("./freeze", () => ({ rotarJuego: () => undefined, secondsToRound: () => 0, unfreeze: () => undefined, alElegirDespuesDelResultado: () => undefined, irAlSelectorParaOtro: () => undefined, juegoParaVerDeNuevo: () => undefined, marcarShow: () => undefined, pintarNotaDelJuego: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({
  CARD_SECONDS: 3.5,
  showGameCard: (_g: unknown, _p: unknown, _w: unknown, _c: unknown, _s: unknown, _pr: unknown, espera?: Promise<unknown>) => {
    h.espera = espera ?? null;
    return { ready: Promise.resolve(), hide: () => undefined, update: () => undefined };
  },
}));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => true }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: () => undefined }));
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
const ESPERADOS = V.cases.find((c) => c.k === 3)?.winners ?? [];
const TX = "cd".repeat(32);
const SHOW_A_LA_PAR = { arranco: true, tardeAlArrancar: 0.05, reanclado: false, atraso: 0, seEscondio: false, oculto: false, retenido: false, retenidoS: 0, coronado: false };

async function sellar(): Promise<typeof import("../state")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.game = "race";
  state.setPace("normal");
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 3, raffleId: 7n } as never;
  return state;
}

/** Que se vio un QR de este sello, con el juego y la duración de la sala. */
async function conCelulares(juego = "race"): Promise<void> {
  const { app } = await import("../state");
  const r = await import("./espectadores-de-la-sala");
  r.anotarQrMostrado(app.frozen as never, juego as never, "normal", { id: "Ab12Cd34", clave: "k".repeat(22), permiso: "p", cambia: false, version: null, largo: 256, n: 1 });
}

beforeEach(async () => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  localStorage.clear();
  h.drawOnChain.mockReset().mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
  h.fetchRound.mockReset().mockResolvedValue({ round: V.quicknet.round, signature: V.quicknet.signature });
  h.juego.mockReset();
  h.horario.mockReset();
  h.fin = null;
  h.espera = null;
  h.show = null;
  h.alDia.mockReset();
  h.ancla = { llegada: 50_000, retenido: true, idaYVuelta: 80, firma: V.quicknet.signature };
  // La hora de la ronda en el reloj monótono de la sala, por la medida de su reloj: su número llegó a horario.
  h.virtual = 50_000 - 30;
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

describe("la sala lanzada desde la espera, a la hora del ancla", () => {
  it("usa el número que llegó con el ancla, y su tarjeta y su estadio van a la hora fija desde esa llegada", async () => {
    await sellar();
    const { draw } = await import("./draw");
    const sorteo = draw({ adelantado: true });
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledWith([ESPERADOS[0]]));
    // El número es el del ancla: no se pidió otra vez.
    expect(h.fetchRound).not.toHaveBeenCalled();
    // La tarjeta termina a la llegada más 4,4 s (Normal), y el estadio arranca a esa misma hora.
    expect(await h.espera).toEqual({ terminaEn: 50_000 + 4_400 });
    expect(h.horario).toHaveBeenCalledWith({ inicio: 54_400 }, expect.objectContaining({ alCoronar: expect.any(Function) }));
    h.fin?.();
    await sorteo;
  });

  it("sin ancla (el servicio que retiene no contestó) trae el número como siempre y cuenta desde su llegada", async () => {
    h.ancla = null;
    await sellar();
    const { draw } = await import("./draw");
    const sorteo = draw({ adelantado: true });
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    expect(h.fetchRound).toHaveBeenCalledTimes(1);
    const hora = (await h.espera) as { terminaEn: number };
    expect(hora.terminaEn).toBeGreaterThan(4_000);
    h.fin?.();
    await sorteo;
  });

  it("lanzada con el botón (no adelantada) no lleva hora fija ni horario", async () => {
    await sellar();
    const { draw } = await import("./draw");
    const sorteo = draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    expect(await h.espera).toBeUndefined();
    expect(h.horario).toHaveBeenCalledWith(null, undefined);
    h.fin?.();
    await sorteo;
  });
});

describe("cuándo graba la sala", () => {
  it("sin celulares mirando, como siempre: mientras juega", async () => {
    await sellar();
    const { draw } = await import("./draw");
    const sorteo = draw({ adelantado: true });
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    expect(h.fin).not.toBeNull();
    h.fin?.();
    await sorteo;
  });

  it("con celulares y a la par, también mientras juega, y desde ahí la sala ya no se pausa al esconderse", async () => {
    await sellar();
    await conCelulares();
    h.show = SHOW_A_LA_PAR;
    const { draw } = await import("./draw");
    const sorteo = draw({ adelantado: true });
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    // Lo grabado suelta el final de los celulares: si la sala se esconde, al volver se pone al día (`en-hora.ts`).
    expect(h.alDia).toHaveBeenCalled();
    h.fin?.();
    await sorteo;
  });

  for (const [caso, preparar] of [
    ["su número no llegó con el pedido retenido", () => (h.ancla = { llegada: 50_000, retenido: false, idaYVuelta: 80, firma: V.quicknet.signature })],
    ["la ida y vuelta fue larga", () => (h.ancla = { llegada: 50_000, retenido: true, idaYVuelta: 900, firma: V.quicknet.signature })],
    ["su número llegó 1,8 s después de su hora (retenido igual)", () => (h.virtual = 50_000 - 1_800)],
    ["su reloj no se midió con una ronda que nace", () => (h.virtual = null)],
    ["su juego arrancó tarde y se reancló", () => (h.show = { ...SHOW_A_LA_PAR, reanclado: true })],
    ["su pestaña se escondió", () => (h.show = { ...SHOW_A_LA_PAR, seEscondio: true })],
    ["su pestaña está escondida justo al decidir", () => (h.show = { ...SHOW_A_LA_PAR, oculto: true })],
    ["su juego va atrasado", () => (h.show = { ...SHOW_A_LA_PAR, atraso: 0.6 })],
  ] as const) {
    it(`con celulares, si ${caso}, graba recién después de mostrar quién gana`, async () => {
      await sellar();
      await conCelulares();
      h.show = SHOW_A_LA_PAR;
      preparar();
      const { draw } = await import("./draw");
      const sorteo = draw({ adelantado: true });
      await vi.waitFor(() => expect(h.fin).not.toBeNull());
      await new Promise((r) => setTimeout(r, 50));
      expect(h.drawOnChain).not.toHaveBeenCalled();
      // Sin la par, la sala que se esconde sigue pausándose: graba recién después de mostrar quién gana.
      expect(h.alDia).not.toHaveBeenCalled();
      h.fin?.();
      await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
      await sorteo;
    });
  }

  it("con celulares que tienen otro juego (el QR quedó con el de antes), graba después de mostrar quién gana", async () => {
    await sellar();
    await conCelulares("sapo");
    h.show = SHOW_A_LA_PAR;
    const { draw } = await import("./draw");
    const sorteo = draw({ adelantado: true });
    await vi.waitFor(() => expect(h.fin).not.toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(h.drawOnChain).not.toHaveBeenCalled();
    h.fin?.();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    await sorteo;
  });

  it("con celulares, mientras la grabación espera, salir de la página pregunta", async () => {
    await sellar();
    await conCelulares();
    h.show = { ...SHOW_A_LA_PAR, reanclado: true };
    const { draw } = await import("./draw");
    const sorteo = draw({ adelantado: true });
    await vi.waitFor(() => expect(h.fin).not.toBeNull());
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    h.fin?.();
    await sorteo;
    const despues = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(despues);
    expect(despues.defaultPrevented).toBe(false);
  });
});

describe("el show del celular a la par (showALaPar)", () => {
  /**
   * El estadio avisa que terminó en cualquier cierre: al final del juego, y también si un cuadro falla y se cierra
   * (`cuadro-seguro.ts`) o si el juego no se alcanzó a armar. Con el final retenido, cerrarse no quiere decir que mostró
   * quién gana: el celular tiene que seguir el camino sin show, que espera lo grabado y el final del juego.
   */
  for (const [caso, show, conShow] of [
    ["si el estadio se cierra con el final retenido, antes del cartel, cuenta como sin show", { ...SHOW_A_LA_PAR, retenido: true, coronado: false }, false],
    ["si se cierra con el final suelto pero antes del cartel, también", { ...SHOW_A_LA_PAR, coronado: false }, false],
    ["si se cierra después de mostrar el cartel, hubo show", { ...SHOW_A_LA_PAR, coronado: true }, true],
  ] as const) {
    it(caso, async () => {
      const state = await sellar();
      state.app.drawn = { beacon: { round: V.quicknet.round, randomness: V.quicknet.randomness, signature: V.quicknet.signature }, winners: [...ESPERADOS] };
      const { showALaPar } = await import("./draw");
      const s = showALaPar({ personas: V.list.length, premios: 3, orden: false, resultado: Promise.resolve(undefined) });
      const alTerminar = vi.fn();
      s.jugar({ horario: { inicio: 0, retener: true, alcanzar: true }, avisos: {} }, alTerminar);
      await vi.waitFor(() => expect(h.fin).not.toBeNull());
      h.show = show;
      h.fin?.();
      expect(alTerminar).toHaveBeenCalledWith(conShow);
    });
  }
});
