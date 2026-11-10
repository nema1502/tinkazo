import { describe, expect, it, vi } from "vitest";
import { crearGuion } from "../pixi/kit/guion";
import type { LineaGuion, Vista } from "../pixi/kit/tipos";
import { cabe, centrar, crecer, dentro, unir, type Caja, type Zona } from "../pixi/encuadre";
import { tamanoLetra } from "../pixi/kit/nombres";
import { aLaVistaPx, cajaEnPantalla, type Puesto } from "./carrera-camara";
import { correr, pantallaDe, puestosDe, type Corrida } from "./carrera-camara-prueba";
import { camara3D } from "./carrera-3d-mapa";
import { filaDeRango } from "./carrera-caminata";
import { LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO, LLAMA_LARGO, carrilesDe, formaDe, hudDe } from "./carrera-forma";
import { ENSANCHE } from "./carrera-obstaculos";
import { CARRIL_ANTES, CUERPO } from "./carrera-marcha";
import { ctxDe } from "./carrera-prueba";
import { CINTA_SIN_SENALAR, MARCA_MIN, MARCA_VENTAJA, RECTA, corto, planCarrera, type Datos } from "./carrera-show";
import { TEXTOS_CARRERA } from "./carrera-textos";

/**
 * Lo que se lee y lo que se ve dicen lo mismo (la carrera de siempre, sin navegador).
 *
 * - Mientras en pantalla se lee una línea que nombra a la puntera («¡Va adelante Ana!», «¡Ahora va Ana!»), la marca (el aro, la borla, la ficha
 *   amarilla y la cara de la cinta) está en esa misma llama. Lo que se lee sale de la cola del guion, cuadro a cuadro: una línea queda en
 *   pantalla hasta la siguiente.
 * - La marca no cambia de dueña dos veces en menos de `MARCA_MIN` segundos, y pasa solo cuando la nueva ya va adelante en el cuadro: le saca
 *   `MARCA_VENTAJA` cuerpos (o la que la llevaba se echó) y, en la recta, va adelante en la pantalla con la cámara 3D de ese momento.
 * - «¡Vamos, Ana!» solo nombra a una llama que está en el cuadro de la cámara 3D en ese momento.
 */

vi.setConfig({ testTimeout: 600_000 });

const TAMANOS = [8, 18, 60];
const SEMILLAS = Array.from({ length: 30 }, (_, i) => i + 1);
const PANTALLAS = { proyector: pantallaDe(1920, 1080), "1366x768": pantallaDe(1366, 768), celular: pantallaDe(390, 844) };

const es = TEXTOS_CARRERA.es;
const carVa = es.carVa as (n: string) => string;
const carAdelante = es.carAdelante as (n: string, v: number) => string;
const carHinchada = es.carHinchada as (n: string) => string;

/** Las líneas que nombran a la puntera y a quiénes puede nombrar cada una (con más de 32 personas, dos pueden tener el mismo nombre corto). */
function lineasDePuntera(nombres: readonly string[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  const poner = (texto: string, i: number): void => void (m.get(texto) ?? m.set(texto, new Set()).get(texto))?.add(i);
  nombres.forEach((nm, i) => {
    poner(carVa(corto(nm)), i);
    for (let v = 0; v < 3; v++) poner(carAdelante(corto(nm), v), i);
  });
  return m;
}

/** Lo que se lee en pantalla en cada cuadro (60 por segundo) hasta la meta: la última línea que salió de la cola. */
function loQueSeLee(guion: readonly LineaGuion[], hasta: number): { t: number; texto: string }[] {
  const g = crearGuion(guion);
  const out: { t: number; texto: string }[] = [];
  let texto = "";
  const ej = { decir: (x: string): void => void (texto = x), hacer: (): void => undefined };
  for (let i = 0; i / 60 < hasta; i++) {
    g.avanzar(i / 60, ej);
    out.push({ t: i / 60, texto });
  }
  return out;
}

/** Dónde va `g` en `t`, en cuerpos: la misma cuenta que la pone en la pantalla. */
function enCuerpos(d: Datos, g: number, t: number): number {
  if (t < d.tAbre) return d.orden.puntaje(g, Math.max(t, d.tSalida));
  const qq = d.q(t);
  return (d.final.pos(d.lanes.indexOf(g), qq) - qq) / CUERPO;
}

const planes = new Map<string, ReturnType<typeof planCarrera>>();
function planDe(n: number, s: number): ReturnType<typeof planCarrera> {
  const k = `${n}|${s}`;
  let p = planes.get(k);
  if (!p) planes.set(k, (p = planCarrera(ctxDe(n, s))));
  return p;
}

/** El cuadro de la cámara 3D más cercano a `t`. */
const cuadroEn = (c: Corrida, t: number): Corrida["cuadros"][number] => c.cuadros.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));

