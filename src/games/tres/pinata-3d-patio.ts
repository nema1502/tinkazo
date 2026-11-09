import {
  BoxGeometry, Color, DoubleSide, IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry,
  RepeatWrapping,
} from "three";
import { hash } from "./ids";
import { coloresPicos, hex, textura, type Ctx } from "./pinata-3d-piezas";
import type { EntradaPinata } from "./pinata-3d-tipos";

/**
 * El patio de la fiesta, de la pared al piso: la pared lisa, el piso de baldosas que se va hacia la cámara, tres
 * guirnaldas de papel picado con la flor calada que se mecen apenas, y de noche una hilera de foquitos tibios. Es lo que
 * el 2D dibujaba en `wall`, `garland` y el fondo.
 *
 * Todo en píxeles del dibujo del 2D (el escenario se escala una vez). Las banderitas y los foquitos son una sola malla
 * cada una: las llamadas de dibujo no crecen con nada.
 */

const GRANDE = 60000;
const BANDERINES = 22;
const FILAS = 3;
const TRAMOS = 24;
const FOQUITOS = 14;

export interface Patio {
  /** La pared queda atrás de la piñata: a cuántos radios, para que las guirnaldas entren en el medio. */
  actualizar(e: EntradaPinata): void;
}

export function crearPatio(c: Ctx): Patio {
  const { B, tema, escenario, mat } = c;
  const oscuro = tema === "oscuro";
  // Los colores del 2D (`build`): la pared del fondo y las baldosas.
  const colorPared = oscuro ? 0x2a1d33 : 0xf7d9b5;
  const colorBaldosa = oscuro ? 0x3b2630 : 0xe9ab86;
  const colorZocalo = oscuro ? 0x1e1527 : 0xe7b98e;

  const plano = B.add(new PlaneGeometry(1, 1));
  const suelo = B.add(new PlaneGeometry(1, 1));
  suelo.rotateX(-Math.PI / 2);

  const pared = new Mesh(plano, B.add(new MeshLambertMaterial({ color: colorPared, depthWrite: false })));
  pared.scale.set(GRANDE, 24000, 1);
  const zocalo = new Mesh(plano, B.add(new MeshLambertMaterial({ color: colorZocalo, depthWrite: false })));
  // La pared y el piso se pintan de fondo y no escriben profundidad: el chico, que en el 2D pisa las baldosas por debajo de
  // la línea del piso, no queda hundido en ellas.
  pared.renderOrder = -5;
  zocalo.renderOrder = -4;
  escenario.add(pared, zocalo);

  // El piso: una baldosa de 2 por 2 que se repite, con la juntura oscura del 2D.
  const baldosas = textura(c, 256, 256, (cx) => {
    cx.fillStyle = hex(colorBaldosa);
    cx.fillRect(0, 0, 256, 256);
    const sombra = [0.0, 0.05, 0.03, 0.08];
    for (let i = 0; i < 4; i++) {
      cx.fillStyle = `rgba(0,0,0,${sombra[i]})`;
      cx.fillRect((i % 2) * 128, Math.floor(i / 2) * 128, 128, 128);
    }
    cx.fillStyle = "rgba(0,0,0,0.20)";
    cx.fillRect(0, 0, 256, 3);
    cx.fillRect(0, 0, 3, 256);
    cx.fillRect(0, 125, 256, 3);
    cx.fillRect(125, 0, 3, 256);
  });
  if (baldosas) {
    baldosas.wrapS = baldosas.wrapT = RepeatWrapping;
    baldosas.anisotropy = Math.min(4, c.motor.renderer.capabilities.getMaxAnisotropy());
  }
  const piso = new Mesh(suelo, B.add(new MeshLambertMaterial({ color: baldosas ? 0xffffff : colorBaldosa, map: baldosas, depthWrite: false })));
  piso.renderOrder = -4;
  escenario.add(piso);

  // Las guirnaldas: banderitas de papel picado en una sola malla, con la flor calada.
  const flor = textura(c, 64, 80, (cx) => {
    cx.fillStyle = "#fff";
    cx.beginPath();
    cx.moveTo(2, 2);
    cx.lineTo(62, 2);
    cx.lineTo(62, 78);
    cx.lineTo(47, 68);
    cx.lineTo(32, 78);
    cx.lineTo(17, 68);
    cx.lineTo(2, 78);
    cx.closePath();
    cx.fill();
    cx.globalCompositeOperation = "destination-out";
    for (const [dx, dy] of [[0, -9], [9, 0], [0, 9], [-9, 0]] as const) {
      cx.beginPath();
      cx.arc(32 + dx, 38 + dy, 6.5, 0, Math.PI * 2);
      cx.fill();
    }
    for (const dx of [-17, 17]) {
      cx.beginPath();
      cx.arc(32 + dx, 62, 4.5, 0, Math.PI * 2);
      cx.fill();
    }
  });
  const geoBandera = B.add(new PlaneGeometry(1, 1));
  geoBandera.translate(0, -0.5, 0);
  const banderas = new InstancedMesh(
    geoBandera,
    B.add(new MeshBasicMaterial({ map: flor, alphaTest: 0.5, side: DoubleSide, transparent: false })),
    BANDERINES * FILAS,
  );
  banderas.frustumCulled = false;
  B.add({ dispose: () => banderas.dispose() });
  const picos = coloresPicos(tema);
  const col = new Color();
  for (let r = 0; r < FILAS; r++) for (let i = 0; i < BANDERINES; i++) banderas.setColorAt(r * BANDERINES + i, col.setHex(picos[(i + r * 2) % 7] as number));
  if (banderas.instanceColor) banderas.instanceColor.needsUpdate = true;
  // El hilo de cada guirnaldas: tramos de caja finos.
  const hilos = new InstancedMesh(B.add(new BoxGeometry(1, 1, 1)), c.tinta, FILAS * TRAMOS);
  hilos.frustumCulled = false;
  B.add({ dispose: () => hilos.dispose() });
  escenario.add(banderas, hilos);

  // Los foquitos de la noche: esferas facetadas con un emisivo bajo, que iluminan sin brillar.
  const foquitos = oscuro
    ? new InstancedMesh(
      B.add(new IcosahedronGeometry(1, 0)),
      B.add(new MeshLambertMaterial({ color: 0xffd9a0, emissive: 0xffb870, emissiveIntensity: 0.45, flatShading: true })),
      FOQUITOS,
    )
    : null;
  if (foquitos) {
    foquitos.frustumCulled = false;
    B.add({ dispose: () => foquitos.dispose() });
    escenario.add(foquitos);
  }
  void mat;

  const d = new Object3D();
  let clave = "";
  // Dónde cuelga cada banderita (arriba, centro) y su vaivén propio.
  const fijas: { x: number; y: number; z: number; fase: number; fw: number; fh: number }[] = [];

  return {
    actualizar(e) {
      const m = e.mundo;
      const R = m.R, k = m.k;
      const zPared = -3.2 * R;
      // Cada dato del patio: si cambia el tamaño de la pantalla, se rearma.
      const nueva = `${e.w}|${e.h}|${k}|${R}|${m.top}|${m.restY}|${m.piso}`;
      pared.position.set(e.w / 2, 12000 - 3000, zPared);
      zocalo.scale.set(GRANDE, 70 * k, 1);
      zocalo.position.set(e.w / 2, 35 * k, zPared + 1);
      const fondo = 6000;
      piso.scale.set(GRANDE, 1, fondo - zPared);
      piso.position.set(e.w / 2, 0, (fondo + zPared) / 2);
      if (baldosas) baldosas.repeat.set(GRANDE / (96 * k), (fondo - zPared) / (96 * k));

      if (nueva !== clave) {
        clave = nueva;
        fijas.length = 0;
        // Las tres guirnaldas de arriba de la piñata, como en el 2D, pero más anchas: con perspectiva la cámara ve de más.
        const arriba = Math.max(m.top + 8 * k, m.restY - 1.75 * R - 150 * k);
        let h = 0;
        for (let fila = 0; fila < FILAS; fila++) {
          const y0 = arriba + fila * 38 * k;
          const sag = (26 + fila * 8) * k;
          const z = -(1.1 + 0.18 * fila) * R;
          const x0 = -0.35 * e.w, ancho = 1.7 * e.w;
          for (let i = 0; i < BANDERINES; i++) {
            const f = (i + 0.5) / BANDERINES;
            fijas.push({
              x: x0 + f * ancho,
              y: m.piso - (y0 + Math.sin(f * Math.PI) * sag),
              z,
              fase: hash(i, fila + 40) * 6.28,
              fw: 34 * k,
              fh: 36 * k * 1.12,
            });
          }
          for (let t = 0; t < TRAMOS; t++) {
            const fa = t / TRAMOS, fb = (t + 1) / TRAMOS;
            const ax = x0 + fa * ancho, bx = x0 + fb * ancho;
            const ay = m.piso - (y0 + Math.sin(fa * Math.PI) * sag), by = m.piso - (y0 + Math.sin(fb * Math.PI) * sag);
            d.position.set((ax + bx) / 2, (ay + by) / 2, z);
            d.rotation.set(0, 0, Math.atan2(by - ay, bx - ax));
            d.scale.set(Math.hypot(bx - ax, by - ay) + 1, 2 * k, 2 * k);
            d.updateMatrix();
            hilos.setMatrixAt(h++, d.matrix);
          }
        }
        hilos.instanceMatrix.needsUpdate = true;
        if (foquitos) {
          for (let i = 0; i < FOQUITOS; i++) {
            const f = (i + 0.5) / FOQUITOS;
            d.position.set(-0.3 * e.w + f * 1.6 * e.w, m.piso - (arriba + 4 * k + Math.sin(f * Math.PI * 3) * 6 * k), zPared + 8 * k);
            d.rotation.set(0, 0, 0);
            d.scale.setScalar(6.5 * k);
            d.updateMatrix();
            foquitos.setMatrixAt(i, d.matrix);
          }
          foquitos.instanceMatrix.needsUpdate = true;
        }
      }
      // El vaivén suave del papel, función de la hora del juego.
      for (let i = 0; i < fijas.length; i++) {
        const b = fijas[i]!;
        d.position.set(b.x, b.y, b.z);
        d.rotation.set(Math.sin(e.t * 1.1 + b.fase) * 0.16, Math.sin(e.t * 0.7 + b.fase * 1.7) * 0.1, 0);
        d.scale.set(b.fw, b.fh, 1);
        d.updateMatrix();
        banderas.setMatrixAt(i, d.matrix);
      }
      banderas.count = fijas.length;
      banderas.instanceMatrix.needsUpdate = true;
    },
  };
}
