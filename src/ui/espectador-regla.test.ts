import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";
import { ATRASO_DEL_CELULAR_S, CUENTA_DE_LA_SALA_S, LECTURA_DE_LA_TARJETA_S, MARGEN_DE_LA_CADENA_S as MARGEN_PARA_GRABAR_S, arranqueDelShow, juegoTrasLaLlegada } from "../arranque-del-show";
import { AVISO_TARDE_MS, LANZADO_TARDE_TRAS_MS, LARGA_IGUAL_TRAS_MS, MARGEN_DEL_FINAL_MS, MARGEN_DEL_FINAL_PARTE, MARGEN_DE_LA_CADENA_S, RETRASO_TRAS_LO_GRABADO_MS, anclaDelCelular, conTarjeta, esperaTrasLoGrabadoMs, horaDeBuscarElNumero, horaDeLaTarjeta, horaDeLoQueSalioSinShow, horaDeMirarLaCadena, horaDelFinal, juegoDelCelular, reglaDelShow, segundosDelJuego } from "./espectador-regla";
import { IDA_Y_VUELTA_MAX_MS, salaALaParPorElAncla } from "../reloj-de-la-ronda";
import { salaALaPar } from "./puerta-de-la-grabacion";

/**
 * La regla de cuándo arranca el show del espectador (`espectador-regla.ts`) tiene que dejar al celular detrás de la
 * sala, nunca adelante. Esta prueba lee el código de la sala: si la sala cambia cuándo arranca o cuándo graba, falla
 * acá, y la regla se cambia en ese mismo cambio.
 */

const freeze = readFileSync(new URL("./freeze.ts", import.meta.url), "utf8");
const draw = readFileSync(new URL("./draw.ts", import.meta.url), "utf8");
const grabar = readFileSync(new URL("./grabar-sorteo.ts", import.meta.url), "utf8");

