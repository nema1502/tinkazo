import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "./contract";
import { USDC_MAINNET, USDC_TESTNET } from "./pagos";
import { type FirmaPendiente, type LineaPedida, atenderFirmas, pollarWallet, resultadoDeLaLinea } from "./wallet-pollar";

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
  type Pend = { id: string; kind: string; network?: string; operation?: string; unsignedXdr?: string; details?: Record<string, unknown>; confirm: () => void; reject: () => void };
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
    /** Lo que contesta el servidor a la línea, una vez confirmada. */
    respuestaLinea: { status: "success" } as Record<string, unknown>,
    /** Los `details` que el SDK pone en la confirmación de la línea (por defecto, los de la línea pedida). */
    detallesLinea: null as Record<string, unknown> | null,
    /** El catálogo de Pollar y las co-firmas que esperan (en memoria del kit y en el servidor). */
    activos: { step: "idle" } as Record<string, unknown>,
    cofirmasEnMemoria: [] as Array<Record<string, unknown>>,
    cofirmas: [] as Array<Record<string, unknown>> | "falla",
  };
  const emitir = (): void => {
    const lista = [...estado.pendientes.values()];
    for (const cb of estado.oyentes) cb(lista);
  };
  const pedir = (input: { kind: string; network?: string; operation?: string; unsignedXdr?: string; details?: Record<string, unknown> }): Promise<{ ok: boolean; code?: string }> => {
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
      pending: async () => {
        hoisted.estado.llamadas.push("cosign.pending");
        if (hoisted.estado.cofirmas === "falla") throw new Error("sin red");
        return hoisted.estado.cofirmas;
      },
    };
    /** Como el SDK 0.12.0 (`setTrustline`, cuenta interna): pide la confirmación y, confirmada, la manda. */
    async setTrustline(asset: { code: string; issuer: string }, opts?: unknown): Promise<unknown> {
      hoisted.estado.llamadas.push(`setTrustline:${asset.code}:${asset.issuer}:${JSON.stringify(opts ?? null)}`);
      const details = hoisted.estado.detallesLinea ?? { asset: { type: "credit_alphanum4", code: asset.code, issuer: asset.issuer } };
      const r = await hoisted.pedir({ kind: "build_sign_submit", network: "STELLAR", operation: "change_trust", details });
      if (!r.ok) return { status: "error", code: r.code };
      return hoisted.estado.respuestaLinea;
    }
    async refreshAssets(): Promise<void> {
      hoisted.estado.llamadas.push("refreshAssets");
    }
    getEnabledAssetsState(): unknown {
      return hoisted.estado.activos;
    }
    getCosignState(): unknown {
      return { pending: hoisted.estado.cofirmasEnMemoria };
    }
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
  e.respuestaLinea = { status: "success" };
  e.detallesLinea = null;
  e.activos = { step: "idle" };
  e.cofirmasEnMemoria = [];
  e.cofirmas = [];
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

/* ------------------------------------------------ la línea del USDC (Activar dólares digitales) */

const EMISOR = USDC_TESTNET.issuer;
const lineaUsdc = (veces = 1): LineaPedida => {
  let quedan = veces;
  return { code: "USDC", issuer: EMISOR, tomar: () => quedan-- > 0 };
};
const confirmacion = (p: Partial<FirmaPendiente> & { id: string }) => {
  const confirm = vi.fn();
  const reject = vi.fn();
  return {
    kind: "build_sign_submit",
    network: "STELLAR",
    operation: "change_trust",
    details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR } },
    confirm,
    reject,
    ...p,
  } as FirmaPendiente & { confirm: typeof confirm; reject: typeof reject };
};

