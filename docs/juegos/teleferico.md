# Teleférico

Un convoy de cabinas sube por el cable. En cada estación se baja la mitad de los pasajeros, las cabinas que quedan vacías vuelven para abajo, y la última cabina llega sola a la cumbre y abre la puerta.

**Identificador:** `teleferico` · **Probalo:** [tinkazo.vercel.app/?demo=teleferico](https://tinkazo.vercel.app/?demo=teleferico) · **Agregado:** 24 de septiembre de 2026

## Por qué un teleférico

Porque en La Paz y El Alto el teleférico no es una atracción, es el colectivo. Según la empresa que lo construyó, Mi Teleférico es **"the world's biggest urban ropeway network"**: diez líneas, 1.396 cabinas de diez pasajeros y unas trescientas mil personas por día. ([fuente](https://www.doppelmayr.com/en/reference-projects/reference-project-mi-teleferico/))

Y las líneas se llaman por su color: Roja, Amarilla, Verde, Azul, Naranja, Blanca, Celeste, Morada, Café y Plateada. Las cabinas del juego llevan esos diez colores, y la tarjeta de historia lo cuenta después del ganador.

La regla de la casa es que un elemento boliviano tiene que hacer algo o no entra (está en [historia.html](../../historia.html)). Acá el teleférico es el tablero entero: el cable es la barra de progreso, cada estación es una ronda, y la altura dice cuánto falta.

## La mecánica

**Embarque.** Los pasajeros suben a las cabinas en la base. El contador de arriba a la izquierda cuenta los que subieron.

**Las paradas.** El convoy sube hasta una estación y frena; las cabinas se hamacan para adelante. Se bajan los que les tocaba, saltando al andén, y el andén queda marcado con cuántos se bajaron. Si son tres o menos, también con sus nombres. Las cabinas que quedaron vacías se sueltan y vuelven para abajo, y las demás cierran el hueco.

**La última estación.** Quedan dos cabinas, con una persona cada una y su nombre al lado. Suena un latido. Uno se baja.

**El último tramo.** La cabina que queda sube sola, despacio, con el latido cada vez más seguido. Llega a la cumbre, golpe, se abren las puertas y sale el cartel.

## Tres decisiones que no son de estilo

**Los últimos cinco en bajarse van cada uno en una cabina distinta.** El convoy lleva como mucho cinco cabinas, y el reparto se hace de modo que los últimos cinco del orden de bajada queden separados. Así, cuando quedan cinco o menos, cada cabina lleva a una persona y se la puede nombrar. Y la cabina del ganador cae en un puesto sorteado del convoy: si fuera siempre la de adelante, la sala lo aprende al segundo sorteo y se acabó la tensión.

**Con poca gente hay estaciones de largo.** El grupo se parte a la mitad en cada parada, así que dos participantes son una sola parada. En vez de estirar esa parada hasta la cámara lenta, hay como mínimo cuatro estaciones y el convoy pasa de largo por las que sobran. El narrador lo dice: "¡En la 2 no se baja nadie!". Nunca se anuncia una bajada que no ocurre.

**Todo es una función del tiempo de juego.** Dónde está la cabeza del convoy, cuánto se hamaca cada cabina, por dónde va cada pasajero que salta al andén: nada se acumula cuadro a cuadro. Saltar es poner el reloj al final, y la misma ronda dibuja los mismos cuadros en cualquier máquina. El auditor exigente lo comprueba huella por huella.

## Cómo escala

| Participantes | Paradas | Estaciones de largo | Qué se ve |
|---|---|---|---|
| 2 | 1 | 3 | Dos cabinas, un nombre cada una, desde el embarque |
| 3 | 2 | 2 | |
| 5 | 3 | 1 | Cinco cabinas de una persona |
| 18 | 5 | 0 | Cabinas de tres o cuatro, con el conteo en una etiqueta |
| 200 | 8 | 0 | Cinco cabinas de cuarenta. En la primera parada salta una cascada de cien al andén |

Los tiempos no cambian con la cantidad: las paradas se reparten entre el fin del embarque y el último tramo.

## Los tiempos

En segundos de juego, sin estirar. En "normal" se multiplican por 1,6.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 2,0 s | Embarque. "¡Suban, suban, que se va!" |
| 2,0 s | Campana de salida |
| 2,0 – 13,4 s | Viajes y paradas. Viajar pesa 1, parar 0,8 y la última parada 1,7 |
| 13,4 – 15,8 s | El último tramo, a solas |
| 15,8 s | Llega a la cumbre: destello, temblor y golpe |
| 16,4 s | Se abren las puertas y sale el cartel, que se sostiene tres segundos reales |

## El sonido

Todo por la escala de `note()` y dentro de los grados 0 a 20.

- **Embarque:** un clic por pasajero, con tope de once por segundo.
- **El cable:** un zumbido que sube y baja de tono con la velocidad del convoy, igual que el motor de la ruleta.
- **Estaciones:** ding-dong al llegar; una sola campanada al pasar de largo.
- **Los que se bajan:** hasta seis notas que bajan, una por pasajero.
- **Cabina que se suelta:** un golpe seco.
- **La última estación y el último tramo:** un latido grave, cada vez más seguido.
- **La cumbre:** el golpe de la traba, como en la ruleta, y después la fanfarria.

## Cómo está hecho

Vive en [`src/games/cablecar.ts`](../../src/games/cablecar.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts).

La posición de la cabeza del convoy es una función a trozos del tiempo: tramos de viaje con aceleración y frenado suaves, y paradas. Las estaciones de largo se ubican buscando por bisección el instante en que la cabeza pasa por ellas. El hamaque sale de la segunda derivada de esa función, más una oscilación amortiguada después de cada frenada. La cámara sigue a la cabeza con un poco de adelanto.

En vertical el cable se empina (54 grados en vez de 23) y los nombres van al costado de cada cabina, no debajo, porque la cabina de abajo queda justo ahí.
