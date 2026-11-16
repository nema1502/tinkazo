// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El QR del espectador en la espera en grande (`armarQrDeEspectador`, en `espectador-enlace.ts`): lleva solo el enlace
 * corto, nunca el largo con los nombres. Mientras el servicio contesta dice que se está preparando; si no sale, no hay
 * QR y se puede probar de nuevo; y si se pidió otro mientras tanto (cambió el juego), el anterior no se dibuja.
 */

const h = vi.hoisted(() => ({
  acortar: vi.fn((..._a: unknown[]): Promise<{ corto: string } | null> => Promise.resolve(null)),
  pintar: vi.fn((..._a: unknown[]): Promise<boolean> => Promise.resolve(true)),
}));

vi.mock("../enlace-corto", () => ({ acortar: (...a: unknown[]) => h.acortar(...a) }));
vi.mock("./qr", () => ({ pintarQr: (...a: unknown[]) => h.pintar(...a) }));

import { armarQrDeEspectador, datosDeLaEspera, datosDelEnlace, enlaceEspectador, figuraDelQrHtml, type DatosEspectador } from "./espectador-enlace";
import { t } from "../i18n";

const NOMBRES = ["Ana", "Beto", "Cami", "Dani"];
/** El contrato oficial de Prueba (`stellar/deployments.json`). */
const CONTRATO_PRUEBA = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const datos = (g = "race"): DatosEspectador => ({ r: 10, g: g as DatosEspectador["g"], p: "normal", w: 1, n: [...NOMBRES], net: "testnet", k: CONTRATO_PRUEBA, i: "42" });

/** Una promesa que la prueba resuelve cuando quiere. */
function aMano<T>(): { p: Promise<T>; dar: (v: T) => void } {
  let dar: (v: T) => void = () => undefined;
  const p = new Promise<T>((r) => (dar = r));
  return { p, dar };
}

let capa: HTMLElement;
const figura = (): HTMLElement => capa.querySelector(".espera-qr") as HTMLElement;
const img = (): HTMLImageElement => figura().querySelector("img") as HTMLImageElement;

beforeEach(() => {
  h.acortar.mockReset();
  h.pintar.mockReset();
  h.pintar.mockResolvedValue(true);
  document.body.innerHTML = "";
  capa = document.createElement("div");
  capa.innerHTML = figuraDelQrHtml();
  document.body.appendChild(capa);
});

