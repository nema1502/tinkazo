// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «No está» y «Siguiente premio» con una lista repartida: quien salió se va con todas sus
 * participaciones, no una línea por vez (`draw.ts` sobre `src/participaciones.ts`). Se prueban con
 * `?modo=varias` en la dirección, que es cuando la lista se lee por persona; sin la bandera, cada
 * línea se va por su cuenta (probado en `src/participaciones.test.ts`).
 */

const h = vi.hoisted(() => ({ unfreeze: vi.fn(), abrirSorteo: vi.fn() }));

vi.mock("./compartir", () => ({ abrirSorteo: (...a: unknown[]) => h.abrirSorteo(...a) }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));

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
  sortearConReintentos: async (o: { intentar: () => Promise<unknown> }) => {
    try {
      return { ok: true, valor: await o.intentar() };
    } catch (error) {
      return { ok: false, error };
    }
  },
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => true }));
vi.mock("../stellar/errores", async (orig) => ({ ...(await orig<typeof import("../stellar/errores")>()), errorKey: () => "porteroFondo" }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: (...a: unknown[]) => h.unfreeze(...a),
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
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

// La lista repartida de siempre: Ana con tres participaciones, Beto y Carla con una cada uno.
const REPARTIDA = ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla"];

async function preparar(winners: number[]): Promise<void> {
  const { app } = await import("../state");
  app.drawn = { winners, beacon: { round: 1, randomness: "00", signature: "00" } };
  app.frozen = { names: REPARTIDA, listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
}

beforeEach(() => {
  vi.resetModules();
  h.unfreeze.mockReset();
  h.abrirSorteo.mockReset();
  // La dirección trae el modo, y jsdom no tiene scrollIntoView.
  history.replaceState(null, "", "/?modo=varias");
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<textarea id="ta"></textarea><input id="nw" type="number" value="1"><button id="btn-draw"></button><button id="btn-freeze"></button>' +
    '<div id="again-note"></div><div id="draw-status"></div><div id="reverify-out"></div><div id="again-row"></div>' +
    '<div id="winner-box"></div><div id="lore-box"></div><div id="leyenda-box"></div><div id="qr-box"></div>' +
    '<div id="sec-draw"></div><div id="winner-cards"></div><div id="sec-participants"></div><details id="mas-resultado"></details>' +
    '<div id="sec-history"></div>' +
    '<button id="btn-recuperar"></button>';
});

describe("«No está» y «Siguiente premio» con una persona repartida", () => {
  it("«No está» saca a la persona entera, con todas sus participaciones", async () => {
    // Ganó «Ana (2/3)»: Ana se va entera, no queda su (1/3) ni su (3/3).
    await preparar([1]);
    const { newDraw } = await import("./draw");
    newDraw("ausente", 0);
    expect(h.unfreeze).toHaveBeenCalledWith("Beto\nCarla");
  });

  it("«Siguiente premio» tampoco la reparte de nuevo: sus líneas ya no están", async () => {
    // Salieron «Ana (1/3)» y «Beto»: quedan «Carla» y «Digo», sin rastro de Ana.
    const { app } = await import("../state");
    await preparar([0, 3]);
    app.frozen = { names: [...REPARTIDA, "Digo"], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
    const { newDraw } = await import("./draw");
    newDraw("sinGanadores");
    expect(h.unfreeze).toHaveBeenCalledWith("Carla\nDigo");
  });

  it("después de volver de entrar, sin el parámetro en la dirección, «No está» saca a la persona entera", async () => {
    // La primera visita trae `?modo=varias` y deja el modo recordado en la pestaña.
    const { modesVisible } = await import("../modos/bandera");
    expect(modesVisible()).toBe(true);
    // Volver de entrar con Google: la dirección es `/`, sin el parámetro, y la página nace de nuevo.
    history.replaceState(null, "", "/");
    vi.resetModules();
    await preparar([1]);
    const { newDraw } = await import("./draw");
    newDraw("ausente", 0);
    expect(h.unfreeze).toHaveBeenCalledWith("Beto\nCarla");
  });
});

describe("«No está» sobre alguien que salió más de una vez", () => {
  const CINCO = ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla", "Dani", "Eva"];

  async function con(winners: number[]): Promise<void> {
    const { app } = await import("../state");
    app.drawn = { winners, beacon: { round: 1, randomness: "00", signature: "00" } };
    app.frozen = { names: CINCO, listHash: "00".repeat(32), ts: 1, at: "", prize: "Una polera", round: 1, raffleId: 1n } as never;
  }

  it("Ana salió en el #1 y en el #3 y no está: se sortean de nuevo sus dos premios, y la nota lo dice", async () => {
    await con([0, 3, 2]);
    const { newDraw } = await import("./draw");
    newDraw("ausente", 0);
    // Ana se va entera, y también Beto, que ya se llevó lo suyo.
    expect(h.unfreeze).toHaveBeenCalledWith("Carla\nDani\nEva");
    expect((document.getElementById("nw") as HTMLInputElement).value).toBe("2");
    expect(document.getElementById("again-note")?.textContent).toContain("sus 2 premios se sortean de nuevo");
  });

  it("en inglés, la nota también dice los dos premios", async () => {
    history.replaceState(null, "", "/?modo=varias&lang=en");
    await con([0, 3, 2]);
    const { setLang } = await import("../idioma");
    setLang("en");
    const { newDraw } = await import("./draw");
    newDraw("ausente", 0);
    expect(document.getElementById("again-note")?.textContent).toContain("their 2 prizes are drawn again");
  });

  it("quien salió una sola vez sigue reponiendo un premio", async () => {
    await con([0, 3, 2]);
    const { newDraw } = await import("./draw");
    newDraw("ausente", 1);
    expect((document.getElementById("nw") as HTMLInputElement).value).toBe("1");
    expect(document.getElementById("again-note")?.textContent).toContain("su premio se sortea de nuevo");
  });
});

describe("sin modos a la vista, la lectura por persona es la de la cuenta", () => {
  async function sinModos(names: string[], winners: number[]): Promise<void> {
    history.replaceState(null, "", "/");
    sessionStorage.clear();
    vi.resetModules();
    const { app } = await import("../state");
    app.drawn = { winners, beacon: { round: 1, randomness: "00", signature: "00" } };
    app.frozen = { names, listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
    document.body.innerHTML +=
      '<div id="motion-note"></div><p id="proof"></p><a id="drand-link"></a>' +
      '<div id="again-acciones"><button id="btn-again-sin"></button><button id="btn-proof"></button></div>' +
      '<button id="btn-again-nueva"></button><h3 id="again-t"></h3><p id="again-left"></p><p id="again-sigue"></p>' +
      '<a id="btn-whatsapp"></a><a id="btn-email"></a><div id="sin-sello-nota"></div><img id="qr-img"><div id="sec-history"></div>';
  }

  it("una lista hecha toda de marcas que cierran se lee sin marca en las tarjetas, en el mensaje y al compartir", async () => {
    const names = ["Mesa 1 (1/2)", "Mesa 1 (2/2)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"];
    await sinModos(names, [0, 2]);
    const { reveal, shareProof } = await import("./draw");
    reveal(names, [0, 2], { round: 1, randomness: "00", signature: "00" }, "00".repeat(32));
    expect(document.getElementById("winner-cards")?.textContent).toContain("Mesa 1");
    expect(document.getElementById("winner-cards")?.textContent).not.toContain("(1/2)");
    let copiado = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void (copiado = s) } });
    const { copySummary } = await import("./draw");
    await copySummary(document.createElement("button"));
    expect(copiado).toContain("Mesa 1");
    expect(copiado).not.toContain("(1/2)");
    shareProof();
    await vi.waitFor(() => expect(h.abrirSorteo).toHaveBeenCalled());
    expect(h.abrirSorteo.mock.calls[0]?.[0]).toMatchObject({ ganadores: ["Mesa 1", "Mesa 2"] });
  });

  it("«Siguiente premio» cuenta lo que queda como el cuadro: quedan 2 personas, no 4 líneas", async () => {
    // Salió Mesa 1 entera: quedan «Mesa 2 (1/2)» a «Mesa 3 (2/2)», que el cuadro cuenta como 2 personas y 4 participaciones.
    const names = ["Mesa 1 (1/2)", "Mesa 1 (2/2)", "Mesa 2 (1/2)", "Mesa 2 (2/2)", "Mesa 3 (1/2)", "Mesa 3 (2/2)"];
    await sinModos(names, [0, 1]);
    const { reveal, newDraw } = await import("./draw");
    reveal(names, [0, 1], { round: 1, randomness: "00", signature: "00" }, "00".repeat(32));
    expect(document.getElementById("btn-again-sin")?.textContent).toBe("Siguiente premio (quedan\xa02)");
    expect(document.getElementById("again-left")?.textContent).toContain("2");
    expect(document.getElementById("again-left")?.textContent).not.toContain("4");
    newDraw("sinGanadores");
    // Se saca por línea, como siempre sin los modos, y la nota dice el número del cuadro.
    expect(h.unfreeze).toHaveBeenCalledWith("Mesa 2 (1/2)\nMesa 2 (2/2)\nMesa 3 (1/2)\nMesa 3 (2/2)");
    const { cuentaParaMostrar } = await import("../participaciones");
    const cuadro = cuentaParaMostrar(String(h.unfreeze.mock.calls[0]?.[0]).split("\n"), false).personas;
    expect(cuadro).toBe(2);
    expect(document.getElementById("again-note")?.textContent).toMatch(/Quedan 2\.$/);
  });

  it("una lista común con marcas junto a nombres sueltos se lee tal cual en todos lados", async () => {
    const names = ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Ana", "Beto"];
    await sinModos(names, [0, 1]);
    const { reveal } = await import("./draw");
    reveal(names, [0, 1], { round: 1, randomness: "00", signature: "00" }, "00".repeat(32));
    expect(document.getElementById("winner-cards")?.textContent).toContain("Grupo 4 (1/2)");
    let copiado = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void (copiado = s) } });
    const { copySummary } = await import("./draw");
    await copySummary(document.createElement("button"));
    expect(copiado).toContain("Grupo 4 (1/2)");
  });

  it("quien salió dos veces va una sola vez en el mensaje y en el aviso, con su cuenta", async () => {
    const names = ["Mesa 1 (1/2)", "Mesa 1 (2/2)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"];
    await sinModos(names, [0, 1]);
    const { reveal, copySummary } = await import("./draw");
    reveal(names, [0, 1], { round: 1, randomness: "00", signature: "00" }, "00".repeat(32));
    let copiado = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void (copiado = s) } });
    await copySummary(document.createElement("button"));
    expect(copiado).toContain("Mesa 1 (2 veces)");
    expect(copiado).not.toContain("Mesa 1 y Mesa 1");
    // Una sola persona nombrada: en singular, como la tarjeta del evento («Ganó Mesa 1 (2 veces)»).
    expect(copiado).toContain("ganó Mesa 1 (2 veces)");
    expect(copiado).not.toContain("ganaron");
    await vi.waitFor(() => {
      const aviso = decodeURIComponent(document.querySelector<HTMLAnchorElement>("#btn-whatsapp")?.href ?? "");
      expect(aviso).toContain("¡Ganaste, Mesa 1 (2 veces)! Te llevás");
    });
  });
});

