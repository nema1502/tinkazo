import { stripInvisibles } from "../invisibles";

/**
 * Lo que se revisa de cada nombre antes de ponerlo en la pantalla grande.
 *
 * El riesgo real de la sala es una grosería frente a chicos, en una feria. El
 * filtro corre acá, en la pantalla de quien atiende, porque ningún servidor
 * lee los nombres. Ninguna lista lo atrapa todo: alguien tiene que estar
 * mirando la pantalla (docs de la sala).
 *
 * - sin caracteres invisibles (`stripInvisibles`), sin saltos de línea, hasta 40 caracteres;
 * - sin enlaces ni correos: se descartan;
 * - lo que coincide con la lista de palabras (español e inglés) queda en «Para revisar»:
 *   no sale en la pantalla hasta que quien atiende lo deja.
 *
 * La lista compara sin tildes ni mayúsculas, deshace las sustituciones de
 * siempre (0 por o, 4 por a, @ por a, $ por s…), junta las letras separadas por
 * puntos, guiones o espacios (`p.u.t.a`) y no se deja engañar por letras
 * repetidas (`puuuta`). Las palabras cortas o que son parte de apellidos comunes
 * (la `verga` de Vergara) solo cuentan como palabra entera.
 */

export const MAX_NOMBRE = 40;

export type Veredicto =
  | { estado: "ok"; nombre: string }
  | { estado: "revisar"; nombre: string }
  | { estado: "descartar"; motivo: "vacio" | "largo" | "enlace" };

/** Palabras que cuentan solo enteras (están escritas sin tildes y con letras repetidas colapsadas). */
const ENTERAS = new Set(
  [
    // español
    "puta", "putas", "puto", "putos", "putita", "pendejo", "pendeja", "pendejos", "mierda", "culo", "culos", "cono", "verga", "vergas", "pija",
    "polla", "pene", "vagina", "teta", "tetas", "nalga", "nalgas", "sexo", "sexy", "sexual", "coger", "cojer", "follar", "joder", "jodete",
    "idiota", "imbecil", "estupido", "estupida", "tarado", "tarada", "mongolico", "mongolo", "maricon", "marica", "mariquita", "cabron",
    "cabrona", "hdp", "ctm", "ptm", "csm", "boludo", "boluda", "pelotudo", "chinga", "chingar", "chingada", "pinche", "carajo", "mrd",
    "cojudo", "huevon", "hueon", "webon", "wevon", "zorra", "perra", "puñeta", "paja", "pajero", "chupa", "chupame", "mamada", "violar",
    "violacion", "pedofilo", "pedo", "orto", "ojete", "culiar", "culero", "culera", "conchudo", "gonorrea", "hijueputa", "hpta", "lamepijas",
    // inglés
    "fuck", "fucker", "fucking", "shit", "shitty", "bitch", "bitches", "cunt", "whore", "slut", "pussy",
    "penis", "asshole", "ass", "bastard", "rape", "rapist", "nazi", "nigga", "nigger", "fag", "faggot", "porn", "porno", "nude", "nudes",
    "sex", "cum", "boobs", "tits", "wtf", "stfu", "kys", "retard", "retarded", "dildo", "anal", "hentai", "milf", "twat", "wank",
  ].map(colapsar),
);

/** Raíces largas y sin ambigüedad: cuentan aunque estén pegadas a otras letras. */
const RAICES = [
  "mierd", "pendej", "chingad", "hijueput", "hijoput", "hijodeput", "culiad", "maricon", "follar", "cabron", "cojudo", "pelotud", "boludo",
  "puñet", "putamadre", "putaque", "malparid", "gonorre", "mamaverga", "chupapij", "fuck", "motherf", "shit", "bitch", "asshole", "bastard",
  "nigger", "nigga", "faggot", "whore", "pussy", "dickhead", "cunt", "hitler", "pornhub", "xvideos", "violador", "pedofil",
].map(colapsar);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "!": "i", "¡": "i", "+": "t", "€": "e" };

/** Letras repetidas colapsadas en una sola: `puuuta` y `pta` se miran igual de sueltas. */
function colapsar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/(.)\1+/g, "$1");
}

/** Minúsculas, sin tildes, con las sustituciones deshechas y todo lo que no es letra convertido en espacio. */
function normalizar(s: string): string {
  const sinTildes = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let out = "";
  for (const c of sinTildes) out += LEET[c] ?? c;
  return out.replace(/[^a-zñ]+/g, " ").trim();
}

/** Las letras sueltas seguidas (`p u t a`, `p.u.t.a`) se juntan en una sola palabra. */
function juntarSueltas(tokens: string[]): string[] {
  const out: string[] = [];
  let racha = "";
  for (const t of tokens) {
    if (t.length === 1) racha += t;
    else {
      if (racha) out.push(racha), (racha = "");
      out.push(t);
    }
  }
  if (racha) out.push(racha);
  return out;
}

/** Si el nombre tiene algo que quien atiende debería mirar antes de que salga en la pantalla. */
export function hayPalabraFea(nombre: string): boolean {
  const n = normalizar(nombre);
  if (!n) return false;
  const tokens = juntarSueltas(n.split(" ").filter(Boolean)).map(colapsar);
  if (tokens.some((t) => ENTERAS.has(t))) return true;
  const pegado = tokens.join("");
  // Con espacios de más (`hijo de puta`): las raíces miran el texto sin espacios.
  return RAICES.some((r) => pegado.includes(r)) || ENTERAS.has(pegado);
}

/** Un enlace, un correo o una cuenta: lo que no es un nombre y lleva a otro lado. */
export function llevaEnlace(s: string): boolean {
  return /https?:|\bwww\.|\b[\w-]+\.(com|net|org|app|io|bo|me|ly|co|xyz|gg|tv|link|info)\b|@\w+\.\w|\bt\.me\/|wa\.me\//i.test(s);
}

/**
 * Qué se hace con un nombre que llegó de un celular, ya descifrado. Lo que
 * entra en la pantalla es siempre una sola línea, sin invisibles y de hasta 40
 * caracteres.
 */
export function revisarNombre(crudo: string): Veredicto {
  const nombre = stripInvisibles(crudo.replace(/[\r\n\t]+/g, " ")).replace(/\s+/g, " ").trim();
  if (!nombre) return { estado: "descartar", motivo: "vacio" };
  if (Array.from(nombre).length > MAX_NOMBRE) return { estado: "descartar", motivo: "largo" };
  if (llevaEnlace(nombre)) return { estado: "descartar", motivo: "enlace" };
  return hayPalabraFea(nombre) ? { estado: "revisar", nombre } : { estado: "ok", nombre };
}
