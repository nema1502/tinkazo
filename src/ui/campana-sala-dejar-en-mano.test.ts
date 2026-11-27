// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dejar la campaña desde el resultado en mano. El panel es lo único que le muestra a quien organiza los códigos de entrega,
 * y los lee con lo que esta compu guarda de la campaña: dejarla los pierde. Por eso, con una campaña de personas ya
 * sorteada, Elegir otro archivo pregunta siempre antes, también con todas marcadas como avisadas, y la pregunta nombra los
 * códigos. Con una campaña de cuentas la pregunta es la de siempre.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { lineaDePrueba } from "../campana/cuentas-de-prueba";
import { type FilaDeGanadora, type PasoDelPuente, avisosPendientes, ponerPaso, reiniciarElPuente, seVanLosCodigos } from "../campana/puente";
import { guardarOrg, leerOrg } from "../sala/campana-org";
import { SALA, type Mundo, type Panel, boton, cerrarTodos, mundo, nuevoPanel, texto, vistaDe } from "./campana-sala-mundo";

const L1 = lineaDePrueba(1);
const L2 = lineaDePrueba(2);
const PREGUNTA = "¿Dejar esta campaña?";
const CODIGOS = "Si la dejás, ya no vas a poder ver los códigos de entrega desde esta compu.";
const AVISOS = "Si la dejás ahora, los celulares que todavía no recibieron su aviso se quedan sin verlo.";

beforeEach(() => {
  document.body.innerHTML = "";
  reiniciarElPuente();
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

async function enSorteada(m: Mundo): Promise<Panel> {
  guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
  m.sala.fase = "sorteada";
  const p = nuevoPanel(m);
  await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
  return p;
}

const fila = (cuenta: string, nombre: string, cambios: Partial<FilaDeGanadora> = {}): FilaDeGanadora => ({
  cuenta,
  nombre,
  avisada: false,
  alta: "esperando",
  ...cambios,
});
const enMano = (filas: FilaDeGanadora[]): PasoDelPuente => ({ paso: "resultado", otraBilletera: false, enMano: true, filas });
const deCuentas = (filas: FilaDeGanadora[]): PasoDelPuente => ({ paso: "resultado", otraBilletera: false, filas });
const TODAS_MARCADAS = enMano([fila(L1, "Ana", { avisada: true, codigo: "0042" }), fila(L2, "Beto", { avisada: true, codigo: "7310" })]);

describe("dejar una campaña de personas ya sorteada", () => {
  it("con todas marcadas como avisadas, Elegir otro archivo pregunta antes y nombra los códigos", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(TODAS_MARCADAS);
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    expect(texto(p, "#cpo-h")).toBe(PREGUNTA);
    expect(texto(p, "#cpo-linea")).toBe(CODIGOS);
    // Nada se olvidó todavía: la compu sigue recordando la campaña.
    expect(leerOrg(m.almacen, m.ahora, "testnet", null)?.sala.id).toBe(SALA.id);
  });

  it("Cancelar vuelve al resultado con los códigos a la vista", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(TODAS_MARCADAS);
    boton(p, "Elegir otro archivo").click();
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("sorteada");
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio a quien te muestre su código.");
    expect(texto(p, "#cpo-ganadoras")).toContain("Código 0042");
    expect(texto(p, "#cpo-ganadoras")).toContain("Código 7310");
    expect(leerOrg(m.almacen, m.ahora, "testnet", null)?.sala.id).toBe(SALA.id);
  });

  it("Sí, dejarla la deja, como siempre", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(TODAS_MARCADAS);
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(leerOrg(m.almacen, m.ahora, "testnet", null)).toBeNull();
    expect(texto(p, "#cpo-linea")).not.toBe(CODIGOS);
  });

  it("con alguna sin marcar, la pregunta nombra los códigos y no un aviso a los celulares", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana", { avisada: true, codigo: "0042" }), fila(L2, "Beto", { codigo: "7310" })]));
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    expect(texto(p, "#cpo-linea")).toBe(CODIGOS);
    expect(p.raiz.textContent).not.toContain(AVISOS);
  });

  it("también pregunta mientras los códigos todavía no llegaron", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana", { avisada: true }), fila(L2, "Beto", { avisada: true })]));
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    expect(texto(p, "#cpo-linea")).toBe(CODIGOS);
  });

  it("en inglés la pregunta sale en inglés", async () => {
    const m = mundo();
    m.idioma = "en";
    const p = await enSorteada(m);
    ponerPaso(TODAS_MARCADAS);
    boton(p, "Choose another file").click();
    expect(texto(p, "#cpo-h")).toBe("Leave this campaign?");
    expect(texto(p, "#cpo-linea")).toBe("If you leave it, you won't be able to see the handover codes on this computer.");
  });

  it("nunca muestra una línea de persona", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(TODAS_MARCADAS);
    boton(p, "Elegir otro archivo").click();
    expect(p.raiz.textContent).not.toContain("p1:");
  });
});

describe("dejar una campaña de cuentas ya sorteada, como siempre", () => {
  it("con todas avisadas se deja de un toque, sin pregunta", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(deCuentas([fila("GUNO", "Ana", { avisada: true }), fila("GDOS", "Beto", { avisada: true })]));
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
  });

  it("con alguna sin avisar, la pregunta lleva la línea de los avisos y no nombra códigos", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(deCuentas([fila("GUNO", "Ana", { avisada: true }), fila("GDOS", "Beto")]));
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    expect(texto(p, "#cpo-linea")).toBe(AVISOS);
    expect(p.raiz.textContent).not.toContain("códigos");
  });

  it("un código que viniera en una fila de cuentas no hace preguntar", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(deCuentas([fila("GUNO", "Ana", { avisada: true, codigo: "0042" })]));
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
  });
});

describe("cuándo se pierden códigos al dejar la campaña", () => {
  it("solo con el resultado en mano a la vista", () => {
    expect(seVanLosCodigos(TODAS_MARCADAS)).toBe(true);
    expect(seVanLosCodigos(enMano([fila(L1, "Ana")]))).toBe(true);
    expect(seVanLosCodigos(deCuentas([fila("GUNO", "Ana", { avisada: true })]))).toBe(false);
    for (const paso of ["nada", "mandando", "boton-resultado", "sala-borrada", "lista-rara", "tomada"] as const) {
      expect(seVanLosCodigos({ paso }), paso).toBe(false);
    }
  });

  it("la regla de los avisos pendientes no cambia: con todas marcadas no hay ninguno", () => {
    expect(avisosPendientes(TODAS_MARCADAS, true)).toBe(false);
    expect(avisosPendientes(deCuentas([fila("GUNO", "Ana", { avisada: true })]), true)).toBe(false);
  });
});
