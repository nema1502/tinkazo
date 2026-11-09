// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import { cargaOpcional, installVersionNotice, isStaleChunkError, resetVersionNotice, showVersionNotice } from "./version-nueva";

/**
 * El aviso de versión nueva: una pestaña abierta desde antes de publicar
 * apunta a los trozos viejos y el botón que carga a pedido no hace nada. El
 * aviso escucha el evento de Vite y los rechazos con ese mensaje, pide la
 * página sin caché para confirmar que de verdad hay otra versión publicada,
 * muestra una cinta con un botón y nunca recarga solo.
 */

const AVISO_ES = "Hay una versión nueva de Tinkazo. Recargá la página para seguir.";
const BOTON_ES = "Recargar";
const AVISO_EN = "There is a new version of Tinkazo. Reload the page to continue.";
const BOTON_EN = "Reload";

/** La entrada con la que se abrió esta pestaña, como la escribe el build. */
const ENTRADA = "/assets/index-ABC123.js";
const pagina = (entrada: string): string =>
  `<!doctype html><html><head><script type="module" crossorigin src="${entrada}"></script></head><body></body></html>`;

/** La página que devuelve el servidor al pedirla de nuevo. */
const servir = (cuerpo: string, tipo = "text/html; charset=utf-8", status = 200): ReturnType<typeof vi.fn> => {
  const fetchFalso = vi.fn(async () => new Response(cuerpo, { status, headers: { "content-type": tipo } }));
  vi.stubGlobal("fetch", fetchFalso);
  return fetchFalso;
};
/** Publicaron otra versión: la entrada cambió de nombre. */
const hayOtra = (): ReturnType<typeof vi.fn> => servir(pagina("/assets/index-XYZ789.js"));

/** Un rechazo sin atrapar con el motivo dado, como lo ve la ventana. */
const rechazar = (motivo: unknown): void => {
  const evento = new Event("unhandledrejection");
  (evento as Event & { reason?: unknown }).reason = motivo;
  window.dispatchEvent(evento);
};
const fallaVite = (): void => {
  window.dispatchEvent(new Event("vite:preloadError"));
};

/** Deja correr los temporizadores y las promesas del pedido. */
const asentar = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const cinta = (): HTMLElement | null => document.getElementById("version-nueva");
const boton = (): HTMLButtonElement | null => document.querySelector("#version-nueva button");

