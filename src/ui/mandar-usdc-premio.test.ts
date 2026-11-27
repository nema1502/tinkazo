// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { textos } from "../idioma";
import { USDC_MAINNET } from "../stellar/pagos";
import type { CostoDelRetiro } from "../stellar/pagos-regla";
import type { CuentaMirada, LecturaDeCuenta } from "../stellar/usdc-cuenta";
import { type DatosDelEnvio, type DepsDeMandar, type ResultadoDelEnvio, abrirMandar, depsDelSitio, puedeRecibir } from "./mandar-usdc";

// La billetera del sitio, de mentira: de ella solo importa hasta cuándo vive la marca de su último retiro.
const billetera = vi.hoisted(() => ({ marca: null as number | null }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => null }));
vi.mock("../stellar/wallet-pollar", () => ({
  submitsItself: () => false,
  MARCA_DEL_RETIRO: "marca-del-retiro",
  leerMarcaDeLaCuenta: (clave: string) => (clave === "marca-del-retiro" ? billetera.marca : null),
}));

/**
 * Mandar mis dólares digitales con el premio puesto (`abrirMandar` con `llega` y `para`): quien organiza una campaña de
 * personas le manda su premio a cada persona que gana. El monto no se elige: sale lo que hace falta para que el premio llegue
 * entero. La ventana dice de quién es el premio, no baja el monto si el saldo no alcanza y no manda con otro envío en camino.
 * Sin `llega` la ventana es la de siempre. Todo con cuentas y billeteras de mentira: nada sale de la prueba.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const TERCERA = Keypair.random().publicKey();
const COBROS = Keypair.random().publicKey();
const D = 10_000_000n;
const COSTO: CostoDelRetiro = { stroops: D / 2n, destino: COBROS };
/** El premio que tiene que llegar: 40 dólares digitales. */
const PREMIO = 40n * D;
/** Lo que tiene quien organiza con tres premios de 40 y el costo de mandar cada uno: 121,50. */
const SALDO = 1_215_000_000n;

const mirada = (saldo: string | null): CuentaMirada => ({
  secuencia: "500",
  saldos: saldo === null ? [] : [{ code: "USDC", issuer: USDC_MAINNET.issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null }],
  xlm: "2.0000000",
  xlmComprometido: "0.0000000",
  subentradas: 1,
  patrocinando: 0,
  patrocinadas: 1,
});

interface Mundo extends DepsDeMandar {
  portapapeles: string | null;
  destino: LecturaDeCuenta;
  enviados: string[];
  /** Los datos que la ventana pidió preparar, y los que entregó junto con cada envío. */
  preparados: DatosDelEnvio[];
  datosEnviados: (DatosDelEnvio | undefined)[];
  respuesta: ResultadoDelEnvio;
  /** Si hay otro envío en camino, cuántas veces se preguntó y en qué orden se llamó a cada cosa. */
  enCamino: boolean;
  preguntas: number;
  orden: string[];
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
    enCamino: false,
    preguntas: 0,
    orden: [],
    mirar: async (c) => (c === YO ? mirada("121.5000000") : m.destino),
    preparar: async (d) => {
      m.orden.push("preparar");
      m.preparados.push(d);
      const llega = d.costo ? d.monto - d.costo.stroops : d.monto;
      if (!puedeRecibir(m.destino, d.red, llega)) return { ok: false, motivo: "no-recibe" };
      return { ok: true, xdr: `ARMADO:${JSON.stringify({ destino: d.destino, monto: String(d.monto), nota: d.nota })}` };
    },
    pegar: async () => m.portapapeles,
    enviar: async (xdr, _origen, datos) => {
      m.orden.push("enviar");
      m.enviados.push(xdr);
      m.datosEnviados.push(datos);
      return m.respuesta;
    },
    ocupada: async () => {
      m.orden.push("ocupada");
      m.preguntas++;
      return m.enCamino;
    },
    ...o,
  };
  return m;
}

