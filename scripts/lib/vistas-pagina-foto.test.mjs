import { describe, expect, it } from "vitest";
import { DESPLAZAR, IMAGENES, cortarFueraDelOrigen, desplazar, guionContraVentanasNuevas, prepararFoto } from "./vistas-pagina.mjs";

describe("desplazar: solo cuenta si el elemento se dibuja", () => {
  it("espera a que el elemento se vea y recién después desplaza", async () => {
    const orden = [];
    const page = { eval: async (expr) => orden.push(["eval", expr]) };
    await desplazar(page, "#winner-box", async (_p, sel, ms) => orden.push(["espera", sel, ms]));
    expect(orden[0]).toEqual(["espera", "#winner-box", DESPLAZAR.esperaMs]);
    expect(orden[1][0]).toBe("eval");
    expect(orden[1][1]).toContain("scrollIntoView");
    expect(orden[1][1]).toContain('"#winner-box"');
    expect(DESPLAZAR.esperaMs).toBe(10_000);
  });

  it("si el elemento está en la página pero no se dibuja, falla y no desplaza nada", async () => {
    const evals = [];
    const page = { eval: async (expr) => evals.push(expr) };
    const nadaSeVe = async (_p, sel) => {
      throw new Error(`no se vio ${sel} en 10 s`);
    };
    await expect(desplazar(page, "#winner-box", nadaSeVe)).rejects.toThrow("no se vio #winner-box");
    expect(evals).toEqual([]);
  });
});

/** Una página de mentira para correr el guion de las imágenes tal como lo corre Chrome. */
function paginaConImagenes({ alto = 3000, ventana = 900, imagenes }) {
  // Una imagen diferida se pide al acercarse y, una vez cargada, sigue cargada aunque la página vuelva arriba.
  const cargadas = new Set();
  const acercar = () => imagenes.forEach((im, k) => !im.nunca && win.scrollY + ventana >= im.arriba && cargadas.add(k));
  const win = {
    innerHeight: ventana,
    innerWidth: 1280,
    scrollY: 0,
    scrollBy: ({ top }) => {
      win.scrollY = Math.min(win.scrollY + top, alto - ventana);
      win.llamadasDeScroll++;
      acercar();
    },
    scrollTo: ({ top }) => {
      win.scrollY = top;
      acercar();
    },
    llamadasDeScroll: 0,
  };
  const lista = imagenes.map(({ arriba, oculta = false }, k) => ({
    get complete() {
      return cargadas.has(k);
    },
    getClientRects: () => (oculta ? [] : [{}]),
    getBoundingClientRect: () => ({ top: arriba - win.scrollY, bottom: arriba + 100 - win.scrollY, left: 0, right: 100 }),
  }));
  acercar();
  const doc = {
    images: lista,
    documentElement: {
      get scrollHeight() {
        return alto;
      },
    },
    fonts: { ready: Promise.resolve() },
  };
  const page = {
    async eval(expr) {
      return new Function("window", "document", `return ${expr}`)(win, doc);
    },
  };
  return { win, page };
}

