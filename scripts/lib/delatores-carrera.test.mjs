import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeStory } from "../../src/games/drama";
import { TEXTOS_CARRERA } from "../../src/games/llamas/carrera-textos";
import { alfabetico, corto, planCarrera, RECTA } from "../../src/games/llamas/carrera-show";
import { formaDe } from "../../src/games/llamas/carrera-forma";
import { filaDeRango } from "../../src/games/llamas/carrera-caminata";
import { paresDelTropiezo, victimaDelTropiezo } from "../../src/games/llamas/carrera-piedritas";
import { formaDelGrupo } from "../../src/games/llamas/carrera-filas";
import { subfilasDe } from "../../src/games/llamas/carrera-trayectorias";
import { CUERPO } from "../../src/games/llamas/carrera-marcha";
import { ENSANCHE } from "../../src/games/llamas/carrera-obstaculos";
import { azarDe, sembrar } from "../../src/games/pixi/kit/azar";
import { listHash } from "../../src/protocol/canonical";
import { select } from "../../src/protocol/select";
import { crearAcumulado, evaluarMedia, evaluarReparto, evaluarSenal, probsDelAcumulado, sumarAlAcumulado } from "./delatores.mjs";
import { cuentaComo, FILAS_A_MIRAR, franjaDePuestos, HUECO_VISIBLE, nombresDeAuditoria, observar, rondaDe, semillaDe, senalesDeLaRecta, senalesDeLaSubfila, subidaGrande } from "./delatores-carrera.mjs";

/** Lo que carga `cargarCarrera` con Vite, acá importado directo (Vitest ya entiende el TypeScript del repositorio). */
const filasDelGrupo = (d, W, H) => {
  const u = W < H ? Math.min(W / 420, H / 900) : H / 720;
  const P = { w: W, h: H, u, retrato: W < H, top: 60 * u, bottom: H - 90 * u };
  const cuerpo = CUERPO * ENSANCHE * RECTA * W;
  const grupo = formaDelGrupo({ P, d, nombrePx: 16 * u, nombreW: 110 * u, cuerpoPx: cuerpo });
  const deHoy = formaDe(P, Math.max(1, d.gente.length), 16 * u, 110 * u);
  const signo = subfilasDe(d, grupo.forma, (p) => grupo.filaDeLugar[d.orden.rango(p)], cuerpo).signo;
  return { forma: grupo.forma, filaDeLugar: grupo.filaDeLugar, filasDeHoy: deHoy.filas, signo };
};
const lib = { planCarrera, alfabetico, sembrar, azarDe, textos: TEXTOS_CARRERA, writeStory, select, listHash, filasDelGrupo, filaDeRango, victimaDelTropiezo, paresDelTropiezo, CUERPO };

/** Una ronda del auditor. `op` va a `planCarrera` (por ejemplo `{ senuelos: false }`, la carrera de antes de la marcha pareja). */
function ronda(n, i, op = {}) {
  const r = rondaDe(lib, n, i);
  const plan = planCarrera(r.ctx, op);
  return { ...r, plan, o: observar(lib, plan, r.ctx) };
}

describe("la lista y la semilla de la auditoría", () => {
  it("los nombres son únicos y ya son su forma corta, como los dice el relator", () => {
    for (const n of [8, 18, 30, 60, 200]) {
      const nombres = nombresDeAuditoria(n);
      expect(new Set(nombres).size, `n=${n}`).toBe(n);
      expect(nombres.map(corto), `n=${n}`).toEqual(nombres);
    }
  });

  it("la semilla es de 64 hex y cambia con la ronda", () => {
    expect(semillaDe(1)).toMatch(/^[0-9a-f]{64}$/);
    expect(semillaDe(1)).not.toBe(semillaDe(2));
    expect(semillaDe(7)).toBe(semillaDe(7));
  });

  it("la ganadora de la ronda es la de la selección del protocolo con esa semilla", () => {
    for (const n of [8, 18, 200]) {
      const { ganador, nombres, ronda: semilla } = rondaDe(lib, n, 5);
      const bytes = Uint8Array.from(semilla.match(/../g), (h) => parseInt(h, 16));
      expect(ganador).toBe(select(bytes, listHash(nombres), n, 1)[0]);
    }
  });
});

