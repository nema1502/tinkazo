/**
 * El kit para creadores de contenido (TikTok, Reels, Shorts): un clip vertical por juego, el logo animado
 * y diez guiones con su guía de CapCut. Son datos, sin DOM: `marca.ts` los pinta en marca.html, los
 * guiones se bajan como texto y subtítulos desde acá, y `scripts/marca/videos/guiones.mjs` arma los
 * archivos .txt y .srt del kit con estos mismos datos.
 *
 * Los videos NO viven en el repositorio: se graban con `scripts/marca/videos/` y se sirven desde
 * `workers/musica` (ruta pública /kit/). Mientras `KIT_PUBLICADO` sea `false` la página no muestra
 * ningún enlace de descarga: se cambia a `true` el día que los archivos estén subidos.
 */

export type Idioma = "es" | "en";
export type Bi = Record<Idioma, string>;

/** `true` desde el 4 de noviembre de 2026, cuando los videos quedaron en m.tinkazo.app/kit/. Con `false` la página no muestra ningún enlace de descarga. */
export const KIT_PUBLICADO = true;
/** De dónde se baja cada archivo cuando el kit está publicado. */
export const KIT_BASE = "https://m.tinkazo.app/kit/";
export const WEB = "tinkazo.app";
export const INSTAGRAM = "@tinkazo.app";
export const INSTAGRAM_URL = "https://www.instagram.com/tinkazo.app/";

/** Un clip de un juego: el archivo, cuánto dura y cuánto pesa (de lo que dejó `grabar-clips.mjs`). */
export interface Clip {
  juego: string;
  archivo: string;
  seg: number;
  /** Peso en MB del mp4 que quedó en la carpeta privada (para que la página diga cuánto baja quien toca). */
  mb: number;
  /**
   * El segundo del clip en que empieza a verse el cartel del ganador (con el destello que lo anuncia). Medido en los
   * cuadros del clip: desde ahí no va texto en pantalla, para que la pregunta no tape la respuesta.
   */
  cartel: number;
  nombre: Bi;
}

export const CLIPS: readonly Clip[] = [
  { juego: "race", archivo: "tinkazo-carrera-9x16.mp4", seg: 13, mb: 7.92, cartel: 9.2, nombre: { es: "La carrera de llamas", en: "The llama race" } },
  { juego: "wheel", archivo: "tinkazo-ruleta-9x16.mp4", seg: 12.8, mb: 6.57, cartel: 8.9, nombre: { es: "La ruleta", en: "The wheel" } },
  { juego: "pinata", archivo: "tinkazo-pinata-9x16.mp4", seg: 12.8, mb: 7.72, cartel: 8.9, nombre: { es: "La piñata", en: "The piñata" } },
  { juego: "trompo", archivo: "tinkazo-trompo-9x16.mp4", seg: 13, mb: 3.34, cartel: 9.8, nombre: { es: "El trompo", en: "The spinning top" } },
  { juego: "sapo", archivo: "tinkazo-sapo-9x16.mp4", seg: 12.8, mb: 4.68, cartel: 8.8, nombre: { es: "El sapo", en: "The sapo toss" } },
  { juego: "guajojo", archivo: "tinkazo-guajojo-9x16.mp4", seg: 12.8, mb: 4.58, cartel: 8.7, nombre: { es: "El Guajojó", en: "The Guajojó" } },
  { juego: "toborochi", archivo: "tinkazo-toborochi-9x16.mp4", seg: 12.5, mb: 4.94, cartel: 8.2, nombre: { es: "El Toborochi", en: "The Toborochi" } },
  { juego: "chovena", archivo: "tinkazo-chovena-9x16.mp4", seg: 13, mb: 4.38, cartel: 9.7, nombre: { es: "La chovena", en: "The chovena dance" } },
  { juego: "oruro", archivo: "tinkazo-la-entrada-9x16.mp4", seg: 13, mb: 7.09, cartel: 8.7, nombre: { es: "La Entrada", en: "La Entrada" } },
  { juego: "teleferico", archivo: "tinkazo-teleferico-9x16.mp4", seg: 12.8, mb: 3.81, cartel: 8.8, nombre: { es: "El teleférico", en: "The cable car" } },
];

/** El logo animado: de entrada (2,5 s) y de cierre con la dirección (3,2 s, en cada idioma). */
export interface LogoAnimado {
  id: string;
  archivo: string;
  tipo: "entrada" | "salida";
  fondo: "oscuro" | "claro" | "verde" | "alfa";
  idioma?: Idioma;
}

