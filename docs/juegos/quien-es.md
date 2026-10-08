# ¿Quién es?

Todos los nombres en cartas, con su cara. En cada turno se pregunta por una letra ("¿tiene la R?") y se contesta por quien ganó: si su nombre tiene la R, se dan vuelta las cartas que no la tienen; si no la tiene, se dan vuelta las que sí. Las que quedan se reacomodan más grandes y la cámara se acerca, hasta que queda una sola carta.

**Identificador:** `quien` · **Probarlo:** `/?demo=quien`, `/?pose=quien`, `/?pose=quien&n=50`.

## De dónde sale

Del Ahorcado que propuso Guido Salazar ([@GuidoSV7](https://github.com/GuidoSV7)) el 1 de octubre de 2026. El agente evaluador lo miró con capturas el 2 de octubre y encontró dos cosas que había que cambiar:

- **La horca.** Un muñeco colgado, aunque sonría, es una horca. En Bolivia además evoca los muñecos colgados de postes como amenaza, y ante un jurado o en un evento de comunidad es de mal gusto.
- **El largo del nombre** delataba al ganador antes de la primera letra: con la lista de ejemplo, 8 de cada 12 nombres tenían una forma única.

Lo que valía, las letras que achican la lista hasta que queda un nombre, sigue acá, sin horca y sin mostrar el nombre escondido.

## La regla: el juego no decide nada

El ganador sale del [protocolo](../protocolo.md) antes de que empiece el juego. Las preguntas se eligen sabiendo quién es ([`quien-plan.ts`](../../src/games/pixi/quien-plan.ts), puro y probado):

1. Las letras de cada nombre se comparan sin tildes y con la Ñ como N.
2. En cada turno se toma, entre las letras que todavía separan a alguien, la que deja el grupo más cerca de la mitad; entre empates decide el `rng` sembrado de la ronda. La carta del ganador nunca se da vuelta.
3. Así 50 nombres se resuelven en unas seis preguntas y 200 en unas ocho (como mucho diez).
4. Con dos o tres cartas, una sola pregunta lo resolvía todo y el juego era un subtítulo quieto. La ronda arranca entonces con una de calentamiento que no da vuelta a nadie: una letra que tienen todas ("¡Sí tiene A! Todas la tienen"), o si no hay, una que no tiene ninguna. Es verdad igual: la respuesta es la del nombre de quien ganó.
5. Si quedan nombres que no se pueden separar por ninguna letra ("José" y "Jose"), el juego lo dice ("¡Mismas letras! El sorteo ya eligió") y la carta del ganador queda sola: el protocolo ya eligió.
6. Con varios ganadores hay una ronda por cada uno, sin los ganadores anteriores, que esperan arriba a la derecha con un marco amarillo, fijos en la pantalla aunque la cámara se acerque. Las rondas van del último premio al primero, como en una premiación ("¡Va el premio 2: otra vez todas!", "¡Valeria Torrez, premio 2!"): la ronda larga, con el suspenso de la última pregunta, es la del primer premio. Hasta el 7 de octubre de 2026 el primero salía a los siete segundos.

Todo sale de la hora del juego. Sin `Math.random()`.

## Lo que se ve

- **El reparto:** las cartas llegan de abajo, de a una, a la grilla. Desde el primer cuadro hay movimiento.
- **La pregunta**, grande, arriba, en una placa amarilla, y al rato el sello "¡SÍ!" o "¡NO!".
- **Mientras se espera la respuesta** un foco amarillo salta de carta en carta ("¡Mirá tu nombre!"). En la última pregunta frena de a poco y se queda en la carta de quien gana, con un tic-tac de dos notas que se espacia a medida que frena.
- **La respuesta que decide:** la música se corta 0,4 s antes, el sello cae grande en el medio del tablero (con más de dos cartas, o en un celular, donde van pegadas, en el hueco entre la pregunta y las cartas, para no tapar los nombres) y vuelve a su lugar al lado de la pregunta, y suena distinto de las otras (cuerpo grave y dos notas que suben). La música queda cortada desde ahí hasta el cartel, que la vuelve a abrir con el remate: la carta sola late en silencio. Antes la música sonaba a fondo hasta 0,35 s antes del cartel y el golpe del ganador a veces no se distinguía. Se probó que la respuesta abriera el remate, como en el sapo, y el cartel quedaba solo con la fanfarria: el golpe salía negativo o enorme según la corrida.
- **Las cartas que se van** se dan vuelta de canto, muestran el dorso liso con un "?" y se apagan, de a una.
- **Las que quedan** se reacomodan más grandes; con seis o menos la cámara se acerca.
- **El final:** la carta del ganador sola, más cerca (la cámara llega hasta 1,55), con un marco que late y un latido que se oye en un parlante chico.
- **El contador de la casa:** las cartas que siguen sobre las del principio.

Con pocas cartas cada pregunta dura más (hasta cinco segundos y medio), así un sorteo de dos personas no es un parpadeo; la última pregunta tiene un segundo más de suspenso.

## Cuánta gente

Cualquier cantidad, sin tope. Con 200 las cartas arrancan chicas y crecen con cada pregunta.

## Auditoría

```bash
node scripts/audit-rigor.mjs quien --base http://localhost:4173
node scripts/audit-emocion.mjs quien --base http://localhost:4173
node scripts/audit-sound.mjs quien --base http://localhost:4173
```
