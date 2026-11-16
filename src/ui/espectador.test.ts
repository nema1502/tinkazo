// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El modo espectador (`espectador.ts`): quien escanea el QR de la espera abre el
 * mismo enlace con la lista y la ronda, ve la misma cuenta regresiva y, al nacer
 * la ronda, trae él mismo el beacon público (los relays de drand), lo verifica,
 * calcula los mismos ganadores con `select` y lanza el mismo show, en modo
 * solo-lectura. Sin servidor nuevo: los nombres viajan cifrados en el enlace
 * corto (`enlace-corto.ts`) y la matemática sale del código del protocolo.
 */

const h = vi.hoisted(() => ({
  firma: "01".repeat(48),
  verificar: true,
  fetchRound: vi.fn((..._a: unknown[]): any => undefined),
  verifyRoundAsync: vi.fn((..._a: unknown[]): any => undefined),
  verDeNuevo: vi.fn((..._a: unknown[]): any => undefined),
  pintarQr: vi.fn((..._a: unknown[]): any => Promise.resolve(true)),
  acortar: vi.fn((..._a: unknown[]): any => Promise.resolve(null)),
  enlaceParaElQr: vi.fn((..._a: unknown[]): any => Promise.resolve({ ahora: "", despues: Promise.resolve(null) })),
  anotarseEnSala: vi.fn((..._a: unknown[]): any => Promise.resolve({ ok: true, n: 1 })),
  seguirVivo: vi.fn((..._a: unknown[]): any => ({ parar: () => undefined })),
}));

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => "no", soltarPantallaCompleta: () => undefined }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: (...a: unknown[]) => h.verifyRoundAsync(...a) }));
vi.mock("./draw", () => ({ verDeNuevo: (...a: unknown[]) => h.verDeNuevo(...a) }));
vi.mock("./qr", () => ({ pintarQr: (...a: unknown[]) => h.pintarQr(...a) }));
vi.mock("../enlace-corto", () => ({ acortar: (...a: unknown[]) => h.acortar(...a), enlaceParaElQr: (...a: unknown[]) => h.enlaceParaElQr(...a) }));

/** La sala, para la vista del participante: anotarse y seguir /vivo, con falsos controlables. */
vi.mock("../sala/cliente", () => ({ servicioDeSala: () => "http://sala.test" }));
vi.mock("../sala/participante", async (orig) => ({
  ...(await orig<typeof import("../sala/participante")>()),
  anotarseEnSala: (...a: unknown[]) => h.anotarseEnSala(...a),
  seguirVivo: (...a: unknown[]) => h.seguirVivo(...a),
}));

import { bytesToHex, hexToBytes, randomnessOf, roundTime } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { select } from "../protocol/select";
import { app } from "../state";
import { T } from "../i18n";
import { abrirEspectador, abrirPanelQrEspectador, abrirParticipante, datosDelEnlace, enlaceEspectador, type DatosEspectador } from "./espectador";

/** Nombres de la lista sellada de prueba. */
const NOMBRES = ["Ana", "Beto", "Cami", "Dani", "Eva", "Fito"];

