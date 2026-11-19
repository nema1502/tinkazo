/**
 * El plan de la lista de ganadores de la foto del juego: dónde va cada cosa y con qué letra, para cualquier cantidad de
 * ganadores y de renglones, sin dibujar nada. Recibe una función que mide texto (`foto.ts` le pasa la del lienzo, las
 * pruebas una fija) y devuelve cajas y textos con sus coordenadas en la foto de 1080 por 1350. Así lo que importa (nada
 * pisa la ventana del arte ni la tarjeta del QR, ningún nombre se corta, la letra de los nombres es la más grande del
 * medio) se prueba sin lienzo.
 *
 * Tres arreglos, y ninguno sube de `GEO.FRANJA_ARRIBA` (la ventana del arte queda libre siempre):
 *
 * - A: la lista en la columna de la izquierda, encima de "Escaneá", que sigue abajo a la izquierda. Para listas cortas.
 * - B: la lista en la columna, que puede bajar hasta el pie de la tarjeta del QR, y "Escaneá" con la calcomanía de
 *   tinkazo.app en un panel arriba de la tarjeta del QR. A la izquierda queda el resultado y a la derecha cómo comprobarlo.
 * - N: sin QR (la tarjeta de abajo ocupa todo el ancho): la lista en la franja de lado a lado, en una o dos columnas.
 *
 * Todos los nombres, si entran con letra de 36 o más. Si no, los primeros con letra de 40, "y N más" (N de dos o más: nunca
 * "y 1 más") y la frase que dice dónde está la lista completa. Un nombre nunca se recorta: se parte en renglones por
 * palabras, hasta tres. Una palabra que no entra sola en un renglón se parte primero donde la propia palabra lo pide
 * (después de un guion, un punto o un guion bajo, y antes de una arroba) y, solo si un tramo sigue sin entrar, por letras
 * con un guion a la vista. Solo si ni así entra en tres renglones (una tira de más de unas cuarenta y cinco letras, que no es
 * un nombre) lleva "…" al final del tercero.
 *
 * El premio tampoco se corta: la letra baja de 34 a 28 y, si hace falta, pasa de tres renglones a cuatro, antes de recortar
 * nada. Solo un texto que el campo del premio no admite (más de unas ochenta letras) lleva "…", y el plan lo dice en `recorta`.
 *
 * No importa `i18n.ts`: los textos llegan ya traducidos.
 */

/** La geometría de la foto de 1080 por 1350. La usan este plan y `foto.ts`. */
export const GEO = (() => {
  const W = 1080;
  const H = 1350;
  const M = 84;
  const QR_LADO = 452;
  const QR_X = W - M - QR_LADO;
  const QR_Y = H - 16 - 66 - QR_LADO;
  const SIN_QR_ALTO = 300;
  const ARTE_ABAJO = 540;
  return {
    W,
    H,
    M,
    QR_LADO,
    QR_X,
    QR_Y,
    SIN_QR_ALTO,
    SIN_QR_Y: H - 16 - 66 - SIN_QR_ALTO,
    /** La ventana del arte: lo principal de cada dibujo vive entre estas dos alturas. */
    ARTE_ARRIBA: 236,
    ARTE_ABAJO,
    /** Desde acá puede ir un panel del medio. La franja del medio llega hasta `FRANJA_ABAJO`, 16 px antes de la tarjeta del QR. */
    FRANJA_ARRIBA: ARTE_ABAJO + 16,
    FRANJA_ABAJO: QR_Y - 16,
    /** El aire de un panel arriba y abajo de su texto, y a los lados. */
    AIRE: 20,
    LADO: 28,
    /** La columna de la izquierda: el panel va de `LISTA_X` hasta 16 px antes de la tarjeta del QR. */
    LISTA_X: M - 28,
    COLUMNA_PANEL: QR_X - 16 - (M - 28),
    COLUMNA_TEXTO: QR_X - 16 - (M - 28) - 56,
    /** El pie de la tarjeta del QR: hasta ahí llega la columna en el arreglo B. */
    PIE: QR_Y + QR_LADO,
  } as const;
})();

export type Peso = 600 | 700 | 800 | 900 | "mono";
/** El ancho de un texto en píxeles, con ese peso y ese tamaño de letra. */
export type Medida = (peso: Peso, tam: number, texto: string) => number;
export type Color = "crema" | "apagado" | "amarillo" | "magenta";

