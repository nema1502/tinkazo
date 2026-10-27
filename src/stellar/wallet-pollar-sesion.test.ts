import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entrar con Google y retomar la sesión, con el cliente del SDK reemplazado (26 de octubre de 2026).
 *
 * Reporte del 26 de octubre: "Entrar con Google a veces lleva al sorteo sin pasar por Pollar". El diagnóstico encontró tres causas, y
 * estas pruebas cuidan las tres: (1) la marca de una sesión que ya no existe quedaba para siempre y cada carga repetía
 * ocho segundos de "Retomando…", (2) el correo se mostraba como si fuera el nombre, y (3) si el navegador bloqueaba la
 * ventana de Google, la pantalla quedaba "Conectando…" sin decir nada.
 */

interface Config {
  openAuthUrl?: (ctx: { provider: "google"; getUrl: () => Promise<string | null>; redirectUri: string; signal: AbortSignal }) => void | Promise<void>;
}

const h = vi.hoisted(() => ({
  config: null as null | Record<string, unknown>,
  cliente: null as null | Record<string, unknown>,
  /** Cómo contesta `ready()`: ya, o nunca. */
  ready: "ya" as "ya" | "nunca",
  /** Lo que lee `getWallet()` al arrancar. */
  billetera: null as null | { address: string },
  /** Lo que hace `login()` en la prueba. */
  alLogin: null as null | ((c: Record<string, unknown>) => void),
  perfil: null as null | { first_name?: string; last_name?: string; mail: string; avatar: string },
}));

vi.mock("@pollar/core", () => ({
  PollarClient: class {
    apiKeyHash = "huella";
    wallet: { address: string } | null = h.billetera;
    oyentes = new Set<(s: { step: string }) => void>();
    cancelLogin = vi.fn();
    constructor(config: Record<string, unknown>) {
      h.config = config;
      h.cliente = this as unknown as Record<string, unknown>;
    }
    ready(): Promise<void> {
      return h.ready === "ya" ? Promise.resolve() : new Promise<void>(() => undefined);
    }
    getWallet(): { address: string } | null {
      return this.wallet;
    }
    onAuthStateChange(fn: (s: { step: string }) => void): () => void {
      this.oyentes.add(fn);
      return () => this.oyentes.delete(fn);
    }
    getUserProfile(): unknown {
      return h.perfil;
    }
    login(): void {
      h.alLogin?.(this as unknown as Record<string, unknown>);
    }
    async logout(): Promise<void> {}
  },
  // Una sesión del SDK parece buena si trae su identificador: lo único que esta prueba necesita.
  isValidSession: (s: unknown) => typeof s === "object" && s !== null && "clientSessionId" in s,
}));

const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

