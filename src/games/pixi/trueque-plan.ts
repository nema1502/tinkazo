/**
 * El Trueque: el plan de los encargos, sin Pixi ni DOM (para probarlo en Node).
 *
 * Cada persona es un puesto de la feria. Acepta un producto (es su trustline:
 * solo recibe lo que aceptó) y da otro a cambio. Un encargo sale de un origen
 * con un producto y viaja de puesto en puesto hasta llegar a quien lo espera.
 * Cada puesto cambia una sola vez, y el camino no pasa de seis cambios, como
 * un pago de Stellar que cambia de activo por el camino (hasta cinco activos
 * intermedios).
 *
 * El plan lo fija el sorteo: quién cambia, qué producto entra y sale, y el
 * orden en que se prueban los puestos. Los callejones sin salida son reales:
 * un puesto que acepta el producto que lleva el encargo, pero desde el cual ya
 * no se llega a quien lo espera dentro del límite, se prueba y se rechaza. El
 * juego solo los cuenta. El azar sale del `rng` sembrado de la ronda, así que
 * la misma ronda arma la misma feria.
 */

/** Los productos, por número. El nombre de cada uno está en `src/i18n.ts`. */
export const PRODUCTOS = ["papa", "chuno", "quinua", "maiz", "arroz", "yuca", "platano", "cafe"] as const;
export const N_PRODUCTOS = PRODUCTOS.length;

/** El camino no pasa de seis cambios (el límite de Stellar, cinco activos intermedios). */
export const MAX_CAMBIOS = 6;

/** Lo que acepta y lo que da cada puesto, por número de producto. */
export interface Puesto {
  acepta: number;
  da: number;
}

/** Un puesto al que se le pasa el encargo. `ok` si el encargo cambia ahí (o llega). */
export interface Intento {
  quien: number;
  ok: boolean;
}

/**
 * Un pase: el encargo lleva `producto` y se prueban los puestos en orden. Los
 * que van antes del `ok` son callejones; el `ok` es el que cambia el encargo,
 * o el destino en el último pase.
 */
export interface Pase {
  producto: number;
  intentos: Intento[];
}

export interface Encargo {
  /** Quien espera el encargo (el ganador). */
  destino: number;
  /** El producto con el que sale del origen. */
  origen: number;
  /** Quiénes cambian, en orden: el de la posición t cambia en el pase t. */
  cambios: number[];
  /** El producto en cada paso: `productos[0]` es el origen, el último lo acepta el destino. */
  productos: number[];
  /** Un pase por cambio, y el último es la entrega al destino. */
  pases: Pase[];
}

export interface Trueque {
  puestos: Puesto[];
  encargos: Encargo[];
  /** Cuántos cambios tiene cada encargo (el mismo para todos). */
  cambios: number;
  /** Cuántos pases hay en total: los cambios, más la entrega. */
  pases: number;
  /**
   * En cada pase, a quiénes se les prende la luz: todos los que aceptan lo que
   * lleva algún encargo y todavía no cambiaron. Índice 0 = primer pase.
   */
  prendidos: number[][];
}

/**
 * Cuántos cambios por encargo según cuánta gente hay. Con menos de doce, tres;
 * después, cuatro, y con sesenta o más, cinco.
 */
export function cambiosPara(n: number): number {
  if (n < 12) return 3;
  if (n < 60) return 4;
  return 5;
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

const range = (n: number): number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i);

/**
 * ¿Desde el producto `desde` se llega a `meta` en `cambios` cambios o menos,
 * usando solo estas aristas (cada una es un puesto: lo que acepta → lo que da)?
 */
export function llega(desde: number, meta: number, cambios: number, aristas: readonly (readonly [number, number])[]): boolean {
  if (desde === meta) return true;
  let frontera = [desde];
  const visto = new Set<number>([desde]);
  for (let paso = 0; paso < cambios && frontera.length; paso++) {
    const siguiente: number[] = [];
    for (const [a, b] of aristas) {
      if (!frontera.includes(a) || visto.has(b)) continue;
      if (b === meta) return true;
      visto.add(b);
      siguiente.push(b);
    }
    frontera = siguiente;
  }
  return false;
}

