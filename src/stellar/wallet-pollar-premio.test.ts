import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Account, Asset, Keypair, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey, esDeRed } from "./errores";
import { USDC_MAINNET } from "./pagos";
import { PASSPHRASE_TESTNET, almacenEnMemoria, reiniciar } from "./pollar-falso";
import { PremioGuardado } from "./usdc-cuenta";

/**
 * La puerta del premio en la billetera de Google (`#firmando` de `wallet-pollar.ts`). En los modos que cuida
 * (`PUERTA_DEL_PREMIO_EN`: premios, recibir y apagada), en la red principal y sin el voto por contenido, antes de cada firma
 * del sello o del sorteo se mira en la red si la cuenta puede guardar dinero. Si puede, o si no se pudo saber, no se firma:
 * el cliente de Pollar ni se entera. Con el voto a mano no se mira nada. Todo con un cliente y un Horizon de mentira.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
// Sin la pausa de 700 ms entre lecturas: estas pruebas no la esperan (`usdc-cuenta.test.ts` mide la pausa y el presupuesto).
vi.mock("./usdc-cuenta", async (orig) => {
  const real = await orig<typeof import("./usdc-cuenta")>();
  return {
    ...real,
    mirarPuertaDelPremio: (red: Parameters<typeof real.mirarPuertaDelPremio>[0], cuenta: string, op: object = {}) => real.mirarPuertaDelPremio(red, cuenta, { ...op, pausaMs: 0 }),
    mirarAntesDeActivar: (red: Parameters<typeof real.mirarAntesDeActivar>[0], cuenta: string, op: object = {}) => real.mirarAntesDeActivar(red, cuenta, { ...op, pausaMs: 0 }),
  };
});
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet } = await import("./wallet-pollar");

const P = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();

/** Un sello cualquiera: lo que importa de la puerta es que corre antes de firmar, no qué firma. */
const sello = (secuencia = "10"): string =>
  new TransactionBuilder(new Account(P, secuencia), { fee: "1000", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.manageData({ name: "tinkazo", value: "sello" }))
    .setTimeout(300)
    .build()
    .toXDR();

/** Lo que contesta Horizon a `GET /accounts/{cuenta}`. */
const nativo = (balance = "0.0000000"): Record<string, unknown> => ({ asset_type: "native", balance, selling_liabilities: "0.0000000", buying_liabilities: "0.0000000" });
const circle = (balance = "0.0000000", extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  asset_type: "credit_alphanum4",
  asset_code: USDC_MAINNET.code,
  asset_issuer: USDC_MAINNET.issuer,
  balance,
  limit: "922337203685.4775807",
  is_authorized: true,
  ...extra,
});
const cuenta = (balances: Array<Record<string, unknown>>): Record<string, unknown> => ({ id: P, sequence: "1", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0, balances });

interface Pedido {
  url: string;
  init: RequestInit | undefined;
}
let pedidos: Pedido[];
let orden: string[];
/** Qué contesta Horizon: un cuerpo, un número (el estado) o "lanza" (se cortó). Una lista: lo que contesta en cada lectura. */
let horizon: unknown;

beforeEach(() => {
  reiniciar(h);
  pedidos = [];
  orden = [];
  horizon = cuenta([nativo()]);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubEnv("VITE_RAMPA", "premios");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ url: String(url), init });
      orden.push("horizon");
      const respuesta = Array.isArray(horizon) ? horizon[Math.min(pedidos.length - 1, horizon.length - 1)] : horizon;
      if (respuesta === "lanza") throw new TypeError("Failed to fetch");
      if (typeof respuesta === "number") return new Response("", { status: respuesta });
      return new Response(JSON.stringify(respuesta), { status: 200 });
    }),
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  h.impl.signAndSubmitTx = async () => {
    orden.push("firma");
    return { status: "success", hash: "deadbeef" };
  };
  h.impl.signTx = async () => {
    orden.push("firma");
    return { status: "signed", signedXdr: "FIRMADA" };
  };
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = P;
});

