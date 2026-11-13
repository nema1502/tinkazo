// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pago } from "../../workers/cuenta/src/pagos";
import { T, setLang, t } from "../i18n";
import { type CuentaMirada, type LecturaDeCuenta, usdcDeLaRed } from "../stellar/usdc-cuenta";
import { type DepsDeSaldo, abrirSaldo } from "./saldo";

vi.mock("./qr", () => ({
  pintarQr: vi.fn(async (img: HTMLImageElement, texto: string) => {
    img.dataset.qr = texto;
    return true;
  }),
}));

/**
 * «Tus dólares digitales» (`saldo.ts`): el saldo arriba, «Ya tengo dólares digitales» con la guarda (la dirección solo
 * cuando la cuenta puede recibir) y «Ya lo mandé», que mira lo que llegó y nunca invita a mandar de nuevo. Todo con la
 * cuenta y la red de mentira: nada sale de la prueba.
 */

/** Una cuenta nueva en cada prueba: la base de Ya lo mandé vive también en la memoria de la página. */
let YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const TX = (c: string): string => c.repeat(64);

const mirada = (o: Partial<CuentaMirada> = {}): CuentaMirada => ({
  secuencia: "1",
  saldos: [],
  xlm: "10.0000000",
  xlmComprometido: "0.0000000",
  subentradas: 0,
  patrocinando: 0,
  patrocinadas: 0,
  ...o,
});
const conUsdc = (saldo = "12.5000000", o: Partial<CuentaMirada["saldos"][number]> = {}, red: "mainnet" | "testnet" = "mainnet"): CuentaMirada =>
  mirada({ saldos: [{ code: "USDC", issuer: usdcDeLaRed(red).issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null, ...o }] });
const pago = (tx: string, o: Partial<Pago> = {}): Pago => ({ de: OTRA, a: YO, monto: 100_000_000n, tx, memo: null, ms: Date.UTC(2026, 10, 11, 14, 2), ...o });

interface Mundo extends DepsDeSaldo {
  lectura: LecturaDeCuenta;
  lista: Pago[];
  pagosCaidos: boolean;
}

/** Una cuenta de Google en la red principal, lista y con dólares digitales, salvo que se diga otra cosa. */
function mundo(o: Partial<Mundo> = {}): Mundo {
  const m: Mundo = {
    red: "mainnet",
    practica: false,
    lectura: conUsdc(),
    lista: [],
    pagosCaidos: false,
    billetera: async () => ({ tipo: "google" }),
    mirar: async () => m.lectura,
    proteccion: async () => "lista",
    pendiente: async () => false,
    catalogo: async () => "patrocinada",
    pagos: async () => (m.pagosCaidos ? { ok: false } : { ok: true, valor: [...m.lista] }),
    activar: vi.fn(async () => "activada" as const),
    pausa: async () => undefined,
    monedas: null,
    dejarLista: vi.fn(async () => false),
    pasarAOficial: vi.fn(),
    mandar: vi.fn(),
    ...o,
  };
  return m;
}

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const cuerpo = (): string => document.querySelector(".dlg-cuerpo")?.textContent ?? "";
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
/** Espera a que la ventana termine de mirar la cuenta. */
const lista = async (): Promise<void> => {
  await vi.waitFor(() => expect(principal().disabled).toBe(false));
};
const abrir = async (m: Mundo): Promise<void> => {
  abrirSaldo({ address: YO }, m);
  await lista();
};
const aTraer = async (m: Mundo): Promise<void> => {
  await abrir(m);
  expect(principal().textContent).toBe(t("cargaYaTengo"));
  principal().click();
};

