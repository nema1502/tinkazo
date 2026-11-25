// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El QR del espectador en la espera en grande (`armarQrDeEspectador`, en `espectador-enlace.ts`): lleva solo el enlace
 * corto, nunca el largo con los nombres. Mientras el servicio contesta dice que se está preparando; si no sale, no hay
 * QR y se puede probar de nuevo; y si se pidió otro mientras tanto (cambió el juego), el anterior no se dibuja.
 *
 * Con el QR ya visto, un cambio de juego se publica en el mismo enlace si el servicio deja reescribirlo (el QR no
 * cambia), o en uno nuevo, y entonces se dice que quienes ya escanearon lo ven con el juego anterior.
 */

type Corto = { corto: string; id: string; borrar: string; clave: string; cambia: boolean; version: string | null; largo: number; n: number };
const h = vi.hoisted(() => ({
  acortar: vi.fn((..._a: unknown[]): Promise<Corto | null> => Promise.resolve(null)),
  actualizar: vi.fn((..._a: unknown[]): Promise<unknown> => Promise.resolve({ ok: false, motivo: "red" })),
  pintar: vi.fn((..._a: unknown[]): Promise<boolean> => Promise.resolve(true)),
}));

vi.mock("../enlace-corto", async (orig) => ({
  ...(await orig<typeof import("../enlace-corto")>()),
  acortarEspectador: (...a: unknown[]) => h.acortar(...a),
  actualizarCorto: (...a: unknown[]) => h.actualizar(...a),
}));
vi.mock("./qr", () => ({ pintarQr: (...a: unknown[]) => h.pintar(...a) }));

import { armarQrDeEspectador, datosDeLaEspera, datosDelEnlace, enlaceEspectador, figuraDelQrHtml, refDelEnlace, type DatosEspectador } from "./espectador-enlace";
import { cambioConQr, delSello, olvidarEspectadores, publicado } from "./espectadores-de-la-sala";
import { t } from "../i18n";

const NOMBRES = ["Ana", "Beto", "Cami", "Dani"];
/** El contrato oficial de Prueba (`stellar/deployments.json`). */
const CONTRATO_PRUEBA = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const datos = (g = "race"): DatosEspectador => ({ r: 10, g: g as DatosEspectador["g"], p: "normal", w: 1, n: [...NOMBRES], net: "testnet", k: CONTRATO_PRUEBA, i: "42" });
const SELLO = { raffleId: 42n };
const corto = (id: string, cambia = false): Corto => ({ corto: `${location.origin}/c/${id}#${"k".repeat(22)}`, id, borrar: `permiso-${id}`, clave: "k".repeat(22), cambia, version: cambia ? '"1"' : null, largo: 512, n: 1 });

/** Una promesa que la prueba resuelve cuando quiere. */
function aMano<T>(): { p: Promise<T>; dar: (v: T) => void } {
  let dar: (v: T) => void = () => undefined;
  const p = new Promise<T>((r) => (dar = r));
  return { p, dar };
}

let capa: HTMLElement;
const figura = (): HTMLElement => capa.querySelector(".espera-qr") as HTMLElement;
const img = (): HTMLImageElement => figura().querySelector("img") as HTMLImageElement;
const anterior = (): HTMLElement => figura().querySelector(".espera-qr-anterior") as HTMLElement;

function capaNueva(): void {
  document.body.innerHTML = "";
  capa = document.createElement("div");
  capa.innerHTML = figuraDelQrHtml();
  document.body.appendChild(capa);
}

beforeEach(() => {
  h.acortar.mockReset();
  h.actualizar.mockReset();
  h.actualizar.mockResolvedValue({ ok: false, motivo: "red" });
  h.pintar.mockReset();
  h.pintar.mockResolvedValue(true);
  olvidarEspectadores();
  capaNueva();
});

