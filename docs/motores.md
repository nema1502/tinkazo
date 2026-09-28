# Qué motor para los juegos

Revisado el 27 de septiembre de 2026, con las fuentes al final. La pregunta: con qué dibujar los ocho juegos para que se vean mejor, con cámara de cine, sin romper lo que ya garantizan.

## Lo que el motor tiene que cumplir

Tinkazo no es un videojuego: es un show de treinta segundos que se abre desde un enlace, en el celular de alguien o en el proyector de un evento con wifi malo. Eso deja cinco condiciones que no son de gusto:

1. **Carga liviana.** Cada kilobyte se descarga con la sala esperando.
2. **Determinismo.** La misma ronda tiene que dibujar los mismos cuadros. El motor no puede tener un reloj propio que corra solo: tiene que dejarse llevar por la hora del juego, que es lo que comprueba el auditor exigente.
3. **Celular a sesenta cuadros.** Un celular de gama media es el caso normal.
4. **Cámara.** Seguir, acercarse, cámara lenta, sacudones: lo que más le gustó a quien mira.
5. **Auditable.** Los auditores leen el lienzo, el reloj y los sonidos. El motor no puede esconderlos.

## Las opciones

| Motor | Qué es | Peso aproximado | Para Tinkazo |
|---|---|---|---|
| **PixiJS v8 + GSAP** | Dibujo 2D por placa de video (WebGL y WebGPU) y líneas de tiempo | La carrera entera: 118 KB comprimidos, medido | **Sí.** Ya probado: 60 cuadros en una placa integrada, la misma historia que el motor de siempre, y el reloj lo maneja el juego. Con `pixi-filters` suma desenfoque de zoom, de movimiento, brillo y ondas de choque |
| Phaser 4 | Framework 2D completo, salió en abril de 2026 | Unas tres veces PixiJS | Tiene las mejores cámaras de fábrica (zoom, paneo, sacudón, destello y filtros por cámara), pero trae escenas, física, entrada y sonido que no usamos, y un bucle propio. Lo que usaríamos de Phaser se hace en PixiJS con un módulo de cámara propio |
| Three.js | Dibujo 3D | Unos 185 KB comprimidos | El salto visual más grande, con cámaras de verdad. Hay alpacas animadas CC0 de Quaternius para la carrera. Pero son ocho juegos para modelar en 3D: **queda como experimento aparte, empezando por la carrera** |
| Babylon.js, PlayCanvas | Motores 3D completos | Entre 1 y 2 MB | Pensados para juegos 3D grandes o para un editor visual. Demasiado para el wifi de un evento |
| Godot, Unity (exportados a web) | Motores de escritorio compilados a WASM | Unos 35 MB un proyecto vacío de Godot | Descartados: minutos de carga en un celular |
| Rive, Spine | Animación de personajes | Rive: cerca de 1 MB de motor; Spine: pide comprar el editor | Sirven cuando haya ilustraciones de verdad. Antes, no |

## La decisión

**PixiJS v8 con GSAP para los ocho juegos, y un director de cámara compartido.** El director de emoción ya decide qué pasa en cada sorteo; el de cámara decide cómo se mira: a quién sigue, cuándo se acerca, cuándo va en cámara lenta y cuándo sacude. Así cada juego tiene sus momentos de cámara sin escribirlos de cero.

Desde el 28 de septiembre de 2026 el motor nuevo es el de todos: los ocho juegos pasaron el auditor exigente con 20/20. El anterior no se borra, queda de respaldo por tres caminos:

- **`?motor=clasico`** lo pide a mano.
- **Sin WebGL** (un equipo viejo o con la aceleración apagada) el sitio lo usa solo: `src/games/engine.ts` lo mira antes de cargar nada.
- **Si el motor nuevo no arranca** o el wifi del evento no alcanza a bajarlo, el sorteo sigue con el anterior. El show nunca se queda en blanco.

El punto para volver atrás del todo está marcado en git con la etiqueta `antes-de-pixi`.

## Cómo está hecho

