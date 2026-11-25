// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de quien organiza con una campaña de personas y el premio en mano: el resultado lleva una línea que dice que se
 * entrega en persona, las filas dicen el nombre o Ganadora, quien se marca como avisada lo dice sin prometer lo que el panel
 * no sabe, y nunca aparece nada de recibir ni de pagar. Una persona repetida se llama persona y no cuenta. El de cuentas
 * queda como estaba: lo cubren las pruebas de siempre y la foto.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { lineaDePrueba } from "../campana/cuentas-de-prueba";
import { type FilaDeGanadora, type PasoDelPuente, accionesDelPuente, ponerPaso, registrarAcciones, reiniciarElPuente } from "../campana/puente";
import { cifrarEquipo } from "../equipos/datos";
import { guardarOrg } from "../sala/campana-org";
import {
  CLAVE,
  SALA,
  type Mundo,
  abrirInscripcion,
  boton,
  botonDeFila,
  botones,
  cerrarTodos,
  filaDe,
  filasDe,
  mundo,
  nuevoPanel,
  principales,
  texto,
  vistaDe,
  type Panel,
} from "./campana-sala-mundo";

const L1 = lineaDePrueba(1);
const L2 = lineaDePrueba(2);

beforeEach(() => {
  document.body.innerHTML = "";
  reiniciarElPuente();
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

/** Una anotada que llega por el socket con una línea de persona en lugar de una cuenta. */
async function altaDePersona(m: Mundo, n: number, nombre: string, linea: string): Promise<void> {
  const d = await cifrarEquipo(CLAVE, { nombre, integrantes: [] });
  m.sala.enSala.add(n);
  m.escucha().alEquipo?.({ n, cuenta: linea, d, estado: "aceptado", v: n });
}

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

const filasDelResultado = (): string[] => [...document.querySelectorAll("#cpo-ganadoras > li")].map((li) => (li.textContent ?? "").trim());

describe("el resultado en mano en el panel", () => {
  it("la línea dice que se entrega en mano y las filas dicen Ganadora, sin la línea de persona", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ganadora 1"), fila(L2, "Ganadora 2")]));
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio en mano.");
    expect(filasDelResultado()).toHaveLength(2);
    expect(filasDelResultado()[0]).toContain("Ganadora 1");
    expect(p.raiz.textContent).not.toContain("p1:");
  });

  it("la acción principal es Avisar a la primera ganadora y no hay nada de recibir ni de pagar", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(
      enMano([
        fila(L1, "Ana", { alta: { estado: "puede" } }),
        fila(L2, "Ganadora 2", { alta: { estado: "fallo", motivo: "red" } }),
      ]),
    );
    expect(principales(p).map((b) => b.textContent)).toEqual(["Avisar a Ana"]);
    const todo = p.raiz.textContent ?? "";
    for (const prohibido of ["Puede recibir", "No se pudo preparar", "Probar de nuevo", "avisale a Tinkazo"]) {
      expect(todo, prohibido).not.toContain(prohibido);
    }
  });

  it("avisar marca a la ganadora y lo dice como una marca, no como un aviso que llegó al celular", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    const avisar = vi.fn();
    registrarAcciones({ avisarA: avisar });
    ponerPaso(enMano([fila(L1, "Ana"), fila(L2, "Beto")]));
    boton(p, "Avisar a Ana").click();
    expect(avisar).toHaveBeenCalledWith(L1);
    ponerPaso(enMano([fila(L1, "Ana", { avisada: true }), fila(L2, "Beto")]));
    const lista = texto(p, "#cpo-ganadoras");
    expect(lista).toContain("Marcada como avisada.");
    expect(lista).not.toContain("Le avisamos en su celular.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Avisar a Beto"]);
  });

  it("con todas marcadas no queda ninguna acción principal", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana", { avisada: true }), fila(L2, "Beto", { avisada: true })]));
    expect(principales(p)).toHaveLength(0);
  });

  it("con los códigos a la vista, cada fila lleva el suyo y la línea dice que se entrega a quien lo muestre", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana", { codigo: "0042" }), fila(L2, "Beto", { codigo: "7310" })]));
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio a quien te muestre su código.");
    const filas = filasDelResultado();
    expect(filas[0]).toContain("Código 0042");
    expect(filas[1]).toContain("Código 7310");
  });

  it("con un código que falta, la línea sigue siendo la de en mano", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana", { codigo: "0042" }), fila(L2, "Beto")]));
    expect(texto(p, "#cpo-linea")).toBe("Entregá cada premio en mano.");
  });

  it("Ver los códigos solo aparece si hay quien los pida y falta alguno", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana"), fila(L2, "Beto")]));
    expect(botones(p).map((b) => b.textContent)).not.toContain("Ver los códigos");
    const pedir = vi.fn();
    registrarAcciones({ verCodigos: pedir });
    ponerPaso(enMano([fila(L1, "Ana", { codigo: "0042" }), fila(L2, "Beto")]));
    boton(p, "Ver los códigos").click();
    expect(pedir).toHaveBeenCalledTimes(1);
    ponerPaso(enMano([fila(L1, "Ana", { codigo: "0042" }), fila(L2, "Beto", { codigo: "7310" })]));
    expect(botones(p).map((b) => b.textContent)).not.toContain("Ver los códigos");
  });

  it("en inglés todo sale en inglés", async () => {
    const m = mundo();
    m.idioma = "en";
    const p = await enSorteada(m);
    ponerPaso(enMano([fila(L1, "Ana", { codigo: "0042", avisada: true }), fila(L2, "Winner 2", { codigo: "7310" })]));
    expect(texto(p, "#cpo-linea")).toBe("Hand each prize to whoever shows you their code.");
    expect(filasDelResultado()[0]).toContain("Marked as notified.");
    expect(filasDelResultado()[0]).toContain("Code 0042");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Let Winner 2 know"]);
  });

  it("no se registró ninguna acción de pedir códigos: todavía no se piden", () => {
    expect(accionesDelPuente().verCodigos).toBeUndefined();
  });
});

