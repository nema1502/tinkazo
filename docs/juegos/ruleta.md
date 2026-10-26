# Ruleta

La de siempre, pero que se ve girar. Gajos con nombre que pasan, pernos que suenan, una paleta que se traba, y un aro de foquitos que se prende con el ganador.

**Identificador:** `wheel` · **Probalo:** [tinkazo.app/?demo=wheel](https://tinkazo.app/?demo=wheel) · **Rehecha:** 20 de septiembre de 2026

## El problema que tenía

Con dos o tres participantes no se entendía nada, y **no era un problema de estilo: era geometría.**

Una rueda de `n` gajos se ve exactamente igual cada vez que gira `360/n` grados. Con dos participantes, girarla media vuelta deja una imagen idéntica; con tres, cada 120 grados. El ojo no tiene de dónde agarrarse, así que no percibe velocidad ni desaceleración. Y sin velocidad percibida no hay tensión: parecía un gráfico de torta quieto.

Todo lo demás (colores, tipografía, duración) era secundario a eso.

## Cómo se arregla

**Cada persona se lleva varios gajos, intercalados**, de modo que la rueda siempre tenga cerca de veinticuatro. Es lo que hacen las ruletas de feria de verdad.

| Participantes | Gajos por persona | Gajos en total |
|---|---|---|
| 2 | 12 | 24 |
| 3 | 8 | 24 |
| 4 | 6 | 24 |
| 6 | 4 | 24 |
| 8 | 3 | 24 |
| 12 | 2 | 24 |
| 13 a 24 | 1 | 13 a 24 |

Con dos nombres se ven doce y doce alternados, que es justamente lo que hace que una rueda se vea girar: dos colores que se turnan. Y de paso la probabilidad se lee de un vistazo.

Como el gajo `k` es de la persona `k % n`, dos gajos vecinos son siempre de personas distintas, así que nunca hay dos del mismo color pegados.

Esto no toca el resultado. El ganador llega dado por el protocolo; lo único sembrado con la ronda es dónde arranca la rueda y cuál de los gajos del ganador queda bajo el puntero.

## Cómo frena

La versión anterior interpolaba el **ángulo** con una curva cúbica. Eso da "rápido, rápido, rápido, se paró": la curva llega a velocidad cero, pero su último tramo todavía es veloz, así que los clics se cortan de golpe en vez de separarse.

Ahora se define la **velocidad** y el ángulo sale de integrarla, que es como frena una rueda de verdad. El presupuesto de giro está escrito en gajos y no en radianes, así que **el ritmo de los clics es idéntico con dos participantes que con veinticuatro**, y lo único que cambia es cuántas vueltas da.

Los tramos van en **segundos de juego**: el selector de duración los estira todos por igual, y en "normal" el show entero dura treinta segundos reales.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 1,2 s | Los gajos entran, cada uno con su nombre, y se prenden los foquitos del aro |
| 1,2 – 2,6 s | **Carga.** La rueda toma velocidad a la vista, con el trinquete |
| 2,6 – 4,2 s | Velocidad de crucero, con desenfoque de movimiento. Un tono por vuelta |
| 4,2 – 10,0 s | Frena. A mitad del frenado empiezan los clics individuales. El relator no nombra a nadie |
| 10,0 – 14,4 s | **El último tramo.** "¡Ya casi para!", y la rueda se arrastra: los gajos pasan uno por uno bajo la paleta y el relator canta el que entra, cuando ya se puede leer |
| 14,4 s | "¡Se traba!": desde acá la rueda se sigue arrastrando sin nombres, y la mitad de las veces se queda en el último nombrado. En el susto, **la parada falsa**: se para del todo en un gajo ("¿se queda en fulano?") |
| 14,4 – 16,8 s | Se arrastra hasta trabarse. En el susto, después de un instante quieta, se destraba y avanza uno o dos gajos ("¡no! ¡se movió!") o tiembla y se queda ("¡se queda!") |
| 16,8 – 17,6 s | Golpe seco y fogonazo, y un respiro en silencio antes del cartel |
| 17,6 s en adelante | Todo se apaga menos los gajos del ganador, que salen hacia afuera y se encienden. Tres segundos **reales**, para que la sala alcance a leer y a reaccionar |

Duraba 7,65 segundos y de esos, tres eran tiempo muerto: 1,7 con la rueda completamente quieta, que en una pantalla grande es una foto, y 2,2 de crucero en los que la imagen es un borrón. Lo bueno ·los clics separándose, el puntero arrastrándose, el amague· sumaba segundo y medio.

Ahora dura 17,6 y el reparto está al revés: 1,6 de borrón contra 5,8 de frenado con clics sueltos, 4,4 de arrastre y 2,4 de traba (con el amague, en el susto). Hasta el 21 de octubre de 2026 el arrastre empezaba a los 12,0 s y duraba 2,4. **No es el mismo juego más lento: es el mismo juego con más de lo que vale la pena mirar.**

## Lo que se ve y por qué

- **Los foquitos del aro.** Sesenta y cuatro, como en una rueda de feria, y con el ganador se prenden en amarillo de a uno sí y uno no. A toda velocidad se reemplazan por rayas. Hasta el 7 de octubre de 2026 eran los 64 dígitos hexadecimales de la semilla: en el primer plano del final eran lo más grande después de la flecha, y durante el sorteo no va nada técnico en pantalla. La semilla se comprueba en la tarjeta de después y en la página de verificación.
- **La paleta que se traba.** Es lo que hace mirable una ruleta de premios. Es un resorte amortiguado: el perno que pasa la empuja, y al soltarla vuelve sola, se pasa un poco para el otro lado y tiembla, como la de una ruleta de feria (hasta el 29 de septiembre de 2026 seguía al perno sin física y se enderezaba de golpe). Corre a paso fijo de 1/240 s y nunca vuelve a entrar en el ángulo de la rueda, así que el determinismo queda intacto. Al trabarse, pega un golpe: crece y vuelve.
- **Una sola sacudida de cámara.** Antes la cámara sacudía tres veces en unos 2-3 s (al moverse el falso, al trabarse en el ganador y al coronar), y en el celular el amague y el ganador parecían igual de "elegidos". Ahora la sacudida se reserva al único momento en que el ganador real se confirma (la coronación, 17,6 s). El amague da solo un empujón de zoom sin sacudida, más su sonido y la frase "¿se queda en fulano?"; el trabado da un empujón de zoom con su fogonazo y sonido; y los toques por perno al frenar ya no sacuden la cámara (solo suenan). La agenda vive en `src/games/pixi/wheel-beats.ts` y tiene pruebas. No está verificado en un navegador: lo que se ve en pantalla falta confirmarlo a ojo.
- **Los pernos.** Uno por borde de gajo. Justifican el tic-tac.
- **El perno tricolor.** En la posición cero. Marca la vuelta y suena un tono cada vez que pasa, así que es funcional. De diez metros es un acento de color; de un metro es la bandera.
- **Los nombres en los gajos.** Cada gajo lleva escrito de quién es, hacia afuera: el nombre entero si es corto, si no el de pila con la inicial ("María Q."). Hasta el 7 de octubre de 2026 solo con doce participantes o menos, y cortados por la mitad ("María…spe"); con más, lo único que daba nombres era una placa que cambiaba treinta veces por segundo mientras giraba.
- **La columna y la placa.** Con catorce participantes o menos y pantalla ancha, una placa por persona y la del puntero resaltada, y la rueda a la derecha. Sin columna (más de catorce) la rueda va al medio, lo más grande que entra entre la barra de arriba y la caja del relator; en el celular, al medio a lo ancho (0,4 del ancho) y en el tercio de arriba, como siempre. La placa grande aparece recién cuando la rueda va a paso de hombre, que es cuando se puede leer el nombre que pasa bajo la flecha, y va arriba, donde con la cámara encima de la flecha solo hay cielo: en pantalla ancha a la izquierda de la flecha, y si ahí no entra, centrada encima del poste, con la cámara que baja lo justo para que el poste arranque debajo. Hasta el 18 de octubre de 2026, sin columna la rueda quedaba a la derecha con media pantalla vacía, y la placa, a media altura, tapaba gajos; en el celular, el mismo gajo de la flecha (lo encontró el crítico de juegos, 16 de octubre de 2026). El relator nombra el gajo cuando la flecha cambia de gajo y el gajo va a durar 0,4 s o más (2,5 gajos por segundo): hasta el 20 de octubre de 2026 lo decía cada 0,45 s desde los 4,5 gajos por segundo y la línea nombraba un gajo que la flecha ya había pasado, con la placa mostrando otro.
- **El cartel no tapa al ganador, ni la caja a la rueda.** Con el cartel, la rueda entera queda entre el cartel, que sale arriba al centro, y la caja del relator: el gajo ganador siempre queda arriba, bajo la flecha. Para que entre se aleja lo que haga falta (a 1280x720 con dieciocho personas, a 0,68), y llega en un segundo, porque el cartel dura tres. Hasta el 21 de octubre de 2026 bajaba un 17 % de la pantalla, se alejaba a 0,84 y tardaba casi los tres segundos en llegar: la caja le tapaba la parte de abajo (evaluador visual).
- **El sol de doce rayos** del fondo, contra-rotando. Es lo que hace que la escena nunca esté del todo quieta.

## El sonido

Nunca más de catorce pitidos por segundo: cada uno crea un oscilador, y cuarenta por segundo es basura y latencia.

Durante el crucero hay un motor y un tono por vuelta, que se pueden contar de oído. **El motor baja de tono con la rueda**, así que el oído y el ojo cuentan lo mismo. Antes eran 90 Hz fijos, que ningún parlante de proyector reproduce, y además callaban al empezar la frenada: quedaban 1,7 segundos mudos justo en lo único que la sala estaba mirando.

Los clics individuales toman el relevo cuando el motor se apaga: tic y tac, dos notas que se alternan, y cada vez más fuertes a medida que frena, porque los últimos son los que deciden. La frenada la cuenta el ritmo, que se va espaciando solo. Antes el tono subía de 420 a 980 Hz mientras la rueda frenaba: es un truco viejo, pero acá decía lo contrario de lo que se veía.

**La parada falsa suena a parada.** Un clac como el de la traba, más chico, y un latido mientras la rueda está quieta en el señuelo; los últimos 0,15 s van en silencio, para que la sala crea que paró. Hasta el 7 de octubre de 2026 eran 2,7 s sin ningún efecto.

Entre la traba y el cartel hay 0,8 s de juego: con 0,4 la traba sonaba en el medio segundo de antes del ganador y el cartel no se oía como golpe.

La traba suena **una sola vez**. Durante un tiempo se redisparó catorce veces, al volumen más alto del juego, encima de la fanfarria, porque la condición miraba el destello y el destello decae a los 0,12 s. El puntero parpadeaba en blanco las catorce.

**Con cuatro participantes o menos, cada persona tiene su nota.** Con dos se oye de quién es cada gajo sin mirar la pantalla. Esa es la respuesta sonora al problema que tenía la ruleta.

## Qué cambió en la revisión del 20 de octubre

- **El final no se aprende.** La flecha para en cualquier punto del gajo ganador, entre el 20 % y el 80 % de su ancho, y no siempre en el medio. Todo sale de la semilla de la ronda. El gajo ganador lo sigue fijando el número público: cambia cómo llega la flecha, no quién gana. Desde el 21 de octubre de 2026 (ver "Lo que no delata", abajo) también sale de la semilla cuánto le falta al empezar el último tramo, cuánto avanza después de trabarse y qué hace la parada falsa; hasta entonces lo que variaba era la velocidad del tramo lento, entre el 90 % y el 115 %.
- **Los últimos clics mueven la flecha.** Cuando la rueda va por debajo de tres gajos por segundo, cada gajo que pasa le da un golpecito a la flecha, además del clic.
- **La caja del relator no tapa la rueda.** En el modo centrado, la rueda queda encima de la caja (antes podía taparle hasta 40 px). A 1280x720 con dieciocho personas, la rueda entera se ve en reposo y girando. En la pantalla ancha, el acercamiento final se corta a propósito, para mirar la flecha y su gajo. En el celular parado no, desde el 21 de octubre de 2026: acercada a 1,9 sobre la flecha, la rueda se cortaba por los costados y por abajo, y la caja le tapaba la parte de abajo (evaluador visual). Ahora, cuando frena, la cámara la encuadra entera entre la placa del nombre y la caja del relator (a 390x844, a 1,17, lo que da el ancho). Con más de veinticuatro, la placa de los grupos va pegada a la caja, y la rueda entera encima de ella.
- **Hasta cuántos.** Llega a 200 (`WHEEL_MAX`) desde el 21 de octubre de 2026; antes llegaba a 24. Hasta 24, un gajo por persona, con su nombre escrito en el gajo, como antes. Desde 25, la rueda sigue con 24 gajos y cada uno reúne a un grupo seguido de la lista: `repartir`, en [`wheel-layout.ts`](../../src/games/wheel-layout.ts), módulo puro con pruebas. Con 25, el primero lleva a dos; con 50, dos de tres y veintidós de dos; con 200, ocho de nueve y dieciséis de ocho. Los nombres no van escritos en el gajo: al pasar la flecha, una placa lista a las personas del gajo, una por renglón y del color del gajo. Al frenar se enciende el renglón del ganador. Con más de 200, `playableGame` pasa el sorteo a la tómbola, que muestra a todos con su número.

  Medido con `node scripts/audit-identidad.mjs wheel --gente 8,18,50,100,200` (21 de octubre de 2026): con 8 y con 18 se ven todos antes del ganador; con 50, 100 y 200 se leen el 24 %, el 21 % y el 21 % antes del cartel. El nombre del ganador sí se lee antes del cartel en los cinco tamaños, unos 4 s antes en el reloj del auditor. Que se lean todos con 50 o más todavía no se logra: es lo pendiente de la ruleta. El motor anterior (`?motor=clasico`) no reparte en gajos: con 200 dibuja 200.
- **La semilla en el borde.** Hasta el 7 de octubre el aro llevaba los 64 caracteres de la semilla de la ronda. Ahora son 64 foquitos, sin texto. Se deja así: nada técnico en pantalla.
- **`placeChip` y `aim()`.** Son de la chovena (`chovena.ts`), no de la ruleta: aquí no aplican.
- **La etiqueta con la tómbola.** Al congelar con más de 200 nombres, `freeze.ts` cambia el juego a tómbola, y la etiqueta sale de `pintarJuego`. No se reprodujo en esta base.
- **El confeti sobre el HUD en celular.** No se reprodujo: al coronar, el HUD de la ruleta queda vacío en celular (la barra de arriba es HTML).

## Cómo está hecho

Vive en [`src/games/wheel.ts`](../../src/games/wheel.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts). Antes era un cuadrado de 480 píxeles dentro de la página; ahora monta el estadio a pantalla completa como los otros cuatro, y hereda de paso el narrador con voz, el botón de saltar, el modo `?instant=1` y el desmontaje.

## Lo que no delata (21 de octubre de 2026)

El auditor de delatores (`scripts/audit-delatores.mjs`) corrió 200 semillas y encontró que el show adivinaba al ganador: la rueda frenaba siempre igual, el relator nombraba los gajos que pasaban y después avanzaba uno o dos más, así que ganaba el gajo siguiente al último nombrado en 166 de 200 semillas con ocho personas (azar 12,5 %) y en 159 de 200 con dieciocho (azar 5,6 %), 7,7 s antes del cartel. Nadie que el relator nombrara ganaba nunca. En la parada falsa, "¿se queda en X?", la rueda avanzaba justo un gajo: X no ganaba nunca.

Cómo gira la rueda está en `src/games/pixi/wheel-motion.ts`, un módulo puro con pruebas, y sale de la semilla:

- **Lo que le falta al empezar el último tramo** (a los 10 s, con "¡Ya casi para!") es cualquier número de gajos dentro de una vuelta entera de nombres (con dos o tres personas, varias vueltas, para que no sean menos de ocho gajos). El gajo bajo la flecha en ese momento no dice nada: con la cámara encima de la flecha, el último nombre en el centro antes de ese momento gana 25 de 200 con ocho personas, el azar justo. La rueda llega a ese tramo más rápido o más despacio según cuánto le falta, como una rueda que un día roza más que otro.
- **Antes de eso el relator no nombra a nadie.** En el último tramo nombra los gajos que pasan, hasta que se traba. "¡Ya casi para!" es el momento que decide para el auditor: de ahí en adelante se ve cómo se decide.
- **Después de trabarse**, la mitad de las veces se queda en el último nombrado y si no pasa al siguiente (con dieciocho personas, a veces al otro). En las 200 semillas, contando las paradas falsas: gana el último nombrado 100 veces con ocho personas y 93 con dieciocho, y el siguiente 90 y 88.
- **La parada falsa** se queda en el nombrado ("¡se queda!") un tercio de las veces, y si no se destraba y avanza uno o, más raro, dos. En las 200 semillas, el nombrado gana 14 de 56 paradas falsas con ocho personas y 13 de 52 con dieciocho.
- **Lo que hace falta para caer justo en el gajo del ganador** se agrega o se quita mientras gira a fondo, que es cuando no se nota (la velocidad de crucero varía entre 23 y 53 gajos por segundo). Antes la curva entera se estiraba o se encogía. Y la rueda se arrastra sin cortes hasta trabarse del todo: antes, al trabarse, casi paraba y volvía a acelerar para el empujón de la paleta.

## Qué mira el auditor

```bash
node scripts/audit-game.mjs wheel
```
