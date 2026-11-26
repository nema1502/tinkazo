import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, Keypair, Networks, Operation, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { CosignRequest } from "@pollar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * `activarCuenta` con topes propios del sitio: ningún paso de antes del voto puede quedarse esperando para siempre, un
 * intento vencido no vuelve a pedir, importar ni votar, el candado entre pestañas se pide con espera corta, y un voto
 * que ya salió sigue por detrás sin que nadie lo repita. Relojes simulados y el cliente de mentira de `pollar-falso.ts`.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());
/** Un gancho que corre justo al armar el cliente, para que una prueba mueva la hora en medio de esa espera. */
const gancho = vi.hoisted(() => ({ alArmar: null as (() => void) | null }));

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  const Base = clienteFalso(h);
  const PollarClient = function (config: Record<string, unknown>) {
    const cliente = new Base(config);
    gancho.alArmar?.();
    return cliente;
  } as unknown as typeof Base;
  return {
    ...real,
    PollarClient,
    recognizedSetupRequest: (r: CosignRequest) => (h.impl.recognizedSetupRequest ? h.impl.recognizedSetupRequest(r) : real.recognizedSetupRequest(r)),
  };
});

const { pollarWallet, MARCAS_DE_LA_CUENTA, ACTIVACION_LENTA, TOPES_DE_ACTIVACION } = await import("./wallet-pollar");
// Las cargas de módulos usan entrada y salida de verdad, no el reloj simulado: se hacen antes, así ningún paso las espera.
await import("@pollar/core");
await import("@stellar/stellar-sdk");
const kit = await vi.importActual<typeof import("@pollar/core")>("@pollar/core");
const kitReal = new kit.CosignManager({
  api: {} as never,
  keyManager: {} as never,
  logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
  networkPassphrase: () => Networks.PUBLIC,
  onRequest: () => undefined,
});

const patrocinador = Keypair.random();
// Una cuenta nueva por prueba: un voto que quedó colgado en una prueba no es el de la siguiente.
let P = Keypair.random().publicKey();
const Q = Keypair.random().publicKey();
const SUB = "sub-org-de-ana";

function buena(cuenta: string = P): Transaction {
  const b = new TransactionBuilder(new Account(patrocinador.publicKey(), "1"), { fee: "300", networkPassphrase: Networks.PUBLIC });
  b.addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: cuenta }));
  b.addOperation(Operation.createAccount({ destination: cuenta, startingBalance: "0" }));
  b.addOperation(Operation.endSponsoringFutureReserves({ source: cuenta }));
  const tx = b.setTimeout(300).build();
  tx.sign(patrocinador);
  return tx;
}

type Pedido = Record<string, unknown> & { id: string };
function pedidoDe(tx: Transaction, cambios: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-1",
    kind: "TX",
    network: "STELLAR",
    status: "PENDING",
    intent: "account_create",
    operation: "create_account",
    account: P,
    signWith: P,
    appPaysFee: true,
    refreshable: true,
    unsignedPayload: tx.toXDR(),
    payloadHash: Buffer.from(tx.hash()).toString("hex"),
    activityId: null,
    subOrgId: SUB,
    createdAt: "2026-11-10T23:30:00.000Z",
    expiresAt: "2026-11-11T23:30:00.000Z",
    ...cambios,
  };
}
const aprobado = (p: Pedido, extra: Partial<Pedido> = {}): Pedido => ({ ...p, status: "APPROVED", activityId: "actividad-1", submit: { hash: "abc", status: "SUCCESS" }, ...extra });

let pedido: Pedido;
let refrescado: Pedido | null;

const votos = (): string | null => sessionStorage.getItem(MARCAS_DE_LA_CUENTA.votos);
const llamadasDeCofirma = (): string[] => h.llamadas.filter((n) => !["ready", "getCosignState", "logout"].includes(n));
const vecesQue = (nombre: string): number => h.llamadas.filter((n) => n === nombre).length;
const consola = (): string => vi.mocked(console.warn).mock.calls.flat().join(" ");

/** Lo que pasó con una promesa, sin esperarla. */
function observar<T>(p: Promise<T>): { listo: boolean; valor?: T; error?: Error } {
  const o: { listo: boolean; valor?: T; error?: Error } = { listo: false };
  p.then(
    (v) => {
      o.listo = true;
      o.valor = v;
    },
    (e: unknown) => {
      o.listo = true;
      o.error = e as Error;
    },
  );
  return o;
}