beforeEach(() => {
  resetVersionNotice();
  document.head.innerHTML = `<script type="module" crossorigin src="${ENTRADA}"></script>`;
  document.body.innerHTML = "";
  setLang("es");
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("el reconocimiento del fallo", () => {
  it("vale para el mensaje de cada navegador", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://tinkazo.app/assets/saldo.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("error loading dynamically imported module: https://tinkazo.app/assets/saldo.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError("Failed to fetch dynamically imported module")).toBe(true);
  });

  it("no vale para otros errores", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleChunkError(new Error("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError({})).toBe(false);
  });
});

describe("la cinta", () => {
  it("el aviso de Vite la muestra, con su botón de al menos 44 px", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(cinta()?.getAttribute("role")).toBe("alert");
    expect(cinta()?.textContent).toContain(AVISO_ES);
    expect(boton()?.textContent).toBe(BOTON_ES);
    expect(boton()?.style.minHeight).toBe("44px");
  });

  it("un rechazo con el mensaje del módulo importado también", async () => {
    hayOtra();
    rechazar(new TypeError("Failed to fetch dynamically imported module: https://tinkazo.app/assets/saldo.js"));
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(cinta()?.textContent).toContain(AVISO_ES);
    expect(boton()?.textContent).toBe(BOTON_ES);
  });

  it("otro error no la muestra", async () => {
    const fetchFalso = hayOtra();
    rechazar(new Error("No hay conexión con el registro. Revisá tu internet y probá de nuevo."));
    await asentar();
    expect(cinta()).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("dos fallos seguidos dejan una sola cinta y un solo pedido", async () => {
    const fetchFalso = hayOtra();
    fallaVite();
    rechazar(new TypeError("Failed to fetch dynamically imported module"));
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    showVersionNotice();
    expect(document.querySelectorAll("#version-nueva")).toHaveLength(1);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("en inglés sale en inglés", async () => {
    setLang("en");
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(cinta()?.textContent).toContain(AVISO_EN);
    expect(boton()?.textContent).toBe(BOTON_EN);
  });

  it("solo el botón recarga, con la función inyectada", async () => {
    const recargar = vi.fn();
    installVersionNotice({ reload: recargar });
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(recargar).not.toHaveBeenCalled();
    boton()?.click();
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});

describe("solo con una versión nueva de verdad", () => {
  it("sin conexión no aparece y no pide nada", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const fetchFalso = hayOtra();
    fallaVite();
    rechazar(new TypeError("Failed to fetch dynamically imported module"));
    await asentar();
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(cinta()).toBeNull();
  });

  it("si el pedido falla (el wifi se cortó), no aparece", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchFalso);
    fallaVite();
    await asentar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(cinta()).toBeNull();
  });

  it("pide la página sin caché", async () => {
    const fetchFalso = hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const [, opciones] = fetchFalso.mock.calls[0] as [unknown, RequestInit | undefined];
    expect(opciones?.cache).toBe("no-store");
  });

  it("con la misma entrada no aparece", async () => {
    const fetchFalso = servir(pagina(ENTRADA));
    fallaVite();
    await asentar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(cinta()).toBeNull();
  });

  it("si la respuesta no es una página (un portal del wifi), no aparece", async () => {
    servir(`<script type="module" src="/assets/index-XYZ789.js"></script>`, "text/plain");
    fallaVite();
    await asentar();
    expect(cinta()).toBeNull();
  });

  it("si la respuesta es un error, no aparece", async () => {
    servir(pagina("/assets/index-XYZ789.js"), "text/html", 503);
    fallaVite();
    await asentar();
    expect(cinta()).toBeNull();
  });

  it("una página de otro sitio (el portal del wifi en HTML) no cuenta como versión nueva", async () => {
    servir(`<!doctype html><html><head><script type="module" src="https://portal.example/login.js"></script></head><body>Ingresá</body></html>`);
    fallaVite();
    await asentar();
    expect(cinta()).toBeNull();
    servir(`<!doctype html><html><body><form>Ingresá</form></body></html>`);
    fallaVite();
    await asentar();
    expect(cinta()).toBeNull();
  });

  it("con la entrada distinta aparece", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
  });
});

describe("no tapa nada y se puede cerrar", () => {
  const cerrar = (): HTMLButtonElement | null => document.querySelector("#version-nueva button[data-cerrar]");

  it("va en su lugar arriba de la página, sin quedar encima de la cabecera ni de las capas", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(document.body.firstElementChild).toBe(cinta());
    expect(["", "static", "relative"]).toContain(cinta()?.style.position);
    expect(cinta()?.style.zIndex).toBe("");
  });

  it("con la cabecera fija va dentro de ella: baja con la página y queda a la vista", async () => {
    document.body.innerHTML = `<header style="position: sticky; top: 0"><div class="bar"></div></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const cabecera = document.querySelector("body > header");
    expect(cinta()?.parentElement).toBe(cabecera);
    expect(cabecera?.firstElementChild).toBe(cinta());
    expect(["", "static", "relative"]).toContain(cinta()?.style.position);
    expect(cinta()?.style.zIndex).toBe("");
  });

  it("con la cabecera fija avisa que cambió de alto al aparecer y al cerrarse", async () => {
    document.body.innerHTML = `<header style="position: sticky; top: 0"></header><main></main>`;
    const medir = vi.fn();
    window.addEventListener("resize", medir);
    try {
      hayOtra();
      fallaVite();
      await vi.waitFor(() => expect(cinta()).not.toBeNull());
      expect(medir).toHaveBeenCalledTimes(1);
      document.querySelector<HTMLButtonElement>("#version-nueva button[data-cerrar]")?.click();
      expect(medir).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("resize", medir);
    }
  });

  it("con la cabecera en su lugar (celular) va arriba de la página, fuera de ella", async () => {
    document.body.innerHTML = `<header style="position: static"></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(document.body.firstElementChild).toBe(cinta());
  });

  it("con el estadio a la vista espera, y aparece cuando se cierra", async () => {
    document.body.innerHTML = `<div class="stadium" id="stadium" style="display:block"></div>`;
    hayOtra();
    fallaVite();
    await asentar();
    expect(cinta()).toBeNull();
    (document.getElementById("stadium") as HTMLElement).style.display = "none";
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
  });

  for (const capa of [
    `<div class="espera"></div>`,
    `<div class="cortina"></div>`,
    `<div class="modal-back"></div>`,
    `<div class="game-card"></div>`,
    `<div class="sala pantalla"></div>`,
    `<dialog open></dialog>`,
  ]) {
    it(`con ${capa} abierta espera, y aparece cuando se cierra`, async () => {
      document.body.innerHTML = `<main></main>${capa}`;
      hayOtra();
      fallaVite();
      await asentar();
      expect(cinta()).toBeNull();
      document.body.lastElementChild?.remove();
      await vi.waitFor(() => expect(cinta()).not.toBeNull());
    });
  }

  it("con la sala en grande espera, y aparece al achicarla", async () => {
    document.body.innerHTML = `<section class="stand-sala grande" id="stand-sala"></section>`;
    hayOtra();
    fallaVite();
    await asentar();
    expect(cinta()).toBeNull();
    document.getElementById("stand-sala")?.classList.remove("grande");
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
  });

  it("tiene un botón para cerrarla, de al menos 44 px, en los dos idiomas", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(cerrar()?.textContent).toBe("Ahora no");
    expect(Number.parseFloat(cerrar()?.style.minHeight ?? "0")).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(cerrar()?.style.minWidth ?? "0")).toBeGreaterThanOrEqual(44);
    setLang("en");
    expect(cerrar()?.textContent).toBe("Not now");
  });

  it("cerrarla la quita sin recargar, y no vuelve en esta página", async () => {
    const recargar = vi.fn();
    installVersionNotice({ reload: recargar });
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    cerrar()?.click();
    expect(cinta()).toBeNull();
    expect(recargar).not.toHaveBeenCalled();
    fallaVite();
    rechazar(new TypeError("Failed to fetch dynamically imported module"));
    await asentar();
    expect(cinta()).toBeNull();
  });

  it("cerrada, un cambio de idioma ya no toca la cinta que se fue", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const ida = cinta() as HTMLElement;
    cerrar()?.click();
    setLang("en");
    expect(ida.textContent).toContain(AVISO_ES);
    expect(ida.textContent).not.toContain(AVISO_EN);
  });
});

