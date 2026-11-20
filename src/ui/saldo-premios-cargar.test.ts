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
 * «Tus dólares digitales» con `VITE_RAMPA=premios` cuando el navegador vota a mano lo que arma la página
 * (`VITE_VOTO_POR_CONTENIDO=1`) y, además, con pagar con Google (`VITE_PAGAR_CON_GOOGLE=1`): la cuenta de Google que ya
 * puede recibir sigue organizando, retira con Mandar, se prepara para recibir y pagar, y carga dólares desde otra app con
 * su dirección y su QR. Cada estado dice un título, como mucho una línea y tiene una sola acción principal. Todo con la
 * cuenta y la red de mentira.
 */

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
/** La línea del dólar digital de una red, con su saldo, autorizada o no. */
const linea = (red: "mainnet" | "testnet", saldo: string, autorizada = true): CuentaMirada["saldos"][number] => ({
  code: "USDC",
  issuer: usdcDeLaRed(red).issuer,
  saldo,
  limite: "922337203685.4775807",
  autorizada,
  patrocinador: null,
});
const conUsdc = (saldo = "12.5000000", extra: Partial<CuentaMirada> = {}): CuentaMirada => mirada({ saldos: [linea("mainnet", saldo)], ...extra });
/** La línea del dólar digital puesta pero sin autorizar: la cuenta no puede recibir más. */
const sinAutorizar = (): CuentaMirada => mirada({ saldos: [linea("mainnet", "12.5000000", false)] });
const pago = (tx: string, o: Partial<Pago> = {}): Pago => ({
  de: OTRA,
  a: YO,
  monto: 100_000_000n,
  tx,
  memo: null,
  ms: Date.UTC(2026, 10, 18, 14, 2),
  ...o,
});

interface Mundo extends DepsDeSaldo {
  lectura: LecturaDeCuenta;
  lista: Pago[];
}

/** Una cuenta de Google en la red principal, lista, con dólares digitales y con el kit votando a mano, salvo que se diga otra cosa. */
function mundo(o: Partial<Mundo> = {}): Mundo {
  const m: Mundo = {
    red: "mainnet",
    practica: false,
    lectura: conUsdc(),
    lista: [],
    billetera: async () => ({ tipo: "google" }),
    mirar: async () => m.lectura,
    proteccion: async () => "lista",
    pendiente: async () => false,
    catalogo: async () => "patrocinada",
    pagos: vi.fn(async () => ({ ok: true as const, valor: [...m.lista] })),
    activar: vi.fn(async () => "activada" as const),
    pausa: async () => undefined,
    monedas: null,
    dejarLista: vi.fn(async () => false),
    pasarAOficial: vi.fn(),
    mandar: vi.fn(),
    votaPorContenido: async () => true,
    ...o,
  };
  return m;
}
const propia = (o: Partial<Mundo> = {}): Mundo => mundo({ billetera: async () => ({ tipo: "propia", red: "mainnet" }), ...o });

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const cuerpo = (): string => document.querySelector(".dlg-cuerpo")?.textContent ?? "";
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
const lineas = (): string[] => [...document.querySelectorAll(".saldo-paso .saldo-lead")].map((p) => p.textContent ?? "");
const titulos = (): string[] => [...document.querySelectorAll(".saldo-paso .saldo-titulo")].map((p) => p.textContent ?? "");
/** La acción de cargar o de mandar es la principal si es la primera, y un enlace si hay otra antes. */
const comoPrincipal = (id: string): boolean => {
  const rotulo = id === "cargar" ? t("saldoCargarBtn") : id === "mandar" ? t("saldoMandarBtn") : null;
  return rotulo !== null && document.querySelector(".dlg-main")?.textContent === rotulo;
};
const hay = (id: string): boolean => document.querySelector(`[data-saldo="${id}"]`) !== null || comoPrincipal(id);
const toque = (id: string): void => {
  const e = document.querySelector<HTMLButtonElement>(`[data-saldo="${id}"]`);
  if (e) e.click();
  else if (comoPrincipal(id)) principal().click();
};
const abrir = async (m: Mundo, opciones: Parameters<typeof abrirSaldo>[2] = {}): Promise<void> => {
  abrirSaldo({ address: YO }, m, opciones);
  await vi.waitFor(() => {
    expect(document.querySelector('[data-saldo="mirando"]')).toBeNull();
    expect(principal().disabled).toBe(false);
  });
};