describe("lo que ve la sala en una ronda", () => {
  it("con 18: la punta, el tiempo en la punta, las echadas, la entrada y la recta", () => {
    const { o, plan } = ronda(18, 3);
    expect(o.arco).toBe(plan.arco);
    expect(o.revelado).toBe(plan.datos.tCrown);
    for (const s of ["punta-inicio", "punta-25", "punta-50", "punta-75", "tiempo-mitad", "tiempo-fin", "echa-primera", "echa-mitad", "echa-ultima", "recta-90", "nombra-primero", "nombra-ultimo", "nombra-mas", "drama", "subida-3", "caida-3", "subida-3-al-T3", "rapida-al-corte", "hueco-al-corte", "punta-repetida", "atraso-vuelve", "adelanto-vuelve"]) {
      expect(o.senales, s).toHaveProperty(s);
    }
    // Las filas de más y la fila compartida dependen de la ronda.
    const escritorio = filasDelGrupo(plan.datos, 1366, 768);
    const variables = [...(escritorio.forma.filas > escritorio.filasDeHoy ? ["entrada-con-filas-de-mas"] : []), ...(o.repartos["fila-compartida"] ? ["fila-compartida"] : [])];
    // La subfila solo si la ganadora va fuera de la línea (en el celular parado, con 18, todas las filas son de una y van en la línea).
    const celular = filasDelGrupo(plan.datos, 390, 844);
    if (escritorio.signo.get(plan.datos.campeona)) variables.push("subfila");
    if (celular.signo.get(plan.datos.campeona)) variables.push("subfila-celular");
    if (o.repartos["fila-dibujo"]) variables.push("fila-dibujo");
    if (o.repartos["fila-dibujo-celular"]) variables.push("fila-dibujo-celular");
    if (o.repartos.tropiezo) variables.push("tropiezo");
    // Los cortes y la única de su lado de la subfila, si la ronda los tiene (los mide `senalesDeLaSubfila`, más abajo).
    for (const s of ["subfila-corte", "subfila-corte-celular", "subfila-sola", "subfila-sola-celular"]) if (o.repartos[s]) variables.push(s);
    expect(Object.keys(o.repartos).sort()).toEqual(["carril", "entrada", "fila-grupo", "fila-grupo-celular", "recta-25", "recta-50", "recta-75", "recta-T15", "recta-T3", ...variables].sort());
    // Los obstáculos le tocan a cualquiera y los momentos de la recta dependen de la historia: sus medias dependen de cuáles tiene la ronda.
    expect(Object.keys(o.medias).filter((k) => !k.startsWith("obstaculo-") && !k.startsWith("momento-") && k !== "susto").sort()).toEqual(["echa-orden-lista", "tiempo-dif"]);
    // Sin tandas: ni tanda, ni portón, ni "la última en pasar".
    expect(o.repartos.tanda).toBeUndefined();
    expect(o.senales["punta-corral"]).toBeUndefined();
  });

  it("la entrada es el puesto de la ganadora cuando se abre la recta", () => {
    for (let i = 1; i <= 20; i++) {
      const { o, plan } = ronda(18, i);
      const d = plan.datos;
      expect(d.vivas(d.tAbre)[o.repartos.entrada.k]).toBe(d.campeona);
      expect(o.repartos.entrada.K).toBe(8);
    }
  });

  it("la fila del grupo es la de la ganadora, contra el cupo de cada fila, y las filas de más solo aparecen cuando el grupo las tiene", () => {
    for (let i = 1; i <= 20; i++) {
      const { o, plan } = ronda(18, i);
      const d = plan.datos;
      for (const [clave, W, H] of [["fila-grupo", 1366, 768], ["fila-grupo-celular", 390, 844]]) {
        const g = filasDelGrupo(d, W, H);
        const r = o.repartos[clave];
        expect(r, `${i} ${clave}`).toBeDefined();
        expect(r.K).toBe(g.forma.filas);
        expect(r.k).toBe(g.filaDeLugar[d.orden.rango(d.campeona)]);
        expect(r.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        expect(o.tiempos[clave]).toBeCloseTo(d.tSalida + 0.6, 9);
      }
      const escritorio = filasDelGrupo(d, 1366, 768);
      if (escritorio.forma.filas > escritorio.filasDeHoy) {
        expect(o.repartos["entrada-con-filas-de-mas"]).toEqual({ K: o.repartos.entrada.K, k: o.repartos.entrada.k });
      } else {
        expect(o.repartos["entrada-con-filas-de-mas"]).toBeUndefined();
      }
    }
  });

  it("la fila del dibujo: si la ganadora larga fuera del dibujo de siempre, contra la parte de la gente que larga fuera; y la fila lo ve si las demás prefieren su fila de siempre", () => {
    let medidas = 0;
    // Lo que se juzga, sumado como lo suma el auditor: los conteos y la media de las probabilidades de cada ronda.
    const juzgar = (obs) => {
      const conteos = [0, 0], suma = [0, 0];
      for (const r of obs) {
        conteos[r.k]++;
        suma[0] += r.probs[0];
        suma[1] += r.probs[1];
      }
      return evaluarReparto(conteos, suma.map((v) => v / obs.length));
    };
    const reales = [], conPista = [];
    for (let i = 1; i <= 200; i++) {
      const { o, plan, ctx } = ronda(18, i);
      const d = plan.datos;
      for (const [clave, W, H] of [["fila-dibujo", 1366, 768], ["fila-dibujo-celular", 390, 844]]) {
        const g = filasDelGrupo(d, W, H);
        const fuera = (p) => g.filaDeLugar[d.orden.rango(p)] !== filaDeRango(d.orden.rango(p), g.forma.filas);
        const parte = d.gente.filter(fuera).length / d.gente.length;
        const r = o.repartos[clave];
        if (!(parte > 0 && parte < 1)) {
          expect(r).toBeUndefined();
          continue;
        }
        medidas++;
        expect(r).toEqual({ K: 2, k: fuera(d.campeona) ? 1 : 0, probs: [1 - parte, parte] });
        expect(o.tiempos[clave]).toBe(d.tSalida);
        if (clave === "fila-dibujo") reales.push(r);
      }
      // El reparto que la lectura de afuera encontró el 12 de noviembre: las finalistas en la fila de su carril y las demás en su fila de
      // siempre (acá, cada finalista cambia su fila con una de las demás). La fila del auditor lo tiene que ver.
      const conLaPista = (dd, W, H) => {
        const g = filasDelGrupo(dd, W, H);
        const F = g.forma.filas;
        const filas = Array.from({ length: dd.gente.length }, (_, r) => filaDeRango(r, F));
        const azar = sembrar(dd.semillaFilas | 0);
        for (const p of dd.lanes) {
          const r = dd.orden.rango(p);
          if (r < 0) continue;
          const otras = filas.map((f, q) => q).filter((q) => filas[q] !== filas[r] && !dd.lanes.some((x) => dd.orden.rango(x) === q));
          const q = otras[Math.floor(azar() * otras.length)];
          if (q !== undefined) [filas[r], filas[q]] = [filas[q], filas[r]];
        }
        return { ...g, filaDeLugar: filas };
      };
      const ob = observar({ ...lib, filasDelGrupo: conLaPista }, plan, ctx);
      if (ob.repartos["fila-dibujo"]) conPista.push(ob.repartos["fila-dibujo"]);
    }
    expect(medidas).toBeGreaterThan(300);
    expect(juzgar(reales).veredicto, JSON.stringify(juzgar(reales).conteos)).not.toBe("delator");
    expect(juzgar(conPista).veredicto, JSON.stringify(juzgar(conPista).conteos)).toBe("delator");
  }, 300_000);

  it("el tropiezo: si la víctima del plan es la ganadora, contra su parte de los pares (llama, tramo de piedras), a la hora del tramo", () => {
    let medidas = 0, deLaGanadora = 0;
    for (let i = 1; i <= 60; i++) {
      const { o, plan } = ronda(18, i);
      const d = plan.datos;
      const e = { semilla: d.semillaRocas, tramos: d.tramos, gente: d.gente, cae: (p) => d.tiempos.cae.get(p) ?? Infinity };
      const v = victimaDelTropiezo(e);
      const r = o.repartos.tropiezo;
      if (!v) {
        expect(r).toBeUndefined();
        continue;
      }
      medidas++;
      const pares = paresDelTropiezo(e);
      const p = pares.filter(([q]) => q === d.campeona).length / pares.length;
      expect(r).toEqual({ K: 2, k: v.quien === d.campeona ? 1 : 0, probs: [1 - p, p] });
      expect(o.tiempos.tropiezo).toBe(d.tramos[v.tramo].t0);
      if (r.k) deLaGanadora++;
    }
    expect(medidas).toBeGreaterThan(20);
    expect(deLaGanadora).toBeLessThan(medidas);
  });

  it("tropiezo-finalista: si la que tropieza es finalista, contra la parte de finalistas entre las que corren al empezar su tramo; ve la regla de antes", () => {
    // La regla de antes: la víctima entre las que siguen en pie al terminar el tramo.
    const libAntes = { ...lib, victimaDelTropiezo: (e) => victimaDelTropiezo(e, false), paresDelTropiezo: (e) => paresDelTropiezo(e, false) };
    const hoy = crearAcumulado(2), antes = crearAcumulado(2);
    let medidas = 0;
    for (let i = 1; i <= 120; i++) {
      const r = rondaDe(lib, 18, i);
      const plan = planCarrera(r.ctx);
      const d = plan.datos;
      const o = observar(lib, plan, r.ctx);
      const e = { semilla: d.semillaRocas, tramos: d.tramos, gente: d.gente, cae: (p) => d.tiempos.cae.get(p) ?? Infinity };
      const v = victimaDelTropiezo(e);
      const x = o.repartos["tropiezo-finalista"];
      if (v) {
        const tramo = d.tramos[v.tramo];
        const corren = d.gente.filter((p) => e.cae(p) >= tramo.t0);
        const pf = corren.filter((p) => d.lanes.includes(p)).length / corren.length;
        if (pf > 0 && pf < 1) {
          medidas++;
          expect(x).toEqual({ K: 2, k: d.lanes.includes(v.quien) ? 1 : 0, probs: [1 - pf, pf] });
          expect(o.tiempos["tropiezo-finalista"]).toBe(tramo.t0);
        } else expect(x).toBeUndefined();
      } else expect(x).toBeUndefined();
      if (x) sumarAlAcumulado(hoy, x);
      const xa = observar(libAntes, plan, r.ctx).repartos["tropiezo-finalista"];
      if (xa) sumarAlAcumulado(antes, xa);
    }
    expect(medidas).toBeGreaterThan(40);
    // Con la regla de antes, con 18 personas, la que tropieza es casi siempre finalista (no se echa en ese tramo): la fila lo ve. Con la de ahora, no.
    const evAntes = evaluarReparto(antes.conteos, probsDelAcumulado(antes));
    expect(evAntes.veredicto, `${JSON.stringify(evAntes.conteos)} contra ${JSON.stringify(evAntes.esperados)}`).toBe("delator");
    const evHoy = evaluarReparto(hoy.conteos, probsDelAcumulado(hoy));
    expect(evHoy.veredicto, `${JSON.stringify(evHoy.conteos)} contra ${JSON.stringify(evHoy.esperados)}`).not.toBe("delator");
  }, 300_000);

  it("la subfila es la de la ganadora, contra cuántas van arriba en toda la gente; la fila compartida, contra las finalistas", () => {
    let compartidas = 0, medidas = 0;
    for (let i = 1; i <= 20; i++) {
      const { o, plan } = ronda(30, i);
      const d = plan.datos;
      for (const [clave, W, H] of [["subfila", 1366, 768], ["subfila-celular", 390, 844]]) {
        const g = filasDelGrupo(d, W, H);
        const r = o.repartos[clave];
        // Sola en su fila, va en la línea: no hay lado que medir.
        if (!g.signo.get(d.campeona)) {
          expect(r, `${i} ${clave}`).toBeUndefined();
          continue;
        }
        medidas++;
        expect(r.K).toBe(2);
        expect(r.k).toBe(g.signo.get(d.campeona) === -1 ? 0 : 1);
        const arriba = d.gente.filter((p) => g.signo.get(p) === -1).length;
        const fuera = d.gente.filter((p) => g.signo.get(p)).length;
        expect(r.probs[0]).toBeCloseTo(arriba / fuera, 12);
        expect(r.probs[0] + r.probs[1]).toBeCloseTo(1, 12);
      }
      const g = filasDelGrupo(d, 1366, 768);
      const filaDe = (p) => g.filaDeLugar[d.orden.rango(p)];
      const comparte = (p) => d.lanes.some((q) => q !== p && filaDe(q) === filaDe(p));
      const r = o.repartos["fila-compartida"];
      const fraccion = d.lanes.filter(comparte).length / d.lanes.length;
      if (fraccion > 0 && fraccion < 1) {
        compartidas++;
        expect(r).toEqual({ K: 2, k: comparte(d.campeona) ? 1 : 0, probs: [1 - fraccion, fraccion] });
      } else expect(r).toBeUndefined();
    }
    expect(compartidas).toBeGreaterThan(0);
    expect(medidas).toBeGreaterThan(20);
  });

  it("con 60 hay tandas: la de la ganadora, su lugar en el portón y la última que pasó", () => {
    const { o, plan } = ronda(60, 4);
    const d = plan.datos;
    expect(o.repartos.tanda.K).toBe(3);
    expect(d.tandas[o.repartos.tanda.k].miembros).toContain(d.campeona);
    expect(o.repartos.tanda.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(o.repartos.porton.K).toBe(3);
    expect(d.tandas[o.repartos.tanda.k].pasan[o.repartos.porton.k]).toBe(d.campeona);
    expect(o.senales["punta-corral"]["la-ultima"]).toMatchObject({ azar: 1 / d.gente.length });
  });

  it("con 200 el grupo son las ocho de la final: ni punta, ni echadas, y una sola plaza por portón", () => {
    const { o } = ronda(200, 6);
    expect(o.repartos.tanda.K).toBe(8);
    expect(o.repartos.porton).toBeUndefined();
    expect(o.senales["punta-50"]).toBeUndefined();
    expect(Object.keys(o.medias).filter((k) => !k.startsWith("obstaculo-") && !k.startsWith("momento-") && k !== "susto")).toEqual([]);
    expect(o.repartos.entrada.K).toBe(8);
  });

  it("los casilleros caen adentro, los azares entre cero y uno, y las señales son las mismas con la misma ronda", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 12, 18, 30, 31, 60, 100, 200]) {
      for (let i = 1; i <= 12; i++) {
        const { o } = ronda(n, i);
        for (const [s, r] of Object.entries(o.repartos)) {
          expect(r.k, `${n}/${i} ${s}`).toBeGreaterThanOrEqual(0);
          expect(r.k, `${n}/${i} ${s}`).toBeLessThan(r.K);
        }
        for (const [s, reglas] of Object.entries(o.senales)) {
          for (const [nombre, obs] of Object.entries(reglas)) {
            if (obs === null) continue;
            expect(obs.azar, `${n}/${i} ${s}/${nombre}`).toBeGreaterThan(0);
            expect(obs.azar, `${n}/${i} ${s}/${nombre}`).toBeLessThan(1);
            expect(typeof obs.acierta).toBe("boolean");
          }
        }
        for (const [s, m] of Object.entries(o.medias)) expect(Number.isFinite(m.v), `${n}/${i} ${s}`).toBe(true);
        for (const [s, t] of Object.entries(o.tiempos)) expect(t, `${n}/${i} ${s}`).toBeLessThanOrEqual(o.revelado + 1e-9);
      }
    }
    expect(ronda(30, 9).o).toEqual(ronda(30, 9).o);
  }, 90_000);

  it("el relator se mide desde la salida: con tandas, quien pasa por el portón no es un nombre más", () => {
    const { o, plan } = ronda(100, 2);
    const lineas = plan.guion.filter((l) => l.texto !== undefined && l.t >= plan.datos.tSalida - 0.01);
    expect(lineas.length).toBeGreaterThan(0);
    // Las líneas de "¡Pasa X!" son de antes de la salida: no entran.
    expect(lineas.some((l) => /^¡Pasa /.test(l.texto()))).toBe(false);
    expect(o.senales["nombra-primero"]).toBeDefined();
  });
});

