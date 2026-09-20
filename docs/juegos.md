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

**Como juego propio** (cuando el formato no es una carrera). Un módulo nuevo en `src/games/`, como la ruleta. Vale la pena solo si la mecánica visual es distinta de verdad.

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
```

Donde `<juego>` es el valor de `?demo=`: `race`, `stellar`, `wheel`. El auditor abre Chrome, corre un sorteo real contra drand y comprueba doce cosas:

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
| 9 | El sorteo también corre en inglés | La interfaz es bilingüe |
| 10 | El nombre del juego está traducido | Detecta la clave de i18n olvidada |
| 11 | La escena se dibuja en tema claro | |
| 12 | La escena se dibuja en tema oscuro | |

Guarda capturas en `docs/capturas/juego-<juego>*.png` para revisar a ojo lo que ninguna comprobación automática ve: si se entiende, si emociona, si se lee de lejos en un proyector.

Un juego no entra a `main` hasta que la auditoría dice APROBADO.

## Lo que el auditor no puede ver

Revisalo vos antes de subirlo:

- ¿Se entiende quién va ganando sin leer texto?
- ¿Se lee desde el fondo de la sala, proyectado?
- ¿Dura lo suficiente para generar tensión y lo bastante poco para no aburrir? La carrera dura 15 segundos y la ruleta menos de 5.
- ¿Funciona con 2 participantes y con 200?
- ¿El ganador queda claro al final, sin ambigüedad?

## Juegos actuales

| Juego | `?demo=` | Tipo | Documento |
|---|---|---|---|
| Carrera de llamas | `race` | Motor de carrera, tema andino | — |
| Carrera Stellar | `stellar` | Motor de carrera, tema espacial | [carrera-stellar.md](juegos/carrera-stellar.md) |
| Ruleta | `wheel` | Módulo propio, hasta 24 participantes | — |
