import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "./contract";
import { type FirmaPendiente, atenderFirmas, pollarWallet } from "./wallet-pollar";

/**
 * Pollar 0.12: cada firma pide confirmación (`confirmation: 'prompt'` por defecto) y, sin la interfaz de Pollar, el SDK
 * contesta `SDK_CONFIRMATION_UNAVAILABLE` a todas. La app se suscribe y confirma solo la firma que la persona acaba de
 * pedir con su botón. Estas pruebas usan un cliente que se comporta como el del SDK (node_modules/@pollar/core/dist/
 * index.mjs: `_confirm`, `_askUser`, `signAndSubmitTx`):
 *
 * - sin nadie suscrito, la firma falla con SDK_CONFIRMATION_UNAVAILABLE;
 * - con alguien suscrito, la firma queda esperando hasta que `confirm()` o `reject()` la resuelven, y el SDK vuelve a
 *   avisar con la lista cada vez que cambia;
 * - `reject()` termina la firma con SDK_CONFIRMATION_DECLINED.
 */

const hoisted = vi.hoisted(() => {
  type Pend = { id: string; kind: string; operation?: string; unsignedXdr?: string; confirm: () => void; reject: () => void };
  const estado = {
    oyentes: new Set<(p: Pend[]) => void>(),
    pendientes: new Map<string, Pend>(),
    contador: 0,
    /** Qué hace el SDK además de la firma pedida: otras confirmaciones que aparecen mientras se firma. */
    extras: [] as Array<{ kind: string; operation?: string; unsignedXdr?: string }>,
    /** Qué contesta el servidor una vez confirmada. */
    respuesta: { status: "success", hash: "deadbeef" } as Record<string, unknown>,
    /** Lo que se confirmó y se rechazó, en orden. */
    registro: [] as string[],
    recuperacion: { required: true, configured: false },
    llamadas: [] as string[],
    /** Cuántos clientes se armaron y con qué configuración. */
    construidos: 0,
    config: undefined as Record<string, unknown> | undefined,
  };
  const emitir = (): void => {
    const lista = [...estado.pendientes.values()];
    for (const cb of estado.oyentes) cb(lista);
  };
  const pedir = (input: { kind: string; operation?: string; unsignedXdr?: string }): Promise<{ ok: boolean; code?: string }> => {
    if (estado.oyentes.size === 0) return Promise.resolve({ ok: false, code: "SDK_CONFIRMATION_UNAVAILABLE" });
    const id = `c${++estado.contador}`;
    return new Promise((resolver) => {
      const resolverCon = (r: { ok: boolean; code?: string }, que: string) => () => {
        if (!estado.pendientes.delete(id)) return;
        estado.registro.push(`${que}:${input.kind}`);
        emitir();
        resolver(r);
      };
      estado.pendientes.set(id, { ...input, id, confirm: resolverCon({ ok: true }, "confirmada"), reject: resolverCon({ ok: false, code: "SDK_CONFIRMATION_DECLINED" }, "rechazada") });
      emitir();
    });
  };
  return { estado, pedir };
});

vi.mock("@pollar/core", () => ({
  PollarClient: class {
    constructor(config: Record<string, unknown>) {
      hoisted.estado.construidos++;
      hoisted.estado.config = config;
    }
    cosign = {
      recovery: {
        status: async () => ({ ...hoisted.estado.recuperacion }),
        addPasskey: async (o: { name: string }) => {
          hoisted.estado.llamadas.push(`addPasskey:${o.name}`);
          hoisted.estado.recuperacion.configured = true;
          return { ...hoisted.estado.recuperacion };
        },
        startEmail: async (mail: string) => {
          hoisted.estado.llamadas.push(`startEmail:${mail}`);
        },
        confirmEmail: async (code: string) => {
          hoisted.estado.llamadas.push(`confirmEmail:${code}`);
          hoisted.estado.recuperacion.configured = code === "123456";
          return { ...hoisted.estado.recuperacion };
        },
      },
    };
    onConfirmationRequest(cb: (p: unknown[]) => void): () => void {
      hoisted.estado.oyentes.add(cb as never);
      cb([...hoisted.estado.pendientes.values()]);
      return () => hoisted.estado.oyentes.delete(cb as never);
    }
    async logout(): Promise<void> {}
    async signAndSubmitTx(xdr: string): Promise<unknown> {
      // Las otras confirmaciones aparecen mientras la firma pedida espera.
      for (const extra of hoisted.estado.extras) void hoisted.pedir(extra);
      const r = await hoisted.pedir({ kind: "sign_and_send", unsignedXdr: xdr });
      if (!r.ok) return { status: "error", code: r.code, details: "the user declined the transaction" };
      return hoisted.estado.respuesta;
    }
    async signTx(xdr: string): Promise<unknown> {
      const r = await hoisted.pedir({ kind: "sign", unsignedXdr: xdr });
      if (!r.ok) return { status: "error", code: r.code };
      return { status: "signed", signedXdr: "FIRMADA" };
    }
  },
}));

