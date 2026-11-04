# El kit 3D: cómo portar un juego en diez pasos

Para quien va a llevar un juego al 3D. Leelo entero antes de escribir: son diez minutos y te ahorran un día.

## La idea que no se negocia

**El 3D no decide nada ni recalcula nada.** El juego corre entero en el 2D (`pixi/<juego>.ts` o `llamas/carrera.ts`): el plan, el director, el relator, el cartel, el foco, la cámara, los tiempos y quién gana. Con el 3D prendido, el lienzo de PixiJS queda **transparente encima** y, **debajo**, three.js dibuja lo que el 2D ya puso, cuadro a cuadro. Cada cuadro el 2D le pasa a la vista 3D "dónde está cada cosa y cómo está" (en píxeles del mundo 2D) y ella lo viste.

Por eso el 3D hereda la justicia, el ritmo y los auditores sin tocarlos: si en el 2D gana la 7, en el 3D gana la 7, porque el 3D solo cambia de unidades. Y por eso:

- Nada de `Math.random` en el 3D. Lo que parece azar sale de `hash(i, semilla)` o de la hora `t` (`ids.ts`). El motor ya presta un contador a three.js mientras arma objetos (sus identificadores usan `Math.random`); no lo llames a mano salvo que crees objetos fuera de `fabrica` y de `cuadro`.
- Nada del 3D guarda estado que cambie lo que pasa. La vista es una función de lo que recibe (`t` y la entrada del juego), más cachés para no crear objetos en cada cuadro.
- Nada de lo que lee la gente dice "three", "WebGL" ni "3D" en la interfaz. Los nombres siguen siendo las fichas de PixiJS de siempre.

## Qué hay en esta carpeta

| Archivo | Qué es | ¿Lo importa el 2D? |
|---|---|---|
| `tipos.ts` | El contrato: `EntradaBase`, `Camara2D`, `Vista3D`, `Fabrica3D`, `Montaje3D`, `Pantalla3D`. | Sí, solo tipos |
| `enchufe.ts` | `enchufar3D(S, montaje)` y `entradaBase(S, t)`: lo único que el archivo del juego en 2D llama. | Sí, no pesa nada |
| `etiquetas.ts`, `etiquetas-pixi.ts` | Reparto de las fichas de nombre sobre las figuras (que no se pisen ni tapen una cara) y `Etiquetas3D`, que las pone con `S.chip`. | `etiquetas-pixi` sí |
| `camara.ts` | De la cámara del director del 2D a una cámara con perspectiva, y `crearMapa`: puntos 2D a 3D y de vuelta. Perfiles de cámara. | Sí, puro |
| `calidad.ts` | Niveles `alta`, `media`, `baja` por equipo y el gobernador que baja si los cuadros tardan. | No lo necesitás |
| `registro.ts` | Registra solo cada `<juego>-3d.ts` (por `import.meta.glob`). **No se edita.** | Lo usa `pixi/index.ts` |
| `ids.ts` | `sinAzarDeTres`, `hash`, `hashTexto`. | No |
| `motor.ts` | Carga three.js (con `import`, solo desde el módulo `-3d`), crea el renderer debajo del lienzo de PixiJS, sigue el tamaño, la calidad, `destruir()`. `definir3D(fabrica)`. | **Nunca** (trae three.js) |
| `escena.ts` | Cielo por tema (día y atardecer), luces, niebla, suelo, `esparcirPorHash`, `SombrasDeContacto`, `Rafagas` (polvo, chispas) y `PapelPicado`. | Nunca |
| `figuras.ts` | `pieza`, `Geometrias`, `Materiales`, `Instancias` (200 iguales de una vez), `crearPersona`. | Nunca |
| `prueba.ts` | `compararPuestos`: la prueba de igualdad de posiciones 2D y 3D. | Solo en pruebas |

