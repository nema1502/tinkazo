# __NOMBRE__

Estado: **borrador** (nacido con `node scripts/nuevo-juego.mjs __ID__`). Apagado en el selector: abre con `?demo=__ID__` y `?pose=__ID__`.

> Esta es la página de diseño del paso 1 de "Cómo nace un juego" (`docs/juegos.md`). Una página: se llena antes de escribir la escena y pasa con el sí de quien mantiene el proyecto.

## El momento que hace gritar a la sala

_Qué pasa, en una frase, en el instante del golpe. Si no se puede decir en una frase, todavía no es un juego._

## Para cuántas personas

_El rango real, de `n` mínimo a máximo, y el tramo en que luce. Va a `rango` en `src/games/pixi/kit/catalogo.ts`._

## El giro de cada arco

| Arco | Qué ve la sala |
|---|---|
| Remontada | |
| Susto | |
| Duelo | |
| Tapada | |

## Cómo cada uno lee su nombre antes del ganador

_Con 8 personas leen todos; con 18, nueve de cada diez (`audit-identidad`). Qué nivel de nombre se ve en cada tramo y desde qué distancia._

## La ficha del niño

Se aprueba antes del código. La regla (26 de octubre de 2026): **cualquier cuadro del juego, sin leer, dice quién va adelante, hacia dónde van, cuánto falta y qué acaba de pasar.** El plan lo declara en `respuestas(t)` y `audit-nino` lo compara con tres capturas sin subtítulo.

- **Ir adelante es:** _(estar adentro, estar en la punta, estar bajo la flecha…)_
- **Hacia dónde:** _un solo sentido de principio a fin (`sentido`)_
- **Lo que falta se ve con:** _cosas, no números: la distancia a la meta, las figuras que quedan, una estela_
- **El contador:** _el marcador del kit, arriba a la izquierda; baja y llega a 1 con el golpe_
- **Cada hecho, con su tipo y su pose:** _salir, pasar adelante, frenarse, casi salir y volver, ganar; el cuerpo lo muestra a 0,3 s de su línea y dos salidas van a 1 s o más_
- **Cómo sale quien sale:** _con su nombre legible donde pasó, sin X roja ni sonido de fracaso (`sonido.salida()`)_
- **El relator:** _seis palabras o menos, un nombre, ningún número_

## Qué no es

_Nada con cara de casino: ni dados, ni cartas, ni apuestas. Lo cultural, validado con quien mantiene el proyecto y con fuente primaria._

## Batería

- [ ] `pnpm typecheck` y `pnpm test`
- [ ] `audit-game` 20/20
- [ ] `audit-nino` (tres capturas sin subtítulo contra `respuestas(t)`)
- [ ] `audit-rigor`, `audit-identidad`, `audit-emocion`, `audit-sound`, `audit-mezcla`, `audit-pantalla`, `audit-delatores`
- [ ] Capturas en escritorio y celular, dos temas, con el evaluador
- [ ] `node scripts/nuevo-juego.mjs --encender __ID__`