/** Deja correr las promesas pendientes (y las cargas de módulos, que no usan el reloj simulado). */
async function drenar(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r));
}
/** Avanza el reloj simulado y deja correr lo que se destraba. */
async function avanzar(ms: number): Promise<void> {
  await drenar();
  await vi.advanceTimersByTimeAsync(ms);
  await drenar();
}
/** Una respuesta que llega a los `ms` del reloj simulado. */
const llegaA = <T>(ms: number, valor: () => T): Promise<T> => new Promise((r) => setTimeout(() => r(valor()), ms));
/** Una respuesta que llega cuando la prueba quiera. */
function adelantada<T>(): { promesa: Promise<T>; entregar: (v: T) => void } {
  let entregar!: (v: T) => void;
  const promesa = new Promise<T>((r) => (entregar = r));
  return { promesa, entregar };
}

/**
 * El candado entre pestañas de mentira: exclusivo, con fila por nombre, `signal` (rechaza con AbortError si se corta la
 * espera) e `ifAvailable`. Siempre se instala uno, aunque el entorno traiga el de verdad: con el reloj simulado la
 * prueba tiene que ver cuándo se toma y cuándo se suelta.
 */
function candadosDePrueba(): LockManager & { tomado: (nombre: string) => boolean } {
  const tomados = new Set<string>();
  const filas = new Map<string, Array<() => void>>();
  const soltar = (nombre: string): void => {
    const siguiente = filas.get(nombre)?.shift();
    if (siguiente) siguiente();
    else tomados.delete(nombre);
  };
  const request = (nombre: string, a: unknown, b?: unknown): Promise<unknown> => {
    const opciones = (typeof a === "function" ? {} : a) as { signal?: AbortSignal; ifAvailable?: boolean };
    const f = (typeof a === "function" ? a : b) as (candado: { name: string } | null) => unknown;
    if (opciones.ifAvailable && tomados.has(nombre)) return Promise.resolve(f(null));
    return new Promise((resolve, rechazar) => {
      const correr = (): void => {
        Promise.resolve()
          .then(() => f({ name: nombre }))
          .then(resolve, rechazar)
          .finally(() => soltar(nombre));
      };
      if (!tomados.has(nombre)) {
        tomados.add(nombre);
        correr();
        return;
      }
      const fila = filas.get(nombre) ?? [];
      filas.set(nombre, fila);
      fila.push(correr);
      opciones.signal?.addEventListener(
        "abort",
        () => {
          const i = fila.indexOf(correr);
          if (i < 0) return;
          fila.splice(i, 1);
          rechazar(new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true },
      );
    });
  };
  return { request, tomado: (nombre: string) => tomados.has(nombre) } as unknown as LockManager & { tomado: (nombre: string) => boolean };
}

let candados: ReturnType<typeof candadosDePrueba>;

beforeEach(() => {
  P = Keypair.random().publicKey();
  reiniciar(h);
  gancho.alArmar = null;
  // Con la hora simulada también: los topes del sitio miran la hora de pared, no solo los temporizadores.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  candados = candadosDePrueba();
  Object.defineProperty(navigator, "locks", { value: candados, configurable: true, writable: true });
  h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
  pollarWallet.address = P;
  pedido = pedidoDe(buena());
  refrescado = null;
  h.impl.pending = async () => [structuredClone(pedido)];
  h.impl.refresh = async (id: string) => {
    refrescado = { ...structuredClone(pedido), id };
    return refrescado;
  };
  h.impl["recovery.status"] = async () => ({ required: true, configured: false, subOrgId: SUB, email: { address: null, verified: false }, passkeys: [], devices: [] });
  h.impl.verify = (r: CosignRequest) => kitReal.verify(r);
  h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) });
  h.impl.get = async (id: string) => aprobado({ ...pedido, id });
});

