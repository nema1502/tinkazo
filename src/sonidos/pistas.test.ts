import { afterEach, describe, expect, it, vi } from "vitest";
import { bufferFalso, ContextoFalso, type FuenteFalsa, type ParamFalso } from "./audio-falso";
import { buffersAlcanzan, leerPista, Reproductor, type Buffers, type Pista } from "./pistas";

/**
 * El reproductor de pistas por secciones, con un contexto de audio de mentira: cada pedido del show hace lo que tiene
 * que hacer y en la hora que tiene que hacerlo. La pista de prueba va a un compás por segundo (120 negras en 2/4), así
 * los bordes de compás son números redondos desde el primer tiempo del cuerpo.
 */

const JSON_DE_PRUEBA = {
  formato: 1,
  juego: "race",
  version: "m0",
  pulso: { bpm: 120, tiempos: 2, compas: 1 },
  ganancia: 0.5,
  secciones: {
    entrada: { archivo: "race-m0-entrada.mp3", inicio: 0, compases: 7 },
    cuerpo: { archivo: "race-m0-cuerpo.mp3", inicio: 0.5, compases: 32 },
    subida: { archivo: "race-m0-subida.mp3", inicio: 0.5, compases: 14, bucleDesde: 10, tension: 0.75 },
    golpe: { archivo: "race-m0-golpe.mp3", inicio: 0.05, compases: 2 },
    festejo: { archivo: "race-m0-festejo.mp3", inicio: 0.1, salida: 1.5 },
  },
};

const BUFFERS: Buffers = {
  entrada: bufferFalso(7.5),
  cuerpo: bufferFalso(33),
  subida: bufferFalso(15),
  golpe: bufferFalso(2.4),
  festejo: bufferFalso(4),
};

const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function pista(cambios: (j: typeof JSON_DE_PRUEBA & Record<string, unknown>) => void = () => undefined): Pista {
  const j = copia(JSON_DE_PRUEBA) as typeof JSON_DE_PRUEBA & Record<string, unknown>;
  cambios(j);
  const p = leerPista(j, "race");
  if (!p) throw new Error("la pista de prueba no se leyó");
  return p;
}

function armar(p: Pista = pista(), buffers: Buffers = BUFFERS): { ctx: ContextoFalso; r: Reproductor } {
  const ctx = new ContextoFalso();
  const r = new Reproductor(ctx.comoContexto, ctx.destination as unknown as AudioNode, p, buffers);
  return { ctx, r };
}

const una = (ctx: ContextoFalso, seccion: string): FuenteFalsa => {
  const fs = ctx.dePista(seccion);
  expect(fs).toHaveLength(1);
  return fs[0] as FuenteFalsa;
};

/** El primer tiempo del cuerpo cuando la entrada arranca en 0: 0,06 s de adelanto más siete compases. */
const T_CUERPO = 7.06;

afterEach(() => vi.restoreAllMocks());

