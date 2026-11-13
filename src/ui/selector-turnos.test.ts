// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El selector de juegos con un orden de turnos (`freeze.ts`): se ofrecen los que lo cuentan bien (ruleta, chovena, Guajojó y
 * carrera) y los demás se ven apagados, con su motivo a la vista y sin poder elegirse. Si quedó elegido uno de esos (el de
 * otro sorteo), pasa solo a uno que sirva. El sorteo común no cambia en nada.
 */

vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async () => undefined,
  hideTxStatus: () => undefined,
  margenParaAprobar: async () => 0,
  pagaElPortero: async () => false,
  precargarParaElSorteo: () => undefined,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: async () => {
    throw new Error("boom");
  },
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sello-seguro", async (orig) => ({ ...(await orig<typeof import("./sello-seguro")>()), leerPendiente: () => null, guardarPendiente: () => undefined, sellarSinDuplicar: async () => ({ raffleId: 1n, txHash: "H", round: 1, ts: 1 }) }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 3, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({ apruebaAMano: () => false, canAnchor: () => true, claveDeSellar: () => "freeze", currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./participants", () => ({ cerrarLista: () => undefined, olvidarBorrador: () => undefined, parseNames: () => [], setList: () => undefined }));
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
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: () => undefined }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => true }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./gamecard", () => ({ claveNombre: (g: string) => `game.${g}` }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

const JUEGOS = ["race", "sapo", "trompo", "chovena", "pinata", "wheel", "quien", "trueque", "teleferico", "oruro", "guajojo", "toborochi"];
const OFRECIDOS = ["wheel", "chovena", "guajojo"];
const APAGADOS = ["sapo", "trompo", "pinata", "teleferico", "oruro", "toborochi", "race"];

