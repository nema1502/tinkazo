# Juegos de Tinkazo

Cómo se agrega un juego y qué tiene que cumplir para entrar.

## La regla que no se negocia

**El juego no decide nada.** Cuando un juego arranca, el ganador ya está elegido: lo fijó el [protocolo](protocolo.md) a partir del sello de la lista y la semilla del faro. El juego recibe el índice ganador y su único trabajo es contarlo de forma que valga la pena mirarlo.

Un juego que altere el resultado, aunque sea por un empate mal resuelto o un redondeo, rompe la única promesa del producto. Por eso el auditor comprueba, en cada corrida, que el nombre en la tarjeta de ganador sea exactamente el que el protocolo eligió.

Corolario práctico: la animación puede sembrarse con la semilla (`beacon.randomness`) para que hasta el recorrido sea reproducible, pero nunca puede usar `Math.random()` para nada que afecte quién gana.

## El contrato de un juego

Un juego es una función con esta forma, en `src/games/`:

```ts
function miJuego(
  names: string[],      // lista canónica, en orden
  winnerIdx: number,    // índice del ganador, ya decidido
  beacon: Beacon,       // ronda, semilla y firma: sirve para sembrar la animación
  done: () => void,     // se llama al terminar, pase lo que pase
): void
```

Obligaciones:

- **Llamar `done()` siempre**, incluso si el usuario salta la animación o si algo falla. Si no, el resultado nunca se revela y la pantalla queda colgada.
- **Devolver la pantalla**: si ocupás el modo pantalla completa, restaurá `display: none` y `document.body.style.overflow` al terminar.
- **Respetar `instantMode`** (`?instant=1`): saltar la animación y llamar `done()` enseguida. Las capturas y las pruebas dependen de eso.
- **Respetar el mudo**: usar `beep` y `fanfare` de `src/sound.ts`, que ya respetan el botón de sonido.
- **No tocar el estado del sorteo**: el juego lee, no escribe.

## Dos formas de agregar un juego

**Como tema de la carrera** (lo barato). El motor de `src/games/race.ts` ya resuelve carriles, cámara, parallax, narrador, cuenta regresiva y meta. Un tema nuevo es una entrada en `src/games/themes.ts`: paleta del cielo, cordillera, pista, forma del horizonte, texto de largada y una función que dibuja al corredor. Así se hizo la [Carrera Stellar](juegos/carrera-stellar.md).

**Como juego propio** (cuando el formato no es una carrera). Un módulo nuevo en `src/games/` que use el andamiaje de [`src/games/overlay.ts`](../src/games/overlay.ts): `mount()` devuelve el lienzo, el azar sembrado con la ronda de drand, los chips con avatar, el registro del botón de saltar y el desmontaje. También devuelve `null` en modo `?instant=1`, y ahí hay que cerrar el sorteo de una. Así se hicieron [Constelación Stellar](juegos/constelacion-stellar.md) y [Cierre de Libro](juegos/cierre-de-libro.md).

Vale la pena solo si la mecánica visual es distinta de verdad. La prueba: si hay que pelearse con el motor para que algo se vea, el formato no era una carrera.

## Pasos para sumarlo

1. Escribir el tema o el módulo.
2. Agregar la variante al tipo `Game` en `src/state.ts`.
3. Agregar el botón en el selector de `index.html` con id `g-<juego>` y su `data-i`.
4. Agregar los textos en español e inglés en `src/i18n.ts`.
5. Enlazar el botón en `src/main.ts` y despachar el juego en `src/ui/draw.ts`.
6. Escribir `docs/juegos/<nombre>.md` siguiendo el modelo de la Carrera Stellar.
7. Pasar la auditoría.

## La auditoría

```bash
pnpm build
pnpm preview &
node scripts/audit-game.mjs <juego>
node scripts/audit-sound.mjs <juego>
```

Donde `<juego>` es el valor de `?demo=`: `race`, `stellar`, `ledger`, `rockets`, `wheel`, `pasanaku`, `teleferico`, `tombola`. El auditor abre Chrome, corre un sorteo real contra drand y comprueba veinte cosas:

| # | Comprobación | Por qué importa |
|---|---|---|
| 1 | El sorteo termina y muestra un ganador | Un juego que se cuelga deja el evento sin resultado |
| 2 | **El ganador en pantalla es el que fijó el protocolo** | Es la razón de existir del producto |
| 3 | La firma de la ronda quedó verificada | El sorteo usó aleatoriedad real, no inventada |
| 4 | El enlace a la ronda apunta a drand | El participante puede auditar |
| 5 | El aviso al ganador queda armado | El flujo posterior no se rompió |
| 6 | El juego devolvió la pantalla al terminar | Sin esto el sitio queda inusable |
| 7 | El juego tiene su botón en el selector | Si no, nadie lo puede elegir |
| 8 | No hubo excepciones en consola | Errores silenciosos hoy son fallas en vivo mañana |
| 9 | La tarjeta de historia sale **después** del ganador | Durante el sorteo nadie lee. Y una clave sin traducir se delata sola |
| 10 | Esa tarjeta cita una fuente | Un dato sin fuente es un dato inventado a los seis meses |
| 11 | **Con dos premios el juego anuncia a los dos** | Salió un sorteo de dos en el que el juego y la voz decían "el ganador es tal". El auditor corría siempre con un premio y no lo veía |
| 12 | El sorteo también corre en inglés | La interfaz es bilingüe |
| 13 | La tarjeta de historia también está en inglés | Detecta la mitad del par olvidada |
| 14 | El nombre del juego está en los dos diccionarios | No exige que el texto cambie: "Pasanaku" es nombre propio y en inglés se dice igual |
| 15 | **En un celular el cartel del ganador entra en la pantalla** | El tamaño de la tipografía sale del alto, y en vertical eso no dice nada del ancho: a 390 por 844 el cartel salía con tipografía de 150 px sobre un lienzo de 780. Si se sale, el lienzo lo recorta sin avisar, y la forma de detectarlo es que el amarillo toque los dos bordes a la vez |
| 16 | La escena arranca en un celular | El organizador prueba el sorteo en su teléfono antes del evento |
| 17 | **En el celular nada se sale de la pantalla** | A 390 px de ancho la escena es vertical y el encabezado, el comentario y los botones tienen que entrar igual |
| 18 | El lienzo ocupa la pantalla del celular | Un lienzo más chico que la ventana deja franjas negras |
| 19 | La escena se dibuja en tema claro | |
| 20 | La escena se dibuja en tema oscuro | |

Guarda capturas en `docs/capturas/juego-<juego>*.png` para revisar a ojo lo que ninguna comprobación automática ve: si se entiende, si emociona, si se lee de lejos en un proyector.

Y el auditor de sonido engancha `OscillatorNode` antes de que cargue la página, anota cada nota que arranca (cuándo, qué altura, qué timbre, qué volumen, cuánto dura) y mide lo que se puede medir sin oídos: que nada quede fuera del rango que reproduce un parlante de sala, que nada quede por debajo del murmullo, que todo esté en la escala, que no haya huecos de más de cuatro segundos, que ningún golpe se redispare y que ningún sonido quede tapado por otro al doble de volumen.

Un juego no entra a `main` hasta que las tres auditorías dicen APROBADO.

## El auditor exigente

```bash
node scripts/audit-rigor.mjs <juego>      # o "todos"
```

Las dos auditorías de arriba comprueban que el juego no decida nada y que el sorteo cierre. Esta mide lo que antes estaba en la lista de "revisalo vos a ojo", y que por estar ahí se revisaba poco.

**Cómo lo logra.** Antes de que cargue la página cambia el reloj: cada cuadro de animación avanza exactamente un sesenta y cuatroavo de segundo, sin importar cuánto tardó de verdad, y adentro de la página se toma una huella de la pantalla cada seis cuadros (una grilla de 32 por 18 en grises). Así dos corridas se comparan cuadro contra cuadro, y lo que se mide no depende de lo cargada que esté la máquina. Corre sin red, con la escena fija de `?pose=<juego>`, y cada juego se corre once veces: dos iguales, tres saltando, dos duraciones más, en celular, en tema claro, y con dos y con doscientas personas.