afterEach(async () => {
  // Nunca se vota con approve, ni se rechaza ni se cancela (es definitivo).
  expect(h.llamadas).not.toContain("approve");
  expect(h.llamadas).not.toContain("reject");
  expect(h.llamadas).not.toContain("cancel");
  vi.useRealTimers();
  await pollarWallet.disconnect();
  Reflect.deleteProperty(navigator, "locks");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("antes del voto, ninguna espera es eterna", () => {
  it("los topes son los del diseño", () => {
    // Por encima del peor caso sano del kit: cada lectura puede tardar 10 s, reintentar y tardar otros 10 s.
    expect(TOPES_DE_ACTIVACION).toEqual({ sinAvanzarMs: 45_000, totalMs: 90_000, candadoMs: 8_000, despuesDelVotoMs: 20_000, seguroDelVotoMs: 65_000 });
    expect(ACTIVACION_LENTA).toBe("pollar-activacion-lenta");
  });

  it("la lista de pedidos nunca contesta: pollar-activacion-lenta a los 45 s y el voto no se llama", async () => {
    h.impl.pending = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(44_000);
    expect(r.listo).toBe(false);
    await avanzar(1_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(0);
    // La miga de la consola dice el paso, sin datos de la cuenta.
    expect(consola()).toContain("[tinkazo] activación lenta: pedidos");
    expect(consola()).not.toContain(P);
    // Lo único vivo es la gracia del candado, que se suelta sola a los 8 s.
    await avanzar(8_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(candados.tomado("tinkazo-activar")).toBe(false);
    expect(votos()).toBeNull();
  });

  it("después de ese rechazo, la lectura vieja se destraba con un pedido válido y no sigue: ni refresh, ni verify, ni voto", async () => {
    const lectura = adelantada<unknown[]>();
    h.impl.pending = () => lectura.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    lectura.entregar([structuredClone(pedido)]);
    await avanzar(1_000);
    expect(h.llamadas).not.toContain("refresh");
    expect(h.llamadas).not.toContain("verify");
    expect(h.llamadas).not.toContain("relay");
    expect(votos()).toBeNull();
  });

  it("la verificación se destraba después del vencimiento: la cadena vieja no vota", async () => {
    const verificacion = adelantada<unknown>();
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      await verificacion.promesa;
      return v;
    };
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(consola()).toContain("[tinkazo] activación lenta: verificar");
    verificacion.entregar(null);
    await avanzar(1_000);
    expect(vecesQue("relay")).toBe(0);
    expect(votos()).toBeNull();
  });

  it("cada paso avanza antes de los 45 s pero el techo es de 90 s en total", async () => {
    h.impl.refreshWalletState = () => llegaA(30_000, () => "CREATING");
    h.impl.pending = () => llegaA(30_000, () => [structuredClone(pedido)]);
    h.impl.refresh = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(89_000);
    expect(r.listo).toBe(false);
    await avanzar(1_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(consola()).toContain("[tinkazo] activación lenta: rearmar");
    expect(vecesQue("relay")).toBe(0);
  });

  it("un proveedor lento que sí contesta (10 s por llamada, 50 s en total) llega a activada: el sitio no lo corta", async () => {
    h.impl.refreshWalletState = () => llegaA(10_000, () => "CREATING");
    h.impl.pending = () => llegaA(10_000, () => [structuredClone(pedido)]);
    h.impl.refresh = (id: string) => llegaA(10_000, () => (refrescado = { ...structuredClone(pedido), id }));
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      await llegaA(10_000, () => null);
      return v;
    };
    h.impl.relay = () => llegaA(10_000, () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) }));
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(60_000);
    expect(r.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(1);
    expect(consola()).not.toContain("activación lenta");
  });

  it("la pestaña estuvo congelada: pasó la hora de los topes sin que corra su temporizador y la cadena que se destraba no vota", async () => {
    const verificacion = adelantada<unknown>();
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      await verificacion.promesa;
      return v;
    };
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(10_000);
    expect(r.listo).toBe(false);
    // La hora de pared salta 100 s sin que corran los temporizadores (el celular se bloqueó) y la respuesta ya llegó.
    vi.setSystemTime(Date.now() + 100_000);
    verificacion.entregar(null);
    await drenar();
    expect(vecesQue("relay")).toBe(0);
    await avanzar(0);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(0);
    expect(votos()).toBeNull();
  });
});

/**
 * Una espera de antes del voto que se cuelga: se deja vencer el intento, se destraba con una respuesta válida y la cadena
 * vieja no llama a nada de lo que sigue.
 */
