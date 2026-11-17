// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Un orden de turnos hecho sin sello no tiene comprobante (`draw.ts`): la verificación de un sorteo sin sello no lleva la
 * cantidad de ganadores y mostraría un solo turno como si fuera quien ganó. Por eso en ese caso el resultado no ofrece el
 * enlace de verificación (ni el QR, ni lo que se comparte, ni la pantalla grande) y lo dice con una línea. Un sorteo con
 * sello, y un sorteo común sin sello, siguen ofreciendo su enlace como siempre.
 */

const h = vi.hoisted(() => ({ abrirSorteo: vi.fn(), mostrarResultado: vi.fn(), pintarQr: vi.fn(async () => true), remember: vi.fn() }));
const ENLACE = "https://tinkazo.app/verificar.html#prueba";

vi.mock("./compartir", () => ({ abrirSorteo: (...a: unknown[]) => h.abrirSorteo(...a) }));
vi.mock("./pantalla", () => ({ mostrarResultado: (...a: unknown[]) => h.mostrarResultado(...a) }));
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
vi.mock("../protocol/proof", async (orig) => ({ ...(await orig<typeof import("../protocol/proof")>()), proofUrl: async () => ENLACE }));
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
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: async () => ({ ok: false, error: new Error("no") }),
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => true }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/quicknet", async (orig) => ({ ...(await orig<typeof import("../protocol/quicknet")>()), fetchRound: async () => ({ signature: "01".repeat(48) }) }));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
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
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: (...a: unknown[]) => h.pintarQr(...(a as [])) }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const beacon = { round: 1, randomness: "00".repeat(32), signature: "00" };

/** Pone el resultado en pantalla: la lista, lo que salió y si el sello entró. */
async function resultado(o: { names: string[]; winners: number[]; prize: string; sinSello?: boolean; raffleId?: bigint }): Promise<void> {
  const { app } = await import("../state");
  app.drawn = { winners: o.winners, beacon };
  app.frozen = {
    names: o.names, listHash: "00".repeat(32), ts: 1, at: "", prize: o.prize, round: 1,
    ...(o.sinSello ? { sinSello: true } : {}),
    ...(o.raffleId !== undefined ? { raffleId: o.raffleId } : {}),
  } as never;
  const { reveal } = await import("./draw");
  reveal(o.names, o.winners, beacon, "00".repeat(32));
  // El comprobante se arma aparte: se espera a que los avisos tengan su enlace.
  await vi.waitFor(() => expect(($("btn-whatsapp") as HTMLAnchorElement).href).toContain("wa.me"));
}

const mensaje = (): string => decodeURIComponent(($("btn-whatsapp") as HTMLAnchorElement).href.split("text=")[1] ?? "");
const aviso = (k: number): string => decodeURIComponent((document.querySelector<HTMLAnchorElement>(`a[data-turno="${k}"]`)?.href ?? "").split("text=")[1] ?? "");

beforeEach(() => {
  vi.resetModules();
  h.abrirSorteo.mockReset();
  h.mostrarResultado.mockReset();
  h.pintarQr.mockClear();
  h.remember.mockReset();
  sessionStorage.clear();
  history.replaceState(null, "", "/?modo=turnos&lang=es");
  Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as never;
  if (typeof window.requestAnimationFrame !== "function") window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)) as never;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