const e = hoisted.estado;

beforeEach(() => {
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "pub_testnet_prueba");
  e.oyentes.clear();
  e.pendientes.clear();
  e.extras = [];
  e.registro = [];
  e.llamadas = [];
  e.construidos = 0;
  e.config = undefined;
  e.respuesta = { status: "success", hash: "deadbeef" };
  e.recuperacion = { required: true, configured: false };
});
afterEach(async () => {
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
});

describe("atenderFirmas: qué firma se confirma", () => {
  const firma = (p: Partial<FirmaPendiente> & { id: string }) => {
    const confirm = vi.fn();
    const reject = vi.fn();
    return { kind: "sign_and_send", confirm, reject, ...p } as FirmaPendiente & { confirm: typeof confirm; reject: typeof reject };
  };

  it("confirma la transacción que la persona acaba de pedir", () => {
    const f = firma({ id: "1", unsignedXdr: "AAAA" });
    atenderFirmas([f], new Set(["AAAA"]), new Set(), vi.fn());
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.reject).not.toHaveBeenCalled();
  });

  it("también la que firma sin enviar (sign)", () => {
    const f = firma({ id: "1", kind: "sign", unsignedXdr: "AAAA" });
    atenderFirmas([f], new Set(["AAAA"]), new Set(), vi.fn());
    expect(f.confirm).toHaveBeenCalledTimes(1);
  });

  it("rechaza y anota la que nadie pidió (no hay ninguna firma en curso)", () => {
    const f = firma({ id: "1", unsignedXdr: "AAAA" });
    const anotar = vi.fn();
    atenderFirmas([f], new Set(), new Set(), anotar);
    expect(f.reject).toHaveBeenCalledTimes(1);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(anotar).toHaveBeenCalledWith("nadie la pidió", { kind: "sign_and_send", operation: "" });
  });

  it("rechaza otra transacción aunque haya una firma en curso", () => {
    const f = firma({ id: "1", unsignedXdr: "BBBB" });
    atenderFirmas([f], new Set(["AAAA"]), new Set(), vi.fn());
    expect(f.reject).toHaveBeenCalledTimes(1);
    expect(f.confirm).not.toHaveBeenCalled();
  });

  it("rechaza la que no trae la transacción: sin verla no se sabe qué se firma", () => {
    const f = firma({ id: "1" });
    const anotar = vi.fn();
    atenderFirmas([f], new Set(["AAAA"]), new Set(), anotar);
    expect(f.reject).toHaveBeenCalledTimes(1);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(anotar).toHaveBeenCalledWith("no trae la transacción", { kind: "sign_and_send", operation: "" });
  });

  it("rechaza lo que el SDK arma por su cuenta (un pago, una línea de confianza), aunque haya una firma en curso", () => {
    const f = firma({ id: "1", kind: "build_sign_submit", operation: "change_trust" });
    const anotar = vi.fn();
    atenderFirmas([f], new Set(["AAAA"]), new Set(), anotar);
    expect(f.reject).toHaveBeenCalledTimes(1);
    expect(anotar.mock.calls[0]?.[1]).toEqual({ kind: "build_sign_submit", operation: "change_trust" });
  });

  it("no resuelve dos veces la misma: el SDK repite la lista entera cada vez que cambia", () => {
    const f = firma({ id: "1", unsignedXdr: "AAAA" });
    const atendidas = new Set<string>();
    atenderFirmas([f], new Set(["AAAA"]), atendidas, vi.fn());
    atenderFirmas([f], new Set(["AAAA"]), atendidas, vi.fn());
    expect(f.confirm).toHaveBeenCalledTimes(1);
  });

  it("lo que se anota no lleva la transacción ni la cuenta", () => {
    const f = firma({ id: "1", unsignedXdr: "BBBB", operation: "payment" });
    const anotar = vi.fn();
    atenderFirmas([f], new Set(["AAAA"]), new Set(), anotar);
    expect(JSON.stringify(anotar.mock.calls)).not.toContain("BBBB");
  });
});

