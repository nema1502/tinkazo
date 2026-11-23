// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accionesDelPuente, pasoDelPuente, rechazoDelPuente, registrarAcciones } from "../campana/puente";
import type { SorteoDeCampana } from "../campana/en-curso";
import { alRevelar, caminoDelComprobante, escucharComprobante, escucharSellos, registrarLasAcciones, retomarAlArrancar } from "./campana-resultado";
import {
  CLAVE_DE_LA_SALA,
  HUELLA,
  type Mundo,
  RONDA,
  SALA,
  SALE_LA_RONDA,
  TOKEN_DE_LA_SALA,
  diferida,
  mundo,
  suelta,
  ultimoPaso,
} from "./campana-resultado-mundo";

/**
 * Avisarle a la sala de la campaña que el sorteo quedó sellado y cuál fue el resultado. Todo con una sala, un reloj y una
 * pantalla de mentira. Lo que vale es lo que no se puede romper: el aviso sale en el mismo turno en que la red confirma el
 * sello, nunca después de la ronda, y a un celular no se le dice nada que la sala no haya comprobado.
 */

let m: Mundo;
let quitar: () => void;

const sellar = (): void => void document.dispatchEvent(new CustomEvent("tinkazo:sellado"));

beforeEach(() => {
  m = mundo();
  quitar = escucharSellos(m.d);
});
afterEach(() => {
  quitar();
  m.detener();
  vi.restoreAllMocks();
});

/** La entrada del evento ya con su sorteo avisado: el estado de después de que la sala quedó sellada. */
function conAvisoHecho(cambios: Partial<SorteoDeCampana> = {}): void {
  if (!m.entrada) throw new Error("sin entrada");
  m.entrada = { ...m.entrada, sorteo: "777", ronda: RONDA, aviso: "hecho", mandados: ["777"], ...cambios };
  m.fase = "sellada";
}

