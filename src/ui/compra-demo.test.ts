// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { ESCENARIOS, type Escenario, montarDemoDeCompra } from "./compra-demo";

vi.mock("./qr", () => ({ qrDataUrl: vi.fn(async () => null), pintarQr: vi.fn(async () => false) }));

/**
 * La demo de la compra (`compra-demo.ts`): solo en la máquina de quien prueba y con `VITE_RAMPA_DEMO`, con órdenes
 * inventadas y sin red. Deja recorrer el camino feliz, el Ya pagué por error y las fallas que pide el plan, tocando la
 * principal como lo haría una persona.
 */

const LOCAL = { host: "localhost", rampaDemo: "1" };
const ventanaDeSumar = (): HTMLElement | null => document.querySelector('[data-pago="paquete"]');

let ahora = Date.UTC(2026, 10, 16, 15, 0);
const card = () => document.querySelector<HTMLElement>('[role="dialog"]');
const principal = () => document.querySelector<HTMLElement>(".dlg-pie .dlg-main") as HTMLElement;
const enlaceDelPie = () => document.querySelector<HTMLElement>(".dlg-pie .cq-enlace") as HTMLElement;
const pantalla = () => card()?.dataset.pantalla ?? null;

async function pasar(ms: number): Promise<void> {
  ahora += ms;
  await vi.advanceTimersByTimeAsync(ms);
}
async function tocar(el: HTMLElement): Promise<void> {
  await pasar(600);
  el.click();
  await pasar(0);
}

function abrirEscenario(id: Escenario): void {
  expect(montarDemoDeCompra({ entorno: LOCAL, confiar: () => true, reloj: () => ahora })).toBe(true);
  const b = document.querySelector<HTMLButtonElement>(`.cq-demo [data-escenario="${id}"]`);
  if (!b) throw new Error(`falta el escenario ${id}`);
  b.click();
}

/**
 * Recorre tocando la principal (o esperando, en las pantallas que miran solas) hasta llegar a `hasta`. Devuelve las
 * pantallas por las que pasó, sin repetir las seguidas.
 */
async function recorrer(hasta: string, maximo = 80): Promise<string[]> {
  const vistas: string[] = [];
  for (let i = 0; i < maximo; i++) {
    const id = pantalla();
    if (id && vistas[vistas.length - 1] !== id) vistas.push(id);
    if (id === hasta) return vistas;
    const p = principal();
    if (!p || (p as HTMLButtonElement).disabled || p.tagName === "A") await pasar(1_000);
    else await tocar(p);
  }
  throw new Error(`no llegó a ${hasta}: ${vistas.join(" > ")}`);
}

const enOrden = (vistas: string[], esperadas: string[]): boolean => {
  let i = 0;
  for (const v of vistas) if (v === esperadas[i]) i++;
  return i === esperadas.length;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  ahora = Date.UTC(2026, 10, 16, 15, 0);
  setLang("es");
  document.body.innerHTML = "";
  try {
    localStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});
afterEach(() => {
  for (const b of document.querySelectorAll(".modal-back")) b.remove();
  vi.useRealTimers();
});

describe("la ventana Sumar sorteos, pagando con dólares digitales", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    document.body.innerHTML = "";
    localStorage.clear();
  });
  afterEach(() => {
    for (const b of document.querySelectorAll(".modal-back")) b.remove();
    vi.useRealTimers();
  });

  it("abre la ventana de hoy con la orden de mentira: la moneda, el monto, la nota, la cuenta corta y Estoy en Bolivia antes", async () => {
    expect(montarDemoDeCompra({ entorno: LOCAL, confiar: () => true, reloj: () => ahora })).toBe(true);
    const b = document.querySelector<HTMLButtonElement>('.cq-demo [data-ventana="sumar"]') as HTMLButtonElement;
    expect(b).not.toBeNull();
    b.click();
    await vi.advanceTimersByTimeAsync(50);
    const panel = ventanaDeSumar()?.querySelector<HTMLElement>('[data-pago="panel"]');
    expect(panel?.firstElementChild?.textContent).toBe(t("compraEstoy"));
    expect(panel?.querySelector('[data-dato="moneda"]')?.textContent).toBe("USDC en Stellar");
    expect(panel?.querySelector('[data-dato="monto"]')?.textContent).toBe("10 USDC");
    expect(panel?.querySelector('[data-dato="destino"]')?.textContent).toMatch(/^GDEM…/);
    // Estoy en Bolivia cierra la ventana, dice que sigue afuera y no deja nada guardado.
    (panel?.firstElementChild as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(50);
    expect(ventanaDeSumar()).toBeNull();
    expect(document.querySelector(".cq-demo-nota")?.textContent).toContain(t("compraEstoy"));
    expect(localStorage.length).toBe(0);
  });
});

describe("dónde se puede ver la demo", () => {
  it("fuera de la máquina de quien prueba, o sin la bandera, no pone nada", () => {
    expect(montarDemoDeCompra({ entorno: { host: "tinkazo.app", rampaDemo: "1" } })).toBe(false);
    expect(montarDemoDeCompra({ entorno: { host: "localhost" } })).toBe(false);
    expect(document.querySelector(".cq-demo")).toBeNull();
    expect(card()).toBeNull();
  });

  it("en la máquina de quien prueba, la lista de compras de mentira, y nada se abre hasta que se toca una", () => {
    expect(montarDemoDeCompra({ entorno: LOCAL })).toBe(true);
    const botones = [...document.querySelectorAll<HTMLElement>(".cq-demo [data-escenario]")].map((b) => b.dataset.escenario);
    expect(botones).toEqual([...ESCENARIOS]);
    expect(card()).toBeNull();
    expect(montarDemoDeCompra({ entorno: LOCAL })).toBe(true);
    expect(document.querySelectorAll(".cq-demo")).toHaveLength(1);
  });

  it("la demo no deja nada guardado en el navegador: ni el medio elegido ni las marcas de las órdenes", async () => {
    abrirEscenario("sin-qr");
    await tocar(enlaceDelPie());
    abrirEscenario("feliz");
    await recorrer("qr");
    await tocar(principal());
    expect(localStorage.length).toBe(0);
  });
});

