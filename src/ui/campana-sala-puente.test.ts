// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que el panel de quien organiza hace con el paso de la herramienta: pasar la lista con el contexto que corresponde,
 * dibujar la línea y el botón principal de cada paso, no ofrecer Quitar ni Volver a abrir con la lista trabada, y retomar
 * después de una recarga. La herramienta entra por `deps`, falsa: el cuadro del sorteo no se toca desde acá.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { reiniciarElPuente, ponerPaso, pasoDelPuente, registrarAcciones } from "../campana/puente";
import { guardarOrg } from "../sala/campana-org";
import type { ContextoDelPaso } from "./campana-pasar";
import {
  SALA,
  type Mundo,
  abrirInscripcion,
  alta,
  boton,
  botones,
  cerrarTodos,
  confirmarCierre,
  equipoDe,
  filaDe,
  mundo,
  nuevoPanel,
  principales,
  texto,
  vistaDe,
  type Panel,
} from "./campana-sala-mundo";

interface Llamada {
  n: number[];
  campana: string;
  quitas: () => number[];
}

/** Anota cada vez que el panel le pasa la lista al paso, con lo que le dio. */
function espiar(m: Mundo): Llamada[] {
  const llamadas: Llamada[] = [];
  m.deps.alCerrar = (_s, filas, ctx?: ContextoDelPaso) => {
    llamadas.push({ n: filas.map((f) => f.n), campana: ctx?.campana.evento ?? "", quitas: ctx?.quitasEnCurso ?? (() => []) });
  };
  return llamadas;
}

async function cerrarConDos(m: Mundo, p: Panel): Promise<void> {
  await abrirInscripcion(m, p);
  await alta(m, 1, "Ana");
  await alta(m, 2, "Nora");
  await vi.waitFor(() => expect(document.querySelectorAll("#cpo-ul > li")).toHaveLength(2));
  boton(p, "Cerrar la lista").click();
  await confirmarCierre(m, p, "Cerrar con 2 personas");
  await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
}

