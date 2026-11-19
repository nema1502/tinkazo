/**
 * Los textos para quien nos pone de sponsor: la descripción en 25, 50 y 100 palabras, tres publicaciones para redes
 * (cuando se anuncia, durante el evento y para agradecer), cómo se escribe el nombre y dónde encontrarnos.
 * Son los mismos de marca.html (claves maSp* de src/i18n.ts): la prueba exige que coincidan palabra por palabra.
 */
export const TEXTOS_SPONSOR = {
  es: {
    d25: "Tinkazo hace sorteos que cualquiera puede comprobar. La lista se cierra antes de sortear y el ganador sale de un número público. Participar es gratis.",
    d50: "Tinkazo es una herramienta boliviana para hacer sorteos que cualquiera puede comprobar. Quien organiza pega la lista, Tinkazo la cierra antes de sortear y el ganador sale de un número público que nadie conoce antes. El resultado se cuenta en pantalla con juegos de Bolivia, como la carrera de llamas.",
    d100: "Tinkazo es una herramienta boliviana para hacer sorteos que cualquiera puede comprobar, pensada para comunidades, meetups, clases y eventos. Quien organiza pega la lista de participantes y Tinkazo la cierra antes de sortear, así nadie puede cambiarla después. El ganador sale de un número público que nadie conoce de antemano, y cualquiera puede repetir la cuenta desde un enlace o un QR. El resultado se cuenta en la pantalla con diez juegos de Bolivia, como la carrera de llamas, el Guajojó, el Toborochi o La Entrada. Participar en un sorteo es gratis, siempre. Más en tinkazo.app y en Instagram, @tinkazo.app.",
    posts: [
      "Damos la bienvenida a Tinkazo como sponsor del DevFest Tarija. Tinkazo hace sorteos que cualquiera puede comprobar: la lista se cierra antes de sortear y el ganador sale de un número público. Conocelos en tinkazo.app y en @tinkazo.app",
      "Tinkazo, sponsor del DevFest Tarija, hace sorteos que cualquiera puede comprobar. Probá uno con tus amigos en tinkazo.app y comprobá el resultado vos mismo. Gracias, @tinkazo.app",
      "Gracias a Tinkazo por acompañarnos como sponsor del DevFest Tarija. En sus sorteos, cada ganador se puede comprobar desde el enlace del sorteo. Seguilos en @tinkazo.app",
    ],
    nombre: "Tinkazo, todo junto, con K y con la T mayúscula. Nunca Tincazo, TinkaZo ni Tinkazo App.",
    donde: "Sitio: tinkazo.app. Instagram: @tinkazo.app. Contacto: hola@tinkazo.app",
  },
  en: {
    d25: "Tinkazo runs draws anyone can check. The list is locked before the draw and the winner comes from a public number. Taking part is free.",
    d50: "Tinkazo is a tool from Bolivia for running draws that anyone can check. The organizer pastes the list, Tinkazo locks it before the draw and the winner comes from a public number nobody knows in advance. The result is shown on screen with games from Bolivia, like the llama race.",
    d100: "Tinkazo is a tool from Bolivia for running draws anyone can check, made for communities, meetups, classes and events. The organizer pastes the list of participants and Tinkazo locks it before the draw, so nobody can change it afterwards. The winner comes from a public number nobody knows in advance, and anyone can redo the math from a link or a QR code. The result is shown on screen with ten games from Bolivia, like the llama race, the Guajojó, the Toborochi or La Entrada. Taking part in a draw is always free. More at tinkazo.app and on Instagram, @tinkazo.app.",
    posts: [
      "We welcome Tinkazo as a sponsor of DevFest Tarija. Tinkazo runs draws anyone can check: the list is locked before the draw and the winner comes from a public number. Find them at tinkazo.app and @tinkazo.app",
      "Tinkazo, a sponsor of DevFest Tarija, runs draws anyone can check. Try one with your friends at tinkazo.app and check the result yourself. Thanks, @tinkazo.app",
      "Thank you to Tinkazo for joining us as a sponsor of DevFest Tarija. In their draws, every winner can be checked from the draw's link. Follow them at @tinkazo.app",
    ],
    nombre: "Tinkazo, one word, with a K and a capital T. Never Tincazo, TinkaZo or Tinkazo App.",
    donde: "Site: tinkazo.app. Instagram: @tinkazo.app. Contact: hola@tinkazo.app",
  },
};

