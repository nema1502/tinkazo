import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que la tarjeta de confirmar el correo le pide a la sesión: el código va solo al correo del perfil de la sesión
 * verificada, y todo es de la cuenta que se pidió.
 */

const CUENTA = `G${"A".repeat(55)}`;
const OTRA = `G${"B".repeat(55)}`;

const billetera = vi.hoisted(() => ({
  address: "",
  tokenDeSesion: vi.fn(),
  profile: vi.fn(),
  mandarCodigoDeProteccion: vi.fn(),
  confirmarCorreoDelCelular: vi.fn(),
  protegerConPasskey: vi.fn(),
  alCambiarLaCuenta: vi.fn(),
  asegurarLaSesion: vi.fn(),
  sesionViva: vi.fn(),
  sesionPerdida: vi.fn(),
  esperarLaRetomada: vi.fn(),
}));
const puedeUsarDesbloqueo = vi.hoisted(() => vi.fn());

vi.mock("../stellar/wallet-pollar", () => ({ pollarWallet: billetera, puedeUsarDesbloqueo }));

const { accionesDeLaCuenta, laSesionEs, TOPE_DE_LA_COMPARACION_MS, TOPE_DE_LA_RENOVACION_MS } = await import("./sesion-confirmar");
const { SIN_RESPUESTA } = await import("../ui/proteger-cuenta");
const { clasificarFallaAlConfirmar, clasificarFallaAlMandar } = await import("./confirmar-estado");

beforeEach(() => {
  billetera.address = CUENTA;
  billetera.tokenDeSesion.mockReset().mockResolvedValue("token-de-prueba");
  billetera.profile.mockReset().mockReturnValue({ name: "Ana", mail: "ana@ejemplo.com", avatar: "" });
  billetera.mandarCodigoDeProteccion.mockReset().mockResolvedValue(undefined);
  billetera.confirmarCorreoDelCelular.mockReset();
  billetera.protegerConPasskey.mockReset().mockResolvedValue(true);
  billetera.alCambiarLaCuenta.mockReset().mockReturnValue(() => undefined);
  billetera.asegurarLaSesion.mockReset().mockResolvedValue(CUENTA);
  billetera.sesionViva.mockReset().mockReturnValue(true);
  billetera.sesionPerdida.mockReset().mockReturnValue(false);
  billetera.esperarLaRetomada.mockReset().mockResolvedValue(undefined);
  puedeUsarDesbloqueo.mockReset().mockResolvedValue(true);
});

describe("si la sesión del navegador es de la cuenta", () => {
  it("dice si la sesión que retoma es de la cuenta, de otra persona o ninguna", async () => {
    billetera.asegurarLaSesion.mockResolvedValue(CUENTA);
    expect(await laSesionEs(CUENTA)).toBe("si");
    billetera.asegurarLaSesion.mockResolvedValue(OTRA);
    expect(await laSesionEs(CUENTA)).toBe("otra");
    billetera.asegurarLaSesion.mockResolvedValue(null);
    expect(await laSesionEs(CUENTA)).toBe("no-se-sabe");
    billetera.asegurarLaSesion.mockRejectedValue(new Error("falla"));
    expect(await laSesionEs(CUENTA)).toBe("no-se-sabe");
  });

  it("si la sesión tarda en retomarse, pasado su tope no se sabe, pero antes espera lo que esté a medias", async () => {
    vi.useFakeTimers();
    try {
      billetera.asegurarLaSesion.mockReturnValue(new Promise(() => undefined));
      let terminar: () => void = () => undefined;
      billetera.esperarLaRetomada.mockReturnValue(new Promise<void>((r) => {
        terminar = r;
      }));
      let dicho: string | null = null;
      void laSesionEs(CUENTA).then((d) => {
        dicho = d;
      });
      await vi.advanceTimersByTimeAsync(TOPE_DE_LA_COMPARACION_MS - 1);
      expect(billetera.esperarLaRetomada).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      // Pasado el tope: se espera la renovación que esté en vuelo, con su propio tope, y recién después se sigue.
      expect(billetera.esperarLaRetomada).toHaveBeenCalledWith(TOPE_DE_LA_RENOVACION_MS);
      expect(dicho).toBeNull();
      terminar();
      await vi.advanceTimersByTimeAsync(0);
      expect(dicho).toBe("no-se-sabe");
    } finally {
      vi.useRealTimers();
    }
  });

  it("si la sesión contesta a tiempo no espera nada más", async () => {
    billetera.asegurarLaSesion.mockResolvedValue(OTRA);
    expect(await laSesionEs(CUENTA)).toBe("otra");
    expect(billetera.esperarLaRetomada).not.toHaveBeenCalled();
  });

  it("solo retoma la sesión: no pide el token ni manda nada", async () => {
    billetera.asegurarLaSesion.mockResolvedValue(CUENTA);
    await laSesionEs(CUENTA);
    expect(billetera.asegurarLaSesion).toHaveBeenCalledTimes(1);
    expect(billetera.tokenDeSesion).not.toHaveBeenCalled();
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
    expect(billetera.protegerConPasskey).not.toHaveBeenCalled();
  });
});