describe("avisar que quedó sellada", () => {
  it("al despachar tinkazo:sellado llama a ponerSellada con el número como texto, en el mismo turno y sin avanzar el reloj", () => {
    m.respuestasAlSello = ["ok"];
    sellar();
    expect(m.pedidos).toHaveLength(1);
    expect(m.pedidos[0]?.sorteo).toBe("777");
    expect(m.pedidos[0]?.en).toBe(SALE_LA_RONDA - 90_000);
  });

  it("lo mismo con tinkazo:sello, el sello que entró tarde", () => {
    m.respuestasAlSello = ["ok"];
    document.dispatchEvent(new CustomEvent("tinkazo:sello"));
    expect(m.pedidos).toHaveLength(1);
  });

  it("con la demo o el ensayo, sin número de sorteo o sin sello, no llama a nada", () => {
    m.sinGrabar = true;
    sellar();
    m.sinGrabar = false;
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: undefined };
    sellar();
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: 777n, sinSello: true };
    sellar();
    expect(m.pedidos).toHaveLength(0);
  });

  it("sin sala de campaña, sin la lista pasada o con la sala en otra fase, no llama a nada", () => {
    m.sala = null;
    sellar();
    m.sala = SALA;
    m.entrada = null;
    sellar();
    expect(m.pedidos).toHaveLength(0);
  });

  it("con la sala ya sellada no vuelve a publicar la misma lista", () => {
    m.fase = "sellada";
    sellar();
    expect(m.pedidos).toHaveLength(0);
  });

  it("con otra lista en el cuadro que la que pasó el panel, no publica y lo dice", () => {
    if (m.sellado) m.sellado = { ...m.sellado, names: ["GA", "GC"] };
    sellar();
    expect(m.pedidos).toHaveLength(0);
    expect(pasoDelPuente()).toEqual({ paso: "otra-lista" });
  });

  it("guarda el sorteo, la ronda y los mandados antes de pedir", () => {
    m.respuestasAlSello = [() => new Promise(() => undefined)];
    sellar();
    expect(m.entrada).toMatchObject({ sorteo: "777", ronda: RONDA, aviso: "pendiente", mandados: ["777"] });
    expect(m.guardadas).toHaveLength(1);
  });

  it("con la sala diciendo que sí, la entrada pasa a hecha, la fase a sellada y el panel lo dice", async () => {
    m.respuestasAlSello = ["ok"];
    sellar();
    await suelta();
    expect(m.entrada).toMatchObject({ aviso: "hecho", sorteo: "777", duda: false });
    expect(m.fases).toEqual(["sellada"]);
    expect(pasoDelPuente()).toEqual({ paso: "avisada" });
  });

  it("con la red caída 20 segundos y la ronda a 90, el aviso llega al volver y la sala lo acepta", async () => {
    m.respuestasAlSello = [...Array.from({ length: 9 }, () => "red" as const), "ok"];
    sellar();
    await m.avanzar(30_000);
    expect(m.pedidos).toHaveLength(10);
    expect(m.entrada?.aviso).toBe("hecho");
    // Después de un fallo inmediato espera 2 segundos: no martilla la red.
    expect(m.pedidos.slice(1).map((p, i) => p.en - (m.pedidos[i]?.en ?? 0))).toEqual(Array.from({ length: 9 }, () => 2_000));
  });

  it("si la red confirma a los 70 segundos y la ronda sale a los 90, el primer pedido sale en ese mismo turno y la sala lo acepta", async () => {
    m.ahora = SALE_LA_RONDA - 20_000;
    m.respuestasAlSello = ["ok"];
    sellar();
    expect(m.pedidos).toHaveLength(1);
    await suelta();
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it("con la red caída hasta pasada la ronda, ningún pedido sale después de 5 segundos antes de la ronda", async () => {
    sellar();
    await m.avanzar(130_000);
    expect(m.pedidos.length).toBeGreaterThan(10);
    expect(Math.max(...m.pedidos.map((p) => p.en))).toBeLessThanOrEqual(SALE_LA_RONDA - 5_000);
  });

  it("con el sello llegando a menos de 5 segundos de la ronda no manda ningún aviso", async () => {
    m.ahora = SALE_LA_RONDA - 4_000;
    sellar();
    document.dispatchEvent(new CustomEvent("tinkazo:sello"));
    await m.avanzar(1_000);
    expect(m.pedidos).toHaveLength(0);
  });

  it("un pedido sin respuesta no se corta: vive hasta 25 segundos después de la ronda", () => {
    m.respuestasAlSello = [() => new Promise(() => undefined)];
    sellar();
    expect(m.pedidos[0]?.plazo).toBe(115_000);
  });

  it("con el wifi colgado sale otro pedido cada 8 segundos, sin cortar el anterior, y nunca más de tres a la vez", async () => {
    m.respuestasAlSello = Array.from({ length: 6 }, () => () => new Promise<never>(() => undefined));
    sellar();
    await m.avanzar(40_000);
    expect(m.pedidos.map((p) => p.en - (SALE_LA_RONDA - 90_000))).toEqual([0, 8_000, 16_000]);
  });

  it("un Worker que tarda 18 segundos en contestar igual entra", async () => {
    const lento = diferida<{ r: "ok"; horaSala: null }>();
    m.respuestasAlSello = [() => lento.promesa];
    sellar();
    await m.avanzar(18_000);
    lento.resolver({ r: "ok", horaSala: null });
    await suelta();
    expect(m.entrada?.aviso).toBe("hecho");
    expect(m.soltadas).toBe(0);
  });

  it("con el estado en cerrada antes del plazo no se declara tarde ni se suelta el sello: un pedido que entra después se acepta", async () => {
    const tarde = diferida<{ r: "ok"; horaSala: null }>();
    m.respuestasAlSello = [() => tarde.promesa, () => new Promise<never>(() => undefined), () => new Promise<never>(() => undefined)];
    sellar();
    await m.avanzar(90_000 + 10_000);
    expect(m.estados).toBe(0);
    expect(m.soltadas).toBe(0);
    expect(ultimoPaso(m)).toBe("comprobando");
    tarde.resolver({ r: "ok", horaSala: null });
    await suelta();
    expect(m.entrada?.aviso).toBe("hecho");
    expect(m.soltadas).toBe(0);
    expect(m.pedidos).toHaveLength(3);
  });

  it("pasado el plazo y sin pedidos en vuelo pregunta el estado: en cerrada es tarde, suelta el sello y vuelve a pasar la lista", async () => {
    const volver = vi.fn();
    registrarAcciones({ reintentarPaso: volver });
    sellar();
    await m.avanzar(90_000 + 21_000);
    expect(m.estados).toBe(0);
    await m.avanzar(2_000);
    expect(m.preguntas[0]).toBeGreaterThanOrEqual(SALE_LA_RONDA + 22_000);
    expect(pasoDelPuente()).toEqual({ paso: "tarde" });
    expect(m.soltadas).toBe(1);
    expect(volver).toHaveBeenCalledTimes(1);
    expect(rechazoDelPuente()).toEqual({ paso: "tarde" });
    expect(m.entrada?.sorteo).toBeUndefined();
    expect(m.entrada?.mandados).toEqual([]);
  });

  it("si el estado no contesta al vencer el plazo, no se toma como cerrada: se vuelve a preguntar", async () => {
    m.respuestasAlEstado = ["red", "red", "red"];
    sellar();
    await m.avanzar(90_000 + 22_000 + 1_000);
    expect(m.soltadas).toBe(0);
    await m.avanzar(16_000);
    expect(m.estados).toBe(4);
    expect(m.soltadas).toBe(1);
    expect(m.preguntas.slice(1).map((t, i) => t - (m.preguntas[i] ?? 0))).toEqual([5_000, 5_000, 5_000]);
  });

  it("si al vencer el plazo el estado dice sellada, el aviso cuenta como hecho", async () => {
    m.respuestasAlEstado = [{ fase: "sellada", total: 2, cierraMs: 0 }];
    sellar();
    await m.avanzar(90_000 + 23_000);
    expect(m.entrada?.aviso).toBe("hecho");
    expect(m.soltadas).toBe(0);
  });
});

