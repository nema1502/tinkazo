// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";
import type { SorteoDeCampana } from "../campana/en-curso";
import { accionesDelPuente, botonDelPaso, lineaDelPaso, pasoDelPuente } from "../campana/puente";
import { alRevelar, registrarLasAcciones, retomarAlArrancar } from "./campana-resultado";
import { type Mundo, RONDA, mundo, suelta, ultimoPaso } from "./campana-resultado-mundo";

/**
 * El resultado de una campaña de personas con el premio en mano. Quien lo dice es la lectura misma: si todas las ganadoras
 * son líneas de persona no hay cuenta ni billetera, así que no se espera la sesión, no se avisa al servicio del acceso y el
 * paso lleva la marca de en mano. Una mezcla de cuentas y líneas no se sortea. El de cuentas queda como estaba.
 */

const L1 = lineaDePrueba(1);
const L2 = lineaDePrueba(2);
const L3 = lineaDePrueba(3);
const enlace = "https://tinkazo.app/verificar.html?c=1#lista";

let m: Mundo;

beforeEach(() => {
  m = mundo();
});
afterEach(() => {
  m.detener();
  vi.restoreAllMocks();
});

function conAvisoHecho(cambios: Partial<SorteoDeCampana> = {}): void {
  if (!m.entrada) throw new Error("sin entrada");
  m.entrada = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"], ...cambios };
  m.fase = "sellada";
}

const deLaSala = (ganadoras: string[]): void => {
  m.leidoDeLaSala = { sorteo: "777", ganadoras, comprobante: "/verificar.html" };
};

async function revelar(): Promise<void> {
  conAvisoHecho();
  await alRevelar(Promise.resolve(enlace), m.d);
  await suelta();
}

const filasDelPaso = (): { cuenta: string; nombre: string; avisada: boolean; alta: unknown; codigo?: string }[] => {
  const p = pasoDelPuente();
  return p.paso === "resultado" ? p.filas : [];
};

describe("ganadoras que son líneas de persona", () => {
  beforeEach(() => deLaSala([L2, L1]));

  it("el paso resultado lleva la marca de en mano, sin otra billetera y con la fase en sorteada", async () => {
    await revelar();
    expect(m.fases).toEqual(["sorteada"]);
    const paso = pasoDelPuente();
    expect(paso).toMatchObject({ paso: "resultado", otraBilletera: false, enMano: true });
  });

  it("las filas dicen Ganadora y su puesto, sin código y sin estado de alta, y nunca la línea", async () => {
    await revelar();
    expect(filasDelPaso().map((f) => [f.cuenta, f.nombre, f.avisada, f.alta])).toEqual([
      [L2, "Ganadora 1", false, "esperando"],
      [L1, "Ganadora 2", false, "esperando"],
    ]);
    expect(filasDelPaso().every((f) => f.codigo === undefined)).toBe(true);
    expect(filasDelPaso().every((f) => !f.nombre.startsWith("p1:"))).toBe(true);
  });

  it("con el nombre que la pestaña conoce, la fila dice el nombre", async () => {
    m.nombres = { [L1]: "Ana" };
    await revelar();
    expect(filasDelPaso().map((f) => f.nombre)).toEqual(["Ganadora 1", "Ana"]);
  });

  it("la línea del paso es la de entregar en mano y no hay botón", async () => {
    await revelar();
    expect(lineaDelPaso(pasoDelPuente())).toEqual({ clave: "cpoEntregaEnMano", vars: {} });
    expect(botonDelPaso(pasoDelPuente())).toBeNull();
  });

  it("no espera la sesión aunque todavía no haya billetera: pinta enseguida y no pone ninguna espera de 12 segundos", async () => {
    m.d.otraBilletera = () => true;
    m.d.billeteraPendiente = () => true;
    m.d.alLlegarLaSesion = () => () => undefined;
    await revelar();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: false, enMano: true });
    expect(m.esperas).not.toContain(12_000);
    expect(m.pasos.filter((p) => p === "resultado")).toHaveLength(1);
  });

  it("nunca arranca el aviso al servicio del acceso, ni cuando lo grabado coincide con lo de la sala", async () => {
    m.sorteado = { guardado: true, ganadoras: [L2, L1] };
    await revelar();
    expect(m.altas).toHaveLength(0);
    m.sorteado = null;
    retomarAlArrancar(m.d);
    await suelta();
    expect(m.altas).toHaveLength(0);
  });

  it("un estado de alta guardado en la entrada local no llega a las filas", async () => {
    m.altasDe = { "0": { estado: "puede" }, "1": { estado: "fallo", motivo: "red" } };
    await revelar();
    expect(filasDelPaso().map((f) => f.alta)).toEqual(["esperando", "esperando"]);
  });

  it("se retoma sin la entrada local del sorteo: el resultado de la sala alcanza para pintarlo", async () => {
    m.sellado = null;
    conAvisoHecho({ resultado: "hecho" });
    m.fase = "sorteada";
    retomarAlArrancar(m.d);
    await suelta();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: false, enMano: true });
    expect(ultimoPaso(m)).toBe("resultado");
    expect(m.altas).toHaveLength(0);
  });

  it("avisar a una ganadora la deja marcada y vuelve a pintar el paso en mano", async () => {
    registrarLasAcciones(m.d);
    await revelar();
    accionesDelPuente().avisarA?.(L1);
    await suelta();
    expect(m.avisos).toEqual([L1]);
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", enMano: true });
    expect(filasDelPaso().map((f) => f.avisada)).toEqual([false, true]);
  });

  it("si la sala no acepta el aviso, la fila sigue sin marcar", async () => {
    registrarLasAcciones(m.d);
    await revelar();
    m.respuestaAlAviso = "forma";
    accionesDelPuente().avisarA?.(L1);
    await suelta();
    expect(filasDelPaso().map((f) => f.avisada)).toEqual([false, false]);
  });

  it("una sola ganadora también es una lista de personas", async () => {
    m.entrada = m.entrada && { ...m.entrada, premios: 1 };
    deLaSala([L3]);
    await revelar();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", enMano: true });
    expect(filasDelPaso().map((f) => f.nombre)).toEqual(["Ganadora 1"]);
  });

  it("ninguna línea llega a la consola ni a lo que el panel recibe como texto", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    await revelar();
    expect(JSON.stringify(consola.map((c) => c.mock.calls))).not.toContain("p1:");
    expect(filasDelPaso().map((f) => f.nombre).join("|")).not.toContain("p1:");
  });
});

