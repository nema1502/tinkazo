import { describe, expect, it } from "vitest";
import {
  ACORDES,
  CANDIDATAS,
  DATOS_PIEZA,
  METAS,
  PERFIL_BASE,
  PIEZAS,
  TIEMPOS_FINAL,
  VUELTAS_PENTATONICAS,
  candidataDe,
  curvaDeTecho,
  densidadMaxima,
  enLaEscala,
  esEleccion,
  finDeVoz,
  hzDeGrado,
  hzDeSemitono,
  problemasDeCandidata,
  semitonosDeGrado,
  type Candidata,
  type CandidataEfecto,
  type CandidataMusica,
  type Golpe,
} from "./carrera";

const efecto = (pieza: CandidataEfecto["pieza"], id: string): CandidataEfecto => candidataDe(pieza, id) as CandidataEfecto;
const conVoces = (c: CandidataEfecto, variante: number, voces: Golpe[]): CandidataEfecto => ({ ...c, variantes: c.variantes.map((v, i) => (i === variante ? voces : v)) });

describe("las seis piezas de la carrera", () => {
  it("son seis, con tres candidatas cada una (a, b y c) y un nombre y un carácter propios", () => {
    expect(PIEZAS).toEqual(["musica", "pasos", "echarse", "obstaculos", "final", "festejo"]);
    for (const pieza of PIEZAS) {
      const cs = CANDIDATAS[pieza];
      expect(cs.map((c) => c.id), pieza).toEqual(["a", "b", "c"]);
      expect(new Set(cs.map((c) => c.nombre)).size, pieza).toBe(3);
      expect(new Set(cs.map((c) => c.caracter)).size, pieza).toBe(3);
      for (const c of cs) {
        expect(c.pieza).toBe(pieza);
        expect(c.caracter.length).toBeGreaterThan(30);
      }
      expect(DATOS_PIEZA[pieza].titulo.length).toBeGreaterThan(0);
    }
  });

  it("cada candidata cumple lo que se puede juzgar sin oídos: escala, registro, volumen, silencio y una sola fanfarria", () => {
    for (const pieza of PIEZAS) for (const c of CANDIDATAS[pieza]) expect(problemasDeCandidata(c), `${pieza}/${c.id}`).toEqual([]);
  });

  it("ninguna candidata usa campanas, monedas ni voces de animal: ni una palabra de eso en su descripción", () => {
    const prohibidas = /campan|moneda|sirena|casino|resopl|relinch|cerdo|bocina|jackpot/i;
    for (const pieza of PIEZAS) for (const c of CANDIDATAS[pieza]) expect(`${c.nombre} ${c.caracter}`, `${pieza}/${c.id}`).not.toMatch(prohibidas);
  });

  it("las elecciones válidas son hoy, base y las tres candidatas", () => {
    for (const e of ["hoy", "base", "a", "b", "c"]) expect(esEleccion(e)).toBe(true);
    for (const e of ["ninguno", "d", "", "A"]) expect(esEleccion(e)).toBe(false);
  });
});

describe("la escala de la casa", () => {
  it("la escala de los efectos es la de sound.ts: do pentatónico desde 130,81 Hz", () => {
    const esperado = [130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0];
    esperado.forEach((hz, d) => expect(hzDeGrado(d)).toBeCloseTo(hz, 0));
    expect(hzDeGrado(20)).toBeCloseTo(2093, -1);
  });

  it("la pentatónica de la menor de la música tiene las mismas cinco notas que la de do mayor de los efectos", () => {
    const clases = (hzs: number[]): number[] => [...new Set(hzs.map((hz) => ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12))].sort((a, b) => a - b);
    expect(clases(Array.from({ length: 10 }, (_, d) => hzDeGrado(d)))).toEqual([0, 3, 5, 7, 10]);
    expect(clases(Array.from({ length: 10 }, (_, d) => hzDeSemitono(semitonosDeGrado(d))))).toEqual([0, 3, 5, 7, 10]);
  });

  it("todas las cuerdas de todos los acordes de la banda son de la escala (el si no está)", () => {
    for (const [id, a] of Object.entries(ACORDES)) {
      expect(enLaEscala(a.raiz), `raíz de ${id}`).toBe(true);
      for (const s of a.cuerdas) expect(enLaEscala(s), `${id}: ${s}`).toBe(true);
    }
    for (const v of VUELTAS_PENTATONICAS) expect(v).toHaveLength(8);
    expect(enLaEscala(2)).toBe(false);
  });
});

