// @vitest-environment jsdom
/**
 * El celular de quien ganó en una campaña de personas: ve su código de cuatro cifras con una línea que le dice que se lo muestre a
 * quien organiza, quien salió por repetida ve su motivo sin hablar de cuentas, y con la sala ya borrada quien recuerda que ganó
 * no puede recibir nada desde el celular: se le dice que hable con quien organiza. Nunca se dice No ganaste sin saberlo.
 * Con un Google y una sala de mentira: nada llama a ningún servicio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, texto as tx } from "../idioma";
import { textoDeErrorDeAlta } from "./adentro";
import { AHORA, asentar, prepararCelular, propio, publico } from "./celular-falso";
import type { BotonDeGoogle, DepsDelCelular, EstadoPropio } from "./celular";
import { guardarMemoria, leerMemoria, SIN_CUENTA } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

const SALA = "evento-ejemplo";
const CODIGO = "4821";

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

/** Un botón de Google que no se usa: la persona ya está anotada y se reconoce por la llave de su celular. */
const google: BotonDeGoogle = { montar: () => () => undefined };

const texto = (raiz: HTMLElement, selector: string): string | undefined => raiz.querySelector(selector)?.textContent ?? undefined;
const pantalla = (raiz: HTMLElement): string => raiz.querySelector("#cmp-estado")?.textContent ?? "";

/** El celular de una persona que ya estaba anotada. */
function memoriaDeAnotada(resultado: "gano" | "otra" | null = null): Storage {
  const memoria = almacenFalso();
  guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: resultado ? "sorteada" : "abierta", resultado, comprobante: null, guardado: AHORA });
  return memoria;
}

/** Los textos de la página en inglés: la página de prueba arma el idioma en español. */
const EN: Partial<DepsDelCelular> = { idioma: () => "en", tx: (clave) => TEXTOS_CAMPANA.en[clave as keyof typeof TEXTOS_CAMPANA.en] ?? clave };

const sorteada = (propioDe: Partial<EstadoPropio>): Partial<DepsDelCelular> => ({
  sala: SALA,
  persona: { google },
  publico: async () => ({ ...publico(), fase: "sorteada" }),
  yo: async () => ({ ...propio("sorteada"), ...propioDe }),
  resultado: async () => ({ ganadoras: ["p1:aaaaaaaaaaaaaaaaaaaaaaaaaa"], comprobante: "/verificar.html?demo=1" }),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
  setLang("es");
});

describe("el código de quien ganó", () => {
  it("Ganaste trae la línea con su código, en su propio renglón, y el texto entero queda en la frase", async () => {
    const mundo = await prepararCelular({ ...sorteada({ gano: true, codigo: CODIGO }), memoria: memoriaDeAnotada() });
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Ganaste");
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo-linea")).toBe(`Mostrale este código a quien organiza: ${CODIGO}`);
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo")).toBe(CODIGO);
  });

  it("en inglés dice lo mismo en inglés", async () => {
    const mundo = await prepararCelular({ ...sorteada({ gano: true, codigo: CODIGO }), ...EN, memoria: memoriaDeAnotada() });
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo-linea")).toBe(`Show this code to the organizer: ${CODIGO}`);
  });

  it("el texto existe en los dos idiomas con su lugar para el código, sin signos prohibidos", () => {
    for (const idioma of ["es", "en"] as const) {
      const linea = TEXTOS_CAMPANA[idioma].cpTuCodigo;
      expect(linea).toContain("{codigo}");
      expect(linea).not.toMatch(/[;«»→—–·]/u);
    }
  });

  it("Ganaste no ofrece Recibir mi premio ni la línea de tocar el botón: el código está en la misma pantalla", async () => {
    for (const en of [false, true]) {
      const mundo = await prepararCelular({ ...sorteada({ gano: true, codigo: CODIGO }), ...(en ? EN : {}), memoria: memoriaDeAnotada() });
      expect(texto(mundo.raiz, "#cmp-estado h1")).toBe(en ? "You won" : "Ganaste");
      expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo")).toBe(CODIGO);
      expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
      expect(mundo.raiz.querySelector("#cmp-estado .primary")).toBeNull();
      expect(mundo.raiz.querySelector("#cmp-estado .cmp-accion")).toBeNull();
      const dice = pantalla(mundo.raiz);
      expect(dice).not.toMatch(/Recibir mi premio|Get my prize|Tocá el botón|Tap the button/u);
    }
  });

  it("sin código en la respuesta de la sala no hay línea de código", async () => {
    const mundo = await prepararCelular({ ...sorteada({ gano: true }), memoria: memoriaDeAnotada() });
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Ganaste");
    expect(mundo.raiz.querySelector(".cmp-codigo-linea")).toBeNull();
    expect(pantalla(mundo.raiz)).not.toContain("Mostrale");
    // Sin código la pantalla dice dónde entregan el premio, y sigue sin ningún botón.
    expect(pantalla(mundo.raiz)).toContain(TEXTOS_CAMPANA.es.cpEntregaL);
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
  });

  it("un código que no son cuatro cifras no se muestra", async () => {
    const mundo = await prepararCelular({ ...sorteada({ gano: true, codigo: "12a4" }), memoria: memoriaDeAnotada() });
    expect(mundo.raiz.querySelector(".cmp-codigo-linea")).toBeNull();
  });

  it("quien ya vio su código lo conserva si una consulta siguiente no lo trae", async () => {
    let respuesta: Partial<EstadoPropio> = { gano: true, codigo: CODIGO };
    const mundo = await prepararCelular({
      ...sorteada({}),
      yo: async () => ({ ...propio("sorteada"), ...respuesta }),
      memoria: memoriaDeAnotada(),
    }, true);
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo")).toBe(CODIGO);
    respuesta = { gano: true, anotada: false };
    await vi.advanceTimersByTimeAsync(120_000);
    await asentar();
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Ganaste");
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo")).toBe(CODIGO);
  });

  it("una campaña de cuentas nunca muestra un código, aunque la respuesta lo traiga", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: `G${"A".repeat(55)}`, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({
      memoria,
      sala: SALA,
      publico: async () => ({ ...publico(), fase: "sorteada" }),
      yo: async () => ({ ...propio("sorteada"), gano: true, codigo: CODIGO }),
    });
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Ganaste");
    expect(mundo.raiz.querySelector(".cmp-codigo-linea")).toBeNull();
  });
});