const FONDOS = ["oscuro", "claro", "verde", "alfa"] as const;
export const LOGOS_ANIMADOS: readonly LogoAnimado[] = [
  ...FONDOS.map((fondo): LogoAnimado => ({ id: `entrada-${fondo}`, archivo: `tinkazo-logo-entrada-${fondo}.${fondo === "alfa" ? "webm" : "mp4"}`, tipo: "entrada", fondo })),
  ...(["es", "en"] as const).flatMap((idioma) =>
    FONDOS.map((fondo): LogoAnimado => ({ id: `salida-${idioma}-${fondo}`, archivo: `tinkazo-logo-cierre-${idioma}-${fondo}.${fondo === "alfa" ? "webm" : "mp4"}`, tipo: "salida", fondo, idioma })),
  ),
];

/** La dirección de un archivo del kit ya publicado. */
export const urlKit = (archivo: string): string => `${KIT_BASE}${archivo}`;
/** La versión en bucle de un clip: el final fundido en el principio, para repetirla sin salto. */
export const archivoBucle = (c: Clip): string => c.archivo.replace(/-9x16\.mp4$/, "-9x16-bucle.mp4");

/** Los pasos de CapCut, iguales para todos los guiones. Cada guion suma su toque propio. */
export const PASOS_CAPCUT: readonly Bi[] = [
  {
    es: "Bajá el clip del juego (vertical, sin música) y el logo de cierre. Si el editor es el del celular, pasalos antes a la galería.",
    en: "Download the game clip (vertical, no music) and the closing logo. If you edit on your phone, save them to the gallery first.",
  },
  {
    es: "En CapCut tocá Proyecto nuevo y elegí el clip. La proporción es 9:16 (vertical) y ya viene así.",
    en: "In CapCut tap New project and pick the clip. The ratio is 9:16 (vertical) and it already comes that way.",
  },
  {
    es: "Si hace falta, cortá el clip: tocá la línea de tiempo, ubicá el cursor y usá Dividir. Los clips duran unos 13 segundos, el último quieto en el cartel del ganador, y quedan bien enteros.",
    en: "If you need to, trim the clip: tap the timeline, place the cursor and use Split. The clips run about 13 seconds, the last one still on the winner's banner, and work fine whole.",
  },
  {
    es: "Texto: tocá Texto y después Agregar texto, y pegá cada línea del guion en su segundo. Usá letra gruesa, clara sobre fondo oscuro y dentro de la zona segura (entre el 15 % y el 65 % de la altura). La nuestra es Montserrat Black, libre y gratis. Si tu editor no la tiene, sirve cualquier letra bien gruesa. Cuando sale el cartel del ganador, sacá el texto: que se lea el nombre.",
    en: "Text: tap Text and then Add text, and paste each line of the script at its second. Use a heavy font, light on a dark background and inside the safe zone (between 15% and 65% of the height). Ours is Montserrat Black, free to use. If your editor does not have it, any very heavy font will do. When the winner's banner shows up, take the text off: let the name be read.",
  },
  {
    es: "Voz: tocá Audio y después Grabar, y leé con tus palabras la parte Lo que podés decir. Si no querés hablar, dejá solo el texto.",
    en: "Voice: tap Audio and then Record, and read the What you can say section in your own words. If you would rather not talk, leave just the text.",
  },
  {
    es: "Música: el clip viene sin música a propósito. Elegí una pista de la biblioteca de la app o una tuya. Ojo: algunas pistas de CapCut solo se pueden usar en TikTok y en CapCut. Si vas a subir a otras redes, elegí música libre.",
    en: "Music: the clip comes without music on purpose. Pick a track from the app's library or one of your own. Careful: some CapCut tracks can only be used on TikTok and CapCut. If you will post elsewhere, pick music you are free to use.",
  },
  {
    es: "Subtítulos: si hablaste, tocá Texto y después Subtítulos automáticos, o en CapCut para computadora importá el archivo .srt del guion (si tu versión no lo trae, pegá el texto a mano).",
    en: "Subtitles: if you spoke, tap Text and then Auto captions, or in CapCut for computer import the script's .srt file (if your version does not have it, paste the text by hand).",
  },
  {
    es: "Cierre: tocá Superposición y después Agregar superposición, y poné el logo de cierre al final. Si elegiste el de fondo verde, tocá el logo, después Cortar y Clave de croma. Con el cuentagotas elegí el verde y subí la intensidad hasta que desaparezca. El de fondo de color no necesita nada: ponelo como un clip más.",
    en: "Closer: tap Overlay and then Add overlay, and put the closing logo at the end. If you picked the green one, tap the logo, then Cut out and Chroma key. With the eyedropper pick the green and raise the intensity until it disappears. The color-background one needs nothing: just add it as another clip.",
  },
  {
    es: "Exportá en 1080p y 30 cuadros por segundo. Subí a TikTok como borrador, mirá que nada tape el texto con sus botones y recién ahí publicá. Poné tinkazo.app y @tinkazo.app en la descripción.",
    en: "Export at 1080p and 30 frames per second. Upload to TikTok as a draft, check that its buttons do not cover your text, and only then publish. Put tinkazo.app and @tinkazo.app in the caption.",
  },
];

