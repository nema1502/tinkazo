# Aguayo

Un aguayo tendido en el suelo. Cada participante tira su bulto encima, se tejen los hilos entre vecinos, y después la tela se empieza a cerrar y a amarrar hasta que queda uno solo en el nudo.

**Identificador:** `pasanaku` · **Probalo:** [tinkazo.vercel.app/?demo=pasanaku](https://tinkazo.vercel.app/?demo=pasanaku) · **Agregado:** 20 de septiembre de 2026, como Pasanaku · **Aguayo desde:** 28 de septiembre de 2026

## Por qué dejó de llamarse Pasanaku

Nació como Pasanaku, el ahorro rotativo boliviano. Pero un pasanaku de verdad es plata: un grupo pone la misma cuota y cada mes uno se lleva el pozo. El juego lo mostraba tal cual, con un pote de monedas y un relator que decía "¡ya cobró fulano!". En un sorteo que es gratis por regla, eso era justo la imagen que no tiene que tener: nadie pone plata, así que no hay pozo.

El juego se quedó con lo que funcionaba, que nunca fue la plata sino la tela. El identificador sigue siendo `pasanaku` para no romper enlaces.

## Por qué un aguayo

El *Diccionario de americanismos* lo define como la **"pieza rectangular de lana de colores, usada por las mujeres [...] para llevar a los niños o cargar algunas cosas"**. ([fuente](https://www.asale.org/damer/aguayo)) En Bolivia se amarra a la espalda con todo adentro. Eso es el juego: cada nombre es un bulto sobre la tela, la tela se cierra, y el que queda se va en el nudo.

Un boliviano lo reconoce al toque. Un extranjero ve una tela a rayas que no conoce y quiere saber qué es. Esa curiosidad es el punto.

## Los hilos son trustlines

Cada bulto tira dos hilos a sus vecinos, y la red se teje de a uno. En Stellar, aceptar el activo de alguien es un acto explícito que cuesta medio XLM de reserva: una trustline. El juego lo dibuja sin decir la palabra, y la palabra aparece recién en la tarjeta de historia, después del ganador.

## La mecánica

Los bultos caen sobre la tela y se tejen los hilos. Entonces empieza a apretar: las cuatro puntas del aguayo se doblan sobre la tela, dejando su hueco, y el aro se achica. Los bultos se empujan entre ellos y los que quedan fuera del aro se caen por el borde y van a la fila de abajo. Al final las cuatro puntas suben y se juntan en el nudo, que se ata con el cordón tricolor, y el aguayo se levanta con el que quedó adentro.

Arriba a la izquierda, un contador dice cuántos bultos quedan en el aguayo, con un retazo que se teje franja por franja mientras caen.

## Cómo escala

Al revés que la ruleta, y mejor que casi todos.

| Participantes | Apretones | Qué se ve |
|---|---|---|
| 2 | 1 | Dos bultos forcejeando dentro de un nudo que se aprieta. **Es más dramático con dos que con doscientos** |
| 3 a 4 | 1 | Uno sale en el apretón, el resto va al nudo |
| 5 a 12 | 2 | |
| 13 a 200 | 3 | Un hervidero. La fila de los que se cayeron se vuelve una barra de progreso hecha de bultos |

Los apretones suman siempre 7,5 segundos de juego, así que el juego dura lo mismo con cualquier cantidad.

## Los tiempos

En segundos de juego, sin estirar.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 1,0 s | El aguayo se tiende. "¡Se tiende el aguayo!" |
| 1,0 – 3,4 s | Caen los bultos. "¡Cada uno pone su bulto!" |
| 3,4 – 5,4 s | Se teje la red. "¡Hilo con hilo!" |
| 5,4 – 12,9 s | Uno, dos o tres apretones; las puntas se doblan y los de afuera se caen |
| 12,9 – 16,5 s | Los últimos en un aro chiquito. "¡SE ATA EL NUDO!" |
| 16,5 s | Se levanta el atado, con las cuatro puntas juntas en el nudo, y sale el cartel |

## Lo que la tela hace a propósito

**Quién sale no lo decide la física.** El orden de salida está sembrado con la ronda de drand, y el ganador va primero en esa lista, así que nunca lo expulsan. Al bulto que toca sacar se le da un empujón hacia afuera y la física solo lo acompaña. En el arco del susto, el bulto ganador sale empujado hasta el filo, tiembla ahí con un aro rojo, y la tela lo vuelve a meter.

## Cómo está hecho

Vive en [`src/games/pixi/pasanaku.ts`](../../src/games/pixi/pasanaku.ts), en el motor nuevo, y tiene su versión de respaldo en [`src/games/pasanaku.ts`](../../src/games/pasanaku.ts).

**La física corre a paso fijo de 1/120 de segundo**, con acumulador. Sin eso la misma ronda dibujaría distinto en una pantalla de 60 Hz y en una de 144, y el proyecto entero se apoya en que la misma ronda dé siempre lo mismo.

Los que se caen y los nombres viven en la capa de la interfaz, no en la de la cámara: con la cámara pegada a la tela, la fila de abajo y los chips quedan siempre a la vista y del mismo tamaño.

## El detalle boliviano

Dos cosas, y las dos son funcionales.

**El aguayo** está en la paleta de Tinkazo, no en "colores andinos". Es el tablero de juego, no un adorno. Lleva su banda de *pallay*, que es como se llama la franja con diseño de un aguayo de verdad.

**El cordón tricolor** es lo que ata el nudo. Aparece al final, cuando ya no hay tensión que robar.

La regla que se siguió: lo boliviano entra por la función, nunca por la decoración. Si el elemento se puede sacar sin que nada deje de funcionar, es decoración y sobra.

## Cómo auditarlo

```bash
node scripts/audit-rigor.mjs pasanaku
node scripts/audit-game.mjs pasanaku
```

La comprobación que importa: el nombre en pantalla tiene que ser el que fijó el protocolo. La tela no decide nada.
