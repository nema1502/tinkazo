// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Al retomar en el mismo navegador una campaña ya pasada, el panel le da a la herramienta las filas que recibió para que
 * reponga los nombres que la pestaña perdió. Se las da una sola vez, con la lista entera y la lista pasada al cuadro, y nunca
 * antes de tener todas las filas ni cuando la sala ya no las lee.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { lineaDePrueba } from "../campana/cuentas-de-prueba";
import { reiniciarElPuente } from "../campana/puente";
import { guardarOrg } from "../sala/campana-org";
import type { EquipoDeSala } from "../sala/cliente";
import { SALA, type Mundo, cerrarTodos, equipoDe, mundo, nuevoPanel, vistaDe } from "./campana-sala-mundo";
import type { FilaParaReponer } from "./campana-pasar";

beforeEach(() => {
  document.body.innerHTML = "";
  reiniciarElPuente();
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

/** Una anotada de una campaña de personas: la línea en lugar de la cuenta. */
const dePersona = async (m: Mundo, n: number, nombre: string): Promise<EquipoDeSala> => ({
  ...(await equipoDe(m, n, nombre)),
  cuenta: lineaDePrueba(n),
});

/** Anota lo que el panel le da a la herramienta para reponer. */
function espiar(m: Mundo): FilaParaReponer[][] {
  const llamadas: FilaParaReponer[][] = [];
  m.deps.reponerEtiquetas = (_s, filas) => void llamadas.push(filas.map((f) => ({ ...f })));
  return llamadas;
}

describe("el panel repone los nombres al retomar", () => {
  it("con la lista pasada y todas las filas recibidas, se las da a la herramienta una sola vez", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    m.deps.listaPasada = () => true;
    guardarOrg(m.almacen, { sala: SALA, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await dePersona(m, 1, "Ana"), await dePersona(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.map((f) => [f.n, f.cuenta, f.nombre, f.revisar]).sort()).toEqual(
      [
        [1, lineaDePrueba(1), "Ana", false],
        [2, lineaDePrueba(2), "Nora", false],
      ].sort(),
    );
    // Una fila más que llega después no la repite: ya se repuso.
    m.escucha().alEquipo?.(await dePersona(m, 3, "Beto"));
    await vi.waitFor(() => expect(document.querySelectorAll("#cpo-ul > li")).toHaveLength(3));
    expect(llamadas).toHaveLength(1);
  });

  it("con la lista sin pasar al cuadro no repone nada", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    m.deps.listaPasada = () => false;
    guardarOrg(m.almacen, { sala: SALA, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await dePersona(m, 1, "Ana"), await dePersona(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    await vi.waitFor(() => expect(document.querySelectorAll("#cpo-ul > li")).toHaveLength(2));
    expect(llamadas).toHaveLength(0);
  });

  it("si faltan filas por llegar, espera a tenerlas todas", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    m.deps.listaPasada = () => true;
    guardarOrg(m.almacen, { sala: SALA, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.sala.enSala.add(3);
    m.paginas.push([await dePersona(m, 1, "Ana"), await dePersona(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    await vi.waitFor(() => expect(document.querySelectorAll("#cpo-ul > li")).toHaveLength(2));
    expect(llamadas).toHaveLength(0);
    m.escucha().alEquipo?.(await dePersona(m, 3, "Beto"));
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]).toHaveLength(3);
  });

  it.each(["sellada", "sorteada"] as const)("con la sala en %s no lee filas y no repone", async (fase) => {
    const m = mundo();
    const llamadas = espiar(m);
    m.deps.listaPasada = () => true;
    guardarOrg(m.almacen, { sala: SALA, fase });
    m.sala.fase = fase;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe(fase));
    expect(llamadas).toHaveLength(0);
  });

  it("sin esa dependencia el panel anda igual que antes", async () => {
    const m = mundo();
    m.deps.listaPasada = () => true;
    guardarOrg(m.almacen, { sala: SALA, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await dePersona(m, 1, "Ana"), await dePersona(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    await vi.waitFor(() => expect(document.querySelectorAll("#cpo-ul > li")).toHaveLength(2));
  });
});
