import { canonicalList } from "./protocol/canonical";

/**
 * Varias participaciones por persona, sin tocar el sello.
 *
 * Quien organiza elige cuántas tiene cada persona tocando un contador en el panel de la lista, y cada toque
 * reescribe el cuadro: una línea por participación («Ana Quispe (1/3)», «Ana Quispe (2/3)», «Ana Quispe
 * (3/3)»). Nadie escribe números ni comas para eso. Si una lista pegada ya trae un número al lado del nombre,
 * el sitio pregunta y, solo si la persona dice que sí, `repartir` lo pasa a una línea por participación.
 * Después de eso, todo lo demás (el resumen, el sello, el comprobante, la verificación) funciona sin saber
 * que existió un reparto: la lista sellada es exactamente la que la persona ve en el cuadro, porque
 * `canonicalList` la lee de ahí, como siempre.
 *
 * Todo lo de este archivo es puro, sin pantalla: lo usan el cuadro (`ui/participants.ts`), el resultado
 * (`ui/resultado-ganadores.ts`), el sorteo siguiente (`ui/draw.ts`) y la página de verificación (`verify.ts`).
 *
 * El nombre es lo que va antes de la primera coma, que es justo lo que `canonicalList` toma de una línea: el
 * reparto nunca cambia cómo se lee el nombre. Cómo consiguió cada persona sus participaciones no es asunto del
 * sitio: las define quien organiza y quedan escritas en la lista sellada.
 */

/** Cuántas participaciones puede tener una misma persona. */
export const TOPE_POR_PERSONA = 10;

/** El sufijo con que el reparto marca cada participación: «Ana Quispe (2/3)». */
const SUFIJO = /^(.+)\s+\((\d+)\/(\d+)\)$/;

/** Un sufijo leído de una línea: la persona y su lugar entre sus participaciones. */
interface Sufijo {
  base: string;
  k: number;
  m: number;
}

/** El sufijo de una línea, si está bien escrito: «Ana Quispe (2/3)». Sin él o torcido, null. */
function leerSufijo(linea: string): Sufijo | null {
  const m = SUFIJO.exec(linea.trim());
  if (!m) return null;
  const k = Number(m[2]);
  const total = Number(m[3]);
  // «(0/3)» o «(4/3)» no son un lugar entre participaciones: la línea queda tal cual, sin inventar nada.
  if (!(k >= 1) || !(total >= k)) return null;
  return { base: (m[1] ?? "").trim(), k, m: total };
}

/** La persona de una línea: el nombre sin el sufijo «(k/m)», o la línea entera si no lo trae. */
export function nombreDePersona(linea: string): string {
  return leerSufijo(linea)?.base ?? linea.trim();
}

export interface LineaLeida {
  /** Lo que va antes de la primera coma, recortado: es el nombre que se sella. */
  nombre: string;
  /** Las participaciones que la línea le da al nombre, o null si no termina en un número válido. */
  participaciones: number | null;
}

/**
 * Lee una línea del cuadro: «Nombre, n», con exactamente una coma. El nombre es lo que va antes de la coma; `n`,
 * lo que sigue, si es un entero de 1 al tope. Lo que no es eso («tres», 0, 2.5, más del tope, o una línea con dos
 * comas o más) no cuenta como participaciones: la línea queda como está, y puede ser otra cosa (la edad, la mesa,
 * el grupo).
 *
 * Dos comas o más («Pérez, Ana, 2») no se reparten: el nombre que se sella es el que va antes de la primera coma
 * («Pérez»), así que repartir fundiría a dos personas en una sola y el nombre de pila se perdería. La línea se
 * queda como está y no entra en el aviso.
 */
export function leerLinea(linea: string): LineaLeida {
  const nombre = (linea.split(",")[0] ?? "").trim();
  // Un nombre de menos de 2 caracteres no se sella (canonicalList lo descarta): no se le reparte nada.
  if (nombre.length < 2 || linea.split(",").length !== 2) return { nombre, participaciones: null };
  const numero = linea.slice(linea.lastIndexOf(",") + 1).trim();
  if (!/^\d+$/.test(numero)) return { nombre, participaciones: null };
  const n = Number(numero);
  return n >= 1 && n <= TOPE_POR_PERSONA ? { nombre, participaciones: n } : { nombre, participaciones: null };
}

/** ¿La línea es «Nombre, n», con una sola coma y un número al final? Puede ser participaciones, o la edad o la mesa: por eso el aviso que la usa es una oferta. */
export const terminaEnNumero = (linea: string): boolean => linea.split(",").length === 2 && /,\s*\d+\s*$/.test(linea);