export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Un renglón de texto: `y` es la línea de base, `caja` el renglón entero, con su alto. */
export interface Texto {
  t: string;
  x: number;
  y: number;
  tam: number;
  peso: Peso;
  color: Color;
  derecha?: boolean;
  caja: Caja;
}

export interface FilaPlan {
  /** La posición en la lista, de 0 en adelante: la de su cara y su número. */
  k: number;
  caja: Caja;
  /** La cara, sin la sombra ni el giro. */
  cara: Caja;
  nombre: Texto[];
  numero: Texto;
}

export interface EscanearPlan {
  panel: Caja;
  texto: Texto[];
  /** La calcomanía de tinkazo.app: dónde va y con qué letra. */
  dominio: { x: number; y: number; w: number; h: number; tam: number };
}

export interface PlanLista {
  arreglo: "A" | "B" | "N";
  /** La letra de los nombres. */
  letra: number;
  total: number;
  vistos: number;
  faltan: number;
  panel: Caja;
  titulo: Texto;
  filas: FilaPlan[];
  mas: Texto | null;
  frase: Texto[];
  cola: Texto[];
  /** Solo en B: "Escaneá" arriba de la tarjeta del QR. */
  escanear: EscanearPlan | null;
  /** Algo de la cola, o un nombre larguísimo, quedó recortado con "…". */
  recorta: boolean;
}

export interface EntradaLista {
  medir: Medida;
  /** "Ganaron" o "Orden de turnos". */
  titulo: string;
  /** Lo que se muestra por renglón: quien salió más de una vez lleva su cuenta («Ana (2 veces)»). */
  nombres: string[];
  /** El número de cada renglón: «#1» o, con quien salió más de una vez, «#1 #3». Sin él, la posición. */
  numeros?: readonly string[] | undefined;
  /** El premio y entre cuántos, debajo de los nombres. */
  lineas: string[];
  /** «y {n} más». */
  mas: string;
  /** Dónde está la lista completa («La lista completa está en el QR.»). Vacía, sin frase. */
  frase: string;
  /** «Escaneá para comprobarlo». */
  escanear: string;
  /** Si la foto lleva QR. */
  conQr: boolean;
  /** El alto útil de la columna encima de «Escaneá» abajo a la izquierda (arreglo A), o 0 si ahí no entra nada. */
  altoA: number;
}

/* ------------------------------------------------------------- medir, con memoria */

interface Medidor {
  (peso: Peso, tam: number, texto: string): number;
}

/** Las mismas medidas se piden muchas veces (cada tamaño de letra, cada cantidad de nombres): se guardan. */
function medidor(medir: Medida): Medidor {
  const guardado = new Map<string, number>();
  return (peso, tam, texto) => {
    const clave = `${peso}|${tam}|${texto}`;
    let w = guardado.get(clave);
    if (w === undefined) {
      w = medir(peso, tam, texto);
      guardado.set(clave, w);
    }
    return w;
  };
}

/* ------------------------------------------------------------- partir texto */

/** Donde una palabra puede partirse sin letras sueltas: después de un guion, un punto, un guion bajo o una barra, y antes de una arroba. */
const PUNTOS_DE_CORTE = /(?<=[-._/])|(?=@)/;

/** «Ana (2 veces)» no se parte dentro de la cuenta: sus dos últimas palabras van juntas. */
function palabrasDe(texto: string): string[] {
  const p = texto.split(/\s+/).filter(Boolean);
  const n = p.length;
  if (n >= 3 && /^\(\S+$/.test(p[n - 2] ?? "") && /^\S+\)$/.test(p[n - 1] ?? "")) return [...p.slice(0, n - 2), `${p[n - 2]} ${p[n - 1]}`];
  return p;
}

/**
 * Parte el texto en renglones de `w`. Etapa 0: solo entre palabras (null si una palabra no entra sola). Etapa 1: también
 * en los puntos de corte de una palabra. Etapa 2: también por letras, con un guion al final de cada tramo.
 */