beforeEach(() => {
  YO = Keypair.random().publicKey();
  document.body.innerHTML = "";
  setLang("es");
  vi.stubEnv("VITE_RAMPA", "recibir");
  try {
    localStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la ventana", () => {
  it("con la bandera apagada no abre nada", () => {
    vi.stubEnv("VITE_RAMPA", "");
    abrirSaldo({ address: YO }, mundo());
    expect(dialogo()).toBeNull();
  });

  it("mientras mira la cuenta, la principal está apagada y no hay dirección", () => {
    const m = mundo({ mirar: () => new Promise<LecturaDeCuenta>(() => undefined) });
    abrirSaldo({ address: YO }, m);
    expect(principal().disabled).toBe(true);
    expect(estado()).toBe(t("saldoMirandoCuenta"));
    expect(document.body.textContent).not.toContain(YO);
  });

  it("al abrir: el saldo arriba, una línea y Ya tengo dólares digitales, sin Meru ni flechas", async () => {
    await abrir(mundo());
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe("Tenés 12,5 dólares digitales.");
    expect(cuerpo()).toContain(t("saldoLead"));
    expect(principal().textContent).toBe("Ya tengo dólares digitales");
    expect(document.body.innerHTML).not.toMatch(/meru|↗|→/i);
    // Cómo sacar el dinero va plegado.
    const plegado = document.querySelector<HTMLDetailsElement>(".saldo-mas");
    expect(plegado?.open).toBe(false);
    expect(plegado?.querySelector("summary")?.textContent).toBe(t("cargaComoSaco"));
  });

  it("sin dólares digitales lo dice tal cual, y no ofrece mandar", async () => {
    await abrir(mundo({ lectura: conUsdc("0.0000000") }));
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe(t("cargaTenesNada"));
    expect(document.querySelector('[data-saldo="mandar"]')).toBeNull();
  });

  it("con dólares, Mandar mis dólares digitales va de texto y abre Mandar con el saldo", async () => {
    const m = mundo();
    await abrir(m);
    const b = document.querySelector<HTMLButtonElement>('[data-saldo="mandar"]');
    expect(b?.textContent).toBe(t("saldoMandarBtn"));
    expect(b?.classList.contains("saldo-link")).toBe(true);
    b?.click();
    expect(dialogo()).toBeNull();
    expect(m.mandar).toHaveBeenCalledWith(YO, 125_000_000n);
  });

  it("si la cuenta no puede recibir, tampoco ofrece mandar", async () => {
    await abrir(mundo({ lectura: conUsdc("12.5000000", { autorizada: false }) }));
    expect(document.querySelector('[data-saldo="mandar"]')).toBeNull();
  });

  it("Escape la cierra", async () => {
    await abrir(mundo());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialogo()).toBeNull();
  });

  it("en inglés dice lo mismo", async () => {
    setLang("en");
    await aTraer(mundo());
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe("You have 12.5 digital dollars.");
    expect(principal().textContent).toBe("I've sent it");
    expect(cuerpo()).toContain(T.en.saldoRecibirOjo as string);
  });
});

