import { describe, expect, it } from "vitest";
import { ARCS, type Arc, type Beat } from "../drama";
import { sembrar } from "../pixi/kit/azar";
import { CUERPO, metaDeUnCarril, momentosCiegos, PUESTOS_AL_90 } from "./carrera-marcha";
import { arcoDeEntrada, arcosPosibles, pesosDeEntrada } from "./carrera-franjas";
import { ctxDe, nombresDe } from "./carrera-prueba";
import { capasDeLaRecta, planCarrera, type Datos } from "./carrera-show";
import { planRace } from "./plan";

/**
 * La marcha pareja (`SENUELOS`): hasta tres segundos antes de la meta la ganadora es una llama más. Estas pruebas miden la regla por construcción:
 *
 * 1. **Espejo.** Lo que busca cada carril (`metaDeUnCarril`) tiene, dado su puesto de entrada, la misma ley que lo que `planRace` sortea para la
 *    ganadora: el arco y los puestos al 25, 50 y 75 %. Salen de la misma tabla (`carrera-franjas.ts`). Si alguien sortea una por fuera, falla.
 * 2. **La ganadora es una más.** Subir o bajar tres puestos entre compuertas, tener el tropiezo del susto, tener un momento o ir primera al 25, 50 y
 *    75 % le pasa a la ganadora tantas veces como a cualquiera.
 * 3. **El grupo de punta no mira el pasado.** Las tres que acompañan a la ganadora a tres segundos de la meta se sortean sin mirar dónde iban.
 * 4. **Su puesto sigue parejo** en cada compuerta y entre las cuatro a tres segundos de la meta, y a esa hora su hueco con la vecina es como el de
 *    las otras tres.
 * 5. **La velocidad en el corte.** La ganadora no llega al corte de la cámara más rápido que las otras tres del grupo.
 * 6. **La entrada pareja.** Con cualquier cantidad de carriles la ganadora entra a la recta en cada puesto una vez de cada L.
 *
 * Los umbrales son de cuatro desvíos o de p = 0,001: con la carrera de antes (`senuelos: false`) las mismas cuentas se separan por decenas de desvíos.
 */

/* ------------------------------------------------------------------------------------------------ 1. espejo */

/** Lo que sortea una llama para la recta: su arco, su puesto de entrada (1 es la primera), lo que busca al 25, 50 y 75 %, y en el susto si tropieza antes de la mitad. */
interface Ley {
  arco: Arc;
  r07: number;
  metas: [number, number, number];
  antes: boolean | null;
}

/** `S` planes de la ganadora (`planRace`) con `L` carriles, con nombres, ganadora y azar sembrados. Con `entradaPareja`, como en la marcha pareja. */
function deLaGanadora(L: number, S: number, entradaPareja = true): Ley[] {
  const nombres = nombresDe(L);
  const azar = sembrar(9001 + L);
  const out: Ley[] = [];
  for (let s = 0; s < S; s++) {
    const p = planRace(nombres, Math.floor(azar() * L), sembrar(Math.floor(azar() * 4294967296)), { entradaPareja });
    const r = (q: number): number => (p.puestos.find((x) => Math.abs(x.q - q) < 1e-9) as { r: number }).r;
    const tropiezo = p.story.beats.find((b) => b.kind === "tropiezo" && b.actor === p.story.winner);
    out.push({ arco: p.story.arc, r07: r(0.067), metas: [r(0.25), r(0.5), r(0.75)], antes: p.story.arc === "susto" ? (tropiezo?.at ?? 1) < 0.5 : null });
  }
  return out;
}

/** Para cada plan de la ganadora, `M` sorteos de `metaDeUnCarril` con su mismo puesto de entrada. */
function deLasDemas(L: number, ganadora: readonly Ley[], M: number): Ley[] {
  const rnd = sembrar(4242 + L);
  const out: Ley[] = [];
  for (const g of ganadora) {
    for (let m = 0; m < M; m++) {
      const x = metaDeUnCarril(L, g.r07, rnd);
      out.push({ arco: x.arco, r07: g.r07, metas: x.metas, antes: x.arco === "susto" ? x.tropiezo < 0.5 : null });
    }
  }
  return out;
}

