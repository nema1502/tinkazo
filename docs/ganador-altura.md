# Quien gana, a la vista: Piñata y Teleférico

En la coronación de la Piñata y del Teleférico, el cuerpo de quien gana (el
caramelo, la cabina) y su nombre completo no quedan tapados por el cartel
«GANA» ni por la caja del relator. Se mide en el cuadro que se dibuja, no en
una estimación fija.

## Qué hace el motor

- **El cuerpo real.** El juego le pasa al estadio la caja del dibujo de quien
  gana, ya con balanceo y cámara: el `Graphics` del caramelo ganador en la
  Piñata y `cabina.body` en el Teleférico. No usa el círculo del foco ni el halo.
- **Después del cartel de este cuadro.** `despejarGanador()` corre después de
  que el cartel se acomoda en ese mismo cuadro y usa el borde de abajo real de
  su fondo, no el de un cuadro anterior.
- **El relator como se ve.** El piso sale de `getBoundingClientRect()` del
  relator, que incluye el acercamiento con que entra cada frase. Mientras dura
  ese acercamiento (`ENTRADA_RELATOR`: 280 ms, escala 0,92 → 1 con la curva
  `.34,1.56,.64,1`), `reservaRelator()` guarda lo que el relator puede crecer
  hasta el pico de la curva. Cuando termina, la reserva vuelve a cero. `piso()`
  queda igual para los demás nombres y juegos.
- **Primero mover, después achicar.** `ajusteGanador()` usa `dentro()` y
  `enPantalla()` de `encuadre.ts`: si el cuerpo entra moviendo la escena, la
  escena se mueve sin cambiar de tamaño. Achica solo si moverla no alcanza para
  dejarlo entre el cartel y el relator. La cámara recibe el mismo ajuste
  (`snapshot`/`restore`) sin tocar objetivos, ritmo, reloj ni física. El foco se
  vuelve a pintar sobre la nueva posición (`Crown.enfocar`), sin repetir
  eventos ni adelantar el tiempo.
- **El nombre completo hasta que el cartel lo muestra.** Desde que el caramelo
  toca el piso (Piñata) o desde el foco (Teleférico), un chip con el nombre
  entero, partido en renglones si hace falta y nunca bajo la letra mínima, va
  justo encima del cuerpo, en una franja que se le reserva. Se va cuando el
  nombre del cartel ya se lee a la letra mínima. En la Piñata reemplaza al chip
  abreviado («Carlos Albe…ernández») de antes.
- **CUMBRE.** En el Teleférico, si el ajuste movió la escena, el letrero CUMBRE
  baja lo justo para no quedar detrás del cartel.

Nada de esto cambia quién gana, la semilla, el sellado, el comprobante, las
duraciones ni el ritmo del show.

### Con el 3D (`?motor=3d`)

- **Piñata:** el 3D pone el caramelo en el lugar y con el tamaño que decide el
  2D, y su cámara sale de la escena 2D. El ajuste se mide sobre el caramelo 2D
  (que en 3D no se dibuja) y el 3D lo sigue.
- **Teleférico:** el 3D dibuja la cabina más grande desde el golpe y la del 2D
  está apagada, así que su caja no es la que se ve. En 3D el ajuste no se
  aplica: el cartel y el foco siguen como antes.

## El auditor (`scripts/audit-ganador-altura.mjs`)

Abre el sorteo en WebKit con `?auditar=camara` y lee cada cuadro después de que
Pixi lo dibuja. Con `--comprobar`, cada cuadro tiene que cumplir:

- cuerpo, cartel y nombre dentro de la pantalla y a 4 px o más del relator;
- el cuerpo fuera del cartel, y los nombres de afuera también;
- un nombre completo, sin recortar y a la letra mínima o más (el del cartel o
  el chip puente);
- las comprobaciones de nombre (`nombre N completo`, `nombre N separado del
  relator`, `nombre completo legible`) solo miran las superficies del nombre
  final: el nombre del cartel, el chip puente y los chips con nombre que el
  juego le pone a quien gana. Cada comprobación `nombre N completo` dice de cuál
  se trata (`rol`: `cartel`, `puente` o `chip`);
- quién es quien gana sale de la identidad que marca el estadio (el nombre
  entero de la persona dueña de cada chip), no del texto dibujado: «Ana María…»
  no cuenta como «María Fernanda…»;
