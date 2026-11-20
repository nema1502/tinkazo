// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Oferta } from "../stellar/alta-oferta";

/**
 * La ventana «Se te acabaron los sorteos oficiales», caso por caso: sin venta, con venta y quien nunca tuvo sorteos
 * oficiales. Un título, una línea y una sola acción principal; «Sortear en Prueba» pasa a Prueba con la cuenta de prueba
 * y nunca va gris; el cupón queda como enlace chico. En jsdom, sin red y sin reloj.
 */

const h = vi.hoisted(() => ({
  pago: false,
  puede: true,
  practicar: vi.fn(() => true),
  /** Lo que dice la lectura del regalo de la sesión (`leerElRegalo` del flujo): sin regalo y sin saber si tuvo sorteos. */
  regalo: null as number | null,
  nunca: null as boolean | null,
  lecturas: 0,
}));

vi.mock("../stellar/alta-config", async (orig) => ({ ...(await orig<typeof import("../stellar/alta-config")>()), altaPagoActivo: () => h.pago }));
vi.mock("./modo-ui", () => ({ practicarEnPrueba: () => h.practicar(), puedeCambiarDeModo: () => h.puede }));
vi.mock("./wallet-ui", () => ({ currentSession: () => null }));
vi.mock("./red", () => ({ mostrarSinPatrocinio: vi.fn(async () => undefined) }));
vi.mock("./cuenta-lista-flujo", () => ({
  regaloDisponible: async () => h.regalo,
  leerElRegalo: async () => {
    h.lecturas++;
    return { disponible: h.regalo, nuncaTuvo: h.nunca };
  },
}));

const SIN_NADA: Oferta = { alta: null, paquetes: [] };
const CON_PAQUETE: Oferta = { alta: null, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] };

/** Carga la ventana y el diccionario de nuevo, con la compra prendida o apagada en el build. */
async function cargar(pago = false) {
  vi.resetModules();
  h.pago = pago;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  return { t: i18n.t, setLang: i18n.setLang, ventana: await import("./sin-sorteos") };
}

/** Deja correr lo que se lee al abrir: la oferta y, del flujo que se baja aparte, el regalo. */
const soltar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const dlg = (): HTMLElement => document.querySelector(".sin-sorteos") as HTMLElement;
const principales = (): HTMLButtonElement[] => [...dlg().querySelectorAll<HTMLButtonElement>(".dlg-main")];
const accion = (a: string): HTMLButtonElement | null => dlg().querySelector<HTMLButtonElement>(`[data-accion="${a}"]`);
const linea = (): string => dlg().querySelector(".dlg-cuerpo p")?.textContent ?? "";
const titulo = (): string => dlg().querySelector(".dlg-h")?.textContent ?? "";

beforeEach(() => {
  document.body.innerHTML = "";
  h.puede = true;
  h.practicar.mockClear();
  h.regalo = null;
  h.nunca = null;
  h.lecturas = 0;
});
afterEach(() => {
  document.querySelectorAll(".modal-back").forEach((e) => e.remove());
});

describe("sin venta", () => {
  it("título, la línea de que en Prueba no cuenta y Sortear en Prueba como única principal, con el cupón de enlace chico", async () => {
    const m = await cargar();
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    await soltar();
    expect(titulo()).toBe("Se te acabaron los sorteos oficiales");
    expect(linea()).toBe("En Prueba funciona igual, pero no cuenta y se borra el 16 de diciembre.");
    expect(principales().map((b) => b.textContent)).toEqual(["Sortear en Prueba"]);
    expect(principales()[0]?.dataset.accion).toBe("prueba");
    const cupon = accion("cupon");
    expect(cupon?.textContent).toBe("Tengo un cupón");
    expect(cupon?.classList.contains("dlg-main")).toBe(false);
    expect(cupon?.classList.contains("sin-sorteos-enlace")).toBe(true);
    expect(accion("comprar")).toBeNull();
  });

  it("en inglés, los textos del plan letra por letra", async () => {
    const m = await cargar();
    m.setLang("en");
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    await soltar();
    expect(titulo()).toBe("You're out of Live draws");
    expect(linea()).toBe("In Test it works the same, but it doesn't count and is wiped on December 16.");
    expect(principales().map((b) => b.textContent)).toEqual(["Run it in Test"]);
    expect(accion("cupon")?.textContent).toBe("I have a coupon");
  });

  it("Sortear en Prueba cierra la ventana y pasa a Prueba con la cuenta de prueba", async () => {
    const m = await cargar();
    const eleccion = m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    await soltar();
    accion("prueba")?.click();
    await expect(eleccion).resolves.toBe("prueba");
    expect(h.practicar).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".sin-sorteos")).toBeNull();
  });

  it("Tengo un cupón cierra la ventana y devuelve el cupón, sin pasar a Prueba", async () => {
    const m = await cargar();
    const eleccion = m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    await soltar();
    accion("cupon")?.click();
    await expect(eleccion).resolves.toBe("cupon");
    expect(h.practicar).not.toHaveBeenCalled();
  });

  it("con el cambio de modo cerrado, Sortear en Prueba no aparece (nunca gris) y el cupón pasa a ser la principal", async () => {
    h.puede = false;
    const m = await cargar();
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    await soltar();
    expect(accion("prueba")).toBeNull();
    expect(principales().map((b) => b.dataset.accion)).toEqual(["cupon"]);
    expect([...dlg().querySelectorAll("button:disabled")]).toEqual([]);
  });
});

