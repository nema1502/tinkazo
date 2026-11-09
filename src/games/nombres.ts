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
  const p = partesDe(nombre);
  if (!p) return ["?", "?", "?", "?"];
  const conApellido = p.ultima ? `${p.pila} ${inicialDe(p.ultima)}.` : p.pila;
  return [inicialDe(nombre), p.pila, conApellido, p.completo];
}

/** Las piezas de un nombre con las que se arman sus formas. */
interface Partes {
  /** El nombre de pila: hasta la primera palabra que tenga una letra. */
  pila: string;
  /** La última palabra que tenga una letra después del nombre de pila (el último apellido), si hay. */
  ultima: string | undefined;
  /** Lo que viene después del último apellido (un "3" suelto, un emoji): vacío si no hay nada. */
  resto: string;
  completo: string;
}

function partesDe(nombre: string): Partes | null {
  const ws = palabras(nombre);
  if (!ws.length) return null;
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
  return { pila, ultima, resto: ws.slice((ultima ? iUlt : iPila) + 1).join(" "), completo };
}

const clave = (s: string): string => s.normalize("NFC").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();

/** Las letras del apellido desde la primera que es letra o número ("(Mamani)" empieza en la "M"). */
function letrasDe(palabra: string): string[] {
  const gs = grafemas(palabra);
  const i = gs.findIndex((g) => LETRA.test(g));
  return i < 0 ? gs : gs.slice(i);
}

/**
 * El nivel 3 de un nombre en el `paso` que hace falta para no confundirlo con otro. El paso 0 es el de siempre
 * ("Elena C."); cada paso agrega algo que distingue y nunca saca nada:
 *
 * 1. lo que viene después del apellido ("Elena C. 3")
 * 2. las dos primeras letras del apellido ("Elena Co. 3"), después tres, y así
 * 3. el apellido entero ("Elena Condori 3")
 * 4. el nombre entero (con segundos apellidos y todo), que ya no se puede confundir con otro
 */
function conApellidoEn(p: Partes, paso: number): string {
  if (!p.ultima) return paso === 0 ? p.pila : p.completo;
  const resto = p.resto ? ` ${p.resto}` : "";
  if (paso === 0) return `${p.pila} ${inicialDe(p.ultima)}.`;
  if (paso === 1) return `${p.pila} ${inicialDe(p.ultima)}.${resto}`;
  const gs = letrasDe(p.ultima);
  if (paso < gs.length) return `${p.pila} ${((gs[0] as string).toLocaleUpperCase("es") + gs.slice(1, paso).join(""))}.${resto}`;
  if (paso === gs.length) return `${p.pila} ${p.ultima}${resto}`;
  return p.completo;
}

/** El último paso de `conApellidoEn`: el nombre entero. */
const pasoFinal = (p: Partes): number => (p.ultima ? Math.max(2, letrasDe(p.ultima).length + 1) : 1);

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
 * El paso del nivel 3 de cada nombre distinto de la lista que tuvo que subir; los que no aparecen quedan en el 0,
 * el de siempre ("Elena C."). Sube cuando otra persona con otro nombre lo escribiría igual ("Elena Condori" y
 * "Elena Condori 3", "María Pérez" y "María Paz"): los que chocan suben juntos de paso (`conApellidoEn`) hasta
 * distinguirse. Una lista sin choques queda exactamente como estaba.
 */
function pasosDistinguidos(partes: ReadonlyMap<string, Partes>): Map<string, number> {
  const pasos = new Map<string, number>([...partes.keys()].map((k) => [k, 0]));
  const texto = (k: string): string => conApellidoEn(partes.get(k) as Partes, pasos.get(k) as number);
  // Cada vuelta sube un paso a todos los que chocan; el último paso (el nombre entero) no choca nunca, así que termina.
  for (;;) {
    const grupos = new Map<string, string[]>();
    for (const k of partes.keys()) {
      // «Luis Paz» y «Luis Paz.» se leen igual: el punto no los distingue.
      const t = clave(texto(k)).replace(/\./gu, "");
      grupos.set(t, [...(grupos.get(t) ?? []), k]);
    }
    let subio = false;
    for (const ks of grupos.values()) {
      if (ks.length < 2) continue;
      for (const k of ks) {
        const p = pasos.get(k) as number;
        if (p < pasoFinal(partes.get(k) as Partes)) {
          pasos.set(k, p + 1);
          subio = true;
        }
      }
    }
    if (!subio) break;
  }
  return new Map([...pasos].filter(([, p]) => p > 0));
}