const conCosto = (o: Partial<Mundo> = {}): Mundo => mundo({ costo: async () => COSTO, ...o });

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
const tocar = (k: string): void => document.querySelector<HTMLButtonElement>(`[data-mandar="${k}"]`)?.click();
const cifra = (k: string): string | null => document.querySelector(`[data-mandar="${k}"]`)?.textContent ?? null;
/** Los tres números de un retiro: lo que sale de la cuenta, el costo y lo que llega. */
const tresNumeros = (): (string | null)[] => [cifra("sale"), cifra("costo"), cifra("llega")];
const CON_EL_PREMIO = ["40,50 dólares digitales", "0,50 dólares digitales", "40,00 dólares digitales"];
const cortaDe = (g: string): string => `${g.slice(0, 4)}…${g.slice(-4)}`;
const BOTONES_DE_MONTO = ["todo", "mitad", "menos", "mas"];
const hayBotonesDeMonto = (): boolean[] => BOTONES_DE_MONTO.map((k) => document.querySelector(`[data-mandar="${k}"]`) !== null);

/** Abre Mandar con el premio puesto: 40 dólares digitales, y quien organiza tiene 121,50, salvo que se diga otra cosa. */
function abrirConPremio(m: Mundo, o: { saldo?: bigint; llega?: bigint; para?: string } = {}): void {
  abrirMandar({ address: YO, saldo: o.saldo ?? SALDO, llega: o.llega ?? PREMIO, ...(o.para === undefined ? {} : { para: o.para }) }, m);
}

/** Pega la dirección del portapapeles y espera a que Mandar quede listo. */
async function pegarLaDireccion(): Promise<void> {
  tocar("pegar-dir");
  await vi.waitFor(() => expect(principal().disabled).toBe(false));
}

/** Pega otro texto como destino o como nota y espera a que la ventana lo tome. */
async function pegarOtro(m: Mundo, cual: "pegar-dir" | "pegar-nota", texto: string): Promise<void> {
  m.portapapeles = texto;
  tocar(cual);
  await vi.waitFor(() => expect(cifra(cual === "pegar-dir" ? "dir" : "nota")).toBe(texto));
}

beforeEach(() => {
  document.body.innerHTML = "";
  billetera.marca = null;
  setLang("es");
});
afterEach(() => vi.restoreAllMocks());

describe("Mandar sin el premio puesto es la ventana de siempre", () => {
  it("el monto inicial es todo el saldo, están los cuatro botones y nadie pregunta por otro envío, ni al mandar", async () => {
    const m = mundo({ enCamino: true });
    abrirMandar({ address: YO, saldo: SALDO }, m);
    expect(cifra("monto")).toBe("121,5 dólares digitales");
    expect(hayBotonesDeMonto()).toEqual([true, true, true, true]);
    expect(cifra("para")).toBeNull();
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Listo: mandaste 121,5 dólares digitales."));
    expect(m.preparados[0]?.monto).toBe(SALDO);
    expect(m.preguntas).toBe(0);
    expect(m.orden).toEqual(["preparar", "enviar"]);
  });

  it("con el costo del retiro también: sale todo el saldo, se elige con los botones y nadie pregunta", async () => {
    const m = conCosto({ enCamino: true });
    abrirMandar({ address: YO, saldo: SALDO }, m);
    await pegarLaDireccion();
    expect(tresNumeros()).toEqual(["121,50 dólares digitales", "0,50 dólares digitales", "121,00 dólares digitales"]);
    expect(hayBotonesDeMonto()).toEqual([true, true, true, true]);
    tocar("mitad");
    expect(cifra("sale")).toBe("60,75 dólares digitales");
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.preparados[0]?.monto).toBe(SALDO / 2n);
    expect(m.preguntas).toBe(0);
  });

  it("el nombre sin el premio no cambia nada: no hay línea de premio y el monto sigue siendo todo el saldo", () => {
    abrirMandar({ address: YO, saldo: SALDO, para: "Ana P." }, mundo());
    expect(cifra("para")).toBeNull();
    expect(document.querySelector(".dlg-cuerpo")?.textContent ?? "").not.toContain("Ana P.");
    expect(cifra("monto")).toBe("121,5 dólares digitales");
    expect(hayBotonesDeMonto()).toEqual([true, true, true, true]);
  });
});

