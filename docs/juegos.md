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

Donde `<juego>` es el valor de `?demo=`: `race`, `stellar`, `ledger`, `rockets`, `wheel`, `pasanaku`. El auditor abre Chrome, corre un sorteo real contra drand y comprueba dieciséis cosas:

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
| 15 | La escena se dibuja en tema claro | |
| 16 | La escena se dibuja en tema oscuro | |

Guarda capturas en `docs/capturas/juego-<juego>*.png` para revisar a ojo lo que ninguna comprobación automática ve: si se entiende, si emociona, si se lee de lejos en un proyector.

Y el auditor de sonido engancha `OscillatorNode` antes de que cargue la página, anota cada nota que arranca (cuándo, qué altura, qué timbre, qué volumen, cuánto dura) y mide lo que se puede medir sin oídos: que nada quede fuera del rango que reproduce un parlante de sala, que nada quede por debajo del murmullo, que todo esté en la escala, que no haya huecos de más de cuatro segundos, que ningún golpe se redispare y que ningún sonido quede tapado por otro al doble de volumen.

Un juego no entra a `main` hasta que las dos auditorías dicen APROBADO.

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

Y un cierre por cada golpe que pasa una vez. Una condición como `if (t >= T_LOCK && flash === 0)` vuelve a cumplirse en cuanto el destello decae, y el golpe de la traba llegó a dispararse catorce veces encima de la fanfarria. Lo mismo con el narrador: una ventana de `t >= X && t < X + 0.05` dura cuatro o cinco cuadros, y cada `say` cancela al anterior, así que el narrador tartamudea. **Cierre booleano, no ventana.**

## Lo que el auditor no puede ver

Revisalo vos antes de subirlo:

- ¿Se entiende quién va ganando sin leer texto?
- ¿Se lee desde el fondo de la sala, proyectado?
- ¿Dura lo suficiente para generar tensión y lo bastante poco para no aburrir? La ventana útil en modo normal son 24 a 34 segundos: menos y la sala no llega a girar la cabeza, más y se va.
- ¿Hay un hecho legible nuevo cada 1,5 a 2,5 segundos, y nunca más de 4 segundos sin novedad?
- ¿Los primeros 3 segundos son llamada de atención y no información? Entre el clic y "todos mirando" hay gente hablando; lo que se cuente ahí se lo pierde media sala.
- ¿Hay silencio justo antes del golpe? Un cuarto de segundo sin nada es el efecto más barato que existe.
- ¿Cada pasada, ronda o fase elimina a alguien de verdad? Hubo una que el narrador anunciaba como "¡última pasada!" y no sacaba a nadie.
- ¿El dato de la tarjeta es verdad? El auditor comprueba que haya un enlace, no que el enlace diga lo que la tarjeta dice. Eso lo comprobás vos, en la fuente primaria, antes de subirlo.
- ¿Funciona con 2 participantes y con 200?
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