describe("el formato de la pista", () => {
  it("lee la pista de prueba y le pone los valores por defecto", () => {
    const p = pista();
    expect(p.compas).toBe(1);
    expect(p.tiempos).toBe(2);
    expect(p.retomarEn).toBe("compas");
    expect(p.sorpresas).toBe(true);
    expect(p.secciones.cuerpo.bucleDesde).toBe(0);
    expect(p.secciones.subida?.bucleDesde).toBe(10);
    expect(p.secciones.entrada?.bucleDesde).toBeNull();
    // El golpe casi seco; las demás con el fundido de la pista.
    expect(p.secciones.golpe.fundido).toBe(0.005);
    expect(p.secciones.cuerpo.fundido).toBe(0.03);
    expect(p.secciones.festejo?.salida).toBe(1.5);
  });

  it.each([
    ["sin cuerpo", (j: Record<string, any>) => delete j.secciones.cuerpo],
    ["sin golpe", (j: Record<string, any>) => delete j.secciones.golpe],
    ["un archivo con ruta", (j: Record<string, any>) => (j.secciones.cuerpo.archivo = "../race.mp3")],
    ["un archivo con mayúsculas", (j: Record<string, any>) => (j.secciones.cuerpo.archivo = "Race-cuerpo.mp3")],
    ["un archivo que no es mp3", (j: Record<string, any>) => (j.secciones.cuerpo.archivo = "race-cuerpo.wav")],
    ["un nombre de más de 32", (j: Record<string, any>) => (j.secciones.cuerpo.archivo = `${"a".repeat(33)}.mp3`)],
    ["un bucle que empieza al final", (j: Record<string, any>) => (j.secciones.subida.bucleDesde = 14)],
    ["una entrada que se repite", (j: Record<string, any>) => (j.secciones.entrada.bucleDesde = 0)],
    ["una entrada sin compases", (j: Record<string, any>) => delete j.secciones.entrada.compases],
    ["un golpe sin compases con festejo", (j: Record<string, any>) => delete j.secciones.golpe.compases],
    ["un pulso fuera de rango", (j: Record<string, any>) => (j.pulso.bpm = 400)],
    ["un compás que no es el del pulso", (j: Record<string, any>) => (j.pulso.compas = 1.2)],
    ["una sección que no existe", (j: Record<string, any>) => (j.secciones.puente = { archivo: "a.mp3", inicio: 0 })],
    ["otro formato", (j: Record<string, any>) => (j.formato = 2)],
    ["una versión rara", (j: Record<string, any>) => (j.version = "v 1")],
    ["un retomar que no existe", (j: Record<string, any>) => (j.retomarEn = "frase")],
    ["una tensión fuera de rango", (j: Record<string, any>) => (j.secciones.subida.tension = 2)],
  ])("rechaza %s", (_, cambio) => {
    const j = copia(JSON_DE_PRUEBA) as Record<string, any>;
    cambio(j);
    expect(leerPista(j, "race")).toBeNull();
  });

  it("rechaza la pista de otro juego", () => {
    expect(leerPista(copia(JSON_DE_PRUEBA), "sapo")).toBeNull();
  });

  it("acota el volumen: la ganancia de la pista por la de una sección no pasa de 1,5", () => {
    // La salida no tiene compresor: un 2 en lugar de un 0,2 saturaría la pantalla grande.
    const con = (pistaG: number, seccionG: number): unknown => {
      const j = copia(JSON_DE_PRUEBA) as Record<string, any>;
      j.ganancia = pistaG;
      j.secciones.golpe.ganancia = seccionG;
      return leerPista(j, "race");
    };
    expect(con(0.5, 3)).not.toBeNull();
    expect(con(1, 1.5)).not.toBeNull();
    expect(con(0.4, 1)).not.toBeNull();
    expect(con(0.5, 3.01)).toBeNull();
    expect(con(1, 2)).toBeNull();
    expect(con(2, 4)).toBeNull();
  });

  it("comprueba que los archivos alcancen, con cola después de cada bucle", () => {
    const p = pista();
    expect(buffersAlcanzan(p, BUFFERS)).toBe(true);
    // El cuerpo termina en 0,5 + 32: sin 20 ms de cola, un decodificador que corre el audio deja el empalme afuera.
    expect(buffersAlcanzan(p, { ...BUFFERS, cuerpo: bufferFalso(32.51) })).toBe(false);
    expect(buffersAlcanzan(p, { ...BUFFERS, festejo: undefined })).toBe(false);
    expect(buffersAlcanzan(p, { ...BUFFERS, entrada: bufferFalso(6.5) })).toBe(false);
  });
});

