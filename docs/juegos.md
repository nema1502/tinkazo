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

## Cómo nace un juego (el kit)

Desde el 26 de octubre de 2026 un juego nuevo se escribe sobre el **kit** (`src/games/pixi/kit/`). Un juego es un **plan puro** (de la lista y la ronda, qué pasa y cuándo), una **escena** y un **cuadro**; el kit pone lo que antes cada juego repetía a mano: el montaje y el cierre (`done()` siempre llega), la cámara con sus cinco arcos, los nombres legibles, el foco de quien gana, los subtítulos con cola, el sonido afinado, el español y el inglés, y los ganchos de los auditores. Un juego pasa de unas 1.300 líneas y veinte archivos tocados a mano a un puñado de archivos propios y ninguno ajeno.

```ts
export const miJuegoPixi = crearJuego<Datos, Escena>({
  id: "mijuego",                        // el valor de ?demo= y la clave de los auditores
  textos: TEXTOS,                       // lo que dice el relator, en es y en (opcional)
  plan: (ctx) => ({ duracion, arco, momentos, guion, datos }),  // puro: se prueba en Node
  arma: (k, plan, previa) => escena,    // dibuja; se repite al cambiar el tamaño
  cuadro: (k, plan, escena, t) => {},   // una función de t: saltar da lo mismo que mirar
});
```

La lista y la ronda llegan con cada sorteo, y los momentos dependen de las dos: por eso salen del **plan**, no de la definición. El plan recibe la ronda (`ctx.ronda`), el azar sembrado (`ctx.rng`), los textos (`ctx.txt`) y la historia del director de emoción (`ctx.historia`, que gasta `rng` cuando se la pide). **El kit nunca llama a `rng`**: si el plan lo gasta en otro orden, la misma ronda cuenta otra historia.

### Los cinco pasos

1. **Diseño.** Una página, `docs/juegos/<id>.md` (el generador la deja con la plantilla): el momento que hace gritar a la sala, el rango real de personas, el giro de cada arco, cómo cada uno lee su nombre antes del ganador, nada con cara de casino y lo cultural validado con quien mantiene el proyecto. Pasa con su sí.
2. **Kit.** `node scripts/nuevo-juego.mjs <id> [--nombre "El Guajojó"]` crea el juego, y primero se escribe el plan con sus pruebas, después la escena, las tomas y el guion en es y en. Pasa con `pnpm typecheck` y `pnpm test`.
3. **Batería.** `audit-game` 20/20, `rigor`, `identidad` (con 8, todos; con 18, nueve de cada diez), `emocion`, `sound`, `mezcla`, `pantalla`, `delatores` y la de física si hay choques. Pasa con todo APROBADO y los JSON guardados.
4. **Evaluador.** Capturas en escritorio y celular, en los dos temas; cada hallazgo se verifica antes de arreglarlo. Pasa sin nada grave.
5. **Selector.** `node scripts/nuevo-juego.mjs --encender <id>`: pide la captura (`capturas-juegos.mjs <id> --en 6.5`), la historia sin borrador y con fuente primaria verificada, el rango y la batería guardada en JSON; después se suman la ficha de `juegos.html` y la fila de la tabla de abajo. Con `pnpm check:paginas`, `pnpm check:lore` y el ok de quien mantiene el proyecto.

### El generador

```bash
node scripts/nuevo-juego.mjs prueba            # crea el juego "prueba" (apagado en el selector)
node scripts/nuevo-juego.mjs prueba --dry-run  # lo que haría, sin escribir nada
node scripts/nuevo-juego.mjs --encender prueba # recién con todo lo del paso 5
```

El id son de tres a doce letras minúsculas. Crea `src/games/pixi/<id>.ts` (la escena), `<id>-plan.ts` y `<id>-plan.test.ts` (el plan puro y sus pruebas: misma ronda, mismo plan; los ganadores intactos; momentos en orden; guion sin huecos de cuatro segundos; textos en los dos idiomas), `<id>-textos.ts` y `docs/juegos/<id>.md`, y escribe entre marcas (`kit:catalogo`, `kit:i18n-es`, `kit:i18n-en`) la entrada de `kit/catalogo.ts` y las claves del sitio. Dos corridas con el mismo id no duplican nada: la segunda se rechaza.

El juego nace **apagado**: `?demo=<id>` y `?pose=<id>` lo abren, su botón existe en el selector pero oculto, y pasa `audit-game` 20/20 sin tocar nada a mano (la corrida de prueba, con `prueba`, dio 20/20 el 26 de octubre de 2026). Su historia nace en borrador y no sale en ningún sorteo hasta que se escriba con su fuente.

### Qué trae el kit

| Módulo | Qué pone |
|---|---|
| `director.ts` | Los cinco arcos: **presentación** (plano entero que respira un 1 %, nunca cuatro segundos quieto), **tensión** (`tension`, un 12 % hacia lo que decide, nunca sobre quien gana solo), **silencio** (la música se corta 0,4 s antes y, coronado, el foco y sus latidos), **golpe** (`golpe`, un 20 % sostenido 0,5 s, con sacudón y fanfarria, a la hora del foco) y **foco** (la luz sobre quien gana, y la cámara lo protege debajo del cartel). `SABOR[arco]` da el ritmo de cada arco de la historia (remontada, susto, duelo, tapada). Anota `data-momento` y `data-golpe` para los auditores. |
| `guion.ts` | Subtítulos con cola: nunca dos a menos de 0,3 s; ninguno pisa a otro más importante antes de 1,2 s; lo que espera más de 1,5 s se tira; quien gana pisa todo; al saltar, lo pendiente se tira. Una línea también puede ser una acción (un sonido, un sacudón). |
| `nombres.ts` | La regla de letra: el nombre mide **al menos el 2,6 % del alto** en un proyector (28,5 px en 1080p) y **16 px** en un celular; el apoyo, 14; el cartel, el 4,5 %. Con más gente se acorta el texto, nunca la letra (`nombreLegible`: de nombre entero a pila a inicial, dos líneas, nunca "…"), y `compensarZoom` evita que la cámara los baje del mínimo. |
| `figuras.ts` | La cara de siempre o un emblema por persona, sin azar y sin repetir hasta 32 (hasta 256 con el color). Si la hoja no carga, la cara. |
| `sonido.ts` | La paleta sobre los osciladores de siempre: grados de 0 a 20, volumen por categoría (fondo 0,02–0,03, evento 0,04–0,06, clímax 0,08–0,12), `una(clave)` contra redisparos, `tic`, `latido`, `escalera` y `fanfarria`. Son las reglas de `audit-sound`, en la firma. |
| `crear.ts` | `crearJuego`: monta (con `?instant=1`, cierra sin dibujar), pide el plan, declara la duración con lo que se sostiene el foco, lleva el guion y la cámara, corona con foco, **saltar va directo al golpe** y vuelve a armar la escena si cambia el tamaño. |
| `catalogo.ts` | Lo que el sitio sabe de cada juego: id, rango, si está en el selector, captura, historia, leyenda. El botón, la tarjeta de "cómo se juega", las recomendaciones y la historia se arman desde acá, con las claves de texto por convención: `game<Id>`, `jg<Id>N`, `gc<Id>` y `gc<Id>Many`. |

Los parámetros de la URL funcionan solos: `?instant` lo resuelve el estadio, y `?pose`, `?n`, `?nw`, `?semilla` y `?ganador` llegan por `playPixi`. Con el kit entran gratis a `audit-emocion` (`data-golpe`, `data-zoomPico`), a `audit-identidad` (los nombres son `Text`) y a `audit-rigor` (el cartel anotado).

### La regla del niño, en el kit

Desde el 26 de octubre de 2026 los juegos se piensan, como la tele, para un niño de 5 a 9 años: el de 9 lee nombres pero no el relator, el de 5 no lee nada. La regla: **cualquier cuadro del juego, sin leer, dice quién va adelante, hacia dónde van, cuánto falta y qué acaba de pasar.** El kit la garantiza con piezas que el plan declara y las pruebas de cada juego verifican:

