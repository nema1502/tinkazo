// @vitest-environment jsdom
/**
 * El celular de quien ganó en una campaña de personas con el premio en dólares, con la página de verdad: debajo de su código ve
 * a quién pasarle la dirección donde recibe dólares digitales y un plegado para quien no tiene dónde recibirlos. Lo que hace
 * falta para decirlo se baja durante la espera, así al llegar a Ganaste ya está y la pantalla no se pinta dos veces. Con premio
 * en mano y en una campaña de cuentas no aparece nada. Con un Google y una sala de mentira: nada llama a ningún servicio.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../idioma";
import { AHORA, asentar, pasar, prepararCelular, propio, publico } from "./celular-falso";
import type { BotonDeGoogle, DepsDelCelular, EstadoPropio } from "./celular";
import { campanaDeEjemplo } from "./ejemplo";
import { guardarMemoria, SIN_CUENTA } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

const SALA = "evento-ejemplo";
const CODIGO = "0421";
const DIRECCION = "Y pasale la dirección donde recibís dólares digitales.";
const SIN_DONDE = "No tengo dónde recibirlos";

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

/** Un botón de Google que no se usa: la persona ya está anotada y se reconoce por lo que recuerda su celular. */
const google: BotonDeGoogle = { montar: () => () => undefined };

/** El celular de una persona que ya estaba anotada. */
function memoriaDeAnotada(resultado: "gano" | null = null): Storage {
  const memoria = almacenFalso();
  guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: resultado ? "sorteada" : "abierta", resultado, comprobante: null, guardado: AHORA });
  return memoria;
}

/** Los textos de la página en inglés: la página de prueba arma el idioma en español. */
const EN: Partial<DepsDelCelular> = { idioma: () => "en", tx: (clave) => TEXTOS_CAMPANA.en[clave as keyof typeof TEXTOS_CAMPANA.en] ?? clave };

/** Una campaña de personas ya sorteada: la sala le dice a este celular lo que se le pase. */
const sorteada = (propioDe: Partial<EstadoPropio>): Partial<DepsDelCelular> => ({
  sala: SALA,
  persona: { google },
  publico: async () => ({ ...publico(), fase: "sorteada" }),
  yo: async () => ({ ...propio("sorteada"), ...propioDe }),
  resultado: async () => ({ ganadoras: ["p1:aaaaaaaaaaaaaaaaaaaaaaaaaa"], comprobante: "/verificar.html?demo=1" }),
});

const bloque = (raiz: HTMLElement): HTMLElement => raiz.querySelector<HTMLElement>("#cmp-estado .cmp-hero") as HTMLElement;
const linea = (raiz: HTMLElement): HTMLElement | null => raiz.querySelector<HTMLElement>("#cmp-estado [data-cmp-dolares]");
const plegado = (raiz: HTMLElement): HTMLDetailsElement | null => raiz.querySelector("#cmp-estado details");

/** La página de quien ganó, con lo de Ganaste ya bajado. */
async function conGanaste(cambios: Partial<DepsDelCelular> = {}, propioDe: Partial<EstadoPropio> = { gano: true, codigo: CODIGO }) {
  const mundo = await prepararCelular({ ...sorteada(propioDe), memoria: memoriaDeAnotada(), ...cambios });
  await pasar(50);
  return mundo;
}