describe("Ya tengo dólares digitales", () => {
  it("con la cuenta que puede recibir: la dirección con Copiar, su QR y la nota vacía", async () => {
    await aTraer(mundo());
    expect(document.querySelector(".saldo-titulo")?.textContent).toBe(t("saldoRecibirTitulo"));
    expect(document.querySelector('[data-saldo="dir"]')?.textContent).toBe(YO);
    expect((document.querySelector('[data-saldo="qr"]') as HTMLImageElement).dataset.qr).toBe(YO);
    expect(cuerpo()).toContain(t("saldoNotaVacia"));
    expect(principal().textContent).toBe(t("saldoYaMande"));
    // Una sola línea a la vista: el resto, plegado.
    expect(document.querySelectorAll(".saldo-paso > .saldo-lead")).toHaveLength(1);
    expect(document.querySelector<HTMLDetailsElement>(".saldo-mas")?.open).toBe(false);
  });

  it("Copiar deja la dirección en el portapapeles", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await aTraer(mundo());
    const b = document.querySelector<HTMLButtonElement>('[data-saldo="copiar"]') as HTMLButtonElement;
    b.click();
    await vi.waitFor(() => expect(b.textContent).toBe(t("acctCopied")));
    expect(writeText).toHaveBeenCalledWith(YO);
  });

  it("Volver lleva al inicio", async () => {
    await aTraer(mundo());
    document.querySelector<HTMLButtonElement>('[data-saldo="volver"]')?.click();
    expect(principal().textContent).toBe(t("cargaYaTengo"));
    expect(document.querySelector('[data-saldo="dir"]')).toBeNull();
  });

  /** Cada estado que no es «puede», con lo que tiene que decir y su única acción. */
  const casos: Array<{ nombre: string; m: () => Mundo; dice: string; boton: string; directo?: boolean }> = [
    { nombre: "solo en Oficial", m: () => mundo({ red: "testnet" }), dice: "saldoSoloOficial", boton: "modeSwitchToOfficial", directo: true },
    { nombre: "otra red", m: () => mundo({ billetera: async () => ({ tipo: "propia", red: "testnet" }) }), dice: "Tu billetera está en otra red", boton: "saldoVolverAMirar", directo: true },
    { nombre: "no se sabe", m: () => mundo({ lectura: "sin-red" }), dice: "saldoNoSeSabe", boton: "saldoVolverAMirar", directo: true },
    { nombre: "sin billetera", m: () => mundo({ billetera: async () => null }), dice: "saldoNoSeSabe", boton: "saldoVolverAMirar", directo: true },
    { nombre: "la cuenta se está creando", m: () => mundo({ lectura: "no-existe" }), dice: "cargaCuentaPrimero", boton: "cargaCuentaPrimeroBtn", directo: true },
    { nombre: "falta proteger", m: () => mundo({ proteccion: async () => "falta" }), dice: "cargaCuentaPrimero", boton: "cargaCuentaPrimeroBtn", directo: true },
    { nombre: "protección sin saber", m: () => mundo({ proteccion: async () => null }), dice: "saldoNoSeSabe", boton: "saldoVolverAMirar", directo: true },
    { nombre: "billetera nueva", m: () => mundo({ billetera: async () => ({ tipo: "propia", red: "mainnet" }), lectura: "no-existe" }), dice: "saldoBilleteraNueva", boton: "saldoVolverAMirar", directo: true },
    { nombre: "no recibe más", m: () => mundo({ lectura: conUsdc("12.5000000", { autorizada: false }) }), dice: "saldoNoRecibeMas", boton: "acctClose" },
    { nombre: "se está activando", m: () => mundo({ lectura: mirada(), pendiente: async () => true }), dice: "saldoActivandoEspera", boton: "saldoVolverAMirar" },
    { nombre: "falta activar, la paga la app", m: () => mundo({ lectura: mirada() }), dice: "saldoActivarApp", boton: "saldoActivarBtn" },
    { nombre: "falta activar, sin saber si la paga la app", m: () => mundo({ lectura: mirada(), catalogo: async () => null }), dice: "saldoNoSeSabe", boton: "saldoVolverAMirar", directo: true },
    { nombre: "la app no la paga", m: () => mundo({ lectura: mirada(), catalogo: async () => "no-patrocinada" }), dice: "saldoNoPuedeApp", boton: "acctClose" },
    { nombre: "billetera propia sin la línea", m: () => mundo({ billetera: async () => ({ tipo: "propia", red: "mainnet" }), lectura: mirada() }), dice: "saldoActivarPropio", boton: "saldoActivarBtn" },
    { nombre: "billetera propia sin XLM", m: () => mundo({ billetera: async () => ({ tipo: "propia", red: "mainnet" }), lectura: mirada({ xlm: "1.2000000" }) }), dice: "0,5001 XLM libres y tiene 0,2", boton: "saldoVolverAMirar" },
  ];

  it.each(casos)("$nombre: dice qué falta, una sola acción y nunca la dirección", async (c) => {
    const m = c.m();
    if (c.directo) await abrir(m);
    else await aTraer(m);
    const dice = c.dice in T.es ? t(c.dice) : c.dice;
    expect(cuerpo()).toContain(dice);
    expect(principal().textContent).toBe(t(c.boton));
    expect(document.body.textContent).not.toContain(YO);
    expect(document.querySelector('[data-saldo="qr"]')).toBeNull();
    expect(document.querySelector('[data-saldo="dir"]')).toBeNull();
  });

  it("en Prueba, Pasar a Oficial cierra y abre la hoja del modo", async () => {
    const m = mundo({ red: "testnet" });
    await abrir(m);
    principal().click();
    expect(dialogo()).toBeNull();
    expect(m.pasarAOficial).toHaveBeenCalledOnce();
  });

  it("con la cuenta a medias, Dejar mi cuenta lista abre el paso y, al terminar, vuelve a mirar", async () => {
    let protegida = false;
    const m = mundo({ proteccion: async () => (protegida ? "lista" : "falta") });
    let terminar: (v: boolean) => void = () => undefined;
    m.dejarLista = vi.fn(() => new Promise<boolean>((r) => (terminar = r)));
    await abrir(m);
    principal().click();
    expect(dialogo()).toBeNull();
    expect(m.dejarLista).toHaveBeenCalledOnce();
    protegida = true;
    terminar(true);
    await vi.waitFor(() => expect(dialogo()).not.toBeNull());
    await lista();
    expect(principal().textContent).toBe(t("cargaYaTengo"));
  });

  it("si la persona sale del paso sin terminar, no se vuelve a abrir nada", async () => {
    const m = mundo({ lectura: "no-existe" });
    await abrir(m);
    principal().click();
    await Promise.resolve();
    await Promise.resolve();
    expect(dialogo()).toBeNull();
  });

  it("Volver a mirar vuelve a leer la cuenta", async () => {
    const m = mundo({ lectura: "sin-red" });
    await abrir(m);
    m.lectura = conUsdc();
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe(t("cargaYaTengo")));
  });

  it("en la práctica, en la red de prueba, avisa que es de prueba", async () => {
    await abrir(mundo({ red: "testnet", practica: true, lectura: conUsdc("3.0000000", {}, "testnet") }));
    expect(cuerpo()).toContain(t("saldoPractica"));
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe("Tenés 3 dólares digitales de prueba.");
  });
});