describe("la música", () => {
  const musicas = CANDIDATAS.musica as CandidataMusica[];

  it("arranca a 100 golpes por minuto, sube a 112 en el grupo y a 124 en la recta", () => {
    expect([...METAS.bpm]).toEqual([100, 112, 124]);
    for (const c of musicas) expect([...c.perfil.bpm], c.id).toEqual([100, 112, 124]);
  });

  it("las tres suenan distinto: no comparten el arreglo", () => {
    const huellas = musicas.map((c) => JSON.stringify([c.perfil.capas, c.perfil.charango, c.perfil.zamponaDesde]));
    expect(new Set(huellas).size).toBe(3);
  });

  it("todas tienen bombo, y el ajuste de volumen sube la música del nivel de hoy sin ser absurdo", () => {
    for (const c of musicas) {
      expect(c.perfil.capas.bombo, c.id).toBeGreaterThan(0);
      expect(c.perfil.trim, c.id).toBeGreaterThan(1);
      expect(c.perfil.trim, c.id).toBeLessThan(6);
    }
  });

  it("una música con otro ritmo o una cuerda fuera de la escala se rechaza", () => {
    const base = musicas[0] as CandidataMusica;
    expect(problemasDeCandidata({ ...base, perfil: { ...base.perfil, bpm: [96, 112, 132] } }).join()).toMatch(/ritmo/);
    expect(problemasDeCandidata({ ...base, perfil: { ...base.perfil, capas: { ...base.perfil.capas, bombo: 0 } } }).join()).toMatch(/bombo/);
  });
});

describe("los pasos, echarse y los obstáculos", () => {
  it("los pasos son dos pies que se alternan, cortos, y nunca más de dos por segundo cada uno", () => {
    for (const c of CANDIDATAS.pasos as CandidataEfecto[]) {
      expect(c.variantes, c.id).toHaveLength(2);
      for (const v of c.variantes) {
        expect(Math.max(...v.map(finDeVoz)), c.id).toBeLessThanOrEqual(0.15);
        expect(densidadMaxima(v), c.id).toBeLessThanOrEqual(METAS.densidad);
      }
    }
  });

  it("los pasos tienen el volumen de un fondo (de 0,02 a 0,03 en las notas) y la nota es de la escala", () => {
    for (const c of CANDIDATAS.pasos as CandidataEfecto[])
      for (const v of c.variantes)
        for (const g of v)
          if (g.k === "nota") {
            expect(g.g, c.id).toBeGreaterThanOrEqual(METAS.volumenMin);
            expect(g.g, c.id).toBeLessThanOrEqual(0.03);
            expect(Number.isInteger(g.grado)).toBe(true);
          }
  });

  it("echarse son dos notas que bajan (se acuesta, no perdió) y dura de 0,3 a 0,8 s", () => {
    for (const c of CANDIDATAS.echarse as CandidataEfecto[]) {
      const v = c.variantes[0] as readonly Golpe[];
      const fin = Math.max(...v.map(finDeVoz));
      expect(fin, c.id).toBeGreaterThanOrEqual(0.3);
      expect(fin, c.id).toBeLessThanOrEqual(0.8);
      expect(densidadMaxima(v), c.id).toBeLessThanOrEqual(METAS.densidad);
    }
    // Una segunda nota que sube no es echarse.
    const c = efecto("echarse", "a");
    const sube = conVoces(c, 0, [{ k: "nota", t: 0, grado: 7, dur: 0.3, tipo: "sine", g: 0.05 }, { k: "nota", t: 0.17, grado: 9, dur: 0.3, tipo: "sine", g: 0.05 }]);
    expect(problemasDeCandidata(sube).join()).toMatch(/no baja/);
  });

  it("los obstáculos traen piedras, viento (1,5 s) y valla, en ese orden", () => {
    for (const c of CANDIDATAS.obstaculos as CandidataEfecto[]) {
      expect(c.etiquetas, c.id).toEqual(["piedras", "viento", "valla"]);
      expect(c.variantes, c.id).toHaveLength(3);
      const viento = c.variantes[1] as readonly Golpe[];
      expect(Math.max(...viento.map(finDeVoz)), c.id).toBeCloseTo(1.5, 1);
      // Las piedras traen un crujido (ruido) que se oye en un parlante chico: nada de un seno grave solo.
      expect((c.variantes[0] as readonly Golpe[]).some((g) => g.k === "ruido"), c.id).toBe(true);
    }
  });

  it("ninguna nota cae por debajo del corte de 150 Hz ni queda fuera del parlante de un proyector", () => {
    for (const pieza of ["pasos", "echarse", "obstaculos", "final", "festejo"] as const)
      for (const c of CANDIDATAS[pieza] as CandidataEfecto[])
        for (const v of c.variantes)
          for (const g of v)
            if (g.k === "nota") {
              const hz = hzDeGrado(g.grado);
              expect(hz, `${pieza}/${c.id}`).toBeGreaterThanOrEqual(METAS.hz[0]);
              expect(hz, `${pieza}/${c.id}`).toBeLessThanOrEqual(METAS.hz[1]);
              expect(hz * (g.cae ?? 1), `${pieza}/${c.id}`).toBeGreaterThanOrEqual(150);
            }
  });

  it("una nota por debajo del murmullo o de un soplo bajo 250 Hz se rechaza", () => {
    const c = { ...efecto("pasos", "a"), nivel: 1 };
    expect(problemasDeCandidata(conVoces(c, 0, [{ k: "nota", t: 0, grado: 5, dur: 0.07, tipo: "sine", g: 0.01 }])).join()).toMatch(/volumen/);
    expect(problemasDeCandidata(conVoces(c, 0, [{ k: "ruido", t: 0, filtro: "lowpass", hz: 120, dur: 0.05, g: 0.1 }])).join()).toMatch(/pierde/);
    expect(problemasDeCandidata(conVoces(c, 0, [{ k: "nota", t: 0, grado: 0, dur: 0.07, tipo: "sine", g: 0.03, cae: 0.5 }])).join()).toMatch(/150 Hz/);
  });
});