describe("cada espera de antes del voto tiene su guarda", () => {
  it("la lectura de la billetera: destrabada tarde, no pide pedidos ni vota", async () => {
    const lectura = adelantada<string>();
    h.impl.refreshWalletState = () => lectura.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(consola()).toContain("[tinkazo] activación lenta: billetera");
    lectura.entregar("CREATING");
    await avanzar(1_000);
    expect(h.llamadas).not.toContain("pending");
    expect(h.llamadas).not.toContain("verify");
    expect(h.llamadas).not.toContain("relay");
  });

  it("el pedido que se vuelve a pedir: destrabado tarde, no verifica ni vota", async () => {
    const nuevo = adelantada<Pedido>();
    h.impl.refresh = () => nuevo.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(consola()).toContain("[tinkazo] activación lenta: rearmar");
    nuevo.entregar({ ...structuredClone(pedido) });
    await avanzar(1_000);
    expect(h.llamadas).not.toContain("verify");
    expect(h.llamadas).not.toContain("relay");
  });

  it("el último paso antes del voto (la verificación) es la guarda de alVotar: destrabada tarde, no llega a relay", async () => {
    const verificacion = adelantada<unknown>();
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      await verificacion.promesa;
      return v;
    };
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    verificacion.entregar(null);
    await avanzar(1_000);
    expect(vecesQue("relay")).toBe(0);
    expect(votos()).toBeNull();
  });
});

describe("las guardas de los pasos que cuelgan, una por una", () => {
  it("la guarda de alVotar con la hora de pared: si la verificación termina cuando ya pasó el tiempo, no sale el voto", async () => {
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      // El celular se bloqueó dentro de la verificación: la hora salta y ningún temporizador corrió.
      vi.setSystemTime(Date.now() + 100_000);
      return v;
    };
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("verify")).toBe(1);
    expect(vecesQue("relay")).toBe(0);
    expect(votos()).toBeNull();
  });

  it("tras leer la transacción: si pasó el tiempo, no pide la verificación del kit ni vota", async () => {
    h.impl.refresh = async (id: string) => {
      const base = { ...structuredClone(pedido), id };
      // Leer la transacción es lo primero que toca el campo: ahí la hora salta.
      Object.defineProperty(base, "unsignedPayload", {
        get() {
          vi.setSystemTime(Date.now() + 100_000);
          return pedido.unsignedPayload;
        },
        enumerable: true,
      });
      return base;
    };
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("verify")).toBe(0);
    expect(vecesQue("relay")).toBe(0);
  });

  it("el pedido con voto: la lectura que termina tarde no pide settle", async () => {
    pedido = { ...pedido, activityId: "actividad-0" };
    const lectura = adelantada<unknown>();
    h.impl.get = () => lectura.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    lectura.entregar({ ...pedido });
    await avanzar(1_000);
    expect(vecesQue("settle")).toBe(0);
    expect(vecesQue("relay")).toBe(0);
  });

  it("el pedido con voto: si settle termina tarde diciendo que se aprobó, el intento vencido no escribe nada", async () => {
    pedido = { ...pedido, activityId: "actividad-0" };
    h.impl.get = async (id: string) => ({ ...pedido, id });
    const cierre = adelantada<unknown>();
    h.impl.settle = () => cierre.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    cierre.entregar(aprobado(pedido));
    await avanzar(1_000);
    expect(pollarWallet.estadoOficialLocal().activacion).not.toBe("lista");
  });
});