describe("Activar dólares digitales con una billetera propia", () => {
  const propia = (o: Partial<Mundo> = {}): Mundo => mundo({ billetera: async () => ({ tipo: "propia", red: "mainnet" }), lectura: mirada(), ...o });

  it("pide aprobarlo en la billetera y, aprobado, muestra la dirección", async () => {
    const m = propia();
    let terminar: (r: "activada") => void = () => undefined;
    m.activar = vi.fn(() => new Promise<"activada">((r) => (terminar = r)));
    await aTraer(m);
    expect(principal().textContent).toBe(t("saldoActivarBtn"));
    principal().click();
    expect(estado()).toBe(t("saldoActivarAprobar"));
    expect(principal().disabled).toBe(true);
    // Un segundo toque mientras espera no activa otra vez.
    principal().click();
    expect(m.activar).toHaveBeenCalledOnce();
    m.lectura = conUsdc("0.0000000");
    terminar("activada");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivadoOk")));
    expect(document.querySelector('[data-saldo="dir"]')?.textContent).toBe(YO);
    expect(principal().textContent).toBe(t("saldoYaMande"));
  });

  it("si no lo aprueba, lo dice y deja probar de nuevo", async () => {
    const m = propia({ activar: vi.fn(async () => "no-aprobada" as const) });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivarNoAprobado")));
    expect(principal().textContent).toBe(t("saldoActivarBtn"));
    expect(principal().disabled).toBe(false);
  });

  it("sin XLM libre, vuelve a mirar y dice cuánto falta", async () => {
    const m = propia();
    m.activar = vi.fn(async () => {
      m.lectura = mirada({ xlm: "1.2000000" });
      return "sin-xlm" as const;
    });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(cuerpo()).toContain("0,5001 XLM libres y tiene 0,2"));
    expect(principal().textContent).toBe(t("saldoVolverAMirar"));
  });

  it("si la red no la acepta, lo dice sin afirmar que no se movió nada", async () => {
    const m = propia({ activar: vi.fn(async () => "no-salio" as const) });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivarNoSalio")));
    expect(estado()).not.toMatch(/no se movió/i);
  });
});

