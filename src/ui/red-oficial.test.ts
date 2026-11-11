// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Diagnostico } from "../stellar/chequeo-red";
import type { EstadoDelPatrocinio } from "../stellar/patrocinador";

/**
 * La caja de la red con el cobro por uso del modo Oficial: el chequeo de fondo (900 ms después de la cuenta y la lista)
 * lee `/cupo`, y ahí los sellos que quedan son lo menor entre el mes y los sorteos oficiales. Una cuenta sin acceso, o
 * sin sorteos, tiene cero sellos sin haber llegado al tope del mes: la caja no puede decir «Ya usaste los sorteos
 * gratis de este mes» ni quedarse con el botón de sellar, que es lo que lleva a la caja del cupón. La red, el portero y
 * la cuenta son de mentira.
 */

const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const LIBERA = Date.UTC(2026, 11, 1);

const h = vi.hoisted(() => ({ estado: null as unknown, consultas: 0, cobro: true }));

vi.mock("./wallet-ui", () => ({ canAnchor: () => true, claveDeSellar: () => "freeze", currentSession: () => ({ address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H" }) }));
vi.mock("./anchor", () => ({ limpiarDetalle: () => undefined }));
vi.mock("./detalle-error", () => ({ ponerDetalle: () => undefined }));
vi.mock("./siguiente", () => ({ verError: () => undefined }));
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => false }));
vi.mock("../stellar/cobro-oficial", () => ({ cobroPorUso: () => h.cobro, redPrincipalConPollar: () => true }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => null, xlmBalance: async () => 0 }));
vi.mock("../stellar/chequeo-red", async (orig) => {
  const real = await orig<typeof import("../stellar/chequeo-red")>();
  const verde: Diagnostico = {
    nivel: "verde",
    caso: null,
    casos: [],
    red: "mainnet",
    rpc: null,
    pagador: "patrocinado",
    costoXlm: 0.2,
    rojoXlm: 1,
    ms: 300,
    ledger: 1,
    protocolo: 29,
    inclusionP90: 100,
    saldoXlm: null,
    restaurar: false,
    sinInternet: false,
    sinChequeo: false,
    motivo: "x",
    hora: 0,
  };
  return { ...real, chequearRed: async () => ({ ...verde, hora: Date.now() }) };
});
vi.mock("../stellar/patrocinador", async (orig) => {
  const real = await orig<typeof import("../stellar/patrocinador")>();
  return {
    ...real,
    estadoDelPatrocinio: async (g: string) => {
      h.consultas++;
      const estado = h.estado as EstadoDelPatrocinio;
      // Como el de verdad: cada respuesta se avisa a la página.
      document.dispatchEvent(new CustomEvent("tinkazo:patrocinio", { detail: { cuenta: g, estado } }));
      return estado;
    },
  };
});
// El sello de muestra del chequeo: no hace falta, la red es de mentira.
vi.mock("./chequeo-red-sdk", () => ({ cuentaDeMuestra: async () => CUENTA, armarSelloDeMuestra: async () => ({ xdr: "" }) }));
vi.mock("../stellar/rpc-red", () => ({ rpcRed: () => ({ actual: () => "https://rpc", lista: () => ["https://rpc"], cambiar: () => undefined }) }));
vi.mock("../stellar/wallet-pollar", () => ({ submitsItself: () => true }));

const oficial = (sellos: number, acceso: boolean, quedan: number): EstadoDelPatrocinio => ({
  rige: "portero",
  cupo: { sellos: { usados: 0, max: 100, quedan: sellos }, sorteos: { usados: 0, max: 100, quedan: 100 }, liberaEn: LIBERA },
  oficial: { acceso, sorteos: { quedan, proximoVence: null } },
});

const caja = (): HTMLElement => document.getElementById("red-estado") as HTMLElement;
const boton = (): HTMLButtonElement => document.getElementById("btn-freeze") as HTMLButtonElement;
const visible = (): boolean => caja().style.display === "block";

let r: typeof import("./red");
const sellar = vi.fn(async () => undefined);

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML =
    '<button id="btn-freeze">Sellar la lista</button><aside id="red-estado" style="display:none"></aside><div id="red-fila"></div><button id="btn-red"><span id="btn-red-txt"></span></button><div id="names"></div>';
  h.consultas = 0;
  h.cobro = true;
  r = await import("./red");
  sellar.mockClear();
  r.iniciarRed({ sellar });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Dos nombres y la cuenta: lo que dispara el chequeo de fondo, 900 ms después. */
async function hayListaYMira(): Promise<void> {
  const names = document.getElementById("names") as HTMLElement;
  names.replaceChildren(document.createElement("span"), document.createElement("span"));
  document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
  await vi.waitFor(() => expect(h.consultas).toBeGreaterThan(0), { timeout: 4000, interval: 20 });
  await new Promise((x) => setTimeout(x, 50));
}

describe("el chequeo de fondo con el cobro por uso", () => {
  it("una cuenta sin acceso no ve el tope del mes: el botón sigue siendo «Sellar la lista»", async () => {
    h.estado = oficial(0, false, 0);
    await hayListaYMira();
    expect(visible()).toBe(false);
    expect(r.hayAccionDeRed()).toBe(false);
    expect(r.alApretarSellar()).toBe(false);
    expect(boton().textContent).not.toContain("sin sello");
  });

  it("una cuenta que gastó sus sorteos oficiales tampoco: «Se te acabaron» es de la compuerta del sello", async () => {
    h.estado = oficial(0, true, 0);
    await hayListaYMira();
    expect(visible()).toBe(false);
    expect(r.alApretarSellar()).toBe(false);
  });

  it("con sorteos de sobra y cero sellos sí es el tope del mes, como siempre", async () => {
    h.estado = oficial(0, true, 5);
    await hayListaYMira();
    expect(visible()).toBe(true);
    expect(caja().dataset.caso).toBe("sin-patrocinio");
    expect(r.hayAccionDeRed()).toBe(true);
  });

  it("si el acceso cambia (se canjeó un cupón), la caja del cupo de antes se va y se vuelve a mirar", async () => {
    h.estado = oficial(0, true, 5);
    await hayListaYMira();
    expect(visible()).toBe(true);
    const antes = h.consultas;
    // El canje: el portero ahora cuenta 3 sorteos más y el mes no está lleno.
    h.estado = oficial(8, true, 8);
    document.dispatchEvent(new CustomEvent("tinkazo:patrocinio", { detail: { cuenta: CUENTA, estado: h.estado } }));
    expect(visible()).toBe(false);
    expect(r.hayAccionDeRed()).toBe(false);
    // Se vuelve a mirar, sin lo medido antes del canje.
    await vi.waitFor(() => expect(h.consultas).toBeGreaterThan(antes), { timeout: 4000, interval: 20 });
    await new Promise((x) => setTimeout(x, 50));
    expect(visible()).toBe(false);
  });

  it("la misma respuesta otra vez no borra nada ni vuelve a mirar sin parar", async () => {
    h.estado = oficial(0, true, 5);
    await hayListaYMira();
    const antes = h.consultas;
    document.dispatchEvent(new CustomEvent("tinkazo:patrocinio", { detail: { cuenta: CUENTA, estado: h.estado } }));
    expect(visible()).toBe(true);
    await new Promise((x) => setTimeout(x, 1200));
    expect(h.consultas).toBe(antes);
  });

  it("sin acceso, la caja de la red ofrece «Usar un cupón» como principal y sella con el paso abierto en el cupón", async () => {
    const { t } = await import("../i18n");
    await r.mostrarSinPatrocinio({ motivo: "ajena" });
    expect(boton().textContent).toBe(t("cupoOfUsarCupon"));
    expect(caja().textContent).toContain(t("errAnchor.porteroSinAlta"));
    // «Seguir sin sello» queda en chiquito, con su confirmación de siempre.
    const chicos = [...caja().querySelectorAll("button")].map((b) => b.textContent);
    expect(chicos).toContain(t("redAccSinSello"));
    expect(r.alApretarSellar()).toBe(true);
    expect(sellar).toHaveBeenCalledWith({ saltarChequeo: true, conCupon: true });
    expect(visible()).toBe(false);
  });
});

describe("el chequeo de fondo con el cobro por uso apagado (VITE_ALTA sin prender)", () => {
  // Sin el cobro por uso no corre la compuerta del acceso: el chequeo de fondo es lo que frena, como antes. Si no frenara,
  // una cuenta de Google sin acceso firmaría un sello que el portero rechaza, y esa firma cuesta igual.
  it("una cuenta sin acceso sigue frenada: la caja dice el tope y «Sellar la lista» no sella", async () => {
    h.cobro = false;
    h.estado = oficial(0, false, 0);
    await hayListaYMira();
    expect(visible()).toBe(true);
    expect(caja().dataset.caso).toBe("sin-patrocinio");
    expect(r.hayAccionDeRed()).toBe(true);
  });

  it("una cuenta con acceso que gastó sus sorteos, también", async () => {
    h.cobro = false;
    h.estado = oficial(0, true, 0);
    await hayListaYMira();
    expect(visible()).toBe(true);
    expect(caja().dataset.caso).toBe("sin-patrocinio");
  });
});
