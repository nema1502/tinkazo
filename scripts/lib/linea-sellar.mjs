// La línea que tranquiliza bajo Entrar para sellar (clave sellarSinCuenta de src/i18n.ts), para el auditor de interfaz.
// Se lee del diccionario como texto, en español y en inglés, y se compara la frase COMPLETA: con solo el comienzo, una frase
// distinta que empieza igual pasaba por buena. src/auditor-interfaz.test.ts cuida que esta lectura siga dando las dos frases.

/** Las frases de sellarSinCuenta, en el orden del diccionario: primero español y después inglés. */
export function frasesDeLaLinea(textoDelDiccionario) {
  const frases = [];
  for (const m of textoDelDiccionario.matchAll(/^\s*sellarSinCuenta: ("(?:[^"\\]|\\.)*"),\s*$/gm)) frases.push(JSON.parse(m[1]));
  return frases;
}

/** ¿El texto de la página es, entero, una de las frases? El apóstrofo curvo vale como el recto. */
export function esLaLinea(frases, texto) {
  return typeof texto === "string" && frases.includes(texto.replace(/[’‘]/g, "'").trim());
}