describe("arrancar", () => {
  it("toca la entrada y deja el cuerpo enganchado en el compás en que termina", () => {
    const { ctx, r } = armar();
    r.arrancar();
    expect(r.suena()).toBe(true);
    const entrada = una(ctx, "entrada");
    expect(entrada.inicio?.cuando).toBeCloseTo(0.06, 6);
    expect(entrada.inicio?.desde).toBe(0);
    const cuerpo = una(ctx, "cuerpo");
    // El fundido de 30 ms termina justo en el primer tiempo: la fuente arranca 30 ms antes, desde 30 ms antes de su inicio.
    expect(cuerpo.inicio?.cuando).toBeCloseTo(T_CUERPO - 0.03, 6);
    expect(cuerpo.inicio?.desde).toBeCloseTo(0.47, 6);
    expect(ctx.nivel(cuerpo, T_CUERPO)).toBeCloseTo(1, 6);
    expect(ctx.nivel(entrada, T_CUERPO)).toBeCloseTo(0, 6);
    // En el medio del fundido, las dos suman uno.
    const t = T_CUERPO - 0.015;
    expect(ctx.nivel(cuerpo, t) + ctx.nivel(entrada, t)).toBeCloseTo(1, 6);
    expect(entrada.parada).not.toBeNull();
  });

  it("el cuerpo se repite sin costura: un bucle de compases enteros, dentro del archivo y sin hora de parar", () => {
    const { ctx, r } = armar();
    r.arrancar();
    const cuerpo = una(ctx, "cuerpo");
    expect(cuerpo.loop).toBe(true);
    expect(cuerpo.loopStart).toBeCloseTo(0.5, 6);
    expect(cuerpo.loopEnd - cuerpo.loopStart).toBeCloseTo(32, 6);
    expect(cuerpo.loopEnd).toBeLessThanOrEqual((BUFFERS.cuerpo as AudioBuffer).duration);
    expect(cuerpo.parada).toBeNull();
  });

  it("sin entrada, arranca por el cuerpo", () => {
    const { ctx, r } = armar(pista((j) => delete (j.secciones as Record<string, unknown>).entrada));
    r.arrancar();
    expect(ctx.dePista("entrada")).toHaveLength(0);
    expect(una(ctx, "cuerpo").inicio?.cuando).toBeCloseTo(0.03, 6);
  });

  it("todas sus fuentes son música, con su sección, para los auditores", () => {
    const { ctx, r } = armar();
    r.arrancar();
    for (const f of ctx.dePista()) {
      expect(f.__musica).toBe(true);
      expect(f.__pista).toMatch(/^race\/(entrada|cuerpo)$/);
    }
  });
});

describe("la tensión", () => {
  it("la subida entra en el próximo borde de compás del cuerpo", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 20.3;
    r.tension(0.8, 0.6);
    const subida = una(ctx, "subida");
    const B = (subida.inicio?.cuando ?? 0) + 0.03;
    // Un número entero de compases desde el primer tiempo del cuerpo, y el primero en que todavía entra el fundido.
    expect(B - T_CUERPO).toBeCloseTo(Math.round(B - T_CUERPO), 6);
    expect(B).toBeCloseTo(21.06, 6);
    expect(subida.inicio?.desde).toBeCloseTo(0.47, 6);
    // Sus últimos cuatro compases se repiten.
    expect(subida.loopStart).toBeCloseTo(10.5, 6);
    expect(subida.loopEnd).toBeCloseTo(14.5, 6);
    const cuerpo = una(ctx, "cuerpo");
    expect(ctx.nivel(cuerpo, B)).toBeCloseTo(0, 6);
    expect(ctx.nivel(cuerpo, 21)).toBeGreaterThan(0.9);
    expect(ctx.nivel(subida, B)).toBeCloseTo(1, 6);
  });

  it("con cuantizar 4, entra en el borde de cuatro compases", () => {
    const { ctx, r } = armar(pista((j) => ((j.secciones.subida as Record<string, unknown>).cuantizar = 4)));
    r.arrancar();
    ctx.currentTime = 20.3;
    r.tension(0.8, 0.6);
    expect((una(ctx, "subida").inicio?.cuando ?? 0) + 0.03).toBeCloseTo(T_CUERPO + 16, 6);
  });

  it("debajo de su tensión no entra, y pedida dos veces no se arma dos veces", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 12;
    r.tension(0.6, 0.5);
    expect(ctx.dePista("subida")).toHaveLength(0);
    r.tension(0.9, 0.8);
    r.tension(0.95, 0.9);
    expect(ctx.dePista("subida")).toHaveLength(1);
  });

  it("pedida en la entrada, va en lugar del cuerpo al terminar la entrada", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 3;
    r.tension(0.8, 0.6);
    const cuerpo = una(ctx, "cuerpo");
    // El cuerpo programado no llega a sonar nunca.
    expect(cuerpo.parada).not.toBeNull();
    expect(cuerpo.parada ?? 0).toBeLessThanOrEqual(3);
    const subida = una(ctx, "subida");
    expect((subida.inicio?.cuando ?? 0) + 0.03).toBeCloseTo(T_CUERPO, 6);
  });

  it("una sorpresa calla la música ya y la devuelve en el tiempo que cae un tiempo después", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 10.3;
    r.tension(0.5, 0.1);
    const cuerpo = una(ctx, "cuerpo");
    expect(ctx.nivel(cuerpo, 10.34)).toBeCloseTo(0, 6);
    // Un tiempo dura 0,5 s: el primero desde 10,8 en la grilla del cuerpo es 11,06.
    expect(ctx.nivel(cuerpo, 11.0)).toBeCloseTo(0, 6);
    expect(ctx.nivel(cuerpo, 11.06)).toBeCloseTo(1, 6);
    expect(ctx.dePista("subida")).toHaveLength(0);
  });

  it("sin sorpresas, un salto de tensión no calla nada", () => {
    const { ctx, r } = armar(pista((j) => (j.sorpresas = false)));
    r.arrancar();
    ctx.currentTime = 10.3;
    r.tension(0.5, 0.1);
    expect(ctx.nivel(una(ctx, "cuerpo"), 10.6)).toBeCloseTo(1, 6);
  });
});

