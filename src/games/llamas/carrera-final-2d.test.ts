import { describe, expect, it } from "vitest";
import { cabe, centrar, crecer, dentro, unir, type Caja, type Zona } from "../pixi/encuadre";
import { tiemposFoco } from "../pixi/foco";
import { tamanoLetra } from "../pixi/kit/nombres";
import type { Vista } from "../pixi/kit/tipos";
import { LLEGADA_ANTES, cajaFinal2D, grupoFinal2D, zoomDeCaja, zoomFinal2D, type Puesto } from "./carrera-camara";
import { pantallaDe, puestosDe } from "./carrera-camara-prueba";
import { LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO, LLAMA_LARGO, carrilesDe, hudDe, type Pantalla } from "./carrera-forma";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera, type Datos } from "./carrera-show";

/**
 * El final del 2D, sin navegador: desde tres segundos antes de la meta hasta el golpe, quien gana tiene que quedar entera dentro del cuadro. Se
 * arma la ronda con `planCarrera`, se ponen las finalistas donde las pone `posicion` (`puestosDe`) y se corre, a 60 cuadros por segundo, lo
 * que hace la escena con el director: la caja de `cajasDelFrente` (`cajaFinal2D` sobre el grupo de `grupoFinal2D` desde el corte), con el margen
 * de `planoSobre`, la guarda de `meta()`, el suavizado de la cámara (ritmo 3) y, encima, el empuje de la tensión.
 *
 * Lo que se aproxima, siempre hacia el lado que corta más: el empuje se toma entero en todo el tramo y con la respiración arriba; antes del
 * corte la caja mira a las tres de adelante y la columna de la meta, sin las que están en apuros (que solo agrandan el plano); el nombre a la
 * izquierda del celular se mide como uno de ocho letras.
 *
 * Con la misma corrida se mira también la señal de cámara del auditor de delatores (`senalCamara` en `scripts/lib/delatores-senales.mjs`,
 * la regla "ultimo"): qué nombre queda más cerca del centro de la pantalla en el último cuadro antes del golpe.
 *
 * Esa última prueba es un modelo de la geometría, no el auditor con navegador, y tiene tres límites que midió el revisor:
 * (a) vale para 8 personas; con 12 y 18, en ventanas de 1280x720, 1366x768 y 1024x768, el mismo modelo se aparta del azar (por ejemplo 53 de 300
 * con 12, cuando el azar da 39,7) y eso queda como pregunta abierta para quien dirige;
 * (b) corta 0,1 s antes del golpe y no ve el tramo entre el golpe y el cartel, que es donde el auditor con navegador da RECHAZADO, porque ahí la
 * ficha de quien gana ya se escondió a propósito;
 * (c) no modela `resolverFichas`, el deslizamiento ni el recorte en los bordes.
 * La ronda en que quien gana no tiene ficha en pantalla se cuenta, como la cuenta el auditor: no acierta y pesa 1 sobre el número de fichas.
 */

const PANTALLAS: Record<string, Pantalla> = {
  "16:9": pantallaDe(1920, 1080),
  "4:3": pantallaDe(1024, 768),
  "celular parado": pantallaDe(390, 844),
};
const TAMANOS = [8, 18, 30, 60];
const SEMILLAS = Array.from({ length: 52 }, (_, i) => i + 1);
/** El empuje de la tensión del 2D (`carrera-show.ts`), la respiración de `planoSobre` y el ritmo de la cámara en el final. */
const EMPUJE = 0.15;
const RESPIRA = 0.01;
const RITMO = 3;
const FPS = 60;

interface Final {
  /** Lo mínimo que se vio del cuerpo de quien gana, como fracción, entre el corte y el golpe. */
  visible: number;
  /** El primer cuadro en que se cortó, si se cortó. */
  corte: number | null;
  /** El puesto de quien gana en el corte (1 es la primera). */
  puesto: number;
  /**
   * Las fichas de nombre en la pantalla en el último cuadro a 0,1 s del golpe o antes: persona y centro de la ficha, donde la pone `ubicarFicha`
   * sin correrla (arriba de la cabeza o, si el carril no da el alto, a la izquierda del cuerpo, con un nombre de ocho letras). Solo las que
   * tienen el centro adentro de la pantalla, como las cuenta el auditor.
   */
  fichas: { q: number; x: number; y: number }[];
}

const planes = new Map<string, Datos>();
function datosDe(n: number, semilla: number): Datos {
  const clave = `${n}|${semilla}`;
  let d = planes.get(clave);
  if (!d) {
    d = planCarrera(ctxDe(n, semilla)).datos;
    planes.set(clave, d);
  }
  return d;
}