describe("en pantalla angosta, con la página bajada", () => {
  /**
   * Con 1100 px o menos la cabecera se queda en su lugar (styles.css), así que
   * la cinta va arriba de la página y, sin más, con la página bajada no se ve:
   * el botón no hace nada y nadie se entera. Ahí va pegada arriba, por debajo
   * de las capas, y publica su alto para que la banda del ensayo se apile
   * debajo y la barra de lo que sigue no cuente como visible un botón tapado.
   */
  const ALTO = 62;
  const raiz = document.documentElement.style;
  const altoPublicado = (): string => raiz.getPropertyValue("--cinta-alto");
  let medida: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    raiz.removeProperty("--cinta-alto");
    const original = HTMLElement.prototype.getBoundingClientRect;
    medida = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "version-nueva") return { top: 0, bottom: ALTO, left: 0, right: 390, width: 390, height: ALTO, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      return original.call(this);
    });
  });

  afterEach(() => {
    medida.mockRestore();
    raiz.removeProperty("--cinta-alto");
  });

  it("queda pegada arriba al bajar, debajo de las capas y encima de la banda del ensayo", async () => {
    document.body.innerHTML = `<header style="position: static"></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(document.body.firstElementChild).toBe(cinta());
    expect(cinta()?.style.position).toBe("sticky");
    expect(Number.parseFloat(cinta()?.style.top ?? "x")).toBe(0);
    const z = Number(cinta()?.style.zIndex);
    // La banda del ensayo es 12; el estadio, la primera capa, 40.
    expect(z).toBeGreaterThan(12);
    expect(z).toBeLessThan(40);
  });

  it("publica su alto al aparecer y lo quita al cerrarse, y avisa las dos veces", async () => {
    document.body.innerHTML = `<header style="position: static"></header><main></main>`;
    const medir = vi.fn();
    window.addEventListener("resize", medir);
    try {
      hayOtra();
      fallaVite();
      await vi.waitFor(() => expect(cinta()).not.toBeNull());
      expect(altoPublicado()).toBe(`${ALTO}px`);
      expect(medir).toHaveBeenCalledTimes(1);
      document.querySelector<HTMLButtonElement>("#version-nueva button[data-cerrar]")?.click();
      expect(altoPublicado()).toBe("");
      expect(medir).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("resize", medir);
    }
  });

  it("con la cabecera fija no publica nada: su alto ya va en el de la cabecera", async () => {
    document.body.innerHTML = `<header style="position: sticky; top: 0"></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    expect(altoPublicado()).toBe("");
  });

  it("si la ventana cruza el ancho de la cabecera fija, se muda y no queda encima de ella", async () => {
    document.body.innerHTML = `<header style="position: static"></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const cabecera = document.querySelector<HTMLElement>("body > header") as HTMLElement;
    // Se ensancha la ventana: la cabecera vuelve a ser fija.
    cabecera.style.position = "sticky";
    window.dispatchEvent(new Event("resize"));
    expect(cabecera.firstElementChild).toBe(cinta());
    expect(["", "static", "relative"]).toContain(cinta()?.style.position);
    expect(cinta()?.style.zIndex).toBe("");
    expect(altoPublicado()).toBe("");
    // Y se vuelve a angostar.
    cabecera.style.position = "static";
    window.dispatchEvent(new Event("resize"));
    expect(document.body.firstElementChild).toBe(cinta());
    expect(cinta()?.style.position).toBe("sticky");
    expect(altoPublicado()).toBe(`${ALTO}px`);
  });

  it("cerrada, un cambio de tamaño ya no la toca ni publica nada", async () => {
    document.body.innerHTML = `<header style="position: static"></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    document.querySelector<HTMLButtonElement>("#version-nueva button[data-cerrar]")?.click();
    window.dispatchEvent(new Event("resize"));
    expect(cinta()).toBeNull();
    expect(altoPublicado()).toBe("");
  });

  /**
   * La app instalada en un iPhone (viewport-fit=cover y la barra de estado
   * translúcida) dibuja la página debajo de la hora y la batería. La cabecera
   * deja ese lugar; fuera de ella, la cinta lo deja sola. Sin muesca, env()
   * vale cero y el relleno es el de siempre, 10 px arriba y 16 a los costados.
   */
  const CON_MUESCA = {
    top: "max(10px, env(safe-area-inset-top, 0px))",
    left: "max(16px, env(safe-area-inset-left, 0px))",
    right: "max(16px, env(safe-area-inset-right, 0px))",
  };

  it("fuera de la cabecera deja el lugar de la muesca; dentro, el relleno de siempre", async () => {
    document.body.innerHTML = `<header style="position: static"></header><main></main>`;
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const estilo = (cinta() as HTMLElement).style;
    expect([estilo.paddingTop, estilo.paddingLeft, estilo.paddingRight, estilo.paddingBottom]).toEqual([CON_MUESCA.top, CON_MUESCA.left, CON_MUESCA.right, "10px"]);
    const cabecera = document.querySelector<HTMLElement>("body > header") as HTMLElement;
    cabecera.style.position = "sticky";
    window.dispatchEvent(new Event("resize"));
    expect([estilo.paddingTop, estilo.paddingLeft, estilo.paddingRight, estilo.paddingBottom]).toEqual(["10px", "16px", "16px", "10px"]);
    cabecera.style.position = "static";
    window.dispatchEvent(new Event("resize"));
    expect(estilo.paddingTop).toBe(CON_MUESCA.top);
  });

  it("en una página sin cabecera también deja el lugar de la muesca", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const estilo = (cinta() as HTMLElement).style;
    expect([estilo.paddingTop, estilo.paddingLeft, estilo.paddingRight, estilo.paddingBottom]).toEqual([CON_MUESCA.top, CON_MUESCA.left, CON_MUESCA.right, "10px"]);
  });

  /**
   * Safari de iOS no tiene anclaje de scroll: con la página bajada, poner o
   * quitar la cinta pegada (que ocupa su alto en el flujo) mueve todo el
   * contenido ese alto. Ahí se compensa a mano; con anclaje, el navegador ya
   * lo hace y no se toca nada.
   */
  describe("con la página bajada", () => {
    const desplazar = vi.fn();
    beforeEach(() => {
      desplazar.mockClear();
      vi.stubGlobal("scrollBy", desplazar);
      vi.stubGlobal("scrollY", 300);
    });

    const abrirYCerrar = async (): Promise<void> => {
      hayOtra();
      fallaVite();
      await vi.waitFor(() => expect(cinta()).not.toBeNull());
      document.querySelector<HTMLButtonElement>("#version-nueva button[data-cerrar]")?.click();
      expect(cinta()).toBeNull();
    };

    it("sin anclaje de scroll, compensa el alto al aparecer y al cerrarse", async () => {
      vi.stubGlobal("CSS", { supports: (propiedad: string) => propiedad !== "overflow-anchor" });
      document.body.innerHTML = `<header style="position: static"></header><main></main>`;
      hayOtra();
      fallaVite();
      await vi.waitFor(() => expect(cinta()).not.toBeNull());
      expect(desplazar.mock.calls).toEqual([[0, ALTO]]);
      document.querySelector<HTMLButtonElement>("#version-nueva button[data-cerrar]")?.click();
      expect(desplazar.mock.calls).toEqual([[0, ALTO], [0, -ALTO]]);
    });

    it("sin CSS.supports cuenta como sin anclaje", async () => {
      vi.stubGlobal("CSS", undefined);
      document.body.innerHTML = `<header style="position: static"></header><main></main>`;
      await abrirYCerrar();
      expect(desplazar.mock.calls).toEqual([[0, ALTO], [0, -ALTO]]);
    });

    /**
     * Con la página bajada la cinta pegada puede cambiar de alto (el celular
     * girado, otro idioma, los botones que bajan a otra fila): sin anclaje, lo
     * de abajo se correría esa diferencia. Dentro de la cabecera fija no se
     * toca nada, como al aparecer.
     */
    it("sin anclaje, si la cinta pegada cambia de alto compensa la diferencia", async () => {
      vi.stubGlobal("CSS", { supports: () => false });
      const observado: { avisar?: () => void } = {};
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(avisar: () => void) {
            observado.avisar = avisar;
          }
          observe(): void {}
          disconnect(): void {}
        },
      );
      let alto = ALTO;
      const previa = medida.getMockImplementation();
      medida.mockImplementation(function (this: HTMLElement) {
        if (this.id === "version-nueva") return { top: 0, bottom: alto, left: 0, right: 390, width: 390, height: alto, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        return previa?.call(this) as DOMRect;
      });
      document.body.innerHTML = `<header style="position: static"></header><main></main>`;
      hayOtra();
      fallaVite();
      await vi.waitFor(() => expect(cinta()).not.toBeNull());
      expect(desplazar.mock.calls).toEqual([[0, ALTO]]);
      alto = ALTO + 24;
      observado.avisar?.();
      expect(desplazar.mock.calls).toEqual([[0, ALTO], [0, 24]]);
      expect(altoPublicado()).toBe(`${ALTO + 24}px`);
      alto = ALTO;
      observado.avisar?.();
      expect(desplazar.mock.calls).toEqual([[0, ALTO], [0, 24], [0, -24]]);
      // Dentro de la cabecera fija, su cambio de alto no mueve nada.
      (document.querySelector("body > header") as HTMLElement).style.position = "sticky";
      window.dispatchEvent(new Event("resize"));
      alto = ALTO + 24;
      observado.avisar?.();
      expect(desplazar.mock.calls).toHaveLength(3);
    });

    it("con anclaje de scroll no toca nada", async () => {
      vi.stubGlobal("CSS", { supports: () => true });
      document.body.innerHTML = `<header style="position: static"></header><main></main>`;
      await abrirYCerrar();
      expect(desplazar).not.toHaveBeenCalled();
    });

    it("con la página arriba de todo, en la cabecera fija o sin cabecera, no toca nada", async () => {
      vi.stubGlobal("CSS", { supports: () => false });
      vi.stubGlobal("scrollY", 0);
      document.body.innerHTML = `<header style="position: static"></header><main></main>`;
      await abrirYCerrar();
      resetVersionNotice();
      vi.stubGlobal("scrollY", 300);
      document.body.innerHTML = `<header style="position: sticky; top: 0"></header><main></main>`;
      await abrirYCerrar();
      resetVersionNotice();
      document.body.innerHTML = `<main></main>`;
      await abrirYCerrar();
      expect(desplazar).not.toHaveBeenCalled();
    });
  });
});