describe("el candado espera poco", () => {
  it("tomado por otro que nunca lo suelta: pollar-activacion-lenta a los 8 s y sin votar", async () => {
    void candados.request("tinkazo-activar", () => new Promise(() => undefined));
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(7_999);
    expect(r.listo).toBe(false);
    await avanzar(1);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(consola()).toContain("[tinkazo] activación lenta: candado");
    expect(llamadasDeCofirma()).toEqual([]);
    expect(vecesQue("relay")).toBe(0);
  });

  it("el intento que venció retiene el candado hasta que su cadena vieja termine o pasen 8 s, y uno nuevo vota una sola vez", async () => {
    let lecturas = 0;
    h.impl.pending = () => (++lecturas === 1 ? new Promise(() => undefined) : Promise.resolve([structuredClone(pedido)]));
    const primero = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(primero.error?.message).toBe("pollar-activacion-lenta");
    // La cadena vieja puede tener una llamada del kit en vuelo: el candado sigue tomado.
    expect(candados.tomado("tinkazo-activar")).toBe(true);
    const segundo = observar(pollarWallet.activarCuenta());
    await avanzar(7_000);
    expect(segundo.listo).toBe(false);
    expect(vecesQue("relay")).toBe(0);
    await avanzar(1_100);
    expect(segundo.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(1);
    expect(candados.tomado("tinkazo-activar")).toBe(false);
  });

  it("si la cadena vieja termina antes de los 8 s, el candado se suelta en ese momento", async () => {
    const lectura = adelantada<unknown[]>();
    h.impl.pending = () => lectura.promesa;
    const primero = observar(pollarWallet.activarCuenta());
    await avanzar(45_000);
    expect(primero.error?.message).toBe("pollar-activacion-lenta");
    expect(candados.tomado("tinkazo-activar")).toBe(true);
    lectura.entregar([structuredClone(pedido)]);
    await avanzar(10);
    expect(candados.tomado("tinkazo-activar")).toBe(false);
    expect(vecesQue("relay")).toBe(0);
  });
});

describe("después del voto, 20 segundos", () => {
  it("el voto contesta a los 50 s: pendiente a los 20 s, y una segunda llamada con el voto en vuelo no vota", async () => {
    h.impl.relay = () => llegaA(50_000, () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) }));
    const primera = observar(pollarWallet.activarCuenta());
    await avanzar(19_000);
    expect(primera.listo).toBe(false);
    expect(vecesQue("relay")).toBe(1);
    await avanzar(1_000);
    expect(primera.valor).toBe("pendiente");
    expect(consola()).toContain("[tinkazo] activación lenta: voto");
    // El voto sigue vivo: el candado no se soltó.
    expect(candados.tomado("tinkazo-activar")).toBe(true);
    // Otra llamada con el voto en vuelo espera ese mismo voto, con el mismo tope, y no vota.
    const segunda = observar(pollarWallet.activarCuenta());
    await avanzar(19_000);
    expect(segunda.listo).toBe(false);
    await avanzar(1_000);
    expect(segunda.valor).toBe("pendiente");
    expect(vecesQue("relay")).toBe(1);
    // El voto termina por detrás: el candado se suelta y la cuenta queda activa una sola vez.
    await avanzar(10_000);
    expect(candados.tomado("tinkazo-activar")).toBe(false);
    expect(vecesQue("relay")).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("con el voto en vuelo, quien espera el mismo voto recibe cómo quedó", async () => {
    h.impl.relay = () => llegaA(30_000, () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) }));
    const primera = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(primera.valor).toBe("pendiente");
    const segunda = observar(pollarWallet.activarCuenta());
    await avanzar(10_000);
    expect(segunda.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(1);
  });

  it("con el voto en vuelo, otro intento no consigue el candado y no vota", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const primera = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(primera.valor).toBe("pendiente");
    let consiguio: boolean | null = null;
    void candados.request("tinkazo-activar", { ifAvailable: true }, (c) => {
      consiguio = c !== null;
    });
    await avanzar(0);
    expect(consiguio).toBe(false);
    expect(vecesQue("relay")).toBe(1);
  });

  it("un voto que no vuelve: hasta los 65 s el candado sigue tomado y una llamada nueva no vota otra vez", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    await avanzar(44_000);
    expect(candados.tomado("tinkazo-activar")).toBe(true);
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(500);
    expect(nueva.listo).toBe(false);
    expect(vecesQue("relay")).toBe(1);
  });

  it("el seguro de 65 s: suelta el candado, cuenta un voto fallado y lo dice en la consola sin datos de la cuenta", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    await avanzar(44_900);
    expect(candados.tomado("tinkazo-activar")).toBe(true);
    expect(votos()).toBeNull();
    await avanzar(200);
    expect(candados.tomado("tinkazo-activar")).toBe(false);
    expect(votos()).toBe("1");
    expect(consola()).toContain("[tinkazo] activación lenta: seguro");
    expect(consola()).not.toContain(P);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pasado el seguro, una llamada nueva lee el pedido: si ya está aprobado dice activada y no vota otra vez", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(70_000);
    expect(r.valor).toBe("pendiente");
    expect(vecesQue("relay")).toBe(1);
    h.impl.get = async (id: string) => aprobado({ ...pedido, id });
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(nueva.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(1);
  });

  it("pasado el seguro, si el pedido sigue pendiente y sin voto, no se vota otra vez y dice que tarda: cerrar sesión no lo arregla y no se pide", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(70_000);
    expect(r.valor).toBe("pendiente");
    h.impl.get = async (id: string) => ({ ...pedido, id });
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(nueva.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(1);
    await pollarWallet.disconnect();
    pollarWallet.address = P;
    const otra = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(otra.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(1);
  });

  it("pasado el seguro, un pedido que ya trae un voto se espera sin votar", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(70_000);
    expect(r.valor).toBe("pendiente");
    h.impl.get = async (id: string) => ({ ...pedido, id, activityId: "actividad-1" });
    h.impl.settle = async (x: unknown) => aprobado(x as Pedido);
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(nueva.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(1);
  });

  it("el voto olvidado que termina fallando por detrás no se cuenta dos veces", async () => {
    h.impl.relay = () => llegaA(100_000, () => ({ status: 200, body: {}, request: { ...refrescado, status: "FAILED", activityId: "actividad-1" } }));
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(70_000);
    expect(r.valor).toBe("pendiente");
    expect(votos()).toBe("1");
    await avanzar(40_000);
    expect(votos()).toBe("1");
    expect(vecesQue("relay")).toBe(1);
  });

  it("una pestaña congelada: pasó la hora del seguro sin que corra su temporizador y la llamada nueva no espera ni vota", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    vi.setSystemTime(Date.now() + 70_000);
    h.impl.get = async (id: string) => ({ ...pedido, id });
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(nueva.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(1);
  });

  it("otra pestaña consigue el candado cuando pasa el seguro", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    void pollarWallet.activarCuenta();
    await avanzar(64_000);
    let consiguio: boolean | null = null;
    void candados.request("tinkazo-activar", { ifAvailable: true }, (c) => {
      consiguio = c !== null;
    });
    await avanzar(0);
    expect(consiguio).toBe(false);
    await avanzar(1_100);
    void candados.request("tinkazo-activar", { ifAvailable: true }, (c) => {
      consiguio = c !== null;
    });
    await avanzar(0);
    expect(consiguio).toBe(true);
  });

  it("el voto vencido que termina fallando por detrás sigue contando como voto fallado", async () => {
    h.impl.relay = () => llegaA(30_000, () => ({ status: 200, body: {}, request: { ...refrescado, status: "FAILED", activityId: "actividad-1" } }));
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    expect(votos()).toBeNull();
    await avanzar(10_000);
    expect(votos()).toBe("1");
  });

  it("cerrar sesión: lo que termine después del voto no escribe en la sesión siguiente", async () => {
    h.impl.relay = () => llegaA(30_000, () => ({ status: 200, body: {}, request: { ...refrescado, status: "FAILED", activityId: "actividad-1" } }));
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    await pollarWallet.disconnect();
    // La sesión siguiente: la misma pestaña, otra vez con la misma cuenta.
    pollarWallet.address = P;
    await avanzar(30_000);
    expect(votos()).toBeNull();
  });

  it("la misma cuenta entra de nuevo con el voto de antes en vuelo: espera ese mismo voto, no vota otro y no espera el candado", async () => {
    h.impl.relay = () => llegaA(60_000, () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) }));
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    await pollarWallet.disconnect();
    pollarWallet.address = P;
    const nueva = observar(pollarWallet.activarCuenta());
    // Sin los 8 s del candado: dice pendiente a los 20 s del tope de después del voto, y no vota.
    await avanzar(19_000);
    expect(nueva.listo).toBe(false);
    await avanzar(1_000);
    expect(nueva.valor).toBe("pendiente");
    expect(consola()).not.toContain("activación lenta: candado");
    expect(vecesQue("relay")).toBe(1);
  });

  it("otra cuenta entra con el voto de la anterior en vuelo: el candado viejo se suelta y vota lo suyo sin esperar", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    expect(candados.tomado("tinkazo-activar")).toBe(true);
    await pollarWallet.disconnect();
    // Otra persona, en la misma pestaña, con su propio pedido.
    h.billetera = { address: Q, provisioning: "CREATING", existsOnStellar: false };
    pollarWallet.address = Q;
    pedido = pedidoDe(buena(Q), { id: "pedido-2", account: Q, signWith: Q });
    h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) });
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(nueva.valor).toBe("activada");
    expect(consola()).not.toContain("activación lenta: candado");
    expect(vecesQue("relay")).toBe(2);
  });
});