describe("lo que dice la sala al aviso", () => {
  it("un 409 fase con la sala en sellada y un solo sorteo mandado cuenta como avisado", async () => {
    m.respuestasAlSello = ["fase"];
    m.respuestasAlEstado = [{ fase: "sellada", total: 2, cierraMs: 0 }];
    sellar();
    await suelta();
    expect(m.entrada).toMatchObject({ aviso: "hecho", duda: false });
  });

  it("con dos sorteos mandados de la misma lista, un 409 fase en sellada queda en duda: no se sabe cuál es", async () => {
    m.entrada = { ...(m.entrada as SorteoDeCampana), mandados: ["776"] };
    m.respuestasAlSello = ["fase"];
    m.respuestasAlEstado = [{ fase: "sellada", total: 2, cierraMs: 0 }];
    sellar();
    await suelta();
    expect(m.entrada).toMatchObject({ aviso: "hecho", duda: true, mandados: ["776", "777"] });
  });

  it("un 409 fase con la sala en abierta es una lista cambiada: suelta el sello", async () => {
    m.respuestasAlSello = ["fase"];
    m.respuestasAlEstado = [{ fase: "abierta", total: 2, cierraMs: 0 }];
    sellar();
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "lista-cambio" });
    expect(m.soltadas).toBe(1);
  });

  it("un 409 fase con la sala en cerrada se reintenta como un fallo de red", async () => {
    m.respuestasAlSello = ["fase", "ok"];
    m.respuestasAlEstado = [{ fase: "cerrada", total: 2, cierraMs: 0 }];
    sellar();
    await m.avanzar(3_000);
    expect(m.pedidos).toHaveLength(2);
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it("con un 409 fase y el estado sin respuesta, se reintenta como red", async () => {
    m.respuestasAlSello = ["fase", "ok"];
    m.respuestasAlEstado = ["red"];
    sellar();
    await m.avanzar(3_000);
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it.each([
    ["lista-distinta", { paso: "lista-cambio" }],
    ["ganadores-distintos", { paso: "ganadoras", n: 2 }],
    ["ronda-pasada", { paso: "tarde" }],
  ] as const)("con %s dice por qué, suelta el sello y no reintenta", async (respuesta, paso) => {
    const volver = vi.fn();
    registrarAcciones({ reintentarPaso: volver });
    m.respuestasAlSello = [respuesta];
    sellar();
    await m.avanzar(60_000);
    expect(pasoDelPuente()).toEqual(paso);
    expect(rechazoDelPuente()).toEqual(paso);
    expect(m.pedidos).toHaveLength(1);
    expect(m.soltadas).toBe(1);
    expect(volver).toHaveBeenCalledTimes(1);
    expect(m.estados).toBe(0);
  });

  it("con organizador-distinto dice con qué cuenta entrar", async () => {
    m.entrada = { ...(m.entrada as SorteoDeCampana), organizadora: "GORGANIZADORA1234" };
    m.respuestasAlSello = ["organizador-distinto"];
    sellar();
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "otra-cuenta", fin: "1234" });
    expect(m.soltadas).toBe(1);
  });

  it("si la sala ya no existe o no acepta el token, lo dice y no suelta el sello ni reintenta", async () => {
    m.respuestasAlSello = ["no-existe"];
    sellar();
    await m.avanzar(10_000);
    expect(pasoDelPuente()).toEqual({ paso: "sala-borrada" });
    expect(m.soltadas).toBe(0);
    expect(m.pedidos).toHaveLength(1);
  });

  it("si la sala ya no acepta el token porque otra compu tomó la campaña, lo dice aparte y no suelta el sello ni reintenta", async () => {
    m.respuestasAlSello = ["token"];
    sellar();
    await m.avanzar(10_000);
    expect(pasoDelPuente()).toEqual({ paso: "tomada" });
    expect(m.soltadas).toBe(0);
    expect(m.pedidos).toHaveLength(1);
  });

  it("un rechazo cuando hay un juego en marcha o la pantalla grande abierta solo muestra la línea", async () => {
    m.puedeSoltar = false;
    m.respuestasAlSello = ["ronda-pasada"];
    sellar();
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "tarde" });
    expect(m.soltadas).toBe(0);
  });

  it("después de un rechazo, el sorteo ya no cuenta como mandado y la lista se puede sellar de nuevo", async () => {
    m.respuestasAlSello = ["lista-distinta", "ok"];
    sellar();
    await suelta();
    expect(m.entrada?.mandados).toEqual([]);
    expect(m.entrada?.aviso).toBeUndefined();
    sellar();
    await suelta();
    expect(m.entrada).toMatchObject({ aviso: "hecho", sorteo: "777" });
  });
});

