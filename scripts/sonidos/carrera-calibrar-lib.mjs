/**
 * La lógica de `carrera-calibrar.mjs`: de lo que se midió a los niveles de `src/sonidos/carrera-niveles.ts`.
 *
 * Cada candidata (a, b, c; y `base` en la música) tiene un `trim` (el bus de la banda o de la música) y un `nivel` (el
 * volumen de sus notas y soplos). Después de medir cuánto se aleja de su meta, se corrige un 85 % de la diferencia (la música
 * pasa por un compresor y un limitador: no es lineal, y así se llega en dos o tres vueltas sin pasarse).
 */

const CLAVES = (pieza) => (pieza === "musica" ? ["trim"] : ["trim", "nivel"]);
const redondear = (x) => Math.round(x * 100) / 100;

/** Los niveles nuevos. `medidas` es lo que escribe `carrera-medir.mjs` (`medidas.json`). */
export function nuevosNiveles(actuales, medidas, { fraccion = 0.85, tope = 12 } = {}) {
  const nuevos = {};
  for (const [k, v] of Object.entries(actuales)) nuevos[k] = { ...v };
  const cambios = [];
  for (const m of medidas) {
    if (m.eleccion === "hoy") continue;
    const clave = `${m.pieza}/${m.eleccion}`;
    if (!nuevos[clave]) continue;
    const factor = Math.pow(10, (m.correccionDb * fraccion) / 20);
    const antes = { ...nuevos[clave] };
    for (const c of CLAVES(m.pieza)) {
      if (nuevos[clave][c] === undefined) continue;
      nuevos[clave][c] = redondear(Math.min(tope, Math.max(0.05, nuevos[clave][c] * factor)));
    }
    cambios.push({ clave, correccionDb: m.correccionDb, antes, despues: { ...nuevos[clave] } });
  }
  return { nuevos, cambios };
}

/** El texto de `carrera-niveles.ts` con estos niveles. */
export function textoDeNiveles(niveles) {
  const filas = Object.entries(niveles)
    .map(([k, v]) => `  "${k}": { ${Object.entries(v).map(([c, x]) => `${c}: ${x}`).join(", ")} },`)
    .join("\n");
  return `/**
 * Cuánto suena cada candidata de la carrera, medido.
 *
 * El show nuevo suena a −18 LUFS (hoy, a −29): la música sube unos 10 dB y los efectos tienen que subir con ella o
 * quedan debajo, inaudibles. Estos números los escribe \`scripts/sonidos/carrera-calibrar.mjs\` después de renderizar
 * y medir cada candidata (\`carrera-render.mjs\` y \`carrera-medir.mjs\`): \`trim\` sube el bus de la banda o de la música
 * (instrumentos de \`src/music.ts\`) y \`nivel\` multiplica el volumen de las notas y los soplos de la pieza. No se
 * tocan a mano: se vuelve a calibrar.
 */
export const NIVELES: Readonly<Record<string, { trim?: number; nivel?: number }>> = {
${filas}
};
`;
}

/** Lee los niveles del texto de `carrera-niveles.ts`. */
export function leerNiveles(texto) {
  const out = {};
  for (const m of texto.matchAll(/^\s*"([^"]+)":\s*\{([^}]*)\}/gm)) {
    const v = {};
    for (const par of m[2].split(",")) {
      const [c, x] = par.split(":").map((s) => s.trim());
      if (c && x !== undefined && x !== "") v[c] = Number(x);
    }
    out[m[1]] = v;
  }
  return out;
}