La regla de oro del peso: **el archivo de tu juego en 2D no importa `motor.ts`, `escena.ts` ni `figuras.ts`**, ni `three`. Solo `tipos.ts`, `enchufe.ts` y `etiquetas-pixi.ts`. Una prueba (`tres.test.ts`) lo vigila. three.js viaja en un trozo aparte (`three`, unos 124 kB comprimidos) que `vite.config.ts` comparte entre todos los juegos: se baja una vez por sesión y solo con el 3D prendido.

## El contrato

**Qué recibe el 3D en cada cuadro.** Un objeto `E extends EntradaBase`:

```ts
interface EntradaBase {
  t: number;      // la hora del juego, en segundos: todo lo que se mueve solo en el 3D es función de esto
  w: number; h: number;   // el tamaño de la pantalla
  u: number;      // la unidad de la pantalla (S.u())
  cam: Camara2D;  // la cámara del director, ya aplicada: x, y, zoom, rot, sacudonX, sacudonY
}
```

Lo tuyo (`E`) suma lo propio del juego, **en píxeles del mundo 2D**: la lista de trompos con `x`, `y`, `alto` (si saltan), `giro`, `vivo`, `fase`, etc. Lo que el 2D ya calculó, sin recalcular.

**Qué devuelve el 3D.** Una `Vista3D<E>`:

```ts
interface Vista3D<E> {
  frame(e: E): void;                         // dibuja el cuadro
  pantallaDe(id: number): Pantalla3D | null; // dónde cae en la pantalla la cabeza de `id` (para su nombre)
  reconstruir?(): void;                      // el 2D cambió de tamaño: rearmá lo fijo
  destruir(): void;                          // soltá lo que creaste
}
```

`Pantalla3D` es `{ x, y, alto }`: `(x, y)` es el **punto de arriba de la cabeza** y `alto` lo que mide la figura en pantalla. Ahí apoya su ficha el nombre.

**Dónde se enchufa.** En el archivo del juego en 2D, con una sola línea después de armar la escena (paso 4) y una llamada en el cuadro (paso 6). En el módulo `<juego>-3d.ts`, con `definir3D(fabrica)`.

## Los diez pasos

Ejemplo con el trompo (`pixi/trompo.ts`, `tres/trompo-3d.ts`); cambiá el nombre por el de tu juego. Los ids de juego son los de `Game` en `state.ts`: `race`, `wheel`, `trompo`, `pinata`, `oruro`, `chovena`, `teleferico`, `sapo`, `guajojo`, `toborochi`.

### 1. Rama y worktree propios

Desde la rama que trae el kit, con `pnpm install`. No toques `src/i18n.ts`, `index.html`, `src/styles.css`, `src/main.ts`, `src/state.ts`, `src/games/engine.ts`, `src/games/pixi/stage.ts`, `src/games/pixi/index.ts` ni `vite.config.ts`: el kit ya no los necesita.

### 2. Leé qué decide el 2D y qué dibuja

Abrí el archivo del juego en 2D y marcá: (a) **qué decide** (el plan, quién gana, el reloj): eso no se toca; (b) **qué dibuja** (fondo, suelo, figuras): eso es lo que el 3D reemplaza; (c) **qué es del director** (cámara, relator, cartel, foco, fichas, contador): eso se queda en PixiJS, encima.

### 3. Que el 2D acepte una vista 3D

El archivo del juego en 2D exporta hoy `export async function trompoPixi(names, winners, beacon, done)`. Sumale un quinto parámetro opcional con el montaje y pedí el lienzo transparente solo si lo hay:

```ts
import { enchufar3D, entradaBase } from "../tres/enchufe";
import type { Montaje3D } from "../tres/tipos";
import type { EntradaTrompo } from "../tres/trompo-3d"; // solo el tipo: no trae three.js

export async function trompoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void, tres?: Montaje3D<EntradaTrompo>): Promise<void> {
  const st = await mountPixi(beacon, done, () => skipFn(), { transparente: !!tres });
  ...
```

