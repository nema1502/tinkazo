import {
  BackSide, CircleGeometry, Color, Group, HemisphereLight, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, RingGeometry,
  type Fog,
} from "three";
import { perfilFiel } from "./camara";
import { crearAmbiente, SombrasDeContacto } from "./escena";
import { Materiales } from "./figuras";
import { definir3D } from "./motor";
import { crearChico } from "./pinata-3d-chico";
import { Proyector, azimutDe, clamp, elevacionDe, escala, poseFrontal, suave, ELEVACION } from "./pinata-3d-mapa";
import { crearPatio } from "./pinata-3d-patio";
import { crearPina, crearRotura } from "./pinata-3d-pina";
import { INK, contorno, geometriaCaramelo, type Ctx } from "./pinata-3d-piezas";
import type { EntradaPinata } from "./pinata-3d-tipos";
import type { Fabrica3D, Lanzador } from "./tipos";
import { hash } from "./ids";

export type { EntradaPinata } from "./pinata-3d-tipos";

/**
 * La piñata en 3D, con three.js. Detrás de `?motor=3d`.
 *
 * No decide ni calcula nada del sorteo: dibuja lo que `pixi/pinata.ts` ya puso, cuadro a cuadro. El estadio de PixiJS
 * queda encima, transparente, con el relator, el cartel, el foco, las listas, el contador, las caras de los caramelos y
 * las fichas de nombre. El 3D no sabe quién gana: la ganadora es un caramelo más hasta que el 2D la dibuja grande,
 * después de la rotura.
 *
 * Sin azar: lo que se mueve es función de la hora del juego y de lo que dice el 2D, y lo que parece azar sale de `hash`.
 */

const PERFIL = perfilFiel(ELEVACION);

/** Cuánto se mueven en profundidad los caramelos del montón, en caramelos: el montón se ve como un montón y no como una fila. */
const PROFUNDIDAD = 0.9;

/** La luz del mundo: baja al 35 % en un cuarto de segundo con el golpe y vuelve al 60 % mientras se sostiene el cartel. */
export const luzDeCorona = (corona: number): number => (corona < 0 ? 1 : 1 - 0.65 * suave(corona, 0, 0.25) + 0.25 * suave(corona, 0.6, 2.2));

type V3 = [number, number, number];

