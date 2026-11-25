import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "./contract";
import { mensajeDeRechazo, pollarWallet, submitsItself } from "./wallet-pollar";

/**
 * Pollar no lanza cuando una transacción no sale: devuelve `{ status: "error" }`
 * y deja el motivo en `resultCode`, `details`, `code` o `message`, según el
 * camino que haya tomado su servidor. Estas formas son las del SDK 0.11.3
 * (node_modules/@pollar/core/dist/index.mjs, `signAndSubmitTx` y
 * `_awaitTxConfirmation`) y la primera es la que Pollar guardó de verdad en sus
 * registros de la app para un `seal` sin saldo (19 de octubre de 2026).
 */
const FORMAS = {
  // La red rechazó la transacción: el código de resultado, repetido en details.
  rechazoDeLaRed: { status: "error", hash: "ab12", details: "txInsufficientBalance", resultCode: "txInsufficientBalance" },
  // Lo mismo, contado al terminar de esperar la confirmación, con el texto de Pollar.
  rechazoConTexto: {
    status: "error",
    hash: "ab12",
    details: "txInsufficientBalance",
    resultCode: "txInsufficientBalance",
    message: "Insufficient XLM to cover the network fee and minimum reserve. Fund the account with more XLM.",
  },
  // El servidor contestó con un error de API: el código, su texto y el motivo en details.
  errorDeApi: { status: "error", code: "TX_SUBMIT_FAILED", message: "Stellar rejected the transaction", details: "txInsufficientBalance" },
  // Un error de API que solo trae el texto.
  errorDeApiSoloTexto: { status: "error", code: "TX_SUBMIT_FAILED", message: "Insufficient XLM to cover the network fee and minimum reserve." },
  // Peor caso: el servidor no dice por qué.
  sinMotivo: { status: "error", code: "TX_SUBMIT_FAILED" },
} as const;

describe("mensajeDeRechazo", () => {
  it("el código de resultado va primero y no se repite", () => {
    expect(mensajeDeRechazo(FORMAS.rechazoDeLaRed)).toBe("txInsufficientBalance");
  });

  it("junta el código de API, su texto y el motivo, sin perder ninguno", () => {
    expect(mensajeDeRechazo(FORMAS.errorDeApi)).toBe("txInsufficientBalance · TX_SUBMIT_FAILED · Stellar rejected the transaction");
  });

  it("sin nada que decir, deja el aviso de siempre", () => {
    expect(mensajeDeRechazo({ status: "error" })).toBe("pollar-submit-failed");
    expect(mensajeDeRechazo({})).toBe("pollar-submit-failed");
  });

  it("ignora los campos vacíos", () => {
    expect(mensajeDeRechazo({ details: "", code: "X", message: "" })).toBe("X");
  });

  it("con cualquiera de las formas informativas, errorKey ve la falta de saldo", () => {
    for (const forma of [FORMAS.rechazoDeLaRed, FORMAS.rechazoConTexto, FORMAS.errorDeApi, FORMAS.errorDeApiSoloTexto]) {
      expect(errorKey(new Error(mensajeDeRechazo(forma)))).toBe("noFunds");
    }
  });

  it("y sin motivo no adivina: queda 'unknown'", () => {
    expect(errorKey(new Error(mensajeDeRechazo(FORMAS.sinMotivo)))).toBe("unknown");
  });
});

/**
 * La cuenta de Pollar de punta a punta, con el cliente del SDK reemplazado: lo que
 * lanza `signAndSubmit` es lo que después lee `errorKey`.
 */