describe("el QR del espectador", () => {
  it("dibuja solo el enlace corto: el largo, con los nombres legibles, nunca", async () => {
    h.acortar.mockResolvedValue(corto("AbCd1234"));
    const dibujado = await armarQrDeEspectador(capa, datos(), SELLO);
    expect(dibujado).toBe(corto("AbCd1234").corto);
    expect(h.pintar).toHaveBeenCalledTimes(1);
    expect(h.pintar.mock.calls[0]?.[1]).toBe(dibujado);
    expect(figura().dataset.estado).toBe("listo");
    expect(img().hidden).toBe(false);
    expect(figura().querySelector("figcaption")?.hidden).toBe(false);
    // La sala lo anota: hay celulares que pueden estar mirando, con este juego.
    expect(delSello(SELLO)?.enlaces.map((e) => e.id)).toEqual(["AbCd1234"]);
    expect(publicado(SELLO)).toEqual({ juego: "race", ritmo: "normal" });
    expect(anterior().hidden).toBe(true);
  });

  it("mientras el servicio contesta dice que se está preparando, sin QR", async () => {
    const c = aMano<Corto | null>();
    h.acortar.mockReturnValue(c.p);
    const armado = armarQrDeEspectador(capa, datos(), SELLO);
    expect(figura().dataset.estado).toBe("preparando");
    expect(img().hidden).toBe(true);
    expect(figura().textContent).toContain(t("espQrPreparando"));
    c.dar(corto("AbCd1234"));
    await armado;
    expect(figura().dataset.estado).toBe("listo");
  });

  it("si el corto no sale no hay QR: lo dice, y Probar de nuevo lo vuelve a pedir", async () => {
    h.acortar.mockResolvedValueOnce(null);
    expect(await armarQrDeEspectador(capa, datos(), SELLO)).toBeNull();
    expect(h.pintar).not.toHaveBeenCalled();
    expect(figura().dataset.estado).toBe("fallo");
    expect(img().hidden).toBe(true);
    expect(figura().textContent).toContain(t("espQrFallo"));
    const otra = figura().querySelector<HTMLButtonElement>(".espera-qr-otra");
    expect(otra?.hidden).toBe(false);
    h.acortar.mockResolvedValueOnce(corto("Zz998877"));
    otra?.click();
    await vi.waitFor(() => expect(figura().dataset.estado).toBe("listo"));
    expect(h.acortar).toHaveBeenCalledTimes(2);
    expect(h.pintar.mock.calls.every((c) => String(c[1]).includes("/c/"))).toBe(true);
  });

  it("si cambia el juego mientras llega el corto, queda dibujado el del juego nuevo", async () => {
    const viejo = aMano<Corto | null>();
    const nuevo = aMano<Corto | null>();
    h.acortar.mockReturnValueOnce(viejo.p).mockReturnValueOnce(nuevo.p);
    const a = armarQrDeEspectador(capa, datos("race"), SELLO);
    const b = armarQrDeEspectador(capa, datos("sapo"), SELLO);
    // El nuevo llega primero, el viejo después: el viejo ya no se dibuja ni se anota.
    nuevo.dar(corto("Nuevo123"));
    expect(await b).toContain("Nuevo123");
    viejo.dar(corto("Viejo123"));
    expect(await a).toBeNull();
    expect(figura().dataset.enlace).toContain("Nuevo123");
    expect(h.pintar).toHaveBeenCalledTimes(1);
    expect(delSello(SELLO)?.enlaces.map((e) => e.id)).toEqual(["Nuevo123"]);
  });

  it("si la espera se cerró mientras tanto, no dibuja nada", async () => {
    const c = aMano<Corto | null>();
    h.acortar.mockReturnValue(c.p);
    const armado = armarQrDeEspectador(capa, datos(), SELLO);
    capa.remove();
    c.dar(corto("AbCd1234"));
    expect(await armado).toBeNull();
    expect(h.pintar).not.toHaveBeenCalled();
  });

  it("volver a abrir la espera con lo mismo muestra el mismo QR, sin pedir otro enlace", async () => {
    h.acortar.mockResolvedValue(corto("AbCd1234"));
    await armarQrDeEspectador(capa, datos(), SELLO);
    capaNueva();
    expect(await armarQrDeEspectador(capa, datos(), SELLO)).toBe(corto("AbCd1234").corto);
    expect(h.acortar).toHaveBeenCalledTimes(1);
  });
});