/**
 * El primer paso mientras los clips no se pueden bajar: grabar la pantalla con el ejemplo del juego. Con el kit
 * publicado, el primer paso es bajar el clip (PASOS_CAPCUT[0]).
 */
export const PASO_GRABAR: Bi = {
  es: "Todavía no hay clips para bajar: grabá la pantalla del celular con el ejemplo del juego (cada guion trae su enlace, como tinkazo.app/?demo=race para la carrera) y recortá el final, del último tramo al cartel del ganador. Si hacés un sorteo de verdad con tu lista, grabá ese: el nombre que sale es de tu gente.",
  en: "There are no clips to download yet: screen-record the game's example on your phone (each script has its link, like tinkazo.app/?demo=race for the race) and keep the ending, from the last stretch to the winner's banner. If you run a real draw with your own list, record that one: the name that comes up belongs to your people.",
};

/**
 * Los pasos mientras no hay clips para bajar: se arma con la grabación de pantalla y se cierra con texto, porque el
 * logo animado de cierre llega con los clips. Del cuarto al séptimo y el último son los mismos de PASOS_CAPCUT.
 */
export const PASOS_SIN_CLIPS: readonly Bi[] = [
  PASO_GRABAR,
  {
    es: "En CapCut tocá Proyecto nuevo y elegí tu grabación. Si no quedó en 9:16 (vertical), tocá Formato y elegí 9:16.",
    en: "In CapCut tap New project and pick your recording. If it is not 9:16 (vertical), tap Format and choose 9:16.",
  },
  {
    es: "Cortá la grabación: tocá la línea de tiempo, ubicá el cursor y usá Dividir. Dejá unos 12 segundos, del último tramo al cartel del ganador, y sacá lo que no es del juego.",
    en: "Trim the recording: tap the timeline, place the cursor and use Split. Keep about 12 seconds, from the last stretch to the winner's banner, and cut anything that is not the game.",
  },
  ...PASOS_CAPCUT.slice(3, 7),
  {
    es: "Cierre: dejá quieto un segundo el cartel del ganador (tocá el último cuadro y después Congelar) y sumá un texto con tinkazo.app y @tinkazo.app. El logo animado de cierre llega con los clips.",
    en: "Closing: hold the winner's banner still for one second (tap the last frame and then Freeze) and add a text with tinkazo.app and @tinkazo.app. The animated closing logo comes with the clips.",
  },
  ...PASOS_CAPCUT.slice(8),
];

/** Los pasos que se muestran hoy: dependen de si los clips ya se pueden bajar. */
export const pasosActuales = (publicado: boolean = KIT_PUBLICADO): readonly Bi[] => (publicado ? PASOS_CAPCUT : PASOS_SIN_CLIPS);

/** El enlace del ejemplo de un juego, para grabarlo en pantalla. */
export const urlEjemplo = (juego: string): string => `https://${WEB}/?demo=${juego}`;

/** Una línea de texto en pantalla: de qué segundo a qué segundo del clip, y qué dice. */
export interface Linea {
  desde: number;
  hasta: number;
  es: string;
  en: string;
}

export interface Momento {
  /** El tramo del clip, en segundos: «0 a 2». */
  t: string;
  es: string;
  en: string;
}

export interface Guion {
  juego: string;
  titulo: Bi;
  /** El gancho: lo que se lee en los dos primeros segundos. */
  gancho: Bi;
  /** Lo que se puede decir en voz, con las propias palabras. */
  voz: Bi;
  momentos: readonly Momento[];
  /** Todo el texto en pantalla, con sus segundos (de ahí salen los subtítulos .srt). El gancho es la primera línea. */
  pantalla: readonly Linea[];
  /** El cierre del video: lo último que se lee y dónde seguirnos. */
  cierre: Bi;
  /** Un paso de CapCut propio de este clip, que se suma a los de la guía. */
  toque: Bi;
  hashtags: string;
}

/** Cuánto dura el cierre con la dirección y la cuenta, después del clip. */
export const SEG_CIERRE = 3.2;