const { proximo, za } = vi.hoisted(() => ({
  proximo: { valor: {} as Record<string, unknown> },
  /**
   * El estado del kit de Pollar para la zona de la sesión (issues 89 y 88): cómo contesta `ready()`, la cuenta, el paso
   * de la sesión y los que la escuchan. Cada prueba de abajo lo limpia en su `beforeEach`.
   */
  za: {
    ready: "ya" as "ya" | "nunca" | "tardia",
    /** Con "tardia": cuánto tarda el proveedor en contestar, desde la primera llamada a `ready()`. */
    readyTardaMs: 0,
    /** Como el kit: la misma promesa en cada llamada a `ready()`, para que el retomo la vea terminar aunque un
     * temporizador la perdió. */
    readyP: null as Promise<void> | null,
    wallet: null as { address: string } | null,
    paso: "idle" as string,
    verificada: false,
    token: "",
    oyentes: new Set<(s: unknown) => void>(),
  },
}));
vi.mock("@pollar/core", () => ({
  // Una sesión del SDK parece buena si trae su identificador: lo que mira `#marcaViva` (`wallet-pollar-sesion.test.ts`).
  isValidSession: (s: unknown) => typeof s === "object" && s !== null && "clientSessionId" in s,
  PollarClient: class {
    apiKeyHash = "huella";
    async signAndSubmitTx(): Promise<unknown> {
      return proximo.valor;
    }
    async signTx(): Promise<unknown> {
      return proximo.valor;
    }
    ready(): Promise<void> {
      if (za.ready === "nunca") return new Promise(() => undefined);
      if (za.ready !== "ya") {
        za.readyP ??= new Promise((r) => setTimeout(r, za.readyTardaMs));
        return za.readyP;
      }
      return Promise.resolve();
    }
    getWallet(): { address: string } | null {
      return za.wallet;
    }
    getAuthState(): { step: string; verified: boolean; session: { token: { accessToken: string } } } {
      return { step: za.paso, verified: za.verificada, session: { token: { accessToken: za.token } } };
    }
    onAuthStateChange(cb: (s: unknown) => void): () => void {
      za.oyentes.add(cb);
      return () => za.oyentes.delete(cb);
    }
    async logout(): Promise<void> {}
  },
}));

describe("PollarWallet.signAndSubmit", () => {
  beforeEach(() => vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "pub_testnet_prueba"));
  afterEach(() => vi.unstubAllEnvs());

  it("es una wallet que envía por su cuenta", () => {
    expect(submitsItself(pollarWallet)).toBe(true);
  });

  it("devuelve el hash cuando entró", async () => {
    proximo.valor = { status: "success", hash: "deadbeef" };
    await expect(pollarWallet.signAndSubmit("AAAA")).resolves.toBe("deadbeef");
  });

  it("también cuando la red todavía no confirma", async () => {
    proximo.valor = { status: "pending", hash: "deadbeef" };
    await expect(pollarWallet.signAndSubmit("AAAA")).resolves.toBe("deadbeef");
  });

  it.each(Object.entries(FORMAS).filter(([k]) => k !== "sinMotivo"))("%s: lanza con el motivo a la vista", async (_nombre, forma) => {
    proximo.valor = forma;
    const error = await pollarWallet.signAndSubmit("AAAA").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(errorKey(error)).toBe("noFunds");
  });

  it("sin motivo ni hash, lanza el aviso de siempre", async () => {
    proximo.valor = { status: "error" };
    await expect(pollarWallet.signAndSubmit("AAAA")).rejects.toThrow("pollar-submit-failed");
  });

  it("una co-firma pendiente puede entrar después: queda sin confirmar y no se reintenta a ciegas", async () => {
    for (const forma of [{ status: "cosign_pending" }, { status: "cosign_pending", hash: "deadbeef" }]) {
      proximo.valor = forma;
      const error = await pollarWallet.signAndSubmit("AAAA").then(
        () => null,
        (e: unknown) => e,
      );
      expect((error as Error).message).toBe("pollar-pending");
      expect(errorKey(error)).toBe("unconfirmed");
    }
  });
});

/* ------------------------------------------------------------------ el retomo paciente (issues 89 y 88) */

/** Una cuenta de Pollar de mentira y su token, para las pruebas de la zona de la sesión. */
const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const TOKEN = "tok-que-llega-tarde";

/** El módulo con el registro limpio: una instancia nueva por prueba, sin arrastrar el cliente de los describe de arriba. */
async function moduloDeLaSesion(): Promise<typeof import("./wallet-pollar")> {
  vi.resetModules();
  return import("./wallet-pollar");
}

