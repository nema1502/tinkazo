# La carrera de llamas

Hasta ocho llamas por la cordillera, con hinchada, relator y foto de llegada. Es el juego con el que nació Tinkazo. Con más de ocho personas, primero la clasificatoria: aparecen todas con su llama, se van tachando en oleadas y las ocho de la final bajan a la pista.

**Identificador:** `race` · **Probarlo:** `/?demo=race` (sorteo real), `/?pose=1` (escena fija, sin red), `/?pose=1&n=3` (con tres personas).

Este documento cuenta cómo mira la cámara de la carrera en el motor nuevo ([`src/games/llamas/pixi-race.ts`](../../src/games/llamas/pixi-race.ts)), y sobre todo cómo encuadra el final cuando corren pocas. La historia de cada carrera (el arco, los tropiezos, las plantadas, la escupida y el duelo) está en "El director de emoción" de [juegos.md](../juegos.md).

## La regla: el juego no decide nada

La ganadora sale del [protocolo](../protocolo.md) antes de la largada. La carrera recibe `(names, winners, beacon, done)` y solo la cuenta: quiénes corren, en qué carril y dónde va cada una en cada instante salen del plan ([`plan.ts`](../../src/games/llamas/plan.ts)), sembrado con la ronda. La cámara tampoco decide nada: mira lo que el plan ya decidió, y antes de la meta no mira a la ganadora más que a cualquier otra, porque mirarla de más sería delatarla.

## La cámara

| Momento | Qué mira |
|---|---|
| Presentación y cuenta | Los carriles enteros en la largada, del nombre del primero a las patas del último; en la cuenta se abre de a poco hacia la pista |
| La carrera | La que va adelante, un poco adelantada, y se acerca a medida que sube la tensión; cuando el relator dice quién pasa adelante, se acerca un momento a ella |
| Un momento de la historia | Se mete en el carril del tropiezo, la plantada o la escupida, con la llama entera y su "!" |
| Las dos que vienen de atrás (en la remontada, al 74%) | Una de las dos, sorteada |
| La recta final (desde el 80%) | Las dos de adelante, en un acercamiento que se apura hasta la meta, con aire hacia la meta |
| La foto (en el duelo, desde el 96%) | Cámara lenta, sin desenfoque, las dos del duelo enteras, por igual, con aire hacia la meta si entra |
| La meta | Un corte debajo del destello, el golpe y el sacudón, y la cámara se acerca despacio al plano de la corona |

## Lo que se ve no delata a la ganadora

El auditor de delatores (`scripts/audit-delatores.mjs`, 21 de octubre de 2026) corrió doscientas semillas y encontró que la carrera la anunciaba: "¡X viene de atrás!" nombraba a la ganadora en todas las remontadas y "¡Y se cuela X!" en todas las tapadas; en la recta final la que iba primera perdía siempre; en el duelo ganaba la del carril de arriba; las que el relator nunca nombraba nunca ganaban, y en el susto ganaba la que iba primera al principio. Desde entonces:

- **El puesto de la ganadora** al 7%, al 25%, al 50% y al 75% se sortea en una franja de su arco, y las franjas de los cuatro arcos se reparten los puestos: sumando, cada puesto sale cerca de una de cada ocho veces. A la mitad va un poco más adelante que atrás (en la mitad de atrás, cuatro de cada diez carreras): con la mitad justa, el auditor de emoción, que mira dieciséis carreras, encontraba a la ganadora atrás en más de seis de cada diez en una tanda de cada cuatro. En la recta final (90%) va primera o segunda, mitad y mitad. Lo comprueba `plan.test.ts`, sin navegador.
- **En el duelo** la rival corre arriba o abajo de la ganadora, sorteado, y desde el mano a mano el relator ya no anuncia quién pasa adelante.
- **En la remontada vienen de atrás dos**, la ganadora y otra que llega a pelear adelante y se desinfla en los últimos metros: "¡X y Y vienen de atrás!", en orden alfabético, y la cámara va a una de las dos.
- **En la tapada** se cuela la que nadie nombró, y tampoco se la nombra ahora: "¡Alguien aprovecha la pelea!".
- **En la recta final la tribuna grita por una** ("¡La hinchada de X no para!"), sorteada entre todas: la última que se nombra sola ya no es siempre la que gana ni siempre una que pierde.
- **El tono** de un tropiezo sube igual sea de quien sea: con la ganadora más fuerte, la música se cortaba justo cuando tropezaba ella.
- **Los nombres que no se apagan** en un primer plano son los de las dos que van adelante (y en el duelo, los de las dos del mano a mano), no los de la ganadora y la rival.

El motor anterior (`src/games/race.ts`) no cambió: con `?motor=clasico` la historia es la de antes.

## Con pocas personas

