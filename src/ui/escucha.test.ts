// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armarEscucha,
  escuchaPrendida,
  hacerSonar,
  montarEscucha,
  tramoDeFase,
  anotarVoto,
  olvidarRespaldoDeVotos,
  votosDe,
  votar,
  votosDelJuego,
  type Votos,
} from "./escucha";
import { TEXTOS_ESCUCHA } from "./escucha-textos";
import { CAPAS_SHOW, IDENTIDADES, IDENTIDADES_DEL_SELECTOR, MOVIMIENTO_DEL_SHOW, SEGUNDO_DEL_GOLPE, HORA_DEL_SOLO_BOMBO } from "../music";

/**
 * La página de escucha sin audio: la bandera ``?escucha=1``, las tarjetas por juego con sus capas,
 * el tempo y las etiquetas de intención, y la ruleta de votos manual. El renderizado de audio de verdad
 * (OfflineAudioContext) es del navegador: en pruebas no existe y `renderizarFase` devuelve null.
 */

const es = TEXTOS_ESCUCHA.es;

/** Un documento nuevo con el contenedor de la página, como lo trae escucha.html. */
function pagina(): Document {
  const doc = document.implementation.createHTMLDocument("escucha");
  const raiz = doc.createElement("div");
  raiz.id = "escucha";
  doc.body.append(raiz);
  return doc;
}

const opciones = (prendida: boolean, reproducir: (fase: string, juego: string) => void, votos: Votos = {}) => ({
  lang: "es" as const,
  prendida,
  votos,
  reproducir,
  votarMas: (juego: string) => ({ votos: { ...votos, [juego]: votosDelJuego(votos, juego) + 1 }, guardado: true }),
  votarMenos: (juego: string) => ({ votos: { ...votos, [juego]: Math.max(0, votosDelJuego(votos, juego) - 1) }, guardado: true }),
});

describe("la bandera de la escucha", () => {
  it("solo se prende con ?escucha=1", () => {
    expect(escuchaPrendida("?escucha=1")).toBe(true);
    expect(escuchaPrendida("?escucha=0")).toBe(false);
    expect(escuchaPrendida("?otro=1")).toBe(false);
    expect(escuchaPrendida("")).toBe(false);
  });
});

describe("los tramos de cada fase del show", () => {
  it("cada capa dura lo que dice la forma del show, y se encadenan hasta el golpe", () => {
    expect(tramoDeFase("espera")).toEqual({ desde: 0, dura: MOVIMIENTO_DEL_SHOW.espera });
    expect(tramoDeFase("tension")).toEqual({ desde: MOVIMIENTO_DEL_SHOW.espera, dura: MOVIMIENTO_DEL_SHOW.tension });
    expect(tramoDeFase("remate")).toEqual({ desde: MOVIMIENTO_DEL_SHOW.espera + MOVIMIENTO_DEL_SHOW.tension, dura: MOVIMIENTO_DEL_SHOW.remate });
    expect(tramoDeFase("festejo")).toEqual({ desde: SEGUNDO_DEL_GOLPE, dura: MOVIMIENTO_DEL_SHOW.festejo });
    expect(tramoDeFase("todo").dura).toBe(SEGUNDO_DEL_GOLPE + MOVIMIENTO_DEL_SHOW.festejo);
    expect(HORA_DEL_SOLO_BOMBO).toBe(SEGUNDO_DEL_GOLPE - 3);
  });
});