beforeEach(() => {
  document.body.innerHTML = "";
  reiniciarElPuente();
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

describe("el panel y el paso de pasar la lista", () => {
  it("al cerrar le pasa al paso la campaña y las quitas en curso", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.campana).toBe("evento-uno");
    expect(llamadas[0]?.n).toEqual([2, 1]);
    expect(llamadas[0]?.quitas()).toEqual([]);
  });

  it("una quita en Deshacer aparece entre las quitas en curso y vuelve a pasar la lista", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    (filaDe(p, 1).querySelector('button[data-accion="quitar"]') as HTMLButtonElement).click();
    (filaDe(p, 1).querySelector('button[data-motivo="otro"]') as HTMLButtonElement).click();
    expect(llamadas.length).toBeGreaterThanOrEqual(2);
    expect(llamadas[llamadas.length - 1]?.quitas()).toEqual([1]);
    await m.correr(5_100);
    expect(llamadas[llamadas.length - 1]?.quitas()).toEqual([]);
  });

  it("si no pudo leer la lista, lo dice con Probar de nuevo como única acción principal, y vuelve a pasarla", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    ponerPaso({ paso: "no-leyo" });
    expect(texto(p, "#cpo-linea")).toBe("No se pudo leer toda la lista.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));
  });

  it("con otra cuenta, dice con cuál entrar y ofrece Cambiar de cuenta", async () => {
    const m = mundo();
    espiar(m);
    const cambiar = vi.fn();
    m.deps.cambiarDeCuenta = cambiar;
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    ponerPaso({ paso: "otra-cuenta", fin: "6XWZ" });
    expect(texto(p, "#cpo-linea")).toBe("Entrá con la cuenta que termina en 6XWZ.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cambiar de cuenta"]);
    boton(p, "Cambiar de cuenta").click();
    expect(cambiar).toHaveBeenCalledTimes(1);
  });

  it("al cambiar la sesión con el paso frenado por la cuenta, vuelve a pasar la lista", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    ponerPaso({ paso: "otra-cuenta", fin: "6XWZ" });
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: "G..." }));
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));
  });

  it("al cambiar la sesión con la lista ya en el sorteo, vuelve a correr el paso para vaciar el cuadro y decir con qué cuenta entrar", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    ponerPaso({ paso: "en-el-sorteo", n: 2 });
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: "GOTRA" }));
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));
  });

  it.each([{ paso: "tarde" }, { paso: "lista-cambio" }, { paso: "ganadoras", n: 2 }] as const)(
    "con el paso %o ofrece pasar la lista de nuevo, que suelta el sello y vuelve a pasar",
    async (paso) => {
      const m = mundo();
      const llamadas = espiar(m);
      const soltar = vi.fn(async () => undefined);
      m.deps.soltarElSello = soltar;
      const p = nuevoPanel(m);
      await cerrarConDos(m, p);
      await vi.waitFor(() => expect(llamadas).toHaveLength(1));
      ponerPaso(paso);
      expect(principales(p).map((b) => b.textContent)).toEqual(["Pasar la lista al sorteo"]);
      boton(p, "Pasar la lista al sorteo").click();
      await vi.waitFor(() => expect(llamadas).toHaveLength(2));
      expect(soltar).toHaveBeenCalledTimes(1);
    },
  );

  it("si la sala no contestó tras todos los intentos, ofrece probar de nuevo y no deja un cartel sin salida", async () => {
    const m = mundo();
    espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    const comprobar = vi.fn();
    registrarAcciones({ comprobarDeNuevo: comprobar });
    ponerPaso({ paso: "no-comprobo" });
    expect(texto(p, "#cpo-linea")).toBe("No pudimos comprobar si los celulares ya lo saben.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
    boton(p, "Probar de nuevo").click();
    expect(comprobar).toHaveBeenCalledTimes(1);
  });

  it("con la lista sellada de otra lista ofrece pasarla de nuevo, que suelta el sello y vuelve a pasar", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    const soltar = vi.fn(async () => undefined);
    m.deps.soltarElSello = soltar;
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    ponerPaso({ paso: "lista-sellada", soltable: true });
    expect(texto(p, "#cpo-linea")).toBe("El sorteo ya tiene una lista sellada.");
    boton(p, "Pasar la lista al sorteo").click();
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));
    expect(soltar).toHaveBeenCalledTimes(1);
  });

  it("con el sorteo ya hecho en pantalla no ofrece soltar la lista sellada", async () => {
    const m = mundo();
    espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    ponerPaso({ paso: "lista-sellada", soltable: false });
    expect(principales(p)).toHaveLength(0);
  });

  it("después de pasar dice cuántas personas hay, con qué botón seguir y que el show empieza en pantalla completa", async () => {
    const m = mundo();
    m.deps.botonDeSellar = () => "Sellar la lista";
    espiar(m);
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    ponerPaso({ paso: "en-el-sorteo", n: 2 });
    expect(texto(p, "#cpo-linea")).toBe("2 personas en el sorteo. Con Sellar la lista empieza el show en pantalla completa.");
  });
});

describe("la lista trabada", () => {
  it("con la lista sellándose no ofrece Quitar ni Volver a abrir", async () => {
    const m = mundo();
    espiar(m);
    let trabada = false;
    m.deps.listaBloqueada = () => trabada;
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    expect(filaDe(p, 1).querySelector('button[data-accion="quitar"]')).not.toBeNull();
    expect(botones(p).map((b) => b.textContent)).toContain("Volver a abrir la lista");
    trabada = true;
    ponerPaso({ paso: "avisando" });
    expect(filaDe(p, 1).querySelector('button[data-accion="quitar"]')).toBeNull();
    expect(botones(p).map((b) => b.textContent)).not.toContain("Volver a abrir la lista");
  });
});

describe("volver a abrir y dejar la campaña", () => {
  it("volver a abrir le avisa a la herramienta para que vacíe lo que pasó, y borra el paso", async () => {
    const m = mundo();
    espiar(m);
    const reabrir = vi.fn();
    m.deps.alReabrir = reabrir;
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    ponerPaso({ paso: "en-el-sorteo", n: 2 });
    boton(p, "Volver a abrir la lista").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(reabrir).toHaveBeenCalledTimes(1);
    expect(pasoDelPuente()).toEqual({ paso: "nada" });
  });

  it("dejar la campaña le avisa a la herramienta", async () => {
    const m = mundo();
    espiar(m);
    const olvidar = vi.fn();
    m.deps.alOlvidar = olvidar;
    const p = nuevoPanel(m);
    await cerrarConDos(m, p);
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(olvidar).toHaveBeenCalledTimes(1);
  });
});

