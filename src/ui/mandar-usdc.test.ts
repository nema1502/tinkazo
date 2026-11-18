// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { textos } from "../idioma";
import { USDC_MAINNET } from "../stellar/pagos";
import type { CostoDelRetiro } from "../stellar/pagos-regla";
import type { CuentaMirada, LecturaDeCuenta } from "../stellar/usdc-cuenta";
import {
  type DatosDelEnvio,
  type DepsDeMandar,
  abrirMandar,
  deAUnDolar,
  deAUnDolarConCosto,
  depsDelSitio,
  faltaParaRetirar,
  leerDireccion,
  leerNota,
  mandarPermitido,
  minimoParaRetirar,
  mitadDe,
  prepararEnvio,
  puedeRecibir,
  puedeRetirar,
  seOfreceLaMitad,
} from "./mandar-usdc";

// La billetera activa del sitio, de mentira: solo se mira que `enviar` la deje o no sin tocar.
const billetera = vi.hoisted(() => ({ activa: null as null | { address: string; signTransaction: () => Promise<{ signedTxXdr: string }> } }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => billetera.activa }));
vi.mock("../stellar/wallet-pollar", () => ({ submitsItself: () => false }));

/**
 * Mandar mis dólares digitales (`mandar-usdc.ts`): pegar la dirección y la nota, elegir cuánto con botones, mirar que la
 * cuenta de destino pueda recibir antes de dejar mandar, y armar el pago que firma la cuenta. Todo con cuentas y
 * billeteras de mentira: nada sale de la prueba.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const D = 10_000_000n;

const mirada = (saldo: string | null, o: Partial<CuentaMirada> = {}): CuentaMirada => ({
  secuencia: "500",
  saldos: saldo === null ? [] : [{ code: "USDC", issuer: USDC_MAINNET.issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null }],
  xlm: "2.0000000",
  xlmComprometido: "0.0000000",
  subentradas: 1,
  patrocinando: 0,
  patrocinadas: 1,
  ...o,
});

/** Lo que la ventana pidió armar (el armado de verdad, con el SDK, se prueba en mandar-usdc-pago.test.ts). */
const leer = (xdr: string): { destino: string; monto: string; nota: DatosDelEnvio["nota"] } => JSON.parse(xdr.slice("ARMADO:".length)) as never;

