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
    cuentaDelCelular: vi.fn(),
    segundosDeLimite: vi.fn(),
    asegurarLaSesion: vi.fn(),
    soltarElCliente: vi.fn(),
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
  h.billetera.cuentaDelCelular.mockReset().mockResolvedValue({ estado: "lista" });
  h.billetera.segundosDeLimite.mockReset().mockReturnValue(null);
  h.billetera.asegurarLaSesion.mockReset().mockResolvedValue(CUENTA);
  h.billetera.soltarElCliente.mockReset().mockReturnValue(true);
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

  it("suelta la marca de la ventana apenas Google se abre, aunque connect siga esperando, y deja la de invitada", async () => {
    let termina: (cuenta: string) => void = () => undefined;
    let vistas: { ventana: string | null; invitada: string | null } | null = null;
    h.billetera.connect.mockImplementation((avisos?: { alAbrirLaVentana?: () => void }) => new Promise<string>((resolver) => {
      termina = resolver;
      avisos?.alAbrirLaVentana?.();
      vistas = { ventana: pestana.getItem(CLAVE_VENTANA), invitada: local.getItem(CLAVE_INVITADA) };
    }));
    const resultado = intentar(nuevaSesion());
    await vi.advanceTimersByTimeAsync(0);
    expect(vistas).toEqual({ ventana: null, invitada: String(reloj + 48 * 3_600_000) });
    termina(CUENTA);
    await resultado;
  });

  it("al cargar la página sin sesión que retomar no se pone ninguna marca", async () => {
    const s = nuevaSesion();
    await s.retomar();
    expect(local.getItem(CLAVE_INVITADA)).toBeNull();
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("al retomar una sesión de Google renueva la marca de invitada y no pone la de la ventana", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    await resultado;
    expect(local.getItem(CLAVE_INVITADA)).toBe(String(reloj + 48 * 3_600_000));
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("al retomar una sesión de correo no pone la marca de invitada", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    h.billetera.label = "Email";
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    await resultado;
    expect(local.getItem(CLAVE_INVITADA)).toBeNull();
  });

  it("con una marca vieja a punto de vencer, retomar la corre otras 48 horas", async () => {
    local.setItem(CLAVE_INVITADA, String(reloj + 1_000));
    h.billetera.restore.mockResolvedValue(CUENTA);
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    await resultado;
    expect(local.getItem(CLAVE_INVITADA)).toBe(String(reloj + 48 * 3_600_000));
  });

  it("renovar vuelve a poner la marca de invitada por 48 horas desde ahora", () => {
    local.setItem(CLAVE_INVITADA, String(reloj + 1_000));
    reloj += 3_600_000;
    nuevaSesion().renovar();
    expect(local.getItem(CLAVE_INVITADA)).toBe(String(reloj + 48 * 3_600_000));
  });

  it("si la página se va antes de que Google se abra, suelta la marca de la ventana y deja de avisar al terminar", async () => {
    let soltarAlIrse: () => void = () => undefined;
    const dejaDeAvisar = vi.fn();
    let termina: (cuenta: string) => void = () => undefined;
    h.billetera.connect.mockImplementation(() => new Promise<string>((resolver) => {
      termina = resolver;
    }));
    const s = sesionDeGoogle({
      local,
      pestana,
      ahora: () => reloj,
      hayMarca: () => marca,
      alIrse: (soltar) => {
        soltarAlIrse = soltar;
        return dejaDeAvisar;
      },
    });
    const resultado = intentar(s);
    await vi.advanceTimersByTimeAsync(0);
    expect(pestana.getItem(CLAVE_VENTANA)).not.toBeNull();
    soltarAlIrse();
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
    termina(CUENTA);
    await resultado;
    expect(dejaDeAvisar).toHaveBeenCalledTimes(1);
  });

  it("después de que Google contesta no queda ninguna marca de la ventana", async () => {
    await intentar(nuevaSesion());
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
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

  it("con una sesión de Google ya abierta renueva la marca de invitada aunque no llame a connect", async () => {
    h.billetera.address = CUENTA;
    local.setItem(CLAVE_INVITADA, String(reloj + 1_000));
    await intentar(nuevaSesion());
    expect(h.billetera.connect).not.toHaveBeenCalled();
    expect(local.getItem(CLAVE_INVITADA)).toBe(String(reloj + 48 * 3_600_000));
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

/** Lo que sale de `entrar` cuando falla: el mensaje y los segundos que lleva el error del límite, si los lleva. */
async function intentarConSegundos(s: ReturnType<typeof sesionDeGoogle>): Promise<{ mensaje: string; segundos: unknown }> {
  try {
    await s.entrar();
    return { mensaje: "entró", segundos: undefined };
  } catch (error) {
    return { mensaje: (error as Error).message, segundos: (error as { segundos?: unknown }).segundos };
  }
}

describe("entrar con Google: el límite del servicio de cuentas", () => {
  it("con el límite vigente no abre la ventana ni llama a connect: dice limite con los segundos que faltan", async () => {
    h.billetera.segundosDeLimite.mockReturnValue(30);
    const s = nuevaSesion();
    expect(await intentarConSegundos(s)).toEqual({ mensaje: "limite", segundos: 30 });
    expect(h.billetera.connect).not.toHaveBeenCalled();
    // Ninguna marca: no hubo ventana de Google, y la persona sigue sin cuenta.
    expect(pestana.getItem(CLAVE_VENTANA)).toBeNull();
    expect(local.getItem(CLAVE_INVITADA)).toBeNull();
  });

  it("con una sesión que ya está abierta entra igual: no hace falta pedirle nada al proveedor", async () => {
    h.billetera.segundosDeLimite.mockReturnValue(30);
    h.billetera.address = CUENTA;
    expect(await intentar(nuevaSesion())).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(h.billetera.connect).not.toHaveBeenCalled();
  });

  it("si el límite aparece mientras Google se abre y la entrada falla, se dice como límite y no como falla de Google", async () => {
    h.billetera.connect.mockImplementation(async () => {
      h.billetera.segundosDeLimite.mockReturnValue(20);
      throw new Error("popup-nosession");
    });
    expect(await intentarConSegundos(nuevaSesion())).toEqual({ mensaje: "limite", segundos: 20 });
  });

  it("no cuenta para el freno de 30 segundos ni para la regla de la segunda falla", async () => {
    h.billetera.connect.mockImplementationOnce(async () => {
      h.billetera.segundosDeLimite.mockReturnValue(20);
      throw new Error("popup-nosession");
    });
    const s = nuevaSesion();
    expect((await intentarConSegundos(s)).mensaje).toBe("limite");
    // Se libera el límite: la persona vuelve a tocar Entrar enseguida y se llama a connect de nuevo, sin freno.
    h.billetera.segundosDeLimite.mockReturnValue(null);
    h.billetera.connect.mockRejectedValueOnce(new Error("popup-nosession"));
    expect(await intentar(s)).toBe("google");
    expect(h.billetera.connect).toHaveBeenCalledTimes(2);
    // Y esa falla es la primera de Google, no la segunda: no se dice que la cuenta no se pudo crear.
  });

  it("una ventana bloqueada o cerrada por la persona se dice como es, aunque haya un límite", async () => {
    h.billetera.connect.mockImplementationOnce(async () => {
      h.billetera.segundosDeLimite.mockReturnValue(20);
      throw new Error("popup-closed");
    });
    expect((await intentarConSegundos(nuevaSesion())).mensaje).toBe("cerrada");
  });

  it("segundosDeLimite de la sesión dice lo que ve la billetera", async () => {
    expect(await nuevaSesion().segundosDeLimite?.()).toBeNull();
    h.billetera.segundosDeLimite.mockReturnValue(12);
    expect(await nuevaSesion().segundosDeLimite?.()).toBe(12);
  });
});

describe("soltar la sesión del proveedor y volver a armarla", () => {
  it("soltar suelta el cliente sin cerrar la sesión", async () => {
    await nuevaSesion().soltar?.();
    expect(h.billetera.soltarElCliente).toHaveBeenCalledTimes(1);
    expect(h.billetera.disconnect).not.toHaveBeenCalled();
  });

  it("el token vuelve a armar la sesión antes de pedirlo", async () => {
    const orden: string[] = [];
    h.billetera.asegurarLaSesion.mockImplementation(async () => {
      orden.push("asegurar");
      return CUENTA;
    });
    h.billetera.tokenDeSesion.mockImplementation(async () => {
      orden.push("token");
      return "tok";
    });
    expect(await nuevaSesion().token()).toBe("tok");
    expect(orden).toEqual(["asegurar", "token"]);
  });

  it("la lectura de la cuenta vuelve a armar la sesión antes de leer", async () => {
    const orden: string[] = [];
    h.billetera.asegurarLaSesion.mockImplementation(async () => {
      orden.push("asegurar");
      return CUENTA;
    });
    h.billetera.cuentaDelCelular.mockImplementation(async () => {
      orden.push("leer");
      return { estado: "lista" };
    });
    await nuevaSesion().estadoDeLaCuenta?.();
    expect(orden).toEqual(["asegurar", "leer"]);
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

  it("si la sesión tarda más de un segundo en retomarse, el toque sigue y abre la ventana sin perder el gesto", async () => {
    h.billetera.restore.mockImplementation(() => new Promise<string>(() => undefined));
    const s = nuevaSesion();
    const retomada = s.retomar();
    await vi.advanceTimersByTimeAsync(3_100);
    await retomada;
    expect(await intentar(s, 1_100)).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
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

describe("el nombre que llega tarde", () => {
  /** El perfil de mentira: sin nombre hasta `llegaA` milisegundos después de ahora, y con él desde entonces. */
  function perfilQueLlegaA(llegaA: number): void {
    const desde = Date.now();
    h.billetera.profile.mockImplementation(() => ({ name: Date.now() - desde >= llegaA ? "Ana Pérez" : "", mail: "ana@example.org" }));
  }

  it("si el perfil llega a los 1,5 segundos lo espera y lo da, sin pasarse de los 3", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    perfilQueLlegaA(1_500);
    const inicio = Date.now();
    const resultado = nuevaSesion().retomar();
    let termino: number | null = null;
    void resultado.then(() => {
      termino = Date.now() - inicio;
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(termino).not.toBeNull();
    expect(termino ?? 0).toBeGreaterThanOrEqual(1_500);
    expect(termino ?? 9_999).toBeLessThan(1_800);
  });

  it("si el perfil llega a los 4 segundos da la cuenta sin nombre a los 3, y nombreTardio lo trae", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    perfilQueLlegaA(4_000);
    const s = nuevaSesion();
    const inicio = Date.now();
    const resultado = s.retomar();
    let termino: number | null = null;
    void resultado.then(() => {
      termino = Date.now() - inicio;
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: null });
    expect(termino).toBe(3_000);
    // La sesión se verifica con el perfil: el token llega a los 4 segundos y recién ahí el nombre existe.
    h.billetera.tokenDeSesion.mockImplementation(async () => {
      await new Promise<void>((resolver) => setTimeout(resolver, 1_000));
      return "tok";
    });
    const tardio = s.nombreTardio();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await tardio).toBe("Ana P.");
    expect(h.billetera.tokenDeSesion).toHaveBeenCalledWith(20_000);
  });

  it("una cuenta de Google sin nombre da null a los 3 segundos y nombreTardio también", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    h.billetera.profile.mockReturnValue({ name: "", mail: "ana@example.org" });
    const s = nuevaSesion();
    const resultado = s.retomar();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: null });
    expect(await s.nombreTardio()).toBeNull();
  });

  it("nunca pasa de los 3 segundos, ni siquiera con la sesión llegando a los 2,9", async () => {
    h.billetera.restore.mockImplementation(() => new Promise<string>((resolver) => setTimeout(() => resolver(CUENTA), 2_900)));
    h.billetera.profile.mockReturnValue({ name: "", mail: "ana@example.org" });
    const resultado = nuevaSesion().retomar();
    let listo = false;
    void resultado.then(() => {
      listo = true;
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(listo).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: null });
  });

  it("si el nombre ya está, retomar contesta enseguida y no deja relojes colgados", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(10);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("si el perfil llega después de esperar, tampoco quedan relojes colgados", async () => {
    h.billetera.restore.mockResolvedValue(CUENTA);
    perfilQueLlegaA(600);
    const resultado = nuevaSesion().retomar();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await resultado).toEqual({ cuenta: CUENTA, nombre: "Ana P." });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("nombreTardio con el nombre ya a la vista no pide el token", async () => {
    expect(await nuevaSesion().nombreTardio()).toBe("Ana P.");
    expect(h.billetera.tokenDeSesion).not.toHaveBeenCalled();
  });

  it("nombreTardio sin sesión verificada da null y no lanza", async () => {
    h.billetera.profile.mockReturnValue({ name: "", mail: "ana@example.org" });
    h.billetera.tokenDeSesion.mockResolvedValue(null);
    expect(await nuevaSesion().nombreTardio()).toBeNull();
    h.billetera.tokenDeSesion.mockRejectedValue(new Error("roto"));
    expect(await nuevaSesion().nombreTardio()).toBeNull();
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

describe("laSesionEs", () => {
  const sesionConLaBilletera = async () => {
    vi.doMock("../stellar/wallet-pollar", () => ({ ENTRADA_BLOQUEADA: "popup-blocked", ENTRADA_CERRADA: "popup-closed", ENTRADA_SIN_SESION: "popup-nosession", pollarWallet: h.billetera }));
    vi.resetModules();
    const { sesionDeGoogle: otra } = await import("./sesion");
    return otra({ local, pestana, ahora: () => reloj, hayMarca: () => true });
  };
  const OTRA_CUENTA = `G${"B".repeat(55)}`;

  it("la sesión la ofrece (con lo que se baja a pedido) y da lo que dice la billetera", async () => {
    const s = await sesionConLaBilletera();
    expect(typeof s.laSesionEs).toBe("function");
    h.billetera.asegurarLaSesion.mockResolvedValue(CUENTA);
    expect(await s.laSesionEs?.(CUENTA)).toBe("si");
    h.billetera.asegurarLaSesion.mockResolvedValue(OTRA_CUENTA);
    expect(await s.laSesionEs?.(CUENTA)).toBe("otra");
    expect(h.billetera.tokenDeSesion).not.toHaveBeenCalled();
    expect(h.billetera.connect).not.toHaveBeenCalled();
  });
});

describe("estadoDeLaCuenta", () => {
  /** La prueba de arriba desarma el mock del módulo: acá se arma de nuevo, con la misma billetera de mentira. */
  const sesionConLaBilletera = async () => {
    vi.doMock("../stellar/wallet-pollar", () => ({ ENTRADA_BLOQUEADA: "popup-blocked", ENTRADA_CERRADA: "popup-closed", ENTRADA_SIN_SESION: "popup-nosession", pollarWallet: h.billetera }));
    vi.resetModules();
    const { sesionDeGoogle: otra } = await import("./sesion");
    return otra({ local, pestana, ahora: () => reloj, hayMarca: () => true });
  };

  it("devuelve lo que lee la billetera, sin pedir la sesión ni el token", async () => {
    const lectura = { estado: "falta", protegida: false, correoDeLaSesionConfirmado: false, puedeMandar: true, correoTapado: "a•••@example.org", limite: false };
    h.billetera.cuentaDelCelular.mockResolvedValue(lectura);
    expect(await (await sesionConLaBilletera()).estadoDeLaCuenta?.()).toEqual(lectura);
    expect(h.billetera.tokenDeSesion).not.toHaveBeenCalled();
    expect(h.billetera.connect).not.toHaveBeenCalled();
    expect(h.billetera.restore).not.toHaveBeenCalled();
  });

  it("con la cuenta de la página se la pasa a la billetera: la sesión de otra persona no se le atribuye", async () => {
    h.billetera.cuentaDelCelular.mockResolvedValue({ estado: "lista" });
    await (await sesionConLaBilletera()).estadoDeLaCuenta?.(CUENTA);
    expect(h.billetera.cuentaDelCelular).toHaveBeenCalledWith(undefined, CUENTA);
  });

  it("si la lectura falla no lanza y dice que no se sabe", async () => {
    h.billetera.cuentaDelCelular.mockRejectedValue(new Error("falla"));
    expect(await (await sesionConLaBilletera()).estadoDeLaCuenta?.()).toMatchObject({ estado: "no-se-sabe", correoTapado: null, limite: false });
  });
});
