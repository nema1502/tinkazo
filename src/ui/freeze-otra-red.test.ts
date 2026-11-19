// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Lo que dice la línea de debajo de "Sellar la lista" y lo que hace `freeze()` tienen que coincidir siempre, con el
 * modo Oficial a la vista: la pantalla nunca dice que un sorteo queda registrado si no va a quedar registrado.
 *
 * - Con la billetera en la otra red (fuera del Ensayo y de la demo) no se cae callado al modo libre: se frena con el
 *   aviso de cómo seguir, y la línea lo dice.
 * - En el Ensayo y en la demo, que no graban nada, la línea no promete nada y se sella sin grabar como siempre.
 * - Sin modo Oficial, todo sigue como hoy: con la billetera en otra red se sella en modo libre y la línea no se ve.
 * - Cerrar la confirmación del primer sello en Oficial suelta la pantalla completa que pidió el toque.
 * - Mientras se sella, el cambio de modo sabe que no puede pasar.
 * - La confirmación va primero: antes de la cuenta, del chequeo de la red y del envío, y sin ella no se manda nada.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sealOnChain: vi.fn(),
  contar: vi.fn(),
  pedir: vi.fn(),
  soltar: vi.fn(),
  confirmar: vi.fn(),
  hayModo: true,
  canAnchor: false,
  otraRed: true,
  sinGrabar: false,
  grande: false,
  frenadas: 0,
  /** Cómo contesta `frenarPorOtraRed`, si no es enseguida: la billetera tarda en decir su red. */
  frenarCon: null as null | (() => Promise<boolean>),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get hayModoOficial() {
      return h.hayModo;
    },
    network: { ...o.network, name: "mainnet", contractId: "CREAL" },
  };
});
vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  hideTxStatus: () => undefined,
  margenParaAprobar: async () => 0,
  pagaElPortero: async () => false,
  precargarParaElSorteo: () => undefined,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: (...a: unknown[]) => h.sealOnChain(...a),
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sello-seguro", async (orig) => ({
  ...(await orig<typeof import("./sello-seguro")>()),
  leerPendiente: () => null,
  guardarPendiente: () => undefined,
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => {
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => h.sinGrabar }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  canAnchor: () => h.canAnchor,
  claveDeSellar: () => "freeze",
  currentSession: () => {
    h.orden.push("sesion");
    return { address: "GAAA" };
  },
  billeteraEnOtraRed: () => h.otraRed,
  frenarPorOtraRed: async () => {
    h.frenadas++;
    return h.frenarCon ? h.frenarCon() : h.otraRed;
  },
}));
vi.mock("./modo-ui", () => ({
  confirmarPrimerSelloOficial: () => h.confirmar(),
  marcarSellandoAhora: (v: boolean) => void h.orden.push(`sellando:${String(v)}`),
}));
vi.mock("./participants", () => ({
  cerrarLista: () => undefined,
  olvidarBorrador: () => undefined,
  parseNames: () => ["Ana", "Beto"],
  setList: () => undefined,
}));
vi.mock("./red", () => ({
  chequearAntesDeSellar: async () => {
    h.orden.push("chequear");
    return true;
  },
  hayAccionDeRed: () => false,
  limpiarRed: () => undefined,
  marcarSellado: () => undefined,
  mostrarCostoAlto: async () => undefined,
  mostrarSinPatrocinio: async () => undefined,
  mostrarSinSaldo: async () => undefined,
  patrocinioDelError: () => null,
  verLaRedTrasFallar: async () => false,
  verSinSello: async () => undefined,
}));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: () => undefined }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => h.grande }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: (...a: unknown[]) => h.pedir(...a), soltarPantallaCompleta: () => h.soltar() }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => ({ games: [] }) }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("../logo-guardado", () => ({ logoParaSellar: () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

function armarPagina(): void {
  document.body.innerHTML = `<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left"].map((id) => `<div id="${id}"></div>`).join("")}<button id="btn-draw"></button><button id="g-wheel"></button>`;
  Element.prototype.scrollIntoView = () => undefined;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  h.sealOnChain.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.contar.mockReset();
  h.pedir.mockReset();
  h.soltar.mockReset();
  h.confirmar.mockReset();
  h.confirmar.mockResolvedValue(true);
  h.hayModo = true;
  h.canAnchor = false;
  h.otraRed = true;
  h.sinGrabar = false;
  h.grande = false;
  h.frenadas = 0;
  h.frenarCon = null;
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

const cuentas = (evento: string): number => h.contar.mock.calls.filter(([e]) => e === evento).length;
const linea = (): HTMLElement => document.getElementById("sellar-modo") as HTMLElement;

describe("la billetera en la otra red, con el modo Oficial a la vista", () => {
  it("no sella en modo libre: se frena con el aviso y suelta la pantalla completa que pidió el toque", async () => {
    h.grande = true;
    const { app } = await import("../state");
    app.frozen = null;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.frenadas).toBe(1);
    expect(app.frozen).toBeNull();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(cuentas("seal_sent")).toBe(0);
    expect(h.pedir).toHaveBeenCalledTimes(1);
    expect(h.soltar).toHaveBeenCalledTimes(1);
  });

  it("la línea bajo el botón no dice que queda registrado: dice que la billetera está en otra red", async () => {
    const { refreshFreezeLabel } = await import("./freeze");
    refreshFreezeLabel();
    expect(linea().textContent).not.toContain(T.es.sealModeOfficial);
    expect(linea().textContent).toBe(String(T.es.sealModeOtraRed).replace("{modo}", String(T.es.netMain)));
    expect(linea().style.display).toBe("");
  });

  it("con la cuenta en su red, la línea dice que queda registrado y se sella en la cadena", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    // Lo que viene después de un sello que entra no es de esta prueba: el sello falla y se mira que se intentó.
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { refreshFreezeLabel, freeze } = await import("./freeze");
    refreshFreezeLabel();
    expect(linea().textContent).toBe(T.es.sealModeOfficial);
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });
});

describe("la línea de debajo de Sellar la lista sigue al idioma", () => {
  it("con la página abierta en inglés la línea sale en inglés: main.ts la arma en español y después aplica el idioma", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    const { refreshFreezeLabel } = await import("./freeze");
    const { setLang } = await import("../i18n");
    setLang("es");
    // Lo que hace main.ts al armar la herramienta, todavía con el idioma de arranque.
    refreshFreezeLabel();
    expect(linea().textContent).toBe(T.es.sealModeOfficial);
    // Y lo que hace al final, con ?lang=en o con el navegador en inglés: sin que nadie vuelva a pedir la línea.
    setLang("en");
    expect(linea().textContent).toBe(T.en.sealModeOfficial);
    setLang("es");
    expect(linea().textContent).toBe(T.es.sealModeOfficial);
  });

  it("con la billetera en la otra red el cambio de idioma conserva ese aviso, en el idioma nuevo", async () => {
    const { refreshFreezeLabel } = await import("./freeze");
    const { setLang } = await import("../i18n");
    setLang("es");
    refreshFreezeLabel();
    setLang("en");
    expect(linea().textContent).toBe(String(T.en.sealModeOtraRed).replace("{modo}", String(T.en.netMain)));
    expect(linea().style.display).toBe("");
  });

  it("en el Ensayo y en la demo la línea sigue escondida y vacía al cambiar el idioma", async () => {
    h.sinGrabar = true;
    const { refreshFreezeLabel } = await import("./freeze");
    const { setLang } = await import("../i18n");
    setLang("es");
    refreshFreezeLabel();
    setLang("en");
    expect(linea().style.display).toBe("none");
    expect(linea().textContent).toBe("");
  });
});

describe("el Ensayo y la demo no graban nada", () => {
  it("la línea no se ve y se sella sin grabar como siempre, aunque la billetera esté en otra red", async () => {
    h.sinGrabar = true;
    const { app } = await import("../state");
    app.frozen = null;
    const { refreshFreezeLabel, freeze } = await import("./freeze");
    refreshFreezeLabel();
    expect(linea().style.display).toBe("none");
    expect(linea().textContent).toBe("");
    await freeze().catch(() => undefined);
    expect(h.frenadas).toBe(0);
    expect(app.frozen).not.toBeNull();
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });

  it("con la cuenta en su red tampoco promete el registro", async () => {
    h.sinGrabar = true;
    h.canAnchor = true;
    h.otraRed = false;
    const { refreshFreezeLabel } = await import("./freeze");
    refreshFreezeLabel();
    expect(linea().style.display).toBe("none");
    expect(linea().textContent).not.toContain(T.es.sealModeOfficial);
  });
});

describe("sin modo Oficial, como hoy", () => {
  it("con la billetera en otra red se sella en modo libre, sin frenar, y la línea no se ve", async () => {
    h.hayModo = false;
    const { app } = await import("../state");
    app.frozen = null;
    const { refreshFreezeLabel, freeze } = await import("./freeze");
    refreshFreezeLabel();
    expect(linea().style.display).toBe("none");
    await freeze().catch(() => undefined);
    expect(h.frenadas).toBe(0);
    expect(app.frozen).not.toBeNull();
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });
});

describe("la confirmación del primer sello en Oficial", () => {
  it("cerrarla suelta la pantalla completa que pidió el toque, y no sella", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    h.grande = true;
    h.confirmar.mockResolvedValue(false);
    const { app } = await import("../state");
    app.frozen = null;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.pedir).toHaveBeenCalledTimes(1);
    expect(h.soltar).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(app.frozen).toBeNull();
  });

  it("sin pantalla completa pedida, cerrarla no suelta nada", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    h.confirmar.mockResolvedValue(false);
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.pedir).not.toHaveBeenCalled();
    expect(h.soltar).not.toHaveBeenCalled();
  });
});

