// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";
import type { SorteoDeCampana } from "../campana/en-curso";
import { type FilaDeGanadora, accionesDelPuente, botonDelPaso, lineaDelPaso, pasoDelPuente } from "../campana/puente";
import { alRevelar, registrarLasAcciones, retomarAlArrancar } from "./campana-resultado";
import { type Mundo, RONDA, diferida, mundo, suelta } from "./campana-resultado-mundo";

/**
 * Los códigos de entrega en el resultado de una campaña de personas. Primero se pintan las ganadoras y los códigos llegan
 * después con un repintado: tres pedidos con dos segundos entre uno y otro, cada uno con su tope de diez, así que en 34
 * segundos termina. Con todos a la vista la línea dice que se entrega a quien muestre su código. Sin poder leerlos queda
 * la de entregar en mano y el panel ofrece pedirlos de nuevo. Los códigos viven solo en la memoria de la pestaña. Una
 * campaña de cuentas nunca los pide.
 */

const L1 = lineaDePrueba(1);
const L2 = lineaDePrueba(2);
const enlace = "https://tinkazo.app/verificar.html?c=1#lista";

let m: Mundo;

beforeEach(() => {
  m = mundo();
});
afterEach(() => {
  m.detener();
  vi.restoreAllMocks();
});

function conAvisoHecho(): void {
  if (!m.entrada) throw new Error("sin entrada");
  const e: SorteoDeCampana = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"] };
  m.entrada = e;
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

const filas = (): FilaDeGanadora[] => {
  const p = pasoDelPuente();
  return p.paso === "resultado" ? p.filas : [];
};
const sinCodigos = (): boolean => {
  const p = pasoDelPuente();
  return p.paso === "resultado" && p.sinCodigos === true;
};
const linea = (): string | undefined => lineaDelPaso(pasoDelPuente())?.clave;

describe("campaña de personas: los códigos de entrega", () => {
  beforeEach(() => deLaSala([L2, L1]));

  it("las ganadoras se pintan antes del primer pedido de códigos", async () => {
    await revelar();
    expect(m.pedidosDeCodigos).toHaveLength(1);
    const { pasosYaPintados } = m.pedidosDeCodigos[0] ?? { pasosYaPintados: 0 };
    expect(pasosYaPintados).toBeGreaterThan(0);
    expect(m.pasos.slice(0, pasosYaPintados)).toContain("resultado");
  });

  it("sin la respuesta todavía, las filas salen sin código y la línea es la de entregar en mano", async () => {
    const espera = diferida<string[]>();
    m.respuestasALosCodigos = [() => espera.promesa];
    await revelar();
    expect(filas().map((f) => f.nombre)).toEqual(["Ganadora 1", "Ganadora 2"]);
    expect(filas().every((f) => !("codigo" in f))).toBe(true);
    expect(linea()).toBe("cpoEntregaEnMano");
    expect(sinCodigos()).toBe(false);
  });

  it("al llegar los códigos las filas los llevan en orden de puesto y la línea cambia", async () => {
    m.respuestasALosCodigos = [["0421", "7310"]];
    await revelar();
    expect(filas().map((f) => [f.nombre, f.codigo])).toEqual([
      ["Ganadora 1", "0421"],
      ["Ganadora 2", "7310"],
    ]);
    expect(linea()).toBe("cpoEntregaConCodigo");
    expect(sinCodigos()).toBe(false);
    expect(botonDelPaso(pasoDelPuente())).toBeNull();
    expect(m.pedidosDeCodigos).toHaveLength(1);
  });

  it("la línea cambia solo con todos los códigos: una lista más corta no sirve y cuenta como falla", async () => {
    m.respuestasALosCodigos = [["0421"], ["0421"], ["0421"]];
    await revelar();
    await m.avanzar(4_000);
    expect(m.pedidosDeCodigos).toHaveLength(3);
    expect(filas().every((f) => !("codigo" in f))).toBe(true);
    expect(linea()).toBe("cpoEntregaEnMano");
    expect(sinCodigos()).toBe(true);
  });

  it("pide tres veces, con dos segundos entre una y otra, y después deja el enlace", async () => {
    const t0 = m.ahora;
    await revelar();
    expect(sinCodigos()).toBe(false);
    await m.avanzar(2_000);
    expect(sinCodigos()).toBe(false);
    await m.avanzar(2_000);
    expect(m.pedidosDeCodigos.map((p) => p.en - t0)).toEqual([0, 2_000, 4_000]);
    expect(sinCodigos()).toBe(true);
    expect(linea()).toBe("cpoEntregaEnMano");
    // No hay un cuarto pedido por su cuenta.
    await m.avanzar(60_000);
    expect(m.pedidosDeCodigos).toHaveLength(3);
  });

  it("un pedido que nunca contesta se corta a los diez segundos y todo termina a los 34", async () => {
    const t0 = m.ahora;
    const colgado = (): Promise<string[]> => new Promise<string[]>(() => undefined);
    m.respuestasALosCodigos = [colgado, colgado, colgado];
    await revelar();
    await m.avanzar(33_999);
    expect(sinCodigos()).toBe(false);
    expect(m.pedidosDeCodigos.map((p) => p.en - t0)).toEqual([0, 12_000, 24_000]);
    await m.avanzar(1);
    expect(sinCodigos()).toBe(true);
    expect(linea()).toBe("cpoEntregaEnMano");
  });

  it("un pedido que falla con una excepción cuenta como falla y se sigue con el siguiente", async () => {
    m.respuestasALosCodigos = [
      () => Promise.reject(new Error("sin red")),
      ["0421", "7310"],
    ];
    await revelar();
    expect(filas().every((f) => !("codigo" in f))).toBe(true);
    await m.avanzar(2_000);
    expect(filas().map((f) => f.codigo)).toEqual(["0421", "7310"]);
    expect(sinCodigos()).toBe(false);
  });

  it("los motivos de la sala (fase, token, no existe) también se reintentan y terminan con el enlace", async () => {
    m.respuestasALosCodigos = ["fase", "token", "no-existe"];
    await revelar();
    await m.avanzar(4_000);
    expect(m.pedidosDeCodigos).toHaveLength(3);
    expect(sinCodigos()).toBe(true);
  });

  it("el enlace Ver los códigos los vuelve a pedir: mientras tanto no se ofrece y al llegar la línea cambia", async () => {
    registrarLasAcciones(m.d);
    await revelar();
    await m.avanzar(4_000);
    expect(sinCodigos()).toBe(true);
    const pedidosAntes = m.pedidosDeCodigos.length;
    const espera = diferida<string[]>();
    m.respuestasALosCodigos = [() => espera.promesa];
    accionesDelPuente().verCodigos?.();
    await suelta();
    expect(m.pedidosDeCodigos).toHaveLength(pedidosAntes + 1);
    expect(sinCodigos()).toBe(false);
    // Un segundo toque con el pedido en marcha no suma otro.
    accionesDelPuente().verCodigos?.();
    await suelta();
    expect(m.pedidosDeCodigos).toHaveLength(pedidosAntes + 1);
    espera.resolver(["0042", "9001"]);
    await suelta();
    expect(filas().map((f) => f.codigo)).toEqual(["0042", "9001"]);
    expect(linea()).toBe("cpoEntregaConCodigo");
    // Con todos a la vista, tocar de nuevo no pide nada.
    accionesDelPuente().verCodigos?.();
    await suelta();
    expect(m.pedidosDeCodigos).toHaveLength(pedidosAntes + 1);
  });

  it("si el enlace falla otra vez, vuelve a quedar el enlace tras sus tres pedidos", async () => {
    registrarLasAcciones(m.d);
    await revelar();
    await m.avanzar(4_000);
    const antes = m.pedidosDeCodigos.length;
    accionesDelPuente().verCodigos?.();
    await suelta();
    await m.avanzar(4_000);
    expect(m.pedidosDeCodigos).toHaveLength(antes + 3);
    expect(sinCodigos()).toBe(true);
  });

  it("avisar a una ganadora no pierde los códigos que ya se tienen", async () => {
    registrarLasAcciones(m.d);
    m.respuestasALosCodigos = [["0421", "7310"]];
    await revelar();
    accionesDelPuente().avisarA?.(L1);
    await suelta();
    expect(filas().map((f) => [f.avisada, f.codigo])).toEqual([
      [false, "0421"],
      [true, "7310"],
    ]);
  });

  it("al retomar con las mismas ganadoras, los códigos que ya se tienen no se vuelven a pedir", async () => {
    m.respuestasALosCodigos = [["0421", "7310"]];
    await revelar();
    m.sellado = null;
    m.fase = "sorteada";
    if (m.entrada) m.entrada = { ...m.entrada, resultado: "hecho" };
    retomarAlArrancar(m.d);
    await suelta();
    expect(m.pedidosDeCodigos).toHaveLength(1);
    expect(filas().map((f) => f.codigo)).toEqual(["0421", "7310"]);
  });

  it("al retomar con otras ganadoras no se reusan los códigos de las de antes", async () => {
    m.respuestasALosCodigos = [["0421", "7310"], ["1111", "2222"]];
    await revelar();
    deLaSala([L1, L2]);
    m.sellado = null;
    m.fase = "sorteada";
    if (m.entrada) m.entrada = { ...m.entrada, resultado: "hecho" };
    retomarAlArrancar(m.d);
    await suelta();
    expect(m.pedidosDeCodigos).toHaveLength(2);
    expect(filas().map((f) => f.codigo)).toEqual(["1111", "2222"]);
  });

  it("una serie de pedidos vieja no pisa a la nueva: la respuesta tardía se descarta", async () => {
    const vieja = diferida<string[]>();
    m.respuestasALosCodigos = [() => vieja.promesa, ["1111", "2222"]];
    await revelar();
    // El panel retoma la misma sala: arranca otra serie y la de antes queda sin vigencia.
    m.sellado = null;
    m.fase = "sorteada";
    if (m.entrada) m.entrada = { ...m.entrada, resultado: "hecho" };
    retomarAlArrancar(m.d);
    await suelta();
    expect(filas().map((f) => f.codigo)).toEqual(["1111", "2222"]);
    vieja.resolver(["0421", "7310"]);
    await suelta();
    expect(filas().map((f) => f.codigo)).toEqual(["1111", "2222"]);
  });

  it("si el panel ya pasó a otro paso cuando llegan los códigos, no se lo pisa", async () => {
    const espera = diferida<string[]>();
    m.respuestasALosCodigos = [() => espera.promesa];
    registrarLasAcciones(m.d);
    await revelar();
    m.respuestaAlAviso = "token";
    accionesDelPuente().avisarA?.(L1);
    await suelta();
    expect(pasoDelPuente().paso).toBe("tomada");
    espera.resolver(["0421", "7310"]);
    await suelta();
    expect(pasoDelPuente().paso).toBe("tomada");
  });

  it("los códigos no se escriben en ninguna parte: ni en la entrada, ni en el almacenamiento, ni en la consola", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    m.respuestasALosCodigos = [["0421", "7310"]];
    await revelar();
    expect(filas().map((f) => f.codigo)).toEqual(["0421", "7310"]);
    const rastros = JSON.stringify([m.guardadas, m.entrada, consola.map((c) => c.mock.calls), { ...localStorage }, { ...sessionStorage }]);
    expect(rastros).not.toContain("0421");
    expect(rastros).not.toContain("7310");
  });

  it("reiniciar el resultado olvida los códigos: al volver a empezar se piden de nuevo", async () => {
    m.respuestasALosCodigos = [["0421", "7310"], ["0421", "7310"]];
    await revelar();
    m.detener();
    m = mundo();
    deLaSala([L2, L1]);
    await revelar();
    expect(m.pedidosDeCodigos).toHaveLength(1);
  });
});

describe("campaña de cuentas: nunca se piden códigos", () => {
  it("el resultado de cuentas llega sin pedir ninguno y sin código en las filas", async () => {
    m.respuestasALosCodigos = [["0421", "7310"]];
    await revelar();
    await m.avanzar(60_000);
    expect(m.pedidosDeCodigos).toHaveLength(0);
    expect(filas().every((f) => !("codigo" in f))).toBe(true);
    expect(pasoDelPuente()).not.toHaveProperty("enMano");
    expect(pasoDelPuente()).not.toHaveProperty("sinCodigos");
  });

  it("Ver los códigos no hace nada en una campaña de cuentas", async () => {
    registrarLasAcciones(m.d);
    await revelar();
    accionesDelPuente().verCodigos?.();
    await suelta();
    expect(m.pedidosDeCodigos).toHaveLength(0);
  });

  it("una lista mezclada tampoco los pide", async () => {
    m.leidoDeLaSala = "mezclada";
    await revelar();
    await m.avanzar(60_000);
    expect(m.pedidosDeCodigos).toHaveLength(0);
  });
});
