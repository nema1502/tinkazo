// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El cobro de Tinkazo y el premio en mano: con el cobro prendido (así está producción), una campaña de personas con el
 * premio escrito abre la inscripción sin ninguna pantalla de cobro ni de comisión, y no se mira ni la red ni el saldo. Una
 * campaña de cuentas, con el mismo cobro, sigue pidiendo el pago como siempre.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CENTAVO } from "../campana/comision";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import type { ConfigDeComision } from "../stellar/comision-config";
import type { DepsDeComision } from "./campana-comision";
import {
  type Mundo,
  type Panel,
  archivoDe,
  boton,
  botones,
  cerrarTodos,
  elegirArchivo,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
} from "./campana-sala-mundo";

const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const CONFIG: ConfigDeComision = { pb: 200n, minimo: d(1.5), cuenta: cuentaDePrueba(2), costo: d(0.5), cobros: cuentaDePrueba(1) };

/** Un cobro prendido cuyas llamadas a la red se anotan: en una campaña en mano no tiene que haber ninguna. */
function conCobro(m: Mundo): { llamadas: string[] } {
  const llamadas: string[] = [];
  const anota =
    <T>(nombre: string, valor: T) =>
    async (): Promise<T> => {
      llamadas.push(nombre);
      return valor;
    };
  const deps: DepsDeComision = {
    comision: () => CONFIG,
    billetera: anota("billetera", "google" as const),
    mirarRed: anota("red", { tipo: "no-pagada", suma: 0n } as const),
    saldo: anota("saldo", 0n),
    portero: anota("portero", "atiende" as const),
    pagar: anota("pagar", { tipo: "listo", hash: "a".repeat(64) } as const),
    confirmar: anota("confirmar", null),
    puedeVolverALista: anota("volver", true),
    cargar: () => void llamadas.push("cargar"),
    candado: (_nombre, f) => f(),
  };
  m.deps.comision = deps;
  return { llamadas };
}

const EN_MANO = { identidad: "persona", premios: ["0"], premio_en_mano: { es: "Auriculares", en: "Headphones" } };
const botonesDe = (p: Panel): string[] => botones(p).map((b) => (b.textContent ?? "").trim());

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cerrarTodos();
  vi.restoreAllMocks();
});

describe("el premio en mano con el cobro prendido", () => {
  it("elegir el archivo deja Abrir la inscripción a la vista, sin cobro ni comisión", async () => {
    const m = mundo();
    m.cuenta = cuentaDePrueba(5);
    const c = conCobro(m);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe(EN_MANO));
    await suelta(6);
    expect(vistaDe(p)).toBe("previa");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
    expect(p.raiz.querySelector("#cpo-comision")).toBeNull();
    expect(p.raiz.dataset.comision).toBeUndefined();
    expect(texto(p, "#cpo-h")).not.toMatch(/Cargá|Pagá|servicio/i);
    expect(botonesDe(p).join("|")).not.toMatch(/Cargar|Pagar|otra billetera/i);
    expect(c.llamadas).toEqual([]);
  });

  it("Abrir la inscripción abre la sala sin mirar nada del cobro", async () => {
    const m = mundo();
    m.cuenta = cuentaDePrueba(5);
    const c = conCobro(m);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe(EN_MANO));
    await suelta(6);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas).toHaveLength(1);
    expect(c.llamadas).toEqual([]);
  });

  it("la vista previa dice el premio escrito y no un monto", async () => {
    const m = mundo();
    m.cuenta = cuentaDePrueba(5);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ ...EN_MANO, premios: ["0", "0", "0"] }));
    await suelta(6);
    expect(texto(p, "#cpo-premio")).toBe("Auriculares, para 3 personas");
  });

  it("la vista previa de una sola persona dice solo el premio", async () => {
    const m = mundo();
    m.cuenta = cuentaDePrueba(5);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe(EN_MANO));
    await suelta(6);
    expect(texto(p, "#cpo-premio")).toBe("Auriculares");
  });

  it("una campaña de cuentas con el mismo cobro sigue pidiendo cargar", async () => {
    const m = mundo();
    m.cuenta = cuentaDePrueba(5);
    const c = conCobro(m);
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ premios: ["1200000000"] }));
    await suelta(6);
    expect(texto(p, "#cpo-h")).toBe("Cargá 122,40 dólares digitales");
    expect(botonesDe(p)).not.toContain("Abrir la inscripción");
    expect(c.llamadas).toContain("red");
  });
});