beforeEach(() => {
  YO = Keypair.random().publicKey();
  document.body.innerHTML = "";
  setLang("es");
  vi.stubEnv("VITE_RAMPA", "premios");
  vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
  vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "");
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

describe("con el voto por contenido y el kit votando a mano", () => {
  it("sin la línea: no avisa que esa cuenta no organiza, y dice la línea de siempre", async () => {
    await abrir(mundo({ lectura: mirada() }));
    expect(titulos()).toEqual([T.es.saldoPremioRecibirTitulo]);
    expect(lineas()).toEqual([T.es.saldoPremioRecibirLinea]);
    expect(hay("aviso")).toBe(false);
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
  });

  it("con la línea y con saldo: una línea y Mandar como única principal, y Cerrar en la X", async () => {
    await abrir(mundo());
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(lineas()).toEqual([T.es.saldoPremioLlegaSolo]);
    expect(hay("aviso")).toBe(false);
    expect(principal().textContent).toBe(t("saldoMandarBtn"));
    // Sin Cargar: pagar con Google sigue apagado.
    expect(hay("cargar")).toBe(false);
    expect(hay("dir")).toBe(false);
  });

  it("tocar Mandar cierra la ventana y abre el retiro con el saldo de la cuenta en stroops", async () => {
    const m = mundo();
    await abrir(m);
    toque("mandar");
    expect(dialogo()).toBeNull();
    expect(m.mandar).toHaveBeenCalledTimes(1);
    expect(m.mandar).toHaveBeenCalledWith(YO, 125_000_000n);
  });

  it("sin saldo no se ofrece mandar", async () => {
    await abrir(mundo({ lectura: conUsdc("0.0000000") }));
    expect(hay("mandar")).toBe(false);
    expect(lineas()).toEqual([T.es.saldoPremioLlegaSolo]);
  });

  it("si el kit no votó a mano, la cuenta sigue sin organizar: el aviso ocupa la línea y no hay Mandar", async () => {
    const m = mundo({ votaPorContenido: async () => false });
    await abrir(m);
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    expect(hay("mandar")).toBe(false);
  });

  it("si no se pudo saber si el kit vota a mano, cuenta como que no", async () => {
    const m = mundo({ votaPorContenido: async () => Promise.reject(new Error("sin kit")) });
    await abrir(m);
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    expect(hay("mandar")).toBe(false);
  });

  it("con una billetera propia nunca hay Mandar desde acá, ni siquiera con el voto", async () => {
    await abrir(propia({ lectura: conUsdc() }));
    expect(hay("mandar")).toBe(false);
    expect(hay("aviso")).toBe(false);
  });

  it("el plegado dice solo lo que cuesta retirar, y sin costo no hay plegado", async () => {
    await abrir(mundo({ costoDelRetiro: () => "0,50" }));
    const parrafos = [...document.querySelectorAll(".saldo-mas p")].map((p) => p.textContent);
    expect(parrafos).toEqual(["Cada retiro cuesta 0,50 dólares digitales, sea cual sea el monto. Recibir premios es gratis."]);
    document.body.innerHTML = "";
    await abrir(mundo({ costoDelRetiro: () => null }));
    expect(document.querySelector(".saldo-mas")).toBeNull();
  });

  it("en la práctica de la red de prueba no avisa que no organiza: ahí la puerta del premio no corre", async () => {
    const prueba = mirada({ saldos: [linea("testnet", "12.5000000")] });
    await abrir(mundo({ red: "testnet", practica: true, lectura: prueba, votaPorContenido: async () => false }));
    expect(hay("aviso")).toBe(false);
    expect(lineas()).toEqual([T.es.saldoPremioLlegaSolo]);
  });

  it("una cuenta con un acceso que Tinkazo no puso avisa, y el aviso ocupa la línea", async () => {
    await abrir(mundo({ lectura: conUsdc("12.5000000", { firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 1 }] }) }));
    // El título dice qué hacer, la línea dice por qué y la acción que importa es sacar los dólares de esa cuenta.
    expect(titulos()).toEqual([T.es.saldoAjenaTitulo]);
    expect(lineas()).toEqual([T.es.saldoPremioNoApta]);
    expect(principal().textContent).toBe(t("saldoMandarBtn"));
    document.body.innerHTML = "";
    await abrir(mundo({ lectura: conUsdc("0.0000000", { firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 1 }] }) }));
    expect(principal().textContent).toBe(t("acctClose"));
  });
});

