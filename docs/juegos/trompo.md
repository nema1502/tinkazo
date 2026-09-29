# Trompo

El juego de patio. Un ruedo de tiza en el suelo, cada participante tira su trompo adentro y bailan. Después empiezan los choques: los trompos se sacan del ruedo o se quedan sin cuerda y se caen, hasta que quedan dos en un mano a mano. Gana el último que sigue bailando.

**Identificador:** `trompo` · **Probalo:** [tinkazo.vercel.app/?demo=trompo](https://tinkazo.vercel.app/?demo=trompo) · **Agregado:** 28 de septiembre de 2026

## Por qué un trompo

Porque lo jugó media Latinoamérica y nadie necesita que se lo expliquen. El *Diccionario de americanismos* lo registra en Bolivia como el juego de niños que se practica con peonzas: el juego y el juguete se llaman igual. Y es un juego de eliminación por naturaleza, que es lo que necesita un sorteo con mucha gente.

También es el primero que nació directamente en el motor nuevo, con la cámara pensada desde el principio: un choque se ve mejor de cerca, y un mano a mano se ve mejor pegado.

## La mecánica

**El tiro.** Los trompos entran desde abajo, en arco, de a uno y en un orden sembrado, y caen al ruedo girando. El contador de arriba a la izquierda dice cuántos hay en el ruedo.

**El baile.** Cada trompo deambula con su propio vaivén y se empuja con los vecinos. Cuando dos se rozan fuerte suena un toque. La tiza los contiene: nadie sale sin que lo saquen.

**Los choques.** Los que salen lo hacen en un orden sembrado. Cada golpe tiene un trompo que lo da, el más cercano que esté libre:
1. Lo acecha y se acomoda del lado de adentro del ruedo.
2. Se echa atrás para tomar impulso.
3. Embiste.

El golpe pasa cuando los dos se tocan de verdad, nunca antes ni a distancia. Hay tres maneras de salir:
- **Sacado**, la mitad: vuela girando fuera de la tiza, pica dos veces en el piso levantando tierra y queda acostado.
- **De refilón**, tres de cada diez: el golpe entra torcido, el trompo no sale pero queda cabeceando y se acuesta.
- **Sin cuerda**, el resto: cabecea cada vez más fuerte y se viene abajo solo.

Los dos últimos antes del mano a mano salen siempre sacados. Los que salieron se apagan antes de los dos segundos, para no tapar a los que siguen.

**La física.** El contacto es el de dos masas con rebote: el que embiste pesa más, así que el otro sale disparado y él sigue un poco, frenado. El giro desvía el golpe de costado, como pasa con dos trompos de verdad. Los roces que no están en el guion también rebotan y se desvían, y los fuertes sacan chispas. Nadie atraviesa a nadie: tres pasadas de separación por paso de física, cinco con más de cuarenta personas.

**El mano a mano.** Quedan dos y se miden: dan vueltas uno alrededor del otro. Antes de cada choque se echan atrás y embisten a la vez, y chocan tres veces. Después del último choque, la rival se queda sin cuerda y se cae.

**Lo que hace que un golpe se sienta.** Lo que se aprendió del animé y de los juegos de pelea:
- **La parada.** El juego se congela entre 55 y 110 milésimas en los golpes grandes. En la gresca del principio no hay parada, porque sería tartamudear: solo cuando quedan doce o menos y con medio segundo entre una y otra.
- **El destello.** Los dos trompos se prenden en blanco un instante, y en el mano a mano toda la pantalla también, uno por segundo como mucho.
- **La estrella de cómic** en el punto de contacto, **la onda** que corre por el piso en perspectiva y **las chispas**, que salen sobre todo de costado, como del roce de dos giros, y caen.
- **El aplastón.** El trompo se aplasta y rebota como goma.
- **La estela** de imágenes del que embiste o sale volando.
- **La inclinación** del que toma impulso y embiste.
- **El último choque del mano a mano:** cámara lenta al 30% durante 0,6 s, con líneas de velocidad en los bordes.

## Lo que el ruedo hace a propósito

**La ganadora nunca sale.** El orden de salida está sembrado con la ronda y ella va primera en esa lista; la rival que elige el director de emoción va segunda, así que es la que llega al mano a mano. La física de los choques es de verdad, pero no decide nada: solo muestra lo que el protocolo ya fijó.

Los arcos del director de emoción se ven así:

| Arco | Qué pasa |
|---|---|
| Susto | En el mano a mano el trompo ganador cabecea, casi se cae ("¡cabecea el de fulano!") y se endereza |
| Remontada | A mitad de los choques le pegan y lo mandan contra la tiza: la roza y vuelve |
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

A eso se suman las paradas de los golpes y la cámara lenta del último choque, un segundo en total. El juego las declara en `setGameLength`, así que el show sigue durando lo que eligió el organizador.

## La cámara

Sobre el ruedo al tirar. En los golpes grandes **llega antes que el golpe**: encuadra a los dos mientras el que pega toma impulso, y el golpe cae en el cuadro. Llegar después era mostrar un trompo que ya se iba. Después sigue al que sacan hasta la tiza. En el mano a mano queda pegada, se cierra un poco antes de cada choque, se mete más en la cámara lenta y se acerca al que cabecea.

## El sonido

- **El tiro:** una nota por trompo que cae, con tope.
- **Los roces:** un toque corto cuando dos se rozan, como mucho uno cada tercio de segundo.
- **Los golpes:** en capas, el chasquido de la madera y el cuerpo. En los grandes se suma un retumbe. En la gresca, como mucho uno cada décima de segundo.
- **Los que caen:** un golpe sordo cuando el sacado pica en el piso o cuando el que se quedó sin cuerda se acuesta.
- **El mano a mano:** un golpe grande en cada choque.
- **El cabeceo del susto:** una alarma corta.

## Cómo está hecho

Vive en [`src/games/pixi/trompo.ts`](../../src/games/pixi/trompo.ts) y usa el andamiaje del motor nuevo, [`src/games/pixi/stage.ts`](../../src/games/pixi/stage.ts). No tiene versión en el motor anterior: en un equipo sin WebGL el sorteo sale con la carrera de llamas, que cuenta el mismo ganador.

Las posiciones viven en el disco del ruedo, que mide uno, y el suelo se ve en perspectiva: el ruedo es una elipse. Por eso girar el celular no mueve ningún trompo. La física corre a paso fijo de 1/120 de segundo y el giro de cada trompo sale de la hora del juego, así que la misma ronda se ve igual en cualquier máquina.

## Cómo auditarlo

```bash
node scripts/audit-choques.mjs
node scripts/audit-rigor.mjs trompo
node scripts/audit-game.mjs trompo
node scripts/audit-emocion.mjs trompo
node scripts/audit-sound.mjs trompo
```

El auditor de choques es de este juego. Con `?auditar=choques` el trompo anota cada golpe, y el auditor lo comprueba en ocho semillas y con 2, 3, 60 y 200 personas:
- que cada golpe y cada choque del mano a mano pase con los dos tocándose, y ninguno forzado;
- que el golpeado salga hacia donde lo empujan y el que pega retroceda;
- que ningún par quede encimado más de un 12% del diámetro;
- que el sacado termine afuera de la tiza;
- que haya paradas y cámara lenta donde van, sin amontonarse;
- que la ganadora nunca salga, que la rival salga última y que cada uno salga en su ventana;
- que la misma semilla anote los mismos golpes.

La primera vez que corrió encontró que los golpes de refilón nunca tocaban: apuntaban a un punto a 2,1 radios del otro. También encontró que las embestidas llegaban lentas y que en un ruedo lleno quedaban trompos encimados hasta la mitad del diámetro.
