import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_INVITADA, CLAVE_VENTANA } from "./invitada";
import { FRENO_DE_ENTRADA_MS, VENTANA_DE_REPETICION_MS, nombreParaLaPantalla, sesionDeGoogle } from "./sesion";

const CUENTA = `G${"A".repeat(55)}`;

/** La billetera de Google de mentira: lo que el módulo real expone y que usa `sesion.ts`. */
const h = vi.hoisted(() => ({
  billetera: {
    address: null as string | null,
    label: "Google",
    restore: vi.fn(),
    connect: vi.fn(),
    profile: vi.fn(),
    disconnect: vi.fn(),
    tokenDeSesion: vi.fn(),
  },
}));

vi.mock("../stellar/wallet-pollar", () => ({
  ENTRADA_BLOQUEADA: "popup-blocked",
  ENTRADA_CERRADA: "popup-closed",
  ENTRADA_SIN_SESION: "popup-nosession",
  pollarWallet: h.billetera,
}));

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

let local: Storage;
let pestana: Storage;
let reloj = 0;
/** Si el navegador tiene la marca de una entrada anterior con el proveedor: sin ella no hay sesión que retomar. */
let marca = true;

const nuevaSesion = () => sesionDeGoogle({ local, pestana, ahora: () => reloj, hayMarca: () => marca });

/** Lo que sale de `entrar`: la sesión, o el mensaje del error. */
async function intentar(s: ReturnType<typeof sesionDeGoogle>, avanzar = 0): Promise<unknown> {
  const resultado = s.entrar().then(
    (sesion) => sesion,
    (error: unknown) => (error instanceof Error ? error.message : "no era un error"),
  );
  await vi.advanceTimersByTimeAsync(avanzar);
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  local = almacenFalso();
  pestana = almacenFalso();
  reloj = 1_800_000_000_000;
  marca = true;
  h.billetera.address = null;
  h.billetera.label = "Google";
  h.billetera.restore.mockReset().mockResolvedValue(null);
  h.billetera.connect.mockReset().mockResolvedValue(CUENTA);
  h.billetera.profile.mockReset().mockReturnValue({ name: "Ana Pérez", mail: "ana@example.org" });
  h.billetera.disconnect.mockReset().mockResolvedValue(undefined);
  h.billetera.tokenDeSesion.mockReset().mockResolvedValue("tok");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nombreParaLaPantalla", () => {
  it("Juan Carlos Mamani Quispe da Juan Q.", () => {
    expect(nombreParaLaPantalla("Juan Carlos Mamani Quispe")).toBe("Juan Q.");
  });

  it("Ana da Ana", () => {
    expect(nombreParaLaPantalla("Ana")).toBe("Ana");
  });

  it("espacios de más dan ana P.", () => {
    expect(nombreParaLaPantalla("  ana   pérez ")).toBe("ana P.");
  });

  it("vacío da null", () => {
    expect(nombreParaLaPantalla("")).toBeNull();
  });

  it("solo espacios da null", () => {
    expect(nombreParaLaPantalla("   \t ")).toBeNull();
  });

  it("sin nombre da null", () => {
    expect(nombreParaLaPantalla(null)).toBeNull();
    expect(nombreParaLaPantalla(undefined)).toBeNull();
  });

  it("uno de 80 letras queda en 30", () => {
    expect(nombreParaLaPantalla("a".repeat(80))).toBe("a".repeat(30));
  });

  it("la inicial de la última palabra sale en mayúscula aunque la letra lleve tilde", () => {
    expect(nombreParaLaPantalla("Rosa épsilon")).toBe("Rosa É.");
  });

  it("un nombre con caracteres invisibles los pierde", () => {
    expect(nombreParaLaPantalla("An​a Pé⁠rez")).toBe("Ana P.");
  });
});