describe("PollarWallet: la firma con el SDK 0.12", () => {
  it("confirma el sello que la persona pidió y devuelve el hash", async () => {
    await expect(pollarWallet.signAndSubmit("XDR-DEL-SELLO")).resolves.toBe("deadbeef");
    expect(e.registro).toEqual(["confirmada:sign_and_send"]);
  });

  it("confirma también el sello pagado con la cuenta propia (signUnsponsored)", async () => {
    await expect(pollarWallet.signUnsponsored("XDR-DEL-SELLO")).resolves.toBe("FIRMADA");
    expect(e.registro).toEqual(["confirmada:sign"]);
  });

  it("rechaza cualquier otra firma que llegue mientras se firma el sello, y el sello sale igual", async () => {
    e.extras = [{ kind: "build_sign_submit", operation: "change_trust" }, { kind: "sign", unsignedXdr: "OTRA-TRANSACCION" }];
    await expect(pollarWallet.signAndSubmit("XDR-DEL-SELLO")).resolves.toBe("deadbeef");
    expect(e.registro.sort()).toEqual(["confirmada:sign_and_send", "rechazada:build_sign_submit", "rechazada:sign"]);
  });

  it("una firma que aparece sin que la persona haya pedido nada se rechaza", async () => {
    await pollarWallet.signAndSubmit("XDR-DEL-SELLO");
    e.registro = [];
    void hoisted.pedir({ kind: "sign_and_send", unsignedXdr: "XDR-DEL-SELLO" });
    expect(e.registro).toEqual(["rechazada:sign_and_send"]);
  });

  it("fija la confirmación en 'prompt': con el panel en 'nunca preguntar' la lista blanca corre igual", async () => {
    await pollarWallet.signAndSubmit("XDR-DEL-SELLO");
    expect(e.config?.confirmation).toBe("prompt");
  });

  it("dos firmas a la vez arman un solo cliente y una sola suscripción", async () => {
    await Promise.all([pollarWallet.signAndSubmit("XDR-A"), pollarWallet.signUnsponsored("XDR-B")]);
    expect(e.construidos).toBe(1);
    expect(e.oyentes.size).toBe(1);
  });

  it("al desconectar se suelta la suscripción, y el cliente siguiente es nuevo", async () => {
    await pollarWallet.signAndSubmit("XDR-DEL-SELLO");
    await pollarWallet.disconnect();
    expect(e.oyentes.size).toBe(0);
    await pollarWallet.signAndSubmit("XDR-DEL-SELLO");
    expect(e.construidos).toBe(2);
  });

  it("después de firmar no queda nada armado: el mismo XDR ya no se confirma solo", async () => {
    await pollarWallet.signAndSubmit("XDR-DEL-SELLO");
    e.registro = [];
    void hoisted.pedir({ kind: "sign", unsignedXdr: "XDR-DEL-SELLO" });
    expect(e.registro).toEqual(["rechazada:sign"]);
  });
});

describe("PollarWallet: la cuenta pide una forma de recuperarla (SDK_WALLET_RECOVERY_REQUIRED)", () => {
  it("el sello falla con un error que la pantalla reconoce, y no con 'tu cuenta no tiene saldo'", async () => {
    e.respuesta = { status: "error", code: "SDK_WALLET_RECOVERY_REQUIRED", message: "Set up a way to recover this wallet first: a passkey, a second device or your email." };
    const error = await pollarWallet.signAndSubmit("XDR-DEL-SELLO").then(
      () => null,
      (x: unknown) => x,
    );
    expect(error).toBeInstanceOf(Error);
    expect(errorKey(error)).toBe("recoveryRequired");
  });

  it("dice cómo está la protección de la cuenta", async () => {
    await expect(pollarWallet.proteccion()).resolves.toEqual({ requerida: true, lista: false });
  });

  it("con el correo: manda el código y, con el bueno, la cuenta queda protegida", async () => {
    await pollarWallet.mandarCodigoDeProteccion("ana@ejemplo.com");
    await expect(pollarWallet.confirmarCodigoDeProteccion("000000")).resolves.toBe(false);
    await expect(pollarWallet.confirmarCodigoDeProteccion("123456")).resolves.toBe(true);
    expect(e.llamadas).toEqual(["startEmail:ana@ejemplo.com", "confirmEmail:000000", "confirmEmail:123456"]);
    await expect(pollarWallet.proteccion()).resolves.toEqual({ requerida: true, lista: true });
  });

  it("con el desbloqueo del aparato: la cuenta queda protegida", async () => {
    await expect(pollarWallet.protegerConPasskey()).resolves.toBe(true);
    expect(e.llamadas).toEqual(["addPasskey:Tinkazo"]);
  });
});
