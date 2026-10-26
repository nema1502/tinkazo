/**
 * Los nombres que se completan.
 *
 * En un pelotón de treinta no hay lugar para treinta nombres enteros: cada
 * persona sale con su emblema y su inicial, y el nombre se va completando a
 * medida que queda menos gente. Los que siguen suben de nivel **todos a la
 * vez**, por cuántos quedan y nunca por quién: si uno se completara antes que
 * los demás, la sala adivinaría al ganador (auditor de delatores).
 *
 * Los cuatro niveles, de menos a más nombre:
 *
 * 1. la inicial ("M")
 * 2. el nombre de pila ("María")
 * 3. el nombre y la inicial del último apellido ("María Q.")
 * 4. el nombre entero ("María Quispe")
 *
 * Reglas que no se rompen:
 *
 * - **Un nombre nunca se corta a la mitad** ni termina en "…". Si no entra
 *   en una línea, se achica la letra o se parte en dos líneas, en un espacio
 *   (o después de un guion o un guion bajo). `shorten()` de `overlay.ts` corta
 *   por el medio y no se usa acá.
 * - **Dos personas con el mismo texto a la vez suben de nivel** hasta
 *   distinguirse ("María Q." y "María M."); los nombres repetidos tienen un
 *   ordinal ("Juan Pérez (2)"). En el nivel 1 la inicial se repite y
 *   no pasa nada: ahí las separa el emblema.
 * - Nada de esto depende de quién gana ni usa el azar: sale solo de los
 *   nombres y de cuántos quedan. Puro, sin DOM, para probarlo en Node.
 */

export type Nivel = 1 | 2 | 3 | 4;

/** Una letra o un número: lo que cuenta como "empieza con". */
const LETRA = /[\p{L}\p{N}]/u;
/** Una letra de verdad: una palabra sin ninguna (un número, un emoji) no es un apellido. */
const SOLO_LETRA = /\p{L}/u;

const segmentador = new Intl.Segmenter("es", { granularity: "grapheme" });

/** Los caracteres tal como los ve una persona: una "ñ" con tilde combinada o un emoji con modificadores son uno solo. */
export function grafemas(s: string): string[] {
  return Array.from(segmentador.segment(s), (x) => x.segment);
}

/** Las palabras de un nombre, separadas por espacios, sin vacíos. */
export function palabras(nombre: string): string[] {
  return nombre.normalize("NFC").split(/\s+/u).filter(Boolean);
}

/**
 * La inicial: la primera letra o número, en mayúscula con la regla del
 * español ("ñ" es "Ñ", "Álvaro" empieza con "Á"). Se saltean emojis, comillas
 * y signos. Si no hay ninguna letra (un nombre de puros emojis), el primer
 * carácter tal cual; si no hay nada, "?".
 */
export function inicialDe(nombre: string): string {
  const gs = grafemas(nombre.normalize("NFC").trim());
  const g = gs.find((x) => LETRA.test(x)) ?? gs[0];
  return g ? g.toLocaleUpperCase("es") : "?";
}

/** Las cuatro formas de un nombre, del nivel 1 al 4. */
export type Formas = readonly [string, string, string, string];

/**
 * Las cuatro formas de un nombre. Cada una corta por palabras: nunca por el
 * medio de una. Un nombre de una sola palabra tiene la misma forma en varios
 * niveles, y el texto simplemente no cambia.
 */
export function formasDe(nombre: string): Formas {
  const ws = palabras(nombre);
  if (!ws.length) return ["?", "?", "?", "?"];
  const completo = ws.join(" ");
  // El nombre de pila: hasta la primera palabra que tenga una letra (un "🌸"
  // suelto delante se queda con ella).
  let iPila = ws.findIndex((w) => LETRA.test(w));
  if (iPila < 0) iPila = ws.length - 1;
  const pila = ws.slice(0, iPila + 1).join(" ");
  // Con apellido: la inicial de la última palabra que tenga una letra (un "2" suelto,
  // el ordinal de un nombre repetido, no es un apellido), si no es la del nombre.
  let iUlt = ws.length - 1;
  while (iUlt > iPila && !SOLO_LETRA.test(ws[iUlt] as string)) iUlt--;
  const ultima = iUlt > iPila ? ws[iUlt] : undefined;
  const conApellido = ultima ? `${pila} ${inicialDe(ultima)}.` : pila;
  return [inicialDe(nombre), pila, conApellido, completo];
}

