// @vitest-environment jsdom
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
