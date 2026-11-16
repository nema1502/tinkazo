// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El sorteo que la espera en grande lanza unos segundos antes de que nazca el número (`freeze.ts`, `draw.ts`), con la
 * cuenta regresiva, la espera y el sorteo de verdad, y el reloj de verdad: la ronda nace a los pocos segundos.
 *
 * En el modo Oficial el sorteo pasa antes por sus compuertas (la cuenta sin activar, el acceso que no contesta, sin
 * acceso). Si una corta, la pantalla nunca puede quedar sin una acción para seguir: la espera ofrece volver a probar,
 * ese toque vuelve a pasar por la compuerta (antes y después de que nazca el número) y el botón de la página se
 * enciende cuando nace. Con la cuenta de prueba el sorteo sale solo y una sola vez. Con la billetera propia no se
 * adelanta: cuando nace, la espera ofrece lanzarlo.
 */

const V = JSON.parse(readFileSync(join(process.cwd(), "docs/vectors.json"), "utf8")) as {
  list: string[];
  list_hash: string;
  quicknet: { round: number; signature: string };
};

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  cobro: false,
  falta: false,
  aMano: false,
  gate: vi.fn(),
  acceso: vi.fn(),
  juego: vi.fn(),
  fetchRound: vi.fn(),
  drawOnChain: vi.fn(),
  verError: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get network() {
      return { ...o.network, name: h.red };
    },
  };
});
vi.mock("../stellar/cobro-oficial", async (orig) => ({ ...(await orig<typeof import("../stellar/cobro-oficial")>()), cobroPorUso: () => h.cobro }));
vi.mock("./cuenta-lista-flujo", () => ({ faltaEnLaMemoria: () => h.falta, cuentaListaParaGrabar: (...a: unknown[]) => h.gate(...a) }));
vi.mock("./sin-sorteos", () => ({ accesoParaSortear: (...a: unknown[]) => h.acceso(...a) }));
vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  existenciaDelSorteo: async () => "existe",
  hideTxStatus: () => undefined,
  limpiarDetalle: () => undefined,
  margenParaAprobar: async () => 0,
  pagaElPortero: async () => false,
  precargarParaElSorteo: () => undefined,
  readDraw: async () => null,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: async () => {
    throw new Error("no se sella en esta prueba");
  },
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: async (o: { intentar: () => Promise<unknown> }) => ({ ok: true, valor: await o.intentar(), yaEstaba: false }),
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, contarUnaVez: () => undefined, contarPractica: () => undefined, errorContable: (c: string) => c, origenActual: () => "", refDe: () => ({}) }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => h.aMano,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA", ...(h.aMano ? { aMano: true } : {}) }),
  frenarPorOtraRed: async () => false,
}));
vi.mock("./red", () => ({
  chequearAntesDeSellar: async () => true,
  hayAccionDeRed: () => false,
  limpiarRed: () => undefined,
  marcarSellado: () => undefined,
  mostrarCostoAlto: async () => undefined,
  mostrarSinPatrocinio: async () => undefined,
  mostrarSinSaldo: async () => undefined,
  patrocinioDelError: () => null,
  verLaRedTrasFallar: async () => false,
  verSinSello: async () => undefined,
}));
// `verError` hace lo mismo que el de verdad con la espera abierta: le ofrece el error a la espera en grande.
vi.mock("./siguiente", async () => {
  const { eventoError } = await import("./error-accion");
  return {
    actualizarPaso: () => undefined,
    barraActiva: () => false,
    verError: (m: HTMLElement, a?: unknown, s?: unknown) => {
      h.verError(m.textContent);
      document.dispatchEvent(eventoError(m.textContent?.trim() ?? "", a as never, s as never));
    },
  };
});
vi.mock("./qr", () => ({ precargarQr: async () => undefined, pintarQrDelComprobante: async () => true }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => false, rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined, puede3D: () => false, usa3D: () => false, usePixi: () => true }));
vi.mock("../games/pixi", () => ({
  playPixi: async (_g: unknown, _n: unknown, winners: number[]) => {
    h.juego([...winners]);
    return true;
  },
}));
vi.mock("./ver3d", () => ({ pintarVer3D: () => undefined }));
vi.mock("../protocol/firma", () => ({ prepararFirma: () => undefined, verifyRoundAsync: async () => true }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 3.5, claveNombre: (g: string) => `game.${g}`, showGameCard: () => null }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./modo-ui", () => ({ confirmarPrimerSelloOficial: async () => true, marcarSellandoAhora: () => undefined }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined, piezaParaLaSala: () => null }));
vi.mock("../stellar/monedas-eventos", () => ({ acreditarEnSegundoPlano: () => undefined }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => 0, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, enlaceParaElQr: async (l: string) => ({ ahora: l, despues: Promise.resolve(null) }), ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const boton = (): HTMLButtonElement => $("btn-draw") as HTMLButtonElement;
/** La acción grande de la espera: lanzar o volver a probar. */
const accionDeLaEspera = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(".espera .espera-accion");
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

let quitar: () => void = () => undefined;

/**
 * La página como la deja `main.ts`, con un sello retomado cuya ronda nace en 5 a 9 segundos, y la espera en grande
 * abierta. Devuelve cuánto falta para que nazca, en milisegundos, a pedido.
 */
async function montar(): Promise<{ faltaParaNacer: () => number; ronda: number; t: (k: string) => string }> {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  Element.prototype.scrollIntoView = () => undefined;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  (await import("./participants")).bindParticipants();
  (await import("./ganadores")).montarGanadores();
  (await import("./turnos")).montarTurnos();
  const freeze = await import("./freeze");
  const { draw } = await import("./draw");
  const { roundTime, targetRound } = await import("../protocol/quicknet");
  // Lo mismo que hace `main.ts` con el botón y con el lanzamiento adelantado.
  boton().addEventListener("click", () => void draw());
  const adelantar = (): void => void draw({ adelantado: true });
  document.addEventListener("tinkazo:adelantar", adelantar);
  quitar = () => document.removeEventListener("tinkazo:adelantar", adelantar);
  const ahora = Math.floor(Date.now() / 1000);
  const round = targetRound(ahora, 6);
  freeze.resumeFrozen({ names: [...V.list], listHash: V.list_hash, sealedAt: ahora, prize: "Una pizza", round, numWinners: 1, id: "7" });
  $("btn-espera").click();
  await vi.waitFor(() => expect(document.querySelector(".espera")).not.toBeNull());
  return { faltaParaNacer: () => roundTime(round) * 1000 - Date.now(), ronda: round, t: i18n.t };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
  // jsdom no trae `matchMedia`: la espera lo usa para encajar en la pantalla.
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined })) as unknown as typeof window.matchMedia;
  h.red = "mainnet";
  h.cobro = false;
  h.falta = false;
  h.aMano = false;
  h.gate.mockReset().mockResolvedValue(true);
  h.acceso.mockReset().mockResolvedValue({ sigue: true });
  h.juego.mockReset();
  h.verError.mockReset();
  h.drawOnChain.mockReset().mockReturnValue(new Promise(() => undefined));
  h.fetchRound.mockReset().mockResolvedValue({ round: V.quicknet.round, signature: V.quicknet.signature });
});

