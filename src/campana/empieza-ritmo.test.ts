import { describe, expect, it } from "vitest";
import { QUICKNET, roundAt, roundTime } from "../protocol/quicknet";
import * as hora from "../protocol/quicknet-hora";
import {
  CADA_LENTA_MS,
  CADA_RAPIDA_MS,
  MARGEN_DEL_SHOW_MS,
  NUMEROS_DESDE_MS,
  VENTANA_LENTA_HASTA_MS,
  VENTANA_RAPIDA_MS,
  desfaseDe,
  horaDeLaRondaMs,
  inicioDeLaVentana,
  minutosYSegundos,
  ritmoDe,
  vistaDeLaCuenta,
  type DatosDelRitmo,
} from "./empieza-ritmo";

const T = Date.UTC(2026, 10, 27, 20, 0, 0);
/** La ronda queda en T, la sala va 7 segundos adelantada y el celular supo de la lista mucho antes. */
const datos = (cambios: Partial<DatosDelRitmo> = {}): DatosDelRitmo => ({ objetivoMs: T, desfase: 7_000, supoEn: T - 3_600_000, ...cambios });
/** El inicio de la ventana rápida, en el reloj del celular. */
const INICIO = T - 7_000 + MARGEN_DEL_SHOW_MS;

describe("la cuenta de las rondas, sin la curva", () => {
  it("quicknet-hora da lo mismo que quicknet, que la reexporta", () => {
    expect(hora.GENESIS_TIME).toBe(QUICKNET.genesisTime);
    expect(hora.PERIOD).toBe(QUICKNET.period);
    for (const ronda of [1, 2, 1_000_000, 5_000_000]) {
      expect(hora.roundTime(ronda)).toBe(roundTime(ronda));
      expect(hora.roundAt(hora.roundTime(ronda))).toBe(roundAt(roundTime(ronda)));
    }
    expect(roundTime).toBe(hora.roundTime);
    expect(roundAt).toBe(hora.roundAt);
  });

  it("la hora de una ronda en milisegundos es su hora en segundos por mil", () => {
    expect(horaDeLaRondaMs(1)).toBe(1_692_803_367_000);
    expect(horaDeLaRondaMs(11)).toBe(1_692_803_367_000 + 30_000);
  });
});

describe("cuánto adelanta o atrasa el reloj", () => {
  it("sin muestras no se sabe", () => {
    expect(desfaseDe([])).toBeNull();
  });

  it("con una muestra es esa", () => {
    expect(desfaseDe([4_000])).toBe(4_000);
  });

  it("con tres es la del medio, y un valor suelto no la mueve", () => {
    expect(desfaseDe([4_000, 4_400, 90_000])).toBe(4_400);
    expect(desfaseDe([9_000, 4_000, 4_200])).toBe(4_200);
  });
});

