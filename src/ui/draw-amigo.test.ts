// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { decodeAmigo } from "../protocol/proof";

/**
 * El resultado de un Amigo secreto (`pintarAmigo` y `reveal` en `draw.ts`). El orden sorteado es el reparto: quien
 * sale en el lugar j le regala a quien sale en el j + 1. Por eso la pantalla de quien organiza, que a veces está
 * proyectada, lista a las personas en el orden de la lista sellada y nunca en el sorteado, y cada botón copia el enlace
 * de su propia persona. El comprobante se copia, no se abre.
 */

const h = vi.hoisted(() => ({
  pintarQr: vi.fn(async () => true),
  escribir: vi.fn(async (_: string) => undefined),
  acortar: vi.fn(async () => ""),
  anotado: [] as Array<Record<string, unknown>>,
}));
const ENLACE = "https://tinkazo.app/verificar.html#prueba";

vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: () => undefined }));
vi.mock("./history", () => ({ remember: (e: Record<string, unknown>) => h.anotado.push(e), renderHistory: () => undefined }));
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
  acortar: (...a: unknown[]) => h.acortar(...(a as [])),
  alAcortar: () => undefined,
  cortoGuardado: () => null,
  ponerLogoDeRuta: () => undefined,
  rutaDe: () => "",
}));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const beacon = { round: 7, randomness: "00".repeat(32), signature: "00" };

/** Seis personas en el orden pegado, y un orden sorteado que no se parece a ese. */
const NOMBRES = ["Ana", "Beto", "Carla", "Diego", "Eva", "Fabio"];
const SORTEADO = [3, 0, 5, 1, 4, 2];

/** Pone el resultado en pantalla: la lista, lo que salió y si el sello entró. */
async function resultado(
  o: { names?: string[]; winners?: number[]; prize?: string; raffleId?: bigint; noCoincide?: boolean; sinSello?: boolean } = {},
): Promise<void> {
  const names = o.names ?? NOMBRES;
  const winners = o.winners ?? SORTEADO;
  const { app } = await import("../state");
  app.drawn = { winners, beacon, ...(o.noCoincide ? { noCoincide: true } : {}) };
  app.frozen = {
    names, listHash: "00".repeat(32), ts: 1, at: "", prize: o.prize ?? "Amigo secreto", round: 7,
    ...(o.sinSello ? { sinSello: true } : { raffleId: o.raffleId ?? 5n }),
  } as never;
  const { reveal } = await import("./draw");
  reveal(names, winners, beacon, "00".repeat(32));
  // El comprobante se arma aparte: se espera a que los avisos tengan su enlace. En duda, a que se apaguen.
  if (o.noCoincide) await vi.waitFor(() => expect($("btn-whatsapp").getAttribute("aria-disabled")).toBe("true"));
  else await vi.waitFor(() => expect(($("btn-whatsapp") as HTMLAnchorElement).href).toContain("wa.me"));
}

const filas = (): HTMLLIElement[] => [...document.querySelectorAll<HTMLLIElement>("#winner-cards .amigo-fila")];
const nombreDe = (li: HTMLLIElement): string => li.querySelector(".winner-name")?.textContent ?? "";
const botonDe = (nombre: string): HTMLButtonElement => {
  const fila = filas().find((li) => nombreDe(li) === nombre);
  return fila?.querySelector<HTMLButtonElement>("[data-amigo-enlace]") as HTMLButtonElement;
};
const comprobante = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>("#amigo-aviso [data-amigo-comprobante]") as HTMLButtonElement;

/** Lo último que quedó en el portapapeles. */
const copiado = (): string => String(h.escribir.mock.calls.at(-1)?.[0] ?? "");

/** El enlace personal que quedó en el portapapeles, leído como lo lee `confirmar.html`. */
async function parteCopiada(): Promise<{ from: string; to: string; round: number }> {
  return decodeAmigo(copiado().split("#")[1] ?? "");
}

