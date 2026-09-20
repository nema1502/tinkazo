# Ruleta

La de siempre, pero que se ve girar. Gajos que pasan, pernos que suenan, una paleta que se traba, y los 64 dígitos de la semilla escritos en el aro.

**Identificador:** `wheel` · **Probalo:** [tinkazo.vercel.app/?demo=wheel](https://tinkazo.vercel.app/?demo=wheel) · **Rehecha:** 20 de septiembre de 2026

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

Con dos nombres se ven doce y doce alternados, que es justamente lo que hace mirable a una ruleta de casino: rojo, negro, rojo, negro. Y de paso la probabilidad se lee de un vistazo.

Como el gajo `k` es de la persona `k % n`, dos gajos vecinos son siempre de personas distintas, así que nunca hay dos del mismo color pegados.

Esto no toca el resultado. El ganador llega dado por el protocolo; lo único sembrado con la ronda es dónde arranca la rueda y cuál de los gajos del ganador queda bajo el puntero.

## Cómo frena

La versión anterior interpolaba el **ángulo** con una curva cúbica. Eso da "rápido, rápido, rápido, se paró": la curva llega a velocidad cero, pero su último tramo todavía es veloz, así que los clics se cortan de golpe en vez de separarse.

Ahora se define la **velocidad** y el ángulo sale de integrarla, que es como frena una rueda de verdad. El presupuesto de giro está escrito en gajos y no en radianes, así que **el ritmo de los clics es idéntico con dos participantes que con veinticuatro**, y lo único que cambia es cuántas vueltas da.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 0,8 s | Los gajos entran y el aro se escribe con los 64 dígitos de la semilla |
| 0,8 – 1,7 s | Se tensa. Cinco tonos ascendentes y tres de cuenta |
| 1,7 – 3,9 s | Velocidad de crucero, con desenfoque de movimiento. Un tono por vuelta |
| 3,9 – 6,2 s | Frena. A mitad del frenado empiezan los clics individuales |
| 6,2 – 6,75 s | Paso de hombre. Dos clics, uno por uno |
| 6,75 – 7,0 s | **El falso.** La paleta queda trabada contra un perno, vibrando: parece que se queda un gajo antes |
| 7,0 – 7,4 s | El último empujón la mete al centro del gajo |
| 7,4 – 7,65 s | Golpe seco |
| 7,65 – 9,2 s | Todo se apaga menos los gajos del ganador, que salen hacia afuera y se encienden |

Dura nueve segundos donde antes duraba cuatro y medio. La carrera dura quince: la ruleta podía pedir más.

## Lo que se ve y por qué

- **El aro con la semilla.** Los 64 dígitos hexadecimales de esta ronda, escritos alrededor. Es decoración para quien no mira y una invitación para quien sí: sacá la foto y comprobalos contra el faro. A toda velocidad se reemplazan por rayas, porque no se leerían.
- **La paleta que se traba.** Es lo que hace mirable una ruleta de premios. Es puro dibujo, nunca vuelve a entrar en el ángulo de la rueda, así que el determinismo queda intacto.
- **Los pernos.** Uno por borde de gajo. Justifican el tic-tac.
- **El perno tricolor.** En la posición cero. Marca la vuelta y suena un tono cada vez que pasa, así que es funcional. De diez metros es un acento de color; de un metro es la bandera.
- **La columna de nombres.** Con catorce participantes o menos, una placa por persona y la del puntero resaltada. Con más, una sola placa grande que va cambiando: con veinticuatro nombres el listado no se lee de lejos, y una placa que cambia sí.
- **El sol de doce rayos** del fondo, contra-rotando. Es lo que hace que la escena nunca esté del todo quieta.

## El sonido

Nunca más de catorce pitidos por segundo: cada uno crea un oscilador, y cuarenta por segundo es basura y latencia.

Durante el crucero no hay clics: hay un zumbido grave y un tono agudo por vuelta, que se pueden contar de oído. Los clics individuales arrancan cuando la velocidad baja lo suficiente, y su tono **sube** de 420 a 980 Hz mientras la rueda frena. Es el truco más viejo que hay y sigue funcionando.

**Con cuatro participantes o menos, cada persona tiene su nota.** Con dos se oye de quién es cada gajo sin mirar la pantalla. Esa es la respuesta sonora al problema que tenía la ruleta.

## Cómo está hecho

Vive en [`src/games/wheel.ts`](../../src/games/wheel.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts). Antes era un cuadrado de 480 píxeles dentro de la página; ahora monta el estadio a pantalla completa como los otros cuatro, y hereda de paso el narrador con voz, el botón de saltar, el modo `?instant=1` y el desmontaje.

## Qué mira el auditor

```bash
node scripts/audit-game.mjs wheel
```
