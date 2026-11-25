/**
 * Lo que dice la página de escucha (`escucha.html`), en su propio diccionario y no en el de
 * `src/i18n.ts`: esa página es la mesa de trabajo del dueño para elegir la música juego por juego,
 * no parte del sitio, y el diccionario global es lo más pesado que baja la herramienta (`vite.config.ts`).
 * Paridad es/en, probada en `escucha-textos.test.ts`.
 */

export type IdiomaEscucha = "es" | "en";

export const IDIOMAS_ESCUCHA: readonly IdiomaEscucha[] = ["es", "en"];

export const TEXTOS_ESCUCHA = {
  es: {
    titulo: "Página de escucha",
    subtitulo: "Candidatas de música por juego. Ninguna se prende en el sitio sin que alguien la escuche y elija.",
    apagada: "La página de escucha está apagada: abrila con ?escucha=1.",
    capas: "Capas del show",
    capaEspera: "Espera",
    capaTension: "Tensión",
    capaGanador: "Ganador",
    capaFestejo: "Festejo",
    btnTodo: "Todo el show",
    tempo: "Golpes por minuto: largada, grupo y recta",
    ritmos: "Ritmos",
    instrumentos: "Instrumentos",
    etiquetaTexto: "Etiquetas de intención: dicen lo que apunta la identidad, los instrumentos siguen siendo sintetizados.",
    votar: "Voto",
    quitar: "Quitar",
    votos: "votos",
    sinVotos: "todavía nadie votó",
    sinAudio: "Este navegador no tiene audio: escuchalo en un celular, una tablet o el parlante del proyector.",
    preparando: "Armando la pieza…",
    notaSemilla: "La pieza sale de una semilla fija: la misma candidata suena igual cada vez que se escucha.",
    fueraDelSelector: "Juegos que salieron del selector y siguen abriendo con ?demo=",
    probarAdelgazado: "Abrir un show de prueba donde la música se aligera cuando el equipo va lento",
  },
  en: {
    titulo: "Listening page",
    subtitulo: "Music candidates per game. None goes live on the site until someone hears it and picks it.",
    apagada: "The listening page is off: open it with ?escucha=1.",
    capas: "Show layers",
    capaEspera: "Waiting",
    capaTension: "Tension",
    capaGanador: "Winner",
    capaFestejo: "Celebration",
    btnTodo: "The whole show",
    tempo: "Beats per minute: start, pack and straight",
    ritmos: "Rhythms",
    instrumentos: "Instruments",
    etiquetaTexto: "Intent tags: they say what the identity aims for. The instruments are still synthesized.",
    votar: "Vote",
    quitar: "Remove",
    votos: "votes",
    sinVotos: "nobody voted yet",
    sinAudio: "This browser has no audio: try it on a phone, a tablet or the projector speaker.",
    preparando: "Building the piece…",
    notaSemilla: "The piece comes from a fixed seed: the same candidate sounds the same every time.",
    fueraDelSelector: "Games that left the selector and still open with ?demo=",
    probarAdelgazado: "Open a test show where the music thins out when the device is slow",
  },
} as const;

export type ClaveEscucha = keyof typeof TEXTOS_ESCUCHA.es;

/** Un texto de la página, en el idioma dado. */
export const texto = (lang: IdiomaEscucha, clave: ClaveEscucha): string => TEXTOS_ESCUCHA[lang][clave];

/**
 * El idioma del que escucha: el de `?lang=`, y si no viene, el que ya eligió en el sitio (`tinkazo.lang`). Sin nada, español.
 */
export const idiomaDeLaEscucha = (search: string = typeof location === "undefined" ? "" : location.search): IdiomaEscucha => {
  const pedido = new URLSearchParams(search).get("lang");
  if (pedido === "en" || pedido === "es") return pedido;
  try {
    return localStorage.getItem("tinkazo.lang") === "en" ? "en" : "es";
  } catch {
    return "es";
  }
};

/**
 * El nombre de cada juego, en el idioma del dueño. Los ids son los del show
 * (`Game`, en `src/state.ts`); su llave u orden lo pone `IDENTIDADES` en music.ts.
 */
export const NOMBRES_ESCUCHA: Readonly<Record<string, { es: string; en: string }>> = {
  // Los diez del selector, con el nombre con que el selector los muestra.
  race: { es: "Carrera de llamas", en: "Llama race" },
  sapo: { es: "Sapo", en: "Sapo" },
  trompo: { es: "Trompo", en: "Spinning tops" },
  chovena: { es: "Chovena", en: "Chovena" },
  pinata: { es: "Piñata", en: "Piñata" },
  wheel: { es: "Ruleta", en: "Wheel" },
  teleferico: { es: "Teleférico", en: "Cable car" },
  oruro: { es: "La Entrada", en: "La Entrada" },
  guajojo: { es: "Guajojó", en: "Guajojó" },
  toborochi: { es: "El Toborochi", en: "The Toborochi" },
  // Los que salieron del selector y siguen abriendo con ?demo=.
  stellar: { es: "Constelación Stellar", en: "Stellar Constellation" },
  ledger: { es: "Cierre de Libro", en: "Ledger Close" },
  rockets: { es: "Carrera de cohetes", en: "Rocket race" },
  pasanaku: { es: "Aguayo", en: "Aguayo" },
  tombola: { es: "Tómbola", en: "Ball drum" },
  totora: { es: "Balsas de totora", en: "Reed boats" },
  luz: { es: "Luz roja, luz verde", en: "Red light, green light" },
  quien: { es: "De pie", en: "Stand up" },
  trueque: { es: "El Trueque", en: "El Trueque" },
};

/** El nombre de un juego en el idioma dado; si el id no tiene nombre, el id. */
export const nombreDeJuego = (id: string, lang: IdiomaEscucha): string => NOMBRES_ESCUCHA[id]?.[lang] ?? id;
