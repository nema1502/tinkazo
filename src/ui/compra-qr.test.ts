// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import { USDC_MAINNET } from "../stellar/pagos";
import { type LecturaDeCotizacion, type MarcasDeOrden, SIN_MARCAS, leerMarcas } from "../stellar/rampa-pollar";
import { type AccionDeCompra, type LoQueSeSabe, type PermisoDeCompra, pantallaDeCompra } from "./compra-qr-estado";
import { type MotorDeCompra, type OpcionesDeCompra, abrirCompra } from "./compra-qr";

vi.mock("./qr", () => ({ qrDataUrl: vi.fn(async () => null), pintarQr: vi.fn(async () => false) }));

/**
 * La ventana Tu compra (`compra-qr.ts`): pinta la pantalla que da la máquina (`compra-qr-estado.ts`) con la llama que
 * acompaña, y corre cada toque por el motor (la demo, o el kit desde el paso que lo conecta). Todo con un motor de
 * mentira: nada sale de la prueba.
 */

/* ------------------------------------------------------------------ las órdenes de carga, como las da el proveedor */

const AHORA = Date.UTC(2026, 10, 16, 15, 1);
const CREADA = new Date(AHORA - 60_000).toISOString();
const VENCE_QR = new Date(AHORA + 14 * 60_000).toISOString();
const IMAGEN_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
/** Un QR en SVG con una marca adentro: si alguna vez se mete como marcado en la página, la prueba lo encuentra. */
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect id="marca-del-qr" width="4" height="4"/></svg>';
const CIRCLE = USDC_MAINNET.issuer;
const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" };
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: CIRCLE, chain: "STELLAR" };
const USDT_POLYGON = { kind: "asset", code: "USDT0", identifier: "0x00000000000000000000000000000000000000aa", chain: "POLYGON" };
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: "0x00000000000000000000000000000000000000bb", chain: "POLYGON" };

type Obj = Record<string, unknown>;
const paso = (kind: string, status = "pending"): Obj => ({ kind, status, signs: kind === "approve" || kind === "swap" || kind === "burn", hash: null });
const tramo = (x: Obj): Obj => ({
  status: "PENDING",
  amountInPlanned: "0",
  amountOutPlanned: "0",
  amountInActual: null,
  amountOutActual: null,
  onchainTxHash: null,
  signingMode: null,
  fundsLocation: null,
  failure: null,
  steps: [],
  etaSeconds: null,
  startedAt: null,
  ...x,
});
const pagoQr = (instrucciones: Obj = {}): Obj => ({
  kind: "FIAT_PAYMENT",
  actionId: "act-pago",
  legIndex: 0,
  expiresAt: VENCE_QR,
  instructions: {
    kind: "qr",
    amount: "102.00",
    currency: "BOB",
    scannable: { kind: "opaque", image: { mediaType: "image/png", encoding: "base64", data: IMAGEN_PNG } },
    link: null,
    ...instrucciones,
  },
});
/**
 * Los tramos de una carga según por dónde va: 1 Stereum vio el pago, 2 la primera confirmación del cambio, 3 la segunda,
 * 4 la primera del envío y 5 la segunda.
 */
function legsEn(etapa: number): Obj[] {
  const enPaso = { chain: "POLYGON", address: "0x00000000000000000000000000000000000000cc", asset: "USDT0", amount: "0" };
  const canje =
    etapa <= 1
      ? { status: "ACTIVE", fundsLocation: enPaso, startedAt: CREADA, steps: [paso("approve", "pending"), paso("swap")] }
      : etapa === 2
        ? { status: "AWAITING_ACTION", fundsLocation: enPaso, startedAt: CREADA, steps: [paso("approve", "awaiting_approval"), paso("swap")] }
        : etapa === 3
          ? { status: "AWAITING_ACTION", fundsLocation: enPaso, startedAt: CREADA, steps: [paso("approve", "done"), paso("swap", "awaiting_approval")] }
          : { status: "COMPLETED", amountOutActual: "8.53", steps: [paso("approve", "done"), paso("swap", "done")] };
  const envio =
    etapa === 4
      ? { status: "AWAITING_ACTION", fundsLocation: { ...enPaso, asset: "USDC" }, startedAt: CREADA, steps: [paso("approve", "awaiting_approval"), paso("burn"), paso("attestation"), paso("mint")] }
      : etapa === 5
        ? { status: "AWAITING_ACTION", fundsLocation: { ...enPaso, asset: "USDC" }, startedAt: CREADA, steps: [paso("approve", "done"), paso("burn", "awaiting_approval"), paso("attestation"), paso("mint")] }
        : {};
  return [
    tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountInPlanned: "102", status: "COMPLETED", amountInActual: "102", amountOutActual: "8.55", etaSeconds: 300, startedAt: CREADA }),
    tramo({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountInPlanned: "8.55", signingMode: "COSIGNED", etaSeconds: 60, ...canje }),
    tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: "8.53", signingMode: "COSIGNED", steps: [paso("approve"), paso("burn"), paso("attestation"), paso("mint")], etaSeconds: 600, ...envio }),
  ];
}

