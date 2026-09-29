# Trompo

El juego de patio. Un ruedo de tiza en el suelo, cada participante tira su trompo adentro y bailan. Después empiezan los choques: los trompos se sacan del ruedo o se quedan sin cuerda y se caen, hasta que quedan dos en un mano a mano. Gana el último que sigue bailando.

**Identificador:** `trompo` · **Probalo:** [tinkazo.vercel.app/?demo=trompo](https://tinkazo.vercel.app/?demo=trompo) · **Agregado:** 28 de septiembre de 2026

## Por qué un trompo

Porque lo jugó media Latinoamérica y nadie necesita que se lo expliquen. El *Diccionario de americanismos* lo registra en Bolivia como el juego de niños que se practica con peonzas: el juego y el juguete se llaman igual. Y es un juego de eliminación por naturaleza, que es lo que necesita un sorteo con mucha gente.

También es el primero que nació directamente en el motor nuevo, con la cámara pensada desde el principio: un choque se ve mejor de cerca, y un mano a mano se ve mejor pegado.

## La mecánica

**El tiro.** Los trompos entran desde abajo, en arco, de a uno y en un orden sembrado, y caen al ruedo girando. El contador de arriba a la izquierda dice cuántos hay en el ruedo.

**El baile.** Cada trompo deambula con su propio vaivén y se empuja con los vecinos. Cuando dos se rozan fuerte suena un toque. La tiza los contiene: nadie sale sin que lo saquen.

**Los choques.** Los que salen lo hacen en un orden sembrado, primero muchos y al final de a uno. La mitad sale sacado: el trompo más cercano le pega, saltan chispas y se va volando fuera de la tiza. La otra mitad se queda sin cuerda: cabecea y se acuesta. Los que salieron se apagan en un segundo y medio, para no tapar a los que siguen.

**El mano a mano.** Quedan dos y se buscan: dan vueltas cerca uno del otro y chocan tres veces. Después del último choque, la rival se queda sin cuerda y se cae.

## Lo que el ruedo hace a propósito

**La ganadora nunca sale.** El orden de salida está sembrado con la ronda y ella va primera en esa lista; la rival que elige el director de emoción va segunda, así que es la que llega al mano a mano. La física de los choques es de verdad, pero no decide nada: solo muestra lo que el protocolo ya fijó.

Los arcos del director de emoción se ven así:

| Arco | Qué pasa |
|---|---|
| Susto | En el mano a mano el trompo ganador cabecea, casi se cae ("¡cabecea el de fulano!") y se endereza |
| Remontada | A mitad de los choques lo sacan hasta el borde de la tiza, y vuelve |
| Duelo | El mano a mano dura cuatro choques en vez de tres |
| Tapada | Baila callado contra el borde y la cámara nunca lo busca |

## Cómo escala

El tamaño de cada trompo sale del lugar que hay en el ruedo, con topes.

| Participantes | Qué se ve |
|---|---|
| 2 | No hay choques de más: los dos se miden, se buscan y amagan hasta el mano a mano |
| 18 | Un ruedo lleno que se va vaciando de a pocos |
| 200 | Trompos chicos, con muchos choques al principio; los nombres aparecen cuando quedan ocho |

## Los tiempos

En segundos de juego, con 18 participantes y sin estirar.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 2,2 s | El tiro. "¡Tiren los trompos!" |
| 2,2 – 4,6 s | El baile. "¡Cómo bailan!" |
| 4,6 – 12,3 s | Los choques |
| 12,3 – 16,9 s | El mano a mano: tres choques, y la rival se cae |
| 16,9 s | El cartel, con la ganadora bailando debajo, más grande y con un brillo |

## La cámara

Sobre el ruedo al tirar, se mete en cada choque, sigue al trompo que sacan hasta la tiza, queda pegada al mano a mano y se acerca más al que cabecea.

## El sonido

- **El tiro:** una nota por trompo que cae, con tope.
- **Los roces:** un toque corto cuando dos chocan fuerte, como mucho uno cada tercio de segundo.
- **Los que salen:** un golpe seco y una nota que baja cuando los sacan; una nota grave cuando se caen solos.
- **El mano a mano:** un golpe fuerte en cada choque.
- **El cabeceo del susto:** una alarma corta.

## Cómo está hecho

Vive en [`src/games/pixi/trompo.ts`](../../src/games/pixi/trompo.ts) y usa el andamiaje del motor nuevo, [`src/games/pixi/stage.ts`](../../src/games/pixi/stage.ts). No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

Las posiciones viven en el disco del ruedo, que mide uno, y el suelo se ve en perspectiva: el ruedo es una elipse. Por eso girar el celular no mueve ningún trompo. La física corre a paso fijo de 1/120 de segundo y el giro de cada trompo sale de la hora del juego, así que la misma ronda se ve igual en cualquier máquina.

## Cómo auditarlo

```bash
node scripts/audit-rigor.mjs trompo
node scripts/audit-game.mjs trompo
node scripts/audit-emocion.mjs trompo
node scripts/audit-sound.mjs trompo
```
