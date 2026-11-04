import type { Momento } from "./llama";

/**
 * La postura de la llama ante un obstáculo (`carrera-obstaculos.ts`), una sola cuenta para las tres llamas (la de siempre, la de aguayo y la
 * del 3D). Es función de `m.p` (el avance del momento, de 0 a 1) y nada más: sin azar ni reloj.
 *
 * Los ángulos son los del 3D y los del aguayo: la pata hacia adelante es positiva; `lean` positivo es cabeza para abajo; `cuelloRot`
 * negativo, cabeza para arriba. La llama de siempre invierte el signo de las patas.
 */
export interface PosturaObstaculo {
  /** Las cuatro patas (delantera, trasera, delantera, trasera), hacia adelante positivo. */
  patas?: number[];
  lean: number;
  cuelloRot: number;
  aviso?: "!" | "?!";
  rigida: boolean;
}

export const ES_OBSTACULO = (kind: string | undefined): boolean => kind === "piedra" || kind === "salto" || kind === "malsalto" || kind === "ventarron";

export function posturaObstaculo(m: Momento): PosturaObstaculo | null {
  if (!m) return null;
  const p = Math.max(0, Math.min(1, m.p));
  if (m.kind === "piedra") {
    // Frena en seco: patas clavadas, la cabeza se levanta y el cuerpo se sacude cada vez menos.
    const tiembla = Math.sin(p * 38) * (1 - p);
    return { patas: [0.38, 0.25, -0.22, -0.3], lean: -0.1 + 0.17 * tiembla, cuelloRot: -0.3 + 0.2 * tiembla, ...(p < 0.7 ? { aviso: "!" as const } : {}), rigida: p < 0.55 };
  }
  if (m.kind === "salto") {
    const a = Math.sin(Math.PI * p);
    return { patas: [0.95 * a, 0.8 * a, -0.85 * a, -0.7 * a], lean: -0.26 * Math.sin(2 * Math.PI * p), cuelloRot: -0.22 * a, rigida: true };
  }
  if (m.kind === "malsalto") {
    // Se queda corta: salta a medias y trastabilla al caer, con la cabeza para abajo.
    const a = Math.sin(Math.PI * p) * 0.55;
    return { patas: [0.8 * a, 0.5 * a, -0.5 * a, -0.4 * a], lean: 0.5 * Math.sin(Math.PI * Math.min(1, p * 1.25)), cuelloRot: 0.18 * Math.sin(Math.PI * p), ...(p > 0.35 ? { aviso: "!" as const } : {}), rigida: true };
  }
  if (m.kind === "ventarron") {
    // El viento de frente: se echa para atrás, con la cabeza gacha, sin dejar de correr.
    const a = Math.sin(Math.PI * Math.min(1, p * 1.1));
    return { lean: -0.3 * a, cuelloRot: 0.25 * a, rigida: false };
  }
  return null;
}
