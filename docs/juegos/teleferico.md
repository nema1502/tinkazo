# Teleférico

Un convoy de cabinas sube por el cable. En cada estación se baja la mitad de los pasajeros, las cabinas que quedan vacías vuelven para abajo, y la última cabina llega sola a la cumbre y abre la puerta.

**Identificador:** `teleferico` · **Probalo:** [tinkazo.app/?demo=teleferico](https://tinkazo.app/?demo=teleferico) · **Agregado:** 24 de septiembre de 2026

## Por qué un teleférico

Porque en La Paz y El Alto el teleférico no es una atracción, es el colectivo. Según la empresa que lo construyó, Mi Teleférico es **"the world's biggest urban ropeway network"**: diez líneas, 1.396 cabinas de diez pasajeros y unas trescientas mil personas por día. ([fuente](https://www.doppelmayr.com/en/reference-projects/reference-project-mi-teleferico/))

Y las líneas se llaman por su color: Roja, Amarilla, Verde, Azul, Naranja, Blanca, Celeste, Morada, Café y Plateada. Las cabinas del juego llevan esos diez colores, y la tarjeta de historia lo cuenta después del ganador.

La regla de la casa es que un elemento boliviano tiene que hacer algo o no entra (está en [historia.html](../../historia.html)). Acá el teleférico es el tablero entero: el cable es la barra de progreso, cada estación es una ronda, y la altura dice cuánto falta.

## La mecánica

**Embarque.** Los pasajeros suben a las cabinas en la base. El contador de arriba a la izquierda cuenta los que subieron.

**Las paradas.** El convoy sube hasta una estación y frena; las cabinas se hamacan para adelante. Los que se bajan salen por la ventana de su cabina, cada uno con su cara, y vuelan de a uno a su renglón del andén, donde aparece su nombre; la estación queda marcada con cuántos se bajaron. El andén es una lista en la pantalla, al costado de la estación donde menos tapa, y se queda quieta hasta que se bajan los de la estación siguiente. En un proyector entran hasta veinticuatro renglones (tres columnas de ocho) y en un celular hasta catorce (dos de siete); si se bajan más, el último renglón dice cuántos faltan ("+77") y el resto salta en cascada al piso de la estación. Hasta el 18 de octubre de 2026 saltaban cuadraditos de color y los nombres salían solo si se bajaban tres o menos: con veintisiete personas, los trece de la primera estación se iban sin que nadie supiera quiénes eran. Un co-ganador que se baja antes de la última estación va primero en el andén, con una estrella, y el relator lo nombra siempre, con su premio, aunque se bajen muchos: "¡Óscar Limachi sale, pero con premio!". Las cabinas que quedaron vacías se sueltan y vuelven para abajo, y las demás cierran el hueco.

**La última estación.** Quedan dos cabinas, con una persona cada una y su nombre al lado. Si el arco no tiene ahí su giro (la puerta o la mordaza), un aro amarillo salta de una cabina a la otra en cada latido, cada vez más lento, como una moneda en el aire, y se apaga sobre la que pierde justo cuando se abre su puerta. Cuántos saltos da sale de la ronda, así que de qué cabina arranca no dice nada. El que se baja salta al andén con su cara y su nombre, por encima de la cabina de adelante, y al tocar el piso suena un golpe seco. Hasta el 7 de octubre de 2026 era un cuadradito de 14 px y un pitido.

**El último tramo.** La cabina que queda sube sola, con el latido cada vez más seguido y más agudo. Llega a la cumbre, golpe, se abren las puertas y sale el cartel.

**Las banderas.** Cada estación tiene la suya, en su color, en un mástil alto sobre la esquina izquierda del techo; cada cabina lleva un banderín en la esquina de atrás; y la cumbre tiene banderines de los diez colores colgados de esquina a esquina, que se sacuden de fiesta cuando llega la cabina ganadora. Flamean para la izquierda, que es para donde sopla el viento en este valle, y con la ráfaga se estiran y ondulan más. Como todo lo demás, salen de la hora de juego.

## El giro de cada arco

El director de emoción ([`src/games/drama.ts`](../../src/games/drama.ts)) elige un arco por sorteo, y en el teleférico cada uno tiene su giro. Siempre pasa algo, pero nunca lo mismo:

| Arco | Giro | Qué se ve |
|---|---|---|
| Susto | La puerta | En la última estación se abre la puerta de la cabina ganadora, el pasajero se corre hacia ella y la cabina se sacude. La puerta se cierra: "¡NO! ¡SE QUEDA!". El que se baja es el de la otra |
| Duelo | La mordaza | En la última estación la cabina de atrás de las dos que quedan se suelta: la banda se calla de golpe, la cámara queda quieta y la cabina resbala cable abajo casi una cabina entera, con un aro rojo que titila, vetas de velocidad y un chirrido que baja de tono. La mordaza la agarra con un fogonazo, chispas y un tirón que la deja hamacándose, la banda vuelve, y el cable la sube otra vez. Hasta el 18 de octubre de 2026 la cámara la seguía de cerca, y como lo que se movía era el fondo, el resbalón casi no se veía. Es la de atrás y no la del ganador: a veces se salva el que gana y a veces el que se baja igual |
| Tapada | El apagón | En el tramo que llega a la última estación, cuando más rápido va, la luz titila dos veces y se corta. Se apaga todo menos las cabinas, que quedan colgando con su luz de emergencia y las caras a la vista; la banda se calla, y el convoy frena de golpe en el aire, con un golpe seco, hamacándose con un latido. La luz vuelve titilando, la banda con ella, y el convoy recupera el paso. Hasta el 18 de octubre de 2026 era un velo a media luz sobre todo, cabinas incluidas, y la sala no se enteraba del apagón |
| Remontada | La ráfaga | A mitad de viaje entra un viento: vetas que cruzan la pantalla, cabinas que se hamacan cada una a su tiempo y banderas estiradas. La hora se siembra, pero se corre si cae encima de una estación, para no pisar al relator |

El apagón no alarga el juego: se lleva un pedazo del viaje, igual que la última parada se toma más tiempo con la puerta o la mordaza. El convoy frena con una curva continua (la hora del tramo avanza cada vez más despacio hasta quedarse quieta y después recupera el paso), así que nunca retrocede ni salta, y saltar al final sigue siendo poner el reloj en su lugar.

## Tres decisiones que no son de estilo

**Los últimos cinco en bajarse van cada uno en una cabina distinta.** El convoy lleva como mucho cinco cabinas, y el reparto se hace de modo que los últimos cinco del orden de bajada queden separados. Así, cuando quedan cinco o menos, cada cabina lleva a una persona y se la puede nombrar. Y la cabina del ganador cae en un puesto sorteado del convoy: si fuera siempre la de adelante, la sala lo aprende al segundo sorteo y se acabó la tensión.

**Con poca gente hay estaciones de largo.** El grupo se parte a la mitad en cada parada, así que dos participantes son una sola parada. En vez de estirar esa parada hasta la cámara lenta, hay como mínimo cuatro estaciones y el convoy pasa de largo por las que sobran. El narrador lo dice: "¡En la 2 no se baja nadie!". Nunca se anuncia una bajada que no ocurre.

**Todo es una función del tiempo de juego.** Dónde está la cabeza del convoy, cuánto se hamaca cada cabina, por dónde va cada pasajero que salta al andén: nada se acumula cuadro a cuadro. Saltar es poner el reloj al final, y la misma ronda dibuja los mismos cuadros en cualquier máquina. El auditor exigente lo comprueba huella por huella.

## Cómo escala

| Participantes | Paradas | Estaciones de largo | Qué se ve |
|---|---|---|---|
| 2 | 1 | 3 | Dos cabinas, un nombre cada una, desde el embarque |
| 3 | 2 | 2 | |
| 5 | 3 | 1 | Cinco cabinas de una persona |
| 18 | 5 | 0 | Cabinas de tres o cuatro, con el conteo en una etiqueta |
| 200 | 8 | 0 | Cinco cabinas de cuarenta. En la primera parada se bajan cien: en un proyector veintitrés vuelan a su renglón del andén, el último renglón dice "+77" y el resto salta en cascada al piso de la estación |

Los tiempos no cambian con la cantidad: las paradas se reparten entre el fin del embarque y el último tramo.

## Los tiempos

En segundos de juego, sin estirar. En "normal" se estiran para que el show entero dure treinta segundos: unos 1,43 con la tarjeta de "cómo se juega" y unos 1,65 en la escena fija de `?pose=`, que no la tiene. Ver "La duración" en [juegos.md](../juegos.md).

| Tramo | Qué pasa |
|---|---|
| 0,0 – 2,0 s | Embarque. "¡Suban, suban, que se va!" |
| 2,0 s | Campana de salida |
| 2,0 – 14,0 s | Viajes y paradas. Viajar pesa 1, parar 0,8 y la última parada 1,7 (2,4 con la puerta, 2,6 con la mordaza). El apagón pesa 1,3 |
| 14,0 – 15,8 s | El último tramo, a solas. Hasta el 7 de octubre de 2026 arrancaba a los 13,4: con el ganador ya sabido, la subida sola se hacía larga |
| 15,8 s | Llega a la cumbre: destello, temblor y golpe |
| 16,4 s | Se abren las puertas y sale el cartel, que se sostiene tres segundos reales |

## El sonido

Todo por la escala de `note()` y dentro de los grados 0 a 20.

- **Embarque:** un clic por pasajero, con tope de once por segundo.
- **El cable:** un zumbido que sube y baja de tono con la velocidad del convoy, igual que el motor de la ruleta.
- **Estaciones:** ding-dong al llegar; una sola campanada al pasar de largo.
- **Los que se bajan:** hasta seis notas que bajan, una por pasajero.
- **Cabina que se suelta:** un golpe seco.
- **La última estación:** un latido grave con su octava, que en un parlante de proyector un seno solo de 131 Hz se pierde. Con el aro, cada salto es un latido.
- **El que se baja en la última:** un golpe seco cuando toca el andén.
- **El último tramo:** el latido se acelera de 0,42 a 0,18 s de juego y sube de a un grado. Iba parejo.
- **La cumbre:** el golpe de la traba, como en la ruleta, y después la fanfarria.
- **La mordaza:** la banda se calla cuando se suelta; cinco notas que bajan y un chirrido que baja de tono mientras resbala; cuando agarra, un golpe metálico con su chasquido, y la banda vuelve en el uno.
- **El apagón:** un chasquido en cada parpadeo de antes; cuando se va la luz se calla la banda y caen cuatro notas; un golpe seco cuando el convoy queda quieto, y después el latido a oscuras; un clic por cada vez que prende, y la banda vuelve cuando la luz se queda.
- **La ráfaga:** un soplido grave que dura lo que dura el viento.

## Cómo está hecho

Vive en [`src/games/cablecar.ts`](../../src/games/cablecar.ts) y usa el andamiaje de [`src/games/overlay.ts`](../../src/games/overlay.ts).

La posición de la cabeza del convoy es una función a trozos del tiempo: tramos de viaje con aceleración y frenado suaves, y paradas. Las estaciones de largo se ubican buscando por bisección el instante en que la cabeza pasa por ellas. El hamaque sale de la segunda derivada de esa función, más una oscilación amortiguada después de cada frenada. La cámara sigue a la cabeza con un poco de adelanto.

En vertical el cable se empina (54 grados en vez de 23) y los nombres van al costado de cada cabina, no debajo, porque la cabina de abajo queda justo ahí.

En el motor nuevo ([`src/games/pixi/cablecar.ts`](../../src/games/pixi/cablecar.ts)) los nombres van en la pantalla y no en el mundo: pegados a las cabinas crecían con el acercamiento de la cámara, y en un celular quedaban cortados contra el borde. Cada nombre prueba los costados de su cabina (en vertical izquierda, derecha, abajo y arriba; en horizontal abajo, derecha, izquierda y arriba) y se queda en el primero donde entra entero sin tapar otra cabina con gente ni otro nombre. Mientras siga entrando no cambia de costado, y vuelve a uno mejor solo si entra con holgura. El andén de cada parada se ubica una vez, con el encuadre al que va la cámara, donde menos tapa a la estación y a las cabinas con gente; sus renglones se arman de a dos por cuadro durante el viaje anterior, porque armar los veinticuatro juntos, con doscientas personas, trababa la escena 63 ms.