function partir(m: Medidor, peso: Peso, tam: number, texto: string, w: number, etapa: 0 | 1 | 2): string[] | null {
  const ancho = (t: string): number => m(peso, tam, t);
  const lineas: string[] = [];
  let actual = "";
  const cerrar = (): void => {
    if (actual) lineas.push(actual);
    actual = "";
  };
  for (const palabra of palabrasDe(texto)) {
    const junto = actual ? `${actual} ${palabra}` : palabra;
    if (ancho(junto) <= w) {
      actual = junto;
      continue;
    }
    cerrar();
    if (ancho(palabra) <= w) {
      actual = palabra;
      continue;
    }
    if (etapa < 1) return null;
    for (const trozo of palabra.split(PUNTOS_DE_CORTE).filter(Boolean)) {
      if (ancho(actual + trozo) <= w) {
        actual += trozo;
        continue;
      }
      cerrar();
      if (ancho(trozo) <= w) {
        actual = trozo;
        continue;
      }
      if (etapa < 2) return null;
      let tramo = "";
      for (const letra of Array.from(trozo)) {
        if (tramo && ancho(`${tramo}${letra}-`) > w) {
          lineas.push(`${tramo}-`);
          tramo = letra;
        } else tramo += letra;
      }
      actual = tramo;
    }
  }
  cerrar();
  return lineas;
}

/** Recorta con "…" lo que no entre en `w`. */
function recortarTexto(m: Medidor, peso: Peso, tam: number, texto: string, w: number): string {
  if (m(peso, tam, texto) <= w) return texto;
  const letras = Array.from(texto);
  while (letras.length > 1 && m(peso, tam, `${letras.join("")}…`) > w) letras.pop();
  return `${letras.join("")}…`;
}

/** Como mucho `max` renglones: lo que sobra se junta en el último y se recorta. */
function recortarRenglones(m: Medidor, peso: Peso, tam: number, lineas: string[], w: number, max: number): { lineas: string[]; recorta: boolean } {
  if (lineas.length <= max) return { lineas, recorta: false };
  const resto = lineas.slice(max - 1).join(" ");
  return { lineas: [...lineas.slice(0, max - 1), recortarTexto(m, peso, tam, resto, w)], recorta: true };
}

/** La letra más chica de los nombres. Una palabra solo se parte por letras con esta: antes, la letra baja hasta que entre. */
const LETRA_MINIMA = 36;

/**
 * Los renglones de un nombre, en como mucho `max`: con palabras enteras si se puede, si no partiendo la palabra donde ella
 * lo pide y, último, por letras, y eso solo con la letra más chica. Null si ni así entra. Con `forzar`, siempre devuelve
 * algo: lo que no entra en `max` renglones se recorta con "…".
 */
function renglonesDeNombre(m: Medidor, F: number, nombre: string, w: number, max: number, forzar: boolean): { lineas: string[]; recorta: boolean } | null {
  for (const etapa of [0, 1, 2] as const) {
    if (etapa === 2 && F > LETRA_MINIMA) break;
    const l = partir(m, 900, F, nombre, w, etapa);
    if (l && l.length <= max) return { lineas: l, recorta: false };
  }
  if (!forzar) return null;
  // Lo último: por letras con cualquier letra (solo lo pide `forzar`, que ya baja a la más chica).
  return recortarRenglones(m, 900, F, partir(m, 900, F, nombre, w, 2) ?? [nombre], w, max);
}

/** Renglones del mismo largo, hasta donde se pueda: el corte que deja más corto el renglón más largo. */
function partirParejo(m: Medidor, peso: Peso, tam: number, texto: string, w: number): string[] {
  const codo = partir(m, peso, tam, texto, w, 2) ?? [texto];
  const n = codo.length;
  if (n <= 1) return codo;
  const palabras = palabrasDe(texto);
  const ancho = (i: number, j: number): number => m(peso, tam, palabras.slice(i, j).join(" "));
  const memo = new Map<string, { peor: number; cortes: number[] }>();
  const mejor = (i: number, k: number): { peor: number; cortes: number[] } => {
    const clave = `${i}|${k}`;
    const hay = memo.get(clave);
    if (hay) return hay;
    let res: { peor: number; cortes: number[] };
    if (k === 1) res = { peor: ancho(i, palabras.length), cortes: [palabras.length] };
    else {
      res = { peor: Infinity, cortes: [] };
      for (let j = i + 1; j <= palabras.length - (k - 1); j++) {
        const resto = mejor(j, k - 1);
        const peor = Math.max(ancho(i, j), resto.peor);
        if (peor < res.peor) res = { peor, cortes: [j, ...resto.cortes] };
      }
    }
    memo.set(clave, res);
    return res;
  };
  const { peor, cortes } = mejor(0, n);
  if (peor > w || cortes.length !== n) return codo;
  const lineas: string[] = [];
  let desde = 0;
  for (const hasta of cortes) {
    lineas.push(palabras.slice(desde, hasta).join(" "));
    desde = hasta;
  }
  return lineas;
}