/** Cuántas palabras tiene un texto (las separa el espacio). */
export const palabras = (s) => s.trim().split(/\s+/).length;

/** El archivo de texto que va en el kit para sponsors, con todo lo de arriba listo para copiar. */
export function textosSponsorTxt() {
  const bloque = (lang) => {
    const t = TEXTOS_SPONSOR[lang], es = lang === "es";
    return [
      es ? "TINKAZO, TEXTOS PARA SPONSORS" : "TINKAZO, TEXTS FOR SPONSORS",
      "==============================",
      "",
      es ? "CÓMO SE ESCRIBE" : "HOW TO WRITE IT", t.nombre, "",
      es ? "DÓNDE ENCONTRARNOS" : "WHERE TO FIND US", t.donde, "Instagram: https://www.instagram.com/tinkazo.app/", "",
      es ? "DESCRIPCIÓN EN 25 PALABRAS" : "DESCRIPTION IN 25 WORDS", t.d25, "",
      es ? "DESCRIPCIÓN EN 50 PALABRAS" : "DESCRIPTION IN 50 WORDS", t.d50, "",
      es ? "DESCRIPCIÓN EN 100 PALABRAS" : "DESCRIPTION IN 100 WORDS", t.d100, "",
      es ? "PARA REDES: TEXTOS SUGERIDOS PARA QUE PUBLIQUEN LOS ORGANIZADORES" : "FOR SOCIAL MEDIA: TEXTS SUGGESTED FOR THE ORGANIZERS TO PUBLISH",
      es ? "Cambialos como quieras. Si acordamos algo más (un sorteo o un lugar en el evento), sumalo."
        : "Change them as you like. If we agree on something more (a draw or a spot at the event), add it.", "",
      es ? "Texto sugerido, cuando se anuncia:" : "Suggested text, when it is announced:", t.posts[0], "",
      es ? "Texto sugerido, el día del evento:" : "Suggested text, on the day:", t.posts[1], "",
      es ? "Texto sugerido, para agradecer:" : "Suggested text, to say thanks:", t.posts[2], "",
      es ? "Sumá las etiquetas del evento. Decí sorteo, no rifa. Entrar a un sorteo de Tinkazo es gratis."
        : "Add the event's tags. Say draw, not raffle. Entering a Tinkazo draw is free.",
    ].join("\n");
  };
  return `${bloque("es")}\n\n-------------------------------------------------------------------------------\n\n${bloque("en")}\n`.replace(/\n/g, "\r\n");
}

/** Cinco preguntas para coordinar con quien organiza: lo que necesitamos saber para preparar las piezas a tiempo. */
export const PREGUNTAS = {
  es: [
    "¿En qué formato y tamaño necesitan el logo, y para qué fecha?",
    "¿Qué largo tiene la descripción del programa o de la web del evento?",
    "¿Cómo quieren que nombremos al evento en redes, y con qué etiquetas?",
    "¿Habrá un lugar para nosotros (mesa, pared o roll-up) y a qué hora se arma?",
    "¿Quieren hacer algún sorteo del evento con Tinkazo? Entrar es gratis, siempre.",
  ],
  en: [
    "In what format and size do you need the logo, and by what date?",
    "How long is the description for the program or the event website?",
    "How would you like us to name the event on social media, and with which tags?",
    "Will there be a spot for us (a table, a wall or a roll-up) and when does setup start?",
    "Would you like to run any of the event's draws with Tinkazo? Entering is always free.",
  ],
};

/** Las preguntas en un archivo de texto, en los dos idiomas, para responder por correo. */
export function preguntasTxt() {
  const bloque = (lang) => [
    lang === "es" ? "TINKAZO, CINCO PREGUNTAS PARA COORDINAR" : "TINKAZO, FIVE QUESTIONS TO COORDINATE",
    "========================================",
    "",
    ...PREGUNTAS[lang].map((q, i) => `${i + 1}. ${q}\n   `),
    "",
    lang === "es" ? "Respondé debajo de cada una y mandalo a hola@tinkazo.app. Instagram: @tinkazo.app" : "Answer under each one and send it to hola@tinkazo.app. Instagram: @tinkazo.app",
  ].join("\n");
  return `${bloque("es")}\n\n-------------------------------------------------------------------------------\n\n${bloque("en")}\n`.replace(/\n/g, "\r\n");
}
