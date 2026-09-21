# Pasanaku

Un aguayo tendido en el suelo. Cada participante tira su bulto encima, se tejen los hilos entre vecinos, y después la tela se empieza a cerrar hasta que queda uno solo en el nudo.

**Identificador:** `pasanaku` · **Probalo:** [tinkazo.vercel.app/?demo=pasanaku](https://tinkazo.vercel.app/?demo=pasanaku) · **Agregado:** 20 de septiembre de 2026

## Por qué se llama así

El *Diccionario de americanismos* de las academias de la lengua lo define, bajo la grafía `pasanacu`, como **"juego que consiste en sortear el dinero de las cuotas semanales o mensuales de los participantes"**, y lo marca como boliviano. ([fuente](https://www.asale.org/damer/pasanacu))

O sea que no hubo que forzar nada. Un pasanaku ya es un sorteo, y uno que miles de bolivianos corren todos los meses: un grupo de gente de confianza pone la misma cuota, y cada mes uno se lleva todo el pozo. El orden lo decide la suerte. Es exactamente la promesa que vende Tinkazo, hecha a mano y sin cadena, desde mucho antes que existiera la cadena.

Un boliviano lo reconoce al toque. Un extranjero ve una palabra que no entiende y quiere saber qué es. Esa curiosidad es el punto.

## El cruce con Stellar

Un pasanaku es lo que en la literatura se llama una ROSCA, un ahorro rotativo. La misma institución existe con otro nombre en medio mundo: tanda en México, susu en África occidental, junta en Perú, paluwagan en Filipinas, stokvel en Sudáfrica. Es el sistema financiero que la gente se construyó donde el banco no llegó.

Y el puente técnico no es una metáfora. **Un pasanaku corre sobre trustlines.** En Stellar, aceptar el activo de alguien es un acto explícito que te cuesta media unidad de reserva. En un pasanaku es lo mismo sin cadena: solo entrás a la rueda con gente de la que aceptarías plata.

El juego lo dibuja. Cada bulto tira dos hilos a sus vecinos, y esa red es lo que sostiene el pozo. A los 3,4 segundos el narrador dice **"¡Acá nadie firma nada!"**, y en los dos segundos siguientes la sala ve una red de confianza y oye que no hay contrato. El tejido duraba 0,8 segundos y era mudo: la escena que más enseña era la que menos duraba. Eso es la trustline explicada sin usar la palabra. La palabra aparece recién en la tarjeta, después del ganador.

## La mecánica

Los bultos caen sobre la tela. Se tejen los hilos. Entonces las cuatro puntas se levantan y el aro se aprieta: los bultos se empujan entre ellos y los que quedan fuera del aro salen por el borde.

**El que sale no pierde: ya cobró.** Así funciona un pasanaku, el que ya cobró sale del sorteo de los meses que faltan. Por eso el narrador dice "¡Ya cobró Jorge!" y no "Jorge perdió". Además de ser más cálido, es verdad: en un pasanaku cobran todos.

Al final queda uno en el nudo. El nudo se ata con un cordón tricolor, se levanta del suelo, y ese es el que cobra hoy.

## Cómo escala

Al revés que la ruleta, y mejor que todos.

| Participantes | Apretones | Qué se ve |
|---|---|---|
| 2 | 1 | Dos atados forcejeando dentro de un nudo que se aprieta. **Es más dramático con dos que con doscientos.** |
| 3 a 4 | 1 | Uno sale en el apretón, el resto va al nudo |
| 5 a 12 | 2 | |
| 13 a 200 | 3 | Un hervidero. La pila de los que ya cobraron se vuelve una barra de progreso hecha de cuerpos |

Los apretones suman siempre 7,5 segundos de juego, así que el juego dura lo mismo con cualquier cantidad. Sumaban 4,2 y el nudo se cerraba antes de que la sala entendiera qué estaba mirando.

## Los tiempos

| Tramo | Qué pasa |
|---|---|
| 0,0 – 0,7 s | El aguayo cae y se despliega |
| 0,7 – 2,3 s | Los bultos caen escalonados. El pote sube |
| 2,3 – 3,1 s | La red de hilos se completa. Acá va la línea de la trustline |
| 3,1 – 7,3 s | Uno, dos o tres apretones. Las puntas se levantan y los de afuera salen |
| 7,3 – 8,6 s | Los últimos dos o tres chocando en un aro chiquito |
| 8,6 – 10,3 s | El cordón tricolor ata el nudo, se levanta, sale el cartel |

## Cómo está hecho

Vive en [`src/games/pasanaku.ts`](../../src/games/pasanaku.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts).

**La física corre a paso fijo de 1/120 de segundo**, con acumulador. Sin eso la misma ronda dibujaría distinto en una máquina de 60 Hz y en una de 144, y el proyecto entero se apoya en que la misma ronda dé siempre lo mismo.

**Quién sale no lo decide la física.** El orden de salida está sembrado con la ronda de drand, y el ganador va primero en esa lista, así que nunca lo expulsan. Al bulto que toca sacar se le da un empujón hacia afuera y la física solo lo acompaña.

## El detalle boliviano

Dos cosas, y las dos son funcionales.

**El aguayo** está en la paleta de Tinkazo, no en "colores andinos". Un extranjero ve una tela a rayas; un boliviano ve un aguayo. Es el tablero de juego, no un adorno. Lleva su banda de *pallay*, que es como se llama la franja con diseño de un aguayo de verdad.

**El cordón tricolor** es lo que ata el nudo. Aparece un segundo y medio, al final, cuando ya no hay tensión que robar.

La regla que se siguió: lo boliviano entra por la función, nunca por la decoración. Si el elemento se puede sacar sin que nada deje de funcionar, es decoración y sobra. Nada de wiphalas, cholitas ni la palabra "Bolivia" en pantalla. El pie de página ya dice "Hecho en Bolivia" y con eso alcanza.

## Qué mira el auditor

```bash
node scripts/audit-game.mjs pasanaku
```

La comprobación que importa: el nombre en pantalla tiene que ser el que fijó el protocolo. La tela no decide nada.