const clave = (s: string): string => s.normalize("NFC").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();

export interface PlanNombres {
  n: number;
  /** La inicial de cada uno. */
  inicial: string[];
  /** `formas[i][nivel - 1]`: lo que se escribe de la persona `i` en cada nivel. */
  formas: Formas[];
  /** Cuántos hay con el mismo nombre, hasta él, contando desde 1 (1 si es único). */
  ordinal: number[];
}

/**
 * Arma las formas de toda la lista. Los nombres repetidos reciben un ordinal
 * en los niveles 3 y 4, en el orden de la lista: "Juan Pérez" y "Juan Pérez
 * (2)". El ordinal no depende de quién gana, solo de dónde está cada nombre.
 */
export function planNombres(nombres: readonly string[]): PlanNombres {
  const vistos = new Map<string, number>();
  const total = new Map<string, number>();
  for (const nm of nombres) total.set(clave(nm), (total.get(clave(nm)) ?? 0) + 1);
  const ordinal: number[] = [];
  const formas: Formas[] = nombres.map((nm) => {
    const k = clave(nm);
    const o = (vistos.get(k) ?? 0) + 1;
    vistos.set(k, o);
    ordinal.push(o);
    const f = formasDe(nm);
    if ((total.get(k) ?? 1) <= 1 || o === 1) return f;
    return [f[0], f[1], `${f[2]} (${o})`, `${f[3]} (${o})`] as const;
  });
  return { n: nombres.length, inicial: formas.map((f) => f[0]), formas, ordinal };
}

/**
 * El nivel que le toca a un pelotón de `quedan` personas, solo por cantidad:
 * hasta 8, el nombre entero; hasta 12, nombre e inicial; hasta 20, el nombre
 * de pila; con más, la inicial. No baja nunca cuando queda menos gente.
 */
export function nivelPorCantidad(quedan: number): Nivel {
  if (quedan <= 8) return 4;
  if (quedan <= 12) return 3;
  if (quedan <= 20) return 2;
  return 1;
}

/**
 * Hasta qué nivel entran los nombres de los que siguen en el lugar que tiene
 * cada uno. Se mide con la **mediana** de los anchos de ese nivel en la lista,
 * nunca con el nombre de nadie en particular: un nombre larguísimo no tiene
 * que cambiar el nivel de todos (a ese solo se le achica la letra o se le
 * parte en dos líneas, ver `ajustar`).
 *
 * `ancho(nivel)` devuelve la mediana de lo que mide el texto de ese nivel, en
 * las mismas unidades que `lugar`. Devuelve al menos 1.
 */
export function nivelQueCabe(lugar: number, ancho: (nivel: Nivel) => number): Nivel {
  let mejor: Nivel = 1;
  for (const n of [2, 3, 4] as const) if (ancho(n) <= lugar) mejor = n;
  return mejor;
}

/** El nivel de los que siguen: el que dice la cantidad, sin pasarse de lo que entra en pantalla. */
export function nivelBase(quedan: number, lugar: number, ancho: (nivel: Nivel) => number): Nivel {
  const a = nivelPorCantidad(quedan);
  const b = nivelQueCabe(lugar, ancho);
  return (a < b ? a : b) as Nivel;
}

/**
 * El nivel de cada uno de los que siguen (`vivos`, índices de la lista), todos
 * en `base` salvo los que comparten texto: esos suben de a un nivel, juntos,
 * hasta que se distinguen o llegan al 4. En el nivel 1 no se separa a nadie
 * (la inicial se repite y el emblema los distingue).
 */
export function nivelesDe(plan: PlanNombres, vivos: readonly number[], base: Nivel): Nivel[] {
  const niv: Nivel[] = vivos.map(() => base);
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const grupos = new Map<string, number[]>();
    vivos.forEach((p, k) => {
      const nv = niv[k] as Nivel;
      if (nv < 2) return;
      const txt = clave((plan.formas[p] as Formas)[nv - 1] as string);
      grupos.set(`${nv}|${txt}`, [...(grupos.get(`${nv}|${txt}`) ?? []), k]);
    });
    let subio = false;
    for (const ks of grupos.values()) {
      if (ks.length < 2) continue;
      for (const k of ks) {
        if ((niv[k] as Nivel) < 4) {
          niv[k] = ((niv[k] as number) + 1) as Nivel;
          subio = true;
        }
      }
    }
    if (!subio) break;
  }
  return niv;
}