describe("lo que se pega y lo que se elige", () => {
  it("la nota: vacía es ninguna, un número es una nota numérica, un texto corto es texto, uno largo no sirve", () => {
    expect(leerNota("  ")).toEqual({ tipo: "ninguna" });
    expect(leerNota(" 1234567 ")).toEqual({ tipo: "id", valor: "1234567" });
    expect(leerNota("18446744073709551615")).toEqual({ tipo: "id", valor: "18446744073709551615" });
    expect(leerNota("18446744073709551616")).toEqual({ tipo: "texto", valor: "18446744073709551616" });
    expect(leerNota("ABC xyz")).toEqual({ tipo: "texto", valor: "ABC xyz" });
    expect(leerNota("a".repeat(29))).toBeNull();
  });

  it("la dirección: una cuenta G con su control, sin espacios alrededor", () => {
    expect(leerDireccion(`  ${OTRA}\n`)).toBe(OTRA);
    expect(leerDireccion(`${OTRA.slice(0, -1)}${OTRA.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(leerDireccion(`M${OTRA.slice(1)}`)).toBeNull();
    expect(leerDireccion("hola")).toBeNull();
  });

  it("Todo, La mitad y de a 1 dólar, sin pasarse de lo que hay ni bajar de 1 dólar", () => {
    const saldo = 125n * D / 10n;
    expect(mitadDe(saldo)).toBe(62_500_000n);
    expect(deAUnDolar(saldo, -1, saldo)).toBe(115n * D / 10n);
    expect(deAUnDolar(saldo, 1, saldo)).toBe(saldo);
    expect(deAUnDolar(13n * D / 10n, -1, saldo)).toBe(D);
    expect(deAUnDolar(D / 2n, -1, D / 2n)).toBe(D / 2n);
  });
});

/* ------------------------------------------------------------------ la ventana */

interface Mundo extends DepsDeMandar {
  portapapeles: string | null;
  destino: LecturaDeCuenta;
  enviados: string[];
  /** Los datos que la ventana pidió preparar, y los que entregó junto con cada envío. */
  preparados: DatosDelEnvio[];
  datosEnviados: (DatosDelEnvio | undefined)[];
  respuesta: "listo" | "en-curso" | "no-aprobado" | "no-salio";
}

function mundo(o: Partial<Mundo> = {}): Mundo {
  const m: Mundo = {
    red: "mainnet",
    portapapeles: OTRA,
    destino: mirada("0.0000000"),
    enviados: [],
    preparados: [],
    datosEnviados: [],
    respuesta: "listo",
    mirar: async (c) => (c === YO ? mirada("12.5000000") : m.destino),
    preparar: async (d) => {
      m.preparados.push(d);
      const llega = d.costo ? d.monto - d.costo.stroops : d.monto;
      if (!puedeRecibir(m.destino, d.red, llega)) return { ok: false, motivo: "no-recibe" };
      return { ok: true, xdr: `ARMADO:${JSON.stringify({ destino: d.destino, monto: String(d.monto), nota: d.nota })}` };
    },
    pegar: async () => m.portapapeles,
    enviar: async (xdr, _origen, datos) => {
      m.enviados.push(xdr);
      m.datosEnviados.push(datos);
      return m.respuesta;
    },
    ...o,
  };
  return m;
}

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
const tocar = (k: string): void => document.querySelector<HTMLButtonElement>(`[data-mandar="${k}"]`)?.click();
const abrir = (m: Mundo): void => abrirMandar({ address: YO, saldo: 125n * D / 10n }, m);
const conDestino = async (m: Mundo): Promise<void> => {
  abrir(m);
  tocar("pegar-dir");
  await vi.waitFor(() => expect(principal().disabled).toBe(false));
};

beforeEach(() => {
  document.body.innerHTML = "";
  setLang("es");
});
afterEach(() => vi.restoreAllMocks());

describe("la ventana de Mandar", () => {
  it("abre con el saldo y Todo elegido; sin dirección, Mandar está apagado", () => {
    abrir(mundo());
    expect(document.querySelector(".saldo-total")?.textContent).toBe("Tenés 12,5 dólares digitales.");
    expect(document.querySelector('[data-mandar="monto"]')?.textContent).toBe("12,5 dólares digitales");
    expect(principal().textContent).toBe(t("saldoMandarOk"));
    expect(principal().disabled).toBe(true);
  });

  it("Pegar dirección mira la cuenta y, si puede recibir, dice cuánto y a quién", async () => {
    await conDestino(mundo());
    expect(document.querySelector('[data-mandar="dir"]')?.textContent).toBe(OTRA);
    expect(estado()).toBe(`Vas a mandar 12,5 dólares digitales a ${OTRA.slice(0, 4)}…${OTRA.slice(-4)}.`);
  });

  it("si la cuenta de destino no puede recibir, lo dice y no deja mandar", async () => {
    const m = mundo({ destino: mirada(null) });
    abrir(m);
    tocar("pegar-dir");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoRecibe")));
    expect(principal().disabled).toBe(true);
    principal().click();
    expect(m.enviados).toEqual([]);
  });

  it("lo pegado que no es una dirección no se mira ni se usa", async () => {
    const m = mundo({ portapapeles: "hola" });
    const mirar = vi.spyOn(m, "mirar");
    abrir(m);
    tocar("pegar-dir");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoRecibe")));
    expect(mirar).not.toHaveBeenCalled();
    expect(principal().disabled).toBe(true);
  });

  it("La mitad y de a 1 dólar cambian el monto, y el resumen lo sigue", async () => {
    await conDestino(mundo());
    tocar("mitad");
    expect(document.querySelector('[data-mandar="monto"]')?.textContent).toBe("6,25 dólares digitales");
    expect(estado()).toContain("Vas a mandar 6,25 dólares digitales");
    tocar("mas");
    expect(document.querySelector('[data-mandar="monto"]')?.textContent).toBe("7,25 dólares digitales");
    tocar("todo");
    tocar("mas");
    expect(document.querySelector('[data-mandar="monto"]')?.textContent).toBe("12,5 dólares digitales");
  });

  it("Mandar arma el pago a esa cuenta por ese monto y, mandado, lo dice y solo deja cerrar", async () => {
    const m = mundo();
    await conDestino(m);
    tocar("mitad");
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Listo: mandaste 6,25 dólares digitales."));
    expect(document.querySelector(".dlg-estado")?.classList.contains("bad")).toBe(false);
    expect(m.enviados).toHaveLength(1);
    expect(leer(m.enviados[0] as string)).toEqual({ destino: OTRA, monto: "62500000", nota: { tipo: "ninguna" } });
    expect(principal().textContent).toBe(t("acctClose"));
    principal().click();
    expect(dialogo()).toBeNull();
    expect(m.enviados).toHaveLength(1);
  });

  it("mientras se manda no se cambia nada, y el mensaje dice lo que se mandó", async () => {
    const m = mundo();
    let terminar: (r: "listo") => void = () => undefined;
    m.enviar = (xdr) => {
      m.enviados.push(xdr);
      return new Promise((r) => (terminar = r));
    };
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    // El botón queda apagado y un segundo toque no arma otro envío.
    expect(principal().disabled).toBe(true);
    principal().click();
    await Promise.resolve();
    expect(m.enviados).toHaveLength(1);
    tocar("mitad");
    m.portapapeles = "999";
    tocar("pegar-nota");
    expect(document.querySelector('[data-mandar="monto"]')?.textContent).toBe("12,5 dólares digitales");
    terminar("listo");
    await vi.waitFor(() => expect(estado()).toBe("Listo: mandaste 12,5 dólares digitales."));
    expect(document.querySelector('[data-mandar="nota"]')?.textContent).toBe(t("saldoMandarSinNota"));
  });

  it("después de pegar la nota, el resumen sigue a la vista", async () => {
    const m = mundo();
    await conDestino(m);
    m.portapapeles = "4455";
    tocar("pegar-nota");
    await vi.waitFor(() => expect(document.querySelector('[data-mandar="nota"]')?.textContent).toBe("4455"));
    expect(estado()).toContain("Vas a mandar 12,5 dólares digitales");
  });

  it("si queda en camino, dice que no lo mande de nuevo y no deja mandar otra vez", async () => {
    const m = mundo({ respuesta: "en-curso" });
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe(t("acctClose")));
    expect(estado()).toBe(t("saldoMandarEnCurso"));
    expect(m.enviados).toHaveLength(1);
    tocar("mitad");
    expect(document.querySelector('[data-mandar="monto"]')?.textContent).toBe("12,5 dólares digitales");
  });

  it("si no salió, lo dice y deja probar de nuevo", async () => {
    const m = mundo({ respuesta: "no-salio" });
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoSalio")));
    expect(principal().textContent).toBe(t("saldoMandarOk"));
    expect(principal().disabled).toBe(false);
    // Un error se pinta como error, y lo que sigue ya no.
    expect(document.querySelector(".dlg-estado")?.classList.contains("bad")).toBe(true);
  });

  it("si al mandar la cuenta de destino ya no puede recibir, no se manda nada", async () => {
    const m = mundo();
    await conDestino(m);
    m.destino = mirada(null);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoRecibe")));
    expect(m.enviados).toEqual([]);
    expect(principal().disabled).toBe(true);
  });

  it("Pegar nota: un número va como nota numérica; una nota que no entra no se usa", async () => {
    const m = mundo();
    await conDestino(m);
    m.portapapeles = "7788";
    tocar("pegar-nota");
    await vi.waitFor(() => expect(document.querySelector('[data-mandar="nota"]')?.textContent).toBe("7788"));
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(leer(m.enviados[0] as string).nota).toEqual({ tipo: "id", valor: "7788" });
    document.body.innerHTML = "";
    const n = mundo({ portapapeles: "x".repeat(40) });
    abrir(n);
    tocar("pegar-nota");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNotaMala")));
    expect(document.querySelector('[data-mandar="nota"]')?.textContent).toBe(t("saldoMandarSinNota"));
  });

  it("si el navegador no deja leer lo copiado, aparece un campo donde pegarlo", async () => {
    const m = mundo({ portapapeles: null });
    abrir(m);
    tocar("pegar-dir");
    const campo = await vi.waitFor(() => {
      const c = document.querySelector<HTMLInputElement>('[data-mandar="campo-dir"]');
      expect(c).not.toBeNull();
      return c as HTMLInputElement;
    });
    campo.value = OTRA;
    campo.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
  });

  it("en inglés", async () => {
    setLang("en");
    await conDestino(mundo());
    expect(principal().textContent).toBe("Send");
    expect(estado()).toBe(`You're going to send 12.5 digital dollars to ${OTRA.slice(0, 4)}…${OTRA.slice(-4)}.`);
  });
});

/* ------------------------------------------------------------------ el costo del retiro */

describe("los montos de un retiro con costo", () => {
  const costo = D / 2n;

  it("lo menos que tiene que salir es el costo más 1 dólar, para que lleguen 1 dólar", () => {
    expect(minimoParaRetirar(costo)).toBe(15_000_000n);
  });

  it("con 1 dólar justo de llegada se puede retirar, y con un stroop menos no", () => {
    expect(puedeRetirar(15_000_000n, costo)).toBe(true);
    expect(puedeRetirar(14_999_999n, costo)).toBe(false);
  });

  it("un saldo igual o menor al costo no cubre ni el costo", () => {
    expect(faltaParaRetirar(costo, costo)).toBe("costo");
    expect(faltaParaRetirar(costo - 1n, costo)).toBe("costo");
    expect(faltaParaRetirar(0n, costo)).toBe("costo");
  });

  it("un saldo que cubre el costo pero no deja llegar 1 dólar no alcanza por el mínimo", () => {
    expect(faltaParaRetirar(costo + 1n, costo)).toBe("minimo");
    expect(faltaParaRetirar(14_999_999n, costo)).toBe("minimo");
  });

  it("un saldo que deja llegar 1 dólar o más alcanza", () => {
    expect(faltaParaRetirar(15_000_000n, costo)).toBeNull();
    expect(faltaParaRetirar(125_000_000n, costo)).toBeNull();
  });

  it("La mitad se ofrece solo si la mitad del saldo deja llegar 1 dólar", () => {
    expect(seOfreceLaMitad(30_000_000n, costo)).toBe(true);
    expect(seOfreceLaMitad(29_999_999n, costo)).toBe(false);
    expect(seOfreceLaMitad(costo, costo)).toBe(false);
  });

  it("La mitad de un saldo impar en stroops es el piso de la división: el stroop que sobra queda en la cuenta", () => {
    const saldo = 125_000_001n;
    expect(mitadDe(saldo)).toBe(62_500_000n);
    expect(saldo - mitadDe(saldo) * 2n).toBe(1n);
  });

  it("de a 1 dólar sube y baja de a 1 dólar justo", () => {
    expect(deAUnDolarConCosto(62_500_000n, 1, 125_000_000n, costo)).toBe(72_500_000n);
    expect(deAUnDolarConCosto(62_500_000n, -1, 125_000_000n, costo)).toBe(52_500_000n);
  });

  it("de a 1 dólar no pasa de todo el saldo", () => {
    expect(deAUnDolarConCosto(125_000_000n, 1, 125_000_000n, costo)).toBe(125_000_000n);
    expect(deAUnDolarConCosto(120_000_000n, 1, 125_000_000n, costo)).toBe(125_000_000n);
  });

  it("de a 1 dólar no baja de lo que deja llegar 1 dólar", () => {
    expect(deAUnDolarConCosto(20_000_000n, -1, 125_000_000n, costo)).toBe(15_000_000n);
    expect(deAUnDolarConCosto(15_000_000n, -1, 125_000_000n, costo)).toBe(15_000_000n);
  });
});

describe("la ventana de Mandar con el costo del retiro", () => {
  const COBROS = Keypair.random().publicKey();
  const COSTO: CostoDelRetiro = { stroops: D / 2n, destino: COBROS };
  const conCosto = (o: Partial<Mundo> = {}): Mundo => mundo({ costo: async () => COSTO, ...o });
  const cifra = (k: string): string | null => document.querySelector(`[data-mandar="${k}"]`)?.textContent ?? null;
  /** Los tres números de un retiro: lo que sale de la cuenta, el costo y lo que llega. */
  const tresNumeros = (): (string | null)[] => [cifra("sale"), cifra("costo"), cifra("llega")];
  const noAlcanzaCosto = (): string => "Cada retiro cuesta 0,50 dólares digitales. Todavía no te alcanza.";
  const cortaDe = (g: string): string => `${g.slice(0, 4)}…${g.slice(-4)}`;
  const conDestinoYSaldo = async (m: Mundo, saldo: bigint): Promise<void> => {
    abrirMandar({ address: YO, saldo }, m);
    tocar("pegar-dir");
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
  };
  /** Pega otro texto como destino o como nota y espera a que la ventana lo tome. */
  const pegarOtro = async (m: Mundo, cual: "pegar-dir" | "pegar-nota", texto: string): Promise<void> => {
    m.portapapeles = texto;
    tocar(cual);
    await vi.waitFor(() => expect(cifra(cual === "pegar-dir" ? "dir" : "nota")).toBe(texto === "" ? t("saldoMandarSinNota") : texto));
  };

  it("sin costo configurado, la ventana es la de hoy y no muestra ningún costo", async () => {
    await conDestino(mundo({ costo: async () => null }));
    expect(cifra("monto")).toBe("12,5 dólares digitales");
    for (const k of ["sale", "costo", "llega"]) expect(cifra(k), k).toBeNull();
    expect(document.querySelector('[data-mandar="mitad"]')).not.toBeNull();
    expect(estado()).toBe(`Vas a mandar 12,5 dólares digitales a ${cortaDe(OTRA)}.`);
  });

  it("sin costo configurado, Mandar pide un solo pago sin costo y dice lo de siempre", async () => {
    const m = mundo({ costo: async () => null });
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Listo: mandaste 12,5 dólares digitales."));
    expect(m.preparados).toHaveLength(1);
    expect("costo" in (m.preparados[0] as object)).toBe(false);
    expect(m.enviados).toHaveLength(1);
  });

  it("con costo, los tres números están a la vista antes de tocar Mandar", async () => {
    await conDestino(conCosto());
    expect(cifra("sale")).toBe("12,50 dólares digitales");
    expect(cifra("costo")).toBe("0,50 dólares digitales");
    expect(cifra("llega")).toBe("12,00 dólares digitales");
    const rotulos = document.querySelector(".saldo-datos")?.textContent ?? "";
    for (const rotulo of ["Sale de tu cuenta", "Costo del retiro", "Llega"]) expect(rotulos).toContain(rotulo);
    expect(cifra("monto")).toBeNull();
  });

  it("con costo, la línea de estado dice lo que se retira, lo que cuesta y lo que llega", async () => {
    await conDestino(conCosto());
    expect(estado()).toBe(
      `Llegan 12,00 dólares digitales a ${cortaDe(OTRA)}. Sale 12,50 dólares digitales y el costo es 0,50 dólares digitales.`,
    );
  });

  it("con costo, La mitad y de a 1 dólar cambian lo que sale y lo que llega, y el costo no se mueve", async () => {
    await conDestino(conCosto());
    tocar("mitad");
    expect(tresNumeros()).toEqual(["6,25 dólares digitales", "0,50 dólares digitales", "5,75 dólares digitales"]);
    tocar("mas");
    expect([cifra("sale"), cifra("llega")]).toEqual(["7,25 dólares digitales", "6,75 dólares digitales"]);
    tocar("todo");
    tocar("menos");
    expect([cifra("sale"), cifra("llega")]).toEqual(["11,50 dólares digitales", "11,00 dólares digitales"]);
  });

  it("con costo, de a 1 dólar no baja de lo que deja llegar 1 dólar", async () => {
    await conDestino(conCosto());
    tocar("mitad");
    for (let i = 0; i < 6; i++) tocar("menos");
    expect([cifra("sale"), cifra("llega")]).toEqual(["1,50 dólares digitales", "1,00 dólares digitales"]);
  });

  it("con costo, un saldo impar en stroops manda la mitad con el piso y deja el que sobra", async () => {
    const m = conCosto();
    await conDestinoYSaldo(m, 125_000_001n);
    tocar("mitad");
    principal().click();
    await vi.waitFor(() => expect(m.preparados).toHaveLength(1));
    expect(m.preparados[0]?.monto).toBe(62_500_000n);
  });

  it("con costo, La mitad no aparece si lo que llegaría es menos de 1 dólar", async () => {
    await conDestinoYSaldo(conCosto(), 25_000_000n);
    expect(document.querySelector('[data-mandar="mitad"]')).toBeNull();
    expect(document.querySelector('[data-mandar="todo"]')).not.toBeNull();
    expect(cifra("llega")).toBe("2,00 dólares digitales");
  });

  it("con costo, La mitad aparece cuando lo que llega es exactamente 1 dólar", async () => {
    await conDestinoYSaldo(conCosto(), 30_000_000n);
    tocar("mitad");
    expect([cifra("sale"), cifra("llega")]).toEqual(["1,50 dólares digitales", "1,00 dólares digitales"]);
  });

  it("con saldo igual al costo, no hay montos ni botón activo y dice que no alcanza", async () => {
    abrirMandar({ address: YO, saldo: 5_000_000n }, conCosto());
    await vi.waitFor(() => expect(estado()).toBe(noAlcanzaCosto()));
    expect(principal().disabled).toBe(true);
    expect(document.querySelectorAll("[data-mandar]")).toHaveLength(0);
  });

  it("con saldo menor al costo, no hay montos ni botón activo y dice que no alcanza", async () => {
    abrirMandar({ address: YO, saldo: 3_000_000n }, conCosto());
    await vi.waitFor(() => expect(estado()).toBe(noAlcanzaCosto()));
    expect(principal().disabled).toBe(true);
    expect(document.querySelectorAll("[data-mandar]")).toHaveLength(0);
  });

  it("con saldo mayor al costo pero que no deja llegar 1 dólar, dice cuánto hace falta", async () => {
    abrirMandar({ address: YO, saldo: 12_000_000n }, conCosto());
    await vi.waitFor(() => expect(estado()).toBe("Necesitás al menos 1,50 dólares digitales: llega 1 y el costo es 0,50."));
    expect(principal().disabled).toBe(true);
    expect(document.querySelectorAll("[data-mandar]")).toHaveLength(0);
  });

  it("con el saldo justo para que llegue 1 dólar, la ventana funciona", async () => {
    await conDestinoYSaldo(conCosto(), 15_000_000n);
    expect(tresNumeros()).toEqual(["1,50 dólares digitales", "0,50 dólares digitales", "1,00 dólares digitales"]);
  });

  it("con saldo que no alcanza no se arma nada: Mandar no llama a preparar", async () => {
    const m = conCosto();
    abrirMandar({ address: YO, saldo: 5_000_000n }, m);
    await vi.waitFor(() => expect(estado()).toContain("Cada retiro cuesta 0,50"));
    principal().click();
    expect(m.preparados).toEqual([]);
    expect(m.enviados).toEqual([]);
  });

  it("con costo, Mandar arma con el costo y entrega los mismos datos a quien firma", async () => {
    const m = conCosto();
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.preparados[0]?.costo).toEqual(COSTO);
    expect(m.preparados[0]?.monto).toBe(125_000_000n);
    expect(m.datosEnviados[0]).toBe(m.preparados[0]);
  });

  it("con costo, mandado dice cuánto se retiró y cuánto llega", async () => {
    await conDestino(conCosto());
    principal().click();
    await vi.waitFor(() =>
      expect(estado()).toBe(`Listo: retiraste 12,50 dólares digitales. Llegan 12,00 dólares digitales a ${cortaDe(OTRA)}.`),
    );
    expect(principal().textContent).toBe(t("acctClose"));
  });

  it("con costo, si queda en camino dice que no se mande de nuevo", async () => {
    const m = conCosto({ respuesta: "en-curso" });
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe(t("acctClose")));
    expect(estado()).toBe(t("saldoMandarEnCurso"));
    expect(m.enviados).toHaveLength(1);
  });

  it("con costo, si la cuenta del costo no puede recibirlo, lo dice y no manda nada", async () => {
    const m = conCosto();
    m.preparar = async () => ({ ok: false, motivo: "sin-retiro" });
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Retirar no está disponible en este momento. Tus dólares digitales siguen en tu cuenta."));
    expect(m.enviados).toEqual([]);
  });

  it("con costo, si la transacción armada no pasa la regla, no se manda y no dice un motivo técnico", async () => {
    const m = conCosto();
    m.preparar = async () => ({ ok: false, motivo: "regla" });
    await conDestino(m);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoSalio")));
    expect(m.enviados).toEqual([]);
  });

  it("pagar a la propia cuenta del costo no cobra costo: vuelve la ventana de siempre", async () => {
    const m = conCosto({ portapapeles: COBROS });
    await conDestino(m);
    expect(cifra("monto")).toBe("12,5 dólares digitales");
    expect(cifra("sale")).toBeNull();
    expect(estado()).toBe(`Vas a mandar 12,5 dólares digitales a ${cortaDe(COBROS)}.`);
    principal().click();
    await vi.waitFor(() => expect(m.preparados).toHaveLength(1));
    expect("costo" in (m.preparados[0] as object)).toBe(false);
  });

  it("al pasar de la cuenta del costo a otro destino vuelve el costo y lo que sale vuelve a Todo", async () => {
    const m = conCosto({ portapapeles: COBROS });
    await conDestino(m);
    tocar("mitad");
    expect(cifra("monto")).toBe("6,25 dólares digitales");
    await pegarOtro(m, "pegar-dir", OTRA);
    await vi.waitFor(() => expect(cifra("sale")).toBe("12,50 dólares digitales"));
    expect(cifra("llega")).toBe("12,00 dólares digitales");
  });

  it("no se manda nada hasta saber si hay costo", async () => {
    let saberQueHay: (c: CostoDelRetiro | null) => void = () => undefined;
    const m = mundo({ costo: () => new Promise((resolver) => (saberQueHay = resolver)) });
    abrir(m);
    tocar("pegar-dir");
    await vi.waitFor(() => expect(cifra("dir")).toBe(OTRA));
    await vi.waitFor(() => expect(estado()).toBe(""));
    expect(principal().disabled).toBe(true);
    saberQueHay(COSTO);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    expect(cifra("llega")).toBe("12,00 dólares digitales");
  });

  it("si el costo llega después de bajar el monto, lo que sale vuelve a Todo", async () => {
    let saberQueHay: (c: CostoDelRetiro | null) => void = () => undefined;
    const m = mundo({ costo: () => new Promise((resolver) => (saberQueHay = resolver)) });
    abrir(m);
    tocar("pegar-dir");
    await vi.waitFor(() => expect(cifra("dir")).toBe(OTRA));
    for (let i = 0; i < 12; i++) tocar("menos");
    saberQueHay(COSTO);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    expect(tresNumeros()).toEqual(["12,50 dólares digitales", "0,50 dólares digitales", "12,00 dólares digitales"]);
  });

  it("si el costo llega después de pegar una nota que no puede ir con costo, lo dice y no deja mandar", async () => {
    let saberQueHay: (c: CostoDelRetiro | null) => void = () => undefined;
    const m = mundo({ costo: () => new Promise((resolver) => (saberQueHay = resolver)) });
    abrir(m);
    tocar("pegar-dir");
    await vi.waitFor(() => expect(cifra("dir")).toBe(OTRA));
    await pegarOtro(m, "pegar-nota", "tk:o:ABCD2345");
    saberQueHay(COSTO);
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNotaMala")));
    expect(principal().disabled).toBe(true);
  });

  it("si no se puede saber el costo, no se manda y lo dice", async () => {
    const m = mundo({ costo: () => Promise.reject(new Error("sin respuesta")) });
    abrir(m);
    await vi.waitFor(() => expect(estado()).toBe(t("saldoRetiroNoDisponible")));
    tocar("pegar-dir");
    await vi.waitFor(() => expect(cifra("dir")).toBe(OTRA));
    expect(principal().disabled).toBe(true);
    expect(estado()).toBe(t("saldoRetiroNoDisponible"));
    expect(m.enviados).toEqual([]);
  });

  it("con costo, una nota de texto que se lee como una orden no se acepta", async () => {
    const m = conCosto();
    await conDestino(m);
    m.portapapeles = "tk:o:ABCD2345";
    tocar("pegar-nota");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNotaMala")));
    expect(cifra("nota")).toBe(t("saldoMandarSinNota"));
  });

  it("con costo, la nota que se lee como una orden tampoco se acepta con espacios ni guiones ni mayúsculas", async () => {
    const m = conCosto();
    await conDestino(m);
    m.portapapeles = " T-K : o:1";
    tocar("pegar-nota");
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNotaMala")));
    expect(cifra("nota")).toBe(t("saldoMandarSinNota"));
  });

  it("con costo, una nota numérica sí se acepta", async () => {
    const m = conCosto();
    await conDestino(m);
    await pegarOtro(m, "pegar-nota", "4455");
    expect(estado()).toContain("Sale 12,50");
  });

  it("la nota que parece una orden sí se acepta si el destino es la cuenta del costo", async () => {
    const m = conCosto({ portapapeles: COBROS });
    await conDestino(m);
    await pegarOtro(m, "pegar-nota", "tk:o:ABCD2345");
    expect(estado()).toContain("Vas a mandar");
  });

  it("una nota que parece una orden, pegada antes del destino, frena un destino que lleva costo", async () => {
    const m = conCosto({ portapapeles: COBROS });
    await conDestino(m);
    await pegarOtro(m, "pegar-nota", "tk:o:ABCD2345");
    await pegarOtro(m, "pegar-dir", OTRA);
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNotaMala")));
    expect(principal().disabled).toBe(true);
  });

  it("en inglés", async () => {
    setLang("en");
    await conDestino(conCosto());
    const rotulos = document.querySelector(".saldo-datos")?.textContent ?? "";
    for (const rotulo of ["Leaves your account", "Withdrawal cost", "Arrives"]) expect(rotulos).toContain(rotulo);
    expect(estado()).toBe(
      `12.00 digital dollars arrive at ${cortaDe(OTRA)}. You send 12.50 digital dollars and the cost is 0.50 digital dollars.`,
    );
  });

  it("en inglés dice que no alcanza", async () => {
    setLang("en");
    abrirMandar({ address: YO, saldo: 5_000_000n }, conCosto());
    await vi.waitFor(() => expect(estado()).toBe("Each withdrawal costs 0.50 digital dollars. You don't have enough yet."));
  });
});

