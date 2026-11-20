// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Acceso } from "../stellar/acceso-oficial";
import { SIN_OFERTA, type Oferta } from "../stellar/alta-oferta";

/**
 * «Se te acabaron los sorteos oficiales» con el regalo de quien entra con su cuenta: con el regalo disponible,
 * «Recibirlos» va primero y es la principal; sin él, la ventana de siempre. Y la compuerta del sello: al recibirlo, se
 * vuelve a mirar y se sella. El servidor, el flujo y la red son de mentira.
 */

const h = vi.hoisted(() => ({
  regalo: null as number | null,
  recibe: "dado" as "dado" | "sin-sorteos" | "error",
  recibidos: 0,
  accesos: [] as unknown[],
}));

vi.mock("./cuenta-lista-flujo", () => ({
  regaloDisponible: async () => h.regalo,
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
vi.mock("./modo-ui", () => ({ pasarAModo: vi.fn(), puedeCambiarDeModo: () => true }));
vi.mock("./red", () => ({ mostrarSinPatrocinio: vi.fn(async () => undefined) }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ kind: "external", address: "GAAA" }) }));

const { abrirSeAcabaron, accesoParaSellar } = await import("./sin-sorteos");
const { setLang, t } = await import("../i18n");

const esperar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const ventana = (): HTMLElement => document.querySelector(".sin-sorteos") as HTMLElement;
const pie = (): HTMLButtonElement[] => [...ventana().querySelectorAll<HTMLButtonElement>(".dlg-pie button")];
const principales = (): string[] => [...ventana().querySelectorAll<HTMLElement>(".dlg-main")].map((b) => b.textContent ?? "");
const textoDeLaVentana = (): string => ventana().querySelector(".dlg-cuerpo p")?.textContent ?? "";
const P10 = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
const conPaquete = async (): Promise<Oferta> => ({ alta: null, paquetes: [P10] });
const sinNada = async (): Promise<Oferta> => SIN_OFERTA;
const cerrarLaVentana = (): void => (ventana().querySelector('[data-dlg="x"]') as HTMLButtonElement).click();

beforeEach(() => {
  setLang("es");
  document.body.innerHTML = '<main id="pagina"></main>';
  h.regalo = null;
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
    // El cupón y Pasar a Prueba siguen ahí, como secundarias.
    expect(pie().map((b) => b.dataset.accion)).toEqual(["regalo", "cupon", "prueba"]);
    cerrarLaVentana();
  });

  it("tocar «Recibirlos» devuelve el regalo y cierra la ventana", async () => {
    const eleccion = abrirSeAcabaron({ oferta: sinNada, regalo: async () => 3 });
    await esperar();
    pie()[0]?.click();
    await expect(eleccion).resolves.toBe("regalo");
    expect(document.querySelector(".sin-sorteos")).toBeNull();
  });

  it("sin el regalo, la ventana de siempre: «Usar un cupón» de principal y su texto", async () => {
    void abrirSeAcabaron({ oferta: sinNada, regalo: async () => null });
    await esperar();
    expect(principales()).toEqual([t("cupoOfUsarCupon")]);
    expect(textoDeLaVentana()).toBe(t("cupoOfCeroTextoSinVenta"));
    expect(pie().some((b) => b.dataset.accion === "regalo")).toBe(false);
    cerrarLaVentana();
  });

  it("con un paquete a la venta y el regalo, la línea sigue siendo la del regalo y comprar va de secundaria", async () => {
    void abrirSeAcabaron({ oferta: conPaquete, regalo: async () => 3 });
    await esperar();
    await esperar();
    expect(textoDeLaVentana()).toBe("Ya podés recibir tus 3 sorteos gratis.");
    expect(principales()).toEqual([t("cupoOfRecibir")]);
    expect(pie().map((b) => b.dataset.accion)).toEqual(["regalo", "cupon", "comprar", "prueba"]);
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
    expect(principales()).toEqual([t("cupoOfUsarCupon")]);
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