/**
 * Una recta armada a mano, con lo que leen las filas de la recta: `ordenes[c]` es el orden de los carriles (de la primera a la última) en la
 * compuerta `QS_A_MANO[c]`, a medio cuerpo una de otra, y entre compuertas cada lugar va en línea recta. `extra(k, t)` suma cuerpos al carril `k`
 * a la hora `t`. Las personas son 10, 11, 12... (no los carriles). La recta se abre a los 10 s y dura 20: a tres segundos de la meta es el 85 %.
 */
const QS_A_MANO = [0, 0.25, 0.5, 0.75, 0.85, 1];
function rectaAMano(ordenes, { w = 0, beats = [], arc = "duelo", marcha = {}, obstaculos = [], extra = () => 0 } = {}) {
  const L = ordenes[0].length;
  const y = ordenes.map((o) => {
    const v = new Array(L).fill(0);
    o.forEach((k, i) => (v[k] = -0.5 * i));
    return v;
  });
  const tDeQ = (q) => 10 + 20 * q;
  const lugar = (k, q) => {
    let c = 0;
    while (c + 2 < QS_A_MANO.length && q > QS_A_MANO[c + 1]) c++;
    const f = Math.max(0, Math.min(1, (q - QS_A_MANO[c]) / (QS_A_MANO[c + 1] - QS_A_MANO[c])));
    return y[c][k] + f * (y[c + 1][k] - y[c][k]);
  };
  const lanes = Array.from({ length: L }, (_, k) => 10 + k);
  const pos = (k, q) => q + (lugar(k, q) + extra(k, tDeQ(q))) * CUERPO + k * 1e-9;
  return {
    lanes,
    campeona: lanes[w],
    tAbre: 10,
    tCrown: 30,
    q: (t) => (t - 10) / 20,
    tDeQ,
    final: { lanes, pos, story: { arc, winner: w, rival: (w + 1) % L, rival2: (w + 2) % L, beats }, marcha, obstaculos },
  };
}
/** El orden de siempre (0, 1, 2...) en las compuertas que no se dan, y el dado en las que sí: `{ 3: [...] }` es el orden al 75 %. */
const ordenesCon = (L, cambios) => QS_A_MANO.map((_, c) => cambios[c] ?? Array.from({ length: L }, (_, k) => k));
const recta = (d, guion = []) => senalesDeLaRecta({ d, guion, txt: (c) => TEXTOS_CARRERA.es[c], cuerpo: CUERPO });
/** Un cuerpo de más (o de menos, con `signo` −1) para el carril 3, con su punta a la hora `centro` y que dura `ancho` segundos a cada lado. */
const bulto = (centro, signo = 1, ancho = 1.5) => (k, t) => (k === 3 ? signo * Math.max(0, 1 - Math.abs(t - centro) / ancho) : 0);

