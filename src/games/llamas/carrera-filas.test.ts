import { describe, expect, it, vi } from "vitest";
import { unidadDe } from "../pixi/kit/nombres";
import { sembrar } from "../pixi/kit/azar";
import { TAM3D, ZC } from "./carrera-3d-mapa";
import { filaDeRango } from "./carrera-caminata";
import { LLAMA_HOCICO, carrilesDe, formaDe, type Pantalla } from "./carrera-forma";
import { FINALISTAS_POR_FILA, formaDelGrupo, repartirFilas, sePuedePintar, type EntradaFilas } from "./carrera-filas";
import { CARRIL_DURA, CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera } from "./carrera-show";
import { muestrasDelPlan, pesoDelPar, umbralSubfila } from "./carrera-subfilas";
import { crearTrayectorias } from "./carrera-trayectorias";

vi.setConfig({ testTimeout: 600_000 });

/**
 * El reparto puro de las filas del grupo según el carril: ninguna finalista queda con su fila en orden contrario a su carril, como mucho
 * dos finalistas por fila, los cupos son los de siempre, toda fila se puede pintar en dos subfilas (dos que se juntan, a subfilas
 * opuestas), cada fila recibe finalistas en proporción a su cupo cuando el número sorteado recorre su tramo, y la misma entrada da la
 * misma salida, sin `Math.random`.
 */

interface Caso {
  entrada: EntradaFilas;
  semilla: number;
}

/** Un caso al azar, reproducible desde su semilla: G de 2 a 30, filas de 2 a 15, los lugares y los carriles barajados y quiénes se juntan. */
function casoDe(semilla: number): Caso {
  const rng = sembrar(semilla * 7919 + 13);
  const lugares = 2 + Math.floor(rng() * 29);
  const filas = 2 + Math.floor(rng() * 14);
  const carriles = Math.min(lugares, 1 + Math.floor(rng() * 8));
  const puestos = Array.from({ length: lugares }, (_, r) => r);
  for (let i = puestos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [puestos[i], puestos[j]] = [puestos[j] as number, puestos[i] as number];
  }
  const carrilEn: number[] = new Array<number>(lugares).fill(-1);
  puestos.slice(0, carriles).forEach((r, k) => {
    carrilEn[r] = k;
  });
  // Los carriles también van barajados entre los lugares elegidos.
  const conCarril = puestos.slice(0, carriles);
  const valores = conCarril.map((r) => carrilEn[r] as number);
  for (let i = valores.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [valores[i], valores[j]] = [valores[j] as number, valores[i] as number];
  }
  conCarril.forEach((r, k) => {
    carrilEn[r] = valores[k] as number;
  });
  // Quiénes se juntan: como en el grupo, más los lugares cercanos que los lejanos.
  const juntas = new Set<number>();
  const prob = rng() * 0.5;
  for (let a = 0; a < lugares; a++) for (let b = a + 1; b < lugares; b++) if (rng() < prob / (1 + Math.abs(a - b))) juntas.add(a * 64 + b);
  const seJuntan = (a: number, b: number): boolean => juntas.has(Math.min(a, b) * 64 + Math.max(a, b));
  const semillaReparto = Math.floor(rng() * 4294967296);
  return { entrada: { lugares, filas, carriles, carrilEn, seJuntan, rng: sembrar(semillaReparto) }, semilla: semillaReparto };
}

const cuposDe = (G: number, F: number): number[] => {
  const cupo = new Array<number>(F).fill(0);
  for (let r = 0; r < G; r++) cupo[filaDeRango(r, F)] = (cupo[filaDeRango(r, F)] as number) + 1;
  return cupo;
};

/** Si una fila se puede pintar en dos, buscado a la fuerza: todas las maneras de poner arriba o abajo a cada una. */
function pintableAFuerza(lugares: readonly number[], carrilEn: readonly number[], seJuntan: (a: number, b: number) => boolean): boolean {
  const k = lugares.length;
  const fins = lugares.map((r, i) => ({ i, c: carrilEn[r] as number })).filter((x) => x.c >= 0).sort((a, b) => a.c - b.c);
  for (let m = 0; m < 1 << k; m++) {
    const lado = (i: number): number => ((m >> i) & 1 ? -1 : 1);
    if (fins.length >= 2 && (lado((fins[0] as { i: number }).i) !== -1 || lado((fins[fins.length - 1] as { i: number }).i) !== 1)) continue;
    let bien = true;
    for (let a = 0; a < k && bien; a++) for (let b = a + 1; b < k && bien; b++) if (lado(a) === lado(b) && seJuntan(lugares[a] as number, lugares[b] as number)) bien = false;
    if (bien) return true;
  }
  return false;
}

