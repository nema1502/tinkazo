// La línea que tranquiliza bajo Entrar para sellar (clave sellarSinCuenta de src/i18n.ts), para el auditor de interfaz.
// Se lee del diccionario como texto, en español y en inglés, y se compara la frase COMPLETA: con solo el comienzo, una frase
// distinta que empieza igual pasaba por buena. src/auditor-interfaz.test.ts cuida que esta lectura siga dando las dos frases.

/**
 * Las frases de sellarSinCuenta, en el orden del diccionario: primero español y después inglés. La lectura exige la clave
 * entera en un solo renglón: si alguien la reformatea y no se encuentra, falla con un mensaje claro. Antes la lista quedaba
 * vacía y el auditor comparaba contra nada, sin avisar que había quedado ciego.
 */
export function frasesDeLaLinea(textoDelDiccionario) {
  const frases = [];
  for (const m of textoDelDiccionario.matchAll(/^\s*sellarSinCuenta: ("(?:[^"\\]|\\.)*"),\s*$/gm)) frases.push(JSON.parse(m[1]));
  if (frases.length !== 2) {
    throw new Error(
      `El auditor de interfaz no encontró las dos frases de sellarSinCuenta en src/i18n.ts (halló ${frases.length}). ` +
        "La clave tiene que ir en un solo renglón, con su frase entre comillas dobles, en español y en inglés.",
    );
  }
  return frases;
}

/**
 * ¿El texto de la página es, entero, la frase de su idioma ("es" o "en")? El apóstrofo curvo vale como el recto. Sin un idioma
 * conocido no acepta nada: con una de las dos frases cualquiera, una página en español con la línea en inglés pasaba por buena.
 */
export function esLaLinea(frases, texto, idioma) {
  const indice = { es: 0, en: 1 }[idioma];
  if (indice === undefined || typeof texto !== "string") return false;
  return texto.replace(/[’‘]/g, "'").trim() === frases[indice];
}
