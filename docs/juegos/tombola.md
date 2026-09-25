# Tómbola

El bombo de las kermeses. Una bola por persona, con su número en la lista sellada. Tres vueltas de manivela con las bolas golpeándose adentro, se abre la compuerta y sale una sola, que baja rodando por una canaleta en zigzag hasta el vaso. Al caer, el nombre.

**Identificador:** `tombola` · **Probalo:** [tinkazo.vercel.app/?demo=tombola](https://tinkazo.vercel.app/?demo=tombola) · **Agregado:** 24 de septiembre de 2026

## Por qué una tómbola

Porque es el sorteo que todo el mundo ya conoce. Cualquiera que haya ido a una kermés de colegio, a la fiesta de un barrio o a una rifa de la parroquia vio un bombo girar y una bola salir. No hay nada que explicar: el organizador lo proyecta y la sala entiende sola qué va a pasar.

Y es el único de los juegos donde **la bola que sale es la ganadora**, como en la tómbola de verdad. En los demás el juego va sacando gente hasta que queda una; acá sale una sola y es esa.

## El número de la bola

Cada bola lleva el puesto de la persona en la lista sellada, contado desde uno. Es el mismo índice que muestra el comprobante (que cuenta desde cero, como el protocolo). Así, mientras la bola baja por la canaleta con su número a la vista, la sala puede buscarse en la lista antes de que salga el nombre.

## La mecánica

**El llenado.** Las bolas entran de a una por la boca de arriba, en un orden sembrado, y caen al fondo. El contador de arriba a la derecha las cuenta.

**Tres vueltas de manivela.** Cada una más fuerte que la anterior. Las bolas no están dibujadas en un lugar fijo: hay física de verdad, con gravedad, choques entre bolas y tres paletas adentro del bombo que las levantan. La física corre a paso fijo de 1/120 de segundo, así que la misma ronda da el mismo recorrido en cualquier máquina.

**La compuerta.** El bombo frena y la compuerta termina justo en la salida: el ángulo final sale de integrar la velocidad y escalarla, igual que en la ruleta. Se abre, y sale una sola bola.

**La canaleta.** La bola rueda por tres tramos en zigzag, cada vez más lenta, y crece para que el número se lea desde el fondo. En el borde del vaso se frena, se tambalea medio segundo con un latido de fondo, y cae.

## Lo que el bombo hace a propósito

Una sola cosa, y la dice el código: **en la última vuelta, la bola del ganador se acerca a la compuerta**, y cuando el bombo se para, nadie más que ella queda frente a la salida. La compuerta se abre para esa bola.

No es trampa porque el ganador ya estaba elegido. El protocolo lo fijó con el sello de la lista y la ronda de drand antes de que el bombo empezara a girar; la física solo le da a la sala algo que mirar. Lo que sí sería trampa es lo contrario: que la física decidiera quién sale. Un choque mal resuelto o un redondeo cambiaría el ganador, y eso rompe la única promesa del producto.

## Cómo escala

El radio de las bolas sale de llenar un tercio del bombo, con topes.

| Participantes | Qué se ve |
|---|---|
| 2 | Dos bolas grandes con su número, rodando por todo el bombo |
| 18 | Las bolas con número, golpeándose. Se leen desde el fondo |
| 200 | Una lluvia de bolas chicas sin número. La que sale crece hasta que el número se lee |

Con doscientas son veinte mil comprobaciones de choque por paso de física. El auditor exigente la corre con doscientas en cada auditoría y mide que siga fluida.

## Los tiempos

En segundos de juego, sin estirar. En "normal" se multiplican por 1,7.

| Tramo | Qué pasa |
|---|---|
| 0,0 – 1,8 s | El llenado. "¡Adentro todas las bolas!" |
| 1,8 – 4,2 s | Primera vuelta |
| 4,2 – 6,8 s | Segunda, más fuerte |
| 6,8 – 10,2 s | La última, a toda máquina. La bola del ganador se va acercando a la compuerta |
| 10,2 – 11,0 s | El bombo frena. Silencio |
| 11,0 s | Se abre la compuerta |
| 11,0 – 11,6 s | La bola sale |
| 11,6 – 14,8 s | Rueda por la canaleta. "¡La número 4!" |
| 14,8 – 15,4 s | Se tambalea en el borde del vaso |
| 15,4 s | Cae: destello, temblor y golpe |
| 16,0 s | El cartel, que se sostiene tres segundos reales |

## El sonido

- **El llenado:** una nota por bola que entra, con tope.
- **La manivela:** un trinquete cada octavo de vuelta, que se acelera con el bombo.
- **El bombo:** un zumbido que sube y baja con la velocidad.
- **Las bolas:** un golpeteo corto cuando chocan fuerte, como mucho ocho por segundo.
- **La compuerta:** dos notas que abren.
- **La canaleta:** un toque en cada vuelta del zigzag, cada vez más grave.
- **El borde del vaso:** el latido.
- **La caída:** el golpe de la traba, como en la ruleta, y después la fanfarria.

## Cómo está hecho

Vive en [`src/games/tombola.ts`](../../src/games/tombola.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts).

La física trabaja en radios del bombo, no en píxeles: el bombo mide uno, y la pantalla solo decide dónde se dibuja. Por eso girar el celular a mitad del sorteo no mueve ninguna bola, y el lugar donde frena la compuerta se fija al arrancar. La pared arrastra la velocidad tangencial de las bolas que la tocan hacia la del bombo; las paletas son segmentos que empujan con la velocidad del punto donde tocan.

Saltar no simula: deja las bolas asentadas en una pila calculada. Simular hasta el final eran mil trescientos pasos de física de golpe, y con doscientas bolas eso se notaba como un tirón justo cuando alguien apretó "saltar".