beforeEach(() => {
  vi.resetModules();
  h.anotado.length = 0;
  h.pintarQr.mockClear();
  h.escribir.mockReset();
  h.acortar.mockClear();
  h.escribir.mockImplementation(async () => undefined);
  sessionStorage.clear();
  history.replaceState(null, "", "/?modo=turnos&lang=es");
  Element.prototype.scrollIntoView = () => undefined;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: (s: string) => h.escribir(s) }, configurable: true });
  // El Blob de jsdom no sabe dar un stream: los enlaces van sin comprimir, como en un navegador sin CompressionStream.
  vi.stubGlobal("CompressionStream", undefined);
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as never;
  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)) as never;
  }
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el resultado de un Amigo secreto no muestra el reparto", () => {
  it("las filas siguen el orden de la lista pegada, no el sorteado", async () => {
    await resultado();
    expect(filas().map(nombreDe)).toEqual(NOMBRES);
    expect(filas().map(nombreDe)).not.toEqual(SORTEADO.map((i) => NOMBRES[i]));
  });

  it("la lista no va numerada ni guarda el orden sorteado en el DOM", async () => {
    await resultado();
    const lista = document.querySelector("#winner-cards .amigo-lista");
    expect(lista?.tagName).toBe("UL");
    expect(filas().some((li) => li.hasAttribute("value"))).toBe(false);
    expect(filas().map((li) => li.querySelector<HTMLElement>("[data-amigo-enlace]")?.dataset.amigoEnlace)).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("cada botón copia el enlace de su propia persona, con a quién le regala", async () => {
    await resultado();
    // El reparto de SORTEADO: Diego, Ana, Fabio, Beto, Eva y Carla, cada uno al que sigue, y Carla a Diego.
    const esperado: Record<string, string> = { Diego: "Ana", Ana: "Fabio", Fabio: "Beto", Beto: "Eva", Eva: "Carla", Carla: "Diego" };
    for (const nombre of NOMBRES) {
      const antes = h.escribir.mock.calls.length;
      botonDe(nombre).click();
      await vi.waitFor(() => expect(h.escribir.mock.calls.length).toBe(antes + 1));
      const parte = await parteCopiada();
      expect(parte.from).toBe(nombre);
      expect(parte.to).toBe(esperado[nombre]);
      expect(parte.round).toBe(7);
    }
  });

  it("lo copiado dice qué es, en una línea antes del enlace", async () => {
    await resultado();
    botonDe("Ana").click();
    await vi.waitFor(() => expect(h.escribir).toHaveBeenCalled());
    expect(copiado().startsWith("Tu amigo secreto: http")).toBe(true);
    expect(copiado()).toContain("/confirmar.html#");
  });

  it("la fila copiada queda en Copiado, también al cambiar de idioma", async () => {
    await resultado();
    const b = botonDe("Beto");
    b.click();
    await vi.waitFor(() => expect(b.textContent).toBe(T.es.copied));
    expect(b.closest("li")?.classList.contains("copiado")).toBe(true);
    expect(botonDe("Ana").textContent).toBe(T.es.amigoCopiar);
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(b.textContent).toBe(T.en.copied);
    expect(botonDe("Ana").textContent).toBe(T.en.amigoCopiar);
  });

  it("sin permiso para el portapapeles, el enlace queda en un solo cuadro debajo de su fila", async () => {
    await resultado();
    h.escribir.mockImplementation(async () => {
      throw new Error("sin permiso");
    });
    const b = botonDe("Carla");
    b.click();
    await vi.waitFor(() => expect(b.closest("li")?.querySelectorAll("textarea").length).toBe(1));
    b.click();
    await vi.waitFor(() => expect(h.escribir).toHaveBeenCalledTimes(2));
    expect(b.closest("li")?.querySelectorAll("textarea").length).toBe(1);
    expect(b.closest("li")?.querySelector("textarea")?.value).toContain("/confirmar.html#");
  });

  it("la marca es-amigo se pone en el Amigo secreto y se va con un sorteo común", async () => {
    await resultado();
    expect($("winner-box").classList.contains("es-amigo")).toBe(true);
    await resultado({ winners: [2], prize: "Termo" });
    expect($("winner-box").classList.contains("es-amigo")).toBe(false);
  });

  it("Copiar el comprobante copia el enlace largo y no lo abre en la pantalla", async () => {
    await resultado();
    const antes = location.href;
    const b = comprobante();
    await vi.waitFor(() => expect(b.disabled).toBe(false));
    expect(b.textContent).toBe(T.es.amigoVerComprobante);
    b.click();
    await vi.waitFor(() => expect(copiado()).toBe(ENLACE));
    await vi.waitFor(() => expect(b.textContent).toBe(T.es.copied));
    expect(location.href).toBe(antes);
  });

  it("con lo grabado en duda, ni los enlaces ni el comprobante se copian", async () => {
    await resultado({ noCoincide: true });
    await vi.waitFor(() => expect(botonDe("Ana").disabled).toBe(true));
    expect(comprobante().disabled).toBe(true);
    botonDe("Ana").click();
    comprobante().click();
    expect(h.escribir).not.toHaveBeenCalled();
  });
});