describe("mientras se sella, el cambio de modo lo sabe", () => {
  it("avisa que empieza a sellar después de la confirmación y antes de mandar nada, y que terminó", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    h.confirmar.mockImplementation(async () => {
      h.orden.push("confirmar");
      return true;
    });
    h.sealOnChain.mockImplementation(async () => {
      h.orden.push("sello");
      return { raffleId: 1n, txHash: "H" };
    });
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.orden.indexOf("confirmar")).toBeLessThan(h.orden.indexOf("sellando:true"));
    expect(h.orden.indexOf("sellando:true")).toBeLessThan(h.orden.indexOf("sello"));
    expect(h.orden.at(-1)).toBe("sellando:false");
  });

  it("si el sello falla, también deja de bloquear", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.orden).toContain("sellando:true");
    expect(h.orden.at(-1)).toBe("sellando:false");
  });
});

describe("la confirmación del primer sello va antes que todo lo demás", () => {
  /** Deja correr lo que esté listo: la promesa de `freeze()` sigue esperando a la confirmación. */
  const dejarCorrer = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

  it("hasta que se confirma no se toca la cuenta, ni se chequea la red, ni se manda el sello; al confirmar, en ese orden", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    let confirmar!: (v: boolean) => void;
    h.confirmar.mockImplementation(() => {
      h.orden.push("confirmar");
      return new Promise<boolean>((r) => (confirmar = r));
    });
    h.sealOnChain.mockImplementation(async () => {
      h.orden.push("sello");
      return { raffleId: 1n, txHash: "H" };
    });
    const { app } = await import("../state");
    app.frozen = null;
    const { freeze } = await import("./freeze");
    const p = freeze().catch(() => undefined);
    await dejarCorrer();
    // Preguntando: nada más pasó.
    expect(h.orden).toEqual(["confirmar"]);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(app.frozen).toBeNull();
    confirmar(true);
    await p;
    const orden = (x: string): number => h.orden.indexOf(x);
    expect(orden("confirmar")).toBeLessThan(orden("sesion"));
    expect(orden("sesion")).toBeLessThan(orden("chequear"));
    expect(orden("chequear")).toBeLessThan(orden("sello"));
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("si no se confirma (cierra o pasa a Prueba), no se toca la cuenta, ni la red, ni se manda nada", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    h.confirmar.mockImplementation(async () => {
      h.orden.push("confirmar");
      return false;
    });
    const { app } = await import("../state");
    app.frozen = null;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    // Lo único que pasó es la pregunta (y el aviso de que terminó, que `freeze()` da siempre al salir).
    expect(h.orden.filter((x) => !x.startsWith("sellando:"))).toEqual(["confirmar"]);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(cuentas("seal_sent")).toBe(0);
    expect(app.frozen).toBeNull();
  });

  it("en el Ensayo y en la demo no hay confirmación: no graban nada", async () => {
    h.sinGrabar = true;
    h.canAnchor = true;
    h.otraRed = false;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.confirmar).not.toHaveBeenCalled();
  });
});