| Qué pide la regla | Dónde vive en el kit |
|---|---|
| **Un solo contador**, en la misma esquina en todos los juegos, que solo baja y llega a 1 con el golpe; ningún otro número en el relator ni en un cartel | `marcador.ts`: el plan declara `marcador(t)` y `crearJuego` lo dibuja arriba a la izquierda ("QUEDAN 18"), así ningún juego puede tener otro. `problemasDeMarcador` |
| **El nombre pegado al cuerpo** y, cuando alguien sale, su nombre legible donde pasó; nunca una fila aparte de emblemas | `nombres.ts`: `pegarAlCuerpo`, `estaPegado` (a lo sumo un cuarto del alto del cuerpo), `nombreDeSalida` y `enFilaAparte` |
| **La persona es una figura con cara y nombre**, no un emblema de 30 px | `figuras.ts`: cada `Figura` lleva su `nombre`; `tamanoMinimoFigura` (56 px de diseño, nunca menos de 40) y `cuantasCaben` (con más gente, por tandas); `Kit.escalaDeFigura()` da la escala del chip del estadio |
| **Un solo sentido** de avance, **la meta en todo cuadro** y el cartel nunca encima del ganador | `director.ts`: `plan.sentido`; `momentos.meta` y `guardarMeta` no dejan que ninguna toma la suelte; con el golpe la cámara protege a quien gana debajo del cartel (`tapaAlGanador`, `cajaDelFoco`) aunque el plan no lo pida |
| **El relator, de seis palabras o menos**, un nombre, ningún número | `guion.ts`: `validarGuion(líneas, duración, { nino: true, nombres })` y `problemasDeLinea` |
| **Cada hecho se ve en el cuerpo a los 0,3 s de su línea**, dos salidas van a 1 s o más, y salir no suena a fracaso | `LineaGuion.hecho`, `POSE_MAX` y `SALIDAS_APARTE` (en `respuestas.ts`); `sonido.salida()`, un solo tono suave igual en todos |
| **Las respuestas, en cada instante**: quién va adelante, hacia dónde, cuánto falta y qué acaba de pasar | `plan.respuestas(t)`, obligatorio: sin él `crearJuego` no compila. `problemasDeRespuestas` lo recorre; con `?auditar=nino` el juego deja `window.__nino.verdad()` para `audit-nino`, que saca tres capturas sin subtítulo (al 25 %, al 60 % y al final) y las compara con esto |

`nuevo-juego.mjs` deja puestos estos ganchos y sus pruebas (`sentido`, `marcador`, `respuestas`, `hecho`, `meta`, el relator de seis palabras y figuras del tamaño de una figura), y la página de diseño trae la **ficha del niño**, que se aprueba antes del código: qué es ir adelante, hacia dónde, cómo se ve lo que falta y cada hecho con su tipo y su pose. De pie declara `respuestas`, `marcador` y `sentido`, pero todavía no cumple el resto de la regla (sienta a varios a la vez y su relator pasa de seis palabras): es de los diez que se rediseñan. Todavía no entran las poses de las figuras (correr, frenar, tropezar, echarse, saludar, ganar), que cada capa declare su clase, ni `audit-nino` mismo.

### Lo que el kit no abstrae

- **El plan.** La mecánica de cada juego (qué pasa y cuándo) es lo que lo hace distinto y se escribe aparte, pura y con pruebas. Ocho de diez ya lo tenían (`*-plan.ts`).
- **El dibujo y la física** (el trompo, la tómbola, el aguayo) y el reloj propio de cada llama.
- **Las cámaras propias.** La carrera sigue a la punta, la chovena se acerca con la rueda y La Entrada va en perspectiva: toman del kit solo la tensión, el golpe y el foco.
- **Un marco que ahogue el giro.** La parada falsa, la mordaza o el apagón son tomas y giros de cada juego.

### La leyenda

Los juegos con raíz local (el Guajojó, el Toborochi) **no cuentan su leyenda durante el show**: durante el show, solo el juego. La entrada del catálogo trae un campo opcional `leyenda` (`kit/leyenda.ts`): hasta cinco líneas en español y en inglés, con su fuente en `https`. Se muestra siempre **después** del resultado, en tres lugares: una tarjeta plegada debajo del resultado ("¿De dónde viene este juego?", `src/ui/leyenda.ts`), la página de verificación (`verificar.html?juego=<id>`) y la ficha del juego en `juegos.html`. Ningún dato sin fuente primaria: la prueba del catálogo (`catalogo.test.ts`) exige que cumpla las reglas.

### La frontera, para quien lo use desde afuera

El kit se diseña para publicarse después como paquete aparte, para que en una hackatón un equipo pueda hacer **su propio juego** sobre Tinkazo: el juego recibe la semilla, la lista y los momentos, y devuelve el show. Para eso, nada de `kit/` depende de los textos, las rutas ni el estado de tinkazo.app, salvo por **un puerto**: `anfitrion.ts` (qué le pide el kit al sitio: montar el estadio, el idioma y las frases, el ritmo y la duración, cómo suena una nota, los emblemas) y `catalogo.ts` (la entrada del sitio para cada juego). `frontera.test.ts` lee los imports y falla si otro archivo se cuela. Los textos del relator viajan con el juego (`textos`, es y en); el selector, el diccionario del sitio y los auditores se conectan por fuera. Todavía no se publica: solo la frontera quedó limpia y vigilada.

## Dos formas de agregar un juego (el camino de antes del kit)

Lo normal, desde el 26 de octubre de 2026, es el kit (arriba). Lo que sigue es el camino de antes, que sigue valiendo para los juegos que todavía no migraron y para entender el contrato.

**Como tema de la carrera** (lo barato). El motor de `src/games/race.ts` ya resuelve carriles, cámara, parallax, narrador, cuenta regresiva y meta. Un tema nuevo es una entrada en `src/games/themes.ts`: paleta del cielo, cordillera, pista, forma del horizonte, texto de largada y una función que dibuja al corredor. Así se hizo la [Carrera Stellar](juegos/carrera-stellar.md).

**Como juego propio** (cuando el formato no es una carrera). Un módulo nuevo en `src/games/` que use el andamiaje de [`src/games/overlay.ts`](../src/games/overlay.ts): `mount()` devuelve el lienzo, el azar sembrado con la ronda de drand, los chips con avatar, el registro del botón de saltar y el desmontaje. También devuelve `null` en modo `?instant=1`, y ahí hay que cerrar el sorteo de una. Así se hicieron [Constelación Stellar](juegos/constelacion-stellar.md) y [Cierre de Libro](juegos/cierre-de-libro.md).

Vale la pena solo si la mecánica visual es distinta de verdad. La prueba: si hay que pelearse con el motor para que algo se vea, el formato no era una carrera.

## Pasos para sumarlo

1. Escribir el tema o el módulo.
2. Agregar la variante al tipo `Game` en `src/state.ts`.
3. Agregar el botón en el selector de `index.html` con id `g-<juego>` y su `data-i`.
4. Agregar los textos en español e inglés en `src/i18n.ts`, entre ellos la regla en una frase para la tarjeta de "cómo se juega" (`gc<Juego>`), y sumar el juego a `NOMBRE` y `REGLA` en [`src/ui/gamecard.ts`](../src/ui/gamecard.ts).
5. Enlazar el botón en `src/main.ts` y despachar el juego en `src/ui/draw.ts`.
6. Escribir `docs/juegos/<nombre>.md` siguiendo el modelo de la Carrera Stellar.
7. Pasar la auditoría.

## La auditoría

```bash
pnpm build
pnpm preview &
node scripts/audit-game.mjs <juego>
node scripts/audit-sound.mjs <juego>
node scripts/audit-identidad.mjs <juego>
```

**El auditor de identificación** (desde el 4 de octubre de 2026) mide si cada participante llega a leer su nombre en pantalla antes de que salga el ganador, con 8, 18 y 50 personas: con `?auditar=identidad`, el estadio anota la primera vez que se ve cada nombre entero, legible (un alto de al menos 1,6% de la pantalla) y sin confundirse con otro. Pide que con 8 se vean todos, y con 18 nueve de cada diez, en los juegos que prometen esas cantidades; con 50, informa. Nació de la tómbola, donde salía el número de la bola ganadora y nadie sabía de quién era.

Donde `<juego>` es el valor de `?demo=`: uno de los diez del selector (`race`, `sapo`, `trompo`, `chovena`, `pinata`, `wheel`, `quien`, `trueque`, `teleferico`, `oruro`) o uno de los que salieron de él (al final de esta página). El auditor abre Chrome, corre un sorteo real contra drand y comprueba veinte cosas:

| # | Comprobación | Por qué importa |
|---|---|---|
| 1 | El sorteo termina y muestra un ganador | Un juego que se cuelga deja el evento sin resultado |
| 2 | **El ganador en pantalla es el que fijó el protocolo** | Es la razón de existir del producto |
| 3 | La prueba de la ronda quedó verificada | El sorteo usó aleatoriedad real, no inventada |
| 4 | El enlace a la ronda apunta a drand | El participante puede auditar |
| 5 | El aviso al ganador queda armado | El flujo posterior no se rompió |
| 6 | El juego devolvió la pantalla al terminar | Sin esto el sitio queda inusable |
| 7 | El juego tiene su botón en el selector | Si no, nadie lo puede elegir. Si el botón está pero oculto (`hidden`, `display: none` o `visibility: hidden`), el detalle dice «apagado»: el juego abre con `?demo=` y nadie lo elige. El resultado no cambia: pasa si el botón existe |
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

## La batería entera, con un solo comando

```bash
pnpm build
pnpm audit:todo                                   # la batería de noche (--noche suma la mezcla y el segundo tema de flujo)
pnpm audit:todo --json --solo audit-ui,smoke      # solo esos, y una línea JSON al final
pnpm audit:todo --solo audit-game,audit-rigor,audit-identidad,audit-delatores --juegos trompo   # el mínimo para un cambio en un juego
pnpm audit:todo --simular                         # muestra qué correría y cuánto tardaría, sin correrlo
```

`scripts/audit-todo.mjs` levanta `vite preview` sobre `dist/` en el primer puerto libre desde el 4180 (o usa `--base`), corre los auditores de a dos Chrome como máximo, cada uno con su `CDP_PORT` (9680 y 9690; `--cdp` cambia el primero), y al terminar junta lo que cada uno dejó en un archivo: `docs/capturas/auditorias/<fecha-hora>.json` (esa carpeta no se versiona), con la salida entera de cada corrida en una carpeta al lado. Imprime un resumen de a lo sumo 20 líneas: aprobadas sobre total por auditor y las fallas, las de los que fallaron primero. Un auditor que se cae sin dejar su resumen cuenta como una falla: la batería no se da por buena si alguien se calló. Apaga solo lo que lanzó, por PID, nunca todos los Chrome; y corta lo que pasa del triple de su tiempo medido más cinco minutos.

**Los niveles** (decisión D6 del plan): en cada cambio, a mano, lo que toca al cambio (`--solo`); antes de subir, el mínimo de abajo; de noche, la batería sin opciones. Sin `--solo` corren los de nivel `siempre`. La mezcla de sonido solo con `--noche`: mide la señal real y se desafina con la máquina cargada (el golpe del ganador dio de −59 a +6 LU entre dos builds iguales), así que corre sola, igual que el sonido. La física solo con `--fisica`: sirve a juegos que ya no están en el selector. `--juegos trompo,oruro` limita los auditores de juegos a esos, y `--todos-los-juegos` suma los que salieron del selector (`tombola`, `pasanaku`, `stellar`, `luz`, `ledger`, `rockets`, `totora`): sin la opción, un `todos` son los diez del selector (`scripts/lib/juegos.mjs`).

**Qué corre según lo que cambió** (estimado con los tiempos de la corrida del 22 de octubre de 2026):