/** El `localStorage` de la pestaña; devuelve el mapa, para mirar que la marca queda. */
function almacenDeLaSesion(datos: Record<string, string> = {}): Map<string, string> {
  const m = new Map(Object.entries(datos));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

/** Lo que se limpia en cada prueba de la zona de la sesión. */
function limpiarLaSesion(): void {
  za.ready = "ya";
  za.readyTardaMs = 0;
  za.readyP = null;
  za.wallet = null;
  za.paso = "idle";
  za.verificada = false;
  za.token = "";
  za.oyentes.clear();
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "pub_testnet_prueba");
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("el retomo paciente de la sesión de Google (issue 89)", () => {
  const MARCA = "tinkazo.pollar.intent";

  beforeEach(limpiarLaSesion);

  it("el proveedor contesta a los 10 segundos: la sesión se abre sola, sin otro toque, y la marca queda", async () => {
    vi.useFakeTimers();
    const datos = almacenDeLaSesion({ [MARCA]: "google" });
    za.ready = "tardia";
    za.readyTardaMs = 10_000;
    za.wallet = { address: DIR };
    const { pollarWallet, LISTO_MS, VENTANA_RETOMA_MS } = await moduloDeLaSesion();
    expect(VENTANA_RETOMA_MS).toBeGreaterThan(LISTO_MS + 2_000);
    let fin: string | null | undefined;
    void pollarWallet.restore().then((v) => (fin = v), () => undefined);
    // En los 8 primeros segundos el retomo no entrega "no hay cuenta": ahí sigue esperando (el de antes entregaba null).
    await vi.advanceTimersByTimeAsync(LISTO_MS + 100);
    expect(fin).toBeUndefined();
    // Y apenas contesta el proveedor, sale la cuenta.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fin).toBe(DIR);
    expect(pollarWallet.address).toBe(DIR);
    expect(datos.get(MARCA)).toBe("google");
  });

  it("el proveedor sigue afuera: sale con null solo al fin de la ventana paciente, y la marca queda", async () => {
    vi.useFakeTimers();
    const datos = almacenDeLaSesion({ [MARCA]: "google" });
    za.ready = "nunca";
    const { pollarWallet, LISTO_MS, VENTANA_RETOMA_MS } = await moduloDeLaSesion();
    let fin: string | null | undefined;
    void pollarWallet.restore().then((v) => (fin = v), () => undefined);
    // Al primer vencido (8 s) todavía no: el retomo sigue en pie (el de antes entregaba null acá).
    await vi.advanceTimersByTimeAsync(LISTO_MS + 100);
    expect(fin).toBeUndefined();
    // Al fin de la ventana, la salida honesta: null, con la marca en pie para que la próxima recarga lo intente.
    await vi.advanceTimersByTimeAsync(VENTANA_RETOMA_MS - LISTO_MS);
    expect(fin).toBeNull();
    expect(pollarWallet.hayMarca()).toBe(true);
    expect(datos.get(MARCA)).toBe("google");
  });

  it("avisa una sola vez que la primera mirada venció, a los 8 segundos, y sigue esperando hasta abrir la cuenta", async () => {
    vi.useFakeTimers();
    almacenDeLaSesion({ [MARCA]: "google" });
    za.ready = "tardia";
    za.readyTardaMs = 12_000;
    za.wallet = { address: DIR };
    const { pollarWallet, LISTO_MS } = await moduloDeLaSesion();
    const avisos: number[] = [];
    const t0 = Date.now();
    let fin: string | null | undefined;
    void pollarWallet.restore({ cuandoTarda: () => avisos.push(Date.now() - t0) }).then((v) => (fin = v), () => undefined);
    await vi.advanceTimersByTimeAsync(LISTO_MS - 100);
    expect(avisos, "antes de la primera mirada no hay aviso").toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toBeGreaterThanOrEqual(LISTO_MS);
    expect(avisos[0]).toBeLessThan(LISTO_MS + 500);
    expect(fin).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fin, "la cuenta llegó sola después del aviso").toBe(DIR);
    expect(avisos, "el aviso no se repite en las vueltas siguientes").toHaveLength(1);
  });

  it("si el proveedor contesta dentro de la primera mirada, no hay aviso", async () => {
    vi.useFakeTimers();
    almacenDeLaSesion({ [MARCA]: "google" });
    za.ready = "tardia";
    za.readyTardaMs = 3_000;
    za.wallet = { address: DIR };
    const { pollarWallet } = await moduloDeLaSesion();
    let avisos = 0;
    let fin: string | null | undefined;
    void pollarWallet.restore({ cuandoTarda: () => void avisos++ }).then((v) => (fin = v), () => undefined);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(fin).toBe(DIR);
    expect(avisos).toBe(0);
  });

  it("si el proveedor no contesta nunca, avisa una vez y entrega sin cuenta al fin de la ventana, con la marca en pie", async () => {
    vi.useFakeTimers();
    const datos = almacenDeLaSesion({ [MARCA]: "google" });
    za.ready = "nunca";
    const { pollarWallet, LISTO_MS, VENTANA_RETOMA_MS } = await moduloDeLaSesion();
    let avisos = 0;
    let fin: string | null | undefined;
    void pollarWallet.restore({ cuandoTarda: () => void avisos++ }).then((v) => (fin = v), () => undefined);
    await vi.advanceTimersByTimeAsync(LISTO_MS + 100);
    expect(avisos).toBe(1);
    await vi.advanceTimersByTimeAsync(VENTANA_RETOMA_MS);
    expect(fin).toBeNull();
    expect(avisos).toBe(1);
    expect(datos.get(MARCA)).toBe("google");
  });

  it("un aviso que falla no rompe la retoma", async () => {
    vi.useFakeTimers();
    almacenDeLaSesion({ [MARCA]: "google" });
    za.ready = "tardia";
    za.readyTardaMs = 10_000;
    za.wallet = { address: DIR };
    const { pollarWallet } = await moduloDeLaSesion();
    let fin: string | null | undefined;
    void pollarWallet
      .restore({
        cuandoTarda: () => {
          throw new Error("la pantalla no pudo soltarse");
        },
      })
      .then((v) => (fin = v), () => undefined);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(fin).toBe(DIR);
  });

  it("la sesión muerta de verdad se borra igual cuando el kit contesta enseguida (preservado)", async () => {
    const datos = almacenDeLaSesion({ [MARCA]: "google" });
    const { pollarWallet } = await moduloDeLaSesion();
    expect(await pollarWallet.restore()).toBeNull();
    expect(datos.has(MARCA)).toBe(false);
  });

  it("una sesión guardada que el kit todavía no mostró conserva la marca (preservado)", async () => {
    const datos = almacenDeLaSesion({ [MARCA]: "google", "pollar:huella:session": JSON.stringify({ clientSessionId: "abc" }) });
    const { pollarWallet } = await moduloDeLaSesion();
    expect(await pollarWallet.restore()).toBeNull();
    expect(datos.get(MARCA)).toBe("google");
  });
});

