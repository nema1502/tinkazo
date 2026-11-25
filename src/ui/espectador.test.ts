// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El modo espectador (`espectador.ts`): quien escanea el QR de la espera abre el mismo enlace con la lista y la ronda,
 * ve la misma cuenta regresiva y, al nacer la ronda, trae él mismo el número de los servicios públicos, lo verifica,
 * calcula los mismos ganadores con `select` y lanza el mismo show, solo para mirar. El sorteo está sellado en Stellar:
 * la cuenta lleva el margen de la sala y el show espera a que el sorteo quede grabado, comprobando que es este. Sin
 * servidor nuevo: los nombres viajan en el enlace corto cifrado (`enlace-corto.ts`) y la matemática sale del protocolo.
 */

const h = vi.hoisted(() => ({
  firma: "01".repeat(48),
  verificar: true,
  fetchRound: vi.fn((..._a: unknown[]): any => undefined),
  verifyRoundAsync: vi.fn((..._a: unknown[]): any => undefined),
  verDeNuevo: vi.fn((..._a: unknown[]): any => undefined),
  showDelEspectador: vi.fn((..._a: unknown[]): any => undefined),
  jugar: vi.fn((..._a: unknown[]): any => undefined),
  cancelar: vi.fn((..._a: unknown[]): any => undefined),
  desfaseDelReloj: vi.fn(async () => 0),
  // El panel del QR y la vista del participante (guido/final): QR y sala con falsos controlables.
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
vi.mock("./draw", () => ({
  verDeNuevo: (...a: unknown[]) => h.verDeNuevo(...a),
  showDelEspectador: (...a: unknown[]) => h.showDelEspectador(...a),
}));
// Nadie sale a la red a preguntar la hora en una prueba.
vi.mock("./espectador-reloj", () => ({ desfaseDelReloj: () => h.desfaseDelReloj() }));
// El QR y el enlace corto del panel del espectador; la sala, para la vista del participante.
vi.mock("./qr", () => ({ pintarQr: (...a: unknown[]) => h.pintarQr(...a) }));
vi.mock("../enlace-corto", () => ({
  acortar: (...a: unknown[]) => h.acortar(...a),
  enlaceParaElQr: (...a: unknown[]) => h.enlaceParaElQr(...a),
  // Lo que pide el diálogo de compartir al armar el enlace y el logo: en la prueba, sin red ni registro.
  ponerLogoDeRuta: () => undefined,
  rutaDe: (enlace: string) => enlace,
  releerCorto: (...a: unknown[]) => Promise.resolve(null),
}));
vi.mock("../sala/cliente", () => ({ servicioDeSala: () => "http://sala.test" }));
// El diálogo de compartir (`compartir.ts`) pinta la foto: en la prueba, un PNG que no toca el canvas.
vi.mock("./foto", () => ({ fotoPng: async () => new Blob(["png"], { type: "image/png" }), fotoDelJuegoPng: async () => null }));
vi.mock("../sala/participante", async (orig) => ({
  ...(await orig<typeof import("../sala/participante")>()),
  anotarseEnSala: (...a: unknown[]) => h.anotarseEnSala(...a),
  seguirVivo: (...a: unknown[]) => h.seguirVivo(...a),
}));

import { bytesToHex, hexToBytes, randomnessOf, roundTime } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { select } from "../protocol/select";
import { app, paceSeconds } from "../state";
import { etiquetaConCuenta } from "../equipos/etiquetas";
import { esSoloMirar, setSoloMirar } from "../solo-mirar";
import { T, type Lang } from "../i18n";
import type { Registro } from "../protocol/verificacion";
import { abrirEspectador, abrirPanelQrEspectador, abrirParticipante, avisarEnlaceRoto, datosDelEnlace, enlaceEspectador, type DatosEspectador, type OpcionesDeLaVista } from "./espectador";
import { decodeProof } from "../protocol/proof";
import { mensajeDeSorteo } from "./compartir";
import { LARGA_IGUAL_TRAS_MS, MARGEN_DEL_FINAL_PARTE, MARGEN_DE_LA_CADENA_S, RETRASO_TRAS_LO_GRABADO_MS } from "./espectador-regla";
import { LECTURA_DE_LA_TARJETA_S } from "../arranque-del-show";

/** Nombres de la lista sellada de prueba. */
const NOMBRES = ["Ana", "Beto", "Cami", "Dani", "Eva", "Fito"];
/** El contrato oficial de testnet (`stellar/deployments.json`). */
const CONTRATO_PRUEBA = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const CONTRATO_OFICIAL = "CANQLUVTYYZWHT2L75VDW27CWU2LKWB6EBK2AHSMHGIDRC5XSF2EVL3K";
const R = 1_000_000;

/** Un enlace de espectador: siempre de un sorteo sellado en Stellar, en Prueba y con el número 42. */
const datos = (extra: Partial<DatosEspectador> = {}): DatosEspectador => ({
  r: R,
  g: "race",
  p: "normal",
  w: 1,
  z: "Una polera",
  n: [...NOMBRES],
  net: "testnet",
  k: CONTRATO_PRUEBA,
  i: "42",
  ...extra,
});
const sellado = datos;
/** Lo mismo sin la red, el contrato ni el número: un enlace que la sala ya no arma. */
const sinSello = (): Omit<DatosEspectador, "net" | "k" | "i"> => {
  const { net: _net, k: _k, i: _i, ...resto } = datos();
  return resto;
};

/** La semilla y los ganadores que salen de la firma de prueba: lo que calcula el celular. */
const semilla = (): string => bytesToHex(randomnessOf(h.firma));
const ganadores = (n = NOMBRES, w = 1): number[] => select(hexToBytes(semilla()), listHash(n), n.length, w);

/** Un registro de la cadena: el sello del enlace y, si se pide, el resultado grabado. */
function registro(o: { grabado?: boolean; winners?: number[]; listHash?: string; meta?: string; n?: string[]; numWinners?: number } = {}): Registro {
  const n = o.n ?? NOMBRES;
  return {
    wasm: "w",
    siguiente: 100,
    sello: { id: "42", organizer: "GAAA", listHash: o.listHash ?? bytesToHex(listHash(n)), count: n.length, numWinners: o.numWinners ?? 1, round: R, sealedAt: 1, meta: o.meta ?? "Una polera", drawn: !!o.grabado },
    resultado: o.grabado ? { raffleId: "42", round: R, signature: h.firma, randomness: semilla(), winners: o.winners ?? ganadores(n), drawnAt: 2 } : null,
  };
}

const irA = vi.fn();
/**
 * Sin `leer`, la cadena ya lo muestra grabado: el show sale apenas el celular lo ve, con el retraso de la regla. El
 * azar de las lecturas, en cero: sin desfase y con la pausa más corta (3 s el primer minuto, 6 s después).
 */
const abrir = (d: DatosEspectador, op: OpcionesDeLaVista = {}): boolean =>
  abrirEspectador(d, "es", { desfase: async () => 0, irA, azar: () => 0, leer: async () => registro({ grabado: true, n: d.n }), ...op });
/**
 * Desde que se abre, 30 s antes de la ronda: la cuenta termina con la de la sala, al nacer la ronda, y el show sale
 * visto lo grabado, que se mira desde el margen de la cadena.
 */
const HASTA_EL_NUMERO = 30 * 1000;
const HASTA_EL_SHOW = (30 + MARGEN_DE_LA_CADENA_S) * 1000 + RETRASO_TRAS_LO_GRABADO_MS + 100;
/**
 * Lo que el celular espera después de ver lo grabado cuando la sala lo lanzó tarde: el retraso de siempre, la lectura de
 * la tarjeta y un 10 % del show. Se llama con el sorteo ya traído (el ritmo de la carrera depende de cuántos corren).
 */
const ESPERA_TARDE = (): number => RETRASO_TRAS_LO_GRABADO_MS + LECTURA_DE_LA_TARJETA_S * 1000 + paceSeconds("normal") * 1000 * MARGEN_DEL_FINAL_PARTE;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(roundTime(R) * 1000 - 30_000);
  for (const f of [h.fetchRound, h.verifyRoundAsync, h.verDeNuevo, h.showDelEspectador, h.jugar, h.cancelar, irA]) f.mockReset();
  h.verifyRoundAsync.mockResolvedValue(h.verificar);
  h.fetchRound.mockResolvedValue({ round: R, signature: h.firma });
  h.showDelEspectador.mockImplementation(() => ({ jugar: h.jugar, cancelar: h.cancelar }));
  // Como la de verdad: pone el QR en la imagen (panel del espectador).
  h.pintarQr.mockImplementation(async (...a: unknown[]) => {
    (a[0] as HTMLImageElement).setAttribute("src", "data:image/png;base64,qr");
    return true;
  });
  h.acortar.mockResolvedValue(null);
  h.enlaceParaElQr.mockImplementation((...a: unknown[]) => Promise.resolve({ ahora: a[0] as string, despues: Promise.resolve(null) }));
  document.body.innerHTML = `<div id="stadium" style="display:none"><button id="st-skip"></button></div>`;
  setSoloMirar(false);
  app.frozen = null;
  app.drawn = null;
  app.game = "race";
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

/** La capa del espectador, si está. */
const capa = (): HTMLElement => document.querySelector(".espectador") as HTMLElement;
const reloj = (): string => capa().querySelector<HTMLElement>(".espera-reloj")?.textContent ?? "";

describe("el enlace del espectador", () => {
  it("ida y vuelta: el enlace guarda ronda, juego, ritmo, premios, premio y nombres", () => {
    const d = datos();
    const enlace = enlaceEspectador(d, "https://tinkazo.app");
    expect(enlace).toMatch(/^https:\/\/tinkazo\.app\/#espectador=[A-Za-z0-9_-]+$/);
    expect(datosDelEnlace(new URL(enlace).hash)).toEqual(d);
  });

  it("sin premio el enlace no lleva premio vacío", () => {
    const d = datos({ z: undefined });
    const vuelto = datosDelEnlace(new URL(enlaceEspectador(d, "https://tinkazo.app")).hash);
    expect(vuelto).toEqual({ r: d.r, g: d.g, p: d.p, w: d.w, n: d.n, net: d.net, k: d.k, i: d.i });
  });

  it("rechaza lo que no es un enlace de espectador", () => {
    expect(datosDelEnlace("#sortear")).toBeNull();
    expect(datosDelEnlace("#espectador=%%%")).toBeNull();
    expect(datosDelEnlace("")).toBeNull();
    // Un contenido válido en base64 pero roto adentro.
    expect(datosDelEnlace("#espectador=" + btoa("no es json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))).toBeNull();
  });

  const hashDe = (d: object): string => new URL(enlaceEspectador(d as DatosEspectador, "https://tinkazo.app")).hash;

  it("rechaza listas que la herramienta no sella y juegos que no son un nombre", () => {
    expect(datosDelEnlace(hashDe(datos({ n: ["Ana", "Ana"] })))).toBeNull();
    expect(datosDelEnlace(hashDe(datos({ n: ["Ana"] , w: 1 })))).toBeNull();
    expect(datosDelEnlace(hashDe(datos({ n: ["Ana", "B"] })))).toBeNull();
    expect(datosDelEnlace(hashDe(datos({ n: ["Ana", "Beto\nCami"] })))).toBeNull();
    expect(datosDelEnlace(hashDe(datos({ w: 7 })))).toBeNull();
    expect(datosDelEnlace(hashDe(datos({ g: '"><img src=x>' as never })))).toBeNull();
    expect(datosDelEnlace(hashDe(datos({ p: "turbo" as never })))).toBeNull();
  });

  it("un sorteo sellado tiene que nombrar un contrato oficial de su misma red", () => {
    expect(datosDelEnlace(hashDe(sellado()))).toEqual(sellado());
    expect(datosDelEnlace(hashDe(sellado({ net: "mainnet", k: CONTRATO_OFICIAL })))).toMatchObject({ net: "mainnet", k: CONTRATO_OFICIAL });
    // El contrato de Prueba con la red Oficial, o uno que no es de Tinkazo: no abre.
    expect(datosDelEnlace(hashDe(sellado({ net: "mainnet" })))).toBeNull();
    expect(datosDelEnlace(hashDe(sellado({ k: "C" + "A".repeat(55) })))).toBeNull();
    expect(datosDelEnlace(hashDe(sellado({ i: "4x2" })))).toBeNull();
    // A medias tampoco: la red sin el número.
    expect(datosDelEnlace(hashDe({ ...sinSello(), net: "testnet", k: CONTRATO_PRUEBA }))).toBeNull();
  });

  it("sin el número del sorteo no abre: no hay con qué comparar la lista ni cómo esperar a la sala", () => {
    // Cualquiera podía armar uno con otra lista o una ronda ya pasada y mostrarlo como Vista de espectador.
    expect(datosDelEnlace(hashDe(sinSello()))).toBeNull();
  });

  it("los nombres de equipo solo valen para cuentas de la lista", () => {
    expect(datosDelEnlace(hashDe(datos({ e: [["Ana", "Las Wawas"]] })))?.e).toEqual([["Ana", "Las Wawas"]]);
    expect(datosDelEnlace(hashDe(datos({ e: [["Zoe", "Las Wawas"]] })))).toBeNull();
  });
});

describe("la espera del espectador", () => {
  it("abre para mirar, con el rótulo, el premio y la misma cuenta regresiva", async () => {
    abrir(datos());
    expect(capa()).toBeTruthy();
    expect(capa().textContent).toContain(T.es.espVistaEspectador);
    expect(capa().textContent).toContain(T.es.espLectura);
    expect(capa().textContent).toContain("Se sortea");
    expect(capa().textContent).toContain("Una polera");
    expect(capa().textContent).toContain(T.es.espNadie);
    expect(reloj()).toBe("0:30");
    await vi.advanceTimersByTimeAsync(1000);
    expect(reloj()).toBe("0:29");
    // Mientras cuenta, nadie va a buscar el número: todavía no existe.
    expect(h.fetchRound).not.toHaveBeenCalled();
  });

  it("al nacer la ronda trae el número él mismo, lo verifica y lanza el show con los mismos ganadores que la sala", async () => {
    abrir(datos());
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    expect(h.fetchRound).toHaveBeenCalledWith(R, expect.anything());
    expect(h.verifyRoundAsync).toHaveBeenCalledWith(R, h.firma);
    expect(app.drawn?.winners).toEqual(ganadores());
    expect(app.drawn?.beacon).toMatchObject({ round: R, randomness: semilla(), signature: h.firma });
    // La tarjeta sale con la espera de lo grabado, como en la sala.
    expect(h.showDelEspectador).toHaveBeenCalledWith(expect.any(Promise));
    expect(h.jugar).toHaveBeenCalledTimes(1);
    expect(app.frozen).toMatchObject({ names: NOMBRES, round: R, prize: "Una polera" });
    expect(app.game).toBe("race");
    // Y nadie tocó la cadena ni grabó nada.
    expect(app.frozen?.raffleId).toBeUndefined();
    expect(app.drawn?.drawTx).toBeUndefined();
  });

  it("con la ronda ya nacida (quien llega tarde o recarga) arranca el show enseguida", async () => {
    vi.setSystemTime(roundTime(R) * 1000 + (MARGEN_DE_LA_CADENA_S + 5) * 1000);
    abrir(datos());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchRound).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(RETRASO_TRAS_LO_GRABADO_MS + 100);
    expect(h.jugar).toHaveBeenCalledTimes(1);
  });

  it("si el número no llega dice que el ganador va a ser el mismo, y Probar de nuevo lo vuelve a buscar", async () => {
    h.fetchRound.mockRejectedValueOnce(new Error("relay 500"));
    abrir(datos());
    await vi.advanceTimersByTimeAsync(HASTA_EL_NUMERO);
    expect(capa().textContent).toContain(T.es.espSinNumero);
    // El espectador no sortea: el botón no dice Reintentar el sorteo.
    const probar = capa().querySelector<HTMLButtonElement>(".espera-accion");
    expect(probar?.textContent).toBe(T.es.espProbar);
    expect(capa().textContent).not.toContain(T.es.drawRetry);
    probar?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchRound).toHaveBeenCalledTimes(2);
    // Con el número, la cadena desde su margen, y lo grabado con su momento más.
    await vi.advanceTimersByTimeAsync(MARGEN_DE_LA_CADENA_S * 1000 + RETRASO_TRAS_LO_GRABADO_MS + 100);
    expect(h.jugar).toHaveBeenCalledTimes(1);
  });

  it("si la firma no verifica muestra el error claro y no lanza ningún show", async () => {
    h.verifyRoundAsync.mockResolvedValue(false);
    abrir(datos());
    await vi.advanceTimersByTimeAsync(HASTA_EL_NUMERO);
    expect(capa().textContent).toContain(T.es.badSig);
    expect(h.showDelEspectador).not.toHaveBeenCalled();
    expect(app.drawn).toBeNull();
  });

  it("mientras espera los intentos del servicio del número, lo dice en el lugar de la cuenta", async () => {
    let seguir: (v: unknown) => void = () => undefined;
    h.fetchRound.mockImplementation((...a: unknown[]) => {
      const [, op] = a as [number, { onAttempt?: (i: number, t: number) => void }];
      op?.onAttempt?.(2, 12);
      return new Promise((r) => (seguir = r));
    });
    abrir(datos());
    await vi.advanceTimersByTimeAsync(HASTA_EL_NUMERO);
    expect(capa().textContent).toContain(T.es.drandTry(2, 12));
    seguir({ round: R, signature: h.firma });
    await vi.advanceTimersByTimeAsync(MARGEN_DE_LA_CADENA_S * 1000 + RETRASO_TRAS_LO_GRABADO_MS + 100);
    expect(h.jugar).toHaveBeenCalledTimes(1);
  });

  it("Escape sale a la herramienta limpia, sin la lista ni el resultado de este sorteo", async () => {
    abrir(datos());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(irA).toHaveBeenCalledWith("/");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
  });

  it("no se abre dos veces con el mismo enlace", () => {
    abrir(datos());
    abrir(datos());
    expect(document.querySelectorAll(".espectador")).toHaveLength(1);
  });

  it("el estadio va debajo de la capa: mientras está arriba la capa se corre, y al terminar vuelve", async () => {
    abrir(datos());
    const estadio = document.getElementById("stadium") as HTMLElement;
    estadio.style.display = "block";
    await vi.advanceTimersByTimeAsync(0);
    expect(capa().classList.contains("detras")).toBe(true);
    estadio.style.display = "none";
    await vi.advanceTimersByTimeAsync(0);
    expect(capa().classList.contains("detras")).toBe(false);
  });

  it("al terminar el show dice quién salió, cómo seguir con otro premio y deja verlo de nuevo", async () => {
    abrir(datos());
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    const alTerminar = h.jugar.mock.calls[0]?.[0] as () => void;
    // El show del celular termina a la hora que promete el ritmo, y Lo que salió espera un margen más (`horaDelFinal`).
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000);
    alTerminar();
    expect(capa().querySelector(".espectador-ganadores")).toBeNull();
    expect(capa().textContent).toContain(T.es.espMiraLaSala);
    expect(esSoloMirar()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    const ganador = NOMBRES[ganadores()[0] ?? 0] ?? "";
    expect(capa().querySelector(".espectador-ganadores")?.textContent).toBe(ganador);
    // La sala ya coronó: verlo de nuevo se puede saltar.
    expect(esSoloMirar()).toBe(false);
    expect(document.getElementById("st-skip")?.hidden).toBe(false);
    expect(capa().textContent).toContain(T.es.espFinSiguiente);
    capa().querySelector<HTMLButtonElement>("[data-otra-vez]")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.verDeNuevo).toHaveBeenCalledTimes(1);
  });

  it("mientras cuenta la calcomanía dice En vivo y late, y al terminar deja de latir y el premio se esconde", async () => {
    abrir(datos());
    const sticker = capa().querySelector<HTMLElement>(".espera-top .sticker");
    expect(sticker?.classList.contains("en-vivo")).toBe(true);
    expect(sticker?.textContent).toBe(T.es.espVistaEspectador);
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    const alTerminar = h.jugar.mock.calls[0]?.[0] as () => void;
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000);
    alTerminar();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capa().querySelector(".espectador-ganadores")).not.toBeNull();
    expect(sticker?.classList.contains("en-vivo")).toBe(false);
    expect(sticker?.textContent).toBe(T.es.drawnDone);
    expect(capa().querySelector<HTMLElement>(".espera-premio")?.hidden).toBe(true);
  });
});

describe("el show se mira entero", () => {
  it("sin Saltar: la vista esconde el del estadio y el de la tarjeta (solo-mirar)", () => {
    expect(esSoloMirar()).toBe(false);
    abrir(datos());
    expect(esSoloMirar()).toBe(true);
    expect(document.getElementById("st-skip")?.hidden).toBe(true);
  });

  it("si el show del celular termina en el acto (pidió menos movimiento), Lo que salió espera la hora de la sala", async () => {
    // Con menos movimiento no hay tarjeta ni juego: el show termina apenas se lanza.
    h.jugar.mockImplementation((...a: unknown[]) => (a[0] as () => void)());
    abrir(datos());
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    expect(h.jugar).toHaveBeenCalledTimes(1);
    expect(capa().querySelector(".espectador-ganadores")).toBeNull();
    expect(capa().textContent).toContain(T.es.espMiraLaSala);
    const segundos = paceSeconds("normal");
    await vi.advanceTimersByTimeAsync(segundos * 1000 - 200);
    expect(capa().querySelector(".espectador-ganadores")).toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(capa().querySelector(".espectador-ganadores")?.textContent).toBe(NOMBRES[ganadores()[0] ?? 0]);
  });
});

describe("el reloj del celular", () => {
  it("si el teléfono va atrasado, la cuenta dice lo mismo que la de la sala", async () => {
    abrir(datos(), { desfase: async () => 20 });
    await vi.advanceTimersByTimeAsync(300);
    expect(reloj()).toBe("0:10");
  });

  it("hasta saber si el reloj está corrido, la cuenta no llega a cero y no busca el número", async () => {
    vi.setSystemTime(roundTime(R) * 1000 + (MARGEN_DE_LA_CADENA_S + 1) * 1000);
    abrir(datos(), { desfase: () => new Promise(() => undefined) });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
    // Sin respuesta, a los pocos segundos cuenta con el reloj del teléfono.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.fetchRound).toHaveBeenCalledOnce();
  });
});

describe("un sorteo sellado en Stellar", () => {
  it("la cuenta termina con la de la sala, que ya no suma margen", () => {
    // Que la sala no sume margen lo prueba espectador-regla.test.ts, que lee freeze.ts.
    abrir(sellado(), { leer: async () => registro() });
    expect(reloj()).toBe("0:30");
    // El número del sorteo, escrito como en la página de quien organiza.
    expect(capa().querySelector(".espera-id")?.textContent).toBe((T.es.waitIdPagina as string).replace("{n}", "42"));
    // En Prueba la sala ve el modo, y el celular también.
    expect(capa().querySelector(".espera-prueba")?.textContent).toBe(T.es.netTest);
  });

  it("no se adelanta a la sala: la tarjeta sale cuando la sala sortea y el juego cuando quedó grabado", async () => {
    const vistos: string[] = [];
    let grabado = false;
    const leer = vi.fn(async (c: { rpcUrl: string }) => {
      vistos.push(c.rpcUrl);
      return registro({ grabado });
    });
    abrir(sellado(), { leer });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
    // Nació el número: el celular lo trae, como la sala.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.fetchRound).toHaveBeenCalledOnce();
    // La tarjeta, con la espera de lo grabado; el juego, todavía no.
    expect(h.showDelEspectador).toHaveBeenCalledWith(expect.any(Promise));
    expect(h.jugar).not.toHaveBeenCalled();
    expect(capa().textContent).toContain(T.es.cortinaGraba);
    // La cadena no acepta el sorteo grabado antes de su margen: hasta ahí, el celular no la mira.
    const leidasAlNacer = leer.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MARGEN_DE_LA_CADENA_S * 1000 - 100);
    expect(leer.mock.calls.length).toBe(leidasAlNacer);
    await vi.advanceTimersByTimeAsync(200);
    expect(leer.mock.calls.length).toBeGreaterThan(leidasAlNacer);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.jugar).not.toHaveBeenCalled();
    // Quedó grabado: el celular lo ve en su vuelta siguiente, y espera un momento más, de margen. La sala ya jugaba:
    // no espera lo grabado.
    grabado = true;
    await vi.advanceTimersByTimeAsync(1_600);
    expect(h.jugar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRASO_TRAS_LO_GRABADO_MS);
    expect(h.jugar).toHaveBeenCalledTimes(1);
    const espera = h.showDelEspectador.mock.calls[0]?.[0] as Promise<void>;
    await expect(espera).resolves.toBeUndefined();
    // Leyó la red del enlace, y fue cambiando de RPC entre vuelta y vuelta.
    expect(new Set(vistos).size).toBeGreaterThan(1);
    expect(vistos.every((u) => /testnet|ankr/.test(u))).toBe(true);
  });

  it("si quien organiza tarda en lanzarlo, lo dice y sigue esperando", async () => {
    abrir(sellado(), { leer: async () => registro() });
    await vi.advanceTimersByTimeAsync((30 + MARGEN_DE_LA_CADENA_S) * 1000 + 61_000);
    expect(capa().textContent).toContain(T.es.espTarda);
    expect(h.jugar).not.toHaveBeenCalled();
  });

  it("con la cadena diciendo sellado y sin resultado no juega aunque pase el tope: la sala todavía no lo lanzó", async () => {
    let grabado = false;
    abrir(sellado(), { leer: async () => registro({ grabado }) });
    await vi.advanceTimersByTimeAsync((30 + MARGEN_DE_LA_CADENA_S) * 1000);
    // Quien organiza volvió a la página para hablar: pasan el tope y varios minutos más.
    await vi.advanceTimersByTimeAsync(LARGA_IGUAL_TRAS_MS + 5 * 60_000);
    expect(h.jugar).not.toHaveBeenCalled();
    expect(capa().textContent).toContain(T.es.espTarda);
    // Lo lanzó: el celular lo ve grabado y juega detrás de la sala. La lanzó tarde: el celular cuenta también la lectura
    // de la tarjeta y una parte del show.
    grabado = true;
    await vi.advanceTimersByTimeAsync(10_000 + ESPERA_TARDE());
    expect(h.jugar).toHaveBeenCalledTimes(1);
    expect(app.drawn?.winners).toEqual(ganadores());
    // La tarjeta, que esperaba lo grabado, sigue con la cuenta.
    await expect(h.showDelEspectador.mock.calls[0]?.[0] as Promise<void>).resolves.toBeUndefined();
  });

  it("si la sala lo lanza tarde, el celular cuenta la lectura de la tarjeta desde que lo ve grabado, y una parte del show", async () => {
    // La sala que lanza tarde abre su tarjeta al lanzar y la lee después del número: lo grabado aparece apenas un par de
    // segundos después de que lanzó. La tarjeta del celular está leída desde que nació el número.
    let grabado = false;
    let vistoEn = 0;
    abrir(sellado(), {
      leer: async () => {
        if (grabado && !vistoEn) vistoEn = Date.now();
        return registro({ grabado });
      },
    });
    // Nace el número y quien organiza toca Lanzar el sorteo 30 s después.
    await vi.advanceTimersByTimeAsync(30_000 + 30_000);
    expect(h.showDelEspectador).toHaveBeenCalledOnce();
    grabado = true;
    // El celular lo ve en su vuelta siguiente.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(vistoEn).toBeGreaterThan(0);
    // Con solo el retraso de siempre arrancaba 1 s detrás de la sala. Ahora espera también la lectura y el 10 % del show.
    await vi.advanceTimersByTimeAsync(vistoEn + RETRASO_TRAS_LO_GRABADO_MS + LECTURA_DE_LA_TARJETA_S * 1000 - Date.now());
    expect(h.jugar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(vistoEn + ESPERA_TARDE() - 300 - Date.now());
    expect(h.jugar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(h.jugar).toHaveBeenCalledTimes(1);
    // La tarjeta, que esperaba lo grabado, sigue con la cuenta.
    await expect(h.showDelEspectador.mock.calls[0]?.[0] as Promise<void>).resolves.toBeUndefined();
  });

  it("si la cadena contesta y el sello de ese número nunca aparece, el enlace no es de un sorteo sellado", async () => {
    abrir(sellado(), { leer: async () => ({ ...registro(), sello: null, siguiente: 7 }) });
    await vi.advanceTimersByTimeAsync((30 + MARGEN_DE_LA_CADENA_S) * 1000 + LARGA_IGUAL_TRAS_MS + 10_000);
    expect(capa().textContent).toContain(T.es.espNoCoincide);
    expect(h.jugar).not.toHaveBeenCalled();
    expect(h.cancelar).toHaveBeenCalled();
  });

  it("con la cadena sin contestar no se queda colgado: pregunta a los dos servicios y, pasado el tope, juega", async () => {
    const vistos = new Set<string>();
    abrir(sellado(), {
      leer: async (c) => {
        vistos.add(c.rpcUrl);
        throw new Error("rpc caído");
      },
    });
    await vi.advanceTimersByTimeAsync((30 + MARGEN_DE_LA_CADENA_S) * 1000 + LARGA_IGUAL_TRAS_MS + 5_000);
    expect(h.jugar).toHaveBeenCalledTimes(1);
    expect(vistos.size).toBe(2);
    // Una cadena que no contesta no es un enlace equivocado.
    expect(capa().textContent).not.toContain(T.es.espNoCoincide);
  });

  it("un sello que el servicio todavía no muestra no es un enlace equivocado: sigue mirando", async () => {
    let hay = false;
    abrir(sellado(), { leer: async () => (hay ? registro({ grabado: true }) : { ...registro(), sello: null, siguiente: 42 }) });
    await vi.advanceTimersByTimeAsync((30 + MARGEN_DE_LA_CADENA_S) * 1000);
    expect(capa().textContent).not.toContain(T.es.espNoCoincide);
    hay = true;
    await vi.advanceTimersByTimeAsync(3_500 + RETRASO_TRAS_LO_GRABADO_MS);
    expect(h.jugar).toHaveBeenCalledTimes(1);
  });

  it("un premio que no es el sellado: lo dice al abrir y no deja a la vista el premio del enlace", async () => {
    abrir(sellado({ z: "Un auto" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(capa().textContent).toContain(T.es.espNoCoincide);
    expect(capa().querySelector<HTMLElement>(".espera-premio")?.hidden).toBe(true);
    expect(capa().querySelector<HTMLElement>(".espera-nombres")?.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
  });

  it("sin premio en el enlace no hay nada que comparar: el sello guarda el texto de siempre", async () => {
    abrir(sellado({ z: undefined }), { leer: async () => registro({ grabado: true, meta: "Sorteo" }) });
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    expect(h.jugar).toHaveBeenCalledTimes(1);
  });

  it("si el sello no es el del enlace, lo dice al abrir y nunca busca el número", async () => {
    abrir(sellado(), { leer: async () => registro({ listHash: "ff".repeat(32) }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(capa().textContent).toContain(T.es.espNoCoincide);
    // No hay nada que reintentar: el enlace es otro.
    expect(capa().querySelector(".espera-accion")).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
  });

  it("si lo grabado no es lo que calculó el celular, no hay show y la tarjeta se va", async () => {
    let grabado = false;
    const otros = [(ganadores()[0]! + 1) % NOMBRES.length];
    abrir(sellado(), { leer: async () => registro(grabado ? { grabado, winners: otros } : {}) });
    await vi.advanceTimersByTimeAsync((30 + MARGEN_DE_LA_CADENA_S) * 1000);
    grabado = true;
    await vi.advanceTimersByTimeAsync(3_500);
    expect(capa().textContent).toContain(T.es.espNoCoincide);
    expect(h.cancelar).toHaveBeenCalled();
    expect(h.jugar).not.toHaveBeenCalled();
  });
});

describe("un enlace roto", () => {
  it("no cae callado en la herramienta: lo dice, y el botón lleva a la página sin el enlace roto", () => {
    history.replaceState(null, "", "/#espectador=roto");
    avisarEnlaceRoto("es");
    expect(capa().textContent).toContain(T.es.espEnlaceRoto);
    const b = capa().querySelector<HTMLButtonElement>(".espera-accion");
    expect(b?.textContent).toBe(T.es.espIrALaPagina);
    b?.click();
    expect(document.querySelector(".espectador")).toBeNull();
    expect(location.hash).toBe("");
  });

  it("no se nombra En vivo: la capa lleva el motivo, porque ahí no hay nada en vivo", () => {
    history.replaceState(null, "", "/#espectador=roto");
    avisarEnlaceRoto("es");
    expect(capa().classList.contains("espectador-roto")).toBe(true);
    expect(capa().getAttribute("aria-label")).toBe(T.es.espEnlaceRoto);
  });
});

describe("los equipos con cupón", () => {
  it("la cinta muestra el nombre de cada equipo, no la cuenta", () => {
    const cuentas = ["G" + "A".repeat(55), "G" + "B".repeat(55)];
    abrir(datos({ n: cuentas, e: [[cuentas[0]!, "Las Wawas"], [cuentas[1]!, "Los Cóndores"]] }));
    const cinta = capa().querySelector(".espera-nombres")?.textContent ?? "";
    expect(cinta).toContain("Las Wawas");
    expect(cinta).toContain("Los Cóndores");
    expect(cinta).not.toContain(cuentas[0]);
  });

  it("al final, el equipo que ganó va con el comienzo de su cuenta, como en la sala: el nombre no está sellado", async () => {
    const cuentas = ["G" + "A".repeat(55), "G" + "B".repeat(55)];
    abrir(datos({ n: cuentas, e: [[cuentas[0]!, "Las Wawas"], [cuentas[1]!, "Los Cóndores"]] }));
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    expect(h.jugar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000);
    (h.jugar.mock.calls[0]?.[0] as () => void)();
    await vi.advanceTimersByTimeAsync(10_000);
    const gana = cuentas[ganadores(cuentas)[0] ?? 0] ?? "";
    const final = capa().querySelector(".espectador-ganadores")?.textContent ?? "";
    expect(final).toBe(etiquetaConCuenta(gana));
    expect(final).toContain(gana.slice(0, 4));
  });
});

describe("un orden de turnos visto desde el celular", () => {
  const NOMBRE_DEL_ORDEN = "Turnos de la tarde";
  const orden = (): DatosEspectador => datos({ z: NOMBRE_DEL_ORDEN, w: NOMBRES.length });
  const abrirOrden = (lang: Lang): boolean =>
    abrirEspectador(orden(), lang, {
      desfase: async () => 0,
      irA,
      azar: () => 0,
      leer: async () => registro({ grabado: true, meta: NOMBRE_DEL_ORDEN, numWinners: NOMBRES.length, winners: ganadores(NOMBRES, NOMBRES.length) }),
    });
  /** Lo que el celular no puede decir de un orden: no hay premio ni quien gane. Con borde de palabra: organiza no es ganar. */
  const habla = /\bgan|\bpremio|\bwon\b|\bwin|\bprize/i;

  for (const lang of ["es", "en"] as const) {
    it(`mientras espera dice el orden de los turnos, como la sala, y no un premio (${lang})`, () => {
      abrirOrden(lang);
      expect(capa().textContent).toContain(T[lang].cortinaSeOrden);
      expect(capa().textContent).not.toContain(NOMBRE_DEL_ORDEN);
      expect(capa().textContent).not.toMatch(habla);
    });

    it(`si el número no llega, dice que el orden va a ser el mismo (${lang})`, async () => {
      h.fetchRound.mockRejectedValueOnce(new Error("relay 500"));
      abrirOrden(lang);
      await vi.advanceTimersByTimeAsync(HASTA_EL_NUMERO);
      expect(capa().textContent).toContain(T[lang].espSinNumeroOrden);
      expect(capa().textContent).not.toMatch(habla);
    });

    it(`mientras sigue el show de la sala y al terminar no habla de ganar ni de otro premio (${lang})`, async () => {
      abrirOrden(lang);
      await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
      const alTerminar = h.jugar.mock.calls[0]?.[0] as () => void;
      await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000);
      alTerminar();
      expect(capa().textContent).toContain(T[lang].espMiraLaSalaOrden);
      expect(capa().textContent).not.toMatch(habla);
      await vi.advanceTimersByTimeAsync(10_000);
      // Los turnos, uno por persona y en el orden en que salieron.
      const turnos = [...capa().querySelectorAll(".espectador-ganadores li")].map((li) => li.textContent);
      expect(turnos).toEqual(ganadores(NOMBRES, NOMBRES.length).map((i) => NOMBRES[i]));
      expect(capa().textContent).not.toContain(T[lang].espFinSiguiente);
      expect(capa().textContent).not.toMatch(habla);
      // Verlo de nuevo sigue estando.
      expect(capa().querySelector("[data-otra-vez]")).not.toBeNull();
    });
  }

  it("un sorteo común sigue como siempre: el premio, quién salió y cómo seguir con otro premio", async () => {
    abrir(datos());
    expect(capa().textContent).toContain(`${T.es.cortinaSe} Una polera`);
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000);
    (h.jugar.mock.calls[0]?.[0] as () => void)();
    expect(capa().textContent).toContain(T.es.espMiraLaSala);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capa().textContent).toContain(T.es.espFinSiguiente);
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

  it("mientras la señal falla avisa que reconecta, y al volver deja de decirlo", () => {
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alReconectando?.(1);
    expect(vista().textContent).toContain(T.es.jiPReconectando);
    escucha().alReconecto?.();
    expect(vista().textContent).not.toContain(T.es.jiPReconectando);
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

  it("si el nombre ya está en la sala, lo dice para que pruebe con otro", async () => {
    h.anotarseEnSala.mockResolvedValue({ ok: false, motivo: "repetido" });
    abrirParticipante(PARTICIPANTE, "es");
    input().value = "Ana";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(vista().textContent).toContain(T.es.jiPErrRepetido);
    expect(vista().textContent).not.toContain(T.es.jiPErrOtro);
  });

  it("un corte de red avisa que reconecta sin rehacer el formulario: lo que la persona escribe queda", () => {
    abrirParticipante(PARTICIPANTE, "es");
    const antes = input();
    antes.value = "Ana";
    escucha().alReconectando?.(1);
    expect(vista().textContent).toContain(T.es.jiPReconectando);
    expect(input()).toBe(antes);
    expect(input().value).toBe("Ana");
    escucha().alReconecto?.();
    expect(vista().textContent).not.toContain(T.es.jiPReconectando);
    expect(input()).toBe(antes);
    expect(input().value).toBe("Ana");
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

  it("el resultado grande lleva la palabra Ejemplo a la vista", async () => {
    const ronda = { r: 1, randomness: "ab".repeat(32), listHash: bytesToHex(listHash(["Ana", "Beto"])), k: 1 };
    abrirParticipante(PARTICIPANTE, "es");
    escucha().alNombre(1, "Ana");
    input().value = "Beto";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    escucha().alRonda?.(ronda);
    const marca = vista().querySelector<HTMLElement>(".ji-p-cuerpo .ji-p-marca");
    expect(marca?.textContent).toBe(T.es.jiPMarcaEjemplo);
    // Va justo antes del resultado grande, no al pie.
    expect(marca?.nextElementSibling?.classList.contains("ji-p-resultado")).toBe(true);
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

  it("quien se anota antes de ver a los que entraron un instante antes llega igual a la lista sellada", async () => {
    // La sala le da el 101 y el celular lo pone enseguida; Ana (1) y Beto (2) recién llegan con el sondeo siguiente.
    abrirParticipante(PARTICIPANTE, "es");
    input().value = "Dani";
    botonSumarme().click();
    await vi.advanceTimersByTimeAsync(0);
    escucha().alNombre(1, "Ana");
    escucha().alNombre(2, "Beto");
    expect([...vista().querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["Ana", "Beto", "Dani"]);
    escucha().alRonda?.({ r: 1, randomness: "ab".repeat(32), listHash: bytesToHex(listHash(["Ana", "Beto", "Dani"])), k: 1 });
    expect(vista().textContent).not.toContain(T.es.jiPNoSePudo);
    expect(vista().textContent).toContain(T.es.jiPGanadores);
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

/* ------------------------------------------------------------ compartir en vivo (issue #247) */

describe("compartir el sorteo desde la vista en vivo", () => {
  const dialogo = (): HTMLDialogElement => document.querySelector("dialog") as HTMLDialogElement;

  beforeEach(() => {
    // Lo justo para abrir el diálogo en jsdom: diálogos modales, hojas del sistema y la foto en memoria.
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
      HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      };
    }
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    // Sin compresión en jsdom (su Blob no tiene .stream()): el comprobante viaja sin comprimir, igual de válido.
    vi.stubGlobal("CompressionStream", undefined);
    URL.createObjectURL = () => "blob:prueba";
    URL.revokeObjectURL = () => undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** El camino de todos, hasta ver Lo que salió en la vista del espectador. */
  const hastaElFin = async (op: OpcionesDeLaVista = {}): Promise<void> => {
    abrir(datos(), op);
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    (h.jugar.mock.calls[0]?.[0] as () => void)();
    // El show corre su duración y Lo que salió espera su margen (`horaDelFinal`), como en las pruebas del final.
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000 + 10_000);
  };

  it("durante el vivo, Lo que salió ofrece compartir y abre el mismo diálogo de «Compartir el sorteo»", async () => {
    await hastaElFin();
    const b = capa().querySelector<HTMLButtonElement>("[data-compartir]");
    expect(b?.textContent).toBe(T.es.cmpBtn);
    b?.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    expect(dialogo().querySelector("h2")?.textContent).toBe(T.es.cmpSorteo);
    // La vista completa: la acción principal y las dos formas de ir a mano, listas, con la foto a la vista.
    const wa = dialogo().querySelector<HTMLButtonElement>("[data-whatsapp]");
    expect(wa?.textContent).toBe(T.es.cmpWa);
    expect(wa?.disabled).toBe(false);
    expect(dialogo().querySelector<HTMLButtonElement>("[data-bajar]")?.disabled).toBe(false);
    expect(dialogo().querySelector<HTMLButtonElement>("[data-copiar]")?.disabled).toBe(false);
    expect(dialogo().querySelector(".cmp-png")).toBeTruthy();
  });

  it("el mensaje y el comprobante son los del sorteo de la sala, no una variante nueva", async () => {
    await hastaElFin();
    capa().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    const txt = dialogo().querySelector<HTMLTextAreaElement>(".cmp-txt");
    expect(txt?.value).toBeTruthy();
    // El enlace de verificación lleva el mismo comprobante que arma la sala: la lista, la ronda, la firma y el número.
    const pieza = txt?.value.match(/https?:\/\/\S+\/verificar\.html#\S+/)?.[0] ?? "";
    expect(pieza).not.toBe("");
    const comprobante = await decodeProof("#" + new URL(pieza).hash.slice(1));
    expect(comprobante).toMatchObject({
      names: NOMBRES,
      round: R,
      sealedAt: roundTime(R),
      prize: "Una polera",
      signature: h.firma,
      net: "testnet",
      contract: CONTRATO_PRUEBA,
      id: "42",
    });
    // Y el mensaje sale del mismo camino que comparte la sala: cada palabra igual para un mismo sorteo.
    const esperado = mensajeDeSorteo("es", {
      enlace: pieza,
      ganadores: ganadores().map((i) => NOMBRES[i] ?? ""),
      total: NOMBRES.length,
      personas: NOMBRES.length,
      premio: "Una polera",
      fecha: roundTime(R),
      numero: "42",
      red: "testnet",
    });
    expect(txt?.value).toBe(esperado);
  });

  it("con quién ganó cada premio, el mensaje nombra a los que ya salieron y nada de lo que falta", async () => {
    // Un espectador de un sorteo con dos premios: la vista es la misma, con la lista de los dos. La cadena de prueba
    // graba el sorteo con sus dos ganadores, para que el celular sa adelante a jugar.
    abrir(datos({ z: "Vinos del valle", w: 2 }), { leer: async () => registro({ grabado: true, n: NOMBRES, numWinners: 2, winners: ganadores(NOMBRES, 2), meta: "Vinos del valle" }) });
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    (h.jugar.mock.calls[0]?.[0] as () => void)();
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000 + 10_000);
    capa().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    const esperados = ganadores(NOMBRES, 2).map((i) => NOMBRES[i] ?? "");
    const txt = dialogo().querySelector<HTMLTextAreaElement>(".cmp-txt")?.value ?? "";
    for (const nombre of esperados) expect(txt).toContain(nombre);
    expect(txt).toContain(T.es.cmpNadieVarios);
  });

  it("al cerrar el diálogo se vuelve a la vista con su estado: Lo que salió y «otro premio? escaneá el QR nuevo»", async () => {
    await hastaElFin();
    capa().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    dialogo().querySelector<HTMLButtonElement>("[data-cerrar]")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dialogo()).toBeFalsy();
    const ganador = NOMBRES[ganadores()[0] ?? 0] ?? "";
    expect(capa().querySelector(".espectador-ganadores")?.textContent).toBe(ganador);
    expect(capa().textContent).toContain(T.es.espFinSiguiente);
    // La vista no se fue a ningún lado (sin salida) y «Ver de nuevo» sigue donde estaba.
    expect(irA).not.toHaveBeenCalled();
    capa().querySelector<HTMLButtonElement>("[data-otra-vez]")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.verDeNuevo).toHaveBeenCalledTimes(1);
  });

  it("con el diálogo abierto, Escape lo cierra a él: no se sale de la vista en vivo", async () => {
    await hastaElFin();
    capa().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // La vista sigue, con su estado: nadie llamó a salir.
    expect(capa()).toBeTruthy();
    expect(irA).not.toHaveBeenCalled();
    // Y cerrado el diálogo, Escape de la vista sigue andando como siempre.
    dialogo().querySelector<HTMLButtonElement>("[data-cerrar]")?.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(irA).toHaveBeenCalled();
  });

  it("si el archivo del diálogo no baja, lo dice con el tono del sitio y deja tocar de nuevo", async () => {
    const real = (): Promise<typeof import("./compartir")> => import("./compartir");
    const cargar = vi.fn(real).mockRejectedValueOnce(new Error("sin red"));
    await hastaElFin({ cargarCompartir: cargar });
    const boton = capa().querySelector<HTMLButtonElement>("[data-compartir]");
    boton?.click();
    await vi.advanceTimersByTimeAsync(0);
    // Sin diálogo, pero con el motivo a la vista y el botón listo para otro toque.
    expect(dialogo()).toBeFalsy();
    const aviso = capa().querySelector<HTMLElement>("[data-compartir-aviso]");
    expect(aviso?.textContent).toBe(T.es.espCompartirFallo);
    expect(aviso?.getAttribute("role")).toBe("alert");
    expect(boton?.disabled).toBe(false);
    expect(boton?.getAttribute("aria-busy")).not.toBe("true");
    // Y el segundo toque abre el diálogo y baja el aviso.
    boton?.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(capa().querySelector<HTMLElement>("[data-compartir-aviso]")?.textContent).toBe("");
  });

  it("el aviso de que no bajó el archivo también sale en inglés", async () => {
    abrirEspectador(datos(), "en", { desfase: async () => 0, irA, azar: () => 0, leer: async () => registro({ grabado: true }), cargarCompartir: () => Promise.reject(new Error("sin red")) });
    await vi.advanceTimersByTimeAsync(HASTA_EL_SHOW);
    (h.jugar.mock.calls[0]?.[0] as () => void)();
    await vi.advanceTimersByTimeAsync(paceSeconds("normal") * 1000 + 10_000);
    capa().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(capa().querySelector("[data-compartir-aviso]")?.textContent).toBe(T.en.espCompartirFallo);
  });

  it("un segundo toque mientras se prepara no abre un segundo diálogo", async () => {
    let soltar: (m: typeof import("./compartir")) => void = () => undefined;
    const cargar = vi.fn(() => new Promise<typeof import("./compartir")>((r) => (soltar = r)));
    await hastaElFin({ cargarCompartir: cargar });
    const boton = capa().querySelector<HTMLButtonElement>("[data-compartir]");
    boton?.click();
    boton?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(cargar).toHaveBeenCalledTimes(1);
    soltar(await import("./compartir"));
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    expect(document.querySelectorAll("dialog").length).toBe(1);
  });

  it("al cerrar el diálogo el foco vuelve al botón Compartir, el lugar exacto de donde salió", async () => {
    await hastaElFin();
    const boton = capa().querySelector<HTMLButtonElement>("[data-compartir]") as HTMLButtonElement;
    boton.focus();
    boton.click();
    await vi.waitFor(() => expect(dialogo()).toBeTruthy());
    // Dentro del diálogo el foco anda por sus botones: la vista de atrás queda quieta.
    dialogo().querySelector<HTMLButtonElement>("[data-cerrar]")?.focus();
    dialogo().querySelector<HTMLButtonElement>("[data-cerrar]")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dialogo()).toBeFalsy();
    expect(document.activeElement).toBe(boton);
  });
});