/**
 * Las diferencias entre dos leyes: el arco dado el puesto de entrada, el puesto que busca en cada compuerta dado el arco y, en el susto, si tropieza
 * antes de la mitad. Cada casillero se compara contra lo que deja el azar de la muestra de la ganadora: a menos de 0,03 o de cuatro desvíos.
 */
function diferencias(L: number, a: readonly Ley[], b: readonly Ley[]): string[] {
  const out: string[] = [];
  const compara = (nombre: string, xa: readonly unknown[], xb: readonly unknown[], valores: readonly unknown[]): void => {
    if (xa.length < 30 || !xb.length) return;
    for (const v of valores) {
      const pa = xa.filter((x) => x === v).length / xa.length;
      const pb = xb.filter((x) => x === v).length / xb.length;
      const tol = Math.max(0.03, 4 * Math.sqrt(Math.max(pb * (1 - pb), 1 / xa.length) / xa.length));
      if (Math.abs(pa - pb) > tol) out.push(`${nombre} = ${String(v)}: ${pa.toFixed(3)} contra ${pb.toFixed(3)}`);
    }
  };
  const puestos = Array.from({ length: L }, (_, i) => i + 1);
  for (const r of puestos) compara(`L ${L}, arco si entra ${r}.ª`, a.filter((x) => x.r07 === r).map((x) => x.arco), b.filter((x) => x.r07 === r).map((x) => x.arco), ARCS);
  for (const arco of ARCS) {
    const ea = a.filter((x) => x.arco === arco), eb = b.filter((x) => x.arco === arco);
    ["25", "50", "75"].forEach((g, i) => compara(`L ${L}, ${arco} al ${g} %`, ea.map((x) => x.metas[i]), eb.map((x) => x.metas[i]), puestos));
  }
  compara(`L ${L}, susto antes de la mitad`, a.filter((x) => x.arco === "susto").map((x) => x.antes), b.filter((x) => x.arco === "susto").map((x) => x.antes), [true, false]);
  return out;
}

describe("la marcha pareja: el espejo de la ley de la ganadora", () => {
  it("con 8 carriles, en 3.000 planes, lo que busca cada carril tiene la ley de la ganadora: el arco dado el puesto de entrada y el puesto de cada compuerta dado el arco", () => {
    const ganadora = deLaGanadora(8, 3000);
    const demas = deLasDemas(8, ganadora, 6);
    expect(diferencias(8, ganadora, demas)).toEqual([]);
    // Y la prueba ve un cambio de una sola de las dos: si la ganadora buscara al 75 % del susto dos puestos más atrás, o entrara con el duelo atrás.
    const movida = ganadora.map((x) => (x.arco === "susto" ? { ...x, metas: [x.metas[0], x.metas[1], Math.min(8, x.metas[2] + 2)] as [number, number, number] } : x));
    expect(diferencias(8, movida, demas).length).toBeGreaterThan(0);
    const otraEntrada = ganadora.map((x) => (x.arco === "duelo" ? { ...x, r07: 9 - x.r07 } : x));
    expect(diferencias(8, otraEntrada, demas).length).toBeGreaterThan(0);
  }, 120_000);

  it.each([2, 3, 5, 7])("con %i carriles, en 1.500 planes, el arco dado el puesto de entrada y los puestos de cada compuerta son los de la ganadora", (L) => {
    const ganadora = deLaGanadora(L, 1500);
    expect(diferencias(L, ganadora, deLasDemas(L, ganadora, 6))).toEqual([]);
  }, 120_000);

  it("los momentos ciegos: cuántos según los carriles, entre el 20 y el 72 % con 0,11 de separación, a cualquiera, y la escupida a una vecina", () => {
    const rnd = sembrar(5);
    const actores = new Array<number>(8).fill(0);
    for (let s = 0; s < 4000; s++) {
      for (const L of [2, 3, 5, 8]) {
        const ms = momentosCiegos(L, rnd);
        expect(ms.length).toBe(Math.min(L, L <= 3 ? 1 : L <= 5 ? 2 : 3));
        for (const [i, b] of ms.entries()) {
          expect(b.at).toBeGreaterThanOrEqual(0.2 - 1e-12);
          expect(b.at).toBeLessThanOrEqual(0.72 + 1e-12);
          if (i) expect(b.at - (ms[i - 1] as Beat).at).toBeGreaterThanOrEqual(0.11 - 1e-12);
          if (b.kind === "escupida") expect(Math.abs((b.target as number) - b.actor)).toBe(1);
          if (L === 8) (actores[b.actor] as number)++;
        }
      }
    }
    // Con ocho, cada carril recibe la parte que le toca (12.000 momentos, 1.500 por carril).
    for (const c of actores) expect(Math.abs(c - 1500)).toBeLessThan(4 * Math.sqrt(1500 * (7 / 8)));
  });
});

