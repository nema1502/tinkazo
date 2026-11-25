// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  armarEscucha,
  escuchaPrendida,
  hacerSonar,
  montarEscucha,
  tramoDeFase,
  votosDe,
  votar,
  votosDelJuego,
  type Votos,
} from "./escucha";
import { TEXTOS_ESCUCHA } from "./escucha-textos";
import { CAPAS_SHOW, IDENTIDADES, MOVIMIENTO_DEL_SHOW, SEGUNDO_DEL_GOLPE, HORA_DEL_SOLO_BOMBO } from "../music";

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
  votarMas: (juego: string) => ({ ...votos, [juego]: votosDelJuego(votos, juego) + 1 }),
  votarMenos: (juego: string) => ({ ...votos, [juego]: Math.max(0, votosDelJuego(votos, juego) - 1) }),
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
      votarMas: (juego) => (votos = { ...votos, [juego]: votosDelJuego(votos, juego) + 1 }),
      votarMenos: (juego) => (votos = { ...votos, [juego]: Math.max(0, votosDelJuego(votos, juego) - 1) }),
    });
    const tarjeta = doc.querySelector('.tarjeta[data-juego="race"]')!;
    tarjeta.querySelector(".voto-mas")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(tarjeta.querySelector(".votos")?.textContent).toBe(`1 ${es.votos}`);
    tarjeta.querySelector(".voto-mas")?.dispatchEvent(new Event("click", { bubbles: true }));
    tarjeta.querySelector(".voto-menos")?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(tarjeta.querySelector(".votos")?.textContent).toBe(`1 ${es.votos}`);
    expect(votos).toEqual({ race: 1 });
  });
});

describe("la ruleta de votos, anotada a mano en el navegador", () => {
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