describe("con pagar con Google", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "1");
  });

  it("sin la línea: prepara la cuenta para recibir y para pagar, con una sola acción", async () => {
    const m = mundo({ lectura: mirada() });
    await abrir(m);
    expect(titulos()).toEqual([T.es.saldoPrepTitulo]);
    expect(lineas()).toEqual([T.es.saldoPrepLinea]);
    expect(principal().textContent).toBe(T.es.saldoPrepBtn);
    principal().click();
    await vi.waitFor(() => expect(m.activar).toHaveBeenCalledOnce());
  });

  it("con la línea: Cargar dólares digitales es la principal, y Mandar si hay saldo, un enlace; Cerrar queda en la X", async () => {
    await abrir(mundo());
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(lineas()).toEqual([T.es.saldoPuedeLinea]);
    expect(principal().textContent).toBe(T.es.saldoCargarBtn);
    expect(document.querySelector('[data-saldo="mandar"]')?.textContent).toBe(t("saldoMandarBtn"));
    expect(hay("dir")).toBe(false);
  });

  it("Cargar muestra la dirección, el QR, Copiar y la nota vacía, con Ya lo mandé como única principal", async () => {
    await abrir(mundo());
    toque("cargar");
    expect(titulos()).toEqual([T.es.saldoRecibirTitulo]);
    expect(lineas()).toEqual([T.es.saldoCargarOjo]);
    expect(document.querySelector('[data-saldo="dir"]')?.textContent).toBe(YO);
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('[data-saldo="qr"]')?.dataset.qr).toBe(YO));
    expect(hay("copiar")).toBe(true);
    expect(cuerpo()).toContain(t("saldoNotaVacia"));
    expect(document.querySelector(".saldo-mas")?.textContent).toContain(T.es.saldoCargarComo as string);
    expect(principal().textContent).toBe(t("saldoYaMande"));
  });

  it("con un acceso que Tinkazo no puso no se ofrece cargar, ni abierta directo en traer: quedan el aviso y Mandar", async () => {
    const ajena = (): CuentaMirada => conUsdc("12.5000000", { firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 1 }] });
    await abrir(mundo({ lectura: ajena() }));
    expect(hay("cargar")).toBe(false);
    expect(titulos()).toEqual([T.es.saldoAjenaTitulo]);
    expect(lineas()).toEqual([T.es.saldoPremioNoApta]);
    expect(hay("mandar")).toBe(true);
    document.body.innerHTML = "";
    await abrir(mundo({ lectura: ajena() }), { vista: "traer" });
    expect(hay("dir")).toBe(false);
    expect(hay("qr")).toBe(false);
    expect(principal().textContent).toBe(t("saldoMandarBtn"));
  });

  it("Volver deja la pantalla de la cuenta", async () => {
    await abrir(mundo());
    toque("cargar");
    toque("volver");
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(principal().textContent).toBe(t("saldoCargarBtn"));
  });

  it("Ya lo mandé ve un pago nuevo, dice cuánto llegó y la principal pasa a Cerrar", async () => {
    const m = mundo({ lista: [pago(TX("a"))] });
    await abrir(m);
    toque("cargar");
    m.lista = [pago(TX("b"), { monto: 100_000_000n }), pago(TX("a"))];
    m.lectura = conUsdc("22.5000000");
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Llegaron 10 dólares digitales."));
    // La vista de cargar no repite el saldo arriba: el pie dice cuánto llegó.
    expect(document.querySelector('[data-saldo="total"]')).toBeNull();
    expect(principal().textContent).toBe(t("acctClose"));
  });

  it("Ya lo mandé, sin nada nuevo, no invita a mandar de nuevo", async () => {
    const m = mundo({ lista: [pago(TX("a"), { monto: 30_000_000n })] });
    await abrir(m);
    toque("cargar");
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain(t("saldoNoVemosNuevo")));
    expect(estado()).toContain(t("saldoEsperaNoMandes"));
    expect(principal().textContent).toBe(t("saldoYaMande"));
  });

  it("abierta directo en traer, como la abre Pagar premio, va a la dirección sin pasar por el inicio", async () => {
    await abrir(mundo(), { vista: "traer" });
    expect(titulos()).toEqual([T.es.saldoRecibirTitulo]);
    expect(document.querySelector('[data-saldo="dir"]')?.textContent).toBe(YO);
    expect(principal().textContent).toBe(t("saldoYaMande"));
  });

  it("abierta directo en traer, sin la línea, primero prepara la cuenta", async () => {
    await abrir(mundo({ lectura: mirada() }), { vista: "traer" });
    expect(titulos()).toEqual([T.es.saldoPrepTitulo]);
    expect(hay("dir")).toBe(false);
    expect(principal().textContent).toBe(T.es.saldoPrepBtn);
  });

  it("el historial de pagos se pide solo cuando la cuenta ya puede recibir", async () => {
    const sinLinea = mundo({ lectura: mirada() });
    await abrir(sinLinea);
    await new Promise((r) => setTimeout(r, 20));
    expect(sinLinea.pagos).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    const conLinea = mundo();
    await abrir(conLinea);
    await vi.waitFor(() => expect(conLinea.pagos).toHaveBeenCalled());
  });

  it("con una billetera propia no hay Cargar, ni preparar con su título: la billetera tiene su dirección", async () => {
    await abrir(propia({ lectura: conUsdc() }));
    expect(hay("cargar")).toBe(false);
    expect(hay("dir")).toBe(false);
    document.body.innerHTML = "";
    await abrir(propia({ lectura: mirada() }));
    expect(titulos()).toEqual([T.es.saldoPremioRecibirTitulo]);
  });

  it("en la práctica de la red de prueba no hay Cargar: Google solo carga en la red principal", async () => {
    const prueba = mirada({ saldos: [linea("testnet", "12.5000000")] });
    await abrir(mundo({ red: "testnet", practica: true, lectura: prueba }));
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(hay("cargar")).toBe(false);
  });

  it("sin el voto por contenido la variable no hace nada: ni Cargar ni preparar la cuenta", async () => {
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "");
    await abrir(mundo({ votaPorContenido: undefined }));
    expect(hay("cargar")).toBe(false);
    expect(hay("mandar")).toBe(false);
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    document.body.innerHTML = "";
    await abrir(mundo({ lectura: mirada(), votaPorContenido: undefined }));
    expect(titulos()).toEqual([T.es.saldoPremioRecibirTitulo]);
  });

  it("si el kit no votó a mano, la variable no hace nada: la cuenta no podría pagar lo que cargue", async () => {
    await abrir(mundo({ votaPorContenido: async () => false }));
    expect(hay("cargar")).toBe(false);
    expect(hay("mandar")).toBe(false);
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    document.body.innerHTML = "";
    await abrir(mundo({ lectura: mirada(), votaPorContenido: async () => false }));
    expect(titulos()).toEqual([T.es.saldoPremioRecibirTitulo]);
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
  });

  it("con otro modo de la rampa, la variable no hace nada", async () => {
    vi.stubEnv("VITE_RAMPA", "recibir");
    await abrir(mundo());
    expect(hay("cargar")).toBe(false);
    expect(lineas()).toEqual([t("saldoLead")]);
  });

  it("cada estado tiene un título, a lo más una línea y una sola acción principal", async () => {
    const estados: Array<[string, () => Mundo]> = [
      ["sin la línea", () => mundo({ lectura: mirada() })],
      ["con la línea", () => mundo()],
      ["se está activando", () => mundo({ lectura: mirada(), pendiente: async () => true })],
      ["no recibe más", () => mundo({ lectura: sinAutorizar() })],
    ];
    for (const [nombre, armar] of estados) {
      document.body.innerHTML = "";
      await abrir(armar());
      expect(titulos().length, nombre).toBeLessThanOrEqual(1);
      expect(lineas().length, nombre).toBeLessThanOrEqual(1);
      expect(document.querySelectorAll(".dlg-main"), nombre).toHaveLength(1);
    }
  });

  it("en inglés dice lo mismo, en inglés", async () => {
    setLang("en");
    await abrir(mundo({ lectura: mirada() }));
    expect(titulos()).toEqual(["Get your account ready"]);
    expect(lineas()).toEqual(["To receive prizes and add dollars, free and in a moment."]);
    expect(principal().textContent).toBe("Get my account ready");
    document.body.innerHTML = "";
    await abrir(mundo());
    expect(lineas()).toEqual(["Add dollars to pay your draws' prizes."]);
    toque("cargar");
    expect(lineas()).toEqual(["Send only USDC on Stellar: any other currency can be lost."]);
    expect(principal().textContent).toBe("I've sent it");
  });
});