/* ------------------------------------------------------------------------------------------------ 2 a 4. la carrera */

/** El puesto de cada carril en `q` (0 es la primera), por lo que se dibuja. */
const puestosEn = (d: Datos, q: number): number[] => {
  const xs = d.final.lanes.map((_, j) => d.final.pos(j, q));
  return xs.map((x, j) => xs.filter((y, k) => k !== j && y > x).length);
};

interface Ronda {
  d: Datos;
  L: number;
  /** La ganadora, por carril. */
  w: number;
  /** Los puestos al 0, 25, 50 y 75 % de la recta. */
  P: number[][];
  /** Los puestos y los lugares (en cuerpos) a tres segundos de la meta. */
  pT3: number[];
  xT3: number[];
}

function rondaDe(n: number, s: number, senuelos: boolean): Ronda {
  const d = planCarrera(ctxDe(n, s), { senuelos }).datos;
  const qT3 = d.q(d.tCrown - 3);
  return {
    d, L: d.final.lanes.length, w: d.final.story.winner,
    P: [0, 0.25, 0.5, 0.75].map((q) => puestosEn(d, q)),
    pT3: puestosEn(d, qT3),
    xT3: d.final.lanes.map((_, k) => d.final.pos(k, qT3) / CUERPO),
  };
}

const memo = new Map<string, Ronda[]>();
const rondas = (n: number, S: number, senuelos = true): Ronda[] => {
  const clave = `${n}:${S}:${senuelos}`;
  const hecho = memo.get(clave);
  if (hecho) return hecho;
  const out = Array.from({ length: S }, (_, i) => rondaDe(n, i + 1, senuelos));
  memo.set(clave, out);
  return out;
};

/** Las señales que se ven antes del corte de la cámara, por carril: a quiénes les pasa cada una en la ronda. */
function senales(r: Ronda): Record<string, number[]> {
  const { d, L, P } = r;
  const todas = Array.from({ length: L }, (_, k) => k);
  const m = d.final.marcha;
  const momentos: readonly Beat[] = m?.momentos ?? d.final.story.beats;
  const sustos = m?.sustos ?? (d.final.story.arc === "susto" ? [r.w] : []);
  const out: Record<string, number[]> = {
    "sube 3": todas.filter((k) => [0, 1, 2].some((g) => ((P[g] as number[])[k] as number) - ((P[g + 1] as number[])[k] as number) >= 3)),
    "baja 3": todas.filter((k) => [0, 1, 2].some((g) => ((P[g + 1] as number[])[k] as number) - ((P[g] as number[])[k] as number) >= 3)),
    susto: [...new Set(sustos)],
    "primera al 25, 50 y 75": todas.filter((k) => [1, 2, 3].every((g) => (P[g] as number[])[k] === 0)),
  };
  for (const kind of ["plantada", "tropiezo", "pique", "escupida"]) out[kind] = [...new Set(momentos.filter((b) => b.kind === kind).map((b) => b.actor))];
  out.escupido = [...new Set(momentos.filter((b) => b.kind === "escupida" && b.target !== undefined).map((b) => b.target as number))];
  return out;
}

