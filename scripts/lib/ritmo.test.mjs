import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  HUECO_BANDA,
  fallasDeRitmo,
  huecosEntre,
  informacionTemprana,
  instalarRitmo,
  lineaDeHechos,
  medirSemilla,
  pasadasVacias,
  resumirRitmo,
  silencioAntesDelGolpe,
  tablaDeRitmo,
} from "./ritmo.mjs";

/** Una ronda de muestra: un hecho cada ~2 s, nada de información al principio, «última» que saca a alguien y silencio de 0,4 s. */
function buena() {
  const cambios = [
    { tipo: "empezo", desde: 0 },
    { tipo: "adelante", quien: 3, desde: 3.4 },
    { tipo: "freno", quien: 5, desde: 5.6 },
    { tipo: "casi", quien: 2, desde: 7.4 },
    { tipo: "salio", quien: 4, desde: 9.5 },
    { tipo: "nada", desde: 9.5 },
    { tipo: "gano", quien: 2, desde: 11.5 },
  ];
  const subs = [
    { t: 0.3, texto: "¡Arrancan!" },
    { t: 8, texto: "¡La última pasada!" },
  ];
  // Efectos cada medio segundo; el último termina 0,4 s antes del golpe (a los 12 s del reloj de la página).
  const osc = [];
  for (let v = 0.5; v < 11.5; v += 0.5) osc.push({ v, dur: 0.1, musica: false });
  osc.push({ v: 11.5, dur: 0.1, musica: false });
  osc.push({ v: 12, dur: 1, musica: false });
  return { conPlan: true, cambios, subs, osc, golpeT: 11.5, golpeV: 12, duracion: 11.5 };
}

describe("la línea de tiempo de los hechos", () => {
  it("ignora «nada», cuenta cada hecho una vez y termina en quien gana", () => {
    const { hechos, fin } = lineaDeHechos([
      { tipo: "empezo", desde: 0 },
      { tipo: "salio", quien: 1, desde: 4 },
      { tipo: "salio", quien: 1, desde: 4 },
      { tipo: "nada", desde: 4 },
      { tipo: "gano", quien: 2, desde: 9 },
      { tipo: "nada", desde: 12 },
    ]);
    expect(hechos.map((h) => h.tipo)).toEqual(["empezo", "salio", "gano"]);
    expect(fin).toBe(9);
  });

  it("dos salidas del mismo tipo en otro segundo son dos hechos", () => {
    const { hechos } = lineaDeHechos([{ tipo: "salio", quien: 1, desde: 4 }, { tipo: "salio", quien: 2, desde: 6 }], 10);
    expect(hechos).toHaveLength(2);
  });

  it("sin «gano» termina en el golpe y no cuenta lo que viene después", () => {
    const { hechos, fin } = lineaDeHechos([{ tipo: "salio", quien: 1, desde: 4 }, { tipo: "casi", quien: 2, desde: 14 }], 10);
    expect(fin).toBe(10);
    expect(hechos).toHaveLength(1);
  });
});

describe("el ritmo de una ronda buena", () => {
  const m = medirSemilla(buena());

  it("tiene un hecho cada dos segundos y ningún hueco largo", () => {
    expect(m.mediana).toBeGreaterThanOrEqual(HUECO_BANDA[0]);
    expect(m.mediana).toBeLessThanOrEqual(HUECO_BANDA[1]);
    expect(m.sobreMaximo).toBe(0);
  });

  it("no da información en los primeros tres segundos", () => {
    expect(m.temprana).toEqual([]);
  });

  it("deja un silencio de 0,4 s antes del golpe", () => {
    expect(m.silencio).toBeCloseTo(0.4, 1);
  });

  it("su «última» saca a alguien", () => {
    expect(m.ultimas).toBe(1);
    expect(m.vacias).toEqual([]);
  });

  it("cumple las cuatro reglas", () => {
    expect(fallasDeRitmo(resumirRitmo([m]))).toEqual([]);
  });
});