const datos = (extra: Partial<DatosEspectador> = {}): DatosEspectador => ({
  r: 1_000_000,
  g: "race",
  p: "normal",
  w: 1,
  z: "Una polera",
  n: [...NOMBRES],
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(roundTime(1_000_000) * 1000 - 30_000);
  h.fetchRound.mockReset();
  h.verifyRoundAsync.mockReset();
  h.verDeNuevo.mockReset();
  h.pintarQr.mockClear();
  // Como la de verdad: pone el QR en la imagen.
  h.pintarQr.mockImplementation(async (...a: unknown[]) => {
    (a[0] as HTMLImageElement).setAttribute("src", "data:image/png;base64,qr");
    return true;
  });
  h.acortar.mockClear();
  h.acortar.mockResolvedValue(null);
  h.enlaceParaElQr.mockClear();
  h.enlaceParaElQr.mockImplementation((...a: unknown[]) => Promise.resolve({ ahora: a[0] as string, despues: Promise.resolve(null) }));
  h.verifyRoundAsync.mockResolvedValue(h.verificar);
  h.fetchRound.mockResolvedValue({ round: 1_000_000, signature: h.firma });
  document.body.innerHTML = "";
  app.frozen = null;
  app.drawn = null;
  app.game = "race";
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** La capa del espectador, si está. */
const capa = (): HTMLElement => document.querySelector(".espectador") as HTMLElement;

describe("el enlace del espectador", () => {
  it("ida y vuelta: el enlace guarda ronda, juego, pace, ganadores, premio y nombres", () => {
    const d = datos();
    const enlace = enlaceEspectador(d, "https://tinkazo.app");
    expect(enlace).toMatch(/^https:\/\/tinkazo\.app\/#espectador=[A-Za-z0-9_-]+$/);
    expect(datosDelEnlace(new URL(enlace).hash)).toEqual(d);
  });

  it("sin premio el enlace no lleva premio vacío", () => {
    const d = datos({ z: undefined });
    const vuelto = datosDelEnlace(new URL(enlaceEspectador(d, "https://tinkazo.app")).hash);
    expect(vuelto).toEqual({ r: d.r, g: d.g, p: d.p, w: d.w, n: d.n });
  });

  it("rechaza lo que no es un enlace de espectador", () => {
    expect(datosDelEnlace("#sortear")).toBeNull();
    expect(datosDelEnlace("#espectador=%%%")).toBeNull();
    expect(datosDelEnlace("")).toBeNull();
    // Un payload válido en base64 pero roto adentro.
    expect(datosDelEnlace("#espectador=" + btoa("no es json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))).toBeNull();
  });
});

describe("la espera del espectador", () => {
  it("abre en solo-lectura con el rótulo, el premio y la misma cuenta regresiva", async () => {
    abrirEspectador(datos(), "es");
    expect(capa()).toBeTruthy();
    // El rótulo claro de solo-lectura.
    expect(capa().textContent).toContain(T.es.espVistaEspectador);
    expect(capa().textContent).toContain(T.es.espLectura);
    expect(capa().textContent).toContain("Se sortea");
    expect(capa().textContent).toContain("Una polera");
    // La misma cuenta del organizador, en el mismo formato m:ss.
    const reloj = capa().querySelector<HTMLElement>(".espera-reloj");
    expect(reloj?.textContent).toBe("0:30");
    await vi.advanceTimersByTimeAsync(1000);
    expect(reloj?.textContent).toBe("0:29");
    // Mientras cuenta, nadie va a buscar el número: todavía no existe.
    expect(h.fetchRound).not.toHaveBeenCalled();
  });

  it("al nacer la ronda trae el beacon él mismo, verifica y lanza el show con los mismos ganadores que el organizador", async () => {
    abrirEspectador(datos(), "es");
    await vi.advanceTimersByTimeAsync(30_000);
    // El beacon público de la ronda del enlace, con los mismos relays que el organizador.
    expect(h.fetchRound).toHaveBeenCalledWith(1_000_000, expect.anything());
    expect(h.verifyRoundAsync).toHaveBeenCalledWith(1_000_000, h.firma);
    // Los ganadores: la misma matemática que el organizador (select con la semilla y la lista).
    const semilla = bytesToHex(randomnessOf(h.firma));
    expect(app.drawn?.winners).toEqual(select(hexToBytes(semilla), hexToBytes(bytesToHex(listHash(NOMBRES))), NOMBRES.length, 1));
    expect(app.drawn?.beacon).toMatchObject({ round: 1_000_000, randomness: semilla, signature: h.firma });
    // El show: el mismo lanzador del resultado (playGame, vía verDeNuevo), con lo ya decidido.
    expect(h.verDeNuevo).toHaveBeenCalledTimes(1);
    // El estado que el show lee es el del enlace.
    expect(app.frozen).toMatchObject({ names: NOMBRES, round: 1_000_000, prize: "Una polera" });
    expect(app.game).toBe("race");
    // Y nadie tocó la cadena ni grabó nada: sin sorteo anclado.
    expect(app.frozen?.raffleId).toBeUndefined();
    expect(app.drawn?.drawTx).toBeUndefined();
  });

  it("con la ronda ya nacida (el QR del resultado) arranca el show enseguida", async () => {
    vi.setSystemTime(roundTime(1_000_000) * 1000 + 5_000);
    abrirEspectador(datos(), "es");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchRound).toHaveBeenCalledOnce();
    expect(h.verDeNuevo).toHaveBeenCalledTimes(1);
  });

  it("si el beacon falla muestra el error y «Reintentar» vuelve a intentarlo", async () => {
    h.fetchRound.mockRejectedValueOnce(new Error("relay 500"));
    abrirEspectador(datos(), "es");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(capa().textContent).toContain(T.es.drandDown);
    const reintentar = capa().querySelector<HTMLButtonElement>(".espera-accion");
    expect(reintentar?.textContent).toBe(T.es.drawRetry);
    h.fetchRound.mockResolvedValue({ round: 1_000_000, signature: h.firma });
    reintentar?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchRound).toHaveBeenCalledTimes(2);
    expect(h.verDeNuevo).toHaveBeenCalledTimes(1);
  });

  it("si la firma no verifica muestra el error claro y no lanza ningún show", async () => {
    h.verifyRoundAsync.mockResolvedValue(false);
    abrirEspectador(datos(), "es");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(capa().textContent).toContain(T.es.badSig);
    expect(h.verDeNuevo).not.toHaveBeenCalled();
    expect(app.drawn).toBeNull();
  });

  it("mientras espera los intentos del relay, lo dice en el lugar de la cuenta", async () => {
    h.fetchRound.mockImplementation((async (...a: unknown[]) => {
      const [, op] = a as unknown as [{}, { onAttempt?: (i: number, t: number) => void }];
      op?.onAttempt?.(2, 12);
      return { round: 1_000_000, signature: h.firma };
    }) as typeof h.fetchRound);
    abrirEspectador(datos(), "es");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(capa().textContent).toContain(T.es.drandTry(2, 12));
    expect(h.verDeNuevo).toHaveBeenCalledTimes(1);
  });

  it("Escape cierra la vista: es solo-lectura, no deja nada colgado", async () => {
    abrirEspectador(datos(), "es");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(capa()).toBeFalsy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
  });

  it("no se abre dos veces con el mismo enlace", () => {
    abrirEspectador(datos(), "es");
    abrirEspectador(datos(), "es");
    expect(document.querySelectorAll(".espectador")).toHaveLength(1);
  });
});

describe("el panel del QR del espectador", () => {
  it("pinta el QR del enlace que le dan y se cierra con el botón", async () => {
    abrirPanelQrEspectador("https://tinkazo.app/#espectador=abc");
    await vi.advanceTimersByTimeAsync(0);
    const panel = document.querySelector(".espectador-qr") as HTMLElement;
    expect(panel).toBeTruthy();
    // No fue a ningún servidor a pintar el cuadradito: el QR sale de ./qr.
    expect(h.pintarQr).toHaveBeenCalledWith(expect.any(HTMLImageElement), "https://tinkazo.app/#espectador=abc");
    expect(panel.querySelector("img")?.getAttribute("src")).toBeTruthy();
    panel.querySelector<HTMLButtonElement>("[data-cerrar]")?.click();
    expect(document.querySelector(".espectador-qr")).toBeFalsy();
  });

  it("si el enlace no entra en un QR, el panel se va en vez de mostrar uno roto", async () => {
    h.pintarQr.mockResolvedValue(false);
    abrirPanelQrEspectador("https://tinkazo.app/#espectador=abc");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".espectador-qr")).toBeFalsy();
  });
});

/* ------------------------------------------------- la vista del participante */

describe("la vista del participante", () => {
  beforeEach(() => {
    h.anotarseEnSala.mockReset();
    h.seguirVivo.mockReset();
    // Un número distinto por alta, como en la sala de verdad: el 1 ya puede ser de otro nombre.
    let numero = 100;
    h.anotarseEnSala.mockImplementation(async () => ({ ok: true, n: ++numero } as const));
    h.seguirVivo.mockReturnValue({ parar: () => undefined });
    document.body.innerHTML = "";
  });

  const PARTICIPANTE = { id: "AbCd1234", clave: "c".repeat(22) };
  /** La escucha que la vista dejó registrada en seguirVivo (los callbacks que el falso puede disparar). */
  type EscuchaDeVista = Parameters<typeof import("../sala/participante").seguirVivo>[3];
  const vista = (): HTMLElement => document.querySelector(".participante") as HTMLElement;
  const escucha = (): EscuchaDeVista => h.seguirVivo.mock.calls[0]?.[3] as EscuchaDeVista;
  /** El formulario de nombre, mientras está. */
  const input = (): HTMLInputElement => vista().querySelector<HTMLInputElement>(".ji-p-nombre") as HTMLInputElement;
  const botonSumarme = (): HTMLButtonElement => vista().querySelector<HTMLButtonElement>(".ji-p-sumarse") as HTMLButtonElement;

  it("abre con el rótulo de participante y sigue la sala por /vivo, sin token", () => {
    abrirParticipante(PARTICIPANTE, "es");
    expect(vista()).toBeTruthy();
    expect(vista().textContent).toContain(T.es.jiPRotulo);
    expect(h.seguirVivo).toHaveBeenCalledWith("AbCd1234", PARTICIPANTE.clave, "http://sala.test", expect.anything());
    expect(vista().textContent).toContain(T.es.jiPEstadoEntra);
  });

  it("se anota con el nombre que puso y lo ve en la lista en vivo", async () => {
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alNombre!(1, "Ana");
    input().value = "  Beto  ";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.anotarseEnSala).toHaveBeenCalledWith("AbCd1234", PARTICIPANTE.clave, "Beto", "http://sala.test");
    expect(vista().textContent).toContain(T.es.jiPListo);
    expect([...vista().querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["Ana", "Beto"]);
  });

  it("un nombre que la pantalla quitó sale de la lista", async () => {
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alNombre!(1, "Ana");
    input().value = "Beto";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    escucha().alQuitado?.(1);
    expect([...vista().querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["Beto"]);
  });

  it("un nombre con enlace no se manda, y el aviso lo dice", async () => {
    abrirParticipante(PARTICIPANTE, "es");
    input().value = "mira malo.xyz";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.anotarseEnSala).not.toHaveBeenCalled();
    expect(vista().textContent).toContain(T.es.jiPNombreMalo);
  });

  it("si la sala lo rechaza, dice por qué", async () => {
    for (const [motivo, clave] of [["cerrada", "jiPTarde"], ["llena", "jiPErrLlena"], ["rapido", "jiPErrOtro"], ["otro", "jiPErrOtro"]] as const) {
      h.anotarseEnSala.mockResolvedValue({ ok: false, motivo });
      abrirParticipante(PARTICIPANTE, "es");
      input().value = "Ana";
      botonSumarme().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(vista().textContent, motivo).toContain(T.es[clave] as string);
      document.body.innerHTML = "";
      h.seguirVivo.mockReturnValue({ parar: () => undefined });
    }
  });

  it("el cierre de lista se anuncia, y quien no alcanzó a sumarse se queda afuera", async () => {
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alCierre?.();
    expect(vista().textContent).toContain(T.es.jiPCerrada);
    input().value = "Ana";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.anotarseEnSala).not.toHaveBeenCalled();
    expect(vista().textContent).toContain(T.es.jiPTarde);
  });

  it("cuando comparten la ronda ve su resultado personal, con los mismos ganadores que la pantalla", async () => {
    const nombres = ["Ana", "Beto"];
    const hash = bytesToHex(listHash(nombres));
    const randomness = "ab".repeat(32);
    const sale = nombres[select(hexToBytes(randomness), hexToBytes(hash), nombres.length, 1)[0] as number] as string;
    const ronda = { r: 1, randomness, listHash: hash, k: 1 };
    abrirParticipante(PARTICIPANTE, "es");
    const e = escucha();
    e.alNombre(1, "Ana");
    input().value = "Beto";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    e.alRonda?.(ronda);
    const esperado = sale === "Beto" ? T.es.jiPTeToco : T.es.jiPNoGano;
    const otro = sale === "Beto" ? T.es.jiPNoGano : T.es.jiPTeToco;
    expect(vista().textContent).toContain(esperado);
    expect(vista().textContent).not.toContain(otro);
    expect(vista().textContent).toContain(sale);
    expect(vista().textContent).toContain(T.es.jiPGanadores);
  });

  it("si la lista del celular no es la que se selló, no afirma nada", async () => {
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alNombre!(1, "Ana");
    input().value = "Beto";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    escucha().alRonda?.({ r: 1, randomness: "ab".repeat(32), listHash: "b".repeat(64), k: 1 });
    expect(vista().textContent).toContain(T.es.jiPNoSePudo);
    expect(vista().textContent).not.toContain(T.es.jiPTeToco);
  });

  it("sin haberse sumado, la ronda muestra igual quiénes salieron, y dice que quedó afuera", async () => {
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alNombre!(1, "Ana");
    escucha().alNombre!(2, "Beto");
    escucha().alCierre?.();
    escucha().alRonda?.({ r: 1, randomness: "ab".repeat(32), listHash: bytesToHex(listHash(["Ana", "Beto"])), k: 1 });
    expect(vista().textContent).toContain(T.es.jiPTarde);
    expect(vista().textContent).toContain(T.es.jiPGanadores);
  });

  it("si la sala se cierra (o vence), avisa y deja de mirar", () => {
    const parar = vi.fn();
    h.seguirVivo.mockReturnValue({ parar });
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alVencida?.();
    expect(vista().textContent).toContain(T.es.jiPFin);
    expect(parar).toHaveBeenCalled();
  });

  it("Escape cierra la vista y deja de mirar", () => {
    const parar = vi.fn();
    h.seguirVivo.mockReturnValue({ parar });
    abrirParticipante(PARTICIPANTE, "es");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(vista()).toBeFalsy();
    expect(parar).toHaveBeenCalled();
  });

  it("no se abre dos veces", () => {
    abrirParticipante(PARTICIPANTE, "es");
    abrirParticipante(PARTICIPANTE, "es");
    expect(document.querySelectorAll(".participante")).toHaveLength(1);
  });
});