/** Cuántas líneas del texto terminan en una coma y un número. */
export function lineasConNumero(texto: string): number {
  return texto.split(/\r?\n/).filter(terminaEnNumero).length;
}

/**
 * Reparte el texto del cuadro: cada «Nombre, n» pasa a ser n líneas «Nombre (k/n)», en el lugar de la primera
 * aparición. Los repetidos se suman («Ana, 3» y «Ana, 2» son cinco líneas de Ana); una línea sin número del
 * mismo nombre vale una participación más; una línea sin número de otro nombre queda como está.
 *
 * Una persona con una sola participación queda con su nombre a secas, sin sufijo: así una lista donde todos
 * tienen 1 sella exactamente lo mismo que hoy.
 *
 * Devuelve null si ninguna línea trae un número válido: sin números no hay nada que repartir y el cuadro no
 * cambia. Lo que devuelve puede entrar a `canonicalList` sin sorpresas: las líneas están recortadas y no se
 * repite ninguna.
 */
export function repartir(texto: string): string | null {
  const lineas = texto.split(/\r?\n/);
  const leidas = lineas.map(leerLinea);
  // «Apellido, Nombre, n» (dos comas o más) queda como está: repartirla fundiría a dos personas en una.
  const enteras = lineas.map((l) => l.split(",").length > 2);
  // Los totales por persona, sumando repetidos. Solo los nombres que tienen al menos un número se reparten.
  const totales = new Map<string, number>();
  leidas.forEach((l, i) => {
    if (!enteras[i] && l.participaciones !== null) totales.set(l.nombre, (totales.get(l.nombre) ?? 0) + l.participaciones);
  });
  // Una línea sin número de un nombre que sí tiene números vale una participación más.
  leidas.forEach((l, i) => {
    if (!enteras[i] && l.participaciones === null && totales.has(l.nombre)) totales.set(l.nombre, (totales.get(l.nombre) ?? 0) + 1);
  });
  // El tope es por persona, no por línea: pegar dos veces la misma tabla no puede dejar a nadie con más de 10.
  for (const [nombre, total] of totales) if (total > TOPE_POR_PERSONA) totales.set(nombre, TOPE_POR_PERSONA);
  if (!totales.size) return null;

  const salida: string[] = [];
  const vistas = new Set<string>();
  // Nada de líneas que el sello funda en una: lo que canonicalList descartaría no puede quedar en el cuadro, que
  // tiene que mostrar exactamente lo que se sella. Por eso se compara por el nombre que se sella (lo que va antes
  // de la primera coma, recortado, como lo lee canonicalList) y no por la línea entera: «Beto, mesa 1» y
  // «Beto, mesa 2» son el mismo nombre para el sello, y gana la primera línea, como en el sello. Una línea escrita
  // a mano que coincida con una del reparto se salta.
  const agregar = (linea: string): void => {
    const nombre = (linea.split(",")[0] ?? "").trim();
    if (vistas.has(nombre)) return;
    vistas.add(nombre);
    salida.push(linea);
  };
  const repartidos = new Set<string>();
  for (let i = 0; i < lineas.length; i++) {
    const { nombre } = leidas[i] as LineaLeida;
    if (enteras[i] || !totales.has(nombre)) {
      agregar(lineas[i] ?? "");
      continue;
    }
    if (repartidos.has(nombre)) continue;
    repartidos.add(nombre);
    const total = totales.get(nombre) ?? 1;
    for (let k = 1; k <= total; k++) agregar(total === 1 ? nombre : `${nombre} (${k}/${total})`);
  }
  return salida.join("\n");
}

/** Una persona del cuadro, para el panel de contadores: su nombre tal como lo lee el sello y cuántas veces está. */
export interface PersonaDelCuadro {
  /** El nombre de la persona, sin el sufijo «(k/m)» si sus líneas lo traen. */
  nombre: string;
  /** Cuántas líneas de la lista sellada son de esta persona. */
  veces: number;
}

/**
 * Las personas del cuadro, en el orden de la lista: se lee lo que se sella (`canonicalList`) y se junta cada
 * línea con su persona (`nombreDePersona`), como hace `contar`. Una línea con comas entra por el nombre que
 * lee el sello, que es lo que va antes de la primera coma.
 */
export function personasDelCuadro(texto: string): PersonaDelCuadro[] {
  const por = new Map<string, number>();
  for (const nombre of canonicalList(texto)) {
    const persona = nombreDePersona(nombre);
    por.set(persona, (por.get(persona) ?? 0) + 1);
  }
  return [...por.entries()].map(([nombre, veces]) => ({ nombre, veces }));
}