describe("Mandar con el premio puesto", () => {
  it("con costo, sale el premio más el costo y llega el premio entero, sin botones de monto", async () => {
    abrirConPremio(conCosto());
    await vi.waitFor(() => expect(tresNumeros()).toEqual(CON_EL_PREMIO));
    expect(hayBotonesDeMonto()).toEqual([false, false, false, false]);
    expect(document.querySelector(".saldo-montos")).toBeNull();
    expect(document.querySelector(".saldo-total")?.textContent).toBe("Tenés 121,5 dólares digitales.");
    // Sin dirección todavía, Mandar está apagado y la línea no dice nada.
    expect(principal().textContent).toBe(t("saldoMandarOk"));
    expect(principal().disabled).toBe(true);
    expect(estado()).toBe("");
  });

  it("pegar la dirección, pegar la nota y cambiar de destino no mueven ni lo que sale ni lo que llega", async () => {
    const m = conCosto();
    abrirConPremio(m);
    await pegarLaDireccion();
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
    expect(estado()).toBe(`Llegan 40,00 dólares digitales a ${cortaDe(OTRA)}. Sale 40,50 dólares digitales y el costo es 0,50 dólares digitales.`);
    await pegarOtro(m, "pegar-nota", "4455");
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
    await pegarOtro(m, "pegar-dir", TERCERA);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
    expect(estado()).toContain(`Llegan 40,00 dólares digitales a ${cortaDe(TERCERA)}.`);
    expect(hayBotonesDeMonto()).toEqual([false, false, false, false]);
  });

  it("si el costo se conoce después de abrir, lo que sale pasa a ser el premio más el costo y lo que llega no cambia", async () => {
    let saberQueHay: (c: CostoDelRetiro | null) => void = () => undefined;
    const m = mundo({ costo: () => new Promise((resolver) => (saberQueHay = resolver)) });
    abrirConPremio(m);
    expect(cifra("monto")).toBe("40 dólares digitales");
    tocar("pegar-dir");
    await vi.waitFor(() => expect(cifra("dir")).toBe(OTRA));
    // Hasta saber si hay costo no se manda nada.
    expect(principal().disabled).toBe(true);
    saberQueHay(COSTO);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
    expect(cifra("monto")).toBeNull();
  });

  it("a la propia cuenta del costo no se cobra costo y sale el premio justo, y al pasar a otro destino vuelve el costo", async () => {
    const m = conCosto({ portapapeles: COBROS });
    abrirConPremio(m);
    await pegarLaDireccion();
    expect(cifra("monto")).toBe("40 dólares digitales");
    expect(cifra("sale")).toBeNull();
    await pegarOtro(m, "pegar-dir", OTRA);
    await vi.waitFor(() => expect(tresNumeros()).toEqual(CON_EL_PREMIO));
    await pegarOtro(m, "pegar-dir", COBROS);
    await vi.waitFor(() => expect(cifra("monto")).toBe("40 dólares digitales"));
  });

  it("sin costo, sale el premio justo, sin botones de monto", async () => {
    const m = mundo();
    abrirConPremio(m);
    await pegarLaDireccion();
    expect(cifra("monto")).toBe("40 dólares digitales");
    expect(tresNumeros()).toEqual([null, null, null]);
    expect(hayBotonesDeMonto()).toEqual([false, false, false, false]);
    expect(estado()).toBe(`Vas a mandar 40 dólares digitales a ${cortaDe(OTRA)}.`);
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Listo: mandaste 40 dólares digitales."));
    expect(m.preparados).toHaveLength(1);
    expect(m.preparados[0]?.monto).toBe(PREMIO);
    expect("costo" in (m.preparados[0] as object)).toBe(false);
  });

  it("lo que se prepara y lo que recibe quien firma llevan el monto y el costo que se vieron", async () => {
    const m = conCosto();
    abrirConPremio(m);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.preparados).toHaveLength(1);
    expect(m.preparados[0]).toEqual({ red: "mainnet", origen: YO, destino: OTRA, monto: PREMIO + COSTO.stroops, nota: { tipo: "ninguna" }, costo: COSTO });
    expect(m.datosEnviados[0]).toBe(m.preparados[0]);
    await vi.waitFor(() =>
      expect(estado()).toBe(`Listo: retiraste 40,50 dólares digitales. Llegan 40,00 dólares digitales a ${cortaDe(OTRA)}.`),
    );
    expect(principal().textContent).toBe(t("acctClose"));
    principal().click();
    expect(dialogo()).toBeNull();
    expect(m.enviados).toHaveLength(1);
  });

  it("la nota que pide la app que recibe se pega como siempre y viaja con el envío", async () => {
    const m = conCosto();
    abrirConPremio(m);
    await pegarLaDireccion();
    await pegarOtro(m, "pegar-nota", "7788");
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.preparados[0]?.nota).toEqual({ tipo: "id", valor: "7788" });
    expect(m.preparados[0]?.monto).toBe(PREMIO + COSTO.stroops);
  });

  it("si queda en camino dice que no se mande de nuevo, y si no salió deja probar otra vez", async () => {
    const enDuda = conCosto({ respuesta: "en-curso" });
    abrirConPremio(enDuda);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe(t("acctClose")));
    expect(estado()).toBe(t("saldoMandarEnCurso"));
    document.body.innerHTML = "";
    const noSalio = conCosto({ respuesta: "no-salio" });
    abrirConPremio(noSalio);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoSalio")));
    expect(principal().textContent).toBe(t("saldoMandarOk"));
    expect(principal().disabled).toBe(false);
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
  });
});