El juego sin `tres` queda **idéntico**: no cambia ni un píxel.

### 4. Enchufá la vista, y apagá el 2D solo si hay 3D

Después de armar la escena 2D:

```ts
const v3 = enchufar3D(S, tres);   // null si no hay 3D o no arrancó: el 2D sigue como siempre
if (v3) {
  ruedo.visible = false;          // el fondo, el suelo y las figuras del 2D se apagan...
  trompos.visible = false;        // ...pero SOLO si v3 existe
}
```

`enchufar3D` crea el motor y la vista, registra el cierre (`S.onCleanup`) y, si el 3D no arranca, vuelve el lienzo a opaco. **Nunca apagues el 2D antes de saber si hay 3D.**

Lo que queda en 2D (no lo apagues): el relator, el cartel y la corona del ganador, el foco, el contador, las fichas de nombre, el papel picado del cartel.

### 5. Escribí `src/games/tres/trompo-3d.ts`

El módulo exporta el tipo de la entrada, la fábrica y el lanzador:

```ts
import { crearAmbiente, crearSuelo, SombrasDeContacto, Rafagas } from "./escena";
import { crearGeometrias, Materiales, pieza } from "./figuras";
import { perfilFiel } from "./camara";
import { definir3D } from "./motor";
import type { EntradaBase, Fabrica3D, Lanzador } from "./tipos";

export interface EntradaTrompo extends EntradaBase {
  trompos: { id: number; x: number; y: number; giro: number; vivo: boolean }[];
}

const PERFIL = perfilFiel(1.05, { altoMira: 0, tam: 1.2 });

const fabrica: Fabrica3D<EntradaTrompo> = (motor, o) => {
  const amb = crearAmbiente(motor);               // cielo por tema, luces, niebla
  const g = crearGeometrias(motor.basura);
  const mat = new Materiales(motor.basura);
  // ...armá lo fijo (el ruedo) y las figuras una vez; después, en `frame`, solo moverlas.
  return {
    frame(e) {
      motor.cuadro(e, PERFIL, (mapa, pose) => {
        for (const t of e.trompos) {
          const [x, y, z] = mapa.a3D(t.x, t.y);   // del 2D al 3D: la única cuenta
          // ...poné la pieza de t.id en (x, y, z) con escala mapa.escalaFigura(...)
        }
        amb.seguir(pose);                          // el cielo sigue a la cámara y el sol a lo que mira
      });
    },
    pantallaDe: (id) => /* motor.pantalla(cabeza3D, pie3D) con la última posición de id */ null,
    destruir() { /* lo que creaste fuera de motor.basura */ },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: no se edita ningún otro archivo para que el trompo aparezca en 3D. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/trompo");
  return (names, winners, beacon, done) => m.trompoPixi(names, winners, beacon, done, montaje);
};
```

El nombre del archivo **es** el id del juego: `trompo-3d.ts`, `wheel-3d.ts`, `teleferico-3d.ts`. `registro.ts` lo encuentra solo (`import.meta.glob("./*-3d.ts")`), y `pixi/index.ts` ya lo pregunta cuando el 3D está prendido. Si no existe, el juego sigue en 2D.

Cosas de `motor.cuadro(e, perfil, dibujar)`: ajusta el tamaño del lienzo, calcula la cámara 3D desde `e.cam` (incluido el sacudón y el acercamiento de emoción), llama a `dibujar(mapa, pose)` con el `Mapa` de este cuadro, renderiza y, con `?auditar=3d`, anota cuadros por segundo en `window.__tres`.

### 6. Pasale la entrada en cada cuadro, después de la cámara

En el cuadro del 2D, **después de `cam.apply(S.scene, ...)`** (la escena ya trae el acercamiento de emoción, el golpe, el "pum" de un choque y lo que corrigió la guardia del ganador):