const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`);

/** La página con los botones del selector, el campo de cuántos ganan y el del premio. */
function armarPagina(premio: string, ganan: number): void {
  document.body.innerHTML =
    `<button id="btn-freeze"></button><input id="prize" value="${premio}"><input id="nw" type="number" value="${ganan}">` +
    ["rec-head", "rec-sel-nota", "juego-actual", "wheel-cap"].map((id) => `<div id="${id}"></div>`).join("") +
    `<p id="juego-nota" hidden></p><div id="gamepick">${JUEGOS.map((g) => `<button id="g-${g}"${g === "race" ? ' class="on"' : ""}><span>${g}</span></button>`).join("")}</div>`;
  Element.prototype.scrollIntoView = () => undefined;
}

const boton = (g: string): HTMLButtonElement => document.getElementById(`g-${g}`) as HTMLButtonElement;
const nota = (g: string): HTMLElement | null => boton(g).querySelector(".rec-nota");

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/?lang=es");
  sessionStorage.clear();
});

describe("el selector con un orden de turnos", () => {
  it("con 18 turnos solo se ofrecen la ruleta, la chovena y el Guajojó: los demás quedan apagados", async () => {
    armarPagina("Turnos", 18);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(18));
    for (const g of OFRECIDOS) {
      expect(boton(g).disabled, g).toBe(false);
      expect(boton(g).classList.contains("atenuado"), g).toBe(false);
    }
    for (const g of APAGADOS) {
      expect(boton(g).disabled, g).toBe(true);
      expect(boton(g).classList.contains("atenuado"), g).toBe(true);
    }
    // Los botones que ya no están en el selector (De pie y El Trueque, ocultos) no se tocan.
    expect(boton("quien").disabled).toBe(false);
    expect(boton("trueque").disabled).toBe(false);
  });

  it("cada tarjeta apagada dice su motivo a la vista, no solo para el lector de pantalla", async () => {
    armarPagina("Turnos", 18);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(18));
    for (const g of APAGADOS) {
      const n = nota(g);
      expect(n, g).not.toBeNull();
      expect(n?.classList.contains("sr-only"), g).toBe(false);
      expect(n?.classList.contains("rec-nota-vista"), g).toBe(true);
      expect((n?.textContent ?? "").length, g).toBeGreaterThan(10);
    }
    expect(nota("pinata")?.textContent).toBe(T.es["rec.sinTurnos"]);
    expect(nota("sapo")?.textContent).toBe("Con 18 turnos no entra: la mesa del sapo tiene 12 agujeros.");
    expect(nota("race")?.textContent).toBe("Con 18 turnos no entra: la carrera tiene 8 carriles.");
    // Las notas de lo que se ofrece siguen para el lector de pantalla, como siempre.
    expect(nota("chovena")?.classList.contains("sr-only")).toBe(true);
  });

  it("los motivos se vuelven a escribir al cambiar de idioma", async () => {
    armarPagina("Turnos", 18);
    const { pintarRecomendacion, refrescarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(18));
    const { app } = await import("../state");
    const { setLang } = await import("../i18n");
    // Primero el idioma, sin lista sellada: los demás textos de la página que siguen al idioma leen la lista sellada.
    setLang("en");
    app.frozen = { names: nombres(18), listHash: "00", ts: 1, at: "", prize: "Turnos", round: 1 } as never;
    refrescarRecomendacion();
    expect(nota("pinata")?.textContent).toBe("This game is for prizes.");
    expect(boton("pinata").disabled).toBe(true);
  });

  it("con 5 turnos la carrera entra (tiene ocho carriles) y sigue ofrecida", async () => {
    armarPagina("Turnos", 5);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(5));
    expect(boton("race").disabled).toBe(false);
    expect(boton("pinata").disabled).toBe(true);
  });

  it("con más de doscientos turnos no se apaga nada: sortear tiene que seguir siendo posible", async () => {
    armarPagina("Turnos", 250);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(250));
    for (const g of JUEGOS) expect(boton(g).disabled, g).toBe(false);
  });

  it("un sorteo común no cambia: nada se apaga y los motivos siguen solo para el lector de pantalla", async () => {
    armarPagina("Termo", 1);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(18));
    for (const g of JUEGOS) expect(boton(g).disabled, g).toBe(false);
    expect(document.querySelectorAll(".rec-nota-vista")).toHaveLength(0);
    expect(document.querySelectorAll("[data-sin-turnos]")).toHaveLength(0);
  });

  it("al pasar a una lista común se vuelve a encender lo que este modo apagó, y solo eso", async () => {
    armarPagina("Turnos", 18);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(18));
    expect(boton("trompo").disabled).toBe(true);
    // La ruleta apagada por su tope de nombres no es cosa de los turnos: nadie la vuelve a encender acá.
    boton("wheel").disabled = true;
    (document.getElementById("prize") as HTMLInputElement).value = "Termo";
    (document.getElementById("nw") as HTMLInputElement).value = "1";
    pintarRecomendacion(nombres(18));
    for (const g of JUEGOS.filter((x) => x !== "wheel")) expect(boton(g).disabled, g).toBe(false);
    expect(boton("wheel").disabled).toBe(true);
    expect(nota("trompo")?.classList.contains("sr-only")).toBe(true);
  });
});

describe("un juego apagado que estaba elegido pasa solo a uno que sirva", () => {
  const con = async (juego: string, premio = "Turnos", ganan = 18, n = 18) => {
    armarPagina(premio, ganan);
    const { app } = await import("../state");
    const f = await import("./freeze");
    f.pintarRecomendacion(nombres(n));
    app.game = juego as never;
    return { app, f };
  };

  it("el trompo, la piñata o el sapo elegidos antes pasan a la ruleta", async () => {
    for (const g of ["trompo", "pinata", "sapo", "teleferico", "toborochi", "oruro", "race"]) {
      vi.resetModules();
      const { app, f } = await con(g);
      f.dejarUnJuegoQueSirva(nombres(18), "Turnos");
      expect(app.game, g).toBe("wheel");
      expect(boton("wheel").classList.contains("on"), g).toBe(true);
      expect(boton(g).classList.contains("on"), g).toBe(false);
    }
  });

  it("uno de los que sirven queda como está", async () => {
    for (const g of ["wheel", "chovena", "guajojo"]) {
      vi.resetModules();
      const { app, f } = await con(g);
      f.dejarUnJuegoQueSirva(nombres(18), "Turnos");
      expect(app.game, g).toBe(g);
    }
  });

  it("una lista común no mueve el juego elegido", async () => {
    const { app, f } = await con("trompo", "Termo", 1, 18);
    f.dejarUnJuegoQueSirva(nombres(18), "Termo");
    expect(app.game).toBe("trompo");
  });

  it("con más de doscientos turnos queda el que estaba", async () => {
    const { app, f } = await con("pinata", "Turnos", 250, 250);
    f.dejarUnJuegoQueSirva(nombres(250), "Turnos");
    expect(app.game).toBe("pinata");
  });

  it("la demo juega el juego que pide su enlace", async () => {
    history.replaceState(null, "", "/?demo=trompo&modo=turnos&lang=es");
    const { app, f } = await con("trompo");
    f.dejarUnJuegoQueSirva(nombres(18), "Turnos");
    expect(app.game).toBe("trompo");
  });
});

describe("pedir más ganadores que personas", () => {
  // Con tres personas y «Cuántos ganan» en cinco, el sello deja tres ganadores (`Math.min`) y el resultado se lee como un
  // orden. El selector tiene que decidir con esa misma cuenta, no con el cinco del campo.
  it("el selector apaga lo que no cuenta turnos, igual que con tres de tres", async () => {
    armarPagina("Turnos", 5);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(3));
    for (const g of ["trompo", "pinata", "sapo", "teleferico", "toborochi", "oruro"]) expect(boton(g).disabled, g).toBe(true);
    for (const g of ["wheel", "chovena", "guajojo"]) expect(boton(g).disabled, g).toBe(false);
  });

  it("un juego de premios que estaba elegido pasa a la ruleta", async () => {
    armarPagina("Turnos", 5);
    const { app } = await import("../state");
    const f = await import("./freeze");
    f.pintarRecomendacion(nombres(3));
    app.game = "trompo" as never;
    f.dejarUnJuegoQueSirva(nombres(3), "Turnos");
    expect(app.game).toBe("wheel");
  });

  it("con premios de verdad (un nombre que no es de turnos) nada se apaga", async () => {
    armarPagina("Termo", 5);
    const { pintarRecomendacion } = await import("./freeze");
    pintarRecomendacion(nombres(3));
    for (const g of JUEGOS) expect(boton(g).disabled, g).toBe(false);
  });
});
