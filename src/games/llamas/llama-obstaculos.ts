import type { Momento } from "./llama";

/**
 * La postura de la llama ante un obstáculo (`carrera-obstaculos.ts`) o al entrar trotando al corral (`carrera-caminata.ts`), una sola cuenta para las tres llamas (la de siempre, la de aguayo y la
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
  /** Cuánto gira el cuello hacia el carril de al lado, en radianes (quien escupe mira a su vecina). El 2D lo ignora: ahí se ve el escupitajo. */
  cuelloGiro?: number;
  aviso?: "!" | "?!";
  rigida: boolean;
}

export const ES_OBSTACULO = (kind: string | undefined): boolean => kind === "piedra" || kind === "salto" || kind === "malsalto" || kind === "ventarron" || kind === "escupe" || kind === "escupido";

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
  if (m.kind === "trote") {
    // Entra al corral trotando (las que pasan por el portón): el cuerpo hacia adelante y la cabeza baja, sin patas clavadas. Arranca y termina de a poco.
    const a = Math.min(1, p / 0.08, (1 - p) / 0.08);
    return { lean: 0.1 * a, cuelloRot: 0.16 * a, rigida: false };
  }
  if (m.kind === "ventarron") {
    // El viento de frente: se echa para atrás, con la cabeza gacha, sin dejar de correr.
    const a = Math.sin(Math.PI * Math.min(1, p * 1.1));
    return { lean: -0.3 * a, cuelloRot: 0.25 * a, rigida: false };
  }
  if (m.kind === "escupe") {
    // Carga un segundo mirando a la vecina con la cabeza para atrás y suelta: el giro crece de a poco y se va con el vuelo.
    const giro = (m.giro ?? 1) * 0.6;
    const carga = Math.min(1, p / 0.74);
    const suelta = Math.max(0, (p - 0.74) / 0.26);
    return { lean: -0.08 * carga * (1 - suelta), cuelloRot: -0.38 * carga * (1 - suelta) + 0.16 * Math.sin(Math.PI * suelta), cuelloGiro: giro * carga * (1 - suelta), rigida: false };
  }
  if (m.kind === "escupido") {
    // Le llega a la cara: cabeza para atrás y sacudida que se apaga en poco más de medio segundo, con el "?!" al costado.
    const tiembla = Math.sin(p * 40) * Math.max(0, 1 - p * 1.7);
    return { lean: -0.14 * Math.sin(Math.PI * Math.min(1, p * 1.4)) + 0.1 * tiembla, cuelloRot: -0.32 * Math.sin(Math.PI * Math.min(1, p * 1.2)) + 0.18 * tiembla, ...(p < 0.75 ? { aviso: "?!" as const } : {}), rigida: p < 0.4 };
  }
  return null;
}
