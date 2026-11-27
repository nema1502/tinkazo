// @vitest-environment jsdom
/**
 * Una respuesta de la sala que llega tarde no pisa la pantalla nueva. Cada pedido (el estado, lo propio y el resultado) vale
 * para la pantalla desde la que salió: si mientras viajaba la persona se anotó, tocó No soy yo o la pantalla pasó a ser otra,
 * su respuesta se descarta y la consulta siguiente trae lo que corresponde. Con una sala de mentira que contesta cuando la
 * prueba lo decide: nada llama a ningún servicio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA, asentar, prepararCelular, propio, publico, SESION, type Mundo } from "./celular-falso";
import type { BotonDeGoogle, DepsDelCelular, EstadoPropio, EstadoPublico, SesionDelCelular } from "./celular";
import { guardarMemoria, SIN_CUENTA } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

const SALA = "evento-ejemplo";
const ANA: SesionDelCelular = { cuenta: SIN_CUENTA, nombre: "Ana P." };
const ES = TEXTOS_CAMPANA.es;

function almacenFalso(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (n) => [...datos.keys()][n] ?? null,
    removeItem: (clave) => {
      datos.delete(clave);
    },
    setItem: (clave, valor) => {
      datos.set(clave, valor);
    },
  };
}

/** Un botón de Google que entra cuando la prueba lo pide. */
function googleFalso(): { google: BotonDeGoogle; entrar: () => void } {
  let entrada: (sesion: SesionDelCelular) => void = () => undefined;
  return {
    google: {
      montar: (contenedor, alEntrar) => {
        const boton = document.createElement("button");
        boton.className = "google-falso";
        contenedor.append(boton);
        entrada = alEntrar;
        return () => contenedor.replaceChildren();
      },
    },
    entrar: () => entrada(ANA),
  };
}

/** Un pedido que contesta de inmediato hasta que la prueba lo frena: desde ahí, el siguiente espera a que la prueba lo suelte. */
function conFreno<T>(inmediata: () => T) {
  let frenado = false;
  let soltar: ((valor: T) => void) | null = null;
  const pedir = vi.fn((): Promise<T> => {
    if (!frenado) return Promise.resolve(inmediata());
    frenado = false;
    return new Promise<T>((resolver) => {
      soltar = resolver;
    });
  });
  return {
    pedir,
    frenar: () => {
      frenado = true;
    },
    enVuelo: () => soltar !== null,
    soltar: async (valor: T) => {
      soltar?.(valor);
      soltar = null;
      await asentar();
      await asentar();
    },
  };
}