/** Para cada señal: cuántas veces le pasa a la ganadora contra las que tocan por la parte de carriles que la tienen, en desvíos (Bernoulli por ronda). */
function desvios(rs: readonly Ronda[]): Record<string, { z: number; suyas: number; esperadas: number }> {
  const acc: Record<string, { suyas: number; esperadas: number; varianza: number }> = {};
  for (const r of rs) {
    for (const [s, con] of Object.entries(senales(r))) {
      const p = con.length / r.L;
      const a = (acc[s] ??= { suyas: 0, esperadas: 0, varianza: 0 });
      a.suyas += con.includes(r.w) ? 1 : 0;
      a.esperadas += p;
      a.varianza += p * (1 - p);
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([s, a]) => [s, { z: a.varianza > 0 ? (a.suyas - a.esperadas) / Math.sqrt(a.varianza) : 0, suyas: a.suyas, esperadas: a.esperadas }]));
}

/** Chi cuadrado de una cuenta contra lo esperado. */
const chi2 = (obs: readonly number[], esp: readonly number[]): number => obs.reduce((s, o, i) => s + ((o - (esp[i] as number)) ** 2) / Math.max(1e-9, esp[i] as number), 0);
/** El chi cuadrado que deja p = 0,001, por grados de libertad. */
const CHI2_MIL: Record<number, number> = { 1: 10.828, 2: 13.816, 3: 16.266, 4: 18.467, 5: 20.515, 6: 22.458, 7: 24.322 };