```ts
cam.update(dt);
cam.apply(S.scene, S.sw(), S.sh(), now);
v3?.frame({ ...entradaBase(S, now), trompos: trompos.map((p, i) => ({ id: i, x: p.x, y: p.y, giro: p.giro, vivo: p.alive })) });
```

`entradaBase(S, t)` arma `t`, `w`, `h`, `u` y `cam`. El resto de `E` es lo tuyo.

### 7. Elegí cómo se mira (el perfil de cámara)

`camara.ts` trae dos formas:

- `perfilFiel(elevacion, { tam, altoMira, ... })` para juegos vistos **desde arriba** (trompo, piñata, sapo, ruleta, teleférico): conserva las proporciones del piso del 2D (`zc = 1 / sin(elevacion)`), así lo que está a la misma altura de la pantalla en el 2D queda a la misma altura en el 3D, y las fichas, el foco y la guardia del ganador del 2D siguen cayendo donde corresponde. Elevación entre 0,9 y 1,2 rad (de 50 a 70 grados).
- `perfil({ elevacion, azimut, zc, acerca, tam, altoMira, pieMira })` para juegos vistos **de costado** (la carrera, el teleférico): `azimut` mira un poco de frente para ver las caras; `zc` separa las filas; `acerca` (0,8) encuadra un poco menos ancho que el 2D, porque con perspectiva a pleno ancho las figuras quedan chicas.

`mapa.a3D(x, y, alto)` y `mapa.a2D(x3, y3, z3)` son la única cuenta entre mundos. `mapa.escalaFigura(esc)` da el tamaño de una figura modelada en píxeles del dibujo.

### 8. Los nombres

Creá `const et = new Etiquetas3D(S)` una vez (paso 4, si hay `v3`) y en cada cuadro, después de `v3.frame`:

```ts
et.poner(quienes.map((i) => ({ id: i, nombre: names[i]!, prioridad: i === nombra ? PRIORIDAD_SIEMPRE : 0 })), (id) => v3.pantallaDe(id), todas);
```

Las fichas son las de siempre (`S.chip`), con la letra legible de la casa. `repartirEtiquetas` las reparte: manda la de más `prioridad` (quien va adelante, quien nombra el relator), después la más cercana a la cámara; cada una prueba arriba de su cabeza y, si choca con otra ficha o con la cara de otra figura, un escalón más arriba, uno más abajo o corrida de lado; si ni así cabe, ese cuadro no se muestra. `todas` son los `id` de las figuras sin ficha cuya cara tampoco se tapa. `S.tags` (el de los juegos del 2D) sigue sirviendo si tu cámara es `perfilFiel`: la guardia de nombres del estadio ya lo respeta.

`pantallaDe(id)` de tu vista: `motor.pantalla([x, yCabeza, z], [x, 0, z])`, con la última posición 3D de la figura `id`.

### 9. La prueba de igualdad (obligatoria)

En `src/games/tres/<juego>-3d.test.ts`: sacá del plan 2D del juego (como hace `llamas/carrera-3d.test.ts` con `planCarrera`) dónde está cada figura en varios momentos (mínimo 25, 50, 70, 88 y 100 % del show) con 5, 18 y 30 personas y cuatro semillas, y pasáselo al ayudante:

```ts
import { compararPuestos, ganaIgual } from "./prueba";
expect(compararPuestos(puestos, PERFIL, u)).toEqual([]);   // la posición vuelve intacta y el orden es el mismo
expect(ganaIgual(puestosFinales, plan.ganador, PERFIL, u)).toBe(true);
```

Y una prueba de que tu vista usa el mapa de la casa (que `mapa.a3D` es lo que se usa para colocar, no una cuenta propia). Con eso se demuestra que el 3D no cambia quién gana.

### 10. Auditores, rendimiento y capturas