- **`src/games/pixi/stage.ts`**, el andamiaje: lo mismo que `overlay.ts` hace para el motor de siempre (el lienzo, el azar sembrado, el relator, la música, las caras, los chips con nombre, el cartel del ganador con papel picado, el reloj, saltar y desmontar). El estadio aparece recién cuando el motor está listo, para que dos corridas de la misma ronda arranquen en el mismo cuadro.
- **`src/games/pixi/camera.ts`**, el director de cámara. Cada juego le dice a qué mirar, qué tan cerca y a qué ritmo; la cámara llega con suavidad, pega golpes de acercamiento (`punch`), sacude (`shake`), se inclina (`tilt`) y desenfoca hacia el centro cuando el acercamiento es rápido, como un zoom de cine. El sacudón sale del reloj, no del azar.
- **`src/games/pixi/index.ts`**, qué juegos tienen versión nueva. Con `?motor=pixi` el sitio pregunta ahí primero, y cada versión se carga recién cuando se pide.
- **Los cuatro juegos que nacieron en el motor nuevo** (Trompo, Balsas de totora, Piñata y Carnaval de Oruro) no tienen versión anterior: en un equipo sin WebGL, el sorteo sale con la carrera de llamas del motor anterior, que cuenta el mismo ganador.
- **Un archivo por juego**, con la misma lógica que el de siempre (el mismo orden de azar, la misma historia del director de emoción, el mismo relato y los mismos sonidos) y dibujo nuevo. Donde la lógica era larga, como en el teleférico, vive en un plan aparte (`cablecar-plan.ts`) copiado tal cual.

Los momentos de cámara de cada juego:

| Juego | La cámara |
|---|---|
| Carrera de llamas y de cohetes | Pegada a la largada en la cuenta, sigue a la punta, se mete en cada tropiezo, plantada o escupida, se cierra sobre las dos de adelante en la recta final, cámara lenta en la foto y golpe en la meta |
| Ruleta | Pegada al cubo al armarse, se abre al girar, se acerca al puntero mientras frena y queda encima en el "¿se queda en fulano?"; sacude cuando se mueve |
| Tómbola | En la boca del bombo mientras caen las bolas, en la compuerta cuando se abre (y en la bola que asoma y vuelve a caer), sigue a la ganadora por la canaleta y se pega al vaso |
| Teleférico | En el andén de la base, sigue al convoy, se acerca a cada andén, se mete en la cabina de la puerta o de la mordaza, se hamaca con la ráfaga, se acerca despacio en el apagón y sigue a la cabina sola hasta la cumbre |
| Aguayo | Cerca de la tela al tenderla, más cerca en cada apretón con un tirón, golpe al bulto que queda en el filo, pegada al nudo |
| Cierre de Libro | Sigue a la barra en cada barrida, se mete en la tarjeta del susto, se acerca a la mesa final, golpe con cada sello y encima de la ganadora mientras el sello duda |
| Trompo | Sobre el ruedo al tirar, se mete en cada choque, sigue al trompo que sacan hasta la tiza, pegada al mano a mano y encima del que cabecea |
| Balsas de totora | La misma cámara de la carrera, sobre el lago |
| Piñata | La piñata de cerca en los palos, más cerca en la rajadura y en el caramelo que se asoma, y cuando se rompe sigue al último caramelo hasta el piso |
| Carnaval de Oruro | Sigue a la comparsa, se acerca a los que se quedan en cada arco y a la máscara que se corre, se abre al Socavón y se cierra en el contrapunto |
| Constelación | Sigue al paquete desde el primer salto, encima en los saltos lentos del final, golpe en el roce y en el engaño, y se abre en la nova para mostrar la constelación |

## Auditarlo

Los cuatro auditores y el script de capturas miran el motor nuevo por defecto, con la placa de video (`TINKAZO_GPU=1`): sin placa, Chrome dibuja WebGL por software a unos diecisiete cuadros por segundo, y medir la fluidez así sería medir la computadora del auditor. Con `--motor clasico` miran el anterior.

`TINKAZO_SIN_WEBGL=1` levanta el navegador sin WebGL, para comprobar que el sorteo cae solo al motor anterior.

## Fuentes

- PixiJS contra Phaser, peso y rendimiento: https://generalistprogrammer.com/comparisons/phaser-vs-pixijs
- Phaser 4, renderizador y filtros: https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games · https://phaser.io/news/2026/05/phaser-4-filter-system
- Filtros de PixiJS: https://github.com/pixijs/filters
- Motores 3D en la web, pesos: https://app.cinevva.com/blog/2026-06-09-web-game-engines-2026-comparison
- Godot exportado a web: https://dev.to/ziva/godot-4-fur-web-spiele-export-wasm-und-browser-performance-4315
- Alpacas animadas CC0: https://quaternius.com/packs/ultimateanimatedanimals.html
- Licencia de Spine: https://esotericsoftware.com/spine-pixi
- Motor de Rive: https://rive.app/docs/runtimes/web/web-js
