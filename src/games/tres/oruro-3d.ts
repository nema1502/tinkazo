import type { Mapa } from "./camara";
import { SombrasDeContacto } from "./escena";
import { definir3D } from "./motor";
import { hornear, claseId, Recortes, type Atlas, type Cel } from "./oruro-3d-recortes";
import { Escenario, PALETAS, crearCielo } from "./oruro-3d-escenario";
import {
  ANCLA_FRAT, ANCLA_X, ANCLA_Y, CABEZA_ALTO, CELDA_H, CELDA_W, CUERPO_ENTERO, cuadroBaile, cuadroCaida, cuadroMusica, cuadroSalto, cuadroSaludo, cuadroTropiezo,
  luzDelGolpe, perfilOruro, tumbado, type EntradaOruro,
} from "./oruro-3d-tipos";
import type { Fabrica3D, Lanzador, Pantalla3D } from "./tipos";

export type { EntradaOruro } from "./oruro-3d-tipos";

/**
 * La Entrada en 3D (`?motor=3d`). Dibuja lo que `pixi/oruro.ts` ya decidió: dónde está cada bailarín, cómo se mueve,
 * dónde está la cámara. No calcula nada del juego (src/games/tres/README.md).
 *
 * Es un teatro de papel: la calle de Oruro es de verdad (fachadas, graderías, palco, arcos, el Socavón), y cada
 * bailarín es un recorte de cartón con el dibujo ya revisado del 2D, parado sobre su sombra. Los cuadros del paso se
 * hornean una vez al arrancar (`oruro-3d-recortes.ts`); el recorte que toca sale de la fase que pasa el 2D.
 */

export { luzDelGolpe };
const sinSigno = (v: number): number => (v < 0 ? -v : v);

interface Dato {
  x3: number;
  z3: number;
  pie: number;
  nombre: number;
  tope: number;
  ey: number;
  vivo: boolean;
}