beforeAll(async () => {
  // Con el módulo ya bajado, el import() de la página se resuelve enseguida y la prueba no depende de cuánto tarde en transformarse.
  await import("./premio");
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

describe("Ganaste en una campaña de personas con el premio en dólares", () => {
  it("debajo del código dice a quién pasarle la dirección, y justo debajo va el plegado", async () => {
    const mundo = await conGanaste();
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-premio-resultado")?.textContent).toBe("40 dólares digitales de Alcancía Andina");
    const codigo = mundo.raiz.querySelector("#cmp-estado .cmp-codigo-linea");
    expect(codigo?.textContent).toBe(`Mostrale este código a quien organiza: ${CODIGO}`);
    expect(codigo?.nextElementSibling).toBe(linea(mundo.raiz));
    expect(linea(mundo.raiz)?.textContent).toBe(DIRECCION);
    expect(linea(mundo.raiz)?.className).toBe("cmp-apoyo");
    expect(linea(mundo.raiz)?.nextElementSibling).toBe(plegado(mundo.raiz));
    expect(plegado(mundo.raiz)?.open).toBe(false);
    expect(plegado(mundo.raiz)?.querySelector("summary")?.textContent).toBe(SIN_DONDE);
    expect(bloque(mundo.raiz).lastElementChild?.textContent).toBe("Ver cómo se eligió");
  });

  it("el plegado trae los tres pasos y Abrir Tinkazo, que abre la herramienta en otra pestaña y nunca la entrada de recibir un premio", async () => {
    for (const red of ["mainnet", "testnet"] as const) {
      const mundo = await conGanaste({ campana: { ...campanaDeEjemplo(AHORA), red } });
      const caja = plegado(mundo.raiz) as HTMLDetailsElement;
      expect([...caja.querySelectorAll("p")].map((p) => p.textContent), red).toEqual([
        "Entrá a Tinkazo con Google y dejá tu cuenta lista.",
        "Tocá tu cuenta, abrí Tus dólares digitales y tocá Preparar mi cuenta.",
        "En tu cuenta, tocá Copiar y pasale esa dirección a quien organiza.",
      ]);
      const abrir = caja.querySelector("a") as HTMLAnchorElement;
      expect(abrir.textContent, red).toBe("Abrir Tinkazo");
      expect(abrir.getAttribute("href"), red).toBe(red === "mainnet" ? "/?red=oficial" : "/?red=prueba");
      expect(abrir.getAttribute("href"), red).not.toContain("premio");
      expect(abrir.target, red).toBe("_blank");
      expect(abrir.rel, red).toBe("noopener noreferrer");
      document.body.innerHTML = "";
    }
  });

  it("en inglés dice lo mismo en inglés", async () => {
    const mundo = await conGanaste(EN);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("You won");
    expect(linea(mundo.raiz)?.textContent).toBe("And give them the address where you receive digital dollars.");
    const caja = plegado(mundo.raiz) as HTMLDetailsElement;
    expect(caja.querySelector("summary")?.textContent).toBe("I have nowhere to receive them");
    expect([...caja.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Sign in to Tinkazo with Google and get your account ready.",
      "Tap your account, open Your digital dollars and tap Get my account ready.",
      "In your account, tap Copy and give that address to the organizer.",
    ]);
    expect(caja.querySelector("a")?.textContent).toBe("Open Tinkazo");
  });

  it("al cambiar el idioma con Ganaste a la vista, la línea y el plegado cambian con la pantalla", async () => {
    const mundo = await conGanaste();
    expect(linea(mundo.raiz)?.textContent).toBe(DIRECCION);
    setLang("en");
    mundo.vista.pintar();
    expect(linea(mundo.raiz)?.textContent).toBe("And give them the address where you receive digital dollars.");
    expect(mundo.raiz.querySelectorAll("#cmp-estado [data-cmp-dolares]")).toHaveLength(1);
    expect(mundo.raiz.querySelectorAll("#cmp-estado details")).toHaveLength(1);
  });

  it("no hay ningún botón: ni Recibir mi premio ni otro", async () => {
    const mundo = await conGanaste();
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado .primary")).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-accion")).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).not.toMatch(/Recibir mi premio|Tocá el botón/u);
  });

  it("si el código todavía no llegó, la línea va después de la que dice dónde entregan el premio, y cuando llega sigue al código", async () => {
    let respuesta: Partial<EstadoPropio> = { gano: true };
    const mundo = await conGanaste({ yo: async () => ({ ...propio("sorteada"), ...respuesta }) });
    expect(mundo.raiz.querySelector(".cmp-codigo-linea")).toBeNull();
    const entrega = [...bloque(mundo.raiz).querySelectorAll("p.cmp-apoyo")].find((p) => p.textContent === TEXTOS_CAMPANA.es.cpEntregaL);
    expect(entrega?.nextElementSibling).toBe(linea(mundo.raiz));
    expect(linea(mundo.raiz)?.textContent).toBe(DIRECCION);
    respuesta = { gano: true, codigo: CODIGO };
    await mundo.disparar(15_000);
    await asentar();
    const codigo = mundo.raiz.querySelector("#cmp-estado .cmp-codigo-linea");
    expect(codigo?.textContent).toBe(`Mostrale este código a quien organiza: ${CODIGO}`);
    expect(codigo?.nextElementSibling).toBe(linea(mundo.raiz));
    expect(mundo.raiz.querySelectorAll("#cmp-estado [data-cmp-dolares]")).toHaveLength(1);
    expect(mundo.raiz.querySelectorAll("#cmp-estado details")).toHaveLength(1);
  });

  it("con el cartel de que la esperan en el stand también va", async () => {
    const mundo = await conGanaste({}, { gano: true, codigo: CODIGO, avisado: true });
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-cartel")?.textContent).toBe(TEXTOS_CAMPANA.es.cpTeEsperan);
    expect(linea(mundo.raiz)?.textContent).toBe(DIRECCION);
    expect(plegado(mundo.raiz)).not.toBeNull();
  });

  it("quien recarga ya habiendo ganado lo ve igual, aunque la sala tarde en contestar", async () => {
    const mundo = await prepararCelular({ ...sorteada({}), yo: async () => "red", memoria: memoriaDeAnotada("gano") });
    await pasar(50);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    expect(linea(mundo.raiz)?.textContent).toBe(DIRECCION);
    expect(plegado(mundo.raiz)?.querySelector("summary")?.textContent).toBe(SIN_DONDE);
  });
});