afterEach(async () => {
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rechazo = async (f: () => Promise<unknown>): Promise<PremioGuardado> => {
  const e = await f().then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, "tendría que haber rechazado").not.toBeNull();
  expect((e as Error).name).toBe("PremioGuardado");
  return e as PremioGuardado;
};

describe("la puerta del premio: una cuenta que puede guardar dinero no firma", () => {
  const casos: Array<[string, Array<Record<string, unknown>>]> = [
    ["con la línea del dólar digital en cero", [nativo(), circle("0.0000000")]],
    ["con la línea del dólar digital y saldo", [nativo(), circle("12.5000000")]],
    ["con la línea sin autorizar", [nativo(), circle("0.0000000", { is_authorized: false })]],
    ["con otra moneda con saldo", [nativo(), { asset_type: "credit_alphanum4", asset_code: "EURC", asset_issuer: OTRA, balance: "3.0000000", limit: "10.0000000" }]],
  ];

  for (const [que, balances] of casos) {
    it(`${que}: signAndSubmit rechaza y el cliente no recibe la firma`, async () => {
      horizon = cuenta(balances);
      const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
      expect(e.que).toBe("puede-guardar");
      expect(h.llamadas).not.toContain("signAndSubmitTx");
      expect(orden).toEqual(["horizon"]);
    });
  }

  it("lo mismo con signUnsponsored: no se llama a signTx", async () => {
    horizon = cuenta([nativo(), circle()]);
    const e = await rechazo(() => pollarWallet.signUnsponsored(sello()));
    expect(e.que).toBe("puede-guardar");
    expect(h.llamadas).not.toContain("signTx");
  });

  it("un pago de dólares digitales, armado por cualquier lado, tampoco firma", async () => {
    horizon = cuenta([nativo(), circle("12.5000000")]);
    // Armado con el SDK: `armarEnvio` (Mandar) se niega en este modo y no hay otro camino que lo arme.
    const pago = new TransactionBuilder(new Account(P, "1"), { fee: "1000", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination: OTRA, asset: new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer), amount: "5.0000000" }))
      .setTimeout(300)
      .build()
      .toXDR();
    await rechazo(() => pollarWallet.signAndSubmit(pago));
    expect(h.llamadas).not.toContain("signAndSubmitTx");
  });

  it("nadie confirma nada: una confirmación de ese XDR que llegara se rechaza", async () => {
    horizon = cuenta([nativo(), circle()]);
    const xdr = sello();
    await rechazo(() => pollarWallet.signAndSubmit(xdr));
    const confirmar = vi.fn();
    const rechazar = vi.fn();
    expect(h.alConfirmar, "el kit tiene quien atienda las confirmaciones").not.toBeNull();
    h.alConfirmar?.([{ id: "c1", kind: "sign_and_send", unsignedXdr: xdr, confirm: confirmar, reject: rechazar }]);
    expect(confirmar).not.toHaveBeenCalled();
    expect(rechazar).toHaveBeenCalledOnce();
  });

  it("pide al Horizon de la red principal, a la cuenta de la sesión y sin caché", async () => {
    horizon = cuenta([nativo(), circle()]);
    await rechazo(() => pollarWallet.signAndSubmit(sello()));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`https://horizon.stellar.org/accounts/${P}`);
    expect(pedidos[0]?.init?.cache).toBe("no-store");
  });

  it("el error tiene su clave y no es un corte de red ni un sello incierto", async () => {
    horizon = cuenta([nativo(), circle()]);
    const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
    expect(errorKey(e)).toBe("premioGuardado");
    expect(esDeRed(e)).toBe(false);
    expect(e.cause).toBeUndefined();
  });
});

describe("la puerta del premio: si la red no deja saberlo, no se firma a ciegas", () => {
  const casos: Array<[string, unknown]> = [
    ["Horizon caído (500)", 500],
    ["Horizon con demasiados pedidos (429)", 429],
    ["la cuenta no existe en Horizon (404)", 404],
    ["un corte de la conexión", "lanza"],
    ["una respuesta que no es una cuenta", { sequence: "1" }],
    ["una cuenta sin su línea de XLM", cuenta([circle()])],
  ];
  for (const [que, respuesta] of casos) {
    it(`${que}: rechaza con no-se-sabe y no firma`, async () => {
      horizon = respuesta;
      const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
      expect(e.que).toBe("no-se-sabe");
      expect(errorKey(e)).toBe("premioSinSaber");
      expect(esDeRed(e)).toBe(false);
      expect(h.llamadas).not.toContain("signAndSubmitTx");
    });
  }
});