describe("Activar dólares digitales con Google", () => {
  it("pide la línea y, cuando aparece en la red, muestra la dirección", async () => {
    const m = mundo({ lectura: mirada() });
    let vueltas = 0;
    m.pausa = async () => {
      vueltas++;
      if (vueltas === 2) m.lectura = conUsdc("0.0000000");
    };
    m.activar = vi.fn(async () => "hecho" as const);
    await aTraer(m);
    expect(principal().textContent).toBe(t("saldoActivarBtn"));
    principal().click();
    expect(estado()).toBe(t("saldoActivando"));
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivadoOk")));
    expect(m.activar).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-saldo="dir"]')?.textContent).toBe(YO);
  });

  it("si la línea no aparece todavía, dice que se está activando y no ofrece pedirla otra vez", async () => {
    const m = mundo({ lectura: mirada(), activar: vi.fn(async () => "hecho" as const) });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivandoEspera")));
    expect(principal().textContent).toBe(t("saldoVolverAMirar"));
    expect(document.body.textContent).not.toContain(YO);
    principal().click();
    await lista();
    expect(m.activar).toHaveBeenCalledOnce();
  });

  it("con el pedido en camino (co-firma pendiente), espera y no pide otro", async () => {
    let pedido = false;
    const m = mundo({
      lectura: mirada(),
      pendiente: async () => pedido,
      activar: vi.fn(async () => {
        pedido = true;
        return "en-curso" as const;
      }),
    });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivandoEspera")));
    expect(principal().textContent).toBe(t("saldoVolverAMirar"));
  });

  it("sin créditos de la app, dice que ahora no y deja probar más tarde", async () => {
    const m = mundo({ lectura: mirada(), activar: vi.fn(async () => "ahora-no" as const) });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivarAhoraNo")));
    expect(principal().textContent).toBe(t("saldoActivarBtn"));
  });

  it("si la cuenta pide protegerse, vuelve a mirar y lleva al paso de la cuenta", async () => {
    let proteccion: "lista" | "falta" = "lista";
    const m = mundo({ lectura: mirada(), proteccion: async () => proteccion });
    m.activar = vi.fn(async () => {
      proteccion = "falta";
      return "proteger" as const;
    });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe(t("cargaCuentaPrimeroBtn")));
  });
});

