// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * «Tus dólares digitales» con `VITE_RAMPA=premios`: ver el saldo y recibir un premio, y nada más. Sin Mandar, sin la
 * dirección ni el QR para traer saldo de afuera, sin «Ya lo mandé» y sin pedir el historial de pagos. Cada estado dice un
 * título, como mucho una línea y tiene una sola acción principal. Con el voto por contenido y pagar con Google (cada una
 * con su variable) la ventana suma Mandar, preparar la cuenta y cargar dólares. Todo con la cuenta y la red de mentira.
 */

let YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();

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
const conUsdc = (saldo = "12.5000000", o: Partial<CuentaMirada["saldos"][number]> = {}, extra: Partial<CuentaMirada> = {}): CuentaMirada =>
  mirada({ saldos: [{ code: "USDC", issuer: usdcDeLaRed("mainnet").issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null, ...o }], ...extra });

interface Mundo extends DepsDeSaldo {
  lectura: LecturaDeCuenta;
}

/** Una cuenta de Google en la red principal, lista y con dólares digitales, salvo que se diga otra cosa. */
function mundo(o: Partial<Mundo> = {}): Mundo {
  const m: Mundo = {
    red: "mainnet",
    practica: false,
    lectura: conUsdc(),
    billetera: async () => ({ tipo: "google" }),
    mirar: async () => m.lectura,
    proteccion: async () => "lista",
    pendiente: async () => false,
    catalogo: async () => "patrocinada",
    pagos: vi.fn(async () => ({ ok: true as const, valor: [] })),
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
const propia = (o: Partial<Mundo> = {}): Mundo => mundo({ billetera: async () => ({ tipo: "propia", red: "mainnet" }), lectura: mirada(), ...o });

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const cuerpo = (): string => document.querySelector(".dlg-cuerpo")?.textContent ?? "";
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
const abrir = async (m: Mundo): Promise<void> => {
  abrirSaldo({ address: YO }, m);
  // Cerrar está encendido desde el primer momento: se espera a que la mirada termine y pinte lo que corresponde.
  await vi.waitFor(() => {
    expect(document.querySelector('[data-saldo="mirando"]')).toBeNull();
    expect(principal().disabled).toBe(false);
  });
};
/** Lo que dice el cuerpo sin el saldo de arriba: las líneas y los avisos, uno por párrafo, y los títulos. */
const lineas = (): string[] => [...document.querySelectorAll(".saldo-paso .saldo-lead")].map((p) => p.textContent ?? "");
const titulos = (): string[] => [...document.querySelectorAll(".saldo-paso .saldo-titulo")].map((p) => p.textContent ?? "");
const hayAlgunoDe = (...ids: string[]): boolean => ids.some((id) => document.querySelector(`[data-saldo="${id}"]`) !== null);

/** Nada de traer saldo de afuera ni de mandarlo, en ningún estado. */
const sinTraerNiMandar = (): void => {
  expect(hayAlgunoDe("mandar", "dir", "qr", "copiar", "volver")).toBe(false);
  expect(document.body.textContent).not.toContain(YO);
  expect(cuerpo()).not.toContain(t("cargaYaTengo"));
  expect(document.body.textContent).not.toContain(t("saldoYaMande"));
  expect(document.body.textContent).not.toContain(t("saldoMandarBtn"));
};

beforeEach(() => {
  YO = Keypair.random().publicKey();
  document.body.innerHTML = "";
  setLang("es");
  vi.stubEnv("VITE_RAMPA", "premios");
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

describe("el modo premios, con una cuenta de Google", () => {
  it("sin la línea del dólar digital: Recibir un premio es la principal y no hay dirección, QR ni Ya tengo dólares digitales", async () => {
    await abrir(mundo({ lectura: mirada() }));
    expect(document.querySelector(".saldo-titulo")?.textContent).toBe(T.es.saldoPremioRecibirTitulo);
    // Una sola línea: el aviso de que esa cuenta no organiza ocupa el lugar de la de siempre.
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
    sinTraerNiMandar();
  });

  it("tocar Recibir un premio activa la línea con el recorrido de siempre y, cuando aparece, dice que la cuenta está lista", async () => {
    const m = mundo({ lectura: mirada() });
    let vueltas = 0;
    m.pausa = async () => {
      vueltas++;
      if (vueltas === 2) m.lectura = conUsdc("0.0000000");
    };
    m.activar = vi.fn(async () => "hecho" as const);
    await abrir(m);
    principal().click();
    expect(estado()).toBe(t("saldoActivando"));
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivadoOk")));
    expect(m.activar).toHaveBeenCalledOnce();
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    expect(principal().textContent).toBe(t("acctClose"));
    sinTraerNiMandar();
  });

  it("si la línea todavía no aparece, no ofrece pedirla otra vez: Volver a mirar", async () => {
    const m = mundo({ lectura: mirada(), activar: vi.fn(async () => "hecho" as const) });
    await abrir(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivandoEspera")));
    expect(principal().textContent).toBe(t("saldoVolverAMirar"));
    expect(m.activar).toHaveBeenCalledOnce();
  });

  it("si la regla no votó el pedido, dice que no se hizo nada y Recibir un premio sigue a la vista", async () => {
    const m = mundo({ lectura: mirada(), activar: vi.fn(async () => "no-coincide" as const) });
    await abrir(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(`${t("saldoActivarNoCoincide")} ${t("cofirmaOtraVez")}`));
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
  });

  it("un error al activar se marca como error y ocupa el lugar de la línea del paso", async () => {
    const m = propia({ activar: vi.fn(async () => "no-salio" as const) });
    await abrir(m);
    expect(lineas()).toEqual([T.es.saldoPremioActivarPropio]);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivarNoSalio")));
    expect(document.querySelector(".dlg-estado")?.classList.contains("bad")).toBe(true);
    // El error ocupa el lugar de la línea del paso: no se dice dos veces.
    expect(lineas()).toEqual([]);
    expect(titulos()).toEqual([T.es.saldoPremioRecibirTitulo]);
  });

  it("con la cuenta lista para recibir y con saldo: el saldo arriba, un título, una línea y Cerrar. Sin Mandar, dirección ni QR", async () => {
    const m = mundo();
    await abrir(m);
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe("Tenés 12,5 dólares digitales.");
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(lineas()).toHaveLength(1);
    expect(principal().textContent).toBe(t("acctClose"));
    sinTraerNiMandar();
    expect(m.mandar).not.toHaveBeenCalled();
    principal().click();
    expect(dialogo()).toBeNull();
  });

  it("sin saldo todavía, lo dice tal cual y tampoco ofrece mandar", async () => {
    await abrir(mundo({ lectura: conUsdc("0.0000000") }));
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe(t("cargaTenesNada"));
    sinTraerNiMandar();
  });

  it("pedir la vista de traer no cambia nada: la dirección para cargar todavía no se ofrece en este modo", async () => {
    abrirSaldo({ address: YO }, mundo(), { vista: "traer" });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-saldo="mirando"]')).toBeNull();
      expect(principal().disabled).toBe(false);
    });
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(principal().textContent).toBe(t("acctClose"));
    sinTraerNiMandar();
  });

  it("al cerrarla avisa a quien la abrió, también en este modo", async () => {
    const alCerrar = vi.fn();
    abrirSaldo({ address: YO }, mundo(), { vista: "traer", alCerrar });
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    principal().click();
    expect(dialogo()).toBeNull();
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it("lo de cómo sacar el dinero va plegado y dice que retirar llega más adelante, no que se pueda mandar", async () => {
    await abrir(mundo());
    const plegado = document.querySelector<HTMLDetailsElement>(".saldo-mas");
    expect(plegado?.open).toBe(false);
    expect(plegado?.querySelector("summary")?.textContent).toBe(t("cargaComoSaco"));
    expect(plegado?.textContent).toContain(T.es.saldoPremioRetirarLuego as string);
    expect(document.body.textContent).not.toContain(T.es.cargaComoSacoTexto as string);
    expect(document.body.textContent).not.toMatch(/mandarlos|podés mandar/i);
  });

  it("el plegado suma lo que cuesta retirar, después de decir que retirar llega más adelante", async () => {
    await abrir(mundo({ costoDelRetiro: () => "0,50" }));
    const parrafos = [...document.querySelectorAll(".saldo-mas p")].map((p) => p.textContent);
    const porQue = "Cada retiro cuesta 0,50 dólares digitales, sea cual sea el monto. Recibir premios es gratis.";
    expect(parrafos).toEqual([T.es.saldoPremioRetirarLuego, porQue]);
    expect(document.body.textContent).not.toContain("{c}");
  });

  it("en inglés el costo lleva el punto decimal", async () => {
    setLang("en");
    await abrir(mundo({ costoDelRetiro: () => "0.50" }));
    expect(document.querySelector(".saldo-mas")?.textContent).toContain("Each withdrawal costs 0.50 digital dollars, whatever the amount.");
  });

  it("sin costo configurado, el plegado dice solo lo de antes", async () => {
    await abrir(mundo({ costoDelRetiro: () => null }));
    const parrafos = [...document.querySelectorAll(".saldo-mas p")].map((p) => p.textContent);
    expect(parrafos).toEqual([T.es.saldoPremioRetirarLuego]);
  });

  it("con la configuración del sitio de hoy, que no prende el costo, el plegado dice solo lo de antes", async () => {
    vi.stubEnv("VITE_RETIRO_COSTO", "");
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    await abrir(mundo());
    const parrafos = [...document.querySelectorAll(".saldo-mas p")].map((p) => p.textContent);
    expect(parrafos).toEqual([T.es.saldoPremioRetirarLuego]);
  });

  it("no pide el historial de pagos: no se arma la base de Ya lo mandé", async () => {
    const m = mundo();
    await abrir(m);
    // Un respiro para que cualquier lectura pendiente salga.
    await new Promise((r) => setTimeout(r, 20));
    expect(m.pagos).not.toHaveBeenCalled();
  });

  it("mientras mira la cuenta, la principal dice Cerrar y cierra: no hay un botón que diga Cerrar y no haga nada", async () => {
    abrirSaldo({ address: YO }, mundo({ mirar: () => new Promise<LecturaDeCuenta>(() => undefined) }));
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMirandoCuenta")));
    expect(document.querySelector('[data-saldo="mirando"]')).not.toBeNull();
    expect(principal().textContent).toBe(t("acctClose"));
    expect(principal().disabled).toBe(false);
    expect(document.body.textContent).not.toContain(YO);
    principal().click();
    expect(dialogo()).toBeNull();
  });

  it("mientras se activa: Volver a mirar. Si no puede recibir más: Cerrar. Sin Volver en ninguno", async () => {
    await abrir(mundo({ lectura: mirada(), pendiente: async () => true }));
    expect(cuerpo()).toContain(t("saldoActivandoEspera"));
    expect(principal().textContent).toBe(t("saldoVolverAMirar"));
    sinTraerNiMandar();

    document.body.innerHTML = "";
    await abrir(mundo({ lectura: conUsdc("12.5000000", { autorizada: false }) }));
    expect(document.querySelector(".saldo-titulo")?.textContent).toBe(t("saldoNoMandesTitulo"));
    expect(cuerpo()).toContain(t("saldoNoRecibeMas"));
    expect(principal().textContent).toBe(t("acctClose"));
    sinTraerNiMandar();
  });

  it("antes de prepararla, avisa que con esa cuenta ya no se organiza", async () => {
    await abrir(mundo({ lectura: mirada() }));
    expect(document.querySelector('[data-saldo="aviso"]')?.textContent).toBe(T.es.saldoPremioNoOrganiza);
    expect(T.es.saldoPremioNoOrganiza).toBe("Mientras reciba premios, esta cuenta no organiza sorteos.");
  });

  it("una cuenta con una firma que no es la suya: una línea suelta que avisa, y Recibir un premio sigue a la vista", async () => {
    // La regla supone cómo nacen las cuentas del proveedor y se midió en una sola cuenta real: no puede esconder el premio.
    await abrir(mundo({ lectura: mirada({ firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 1 }] }) }));
    expect(lineas()).toEqual([T.es.saldoPremioNoApta, T.es.saldoPremioNoOrganiza]);
    expect(document.querySelector(".saldo-titulo")?.textContent).toBe(T.es.saldoPremioRecibirTitulo);
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
    sinTraerNiMandar();
  });

  it("con la línea y una firma que no es la suya, también avisa y deja Cerrar", async () => {
    await abrir(mundo({ lectura: conUsdc("12.5000000", {}, { firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 1 }] }) }));
    expect(lineas()).toEqual([T.es.saldoPremioNoApta, T.es.saldoPremioNoOrganiza]);
    expect(principal().textContent).toBe(t("acctClose"));
  });

  it("con la línea ya puesta, también avisa que esa cuenta no sella ni sortea, en lugar de otra línea", async () => {
    await abrir(mundo());
    expect(document.querySelector('[data-saldo="aviso"]')?.textContent).toBe(T.es.saldoPremioNoOrganiza);
    expect(lineas()).toEqual([T.es.saldoPremioNoOrganiza]);
    expect(cuerpo()).not.toContain(T.es.saldoPremioLlegaSolo as string);
    // La dirección no se muestra en la ventana: está en el panel de la cuenta.
    expect(document.body.textContent).not.toContain(YO);
  });

  it("una cuenta como las del proveedor (solo su llave), o sin el dato de los firmantes, se ve como siempre", async () => {
    await abrir(mundo({ lectura: mirada({ firmantes: [{ clave: YO, peso: 1 }] }) }));
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
    document.body.innerHTML = "";
    await abrir(mundo({ lectura: mirada({ firmantes: null }) }));
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
    document.body.innerHTML = "";
    // Una firma ajena sin peso no firma nada.
    await abrir(mundo({ lectura: mirada({ firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 0 }] }) }));
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
  });

  it("en inglés dice lo mismo", async () => {
    setLang("en");
    await abrir(mundo({ lectura: mirada() }));
    expect(document.querySelector(".saldo-titulo")?.textContent).toBe(T.en.saldoPremioRecibirTitulo);
    expect(lineas()).toEqual([T.en.saldoPremioNoOrganiza]);
    expect(principal().textContent).toBe("Get my account ready");

    document.body.innerHTML = "";
    await abrir(mundo());
    expect(document.querySelector('[data-saldo="total"]')?.textContent).toBe("You have 12.5 digital dollars.");
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(document.querySelector(".saldo-mas")?.textContent).toContain(T.en.saldoPremioRetirarLuego as string);
    expect(principal().textContent).toBe("Close");
  });
});

