// @vitest-environment jsdom
/** Recorre las pantallas del celular con sala, sesión, reloj y visibilidad falsos. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import {
  montarCelular,
  type DepsDelCelular,
  type EstadoPropio,
  type EstadoPublico,
  type FallaDeEntrada,
  type MotivoDeAlta,
} from "./celular";
import { depsDeDemostracion } from "./demostracion";
import { campanaDeEjemplo } from "./ejemplo";
import { claveDeMemoria, guardarMemoria } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

const html = readFileSync("participar.html", "utf8");
const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const AHORA = Date.UTC(2026, 10, 21, 18);
const CUENTA = `G${"A".repeat(55)}`;
const OTRA_CUENTA = `G${"B".repeat(55)}`;
const SESION = { cuenta: CUENTA, nombre: "Ana P." };
usarTextos(TEXTOS_CAMPANA);

function almacen(): Storage {
  const valores = new Map<string, string>();
  return {
    get length() {
      return valores.size;
    },
    clear: () => valores.clear(),
    getItem: (clave) => valores.get(clave) ?? null,
    key: (indice) => [...valores.keys()][indice] ?? null,
    removeItem: (clave) => valores.delete(clave),
    setItem: (clave, valor) => void valores.set(clave, valor),
  };
}

function publico(fase: EstadoPublico["fase"] = "abierta"): EstadoPublico {
  return { fase, total: 37, cierraMs: campanaDeEjemplo(AHORA).cierraMs, pase: "vale" };
}

function propio(fase: EstadoPropio["fase"] = "abierta"): EstadoPropio {
  return { fase, total: 37, cierraMs: campanaDeEjemplo(AHORA).cierraMs, anotada: true };
}

async function asentar(): Promise<void> {
  for (let vuelta = 0; vuelta < 10; vuelta += 1) await Promise.resolve();
}

interface Mundo {
  raiz: HTMLElement;
  deps: DepsDelCelular;
  memoria: Storage;
  vibrar: ReturnType<typeof vi.fn>;
  disparar: (ms: number) => Promise<void>;
  volver: () => Promise<void>;
  ponerVisible: (valor: boolean) => void;
}

async function preparar(cambios: Partial<DepsDelCelular> = {}): Promise<Mundo> {
  document.body.innerHTML = main;
  setLang("es");
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const campana = campanaDeEjemplo(AHORA);
  const memoria = almacen();
  const callbacks = new Map<number, () => void>();
  let visible = true;
  let alVolver: () => void = () => undefined;
  const vibrar = vi.fn();
  const deps: DepsDelCelular = {
    tx: texto,
    idioma: getLang,
    campana,
    enApp: false,
    ahora: () => AHORA,
    publico: async () => publico(),
    sesion: async () => null,
    entrar: async () => SESION,
    anotar: async () => ({ ok: true, ya: false }),
    yo: async () => ({ ...propio(), anotada: false }),
    resultado: async () => ({ ganadoras: [CUENTA], comprobante: "/verificar.html?demo=1" }),
    recibir: () => undefined,
    salir: async () => undefined,
    costoDelRetiro: () => "0,50",
    enlace: () => "https://tinkazo.app/participar.html?demo=campana",
    cada: (f, ms) => {
      callbacks.set(ms, f);
      return () => {
        if (callbacks.get(ms) === f) callbacks.delete(ms);
      };
    },
    visible: () => visible,
    alVolver: (f) => {
      alVolver = f;
      return () => undefined;
    },
    vibrar,
    movimientoReducido: () => false,
    memoria,
    sala: campana.evento,
    ...cambios,
  };
  montarCelular(raiz, deps);
  await asentar();
  return {
    raiz,
    deps,
    memoria,
    vibrar,
    disparar: async (ms) => {
      callbacks.get(ms)?.();
      await asentar();
    },
    volver: async () => {
      alVolver();
      await asentar();
    },
    ponerVisible: (valor) => {
      visible = valor;
    },
  };
}

function principalesVisibles(raiz: HTMLElement): Element[] {
  return [...raiz.querySelectorAll(".primary")].filter((elemento) => elemento.closest("[hidden]") === null);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("las pantallas públicas y la entrada", () => {
  it("sin memoria ni sesión abre P1 con sus datos y una sola acción principal", async () => {
    const mundo = await preparar();
    expect(mundo.raiz.querySelector("h1")?.textContent).toBe("Sorteo de Alcancía Andina");
    expect(mundo.raiz.querySelector(".cmp-premio-texto")?.textContent).toBe("40 dólares digitales");
    expect(mundo.raiz.querySelector(".cmp-contador")?.textContent).toBe("37 personas ya se anotaron");
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
    expect(principalesVisibles(mundo.raiz)[0]?.textContent).toBe("Entrar con Google");
  });

  it("en una app P1 ofrece copiar y no muestra la entrada con Google", async () => {
    const mundo = await preparar({ enApp: true });
    expect(mundo.raiz.querySelector(".cmp-en-app")?.textContent).toContain("Para entrar con Google");
    expect(principalesVisibles(mundo.raiz)[0]?.textContent).toBe("Copiar el enlace");
    expect(mundo.raiz.textContent).not.toContain("cpEntrar");
  });

  it.each([
    ["lista", "cpAbre"],
    ["cerrada", "cpCerro"],
    ["sorteada", "cpSorteado"],
  ] as const)("la fase %s tiene su pantalla pública", async (fase, clave) => {
    const mundo = await preparar({ publico: async () => publico(fase) });
    const visible = mundo.raiz.querySelector("#cmp-estado")?.textContent ?? "";
    if (fase === "lista") {
      expect(visible).toContain("La inscripción abre el 21 de noviembre a las");
      expect(visible).not.toMatch(/\{\w+\}/u);
    } else {
      expect(visible).toContain(TEXTOS_CAMPANA.es[clave]);
    }
  });

  it("un pase vencido sin memoria no deja ningún botón", async () => {
    const mundo = await preparar({ publico: async () => ({ ...publico(), pase: "vencido" }) });
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toBe(TEXTOS_CAMPANA.es.cpPaseVencido);
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
  });

  it("Entrar queda ocupado, avisa a los seis segundos y abre Hola con el nombre", async () => {
    const mundo = await preparar();
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary");
    boton?.click();
    expect(boton?.textContent).toBe("Entrando…");
    vi.advanceTimersByTime(6000);
    expect(mundo.raiz.querySelector<HTMLElement>(".cmp-vuelve")?.hidden).toBe(false);
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Ana P.");
  });

  it.each([
    ["ventana", "cpErrVentana"],
    ["cerrada", "cpErrCerrada"],
    ["google", "cpErrGoogle"],
    ["cuentas", "cpErrCuentas"],
  ] as const)("la falla de entrada %s recupera el botón y explica el motivo", async (motivo: FallaDeEntrada, clave) => {
    const mundo = await preparar({ entrar: () => Promise.reject(new Error(motivo)) });
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary");
    boton?.click();
    await asentar();
    expect(boton?.disabled).toBe(false);
    expect(mundo.raiz.querySelector(".cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es[clave]);
  });
});

describe("anotarse y esperar", () => {
  it("Acepto pasa el nombre y abre P3 con un solo festejo chico", async () => {
    const anotar = vi.fn(async (
      _nombre: string | null,
      _alReintentar: (motivo: "mucha" | "creando") => void,
    ) => ({ ok: true as const, ya: false }));
    const mundo = await preparar({ sesion: async () => SESION, anotar });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(anotar.mock.calls[0]?.[0]).toBe("Ana P.");
    expect(mundo.raiz.querySelector("#cmp-adentro h1")?.textContent).toBe("Ya estás adentro");
    expect(mundo.vibrar).toHaveBeenCalledWith([60]);
    expect(mundo.raiz.querySelectorAll(".cmp-tilde")).toHaveLength(1);
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-izq > .cmp-marca.cmp-tilde")).not.toBeNull();
    expect(mundo.raiz.querySelector(".cmp-festejo .cmp-tilde")).toBeNull();
  });

  it("si ya estaba anotada usa el otro título y no festeja", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      anotar: async () => ({ ok: true, ya: true }),
    });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-adentro h1")?.textContent).toBe("Ya estabas en la lista");
    expect(mundo.vibrar).not.toHaveBeenCalled();
    expect(mundo.raiz.querySelector(".cmp-festejo")).toBeNull();
  });

  it("muestra los reintentos y después el error final sin salir de P2", async () => {
    let avisar: ((motivo: "mucha" | "creando") => void) | undefined;
    let resolver: ((resultado: { ok: false; motivo: MotivoDeAlta }) => void) | undefined;
    const mundo = await preparar({
      sesion: async () => SESION,
      anotar: (_nombre, alReintentar) => new Promise<{ ok: false; motivo: MotivoDeAlta }>((resolve) => {
        avisar = alReintentar;
        resolver = resolve;
      }),
    });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await Promise.resolve();
    avisar?.("mucha");
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es.cpErrMucha);
    resolver?.({ ok: false, motivo: "wifi" });
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es.cpErrWifi);
  });

  it.each([
    ["llena", "cpErrLlena"],
    ["mucha", "cpErrMucha"],
    ["creando", "cpErrCreando"],
    ["wifi", "cpErrWifi"],
    ["espera", "cpErrEspera"],
    ["cuentas", "cpErrCuentas"],
    ["proveedor", "cpErrGoogle"],
    ["cerro", "cpCerro"],
    ["pase", "cpErrPase"],
    ["sesion", "cpErrSesion"],
    ["solo-google", "cpErrSoloGoogle"],
    ["red", "cpErrRed"],
    ["otro", "cpErrOtro"],
  ] as const)("el alta con motivo %s tiene su propia línea", async (motivo: MotivoDeAlta, clave) => {
    const mundo = await preparar({
      sesion: async () => SESION,
      anotar: async () => ({ ok: false, motivo }),
    });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es[clave]);
  });

  it("P3 pone el número de personas grande y las dos horas en dos columnas", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio() });
    const adentro = mundo.raiz.querySelector("#cmp-adentro") as HTMLElement;
    expect(adentro.querySelector(".cmp-izq .cmp-numero")?.textContent).toBe("37");
    expect(adentro.querySelector(".cmp-contador")?.textContent).toBe("37 personas en la lista");
    const celdas = adentro.querySelectorAll(".cmp-horas > .cmp-celda");
    expect(celdas).toHaveLength(2);
    expect(celdas[0]?.textContent).toMatch(/^Cierra a las \d\d:\d\d$/u);
    expect(celdas[1]?.textContent).toMatch(/^Sorteo a las \d\d:\d\d$/u);
    expect(adentro.querySelectorAll(".cmp-hora")).toHaveLength(2);
  });

  it("P3 dice de quién es el sorteo y qué se sortea, arriba de la tilde", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio() });
    const hero = mundo.raiz.querySelector("#cmp-adentro .cmp-izq") as HTMLElement;
    const rotulos = hero.querySelectorAll(".cmp-rotulos > .cmp-premio-etiqueta");
    expect(rotulos).toHaveLength(2);
    expect(rotulos[0]?.textContent).toBe("Sorteo de Alcancía Andina");
    expect(rotulos[1]?.textContent).toBe("40 dólares digitales");
    expect(hero.firstElementChild?.classList.contains("cmp-rotulos")).toBe(true);
    expect(hero.querySelectorAll("h1")).toHaveLength(1);
  });

  it("Acepto suma a quien se anota y a la 1 s trae el número de la sala", async () => {
    const mundo = await preparar({ sesion: async () => SESION });
    expect(mundo.raiz.querySelector("#cmp-hola")).not.toBeNull();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-numero")?.textContent).toBe("38");
    mundo.deps.yo = async () => ({ ...propio(), total: 41 });
    vi.advanceTimersByTime(1000);
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-numero")?.textContent).toBe("41");
  });

  it("si ya estaba en la lista Acepto no suma de más", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      anotar: async () => ({ ok: true, ya: true }),
    });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-numero")?.textContent).toBe("37");
  });

  it("Hola sin pedidos deja el saludo solo, sin un título vacío", async () => {
    const campana = { ...campanaDeEjemplo(AHORA), pasos: [] };
    const mundo = await preparar({ campana, sesion: async () => SESION });
    const hola = mundo.raiz.querySelector("#cmp-hola") as HTMLElement;
    expect(hola.querySelector(".cmp-hero h1")?.textContent).toBe("Hola, Ana P.");
    expect(hola.querySelector(".cmp-der")).toBeNull();
    expect(hola.querySelector("h2")).toBeNull();
    expect(principalesVisibles(mundo.raiz)[0]?.textContent).toBe("Acepto y me anoto");
  });

  it("P3 con una sola persona dice persona en singular", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => ({ ...propio(), total: 1 }),
    });
    expect(mundo.raiz.querySelector("#cmp-adentro .cmp-contador")?.textContent).toBe("1 persona en la lista");
  });

  it("P3 es una espera sin acción principal", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio() });
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-adentro")?.hidden).toBe(false);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("P3 actualiza la única línea viva cuando cierra y cuando se sella", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio() });
    mundo.deps.yo = async () => propio("cerrada");
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-fase")?.textContent).toBe(TEXTOS_CAMPANA.es.cpYaCerro);
    mundo.deps.yo = async () => propio("sellada");
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-fase")?.textContent).toBe(TEXTOS_CAMPANA.es.cpSellada);
    expect(mundo.raiz.querySelectorAll("#cmp-adentro [aria-live]")).toHaveLength(1);
    expect(mundo.raiz.querySelector("#cmp-fase")?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("el resultado y la salida", () => {
  it("una cuenta elegida abre P4 y el festejo grande no vuelve a correr al preguntar", async () => {
    const yo = vi.fn(async () => propio("sorteada"));
    const mundo = await preparar({ sesion: async () => SESION, yo });
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    expect(principalesVisibles(mundo.raiz)[0]?.textContent).toBe("Recibir mi premio");
    expect(mundo.vibrar).toHaveBeenCalledTimes(1);
    await mundo.disparar(60_000);
    expect(yo).toHaveBeenCalledTimes(2);
    expect(mundo.vibrar).toHaveBeenCalledTimes(1);
  });

  it("otra cuenta elegida abre P5", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio("sorteada"),
      resultado: async () => ({ ganadoras: [OTRA_CUENTA], comprobante: null }),
    });
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Esta vez salió otra persona");
    expect(mundo.raiz.querySelector(".cmp-gano")).toBeNull();
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("P5 con comprobante deja Ver cómo se eligió como el botón de abajo", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio("sorteada"),
      resultado: async () => ({ ganadoras: [OTRA_CUENTA], comprobante: "/verificar.html?demo=1" }),
    });
    const boton = mundo.raiz.querySelector("#cmp-estado > .cmp-accion > .primary");
    expect(boton?.textContent).toBe("Ver cómo se eligió");
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
  });

  it("P4 deja el título y el premio en el bloque de color y el botón en la barra de abajo", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio("sorteada") });
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    expect(estado.querySelector(".cmp-izq.cmp-hero h1")?.textContent).toBe("Ganaste");
    expect(estado.querySelector(".cmp-izq .cmp-premio-resultado")?.textContent).toBe("40 dólares digitales de Alcancía Andina");
    expect(estado.querySelector(":scope > .cmp-accion > .primary")?.textContent).toBe("Recibir mi premio");
    expect(estado.querySelectorAll(".cmp-festejo")).toHaveLength(1);
    expect(estado.querySelector(":scope > .cmp-festejo")).not.toBeNull();
    expect(estado.querySelector(".cmp-izq > .cmp-marca.cmp-tilde")).not.toBeNull();
  });

  it("el aviso posterior pinta la franja y vibra", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio("sorteada") });
    mundo.deps.yo = async () => ({ ...propio("sorteada"), avisado: true });
    await mundo.disparar(60_000);
    expect(mundo.raiz.querySelector(".cmp-cartel")?.textContent).toBe("Te esperan en el stand");
    expect(mundo.vibrar).toHaveBeenCalledWith([60, 40, 60]);
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    expect(estado.firstElementChild?.querySelector(".cmp-cartel")).not.toBeNull();
    expect(estado.querySelector(".cmp-izq > a.cmp-suave")?.textContent).toBe("Ver cómo se eligió");
  });

  it("si la sala contesta terminada, quien ganó sigue viendo Ganaste y el botón para recibir", async () => {
    const recibir = vi.fn();
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio("sorteada"), recibir });
    mundo.deps.yo = async () => "terminada";
    await mundo.disparar(60_000);
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    expect(estado.querySelector("h1")?.textContent).toBe("Ganaste");
    expect(estado.textContent).not.toContain("Este sorteo ya terminó");
    expect(estado.querySelector(".cmp-izq .cmp-premio-resultado")?.textContent).toContain("40 dólares digitales");
    expect(estado.querySelector(".cmp-cartel")).toBeNull();
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
    expect(principalesVisibles(mundo.raiz)[0]?.textContent).toBe("Recibir mi premio");
    expect(mundo.vibrar).toHaveBeenCalledTimes(1);
    principalesVisibles(mundo.raiz)[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(recibir).toHaveBeenCalledOnce();
  });

  it("al volver con el recuerdo de haber ganado y la sala terminada, sigue Ganaste", async () => {
    const memoria = almacen();
    guardarMemoria(memoria, "evento-ejemplo", {
      cuenta: CUENTA,
      fase: "sorteada",
      resultado: "gano",
      comprobante: "/verificar.html?demo=1",
      guardado: AHORA,
    });
    const mundo = await preparar({ memoria, publico: async () => "terminada" });
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    expect(estado.querySelector("h1")?.textContent).toBe("Ganaste");
    expect(principalesVisibles(mundo.raiz)[0]?.textContent).toBe("Recibir mi premio");
    expect(estado.querySelector("a.cmp-suave")?.getAttribute("href")).toBe("/verificar.html?demo=1");
  });

  it("terminada sin resultado conocido dice dónde preguntar", async () => {
    const mundo = await preparar({ publico: async () => "terminada" });
    const estado = mundo.raiz.querySelector("#cmp-estado") as HTMLElement;
    expect(estado.querySelector("h1")?.textContent).toBe("Este sorteo ya terminó");
    expect(estado.querySelector(".cmp-rotulos")?.textContent).toBe("Sorteo de Alcancía Andina");
    expect(estado.textContent).toContain("Si te anotaste, preguntá en el stand cómo salió.");
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("los avisos de la inscripción dicen de quién es el sorteo y, al cerrar, cuándo es", async () => {
    const cerrada = await preparar({ publico: async () => publico("cerrada") });
    const rotulos = cerrada.raiz.querySelectorAll("#cmp-estado .cmp-rotulos > .cmp-premio-etiqueta");
    expect(rotulos[0]?.textContent).toBe("Sorteo de Alcancía Andina");
    expect(rotulos[1]?.textContent).toMatch(/^Sorteo a las \d\d:\d\d$/u);
    const lista = await preparar({ publico: async () => publico("lista") });
    expect(lista.raiz.querySelectorAll("#cmp-estado .cmp-rotulos > .cmp-premio-etiqueta")).toHaveLength(1);
  });

  it("una salida por no estar en el evento abre P6 con su motivo", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => ({ ...propio("sorteada"), quitada: "evento" }),
    });
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toContain("Quien organiza te sacó. Motivo:");
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toContain(TEXTOS_CAMPANA.es.cpMotivoEvento);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("terminada abre P7 y corta las consultas", async () => {
    const yo = vi.fn(async () => propio());
    const mundo = await preparar({ sesion: async () => SESION, yo });
    const terminada = vi.fn(async (): Promise<"terminada"> => "terminada");
    mundo.deps.yo = terminada;
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Este sorteo ya terminó");
    expect(terminada).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120_000);
    await mundo.disparar(15_000);
    await mundo.disparar(60_000);
    expect(terminada).toHaveBeenCalledOnce();
  });
});

describe("visibilidad, memoria y accesibilidad", () => {
  it("escondida no pregunta y al volver pregunta enseguida", async () => {
    const publicoFalso = vi.fn(async () => publico());
    const mundo = await preparar({ publico: publicoFalso });
    const iniciales = publicoFalso.mock.calls.length;
    mundo.ponerVisible(false);
    await mundo.disparar(15_000);
    expect(publicoFalso).toHaveBeenCalledTimes(iniciales);
    mundo.ponerVisible(true);
    await mundo.volver();
    expect(publicoFalso).toHaveBeenCalledTimes(iniciales + 1);
  });

  it("con la misma cuenta en memoria y sesión abre lo que informa la sala", async () => {
    const memoria = almacen();
    guardarMemoria(memoria, "evento-ejemplo", {
      cuenta: CUENTA,
      fase: "abierta",
      resultado: null,
      comprobante: null,
      guardado: AHORA,
    });
    const mundo = await preparar({
      memoria,
      sesion: async () => SESION,
      yo: async () => propio("sellada"),
    });
    expect(mundo.raiz.querySelector("#cmp-fase")?.textContent).toBe(TEXTOS_CAMPANA.es.cpSellada);
  });

  it("con otra sesión borra la memoria y abre P2", async () => {
    const memoria = almacen();
    guardarMemoria(memoria, "evento-ejemplo", {
      cuenta: CUENTA,
      fase: "abierta",
      resultado: null,
      comprobante: null,
      guardado: AHORA,
    });
    const mundo = await preparar({ memoria, sesion: async () => ({ cuenta: OTRA_CUENTA, nombre: "Beto" }) });
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Beto");
    expect(memoria.getItem(claveDeMemoria("evento-ejemplo"))).toBeNull();
  });

  it("No soy Ana cierra la sesión, borra la memoria y vuelve a P1", async () => {
    const salir = vi.fn(async () => undefined);
    const memoria = almacen();
    guardarMemoria(memoria, "evento-ejemplo", {
      cuenta: CUENTA,
      fase: "abierta",
      resultado: null,
      comprobante: null,
      guardado: AHORA,
    });
    const mundo = await preparar({ memoria, sesion: async () => ({ cuenta: OTRA_CUENTA, nombre: "Ana P." }), salir });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-hero .cmp-otra-cuenta")?.click();
    await asentar();
    expect(salir).toHaveBeenCalledOnce();
    expect(memoria.getItem(claveDeMemoria("evento-ejemplo"))).toBeNull();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(false);
  });

  it("las reglas incluyen el costo solo cuando existe", async () => {
    const conCosto = await preparar();
    expect(conCosto.raiz.querySelector(".cmp-reglas")?.textContent).toContain("0,50");
    const sinCosto = await preparar({ costoDelRetiro: () => null });
    expect(sinCosto.raiz.querySelector(".cmp-reglas")?.textContent).not.toContain("0,50");
  });

  it("con movimiento reducido vibra pero no crea papelitos", async () => {
    const mundo = await preparar({ sesion: async () => SESION, movimientoReducido: () => true });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar();
    expect(mundo.raiz.querySelectorAll(".cmp-papelito")).toHaveLength(0);
    expect(mundo.raiz.querySelector(".cmp-tilde")).not.toBeNull();
    expect(mundo.vibrar).toHaveBeenCalledWith([60]);
  });

  it("P1 de la demostración tiene treinta y dos palabras o menos fuera de las reglas", async () => {
    document.body.innerHTML = main;
    setLang("es");
    const campana = campanaDeEjemplo(AHORA);
    const deps = depsDeDemostracion({
      tx: texto,
      idioma: getLang,
      enApp: false,
      ahora: () => AHORA,
      cada: () => () => undefined,
      visible: () => true,
      alVolver: () => () => undefined,
      vibrar: () => undefined,
      movimientoReducido: () => false,
    }, campana, null);
    const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
    montarCelular(raiz, deps);
    await asentar();
    const copia = raiz.querySelector<HTMLElement>("#cmp-saber")?.cloneNode(true) as HTMLElement;
    copia.querySelectorAll("details").forEach((detalle) => detalle.remove());
    const palabras = (copia.textContent ?? "").trim().split(/\s+/u).filter(Boolean);
    expect(palabras.length).toBeLessThanOrEqual(32);
  });

  it("ninguna pantalla pública expone el número interno de anotación", async () => {
    const campana = { ...campanaDeEjemplo(AHORA), promo: "123456" };
    const mundo = await preparar({ campana });
    expect(mundo.raiz.textContent).not.toContain("123456");
    expect(mundo.raiz.textContent).not.toContain(campana.evento);
  });
});

describe("la entrada con Google y los repintados", () => {
  /** Una entrada que queda abierta hasta que la prueba la resuelva o la rechace. */
  function entradaAbierta(): {
    entrar: () => Promise<typeof SESION>;
    fallar: (motivo: FallaDeEntrada) => void;
  } {
    let rechazar: (error: Error) => void = () => undefined;
    return {
      entrar: () => new Promise((_resolver, no) => {
        rechazar = no;
      }),
      fallar: (motivo) => rechazar(new Error(motivo)),
    };
  }

  const botonPrincipal = (raiz: HTMLElement): HTMLButtonElement | null =>
    raiz.querySelector<HTMLButtonElement>("#cmp-saber .primary");

  it("al volver a la pestaña con Google abierto, el botón sigue en Entrando y deshabilitado", async () => {
    const abierta = entradaAbierta();
    const mundo = await preparar({ entrar: abierta.entrar });
    botonPrincipal(mundo.raiz)?.click();
    await asentar();
    await mundo.volver();
    expect(botonPrincipal(mundo.raiz)?.textContent).toBe("Entrando…");
    expect(botonPrincipal(mundo.raiz)?.disabled).toBe(true);
  });

  it("el aviso de volver a la pestaña llega a los seis segundos aunque la pantalla se haya pintado de nuevo", async () => {
    const abierta = entradaAbierta();
    const mundo = await preparar({ entrar: abierta.entrar });
    botonPrincipal(mundo.raiz)?.click();
    await asentar();
    await mundo.volver();
    expect(mundo.raiz.querySelector<HTMLElement>(".cmp-vuelve")?.hidden).toBe(true);
    vi.advanceTimersByTime(6000);
    expect(mundo.raiz.querySelector<HTMLElement>(".cmp-vuelve")?.hidden).toBe(false);
  });

  it("si la entrada falla después de volver a la pestaña, el error aparece en la pantalla nueva", async () => {
    const abierta = entradaAbierta();
    const mundo = await preparar({ entrar: abierta.entrar });
    botonPrincipal(mundo.raiz)?.click();
    await asentar();
    await mundo.volver();
    abierta.fallar("google");
    await asentar();
    const error = mundo.raiz.querySelector<HTMLElement>("#cmp-saber .cmp-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe(TEXTOS_CAMPANA.es.cpErrGoogle);
    expect(botonPrincipal(mundo.raiz)?.disabled).toBe(false);
    expect(botonPrincipal(mundo.raiz)?.textContent).toBe("Entrar con Google");
  });

  it("el error de una entrada fallida no se borra con la consulta siguiente", async () => {
    const abierta = entradaAbierta();
    const mundo = await preparar({ entrar: abierta.entrar });
    botonPrincipal(mundo.raiz)?.click();
    await asentar();
    abierta.fallar("cerrada");
    await asentar();
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es.cpErrCerrada);
  });

  it("un toque nuevo en Entrar borra el error anterior de la pantalla", async () => {
    const mundo = await preparar({ entrar: () => Promise.reject(new Error("ventana")) });
    botonPrincipal(mundo.raiz)?.click();
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-error")?.textContent).toBe(TEXTOS_CAMPANA.es.cpErrVentana);
    mundo.deps.entrar = () => new Promise(() => undefined);
    botonPrincipal(mundo.raiz)?.click();
    await asentar();
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber .cmp-error")?.hidden).toBe(true);
  });
});

describe("quien salió de la lista y vuelve sin recuerdo", () => {
  it("con la sesión abierta ve Saliste y su motivo, no el botón de anotarse", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => ({ ...propio(), anotada: false, quitada: "repetida" }),
    });
    const texto = mundo.raiz.querySelector("#cmp-estado")?.textContent ?? "";
    expect(texto).toContain(TEXTOS_CAMPANA.es.cpSaliste);
    expect(texto).toContain(TEXTOS_CAMPANA.es.cpMotivoRepetida);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
  });

  it("quien no salió y no está anotada sigue viendo el botón de anotarse", async () => {
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => ({ ...propio(), anotada: false }),
    });
    expect(mundo.raiz.querySelector("#cmp-hola h1")?.textContent).toBe("Hola, Ana P.");
  });
});
