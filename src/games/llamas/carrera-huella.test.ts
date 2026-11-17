import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formaDelGrupo } from "./carrera-filas";
import { CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { paresDelTropiezo, victimaDelTropiezo, type EntradaTropiezo } from "./carrera-piedritas";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, RECTA, type Datos, type OpcionesCarrera } from "./carrera-show";
import { subfilasDe } from "./carrera-trayectorias";

/**
 * La huella de la carrera de siempre: para varias cantidades de personas y varias semillas, un SHA-256 de cada parte de lo que se arma (la recta
 * en 41 puntos, la marcha, los obstáculos, las posturas, el guion del relator, el grupo, el tropiezo de las piedritas y las subfilas del corral).
 * Fija la carrera de hoy número por número: cualquier cambio que la mueva, aunque sea una millonésima de recta, cambia alguna parte.
 *
 * Sirve para comprobar que una carrera con un interruptor apagado es exactamente la de hoy: la opción `senuelos: false` de `planCarrera` y el
 * mismo `false` para las piedritas (`paresDelTropiezo` y `victimaDelTropiezo`) dan la carrera de antes de la marcha pareja.
 *
 * Los números se guardan con nueve decimales (en fracción de la recta, una cien millonésima de cuerpo): así la huella no depende de la versión de
 * Node, que puede redondear distinto el último bit de una función matemática, y cualquier cambio de la carrera, que mueve mucho más, se ve.
 *
 * Para rehacerla (solo cuando un cambio de la carrera de hoy es a propósito): `HUELLA_CARRERA=escribir pnpm exec vitest run` sobre este archivo.
 */
const ARCHIVO = new URL("./carrera-huella.json", import.meta.url);
const CANTIDADES = [2, 3, 5, 8, 18, 30, 60, 200];
const SEMILLAS = [1, 2, 3, 4, 5, 6];
const PUNTOS = 40;
const HOY: OpcionesCarrera = { senuelos: false };
const pares = paresDelTropiezo;
const victima = victimaDelTropiezo;

/** Un número con nueve decimales, o su nombre si no es finito. */
const r = (v: number): string => (Number.isFinite(v) ? v.toFixed(9) : String(v));
/** Un valor en JSON, con cada número redondeado como `r` y las funciones afuera. */
const json = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (typeof x === "number" ? r(x) : typeof x === "function" ? undefined : x));
const sha = (partes: string[]): string => createHash("sha256").update(partes.join("\n")).digest("hex");

/** El lado de la subfila de cada persona del grupo en una pantalla, armado como lo arma el auditor de delatores. */
function subfilas(d: Datos, W: number, H: number): string {
  const u = W < H ? Math.min(W / 420, H / 900) : H / 720;
  const P = { w: W, h: H, u, retrato: W < H, top: 60 * u, bottom: H - 90 * u };
  const cuerpo = CUERPO * ENSANCHE * RECTA * W;
  const grupo = formaDelGrupo({ P, d, nombrePx: 16 * u, nombreW: 110 * u, cuerpoPx: cuerpo });
  const signo = subfilasDe(d, grupo.forma, (p) => grupo.filaDeLugar[d.orden.rango(p)] as number, cuerpo).signo;
  return json({ filas: grupo.forma.filas, filaDeLugar: grupo.filaDeLugar, signo: d.gente.map((p) => signo.get(p) ?? 0) });
}

type PlanDeCarrera = ReturnType<typeof planCarrera>;
const texto = (t: string | (() => string)): string => (typeof t === "function" ? t() : t);