describe("la puerta del premio: una cuenta que no puede guardar nada firma como siempre", () => {
  it("sin la línea del dólar digital y con XLM en cero: firma, con una sola lectura y antes de la firma", async () => {
    horizon = cuenta([nativo("0.0000000")]);
    await expect(pollarWallet.signAndSubmit(sello())).resolves.toBe("deadbeef");
    expect(orden).toEqual(["horizon", "firma"]);
    expect(pedidos).toHaveLength(1);
  });

  it("con mucho XLM y sin líneas: firma como siempre, con una sola lectura y antes de la firma (cualquiera puede mandar XLM)", async () => {
    horizon = cuenta([nativo("250000.0000000")]);
    await expect(pollarWallet.signAndSubmit(sello())).resolves.toBe("deadbeef");
    expect(orden).toEqual(["horizon", "firma"]);
    expect(pedidos).toHaveLength(1);
    // Ni unas fracciones de XLM, que es lo que cualquiera le puede mandar a quien organiza, lo dejan sin sellar.
    horizon = cuenta([nativo("0.0000001")]);
    await expect(pollarWallet.signUnsponsored(sello("11"))).resolves.toBe("FIRMADA");
    expect(orden).toEqual(["horizon", "firma", "horizon", "firma"]);
  });

  it("con signUnsponsored también", async () => {
    await expect(pollarWallet.signUnsponsored(sello())).resolves.toBe("FIRMADA");
    expect(orden).toEqual(["horizon", "firma"]);
  });

  it("dos firmas seguidas miran dos veces: no hay caché", async () => {
    await pollarWallet.signAndSubmit(sello("10"));
    await pollarWallet.signAndSubmit(sello("11"));
    expect(orden).toEqual(["horizon", "firma", "horizon", "firma"]);
    // Entre una y otra llegó el premio: la segunda ya no firma.
    horizon = cuenta([nativo(), circle("5.0000000")]);
    await rechazo(() => pollarWallet.signAndSubmit(sello("12")));
    expect(orden.filter((x) => x === "firma")).toHaveLength(2);
  });
});

describe("la puerta del premio: antesDeFirmar vuelve a mirar el margen después de la lectura", () => {
  it("corre después de la lectura y antes de la firma", async () => {
    await expect(pollarWallet.signAndSubmit(sello(), () => orden.push("margen"))).resolves.toBe("deadbeef");
    expect(orden).toEqual(["horizon", "margen", "firma"]);
  });

  it("si lanza, no se firma nada: la lectura ya gastó el margen de la ronda", async () => {
    const sinMargen = new Error("la ronda quedó cerca antes de mandar el sello (faltan 20 s): Error(Contract, #5)");
    await expect(
      pollarWallet.signAndSubmit(sello(), () => {
        throw sinMargen;
      }),
    ).rejects.toBe(sinMargen);
    expect(orden).toEqual(["horizon"]);
  });

  it("si la puerta frena, no corre: antes manda el aviso del premio", async () => {
    horizon = cuenta([nativo(), circle("5.0000000")]);
    const margen = vi.fn();
    await rechazo(() => pollarWallet.signAndSubmit(sello(), margen));
    expect(margen).not.toHaveBeenCalled();
  });
});

describe("la puerta del premio: ante una duda vuelve a leer antes de cerrar", () => {
  it("un corte y después la cuenta libre: firma, con dos lecturas y antes de la firma", async () => {
    horizon = [500, cuenta([nativo()])];
    await expect(pollarWallet.signAndSubmit(sello())).resolves.toBe("deadbeef");
    expect(orden).toEqual(["horizon", "horizon", "firma"]);
  });

  it("un 404 y después la cuenta (Horizon va unos segundos atrás): firma", async () => {
    horizon = [404, 404, cuenta([nativo()])];
    await expect(pollarWallet.signAndSubmit(sello())).resolves.toBe("deadbeef");
    expect(orden).toEqual(["horizon", "horizon", "horizon", "firma"]);
  });

  it("un corte y después una cuenta que puede guardar dinero: no firma", async () => {
    horizon = [500, cuenta([nativo(), circle()])];
    const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
    expect(e.que).toBe("puede-guardar");
    expect(orden).toEqual(["horizon", "horizon"]);
    expect(h.llamadas).not.toContain("signAndSubmitTx");
  });

  it("si en las tres lecturas sigue la duda, no firma y dice que no se pudo comprobar", async () => {
    horizon = 500;
    const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
    expect(e.que).toBe("no-se-sabe");
    expect(pedidos).toHaveLength(3);
    expect(h.llamadas).not.toContain("signAndSubmitTx");
  });

  it("una cuenta que Horizon nunca ve no firma: no-se-sabe tras las tres lecturas", async () => {
    horizon = 404;
    const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
    expect(e.que).toBe("no-se-sabe");
    expect(pedidos).toHaveLength(3);
  });

  it("una respuesta que dice puede-guardar no se vuelve a preguntar", async () => {
    horizon = [cuenta([nativo(), circle()]), cuenta([nativo()])];
    const e = await rechazo(() => pollarWallet.signAndSubmit(sello()));
    expect(e.que).toBe("puede-guardar");
    expect(pedidos).toHaveLength(1);
  });
});

