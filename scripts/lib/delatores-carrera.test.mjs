import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeStory } from "../../src/games/drama";
import { TEXTOS_CARRERA } from "../../src/games/llamas/carrera-textos";
import { alfabetico, corto, planCarrera } from "../../src/games/llamas/carrera-show";
import { azarDe, sembrar } from "../../src/games/pixi/kit/azar";
import { listHash } from "../../src/protocol/canonical";
import { select } from "../../src/protocol/select";
import { evaluarMedia, evaluarReparto, evaluarSenal } from "./delatores.mjs";
import { nombresDeAuditoria, observar, rondaDe, semillaDe } from "./delatores-carrera.mjs";

/** Lo que carga `cargarCarrera` con Vite, acá importado directo (Vitest ya entiende el TypeScript del repositorio). */
const lib = { planCarrera, alfabetico, sembrar, azarDe, textos: TEXTOS_CARRERA, writeStory, select, listHash };

function ronda(n, i) {
  const r = rondaDe(lib, n, i);
  const plan = planCarrera(r.ctx);
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
    for (const s of ["punta-inicio", "punta-25", "punta-50", "punta-75", "tiempo-mitad", "tiempo-fin", "echa-primera", "echa-mitad", "echa-ultima", "recta-90", "nombra-primero", "nombra-ultimo", "nombra-mas", "drama"]) {
      expect(o.senales, s).toHaveProperty(s);
    }
    expect(Object.keys(o.repartos).sort()).toEqual(["carril", "entrada", "recta-25", "recta-50", "recta-75"]);
    expect(Object.keys(o.medias).sort()).toEqual(["echa-orden-lista", "tiempo-dif"]);
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

  it("con 60 hay tandas: la de la ganadora, su lugar en el portón y la última que pasó", () => {
    const { o, plan } = ronda(60, 4);
    const d = plan.datos;
    expect(o.repartos.tanda.K).toBe(3);
    expect(d.tandas[o.repartos.tanda.k].miembros).toContain(d.campeona);
    expect(o.repartos.tanda.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(o.repartos.porton.K).toBe(5);
    expect(d.tandas[o.repartos.tanda.k].pasan[o.repartos.porton.k]).toBe(d.campeona);
    expect(o.senales["punta-corral"]["la-ultima"]).toMatchObject({ azar: 1 / d.gente.length });
  });

  it("con 200 el grupo son las ocho de la final: ni punta, ni echadas, y una sola plaza por portón", () => {
    const { o } = ronda(200, 6);
    expect(o.repartos.tanda.K).toBe(8);
    expect(o.repartos.porton).toBeUndefined();
    expect(o.senales["punta-50"]).toBeUndefined();
    expect(Object.keys(o.medias)).toEqual([]);
    expect(o.repartos.entrada.K).toBe(8);
  });

  it("los casilleros caen adentro, los azares entre cero y uno, y las señales son las mismas con la misma ronda", () => {
    for (const n of [8, 12, 18, 30, 31, 60, 100, 200]) {
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
  });

  it("el relator se mide desde la salida: con tandas, quien pasa por el portón no es un nombre más", () => {
    const { o, plan } = ronda(100, 2);
    const lineas = plan.guion.filter((l) => l.texto !== undefined && l.t >= plan.datos.tSalida - 0.01);
    expect(lineas.length).toBeGreaterThan(0);
    // Las líneas de "¡Pasa X!" son de antes de la salida: no entran.
    expect(lineas.some((l) => /^¡Pasa /.test(l.texto()))).toBe(false);
    expect(o.senales["nombra-primero"]).toBeDefined();
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

  it("con 60 personas los casilleros de la tanda son tres y los del portón cinco", () => {
    const { repartos } = juntar(60);
    expect(repartos.tanda.conteos).toHaveLength(3);
    expect(repartos.porton.conteos).toHaveLength(5);
    expect(evaluarReparto(repartos.tanda.conteos, repartos.tanda.probs).gl).toBe(2);
    expect(evaluarReparto(repartos.porton.conteos).gl).toBe(4);
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
  });
});

describe("el auditor corre solo, sin navegador", () => {
  it("race con 40 rondas y 18 personas: mide el plan y termina", () => {
    const r = spawnSync(process.execPath, ["scripts/audit-delatores.mjs", "race", "--semillas", "40", "--n", "18"], { encoding: "utf8", cwd: process.cwd(), timeout: 60_000 });
    expect(r.stdout).toContain("race · 40 rondas del plan · 18 personas");
    expect(r.stdout).toContain("señales juzgadas");
    expect(r.stdout).toMatch(/APROBADO|RECHAZADO/);
    expect([0, 1]).toContain(r.status);
  }, 90_000);
});