afterEach(() => {
  quitar();
  // La espera se cierra, y con ella sus escuchas: no puede quedar escuchando los errores de la prueba siguiente.
  document.querySelector<HTMLButtonElement>(".espera [data-volver]")?.click();
  history.replaceState(null, "", "/");
});

describe("el sorteo adelantado que corta en una compuerta del modo Oficial", () => {
  it("el acceso que no contesta: la espera ofrece volver a probar, y probar antes de que nazca el número vuelve a preguntar", async () => {
    h.cobro = true;
    h.acceso.mockResolvedValue({ sigue: false, clave: "errAnchor.porteroFondoSorteo" });
    const { faltaParaNacer, ronda } = await montar();
    await vi.waitFor(() => expect(accionDeLaEspera()).not.toBeNull(), { timeout: 9000, interval: 50 });
    expect(faltaParaNacer()).toBeGreaterThan(0);
    expect(h.acceso).toHaveBeenCalledTimes(1);
    accionDeLaEspera()?.click();
    // El toque de la espera no queda sin efecto: el sorteo vuelve a pasar por la compuerta.
    await vi.waitFor(() => expect(h.acceso).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await dormir(faltaParaNacer() + 700);
    // Nació el número: el botón de la página se puede tocar, y la espera sigue con su acción.
    expect(boton().disabled).toBe(false);
    expect(accionDeLaEspera()).not.toBeNull();
    // La ronda elegida nadie la pidió antes de nacer: el feed de números (issue #79) pide las anteriores,
    // la elegida es del sorteo, y el sorteo no arrancó.
    expect(h.fetchRound.mock.calls.filter(([r]) => r === ronda)).toHaveLength(0);
    expect(h.juego).not.toHaveBeenCalled();
  }, 20000);

  it("sin acceso: cuando nace el número el botón queda encendido y volver a probar desde la espera vuelve a preguntar", async () => {
    h.cobro = true;
    h.acceso.mockResolvedValue({ sigue: false, clave: "errAnchor.porteroSinAlta" });
    const { faltaParaNacer, t } = await montar();
    await vi.waitFor(() => expect(accionDeLaEspera()).not.toBeNull(), { timeout: 9000, interval: 50 });
    await dormir(faltaParaNacer() + 700);
    expect(boton().disabled).toBe(false);
    expect($("draw-status").textContent).toBe(t("errAnchor.porteroSinAlta"));
    accionDeLaEspera()?.click();
    await vi.waitFor(() => expect(h.acceso).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(h.juego).not.toHaveBeenCalled();
  }, 20000);

  it("la cuenta sin activar: si la persona sale del paso, se dice por qué y la espera y el botón ofrecen volver a probar", async () => {
    h.falta = true;
    const { faltaParaNacer, t } = await montar();
    // La persona tarda en el paso de la cuenta y sale sin activarla cuando el número ya nació.
    h.gate.mockImplementation(() => dormir(faltaParaNacer() + 300).then(() => false));
    await dormir(faltaParaNacer() + 1200);
    expect(h.gate).toHaveBeenCalledTimes(1);
    expect(h.gate.mock.calls[0]?.[0]).toBe("sorteo");
    expect(accionDeLaEspera()).not.toBeNull();
    expect(boton().disabled).toBe(false);
    expect($("draw-status").textContent).toBe(t("drawCuentaSinLista"));
    expect(h.verError).toHaveBeenCalled();
    h.gate.mockResolvedValue(true);
    accionDeLaEspera()?.click();
    await vi.waitFor(() => expect(h.gate).toHaveBeenCalledTimes(2), { timeout: 2000 });
    // Con la cuenta lista, esta vez el sorteo sale.
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1), { timeout: 4000 });
  }, 20000);
});

