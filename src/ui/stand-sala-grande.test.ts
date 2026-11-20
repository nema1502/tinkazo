// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Escucha, Sala } from "../sala/cliente";

type Cambios = { quitar: string[]; sumar: string[] };

const h = vi.hoisted(() => ({
  app: { frozen: null as unknown, drawn: null as unknown },
  escucha: null as Escucha | null,
  cerrarSala: vi.fn(async () => true),
  otraRonda: vi.fn(),
  soltarResultado: vi.fn(),
  paraLaSiguiente: null as null | (() => Cambios),
}));

vi.mock("../state", () => ({ app: h.app }));
vi.mock("../ensayo-modo", () => ({ enStand: () => true }));
vi.mock("../i18n", () => {
  const textos: Record<string, string> = {
    standSalaEmpezarN: "Empezar la ronda con {n}",
    standSalaFaltanN: "Faltan {n} personas",
    standSalaFalta1: "Falta 1 persona",
    standYMas: "y {n} más",
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
  crearSala: vi.fn(async () => SALA),
  enlaceDeSala: (s: Sala) => `${s.servicio}/${s.id}#${s.clave}`,
  escucharSala: (_s: Sala, e: Escucha) => {
    h.escucha = e;
    return { parar: () => undefined };
  },
  quitarNombreEnSala: vi.fn(async () => true),
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
  alSalirDelStand: () => undefined,
  nombresParaLaSiguiente: (f: () => Cambios) => {
    h.paraLaSiguiente = f;
  },
  otraRonda: h.otraRonda,
  repintarGuia: () => undefined,
  soltarResultadoDelStand: h.soltarResultado,
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
        <button id="sala-nueva"></button><button id="sala-cerrar"></button>
        <ul id="sala-nombres"></ul><div id="sala-revisar"></div><ul id="sala-revisar-lista"></ul>
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

/** Agrega llegadas reales a la escucha de mentira y espera a que todas estén en el cuadro. */
async function llegaron(cantidad: number): Promise<void> {
  for (let n = 1; n <= cantidad; n++) h.escucha?.alNombre(n, `Nombre ${n}`);
  await vi.waitFor(() => expect(cuadro().value.split("\n").filter(Boolean)).toHaveLength(cantidad));
}

/** Pone una lista a mano y avisa, como cuando se escribe en el cuadro. */
function escribir(lista: string): void {
  cuadro().value = lista;
  cuadro().dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  h.app.frozen = null;
  h.app.drawn = null;
  h.escucha = null;
  h.paraLaSiguiente = null;
  // El DOM de prueba no lleva un elemento a la vista: los avisos lo piden al pintarse.
  Element.prototype.scrollIntoView = () => undefined;
  vi.clearAllMocks();
  h.soltarResultado.mockImplementation(() => {
    h.app.frozen = null;
    h.app.drawn = null;
    return true;
  });
});

afterEach(() => {
  quitarOyentes();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("la pantalla grande del QR", () => {
  it("Mostrar el QR arma el QR y abre la pantalla grande", async () => {
    await cargar();
    await mostrarQr();
    expect(el("sala-abierta").hidden).toBe(false);
    expect(el("stand-sala").classList.contains("grande")).toBe(true);
    expect(boton("sala-grande").textContent).toBe("standSalaGrandeCerrar");
    expect(boton("sala-grande").getAttribute("aria-expanded")).toBe("true");
  });

  it("Volver cierra la pantalla grande, y Escape también", async () => {
    await cargar();
    await mostrarQr();
    boton("sala-grande").click();
    expect(el("stand-sala").classList.contains("grande")).toBe(false);
    expect(boton("sala-grande").textContent).toBe("standSalaGrande");
    expect(boton("sala-grande").getAttribute("aria-expanded")).toBe("false");
    boton("sala-grande").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(el("stand-sala").classList.contains("grande")).toBe(false);
  });

  it("sin QR no queda la pantalla grande abierta", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alCerrada?.();
    expect(el("stand-sala").classList.contains("grande")).toBe(false);
    expect(el("sala-abierta").hidden).toBe(true);
  });

  it("Empezar la ronda dice cuántas personas faltan y queda apagado", async () => {
    await cargar();
    await mostrarQr();
    expect(boton("sala-empezar").textContent).toBe("Faltan 2 personas");
    expect(boton("sala-empezar").disabled).toBe(true);
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    expect(boton("sala-empezar").textContent).toBe("Falta 1 persona");
    expect(boton("sala-empezar").disabled).toBe(true);
  });

  it("con tres personas dice Empezar la ronda con 3 y está prendido", async () => {
    await cargar();
    await mostrarQr();
    escribir("Ana\nBeto\nCarla");
    expect(boton("sala-empezar").textContent).toBe("Empezar la ronda con 3");
    expect(boton("sala-empezar").disabled).toBe(false);
  });

  it("Empezar la ronda cierra la pantalla grande y aprieta el botón de la página", async () => {
    await cargar();
    await mostrarQr();
    escribir("Ana\nBeto");
    const clic = vi.fn();
    boton("btn-freeze").addEventListener("click", clic);
    boton("sala-empezar").click();
    expect(el("stand-sala").classList.contains("grande")).toBe(false);
    expect(clic).toHaveBeenCalledTimes(1);
  });

  it("con el resultado a la vista ofrece Otra ronda y la llama", async () => {
    await cargar();
    await mostrarQr();
    h.app.frozen = { names: ["Ana", "Beto"] };
    h.app.drawn = { winners: [0] };
    document.dispatchEvent(new Event("tinkazo:paso"));
    expect(boton("sala-empezar").textContent).toBe("standOtra");
    expect(boton("sala-empezar").disabled).toBe(false);
    boton("sala-empezar").click();
    expect(h.otraRonda).toHaveBeenCalledTimes(1);
    expect(el("stand-sala").classList.contains("grande")).toBe(false);
  });

  it("el QR del final de la ronda se ve solo con un QR abierto y abre la pantalla grande", async () => {
    await cargar();
    expect(boton("stand-qr").hidden).toBe(true);
    await mostrarQr();
    expect(boton("stand-qr").hidden).toBe(false);
    boton("sala-grande").click();
    expect(el("stand-sala").classList.contains("grande")).toBe(false);
    boton("stand-qr").click();
    expect(el("stand-sala").classList.contains("grande")).toBe(true);
  });
});

describe("empezar con gente nueva", () => {
  it("vacía la lista y las fichas sin cerrar el QR", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    h.escucha?.alNombre(2, "Beto");
    await esperarNombre("Beto");
    vi.useFakeTimers();
    boton("sala-nueva").click();
    expect(cuadro().value).toBe("");
    expect(el("sala-nombres").children).toHaveLength(0);
    expect(h.cerrarSala).not.toHaveBeenCalled();
    const guardada = JSON.parse(sessionStorage.getItem("tinkazo.sala") ?? "null") as { archivados?: number[] };
    expect(guardada.archivados).toEqual([1, 2]);
  });

  it("Deshacer antes de cinco segundos devuelve la lista y las fichas", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    h.escucha?.alNombre(2, "Beto");
    await esperarNombre("Beto");
    vi.useFakeTimers();
    boton("sala-nueva").click();
    expect(el("sala-deshacer").hidden).toBe(false);
    boton("sala-deshacer-b").click();
    expect(cuadro().value).toBe("Ana\nBeto");
    expect(el("sala-nombres").children).toHaveLength(2);
    expect(el("sala-deshacer").hidden).toBe(true);
  });

  it("Deshacer une el texto anterior con las llegadas posteriores, sin repetir nombres", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    vi.useFakeTimers();
    boton("sala-nueva").click();
    h.escucha?.alNombre(2, "Beto");
    h.escucha?.alNombre(3, "Ana");
    await Promise.resolve();
    await Promise.resolve();

    boton("sala-deshacer-b").click();

    expect(cuadro().value).toBe("Ana\nBeto");
    expect(el("sala-nombres").children).toHaveLength(3);
    const fichas = [...document.querySelectorAll("#sala-nombres .ss-nombre")].map((x) => x.textContent);
    for (const nombre of fichas) expect(cuadro().value.split("\n")).toContain(nombre);
  });

  it("Deshacer con una ronda cerrada no pisa su cuadro y guarda lo recuperado para la siguiente", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    vi.useFakeTimers();
    boton("sala-nueva").click();
    h.escucha?.alNombre(2, "Beto");
    h.escucha?.alNombre(3, "Carla");
    await Promise.resolve();
    await Promise.resolve();
    h.app.frozen = { names: ["Beto", "Carla"] };

    boton("sala-deshacer-b").click();

    expect(cuadro().value).toBe("Beto\nCarla");
    expect(el("sala-nombres").children).toHaveLength(3);
    expect(h.paraLaSiguiente?.()).toEqual({ quitar: [], sumar: ["Ana"] });
  });

  it("a los cinco segundos la línea se va y Deshacer ya no hace nada", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    vi.useFakeTimers();
    boton("sala-nueva").click();
    expect(el("sala-deshacer").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(el("sala-deshacer").hidden).toBe(true);
    boton("sala-deshacer-b").click();
    expect(cuadro().value).toBe("");
    expect(el("sala-nombres").children).toHaveLength(0);
  });

  it("con el resultado a la vista suelta la ronda y vacía la lista sin cerrar el QR", async () => {
    await cargar();
    await mostrarQr();
    escribir("Ana\nBeto");
    h.app.frozen = { names: ["Ana", "Beto"] };
    h.app.drawn = { winners: [0] };
    document.dispatchEvent(new Event("tinkazo:paso"));
    expect(boton("sala-nueva").disabled).toBe(false);
    boton("sala-nueva").click();
    expect(h.soltarResultado).toHaveBeenCalledTimes(1);
    expect(cuadro().value).toBe("");
    expect(h.cerrarSala).not.toHaveBeenCalled();
  });

  it("quien ya estaba no vuelve a entrar si su número llega de nuevo", async () => {
    await cargar();
    await mostrarQr();
    h.escucha?.alNombre(1, "Ana");
    await esperarNombre("Ana");
    h.escucha?.alNombre(2, "Beto");
    await esperarNombre("Beto");
    vi.useFakeTimers();
    boton("sala-nueva").click();
    h.escucha?.alNombre(1, "Ana");
    await Promise.resolve();
    await Promise.resolve();
    expect(cuadro().value).toBe("");
    expect(el("sala-nombres").children).toHaveLength(0);
  });

  it("está apagado sin QR, con la lista vacía y con una ronda en curso", async () => {
    await cargar();
    escribir("Ana\nBeto");
    expect(boton("sala-nueva").disabled).toBe(true);
    await mostrarQr();
    expect(boton("sala-nueva").disabled).toBe(false);
    escribir("");
    expect(boton("sala-nueva").disabled).toBe(true);
    escribir("Ana\nBeto");
    h.app.frozen = { names: ["Ana", "Beto"] };
    document.dispatchEvent(new Event("tinkazo:paso"));
    expect(boton("sala-nueva").disabled).toBe(true);
  });
});