/** El `localStorage` de la pestaña. */
function almacen(datos: Record<string, string> = {}): Map<string, string> {
  const m = new Map(Object.entries(datos));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

async function modulo() {
  vi.resetModules();
  return import("./wallet-pollar");
}

beforeEach(() => {
  h.config = null;
  h.cliente = null;
  h.ready = "ya";
  h.billetera = null;
  h.alLogin = null;
  h.perfil = null;
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "pub_testnet_prueba");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("la marca de Pollar, ¿sigue valiendo?", () => {
  it("con una cuenta, siempre", async () => {
    const { marcaViva } = await modulo();
    expect(marcaViva({ listo: true, hayCuenta: true, guardada: null, esValida: () => false })).toBe(true);
  });

  it("sin saber (el SDK no terminó de leer), no se toca", async () => {
    const { marcaViva } = await modulo();
    expect(marcaViva({ listo: false, hayCuenta: false, guardada: null, esValida: () => false })).toBe(true);
  });

  it("con el SDK listo y sin ninguna sesión guardada, la marca es de una sesión que ya no existe", async () => {
    const { marcaViva } = await modulo();
    expect(marcaViva({ listo: true, hayCuenta: false, guardada: null, esValida: () => true })).toBe(false);
  });

  it("con una sesión guardada que parece buena (se está renovando, o no hay red), la marca vale", async () => {
    const { marcaViva } = await modulo();
    expect(marcaViva({ listo: true, hayCuenta: false, guardada: JSON.stringify({ clientSessionId: "x" }), esValida: () => true })).toBe(true);
  });

  it("con una sesión rota o ilegible, no", async () => {
    const { marcaViva } = await modulo();
    expect(marcaViva({ listo: true, hayCuenta: false, guardada: JSON.stringify({}), esValida: () => false })).toBe(false);
    expect(marcaViva({ listo: true, hayCuenta: false, guardada: "{no es json", esValida: () => true })).toBe(false);
  });
});

describe("retomar la sesión al cargar", () => {
  it("sin marca no hay nada que retomar, y ni siquiera se arma el cliente", async () => {
    almacen();
    const { pollarWallet } = await modulo();
    expect(await pollarWallet.restore()).toBeNull();
    expect(h.cliente).toBeNull();
  });

  it("con la marca y la cuenta viva, devuelve la dirección y deja la marca", async () => {
    const datos = almacen({ "tinkazo.pollar.intent": "google" });
    h.billetera = { address: DIR };
    const { pollarWallet } = await modulo();
    expect(await pollarWallet.restore()).toBe(DIR);
    expect(datos.get("tinkazo.pollar.intent")).toBe("google");
    expect(pollarWallet.label).toBe("Google");
  });

  it("una marca de correo se retoma como correo", async () => {
    almacen({ "tinkazo.pollar.intent": "email" });
    h.billetera = { address: DIR };
    const { pollarWallet } = await modulo();
    await pollarWallet.restore();
    expect(pollarWallet.label).toBe("Email");
  });

  it("la marca vieja, de una sesión que ya no existe, se borra y no se esperan ocho segundos", async () => {
    const datos = almacen({ "tinkazo.pollar.intent": "google" });
    const { pollarWallet } = await modulo();
    const t0 = Date.now();
    expect(await pollarWallet.restore()).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(datos.has("tinkazo.pollar.intent")).toBe(false);
  });

  it("¿queda la marca? Lo mira la herramienta para olvidar también la de \"sesión de Google guardada\"", async () => {
    const datos = almacen({ "tinkazo.pollar.intent": "google" });
    const { pollarWallet } = await modulo();
    expect(pollarWallet.hayMarca()).toBe(true);
    await pollarWallet.restore();
    expect(pollarWallet.hayMarca()).toBe(false);
    expect(datos.has("tinkazo.pollar.intent")).toBe(false);
  });

  it("la marca de antes del correo (un '1') también se borra si no hay sesión", async () => {
    const datos = almacen({ "tinkazo.pollar.intent": "1" });
    const { pollarWallet } = await modulo();
    expect(await pollarWallet.restore()).toBeNull();
    expect(datos.has("tinkazo.pollar.intent")).toBe(false);
  });

  it("una sesión guardada rota también la deja morir", async () => {
    const datos = almacen({ "tinkazo.pollar.intent": "google", "pollar:huella:session": JSON.stringify({ basura: 1 }) });
    const { pollarWallet } = await modulo();
    expect(await pollarWallet.restore()).toBeNull();
    expect(datos.has("tinkazo.pollar.intent")).toBe(false);
  });

  it("una sesión guardada buena que el SDK todavía no muestra (renovándose, sin red) conserva la marca", async () => {
    const datos = almacen({ "tinkazo.pollar.intent": "google", "pollar:huella:session": JSON.stringify({ clientSessionId: "abc" }) });
    const { pollarWallet } = await modulo();
    expect(await pollarWallet.restore()).toBeNull();
    expect(datos.get("tinkazo.pollar.intent")).toBe("google");
  });

  it("si el SDK no termina de leer en ocho segundos, se sigue sin cuenta y la marca queda", async () => {
    vi.useFakeTimers();
    const datos = almacen({ "tinkazo.pollar.intent": "google" });
    h.ready = "nunca";
    const { pollarWallet, LISTO_MS } = await modulo();
    const r = pollarWallet.restore();
    await vi.advanceTimersByTimeAsync(LISTO_MS + 100);
    expect(await r).toBeNull();
    expect(datos.get("tinkazo.pollar.intent")).toBe("google");
  });
});

describe("el perfil: el correo no es un nombre", () => {
  it("con nombre y apellido, el nombre; el correo va aparte", async () => {
    almacen({ "tinkazo.pollar.intent": "google" });
    h.billetera = { address: DIR };
    h.perfil = { first_name: "Lucía", last_name: "Flores", mail: "lucia@gmail.com", avatar: "https://x/a.png" };
    const { pollarWallet } = await modulo();
    await pollarWallet.restore();
    expect(pollarWallet.profile()).toEqual({ name: "Lucía Flores", mail: "lucia@gmail.com", avatar: "https://x/a.png" });
  });

  it("sin nombre (una cuenta de correo), el nombre queda vacío y no es el correo", async () => {
    almacen({ "tinkazo.pollar.intent": "email" });
    h.billetera = { address: DIR };
    h.perfil = { mail: "lucia@gmail.com", avatar: "" };
    const { pollarWallet } = await modulo();
    await pollarWallet.restore();
    expect(pollarWallet.profile()).toEqual({ name: "", mail: "lucia@gmail.com", avatar: "" });
  });

  it("antes de que llegue el perfil (tras recargar llega tarde), no hay perfil", async () => {
    almacen({ "tinkazo.pollar.intent": "google" });
    h.billetera = { address: DIR };
    const { pollarWallet } = await modulo();
    await pollarWallet.restore();
    expect(pollarWallet.profile()).toBeNull();
  });
});

describe("entrar con Google", () => {
  /** El SDK, al hacer `login()`, llama al abridor de ventanas que se le dio, igual que el de verdad. */
  const alLoginAbre = (c: Record<string, unknown>): void => {
    void (h.config as Config).openAuthUrl?.({ provider: "google", getUrl: async () => "https://pollar.example/auth", redirectUri: "https://tinkazo.app", signal: new AbortController().signal });
    void c;
  };

  /** Una ventana de mentira que el navegador sí deja abrir. */
  function ventanaQueAbre() {
    const ventana = { closed: false, opener: {} as unknown, location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.fn(() => ventana);
    vi.stubGlobal("window", { open, setInterval, clearInterval, setTimeout, clearTimeout });
    return { ventana, open };
  }

  it("abre una ventana en blanco en el mismo toque y después la lleva a la dirección de Pollar", async () => {
    almacen();
    const { ventana, open } = ventanaQueAbre();
    h.alLogin = (c) => {
      alLoginAbre(c);
      setTimeout(() => {
        (c as unknown as { wallet: { address: string } }).wallet = { address: DIR };
        for (const f of (c as unknown as { oyentes: Set<(s: { step: string }) => void> }).oyentes) f({ step: "authenticated" });
      }, 20);
    };
    const { pollarWallet } = await modulo();
    expect(await pollarWallet.connect()).toBe(DIR);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(ventana.location.href).toBe("https://pollar.example/auth");
    expect(ventana.opener).toBeNull();
  });

  it("si el navegador bloquea la ventana, la entrada se corta al instante y dice por qué", async () => {
    almacen();
    vi.stubGlobal("window", { open: vi.fn(() => null), setInterval, clearInterval, setTimeout, clearTimeout });
    h.alLogin = alLoginAbre;
    const { pollarWallet, ENTRADA_BLOQUEADA } = await modulo();
    const t0 = Date.now();
    await expect(pollarWallet.connect()).rejects.toThrow(ENTRADA_BLOQUEADA);
    expect(Date.now() - t0).toBeLessThan(2_000);
    // Y el SDK deja de esperar una ventana que no está.
    expect((h.cliente as unknown as { cancelLogin: ReturnType<typeof vi.fn> }).cancelLogin).toHaveBeenCalledTimes(1);
  });

  it("si Pollar no puede armar la entrada (no hay dirección, o falla pedirla), la ventana en blanco se cierra y se corta ya, con su motivo", async () => {
    for (const getUrl of [async () => null, async () => Promise.reject(new Error("sin red"))] as Array<() => Promise<string | null>>) {
      almacen();
      const { ventana } = ventanaQueAbre();
      h.alLogin = () => void (h.config as Config).openAuthUrl?.({ provider: "google", getUrl, redirectUri: "https://tinkazo.app", signal: new AbortController().signal });
      const { pollarWallet, ENTRADA_SIN_SESION } = await modulo();
      const t0 = Date.now();
      // No se espera a que alguien "cierre" una ventana que se cerró sola: eso diría que la cerró la persona.
      await expect(pollarWallet.connect()).rejects.toThrow(ENTRADA_SIN_SESION);
      expect(Date.now() - t0).toBeLessThan(2_000);
      expect(ventana.close).toHaveBeenCalledTimes(1);
      expect((h.cliente as unknown as { cancelLogin: ReturnType<typeof vi.fn> }).cancelLogin).toHaveBeenCalledTimes(1);
    }
  });

  it("si la persona cierra la ventana sin entrar, tras un respiro se corta y se puede volver a intentar", async () => {
    vi.useFakeTimers();
    almacen();
    const { ventana } = ventanaQueAbre();
    h.alLogin = alLoginAbre;
    const { pollarWallet, ENTRADA_CERRADA, GRACIA_CIERRE_MS } = await modulo();
    const r = pollarWallet.connect().then(
      () => "entró",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(300);
    ventana.closed = true;
    // Al cerrarse sola tras entrar el SDK se entera enseguida: antes del respiro no se corta.
    await vi.advanceTimersByTimeAsync(GRACIA_CIERRE_MS - 1_000);
    expect((h.cliente as unknown as { cancelLogin: ReturnType<typeof vi.fn> }).cancelLogin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await r).toBe(ENTRADA_CERRADA);
    expect((h.cliente as unknown as { cancelLogin: ReturnType<typeof vi.fn> }).cancelLogin).toHaveBeenCalledTimes(1);
  });

  it("si la ventana se cierra sola porque la entrada terminó, entra y no se corta nada", async () => {
    vi.useFakeTimers();
    almacen();
    const { ventana } = ventanaQueAbre();
    h.alLogin = (c) => {
      alLoginAbre(c);
      // La ventana se cierra y un par de segundos después el SDK se entera de que la cuenta está lista.
      setTimeout(() => (ventana.closed = true), 500);
      setTimeout(() => {
        (c as unknown as { wallet: { address: string } }).wallet = { address: DIR };
        for (const f of (c as unknown as { oyentes: Set<(s: { step: string }) => void> }).oyentes) f({ step: "authenticated" });
      }, 2_500);
    };
    const { pollarWallet } = await modulo();
    const r = pollarWallet.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await r).toBe(DIR);
    expect((h.cliente as unknown as { cancelLogin: ReturnType<typeof vi.fn> }).cancelLogin).not.toHaveBeenCalled();
  });
});

describe("bajar el SDK con la página quieta", () => {
  it("con Pollar configurado lo baja, y sin la llave no hace nada", async () => {
    const { precargarSdk } = await modulo();
    expect(() => precargarSdk()).not.toThrow();
    vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "");
    const sin = await modulo();
    expect(() => sin.precargarSdk()).not.toThrow();
  });
});