describe("qué consulta toca en cada tramo", () => {
  it("hasta veinte segundos después de la hora de la ronda, la consulta propia", () => {
    expect(inicioDeLaVentana(datos())).toBe(INICIO);
    expect(ritmoDe(INICIO - 1, datos())).toEqual({ tramo: "propia", cadaMs: null, cambiaEn: 1 });
    expect(ritmoDe(T - 600_000, datos()).tramo).toBe("propia");
  });

  it("con la ventana rápida apagada siempre toca la consulta propia, también a la hora de mirar el resultado", () => {
    for (const ahora of [INICIO - 1, INICIO, INICIO + 60_000, INICIO + VENTANA_RAPIDA_MS + 1]) {
      expect(ritmoDe(ahora, datos(), false)).toEqual({ tramo: "propia", cadaMs: null, cambiaEn: null });
    }
  });

  it("la ventana rápida empieza en T más 20 segundos y mira el resultado cada 8", () => {
    expect(ritmoDe(INICIO, datos())).toEqual({ tramo: "rapida", cadaMs: CADA_RAPIDA_MS, cambiaEn: VENTANA_RAPIDA_MS });
    expect(ritmoDe(INICIO + 149_999, datos()).tramo).toBe("rapida");
  });

  it("a los 150 segundos baja a uno cada 15, hasta los diez minutos", () => {
    expect(ritmoDe(INICIO + VENTANA_RAPIDA_MS, datos())).toEqual({
      tramo: "lenta",
      cadaMs: CADA_LENTA_MS,
      cambiaEn: VENTANA_LENTA_HASTA_MS - VENTANA_RAPIDA_MS,
    });
    expect(ritmoDe(INICIO + VENTANA_LENTA_HASTA_MS - 1, datos()).tramo).toBe("lenta");
  });

  it("después de los diez minutos vuelve a la consulta propia y no cambia más", () => {
    expect(ritmoDe(INICIO + VENTANA_LENTA_HASTA_MS, datos())).toEqual({ tramo: "propia", cadaMs: null, cambiaEn: null });
  });

  it("si el celular supo de la lista tarde, la ventana empieza cuando lo supo", () => {
    const tarde = datos({ supoEn: INICIO + 40_000 });
    expect(inicioDeLaVentana(tarde)).toBe(INICIO + 40_000);
    expect(ritmoDe(INICIO + 39_000, tarde).tramo).toBe("propia");
    expect(ritmoDe(INICIO + 40_000, tarde).tramo).toBe("rapida");
  });

  it("sin la hora de la sala, siempre la consulta propia", () => {
    for (const ahora of [T - 100_000, T, T + 25_000, T + 300_000]) {
      expect(ritmoDe(ahora, datos({ desfase: null }))).toEqual({ tramo: "propia", cadaMs: null, cambiaEn: null });
    }
  });

  it("un reloj corrido tres minutos hacia atrás o hacia adelante da el mismo instante en la hora de la sala", () => {
    const sala = T + 25_000;
    for (const corrimiento of [-180_000, 0, 180_000]) {
      const celular = sala - 7_000 + corrimiento;
      // El celular mide su desfase con su propio reloj: sala menos celular. El corrimiento queda adentro de esa resta.
      const d = datos({ desfase: 7_000 - corrimiento, supoEn: celular - 3_600_000 });
      expect(ritmoDe(celular, d).tramo).toBe("rapida");
      expect(vistaDeLaCuenta(celular, d)).toEqual(vistaDeLaCuenta(sala - 7_000, datos()));
    }
  });
});

describe("lo que dice la cuenta regresiva", () => {
  const faltan = (ms: number) => vistaDeLaCuenta(T - 7_000 - ms, datos());

  it("con menos de diez minutos por delante muestra minutos y segundos", () => {
    expect(faltan(40_000).cuenta).toEqual({ tipo: "numero", texto: "0:40" });
    expect(faltan(NUMEROS_DESDE_MS).cuenta).toEqual({ tipo: "numero", texto: "10:00" });
    expect(faltan(1).cuenta).toEqual({ tipo: "numero", texto: "0:01" });
  });

  it("con más de diez minutos, o sin la hora de la sala, solo la hora del sorteo", () => {
    expect(faltan(NUMEROS_DESDE_MS + 1).cuenta).toEqual({ tipo: "hora" });
    expect(vistaDeLaCuenta(T - 5_000, datos({ desfase: null })).cuenta).toEqual({ tipo: "hora" });
  });

  it("en cero no dice que empieza ni muestra números", () => {
    expect(faltan(0).cuenta).toEqual({ tipo: "nada" });
    expect(faltan(-5_000).cuenta).toEqual({ tipo: "nada" });
  });

  it("la línea pasa a decir que tarda a los 150 segundos de la ventana, y no antes", () => {
    expect(vistaDeLaCuenta(INICIO + VENTANA_RAPIDA_MS - 1, datos()).tardando).toBe(false);
    expect(vistaDeLaCuenta(INICIO + VENTANA_RAPIDA_MS, datos()).tardando).toBe(true);
    expect(vistaDeLaCuenta(INICIO + VENTANA_RAPIDA_MS, datos({ desfase: null })).tardando).toBe(false);
  });

  it("los minutos y segundos se escriben con dos cifras de segundos", () => {
    expect(minutosYSegundos(5_000)).toBe("0:05");
    expect(minutosYSegundos(65_000)).toBe("1:05");
    expect(minutosYSegundos(-3)).toBe("0:00");
  });
});