- `pnpm typecheck`, `pnpm exec vitest run --maxWorkers=3`, `pnpm build` (miren el peso: el trozo de tu juego, no más de 20 kB comprimidos sin contar `three`).
- Con Chrome: `node scripts/audit-rigor.mjs <juego> --motor 3d` (misma ronda, mismos cuadros; sin `Math.random`; fluido; saltar; duración; 2 y 200 personas; celular; tema claro). Con `--auditar=3d` queda `window.__tres` con cuadros por segundo y p95. Los demás auditores aceptan `--motor 3d` donde ya lo dicen.
- **Rendimiento**: a 390 por 844 con la CPU frenada cuatro veces (`Emulation.setCPUThrottlingRate` con `rate: 4`; el ejemplo está en `scripts/capturas-3d.mjs`) y a 1366 por 768 sin frenar, con 2, 18 y 200 personas: cuadros por segundo y p95 de ms por cuadro. **Vara: 30 cuadros por segundo o más y p95 menor a 50 ms en celular.** Si no llega, bajá la calidad del juego (menos polígonos, `Instancias` en vez de objetos sueltos, sin partículas) y recién después tocá `calidad.ts`.
- **Capturas** a tamaño real del 2D y del 3D, misma semilla y mismos momentos (arranque, el golpe, el último, el ganador), a 1366 por 768 y 390 por 844, en los dos temas. Mirá cada una con tus ojos: se tiene que ver mejor que el 2D, no solo distinto.

## Trampas conocidas

- **Llamar a `frame` antes de `cam.apply`** da una cámara de un cuadro atrás: el sacudón y el golpe llegan tarde.
- **Crear objetos dentro de `frame`** (en cada cuadro) mata la fluidez y el recolector de basura: creá en la fábrica; en `frame` solo mové. Los materiales y geometrías van en `motor.basura` (o en `Materiales` y `crearGeometrias`), para que `destruir` los suelte.
- **Los modelos van en píxeles del dibujo** (una persona mide `PERSONA_ALTO`), y se escalan con `mapa.escalaFigura(esc)`. Si los hacés en unidades 3D sueltas, no van a coincidir con lo que el 2D mide.
- **La altura no lleva `tam`**: `mapa.a3D(x, y, alto)` ya la pasa a unidades; el `tam` (cuánto se agranda cada figura) es solo de `escalaFigura`.
- **El cielo y la luz cambian con el tema** (`motor.tema`): probá en los dos.
- **Con muchas figuras** (200 personas), una sola `Instancias` por tipo de figura: `usar(n)`, `poner(i, ...)` en cada cuadro y `fin()`.
- **No importes `three` desde el archivo del juego en 2D.** Los tipos, sí (`import type`).
- **Sin `Math.random`**, ni siquiera "solo para variar": `hash(i, semilla)`.
- **`motor.ajustes`** cambia si el equipo no da abasto (el gobernador baja el nivel): mirá `motor.ajustes.sombras` y `.particulas` en el cuadro, o suscribite con `motor.alCambiarNivel`. Las partículas del kit ya lo hacen.
- Una sola vista 3D a la vez: el lienzo se llama `#tres-canvas` y los auditores lo buscan por ese id.

## Cómo se prueba a mano

`pnpm dev` y `http://localhost:5173/?demo=trompo&motor=3d` (o `?pose=trompo&motor=3d&auditar=3d` para la escena fija). Sin `motor=3d`, un juego se ve en 3D solo si está en la lista de `ofrecidos.ts` (los que ganaron la comparación a ciegas: ahí es el de siempre, y quien organiza vuelve al 2D con el interruptor «En 3D / En 2D» o con `?motor=clasico`); los demás, el 2D. Para que tu juego entre a la lista, hace falta que gane la comparación a ciegas y que pase la medida de rendimiento (`scripts/medir-3d.mjs`). El 3D se ignora, sin aviso, si no hay WebGL, con ahorro de datos, con conexión de 3G o menos, en el modo para compartir y en los equipos más justos (`permite3d.ts`).