describe("las cuatro fallas, cada una por su lado", () => {
  it("un hueco de 5 s se cuenta y se nombra", () => {
    const r = buena();
    r.cambios = [{ tipo: "empezo", desde: 0 }, { tipo: "casi", quien: 2, desde: 3.2 }, { tipo: "salio", quien: 4, desde: 8.2 }, { tipo: "gano", quien: 2, desde: 11.5 }];
    const m = medirSemilla(r);
    expect(m.maximo).toBeCloseTo(5, 5);
    expect(m.sobreMaximo).toBe(1);
    const f = fallasDeRitmo(resumirRitmo([m]));
    expect(f.some((x) => x.includes("hueco"))).toBe(true);
  });

  it("información a los 2 s es llamada de atención que informa de más", () => {
    const r = buena();
    r.cambios.splice(1, 0, { tipo: "salio", quien: 1, desde: 2 });
    const m = medirSemilla(r);
    expect(m.temprana).toEqual(["salio 2 s"]);
    expect(fallasDeRitmo(resumirRitmo([m])).some((x) => x.includes("antes de los 3 s"))).toBe(true);
  });

  it("«empezó» y «nada» antes de los 3 s no son información", () => {
    expect(informacionTemprana([{ tipo: "empezo", t: 0 }, { tipo: "nada", t: 1 }, { tipo: "gano", t: 2 }])).toEqual([]);
  });

  it("una «última» que no saca a nadie es una pasada vacía", () => {
    const r = buena();
    r.subs = [{ t: 1, texto: "¡Última pasada!" }];
    const m = medirSemilla(r);
    expect(m.vacias).toHaveLength(1);
    expect(fallasDeRitmo(resumirRitmo([m])).some((x) => x.includes("«última»"))).toBe(true);
  });

  it("«last» y «final» también valen, y «finalmente» no", () => {
    const hechos = [{ tipo: "empezo", t: 0 }];
    expect(pasadasVacias([{ t: 1, texto: "Last pass!" }], hechos)).toHaveLength(1);
    expect(pasadasVacias([{ t: 1, texto: "¡Pasada final!" }], hechos)).toHaveLength(1);
    expect(pasadasVacias([{ t: 1, texto: "¡A la recta final!" }, { t: 2, texto: "The final stretch!" }], hechos)).toHaveLength(0);
    expect(pasadasVacias([{ t: 1, texto: "Finalmente llegan" }], hechos)).toHaveLength(0);
  });

  it("alguien que gana en los 3 s siguientes también cuenta", () => {
    expect(pasadasVacias([{ t: 8, texto: "¡Última vuelta!" }], [{ tipo: "gano", t: 10.5 }])).toEqual([]);
    expect(pasadasVacias([{ t: 8, texto: "¡Última vuelta!" }], [{ tipo: "gano", t: 11.5 }])).toHaveLength(1);
  });
});

describe("el silencio antes del golpe", () => {
  it("se mide desde el último efecto que arrancó antes del golpe", () => {
    expect(silencioAntesDelGolpe([{ v: 5, dur: 0.5 }, { v: 9, dur: 0.3 }, { v: 10, dur: 2 }], 10)).toBeCloseTo(0.7, 5);
  });

  it("un efecto que sigue sonando en el golpe deja el silencio en cero", () => {
    expect(silencioAntesDelGolpe([{ v: 9.8, dur: 0.5 }], 10)).toBe(0);
  });

  it("la música no cuenta: su reloj es el del audio y no el del juego", () => {
    expect(silencioAntesDelGolpe([{ v: 9, dur: 0.5 }, { v: 9.9, dur: 5, musica: true }], 10)).toBeCloseTo(0.5, 5);
  });

  it("sin efectos antes del golpe, o sin golpe, no hay medida", () => {
    expect(silencioAntesDelGolpe([], 10)).toBeNull();
    expect(silencioAntesDelGolpe([{ v: 1, dur: 1 }], null)).toBeNull();
  });

  it("fuera de 0,2 a 0,6 s es una falla de ritmo; adentro, no", () => {
    const base = (silencio) => ({ ...resumirRitmo([{ ...medirSemilla(buena()), silencio }]) });
    expect(fallasDeRitmo(base(0.4))).toEqual([]);
    expect(fallasDeRitmo(base(0)).some((x) => x.includes("silencio"))).toBe(true);
    expect(fallasDeRitmo(base(1.3)).some((x) => x.includes("silencio"))).toBe(true);
  });
});