describe("el reparto de las filas según el carril", () => {
  it("en 3000 entradas al azar: el orden de los carriles, dos finalistas por fila como mucho, los cupos de siempre y toda fila se pinta en dos", () => {
    let resueltos = 0;
    for (let s = 1; s <= 3000; s++) {
      const { entrada } = casoDe(s);
      const salida = repartirFilas(entrada);
      if (salida === null) continue;
      resueltos++;
      const G = entrada.lugares;
      const F = entrada.filas;
      expect(salida).toHaveLength(G);
      // Los cupos, iguales a los de siempre.
      const conteo = new Array<number>(F).fill(0);
      for (const f of salida) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(F);
        conteo[f] = (conteo[f] as number) + 1;
      }
      expect(conteo).toEqual(cuposDe(G, F));
      // Ninguna finalista con la fila en orden contrario a su carril.
      for (let a = 0; a < G; a++) {
        for (let b = 0; b < G; b++) {
          const ka = entrada.carrilEn[a] as number;
          const kb = entrada.carrilEn[b] as number;
          if (ka < 0 || kb < 0) continue;
          if (ka < kb) expect(salida[a] as number, `carriles ${ka} y ${kb}, caso ${s}`).toBeLessThanOrEqual(salida[b] as number);
        }
      }
      // Como mucho dos finalistas por fila, y toda fila se pinta en dos (buscado a la fuerza, aparte del módulo).
      for (let f = 0; f < F; f++) {
        const lugares = salida.map((g, r) => (g === f ? r : -1)).filter((r) => r >= 0);
        expect(lugares.filter((r) => (entrada.carrilEn[r] as number) >= 0).length).toBeLessThanOrEqual(FINALISTAS_POR_FILA);
        if (lugares.length <= 14) expect(pintableAFuerza(lugares, entrada.carrilEn, entrada.seJuntan as (a: number, b: number) => boolean), `fila ${f}, caso ${s}`).toBe(true);
      }
    }
    // El reparto existe en buena parte de los casos: si todo diera null, las filas de más no alcanzarían nunca.
    expect(resueltos).toBeGreaterThan(1000);
  });

  it("pintar en dos: contra la búsqueda a la fuerza en 2000 filas sembradas", () => {
    const rng = sembrar(20261112);
    let si = 0, no = 0;
    for (let caso = 0; caso < 2000; caso++) {
      const k = 1 + Math.floor(rng() * 9);
      const lugares = Array.from({ length: k }, (_, i) => i * 3);
      const carrilEn = new Array<number>(30).fill(-1);
      const libres = [0, 1, 2, 3, 4, 5, 6, 7];
      for (const r of lugares) if (rng() < 0.25) carrilEn[r] = libres.splice(Math.floor(rng() * libres.length), 1)[0] as number;
      const juntas = new Set<string>();
      const prob = rng() * 0.6;
      for (const a of lugares) for (const b of lugares) if (a < b && rng() < prob) juntas.add(`${a}-${b}`);
      const seJuntan = (a: number, b: number): boolean => juntas.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
      const fins = lugares.filter((r) => (carrilEn[r] as number) >= 0).length;
      // Con tres finalistas o más en una fila el reparto ya la descarta: acá se compara con dos o menos.
      if (fins > 2) continue;
      const esperado = pintableAFuerza(lugares, carrilEn, seJuntan);
      expect(sePuedePintar(lugares, carrilEn, seJuntan), `caso ${caso}`).toBe(esperado);
      if (esperado) si++;
      else no++;
    }
    expect(si).toBeGreaterThan(200);
    expect(no).toBeGreaterThan(200);
  });

  it("con el número sorteado recorriendo su tramo, cada fila recibe finalistas en proporción a su cupo", () => {
    const G = 24;
    const F = 6;
    const L = 8;
    const carrilEn: number[] = new Array<number>(G).fill(-1);
    for (let k = 0; k < L; k++) carrilEn[k * 3] = k;
    const PASOS = 20_000;
    const recibidas = new Array<number>(F).fill(0);
    for (let s = 0; s < PASOS; s++) {
      const salida = repartirFilas({ lugares: G, filas: F, carriles: L, carrilEn, rng: () => s / PASOS });
      expect(salida).not.toBeNull();
      for (let r = 0; r < G; r++) if (carrilEn[r] !== -1) recibidas[salida?.[r] as number] = (recibidas[salida?.[r] as number] as number) + 1;
    }
    const cupo = cuposDe(G, F);
    for (let f = 0; f < F; f++) {
      expect(Math.abs((recibidas[f] as number) / (PASOS * L) - (cupo[f] as number) / G), `fila ${f}`).toBeLessThanOrEqual(0.005);
    }
  });

  it("la misma entrada da la misma salida, sin Math.random", () => {
    const espia = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random en el reparto");
    });
    try {
      for (let s = 1; s <= 60; s++) {
        const { entrada, semilla } = casoDe(s);
        const a = repartirFilas(entrada);
        const b = repartirFilas({ ...entrada, rng: sembrar(semilla) });
        expect(b).toEqual(a);
      }
    } finally {
      espia.mockRestore();
    }
  });

  it("la fila no distingue a las finalistas: en 3000 entradas, las demás quedan fuera del dibujo de siempre tanto como las finalistas", () => {
    // En el corral el orden se lee (cada una en su lugar del peine) y el dibujo de siempre es `filaDeRango`. Si las demás lo prefirieran, la
    // que queda fuera de él sería una finalista o una desplazada por una finalista, desde antes de la salida.
    for (const conJuntas of [false, true]) {
      let fin = 0, finFuera = 0, otras = 0, otrasFuera = 0;
      for (let s = 1; s <= 3000; s++) {
        const { entrada } = casoDe(s);
        const salida = repartirFilas(conJuntas ? entrada : { ...entrada, seJuntan: undefined });
        if (salida === null) continue;
        for (let r = 0; r < entrada.lugares; r++) {
          const fuera = salida[r] !== filaDeRango(r, entrada.filas);
          if ((entrada.carrilEn[r] as number) >= 0) {
            fin++;
            if (fuera) finFuera++;
          } else {
            otras++;
            if (fuera) otrasFuera++;
          }
        }
      }
      expect(fin).toBeGreaterThan(3000);
      const dif = Math.abs(finFuera / fin - otrasFuera / otras);
      expect(dif, `${conJuntas ? "con" : "sin"} las que se juntan: finalistas fuera ${finFuera} de ${fin}, las demás ${otrasFuera} de ${otras}`).toBeLessThan(0.02);
    }
  });

  it("casos armados a mano: tres finalistas en una fila no entran, y tres que se juntan de a pares tampoco", () => {
    // Ocho finalistas en dos filas: cuatro por fila.
    const carrilEn = Array.from({ length: 8 }, (_, r) => r);
    expect(repartirFilas({ lugares: 8, filas: 2, carriles: 8, carrilEn, rng: () => 0 })).toBeNull();
    // Una sola fila con tres que se juntan de a pares: no se pinta en dos.
    const todas = (): boolean => true;
    expect(repartirFilas({ lugares: 3, filas: 1, carriles: 1, carrilEn: [0, -1, -1], seJuntan: todas, rng: () => 0 })).toBeNull();
    // Con dos filas, sí: dos que se juntan en una fila (una arriba y otra abajo) y la tercera en la otra.
    expect(repartirFilas({ lugares: 4, filas: 2, carriles: 1, carrilEn: [0, -1, -1, -1], seJuntan: todas, rng: () => 0 })).not.toBeNull();
  });
});