describe("con venta", () => {
  it("la línea de sumar, Sumar sorteos como principal, Sortear en Prueba a la vista y el cupón de enlace chico", async () => {
    const m = await cargar(true);
    void m.ventana.abrirSeAcabaron({ oferta: async () => CON_PAQUETE });
    await soltar();
    expect(titulo()).toBe("Se te acabaron los sorteos oficiales");
    expect(linea()).toBe("Sumá más para que este cuente. En Prueba no cuenta.");
    expect(principales().map((b) => [b.dataset.accion, b.textContent])).toEqual([["comprar", "Sumar sorteos"]]);
    const prueba = accion("prueba");
    expect(prueba?.textContent).toBe("Sortear en Prueba");
    expect(prueba?.classList.contains("dlg-main")).toBe(false);
    expect(accion("cupon")?.classList.contains("sin-sorteos-enlace")).toBe(true);
    // El orden del pie: la principal, la segunda y el enlace chico.
    expect([...dlg().querySelectorAll<HTMLElement>(".dlg-pie > button")].map((b) => b.dataset.accion)).toEqual(["comprar", "prueba", "cupon"]);
  });

  it("en inglés, la línea del plan letra por letra", async () => {
    const m = await cargar(true);
    m.setLang("en");
    void m.ventana.abrirSeAcabaron({ oferta: async () => CON_PAQUETE });
    await soltar();
    expect(linea()).toBe("Add more so this one counts. In Test it doesn't count.");
    expect(principales().map((b) => b.textContent)).toEqual(["Add draws"]);
    expect(accion("prueba")?.textContent).toBe("Run it in Test");
  });

  it("Sumar sorteos devuelve la compra y no pasa a Prueba", async () => {
    const m = await cargar(true);
    const eleccion = m.ventana.abrirSeAcabaron({ oferta: async () => CON_PAQUETE });
    await soltar();
    accion("comprar")?.click();
    await expect(eleccion).resolves.toBe("comprar");
    expect(h.practicar).not.toHaveBeenCalled();
  });

  it("si la oferta llega con la ventana ya cerrada, no se pinta nada", async () => {
    const m = await cargar(true);
    let dar: (o: Oferta) => void = () => undefined;
    const eleccion = m.ventana.abrirSeAcabaron({ oferta: () => new Promise<Oferta>((r) => (dar = r)) });
    (dlg().querySelector('[data-dlg="x"]') as HTMLButtonElement).click();
    await expect(eleccion).resolves.toBe("cerrar");
    dar(CON_PAQUETE);
    await soltar();
    expect(document.querySelector('[data-accion="comprar"]')).toBeNull();
  });
});

describe("quien nunca tuvo sorteos oficiales", () => {
  it("si no se sabe, el título es el de siempre", async () => {
    const m = await cargar();
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    // Se preguntó y no se sabe: el título queda.
    await vi.waitFor(() => expect(h.lecturas).toBeGreaterThan(0));
    await soltar();
    expect(titulo()).toBe("Se te acabaron los sorteos oficiales");
  });

  it("si la lectura del regalo dice que nunca tuvo y no hay regalo, el título lo dice y la línea que hoy ya se entregaron", async () => {
    h.nunca = true;
    const m = await cargar();
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    // El título sale del flujo, que se baja aparte: puede tardar más de una vuelta.
    await vi.waitFor(() => expect(titulo()).toBe("Todavía no tenés sorteos oficiales"));
    // Nunca tuvo y sin regalo a mano es que hoy ya se entregaron: la misma línea del final del paso de la cuenta, y no
    // la de Prueba, que no le dice que los va a recibir. Los botones, los del caso sin venta.
    expect(linea()).toBe("Hoy ya se entregaron los sorteos gratis. Podés recibirlos más tarde.");
    expect(principales().map((b) => b.textContent)).toEqual(["Sortear en Prueba"]);
    expect(accion("cupon")?.classList.contains("sin-sorteos-enlace")).toBe(true);
  });

  it("lo mismo en inglés", async () => {
    h.nunca = true;
    const m = await cargar();
    m.setLang("en");
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA });
    await vi.waitFor(() => expect(titulo()).toBe("You don't have Live draws yet"));
    expect(linea()).toBe("Today's free draws are all given out. You can get them later.");
    expect(principales().map((b) => b.textContent)).toEqual(["Run it in Test"]);
  });

  it("y con venta, la línea y los botones del caso con venta", async () => {
    const m = await cargar(true);
    m.setLang("en");
    void m.ventana.abrirSeAcabaron({ oferta: async () => CON_PAQUETE, nuncaTuvo: async () => true });
    await soltar();
    expect(titulo()).toBe("You don't have Live draws yet");
    expect(linea()).toBe("Add more so this one counts. In Test it doesn't count.");
    expect(principales().map((b) => b.textContent)).toEqual(["Add draws"]);
  });

  it("si se sabe que sí tuvo, el título de siempre", async () => {
    const m = await cargar();
    void m.ventana.abrirSeAcabaron({ oferta: async () => SIN_NADA, nuncaTuvo: async () => false });
    await soltar();
    expect(titulo()).toBe("Se te acabaron los sorteos oficiales");
  });
});