const dice = (mundo: Mundo): string => mundo.raiz.querySelector("#cmp-estado")?.textContent ?? "";
const titulo = (mundo: Mundo, seccion: string): string | undefined => mundo.raiz.querySelector(`${seccion} h1`)?.textContent ?? undefined;
const escondida = (mundo: Mundo, seccion: string): boolean => mundo.raiz.querySelector<HTMLElement>(seccion)?.hidden !== false;
const aceptar = async (mundo: Mundo): Promise<void> => {
  mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
  await asentar();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("quien se anota mientras una consulta del estado está en vuelo", () => {
  it("en una campaña de personas, la respuesta vieja que dice que la lista cerró no pisa Ya estás adentro", async () => {
    const g = googleFalso();
    const estado = conFreno<EstadoPublico | "red" | "terminada">(() => publico());
    const mundo = await prepararCelular({ persona: { google: g.google }, sala: SALA, memoria: almacenFalso(), publico: estado.pedir });
    g.entrar();
    await asentar();
    expect(titulo(mundo, "#cmp-hola")).toBe("Hola, Ana P.");
    estado.frenar();
    await mundo.disparar(15_000);
    expect(estado.enVuelo()).toBe(true);
    await aceptar(mundo);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estás adentro");
    await estado.soltar({ ...publico(), fase: "cerrada" });
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estás adentro");
    expect(escondida(mundo, "#cmp-adentro")).toBe(false);
    expect(dice(mundo)).not.toContain(ES.cpCerro);
  });

  it("en una campaña de cuentas pasa lo mismo: quien recién se anotó sigue viendo que está adentro", async () => {
    const estado = conFreno<EstadoPublico | "red" | "terminada">(() => publico());
    const mundo = await prepararCelular({ sala: SALA, memoria: almacenFalso(), sesion: async () => SESION, publico: estado.pedir });
    expect(titulo(mundo, "#cmp-hola")).toContain("Hola");
    estado.frenar();
    await mundo.disparar(15_000);
    expect(estado.enVuelo()).toBe(true);
    await aceptar(mundo);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estás adentro");
    await estado.soltar({ ...publico(), fase: "cerrada" });
    expect(escondida(mundo, "#cmp-adentro")).toBe(false);
    expect(dice(mundo)).not.toContain(ES.cpCerro);
  });

  it("el resultado que llega tarde tampoco la manda a Este sorteo ya se hizo", async () => {
    const g = googleFalso();
    let fase: EstadoPublico["fase"] = "abierta";
    const resultado = conFreno<{ ganadoras: string[]; comprobante: string | null } | null | "red">(() => null);
    const mundo = await prepararCelular({
      persona: { google: g.google },
      sala: SALA,
      memoria: almacenFalso(),
      publico: async () => ({ ...publico(), fase }),
      resultado: resultado.pedir,
    });
    g.entrar();
    await asentar();
    fase = "sorteada";
    resultado.frenar();
    await mundo.disparar(15_000);
    expect(resultado.enVuelo()).toBe(true);
    await aceptar(mundo);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estás adentro");
    await resultado.soltar({ ganadoras: ["p1:aaaaaaaaaaaaaaaaaaaaaaaaaa"], comprobante: null });
    expect(escondida(mundo, "#cmp-adentro")).toBe(false);
    expect(dice(mundo)).not.toContain(ES.cpSorteado);
  });

  it("sin anotarse nadie, la respuesta que dice que la lista cerró se aplica como siempre", async () => {
    const g = googleFalso();
    const estado = conFreno<EstadoPublico | "red" | "terminada">(() => publico());
    const mundo = await prepararCelular({ persona: { google: g.google }, sala: SALA, memoria: almacenFalso(), publico: estado.pedir });
    g.entrar();
    await asentar();
    estado.frenar();
    await mundo.disparar(15_000);
    await estado.soltar({ ...publico(), fase: "cerrada" });
    expect(dice(mundo)).toContain(ES.cpCerro);
    expect(escondida(mundo, "#cmp-hola")).toBe(true);
  });
});

describe("quien toca No soy yo mientras una consulta propia está en vuelo", () => {
  /** El celular de una persona ya anotada, con la lista abierta. */
  async function anotada(yo: DepsDelCelular["yo"]): Promise<{ mundo: Mundo; g: ReturnType<typeof googleFalso> }> {
    const g = googleFalso();
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({ persona: { google: g.google }, sala: SALA, memoria, yo });
    return { mundo, g };
  }

  it("la respuesta de la persona anterior no vuelve a abrir Ya estás adentro: queda la previa con el botón de Google", async () => {
    const propia = conFreno<EstadoPropio | "red" | "terminada">(() => propio());
    const { mundo } = await anotada(propia.pedir);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estabas en la lista");
    propia.frenar();
    await mundo.disparar(15_000);
    expect(propia.enVuelo()).toBe(true);
    mundo.raiz.querySelector<HTMLButtonElement>(".cmp-olvidar")?.click();
    await asentar();
    expect(mundo.raiz.querySelector(".google-falso")).not.toBeNull();
    await propia.soltar(propio());
    expect(escondida(mundo, "#cmp-adentro")).toBe(true);
    expect(mundo.raiz.querySelector(".google-falso")).not.toBeNull();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber")?.hidden).toBe(false);
  });

  it("tampoco la manda a Ganaste ni le muestra el código de la persona anterior", async () => {
    const propia = conFreno<EstadoPropio | "red" | "terminada">(() => propio());
    const { mundo } = await anotada(propia.pedir);
    propia.frenar();
    await mundo.disparar(15_000);
    mundo.raiz.querySelector<HTMLButtonElement>(".cmp-olvidar")?.click();
    await asentar();
    await propia.soltar({ ...propio("sorteada"), gano: true, codigo: "4821" });
    expect(dice(mundo)).not.toContain("Ganaste");
    expect(mundo.raiz.querySelector(".cmp-codigo")).toBeNull();
    expect(mundo.raiz.querySelector(".google-falso")).not.toBeNull();
  });

  it("la consulta siguiente, ya desde la previa, se aplica como siempre", async () => {
    let total = 37;
    const propia = conFreno<EstadoPropio | "red" | "terminada">(() => propio());
    const g = googleFalso();
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({ persona: { google: g.google }, sala: SALA, memoria, yo: propia.pedir, publico: async () => ({ ...publico(), total }) });
    propia.frenar();
    await mundo.disparar(15_000);
    mundo.raiz.querySelector<HTMLButtonElement>(".cmp-olvidar")?.click();
    await asentar();
    await propia.soltar(propio());
    total = 52;
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-contador")?.textContent).toBe("52 personas ya se anotaron");
  });
});