describe("los textos del retiro", () => {
  const claves = [
    "saldoRetiroSale",
    "saldoRetiroCosto",
    "saldoRetiroLlega",
    "saldoRetiroResumen",
    "saldoRetiroListo",
    "saldoRetiroNoAlcanza",
    "saldoRetiroMinimo",
    "saldoRetiroNoDisponible",
  ];
  const idiomas = ["es", "en"] as const;
  const delIdioma = (lang: "es" | "en", clave: string): string => {
    const valor = textos(lang)[clave];
    return typeof valor === "string" ? valor : "";
  };

  it("cada clave existe en español y en inglés y no está vacía", () => {
    for (const lang of idiomas) for (const clave of claves) expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toBe("");
  });

  it("ningún texto trae punto y coma, comillas angulares, raya larga, punto medio ni signos de exclamación", () => {
    for (const lang of idiomas) for (const clave of claves) expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toMatch(/[;«»—–·!¡]/);
  });

  it("ningún texto usa palabras técnicas ni las que el sitio no dice", () => {
    const tecnicas = /\b(firma|firmar|hash|red|comisi[oó]n|contrato|xdr|network|signature|signing|contract|fee)\b/i;
    const prohibidas = /\b(rifa|loter[ií]a|boleto|ticket|apuesta|raffle)\b/i;
    for (const lang of idiomas) {
      for (const clave of claves) {
        expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toMatch(tecnicas);
        expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toMatch(prohibidas);
      }
    }
  });

  it("los dos idiomas llevan los mismos marcadores", () => {
    const marcadores = (s: string): string[] => (s.match(/\{[a-z]+\}/g) ?? []).sort();
    for (const clave of claves) expect(marcadores(delIdioma("es", clave)), clave).toEqual(marcadores(delIdioma("en", clave)));
  });
});