/* ------------------------------------------------------------- el bloque */

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** Las medidas de una fila con la letra F de los nombres. */
function medidas(F: number): { L: number; hueco: number; lh: number; Fn: number; entre: number; sep: number } {
  return { L: Math.round(1.25 * F), hueco: Math.round(0.4 * F), lh: Math.round(1.12 * F), Fn: Math.round(0.75 * F), entre: Math.round(0.3 * F), sep: Math.round(0.3 * F) };
}

interface FilaCalc {
  lineas: string[];
  alto: number;
  /** Lo que ocupa su texto (los renglones del nombre y, si va debajo, el número). */
  pila: number;
  ancho: number;
  recorta: boolean;
}

interface Pieza {
  lineas: string[];
  peso: Peso;
  tam: number;
  color: Color;
  paso: number;
  recorta: boolean;
}

interface Bloque {
  F: number;
  K: number;
  w: number;
  cols: 1 | 2;
  anchoTodo: number;
  d: ReturnType<typeof medidas>;
  tamTitulo: number;
  altoTitulo: number;
  filas: FilaCalc[];
  /** La letra de los números, el ancho del más ancho y, si van debajo del nombre, el alto que ocupan. */
  Fn: number;
  numW: number;
  numAbajo: number;
  altoFilas: number;
  faltan: number;
  Fm: number;
  Fq: number;
  frase: string[];
  cola: Pieza[];
  alto: number;
}

interface Opc {
  F: number;
  K: number;
  w: number;
  cols: 1 | 2;
  anchoTodo: number;
  /** Cuántos renglones, como mucho, puede tener un nombre. */
  maxL: number;
  /** Lo último que se prueba: lo que no entra de un nombre se recorta con "…". */
  forzar?: boolean;
  /** Cómo va la cola (el premio y entre cuántos). Sin decir, la de siempre. */
  cola?: ColaModo;
}

/**
 * Cómo se arma la cola. `normal`: la letra más grande en la que cada línea entra entera. `baja`: la letra más chica (28) con
 * los renglones que lleve, para ganar alto sin cortar nada. `compacta`: un renglón por línea, con lo que no entre recortado
 * con "…" (lo último de todo).
 */
type ColaModo = "normal" | "baja" | "compacta";

/**
 * La letra y los renglones que se prueban para una línea de la cola, de lo más grande a lo más chico. El premio, que el
 * campo admite de hasta 60 letras más su rótulo, baja de 34 hasta 28 en tres renglones y, si ni así entra, usa un cuarto
 * renglón. El resto de las líneas son de 28 y pasan de dos a cuatro renglones. Ninguna letra pasa de 34 ni baja de 28: los
 * nombres, de 36 o más, siguen siendo lo más grande del medio.
 */
const LETRAS_DEL_PREMIO: ReadonlyArray<readonly [tam: number, renglones: number]> = [[34, 3], [32, 3], [30, 3], [28, 3], [34, 4], [32, 4], [30, 4], [28, 4]];
const LETRAS_DE_LA_LINEA: ReadonlyArray<readonly [tam: number, renglones: number]> = [[28, 2], [28, 3], [28, 4]];
const LETRA_MAS_CHICA: ReadonlyArray<readonly [tam: number, renglones: number]> = [[28, 4]];

/**
 * La cola: el premio (el primero, si hay más de uno) en crema y grande, el resto apagado. Cada línea busca, de lo más grande
 * a lo más chico, la primera letra y cantidad de renglones con la que entra entera: primero partiendo solo entre palabras,
 * después también donde una palabra larga lo pide (un guion, un punto) y, último, por letras. Solo si ni con la letra más
 * chica y el último renglón entra (un texto de más de unas ochenta letras, que el campo del premio no admite), lo que sobra
 * se recorta con "…" y el plan lo dice en `recorta`. Con `baja` se prueba solo la letra más chica, y con `compacta`, que es
 * lo último que se prueba, va un renglón por línea.
 */