describe("la carrera de siempre: lo que se lee y lo que se ve dicen lo mismo", () => {
  it("mientras se lee una línea que nombra a la puntera, la marca está en ella (8, 18 y 60 personas, 30 semillas)", () => {
    const fallas: string[] = [];
    for (const n of TAMANOS) {
      for (const s of SEMILLAS) {
        const ctx = ctxDe(n, s);
        const plan = planDe(n, s);
        const d = plan.datos;
        const puntera = lineasDePuntera(ctx.nombres);
        const hasta = d.tCrown - CINTA_SIN_SENALAR;
        for (const c of loQueSeLee(plan.guion, hasta)) {
          const quienes = puntera.get(c.texto);
          if (!quienes || c.t < d.tSalida) continue;
          const m = d.duena(c.t);
          if (!quienes.has(m)) {
            fallas.push(`n=${n} s=${s} t=${c.t.toFixed(2)}: se lee «${c.texto}» y la marca está en ${d.cortos[m]}`);
            break;
          }
        }
      }
    }
    expect(fallas).toEqual([]);
  });

  it(`la marca no cambia de dueña dos veces en menos de ${MARCA_MIN} s, y pasa solo a quien ya va adelante por ${MARCA_VENTAJA} cuerpos`, () => {
    const fallas: string[] = [];
    let cambios = 0;
    for (const n of TAMANOS) {
      for (const s of SEMILLAS) {
        const d = planDe(n, s).datos;
        const ms = d.marcas;
        expect(ms.length, `n=${n} s=${s}`).toBeGreaterThan(0);
        for (let i = 1; i < ms.length; i++) {
          const a = ms[i - 1] as { t: number; quien: number }, b = ms[i] as { t: number; quien: number };
          cambios++;
          if (b.t - a.t < MARCA_MIN - 1e-6) fallas.push(`n=${n} s=${s}: de ${d.cortos[a.quien]} (${a.t.toFixed(2)}) a ${d.cortos[b.quien]} (${b.t.toFixed(2)}) en ${(b.t - a.t).toFixed(2)} s`);
          if (b.quien === a.quien) fallas.push(`n=${n} s=${s} t=${b.t.toFixed(2)}: la marca «pasa» a la misma`);
          const echada = (d.tiempos.cae.get(a.quien) ?? Infinity) <= b.t;
          const ventaja = enCuerpos(d, b.quien, b.t) - enCuerpos(d, a.quien, b.t);
          if (!echada && ventaja < MARCA_VENTAJA - 1e-6) fallas.push(`n=${n} s=${s} t=${b.t.toFixed(2)}: pasa a ${d.cortos[b.quien]} con ${ventaja.toFixed(2)} cuerpos de ventaja sobre ${d.cortos[a.quien]}`);
          if (b.t >= d.tCrown - CINTA_SIN_SENALAR) fallas.push(`n=${n} s=${s}: la marca cambia en los últimos 3 s`);
        }
      }
    }
    expect(cambios).toBeGreaterThan(TAMANOS.length * SEMILLAS.length);
    expect(fallas).toEqual([]);
  });

  // En la recta del 3D la cámara mira en diagonal desde adelante: cada carril más cerca corre a la llama casi medio cuerpo a la izquierda (un cuerpo
  // y medio en el celular), así que la x de la pantalla entre dos carriles no dice quién va adelante. Lo que se compara es a lo largo del carril, como
  // se ve contra las rayas de la pista: dónde cae la nueva puntera y dónde caería, en su mismo carril, la que llevaba la marca.
  it("en la recta, la marca pasa a quien ya va adelante en la pantalla a lo largo de la pista, con la cámara 3D de ese momento", () => {
    const fallas: string[] = [];
    let medidos = 0;
    for (const n of TAMANOS) {
      for (const s of SEMILLAS.slice(0, 12)) {
        const d = planDe(n, s).datos;
        const enRecta = d.marcas.map((m, i) => ({ m, de: d.marcas[i - 1] })).filter((x) => x.de && x.m.t >= d.tAbre && (d.tiempos.cae.get(x.de.quien) ?? Infinity) > x.m.t);
        if (!enRecta.length) continue;
        for (const [nombre, P] of Object.entries(PANTALLAS)) {
          const c = correr(n, s, P, 0);
          for (const { m, de } of enRecta) {
            const cu = cuadroEn(c, m.t);
            const puesto = (q: number): (typeof cu.puestos)[number] => cu.puestos[d.lanes.indexOf(q)] as (typeof cu.puestos)[number];
            const pn = puesto(m.quien), pv = puesto((de as { quien: number }).quien);
            const nueva = cajaEnPantalla(cu.pose, P.w, P.h, P.u, pn), vieja = cajaEnPantalla(cu.pose, P.w, P.h, P.u, { ...pn, x: pv.x });
            medidos++;
            if (!(nueva.x > vieja.x + 1)) fallas.push(`${nombre} n=${n} s=${s} t=${m.t.toFixed(2)}: ${d.cortos[m.quien]} en x=${nueva.x.toFixed(0)} y ${d.cortos[(de as { quien: number }).quien]}, en su carril, en x=${vieja.x.toFixed(0)}`);
          }
        }
      }
    }
    expect(medidos).toBeGreaterThan(20);
    expect(fallas).toEqual([]);
  });

  // En el grupo el 3D mira lo que mira el director del 2D (`camara3D`), con su ángulo: las filas de atrás quedan un poco más a la derecha. La cámara
  // se toma sobre el frente del grupo (el director deja aire adelante). En el celular parado el grupo tiene hasta diez filas y la fila pesa más que
  // medio cuerpo: esta prueba mira las pantallas apaisadas.
  it("en el grupo, la marca pasa a quien ya va adelante en la pantalla del 3D (pantallas apaisadas)", () => {
    const fallas: string[] = [];
    let medidos = 0;
    for (const [nombre, P] of Object.entries(PANTALLAS).filter(([, p]) => !p.retrato)) {
      const px = tamanoLetra("nombre", P.u);
      for (const n of [18, 30, 60]) {
        for (const s of SEMILLAS) {
          const d = planDe(n, s).datos;
          const forma = formaDe(P, Math.max(1, d.gente.length), px, px * 0.6 * 10);
          const cuerpo = CUERPO * ENSANCHE * RECTA * P.w;
          const pos = (g: number, t: number): Puesto => ({ persona: g, x: d.orden.puntaje(g, t) * cuerpo, y: forma.yPie(filaDeRango(d.orden.rango(g), forma.filas)), esc: forma.esc });
          for (let i = 1; i < d.marcas.length; i++) {
            const m = d.marcas[i] as { t: number; quien: number }, a = d.marcas[i - 1] as { t: number; quien: number };
            if (m.t >= d.tAbre - CARRIL_ANTES || (d.tiempos.cae.get(a.quien) ?? Infinity) <= m.t) continue;
            const pn = pos(m.quien, m.t), pv = pos(a.quien, m.t);
            const pose = camara3D({ x: Math.max(pn.x, pv.x) - 0.22 * P.w, y: P.h / 2, zoom: 1, rot: 0 }, P.w, P.h, P.u, forma.esc);
            const sn = cajaEnPantalla(pose, P.w, P.h, P.u, pn), sv = cajaEnPantalla(pose, P.w, P.h, P.u, pv);
            medidos++;
            if (!(sn.x > sv.x)) fallas.push(`${nombre} n=${n} s=${s} t=${m.t.toFixed(2)}: ${d.cortos[m.quien]} en x=${sn.x.toFixed(0)} y ${d.cortos[a.quien]} en x=${sv.x.toFixed(0)}`);
          }
        }
      }
    }
    expect(medidos).toBeGreaterThan(100);
    expect(fallas).toEqual([]);
  });

  it("«¡Vamos, Ana!» solo nombra a una llama que está en el cuadro de la cámara 3D en ese momento", () => {
    const fallas: string[] = [];
    let gritos = 0;
    for (const n of TAMANOS) {
      for (const s of SEMILLAS.slice(0, 12)) {
        const ctx = ctxDe(n, s);
        const plan = planDe(n, s);
        const d = plan.datos;
        const porTexto = new Map(d.lanes.map((q) => [carHinchada(corto(ctx.nombres[q] as string)), q] as const));
        const gritan = plan.guion.filter((l) => l.texto !== undefined).map((l) => ({ t: l.t, q: porTexto.get(typeof l.texto === "function" ? l.texto() : (l.texto as string)) })).filter((x) => x.q !== undefined);
        if (!gritan.length) continue;
        for (const [nombre, P] of Object.entries(PANTALLAS)) {
          const c = correr(n, s, P, 0);
          for (const g of gritan) {
            gritos++;
            const cu = cuadroEn(c, g.t);
            const p = cu.puestos[d.lanes.indexOf(g.q as number)];
            if (!p || !aLaVistaPx(cajaEnPantalla(cu.pose, P.w, P.h, P.u, p), P.w, P.h)) fallas.push(`${nombre} n=${n} s=${s} t=${g.t.toFixed(2)}: «¡Vamos, ${d.cortos[g.q as number]}!» fuera del cuadro`);
          }
        }
      }
    }
    expect(gritos).toBeGreaterThan(20);
    expect(fallas).toEqual([]);
  });

  // El 2D, desde la tensión (el 55 % de la recta) hasta T-3: la cámara mira a las tres de adelante (`cajasDelFrentePrevias`, sin las que están en
  // apuros, que solo agrandan el plano) y la columna de la meta cuando está cerca, con el margen de `planoSobre` y el empuje de la tensión. Antes de
  // la tensión el plano es el de las ocho (`cajaCarriles`): ahí entran todas. La cámara arranca ya encima de su objetivo (lo más ajustado).
  it("«¡Vamos, Ana!» solo nombra a una llama que está en el cuadro del 2D en ese momento", () => {
    const fallas: string[] = [];
    let gritos = 0;
    for (const [nombre, P] of Object.entries({ "16:9": pantallaDe(1920, 1080), "1366x768": pantallaDe(1366, 768), "4:3": pantallaDe(1024, 768) })) {
      const nombrePx = tamanoLetra("nombre", P.u);
      for (const n of TAMANOS) {
        for (const s of SEMILLAS) {
          const ctx = ctxDe(n, s);
          const plan = planDe(n, s);
          const d = plan.datos;
          const tTension = d.tAbre + 0.55 * (d.tCrown - d.tAbre);
          const porTexto = new Map(d.lanes.map((q) => [carHinchada(corto(ctx.nombres[q] as string)), q] as const));
          const gritan = plan.guion.filter((l) => l.texto !== undefined && l.t >= tTension).map((l) => ({ t: l.t, q: porTexto.get(typeof l.texto === "function" ? l.texto() : (l.texto as string)) })).filter((x) => x.q !== undefined);
          if (!gritan.length) continue;
          const carr = carrilesDe(P, d.lanes.length, nombrePx);
          const zona: Zona = { x0: 0, y0: hudDe(P).bajo, x1: P.w, y1: P.bottom };
          const metaX = RECTA * P.w + LLAMA_HOCICO * carr.esc;
          const en = (t: number): Puesto[] => puestosDe(d, carr, P, 0, t);
          const cuerpo = (p: Puesto): Caja => ({ x: p.x + LLAMA_COLA * p.esc, y: p.y - LLAMA_ALTO * p.esc - carr.altoNombre, w: LLAMA_LARGO * p.esc + 6 * p.esc, h: LLAMA_ALTO * p.esc + carr.altoNombre });
          const objetivo = (t: number): Vista => {
            const ps = en(t);
            const tres = [...ps].sort((a, b) => b.x - a.x).slice(0, 3).map(cuerpo);
            const cajas = d.frac(t) >= 0.86 ? [...tres, { x: metaX - 30 * P.u, y: carr.y0 - 40 * P.u, w: 60 * P.u, h: carr.y1 - carr.y0 + 50 * P.u }] : tres;
            const plano = crecer(unir(cajas), 40);
            const meta: Caja = { x: metaX - 100 * P.u, y: carr.y0 - 130 * P.u, w: 140 * P.u, h: carr.y1 - carr.y0 + 150 * P.u };
            return dentro(meta, zona, centrar(plano, zona, P.w, P.h, cabe(plano, zona)), P.w, P.h);
          };
          for (const g of gritan) {
            gritos++;
            const v = objetivo(g.t);
            const z = v.z * 1.15;
            const c = cuerpo(en(g.t)[d.lanes.indexOf(g.q as number)] as Puesto);
            const cx = P.w / 2 + (c.x + c.w / 2 - v.x) * z, cy = P.h / 2 + (c.y + c.h / 2 - v.y) * z;
            if (cx < 0 || cx > P.w || cy < 0 || cy > P.h) fallas.push(`${nombre} n=${n} s=${s} t=${g.t.toFixed(2)}: «¡Vamos, ${d.cortos[g.q as number]}!» fuera del cuadro`);
          }
        }
      }
    }
    expect(gritos).toBeGreaterThan(20);
    expect(fallas).toEqual([]);
  });

  it("QUEDAN no pasa de 8 a 1 de golpe: se apaga desde T-3 (cuando las fichas quedan iguales) y vuelve con el golpe", () => {
    for (const n of TAMANOS) {
      const plan = planDe(n, 1);
      expect(plan.marcadorApagado).toBeCloseTo(plan.datos.tCrown - CINTA_SIN_SENALAR, 9);
      // Mientras se ve, el número solo baja de a lo que se echa; el salto al 1 cae con el contador apagado.
      expect(plan.marcador((plan.marcadorApagado as number) - 0.01)).toBe(Math.min(n, 8));
    }
  });
});