describe("Ya lo mandé", () => {
  /** Lo que se le dice a la persona cuando no vio llegar nada: nunca la invita a mandarlo otra vez. */
  const noInvitaAMandar = (s: string): void => {
    expect(s).toContain(t("saldoEsperaNoMandes"));
    expect(s.replace(t("saldoEsperaNoMandes"), "")).not.toMatch(/mand(a|á|alo|álo)\b|de nuevo|otra vez/i);
  };

  it("lo que llegó después de abrir la ventana es nuevo: lo dice y la principal pasa a Cerrar", async () => {
    const m = mundo({ lista: [pago(TX("a"))] });
    await aTraer(m);
    m.lista = [pago(TX("b"), { monto: 100_000_000n }), pago(TX("a"))];
    m.lectura = conUsdc("22.5000000");
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Llegaron 10 dólares digitales."));
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe("Tenés 22,5 dólares digitales.");
    expect(principal().textContent).toBe(t("acctClose"));
    principal().click();
    expect(dialogo()).toBeNull();
  });

  it("con la pestaña recargada al volver de la otra app, la base guardada antes hace ver el pago como nuevo", async () => {
    localStorage.setItem(`tinkazo:saldo-base:mainnet:${YO}`, JSON.stringify({ ms: 1, ultimoTx: TX("a") }));
    const m = mundo({ lista: [pago(TX("b"), { monto: 50_000_000n }), pago(TX("a"))] });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Llegaron 5 dólares digitales."));
  });

  it("sin nada nuevo: el último que llegó, con su fecha, y que no lo mande de nuevo", async () => {
    const m = mundo({ lista: [pago(TX("a"), { monto: 30_000_000n })] });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain(t("saldoNoVemosNuevo")));
    noInvitaAMandar(estado());
    expect(document.querySelector('[data-saldo="ultimo"]')?.textContent).toMatch(/^El último llegó el .+: 3 dólares digitales\.$/);
    expect(principal().textContent).toBe(t("saldoYaMande"));
  });

  it("sin ningún pago: todavía no vemos ninguno, y que no lo mande de nuevo", async () => {
    await aTraer(mundo());
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain(t("saldoNoLlegoTodavia")));
    noInvitaAMandar(estado());
  });

  it("los pagos de Tinkazo (nota tk:) y los de la misma cuenta no cuentan como traídos", async () => {
    const m = mundo();
    await aTraer(m);
    m.lista = [pago(TX("c"), { memo: "tk:premio:7:0" }), pago(TX("d"), { de: YO })];
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain(t("saldoNoLlegoTodavia")));
  });

  it("con el almacenamiento roto no afirma que no hay uno nuevo: muestra el último con su fecha", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const m = mundo({ lista: [pago(TX("a"))] });
    await aTraer(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoEsperaNoMandes")));
    expect(estado()).not.toContain(t("saldoNoVemosNuevo"));
    expect(document.querySelector('[data-saldo="ultimo"]')).not.toBeNull();
  });

  it("si la red no contesta no afirma nada", async () => {
    const m = mundo();
    await aTraer(m);
    m.pagosCaidos = true;
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoError")));
    expect(principal().textContent).toBe(t("saldoYaMande"));
  });

  it("con las monedas prendidas, al llegar pide las de regalo como antes", async () => {
    const m = mundo({ monedas: "https://cuenta.example.org" });
    const pedidos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        pedidos.push(String(url));
        if (String(url).includes("/payments")) {
          const r = { type: "payment", transaction_successful: true, transaction_hash: TX("e"), created_at: "2026-11-11T14:02:00Z", from: OTRA, to: YO, asset_code: "USDC", asset_issuer: usdcDeLaRed("testnet").issuer, amount: "10.0000000", transaction: { memo_type: "none" } };
          return new Response(JSON.stringify({ _embedded: { records: [r] }, _links: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ acreditado: true, monedas: 50, saldo: 50 }), { status: 200 });
      }),
    );
    await aTraer(m);
    m.lista = [pago(TX("e"))];
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Llegaron 10 dólares digitales. Sumaste 50 monedas de regalo."));
    expect(pedidos.some((u) => u.startsWith("https://cuenta.example.org"))).toBe(true);
  });
});

describe("los textos de la ventana", () => {
  const claves = Object.keys(T.es).filter((k) => /^(saldo|carga)/.test(k));

  it("están en las dos lenguas", () => {
    expect(claves.length).toBeGreaterThan(30);
    for (const k of claves) expect(typeof T.en[k], k).toBe("string");
  });

  it("sin comillas angulares, punto y coma, punto medio, rayas largas, flechas ni signos de exclamación", () => {
    for (const k of claves) {
      for (const idioma of ["es", "en"] as const) expect(String(T[idioma][k]), `${idioma}.${k}`).not.toMatch(/[«»;·—→↗!¡]/);
    }
  });

  it("sin las palabras de la cadena que la sección de traer no necesita", () => {
    const prohibidas = /\b(hash|token|trustline|transacci[oó]n|transaction|cripto|crypto|Polygon|Circle|KYC|plata)\b/i;
    for (const k of claves) {
      for (const idioma of ["es", "en"] as const) expect(String(T[idioma][k]), `${idioma}.${k}`).not.toMatch(prohibidas);
      // En inglés, wallet es la palabra de todos los días (billetera).
      expect(String(T.es[k]), `es.${k}`).not.toMatch(/\bwallet\b/i);
    }
  });
});
