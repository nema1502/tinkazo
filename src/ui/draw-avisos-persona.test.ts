// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";

/**
 * Los avisos por WhatsApp y por correo del resultado (`draw.ts`) con una lista de líneas de persona: no hay a quién
 * escribirle, porque de esas personas no se tiene ni el correo ni el teléfono y el premio se entrega en mano. Por eso el
 * resultado no ofrece ninguno de los dos, ni cuando llega el enlace corto. Lo demás del resultado queda igual, y con una
 * lista de nombres los dos avisos siguen como siempre.
 */

const h = vi.hoisted(() => ({
  pintarQr: vi.fn(async () => true),
  alAcortar: null as null | ((ruta: string, c: { corto: string }) => void),
}));
const ENLACE = "https://tinkazo.app/verificar.html#prueba";
const CORTO = "https://tinkazo.app/c/abc123";

vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: () => undefined }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
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
vi.mock("../enlace-corto", () => ({
  acortar: async () => "",
  alAcortar: (f: (ruta: string, c: { corto: string }) => void) => {
    h.alAcortar = f;
  },
  cortoGuardado: () => null,
  ponerLogoDeRuta: () => undefined,
  rutaDe: () => "ruta-del-comprobante",
}));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const LINEAS = [1, 2, 3, 4, 5, 6].map((n) => lineaDePrueba(n));
const NOMBRES = ["Ana", "Beto", "Carla", "Dora", "Eva", "Fede"];
const beacon = { round: 1, randomness: "00".repeat(32), signature: "00" };
const wa = (): HTMLAnchorElement => document.getElementById("btn-whatsapp") as HTMLAnchorElement;
const correo = (): HTMLAnchorElement => document.getElementById("btn-email") as HTMLAnchorElement;

/** Pone el resultado en pantalla y espera a que el comprobante esté armado: el QR se pinta justo después de los avisos. */
async function resultado(names: string[], winners: number[]): Promise<void> {
  const { app } = await import("../state");
  app.drawn = { winners, beacon };
  app.frozen = { names, listHash: "00".repeat(32), ts: 1, at: "", prize: "Auriculares", round: 1, raffleId: 7n } as never;
  h.pintarQr.mockClear();
  const { reveal } = await import("./draw");
  reveal(names, winners, beacon, "00".repeat(32));
  await vi.waitFor(() => expect(h.pintarQr).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetModules();
  h.pintarQr.mockClear();
  h.alAcortar = null;
  sessionStorage.clear();
  history.replaceState(null, "", "/?lang=es");
  Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as never;
  if (typeof window.requestAnimationFrame !== "function") window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)) as never;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

describe("el resultado de una lista de personas", () => {
  it("no ofrece avisar por WhatsApp ni por correo: no hay a quién escribirle", async () => {
    await resultado(LINEAS, [1, 4]);
    for (const a of [wa(), correo()]) {
      expect(a.hidden, a.id).toBe(true);
      expect(a.getAttribute("href"), a.id).toBeNull();
    }
  });

  it("la hoja de estilos los saca de la pantalla: el atributo solo no alcanza contra el estilo del botón", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    // Los dos son `a.ghost`, que fija su `display`: sin esta regla quedarían a la vista, apagados y sin enlace.
    expect(css).toMatch(/\ba\.ghost \{ display: inline-block;/u);
    expect(css).toMatch(/#btn-whatsapp\[hidden\], #btn-email\[hidden\] \{ display: none; \}/u);
  });

  it("lo demás del resultado queda: el QR para comprobar y copiar el mensaje", async () => {
    await resultado(LINEAS, [1]);
    await vi.waitFor(() => expect(document.getElementById("qr-box")?.style.display).toBe("block"));
    const copiar = document.getElementById("btn-copy") as HTMLButtonElement;
    expect(copiar.hidden).toBe(false);
    expect(copiar.disabled).toBe(false);
  });

  it("cuando llega el enlace corto, los avisos siguen sin ofrecerse", async () => {
    await resultado(LINEAS, [2]);
    expect(h.alAcortar).not.toBeNull();
    h.alAcortar?.("ruta-del-comprobante", { corto: CORTO });
    for (const a of [wa(), correo()]) {
      expect(a.hidden, a.id).toBe(true);
      expect(a.getAttribute("href"), a.id).toBeNull();
    }
  });
});

describe("el resultado de una lista de nombres queda como siempre", () => {
  it("los dos avisos están a la vista con su mensaje y su enlace", async () => {
    await resultado(NOMBRES, [1]);
    expect(wa().hidden).toBe(false);
    expect(correo().hidden).toBe(false);
    expect(wa().href).toContain("https://wa.me/?text=");
    expect(decodeURIComponent(wa().href)).toContain("Beto");
    expect(decodeURIComponent(wa().href)).toContain("verificar.html");
    expect(correo().href).toMatch(/^mailto:\?subject=/);
  });

  it("después de un sorteo de personas, uno con nombres vuelve a ofrecer los dos avisos", async () => {
    await resultado(LINEAS, [3]);
    expect(wa().hidden).toBe(true);
    await resultado(NOMBRES, [0]);
    expect(wa().hidden).toBe(false);
    expect(correo().hidden).toBe(false);
    expect(wa().href).toContain("https://wa.me/?text=");
    expect(correo().href).toMatch(/^mailto:\?subject=/);
  });
});