describe("la música retenida", () => {
  it("se corta en seco y vuelve ya, en el uno del compás siguiente", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 12.37;
    r.retener(true);
    const cuerpo = una(ctx, "cuerpo");
    expect(ctx.nivel(cuerpo, 12.37)).toBeGreaterThan(0.9);
    expect(ctx.nivel(cuerpo, 12.395)).toBeCloseTo(0, 6);
    expect(cuerpo.parada ?? 99).toBeLessThan(12.42);
    expect(r.suena()).toBe(true);
    ctx.currentTime = 14;
    r.retener(false);
    const vuelta = ctx.dePista("cuerpo")[1] as FuenteFalsa;
    // Iba en el compás 5,31 del cuerpo: vuelve en el 6, ya (30 ms), con 10 ms de fundido que terminan en el uno.
    expect(vuelta.inicio?.cuando).toBeCloseTo(14.02, 6);
    expect(vuelta.inicio?.desde).toBeCloseTo(0.5 + 6 - 0.01, 6);
    expect(ctx.nivel(vuelta, 14.03)).toBeCloseTo(1, 6);
    expect(vuelta.loop).toBe(true);
  });

  it("con retomar en el tiempo, vuelve en el tiempo siguiente", () => {
    const { ctx, r } = armar(pista((j) => (j.retomarEn = "tiempo")));
    r.arrancar();
    ctx.currentTime = 12.37;
    r.retener(true);
    ctx.currentTime = 14;
    r.retener(false);
    expect((ctx.dePista("cuerpo")[1] as FuenteFalsa).inicio?.desde).toBeCloseTo(0.5 + 5.5 - 0.01, 6);
  });

  it("retenida al final de la entrada, vuelve en el primer tiempo del cuerpo", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 6.9;
    r.retener(true);
    ctx.currentTime = 9;
    r.retener(false);
    const vuelta = ctx.dePista("cuerpo").filter((f) => (f.inicio?.cuando ?? 0) > 8);
    expect(vuelta).toHaveLength(1);
    // Al soltar, el fundido es de 10 ms: arranca 10 ms antes del primer tiempo.
    expect(vuelta[0]?.inicio?.desde).toBeCloseTo(0.49, 6);
  });

  it("retenida en medio de la entrada, la retoma y le vuelve a enganchar el cuerpo", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 2.5;
    r.retener(true);
    ctx.currentTime = 4;
    r.retener(false);
    const entrada = ctx.dePista("entrada")[1] as FuenteFalsa;
    // Iba en el compás 2,44: vuelve en el 3, y el cuerpo entra cuatro compases después.
    expect(entrada.inicio?.desde).toBeCloseTo(3 - 0.01, 6);
    const cuerpo = ctx.dePista("cuerpo").filter((f) => f.parada === null);
    expect(cuerpo).toHaveLength(1);
    expect((cuerpo[0]?.inicio?.cuando ?? 0) + 0.03).toBeCloseTo(4.03 + 4, 6);
  });

  it("si la tensión pidió la subida mientras estaba callada, vuelve con la subida", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 15;
    r.retener(true);
    r.tension(0.9, 0.5);
    expect(ctx.dePista("subida")).toHaveLength(0);
    ctx.currentTime = 16;
    r.retener(false);
    expect(una(ctx, "subida").inicio?.desde).toBeCloseTo(0.49, 6);
  });

  it("retener dos veces o soltar sin retener no hace nada", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 10;
    r.retener(false);
    expect(ctx.dePista()).toHaveLength(2);
    r.retener(true);
    r.retener(true);
    ctx.currentTime = 11;
    r.retener(false);
    expect(ctx.dePista()).toHaveLength(3);
  });
});

