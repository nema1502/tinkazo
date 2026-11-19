// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T, t } from "../i18n";

/**
 * El sorteo cuando la puerta del premio frena la grabación (`wallet-pollar.ts`, `PremioGuardado`). El sorteo ya está
 * sellado y el resultado se ve: lo que no sale es guardarlo. La caja de la grabación dice por qué con el texto del sorteo
 * (el ganador no cambia). Si la cuenta puede guardar dinero, volver a probar da lo mismo para siempre: la acción es Ver
 * comprobante, que abre el comprobante en otra pestaña, y no sale Guardar el sorteo ni Sortear pagando con mi cuenta (con
 * una cuenta de Google en la red principal no existe). Si no se pudo comprobar, sí se vuelve a probar.
 */

// El texto de verdad se arma con el `anchorErrorText` del sitio, que carga el SDK de Stellar en frío.
vi.setConfig({ testTimeout: 30_000 });

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sortear: vi.fn(),
  pide: vi.fn(),
  proteger: vi.fn(),
  contar: vi.fn(),
  verError: vi.fn(),
}));

vi.mock("./anchor", async () => {
  const real = await vi.importActual<typeof import("./anchor")>("./anchor");
  return {
    cuentaPatrocinada: async () => true,
    drawOnChain: async () => undefined,
    escribirError: async (status: HTMLElement, e: unknown, paso: "sello" | "sorteo") => {
      h.orden.push("escribirError");
      status.textContent = await real.anchorErrorText(e, paso);
    },
    limpiarDetalle: () => undefined,
    readDraw: async () => null,
    showTxStatus: (id: string, paso: string) => {
      const host = document.getElementById(id);
      if (host) host.textContent = paso;
    },
    stepLabel: (paso: string) => paso,
  };
});
vi.mock("./sorteo-seguro", async () => {
  const real = await vi.importActual<typeof import("./sorteo-seguro")>("./sorteo-seguro");
  return {
    sortearConReintentos: (...a: unknown[]) => h.sortear(...a),
    // La regla de verdad: el sorteo no reintenta solo la puerta del premio.
    sorteoReintentable: real.sorteoReintentable,
    avisoDelReintento: () => "drawTry",
  };
});
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/proof", async (orig) => ({
  ...(await orig<typeof import("../protocol/proof")>()),
  proofUrl: async (p: { id: string }) => `https://comprobante.test/#${p.id}`,
}));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: (...a: unknown[]) => h.pide(...a), protegerLaCuenta: (...a: unknown[]) => h.proteger(...a) }));
// `errorContable` es el de verdad: lo que se cuenta es lo que se manda, no lo que la prueba supone.
vi.mock("../contar", async (orig) => {
  const real = await orig<typeof import("../contar")>();
  return { contar: (...a: unknown[]) => h.contar(...a), contarPractica: () => undefined, errorContable: real.errorContable, refDe: () => ({}) };
});
vi.mock("./freeze", () => ({ rotarJuego: () => undefined, secondsToRound: () => 0, unfreeze: () => undefined, alElegirDespuesDelResultado: () => undefined, irAlSelectorParaOtro: () => undefined, juegoParaVerDeNuevo: () => undefined, marcarShow: () => undefined, pintarNotaDelJuego: () => undefined }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: (...a: unknown[]) => h.verError(...a) }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, rutaDe: () => "" }));

/** El error que lanza la puerta de la firma, con la forma de `PremioGuardado`. */
const premio = (que: "puede-guardar" | "no-se-sabe"): Error => Object.assign(new Error(que === "puede-guardar" ? "premio-guardado" : "premio-sin-saber"), { name: "PremioGuardado", que });

