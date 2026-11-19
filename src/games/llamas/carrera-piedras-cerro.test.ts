import { describe, expect, it, vi } from "vitest";
import { TAM3D, ZC, type PiedraCerro } from "./carrera-3d-mapa";
import { carrilesDe, LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO } from "./carrera-forma";
import { formaDelGrupo } from "./carrera-filas";
import { CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { crearVistaObstaculos, PIEDRAS_CERRO } from "./carrera-obstaculos-vista";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera, type Datos } from "./carrera-show";
import { crearTrayectorias, type Trayectorias } from "./carrera-trayectorias";

/**
 * Las piedras del cerro no atraviesan a nadie: caen delante de la llama a la que le toca, ruedan hacia adelante sin que ella las
 * alcance, y no se meten en los carriles de al lado. Se mira cada cuadro a 60 por segundo, desde que asoma la primera piedra hasta que
 * se deshace la última, contra la huella de cada finalista en el 3D (la más grande) y en el 2D, en cuatro pantallas.
 */

vi.setConfig({ testTimeout: 180_000 });

const PANTALLAS: readonly [number, number][] = [[1366, 768], [390, 844], [844, 390], [1920, 1080]];

function armar(d: Datos, W: number, H: number): { tr: Trayectorias; vista: ReturnType<typeof crearVistaObstaculos>; u: number; altoFila: number } {
  const u = W < H ? Math.min(W / 420, H / 900) : H / 720;
  const P = { w: W, h: H, u, retrato: W < H, top: 60 * u, bottom: H - 90 * u };
  // El grupo como lo arma la escena: las filas según el carril (`formaDelGrupo`). Con las filas de siempre, dos finalistas de filas en orden
  // contrario a sus carriles se cruzan al pasar a la recta, y la que cruza pasa por donde cae la piedra de otra: eso la escena no lo dibuja.
  const cuerpo = CUERPO * ENSANCHE * RECTA * W;
  const grupo = formaDelGrupo({ P, d, nombrePx: 16 * u, nombreW: 110 * u, cuerpoPx: cuerpo });
  const forma = grupo.forma;
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const carr = carrilesDe(P, d.lanes.length, 16 * u);
  const F0 = -(60 * u + LLAMA_HOCICO * forma.esc);
  const Xs = F0 + d.distAbre * W;
  const tr = crearTrayectorias(d, { F0, Xs, ancho: W, cuerpo, forma, carr, caminata: null, filaDeLugar: grupo.filaDeLugar });
  const vista = crearVistaObstaculos(d, {
    xs: Xs, largo: RECTA * W, ancho: W, esc: carr.esc, u, altoFila: carr.altoFila,
    yPie: (k) => carr.yPie(k), piso: (k, t) => tr.piso(k, t), escEn: (k, t) => tr.escEn(k, t),
  });
  return { tr, vista, u, altoFila: carr.altoFila };
}

/** Si la elipse de la piedra (con su alto) toca la caja de la llama (con el suyo): el punto de la caja más cercano al centro cae adentro. */
function toca(c: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }, e: { x: number; y: number; a: number; b: number; z0: number; z1: number }): boolean {
  if (!(Math.min(c.z1, e.z1) > Math.max(c.z0, e.z0)) || e.a <= 0 || e.b <= 0) return false;
  const px = Math.max(c.x0, Math.min(e.x, c.x1)), py = Math.max(c.y0, Math.min(e.y, c.y1));
  return ((px - e.x) / e.a) ** 2 + ((py - e.y) / e.b) ** 2 < 1;
}

/** La caja de una llama en el 3D (la huella de `PUNTOS_LLAMA`, agrandada por `TAM3D`) o en el 2D (de la cola al hocico). */
function caja(p: { x: number; y: number; esc: number; alza?: number }, motor: "3d" | "2d") {
  const z0 = p.alza ?? 0;
  if (motor === "3d") {
    const k = p.esc * TAM3D;
    return { x0: p.x - 36 * k, x1: p.x + 38 * k, y0: p.y - (13 * k) / ZC, y1: p.y + (13 * k) / ZC, z0, z1: z0 + 100 * k };
  }
  return { x0: p.x + LLAMA_COLA * p.esc, x1: p.x + LLAMA_HOCICO * p.esc, y0: p.y - 13 * p.esc, y1: p.y + 13 * p.esc, z0, z1: z0 + LLAMA_ALTO * p.esc };
}

