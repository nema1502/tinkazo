// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retomar desde Mis sorteos un sorteo sellado cuya lista tiene líneas de persona (`resumeFrozen` en `freeze.ts`). El
 * cuadro de la lista (`#ta`) queda a la vista y desactivado cuando el panel de la campaña no está montado, así que las
 * líneas se verían crudas: mientras ese sorteo está retomado el cuadro no se ve, con su valor intacto (otro código lo
 * lee), y vuelve a verse al soltar el sello o al retomar una lista sin líneas. Con una lista de nombres, Retomar es el
 * de siempre.
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
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const cuadro = (): HTMLTextAreaElement => $("ta") as HTMLTextAreaElement;
/** Si el cuadro se ve: ni `hidden` ni `display: none` puestos en él. */
const seVe = (): boolean => !cuadro().hidden && cuadro().style.display !== "none";
const LINEAS = [`p1:${"a".repeat(25)}a`, `p1:${"b".repeat(25)}q`, `p1:${"c".repeat(25)}y`];
const NOMBRES = ["Ana", "Beto", "Nora"];

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
  const fila = (lista: string[]) => ({
    names: lista,
    listHash: bytesToHex(listHash(lista)),
    sealedAt: ahora,
    prize: "Una mochila",
    round: targetRound(ahora, 3600),
    numWinners: 1,
  });
  return { freeze, fila };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("retomar un sorteo sellado con líneas de persona", () => {
  it("el cuadro de la lista no se ve y su valor queda intacto", async () => {
    const m = await montar();
    expect(seVe()).toBe(true);
    m.freeze.resumeFrozen(m.fila(LINEAS));
    expect(cuadro().value).toBe(LINEAS.join("\n"));
    expect(seVe()).toBe(false);
  });

  it("una lista mezclada también esconde el cuadro", async () => {
    const m = await montar();
    m.freeze.resumeFrozen(m.fila(["Ana", ...LINEAS]));
    expect(cuadro().value).toBe(["Ana", ...LINEAS].join("\n"));
    expect(seVe()).toBe(false);
  });

  it("el cuadro vuelve a verse al soltar el sello", async () => {
    const m = await montar();
    m.freeze.resumeFrozen(m.fila(LINEAS));
    expect(seVe()).toBe(false);
    m.freeze.unfreeze("");
    expect(seVe()).toBe(true);
  });

  it("el cuadro vuelve a verse al retomar después una lista de nombres", async () => {
    const m = await montar();
    m.freeze.resumeFrozen(m.fila(LINEAS));
    expect(seVe()).toBe(false);
    m.freeze.resumeFrozen(m.fila(NOMBRES));
    expect(cuadro().value).toBe(NOMBRES.join("\n"));
    expect(seVe()).toBe(true);
  });

  it("con una lista de nombres Retomar es el de siempre: el cuadro se ve con la lista", async () => {
    const m = await montar();
    m.freeze.resumeFrozen(m.fila(NOMBRES));
    expect(cuadro().value).toBe(NOMBRES.join("\n"));
    expect(seVe()).toBe(true);
    expect(cuadro().hasAttribute("hidden")).toBe(false);
    expect(cuadro().getAttribute("style")).toBeNull();
  });
});
