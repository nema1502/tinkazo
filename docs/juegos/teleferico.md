# Teleférico

Un convoy de cabinas sube por el cable, una cabina por grupo. En cada estación se baja un grupo entero. En la penúltima parada, de la cabina de quien gana se bajan todos menos dos, y en la última estación se baja uno de esos dos. A la cumbre llega una sola cabina, con quien gana adentro y nadie más.

**Identificador:** `teleferico` · **Probalo:** [tinkazo.app/?demo=teleferico](https://tinkazo.app/?demo=teleferico) · **Agregado:** 24 de septiembre de 2026 · **Por grupos:** 20 de octubre de 2026

## Por qué un teleférico

Porque en La Paz y El Alto el teleférico no es una atracción, es el colectivo. Según la empresa que lo construyó, Mi Teleférico es **"the world's biggest urban ropeway network"**: diez líneas, 1.396 cabinas de diez pasajeros y unas trescientas mil personas por día. ([fuente](https://www.doppelmayr.com/en/reference-projects/reference-project-mi-teleferico/))

Y las líneas se llaman por su color: Roja, Amarilla, Verde, Azul, Naranja, Blanca, Celeste, Morada, Café y Plateada. Las cabinas del juego llevan esos diez colores, y la tarjeta de historia lo cuenta después del ganador.

La regla de la casa es que un elemento boliviano tiene que hacer algo o no entra (está en [historia.html](../../historia.html)). Acá el teleférico es el tablero entero: el cable es la barra de progreso, cada estación es una ronda, y la altura dice cuánto falta.

## La mecánica

**Grupos.** Cada grupo va en su cabina, pintada con el color de una línea, y lleva un nombre de animal de Bolivia (Parabas, Cóndores, Vicuñas, Jucumaris, Tojos, Tatús, Surubís, Llamas, Londras, Tucanes). Los grupos salen solos de la lista sellada, sin que nadie los arme ni los elija: de a cuatro personas, hasta diez grupos, todos parejos ([`src/games/grupos.ts`](../../src/games/grupos.ts)). Con 200 personas son diez cabinas de veinte. El nombre del grupo es el mismo en todos los juegos.

**Embarque.** Los pasajeros suben a la cabina de su grupo en la base. El contador de arriba a la izquierda cuenta los que subieron, con una marca por persona debajo.

**Las paradas.** El convoy sube hasta una estación y frena; las cabinas se hamacan para adelante. En cada estación se baja un grupo entero: "¡Estación 4! Se bajan los Tatús (4). Quedan 24". Los que se bajan salen por la ventana de su cabina, cada uno con su cara, y vuelan a su renglón del andén, donde aparece su nombre. El andén es una lista en la pantalla, al costado de la estación donde menos tapa, y se queda quieta hasta que se bajan los de la estación siguiente. En un proyector entran hasta veinticuatro renglones (tres columnas de ocho). En un celular, una columna de hasta siete renglones: seis nombres y el "+N". Si se bajan más, el último renglón dice cuántos faltan y el resto salta en cascada al piso de la estación. La cabina que quedó vacía se suelta y vuelve para abajo, y las demás cierran el hueco. Nadie que gana se baja: con varios premios, las cabinas con premio siguen hasta el final (ver "A la cumbre llegan quienes ganan", abajo).

**La bajada grande.** Cuando ya no quedan grupos sin premio, en la penúltima parada se bajan de la cabina de quien gana todos los que no ganan menos uno: "¡Se bajan Ana, Iván y 2 más!", cada uno con su cara y su nombre en el andén. Quedan dos, y la cabina lleva el nombre de cada uno. El que acompaña a quien gana sale de la semilla, a ciegas, entre todos los de su grupo, y también es a ciegas el orden de los dos en la cabina (su cara a la izquierda, su nombre en el mejor costado). Rumbo a la última estación el relator pregunta "¿Quién llega arriba?".

**La última estación.** "¡QUEDAN DOS!". Si el arco tiene su giro ahí (la puerta o la mordaza), pasa primero (ver la tabla de abajo). Después se baja uno: se lo ve salir por la ventana y volar con su cara al andén, el relator lo nombra ("¡Se baja Beto!") y el contador pasa a 1. Esa bajada es la que decide.

**El último tramo.** La cabina sube sola, con quien gana adentro: su cara grande en la ventana y su nombre al costado. El relator dice "¡Sube solita!" o "¡Ya se ve la cumbre!", y el latido se acelera. Llega a la cumbre, golpe, se abren las puertas y sale el cartel.

**Las banderas.** Cada estación tiene la suya, en su color, en un mástil alto sobre la esquina izquierda del techo; cada cabina lleva un banderín en la esquina de atrás; y la cumbre tiene banderines de los diez colores colgados de esquina a esquina, que se sacuden de fiesta cuando llega la cabina ganadora. Flamean para la izquierda, que es para donde sopla el viento en este valle, y con la ráfaga se estiran y ondulan más. Como todo lo demás, salen de la hora de juego.

## A la cumbre llegan quienes ganan (13 de noviembre de 2026)

Hasta el 13 de noviembre de 2026 a la cumbre llegaban dos personas en una cabina con "x2", y la duda se resolvía recién con el foco: en la sala no se entendía quién había ganado ni por qué. Con varios premios era peor: los premios de otros grupos se bajaban antes con su grupo, y arriba seguían llegando dos. La causa estaba en el plan (`cablecar-plan.ts`), que dejaba siempre a dos en la cabina final.

La regla de ahora, con M premios:

1. Cada grupo sin premio se baja entero, en su estación.
2. En cada cabina con premio, en la penúltima parada (la bajada grande) se bajan todos los que no ganan menos uno, sorteado a ciegas con la semilla: el que la acompaña.
3. En la última estación se baja ese uno de cada cabina con premio. Es la bajada que decide: se ve, y el relator la nombra.
4. Si los premios iban en varias cabinas, después de esa bajada vuelan con su cara a la cabina anfitriona, y las otras se sueltan y vuelven cable abajo. La anfitriona se sortea con la semilla entre las cabinas con premio: no es la del primer premio, para que el show no deje adivinar el orden antes de que lo diga el relator.
5. A la cumbre sube una sola cabina, con los M que ganan. El contador dice QUEDAN M.

Lo que la sala ve: con un premio, a la última estación llegan dos, uno se baja, y sube uno. Con cinco premios repartidos en cinco cabinas, a la última llegan diez (cada premio con su acompañante), se bajan cinco, cuatro premios se pasan a la cabina anfitriona, y sube una cabina con cinco.

Los casos borde:

| Caso | Qué pasa |
|---|---|
| 2 personas, 1 premio | Un solo grupo. No hay bajada grande: en la última estación se baja el otro y sube quien gana |
| Premios = personas menos una | El único que no gana es el acompañante de su cabina y se baja en la última. Las demás cabinas solo tienen premios y se juntan con la anfitriona |
| Premios = personas | Nadie se baja. Las cabinas se juntan en la última estación y sube una con todos |
| Una cabina con premio sin nadie más | No lleva acompañante: llega a la última con sus premios y se junta con la anfitriona, o es la anfitriona |
| Premios impares, o más premios que lugares de una cabina | La cabina final lleva a todos los premios. Muestra tres caras y la cuenta (x5, x10). El cartel del final los nombra |
| 200 personas, 1 premio | Diez cabinas de veinte. Nueve se bajan enteras, en la bajada grande se bajan dieciocho (el andén muestra los que entran y el resto con +N) y en la última se baja uno |

**Justicia.** Todo lo que le pasa a quien gana antes de la bajada que decide le puede pasar igual a cualquiera de su grupo: el acompañante sale a ciegas entre todos los que no ganan, el orden de las caras y de los nombres en la cabina es a ciegas, y a quién nombra la puerta, la mordaza o el apagón se sortea entre los que van en la cabina anfitriona en la última estación. Con premios en varias cabinas, la anfitriona se sortea entre las cabinas con premio y la onda del foco va en el dorado de siempre, no en el color de una cara: nada del final dice cuál es el primer premio antes del cartel (hasta el 13 de noviembre de 2026 la junta volaba siempre a la cabina del primero). Nada sale de `Math.random`, del reloj ni del tamaño de la pantalla. El auditor de delatores mide hasta la bajada que decide (`corte` del teleférico en `scripts/lib/delatores-senales.mjs`: la última línea "¡Se baja X!"), que ahora es el momento que resuelve la duda.

## El giro de cada arco

El director de emoción ([`src/games/drama.ts`](../../src/games/drama.ts)) elige un arco por sorteo, y en el teleférico cada uno tiene su giro. Siempre pasa algo, pero nunca lo mismo:

| Arco | Giro | Qué se ve |
|---|---|---|
| Susto | La puerta | En la última estación se abre la puerta de la cabina de los dos que quedan. Uno de los dos, sorteado, está en la puerta ("¿Se baja X?") y la cabina se sacude. La puerta se cierra: si X es quien gana, "¡NO! ¡SE QUEDA!" y se baja el otro, y si no, X se baja enseguida. En la cumbre se abre la puerta para quien llega |
| Duelo | La mordaza | En la última estación la cabina de los dos que quedan se suelta: la banda se calla de golpe, la cámara queda quieta y la cabina resbala cable abajo casi una cabina entera, con un aro rojo que titila, vetas de velocidad y un chirrido que baja de tono. La mordaza la agarra con un fogonazo, chispas y un tirón que la deja hamacándose, la banda vuelve, y después se baja el que no gana y la cabina sube con quien gana. Se nombra a uno de los dos, sorteado, así que la que se salva no delata a nadie |
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
| 8 | 2 | 3 de 4 estaciones | Dos cabinas de cuatro: una se baja entera, en la de quien gana se bajan dos y en la última uno |
| 16 | 4 | 5 | Cuatro cabinas de cuatro |
| 40 | 10 | 11 | Diez cabinas de cuatro: nueve se bajan enteras, después la bajada grande y la última |
| 200 | 10 | 11 | Diez cabinas de veinte. En cada estación baja una de veinte, en la bajada grande dieciocho y en la última uno |

Los tiempos no cambian con la cantidad: las paradas se reparten entre el fin del embarque y el último tramo. La parada de la última estación se alarga un poco con cada cabina con premio, y más si sus premios se juntan. Con muchas cabinas, la última parada, el viaje que llega a ella y el apagón tienen un piso en segundos (ver "Los pisos del final").

## La coronación

Con el foco (docs/motores.md, "El foco del ganador"), apenas corona la escena se oscurece, un cono de luz baja sobre la cabina que llegó a la cumbre y la música ya viene cortada: no suena nada hasta el golpe. El golpe llega según el arco del director (0,5 s en la remontada, 0,55 en el duelo, 0,85 en la tapada y 0,95 en el susto): sale una onda blanca y otra del color de quien gana, giran los rayos, suena la fanfarria, el relator dice el nombre y, una décima después, sube el cartel. La luz queda encendida mientras se sostiene el cartel, que sigue siendo de tres segundos reales. Con el golpe amanece sobre la cumbre (un resplandor del horizonte), se sacuden los banderines y la cámara da un golpe corto. Saltar el show va directo al golpe.

## Los tiempos

En segundos de juego, sin estirar. En "normal" se estiran para que el show entero dure treinta segundos (ver "La duración" en [juegos.md](../juegos.md)).

| Tramo | Qué pasa |
|---|---|
| 0,0 – 2,0 s | Embarque. "¡Suban, suban, que se va!" |
| 2,0 s | Campana de salida |
| 2,0 – 14,0 s | Viajes y paradas. Viajar pesa 1, parar 0,8 (también la bajada grande), y la última parada 1,7 más 0,1 por cada uno que se baja ahí (2,4 con la puerta, 2,6 con la mordaza), más 0,6 si los premios se juntan. El apagón pesa 1,3. Tres tramos tienen además un piso en segundos de juego (ver "Los pisos del final", abajo) |
| 14,0 – 15,8 s | El último tramo, con quien gana |
| 15,8 s | Llega a la cumbre: destello, temblor y golpe |
| 16,4 s | Corona: se abren las puertas y arranca el foco (silencio y penumbra). El golpe llega a los 0,5 a 0,95 s reales según el arco, y el cartel una décima después; se sostiene tres segundos reales |

### Los pisos del final (13 de noviembre de 2026)

Con 37 personas o más hay diez cabinas y once paradas en los mismos doce segundos, y por pesos la parada que decide quedaba en 1 s de juego. Con la puerta, el relator decía cuatro líneas en 0,9 s ("¡Última estación!", "¿Se baja X?", "¡Falsa alarma!" y "¡Se baja Y!"), el "¡se queda!" se veía 0,2 s y la pregunta "¿Quién llega arriba?" tenía una ventana de una décima, o ninguna con el apagón. Justo en el rango que mejor le sienta al juego, el momento que explica quién ganó pasaba de largo.

Ahora tres tramos no bajan de un piso, y lo que les falta sale de los otros viajes:

| Tramo | Piso |
|---|---|
| La última parada | 2,2 s, o 2,7 con la puerta o la mordaza, más 0,6 si los premios se juntan |
| El viaje que llega a la última estación | 1,3 s |
| El apagón entero | 1,2 s |

Con la puerta, la bajada que decide llega al 68 % de la parada y no al 64 %, para que el "¡se queda!" se alcance a leer. La pregunta tiene su hora en el plan (`tPregunta`): 0,6 s después de la bajada grande, o de que vuelve la luz, y al menos 0,45 s antes de la llegada, y la ráfaga no cae a menos de 0,7 s de ella. Con 200 personas y un premio cada parada de un grupo entero queda entre 0,32 y 0,38 s y cada viaje entre 0,41 y 0,47 s (antes, 0,43 a 0,46 y 0,54 a 0,58): los grupos se bajan más seguido, y el final se toma su tiempo. Con ocho personas o menos los pesos ya dan más que los pisos, y solo cambia la puerta.

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

## Lo que dejó la revisión visual (21 de octubre de 2026)

- **El contador y la caja cuentan lo mismo.** El contador de arriba baja en el mismo instante en que el relator dice "Quedan N" y los que se bajan dejan su cabina (`tOff` de cada parada). Bajaba 0,35 s de juego después, y en ese rato se leía "QUEDAN 11" arriba con "Quedan 7" en la caja. `cablecar-plan.test.ts` lo fija, y que el contador sea siempre la gente que sigue en las cabinas.
- **La última estación dice la verdad.** Al llegar, el relator cuenta a los que siguen arriba, como el contador: "¡QUEDAN DOS!" solo si son dos; si son más, "¡Última estación!", "¡Acá bajan de a uno!" o "¡Última estación! Quedan 4". Al bajarse, nombra a todos los que descuenta el contador ("¡Se bajan Ana, Iván y Luis!", y con más de tres, "y 15 más"): antes decía "¡Se baja Ana!" mientras el contador bajaba de cuatro a dos. Con dos personas en total no se baja nadie y no dice nada.
- **El letrero CUMBRE no queda debajo del cartel.** Desde que la cabina llega arriba, la cámara baja la estación lo justo para que el letrero quede debajo de donde va a salir el cartel del ganador, y la cabina encima de la caja del relator; si no entra, se acerca menos. En el proyector el cartel lo tapaba entero.
- **Los contadores se leen en el celular.** "QUEDAN", el número y "ESTACIÓN N DE M" van en la unidad de la pantalla y no en la del mundo, que en un celular parado es el ancho sobre 720: quedaban en 8, 28 y 9 px, y ahora en 13, 48 y 15 a 390x844. En una pantalla acostada no cambia nada. Los nombres de las cabinas, los de pasar lista y el andén esquivan esa esquina.

## Cómo está hecho

El motor nuevo ([`src/games/pixi/cablecar.ts`](../../src/games/pixi/cablecar.ts)) dibuja el plan de [`src/games/pixi/cablecar-plan.ts`](../../src/games/pixi/cablecar-plan.ts): quién baja en cada parada, en qué cabina va cada grupo, los cuatro giros y los horarios. Los grupos vienen de [`src/games/grupos.ts`](../../src/games/grupos.ts). Las pruebas del plan (los grupos sin premio bajan enteros, a la cumbre llegan exactamente quienes ganan con 1 a 10 premios y de 2 a 200 personas, el acompañante sale parejo entre los del grupo, el contador es siempre la gente que sigue arriba, la cabina del ganador no se suelta y las demás sí) están en `cablecar-plan.test.ts`.

El motor anterior ([`src/games/cablecar.ts`](../../src/games/cablecar.ts), con `?motor=clasico` o sin WebGL) conserva el plan de antes: hasta cinco cabinas y la mitad que se baja en cada parada, con el aro de la última estación. No se tocó, así que cuenta otra versión de la misma historia.

El convoy es una función a trozos del tiempo: tramos de viaje con aceleración y frenado suaves, y paradas. Las estaciones de largo se ubican buscando por bisección el instante en que la cabeza pasa por ellas. El hamaque sale de la segunda derivada de esa función, más una oscilación amortiguada después de cada frenada. La cámara sigue a la cabeza con un poco de adelanto.

En vertical el cable se empina (54 grados en vez de 23) y los nombres van al costado de cada cabina, no debajo, porque la cabina de abajo queda justo ahí.

En el motor nuevo los nombres van en la pantalla y no en el mundo: pegados a las cabinas crecían con el acercamiento de la cámara, y en un celular quedaban cortados contra el borde. Cada cabina lleva el nombre de su grupo, o, desde la bajada grande, el nombre de cada uno de los dos que siguen en ella, y prueba los costados de su cabina (en vertical izquierda, derecha, abajo y arriba; en horizontal abajo, derecha, izquierda y arriba) y se queda en el primero donde entra entero sin tapar otra cabina con gente, otro nombre ni el número de una estación. Si ninguno entra, un rótulo de grupo se oculta (la cabina ya lleva su color y su cuenta), y un nombre de persona se queda en el que menos tapa. El andén de cada parada se ubica una vez, con el encuadre al que va la cámara, donde menos tapa a la estación y a las cabinas con gente; sus renglones se arman de a dos por cuadro durante el viaje anterior, porque armar los veinticuatro juntos, con doscientas personas, trababa la escena 63 ms.