describe("con el premio puesto y el saldo corto", () => {
  it("con costo y 40 en la cuenta no se arma nada: Mandar apagado y la línea dice que faltan 0,50", async () => {
    const m = conCosto();
    abrirConPremio(m, { saldo: 40n * D });
    await vi.waitFor(() => expect(estado()).toBe("Te faltan 0,50 dólares digitales para mandar este premio. No mandamos nada."));
    expect(principal().disabled).toBe(true);
    expect(document.querySelector('[data-mandar="pegar-dir"]')).toBeNull();
    expect(tresNumeros()).toEqual([null, null, null]);
    expect(document.querySelector(".saldo-total")?.textContent).toBe("Tenés 40 dólares digitales.");
    principal().click();
    await Promise.resolve();
    expect(m.preparados).toEqual([]);
    expect(m.enviados).toEqual([]);
  });

  it("no baja el monto para que alcance: con un stroop menos de lo que hace falta tampoco se arma", async () => {
    const m = conCosto();
    abrirConPremio(m, { saldo: PREMIO + COSTO.stroops - 1n });
    await vi.waitFor(() => expect(estado()).toBe("Te faltan 0,0000001 dólares digitales para mandar este premio. No mandamos nada."));
    expect(principal().disabled).toBe(true);
    expect(m.preparados).toEqual([]);
  });

  it("con lo justo, el premio y su costo, la ventana funciona", async () => {
    const m = conCosto();
    abrirConPremio(m, { saldo: PREMIO + COSTO.stroops });
    await pegarLaDireccion();
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.preparados[0]?.monto).toBe(PREMIO + COSTO.stroops);
  });

  it("sin costo, con menos que el premio dice cuánto falta, y con el premio justo alcanza", async () => {
    abrirConPremio(mundo(), { saldo: PREMIO - D / 100n });
    await vi.waitFor(() => expect(estado()).toBe("Te faltan 0,01 dólares digitales para mandar este premio. No mandamos nada."));
    expect(principal().disabled).toBe(true);
    document.body.innerHTML = "";
    abrirConPremio(mundo(), { saldo: PREMIO });
    await pegarLaDireccion();
    expect(cifra("monto")).toBe("40 dólares digitales");
  });

  it("en inglés", async () => {
    setLang("en");
    abrirConPremio(conCosto(), { saldo: 40n * D });
    await vi.waitFor(() => expect(estado()).toBe("You're 0.50 digital dollars short to send this prize. Nothing was sent."));
  });
});