describe("una lista mezclada de cuentas y líneas de persona", () => {
  it("el resultado mezclado termina en lista-rara, sin botón y sin reintentos", async () => {
    m.leidoDeLaSala = "mezclada";
    await revelar();
    expect(pasoDelPuente()).toEqual({ paso: "lista-rara" });
    expect(lineaDelPaso(pasoDelPuente())).toEqual({ clave: "cpoListaRara", vars: {} });
    expect(botonDelPaso(pasoDelPuente())).toBeNull();
    expect(m.pasos).not.toContain("boton-resultado");
    expect(m.esperas).toHaveLength(0);
    expect(m.altas).toHaveLength(0);
  });

  it("tras guardar el resultado no se vuelve a leer: reintentar no cambia una mezcla", async () => {
    let lecturas = 0;
    m.d.resultado = async () => {
      lecturas++;
      return "mezclada";
    };
    await revelar();
    expect(lecturas).toBe(1);
  });

  it("al retomar con la sala sorteada también dice lista-rara", async () => {
    m.leidoDeLaSala = "mezclada";
    m.sellado = null;
    conAvisoHecho({ resultado: "hecho" });
    m.fase = "sorteada";
    retomarAlArrancar(m.d);
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "lista-rara" });
  });

  it("una lectura buena después vuelve a pintar a las ganadoras", async () => {
    m.leidoDeLaSala = "mezclada";
    await revelar();
    expect(pasoDelPuente()).toEqual({ paso: "lista-rara" });
    deLaSala([L1, L2]);
    m.sellado = null;
    conAvisoHecho({ resultado: "hecho" });
    m.fase = "sorteada";
    retomarAlArrancar(m.d);
    await suelta();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", enMano: true });
  });
});

describe("ganadoras que son cuentas: todo como hoy", () => {
  it("el paso no lleva la marca de en mano y espera lo de siempre", async () => {
    await revelar();
    const paso = pasoDelPuente();
    expect(paso).toMatchObject({ paso: "resultado", otraBilletera: false });
    expect(paso).not.toHaveProperty("enMano");
    expect(lineaDelPaso(paso)).toEqual({ clave: "cpoCelularesResultado", vars: {} });
  });

  it("sigue avisando al servicio del acceso con lo que la sala confirmó", async () => {
    m.sorteado = { guardado: true, ganadoras: ["GB", "GA"] };
    await revelar();
    expect(m.altas).toEqual([{ sorteo: "777", ganadoras: ["GB", "GA"] }]);
  });

  it("las filas llevan el estado de alta guardado y el nombre de siempre", async () => {
    m.altasDe = { "0": { estado: "puede" } };
    await revelar();
    expect(filasDelPaso().map((f) => [f.nombre, f.alta])).toEqual([
      ["Beto", { estado: "puede" }],
      ["Ana", "esperando"],
    ]);
  });

  it("una cuenta se sigue llamando por su cuenta y no por su puesto", async () => {
    deLaSala(["GCUENTAX", "GA"]);
    await revelar();
    expect(filasDelPaso().map((f) => f.nombre)).toEqual(["GCUENTAX", "Ana"]);
  });
});
