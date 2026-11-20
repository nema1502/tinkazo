// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accionesDelPuente, botonDelPaso, lineaDelPaso, pasoDelPuente } from "../campana/puente";
import type { SorteoDeCampana } from "../campana/en-curso";
import { alRevelar, escucharSellos, registrarLasAcciones } from "./campana-resultado";
import { type Mundo, RONDA, mundo, suelta } from "./campana-resultado-mundo";

/**
 * Lo que la revisión de la rama encontró en el aviso a la sala: un sello rechazado tarde con el show ya hecho, una sala que
 * no contesta, un pedido mal formado que no mejora, y una sesión de Google que llega después que el resultado de la sala.
 */

let m: Mundo;
let quitar: () => void;

const sellar = (): void => void document.dispatchEvent(new CustomEvent("tinkazo:sellado"));

beforeEach(() => {
  m = mundo();
  quitar = escucharSellos(m.d);
  registrarLasAcciones(m.d);
});
afterEach(() => {
  quitar();
  m.detener();
});

function conAvisoHecho(cambios: Partial<SorteoDeCampana> = {}): void {
  if (!m.entrada) throw new Error("sin entrada");
  m.entrada = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"], ...cambios };
  m.fase = "sellada";
}

describe("un sello que la sala no aceptó, con el show ya hecho", () => {
  it.each([
    ["tarde", "cpoTarde"],
    ["lista-cambio", "cpoListaCambio"],
    ["ganadoras", "cpoGanadoras1"],
  ] as const)("el paso %s lleva un botón para pasar la lista de nuevo", (paso, linea) => {
    const p = paso === "ganadoras" ? ({ paso, n: 1 } as const) : ({ paso } as const);
    expect(botonDelPaso(p)).toEqual({ clave: "cpoPasar", accion: "soltarYPasar" });
    expect(lineaDelPaso(p)?.clave).toBe(linea);
  });

  it("con la ronda pasada y el show en marcha, la línea sale y el botón de pasar la lista queda a la vista", async () => {
    m.puedeSoltar = false;
    sellar();
    await m.avanzar(90_000 + 23_000);
    expect(pasoDelPuente()).toEqual({ paso: "tarde" });
    expect(m.soltadas).toBe(0);
    expect(botonDelPaso(pasoDelPuente())).toEqual({ clave: "cpoPasar", accion: "soltarYPasar" });
  });

  it("un comprobante revelado sobre un sello que la sala rechazó después no se manda con el sello nuevo", async () => {
    m.puedeSoltar = false;
    sellar();
    await suelta();
    await alRevelar(Promise.resolve("https://tinkazo.app/verificar.html#lista"), m.d);
    await m.avanzar(90_000 + 23_000);
    expect(pasoDelPuente()).toEqual({ paso: "tarde" });
    expect(m.entrada?.comprobante).toBeUndefined();
    m.respuestasAlSello = ["ok"];
    m.fase = "cerrada";
    sellar();
    await suelta();
    expect(m.resultados).toHaveLength(0);
  });
});

describe("la sala no contesta cuando ya pasó el plazo", () => {
  it("tras las doce preguntas sin respuesta queda un botón para probar de nuevo, no un cartel sin salida", async () => {
    m.estadoPorDefecto = "red";
    sellar();
    await m.avanzar(90_000 + 22_000 + 12 * 5_000 + 2_000);
    expect(m.estados).toBe(12);
    expect(pasoDelPuente()).toEqual({ paso: "no-comprobo" });
    expect(botonDelPaso(pasoDelPuente())).toEqual({ clave: "cpoReintentar", accion: "comprobarDeNuevo" });
    expect(m.entrada?.aviso).toBe("pendiente");
  });

  it("el botón vuelve a preguntar y, si la sala quedó sellada, el aviso cuenta como hecho", async () => {
    m.estadoPorDefecto = "red";
    sellar();
    await m.avanzar(90_000 + 22_000 + 12 * 5_000 + 2_000);
    m.estadoPorDefecto = { fase: "sellada", total: 2, cierraMs: 0 };
    accionesDelPuente().comprobarDeNuevo?.();
    await suelta();
    expect(m.estados).toBe(13);
    expect(m.entrada?.aviso).toBe("hecho");
    expect(pasoDelPuente()).toEqual({ paso: "avisada" });
  });

  it("el paso nuevo se lee en los dos idiomas con su propia línea", () => {
    expect(lineaDelPaso({ paso: "no-comprobo" })?.clave).toBe("cpoNoComprobo");
    expect(lineaDelPaso({ paso: "aviso-roto" })?.clave).toBe("cpoAvisoRoto");
  });
});

describe("un pedido mal formado", () => {
  it("después de tres respuestas forma deja de insistir y lo dice, sin soltar el sello", async () => {
    m.respuestasAlSello = ["forma", "forma", "forma", "ok"];
    sellar();
    await m.avanzar(60_000);
    expect(m.pedidos).toHaveLength(3);
    expect(pasoDelPuente()).toEqual({ paso: "aviso-roto" });
    expect(m.soltadas).toBe(0);
    expect(m.entrada?.aviso).toBe("pendiente");
  });

  it("dos respuestas forma y después ok no llegan al tope: el aviso entra", async () => {
    m.respuestasAlSello = ["forma", "forma", "ok"];
    sellar();
    await m.avanzar(20_000);
    expect(m.pedidos).toHaveLength(3);
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it("tres respuestas forma salteadas con otras de red no llegan al tope: se sigue probando", async () => {
    m.respuestasAlSello = ["forma", "red", "forma", "red", "forma", "ok"];
    sellar();
    await m.avanzar(30_000);
    expect(m.pedidos).toHaveLength(6);
    expect(m.entrada?.aviso).toBe("hecho");
  });
});

describe("la sesión de Google que llega después del resultado de la sala", () => {
  const enlace = "https://tinkazo.app/verificar.html#lista";
  let alLlegar: (() => void)[];
  let pendiente: boolean;

  beforeEach(() => {
    alLlegar = [];
    pendiente = true;
    m.otraBilletera = true;
    m.d.billeteraPendiente = () => pendiente;
    m.d.alLlegarLaSesion = (f) => {
      alLlegar.push(f);
      return () => void alLlegar.splice(alLlegar.indexOf(f), 1);
    };
    conAvisoHecho();
    m.sorteado = { guardado: true, ganadoras: ["GB", "GA"] };
  });

  it("mientras la sesión se retoma no dice que es otra billetera ni llama al servicio", async () => {
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: false });
    expect(m.altas).toHaveLength(0);
  });

  it("cuando llega la sesión de Google, arranca el aviso de las ganadoras una sola vez", async () => {
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    m.otraBilletera = false;
    pendiente = false;
    for (const f of [...alLlegar]) f();
    await suelta();
    expect(m.altas).toEqual([{ sorteo: "777", ganadoras: ["GB", "GA"] }]);
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: false });
  });

  it("si la billetera que llega no es la de Google, dice la línea de avisarle a Tinkazo y no llama a nada", async () => {
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    pendiente = false;
    for (const f of [...alLlegar]) f();
    await suelta();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: true });
    expect(m.altas).toHaveLength(0);
  });

  it("si en 12 segundos no llega ninguna sesión, se da por otra billetera", async () => {
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    await m.avanzar(12_000);
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: true });
    expect(m.altas).toHaveLength(0);
  });

  it("con la sesión ya retomada, no espera nada", async () => {
    pendiente = false;
    m.otraBilletera = false;
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.altas).toEqual([{ sorteo: "777", ganadoras: ["GB", "GA"] }]);
    expect(alLlegar).toHaveLength(0);
  });
});
