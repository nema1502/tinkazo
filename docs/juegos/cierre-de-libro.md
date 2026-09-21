# Cierre de Libro

Tarjetas flotando como papeles sueltos y una barra luminosa que las va barriendo hasta que queda una sola, sellada.

**Identificador:** `ledger` · **Probalo:** [tinkazo.vercel.app/?demo=ledger](https://tinkazo.vercel.app/?demo=ledger) · **Agregado:** 20 de septiembre de 2026

## Por qué existe

Por un hueco concreto: **no había nada para doscientas personas**. La ruleta se vuelve ilegible pasando los veinticuatro nombres y la carrera solo muestra ocho carriles. Un evento de doscientos inscritos no tenía juego propio.

Este es el único que se ve *mejor* cuanta más gente hay, porque hay más que barrer.

El nombre viene de que Stellar cierra un ledger cada cinco segundos, que es el argumento de venta que repiten en todas las charlas de la red. El juego dura eso.

## Cómo se ve

- **Fondo:** papel de contador. Trama de puntos de tinta que baja despacio.
- **Las tarjetas:** una por persona, con borde de tinta y sombra dura. Adentro, avatar, nombre y tres barritas del color que le tocó, que parecen un hash.
- **Con muchos nombres** la tarjeta pierde el texto y queda el avatar con la barra de color. Sigue leyéndose como "una transacción" y no como un cuadrado vacío.
- **La barra de cierre:** turquesa, de ancho completo, precedida por un degradado. Pasa de arriba abajo, después de abajo arriba, y así, alternando.
- **Las eliminadas** se desintegran en cuatro cuadraditos que caen rotando.
- **Los sellos:** cuadro magenta con una X para las que quedan afuera, turquesa con un visto para la ganadora.

## El ritmo

| Tramo | Qué pasa |
|---|---|
| 0,0 – 0,8 s | Las tarjetas caen desde arriba y se acomodan con un pequeño rebote. |
| 0,8 – 1,6 s | Primera barrida. Elimina cerca de la mitad. |
| 1,6 – 2,4 s | Segunda barrida, en sentido contrario. Las supervivientes se reacomodan al centro y crecen. |
| 2,4 – 4,0 s | Las barridas que falten, hasta quedar tres, grandes, con nombre y avatar legibles desde el fondo de la sala. |
| 3,2 – 4,2 s | Los sellos, de a uno cada tercio de segundo. Primero las que pierden. |
| 4,2 – 4,6 s | Sello turquesa de confirmado, la tarjeta crece, el número de libro sube en uno. |

Que las perdedoras se sellen primero y la ganadora al final es lo que sostiene la tensión. Cuando quedan tres en pantalla, la sala ya sabe que una de esas gana.

**Cuántas barridas hay depende de cuánta gente hay:** de una a cuatro. Eran tres fijas con cortes del 62%, el 74% y el resto, y con menos de treinta participantes **la última no eliminaba a nadie**. Con dieciocho personas la primera mataba once, la segunda cuatro y la tercera cero: el narrador anunciaba "¡última pasada!", la barra cruzaba la pantalla entera y no pasaba nada. Ahora cada barrida tiene piso y techo para que siempre saque a alguien, y "última pasada" se dice sólo en la última de verdad.

## Cómo está hecho

Vive en [`src/games/ledger.ts`](../../src/games/ledger.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts).

El orden en que las tarjetas van cayendo sale del PRNG sembrado con la ronda de drand. El ganador se pone primero en esa lista para que ninguna barrida lo toque. **El resultado no lo decide este archivo:** llega dado desde el protocolo.

La grilla se recalcula después de cada barrida, así que las que sobreviven se agrandan solas. Con dos participantes hay una sola barrida y dos tarjetas.

## Cuándo usarlo

Cuando hay mucha gente o poco tiempo. Es el más corto de los cinco y el único que muestra a los doscientos a la vez. Cuando la lista pasa de veinticuatro nombres y el juego elegido era la ruleta, Tinkazo cambia solo a este.

## Qué mira el auditor

```bash
node scripts/audit-game.mjs ledger
```