describe("un solo aviso por evento", () => {
  it("un sorteo nuevo que llega mientras otro sigue pendiente no se manda", () => {
    m.respuestasAlSello = [() => new Promise(() => undefined)];
    sellar();
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: 778n };
    sellar();
    expect(m.pedidos.map((p) => p.sorteo)).toEqual(["777"]);
  });

  it("si el anterior quedó sellado, el nuevo no se avisa y se dice que la sala ya tiene otro sorteo", async () => {
    const primero = diferida<{ r: "ok"; horaSala: null }>();
    m.respuestasAlSello = [() => primero.promesa];
    sellar();
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: 778n };
    sellar();
    primero.resolver({ r: "ok", horaSala: null });
    await suelta();
    expect(m.pedidos.map((p) => p.sorteo)).toEqual(["777"]);
    expect(pasoDelPuente()).toEqual({ paso: "otro-sorteo" });
  });

  it("si el anterior se rechazó, el nuevo se publica con su propia ronda", async () => {
    m.respuestasAlSello = [() => Promise.resolve({ r: "lista-distinta" as const, horaSala: null }), "ok"];
    sellar();
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: 778n };
    sellar();
    await suelta();
    expect(m.pedidos.map((p) => p.sorteo)).toEqual(["777", "778"]);
    expect(m.entrada).toMatchObject({ sorteo: "778", aviso: "hecho" });
  });

  it("si quien organiza soltó el sello de la pantalla, el aviso deja de mandar", async () => {
    m.respuestasAlSello = [() => new Promise<never>(() => undefined)];
    sellar();
    m.sellado = null;
    await m.avanzar(60_000);
    expect(m.pedidos).toHaveLength(1);
  });

  it("el botón de avisar vuelve a mirar el límite al tocarse: un toque tarde no manda nada", async () => {
    registrarLasAcciones(m.d);
    m.entrada = { ...(m.entrada as SorteoDeCampana), ronda: RONDA };
    m.ahora = SALE_LA_RONDA - 3_000;
    accionesDelPuente().avisarCelulares?.();
    await suelta();
    expect(m.pedidos).toHaveLength(0);
    expect(pasoDelPuente()).toEqual({ paso: "comprobando" });
  });
});