describe("mandar el código", () => {
  it("lo manda al correo del perfil de la sesión, y la función no recibe ningún correo", async () => {
    const acciones = await accionesDeLaCuenta(CUENTA);
    expect(acciones.mandarCodigo).toHaveLength(0);
    await acciones.mandarCodigo();
    expect(billetera.mandarCodigoDeProteccion).toHaveBeenCalledTimes(1);
    expect(billetera.mandarCodigoDeProteccion).toHaveBeenCalledWith("ana@ejemplo.com");
  });

  it("si la sesión se había soltado, la retoma antes de pedir el token, y recién ahí mira que sea la cuenta", async () => {
    const orden: string[] = [];
    billetera.address = "";
    billetera.asegurarLaSesion.mockImplementation(async () => {
      orden.push("retomar");
      billetera.address = CUENTA;
      return CUENTA;
    });
    billetera.tokenDeSesion.mockImplementation(async () => {
      orden.push("token");
      return "t";
    });
    await (await accionesDeLaCuenta(CUENTA)).mandarCodigo();
    expect(orden).toEqual(["retomar", "token"]);
    expect(billetera.mandarCodigoDeProteccion).toHaveBeenCalledWith("ana@ejemplo.com");
  });

  it("si al retomarla resulta que la sesión es de otra cuenta, no manda nada", async () => {
    billetera.address = "";
    billetera.asegurarLaSesion.mockImplementation(async () => {
      billetera.address = OTRA;
      return OTRA;
    });
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toThrow("sin-sesion");
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
  });

  it("espera la sesión verificada antes de leer el correo", async () => {
    const orden: string[] = [];
    billetera.tokenDeSesion.mockImplementation(async () => {
      orden.push("token");
      return "t";
    });
    billetera.profile.mockImplementation(() => {
      orden.push("perfil");
      return { name: "", mail: "ana@ejemplo.com", avatar: "" };
    });
    await (await accionesDeLaCuenta(CUENTA)).mandarCodigo();
    expect(orden).toEqual(["token", "perfil"]);
  });

  it("sin la sesión verificada no manda nada: si la sesión sigue guardada se puede repetir, y si se perdió no", async () => {
    billetera.tokenDeSesion.mockResolvedValue(null);
    // La verificación no llegó a tiempo (un límite, la red lenta): la tarjeta dice que tarda y deja probar de nuevo.
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toBe(SIN_RESPUESTA);
    billetera.sesionPerdida.mockReturnValue(true);
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toThrow("sin-sesion");
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
  });

  it("sin correo en el perfil no manda nada", async () => {
    billetera.profile.mockReturnValue({ name: "Ana", mail: "", avatar: "" });
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toThrow("sin-correo");
    billetera.profile.mockReturnValue(null);
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toThrow("sin-correo");
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
  });

  it("si la sesión pasó a otra cuenta no manda nada, ni antes ni después de esperar el token", async () => {
    billetera.address = OTRA;
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toThrow("sin-sesion");
    billetera.address = CUENTA;
    billetera.tokenDeSesion.mockImplementation(async () => {
      billetera.address = OTRA;
      return "t";
    });
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toThrow("sin-sesion");
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
  });

  it("con la sesión cerrada por el proveedor lo dice enseguida, sin esperar un token que no va a llegar", async () => {
    billetera.sesionViva.mockReturnValue(false);
    billetera.sesionPerdida.mockReturnValue(true);
    const acciones = await accionesDeLaCuenta(CUENTA);
    await expect(acciones.mandarCodigo()).rejects.toThrow("sin-sesion");
    await expect(acciones.confirmarCodigo("ABCD12345")).rejects.toThrow("sin-sesion");
    await expect(acciones.usarDesbloqueo()).rejects.toThrow("sin-sesion");
    expect(billetera.tokenDeSesion).not.toHaveBeenCalled();
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
    expect(billetera.confirmarCorreoDelCelular).not.toHaveBeenCalled();
    expect(billetera.protegerConPasskey).not.toHaveBeenCalled();
  });

  it("si la retomada no terminó a tiempo (todavía sin la cuenta), dice que tarda y la tarjeta se puede repetir", async () => {
    billetera.address = "";
    billetera.asegurarLaSesion.mockResolvedValue(null);
    billetera.sesionViva.mockReturnValue(false);
    const acciones = await accionesDeLaCuenta(CUENTA);
    const fallas: unknown[] = [];
    for (const accion of [() => acciones.mandarCodigo(), () => acciones.confirmarCodigo("ABCD12345"), () => acciones.usarDesbloqueo()]) {
      await accion().catch((e: unknown) => fallas.push(e));
    }
    expect(fallas).toEqual([SIN_RESPUESTA, SIN_RESPUESTA, SIN_RESPUESTA]);
    expect(clasificarFallaAlMandar(fallas[0])).toBe("tarda");
    expect(clasificarFallaAlConfirmar(fallas[1])).toBe("tarda");
    expect(billetera.tokenDeSesion).not.toHaveBeenCalled();
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
  });

  it("con la sesión guardada pero sin verificar todavía (un límite o la red), dice que tarda y no la da por perdida", async () => {
    billetera.sesionViva.mockReturnValue(false);
    const acciones = await accionesDeLaCuenta(CUENTA);
    await expect(acciones.mandarCodigo()).rejects.toBe(SIN_RESPUESTA);
    await expect(acciones.confirmarCodigo("ABCD12345")).rejects.toBe(SIN_RESPUESTA);
    expect(billetera.mandarCodigoDeProteccion).not.toHaveBeenCalled();
  });

  it("con la sesión viva sigue como siempre", async () => {
    billetera.sesionViva.mockReturnValue(true);
    await (await accionesDeLaCuenta(CUENTA)).mandarCodigo();
    expect(billetera.mandarCodigoDeProteccion).toHaveBeenCalledTimes(1);
  });

  it("deja salir el error del servicio tal cual, para entender por qué", async () => {
    const rechazo = Object.assign(new Error("SDK_COSIGN_NOT_CONFIGURED"), { code: "SDK_COSIGN_NOT_CONFIGURED" });
    billetera.mandarCodigoDeProteccion.mockRejectedValue(rechazo);
    await expect((await accionesDeLaCuenta(CUENTA)).mandarCodigo()).rejects.toBe(rechazo);
  });
});

