// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Acceso } from "../stellar/acceso-oficial";
import { SIN_OFERTA, type Oferta } from "../stellar/alta-oferta";

/**
 * «Se te acabaron los sorteos oficiales» con el regalo de quien entra con su cuenta: con el regalo disponible,
 * «Recibirlos» va primero y es la principal, con «Sortear en Prueba» a la vista y el cupón de enlace chico; sin él, la
 * tabla de siempre (Sortear en Prueba, o Sumar sorteos con la venta). Quien nunca tuvo sorteos ve el título que lo dice.
 * Y la compuerta del sello: al recibirlo, se vuelve a mirar y se sella. El servidor, el flujo y la red son de mentira.
 */

const h = vi.hoisted(() => ({
  regalo: null as number | null,
  /** Lo que dice la misma lectura de si la cuenta nunca tuvo sorteos oficiales. */
  nunca: null as boolean | null,
  recibe: "dado" as "dado" | "sin-sorteos" | "error",
  recibidos: 0,
  accesos: [] as unknown[],
}));

vi.mock("./cuenta-lista-flujo", () => ({
  regaloDisponible: async () => h.regalo,
  leerElRegalo: async () => ({ disponible: h.regalo, nuncaTuvo: h.nunca }),
  // Como el flujo: si el servidor contestó, el regalo no se vuelve a ofrecer; si no se supo, sigue disponible.
  recibirRegalo: async () => {
    h.recibidos++;
    if (h.recibe !== "error") h.regalo = null;
    return h.recibe;
  },
  abrirSumarSorteos: async () => false,
  abrirParaElError: async () => false,
}));
vi.mock("../stellar/acceso-oficial", () => ({ consultarAcceso: async () => h.accesos.shift() }));
vi.mock("./modo-ui", () => ({ practicarEnPrueba: vi.fn(), puedeCambiarDeModo: () => true }));
vi.mock("./red", () => ({ mostrarSinPatrocinio: vi.fn(async () => undefined) }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ kind: "external", address: "GAAA" }) }));

const { abrirSeAcabaron, accesoParaSellar, TOPE_DE_LECTURA_MS } = await import("./sin-sorteos");
const { setLang, t } = await import("../i18n");

const esperar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const ventana = (): HTMLElement => document.querySelector(".sin-sorteos") as HTMLElement;
const pie = (): HTMLButtonElement[] => [...ventana().querySelectorAll<HTMLButtonElement>(".dlg-pie button")];
const principales = (): string[] => [...ventana().querySelectorAll<HTMLElement>(".dlg-main")].map((b) => b.textContent ?? "");
const textoDeLaVentana = (): string => ventana().querySelector(".dlg-cuerpo p")?.textContent ?? "";
const titulo = (): string => ventana().querySelector(".dlg-h")?.textContent ?? "";
const P10 = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
const conPaquete = async (): Promise<Oferta> => ({ alta: null, paquetes: [P10] });
const sinNada = async (): Promise<Oferta> => SIN_OFERTA;
const cerrarLaVentana = (): void => (ventana().querySelector('[data-dlg="x"]') as HTMLButtonElement).click();

beforeEach(() => {
  setLang("es");
  document.body.innerHTML = '<main id="pagina"></main>';
  h.regalo = null;
  h.nunca = null;
  h.recibe = "dado";
  h.recibidos = 0;
  h.accesos = [];
});