describe("la página armada", () => {
  it("apagada, solo dice que está apagada y no arma tarjetas", () => {
    const doc = pagina();
    armarEscucha(doc, opciones(false, () => undefined));
    expect(doc.getElementById("escucha")?.textContent).toContain(es.apagada);
    expect(doc.querySelectorAll(".tarjeta")).toHaveLength(0);
  });

  it("prendida, una tarjeta por juego, con sus capas, el tempo y las etiquetas de intención", () => {
    const doc = pagina();
    armarEscucha(doc, opciones(true, () => undefined));
    const tarjetas = [...doc.querySelectorAll(".tarjeta")];
    expect(tarjetas).toHaveLength(Object.keys(IDENTIDADES).length);
    expect(tarjetas.map((el) => el.getAttribute("data-juego"))).toEqual(Object.keys(IDENTIDADES));
    // Los cuatro tramos del show, más el show entero.
    expect([...doc.querySelectorAll(".tocar")]).toHaveLength(Object.keys(IDENTIDADES).length * (CAPAS_SHOW.length + 1));
    expect(doc.body.textContent).toContain(es.btnTodo);
    expect(doc.body.textContent).toContain(es.capaEspera);
    expect(doc.body.textContent).toContain(es.capaTension);
    expect(doc.body.textContent).toContain(es.capaGanador);
    expect(doc.body.textContent).toContain(es.capaFestejo);
    // El tempo y las etiquetas de intención, como texto: los instrumentos van en las palabras, no en muestras.
    expect(doc.body.textContent).toContain(es.tempo);
    expect(doc.body.textContent).toContain(es.ritmos);
    expect(doc.body.textContent).toContain(es.instrumentos);
    expect(tarjetas[0]!.textContent).toContain("100 / 112 / 124");
    expect(doc.body.textContent).toContain("huayño");
    expect(doc.body.textContent).toContain("charango");
  });

  it("los diez juegos del selector van primero y los que salieron quedan aparte, con su título", () => {
    const doc = pagina();
    armarEscucha(doc, opciones(true, () => undefined));
    const grupo = doc.querySelector(".grupo");
    expect(grupo?.textContent).toBe(es.fueraDelSelector);
    const orden = [...doc.querySelectorAll("#escucha > *")].map((el) => (el.classList.contains("tarjeta") ? (el.getAttribute("data-juego") as string) : el.className));
    const donde = orden.indexOf("grupo");
    expect(orden.slice(donde - IDENTIDADES_DEL_SELECTOR.length, donde)).toEqual([...IDENTIDADES_DEL_SELECTOR]);
    expect(orden.slice(0, donde)).not.toContain("stellar");
    expect(orden.slice(donde + 1)).toContain("stellar");
  });

  it("trae un enlace para abrir un show de prueba con el adelgazado prendido, en el idioma de la página", () => {
    const docEs = pagina();
    armarEscucha(docEs, opciones(true, () => undefined));
    const a = docEs.querySelector<HTMLAnchorElement>("a.prueba-adelgazado");
    expect(a?.textContent).toBe(es.probarAdelgazado);
    expect(a?.getAttribute("href")).toBe("/?demo=race&lead=3&musicagracia=1");
    const docEn = pagina();
    armarEscucha(docEn, { ...opciones(true, () => undefined), lang: "en" });
    expect(docEn.querySelector("a.prueba-adelgazado")?.getAttribute("href")).toBe("/?demo=race&lead=3&musicagracia=1&lang=en");
    expect(docEn.documentElement.lang).toBe("en");
    expect(docEs.documentElement.lang).toBe("es");
  });

  it("el botón de cada capa pide tocar esa fase de ese juego", () => {
    const doc = pagina();
    const pedidos: [string, string][] = [];
    armarEscucha(doc, opciones(true, (fase, juego) => pedidos.push([fase, juego])));
    doc.querySelector('.tarjeta[data-juego="race"] button[data-fase="remate"]')?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(pedidos).toEqual([["remate", "race"]]);
  });

  it("la ruleta de votos muestra la cuenta que ya está anotada", () => {
    const doc = pagina();
    armarEscucha(doc, opciones(true, () => undefined, { race: 3 }));
    const tarjeta = doc.querySelector('.tarjeta[data-juego="race"]');
    expect(tarjeta?.querySelector(".votos")?.textContent).toBe(`3 ${es.votos}`);
    const sinVotos = doc.querySelector('.tarjeta[data-juego="wheel"] .votos');
    expect(sinVotos?.textContent).toBe(`0 ${es.votos}`);
  });

  it("votar más y quitar pasan por la orden y actualizan la cuenta en la vista", () => {
    const doc = pagina();
    let votos: Votos = {};
    armarEscucha(doc, {
      lang: "es",
      prendida: true,
      votos,
      reproducir: () => undefined,
      votarMas: (juego) => ({ votos: (votos = { ...votos, [juego]: votosDelJuego(votos, juego) + 1 }), guardado: true }),
      votarMenos: (juego) => ({ votos: (votos = { ...votos, [juego]: Math.max(0, votosDelJuego(votos, juego) - 1) }), guardado: true }),
    });
    const tarjeta = doc.querySelector('.tarjeta[data-juego="race"]')!;
    tarjeta.querySelector(".voto-mas")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(tarjeta.querySelector(".votos")?.textContent).toBe(`1 ${es.votos}`);
    tarjeta.querySelector(".voto-mas")?.dispatchEvent(new Event("click", { bubbles: true }));
    tarjeta.querySelector(".voto-menos")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(tarjeta.querySelector(".votos")?.textContent).toBe(`1 ${es.votos}`);
    expect(votos).toEqual({ race: 1 });
  });

  it("si el voto no se pudo guardar, la página lo dice, y deja de decirlo cuando se guarda", () => {
    const doc = pagina();
    let guardado = false;
    let votos: Votos = {};
    armarEscucha(doc, {
      lang: "es",
      prendida: true,
      votos,
      reproducir: () => undefined,
      votarMas: (juego) => ({ votos: (votos = { ...votos, [juego]: votosDelJuego(votos, juego) + 1 }), guardado }),
      votarMenos: (juego) => ({ votos: (votos = { ...votos, [juego]: Math.max(0, votosDelJuego(votos, juego) - 1) }), guardado }),
    });
    const aviso = (): Element | null => doc.querySelector(".aviso-votos");
    expect(aviso()?.textContent ?? "").toBe("");
    const tarjeta = doc.querySelector('.tarjeta[data-juego="race"]')!;
    tarjeta.querySelector(".voto-mas")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(tarjeta.querySelector(".votos")?.textContent).toBe(`1 ${es.votos}`);
    expect(aviso()?.textContent).toBe(es.votosSinGuardar);
    guardado = true;
    tarjeta.querySelector(".voto-mas")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(aviso()?.textContent ?? "").toBe("");
  });
});