describe("quien ve Ganaste antes de que llegue su código", () => {
  /** Quien recarga ya habiendo ganado ve Ganaste desde su memoria, y la sala contesta recién después. */
  async function conLaSalaCaida(): Promise<{ mundo: Awaited<ReturnType<typeof prepararCelular>>; dar: (codigo: string) => void; preguntas: () => number }> {
    let respuesta: EstadoPropio | "red" = "red";
    let preguntas = 0;
    const mundo = await prepararCelular({
      ...sorteada({}),
      yo: async () => {
        preguntas += 1;
        return respuesta;
      },
      memoria: memoriaDeAnotada("gano"),
    });
    return { mundo, dar: (codigo) => { respuesta = { ...propio("sorteada"), gano: true, codigo }; }, preguntas: () => preguntas };
  }

  it("dice dónde entregan el premio, sin ningún botón, y lo muestra en la misma pantalla cuando llega", async () => {
    const { mundo, dar } = await conLaSalaCaida();
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Ganaste");
    expect(mundo.raiz.querySelector(".cmp-codigo-linea")).toBeNull();
    expect(pantalla(mundo.raiz)).toContain(TEXTOS_CAMPANA.es.cpEntregaL);
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
    dar(CODIGO);
    await mundo.disparar(15_000);
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Ganaste");
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo")).toBe(CODIGO);
    expect(pantalla(mundo.raiz)).not.toContain(TEXTOS_CAMPANA.es.cpEntregaL);
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
  });

  it("si la sala no contestó, sigue preguntando cada pocos segundos hasta tenerlo y después deja de preguntar a ese ritmo", async () => {
    const { mundo, dar, preguntas } = await conLaSalaCaida();
    await mundo.disparar(15_000);
    expect(mundo.raiz.querySelector(".cmp-codigo-linea")).toBeNull();
    const antes = preguntas();
    await mundo.disparar(15_000);
    expect(preguntas()).toBe(antes + 1);
    dar(CODIGO);
    await mundo.disparar(15_000);
    expect(texto(mundo.raiz, "#cmp-estado .cmp-codigo")).toBe(CODIGO);
    const hasta = preguntas();
    await mundo.disparar(15_000);
    expect(preguntas()).toBe(hasta);
  });
});

describe("quien salió de la lista en una campaña de personas", () => {
  it("por repetida ve su motivo sin hablar de una cuenta", async () => {
    const mundo = await prepararCelular({
      persona: { google },
      sala: SALA,
      yo: async () => ({ ...propio("abierta"), quitada: "repetida" }),
      memoria: memoriaDeAnotada(),
    });
    expect(texto(mundo.raiz, "#cmp-estado h1")).toBe("Saliste de la lista");
    const dice = pantalla(mundo.raiz);
    expect(dice).toContain("Motivo: persona repetida.");
    expect(dice).not.toContain("cuenta");
  });

  it("en inglés dice duplicate person", async () => {
    const mundo = await prepararCelular({
      persona: { google },
      sala: SALA,
      yo: async () => ({ ...propio("abierta"), quitada: "repetida" }),
      memoria: memoriaDeAnotada(),
      ...EN,
    });
    expect(pantalla(mundo.raiz)).toContain("Reason: duplicate person.");
  });

  it("una campaña de cuentas sigue diciendo cuenta repetida", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: `G${"A".repeat(55)}`, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({ memoria, sala: SALA, yo: async () => ({ ...propio("abierta"), quitada: "repetida" }) });
    expect(pantalla(mundo.raiz)).toContain("Motivo: cuenta repetida.");
  });
});

