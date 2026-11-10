import { Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Scene, SphereGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Efecto3D } from "./carrera-3d-mapa";
import { crearEfectos3D } from "./carrera-3d-obstaculos";

/**
 * La ráfaga del 3D: rayas de viento y hojas. Las rayas no pueden parecer llamas transparentes (finas, cortas, color crema
 * y a media transparencia) ni las hojas conos beige (verdes y planas). Y todo es función del plan, sin azar ni reloj.
 */

const U = 1;
const RAYAS_DESDE = 5 + 14; // piedras y polvo van primero en el grupo
const RAYAS = 26;
const PASTO = 16;

function armar() {
  const escena = new Scene();
  const basura = { add: <T extends { dispose(): void }>(x: T): T => x };
  const efectos = crearEfectos3D(escena, basura);
  const grupo = escena.children[0] as Group;
  const piezas = grupo.children as Mesh[];
  return { efectos, piezas, rayas: piezas.slice(RAYAS_DESDE, RAYAS_DESDE + RAYAS), hojas: piezas.slice(RAYAS_DESDE + RAYAS, RAYAS_DESDE + RAYAS + PASTO) };
}

const viento = (s: number, id = 1): Efecto3D => ({ tipo: "viento", s, x: 900, y: 400, y1: 700, ancho: 600, lado: 1, id });

describe("la ráfaga del 3D", () => {
  it("las rayas de viento son finas, cortas, crema y a media transparencia", () => {
    const { efectos, rayas } = armar();
    efectos.frame([viento(0.5)], U);
    const vistas = rayas.filter((m) => m.visible);
    expect(vistas.length).toBe(RAYAS);
    for (const m of vistas) {
      const mat = m.material as MeshBasicMaterial;
      // Más finas que las líneas de los carriles (0,09), nunca más largas que 3 y con la mitad de opacidad como mucho.
      expect(m.scale.y).toBeLessThanOrEqual(0.05);
      expect(m.scale.z).toBeLessThanOrEqual(0.05);
      expect(m.scale.x).toBeGreaterThanOrEqual(1);
      expect(m.scale.x).toBeLessThanOrEqual(3);
      expect(mat.opacity).toBeLessThanOrEqual(0.5);
      expect(mat.opacity).toBeGreaterThan(0);
      // Crema, no blanco: el azul más bajo que el rojo y el verde.
      const c = new Color(mat.color);
      expect(c.b).toBeLessThan(c.r);
      expect(c.b).toBeLessThan(c.g);
      expect(c.r).toBeGreaterThan(0.85);
    }
  });

  it("sin ráfaga no se ve nada, y en el principio y el final del soplido las rayas no se ven (opacidad 0)", () => {
    const { efectos, piezas, rayas } = armar();
    efectos.frame([], U);
    expect(piezas.every((m) => !m.visible)).toBe(true);
    efectos.frame([viento(0)], U);
    for (const m of rayas.filter((x) => x.visible)) expect((m.material as MeshBasicMaterial).opacity).toBeCloseTo(0, 5);
  });

  it("las hojas son verdes y planas: nada de conos ni de paja beige", () => {
    const { efectos, hojas } = armar();
    efectos.frame([viento(0.5)], U);
    const vistas = hojas.filter((m) => m.visible);
    expect(vistas.length).toBe(PASTO);
    for (const m of vistas) {
      expect(m.geometry).toBeInstanceOf(SphereGeometry);
      const c = new Color((m.material as MeshLambertMaterial).color);
      // Verde: el canal verde manda sobre el rojo y el azul.
      expect(c.g).toBeGreaterThan(c.r);
      expect(c.g).toBeGreaterThan(c.b);
      // Plana: el espesor es mucho menor que el largo y que el ancho.
      expect(m.scale.y).toBeLessThan(m.scale.x / 5);
      expect(m.scale.y).toBeLessThan(m.scale.z / 3);
    }
  });

  it("es una función del plan y de la hora: la misma ráfaga dibuja lo mismo y no usa el azar", () => {
    // Three.js sortea los identificadores al crear cada pieza: el azar se mira solo mientras se dibuja.
    const a = armar();
    const b = armar();
    const espia = vi.spyOn(Math, "random");
    a.efectos.frame([viento(0.37, 4)], U);
    b.efectos.frame([viento(0.1, 9)], U);
    b.efectos.frame([viento(0.37, 4)], U);
    const foto = (ps: Mesh[]): number[][] => ps.map((m) => [m.visible ? 1 : 0, ...m.position.toArray(), ...m.scale.toArray(), ...m.rotation.toArray().slice(0, 3).map(Number)]);
    expect(foto(b.piezas)).toEqual(foto(a.piezas));
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});