function colaDe(m: Medidor, lineas: string[], w: number, modo: ColaModo): Pieza[] {
  const piezas = lineas.filter(Boolean);
  return piezas.map((texto, i) => {
    const premio = i === 0 && piezas.length > 1;
    const peso: Peso = premio ? 700 : 600;
    const color: Color = premio ? "crema" : "apagado";
    const hecha = (tam: number, l: string[], recorta: boolean): Pieza => ({ lineas: l, peso, tam, color, paso: Math.round(tam * 1.3), recorta });
    if (modo === "compacta") {
      const tam = premio ? 34 : 28;
      const r = recortarRenglones(m, peso, tam, partir(m, peso, tam, texto, w, 2) ?? [texto], w, 1);
      return hecha(tam, r.lineas, r.recorta);
    }
    const opciones = modo === "baja" ? LETRA_MAS_CHICA : premio ? LETRAS_DEL_PREMIO : LETRAS_DE_LA_LINEA;
    for (const etapa of [0, 1, 2] as const)
      for (const [tam, max] of opciones) {
        const l = partir(m, peso, tam, texto, w, etapa);
        if (l && l.length <= max) return hecha(tam, l, false);
      }
    const [tam, max] = opciones[opciones.length - 1] as (typeof opciones)[number];
    const r = recortarRenglones(m, peso, tam, partir(m, peso, tam, texto, w, 2) ?? [texto], w, max);
    return hecha(tam, r.lineas, r.recorta);
  });
}

function bloque(e: EntradaLista, m: Medidor, o: Opc): Bloque | null {
  const total = e.nombres.length;
  const { F, K } = o;
  const d = medidas(F);
  const numeros = Array.from({ length: K }, (_, k) => e.numeros?.[k] ?? `#${k + 1}`);
  // El número, a la derecha del nombre. Si el más ancho ocupara más de un 30 % de lo que queda junto a la cara (quien salió
  // varias veces: «#3 #6 #9»), la letra de los números baja a 0,6 de la de los nombres, y si ni así, van debajo del nombre.
  const junto = o.w - d.L - d.hueco;
  const anchoNum = (tam: number): number => Math.ceil(Math.max(0, ...numeros.map((n) => m("mono", tam, n))));
  let Fn = d.Fn;
  let numW = anchoNum(Fn);
  let numAbajo = 0;
  if (numW > 0.3 * junto) {
    Fn = Math.round(0.6 * F);
    numW = anchoNum(Fn);
    if (numW > 0.3 * junto) numAbajo = Math.round(Fn * 1.2);
  }
  const libre = o.w - d.L - d.hueco - (numAbajo ? 0 : d.hueco + numW);
  if (libre < 3 * F) return null;
  const filas: FilaCalc[] = [];
  for (let k = 0; k < K; k++) {
    const r = renglonesDeNombre(m, F, e.nombres[k] ?? "", libre, o.maxL, !!o.forzar);
    if (!r) return null;
    const pila = r.lineas.length * d.lh + numAbajo;
    filas.push({ lineas: r.lineas, alto: Math.max(d.L, pila), pila, ancho: Math.max(0, ...r.lineas.map((l) => m(900, F, l))), recorta: r.recorta });
  }
  const porColumna = Math.ceil(K / o.cols);
  let altoFilas = 0;
  for (let c = 0; c < o.cols; c++) {
    const col = filas.slice(c * porColumna, (c + 1) * porColumna);
    altoFilas = Math.max(altoFilas, col.reduce((n, f) => n + f.alto, 0) + d.entre * Math.max(0, col.length - 1));
  }
  // El título, más chico que los nombres.
  let tamTitulo = clamp(Math.round(0.75 * F), 30, 40);
  while (tamTitulo > 22 && m(900, tamTitulo, e.titulo) > o.w) tamTitulo -= 2;
  const altoTitulo = Math.round(tamTitulo * 1.2);
  const faltan = total - K;
  const Fm = Math.max(34, Math.round(0.85 * F));
  const Fq = Math.max(32, Math.round(0.75 * F));
  let frase: string[] = [];
  if (faltan > 0 && e.frase) frase = recortarRenglones(m, 800, Fq, partirParejo(m, 800, Fq, e.frase, o.anchoTodo), o.anchoTodo, 3).lineas;
  const cola = colaDe(m, e.lineas, o.anchoTodo, o.cola ?? "normal");
  let alto = altoTitulo + d.sep + altoFilas;
  if (faltan > 0) alto += d.sep + Math.round(Fm * 1.15) + (frase.length ? 6 + frase.length * Math.round(Fq * 1.2) : 0);
  if (cola.length) alto += d.sep + cola.reduce((n, p) => n + p.lineas.length * p.paso, 0);
  return { F, K, w: o.w, cols: o.cols, anchoTodo: o.anchoTodo, d, tamTitulo, altoTitulo, filas, Fn, numW, numAbajo, altoFilas, faltan, Fm, Fq, frase, cola, alto };
}

