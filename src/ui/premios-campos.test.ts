// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Los campos de premio por lugar en la página: lo que no entra en lo que se sella se ve al escribir, debajo de los
 * campos, y deja de verse al acortar. Con la página de mentira y sin red.
 */

function armarPagina(ganadores: number): void {
  document.body.innerHTML =
    `<details id="mas-opciones"><summary>Premio</summary><div id="prize-chips"></div><input id="prize" maxlength="60">` +
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
});