describe("activarUsdc en el modo premios: antes de pedir la línea mira la cuenta", () => {
  const trustline = (): string[] => h.llamadas.filter((x) => x === "setTrustline");

  beforeEach(() => {
    h.impl.setTrustline = async () => ({ status: "success" });
  });

  it("con la línea ya puesta (la ventana estaba vieja): ya está, y no se pide otra", async () => {
    horizon = cuenta([nativo(), circle("12.5000000")]);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(trustline()).toEqual([]);
    expect(pedidos).toHaveLength(1);
  });

  it("con la línea en cero también: ya está", async () => {
    horizon = cuenta([nativo(), circle()]);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(trustline()).toEqual([]);
  });

  it("sin la línea y sin dinero: se pide, una sola vez", async () => {
    horizon = cuenta([nativo()]);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(trustline()).toEqual(["setTrustline"]);
  });

  it("una cuenta que Horizon todavía no conoce: se pide, con su camino de siempre y sin esperar a que aparezca", async () => {
    horizon = 404;
    h.impl.setTrustline = async () => ({ status: "error", code: "SDK_WALLET_NOT_READY" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("cuenta-creandose");
    expect(trustline()).toEqual(["setTrustline"]);
    expect(pedidos).toHaveLength(1);
  });

  it("si la red no deja saberlo: no sale y no se pide nada", async () => {
    horizon = 500;
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(trustline()).toEqual([]);
  });

  it("con XLM y sin la línea: se pide, una sola vez (cualquiera puede mandar XLM, y no le cierra el premio a nadie)", async () => {
    horizon = cuenta([nativo("2.0000000")]);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(trustline()).toEqual(["setTrustline"]);
    expect(pedidos).toHaveLength(1);
  });

  it("con otra moneda con saldo y sin la línea: no sale y no se pide nada", async () => {
    horizon = cuenta([nativo("2.0000000"), { asset_type: "credit_alphanum4", asset_code: "EURC", asset_issuer: OTRA, balance: "3.0000000", limit: "10.0000000" }]);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(trustline()).toEqual([]);
  });

  it("sin la cuenta de la sesión: no sale, sin leer ni pedir", async () => {
    h.billetera = null;
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(trustline()).toEqual([]);
    expect(pedidos).toEqual([]);
  });

  it("fuera de la red principal o del modo premios: no se lee nada, y se pide como siempre", async () => {
    horizon = cuenta([nativo(), circle()]);
    vi.stubEnv("VITE_RAMPA", "pollar");
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(trustline()).toEqual(["setTrustline"]);
    expect(pedidos).toEqual([]);
  });

  it("en la red de prueba con premios tampoco se lee", async () => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.redDelCliente = "testnet";
    horizon = cuenta([nativo(), circle()]);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(pedidos).toEqual([]);
  });
});

describe("la puerta del premio solo corre en el caso: nada se lee ni se demora en los otros", () => {
  it("en la red de prueba, con premios: no se pide nada a Horizon y se firma", async () => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.redDelCliente = "testnet";
    horizon = cuenta([nativo("100.0000000"), circle("9.0000000")]);
    await expect(pollarWallet.signAndSubmit(sello())).resolves.toBe("deadbeef");
    expect(pedidos).toEqual([]);
  });

  it("en la red principal con VITE_RAMPA=pollar, donde la venta paga con el saldo: no se pide nada a Horizon y se firma", async () => {
    vi.stubEnv("VITE_RAMPA", "pollar");
    horizon = cuenta([nativo("100.0000000"), circle("9.0000000")]);
    await expect(pollarWallet.signAndSubmit(sello())).resolves.toBe("deadbeef");
    await expect(pollarWallet.signUnsponsored(sello("11"))).resolves.toBe("FIRMADA");
    expect(pedidos).toEqual([]);
  });
});