describe("la ruleta de votos, anotada a mano en el navegador", () => {
  afterEach(olvidarRespaldoDeVotos);

  /** Un localStorage de mentira: suficiente para los votos de la escucha, sin el index signature de Storage. */
  const almacenFalso = (): Storage => {
    const datos: Record<string, string> = {};
    return {
      get length(): number {
        return Object.keys(datos).length;
      },
      key: (): string | null => null,
      getItem: (k: string): string | null => datos[k] ?? null,
      setItem: (k: string, v: string): void => {
        datos[k] = v;
      },
      removeItem: (k: string): void => {
        delete datos[k];
      },
      clear: (): void => {
        for (const k of Object.keys(datos)) delete datos[k];
      },
    } as unknown as Storage;
  };

  it("empezar en cero, sumar, restar, y no bajar de cero", () => {
    const a = almacenFalso();
    expect(votosDe(a)).toEqual({});
    expect(votar("race", 1, a)).toEqual({ race: 1 });
    expect(votar("race", 1, a)).toEqual({ race: 2 });
    expect(votar("race", -1, a)).toEqual({ race: 1 });
    expect(votar("race", -1, a)).toEqual({});
    expect(votar("race", -1, a)).toEqual({});
  });

  it("los votos viven en el almacén y sobreviven una nueva lectura", () => {
    const a = almacenFalso();
    votar("wheel", 1, a);
    votar("wheel", 1, a);
    expect(votosDe(a)).toEqual({ wheel: 2 });
  });

  it("un almacén roto o un dato corrupto no rompe la escucha", () => {
    const a = almacenFalso();
    a.setItem("tinkazo.escucha.votos", "{no es json");
    expect(votosDe(a)).toEqual({});
    expect(votosDe(null)).toEqual({});
    expect(votar("race", 1, null)).toEqual({ race: 1 });
  });

  it("un voto que no se pudo guardar se cuenta igual en la sesión: el siguiente suma sobre él", () => {
    olvidarRespaldoDeVotos();
    const a = almacenFalso();
    a.setItem = (): void => {
      throw new Error("sin lugar");
    };
    const uno = anotarVoto("race", 1, a);
    expect(uno).toEqual({ votos: { race: 1 }, guardado: false });
    const dos = anotarVoto("race", 1, a);
    expect(dos).toEqual({ votos: { race: 2 }, guardado: false });
    expect(anotarVoto("race", -1, a).votos).toEqual({ race: 1 });
  });

  it("sin almacén tampoco se pierde la cuenta, y se avisa que no quedó guardada", () => {
    olvidarRespaldoDeVotos();
    expect(anotarVoto("wheel", 1, null)).toEqual({ votos: { wheel: 1 }, guardado: false });
    expect(anotarVoto("wheel", 1, null)).toEqual({ votos: { wheel: 2 }, guardado: false });
    olvidarRespaldoDeVotos();
  });

  it("cuando el almacén vuelve a andar, el voto de la sesión se guarda y el aviso se va", () => {
    olvidarRespaldoDeVotos();
    const a = almacenFalso();
    const bueno = a.setItem.bind(a);
    a.setItem = (): void => {
      throw new Error("sin lugar");
    };
    anotarVoto("race", 1, a);
    a.setItem = bueno;
    const despues = anotarVoto("race", 1, a);
    expect(despues).toEqual({ votos: { race: 2 }, guardado: true });
    expect(votosDe(a)).toEqual({ race: 2 });
  });

  it("un voto guardado con éxito da guardado verdadero", () => {
    olvidarRespaldoDeVotos();
    expect(anotarVoto("race", 1, almacenFalso())).toEqual({ votos: { race: 1 }, guardado: true });
  });

  it("lo guardado que no es una cuenta de votos se ignora: arreglos, infinitos, decimales y negativos", () => {
    const a = almacenFalso();
    a.setItem("tinkazo.escucha.votos", "[3,4]");
    expect(votosDe(a)).toEqual({});
    a.setItem("tinkazo.escucha.votos", '{"race":1e999,"wheel":2.5,"sapo":-1,"trompo":"3","pinata":4,"oruro":null}');
    expect(votosDe(a)).toEqual({ pinata: 4 });
    expect(anotarVoto("race", 1, a).votos).toEqual({ pinata: 4, race: 1 });
  });

  it("votosDelJuego devuelve cero para el juego sin votos", () => {
    expect(votosDelJuego({ race: 2 }, "race")).toBe(2);
    expect(votosDelJuego({}, "race")).toBe(0);
  });
});