/**
 * Pone cuántas veces participa una persona, reescribiendo el cuadro en el acto: sus líneas pasan a ser
 * «Nombre (1/n)» hasta «Nombre (n/n)» en el lugar de su primera línea, y con 1 queda el nombre a secas.
 *
 * La persona se busca por el nombre que lee el sello (lo de antes de la primera coma, sin el sufijo si lo
 * trae), así que una línea con dos comas o más entra por ese nombre y al cambiarla queda el nombre solo.
 * Si la misma persona está en más de una línea, todas se juntan en la primera: el sello ya la leía una sola
 * vez por nombre. Las demás líneas quedan como están y el orden de la lista se conserva. El número se corta
 * entre 1 y el tope. Si la persona no está, el texto no cambia.
 */
export function ponerParticipaciones(texto: string, persona: string, n: number): string {
  // La persona se busca tal como llega: si su nombre ya trae algo que parece un sufijo («Ana (1/2)»),
  // sacárselo acá hacía que ninguna línea coincidiera y el contador no respondiera.
  const buscada = persona.trim();
  if (buscada.length < 2 || !Number.isFinite(n)) return texto;
  const veces = Math.min(TOPE_POR_PERSONA, Math.max(1, Math.trunc(n)));
  const salida: string[] = [];
  let puesta = false;
  for (const cruda of texto.split(/\r?\n/)) {
    const sellado = (cruda.split(",")[0] ?? "").trim();
    const base = nombreDePersona(sellado);
    if (sellado.length < 2 || base !== buscada) {
      salida.push(cruda);
      continue;
    }
    if (!puesta) {
      puesta = true;
      for (let k = 1; k <= veces; k++) salida.push(veces === 1 ? base : `${base} (${k}/${veces})`);
    }
  }
  return puesta ? salida.join("\n") : texto;
}

/**
 * Vuelve a numerar a quien quedó con sufijos que no cierran, por ejemplo después de borrar a mano una línea del
 * medio: «Ana (1/3)» y «Ana (3/3)» pasan a «Ana (1/2)» y «Ana (2/2)». Se usa justo antes de sellar, para que la lista
 * sellada diga lo mismo que la cuenta de personas y participaciones, y no mientras se escribe, para no mover el cursor.
 *
 * Solo toca a una persona cuando todas sus líneas traen sufijo, son dos o más, comparten el mismo total y no cierran.
 * Una línea suelta, una mezcla con el nombre a secas o totales distintos no se tocan: no se inventa nada. No cambia
 * quién está en la lista ni su orden: cada persona queda en el lugar de su primera línea. Si nada cambia devuelve el
 * mismo texto.
 */
export function renumerarSufijos(texto: string): string {
  const lineas = canonicalList(texto);
  const por = new Map<string, { sufijos: Sufijo[]; todas: boolean }>();
  for (const linea of lineas) {
    const s = leerSufijo(linea);
    const base = s?.base ?? linea;
    const g = por.get(base) ?? { sufijos: [], todas: true };
    if (s) g.sufijos.push(s);
    else g.todas = false;
    por.set(base, g);
  }
  let salida = texto;
  for (const [base, g] of por) {
    const c = g.sufijos.length;
    if (!g.todas || c < 2 || c > TOPE_POR_PERSONA) continue;
    const m = g.sufijos[0]?.m ?? 0;
    if (!g.sufijos.every((s) => s.m === m)) continue;
    const cierra = c === m && new Set(g.sufijos.map((s) => s.k)).size === m;
    if (!cierra) salida = ponerParticipaciones(salida, base, c);
  }
  return salida;
}

/** Una persona de la lista sellada: sus líneas y si el sufijo de cada una cierra bien. */
export interface PersonaAgrupada {
  /** El nombre de la persona: sin el sufijo si agrupó; la línea tal cual si no se pudo agrupar. */
  nombre: string;
  /** En qué posiciones de la lista están sus participaciones, desde 0 y en orden. */
  puestos: number[];
  /** ¿Los sufijos son coherentes: todas sus líneas traen sufijo y están todas, del 1/m al m/m? */
  coherente: boolean;
}

/**
 * Agrupa la lista sellada por persona, leyendo los sufijos «(k/m)».
 *
 * Solo agrupa cuando son coherentes: todas las líneas de la persona traen sufijo, con el mismo total, y están
 * todas, del 1/m al m/m. Si no, no se inventa nada: cada línea queda como su propia entrada, tal cual está
 * escrita. Una línea sola sin sufijo es una persona con una participación.
 *
 * La salida va en el orden de la lista: cada entrada en el puesto de su primera línea.
 */
