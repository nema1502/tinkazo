import type { Leyenda } from "./leyenda";
import type { Forma } from "./respuestas";
import type { Lanzador } from "./tipos";

/**
 * El catálogo de los juegos del kit: lo que el sitio sabe de cada uno.
 *
 * El juego en sí (`<id>.ts`) no sabe nada del selector; esto sí. Es la única
 * entrada que el sitio necesita para un juego nuevo: el selector, la tarjeta
 * de "cómo se juega", las recomendaciones, la historia y la captura se arman
 * desde acá, con las claves de texto por convención (`clavesDe`).
 *
 * Un juego nace **apagado** (`selector: false`): abre con `?demo=<id>` y
 * `?pose=<id>`, existe en el selector como un botón oculto y pasa
 * `audit-game`, pero nadie puede elegirlo. Se enciende con
 * `node scripts/nuevo-juego.mjs --encender <id>`, que pide la captura, la
 * historia con su fuente verificada y el rango.
 *
 * `scripts/nuevo-juego.mjs` escribe entre las marcas de abajo.
 */
export interface HistoriaDelKit {
  /** Claves del diccionario de la pregunta y de las dos frases (`games/lore.ts`). */
  q: string;
  a: string;
  href: string;
  src: string;
  hue: "magenta" | "orange" | "teal" | "purple" | "yellow";
  /** El texto es un borrador y la fuente no se verificó: no sale en ningún sorteo. */
  borrador?: boolean;
}

export interface EntradaCatalogo {
  /** El valor de `?demo=`: de tres a doce letras minúsculas. */
  id: string;
  /** Baja el juego recién cuando se lo pide. */
  cargar: () => Promise<Lanzador>;
  /**
   * La forma del juego, para la prueba del niño (`audit-nino`): decide la pregunta propia.
   * `carrera`: quién va adelante; `de-pie`: quiénes siguen en juego; `rueda`: qué está señalado; `acumulacion`: quién tiene más.
   * Se elige por la pregunta que contestaría un chico mirando un cuadro.
   */
  forma: Forma;
  /** ¿Se puede elegir en el selector? */
  selector: boolean;
  /** Para cuántas personas anda el juego (`ui/recomendar.ts`). */
  rango: { minimo?: number; ideal?: readonly [number, number]; maximo?: number };
  /** Existe `public/juegos/<id>.webp`. */
  captura: boolean;
  historia?: HistoriaDelKit;
  /** De dónde viene el juego: se muestra después del resultado, nunca durante el show. */
  leyenda?: Leyenda;
}

