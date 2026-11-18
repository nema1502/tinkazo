import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";
import { CUENTA_DE_LA_SALA_S, LECTURA_DE_LA_TARJETA_S, MARGEN_DE_LA_CADENA_S as MARGEN_PARA_GRABAR_S, arranqueDelShow } from "../arranque-del-show";
import { AVISO_TARDE_MS, LANZADO_TARDE_TRAS_MS, LARGA_IGUAL_TRAS_MS, MARGEN_DEL_FINAL_MS, MARGEN_DEL_FINAL_PARTE, MARGEN_DE_LA_CADENA_S, RETRASO_TRAS_LO_GRABADO_MS, esperaTrasLoGrabadoMs, horaDeBuscarElNumero, horaDeMirarLaCadena, horaDelFinal, reglaDelShow } from "./espectador-regla";

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
    expect(freeze).toContain("return Math.max(0, roundTime(app.frozen.round) - Math.floor(Date.now() / 1000));");
    expect(reglaDelShow(true).margenS).toBe(0);
    expect(horaDeBuscarElNumero(1000, true)).toBe(roundTime(1000));
  });

  it("con el sorteo sellado, el celular mira la cadena desde que acepta el sorteo grabado", () => {
    // El mismo número que espera la grabación de la sala antes de mandar el sorteo.
    expect(MARGEN_DE_LA_CADENA_S).toBe(MARGEN_PARA_GRABAR_S);
    expect(arranqueDelShow(1000).grabable).toBe(roundTime(1000) + MARGEN_DE_LA_CADENA_S);
    expect(grabar).toContain("const falta = msHasta(arranqueDelShow(p.round).grabable, (p.ahora ?? Date.now)());");
    expect(reglaDelShow(true).miraLaCadenaDesdeS).toBe(MARGEN_DE_LA_CADENA_S);
    expect(horaDeMirarLaCadena(1000)).toBe(roundTime(1000) + MARGEN_DE_LA_CADENA_S);
  });

  it("con el sorteo sellado, el celular espera lo grabado, que la sala manda recién con su resultado a la vista", () => {
    // En la sala, la tarjeta espera el resultado y no lo grabado. La grabación arranca después del resultado: ya, o con
    // la billetera propia al terminar el show. Lo grabado nunca existe antes de que la sala tenga su resultado.
    expect(draw).toContain("const card = abrirTarjeta(juego, names.length, nWinners, orden, resultadoListo);");
    expect(draw).toMatch(/hayResultado\(\);[\s\S]*?if \(graba && !despuesDelShow\) grabando = grabarAparte\(graba\);[\s\S]*?playGame\(names, winners\.slice\(0, visibles\), beacon, finish, orden, tarjeta\);/);
    expect(draw).toMatch(/const finish = \(\): void => \{\s*reveal\(names, winners, beacon, listHash\);\s*if \(graba && despuesDelShow\) void grabarAparte\(graba\);/);
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
    // El total del ritmo incluye la tarjeta (draw.ts la descuenta del juego) y la cuenta se suma aparte.
    expect(draw).toContain("setCardSeconds(card ? CARD_SECONDS : 0);");
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