describe("el resultado", () => {
  const enlace = "https://tinkazo.app/verificar.html?c=1#lista";

  it("espera la promesa del comprobante, manda el comprobante sin el dominio y una sola vez", async () => {
    conAvisoHecho();
    const lista = diferida<string>();
    const revelado = alRevelar(lista.promesa, m.d);
    await suelta();
    expect(m.resultados).toHaveLength(0);
    lista.resolver(enlace);
    await revelado;
    await suelta();
    expect(m.resultados).toEqual([{ sorteo: "777", comprobante: "/verificar.html?c=1#lista", en: m.ahora }]);
    expect(m.entrada?.resultado).toBe("hecho");
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.resultados).toHaveLength(1);
  });

  it("no manda con un sorteo que no es el de la entrada, ni con un enlace que no es de verificar", async () => {
    conAvisoHecho();
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: 999n };
    await alRevelar(Promise.resolve(enlace), m.d);
    if (m.sellado) m.sellado = { ...m.sellado, raffleId: 777n };
    await alRevelar(Promise.resolve("https://drand.cloudflare.com/public/1"), m.d);
    await alRevelar(Promise.resolve(""), m.d);
    await suelta();
    expect(m.resultados).toHaveLength(0);
  });

  it("con la demo o el ensayo no manda nada", async () => {
    conAvisoHecho();
    m.sinGrabar = true;
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.resultados).toHaveLength(0);
  });

  it("con la sala diciendo que sí, la fase pasa a sorteada y las ganadoras salen de la sala", async () => {
    conAvisoHecho();
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.fases).toEqual(["sorteada"]);
    const paso = pasoDelPuente();
    expect(paso).toMatchObject({ paso: "resultado", otraBilletera: false });
    expect(paso.paso === "resultado" ? paso.filas.map((f) => [f.cuenta, f.nombre, f.avisada]) : []).toEqual([
      ["GB", "Beto", false],
      ["GA", "Ana", false],
    ]);
  });

  it("si la lectura que sigue al sí todavía dice sin-resultado, vuelve a mirar unos segundos y muestra a las ganadoras", async () => {
    conAvisoHecho();
    const leida = m.leidoDeLaSala;
    m.leidoDeLaSala = "sin-resultado";
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    // Mientras tanto no se ofrece ningún botón: todavía se está leyendo.
    expect(pasoDelPuente().paso).not.toBe("boton-resultado");
    expect(pasoDelPuente().paso).not.toBe("resultado");
    m.leidoDeLaSala = leida;
    await m.avanzar(3_000);
    expect(m.fases).toEqual(["sorteada"]);
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado" });
  });

  it("si la sala sigue sin tener el resultado después de decir que sí, recién ahí ofrece mandarlo a mano", async () => {
    conAvisoHecho();
    m.leidoDeLaSala = "sin-resultado";
    await alRevelar(Promise.resolve(enlace), m.d);
    await m.avanzar(10_000);
    expect(pasoDelPuente()).toEqual({ paso: "boton-resultado" });
  });

  it("con sin-resultado reintenta cada 10 segundos hasta 2 minutos y después ofrece mandar a mano", async () => {
    conAvisoHecho();
    m.sorteado = { guardado: true, ganadoras: null };
    m.respuestasAlResultado = Array.from({ length: 20 }, () => "sin-resultado" as const);
    await alRevelar(Promise.resolve(enlace), m.d);
    await m.avanzar(130_000);
    expect(m.resultados).toHaveLength(13);
    expect(m.resultados.slice(1).map((r, i) => r.en - (m.resultados[i]?.en ?? 0))).toEqual(Array.from({ length: 12 }, () => 10_000));
    expect(pasoDelPuente()).toEqual({ paso: "boton-resultado" });
  });

  it("si el sorteo todavía no quedó grabado, después de 2 minutos manda a guardarlo en lugar de ofrecer mandar", async () => {
    conAvisoHecho();
    m.sorteado = { guardado: false, ganadoras: null };
    m.respuestasAlResultado = Array.from({ length: 20 }, () => "sin-resultado" as const);
    await alRevelar(Promise.resolve(enlace), m.d);
    await m.avanzar(130_000);
    expect(pasoDelPuente()).toEqual({ paso: "guardar-sorteo" });
  });

  it("cuando llega el comprobante de la grabación, lo guarda y manda el resultado enseguida", async () => {
    conAvisoHecho();
    const quitarComprobante = escucharComprobante(m.d);
    m.sorteado = { guardado: false, ganadoras: null };
    m.respuestasAlResultado = ["sin-resultado", "ok"];
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.resultados).toHaveLength(1);
    document.dispatchEvent(new CustomEvent("tinkazo:comprobante", { detail: "https://tinkazo.app/verificar.html?c=1&tx=abc#lista" }));
    await suelta();
    expect(m.resultados).toHaveLength(2);
    expect(m.resultados[1]?.comprobante).toBe("/verificar.html?c=1&tx=abc#lista");
    expect(m.entrada?.resultado).toBe("hecho");
    quitarComprobante();
  });

  it("con el resultado ya hecho, un comprobante nuevo se vuelve a mandar y el mismo no", async () => {
    conAvisoHecho();
    const quitarComprobante = escucharComprobante(m.d);
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    document.dispatchEvent(new CustomEvent("tinkazo:comprobante", { detail: enlace }));
    await suelta();
    expect(m.resultados).toHaveLength(1);
    document.dispatchEvent(new CustomEvent("tinkazo:comprobante", { detail: "https://tinkazo.app/verificar.html?tx=zzz" }));
    await suelta();
    expect(m.resultados).toHaveLength(2);
    quitarComprobante();
  });

  it("si el aviso de sellada termina después de revelar, el resultado sale en ese momento", async () => {
    const lento = diferida<{ r: "ok"; horaSala: null }>();
    m.respuestasAlSello = [() => lento.promesa];
    sellar();
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.resultados).toHaveLength(0);
    m.sorteado = { guardado: true, ganadoras: ["GB", "GA"] };
    lento.resolver({ r: "ok", horaSala: null });
    await suelta();
    expect(m.resultados).toHaveLength(1);
  });

  it("si la sala quedó con otro sorteo de la misma lista, el resultado dice que se retome ese", async () => {
    conAvisoHecho({ duda: true, mandados: ["776", "777"] });
    m.respuestasAlResultado = ["fase"];
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "otro-sorteo" });
  });

  it("avisar a una ganadora llama a avisar con su cuenta y la fila pasa a avisada", async () => {
    registrarLasAcciones(m.d);
    conAvisoHecho();
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    accionesDelPuente().avisarA?.("GA");
    await suelta();
    expect(m.avisos).toEqual(["GA"]);
    const paso = pasoDelPuente();
    expect(paso.paso === "resultado" ? paso.filas.find((f) => f.cuenta === "GA")?.avisada : null).toBe(true);
    expect(paso.paso === "resultado" ? paso.filas.find((f) => f.cuenta === "GB")?.avisada : null).toBe(false);
  });

  it("si al mandar el resultado la sala ya no acepta el token, dice que la campaña sigue en otra compu", async () => {
    conAvisoHecho({ comprobante: "/verificar.html#x", resultado: "pendiente" });
    m.respuestasAlResultado = ["token"];
    retomarAlArrancar(m.d);
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "tomada" });
    expect(m.resultados).toHaveLength(1);
  });

  it("si al avisar a una ganadora la sala ya no acepta el token, dice que la campaña sigue en otra compu", async () => {
    registrarLasAcciones(m.d);
    conAvisoHecho();
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    m.respuestaAlAviso = "token";
    accionesDelPuente().avisarA?.("GA");
    await suelta();
    expect(pasoDelPuente()).toEqual({ paso: "tomada" });
  });

  it("el botón de mandar el resultado vuelve a empezar", async () => {
    registrarLasAcciones(m.d);
    conAvisoHecho({ comprobante: "/verificar.html#x", resultado: "pendiente" });
    accionesDelPuente().mandarResultado?.();
    await suelta();
    expect(m.resultados).toHaveLength(1);
  });
});