El 19 de octubre de 2026 Alejandro (Vaquita y Pollar) probó el sitio y preguntó: "¿probaron esto en mobile?". Con tres o cuatro personas, al final de la carrera la ganadora quedaba cortada contra el borde del celular y el cartel del ganador tapaba a la llama del carril de arriba.

**La causa.** Cada llama se dibuja a la escala de su carril y mide unos dos carriles y medio de alto: con ocho, unos 160 píxeles en una pantalla de 900; con tres, entre 380 y 480. Los acercamientos de la cámara (1,5 en un momento, hasta 1,9 en la recta final, 2,1 en la foto, 1,6 en la corona) se pensaron para ocho, y con pocas personas cortaban a las llamas. En la corona, además, la cámara medía solo a la ganadora: la ponía debajo del cartel, y las de los carriles de arriba quedaban justo detrás de él.

**El arreglo (21 de octubre de 2026).**

- **El encuadre, en un archivo aparte** ([`src/games/pixi/encuadre.ts`](../../src/games/pixi/encuadre.ts), con sus pruebas): dado lo que tiene que verse entero (cajas del mundo) y dónde (una zona de la pantalla), el acercamiento más grande con el que entra y el centro que lo deja ahí, moviendo la vista lo menos posible.
- **La corona encuadra según el ancho y el alto de la pantalla.** Con cinco personas o menos se ven todas las llamas enteras debajo del cartel y encima del relator, como en la foto de una llegada. Con más, la ganadora y las de los carriles de arriba, que son las únicas que podrían quedar detrás del cartel (las de abajo tienen la cabeza más abajo que la ganadora), pegadas al cartel. La ganadora no pasa del 78% del alto de esa zona ni del 62% del ancho, y el acercamiento no pasa de 1,6 (1,35 en vertical): queda lugar para el golpe de la meta.
- **La cámara protege a la ganadora desde el golpe** (`Camera.proteger` en [`camera.ts`](../../src/games/pixi/camera.ts)): ningún acercamiento, sea el del juego, el golpe, el sacudón o un zoom que se sume después, la corta ni la mete debajo del cartel. Si no entra, la cámara se aleja lo justo; si se sale por un costado, se corre lo justo. Nunca antes de la meta.
- **Al golpe, un corte debajo del destello** a un plano un 8% más abierto que el de la corona, y desde ahí la cámara se acerca despacio. Viajando desde la recta final, en el camino el cartel tapaba un rato a las de arriba.
- **La carrera tampoco corta lo que mira:** la que va adelante, la llama de cada momento con su "!", las dos de la recta final y las dos de la foto. Si no entran a ese acercamiento, la cámara se aleja, y si se salen por un costado, se corre lo justo. Con ocho las llamas son chicas y casi siempre entran; cuando las dos de adelante van en carriles lejanos, ahora la cámara se aleja hasta que se ven las dos, que es lo que ya pedía el comentario de la recta final.
- **La foto mira a las dos del duelo por igual**, de donde van hasta la meta, y debajo de donde va a salir el cartel. Antes se medía con la llama ganadora.
- **Lo que asomaba al alejarse:** debajo del cielo va su último color, y la tribuna se dibuja en todo lo que se ve. Antes, con la cámara más lejos que nunca, entre el cielo y la cordillera asomaba el fondo oscuro del lienzo y los costados de la tribuna quedaban sin gente.

## Auditoría

```bash
node scripts/audit-game.mjs race --base http://localhost:4173
node scripts/audit-encuadre.mjs --base http://localhost:4173
node scripts/audit-identidad.mjs race --base http://localhost:4173
node scripts/audit-emocion.mjs race --base http://localhost:4173
node scripts/audit-rigor.mjs race --base http://localhost:4173
```

**El auditor de encuadre** (`scripts/audit-encuadre.mjs`). Con `?auditar=encuadre` la carrera anota, en la recta final, en la foto y en la corona, dónde cae el cuerpo de cada llama en la pantalla (sin el nombre), dónde está el cartel y dónde la caja del relator. Corre sin red, con la escena fija, en la duración rápida y con el reloj en turbo, en 1440x900, 1024x768, 844x390 y 390x844, con 2, 3, 4, 5 y 8 personas, en los dos temas y en varias semillas (cambia el carril de la ganadora y el arco). Comprueba:

- que la ganadora quede entera en la pantalla desde el golpe, debajo del cartel y encima del relator;
- que, con la cámara ya en su lugar (desde 1,8 s después del golpe), el cartel no tape más del 2% de ninguna otra llama;
- que el cartel quede adentro de la pantalla;
- que la ganadora mida al menos el 10% del alto;
- y, en el duelo, que las dos de la foto queden enteras.

Los cuerpos son rectángulos, de la cola al hocico y de las orejas a la sombra, así que mide de más. Con `--capturas <carpeta>` saca una foto de cada corrida a los 2,2 s del golpe.