export function agruparPorPersona(nombres: readonly string[]): PersonaAgrupada[] {
  interface Acumulado {
    puestos: number[];
    sufijos: Array<Sufijo | null>;
  }
  const por = new Map<string, Acumulado>();
  nombres.forEach((linea, i) => {
    const s = leerSufijo(linea);
    const base = s?.base ?? linea;
    let a = por.get(base);
    if (!a) {
      a = { puestos: [], sufijos: [] };
      por.set(base, a);
    }
    a.puestos.push(i);
    a.sufijos.push(s);
  });
  const out: PersonaAgrupada[] = [];
  for (const [base, a] of por) {
    const conSufijo = a.sufijos.filter((s): s is Sufijo => s !== null);
    const m = conSufijo[0]?.m ?? 0;
    const ks = new Set(conSufijo.map((s) => s.k));
    const cierra =
      conSufijo.length === a.puestos.length &&
      conSufijo.every((s) => s.m === m) &&
      ks.size === a.puestos.length &&
      a.puestos.length === m &&
      [...ks].every((k) => k >= 1 && k <= m);
    // Una línea sola y sin sufijo también cierra: es una persona con una participación, como toda la vida.
    if (cierra || (a.puestos.length === 1 && a.sufijos[0] === null)) {
      out.push({ nombre: base, puestos: a.puestos, coherente: true });
    } else {
      for (const p of a.puestos) out.push({ nombre: nombres[p] ?? "", puestos: [p], coherente: false });
    }
  }
  // En el orden sellado: un grupo que cierra aparece en el puesto de su primera línea, y cada línea que no
  // agrupa, en el suyo. Sin esto, las líneas sueltas de una persona cuyos sufijos no cierran saldrían todas
  // juntas, donde su nombre apareció por primera vez, y no donde están en la lista que decide los puestos.
  out.sort((x, y) => (x.puestos[0] ?? 0) - (y.puestos[0] ?? 0));
  return out;
}

/**
 * Cuántas personas y cuántas participaciones hay en una lista sellada. Una lista común tiene las dos iguales.
 *
 * La persona es siempre la misma en todos lados: el nombre base que lee `nombreDePersona`, el mismo con el que
 * «No está» y «Siguiente premio» quitan a quien salió. Por eso una lista cuyos sufijos no cierran (una línea
 * borrada a mano) no infla la cuenta: «Ana (1/3)» y «Ana (3/3)» son una sola persona, y con una sola persona no
 * se puede sellar, aunque el cuadro tenga muchas líneas. La coherencia de los sufijos solo decide cómo se agrupa
 * la vista (`agruparPorPersona`).
 *
 * `porPersona` en falso es la lista de siempre: cada línea es una persona (la herramienta sin la bandera de los
 * modos ni `?modo=`, que no puede saber si un «(1/2)» del nombre es un reparto o un nombre con forma de sufijo).
 */
export function contar(nombres: readonly string[], porPersona = true): { personas: number; participaciones: number } {
  return { personas: porPersona ? new Set(nombres.map(nombreDePersona)).size : nombres.length, participaciones: nombres.length };
}

/**
 * ¿La lista entera es un reparto coherente? Cada línea trae su sufijo «(k/m)», cada persona tiene todas las
 * suyas del 1/m al m/m, y al menos una persona tiene más de una participación.
 *
 * Es lo que miran las páginas que no conocen la bandera de quien selló (la verificación, la lista de la sala):
 * una lista así solo puede ser un reparto, así que se agrupa por persona; cualquier otra cosa se muestra tal
 * cual, como se mostró siempre. Una lista común con nombres como «Grupo (1/2)» y «Grupo (2/2)» junto a otro sin
 * sufijo no es un reparto entero: se muestra línea por línea.
 */
export function esReparto(nombres: readonly string[]): boolean {
  const por = new Map<string, { m: number; ks: Set<number> }>();
  for (const linea of nombres) {
    const s = leerSufijo(linea);
    if (!s || !s.base) return false;
    const ya = por.get(s.base);
    if (!ya) por.set(s.base, { m: s.m, ks: new Set([s.k]) });
    else if (ya.m !== s.m || ya.ks.has(s.k)) return false;
    else ya.ks.add(s.k);
  }
  let conVarias = false;
  for (const { m, ks } of por.values()) {
    if (ks.size !== m) return false;
    if (m > 1) conVarias = true;
  }
  return conVarias;
}