describe("con el voto por contenido apagado, la puerta cuida premios, recibir y apagada", () => {
  for (const modo of ["premios", "recibir", "meru", "", "otra-cosa"]) {
    it(`con VITE_RAMPA=${modo === "" ? "(sin poner)" : modo}: una cuenta con dinero no firma, y se lee Horizon antes`, async () => {
      vi.stubEnv("VITE_RAMPA", modo);
      horizon = cuenta([nativo("100.0000000"), circle("9.0000000")]);
      expect((await rechazo(() => pollarWallet.signUnsponsored(sello()))).que).toBe("puede-guardar");
      expect(pedidos).toHaveLength(1);
      expect(h.llamadas).not.toContain("signTx");
    });
  }

  for (const modo of ["recibir", ""]) {
    it(`con VITE_RAMPA=${modo === "" ? "(sin poner)" : modo}: una cuenta libre firma como siempre, después de una lectura`, async () => {
      vi.stubEnv("VITE_RAMPA", modo);
      await expect(pollarWallet.signUnsponsored(sello())).resolves.toBe("FIRMADA");
      expect(orden).toEqual(["horizon", "firma"]);
    });
  }
});

describe("con el voto por contenido, la puerta no corre", () => {
  const CONTRATO = StrKey.encodeContract(new Uint8Array(32).fill(7));
  /** El sello de verdad: una invocación del contrato oficial, lo único que se firma con el voto a mano. */
  const selloDelContrato = (): string =>
    new TransactionBuilder(new Account(P, "10"), { fee: "1000", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.invokeContractFunction({ contract: CONTRATO, function: "seal", args: [] }))
      .setTimeout(300)
      .build()
      .toXDR();

  beforeEach(() => {
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
    h.red.contractId = CONTRATO;
    horizon = cuenta([nativo(), circle("12.5000000")]);
  });
  afterEach(() => {
    h.red.contractId = null;
  });

  it("una cuenta con dinero no lee Horizon antes de la firma: la frena la regla, no la puerta", async () => {
    // El kit de mentira firma sin pedido de co-firma: la regla no lo usa, y eso no es la puerta.
    const e = await pollarWallet.signUnsponsored(selloDelContrato()).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).name).not.toBe("PremioGuardado");
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(pedidos).toEqual([]);
    expect(h.llamadas).toContain("signTx");
  });

  it("revisarPuertaDelPremio da libre sin leer", async () => {
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("libre");
    expect(pedidos).toEqual([]);
  });

  it("con un kit que no toma el voto a mano, la puerta vuelve a leer y frena", async () => {
    h.kitTomaElVotoAMano = false;
    await rechazo(() => pollarWallet.signUnsponsored(selloDelContrato()));
    expect(pedidos).toHaveLength(1);
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("puede-guardar");
  });
});

describe("revisarPuertaDelPremio: la misma lectura, sin firmar nada", () => {
  it("con una cuenta que puede guardar dinero da puede-guardar, y no toca la firma", async () => {
    horizon = cuenta([nativo(), circle()]);
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("puede-guardar");
    expect(h.llamadas).not.toContain("signAndSubmitTx");
    expect(h.llamadas).not.toContain("signTx");
  });

  it("con una cuenta libre da libre", async () => {
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("libre");
    expect(pedidos).toHaveLength(1);
  });

  it("con mucho XLM y sin líneas también da libre", async () => {
    horizon = cuenta([nativo("250000.0000000")]);
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("libre");
    expect(pedidos).toHaveLength(1);
  });

  it("con una cuenta que Horizon no conoce todavía da no-existe, y con un corte no-se-sabe", async () => {
    horizon = 404;
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("no-existe");
    horizon = "lanza";
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("no-se-sabe");
  });

  it("sin la cuenta de la sesión no se sabe, y no se lee nada", async () => {
    h.billetera = null;
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("no-se-sabe");
    expect(pedidos).toEqual([]);
  });

  it("fuera de los modos que cuida la puerta o de la red principal da libre sin leer", async () => {
    vi.stubEnv("VITE_RAMPA", "pollar");
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("libre");
    vi.stubEnv("VITE_RAMPA", "premios");
    h.red.name = "testnet";
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("libre");
    expect(pedidos).toEqual([]);
  });
});