describe("el final: bombo, clic, silencio y golpe", () => {
  const finales = CANDIDATAS.final as CandidataEfecto[];
  const voces = (c: CandidataEfecto): readonly Golpe[] => c.variantes[0] as readonly Golpe[];

  it("el bombo va al pulso de la recta (124 golpes por minuto), crece golpe a golpe y se calla antes del clic", () => {
    for (const c of finales) {
      const pulsos = voces(c).filter((g) => g.ev === "pulso" && g.k === "bombo");
      expect(pulsos.length, c.id).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < pulsos.length; i++) {
        expect(pulsos[i]!.t - pulsos[i - 1]!.t, c.id).toBeCloseTo(60 / 124, 2);
        expect((pulsos[i] as { v: number }).v, c.id).toBeGreaterThan((pulsos[i - 1] as { v: number }).v);
      }
      expect(pulsos.at(-1)!.t, c.id).toBeLessThan(TIEMPOS_FINAL.cruce);
    }
  });

  it("del clic al golpe pasa un segundo, la banda se corta en el cruce y no suena nada nuevo en el medio", () => {
    for (const c of finales) {
      const v = voces(c);
      const clic = Math.min(...v.filter((g) => g.ev === "clic").map((g) => g.t));
      const abre = v.find((g) => g.k === "abre") as Golpe;
      expect(clic, c.id).toBeCloseTo(TIEMPOS_FINAL.cruce, 1);
      expect(abre.t - clic, c.id).toBeGreaterThanOrEqual(0.986);
      expect(abre.t - clic - 0.05, c.id).toBeGreaterThanOrEqual(METAS.silencioS);
      const corte = v.find((g) => g.k === "corte") as Golpe;
      expect(corte.t - clic, c.id).toBeLessThanOrEqual(0.05);
      const entre = v.filter((g) => g.t > clic + 0.05 && g.t < abre.t && g.k !== "corte");
      expect(entre, c.id).toEqual([]);
    }
  });

  it("el golpe es uno solo y sus voces caen a menos de 100 ms entre sí", () => {
    for (const c of finales) {
      const golpe = voces(c).filter((g) => g.ev === "golpe");
      expect(golpe.length, c.id).toBeGreaterThanOrEqual(3);
      const ts = golpe.map((g) => g.t);
      expect(Math.max(...ts) - Math.min(...ts), c.id).toBeLessThanOrEqual(0.1);
      expect(Math.min(...ts), c.id).toBeCloseTo(TIEMPOS_FINAL.golpe, 2);
    }
  });

  it("es un acorde de bombo, charango y zampoña, o su equivalente con palmas", () => {
    const a = voces(efecto("final", "a")).filter((g) => g.ev === "golpe").map((g) => g.k);
    expect(a).toContain("bombo");
    expect(a).toContain("charango");
    expect(a).toContain("zampona");
  });

  it("un final con una voz en el silencio, con dos golpes o con el bombo sobre el clic se rechaza", () => {
    const c = efecto("final", "a");
    const v = voces(c);
    expect(problemasDeCandidata(conVoces(c, 0, [...v, { k: "bombo", t: 3.5, v: 1 }])).join()).toMatch(/silencio/);
    expect(problemasDeCandidata(conVoces(c, 0, [...v, { k: "bombo", t: 4.6, v: 1, ev: "golpe" }])).join()).toMatch(/2 golpes/);
    expect(problemasDeCandidata(conVoces(c, 0, v.filter((g) => g.k !== "corte"))).join()).toMatch(/corte/);
    expect(problemasDeCandidata(conVoces(c, 0, v.map((g) => (g.ev === "pulso" ? { ...g, v: 0.5 } : g)))).join()).toMatch(/no crece/);
  });
});