function orden(o: Obj = {}): Obj {
  return {
    id: "ord_9f8e7d6c5b4a3210",
    direction: "ONRAMP",
    state: "awaiting_payment",
    createdAt: CREADA,
    legs: [
      tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountInPlanned: "102", status: "AWAITING_ACTION", etaSeconds: 300, startedAt: CREADA }),
      tramo({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountInPlanned: "8.55", signingMode: "COSIGNED", steps: [paso("approve"), paso("swap")], etaSeconds: 60 }),
      tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: "8.53", signingMode: "COSIGNED", steps: [paso("approve"), paso("burn"), paso("attestation"), paso("mint")], etaSeconds: 600 }),
    ],
    pendingAction: pagoQr(),
    failure: null,
    nextPollAfter: "2026-11-16T15:01:10.000Z",
    ...o,
  };
}

/* ------------------------------------------------------------------ lo que se sabe, y un motor de mentira */

const ALTA: ProductoALaVenta = { id: "alta", usdc: "4", sorteos: 3, dias: 90 };
const PERMISO: PermisoDeCompra = { producto: "alta", desde: AHORA - 60_000, recargo: "4.25", total: "8.25", primera: true, cargada: false };
const CARGADA: PermisoDeCompra = { ...PERMISO, cargada: true };
const verif = (tipo: "KYC" | "FORM", estado: "por-hacer" | "en-curso" = "por-hacer", numero = 1): LecturaDeCotizacion => ({
  estado: "falta",
  falta: [{ que: "verificacion", paso: { tipo, estado, numero, total: 4, opcion: "opt-1", corredor: "cor-1" } }],
});

const base = (o: Partial<LoQueSeSabe> = {}): LoQueSeSabe => ({
  idioma: "es",
  ahora: AHORA,
  aparato: "compu",
  medio: "qr",
  cambio: true,
  producto: ALTA,
  permiso: PERMISO,
  saldo: "0.0000000",
  cotizacion: null,
  carga: null,
  aprobacionesTotales: 4,
  ...o,
});
const conQr = (o: Partial<LoQueSeSabe> = {}, marcas: Partial<MarcasDeOrden> = {}, ord: Obj = orden()): LoQueSeSabe =>
  base({ permiso: CARGADA, carga: { orden: ord, marcas: { ...SIN_MARCAS, ...marcas }, vista: {} }, ...o });

interface Llamada {
  accion: AccionDeCompra;
  s: LoQueSeSabe;
  entrada?: Record<string, string>;
}

/** Un motor que contesta lo que se le pide y anota cada llamada. */
function motor(inicio: LoQueSeSabe, respuestas: Partial<Record<AccionDeCompra, (s: LoQueSeSabe) => LoQueSeSabe | Promise<LoQueSeSabe>>> = {}, extra: Partial<MotorDeCompra> = {}) {
  const hechas: Llamada[] = [];
  const miradas: LoQueSeSabe[] = [];
  const m: MotorDeCompra = {
    inicio: () => inicio,
    mirar: vi.fn(async (s: LoQueSeSabe) => {
      miradas.push(s);
      return s;
    }),
    hacer: vi.fn(async (accion: AccionDeCompra, s: LoQueSeSabe, o: { entrada?: Record<string, string> }) => {
      hechas.push({ accion, s, ...(o.entrada ? { entrada: o.entrada } : {}) });
      const r = respuestas[accion];
      return r ? r(s) : s;
    }),
    ritmoMs: 1_000,
    ...extra,
  };
  return { m, hechas, miradas };
}