/* ================================================== entrar en una caja */

export interface Ajuste {
  /** Una o dos líneas, nunca cortadas por el medio de una palabra. */
  lineas: string[];
  /** Cuánto se achica la letra respecto del tamaño normal (1: tal cual). */
  escala: number;
  /** Si hubo que bajar de la escala mínima y partir en el medio (una sola palabra que no entra de ninguna forma). */
  partida: boolean;
}

/**
 * Dónde puede partirse un texto: en los espacios, y después de un guion o un
 * guion bajo. Devuelve los cortes como largos de la primera mitad.
 */
function cortes(texto: string): number[] {
  const gs = grafemas(texto);
  const out: number[] = [];
  let largo = 0;
  gs.forEach((g, i) => {
    largo += g.length;
    const ultimo = i === gs.length - 1;
    if (ultimo) return;
    const sig = gs[i + 1] as string;
    if (g === " ") out.push(largo - 1);
    else if ((g === "_" || g === "-") && sig !== " ") out.push(largo);
  });
  return out;
}

/**
 * Acomoda un texto en una caja de `ancho` sin cortarlo:
 *
 * 1. una línea a la letra normal;
 * 2. una línea achicada hasta `minimo` (la escala más chica que se lee);
 * 3. dos líneas partidas donde se puede, repartidas para que midan casi lo
 *    mismo, a la letra normal y después achicada hasta `minimo`;
 * 4. si ni así entra (una sola palabra más ancha que la caja), la escala que
 *    haga falta hasta la mitad del mínimo, y recién entonces dos líneas por
 *    grafemas completos. Nunca "…".
 *
 * `medir(s)` es el ancho del texto a la letra normal. Se pasa de afuera para
 * probarlo con una medida fija y usarlo con el texto real de PixiJS.
 */
export function ajustar(texto: string, ancho: number, medir: (s: string) => number, minimo = 0.7): Ajuste {
  const t = texto.normalize("NFC").replace(/\s+/gu, " ").trim();
  const w = medir(t);
  if (w <= ancho) return { lineas: [t], escala: 1, partida: false };
  const mejorPartida = (): { lineas: string[]; w: number } | null => {
    let mejor: { lineas: string[]; w: number } | null = null;
    for (const c of cortes(t)) {
      const a = t.slice(0, c).trimEnd();
      const b = t.slice(c).trimStart();
      if (!a || !b) continue;
      const m = Math.max(medir(a), medir(b));
      if (!mejor || m < mejor.w) mejor = { lineas: [a, b], w: m };
    }
    return mejor;
  };
  const dos = mejorPartida();
  // Una línea más chica o dos líneas a la letra normal: lo que menos achique.
  const una = ancho / w;
  if (dos && dos.w <= ancho) {
    // Si una sola línea achicada apenas se nota (más de 0,85) se prefiere a partir.
    return una >= 0.85 ? { lineas: [t], escala: una, partida: false } : { lineas: dos.lineas, escala: 1, partida: false };
  }
  if (una >= minimo) return { lineas: [t], escala: una, partida: false };
  if (dos) {
    const e = Math.min(1, ancho / dos.w);
    if (e >= minimo) return { lineas: dos.lineas, escala: e, partida: false };
  }
  // Una sola palabra interminable: achicar hasta la mitad del mínimo.
  const piso = minimo / 2;
  const e = dos ? Math.min(1, ancho / dos.w) : una;
  if (e >= piso) return { lineas: dos ? dos.lineas : [t], escala: e, partida: false };
  // Último recurso: dos líneas por grafemas enteros, a la escala del piso.
  const gs = grafemas(t);
  const mitad = Math.ceil(gs.length / 2);
  const a = gs.slice(0, mitad).join("");
  const b = gs.slice(mitad).join("");
  const m = Math.max(medir(a), medir(b));
  return { lineas: [a, b], escala: Math.max(piso, Math.min(1, ancho / m)), partida: true };
}

/** La mediana de una lista de números: 0 si está vacía. */
export function mediana(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}