export const GUIONES: readonly Guion[] = [
  {
    juego: "race",
    titulo: { es: "Ocho llamas, una sola cruza primero", en: "Eight llamas, only one crosses first" },
    gancho: { es: "Quedan 8 llamas. Una sola cruza primero.", en: "8 llamas left. Only one crosses first." },
    voz: {
      es: "Pusimos a correr a toda la lista y cada llama es una persona. Quedan ocho en la recta final: ¿quién la pasa?",
      en: "We made the whole list race, and every llama is a person. Eight are left in the final stretch: who passes whom?",
    },
    momentos: [
      { t: "0 a 4", es: "La recta final: las llamas saltan las vallas y alguien tropieza.", en: "The final stretch: the llamas jump the hurdles and someone trips." },
      { t: "4 a 9", es: "El pelotón se aprieta y alguien se cuela por el costado.", en: "The pack bunches up and someone sneaks up on the side." },
      { t: "8 a 12", es: "Cruzan la meta y el cartel amarillo dice el nombre de quien ganó.", en: "They cross the line and the yellow banner says who won." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Quedan 8 llamas. Una sola cruza primero.", en: "8 llamas left. Only one crosses first." },
      { desde: 2.4, hasta: 5.4, es: "Cada llama es una persona", en: "Every llama is a person" },
      { desde: 5.6, hasta: 9.1, es: "¿Quién la pasa?", en: "Who passes whom?" },
    ],
    cierre: { es: "¿Y si era tu nombre? Sorteos que cualquiera puede comprobar: probalo en tinkazo.app y seguinos en @tinkazo.app.", en: "What if it was your name? Draws anyone can check: try it at tinkazo.app and follow @tinkazo.app." },
    toque: { es: "En el segundo 9, acercá el zoom al cartel (de 100 % a 115 %) para que el nombre se lea desde lejos.", en: "At second 9, zoom in on the banner (100% to 115%) so the name reads from afar." },
    hashtags: "#tinkazo #sorteo #bolivia #llamas #carrera",
  },
  {
    juego: "wheel",
    titulo: { es: "La ruleta va frenando: ¿en qué nombre se queda?", en: "The wheel slows down: which name does it land on?" },
    gancho: { es: "La ruleta va frenando…", en: "The wheel is slowing down…" },
    voz: {
      es: "Pusimos toda la lista en la ruleta: cada gajo es una persona. Va frenando de a poco y la sala entera se calla. ¿En qué nombre se queda?",
      en: "We put the whole list on the wheel: every slice is a person. It slows down little by little and the whole room goes quiet. Which name does it land on?",
    },
    momentos: [
      { t: "0 a 5", es: "La ruleta va frenando y la flecha pasa de nombre en nombre, cada vez más lento.", en: "The wheel slows down and the pointer moves from name to name, slower and slower." },
      { t: "5 a 9", es: "Se queda sobre un nombre y toda la sala lo lee en voz baja.", en: "It settles on one name and the whole room reads it under their breath." },
      { t: "9 a 12", es: "Sale el cartel con el nombre.", en: "The banner shows the name." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.4, es: "La ruleta va frenando…", en: "The wheel is slowing down…" },
      { desde: 2.6, hasta: 5.2, es: "Cada gajo es una persona", en: "Every slice is a person" },
      { desde: 5.4, hasta: 8.8, es: "¿En qué nombre se queda?", en: "Which name does it land on?" },
    ],
    cierre: { es: "Nadie eligió al ganador. Comprobalo en tinkazo.app y seguinos en @tinkazo.app.", en: "Nobody picked the winner. Check it at tinkazo.app and follow @tinkazo.app." },
    toque: { es: "Poné un tic suave cada vez que la flecha cambia de gajo, y un segundo de silencio justo antes del cartel.", en: "Add a soft tick each time the pointer changes slice, and one second of silence right before the banner." },
    hashtags: "#tinkazo #sorteo #bolivia #ruleta",
  },
  {
    juego: "pinata",
    titulo: { es: "Cada caramelo lleva un nombre", en: "Every candy carries a name" },
    gancho: { es: "Cada caramelo lleva un nombre. ¿Cuál cae último?", en: "Every candy carries a name. Which one falls last?" },
    voz: {
      es: "Cada caramelo lleva un nombre. Los palos van tumbando a los demás y quedan dos. ¿Cuál cae último?",
      en: "Every candy carries a name. The swings knock the others out and two are left. Which one falls last?",
    },
    momentos: [
      { t: "0 a 2", es: "Quedan seis caramelos adentro y un palazo deja solo dos.", en: "Six candies are left inside and one swing leaves only two." },
      { t: "2 a 5", es: "Otro palo más y la piñata revienta.", en: "One more swing and the piñata bursts." },
      { t: "5 a 12", es: "Llueve papel de china, el último caramelo cae despacio y sale el cartel con su nombre.", en: "Tissue paper rains down, the last candy drops slowly and the banner shows its name." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Cada caramelo lleva un nombre. ¿Cuál cae último?", en: "Every candy carries a name. Which one falls last?" },
      { desde: 2.4, hasta: 4.2, es: "Quedan dos adentro…", en: "Two left inside…" },
      { desde: 4.4, hasta: 8.8, es: "¡Se rompe!", en: "It bursts!" },
    ],
    cierre: { es: "Cada nombre vale lo mismo. Probalo en tinkazo.app y seguinos en @tinkazo.app.", en: "Every name counts the same. Try it at tinkazo.app and follow @tinkazo.app." },
    toque: { es: "En la piñata los caramelos caen abajo: dejá el texto arriba. Cortá el clip en el segundo 4 y repetí el golpe en cámara lenta (50 %) durante un segundo, antes de seguir.", en: "In the piñata the candies fall low: keep your text high. Cut the clip at second 4 and replay the hit in slow motion (50%) for one second before continuing." },
    hashtags: "#tinkazo #sorteo #bolivia #pinata",
  },
  {
    juego: "trompo",
    titulo: { es: "Dos trompos y uno solo sigue bailando", en: "Two spinning tops and only one keeps dancing" },
    gancho: { es: "Quedan dos trompos. Solo uno sigue bailando.", en: "Two tops left. Only one keeps spinning." },
    voz: {
      es: "Un ruedo, un trompo por persona. Chocan, se tumban entre ellos y al final queda uno solo girando.",
      en: "One ring, one top per person. They crash, knock each other out, and in the end only one is left spinning.",
    },
    momentos: [
      { t: "0 a 4", es: "Dos trompos se buscan y chocan en el ruedo.", en: "Two tops find each other and crash in the ring." },
      { t: "4 a 9", es: "Uno se tambalea, parece que cae, y no cae.", en: "One wobbles, looks like it will fall, and does not." },
      { t: "9 a 12", es: "Se apaga el otro trompo y sale el cartel: el último en pie.", en: "The other top stops and the banner appears: the last one standing." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Quedan dos trompos. Solo uno sigue bailando.", en: "Two tops left. Only one keeps spinning." },
      { desde: 2.5, hasta: 5, es: "¡Choque!", en: "Crash!" },
      { desde: 5.2, hasta: 8, es: "¿Se cae? ¡No se cae!", en: "Does it fall? It does not!" },
      { desde: 8.2, hasta: 9.7, es: "El último trompo en pie", en: "The last top standing" },
    ],
    cierre: { es: "Cada trompo es una persona de la lista. Mirá cómo se hace en tinkazo.app y seguinos en @tinkazo.app.", en: "Every top is a person on the list. See how it works at tinkazo.app and follow @tinkazo.app." },
    toque: { es: "Poné un golpe seco en cada choque (un efecto de sonido de impacto) y un zumbido que baja de tono cuando se apaga el trompo.", en: "Add a dry thud on every crash (an impact sound effect) and a hum that drops in pitch when the top stops." },
    hashtags: "#tinkazo #sorteo #bolivia #trompo",
  },
  {
    juego: "sapo",
    titulo: { es: "El juego de las ferias, con tu nombre en cada agujero", en: "The fair game, with your name in every hole" },
    gancho: { es: "El juego de las ferias, con un nombre en cada agujero.", en: "The fair game, with a name in every hole." },
    voz: {
      es: "Es el sapo de las ferias de toda la vida, pero cada agujero lleva el nombre de alguien. Último tiro, ¿en cuál entra?",
      en: "It is the classic fair frog toss, but every hole carries somebody's name. Last throw: which hole does it land in?",
    },
    momentos: [
      { t: "0 a 5", es: "Una mano tira la argolla: pega en la madera, baila en un borde y sale.", en: "A hand throws the ring: it hits the wood, dances on a rim and bounces out." },
      { t: "5 a 8", es: "La última argolla entra al agujero y el aro se enciende.", en: "The last ring drops into the hole and its rim lights up." },
      { t: "8 a 12", es: "El nombre de ese agujero crece y sale el cartel.", en: "The name on that hole grows and the banner appears." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "El juego de las ferias, con un nombre en cada agujero.", en: "The fair game, with a name in every hole." },
      { desde: 2.5, hasta: 5, es: "Último tiro…", en: "Last throw…" },
      { desde: 5.2, hasta: 8.7, es: "¡ADENTRO!", en: "RIGHT IN!" },
    ],
    cierre: { es: "El sapo de siempre, para sortear en grupo. tinkazo.app y @tinkazo.app.", en: "The classic frog toss, for drawing in a group. tinkazo.app and @tinkazo.app." },
    toque: { es: "Dejá un segundo de silencio antes del cartel ¡ADENTRO! y subí la voz justo ahí: es el golpe del video.", en: "Leave one second of silence before the RIGHT IN! banner and raise your voice right there: it is the punch of the video." },
    hashtags: "#tinkazo #sorteo #bolivia #sapo #ferias",
  },
  {
    juego: "guajojo",
    titulo: { es: "Si el guajojó te escucha, quedate quieto", en: "If the guajojó hears you, stand still" },
    gancho: { es: "Si canta, caminás. Si calla, quieto.", en: "If it sings, you walk. If it stops, freeze." },
    voz: {
      es: "En el monte, de noche, el pájaro canta y todos caminan. Cuando calla, nadie se mueve. Quedan dos: ¿quién aguanta?",
      en: "In the forest at night the bird sings and everybody walks. When it goes quiet, nobody moves. Two are left: who holds on?",
    },
    momentos: [
      { t: "0 a 2", es: "Quedan los dos últimos en el sendero, cada uno en un pie.", en: "The last two stand on the trail, each on one foot." },
      { t: "2 a 6", es: "El guajojó mira, se oye un crac y uno se sienta.", en: "The guajojó looks, a crack is heard and one sits down." },
      { t: "6 a 12", es: "Amanece: sale el sol y el cartel dice quién llegó de pie.", en: "Dawn breaks: the sun comes up and the banner says who made it standing." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Si canta, caminás. Si calla, quieto.", en: "If it sings, you walk. If it stops, freeze." },
      { desde: 2.5, hasta: 5, es: "Quedan dos. ¿Quién aguanta?", en: "Two left. Who holds on?" },
      { desde: 5.2, hasta: 6.9, es: "¡CRAC! Te escuchó.", en: "CRACK! It heard you." },
      { desde: 7.1, hasta: 8.6, es: "Amanece…", en: "Dawn…" },
    ],
    cierre: { es: "Un juego del oriente para sortear. tinkazo.app y @tinkazo.app.", en: "A game from the lowlands for drawing. tinkazo.app and @tinkazo.app." },
    toque: { es: "Bajá la música a casi cero cuando el pájaro calla y subila de golpe en el crac. Sin música se siente igual de bien.", en: "Drop the music to almost nothing when the bird goes quiet and bring it back on the crack. It feels just as good without music." },
    hashtags: "#tinkazo #sorteo #bolivia #guajojo #santacruz",
  },
  {
    juego: "toborochi",
    titulo: { es: "El árbol panzón soltó todas sus flores menos dos", en: "The potbellied tree let go of every flower but two" },
    gancho: { es: "El árbol panzón de Santa Cruz soltó todas sus flores menos dos.", en: "Santa Cruz's potbellied tree dropped all its flowers but two." },
    voz: {
      es: "Cada persona es una flor del toborochi. El viento tumba las que sobran y llega un colibrí a elegir entre las dos últimas.",
      en: "Every person is a flower on the toborochi. The wind knocks down the extras and a hummingbird comes to choose between the last two.",
    },
    momentos: [
      { t: "0 a 2", es: "Quedan dos flores en la copa del toborochi.", en: "Two flowers are left in the toborochi's crown." },
      { t: "2 a 7", es: "Llega el colibrí, duda frente a una flor, va a la otra, vuelve.", en: "The hummingbird arrives, hesitates at one flower, goes to the other, comes back." },
      { t: "7 a 11.5", es: "Se posa: la flor se enciende y los pétalos suben en remolino con el cartel.", en: "It lands: the flower lights up and petals swirl up with the banner." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "El árbol panzón de Santa Cruz soltó todas sus flores menos dos.", en: "Santa Cruz's potbellied tree dropped all its flowers but two." },
      { desde: 2.5, hasta: 4.4, es: "Llega el colibrí…", en: "The hummingbird arrives…" },
      { desde: 4.6, hasta: 8.1, es: "¿En cuál se posa?", en: "Which one does it land on?" },
    ],
    cierre: { es: "Una flor por persona. tinkazo.app y @tinkazo.app.", en: "One flower per person. tinkazo.app and @tinkazo.app." },
    toque: { es: "Si ponés música, que sea suave y sin letra: el zumbido del colibrí ya es el sonido del clip.", en: "If you add music, keep it soft and without lyrics: the hummingbird's buzz is already the clip's sound." },
    hashtags: "#tinkazo #sorteo #bolivia #toborochi #santacruz",
  },
  {
    juego: "chovena",
    titulo: { es: "Se corta la música y todos quietos", en: "The music cuts and everybody freezes" },
    gancho: { es: "Se corta la música… ¡y todos quietos!", en: "The music cuts… and everybody freezes!" },
    voz: {
      es: "Una rueda de baile chiquitano: todos de la mano. Cuando la música se corta, quien se mueve sale. ¿Quién queda de pie?",
      en: "A Chiquitano dance circle: everybody holding hands. When the music cuts, whoever moves is out. Who is left standing?",
    },
    momentos: [
      { t: "0 a 3", es: "La rueda gira y se corta la música: quedan pocos bailando.", en: "The circle turns and the music cuts: only a few are left dancing." },
      { t: "3 a 6", es: "Última vuelta, de la mano, hasta que se corta otra vez.", en: "A last turn, holding hands, until the music cuts again." },
      { t: "6 a 12", es: "¡Quietos! Alguien se suelta y el cartel nombra a quien quedó.", en: "Freeze! Someone lets go and the banner names whoever stayed." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Se corta la música… ¡y todos quietos!", en: "The music cuts… and everybody freezes!" },
      { desde: 2.5, hasta: 6, es: "La última vuelta", en: "The last turn" },
      { desde: 6.2, hasta: 9.6, es: "¡QUIETOS!", en: "FREEZE!" },
    ],
    cierre: { es: "Bailamos y comprobamos. tinkazo.app y @tinkazo.app.", en: "We dance and we check. tinkazo.app and @tinkazo.app." },
    toque: { es: "Cortá el sonido de tu música justo cuando el clip se congela: así el corte lo sienten también quienes miran.", en: "Cut your music exactly when the clip freezes: that way the viewers feel the cut too." },
    hashtags: "#tinkazo #sorteo #bolivia #chovena #santacruz",
  },
  {
    juego: "oruro",
    titulo: { es: "Las fraternidades llegan al Socavón", en: "The fraternities reach the Socavón" },
    gancho: { es: "Ya se ve el Socavón. ¿Quién llega primero?", en: "The Socavón is in sight. Who gets there first?" },
    voz: {
      es: "Cinco fraternidades bailan por las cuadras de Oruro y van quedando atrás. Al final, dos bailarines cara a cara frente al Socavón.",
      en: "Five fraternities dance down the streets of Oruro and drop out one by one. At the end, two dancers face to face in front of the Socavón.",
    },
    momentos: [
      { t: "0 a 2", es: "Ya se ve el Socavón y quedan solo dos bailarines.", en: "The Socavón is in sight and only two dancers remain." },
      { t: "2 a 7", es: "Cara a cara, avanzan uno al lado del otro.", en: "Face to face, they advance side by side." },
      { t: "7 a 12", es: "Se oyen las campanas, uno llega y el cartel dice su nombre.", en: "The bells ring, one arrives and the banner says the name." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Ya se ve el Socavón. ¿Quién llega primero?", en: "The Socavón is in sight. Who gets there first?" },
      { desde: 2.5, hasta: 6.5, es: "Cara a cara", en: "Face to face" },
      { desde: 6.8, hasta: 8.6, es: "¡Suenan las campanas!", en: "The bells ring!" },
    ],
    cierre: { es: "Un homenaje al carnaval de Oruro. tinkazo.app y @tinkazo.app.", en: "A tribute to the Oruro carnival. tinkazo.app and @tinkazo.app." },
    toque: { es: "Es un juego con mucho color y los bailarines van abajo: dejá el texto corto y arriba, entre el 15 % y el 40 % de la altura.", en: "This game is full of color and the dancers sit low: keep the text short and high, between 15% and 40% of the height." },
    hashtags: "#tinkazo #sorteo #bolivia #oruro #carnaval",
  },
  {
    juego: "teleferico",
    titulo: { es: "Un teleférico, una cabina por grupo", en: "One cable car, one cabin per group" },
    gancho: { es: "Un teleférico. En cada estación se baja alguien.", en: "One cable car. At every station someone gets off." },
    voz: {
      es: "Cada cabina lleva a un grupo. En cada estación se baja uno y, al final, solo quedan dos subiendo juntos hasta la cumbre.",
      en: "Each cabin carries a group. At every station one gets off and at the end only two are left, riding up together to the summit.",
    },
    momentos: [
      { t: "0 a 3", es: "En la última estación se bajan de a uno y en la cabina quedan pocos.", en: "At the last station they get off one by one and only a few are left in the cabin." },
      { t: "3 a 7", es: "Los dos últimos suben juntos por el cable, hasta la cumbre.", en: "The last two ride up the cable together, all the way to the summit." },
      { t: "7 a 12", es: "Llegan arriba, se abre la puerta y el cartel dice quién.", en: "They reach the top, the door opens and the banner says who." },
    ],
    pantalla: [
      { desde: 0, hasta: 2.2, es: "Un teleférico. En cada estación se baja alguien.", en: "One cable car. At every station someone gets off." },
      { desde: 2.5, hasta: 5.5, es: "Quedan dos, y suben juntos", en: "Two left, riding up together" },
      { desde: 5.8, hasta: 8.7, es: "Hasta la cumbre…", en: "All the way to the summit…" },
    ],
    cierre: { es: "El teleférico de La Paz, hecho sorteo. tinkazo.app y @tinkazo.app.", en: "La Paz's cable car, turned into a draw. tinkazo.app and @tinkazo.app." },
    toque: { es: "Poné un sonido suave de viento de altura de fondo y bajalo cuando se abre la puerta.", en: "Add a soft high-altitude wind sound in the background and lower it when the door opens." },
    hashtags: "#tinkazo #sorteo #bolivia #teleferico #lapaz",
  },
];

// ───────────────────────── Lo que se baja: el guion como texto y como subtítulos ─────────────────────────

const ROTULOS: Record<Idioma, { gancho: string; voz: string; momentos: string; pantalla: string; cierre: string; toque: string; descripcion: string; seg: string; guion: string }> = {
  es: { gancho: "GANCHO (0 a 2 s)", voz: "LO QUE PODÉS DECIR", momentos: "LOS MOMENTOS", pantalla: "TEXTO EN PANTALLA", cierre: "CIERRE", toque: "EN CAPCUT, ADEMÁS", descripcion: "PARA LA DESCRIPCIÓN", seg: "s", guion: "GUION" },
  en: { gancho: "HOOK (0 to 2 s)", voz: "WHAT YOU CAN SAY", momentos: "THE MOMENTS", pantalla: "ON-SCREEN TEXT", cierre: "CLOSER", toque: "IN CAPCUT, ALSO", descripcion: "FOR THE CAPTION", seg: "s", guion: "SCRIPT" },
};

const num = (n: number): string => String(n).replace(".", idiomaPunto);
const idiomaPunto = ",";
const segundos = (n: number, lang: Idioma): string => (lang === "es" ? num(n) : String(n));

/**
 * Un guion como texto plano: para copiar al portapapeles o para el archivo .txt del kit. `publicado` dice si los clips
 * ya se pueden bajar (cambia la línea del clip y el paso 1): los .txt que viajan con los clips se arman con `true`.
 */
export function guionComoTexto(g: Guion, lang: Idioma, publicado: boolean = KIT_PUBLICADO): string {
  const r = ROTULOS[lang];
  const pasos = pasosActuales(publicado);
  const a = lang === "es" ? "a" : "to";
  const clip = CLIPS.find((c) => c.juego === g.juego);
  const lineas: string[] = [];
  lineas.push(`${r.guion}: ${g.titulo[lang]}`);
  if (clip) lineas.push(publicado ? `Clip: ${clip.archivo}` : `Clip: ${clip.archivo} (${lang === "es" ? "se publica pronto, y mientras tanto podés grabar el ejemplo" : "coming soon, and meanwhile you can record the example"}: ${urlEjemplo(g.juego)})`);
  lineas.push("", r.gancho, g.gancho[lang]);
  lineas.push("", r.voz, g.voz[lang]);
  lineas.push("", r.momentos, ...g.momentos.map((m) => `${m.t.replace(" a ", ` ${a} `)} ${r.seg}: ${m[lang]}`));
  lineas.push("", r.pantalla, ...g.pantalla.map((l) => `${segundos(l.desde, lang)} ${a} ${segundos(l.hasta, lang)} ${r.seg}: ${l[lang]}`));
  lineas.push("", r.cierre, g.cierre[lang]);
  lineas.push("", r.toque, g.toque[lang]);
  lineas.push("", r.descripcion, `${WEB} ${INSTAGRAM} ${g.hashtags}`);
  if (pasos.length) {
    lineas.push("", lang === "es" ? "CÓMO ARMARLO EN CAPCUT" : "PUTTING IT TOGETHER IN CAPCUT", ...pasos.map((p, i) => `${i + 1}. ${p[lang]}`));
  }
  return `${lineas.join("\n")}\n`;
}

const dos = (n: number): string => String(n).padStart(2, "0");
/** El tiempo de un subtítulo SRT: 00:00:02,400. */
export function tiempoSrt(seg: number): string {
  const ms = Math.round(seg * 1000);
  return `${dos(Math.floor(ms / 3_600_000))}:${dos(Math.floor(ms / 60_000) % 60)}:${dos(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, "0")}`;
}

/** Los subtítulos .srt del texto en pantalla de un guion, en un idioma. */
export function subtitulosSrt(g: Guion, lang: Idioma): string {
  return `${g.pantalla.map((l, i) => `${i + 1}\n${tiempoSrt(l.desde)} --> ${tiempoSrt(l.hasta)}\n${l[lang]}\n`).join("\n")}`;
}

/** Los nombres de los archivos de guion y de subtítulos de cada juego, en el kit. */
export const archivoGuion = (g: Guion, lang: Idioma): string => `tinkazo-guion-${nombreCorto(g.juego)}-${lang}.txt`;
export const archivoSubtitulos = (g: Guion, lang: Idioma): string => `tinkazo-subtitulos-${nombreCorto(g.juego)}-${lang}.srt`;
function nombreCorto(juego: string): string {
  return CLIPS.find((c) => c.juego === juego)?.archivo.replace(/^tinkazo-/, "").replace(/-9x16\.mp4$/, "") ?? juego;
}