describe("los textos de la ventana del premio", () => {
  const CLAVES = [
    "saldoPremioRecibirLinea",
    "saldoPremioActivarPropio",
    "saldoPremioNoOrganiza",
    "saldoPremioLlegaSolo",
    "saldoPremioRetirarLuego",
    "saldoPremioRetirarPropia",
    "saldoPremioNoApta",
    "saldoPremioListoTitulo",
    "saldoAjenaTitulo",
    "saldoPrepTitulo",
    "saldoPrepLinea",
    "saldoPrepBtn",
    "saldoPuedeLinea",
    "saldoCargarBtn",
    "saldoCargarOjo",
    "saldoCargarComo",
  ] as const;

  it("existen en español y en inglés y no dejan variables sin llenar", () => {
    for (const k of CLAVES) {
      expect(T.es[k], `es ${k}`).toBeTruthy();
      expect(T.en[k], `en ${k}`).toBeTruthy();
      expect(String(T.es[k]), `es ${k}`).not.toMatch(/\{[a-z]+\}/);
    }
  });

  it("son cortos: una oración cada uno, sin signos que el sitio no escribe ni palabras técnicas", () => {
    for (const k of CLAVES) {
      const es = String(T.es[k]);
      const en = String(T.en[k]);
      for (const [idioma, s] of [["es", es], ["en", en]] as const) {
        expect(s, `${idioma} ${k}`).not.toMatch(/[;«»<>—·!¡]/);
        expect(s.replace(/\.$/, ""), `${idioma} ${k} una oración`).not.toMatch(/\.\s/);
        expect(s.length, `${idioma} ${k} largo`).toBeLessThanOrEqual(100);
      }
      expect(es, k).not.toMatch(/\b(firma|firmar|hash|red|comisi[oó]n|contrato|xdr|co-?firma)\b/i);
      expect(en, k).not.toMatch(/\b(sign|signs|signed|signature|hash|network|fee|contract|xdr|co-?sign)\b/i);
    }
  });
});