- las inscripciones abreviadas de los gajos de la Ruleta («María Z.») y otros
  textos sin marca, como las listas, son decorado: no se les exige nombre
  completo ni distancia al relator. El nombre completo lo exige el cartel;
- la secuencia de cuadros sin huecos y con el cartel sostenido;
- el resultado final sin quedar tapado por la barra fija, y acceso al
  comprobante público por el enlace real de WhatsApp hasta `verificar.html`.

`--relator original` reemplaza, solo en la página que audita, el texto del
anuncio final por una frase fija y larga, para medir el peor caso. No cambia
quién gana ni el comprobante.

```bash
node scripts/audit-ganador-altura.mjs --help
heavy -- node scripts/audit-ganador-altura.mjs --base http://127.0.0.1:5187 \
  --fase estadio-lista --juegos pinata,teleferico --vistas 1024x560 \
  --comprobar --relator original --nombres largos --lang es --movimiento normal \
  --motor 2d --out .evidence/arreglos-sorteos/ganador-altura
```

Necesita un servidor Vite (el auditor importa módulos de `src/`) y Playwright
(`PLAYWRIGHT_PATH` si no está en el proyecto). Las corridas son emulación de
viewport, no teléfonos físicos.

| Opción | Valores |
| --- | --- |
| `--vistas` | `1024x521,1024x560,1024x600` y vecinos 520/522/599/601; anchos de celular |
| `--nombres` | `largos`, `cortos` |
| `--lang` | `es`, `en`; en inglés va con `--relator natural` |
| `--relator` | `original`, `natural` |
| `--movimiento` | `normal`, `reduce` |
| `--dispositivo` | `viewport`, `iphone13` |
| `--motor` | `2d` (por defecto), `3d` |

`--motor 2d` abre la página con `?motor=pixi` y `--motor 3d` con `?motor=3d`.
Sin la opción se usa `2d`: el auditor ya no queda librado a lo que el equipo
elige solo (desde el 4 de noviembre la Carrera, la Piñata y el Sapo arrancan
en 3D por defecto). Pedir el 3D no garantiza que corra: el campo `motor` del
JSON guarda lo pedido (`pedido`, `parametro`), los canvas que se vieron
(`vistos`) y el motor efectivo (`efectivo`: `2d`, `3d`, `mixto` o `sin-show`
si no hubo show, como con `--movimiento reduce`). El 3D se reconoce por su
canvas `#tres-canvas` visible. `--fase estadio` siempre usa `motor=pixi` y no
acepta `--motor 3d`. Los archivos de cada corrida llevan el motor en el nombre
(`transicion-…-original-2d.json`), así una corrida en 2D y otra en 3D no se
pisan.

### Las esperas de 40 s

Los límites siguen en 40 s. Cada espera (`estadio visible`, `placa`,
`estadio oculto`, `nombre del resultado`, `resultado estable`, …) queda en
`esperas` del JSON, también en el de fallo: hora de inicio y de fin, duración,
si terminó bien o el error, y lo que había en la página al empezar y al
terminar (`paginaInicio`, `paginaFin`): su reloj, el último cuadro dibujado,
cuántas muestras y la última, cuántas veces se sondeó la condición y cuándo
fue el último sondeo, y el motor visible. Si al vencer la espera los cuadros
siguieron avanzando, el juego estaba lento, no colgado. Si la página no
contesta en 2 s, se anota `sinRespuesta`.

Con `--movimiento reduce`, el auditor pide que el resultado se lea y que el
comprobante se pueda abrir, sin exigir animación. Si se pierden cuadros, eso no
cuenta como movimiento reducido.

Las comprobaciones puras están en `scripts/lib/ganador-altura-comprobaciones.mjs`
y `scripts/lib/ganador-altura-transicion.mjs`, con sus pruebas en
`src/games/pixi/ganador-altura.test.ts`. Las opciones (`--motor`, `--help`)
están en `scripts/lib/ganador-altura-opciones.mjs` y la telemetría de las
esperas en `scripts/lib/ganador-altura-esperas.mjs`, probadas en
`src/games/pixi/ganador-altura-auditor.test.ts`. La marca de rol e identidad
de cada chip (`window.__tinkazo.rotuloDe`) solo existe con `?auditar=camara`. `ganador-altura-legible.test.ts` lee la
escala del chip puente en `stage.ts` y comprueba que no queda bajo la letra
mínima.