describe("«Se te acabaron» con el regalo", () => {
  it("disponible: «Recibirlos» va primero y es la única principal, con la línea que lo dice", async () => {
    void abrirSeAcabaron({ oferta: sinNada, regalo: async () => 3 });
    await esperar();
    expect(pie()[0]?.textContent).toBe(t("cupoOfRecibir"));
    expect(pie()[0]?.dataset.accion).toBe("regalo");
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    expect(textoDeLaVentana()).toBe("Ya podés recibir tus 3 sorteos gratis.");
    // Sortear en Prueba sigue a la vista como segunda, y el cupón como enlace chico.
    expect(pie().map((b) => b.dataset.accion)).toEqual(["regalo", "prueba", "cupon"]);
    expect(pie()[1]?.textContent).toBe(t("pagoSortearEnPrueba"));
    expect(pie()[2]?.classList.contains("sin-sorteos-enlace")).toBe(true);
    expect(titulo()).toBe(t("cupoOfCeroTitulo"));
    cerrarLaVentana();
  });

  it("tocar «Recibirlos» devuelve el regalo y cierra la ventana", async () => {
    const eleccion = abrirSeAcabaron({ oferta: sinNada, regalo: async () => 3 });
    await esperar();
    pie()[0]?.click();
    await expect(eleccion).resolves.toBe("regalo");
    expect(document.querySelector(".sin-sorteos")).toBeNull();
  });

  it("sin el regalo, la tabla de siempre: «Sortear en Prueba» de principal y su texto", async () => {
    void abrirSeAcabaron({ oferta: sinNada, regalo: async () => null });
    await esperar();
    expect(principales()).toEqual([t("pagoSortearEnPrueba")]);
    expect(textoDeLaVentana()).toBe(t("cupoOfCeroTextoSinVenta"));
    expect(pie().some((b) => b.dataset.accion === "regalo")).toBe(false);
    cerrarLaVentana();
  });

  it("con un paquete a la venta y el regalo, la línea y la principal son del regalo, y Sumar sorteos no va", async () => {
    void abrirSeAcabaron({ oferta: conPaquete, regalo: async () => 3 });
    await esperar();
    await esperar();
    expect(textoDeLaVentana()).toBe("Ya podés recibir tus 3 sorteos gratis.");
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    expect(pie().map((b) => b.dataset.accion)).toEqual(["regalo", "prueba", "cupon"]);
    cerrarLaVentana();
  });

  it("si el regalo llega después de lo que se vende, la ventana lo espera: nunca muestra otra principal antes", async () => {
    let soltar: (n: number) => void = () => undefined;
    void abrirSeAcabaron({ oferta: conPaquete, regalo: () => new Promise<number>((r) => (soltar = r)) });
    await esperar();
    // Antes la ventana pintaba Sumar sorteos y la cambiaba por Recibirlos al llegar el regalo: el botón saltaba bajo el
    // dedo. Ahora, mientras falta el regalo, solo la línea de espera y nada que se pueda tocar.
    expect(pie()).toEqual([]);
    expect(ventana().querySelector(".dlg-pie .dlg-estado")?.textContent).toBe(t("clRevisando"));
    soltar(3);
    await esperar();
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    expect(pie().map((b) => b.dataset.accion)).toEqual(["regalo", "prueba", "cupon"]);
    expect(ventana().querySelector(".dlg-estado")).toBeNull();
    cerrarLaVentana();
  });

  it("si el regalo no llega antes del tope, la ventana de siempre; y si llega después, no cambia la principal", async () => {
    vi.useFakeTimers();
    try {
      let soltar: (n: number) => void = () => undefined;
      void abrirSeAcabaron({ oferta: sinNada, nuncaTuvo: async () => null, regalo: () => new Promise<number>((r) => (soltar = r)) });
      await vi.advanceTimersByTimeAsync(TOPE_DE_LECTURA_MS - 100);
      expect(pie()).toEqual([]);
      await vi.advanceTimersByTimeAsync(100);
      expect(principales()).toEqual([t("pagoSortearEnPrueba")]);
      expect(textoDeLaVentana()).toBe(t("cupoOfCeroTextoSinVenta"));
      // Llega tarde: Sortear en Prueba sigue de principal, y Recibirlos se suma como segunda con su propia línea.
      soltar(3);
      await vi.advanceTimersByTimeAsync(0);
      expect(principales()).toEqual([t("pagoSortearEnPrueba")]);
      expect(pie().map((b) => b.dataset.accion)).toEqual(["prueba", "regalo", "cupon"]);
      expect(pie()[1]?.classList.contains("mini")).toBe(true);
      expect(textoDeLaVentana()).toBe("Ya podés recibir tus 3 sorteos gratis.");
      cerrarLaVentana();
    } finally {
      vi.useRealTimers();
    }
  });

  it("quien nunca tuvo sorteos oficiales y tiene el regalo: el título lo dice y «Recibirlos» es la principal", async () => {
    h.regalo = 3;
    h.nunca = true;
    void abrirSeAcabaron({ oferta: sinNada });
    // El regalo y el título salen del flujo, que se baja aparte: puede tardar más de una vuelta.
    await vi.waitFor(() => expect(titulo()).toBe("Todavía no tenés sorteos oficiales"));
    await vi.waitFor(() => expect(principales()).toEqual([t("cupoOfRecibir")]));
    expect(textoDeLaVentana()).toBe("Ya podés recibir tus 3 sorteos gratis.");
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    cerrarLaVentana();
  });

  it("en inglés", async () => {
    h.regalo = 3;
    h.nunca = true;
    setLang("en");
    void abrirSeAcabaron({ oferta: sinNada });
    await vi.waitFor(() => expect(titulo()).toBe("You don't have Live draws yet"));
    await vi.waitFor(() => expect(principales()).toEqual(["Get them"]));
    expect(textoDeLaVentana()).toBe("Your 3 free Live draws are ready.");
    expect(principales()).toEqual(["Get them"]);
    expect(pie()[1]?.textContent).toBe("Run it in Test");
    cerrarLaVentana();
  });

  it("si el regalo contesta después de cerrar la ventana, no se pinta nada", async () => {
    let soltar: (n: number) => void = () => undefined;
    const eleccion = abrirSeAcabaron({ oferta: sinNada, regalo: () => new Promise<number>((r) => (soltar = r)) });
    cerrarLaVentana();
    await expect(eleccion).resolves.toBe("cerrar");
    soltar(3);
    await esperar();
    expect(document.querySelector(".sin-sorteos")).toBeNull();
  });
});