describe("lo que se comparte después de sellar un reparto con nombres a secas", () => {
  it("la foto y el mensaje de «Compartir» llevan 3 personas y 5 participaciones", async () => {
    await preparar([1]);
    const { shareProof } = await import("./draw");
    shareProof();
    await vi.waitFor(() => expect(h.abrirSorteo).toHaveBeenCalled());
    expect(h.abrirSorteo.mock.calls[0]?.[0]).toMatchObject({ personas: 3, total: 5 });
  });

  it("«Copiar el mensaje» dice las mismas dos cuentas", async () => {
    await preparar([1]);
    let copiado = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void (copiado = s) } });
    const { copySummary } = await import("./draw");
    await copySummary(document.createElement("button"));
    expect(copiado).toContain("entre 5 participaciones de 3 personas");
  });

  it("con sufijos que no cierran, «Copiar el mensaje» cuenta líneas, como la verificación", async () => {
    // Falta «Ana (2/3)»: la verificación muestra la lista línea por línea, y el mensaje no puede decir otra cosa.
    const { app } = await import("../state");
    app.drawn = { winners: [3], beacon: { round: 1, randomness: "00", signature: "00" } };
    app.frozen = { names: ["Ana (1/3)", "Ana (3/3)", "Beto", "Carla"], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
    let copiado = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void (copiado = s) } });
    const { copySummary } = await import("./draw");
    await copySummary(document.createElement("button"));
    expect(copiado).toContain("entre 4 personas");
    expect(copiado).not.toContain("participaciones");
  });
});