describe("retomar después de recargar", () => {
  it("con la lista ya pasada al cuadro vuelve a pasarla sola, sin pedir tocar nada", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    m.deps.listaPasada = () => true;
    guardarOrg(m.almacen, { sala: SALA, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await equipoDe(m, 1, "Ana"), await equipoDe(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    // Pasa al volver y otra vez con cada fila que llega después: el paso las junta, y la última manda.
    await vi.waitFor(() => expect(llamadas.length).toBeGreaterThanOrEqual(1));
    expect(principales(p)).toHaveLength(0);
  });

  it("con la lista sin pasar sigue pidiendo Pasar la lista al sorteo", async () => {
    const m = mundo();
    const llamadas = espiar(m);
    m.deps.listaPasada = () => false;
    guardarOrg(m.almacen, { sala: SALA, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await equipoDe(m, 1, "Ana"), await equipoDe(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pasar la lista al sorteo"]);
    expect(llamadas).toHaveLength(0);
  });

  it("con una quita guardada a medias la manda al volver, salvo que la lista esté trabada", async () => {
    const quitadasConLaLista = async (trabada: boolean): Promise<number> => {
      document.body.innerHTML = "";
      const m = mundo();
      espiar(m);
      m.deps.listaBloqueada = () => trabada;
      guardarOrg(m.almacen, { sala: SALA, fase: "cerrada", pendientes: [{ n: 1, motivo: "otro" }] });
      m.sala.fase = "cerrada";
      m.sala.enSala.add(1);
      const p = nuevoPanel(m);
      await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
      return m.quitadas.length;
    };
    expect(await quitadasConLaLista(false)).toBe(1);
    expect(await quitadasConLaLista(true)).toBe(0);
  });

  it.each(["sellada", "sorteada"] as const)("con la sala en %s le avisa a la herramienta para retomar lo que falta", async (fase) => {
    const m = mundo();
    const retomar = vi.fn();
    m.deps.alRetomar = retomar;
    guardarOrg(m.almacen, { sala: SALA, fase });
    m.sala.fase = fase;
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe(fase));
    expect(retomar).toHaveBeenCalledWith(fase, expect.objectContaining({ id: SALA.id }));
  });
});

describe("el resultado en el panel", () => {
  it("dibuja una ganadora con Avisar a y la deja avisada al tocarlo", async () => {
    const m = mundo();
    const avisar = vi.fn();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    const { registrarAcciones } = await import("../campana/puente");
    registrarAcciones({ avisarA: avisar });
    ponerPaso({
      paso: "resultado",
      otraBilletera: false,
      filas: [
        { cuenta: "GANA", nombre: "Ana", avisada: false, alta: "esperando" },
        { cuenta: "GNORA", nombre: "Nora", avisada: true, alta: { estado: "puede" } },
      ],
    });
    expect(texto(p, "#cpo-linea")).toBe("Los celulares ya pueden ver quién ganó.");
    boton(p, "Avisar a Ana").click();
    expect(avisar).toHaveBeenCalledWith("GANA");
    const lista = texto(p, "#cpo-ganadoras");
    expect(lista).toContain("Le avisamos en su celular.");
    expect(lista).toContain("Puede recibir");
  });

  it("con otra billetera la línea de apoyo es una sola: avisarle a Tinkazo", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    ponerPaso({ paso: "resultado", otraBilletera: true, filas: [{ cuenta: "GANA", nombre: "Ana", avisada: false, alta: "esperando" }] });
    expect(texto(p, "#cpo-linea")).toBe("Si alguien no puede recibir, avisale a Tinkazo.");
  });

  it("una alta que falló muestra No se pudo preparar y Probar de nuevo, salvo que ya no se pueda arreglar", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    ponerPaso({
      paso: "resultado",
      otraBilletera: false,
      filas: [
        { cuenta: "GA", nombre: "Ana", avisada: true, alta: { estado: "fallo", motivo: "red" } },
        { cuenta: "GB", nombre: "Beto", avisada: true, alta: { estado: "fallo", motivo: "sin-acceso", final: true } },
      ],
    });
    const filas = [...document.querySelectorAll("#cpo-ganadoras > li")].map((li) => li.textContent ?? "");
    expect(filas[0]).toContain("No se pudo preparar");
    expect(filas[0]).toContain("Probar de nuevo");
    expect(filas[1]).toContain("No se pudo preparar");
    expect(filas[1]).not.toContain("Probar de nuevo");
  });
});