Un sesenta y cuatroavo y no un sesentavo porque un sesentavo no es exacto en binario: sumado cuadro a cuadro, la resta entre dos marcas de tiempo dependía del instante en que arrancaba el juego, y en un juego con física, como el Pasanaku, eso movía un píxel de vez en cuando entre dos corridas iguales. Era un error del reloj del auditor, no del juego.

Para afinar un caso sin correr las once: `node scripts/audit-rigor.mjs <juego> --gente 2` corre una sola escena con esa cantidad de personas y deja la corrida escrita. Con `--volcar`, la auditoría completa escribe todas las corridas y no sólo la primera.

| Comprobación | Qué se mide | Por qué |
|---|---|---|
| La misma ronda dibuja los mismos cuadros | Las huellas de dos corridas, una por una. Si difieren, dice cuándo y en qué parte de la pantalla | Es la promesa de la animación reproducible. Encontró los avatares, que se decodificaban cuando el navegador quería, y los adornos que giraban con la hora de la página en vez de la del juego |
| El juego no llama a `Math.random()` | Se envuelve la función y se cuentan las llamadas mientras el estadio está a la vista | La regla de siempre, ahora comprobada |
| Nunca pasan más de 4 s sin que cambie la pantalla | Cuánto cambió la huella contra la de medio segundo atrás | Desde el fondo de la sala, una pantalla que casi no cambia es una foto. Encontró el armado de la constelación y la mesa final del Cierre de Libro |
| Un hecho nuevo cada 2,5 s, y nunca 4 s sin ninguno | Cada sonido que arranca, cada línea nueva del relator y cada salto de la pantalla después de un rato quieta | Encontró el tercer apretón del Pasanaku: cuatro segundos de zumbido parejo |
| El relator no tartamudea | Dos líneas a menos de tres décimos | Encontró el nudo del Pasanaku cambiando de frase ocho veces seguidas |
| Ningún cuadro queda vacío | Huellas de un solo gris | |
| Corre fluido | Tiempo real de cada cuadro: 30 por segundo o más, y el 95% en menos de 80 ms | Los cuadros en que el auditor lee el lienzo entero no cuentan |
| El nombre del ganador se lee desde el fondo | Alto de la tinta dentro del cartel: 4,5% del alto de la pantalla o más | A 720 son 32 píxeles, que a un cuarto de escala siguen siendo ocho |
| La tinta del cartel contrasta 4,5:1 o más | Luminancia medida de la tinta contra el fondo del cartel | Un proyector lava el negro |
| Al terminar no queda nada corriendo | Bucles de animación de más, estadio oculto, scroll devuelto, sin pantalla completa | |
| Saltar al 10%, al 50% y al 90% cierra | Que el estadio se vaya antes de seis segundos reales, sin bucles ni excepciones | El cartel se sostiene tres a propósito |
| Dura lo que se eligió | Rápido, normal y épico contra 20, 30 y 42 segundos, con 20% de margen | |
| En celular y en tema claro | Las mismas medidas donde más se rompen | |
| Con dos y con doscientas | Que cierre, se mueva, fluya y el cartel se lea, con `?n=2` y `?n=200` (veinticuatro en la ruleta, que es su tope) | Contesta la pregunta que antes era "revisalo vos". Con dos personas encontró la Constelación con el cielo casi vacío en el armado y en los saltos finales, y el único apretón del Pasanaku con un tirón cada cuatro segundos |

Para medir el cartel, `drawWinnerPlate` anota en el lienzo el rectángulo donde lo dibujó. Buscarlo por el color no alcanzaba: el aguayo del Pasanaku tiene una franja del mismo amarillo, y el auditor la medía como si fuera el cartel.

Cada corrida deja en `docs/capturas/rigor/<juego>-corrida.json` cuándo sonó algo, qué dijo el relator y cuánto cambió la pantalla en cada décimo de segundo, para mirar un hueco sin volver a correr nada.

## La duración

El selector de duración **apunta a una cantidad de segundos**, no multiplica. `PACES` en [`src/state.ts`](../src/state.ts) dice cuánto tiene que durar el show (`rápido 20 · normal 30 · épico 42`) y cada juego declara cuánto dura sin estirar con `setGameLength(nominal, fijo)`:

