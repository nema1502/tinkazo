import type { EntradaChovena } from "./chovena-3d-tipos";
import type { Pantalla3D } from "./tipos";

/**
 * Lo que mide el 3D de la chovena de sí mismo cuando se abre con `?auditar=3d`: las cinco comprobaciones del brief que
 * solo se ven con el juego corriendo. Queda en `window.__tres.extra`. Cuesta cero sin la bandera (no se crea).
 *
 * 1. Manos: cuántos eslabones pidió el 2D y cuántos se hicieron (las dos manos de un eslabón hecho caen en el mismo punto).
 * 2. Estatua: desde el cuadro del corte hasta el fin de `FREEZE`, cuánto se corre el más movido, en alturas de bailarín.
 * 3. Cartel: el máximo de cabezas debajo del cartel «¡QUIETOS!» en un cuadro.
 * 4. Pareja: desde que se suelta la rival hasta el golpe, si las dos quedan enteras en la pantalla y cuánto las separa.
 */

export interface DatosAuditoria {
  n: number;
  /** Cabeza y pies de cada uno, en el mundo 3D (`3 * n`), y si se dibujó. */
  cabeza: Float32Array;
  pie: Float32Array;
  visto: Uint8Array;
  /** Unidades 3D por bailarín. */
  D: number;
}

/** Lo que dura quedarse quieto en el 2D (`FREEZE`). */
const FREEZE = 0.22;

export interface Medidas {
  pedidos: number;
  hechos: number;
  eslabonesPedidos: number;
  eslabonesHechos: number;
  cuadros: number;
  cortes: number;
  movimientoCongelado: number;
  /** Quién y cuándo (la hora del juego) fue el que más se movió en la estatua. */
  movimientoQuien: number;
  movimientoCuando: number;
  cuadrosConCartel: number;
  /** Cuántos cuadros con cartel tuvieron al menos una cabeza debajo, y de quién (la primera). */
  cuadrosConCabezaBajo: number;
  cabezasBajoCartel: number;
  cartelQuien: number;
  /** La hora del juego del peor cuadro del cartel y de la primera vez que la pareja salió de cuadro. */
  cartelCuando: number;
  parejaFueraCuando: number;
  cuadrosPareja: number;
  parejaFueraDeCuadro: number;
  parejaSeparacionMin: number;
}

export function crearMedidas(): Medidas {
  return {
    pedidos: 0, hechos: 0, eslabonesPedidos: 0, eslabonesHechos: 0, cuadros: 0,
    cortes: 0, movimientoCongelado: 0, movimientoQuien: -1, movimientoCuando: -1,
    cuadrosConCartel: 0, cuadrosConCabezaBajo: 0, cartelQuien: -1, cabezasBajoCartel: 0, cartelCuando: -1, parejaFueraCuando: -1,
    cuadrosPareja: 0, parejaFueraDeCuadro: 0, parejaSeparacionMin: 99,
  };
}

export function medidor(m: Medidas): (e: EntradaChovena, hechos: number, d: DatosAuditoria, pantallaDe: (id: number) => Pantalla3D | null) => void {
  let quietoAntes = false;
  let tCorte = -1;
  let foto: Float32Array | null = null;
  return (e, hechos, d, pantallaDe) => {
    m.cuadros++;
    m.pedidos = e.eslabones.length / 2;
    m.hechos = hechos;
    m.eslabonesPedidos += m.pedidos;
    m.eslabonesHechos += hechos;

    // 2. Estatua.
    if (e.quieto && !quietoAntes) {
      tCorte = e.t;
      m.cortes++;
      foto = new Float32Array(6 * d.n);
      foto.set(d.cabeza.subarray(0, 3 * d.n), 0);
      foto.set(d.pie.subarray(0, 3 * d.n), 3 * d.n);
    }
    if (!e.quieto) foto = null;
    quietoAntes = e.quieto;
    if (foto && e.t - tCorte <= FREEZE) {
      let peor = 0, quien = -1;
      for (let i = 0; i < d.n; i++) {
        // Quien trastabilla se mueve a propósito: empieza justo al terminar `FREEZE`.
        if (!d.visto[i] || e.bailarines[i]?.alerta) continue;
        for (let k = 0; k < 3; k++) {
          const v = Math.max(Math.abs((d.cabeza[3 * i + k] as number) - (foto[3 * i + k] as number)), Math.abs((d.pie[3 * i + k] as number) - (foto[3 * d.n + 3 * i + k] as number)));
          if (v > peor) {
            peor = v;
            quien = i;
          }
        }
      }
      if (peor / d.D > m.movimientoCongelado) {
        m.movimientoCongelado = peor / d.D;
        m.movimientoQuien = quien;
        m.movimientoCuando = e.t;
      }
    }

    // 3. El cartel no tapa ninguna cabeza.
    if (e.cartel) {
      m.cuadrosConCartel++;
      const c = e.cartel;
      let bajo = 0, primero = -1;
      for (let i = 0; i < d.n; i++) {
        if (!d.visto[i]) continue;
        const p = pantallaDe(i);
        if (!p) continue;
        const cy = p.y + 0.19 * p.alto;
        if (p.x >= c.x && p.x <= c.x + c.w && cy >= c.y && cy <= c.y + c.h) {
          bajo++;
          if (primero < 0) primero = i;
        }
      }
      if (bajo > 0) m.cuadrosConCabezaBajo++;
      if (bajo > m.cabezasBajoCartel) {
        m.cabezasBajoCartel = bajo;
        m.cartelCuando = e.t;
        m.cartelQuien = primero;
      }
    }

    // 4. La pareja de la final, desde que se suelta la rival hasta el golpe.
    const ganadora = e.bailarines.find((b) => b.pareja >= 0 && b.visible);
    if (ganadora && e.golpe < 0.3) {
      const rival = e.bailarines[ganadora.pareja];
      if (rival && rival.tinte !== 0) {
        m.cuadrosPareja++;
        const a = pantallaDe(ganadora.id), b = pantallaDe(rival.id);
        if (!a || !b) {
          m.parejaFueraDeCuadro++;
          if (m.parejaFueraCuando < 0) m.parejaFueraCuando = e.t;
        } else {
          const dentro = (p: Pantalla3D): boolean => p.x >= 0 && p.x <= e.w && p.y >= 0 && p.y + p.alto <= e.h;
          if (!dentro(a) || !dentro(b)) {
            m.parejaFueraDeCuadro++;
            if (m.parejaFueraCuando < 0) m.parejaFueraCuando = e.t;
          }
          m.parejaSeparacionMin = Math.min(m.parejaSeparacionMin, Math.abs(a.x - b.x) / Math.max(a.alto, b.alto));
        }
      }
    }
  };
}