describe("entrar con Google", () => {
  it("pone la marca de invitada y la de la ventana antes de llamar a connect", async () => {
    let vistas: { invitada: string | null; ventana: string | null } | null = null;
    h.billetera.connect.mockImplementation(async () => {
      vistas = { invitada: local.getItem(CLAVE_INVITADA), ventana: pestana.getItem(CLAVE_VENTANA) };
      return CUENTA;
    });
    await intentar(nuevaSesion());
    expect(vistas).toEqual({
      invitada: String(reloj + 48 * 3_600_000),
      ventana: String(reloj + 10 * 60_000),
    });
  });

  it("al terminar bien suelta la marca de la ventana y deja la de invitada", async () => {
    await intentar(nuevaSesion());
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
    expect(local.getItem(CLAVE_INVITADA)).not.toBeNull();
  });

  it("suelta la marca de la ventana aunque connect falle", async () => {
    h.billetera.connect.mockRejectedValue(new Error("lo que sea"));
    await intentar(nuevaSesion());
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("devuelve la cuenta y el nombre corto del perfil", async () => {
    expect(await intentar(nuevaSesion())).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
  });

  it("popup-blocked da ventana", async () => {
    h.billetera.connect.mockRejectedValue(new Error("popup-blocked"));
    expect(await intentar(nuevaSesion())).toBe("ventana");
  });

  it("popup-closed da cerrada", async () => {
    h.billetera.connect.mockRejectedValue(new Error("popup-closed"));
    expect(await intentar(nuevaSesion())).toBe("cerrada");
  });

  it("otro error da google", async () => {
    h.billetera.connect.mockRejectedValue(new Error("popup-nosession"));
    expect(await intentar(nuevaSesion())).toBe("google");
  });

  it("un error a los 100 segundos da cuentas", async () => {
    h.billetera.connect.mockImplementation(async () => {
      reloj += 100_000;
      throw new Error("pollar-timeout");
    });
    expect(await intentar(nuevaSesion())).toBe("cuentas");
  });

  it("el error que sale no copia el mensaje del proveedor", async () => {
    h.billetera.connect.mockRejectedValue(new Error("fallo en https://proveedor.example.org con ana@example.org"));
    expect(await intentar(nuevaSesion())).toBe("google");
  });

  it("una cuenta que no es una G de 56 da google", async () => {
    h.billetera.connect.mockResolvedValue("no es una cuenta");
    expect(await intentar(nuevaSesion())).toBe("google");
  });

  it("sin nombre en el perfil espera 5 segundos y da null", async () => {
    h.billetera.profile.mockReturnValue({ name: "", mail: "ana@example.org" });
    expect(await intentar(nuevaSesion(), 5_100)).toEqual({ cuenta: CUENTA, nombre: null });
    expect(h.billetera.profile.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it("si el nombre llega a los 2 segundos lo usa", async () => {
    const llega = Date.now() + 2_000;
    h.billetera.profile.mockImplementation(() => ({ name: Date.now() >= llega ? "Beto Rojas" : "", mail: "b@example.org" }));
    expect(await intentar(nuevaSesion(), 2_600)).toEqual({ cuenta: CUENTA, nombre: "Beto R." });
  });

  it("con una sesión que ya está abierta en la página no llama a connect", async () => {
    h.billetera.address = CUENTA;
    expect(await intentar(nuevaSesion())).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(h.billetera.connect).not.toHaveBeenCalled();
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("con una sesión de correo abierta la cierra y entra con Google", async () => {
    h.billetera.address = CUENTA;
    h.billetera.label = "Email";
    await intentar(nuevaSesion());
    expect(h.billetera.disconnect).toHaveBeenCalledTimes(1);
    expect(h.billetera.connect).toHaveBeenCalledTimes(1);
  });

  it("dos entrar seguidos llaman una sola vez a connect y resuelven con la misma sesión", async () => {
    let terminar: (cuenta: string) => void = () => undefined;
    h.billetera.connect.mockImplementation(() => new Promise<string>((resolver) => {
      terminar = resolver;
    }));
    const s = nuevaSesion();
    const primera = s.entrar();
    const segunda = s.entrar();
    await vi.advanceTimersByTimeAsync(10);
    terminar(CUENTA);
    await vi.advanceTimersByTimeAsync(10);
    const [a, b] = await Promise.all([primera, segunda]);
    expect(h.billetera.connect).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("terminada una entrada se puede abrir otra", async () => {
    const s = nuevaSesion();
    await intentar(s);
    h.billetera.address = null;
    await intentar(s);
    expect(h.billetera.connect).toHaveBeenCalledTimes(2);
  });
});

describe("entrar con Google: el freno con el proveedor caído", () => {
  const cae = (): void => {
    h.billetera.connect.mockRejectedValue(new Error("popup-nosession"));
  };

  it("si la última entrada falló hace menos de 30 segundos, la nueva repite google sin llamar a connect", async () => {
    cae();
    const s = nuevaSesion();
    expect(await intentar(s)).toBe("google");
    reloj += FRENO_DE_ENTRADA_MS - 1;
    // Decir que la cuenta no se pudo crear sería falso: no se intentó nada.
    expect(await intentar(s)).toBe("google");
    expect(h.billetera.connect).toHaveBeenCalledTimes(1);
  });

  it("si la última entrada falló como cuentas, el freno también dice cuentas", async () => {
    h.billetera.connect.mockImplementation(async () => {
      reloj += 100_000;
      throw new Error("pollar-timeout");
    });
    const s = nuevaSesion();
    expect(await intentar(s)).toBe("cuentas");
    reloj += FRENO_DE_ENTRADA_MS - 1;
    expect(await intentar(s)).toBe("cuentas");
    expect(h.billetera.connect).toHaveBeenCalledTimes(1);
  });

  it("el freno no cuenta como una segunda falla de Google", async () => {
    cae();
    const s = nuevaSesion();
    await intentar(s);
    reloj += FRENO_DE_ENTRADA_MS - 1;
    await intentar(s);
    reloj += VENTANA_DE_REPETICION_MS;
    expect(await intentar(s)).toBe("google");
  });

  it("pasados los 30 segundos vuelve a llamar a connect", async () => {
    cae();
    const s = nuevaSesion();
    await intentar(s);
    reloj += FRENO_DE_ENTRADA_MS;
    await intentar(s);
    expect(h.billetera.connect).toHaveBeenCalledTimes(2);
  });

  it("una segunda falla de Google dentro de 2 minutos se dice como cuentas", async () => {
    cae();
    const s = nuevaSesion();
    expect(await intentar(s)).toBe("google");
    reloj += FRENO_DE_ENTRADA_MS + 1;
    expect(await intentar(s)).toBe("cuentas");
  });

  it("una falla de Google pasados los 2 minutos vuelve a decirse google", async () => {
    cae();
    const s = nuevaSesion();
    await intentar(s);
    reloj += VENTANA_DE_REPETICION_MS + 1;
    expect(await intentar(s)).toBe("google");
  });

  it("la ventana bloqueada y la cerrada nunca frenan", async () => {
    h.billetera.connect.mockRejectedValueOnce(new Error("popup-blocked")).mockRejectedValueOnce(new Error("popup-closed"));
    const s = nuevaSesion();
    expect(await intentar(s)).toBe("ventana");
    expect(await intentar(s)).toBe("cerrada");
    expect(h.billetera.connect).toHaveBeenCalledTimes(2);
  });

  it("una entrada lograda borra el freno", async () => {
    h.billetera.connect.mockRejectedValueOnce(new Error("popup-nosession")).mockResolvedValue(CUENTA);
    const s = nuevaSesion();
    await intentar(s);
    reloj += FRENO_DE_ENTRADA_MS;
    await intentar(s);
    h.billetera.address = null;
    h.billetera.connect.mockRejectedValueOnce(new Error("popup-nosession"));
    expect(await intentar(s)).toBe("google");
  });
});

describe("retomar", () => {
  it("sin marca del proveedor da null enseguida, sin bajar la billetera ni llamar a restore", async () => {
    marca = false;
    expect(await nuevaSesion().retomar()).toBeNull();
    expect(h.billetera.restore).not.toHaveBeenCalled();
  });

  it("si leer la marca falla da null y no lanza", async () => {
    const s = sesionDeGoogle({
      local,
      pestana,
      ahora: () => reloj,
      hayMarca: () => {
        throw new Error("sin almacenamiento");
      },
    });
    expect(await s.retomar()).toBeNull();
    expect(h.billetera.restore).not.toHaveBeenCalled();
  });

  it("sin sesión da null", async () => {
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toBeNull();
  });

  it("con una sesión que tarda más de 3 segundos da null", async () => {
    h.billetera.restore.mockImplementation(() => new Promise<string>((resolver) => setTimeout(() => resolver(CUENTA), 4_000)));
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(await resultado).toBeNull();
  });

  it("con una sesión de Google da la cuenta y el nombre corto", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
  });

  it("una cuenta que no es una G de 56 se toma como null", async () => {
    h.billetera.restore.mockResolvedValue("hola");
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toBeNull();
  });

  it("una sesión de correo da null y no se cierra: la cierra solo el toque en Entrar", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    h.billetera.label = "Email";
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toBeNull();
    expect(h.billetera.disconnect).not.toHaveBeenCalled();
  });

  it("si el toque en Entrar llega con la sesión todavía retomándose, la espera y no abre otra ventana", async () => {
    h.billetera.restore.mockImplementation(
      () => new Promise<string>((resolver) => {
        setTimeout(() => {
          h.billetera.address = CUENTA;
          resolver(CUENTA);
        }, 4_000);
      }),
    );
    const s = nuevaSesion();
    const retomada = s.retomar();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(await retomada).toBeNull();
    const sesion = intentar(s, 1_500);
    expect(await sesion).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(h.billetera.connect).not.toHaveBeenCalled();
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("si la sesión tarda más de 4 segundos en retomarse, el toque sigue y abre la ventana", async () => {
    h.billetera.restore.mockImplementation(() => new Promise<string>(() => undefined));
    const s = nuevaSesion();
    const retomada = s.retomar();
    await vi.advanceTimersByTimeAsync(3_100);
    await retomada;
    expect(await intentar(s, 4_100)).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(h.billetera.connect).toHaveBeenCalledTimes(1);
  });

  it("un error del proveedor da null", async () => {
    h.billetera.restore.mockRejectedValue(new Error("roto"));
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toBeNull();
  });
});

describe("token, sigueLaSesion y salir", () => {
  it("token llama a tokenDeSesion con 20.000", async () => {
    expect(await nuevaSesion().token()).toBe("tok");
    expect(h.billetera.tokenDeSesion).toHaveBeenCalledWith(20_000);
  });

  it("token da null si el proveedor falla", async () => {
    h.billetera.tokenDeSesion.mockRejectedValue(new Error("roto"));
    expect(await nuevaSesion().token()).toBeNull();
  });

  it("sigueLaSesion dice si la cuenta de la página es la pedida", async () => {
    h.billetera.address = CUENTA;
    expect(await nuevaSesion().sigueLaSesion(CUENTA)).toBe(true);
    expect(await nuevaSesion().sigueLaSesion(`G${"B".repeat(55)}`)).toBe(false);
  });

  it("salir cierra la sesión del proveedor", async () => {
    await nuevaSesion().salir();
    expect(h.billetera.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("si el módulo de Google no baja", () => {
  it("entrar da exactamente google, sin copiar el error del navegador", async () => {
    vi.doMock("../stellar/wallet-pollar", () => {
      throw new Error("Failed to fetch dynamically imported module: https://sitio.example.org/assets/archivo.js");
    });
    vi.resetModules();
    const { sesionDeGoogle: otra } = await import("./sesion");
    const s = otra({ local, pestana, ahora: () => reloj, hayMarca: () => true });
    expect(await intentar(s)).toBe("google");
    vi.doUnmock("../stellar/wallet-pollar");
  });
});