function correrFinal(d: Datos, P: Pantalla): Final {
  const k = P.u;
  const nombrePx = tamanoLetra("nombre", k);
  const carr = carrilesDe(P, d.lanes.length, nombrePx);
  const zona: Zona = { x0: 0, y0: hudDe(P).bajo, x1: P.w, y1: P.bottom };
  const metaX = RECTA * P.w + LLAMA_HOCICO * carr.esc;
  const tF = d.tCrown - LLEGADA_ANTES;
  const tGolpe = d.tCrown + tiemposFoco(d.final.story.arc).golpe;
  const en = (t: number): Puesto[] => puestosDe(d, carr, P, 0, t);
  const de = (ps: readonly Puesto[], q: number): Puesto => ps[d.lanes.indexOf(q)] as Puesto;
  const izq = carr.arriba ? 0 : (nombrePx * 0.6 * 8 * 1.25 + nombrePx) * 1.12;
  // `cuerpoDe` de la escena: el cuerpo y, si se pide, el nombre (arriba en el proyector, a la izquierda en el celular).
  const cuerpo = (p: Puesto, conNombre: boolean): Caja => {
    const h = LLAMA_ALTO * p.esc + (conNombre ? carr.altoNombre : 0);
    const iz = conNombre ? izq : 0;
    return { x: p.x + LLAMA_COLA * p.esc - iz, y: p.y - h, w: LLAMA_LARGO * p.esc + 6 * p.esc + iz, h };
  };
  const columnaMeta: Caja = { x: metaX - 30 * k, y: carr.y0 - 40 * k, w: 60 * k, h: carr.y1 - carr.y0 + 50 * k };
  const metaEntera: Caja = { x: metaX - 100 * k, y: carr.y0 - 130 * k, w: 140 * k, h: carr.y1 - carr.y0 + 150 * k };
  const previas = (t: number): Caja[] => {
    const ps = en(t);
    const orden = P.retrato ? ps : [...ps].sort((a, b) => b.x - a.x).slice(0, 3);
    return [...orden.map((p) => cuerpo(p, true)), columnaMeta];
  };
  const z0 = zoomDeCaja(unir(previas(tF)), zona, 40);
  const psF = en(tF);
  // El grupo sale de las narices en el corte, como en la escena: la prueba no le dice quién gana.
  const grupo = grupoFinal2D(psF.map((p) => ({ q: p.persona, nariz: p.x + LLAMA_HOCICO * p.esc })));
  const puesto = [...psF].sort((a, b) => b.x - a.x).findIndex((p) => p.persona === d.campeona) + 1;
  // Lo que le pide la escena al director en `t` y lo que resuelve él (`resolverToma` y `guardarMeta`).
  const objetivo = (t: number): Vista => {
    let caja: Caja, meta: Caja;
    if (t < tF) {
      caja = unir(previas(t));
      meta = metaEntera;
    } else {
      const ps = en(t);
      caja = cajaFinal2D(grupo.map((q) => cuerpo(de(ps, q), true)), zona, zoomFinal2D(z0, t, tF), 40);
      const cy = grupo.reduce((a, q) => a + de(ps, q).y, 0) / grupo.length;
      meta = { x: metaX - 100 * k, y: cy - 60 * k, w: 140 * k, h: 120 * k };
    }
    const plano = crecer(caja, 40);
    return dentro(meta, zona, centrar(plano, zona, P.w, P.h, cabe(plano, zona)), P.w, P.h);
  };
  const t0 = tF - 2;
  const cam = { ...objetivo(t0) };
  const r: Final = { visible: 1, corte: null, puesto, fichas: [] };
  const paso = 1 - Math.exp(-RITMO / FPS);
  for (let i = Math.ceil(t0 * FPS); i / FPS <= tGolpe; i++) {
    const t = i / FPS;
    const v = objetivo(t);
    cam.x += (v.x - cam.x) * paso;
    cam.y += (v.y - cam.y) * paso;
    cam.z += (v.z * (1 + RESPIRA) - cam.z) * paso;
    if (t < tF) continue;
    const z = cam.z * (1 + EMPUJE);
    if (t <= tGolpe - 0.1) {
      const ancho = izq / 1.12;
      r.fichas = en(t)
        .map((p) => {
          const x = carr.arriba ? p.x + 6 * p.esc : p.x + LLAMA_COLA * p.esc - 4 * k - ancho / 2;
          const y = carr.arriba ? p.y - LLAMA_ALTO * p.esc - 3 * k - carr.altoNombre / 2 : p.y - (LLAMA_ALTO * p.esc) / 3;
          return { q: p.persona, x: P.w / 2 + (x - cam.x) * z, y: P.h / 2 + (y - cam.y) * z };
        })
        .filter((f) => f.x >= 0 && f.x <= P.w && f.y >= 0 && f.y <= P.h);
    }
    const c = cuerpo(de(en(t), d.campeona), false);
    const sx0 = P.w / 2 + (c.x - cam.x) * z, sx1 = sx0 + c.w * z;
    const sy0 = P.h / 2 + (c.y - cam.y) * z, sy1 = sy0 + c.h * z;
    const fx = Math.max(0, Math.min(sx1, P.w) - Math.max(sx0, 0)) / (sx1 - sx0);
    const fy = Math.max(0, Math.min(sy1, P.h) - Math.max(sy0, 0)) / (sy1 - sy0);
    const f = fx * fy;
    if (f < r.visible) r.visible = f;
    if (f < 1 - 1e-9 && r.corte === null) r.corte = t;
  }
  return r;
}

