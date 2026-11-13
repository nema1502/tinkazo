import { describe, expect, it, vi } from "vitest";
import { problemasDeMomentos } from "../pixi/kit/director";
import { crearGuion, validarGuion } from "../pixi/kit/guion";
import { problemasDeMarcador } from "../pixi/kit/marcador";
import { problemasDeRespuestas } from "../pixi/kit/respuestas";
import { segundosDe } from "../../duraciones";
import { formasDe } from "../nombres";
import { planCarrera, corto, alfabetico, duracionNominal, AVISO_PIEDRAS, AVISO_REMOLINO, AVISO_VALLA, CINTA_SIN_SENALAR, FINALISTAS, FIJOS, TARJETA, T_VUELO, type Datos } from "./carrera-show";
import { ctxDe } from "./carrera-prueba";
import { TEXTOS_CARRERA } from "./carrera-textos";
import { ESP_MIN } from "./carrera-tiempos";
import { MARCA_PORTON } from "./carrera-tandas";

// Armar la recta prueba hasta 160 arreglos por ronda (`carrera-marcha.ts`): unos 40 ms por plan, y estas pruebas arman cientos.
vi.setConfig({ testTimeout: 120_000 });

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

  it("en la final solo se nombra a la tribuna y a quien le pasa un obstáculo: los momentos de la historia no llevan nombre", () => {
    for (const n of [8, 12, 18, 30, 31, 60, 200]) {
      for (let s = 1; s <= 8; s++) {
        const ctx = ctxDe(n, s);
        const plan = planCarrera(ctx);
        const d = plan.datos;
        const gritan = TEXTOS_CARRERA.es.carHinchada as (n: string) => string;
        const hinchadas = ctx.nombres.map((nm) => gritan(corto(nm)));
        const deObstaculo = new Set<string>();
        for (const o of d.final.obstaculos ?? []) {
          if (o.tipo === "piedras") deObstaculo.add((TEXTOS_CARRERA.es.carCuidadoPiedras as (n: string) => string)(corto(ctx.nombres[d.lanes[o.carriles[0] as number] as number] as string)));
          if (o.tipo === "escupida") deObstaculo.add((TEXTOS_CARRERA.es.carEscupen as (n: string) => string)(corto(ctx.nombres[d.lanes[o.carriles[0] as number] as number] as string)));
          if (o.tipo === "salto") for (const m of o.malas) deObstaculo.add((TEXTOS_CARRERA.es.carTumbaValla as (n: string) => string)(corto(ctx.nombres[d.lanes[m] as number] as string)));
        }
        const enLaFinal = plan.guion.filter((l) => l.texto !== undefined && l.t >= d.tAbre - 1e-9).map((l) => (typeof l.texto === "function" ? l.texto() : (l.texto as string)));
        const nombran = enLaFinal.filter((t) => ctx.nombres.some((nm) => t.includes(corto(nm))));
        for (const t of nombran) expect(hinchadas.includes(t) || deObstaculo.has(t), `n=${n} s=${s}: "${t}"`).toBe(true);
        // La tribuna: hasta cuatro, de a una, y todas distintas.
        const deLaTribuna = nombran.filter((t) => hinchadas.includes(t));
        expect(deLaTribuna.length, `n=${n} s=${s}`).toBeLessThanOrEqual(4);
        expect(new Set(deLaTribuna).size).toBe(deLaTribuna.length);
      }
    }
  });

  it("desde T-3 el relator no nombra a nadie y desde la meta no dice nada: en el plan y en lo que queda en pantalla", () => {
    for (const nueva of [false, true]) {
      for (const n of [8, 18, 60]) {
        for (let s = 1; s <= 10; s++) {
          const ctx = ctxDe(n, s);
          const plan = planCarrera(ctx, { nueva });
          const T = plan.datos.tCrown;
          const desde = T - CINTA_SIN_SENALAR;
          const cortos = ctx.nombres.map((nm) => corto(nm));
          const nombra = (x: string): boolean => cortos.some((c) => x.includes(c));
          const caso = `${nueva ? "nueva" : "de siempre"}, n=${n} s=${s}`;
          for (const l of plan.guion) {
            if (l.texto === undefined) continue;
            const x = typeof l.texto === "function" ? l.texto() : l.texto;
            if (l.t >= desde - 1e-9) expect(nombra(x), `${caso}: «${x}» a ${(l.t - T).toFixed(2)} s de la meta`).toBe(false);
            expect(l.t, `${caso}: «${x}» cae después de la meta`).toBeLessThan(T);
          }
          // Lo que se lee: el guion con su cola, cuadro a cuadro hasta pasado el golpe. La última línea dicha antes de T-3 sigue en pantalla
          // hasta la siguiente, así que tampoco puede nombrar a nadie.
          const g = crearGuion(plan.guion);
          const nada = { decir: (): void => undefined, hacer: (): void => undefined };
          for (let t = 0; t <= T + 2; t += 1 / 60) g.avanzar(t, nada);
          const dichas = g.dichas();
          const enPantalla = dichas.filter((d) => d.t <= desde).at(-1);
          if (enPantalla) expect(nombra(enPantalla.texto), `${caso}: en T-3 queda «${enPantalla.texto}»`).toBe(false);
          for (const d of dichas.filter((x) => x.t > desde)) expect(nombra(d.texto), `${caso}: «${d.texto}» a ${(d.t - T).toFixed(2)} s`).toBe(false);
          expect(dichas.filter((d) => d.t >= T).map((d) => d.texto), caso).toEqual([]);
          // Y al coronar el kit vacía la caja del relator y no anuncia a nadie: el nombre lo dice el cartel.
          expect(plan.alCoronar?.sinAnuncio, caso).toBe(true);
        }
      }
    }
  });

  it("la tribuna no grita el nombre de una mientras la marca del portón está en otra: la final empieza después de que se apaga la última", () => {
    for (const n of [31, 60, 100, 200]) {
      for (let s = 1; s <= 4; s++) {
        const ctx = ctxDe(n, s);
        const plan = planCarrera(ctx);
        const d = plan.datos;
        expect(d.tandas.length, `n=${n} s=${s}`).toBeGreaterThan(0);
        const ultimaSalida = Math.max(...d.tandas.flatMap((tn) => tn.salidas));
        expect(ultimaSalida + MARCA_PORTON, `n=${n} s=${s}: la marca del portón se apaga antes de abrir la final`).toBeLessThanOrEqual(d.tAbre);
        const nombres = ctx.nombres.map((nm) => corto(nm));
        for (const l of plan.guion) {
          if (l.texto === undefined) continue;
          const texto = typeof l.texto === "function" ? l.texto() : (l.texto as string);
          if (!nombres.some((nm) => texto.includes(nm))) continue;
          const enVentana = d.tandas.some((tn) => tn.salidas.some((sal) => l.t >= sal && l.t < sal + MARCA_PORTON));
          if (enVentana) expect(texto, `n=${n} s=${s} a los ${l.t.toFixed(1)} s`).not.toMatch(/^¡Vamos, /);
        }
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
    // Las líneas de los obstáculos ocupan algunos huecos de la recta y desde «¡Cabeza a cabeza!» (T-3,3) la tribuna calla: grita en el 90 %
    // de las rondas o más (antes de esa línea, el 93 %).
    expect(hayPrimera).toBeGreaterThan(RONDAS * 0.9);
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

  it("el rótulo de quien va primera en el celular existe en los dos idiomas y es una sola palabra (ADELANTE / AHEAD)", () => {
    expect(TEXTOS_CARRERA.es.carRotuloPunta).toBe("ADELANTE");
    expect(TEXTOS_CARRERA.en.carRotuloPunta).toBe("AHEAD");
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

describe("los momentos de la historia, callados en la carrera de siempre", () => {
  // Con la carrera de antes (`senuelos: false`): nunca le tocan a la ganadora o le tocan el doble, y si se vieran, delatarían. Siguen en la marcha,
  // sin postura, sin línea y sin suceso. Con la marcha pareja los momentos que actúan son otros (ciegos, a cualquiera) y se ven: la prueba de abajo.
  const HISTORIA = ["tropiezo", "plantada", "pique", "escupida", "escupido"];
  const LINEAS = ["carPlantada", "carTropiezo", "carPique", "carEscupida"].map((c) => TEXTOS_CARRERA.es[c] as string);
  const textosDe = (guion: ReturnType<typeof planCarrera>["guion"]): string[] => guion.filter((l) => l.texto !== undefined).map((l) => (typeof l.texto === "function" ? l.texto() : (l.texto as string)));
  /** A quién le pasa un obstáculo (las únicas que frenan a la vista en la recta). */
  const victimasDe = (d: Datos): Set<number> => {
    const v = new Set<number>();
    for (const o of d.final.obstaculos ?? []) for (const k of o.tipo === "salto" ? o.malas : o.carriles) v.add(d.lanes[k] as number);
    return v;
  };

  it("con la carrera de antes, en la recta de siempre nadie tiene la postura de un momento, el relator no dice «¡Alguien…!», los frenos son solo de los obstáculos y los cambios de punta, de la ficha amarilla", () => {
    let momentos = 0;
    for (const n of [8, 18, 60]) {
      for (let s = 1; s <= 6; s++) {
        const plan = planCarrera(ctxDe(n, s), { senuelos: false });
        const d = plan.datos;
        momentos += d.final.story.beats.length;
        for (let q = 0; q <= 1; q += 0.002) for (let k = 0; k < d.lanes.length; k++) {
          const kind = d.final.beatOf(k, q)?.kind ?? "";
          // El "escupido" de un obstáculo sí se ve (es ciego y le toca a cualquiera): el de la historia, no.
          if (kind === "escupido") expect((d.final.obstaculos ?? []).some((o) => o.tipo === "escupida" && o.carriles[0] === k), `n=${n} s=${s} carril ${k} al ${q.toFixed(3)}`).toBe(true);
          else expect(HISTORIA, `n=${n} s=${s} carril ${k} al ${q.toFixed(3)}`).not.toContain(kind);
        }
        for (const t of textosDe(plan.guion)) expect(LINEAS, `n=${n} s=${s}`).not.toContain(t);
        const victimas = victimasDe(d);
        for (const su of d.sucesos) {
          if (su.desde < d.tAbre - 1e-9) continue;
          if (su.tipo === "freno") expect(victimas.has(su.quien as number), `n=${n} s=${s}: freno de ${su.quien} a ${su.desde.toFixed(2)}`).toBe(true);
          // El pique de un momento no es un cambio de punta: los que se anotan son las pasadas de la ficha amarilla, a su hora y a quien la recibe.
          if (su.tipo === "adelante") expect(d.marcas.some((m) => Math.abs(m.t - su.desde) < 1e-9 && m.quien === su.quien), `n=${n} s=${s}: adelante de ${su.quien} a ${su.desde.toFixed(2)}`).toBe(true);
        }
      }
    }
    // La historia sigue escrita (y actúa en la marcha): solo no se ve.
    expect(momentos).toBeGreaterThan(18);
  });

  it("con la marcha pareja, las posturas, las líneas «¡Alguien…!» y los frenos son de los momentos que actúan (a cualquiera, a su hora) o de los obstáculos, y los de la historia siguen ocultos", () => {
    const DURA: Record<string, number> = { plantada: 0.075, pique: 0.09, escupida: 0.05, tropiezo: 0.035 };
    const CLAVE: Record<string, string> = { plantada: "carPlantada", tropiezo: "carTropiezo", pique: "carPique", escupida: "carEscupida" };
    let vistos = 0, dichos = 0, deLaGanadora = 0;
    for (const n of [8, 18, 60]) {
      for (let s = 1; s <= 6; s++) {
        const plan = planCarrera(ctxDe(n, s), { senuelos: true });
        const d = plan.datos;
        const ms = d.final.marcha?.momentos ?? [];
        expect(ms.length, `n=${n} s=${s}: momentos que actúan`).toBeGreaterThan(0);
        deLaGanadora += ms.filter((b) => b.actor === d.final.story.winner || b.target === d.final.story.winner).length;
        // Cada postura que se ve es de un momento que actúa, en su carril y a su hora (o la escupida de un obstáculo).
        for (let q = 0; q <= 1; q += 0.002) for (let k = 0; k < d.lanes.length; k++) {
          const kind = d.final.beatOf(k, q)?.kind ?? "";
          if (!HISTORIA.includes(kind)) continue;
          vistos++;
          const suyo = ms.some((b) => q >= b.at && q < b.at + (DURA[b.kind] as number) && (kind === "escupido" ? b.kind === "escupida" && b.target === k : b.kind === kind && b.actor === k));
          const deObstaculo = kind === "escupido" && (d.final.obstaculos ?? []).some((o) => o.tipo === "escupida" && o.carriles[0] === k);
          expect(suyo || deObstaculo, `n=${n} s=${s} carril ${k}: ${kind} al ${q.toFixed(3)}`).toBe(true);
        }
        // Cada «¡Alguien…!» cae a la hora de un momento de su tipo.
        for (const l of plan.guion.filter((x) => x.texto !== undefined)) {
          const t = typeof l.texto === "function" ? l.texto() : (l.texto as string);
          const kind = Object.keys(CLAVE).find((k) => TEXTOS_CARRERA.es[CLAVE[k] as string] === t);
          if (!kind) continue;
          dichos++;
          expect(ms.some((b) => b.kind === kind && Math.abs(d.tDeQ(b.at) - l.t) < 1e-6), `n=${n} s=${s}: «${t}» a ${l.t.toFixed(2)}`).toBe(true);
        }
        // Los frenos de la recta son de los obstáculos o de esos momentos.
        const victimas = victimasDe(d);
        for (const b of ms) {
          if (b.kind === "tropiezo" || b.kind === "plantada") victimas.add(d.lanes[b.actor] as number);
          if (b.kind === "escupida" && b.target !== undefined) victimas.add(d.lanes[b.target] as number);
        }
        for (const su of d.sucesos) if (su.desde >= d.tAbre - 1e-9 && su.tipo === "freno") expect(victimas.has(su.quien as number), `n=${n} s=${s}: freno de ${su.quien} a ${su.desde.toFixed(2)}`).toBe(true);
      }
    }
    expect(vistos).toBeGreaterThan(0);
    expect(dichos).toBeGreaterThan(0);
    // Le tocan también a la ganadora.
    expect(deLaGanadora).toBeGreaterThan(0);
  });

  it("la carrera nueva conserva sus momentos: sus posturas y sus líneas", () => {
    let posturas = 0, lineas = 0;
    for (let s = 1; s <= 6; s++) {
      const plan = planCarrera(ctxDe(18, s), { nueva: true });
      const d = plan.datos;
      for (const b of d.final.story.beats) if (HISTORIA.includes(d.final.beatOf(b.actor, b.at + 1e-6)?.kind ?? "")) posturas++;
      lineas += textosDe(plan.guion).filter((t) => LINEAS.includes(t)).length;
    }
    expect(posturas).toBeGreaterThan(0);
    expect(lineas).toBeGreaterThan(0);
  });
});

describe("el relator nombra a quien le pasa un obstáculo", () => {
  const lineasDe = (plan: ReturnType<typeof planCarrera>): { t: number; s: string; hecho?: { tipo: string; quien?: number } }[] =>
    plan.guion.filter((l) => l.texto !== undefined).map((l) => ({ t: l.t, s: typeof l.texto === "function" ? l.texto() : (l.texto as string), hecho: l.hecho as { tipo: string; quien?: number } | undefined }));

  it("cada línea de obstáculo nombra a la víctima del plan y cae a su hora", () => {
    let piedras = 0, vallas = 0, remolinos = 0, escupidas = 0;
    for (const n of [8, 18, 60]) {
      for (let s = 1; s <= 12; s++) {
        const ctx = ctxDe(n, s);
        const plan = planCarrera(ctx);
        const d = plan.datos;
        const lineas = lineasDe(plan);
        const nombreDe = (persona: number): string => corto(ctx.nombres[persona] as string);
        for (const o of d.final.obstaculos ?? []) {
          if (o.tipo === "piedras") {
            const quien = d.lanes[o.carriles[0] as number] as number;
            const esperada = (TEXTOS_CARRERA.es.carCuidadoPiedras as (x: string) => string)(nombreDe(quien));
            // Cada línea con su nombre cae a la hora de unas piedras de alguien con ese nombre (cuando ya no quedan libres, a la misma le pueden tocar dos; con
            // más de 32 personas, dos se llaman igual en corto).
            const horas = (d.final.obstaculos ?? []).filter((x) => x.tipo === "piedras" && nombreDe(d.lanes[x.carriles[0] as number] as number) === nombreDe(quien)).map((x) => ({ t: d.tDeQ(x.q) - AVISO_PIEDRAS, quien: d.lanes[x.carriles[0] as number] as number }));
            for (const l of lineas.filter((x) => x.s === esperada)) {
              piedras++;
              const h = horas.find((x) => Math.abs(x.t - l.t) < 1e-6);
              expect(h, `n=${n} s=${s}: piedras a ${l.t.toFixed(2)}`).toBeDefined();
              // El hecho se anota solo si ningún otro suceso lo pisa en los 0,35 s siguientes; si va, es el de la víctima.
              if (l.hecho) expect(l.hecho).toEqual({ tipo: "freno", quien: h?.quien });
            }
          } else if (o.tipo === "salto") {
            const aviso = lineas.find((x) => x.s === TEXTOS_CARRERA.es.carValla);
            if (aviso) expect(aviso.t, `n=${n} s=${s}: aviso de la valla`).toBeCloseTo(d.tDeQ(o.q) - AVISO_VALLA, 6);
            const golpes = o.malas.map((m) => ({ quien: d.lanes[m] as number, t: d.tDeQ(o.llegan[m] as number) })).sort((a, b) => a.t - b.t);
            const juntas = golpes.length > 1 && (golpes[1] as { t: number }).t - (golpes[0] as { t: number }).t < ESP_MIN;
            if (juntas) {
              if (lineas.some((x) => x.s === TEXTOS_CARRERA.es.carTumbanValla)) vallas++;
            } else for (const g of golpes) {
              const esperada = (TEXTOS_CARRERA.es.carTumbaValla as (x: string) => string)(nombreDe(g.quien));
              const l = lineas.find((x) => x.s === esperada);
              if (l) {
                vallas++;
                expect(l.t, `n=${n} s=${s}: tumba la valla`).toBeCloseTo(g.t, 6);
                if (l.hecho) expect(l.hecho).toEqual({ tipo: "freno", quien: g.quien });
              }
            }
          } else if (o.tipo === "escupida") {
            const quien = d.lanes[o.carriles[0] as number] as number;
            const esperada = (TEXTOS_CARRERA.es.carEscupen as (x: string) => string)(nombreDe(quien));
            // Con la gota en el aire: una décima después de que sale. Cada línea con su nombre cae a la hora de una escupida que recibe.
            const horas = (d.final.obstaculos ?? []).filter((x) => x.tipo === "escupida" && nombreDe(d.lanes[x.carriles[0] as number] as number) === nombreDe(quien)).map((x) => ({ t: d.tDeQ(x.q) + 0.1, quien: d.lanes[x.carriles[0] as number] as number }));
            for (const l of lineas.filter((x) => x.s === esperada)) {
              escupidas++;
              const h = horas.find((x) => Math.abs(x.t - l.t) < 1e-6);
              expect(h, `n=${n} s=${s}: escupida a ${l.t.toFixed(2)}`).toBeDefined();
              if (l.hecho) expect(l.hecho).toEqual({ tipo: "freno", quien: h?.quien });
            }
          } else {
            const l = lineas.find((x) => x.s === TEXTOS_CARRERA.es.carRemolino);
            if (l) {
              remolinos++;
              expect(l.t, `n=${n} s=${s}: remolino`).toBeCloseTo(d.tDeQ(o.q) - AVISO_REMOLINO, 6);
              expect(l.hecho).toBeUndefined();
            }
            // El viento no anota a nadie en los sucesos.
            for (const su of d.sucesos) if (su.tipo === "freno" && Math.abs(su.desde - d.tDeQ(o.q)) < 0.05) expect(o.carriles.map((k) => d.lanes[k] as number)).not.toContain(su.quien);
          }
        }
        // Ninguna línea vieja de obstáculo sin nombre.
        for (const l of lineas) expect(["¡Caen piedras del cerro!", "¡Alguien salta mal!", "¡Ráfaga del altiplano!"]).not.toContain(l.s);
      }
    }
    expect(piedras).toBeGreaterThan(0);
    expect(vallas).toBeGreaterThan(0);
    expect(remolinos).toBeGreaterThan(0);
    expect(escupidas).toBeGreaterThan(0);
  });

  it("con 18 personas las líneas de obstáculo no se amontonan ni se multiplican", () => {
    for (let s = 1; s <= 20; s++) {
      const plan = planCarrera(ctxDe(18, s));
      // La dirección pide de 12 a 16 líneas en todo el show y con 18 personas hay de 25 a 29 (mediana 27, 150 rondas): bajar a eso es recortar la
      // largada y el grupo, que no es de este cambio. Lo que sí se cuida acá es que nombrar a las víctimas no agregue líneas: cada obstáculo dice dos
      // como mucho (la valla, el aviso y el golpe; los demás, una). Con las ventanas C la recta trae de tres a cinco obstáculos y, medido con 150
      // rondas, de 2 a 5 líneas de obstáculo (antes de las ventanas C, de 1 a 3); las líneas de la recta siguen siendo de 5 a 9.
      const lineas = lineasDe(plan);
      expect(lineas.length, `semilla ${s}: ${lineas.map((l) => l.s).join(" / ")}`).toBeGreaterThanOrEqual(12);
      const deObstaculo = lineas.filter((l) => l.s === TEXTOS_CARRERA.es.carRemolino || l.s === TEXTOS_CARRERA.es.carValla || l.s === TEXTOS_CARRERA.es.carTumbanValla || l.s.startsWith("¡Cuidado,") || l.s.startsWith("¡Le escupen a") || l.s.includes("tumba la valla!"));
      expect(deObstaculo.length, `semilla ${s}`).toBeGreaterThanOrEqual(1);
      expect(deObstaculo.length, `semilla ${s}: ${deObstaculo.map((l) => l.s).join(" / ")}`).toBeLessThanOrEqual(2 * (plan.datos.final.obstaculos ?? []).length);
      expect(deObstaculo.length, `semilla ${s}: ${deObstaculo.map((l) => l.s).join(" / ")}`).toBeLessThanOrEqual(5);
      const deUnaLlama = deObstaculo.filter((l) => l.s.startsWith("¡Cuidado,") || l.s.startsWith("¡Le escupen a")).length;
      expect(deUnaLlama, `semilla ${s}`).toBeLessThanOrEqual((plan.datos.final.obstaculos ?? []).filter((o) => o.tipo === "piedras" || o.tipo === "escupida").length);
      for (const l of deObstaculo) for (const otra of lineas) if (otra !== l) expect(Math.abs(otra.t - l.t), `semilla ${s}: «${l.s}» contra «${otra.s}»`).toBeGreaterThanOrEqual(ESP_MIN - 0.21);
    }
  });
});