/** Un almacén de marcas en memoria, para no tocar el del navegador. */
function almacen() {
  const datos = new Map<string, string>();
  return { datos, getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
}

let ahora = AHORA;
const abrir = (m: MotorDeCompra, o: Partial<OpcionesDeCompra> = {}) => {
  const v = abrirCompra({ motor: m, permitida: true, confiar: () => true, reloj: () => ahora, almacen: almacen(), ...o });
  if (!v) throw new Error("la ventana debía abrirse");
  return v;
};

const card = () => document.querySelector<HTMLElement>('[role="dialog"]');
const principal = () => document.querySelector<HTMLElement>(".dlg-pie .dlg-main") as HTMLElement;
const enlaceDelPie = () => document.querySelector<HTMLElement>(".dlg-pie .cq-enlace");
/** El toque: pasa el medio segundo de la guarda y toca. */
async function tocar(el: HTMLElement | null): Promise<void> {
  if (!el) throw new Error("no hay nada que tocar");
  ahora += 600;
  el.click();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  ahora = AHORA;
  setLang("es");
  document.body.innerHTML = '<button id="abre">Comprar</button>';
});
afterEach(() => {
  for (const b of document.querySelectorAll(".modal-back")) b.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("abrir y cerrar", () => {
  it("sin la compra con QR en el build ni la demo, no abre nada", () => {
    const { m } = motor(base());
    expect(abrirCompra({ motor: m, permitida: false })).toBeNull();
    expect(card()).toBeNull();
  });

  it("importar la ventana no abre nada: se abre solo con una llamada", () => {
    expect(card()).toBeNull();
    expect(document.querySelector(".cq-card")).toBeNull();
  });

  it("es un diálogo de verdad: título Tu compra, el foco adentro y, al cerrar, el foco vuelve a quien la abrió", async () => {
    const boton = document.getElementById("abre") as HTMLButtonElement;
    boton.focus();
    const cerro = vi.fn();
    const { m } = motor(base({ cotizacion: verif("KYC") }), {}, { cerrar: cerro });
    abrir(m);
    const c = card() as HTMLElement;
    expect(c.getAttribute("aria-modal")).toBe("true");
    expect(c.querySelector(".dlg-h")?.textContent).toBe(t("compraVentana"));
    expect(c.contains(document.activeElement)).toBe(true);
    (c.querySelector('[data-dlg="x"]') as HTMLElement).click();
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(boton);
    expect(cerro).toHaveBeenCalledTimes(1);
  });

  it("Escape la cierra y deja de mirar sola", async () => {
    const { m, miradas } = motor(conQr({}, { mostroQr: AHORA - 30_000, dijoPago: AHORA - 5_000 }));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("espera-pago");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card()).toBeNull();
    const antes = miradas.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(miradas.length).toBe(antes);
  });
});

describe("cada pantalla: un título, una línea, los datos, una principal y lo demás plegado", () => {
  it("el título arriba, la línea en el globo de la llama (una sola vez), una sola principal en el pie y lo plegado cerrado", () => {
    const { m } = motor(base({ cotizacion: verif("KYC") }));
    abrir(m);
    const c = card() as HTMLElement;
    const p = pantallaDeCompra(base({ cotizacion: verif("KYC") }));
    expect(c.dataset.pantalla).toBe("verificar");
    expect(c.querySelector(".cq-titulo")?.textContent).toBe(t("compraVerifTitulo"));
    const globo = c.querySelector(".llg-globo");
    expect(globo?.textContent).toBe(t("compraVerifLinea"));
    expect(c.textContent?.split(t("compraVerifLinea")).length).toBe(2);
    expect(c.querySelectorAll(".dlg-main")).toHaveLength(1);
    expect(principal().textContent).toBe(t("cargaVerifEmpezar"));
    expect(principal().dataset.accion).toBe(p.principal.accion);
    expect(enlaceDelPie()?.textContent).toBe(t("compraNoEstoy"));
    const mas = c.querySelector<HTMLDetailsElement>("details.cq-mas");
    expect(mas?.open).toBe(false);
    expect(mas?.querySelector("summary")?.textContent).toBe(t("saldoMasDetalles"));
    expect(mas?.textContent).toContain(t("compraVerifPasos"));
  });

  it("la llama acompaña con el paso del recorrido: en la verificación de la primera compra, Paso 2 de 4", () => {
    const { m } = motor(base({ cotizacion: verif("KYC") }));
    abrir(m);
    const barra = card()?.querySelector('.llg [role="progressbar"]');
    expect(barra?.getAttribute("aria-valuenow")).toBe("2");
    expect(barra?.getAttribute("aria-valuemax")).toBe("4");
    expect(card()?.querySelector(".llg")?.getAttribute("data-pose")).toBe("anima");
  });

  it("los datos van como rótulo y valor: junto al QR el monto y el vencimiento, y Tu dinero desde Ya pagué", async () => {
    const { m } = motor(conQr());
    abrir(m);
    const c = card() as HTMLElement;
    expect(c.dataset.pantalla).toBe("qr");
    const filas = [...c.querySelectorAll<HTMLElement>("dl.cq-datos .cq-dato")];
    const rotulos = filas.map((f) => f.querySelector("dt")?.textContent);
    expect(rotulos).toEqual(["Monto", "Vence"]);
    const monto = filas[0] as HTMLElement;
    expect(monto.classList.contains("cq-dato-monto")).toBe(true);
    expect(monto.querySelector("dd")?.textContent).toBe("Bs 102");
    expect(filas[1]?.querySelector("dd")?.textContent).toMatch(/^\d{2}:\d{2}$/);
    await tocar(principal());
    expect(c.dataset.pantalla).toBe("espera-pago");
    const dinero = c.querySelector<HTMLElement>(".cq-dato-dinero");
    expect(dinero?.querySelector("dt")?.textContent).toBe("Tu dinero");
    expect(dinero?.querySelector("dd")?.textContent).toBe(t("compraDondeSaliendo"));
  });

  it("el paso de la llama dice también qué tramo es, a la vista", () => {
    const { m } = motor(base({ cotizacion: verif("KYC") }));
    abrir(m);
    expect(card()?.querySelector(".llg-paso")?.textContent).toBe("Paso 2 de 4: Tu identidad");
  });

  it("con el dinero en camino la llama va sin camino: las cuatro etapas ya dicen el avance", () => {
    const camino = orden({ state: "processing", pendingAction: { kind: "NONE", actionId: "act-nada", legIndex: 0 }, legs: legsEn(1) });
    const { m } = motor(conQr({}, { dijoPago: AHORA - 60_000 }, camino));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("camino");
    expect(card()?.querySelector(".llg")?.classList.contains("sin-camino")).toBe(true);
    expect(card()?.querySelectorAll(".cq-etapa")).toHaveLength(4);
  });

  it("la llama avanza un poco con cada confirmación, aunque la etapa del dinero no cambie", async () => {
    const enAprobacion = (n: number) => orden({ state: "processing", pendingAction: { kind: "COSIGN_APPROVAL", actionId: `act-${n}`, legIndex: n <= 2 ? 1 : 2, cosignRequestId: `cos-${n}`, summary: "Approve" }, legs: legsEn(n + 1) });
    let n = 1;
    const { m } = motor(conQr({}, { dijoPago: AHORA - 60_000 }, enAprobacion(1)), {
      aprobar: (s) => {
        n++;
        return { ...s, carga: s.carga ? { ...s.carga, orden: enAprobacion(n) } : null };
      },
    });
    abrir(m, {});
    await tocar(principal());
    expect(card()?.dataset.pantalla).toBe("aprobar");
    const xs: number[] = [];
    for (let i = 1; i <= 4; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(card()?.querySelector(".cq-titulo")?.textContent).toBe(`Confirmación ${i} de 4`);
      xs.push(Number(card()?.querySelector<HTMLElement>(".llg")?.style.getPropertyValue("--x")));
      if (i < 4) await tocar(principal());
    }
    for (let i = 1; i < xs.length; i++) expect(xs[i], JSON.stringify(xs)).toBeGreaterThan(xs[i - 1] as number);
    expect(xs[3]).toBeLessThan(1);
  });

  it("en inglés, todo en inglés", () => {
    setLang("en");
    const { m } = motor(base({ idioma: "en", cotizacion: verif("KYC") }));
    abrir(m);
    expect(card()?.querySelector(".dlg-h")?.textContent).toBe("Your purchase");
    expect(card()?.querySelector(".cq-titulo")?.textContent).toBe(t("compraVerifTitulo"));
    expect(principal().textContent).toBe("Start");
  });

  it("al terminar, la llama festeja una sola vez y Armar mi primer sorteo cierra la ventana y lleva a sortear", async () => {
    const terminado = { ...conQr(), pago: { fase: "listo" as const, quedan: 3, saldo: "0.2500000" } };
    const { m } = motor(terminado);
    const alCerrar = vi.fn();
    const afuera = vi.fn();
    abrir(m, { alCerrar, afuera });
    const c = card() as HTMLElement;
    expect(c.dataset.pantalla).toBe("listo");
    expect(c.querySelector(".llg")?.getAttribute("data-pose")).toBe("festeja");
    expect(c.querySelectorAll(".llg-papel")).toHaveLength(1);
    expect(principal().textContent).toBe(t("compraArmarSorteo"));
    await tocar(principal());
    expect(card()).toBeNull();
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(afuera).toHaveBeenCalledWith("sortear", expect.objectContaining({ producto: ALTA }));
  });

  it("al terminar después de pagar, el festejo se ve aunque la llama venga caminando", async () => {
    const pagando = { ...conQr(), pago: { fase: "pagando" as const } };
    const { m } = motor(pagando);
    (m.mirar as ReturnType<typeof vi.fn>).mockImplementation(async (s: LoQueSeSabe) => ({ ...s, pago: { fase: "listo" as const, quedan: 3, saldo: null } }));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("pagando");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(card()?.dataset.pantalla).toBe("listo");
    expect(card()?.querySelector(".llg")?.getAttribute("data-pose")).toBe("festeja");
    expect(card()?.querySelectorAll(".llg-papel")).toHaveLength(1);
  });
});

describe("el QR", () => {
  it("siempre como imagen sobre caja blanca, nunca el SVG metido en la página", () => {
    const svg = pagoQr({ scannable: { kind: "opaque", image: { mediaType: "image/svg+xml", encoding: "utf8", data: QR_SVG } } });
    const { m } = motor(conQr({}, {}, orden({ pendingAction: svg })));
    abrir(m);
    const img = card()?.querySelector<HTMLImageElement>(".cq-qr-caja img.cq-qr");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
    expect(img?.alt).toBe(t("compraQrAlt").replace("{bs}", "102"));
    expect(document.getElementById("marca-del-qr")).toBeNull();
  });

  it("al mostrarlo, este navegador lo anota: la orden se recuerda como vista", () => {
    const a = almacen();
    const { m } = motor(conQr());
    abrir(m, { almacen: a });
    expect(leerMarcas("ord_9f8e7d6c5b4a3210", a).mostroQr).toBe(AHORA);
  });

  it("Ya pagué anota que dijo que pagó y recién ahí le pregunta al motor", async () => {
    const a = almacen();
    const { m, hechas } = motor(conQr());
    abrir(m, { almacen: a });
    await tocar(principal());
    expect(hechas.map((h) => h.accion)).toEqual(["ya-pague"]);
    expect(hechas[0]?.s.carga?.marcas.dijoPago).not.toBeNull();
    expect(leerMarcas("ord_9f8e7d6c5b4a3210", a).dijoPago).not.toBeNull();
    expect(card()?.dataset.pantalla).toBe("espera-pago");
  });

  it("Todavía no pagué borra la marca y vuelve al mismo QR, con el aviso de no pagarlo dos veces", async () => {
    const a = almacen();
    const { m, hechas } = motor(conQr());
    abrir(m, { almacen: a });
    await tocar(principal());
    expect(card()?.dataset.pantalla).toBe("espera-pago");
    expect(enlaceDelPie()?.textContent).toBe(t("compraTodaviaNo"));
    await tocar(enlaceDelPie());
    expect(hechas.map((h) => h.accion)).toEqual(["ya-pague", "todavia-no"]);
    expect(leerMarcas("ord_9f8e7d6c5b4a3210", a).dijoPago).toBeNull();
    expect(card()?.dataset.pantalla).toBe("qr");
    expect(card()?.querySelector(".llg-globo")?.textContent).toBe(t("compraTodaviaNoLinea"));
    expect(card()?.querySelector("img.cq-qr")).not.toBeNull();
  });

  it("con el QR vencido y la compra cerrada, Ya lo había pagado anota que pagó y lleva a pedir ayuda, sin pagar de nuevo", async () => {
    const a = almacen();
    const cerrada = orden({ state: "failed", nextPollAfter: null, pendingAction: { ...pagoQr(), expiresAt: new Date(AHORA - 60_000).toISOString() } });
    const { m, hechas } = motor(base({ permiso: CARGADA, carga: { orden: cerrada, marcas: { ...SIN_MARCAS, mostroQr: AHORA - 600_000 }, vista: { qrALaVista: true } } }));
    abrir(m, { almacen: a });
    expect(card()?.dataset.pantalla).toBe("qr-vencido-cerrada");
    expect(enlaceDelPie()?.textContent).toBe(t("compraPagueIgual"));
    await tocar(enlaceDelPie());
    expect(hechas.map((h) => h.accion)).toEqual(["pague-igual"]);
    expect(hechas[0]?.s.carga?.marcas.dijoPago).not.toBeNull();
    expect(leerMarcas("ord_9f8e7d6c5b4a3210", a).dijoPago).not.toBeNull();
    expect(card()?.dataset.pantalla).toBe("fallo");
    expect(principal().getAttribute("href")).toBe("mailto:hola@tinkazo.app?subject=Compra%205B4A3210");
    expect(card()?.querySelector('.cq-dato[data-clave="compraDatoNumero"]')).not.toBeNull();
  });

  it("en el celular, primero Guardar el QR (que baja la imagen) y recién después Ya pagué", async () => {
    const a = almacen();
    const { m, hechas } = motor(conQr({ aparato: "celular" }));
    abrir(m, { almacen: a });
    const guardar = principal();
    expect(guardar.tagName).toBe("A");
    expect(guardar.getAttribute("download")).toBeTruthy();
    expect(guardar.getAttribute("href")?.startsWith("data:image/png;base64,")).toBe(true);
    expect(guardar.textContent).toBe(t("cargaGuardarQr"));
    // jsdom no baja archivos: el enlace hace lo suyo en el navegador.
    document.addEventListener("click", (e) => e.preventDefault(), { once: true });
    await tocar(guardar);
    expect(leerMarcas("ord_9f8e7d6c5b4a3210", a).guardoQr).not.toBeNull();
    expect(hechas.map((h) => h.accion)).toEqual(["guardar-qr"]);
    expect(principal().textContent).toBe(t("cargaYaPague"));
    // Ya guardado, la línea dice qué hacer con la imagen.
    expect(card()?.querySelector(".llg-globo")?.textContent).toBe(t("compraQrGuardadoLinea"));
  });

  it("en el celular, Abrir en la app de mi banco deja a mano Ya pagué, sin pedir que baje la imagen", async () => {
    const { m, hechas } = motor(conQr({ aparato: "celular" }, {}, orden({ pendingAction: pagoQr({ link: "https://banco.example/pagar" }) })));
    abrir(m);
    expect(principal().dataset.accion).toBe("guardar-qr");
    const banco = enlaceDelPie() as HTMLElement;
    expect(banco.getAttribute("href")).toBe("https://banco.example/pagar");
    // jsdom no abre otra página: el enlace hace lo suyo en el navegador.
    document.addEventListener("click", (e) => e.preventDefault(), { once: true });
    await tocar(banco);
    expect(hechas.map((h) => h.accion)).toEqual(["abrir-banco"]);
    expect(principal().dataset.accion).toBe("ya-pague");
    expect(card()?.querySelector(".llg-globo")?.textContent).toBe(t("compraTodaviaNoLinea"));
  });
});

describe("la guarda de cada toque", () => {
  it("un toque que no viene de la persona no hace nada", async () => {
    const { m, hechas } = motor(conQr());
    abrir(m, { confiar: (e) => e.isTrusted });
    await tocar(principal());
    expect(hechas).toHaveLength(0);
  });

  it("un toque a menos de medio segundo de que cambió la principal no hace nada: dos toques no aprueban dos pasos", async () => {
    const { m, hechas } = motor(conQr());
    abrir(m);
    principal().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(hechas).toHaveLength(0);
    ahora += 499;
    principal().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(hechas).toHaveLength(0);
    ahora += 2;
    principal().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(hechas).toHaveLength(1);
  });

  it("mientras el motor trabaja, la principal queda ocupada y otro toque no llama de nuevo", async () => {
    let soltar: (s: LoQueSeSabe) => void = () => undefined;
    const { m, hechas } = motor(base({ cotizacion: verif("KYC") }), { "empezar-verificacion": () => new Promise((r) => (soltar = r)) });
    abrir(m);
    await tocar(principal());
    expect(principal().getAttribute("aria-busy")).toBe("true");
    expect((principal() as HTMLButtonElement).disabled).toBe(true);
    await tocar(principal());
    expect(hechas).toHaveLength(1);
    soltar(base({ cotizacion: verif("KYC"), verificacion: { empezo: true } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset.pantalla).toBe("carnet");
    expect(principal().getAttribute("aria-busy")).toBeNull();
  });
});

describe("nada sigue solo", () => {
  it("las pantallas que esperan algo de afuera miran solas, sin hacer nada; las que esperan un toque, no", async () => {
    const { m, miradas, hechas } = motor(conQr({}, { mostroQr: AHORA - 30_000, dijoPago: AHORA - 5_000 }));
    abrir(m);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(miradas.length).toBeGreaterThanOrEqual(3);
    expect(hechas).toHaveLength(0);

    for (const b of document.querySelectorAll(".modal-back")) b.remove();
    const otro = motor(conQr());
    abrir(otro.m);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(otro.miradas).toHaveLength(0);
    expect(otro.hechas).toHaveLength(0);
  });

  it("la espera lee enseguida lo que falta y muestra lo que llegó", async () => {
    const { m } = motor(base({ saldo: null }));
    (m.mirar as ReturnType<typeof vi.fn>).mockImplementation(async (s: LoQueSeSabe) => ({ ...s, saldo: "0.0000000", cotizacion: verif("KYC") }));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("espera");
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset.pantalla).toBe("verificar");
  });

  it("si la lectura de la espera falla, no lee sin pausa: después de unos intentos, Probar de nuevo", async () => {
    const { m } = motor(base({ saldo: null }));
    const mirar = m.mirar as ReturnType<typeof vi.fn>;
    mirar.mockImplementation(async () => {
      throw new Error("sin conexión");
    });
    abrir(m);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mirar.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mirar.mock.calls.length).toBeLessThanOrEqual(6);
    expect(card()?.dataset.pantalla).toBe("sin-red");
    expect(principal().dataset.accion).toBe("reintentar");
  });

  it("si la espera vuelve igual, mira con pausas que crecen y al final ofrece Probar de nuevo", async () => {
    const { m, miradas } = motor(base({ medio: "app", permiso: null }));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("espera");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(miradas.length).toBeGreaterThanOrEqual(2);
    expect(miradas.length).toBeLessThanOrEqual(6);
    expect(card()?.dataset.pantalla).toBe("sin-red");
  });

  it("con el QR vencido y la compra abierta mira sola: si el pago llega, se ve sin tocar nada", async () => {
    const vencida = orden({ pendingAction: { ...pagoQr(), expiresAt: new Date(AHORA - 60_000).toISOString() } });
    const { m, miradas, hechas } = motor(conQr({}, { mostroQr: AHORA - 600_000 }, vencida));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("qr-vencido-abierta");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(miradas.length).toBeGreaterThanOrEqual(1);
    expect(hechas).toHaveLength(0);
  });

  it("una orden que no se puede leer mira sola: si después se completa, la persona lo ve sin cerrar la ventana", async () => {
    const { m, miradas } = motor(conQr({}, {}, orden({ legs: [{ kind: "OTRO" }] })));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("desconocido");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(miradas.length).toBeGreaterThanOrEqual(1);
  });

  it("lo que vuelve de una mirada vieja no pisa lo que hizo un toque", async () => {
    let soltarMirada: (s: LoQueSeSabe) => void = () => undefined;
    const inicio = conQr({}, { mostroQr: AHORA - 30_000, dijoPago: AHORA - 5_000 });
    const { m } = motor(inicio, { "todavia-no": (s) => s });
    (m.mirar as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => (soltarMirada = r)));
    abrir(m);
    await vi.advanceTimersByTimeAsync(1_000);
    await tocar(enlaceDelPie());
    expect(card()?.dataset.pantalla).toBe("qr");
    soltarMirada(inicio);
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset.pantalla).toBe("qr");
  });
});

