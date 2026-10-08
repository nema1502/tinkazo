# Constelación Stellar

Un cielo lleno de estrellas, una por persona, y un paquete que salta de una a otra dejando una línea dibujada, cada vez más lento, hasta que la última explota.

**Identificador:** `stellar` · **Probalo:** [tinkazo.vercel.app/?demo=stellar](https://tinkazo.vercel.app/?demo=stellar) · **Agregado:** 20 de septiembre de 2026

## Por qué existe

Reemplaza a la Carrera Stellar, que era la carrera de llamas con otra piel. Eso se notaba en el propio código: la pista tenía que pintarse más clara que el cielo "para que los cohetes no se pierdan". Es la confesión de que la metáfora estaba rota, porque en el espacio no hay piso. Mientras hubiera carriles y una meta a la derecha, iba a ser la misma carrera con cohetes.

Lo que el espacio sí pide es lo que Stellar hace de verdad: un **path payment**, un pago que salta por activos y anclas intermedias hasta encontrar ruta al destinatario. Eso da tres cosas que una carrera no puede dar.

**Cada participante tiene su estrella.** En la carrera hay ocho carriles: con doscientos inscritos, ciento noventa y dos no aparecen en pantalla. Acá aparecen todos.

**La mecánica es de salto y aterrizaje**, no de avance continuo. Hay un "casi" cada vez que el paquete toca a alguien y sigue de largo.

**Al terminar queda un dibujo.** Veinte líneas entre estrellas forman una constelación. Una carrera termina en una meta y no deja imagen.

La carrera de cohetes no se tiró: quedó como juego propio, con el identificador `rockets`.

## Cómo se ve

- **Fondo:** degradado azul muy oscuro a violeta. Siempre de noche, aunque la página esté en modo claro. En tema claro el degradado sube de luminancia, porque un proyector en una sala con luz necesita más piso.
- **Nebulosas:** tres manchas radiales violeta y magenta que derivan lento.
- **Estrellas de fondo:** doscientas cincuenta en tres capas de parallax, con titileo. No son participantes: son decorado.
- **Las estrellas de la gente:** una cruz de doce puntas, del color que le toca en el ciclo de la paleta, con contorno de tinta y un cuadradito claro en el centro. Cuando el paquete llega, la estrella crece y suelta un halo.
- **Los rombos:** nodos intermedios, huecos, violeta, sin nombre. Son las trustlines por donde rebota el pago. La sala aprende en dos saltos que los rombos no son gente.
- **El paquete:** un cuadrado amarillo girado, girando, con estela de rombos que se achican.
- **Las líneas:** doble trazo, tinta gruesa debajo y color arriba. Es el borde neobrutalista aplicado a una línea. Durante los saltos, las seis últimas van enteras y las viejas finitas y apagadas, para que se vea por dónde viene el paquete y no veinte líneas iguales cruzadas; en la nova engordan todas a la vez.
- **Los chips:** avatar y nombre, solo el actual y los anteriores desvaneciéndose. Nunca los doscientos a la vez.

## El ritmo

Veinte saltos. Los primeros seis **aceleran**, de 0,62 a 0,22 segundos. Los catorce restantes se frenan hasta que el último dura 2,17 segundos. Los veinte suman 14,5 segundos de juego, y con el armado del tablero el juego llega a 17,5. En "normal" se estira para que el show entero, con la tarjeta de "cómo se juega" y el cartel, dure treinta segundos; en la escena fija de `?pose=`, sin tarjeta, el juego solo dura treinta. Ver "La duración" en [juegos.md](../juegos.md).

Acelerar primero no es un capricho. Una desaceleración pura desde el arranque se lee como "esto ya va a terminar" desde el segundo tres. Así la sala aprende el ritmo y se relaja justo antes de que empiece a costar.

En **segundos de juego**: el selector los estira todos por igual, y en "normal" el show dura treinta segundos reales.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 3,0 s | Aparecen las estrellas en oleadas y se llena la barra de "buscando ruta". Los primeros segundos son llamada de atención, no información: la sala todavía está girando la cabeza. |
| 3,0 – 5,4 s | Seis saltos, acelerando. |
| 5,4 – 12,0 s | Siete saltos, el ritmo se abre. |
| 12,0 – 15,3 s | Cuatro saltos, cada uno más largo que el anterior: acá la sala se calla. |
| 15,3 – 17,5 s | El último salto, con un zumbido grave de fondo que dura lo que dura el salto. |
| En el último salto | **El engaño.** La curva se apoya en una estrella vecina y la cámara mira hacia ella. Un poco antes de pasarle al lado se la nombra, con su chip grande ("¿Va para Lucía Flores…?"), y justo cuando el paquete pasa pegado destella y se desvía ("¡DIO LA VUELTA!"), con cuatro notas que caen. El punto sale de la geometría de la curva, no de un porcentaje fijo: al 72% el paquete ya estaba encima de la ganadora. Con tope al 72%, para que la línea no pise a la del ganador. |
| 17,5 s en adelante | Supernova en tres anillos y ocho púas, la constelación entera engorda, la tarjeta amarilla con el nombre. Tres segundos **reales**, para que la sala alcance a leer y a reaccionar. |

## Las tres reglas que lo hacen funcionar

1. **El ganador no se visita nunca antes del último salto.** Si no, habría falsos positivos y la sala no sabría cuándo terminó.
2. **Ningún nodo recibe el pago más de tres veces.** Con dos participantes el paquete no puede quedar rebotando en la única estrella que hay: se va a los rombos.
3. **Ningún salto mide menos del 18% del lado corto.** Todos los saltos se ven.
4. **Con varios premios, los otros ganadores no son ni parada ni amague.** El relator no puede decir "¡Pasa por…!" ni "¡Casi, …!" de alguien que se lleva un premio. En la nova, cuando su renglón entra al cartel, un rayo va de la estrella ganadora a la suya, que se enciende y muestra su nombre.

## Cómo está hecho

Vive en [`src/games/constellation.ts`](../../src/games/constellation.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts).

Las estrellas se colocan en una grilla con temblor, calculada según la cantidad de participantes. Con doscientos en 1920×1080 quedan diecinueve columnas por once filas. Con dos, dos columnas por una fila. Nunca se superponen.

Todo lo visual sale del PRNG sembrado con `beacon.randomness`, así que la misma ronda dibuja siempre la misma animación, en cualquier navegador. **Ninguna de esas decisiones toca el resultado:** el ganador llega dado desde el protocolo y lo único que hace el juego es contarlo.

## Qué mira el auditor

Las doce comprobaciones de [juegos.md](../juegos.md). La que importa es la segunda: el nombre en pantalla tiene que ser el mismo que fijó el protocolo.

```bash
node scripts/audit-game.mjs stellar
```