describe("los recorridos de la demo", () => {
  it("la primera compra en Bolivia, de punta a punta, tocando lo que tocaría una persona, sin abrir ninguna pestaña", async () => {
    const abrirPestana = vi.spyOn(window, "open").mockImplementation(() => null);
    abrirEscenario("feliz");
    const vistas = await recorrer("listo");
    expect(abrirPestana).not.toHaveBeenCalled();
    abrirPestana.mockRestore();
    expect(enOrden(vistas, ["espera", "verificar", "carnet", "carnet-espera", "datos", "segip", "alta", "preparar", "precio", "qr", "espera-pago", "camino", "antes", "aprobar", "llego", "pagando", "listo"]), vistas.join(" > ")).toBe(true);
    expect(card()?.querySelector(".cq-titulo")?.textContent).toBe(t("compraListoTitulo"));
    expect(card()?.querySelector(".llg")?.getAttribute("data-pose")).toBe("festeja");
    await tocar(principal());
    expect(card()).toBeNull();
  });

  it("las cuatro aprobaciones, una por toque y con su número", async () => {
    abrirEscenario("feliz");
    await recorrer("aprobar");
    const titulos: string[] = [];
    for (let i = 0; i < 40 && titulos.length < 4; i++) {
      if (pantalla() === "aprobar") {
        const titulo = card()?.querySelector(".cq-titulo")?.textContent ?? "";
        if (titulos[titulos.length - 1] !== titulo) titulos.push(titulo);
        await tocar(principal());
      } else await pasar(1_000);
    }
    expect(titulos).toEqual([1, 2, 3, 4].map((n) => `Confirmación ${n} de 4`));
  });

  it("Ya pagué por error: Todavía no pagué vuelve al mismo QR con el aviso, y la compra sigue cuando de verdad paga", async () => {
    abrirEscenario("ya-pague-por-error");
    await recorrer("qr");
    const qr = card()?.querySelector<HTMLImageElement>("img.cq-qr")?.getAttribute("src");
    await tocar(principal());
    expect(pantalla()).toBe("espera-pago");
    await pasar(5_000);
    expect(pantalla()).toBe("espera-pago");
    expect(enlaceDelPie().textContent).toBe(t("compraTodaviaNo"));
    await tocar(enlaceDelPie());
    expect(pantalla()).toBe("qr");
    expect(card()?.querySelector<HTMLImageElement>("img.cq-qr")?.getAttribute("src")).toBe(qr);
    expect(card()?.querySelector(".llg-globo")?.textContent).toBe(t("compraTodaviaNoLinea"));
    const vistas = await recorrer("listo");
    expect(enOrden(vistas, ["qr", "espera-pago", "camino", "aprobar", "llego", "pagando", "listo"]), vistas.join(" > ")).toBe(true);
  });

  const PRIMERA: Array<[Escenario, string]> = [
    ["sin-qr", "sin-qr"],
    ["revision", "revision"],
    ["qr-vencido", "qr-vencido-abierta"],
    ["frenada", "frenada"],
    ["fallo", "fallo"],
    ["saldo", "saldo"],
    ["app", "app"],
  ];
  it.each(PRIMERA)("%s abre en su pantalla", async (escenario, id) => {
    abrirEscenario(escenario);
    await pasar(2_000);
    expect(pantalla()).toBe(id);
  });

  it("el QR vencido con la compra abierta no da otro QR hasta que se cierra, y recién ahí pregunta y ofrece uno nuevo", async () => {
    abrirEscenario("qr-vencido");
    await pasar(2_000);
    expect(pantalla()).toBe("qr-vencido-abierta");
    expect(card()?.querySelector("img.cq-qr")).toBeNull();
    await tocar(principal());
    await pasar(2_000);
    expect(pantalla()).toBe("ya-pagaste");
    await tocar(enlaceDelPie());
    expect(pantalla()).toBe("qr-vencido-cerrada");
    await tocar(principal());
    await pasar(2_000);
    expect(pantalla()).toBe("qr");
  });

  it("frenada de nuestro lado: el número de compra y Escribir a Tinkazo a la vista", async () => {
    abrirEscenario("frenada");
    await pasar(2_000);
    expect(card()?.querySelector('.cq-dato[data-clave="compraDatoNumero"]')).not.toBeNull();
    expect(card()?.querySelector(".llg-globo")?.textContent).toBe(t("compraFrenadaTinkazo"));
    expect(enlaceDelPie().textContent).toBe(t("compraEscribinos"));
    expect(enlaceDelPie().getAttribute("href")).toMatch(/^mailto:hola@tinkazo\.app\?subject=Compra%20/);
  });

  it("pagar con el saldo es un botón, sin preguntar nada más", async () => {
    abrirEscenario("saldo");
    const vistas = await recorrer("listo");
    expect(vistas).toEqual(["saldo", "pagando", "listo"]);
  });

  it("pagar desde otra app: Ya pagué busca el pago y termina", async () => {
    abrirEscenario("app");
    await pasar(2_000);
    expect(card()?.querySelector('.cq-dato[data-clave="compraDatoMoneda"] dd')?.textContent).toBe("USDC en Stellar");
    const vistas = await recorrer("listo");
    expect(vistas[0]).toBe("app");
    expect(vistas[vistas.length - 1]).toBe("listo");
  });
});