describe("la marcha pareja: la ganadora es una llama más hasta el corte de la cámara", () => {
  it("la medida tiene fuerza: con la carrera de antes, la ganadora se separa de las demás por más de cuatro desvíos", () => {
    const z = desvios(rondas(8, 100, false));
    const peor = Math.max(...Object.values(z).map((x) => Math.abs(x.z)));
    expect(peor, JSON.stringify(z)).toBeGreaterThan(4);
  }, 120_000);

  it.each([8, 18])("con %i personas, en 400 rondas: subir o bajar tres puestos, el susto, cada momento e ir primera al 25, 50 y 75 % le pasan a la ganadora como a cualquiera", (n) => {
    const z = desvios(rondas(n, 400));
    for (const [s, x] of Object.entries(z)) expect(Math.abs(x.z), `${s}: ${x.suyas} contra ${x.esperadas.toFixed(1)}`).toBeLessThan(4);
    // Y todas pasan: no es que nunca pasen.
    expect(z.susto?.esperadas ?? 0).toBeGreaterThan(50);
    expect(z["sube 3"]?.esperadas ?? 0).toBeGreaterThan(20);
  }, 300_000);

  it.each([8, 18])("con %i personas: las tres que acompañan a la ganadora a tres segundos de la meta se sortean sin mirar dónde iban al 75 %, y suben como ella", (n) => {
    const rs = rondas(n, 400);
    const L = (rs[0] as Ronda).L;
    const delGrupo = new Array<number>(L).fill(0), todas = new Array<number>(L).fill(0);
    const subida = { w: [] as number[], otras: [] as number[] };
    let completas = 0;
    for (const r of rs) {
      const grupo = r.d.final.marcha?.grupoT3 ?? [];
      expect(grupo.length).toBe(Math.min(PUESTOS_AL_90, L));
      expect(grupo[0]).toBe(r.w);
      if (grupo.every((k) => (r.pT3[k] as number) < PUESTOS_AL_90)) completas++;
      const p75 = r.P[3] as number[];
      for (let k = 0; k < L; k++) if (k !== r.w) (todas[p75[k] as number] as number)++;
      for (const k of grupo) {
        if (k !== r.w) (delGrupo[p75[k] as number] as number)++;
        (k === r.w ? subida.w : subida.otras).push((p75[k] as number) - (r.pT3[k] as number));
      }
    }
    // A tres segundos de la meta las cuatro del grupo van adelante (si no, el repuesto: la que entra tarde no sería nunca la ganadora).
    expect(completas / rs.length).toBeGreaterThan(0.99);
    // El puesto al 75 % de las tres del grupo es el de todas las que no ganan (son tres de siete).
    const esp = todas.map((c) => (c * (PUESTOS_AL_90 - 1)) / (L - 1));
    const libres = esp.filter((e) => e > 0).length - 1;
    expect(chi2(delGrupo, esp), `${delGrupo.join(",")} contra ${esp.map((e) => e.toFixed(0)).join(",")}`).toBeLessThan(CHI2_MIL[libres] as number);
    // Y suben lo mismo desde el 75 %: la parte que sube tres o más y la subida media.
    const parte = (xs: number[]): number => xs.filter((x) => x >= 3).length / xs.length;
    const pw = parte(subida.w), po = parte(subida.otras), pp = parte([...subida.w, ...subida.otras]);
    expect(Math.abs(pw - po) / Math.sqrt(pp * (1 - pp) * (1 / subida.w.length + 1 / subida.otras.length)), `sube 3: ${pw.toFixed(3)} contra ${po.toFixed(3)}`).toBeLessThan(4);
    const media = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const todasSub = [...subida.w, ...subida.otras], m = media(todasSub);
    const sd = Math.sqrt(todasSub.reduce((a, b) => a + (b - m) ** 2, 0) / todasSub.length);
    expect(Math.abs(media(subida.w) - media(subida.otras)) / (sd * Math.sqrt(1 / subida.w.length + 1 / subida.otras.length)), `media ${media(subida.w).toFixed(2)} contra ${media(subida.otras).toFixed(2)}`).toBeLessThan(4);
  }, 300_000);

  it.each([8, 18])("con %i personas: el puesto de la ganadora sigue parejo al 25, 50 y 75 % y entre las cuatro de adelante a tres segundos de la meta", (n) => {
    const rs = rondas(n, 400);
    const L = (rs[0] as Ronda).L;
    for (const g of [1, 2, 3]) {
      const cuenta = new Array<number>(L).fill(0);
      for (const r of rs) (cuenta[(r.P[g] as number[])[r.w] as number] as number)++;
      expect(chi2(cuenta, cuenta.map(() => rs.length / L)), `al ${[0, 25, 50, 75][g]} %: ${cuenta.join(",")}`).toBeLessThan(CHI2_MIL[L - 1] as number);
    }
    const t3 = new Array<number>(PUESTOS_AL_90).fill(0);
    for (const r of rs) (t3[Math.min(PUESTOS_AL_90 - 1, r.pT3[r.w] as number)] as number)++;
    expect(chi2(t3, t3.map(() => rs.length / PUESTOS_AL_90)), `a tres segundos: ${t3.join(",")}`).toBeLessThan(CHI2_MIL[PUESTOS_AL_90 - 1] as number);
  }, 300_000);

  it("con 8 personas, en 400 rondas: a tres segundos de la meta el hueco de la ganadora con su vecina es como el de las otras tres del grupo", () => {
    const rs = rondas(8, 400);
    const hueco = { w: [] as number[], otras: [] as number[] };
    let raras = 0, conRara = 0;
    for (const r of rs) {
      const cuatro = r.xT3.map((_, k) => k).filter((k) => (r.pT3[k] as number) < PUESTOS_AL_90);
      const h = cuatro.map((k) => Math.min(...r.xT3.filter((_, j) => j !== k).map((x) => Math.abs(x - (r.xT3[k] as number)))));
      cuatro.forEach((k, i) => (k === r.w ? hueco.w : hueco.otras).push(h[i] as number));
      // La regla del que mira: la de hueco más distinto de la mediana de las cuatro. Si hay empate, se reparte.
      const orden = [...h].sort((a, b) => a - b);
      const mediana = ((orden[1] as number) + (orden[2] as number)) / 2;
      const dist = h.map((x) => Math.abs(x - mediana));
      const max = Math.max(...dist);
      if (max < 1e-6) continue;
      const marcadas = cuatro.filter((_, i) => (dist[i] as number) > max - 1e-9);
      conRara++;
      if (marcadas.includes(r.w)) raras += 1 / marcadas.length;
    }
    // La ganadora es la del hueco raro una de cada cuatro veces (con la ganadora entre sus vecinas y las demás en la grilla, la mitad).
    expect(Math.abs(raras - conRara / 4) / Math.sqrt((conRara * 3) / 16), `${raras.toFixed(1)} de ${conRara}`).toBeLessThan(4);
    // Y la distribución entera del hueco: por sextos de la muestra junta, la ganadora contra las otras tres (chi cuadrado de homogeneidad).
    const juntas = [...hueco.w, ...hueco.otras].sort((a, b) => a - b);
    const cortes = [...new Set([1, 2, 3, 4, 5].map((i) => juntas[Math.floor((i * juntas.length) / 6)] as number))];
    const casillero = (x: number): number => cortes.filter((c) => x > c).length;
    const cw = new Array<number>(cortes.length + 1).fill(0), co = new Array<number>(cortes.length + 1).fill(0);
    for (const x of hueco.w) (cw[casillero(x)] as number)++;
    for (const x of hueco.otras) (co[casillero(x)] as number)++;
    const usados = cw.map((_, i) => i).filter((i) => (cw[i] as number) + (co[i] as number) >= 10);
    const nw = hueco.w.length, no = hueco.otras.length;
    let stat = 0;
    for (const i of usados) {
      const tot = (cw[i] as number) + (co[i] as number);
      const ew = (tot * nw) / (nw + no), eo = (tot * no) / (nw + no);
      stat += ((cw[i] as number) - ew) ** 2 / ew + ((co[i] as number) - eo) ** 2 / eo;
    }
    if (usados.length >= 2) expect(stat, `ganadora ${cw.join(",")} contra ${co.join(",")} (cortes ${cortes.map((c) => c.toFixed(3)).join(", ")})`).toBeLessThan(CHI2_MIL[usados.length - 1] as number);
  }, 300_000);

  // En el duelo, con su cámara lenta, el 90 % de la recta llega unos dos décimos antes del corte de la cámara. Si la compuerta del grupo de punta
  // cayera ahí, en esos décimos cada una ya iría hacia su puesto de un segundo y medio antes de la meta, y la que más se mueve sería la ganadora:
  // la del hueco raro en el corte sería ella más de una de cada cuatro veces, y solo en el duelo.
  it("con 8 personas, en 400 rondas: la compuerta del grupo de punta cae justo en el corte de la cámara, también en el duelo", () => {
    const rs = rondas(8, 400);
    let duelos = 0;
    for (const r of rs) {
      const m = r.d.final.marcha;
      expect(m).toBeDefined();
      const c4 = (m?.compuertas[4] as { t: number }).t;
      expect(Math.abs(c4 - ((m?.duracion as number) - 3)), `ronda con arco ${r.d.final.story.arc}: la compuerta a ${c4.toFixed(3)} s y el corte a ${((m?.duracion as number) - 3).toFixed(3)} s`).toBeLessThan(1e-9);
      if (r.d.final.story.arc === "duelo") duelos++;
    }
    expect(duelos).toBeGreaterThan(60);
    // La prueba ve la diferencia: en la carrera de antes, en el duelo la compuerta cae antes del corte.
    const antes = rondas(8, 100, false).filter((r) => r.d.final.story.arc === "duelo").map((r) => (r.d.final.marcha?.duracion as number) - 3 - (r.d.final.marcha?.compuertas[4] as { t: number }).t);
    expect(antes.length).toBeGreaterThan(10);
    expect(Math.min(...antes)).toBeGreaterThan(0.05);
  }, 300_000);
});