describe("el grupo con las filas según el carril", () => {
  const pantalla = (w: number, h: number): Pantalla => ({ w, h, u: unidadDe(w, h), retrato: h > w * 1.1, top: Math.round(0.06 * h), bottom: Math.round(h - Math.max(110, 0.14 * h)) });
  const PANTALLAS: [string, Pantalla][] = [["1366x768", pantalla(1366, 768)], ["1920x1080", pantalla(1920, 1080)], ["390x844", pantalla(390, 844)], ["844x390", pantalla(844, 390)]];

  it("toda fila se pinta en dos con las filas de la escena, y al pasar a los carriles ninguna finalista cambia de lado ni toca a otra", () => {
    const fallas: string[] = [];
    const deMas = new Map<number, Map<number, number>>();
    let sinPintar = 0;
    for (const n of [2, 3, 8, 10, 14, 18, 24, 30, 60, 200]) {
      for (let s = 1; s <= 40; s++) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const m = muestrasDelPlan(d);
        for (const [nombreP, P] of PANTALLAS) {
          const nombrePx = 16 * P.u;
          const nombreW = 110 * P.u;
          const cuerpo = CUERPO * ENSANCHE * RECTA * P.w;
          const grupo = formaDelGrupo({ P, d, nombrePx, nombreW, cuerpoPx: cuerpo });
          const base = formaDe(P, Math.max(1, d.gente.length), nombrePx, nombreW);
          const diff = grupo.forma.filas - base.filas;
          const porN = deMas.get(n) ?? new Map<number, number>();
          porN.set(diff, (porN.get(diff) ?? 0) + 1);
          deMas.set(n, porN);
          const forma = grupo.forma;
          // Toda fila se pinta en dos con quiénes se juntan en el plan, medido aparte del reparto.
          const umbral = umbralSubfila(forma.esc, cuerpo);
          const personaEn = new Map(d.gente.map((p) => [d.orden.rango(p), p] as const));
          const carrilEn = new Array<number>(d.gente.length).fill(-1);
          for (const p of d.gente) carrilEn[d.orden.rango(p)] = d.lanes.indexOf(p);
          const seJuntan = (a: number, b: number): boolean => pesoDelPar(m, personaEn.get(a) as number, personaEn.get(b) as number, umbral) > 0;
          for (let f = 0; f < forma.filas; f++) {
            const lugares = grupo.filaDeLugar.map((g, r) => (g === f ? r : -1)).filter((r) => r >= 0);
            if (!sePuedePintar(lugares, carrilEn, seJuntan)) sinPintar++;
          }
          const F0 = -(60 * P.u + LLAMA_HOCICO * forma.esc);
          const tr = crearTrayectorias(d, { F0, Xs: F0 + d.distAbre * P.w, ancho: P.w, cuerpo, forma, carr: carrilesDe(P, d.lanes.length, nombrePx), caminata: null, filaDeLugar: grupo.filaDeLugar });
          // El orden de lado de cada par de finalistas (por carril) en cada muestra, de `tCarriles` a `tCarriles + CARRIL_DURA` a 60 por segundo.
          const signos = new Map<string, number>();
          const pasos = Math.round(CARRIL_DURA * 60);
          for (let i = 0; i <= pasos; i++) {
            const t = d.tCarriles + i / 60;
            const pos = d.lanes.map((p) => tr.posicion(p, t));
            for (let a = 0; a < pos.length; a++) {
              for (let b = a + 1; b < pos.length; b++) {
                const pa = pos[a] as (typeof pos)[number];
                const pb = pos[b] as (typeof pos)[number];
                const dy = pb.y - pa.y;
                if (dy !== 0) {
                  const clave = `${a}-${b}`;
                  const signo = Math.sign(dy);
                  const previo = signos.get(clave);
                  if (previo !== undefined && previo !== signo && fallas.length < 40) fallas.push(`${nombreP} n=${n} s=${s} t=${t.toFixed(2)}: los carriles ${a} y ${b} cambian de lado`);
                  signos.set(clave, signo);
                }
                // Ninguna toca a otra: las dos huellas del 3D, encimadas menos del 10 % del cuerpo más chico.
                const ca = { x0: pa.x - 36 * pa.esc * TAM3D, x1: pa.x + 38 * pa.esc * TAM3D, y0: pa.y - (13 * pa.esc * TAM3D) / ZC, y1: pa.y + (13 * pa.esc * TAM3D) / ZC };
                const cb = { x0: pb.x - 36 * pb.esc * TAM3D, x1: pb.x + 38 * pb.esc * TAM3D, y0: pb.y - (13 * pb.esc * TAM3D) / ZC, y1: pb.y + (13 * pb.esc * TAM3D) / ZC };
                const comun = Math.max(0, Math.min(ca.x1, cb.x1) - Math.max(ca.x0, cb.x0)) * Math.max(0, Math.min(ca.y1, cb.y1) - Math.max(ca.y0, cb.y0));
                const menor = Math.min((ca.x1 - ca.x0) * (ca.y1 - ca.y0), (cb.x1 - cb.x0) * (cb.y1 - cb.y0));
                if (comun / menor > 0.1 && fallas.length < 40) fallas.push(`${nombreP} n=${n} s=${s} t=${t.toFixed(2)}: los carriles ${a} y ${b} se enciman un ${((comun / menor) * 100).toFixed(0)} %`);
              }
            }
          }
        }
      }
    }
    for (const [n, porN] of deMas) {
      const partes = [...porN.entries()].sort((a, b) => a[0] - b[0]).map(([diff, veces]) => `${diff >= 0 ? "+" : ""}${diff} en ${veces}`).join(", ");
      console.log(`filas de más (F' - F) con ${n} personas: ${partes}`);
    }
    console.log(`filas que no se pintan en dos (el último intento): ${sinPintar}`);
    expect(fallas, fallas.slice(0, 10).join("\n")).toEqual([]);
    expect(sinPintar).toBe(0);
  });
});