describe("montarEscucha", () => {
  it("con la bandera de verdad, arma la página completa en el documento", () => {
    window.history.replaceState(null, "", "?escucha=1");
    const doc = pagina();
    montarEscucha(doc);
    expect(doc.querySelectorAll(".tarjeta")).toHaveLength(Object.keys(IDENTIDADES).length);
  });

  it("sin la bandera, arma solo la nota de apagada", () => {
    window.history.replaceState(null, "", "/");
    const doc = pagina();
    montarEscucha(doc);
    expect(doc.querySelectorAll(".tarjeta")).toHaveLength(0);
    expect(doc.getElementById("escucha")?.textContent).toContain(es.apagada);
  });
});

describe("el audio de la página", () => {
  it("sin OfflineAudioContext (como en las pruebas) el render devuelve null y hacerSonar no suena", async () => {
    const { renderizarFase } = await import("./escucha");
    const buffer = await renderizarFase("espera", IDENTIDADES.race!);
    expect(buffer).toBeNull();
    expect(hacerSonar({} as AudioBuffer)).toBe(false);
  });
});

describe("el contexto de audio nace en el toque, no después del render", () => {
  /** Un contexto que nace suspendido, como en iPhone y Safari cuando el gesto del toque ya pasó. */
  class ContextoSuspendido {
    static creados = 0;
    state = "suspended";
    resume = vi.fn(() => {
      this.state = "running";
      return Promise.resolve();
    });
    destination = {};
    constructor() {
      ContextoSuspendido.creados += 1;
    }
  }

  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;
    ContextoSuspendido.creados = 0;
  });

  it("al tocar una capa, el contexto se crea y se reanuda en el mismo toque, antes de que termine el render", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = ContextoSuspendido;
    const { prepararContextoDeEscucha } = await import("./escucha");
    window.history.replaceState(null, "", "?escucha=1");
    const doc = pagina();
    montarEscucha(doc);
    doc.querySelector('.tarjeta[data-juego="race"] button[data-fase="espera"]')?.dispatchEvent(new Event("click", { bubbles: true }));
    // Sin esperar nada: el render es asíncrono y el gesto del toque ya habría pasado.
    expect(ContextoSuspendido.creados).toBe(1);
    const ctx = prepararContextoDeEscucha() as unknown as ContextoSuspendido;
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe("running");
    // Un segundo toque reutiliza el mismo contexto.
    expect(ContextoSuspendido.creados).toBe(1);
  });

  it("sin AudioContext en el navegador no hay contexto y no se rompe nada", async () => {
    const { prepararContextoDeEscucha } = await import("./escucha");
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    expect(prepararContextoDeEscucha()).toBeNull();
  });
});

