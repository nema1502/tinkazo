import { describe, expect, it } from "vitest";
import { problemasDeMomentos } from "../pixi/kit/director";
import { validarGuion } from "../pixi/kit/guion";
import { problemasDeMarcador } from "../pixi/kit/marcador";
import { problemasDeRespuestas } from "../pixi/kit/respuestas";
import { segundosDe } from "../../duraciones";
import { formasDe } from "../nombres";
import { planCarrera, corto, alfabetico, duracionNominal, FINALISTAS, FIJOS, TARJETA, T_VUELO, type Datos } from "./carrera-show";
import { ctxDe } from "./carrera-prueba";
import { TEXTOS_CARRERA } from "./carrera-textos";
import { ESP_MIN } from "./carrera-tiempos";

const TAMANOS = [2, 3, 5, 8, 9, 12, 18, 25, 30, 31, 50, 100, 200];

describe("la carrera: el plan es puro y cumple la regla del niño", () => {
  for (const n of TAMANOS) {
    for (const semilla of [1, 2, 3, 4, 5, 6]) {
      it(`con ${n}, semilla ${semilla}: guion, momentos, marcador y respuestas en regla`, () => {
        const ctx = ctxDe(n, semilla);
        const plan = planCarrera(ctx);
        const rep = validarGuion(plan.guion, plan.duracion, { nino: true, nombres: ctx.nombres });
        expect(rep.problemas).toEqual([]);
        expect(problemasDeMomentos(plan)).toEqual([]);
        expect(problemasDeMarcador(plan.marcador, { duracion: plan.duracion, total: n, pasoMax: n > 30 ? 25 : FINALISTAS })).toEqual([]);
        expect(problemasDeRespuestas(plan, { n, ganadores: ctx.ganadores })).toEqual([]);
      });
    }
  }

  it("es determinista: la misma ronda cuenta lo mismo", () => {
    const a = planCarrera(ctxDe(18, 7));
    const b = planCarrera(ctxDe(18, 7));
    expect(b.duracion).toBe(a.duracion);
    expect(b.guion.map((l) => [l.t, typeof l.texto === "function" ? l.texto() : l.texto])).toEqual(a.guion.map((l) => [l.t, typeof l.texto === "function" ? l.texto() : l.texto]));
    expect(b.datos.sucesos).toEqual(a.datos.sucesos);
  });

  it("las echadas van una por vez, separadas, nunca una finalista y siempre cualquiera", () => {
    const quienes = new Set<number>();
    for (let s = 1; s <= 30; s++) {
      const n = 18 + (s % 13);
      const d: Datos = planCarrera(ctxDe(n, s)).datos;
      const ts = d.tiempos.echadas.map((e) => e.t);
      expect(ts).toEqual([...ts].sort((x, y) => x - y));
      for (let i = 1; i < ts.length; i++) expect((ts[i] as number) - (ts[i - 1] as number)).toBeGreaterThanOrEqual(ESP_MIN - 1e-9);
      for (const e of d.tiempos.echadas) {
        expect(d.lanes).not.toContain(e.quien);
        quienes.add(e.quien);
      }
      expect(d.tiempos.echadas).toHaveLength(Math.max(0, d.gente.length - FINALISTAS));
      expect(d.tAbre).toBeGreaterThan(d.tiempos.ultima);
    }
    expect(quienes.size).toBeGreaterThan(10);
  });

  it("el camino solo avanza y la cinta llega de 0 a 1", () => {
    for (const n of [5, 18, 30]) {
      const d = planCarrera(ctxDe(n, 3)).datos;
      let previo = -1;
      for (let t = 0; t <= d.tCrown + 3; t += 0.1) {
        const f = d.frac(t);
        expect(f).toBeGreaterThanOrEqual(previo - 1e-9);
        previo = f;
      }
      expect(d.frac(0)).toBe(0);
      expect(d.frac(d.tCrown)).toBeCloseTo(1, 6);
      expect(d.cinta[d.cinta.length - 1]?.tipo).toBe("recta");
    }
  });

  it("la ganadora corona primera y nunca se echa", () => {
    for (let s = 1; s <= 20; s++) {
      const ctx = ctxDe(20, s);
      const d = planCarrera(ctx).datos;
      expect(d.vivas(d.tCrown)[0]).toBe(ctx.ganadores[0]);
      expect(d.lanes).toContain(ctx.ganadores[0]);
    }
  });

  it("los nombres cortos son de dos palabras como mucho y alfabético ignora tildes", () => {
    // El mismo corto que escribe la ficha de la llama (nombres.ts, nivel 3): la inicial del ÚLTIMO apellido.
    expect(corto("María Fernanda Quispe")).toBe("María Q.");
    expect(corto("María Quispe Mamani")).toBe("María M.");
    expect(corto("María Fernanda Guadalupe Quispe Mamani Zu")).toBe("María Z.");
    expect(corto("Valeria Torrez 2")).toBe("Valeria T.");
    expect(corto("Ana")).toBe("Ana");
    expect(corto("  ")).toBe("");
    // Dos palabras como mucho, también con un emoji delante.
    expect(corto("🌸 Ana Mamani").split(" ")).toHaveLength(2);
    for (const nm of ["María Quispe Mamani", "Jorge Mamani", "Álvaro Toledo Paz", "Óscar Limachi Condori Apaza", "Ana"]) {
      expect(corto(nm), nm).toBe(formasDe(nm)[2]);
      expect(corto(nm).split(" ").length, nm).toBeLessThanOrEqual(2);
    }
    const n = ["Óscar", "Ana", "álvaro", "Beatriz"];
    expect(alfabetico(n, [0, 1, 2, 3]).map((i) => n[i])).toEqual(["álvaro", "Ana", "Beatriz", "Óscar"]);
  });

  it("la duración nominal crece con la gente hasta 30", () => {
    expect(duracionNominal(9)).toBeLessThan(duracionNominal(18));
    expect(duracionNominal(18)).toBeLessThan(duracionNominal(30));
  });

  it("ningún texto del relator trae un número, en español ni en inglés (los números van en el marcador)", () => {
    for (const idioma of ["es", "en"] as const) {
      const dic = TEXTOS_CARRERA[idioma];
      for (const [clave, v] of Object.entries(dic)) {
        const salidas = typeof v === "function" ? [0, 1, 2].map((i) => v("Ana", i)) : [v];
        for (const s of salidas) expect(/\d/.test(s), `${idioma}.${clave}: ${s}`).toBe(false);
      }
    }
  });

  it("en la final solo se nombra a la tribuna: los momentos de la historia no llevan nombre", () => {
    for (const n of [8, 12, 18, 30, 31, 60, 200]) {
      for (let s = 1; s <= 8; s++) {
        const ctx = ctxDe(n, s);
        const plan = planCarrera(ctx);
        const d = plan.datos;
        const gritan = TEXTOS_CARRERA.es.carHinchada as (n: string) => string;
        const hinchadas = ctx.nombres.map((nm) => gritan(corto(nm)));
        const enLaFinal = plan.guion.filter((l) => l.texto !== undefined && l.t >= d.tAbre - 1e-9).map((l) => (typeof l.texto === "function" ? l.texto() : (l.texto as string)));
        const nombran = enLaFinal.filter((t) => ctx.nombres.some((nm) => t.includes(corto(nm))));
        for (const t of nombran) expect(hinchadas, `n=${n} s=${s}: "${t}"`).toContain(t);
        // Hasta cuatro, de a una, y todas distintas.
        expect(nombran.length, `n=${n} s=${s}`).toBeLessThanOrEqual(4);
        expect(new Set(nombran).size).toBe(nombran.length);
      }
    }
  });

  it("la tribuna nombra a las de la final, sin mirar quién gana: la ganadora sale tanto como cualquiera, primera y última", () => {
    const RONDAS = 600;
    let ganadoraNombrada = 0, esperada = 0, varianza = 0, primeraEsGanadora = 0, hayPrimera = 0, ultimaEsGanadora = 0;
    for (let s = 1; s <= RONDAS; s++) {
      const ctx = ctxDe(18, s);
      const plan = planCarrera(ctx);
      const d = plan.datos;
      const textos = plan.guion.filter((l) => l.texto !== undefined && l.t >= d.tAbre - 1e-9).map((l) => (typeof l.texto === "function" ? l.texto() : (l.texto as string)));
      const nombradas = d.lanes.filter((i) => textos.some((t) => t.includes(corto(ctx.nombres[i] as string))));
      const k = nombradas.length;
      esperada += k / FINALISTAS;
      varianza += (k / FINALISTAS) * (1 - k / FINALISTAS);
      if (nombradas.includes(d.campeona)) ganadoraNombrada++;
      // En el orden en que se dicen.
      const orden = textos.map((t) => d.lanes.find((i) => t.includes(corto(ctx.nombres[i] as string)))).filter((i): i is number => i !== undefined);
      if (orden.length) {
        hayPrimera++;
        if (orden[0] === d.campeona) primeraEsGanadora++;
        if (orden[orden.length - 1] === d.campeona) ultimaEsGanadora++;
      }
    }
    // La ganadora se nombra tanto como cualquiera (cuatro desvíos de una suma de monedas con distinto sesgo).
    expect(Math.abs(ganadoraNombrada - esperada)).toBeLessThan(4 * Math.sqrt(varianza));
    // Y es la primera o la última de las nombradas una de cada ocho veces (cuatro desvíos de una binomial).
    const sd = Math.sqrt(hayPrimera * (1 / 8) * (7 / 8));
    expect(Math.abs(primeraEsGanadora - hayPrimera / 8)).toBeLessThan(4 * sd);
    expect(Math.abs(ultimaEsGanadora - hayPrimera / 8)).toBeLessThan(4 * sd);
    expect(hayPrimera).toBeGreaterThan(RONDAS * 0.95);
  });

  it("\"Busquen su nombre\" se dice con todas las cantidades (también con hasta 30) y \"Ya se ve la meta\" solo cuando la meta entra", () => {
    for (const n of [5, 8, 9, 12, 18, 30, 31, 60, 200]) {
      for (const semilla of [1, 2, 3]) {
        const ctx = ctxDe(n, semilla);
        const plan = planCarrera(ctx);
        const d = plan.datos;
        const dichas = plan.guion.filter((l) => l.texto !== undefined).map((l) => ({ t: l.t, s: typeof l.texto === "function" ? l.texto() : (l.texto as string) }));
        const busquen = dichas.filter((x) => x.s === TEXTOS_CARRERA.es.carBusquen);
        expect(busquen, `n=${n} semilla ${semilla}`).toHaveLength(1);
        expect(busquen[0]?.t).toBeCloseTo(3.2, 6);
        for (const x of dichas.filter((y) => y.s === TEXTOS_CARRERA.es.carCasi)) expect(x.t, `n=${n} semilla ${semilla}`).toBeGreaterThanOrEqual(Math.max(d.t80, d.tAbre + 3) - 1e-9);
      }
    }
  });

  it("en Rápido los carteles duran 3 s o más de verdad, y los hechos del portón y de las echadas, 1 s o más", () => {
    // Rápido comprime el show (util / duración del plan, hasta 0,85): lo que el plan dice en segundos de show
    // dura menos en la pared. Los carteles de los nombres y de las tandas tienen que seguir dando 3 s para leerse.
    for (const n of [2, 5, 8, 9, 10, 12, 18, 30, 31, 60, 100, 150, 175, 200]) {
      for (const semilla of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const plan = planCarrera(ctxDe(n, semilla));
        const normal = plan.normal as number;
        const factor = (segundosDe("rapido", normal) - FIJOS - TARJETA) / plan.duracion;
        const d = plan.datos;
        const cartel = d.tandas.length ? d.tandas.map((t) => t.salidas[0] as number - t.t0) : [d.tSalida - T_VUELO];
        for (const c of cartel) expect(c * factor, `n=${n} semilla ${semilla}: cartel`).toBeGreaterThanOrEqual(3);
        for (const t of d.tandas) {
          t.salidas.forEach((x, j) => { if (j) expect((x - (t.salidas[j - 1] as number)) * factor, `n=${n} portón`).toBeGreaterThanOrEqual(1); });
          expect((t.tCierra - (t.salidas.at(-1) as number)) * factor, `n=${n} cierre`).toBeGreaterThanOrEqual(1);
        }
        const ts = d.tiempos.echadas.map((e) => e.t);
        for (let i = 1; i < ts.length; i++) expect(((ts[i] as number) - (ts[i - 1] as number)) * factor, `n=${n} echadas`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("los textos están en los dos idiomas, también el letrero de la meta (META / FINISH)", () => {
    expect(Object.keys(TEXTOS_CARRERA.en).sort()).toEqual(Object.keys(TEXTOS_CARRERA.es).sort());
    expect(TEXTOS_CARRERA.es.carRotuloMeta).toBe("META");
    expect(TEXTOS_CARRERA.en.carRotuloMeta).toBe("FINISH");
  });

  it("tres tiempos por tramo: qué pasó (una echada), qué pasa (quién va adelante) y qué sigue (el terreno)", () => {
    for (const n of [12, 18, 24, 30]) {
      for (let s = 1; s <= 10; s++) {
        const plan = planCarrera(ctxDe(n, s));
        const d = plan.datos;
        const lineas = plan.guion.filter((l) => l.texto !== undefined).map((l) => l.t);
        d.tramos.forEach((tr, k) => {
          const dentro = (t: number): boolean => t >= tr.t0 - 1e-9 && t < tr.t1;
          expect(d.tiempos.echadas.some((e) => e.tramo === k && lineas.some((t) => Math.abs(t - e.t) < 1e-6)), `echada en el tramo ${k}, n=${n}, s=${s}`).toBe(true);
          expect(d.lineasAdelante.some(dentro), `quién va adelante en el tramo ${k}, n=${n}, s=${s}`).toBe(true);
          expect(lineas.some((t) => dentro(t) && t >= tr.t0 && t <= tr.t0 + 1.6), `el terreno en el tramo ${k}, n=${n}, s=${s}`).toBe(true);
        });
      }
    }
  });
});