describe("las filas de la recta, con rectas armadas a mano", () => {
  it("subida-3: la que sube tres puestos o más entre dos compuertas hasta el 75 %, contra su parte de las ocho", () => {
    // La 5 va sexta hasta la mitad y segunda al 75 %: sube cuatro, y es la única.
    const sola = ordenesCon(8, { 3: [0, 5, 1, 2, 3, 4, 6, 7], 4: [5, 0, 1, 2, 3, 4, 6, 7], 5: [5, 0, 1, 2, 3, 4, 6, 7] });
    expect(recta(rectaAMano(sola, { w: 5 })).senales["subida-3"]).toEqual({ subio: { acierta: true, azar: 1 / 8 } });
    expect(recta(rectaAMano(sola, { w: 0 })).senales["subida-3"]).toEqual({ subio: { acierta: false, azar: 1 / 8 } });
    // Suben dos: la 5 y la 6.
    const dos = ordenesCon(8, { 3: [5, 6, 0, 1, 2, 3, 4, 7] });
    expect(recta(rectaAMano(dos, { w: 5 })).senales["subida-3"]).toEqual({ subio: { acierta: true, azar: 2 / 8 } });
    expect(recta(rectaAMano(dos, { w: 7 })).senales["subida-3"]).toEqual({ subio: { acierta: false, azar: 2 / 8 } });
    // Sin nadie que suba, no hay a quién apostar.
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 5 })).senales["subida-3"]).toEqual({ subio: null });
    // Lo que pasa después del 75 % no cuenta acá (eso es `subida-3-al-T3`).
    expect(recta(rectaAMano(ordenesCon(8, { 4: [7, 0, 1, 2, 3, 4, 5, 6] }), { w: 7 })).senales["subida-3"]).toEqual({ subio: null });
    // La hora es la de la compuerta donde se ve: el 75 %.
    expect(recta(rectaAMano(sola, { w: 5 })).tiempos["subida-3"]).toBeCloseTo(25, 9);
  });

  it("caida-3: la que baja tres puestos o más entre dos compuertas hasta el 75 %", () => {
    const cae = ordenesCon(8, { 2: [1, 2, 3, 0, 4, 5, 6, 7], 3: [1, 2, 3, 0, 4, 5, 6, 7] });
    const s = recta(rectaAMano(cae, { w: 0 })).senales;
    expect(s["caida-3"]).toEqual({ cayo: { acierta: true, azar: 1 / 8 } });
    expect(s["subida-3"]).toEqual({ subio: null });
    expect(recta(rectaAMano(cae, { w: 4 })).senales["caida-3"]).toEqual({ cayo: { acierta: false, azar: 1 / 8 } });
  });

  it("subida-3-al-T3: entre las cuatro de adelante a tres segundos de la meta, la que subió tres o más desde el 75 %, contra las cuatro", () => {
    // La 6 va séptima al 75 % y primera a tres segundos de la meta.
    const sube = ordenesCon(8, { 4: [6, 0, 1, 2, 3, 4, 5, 7], 5: [6, 0, 1, 2, 3, 4, 5, 7] });
    expect(recta(rectaAMano(sube, { w: 6 })).senales["subida-3-al-T3"]).toEqual({ subio: { acierta: true, azar: 1 / 4 } });
    expect(recta(rectaAMano(sube, { w: 1 })).senales["subida-3-al-T3"]).toEqual({ subio: { acierta: false, azar: 1 / 4 } });
    // Si la ganadora no está entre las cuatro, no se juzga (eso lo mide `recta-T3`).
    expect(recta(rectaAMano(sube, { w: 4 })).senales["subida-3-al-T3"]).toEqual({ subio: null });
    expect(recta(rectaAMano(sube, { w: 6 })).tiempos["subida-3-al-T3"]).toBeCloseTo(27, 9);
  });

  it("rapida-al-corte y hueco-al-corte: entre las cuatro de adelante en el corte, la que llega más rápido y la del hueco más raro, contra las cuatro", () => {
    // La 6 va séptima al 75 % y primera a tres segundos de la meta (el corte, 27 s): en los 0,6 s antes es la que más avanza.
    const sube = ordenesCon(8, { 4: [6, 0, 1, 2, 3, 4, 5, 7], 5: [6, 0, 1, 2, 3, 4, 5, 7] });
    expect(recta(rectaAMano(sube, { w: 6 })).senales["rapida-al-corte"]).toEqual({ "la-mas-rapida": { acierta: true, azar: 1 / 4 } });
    expect(recta(rectaAMano(sube, { w: 1 })).senales["rapida-al-corte"]).toEqual({ "la-mas-rapida": { acierta: false, azar: 1 / 4 } });
    expect(recta(rectaAMano(sube, { w: 6 })).tiempos["rapida-al-corte"]).toBeCloseTo(27, 9);
    // Las cuatro van en la grilla, a medio cuerpo, salvo la 2 (cuarta), que va 0,4 cuerpos más atrás: su hueco es el raro.
    const fuera = (k) => (k === 2 ? -0.4 : 0);
    expect(recta(rectaAMano(sube, { w: 2, extra: fuera })).senales["hueco-al-corte"]).toEqual({ "el-mas-raro": { acierta: true, azar: 1 / 4 } });
    expect(recta(rectaAMano(sube, { w: 6, extra: fuera })).senales["hueco-al-corte"]).toEqual({ "el-mas-raro": { acierta: false, azar: 1 / 4 } });
    // Una diferencia que no se ve (una cienmilésima de cuerpo, `HUECO_VISIBLE` es una milésima) no hace rara a nadie: la ronda no informa. Y una de
    // dos milésimas, sí.
    const casi = (k) => (k === 2 ? -1e-5 : 0);
    expect(recta(rectaAMano(sube, { w: 2, extra: casi })).senales["hueco-al-corte"]).toEqual({ "el-mas-raro": null });
    expect(recta(rectaAMano(sube, { w: 6 })).senales["hueco-al-corte"]).toEqual({ "el-mas-raro": null });
    const apenas = (k) => (k === 2 ? -2 * HUECO_VISIBLE : 0);
    expect(recta(rectaAMano(sube, { w: 2, extra: apenas })).senales["hueco-al-corte"]).toEqual({ "el-mas-raro": { acierta: true, azar: 1 / 4 } });
    // Si la ganadora no está entre las cuatro, no se juzga (eso lo mide `recta-T3`).
    expect(recta(rectaAMano(sube, { w: 4 })).senales["rapida-al-corte"]).toEqual({ "la-mas-rapida": null });
    // Con tres carriles, contra las tres. Con dos, no hay filas.
    const tres = ordenesCon(3, { 4: [2, 0, 1], 5: [2, 0, 1] });
    expect(recta(rectaAMano(tres, { w: 2 })).senales["rapida-al-corte"]).toEqual({ "la-mas-rapida": { acierta: true, azar: 1 / 3 } });
    expect(recta(rectaAMano(ordenesCon(2, {}), { w: 1 })).senales["rapida-al-corte"]).toBeUndefined();
    expect(recta(rectaAMano(ordenesCon(2, {}), { w: 1 })).senales["hueco-al-corte"]).toBeUndefined();
  });

  it("punta-repetida: la que va primera al 25, al 50 y al 75 %", () => {
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 0 })).senales["punta-repetida"]).toEqual({ "la-misma": { acierta: true, azar: 1 / 8 } });
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3 })).senales["punta-repetida"]).toEqual({ "la-misma": { acierta: false, azar: 1 / 8 } });
    // Si a la mitad manda otra, no hay ninguna que repita.
    expect(recta(rectaAMano(ordenesCon(8, { 2: [1, 0, 2, 3, 4, 5, 6, 7] }), { w: 0 })).senales["punta-repetida"]).toEqual({ "la-misma": null });
  });

  it("atraso-vuelve y adelanto-vuelve: la que se atrasa (o se adelanta) medio cuerpo y vuelve, fuera de los obstáculos", () => {
    // La 3 pierde un cuerpo a los 20 s (la mitad de la recta) y lo recupera en tres segundos.
    const pozo = (signo) => (k, t) => (k === 3 ? signo * Math.max(0, 1 - Math.abs(t - 20) / 1.5) : 0);
    const atras = rectaAMano(ordenesCon(8, {}), { w: 3, extra: pozo(-1) });
    const s = recta(atras);
    expect(s.senales["atraso-vuelve"]).toEqual({ marcadas: { acierta: true, azar: 1 / 8 } });
    expect(s.senales["adelanto-vuelve"]).toEqual({ marcadas: null });
    expect(s.tiempos["atraso-vuelve"]).toBeLessThanOrEqual(30);
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 1, extra: pozo(-1) })).senales["atraso-vuelve"]).toEqual({ marcadas: { acierta: false, azar: 1 / 8 } });
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: pozo(1) })).senales["adelanto-vuelve"]).toEqual({ marcadas: { acierta: true, azar: 1 / 8 } });
    // Con unas piedras sobre la 3 a esa hora, el atraso tiene su causa a la vista: no se marca.
    const piedras = [{ tipo: "piedras", q: 0.48, carriles: [3], malas: [], escupe: -1, llegan: [] }];
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: pozo(-1), obstaculos: piedras })).senales["atraso-vuelve"]).toEqual({ marcadas: null });
    // Y si escupe ella, tampoco (la que escupe también pierde un poco).
    const escupe = [{ tipo: "escupida", q: 0.48, carriles: [4], malas: [], escupe: 3, llegan: [] }];
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: pozo(-1), obstaculos: escupe })).senales["atraso-vuelve"]).toEqual({ marcadas: null });
    // Un atraso antes del 12 % de la recta no se mira (la entrada).
    const temprano = (k, t) => (k === 3 ? -Math.max(0, 1 - Math.abs(t - 11) / 1.5) : 0);
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: temprano })).senales["atraso-vuelve"]).toEqual({ marcadas: null });
  });

  it("adelanto-vuelve mira hasta el 75 %: la que se adelanta y cede mientras se arma el grupo de punta no se marca (eso es recta-T3)", () => {
    // La 3 se adelanta un cuerpo a los 23 s y cede en un segundo y medio: el punto de después (26,5 s) cae pasado el 75 % (25 s).
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(23) })).senales["adelanto-vuelve"]).toEqual({ marcadas: null });
    // Tampoco el que se completa en los 0,6 s antes del 75 % (24,4 s), cuando las compuertas corridas ya van hacia el grupo: un adelanto corto
    // a los 21,2 s, con el punto de después a los 24,7.
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(21.2, 1, 0.5) })).senales["adelanto-vuelve"]).toEqual({ marcadas: null });
    // A los 20,5 s, con el punto de después (24 s) antes de eso, sí.
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(20.5, 1, 0.5) })).senales["adelanto-vuelve"]).toEqual({ marcadas: { acierta: true, azar: 1 / 8 } });
    // El atraso a la misma hora sí se marca: ese mira hasta tres segundos antes de la meta.
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(23, -1) })).senales["atraso-vuelve"]).toEqual({ marcadas: { acierta: true, azar: 1 / 8 } });
  });

  it("atraso-vuelve mira hasta tres segundos antes de la meta: el atraso que vuelve recién después del corte de la cámara no se marca", () => {
    // La 3 se atrasa un cuerpo a los 25,5 s y vuelve a los 27,5: después de T-3 (27 s), con la llegada a la vista.
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(25.5, -1, 2) })).senales["atraso-vuelve"]).toEqual({ marcadas: null });
    // El mismo atraso dos segundos antes, que vuelve a los 25,5 s, sí.
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(23.5, -1, 2) })).senales["atraso-vuelve"]).toEqual({ marcadas: { acierta: true, azar: 1 / 8 } });
  });

  it("vuelve-en-el-grupo: entre las cuatro de adelante en el corte, la que se atrasa o se adelanta y vuelve mientras se arma el grupo, contra las cuatro", () => {
    // La 3 (cuarta en el corte, a los 27 s) se atrasa un cuerpo a los 22,5 s y vuelve a los 26: se termina de ver pasado el 75 % menos 0,6 s (24,4 s).
    const atraso = recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(22.5, -1) })).senales["vuelve-en-el-grupo"];
    expect(atraso).toEqual({ atraso: { acierta: true, azar: 1 / 4 }, adelanto: null });
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 1, extra: bulto(22.5, -1) })).senales["vuelve-en-el-grupo"]).toEqual({ atraso: { acierta: false, azar: 1 / 4 }, adelanto: null });
    // El adelanto que cede a esa hora, que `adelanto-vuelve` ya no mira, se mira acá.
    const adelanto = recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(22.5) }));
    expect(adelanto.senales["vuelve-en-el-grupo"]).toEqual({ atraso: null, adelanto: { acierta: true, azar: 1 / 4 } });
    expect(adelanto.senales["adelanto-vuelve"]).toEqual({ marcadas: null });
    expect(adelanto.tiempos["vuelve-en-el-grupo"]).toBeCloseTo(27, 9);
    // El que se termina de ver antes (a los 24 s) es de `adelanto-vuelve`, no de esta fila.
    const antes = recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(20.5, 1, 0.5) }));
    expect(antes.senales["vuelve-en-el-grupo"]).toEqual({ atraso: null, adelanto: null });
    expect(antes.senales["adelanto-vuelve"]).toEqual({ marcadas: { acierta: true, azar: 1 / 8 } });
    // Una que queda fuera de las cuatro en el corte no cuenta: la 5, sexta.
    const quinta = (k, t) => (k === 5 ? -Math.max(0, 1 - Math.abs(t - 22.5) / 1.5) : 0);
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 0, extra: quinta })).senales["vuelve-en-el-grupo"]).toEqual({ atraso: null, adelanto: null });
    // Con un obstáculo encima a esa hora, tiene su causa a la vista: no se marca.
    const piedras = [{ tipo: "piedras", q: 0.62, carriles: [3], malas: [], escupe: -1, llegan: [] }];
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 3, extra: bulto(22.5, -1), obstaculos: piedras })).senales["vuelve-en-el-grupo"]).toEqual({ atraso: null, adelanto: null });
    // Con tres carriles, contra las tres.
    const tres = recta(rectaAMano(ordenesCon(3, {}), { w: 2, extra: (k, t) => (k === 2 ? -Math.max(0, 1 - Math.abs(t - 22.5) / 1.5) : 0) }));
    expect(tres.senales["vuelve-en-el-grupo"]).toEqual({ atraso: { acierta: true, azar: 1 / 3 }, adelanto: null });
  });

  it("momento-*: si la ganadora tiene ese momento, contra la parte de carriles que lo tienen; la lista de la marcha manda sobre la de la historia", () => {
    const beats = [
      { kind: "plantada", actor: 3, at: 0.3 },
      { kind: "tropiezo", actor: 2, at: 0.4 },
      { kind: "escupida", actor: 4, target: 5, at: 0.5 },
    ];
    const p = 1 / 8;
    const z = (tiene) => ((tiene ? 1 : 0) - p) / Math.sqrt(p * (1 - p));
    const m = recta(rectaAMano(ordenesCon(8, {}), { w: 5, beats }));
    expect(m.medias["momento-plantada"]).toEqual({ v: z(false), sd: 1 });
    expect(m.medias["momento-tropiezo"]).toEqual({ v: z(false), sd: 1 });
    expect(m.medias["momento-escupida"]).toEqual({ v: z(false), sd: 1 });
    expect(m.medias["momento-escupido"]).toEqual({ v: z(true), sd: 1 });
    expect(m.medias["momento-pique"]).toBeUndefined();
    expect(m.tiempos["momento-plantada"]).toBeCloseTo(16, 9);
    // Dos carriles con el mismo momento: la parte es dos de ocho.
    const dos = recta(rectaAMano(ordenesCon(8, {}), { w: 2, beats: [...beats, { kind: "tropiezo", actor: 6, at: 0.6 }] })).medias["momento-tropiezo"];
    expect(dos.v).toBeCloseTo((1 - 2 / 8) / Math.sqrt((2 / 8) * (6 / 8)), 12);
    // Con la lista de la marcha (los momentos ciegos), la de la historia no se mira.
    const ciegos = recta(rectaAMano(ordenesCon(8, {}), { w: 5, beats, marcha: { momentos: [{ kind: "pique", actor: 5, at: 0.45 }] } })).medias;
    expect(ciegos["momento-pique"]).toEqual({ v: z(true), sd: 1 });
    expect(ciegos["momento-tropiezo"]).toBeUndefined();
    expect(ciegos["momento-plantada"]).toBeUndefined();
  });

  it("susto: si la ganadora tiene el tropiezo grande del susto, contra la parte de carriles que lo tienen según la marcha", () => {
    // Sin el campo de la marcha no hay fila: no se arma con la ganadora (lo de hoy lo miden momento-tropiezo y atraso-vuelve).
    const hoy = recta(rectaAMano(ordenesCon(8, {}), { w: 5, arc: "susto", beats: [{ kind: "tropiezo", actor: 5, at: 0.45 }] }));
    expect(hoy.medias.susto).toBeUndefined();
    expect(hoy.medias["momento-tropiezo"].v).toBeCloseTo(Math.sqrt(7), 12);
    expect(recta(rectaAMano(ordenesCon(8, {}), { w: 5, arc: "duelo" })).medias.susto).toBeUndefined();
    // Con el campo (los carriles con arco susto), contra su parte.
    const con = (w) => recta(rectaAMano(ordenesCon(8, {}), { w, arc: "remontada", marcha: { sustos: [1, 5] } })).medias.susto;
    expect(con(5).v).toBeCloseTo((1 - 1 / 4) / Math.sqrt((1 / 4) * (3 / 4)), 12);
    expect(con(5).sd).toBe(1);
    expect(con(0).v).toBeCloseTo(-1 / 4 / Math.sqrt((1 / 4) * (3 / 4)), 12);
    // La hora es la del primer tropiezo de los sustos.
    const t = recta(rectaAMano(ordenesCon(8, {}), { w: 5, arc: "remontada", marcha: { sustos: [1, 5], momentos: [{ kind: "tropiezo", actor: 1, at: 0.45 }] } })).tiempos.susto;
    expect(t).toBeCloseTo(19, 9);
  });

  it("linea-arco: si el relator dijo una línea del arco, las que van al 75 % en la franja de la ganadora de ese arco", () => {
    expect(franjaDePuestos(8, 0, 0.25)).toEqual([1, 2]);
    expect(franjaDePuestos(8, 0.5, 1)).toEqual([5, 8]);
    expect(franjaDePuestos(3, 0, 0.25)).toEqual([1, 1]);
    expect(franjaDePuestos(3, 0.5, 1)).toEqual([2, 3]);
    expect(franjaDePuestos(2, 0.5, 1)).toEqual([2, 2]);
    const al75 = ordenesCon(8, { 3: [3, 4, 0, 1, 2, 5, 6, 7] });
    const linea = (texto, t = 20.4) => [{ t, texto: () => texto }];
    // ¡Mano a mano!: el duelo, las dos primeras al 75 %.
    expect(recta(rectaAMano(al75, { w: 4 }), linea("¡Mano a mano!")).senales["linea-arco"]).toEqual({ franja: { acierta: true, azar: 2 / 8 } });
    expect(recta(rectaAMano(al75, { w: 0 }), linea("¡Aprietan los dos!")).senales["linea-arco"]).toEqual({ franja: { acierta: false, azar: 2 / 8 } });
    // ¡Vienen de atrás! y ¡Alguien se cuela!: la mitad de atrás al 75 %.
    expect(recta(rectaAMano(al75, { w: 5 }), linea("¡Vienen de atrás!", 24.8)).senales["linea-arco"]).toEqual({ franja: { acierta: true, azar: 4 / 8 } });
    expect(recta(rectaAMano(al75, { w: 3 }), linea("¡Alguien se cuela!", 27.6)).senales["linea-arco"]).toEqual({ franja: { acierta: false, azar: 4 / 8 } });
    // Se ve cuando están las dos cosas: la línea y el 75 %.
    expect(recta(rectaAMano(al75, { w: 4 }), linea("¡Mano a mano!")).tiempos["linea-arco"]).toBeCloseTo(25, 9);
    // Sin línea del arco antes de la meta, no hay fila.
    expect(recta(rectaAMano(al75, { w: 4 }), linea("¡Cabeza a cabeza!")).senales["linea-arco"]).toBeUndefined();
    expect(recta(rectaAMano(al75, { w: 4 }), linea("¡Mano a mano!", 30.5)).senales["linea-arco"]).toBeUndefined();
  });

  it("con menos de cuatro carriles la subida grande es de la última a la primera, y a tres segundos de la meta se mira contra todas", () => {
    expect([2, 3, 4, 5, 8].map(subidaGrande)).toEqual([1, 2, 3, 3, 3]);
    // Con tres: la 2 pasa de tercera a primera al 75 %.
    const tres = ordenesCon(3, { 3: [2, 0, 1], 4: [2, 0, 1], 5: [2, 0, 1] });
    expect(recta(rectaAMano(tres, { w: 2 })).senales["subida-3"]).toEqual({ subio: { acierta: true, azar: 1 / 3 } });
    // Con dos: la 1 pasa a la 0 a la mitad; la 0 es la que cae.
    const dos = ordenesCon(2, { 2: [1, 0], 3: [1, 0], 4: [1, 0], 5: [1, 0] });
    expect(recta(rectaAMano(dos, { w: 1 })).senales["subida-3"]).toEqual({ subio: { acierta: true, azar: 1 / 2 } });
    expect(recta(rectaAMano(dos, { w: 1 })).senales["caida-3"]).toEqual({ cayo: { acierta: false, azar: 1 / 2 } });
    // Con cuatro, a tres segundos de la meta las cuatro son todas: la 3 sube de cuarta a primera.
    const cuatro = ordenesCon(4, { 4: [3, 0, 1, 2], 5: [3, 0, 1, 2] });
    expect(recta(rectaAMano(cuatro, { w: 3 })).senales["subida-3-al-T3"]).toEqual({ subio: { acierta: true, azar: 1 / 4 } });
    // Con tres, la que pasa de tercera a primera entre el 75 % y los tres segundos finales, contra las tres.
    const tresT3 = ordenesCon(3, { 4: [2, 0, 1], 5: [2, 0, 1] });
    expect(recta(rectaAMano(tresT3, { w: 0 })).senales["subida-3-al-T3"]).toEqual({ subio: { acierta: false, azar: 1 / 3 } });
  });
});