describe("la compuerta del sello con el regalo", () => {
  const sinSorteos: Acceso = { que: "sin-sorteos", quedan: 0, hacenFalta: 1 };

  it("al recibir el regalo se vuelve a mirar y, con sorteos, se sella", async () => {
    h.regalo = 3;
    h.accesos = [sinSorteos, { que: "sigue" }];
    const sigue = accesoParaSellar(1);
    await esperar();
    await esperar();
    pie()[0]?.click();
    await expect(sigue).resolves.toBe(true);
    expect(h.recibidos).toBe(1);
  });

  it("si no se supo cómo salió, la ventana vuelve con lo que pasó y «Recibirlos» para probar de nuevo", async () => {
    h.regalo = 3;
    h.recibe = "error";
    h.accesos = [sinSorteos, { que: "sigue" }];
    const sigue = accesoParaSellar(1);
    await esperar();
    await esperar();
    pie()[0]?.click();
    await esperar();
    await esperar();
    expect(textoDeLaVentana()).toBe(t("cupoOfRegaloError"));
    expect(ventana().querySelector('[role="alert"]')?.textContent).toBe(t("cupoOfRegaloError"));
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    cerrarLaVentana();
    await expect(sigue).resolves.toBe(false);
    expect(h.recibidos).toBe(1);
  });

  it("probar de nuevo desde el aviso y que llegue: se vuelve a mirar y se sella", async () => {
    h.regalo = 3;
    h.recibe = "error";
    h.accesos = [sinSorteos, { que: "sigue" }];
    const sigue = accesoParaSellar(1);
    await esperar();
    await esperar();
    pie()[0]?.click();
    await esperar();
    await esperar();
    h.recibe = "dado";
    pie()[0]?.click();
    await expect(sigue).resolves.toBe(true);
    expect(h.recibidos).toBe(2);
  });

  it("si el servidor contestó sin sorteos, la ventana vuelve diciendo que hoy ya se entregaron, sin «Recibirlos»", async () => {
    h.regalo = 3;
    h.recibe = "sin-sorteos";
    h.accesos = [sinSorteos, { que: "sigue" }];
    const sigue = accesoParaSellar(1);
    await esperar();
    await esperar();
    pie()[0]?.click();
    await esperar();
    await esperar();
    expect(textoDeLaVentana()).toBe(t("altaBienvenidaLlena"));
    expect(principales()).toEqual([t("pagoSortearEnPrueba")]);
    expect(pie().some((b) => b.dataset.accion === "regalo")).toBe(false);
    cerrarLaVentana();
    await expect(sigue).resolves.toBe(false);
    expect(h.recibidos).toBe(1);
  });
});

describe("el aviso en «Se te acabaron»", () => {
  it("con aviso, su texto queda aunque llegue el regalo o haya un paquete a la venta", async () => {
    void abrirSeAcabaron({ oferta: conPaquete, regalo: async () => 3, aviso: "cupoOfRegaloError" });
    await esperar();
    await esperar();
    expect(textoDeLaVentana()).toBe(t("cupoOfRegaloError"));
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    cerrarLaVentana();
  });

  it("sin aviso, la línea no es un aviso", async () => {
    void abrirSeAcabaron({ oferta: sinNada, regalo: async () => null });
    await esperar();
    expect(ventana().querySelector('[role="alert"]')).toBeNull();
    cerrarLaVentana();
  });
});