const fabrica: Fabrica3D<EntradaOruro> = (motor, _o) => {
  const pal = PALETAS[motor.tema];
  // El kit deja la cámara con un rango muy largo (0,5 a 4000) y las cajas pegadas se pelean por la profundidad.
  motor.camara.near = 3;
  motor.camara.far = 1500;
  const cielo = crearCielo(motor, pal);
  const sombras = new SombrasDeContacto(motor, 320, motor.tema === "oscuro" ? 0.4 : 0.3);
  motor.escena.add(sombras.malla);
  let escenario: Escenario | null = null;
  let mundoActual: object | null = null;
  let atlas: Atlas | null = null;
  let recortes: Recortes | null = null;
  let fallo = false;
  let ultimo: EntradaOruro | null = null;
  const datos = new Map<number, Dato>();
  const anclas = new Map<number, { x: number; y: number; alto: number }>();
  let mapaUlt: Mapa | null = null;

  const dibujarRecortes = (e: EntradaOruro, mapa: Mapa, derecha: readonly [number, number, number], adelante: readonly [number, number, number]): void => {
    if (!atlas || !recortes) return;
    const dim = luzDelGolpe(e.golpe);
    const s = mapa.s;
    const ax = ANCLA_X / CELDA_W, ay = (CELDA_H - ANCLA_Y) / CELDA_H;
    const t = pal.tinteCarton;
    recortes.empezar();
    let ns = 0;
    datos.clear();
    for (const b of e.bailarines) {
      const clase = atlas.clases.get(claseId(b.g, b.mujer));
      if (!clase) continue;
      let cel: Cel | undefined;
      let roll = b.inclina;
      let pitch = 0;
      switch (b.modo) {
        case "salute":
          cel = clase.saludo[cuadroSaludo(b.t, b.semilla)];
          break;
        case "jump":
          cel = clase.salto[cuadroSalto(b.f)];
          break;
        case "stumble":
          cel = clase.tropiezo[b.dir < 0 ? 0 : 1][cuadroTropiezo(b.f)];
          break;
        case "fall":
          cel = clase.caida[b.dir < 0 ? 0 : 1][cuadroCaida(b.f)];
          // Es de cartón: al sentarse se tumba hacia atrás.
          pitch = tumbado(b.f) * 0.6;
          roll = b.inclina;
          break;
        default:
          cel = clase.baile[cuadroBaile(b.fase)];
      }
      cel ??= clase.baile[cuadroBaile(b.fase)];
      if (!cel) continue;
      const [x3, , z3] = mapa.a3D(b.x, b.y, 0);
      // El que cae sentado no se hunde en el piso: el cartón se tumba, no se entierra.
      const lift = (b.modo === "fall" ? Math.max(0, b.alto) + 12 * tumbado(b.f) : b.alto) * b.ey * s;
      const mirar = b.ex < 0 ? -1 : 1;
      const w = CELDA_W * sinSigno(b.ex) * s * mirar;
      const h = CELDA_H * b.ey * s;
      // La luz: el mundo baja con el golpe, pero quien gana queda con su color pleno.
      const luz = e.golpe >= 0 && b.id === e.ganador ? 1 : dim;
      recortes.poner(cel, x3, lift, z3, w, h, ax, ay, -roll, pitch, t[0] * luz, t[1] * luz, t[2] * luz);
      // Su retrato en el pecho, pegado al cartón y un pelo adelante (el 2D lo lleva en el pecho del traje).
      const pe = atlas.pecho.get(claseId(b.g, b.mujer)), cara = atlas.caras[b.id];
      if (pe && cara) {
        const xl = pe.x * b.ex, yl = -pe.y * b.ey;
        const rr = -roll;
        const c = Math.cos(rr), sn = Math.sin(rr);
        const px = xl * c - yl * sn, py = xl * sn + yl * c;
        const d = 0.04 * s * 30;
        recortes.poner(cara, x3 + derecha[0] * px * s - adelante[0] * d, lift + py * s, z3 + derecha[2] * px * s - adelante[2] * d, pe.w * sinSigno(b.ex) * s * mirar, pe.w * b.ey * s, 0.5, 0.5, rr, pitch, t[0] * luz, t[1] * luz, t[2] * luz);
      }
      // Lo que llevaba en la cabeza sale volando aparte y rueda.
      if (b.modo === "fall" && clase.cabeza) {
        const xl = b.cdx * b.ex, yl = (CABEZA_ALTO - b.cdy) * b.ey;
        const rr = -roll;
        const c = Math.cos(rr), sn = Math.sin(rr);
        const px = xl * c - yl * sn, py = xl * sn + yl * c;
        recortes.poner(
          clase.cabeza, x3 + derecha[0] * px * s, lift + py * s, z3 + derecha[2] * px * s, w, h, ax, (CELDA_H - ANCLA_Y + CABEZA_ALTO) / CELDA_H,
          rr - b.crot * mirar, 0, t[0] * luz, t[1] * luz, t[2] * luz,
        );
      }
      // La sombra dura bajo los pies: se achica cuando salta.
      const r = 17 * sinSigno(b.ex) * s / (1 + Math.max(0, b.alto) / 70) * (b.modo === "fall" ? 1.5 : 1);
      sombras.poner(ns++, x3 + 1.5 * s * b.ey, z3 + 1.2 * s * b.ey, r, r * 0.55);
      datos.set(b.id, { x3, z3, pie: 0, nombre: b.nombre, tope: b.tope, ey: b.ey, vivo: true });
    }
    for (const mu of e.banda) {
      const lista = atlas.banda.get(mu.kind);
      const cel = mu.e > 0.5 ? lista?.[cuadroMusica(mu.fase)] : atlas.quieto.get(mu.kind);
      if (!cel) continue;
      const [x3, , z3] = mapa.a3D(mu.x, mu.y, 0);
      recortes.poner(cel, x3, mu.alto * mu.ey * s, z3, CELDA_W * mu.ey * s, CELDA_H * mu.ey * s, ax, ay, -mu.inclina, 0, t[0] * dim, t[1] * dim, t[2] * dim);
      sombras.poner(ns++, x3 + 1.5 * s * mu.ey, z3 + 1.2 * s * mu.ey, 17 * mu.ey * s, 17 * mu.ey * s * 0.55);
    }
    sombras.usar(ns);
    sombras.fin();
    recortes.terminar(derecha, adelante, [t[0], t[1], t[2]], cielo.nieblaRgb.map((v) => Math.pow(v, 1 / 2.2)) as unknown as [number, number, number], cielo.nieblaCerca, cielo.nieblaLejos);
  };

  return {
    frame(e) {
      ultimo = e;
      if (fallo) return;
      motor.cuadro(e, perfilOruro(e), (mapa, pose) => {
        mapaUlt = mapa;
        if (e.mundo !== mundoActual) {
          escenario?.destruir();
          escenario = new Escenario(motor, e.mundo, pal);
          mundoActual = e.mundo;
          anclas.clear();
        }
        if (!atlas) {
          try {
            atlas = hornear(motor, e.reparto, e.reparto.n);
            if (!atlas) throw new Error("sin atlas");
            recortes = new Recortes(motor, atlas, e.reparto.n + e.reparto.banda.length + 8);
            if (motor.auditoria) (motor.auditoria as unknown as { horneado: number; celdas: number }).horneado = atlas.ms, (motor.auditoria as unknown as { celdas: number }).celdas = atlas.celdas;
          } catch (err) {
            console.warn("[3d] los recortes no se armaron, sigue el 2D", err);
            fallo = true;
            e.reponer2D();
            motor.canvas.style.display = "none";
            return;
          }
        }
        const dim = luzDelGolpe(e.golpe);
        cielo.luces.hemi.intensity = pal.hemiFuerza * dim;
        cielo.luces.sol.intensity = pal.luzFuerza * dim;
        escenario?.actualizar(e, { guirnaldas: e.silencio ? 0.4 : 1, mundo: dim });
        // De frente a la cámara, solo sobre el eje vertical.
        let fx = pose.mira[0] - pose.pos[0], fz = pose.mira[2] - pose.pos[2];
        const l = Math.hypot(fx, fz) || 1;
        fx /= l;
        fz /= l;
        dibujarRecortes(e, mapa, [-fz, 0, fx], [fx, 0, fz]);
        // Las pancartas de las fraternidades y los puestos para la auditoría.
        anclas.clear();
        for (const a of e.anclas) anclas.set(a.g, a);
        if (motor.auditoria) {
          motor.auditoria.puestos = e.bailarines.map((b) => {
            const [x3, , z3] = mapa.a3D(b.x, b.y, 0);
            return { persona: b.id, x: x3, z: z3 };
          });
        }
        cielo.seguir(pose);
      });
    },
    pantallaDe(id): Pantalla3D | null {
      if (id >= ANCLA_FRAT && id < CUERPO_ENTERO) {
        const a = anclas.get(id - ANCLA_FRAT);
        if (!a || !ultimo) return null;
        if (!mapaUlt) return null;
        const [x3, y3, z3] = mapaUlt.a3D(a.x, a.y, a.alto);
        const [px, , pz] = mapaUlt.a3D(a.x, a.y, 0);
        return motor.pantalla([x3, y3, z3], [px, 0, pz]);
      }
      const entero = id >= CUERPO_ENTERO;
      const d = datos.get(entero ? id - CUERPO_ENTERO : id);
      if (!d || !mapaUlt) return null;
      const s = mapaUlt.s;
      const alto = (entero ? d.tope : d.nombre) * d.ey * s;
      return motor.pantalla([d.x3, alto, d.z3], [d.x3, 0, d.z3]);
    },
    reconstruir() {
      mundoActual = null;
    },
    destruir() {
      escenario?.destruir();
      sombras.malla.removeFromParent();
    },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: no se edita ningún otro archivo para que La Entrada aparezca en 3D. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/oruro");
  return (names, ganan, beacon, done) => m.oruroPixi(names, ganan, beacon, done, montaje);
};