/** Si 36 de letra deja lugar para todos los nombres en ese alto; si no, ni se prueba (con 300 nombres, no se miden). */
function podrianEntrar(total: number, h: number, cols: number): boolean {
  const d = medidas(LETRA_MINIMA);
  return (total / cols) * d.L + d.entre * (Math.ceil(total / cols) - 1) <= h;
}

/** Todos los nombres: los menos renglones por nombre y, dentro de eso, la letra más grande en la que el bloque entra. */
function todos(e: EntradaLista, m: Medidor, base: Omit<Opc, "F" | "K" | "maxL">, h: number): Bloque | null {
  const total = e.nombres.length;
  if (!podrianEntrar(total, h, base.cols)) return null;
  for (const maxL of [1, 2, 3]) {
    for (let F = 56; F >= LETRA_MINIMA; F -= 2) {
      const b = bloque(e, m, { ...base, F, K: total, maxL });
      if (b && b.alto <= h) return b;
    }
  }
  return null;
}

/**
 * Los primeros, con letra de 40: los que entren de modo que falten dos o más, con "y N más" y la frase. Si un nombre de los
 * que se ven no entra en tres renglones con 40, toda la lista baja a 38 y después a 36.
 */
function primeros(e: EntradaLista, m: Medidor, base: Omit<Opc, "F" | "K" | "maxL">, h: number): Bloque {
  const total = e.nombres.length;
  // Con la cola de siempre y, si ni un solo nombre entra con ella (un premio largo en poco alto), con la letra más chica:
  // el premio nunca se corta mientras haya otra forma de que entre.
  for (const cola of ["normal", "baja"] as const) {
    let mejor: Bloque | null = null;
    for (const F of [40, 38, LETRA_MINIMA]) {
      let ultimo: Bloque | null = null;
      let porAlto = false;
      for (let K = 1; K <= total - 2; K++) {
        const b = bloque(e, m, { ...base, F, K, maxL: 3, cola });
        if (!b) break;
        if (b.alto > h) {
          porAlto = true;
          break;
        }
        ultimo = b;
      }
      if (ultimo && (!mejor || ultimo.K > mejor.K)) mejor = ultimo;
      // Se paró por el alto: son los que entran con esta letra. Se paró por un nombre que no entra: otra letra.
      if (ultimo && porAlto) return ultimo;
    }
    if (mejor) return mejor;
  }
  // Ni uno solo entró de la forma elegida (un nombre que no se puede partir): con la letra más chica y lo que no entre de un
  // nombre recortado con "…", todos los que entren (hasta doce, nunca "y 1 más"). Primero con la cola de siempre, después
  // con la letra más chica y, si ni un nombre entra (un texto larguísimo), con la cola en un renglón por línea.
  for (const cola of ["normal", "baja", "compacta"] as const) {
    for (let K = Math.min(total, 12); K >= 1; K--) {
      if (K === total - 1) continue;
      const b = bloque(e, m, { ...base, F: LETRA_MINIMA, K, maxL: 3, forzar: true, cola });
      if (b && b.alto <= h) return b;
    }
  }
  return bloque(e, m, { ...base, F: LETRA_MINIMA, K: 1, maxL: 3, forzar: true, cola: "compacta" }) as Bloque;
}

/* ------------------------------------------------------------- poner cada cosa en su lugar */

function texto(m: Medidor, t: string, x: number, base: number, tam: number, peso: Peso, color: Color, alto: number, arriba: number, derecha = false): Texto {
  const w = Math.ceil(m(peso, tam, t));
  return { t, x, y: base, tam, peso, color, ...(derecha ? { derecha: true } : {}), caja: { x: derecha ? x - w : x, y: arriba, w, h: alto } };
}