- `nominal` son los **segundos de juego** hasta el revelado, que sí se estiran.
- `fijo` son los **segundos reales** que no se estiran nunca porque le hablan a una persona: los tres del sostén del cartel del ganador, y los tres de la cuenta regresiva de la carrera. Lo que tarda alguien en leer un nombre proyectado no cambia porque se elija una duración más larga.

De ahí sale `paceFactor()`, acotado entre ×0,55 y ×2,2.

Era un multiplicador fijo (`0,8 / 1,4 / 2,2`) y el problema no era el número sino la idea: los seis juegos no duran lo mismo sin estirar, así que el mismo botón entregaba una carrera de 23,5 segundos y un Cierre de Libro de 9,3. No había ninguna posición del selector en la que los seis duraran algo parecido.

**El tope de ×2,2 no es negociable.** Más que eso no es más emoción, es cámara lenta: la ruleta tenía dos segundos de crucero en los que la imagen es un borrón, y multiplicarlos por tres y medio son ocho segundos de nada. Un juego que topa ahí **necesita más contenido, no ir más despacio**. Por eso la ruleta pasó de 7,65 a 17,2 segundos nominales acortando el borrón y alargando la frenada, el Cierre de Libro llegó a seis pasadas y al Pasanaku se le dio tiempo al tejido de los hilos y al apretón.

Hoy, medido por el auditor exigente: "normal" son treinta segundos en los ocho.

## El sonido

Todo el sonido sale de [`src/sound.ts`](../src/sound.ts) y no hay archivos de audio: son osciladores. Eso trae tres reglas que no son gusto sino límite del aparato y del oído, y que existen porque durante un tiempo no estuvieron escritas y los seis juegos se degradaron a la vez.

**Registro.** El parlante de un proyector, de un portátil o de una barra de sala chica se cae por debajo de unos 120 Hz y se vuelve un silbido fino por encima de unos 3 kHz. El rango útil son los **grados 0 a 20 de `note()`**, o sea 131 Hz a 2093 Hz. Lo que está fuera de ahí está escrito y no se oye: hubo golpes de clímax a 70 y a 90 Hz que nadie escuchó nunca.

**Volumen.** Una sala con cincuenta personas tiene un piso de ruido de 60 a 70 dB. Fondo 0,02 a 0,03; eventos 0,04 a 0,06; clímax 0,08 a 0,12. **Nada por debajo de 0,02**: llegó a haber sesenta y seis sonidos a 0,008 y 0,016, todos por debajo del murmullo.

**Duración.** Por debajo de unos 40 ms el oído no percibe altura, oye un clic. Un clic está bien como clic, pero no sirve para melodía.

Y cuatro obligaciones:

- **Todas las alturas con `note(grado)`.** La pentatónica no tiene semitonos, así que cualquier par de notas suena bien junto. Sumar hercios sueltos (`f0 + k * 12`) da intervalos que se achican al subir y el oído lo escucha como una máquina contando.
- **Lo que tiene que durar una fase va con `beepFor`,** que mide en segundos **del juego**. `beep` mide en segundos reales, y el selector de duración divide el `dt`: un zumbido de 0,7 s puesto a tapar un apretón de 1,4 s dejaba 2,4 s de silencio en modo épico, justo en el momento de más tensión.
- **Lo que le habla a una persona va en segundos reales:** la cuenta regresiva y el sostén del cartel del ganador. Lo que tarda alguien en leer un nombre proyectado no cambia porque el organizador elija "épica". El cartel se sostiene 3 segundos reales; menos que eso corta la reacción de la sala por la mitad.
- **Los adornos del final van después de la fanfarria,** a +520 y +700 ms. Dentro quedan enmascarados por notas que suenan al doble de volumen.

## El director de emoción

Un juego que cuenta el resultado con parámetros se ve como una simulación. La carrera de llamas era eso: cada llama con una velocidad que subía y bajaba sola, todas con el mismo paso, y el ganador remontando siempre desde atrás al 80%. Nadie tropezaba, nadie se plantaba, no había duelos ni llegadas por una nariz, y a los dos sorteos la sala ya sabía mirar a la última.