describe("atenderFirmas: la rama angosta de la línea del USDC de Circle", () => {
  it("confirma la línea que la persona acaba de pedir, aunque no haya ninguna transacción en curso", () => {
    const f = confirmacion({ id: "1" });
    atenderFirmas([f], new Set(), new Set(), vi.fn(), lineaUsdc());
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.reject).not.toHaveBeenCalled();
  });

  const malas: Array<[string, Partial<FirmaPendiente>]> = [
    ["el emisor de la otra red", { details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: USDC_MAINNET.issuer } } }],
    ["otro código", { details: { asset: { type: "credit_alphanum4", code: "USDT", issuer: EMISOR } } }],
    ["un código largo", { details: { asset: { type: "credit_alphanum12", code: "USDC", issuer: EMISOR } } }],
    ["con un límite", { details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR }, limit: "1000" } }],
    ["con límite cero, que la cerraría", { details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR }, limit: "0" } }],
    ["una clave de más en details", { details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR }, extra: 1 } }],
    ["una clave de más en el activo", { details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR, limit: "5" } } }],
    ["sin details", { details: undefined }],
    ["con una transacción armada", { unsignedXdr: "AAAA" }],
    ["en otra cadena", { network: "POLYGON" }],
    ["sin decir la cadena", { network: undefined }],
    ["una firma común con change_trust", { kind: "sign" }],
    ["otra operación", { operation: "payment" }],
  ];

  it.each(malas)("rechaza la que no es exactamente la pedida: %s", (_, cambio) => {
    const f = confirmacion({ id: "1", ...cambio });
    const anotar = vi.fn();
    atenderFirmas([f], new Set(), new Set(), anotar, lineaUsdc());
    expect(f.reject).toHaveBeenCalledTimes(1);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(anotar).toHaveBeenCalledTimes(1);
  });

  it("sin la línea pedida (lo de siempre), la línea se rechaza", () => {
    const f = confirmacion({ id: "1" });
    atenderFirmas([f], new Set(["AAAA"]), new Set(), vi.fn());
    expect(f.reject).toHaveBeenCalledTimes(1);
  });

  it("una segunda en el mismo toque se rechaza", () => {
    const a = confirmacion({ id: "1" });
    const b = confirmacion({ id: "2" });
    atenderFirmas([a, b], new Set(), new Set(), vi.fn(), lineaUsdc());
    expect(a.confirm).toHaveBeenCalledTimes(1);
    expect(b.reject).toHaveBeenCalledTimes(1);
    expect(b.confirm).not.toHaveBeenCalled();
  });

  it("una mala primero no gasta el toque: la buena que llega después se confirma", () => {
    const mala = confirmacion({ id: "1", details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: USDC_MAINNET.issuer } } });
    const buena = confirmacion({ id: "2" });
    const linea = lineaUsdc();
    const atendidas = new Set<string>();
    atenderFirmas([mala], new Set(), atendidas, vi.fn(), linea);
    atenderFirmas([mala, buena], new Set(), atendidas, vi.fn(), linea);
    expect(mala.reject).toHaveBeenCalledTimes(1);
    expect(buena.confirm).toHaveBeenCalledTimes(1);
  });

  it("con la línea pedida, el sello en curso se sigue confirmando igual y lo demás se sigue rechazando", () => {
    const sello = { id: "s", kind: "sign_and_send", unsignedXdr: "AAAA", confirm: vi.fn(), reject: vi.fn() } as FirmaPendiente & { confirm: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> };
    const otra = { id: "o", kind: "sign", unsignedXdr: "BBBB", confirm: vi.fn(), reject: vi.fn() } as FirmaPendiente & { confirm: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> };
    atenderFirmas([sello, otra], new Set(["AAAA"]), new Set(), vi.fn(), lineaUsdc());
    expect(sello.confirm).toHaveBeenCalledTimes(1);
    expect(otra.reject).toHaveBeenCalledTimes(1);
  });
});

describe("la forma del kit: lo que pide setTrustline sigue siendo lo que la rama angosta espera", () => {
  it("node_modules/@pollar/core pide build_sign_submit en Stellar, change_trust y details con el activo", () => {
    const kit = readFileSync(resolve(process.cwd(), "node_modules/@pollar/core/dist/index.mjs"), "utf8");
    const i = kit.indexOf("async setTrustline(");
    expect(i).toBeGreaterThan(0);
    const cuerpo = kit.slice(i, i + 2500);
    expect(cuerpo).toMatch(/const changeTrustParams = \{\s*asset: \{\s*type: [^,]+,\s*code: [^,]+,\s*issuer: [^}]+\}\s*,\s*\.\.\.limit !== void 0 && \{ limit \}\s*\}/);
    expect(cuerpo).toMatch(/this\._confirm\(\{\s*kind: "build_sign_submit",\s*network: "STELLAR",\s*operation: "change_trust",\s*details: changeTrustParams\s*\}\)/);
  });
});