/** La piedra como sólido: en el 3D una esfera (la elipse en el piso es su sombra en el mundo 2D); en el 2D, el dibujo plano con su alto. */
function solido(p: PiedraCerro, motor: "3d" | "2d") {
  if (motor === "3d") return { x: p.x, y: p.y, a: p.r * p.k, b: (p.r * p.k) / ZC, z0: p.alto - p.r * p.k, z1: p.alto + p.r * p.k };
  const r = p.r2 * p.k, z0 = Math.max(0, p.alto - p.r);
  return { x: p.x, y: p.y, a: r, b: 0.5 * r, z0, z1: z0 + 1.64 * r };
}

describe("las piedras del cerro no atraviesan a nadie", () => {
  for (const n of [8, 18, 60, 80]) {
    it(`con ${n} personas, en cuatro pantallas y 10 semillas, ninguna piedra toca a ninguna finalista en el 3D ni en el 2D`, () => {
      let vistas = 0;
      const toques: string[] = [];
      for (let semilla = 1; semilla <= 10; semilla++) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const piedras = (d.final.obstaculos ?? []).map((o, id) => ({ o, id })).filter(({ o }) => o.tipo === "piedras");
        if (!piedras.length) continue;
        const [W, H] = PANTALLAS[(semilla - 1) % PANTALLAS.length] as [number, number];
        const { tr, vista } = armar(d, W, H);
        for (const { o, id } of piedras) {
          const desde = Math.ceil((d.tDeQ(o.q - 0.05) - d.tAbre) * 60), hasta = Math.floor((d.tDeQ(o.q + 0.1) - d.tAbre) * 60);
          for (let i = Math.max(0, desde); i <= hasta; i++) {
            const t = d.tAbre + i / 60;
            const f = vista.efectos(t).find((e) => e.id === id);
            if (!f?.piedras) continue;
            const llamas = d.lanes.map((p) => tr.posicion(p, t));
            for (const [j, p] of f.piedras.entries()) {
              if (!p.visible) continue;
              vistas++;
              for (const motor of ["3d", "2d"] as const) {
                const s = solido(p, motor);
                llamas.forEach((ll, k) => {
                  if (toca(caja(ll, motor), s)) toques.push(`${W}x${H} semilla ${semilla}, ${motor}, piedra ${j} contra el carril ${k}${k === o.carriles[0] ? " (la víctima)" : ""} a los ${t.toFixed(2)} s`);
                });
              }
            }
          }
        }
      }
      expect(vistas).toBeGreaterThan(0);
      expect(toques.slice(0, 8), `${toques.length} cuadros con una piedra dentro de una llama`).toEqual([]);
    });
  }

  it("la piedra grande cae delante del hocico de la víctima y las chicas, delante de la grande y dentro de su carril", () => {
    const d = planCarrera(ctxDe(18, 3)).datos;
    const id = (d.final.obstaculos ?? []).findIndex((o) => o.tipo === "piedras");
    expect(id).toBeGreaterThanOrEqual(0);
    const o = (d.final.obstaculos ?? [])[id] as NonNullable<Datos["final"]["obstaculos"]>[number];
    const { tr, vista, altoFila } = armar(d, 1366, 768);
    const t = d.tDeQ(o.q);
    const f = vista.efectos(t).find((e) => e.id === id);
    expect(f?.piedras?.length).toBe(PIEDRAS_CERRO);
    const ella = tr.posicion(d.lanes[o.carriles[0] as number] as number, t);
    const grande = f?.piedras?.[0] as PiedraCerro;
    expect(grande.x - grande.r).toBeGreaterThan(ella.x + 38 * ella.esc * TAM3D);
    for (const p of f?.piedras?.slice(1) ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(grande.x);
      expect(Math.abs(p.yPiso - grande.yPiso)).toBeLessThanOrEqual(0.3 * altoFila + 1e-9);
    }
  });
});