describe("las cuentas ganadoras al servicio del acceso", () => {
  const enlace = "https://tinkazo.app/verificar.html#lista";

  it("arranca solo después del sí de la sala, con las ganadoras de la sala si coinciden con las locales", async () => {
    conAvisoHecho();
    m.sorteado = { guardado: true, ganadoras: ["GB", "GA"] };
    m.respuestasAlResultado = ["sin-resultado", "ok"];
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.altas).toHaveLength(0);
    await m.avanzar(10_000);
    expect(m.altas).toEqual([{ sorteo: "777", ganadoras: ["GB", "GA"] }]);
  });

  it("con lo grabado distinto de lo calculado, no llama a nadie", async () => {
    conAvisoHecho();
    m.sorteado = { guardado: true, ganadoras: null };
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.altas).toHaveLength(0);
  });

  it("con ganadoras locales distintas de las de la sala, no llama a nadie", async () => {
    conAvisoHecho();
    m.sorteado = { guardado: true, ganadoras: ["GA", "GB"] };
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.altas).toHaveLength(0);
  });

  it("con otra billetera no llama a nadie y la línea es una sola", async () => {
    conAvisoHecho();
    m.otraBilletera = true;
    m.sorteado = { guardado: true, ganadoras: ["GB", "GA"] };
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta();
    expect(m.altas).toHaveLength(0);
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado", otraBilletera: true });
  });
});

