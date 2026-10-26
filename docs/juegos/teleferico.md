# Teleférico

Un convoy de cabinas sube por el cable, una cabina por grupo. En cada estación se baja un grupo entero; en la última cabina se baja de a uno hasta que quedan dos, y esos dos suben juntos. La duda dura hasta la cumbre, donde se abre la puerta.

**Identificador:** `teleferico` · **Probalo:** [tinkazo.app/?demo=teleferico](https://tinkazo.app/?demo=teleferico) · **Agregado:** 24 de septiembre de 2026 · **Por grupos:** 20 de octubre de 2026

## Por qué un teleférico

Porque en La Paz y El Alto el teleférico no es una atracción, es el colectivo. Según la empresa que lo construyó, Mi Teleférico es **"the world's biggest urban ropeway network"**: diez líneas, 1.396 cabinas de diez pasajeros y unas trescientas mil personas por día. ([fuente](https://www.doppelmayr.com/en/reference-projects/reference-project-mi-teleferico/))

Y las líneas se llaman por su color: Roja, Amarilla, Verde, Azul, Naranja, Blanca, Celeste, Morada, Café y Plateada. Las cabinas del juego llevan esos diez colores, y la tarjeta de historia lo cuenta después del ganador.

La regla de la casa es que un elemento boliviano tiene que hacer algo o no entra (está en [historia.html](../../historia.html)). Acá el teleférico es el tablero entero: el cable es la barra de progreso, cada estación es una ronda, y la altura dice cuánto falta.

## La mecánica

**Grupos.** Cada grupo va en su cabina, pintada con el color de una línea, y lleva un nombre de animal de Bolivia (Parabas, Cóndores, Vicuñas, Jucumaris, Tojos, Tatús, Surubís, Llamas, Londras, Tucanes). Los grupos salen solos de la lista sellada, sin que nadie los arme ni los elija: de a cuatro personas, hasta diez grupos, todos parejos ([`src/games/grupos.ts`](../../src/games/grupos.ts)). Con 200 personas son diez cabinas de veinte. El nombre del grupo es el mismo en todos los juegos.

**Embarque.** Los pasajeros suben a la cabina de su grupo en la base. El contador de arriba a la izquierda cuenta los que subieron.

**Las paradas.** El convoy sube hasta una estación y frena; las cabinas se hamacan para adelante. En cada estación se baja un grupo entero: "¡Estación 4! Se bajan los Tatús (4). Quedan 24". Los que se bajan salen por la ventana de su cabina, cada uno con su cara, y vuelan a su renglón del andén, donde aparece su nombre. El andén es una lista en la pantalla, al costado de la estación donde menos tapa, y se queda quieta hasta que se bajan los de la estación siguiente. En un proyector entran hasta veinticuatro renglones (tres columnas de ocho). En un celular, una columna de hasta siete renglones: seis nombres y el "+N". Si se bajan más, el último renglón dice cuántos faltan y el resto salta en cascada al piso de la estación. La cabina que quedó vacía se suelta y vuelve para abajo, y las demás cierran el hueco. Un co-ganador que se baja antes de la última estación sale "con premio", y el relator lo nombra siempre.

**La última estación.** Queda una sola cabina: la del grupo del ganador, con los que todavía no bajaron. Ahí se baja de a uno, hasta que quedan dos: "¡Acá bajan de a uno!", y cada uno sale con su cara y su nombre. Los dos que quedan son el ganador y otro del mismo grupo, sorteado, y también se sortea cuál de los dos va primero en la cabina (su cara a la izquierda, su nombre en el mejor costado). Si el arco tiene su giro ahí (la puerta o la mordaza), pasa antes de la bajada (ver la tabla de abajo).

**El último tramo.** Los dos suben juntos, en la misma cabina, con el latido cada vez más seguido y más agudo. El relator dice "¿Quién llega arriba?". Llega a la cumbre, golpe, se abren las puertas y sale el cartel. La duda se resuelve recién ahí.

**Las banderas.** Cada estación tiene la suya, en su color, en un mástil alto sobre la esquina izquierda del techo; cada cabina lleva un banderín en la esquina de atrás; y la cumbre tiene banderines de los diez colores colgados de esquina a esquina, que se sacuden de fiesta cuando llega la cabina ganadora. Flamean para la izquierda, que es para donde sopla el viento en este valle, y con la ráfaga se estiran y ondulan más. Como todo lo demás, salen de la hora de juego.

## El giro de cada arco

El director de emoción ([`src/games/drama.ts`](../../src/games/drama.ts)) elige un arco por sorteo, y en el teleférico cada uno tiene su giro. Siempre pasa algo, pero nunca lo mismo:

| Arco | Giro | Qué se ve |
|---|---|---|
| Susto | La puerta | En la última estación se abre la puerta de la cabina, todavía llena; uno de los que van adentro, sorteado entre todos, está en la puerta ("¿Se baja X?") y la cabina se sacude. La puerta se cierra: si X es de los dos que llegan arriba, "¡NO! ¡SE QUEDA!"; si no, se baja con los demás. Después bajan los del grupo, de a uno, y en la cumbre se abre la puerta para el que llega |
| Duelo | La mordaza | En la última estación la cabina de los dos que quedan se suelta: la banda se calla de golpe, la cámara queda quieta y la cabina resbala cable abajo casi una cabina entera, con un aro rojo que titila, vetas de velocidad y un chirrido que baja de tono. La mordaza la agarra con un fogonazo, chispas y un tirón que la deja hamacándose, la banda vuelve, y después bajan los del grupo, de a uno, y los dos suben juntos. Se nombra a uno cualquiera de los que van en la cabina, sorteado, así que la que se salva no delata a nadie |
| Tapada | El apagón | En el tramo que llega a la última estación, cuando más rápido va, la luz titila dos veces y se corta. Se apaga todo menos las cabinas, que quedan colgando con su luz de emergencia y las caras a la vista; la banda se calla, y el convoy frena de golpe en el aire, con un golpe seco, hamacándose con un latido. La luz vuelve titilando, la banda con ella, y el convoy recupera el paso |
| Remontada | La ráfaga | A mitad de viaje entra un viento: vetas que cruzan la pantalla, cabinas que se hamacan cada una a su tiempo y banderas estiradas. La hora se siembra, pero se corre si cae encima de una estación, para no pisar al relator |

El apagón no alarga el juego: se lleva un pedazo del viaje, igual que la última parada se toma más tiempo con la puerta o la mordaza. El convoy frena con una curva continua (la hora del tramo avanza cada vez más despacio hasta quedarse quieta y después recupera el paso), así que nunca retrocede ni salta, y saltar al final sigue siendo poner el reloj en su lugar.

## Tres decisiones que no son de estilo

**El grupo es la unidad.** En cada estación baja una cabina entera, no media convoy. Así la sala hincha por su cabina, y el que se baja sabe con quién: "a nuestra cabina la bajaron en la segunda". Los grupos son parejos y salen de la lista en orden, sin azar: nadie queda en un grupo más grande que otro, así que el grupo no le da ventaja a nadie.

**Con poca gente hay estaciones de largo.** Con dos grupos (8 personas) hay como mínimo cuatro estaciones, y el convoy pasa de largo por las que sobran. El narrador lo dice: "¡En la 2 no se baja nadie!". Nunca se anuncia una bajada que no ocurre.

**Todo es una función del tiempo de juego.** Dónde está la cabeza del convoy, cuánto se hamaca cada cabina, por dónde va cada pasajero que salta al andén: nada se acumula cuadro a cuadro. Saltar es poner el reloj al final, y la misma ronda dibuja los mismos cuadros en cualquier máquina. El auditor exigente lo comprueba huella por huella.

## Cómo escala

| Participantes | Grupos (cabinas) | Paradas | Qué se ve |
|---|---|---|---|
| 8 | 2 | 2 de 4 estaciones | Dos cabinas de cuatro; la última se baja de a uno hasta quedar dos |
| 16 | 4 | 4 | Cuatro cabinas de cuatro |
| 40 | 10 | 10 | Diez cabinas de cuatro, una por estación |
| 200 | 10 | 10 | Diez cabinas de veinte. En cada estación baja una de veinte; en la última, dieciocho bajan de a uno |

Los tiempos no cambian con la cantidad: las paradas se reparten entre el fin del embarque y el último tramo. La parada de la última estación se alarga con la cantidad que baja de a uno.

## La coronación

Con el foco (docs/motores.md, "El foco del ganador"), apenas corona la escena se oscurece, un cono de luz baja sobre la cabina que llegó a la cumbre y la música ya viene cortada: no suena nada hasta el golpe. El golpe llega según el arco del director (0,5 s en la remontada, 0,55 en el duelo, 0,85 en la tapada y 0,95 en el susto): sale una onda blanca y otra del color de quien gana, giran los rayos, suena la fanfarria, el relator dice el nombre y, una décima después, sube el cartel. La luz queda encendida mientras se sostiene el cartel, que sigue siendo de tres segundos reales. Con el golpe amanece sobre la cumbre (un resplandor del horizonte), se sacuden los banderines y la cámara da un golpe corto. Saltar el show va directo al golpe.

## Los tiempos

En segundos de juego, sin estirar. En "normal" se estiran para que el show entero dure treinta segundos (ver "La duración" en [juegos.md](../juegos.md)).

| Tramo | Qué pasa |
|---|---|
| 0,0 – 2,0 s | Embarque. "¡Suban, suban, que se va!" |
| 2,0 s | Campana de salida |
| 2,0 – 14,0 s | Viajes y paradas. Viajar pesa 1, parar 0,8, y la última parada 1,7 más 0,1 por cada uno que baja de a uno (2,4 con la puerta, 2,6 con la mordaza). El apagón pesa 1,3 |
| 14,0 – 15,8 s | El último tramo, con los dos juntos |
| 15,8 s | Llega a la cumbre: destello, temblor y golpe |
| 16,4 s | Corona: se abren las puertas y arranca el foco (silencio y penumbra). El golpe llega a los 0,5 a 0,95 s reales según el arco, y el cartel una décima después; se sostiene tres segundos reales |

## El sonido

Todo por la escala de `note()` y dentro de los grados 0 a 20.

- **Embarque:** un clic por pasajero, con tope de once por segundo.
- **El cable:** un zumbido que sube y baja de tono con la velocidad del convoy, igual que el motor de la ruleta.
- **Estaciones:** ding-dong al llegar; una sola campanada al pasar de largo.
- **Los que se bajan:** hasta seis notas que bajan, una por pasajero.
- **Cabina que se suelta:** un golpe seco.
- **La última estación:** un latido grave cada medio segundo de juego, con su octava, que en un parlante de proyector un seno solo de 131 Hz se pierde.
- **El que se baja en la última:** un golpe seco cuando toca el andén.
- **El último tramo:** el latido se acelera de 0,42 a 0,18 s de juego y sube de a un grado. Iba parejo.
- **La cumbre:** el golpe de la traba, como en la ruleta, y después la fanfarria.
- **La mordaza:** la banda se calla cuando se suelta; cinco notas que bajan y un chirrido que baja de tono mientras resbala; cuando agarra, un golpe metálico con su chasquido, y la banda vuelve en el uno.
- **El apagón:** un chasquido en cada parpadeo de antes; cuando se va la luz se calla la banda y caen cuatro notas; un golpe seco cuando el convoy queda quieto, y después el latido a oscuras; un clic por cada vez que prende, y la banda vuelve cuando la luz se queda.
- **La ráfaga:** un soplido grave que dura lo que dura el viento.

## Lo que dejó el evaluador visual (21 de octubre de 2026)

- **El contador y la caja cuentan lo mismo.** El contador de arriba baja en el mismo instante en que el relator dice "Quedan N" y los que se bajan dejan su cabina (`tOff` de cada parada). Bajaba 0,35 s de juego después, y en ese rato se leía "QUEDAN 11" arriba con "Quedan 7" en la caja. `cablecar-plan.test.ts` lo fija, y que el contador sea siempre la gente que sigue en las cabinas.
- **La última estación dice la verdad.** Al llegar, el relator cuenta a los que siguen arriba, como el contador: "¡QUEDAN DOS!" solo si son dos; si son más, "¡Última estación!", "¡Acá bajan de a uno!" o "¡Última estación! Quedan 4". Al bajarse, nombra a todos los que descuenta el contador ("¡Se bajan Ana, Iván y Luis!", y con más de tres, "y 15 más"): antes decía "¡Se baja Ana!" mientras el contador bajaba de cuatro a dos. Con dos personas en total no se baja nadie y no dice nada.
- **El letrero CUMBRE no queda debajo del cartel.** Desde que la cabina llega arriba, la cámara baja la estación lo justo para que el letrero quede debajo de donde va a salir el cartel del ganador, y la cabina encima de la caja del relator; si no entra, se acerca menos. En el proyector el cartel lo tapaba entero.
- **Los contadores se leen en el celular.** "QUEDAN", el número y "ESTACIÓN N DE M" van en la unidad de la pantalla y no en la del mundo, que en un celular parado es el ancho sobre 720: quedaban en 8, 28 y 9 px, y ahora en 13, 48 y 15 a 390x844. En una pantalla acostada no cambia nada. Los nombres de las cabinas, los de pasar lista y el andén esquivan esa esquina.

## Cómo está hecho

El motor nuevo ([`src/games/pixi/cablecar.ts`](../../src/games/pixi/cablecar.ts)) dibuja el plan de [`src/games/pixi/cablecar-plan.ts`](../../src/games/pixi/cablecar-plan.ts): quién baja en cada parada, en qué cabina va cada grupo, los cuatro giros y los horarios. Los grupos vienen de [`src/games/grupos.ts`](../../src/games/grupos.ts). Las pruebas del plan (cada parada baja un grupo entero, quedan dos, la cabina del ganador no se suelta) están en `cablecar-plan.test.ts`.

El motor anterior ([`src/games/cablecar.ts`](../../src/games/cablecar.ts), con `?motor=clasico` o sin WebGL) conserva el plan de antes: hasta cinco cabinas y la mitad que se baja en cada parada, con el aro de la última estación. No se tocó, así que cuenta otra versión de la misma historia.

El convoy es una función a trozos del tiempo: tramos de viaje con aceleración y frenado suaves, y paradas. Las estaciones de largo se ubican buscando por bisección el instante en que la cabeza pasa por ellas. El hamaque sale de la segunda derivada de esa función, más una oscilación amortiguada después de cada frenada. La cámara sigue a la cabeza con un poco de adelanto.

En vertical el cable se empina (54 grados en vez de 23) y los nombres van al costado de cada cabina, no debajo, porque la cabina de abajo queda justo ahí.

En el motor nuevo los nombres van en la pantalla y no en el mundo: pegados a las cabinas crecían con el acercamiento de la cámara, y en un celular quedaban cortados contra el borde. Cada cabina lleva el nombre de su grupo, o los nombres de los dos que llegan juntos, y prueba los costados de su cabina (en vertical izquierda, derecha, abajo y arriba; en horizontal abajo, derecha, izquierda y arriba) y se queda en el primero donde entra entero sin tapar otra cabina con gente, otro nombre ni el número de una estación. Si ninguno entra, un rótulo de grupo se oculta (la cabina ya lleva su color y su cuenta), y un nombre de persona se queda en el que menos tapa. El andén de cada parada se ubica una vez, con el encuadre al que va la cámara, donde menos tapa a la estación y a las cabinas con gente; sus renglones se arman de a dos por cuadro durante el viaje anterior, porque armar los veinticuatro juntos, con doscientas personas, trababa la escena 63 ms.
