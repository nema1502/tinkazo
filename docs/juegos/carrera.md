# La carrera de llamas

Hasta ocho llamas por la cordillera, con hinchada, relator y foto de llegada. Es el juego con el que nació Tinkazo. Con más de ocho personas, primero la clasificatoria: aparecen todas con su llama, se van tachando en oleadas y las ocho de la final bajan a la pista.

**Identificador:** `race` · **Probarlo:** `/?demo=race` (sorteo real), `/?pose=1` (escena fija, sin red), `/?pose=1&n=3` (con tres personas).

Este documento cuenta cómo mira la cámara de la carrera en el motor nuevo ([`src/games/llamas/pixi-race.ts`](../../src/games/llamas/pixi-race.ts)), y sobre todo cómo encuadra el final cuando corren pocas. La historia de cada carrera (el arco, los tropiezos, las plantadas, la escupida y el duelo) está en "El director de emoción" de [juegos.md](../juegos.md).

## La regla: el juego no decide nada

La ganadora sale del [protocolo](../protocolo.md) antes de la largada. La carrera recibe `(names, winners, beacon, done)` y solo la cuenta: quiénes corren, en qué carril y dónde va cada una en cada instante salen del plan ([`plan.ts`](../../src/games/llamas/plan.ts)), sembrado con la ronda. La cámara tampoco decide nada: mira lo que el plan ya decidió, y nunca mira a la ganadora antes de la meta, porque mirarla sería delatarla.

## La cámara

| Momento | Qué mira |
|---|---|
| Presentación y cuenta | Los carriles enteros en la largada, del nombre del primero a las patas del último; en la cuenta se abre de a poco hacia la pista |
| La carrera | La que va adelante, un poco adelantada, y se acerca a medida que sube la tensión |
| Un momento de la historia | Se mete en el carril del tropiezo, la plantada o la escupida, con la llama entera y su "!" |
| La recta final (desde el 80%) | Las dos de adelante, en un acercamiento que se apura hasta la meta |
| La foto (en el duelo, desde el 96%) | Cámara lenta, sin desenfoque, las dos del duelo enteras, por igual |
| La meta | Un corte debajo del destello, el golpe y el sacudón, y la cámara se acerca despacio al plano de la corona |

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