| Cambió | Corré | Tarda |
|---|---|---|
| Un juego | `--solo audit-game,audit-rigor,audit-identidad,audit-delatores --juegos <juego>`, y el evaluador si es visual | unos 10 min |
| Un juego nuevo, rediseñado o pasado al kit | lo de arriba y [`audit-nino <juego>`](#la-prueba-del-niño), con un modelo que describa las fotos (no corre solo: necesita al describidor) | unos minutos de fotos (6 s por corrida en De pie), más la descripción |
| `stage.ts` o `camera.ts` | `--solo audit-game,audit-identidad,audit-rigor,audit-encuadre` | cerca de 1 h |
| La interfaz | `--solo audit-ui,check-paginas,check-glosario` | 5 min |
| Antes de subir | `--solo smoke,audit-ui,audit-flujo` más lo de arriba | 25 min |
| De noche | `pnpm audit:todo --noche --json` | más de una hora, con dos Chrome |

**`--json` en cada auditor.** Todos (`audit-*.mjs`, `smoke.mjs`, `check-*.mjs`) aceptan `--json`: al final de su salida de texto, que no cambia, imprimen UNA línea con la forma

```json
{"auditor":"audit-ui","objetivo":"sitio","aprobadas":460,"total":461,"fallas":[{"nombre":"…","detalle":"…"}],"segundos":210}
```

`objetivo` es el juego o la página que se miró (`todos`, `sitio`, `paginas`). Los nombres y detalles de las fallas se acortan a 160 y 240 caracteres, y de más de cien fallas se detallan las primeras cien y se cuenta el resto. El agregador toma la última línea con esa forma de la salida de cada corrida, y la propia batería, con `--json`, termina con una línea igual (`"auditor":"audit-todo"`). `audit-delatores` conserva su `--json <archivo>` (el detalle de las señales); sin archivo, solo agrega la línea. Las pruebas del agregador, sin red ni Chrome, están en `scripts/lib/bateria.test.mjs`, `resumen.test.mjs` y `bateria-proceso.test.mjs`.

### El auditor de legibilidad

```bash
node scripts/audit-legible.mjs [juego|todos] [--temas dark,light] [--tamanos proyector,celular] [--json]
```

Nació del pedido de Nicolás del 25 de octubre de 2026: "tiene mucha letra chiquita; cuando estás proyectando se ve feo, igual en celular". Mide el tamaño en píxeles de pantalla de cada texto visible y falla por los que quedan debajo de la regla:

| Qué se mide | Secundario | Principal |
|---|---|---|
| Lo que mira la sala a 1920×1080 (el estadio, el nombre del ganador) | 28 px | 48 px |
| Lo que mira la sala en un celular de 390×844 | 16 px | 22 px |
| La herramienta (la página de quien organiza), en cualquiera de los dos tamaños | 16 px | 22 px |

Es la regla del barrido de letra (`barrido-letra-emocion.md`, 25 de octubre de 2026): "lo que mira la sala se mide con 28/48 a 1920 y 16/22 a 390; la herramienta, con 16/22". La primera corrida con Chrome (26 de octubre) midió también la herramienta a 1920 con 28/48 y dio 370 fallas con el trompo, casi todas textos que nadie proyecta; con la regla de la herramienta bajó a 198, y son los que el barrido ya tenía en su inventario (la portada, la espera, el resultado). Principal es lo que se lee primero: títulos (no los rótulos `h2.kicker`), el botón de la acción, el nombre del ganador y el cartel del estadio. La regla se cambia con `--reglas proyector=28:48,celular=16:22,herramienta=16:22`. Se perdona medio píxel (un 15,9 que viene de un `rem` es un 16) y un rótulo en mayúsculas vale ×1,35, porque la letra versal de la marca gana un 35 % ("un rótulo de 14 en mayúsculas vale como uno de 16"). El texto solo para lectores de pantalla (`.sr-only`, una caja de 1 px) no se mide.

- **Los pasos del sorteo**, con el DOM: la herramienta al abrir (la lista) y un sorteo de demostración (`?demo=wheel&instant=1&lead=3`, con drand de verdad) en los pasos que se alcanzan a ver: sellada y esperando, ronda lista y resultado. El tamaño es el de CSS por la escala con que se dibuja. Los textos que comparten selector y tamaño son una sola falla (el pie son cuarenta enlaces con el mismo estilo), y dice cuántos son. Con la herramienta se juzga todo menos el nombre del ganador, que es para la sala y se mide con la regla del tamaño.
- **El estadio de cada juego** (`?pose=<juego>`, sin red), con el reloj en turbo de `audit-emocion`: cada 16 cuadros mira los textos que dibuja Pixi, a los que llega por `window.__PIXI_APP_INIT__` como `audit-pantalla.mjs`, y los del DOM del estadio (subtítulos y marcador). De cada texto del lienzo se juzga la **mediana** de su tamaño mientras estuvo a la vista (no el instante en que entra o sale) y su capa decide la regla: el cartel del ganador es lo principal, y los nombres, el marcador y la escena son lo secundario.
- **Capturas recortadas** en `docs/capturas/legible/`, una por falla (hasta 12 por pantalla del DOM y 6 por juego): las del DOM con DevTools, y las del lienzo con un recorte que saca la propia página en el momento, porque el lienzo conserva el cuadro.

Corre en los dos tamaños y los dos temas, y está pensado para menos de 4 minutos por tema. Lo que todavía no mira, porque se abre con un gesto: la espera en grande y el resultado en grande. Las pruebas del código que corre adentro de la página, contra una página de mentira, están en `scripts/lib/legible.test.mjs`.

### Qué se recortó de la batería (25 de octubre de 2026)

La nota de la investigación de los auditores encontró tres repeticiones. Esto se hizo con cada una:

- **`audit-pantalla` entró a `audit-rigor` como un grupo**: misma corrida, un solo Chrome, las mismas reglas (`scripts/lib/pantalla-comprobaciones.mjs`). Por cada juego, después de las comprobaciones de siempre, mide los destellos (a lo sumo tres por segundo) y que todo texto de contraste bajo lleve contorno. `--sin-pantalla` lo saltea; `--pantalla-res 1280x720,1920x1080` y `--pantalla-temas dark,light` miran más. `audit-pantalla.mjs` sigue sirviendo solo (con `--clip` y `--compartir`) y la batería lo corre con `--solo audit-pantalla`.
- **Lo que salió del selector dejó de entrar en un `todos`**: rigor, identidad, emoción, sonido, mezcla, pantalla y delatores toman sus juegos de `scripts/lib/juegos.mjs`, los diez del selector. `tombola`, `pasanaku` y `stellar` se piden por nombre o con `pnpm audit:todo --todos-los-juegos`. Pantalla, de paso, se salteaba El Trueque; ahora lo mira.
- **`audit-espera` y `audit-detalles` se quedan.** La nota decía que `audit-flujo` y `audit-ui` los cubrían. Comparando lo que afirma cada `check(` de los cuatro (espera 24, detalles 35, flujo y ui unas 70 plantillas de nombre), no es así: ninguno de los temas de abajo aparece en flujo ni en ui, así que quitarlos era perder comprobaciones.

| Lo que mira | Está en | ¿Lo mira `audit-flujo` o `audit-ui`? |
|---|---|---|
| La espera en grande desemboca en el show sin un cuadro de la página en el medio, con la pantalla completa heredada y sin cortina | espera | No: flujo solo comprueba que con la espera en grande abierta no haya barra |
| El resultado en grande: el QR con el enlace corto (o el largo antes de 3 s si el servicio no contesta), "Cerrar" y el foco en "Siguiente premio" | espera | No |
| "Volver a la página", y el motivo y el reintento cuando falla traer el número | espera | No: flujo prueba el sellado que falla, no la espera |
| La lista sellada no cambia con "Cargar ejemplo" ni "Editar selección"; recargar la devuelve; "Retomarlo" | detalles | No: ui mira cabecera, cuenta y selector |
| Pegar listas: numeración, Ctrl+Z, repetidos, "Nombre + Apellido" | detalles | No |
| El foco tras el resultado, en el nombre del evento, con Enter y al tocar el cuadro | detalles | No: ui mira el foco solo en el panel y en las ventanas |
| La línea del premio y los 320 px | detalles | No: flujo mide anchos de celular, no esa línea |

| `todos` | Antes | Después |
|---|---|---|
| Escenas (juego × auditor), sin la mezcla | 84 | 70 |
| Escenas, con la mezcla (`--noche`) | 97 | 80 |
| Juegos de rigor, identidad, emoción, sonido y mezcla | 13 | 10 |
| Juegos de pantalla | 12 (sin El Trueque, con tres que nadie elige) | 10, dentro de rigor |
| Arranques de Chrome, sin y con la mezcla | 26 y 27 | 25 y 26 |
| Tiempo en serie, sin y con la mezcla (estimado con los tiempos del 22 de octubre) | 2 h 38 min y 2 h 47 min | 2 h 18 min y 2 h 25 min |

Las mismas comprobaciones por juego, en menos juegos: lo que se pierde son las de `tombola`, `pasanaku` y `stellar`, que se piden por nombre. Los conteos están fijados en `scripts/lib/bateria-recortes.test.mjs`.

## La prueba del niño

La regla del niño (26 de octubre de 2026, [en el kit](#la-regla-del-niño-en-el-kit)) dice que **cualquier cuadro del juego, sin leer, muestra quién va adelante, hacia dónde van, cuánto falta y qué acaba de pasar**. Sin una medida es una opinión: [`scripts/audit-nino.mjs`](../scripts/audit-nino.mjs) la mide. No llama a ninguna API (no hace falta llave ni cuesta): saca las fotos y la verdad del plan, un modelo que solo ve las fotos las describe, y un juez compara.

```bash
pnpm preview --port 4192 &
CDP_PORT=9692 node scripts/audit-nino.mjs <juego|todos> --personas 18 --semillas 8 --base http://localhost:4192
# el describidor lee preguntas.json con scripts/prompt-nino.md y escribe respuestas-modelo.json
node scripts/audit-nino.mjs --juzgar docs/capturas/nino/<juego> [--json]
# el caso de control: la carrera de hoy, la que no se entendía, tiene que reprobar
CDP_PORT=9692 node scripts/audit-nino.mjs --control --semillas 2 --base http://localhost:4192
node scripts/audit-nino.mjs --control --juzgar docs/capturas/nino/control
```

1. **Capturar.** Por semilla (`?semilla=` y `?ganador=` iguales: cambian la ronda y quién gana) y por tamaño (proyector 1920×1080 oscuro y celular 390×844 claro), corre el show con el reloj en turbo y lo congela al 25 % y al 60 % de su duración y un segundo después del golpe. En cada parada esconde el subtítulo y saca dos fotos: **con letras** (la edad de 9 años, que lee nombres) y **sin letras** (la de 5, que no lee nada: mientras `window.__nino.sinLetras` esté prendido el estadio no dibuja ningún texto del motor, y el auditor esconde la barra de arriba). Son 12 fotos por semilla. Deja en `docs/capturas/nino/<juego>/` (sin versionar) `preguntas.json` (por foto, un id sin sentido, la variante y las cuatro preguntas, en un orden que no es el del show: ni el juego, ni la verdad, ni cuál es la última), `capturas/<id>.png`, el `prompt-nino.md` y, aparte, `oculto/verdad.json`.
2. **Describir.** Un modelo que solo ve las fotos (uno barato; si una foto falla la repite otro más fuerte, en `respuestas-desempate.json`, y decide la segunda) las contesta con el [prompt fijo](../scripts/prompt-nino.md): `adelante`, `hacia`, `falta` y `paso`.
3. **Juzgar.** `--juzgar` compara con la verdad y escribe `veredicto.json` y `repetir.json` (las fotos para el segundo describidor). Con `--json` deja la línea de resumen de los demás auditores.

**El contrato.** Es el del kit (`kit/respuestas.ts`): con `?auditar=nino`, `window.__nino` trae `verdad()` (las `Respuestas`: `adelante` con `quienes` y `lugar`, `hacia`, `progreso` de 0 a 1 que solo sube, y `paso` con tipo, quién y desde cuándo), `t()` (la hora del juego), `duracion` (la hora del golpe, el 100 %) y `sinLetras`. Los juegos del kit lo dejan solos con `crearJuego`. La ruleta (`wheel-nino.ts`) y la carrera de hoy (`race-nino.ts`) lo exponen desde su plan sin cambiar el show: sin el parámetro no se expone nada.

**Qué decide la verdad.** Tres cosas las tiene que declarar el juego, y el veredicto depende de ellas (la primera pasada de la ruleta dio 0 de 2 con la zona declarada, `hacia` «arriba» y una ventana de 4 s; con las de abajo, 2 de 2):

- **La zona** en que está quien va adelante no es del plan: depende de la cámara. La mide el juego donde cae en la pantalla (`lugarDe`, con el tercio del medio como centro): la ruleta, el gajo bajo la flecha; la carrera, la llama de la que va primera en la pista y de la ganadora.
- **`hacia`.** La ruleta gira: «alrededor». La flecha, adónde mirar, es la zona de `adelante`.
- **«Qué acaba de pasar»** es de hace 3 s o menos; pasado eso, `nada`. Que la flecha pase de un gajo a otro no es un hecho: es la rueda.

**Las tolerancias del juez** (`scripts/lib/nino.mjs`, con sus pruebas sin red):

- Nombres sin tildes ni mayúsculas y con las cinco primeras letras de cada palabra («María Q.» vale por «María Quispe»); donde van adelante varios, vale cualquiera.
- Sin letras, la zona exacta: puede nombrar dos, no más. «Hacia», igual o una parte de la diagonal, y nunca también el sentido contrario.
- «Falta»: empieza 0, mucho 0,25, mitad 0,5, poco 0,75, termino 1; acierta a 0,2 o menos del progreso.
- «Paso»: el tipo (`empezo`, `salio`, `adelante`, `freno`, `casi`, `gano`, `nada`) y, con letras, el nombre si el hecho dice quién.
- Una foto pasa con 3 de 4; en la final «hacia» no cuenta y las otras tres son obligatorias. Una corrida (una semilla: los dos tamaños y las dos edades) pasa si pasan todas sus fotos, y el juego con 7 de cada 8 corridas (con 2 semillas, las 2).

**El control.** `--control` corre la carrera de producción de hoy. Si la prueba la aprueba, la prueba está mal: con `--control --juzgar` el éxito es que **no** apruebe.

**Primera corrida (26 de octubre de 2026)**, 18 personas, 2 semillas, los dos tamaños y las dos edades (24 fotos por juego):

| | Ruleta | Carrera de hoy (control) |
|---|---|---|
| Corridas que pasan | 2 de 2 | 0 de 2 |
| Fotos que pasan | 24 de 24 | 12 de 24 |
| Lo que falla | `falta`: no se ve en ninguna de las 16 fotos del 25 % y del 60 %; pasan con 3 de 4 justos | `paso` (dicen «nada» donde se acaba de echar alguien o de abrir los carriles), `adelante` (el cartel grande va sobre quien ya salió) y `falta`; la final, con su cartel, pasa |

**Comprobaciones.** Con la prueba, las 40 comprobaciones (20 de `audit-game` y 20 de `audit-rigor`) pasan a 42: N1 (9 años, con letras) y N2 (5 años, sin letras). La regla pide 47; las otras cinco (la meta en cada cuadro, el sentido fijo, un solo número fuera del cartel, el hecho en el cuerpo a los 0,3 s, cinco clases y un panel) siguen por hacer, y `problemasDeRespuestas` ya cubre las del plan.

## El auditor de mezcla

```bash
node scripts/audit-mezcla.mjs <juego>      # o "todos"; --sin-musica mide solo los efectos
```

El auditor de sonido mira la partitura de los efectos. Este escucha la señal: engancha la salida de WebAudio antes de que cargue la página, junta las muestras de la escena fija de punta a punta y mide con las reglas de la radiodifusión (ITU-R BS.1770, EBU R128):

- **Que nada recorte** y que el pico real (sobremuestreado ×4) quede debajo de −1 dBTP.
- **Que todos suenen parejo**: la sonoridad integrada de cada uno a ±3 LU de la mediana, para que quien organiza no toque la perilla entre un sorteo y otro.
- **Que ningún tramo de 3 s salte** más de 7 LU sobre la integrada.
- **El parlante de un proyector**: la mezcla pasada por un paso alto de 150 Hz no puede perder más de 3,5 LU, y por uno de 300 Hz, más de 6. La primera medición dio de 4,1 a 4,9 LU de pérdida a 150 Hz en los doce juegos: el bajo y los bombos vivían por debajo de lo que reproduce una laptop. Con los armónicos nuevos quedó entre 2,6 y 3,5, y el ganador pasó a sonar entre 6,5 y 50 LU más fuerte que el medio segundo de antes (antes, entre −4 y +6 en los juegos con la música andina).
- **El golpe del ganador**: el medio segundo después del cartel tiene que sonar al menos 2 LU más fuerte que el de antes.

Los umbrales del parlante y del golpe no tienen norma: salen de la investigación del audio y se calibran con lo que hoy suena bien.

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
| Un hecho nuevo cada 2,5 s, y nunca 4 s sin ninguno | Cada sonido que arranca, cada línea nueva de los subtítulos y cada salto de la pantalla después de un rato quieta | Encontró el tercer apretón del Pasanaku: cuatro segundos de zumbido parejo |
| Los subtítulos no tartamudean | Dos líneas a menos de tres décimos | Encontró el nudo del Pasanaku cambiando de frase ocho veces seguidas |
| Ningún cuadro queda vacío | Huellas de un solo gris | |
| Corre fluido | Tiempo real de cada cuadro: 30 por segundo o más, y el 95% en menos de 80 ms | Los cuadros en que el auditor lee el lienzo entero no cuentan |
| El nombre del ganador se lee desde el fondo | Alto de la tinta dentro del cartel: 4,5% del alto de la pantalla o más | A 720 son 32 píxeles, que a un cuarto de escala siguen siendo ocho |
| La tinta del cartel contrasta 4,5:1 o más | Luminancia medida de la tinta contra el fondo del cartel | Un proyector lava el negro |
| Al terminar no queda nada corriendo | Bucles de animación de más, estadio oculto, scroll devuelto, sin pantalla completa | |
| Saltar al 10%, al 50% y al 90% cierra | Que el estadio se vaya antes de seis segundos reales, sin bucles ni excepciones | El cartel se sostiene tres a propósito |
| Dura lo que se eligió | Rápido, normal y épico contra 20, 38 y 45 segundos, con 20% de margen | |
| En celular y en tema claro | Las mismas medidas donde más se rompen | |
| Con dos y con doscientas | Que cierre, se mueva, fluya y el cartel se lea, con `?n=2` y `?n=200` (la ruleta también llega a doscientas: desde el 21 de octubre ya no tiene tope de veinticuatro) | Contesta la pregunta que antes era "revisalo vos". Con dos personas encontró la Constelación con el cielo casi vacío en el armado y en los saltos finales, y el único apretón del Pasanaku con un tirón cada cuatro segundos |

Para medir el cartel, `drawWinnerPlate` anota en el lienzo el rectángulo donde lo dibujó. Buscarlo por el color no alcanzaba: el aguayo del Pasanaku tiene una franja del mismo amarillo, y el auditor la medía como si fuera el cartel.

Cada corrida deja en `docs/capturas/rigor/<juego>-corrida.json` cuándo sonó algo, qué dijeron los subtítulos y cuánto cambió la pantalla en cada décimo de segundo, para mirar un hueco sin volver a correr nada.

## La duración

El selector de duración **apunta a una cantidad de segundos**, no multiplica. `PACES` en [`src/state.ts`](../src/state.ts) dice cuánto tiene que durar el show (`rápido 20 · normal 38 · épico 45`; normal era 30 y épico 42 hasta el 17 de octubre de 2026) y cada juego declara cuánto dura sin estirar con `setGameLength(nominal, fijo)`:

- `nominal` son los **segundos de juego** hasta el revelado, que sí se estiran.
- `fijo` son los **segundos reales** que no se estiran nunca porque le hablan a una persona: los tres del sostén del cartel del ganador, y los tres de la cuenta regresiva de la carrera. Lo que tarda alguien en leer un nombre proyectado no cambia porque se elija una duración más larga.

De ahí sale `paceFactor()`, acotado entre ×0,55 y ×2,2.

Era un multiplicador fijo (`0,8 / 1,4 / 2,2`) y el problema no era el número sino la idea: los seis juegos no duran lo mismo sin estirar, así que el mismo botón entregaba una carrera de 23,5 segundos y un Cierre de Libro de 9,3. No había ninguna posición del selector en la que los seis duraran algo parecido.

**El tope de ×2,2 no es negociable.** Más que eso no es más emoción, es cámara lenta: la ruleta tenía dos segundos de crucero en los que la imagen es un borrón, y multiplicarlos por tres y medio son ocho segundos de nada. Un juego que topa ahí **necesita más contenido, no ir más despacio**. Por eso la ruleta pasó de 7,65 a 17,2 segundos nominales acortando el borrón y alargando la frenada, el Cierre de Libro llegó a seis pasadas y al Pasanaku se le dio tiempo al tejido de los hilos y al apretón.

Cuando el selector tenía doce juegos, el auditor exigente midió treinta segundos en "normal" en todos; desde el 17 de octubre de 2026, "normal" son treinta y ocho (`PACES`, arriba).

**La carrera dura según cuánta gente corre** (desde el 25 de octubre de 2026). "Normal" no son 38 segundos sino lo que dice `normalCarrera(n)` en [`src/duraciones.ts`](../src/duraciones.ts), que sale del plan (`carrera-duracion.ts`): 31 con 8 o menos, de 39 con 9 a 78 con 30, y de 71 a 84 con tandas (31 a 200), nunca más de 90 con la tarjeta de "cómo se juega" adentro, porque cuanta más gente hay más tiene para mostrar (las echadas, las tandas). Rápido es el 90 % (no menos de 20) y épico un 18 % más: por debajo del 90 % las echadas caen a menos de 1 s y los carteles de los nombres bajan de los 3 s que hacen falta para leerlos (por eso duran 3,7 s del plan). Sigue siendo contenido y no cámara lenta: el estiramiento de cada ritmo queda entre ×0,82 y ×1,45. El juego lo declara con el tercer argumento de `setGameLength` y el selector lo muestra (`paceSeconds` mira la lista sellada). Los auditores prometen lo mismo: `audit-rigor` lleva la tabla (una prueba la compara con la función) y mide con la lista de ejemplo y con 30.

**La tarjeta de "cómo se juega" entra en el mismo total.** Desde el 4 de octubre de 2026, antes de cada juego de un sorteo de verdad o de una demo, una tarjeta a pantalla completa dice el nombre del juego, la regla en una frase, cuántos participan y que el ganador ya salió del número público ([`src/ui/gamecard.ts`](../src/ui/gamecard.ts)). Dura 3,5 segundos, se salta con un toque, y sus segundos salen del total con `setCardSeconds`: "normal" sigue siendo treinta, tarjeta incluida (medido: 30,0 a 30,2 en el motor nuevo). La escena fija de `?pose=`, la de los auditores y las capturas, no la muestra, así que lo que mide el auditor exigente es el juego solo.

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

**La tensión**, una curva de 0 a 1 que sube despacio, tiene un escalón en la mitad y se dispara en el último cuarto. La usan los efectos, la música y los subtítulos: la misma curva para todos.

Cómo lo actúa la carrera: cada llama sigue un camino planificado (la línea de base más una ventaja propia, con puntos de control) y tiene **su propio reloj**, que se detiene cuando se planta, se frena un instante al tropezar y se adelanta en un pique. El reloj nunca corre para atrás, así que nadie retrocede, y el de la ganadora termina en hora: llega a la meta justo cuando se acaba la carrera. Como todo es función del tiempo, la misma ronda dibuja los mismos cuadros y saltar sigue funcionando.

Y el cuerpo cuenta lo que le pasa a cada una: el paso de las patas sale de lo que corre de verdad (quieta no las mueve), y cada pata tiene rodilla, que se dobla cuando va hacia adelante y se estira al apoyar, se inclina al picar, se tambalea con polvareda al tropezar, levanta la cabeza con un "!" al plantarse, y la escupida cruza al carril de al lado. En un celular, donde los carriles son finitos, cuenta la carrera una **tabla de posiciones en vivo**, como en la tele, con las filas deslizándose cuando alguien pasa a alguien.

Para mirar un arco puntual: `?pose=<juego>&semilla=<64 hex>` cambia la semilla de la escena fija, y cada juego anota su arco en `canvas.dataset.arco` si se agrega `&auditar=marcas` (sin eso las marcas del plan no se anotan: quien abre la consola no puede leer el arco ni el puesto de la ganadora antes de tiempo). El auditor exigente acepta `--semilla N` para auditar otro arco que el de la semilla fija.

### El giro de cada juego

La carrera actúa la historia entera. Los demás juegos toman del director el arco, y en el susto o el duelo hacen su propio amague, en su idioma. Así la sala no puede aprender cómo termina: en dieciséis semillas, el giro salió en seis cuando lo dispara solo el susto, y en diez cuando lo disparan el susto y el duelo. Cuál sale depende de la ronda. El teleférico va más lejos: tiene un giro para cada uno de los cuatro arcos, así que siempre pasa algo, pero nunca lo mismo.

| Juego | Arco | El giro |
|---|---|---|
| Carrera de llamas y de cohetes | Los cuatro | La historia completa: tropiezos, plantadas, piques, escupidas, duelo con foto |
| Ruleta | Susto | **La parada falsa.** La rueda se para del todo en un gajo ("¿se queda en fulano?"), y después de un instante se queda ("¡se queda!") o se destraba y avanza uno o dos ("¡no! ¡se movió!"). Cuál de las tres sale de la semilla: hasta el 21 de octubre de 2026 avanzaba siempre uno, y el nombrado no ganaba nunca. La integral de la velocidad sigue garantizando que caiga donde tiene que caer |
| Teleférico | Susto | **La puerta.** En la última estación se abre la puerta de la cabina, todavía llena: uno de los de adentro, sorteado, está en la puerta y la cabina se sacude; la puerta se cierra ("¡NO! ¡SE QUEDA!" si es de los dos que llegan arriba) y el que llega arriba sale cuando se abre en la cumbre |
| Teleférico | Duelo | **La mordaza.** En la última estación la cabina de los dos que quedan se suelta: la banda se calla, la cámara queda quieta y la cabina resbala cable abajo, en rojo y con chirrido, hasta que la mordaza la agarra entre chispas y la banda vuelve. Después bajan los del grupo, de a uno, y los dos suben juntos. Se nombra a uno cualquiera de los que van en la cabina, sorteado, así que "la que se salvó" no delata a nadie |
| Teleférico | Tapada | **El apagón.** Justo antes de la última estación la luz titila dos veces y se corta: se apaga todo menos las cabinas, que quedan con su luz de emergencia, la banda se calla, y el convoy frena en el aire con un golpe y se hamaca a oscuras con un latido. La luz vuelve titilando, la banda con ella, y el convoy sigue |
| Teleférico | Remontada | **La ráfaga.** A mitad de viaje entra un viento que cruza la pantalla, hamaca cada cabina a su tiempo y hace flamear las banderas. Los subtítulos la anuncian si no están diciendo otra cosa |
| Tómbola | Susto y duelo | **El rebote.** Se abre la compuerta y asoma primero otra bola, medio afuera, temblando en el borde ("¡sale la 12!"); cae para adentro ("¡no era esa!") y recién sale la ganadora |
| Cierre de Libro | Susto | **La barrida.** La última barrida pasa por la tarjeta ganadora, que tiembla en rojo y suelta pedazos que se vuelven a juntar |
| Cierre de Libro | Duelo | **El sello que duda.** El último sello flota sobre la ganadora ("¿se lo sellan a fulano?") y a último momento se va a la otra |
| Aguayo (antes Pasanaku) | Susto | **El filo.** En el último apretón el bulto ganador sale empujado hasta el borde del aguayo, tiembla ahí con un aro rojo, y la tela lo vuelve a meter |
| Trompo | Susto | **El cabeceo.** En el mano a mano uno de los dos cabecea fuerte, casi se cae ("¡cabecea el de fulano!") y se endereza. Es el que gana la mitad de las veces |
| Trompo | Remontada | **La tiza.** A mitad de los choques a uno le pegan y lo mandan contra la tiza: la roza y vuelve. Se sortea entre los que siguen bailando un buen rato, así que "¡fulano casi se sale!" no anuncia al que gana |
| Trompo | Duelo | **Un choque más.** El mano a mano dura cuatro choques en vez de tres |
| Piñata | Susto | **El que se asoma.** En los últimos palos asoma por la rajadura uno de los dos caramelos que quedan hasta la rotura, y vuelve a entrar. Es el ganador la mitad de las veces: si fuera siempre él, "¡se agarra fulano!" lo anunciaba diez segundos antes del cartel |
| Piñata | Remontada | **Al aire.** Dos palos que no le pegan a nada antes de los últimos |
| La Entrada | Susto | **La máscara.** Antes del último arco de la última fraternidad, a uno de los que siguen bailando casi se le cae la máscara (o se le vuela el sombrero, o la montera). Se sortea entre todos, también el que gana |
| La Entrada | Remontada | **La que vuelve.** En un arco, una fraternidad arranca para la vereda como si se quedara ("¿se quedan los Tojos?") y vuelve a la comparsa. Se sortea entre las que siguen |
| La Entrada | Duelo | **Un salto más.** El contrapunto frente al Socavón dura dos saltos más |
| La Entrada | Tapada | **Se calla la banda.** En un arco la música se corta de golpe y la comparsa se congela a mitad del paso, con la sala que aplaudía; después vuelve la banda |
| Chovena | Susto | **El que aguanta.** En el último corte trastabilla con un "¡!" encima ("¡ojo con fulana!") y aguanta una de las dos que van a la final, la ganadora la mitad de las veces. En la mitad de los cortes trastabilla también alguien que no sale, sorteado entre todos, así que tambalearse no delata a nadie |
| Chovena | Remontada | **La que vuelve.** En el corte falso la ganadora y otra se habían soltado y dan un paso afuera; vuelve la música y vuelven a la rueda. El relator nombra a una de las dos, y en los amagues de los otros arcos también se suelta y vuelve alguien, sorteado entre todos |
| Chovena | Duelo | **El amague de la final.** Con los dos de la mano, la música se corta, se tambalean los dos, y vuelve |
| Chovena | Tapada | **Nadie las nombra.** A las dos de la final no se las nombra hasta el final, y en la final se dice "¡quedan dos!", sin nombres |
| Luz roja, luz verde | Susto | **El haz se detiene.** El Faro mira a la ganadora, que se tambalea sin dar un paso, y el haz sigue de largo ("¡por un pelo!") |
| Luz roja, luz verde | Remontada | **Desde el fondo.** Arranca última y en el último verde pasa a todos |
| Luz roja, luz verde | Duelo | **Una luz roja más.** La rival va adelante hasta que el haz la agarra en la última |
| Balsas de totora | Todos | **El lago.** Los mismos momentos de la carrera, contados en agua: la balsa que se queda quieta, la ola que la ladea, la salpicada |
| Constelación | Susto | **El roce.** A mitad de juego el paquete va derecho a la estrella del ganador, la roza (la estrella se enciende) y se desvía. El amague del último salto ya estaba, en todos los sorteos |

Los giros alargan el juego lo que duran (el rebote casi un segundo, el sello que duda casi uno), y cada juego lo suma a lo que declara con `setGameLength`: el show sigue durando lo que eligió el organizador.

### El auditor de emoción

```bash
node scripts/audit-emocion.mjs <juego>      # o "todos"
```

Los otros auditores miran un sorteo por vez. Lo que mata la emoción no se ve en uno solo: se ve cuando la sala ya aprendió cómo termina. Este corre dieciséis semillas por juego, con el reloj en turbo (veinte cuadros de juego por cuadro real), y mide:

- **Que los arcos varíen**: al menos tres de los cuatro, y ninguno en más de la mitad.
- **En la carrera, que el puesto de la ganadora a la mitad no la delate**: elegir a la que va primera a la mitad, o a la última, no puede acertar en más del 40% de las carreras (al azar se acierta en una de ocho), y la ganadora no puede ir adelante, ni atrás, en más del 60%.
- **El zoom del golpe**: en el golpe (el instante en que sale el cartel) la cámara tiene que estar al menos 1,6 veces más cerca que en el plano general, el más ancho antes del golpe. Se mide con la escala de la escena (`window.__tinkazo`, que solo existe con `?auditar=camara`) y corre el show entero, porque el golpe cae al final y el zoom no depende del arco: por eso se mira en las primeras `--semillas-zoom` (2) semillas de cada juego y no en las dieciséis. Un juego que no hace ningún golpe de cámara falla. El 1,6 es el mínimo que propone la tarea del barrido de emoción mientras no haya un inventario de momentos; se cambia con `--zoom-min`. Con `--json`, la línea trae `datos.zoom` por juego (mínimo, mediana, máximo y cuántas semillas tuvieron golpe) y `datos.arcos`; `pnpm audit:todo` los deja en su archivo.

La primera vez que corrió encontró justo eso: con las curvas de cada arco fijas, a la mitad la ganadora iba primera o última en casi todas las carreras, y en los cohetes iba atrás en trece de dieciséis. Ahora el puesto a la mitad se sortea según el arco (el duelo, del 1.º al 4.º; la tapada, del 3.º al 6.º; la remontada, del 5.º al 8.º; el susto, 1.ª o 2.ª si el tropiezo viene después de la mitad y 7.ª u 8.ª si ya tropezó, mitad y mitad) de modo que cada puesto sale una de cada ocho veces (`audit-delatores race` lo mide a nivel del plan con chi cuadrado), y la curva de la ganadora se corrige por bisección hasta ocuparlo, repetida hasta que valen todos los puestos a la vez. La corrección vale cero en la largada y desde el 86%, así que la llegada no cambia.

### El auditor de choques

```bash
node scripts/audit-choques.mjs
```

Es del trompo, el primer juego con choques de verdad. Los demás auditores miran la pantalla y el sonido; este mira la física. Con `?auditar=choques` el juego anota cada golpe, y el auditor comprueba en ocho semillas y con 2, 3, 60 y 200 personas:
- que cada golpe pase con los dos trompos tocándose y ninguno se dé forzado;
- que el golpeado salga hacia donde lo empujan y el que pega retroceda;
- que nadie atraviese a nadie;
- que el sacado termine afuera de la tiza;
- que las paradas del golpe no se amontonen;
- que la ganadora nunca salga;
- que la misma semilla anote los mismos golpes.

El detalle está en [juegos/trompo.md](juegos/trompo.md#cómo-auditarlo).

## Los subtítulos, y por qué no hay voz

Cada momento del juego se cuenta en la caja del estadio, abajo: "¡Tiren los trompos!", "¡Se cortó la luz!", el nombre del ganador. Cada línea lleva su tensión de 0 a 1, y una línea nueva no pisa a la que está en pantalla salvo que importe más: el anuncio del ganador pisa a cualquier cosa, y un cambio de líder no pisa a otro cambio de líder. El auditor exigente mide que dos líneas no se pisen a menos de tres décimos.

Hasta el 28 de septiembre de 2026 esas mismas líneas las decía en voz alta un relator (`src/narrator.ts`), con la voz neural boliviana de Edge cuando la había. Se sacó del todo: al autor no le gustaba ni con menos frases ni con otras palabras, y un sorteo se entiende sin voz. En una sala con parlantes flojos o con eco, una voz sintética que se traba resta más de lo que suma; la caja se lee desde el fondo y no depende del navegador. Quedaron la música de fondo y los efectos.

## La música

La música de fondo es [`src/music.ts`](../src/music.ts): andina con beat, generada en el navegador. Charango en ritmo de huayno (larga, corta, corta), bombo legüero, zampoña repartida entre dos cañas que se contestan como los sikuris, y un beat electrónico debajo. Sin archivos de audio y sin licencias.

- **La escala es la pentatónica de la menor,** que tiene las mismas cinco notas que la de do mayor de los efectos: la música y los golpes de los juegos no chocan.
- **Sigue a los subtítulos.** Cada línea trae su tensión, y la música prende capas con ella: bombo, charango, beat, zampoña, y todo doblado arriba de 0,85. El tempo va de 96 a 132. Un piso que crece con el tiempo hace que siempre vaya de menos a más aunque los subtítulos no cambien. Así sirve para todos los juegos sin que ninguno sepa de música.
- **La sorpresa es silencio.** Un salto de tensión de tres décimos corta la música un tiempo entero, y vuelve con platillo y bombo. El ganador (tensión 1) remata con el charango en trémolo y se apaga.
- **Sembrada con la ronda,** con otra parte de la aleatoriedad que el juego: prenderla no cambia la animación. Ni un `Math.random`. Desde el 5 de octubre de 2026 la semilla elige entre seis vueltas de acordes y seis ritmos para el motivo (eran tres y cuatro): en un evento de diez sorteos ya no suena siempre igual.
- **Arranca prendida y por debajo de los efectos** desde el 28 de septiembre de 2026. Se apaga con el botón "Música" de la página, y el sonido apagado también la apaga.
- **El respiro antes del ganador.** Desde el 5 de octubre de 2026, cada juego corta la música 0,4 segundos reales antes de coronar (`S.breath(reloj, corona)`, con su propio reloj, así la cámara lenta de la carrera y del trompo no lo corre), y el remate la vuelve a abrir. Vaciar y volver con todo es lo que más mueve en la música de baile, medido en el cuerpo de quien escucha.
- **Graves que se oyen en una laptop.** El bajo vive entre 49 y 82 Hz y los bombos entre 50 y 95, y un parlante chico corta por debajo de unos 150 Hz. Desde el 5 de octubre el bajo lleva una sierra bajita que le da armónicos y cada bombo un golpe corto de cuerpo cerca de 200 Hz: el oído reconstruye la nota grave con sus armónicos.
- **Un juego puede pedir otro estilo.** Desde el 5 de octubre de 2026 la Chovena trae el suyo, la música chiquitana (flauta de caña, caja con bordón de cuero y bombo, en mayor y a negra = 90), con `mountPixi(…, { music: "chovena" })`. Y dos controles para los juegos que hacen de la música su mecánica: `musicHold()` la corta en seco y la vuelve a soltar en el uno del compás, y `musicTempo()` la acelera. La receta y sus fuentes están en [juegos/chovena.md](juegos/chovena.md#la-música).

## Varios premios

Ningún ganador se narra como perdedor, y cada premio tiene su momento (7 de octubre de 2026):

- **El relator los nombra bien.** "¡GANAN Jorge Mamani y Carlos Choque!", con el verbo en plural, y la lista con su "y" (o "e" delante de Isabel): "Carlos Choque, Valeria Torrez y Óscar Limachi". Con más de tres, "y 2 más". Antes los juntaba con comas, en singular y con un "+2".
- **Un co-ganador que sale antes del final, sale con premio.** En el trompo y el aguayo, los juegos que cuentan la historia del primer premio, el relator dice "¡Óscar Limachi sale, pero con premio!" y lo nombra siempre, aunque haya mucha gente. La Chovena y el teleférico ya lo hacían, y el sapo tiene un turno por premio. La piñata (desde el 20 de octubre de 2026) y La Entrada (desde el 21) dicen el premio y no el nombre ("¡Sale con premio!", "Se quedan 3, uno con premio"), y el nombre se lee recién en el cartel (lista "Chicos" de la sección 10 de la auditoría de juegos).
- **El cartel de la corona.** Cada ganador va con su cara, el primer premio más grande, y los demás entran de a uno, cada uno con su golpe: dos notas, más graves cuanto más abajo en la lista. Con más de tres, tres nombres y "y 2 más", igual que el relator. Con un solo premio el cartel no cambia.
- **Para auditarlo sin red:** la escena fija acepta `?nw=N` (`?pose=trompo&nw=3`). El primer ganador es el de siempre y los demás quedan repartidos por la lista.

## Los cierres

Un cierre por cada golpe que pasa una vez. Una condición como `if (t >= T_LOCK && flash === 0)` vuelve a cumplirse en cuanto el destello decae, y el golpe de la traba llegó a dispararse catorce veces encima de la fanfarria. Lo mismo con el narrador: una ventana de `t >= X && t < X + 0.05` dura cuatro o cinco cuadros, y cada `say` cancela al anterior, así que el narrador tartamudea. **Cierre booleano, no ventana.**

## Vertical

El estadio está pensado para una pantalla grande, pero el organizador prueba el sorteo en su teléfono antes del evento. Ahí la escena es vertical y hay tres trampas que no se ven en un proyector:

- **El tamaño de la tipografía sale del alto de la pantalla** (`u()` es `canvas.height / 720`). En vertical eso no dice nada del ancho: el cartel del ganador salía con tipografía de 150 píxeles sobre un lienzo de 780. Todo lo que tenga texto se mide contra el ancho disponible, no sólo contra `u()`.
- **Las disposiciones de dos columnas no existen.** La ruleta tenía la rueda a la derecha y los nombres a la izquierda, y en vertical la placa terminaba encima de la rueda. Un juego con esa forma necesita una disposición propia para vertical, no un reescalado.
- **La barra de arriba y la caja del comentario son HTML por encima del lienzo**, así que el juego no las ve y dibuja debajo. `chrome(c)` en [`overlay.ts`](../src/games/overlay.ts) devuelve cuántos píxeles de lienzo ocupan, arriba y abajo.

Las grillas se reparten con la proporción real de la pantalla y no con una constante: `sqrt(m * ancho / alto)`. Un 1,7 escrito a mano es la proporción de un proyector y en un celular deja las celdas diminutas apretadas en una esquina.

## Lo que el auditor no puede ver

El ritmo, la legibilidad del cartel y el tartamudeo de los subtítulos ya los mide el auditor exigente. Lo que sigue no, y lo revisás vos antes de subirlo:

- ¿Se entiende quién va ganando sin leer texto? Ya no es de ojo: lo mide [`audit-nino`](#la-prueba-del-niño), con la foto sin letras y la verdad del plan.
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

Los diez del selector, en su orden: el de la auditoría de juegos, de las salas chicas a las grandes. Con la lista sellada, el selector los reordena según cuántas personas hay ([`src/ui/recomendar.ts`](../src/ui/recomendar.ts)).

| Juego | `?demo=` | Tipo | Hasta | Documento |
|---|---|---|---|---|
| Carrera de llamas | `race` | Kit de juegos (`crearJuego`), motor PixiJS | 200: hasta 30 corren todas y se van echando de a una; con más, por tandas; ocho en la final (y hasta ocho premios) | [carrera.md](juegos/carrera.md), el plan, las tandas, la recta y lo que mide el auditor de delatores |
| Sapo | `sapo` | Módulo propio (solo motor nuevo) | 200, con clasificatoria a 12 | [sapo.md](juegos/sapo.md) |
| Trompo | `trompo` | Módulo propio (solo motor nuevo) | 200 | [trompo.md](juegos/trompo.md) |
| Chovena | `chovena` | Módulo propio (solo motor nuevo), con su propia música | 200, mejor de 12 a 80 | [chovena.md](juegos/chovena.md) |
| Piñata | `pinata` | Módulo propio (solo motor nuevo) | 200 | [pinata.md](juegos/pinata.md) |
| Ruleta | `wheel` | Módulo propio | 200 (con más de 24, cada gajo reúne a un grupo) | [ruleta.md](juegos/ruleta.md) |
| De pie (antes ¿Quién es?) | `quien` | Sobre el kit (`crearJuego`; el primero en migrar, el 26 de octubre de 2026) | 200, pensado de 8 a 100 | [quien-es.md](juegos/quien-es.md) |
| El Trueque | `trueque` | Módulo propio (solo motor nuevo) | 200, pensado de 12 a 200 | [trueque.md](juegos/trueque.md) |
| Teleférico | `teleferico` | Módulo propio | 200 | [teleferico.md](juegos/teleferico.md) |
| La Entrada (antes Carnaval de Oruro) | `oruro` | Módulo propio (solo motor nuevo), por fraternidades | 200, pensado de 30 a 200 | [la-entrada.md](juegos/la-entrada.md) |

**El selector quedó en diez** el 21 de octubre de 2026, con la auditoría de juegos: entró El Trueque, la fusión del Aguayo y la Constelación, y esos dos salieron. La tómbola había salido el 20, cuando el selector empezó a recomendar según la cantidad de personas. Los tres siguen abriendo con `?demo=` y conservan su captura para la tarjeta de cómo se juega, pero salieron de la página de juegos y de la portada, igual que los que salieron antes: la página muestra lo que se puede elegir. Si la ruleta está elegida y hay más de doscientas personas, el sorteo sigue pasando a la tómbola, aunque no tenga botón (`showFrozen` en `src/ui/freeze.ts` y `playableGame` en `src/state.ts`).

**Luz roja, luz verde salió del selector** el 5 de octubre de 2026, cuando entró la Chovena: cubría la misma necesidad (parar y seguir), pero sin nombre boliviano, con la sombra de una serie de apuestas y con un Faro que era un concepto técnico escondido.

**Los que salieron del selector** el 30 de septiembre de 2026, porque sumaban poco: la carrera de cohetes y las balsas de totora eran la misma carrera de llamas con otra piel, y el Cierre de Libro era el menos visual. El código sigue y se abren con `?demo=` mientras se decide si se borran; la ruleta con más de 24 personas pasaba a la carrera de llamas, no al Cierre de Libro. Desde el 16 de octubre de 2026 pasa a la tómbola, que muestra a todos con su número: la carrera pone ocho en pista y dejaba afuera al resto.

| Juego | `?demo=` | Documento |
|---|---|---|
| Cierre de Libro | `ledger` | [cierre-de-libro.md](juegos/cierre-de-libro.md) |
| Carrera de cohetes | `rockets` | [carrera-stellar.md](juegos/carrera-stellar.md) |
| Luz roja, luz verde | `luz` | [luz-roja-luz-verde.md](juegos/luz-roja-luz-verde.md) |
| Balsas de totora | `totora` | [balsas-de-totora.md](juegos/balsas-de-totora.md) |
| Tómbola (salió el 20 de octubre de 2026) | `tombola` | [tombola.md](juegos/tombola.md) |
| Aguayo, antes Pasanaku (salió el 21 de octubre de 2026; lo reemplaza El Trueque) | `pasanaku` | [pasanaku.md](juegos/pasanaku.md), que ahora cuenta el Aguayo |
| Constelación Stellar (salió el 21 de octubre de 2026; la reemplaza El Trueque) | `stellar` | [constelacion-stellar.md](juegos/constelacion-stellar.md) |
