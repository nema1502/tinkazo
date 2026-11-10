/**
 * Cuánto suena cada candidata de la carrera, medido.
 *
 * El show nuevo suena a −18 LUFS (hoy, a −29): la música sube unos 10 dB y los efectos tienen que subir con ella o
 * quedan debajo, inaudibles. Estos números los escribe `scripts/sonidos/carrera-calibrar.mjs` después de renderizar
 * y medir cada candidata (`carrera-render.mjs` y `carrera-medir.mjs`): `trim` sube el bus de la banda o de la música
 * (instrumentos de `src/music.ts`) y `nivel` multiplica el volumen de las notas y los soplos de la pieza. No se
 * tocan a mano: se vuelve a calibrar.
 */
export const NIVELES: Readonly<Record<string, { trim?: number; nivel?: number }>> = {
  "musica/base": { trim: 3.23 },
  "musica/a": { trim: 4.26 },
  "musica/b": { trim: 3.38 },
  "musica/c": { trim: 4.99 },
  "pasos/a": { nivel: 6.2 },
  "pasos/b": { nivel: 5.88 },
  "pasos/c": { nivel: 6.03 },
  "echarse/a": { nivel: 5.06 },
  "echarse/b": { nivel: 6.66 },
  "echarse/c": { trim: 2.93 },
  "obstaculos/a": { nivel: 5.98 },
  "obstaculos/b": { nivel: 4.92, trim: 4.92 },
  "obstaculos/c": { nivel: 8.98 },
  "final/a": { nivel: 5.16, trim: 5.16 },
  "final/b": { nivel: 11.06, trim: 11.06 },
  "final/c": { nivel: 4.56, trim: 4.56 },
  "festejo/a": { nivel: 4.67, trim: 4.67 },
  "festejo/b": { nivel: 4.94, trim: 4.94 },
  "final/base": { nivel: 1.37, trim: 4.91 },
  "festejo/c": { nivel: 2.34, trim: 2.34 },
};