const fabrica: Fabrica3D<EntradaPinata> = (motor, o) => {
  const B = motor.basura;
  const tema = motor.tema;
  const oscuro = tema === "oscuro";
  const amb = crearAmbiente(motor, oscuro
    ? { solDesde: [-70, 35, 90], nieblaCerca: 60, nieblaLejos: 200 }
    : { solDesde: [-55, 85, 75], nieblaCerca: 60, nieblaLejos: 200 });
  amb.sol.castShadow = false;
  const hemi = motor.escena.children.find((x): x is HemisphereLight => (x as HemisphereLight).isHemisphereLight === true);

  const escenario = new Group();
  motor.escena.add(escenario);
  const c: Ctx = {
    motor, B, tema, mat: new Materiales(B), escenario,
    tinta: B.add(new MeshBasicMaterial({ color: INK[tema], side: BackSide })),
    inkHex: INK[tema],
  };

  const patio = crearPatio(c);
  const pina = crearPina(c);
  const rotura = crearRotura(c);
  const chico = crearChico(c);

  // El caramelo: un solo dibujo para los de afuera (instanciado) y para la ganadora y el que se asoma (aparte).
  const geoCar = geometriaCaramelo(B);
  let cuerpos: InstancedMesh | null = null;
  let contornos: InstancedMesh | null = null;
  let visto = new Uint8Array(0);
  const col = new Color();
  const matGanadora = B.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 }));
  const ganadora = new Mesh(geoCar, matGanadora);
  contorno(c, ganadora, 1.1);
  const matAsoma = B.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
  const asoma = new Mesh(geoCar, matAsoma);
  contorno(c, asoma, 1.1);
  ganadora.visible = asoma.visible = false;
  escenario.add(ganadora, asoma);

  // El aro de luz en el piso, donde va a caer la ganadora: nace con el brillo del 2D, nunca antes de la rotura.
  const aro = new Group();
  const aroMat = B.add(new MeshBasicMaterial({ color: 0xffc629, transparent: true, opacity: 0.6, depthWrite: false }));
  const aroDisco = B.add(new MeshBasicMaterial({ color: 0xffc629, transparent: true, opacity: 0.16, depthWrite: false }));
  const geoAro = B.add(new RingGeometry(0.72, 1, 40));
  geoAro.rotateX(-Math.PI / 2);
  const geoDisco = B.add(new CircleGeometry(0.72, 32));
  geoDisco.rotateX(-Math.PI / 2);
  aro.add(new Mesh(geoAro, aroMat), new Mesh(geoDisco, aroDisco));
  aro.visible = false;
  aro.renderOrder = 2;
  escenario.add(aro);

  const sombras = new SombrasDeContacto(motor, 512, 0.3);
  escenario.add(sombras.malla);

  const proy = new Proyector();
  const W: V3 = [0, 0, 0];
  const W0: V3 = [0, 0, 0];
  const L: V3 = [0, 0, 0];
  const d = new Object3D();
  let yGlobal = 0;
  let sEsc = 1;
  let comp = 1;

  /** Un punto del 2D en el escenario (píxeles) en el plano de profundidad `zpx`; deja en `comp` cuánto achicar una figura puesta ahí. */
  const lugar = (x: number, y: number, zpx: number, fuera: V3 = L): V3 => {
    proy.plano(x, y, zpx * sEsc, W);
    fuera[0] = W[0] / sEsc;
    fuera[1] = (W[1] - yGlobal) / sEsc;
    fuera[2] = zpx;
    if (zpx === 0) comp = 1;
    else {
      proy.plano(x, y, 0, W0);
      comp = proy.profundidad(W) / Math.max(1e-6, proy.profundidad(W0));
    }
    return fuera;
  };

  const prepararCaramelos = (n: number): void => {
    const cap = Math.max(8, n);
    cuerpos = new InstancedMesh(geoCar, B.add(new MeshLambertMaterial({ flatShading: true })), cap);
    contornos = new InstancedMesh(geoCar, c.tinta, cap);
    for (const m of [cuerpos, contornos]) {
      m.count = 0;
      m.frustumCulled = false;
      B.add({ dispose: () => m.dispose() });
      escenario.add(m);
    }
    visto = new Uint8Array(cap);
  };

  return {
    frame(e) {
      motor.cuadro(e, PERFIL, (_mapa, pose) => {
        const m = e.mundo;
        sEsc = escala(e.u);
        // La cámara de frente y apenas desde arriba: mira lo que mira el director del 2D, a la distancia en que el plano de la piñata se ve del mismo alto.
        const p = poseFrontal(e.cam, e.w, e.h, e.u, m.piso, elevacionDe(e.cam.zoom, e.rotura, e.corona), azimutDe(e.t));
        pose.pos = p.pos;
        pose.mira = p.mira;
        pose.fov = p.fov;
        pose.giro = p.giro;
        proy.fijar(pose, e.cam, e.w, e.h);
        // El piso del 2D es el piso del 3D: la altura donde cae, en el plano de la piñata, la línea del suelo.
        proy.plano(e.cam.x, m.piso, 0, W);
        yGlobal = W[1];
        escenario.position.set(0, yGlobal, 0);
        escenario.scale.setScalar(sEsc);
        const fog = motor.escena.fog as Fog | null;
        if (fog) {
          const dist = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[1] - pose.mira[1], pose.pos[2] - pose.mira[2]);
          fog.near = dist * 1.5;
          fog.far = dist * 5;
        }

        // La luz del mundo baja con el golpe de la ganadora y vuelve de a poco.
        const f = luzDeCorona(e.corona);
        amb.sol.intensity = amb.paleta.luzSolFuerza * f;
        if (hemi) hemi.intensity = amb.paleta.hemiFuerza * f;

        patio.actualizar(e);

        // La piñata, su cuerda y la rotura.
        const oll = lugar(e.olla.x, e.olla.y, 0, [0, 0, 0]);
        const gancho = lugar(e.cuerda.x, e.cuerda.y, 0, [0, 0, 0]);
        pina.poner({
          ver: e.olla.ver, x: oll[0], y: oll[1], z: oll[2], R: m.R, escX: e.olla.escX, escY: e.olla.escY, rot: e.olla.rot,
          grietas: e.olla.grietas, t: e.t, cx: gancho[0], cy: gancho[1], cz: gancho[2], k: m.k, comp: 1,
        });
        rotura.poner({ edad: e.rotura, ox: oll[0], oy: oll[1], oz: oll[2], R: m.R, k: m.k, rot: e.olla.rot, particulas: motor.ajustes.particulas });

        // El chico, en el mismo plano que la piñata: así el palo toca la olla de verdad. Sus pies caen debajo de la línea
        // del piso, sobre las baldosas, como en el 2D (el piso y la pared se pintan de fondo y no tapan nada).
        const ki = lugar(e.chico.x, m.ky, 0, [0, 0, 0]);
        const kx = ki[0], kz = ki[2];
        chico.poner({
          x: kx, y: ki[1], z: kz, esc: m.ks, estira: proy.estiramiento(e.chico.x, m.ky - 70 * m.ks), vueltas: e.chico.vueltas, inclina: e.chico.inclina, paso: e.chico.paso, amp: e.chico.amp,
          palo: e.chico.palo, mareo: e.chico.mareo, t: e.t, remera: e.chico.remera,
        });

        // Los caramelos de afuera, en una sola malla; la ganadora aparte.
        if (!cuerpos && e.car.length) prepararCaramelos(e.car.length);
        let nSombras = 0;
        const sombra = (x: number, z: number, rx: number, rz: number, alto: number, tam: number): void => {
          const k = 1 / (1 + Math.max(0, alto) / (tam * 2.5));
          sombras.poner(nSombras++, x, z, rx * k, rz * k, 0.4);
        };
        // La sombra del chico y la de la piñata, que cuelga (se achica y se aclara con la altura).
        sombras.poner(nSombras++, kx - 4 * m.ks, kz + 6 * m.ks, 24 * m.ks, 12 * m.ks, ki[1] + 0.5);
        if (e.olla.ver) sombra(oll[0], oll[2], m.R * 0.95, m.R * 0.4, Math.max(0, oll[1]) * 0.25, m.R);
        let hayGanadora = false;
        if (cuerpos && contornos) {
          const n = Math.min(e.car.length, cuerpos.instanceMatrix.count);
          let alta = 0;
          for (let i = 0; i < n; i++) {
            const ca = e.car[i]!;
            if (ca.dentro) {
              if (visto[i]) {
                d.position.set(0, -1e6, 0);
                d.scale.setScalar(1e-6);
                d.rotation.set(0, 0, 0);
                d.updateMatrix();
                cuerpos.setMatrixAt(i, d.matrix);
                contornos.setMatrixAt(i, d.matrix);
                visto[i] = 0;
                alta = i + 1 > alta ? i + 1 : alta;
              }
              continue;
            }
            const zc = (hash(i, 31) - 0.5) * PROFUNDIDAD * ca.tam;
            lugar(ca.x, ca.y, ca.ganadora ? 0 : zc);
            const tam = ca.tam * comp;
            if (ca.ganadora) {
              // La ganadora se dibuja aparte, con su color pleno y su aro en el piso.
              hayGanadora = true;
              ganadora.visible = true;
              ganadora.position.set(L[0], L[1], L[2]);
              ganadora.rotation.set(0, Math.max(0, e.corona) * 1.4, -ca.rot);
              ganadora.scale.setScalar(tam);
              if (matGanadora.color.getHex() !== ca.color) {
                matGanadora.color.setHex(ca.color);
                matGanadora.emissive.setHex(ca.color);
              }
              matGanadora.emissiveIntensity = 0.25 * clamp(e.corona / 0.25, 0, 1);
              aro.visible = true;
              aro.position.set(L[0], 0.6, 0);
              aro.scale.setScalar(tam * 1.7);
              sombra(L[0], L[2], tam * 1.2, tam * 0.7, L[1] - tam * 0.7, tam);
              // El montón de los demás no la tapa: los otros siguen y la ganadora no ocupa lugar en la malla.
              d.position.set(0, -1e6, 0);
              d.scale.setScalar(1e-6);
              d.rotation.set(0, 0, 0);
              d.updateMatrix();
              cuerpos.setMatrixAt(i, d.matrix);
              contornos.setMatrixAt(i, d.matrix);
              visto[i] = 1;
              alta = i + 1 > alta ? i + 1 : alta;
              continue;
            }
            d.position.set(L[0], L[1], L[2]);
            // Gira en el plano como en el 2D, y cada uno rueda un poco distinto sobre su eje largo.
            d.rotation.set((hash(i, 32) - 0.5) * 0.7, (hash(i, 33) - 0.5) * 0.6, -ca.rot);
            d.scale.setScalar(tam);
            d.updateMatrix();
            cuerpos.setMatrixAt(i, d.matrix);
            cuerpos.setColorAt(i, col.setHex(ca.color));
            d.scale.setScalar(tam * 1.13);
            d.updateMatrix();
            contornos.setMatrixAt(i, d.matrix);
            visto[i] = 1;
            alta = i + 1 > alta ? i + 1 : alta;
            sombra(L[0], L[2], tam * 1.1, tam * 0.7, L[1] - tam * 0.72, tam);
          }
          void alta;
          cuerpos.count = contornos.count = n;
          cuerpos.instanceMatrix.needsUpdate = contornos.instanceMatrix.needsUpdate = true;
          if (cuerpos.instanceColor) cuerpos.instanceColor.needsUpdate = true;
        }
        if (!hayGanadora) {
          ganadora.visible = false;
          aro.visible = false;
        }

        // El caramelo del susto que se asoma por la rajadura: el mismo dibujo sea quien sea.
        const so = e.asoma;
        asoma.visible = so.ver;
        if (so.ver) {
          lugar(so.x, so.y, m.R * 0.92);
          asoma.position.set(L[0], L[1], L[2]);
          asoma.rotation.set(0, 0, -so.rot);
          asoma.scale.setScalar(so.tam * comp);
          if (matAsoma.color.getHex() !== so.color) matAsoma.color.setHex(so.color);
        }

        sombras.usar(nSombras);
        sombras.fin();
        amb.seguir(pose);
        const au = motor.auditoria;
        if (au) {
          // Lo que costó el cuadro anterior en la placa, para el auditor de rendimiento.
          const info = motor.renderer.info.render;
          Object.assign(au, { llamadas: info.calls, triangulos: info.triangles });
          au.puestos.length = 0;
          for (let i = 0; i < e.car.length; i++) {
            const ca = e.car[i]!;
            if (ca.dentro) continue;
            lugar(ca.x, ca.y, 0);
            au.puestos.push({ persona: i, x: L[0] * sEsc, z: L[1] * sEsc });
          }
        }
      });
    },
    // Los nombres de la piñata son los de PixiJS, sobre los caramelos del 2D: no se apoyan en cabezas.
    pantallaDe: () => null,
    destruir() {
      cuerpos = null;
      contornos = null;
    },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: no hay que editar ningún otro archivo para que la piñata aparezca en 3D. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/pinata");
  return (names, winners, beacon, done) => m.pinataPixi(names, winners, beacon, done, montaje);
};
