// @vitest-environment jsdom
/** La vista en vivo por dentro: lo que acepta, lo que monta y lo que no deja hacer. Con el marcado de participar.html. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "../idioma";
import { network } from "../stellar/config";
import type { BaseDelCelular } from "./conectar";
import { TEXTOS_CAMPANA } from "./textos";
import { montarVistaPrevia, type OpcionesDeLaVista } from "./vista-previa";
import { VISTA_PREVIA, type MensajeDeVista } from "./vista-protocolo";

vi.mock("./vista-previa.css", () => ({}));

const html = readFileSync("participar.html", "utf8");
const cuerpo = /<body[^>]*>([\s\S]*)<script/u.exec(html)?.[1] ?? "";
const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const ORIGEN = "https://tinkazo.app";

const campana = (cambio: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  evento: "alcancia-andina-k3f9-2026-11-21-1000",
  red: "mainnet",
  estado: "abierta",
  empresa: { nombre: "Alcancía Andina", logo: null, color: "verde" },
  lugar: { es: "Hackathon", en: "Hackathon" },
  zona: "America/La_Paz",
  premios: ["400000000", "400000000", "400000000"],
  abre_ms: AHORA - 3_600_000,
  cierra_ms: AHORA + 3 * 3_600_000,
  sorteo_ms: AHORA + 4 * 3_600_000,
  recibir_hasta_ms: AHORA + 10 * 86_400_000,
  entrada: "google",
  pasos: [{ tipo: "instagram", url: "https://www.instagram.com/alcanciaandina", texto: { es: "", en: "" } }],
  bases: { es: "Bases de prueba", en: "Test rules" },
  anotadas: 0,
  contrato: null,
  promo: null,
  comprobante: null,
  ...cambio,
});

const mensaje = (cambio: Partial<MensajeDeVista> = {}): MensajeDeVista => ({
  t: VISTA_PREVIA,
  campana: campana(),
  pantalla: "previa",
  idioma: "es",
  muestras: { nombre: false, premio: false, lugar: false, horas: false },
  festejar: false,
  reglasAbiertas: false,
  ...cambio,
});

interface Mundo {
  enviar: (data: unknown, o?: { origin?: string; source?: unknown }) => Promise<void>;
  raiz: HTMLElement;
  idioma: () => Lang;
  lista: ReturnType<typeof vi.fn>;
  alMontar: ReturnType<typeof vi.fn>;
  soltar: () => void;
  escrituraDeIdioma: ReturnType<typeof vi.fn>;
}

/** Deja correr las promesas ya resueltas con las que arranca la demostración. */
async function asentar(): Promise<void> {
  for (let vuelta = 0; vuelta < 6; vuelta += 1) {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise((resolver) => window.setTimeout(resolver, 0));
  }
}

function montar(cambios: Partial<OpcionesDeLaVista> = {}, enApp = false): Mundo {
  document.body.className = "pg-campana";
  document.body.innerHTML = cuerpo;
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const padre = { nombre: "ventana de arriba" };
  let idioma: Lang = "es";
  let oyente: ((e: MessageEvent) => void) | null = null;
  let alIdioma: (() => void) | null = null;
  const lista = vi.fn();
  const alMontar = vi.fn();
  const escrituraDeIdioma = vi.fn();
  // Lo que hace pagina.ts con los botones de idioma: escribir la preferencia. Acá no tiene que pasar.
  document.querySelector("#l-en")?.addEventListener("click", escrituraDeIdioma);
  const base: BaseDelCelular = {
    tx: (clave) => TEXTOS_CAMPANA[idioma][clave] ?? clave,
    idioma: () => idioma,
    enApp,
    ahora: () => AHORA,
    cada: () => () => undefined,
    visible: () => true,
    alVolver: () => () => undefined,
    vibrar: () => undefined,
    movimientoReducido: () => true,
  };
  const soltar = montarVistaPrevia({
    raiz,
    base,
    escuchar: (f) => {
      oyente = f;
      return () => {
        oyente = null;
      };
    },
    origen: ORIGEN,
    padre,
    avisarLista: lista,
    cambiarIdioma: (l) => {
      idioma = l;
    },
    alCambiarIdioma: (f) => {
      alIdioma = f;
    },
    costoDelRetiro: () => null,
    red: network.name,
    alMontar,
    ...cambios,
  });
  const mundo: Mundo = {
    raiz,
    idioma: () => idioma,
    lista,
    alMontar,
    soltar,
    escrituraDeIdioma,
    enviar: async (data, o = {}) => {
      oyente?.({ origin: o.origin ?? ORIGEN, source: "source" in o ? o.source : padre, data } as MessageEvent);
      await asentar();
    },
  };
  void alIdioma;
  return mundo;
}