describe("las filas de la subfila del corral, con filas armadas a mano", () => {
  // Seis personas en tres filas: la 0 con 1, 2 y 3 (arriba, abajo, abajo), la 1 con 4 y 5 (abajo, abajo) y la 2 con la 6, sola en la línea.
  const fila = new Map([[1, 0], [2, 0], [3, 0], [4, 1], [5, 1], [6, 2]]);
  const signo = new Map([[1, -1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 0]]);
  const base = { gente: [1, 2, 3, 4, 5, 6], fila: (p) => fila.get(p), rango: (p) => p, signo };

  it("subfila-corte: la ganadora vecina, en su fila, de dos seguidas del mismo lado, contra la gente vecina de un corte", () => {
    // Los cortes: 2 y 3 en la fila 0, 4 y 5 en la 1.
    expect(senalesDeLaSubfila({ ...base, w: 2 })["subfila-corte"]).toEqual({ K: 2, k: 1, probs: [1 - 4 / 6, 4 / 6] });
    expect(senalesDeLaSubfila({ ...base, w: 1 })["subfila-corte"]).toEqual({ K: 2, k: 0, probs: [1 - 4 / 6, 4 / 6] });
    // Seguidas es por el orden del grupo: con la 2 delante de la 1, la fila 0 alterna (abajo, arriba, abajo) y ya no tiene corte.
    const rango = (p) => ({ 1: 1, 2: 0, 3: 2 })[p] ?? p;
    expect(senalesDeLaSubfila({ ...base, rango, w: 2 })["subfila-corte"]).toEqual({ K: 2, k: 0, probs: [1 - 2 / 6, 2 / 6] });
  });

  it("subfila-sola: la ganadora sola de su lado en una fila de tres o más, contra la gente que va sola de su lado", () => {
    // En la fila 0 (1 arriba, 2 y 3 abajo) la 1 va sola arriba. La fila 1 es de dos y la 2 de una: no cuentan.
    expect(senalesDeLaSubfila({ ...base, w: 1 })["subfila-sola"]).toEqual({ K: 2, k: 1, probs: [1 - 1 / 6, 1 / 6] });
    expect(senalesDeLaSubfila({ ...base, w: 2 })["subfila-sola"]).toEqual({ K: 2, k: 0, probs: [1 - 1 / 6, 1 / 6] });
    // Alternando (arriba, abajo, arriba) la sola es la del medio, y no hay cortes.
    const alterna = new Map([[1, -1], [2, 1], [3, -1], [4, -1], [5, 1], [6, 0]]);
    expect(senalesDeLaSubfila({ ...base, signo: alterna, w: 2 })).toEqual({ "subfila-corte": null, "subfila-sola": { K: 2, k: 1, probs: [1 - 1 / 6, 1 / 6] } });
    // Una fila de tres toda del mismo lado no tiene a nadie solo.
    const unLado = new Map([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 0]]);
    expect(senalesDeLaSubfila({ ...base, signo: unLado, w: 1 })["subfila-sola"]).toBeNull();
    // La fila toda de un lado ya no se mide: con la regla de los carriles no se da nunca.
    expect(senalesDeLaSubfila({ ...base, w: 4 })).not.toHaveProperty("subfila-un-lado");
  });

  it("subfila-sola y hueco-al-corte son filas a mirar: si dan delator cuentan como a mirar y no frenan, y las demás frenan como siempre", () => {
    for (const s of ["subfila-sola", "subfila-sola-celular", "hueco-al-corte"]) {
      expect(FILAS_A_MIRAR.has(s)).toBe(true);
      expect(cuentaComo(s, "delator")).toBe("mirar");
      expect(cuentaComo(s, "mirar")).toBe("mirar");
      expect(cuentaComo(s, "limpia")).toBe("limpia");
    }
    expect(FILAS_A_MIRAR.size).toBe(3);
    for (const s of ["subfila-corte", "subfila", "atraso-vuelve", "recta-T3", "rapida-al-corte", "subida-3-al-T3", "vuelve-en-el-grupo"]) expect(cuentaComo(s, "delator")).toBe("delator");
  });

  it("en una ronda de verdad, las filas de la subfila son las del grupo de la pantalla", () => {
    let medidas = 0;
    for (let i = 1; i <= 20; i++) {
      const { o, plan } = ronda(30, i);
      const d = plan.datos;
      for (const [sufijo, W, H] of [["", 1366, 768], ["-celular", 390, 844]]) {
        const g = filasDelGrupo(d, W, H);
        const esperado = senalesDeLaSubfila({ gente: d.gente, fila: (p) => g.filaDeLugar[d.orden.rango(p)], rango: (p) => d.orden.rango(p), signo: g.signo, w: d.campeona });
        for (const nombre of ["subfila-corte", "subfila-sola"]) {
          expect(o.repartos[`${nombre}${sufijo}`] ?? null, `${i} ${nombre}${sufijo}`).toEqual(esperado[nombre]);
          if (esperado[nombre]) medidas++;
        }
        expect(o.repartos[`subfila-un-lado${sufijo}`]).toBeUndefined();
      }
    }
    expect(medidas).toBeGreaterThan(10);
  });
});