describe("los nombres en la pantalla grande", () => {
  it("el más nuevo aparece primero", async () => {
    await cargar();
    await mostrarQr();
    await llegaron(3);
    const nombres = [...document.querySelectorAll("#sala-nombres .ss-nombre")].map((x) => x.textContent);
    expect(nombres).toEqual(["Nombre 3", "Nombre 2", "Nombre 1"]);
  });

  it("hasta seis nombres usa el tramo más grande", async () => {
    await cargar();
    await mostrarQr();
    await llegaron(6);
    expect(el("stand-sala").dataset.tramo).toBe("hasta-6");
  });

  it("de siete a doce nombres usa el segundo tramo", async () => {
    await cargar();
    await mostrarQr();
    await llegaron(7);
    expect(el("stand-sala").dataset.tramo).toBe("7-12");
  });

  it("de trece a veinticuatro nombres usa el tercer tramo", async () => {
    await cargar();
    await mostrarQr();
    await llegaron(13);
    expect(el("stand-sala").dataset.tramo).toBe("13-24");
  });

  it("con más de veinticuatro nombres usa el tramo chico", async () => {
    await cargar();
    await mostrarQr();
    await llegaron(25);
    expect(el("stand-sala").dataset.tramo).toBe("25-mas");
  });

  it("muestra solo los treinta más nuevos y una ficha con los demás", async () => {
    await cargar();
    await mostrarQr();
    await llegaron(32);
    const nombres = [...document.querySelectorAll("#sala-nombres .ss-nombre")].map((x) => x.textContent);
    expect(nombres).toHaveLength(31);
    expect(nombres[0]).toBe("Nombre 32");
    expect(nombres[29]).toBe("Nombre 3");
    expect(nombres[30]).toBe("y 2 más");
    expect(nombres).not.toContain("Nombre 1");
    expect(nombres).not.toContain("Nombre 2");
  });
});
