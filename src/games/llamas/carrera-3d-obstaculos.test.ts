import { Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Scene, SphereGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import { LLAMA_ALTO } from "./carrera-forma";
import type { Efecto3D } from "./carrera-3d-mapa";
import { TAM3D, escala3D } from "./carrera-3d-mapa";
import { crearEfectos3D, puntoDeLaGota } from "./carrera-3d-obstaculos";

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

describe("la escupida del 3D", () => {
  const escupida = (s: number): Efecto3D => ({ tipo: "escupida", s, x: 0, y: 0, y1: 0, ancho: 0, lado: 1, id: 2, boca: { x: 300, y: 400, esc: 1 }, cara: { x: 900, y: 520, esc: 1 } });
  // Las gotas van después de piedras, polvo, rayas y pasto: cada una es un borde y un centro, en ese orden.
  const centroGota = (piezas: Mesh[], j: number): Mesh => piezas[5 + 14 + RAYAS + PASTO + j * 2 + 1] as Mesh;

  it("la gota sale de la boca, llega a la cara y en el medio va por encima de las dos cabezas, sin piezas nuevas", () => {
    const { efectos, piezas } = armar();
    const armadas = piezas.length;
    const boca = { x: 300, y: 400, esc: 1 }, cara = { x: 900, y: 520, esc: 1 };
    const cuerpo = LLAMA_ALTO * escala3D(U) * TAM3D;
    efectos.frame([escupida(0)], U);
    const sale = centroGota(piezas, 0);
    expect(sale.visible).toBe(true);
    expect(sale.position.toArray()).toEqual(puntoDeLaGota(boca, cara, 0, U));
    // Crema, y grande: un 12 % del alto de la llama o más.
    const color = new Color((sale.material as MeshBasicMaterial).color);
    expect(color.r).toBeGreaterThan(0.85);
    expect(color.b).toBeLessThan(color.r);
    expect(sale.scale.x).toBeGreaterThanOrEqual(0.12 * cuerpo);
    efectos.frame([escupida(1)], U);
    const llega = centroGota(piezas, 0);
    const destino = puntoDeLaGota(boca, cara, 1, U);
    expect(Math.hypot(llega.position.x - destino[0], llega.position.y - destino[1], llega.position.z - destino[2])).toBeLessThan(0.1 * cuerpo);
    efectos.frame([escupida(0.5)], U);
    expect(centroGota(piezas, 0).position.y).toBeGreaterThan(cuerpo);
    // El salpicón abre ocho gotitas alrededor de la cara, con la misma tanda de siempre.
    efectos.frame([escupida(1.5)], U);
    for (let j = 4; j < 12; j++) expect(centroGota(piezas, j).visible).toBe(true);
    expect(piezas.length).toBe(armadas);
  });

  it("sale de la boca y llega a la cara a la altura de cada llama, que mientras pasa de su fila del grupo a su carril es más grande", () => {
    const alto = LLAMA_ALTO * escala3D(U) * TAM3D;
    const boca = { x: 300, y: 400, esc: 1.6 }, cara = { x: 900, y: 520, esc: 0.7 };
    expect(puntoDeLaGota(boca, cara, 0, U)[1]).toBeCloseTo(0.82 * alto * 1.6, 9);
    expect(puntoDeLaGota(boca, cara, 1, U)[1]).toBeCloseTo(0.82 * alto * 0.7, 9);
  });
});