describe("de quién es el premio", () => {
  const cuerpo = (): Element | null => document.querySelector(".dlg-cuerpo");

  it("con el nombre, la ventana lo dice arriba de todo", async () => {
    abrirConPremio(conCosto(), { para: "Ana P." });
    expect(cifra("para")).toBe("Premio de Ana P.");
    expect(cuerpo()?.firstElementChild?.getAttribute("data-mandar")).toBe("para");
    await pegarLaDireccion();
    expect(cifra("para")).toBe("Premio de Ana P.");
    expect(cuerpo()?.firstElementChild?.getAttribute("data-mandar")).toBe("para");
  });

  it("lo sigue diciendo cuando el saldo no alcanza y después de mandar", async () => {
    abrirConPremio(conCosto(), { para: "Ana P.", saldo: 40n * D });
    await vi.waitFor(() => expect(estado()).toContain("Te faltan 0,50"));
    expect(cifra("para")).toBe("Premio de Ana P.");
    document.body.innerHTML = "";
    const m = conCosto();
    abrirConPremio(m, { para: "Beto R." });
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe(t("acctClose")));
    expect(cifra("para")).toBe("Premio de Beto R.");
  });

  it("el nombre va como texto: lo que parezca una etiqueta no se vuelve una", () => {
    const raro = '<img src=x onerror="alert(1)"> & Nora';
    abrirConPremio(mundo(), { para: raro });
    expect(cifra("para")).toBe(`Premio de ${raro}`);
    expect(cuerpo()?.querySelector("img")).toBeNull();
  });

  it("sin nombre, o con uno en blanco, no hay línea de premio", () => {
    abrirConPremio(mundo());
    expect(cifra("para")).toBeNull();
    document.body.innerHTML = "";
    abrirConPremio(mundo(), { para: "   " });
    expect(cifra("para")).toBeNull();
  });

  it("en inglés", () => {
    setLang("en");
    abrirConPremio(mundo(), { para: "Ana P." });
    expect(cifra("para")).toBe("Prize for Ana P.");
  });
});

describe("con el premio puesto y otro envío en camino", () => {
  it("no prepara ni manda nada, lo dice y deja el botón para probar más tarde", async () => {
    const m = conCosto({ enCamino: true });
    abrirConPremio(m);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Hay otro envío en camino. Esperá unos minutos y probá de nuevo."));
    expect(m.preguntas).toBe(1);
    expect(m.preparados).toEqual([]);
    expect(m.enviados).toEqual([]);
    expect(principal().textContent).toBe(t("saldoMandarOk"));
    expect(principal().disabled).toBe(false);
    expect(tresNumeros()).toEqual(CON_EL_PREMIO);
    // La nota se puede seguir pegando, y más tarde, ya sin el otro envío, el mismo botón manda.
    await pegarOtro(m, "pegar-nota", "4455");
    m.enCamino = false;
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.preguntas).toBe(2);
    expect(m.preparados[0]?.nota).toEqual({ tipo: "id", valor: "4455" });
  });

  it("se pregunta antes de preparar nada", async () => {
    const m = conCosto();
    abrirConPremio(m);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(m.enviados).toHaveLength(1));
    expect(m.orden).toEqual(["ocupada", "preparar", "enviar"]);
  });

  it("si no se puede saber si hay otro, tampoco se manda", async () => {
    const m = conCosto({ ocupada: () => Promise.reject(new Error("sin respuesta")) });
    abrirConPremio(m);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarNoSalio")));
    expect(m.preparados).toEqual([]);
    expect(m.enviados).toEqual([]);
    expect(principal().disabled).toBe(false);
  });

  it("un envío de esta pestaña que todavía no terminó frena el siguiente, aunque su ventana ya se haya cerrado", async () => {
    let terminar: (r: ResultadoDelEnvio) => void = () => undefined;
    const primero = conCosto();
    primero.enviar = (xdr) => {
      primero.enviados.push(xdr);
      return new Promise((r) => (terminar = r));
    };
    abrirConPremio(primero, { para: "Ana P." });
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(primero.enviados).toHaveLength(1));
    document.querySelector<HTMLButtonElement>('[data-dlg="x"]')?.click();
    expect(dialogo()).toBeNull();
    // La ventana de la persona siguiente: la billetera todavía no dejó su marca, pero el primer envío sigue su camino.
    const segundo = conCosto({ portapapeles: TERCERA });
    abrirConPremio(segundo, { para: "Beto R." });
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe(t("saldoMandarOcupado")));
    expect(segundo.preparados).toEqual([]);
    expect(segundo.enviados).toEqual([]);
    // Cuando el primero termina, el siguiente sale.
    terminar("listo");
    await new Promise((r) => setTimeout(r, 0));
    principal().click();
    await vi.waitFor(() => expect(segundo.enviados).toHaveLength(1));
    expect(segundo.preparados[0]?.destino).toBe(TERCERA);
  });

  it("en el sitio, hay otro envío en camino mientras vive la marca del retiro de la billetera", async () => {
    const ahoraS = Math.floor(Date.now() / 1000);
    expect(await depsDelSitio().ocupada?.()).toBe(false);
    billetera.marca = ahoraS + 120;
    expect(await depsDelSitio().ocupada?.()).toBe(true);
    billetera.marca = ahoraS - 1;
    expect(await depsDelSitio().ocupada?.()).toBe(false);
  });

  it("en inglés", async () => {
    setLang("en");
    const m = conCosto({ enCamino: true });
    abrirConPremio(m);
    await pegarLaDireccion();
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Another transfer is on its way. Wait a few minutes and try again."));
  });
});