describe("el remate", () => {
  it("el golpe suena en el instante y el festejo entra en el compás en que termina el golpe", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 30;
    expect(r.rematar()).toBe(true);
    const golpe = una(ctx, "golpe");
    expect(golpe.inicio?.cuando).toBeCloseTo(30.015, 6);
    expect(golpe.inicio?.desde).toBeCloseTo(0.045, 6);
    expect(ctx.nivel(golpe, 30.02)).toBeCloseTo(1, 6);
    expect(ctx.nivel(una(ctx, "cuerpo"), 30.03)).toBeCloseTo(0, 6);
    const festejo = una(ctx, "festejo");
    expect((festejo.inicio?.cuando ?? 0) + 0.03).toBeCloseTo(32.02, 6);
    expect(festejo.loop).toBe(false);
    // Una sola vez: pedirlo otra vez (la fanfarria después del relator) no arma nada.
    expect(r.rematar()).toBe(true);
    expect(ctx.dePista("golpe")).toHaveLength(1);
  });

  it("después del silencio de antes del golpe, el golpe suena igual", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 29.6;
    r.retener(true);
    ctx.currentTime = 30;
    expect(r.rematar()).toBe(true);
    expect(una(ctx, "golpe").inicio?.cuando).toBeCloseTo(30.015, 6);
    // Ni la tensión ni soltar la música cambian nada después del golpe.
    r.retener(false);
    r.tension(0.9, 0.2);
    expect(ctx.dePista("cuerpo")).toHaveLength(1);
    expect(ctx.dePista("subida")).toHaveLength(0);
  });

  it("sin festejo, el golpe suena hasta el final de su archivo", () => {
    const { ctx, r } = armar(pista((j) => {
      delete (j.secciones as Record<string, unknown>).festejo;
      delete (j.secciones.golpe as Record<string, unknown>).compases;
    }));
    r.arrancar();
    ctx.currentTime = 30;
    r.rematar();
    expect(una(ctx, "golpe").parada).toBeNull();
  });
});

describe("parar", () => {
  it("en el festejo, se apaga con su salida", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 30;
    r.rematar();
    ctx.currentTime = 33;
    r.parar(false);
    const festejo = una(ctx, "festejo");
    expect(ctx.nivel(festejo, 33.75)).toBeCloseTo(0.5, 2);
    expect(ctx.nivel(festejo, 34.5)).toBeCloseTo(0, 6);
    expect(r.suena()).toBe(false);
  });

  it("si el show se cierra antes de que entre el festejo, la cola del golpe no se corta en seco", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 30;
    r.rematar();
    ctx.currentTime = 31;
    r.parar(false);
    const golpe = una(ctx, "golpe");
    // Iba a apagarse en 32,02 para dejarle lugar al festejo; ahora se apaga en su salida, hasta el final del archivo.
    expect(ctx.nivel(golpe, 32.1)).toBeGreaterThan(0.1);
    expect(ctx.nivel(golpe, 32.37)).toBeCloseTo(0, 6);
    expect(ctx.nivel(una(ctx, "festejo"), 32.1)).toBe(0);
  });

  it("con el sonido apagado, en 0,35 s aunque esté en el festejo", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 30;
    r.rematar();
    ctx.currentTime = 33;
    r.parar(true);
    expect(ctx.nivel(una(ctx, "festejo"), 33.35)).toBeCloseTo(0, 6);
  });

  it("en medio del juego baja en 0,35 s, tira lo programado y suelta todo del grafo", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 3;
    r.parar(false);
    const entrada = una(ctx, "entrada");
    expect(ctx.nivel(entrada, 3.35)).toBeCloseTo(0, 6);
    expect(ctx.nivel(una(ctx, "cuerpo"), T_CUERPO)).toBe(0);
    expect(r.fuentesVivas()).toBe(1);
    ctx.currentTime = 4;
    ctx.terminar();
    expect(r.fuentesVivas()).toBe(0);
    for (const f of ctx.dePista()) {
      expect(f.desconectado).toBe(true);
      expect((f.conectado[0] as { desconectado: boolean }).desconectado).toBe(true);
    }
    // La salida de la pista también se suelta.
    const salida = ctx.nodos.filter((n) => n.tipo === "ganancia" && n.conectado.includes(ctx.destination));
    expect(salida.length).toBe(1);
    expect(salida[0]?.desconectado).toBe(true);
  });
});