describe("un voto que salió no se repite, ni con otra cuenta en medio ni desde otra pestaña", () => {
  it.each([
    ["con Web Locks", true],
    ["sin Web Locks", false],
  ])("A vota y no termina, entra B y vuelve A (%s): el pedido de A no se vota otra vez", async (_caso, conCandados) => {
    if (!conCandados) Object.defineProperty(navigator, "locks", { value: undefined, configurable: true, writable: true });
    h.impl.relay = () => new Promise(() => undefined);
    const a = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(a.valor).toBe("pendiente");
    const pedidoDeA = pedido;
    await pollarWallet.disconnect();
    // B entra en la misma pestaña, con su propio pedido, y vota lo suyo.
    h.billetera = { address: Q, provisioning: "CREATING", existsOnStellar: false };
    pollarWallet.address = Q;
    pedido = pedidoDe(buena(Q), { id: "pedido-2", account: Q, signWith: Q });
    h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) });
    const b = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(b.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(2);
    await pollarWallet.disconnect();
    // A vuelve: su pedido sigue pendiente y sin voto porque el relevo no aterrizó. No se vota otra vez.
    h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
    pollarWallet.address = P;
    pedido = pedidoDeA;
    h.impl.get = async (id: string) => ({ ...pedido, id });
    const otra = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(otra.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(2);
  });

  it("el voto retiene el candado de su pedido hasta que termina, aunque el seguro suelte el candado principal", async () => {
    const relay = adelantada<unknown>();
    h.impl.relay = () => relay.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(70_000);
    expect(r.valor).toBe("pendiente");
    expect(candados.tomado("tinkazo-activar")).toBe(false);
    expect(candados.tomado("tinkazo-voto:pedido-1")).toBe(true);
    relay.entregar({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) });
    await avanzar(0);
    expect(candados.tomado("tinkazo-voto:pedido-1")).toBe(false);
  });

  it("otra pestaña tiene el voto de este pedido sin terminar: se lee, no se vota y dice que tarda", async () => {
    // La otra pestaña: su voto sigue en vuelo y retiene el candado de ese pedido.
    void candados.request("tinkazo-voto:pedido-1", () => new Promise(() => undefined));
    h.impl.get = async (id: string) => ({ ...pedido, id });
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("relay")).toBe(0);
    expect(h.argumentos.get).toEqual([["pedido-1", { sync: true }]]);
    expect(votos()).toBeNull();
  });

  it("otra pestaña tiene el voto de este pedido sin terminar y la lectura ya lo trae aprobado: dice activada y no vota", async () => {
    void candados.request("tinkazo-voto:pedido-1", () => new Promise(() => undefined));
    h.impl.get = async (id: string) => aprobado({ ...pedido, id });
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(0);
  });
});

