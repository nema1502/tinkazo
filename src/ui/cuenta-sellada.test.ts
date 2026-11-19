// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que dice la herramienta después de sellar una lista con varias participaciones: la cuenta de la espera
 * (`#k-n` y `#k-entries`) y las bases que se copian (`copyRules`). Con `?modo=varias` y el reparto de siempre
 * (Ana con tres, Beto y Carla con una y sin sufijo) tienen que decir lo mismo que el resumen de antes de sellar
 * y que la verificación: 3 personas y 5 participaciones. Sin los modos, la lista se cuenta como siempre.
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
  sealOnChain: async () => undefined,
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({ apruebaAMano: () => false, canAnchor: () => true, claveDeSellar: () => "freeze", currentSession: () => ({ address: "GAAA" }) }));
const h = vi.hoisted(() => ({ nombres: [] as string[] }));
vi.mock("./participants", () => ({ cerrarLista: () => undefined, olvidarBorrador: () => undefined, parseNames: () => h.nombres, setList: () => undefined }));
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
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => false }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => "race" }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

const MIXTA = ["Ana Quispe (1/3)", "Ana Quispe (2/3)", "Ana Quispe (3/3)", "Beto Rojas", "Carla Suarez"];

let copiado = "";

beforeEach(() => {
  vi.resetModules();
  // El modo recordado en la pestaña no pasa de una prueba a la otra.
  sessionStorage.clear();
  history.replaceState(null, "", "/?modo=varias&lang=es");
  document.body.innerHTML =
    '<button id="btn-freeze"></button><input id="prize" value="Una pizza"><input id="nw" type="number" value="1">' +
    '<b id="k-n"></b> <span id="k-entries" data-i="kEntries"></span><pre id="rules-text"></pre><button id="btn-rules"></button>';
  copiado = "";
  h.nombres = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (s: string) => {
        copiado = s;
      },
    },
  });
});

async function sellada(names: string[]): Promise<typeof import("./freeze")> {
  const freeze = await import("./freeze");
  const { app } = await import("../state");
  app.frozen = { names, listHash: "ab".repeat(32), ts: 1_800_000_000, at: "", prize: "Una pizza", round: 1000, raffleId: 7n } as never;
  return freeze;
}

const boton = (): HTMLButtonElement => document.getElementById("btn-rules") as HTMLButtonElement;

describe("después de sellar un reparto con nombres a secas", () => {
  it("las bases dicen 3 personas con 5 participaciones y que alguien puede salir más de una vez", async () => {
    const { copyRules } = await sellada(MIXTA);
    await copyRules(boton());
    expect(copiado).toContain("Participan las 3 personas de la lista, con 5 participaciones: quien tiene varias puede salir más de una vez");
    expect(copiado).toContain("Las participaciones no se venden");
  });

  it("la cuenta de la espera dice 5 participaciones de 3 personas", async () => {
    const { pintarCuentaSellada } = await sellada(MIXTA);
    pintarCuentaSellada(MIXTA);
    expect(document.getElementById("k-n")?.textContent).toBe("5");
    expect(document.getElementById("k-entries")?.textContent).toBe("participaciones de 3 personas");
  });

  it("sin los modos, la misma lista se cuenta como siempre: 5 personas", async () => {
    history.replaceState(null, "", "/?lang=es");
    const { copyRules, pintarCuentaSellada } = await sellada(MIXTA);
    await copyRules(boton());
    expect(copiado).toContain("Participan las 5 personas de la lista. Sale un ganador.");
    pintarCuentaSellada(MIXTA);
    expect(document.getElementById("k-n")?.textContent).toBe("5");
    expect(document.getElementById("k-entries")?.dataset.i).toBe("kEntries");
  });
});

describe("las bases de antes de sellar, sin los modos", () => {
  const MESA = ["Mesa 1 (1/3)", "Mesa 1 (2/3)", "Mesa 1 (3/3)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"];

  it("un reparto entero dice 2 personas y 5 participaciones, como el cuadro y como después de sellar", async () => {
    history.replaceState(null, "", "/?lang=es");
    h.nombres = MESA;
    const { copyRulesPre, copyRules } = await import("./freeze");
    await copyRulesPre(boton());
    expect(copiado).toContain("Participan las 2 personas de la lista, con 5 participaciones");
    expect(copiado).not.toContain("Participan las 5 personas");
    const antes = /Participan[^.:]*/.exec(copiado)?.[0];
    const { app } = await import("../state");
    app.frozen = { names: MESA, listHash: "ab".repeat(32), ts: 1_800_000_000, at: "", prize: "Una pizza", round: 1000, raffleId: 7n } as never;
    await copyRules(boton());
    expect(/Participan[^.:]*/.exec(copiado)?.[0]).toBe(antes);
  });

  it("una lista común sigue diciendo una persona por línea", async () => {
    history.replaceState(null, "", "/?lang=es");
    h.nombres = ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Ana", "Beto"];
    const { copyRulesPre } = await import("./freeze");
    await copyRulesPre(boton());
    expect(copiado).toContain("Participan las 4 personas de la lista.");
  });
});

describe("las bases de un orden de turnos repartido", () => {
  const preparar = (): void => {
    history.replaceState(null, "", "/?modo=turnos&lang=es");
    h.nombres = MIXTA;
    (document.getElementById("prize") as HTMLInputElement).value = "Turnos";
    (document.getElementById("nw") as HTMLInputElement).value = "5";
  };

  it("antes de sellar: 3 personas con 5 turnos, del 1 al 5", async () => {
    preparar();
    const { copyRulesPre } = await import("./freeze");
    await copyRulesPre(boton());
    expect(copiado).toContain("Participan las 3 personas de la lista, con 5 turnos.");
    expect(copiado).toContain("del 1 al 5");
    expect(copiado).not.toContain("del 1 al 3");
  });

  it("después de sellar dice lo mismo", async () => {
    preparar();
    const { copyRules } = await sellada(MIXTA);
    const { app } = await import("../state");
    if (app.frozen) app.frozen.prize = "Turnos";
    await copyRules(boton());
    expect(copiado).toContain("Participan las 3 personas de la lista, con 5 turnos.");
    expect(copiado).toContain("del 1 al 5");
    expect(copiado).not.toContain("del 1 al 3");
  });
});