describe("los huecos y el resumen", () => {
  it("cuentan desde el segundo cero y hasta el final", () => {
    expect(huecosEntre([{ t: 2 }, { t: 5 }], 9)).toEqual([2, 3, 4]);
  });

  it("dos hechos en el mismo instante son uno", () => {
    expect(huecosEntre([{ t: 0 }, { t: 0.01 }, { t: 2 }], 4)).toEqual([2, 2]);
  });

  it("un juego sin plan se resume solo con su silencio, y la compuerta lo marca «sin medir»", () => {
    const r = resumirRitmo([medirSemilla({ conPlan: false, osc: [{ v: 1, dur: 0.1 }], golpeV: 1.4, subs: [] })]);
    expect(r.conPlan).toBe(0);
    expect(r.medianaHuecos).toBeNull();
    expect(r.silencioMediana).toBeCloseTo(0.3, 1);
    expect(fallasDeRitmo(r).some((x) => x.includes("sin medir"))).toBe(true);
  });

  it("la tabla trae una fila por juego", () => {
    const t = tablaDeRitmo({ uno: resumirRitmo([medirSemilla(buena())]), dos: resumirRitmo([medirSemilla({ conPlan: false, osc: [], subs: [] })]) });
    expect(t.split("\n")).toHaveLength(4);
    expect(t).toContain("sin plan");
  });
});

describe("el gancho que corre dentro de la página", () => {
  /** Una página de mentira con lo justo: un oscilador, el reloj, el plan y el subtítulo. */
  function pagina() {
    const lienzo = { dataset: {} };
    const comentario = { textContent: "" };
    class Oscilador {
      constructor(ctx) { this.context = ctx; }
      start() {}
      stop() {}
    }
    const ctx = { currentTime: 0 };
    const w = {
      OscillatorNode: Oscilador,
      performance: { now: () => 0 },
      document: { querySelector: () => comentario, getElementById: () => lienzo },
      __nino: { t: () => 0, duracion: 20, verdad: () => ({ paso: { tipo: "nada", desde: 0 } }) },
    };
    w.window = w;
    vm.runInNewContext(`(${instalarRitmo.toString()})()`, w);
    return { w, lienzo, comentario, ctx, Oscilador };
  }

  it("anota los cambios de paso una vez, los subtítulos y el golpe", () => {
    const { w, lienzo, comentario } = pagina();
    let paso = { tipo: "empezo", desde: 0 };
    let t = 0;
    w.__nino.t = () => t;
    w.__nino.verdad = () => ({ paso });
    w.__rit.muestrear(1000);
    w.__rit.muestrear(1016);
    paso = { tipo: "salio", quien: 2, desde: 4 };
    t = 4;
    comentario.textContent = "¡Sale alguien!";
    w.__rit.muestrear(5000);
    lienzo.dataset.golpe = "21";
    t = 20;
    w.__rit.muestrear(21000);
    expect(w.__rit.conPlan).toBe(true);
    expect(w.__rit.cambios.map((c) => c.tipo)).toEqual(["empezo", "salio"]);
    expect(w.__rit.subs).toEqual([{ t: 4, texto: "¡Sale alguien!" }]);
    expect(w.__rit.golpeV).toBe(21);
    expect(w.__rit.golpeT).toBe(20);
  });

  it("anota cuándo suena un efecto con su adelanto, cuánto dura y si es música", () => {
    const { w, ctx, Oscilador } = pagina();
    w.performance.now = () => 10_000;
    const o = new Oscilador(ctx);
    ctx.currentTime = 2;
    o.start(2.12);
    o.stop(2.4);
    const m = new Oscilador(ctx);
    m.__musica = true;
    m.start(2);
    expect(w.__rit.osc[0].v).toBeCloseTo(10.12, 5);
    expect(w.__rit.osc[0].dur).toBeCloseTo(0.28, 5);
    expect(w.__rit.osc[1].musica).toBe(true);
  });

  it("sin plan sigue el golpe y los subtítulos, y no inventa hechos", () => {
    const { w, lienzo } = pagina();
    delete w.__nino;
    lienzo.dataset.golpe = "9";
    w.__rit.muestrear(30_000);
    expect(w.__rit.conPlan).toBe(false);
    expect(w.__rit.cambios).toEqual([]);
    expect(w.__rit.golpeV).toBe(30);
  });
});