describe("un navegador que no recorta el silencio del codificador", () => {
  // El audio cayó 25 ms más tarde que lo escrito en el JSON: todos los puntos de la sección se corren lo mismo.
  const K = 0.025;

  it("el primer tiempo de cada sección cae en su inicio más el corrimiento, y el bucle toma el final de su último compás", () => {
    const ctx = new ContextoFalso();
    const r = new Reproductor(ctx.comoContexto, ctx.destination as unknown as AudioNode, pista(), BUFFERS, () => undefined, { entrada: K, cuerpo: K, subida: K, golpe: K, festejo: K });
    r.arrancar();
    expect(una(ctx, "entrada").inicio?.desde).toBeCloseTo(K, 6);
    const cuerpo = una(ctx, "cuerpo");
    expect(cuerpo.loopStart).toBeCloseTo(0.5 + K, 6);
    expect(cuerpo.loopEnd).toBeCloseTo(0.5 + K + 32, 6);
    // Entra 30 ms antes de su primer tiempo, desde 30 ms antes del punto corrido.
    expect(cuerpo.inicio?.desde).toBeCloseTo(0.5 + K - 0.03, 6);
    ctx.currentTime = 12;
    r.tension(0.9, 0.5);
    const subida = una(ctx, "subida");
    expect(subida.loopStart).toBeCloseTo(0.5 + K + 10, 6);
    expect(subida.loopEnd).toBeCloseTo(0.5 + K + 14, 6);
    ctx.currentTime = 30;
    r.rematar();
    expect(una(ctx, "golpe").inicio?.desde).toBeCloseTo(0.05 + K - 0.005, 6);
    expect(una(ctx, "festejo").inicio?.desde).toBeCloseTo(0.1 + K - 0.03, 6);
  });

  it("sin corrimiento (Chrome y Firefox) todo queda exactamente como estaba", () => {
    const ctx = new ContextoFalso();
    const r = new Reproductor(ctx.comoContexto, ctx.destination as unknown as AudioNode, pista(), BUFFERS, () => undefined, {});
    r.arrancar();
    expect(una(ctx, "entrada").inicio?.desde).toBe(0);
    expect(una(ctx, "cuerpo").loopStart).toBeCloseTo(0.5, 6);
    expect(una(ctx, "cuerpo").loopEnd).toBeCloseTo(32.5, 6);
  });

  it("los archivos alcanzan contando el corrimiento: la cola después del bucle tiene que seguir cabiendo", () => {
    const p = pista();
    // El cuerpo termina en 0,5 + 32 y pide 20 ms de cola: con 25 ms de corrimiento hacen falta 32,545.
    const corto = { ...BUFFERS, cuerpo: bufferFalso(32.53) };
    expect(buffersAlcanzan(p, corto)).toBe(true);
    expect(buffersAlcanzan(p, corto, { cuerpo: K })).toBe(false);
    expect(buffersAlcanzan(p, { ...BUFFERS, cuerpo: bufferFalso(32.55) }, { cuerpo: K })).toBe(true);
    // Una sección sin compases (el festejo) pide 50 ms de audio desde su inicio, y el inicio corrido cuenta.
    expect(buffersAlcanzan(p, { ...BUFFERS, festejo: bufferFalso(0.16) })).toBe(true);
    expect(buffersAlcanzan(p, { ...BUFFERS, festejo: bufferFalso(0.16) }, { festejo: K })).toBe(false);
  });
});

