// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { USDC_MAINNET } from "../stellar/pagos";
import type { CuentaMirada, LecturaDeCuenta } from "../stellar/usdc-cuenta";
import { type DatosDelEnvio, type DepsDeMandar, abrirMandar, deAUnDolar, leerDireccion, leerNota, mitadDe, puedeRecibir } from "./mandar-usdc";

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
  respuesta: "listo" | "en-curso" | "no-aprobado" | "no-salio";
}

function mundo(o: Partial<Mundo> = {}): Mundo {
  const m: Mundo = {
    red: "mainnet",
    portapapeles: OTRA,
    destino: mirada("0.0000000"),
    enviados: [],
    respuesta: "listo",
    mirar: async (c) => (c === YO ? mirada("12.5000000") : m.destino),
    preparar: async (d) => (puedeRecibir(m.destino, d.red, d.monto) ? { ok: true, xdr: `ARMADO:${JSON.stringify({ destino: d.destino, monto: String(d.monto), nota: d.nota })}` } : { ok: false, motivo: "no-recibe" }),
    pegar: async () => m.portapapeles,
    enviar: async (xdr) => {
      m.enviados.push(xdr);
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
