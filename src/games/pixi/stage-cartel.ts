/**
 * La cuenta del cartel del final de la corona (`crown` de `stage.ts`), aparte
 * para poder probarla sin una placa de video, como `letra.ts` y
 * `ganador-altura.ts`.
 *
 * El issue 118: en un orden de turnos el cartel muestra todos los nombres
 * (quedan hasta ocho en horizontal; más arriba de eso, y en un celular
 * vertical, se recorta) sin achicar la letra. En un sorteo de premios queda
 * en tres, como siempre, que es el mismo tres del relato (`winnersLabel`, en
 * `overlay.ts`), así que cartel y relato cuentan lo mismo.
 */

/**
 * Cuántos nombres reales lista el cartel: hasta tres en un sorteo de premios,
 * como siempre; hasta ocho en un orden de turnos, y seis en un celular
 * vertical (390 de ancho), donde ni ocho filas con cara ni ocho y el resto
 * caben parados sin salirse por arriba. Con más nombres que esos topes, el
 * cartel sigue con los primeros y «y N más».
 */
export const nombresEnCartel = (total: number, turnos: boolean, vertical: boolean): number =>
  Math.max(0, Math.min(total, turnos ? (vertical ? 6 : 8) : 3));

/** Los renglones que dibuja el cartel: uno por nombre y, si quedan nombres fuera, uno más con «y N más». */
export const filasEnCartel = (total: number, turnos: boolean, vertical: boolean): number => {
  const nombres = nombresEnCartel(total, turnos, vertical);
  return nombres + (total > nombres ? 1 : 0);
};

/**
 * Las filas del cartel con `filas` renglones: uno solo, grande; y después el
 * renglón del primero, un poco más grande, y los demás iguales. La altura de
 * cada uno, en unidades `k`. Antes contaba premios y recortaba en tres: el
 * recorte ahora es trabajo de `nombresEnCartel`, que sabe del modo del sorteo.
 */
export const filasCorona = (filas: number, k: number): number[] => {
  if (filas <= 0) return [];
  if (filas === 1) return [60 * k];
  return Array.from({ length: filas }, (_, i) => (i === 0 ? 46 : 38) * k * 1.22);
};

/**
 * Lo que mide de alto el cartel con `filas` renglones, en píxeles de pantalla:
 * la misma cuenta del build (márgenes, «GANA» y los renglones), para la
 * estimación de `placaBajo` cuando la corona de ese tamaño todavía no se armó.
 * `principal` es el alto del renglón del título.
 */
export const altoCartelDe = (filas: number, k: number, principal: number): number =>
  18 * k + principal + filasCorona(filas, k).reduce((a, h) => a + h, 0) + 20 * k;

/**
 * Dónde va el centro del cartel en la pantalla: al centro de siempre (24 % del
 * alto en un celular parado, 26 % de pie). Con un cartel más alto que ese
 * centro, el centro baja hasta el margen superior del cartel (12k): el cartel
 * crece hacia abajo, donde la protección de la cámara (`placaBajo`) ya saca a
 * la escena, y no se sale por arriba de la pantalla.
 */
export const centroCartel = (ph: number, k: number, sh: number, vertical: boolean): number =>
  Math.max((vertical ? 0.24 : 0.26) * sh, 12 * k + ph / 2);
