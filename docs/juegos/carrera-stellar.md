# Carrera Stellar

Cohetes corriendo por el espacio hacia la meta, con planetas asomando en el horizonte y un planeta anillado de fondo. Es el mismo motor que la carrera de llamas, con otro escenario.

**Identificador:** `stellar` · **Probalo:** [tinkazo.vercel.app/?demo=stellar](https://tinkazo.vercel.app/?demo=stellar) · **Agregado:** 19 de septiembre de 2026

## Por qué existe

Tinkazo nació con una carrera de llamas, que es lo nuestro y funciona. Pero cuando el sorteo lo corre una comunidad del ecosistema de Stellar, en su propio evento, una carrera de cohetes dice "esto es de ustedes" sin que haya que explicarlo. El show es lo único que se personaliza, y personalizarlo es gratis para el organizador.

También sirve de prueba de que agregar un juego cuesta poco: fue un archivo de temas y unas líneas en el motor, no otro juego desde cero.

## Cómo se ve

- **Fondo:** degradado azul muy oscuro a violeta, siempre de noche aunque la página esté en modo claro. El espacio no tiene modo día.
- **Estrellas:** 150 repartidas por toda la pantalla, no solo arriba. Sembradas con la semilla del sorteo, así que el cielo de cada sorteo es distinto y reproducible.
- **Planeta anillado:** naranja, arriba a la derecha, con su anillo inclinado.
- **Nebulosas:** las mismas formas que las nubes de la carrera andina, en violeta translúcido, desplazándose lento.
- **Horizonte:** planetas asomando como medias elipses, en dos capas de parallax.
- **Pista:** violeta más claro que el cielo. Esto no es decorativo: con la pista oscura los cohetes desaparecían.
- **Corredores:** cohetes pixelados con aletas, franja blanca, ventanilla celeste y una llamarada que late al ritmo del avance. Cada uno lleva detrás un halo de su color para despegarse del fondo.
- **Narrador:** arranca con "¡Cohetes en la rampa!" en vez de "¡Llamas a sus puestos!". El resto de la locución es compartida.

## Cómo está hecho

Todo el tema vive en [`src/games/themes.ts`](../../src/games/themes.ts), en la entrada `stellar` de `THEMES`:

| Campo | Qué controla |
|---|---|
| `sky` | Degradado del fondo, en modo claro y oscuro |
| `ridgeFar`, `ridgeNear` | Color de las dos capas del horizonte |
| `track` | Color de la superficie |
| `alwaysNight` | Fuerza escena nocturna y multiplica las estrellas |
| `ridgeShape` | `domes` dibuja planetas; `peaks`, montañas |
| `readyKey` | Clave de i18n del aviso de largada |
| `drawRunner` | Dibuja el cohete, con la llamarada animada por `stride` |

El motor de [`src/games/race.ts`](../../src/games/race.ts) hace el resto: carriles, cámara con parallax, banda elástica para que nadie se quede fuera de plano, sprint final del ganador, cuenta regresiva, sonido, meta cuadriculada y botón de saltar.

El corredor se dibuja en un espacio de 24 por 24 unidades mirando a la derecha, igual que la llama, para que las dos carreras se vean parejas a cualquier escala.

## Qué no hace

No cambia el resultado. Recibe el índice del ganador ya decidido por el [protocolo](../protocolo.md) y lo único que elige es cómo llegar ahí: la velocidad de cada cohete se calcula con un generador sembrado con la semilla pública del sorteo, así que incluso el recorrido es reproducible por cualquiera.

## Auditoría

```bash
pnpm build && pnpm preview &
node scripts/audit-game.mjs stellar
```

Resultado del 19 de septiembre de 2026: **APROBADO, 12 de 12**. Incluye la comprobación clave, que el ganador mostrado sea exactamente el que fijó el protocolo.

Capturas en `docs/capturas/juego-stellar*.png`.

## La curva de tensión

El motor reparte la carrera así, y vale para los dos temas:

La cuenta regresiva va en **segundos reales** y los quince de carrera en segundos de juego, que son los que estira el selector de duración: en "normal" la carrera entera dura treinta segundos.

| Momento | Qué pasa |
|---|---|
| 0 a 3 s reales | Cuenta regresiva, con el número gigante y un pitido por segundo que sube de tono. No se estira: un "3" que dura dos segundos no se lee como cuenta regresiva |
| 0 a 12 s de juego | El pelotón se pelea la punta, con galope y zumbido de tribuna, y el narrador la va cantando. **El ganador corre en el tercio de atrás**, visible pero lejos. El cartel del puntero va en amarillo |
| 12 a 15 s de juego | "¡No respira nadie!" y el ganador remonta. La velocidad se calcula para llegar justo cuando se acaba el tiempo, así nunca se amontona en la meta. Los últimos dos centésimos van mudos |
| Al cruzar | Fogonazo, temblor de cámara, fanfarria y la tarjeta del ganador, sostenida **tres segundos reales**. Los que perdieron se apagan |

Esto se corrigió el 20 de septiembre de 2026. Antes el ganador arrancaba su sprint en el segundo 9 de 15 y desde ahí no lo alcanzaba nadie: la sala se enteraba del final a mitad de carrera y los últimos cuatro segundos eran trámite.

## Ideas pendientes

- Cometas de fondo cruzando la pantalla en diagonal.
- Que los cohetes dejen una estela de partículas al acelerar.
- Un agujero negro en la meta, en vez de la bandera a cuadros.
- Variante con la marca del patrocinador en el casco de los cohetes.