describe("callar", () => {
  it("calla en 0,1 s la cola de un festejo que ya se estaba apagando con su propia salida", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 30;
    r.rematar();
    ctx.currentTime = 33;
    r.parar(false);
    const festejo = una(ctx, "festejo");
    ctx.currentTime = 33.2;
    // Su salida dura hasta 34,5: a los 33,2 todavía suena bastante.
    const antes = ctx.nivelFinal(festejo, 33.2);
    expect(antes).toBeGreaterThan(0.3);
    r.callar();
    expect(ctx.nivelFinal(festejo, 33.25)).toBeLessThan(antes * 0.6);
    expect(ctx.nivelFinal(festejo, 33.3)).toBeCloseTo(0, 6);
    expect(festejo.parada).toBeLessThanOrEqual(33.32 + 1e-9);
    expect(r.suena()).toBe(false);
  });

  it("calla en medio del juego y tira lo que estaba programado", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 3;
    r.callar();
    expect(ctx.nivelFinal(una(ctx, "entrada"), 3.1)).toBeCloseTo(0, 6);
    expect(ctx.nivelFinal(una(ctx, "cuerpo"), T_CUERPO)).toBe(0);
    expect(r.suena()).toBe(false);
  });

  it("pedirlo otra vez no programa nada de nuevo, y al terminar las fuentes la pista se suelta del grafo", () => {
    const { ctx, r } = armar();
    r.arrancar();
    ctx.currentTime = 30;
    r.rematar();
    ctx.currentTime = 33;
    r.parar(false);
    ctx.currentTime = 33.2;
    r.callar();
    const salida = ctx.salidaDe(una(ctx, "festejo"));
    const eventos = JSON.stringify((salida?.gain as ParamFalso).ev);
    ctx.currentTime = 33.25;
    r.callar();
    expect(JSON.stringify((salida?.gain as ParamFalso).ev)).toBe(eventos);
    ctx.currentTime = 34;
    ctx.terminar();
    expect(r.fuentesVivas()).toBe(0);
    expect(salida?.desconectado).toBe(true);
  });
});

describe("le pide poco al equipo", () => {
  it("nunca suenan más de dos fuentes a la vez, en un sorteo con todos los pedidos", () => {
    const { ctx, r } = armar();
    const pedidos: [number, () => void][] = [
      [0, () => r.arrancar()],
      [2, () => r.tension(0.3, 0.2)],
      [10.3, () => r.tension(0.6, 0.2)],
      [14.2, () => r.retener(true)],
      [16.4, () => r.retener(false)],
      [25.5, () => r.tension(0.85, 0.6)],
      [33.1, () => r.retener(true)],
      [33.5, () => r.rematar()],
      [38, () => r.parar(false)],
    ];
    let maximo = 0;
    for (let t = 0; t <= 42; t = Math.round((t + 0.005) * 1000) / 1000) {
      ctx.currentTime = t;
      for (const [cuando, fn] of pedidos) if (Math.abs(cuando - t) < 0.0025) fn();
      ctx.terminar();
      maximo = Math.max(maximo, ctx.dePista().filter((f) => ctx.nivel(f, t) > 0.001).length);
    }
    expect(maximo).toBeLessThanOrEqual(2);
    // Al final no queda nada en el grafo.
    expect(r.fuentesVivas()).toBe(0);
    expect(ctx.dePista().length).toBeLessThan(12);
  });

  it("no usa el azar ni el reloj de la página: la misma ronda arma exactamente lo mismo", () => {
    const azar = vi.spyOn(Math, "random");
    const ahora = vi.spyOn(performance, "now");
    const fecha = vi.spyOn(Date, "now");
    const correr = (): string => {
      const { ctx, r } = armar();
      r.arrancar();
      ctx.currentTime = 12.37;
      r.tension(0.8, 0.4);
      ctx.currentTime = 15;
      r.retener(true);
      ctx.currentTime = 16;
      r.retener(false);
      ctx.currentTime = 30;
      r.rematar();
      return JSON.stringify(ctx.dePista().map((f) => [f.__pista, f.inicio, f.parada, f.loopStart, f.loopEnd, (f.conectado[0] as { gain: ParamFalso }).gain.ev]));
    };
    expect(correr()).toBe(correr());
    expect(azar).not.toHaveBeenCalled();
    expect(ahora).not.toHaveBeenCalled();
    expect(fecha).not.toHaveBeenCalled();
  });
});