## El pelotón que se echa: de 9 a 30 personas (25 de octubre de 2026)

Con 9 a 30 personas la carrera de llamas no tiene clasificatoria: **salen todas juntas** y se van echando hasta que quedan las ocho de la final, que corren en los carriles de siempre. Con 8 o menos y con más de 30 es la de antes (con más de 30, la lista que se tacha y las ocho de la final). `?peloton=0` lo apaga.

- **El plan** ([`src/games/llamas/peloton-plan.ts`](../../src/games/llamas/peloton-plan.ts)) es puro y sale de la ronda, con un azar aparte del de la final: las ocho finalistas son las que ya elegía `planRace`, así que la final cuenta la misma historia. Cuatro tramos (la cuesta, el barro, las piedras, el viento) según cuántas hay que echar; se echan de a una o de a dos, con al menos un segundo entre línea y línea del relator.
- **Nada delata a la ganadora.** Quién se echa y en qué orden es un sorteo sin reglas; la posición en el pelotón es otro sorteo. Los **tambaleos** (la llama se bambolea con un "!") caen un segundo antes de una echada y la persona se sortea **pareja entre todas las que siguen**: puede ser la que se echa, otra que se echará después o una finalista, con la probabilidad que le toca por cantidad. La línea del relator ("¡X se tambalea!") es la misma para todas y habla una moneda que mira solo la hora: nombrar a alguien no dice qué le pasa. Una prueba con 1500 rondas lo comprueba.
- **Los nombres se completan** ([`src/games/nombres.ts`](../../src/games/nombres.ts)): con muchas, el emblema y la inicial; con menos, el nombre de pila, el nombre con la inicial del apellido y por último el nombre entero. Todas suben de nivel a la vez, por cuántas quedan y por cuánto entra en la pantalla (nunca por quién es). Un nombre no se corta nunca: se achica la letra o se parte en dos líneas por un espacio. Al echarse, la ficha crece con el nombre entero. `audit-identidad` mide la versión estricta (cada una lo ve entero antes del ganador): con 8, 18 y 30, todas.
- **Los emblemas** salen de [`src/games/emblemas.ts`](../../src/games/emblemas.ts) (clave y color por persona, sin repetir hasta 32). Mientras llega el dibujo propio, la ficha usa la cara de siempre con el color del emblema como aro.
- **La forma de la pantalla.** En vertical y en una pantalla baja el pelotón usa todo el alto: la tribuna de las que se echaron son dos filas arriba, la valla debajo y el suelo hasta el relator. En una pantalla ancha y alta queda como la pista de siempre. Las columnas se eligen por tamaño de llama y por si cabe el nombre del nivel. Probado a 390x844, 360x800, 768x1024, 1024x768, 844x390 y 1280x720.
- **Fluidez.** Las fichas se arman antes de que hagan falta y, con la calidad baja, hay menos polvo y menos piezas de decorado: nunca menos jugadoras.
- **Cierra filas sin cruzarse.** Al echarse una, cada llama va a la celda que la mueve menos (`reasignarCeldas` en [`src/games/llamas/peloton-forma.ts`](../../src/games/llamas/peloton-forma.ts): la asignación de menor suma de distancias al cuadrado entre dónde estaba y las celdas nuevas). Se queda o se corre un lugar, y las que sobran del final van al hueco más cercano; con otras columnas se mueven todas, pero sin montarse una sobre otra. Solo mira dónde está cada una, nunca quién es. Antes cada una tomaba la celda de su lugar en la lista y las puntas de fila cruzaban todo el pelotón.
- **La ficha grande de quien se echa** se queda donde cayó la llama; si se echan dos juntas, la segunda va arriba de la primera (o abajo si arriba no hay lugar). El destello de la apertura a los carriles va encima de las fichas.
- **El sonido del pelotón.** Los cascos (onda cuadrada, una octava arriba de los de la final, 0,045 y 70 ms) tienen el cuerpo justo para que la mezcla aguante un parlante de proyector (`audit-mezcla`: pierde 3,5 LU o menos al cortar los graves de 150 Hz; medido 3,3 con 18 personas y 3,4 con 30) y no bajan del murmullo de `audit-sound` (0,019). `audit-mezcla` espera hasta 150 s la carrera de 30.
- **Los auditores.** `audit-identidad` mide el nombre entero (con 3, 4, 8, 18 y 30, todos). `audit-delatores` mide la zoom "de siempre" de la señal de cámara desde la largada de la final (`camaraDesde`), y no sobre todo el show: con 45 a 65 s de pelotón a zoom 1, la mediana de todos los cuadros hacía que cada cuadro de la final pasara por acercamiento y marcaba un delator que no era (23,5 % contra 13,7 % medido bien, con 12,5 % de azar).