describe("un orden de turnos sin sello no ofrece verificación", () => {
  const orden = { names: nombres(12), winners: [3, 1, 0, 2, 5, 4, 7, 6, 9, 8, 11, 10], prize: "Turnos", sinSello: true };

  it("el resultado lo dice con una línea corta, en los dos idiomas, y el QR no se muestra", async () => {
    await resultado(orden);
    const nota = $("sin-sello-nota");
    expect(nota.style.display).toBe("block");
    expect(nota.textContent).toBe("Este orden no se selló antes del sorteo, así que no se puede comprobar.");
    expect(nota.dataset.i).toBe("turnsSinComprobante");
    expect($("qr-box").style.display).toBe("none");
    expect(h.pintarQr).not.toHaveBeenCalled();
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(nota.textContent).toBe(T.en.turnsSinComprobante);
    expect(nota.textContent).toBe("This order was not sealed before the draw, so it can't be checked.");
  });

  it("lo que se pega en el grupo y el aviso a cada persona no llevan enlace de verificación", async () => {
    await resultado(orden);
    expect(mensaje()).toContain("Este orden no se selló antes del sorteo, así que no se puede comprobar.");
    expect(mensaje()).not.toContain("verificar.html");
    expect(mensaje()).not.toContain("wa.me");
    expect(aviso(0)).toBe("Te tocó el turno 1 de 12. Este orden no se selló antes del sorteo, así que no se puede comprobar.\n\nSorteado con Tinkazo: https://tinkazo.app");
    expect(aviso(0)).not.toContain("verificar.html");
    expect(($("btn-email") as HTMLAnchorElement).href).not.toContain("verificar.html");
  });

  it("Compartir el resultado y Mostrar en grande tampoco llevan enlace", async () => {
    await resultado(orden);
    const { shareProof, mostrarGrande } = await import("./draw");
    shareProof();
    await vi.waitFor(() => expect(h.abrirSorteo).toHaveBeenCalled());
    const datos = h.abrirSorteo.mock.calls[0]?.[0] as { enlace: string; sinSello?: boolean };
    expect(datos.enlace).toBe("");
    expect(datos.sinSello).toBe(true);
    mostrarGrande();
    await vi.waitFor(() => expect(h.mostrarResultado).toHaveBeenCalled());
    expect(h.mostrarResultado.mock.calls[0]?.[0]).toBe("");
  });

  it("Mis sorteos no guarda el enlace de verificación: guarda el de la ronda, que no lleva comprobante", async () => {
    await resultado(orden);
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalled());
    const entrada = h.remember.mock.calls[0]?.[0] as { proof: string; sinSello?: boolean };
    expect(entrada.proof).not.toContain("verificar.html");
    expect(entrada.proof).toContain("/public/1");
    expect(entrada.sinSello).toBe(true);
  });
});

describe("lo demás sigue ofreciendo su enlace", () => {
  it("un orden de turnos con sello: el enlace va en el QR, en el mensaje y al compartir, y no hay nota de sin sello", async () => {
    await resultado({ names: nombres(12), winners: [3, 1, 0, 2, 5, 4, 7, 6, 9, 8, 11, 10], prize: "Turnos", raffleId: 5n });
    expect($("sin-sello-nota").style.display).toBe("none");
    expect(h.pintarQr).toHaveBeenCalled();
    await vi.waitFor(() => expect($("qr-box").style.display).toBe("block"));
    expect(mensaje()).toContain("verificar.html");
    expect(aviso(0)).toContain("verificar.html");
    const { shareProof, mostrarGrande } = await import("./draw");
    shareProof();
    await vi.waitFor(() => expect(h.abrirSorteo).toHaveBeenCalled());
    expect((h.abrirSorteo.mock.calls[0]?.[0] as { enlace: string }).enlace).toContain("verificar.html");
    mostrarGrande();
    await vi.waitFor(() => expect(h.mostrarResultado).toHaveBeenCalled());
    expect(String(h.mostrarResultado.mock.calls[0]?.[0])).toContain("verificar.html");
  });

  it("un sorteo común sin sello: la nota de siempre y su enlace", async () => {
    await resultado({ names: nombres(12), winners: [3], prize: "Termo", sinSello: true });
    const nota = $("sin-sello-nota");
    expect(nota.style.display).toBe("block");
    expect(nota.textContent).toBe(T.es.redSinSelloEtiqueta);
    expect(nota.dataset.i).toBe("redSinSelloEtiqueta");
    expect(h.pintarQr).toHaveBeenCalled();
    expect(mensaje()).toContain("verificar.html");
    const { shareProof } = await import("./draw");
    shareProof();
    await vi.waitFor(() => expect(h.abrirSorteo).toHaveBeenCalled());
    expect((h.abrirSorteo.mock.calls[0]?.[0] as { enlace: string }).enlace).toContain("verificar.html");
    // Y Mis sorteos lo guarda con su enlace de verificación, como siempre.
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalled());
    expect((h.remember.mock.calls[0]?.[0] as { proof: string }).proof).toContain("verificar.html");
  });
});
