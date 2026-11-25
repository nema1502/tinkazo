// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ClicNoPosible, clicHasta, estadoDeLaPagina, puntoDelClic, puntoDelClicEn } from "./vistas-pagina.mjs";

/**
 * Las funciones que corren DENTRO de la página (se mandan como texto al navegador) se prueban acá contra
 * un documento de mentira: jsdom no dibuja, así que cada elemento dice dónde está y quién queda en un punto.
 */
function colocar(el, { x, y, w, h }) {
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
  el.scrollIntoView = () => undefined;
  return el;
}

/** Un botón en el centro de la pantalla y nadie encima, salvo que la prueba diga otra cosa. */
function montar(html = '<button id="btn">Seguir</button>', rect = { x: 100, y: 100, w: 200, h: 40 }) {
  document.body.innerHTML = html;
  const el = document.querySelector("#btn");
  colocar(el, rect);
  document.elementFromPoint = () => el;
  return el;
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.lang = "";
});

describe("puntoDelClic: dónde se hace el clic y por qué no se puede", () => {
  it("devuelve el centro del elemento cuando se puede tocar", () => {
    montar();
    expect(puntoDelClic("#btn")).toEqual({ x: 200, y: 120 });
  });

  it("un hijo del botón encima del punto cuenta como el botón", () => {
    const el = montar('<button id="btn"><span id="icono">+</span></button>');
    document.elementFromPoint = () => el.querySelector("#icono");
    expect(puntoDelClic("#btn")).toEqual({ x: 200, y: 120 });
  });

  it("un botón apagado no se toca y el mensaje lo dice con el selector", () => {
    montar('<button id="btn" disabled>Seguir</button>');
    expect(puntoDelClic("#btn")).toEqual({ error: "#btn está apagado (disabled)" });
  });

  it("un botón dentro de un grupo apagado tampoco", () => {
    montar('<fieldset disabled><button id="btn">Seguir</button></fieldset>');
    expect(puntoDelClic("#btn").error).toMatch(/^#btn está apagado/);
  });

  it("un elemento con aria-disabled, o dentro de uno, está apagado", () => {
    montar('<a id="btn" role="button" aria-disabled="true">Seguir</a>');
    expect(puntoDelClic("#btn").error).toMatch(/aria-disabled/);
    montar('<div aria-disabled="true"><a id="btn" role="button">Seguir</a></div>');
    expect(puntoDelClic("#btn").error).toMatch(/aria-disabled/);
  });

  it("si en el punto hay otro elemento encima, dice cuál es", () => {
    montar();
    const cortina = document.createElement("div");
    cortina.id = "cortina";
    cortina.className = "capa oscura";
    cortina.textContent = "Cargando la lista";
    document.body.append(cortina);
    document.elementFromPoint = () => cortina;
    const r = puntoDelClic("#btn");
    expect(r.error).toContain("#btn está tapado");
    expect(r.error).toContain("div#cortina.capa");
    expect(r.error).toContain("Cargando la lista");
    expect(r.error).toContain("(200, 120)");
  });

  it("si en el punto no hay nada (fuera de la pantalla), falla", () => {
    montar();
    document.elementFromPoint = () => null;
    expect(puntoDelClic("#btn").error).toMatch(/fuera de la pantalla/);
  });

  it("un elemento medio fuera de la pantalla se toca en la parte que se ve", () => {
    montar('<button id="btn">Seguir</button>', { x: 100, y: -60, w: 200, h: 100 });
    const pedidos = [];
    const el = document.querySelector("#btn");
    document.elementFromPoint = (x, y) => (pedidos.push([x, y]), el);
    expect(puntoDelClic("#btn")).toEqual({ x: 200, y: 20 });
    expect(pedidos).toEqual([[200, 20]]);
  });

  it("un selector que no está en la página falla con su nombre", () => {
    montar();
    expect(puntoDelClic("#otro").error).toBe("#otro no está en la página");
  });

  it("no depende de nada de afuera: sirve como texto dentro del navegador", () => {
    const texto = String(puntoDelClic);
    expect(texto.startsWith("function puntoDelClic(")).toBe(true);
    expect(texto).not.toMatch(/\bClicNoPosible\b|\bTOPES\b/);
  });
});

describe("puntoDelClicEn: el clic desde el guion", () => {
  const paginaCon = (respuesta) => ({
    expresiones: [],
    async eval(expr) {
      this.expresiones.push(expr);
      return JSON.stringify(respuesta);
    },
  });

  it("devuelve el punto y manda el selector como texto JSON", async () => {
    const page = paginaCon({ x: 5, y: 6 });
    expect(await puntoDelClicEn(page, '#a"b')).toEqual({ x: 5, y: 6 });
    expect(page.expresiones[0]).toContain(JSON.stringify('#a"b'));
  });

  it("si no se puede, lanza ClicNoPosible con el motivo", async () => {
    const page = paginaCon({ error: "#btn está apagado (disabled)" });
    const e = await puntoDelClicEn(page, "#btn").catch((x) => x);
    expect(e).toBeInstanceOf(ClicNoPosible);
    expect(e.message).toBe("#btn está apagado (disabled)");
  });
});

describe("clicHasta cuando el botón todavía no se puede tocar", () => {
  /** Un mundo donde el botón está apagado o tapado hasta el clic número `libreEnElClic`. */
  function mundo({ libreEnElClic = Infinity, apareceEnElClic = Infinity } = {}) {
    const m = { ahora: 0, intentos: 0, clics: 0 };
    m.deps = {
      ahora: () => m.ahora,
      async clic() {
        m.intentos++;
        if (m.intentos < libreEnElClic) throw new ClicNoPosible("#btn está apagado (disabled)");
        m.clics++;
      },
      async estaVisible(_page, _sel, ms) {
        m.ahora += ms;
        return m.clics >= apareceEnElClic;
      },
    };
    return m;
  }

  it("reintenta mientras esté apagado y sigue cuando se libera", async () => {
    const m = mundo({ libreEnElClic: 3, apareceEnElClic: 1 });
    await clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps);
    expect(m.intentos).toBe(3);
    expect(m.clics).toBe(1);
  });

  it("si nunca se libera, falla con el motivo del último intento", async () => {
    const m = mundo();
    await expect(clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps)).rejects.toThrow(/#btn está apagado.*20 s/);
    expect(m.clics).toBe(0);
  });

  it("un elemento que ni se ve sigue fallando enseguida, sin reintentar", async () => {
    const m = mundo();
    m.deps.clic = async () => {
      m.intentos++;
      throw new Error("no se vio #btn en 10 s");
    };
    await expect(clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps)).rejects.toThrow("no se vio #btn en 10 s");
    expect(m.intentos).toBe(1);
  });
});

