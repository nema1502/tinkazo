// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Escucha, Sala } from "../sala/cliente";

type Cambios = { quitar: string[]; sumar: string[] };

const h = vi.hoisted(() => ({
  app: { frozen: null as unknown, drawn: null as unknown },
  escucha: null as Escucha | null,
  cerrarSala: vi.fn(async () => true),
  crearSala: vi.fn(async () => true as unknown as Sala),
  quitarNombreEnSala: vi.fn(async () => true),
  salir: null as null | (() => Promise<boolean>),
  paraLaSiguiente: null as null | (() => Cambios),
}));

vi.mock("../state", () => ({ app: h.app }));
vi.mock("../ensayo-modo", () => ({ enStand: () => true }));
vi.mock("../i18n", () => {
  const textos: Record<string, string> = {
    standSalaQuitarAria: "Quitar a {nombre}",
    standSalaQuitado: "Quitaste a {nombre}.",
    standSalaCerradoN: "QR cerrado. Los {n} nombres siguen en la lista.",
    standSalaCerrado0: "QR cerrado.",
    standSalaCerrado1: "QR cerrado. El nombre sigue en la lista.",
    standSalaOtro: "Armar otro QR",
    standSalaErrCerrar: "No pudimos cerrar el QR.",
    standSalaErrQuitar: "No pudimos quitar el nombre.",
    standSalaErrSalir: "No pudimos cerrar el QR al salir.",
    standSalaCrear: "Mostrar el QR",
    standSalaCreando: "Armando el QR…",
    standSalaEnVivo: "En vivo",
    standSalaSondeo: "Los nombres llegan con demora",
    standSalaConectando: "Conectando…",
    standSalaCuenta1: "1 persona",
    standSalaCuentaN: "{n} personas",
    standSalaVacia: "Nadie",
    standSalaEmpezarN: "Empezar con {n}",
    standSalaFalta1: "Falta 1",
    standSalaFaltanN: "Faltan {n}",
    standSalaMostrar: "Mostrar",
    standSalaRepetido: "repetido",
    standSalaGrande: "Ver el QR",
    standSalaGrandeCerrar: "Volver",
    standSalaNuevaMsg: "Lista vacía.",
    standSalaVencida: "El QR venció.",
    standSalaIlegibles: "Hay nombres que no se pueden leer.",
  };
  return {
    onLangChange: () => undefined,
    t: (k: string) => textos[k] ?? k,
  };
});
vi.mock("../sala/cifra", () => ({
  descifrarNombre: async (_clave: string, dato: string) => dato,
}));
vi.mock("../sala/cliente", () => ({
  cerrarSala: h.cerrarSala,
  crearSala: h.crearSala,
  enlaceDeSala: (s: Sala) => `${s.servicio}/${s.id}#${s.clave}`,
  escucharSala: (_s: Sala, e: Escucha) => {
    h.escucha = e;
    return { parar: () => undefined };
  },
  quitarNombreEnSala: h.quitarNombreEnSala,
}));
vi.mock("./participants", () => ({
  parseNames: () => (document.getElementById("ta") as HTMLTextAreaElement).value.split("\n").filter((l) => l.trim()),
  setList: (texto: string) => {
    (document.getElementById("ta") as HTMLTextAreaElement).value = texto;
  },
}));
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));
vi.mock("./stand", () => ({
  alAvisarEnStand: () => undefined,
  alPreguntarPorElQr: () => undefined,
  alSalirDelStand: (f: () => Promise<boolean>) => {
    h.salir = f;
  },
  nombresParaLaSiguiente: (f: () => Cambios) => {
    h.paraLaSiguiente = f;
  },
  otraRonda: () => undefined,
  repintarGuia: () => undefined,
  soltarResultadoDelStand: () => true,
}));