[`src/games/drama.ts`](../src/games/drama.ts) escribe la **historia** antes de que el juego arranque, sembrada con la ronda como todo lo demás, y el juego la actúa en su idioma. Nada de esto decide nada: el ganador llega dado, y la historia se escribe alrededor de él.

**El arco del ganador**, uno de cuatro, para que el final no se adivine:

| Arco | Qué pasa |
|---|---|
| Remontada | Viene de atrás y pasa a todos al final |
| Susto | Va adelante, tropieza cuando más cómodo iba, queda atrás y recupera |
| Duelo | Mano a mano con la rival desde la mitad; gana por una nariz, con foto y cámara lenta |
| Tapada | Dos se pelean adelante, una le escupe a la otra, y la que nadie miraba se cuela |

**Las historias chicas del resto**, de una a tres según cuánta gente hay: una que se planta (terca como llama), una que tropieza, una que pega un pique y se desinfla, una que le escupe a la de al lado. Se reparten con separación mínima, así que siempre pasa algo, y cada persona es un personaje: se recuerda "la de Jorge que se plantó", no "el carril cuatro".

**La tensión**, una curva de 0 a 1 que sube despacio, tiene un escalón en la mitad y se dispara en el último cuarto. La usan el sonido y el relator: la misma curva para los dos.

Cómo lo actúa la carrera: cada llama sigue un camino planificado (la línea de base más una ventaja propia, con puntos de control) y tiene **su propio reloj**, que se detiene cuando se planta, se frena un instante al tropezar y se adelanta en un pique. El reloj nunca corre para atrás, así que nadie retrocede, y el de la ganadora termina en hora: llega a la meta justo cuando se acaba la carrera. Como todo es función del tiempo, la misma ronda dibuja los mismos cuadros y saltar sigue funcionando.

Y el cuerpo cuenta lo que le pasa a cada una: el paso de las patas sale de lo que corre de verdad (quieta no las mueve), se inclina al picar, se tambalea con polvareda al tropezar, levanta la cabeza con un "!" al plantarse, y la escupida cruza al carril de al lado. En un celular, donde los carriles son finitos, cuenta la carrera una **tabla de posiciones en vivo**, como en la tele, con las filas deslizándose cuando alguien pasa a alguien.

Para mirar un arco puntual: `?pose=1&semilla=<64 hex>` cambia la semilla de la escena fija, y la carrera anota su arco en `canvas.dataset.arco`.

## El narrador

La voz va por [`src/narrator.ts`](../src/narrator.ts) y tiene una regla que no es obvia: **una línea nueva no corta a la que se está diciendo**, salvo que de verdad importe más. Cada `narrate(texto, heat)` lleva su tensión de 0 a 1, y sólo pisa a la actual si la supera por tres décimos. El anuncio del ganador pisa a cualquier cosa; un cambio de líder no pisa a otro cambio de líder.

Antes cortaba siempre, y eso dejaba frases a medio decir: en una sala no se oye como un relator que va rápido, se oye como uno que se traba. Lo que no alcanza a entrar espera turno, y si para cuando le toca ya pasaron dos segundos y medio se cae: "va puntero fulano" dicho tarde es peor que el silencio.

Y todo el armado de la declamación va dentro de un `try`, no sólo la llamada a hablar. Asignar la voz puede tirar una excepción según el navegador, y esa excepción subía hasta el bucle del juego y **lo mataba**: el sorteo entero se caía por el narrador, que es justo lo que este módulo promete que nunca pasa.

Chrome sin interfaz no trae ninguna voz instalada, así que en una auditoría el narrador nunca habla. Por eso `scripts/audit-sound.mjs` le pone una voz de mentira, simula el tiempo que tardaría en decir cada línea y cuenta las que quedan a medias. Sin que suene nada.

## Los cierres

Un cierre por cada golpe que pasa una vez. Una condición como `if (t >= T_LOCK && flash === 0)` vuelve a cumplirse en cuanto el destello decae, y el golpe de la traba llegó a dispararse catorce veces encima de la fanfarria. Lo mismo con el narrador: una ventana de `t >= X && t < X + 0.05` dura cuatro o cinco cuadros, y cada `say` cancela al anterior, así que el narrador tartamudea. **Cierre booleano, no ventana.**

## Vertical