describe("el último toque manda, no el último render en terminar", () => {
  const id = IDENTIDADES.race!;
  /** Un render que termina cuando la prueba lo suelta. */
  function renderPendiente(): { promesa: Promise<AudioBuffer | null>; soltar: (b: AudioBuffer | null) => void } {
    let soltar: (b: AudioBuffer | null) => void = () => undefined;
    const promesa = new Promise<AudioBuffer | null>((r) => {
      soltar = r;
    });
    return { promesa, soltar };
  }

  it("una pieza larga que termina después de otra pedida más tarde no suena", async () => {
    const { pedirPieza } = await import("./escucha");
    const larga = renderPendiente();
    const corta = renderPendiente();
    const suenan: unknown[] = [];
    const sonar = (b: AudioBuffer): boolean => suenan.push(b) > 0;
    const primero = pedirPieza("todo", id, undefined, { render: () => larga.promesa, sonar });
    const segundo = pedirPieza("espera", id, undefined, { render: () => corta.promesa, sonar });
    const bufferCorto = { nombre: "corta" } as unknown as AudioBuffer;
    const bufferLargo = { nombre: "larga" } as unknown as AudioBuffer;
    corta.soltar(bufferCorto);
    await segundo;
    larga.soltar(bufferLargo);
    await primero;
    expect(suenan).toEqual([bufferCorto]);
  });

  it("avisa que está armando la pieza y cuando terminó", async () => {
    const { pedirPieza } = await import("./escucha");
    const r = renderPendiente();
    const estados: string[] = [];
    const pedido = pedirPieza("espera", id, (e) => estados.push(e), { render: () => r.promesa, sonar: () => true });
    expect(estados).toEqual(["preparando"]);
    r.soltar({} as AudioBuffer);
    await pedido;
    expect(estados).toEqual(["preparando", "listo"]);
  });

  it("parar cancela lo que todavía se está armando", async () => {
    const { pedirPieza, pararPieza } = await import("./escucha");
    const r = renderPendiente();
    const suenan: unknown[] = [];
    const pedido = pedirPieza("todo", id, undefined, { render: () => r.promesa, sonar: (b) => suenan.push(b) > 0 });
    pararPieza();
    r.soltar({} as AudioBuffer);
    await pedido;
    expect(suenan).toEqual([]);
  });
});