describe("PollarWallet: Activar dólares digitales con Google (activarUsdc)", () => {
  beforeEach(() => vi.stubEnv("VITE_RAMPA", "recibir"));

  it("con la bandera apagada no arma el cliente ni llama a nada", async () => {
    vi.stubEnv("VITE_RAMPA", "");
    await expect(pollarWallet.activarUsdc()).resolves.toBe("apagada");
    await expect(pollarWallet.catalogoUsdc()).resolves.toBeNull();
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBeNull();
    expect(e.construidos).toBe(0);
    expect(e.llamadas).toEqual([]);
  });

  it("pide la línea del USDC de Circle de la red, sin límite ni saltear el patrocinio, y la confirma", async () => {
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(e.llamadas).toEqual([`setTrustline:USDC:${EMISOR}:null`]);
    expect(e.registro).toEqual(["confirmada:build_sign_submit"]);
  });

  it("confirma solo mientras dura la llamada: después, la misma línea se rechaza", async () => {
    await pollarWallet.activarUsdc();
    e.registro = [];
    void hoisted.pedir({ kind: "build_sign_submit", network: "STELLAR", operation: "change_trust", details: { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR } } });
    expect(e.registro).toEqual(["rechazada:build_sign_submit"]);
  });

  it("si el SDK pide otra cosa que la línea exacta, la puerta la rechaza y no sale", async () => {
    e.detallesLinea = { asset: { type: "credit_alphanum4", code: "USDC", issuer: EMISOR }, limit: "0" };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(e.registro).toEqual(["rechazada:build_sign_submit"]);
  });

  it("dos toques seguidos piden una sola línea", async () => {
    const [a, b] = await Promise.all([pollarWallet.activarUsdc(), pollarWallet.activarUsdc()]);
    expect([a, b].sort()).toEqual(["en-curso", "hecho"]);
    expect(e.llamadas.filter((x) => x.startsWith("setTrustline"))).toHaveLength(1);
  });

  it("cada respuesta del kit da lo suyo", async () => {
    e.respuestaLinea = { status: "cosign_pending", request: { id: "r1" } };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("en-curso");
    e.respuestaLinea = { status: "error", code: "SDK_CREDITS_INSUFFICIENT" };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("ahora-no");
  });

  it("resultadoDeLaLinea: cada caso de la tabla", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resultadoDeLaLinea({ status: "success" })).toBe("hecho");
    expect(resultadoDeLaLinea({ status: "pending" })).toBe("hecho");
    expect(resultadoDeLaLinea({ status: "cosign_pending" })).toBe("en-curso");
    expect(resultadoDeLaLinea({ status: "error", code: "TX_LOW_RESERVE" })).toBe("no-patrocina");
    expect(resultadoDeLaLinea({ status: "error", code: "SDK_CREDITS_INSUFFICIENT" })).toBe("ahora-no");
    expect(resultadoDeLaLinea({ status: "error", code: "SDK_WALLET_NOT_READY" })).toBe("cuenta-creandose");
    expect(resultadoDeLaLinea({ status: "error", code: "SDK_WALLET_RECOVERY_REQUIRED" })).toBe("proteger");
    expect(resultadoDeLaLinea({ status: "error", code: "SDK_CONFIRMATION_DECLINED" })).toBe("no-salio");
    expect(resultadoDeLaLinea({ status: "error", details: "algo raro" })).toBe("no-salio");
    expect(resultadoDeLaLinea({})).toBe("no-salio");
    warn.mockRestore();
  });

  it("catalogoUsdc: patrocinada solo si el catálogo de Pollar dice que la app la paga", async () => {
    const con = (assets: unknown[]) => ({ step: "loaded", data: { publicKey: "G", network: "testnet", exists: true, assets } });
    e.activos = con([{ code: "USDC", issuer: EMISOR, chain: "STELLAR", sponsored: true }]);
    await expect(pollarWallet.catalogoUsdc()).resolves.toBe("patrocinada");
    expect(e.llamadas).toContain("refreshAssets");
    e.activos = con([{ code: "USDC", issuer: EMISOR, sponsored: false }]);
    await expect(pollarWallet.catalogoUsdc()).resolves.toBe("no-patrocinada");
    e.activos = con([{ code: "USDC", issuer: USDC_MAINNET.issuer, sponsored: true }]);
    await expect(pollarWallet.catalogoUsdc()).resolves.toBe("no-patrocinada");
    e.activos = { step: "error", message: "sin red" };
    await expect(pollarWallet.catalogoUsdc()).resolves.toBeNull();
  });

  it("pendienteDeActivacion: true solo con un pedido de la línea esperando; leer no aprueba nada", async () => {
    e.cofirmas = [{ id: "r1", status: "PENDING", operation: "change_trust" }];
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(true);
    e.cofirmas = [{ id: "r2", status: "PENDING", operation: "payment" }, { id: "r3", status: "COMPLETED", operation: "change_trust" }];
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(false);
    // Lo que el kit ya tiene en memoria alcanza: no se vuelve a preguntar.
    e.llamadas = [];
    e.cofirmasEnMemoria = [{ id: "r1", status: "PENDING", operation: "change_trust" }];
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(true);
    expect(e.llamadas).not.toContain("cosign.pending");
    e.cofirmasEnMemoria = [];
    e.cofirmas = "falla";
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBeNull();
    expect(e.registro).toEqual([]);
  });
});