El estadio está pensado para una pantalla grande, pero el organizador prueba el sorteo en su teléfono antes del evento. Ahí la escena es vertical y hay tres trampas que no se ven en un proyector:

- **El tamaño de la tipografía sale del alto de la pantalla** (`u()` es `canvas.height / 720`). En vertical eso no dice nada del ancho: el cartel del ganador salía con tipografía de 150 píxeles sobre un lienzo de 780. Todo lo que tenga texto se mide contra el ancho disponible, no sólo contra `u()`.
- **Las disposiciones de dos columnas no existen.** La ruleta tenía la rueda a la derecha y los nombres a la izquierda, y en vertical la placa terminaba encima de la rueda. Un juego con esa forma necesita una disposición propia para vertical, no un reescalado.
- **La barra de arriba y la caja del comentario son HTML por encima del lienzo**, así que el juego no las ve y dibuja debajo. `chrome(c)` en [`overlay.ts`](../src/games/overlay.ts) devuelve cuántos píxeles de lienzo ocupan, arriba y abajo.

Las grillas se reparten con la proporción real de la pantalla y no con una constante: `sqrt(m * ancho / alto)`. Un 1,7 escrito a mano es la proporción de un proyector y en un celular deja las celdas diminutas apretadas en una esquina.

## Lo que el auditor no puede ver

El ritmo, la legibilidad del cartel y el tartamudeo del relator ya los mide el auditor exigente. Lo que sigue no, y lo revisás vos antes de subirlo:

- ¿Se entiende quién va ganando sin leer texto?
- ¿Se lee desde el fondo de la sala, proyectado?
- ¿Dura lo suficiente para generar tensión y lo bastante poco para no aburrir? La ventana útil en modo normal son 24 a 34 segundos: menos y la sala no llega a girar la cabeza, más y se va.
- ¿Hay un hecho legible nuevo cada 1,5 a 2,5 segundos, y nunca más de 4 segundos sin novedad?
- ¿Los primeros 3 segundos son llamada de atención y no información? Entre el clic y "todos mirando" hay gente hablando; lo que se cuente ahí se lo pierde media sala.
- ¿Hay silencio justo antes del golpe? Un cuarto de segundo sin nada es el efecto más barato que existe.
- ¿Cada pasada, ronda o fase elimina a alguien de verdad? Hubo una que el narrador anunciaba como "¡última pasada!" y no sacaba a nadie.
- ¿El dato de la tarjeta es verdad? El auditor comprueba que haya un enlace, no que el enlace diga lo que la tarjeta dice. Eso lo comprobás vos, en la fuente primaria, antes de subirlo.
- ¿Se ve bien con 2 participantes y con 200? Que funcione, fluya y no quede quieto lo mide el auditor exigente; si se entiende quién es quién, lo mirás vos. El protocolo tiene su propia prueba de carga en [`src/protocol/carga.test.ts`](../src/protocol/carga.test.ts): sellar diez mil nombres y sortear treinta y dos ganadores entre ellos pasa desapercibido.
- ¿El ganador queda claro al final, sin ambigüedad?

## Juegos actuales

| Juego | `?demo=` | Tipo | Hasta | Documento |
|---|---|---|---|---|
| Carrera de llamas | `race` | Motor de carrera, tema andino | 8 en pantalla | · |
| Constelación Stellar | `stellar` | Módulo propio | 200 | [constelacion-stellar.md](juegos/constelacion-stellar.md) |
| Cierre de Libro | `ledger` | Módulo propio | 200 | [cierre-de-libro.md](juegos/cierre-de-libro.md) |
| Carrera de cohetes | `rockets` | Motor de carrera, tema espacial | 8 en pantalla | [carrera-stellar.md](juegos/carrera-stellar.md) |
| Pasanaku | `pasanaku` | Módulo propio | 200 | [pasanaku.md](juegos/pasanaku.md) |
| Ruleta | `wheel` | Módulo propio | 24 | [ruleta.md](juegos/ruleta.md) |
| Teleférico | `teleferico` | Módulo propio | 200 | [teleferico.md](juegos/teleferico.md) |
| Tómbola | `tombola` | Módulo propio | 200 | [tombola.md](juegos/tombola.md) |