describe("los botones de la cinta", () => {
  /**
   * El texto y los dos botones van en una sola fila si entran. Si no, bajan
   * los dos juntos: nunca "Recargar" al lado del texto y "Ahora no" solo
   * abajo (pasaba a 768 px). Por eso van agrupados, sin partirse.
   */
  it("van juntos en un grupo aparte del texto, con 44 px de alto cada uno", async () => {
    hayOtra();
    fallaVite();
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
    const recargar = boton() as HTMLButtonElement;
    const ahoraNo = document.querySelector<HTMLButtonElement>("#version-nueva button[data-cerrar]") as HTMLButtonElement;
    const grupo = recargar.parentElement as HTMLElement;
    expect(ahoraNo.parentElement).toBe(grupo);
    expect(grupo).not.toBe(cinta());
    expect(grupo.parentElement).toBe(cinta());
    expect(cinta()?.children).toHaveLength(2);
    expect(cinta()?.firstElementChild?.textContent).toBe(AVISO_ES);
    expect(cinta()?.lastElementChild).toBe(grupo);
    expect([...grupo.children]).toEqual([recargar, ahoraNo]);
    expect(grupo.style.display).toBe("flex");
    expect([recargar.style.minHeight, ahoraNo.style.minHeight]).toEqual(["44px", "44px"]);
  });
});