describe("el 2D en los últimos 3 s: quien gana no cruza la meta fuera de cuadro", () => {
  it("el grupo sale del orden en el corte: las cuatro de adelante por la nariz, empates por persona, y nunca más que las que hay", () => {
    expect(grupoFinal2D([{ q: 3, nariz: 10 }, { q: 1, nariz: 50 }, { q: 7, nariz: 30 }, { q: 2, nariz: 30 }, { q: 9, nariz: 5 }])).toEqual([1, 2, 7, 3]);
    expect(grupoFinal2D([{ q: 4, nariz: 1 }, { q: 5, nariz: 2 }])).toEqual([5, 4]);
  });

  for (const [nombre, P] of Object.entries(PANTALLAS)) {
    it(`${nombre}: con 8, 18, 30 y 60 personas, quien gana queda entera en el cuadro desde T-3 hasta el golpe`, () => {
      const cortadas: string[] = [];
      for (const n of TAMANOS) {
        for (const semilla of SEMILLAS) {
          const f = correrFinal(datosDe(n, semilla), P);
          if (f.visible < 1 - 1e-9) cortadas.push(`n=${n} semilla ${semilla}: iba ${f.puesto}.a en el corte, se vio el ${(f.visible * 100).toFixed(0)} % (desde t=${(f.corte as number).toFixed(2)})`);
        }
      }
      expect(cortadas).toEqual([]);
    }, 120_000);
  }
});

/**
 * La probabilidad de `k` aciertos o más (y de `k` o menos) cuando cada ronda acierta por azar con su propia probabilidad: la cuenta exacta de
 * `scripts/lib/delatores.mjs` (`colaArriba`, `colaAbajo`).
 */
function colas(ps: readonly number[], k: number): { arriba: number; abajo: number } {
  const f = new Float64Array(ps.length + 1);
  f[0] = 1;
  ps.forEach((p, n) => {
    for (let j = n + 1; j >= 1; j--) f[j] = (f[j] as number) * (1 - p) + (f[j - 1] as number) * p;
    f[0] = (f[0] as number) * (1 - p);
  });
  let arriba = 0, abajo = 0;
  f.forEach((x, j) => {
    if (j >= k) arriba += x;
    if (j <= k) abajo += x;
  });
  return { arriba: Math.min(1, arriba), abajo: Math.min(1, abajo) };
}

describe("el 2D en los últimos 3 s: el nombre del centro de la pantalla no delata", () => {
  // La ventana del auditor de delatores (1280 por 720) y el proyector; 8 personas, como corre `audit-delatores.mjs race --navegador`.
  const VENTANAS: Record<string, Pantalla> = { "1280x720": pantallaDe(1280, 720), "16:9": pantallaDe(1920, 1080) };
  const RONDAS = Array.from({ length: 300 }, (_, i) => i + 1);
  for (const [nombre, P] of Object.entries(VENTANAS)) {
    it(`${nombre}, 8 personas: a 0,1 s del golpe, quien gana es el nombre del centro tan seguido como daría el azar`, () => {
      // Lo que mide `senalCamara`: el nombre más cercano al centro, si está a menos de 0,22 del lado corto de la pantalla; la apuesta acierta
      // si es el de quien gana, y por azar acertaría 1 de cada tantos nombres como se ven.
      const radio = 0.22 * Math.min(P.w, P.h);
      const azar: number[] = [];
      let aciertos = 0;
      for (const semilla of RONDAS) {
        const d = datosDe(8, semilla);
        const { fichas } = correrFinal(d, P);
        const cerca = fichas.map((f) => ({ q: f.q, dist: Math.hypot(f.x - P.w / 2, f.y - P.h / 2) })).sort((a, b) => a.dist - b.dist)[0];
        if (!cerca || cerca.dist > radio || fichas.length < 2) continue;
        azar.push(1 / fichas.length);
        if (cerca.q === d.campeona) aciertos++;
      }
      expect(azar.length).toBeGreaterThanOrEqual(200);
      // El umbral del auditor (`UMBRAL` en `scripts/lib/delatores.mjs`): delata si se aparta del azar 1,25 veces o más (o la mitad o menos) y
      // la probabilidad de apartarse así por casualidad, en las dos colas y por las dos reglas de la señal, baja de 1 en 100 ("a mirar") o de
      // 1 en 1000 ("delator"). Acá se pide que ni siquiera quede "a mirar".
      const esperado = azar.reduce((a, b) => a + b, 0);
      const veces = aciertos / esperado;
      const { arriba, abajo } = colas(azar, aciertos);
      const p = Math.min(1, 2 * 2 * Math.min(arriba, abajo));
      const grande = veces >= 1.25 || veces <= 0.5;
      expect(grande && p < 0.01, `${aciertos} de ${azar.length} rondas (el azar da ${esperado.toFixed(1)}): ${veces.toFixed(2)} veces el azar, p = ${p.toExponential(1)}`).toBe(false);
    }, 120_000);
  }
});