describe("la fila de lo que sigue en un Amigo secreto", () => {
  /** Lo que se ve del resultado: sin `display: none` en el elemento ni en un contenedor suyo, dentro de la caja del resultado. */
  const seVe = (id: string): boolean => {
    for (let el: HTMLElement | null = $(id); el && el.id !== "winner-box"; el = el.parentElement) if (el.style.display === "none" || el.hidden) return false;
    return true;
  };
  const plegar = async (): Promise<void> => (await import("./plegable")).initPlegables();

  it("no queda «Compartir el resultado», que no hace nada en este modo, ni el título ni la línea de debajo", async () => {
    await plegar();
    await resultado();
    expect(seVe("btn-proof")).toBe(false);
    expect(seVe("again-t")).toBe(false);
    expect(seVe("again-left")).toBe(false);
    expect(seVe("again-sigue")).toBe(false);
  });

  it("queda «Usar otra lista» a la vista, fuera del pliegue de copiar el mensaje y el correo", async () => {
    await plegar();
    await resultado();
    expect($("btn-again-nueva").parentElement?.id).toBe("again-acciones");
    expect(seVe("btn-again-nueva")).toBe(true);
    expect(seVe("btn-copy")).toBe(false);
    expect(seVe("btn-email")).toBe(false);
  });

  it("un sorteo común después, en la misma pestaña, vuelve a mostrar todo como siempre", async () => {
    await plegar();
    await resultado();
    await resultado({ winners: [2], prize: "Termo" });
    expect(seVe("btn-proof")).toBe(true);
    expect(seVe("again-t")).toBe(true);
    expect(seVe("again-left")).toBe(true);
    expect($("again-left").textContent).not.toBe("");
    expect($("btn-again-nueva").closest("#mas-resultado")).not.toBeNull();
    expect(seVe("mas-resultado")).toBe(true);
  });
});

describe("lo que el resultado de un Amigo secreto anota en Mis sorteos", () => {
  it("los lugares y no los nombres en el orden sorteado: con ellos Mis sorteos rehace los enlaces", async () => {
    await resultado();
    await vi.waitFor(() => expect(h.anotado.length).toBeGreaterThan(0));
    const fila = h.anotado.at(-1) ?? {};
    expect(fila.winners).toBeUndefined();
    expect(fila.winnerIdx).toEqual(SORTEADO);
  });

  it("un sorteo común sigue anotando los nombres de quienes salieron", async () => {
    await resultado({ winners: [2], prize: "Termo" });
    await vi.waitFor(() => expect(h.anotado.length).toBeGreaterThan(0));
    expect(h.anotado.at(-1)?.winners).toEqual(["Carla"]);
  });
});

describe("el resultado de un Amigo secreto no ofrece el comprobante por QR", () => {
  it("con sello, el QR de comprobar no se pinta y su recuadro queda escondido", async () => {
    await resultado();
    expect(h.pintarQr).not.toHaveBeenCalled();
    expect($("qr-box").style.display).toBe("none");
  });

  it("el enlace corto no se pide: sería una copia del reparto en el servidor", async () => {
    await resultado();
    const { adelantarCorto } = await import("./draw");
    adelantarCorto();
    expect(h.acortar).not.toHaveBeenCalled();
  });

  it("un sorteo común con sello sigue pintando su QR", async () => {
    await resultado({ winners: [2], prize: "Termo" });
    expect(h.pintarQr).toHaveBeenCalled();
    await vi.waitFor(() => expect($("qr-box").style.display).toBe("block"));
  });

  it("sin sello lo dice en una línea corta y no ofrece el comprobante", async () => {
    await resultado({ sinSello: true });
    const nota = $("sin-sello-nota");
    expect(nota.style.display).toBe("block");
    expect(nota.textContent).toBe("Sin sello: este amigo secreto no se puede comprobar.");
    expect($("amigo-aviso").style.display).toBe("none");
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(nota.textContent).toBe("No seal: this Secret Santa can't be checked.");
  });
});