describe("la marcha pareja: la velocidad con que se llega al corte de la cámara", () => {
  // Si la pendiente de cada curva en el corte mirara también el tramo siguiente, la ganadora llegaría al corte todavía subiendo (después sube a su
  // puesto de un segundo y medio antes de la meta) y las otras tres, quietas o bajando: con 400 rondas de 8 y 400 de 18, 0,035 cuerpos por segundo
  // más rápida que las otras tres, a seis desvíos. Con la pendiente de su propio tramo, la diferencia queda en el azar.
  it("con 8 y 18 personas, en 400 rondas cada una: en el corte, la ganadora no llega más rápido que las otras tres del grupo, y la que más avanza en los 0,6 s antes es ella una de cada cuatro veces", () => {
    const D: number[] = [];
    let suyas = 0, total = 0;
    for (const n of [8, 18]) {
      for (const r of rondas(n, 400)) {
        const { d } = r;
        const q = (t: number): number => d.q(d.tCrown - t);
        const avance = (t0: number, t1: number): number[] => d.final.lanes.map((_, k) => (d.final.pos(k, q(t1)) - d.final.pos(k, q(t0))) / CUERPO);
        const cuatro = r.pT3.map((_, k) => k).filter((k) => (r.pT3[k] as number) < PUESTOS_AL_90);
        const otras = cuatro.filter((k) => k !== r.w);
        if (!cuatro.includes(r.w) || !otras.length) continue;
        // La velocidad en los 0,3 s antes del corte, de la ganadora menos la media de las otras tres (como se compara entre ellas, alcanza con lo que
        // avanza cada una: el pelotón se resta solo).
        const v = avance(3.3, 3).map((x) => x / 0.3);
        D.push((v[r.w] as number) - otras.reduce((a, k) => a + (v[k] as number), 0) / otras.length);
        const a = avance(3.6, 3);
        const max = Math.max(...cuatro.map((k) => a[k] as number));
        const marcadas = cuatro.filter((k) => (a[k] as number) > max - 1e-9);
        total++;
        if (marcadas.includes(r.w)) suyas += 1 / marcadas.length;
      }
    }
    const media = D.reduce((x, y) => x + y, 0) / D.length;
    const sd = Math.sqrt(D.reduce((x, y) => x + (y - media) ** 2, 0) / (D.length - 1));
    expect(Math.abs(media) / (sd / Math.sqrt(D.length)), `la ganadora llega ${media.toFixed(3)} cuerpos por segundo más rápida que las otras tres (${D.length} rondas)`).toBeLessThan(4);
    const z = (suyas - total / 4) / Math.sqrt((total * 3) / 16);
    expect(Math.abs(z), `la más rápida en los 0,6 s antes del corte es la ganadora ${suyas.toFixed(1)} de ${total} veces (le tocan ${(total / 4).toFixed(0)})`).toBeLessThan(4);
  }, 300_000);
});