describe("las filas de la recta en rondas de verdad", () => {
  it("con la carrera de antes, los momentos y el susto son los de la historia del plan, y las filas de movimiento salen en cada ronda", () => {
    for (let i = 1; i <= 20; i++) {
      const { o, plan } = ronda(18, i, { senuelos: false });
      const f = plan.datos.final;
      const L = f.lanes.length;
      const kw = f.story.winner;
      for (const kind of ["plantada", "tropiezo", "pique", "escupida"]) {
        const con = new Set(f.story.beats.filter((b) => b.kind === kind).map((b) => b.actor));
        const p = con.size / L;
        if (p > 0 && p < 1) expect(o.medias[`momento-${kind}`], `${i} ${kind}`).toEqual({ v: ((con.has(kw) ? 1 : 0) - p) / Math.sqrt(p * (1 - p)), sd: 1 });
        else expect(o.medias[`momento-${kind}`], `${i} ${kind}`).toBeUndefined();
      }
      // La marcha de hoy no dice quiénes tienen el susto: no hay fila.
      expect(o.medias.susto, `${i}`).toBeUndefined();
      for (const s of ["subida-3", "caida-3", "subida-3-al-T3", "punta-repetida", "atraso-vuelve", "adelanto-vuelve"]) expect(o.senales, `${i} ${s}`).toHaveProperty(s);
    }
  });

  it("con la marcha pareja, los momentos son los que actúan en la marcha y el susto, el de los carriles con arco susto, la ganadora y las demás", () => {
    let sustos = 0;
    for (let i = 1; i <= 20; i++) {
      const { o, plan } = ronda(18, i, { senuelos: true });
      const m = plan.datos.final.marcha;
      const L = plan.datos.final.lanes.length;
      const kw = plan.datos.final.story.winner;
      for (const kind of ["plantada", "tropiezo", "pique", "escupida"]) {
        const con = new Set(m.momentos.filter((b) => b.kind === kind).map((b) => b.actor));
        const p = con.size / L;
        if (p > 0 && p < 1) expect(o.medias[`momento-${kind}`], `${i} ${kind}`).toEqual({ v: ((con.has(kw) ? 1 : 0) - p) / Math.sqrt(p * (1 - p)), sd: 1 });
        else expect(o.medias[`momento-${kind}`], `${i} ${kind}`).toBeUndefined();
      }
      const con = new Set(m.sustos);
      const p = con.size / L;
      if (p > 0 && p < 1) {
        sustos++;
        expect(o.medias.susto, `${i}`).toEqual({ v: ((con.has(kw) ? 1 : 0) - p) / Math.sqrt(p * (1 - p)), sd: 1 });
      }
      for (const s of ["subida-3", "caida-3", "subida-3-al-T3", "punta-repetida", "atraso-vuelve", "adelanto-vuelve"]) expect(o.senales, `${i} ${s}`).toHaveProperty(s);
      // El arco de la ganadora no se dice antes de la meta.
      expect(o.senales["linea-arco"], `${i}`).toBeUndefined();
    }
    expect(sustos).toBeGreaterThan(10);
  });

  it("en la carrera nueva no corren: su arco susto es una etiqueta de cómo llegó la ganadora, no un tropiezo", () => {
    let sustos = 0;
    for (let i = 1; i <= 40; i++) {
      const r = rondaDe(lib, 8, i);
      const plan = planCarrera(r.ctx, { nueva: true });
      const o = observar(lib, plan, r.ctx);
      if (plan.datos.final.story.arc === "susto") sustos++;
      expect(o.medias.susto, `${i}`).toBeUndefined();
      for (const s of ["subida-3", "caida-3", "subida-3-al-T3", "punta-repetida", "atraso-vuelve", "adelanto-vuelve"]) expect(o.senales[s], `${i} ${s}`).toBeUndefined();
      expect(Object.keys(o.medias).filter((k) => k.startsWith("momento-")), `${i}`).toEqual([]);
      // Lo suyo sigue: los sucesos y el acordeón.
      expect(o.senales, `${i}`).toHaveProperty("recta-88");
    }
    expect(sustos).toBeGreaterThan(3);
  });

  // Los equipos de un evento son de 3 a 6: con pocas personas todas son finalistas, no hay grupo y la recta tiene de 2 a 7 carriles.
  it.each([2, 3, 4, 5, 6, 7])("con %i personas corren todas las filas de la recta, con sus apuestas contra los carriles que hay", (n) => {
    let conLinea = 0, conMomento = 0, conLineaPareja = 0;
    for (let i = 1; i <= 40; i++) {
      // Con la marcha pareja el relator no dice el arco antes de la meta: la fila de las líneas del arco se mira con la carrera de antes.
      if (ronda(n, i, { senuelos: false }).o.senales["linea-arco"]) conLinea++;
      const { o, plan } = ronda(n, i);
      expect(plan.datos.lanes).toHaveLength(n);
      for (const s of ["subida-3", "caida-3", "subida-3-al-T3", "punta-repetida", "atraso-vuelve", "adelanto-vuelve"]) expect(o.senales, `${n}/${i} ${s}`).toHaveProperty(s);
      // Cada apuesta va contra todas las de la recta (o contra las cuatro de adelante a tres segundos de la meta, que con cuatro o menos son todas).
      // Las del corte de la cámara, desde tres carriles.
      for (const s of ["rapida-al-corte", "hueco-al-corte"]) expect(Object.hasOwn(o.senales, s), `${n}/${i} ${s}`).toBe(n >= 3);
      for (const [s, regla, contra] of [["subida-3", "subio", n], ["caida-3", "cayo", n], ["punta-repetida", "la-misma", n], ["atraso-vuelve", "marcadas", n], ["adelanto-vuelve", "marcadas", n], ["subida-3-al-T3", "subio", Math.min(4, n)], ["rapida-al-corte", "la-mas-rapida", Math.min(4, n)], ["hueco-al-corte", "el-mas-raro", Math.min(4, n)]]) {
        if (!o.senales[s]) continue;
        const a = o.senales[s][regla];
        if (a) expect(a.azar * contra, `${n}/${i} ${s}`).toBeCloseTo(Math.round(a.azar * contra), 9);
      }
      if (o.senales["linea-arco"]) conLineaPareja++;
      if (Object.keys(o.medias).some((k) => k.startsWith("momento-") || k === "susto")) conMomento++;
    }
    // Con dos y con tres también hay líneas del arco (en la carrera de antes) y momentos que medir. Con la marcha pareja, ninguna línea del arco.
    expect(conLinea).toBeGreaterThan(5);
    expect(conLineaPareja).toBe(0);
    expect(conMomento).toBeGreaterThan(5);
  });
});