describe("cuándo arranca el show del espectador", () => {
  it("la sala ya no espera margen: busca el número apenas nace la ronda, y la cuenta del celular termina con la suya", () => {
    expect(freeze).not.toContain("CHAIN_MARGIN_SECONDS");
    expect(freeze).toContain("return Math.max(0, roundTime(app.frozen.round) - Math.floor(horaDeLaRonda()));");
    expect(reglaDelShow(true).margenS).toBe(0);
    expect(horaDeBuscarElNumero(1000, true)).toBe(roundTime(1000));
  });

  it("con el sorteo sellado, el celular mira la cadena desde que acepta el sorteo grabado", () => {
    // El mismo número que espera la grabación de la sala antes de mandar el sorteo.
    expect(MARGEN_DE_LA_CADENA_S).toBe(MARGEN_PARA_GRABAR_S);
    expect(arranqueDelShow(1000).grabable).toBe(roundTime(1000) + MARGEN_DE_LA_CADENA_S);
    expect(grabar).toContain("const falta = msHasta(arranqueDelShow(p.round).grabable, (p.ahora ?? ahoraDeLaRondaMs)());");
    expect(reglaDelShow(true).miraLaCadenaDesdeS).toBe(MARGEN_DE_LA_CADENA_S);
    expect(horaDeMirarLaCadena(1000)).toBe(roundTime(1000) + MARGEN_DE_LA_CADENA_S);
  });

  it("con el sorteo sellado, el celular espera lo grabado, que la sala manda recién con su resultado a la vista", () => {
    // En la sala, la tarjeta espera el resultado y no lo grabado. La grabación arranca después del resultado: ya, o con
    // la billetera propia al terminar el show. Lo grabado nunca existe antes de que la sala tenga su resultado.
    expect(draw).toContain(
      "const card = abrirTarjeta(juego, names.length, deAUnoPorElSello ? 1 : nWinners, orden, resultadoListo, " +
        "undefined, deAUnoPorElSello ? 1 : undefined);",
    );
    expect(draw).toMatch(/hayResultado\(terminaEn !== null \? \{ terminaEn \} : undefined\);[\s\S]*?if \(graba && !despuesDelShow\) grabando = grabarAparte\(graba, puerta\);[\s\S]*?playGame\(names, winners\.slice\(0, visibles\), beacon, finish, orden, tarjeta, /);
    expect(draw).toMatch(/const finish = \(\): void => \{\s*reveal\(names, winners, beacon, listHash\);\s*coronar\(\);\s*if \(graba && despuesDelShow\) void grabarAparte\(graba\);/);
    // Ningún otro lugar de la sala graba el sorteo. Las seis: la declaración, el reintento del botón con el sorteo ya
    // jugado, las dos de arriba, la del show que falla con el resultado fijado y la de después de proteger la cuenta.
    expect(draw.match(/grabarAparte\(/g)?.length).toBe(6);
    expect(draw).not.toContain("drawOnChain(");
    // Y el celular sí lo espera: así queda detrás de la sala.
    expect(reglaDelShow(true).esperaLoGrabado).toBe(true);
  });

  it("sin sello no hay margen ni nada que esperar: la sala juega apenas trae el número", () => {
    expect(reglaDelShow(false)).toMatchObject({ margenS: 0, miraLaCadenaDesdeS: 0, esperaLoGrabado: false });
    expect(horaDeBuscarElNumero(1000, false)).toBe(roundTime(1000));
  });

  it("visto lo grabado, el celular espera un momento más, de margen", () => {
    expect(reglaDelShow(true).retrasoTrasLoGrabadoMs).toBe(RETRASO_TRAS_LO_GRABADO_MS);
    expect(RETRASO_TRAS_LO_GRABADO_MS).toBeGreaterThanOrEqual(2_000);
    // Un par de segundos detrás del proyector, no más.
    expect(RETRASO_TRAS_LO_GRABADO_MS).toBeLessThanOrEqual(4_000);
    expect(reglaDelShow(false).retrasoTrasLoGrabadoMs).toBe(0);
  });

  it("Lo que salió nunca antes que la sala: el final del celular cae después de la cuenta y el juego de la sala", async () => {
    // `state.ts` lee la dirección al cargarse, y esta prueba corre en Node.
    vi.stubGlobal("location", { search: "" });
    const { CUENTA_SECONDS, PACES, conCuenta } = await import("../state");
    const { CARD_SECONDS } = await import("./gamecard");
    vi.unstubAllGlobals();
    // El total del ritmo incluye la tarjeta (draw.ts la descuenta del juego) y la cuenta se suma aparte. El celular la
    // cuenta siempre, aunque no la muestre (el que entra tarde): si no, su juego duraría otra cosa que el de la sala.
    expect(draw).toContain("setCardSeconds(card || extra.espectador ? CARD_SECONDS : 0);");
    for (const p of ["rapido", "normal", "epico"] as const) {
      const cuenta = conCuenta(p) ? CUENTA_SECONDS : 0;
      const delRitmo = PACES[p] + cuenta;
      // La sala, desde su resultado: la cuenta y el juego, que es el total menos la tarjeta (la leyó mientras llegaba
      // el número).
      const sala = cuenta + PACES[p] - CARD_SECONDS;
      // El celular lanza después de lo grabado, que llega después del resultado de la sala: aun lanzando en el mismo
      // instante, su final nunca cae antes.
      expect(horaDelFinal(0, delRitmo)).toBeGreaterThanOrEqual(sala * 1000);
      expect(horaDelFinal(5_000, delRitmo)).toBe(5_000 + delRitmo * 1000);
    }
  });

  it("Lo que salió espera también un margen tras el show del celular: una sala que dibuja más lento tarda más", () => {
    // Un show de 41 s que en el celular terminó a tiempo: 4,1 s más (el 10 %), no los 3 s de mínimo.
    expect(horaDelFinal(0, 41, 41_000)).toBe(41_000 + 4_100);
    // Uno corto: el mínimo.
    expect(horaDelFinal(0, 20, 20_000)).toBe(20_000 + MARGEN_DEL_FINAL_MS);
    // Medido el 16-nov sin placa de video: 56,3 s en el celular, que arrancó 2,1 s detrás, y 60,8 s en la sala.
    const sala = 60_800;
    const celular = 2_100 + 56_300;
    expect(horaDelFinal(2_100, 20, celular)).toBeGreaterThanOrEqual(sala);
    // Con el show terminado en el acto (menos movimiento), manda lo que promete el ritmo.
    expect(horaDelFinal(0, 41, 0)).toBe(41_000);
  });

  describe("cuándo lanzó la sala", () => {
    /** Los tiempos en milisegundos desde que nace el número. La cadena acepta el sorteo grabado a los 8 s. */
    const mirarDesde = MARGEN_DE_LA_CADENA_S * 1000;
    /** Traer y comprobar el número, en la sala. */
    const r = 400;
    /** Simular, mandar y cerrar el ledger hasta que lo grabado se ve, en el mejor caso. */
    const L = 1_600;
    /** Un show del ritmo normal: la tarjeta, la cuenta y el juego (`paceSeconds`). */
    const SHOW_S = 41;
    const JUEGO_MS = (SHOW_S - LECTURA_DE_LA_TARJETA_S - CUENTA_DE_LA_SALA_S) * 1000;
    /**
     * La sala que lanza en `t0`, después de que nació el número (el botón, el Reintentar de la espera, una compuerta de
     * Oficial): la tarjeta se abre al tocar, el número llega `r` después, la cuenta arranca al terminar la lectura y el
     * juego 3 s después (`draw.ts`, `abrirTarjeta` con `resultadoListo`).
     */
    const juegoDeLaSala = (t0: number): number => Math.max(t0 + LECTURA_DE_LA_TARJETA_S * 1000, t0 + r) + CUENTA_DE_LA_SALA_S * 1000;
    /**
     * El celular que ve lo grabado en `visto`: su tarjeta está leída desde que nació el número, así que después de su
     * espera cuenta 3 y juega.
     */
    const juegoDelCelular = (visto: number): number => visto + esperaTrasLoGrabadoMs(visto - mirarDesde, SHOW_S) + CUENTA_DE_LA_SALA_S * 1000;

    it("con la sala a tiempo, solo el retraso de siempre: ya va muchos segundos detrás", () => {
      // La espera en grande lanza antes del número: la sala tiene su resultado al nacer y juega a los 3,4 s. Lo grabado
      // sale recién cuando la cadena lo acepta (medido en Prueba el 16-nov: visto 5,9 s después).
      const visto = mirarDesde + 5_900;
      expect(esperaTrasLoGrabadoMs(visto - mirarDesde, SHOW_S)).toBe(RETRASO_TRAS_LO_GRABADO_MS);
      expect(juegoDelCelular(visto) - (r + CUENTA_DE_LA_SALA_S * 1000)).toBeGreaterThan(15_000);
      // Hasta el tope, lo mismo. Pasado el tope, la lectura de la tarjeta y un 10 % del show.
      expect(esperaTrasLoGrabadoMs(LANZADO_TARDE_TRAS_MS, SHOW_S)).toBe(RETRASO_TRAS_LO_GRABADO_MS);
      expect(esperaTrasLoGrabadoMs(LANZADO_TARDE_TRAS_MS + 1, SHOW_S)).toBe(RETRASO_TRAS_LO_GRABADO_MS + LECTURA_DE_LA_TARJETA_S * 1000 + SHOW_S * 1000 * MARGEN_DEL_FINAL_PARTE);
    });

    it("si la sala lanza tarde, el celular cuenta la lectura de la tarjeta desde que ve lo grabado, y un 10 % del show", () => {
      // Nace el número y quien organiza toca Lanzar el sorteo 30 s después. La sala juega a los 36,5 s.
      const t0 = 30_000;
      expect(juegoDeLaSala(t0)).toBe(t0 + 6_500);
      // La cadena ya acepta el sorteo grabado: sale con el resultado y se ve a los 32 s. El celular lo ve en el acto.
      const visto = t0 + r + L;
      expect(visto - mirarDesde).toBeGreaterThan(LANZADO_TARDE_TRAS_MS);
      // Con solo el retraso de siempre arrancaba 1 s detrás de la sala (r + L - 1 s). Ahora, al menos el retraso y el
      // 10 % del show.
      expect(visto + RETRASO_TRAS_LO_GRABADO_MS + CUENTA_DE_LA_SALA_S * 1000 - juegoDeLaSala(t0)).toBe(r + L - 1_000);
      const detras = juegoDelCelular(visto) - juegoDeLaSala(t0);
      expect(detras).toBeGreaterThanOrEqual(RETRASO_TRAS_LO_GRABADO_MS + SHOW_S * 1000 * MARGEN_DEL_FINAL_PARTE);
      // Una sala que dibuja un 10 % más lento que el celular (medido el 16-nov sin placa de video) igual corona primero.
      expect(juegoDelCelular(visto) + JUEGO_MS).toBeGreaterThan(juegoDeLaSala(t0) + JUEGO_MS * 1.1);
      // Y en el peor caso, con el número y lo grabado en el acto (r y L en cero), el celular sigue detrás.
      expect(juegoDelCelular(t0) - juegoDeLaSala(t0)).toBeGreaterThanOrEqual(RETRASO_TRAS_LO_GRABADO_MS);
    });

    it("lo que no queda cubierto: la sala que lanza poco después de que la cadena acepta grabar sigue detrás, por poco", () => {
      // Lanza a los 8 s. Lo grabado se ve antes del tope, y el celular no lo distingue de una sala que lanzó a tiempo y
      // grabó lento: arranca r + L - 1 s detrás.
      const t0 = mirarDesde;
      const visto = t0 + r + L;
      expect(visto - mirarDesde).toBeLessThanOrEqual(LANZADO_TARDE_TRAS_MS);
      expect(juegoDelCelular(visto) - juegoDeLaSala(t0)).toBe(r + L - 1_000);
      // Y quien lanza más tarde que eso queda cubierto apenas lo grabado se ve pasado el tope.
      const tarde = mirarDesde + LANZADO_TARDE_TRAS_MS - r - L + 1;
      expect(juegoDelCelular(tarde + r + L) - juegoDeLaSala(tarde)).toBeGreaterThanOrEqual(RETRASO_TRAS_LO_GRABADO_MS + SHOW_S * 1000 * MARGEN_DEL_FINAL_PARTE);
    });
  });

  it("con la cadena muda juega igual a los dos minutos, y el aviso de que la sala no lo lanzó sale antes", () => {
    expect(reglaDelShow(true).largaIgualTrasMs).toBe(LARGA_IGUAL_TRAS_MS);
    expect(LARGA_IGUAL_TRAS_MS).toBe(120_000);
    expect(AVISO_TARDE_MS).toBeLessThan(LARGA_IGUAL_TRAS_MS);
  });
});

/* ------------------------------------------------------------------------------------------------ a la par */

describe("a la par de la sala (el enlace con h)", () => {
  it("la sala lanzada desde la espera y el celular siguen la misma regla, cada uno desde la llegada de su número", () => {
    // La sala: el ancla, la tarjeta con su hora fija y el estadio a esa misma hora, y la puerta de la grabación.
    expect(draw).toContain("ancla = conAncla ? await anclaDeLaRondaUnaVez(sello.round) : null;");
    // El ancla se pide antes de la tarjeta, una sola vez por ronda: en Rápido la tarjeta sale medio segundo antes del número.
    expect(freeze).toContain("<= ANCLA_ANTES_S) void anclaDeLaRondaUnaVez(app.frozen.round);");
    expect(draw).toContain("const terminaEn = conAncla ? llegada + juegoTrasLaLlegada(conCuenta()) * 1000 : null;");
    expect(draw).toMatch(/conHora: \{ horario: \{ inicio: terminaEn \}/);
    expect(draw).toMatch(/anclaALaPar: salaALaParPorElAncla\(anclaDelSorteo, anclaVirtual\(sello\.round\)\)/);
    // La espera lanza la tarjeta a la hora de la línea de tiempo, con el reloj de la ronda.
    expect(freeze).toContain("msHasta(arranqueDelShow(app.frozen.round, conCuenta()).tarjeta, horaDeLaRonda() * 1000) === 0");
    // El celular abre la suya y juega con el mismo atraso.
    for (const c of [true, false]) {
      expect(horaDeLaTarjeta(1000, c) - arranqueDelShow(1000, c).tarjeta).toBeCloseTo(ATRASO_DEL_CELULAR_S, 6);
      expect(juegoDelCelular(0, c) / 1000 - juegoTrasLaLlegada(c)).toBeCloseTo(ATRASO_DEL_CELULAR_S, 6);
    }
  });

  it("el celular arranca entre medio segundo y dos detrás de una sala a la par, con cualquier llegada de los dos", () => {
    // La sala a la par: su número llegó con el pedido retenido y una ida y vuelta de hasta 0,6 s, así que llegó entre
    // 0,07 s (lo que tarda el servicio en enterarse) y 0,07 + 0,6 s después de nacer. El del celular, en el mismo rango.
    for (let sala = 0.07; sala <= 0.07 + IDA_Y_VUELTA_MAX_MS / 1000; sala += 0.05) {
      for (let cel = 0.07; cel <= 0.07 + IDA_Y_VUELTA_MAX_MS / 1000; cel += 0.05) {
        const juegoSala = sala + juegoTrasLaLlegada(true);
        const juegoCel = juegoDelCelular(cel * 1000, true) / 1000;
        expect(juegoCel - juegoSala).toBeGreaterThan(0.5);
        expect(juegoCel - juegoSala).toBeLessThanOrEqual(2);
      }
    }
    expect(salaALaParPorElAncla({ llegada: 0, retenido: true, idaYVuelta: 600, firma: null }, 0)).toBe(true);
    expect(salaALaParPorElAncla({ llegada: 0, retenido: true, idaYVuelta: 601, firma: null }, 0)).toBe(false);
  });

  /**
   * El sorteo, simulado de punta a punta en segundos desde que nace el número. `G` es lo que dura el juego hasta la
   * corona y `D` su momento decisivo, en el reloj del juego (los dos van con el reloj de verdad). La sala corona en su
   * juego más `G`. Lo grabado se ve `L` después de mandarlo. El celular juega `D` y retiene hasta verlo: su corona es su
   * juego más `G` más lo que estuvo retenido.
   */
  /** El ancla virtual de la sala, en ms desde que nace el número: su medida, con una ronda a horario (el servicio se entera a los 0,07 s). */
  const VIRTUAL_SALA_MS = 70;
  /** Su ancla: el pedido retenido con una ida y vuelta corta, que llegó `llegaSala` s después de que nació el número. */
  const anclaDeLaSala = (llegaSala: number): boolean => salaALaParPorElAncla({ llegada: llegaSala * 1000, retenido: true, idaYVuelta: 150, firma: null }, VIRTUAL_SALA_MS);

  function sorteo(o: { sala: "espera" | "numero-tarde" | "boton" | "nunca" | "billetera"; tSala?: number; llegaSala: number; llegaCel: number; L: number; G: number; D: number; aprobar?: number }) {
    const conCelulares = true;
    // Cuándo juega la sala, y si va a la par (`puerta-de-la-grabacion.ts`).
    let juegoSala = Infinity;
    let alaPar = false;
    if (o.sala === "espera") {
      juegoSala = o.llegaSala + juegoTrasLaLlegada(true);
      alaPar = salaALaPar({ conEspectadores: conCelulares, cambioConQr: false, anclaALaPar: anclaDeLaSala(o.llegaSala), mismoJuego: true, show: { arranco: true, tardeAlArrancar: 0, reanclado: false, atraso: 0, seEscondio: false, oculto: false, retenido: false, retenidoS: 0, coronado: false } });
    } else if (o.sala === "numero-tarde") {
      // El resultado llegó a los `tSala` s (comprobar el número tardó): la cuenta empieza tarde. Hasta 1,5 s tarde, el
      // estadio se salta ese pedazo y sigue a horario (`en-hora.ts`); con más, arranca de cero y ya no va a la par.
      const horario = o.llegaSala + juegoTrasLaLlegada(true);
      const primerCuadro = (o.tSala ?? 2) + CUENTA_DE_LA_SALA_S;
      const reanclado = primerCuadro - horario > 1.5;
      juegoSala = reanclado ? primerCuadro : horario;
      alaPar = salaALaPar({ conEspectadores: conCelulares, cambioConQr: false, anclaALaPar: anclaDeLaSala(o.llegaSala), mismoJuego: true, show: { arranco: true, tardeAlArrancar: primerCuadro - horario, reanclado, atraso: 0, seEscondio: false, oculto: false, retenido: false, retenidoS: 0, coronado: false } });
    } else if (o.sala === "boton" || o.sala === "billetera") {
      // Lanzada con un toque a los `tSala` s: tarjeta y cuenta enteras, sin ancla.
      juegoSala = (o.tSala ?? 20) + LECTURA_DE_LA_TARJETA_S + CUENTA_DE_LA_SALA_S;
      alaPar = false;
    }
    const coronaSala = juegoSala + o.G;
    // Cuándo graba: a la par, a los 8 s; si no, al coronar (la billetera, además, lo que tarde en aprobar). Nunca, si no lanza.
    const manda = o.sala === "nunca" ? Infinity : alaPar ? MARGEN_DE_LA_CADENA_S : o.sala === "billetera" ? coronaSala + (o.aprobar ?? 5) : coronaSala;
    const visto = manda + o.L;
    const juegoCel = juegoDelCelular(o.llegaCel * 1000, true) / 1000;
    const decisivoCel = juegoCel + o.D;
    const retenido = Math.max(0, visto - decisivoCel);
    return { juegoSala, coronaSala, alaPar, visto, juegoCel, coronaCel: juegoCel + o.G + retenido, retenido };
  }

  const G = 30;
  const casos = { llegaSala: [0.07, 0.4, 0.66], llegaCel: [0.07, 0.3, 1, 2.5], L: [2, 8, 13, 30], D: [5, 15, 27] };
  const barrer = (f: (x: { llegaSala: number; llegaCel: number; L: number; D: number }) => void): void => {
    for (const llegaSala of casos.llegaSala) for (const llegaCel of casos.llegaCel) for (const L of casos.L) for (const D of casos.D) f({ llegaSala, llegaCel, L, D });
  };

  it("la sala a horario: el celular arranca a la par, y corona después aunque lo grabado llegue tarde", () => {
    barrer((x) => {
      const r = sorteo({ sala: "espera", G, ...x });
      expect(r.alaPar).toBe(true);
      expect(r.juegoCel - r.juegoSala).toBeGreaterThan(0);
      if (x.llegaCel <= 0.66) expect(r.juegoCel - r.juegoSala).toBeLessThanOrEqual(2);
      expect(r.coronaCel, JSON.stringify(x)).toBeGreaterThan(r.coronaSala);
    });
  });

  it("la sala a horario con lo grabado a tiempo (lo medido: 10 a 17 s): el celular no se detiene", () => {
    for (const L of [2, 5, 9]) {
      const r = sorteo({ sala: "espera", G, D: 27, llegaSala: 0.1, llegaCel: 0.1, L });
      expect(r.retenido).toBe(0);
      expect(r.coronaCel - r.coronaSala).toBeCloseTo(ATRASO_DEL_CELULAR_S, 6);
    }
  });

  for (const [nombre, sala, tSala] of [
    ["la sala que trae el número a los 2 s", "numero-tarde", 2],
    ["la sala que trae el número a los 3,5 s", "numero-tarde", 3.5],
    ["la sala lanzada con el botón 20 s después", "boton", 20],
    ["la sala lanzada con el botón 60 s después", "boton", 60],
    ["la billetera propia, que lanza con el toque y graba al final", "billetera", 4],
  ] as const) {
    it(`${nombre}: el celular se detiene en su momento decisivo y corona después de la sala`, () => {
      barrer((x) => {
        const r = sorteo({ sala, tSala, G, ...x });
        expect(r.coronaCel, `${nombre} ${JSON.stringify(x)}`).toBeGreaterThan(r.coronaSala);
        // Lo grabado nunca suelta el final antes de que la sala corone, salvo que vaya a la par.
        if (!r.alaPar) expect(r.visto).toBeGreaterThan(r.coronaSala);
      });
    });
  }

  it("el número que llega tarde al servicio que retiene: la sala no se da a la par y el celular corona después", () => {
    // La ronda llega al servicio 1,8 s tarde. El pedido de la sala esperó (retenido) y su ida y vuelta fue corta, pero su
    // número llegó 1,8 s después de su hora. El celular toma su ancla virtual, a horario, y juega delante de ella.
    for (const L of casos.L) {
      for (const D of casos.D) {
        const r = sorteo({ sala: "espera", G, llegaSala: 1.87, llegaCel: 0.07, L, D });
        expect(r.juegoCel).toBeLessThan(r.juegoSala);
        expect(r.alaPar).toBe(false);
        expect(r.coronaCel, JSON.stringify({ L, D })).toBeGreaterThan(r.coronaSala);
      }
    }
  });

  it("la sala que no lanza nunca: el celular no corona (retiene hasta ver lo grabado)", () => {
    barrer((x) => {
      const r = sorteo({ sala: "nunca", G, ...x });
      expect(r.coronaCel).toBe(Infinity);
    });
  });

  it("el que llega tarde toma la llegada más temprana que tiene; ninguna es antes de que nazca el número", () => {
    expect(anclaDelCelular(500, null, 300, undefined)).toBe(300);
    expect(anclaDelCelular(null, undefined)).toBeNull();
    // Sin tarjeta si no entra la cuenta y la lectura más corta.
    expect(conTarjeta(4_600, true)).toBe(true);
    expect(conTarjeta(4_400, true)).toBe(false);
    expect(conTarjeta(1_600, false)).toBe(true);
    expect(conTarjeta(-3_000, false)).toBe(false);
  });

  it("sin show en el celular, Lo que salió no sale antes de lo grabado ni del final del juego", () => {
    const juego = segundosDelJuego(41, true);
    expect(juego).toBeCloseTo(41 - LECTURA_DE_LA_TARJETA_S - CUENTA_DE_LA_SALA_S, 6);
    // Sin lo grabado, no sale.
    expect(horaDeLoQueSalioSinShow(5_600, juego, null)).toBeNull();
    // A la par: lo grabado llega a mitad del juego, y manda el final del juego más un segundo.
    expect(horaDeLoQueSalioSinShow(5_600, juego, 16_000)).toBe(5_600 + juego * 1000 + 1_000);
    // La sala tardía: lo grabado llega después de su corona, y manda eso.
    expect(horaDeLoQueSalioSinShow(5_600, juego, 90_000)).toBe(90_000);
  });
});
