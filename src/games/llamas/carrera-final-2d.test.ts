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
  const r: Final = { visible: 1, corte: null, puesto };
  const paso = 1 - Math.exp(-RITMO / FPS);
  for (let i = Math.ceil(t0 * FPS); i / FPS <= tGolpe; i++) {
    const t = i / FPS;
    const v = objetivo(t);
    cam.x += (v.x - cam.x) * paso;
    cam.y += (v.y - cam.y) * paso;
    cam.z += (v.z * (1 + RESPIRA) - cam.z) * paso;
    if (t < tF) continue;
    const z = cam.z * (1 + EMPUJE);
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