/**
 * La cadena de productos de un encargo: el origen, `k` cambios y el producto
 * que acepta el destino (`meta`). Dos pasos seguidos nunca son iguales, así que
 * el último cambio nunca recibe `meta`.
 *
 * El camino puede pasar antes por `meta`, como por cualquier otro producto: ese
 * pase lo cambia otro puesto que también lo acepta, y quien espera se prende
 * como todos los que lo aceptan, sin que lo prueben. Hasta el 21 de octubre de
 * 2026 ningún paso intermedio era `meta`, y la sala podía aprender que un
 * puesto que ya se había prendido no ganaba nunca (auditor de delatores: 153 de
 * 153 con ocho personas). Con los pasos al azar, `meta` aparece algo menos que
 * los demás productos (el paso de antes de la entrega no puede ser `meta`).
 * Con tres cambios eso ya queda parejo, porque a un puesto prendido lo pueden
 * probar como callejón y sacar, y a quien espera no. Con cuatro o más, un
 * octavo de las veces se pone `meta` en un paso al azar. Así quien espera se
 * prende antes tan seguido como uno cualquiera de los que siguen en juego (lo
 * mide la prueba, con 8, 12, 18 y 60 personas).
 */
function cadena(k: number, meta: number, rng: () => number): number[] {
  if (k === 0) return [meta];
  const elegir = (excluir: readonly number[]): number => {
    const ok = range(N_PRODUCTOS).filter((p) => !excluir.includes(p));
    return ok[Math.floor(rng() * ok.length)] as number;
  };
  const forzado = k >= 4 && rng() < 1 / N_PRODUCTOS ? Math.floor(rng() * (k - 1)) : -1;
  const productos: number[] = [];
  for (let t = 0; t < k; t++) {
    if (t === forzado) {
      productos.push(meta);
      continue;
    }
    const excluir = t > 0 ? [productos[t - 1] as number] : [];
    if (t === k - 1 || t + 1 === forzado) excluir.push(meta);
    productos.push(elegir(excluir));
  }
  productos.push(meta);
  return productos;
}

/**
 * Arma la feria: los puestos, los encargos y sus pases.
 *
 * `ganadores` son los índices de quienes esperan un encargo (uno por premio).
 * Nunca cambian: el encargo llega a ellos. El resto de la gente son los puestos
 * que cambian, cada uno una sola vez.
 */