describe("los otros caminos del lanzamiento adelantado", () => {
  it("con la cuenta de prueba el sorteo sale solo cuando nace el número, una sola vez, y el botón no lanza otro", async () => {
    h.red = "testnet";
    const { faltaParaNacer, ronda } = await montar();
    await dormir(faltaParaNacer() + 1000);
    expect(h.gate).not.toHaveBeenCalled();
    expect(h.acceso).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // El sorteo pidió la ronda elegida una sola vez: el feed de números (issue #79) se detiene en la anterior.
    expect(h.fetchRound.mock.calls.filter(([r]) => r === ronda)).toHaveLength(1);
    expect(boton().disabled).toBe(true);
    boton().click();
    await dormir(200);
    expect(h.juego).toHaveBeenCalledTimes(1);
  }, 20000);

  it("con la billetera propia no se adelanta: cuando nace el número la espera ofrece lanzarlo, y el toque lo lanza", async () => {
    h.aMano = true;
    const { faltaParaNacer, ronda, t } = await montar();
    await dormir(faltaParaNacer() - 800);
    // La ronda elegida nadie la pidió antes de nacer: el feed pide las anteriores, la elegida es del sorteo.
    expect(h.fetchRound.mock.calls.filter(([r]) => r === ronda)).toHaveLength(0);
    expect(accionDeLaEspera()).toBeNull();
    await dormir(faltaParaNacer() + 700);
    expect(accionDeLaEspera()?.textContent).toBe(t("draw"));
    expect(boton().disabled).toBe(false);
    accionDeLaEspera()?.click();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1), { timeout: 4000 });
  }, 20000);
});