describe("el festejo", () => {
  it("dura de 2 a 3 s, no pisa el golpe y toda su música es del festejo", () => {
    for (const c of CANDIDATAS.festejo as CandidataEfecto[]) {
      const v = c.variantes[0] as readonly Golpe[];
      const fin = Math.max(...v.map(finDeVoz));
      expect(fin, c.id).toBeGreaterThanOrEqual(METAS.festejoS[0]);
      expect(fin, c.id).toBeLessThanOrEqual(METAS.festejoS[1]);
      expect(Math.min(...v.map((g) => g.t)), c.id).toBeGreaterThanOrEqual(0.25);
      expect(v.every((g) => g.ev === "festejo"), c.id).toBe(true);
    }
  });

  it("un festejo de cuatro segundos se rechaza", () => {
    const c = efecto("festejo", "b");
    const largo = conVoces(c, 0, [...(c.variantes[0] as readonly Golpe[]), { k: "zampona", t: 2.5, grado: 8, dur: 1.5, pan: 0, v: 0.5, ev: "festejo" }]);
    expect(problemasDeCandidata(largo).join()).toMatch(/festejo dura/);
  });
});

describe("la búsqueda", () => {
  it("encuentra una candidata por pieza e id y no inventa otras", () => {
    const c = candidataDe("pasos", "b") as Candidata;
    expect(c.nombre).toBe("Madera");
    expect(candidataDe("pasos", "z")).toBeUndefined();
  });
});

describe("el techo suave de la música", () => {
  it("deja pasar igual lo que está por debajo de la rodilla, no pasa del techo y no baja nunca", () => {
    const k = 0.72;
    const c = curvaDeTecho(k);
    const y = (x: number): number => c[Math.round(((x + 1) / 2) * (c.length - 1))] as number;
    expect(y(0)).toBe(0);
    expect(y(0.5)).toBeCloseTo(0.5, 2);
    expect(y(-0.7)).toBeCloseTo(-0.7, 2);
    expect(y(1)).toBeCloseTo((1 + k) / 2, 3);
    expect(y(-1)).toBeCloseTo(-(1 + k) / 2, 3);
    // El techo de 0,72 está en -1,3 dBFS: ni una muestra pasa de -1 dBFS.
    expect(20 * Math.log10(y(1))).toBeLessThan(-1);
    for (let i = 1; i < c.length; i++) expect(c[i] as number).toBeGreaterThanOrEqual(c[i - 1] as number);
  });
});

describe("los niveles medidos", () => {
  it("cada candidata tiene su nivel y la música de base también", () => {
    for (const pieza of PIEZAS) for (const c of CANDIDATAS[pieza]) {
      if (c.pieza === "musica") expect(c.perfil.trim, c.id).toBeGreaterThan(0);
      else expect(c.nivel ?? 1, `${pieza}/${c.id}`).toBeGreaterThan(0);
    }
    expect(PERFIL_BASE.trim).toBeGreaterThan(1);
  });
});