describe("confirmar, el desbloqueo y los avisos", () => {
  it("confirma el correo con el código y devuelve cómo quedó la cuenta", async () => {
    const lectura = { estado: "lista", protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true, correoTapado: "a•••@ejemplo.com", limite: false };
    billetera.confirmarCorreoDelCelular.mockResolvedValue(lectura);
    expect(await (await accionesDeLaCuenta(CUENTA)).confirmarCodigo("ABCD12345")).toBe(lectura);
    expect(billetera.confirmarCorreoDelCelular).toHaveBeenCalledWith("ABCD12345");
  });

  it("no confirma ni usa el desbloqueo si la sesión es de otra cuenta", async () => {
    const acciones = await accionesDeLaCuenta(CUENTA);
    billetera.address = OTRA;
    await expect(acciones.confirmarCodigo("ABCD12345")).rejects.toThrow("sin-sesion");
    await expect(acciones.usarDesbloqueo()).rejects.toThrow("sin-sesion");
    expect(billetera.confirmarCorreoDelCelular).not.toHaveBeenCalled();
    expect(billetera.protegerConPasskey).not.toHaveBeenCalled();
  });

  it("usa el desbloqueo de este navegador y dice si quedó protegida", async () => {
    const acciones = await accionesDeLaCuenta(CUENTA);
    expect(await acciones.usarDesbloqueo()).toBe(true);
    billetera.protegerConPasskey.mockResolvedValue(false);
    expect(await acciones.usarDesbloqueo()).toBe(false);
  });

  it("pregunta al navegador si ofrece el desbloqueo y escucha los cambios de la cuenta", async () => {
    const acciones = await accionesDeLaCuenta(CUENTA);
    expect(await acciones.puedeDesbloqueo()).toBe(true);
    puedeUsarDesbloqueo.mockResolvedValue(false);
    expect(await acciones.puedeDesbloqueo()).toBe(false);
    const aviso = vi.fn();
    acciones.alCambiar(aviso);
    // Oír los cambios no retoma la sesión: la tarjeta puede estar a la vista sin que se haya pedido nada al proveedor.
    expect(billetera.alCambiarLaCuenta).toHaveBeenCalledWith(aviso, { armar: false });
  });
});