describe("los toques que se resuelven en la ventana", () => {
  it("Escribir a Tinkazo es un correo con el número de compra en el asunto", () => {
    const fallo = orden({ state: "failed", pendingAction: null, nextPollAfter: null });
    const { m } = motor(conQr({}, { dijoPago: AHORA - 600_000 }, fallo));
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("fallo");
    const a = principal();
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("mailto:hola@tinkazo.app?subject=Compra%205B4A3210");
    expect(a.textContent).toBe(t("compraEscribinos"));
    const numero = card()?.querySelector<HTMLElement>('.cq-dato[data-clave="compraDatoNumero"]');
    expect(numero?.querySelector("dd")?.textContent).toContain("5B4A3210");
    expect(numero?.querySelector("button")?.textContent).toBe(t("acctCopy"));
  });

  it("Abrir la verificación abre la otra pestaña dentro del toque y le pone la dirección después", async () => {
    const pestana = { location: { href: "" }, opener: {} as unknown, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => pestana as unknown as Window);
    const inicio = base({ cotizacion: verif("KYC"), verificacion: { empezo: true } });
    const { m, hechas } = motor(inicio, { "abrir-verificacion": (s) => s }, { verificacion: async () => "https://verificacion.example/sesion" });
    abrir(m);
    expect(card()?.dataset.pantalla).toBe("carnet");
    await tocar(principal());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe("");
    expect(pestana.opener).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(pestana.location.href).toBe("https://verificacion.example/sesion");
    expect(hechas[0]?.s.verificacion?.abrio).toBe(true);
  });

  it("si el navegador no deja abrir la pestaña, la principal pasa a ser el enlace", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const inicio = base({ cotizacion: verif("KYC"), verificacion: { empezo: true } });
    const { m } = motor(inicio, { "abrir-verificacion": (s) => s }, { verificacion: async () => "https://verificacion.example/sesion" });
    abrir(m);
    await tocar(principal());
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.dataset.pantalla).toBe("carnet-bloqueada");
    const a = principal();
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("https://verificacion.example/sesion");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("lo que sigue fuera de la ventana (un cupón, mandar, entrar) la cierra y avisa a quien la abrió", async () => {
    const afuera = vi.fn();
    const { m, hechas } = motor(base({ cotizacion: { estado: "rechazada" } }));
    abrir(m, { afuera });
    expect(card()?.dataset.pantalla).toBe("rechazo");
    await tocar(principal());
    expect(card()).toBeNull();
    expect(afuera).toHaveBeenCalledWith("usar-cupon", expect.objectContaining({ producto: ALTA }));
    expect(hechas).toHaveLength(0);
  });
});