describe("el modo premios, con una billetera propia", () => {
  it("sin la línea: Recibir un premio usa el mismo activar y pide aprobarlo en la billetera", async () => {
    const m = propia();
    let terminar: (r: "activada") => void = () => undefined;
    m.activar = vi.fn(() => new Promise<"activada">((r) => (terminar = r)));
    await abrir(m);
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
    expect(cuerpo()).toContain(t("saldoPremioActivarPropio"));
    // El texto de antes hablaba de dólares digitales que ya no están en el título: no se mezcla.
    expect(cuerpo()).not.toContain(t("saldoActivarPropio"));
    expect(T.es.saldoPremioActivarPropio).not.toContain("sigan activados");
    // Su billetera sí organiza: el aviso de la cuenta de Google no va.
    expect(document.querySelector('[data-saldo="aviso"]')).toBeNull();
    principal().click();
    expect(estado()).toBe(t("saldoActivarAprobar"));
    expect(m.activar).toHaveBeenCalledOnce();
    m.lectura = conUsdc("0.0000000");
    terminar("activada");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoActivadoOk")));
    expect(titulos(), "con el saldo arriba no se repite que la cuenta está lista").toEqual([]);
    expect(lineas()).toEqual([T.es.saldoPremioLlegaSolo]);
    sinTraerNiMandar();
  });

  it("con la línea: el plegado dice que lo mueve desde su billetera, no que retirar llega más adelante", async () => {
    await abrir(propia({ lectura: conUsdc() }));
    // Su billetera sí organiza: ni siquiera con la línea puesta sale el aviso de la cuenta de Google.
    expect(document.querySelector('[data-saldo="aviso"]')).toBeNull();
    const plegado = document.querySelector(".saldo-mas");
    expect(plegado?.textContent).toContain(T.es.saldoPremioRetirarPropia as string);
    expect(plegado?.textContent).not.toContain(T.es.saldoPremioRetirarLuego as string);
    sinTraerNiMandar();
  });

  it("con su billetera el plegado no dice lo que cuesta retirar: ese retiro no pasa por Tinkazo", async () => {
    await abrir(propia({ lectura: conUsdc(), costoDelRetiro: () => "0,50" }));
    const parrafos = [...document.querySelectorAll(".saldo-mas p")].map((p) => p.textContent);
    expect(parrafos).toEqual([T.es.saldoPremioRetirarPropia]);
  });

  it("no mira los firmantes: una billetera puede tener las firmas que quiera", async () => {
    await abrir(propia({ lectura: mirada({ firmantes: [{ clave: YO, peso: 1 }, { clave: OTRA, peso: 1 }] }) }));
    expect(principal().textContent).toBe(T.es.saldoPremioRecibirBtn);
  });

  it("sin XLM libre, dice cuánto falta bajo el título del premio", async () => {
    await abrir(propia({ lectura: mirada({ xlm: "1.2000000" }) }));
    expect(document.querySelector(".saldo-titulo")?.textContent).toBe(T.es.saldoPremioRecibirTitulo);
    expect(cuerpo()).toContain("0,5001 XLM libres y tiene 0,2");
    expect(principal().textContent).toBe(t("saldoVolverAMirar"));
  });
});

describe("la cuenta que todavía necesita el paso, en el modo premios", () => {
  const CASOS: Array<[string, () => Mundo]> = [
    ["se está creando", () => mundo({ lectura: "no-existe" })],
    ["falta proteger", () => mundo({ proteccion: async () => "falta" })],
  ];

  it.each(CASOS)("%s: la línea habla de recibir el premio y la principal deja la cuenta lista", async (_nombre, m) => {
    await abrir(m());
    expect(cuerpo()).toContain("Para recibir tu premio, dejá tu cuenta lista.");
    expect(principal().textContent).toBe("Dejar mi cuenta lista");
  });

  it.each(CASOS)("%s: en inglés dice lo mismo, en inglés", async (_nombre, m) => {
    setLang("en");
    await abrir(m());
    expect(cuerpo()).toContain("To receive your prize, get your account ready.");
  });

  it.each(CASOS)("%s: fuera del modo premios sigue la línea de siempre", async (_nombre, m) => {
    vi.stubEnv("VITE_RAMPA", "pollar");
    await abrir(m());
    expect(cuerpo()).toContain("Para cargar, primero dejá tu cuenta lista.");
    expect(cuerpo()).not.toContain("premio");
  });
});