const SALA: Sala = {
  id: "AbCd1234",
  token: "T".repeat(22),
  clave: "A".repeat(22),
  vence: Date.now() + 60_000,
  servicio: "https://sala.test",
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const boton = (id: string): HTMLButtonElement => el<HTMLButtonElement>(id);
const cuadro = (): HTMLTextAreaElement => el<HTMLTextAreaElement>("ta");

/** Los oyentes de cada módulo cargado: una página de prueba no deja oyentes en la siguiente. */
const oyentes: Array<[string, EventListenerOrEventListenerObject]> = [];
const agregarEnDocumento = document.addEventListener.bind(document);
const quitarOyentes = (): void => {
  for (const [tipo, f] of oyentes.splice(0)) document.removeEventListener(tipo, f);
};

/** Una sala nueva, sin el estado ni los oyentes de la prueba anterior. */
async function cargar(): Promise<void> {
  quitarOyentes();
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = `
    <textarea id="ta"></textarea>
    <button id="btn-freeze" class="ghost"></button>
    <div id="stand-sala">
      <div id="sala-cerrada"><button id="sala-crear"></button><button id="stand-a-mano"></button></div>
      <p id="sala-error" hidden></p>
      <p id="sala-deshacer" hidden><span id="sala-deshacer-t"></span><button id="sala-deshacer-b"></button></p>
      <div id="sala-abierta" hidden>
        <img id="sala-qr-img"><p id="sala-estado"></p><p id="sala-cuenta"></p>
        <button id="sala-empezar"></button><button id="sala-grande"></button>
        <button id="sala-nueva"></button>
        <ul id="sala-nombres"></ul><div id="sala-revisar"></div><ul id="sala-revisar-lista"></ul>
        <button id="sala-cerrar"></button>
      </div>
    </div>
    <button id="stand-qr" hidden></button>`;
  vi.spyOn(document, "addEventListener").mockImplementation(
    (tipo: string, f: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
      oyentes.push([tipo, f]);
      agregarEnDocumento(tipo, f, o);
    },
  );
  const { initStandSala } = await import("./stand-sala");
  initStandSala();
}

/** Crea el QR y espera a que la sala esté escuchando. */
async function mostrarQr(): Promise<void> {
  boton("sala-crear").click();
  await vi.waitFor(() => expect(h.escucha).not.toBeNull());
}

/** Espera el descifrado antes de mirar la lista. */
async function esperarNombre(nombre: string): Promise<void> {
  await vi.waitFor(() => expect(cuadro().value.split("\n")).toContain(nombre));
}

beforeEach(() => {
  h.app.frozen = null;
  h.app.drawn = null;
  h.escucha = null;
  h.salir = null;
  h.paraLaSiguiente = null;
  // El DOM de prueba no lleva un elemento a la vista: los avisos lo piden al pintarse.
  Element.prototype.scrollIntoView = () => undefined;
  vi.resetAllMocks();
  h.cerrarSala.mockResolvedValue(true);
  h.crearSala.mockResolvedValue(SALA);
  h.quitarNombreEnSala.mockResolvedValue(true);
});

afterEach(() => {
  quitarOyentes();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("cerrar el QR con Deshacer", () => {
  it("Cerrar el QR lo saca de la vista enseguida y no llama al servicio antes de cinco segundos", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    expect(el("sala-abierta").hidden).toBe(true);
    expect(el("sala-cerrada").hidden).toBe(false);
    expect(el("sala-deshacer").hidden).toBe(false);
    expect(h.cerrarSala).not.toHaveBeenCalled();
  });

  it("a los cinco segundos lo cierra de verdad y borra lo guardado en la pestaña", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.cerrarSala).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("tinkazo.sala")).toBeNull();
  });

  it("durante esos cinco segundos lo guardado en la pestaña sigue: una recarga vuelve con el QR abierto", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    expect(el("sala-abierta").hidden).toBe(true);
    expect(sessionStorage.getItem("tinkazo.sala")).not.toBeNull();
    // La recarga de la página vuelve a leer lo guardado y reabre el mismo QR.
    document.dispatchEvent(new Event("tinkazo:stand"));
    expect(el("sala-abierta").hidden).toBe(false);
    expect(h.cerrarSala).not.toHaveBeenCalled();
  });

  it("Deshacer antes de cinco segundos lo deja abierto y no llama al servicio ni a los seis segundos", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    expect(el("sala-abierta").hidden).toBe(true);
    boton("sala-deshacer-b").click();
    expect(el("sala-abierta").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.cerrarSala).not.toHaveBeenCalled();
  });

  it("el aviso dice cuántos nombres siguen en la lista", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    cuadro().value = "Ana\nBeto";
    boton("sala-cerrar").click();
    expect(el("sala-deshacer-t").textContent).toBe("QR cerrado. Los 2 nombres siguen en la lista.");
    boton("sala-deshacer-b").click();
    cuadro().value = "";
    boton("sala-cerrar").click();
    expect(el("sala-deshacer-t").textContent).toBe("QR cerrado.");
  });

  it("cerrar durante la ronda conserva y cuenta las llegadas que todavía no entraron al cuadro", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    h.escucha?.alNombre(2, "Beto");
    await esperarNombre("Beto");
    h.app.frozen = { names: ["Ana", "Beto"] };
    h.escucha?.alNombre(3, "Carla");
    await vi.waitFor(() => expect(el("sala-nombres").textContent).toContain("Carla"));
    expect(cuadro().value).toBe("Ana\nBeto");
    vi.useFakeTimers();

    boton("sala-cerrar").click();
    expect(el("sala-deshacer-t").textContent).toBe("QR cerrado. Los 3 nombres siguen en la lista.");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(h.paraLaSiguiente?.()).toEqual({ quitar: [], sumar: ["Carla"] });
    expect(h.paraLaSiguiente?.()).toEqual({ quitar: [], sumar: [] });
  });

  it("si el servicio no puede cerrarlo, vuelve a estar abierto y lo dice", async () => {
    await cargar();
    await mostrarQr();
    h.cerrarSala.mockResolvedValueOnce(false);
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(el("sala-abierta").hidden).toBe(false);
    expect(el("sala-error").textContent).toBe("No pudimos cerrar el QR.");
  });

  it("mientras vive Deshacer no se puede armar otro QR, y al deshacer vuelve el botón", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    expect(boton("sala-crear").hidden).toBe(true);
    boton("sala-deshacer-b").click();
    expect(boton("sala-crear").hidden).toBe(false);
  });

  it("después de confirmar el cierre, Armar otro QR cierra primero el anterior", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(boton("sala-crear").textContent).toBe("Armar otro QR");
    expect(boton("sala-crear").hidden).toBe(false);
    boton("sala-crear").click();
    expect(h.cerrarSala).toHaveBeenCalledTimes(1);
    expect(h.crearSala).toHaveBeenCalledTimes(2);
    const cerrar = h.cerrarSala.mock.invocationCallOrder[0] as number;
    const primera = h.crearSala.mock.invocationCallOrder[0] as number;
    const segunda = h.crearSala.mock.invocationCallOrder[1] as number;
    expect(cerrar).toBeGreaterThan(primera);
    expect(cerrar).toBeLessThan(segunda);
  });
});