/**
 * Arma las formas de toda la lista. Los nombres repetidos reciben un ordinal
 * en los niveles 3 y 4, en el orden de la lista: "Juan Pérez" y "Juan Pérez
 * (2)". El ordinal no depende de quién gana, solo de dónde está cada nombre.
 * Dos nombres distintos que en el nivel 3 se escribirían igual ("Elena C."
 * para "Elena Condori" y "Elena Condori 3") se distinguen ahí mismo.
 */
export function planNombres(nombres: readonly string[]): PlanNombres {
  const vistos = new Map<string, number>();
  const total = new Map<string, number>();
  const partes = new Map<string, Partes>();
  for (const nm of nombres) {
    const k = clave(nm);
    total.set(k, (total.get(k) ?? 0) + 1);
    const p = partesDe(nm);
    if (p && !partes.has(k)) partes.set(k, p);
  }
  const pasos = pasosDistinguidos(partes);
  const ordinal: number[] = [];
  const formas: Formas[] = nombres.map((nm) => {
    const k = clave(nm);
    const o = (vistos.get(k) ?? 0) + 1;
    vistos.set(k, o);
    ordinal.push(o);
    const base = formasDe(nm);
    const paso = pasos.get(k) ?? 0;
    const propias = paso > 0 ? partesDe(nm) : null;
    const f: Formas = propias ? [base[0], base[1], conApellidoEn(propias, paso), base[3]] : base;
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

/* ================================================== sílabas */

/** Los grupos de dos consonantes que en español no se separan: van juntos con la vocal que sigue ("a-bri-go", "Ma-chu"). */
const GRUPO_INSEPARABLE = new Set(["bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "kl", "kr", "pl", "pr", "tr", "ch", "ll", "rr", "sh", "ph", "th"]);
const SOLO_LETRAS = /^\p{L}+$/u;
/** Una vocal "fuerte": a, e, o, o una i o u con tilde. Dos fuertes juntas son un hiato y se separan; con una débil (i, u) sin tilde forman diptongo. */
function vocal(c: string): "fuerte" | "debil" | null {
  const d = c.normalize("NFD");
  const b = d[0]?.toLowerCase() ?? "";
  if (!"aeiou".includes(b)) return null;
  if ("aeo".includes(b)) return "fuerte";
  // i o u: débil, salvo con tilde (í, ú). La diéresis (ü) no la vuelve fuerte.
  return d.includes(String.fromCharCode(0x301)) ? "fuerte" : "debil";
}

/**
 * Las sílabas de una palabra con la partición simple del español: una consonante entre dos vocales va con la segunda
 * ("ma-ri-a"), dos consonantes se reparten ("ban-co") salvo los grupos que no se separan ("a-bri-go", "Ma-chu"), los
 * diptongos no se rompen ("Ju-lio") y los hiatos sí ("Ma-rí-a"). Una sílaba no queda con una sola letra al principio ni al
 * final de la palabra ("a-mi-go" se parte "ami-go", no "a-migo"). Devuelve las sílabas con las mismas letras, en orden; una
 * palabra con algo que no es una letra (un número, un emoji) o sin vocales no se parte: `[palabra]`.
 */
export function silabas(palabra: string): string[] {
  const cs = Array.from(palabra.normalize("NFC"));
  if (cs.length < 4 || !SOLO_LETRAS.test(palabra)) return [palabra];
  // Los núcleos: rachas de vocales, separadas donde hay hiato.
  const nucleos: Array<[number, number]> = [];
  for (let i = 0; i < cs.length; i++) {
    const v = vocal(cs[i] as string);
    if (!v) continue;
    const ult = nucleos[nucleos.length - 1];
    const prev = ult && ult[1] === i ? vocal(cs[i - 1] as string) : null;
    if (ult && prev && !(prev === "fuerte" && v === "fuerte")) ult[1] = i + 1;
    else nucleos.push([i, i + 1]);
  }
  const cortes: number[] = [];
  for (let n = 1; n < nucleos.length; n++) {
    const fin = (nucleos[n - 1] as [number, number])[1];
    const ini = (nucleos[n] as [number, number])[0];
    const largo = ini - fin;
    const par = largo >= 2 ? (cs[ini - 2] as string).toLowerCase() + (cs[ini - 1] as string).toLowerCase() : "";
    // A la derecha del corte va una consonante, o las dos si forman un grupo que no se separa.
    const derecha = Math.min(largo, GRUPO_INSEPARABLE.has(par) ? 2 : 1);
    cortes.push(ini - derecha);
  }
  // Sin sílabas de una sola letra en las puntas.
  const validos = cortes.filter((c) => c >= 2 && cs.length - c >= 2);
  const out: string[] = [];
  let desde = 0;
  for (const c of validos) {
    out.push(cs.slice(desde, c).join(""));
    desde = c;
  }
  out.push(cs.slice(desde).join(""));
  return out;
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

/**
 * Una palabra en renglones de a lo sumo `ancho`, cortada entre sílabas y con un guion al final de cada renglón menos el
 * último; los renglones salen parejos («Maxi- / miliano», no «Maximilia- / no»). `null` si ni la primera sílaba con su guion
 * entra. `medir(s)` es el ancho del texto a la letra que se va a dibujar.
 */
function partirPorSilabas(sil: readonly string[], ancho: number, medir: (s: string) => number): string[] | null {
  const n = sil.length;
  const voraz = (w: number): string[] | null => {
    const out: string[] = [];
    let i = 0;
    while (i < n) {
      const resto = sil.slice(i).join("");
      if (medir(resto) <= w) {
        out.push(resto);
        return out;
      }
      let k = n - 1;
      while (k > i && medir(`${sil.slice(i, k).join("")}-`) > w) k--;
      if (k <= i) return null;
      out.push(`${sil.slice(i, k).join("")}-`);
      i = k;
    }
    return out;
  };
  const base = voraz(ancho);
  if (!base) return null;
  // La misma cantidad de renglones, lo más angostos que se pueda: así ninguno queda con una sílaba suelta.
  let mejor = base;
  let lo = 0;
  let hi = ancho;
  for (let v = 0; v < 14; v++) {
    const mid = (lo + hi) / 2;
    const r = voraz(mid);
    if (r && r.length <= base.length) {
      mejor = r;
      hi = mid;
    } else lo = mid;
  }
  return mejor;
}

/**
 * El texto en renglones de a lo sumo `ancho`, partidos donde se puede: en los espacios y después de un guion o un guion
 * bajo. Una palabra más ancha que la caja se parte por letras enteras (nunca por el medio de una letra con tilde o de un
 * emoji) y nunca termina en «…». Es para el cartel de quien gana con un nombre larguísimo, que tiene que leerse entero a
 * la letra de la regla: `ajustar` parte en dos y, cuando no alcanza, achica hasta que no se lee.
 * `medir(s)` es el ancho del texto a la letra que se va a dibujar.
 */
export function envolver(texto: string, ancho: number, medir: (s: string) => number): string[] {
  return envolverConAviso(texto, ancho, medir).lineas;
}

/**
 * Como `envolver`, y además dice si tuvo que partir una palabra (`partioPalabra`): quien elige entre
 * varias escalas y varios renglones prefiere siempre la que no parte ninguna («Daniel / a Cruz» se lee mal, y a
 * una letra menos y dos renglones se lee entero). Con `conSilabas`, una palabra más ancha que la caja se parte por
 * sílabas y con guion visible («Maxi- / miliano»); solo si ni una sílaba con su guion entra, por letras enteras.
 */
export function envolverConAviso(
  texto: string,
  ancho: number,
  medir: (s: string) => number,
  conSilabas = false,
): { lineas: string[]; partioPalabra: boolean } {
  const t = texto.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!t) return { lineas: [""], partioPalabra: false };
  let partioPalabra = false;
  // Trozos: cada palabra se parte después de un guion o de un guion bajo ("Maximiliano_", "Alexander_"); el primer trozo de
  // cada palabra, menos la primera, va después de un espacio.
  const trozos: { s: string; espacio: boolean }[] = [];
  t.split(" ").forEach((p, i) => {
    (p.match(/[^_-]*[_-]|[^_-]+/gu) ?? [p]).forEach((trozo, j) => trozos.push({ s: trozo, espacio: i > 0 && j === 0 }));
  });
  const lineas: string[] = [];
  /** Una palabra más ancha que la caja se parte (por sílabas con guion si se pide; si no, o si ni una sílaba entra, por letras enteras); devuelve lo que queda sin partir. */
  const partir = (palabra: string): string => {
    let resto = palabra;
    if (conSilabas && medir(resto) > ancho) {
      const ls = partirPorSilabas(silabas(resto), ancho, medir);
      if (ls) {
        partioPalabra = true;
        lineas.push(...ls.slice(0, -1));
        resto = ls[ls.length - 1] as string;
      }
    }
    while (medir(resto) > ancho) {
      const gs = grafemas(resto);
      if (gs.length < 2) break;
      partioPalabra = true;
      let n = gs.length - 1;
      while (n > 1 && medir(gs.slice(0, n).join("")) > ancho) n--;
      lineas.push(gs.slice(0, n).join(""));
      resto = gs.slice(n).join("");
    }
    return resto;
  };
  let actual = "";
  for (const { s: trozo, espacio } of trozos) {
    if (!actual) {
      actual = partir(trozo);
      continue;
    }
    const candidata = espacio ? `${actual} ${trozo}` : actual + trozo;
    if (medir(candidata) <= ancho) actual = candidata;
    else {
      lineas.push(actual);
      actual = partir(trozo);
    }
  }
  lineas.push(actual);
  return { lineas, partioPalabra };
}

/**
 * Como `ajustar`, para un cartel que puede crecer hacia abajo (el de quien gana): el nombre entero en los renglones que
 * hagan falta, a la letra más grande que se pueda y **nunca bajo `piso`** (la regla de la sala: `letraMinima / talla`).
 * Prefiere, en este orden, a la escala 1 un renglón, uno achicado a 0,85 (apenas se nota), dos renglones, tres, y recién
 * después achica de a poco hasta `piso`. Recorre todo eso sin partir una palabra; solo si una palabra es más ancha que la
 * caja a la escala mínima, la parte a esa escala por sílabas y con guion visible («Maxi- / miliano»). Nunca «…».
 * Con `maxLineas` (por defecto 4) no usa más renglones que esos: si ni a `piso` entra, devuelve lo que sale a `piso`
 * (con más renglones que `maxLineas`) y `partida: true`, para que quien llama elija otra forma (un nombre más corto).
 * `medir(s)` es el ancho del texto a la letra normal (escala 1).
 */
export function ajustarEnRenglones(texto: string, ancho: number, medir: (s: string) => number, piso = 0.6, maxLineas = 4): Ajuste {
  const t = texto.normalize("NFC").replace(/\s+/gu, " ").trim();
  const p = Math.min(1, Math.max(0.05, piso));
  const todos: ReadonlyArray<readonly [number, number]> = [[1, 1], [0.85, 1], [1, 2], [0.85, 2], [0.7, 2], [1, 3], [0.7, 3], [p, 3], [p, 4]];
  const orden = [...todos.filter(([, m]) => m < maxLineas), [p, maxLineas] as const];
  // Primero todas las combinaciones, sin partir ninguna palabra: una letra menos y dos renglones antes que «Rodrig / o Peña».
  for (const [e0, maximo] of orden) {
    const e = Math.min(1, Math.max(p, e0));
    const { lineas, partioPalabra } = envolverConAviso(t, ancho / e, medir);
    if (lineas.length <= maximo && !partioPalabra) return { lineas, escala: e, partida: false };
  }
  // Una palabra no entra ni a la escala del piso: se parte al piso, por sílaba y con guion («Maxi- / miliano Paz»), nunca a
  // mitad de sílaba ni a una letra más grande que la regla (`partida: true`, para que quien llama pruebe otra forma si puede).
  return { lineas: envolverConAviso(t, ancho / p, medir, true).lineas, escala: p, partida: true };
}

/**
 * Dónde va la cara del cartel de quien gana y cómo se escribe su nombre, en una pantalla angosta (un celular parado). Con la
 * cara al costado el nombre tiene `alLado` de ancho; con la cara arriba, con «GANA», `arriba` (unos 100 px más). Se queda al
 * costado, como siempre, si el nombre entra bien (a una letra de 0,7 o más y sin partir una palabra); si no, y solo si arriba
 * se lee mejor (letra más grande, o ninguna palabra partida), la cara se va arriba. `puedeArriba` es falso en horizontal, donde
 * sobra ancho. Con `medir(s)` el ancho del texto a la letra normal, igual que `ajustarEnRenglones`.
 */
export function acomodarGanador(
  nombre: string,
  alLado: number,
  arriba: number,
  medir: (s: string) => number,
  piso: number,
  puedeArriba: boolean,
): { caraArriba: boolean; ajuste: Ajuste } {
  const lateral = ajustarEnRenglones(nombre, alLado, medir, piso);
  if (puedeArriba && (lateral.partida || lateral.escala < 0.7)) {
    const alto = ajustarEnRenglones(nombre, arriba, medir, piso);
    if (alto.escala > lateral.escala + 1e-6 || (lateral.partida && !alto.partida)) return { caraArriba: true, ajuste: alto };
  }
  return { caraArriba: false, ajuste: lateral };
}

/**
 * La forma más larga de un nombre que entra en `ancho` **sin achicar la letra** (regla de letra, 26 de octubre de
 * 2026): el nombre entero, "María Q.", el de pila y, si ni eso, la inicial. Donde el nombre no entra a la letra de
 * la regla (un celular, un gajo angosto), un juego muestra menos del nombre y no un nombre chico. Cada forma corta
 * por palabras, nunca por el medio de una (`formasDe`). `medir(s)` es el ancho del texto a la letra que se va a dibujar.
 */
export function formaQueEntra(nombre: string, ancho: number, medir: (s: string) => number): string {
  const f = formasDe(nombre);
  for (const nivel of [3, 2, 1] as const) {
    const forma = f[nivel];
    if (medir(forma) <= ancho) return forma;
  }
  return f[0];
}

/** La mediana de una lista de números: 0 si está vacía. */
export function mediana(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}