describe("lo que la página encuadra arriba, con la cinta pegada", () => {
  /**
   * Con la cinta pegada arriba (1100 px o menos), lo que el sitio lleva a la
   * vista con scrollIntoView o con un enlace a un ancla tiene que quedar
   * debajo de ella, sea el elemento que sea ("18 personas, 1 ganador" al
   * pegar la lista, /#juegos). Un solo lugar lo resuelve para todos: el
   * scroll-padding-top de html. Las reglas de scroll-margin-top no lo suman,
   * porque los dos se suman y se contaría dos veces; sin la cinta, todo vale
   * lo mismo que antes de que existiera.
   */
  // Con jsdom, URL es la del navegador y no abre archivos: la ruta va armada a mano.
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

  /** Los bloques `@media (max-width: 1100px)`, con sus llaves parejas. */
  const angostas = [...css.matchAll(/@media\s*\(\s*max-width:\s*1100px\s*\)\s*\{/g)].map((m) => {
    let prof = 0;
    for (let i = m.index ?? 0; i < css.length; i++) {
      if (css[i] === "{") prof++;
      else if (css[i] === "}" && --prof === 0) return css.slice(m.index, i + 1);
    }
    return "";
  });

  it("a 1100 px o menos, html deja arriba el alto de la cinta, y sin ella lo de siempre", () => {
    const conPadding = angostas.filter((b) => /html\s*\{[^}]*scroll-padding-top/.test(b));
    expect(conPadding).toHaveLength(1);
    // Sin la cinta, el valor de siempre: html no tenía scroll-padding-top en pantalla angosta (auto).
    expect(conPadding[0]).toMatch(/html\s*\{\s*scroll-padding-top:\s*var\(--cinta-alto,\s*auto\);?\s*\}/);
  });

  it("ninguna regla de scroll-margin-top suma la cinta, y vuelven a sus valores", () => {
    const margenes = [...css.matchAll(/scroll-margin-top:\s*([^;}]*)/g)].map((m) => m[1] ?? "");
    expect(margenes.length).toBeGreaterThan(0);
    expect(margenes.filter((v) => v.includes("--cinta-alto"))).toEqual([]);
    expect(css).toMatch(/\.juego-nota \{ scroll-margin-top: 12px; \}/);
    expect(css).toMatch(/body\[data-ensayo="1"\] \.juego-nota \{ scroll-margin-top: calc\(var\(--banda-alto, 0px\) \+ 12px\); \}/);
    expect(css).toMatch(/body\[data-stand="1"\] section\.block \{ scroll-margin-top: calc\(var\(--banda-alto, 0px\) \+ 8px\); \}/);
  });

  it("la banda del ensayo sigue apilándose debajo de la cinta", () => {
    expect(css).toMatch(/\.stand-banda \{[^}]*position: sticky; top: var\(--cinta-alto, 0px\)/);
  });

  /**
   * En la app instalada en un iPhone la cinta pegada ya deja el lugar de la
   * muesca. La cabecera, quieta justo debajo, dejaba otro igual: un hueco entre
   * la cinta y el logo. Mientras la cinta va antes que ella, la cabecera no lo
   * deja; dentro de la cabecera fija o sin cinta, la regla no alcanza a nadie.
   */
  it("con la cinta pegada, la cabecera no deja otra vez el lugar de la muesca", () => {
    const regla = /^\s*(body > #version-nueva ~ header)\s*\{\s*padding-top:\s*0;?\s*\}/m.exec(css);
    expect(regla).not.toBeNull();
    const selector = regla?.[1] ?? "";
    const alcanza = (html: string): boolean => {
      document.body.innerHTML = html;
      return document.querySelector("header")?.matches(selector) ?? false;
    };
    expect(alcanza(`<div id="version-nueva"></div><header></header><main></main>`)).toBe(true);
    expect(alcanza(`<header><div id="version-nueva"></div></header><main></main>`)).toBe(false);
    expect(alcanza(`<header></header><main></main>`)).toBe(false);
  });
});

describe("las cargas opcionales", () => {
  /**
   * Un import que falla como en el build: el ayudante de Vite manda su evento
   * con el error y después lo vuelve a lanzar (handlePreloadError).
   */
  const importQueFalla = (): Promise<{ countVisits: () => void }> => {
    const error = new TypeError("Failed to fetch dynamically imported module: https://tinkazo.app/assets/analytics-abc.js");
    return Promise.resolve().then(() => {
      const evento = new Event("vite:preloadError", { cancelable: true });
      (evento as Event & { payload?: unknown }).payload = error;
      window.dispatchEvent(evento);
      throw error;
    });
  };

  it("si falla una (el contador bloqueado, el wifi), no despierta el aviso aunque haya otra versión", async () => {
    const fetchFalso = hayOtra();
    const sinAtrapar = vi.fn();
    window.addEventListener("unhandledrejection", sinAtrapar);
    try {
      await expect(cargaOpcional(importQueFalla().then((m) => m.countVisits()))).resolves.toBeUndefined();
      await asentar();
    } finally {
      window.removeEventListener("unhandledrejection", sinAtrapar);
    }
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(sinAtrapar).not.toHaveBeenCalled();
    expect(cinta()).toBeNull();
  });

  it("si anda, devuelve lo que carga", async () => {
    await expect(cargaOpcional(Promise.resolve(7))).resolves.toBe(7);
  });

  it("un fallo que no es de una carga opcional sigue despertando el aviso", async () => {
    hayOtra();
    void importQueFalla().catch(() => undefined);
    await vi.waitFor(() => expect(cinta()).not.toBeNull());
  });
});
