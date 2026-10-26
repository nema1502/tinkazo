# La carrera de llamas

Una sola carrera, de izquierda a derecha, hacia la meta: la salida, un grupo que se va echando de a una y la recta final de ocho carriles. Es el juego con el que nació Tinkazo. Se entiende sin leer: un chico de 5 años y alguien del fondo de la sala saben quién va adelante, hacia dónde van, cuánto falta y qué acaba de pasar (la regla del niño, [`docs/juegos.md`](../juegos.md)).

**Identificador:** `race` · **Probarlo:** `/?demo=race` (sorteo real), `/?pose=1` (escena fija, sin red), `/?pose=1&n=60` (con sesenta personas).

Está hecha sobre el kit de juegos (`src/games/pixi/kit/`, "Cómo nace un juego" en [`docs/juegos.md`](../juegos.md)): el show es puro y la escena es una función de la hora.

| Archivo | Qué es |
|---|---|
| `src/games/llamas/carrera-show.ts` | El plan puro: vuelo, nombres, tandas, salida, grupo, recta, relator, marcador y respuestas |
| `src/games/llamas/carrera-tiempos.ts` | Cuándo cambia el terreno y cuándo se echa cada una |
| `src/games/llamas/carrera-orden.ts` | `orden(t)`: quién va primera, segunda... en cada instante |
| `src/games/llamas/carrera-tandas.ts` | De 31 a 200: las tandas, el portón y quiénes pasan |
| `src/games/llamas/carrera-forma.ts` | Dónde va cada una en la pantalla (grupo, carriles, cinta) |
| `src/games/llamas/carrera.ts` | La escena de PixiJS y `crearJuego` |
| `src/games/llamas/llama.ts` | La llama, la postura de echarse y la borla del líder |
| `src/games/llamas/plan.ts` | La recta final: la historia del director de emoción (`planRace`), sin tocar |

## La regla: el juego no decide nada

La ganadora sale del [protocolo](../protocolo.md) antes de la salida. La carrera recibe `(names, winners, beacon, done)` y solo la cuenta: quiénes corren, quién se echa y cuándo, y cómo es la recta. Quién gana lo decide el protocolo, no el juego; y lo que se ve no lo adelanta: el puesto de la ganadora en cada punto de la recta, su tanda, su lugar en el portón, el puesto con que entra a la recta y los nombres del relator salen parejos (1.500 rondas con 18 a 200 personas, `audit-delatores race`, más abajo).

## La ficha del niño

| Pregunta | Qué la contesta, sin leer |
|---|---|
| ¿Quién va adelante? | La de más a la derecha: lleva **la borla amarilla** (un objeto que pasa de una a otra) y es la única con ficha grande, amarilla. Su cara es el cursor de la cinta. Con tandas, "adelante" es el corral: la última que pasó por el portón |
| ¿Hacia dónde? | Siempre a la derecha, de punta a punta: el eje no se cruza. La bandera a cuadros de la meta está en la cinta de arriba desde el segundo 1 y, desde el 80 %, el arco de la meta entra entero |
| ¿Cuánto falta? | El cursor en la cinta (que muestra el camino entero con sus terrenos), los postes que pasan, el suelo de cada terreno y el arco de la meta que se acerca. Cuántas quedan: el marcador del kit, el único número en pantalla |
| ¿Qué acaba de pasar? | Una echada: la llama dobla las patas, baja el cuerpo, se pone gris, levanta polvo y queda así, donde pasó, con su nombre y una "zZ"; a los 0,3 s de la línea del relator ya va más de la mitad. Una por vez, a 1,2 s o más. Un cambio de punta: la borla vuela a otra llama. Un portón: pasa una y se pone amarilla en el cartel |

Hechos (`respuestas(t)`): `empezo` (la salida), `salio` (una se echa, o al cerrarse el portón las que no pasaron), `adelante` (cambia la punta o pasa una por el portón), `freno` (tropiezo, plantada, escupida en la recta) y `gano`.

## Lo que se ve, en orden

1. **El vuelo** (3 s): la cámara va de la meta a la salida, y se ve el camino entero.
2. **Los nombres** (3,7 s, hasta 30): todos, enteros y en orden alfabético, en un cartel. En Rápido el show se comprime hasta 0,82: 3,7 s del plan son 3 de verdad. Con más de 30, el cartel es el de cada tanda.
3. **Las tandas** (de 31 a 200): hasta 25 por tanda, parejas, y de cada una pasa el mismo número por el portón, de a una y a 1,2 s (de 151 a 175 son ocho tandas más chicas, de a una: con siete no entra en los 90 s). El cartel de la tanda va a un costado (arriba en el celular), 3,7 s y sigue mientras corre (en Rápido, 3 s de verdad); quien pasa se pone amarilla y, cuando se cierra el portón, las demás se echan juntas y se apagan. Las que pasaron esperan del otro lado del portón y después se acomodan en el corral.
4. **La salida y el grupo**: corren todas, la punta cambia de dueña cada 4 a 6 s y de a una se van echando, con un terreno por tramo (la cuesta, el barro, las piedras, el viento). El grupo es una flecha que apunta a la derecha.
5. **La recta**: quedan las ocho de la final, que entran sin frenar en el orden de la final y corren en carriles hasta la meta. La historia (remontada, susto, duelo, tapada) es la del director de emoción de siempre: un momento y una línea del relator sin nombre; los nombres de la final son los de la tribuna.
6. **El golpe**: el silencio, el acercamiento del 20 %, el foco sobre quien gana y su nombre en grande; el cartel nunca queda encima de ella.