export function planTrueque(n: number, ganadores: readonly number[], rng: () => number): Trueque {
  const destinos = [...new Set(ganadores)].filter((i) => Number.isInteger(i) && i >= 0 && i < n);
  const esDestino = new Set(destinos);
  const pool = range(n).filter((i) => !esDestino.has(i));
  const cambios = destinos.length ? Math.min(cambiosPara(n), Math.floor(pool.length / destinos.length)) : 0;

  // Un reparto parejo de lo que acepta cada uno, y después lo que da: nunca lo mismo que acepta.
  const aceptaBase = shuffle(range(n).map((i) => i % N_PRODUCTOS), rng);
  const puestos: Puesto[] = aceptaBase.map((acepta) => {
    const r = Math.floor(rng() * (N_PRODUCTOS - 1));
    return { acepta, da: r >= acepta ? r + 1 : r };
  });

  // Quién cambia en qué encargo y en qué pase. `cambioEn[i]` es el pase en que
  // i cambia (1 es el primero); Infinity si nunca cambia.
  const cambioEn: number[] = Array.from({ length: n }, () => Infinity);
  const mezcla = shuffle([...pool], rng);
  const encargos: Encargo[] = destinos.map((destino, j) => {
    const quienCambia = mezcla.slice(j * cambios, (j + 1) * cambios);
    const productos = cadena(cambios, puestos[destino]?.acepta ?? 0, rng);
    quienCambia.forEach((s, t) => {
      puestos[s] = { acepta: productos[t] ?? 0, da: productos[t + 1] ?? 0 };
      cambioEn[s] = t + 1;
    });
    return { destino, origen: productos[0] ?? 0, cambios: quienCambia, productos, pases: [] };
  });

  // En la entrega tiene que haber otro puesto que acepte lo que lleva el
  // encargo: si no, se prende uno solo, el de quien espera, y la sala sabe
  // quién gana en cuanto se pregunta "¿quién acepta…?". Con ocho personas cada
  // producto lo acepta un solo puesto y pasaba en todas las semillas (auditor
  // de delatores, 21 de octubre de 2026). Si no hay, un puesto libre pasa a
  // aceptarlo; nunca uno que ya acepta lo de otra entrega.
  const metas = new Set(encargos.map((e) => puestos[e.destino]?.acepta ?? 0));
  for (const e of encargos) {
    const meta = puestos[e.destino]?.acepta ?? 0;
    const libres = range(n).filter((i) => !esDestino.has(i) && cambioEn[i] === Infinity);
    if (libres.some((i) => puestos[i]?.acepta === meta)) continue;
    const candidatos = libres.filter((i) => !metas.has(puestos[i]?.acepta ?? -1));
    if (!candidatos.length) continue;
    const s = candidatos[Math.floor(rng() * candidatos.length)] as number;
    const da = puestos[s]?.da ?? 0;
    puestos[s] = { acepta: meta, da: da !== meta ? da : (meta + 1 + Math.floor(rng() * (N_PRODUCTOS - 1))) % N_PRODUCTOS };
  }

  const pasesTotal = cambios + 1;
  const prendidos: number[][] = [];
  for (let t = 1; t <= pasesTotal; t++) {
    // Libres en el pase t: los que todavía no cambiaron (los que cambian en este pase, también).
    const libre = (i: number): boolean => !esDestino.has(i) && (cambioEn[i] ?? Infinity) >= t;
    const luz = new Set<number>();
    for (const e of encargos) {
      const q = e.productos[t - 1] ?? 0;
      for (const i of range(n)) if (libre(i) && puestos[i]?.acepta === q) luz.add(i);
      // Quien espera se prende como cualquiera que acepta lo que lleva el
      // encargo: en la entrega, y también antes si el camino pasa por lo suyo.
      for (const d of destinos) if (puestos[d]?.acepta === q) luz.add(d);
    }
    prendidos.push([...luz]);

    for (const e of encargos) {
      const q = e.productos[t - 1] ?? 0;
      const meta = puestos[e.destino]?.acepta ?? 0;
      const entrega = t === pasesTotal;
      const quien = entrega ? e.destino : (e.cambios[t - 1] ?? e.destino);
      // Un callejón: un puesto que acepta `q`, libre en este pase, y desde el
      // cual, con lo que queda del límite, no se llega a quien espera. Se
      // calcula con todos los demás que todavía no cambiaron, así que es
      // verdad aunque el orden de los pases cambie.
      const callejones = range(n).filter((d) => {
        if (entrega || d === quien || !libre(d) || puestos[d]?.acepta !== q) return false;
        const aristas: [number, number][] = [];
        for (const f of range(n)) if (f !== d && libre(f)) aristas.push([puestos[f]?.acepta ?? 0, puestos[f]?.da ?? 0]);
        return !llega(puestos[d]?.da ?? 0, meta, MAX_CAMBIOS - t, aristas);
      });
      const intentos: Intento[] = [];
      if (entrega) {
        // La entrega: se prenden quien espera y los otros que aceptan lo que
        // lleva, y el encargo los prueba hasta llegar. Quien espera puede ser el
        // primero, el segundo o el tercero que se prueba, y es el primero tan
        // seguido como cualquiera de los prendidos. Hasta el 21 de octubre de
        // 2026 se probaba siempre antes el otro: el primero que probaba perdía
        // (auditor de delatores: 149 de 173 con dieciocho personas).
        const otros = range(n).filter((d) => d !== quien && libre(d) && puestos[d]?.acepta === q);
        let antes = 0;
        if (otros.length && rng() >= 1 / (otros.length + 1)) antes = otros.length >= 2 && rng() < 0.5 ? 2 : 1;
        for (const d of shuffle([...otros], rng).slice(0, antes)) intentos.push({ quien: d, ok: false });
      } else if (callejones.length > 0 && rng() < 0.6) {
        intentos.push({ quien: callejones[Math.floor(rng() * callejones.length)] as number, ok: false });
      }
      intentos.push({ quien, ok: true });
      e.pases.push({ producto: q, intentos });
    }
  }

  return { puestos, encargos, cambios, pases: pasesTotal, prendidos };
}
