# El sapo

El juego de las chicherías y las ferias de Perú, Bolivia y Colombia: un cajón de madera pintado, con una rana de bronce encima y agujeros en la tapa. Desde lejos se tiran argollas de bronce: unas pegan en la madera y se van, otras bailan en el borde de un agujero y salen, y la última de cada ganador cae en su agujero. Cada agujero lleva el nombre de alguien.

**Identificador:** `sapo` · **Probarlo:** `/?demo=sapo` (sorteo real), `/?pose=sapo` (escena fija, sin red), `/?pose=sapo&n=50`.

Lo propuso Guido Salazar en el PR #1 (1 de octubre de 2026). El 2 de octubre se rediseñó después de que el agente evaluador lo mirara con capturas: se leía como una mesa de póker (un óvalo de paño verde y una moneda dorada), no había un solo nombre en la mesa y los primeros ocho segundos la pantalla casi no se movía.

## La regla: el juego no decide nada

El ganador sale del [protocolo](../protocolo.md) antes de que empiece el juego. El sapo recibe `(names, winners, beacon, done)` y solo lo cuenta:

1. **La clasificatoria** ([`qualifier.ts`](../../src/games/pixi/qualifier.ts)). En la mesa entran doce agujeros. Con más nombres aparecen todos en una grilla y se tachan en una a tres oleadas hasta que quedan doce finalistas, que siempre incluyen a los ganadores. Quiénes los acompañan se elige con el `rng` sembrado de la ronda. Con doce o menos no hay oleadas: los nombres vuelan directo a sus agujeros. Así la pantalla se mueve desde el primer cuadro.
2. **Los agujeros** ([`slots.ts`](../../src/games/pixi/slots.ts)). Los finalistas se reparten sobre los agujeros con el mismo `rng`. Es una permutación: dos ganadores nunca comparten agujero.
3. **Los tiros** ([`sapo-plan.ts`](../../src/games/pixi/sapo-plan.ts), de Guido). Para cada ganador, unos tiros que pegan en la madera, unos que bailan en el borde de un agujero vecino, y uno que cae en el suyo. Ningún tiro que no sea el del ganador cae adentro de un agujero: está probado geométricamente.
4. Todo sale de la hora del juego. Sin `Math.random()`: la misma ronda dibuja los mismos cuadros.

## Lo que se ve

- **El cajón**, visto desde arriba y adelante: tapa de madera con vetas y una guarda de colores, y al frente los cajoncitos numerados del sapo de verdad. Abajo, el piso de un patio.
- **La rana de bronce**, sentada en el medio: respira, parpadea, le palpita la garganta y abre la boca cuando cae una argolla.
- **Los nombres**: cada agujero lleva el suyo afuera, con su cara y en grande (nombre e inicial del apellido), y el aro del agujero es del color de esa persona.
- **La mano** que tira: baja para tomar impulso y suelta.
- **La argolla**: un disco de bronce con agujero, para que no se lea como moneda ni como ficha.
- **El "casi"**: la argolla queda montada sobre el aro de un agujero vecino, medio adentro y medio afuera, baila y sale. El relator nombra a quien estaba ahí.
- **El contador de la casa**, arriba a la izquierda: los que siguen en carrera durante la clasificatoria, después los agujeros, y con varios ganadores el ganador de turno.

## Arcos y cámara

El arco sale de [`drama.ts`](../../src/games/drama.ts) y decide cuántos tiros de tensión tiene el último ganador.

| Arco | Antes del tiro que entra |
|---|---|
| Susto, duelo | 2 que pegan en la madera y 2 que bailan en un borde vecino |
| Remontada | 4 en la madera y 1 en un borde; la cámara sigue de cerca desde el principio |
| Tapada | 1 en la madera y 1 en un borde; nadie se nombra hasta que entra |

La cámara sigue a la argolla, se acerca en el "casi" y en el último vuelo, y termina en el agujero del ganador, encuadrado por encima de la caja de subtítulos.

## Cuánta gente

Cualquier cantidad: con más de doce juega la clasificatoria. Solo con más de doce **ganadores** el sorteo pasa a la carrera de llamas (`playableGame` en `src/state.ts`). Sin WebGL o con `?motor=clasico` no hay versión del motor anterior y cuenta la carrera.

## Auditoría

```bash
node scripts/audit-rigor.mjs sapo --base http://localhost:4173
node scripts/audit-emocion.mjs sapo --base http://localhost:4173
node scripts/audit-sound.mjs sapo --base http://localhost:4173
```