describe("estadoDeLaPagina: lo que la página dice de sí misma", () => {
  const sinMedios = () => {
    globalThis.matchMedia = undefined;
    window.matchMedia = undefined;
  };
  const conCanvas = (contexto) => {
    HTMLCanvasElement.prototype.getContext = (tipo) => (tipo === "webgl2" ? contexto : null);
  };

  it("el tema forzado de la página y el idioma de la etiqueta html", () => {
    sinMedios();
    conCanvas(null);
    document.documentElement.dataset.theme = "dark";
    document.documentElement.lang = "en";
    const e = estadoDeLaPagina();
    expect(e.tema).toBe("dark");
    expect(e.idioma).toBe("en");
    expect(e.href).toContain("http");
  });

  it("sin tema forzado sigue al sistema, y sin sistema es claro", () => {
    conCanvas(null);
    window.matchMedia = (q) => ({ matches: q.includes("dark") });
    expect(estadoDeLaPagina().tema).toBe("dark");
    window.matchMedia = () => ({ matches: false });
    expect(estadoDeLaPagina().tema).toBe("light");
    sinMedios();
    expect(estadoDeLaPagina().tema).toBe("light");
  });

  it("un idioma con región vale por su base y uno vacío queda vacío", () => {
    sinMedios();
    conCanvas(null);
    document.documentElement.lang = "es-BO";
    expect(estadoDeLaPagina().idioma).toBe("es");
    document.documentElement.lang = "";
    expect(estadoDeLaPagina().idioma).toBe("");
  });

  it("anota si hay contexto webgl2 y qué placa dibuja", () => {
    sinMedios();
    const ext = { UNMASKED_RENDERER_WEBGL: 37446 };
    let perdido = false;
    conCanvas({
      getExtension: (n) => (n === "WEBGL_debug_renderer_info" ? ext : n === "WEBGL_lose_context" ? { loseContext: () => (perdido = true) } : null),
      getParameter: (p) => (p === 37446 ? "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" : null),
    });
    const e = estadoDeLaPagina();
    expect(e.webgl2).toBe(true);
    expect(e.renderizador).toContain("SwiftShader");
    expect(perdido).toBe(true);
  });

  it("sin webgl2 lo dice y no falla", () => {
    sinMedios();
    conCanvas(null);
    expect(estadoDeLaPagina()).toMatchObject({ webgl2: false, renderizador: null });
    HTMLCanvasElement.prototype.getContext = () => {
      throw new Error("sin gráficos");
    };
    expect(estadoDeLaPagina()).toMatchObject({ webgl2: false, renderizador: null });
  });
});