describe("la pieza que suena se suelta y se corta", () => {
  class Fuente {
    static todas: Fuente[] = [];
    buffer: unknown = null;
    onended: (() => void) | null = null;
    connect = vi.fn();
    disconnect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    constructor() {
      Fuente.todas.push(this);
    }
  }
  class Contexto {
    state = "running";
    resume = vi.fn(() => Promise.resolve());
    destination = {};
    createBufferSource = (): Fuente => new Fuente();
  }

  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    Fuente.todas = [];
  });

  it("al terminar sola, la pieza suelta su nodo", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = Contexto;
    vi.resetModules();
    const { hacerSonar } = await import("./escucha");
    expect(hacerSonar({} as AudioBuffer)).toBe(true);
    const f = Fuente.todas[0]!;
    f.onended?.();
    expect(f.disconnect).toHaveBeenCalled();
  });

  it("al pasar a otra pieza, la anterior se corta y se suelta", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = Contexto;
    vi.resetModules();
    const { hacerSonar, pararSonido } = await import("./escucha");
    hacerSonar({} as AudioBuffer);
    hacerSonar({} as AudioBuffer);
    const [primera, segunda] = Fuente.todas;
    expect(primera!.stop).toHaveBeenCalled();
    expect(primera!.disconnect).toHaveBeenCalled();
    expect(segunda!.stop).not.toHaveBeenCalled();
    pararSonido();
    expect(segunda!.stop).toHaveBeenCalled();
    expect(segunda!.disconnect).toHaveBeenCalled();
  });
});

describe("el encabezado de la página", () => {
  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;
  });

  it("sin audio en el navegador, avisa", () => {
    const doc = pagina();
    armarEscucha(doc, opciones(true, () => undefined));
    expect(doc.querySelector(".aviso-sin-audio")?.textContent).toBe(es.sinAudio);
  });

  it("con audio en el navegador, no avisa nada", () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = function () {};
    (window as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = function () {};
    const doc = pagina();
    armarEscucha(doc, opciones(true, () => undefined));
    expect(doc.querySelector(".aviso-sin-audio")).toBeNull();
  });

  it("trae un enlace para pasar al otro idioma y un lugar para decir que se está armando la pieza", () => {
    const docEs = pagina();
    armarEscucha(docEs, opciones(true, () => undefined));
    expect(docEs.querySelector("a.idioma")?.getAttribute("href")).toBe("?escucha=1&lang=en");
    expect(docEs.querySelector("a.idioma")?.textContent).toBe(TEXTOS_ESCUCHA.es.otroIdioma);
    const docEn = pagina();
    armarEscucha(docEn, { ...opciones(true, () => undefined), lang: "en" });
    expect(docEn.querySelector("a.idioma")?.getAttribute("href")).toBe("?escucha=1&lang=es");
    expect(docEs.querySelector("#estado-escucha")?.getAttribute("role")).toBe("status");
  });

  it("el botón de parar avisa a la orden", () => {
    const doc = pagina();
    const parar = vi.fn();
    armarEscucha(doc, { ...opciones(true, () => undefined), parar });
    doc.querySelector(".parar")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(parar).toHaveBeenCalledTimes(1);
  });

  it("los ritmos y los instrumentos salen en el idioma de la página", () => {
    const docEn = pagina();
    armarEscucha(docEn, { ...opciones(true, () => undefined), lang: "en" });
    const carrera = docEn.querySelector('.tarjeta[data-juego="race"] .etiquetas')?.textContent ?? "";
    expect(carrera).toContain("panpipes");
    expect(carrera).toContain("bass drum");
    expect(carrera).not.toContain("zampoña");
    const docEs = pagina();
    armarEscucha(docEs, opciones(true, () => undefined));
    expect(docEs.querySelector('.tarjeta[data-juego="race"] .etiquetas')?.textContent).toContain("zampoña");
  });
});

describe("la página al volver a la vista", () => {
  class Fuente {
    onended: (() => void) | null = null;
    connect = vi.fn();
    disconnect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  }
  class Contexto {
    static ultimo: Contexto | null = null;
    state = "running";
    resume = vi.fn(() => Promise.resolve());
    destination = {};
    createBufferSource = (): Fuente => new Fuente();
    constructor() {
      Contexto.ultimo = this;
    }
  }

  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    window.history.replaceState(null, "", "/");
  });

  it("el contexto que el teléfono cortó se reanuda al volver a la vista", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = Contexto;
    vi.resetModules();
    const { hacerSonar, montarEscucha: montar } = await import("./escucha");
    window.history.replaceState(null, "", "?escucha=1");
    montar(pagina());
    expect(hacerSonar({} as AudioBuffer)).toBe(true);
    const ctx = Contexto.ultimo!;
    ctx.state = "interrupted";
    ctx.resume.mockClear();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });
});