describe("lo de Ganaste se baja durante la espera", () => {
  it("al llegar a Ganaste la línea ya está, y la pantalla y su festejo no se pintan de nuevo", async () => {
    let respuesta: EstadoPropio = propio("sellada");
    const mundo = await prepararCelular({
      ...sorteada({}),
      publico: async () => ({ ...publico(), fase: "sellada" }),
      yo: async () => respuesta,
      memoria: memoriaDeAnotada(),
    }, true);
    await pasar(50);
    // Todavía en la espera: nadie ganó nada.
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-adentro")?.hidden).toBe(false);
    expect(linea(mundo.raiz)).toBeNull();
    respuesta = { ...propio("sorteada"), gano: true, codigo: CODIGO };
    await mundo.disparar(15_000);
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    const pintado = bloque(mundo.raiz);
    const festejo = mundo.raiz.querySelector("#cmp-estado > .cmp-festejo");
    expect(linea(mundo.raiz)?.textContent).toBe(DIRECCION);
    expect(festejo).not.toBeNull();
    await pasar(300);
    expect(pintado.isConnected).toBe(true);
    expect(festejo?.isConnected).toBe(true);
    expect(bloque(mundo.raiz)).toBe(pintado);
    expect(mundo.raiz.querySelectorAll("#cmp-estado [data-cmp-dolares]")).toHaveLength(1);
  });
});

describe("donde no corresponde no aparece nada", () => {
  it("con premio en mano Ganaste trae el código y nada de dólares ni de direcciones", async () => {
    const enMano = { ...campanaDeEjemplo(AHORA), identidad: "persona" as const, premios: [0n], premioEnMano: { es: "Auriculares", en: "Headphones" } };
    const mundo = await conGanaste({ campana: enMano });
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-codigo")?.textContent).toBe(CODIGO);
    expect(linea(mundo.raiz)).toBeNull();
    expect(plegado(mundo.raiz)).toBeNull();
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).not.toMatch(/dólares|dirección|Tinkazo/u);
  });

  it("en una campaña de cuentas Ganaste es el de siempre, con Recibir mi premio", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: `G${"A".repeat(55)}`, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({
      memoria,
      sala: SALA,
      publico: async () => ({ ...publico(), fase: "sorteada" }),
      yo: async () => ({ ...propio("sorteada"), gano: true, codigo: CODIGO }),
    });
    await pasar(50);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .primary")?.textContent).toBe(TEXTOS_CAMPANA.es.cpRecibir);
    expect(linea(mundo.raiz)).toBeNull();
    expect(plegado(mundo.raiz)).toBeNull();
  });

  it("con la sala ya borrada, quien recuerda que ganó ve con quién hablar, sin el plegado", async () => {
    const mundo = await prepararCelular({ persona: { google }, sala: SALA, publico: async () => "terminada", yo: async () => "terminada", memoria: memoriaDeAnotada("gano") });
    await pasar(50);
    expect(mundo.raiz.querySelector("#cmp-estado")?.textContent).toContain(TEXTOS_CAMPANA.es.cpTerminoGanaste);
    expect(linea(mundo.raiz)).toBeNull();
    expect(plegado(mundo.raiz)).toBeNull();
  });
});