describe("las guardas que faltaban", () => {
  it("al armar el cliente: si pasó el tiempo mientras se armaba, no lee la billetera ni sigue", async () => {
    gancho.alArmar = () => void vi.setSystemTime(Date.now() + 100_000);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(h.llamadas).not.toContain("refreshWalletState");
    expect(vecesQue("relay")).toBe(0);
  });

  it("al cargar el lector del kit: si pasó el tiempo en ese rato, no pide la verificación ni vota", async () => {
    // La organización se lee justo antes de cargar el lector del kit: ahí la hora salta.
    h.impl["recovery.status"] = async () => ({
      required: true,
      configured: false,
      get subOrgId() {
        vi.setSystemTime(Date.now() + 100_000);
        return SUB;
      },
      email: { address: null, verified: false },
      passkeys: [],
      devices: [],
    });
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.error?.message).toBe("pollar-activacion-lenta");
    expect(vecesQue("verify")).toBe(0);
    expect(vecesQue("relay")).toBe(0);
  });

  it("la lectura del pedido ya votado: si termina tarde diciendo que la cuenta existe, el intento vencido no escribe nada", async () => {
    h.impl.relay = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(70_000);
    expect(r.valor).toBe("pendiente");
    const lectura = adelantada<unknown>();
    h.impl.get = () => lectura.promesa;
    const nueva = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(nueva.valor).toBe("pendiente");
    lectura.entregar(aprobado({ ...pedido }));
    await avanzar(1_000);
    expect(pollarWallet.estadoOficialLocal().activacion).not.toBe("lista");
    expect(vecesQue("relay")).toBe(1);
  });
});

describe("cerrar sesión con una activación sin votar", () => {
  it("el intento se descarta antes de esperar la red de cerrar sesión: no llega a votar", async () => {
    // Cerrar sesión espera primero salir del navegador de la cuenta, y eso tarda: en ese rato la cadena no puede votar.
    sessionStorage.setItem(MARCAS_DE_LA_CUENTA.inscrito, "1");
    h.impl.devices = () => new Promise(() => undefined);
    const verificacion = adelantada<unknown>();
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      await verificacion.promesa;
      return v;
    };
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(5_000);
    const cierre = observar(pollarWallet.disconnect());
    await avanzar(1_000);
    expect(cierre.listo).toBe(false);
    verificacion.entregar(null);
    await avanzar(1_000);
    expect(vecesQue("relay")).toBe(0);
    expect(r.error).toBeDefined();
    await avanzar(15_000);
    expect(cierre.listo).toBe(true);
  });
});