/**
 * ¿La lista cierra como un reparto de varias participaciones? Cada grupo que lee `agruparPorPersona` es
 * coherente: toda línea con sufijo pertenece a un grupo completo (mismo total, del 1 al total, sin repetir
 * ni faltar), cada línea sin sufijo cuenta como una persona con una participación, y al menos una persona
 * tiene más de una.
 *
 * Una lista común con nombres como «Grupo 4 (1/2)» y «Grupo 4 (2/2)» junto a nombres sueltos también cierra:
 * es indistinguible de un reparto, y por eso quien la muestra exige además el parámetro del enlace
 * (`?modo=varias`) o la bandera de construcción. Sin ese dato, la verificación sigue mirando `esReparto`.
 */
export function cierraComoReparto(nombres: readonly string[]): boolean {
  if (!nombres.length) return false;
  const grupos = agruparPorPersona(nombres);
  return grupos.every((g) => g.coherente) && grupos.some((g) => g.puestos.length > 1);
}

/**
 * La única regla para contar una lista ya sellada: ¿se cuenta por persona? La usan todos los que muestran o
 * comparten la cuenta después del sello (la espera, las bases, la foto, los mensajes, la sala, la verificación),
 * para que todos digan lo mismo.
 *
 * Un reparto entero (`esReparto`) se cuenta por persona siempre, con los modos o sin ellos: es lo único que
 * puede ser. Con los modos a la vista (la bandera, `?modo=varias` en la herramienta o en el enlace) también la
 * lista que cierra como reparto (`cierraComoReparto`): el reparto normal, con quien tiene una sola participación
 * con su nombre a secas. Sufijos que no cierran no se agrupan nunca: cada línea, una persona.
 *
 * Solo decide cómo se cuenta y se muestra. No cambia quién gana ni el orden.
 */
export function seCuentaPorPersona(nombres: readonly string[], modosALaVista: boolean): boolean {
  return esReparto(nombres) || (modosALaVista && cierraComoReparto(nombres));
}

/** Una persona que salió más de una vez entre los ganadores, con los puestos de sus premios (desde 0, en el orden en que salieron). */
export interface SalidaRepetida {
  nombre: string;
  veces: number;
  puestos: number[];
}

/**
 * Las personas que salieron más de una vez entre los ganadores, leyendo los sufijos. Cada una con cuántas veces
 * y con qué premios. Con `porPersona` en falso no hay nada que decir: la lista de siempre no tiene personas con
 * varias participaciones, y un nombre con forma de sufijo («Grupo (1/2)») no es motivo de aviso.
 */
export function salieronVariasVeces(nombres: readonly string[], ganadores: readonly number[], porPersona = true): SalidaRepetida[] {
  if (!porPersona) return [];
  const por = new Map<string, SalidaRepetida>();
  ganadores.forEach((i, k) => {
    const nombre = nombreDePersona(nombres[i] ?? "");
    if (!nombre) return;
    const ya = por.get(nombre);
    if (ya) {
      ya.veces++;
      ya.puestos.push(k);
    } else por.set(nombre, { nombre, veces: 1, puestos: [k] });
  });
  return [...por.values()].filter((p) => p.veces > 1);
}

/**
 * Las líneas que quedan si se saca, entera, a cada persona que salió entre los ganadores: con todas sus
 * participaciones. Así «No está» y «Siguiente premio» nunca dejan a medias a quien ya salió, y el reemplazo
 * nunca puede ser otra participación de quien no está: sus líneas ya no están en la lista.
 *
 * Con `porPersona` en falso sale la línea que salió, no la persona: la herramienta de siempre, que no sabe si un
 * sufijo del nombre es un reparto, quita por posición, como siempre lo hizo.
 */
export function sinLasPersonasQueSalieron(nombres: readonly string[], ganadores: readonly number[], porPersona = true): string[] {
  if (!porPersona) return nombres.filter((_, i) => !ganadores.includes(i));
  const salieron = new Set(ganadores.map((i) => nombreDePersona(nombres[i] ?? "")).filter(Boolean));
  return nombres.filter((n) => !salieron.has(nombreDePersona(n)));
}

/**
 * La garantía de justicia del reparto: lo que queda en el cuadro, pasado por `canonicalList` (la función con
 * que el sello normaliza la lista), son exactamente las líneas del reparto, en el mismo orden. Sin números, la
 * huella es la de hoy: el reparto no cambió nada.
 */
export function canonicalDelReparto(texto: string): string[] {
  return canonicalList(repartir(texto) ?? texto);
}