describe("las fuentes: la puerta no se saltea por otro lado", () => {
  const raiz = resolve(process.cwd(), "src");
  const fuentes = (readdirSync(raiz, { recursive: true }) as string[])
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
  const leer = (f: string): string => readFileSync(join(raiz, f), "utf8");

  it("mirarPuertaDelPremio se llama solo desde wallet-pollar.ts", () => {
    const llaman = fuentes.filter((f) => f !== "stellar/usdc-cuenta.ts" && /mirarPuertaDelPremio\(/.test(leer(f)));
    expect(llaman).toEqual(["stellar/wallet-pollar.ts"]);
  });

  it("mirarAntesDeActivar se llama solo desde wallet-pollar.ts, antes de pedir la línea", () => {
    const llaman = fuentes.filter((f) => f !== "stellar/usdc-cuenta.ts" && /mirarAntesDeActivar\(/.test(leer(f)));
    expect(llaman).toEqual(["stellar/wallet-pollar.ts"]);
    const fuente = leer("stellar/wallet-pollar.ts");
    const desde = fuente.indexOf("async #pedirLineaUsdc(");
    expect(desde).toBeGreaterThan(0);
    const mira = fuente.indexOf("mirarAntesDeActivar(", desde);
    expect(mira).toBeGreaterThan(desde);
    expect(mira).toBeLessThan(fuente.indexOf("client.setTrustline(", desde));
  });

  it("la puerta no tiene salida por parámetro: ninguna llamada a #firmando pasa la opción", () => {
    const fuente = leer("stellar/wallet-pollar.ts");
    // Ni se declara ni se pasa: la puerta no mira nada más que la red, el modo y si el cliente vota a mano (`#aMano`).
    const aqui = fuente.indexOf("async #firmando<T>");
    expect(aqui).toBeGreaterThan(0);
    const firma = fuente.slice(aqui, fuente.indexOf("const client", aqui));
    expect(firma).toContain("testigo?: boolean");
    expect(firma).not.toContain("puertaDelPremio");
    expect(fuente.slice(aqui, fuente.indexOf("finally", aqui))).not.toContain("o.puertaDelPremio");
    // Cada llamada a `#firmando` solo pasa `testigo` y la intención de la firma.
    const llamadas = [...fuente.matchAll(/this\.#firmando\(/g)];
    expect(llamadas).toHaveLength(3);
    for (const llamada of llamadas) expect(fuente.slice(llamada.index, fuente.indexOf(";", llamada.index))).not.toContain("puertaDelPremio");
    // Y nadie, en ningún archivo, pasa la puerta en falso.
    expect(fuentes.filter((f) => /puertaDelPremio:\s*false/.test(leer(f)))).toEqual([]);
  });

  it("#pagar se niega en el modo premios antes de armar el cliente y de pedir nada al proveedor", () => {
    const fuente = leer("stellar/wallet-pollar.ts");
    const desde = fuente.indexOf("async #pagar(");
    expect(desde).toBeGreaterThan(0);
    const negativa = fuente.indexOf('modoDeRampa() === "premios"', desde);
    expect(negativa).toBeGreaterThan(desde);
    expect(negativa).toBeLessThan(fuente.indexOf("#ensureClient()", desde));
    expect(negativa).toBeLessThan(fuente.indexOf("buildTx(", desde));
  });

  it("la puerta está antes de anotar la transacción esperada y de firmar", () => {
    const fuente = leer("stellar/wallet-pollar.ts");
    const aqui = fuente.indexOf("async #firmando<T>");
    const cuerpo = fuente.slice(aqui, fuente.indexOf("finally", aqui));
    expect(cuerpo.indexOf("PremioGuardado")).toBeGreaterThan(0);
    expect(cuerpo.indexOf("PremioGuardado")).toBeLessThan(cuerpo.indexOf("this.#esperadas.set"));
    expect(cuerpo.indexOf("PremioGuardado")).toBeLessThan(cuerpo.indexOf("armarTestigo"));
  });
});