describe("cambiar el juego con el QR a la vista", () => {
  it("si el servicio deja reescribir el enlace, lo reescribe con el juego nuevo y el QR queda igual", async () => {
    h.acortar.mockResolvedValue(corto("AbCd1234", true));
    await armarQrDeEspectador(capa, datos("race"), SELLO);
    h.actualizar.mockResolvedValue({ ok: true, version: '"2"', n: 2, largo: 512 });
    expect(await armarQrDeEspectador(capa, datos("sapo"), SELLO)).toBe(corto("AbCd1234").corto);
    // Se reescribió con el permiso que la sala guardó, y no se pidió otro enlace ni se dibujó otro QR.
    expect(h.actualizar).toHaveBeenCalledTimes(1);
    expect(h.actualizar.mock.calls[0]?.[0]).toMatchObject({ id: "AbCd1234", borrar: "permiso-AbCd1234", version: '"1"', n: 1 });
    expect(datosDelEnlace(new URL(String(h.actualizar.mock.calls[0]?.[1])).hash)?.g).toBe("sapo");
    expect(h.acortar).toHaveBeenCalledTimes(1);
    expect(h.pintar).toHaveBeenCalledTimes(1);
    expect(anterior().hidden).toBe(true);
    expect(delSello(SELLO)?.enlaces[0]).toMatchObject({ version: '"2"', n: 2 });
    expect(publicado(SELLO)).toEqual({ juego: "sapo", ritmo: "normal" });
  });

  it("con el servicio de hoy arma un QR nuevo para quienes escaneen después, y lo dice", async () => {
    h.acortar.mockResolvedValueOnce(corto("AbCd1234", false)).mockResolvedValueOnce(corto("Nuevo123", false));
    await armarQrDeEspectador(capa, datos("race"), SELLO);
    expect(await armarQrDeEspectador(capa, datos("sapo"), SELLO)).toBe(corto("Nuevo123").corto);
    expect(h.actualizar).not.toHaveBeenCalled();
    expect(h.pintar).toHaveBeenCalledTimes(2);
    expect(anterior().hidden).toBe(false);
    expect(anterior().textContent).toBe(t("espQrJuegoAnterior"));
    expect(delSello(SELLO)?.enlaces.map((e) => e.id)).toEqual(["AbCd1234", "Nuevo123"]);
  });

  it("si reescribir no sale, también arma uno nuevo y lo dice", async () => {
    h.acortar.mockResolvedValueOnce(corto("AbCd1234", true)).mockResolvedValueOnce(corto("Nuevo123", true));
    await armarQrDeEspectador(capa, datos("race"), SELLO);
    h.actualizar.mockResolvedValue({ ok: false, motivo: "red" });
    expect(await armarQrDeEspectador(capa, datos("sapo"), SELLO)).toBe(corto("Nuevo123").corto);
    expect(anterior().hidden).toBe(false);
    // Lo que cambió no se borra aunque vuelva: anotarlo es cosa del selector (`espectadores-de-la-sala.ts`).
    expect(cambioConQr(SELLO)).toBe(false);
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

  it("el fragmento puede traer la referencia del enlace corto que cambia, y los datos se leen igual", () => {
    const largo = enlaceEspectador(datos(), "https://tinkazo.app");
    const hash = `${new URL(largo).hash}.AbCd1234.${"k".repeat(22)}.3`;
    expect(datosDelEnlace(hash)?.g).toBe("race");
    expect(refDelEnlace(hash)).toEqual({ id: "AbCd1234", clave: "k".repeat(22), n: 3 });
    expect(refDelEnlace(new URL(largo).hash)).toBeNull();
    expect(datosDelEnlace(`${new URL(largo).hash}.corto`)).toBeNull();
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

  it("las etiquetas viajan siempre con su marca: 1 si son de personas (una campaña de empresa) y 0 si son de equipos", () => {
    const cuentas = ["G" + "A".repeat(55), "G" + "B".repeat(55)];
    const f = { names: cuentas, listHash: "ab", ts: 1, at: "", prize: "", round: 10, raffleId: 7n };
    const base = { juego: "race" as const, ritmo: "normal" as const, premios: 1, red: "testnet" as const, contrato: CONTRATO_PRUEBA, equipo: (c: string) => (c === cuentas[0] ? "Ana R." : "Beto S.") };
    const deEquipos = datosDeLaEspera(f, base);
    expect(deEquipos?.e).toHaveLength(2);
    expect(deEquipos?.q).toBe(0);
    const dePersonas = datosDeLaEspera(f, { ...base, personas: true });
    expect(dePersonas?.q).toBe(1);
    // La marca hace el viaje entero por el fragmento y se lee igual, también el cero.
    expect(datosDelEnlace(new URL(enlaceEspectador(dePersonas as DatosEspectador, "https://tinkazo.app")).hash)?.q).toBe(1);
    expect(datosDelEnlace(new URL(enlaceEspectador(deEquipos as DatosEspectador, "https://tinkazo.app")).hash)?.q).toBe(0);
    // Sin etiquetas no hay nada que marcar.
    expect(datosDeLaEspera(f, { juego: "race", ritmo: "normal", premios: 1, red: "testnet", contrato: CONTRATO_PRUEBA, personas: true })?.q).toBeUndefined();
  });

  it("un enlace de una sala anterior, con etiquetas y sin marca, se lee sin marca: no se sabe de qué son", () => {
    const cuentas = ["G" + "A".repeat(55), "G" + "B".repeat(55)];
    const viejo = { ...datos(), n: cuentas, e: [[cuentas[0], "Ana R."]] } as unknown as DatosEspectador;
    const leido = datosDelEnlace(new URL(enlaceEspectador(viejo, "https://tinkazo.app")).hash);
    expect(leido?.e).toEqual([[cuentas[0], "Ana R."]]);
    expect(leido?.q).toBeUndefined();
  });

  it("una marca que no es la que escribe la sala rompe el enlace: no se abre a medias", () => {
    const cuentas = ["G" + "A".repeat(55), "G" + "B".repeat(55)];
    const roto = { ...datos(), n: cuentas, e: [[cuentas[0], "Ana R."]], q: 2 } as unknown as DatosEspectador;
    expect(datosDelEnlace(new URL(enlaceEspectador(roto, "https://tinkazo.app")).hash)).toBeNull();
  });
});