describe("una lista que la sala devuelve mezclada, en el panel", () => {
  it("lista-rara en el resultado dice que se avise a Tinkazo y no ofrece ninguna acción principal", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso({ paso: "lista-rara" });
    expect(texto(p, "#cpo-linea")).toBe("La lista de la sala no se puede sortear. Avisale a Tinkazo.");
    expect(principales(p)).toHaveLength(0);
  });
});

describe("el resultado de cuentas queda como estaba", () => {
  it("sin la marca de en mano, avisada dice Le avisamos en su celular y el alta sigue a la vista", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso({
      paso: "resultado",
      otraBilletera: false,
      filas: [fila("GANA", "Ana", { avisada: true, alta: { estado: "puede" } }), fila("GBETO", "Beto", { alta: { estado: "fallo", motivo: "red" } })],
    });
    expect(texto(p, "#cpo-linea")).toBe("Los celulares ya pueden ver quién ganó.");
    const lista = texto(p, "#cpo-ganadoras");
    expect(lista).toContain("Le avisamos en su celular.");
    expect(lista).not.toContain("Marcada como avisada.");
    expect(lista).toContain("Puede recibir");
    expect(lista).toContain("No se pudo preparar");
  });

  it("un código que viniera en una fila de cuentas no se muestra ni cambia la línea", async () => {
    const m = mundo();
    const p = await enSorteada(m);
    ponerPaso({ paso: "resultado", otraBilletera: false, filas: [fila("GANA", "Ana", { codigo: "0042" })] });
    expect(texto(p, "#cpo-linea")).toBe("Los celulares ya pueden ver quién ganó.");
    expect(texto(p, "#cpo-ganadoras")).not.toContain("0042");
  });
});

describe("quitar a una persona anotada", () => {
  it("el motivo repetida dice persona repetida cuando la fila es una línea de persona", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await altaDePersona(m, 1, "Ana", L1);
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    const rotulos = [...filaDe(p, 1).querySelectorAll("button")].map((b) => b.textContent);
    expect(rotulos).toContain("Persona repetida");
    expect(rotulos).not.toContain("Cuenta repetida");
    botonDeFila(p, 1, "Persona repetida").click();
    expect(filasDe(p)).toEqual(["Ana salió: persona repetida."]);
    await m.correr(5_000);
    expect(m.quitadas).toEqual([[1, "repetida"]]);
  });

  it("los otros motivos de una persona son los de siempre", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await altaDePersona(m, 1, "Ana", L1);
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    const rotulos = [...filaDe(p, 1).querySelectorAll("button")].map((b) => b.textContent);
    expect(rotulos).toEqual(expect.arrayContaining(["No está en el evento", "Lo pidió", "Otro"]));
  });

  it("con una cuenta el motivo repetida sigue diciendo cuenta repetida", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    const d = await cifrarEquipo(CLAVE, { nombre: "Ana", integrantes: [] });
    m.sala.enSala.add(1);
    m.escucha().alEquipo?.({ n: 1, cuenta: "CUENTA1", d, estado: "aceptado", v: 1 });
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    const rotulos = [...filaDe(p, 1).querySelectorAll("button")].map((b) => b.textContent);
    expect(rotulos).toContain("Cuenta repetida");
    expect(rotulos).not.toContain("Persona repetida");
  });
});