export const CATALOGO = [
  // De pie, el primer juego migrado al kit. Salió del selector el 26 de octubre de 2026 (su botón queda oculto en
  // index.html) y sigue abriendo con ?demo=quien, con sus claves y su rango de siempre.
  {
    id: "quien",
    cargar: () => import("../quien").then((m) => m.quienPixi),
    forma: "de-pie",
    selector: false,
    rango: { minimo: 8, maximo: 100 },
    captura: true,
  },
  // La carrera de llamas, reescrita sobre el kit: una sola carrera con salida, grupo que se echa y recta final.
  {
    id: "race",
    cargar: () => import("../../llamas/carrera").then((m) => m.carreraPixi),
    forma: "carrera",
    selector: true,
    rango: { minimo: 2, ideal: [4, 30], maximo: 200 },
    captura: true,
  },
  // >>> kit:catalogo (scripts/nuevo-juego.mjs escribe entre estas marcas)
  // --- guajojo
  // El Guajojó, el sendero del monte de noche. Nació apagado: abre con ?demo=guajojo y ?pose=guajojo, y entra al selector
  // al pasar la batería y con el sí de quien mantiene el proyecto (node scripts/nuevo-juego.mjs --encender guajojo).
  {
    id: "guajojo",
    cargar: () => import("../guajojo").then((m) => m.guajojoPixi),
    forma: "de-pie",
    selector: false,
    rango: { minimo: 2, ideal: [8, 30], maximo: 200 },
    captura: true,
    historia: {
      q: "loreGuajojoQ",
      a: "loreGuajojoA",
      href: "https://es.wikipedia.org/wiki/Nyctibius_griseus",
      src: "es.wikipedia.org, Nyctibius griseus",
      hue: "teal",
    },
    leyenda: {
      es: [
        "En el oriente boliviano (Beni, Pando y Santa Cruz) se cuenta que una joven enamorada corrió por el monte y quedó convertida en ave.",
        "Desde entonces no habla: al caer el sol llama con un lamento, un silbo largo y notas que bajan.",
        "De día se queda erguida e inmóvil, como la punta de un palo seco.",
      ],
      en: [
        "In eastern Bolivia (Beni, Pando and Santa Cruz) they say a young woman in love ran through the forest and was turned into a bird.",
        "Since then she cannot speak: at sunset she calls with a lament, one long whistle and falling notes.",
        "By day she stays upright and still, like the tip of a dry stick.",
      ],
      fuente: { titulo: "Los Tiempos: Guajojó, la historia de amor que se hizo ave", url: "https://www.lostiempos.com/doble-click/cultura/20190806/guajojo-historia-amor-que-se-hizo-ave-mal-aguero" },
    },
  },
  // --- /guajojo
  // --- toborochi
  // El Toborochi, el árbol de Santa Cruz en flor y el colibrí. Nace apagado: abre con ?demo=toborochi y entra al selector
  // después de pasar la batería y con la aprobación de quien mantiene el proyecto (node scripts/nuevo-juego.mjs --encender toborochi).
  {
    id: "toborochi",
    cargar: () => import("../toborochi").then((m) => m.toborochiPixi),
    forma: "de-pie",
    selector: false,
    rango: { minimo: 2, ideal: [8, 40], maximo: 200 },
    captura: false,
    historia: {
      q: "loreToborochiQ",
      a: "loreToborochiA",
      href: "https://eldeber.com.bo/santa-cruz/el-toborochi-en-flor-un-simbolo-que-pinta-de-rosa-santa-cruz_515706/",
      src: "El Deber, El toborochi en flor, un símbolo que pinta de rosa a Santa Cruz",
      hue: "magenta",
    },
    leyenda: {
      es: [
        "El toborochi es el árbol de Santa Cruz: entre mayo y junio, sus flores pintan de rosa la ciudad.",
        "Una leyenda guaraní cuenta que Araverá escapó de los espíritus del mal y se refugió dentro de su tronco.",
        "De allí, dicen, todavía asoma convertida en flor para que la visiten los colibríes.",
        "Se cuenta de muchas maneras.",
      ],
      en: [
        "The toborochi is the tree of Santa Cruz, Bolivia: in May and June, its flowers paint the city pink.",
        "A Guaraní legend tells that Araverá fled from evil spirits and took refuge inside its trunk.",
        "From there, it is said, she still comes out as a flower for the hummingbirds to visit.",
        "It is told in many ways.",
      ],
      fuente: { titulo: "El Deber: 24 de mayo de 2025", url: "https://eldeber.com.bo/santa-cruz/el-toborochi-en-flor-un-simbolo-que-pinta-de-rosa-santa-cruz_515706/" },
    },
  },
  // --- /toborochi
  // <<< kit:catalogo
] as const satisfies readonly EntradaCatalogo[];

/** Los ids de los juegos del kit. */
export type JuegoKit = (typeof CATALOGO)[number]["id"];

/** Una entrada con su id como tipo: lo que el sitio recorre. */
export interface JuegoDelKit extends EntradaCatalogo {
  id: JuegoKit;
}

/** Los juegos del kit, como lista para recorrer (`CATALOGO` es una tupla literal, de la que sale `JuegoKit`). */
export const JUEGOS: readonly JuegoDelKit[] = CATALOGO;

export const entradaDe = (id: string): JuegoDelKit | undefined => JUEGOS.find((j) => j.id === id);
export const esDelKit = (id: string): id is JuegoKit => entradaDe(id) !== undefined;

const capital = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * Las claves de texto del sitio que le tocan a un juego, por convención:
 * el botón del selector (`data-i`), el nombre y la regla de la tarjeta de
 * "cómo se juega", y la regla con varios premios.
 */
export function clavesDe(id: string): { boton: string; nombre: string; regla: string; varios: string } {
  const c = capital(id);
  return { boton: `game${c}`, nombre: `jg${c}N`, regla: `gc${c}`, varios: `gc${c}Many` };
}