describe("quitar un nombre con la cruz y Deshacer", () => {
  it("quitar con la cruz saca el nombre enseguida y del servicio recién a los cinco segundos", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    vi.useFakeTimers();
    (document.querySelector("#sala-nombres li button") as HTMLButtonElement).click();
    expect(cuadro().value).not.toContain("Ana");
    expect(el("sala-nombres").textContent).not.toContain("Ana");
    expect(h.quitarNombreEnSala).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.quitarNombreEnSala).toHaveBeenCalledTimes(1);
  });

  it("deshacer después de quitar devuelve el nombre a su renglón", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    h.escucha?.alNombre(2, "Beto");
    h.escucha?.alNombre(3, "Carla");
    await vi.waitFor(() => expect(cuadro().value).toBe("Ana\nBeto\nCarla"));
    vi.useFakeTimers();
    const filaDeBeto = [...document.querySelectorAll("#sala-nombres li")].find(
      (li) => li.querySelector(".ss-nombre")?.textContent === "Beto",
    ) as HTMLElement;
    (filaDeBeto.querySelector("button") as HTMLButtonElement).click();
    expect(cuadro().value).toBe("Ana\nCarla");
    boton("sala-deshacer-b").click();
    expect(cuadro().value).toBe("Ana\nBeto\nCarla");
  });

  it("si el servicio no deja quitarlo, a los cinco segundos vuelve al cuadro y se avisa", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    h.quitarNombreEnSala.mockResolvedValueOnce(false);
    vi.useFakeTimers();
    (document.querySelector("#sala-nombres li button") as HTMLButtonElement).click();
    expect(cuadro().value).toBe("");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cuadro().value).toBe("Ana");
    expect(el("sala-error").textContent).toBe("No pudimos quitar el nombre.");
  });

  it("la cruz dice a quién quita", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    const q = document.querySelector("#sala-nombres li button") as HTMLButtonElement;
    expect(q.textContent).toBe("✕");
    expect(q.getAttribute("aria-label")).toBe("Quitar a Ana");
  });
});

describe("salir del stand con la sala", () => {
  it("salir del stand con un cierre esperando lo cierra ya", async () => {
    await cargar();
    await mostrarQr();
    vi.useFakeTimers();
    boton("sala-cerrar").click();
    expect(h.salir).not.toBeNull();
    const salio = await h.salir?.();
    expect(salio).toBe(true);
    expect(h.cerrarSala).toHaveBeenCalledTimes(1);
  });

  it("al volver a una sala con la lista guardada, los nombres que vuelven a llegar no se repiten", async () => {
    await cargar();
    sessionStorage.setItem("tinkazo.sala", JSON.stringify({ sala: SALA, dejados: [], archivados: [] }));
    cuadro().value = "Ana\nBeto";
    document.dispatchEvent(new Event("tinkazo:stand"));
    expect(h.escucha).not.toBeNull();
    h.escucha?.alNombre(1, "Ana");
    h.escucha?.alNombre(2, "Beto");
    h.escucha?.alNombre(3, "Carla");
    await vi.waitFor(() => expect(cuadro().value).toBe("Ana\nBeto\nCarla"));
  });

  it("con la escucha en vivo, una llegada nueva ya no la absorbe un renglón escrito a mano", async () => {
    await cargar();
    sessionStorage.setItem("tinkazo.sala", JSON.stringify({ sala: SALA, dejados: [], archivados: [] }));
    cuadro().value = "Ana";
    document.dispatchEvent(new Event("tinkazo:stand"));
    expect(h.escucha).not.toBeNull();

    h.escucha?.alEstado?.("en-vivo");
    h.escucha?.alNombre(1, "Ana");

    await vi.waitFor(() => expect(cuadro().value).toBe("Ana\nAna"));
    expect(el("sala-nombres").children).toHaveLength(1);
    expect(el("sala-nombres").textContent).not.toContain("repetido");
  });
});