describe("las pruebas sobre rondas de verdad", () => {
  const RONDAS = 120;
  const juntar = (n) => {
    const fams = {};
    const repartos = {};
    const medias = {};
    for (let i = 1; i <= RONDAS; i++) {
      const { o } = ronda(n, i);
      for (const [s, reglas] of Object.entries(o.senales)) for (const [r, obs] of Object.entries(reglas)) ((fams[s] ??= {})[r] ??= []).push(obs);
      for (const [s, r] of Object.entries(o.repartos)) {
        const x = (repartos[s] ??= { conteos: new Array(r.K).fill(0), probs: r.probs ?? null });
        x.conteos[r.k]++;
      }
      for (const [s, m] of Object.entries(o.medias)) (medias[s] ??= []).push(m.v);
    }
    return { fams, repartos, medias };
  };

  it("la punta, los repartos de la entrada y los promedios se pueden juzgar con 18 personas", () => {
    const { fams, repartos, medias } = juntar(18);
    expect(evaluarSenal(fams["punta-50"], { tamano: false }).veredicto).not.toBe("pocos");
    expect(evaluarReparto(repartos.entrada.conteos).gl).toBe(7);
    expect(evaluarReparto(repartos.entrada.conteos).n).toBe(RONDAS);
    expect(evaluarMedia(medias["tiempo-dif"]).n).toBe(RONDAS);
    expect(evaluarMedia(medias["echa-orden-lista"], { sd: 1 }).n).toBe(RONDAS);
  });

  it("a tres segundos de la meta la ganadora cae en una de las cuatro de adelante y a 1,5 s en una de las tres, parejo: el casillero de más no recibe nunca nada", () => {
    const { repartos } = juntar(18);
    for (const [senal, tope] of [["recta-T3", 4], ["recta-T15", 3]]) {
      const r = repartos[senal];
      expect(r.conteos, senal).toHaveLength(tope + 1);
      expect(r.conteos[tope], `${senal}: la ganadora afuera`).toBe(0);
      expect(r.probs).toEqual([...Array.from({ length: tope }, () => 1 / tope), 0]);
      const ev = evaluarReparto(r.conteos, r.probs);
      expect(ev.gl, senal).toBe(tope - 1);
      expect(ev.veredicto, `${senal}: ${r.conteos.join(" ")}`).not.toBe("delator");
    }
  });

  it("los obstáculos no sacan a la ganadora de las cuatro de adelante a tres segundos de la meta: la ronda 2890 con 60 personas", () => {
    // En esa ronda la marcha la dejaba cuarta, apenas delante de la quinta, y la valla mal saltada en B y la escupida que suelta en C3 le quitaban
    // ese poco: a 3 s de la meta iba quinta (el casillero de probabilidad cero de `recta-T3`, que pone en rojo al auditor).
    const { o } = ronda(60, 2890);
    expect(o.repartos["recta-T3"].k).toBeLessThan(4);
  });

  it("con 60 personas los casilleros de la tanda son tres y los del portón tres", () => {
    const { repartos } = juntar(60);
    expect(repartos.tanda.conteos).toHaveLength(3);
    expect(repartos.porton.conteos).toHaveLength(3);
    expect(evaluarReparto(repartos.tanda.conteos, repartos.tanda.probs).gl).toBe(2);
    expect(evaluarReparto(repartos.porton.conteos).gl).toBe(2);
  });
});

