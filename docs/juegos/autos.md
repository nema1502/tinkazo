# Carrera de autos

Estado: **borrador** (nacido con `node scripts/nuevo-juego.mjs autos`). Apagado en el selector: abre con `?demo=autos` y `?pose=autos`.

> Esta es la página de diseño del paso 1 de "Cómo nace un juego" (`docs/juegos.md`). Una página: se llena antes de escribir la escena y pasa con el sí de quien mantiene el proyecto.

Una carrera de autos de costado, de izquierda a derecha, pensada para verse **apaisada**: en el proyector y en el celular girado. El ganador ya salió del sorteo; la carrera solo cuenta cómo los demás se quedan en el camino. Nadie llega a la meta salvo quien ganó. El control desde el teléfono (etapa 2) es cosmético: nunca cambia quién cae ni cuándo.

## El momento que hace gritar a la sala

El último rival se hunde en un hoyo a metros de la meta y un solo auto cruza la línea.

## Para cuántas personas

De 2 a 40. Luce de 4 a 16: con pocos, cada caída es un momento; con más de 16 los autos comparten carril y las caídas van de a varios (una roca aplasta a tres, un hoyo se traga a cuatro). Hasta ocho carriles; con más gente, varios autos por carril, escalonados. Va a `rango` en `src/games/pixi/kit/catalogo.ts`.

## Las reglas de los peligros

- **Las rocas caen sobre cualquiera, también sobre quien gana.** A quien gana lo rozan y sigue (el susto); a otros los rozan también, así sobrevivir a una roca no delata a nadie. Una roca que aplasta saca del juego.
- **Los hoyos se abren bajo cualquiera, menos bajo quien gana.** Quien gana nunca cae en un hoyo.
- Las caídas van en **olas** (hasta ocho), separadas por más de un segundo. Cada ola es un hoyo o una roca; con dos olas o más hay de los dos tipos.
- La rival de la historia (`historia.rival`) cae última, en la ola del final.

## El giro de cada arco

| Arco | Qué ve la sala |
|---|---|
| Remontada | Quien gana larga atrás del pelotón y queda delante recién cuando los de adelante caen. |
| Susto | Quien gana va en punta y una roca lo roza: frena, pierde el puesto un instante y recupera. |
| Duelo | Los dos últimos corren pegados hasta la recta final; el hoyo se abre bajo la rival a metros de la meta. |
| Tapada | Dos pelean adelante y caen juntos en la última roca; el que venía tercero cruza solo. |

## Cómo cada uno lee su nombre antes del ganador

Cada auto lleva la cara de su persona en la ventanilla y su nombre encima, en la capa de nombres del estadio (`S.tags`), que los reparte para que no se pisen. La largada (tres segundos) es un plano entero de la grilla: cada uno se busca. Durante la carrera la cámara sigue al pelotón de los que siguen, con acercamiento, y el nombre de quien cae se queda donde cayó (sobre el hoyo o la roca). Con 8 leen todos; con 18, nueve de cada diez.

## La ficha del niño

- **Ir adelante es:** seguir en carrera (los que no cayeron). El líder de la pista no es el ganador.
- **Hacia dónde:** derecha (`sentido: "derecha"`), de principio a fin.
- **Lo que falta se ve con:** la ruta que queda hasta la bandera a cuadros, y los autos que siguen.
- **El contador:** el marcador del kit, arriba a la izquierda; baja con cada ola (de a uno o de a varios) y llega a 1 con el golpe.
- **Cada hecho, con su tipo y su pose:** `salio` en cada ola (el primer nombre de la ola; el auto se hunde o queda aplastado a los 0,3 s), `casi` cuando la roca roza a quien gana (el auto se sacude y frena), `gano` al cruzar.
- **Cómo sale quien sale:** el auto se hunde en el hoyo o queda bajo la roca, con su nombre encima, sin X roja; suena `sonido.salida()`.
- **El relator:** seis palabras o menos, ningún nombre (los nombres van sobre los autos), ningún número.

## Qué no es

No es una apuesta ni una carrera de casino: no hay cuotas, ni fichas, ni tablero. No hay sangre ni choques entre personas: los autos caen o quedan tapados, y la figura sigue entera con su nombre. Lo cultural: la ruta es de cordillera, como la de la carrera de llamas, sin bandera de ningún país.

## Etapa 2 (fuera de esta página): el control desde el teléfono

Un código de sala en la pantalla grande, sin cuenta ni ingreso. Cada teléfono elige su nombre de la lista sellada y manda toques: cambiar de carril, bocina, derrape. Nada de eso cambia el plan: las olas, las víctimas y la hora de la meta salen de la ronda. La pantalla grande es la única que dibuja y la carrera corre completa sin ningún teléfono (así la auditan los auditores).

## Batería

- [ ] `pnpm typecheck` y `pnpm test`
- [ ] `audit-game` 20/20
- [ ] `audit-nino` (tres capturas sin subtítulo contra `respuestas(t)`)
- [ ] `audit-rigor`, `audit-identidad`, `audit-emocion`, `audit-sound`, `audit-mezcla`, `audit-pantalla`, `audit-delatores`
- [ ] Capturas en escritorio y celular, dos temas, con el evaluador
- [ ] `node scripts/nuevo-juego.mjs --encender autos`
