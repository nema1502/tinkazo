// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Retomar un sorteo sellado que quedó sin sortear (`resumeFrozen` en `freeze.ts`, el aviso Retomarlo) con el modo de la
 * pantalla distinto del sellado. El selector de modo está a la vista justo debajo del aviso, y una recarga vuelve a
 * Sortear premios (el borrador se borra al sellar). Lo que se ve y lo que se cuenta tiene que ser lo sellado:
 *
 * - Un orden de turnos sellado se retoma como orden, aunque la página haya vuelto en Sortear premios.
 * - Un sorteo común sellado se retoma con su cantidad de ganadores, aunque antes de tocar Retomarlo se haya tocado Orden
 *   de turnos. Antes la lista cerrada volvía a escribir la cantidad con el largo de la lista, y las bases, la tarjeta del
 *   juego y un sorteo sin sello salían con todos como ganadores.
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
    throw new Error("no se sella en esta prueba");
  },
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, contarUnaVez: () => undefined, errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA" }),
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
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: () => undefined }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => false }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined, puede3D: () => false, usa3D: () => false }));
vi.mock("./ver3d", () => ({ pintarVer3D: () => undefined }));
vi.mock("../protocol/firma", () => ({ prepararFirma: () => undefined }));
vi.mock("./gamecard", () => ({ claveNombre: (g: string) => `game.${g}` }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "lineaDeLaEspera", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));
vi.mock("./modo-ui", () => ({ confirmarPrimerSelloOficial: async () => true, marcarSellandoAhora: () => undefined }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`);
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const campo = (): HTMLInputElement => $("nw") as HTMLInputElement;
const premio = (): HTMLInputElement => $("prize") as HTMLInputElement;
const sorteo = (): HTMLButtonElement => $("btn-modo-sorteo") as HTMLButtonElement;
const turnos = (): HTMLButtonElement => $("btn-turnos") as HTMLButtonElement;
const titulo = (): string => document.querySelector("#sec-participants .head h2")?.textContent ?? "";
const ayuda = (): string => $("turnos-ayuda").textContent ?? "";

/** Arma la página como `main.ts` después de una recarga: la lista vacía, los campos y el selector a la vista. */
async function montar() {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  Element.prototype.scrollIntoView = () => undefined;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const modo = await import("./turnos");
  participants.bindParticipants();
  ganadores.montarGanadores();
  modo.montarTurnos();
  const freeze = await import("./freeze");
  const { listHash } = await import("../protocol/canonical");
  const { bytesToHex, targetRound } = await import("../protocol/quicknet");
  const ahora = Math.floor(Date.now() / 1000);
  /** Una fila de Mis sorteos sellada y sin sortear, como la que retoma el aviso. La ronda queda a una hora. */
  const fila = (lista: string[], prize: string, numWinners: number) => ({
    names: lista,
    listHash: bytesToHex(listHash(lista)),
    sealedAt: ahora,
    prize,
    round: targetRound(ahora, 3600),
    numWinners,
  });
  return { freeze, ganadores, modo, fila };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
  vi.stubEnv("VITE_MODOS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

describe("retomar un sorteo sellado con el modo de la pantalla distinto", () => {
  it("un orden de turnos se retoma como orden aunque la página haya vuelto en Sortear premios", async () => {
    const m = await montar();
    expect(m.modo.modoTurnosActivo()).toBe(false);
    m.freeze.resumeFrozen(m.fila(nombres(8), "Turnos", 8));
    expect(m.modo.modoTurnosActivo()).toBe(true);
    expect(turnos().getAttribute("aria-pressed")).toBe("true");
    expect(sorteo().getAttribute("aria-pressed")).toBe("false");
    expect($("modo-botones").dataset.modo).toBe("turnos");
    expect(titulo()).toBe("Quiénes tienen turno");
    expect(ayuda()).toBe(T.es.turnsHelp);
    expect(campo().value).toBe("8");
    expect(premio().value).toBe("Turnos");
    // La lista ya está sellada: el modo no se cambia.
    expect(sorteo().disabled).toBe(true);
    expect(turnos().disabled).toBe(true);
    sorteo().click();
    expect(m.modo.modoTurnosActivo()).toBe(true);
    expect(campo().value).toBe("8");
  });

  it("un sorteo común se retoma con su ganador aunque antes se haya tocado Orden de turnos", async () => {
    const m = await montar();
    // Recién recargada, con la lista vacía: se toca Orden de turnos y después Retomarlo.
    turnos().click();
    expect(m.modo.modoTurnosActivo()).toBe(true);
    m.freeze.resumeFrozen(m.fila(nombres(8), "Termo", 1));
    expect(m.modo.modoTurnosActivo()).toBe(false);
    expect(campo().value).toBe("1");
    expect(m.ganadores.ganadoresPedidos()).toBe(1);
    expect(premio().value).toBe("Termo");
    expect(sorteo().getAttribute("aria-pressed")).toBe("true");
    expect(turnos().getAttribute("aria-pressed")).toBe("false");
    expect(titulo()).toBe("Participantes");
    expect(ayuda()).toBe(T.es.modoSorteoAyuda);
    expect(turnos().disabled).toBe(true);
  });

  it("un sorteo común de varios premios se retoma con los que se sellaron, no con toda la lista", async () => {
    const m = await montar();
    turnos().click();
    m.freeze.resumeFrozen(m.fila(nombres(8), "Polera", 3));
    expect(m.modo.modoTurnosActivo()).toBe(false);
    expect(campo().value).toBe("3");
    expect(m.ganadores.ganadoresPedidos()).toBe(3);
  });

  it("el sorteo común de siempre se retoma igual que antes", async () => {
    const m = await montar();
    m.freeze.resumeFrozen(m.fila(nombres(8), "Termo", 2));
    expect(m.modo.modoTurnosActivo()).toBe(false);
    expect(campo().value).toBe("2");
    expect(premio().value).toBe("Termo");
    expect(titulo()).toBe("Participantes");
  });
});
