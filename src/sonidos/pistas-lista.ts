import race from "./pistas/race.json";

/**
 * Las pistas de música que conoce el sitio, por juego: solo los números de cada una (el pulso, los bordes de cada
 * sección, los bucles y las ganancias, ver `leerPista` en `pistas.ts`). Los archivos de audio no viajan con el
 * repositorio: los entrega el servicio propio de la música (`workers/musica`), y cada JSON dice cómo se llaman.
 *
 * **Solo entran las pistas que ya se escucharon dentro del juego.** El interruptor es uno solo para todos los juegos
 * (`?musica=pistas` o `VITE_MUSICA=pistas`, ver `pistas-enganche.ts`): una pista que está acá suena apenas se prende, con
 * la ganancia que diga su JSON. Hoy es solo la carrera. Las de los otros ocho juegos con pista armada (la ruleta, el
 * trompo, el sapo, La Entrada, la piñata, Toborochi, el teleférico y Guajojó) están en `src/sonidos/pistas/<juego>.json`,
 * sin importar: no entran al paquete del sitio y los juegos suenan con la música de siempre. La chovena no tiene pista:
 * sus bailarines pisan en el tiempo de la música de osciladores.
 *
 * Para sumar un juego: oírlo dentro del juego (`?musica=pistas&pistasdesde=<dirección>`), importar su JSON acá y agregar
 * su nombre a `APROBADAS` en `pistas-lista.test.ts`, en el mismo commit. Una pista que cambia lleva otra versión y otros
 * nombres de archivo, porque el servicio los entrega como inmutables.
 *
 * Que esté acá no la hace sonar sin más: hace falta el interruptor prendido y que el servicio entregue los archivos. Sin
 * eso, o ante cualquier falla de la red, suena la música de siempre.
 */
export const PISTAS: Readonly<Record<string, unknown>> = { race };
