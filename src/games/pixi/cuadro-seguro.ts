/**
 * Un cuadro del show. Si el código del juego lanza (una textura, el 3D, cualquier juego), el bucle de `stage.ts` se
 * cortaba en silencio: sin el próximo cuadro no llegaba el final, el estadio tapaba la pantalla sin ganador y Saltar
 * no hacía nada. Ahora el error queda en la consola y se cierra el estadio, que muestra el resultado como siempre: el
 * ganador ya salió de la semilla, el show es solo la presentación.
 *
 * Devuelve `true` si el cuadro terminó bien y hay que pedir el siguiente.
 */
export function cuadroOCierre<A>(cuadro: (a: A) => void, a: A, cerrar: () => void): boolean {
  try {
    cuadro(a);
    return true;
  } catch (e) {
    console.warn("[tinkazo] un cuadro del show falló: se cierra el estadio y sale el resultado", e);
    try {
      cerrar();
    } catch (e2) {
      console.warn("[tinkazo] el estadio no se pudo cerrar del todo", e2);
    }
    return false;
  }
}