describe("pagar desde otra app", () => {
  it("la moneda como dato, el monto, la nota y la cuenta corta, cada uno con Copiar, y Copiar copia la cuenta entera", async () => {
    const escribir = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escribir }, configurable: true });
    const destino = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
    const orden = { id: "ABCD2345", producto: "alta", usdc: "4", sorteos: 3, destino, nota: "tk:o:ABCD2345", memoId: "1", enlace: `web+stellar:pay?destination=${destino}`, vence: AHORA + 3 * 86_400_000 };
    const { m } = motor(base({ medio: "app", permiso: null, ordenDelPaquete: orden }));
    abrir(m);
    const c = card() as HTMLElement;
    expect(c.dataset.pantalla).toBe("app");
    const rotulos = [...c.querySelectorAll("dl.cq-datos dt")].map((d) => d.textContent);
    expect(rotulos).toEqual(["Moneda", t("pagoMonto"), t("compraNotaRotulo"), t("pagoCuenta")]);
    // El monto con su moneda: sin ella, alguien puede mandar otra y perderla. Copiar copia solo el número.
    const monto = c.querySelector<HTMLElement>('.cq-dato[data-app="monto"]') as HTMLElement;
    expect(monto.querySelector("dd code")?.textContent).toBe("4 USDC");
    await tocar(monto.querySelector("button"));
    expect(escribir).toHaveBeenCalledWith("4");
    // La hora en 24 horas: sin a. m. ni un punto de más.
    const vence = [...c.querySelectorAll("details.cq-mas p")].map((p) => p.textContent ?? "").find((x) => x.startsWith("Esta nota vale hasta"));
    expect(vence).toMatch(/\d{2}:\d{2}\.$/);
    expect(vence).not.toMatch(/m\.\.|a\. m|p\. m/);
    const cuenta = c.querySelector<HTMLElement>('.cq-dato[data-app="cuenta"]') as HTMLElement;
    expect(cuenta.querySelector("dd code")?.textContent).toBe("GBRP…OX2H");
    await tocar(cuenta.querySelector("button"));
    expect(escribir).toHaveBeenCalledWith(destino);
    expect(principal().textContent).toBe(t("pagoYaPague"));
    expect(enlaceDelPie()?.textContent).toBe(t("compraEstoy"));
  });
});