describe("el QR del espectador", () => {
  it("dibuja solo el enlace corto: el largo, con los nombres legibles, nunca", async () => {
    h.acortar.mockResolvedValue({ corto: "https://tinkazo.app/c/AbCd1234#" + "k".repeat(22) });
    const dibujado = await armarQrDeEspectador(capa, datos());
    expect(dibujado).toBe("https://tinkazo.app/c/AbCd1234#" + "k".repeat(22));
    expect(h.pintar).toHaveBeenCalledTimes(1);
    expect(h.pintar.mock.calls[0]?.[1]).toBe(dibujado);
    expect(figura().dataset.estado).toBe("listo");
    expect(img().hidden).toBe(false);
    expect(figura().querySelector("figcaption")?.hidden).toBe(false);
  });

  it("mientras el servicio contesta dice que se está preparando, sin QR", async () => {
    const corto = aMano<{ corto: string } | null>();
    h.acortar.mockReturnValue(corto.p);
    const armado = armarQrDeEspectador(capa, datos());
    expect(figura().dataset.estado).toBe("preparando");
    expect(img().hidden).toBe(true);
    expect(figura().textContent).toContain(t("espQrPreparando"));
    corto.dar({ corto: "https://tinkazo.app/c/AbCd1234#" + "k".repeat(22) });
    await armado;
    expect(figura().dataset.estado).toBe("listo");
  });

  it("si el corto no sale no hay QR: lo dice, y Probar de nuevo lo vuelve a pedir", async () => {
    h.acortar.mockResolvedValueOnce(null);
    expect(await armarQrDeEspectador(capa, datos())).toBeNull();
    expect(h.pintar).not.toHaveBeenCalled();
    expect(figura().dataset.estado).toBe("fallo");
    expect(img().hidden).toBe(true);
    expect(figura().textContent).toContain(t("espQrFallo"));
    const otra = figura().querySelector<HTMLButtonElement>(".espera-qr-otra");
    expect(otra?.hidden).toBe(false);
    h.acortar.mockResolvedValueOnce({ corto: "https://tinkazo.app/c/Zz998877#" + "q".repeat(22) });
    otra?.click();
    await vi.waitFor(() => expect(figura().dataset.estado).toBe("listo"));
    expect(h.acortar).toHaveBeenCalledTimes(2);
    expect(h.pintar.mock.calls.every((c) => String(c[1]).includes("/c/"))).toBe(true);
  });

  it("si cambia el juego mientras llega el corto, queda dibujado el del juego nuevo", async () => {
    const viejo = aMano<{ corto: string } | null>();
    const nuevo = aMano<{ corto: string } | null>();
    h.acortar.mockReturnValueOnce(viejo.p).mockReturnValueOnce(nuevo.p);
    const a = armarQrDeEspectador(capa, datos("race"));
    const b = armarQrDeEspectador(capa, datos("sapo"));
    // El nuevo llega primero, el viejo después: el viejo ya no se dibuja.
    nuevo.dar({ corto: "https://tinkazo.app/c/Nuevo123#" + "n".repeat(22) });
    expect(await b).toContain("Nuevo123");
    viejo.dar({ corto: "https://tinkazo.app/c/Viejo123#" + "v".repeat(22) });
    expect(await a).toBeNull();
    expect(figura().dataset.enlace).toContain("Nuevo123");
    expect(h.pintar).toHaveBeenCalledTimes(1);
  });

  it("si la espera se cerró mientras tanto, no dibuja nada", async () => {
    const corto = aMano<{ corto: string } | null>();
    h.acortar.mockReturnValue(corto.p);
    const armado = armarQrDeEspectador(capa, datos());
    capa.remove();
    corto.dar({ corto: "https://tinkazo.app/c/AbCd1234#" + "k".repeat(22) });
    expect(await armado).toBeNull();
    expect(h.pintar).not.toHaveBeenCalled();
  });
});

describe("el tamaño del enlace", () => {
  it("con 200 nombres el enlace largo pasa de lo que entra en un QR legible, y por eso va el corto", () => {
    const n = Array.from({ length: 200 }, (_, i) => `Participante número ${i + 1}`);
    const largo = enlaceEspectador({ r: 10, g: "race", p: "normal", w: 3, n, net: "testnet", k: CONTRATO_PRUEBA, i: "42" }, "https://tinkazo.app");
    expect(largo.length).toBeGreaterThan(2_000);
    // Lo que el servicio guarda, cifrado: muy por debajo de su tope de 256 KB.
    expect(new TextEncoder().encode(largo).length).toBeLessThan(256 * 1024 / 4);
    expect(datosDelEnlace(new URL(largo).hash)?.n).toHaveLength(200);
  });

  it("solo hay enlace con el sorteo sellado en un contrato oficial de su red: si no, no hay QR", () => {
    const f = { names: NOMBRES, listHash: "ab", ts: 1, at: "", prize: "", round: 10, raffleId: 7n };
    const base = { juego: "race" as const, ritmo: "normal" as const, premios: 1, red: "testnet" as const };
    expect(datosDeLaEspera(f, { ...base, contrato: CONTRATO_PRUEBA })).toMatchObject({ net: "testnet", k: CONTRATO_PRUEBA, i: "7" });
    expect(datosDeLaEspera(f, { ...base, contrato: "C" + "A".repeat(55) })).toBeNull();
    expect(datosDeLaEspera(f, { ...base, contrato: null })).toBeNull();
    expect(datosDeLaEspera(f, { ...base, red: "mainnet", contrato: CONTRATO_PRUEBA })).toBeNull();
    // Sin sello en Stellar (el modo libre): el celular no sabría cuándo la sala lanza el sorteo.
    const { raffleId: _sinNumero, ...libre } = f;
    expect(datosDeLaEspera(libre, { ...base, contrato: CONTRATO_PRUEBA })).toBeNull();
  });
});