describe("prepararFoto: las imágenes y las letras llegan antes de la foto", () => {
  const rapido = { pasoMs: 1, esperaMs: 80 };
  const imagenes = [{ arriba: 100 }, { arriba: 1500 }, { arriba: 2800 }];

  it("con la página entera baja de a una pantalla, espera las imágenes diferidas y vuelve arriba", async () => {
    const { win, page } = paginaConImagenes({ imagenes });
    const r = await prepararFoto(page, true, rapido);
    expect(r).toEqual({ imagenes: 3, sinCompletar: 0 });
    expect(win.llamadasDeScroll).toBeGreaterThanOrEqual(3);
    expect(win.scrollY).toBe(0);
  });

  it("con una sola pantalla no se mueve y mira solo lo que se ve", async () => {
    const { win, page } = paginaConImagenes({ imagenes });
    const r = await prepararFoto(page, false, rapido);
    expect(r).toEqual({ imagenes: 1, sinCompletar: 0 });
    expect(win.llamadasDeScroll).toBe(0);
  });

  it("una imagen que nunca llega se cuenta como sin completar y no cuelga la foto", async () => {
    const { page } = paginaConImagenes({ imagenes: [{ arriba: 100 }, { arriba: 200, nunca: true }] });
    const t0 = Date.now();
    const r = await prepararFoto(page, true, rapido);
    expect(r).toEqual({ imagenes: 2, sinCompletar: 1 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("una imagen que no se dibuja (escondida) no se espera ni se cuenta", async () => {
    const { page } = paginaConImagenes({ imagenes: [{ arriba: 100 }, { arriba: 200, nunca: true, oculta: true }] });
    const r = await prepararFoto(page, true, rapido);
    expect(r).toEqual({ imagenes: 1, sinCompletar: 0 });
  });

  it("los topes son los de siempre", () => {
    expect(IMAGENES.esperaMs).toBe(10_000);
    expect(IMAGENES.pantallasMax).toBe(90);
  });
});

describe("las ventanas nuevas no visitan otro sitio", () => {
  const ORIGEN = "http://localhost:4173";

  /** Corre el guion que se inyecta en cada documento, con una ventana de mentira. */
  function ventana({ base = null } = {}) {
    const avisos = [];
    const oyentes = {};
    const abiertas = [];
    const win = {
      addEventListener: (tipo, f, captura) => {
        oyentes[tipo] = { f, captura };
      },
      open: (...a) => {
        abiertas.push(a);
        return { abierta: true };
      },
      tinkazoFuera: (x) => avisos.push(x),
    };
    const doc = { baseURI: `${ORIGEN}/pagina/`, querySelector: (sel) => (sel === "base[target]" ? base : null) };
    new Function("window", "document", `return ${guionContraVentanasNuevas(ORIGEN)}`)(win, doc);
    const clic = (enlace) => {
      const ev = {
        target: { closest: () => enlace },
        frenado: false,
        preventDefault() {
          ev.frenado = true;
        },
        stopImmediatePropagation() {},
      };
      oyentes.click.f(ev);
      return ev;
    };
    const envio = (formulario, remitente = null) => {
      const ev = {
        target: formulario,
        submitter: remitente,
        frenado: false,
        preventDefault() {
          ev.frenado = true;
        },
      };
      oyentes.submit.f(ev);
      return ev;
    };
    return { win, avisos, abiertas, oyentes, clic, envio };
  }
  const enlace = (href, target = "") => ({ href, target });

  it("escucha en la fase de captura, antes que el código del sitio", () => {
    const v = ventana();
    expect(v.oyentes.click.captura).toBe(true);
    expect(v.oyentes.submit.captura).toBe(true);
  });

  it("un enlace externo que abre pestaña nueva se frena y se avisa sin la consulta", () => {
    const v = ventana();
    const ev = v.clic(enlace("https://example.org/ruta?clave=secreto#x", "_blank"));
    expect(ev.frenado).toBe(true);
    expect(v.avisos).toEqual(["https://example.org/ruta"]);
  });

  it("un enlace del propio sitio con pestaña nueva no se toca", () => {
    const v = ventana();
    expect(v.clic(enlace(`${ORIGEN}/juegos.html`, "_blank")).frenado).toBe(false);
    expect(v.clic(enlace("/seguridad.html", "_blank")).frenado).toBe(false);
    expect(v.avisos).toEqual([]);
  });

  it("un enlace externo que navega la misma pestaña lo corta la otra defensa, no esta", () => {
    const v = ventana();
    expect(v.clic(enlace("https://example.org/", "")).frenado).toBe(false);
    expect(v.clic(enlace("https://example.org/", "_self")).frenado).toBe(false);
    expect(v.avisos).toEqual([]);
  });

  it("el destino de la etiqueta base cuenta cuando el enlace no dice el suyo", () => {
    const v = ventana({ base: { target: "_blank" } });
    expect(v.clic(enlace("https://example.org/a")).frenado).toBe(true);
  });

  it("un destino con nombre abre una ventana, y también se frena", () => {
    const v = ventana();
    expect(v.clic(enlace("https://example.org/a", "otra")).frenado).toBe(true);
  });

  it("un enlace de SVG (con valores animados) se lee igual", () => {
    const v = ventana();
    const svg = { href: { baseVal: "https://example.org/s" }, target: { baseVal: "_blank" } };
    expect(v.clic(svg).frenado).toBe(true);
    expect(v.avisos).toEqual(["https://example.org/s"]);
  });

  it("los esquemas que no visitan nada (correo, javascript) no cuentan", () => {
    const v = ventana();
    expect(v.clic(enlace("mailto:hola@example.org", "_blank")).frenado).toBe(false);
    expect(v.clic(enlace("javascript:void(0)", "_blank")).frenado).toBe(false);
    expect(v.avisos).toEqual([]);
  });

  it("un clic que no es sobre un enlace no hace nada", () => {
    const v = ventana();
    expect(v.clic(null).frenado).toBe(false);
  });

  it("window.open a otro sitio devuelve null y avisa, y a uno propio sigue andando", () => {
    const v = ventana();
    expect(v.win.open("https://example.org/x?q=1", "_blank")).toBeNull();
    expect(v.avisos).toEqual(["https://example.org/x"]);
    expect(v.win.open("/comprobante", "_blank")).toEqual({ abierta: true });
    expect(v.win.open()).toEqual({ abierta: true });
    expect(v.abiertas).toEqual([["/comprobante", "_blank"], []]);
  });

  it("un formulario que manda a otro sitio en pestaña nueva se frena", () => {
    const v = ventana();
    const f = { target: "_blank", getAttribute: () => "https://example.org/enviar" };
    expect(v.envio(f).frenado).toBe(true);
    expect(v.avisos).toEqual(["https://example.org/enviar"]);
    const propio = { target: "_blank", getAttribute: () => "/enviar" };
    expect(v.envio(propio).frenado).toBe(false);
    const mismaPestana = { target: "", getAttribute: () => "https://example.org/enviar" };
    expect(v.envio(mismaPestana).frenado).toBe(false);
  });

  it("cortarFueraDelOrigen instala el guion en cada documento y escucha sus avisos", async () => {
    const ws = new EventTarget();
    const enviados = [];
    const page = {
      ws,
      async send(metodo, params = {}) {
        enviados.push([metodo, params]);
        if (metodo === "Page.getFrameTree") return { frameTree: { frame: { id: "PRINCIPAL" } } };
        return {};
      },
    };
    const corte = await cortarFueraDelOrigen(page, ORIGEN);
    const binding = enviados.find(([m]) => m === "Runtime.addBinding");
    expect(binding[1]).toEqual({ name: "tinkazoFuera" });
    const guion = enviados.find(([m]) => m === "Page.addScriptToEvaluateOnNewDocument");
    expect(guion[1].source).toBe(guionContraVentanasNuevas(ORIGEN));
    // El aviso del binding se pide antes que el guion, para que el guion lo encuentre.
    const lugar = (nombre) => enviados.findIndex(([m]) => m === nombre);
    expect(lugar("Runtime.addBinding")).toBeLessThan(lugar("Page.addScriptToEvaluateOnNewDocument"));
    const aviso = (name, payload) => ws.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify({ method: "Runtime.bindingCalled", params: { name, payload } }) }));
    aviso("otroNombre", "https://example.org/no");
    expect(() => corte.revisar()).not.toThrow();
    aviso("tinkazoFuera", "https://example.org/si");
    expect(corte.fuera).toEqual(["https://example.org/si"]);
    expect(() => corte.revisar()).toThrow(/otro sitio.*example\.org\/si/);
  });
});