async function prepararEstado(): Promise<void> {
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: ["Ana", "Beto"], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  for (const f of [h.sortear, h.pide, h.proteger, h.contar, h.verError]) f.mockReset();
  h.pide.mockResolvedValue(false);
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><input id="nw" type="number" value="1">`;
});

const cuentas = (evento: string): number => h.contar.mock.calls.filter(([e]) => e === evento).length;
const caja = (): HTMLElement => document.getElementById("draw-status") as HTMLElement;
const principal = (): HTMLButtonElement => document.getElementById("btn-draw") as HTMLButtonElement;

describe("el sorteo frenado por la puerta del premio", () => {
  it("la cuenta puede guardar dinero: la caja dice el aviso del sorteo y la acción es abrir el comprobante, no Guardar el sorteo", async () => {
    h.sortear.mockResolvedValue({ ok: false, error: premio("puede-guardar") });
    await prepararEstado();
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    const { draw } = await import("./draw");
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(1);
    expect(caja().textContent).toBe(T.es["errAnchor.premioGuardadoSorteo"]);
    expect(caja().textContent).toContain("El ganador no cambia");
    // Dice qué hacer con el comprobante y quién paga la comisión de terminarlo.
    expect(caja().textContent).toContain("abrí el comprobante");
    expect(caja().textContent).toContain("la comisión sale de su XLM");
    expect(caja().className).toBe("txstatus bad");
    expect(principal().textContent).toBe(t("histSeeProof"));
    expect(principal().textContent).not.toBe(t("grabReintentar"));
    expect(principal().dataset.i).toBe("histSeeProof");
    expect(principal().disabled).toBe(false);
    // Una sola acción, la del comprobante, y ninguna para pagar con la cuenta.
    expect(document.getElementById("draw-propio")).toBeNull();
    expect(caja().querySelectorAll("button")).toHaveLength(0);
    const [mensaje, accion, segunda] = h.verError.mock.calls[0] as [HTMLElement, { texto: string; ejecutar: () => void }, unknown];
    expect(mensaje).toBe(caja());
    expect(accion.texto).toBe(t("histSeeProof"));
    expect(segunda).toBeUndefined();
    // Tocarla abre el comprobante de este sorteo en otra pestaña, y tocar el principal de nuevo no vuelve a grabar.
    accion.ejecutar();
    expect(abrir).toHaveBeenCalledWith("https://comprobante.test/#1", "_blank", "noopener");
    await draw();
    expect(abrir).toHaveBeenCalledTimes(2);
    expect(h.sortear).toHaveBeenCalledTimes(1);
    // Un solo fallo contado. `errorContable` es el de verdad y la lista cerrada del conteo trae la clave de la puerta
    // del premio.
    expect(cuentas("draw_failed")).toBe(1);
    expect(h.contar.mock.calls.find(([e]) => e === "draw_failed")?.[1]).toMatchObject({ error: "premioGuardado" });
  });

  it("no se pudo comprobar: el aviso del sorteo, y Guardar el sorteo vuelve a probar sin otro show", async () => {
    h.sortear.mockResolvedValue({ ok: false, error: premio("no-se-sabe") });
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(caja().textContent).toBe(T.es["errAnchor.premioSinSaberSorteo"]);
    expect(principal().textContent).toBe(t("grabReintentar"));
    expect(document.getElementById("draw-propio")).toBeNull();
    expect(h.sortear).toHaveBeenCalledTimes(1);
    // Probar de nuevo: la grabación se pide otra vez, con el sorteo que ya se jugó (y la puerta sigue sin dejar saber).
    const accion = (h.verError.mock.calls[0] as unknown[])[1] as { ejecutar: () => void };
    accion.ejecutar();
    await vi.waitFor(() => expect(h.sortear).toHaveBeenCalledTimes(2));
  });

  it("no abre la ventana de proteger la cuenta ni lo toma por un corte de la red", async () => {
    h.sortear.mockResolvedValue({ ok: false, error: premio("puede-guardar") });
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.pide).toHaveBeenCalledTimes(1);
    expect(h.proteger).not.toHaveBeenCalled();
    // El sorteo no reintenta solo: la regla de verdad (sorteoReintentable) dice que no.
    const { sorteoReintentable } = await import("./sorteo-seguro");
    expect(sorteoReintentable(premio("puede-guardar"))).toBe(false);
  });
});