describe("el pedido que ya trae un voto no se vota", () => {
  it("la lectura siempre dice pendiente: pendiente a los 20 s y el voto no se llama", async () => {
    pedido = { ...pedido, activityId: "actividad-0" };
    h.impl.get = async (id: string) => ({ ...pedido, id });
    h.impl.settle = (r: unknown) => llegaA(200_000, () => r);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(19_000);
    expect(r.listo).toBe(false);
    await avanzar(1_000);
    expect(r.valor).toBe("pendiente");
    expect(vecesQue("relay")).toBe(0);
    expect(consola()).toContain("[tinkazo] activación lenta: cierre");
    // Sin voto de este intento, el candado se suelta con el tope.
    expect(candados.tomado("tinkazo-activar")).toBe(false);
  });

  it("la lectura con sync tampoco contesta: pendiente a los 20 s", async () => {
    pedido = { ...pedido, activityId: "actividad-0" };
    h.impl.get = () => new Promise(() => undefined);
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    expect(vecesQue("relay")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("si la lectura termina tarde diciendo que la cuenta existe, el intento vencido no escribe nada", async () => {
    pedido = { ...pedido, activityId: "actividad-0" };
    const lectura = adelantada<unknown>();
    h.impl.get = () => lectura.promesa;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(20_000);
    expect(r.valor).toBe("pendiente");
    lectura.entregar(aprobado(pedido));
    await avanzar(1_000);
    expect(pollarWallet.estadoOficialLocal().activacion).not.toBe("lista");
  });
});

describe("el camino sano no cambia", () => {
  it("con el proveedor contestando rápido: la misma secuencia de llamadas al kit y activada", async () => {
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.valor).toBe("activada");
    expect(llamadasDeCofirma()).toEqual(["refreshWalletState", "pending", "recovery.status", "refresh", "verify", "relay"]);
    expect(h.argumentos.refresh).toEqual([["pedido-1"]]);
    expect(h.argumentos.relay?.[0]?.[2]).toEqual({ requestId: "pedido-1" });
    // Ni un reloj queda vivo y el candado quedó libre.
    expect(vi.getTimerCount()).toBe(0);
    expect(candados.tomado("tinkazo-activar")).toBe(false);
    expect(candados.tomado("tinkazo-voto:pedido-1")).toBe(false);
    expect(consola()).not.toContain("activación lenta");
  });

  it("el voto que termina pendiente en su tiempo: settle y pendiente, sin relojes vivos", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...refrescado, activityId: "actividad-1" } });
    h.impl.settle = async (r: unknown) => r;
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.valor).toBe("pendiente");
    expect(llamadasDeCofirma()).toEqual(["refreshWalletState", "pending", "recovery.status", "refresh", "verify", "relay", "settle"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sin Web Locks en el navegador, todo sigue como hoy", async () => {
    Reflect.deleteProperty(navigator, "locks");
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true, writable: true });
    const r = observar(pollarWallet.activarCuenta());
    await avanzar(0);
    expect(r.valor).toBe("activada");
    expect(vecesQue("relay")).toBe(1);
  });

  it("dos toques a la vez comparten un solo intento y votan una vez", async () => {
    const a = pollarWallet.activarCuenta();
    const b = pollarWallet.activarCuenta();
    await avanzar(0);
    await expect(Promise.all([a, b])).resolves.toEqual(["activada", "activada"]);
    expect(vecesQue("relay")).toBe(1);
  });
});

describe("la precarga", () => {
  it("solo baja el kit del proveedor: quien se anota desde el celular no baja el SDK de Stellar", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/stellar/wallet-pollar.ts"), "utf8");
    const desde = fuente.indexOf("export function precargarSdk");
    const cuerpo = fuente.slice(desde, fuente.indexOf("\n}\n", desde));
    expect(cuerpo).toContain('void cargaOpcional(import("@pollar/core"));');
    expect(cuerpo).not.toContain("stellar-sdk");
  });

  it("el paso de la cuenta baja el SDK de Stellar cuando se abre, con la persona mirando", () => {
    const flujo = readFileSync(resolve(process.cwd(), "src/ui/cuenta-lista-flujo.ts"), "utf8");
    expect(flujo).toContain('void import("@stellar/stellar-sdk").catch(() => undefined);');
  });
});