describe("los datos que pide la verificación", () => {
  it("el formulario se pinta con sus rótulos y lo escrito va al motor; si falta algo, lo marca y no sigue", async () => {
    const inicio = base({ cotizacion: verif("FORM", "por-hacer", 2) });
    const { m, hechas } = motor(inicio, {}, {
      detalle: () => ({
        campos: [
          { clave: "documento", rotulo: "Número de carnet", tipo: "text", valor: "4567890", obligatorio: true },
          { clave: "ciudad", rotulo: "Ciudad", tipo: "select", opciones: [{ valor: "LPZ", rotulo: "La Paz" }, { valor: "SCZ", rotulo: "Santa Cruz" }], valor: "SCZ", obligatorio: true },
          { clave: "celular", rotulo: "Celular", tipo: "tel", obligatorio: true },
        ],
      }),
    });
    abrir(m);
    const c = card() as HTMLElement;
    expect(c.dataset.pantalla).toBe("datos");
    expect([...c.querySelectorAll(".cq-campo label")].map((l) => l.textContent)).toEqual(["Número de carnet", "Ciudad", "Celular"]);
    await tocar(principal());
    expect(hechas).toHaveLength(0);
    expect(c.querySelector('[name="celular"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(c.querySelector(".dlg-estado")?.textContent).toBe(t("cargaFormFalta"));
    (c.querySelector('[name="celular"]') as HTMLInputElement).value = "70000000";
    await tocar(principal());
    expect(hechas[0]?.accion).toBe("guardar-datos");
    expect(hechas[0]?.entrada).toEqual({ documento: "4567890", ciudad: "SCZ", celular: "70000000" });
  });

  it("los datos que pide la cotización van con Ver el QR; si falta uno, no se crea nada", async () => {
    const precio = { quoteId: "q-1", vence: new Date(AHORA + 600_000).toISOString(), pagas: 102, recibis: 8.6, tasa: 11.86, minutos: 16, aprobaciones: 4, campos: [{ key: "telefono", label: "Celular", type: "tel" as const }] };
    const inicio = base({ cotizacion: { estado: "precio", precio } });
    const { m, hechas } = motor(inicio, {}, { detalle: (_s, p) => (p.id === "precio" ? { campos: [{ clave: "telefono", rotulo: "Celular", tipo: "tel", obligatorio: true }] } : null) });
    abrir(m);
    const c = card() as HTMLElement;
    expect(c.dataset.pantalla).toBe("precio");
    await tocar(principal());
    expect(hechas).toHaveLength(0);
    (c.querySelector('[name="telefono"]') as HTMLInputElement).value = "70000000";
    await tocar(principal());
    expect(hechas[0]?.accion).toBe("ver-qr");
    expect(hechas[0]?.entrada).toEqual({ telefono: "70000000" });
  });
});
