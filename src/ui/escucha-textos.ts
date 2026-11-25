/**
 * Lo que dice la página de escucha (`src/ui/escucha.html`), en su propio diccionario y no en el de
 * `src/i18n.ts`: esa página es la mesa de trabajo del dueño para elegir la música juego por juego (S5),
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
  },
} as const;

export type ClaveEscucha = keyof typeof TEXTOS_ESCUCHA.es;

/** Un texto de la página, en el idioma dado. */
export const texto = (lang: IdiomaEscucha, clave: ClaveEscucha): string => TEXTOS_ESCUCHA[lang][clave];

/** El idioma del que escucha: `?lang=en` para inglés, el resto español. */
export const idiomaDeLaEscucha = (search: string = typeof location === "undefined" ? "" : location.search): IdiomaEscucha =>
  new URLSearchParams(search).get("lang") === "en" ? "en" : "es";

/**
 * El nombre de cada juego, en el idioma del dueño. Los ids son los del show
 * (`Game`, en `src/state.ts`); su llave u orden lo pone `IDENTIDADES` en music.ts.
 */
export const NOMBRES_ESCUCHA: Readonly<Record<string, { es: string; en: string }>> = {
  race: { es: "Carrera de llamas", en: "Llama race" },
  stellar: { es: "Carrera estelar", en: "Stellar race" },
  wheel: { es: "La rueda", en: "The wheel" },
  ledger: { es: "El libro", en: "The ledger" },
  rockets: { es: "Cohetes", en: "Rockets" },
  pasanaku: { es: "Pasanaku", en: "Pasanaku" },
  teleferico: { es: "Teleférico", en: "Cable car" },
  tombola: { es: "Tómbola", en: "Tombola" },
  trompo: { es: "Trompo", en: "Spinning top" },
  totora: { es: "Totora", en: "Totora" },
  pinata: { es: "Piñata", en: "Piñata" },
  oruro: { es: "Oruro", en: "Oruro" },
  luz: { es: "La luz", en: "The light" },
  sapo: { es: "El sapo", en: "The frog" },
  quien: { es: "Quién era", en: "Who was it" },
  chovena: { es: "Chovena", en: "Chovena" },
  trueque: { es: "Trueque", en: "Barter" },
};

/** El nombre de un juego en el idioma dado; si el id no tiene nombre, el id. */
export const nombreDeJuego = (id: string, lang: IdiomaEscucha): string => NOMBRES_ESCUCHA[id]?.[lang] ?? id;