describe("quién manda sin preguntar", () => {
  it("solo el patrocinador, el envío del sello y Mandar llaman a signAndSubmit", () => {
    const raiz = resolve(process.cwd(), "src");
    const llaman = (readdirSync(raiz, { recursive: true }) as string[])
      .map((f) => f.split("\\").join("/"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
      .filter((f) => f !== "stellar/wallet-pollar.ts" && f !== "stellar/pollar-falso.ts")
      .filter((f) => /\.signAndSubmit\(/.test(readFileSync(join(raiz, f), "utf8")));
    expect(llaman).toContain("ui/mandar-usdc.ts");
    for (const f of llaman) expect(["stellar/patrocinador.ts", "ui/envio-sdk.ts", "ui/mandar-usdc.ts"], f).toContain(f);
  });
});

describe("el modo premios: Mandar no existe", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("mandarPermitido da falso solo con premios", () => {
    expect(mandarPermitido("premios")).toBe(false);
    for (const modo of ["pollar", "recibir", "apagada"] as const) expect(mandarPermitido(modo), modo).toBe(true);
  });

  it("abrirMandar no abre ninguna ventana", () => {
    vi.stubEnv("VITE_RAMPA", "premios");
    const m = mundo();
    abrir(m);
    expect(dialogo()).toBeNull();
    expect(document.body.innerHTML).toBe("");
  });

  const datos = { red: "mainnet" as const, origen: YO, destino: OTRA, monto: 5n * D, nota: { tipo: "ninguna" as const } };

  it("prepararEnvio, llamado directo, se niega sin mirar ninguna cuenta ni armar nada: el modo sale de la bandera y no de quien llama", async () => {
    const mirar = vi.fn(async () => mirada("12.5000000"));
    vi.stubEnv("VITE_RAMPA", "premios");
    expect(await prepararEnvio(datos, mirar)).toEqual({ ok: false, motivo: "apagado" });
    expect(mirar).not.toHaveBeenCalled();
    expect(prepararEnvio.length).toBe(2);
  });

  it("el envío del sitio se niega aunque haya una billetera propia lista: ni la mira ni le pide firmar", async () => {
    const firmar = vi.fn(async (): Promise<{ signedTxXdr: string }> => {
      throw new Error("sin aprobar");
    });
    billetera.activa = { address: YO, signTransaction: firmar };
    vi.stubEnv("VITE_RAMPA", "premios");
    expect(await depsDelSitio().enviar("XDR", YO)).toBe("no-salio");
    expect(firmar).not.toHaveBeenCalled();
    // Con otro modo, la misma billetera sí llega a firmar: la prueba mide el corte y no otra cosa.
    vi.stubEnv("VITE_RAMPA", "recibir");
    expect(await depsDelSitio().enviar("XDR", YO)).toBe("no-aprobado");
    expect(firmar).toHaveBeenCalledOnce();
    billetera.activa = null;
  });

  it("con pollar y con recibir, Mandar abre como siempre", () => {
    for (const modo of ["pollar", "recibir"]) {
      document.body.innerHTML = "";
      vi.stubEnv("VITE_RAMPA", modo);
      abrir(mundo());
      expect(dialogo(), modo).not.toBeNull();
      expect(principal().textContent).toBe(t("saldoMandarOk"));
    }
  });
});