## El relator

Seis palabras o menos, un nombre por línea como mucho, ningún número (los números van en el marcador). El ritmo lo llevan el cuerpo y el sonido. En la final los momentos ("¡Alguien se plantó!", "¡Vienen de atrás!", "¡Mano a mano!") no llevan nombre: se ven en la pista, y nombrar a quien los protagoniza decía quién gana. Los nombres de la final son los de la tribuna ("¡Vamos, Ana!"): hasta cuatro de las ocho, sorteadas aparte sin mirar quién gana ni quién va adelante, en los huecos de lo que ya se dice. Tres tiempos por tramo: qué pasó (la echada), qué pasa (quién va adelante) y qué sigue (el terreno nuevo). "Salida", no "largada".

## Cuánto dura

`normalCarrera(n)` sale del plan y nunca pasa de 90 s de show, con 9 a 200 personas (la tarjeta de "cómo se juega" cuenta dentro del total): de 39 s con 9 a 78 s con 30, de 71 a 84 con tandas y 71 con 200. Rápido es el 90 % de Normal, no la mitad: por debajo de eso las echadas caen a menos de 1 s y no se ven. El ensayo corre en el ritmo de quien organiza.

## Lo que se ve no delata a la ganadora

- **El orden del grupo no mira a nadie.** Es un paseo sembrado con la ronda; la punta cambia entre las que siguen en ese momento (también una que se echa después); al final las finalistas se ordenan como entran a la recta, que es el orden de la final al 7 %, parejo sumando los cuatro arcos. Probado con 600 rondas: la ganadora entra a la recta en cualquier puesto con la misma frecuencia y lleva la punta tanto como cualquiera.
- **Las echadas salen de una fila barajada.** Se echa cualquiera, también la primera; nadie frena antes de echarse.
- **Las tandas son parejas.** Mismo tamaño (±1), mismas plazas, y el orden del portón es otro sorteo: la tanda de la ganadora y su lugar en el portón son parejos (600 rondas con 60, 100 y 200).
- **La recta** conserva lo de siempre: el puesto de la ganadora al 7, 25, 50 y 75 % se sortea por arco, y las cuatro franjas se reparten los puestos para que cada uno salga una de cada ocho veces (a la mitad: el duelo del 1.º al 4.º, la tapada del 3.º al 6.º, la remontada del 5.º al 8.º y el susto 1.ª o 2.ª si todavía no tropezó y 7.ª u 8.ª si ya, antes o después de la mitad mitad y mitad); lo que se sortea es lo que se ve, aunque varias corran pegadas. La rival del duelo corre arriba o abajo, sorteado; en la remontada vienen de atrás dos.
- **Lo que mide el auditor** (`audit-delatores race`, a nivel del plan, sin navegador: 1.500 rondas con 18, 30, 60, 100 y 200 personas, y la ganadora de la selección del protocolo). La punta (primera, última, mitad de adelante, al empezar y a un cuarto, a la mitad y a tres cuartos del grupo), el tiempo en la punta, de dónde sale quien se echa, la tanda, el lugar en el portón, la última en pasar, el puesto con que entra a la recta y el carril salen parejos: ninguna señal con una probabilidad menor que 1 en 1000 (los repartos, con chi cuadrado de casilleros menos uno grados de libertad). También lo que dice el relator en la final: a quién nombra, quién primero, quién último, la más nombrada y nombradas contra nunca nombradas. Dos cosas no lo eran hasta el 26 de octubre y se arreglaron: el puesto de la ganadora a mitad de la recta (el 1.º salía 1,3 veces lo que toca, por cómo se repartían las franjas de los arcos) y el relator (nombraba a la ganadora por su momento y la ponía última en la remontada: quien se nombraba último ganaba 1,5 a 1,8 veces lo que toca). Con 6.000 rondas, ninguna señal sale de la casualidad.

## Pruebas

`carrera-show.test.ts` (guion de seis palabras, un nombre y sin números; momentos; marcador; respuestas; tres tiempos por tramo), `carrera-orden.test.ts` (la punta y que no delata), `carrera-tiempos.test.ts` (el presupuesto), `carrera-tandas.test.ts` (las tandas y que no delatan), `carrera-forma.test.ts` (cuatro pantallas) y `src/duraciones.test.ts` (90 s). Los delatores, sin navegador: `scripts/lib/delatores-carrera.test.mjs` y `node scripts/audit-delatores.mjs race`. En el navegador: `audit-game race`, `audit-rigor race`, `audit-identidad race`, `audit-delatores`, `audit-emocion` y el evaluador.