describe("el token de la sesión espera paciente al proveedor (issue 88)", () => {
  const MARCA = "tinkazo.pollar.intent";

  beforeEach(limpiarLaSesion);

  /**
   * Arma el cliente con una sesión guardada que el kit cree válida: retoma, no borra la marca y deja el cliente listo,
   * como al recargar la página de quien ya entró.
   */
  async function armado(): Promise<typeof import("./wallet-pollar")> {
    almacenDeLaSesion({ [MARCA]: "google", "pollar:huella:session": JSON.stringify({ clientSessionId: "abc" }) });
    const m = await moduloDeLaSesion();
    await m.pollarWallet.restore();
    return m;
  }

  /** El paso de la sesión, con la sesión abierta y sin verificar: lo que ve el token antes de que el proveedor conteste. */
  beforeEach(() => {
    za.paso = "authenticated";
    za.verificada = false;
  });

  it("el proveedor verifica a los 10 segundos: el token sale cuando llega, sin pedir entrar de nuevo", async () => {
    vi.useFakeTimers();
    const { pollarWallet, TOPE_TOKEN_MS, VENTANA_TOKEN_MS } = await armado();
    // La ventana sabe esperar al proveedor que verifica a los 10 segundos.
    expect(VENTANA_TOKEN_MS).toBeGreaterThanOrEqual(10_000);
    expect(VENTANA_TOKEN_MS).toBeGreaterThan(TOPE_TOKEN_MS);
    let fin: string | null | undefined;
    void pollarWallet.tokenDeSesion().then((v) => (fin = v), () => undefined);
    // Al primer vencido (8 s), todavía: el token sigue esperando (el de antes entregaba null acá).
    await vi.advanceTimersByTimeAsync(TOPE_TOKEN_MS + 100);
    expect(fin).toBeUndefined();
    // El proveedor verifica: el estado avisa y el token sale al toque.
    za.verificada = true;
    za.token = TOKEN;
    for (const cb of za.oyentes) cb({ step: "authenticated", verified: true, session: { token: { accessToken: TOKEN } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fin).toBe(TOKEN);
    // Ya no escucha.
    expect(za.oyentes.size).toBe(0);
  });

  it("el proveedor sigue sin verificar: sale null al fin de la ventana paciente, no al primer vencido, y la marca queda", async () => {
    vi.useFakeTimers();
    const { pollarWallet, TOPE_TOKEN_MS, VENTANA_TOKEN_MS } = await armado();
    let fin: string | null | undefined;
    void pollarWallet.tokenDeSesion().then((v) => (fin = v), () => undefined);
    await vi.advanceTimersByTimeAsync(TOPE_TOKEN_MS + 100);
    expect(fin).toBeUndefined();
    await vi.advanceTimersByTimeAsync(VENTANA_TOKEN_MS - TOPE_TOKEN_MS);
    expect(fin).toBeNull();
    expect(za.oyentes.size).toBe(0);
    // Un vencimiento nunca borra la marca de la sesión.
    expect(pollarWallet.hayMarca()).toBe(true);
  });

  it("si el kit dice que la sesión ya no existe, sale null al primer vencido: ahí sí queda ofrecer entrar de nuevo", async () => {
    vi.useFakeTimers();
    const { pollarWallet, TOPE_TOKEN_MS } = await armado();
    za.paso = "idle";
    const fin = pollarWallet.tokenDeSesion();
    await vi.advanceTimersByTimeAsync(TOPE_TOKEN_MS + 100);
    await expect(fin).resolves.toBeNull();
    expect(za.oyentes.size).toBe(0);
  });

  it("con la sesión verificada, el token de una (preservado)", async () => {
    const { pollarWallet } = await armado();
    za.verificada = true;
    za.token = TOKEN;
    await expect(pollarWallet.tokenDeSesion()).resolves.toBe(TOKEN);
  });

  it("quien pide su propio tope (la sala de campaña pide 20 s) espera lo suyo tal cual (preservado)", async () => {
    vi.useFakeTimers();
    const { pollarWallet } = await armado();
    const ESPERA_TOKEN_MS = 20_000;
    // Espera como mucho el tope que pidió: a los 19 todavía no contesta, y al tope sale null una sola vez.
    let fin: string | null | undefined;
    void pollarWallet.tokenDeSesion(ESPERA_TOKEN_MS).then((v) => (fin = v), () => undefined);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fin).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(fin).toBeNull();
  });
});

describe("PollarWallet.signUnsponsored (sellar pagando con la cuenta propia)", () => {
  beforeEach(() => vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "pub_testnet_prueba"));
  afterEach(() => vi.unstubAllEnvs());

  it("devuelve la transacción firmada", async () => {
    proximo.valor = { status: "signed", signedXdr: "FIRMADA" };
    await expect(pollarWallet.signUnsponsored("AAAA")).resolves.toBe("FIRMADA");
  });

  it("una co-firma pendiente queda sin confirmar, igual que al firmar y enviar: no se reintenta a ciegas", async () => {
    // Con la cuenta de Turnkey en mainnet, `signTx` también puede devolver `cosign_pending`. Si se lo toma por un fallo
    // cualquiera ("pollar-submit-failed", clave `unknown`), el sorteo lo reintenta y cada intento apila otra solicitud.
    for (const forma of [{ status: "cosign_pending" }, { status: "cosign_pending", request: { id: "r1", status: "PENDING" } }]) {
      proximo.valor = forma;
      const error = await pollarWallet.signUnsponsored("AAAA").then(
        () => null,
        (e: unknown) => e,
      );
      expect((error as Error).message).toBe("pollar-pending");
      expect(errorKey(error)).toBe("unconfirmed");
    }
  });

  it("un rechazo de verdad sigue diciendo por qué, y sin motivo deja el aviso de siempre", async () => {
    proximo.valor = { status: "error", code: "SDK_WALLET_RECOVERY_REQUIRED" };
    await expect(pollarWallet.signUnsponsored("AAAA")).rejects.toThrow("SDK_WALLET_RECOVERY_REQUIRED");
    proximo.valor = { status: "error" };
    await expect(pollarWallet.signUnsponsored("AAAA")).rejects.toThrow("pollar-submit-failed");
  });
});
