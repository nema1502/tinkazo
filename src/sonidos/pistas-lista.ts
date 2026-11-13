import race from "./pistas/race.json";
import pinata from "./pistas/pinata.json";

/**
 * Las pistas de música que conoce el sitio, por juego: solo los números de cada una (el pulso, los bordes de cada
 * sección, los bucles y las ganancias, ver `leerPista` en `pistas.ts`). Los archivos de audio no viajan con el
 * repositorio: los entrega el servicio propio de la música (`workers/musica`), y cada JSON dice cómo se llaman.
 *
 * **Solo entran las pistas que ya se escucharon dentro del juego.** El interruptor es uno solo para todos los juegos y va
 * prendido por defecto (lo apagan `?musica=sintetizada` en una pestaña o `VITE_MUSICA=sintetizada` para todos, ver
 * `pistas-enganche.ts`): una pista que está acá suena en el sitio, con la ganancia que diga su JSON. Cuáles están lo fija
 * `APROBADAS` en `pistas-lista.test.ts`. Las demás pistas armadas siguen en `src/sonidos/pistas/<juego>.json`, sin
 * importar: no entran al paquete del sitio y esos juegos suenan con la música de siempre. La chovena no tiene pista: sus
 * bailarines pisan en el tiempo de la música de osciladores.
 *
 * Para sumar un juego: oírlo dentro del juego (`?musica=pistas&pistasdesde=<dirección>`), importar su JSON acá y agregar
 * su nombre a `APROBADAS` en `pistas-lista.test.ts`, en el mismo commit. Una pista que cambia lleva otra versión y otros
 * nombres de archivo, porque el servicio los entrega como inmutables.
 *
 * Que esté acá no la hace sonar sin más: hace falta que el interruptor no esté apagado y que el servicio entregue los
 * archivos. Sin eso, o ante cualquier falla de la red, suena la música de siempre.
 */
export const PISTAS: Readonly<Record<string, unknown>> = { race, pinata };