describe("un doble toque mientras se le pregunta la red a la billetera", () => {
  /** Deja correr lo que esté listo. */
  const dejarCorrer = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

  it("el segundo toque no hace nada: un solo sello, y el cambio de modo sigue bloqueado hasta que termina el primero", async () => {
    // La billetera estaba en la otra red y la persona ya la cambió: se le pregunta de nuevo, y mientras contesta toca dos veces.
    h.canAnchor = true;
    let contestar!: (frena: boolean) => void;
    const respuesta = new Promise<boolean>((r) => (contestar = r));
    h.frenarCon = () => respuesta;
    let terminarSello!: () => void;
    h.sealOnChain.mockImplementation(() => {
      h.orden.push("sello");
      return new Promise((r) => (terminarSello = () => r({ raffleId: 1n, txHash: "H" })));
    });
    const { freeze } = await import("./freeze");
    const primero = freeze().catch(() => undefined);
    const segundo = freeze().catch(() => undefined);
    contestar(false);
    await dejarCorrer();
    expect(h.frenadas).toBe(1);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    // El primero sigue sellando: nadie avisó que terminó.
    expect(h.orden.filter((x) => x.startsWith("sellando:"))).toEqual(["sellando:true"]);
    terminarSello();
    await Promise.all([primero, segundo]);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(h.orden.at(-1)).toBe("sellando:false");
  });

  it("terminado el primero, se puede volver a sellar", async () => {
    h.canAnchor = true;
    h.otraRed = false;
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).toHaveBeenCalledTimes(2);
  });
});