describe("el relator de la final no delata (lo que midió el auditor de delatores)", () => {
  // Con 1.500 rondas el relator viejo daba: el último nombrado gana 1,5 a 1,8 veces lo que toca (p de 2e-11 a menos de 1e-12),
  // los nombrados 1,48 veces con 200 y el primero que nombran 0,68 veces. Acá, con menos rondas, alcanza para ver eso.
  const juntar = (n, rondas) => {
    const fams = {};
    for (let i = 1; i <= rondas; i++) {
      const { o } = ronda(n, i);
      for (const [s, reglas] of Object.entries(o.senales)) if (/^(nombra-|drama)/.test(s)) for (const [r, obs] of Object.entries(reglas)) ((fams[s] ??= {})[r] ??= []).push(obs);
    }
    return fams;
  };

  it.each([[200, 400], [18, 300]])("con %i personas, ninguna señal del relator sale de la casualidad (%i rondas)", (n, rondas) => {
    const fams = juntar(n, rondas);
    expect(Object.keys(fams).sort()).toEqual(["drama", "nombra-mas", "nombra-primero", "nombra-ultimo"]);
    for (const [senal, fam] of Object.entries(fams)) {
      const ev = evaluarSenal(fam, { tamano: false });
      expect(ev.veredicto, `${senal} ${JSON.stringify(ev.mejor && { regla: ev.mejor.nombre, tasa: ev.mejor.tasa, azar: ev.mejor.azar, p: ev.p })}`).not.toBe("delator");
    }
  // Con 200 personas y 400 rondas, cada plan de la recta prueba hasta 160 arreglos: le hace falta más que los 30 s por defecto cuando la máquina está cargada.
  }, 150_000);
});

describe("el auditor corre solo, sin navegador", () => {
  it("race con 40 rondas y 18 personas: mide el plan y termina", () => {
    const r = spawnSync(process.execPath, ["scripts/audit-delatores.mjs", "race", "--semillas", "40", "--n", "18"], { encoding: "utf8", cwd: process.cwd(), timeout: 60_000 });
    expect(r.stdout).toContain("race · 40 rondas del plan · 18 personas");
    expect(r.stdout).toContain("señales juzgadas");
    // La fila a mirar del corral llega al auditor y la vieja de un solo lado ya no.
    expect(r.stdout).toMatch(/subfila-sola\b/);
    expect(r.stdout).not.toContain("subfila-un-lado");
    expect(r.stdout).toMatch(/APROBADO|RECHAZADO/);
    expect([0, 1]).toContain(r.status);
  }, 90_000);
});