/* ------------------------------------------------------------------------------------------------ 6. la entrada pareja */

describe("la marcha pareja: la entrada a la recta es pareja con cualquier cantidad de carriles", () => {
  it("con 3 a 8 carriles, sumando los arcos, cada puesto de entrada sale exactamente una vez de cada L (con L impar el del medio pesa la mitad en cada franja)", () => {
    for (let L = 3; L <= 8; L++) {
      const arcos = arcosPosibles(L);
      const total = new Array<number>(L).fill(0);
      for (const a of arcos) pesosDeEntrada(L, a).forEach((p, i) => (total[i] = (total[i] as number) + p / arcos.length));
      for (const [i, p] of total.entries()) expect(p, `L ${L}, puesto ${i + 1}`).toBeCloseTo(1 / L, 12);
    }
    // Con L par es la franja pareja de siempre: parejo dentro de la franja del arco.
    expect(pesosDeEntrada(8, "duelo")).toEqual([0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0]);
    // Con tres, la del medio pesa la mitad: dos tercios la primera y un tercio la segunda en la franja de adelante.
    const tres = pesosDeEntrada(3, "susto");
    expect(tres[0]).toBeCloseTo(2 / 3, 12);
    expect(tres[1]).toBeCloseTo(1 / 3, 12);
    expect(tres[2]).toBe(0);
  });

  it("con dos carriles se sortea primero el puesto y después el arco: la primera, susto o duelo mitad y mitad, y la segunda, remontada", () => {
    const parte = (r: number, arco: string): number => {
      let c = 0;
      for (let i = 0; i < 10_000; i++) if (arcoDeEntrada(2, r, () => (i + 0.5) / 10_000) === arco) c++;
      return c / 10_000;
    };
    expect(parte(1, "susto")).toBeCloseTo(0.5, 3);
    expect(parte(1, "duelo")).toBeCloseTo(0.5, 3);
    expect(parte(2, "remontada")).toBe(1);
    expect(arcosPosibles(2)).not.toContain("tapada");
  });

  it.each([2, 3, 4, 5, 6, 7])("con %i carriles, en 3.000 planes, la ganadora entra en cada puesto una vez de cada L; sin la entrada pareja, con L impar o con dos, no", (L) => {
    const cuenta = (entradaPareja: boolean): number[] => {
      const c = new Array<number>(L).fill(0);
      for (const x of deLaGanadora(L, 3000, entradaPareja)) (c[x.r07 - 1] as number)++;
      return c;
    };
    const con = cuenta(true);
    expect(chi2(con, con.map(() => 3000 / L)), `${con.join(",")}`).toBeLessThan(CHI2_MIL[L - 1] as number);
    // La prueba tiene fuerza: con la entrada de antes, con dos la primera sale dos de cada tres y con L impar el del medio sale de más.
    if (L === 2 || L % 2 === 1) {
      const sin = cuenta(false);
      expect(chi2(sin, sin.map(() => 3000 / L)), `${sin.join(",")}`).toBeGreaterThan(CHI2_MIL[L - 1] as number);
    }
  }, 120_000);

  it("con L par y tres o más carriles la entrada pareja no cambia nada: el plan es el de antes, número por número", () => {
    for (const n of [4, 6, 8, 12]) {
      for (let s = 1; s <= 60; s++) {
        const a = planRace(nombresDe(n), s % n, sembrar(s * 97 + n), { entradaPareja: true });
        const b = planRace(nombresDe(n), s % n, sembrar(s * 97 + n));
        expect(a.lanes).toEqual(b.lanes);
        expect(a.story).toEqual(b.story);
        expect(a.puestos).toEqual(b.puestos);
        for (const q of [0.067, 0.3, 0.6, 0.9]) for (let k = 0; k < a.lanes.length; k++) expect(a.pos(k, q)).toBe(b.pos(k, q));
      }
    }
  });

  it("con dos carriles la remontada sale la mitad de las veces, el susto y el duelo un cuarto cada uno, y el tropiezo del susto es de la ganadora solo en el susto", () => {
    const arcos: Record<string, number> = {};
    const azar = sembrar(77);
    const N = 3000;
    for (let s = 0; s < N; s++) {
      const p = planRace(nombresDe(2), s % 2, sembrar(Math.floor(azar() * 4294967296)), { entradaPareja: true });
      arcos[p.story.arc] = (arcos[p.story.arc] ?? 0) + 1;
      const tropiezos = p.story.beats.filter((b) => b.kind === "tropiezo" && b.actor === p.story.winner);
      expect(tropiezos.length, `${s} ${p.story.arc}`).toBe(p.story.arc === "susto" ? 1 : 0);
      expect(p.story.beats.length).toBe(tropiezos.length);
      // El puesto de entrada es el de su arco: adelante en el susto y el duelo, atrás en la remontada.
      const r07 = (p.puestos.find((x) => Math.abs(x.q - 0.067) < 1e-9) as { r: number }).r;
      expect(r07, `${s} ${p.story.arc}`).toBe(p.story.arc === "remontada" ? 2 : 1);
    }
    const tol = 4 * Math.sqrt(0.25 * 0.75 / N);
    expect(Math.abs((arcos.remontada ?? 0) / N - 0.5)).toBeLessThan(tol);
    expect(Math.abs((arcos.susto ?? 0) / N - 0.25)).toBeLessThan(tol);
    expect(Math.abs((arcos.duelo ?? 0) / N - 0.25)).toBeLessThan(tol);
    expect(arcos.tapada ?? 0).toBe(0);
  });

  it.each([2, 3])("en la carrera con %i personas, en 400 rondas, la ganadora entra a la recta en cada puesto una vez de cada L", (n) => {
    const cuenta = new Array<number>(n).fill(0);
    for (let s = 1; s <= 400; s++) {
      const { sinObstaculos, entradaLanes } = capasDeLaRecta(ctxDe(n, s), { senuelos: true });
      (cuenta[entradaLanes.indexOf(sinObstaculos.story.winner)] as number)++;
    }
    expect(chi2(cuenta, cuenta.map(() => 400 / n)), `${cuenta.join(",")}`).toBeLessThan(CHI2_MIL[n - 1] as number);
  }, 300_000);
});
