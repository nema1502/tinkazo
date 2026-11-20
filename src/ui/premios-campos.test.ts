// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Los campos de premio por lugar en la página: lo que no entra en lo que se sella se ve al escribir, debajo de los
 * campos, y deja de verse al acortar. Con la página de mentira y sin red.
 */

function armarPagina(ganadores: number): void {
  document.body.innerHTML =
    `<details id="mas-opciones"><summary>Premio</summary><div id="prize-chips"></div>` +
    `<div class="premio-fila"><span id="prize-n1" hidden></span><input id="prize" maxlength="60"></div>` +
    `<div id="prize-lugares" hidden></div><p id="prize-largo" role="status" hidden></p></details>` +
    `<input id="nw" type="number" value="${ganadores}">`;
}

const linea = (): HTMLElement => document.getElementById("prize-largo") as HTMLElement;
const lugar = (n: number): HTMLInputElement =>
  (n === 1 ? document.getElementById("prize") : document.querySelector(`#prize-lugares input[data-lugar="${n}"]`)) as HTMLInputElement;

/** Escribe en un campo como lo hace el teclado: el valor y el `input` que sube hasta la caja. */
function escribir(n: number, texto: string): void {
  const campo = lugar(n);
  campo.value = texto;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("un texto armado vuelve a sus campos", () => {
  it("si el 1.º quedó vacío, el 2.º vuelve a su campo y no al cuadro del 1.er premio", async () => {
    armarPagina(3);
    const { montarPremios, ponerPremio, premioActual } = await import("./premios");
    montarPremios();
    ponerPremio("2.º premio: Termo, 3.er premio: Libro");
    expect(lugar(1).value).toBe("");
    expect(lugar(2).value).toBe("Termo");
    expect(lugar(3).value).toBe("Libro");
    // Al volver a armarlo, cada premio conserva su lugar.
    expect(premioActual()).toBe("2.º premio: Termo, 3.er premio: Libro");
  });

  it("con un lugar vacío en medio, hay campo hasta el lugar más alto aunque ahora gane uno solo", async () => {
    armarPagina(1);
    const { montarPremios, ponerPremio } = await import("./premios");
    montarPremios();
    ponerPremio("1.er premio: Bici, 3.er premio: Libro");
    expect(lugar(1).value).toBe("Bici");
    expect(lugar(2).value).toBe("");
    expect(lugar(3).value).toBe("Libro");
  });
});

describe("cada campo dice de qué lugar es", () => {
  /** El rótulo a la vista de cada lugar, del 1.º en adelante. */
  const rotulos = (): string[] => {
    const primero = document.getElementById("prize-n1") as HTMLElement;
    const resto = [...document.querySelectorAll("#prize-lugares .premio-fila .premio-lugar-n")].map((e) => e.textContent ?? "");
    return [primero.hidden ? "" : (primero.textContent ?? ""), ...resto];
  };

  it("con tres ganadores y premio en otro lugar, cada campo lleva su rótulo, también el primero", async () => {
    armarPagina(3);
    const { montarPremios } = await import("./premios");
    montarPremios();
    escribir(2, "Termo");
    expect(rotulos()).toEqual(["1.er premio", "2.º premio", "3.er premio"]);
    expect(lugar(1).getAttribute("aria-label")).toBe("1.er premio");
  });

  it("con tres ganadores y solo el cuadro de arriba escrito, ese no dice 1.er premio: se lo llevan todos", async () => {
    armarPagina(3);
    const { montarPremios } = await import("./premios");
    montarPremios();
    escribir(1, "Bici");
    expect(rotulos()).toEqual(["", "2.º premio", "3.er premio"]);
    expect(lugar(1).hasAttribute("aria-label")).toBe(false);
  });

  it("al borrar el premio del otro lugar, el cuadro de arriba vuelve a ser el de todos", async () => {
    armarPagina(3);
    const { montarPremios } = await import("./premios");
    montarPremios();
    escribir(1, "Bici");
    escribir(3, "Libro");
    expect(rotulos()[0]).toBe("1.er premio");
    escribir(3, "  ");
    expect(rotulos()[0]).toBe("");
  });

  it("un texto por lugares que vuelve a sus campos rotula el primero", async () => {
    armarPagina(3);
    const { montarPremios, ponerPremio } = await import("./premios");
    montarPremios();
    ponerPremio("1.er premio: Bici, 2.º premio: Termo");
    expect(rotulos()[0]).toBe("1.er premio");
  });

  it("el rótulo sigue a la vista después de escribir", async () => {
    armarPagina(3);
    const { montarPremios } = await import("./premios");
    montarPremios();
    escribir(1, "Bici");
    escribir(2, "Termo");
    expect(rotulos()).toEqual(["1.er premio", "2.º premio", "3.er premio"]);
    escribir(1, "Bicicleta");
    expect(rotulos()).toEqual(["1.er premio", "2.º premio", "3.er premio"]);
  });

  it("cada lugar va en su propio renglón con su rótulo al lado del campo", async () => {
    armarPagina(3);
    const { montarPremios } = await import("./premios");
    montarPremios();
    const fila = lugar(2).parentElement as HTMLElement;
    expect(fila.className).toBe("premio-fila");
    expect(fila.firstElementChild?.textContent).toBe("2.º premio");
  });

  it("con un solo ganador, el cuadro queda como siempre, sin rótulo ni nombre de lugar", async () => {
    armarPagina(1);
    const { montarPremios } = await import("./premios");
    montarPremios();
    expect((document.getElementById("prize-n1") as HTMLElement).hidden).toBe(true);
    expect(lugar(1).hasAttribute("aria-label")).toBe(false);
  });

  it("al volver de tres ganadores a uno, el rótulo del primero se va", async () => {
    armarPagina(3);
    const { montarPremios } = await import("./premios");
    montarPremios();
    escribir(2, "Termo");
    expect(rotulos()[0]).toBe("1.er premio");
    const nw = document.getElementById("nw") as HTMLInputElement;
    nw.value = "1";
    nw.dispatchEvent(new Event("change"));
    expect((document.getElementById("prize-n1") as HTMLElement).hidden).toBe(true);
    expect(lugar(1).hasAttribute("aria-label")).toBe(false);
  });
});

describe("vaciar los lugares", () => {
  it("borra los premios del 2.º lugar en adelante y deja el del 1.er premio", async () => {
    armarPagina(3);
    const { montarPremios, premioActual, vaciarLugares } = await import("./premios");
    montarPremios();
    escribir(1, "Bici");
    escribir(2, "Termo");
    escribir(3, "Libro");
    vaciarLugares();
    expect([lugar(1).value, lugar(2).value, lugar(3).value]).toEqual(["Bici", "", ""]);
    expect(premioActual()).toBe("Bici");
  });
});

describe("el aviso de que los premios no entran", () => {
  it("aparece al escribir el premio que ya no entra y se va al acortarlo", async () => {
    armarPagina(5);
    const { montarPremios } = await import("./premios");
    montarPremios();
    for (const n of [1, 2, 3, 4]) escribir(n, "Auriculares Bluetooth");
    expect(linea().hidden).toBe(true);
    escribir(5, "Auriculares Bluetooth");
    expect(linea().hidden).toBe(false);
    expect(linea().textContent).toBe(T.es.prizeNoEntran(true));
    // En el sello las marcas de 2.º, 4.º y 5.º pesan doble: con el 1.º más corto todavía no entra.
    escribir(1, "Bici");
    expect(linea().hidden).toBe(false);
    escribir(5, "Termo");
    expect(linea().hidden).toBe(true);
  });

  it("el campo que no entra queda marcado, y deja de estarlo al acortarlo", async () => {
    armarPagina(5);
    const { montarPremios } = await import("./premios");
    montarPremios();
    for (const n of [1, 2, 3, 4, 5]) escribir(n, "Auriculares Bluetooth");
    const marcados = (): number[] => [1, 2, 3, 4, 5].filter((n) => lugar(n).getAttribute("aria-invalid") === "true");
    expect(marcados()).toEqual([5]);
    escribir(1, "Bici");
    escribir(5, "Termo");
    expect(marcados()).toEqual([]);
  });

  it("al tocar Sellar con premios que no entran, abre el pliegue y deja el cursor en el lugar que no entra", async () => {
    armarPagina(3);
    const { montarPremios, mostrarQueNoEntran, premiosNoEntran } = await import("./premios");
    montarPremios();
    const pliegue = document.getElementById("mas-opciones") as HTMLDetailsElement;
    pliegue.open = false;
    const premio = "Auriculares inalámbricos con micrófono";
    for (const n of [1, 2, 3]) escribir(n, premio);
    expect(premiosNoEntran()).toBe(true);
    mostrarQueNoEntran();
    expect(pliegue.open).toBe(true);
    expect(document.activeElement).toBe(lugar(3));
  });

  it("al tocar Sellar, se encuadra la línea del aviso y el cursor va al campo sin mover la página", async () => {
    armarPagina(3);
    const { montarPremios, mostrarQueNoEntran } = await import("./premios");
    montarPremios();
    const premio = "Auriculares inalámbricos con micrófono";
    for (const n of [1, 2, 3]) escribir(n, premio);
    // jsdom no trae scrollIntoView: se anota a quién se encuadra y cómo.
    const encuadrados: { id: string; op: unknown }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, op?: boolean | ScrollIntoViewOptions): void {
      encuadrados.push({ id: this.id, op });
    };
    const foco = vi.spyOn(lugar(3), "focus");
    try {
      mostrarQueNoEntran();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    expect(foco).toHaveBeenCalledWith({ preventScroll: true });
    expect(encuadrados).toEqual([{ id: "prize-largo", op: { block: "center" } }]);
  });
});