const titulo = (m: Mundo): string => m.raiz.querySelector("#cmp-saber h1")?.textContent ?? "";

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("la vista por dentro", () => {
  it("avisa a la página de afuera que está lista y deja la etiqueta Demo a la vista", () => {
    const m = montar();
    expect(m.lista).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>("#cmp-ejemplo")?.hidden).toBe(false);
    expect(document.body.classList.contains("cmp-vista")).toBe(true);
  });

  it("un mensaje del mismo origen y de la ventana de arriba monta la campaña", async () => {
    const m = montar();
    await m.enviar(mensaje());
    expect(titulo(m)).toBe("Sorteo de Alcancía Andina");
    expect(m.alMontar).toHaveBeenCalled();
  });

  it("un mensaje de otro origen no cambia nada", async () => {
    const m = montar();
    await m.enviar(mensaje(), { origin: "https://ajena.example.org" });
    expect(titulo(m)).toBe("");
  });

  it("un mensaje de otra ventana no cambia nada", async () => {
    const m = montar();
    await m.enviar(mensaje(), { source: { nombre: "otra" } });
    await m.enviar(mensaje(), { source: null });
    expect(titulo(m)).toBe("");
  });

  it("un mensaje con otra forma no cambia nada", async () => {
    const m = montar();
    await m.enviar({ t: "otra-cosa" });
    await m.enviar("texto suelto");
    await m.enviar({ ...mensaje(), pantalla: "inventada" });
    await m.enviar({ ...mensaje(), muestras: { nombre: true } });
    expect(titulo(m)).toBe("");
  });

  it("una campaña que el lector rechaza deja la vista anterior", async () => {
    const m = montar();
    await m.enviar(mensaje());
    await m.enviar(mensaje({ campana: campana({ premios: [] }) }));
    expect(titulo(m)).toBe("Sorteo de Alcancía Andina");
  });

  it("cambiar el nombre en un mensaje nuevo cambia el título", async () => {
    const m = montar();
    await m.enviar(mensaje());
    await m.enviar(mensaje({ campana: campana({ empresa: { nombre: "Nora Café", logo: null, color: "azul" } }) }));
    expect(titulo(m)).toBe("Sorteo de Nora Café");
  });

  it("un mensaje en inglés pinta en inglés", async () => {
    const m = montar();
    await m.enviar(mensaje({ idioma: "en" }));
    expect(m.idioma()).toBe("en");
    expect(titulo(m)).toBe("Alcancía Andina draw");
  });

  it("la pestaña Los pedidos muestra los pedidos de la campaña", async () => {
    const m = montar();
    await m.enviar(mensaje({ pantalla: "hola" }));
    expect(m.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(false);
    expect(m.raiz.querySelector("#cmp-hola")?.textContent).toContain("Seguir en Instagram");
  });

  it("la pestaña Ganó muestra la pantalla de quien ganó", async () => {
    const m = montar();
    await m.enviar(mensaje({ pantalla: "ganaste", festejar: true }));
    expect(m.raiz.querySelector<HTMLElement>("#cmp-estado")?.classList.contains("cmp-gano")).toBe(true);
    expect(m.raiz.querySelector("#cmp-estado")?.textContent).toContain("Ganaste");
  });

  it("los datos de muestra ponen sus clases en la página y salen cuando ya no hacen falta", async () => {
    const m = montar();
    await m.enviar(mensaje({ muestras: { nombre: true, premio: true, lugar: true, horas: true } }));
    for (const clase of ["cmp-muestra-nombre", "cmp-muestra-premio", "cmp-muestra-lugar", "cmp-muestra-horas"]) {
      expect(document.body.classList.contains(clase), clase).toBe(true);
    }
    await m.enviar(mensaje());
    expect(document.body.className).toBe("pg-campana cmp-vista");
  });

  it("el plegado de reglas sale abierto cuando la pestaña lo pide", async () => {
    const m = montar();
    await m.enviar(mensaje({ reglasAbiertas: true }));
    expect(m.raiz.querySelector("details.cmp-reglas")?.hasAttribute("open")).toBe(true);
    await m.enviar(mensaje({ reglasAbiertas: false }));
    expect(m.raiz.querySelector("details.cmp-reglas")?.hasAttribute("open")).toBe(false);
  });

  it("un enlace interno no navega dentro de la vista y uno que abre otra pestaña sí", async () => {
    const m = montar();
    await m.enviar(mensaje());
    const interno = document.createElement("a");
    interno.href = "/verificar.html";
    const externo = document.createElement("a");
    externo.href = "https://www.instagram.com/alcanciaandina";
    externo.target = "_blank";
    m.raiz.append(interno, externo);
    const clicInterno = new MouseEvent("click", { bubbles: true, cancelable: true });
    interno.dispatchEvent(clicInterno);
    const clicExterno = new MouseEvent("click", { bubbles: true, cancelable: true });
    externo.dispatchEvent(clicExterno);
    expect(clicInterno.defaultPrevented).toBe(true);
    expect(clicExterno.defaultPrevented).toBe(false);
  });

  it("un clic en el botón de inglés no escribe la preferencia y no borra el celular", async () => {
    const m = montar();
    await m.enviar(mensaje());
    document.querySelector<HTMLElement>("#l-en")?.click();
    expect(m.escrituraDeIdioma).not.toHaveBeenCalled();
    expect(titulo(m)).toBe("Sorteo de Alcancía Andina");
  });

  it("el costo de retirar es el del sitio y no el de la demostración", async () => {
    const m = montar({ costoDelRetiro: () => "1,25" });
    await m.enviar(mensaje({ reglasAbiertas: true }));
    expect(m.raiz.textContent).toContain("cuesta 1,25 dólares digitales");
    expect(m.raiz.textContent).not.toContain("0,50");
    const sin = montar({ costoDelRetiro: () => null });
    await sin.enviar(mensaje());
    expect(sin.raiz.textContent).not.toContain("cuesta");
  });

  describe("una campaña de personas con el premio en mano", () => {
    const personas = (): Record<string, unknown> => campana({
      identidad: "persona",
      premio_en_mano: { es: "Auriculares", en: "Headphones" },
      premios: ["0", "0", "0"],
    });
    /** Lo que nunca se ofrece en este modo: cobrar, pagar, recibir en una cuenta de Tinkazo ni pedir ni mandar un correo. */
    const PROHIBIDO = [/cuenta de Tinkazo/u, /dólares/u, /abrir tu correo/u, /por correo/u, /Recibir mi premio/u, /Tinkazo account/u, /digital dollars/u, /open your email/u, /email you/u, /Get my prize/u];
    const sinNada = (m: Mundo): void => {
      const texto = m.raiz.textContent ?? "";
      for (const palabra of PROHIBIDO) expect(texto, String(palabra)).not.toMatch(palabra);
    };

    it("la previa dice el premio escrito, ofrece el botón de Google de muestra y no habla de cuenta, dólares ni correo", async () => {
      // Aunque el sitio cobre un costo de retiro, en este modo no hay retiro que costar.
      const m = montar({ costoDelRetiro: () => "1,25" });
      await m.enviar(mensaje({ campana: personas(), reglasAbiertas: true }));
      expect(m.raiz.textContent).toContain("Auriculares");
      expect(m.raiz.querySelector("#cmp-saber .cmp-google")).not.toBeNull();
      expect(m.raiz.querySelector("#cmp-saber .cmp-google button")?.textContent).toBe("Entrar con Google");
      sinNada(m);
    });

    it("el botón de muestra lleva a Hola con un nombre de muestra, sin abrir Google", async () => {
      const m = montar();
      await m.enviar(mensaje({ campana: personas() }));
      m.raiz.querySelector<HTMLButtonElement>("#cmp-saber .cmp-google button")?.click();
      await asentar();
      expect(m.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(false);
      expect(m.raiz.querySelector("#cmp-hola h1")?.textContent).toContain("Ana P.");
      sinNada(m);
    });

    it("las pestañas Hola, Adentro y Ganó tampoco hablan de cuenta, dólares ni correo, y la última no ofrece recibir", async () => {
      for (const pantalla of ["hola", "adentro", "ganaste"] as const) {
        const m = montar({ costoDelRetiro: () => "1,25" });
        await m.enviar(mensaje({ campana: personas(), pantalla, reglasAbiertas: true }));
        sinNada(m);
        m.soltar();
        document.body.innerHTML = "";
      }
      const ganó = montar();
      await ganó.enviar(mensaje({ campana: personas(), pantalla: "ganaste" }));
      expect(ganó.raiz.querySelector("#cmp-estado")?.textContent).toContain("Ganaste");
      expect(ganó.raiz.querySelector("#cmp-estado .cmp-codigo")?.textContent).toMatch(/^\d{4}$/u);
      expect(ganó.raiz.querySelector("#cmp-estado .primary")).toBeNull();
    });

    it("en inglés tampoco", async () => {
      const m = montar({ costoDelRetiro: () => "1.25" });
      await m.enviar(mensaje({ campana: personas(), idioma: "en", reglasAbiertas: true }));
      expect(m.raiz.textContent).toContain("Headphones");
      sinNada(m);
    });

    it("una campaña de cuentas sigue con su botón Entrar y su cuenta de Tinkazo", async () => {
      const m = montar({ costoDelRetiro: () => "1,25" });
      await m.enviar(mensaje({ reglasAbiertas: true }));
      expect(m.raiz.querySelector("#cmp-saber .cmp-google")).toBeNull();
      expect(m.raiz.textContent).toContain("cuenta de Tinkazo");
      expect(m.raiz.textContent).toContain("cuesta 1,25 dólares digitales");
    });
  });

  it("dentro de un navegador de otra app la pestaña Al escanear muestra la marca y no el aviso de abrir en otro", async () => {
    const m = montar({}, true);
    await m.enviar(mensaje());
    expect(titulo(m)).toBe("Sorteo de Alcancía Andina");
    expect(m.raiz.textContent).not.toContain("abrí este enlace en Chrome o Safari");
  });

  it("al soltar la vista deja de escuchar", async () => {
    const m = montar();
    m.soltar();
    await m.enviar(mensaje());
    expect(titulo(m)).toBe("");
  });
});

describe("la hoja de la vista", () => {
  const css = readFileSync("src/campana/vista-previa.css", "utf8");

  it("la etiqueta Demo queda fija arriba a la derecha y sobre todo lo demás", () => {
    const regla = /body\.cmp-vista \.cmp-ejemplo \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(regla).toContain("position: fixed");
    expect(regla).toMatch(/top: \d+px/u);
    expect(regla).toMatch(/right: \d+px/u);
    expect(Number(/z-index: (\d+)/u.exec(regla)?.[1])).toBeGreaterThan(1000);
  });

  it("apaga las cuatro marcas de muestra y esconde los botones de idioma", () => {
    for (const clase of ["cmp-muestra-nombre", "cmp-muestra-premio", "cmp-muestra-lugar", "cmp-muestra-horas"]) {
      expect(css, clase).toContain(clase);
    }
    expect(css).toMatch(/body\.cmp-vista \.langs \{ display: none; \}/u);
  });
});