describe("los textos del premio puesto", () => {
  const TEXTOS: Record<string, { es: string; en: string }> = {
    saldoMandarPremioDe: { es: "Premio de {nombre}", en: "Prize for {nombre}" },
    saldoMandarFaltaPremio: {
      es: "Te faltan {n} dólares digitales para mandar este premio. No mandamos nada.",
      en: "You're {n} digital dollars short to send this prize. Nothing was sent.",
    },
    saldoMandarOcupado: {
      es: "Hay otro envío en camino. Esperá unos minutos y probá de nuevo.",
      en: "Another transfer is on its way. Wait a few minutes and try again.",
    },
  };
  const idiomas = ["es", "en"] as const;
  const delIdioma = (lang: "es" | "en", clave: string): string => {
    const valor = textos(lang)[clave];
    return typeof valor === "string" ? valor : "";
  };

  it("los tres están en español y en inglés, con el texto acordado", () => {
    for (const [clave, texto] of Object.entries(TEXTOS)) {
      for (const lang of idiomas) expect(delIdioma(lang, clave), `${lang}.${clave}`).toBe(texto[lang]);
    }
  });

  it("ninguno trae punto y coma, comillas angulares, rayas, flechas, punto medio ni signos de exclamación", () => {
    // Escritos por su código para que este archivo tampoco los lleve: comillas angulares, rayas, flechas y punto medio.
    const signos = /[;!¡«»—–→↗·]/;
    for (const clave of Object.keys(TEXTOS)) {
      for (const lang of idiomas) expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toMatch(signos);
    }
  });

  it("ninguno usa palabras técnicas ni las que el sitio no dice", () => {
    const tecnicas = /\b(billetera|wallet|firma|firmar|hash|red|cadena|token|contrato|comisi[oó]n|xdr|network|signature|signing|contract|fee|blockchain)\b/i;
    const prohibidas = /\b(rifa|loter[ií]a|boleto|ticket|apuesta|raffle)\b/i;
    for (const clave of Object.keys(TEXTOS)) {
      for (const lang of idiomas) {
        expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toMatch(tecnicas);
        expect(delIdioma(lang, clave), `${lang}.${clave}`).not.toMatch(prohibidas);
      }
    }
  });

  it("los dos idiomas llevan los mismos marcadores", () => {
    const marcadores = (s: string): string[] => (s.match(/\{[a-z]+\}/g) ?? []).sort();
    for (const clave of Object.keys(TEXTOS)) expect(marcadores(delIdioma("es", clave)), clave).toEqual(marcadores(delIdioma("en", clave)));
  });
});