describe("retomar al cargar la página, sin que el panel se monte", () => {
  it("con el aviso pendiente y tiempo, avisa solo con el número guardado", async () => {
    m.sellado = null;
    m.entrada = { ...(m.entrada as SorteoDeCampana), sorteo: "777", ronda: RONDA, aviso: "pendiente", mandados: ["777"] };
    m.respuestasAlSello = ["red", "ok"];
    retomarAlArrancar(m.d);
    expect(m.pedidos).toHaveLength(1);
    await m.avanzar(3_000);
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it("con el aviso pendiente y la red fallando en el primer estado, el aviso igual sale", async () => {
    m.sellado = null;
    m.respuestasAlEstado = ["red"];
    m.entrada = { ...(m.entrada as SorteoDeCampana), sorteo: "777", ronda: RONDA, aviso: "pendiente", mandados: ["777"] };
    m.respuestasAlSello = ["ok"];
    retomarAlArrancar(m.d);
    await suelta();
    expect(m.pedidos).toHaveLength(1);
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it("con el aviso pendiente y la ronda ya pasada, no manda nada y pregunta el estado cuando ya nada puede cambiar", async () => {
    m.sellado = null;
    m.ahora = SALE_LA_RONDA + 1_000;
    m.entrada = { ...(m.entrada as SorteoDeCampana), sorteo: "777", ronda: RONDA, aviso: "pendiente", mandados: ["777"] };
    m.respuestasAlEstado = [{ fase: "sellada", total: 2, cierraMs: 0 }];
    retomarAlArrancar(m.d);
    await m.avanzar(25_000);
    expect(m.pedidos).toHaveLength(0);
    expect(m.entrada?.aviso).toBe("hecho");
  });

  it("con el resultado pendiente, lo vuelve a mandar con el comprobante guardado", async () => {
    m.sellado = null;
    conAvisoHecho({ comprobante: "/verificar.html#guardado", resultado: "pendiente" });
    retomarAlArrancar(m.d);
    await suelta();
    expect(m.resultados.map((r) => r.comprobante)).toEqual(["/verificar.html#guardado"]);
  });

  it("con la sala sellada, la ronda pasada y sin comprobante, manda a retomar el sorteo desde Mis sorteos", () => {
    m.sellado = null;
    m.ahora = SALE_LA_RONDA + 60_000;
    conAvisoHecho();
    retomarAlArrancar(m.d);
    expect(pasoDelPuente()).toEqual({ paso: "sorteo-pendiente" });
  });

  it("con la sala sellada y la ronda todavía por salir, dice que los celulares ya saben", () => {
    m.sellado = null;
    conAvisoHecho();
    retomarAlArrancar(m.d);
    expect(pasoDelPuente()).toEqual({ paso: "avisada" });
  });

  it("con la sala sorteada, dibuja las ganadoras que tiene la sala", async () => {
    m.sellado = null;
    conAvisoHecho({ resultado: "hecho" });
    m.fase = "sorteada";
    retomarAlArrancar(m.d);
    await suelta();
    expect(pasoDelPuente()).toMatchObject({ paso: "resultado" });
  });

  it("sin sala de campaña, o con la demo, no hace nada", () => {
    m.sala = null;
    conAvisoHecho();
    retomarAlArrancar(m.d);
    m.sala = SALA;
    m.sinGrabar = true;
    retomarAlArrancar(m.d);
    expect(m.pedidos).toHaveLength(0);
    expect(ultimoPaso(m)).toBeUndefined();
  });
});

describe("lo que nunca sale", () => {
  it("el token de la sala y la clave de los nombres no aparecen en la consola, en lo guardado ni en lo que dibuja el panel", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    m.respuestasAlSello = ["red", "ok"];
    sellar();
    await m.avanzar(5_000);
    await alRevelar(Promise.resolve("https://tinkazo.app/verificar.html#x"), m.d);
    await suelta();
    const todo = JSON.stringify([m.guardadas, m.pasos, pasoDelPuente(), consola.map((c) => c.mock.calls)]);
    expect(todo).not.toContain(TOKEN_DE_LA_SALA);
    expect(todo).not.toContain(CLAVE_DE_LA_SALA);
  });
});

describe("el camino del comprobante", () => {
  it("toma el camino, la búsqueda y el fragmento, y solo si es de verificar", () => {
    expect(caminoDelComprobante("https://tinkazo.app/verificar.html?a=1#b")).toBe("/verificar.html?a=1#b");
    expect(caminoDelComprobante("https://tinkazo.app/otra.html")).toBeNull();
    expect(caminoDelComprobante("no es un enlace")).toBeNull();
  });
});

describe("la lista de la campaña y la huella", () => {
  it("la huella de la prueba es la de la entrada", () => {
    expect(m.entrada?.huella).toBe(HUELLA);
  });
});

describe("una sala que esta cuenta todavía no puede mover: no se calla", () => {
  /** La sala no se puede mover hasta que `listo` sea verdadero (la cuenta se completó o llegó la sesión). */
  function conLaCuentaPendiente(alCompletar?: () => void): { listo: () => boolean; completar: () => void } {
    let listo = false;
    m.d = {
      ...m.d,
      sala: () => (listo ? m.sala : null),
      sinPoderMoverLaSala: () => !listo,
      completarLaCuenta: async () => alCompletar?.(),
    };
    quitar();
    quitar = escucharSellos(m.d);
    return { listo: () => listo, completar: () => void (listo = true) };
  }

  it("el sello que llega sin la cuenta dueña dice que hay que entrar y se avisa apenas la cuenta se completa", async () => {
    const c = conLaCuentaPendiente();
    m.respuestasAlSello = ["ok"];
    sellar();
    expect(pasoDelPuente()).toEqual({ paso: "entrar-para-seguir" });
    expect(m.pedidos).toHaveLength(0);
    c.completar();
    // La memoria se completó (con la sesión): el panel retoma y el sello sale.
    retomarAlArrancar(m.d);
    expect(m.pedidos).toHaveLength(1);
    expect(pasoDelPuente().paso).toBe("avisando");
  });

  it("si completar la cuenta alcanza, el sello sale solo, sin esperar otro aviso", async () => {
    let c: { listo: () => boolean; completar: () => void } | null = null;
    c = conLaCuentaPendiente(() => c?.completar());
    m.respuestasAlSello = ["ok"];
    sellar();
    expect(pasoDelPuente()).toEqual({ paso: "entrar-para-seguir" });
    await suelta(5);
    expect(m.pedidos).toHaveLength(1);
  });

  it("si completar la cuenta alcanzó, la retomada siguiente sigue con el resultado y no se gasta en el sello ya avisado", async () => {
    let c: { listo: () => boolean; completar: () => void } | null = null;
    c = conLaCuentaPendiente(() => c?.completar());
    m.respuestasAlSello = ["ok"];
    sellar();
    await suelta(5);
    expect(m.pedidos).toHaveLength(1);
    // El aviso quedó hecho y llegó el comprobante, pero el resultado todavía no salió.
    conAvisoHecho({ resultado: "pendiente", comprobante: "https://tinkazo.app/verificar.html?c=1#lista" });
    retomarAlArrancar(m.d);
    await suelta(5);
    expect(m.resultados).toHaveLength(1);
    expect(m.pedidos).toHaveLength(1);
  });

  it("si la retomada encuentra el sello por avisar y el aviso ya estaba hecho, sigue con el resto en la misma vuelta", async () => {
    const c = conLaCuentaPendiente();
    m.respuestasAlSello = ["ok"];
    sellar();
    expect(pasoDelPuente()).toEqual({ paso: "entrar-para-seguir" });
    // Otra pestaña avisó y dejó el resultado por mandar: esta retoma sin volver a avisar y manda el resultado.
    conAvisoHecho({ resultado: "pendiente", comprobante: "https://tinkazo.app/verificar.html?c=1#lista" });
    c.completar();
    retomarAlArrancar(m.d);
    await suelta(5);
    expect(m.pedidos).toHaveLength(0);
    expect(m.resultados).toHaveLength(1);
  });

  it("sin sesión el paso queda a la vista y no sale ningún pedido", async () => {
    conLaCuentaPendiente();
    sellar();
    await suelta(5);
    expect(pasoDelPuente()).toEqual({ paso: "entrar-para-seguir" });
    expect(m.pedidos).toHaveLength(0);
  });

  it("con otra cuenta conectada, que no es la dueña, no hay nada que decir", () => {
    m.d = { ...m.d, sala: () => null, sinPoderMoverLaSala: () => false };
    quitar();
    quitar = escucharSellos(m.d);
    sellar();
    expect(pasoDelPuente()).toEqual({ paso: "nada" });
    expect(m.pedidos).toHaveLength(0);
  });

  it("el resultado que no puede salir por falta de cuenta se dice, y sale solo cuando la cuenta pueda", async () => {
    conAvisoHecho();
    const enlace = "https://tinkazo.app/verificar.html?c=1#lista";
    const c = conLaCuentaPendiente();
    await alRevelar(Promise.resolve(enlace), m.d);
    await suelta(5);
    expect(pasoDelPuente()).toEqual({ paso: "entrar-para-seguir" });
    expect(m.resultados).toHaveLength(0);
    c.completar();
    retomarAlArrancar(m.d);
    await suelta(5);
    expect(m.resultados).toHaveLength(1);
  });
});
