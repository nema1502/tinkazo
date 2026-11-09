import { crearMapa, type PerfilMapa } from "./camara";

/**
 * Ayudante para la prueba de igualdad de posiciones 2D y 3D de cualquier juego. No usa vitest: devuelve lo que no
 * coincide (una lista vacía es que todo está bien), así sirve en una prueba (`expect(compararPuestos(...)).toEqual([])`)
 * y en un script de auditoría.
 *
 * Lo que garantiza, y por qué importa: el 3D no decide nada. Si la cuenta que lleva un punto del 2D al 3D conserva la
 * posición (ida y vuelta, sin perder nada) y el orden (quien va adelante en el 2D va adelante en el 3D, quien está
 * arriba en el 2D queda más lejos en el 3D), entonces el 3D dibuja el sorteo que el 2D decidió: mismo orden de
 * llegada, mismo ganador. La prueba de un juego saca del plan 2D en varios momentos dónde está cada cosa (como hace la
 * de la carrera con `planCarrera`), se la pasa a esto, y además comprueba que `colocar` de su vista usa `crearMapa`.
 */

export interface Puesto2D {
  /** Quién es (la persona, el carril, el trompo). */
  id: number;
  /** Dónde pisa en el mundo 2D, en píxeles. */
  x: number;
  y: number;
  /** Qué tan alto está sobre el piso (un salto, una caída), en píxeles. 0 si no aplica. */
  alto?: number;
}

export interface Discrepancia {
  id: number;
  motivo: "ida-y-vuelta" | "orden-x" | "orden-profundidad";
  detalle: string;
}

/** Los `id`, de menor a mayor valor del eje, con el `id` como desempate. */
export const ordenPor = (xs: readonly { id: number; v: number }[]): number[] => [...xs].sort((a, b) => a.v - b.v || a.id - b.id).map((x) => x.id);

/**
 * Pasa cada puesto del 2D al 3D con el `Mapa` del perfil y los compara: la posición vuelve intacta (`tolerancia`, en
 * píxeles) y el orden a lo largo de x y de la profundidad es el mismo. `u` es la unidad de la pantalla.
 */
export function compararPuestos(puestos: readonly Puesto2D[], perfil: PerfilMapa, u: number, tolerancia = 1e-6): Discrepancia[] {
  const mapa = crearMapa(perfil, u);
  const fallas: Discrepancia[] = [];
  const en3D = puestos.map((p) => ({ p, v: mapa.a3D(p.x, p.y, p.alto ?? 0) }));
  for (const { p, v } of en3D) {
    const b = mapa.a2D(v[0], v[1], v[2]);
    const d = Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y), Math.abs(b.alto - (p.alto ?? 0)));
    if (!(d <= tolerancia)) fallas.push({ id: p.id, motivo: "ida-y-vuelta", detalle: `vuelve a (${b.x}, ${b.y}, ${b.alto}) y salió de (${p.x}, ${p.y}, ${p.alto ?? 0})` });
  }
  const o2x = ordenPor(puestos.map((p) => ({ id: p.id, v: p.x })));
  const o3x = ordenPor(en3D.map(({ p, v }) => ({ id: p.id, v: v[0] })));
  if (o2x.join() !== o3x.join()) fallas.push({ id: -1, motivo: "orden-x", detalle: `2D ${o2x.join()} contra 3D ${o3x.join()}` });
  const o2z = ordenPor(puestos.map((p) => ({ id: p.id, v: p.y })));
  const o3z = ordenPor(en3D.map(({ p, v }) => ({ id: p.id, v: v[2] })));
  if (o2z.join() !== o3z.join()) fallas.push({ id: -1, motivo: "orden-profundidad", detalle: `2D ${o2z.join()} contra 3D ${o3z.join()}` });
  return fallas;
}

/**
 * Para un juego en que la ganadora es la que más lejos llega en un eje (la carrera en x, un trompo que queda de pie en
 * el centro...): `true` si quien gana en el 2D es también quien tiene el valor más extremo en el 3D. Es el mismo orden
 * de `compararPuestos`, mirado desde el final.
 */
export function ganaIgual(puestos: readonly Puesto2D[], ganador: number, perfil: PerfilMapa, u: number, eje: "x" | "profundidad" = "x"): boolean {
  const mapa = crearMapa(perfil, u);
  const v = puestos.map((p) => ({ id: p.id, v: eje === "x" ? mapa.a3D(p.x, p.y, p.alto ?? 0)[0] : mapa.a3D(p.x, p.y, p.alto ?? 0)[2] }));
  const mejor = [...v].sort((a, b) => b.v - a.v || a.id - b.id)[0];
  return mejor?.id === ganador;
}