/** La huella de un plan de la carrera: un SHA-256 por parte. */
function huellaDelPlan(plan: PlanDeCarrera): Record<string, string> {
  const d = plan.datos;
  const f = d.final;
  const L = f.lanes.length;
  const qs = Array.from({ length: PUNTOS + 1 }, (_, i) => i / PUNTOS);
  const e: EntradaTropiezo = { semilla: d.semillaRocas, tramos: d.tramos, gente: d.gente, cae: (g) => d.tiempos.cae.get(g) ?? Infinity };
  const muestras: number[] = [];
  for (let t = d.tSalida; t < d.tCrown; t += 0.5) muestras.push(t);
  return {
    recta: sha([json(f.lanes), ...qs.map((q) => f.lanes.map((_, k) => r(f.pos(k, q))).join(","))]),
    historia: sha([json(f.story), json(f.puestos), r(f.foto), json([f.decoy, f.hinchada, f.foco]), json(f.cierre ?? null)]),
    marcha: sha([json(f.marcha?.compuertas ?? []), json(f.marcha?.causas ?? []), r(f.marcha?.duracion ?? NaN)]),
    obstaculos: sha([json(f.obstaculos ?? [])]),
    posturas: sha(qs.map((q) => Array.from({ length: L }, (_, k) => json(f.beatOf(k, q))).join(","))),
    guion: sha(plan.guion.filter((l) => l.texto !== undefined).map((l) => `${r(l.t)}:${texto(l.texto as string | (() => string))}`)),
    grupo: sha([
      json(d.gente), json([d.tSalida, d.tAbre, d.tCarriles, d.tCrown]), json(d.tiempos.echadas), json(d.marcas), json(d.cambiosDePunta), json(d.sucesos),
      ...muestras.map((t) => `${r(t)}:${d.lider(t)}:${d.vivas(t).join(",")}`),
    ]),
    piedritas: sha([json(victima(e, HOY.senuelos)), json(pares(e, HOY.senuelos))]),
    subfilas: sha([subfilas(d, 1366, 768), subfilas(d, 390, 844)]),
  };
}

/** La huella de la ronda `semilla` con `n` personas (el contexto de las pruebas de la carrera), con el interruptor apagado. */
const huellaDe = (n: number, semilla: number): Record<string, string> => huellaDelPlan(planCarrera(ctxDe(n, semilla), HOY));

const escribir = process.env.HUELLA_CARRERA === "escribir";

describe("la huella de la carrera de siempre", () => {
  it.runIf(escribir)("escribe la huella de hoy", () => {
    const todo: Record<string, Record<string, string>> = {};
    for (const n of CANTIDADES) for (const s of SEMILLAS) todo[`${n}-${s}`] = huellaDe(n, s);
    writeFileSync(ARCHIVO, `${JSON.stringify(todo, null, 1)}\n`);
  }, 300_000);

  it.each(CANTIDADES)("con %i personas, cada parte de la carrera es la de hoy, número por número", (n) => {
    const guardada = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, Record<string, string>>;
    for (const s of SEMILLAS) {
      const hoy = guardada[`${n}-${s}`];
      expect(hoy, `${n}-${s}: falta en la huella`).toBeDefined();
      expect(huellaDe(n, s), `${n}-${s}`).toEqual(hoy);
    }
  }, 120_000);

  it("la huella ve un cambio chico: una millonésima de recta en un carril y un punto cambia la recta y nada más, y se calcula igual dos veces", () => {
    const plan = planCarrera(ctxDe(8, 1), HOY);
    const a = huellaDelPlan(plan);
    expect(huellaDelPlan(planCarrera(ctxDe(8, 1), HOY))).toEqual(a);
    const f = plan.datos.final;
    const corrida: PlanDeCarrera = { ...plan, datos: { ...plan.datos, final: { ...f, pos: (k, q) => f.pos(k, q) + (k === 3 && q === 0.5 ? 1e-6 : 0) } } };
    const b = huellaDelPlan(corrida);
    expect(b.recta).not.toBe(a.recta);
    expect({ ...b, recta: a.recta }).toEqual(a);
    // Otra semilla es otra carrera en cada parte de la recta.
    const otra = huellaDe(8, 2);
    for (const parte of ["recta", "historia", "marcha", "guion"]) expect(otra[parte], parte).not.toBe(a[parte]);
  }, 60_000);
});
