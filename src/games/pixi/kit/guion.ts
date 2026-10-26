import type { LineaGuion } from "./tipos";

/**
 * El guion: lo que el relator dice y lo que pasa, con cola.
 *
 * Cada juego tenía el suyo (una lista `[t, fn]` con `saidUpTo`, un `at()` con
 * banderas `fired`, banderas sueltas) y cada uno resolvía a su manera qué pasa
 * cuando dos frases caen juntas. Acá hay una sola regla:
 *
 * - **Nunca dos frases a menos de 0,3 s.** La segunda espera en la cola.
 * - **Ninguna pisa a otra más importante antes de 1,2 s.** Si la importante
 *   sigue fresca, la que llega espera.
 * - **Lo que espera demasiado se tira** (1,5 s si la línea no pide otra cosa):
 *   una frase tarde dice algo que ya pasó.
 * - **Quien gana pisa todo.**
 * - **Al saltar, lo pendiente se tira**: el show va directo al golpe.
 *
 * Es una función del tiempo que le pasan, sin reloj propio: la misma ronda
 * cuenta lo mismo en cualquier equipo. Puro, sin DOM.
 */
export const SEPARACION_MIN = 0.3;
export const PROTECCION = 1.2;
export const VENCE = 1.5;

export const PRIORIDAD = { normal: 1, importante: 2, ganador: 99 } as const;

export interface EjecutorGuion<K> {
  decir(texto: string, calor: number, grito: boolean): void;
  hacer(fn: (k: K) => void): void;
}

export interface Guion<K> {
  /** Dispara todo lo que ya le toca en el segundo `t` (y lo que quedó esperando). */
  avanzar(t: number, ej: EjecutorGuion<K>): void;
  /** Tira todo lo pendiente. */
  saltar(): void;
  /** Cuántas líneas faltan por decir o hacer. */
  pendientes(): number;
  /** Lo dicho hasta ahora, con el segundo en que salió (para pruebas y auditores). */
  dichas(): readonly { t: number; texto: string }[];
  /** Cuántas frases se tiraron por esperar de más. */
  tiradas(): number;
}

export function crearGuion<K>(lineas: readonly LineaGuion<K>[]): Guion<K> {
  const cola = lineas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.t - b.l.t || a.i - b.i);
  let ultimaT = -Infinity;
  let ultimaPrio = 0;
  let tiradas = 0;
  const dichas: { t: number; texto: string }[] = [];

  return {
    avanzar(t, ej) {
      // Una frase que espera no deja pasar a las que vienen detrás: salen en orden.
      let esperando = false;
      for (let j = 0; j < cola.length; ) {
        const p = cola[j];
        if (!p || p.l.t > t) break;
        const l = p.l;
        if (l.texto === undefined) {
          cola.splice(j, 1);
          if (l.hacer) ej.hacer(l.hacer);
          continue;
        }
        const prio = l.prioridad ?? PRIORIDAD.normal;
        const pisa = prio >= PRIORIDAD.ganador;
        const separada = t - ultimaT >= SEPARACION_MIN;
        const protegida = ultimaPrio > prio && t - ultimaT < PROTECCION;
        if (pisa || (!esperando && separada && !protegida)) {
          cola.splice(j, 1);
          ultimaT = t;
          ultimaPrio = prio;
          const texto = typeof l.texto === "function" ? l.texto() : l.texto;
          dichas.push({ t, texto });
          ej.decir(texto, l.calor ?? 0, l.grito ?? false);
          if (l.hacer) ej.hacer(l.hacer);
          continue;
        }
        if (t - l.t > (l.vence ?? VENCE)) {
          // Venció: la frase se tira, pero lo que tenía que pasar en ese segundo pasa igual.
          cola.splice(j, 1);
          tiradas++;
          if (l.hacer) ej.hacer(l.hacer);
          continue;
        }
        esperando = true;
        j++;
      }
    },
    saltar() {
      cola.length = 0;
    },
    pendientes: () => cola.length,
    dichas: () => dichas,
    tiradas: () => tiradas,
  };
}

/**
 * Lo que dice el relator, para un niño (regla 10): seis palabras o menos, un
 * nombre por línea y ningún número (los números van en el marcador). El ritmo
 * lo llevan el cuerpo y el sonido, no la voz.
 */
export const REGLA_NINO = { palabras: 6, nombres: 1 } as const;

export const palabrasDe = (texto: string): number => texto.trim().split(/\s+/).filter(Boolean).length;

/** Lo que una frase rompe de la regla del niño. Vacío si cumple. */
export function problemasDeLinea(texto: string, nombres: readonly string[] = []): string[] {
  const p: string[] = [];
  const palabras = palabrasDe(texto);
  if (palabras > REGLA_NINO.palabras) p.push(`«${texto}» tiene ${palabras} palabras: el máximo son ${REGLA_NINO.palabras}`);
  if (/\d/.test(texto)) p.push(`«${texto}» trae números: van en el marcador`);
  const citados = new Set(nombres.filter((n) => n.trim() !== "" && texto.includes(n)));
  if (citados.size > REGLA_NINO.nombres) p.push(`«${texto}» nombra a ${citados.size} personas: una por línea`);
  return p;
}

export interface ReporteGuion {
  problemas: string[];
  /** El hueco más largo, en segundos, entre dos frases (contando el arranque y el cierre). */
  huecoMax: number;
  frases: number;
  /** Cuántos pares de frases caen a menos de `SEPARACION_MIN`: la cola las separa, pero conviene no pedirlo. */
  juntas: number;
}

/** Revisa un guion armado: fuera de rango, sin texto y huecos largos. Para las pruebas de cada juego. */
export function validarGuion<K>(lineas: readonly LineaGuion<K>[], duracion: number, o: { nino?: boolean; nombres?: readonly string[] } = {}): ReporteGuion {
  const problemas: string[] = [];
  const tiempos: number[] = [];
  lineas.forEach((l, i) => {
    if (!Number.isFinite(l.t) || l.t < 0) problemas.push(`la línea ${i} tiene un tiempo inválido (${l.t})`);
    else if (l.t > duracion) problemas.push(`la línea ${i} cae después de coronar (${l.t.toFixed(2)} > ${duracion.toFixed(2)})`);
    if (l.texto !== undefined) {
      const texto = typeof l.texto === "function" ? l.texto() : l.texto;
      if (!texto.trim()) problemas.push(`la línea ${i} tiene el texto vacío`);
      else if (o.nino) problemas.push(...problemasDeLinea(texto, o.nombres));
      if (Number.isFinite(l.t)) tiempos.push(l.t);
    }
    if (l.texto === undefined && !l.hacer) problemas.push(`la línea ${i} no dice ni hace nada`);
  });
  tiempos.sort((a, b) => a - b);
  let huecoMax = 0;
  let previo = 0;
  let juntas = 0;
  for (const t of tiempos) {
    huecoMax = Math.max(huecoMax, t - previo);
    if (t - previo < SEPARACION_MIN && previo > 0) juntas++;
    previo = t;
  }
  huecoMax = Math.max(huecoMax, duracion - previo);
  return { problemas, huecoMax, frases: tiempos.length, juntas };
}