/** Pone el bloque desde `lugar`: devuelve todo en coordenadas de la foto. */
function colocar(m: Medidor, e: EntradaLista, b: Bloque, x: number, desde: number): Omit<PlanLista, "arreglo" | "panel" | "escanear"> & { alcance: number } {
  const { d, F } = b;
  const colW = b.w;
  let y = desde;
  const titulo = texto(m, e.titulo, x, y + b.tamTitulo * 0.9, b.tamTitulo, 900, "crema", b.altoTitulo, y);
  y += b.altoTitulo + d.sep;
  const porColumna = Math.ceil(b.K / b.cols);
  const filas: FilaPlan[] = [];
  const ys = [y, y];
  // Hasta dónde llega el nombre más largo: el número se pega a él.
  const maxNombre = Math.max(0, ...b.filas.map((f) => f.ancho));
  for (let k = 0; k < b.K; k++) {
    const c = Math.floor(k / porColumna);
    const f = b.filas[k] as FilaCalc;
    const x0 = x + c * (colW + 32);
    const top = ys[c] ?? y;
    const xNombre = x0 + d.L + d.hueco;
    const pilaTop = top + (f.alto - f.pila) / 2;
    const nombre = f.lineas.map((l, i) => {
      const centro = pilaTop + i * d.lh + d.lh / 2;
      return texto(m, l, xNombre, centro + 0.36 * F, F, 900, "crema", d.lh, centro - d.lh / 2);
    });
    const numero = e.numeros?.[k] ?? `#${k + 1}`;
    let num: Texto;
    if (b.numAbajo) {
      const centro = pilaTop + f.lineas.length * d.lh + b.numAbajo / 2;
      num = texto(m, numero, xNombre, centro + 0.36 * b.Fn, b.Fn, "mono", "magenta", b.numAbajo, centro - b.numAbajo / 2);
    } else {
      const centro = top + f.alto / 2;
      num = texto(m, numero, xNombre + maxNombre + d.hueco + b.numW, centro + 0.36 * b.Fn, b.Fn, "mono", "magenta", b.Fn, centro - b.Fn / 2, true);
    }
    filas.push({
      k,
      caja: { x: x0, y: top, w: colW, h: f.alto },
      cara: { x: x0, y: Math.round(top + (f.alto - d.L) / 2), w: d.L, h: d.L },
      nombre,
      numero: num,
    });
    ys[c] = top + f.alto + d.entre;
  }
  y += b.altoFilas;
  let mas: Texto | null = null;
  const frase: Texto[] = [];
  if (b.faltan > 0) {
    y += d.sep;
    const alto = Math.round(b.Fm * 1.15);
    mas = texto(m, e.mas.replace("{n}", String(b.faltan)), x, y + b.Fm * 0.9, b.Fm, 900, "crema", alto, y);
    y += alto;
    if (b.frase.length) {
      y += 6;
      const paso = Math.round(b.Fq * 1.2);
      for (const l of b.frase) {
        frase.push(texto(m, l, x, y + b.Fq * 0.9, b.Fq, 800, "amarillo", paso, y));
        y += paso;
      }
    }
  }
  const cola: Texto[] = [];
  if (b.cola.length) {
    y += d.sep;
    for (const p of b.cola)
      for (const l of p.lineas) {
        cola.push(texto(m, l, x, y + p.tam, p.tam, p.peso, p.color, p.paso, y));
        y += p.paso;
      }
  }
  const todo = [titulo, ...filas.flatMap((f) => [...f.nombre, f.numero]), ...(mas ? [mas] : []), ...frase, ...cola];
  const alcance = Math.max(...todo.map((t) => t.caja.x + t.caja.w), ...filas.map((f) => f.cara.x + f.cara.w));
  return {
    letra: F,
    total: b.K + b.faltan,
    vistos: b.K,
    faltan: b.faltan,
    titulo,
    filas,
    mas,
    frase,
    cola,
    recorta: b.filas.some((f) => f.recorta) || b.cola.some((p) => p.recorta),
    alcance,
  };
}

/* ------------------------------------------------------------- «Escaneá» arriba de la tarjeta del QR (arreglo B) */

/**
 * «Escaneá para comprobarlo» y la calcomanía de tinkazo.app en un panel arriba de la tarjeta del QR, del ancho de la tarjeta.
 * La letra es de 36 como mucho y 4 menos que la de los nombres, y la calcomanía de `F - 8` como mucho: los nombres siguen
 * siendo lo más grande del medio.
 */