describe("la sala ya no existe y el celular recuerda lo que pasó", () => {
  const sinSala = (memoria: Storage, cambios: Partial<DepsDelCelular> = {}): ReturnType<typeof prepararCelular> =>
    prepararCelular({ persona: { google }, sala: SALA, publico: async () => "terminada", yo: async () => "terminada", memoria, ...cambios });

  it("quien recuerda que ganó en una campaña de personas oye que hable con quien organiza y no ve Recibir mi premio", async () => {
    const mundo = await sinSala(memoriaDeAnotada("gano"));
    const dice = pantalla(mundo.raiz);
    expect(dice).toContain("Ganaste");
    expect(dice).toContain(TEXTOS_CAMPANA.es.cpTerminoGanaste);
    expect(dice).not.toContain("Recibir mi premio");
    expect(dice).not.toContain("Tocá el botón");
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado .primary")).toBeNull();
  });

  it("en inglés lo dice en inglés", async () => {
    const mundo = await sinSala(memoriaDeAnotada("gano"), EN);
    expect(pantalla(mundo.raiz)).toContain(TEXTOS_CAMPANA.en.cpTerminoGanaste);
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
  });

  it("sigue ofreciendo ver cómo se eligió cuando el celular recuerda el enlace", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "sorteada", resultado: "gano", comprobante: "/verificar.html?x=1", guardado: AHORA });
    const mundo = await sinSala(memoria);
    expect(mundo.raiz.querySelector<HTMLAnchorElement>("#cmp-estado a")?.getAttribute("href")).toBe("/verificar.html?x=1");
  });

  it("quien no recuerda nada nunca ve No ganaste ni Ganaste", async () => {
    const mundo = await sinSala(memoriaDeAnotada());
    const dice = pantalla(mundo.raiz);
    expect(dice).toContain(TEXTOS_CAMPANA.es.cpPreguntaEnStand);
    expect(dice).not.toContain("otra persona");
    expect(dice).not.toContain("Ganaste");
  });

  it("una campaña de cuentas conserva Ganaste con Recibir mi premio, como siempre", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: `G${"A".repeat(55)}`, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({ memoria, sala: SALA, publico: async () => "terminada", yo: async () => "terminada" });
    expect(texto(mundo.raiz, "#cmp-estado .primary")).toBe("Recibir mi premio");
    expect(leerMemoria(memoria, SALA, AHORA)?.resultado).toBe("gano");
  });
});

describe("el mensaje de quien ya estaba anotada y pasó su tope de la hora", () => {
  const con = (persona: boolean): DepsDelCelular =>
    ({ tx, ...(persona ? { persona: { google } } : {}) }) as unknown as DepsDelCelular;

  it("en una campaña de personas no manda a cambiar de red: dice que hubo demasiados intentos", () => {
    setLang("es");
    expect(textoDeErrorDeAlta(con(true), "wifi")).toBe(TEXTOS_CAMPANA.es.cpErrTopePersona);
    expect(TEXTOS_CAMPANA.es.cpErrTopePersona).toBe("Hubo demasiados intentos desde acá. Probá de nuevo en un rato.");
    expect(TEXTOS_CAMPANA.es.cpErrTopePersona).not.toMatch(/wifi|datos del celular/iu);
  });

  it("en inglés también", () => {
    setLang("en");
    expect(textoDeErrorDeAlta(con(true), "wifi")).toBe("Too many tries from here. Try again in a while.");
    expect(TEXTOS_CAMPANA.en.cpErrTopePersona).not.toMatch(/wifi|mobile data/iu);
  });

  it("una campaña de cuentas sigue con el texto de la wifi", () => {
    setLang("es");
    expect(textoDeErrorDeAlta(con(false), "wifi")).toBe(TEXTOS_CAMPANA.es.cpErrWifi);
  });

  it("los demás motivos de una campaña de personas no cambian", () => {
    setLang("es");
    expect(textoDeErrorDeAlta(con(true), "llena")).toBe(TEXTOS_CAMPANA.es.cpErrLlena);
    expect(textoDeErrorDeAlta(con(true), "espera")).toBe(TEXTOS_CAMPANA.es.cpErrEspera);
  });
});