export function planEscanearArriba(medir: Medida, textoEscanear: string, F: number): EscanearPlan {
  const m = medidor(medir);
  const panel: Caja = { x: GEO.QR_X, y: GEO.FRANJA_ARRIBA, w: GEO.QR_LADO, h: GEO.FRANJA_ABAJO - GEO.FRANJA_ARRIBA };
  const zona = panel.w - 2 * GEO.LADO;
  const util = panel.h - 2 * GEO.AIRE;
  const dominioTam = clamp(Math.min(42, F - 8), 24, 42);
  const dominioAlto = Math.round((dominioTam * 72) / 42);
  const dominioAncho = Math.ceil(m(900, dominioTam, "tinkazo.app")) + Math.round((44 * dominioTam) / 42);
  let tam = 28;
  let lineas: string[] = [];
  for (let t = Math.min(36, F - 4); t >= 28; t -= 2) {
    const l = partir(m, 900, t, textoEscanear, zona, 2) ?? [textoEscanear];
    if (l.length <= 3 && l.length * Math.round(t * 1.08) + 24 + dominioAlto <= util) {
      tam = t;
      lineas = l;
      break;
    }
  }
  if (!lineas.length) lineas = recortarRenglones(m, 900, 28, partir(m, 900, 28, textoEscanear, zona, 2) ?? [textoEscanear], zona, 3).lineas;
  const paso = Math.round(tam * 1.08);
  const contenido = lineas.length * paso + 24 + dominioAlto;
  const arriba = panel.y + (panel.h - contenido) / 2;
  const x = panel.x + GEO.LADO;
  return {
    panel,
    texto: lineas.map((l, i) => texto(m, l, x, arriba + i * paso + tam * 0.86, tam, 900, "crema", paso, arriba + i * paso)),
    dominio: { x, y: Math.round(arriba + lineas.length * paso + 24), w: dominioAncho, h: dominioAlto, tam: dominioTam },
  };
}

/* ------------------------------------------------------------- el plan */

/** El plan de la lista para dos o más ganadores: elige el arreglo, la letra y cuántos nombres se ven. */
export function planLista(e: EntradaLista): PlanLista {
  const m = medidor(e.medir);
  const X = GEO.M;
  if (e.conQr) {
    const col = { w: GEO.COLUMNA_TEXTO, cols: 1 as const, anchoTodo: GEO.COLUMNA_TEXTO };
    const hB = GEO.PIE - GEO.FRANJA_ARRIBA - 2 * GEO.AIRE;
    const a = e.altoA > 0 ? todos(e, m, col, e.altoA) : null;
    const b = todos(e, m, col, hB);
    // A si ahí los nombres llegan a 40, o si B no los da más de dos píxeles más grandes. Si no, B.
    const usaA = !!a && (a.F >= 40 || !b || a.F >= b.F - 2);
    const elegido = usaA ? (a as Bloque) : (b ?? primeros(e, m, col, hB));
    const puesto = colocar(m, e, elegido, X, GEO.FRANJA_ARRIBA + GEO.AIRE);
    const { alcance: _alcance, ...resto } = puesto;
    const panel: Caja = { x: GEO.LISTA_X, y: GEO.FRANJA_ARRIBA, w: GEO.COLUMNA_PANEL, h: elegido.alto + 2 * GEO.AIRE };
    return { arreglo: usaA ? "A" : "B", ...resto, panel, escanear: usaA ? null : planEscanearArriba(e.medir, e.escanear, elegido.F) };
  }
  // Sin QR: la franja de lado a lado, hasta 24 px antes de la tarjeta de abajo.
  const hN = GEO.SIN_QR_Y - 24 - GEO.FRANJA_ARRIBA - 2 * GEO.AIRE;
  const ancho = GEO.W - 2 * GEO.M;
  const uno = todos(e, m, { w: ancho, cols: 1, anchoTodo: ancho }, hN);
  const dosCols = { w: (ancho - 32) / 2, cols: 2 as const, anchoTodo: ancho };
  const elegido = uno ?? todos(e, m, dosCols, hN) ?? primeros(e, m, dosCols, hN);
  const puesto = colocar(m, e, elegido, X, GEO.FRANJA_ARRIBA + GEO.AIRE);
  const { alcance, ...resto } = puesto;
  const w = clamp(Math.ceil(alcance - X) + 2 * GEO.LADO, 2 * GEO.LADO + 120, GEO.W - 2 * GEO.LISTA_X);
  return { arreglo: "N", ...resto, panel: { x: GEO.LISTA_X, y: GEO.FRANJA_ARRIBA, w, h: elegido.alto + 2 * GEO.AIRE }, escanear: null };
}

